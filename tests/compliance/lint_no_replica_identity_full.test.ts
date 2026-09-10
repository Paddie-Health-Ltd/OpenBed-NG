import { describe, expect, test } from 'vitest';
import { runLint, withScratch, copyMigrations, place, REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER A GUARD -- scripts/lint_no_replica_identity_full.sh.
 *
 * WRITTEN 2026-09-10, AND IT SHOULD HAVE EXISTED ALREADY. That lint has been in
 * the repository since Bundle 1 with NO TEST OF ANY KIND. Its grep was rewritten
 * that day as part of the fail-open sweep, and the rewrite could have been
 * inverted, mis-anchored, or made to return empty and NOTHING IN THE REPOSITORY
 * WOULD HAVE GONE RED. A repaired guard nobody has watched fail is the same
 * position as before the repair.
 *
 * WHY THE SUBJECT MATTERS. Realtime DELETE events are not RLS-filtered, and
 * REPLICA IDENTITY FULL ships the ENTIRE OLD ROW in the delete payload. Migration
 * 008 removes a quiet facility's rows from the public mirrors by DELETE, and that
 * is safe ONLY because DEFAULT ships nothing but the primary key. FULL silently
 * converts that deletion into a broadcast of the quiet facility's last known bed
 * counts to every subscriber -- which would make quiet mode theatre.
 *
 * NOT ASSERTED HERE, deliberately: the live catalogue. `tests/db/config_drift.test.ts`
 * asserts `pg_class.relreplident` against a real database, which is the stronger
 * check and the one that catches a setting applied outside a migration. It is a
 * `db` test and never invokes this script. THE TWO ARE NOT REDUNDANT: the lint
 * catches the statement in review, before it is ever applied, including in a down
 * migration the catalogue check would only see after the fact.
 */
const LINT = 'lint_no_replica_identity_full.sh';

const banner = (name: string, body: string): string =>
  `-- ===\n-- ${name}\n-- Idempotency: n/a\n-- ===\n${body}\nVALUES ('${name}')\n`;

describe('lint_no_replica_identity_full', () => {
  test('real corpus is accepted', () => {
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, `the real migration corpus was rejected:\n${res.stdout}`).toBe(0);
    expect(res.stdout).toContain('PASS');
  });

  test.each([
    ['a forward migration', 'ALTER TABLE public.ward_public REPLICA IDENTITY FULL;'],
    ['lower case', 'alter table public.ward_public replica identity full;'],
    ['mixed case and extra whitespace', 'ALTER TABLE app.facility RePLiCa   IDENTITY    FULL;'],
    // The header claims this lint catches what the catalogue check would only see
    // after the fact. A down migration is the case that claim rests on.
    ['a DOWN migration', 'ALTER TABLE public.facility_public REPLICA IDENTITY FULL;'],
  ])('plant — REPLICA IDENTITY FULL in %s is rejected', (name, snippet) => {
    withScratch((root) => {
      copyMigrations(root);
      const file = name === 'a DOWN migration' ? '900_plant.down.sql' : '900_plant.sql';
      place(root, `database/migrations/${file}`, banner(file, snippet));
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, `the guard rejected but did not name the file:\n${res.stdout}`).toContain(file);
    });
  });

  test('plant — the same phrase inside a COMMENT is accepted', () => {
    // The false-positive direction. This prohibition is DESCRIBED in banners and
    // in COMMENT ON text across the migration corpus, and a lint that fires on
    // its own documentation is a lint someone deletes -- after which nothing
    // guards the real thing.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/901_plant.sql',
        `-- ===\n-- 901_plant.sql\n-- Idempotency: n/a\n-- Never write: REPLICA IDENTITY FULL\n-- ===\n` +
        `COMMENT ON TABLE app.facility IS 'never set REPLICA IDENTITY FULL on a published table';\n` +
        `VALUES ('901_plant.sql')\n`);
      const res = runLint(LINT, root);
      expect(res.status, `documentation of the ban tripped the ban:\n${res.stdout}`).toBe(0);
    });
  });

  test('positive control — REPLICA IDENTITY DEFAULT is accepted', () => {
    // A guard that rejects every REPLICA IDENTITY statement is a rubber stamp:
    // 007 sets DEFAULT explicitly on both mirrors, and that is the correct form.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/902_plant.sql',
        banner('902_plant.sql', 'ALTER TABLE public.ward_public REPLICA IDENTITY DEFAULT;'));
      const res = runLint(LINT, root);
      expect(res.status, `the CORRECT form was rejected:\n${res.stdout}`).toBe(0);
    });
  });

  test('anti-vacuity — an empty corpus FAILS rather than reporting clean', () => {
    withScratch((root) => {
      place(root, 'database/migrations/.keep', '');
      const res = runLint(LINT, root);
      expect(res.status, `a lint that scanned nothing reported success:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the empty-corpus refusal did not name itself').toContain('no migrations found in');
    });
  });

  test('anti-vacuity — a missing migration directory FAILS', () => {
    withScratch((root) => {
      place(root, 'unrelated.txt', 'x');
      const res = runLint(LINT, root);
      expect(res.status, `a missing corpus did not fail loudly:\n${res.stdout}`).toBe(2);
      // The message is the ONLY thing that distinguishes this leg. Delete the
      // `[ -d ]` check and `find` on a missing directory yields zero files, so
      // the empty-corpus leg exits 2 as well and the status is identical.
      expect(res.stdout, 'the missing-directory refusal did not name itself').toContain('no migration directory at');
    });
  });
});
