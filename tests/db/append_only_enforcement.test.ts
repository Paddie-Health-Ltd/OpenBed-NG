import { describe, expect, test } from 'vitest';
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
 * NOT ASSERTED HERE, AND THIS MATTERS -- read before trusting a green run.
 *
 * Supabase's `postgres` role IS a superuser on a LOCAL stack and is NOT on a
 * hosted project. A superuser can `ALTER TABLE ... DISABLE TRIGGER` and is
 * unaffected by REVOKE. So:
 *   - The trigger assertions below are meaningful (a trigger fires regardless of
 *     who you are, which the local superuser run demonstrates directly).
 *   - The GRANT assertions describe the local role graph, which differs from the
 *     hosted one.
 * The hosted behaviour is a HAND CHECK in
 * docs/runbook-supabase-project-creation.md. Do not add a test that claims to
 * verify it -- this suite cannot reach a hosted project, and a test that appeared
 * to would be worse than the gap it pretended to close.
 */
describe('append-only enforcement', () => {
  const TABLES = ['ward_status_event', 'audit_log'] as const;

  test('UPDATE on app.ward_status_event raises APPEND_ONLY_VIOLATION, even as superuser', async () => {
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

  test('DELETE on app.audit_log raises APPEND_ONLY_VIOLATION, even as superuser', async () => {
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
   * above run as `postgres`, which is a superuser on this local stack, and they
   * still raise. That is the assertion that covers the owner. This one covers
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
         and table_name in ('ward_status_event', 'audit_log')
         and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
       order by grantee
    `;
    const [owner] = await sql()<{ owner: string }[]>`
      select tableowner as owner from pg_tables where schemaname = 'app' and tablename = 'audit_log'
    `;
    expect(rows.map((r) => r.grantee)).toEqual([owner?.owner]);
  });
});
