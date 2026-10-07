import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { sql, withRole } from '../setup/db.js';

/**
 * APPEND-ONLY ENFORCEMENT on app.ward_status_event and app.audit_log.
 *
 * These two tables ARE the operational safety record. A correction is an
 * appended superseding row, never an edit.
 *
 * TWO INDEPENDENT LAYERS, ASSERTED SEPARATELY because they fail separately:
 *   - grants (no UPDATE/DELETE for any client role, including service_role), and
 *   - a BEFORE UPDATE OR DELETE trigger that raises unconditionally.
 * Grants alone do not stop a maintenance script running as service_role, which is
 * the realistic threat here -- far likelier than a hostile client.
 *
 * TRUNCATE is a statement, not a row, so the row-level trigger never sees it. Migration 030
 * (R-2026-09-30-205 GE) adds a statement-level BEFORE TRUNCATE trigger to each table; the last
 * describe block in this file holds those legs, layer by layer: the owner is stopped by the
 * trigger (APPEND_ONLY_VIOLATION), a client role by the grant (42501), and the trigger is
 * shown to stop a client role that were ever granted TRUNCATE.
 *
 * NOT ASSERTED HERE, AND THIS MATTERS -- read before trusting a green run.
 *
 * CORRECTED 2026-09-15. This header said Supabase's `postgres` role "IS a
 * superuser on a LOCAL stack and is NOT on a hosted project". Observed, it is
 * superuser on neither: `rolsuper f`, `rolbypassrls t` locally (Supabase CLI
 * 2.117.0, PostgreSQL 17.6) and on hosted `klrlpxysjsjpdkeqdhvl` (read-only, by
 * Cowork). The role graphs match on those attributes. So:
 *   - The trigger assertions below are meaningful: a trigger fires regardless of
 *     the role's attributes, which the `postgres` run demonstrates directly.
 *   - The GRANT assertions describe the local role graph. It matches hosted on
 *     rolsuper and rolbypassrls; per-object grants hosted are still observed by
 *     hand, not by this suite.
 * The hosted behaviour is a HAND CHECK in
 * docs/runbook-supabase-project-creation.md. Do not add a test that claims to
 * verify it -- this suite cannot reach a hosted project, and a test that appeared
 * to would be worse than the gap it pretended to close.
 */
describe('append-only enforcement', () => {
  // 029 (GA) adds app.facility_reporting_approval: append-only by 010's pattern, with the
  // owner's TRUNCATE stopped as well (tests/db/reporting_approval.test.ts holds those legs).
  const TABLES = ['ward_status_event', 'audit_log', 'facility_reporting_approval'] as const;

  test('UPDATE on app.ward_status_event raises APPEND_ONLY_VIOLATION, even as the table owner postgres', async () => {
    await expect(
      withRole('postgres', null, async (tx) => {
        await tx.unsafe(`
          insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164)
          values ('cccccccc-0000-4000-8000-000000000001','AO Test','Ikeja','Lagos',6.6,3.35,'+2348000000099')
        `);
        await tx.unsafe(`
          insert into app.ward_status (id, facility_id, category, offering, bed_count, accepting)
          values ('cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000001','ICU_ADULT','OFFERED',1,true)
        `);
        await tx.unsafe(`
          insert into app.ward_status_event
            (ward_status_id, facility_id, category, offering, bed_count, accepting, state, source, version)
          values ('cccccccc-0000-4000-8000-000000000002','cccccccc-0000-4000-8000-000000000001',
                  'ICU_ADULT','OFFERED',1,true,'OK','WARD',1)
        `);
        // The act under test.
        await tx.unsafe(`update app.ward_status_event set bed_count = 99`);
      }),
    ).rejects.toThrow(/APPEND_ONLY_VIOLATION/);
  });

  test('DELETE on app.audit_log raises APPEND_ONLY_VIOLATION, even as the table owner postgres', async () => {
    await expect(
      withRole('postgres', null, async (tx) => {
        await tx.unsafe(`insert into app.audit_log (action) values ('test.append_only')`);
        await tx.unsafe(`delete from app.audit_log`);
      }),
    ).rejects.toThrow(/APPEND_ONLY_VIOLATION/);
  });

  test('INSERT still works — the guard is not simply making the tables read-only', async () => {
    // The positive control. Without it, a trigger that raised on every operation
    // would satisfy every assertion above while breaking the entire write path.
    const inserted = await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`insert into app.audit_log (action) values ('test.positive_control')`);
      const rows = await tx.unsafe<{ n: number }[]>(
        `select count(*)::int as n from app.audit_log where action = 'test.positive_control'`,
      );
      return rows[0]?.n ?? 0;
    });
    expect(inserted).toBe(1);
  });

  /**
   * Scoped to CLIENT roles, and the exclusion is deliberate rather than a
   * convenience.
   *
   * The table OWNER always holds implicit full privileges on its own tables, and
   * revoking them is not durable -- an owner can re-grant to itself at any time.
   * Asserting the owner holds no UPDATE would be asserting something that cannot
   * be made true, and "fixing" the schema to satisfy it would achieve nothing.
   *
   * The owner is constrained by the TRIGGER instead, which is exactly what the
   * first two tests in this file demonstrate: the UPDATE and DELETE attempts
   * above run as `postgres`, the owner -- not a superuser, locally or hosted
   * (observed 2026-09-15), but holding every privilege the grant layer does not
   * revoke from it -- and they still raise. That is the assertion that covers the owner. This one covers
   * everybody else.
   */
  test.each(TABLES)('no client role holds UPDATE or DELETE on app.%s', async (table) => {
    const rows = await sql()<{ grantee: string; privilege_type: string }[]>`
      select grantee, privilege_type
        from information_schema.table_privileges
       where table_schema = 'app'
         and table_name = ${table}
         and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
         and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
    `;
    expect(rows.map((r) => `${r.grantee}:${r.privilege_type}`)).toEqual([]);
  });

  test('the owner is the ONLY role holding UPDATE/DELETE — nothing else crept in', async () => {
    // The complement of the test above, so that the exclusion cannot quietly
    // grow. If a fourth role ever appears here, this fails and names it.
    const rows = await sql()<{ grantee: string }[]>`
      select distinct grantee
        from information_schema.table_privileges
       where table_schema = 'app'
         and table_name in ('ward_status_event', 'audit_log', 'facility_reporting_approval')
         and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
       order by grantee
    `;
    const [owner] = await sql()<{ owner: string }[]>`
      select tableowner as owner from pg_tables where schemaname = 'app' and tablename = 'audit_log'
    `;
    expect(rows.map((r) => r.grantee)).toEqual([owner?.owner]);
  });
});

/**
 * TRUNCATE on the two tables of 010, stopped at the statement (migration 030; 029 did the same
 * for its own table, tests/db/reporting_approval.test.ts).
 *
 * LAYER BY LAYER, because the two layers refuse with different errors and a test that accepted
 * either would not know which one was holding:
 *   - the OWNER holds TRUNCATE implicitly; only the statement-level trigger stops it, with
 *     APPEND_ONLY_VIOLATION naming the table;
 *   - a CLIENT role is refused earlier, by the privilege check (SQLSTATE 42501), because 010
 *     revoked TRUNCATE from it and PostgreSQL checks privileges before it fires a BEFORE trigger.
 *     So "APPEND_ONLY_VIOLATION for each client role" is not what an ungranted role sees;
 *   - the trigger is then shown to refuse a client role GRANTED TRUNCATE (the grant is made inside
 *     the transaction, before the role switch, and rolled back with it), so the second layer is
 *     proven on its own and not inferred from the first.
 *
 * TRUNCATE ... CASCADE from app.facility reaches both tables through their foreign keys, and
 * BEFORE TRUNCATE triggers fire for the cascaded tables too: asserted below.
 */
const TRUNCATE_TARGETS = ['audit_log', 'ward_status_event'] as const;
const CLIENT_ROLES = ['anon', 'authenticated', 'service_role'] as const;

async function fixtureRows(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`insert into app.audit_log (action) values ('test.truncate_guard')`);
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164)
    values ('cccccccc-0000-4000-8000-000000000011','TG Test','Ikeja','Lagos',6.6,3.35,'+2348000000098')`);
  await tx.unsafe(`
    insert into app.ward_status (id, facility_id, category, offering, bed_count, accepting)
    values ('cccccccc-0000-4000-8000-000000000012','cccccccc-0000-4000-8000-000000000011','ICU_ADULT','OFFERED',1,true)`);
  await tx.unsafe(`
    insert into app.ward_status_event
      (ward_status_id, facility_id, category, offering, bed_count, accepting, state, source, version)
    values ('cccccccc-0000-4000-8000-000000000012','cccccccc-0000-4000-8000-000000000011',
            'ICU_ADULT','OFFERED',1,true,'OK','WARD',1)`);
}

describe('TRUNCATE on the two append-only tables of 010 is refused', () => {
  test.each(TRUNCATE_TARGETS)(
    'owner (postgres) truncate of app.%s rejected with APPEND_ONLY_VIOLATION naming the table',
    async (table) => {
      await expect(
        withRole('postgres', null, (tx) => tx.unsafe(`truncate app.${table}`), fixtureRows),
      ).rejects.toThrow(new RegExp(`APPEND_ONLY_VIOLATION: TRUNCATE on app\\.${table} is not permitted`));
    },
  );

  test.each(TRUNCATE_TARGETS)('owner truncate of app.%s leaves every row in place', async (table) => {
    const out = await withRole(
      'postgres',
      null,
      async (tx) => {
        const [before] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.${table}`);
        let refused = false;
        try {
          await tx.savepoint((sp) => sp.unsafe(`truncate app.${table}`));
        } catch {
          refused = true;
        }
        const [after] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.${table}`);
        return { before: before?.n ?? -1, after: after?.n ?? -2, refused };
      },
      fixtureRows,
    );
    expect(out.refused, 'the truncate was not refused').toBe(true);
    expect(out.before, 'the fixture left the table empty: this leg would pass on an empty table').toBeGreaterThan(0);
    expect(out.after).toBe(out.before);
  });

  test.each(TRUNCATE_TARGETS.flatMap((t) => CLIENT_ROLES.map((r) => [r, t] as const)))(
    '%s truncate of app.%s rejected with 42501, by the grant layer',
    async (role, table) => {
      await expect(
        withRole(role, null, (tx) => tx.unsafe(`truncate app.${table}`), fixtureRows),
      ).rejects.toMatchObject({ code: '42501' });
    },
  );

  test.each(TRUNCATE_TARGETS.flatMap((t) => CLIENT_ROLES.map((r) => [r, t] as const)))(
    '%s, even if granted TRUNCATE on app.%s, is rejected by the trigger with APPEND_ONLY_VIOLATION',
    async (role, table) => {
      await expect(
        withRole(role, null, (tx) => tx.unsafe(`truncate app.${table}`), async (tx) => {
          await fixtureRows(tx);
          await tx.unsafe(`grant usage on schema app to ${role}`);
          await tx.unsafe(`grant truncate on app.${table} to ${role}`);
        }),
      ).rejects.toThrow(new RegExp(`APPEND_ONLY_VIOLATION: TRUNCATE on app\\.${table} is not permitted`));
    },
  );

  test('owner truncate of app.facility CASCADE is rejected naming one of the two tables: the cascade reaches them', async () => {
    // 029's table also references app.facility and carries its own TRUNCATE trigger, which
    // could fire first and satisfy a looser match. Its trigger is disabled inside this
    // rolled-back transaction, so only 010's two tables can be the ones that refuse.
    await expect(
      withRole('postgres', null, (tx) => tx.unsafe(`truncate app.facility cascade`), async (tx) => {
        await fixtureRows(tx);
        await tx.unsafe(`alter table app.facility_reporting_approval disable trigger trg_facility_reporting_approval_no_truncate`);
      }),
    ).rejects.toThrow(/APPEND_ONLY_VIOLATION: TRUNCATE on app\.(audit_log|ward_status_event) is not permitted/);
  });

  test('positive control — an INSERT by the owner still works after 030, so the refusals above are not an always-raising trigger', async () => {
    const n = await withRole(
      'postgres',
      null,
      async (tx) => {
        const [c] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.audit_log where action = 'test.truncate_guard'`);
        return c?.n;
      },
      fixtureRows,
    );
    expect(n).toBe(1);
  });
});
