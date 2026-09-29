import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, psqlCommand } from '../setup/db.js';
import { digest, moved } from '../setup/digest.js';

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

/**
 * THE DIGEST AND moved() LIVE IN tests/setup/digest.ts (R-2026-09-29-165, EO-1 a), so
 * tests/db/runbook_sql_live.test.ts renders privileges the same way this file does.
 */

/** One digest plant: what it changes, what must be present first, and how it is undone. */
interface Plant {
  name: string;
  component: string;
  present: string;
  /** The component must EQUAL `present`, not merely contain it. */
  exact?: boolean;
  /** Text the component must carry once the plant has applied. */
  after?: string[];
  plant: string;
  restore: string;
}

describe('migration idempotency', () => {
  test('the corpus is non-empty — the guard is not scanning nothing', () => {
    expect(FORWARD.length).toBeGreaterThan(10);
  });

  test('re-applying every forward migration raises no error and changes nothing', async () => {
    const before = await digest();
    expect(JSON.stringify(before).length, 'digest came back empty — it would compare equal trivially').toBeGreaterThan(500);
    expect(Object.keys(before).sort(), 'the digest does not carry every named component').toEqual(
      ['cols', 'column_acl', 'cons', 'contents', 'default_acl', 'enums', 'funcs', 'functions', 'policies', 'relations', 'rls', 'schemas', 'trigs', 'type_acl']);

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
  test.each<Plant>([
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
    {
      // R-2026-09-28-163 (EM-4). A column grant moved nothing the digest saw until
      // then. No migration from 001 to 026 holds one, so the precondition is EXACT:
      // the component must read 'none', not merely contain something. A column
      // GRANT then REVOKE leaves attacl NULL, so the restore returns the same text.
      name: 'SELECT on one column granted to anon',
      component: 'column_acl', present: 'none', exact: true, after: ['app.facility.id', 'anon'],
      plant: 'GRANT SELECT (id) ON app.facility TO anon;',
      restore: 'REVOKE SELECT (id) ON app.facility FROM anon;',
    },
    {
      // R-2026-09-28-163 (EM-4). After the REVOKE, app.tri_state's typacl is
      // EXPLICIT rather than NULL: it equals the value before the plant only
      // through the acldefault('T', owner) expansion the component renders.
      name: 'USAGE on an app type granted to anon',
      component: 'type_acl', present: 'app.tri_state:owner=postgres',
      plant: 'GRANT USAGE ON TYPE app.tri_state TO anon;',
      restore: 'REVOKE USAGE ON TYPE app.tri_state FROM anon;',
    },
  ])('plant — $name is caught by the $component component alone, and restored', async ({ component, present, exact, after: expectAfter, plant, restore }) => {
    const before = await digest();
    if (exact) {
      expect(before[component], `the digest's ${component} component is not exactly ${present}`).toBe(present);
    } else {
      expect(before[component], `the digest's ${component} component does not carry ${present}`).toContain(present);
    }
    try {
      applySql('plant', plant);                // succeeds, no error
      const after = await digest();
      expect(moved(before, after), `the plant did not move the ${component} component, and only it`).toEqual([component]);
      for (const text of expectAfter ?? []) {
        expect(after[component], `after the plant, ${component} does not carry ${text}`).toContain(text);
      }
    } finally {
      applySql('restore', restore);
    }
    expect(await digest(), 'the plant was not fully restored; a leaked privilege weakens every db test after this one').toEqual(before);
  });
});
