import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withScratch, place, REPO_ROOT } from './_scratch.js';

/**
 * THE TOP LEVEL OF THIS REPOSITORY IS A CLOSED, NAMED SET (R-2026-09-22-58 C).
 *
 * WHY IT EXISTS, and it is a defect rather than a preference. A Cowork-written file
 * appeared at the top level twice: once it reached a commit (38440e7 added a handoff
 * under an untracked working-tree directory, remedied two commits later in 999dd50),
 * and once it reached the index. NEITHER WAS CAUGHT BY ANYTHING EXCEPT A PERSON
 * LOOKING. Staging named paths is the habit that is supposed to prevent it, and a
 * habit is exactly what this repository does not accept as a control: it is the same
 * argument already made against a pre-commit hook, against a comment claiming a
 * cross-file link, and against every guard whose verdict something else must
 * remember to consume.
 *
 * WHY IT READS THE INDEX rather than HEAD. `git ls-files` reports what is STAGED,
 * so a stray is caught before the commit that would carry it, not afterwards. A
 * guard that only read HEAD would report the first instance one commit too late,
 * which is precisely how the first instance happened.
 *
 * WHY A LITERAL TABLE, AND WHY THAT IS NOT A MAGIC NUMBER. The set is asserted by
 * IDENTITY, not by count (.claude/rules/test-conventions.md section 3): seven
 * entries and seven different entries are the same count. The table decays LOUDLY —
 * adding or renaming anything at the top level reddens this and forces a one-line
 * decision, which is the review the two strays never got.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - anything about UNTRACKED files. This sees the index, so an untracked stray is
 *     invisible to it. That case is covered by a different mechanism and a blunt
 *     one: scripts/deploy_pages.sh refuses any non-empty `git status --porcelain`,
 *     so an untracked file at any level blocks a deploy.
 *   - the CONTENTS of any top-level entry. A stray committed INSIDE docs/ or tests/
 *     is not this guard's business and would not red it.
 */

/** Top-level entries in the INDEX — the first path component of every tracked file. */
export function topLevelEntries(root: string): string[] {
  const out = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const names = new Set<string>();
  for (const line of out.split('\n')) {
    if (line.trim() === '') continue;
    names.add(line.split('/')[0] ?? line);
  }
  return [...names].sort();
}

/**
 * THE SET, as of R-2026-09-22-58 C. Twelve directories and thirteen files.
 *
 * Adding an entry here is a deliberate act with a name attached, which is the whole
 * point: the two strays that produced this guard would each have required an edit to
 * this list, in the same change, under review.
 */
const EXPECTED = [
  '.ci',
  '.claude',
  '.github',
  '.gitignore',
  '.nvmrc',
  'LICENSE',
  'NOTICE',
  'README.md',
  'SECURITY.md',
  'Sprint Kickoffs',
  'apps',
  'database',
  'docs',
  'eslint.config.d.mts',
  'eslint.config.mjs',
  'package-lock.json',
  'package.json',
  'packages',
  'scripts',
  'supabase',
  'supabase-proxy',
  'tests',
  'tsconfig.base.json',
  'tsconfig.json',
  'vitest.config.ts',
].sort();

/**
 * A scratch repository with the given paths staged.
 *
 * THE SCRATCH PATHS NAME NO REAL SCRIPT, deliberately. tests/compliance/_legs.ts
 * maps a test file to the guard it proves by matching `scripts/<name>.sh` literals
 * anywhere in its text, including comments. A literal naming a real script would
 * enrol this file as evidence for that script's legs, and a string here could then
 * credit a leg nothing in this file actually exercises.
 */
function repoWithStaged(root: string, paths: readonly string[]): string {
  const work = join(root, 'work');
  for (const p of paths) place(root, `work/${p}`, 'x\n');
  execFileSync('git', ['-C', work, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', work, 'add', '-A'], { stdio: 'ignore' });
  return work;
}

describe('the top level is a closed, named set', () => {
  test('the real repository matches the recorded set exactly', () => {
    expect(
      topLevelEntries(REPO_ROOT),
      'the top level of the repository changed — add or remove the entry in EXPECTED, in this change, or move the file',
    ).toEqual(EXPECTED);
  });

  test('anti-vacuity — the reader returns a non-trivial set over the real repository', () => {
    // A `git ls-files` that stopped resolving would return nothing, and an empty set
    // compared against an empty EXPECTED would be green. EXPECTED is non-empty by
    // the leg above; this pins the READER independently of the table.
    const found = topLevelEntries(REPO_ROOT);
    expect(found.length, 'the index reader found nothing — it is not reading this repository').toBeGreaterThan(10);
    expect(found, 'the index reader did not find scripts/, which certainly is tracked').toContain('scripts');
  });

  test('plant — a STAGED stray at the top level is rejected, before any commit carries it', () => {
    // THE EXACT SHAPE THAT HAPPENED TWICE, and in the state it is catchable in: the
    // file is staged and not yet committed.
    withScratch((root) => {
      const work = repoWithStaged(root, ['scripts/placeholder.sh', 'Claude outputs/handoff.md']);
      const found = topLevelEntries(work);
      expect(found, 'the stray was not seen at all — the reader is the thing that is broken').toContain('Claude outputs');
      expect(found, 'a staged stray compared equal to the recorded set').not.toEqual(['scripts']);
    });
  });

  test('plant — a stray in a DEEP path is still reported by its top-level entry', () => {
    // The guard is about the top level, so a stray nested three directories down
    // must still surface as its first component rather than being missed.
    withScratch((root) => {
      const work = repoWithStaged(root, ['scripts/placeholder.sh', 'Claude outputs/nested/deep/file.md']);
      expect(topLevelEntries(work)).toEqual(['Claude outputs', 'scripts']);
    });
  });

  test('positive control — a repository holding only recorded entries is accepted', () => {
    // THE ORDINARY VALID INPUT. A guard that refuses the correct shape is disabled
    // by whoever hits it (test-conventions section 2, fifth clause).
    withScratch((root) => {
      const work = repoWithStaged(root, ['scripts/placeholder.sh', 'docs/a.md', 'tests/db/x.test.ts', 'README.md']);
      expect(topLevelEntries(work)).toEqual(['README.md', 'docs', 'scripts', 'tests']);
    });
  });

  test('anti-vacuity — a repository with nothing staged returns nothing, and that is not a pass', () => {
    withScratch((root) => {
      const work = join(root, 'work');
      place(root, 'work/.keep', '');
      execFileSync('git', ['-C', work, 'init', '-q'], { stdio: 'ignore' });
      // Nothing added. The reader must report the empty set rather than throwing,
      // and the comparison against EXPECTED is what makes empty a FAILURE.
      expect(topLevelEntries(work)).toEqual([]);
      expect(topLevelEntries(work), 'an empty index compared equal to the real set').not.toEqual(EXPECTED);
    });
  });
});
