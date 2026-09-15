import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * THE PROJECTION TRIGGERS ARE ENABLED, AND NOT DEFERRED (condition F).
 *
 * Every public_* field publish_ward_status (014) returns is read back from
 * public.ward_public inside the write transaction. That is correct only because
 * the 008 projection triggers are ordinary AFTER ... FOR EACH ROW triggers: they
 * run when the UPDATE statement finishes, before the function's next statement.
 * Deferred to commit, the read-back would return the PREVIOUS projection; disabled,
 * it would return a projection that never moves. Either would look like a working
 * response. tests/db/projection_ward_public.test.ts asserts the triggers EXIST;
 * this file asserts the two properties the read-back depends on, in the shape of
 * config_drift's tgenabled check.
 *
 * WHY 'O' AND NOT 'A'. tgenabled 'O' fires in normal operation and is suppressed
 * under session_replication_role = replica. The append-only guards are 'A' so a
 * restore cannot bypass them; the projection is deliberately 'O', and
 * tests/e2e/_harness.ts relies on that to restore the E2E baseline without
 * re-stamping updated_at. A change to 'A' here is a design change, and this test
 * says so by failing.
 *
 * Plants are applied inside a rolled-back transaction, so the real triggers are
 * never touched.
 */

const EXPECTED = ['trg_facility_ops_project', 'trg_facility_project', 'trg_ward_status_project'];

/** Every way the three projection triggers can stop supporting a same-transaction read-back. */
async function projectionTriggerViolations(tx: TransactionSql): Promise<string[]> {
  const rows = await tx.unsafe<
    { tgname: string; enabled: string; deferrable: boolean; initdeferred: boolean; is_constraint: boolean; row_level: boolean; after: boolean }[]
  >(`
    select t.tgname,
           t.tgenabled::text        as enabled,
           t.tgdeferrable           as deferrable,
           t.tginitdeferred         as initdeferred,
           (t.tgconstraint <> 0)    as is_constraint,
           (t.tgtype & 1) = 1       as row_level,
           (t.tgtype & 66) = 0      as after
      from pg_trigger t
     where not t.tgisinternal
       and t.tgname = any ($1)
     order by t.tgname
  `, [EXPECTED] as never[]);
  const out: string[] = [];
  const found = rows.map((r) => r.tgname);
  for (const name of EXPECTED) if (!found.includes(name)) out.push(`${name} is missing`);
  for (const r of rows) {
    if (r.enabled !== 'O') out.push(`${r.tgname} is not enabled for normal operation (tgenabled=${r.enabled})`);
    if (r.deferrable) out.push(`${r.tgname} is deferrable`);
    if (r.initdeferred) out.push(`${r.tgname} is initially deferred`);
    if (r.is_constraint) out.push(`${r.tgname} is a constraint trigger`);
    if (!r.row_level) out.push(`${r.tgname} is not FOR EACH ROW`);
    if (!r.after) out.push(`${r.tgname} is not an AFTER trigger`);
  }
  return out;
}

describe('projection trigger state — condition F', () => {
  test('the three projection triggers are enabled, AFTER ROW, not deferrable and not constraint triggers', async () => {
    const violations = await withRole('postgres', null, (tx) => projectionTriggerViolations(tx));
    expect(violations, 'the same-transaction read-back of public_* is no longer guaranteed').toEqual([]);
  });

  test('plant — a disabled projection trigger is caught', async () => {
    const violations = await withRole('postgres', null, (tx) => projectionTriggerViolations(tx), async (tx) => {
      await tx.unsafe('alter table app.ward_status disable trigger trg_ward_status_project');
    });
    expect(violations).toContain('trg_ward_status_project is not enabled for normal operation (tgenabled=D)');
  });

  test('plant — a deferrable projection trigger is caught', async () => {
    const violations = await withRole('postgres', null, (tx) => projectionTriggerViolations(tx), async (tx) => {
      await tx.unsafe('drop trigger trg_facility_project on app.facility');
      await tx.unsafe(`
        create constraint trigger trg_facility_project
          after insert or update or delete on app.facility
          deferrable initially deferred
          for each row execute function app.trg_project()
      `);
    });
    expect(violations).toContain('trg_facility_project is deferrable');
    expect(violations).toContain('trg_facility_project is initially deferred');
  });
});
