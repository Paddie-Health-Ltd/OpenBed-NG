import { describe, expect, test } from 'vitest';
import { runLint, withScratch, copyMigrations, place, REPO_ROOT } from './_scratch.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GUARD OVER A GUARD -- scripts/lint_migration_header.sh.
 *
 * The two plants that matter most are the copied-header case and the wrong-ledger
 * case, because both are produced by the same real mistake: creating a migration
 * by copying its predecessor. A wrong filename in the ledger INSERT means the
 * runner re-applies that file on every run, forever, and nothing errors.
 */
const LINT = 'lint_migration_header.sh';

const VALID = `-- ============================================================
-- 900_valid.sql
-- ============================================================
-- Idempotency: re-apply is a no-op.
-- ============================================================
SELECT 1;
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('900_valid.sql', now())
ON CONFLICT (filename) DO NOTHING;
`;

describe('lint_migration_header', () => {
  test('real corpus is accepted', () => {
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, res.stdout).toBe(0);
  });

  test('a well-formed plant is accepted — the guard is not rejecting everything', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_valid.sql', VALID);
      place(root, 'database/migrations/900_valid.down.sql', 'SELECT 1;');
      expect(runLint(LINT, root).status).toBe(0);
    });
  });

  test.each([
    // No leading comment block at all. The earlier form of this plant left a
    // stray `-- ===` rule behind and was ACCEPTED, which is what exposed the
    // head -40 weakness in the lint. Kept in this stronger form.
    ['no banner', 'SELECT 1;\nINSERT INTO app.schema_migrations (filename, applied_at)\nVALUES (\'900_valid.sql\', now())\nON CONFLICT (filename) DO NOTHING;\n'],
    ['banner names another file (copied header)', VALID.replace('-- 900_valid.sql', '-- 899_other.sql').replace("VALUES ('900_valid.sql'", "VALUES ('899_other.sql'")],
    ['no idempotency note', VALID.replace('-- Idempotency: re-apply is a no-op.\n', '')],
    ['ledger INSERT names the wrong file', VALID.replace("VALUES ('900_valid.sql'", "VALUES ('899_other.sql'")],
  ])('plant — %s is rejected', (_name, content) => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_valid.sql', content);
      place(root, 'database/migrations/900_valid.down.sql', 'SELECT 1;');
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
    });
  });

  test('plant — a missing .down.sql is rejected', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_valid.sql', VALID);
      const res = runLint(LINT, root);
      expect(res.status, `a migration with no reversal was accepted:\n${res.stdout}`).toBe(1);
    });
  });

  test('plant — deleting a real .down.sql is rejected', () => {
    // Stronger than the previous plant: it proves the check applies to the REAL
    // corpus, not only to files the test invented.
    withScratch((root) => {
      copyMigrations(root);
      rmSync(join(root, 'database/migrations/006_gate_function.down.sql'));
      const res = runLint(LINT, root);
      expect(res.status, `a missing real reversal was accepted:\n${res.stdout}`).toBe(1);
    });
  });

  test('anti-vacuity — an empty corpus FAILS', () => {
    withScratch((root) => {
      place(root, 'database/migrations/.keep', '');
      expect(runLint(LINT, root).status).toBe(2);
    });
  });
});
