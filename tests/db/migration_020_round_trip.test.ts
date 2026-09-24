import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

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
 * THE MIGRATIONS ABOVE 020 ARE REVERSED FIRST (since 021). This file's subject is the
 * step between 019 and 020, so each leg runs on a database AT 020: every later down
 * migration is applied, newest first, before the leg's own work.
 *
 * EVERY LEG RUNS INSIDE ONE ROLLED-BACK TRANSACTION (R-2026-09-24-83). Until BK the
 * reversal was committed through psql in `beforeAll` and undone in `afterAll`. BK-1 b
 * gives every listed seed facility an agreement row, so 021's down now refuses on the
 * shared database (it never loses an agreement), and once reversed, 021's forward would
 * refuse too (the listed facilities would have none). So each leg applies the file
 * TEXTS in a transaction that is rolled back, and nothing here is committed. Before
 * 021's down, the leg takes in that transaction the founder's decision the refusal
 * exists to force: the agreements go, with 021's agreement trigger disabled first so
 * the mirrors keep the seed's published state that B1 compares. The assertions are
 * the ones this file carried before the change.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const FORWARD = join(MIG_DIR, '020_operator_functions_and_listing.sql');
const DOWN = join(MIG_DIR, '020_operator_functions_and_listing.down.sql');
const LEDGER = '020_operator_functions_and_listing.sql';
/** Every forward migration numbered above 020, in apply order. */
const LATER = readdirSync(MIG_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('.down.sql') && f > LEDGER).sort();

/** A migration file's text, applied in the caller's transaction. */
async function apply(tx: TransactionSql, path: string, text = readFileSync(path, 'utf8')): Promise<void> {
  await tx.unsafe(text);
}

/** Everything a leg does happens in here, and is rolled back. */
const inTx = <T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> => withRole('postgres', null, fn);

/**
 * Brings the transaction's database to 020: 021's precondition (see the header), then
 * every later down migration, newest first.
 */
async function atTwenty(tx: TransactionSql): Promise<void> {
  const [t] = await tx.unsafe<{ r: string | null }[]>(`select to_regclass('app.facility_agreement')::text as r`);
  if (t?.r) {
    await tx.unsafe('alter table app.facility_agreement disable trigger trg_facility_agreement_project');
    await tx.unsafe('delete from app.facility_agreement');
  }
  for (const f of LATER.slice().reverse()) await apply(tx, join(MIG_DIR, f.replace(/\.sql$/, '.down.sql')));
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

async function state(tx: TransactionSql): Promise<State> {
  const [p] = await tx.unsafe<{ src: string }[]>(`select prosrc as src from pg_proc where oid = 'app.project_facility(uuid)'::regprocedure`);
  const [r] = await tx.unsafe<{ src: string }[]>(`select prosrc as src from pg_proc where oid = 'app.refresh_lga_rollup()'::regprocedure`);
  const cols = await tx.unsafe<{ c: string }[]>(`
    select column_name as c from information_schema.columns
     where table_schema = 'app' and table_name = 'facility' and column_name in ('listed_at', 'version') order by 1`);
  const [t] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from pg_trigger where tgname = 'trg_facility_version' and not tgisinternal`);
  const idx = await tx.unsafe<{ i: string }[]>(`
    select indexname as i from pg_indexes
     where schemaname = 'app' and indexname in ('invite_one_open_per_scope', 'ward_account_one_active_per_ward') order by 1`);
  const fns = await tx.unsafe<{ f: string }[]>(`
    select distinct n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname || '.' || p.proname = any($1) order by 1`, [NEW_FUNCTIONS] as never[]);
  const [l] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.schema_migrations where filename = $1', [LEDGER] as never[]);
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

async function mirrors(tx: TransactionSql): Promise<string> {
  const f = await tx.unsafe('select * from public.facility_public order by facility_id');
  const w = await tx.unsafe('select * from public.ward_public order by facility_id, category');
  return JSON.stringify({ f, w });
}

describe('migration 020 round trip', () => {
  test('the database starts in the 020 state, and the bodies discriminate', async () => {
    expect(STATE_019.project, '020 left project_facility unchanged, so the body comparison discriminates nothing').not.toBe(STATE_020.project);
    expect(STATE_019.rollup).not.toBe(STATE_020.rollup);
    expect(await inTx(async (tx) => { await atTwenty(tx); return state(tx); })).toEqual(STATE_020);
  });

  test('down restores EXACTLY the 019 state — 008 and 017 bodies, no columns, no indexes, no functions, no ledger row', async () => {
    const s = await inTx(async (tx) => {
      await atTwenty(tx);
      await apply(tx, DOWN);
      return state(tx);
    });
    expect(s, 'the reversal did not land on 019 exactly').toEqual(STATE_019);
  });

  test('B1 — down then up changes NO public row, not even updated_at, and lists every existing facility', async () => {
    const r = await inTx(async (tx) => {
      await atTwenty(tx);
      const before = await mirrors(tx);
      await apply(tx, DOWN);
      await apply(tx, FORWARD);
      const [unlisted] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.facility where listed_at is null');
      return { before, after: await mirrors(tx), unlisted: unlisted?.n };
    });
    expect(JSON.parse(r.before).f.length, 'the seed projected no facility, so this leg would pass vacuously').toBeGreaterThan(0);
    expect(r.after, 'applying 020 changed the public mirrors').toBe(r.before);
    expect(r.unlisted, 'the backfill left a pre-existing facility unlisted').toBe(0);
  });

  test('up after down restores EXACTLY the 020 state, and a re-apply changes nothing', async () => {
    const s = await inTx(async (tx) => {
      await atTwenty(tx);
      await apply(tx, DOWN);
      await apply(tx, FORWARD);
      await apply(tx, FORWARD);
      return state(tx);
    });
    expect(s).toEqual(STATE_020);
  });

  test.each([
    ['a reversal that keeps listed_at', 'ALTER TABLE app.facility DROP COLUMN IF EXISTS listed_at RESTRICT;\n', ''],
    ["a reversal that leaves 020's projection body", 'CREATE OR REPLACE FUNCTION app.project_facility(p_facility_id uuid)', 'CREATE OR REPLACE FUNCTION app.zz_not_the_projection(p_facility_id uuid)'],
  ])('plant — %s is rejected by the exact-state assertion', async (_name, needle, replacement) => {
    const original = readFileSync(DOWN, 'utf8');
    expect(original, `the plant's target is not in the down file: ${needle}`).toContain(needle);
    const tampered = original.replace(needle, replacement);
    const s = await inTx(async (tx) => {
      await atTwenty(tx);
      await apply(tx, DOWN, tampered);
      return state(tx);
    });
    expect(s, 'the tampered reversal still produced the 019 state — the plant did not reach an executed statement').not.toEqual(STATE_019);
  });
});
