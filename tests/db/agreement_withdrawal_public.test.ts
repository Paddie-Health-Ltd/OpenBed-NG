import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * PUBLIC REQUIRES AN ACTIVE AGREEMENT, AND A WITHDRAWAL TAKES A FACILITY OFF THE
 * PUBLIC OUTPUT BY ITSELF (R-2026-09-24-82 BJ-1, made positive by R-2026-09-24-83
 * BK-1; migration 021).
 *
 * The data-sharing agreement is the basis for publishing a facility's data. So a
 * facility is public only if it is listed, active, not quiet AND has an agreement
 * that is not withdrawn. Setting app.facility_agreement.withdrawn_on is enough to
 * take it off: the mirrors drop it in the same transaction, and the rollup stops
 * counting it at its next refresh. A listed facility with no agreement row is not
 * public at all.
 *
 * THE SITES, enumerated from the live catalogue on 2026-09-24 (every function in app,
 * public and graphql_public whose source reads listed_at or names a mirror; no view
 * and no materialized view exists). Exactly two decide which facilities reach public
 * output, and both require `EXISTS (an agreement with withdrawn_on IS NULL)`:
 *   - app.project_facility(): the only writer of public.facility_public and
 *     public.ward_public;
 *   - app.refresh_lga_rollup(): the only writer of public.lga_rollup.
 * app.regenerate_snapshot() and publish_ward_status read the mirrors only, so they
 * inherit the first. operator_create_facility, operator_register and
 * operator_set_facility_listed read listed_at for the operator, not for the public.
 *
 * THE MIRRORS MOVE IN THE SAME TRANSACTION because 021 puts a trigger on
 * app.facility_agreement that calls 008's app.trg_project() -- the same projection
 * path the other three tables use, not a second one. No leg here calls
 * app.project_facility() itself after the withdrawal.
 *
 * THE ROLLUP LEGS USE THE K-FLOOR, as tests/db/facility_listing.test.ts does. Four
 * listed quiet peers and the facility under test share one LGA, so the cell clears
 * k=5 only while the facility under test is counted.
 *
 * WHY POSITIVE (BK-1): IT FAILS CLOSED. app.facility_agreement has RLS enabled and
 * forced with no policy, so any reader without BYPASSRLS sees it EMPTY. BJ's
 * `NOT EXISTS (a withdrawn agreement)` read "empty" as "nothing withdrawn" and
 * decided to publish. The positive predicate reads "empty" as "no agreement" and
 * decides not to. The fails-closed legs below run each body under a stand-in owner
 * without BYPASSRLS and assert the DECISION: the positive body writes nothing, and
 * the BJ body attempts the write.
 *
 * OBSERVED WHILE WRITING THEM, and stated because it bounds the claim: today the BJ
 * body's attempt is stopped by the MIRRORS' own RLS (facility_public, ward_public and
 * lga_rollup are forced, with no policy for their writer), so it RAISES rather than
 * publishing. The fail-open was real in the predicate and did not reach public output
 * on this schema. The positive predicate does not rely on that second layer.
 *
 * EACH SITE IS PLANTED AWAY IN TURN, from 021's own text, inside a rolled-back
 * transaction, and the leak must appear. So is the trigger. Each plant first confirms
 * its needle was in the statement, so a plant that changed nothing cannot pass as a
 * guard with a hole.
 *
 * NOT ASSERTED HERE, deliberately: how long the page takes to follow. The mirrors move
 * at once; the snapshot (every minute), the edge cache and the page's poll add about
 * two minutes (020's B2). That path is outside the database and is read back with
 * /beds.json in the withdrawal step, not here.
 */

const MIG = join(import.meta.dirname, '..', '..', 'database', 'migrations', '021_facility_agreement_and_contact_write.sql');
const LGA = 'Withdrawal-Under-Test';
const FAC = 'eeeeeeee-0000-4000-8000-000000000021';
const PEERS = [1, 2, 3, 4].map((n) => `eeeeeeee-0000-4000-8000-00000000003${n}`);
const PREDICATE = 'AND EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = f.id AND a.withdrawn_on IS NULL)';
/** BJ's predicate (R-2026-09-24-82), superseded by BK-1: the fail-open counter-plant. */
const BJ_PREDICATE = 'AND NOT EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = f.id AND a.withdrawn_on IS NOT NULL)';
const WITHDRAW = `update app.facility_agreement set withdrawn_on = '2026-09-10' where facility_id = '${FAC}'`;

/** The complete CREATE OR REPLACE statement for one function, as 021 writes it. */
function statementFor(fn: string): string {
  const text = readFileSync(MIG, 'utf8');
  const m = new RegExp(`^CREATE OR REPLACE FUNCTION ${fn.replace('.', '\\.')}\\([\\s\\S]*?^\\$FN\\$;$`, 'm').exec(text);
  if (m === null) throw new Error(`021 carries no CREATE OR REPLACE for ${fn}`);
  return m[0];
}

/** 021's statement for `fn` with its predicate swapped, after confirming the needle was there. */
function withPredicate(fn: string, replacement: string): string {
  const statement = statementFor(fn);
  expect(statement, `the predicate is not in 021's ${fn}, so this plant would change nothing`).toContain(PREDICATE);
  const planted = statement.replace(PREDICATE, replacement);
  expect(planted).not.toBe(statement);
  return planted;
}

/**
 * Four listed quiet peers, each with an agreement, and the facility under test,
 * listed, with an agreement unless `agreement` is false.
 */
async function seed(tx: TransactionSql, quiet: boolean, agreement = true): Promise<void> {
  for (const [i, id] of PEERS.entries()) {
    await tx.unsafe(`
      insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, quiet_mode, listed_at)
      values ('${id}', 'Peer ${i + 1}', '${LGA}', 'Lagos', 6.5, 3.4, '+23480000003${i}0', true, now())`);
    await tx.unsafe(`insert into app.ward_status (facility_id, category, offering, bed_count) values ('${id}', 'ICU_ADULT', 'OFFERED', 2)`);
    await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${id}', '2026-09-01', 'v1.0')`);
  }
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, quiet_mode, listed_at)
    values ('${FAC}', 'Under Test', '${LGA}', 'Lagos', 6.5, 3.4, '+2348000000210', ${quiet}, now())`);
  await tx.unsafe(`insert into app.ward_status (facility_id, category, offering, bed_count) values ('${FAC}', 'ICU_ADULT', 'OFFERED', 2)`);
  if (agreement) {
    await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${FAC}', '2026-09-01', 'v1.0')`);
  }
}

/** The mirror rows for the facility under test, read as they stand: nothing re-projects here. */
async function mirrorRows(tx: TransactionSql): Promise<{ facility: number; ward: number }> {
  const [f] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from public.facility_public where facility_id = '${FAC}'`);
  const [w] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from public.ward_public where facility_id = '${FAC}'`);
  return { facility: f?.n ?? -1, ward: w?.n ?? -1 };
}

/** The test LGA's rollup cells after a refresh. */
async function rollupCells(tx: TransactionSql): Promise<number[]> {
  await tx.unsafe('select app.refresh_lga_rollup()');
  const rows = await tx.unsafe<{ facility_count: number }[]>(`select facility_count from public.lga_rollup where lga = '${LGA}'`);
  return rows.map((r) => r.facility_count);
}

/** A caught error's message, or null when the call returned. Used inside a savepoint. */
async function outcome(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { message: string }).message;
  }
}

/**
 * Makes a fresh role WITHOUT BYPASSRLS the owner of `fn`, with every grant the body
 * needs, so what stops it is row-level security and never a missing privilege. Must
 * run as postgres inside the rolled-back transaction, after any CREATE OR REPLACE.
 */
async function nonBypassOwner(tx: TransactionSql, fn: string): Promise<void> {
  await tx.unsafe('create role zz_agreement_nobypass nologin nobypassrls');
  await tx.unsafe('grant zz_agreement_nobypass to postgres');
  await tx.unsafe('grant usage on schema app, public to zz_agreement_nobypass');
  await tx.unsafe('grant create on schema app to zz_agreement_nobypass');
  await tx.unsafe('grant select on app.facility, app.ward_status, app.facility_ops, app.facility_agreement to zz_agreement_nobypass');
  await tx.unsafe('grant execute on all functions in schema app to zz_agreement_nobypass');
  await tx.unsafe('grant select, insert, update, delete on public.facility_public, public.ward_public, public.lga_rollup to zz_agreement_nobypass');
  await tx.unsafe(`alter function ${fn} owner to zz_agreement_nobypass`);
}

describe('public requires an active agreement, and a withdrawal removes it', () => {
  test('mirrors — a listed facility with a published ward is public, and the withdrawal UPDATE alone removes it in the same transaction', async () => {
    await withRole('postgres', null, async (tx) => {
      expect(await mirrorRows(tx), 'the facility under test was never public, so its removal would prove nothing').toEqual({ facility: 1, ward: 1 });
      await tx.unsafe(WITHDRAW);
      expect(await mirrorRows(tx), 'a withdrawn agreement left the facility in the public mirrors').toEqual({ facility: 0, ward: 0 });
    }, (tx) => seed(tx, false));
  });

  test('rollup — the facility is the fifth of five, so the cell exists before the withdrawal and not after', async () => {
    await withRole('postgres', null, async (tx) => {
      expect(await rollupCells(tx), 'the positive control: the cell clears k=5 with the facility under test counted').toEqual([5]);
      await tx.unsafe(WITHDRAW);
      expect(await rollupCells(tx), 'a withdrawn facility still counts toward a public rollup cell').toEqual([]);
    }, (tx) => seed(tx, true));
  });

  test('a listed facility with NO agreement row is not public — not in the mirrors, and not counted toward the rollup (BK-1 c i)', async () => {
    await withRole('postgres', null, async (tx) => {
      expect(await mirrorRows(tx), 'a listed facility with no agreement reached the public mirrors').toEqual({ facility: 0, ward: 0 });
    }, (tx) => seed(tx, false, false));
    await withRole('postgres', null, async (tx) => {
      expect(await rollupCells(tx), 'a listed facility with no agreement counted toward a public rollup cell').toEqual([]);
    }, (tx) => seed(tx, true, false));
  });

  test.each([
    ['app.project_facility', false],
    ['app.refresh_lga_rollup', true],
  ] as const)('plant — %s without its agreement predicate leaks the withdrawn facility', async (fn, quiet) => {
    const planted = withPredicate(fn, '');
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(planted);
      await tx.unsafe(WITHDRAW);
      const leaked = quiet ? (await rollupCells(tx)).length : (await mirrorRows(tx)).ward;
      expect(leaked, `${fn} without its predicate did not leak — the plant did not reach the executed path`).toBeGreaterThan(0);
    }, (tx) => seed(tx, quiet));
  });

  test('plant — without the agreement trigger, the withdrawal leaves the mirrors untouched in its transaction', async () => {
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe('drop trigger trg_facility_agreement_project on app.facility_agreement');
      await tx.unsafe(WITHDRAW);
      expect((await mirrorRows(tx)).ward, 'the mirrors moved without the trigger, so the trigger is not what moves them').toBe(1);
    }, (tx) => seed(tx, false));
  });
});

describe('fails closed — under an owner without BYPASSRLS the agreement reads empty, and nothing is published (BK-1 c ii)', () => {
  test("projection — 021's body decides NOT to publish: it completes, and writes no mirror row", async () => {
    const r = await withRole('postgres', null, async (tx) => {
      // Not yet published: the facility, its ward and its ACTIVE agreement exist, and
      // its mirror rows are removed as postgres, so any row afterwards is a new write.
      await tx.unsafe(`delete from public.ward_public where facility_id = '${FAC}'`);
      await tx.unsafe(`delete from public.facility_public where facility_id = '${FAC}'`);
      await nonBypassOwner(tx, 'app.project_facility(uuid)');
      const err = await outcome(tx.savepoint((sp) => sp.unsafe(`select app.project_facility('${FAC}')`)));
      return { err, rows: await mirrorRows(tx) };
    }, (tx) => seed(tx, false));
    expect(r.err, 'the positive body raised, so it attempted a write it should have decided against').toBeNull();
    expect(r.rows, 'the positive body published under an owner that cannot see the agreement').toEqual({ facility: 0, ward: 0 });
  });

  test("counter-plant — BJ's NOT EXISTS body, same owner, same facility, decides TO publish, and only the mirror's own RLS stops it", async () => {
    const planted = withPredicate('app.project_facility', BJ_PREDICATE);
    const r = await withRole('postgres', null, async (tx) => {
      await tx.unsafe(planted);
      await tx.unsafe(`delete from public.ward_public where facility_id = '${FAC}'`);
      await tx.unsafe(`delete from public.facility_public where facility_id = '${FAC}'`);
      await nonBypassOwner(tx, 'app.project_facility(uuid)');
      return outcome(tx.savepoint((sp) => sp.unsafe(`select app.project_facility('${FAC}')`)));
    }, (tx) => seed(tx, false));
    expect(r, 'the BJ body did not attempt the write, so this counter-plant shows nothing').toContain('row-level security');
  });

  test("rollup — 021's body, row_security reset, counts nothing it cannot see: it returns 0 rows and writes no cell", async () => {
    const r = await withRole('postgres', null, async (tx) => {
      await tx.unsafe('alter function app.refresh_lga_rollup() reset row_security');
      await nonBypassOwner(tx, 'app.refresh_lga_rollup()');
      const [ret] = await tx.unsafe<{ n: number }[]>('select app.refresh_lga_rollup() as n');
      const cells = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from public.lga_rollup where lga = '${LGA}'`);
      return { returned: ret?.n, cells: cells[0]?.n };
    }, (tx) => seed(tx, true));
    expect(r, 'the positive rollup body counted facilities whose agreements it cannot see').toEqual({ returned: 0, cells: 0 });
  });

  test("counter-plant — BJ's rollup body, same owner, counts the five and attempts the cell, and only the rollup's own RLS stops it", async () => {
    const planted = withPredicate('app.refresh_lga_rollup', BJ_PREDICATE);
    const r = await withRole('postgres', null, async (tx) => {
      await tx.unsafe(planted);
      await tx.unsafe('alter function app.refresh_lga_rollup() reset row_security');
      await nonBypassOwner(tx, 'app.refresh_lga_rollup()');
      return outcome(tx.savepoint((sp) => sp.unsafe('select app.refresh_lga_rollup()')));
    }, (tx) => seed(tx, true));
    expect(r, 'the BJ rollup body did not attempt the cell, so this counter-plant shows nothing').toContain('row-level security');
  });
});
