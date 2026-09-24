// @vitest-environment jsdom
/// <reference lib="dom" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { facilityColumns, wardColumns } from '../../packages/snapshot/src/codec.js';
import TABLE from '../../packages/labels/public-labels.json';
import { withScratch, place, copyMigrations, REPO_ROOT } from './_scratch.js';

/**
 * THE PUBLIC PAGE NEVER PRINTS A RAW CODE (R-2026-09-23-68 C).
 *
 * Until -68 the page printed `ICU_ADULT` and `NO_ANAESTHETIST_ON_DUTY`: the
 * database's words, not a reader's (-67 D found nothing that scoped plain labels).
 * packages/labels/public-labels.json is now the one table of words, and
 * this file holds it complete.
 *
 * WHAT "COMPLETE" IS DERIVED FROM, never a hand list (C2):
 *   - the enums: every `CREATE TYPE app.X AS ENUM (...)` and every
 *     `ALTER TYPE app.X ADD VALUE '...'` in the up-migrations. A RENAME VALUE or a
 *     DROP TYPE on a type the page receives stops the parse loudly -- it cannot be
 *     followed by reading forwards, and a parser that guessed would pass a stale table;
 *   - which enums the page RECEIVES: the enum-typed columns of public.ward_public and
 *     public.facility_public, the relations 019 encodes into /beds.json, cross-checked
 *     against the codec's own column lists.
 * The database catalogue is the second derivation, in tests/db/public_labels_enum.test.ts.
 *
 * THE NOT_OFFERED PREMISE, made live here (the founder's condition on C). The page
 * says "not offered at this facility" only for a ward that has LEFT PENDING, because
 * a new ward is NOT_OFFERED by default and nothing records whether anyone chose it.
 * That is sound only while every write that moves a ward to ACTIVE also writes its
 * offering. Today the one such write is publish_ward_status's UPDATE (014), and the
 * last block below holds it to that: a second writer, or one that leaves offering
 * alone, turns this red and has to be looked at.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - writers outside database/migrations (the seed, the e2e harness, tests). They
 *     write synthetic rows on purpose and never reach a hosted database;
 *   - a write assembled as a string for EXECUTE. The parser reads SQL, not the
 *     strings a function might build; no migration does this to app.ward_status today;
 *   - whether the WORDS are right. That is the clinicians' (C3), and the table says
 *     PROVISIONAL until a founder ruling on their answer.
 */

const MIGRATIONS = join(REPO_ROOT, 'database', 'migrations');
const RECEIVED_RELATIONS = ['public.ward_public', 'public.facility_public'] as const;

/** Up-migrations in order, with SQL line comments removed. Throws on an empty corpus. */
function upMigrations(dir: string): { file: string; sql: string }[] {
  const files = readdirSync(dir).filter((n) => n.endsWith('.sql') && !n.endsWith('.down.sql')).sort();
  if (files.length === 0) throw new Error(`no up-migrations in ${dir}, so nothing was derived`);
  return files.map((file) => ({ file, sql: readFileSync(join(dir, file), 'utf8').replace(/--[^\n]*/g, '') }));
}

/** Every app enum and its values, read forwards through the migrations. */
export function enumDefinitions(dir: string): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  for (const { file, sql } of upMigrations(dir)) {
    for (const m of sql.matchAll(/CREATE\s+TYPE\s+app\.(\w+)\s+AS\s+ENUM\s*\(([^)]*)\)/gi)) {
      enums.set(m[1]!, [...m[2]!.matchAll(/'([^']*)'/g)].map((v) => v[1]!));
    }
    for (const m of sql.matchAll(/ALTER\s+TYPE\s+app\.(\w+)\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']*)'/gi)) {
      const values = enums.get(m[1]!);
      if (!values) throw new Error(`${file}: ADD VALUE to app.${m[1]}, which no earlier migration creates`);
      if (!values.includes(m[2]!)) values.push(m[2]!);
    }
    for (const m of sql.matchAll(/ALTER\s+TYPE\s+app\.(\w+)\s+RENAME\s+VALUE|DROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?app\.(\w+)/gi)) {
      throw new Error(`${file}: app.${m[1] ?? m[2]} is renamed or dropped -- this parser cannot follow that, so it derives nothing`);
    }
  }
  return enums;
}

/** Enum-typed columns of the relations the page receives: column -> enum type. */
export function receivedEnumColumns(dir: string): Map<string, string> {
  const columns = new Map<string, string>();
  const found = new Set<string>();
  for (const { file, sql } of upMigrations(dir)) {
    for (const rel of RECEIVED_RELATIONS) {
      const escaped = rel.replace('.', '\\.');
      const create = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${escaped}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i').exec(sql);
      if (create) {
        found.add(rel);
        for (const c of create[1]!.matchAll(/^\s*(\w+)\s+app\.(\w+)/gm)) columns.set(c[1]!, c[2]!);
      }
      for (const alter of sql.matchAll(new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${escaped}\\b([^;]*);`, 'gi'))) {
        const body = alter[1]!;
        if (/ALTER\s+COLUMN\s+\w+\s+(?:SET\s+DATA\s+)?TYPE/i.test(body)) {
          throw new Error(`${file}: a column of ${rel} changes type -- this parser cannot follow that`);
        }
        for (const c of body.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+app\.(\w+)/gi)) columns.set(c[1]!, c[2]!);
      }
    }
  }
  for (const rel of RECEIVED_RELATIONS) {
    if (!found.has(rel)) throw new Error(`no CREATE TABLE for ${rel} was found, so the received columns are unknown`);
  }
  return columns;
}

interface LabelTable {
  labels: Record<string, Record<string, string>>;
  not_yet_displayed: Record<string, { values: string[]; why: string }>;
}

/** Everything wrong with the table against the derived enums. Empty means complete. */
export function labelViolations(enums: Map<string, string[]>, received: Map<string, string>, table: LabelTable): string[] {
  const out: string[] = [];
  const types = new Set(received.values());
  for (const type of types) {
    const values = enums.get(type);
    if (!values) {
      out.push(`the page receives app.${type}, which no migration defines`);
      continue;
    }
    const labelled = table.labels[type];
    const undisplayed = table.not_yet_displayed[type];
    if (labelled && undisplayed) out.push(`app.${type} is both labelled and not displayed`);
    const decided = labelled ? Object.keys(labelled) : undisplayed ? undisplayed.values : [];
    if (!labelled && !undisplayed) out.push(`app.${type} reaches the page and the table does not mention it`);
    if (undisplayed && !undisplayed.why.trim()) out.push(`app.${type} is not displayed and gives no reason`);
    for (const v of values) if (!decided.includes(v)) out.push(`no label for ${type}.${v}`);
    for (const v of decided) if (!values.includes(v)) out.push(`stale label ${type}.${v} -- the enum has no such value`);
  }
  for (const type of [...Object.keys(table.labels), ...Object.keys(table.not_yet_displayed)]) {
    if (!types.has(type)) out.push(`the table carries app.${type}, which the page does not receive`);
  }
  return out;
}

/**
 * Codes that appear as whole words in rendered text. A word that is itself part of a
 * label (NICU, SCBU -- abbreviations the wording chose to keep) is not a raw code.
 */
export function rawCodesIn(text: string, codes: readonly string[], labels: LabelTable['labels']): string[] {
  const allowed = new Set(Object.values(labels).flatMap((l) => Object.values(l)).flatMap((w) => w.match(/[A-Za-z_&]+/g) ?? []));
  return codes.filter((c) => !allowed.has(c) && new RegExp(`(^|[^A-Za-z_])${c}([^A-Za-z_]|$)`).test(text));
}

describe('the label table is complete against the migrations', () => {
  test('real table and migrations are accepted — every value of every enum the page receives is decided', () => {
    const enums = enumDefinitions(MIGRATIONS);
    const received = receivedEnumColumns(MIGRATIONS);
    expect([...received.entries()].sort()).toEqual([
      ['category', 'ward_category'],
      ['gated_by', 'gate_reason'],
      ['monitoring_state', 'monitoring_state'],
      ['offering', 'ward_offering'],
      ['source', 'status_source'],
      ['state', 'status_state'],
    ]);
    for (const column of received.keys()) {
      expect([...wardColumns(), ...facilityColumns()], `${column} is not a column /beds.json carries`).toContain(column);
    }
    expect(enums.get('ward_category')?.length, 'the category enum was not read').toBe(10);
    expect(labelViolations(enums, received, TABLE)).toEqual([]);
  });

  test('plant — an enum value added by a later migration, with no label, is rejected', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/099_plant.sql', "ALTER TYPE app.ward_category ADD VALUE IF NOT EXISTS 'BURNS';\n");
      const dir = join(root, 'database', 'migrations');
      expect(labelViolations(enumDefinitions(dir), receivedEnumColumns(dir), TABLE)).toEqual(['no label for ward_category.BURNS']);
    });
  });

  test('plant — a label for a value the enum does not have, and an enum the table omits, are rejected', () => {
    const enums = enumDefinitions(MIGRATIONS);
    const received = receivedEnumColumns(MIGRATIONS);
    const stale = { ...TABLE, labels: { ...TABLE.labels, gate_reason: { ...TABLE.labels.gate_reason, NO_SURGEON_ON_DUTY: 'no surgeon' } } };
    expect(labelViolations(enums, received, stale)).toEqual(['stale label gate_reason.NO_SURGEON_ON_DUTY -- the enum has no such value']);
    // Re-aimed by R-2026-09-23-69 (b): status_source moved from not_yet_displayed into
    // labels when its rendering was built, so the omission is planted there.
    const rest = Object.fromEntries(Object.entries(TABLE.labels).filter(([type]) => type !== 'status_source'));
    expect(Object.keys(rest), 'the plant did not remove status_source').not.toContain('status_source');
    expect(labelViolations(enums, received, { ...TABLE, labels: rest })).toEqual([
      'app.status_source reaches the page and the table does not mention it',
      'no label for status_source.WARD',
      'no label for status_source.ADMIN',
    ]);
  });

  test('plant — a renamed enum value stops the parse rather than passing a stale table', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/099_plant.sql', "ALTER TYPE app.gate_reason RENAME VALUE 'NO_ANAESTHETIST_ON_DUTY' TO 'NO_ANAESTHETIST';\n");
      expect(() => enumDefinitions(join(root, 'database', 'migrations'))).toThrow(/renamed or dropped/);
    });
  });

  test('anti-vacuity — an empty migrations directory derives nothing and fails', () => {
    withScratch((root) => {
      place(root, 'database/migrations/README', 'no sql here\n');
      const dir = join(root, 'database', 'migrations');
      expect(() => enumDefinitions(dir)).toThrow(/no up-migrations/);
      expect(() => receivedEnumColumns(dir)).toThrow(/no up-migrations/);
    });
  });
});

// ---------------------------------------------------------------------------
// The rendered page.
// ---------------------------------------------------------------------------

const GEN = Date.parse('2026-09-23T03:12:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

function encode(columns: readonly string[], values: Record<string, unknown>): unknown[] {
  return columns.map((c) => values[c] ?? null);
}

const FACILITY = encode(facilityColumns(), {
  facility_id: 'f1', name: 'Synthetic General Hospital', lga: 'Ikeja', state: 'Lagos', lat: 6.6, lng: 3.35,
  public_phone_e164: '+2348000000001', updated_at: iso(GEN),
});

function ward(extra: Record<string, unknown>): unknown[] {
  return encode(wardColumns(), {
    facility_id: 'f1', category: 'A_AND_E', offering: 'OFFERED', bed_count: 3, accepting_effective: true, gated_by: null,
    state: 'OK', source: 'WARD', monitoring_state: 'ACTIVE', updated_at: iso(GEN), ...extra,
  });
}

async function renderWards(wards: unknown[][]): Promise<string> {
  document.body.innerHTML = '<main id="app"></main>';
  const payload = { v: 1, generated_at: iso(GEN), server_now: iso(GEN), facilities: [FACILITY], wards };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200, headers: { 'content-type': 'application/json', 'x-openbed-served-at': iso(GEN + 60_000) },
  })));
  const { render } = await import('../../apps/public-dashboard/src/main.js');
  await render();
  return document.body.textContent ?? '';
}

const lines = (): string[] => Array.from(document.querySelectorAll('#app li')).map((li) => li.textContent ?? '');

describe('the rendered page shows words, never codes', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
  });

  test('every category and every reason renders in words, and no code the migrations define reaches the page', async () => {
    const enums = enumDefinitions(MIGRATIONS);
    const categories = enums.get('ward_category') ?? [];
    const reasons = enums.get('gate_reason') ?? [];
    const text = await renderWards([
      ...categories.map((category) => ward({ category })),
      ...reasons.map((gated_by, i) => ward({ category: categories[i], accepting_effective: false, gated_by })),
    ]);
    for (const c of categories) expect(text).toContain(`${TABLE.labels.ward_category[c as keyof typeof TABLE.labels.ward_category]}: 3 beds`);
    for (const r of reasons) expect(text).toContain(`(${TABLE.labels.gate_reason[r as keyof typeof TABLE.labels.gate_reason]})`);
    const allCodes = [...enums.values()].flat();
    expect(rawCodesIn(text, allCodes, TABLE.labels), 'a raw code reached the public page').toEqual([]);
  });

  test('plant — a raw code in rendered text is caught, and a label abbreviation is not', () => {
    const codes = [...enumDefinitions(MIGRATIONS).values()].flat();
    expect(rawCodesIn('ICU_ADULT: 3 beds — not accepting (NO_ANAESTHETIST_ON_DUTY)', codes, TABLE.labels)).toEqual([
      'ICU_ADULT',
      'NO_ANAESTHETIST_ON_DUTY',
    ]);
    expect(rawCodesIn('Newborn ICU (NICU): 3 beds', codes, TABLE.labels), 'an abbreviation the wording chose was flagged').toEqual([]);
    expect(rawCodesIn('Children\'s ward: 3 beds', codes, TABLE.labels)).toEqual([]);
  });

  test('an unknown code renders the neutral fallback, never the code, and is logged with the code only', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const text = await renderWards([
      ward({ category: 'BURNS_UNIT', accepting_effective: false, gated_by: 'NO_SURGEON_ON_DUTY', bed_count: 41 }),
    ]);
    expect(lines()[0]).toBe(`${TABLE.fallbacks.ward_category}: 41 beds — not accepting (${TABLE.fallbacks.gate_reason}) — updated 1 min ago`);
    expect(text).not.toMatch(/BURNS_UNIT|NO_SURGEON_ON_DUTY/);
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain('BURNS_UNIT');
    expect(logged).toContain('NO_SURGEON_ON_DUTY');
    expect(logged, 'a count reached the log').not.toContain('41');
  });
});

// ---------------------------------------------------------------------------
// NOT_OFFERED only once someone has stated it -- the precedence, each combination.
// ---------------------------------------------------------------------------

describe('offering and monitoring state: which one the page believes', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
  });

  const L = TABLE.labels;
  const ADULT_ICU = L.ward_category.ICU_ADULT;

  test.each([
    ['PENDING', 'NOT_OFFERED', `${ADULT_ICU}: ${L.monitoring_state.PENDING}`, 'the untouched default read as a statement'],
    ['PENDING', 'OFFERED', `${ADULT_ICU}: ${L.monitoring_state.PENDING}`, 'a never-reported ward showed a claim'],
    ['PAUSED', 'NOT_OFFERED', `${ADULT_ICU}: ${L.monitoring_state.PAUSED}`, 'a paused ward read as not offered'],
    ['PAUSED', 'OFFERED', `${ADULT_ICU}: ${L.monitoring_state.PAUSED}`, 'a paused ward showed a claim'],
    ['ACTIVE', 'NOT_OFFERED', `${ADULT_ICU}: ${L.ward_offering.NOT_OFFERED}`, 'a stated NOT_OFFERED read as a ward that has not reported'],
    ['ACTIVE', 'OFFERED', `${ADULT_ICU}: 3 beds — updated 1 min ago`, 'an ordinary reporting ward lost its count'],
  ])('%s + %s reads exactly as decided', async (monitoring_state, offering, expected, why) => {
    await renderWards([ward({ category: 'ICU_ADULT', monitoring_state, offering, bed_count: offering === 'NOT_OFFERED' ? null : 3, accepting_effective: offering === 'OFFERED' })]);
    expect(lines()[0], why).toBe(expected);
    if (expected !== `${ADULT_ICU}: 3 beds — updated 1 min ago`) {
      expect(lines()[0] ?? '', 'a count, an age or an accepting clause came with a state that has none').not.toMatch(/\d|accepting|updated|reported/);
    }
  });

  test.each([
    ['monitoring_state', { monitoring_state: 'SUSPENDED' }],
    ['offering', { offering: 'MAYBE' }],
    ['status_source', { source: 'ROBOT' }],
    ['status_state', { state: 'DISPUTED' }],
  ])('an unknown %s reads "Status unknown", with no count', async (_label, extra) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderWards([ward({ category: 'ICU_ADULT', ...extra })]);
    expect(lines()[0]).toBe(`${ADULT_ICU}: ${TABLE.fallbacks.status}`);
  });
});

// ---------------------------------------------------------------------------
// -69 (b): a count an admin set, or one under review, says so beside the count.
// ---------------------------------------------------------------------------

describe('R-2026-09-23-69 (b) — ADMIN and UNDER_REVIEW are rendered beside the count', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.spyOn(performance, 'now').mockReturnValue(1_000);
  });

  const ADULT_ICU = 'Adult ICU';

  test.each([
    ['WARD', 'OK', `${ADULT_ICU}: 3 beds — updated 1 min ago`],
    ['ADMIN', 'OK', `${ADULT_ICU}: 3 beds — set by admin, not ward-confirmed — updated 1 min ago`],
    ['WARD', 'UNDER_REVIEW', `${ADULT_ICU}: 3 beds — under review — updated 1 min ago`],
    ['ADMIN', 'UNDER_REVIEW', `${ADULT_ICU}: 3 beds — set by admin, not ward-confirmed — under review — updated 1 min ago`],
  ])('source %s, state %s reads exactly as decided (002 section 6)', async (source, state, expected) => {
    await renderWards([ward({ category: 'ICU_ADULT', source, state })]);
    expect(lines()[0]).toBe(expected);
  });

  test('plant — an ADMIN count whose words are emptied is caught: it would read as ward-confirmed', async () => {
    const labels = TABLE.labels as Record<string, Record<string, string>>;
    const source = labels['status_source'];
    expect(source, 'status_source is not in the label table, so there is nothing to plant').toBeDefined();
    const original = source?.['ADMIN'];
    try {
      if (source) source['ADMIN'] = '';
      await renderWards([ward({ category: 'ICU_ADULT', source: 'ADMIN' })]);
      expect(lines()[0], 'the plant did not reach the rendered line').toBe(`${ADULT_ICU}: 3 beds — updated 1 min ago`);
      expect(lines()[0]).not.toContain('set by admin');
    } finally {
      if (source && original !== undefined) source['ADMIN'] = original;
    }
  });
});

// ---------------------------------------------------------------------------
// The premise under "not offered": every write that makes a ward ACTIVE states its offering.
// ---------------------------------------------------------------------------

interface ActiveWriter {
  readonly writer: string;
  readonly statesOffering: boolean;
}

/** Function bodies in a migration: name and [start, end) of the dollar-quoted body. */
function functionBodies(sql: string): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\(/gi)) {
    const open = /AS\s+(\$\w*\$)/i.exec(sql.slice(m.index));
    if (!open) continue;
    const start = m.index + open.index + open[0].length;
    const end = sql.indexOf(open[1]!, start);
    out.push({ name: m[1]!, start, end: end === -1 ? sql.length : end });
  }
  return out;
}

/**
 * Every statement in the up-migrations that WRITES 'ACTIVE' to app.ward_status: an
 * INSERT into it, or an UPDATE of it whose SET list carries 'ACTIVE'. A comparison
 * such as `WHERE monitoring_state = 'ACTIVE'` is a read and is not counted.
 */
export function activeWriters(dir: string): ActiveWriter[] {
  const out: ActiveWriter[] = [];
  for (const { file, sql } of upMigrations(dir)) {
    const bodies = functionBodies(sql);
    for (const m of sql.matchAll(/'ACTIVE'/g)) {
      const from = sql.lastIndexOf(';', m.index) + 1;
      const toSemi = sql.indexOf(';', m.index);
      const statement = sql.slice(from, toSemi === -1 ? sql.length : toSemi);
      const at = m.index - from;
      const update = /UPDATE\s+app\.ward_status\b[\s\S]*?\bSET\b/i.exec(statement);
      let writes = /INSERT\s+INTO\s+app\.ward_status\b/i.test(statement);
      if (update) {
        const setStart = update.index + update[0].length;
        const tail = statement.slice(setStart);
        const setEnd = /\b(WHERE|FROM|RETURNING)\b/i.exec(tail);
        const within = at >= setStart && at < setStart + (setEnd ? setEnd.index : tail.length);
        writes = writes || within;
      }
      if (!writes) continue;
      const inside = bodies.find((b) => m.index >= b.start && m.index < b.end);
      out.push({
        writer: inside ? inside.name : `top-level statement in ${file}`,
        statesOffering: /\boffering\s*=/i.test(statement) || /INSERT\s+INTO\s+app\.ward_status\s*\([^)]*\boffering\b/i.test(statement),
      });
    }
  }
  return out;
}

describe('a ward leaves PENDING only by stating its offering', () => {
  test('real migrations are accepted — the one writer of ACTIVE is publish_ward_status, and it states the offering', () => {
    expect(activeWriters(MIGRATIONS), 'the writer set changed; "not offered" rests on it').toEqual([
      { writer: 'public.publish_ward_status', statesOffering: true },
    ]);
  });

  test('plant — a second path to ACTIVE that leaves offering alone is rejected', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(
        root,
        'database/migrations/099_plant.sql',
        "CREATE OR REPLACE FUNCTION app.admin_activate(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$\nBEGIN\n  UPDATE app.ward_status SET monitoring_state = 'ACTIVE' WHERE id = p_id;\nEND;\n$$;\n",
      );
      expect(activeWriters(join(root, 'database', 'migrations'))).toContainEqual({ writer: 'app.admin_activate', statesOffering: false });
    });
  });

  test('plant — a data migration activating wards outside any function is rejected', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/099_plant.sql', "UPDATE app.ward_status SET monitoring_state = 'ACTIVE';\n");
      expect(activeWriters(join(root, 'database', 'migrations'))).toContainEqual({ writer: 'top-level statement in 099_plant.sql', statesOffering: false });
    });
  });

  test('positive control — an ordinary READ of ACTIVE wards is not a writer', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/099_read.sql', "CREATE VIEW app.active_wards AS SELECT id FROM app.ward_status WHERE monitoring_state = 'ACTIVE';\n");
      expect(activeWriters(join(root, 'database', 'migrations'))).toEqual([{ writer: 'public.publish_ward_status', statesOffering: true }]);
    });
  });

  test('anti-vacuity — an empty migrations directory fails rather than finding no writers', () => {
    withScratch((root) => {
      place(root, 'database/migrations/README', 'no sql here\n');
      expect(() => activeWriters(join(root, 'database', 'migrations'))).toThrow(/no up-migrations/);
    });
  });
});
