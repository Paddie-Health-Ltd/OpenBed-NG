import { describe, expect, test } from 'vitest';
import { runLint, withScratch, place, REPO_ROOT } from './_scratch.js';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GUARD OVER A GUARD -- scripts/lint_no_piped_grep_q.sh.
 *
 * WHAT THIS BANS, AND WHY IT IS NOT STYLE. grep exits 0 for match, 1 for no
 * match, and 2 for COULD NOT RUN. Branching on truthiness alone collapses the
 * third into whichever of the first two sits on that branch:
 *
 *   `check || fail`  -> exit 2 becomes a violation that does not exist.
 *   `if check; then` -> exit 2 becomes "clean". The guard fails OPEN.
 *
 * Both were live in this repository on 2026-09-10, and the second was on
 * lint_audit_log_columns.sh -- the guard for CTO condition (1), no
 * identity-bearing column on app.audit_log.
 *
 * NOT ASSERTED HERE, deliberately: that a script which legitimately greps a FILE
 * separates exit 2 from exit 1. That is a property of a conditional's structure,
 * not of the text, and a lint claiming to check it would be theatre -- Clause 4.
 * This guard bans the one shape that is mechanically detectable and was the
 * actual carrier of the defect.
 */
const LINT = 'lint_no_piped_grep_q.sh';

/** Copies the real lint corpus so plants sit among genuine scripts. */
function copyScripts(root: string): void {
  const src = join(REPO_ROOT, 'scripts');
  const dst = join(root, 'scripts');
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    if (name.startsWith('lint_') && name.endsWith('.sh')) {
      copyFileSync(join(src, name), join(dst, name));
    }
  }
}

describe('lint_no_piped_grep_q', () => {
  test('real corpus is accepted', () => {
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, res.stdout).toBe(0);
    expect(res.stdout).toContain('PASS');
  });

  test.each([
    ['the || fail shape — a false violation', `printf '%s\\n' "$x" | grep -q 'y' || fail "nope"`],
    ['the if shape — fails OPEN', `if printf '%s\\n' "$x" | grep -qx "$n"; then echo hi; fi`],
    ['echo as the writer', `echo "$x" | grep -q 'y' || fail "nope"`],
  ])('plant — %s is rejected', (_name, snippet) => {
    withScratch((root) => {
      copyScripts(root);
      place(root, 'scripts/lint_planted.sh', `#!/usr/bin/env bash\nset -euo pipefail\n${snippet}\n`);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
    });
  });

  test('a commented-out occurrence is NOT a violation — the guard reads code, not prose', () => {
    // Every one of these scripts documents the banned shape in its own header.
    // A guard that reddened on its own explanation would be turned off within a
    // week, which is how a guard stops being a guard.
    withScratch((root) => {
      copyScripts(root);
      place(root, 'scripts/lint_commented.sh',
        `#!/usr/bin/env bash\n# was: printf '%s\\n' "$x" | grep -q 'y' || fail\nset -euo pipefail\ntrue\n`);
      const res = runLint(LINT, root);
      expect(res.status, `a comment was treated as code:\n${res.stdout}`).toBe(0);
    });
  });

  test('anti-vacuity — an empty corpus FAILS', () => {
    withScratch((root) => {
      mkdirSync(join(root, 'scripts'), { recursive: true });
      const res = runLint(LINT, root);
      expect(res.status, `an empty corpus did not fail loudly:\n${res.stdout}`).toBe(2);
    });
  });
});
