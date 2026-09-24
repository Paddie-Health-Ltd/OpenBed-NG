import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withScratch, place, copyMigrations, runLint, REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER scripts/lint_public_table_rls.sh (R-2026-09-22-56 C; every form,
 * R-2026-09-23-65 A2).
 *
 * THE RULE IT ENFORCES: every table created in schema `public`, or moved into it,
 * ENABLEs and FORCEs row level security in the SAME migration — and every form the
 * lint cannot read is refused by name rather than passed. Each form in the script's
 * header has a plant below that is RED as planted and GREEN once corrected.
 *
 * WHY THE ACCEPT LEG NAMES THE TABLES. A detector whose regex stopped matching
 * reports exit 0 over a clean corpus and exit 0 over a corpus it never read — the
 * highest-probability silent pass in this change. So the lint prints the names it
 * paired and this file asserts the four real ones by IDENTITY
 * (.claude/rules/test-conventions.md section 3), not a count and not "PASS".
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - the live catalogue, which is tests/db/rls_enabled_everywhere.test.ts. That
 *     test and this lint are complements: it sees only what has been applied, and
 *     only afterwards; the lint sees the statement in review.
 *   - that a pattern match which cannot compile is exit 2. Every pattern is a
 *     constant in the script, so reaching it means editing the script; it is
 *     registered as could-not-run in packages/fixtures/leg-coverage.json rather than
 *     faked here. The OTHER could-not-run branch, a lexer that did not run, IS
 *     planted below, through a stub `perl` on PATH.
 */
const LINT = 'lint_public_table_rls.sh';

/** A migration in the shape scripts/lint_migration_header.sh requires. */
const mig = (name: string, body: string): string =>
  `-- ===\n-- ${name}\n-- Idempotency: CREATE TABLE IF NOT EXISTS.\n-- ===\n${body}\nINSERT INTO app.schema_migrations (filename) VALUES ('${name}')\n`;

const CREATE = 'CREATE TABLE IF NOT EXISTS public.plant_table (id uuid PRIMARY KEY);';
const ENABLE = 'ALTER TABLE public.plant_table ENABLE ROW LEVEL SECURITY;';
const FORCE = 'ALTER TABLE public.plant_table FORCE ROW LEVEL SECURITY;';

describe('lint_public_table_rls.sh', () => {
  test('real corpus is accepted', () => {
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, `the frozen corpus was rejected:\n${res.stdout}`).toBe(0);
    expect(res.stdout).toContain('PASS');
  });

  test('the detector found the four public tables — not a green over a corpus it never read', () => {
    // THE ANTI-VACUITY THAT MATTERS HERE, and it is stronger than a non-empty
    // corpus check: it asserts the scan RECOGNISED each real table, by name.
    const res = runLint(LINT, REPO_ROOT);
    for (const table of ['facility_public', 'ward_public', 'lga_rollup', 'snapshot_current']) {
      expect(res.stdout, `the lint did not report pairing public.${table}:\n${res.stdout}`).toContain(table);
    }
  });

  test('plant — a public table created without ENABLE is rejected', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_plant.sql', mig('900_plant.sql', CREATE));
      const res = runLint(LINT, root);
      expect(res.status, `an unprotected public table was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, 'the summary line that names the verdict was not printed').toContain('lint_public_table_rls.sh: FAILED (');
      expect(res.stdout).toContain('is created in 900_plant.sql and never ENABLEs row level security');
      expect(res.stdout, 'the refusal did not say what the consequence is').toContain(
        'A public table with RLS off is readable by anon the moment PostgREST exposes the schema.',
      );
    });
  });

  test('plant — a public table with ENABLE but no FORCE is rejected', () => {
    // THE SEPARATE HALF -56 C ASKS FOR. ENABLE alone reads as protection: the owner
    // still bypasses every policy, and the projection trigger runs as that owner.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_plant.sql', mig('900_plant.sql', `${CREATE}\n${ENABLE}`));
      const res = runLint(LINT, root);
      expect(res.status, `an ENABLE-only public table was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout).toContain('ENABLEs row level security in 900_plant.sql but never FORCEs it');
      expect(res.stdout, 'the ENABLE half fired too — the two checks are not independent').not.toContain(
        'never ENABLEs row level security',
      );
    });
  });

  test('plant — the pairing must be in the SAME file, not a later migration', () => {
    // The window between the two migrations is the hole: however long it takes the
    // next one to be applied hosted, the table is live and unprotected.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_plant.sql', mig('900_plant.sql', CREATE));
      place(root, 'database/migrations/901_secure.sql', mig('901_secure.sql', `${ENABLE}\n${FORCE}`));
      const res = runLint(LINT, root);
      expect(res.status, `a split pairing was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout).toContain('is created in 900_plant.sql and never ENABLEs row level security');
    });
  });

  test('plant — a DOWN migration that re-creates a public table without RLS is rejected', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_plant.down.sql', mig('900_plant.down.sql', CREATE));
      const res = runLint(LINT, root);
      expect(res.status, `a down migration was skipped — the same hole, unwatched:\n${res.stdout}`).toBe(1);
      expect(res.stdout).toContain('900_plant.down.sql');
    });
  });

  test('plant — a table created with no schema qualifier is rejected', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_plant.sql', mig('900_plant.sql', 'CREATE TABLE unqualified (id uuid PRIMARY KEY);'));
      const res = runLint(LINT, root);
      expect(res.status, `a search_path-dependent table was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout).toContain('a table is created without a schema qualifier, so it lands wherever search_path points');
    });
  });

  test('positive control — a public table with ENABLE and FORCE is accepted', () => {
    // THE MOST ORDINARY VALID INPUT (test-conventions section 2, fifth clause). A
    // guard that refuses the correct form is disabled by whoever hits it at 2am.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_plant.sql', mig('900_plant.sql', `${CREATE}\n${ENABLE}\n${FORCE}`));
      const res = runLint(LINT, root);
      expect(res.status, `a correctly secured public table was refused:\n${res.stdout}`).toBe(0);
      expect(res.stdout, 'the new table was not recognised at all').toContain('plant_table');
    });
  });

  test('positive control — an app. table with no RLS is accepted', () => {
    // 16 of them exist and carry no RLS by design: no client role holds a grant on
    // them and `app` is not exposed, so RLS there would guard against a caller that
    // cannot arrive. The real corpus proves this too; this states it deliberately.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_plant.sql', mig('900_plant.sql', 'CREATE TABLE IF NOT EXISTS app.plant_table (id uuid PRIMARY KEY);'));
      const res = runLint(LINT, root);
      expect(res.status, `an app-schema table was treated as a public one:\n${res.stdout}`).toBe(0);
    });
  });

  test('positive control — the same statements inside a COMMENT are accepted', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_plant.sql', mig('900_plant.sql', `-- ${CREATE}\n-- and it would need ${ENABLE}\nSELECT 1;`));
      const res = runLint(LINT, root);
      expect(res.status, `a commented example tripped the lint that describes it:\n${res.stdout}`).toBe(0);
    });
  });

  test('positive control — a table NAME inside a string literal is not a creation', () => {
    // RESTATED 2026-09-23 (R-2026-09-23-65 A2), and tightened, not loosened. This leg
    // used to accept `SELECT 'CREATE TABLE public.not_really (id uuid)'`. A string
    // holding a CREATING FORM is now refused as dynamic SQL — the lint cannot tell a
    // string that is EXECUTEd from one that is not — and that exact string is planted
    // below as a refusal. What stays accepted is prose that NAMES a table, which is
    // what COMMENT ON strings in this corpus actually contain.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_plant.sql', mig('900_plant.sql', `COMMENT ON TABLE app.facility IS 'mirrored into public.facility_public; see public.ward_public';`));
      const res = runLint(LINT, root);
      expect(res.status, `a table name in a string was read as a statement:\n${res.stdout}`).toBe(0);
    });
  });

  /**
   * EVERY FORM THAT CAN CREATE OR MOVE A TABLE INTO public (R-2026-09-23-65 A2).
   *
   * Each row is planted RED — the form without its pairing, or a form the lint
   * cannot read — and then GREEN, the same file corrected. Several are planted as
   * DOWN migrations on purpose: for an up migration the catalogue test sees the
   * result, and for a down migration this lint is the only thing that looks.
   */
  const PAIR = (t: string): string => `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.${t} FORCE ROW LEVEL SECURITY;`;
  test.each([
    ['UNLOGGED', '900_plant.down.sql', 'CREATE UNLOGGED TABLE public.plant_table (id int);', `CREATE UNLOGGED TABLE public.plant_table (id int);\n${PAIR('plant_table')}`, 'is created in 900_plant.down.sql and never ENABLEs row level security'],
    ['a fully quoted "public"."x"', '900_plant.down.sql', 'CREATE TABLE "public"."plant_table" (id int);', `CREATE TABLE "public"."plant_table" (id int);\n${PAIR('plant_table')}`, 'is created in 900_plant.down.sql and never ENABLEs row level security'],
    ['a half-quoted public."x"', '900_plant.sql', 'CREATE TABLE public."plant_table" (id int);', `CREATE TABLE public."plant_table" (id int);\nALTER TABLE "public"."plant_table" ENABLE ROW LEVEL SECURITY;\nALTER TABLE public."plant_table" FORCE ROW LEVEL SECURITY;`, 'is created in 900_plant.sql and never ENABLEs row level security'],
    ['a quoted name that is not plain lowercase', '900_plant.down.sql', 'CREATE TABLE "public"."Plant_Table" (id int);', `CREATE TABLE "public"."plant_table" (id int);\n${PAIR('plant_table')}`, 'names a table with a quoted identifier this lint does not read (not plain lowercase)'],
    ['SET SCHEMA public, from app', '900_plant.down.sql', 'ALTER TABLE app.plant_table SET SCHEMA public;', `ALTER TABLE app.plant_table SET SCHEMA public;\n${PAIR('plant_table')}`, 'public.plant_table is moved into public in 900_plant.down.sql and never ENABLEs row level security'],
    ['SET SCHEMA public, unqualified source', '900_plant.sql', 'ALTER TABLE IF EXISTS plant_table SET SCHEMA "public";', `ALTER TABLE IF EXISTS plant_table SET SCHEMA "public";\n${PAIR('plant_table')}`, 'public.plant_table is moved into public in 900_plant.sql and never ENABLEs row level security'],
    ['an unqualified CREATE TABLE ... AS', '900_plant.down.sql', 'CREATE TABLE plant_table AS SELECT 1 AS id;', `CREATE TABLE public.plant_table AS SELECT 1 AS id;\n${PAIR('plant_table')}`, 'a table is created without a schema qualifier, so it lands wherever search_path points'],
    ['a CREATE TABLE split across lines', '900_plant.down.sql', 'CREATE TABLE IF NOT EXISTS\n    public.plant_table (\n    id int);', `CREATE TABLE IF NOT EXISTS\n    public.plant_table (\n    id int);\n${PAIR('plant_table')}`, 'is created in 900_plant.down.sql and never ENABLEs row level security'],
    ['SELECT ... INTO public.x', '900_plant.down.sql', 'SELECT 1 AS id INTO public.plant_table;', `SELECT 1 AS id INTO public.plant_table;\n${PAIR('plant_table')}`, 'public.plant_table is created by SELECT INTO in 900_plant.down.sql and never ENABLEs row level security'],
    ['a top-level unqualified SELECT INTO', '900_plant.down.sql', 'SELECT 1 AS id INTO plant_table;', `SELECT 1 AS id INTO public.plant_table;\n${PAIR('plant_table')}`, 'a top-level SELECT INTO creates a table without a schema qualifier'],
    ['a CREATE TABLE inside a function body', '900_plant.sql', 'DO $$ BEGIN CREATE TABLE public.plant_table (id int); END $$;', `DO $$ BEGIN CREATE TABLE public.plant_table (id int); END $$;\n${PAIR('plant_table')}`, 'is created in 900_plant.sql and never ENABLEs row level security'],
    ['a foreign table', '900_plant.down.sql', 'CREATE FOREIGN TABLE public.plant_table (id int) SERVER s;', 'CREATE FOREIGN TABLE app.plant_table (id int) SERVER s;', 'creates a foreign table, whose row level security this lint cannot establish'],
    ['IMPORT FOREIGN SCHEMA into public', '900_plant.down.sql', 'IMPORT FOREIGN SCHEMA remote FROM SERVER s INTO public;', 'IMPORT FOREIGN SCHEMA remote FROM SERVER s INTO app;', 'imports a foreign schema into public, whose tables this lint cannot see'],
    ['an extension installed into public', '900_plant.down.sql', 'CREATE EXTENSION IF NOT EXISTS postgis SCHEMA public;', 'CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;', 'installs an extension into public or wherever search_path points'],
    ['an extension with no schema named', '900_plant.sql', 'CREATE EXTENSION IF NOT EXISTS postgis;', 'CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;', 'installs an extension into public or wherever search_path points'],
    ['an extension moved into public', '900_plant.down.sql', 'ALTER EXTENSION postgis SET SCHEMA public;', 'ALTER EXTENSION postgis SET SCHEMA extensions;', 'installs an extension into public or wherever search_path points'],
    ['dynamic SQL through EXECUTE', '900_plant.down.sql', "DO $$ BEGIN EXECUTE 'CREATE TABLE public.plant_table (id int)'; END $$;", 'DO $$ BEGIN CREATE TABLE public.plant_table (id int); ALTER TABLE public.plant_table ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY; END $$;', 'builds SQL in a string that creates or moves a table, which this lint cannot read'],
    ['a creating form in a bare string — the leg this file used to accept', '900_plant.sql', "SELECT 'CREATE TABLE public.not_really (id uuid)';", "SELECT 'public.not_really';", 'builds SQL in a string that creates or moves a table, which this lint cannot read'],
    ['NO FORCE, which is not FORCE', '900_plant.down.sql', `${CREATE}\n${ENABLE}\nALTER TABLE public.plant_table NO FORCE ROW LEVEL SECURITY;`, `${CREATE}\n${ENABLE}\n${FORCE}`, 'ENABLEs row level security in 900_plant.down.sql but never FORCEs it'],
    ['a DISABLE after the pairing', '900_plant.down.sql', `${CREATE}\n${ENABLE}\n${FORCE}\nALTER TABLE public.plant_table DISABLE ROW LEVEL SECURITY;`, `${CREATE}\n${ENABLE}\n${FORCE}`, 'DISABLEs or NO-FORCEs row level security on public.plant_table, undoing the pairing'],
    ['an unterminated dollar-quoted body', '900_plant.down.sql', 'DO $$ BEGIN PERFORM 1;', 'DO $$ BEGIN PERFORM 1; END $$;', 'cannot be lexed, so nothing in it was checked'],
  ])('plant — %s is refused, and its corrected form is accepted', (_label, file, bad, good, expected) => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, `database/migrations/${file}`, mig(file, bad));
      const red = runLint(LINT, root);
      expect(red.status, `RED half: the form was accepted:\n${red.stdout}`).toBe(1);
      expect(red.stdout, 'RED half: refused, but not for the reason planted').toContain(expected);

      place(root, `database/migrations/${file}`, mig(file, good));
      const green = runLint(LINT, root);
      expect(green.status, `GREEN half: the corrected form was refused:\n${green.stdout}`).toBe(0);
    });
  });

  test.each([
    ['ENABLE and FORCE in ONE ALTER TABLE', `${CREATE}\nALTER TABLE public.plant_table ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;`],
    ['a PL/pgSQL SELECT ... INTO a variable', `${CREATE}\n${ENABLE}\n${FORCE}\nCREATE FUNCTION app.plant_fn() RETURNS int LANGUAGE plpgsql AS $fn$\nDECLARE v_n int;\nBEGIN\n  SELECT count(*) INTO v_n FROM public.plant_table;\n  RETURN v_n;\nEND\n$fn$;`],
    ['a temporary table', 'CREATE TEMP TABLE plant_scratch (id int);\nCREATE TEMPORARY TABLE IF NOT EXISTS plant_scratch2 AS SELECT 1;'],
    ['EXECUTE of a statement that creates no table — the shape 003 uses', `DO $$ BEGIN EXECUTE 'CREATE TRIGGER trg_x BEFORE UPDATE ON app.facility FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()'; END $$;`],
    ['an INSERT ... SELECT, whose INTO creates nothing', `${CREATE}\n${ENABLE}\n${FORCE}\nINSERT INTO public.plant_table (id) SELECT 1;`],
    ['an E-string holding an escaped quote, and a nested block comment', `/* outer /* inner */ still a comment */\nSELECT E'it\\'s fine';\n${CREATE}\n${ENABLE}\n${FORCE}`],
  ])('positive control — %s is accepted', (_label, body) => {
    // THE MOST ORDINARY VALID INPUT (test-conventions section 2, fifth clause), for
    // each shape the widened reading could newly mistake for a violation.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_plant.sql', mig('900_plant.sql', body));
      const res = runLint(LINT, root);
      expect(res.status, `an ordinary valid form was refused:\n${res.stdout}`).toBe(0);
    });
  });

  test('positive control — case and whitespace do not change the verdict', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(
        root,
        'database/migrations/900_plant.sql',
        mig('900_plant.sql', 'create  table   if not exists  public.plant_table (id uuid);\nalter table  public.plant_table  enable   row  level  security;\nALTER TABLE ONLY public.plant_table FORCE ROW LEVEL SECURITY;'),
      );
      const res = runLint(LINT, root);
      expect(res.status, `a correct statement in another case or spacing was refused:\n${res.stdout}`).toBe(0);
      expect(res.stdout, 'the lowercase creation was not recognised').toContain('plant_table');
    });
  });

  test('anti-vacuity — an empty migration directory FAILS rather than reporting clean', () => {
    withScratch((root) => {
      place(root, 'database/migrations/.keep', '');
      const res = runLint(LINT, root);
      expect(res.status, `an empty corpus reported clean:\n${res.stdout}`).toBe(2);
      // The MESSAGE is what separates this leg from the one below: delete the
      // directory check and `find` on a missing directory also yields zero files.
      expect(res.stdout).toContain('no migrations found in');
    });
  });

  test('plant — a lexer that did not run is exit 2 and never a verdict', () => {
    // A perl that fails to run must not read as "nothing to check". The seam is a
    // stub `perl` first on PATH — portable, unlike an unreadable-file seam, whose
    // behaviour under a root CI user is untested.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'stub/perl', '#!/bin/sh\nexit 1\n');
      chmodSync(join(root, 'stub', 'perl'), 0o755);
      let status = 0;
      let out = '';
      try {
        execFileSync('bash', [join(REPO_ROOT, 'scripts', LINT), root], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PATH: `${join(root, 'stub')}:${process.env.PATH ?? ''}` },
        });
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        status = err.status ?? -1;
        out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
      }
      expect(status, `a lexer that did not run produced a verdict:\n${out}`).toBe(2);
      expect(out).toContain('ERROR: the SQL lexer did not run -- nothing in ');
      expect(out, 'a could-not-run was reported as a violation').not.toContain('FAILED (');
    });
  });

  test('anti-vacuity — a missing migration directory FAILS', () => {
    withScratch((root) => {
      place(root, 'unrelated.txt', 'x');
      const res = runLint(LINT, root);
      expect(res.status, `a missing corpus reported clean:\n${res.stdout}`).toBe(2);
      expect(res.stdout).toContain('no migration directory at');
    });
  });
});
