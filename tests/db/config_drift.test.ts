import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from '../setup/db.js';
import PUBLIC_RELATIONS from '../../packages/fixtures/public-relations.json';

/**
 * CONFIGURATION DRIFT -- the settings that are correct today and silently stop
 * being correct later.
 *
 * Every assertion here guards something that has no runtime symptom when it
 * breaks. A REPLICA IDENTITY change publishes deleted rows to Realtime
 * subscribers and nothing errors. A table added to the publication starts
 * broadcasting and nothing errors. `app` appearing in the exposed-schemas list
 * opens the whole private schema and nothing errors -- until someone looks.
 *
 * NOT ASSERTED HERE, deliberately -- and the two cases have DIFFERENT reasons,
 * which matters because a reader decides from the reason whether to build the
 * control later:
 *
 *   - The HOSTED exposed-schemas list is a dashboard setting with no
 *     in-database representation. Genuinely unreachable from here.
 *   - The HOSTED region (eu-west-1) IS reachable -- the Supabase Management API
 *     returns it. It is not asserted because that would put a management token
 *     in CI, in a public repository, for a class of credential the SOP says
 *     cannot be rotated quietly. Assertable; declined on credential-surface
 *     grounds.
 *
 * Both are checklist steps in docs/runbook-supabase-project-creation.md, the
 * region one carrying the API call and its recorded result. A test claiming to
 * verify either from here would be phantom enforcement.
 */

const REPO_ROOT = join(import.meta.dirname, '..', '..');

/**
 * Minimal TOML reader for the handful of keys asserted below.
 *
 * A full TOML parser is not a dependency worth adding for four keys, and this
 * reads only `key = value` lines inside a named `[table]` -- which is exactly the
 * shape supabase/config.toml uses for all of them. It deliberately does NOT
 * handle nested tables or multi-line arrays: if config.toml grows a key that this
 * cannot read, the assertion fails loudly rather than quietly reading the wrong
 * thing.
 */
function tomlValue(content: string, table: string, key: string): string | null {
  const lines = content.split('\n');
  let inTable = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inTable = line === `[${table}]`;
      continue;
    }
    if (!inTable || line.startsWith('#') || !line.includes('=')) continue;
    const [k, ...rest] = line.split('=');
    if (k?.trim() === key) return rest.join('=').trim();
  }
  return null;
}

describe('configuration drift', () => {
  const configToml = readFileSync(join(REPO_ROOT, 'supabase', 'config.toml'), 'utf8');

  test('config.toml is non-empty and parseable — the guard is not reading a stub', () => {
    expect(configToml.length).toBeGreaterThan(500);
    expect(tomlValue(configToml, 'api', 'schemas'), 'could not read [api] schemas').not.toBeNull();
  });

  test('the app schema is NOT in the PostgREST exposed-schemas list', () => {
    const schemas = tomlValue(configToml, 'api', 'schemas') ?? '';
    expect(schemas).toContain('public');
    expect(schemas, 'app has been added to the exposed schemas — the boundary is gone').not.toContain('app');
  });

  test('the CLI migration and seed runners stay disabled', () => {
    // Two runners over one schema corrupts it. This is the configuration that
    // makes the collision impossible rather than merely unlikely.
    expect(tomlValue(configToml, 'db.migrations', 'enabled')).toBe('false');
    expect(tomlValue(configToml, 'db.seed', 'enabled')).toBe('false');
  });

  test('auto_expose_new_tables stays at the cloud default of true', () => {
    // Counter-intuitive on purpose. Hardening this locally would make the RLS
    // negative suite pass against a stricter regime than production runs, and the
    // suite would go green while a newly added public table was live to anon on
    // the real project. Test the weaker regime production actually has.
    expect(tomlValue(configToml, 'api', 'auto_expose_new_tables')).toBe('true');
  });

  /**
   * THE LINK IS CODE, NOT A COMMENT -- and it was a comment until now.
   *
   * packages/fixtures/public-relations.json and scripts/lint_from_allowlist.sh
   * both asserted, in the present tense, that THIS TEST reads that fixture and
   * checks it against the publication. It did not: it held a second literal copy
   * of the three names and never imported the JSON. That is a Clause 5 defect --
   * a mechanism that is present and does not reach -- and it is precisely the
   * drift the shared-fixture pattern exists to prevent, sitting in the repository
   * claiming to prevent itself.
   *
   * The fixture is now imported. The lint's allowlist and the database's
   * published surface cannot drift apart, because doing so requires editing the
   * one file both of them read.
   */
  test('the realtime publication contains exactly the mirrors named in the shared fixture', async () => {
    const rows = await sql()<{ schemaname: string; tablename: string }[]>`
      select schemaname, tablename
        from pg_publication_tables
       where pubname = 'supabase_realtime'
       order by schemaname, tablename
    `;
    const expected = [...PUBLIC_RELATIONS.mirrors].sort().map((m) => `public.${m}`);
    expect(expected.length, 'the fixture names no mirrors — the assertion would be vacuous').toBe(3);
    expect(rows.map((r) => `${r.schemaname}.${r.tablename}`)).toEqual(expected);
  });

  test('the exposed-schemas constant matches supabase/config.toml', () => {
    // The third instance of the same phantom family. rls_anon_column_containment
    // claimed "kept in sync with supabase/config.toml by config_drift.test.ts,
    // which asserts the two agree." Nothing asserted it. Now something does: if
    // config.toml exposes a schema the TypeScript constant does not know about,
    // that file's containment queries would scan less than PostgREST serves.
    const declared = (tomlValue(configToml, 'api', 'schemas') ?? '')
      .replace(/[[\]"']/g, '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    expect(declared.length, 'could not parse [api] schemas').toBeGreaterThan(0);
    expect([...declared].sort()).toEqual([...PUBLIC_RELATIONS.exposedSchemas].sort());
  });

  test('no published table uses REPLICA IDENTITY FULL', async () => {
    // FULL ships the entire old row in a DELETE payload, and Realtime DELETE
    // events are NOT RLS-filtered. Migration 008 removes a quiet facility's rows
    // by DELETE, which is safe ONLY because DEFAULT ships nothing but the primary
    // key. Setting FULL turns that deletion into a disclosure of the quiet
    // facility's last known bed counts to every subscriber.
    const rows = await sql()<{ relname: string; relreplident: string }[]>`
      select c.relname, c.relreplident::text
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by c.relname
    `;
    expect(rows.length, 'no public tables found — vacuous').toBe(3);
    for (const row of rows) {
      expect(row.relreplident, `public.${row.relname} is REPLICA IDENTITY FULL`).not.toBe('f');
    }
  });

  test('both append-only triggers are ENABLE ALWAYS, not merely enabled', async () => {
    // tgenabled 'O' (origin) does NOT fire under session_replication_role =
    // 'replica', which is what logical replication and many restore scripts set.
    // An 'O' trigger silently stops enforcing while every grant still looks right.
    const rows = await sql()<{ tgname: string; tgenabled: string }[]>`
      select tgname, tgenabled::text
        from pg_trigger
       where tgname in ('trg_ward_status_event_append_only', 'trg_audit_log_append_only')
       order by tgname
    `;
    expect(rows.length, 'append-only triggers are missing').toBe(2);
    for (const row of rows) {
      expect(row.tgenabled, `${row.tgname} is not ENABLE ALWAYS`).toBe('A');
    }
  });

  test('001 revoke wall: no default privilege grants EXECUTE in public to anon', async () => {
    // The defect this caught once: Supabase's own default ACL grants EXECUTE to
    // anon BY NAME, so a REVOKE ... FROM PUBLIC is a no-op against it. This
    // asserts the migration role's default no longer does.
    const rows = await sql()<{ set_by: string; acl: string }[]>`
      select pg_get_userbyid(d.defaclrole) as set_by, d.defaclacl::text as acl
        from pg_default_acl d
        join pg_namespace n on n.oid = d.defaclnamespace
       where n.nspname = 'public' and d.defaclobjtype = 'f'
         and pg_get_userbyid(d.defaclrole) = current_user
    `;
    for (const row of rows) {
      expect(row.acl, `default ACL set by ${row.set_by} still grants EXECUTE to anon`).not.toMatch(/\banon=X/);
    }
  });
});
