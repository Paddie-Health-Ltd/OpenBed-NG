import { describe, expect, test } from 'vitest';
import { withScratch, place, copyMigrations, runLint, REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER scripts/lint_public_table_rls.sh (R-2026-09-22-56 C).
 *
 * THE RULE IT ENFORCES: every table created in schema `public` ENABLEs and FORCEs
 * row level security in the SAME migration that creates it.
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
 *   - that the lint's `could not run` branches fire. They need an unreadable-input
 *     seam whose behaviour under a root CI user is untested, and they are registered
 *     as such in packages/fixtures/leg-coverage.json rather than faked here.
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

  test('positive control — a table name inside a STRING LITERAL is not a creation', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_plant.sql', mig('900_plant.sql', `SELECT 'CREATE TABLE public.not_really (id uuid)';`));
      const res = runLint(LINT, root);
      expect(res.status, `a string literal was read as a statement:\n${res.stdout}`).toBe(0);
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

  test('anti-vacuity — a missing migration directory FAILS', () => {
    withScratch((root) => {
      place(root, 'unrelated.txt', 'x');
      const res = runLint(LINT, root);
      expect(res.status, `a missing corpus reported clean:\n${res.stdout}`).toBe(2);
      expect(res.stdout).toContain('no migration directory at');
    });
  });
});
