import { describe, expect, test } from 'vitest';
import { sql, anonRest } from '../setup/db.js';

/**
 * RELEASE GATE 1, LEG 3 -- an anonymous client cannot write to any mirror.
 *
 * The public dashboard is read-only by design, and the anon key is published in
 * the browser bundle, so "anon can write" is equivalent to "anyone on the
 * internet can set a hospital's bed count".
 *
 * BOTH LAYERS ARE ASSERTED, because they fail independently:
 *   - the GRANT layer (anon holds no INSERT/UPDATE/DELETE), and
 *   - the POLICY layer (no write policy exists, and under RLS a missing policy
 *     is a denial).
 * A future contributor adding a permissive `FOR ALL` policy would not touch the
 * grants; a contributor running `GRANT ALL` would not touch the policies. Only
 * checking both catches both.
 */
describe('anon writes are rejected', () => {
  const MIRRORS = ['facility_public', 'ward_public', 'lga_rollup'] as const;

  test.each(MIRRORS)('anon INSERT into public.%s is rejected over HTTP', async (table) => {
    const res = await anonRest(table, { method: 'POST' });
    expect(res.status, `anon INSERT into ${table} was not rejected`).toBeGreaterThanOrEqual(400);
  });

  test.each(MIRRORS)('anon DELETE on public.%s is rejected over HTTP', async (table) => {
    const res = await anonRest(`${table}?facility_id=neq.00000000-0000-0000-0000-000000000000`, {
      method: 'DELETE',
    });
    expect(res.status, `anon DELETE on ${table} was not rejected`).toBeGreaterThanOrEqual(400);
  });

  test('anon holds no write grant on any mirror', async () => {
    const rows = await sql()<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type
        from information_schema.table_privileges
       where grantee = 'anon'
         and table_schema = 'public'
         and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    `;
    expect(rows.map((r) => `${r.table_name}:${r.privilege_type}`)).toEqual([]);
  });

  test('no write policy exists on any mirror for any role', async () => {
    // Under RLS a missing policy is a denial, so the ABSENCE is the control. The
    // three expected SELECT policies are asserted by name, so that swapping one
    // for a FOR ALL policy fails here rather than quietly widening the surface.
    const rows = await sql()<{ tablename: string; policyname: string; cmd: string }[]>`
      select tablename, policyname, cmd
        from pg_policies
       where schemaname = 'public'
       order by tablename, policyname
    `;

    expect(rows.length, 'no policies found at all — the mirrors may be unprotected').toBe(3);
    for (const row of rows) {
      expect(row.cmd, `policy ${row.policyname} on ${row.tablename} is not SELECT-only`).toBe('SELECT');
    }
    expect(rows.map((r) => r.policyname).sort()).toEqual([
      'facility_public_anon_select',
      'lga_rollup_anon_select',
      'ward_public_anon_select',
    ]);
  });
});
