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

  /**
   * ONE PLANT PER CHECK, EACH ISOLATING ITS OWN.
   *
   * WHY THIS SHAPE AND NOT THE OBVIOUS ONE. All five checks ACCUMULATE through
   * `fail()`; nothing short-circuits. So a plant that trips several of them
   * still exits 1, and an assertion on the exit status alone proves nothing
   * about any individual check. Measured 2026-09-10: the `no banner` plant trips
   * checks 1, 2 AND 3 together, and the old copied-header plant tripped 2 and 4,
   * because it rewrote the ledger line as well as the banner. DELETE CHECK 1's
   * `case` ARM ENTIRELY AND EVERY TEST IN THIS FILE STAYED GREEN -- and check 2,
   * the copied-header detector this script's own header calls load-bearing, was
   * in the same state.
   *
   * Each row below satisfies every other check so exactly one can fire, and
   * asserts THAT CHECK'S OWN MESSAGE rather than the exit status.
   */
  test.each([
    [
      'check 1 — no \'-- ===\' fence, banner otherwise complete',
      VALID.replace(/-- =+/g, '-- ------------'),
      "no '-- ===' banner block at the top of the file",
    ],
    [
      'check 2 — banner names another file, ledger still correct',
      VALID.replace('-- 900_valid.sql', '-- 899_other.sql'),
      'banner does not name this file (copied header?)',
    ],
    [
      'check 3 — no Idempotency note',
      VALID.replace('-- Idempotency: re-apply is a no-op.\n', ''),
      "no 'Idempotency:' note in the banner",
    ],
    [
      'check 4 — ledger INSERT names the wrong file, banner correct',
      VALID.replace("VALUES ('900_valid.sql'", "VALUES ('899_other.sql'"),
      'does not register itself in app.schema_migrations',
    ],
  ])('plant — %s is rejected, and names that check', (_name, content, message) => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_valid.sql', content);
      place(root, 'database/migrations/900_valid.down.sql', 'SELECT 1;');
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, `a DIFFERENT check fired than the one this plant isolates:\n${res.stdout}`).toContain(message);
    });
  });

  test('plant — a file with no leading comment block at all is rejected', () => {
    // Deliberately NOT isolating: it trips checks 1, 2 and 3 together. Kept
    // because it is the plant that exposed the lint's old `head -40` banner
    // extraction -- on a short migration the ledger INSERT fell inside the first
    // 40 lines and satisfied the filename check by itself, so a file with no
    // banner passed. The check was measuring the wrong region of the file.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_valid.sql',
        "SELECT 1;\nINSERT INTO app.schema_migrations (filename, applied_at)\nVALUES ('900_valid.sql', now())\nON CONFLICT (filename) DO NOTHING;\n");
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
      expect(res.stdout, 'the pairing check did not name itself').toContain('no paired .down.sql');
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
      expect(res.stdout, 'the pairing check did not name itself').toContain('no paired .down.sql');
    });
  });

  test('anti-vacuity — an empty corpus FAILS', () => {
    withScratch((root) => {
      place(root, 'database/migrations/.keep', '');
      const res = runLint(LINT, root);
      expect(res.status, `an empty corpus did not fail loudly:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the empty-corpus refusal did not name itself').toContain('no forward migrations found in');
    });
  });

  test('anti-vacuity — a missing migration directory FAILS, and names itself', () => {
    withScratch((root) => {
      place(root, 'unrelated.txt', 'x');
      const res = runLint(LINT, root);
      expect(res.status, `a missing corpus did not fail loudly:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the missing-directory refusal did not name itself').toContain('no migration directory at');
    });
  });
});
