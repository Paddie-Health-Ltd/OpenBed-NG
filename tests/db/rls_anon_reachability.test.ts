import { describe, expect, test } from 'vitest';
import { sql, anonRest, restErrorCode } from '../setup/db.js';

/**
 * RELEASE GATE 1, LEG 1 -- an anonymous client cannot address ANY table in `app`.
 *
 * This is the boundary the whole design rests on (decision A3: "RLS is not the
 * boundary. Physical separation is."). RLS is row-level, and every requirement
 * in this system is a COLUMN requirement or an AGGREGATION requirement, which
 * RLS can express neither of. So the base tables are not merely policy-protected,
 * they are unreachable: `app` is absent from `[api] schemas` in
 * supabase/config.toml, and PostgREST refuses before any policy is consulted.
 *
 * The refusal code to expect is PGRST106 ("Invalid schema"). Note what that
 * means: the request never reaches a policy, a grant, or a row. That is why this
 * test asserts a SCHEMA-level refusal rather than an empty result set -- an empty
 * result set would also pass a naive test, and would be produced by a working
 * policy that a single dashboard click could widen.
 *
 * NOT ASSERTED HERE, deliberately: that the HOSTED project's exposed-schemas
 * list excludes `app`. That is a dashboard setting and is unreachable from this
 * suite. The honest control is three parts, and only two are testable:
 *   (a) this test, against the local PostgREST;
 *   (b) tests/db/config_drift.test.ts, asserting supabase/config.toml statically;
 *   (c) a HAND CHECK in docs/runbook-supabase-project-creation.md.
 * A test claiming to verify (c) would be exactly the phantom enforcement
 * .claude/rules/code-pipeline.md Clause 4 forbids.
 */
describe('anon reachability of the app schema', () => {
  test('the app schema is not exposed — asking for it is refused with PGRST106', async () => {
    const res = await anonRest('facility?select=*', { profile: 'app' });
    expect(res.status).toBe(406);
    expect(restErrorCode(res.body)).toBe('PGRST106');
  });

  test('every table in app is unreachable by an anonymous caller', async () => {
    // Enumerated from the live catalogue, not from a hardcoded list: a table
    // added by a future migration is covered the moment it exists, with no test
    // edit. A hardcoded list would silently stop covering new tables, which is
    // the failure mode this shape exists to avoid.
    const tables = await sql()<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'app' order by tablename
    `;

    expect(tables.length, 'no tables found in app — the suite would be vacuous').toBeGreaterThan(5);

    const reachable: string[] = [];
    for (const { tablename } of tables) {
      const res = await anonRest(`${tablename}?select=*`, { profile: 'app' });
      if (res.status >= 200 && res.status < 300) reachable.push(tablename);
    }

    expect(reachable, 'anon can read these app tables over PostgREST').toEqual([]);
  });

  test('app tables are not reachable through the default public profile either', async () => {
    // A table in `app` must not be addressable by bare name. If `app` were ever
    // added to extra_search_path, or a view of the same name appeared in public,
    // this is what would catch it.
    // `facility_contact`, not `staff_contact`. The latter no longer exists, and a
    // probe for a nonexistent table trivially satisfies `status !== 200` -- a hole
    // wearing the shape of a passing assertion.
    for (const name of ['facility', 'ward_status', 'audit_log', 'facility_contact', 'schema_migrations']) {
      const res = await anonRest(`${name}?select=*`);
      expect(res.status, `anon reached ${name} without a profile header`).not.toBe(200);
    }
  });

  test('anon holds no USAGE on the app schema at the grant level', async () => {
    // Defence in depth behind the exposed-schemas list. If someone ever exposes
    // `app` by mistake, the grants are the next thing standing.
    const [row] = await sql()<{ anon: boolean; authenticated: boolean }[]>`
      select
        has_schema_privilege('anon', 'app', 'USAGE')          as anon,
        has_schema_privilege('authenticated', 'app', 'USAGE') as authenticated
    `;
    expect(row?.anon).toBe(false);
    expect(row?.authenticated).toBe(false);
  });
});

/**
 * RELEASE GATE 1, LEG 1b -- the PUBLIC MIRRORS are unreachable too, since
 * migration 018.
 *
 * Until 018 this was the one surface anon was SUPPOSED to reach: `app` was
 * unreachable by schema, and the three mirrors were the designed public read
 * path. 018 closed that path — the only public read is now /beds.json, served by
 * the Pages Function as service_role — so the property flips, and a suite that
 * said nothing about it would be silent on the boundary this sprint exists to
 * draw.
 *
 * WHY THE DENIAL IS ASSERTED AND NOT LEFT IMPLIED. "anon reaches nothing" makes
 * every containment and column check downstream pass for free. A suite in that
 * state reports exactly what a working one does, which is the failure mode this
 * repository has now hit five times: a check that reports success for a reason
 * unrelated to what it guards. Naming the denial is what keeps the green
 * meaningful.
 *
 * TWO LAYERS, because they fail independently — the GRANT (below) and what
 * PostgREST actually answers over HTTP. A grant restored by hand on the hosted
 * project would not touch the first; a PostgREST or policy change would not
 * touch the second.
 */
describe('anon and authenticated reachability of the public mirrors', () => {
  const MIRRORS = ['facility_public', 'ward_public', 'lga_rollup'] as const;
  const CLIENT_ROLES = ['anon', 'authenticated'] as const;

  test('the probe can return TRUE — a role that holds SELECT is reported as holding it', async () => {
    // THE POSITIVE CONTROL, and it is not a formality. `has_table_privilege`
    // returns false for a misspelled privilege string on some inputs and throws
    // on an unknown relation; a typo in the assertions below would otherwise read
    // as a boundary that holds. The table owner necessarily holds SELECT, so this
    // is the one row whose expected value cannot drift with a migration.
    const rows = await sql()<{ relname: string; owner_can_select: boolean }[]>`
      select c.relname,
             has_table_privilege(pg_get_userbyid(c.relowner), 'public.' || c.relname, 'SELECT') as owner_can_select
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in ('facility_public', 'ward_public', 'lga_rollup')
       order by c.relname
    `;
    expect(rows.length, 'the three mirrors were not found — the assertions below would be vacuous').toBe(3);
    for (const row of rows) {
      expect(row.owner_can_select, `the probe reported the OWNER of ${row.relname} cannot SELECT it`).toBe(true);
    }
  });

  test.each(CLIENT_ROLES)('%s holds no SELECT on any mirror at the grant level', async (role) => {
    const rows = await sql()<{ relname: string; can_select: boolean }[]>`
      select c.relname,
             has_table_privilege(${role}, 'public.' || c.relname, 'SELECT') as can_select
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname in ('facility_public', 'ward_public', 'lga_rollup')
       order by c.relname
    `;
    expect(rows.length, 'the three mirrors were not found — this assertion would be vacuous').toBe(3);
    const readable = rows.filter((r) => r.can_select).map((r) => r.relname);
    expect(readable, `${role} can still SELECT these mirrors; migration 018 did not take effect`).toEqual([]);
  });

  test.each(MIRRORS)('anon SELECT on public.%s is refused over HTTP', async (table) => {
    // The grant assertions above are the catalogue's account of it. This is
    // PostgREST's, which is the one a visitor's browser actually gets.
    const res = await anonRest(`${table}?select=facility_id&limit=1`);
    expect(res.status, `anon read of ${table} succeeded: ${JSON.stringify(res.body)}`).not.toBe(200);
    expect(res.status, `anon read of ${table} was refused with an unexpected status`).toBeGreaterThanOrEqual(400);
  });

});
