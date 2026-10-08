import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * THE ONE WAY A TEST READS THE PREDECESSOR OF A SHIPPED CONTRACT FROM GIT (R-2026-09-30-214 GN).
 *
 * `git archive REF packages` extracted into `dir`, so the old codec, the old fixture and the old
 * Function are the bytes that were deployed and not a copy somebody can tidy. Used by
 * tests/compliance/snapshot_compat_as_at_6866161.test.ts (a constructed post-031 payload) and
 * tests/db/snapshot_compat_as_at_6866161.test.ts (the payload the real generator wrote).
 *
 * LOUD, NEVER A SKIP (test-conventions section 6). A ref git cannot read throws, naming the ref
 * and the CI setting that fixes it. `pipefail` is load-bearing: without it the pipeline's status
 * is tar's, and a ref git cannot read extracts nothing and still reports success, which is the
 * exact failure this function exists to make loud (found by the anti-vacuity leg of the first
 * test that used it).
 */
export const REPO_ROOT = join(import.meta.dirname, '..', '..');

export function extractPackagesAsAt(ref: string, dir: string): void {
  try {
    execFileSync('bash', ['-c', 'set -euo pipefail; git -C "$0" archive "$1" packages | tar -x -C "$2"', REPO_ROOT, ref, dir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const err = e as { stderr?: Buffer | string };
    throw new Error(
      `cannot read commit ${ref} from git, so the compatibility with it cannot be tested. ` +
        `If this is CI, the job's checkout is too shallow: it needs fetch-depth: 0. ` +
        `git said: ${String(err.stderr ?? '').trim() || String(e)}`,
    );
  }
}
