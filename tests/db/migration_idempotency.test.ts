import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
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

/**
 * A digest of everything a migration could legitimately change.
 *
 * Structure AND row counts. A structural digest alone would miss the case the
 * plant below exercises: a statement that succeeds and mutates data.
 */
async function digest(): Promise<string> {
  const [row] = await sql()<{ d: string }[]>`
    with cols as (
      select string_agg(table_schema||'.'||table_name||'.'||column_name||':'||data_type, ',' order by table_schema, table_name, ordinal_position) s
        from information_schema.columns where table_schema in ('app','public')
    ), enums as (
      select string_agg(t.typname||':'||e.enumlabel, ',' order by t.typname, e.enumsortorder) s
        from pg_type t join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'app'
    ), funcs as (
      select string_agg(p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', ',' order by p.proname) s
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('app','public')
    ), trigs as (
      select string_agg(tgname||':'||tgenabled::text, ',' order by tgname) s
        from pg_trigger where not tgisinternal
    ), cons as (
      select string_agg(conname, ',' order by conname) s
        from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname in ('app','public')
    ), contents as (
      -- CONTENT HASH per table, not merely a row count.
      --
      -- A row count catches an unconditional INSERT. It does NOT catch an
      -- in-place mutation -- UPDATE ... SET x = x + 1, or an
      -- ON CONFLICT DO UPDATE SET touched_at = now(). That case changes no
      -- structure and no cardinality, and a count-based digest reports the run
      -- idempotent. Found by planting exactly that against a tracked migration
      -- during the behavioural pass, where the count-based digest missed it.
      select string_agg(
               t.tablename||'='||
               (xpath('/row/c/text()', query_to_xml(
                  format('select coalesce(md5(string_agg(x::text, '''' order by x::text)), ''empty'') as c from app.%I x', t.tablename),
                  false, true, '')))[1]::text,
               ',' order by t.tablename) s
        from pg_tables t where t.schemaname = 'app'
    )
    select cols.s||'|'||enums.s||'|'||funcs.s||'|'||trigs.s||'|'||cons.s||'|'||contents.s as d
      from cols, enums, funcs, trigs, cons, contents
  `;
  return row?.d ?? '';
}

describe('migration idempotency', () => {
  test('the corpus is non-empty — the guard is not scanning nothing', () => {
    expect(FORWARD.length).toBeGreaterThan(10);
  });

  test('re-applying every forward migration raises no error and changes nothing', async () => {
    const before = await digest();
    expect(before.length, 'digest came back empty — it would compare equal trivially').toBeGreaterThan(500);

    for (const f of FORWARD) {
      expect(() => applyFile(join(MIG_DIR, f)), `${f} failed on re-apply`).not.toThrow();
    }

    const after = await digest();
    expect(after, 're-applying the migrations changed the schema or the data').toBe(before);
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
    // THE IMPORTANT PLANT. This one never errors. Only the row-count half of the
    // digest sees it, which is why the digest is not structure-only.
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

      expect(after, 'a silently mutating re-apply was NOT caught by the digest').not.toBe(before);
    } finally {
      execFileSync('bash', ['-c',
        `${psql} -c 'DROP TABLE IF EXISTS app.plant_mutate_probe' >/dev/null 2>&1 || true`]);
    }
  });
});
