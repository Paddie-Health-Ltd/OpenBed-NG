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

  /**
   * THE PRIVILEGE THIS TEST IS ABOUT, NAMED ONCE (R-2026-09-22-62 A1).
   *
   * Every probe below binds this constant, and the control subject is chosen by a
   * criterion written with SEPARATE literals -- holds USAGE, does NOT hold CREATE.
   * So if this line is ever changed to another valid privilege, the control's own
   * call answers false and the test reds, instead of quietly asserting that anon
   * lacks some other privilege. That swap is the plant; see the header.
   */
  const PROBED_PRIVILEGE = 'USAGE';

  test('neither anon nor authenticated holds USAGE on the app schema at the grant level', async () => {
    // Defence in depth behind the exposed-schemas list. If someone ever exposes
    // `app` by mistake, the grants are the next thing standing.
    //
    // THE NAME SAID ONLY `anon` UNTIL 2026-09-22 while the body checked two roles
    // (R-2026-09-22-57 A1). A test name is the failure message someone reads at 2am
    // with no context, and one that understates what it covers sends them looking in
    // the wrong place.
    //
    // AND IT CARRIES A POSITIVE CONTROL NOW (R-2026-09-22-57 A1). Every assertion
    // here expected FALSE, and nothing showed the same call could return TRUE.
    //
    // THE REASON -56 D GAVE FOR THIS DOES NOT HOLD, AND THE CORRECTED ONE IS
    // NARROWER. That ruling said "a misspelled privilege string would read as the
    // boundary holding". Measured here against PostgreSQL 17.6 on 2026-09-22, it
    // would not: has_schema_privilege RAISES on an unrecognised privilege type
    // (`unrecognized privilege type: "USAGEE"`), on a schema that does not exist,
    // and on a role that does not exist. Leading and trailing whitespace and
    // lower case are all tolerated and return the correct answer. So the specific
    // defect named is caught loudly by Postgres itself, with or without a control.
    //
    // WHAT THE CONTROL DOES ESTABLISH, which is why it is still here: that this
    // call is CAPABLE of returning true at all. Without it the two assertions below
    // are consistent with a probe that can only ever answer false — and that is a
    // property of the probe, not a prediction about one way of breaking it.
    //
    // THE SWAP IS NOW CAUGHT (R-2026-09-22-62, closing R-2026-09-22-57 G5). Until
    // 2026-09-23 the control was simply "some role holding USAGE", which picked a
    // role that ALSO held CREATE -- so changing the probed privilege to CREATE left
    // the control true and both subjects false, and nothing reddened. The control is
    // now a role that holds USAGE and NOT CREATE (pg_read_all_data today: a Postgres
    // predefined role, not a Supabase fixture, so it does not drift with a
    // migration). Probed for CREATE, it answers false, and the test fails loudly.
    //
    // WHAT THIS LEG STILL ADDS OVER THE ACL READ BELOW: membership inheritance.
    // has_schema_privilege sees a privilege a role holds THROUGH another role; the
    // ACL lists direct grants only. Each covers what the other cannot.
    //
    // THE CONTROL ROLE IS READ FROM THE CATALOGUE, not assumed. Naming a role here
    // would make this leg assert a fixture rather than the privilege graph, and the
    // obvious guess is wrong: service_role holds NO usage on `app` either, so a
    // hand-picked control would have reddened for a reason unrelated to the defect.
    // It is required to be neither subject role, or the control and the subject
    // would be the same call.
    const [row] = await sql()<
      { anon: boolean; authenticated: boolean; control_role: string | null; control_holds: boolean | null }[]
    >`
      with control as (
        select r.rolname
          from pg_roles r
         where r.rolname not in ('anon', 'authenticated')
           and has_schema_privilege(r.rolname, 'app', 'USAGE')
           and not has_schema_privilege(r.rolname, 'app', 'CREATE')
         order by r.rolname
         limit 1
      )
      select
        has_schema_privilege('anon', 'app', ${PROBED_PRIVILEGE})          as anon,
        has_schema_privilege('authenticated', 'app', ${PROBED_PRIVILEGE}) as authenticated,
        (select rolname from control)                                     as control_role,
        has_schema_privilege((select rolname from control), 'app', ${PROBED_PRIVILEGE}) as control_holds
    `;

    // THE CONTROL FIRST. If it cannot return true, the two assertions below are
    // satisfied by a call that can only ever answer false, and they prove nothing.
    expect(
      row?.control_role,
      'no role holds USAGE without CREATE on app — the control that makes a privilege swap detectable has no subject',
    ).not.toBeNull();
    expect(
      row?.control_holds,
      `the probe returned ${String(row?.control_holds)} for ${String(row?.control_role)}, which holds USAGE and not CREATE — either the probe is broken or it is no longer asking about USAGE (probed: ${PROBED_PRIVILEGE})`,
    ).toBe(true);

    expect(row?.anon, 'anon holds USAGE on the app schema').toBe(false);
    expect(row?.authenticated, 'authenticated holds USAGE on the app schema').toBe(false);
  });

  /**
   * Direct grants on `app`, exploded from its ACL, for the given grantees.
   *
   * PUBLIC IS GRANTEE OID 0, AND IT MUST BE MAPPED BY OID. The first version mapped
   * it with `coalesce(nullif(pg_get_userbyid(grantee), ''), 'PUBLIC')`, on the
   * assumption that the lookup returns an empty string for OID 0. It returns
   * 'unknown (OID=0)'. So PUBLIC was never labelled, the filter could never match
   * it, and a real GRANT ... TO PUBLIC passed this guard -- the one grantee
   * R-2026-09-22-62 A2 asked for it to cover. Found by planting that grant, not by
   * reading the query.
   */
  // ONE TEXT, READ BY BOTH THE LEG AND ITS PLANT, so a defect in the read -- like
  // the PUBLIC mapping above -- reds the plant as well as weakening the leg. The
  // grantee list is a bound parameter; nothing is interpolated into the SQL.
  const APP_ACL_SQL = `
    select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end as grantee,
           a.privilege_type
      from pg_namespace n, aclexplode(n.nspacl) a
     where n.nspname = 'app'
       and (case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end) = any($1::text[])
     order by 1, 2`;
  type AclRow = { grantee: string; privilege_type: string };
  const APP_ACL = async (grantees: readonly string[]): Promise<AclRow[]> =>
    [...(await sql().unsafe<AclRow[]>(APP_ACL_SQL, [grantees as string[]]))];

  test('app\u2019s ACL grants anon, authenticated and PUBLIC nothing — every privilege type at once', async () => {
    // R-2026-09-22-62 A2. One catalogue read covers EVERY schema privilege for all
    // three client grantees, including PUBLIC, which has_schema_privilege above does
    // not name. It sees direct grants only; the leg above covers inheritance.
    expect(await APP_ACL(['anon', 'authenticated', 'PUBLIC']), 'a client grantee holds a privilege on schema app').toEqual([]);

    // ANTI-VACUITY: the same read DOES return rows for the owner. Without this, an
    // ACL that failed to explode -- or a schema name that stopped matching -- would
    // pass the assertion above by returning nothing for anyone.
    const [owner] = await sql()<{ owner: string }[]>`select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = 'app'`;
    const ownerRows = await APP_ACL([owner?.owner ?? '']);
    expect(ownerRows.map((r) => r.privilege_type).sort(), `the ACL read returned nothing for app's owner ${String(owner?.owner)} — it is vacuous`).toEqual(['CREATE', 'USAGE']);
  });

  test('plant — transient grants to anon AND to PUBLIC are SEEN by the ACL read, then rolled back', async () => {
    // THE FAILING HALF, run against the real catalogue rather than a stub, inside a
    // transaction that never commits. If the read could not see a grant, the empty
    // result in the leg above would mean nothing.
    const sentinel = Symbol('rollback');
    let seen: AclRow[] = [];
    await sql()
      .begin(async (tx) => {
        await tx`grant usage on schema app to anon`;
        await tx`grant usage on schema app to public`;
        // Through the SAME read the real leg uses, so a mapping defect in it -- the
        // one that let PUBLIC through -- reds this plant too.
        seen = [...(await tx.unsafe<AclRow[]>(APP_ACL_SQL, [['anon', 'authenticated', 'PUBLIC']]))];
        throw sentinel;
      })
      .catch((e: unknown) => {
        if (e !== sentinel) throw e;
      });
    expect(seen, 'a grant made inside the transaction was invisible to the ACL read').toEqual([
      { grantee: 'PUBLIC', privilege_type: 'USAGE' },
      { grantee: 'anon', privilege_type: 'USAGE' },
    ]);
    expect(await APP_ACL(['anon', 'PUBLIC']), 'the transient grant survived the rollback').toEqual([]);
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
