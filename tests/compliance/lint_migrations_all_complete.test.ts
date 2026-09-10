import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runLint, withScratch, place, REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER AN AGGREGATOR -- scripts/lint_migrations_all.sh.
 *
 * THE FAILURE THIS CLOSES IS DELETION, NOT BREAKAGE. The aggregator runs a
 * hard-coded LINTS array and is the ONLY thing the `migration-lint` CI job
 * invokes. Remove an entry and every one of that lint's own tests still passes
 * -- they invoke the script directly -- while the lint silently stops running in
 * CI. Nothing else in the repository would notice. A typo'd entry fails closed
 * (bash exits 127 and lands in FAILED); a DELETED entry fails open and silent,
 * which is the direction that matters.
 *
 * So the array is asserted against the set of lints that actually scan the
 * migration corpus, derived from the scripts themselves rather than restated.
 *
 * NOT ASSERTED HERE, deliberately: that each listed lint is CORRECT. Each has
 * its own guard-over-a-guard. This asserts only that the set is complete and
 * that every omission is deliberate and recorded.
 */
const AGG = 'lint_migrations_all.sh';

/**
 * Migration-corpus lints deliberately NOT in the aggregator, with the reason.
 *
 * An omission with a reason is a decision; an omission without one is the defect
 * above wearing the same clothes. Each entry must say where the lint DOES run,
 * because "it is not in the aggregator" is only acceptable if it runs somewhere.
 */
const RUN_ELSEWHERE: Record<string, string> = {
  'lint_audit_log_columns.sh':
    'Runs in the `compliance-tests` job through the ACCEPT leg of ' +
    'tests/compliance/audit_log_no_identity_columns.test.ts, which invokes it against the real ' +
    'repository root and requires exit 0. It is not in .github/workflows/ci.yml under any name, ' +
    'so a reader grepping the workflow for it will not find it -- which is exactly why this is ' +
    'written down rather than left to be rediscovered.',
};

function aggregatorList(): string[] {
  const src = readFileSync(join(REPO_ROOT, 'scripts', AGG), 'utf8');
  const block = /LINTS=\(([\s\S]*?)\)/.exec(src);
  if (!block) throw new Error('could not find the LINTS array — the aggregator was restructured');
  return (block[1] as string).split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.sh')).sort();
}

/** Lints whose corpus is the migration directory, read from the scripts themselves. */
function migrationCorpusLints(): string[] {
  const dir = join(REPO_ROOT, 'scripts');
  return readdirSync(dir)
    .filter((n) => n.startsWith('lint_') && n.endsWith('.sh'))
    .filter((n) => readFileSync(join(dir, n), 'utf8').includes('MIG_DIR="$ROOT/database/migrations"'))
    .sort();
}

describe('lint_migrations_all is complete', () => {
  test('anti-vacuity — both sides parsed to something', () => {
    expect(aggregatorList().length, 'the LINTS array parsed to nothing').toBeGreaterThan(2);
    expect(migrationCorpusLints().length, 'no migration-corpus lints found — the detector stopped matching').toBeGreaterThan(2);
  });

  test('every migration-corpus lint is aggregated, or recorded as running elsewhere', () => {
    const missing = migrationCorpusLints().filter(
      (n) => !aggregatorList().includes(n) && RUN_ELSEWHERE[n] === undefined,
    );
    expect(missing, 'these lints scan the migrations and run NOWHERE in the migration-lint job').toEqual([]);
  });

  test('every aggregated lint exists and scans the migrations', () => {
    // The other direction: an entry naming a script that was renamed or that no
    // longer reads the corpus is dead weight that reads as coverage.
    const corpus = migrationCorpusLints();
    const stale = aggregatorList().filter((n) => !corpus.includes(n));
    expect(stale, 'the aggregator names lints that do not scan the migration corpus').toEqual([]);
  });

  test('every RUN_ELSEWHERE exemption names a lint that is genuinely omitted', () => {
    // Anti-rot. If one is added to the array later, its exemption becomes a lie.
    const stale = Object.keys(RUN_ELSEWHERE).filter((n) => aggregatorList().includes(n));
    expect(stale, 'these are IN the aggregator, so their exemptions are stale').toEqual([]);
  });

  test('real corpus is accepted', () => {
    const res = runLint(AGG, REPO_ROOT);
    expect(res.status, `the aggregator rejected the real corpus:\n${res.stdout}`).toBe(0);
  });

  test('plant — a failing sub-lint fails the aggregator and NAMES it', () => {
    withScratch((root) => {
      // An empty migration directory makes every sub-lint exit 2. What is being
      // asserted is that the aggregator surfaces WHICH failed, not merely that
      // it noticed something: its whole job is to report all of them rather than
      // stopping at the first.
      place(root, 'database/migrations/.keep', '');
      const res = runLint(AGG, root);
      expect(res.status, `a failing sub-lint did not fail the aggregator:\n${res.stdout}`).toBe(1);
      expect(res.stdout, 'the aggregator did not name the rule it broke').toContain('one or more migration lints reported a violation');
      for (const lint of aggregatorList()) {
        expect(res.stdout, `${lint} failed but was not named in the summary`).toContain(lint);
      }
    });
  });
});
