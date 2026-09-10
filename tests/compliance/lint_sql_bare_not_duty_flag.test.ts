import { describe, expect, test } from 'vitest';
import { runLint, withScratch, copyMigrations, place, REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER A GUARD -- scripts/lint_sql_no_bare_not_duty_flag.sh.
 *
 * The lint it checks is the SQL half of finding F2. Its TypeScript twin is the
 * ESLint rule; see tests/compliance/eslint_duty_flag_negation.test.ts.
 *
 * Three legs, per .claude/rules/test-conventions.md: PLANT each false-green and
 * assert rejection; assert the real corpus is ACCEPTED; assert an empty corpus
 * FAILS. A guard that rejects everything is a rubber stamp and one that accepts
 * everything is the defect it was written to close.
 */
const LINT = 'lint_sql_no_bare_not_duty_flag.sh';

describe('lint_sql_no_bare_not_duty_flag', () => {
  test('real corpus is accepted', () => {
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, res.stdout).toBe(0);
    expect(res.stdout).toContain('PASS');
  });

  test.each([
    ['bare NOT on a bare identifier', 'select 1 where not anaesthetist;'],
    ['bare NOT on a qualified column', 'select 1 where not ops.paediatrician;'],
    ['bare NOT on NEW in a trigger', 'if not NEW.obstetrician then return null; end if;'],
    ['mixed case', 'SELECT 1 WHERE NoT ops.anaesthetist;'],
  ])('plant — %s is rejected', (_name, snippet) => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_plant.sql', `-- ===\n-- 900_plant.sql\n-- Idempotency: n/a\n-- ===\n${snippet}\nVALUES ('900_plant.sql')\n`);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
    });
  });

  test('plant — the same text inside a comment is ACCEPTED', () => {
    // The false-positive direction, and it is not a nicety. Migration 003 carries
    // a COMMENT ON COLUMN that quotes the wrong form so a reader knows what to
    // avoid. A lint that fires on its own documentation is a lint people delete,
    // and then nothing guards the real thing.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/901_plant.sql',
        `-- ===\n-- 901_plant.sql\n-- Idempotency: n/a\n-- Never write: not ops.anaesthetist\n-- ===\n` +
        `COMMENT ON TABLE app.facility IS 'do not use not anaesthetist here';\n` +
        `VALUES ('901_plant.sql')\n`);
      const res = runLint(LINT, root);
      expect(res.status, `a comment tripped the lint:\n${res.stdout}`).toBe(0);
    });
  });

  test('anti-vacuity — an empty corpus FAILS rather than reporting clean', () => {
    withScratch((root) => {
      place(root, 'database/migrations/.keep', '');
      const res = runLint(LINT, root);
      expect(res.status, 'a lint that scanned nothing reported success').toBe(2);
      expect(res.stdout, 'the empty-corpus refusal did not name itself').toContain('no migrations found in');
    });
  });

  test('anti-vacuity — a missing migration directory FAILS', () => {
    withScratch((root) => {
      place(root, 'unrelated.txt', 'x');
      const res = runLint(LINT, root);
      expect(res.status, `a missing corpus did not fail loudly:\n${res.stdout}`).toBe(2);
      // Only the message separates this leg from the empty-corpus leg below it.
      expect(res.stdout, 'the missing-directory refusal did not name itself').toContain('no migration directory at');
    });
  });
});
