import { describe, expect, test } from 'vitest';
import { runLint, withScratch, copyMigrations, place, REPO_ROOT } from './_scratch.js';
import { rmSync, readdirSync, readFileSync } from 'node:fs';
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

/**
 * WHAT THE SCRATCH TREE ACTUALLY CONTAINED, rendered into the failure message.
 *
 * The lint's own `FAIL:` line says which CHECK failed; this says whether the
 * inputs were what the test believed it wrote. The two together separate the
 * three possibilities that `expected 1 to be +0` cannot:
 *
 *   - a file is MISSING       -> the .down.sql pairing check fired, and the
 *                                question is why the write or copy did not land;
 *   - a file is PRESENT but its bytes are wrong -> the plant or the copy is at
 *                                fault, not the lint;
 *   - inputs are exactly right -> the lint itself is nondeterministic.
 *
 * Written 2026-09-09, after this test went red once on GitHub Actions and passed
 * on a re-run of the IDENTICAL commit, with every environmental hypothesis
 * (BSD vs GNU awk, bash 3.2 vs 5.2, a divergent corpus, a concurrent writer into
 * the real tree) excluded and no root cause found. The cause is still unknown.
 * This is not a fix and must not be recorded as one -- it is the instrumentation
 * that makes the next occurrence answerable instead of another round of guessing.
 */
function describeFailure(root: string, stdout: string): string {
  const dir = join(root, 'database/migrations');
  let listing: string;
  try {
    listing = readdirSync(dir).sort().join('\n  ');
  } catch (e) {
    listing = `<unreadable: ${(e as Error).message}>`;
  }
  let planted: string;
  try {
    planted = JSON.stringify(readFileSync(join(dir, '900_valid.sql'), 'utf8'));
  } catch (e) {
    planted = `<unreadable: ${(e as Error).message}>`;
  }
  return [
    'a well-formed migration was rejected.',
    '',
    'lint output:',
    stdout,
    '',
    `scratch root: ${root}`,
    'scratch migrations directory:',
    `  ${listing}`,
    '',
    'planted 900_valid.sql as written to disk:',
    `  ${planted}`,
  ].join('\n');
}

describe('lint_migration_header', () => {
  test('real corpus is accepted', () => {
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, res.stdout).toBe(0);
  });

  /**
   * THE ACCEPT LEG CARRIES THE GUARD'S OUTPUT, exactly as the PLANT legs below do.
   *
   * It did not until 2026-09-09, and that omission cost a full CI round trip. This
   * test went red on GitHub while passing on macOS AND in a Linux container, and
   * the assertion could report only `expected 1 to be +0` -- the lint had printed
   * a `FAIL:` line naming the offending file and the failed check, and the test
   * discarded it. Every environmental hypothesis (BSD vs GNU awk, bash 3.2 vs 5.2,
   * a divergent corpus) had to be excluded one at a time because the one artefact
   * that would have answered it in a second was thrown away.
   *
   * A leg that asserts ACCEPTANCE needs its diagnostic MORE than a leg that
   * asserts rejection, not less: a rejection failure means the guard did nothing,
   * which is one state, while an acceptance failure means the guard did something
   * and only its output says what.
   */
  test('a well-formed plant is accepted — the guard is not rejecting everything', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_valid.sql', VALID);
      place(root, 'database/migrations/900_valid.down.sql', 'SELECT 1;');
      const res = runLint(LINT, root);
      expect(res.status, describeFailure(root, res.stdout)).toBe(0);
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
      const res = runLint(LINT, root);
      expect(res.status, `an empty corpus did not fail loudly:\n${res.stdout}`).toBe(2);
    });
  });
});
