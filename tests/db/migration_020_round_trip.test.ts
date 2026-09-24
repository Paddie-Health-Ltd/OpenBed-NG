import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, psqlCommand } from '../setup/db.js';

/**
 * MIGRATION 020 REVERSES TO EXACTLY THE 019 STATE, AND APPLYING IT CHANGES NO PUBLIC
 * OUTPUT (R-2026-09-23-71 B1), in the idiom of tests/db/migration_019_round_trip.test.ts.
 *
 * The state compared:
 *   - the two public-membership bodies, BY VALUE: app.project_facility() against
 *     008's and 020's text, and app.refresh_lga_rollup() against 017's and 020's;
 *   - the two new columns, the version trigger, the two new unique indexes, and the
 *     operator and provisioning functions, each by name;
 *   - the ledger row.
 *
 * B1, THE BACKFILL, asserted on real rows. The seed's projected facilities are read
 * out of both mirrors, 020 is reversed and re-applied, and the mirrors must be
 * IDENTICAL, including each facility's `updated_at`. 020 adds `listed_at` with a
 * column DEFAULT, not an UPDATE, so no trigger fires on the existing rows and
 * nothing is re-projected. Every pre-existing facility is listed afterwards.
 *
 * SAFE ON THE SHARED DATABASE for the reason 019's file gives: the db project runs
 * files one at a time, and every leg restores 020 in a `finally`, with an
 * unconditional `afterAll` behind it.
 *
 * THE MIGRATIONS ABOVE 020 ARE REVERSED FIRST AND RE-APPLIED LAST (since 021). This
 * file's subject is the step between 019 and 020, so it runs on a database AT 020:
 * `beforeAll` applies every later down migration, newest first, and `afterAll`
 * re-applies 020 and then every later forward migration in order. Without that, a
 * 020 re-apply would put 020's bodies back over 021's restated gates, and every file
 * after this one would run against a database no migration describes.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const FORWARD = join(MIG_DIR, '020_operator_functions_and_listing.sql');
const DOWN = join(MIG_DIR, '020_operator_functions_and_listing.down.sql');
const LEDGER = '020_operator_functions_and_listing.sql';
/** Every forward migration numbered above 020, in apply order. */
const LATER = readdirSync(MIG_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('.down.sql') && f > LEDGER).sort();

function applyFile(path: string): void {
  const cmd = `${psqlCommand()} -v ON_ERROR_STOP=1 --single-transaction < ${JSON.stringify(path)}`;
  execFileSync('bash', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The body between `AS $FN$` and `$FN$;` of one function, as a file writes it. */
function bodyFrom(file: string, fn: string): string {
  const text = readFileSync(join(MIG_DIR, file), 'utf8');
  const m = new RegExp(`^CREATE OR REPLACE FUNCTION ${fn.replace('.', '\\.')}\\([\\s\\S]*?AS \\$FN\\$([\\s\\S]*?)^\\$FN\\$;$`, 'm').exec(text);
  if (m === null) throw new Error(`no body for ${fn} in ${file}`);
  return m[1] ?? '';
}

const NEW_FUNCTIONS = [
  'app.assert_operator', 'app.bump_facility_version', 'app.operator_session', 'app.provision_begin', 'app.provision_complete',
  'public.operator_add_category', 'public.operator_create_facility', 'public.operator_edit_facility',
  'public.operator_list_facilities', 'public.operator_set_facility_listed',
];

interface State {
  project: string;
  rollup: string;
  columns: string[];
  trigger: number;
  indexes: string[];
  functions: string[];
  ledger: number;
}

async function state(): Promise<State> {
  const db = sql();
  const [p] = await db<{ src: string }[]>`select prosrc as src from pg_proc where oid = 'app.project_facility(uuid)'::regprocedure`;
  const [r] = await db<{ src: string }[]>`select prosrc as src from pg_proc where oid = 'app.refresh_lga_rollup()'::regprocedure`;
  const cols = await db<{ c: string }[]>`
    select column_name as c from information_schema.columns
     where table_schema = 'app' and table_name = 'facility' and column_name in ('listed_at', 'version') order by 1`;
  const [t] = await db<{ n: number }[]>`select count(*)::int as n from pg_trigger where tgname = 'trg_facility_version' and not tgisinternal`;
  const idx = await db<{ i: string }[]>`
    select indexname as i from pg_indexes
     where schemaname = 'app' and indexname in ('invite_one_open_per_scope', 'ward_account_one_active_per_ward') order by 1`;
  const fns = await db<{ f: string }[]>`
    select distinct n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname || '.' || p.proname = any(${NEW_FUNCTIONS}) order by 1`;
  const [l] = await db<{ n: number }[]>`select count(*)::int as n from app.schema_migrations where filename = ${LEDGER}`;
  return {
    project: p?.src ?? '', rollup: r?.src ?? '', columns: cols.map((c) => c.c), trigger: t?.n ?? -1,
    indexes: idx.map((i) => i.i), functions: fns.map((f) => f.f), ledger: l?.n ?? -1,
  };
}

const STATE_020: State = {
  project: bodyFrom('020_operator_functions_and_listing.sql', 'app.project_facility'),
  rollup: bodyFrom('020_operator_functions_and_listing.sql', 'app.refresh_lga_rollup'),
  columns: ['listed_at', 'version'],
  trigger: 1,
  indexes: ['invite_one_open_per_scope', 'ward_account_one_active_per_ward'],
  functions: [...NEW_FUNCTIONS].sort(),
  ledger: 1,
};
const STATE_019: State = {
  project: bodyFrom('008_projection_triggers.sql', 'app.project_facility'),
  rollup: bodyFrom('017_snapshot_schedule.sql', 'app.refresh_lga_rollup'),
  columns: [], trigger: 0, indexes: [], functions: [], ledger: 0,
};

async function mirrors(): Promise<string> {
  const f = await sql()`select * from public.facility_public order by facility_id`;
  const w = await sql()`select * from public.ward_public order by facility_id, category`;
  return JSON.stringify({ f, w });
}

beforeAll(() => {
  for (const f of LATER.slice().reverse()) applyFile(join(MIG_DIR, f.replace(/\.sql$/, '.down.sql')));
});

afterAll(() => {
  applyFile(FORWARD);
  for (const f of LATER) applyFile(join(MIG_DIR, f));
});

describe('migration 020 round trip', () => {
  test('the database starts in the 020 state, and the bodies discriminate', async () => {
    expect(STATE_019.project, '020 left project_facility unchanged, so the body comparison discriminates nothing').not.toBe(STATE_020.project);
    expect(STATE_019.rollup).not.toBe(STATE_020.rollup);
    expect(await state()).toEqual(STATE_020);
  });

  test('down restores EXACTLY the 019 state — 008 and 017 bodies, no columns, no indexes, no functions, no ledger row', async () => {
    try {
      applyFile(DOWN);
      expect(await state(), 'the reversal did not land on 019 exactly').toEqual(STATE_019);
    } finally {
      applyFile(FORWARD);
    }
  });

  test('B1 — down then up changes NO public row, not even updated_at, and lists every existing facility', async () => {
    const before = await mirrors();
    expect(JSON.parse(before).f.length, 'the seed projected no facility, so this leg would pass vacuously').toBeGreaterThan(0);
    try {
      applyFile(DOWN);
      applyFile(FORWARD);
      expect(await mirrors(), 'applying 020 changed the public mirrors').toBe(before);
      const [unlisted] = await sql()<{ n: number }[]>`select count(*)::int as n from app.facility where listed_at is null`;
      expect(unlisted?.n, 'the backfill left a pre-existing facility unlisted').toBe(0);
    } finally {
      applyFile(FORWARD);
    }
  });

  test('up after down restores EXACTLY the 020 state, and a re-apply changes nothing', async () => {
    applyFile(DOWN);
    applyFile(FORWARD);
    applyFile(FORWARD);
    expect(await state()).toEqual(STATE_020);
  });

  test.each([
    ['a reversal that keeps listed_at', 'ALTER TABLE app.facility DROP COLUMN IF EXISTS listed_at RESTRICT;\n', ''],
    ["a reversal that leaves 020's projection body", 'CREATE OR REPLACE FUNCTION app.project_facility(p_facility_id uuid)', 'CREATE OR REPLACE FUNCTION app.zz_not_the_projection(p_facility_id uuid)'],
  ])('plant — %s is rejected by the exact-state assertion', async (_name, needle, replacement) => {
    const original = readFileSync(DOWN, 'utf8');
    expect(original, `the plant's target is not in the down file: ${needle}`).toContain(needle);
    const tampered = original.replace(needle, replacement);
    const dir = mkdtempSync(join(tmpdir(), 'openbed-020-plant-'));
    const path = join(dir, 'tampered.down.sql');
    writeFileSync(path, tampered, 'utf8');
    try {
      applyFile(path);
      const s = await state();
      expect(s, 'the tampered reversal still produced the 019 state — the plant did not reach an executed statement').not.toEqual(STATE_019);
    } finally {
      await sql().unsafe('drop function if exists app.zz_not_the_projection(uuid)');
      applyFile(FORWARD);
    }
  });
});
