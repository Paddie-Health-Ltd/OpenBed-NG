import { describe, expect, test } from 'vitest';
import { runLint, withScratch, place, REPO_ROOT } from './_scratch.js';
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GUARD OVER A GUARD -- scripts/lint_grep_exit_codes.sh.
 *
 * WHAT IS BANNED, AND WHY IT IS NOT STYLE. grep exits 0 for match, 1 for no
 * match, and 2 for COULD NOT RUN. Branching on truthiness collapses the third
 * into whichever of the first two sits on that branch:
 *
 *   `check || fail`  -> exit 2 becomes a violation that does not exist.
 *   `if check; then` -> exit 2 becomes "clean". The guard fails OPEN.
 *   `check || true`  -> exit 2 becomes an empty result set, which reads as
 *                       "no findings". The commonest carrier, and fails OPEN.
 *
 * EXTENDED 2026-09-10, AND THE REASON IS THE POINT. The guard matched
 * `*'|'*grep*-q*` -- piped AND quiet. Both halves were too narrow. `-q` only
 * suppresses OUTPUT; the three exit codes are grep's regardless, so
 * `if out=$(grep -nE ... "$f"); then` fails open exactly as `if grep -q` does.
 * SEVEN live instances were found that day, none of them quiet, including the
 * service-role bundle guard and the secret scan -- both failing OPEN. Six were
 * found by inspection; THE SEVENTH WAS FOUND BY THIS GUARD after it was
 * extended, on a line the hand sweep's own regex was too narrow to see.
 *
 * The lesson is not about bash. A sweep whose completeness is never checked is
 * a mechanism present and not reaching, one level up from what it sweeps for.
 *
 * NOT ASSERTED HERE, deliberately: that a script which CAPTURES grep's status
 * then handles it correctly in the branch that follows. `case "$st" in 1|2)` is
 * textually identical to the right answer and semantically wrong, and a lint
 * claiming to check it would be theatre (Clause 4).
 */
const LINT = 'lint_grep_exit_codes.sh';

/** Copies the real corpus so plants sit among genuine scripts. */
function copyScripts(root: string): void {
  const src = join(REPO_ROOT, 'scripts');
  const dst = join(root, 'scripts');
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    if (name.endsWith('.sh')) copyFileSync(join(src, name), join(dst, name));
  }
}

describe('lint_grep_exit_codes', () => {
  test('real corpus is accepted', () => {
    // NON-TRIVIAL, and this is the leg that pins the exemption: the real corpus
    // contains the PRESCRIBED idiom at scripts/lint_migration_header.sh -- a
    // `grep -qF ... || st=$?` capture. A rule that merely banned "grep near ||"
    // would red here, and the fix would be to weaken the rule.
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, `the real corpus was rejected:\n${res.stdout}`).toBe(0);
    expect(res.stdout).toContain('PASS');
  });

  /**
   * EACH ROW NAMES THE MESSAGE ITS FORM SHOULD PRODUCE.
   *
   * All four detection arms funnel through one `echo`, with the identity carried
   * in `$why`. Asserting the exit status alone proves a violation was found and
   * says nothing about WHICH arm found it -- so swapping the `&&` arm's message
   * with the `|| true` arm's, or collapsing two arms into one, left every test in
   * this file green. The messages are the only thing that distinguishes them, and
   * they are the whole diagnostic value of the guard.
   */
  test.each([
    ['piped, || fail — a false violation', `printf '%s\\n' "$x" | grep -q 'y' || fail "nope"`, 'branches on a grep with ||'],
    ['piped, if — fails OPEN', `if printf '%s\\n' "$x" | grep -qx "$n"; then echo hi; fi`, 'branches directly on a grep'],
    ['echo as the writer', `echo "$x" | grep -q 'y' || fail "nope"`, 'branches on a grep with ||'],
    ['UNPIPED if out=$(grep ...) — fails OPEN', `if out=$(grep -nE "$P" "$f"); then echo hit; fi`, 'branches directly on a grep'],
    ['UNPIPED || true — fails OPEN', `out=$(sed "s/x//" "$f" | grep -nEi "y" || true)`, "swallows a grep's status with || true"],
    ['UNPIPED && — fails OPEN', `grep -nE "n" "$f" && echo found`, 'chains a grep with &&'],
    ['while — fails OPEN', `while grep -nE "x" "$f"; do echo l; done`, 'branches directly on a grep'],
    ['unpiped if grep -q', `if grep -q "n" "$f"; then echo found; fi`, 'branches directly on a grep'],
  ])('plant — %s is rejected, naming that form', (_name, snippet, message) => {
    withScratch((root) => {
      copyScripts(root);
      place(root, 'scripts/lint_planted.sh', `#!/usr/bin/env bash\nset -euo pipefail\n${snippet}\n`);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, `a DIFFERENT arm fired than the one this form should trip:\n${res.stdout}`).toContain(message);
    });
  });

  test.each([
    [
      'the prescribed capture-then-case idiom',
      'st=0\ngrep -nE "n" "$f" || st=$?\ncase "$st" in 0|1) ;; *) exit 2 ;; esac',
    ],
    // grep_or_die is the HELPER that does the separation correctly. A guard that
    // reds on the fix is one people route around, so the rule matches `grep ` as
    // a command word rather than as a substring.
    ['a helper whose name contains grep', `if out=$(grep_or_die "p" "$f"); then echo hit; fi`],
    ['a bare assignment with no branch on the line', `out=$(grep -nE "n" "$f")`],
    [
      'a commented-out occurrence — the guard reads code, not prose',
      `# was: printf '%s\\n' "$x" | grep -q 'y' || fail\ntrue`,
    ],
  ])('positive control — %s is accepted', (_name, snippet) => {
    withScratch((root) => {
      copyScripts(root);
      place(root, 'scripts/lint_planted.sh', `#!/usr/bin/env bash\nset -euo pipefail\n${snippet}\n`);
      const res = runLint(LINT, root);
      expect(res.status, `a correct form was rejected:\n${res.stdout}`).toBe(0);
    });
  });

  test('the guard skips itself, so it must invoke no grep at all', () => {
    // The compensating control for that skip, named in the script's own header.
    // It is pure bash `case` matching: no fork, no pipe, and therefore no third
    // exit code of its own to misread.
    const src = readFileSync(join(REPO_ROOT, 'scripts', LINT), 'utf8');
    const offending = src
      .split('\n')
      .map((l, i) => ({ n: i + 1, t: l.trim() }))
      .filter(({ t }) => !t.startsWith('#'))
      .filter(({ t }) => t.startsWith('grep ') || t.includes('$(grep ') || t.includes('| grep '))
      .map(({ n, t }) => `${n}: ${t}`);
    expect(offending, 'the guard that bans branching on grep invokes grep itself').toEqual([]);
  });

  test('the corpus is every shell script in scripts/, not only the lints', () => {
    // Widened 2026-09-10. run_migrations.sh, seed.sh, get_publishable_key.sh and
    // run_e2e.sh were outside it, and an unstated boundary is the same family of
    // defect the guard is about.
    const res = runLint(LINT, REPO_ROOT);
    const shellScripts = readdirSync(join(REPO_ROOT, 'scripts')).filter((n) => n.endsWith('.sh'));
    expect(res.stdout, `scanned fewer scripts than exist:\n${res.stdout}`).toContain(
      `${shellScripts.length} shell scripts scanned`,
    );
    expect(shellScripts.some((n) => !n.startsWith('lint_')), 'no non-lint script in scripts/ to prove the widening').toBe(true);
  });

  test('anti-vacuity — an empty corpus FAILS', () => {
    withScratch((root) => {
      mkdirSync(join(root, 'scripts'), { recursive: true });
      const res = runLint(LINT, root);
      expect(res.status, `an empty corpus did not fail loudly:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the empty-corpus refusal did not name itself').toContain('no shell scripts found in');
    });
  });

  test('anti-vacuity — a missing scripts directory FAILS, and names itself', () => {
    // Distinct from the empty-corpus leg above and identical in status: delete
    // the `[ -d "$DIR" ]` check and find yields nothing, so the next leg exits 2
    // for a different reason. Only the message separates them.
    withScratch((root) => {
      place(root, 'unrelated.txt', 'x');
      const res = runLint(LINT, root);
      expect(res.status, `a missing scripts directory did not fail loudly:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the missing-directory refusal did not name itself').toContain('no scripts directory at');
    });
  });
});
