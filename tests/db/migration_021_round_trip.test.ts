import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * MIGRATION 021 REVERSES TO EXACTLY THE 020 STATE, CHANGES NO PUBLIC OUTPUT, AND NEVER
 * INVENTS OR LOSES AN AGREEMENT (R-2026-09-24-75/76; BC-5, BD-1), in the idiom of
 * tests/db/migration_020_round_trip.test.ts.
 *
 * The state compared:
 *   - the two restated gates BY VALUE: operator_set_facility_listed and
 *     app.provision_begin against 020's and 021's text;
 *   - app.facility_agreement, the contact's agreement_accepted_at and version columns,
 *     the version trigger, and the functions 021 adds or drops, each by name;
 *   - the ledger row.
 *
 * THE TWO PUBLIC-MEMBERSHIP BODIES DIFFER FROM 020 BY ONE PREDICATE AND NOTHING ELSE
 * (R-2026-09-24-82 BJ-1, positive since R-2026-09-24-83 BK-1): app.project_facility()
 * and app.refresh_lga_rollup() each gain "an agreement that is not withdrawn", and the
 * down restores 020's bodies byte for byte. With the agreement's projection trigger,
 * they are compared by value in the state below.
 *
 * THE RESTATED GATES DIFFER FROM 020 IN THE AGREEMENT CHECK AND NOTHING ELSE. Each
 * 021 body must equal 020's with only that check replaced, so no other line of a
 * gate that 020's review signed off can move under cover of this one.
 *
 * NEITHER DIRECTION INVENTS OR LOSES AN AGREEMENT. The forward refuses over a contact
 * row carrying agreement_accepted_at, and over a listed facility with no agreement row
 * (BK-1 b). The down refuses while any app.facility_agreement row exists.
 *
 * EVERY LEG RUNS INSIDE ONE ROLLED-BACK TRANSACTION (R-2026-09-24-83). Until BK these
 * legs applied the files through psql, committed, and restored 021 in `finally`. BK-1 b
 * gives every listed seed facility an agreement row, so on the shared database the down
 * now refuses (it never loses an agreement), and after any down the forward refuses
 * (the seed's listed facilities would have none). So each leg applies the file TEXT in
 * a transaction that is rolled back, as tests/db/snapshot_schedule_state.test.ts does
 * with 017, and nothing here is committed. Where a leg needs the down to run, it first
 * takes, in that transaction, the founder's decision the down's refusal exists to
 * force: the agreements are removed, with the agreement trigger disabled so the mirrors
 * keep the state being compared.
 *
 * B1, BY CONSTRUCTION (BK-1 b). On a first apply app.facility_agreement does not exist,
 * so the second pre-check admits 021 only where no facility is listed, and an unlisted
 * facility is public nowhere. So the public output is empty before and after, and the
 * leg below says so rather than dressing it as a comparison of something. What is
 * non-vacuous: the down writes no public row over the seed's published state, and a
 * re-apply over it changes no public row. The committed "down then up changes NO
 * public row" leg this file had until BK cannot exist any more, because "up" over the
 * seed is refused; those three legs replace it.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const FORWARD = join(MIG_DIR, '021_facility_agreement_and_contact_write.sql');
const DOWN = join(MIG_DIR, '021_facility_agreement_and_contact_write.down.sql');
const LEDGER = '021_facility_agreement_and_contact_write.sql';

/** A migration file's text, applied in the caller's transaction. */
async function apply(tx: TransactionSql, path: string, text = readFileSync(path, 'utf8')): Promise<void> {
  await tx.unsafe(text);
}

/** The refusal of an apply that must fail, taken in a savepoint so the transaction survives. */
async function refusal(tx: TransactionSql, path: string): Promise<{ message: string; detail: string }> {
  try {
    await tx.savepoint((sp) => apply(sp, path));
  } catch (e) {
    const err = e as { message: string; detail?: string };
    return { message: err.message, detail: err.detail ?? '' };
  }
  throw new Error(`${path} applied, and it was expected to refuse`);
}

/** Everything a leg does happens in here, and is rolled back. */
const inTx = <T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> => withRole('postgres', null, fn);

/**
 * The founder's decision the down's refusal exists to force, taken in the rolled-back
 * transaction: the agreements go. The trigger is disabled first, so the mirrors keep
 * the published state the down is then compared against.
 */
async function clearAgreements(tx: TransactionSql): Promise<void> {
  await tx.unsafe('alter table app.facility_agreement disable trigger trg_facility_agreement_project');
  await tx.unsafe('delete from app.facility_agreement');
}

/** Unlists every facility, so a first apply of 021 is admitted (the hosted shape). */
async function unlistAll(tx: TransactionSql): Promise<void> {
  await tx.unsafe('update app.facility set listed_at = null where listed_at is not null');
}

/** The body between `AS $FN$` and `$FN$;` of one function, as a file writes it. */
function bodyFrom(file: string, fn: string): string {
  const text = readFileSync(join(MIG_DIR, file), 'utf8');
  const m = new RegExp(`^CREATE OR REPLACE FUNCTION ${fn.replace('.', '\\.')}\\([\\s\\S]*?AS \\$FN\\$([\\s\\S]*?)^\\$FN\\$;$`, 'm').exec(text);
  if (m === null) throw new Error(`no body for ${fn} in ${file}`);
  return m[1] ?? '';
}

const ADDED = ['app.bump_row_version', 'public.operator_get_contact', 'public.operator_record_agreement', 'public.operator_record_contact', 'public.operator_register'];
const DROPPED = ['public.operator_list_facilities'];

interface State {
  listed: string;
  begin: string;
  project: string;
  rollup: string;
  agreementTable: boolean;
  contactColumns: string[];
  trigger: number;
  projectTrigger: number;
  functions: string[];
  ledger: number;
}

async function state(tx: TransactionSql): Promise<State> {
  const src = async (sig: string): Promise<string> =>
    (await tx.unsafe<{ src: string }[]>('select prosrc as src from pg_proc where oid = to_regprocedure($1)', [sig] as never[]))[0]?.src ?? '';
  const l = { src: await src('public.operator_set_facility_listed(text, integer)') };
  const b = { src: await src('app.provision_begin(uuid, text, text)') };
  const p = { src: await src('app.project_facility(uuid)') };
  const r = { src: await src('app.refresh_lga_rollup()') };
  const [t] = await tx.unsafe<{ r: string | null }[]>(`select to_regclass('app.facility_agreement')::text as r`);
  const cols = await tx.unsafe<{ c: string }[]>(`
    select column_name as c from information_schema.columns
     where table_schema = 'app' and table_name = 'facility_contact' and column_name in ('agreement_accepted_at', 'version') order by 1`);
  const [tr] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from pg_trigger where tgname = 'trg_facility_contact_version' and not tgisinternal`);
  const [pt] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from pg_trigger where tgname = 'trg_facility_agreement_project' and not tgisinternal`);
  const fns = await tx.unsafe<{ f: string }[]>(`
    select distinct n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname || '.' || p.proname = any($1) order by 1`, [[...ADDED, ...DROPPED]] as never[]);
  const [g] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.schema_migrations where filename = $1', [LEDGER] as never[]);
  return {
    listed: l?.src ?? '', begin: b?.src ?? '', project: p?.src ?? '', rollup: r?.src ?? '',
    agreementTable: t?.r !== null, contactColumns: cols.map((c) => c.c),
    trigger: tr?.n ?? -1, projectTrigger: pt?.n ?? -1, functions: fns.map((f) => f.f), ledger: g?.n ?? -1,
  };
}

const F020 = '020_operator_functions_and_listing.sql';
const F021 = '021_facility_agreement_and_contact_write.sql';
const STATE_021: State = {
  listed: bodyFrom(F021, 'public.operator_set_facility_listed'),
  begin: bodyFrom(F021, 'app.provision_begin'),
  project: bodyFrom(F021, 'app.project_facility'),
  rollup: bodyFrom(F021, 'app.refresh_lga_rollup'),
  agreementTable: true,
  contactColumns: ['version'],
  trigger: 1,
  projectTrigger: 1,
  functions: [...ADDED].sort(),
  ledger: 1,
};
const STATE_020: State = {
  listed: bodyFrom(F020, 'public.operator_set_facility_listed'),
  begin: bodyFrom(F020, 'app.provision_begin'),
  project: bodyFrom(F020, 'app.project_facility'),
  rollup: bodyFrom(F020, 'app.refresh_lga_rollup'),
  agreementTable: false,
  contactColumns: ['agreement_accepted_at'],
  trigger: 0,
  projectTrigger: 0,
  functions: [...DROPPED],
  ledger: 0,
};

/** The public output as stored: both mirrors and the rollup table, updated_at included. */
async function publicOutput(tx: TransactionSql): Promise<{ f: unknown[]; w: unknown[]; r: unknown[] }> {
  const f = await tx.unsafe('select * from public.facility_public order by facility_id');
  const w = await tx.unsafe('select * from public.ward_public order by facility_id, category');
  const r = await tx.unsafe('select * from public.lga_rollup order by state, lga, category');
  return { f: [...f], w: [...w], r: [...r] };
}

/** The cells a refresh computes now, against the live body. updated_at is now() and left out. */
async function refreshedCells(tx: TransactionSql): Promise<unknown[]> {
  await tx.unsafe('select app.refresh_lga_rollup()');
  return [...(await tx.unsafe('select state, lga, category, facility_count, total_beds from public.lga_rollup order by state, lga, category'))];
}

/** 021's agreement predicate (BJ-1, positive by BK-1), inserted after the line it follows in 020's body. */
const ACTIVE = 'AND EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = f.id AND a.withdrawn_on IS NULL)';
function predicateAdd(body: string, after: string, ind: string): string {
  expect(body.split(after).length - 1, `020's line "${after.trim()}" is not in the body exactly once`).toBe(1);
  return body.replace(after, `${after}${ind}${ACTIVE}\n`);
}

/** 020's agreement check, and what 021 puts in its place, at one indentation. */
function agreementSwap(body: string, v: string, ind: string): string {
  const old =
    `${ind}IF NOT EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = ${v} AND c.agreement_accepted_at IS NOT NULL) THEN\n` +
    `${ind}    RAISE EXCEPTION 'AGREEMENT_NOT_RECORDED';\n${ind}END IF;\n`;
  const replacement =
    `${ind}IF NOT EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = ${v}) THEN\n` +
    `${ind}    RAISE EXCEPTION 'AGREEMENT_NOT_RECORDED';\n${ind}END IF;\n` +
    `${ind}IF EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = ${v} AND a.withdrawn_on IS NOT NULL) THEN\n` +
    `${ind}    RAISE EXCEPTION 'AGREEMENT_WITHDRAWN';\n${ind}END IF;\n`;
  expect(body.split(old).length - 1, `020's agreement check is not in the body exactly once (${v})`).toBe(1);
  return body.replace(old, replacement);
}

describe('migration 021 round trip', () => {
  test('the database starts in the 021 state, and the bodies discriminate', async () => {
    expect(STATE_020.listed).not.toBe(STATE_021.listed);
    expect(STATE_020.begin).not.toBe(STATE_021.begin);
    expect(await inTx(state)).toEqual(STATE_021);
  });

  test("the two public-membership bodies are 020's with only the agreement predicate added (BJ-1, BK-1)", () => {
    expect(predicateAdd(STATE_020.project, '           AND f.listed_at IS NOT NULL\n', '           '), 'project_facility moved beyond its agreement predicate').toBe(STATE_021.project);
    expect(predicateAdd(STATE_020.rollup, '           AND f.listed_at IS NOT NULL\n', '           '), 'refresh_lga_rollup moved beyond its agreement predicate').toBe(STATE_021.rollup);
  });

  test("the restated gates are 020's bodies with the agreement check replaced, and nothing else", () => {
    expect(agreementSwap(STATE_020.listed, 'v_id', '    '), 'operator_set_facility_listed moved beyond its agreement check').toBe(STATE_021.listed);
    expect(agreementSwap(STATE_020.begin, 'p_facility', '        '), 'provision_begin moved beyond its agreement check').toBe(STATE_021.begin);
  });

  test("down restores EXACTLY the 020 state — 020's gates and list, the contact's column, no agreement table, no ledger row", async () => {
    const s = await inTx(async (tx) => {
      await clearAgreements(tx);
      await apply(tx, DOWN);
      return state(tx);
    });
    expect(s, 'the reversal did not land on 020 exactly').toEqual(STATE_020);
  });

  test('the down writes NO public row — over the seed\'s published state, not even updated_at', async () => {
    const r = await inTx(async (tx) => {
      await clearAgreements(tx);
      const before = await publicOutput(tx);
      await apply(tx, DOWN);
      return { before, after: await publicOutput(tx) };
    });
    expect(r.before.f.length, 'the seed projected no facility, so this leg would pass vacuously').toBeGreaterThan(0);
    expect(r.before.r.length, 'the seed holds no rollup cell, so the rollup half would pass vacuously').toBeGreaterThan(0);
    expect(r.after, 'the down changed the public output').toEqual(r.before);
  });

  test('a re-apply over the seeded 021 state changes NO public row, and recomputes the same cells', async () => {
    const r = await inTx(async (tx) => {
      const before = await publicOutput(tx);
      const cellsBefore = await refreshedCells(tx);
      const stored = await publicOutput(tx);
      await apply(tx, FORWARD);
      return { before, stored, after: await publicOutput(tx), cellsBefore, cellsAfter: await refreshedCells(tx) };
    });
    expect(r.before.f.length, 'the seed projected no facility, so this leg would pass vacuously').toBeGreaterThan(0);
    expect(r.cellsBefore.length, 'the seed forms no rollup cell, so the rollup half would pass vacuously').toBeGreaterThan(0);
    expect(r.after, 'a re-apply of 021 changed the public output').toEqual(r.stored);
    expect(r.cellsAfter, 'a re-apply of 021 changed the cells a refresh computes').toEqual(r.cellsBefore);
  });

  test('B1 by construction — where 021 can first apply, no facility is listed, so nothing is public before or after', async () => {
    const r = await inTx(async (tx) => {
      await clearAgreements(tx);
      await apply(tx, DOWN);
      await unlistAll(tx);
      // Refreshed first: the stored rollup still holds the seed's cell until its next
      // refresh (every five minutes), and the shape's public output is what a refresh makes.
      const cells = await refreshedCells(tx);
      const before = { cells, out: await publicOutput(tx) };
      await apply(tx, FORWARD);
      const cellsAfter = await refreshedCells(tx);
      return { before, after: { cells: cellsAfter, out: await publicOutput(tx) } };
    });
    expect(r.after, 'applying 021 changed the public output').toEqual(r.before);
    expect(r.before.out, 'the first-apply shape is not the empty one this leg claims').toEqual({ f: [], w: [], r: [] });
    expect(r.before.cells).toEqual([]);
    expect(r.after.cells).toEqual([]);
  });

  test('up after down restores EXACTLY the 021 state, and a re-apply changes nothing', async () => {
    const s = await inTx(async (tx) => {
      await clearAgreements(tx);
      await apply(tx, DOWN);
      await unlistAll(tx);
      await apply(tx, FORWARD);
      await apply(tx, FORWARD);
      return state(tx);
    });
    expect(s).toEqual(STATE_021);
  });

  test('the forward REFUSES over a listed facility with no agreement row, naming the count — it never invents one (BK-1 b)', async () => {
    const r = await inTx(async (tx) => {
      await clearAgreements(tx);
      await apply(tx, DOWN);
      const [n] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.facility where listed_at is not null');
      const refused = await refusal(tx, FORWARD);
      return { n: n?.n ?? 0, refused, table: (await state(tx)).agreementTable };
    });
    expect(r.n, 'the seed lists no facility, so this plant has nothing to refuse').toBeGreaterThan(0);
    expect(r.refused.message).toBe('LISTED_WITHOUT_AGREEMENT');
    expect(r.refused.detail, 'the refusal does not name the count').toContain(`${r.n} listed facility row(s)`);
    expect(r.table, 'the refused forward left part of itself behind').toBe(false);
  });

  test('the forward REFUSES over a contact row carrying an agreement — it never invents a version', async () => {
    const r = await inTx(async (tx) => {
      await clearAgreements(tx);
      await apply(tx, DOWN);
      await unlistAll(tx);
      const [fac] = await tx.unsafe<{ id: string }[]>('select id from app.facility order by id limit 1');
      await tx.unsafe(`insert into app.facility_contact (facility_id, full_name, job_title, email, agreement_accepted_at)
                       values ('${fac!.id}', 'Plant Person', 'Matron', 'plant@example.invalid', now())`);
      const refused = await refusal(tx, FORWARD);
      return { refused, table: (await state(tx)).agreementTable };
    });
    expect(r.refused.message).toBe('AGREEMENT_ON_CONTACT_ROWS');
    expect(r.table, 'the refused forward left part of itself behind').toBe(false);
  });

  test("the down REFUSES while an agreement row exists — over the seed's own agreements, it never loses one", async () => {
    const r = await inTx(async (tx) => {
      const [n] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.facility_agreement');
      const refused = await refusal(tx, DOWN);
      return { n: n?.n ?? 0, refused, s: await state(tx) };
    });
    expect(r.n, 'the seed holds no agreement, so this leg refuses nothing').toBeGreaterThan(0);
    expect(r.refused.message).toBe('AGREEMENTS_RECORDED');
    expect(r.s, 'the refused reversal changed the schema').toEqual(STATE_021);
  });

  test.each([
    ['a reversal that keeps the agreement table', 'DROP TABLE IF EXISTS app.facility_agreement RESTRICT;\n', ''],
    ["a reversal that leaves 021's listing gate", "CREATE OR REPLACE FUNCTION public.operator_set_facility_listed(", 'CREATE OR REPLACE FUNCTION public.zz_not_the_gate('],
  ])('plant — %s is rejected by the exact-state assertion', async (_name, needle, replacement) => {
    const original = readFileSync(DOWN, 'utf8');
    expect(original, `the plant's target is not in the down file: ${needle}`).toContain(needle);
    const tampered = original.replace(needle, replacement);
    const s = await inTx(async (tx) => {
      await clearAgreements(tx);
      await apply(tx, DOWN, tampered);
      return state(tx);
    });
    expect(s, 'the tampered reversal still produced the 020 state — the plant did not reach an executed statement').not.toEqual(STATE_020);
  });
});
