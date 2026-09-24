import { describe, expect, test } from 'vitest';
import { sql } from '../setup/db.js';

/**
 * RELEASE GATE 1, LEG 4 -- no function in `public` is executable by anon.
 *
 * THIS IS THE MOST COMMONLY MISSED HOLE IN A SUPABASE PROJECT. A SECURITY
 * DEFINER function defaults to `EXECUTE` for `PUBLIC`, and `PUBLIC` includes
 * `anon`. Because a definer function runs as its OWNER, an anon-executable
 * definer function bypasses every RLS policy in the database -- the policies are
 * still there, still correct, and completely irrelevant.
 *
 * THE ALLOWLIST IS DELIBERATELY EMPTY, and is written as a constant rather than
 * inlined so that adding an entry is a visible, reviewable act with a name
 * attached.
 *
 * The second assertion covers the other definer-function footgun: without
 * `SET search_path = ''`, a caller controls which schema an unqualified name in
 * the function body resolves to, and can therefore make a definer function call
 * their own code as its owner.
 */

/** Functions in `public` that anon may execute. EMPTY, and intended to stay so. */
const ANON_EXECUTABLE_ALLOWLIST: string[] = [];

describe('RPC execute allowlist', () => {
  test('no public function is executable by PUBLIC or anon', async () => {
    const rows = await sql()<{ signature: string; grantee: string }[]>`
      select
        p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
        g.grantee
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral (values ('anon'), ('public')) as g(grantee)
      where n.nspname = 'public'
        and has_function_privilege(g.grantee, p.oid, 'EXECUTE')
      order by 1, 2
    `;

    const offenders = rows
      .map((r) => `${r.signature} [${r.grantee}]`)
      .filter((s) => !ANON_EXECUTABLE_ALLOWLIST.includes(s));

    expect(offenders, 'these public functions are executable by an anonymous caller').toEqual([]);
  });

  test('every SECURITY DEFINER function sets an empty search_path', async () => {
    const rows = await sql()<{ nspname: string; signature: string; proconfig: string[] | null }[]>`
      select n.nspname,
             p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
             p.proconfig
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('app', 'public')
         and p.prosecdef
       order by 1, 2
    `;

    // Anti-vacuity: this repository ships definer functions. If none are found,
    // the loop below asserts nothing and reports green.
    expect(rows.length, 'no SECURITY DEFINER functions found — the guard is vacuous').toBeGreaterThan(0);

    const bad = rows
      .filter((r) => !(r.proconfig ?? []).some((c) => c === 'search_path=' || c.startsWith('search_path=')))
      .map((r) => `${r.nspname}.${r.signature}`);

    expect(bad, 'definer functions without SET search_path').toEqual([]);
  });

  test('the authenticated RPCs are executable by authenticated and not by anon', async () => {
    // The positive control. Without it, revoking EXECUTE from everyone would pass
    // the first test perfectly while breaking the product -- a guard that rejects
    // everything is a rubber stamp.
    const rows = await sql()<{ signature: string; authed: boolean; anon: boolean }[]>`
      select
        p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authed,
        has_function_privilege('anon', p.oid, 'EXECUTE')          as anon
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (
        'my_facility_wards', 'ward_status_history', 'publish_ward_status',
        'operator_create_facility', 'operator_edit_facility', 'operator_set_facility_listed',
        'operator_add_category', 'operator_list_facilities'
      )
      order by 1
    `;

    // Three since 014 (the two capped reads and the write path), and five operator
    // functions since 020. That NOTHING ELSE is authenticated-executable is
    // tests/db/authenticated_executable_closed_list.test.ts, by identity.
    expect(rows.length, 'one of the eight authenticated RPCs is missing').toBe(8);
    for (const row of rows) {
      expect(row.authed, `${row.signature} is not callable by authenticated`).toBe(true);
      expect(row.anon, `${row.signature} is callable by anon`).toBe(false);
    }
  });
});
