import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, psqlCommand } from '../setup/db.js';

/**
 * EVERY FORWARD MIGRATION IS IDEMPOTENT -- asserted, not declared.
 *
 * WHY THIS EXISTS. `scripts/run_migrations.sh` recovers from a failure by being
 * re-run: it skips ledgered files and re-applies the rest. That recovery is safe
 * ONLY IF every migration can be applied twice harmlessly. Until this file, the
 * sole thing standing behind that property was
 * `scripts/lint_migration_header.sh`, which greps the banner for the string
 * "Idempotency:".
 *
 * That lint is not lying -- it says it checks for a note, and it checks for a
 * note. But a note is an author's CLAIM. Nothing verified the claim, under the
 * single property the entire re-run story depends on.
 *
 * TWO ASSERTIONS, AND THE SECOND IS THE ONE THAT MATTERS.
 *   1. Re-applying raises no error.
 *   2. Re-applying CHANGES NOTHING.
 * "No error" is the presence axis. *Idempotent* means the second application is
 * a no-op, and a migration can re-run cleanly while still mutating -- an
 * unconditional seed INSERT, an `UPDATE ... SET x = x + 1`. That silent case is
 * the one that would hurt, and only the digest catches it.
 *
 * IT BYPASSES THE LEDGER DELIBERATELY. Applying through run_migrations.sh would
 * skip everything already recorded and pass having applied nothing -- a vacuous
 * green over an empty corpus, the same shape as the bundle guard that reddened
 * on the first CI run.
 *
 * THE DIGEST IS A MAP OF NAMED COMPONENTS (R-2026-09-28-162, EL-3), so a plant can
 * say WHICH component moved and assert that nothing else did. One concatenated
 * string could only say that something changed.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');

const FORWARD = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .sort();

/** Applies one SQL file with psql, exactly as the runner does. Throws on error. */
function applyFile(path: string): void {
  const cmd = `${psqlCommand()} -v ON_ERROR_STOP=1 --single-transaction < ${JSON.stringify(path)}`;
  execFileSync('bash', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Writes `text` to a scratch file and applies it. */
function applySql(name: string, text: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'openbed-digest-plant-'));
  try {
    const path = join(dir, `${name}.sql`);
    writeFileSync(path, text, 'utf8');
    applyFile(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type Digest = Record<string, string>;

/**
 * A digest of everything a migration could legitimately change, by component.
 *
 * Structure AND row contents. A structural digest alone would miss the case the
 * plant below exercises: a statement that succeeds and mutates data.
 */
async function digest(): Promise<Digest> {
  const [row] = await sql()<Digest[]>`
    with cols as (
      select coalesce(string_agg(table_schema||'.'||table_name||'.'||column_name||':'||data_type, ',' order by table_schema, table_name, ordinal_position), 'none') s
        from information_schema.columns where table_schema in ('app','public')
    ), enums as (
      select coalesce(string_agg(t.typname||':'||e.enumlabel, ',' order by t.typname, e.enumsortorder), 'none') s
        from pg_type t join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'app'
    ), funcs as (
      select coalesce(string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', ',' order by p.proname), 'none') s
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('app','public')
    ), trigs as (
      select coalesce(string_agg(tgname||':'||tgenabled::text, ',' order by tgname), 'none') s
        from pg_trigger where not tgisinternal
    ), cons as (
      select coalesce(string_agg(conname, ',' order by conname), 'none') s
        from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname in ('app','public')
    ), pols as (
      -- POLICIES, added 2026-09-15 (R-2026-09-15-07, C1). 016 now creates a
      -- policy, and until this component a re-apply that added, rewrote or
      -- duplicated a policy under another name changed nothing this digest could
      -- see. Grants, owners and RLS flags were still outside the digest until
      -- R-2026-09-28-162 (EL-3), which added the five components after contents.
      select coalesce(string_agg(schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||roles::text||':'||coalesce(qual,'')||':'||coalesce(with_check,''),
                                 ',' order by schemaname, tablename, policyname), 'none') s
        from pg_policies where schemaname in ('app','public')
    ), contents as (
      -- CONTENT HASH per table, not merely a row count.
      --
      -- A row count catches an unconditional INSERT. It does NOT catch an
      -- in-place mutation -- UPDATE ... SET x = x + 1, or an
      -- ON CONFLICT DO UPDATE SET touched_at = now(). That case changes no
      -- structure and no cardinality, and a count-based digest reports the run
      -- idempotent. Found by planting exactly that against a tracked migration
      -- during the behavioural pass, where the count-based digest missed it.
      select coalesce(string_agg(
               t.tablename||'='||
               (xpath('/row/c/text()', query_to_xml(
                  format('select coalesce(md5(string_agg(x::text, '''' order by x::text)), ''empty'') as c from app.%I x', t.tablename),
                  false, true, '')))[1]::text,
               ',' order by t.tablename), 'none') s
        from pg_tables t where t.schemaname = 'app'
    ), relations as (
      -- PRIVILEGES AND OWNERS, R-2026-09-28-162 (EL-3). Until this component a
      -- re-apply that granted SELECT to anon, or handed a table to another owner,
      -- changed nothing the digest could see. A NULL ACL means the owner's
      -- defaults, so it is expanded by acldefault() rather than read as "none":
      -- otherwise a GRANT that materialises the defaults would move nothing.
      -- Each entry is rendered by NAME (grantee 0 is PUBLIC), never by oid.
      select coalesce(string_agg(r.line, ',' order by r.line), 'none') s from (
        select n.nspname||'.'||c.relname||':'||c.relkind::text||':owner='||pg_get_userbyid(c.relowner)||':acl='||
               coalesce((select string_agg(q.e, ';' order by q.e) from (
                 select pg_get_userbyid(a.grantor)||'/'||case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                        ||'/'||a.privilege_type||'/'||a.is_grantable::text as e
                   from aclexplode(coalesce(c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
               ) q), 'none') as line
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname in ('app','public') and c.relkind in ('r','p','v','m','S','f')
      ) r
    ), rls as (
      select coalesce(string_agg(n.nspname||'.'||c.relname||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text,
                                 ',' order by n.nspname, c.relname), 'none') s
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('app','public') and c.relkind in ('r','p')
    ), functions as (
      -- A SECURITY DEFINER function runs as its OWNER, so the owner, the definer
      -- flag and the pinned search_path are privileges as much as the ACL is.
      select coalesce(string_agg(f.line, ',' order by f.line), 'none') s from (
        select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||'):owner='||pg_get_userbyid(p.proowner)
               ||':secdef='||p.prosecdef::text
               ||':config='||coalesce((select string_agg(cfg, ';' order by cfg) from unnest(p.proconfig) cfg), 'none')
               ||':acl='||coalesce((select string_agg(q.e, ';' order by q.e) from (
                 select pg_get_userbyid(a.grantor)||'/'||case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                        ||'/'||a.privilege_type||'/'||a.is_grantable::text as e
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               ) q), 'none') as line
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('app','public')
      ) f
    ), schemas as (
      select coalesce(string_agg(x.line, ',' order by x.line), 'none') s from (
        select n.nspname||':owner='||pg_get_userbyid(n.nspowner)||':acl='||
               coalesce((select string_agg(q.e, ';' order by q.e) from (
                 select pg_get_userbyid(a.grantor)||'/'||case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                        ||'/'||a.privilege_type||'/'||a.is_grantable::text as e
                   from aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
               ) q), 'none') as line
          from pg_namespace n where n.nspname in ('app','public')
      ) x
    ), default_acl as (
      select coalesce(string_agg(x.line, ',' order by x.line), 'none') s from (
        select n.nspname||':'||pg_get_userbyid(d.defaclrole)||':'||d.defaclobjtype::text||':'||
               coalesce((select string_agg(q.e, ';' order by q.e) from (
                 select pg_get_userbyid(a.grantor)||'/'||case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end
                        ||'/'||a.privilege_type||'/'||a.is_grantable::text as e
                   from aclexplode(d.defaclacl) a
               ) q), 'none') as line
          from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
         where n.nspname in ('app','public')
      ) x
    )
    select cols.s as cols, enums.s as enums, funcs.s as funcs, trigs.s as trigs, cons.s as cons,
           pols.s as policies, contents.s as contents,
           relations.s as relations, rls.s as rls, functions.s as functions, schemas.s as schemas, default_acl.s as default_acl
      from cols, enums, funcs, trigs, cons, pols, contents, relations, rls, functions, schemas, default_acl
  `;
  return { ...(row ?? {}) };
}

/** The components that differ, by name. */
function moved(before: Digest, after: Digest): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]).sort();
}

describe('migration idempotency', () => {
  test('the corpus is non-empty — the guard is not scanning nothing', () => {
    expect(FORWARD.length).toBeGreaterThan(10);
  });

  test('re-applying every forward migration raises no error and changes nothing', async () => {
    const before = await digest();
    expect(JSON.stringify(before).length, 'digest came back empty — it would compare equal trivially').toBeGreaterThan(500);
    expect(Object.keys(before).sort(), 'the digest does not carry every named component').toEqual(
      ['cols', 'cons', 'contents', 'default_acl', 'enums', 'funcs', 'functions', 'policies', 'relations', 'rls', 'schemas', 'trigs']);

    for (const f of FORWARD) {
      expect(() => applyFile(join(MIG_DIR, f)), `${f} failed on re-apply`).not.toThrow();
    }

    const after = await digest();
    expect(moved(before, after), 're-applying the migrations moved these digest components').toEqual([]);
    expect(after, 're-applying the migrations changed the schema or the data').toEqual(before);

    // R-2026-09-27-145 DU-1, DU-5: 026 RENAMED my_facility_wards to my_reporting_wards,
    // as 021 renamed its list, because 011 is frozen and re-applies above. That re-apply
    // recreates my_facility_wards() WITH ITS GRANT; 026's re-apply must drop it again.
    // Asserted by name, not only through the digest: a resurrected function holding a
    // live grant is the one outcome the rename must not leave.
    const [fn] = await sql()<{ old: string | null; renamed: string | null }[]>`
      select to_regprocedure('public.my_facility_wards()')::text as old,
             to_regprocedure('public.my_reporting_wards()')::text as renamed`;
    expect(fn, 'after the re-apply, my_facility_wards() is back or my_reporting_wards() is gone').toEqual({ old: null, renamed: 'my_reporting_wards()' });
  });

  test('plant — a migration that ERRORS on re-apply is caught', () => {
    // Unguarded CREATE: fine the first time, fails the second.
    const plant = '/tmp/openbed-plant-error.sql';
    execFileSync('bash', ['-c',
      `printf 'CREATE TABLE app.plant_error_probe (id int);\\n' > ${plant}`]);
    try {
      applyFile(plant);                                   // first: succeeds
      expect(() => applyFile(plant)).toThrow();            // second: must fail
    } finally {
      execFileSync('bash', ['-c',
        `${psqlCommand()} -c 'DROP TABLE IF EXISTS app.plant_error_probe' >/dev/null 2>&1 || true`]);
    }
  });

  test('plant — a migration that SUCCEEDS but MUTATES is caught by the digest', async () => {
    // THE IMPORTANT PLANT. This one never errors. Only the contents component of
    // the digest sees it, which is why the digest is not structure-only.
    const plant = '/tmp/openbed-plant-mutate.sql';
    const psql = psqlCommand();
    execFileSync('bash', ['-c',
      `${psql} -c 'CREATE TABLE IF NOT EXISTS app.plant_mutate_probe (id serial primary key)' >/dev/null`]);
    try {
      execFileSync('bash', ['-c',
        `printf 'INSERT INTO app.plant_mutate_probe DEFAULT VALUES;\\n' > ${plant}`]);

      const before = await digest();
      applyFile(plant);                        // succeeds, no error
      const after = await digest();

      expect(moved(before, after), 'a silently mutating re-apply was NOT caught by the contents component alone').toEqual(['contents']);
    } finally {
      execFileSync('bash', ['-c',
        `${psql} -c 'DROP TABLE IF EXISTS app.plant_mutate_probe' >/dev/null 2>&1 || true`]);
    }
  });

  test('plant — a re-apply that silently ADDS A POLICY is caught by the digest', async () => {
    // C1 (R-2026-09-15-07). A policy created without an IF NOT EXISTS guard
    // errors on re-apply and the first plant catches that. This one does not
    // error: it adds a second policy under a new name, the shape a careless
    // "idempotent" rewrite of 016's reader policy would take.
    const plant = '/tmp/openbed-plant-policy.sql';
    const psql = psqlCommand();
    try {
      execFileSync('bash', ['-c',
        `printf 'CREATE POLICY zz_plant_extra_policy ON public.snapshot_current FOR SELECT TO service_role USING (true);\\n' > ${plant}`]);

      const before = await digest();
      applyFile(plant);                        // succeeds, no error
      const after = await digest();

      expect(before['policies'], 'the digest does not carry the policies component').toContain('snapshot_current_service_role_select');
      expect(moved(before, after), 'a re-apply that added a policy was NOT caught by the policies component alone').toEqual(['policies']);
    } finally {
      execFileSync('bash', ['-c',
        `${psql} -c 'DROP POLICY IF EXISTS zz_plant_extra_policy ON public.snapshot_current' >/dev/null 2>&1 || true`]);
    }
  });

  /**
   * PRIVILEGES, OWNERS AND RLS FLAGS (R-2026-09-28-162, EL-3 b). One plant per
   * component, each a re-apply that SUCCEEDS -- the silent shape. Each asserts:
   *   - a PRESENCE PRECONDITION: the component carries the object the plant
   *     targets, so a component that stopped rendering it cannot pass;
   *   - that ONLY its named component moved;
   *   - after restoring in `finally`, that the whole digest equals its value
   *     before the plant. A leaked grant would weaken every db test file after
   *     this one, and 013's grant sweep would then hide it on the next re-apply.
   */
  test.each([
    {
      name: 'SELECT on an app table granted to anon',
      component: 'relations', present: 'app.facility:r:owner=postgres',
      plant: 'GRANT SELECT ON app.facility TO anon;',
      restore: 'REVOKE SELECT ON app.facility FROM anon;',
    },
    {
      name: 'EXECUTE on an app function granted to anon',
      component: 'functions', present: 'app.assert_operator():owner=postgres',
      plant: 'GRANT EXECUTE ON FUNCTION app.assert_operator() TO anon;',
      restore: 'REVOKE EXECUTE ON FUNCTION app.assert_operator() FROM anon;',
    },
    {
      name: 'USAGE on a sequence granted to anon',
      component: 'relations', present: 'app.audit_log_id_seq:S:owner=postgres',
      plant: 'GRANT USAGE ON SEQUENCE app.audit_log_id_seq TO anon;',
      restore: 'REVOKE USAGE ON SEQUENCE app.audit_log_id_seq FROM anon;',
    },
    {
      name: 'RLS disabled on a table',
      component: 'rls', present: 'app.facility_agreement:true:true',
      plant: 'ALTER TABLE app.facility_agreement DISABLE ROW LEVEL SECURITY;',
      restore: 'ALTER TABLE app.facility_agreement ENABLE ROW LEVEL SECURITY;',
    },
    {
      name: 'FORCE ROW LEVEL SECURITY removed',
      component: 'rls', present: 'app.facility_agreement:true:true',
      plant: 'ALTER TABLE app.facility_agreement NO FORCE ROW LEVEL SECURITY;',
      restore: 'ALTER TABLE app.facility_agreement FORCE ROW LEVEL SECURITY;',
    },
    {
      name: 'a SECURITY DEFINER function turned SECURITY INVOKER',
      component: 'functions', present: 'app.assert_operator():owner=postgres:secdef=true',
      plant: 'ALTER FUNCTION app.assert_operator() SECURITY INVOKER;',
      restore: 'ALTER FUNCTION app.assert_operator() SECURITY DEFINER;',
    },
    {
      name: "a definer function's search_path RESET",
      component: 'functions', present: 'app.assert_operator():owner=postgres:secdef=true:config=search_path=""',
      plant: 'ALTER FUNCTION app.assert_operator() RESET search_path;',
      restore: "ALTER FUNCTION app.assert_operator() SET search_path = '';",
    },
    {
      name: "a definer function's search_path set to a different value",
      component: 'functions', present: 'app.assert_operator():owner=postgres:secdef=true:config=search_path=""',
      plant: 'ALTER FUNCTION app.assert_operator() SET search_path = public, app;',
      restore: "ALTER FUNCTION app.assert_operator() SET search_path = '';",
    },
    {
      name: 'USAGE on schema app granted to anon',
      component: 'schemas', present: 'app:owner=postgres',
      plant: 'GRANT USAGE ON SCHEMA app TO anon;',
      restore: 'REVOKE USAGE ON SCHEMA app FROM anon;',
    },
    {
      name: 'a default privilege in schema app',
      component: 'default_acl', present: 'public:postgres:r:',
      plant: 'ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO anon;',
      restore: 'ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE SELECT ON TABLES FROM anon;',
    },
    {
      // The new owner needs CREATE on the schema for ALTER ... OWNER, and it is
      // revoked again inside the plant so only the owner remains changed.
      name: "an app table's owner changed",
      component: 'relations', present: 'app.facility:r:owner=postgres',
      plant: [
        'CREATE ROLE openbed_plant_owner NOLOGIN;',
        'GRANT openbed_plant_owner TO postgres;',
        'GRANT CREATE ON SCHEMA app TO openbed_plant_owner;',
        'ALTER TABLE app.facility OWNER TO openbed_plant_owner;',
        'REVOKE CREATE ON SCHEMA app FROM openbed_plant_owner;',
      ].join('\n'),
      restore: [
        'ALTER TABLE app.facility OWNER TO postgres;',
        'DROP ROLE IF EXISTS openbed_plant_owner;',
      ].join('\n'),
    },
  ])('plant — $name is caught by the $component component alone, and restored', async ({ component, present, plant, restore }) => {
    const before = await digest();
    expect(before[component], `the digest's ${component} component does not carry ${present}`).toContain(present);
    try {
      applySql('plant', plant);                // succeeds, no error
      const after = await digest();
      expect(moved(before, after), `the plant did not move the ${component} component, and only it`).toEqual([component]);
    } finally {
      applySql('restore', restore);
    }
    expect(await digest(), 'the plant was not fully restored; a leaked privilege weakens every db test after this one').toEqual(before);
  });
});
