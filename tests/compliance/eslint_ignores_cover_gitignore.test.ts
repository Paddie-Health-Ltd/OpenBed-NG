import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';
import ESLINT_CONFIG from '../../eslint.config.mjs';

/**
 * EVERY DIRECTORY `.gitignore` EXCLUDES IS IGNORED BY ESLint, OR CARRIES A NAMED
 * EXEMPTION (R-2026-09-21-49).
 *
 * THE DEFECT THIS CLOSES. `.gitignore` lines 42-43 list `.wrangler/` and
 * `.functions-build/` adjacently, under one comment ending "Both generated, never
 * committed." `eslint.config.mjs` carried the second across and not the first. The
 * result was 67 ESLint errors inside a wrangler build artefact -- code nobody in
 * this repository wrote.
 *
 * WHY IT SURVIVED, WHICH IS THE MORE INTERESTING HALF. CI cannot see it: the
 * `repo-lint` job runs `npm ci`, `npm run typecheck` and `npx eslint .` and performs
 * NO BUILD, so the artefact does not exist in that job's workspace. It is visible
 * only to someone who builds and lints on the same machine, and a green CI badge
 * says nothing about it either way. **A guard that only fires where nobody looks is
 * the shape this repository has recorded five times**, and the fix is a check that
 * needs neither the artefact nor a build to run.
 *
 * WHY THE WHOLE `.gitignore`, NOT THE TWO THAT WERE WRONG. Deriving the list from
 * every directory entry -- rather than from those under a "generated" comment --
 * means a NEW generated directory added to `.gitignore` without that comment still
 * reds here. The founder's wording, and it is the difference between fixing an
 * instance and closing a class. When it was first run it found FOUR uncovered
 * directories, not the one that was reported.
 *
 * ONE DIRECTION ONLY. Gitignored directory => must be ESLint-ignored. The converse
 * is not asserted and must not be: `packages/fixtures/**` is ESLint-ignored and is
 * checked into git on purpose, because it is JSON fixtures rather than code.
 *
 * NOT ASSERTED HERE, deliberately: that ESLint would actually have LINTED any of
 * these directories. That depends on which files exist at the moment the linter
 * runs, which is exactly the build-dependent condition that made the original
 * defect invisible. This asserts the configuration, which is true whether or not
 * anyone has built.
 */

/**
 * Directories excluded from ESLint that are NOT in `.gitignore`, each with the
 * reason it is exempt.
 *
 * IT IS EMPTY, AND ITS EMPTINESS IS ASSERTED. The precedent is
 * `.ci/ci-gate-exceptions.yml`, whose own header says adding an entry must be "a
 * visible, reviewable act". An exemption map that can grow quietly is a hole with a
 * comment next to it; one whose emptiness is a test is a hole somebody has to open
 * in a diff.
 */
const EXEMPTIONS: Record<string, string> = {};

/** Directory entries in a `.gitignore`: not comments, not blank, not negations. */
export function gitignoreDirectories(gitignore: string): string[] {
  return gitignore
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('!'))
    .filter((l) => l.endsWith('/'))
    .map((l) => l.replace(/\/+$/, ''))
    .filter((l) => l.length > 0);
}

/**
 * The two ESLint patterns that count as covering a directory.
 *
 * Spelled out rather than glob-matched. A real matcher would need minimatch and
 * would answer a question nobody asked -- whether some pattern HAPPENS to match --
 * when what this guard wants is that the directory was named deliberately, in one
 * of the two forms the config already uses.
 */
export function acceptedPatternsFor(dir: string): string[] {
  return [`**/${dir}/**`, `${dir}/**`];
}

/** Directories `.gitignore` excludes that the ESLint ignore list does not cover. */
export function uncoveredDirectories(gitignore: string, ignorePatterns: string[]): string[] {
  const patterns = new Set(ignorePatterns);
  return gitignoreDirectories(gitignore)
    .filter((dir) => dir in EXEMPTIONS === false)
    .filter((dir) => !acceptedPatternsFor(dir).some((p) => patterns.has(p)));
}

/** Every `ignores` entry across the real flat config, flattened. */
function configuredIgnores(): string[] {
  const blocks = ESLINT_CONFIG as unknown as { ignores?: string[] }[];
  return blocks.flatMap((b) => b.ignores ?? []);
}

const GITIGNORE = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');

describe('ESLint ignores cover .gitignore', () => {
  test('the corpus is non-empty — the guard is not reading a stub', () => {
    // ANTI-VACUITY on both inputs at once. A `.gitignore` that stopped resolving,
    // or a config whose shape changed so `ignores` no longer parses, would make
    // every assertion below pass over nothing.
    expect(
      gitignoreDirectories(GITIGNORE).length,
      '.gitignore yielded no directory entries — the guard would pass over nothing',
    ).toBeGreaterThan(4);
    expect(
      configuredIgnores().length,
      'the ESLint config yielded no ignore patterns — the guard would reject everything',
    ).toBeGreaterThan(4);
  });

  test('real config — every gitignored directory is ignored by ESLint', () => {
    const uncovered = uncoveredDirectories(GITIGNORE, configuredIgnores());
    expect(
      uncovered,
      `these directories are gitignored but ESLint still lints them, so a build drops ` +
        `unreviewed code into the lint's corpus: ${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  test('the exemption map is empty — adding one must be a visible, reviewable act', () => {
    expect(
      Object.keys(EXEMPTIONS),
      'an exemption was added; it must be argued in review, not discovered later',
    ).toEqual([]);
  });

  test('plant — dropping the wrangler entry is rejected', () => {
    // THE DEFECT ITSELF, reconstructed. The config before R-2026-09-21-49 is this
    // list minus the four that were missing; one is enough to show the checker
    // discriminates, and `.wrangler` is the one that produced the 67 errors.
    const planted = configuredIgnores().filter((p) => p !== '**/.wrangler/**');
    expect(planted.length, 'the plant removed nothing — the pattern is not in the config').toBe(
      configuredIgnores().length - 1,
    );

    const uncovered = uncoveredDirectories(GITIGNORE, planted);
    expect(uncovered, 'removing the wrangler ignore was not caught').toContain('.wrangler');
  });

  test('plant — a NEW gitignored directory with no ESLint entry is rejected', () => {
    // The class, not the instance. This is the case that matters in six months:
    // somebody adds a generated directory to `.gitignore` and does not think about
    // ESLint, exactly as happened with `.wrangler`.
    const planted = `${GITIGNORE}\n.some-new-build-output/\n`;
    expect(
      gitignoreDirectories(planted),
      'the plant did not reach the parsed directory list',
    ).toContain('.some-new-build-output');

    const uncovered = uncoveredDirectories(planted, configuredIgnores());
    expect(uncovered, 'a newly gitignored directory was not required to be ESLint-ignored').toEqual([
      '.some-new-build-output',
    ]);
  });

  test('positive control — the ordinary form of an entry is accepted, both spellings', () => {
    // test-conventions' fifth way a leg goes wrong: a guard that refuses legitimate
    // input gets disabled. Both spellings the real config uses must pass, or the
    // next person to add a nested directory will hit a refusal and delete the check.
    expect(uncoveredDirectories('build/\n', ['**/build/**'])).toEqual([]);
    expect(uncoveredDirectories('a/b/\n', ['a/b/**'])).toEqual([]);
  });

  test('anti-vacuity — a checker given no ignore patterns reports every directory', () => {
    const uncovered = uncoveredDirectories(GITIGNORE, []);
    expect(
      uncovered.length,
      'with no ESLint ignores at all the checker still found nothing — it is not reading .gitignore',
    ).toBe(gitignoreDirectories(GITIGNORE).length);
  });
});
