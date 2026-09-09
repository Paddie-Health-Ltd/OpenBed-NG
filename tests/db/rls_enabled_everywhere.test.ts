import { describe, expect, test } from 'vitest';
import { sql } from '../setup/db.js';

/**
 * RLS is enabled AND FORCED on every published table.
 *
 * WHAT THIS TEST DOES NOT ASSERT, AND WHY -- read this before "fixing" it.
 *
 * The kickoff asks for "a test that fails if RLS is disabled on any table". Taken
 * literally that would mean enabling RLS on the `app` schema too, and that would
 * be theatre for a specific reason: RLS is enforced per ROLE, and no client role
 * can reach `app` at all. PostgREST does not expose the schema, and 001 revokes
 * USAGE. Enabling RLS there would protect against a caller that cannot arrive,
 * while the ACTUAL control -- unreachability -- is asserted by
 * tests/db/rls_anon_reachability.test.ts.
 *
 * So this file asserts RLS where RLS is load-bearing (the three published
 * mirrors) and asserts the real control for `app` (no client-role grants).
 * Claiming a blanket "RLS on every table" would be a stronger-sounding statement
 * that means less.
 *
 * FORCE ROW LEVEL SECURITY is asserted as well as ENABLE. Without FORCE, the
 * table OWNER bypasses its own policies -- and the projection trigger runs as a
 * SECURITY DEFINER function owned by that same role.
 */
describe('row level security', () => {
  const MIRRORS = ['facility_public', 'ward_public', 'lga_rollup'];

  test('every public mirror has RLS enabled and forced', async () => {
    const rows = await sql()<{ relname: string; enabled: boolean; forced: boolean }[]>`
      select c.relname, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by c.relname
    `;

    expect(rows.map((r) => r.relname).sort(), 'unexpected table set in public').toEqual([...MIRRORS].sort());

    for (const row of rows) {
      expect(row.enabled, `RLS is disabled on public.${row.relname}`).toBe(true);
      expect(row.forced, `RLS is not FORCEd on public.${row.relname} — the owner bypasses its policies`).toBe(true);
    }
  });

  test('no client role holds any grant on any table in app', async () => {
    // The real control for the private schema. Enumerated from the live
    // catalogue, so a table added tomorrow is covered without a test edit.
    const rows = await sql()<{ table_name: string; grantee: string; privilege_type: string }[]>`
      select table_name, grantee, privilege_type
        from information_schema.table_privileges
       where table_schema = 'app'
         and grantee in ('anon', 'authenticated', 'PUBLIC')
       order by 1, 2, 3
    `;
    expect(
      rows.map((r) => `${r.table_name}:${r.grantee}:${r.privilege_type}`),
      'client roles hold grants inside the app schema',
    ).toEqual([]);
  });

  test('app contains the expected base tables — the guard is not scanning an empty schema', async () => {
    const rows = await sql()<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'app' order by tablename
    `;
    const names = rows.map((r) => r.tablename);

    // Anti-vacuity with teeth: naming the tables means a DROP shows up here
    // rather than silently shrinking the corpus every other guard scans.
    // 16 tables. Changed by the ward-level identity decision (2026-09-08):
    //   OUT  actor_identity_map -- nothing to map; no natural person exists.
    //   OUT  staff_contact      -- per-person contact data, the thing removed.
    //   IN   facility_contact   -- the one invited human per facility.
    //   RENAMED app_user -> ward_account: an account is a ward, not a person.
    // `device` survives, re-scoped to a ward account and without its fingerprint.
    expect(names).toEqual([
      'alert',
      'audit_log',
      'challenge',
      'device',
      'facility',
      'facility_contact',
      'facility_ops',
      'invite',
      'notification_outbox',
      'referral',
      'schema_migrations',
      'system_heartbeat',
      'ward_account',
      'ward_alert_state',
      'ward_status',
      'ward_status_event',
    ]);
  });
});
