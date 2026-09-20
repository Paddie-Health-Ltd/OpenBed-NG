import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withScratch, place, REPO_ROOT } from './_scratch.js';

/**
 * GUARDS OVER THE DEPLOY PATH — scripts/deploy_pages.sh and scripts/run_e2e.sh
 * (R-2026-09-20-30 A4 and C2).
 *
 * WHY BOTH ARE HERE. They are the same defect in two places: a step that appears to
 * do its job while doing nothing. The deploy wrapper exists because a direct-upload
 * deployment can carry any tree; the runner fix exists because that runner ran two
 * NAMED files while everyone believed it ran the directory.
 *
 * HOW. Each leg builds a scratch git repository and puts a stubbed `npx` (and `npm`
 * where needed) first on PATH, so nothing is built, uploaded, or run for real. The
 * stub RECORDS that it was invoked, which is what makes the accept legs non-vacuous:
 * a script that refused everything, or that silently did nothing, would pass a bare
 * "exit 0" assertion.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that the wrapper is a CONTROL. It is local and defeatable: `npx wrangler pages
 *     deploy` by hand bypasses it, and so does editing it. It removes the accident,
 *     not the deliberate act. Its own header says so.
 *   - that what Cloudflare serves matches what was uploaded. Nothing in this
 *     repository can read a Cloudflare project. /version.json plus the deployment
 *     report cover that, and only after a deploy has happened.
 *   - that the real `wrangler` behaves as the stub does. The stub proves the wrapper
 *     reached the upload step, never that the upload works.
 */

const DEPLOY_SCRIPT = 'scripts/deploy_pages.sh';
const RUN_E2E_SCRIPT = 'scripts/run_e2e.sh';

interface Run { status: number; out: string; ran: string[] }

function exec(cmd: string, args: string[], env: Record<string, string>, cwd?: string): { status: number; out: string } {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env }, cwd });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A scratch repo with an `origin` it can fetch, so the wrapper's ancestor check is real. */
function repoWithOrigin(root: string): void {
  const upstream = join(root, 'upstream.git');
  const work = join(root, 'work');
  mkdirSync(work, { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', upstream], { stdio: 'ignore' });
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.email', 'plant@example.invalid');
  git(work, 'config', 'user.name', 'Plant');
  writeFileSync(join(work, 'seed.txt'), 'seed\n', 'utf8');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'seed');
  git(work, 'remote', 'add', 'origin', upstream);
  git(work, 'push', '-q', 'origin', 'main');
}

/** Runs the real wrapper against the scratch work tree with `npm`/`npx` stubbed. */
function deploy(root: string, extraEnv: Record<string, string> = {}): Run {
  const work = join(root, 'work');
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(root, 'ran.log');
  for (const tool of ['npm', 'npx']) {
    writeFileSync(join(bin, tool), `#!/usr/bin/env bash\necho "${tool} $*" >> "$STUB_LOG"\nexit 0\n`, 'utf8');
    chmodSync(join(bin, tool), 0o755);
  }
  mkdirSync(join(work, 'apps', 'public-dashboard'), { recursive: true });
  const r = exec('bash', [join(REPO_ROOT, DEPLOY_SCRIPT), work], {
    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
    STUB_LOG: log,
    ...extraEnv,
  });
  return { ...r, ran: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [] };
}

describe('deploy_pages.sh — the accident case, refused', () => {
  test('accept — a clean tree whose HEAD is on origin/main reaches the upload', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const res = deploy(root);
      expect(res.status, `a clean, merged tree was refused:\n${res.out}`).toBe(0);
      // NON-VACUITY: the accept leg means nothing unless the upload was reached.
      expect(res.ran.join('\n'), `the wrapper exited 0 without reaching wrangler:\n${res.out}`).toMatch(/npx wrangler pages deploy --branch main/);
      expect(res.ran.join('\n'), 'the build never ran, so no stamp would exist').toMatch(/npm run build/);
      expect(res.out, 'the wrapper did not print what the deployment report needs').toMatch(/from which commit/);
    });
  });

  test('plant — a dirty working tree is refused, and the dirty paths are named', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      writeFileSync(join(root, 'work', 'uncommitted.txt'), 'x\n', 'utf8');
      const res = deploy(root);
      expect(res.status, `a dirty tree was deployed:\n${res.out}`).toBe(1);
      expect(res.out).toContain('the working tree has uncommitted changes, so the deployed artifact would match no commit');
      expect(res.out, 'the refusal did not name the offending path').toMatch(/uncommitted\.txt/);
      expect(res.ran.join('\n'), 'it refused AFTER reaching wrangler').not.toMatch(/wrangler/);
    });
  });

  test('plant — a HEAD that is not an ancestor of origin/main is refused', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const work = join(root, 'work');
      writeFileSync(join(work, 'local-only.txt'), 'x\n', 'utf8');
      git(work, 'add', '-A');
      git(work, 'commit', '-q', '-m', 'a commit no PR merged');
      const res = deploy(root);
      expect(res.status, `unmerged code was deployed:\n${res.out}`).toBe(1);
      expect(res.out).toContain('is not an ancestor of origin/main, so this is code no pull request merged');
      expect(res.ran.join('\n')).not.toMatch(/wrangler/);
    });
  });

  test('plant — --branch with no value is refused rather than deploying to ""', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const bin = join(root, 'bin');
      mkdirSync(bin, { recursive: true });
      for (const tool of ['npm', 'npx']) {
        writeFileSync(join(bin, tool), `#!/usr/bin/env bash\necho "${tool} $*" >> "$STUB_LOG"\nexit 0\n`, 'utf8');
        chmodSync(join(bin, tool), 0o755);
      }
      const res = exec('bash', [join(REPO_ROOT, DEPLOY_SCRIPT), '--branch'], {
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        STUB_LOG: join(root, 'ran.log'),
      });
      expect(res.status, `an empty branch name was accepted:\n${res.out}`).toBe(2);
      expect(res.out).toContain('--branch was given with no value');
    });
  });

  test('plant — an unreachable origin is refused, because a stale ref weakens the check silently', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      // Point origin at nothing. The ancestor check would still "work" against the
      // last-fetched ref, which is the quietly-weaker outcome this refuses.
      git(join(root, 'work'), 'remote', 'set-url', 'origin', join(root, 'no-such-remote.git'));
      const res = deploy(root);
      expect(res.status, `it deployed against a stale origin/main:\n${res.out}`).toBe(2);
      expect(res.out).toContain('), so the ancestor check would be made against a stale ref');
      expect(res.ran.join('\n')).not.toMatch(/wrangler/);
    });
  });

  test('anti-vacuity — a tree that is not a git work tree is refused loudly', () => {
    withScratch((root) => {
      mkdirSync(join(root, 'work'), { recursive: true });
      const res = deploy(root);
      expect(res.status, `a non-repository was deployed:\n${res.out}`).toBe(2);
      expect(res.out).toContain('is not a git work tree, so nothing about this build can be checked');
    });
  });
});

/** Runs the real run_e2e.sh against a scratch tree whose `npx` is a stub. */
function runE2e(root: string): Run {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(root, 'ran.log');
  writeFileSync(join(bin, 'npx'), `#!/usr/bin/env bash\necho "npx $*" >> "$STUB_LOG"\nprintf '<testsuites tests="0"></testsuites>' > "$4"\nexit 0\n`, 'utf8');
  chmodSync(join(bin, 'npx'), 0o755);
  writeFileSync(join(bin, 'node'), `#!/usr/bin/env bash\necho "node $*" >> "$STUB_LOG"\nexit 0\n`, 'utf8');
  chmodSync(join(bin, 'node'), 0o755);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(join(REPO_ROOT, RUN_E2E_SCRIPT), join(root, 'scripts', 'run_e2e.sh'));
  const r = exec('bash', [join(root, 'scripts', 'run_e2e.sh')], {
    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
    STUB_LOG: log,
  });
  return { ...r, ran: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [] };
}

describe('run_e2e.sh — no file in tests/e2e is silently omitted', () => {
  test('plant — a NEW file in tests/e2e is executed, which the two named invocations never did', () => {
    withScratch((root) => {
      place(root, 'tests/e2e/golden-path.test.ts', '// golden path\n');
      place(root, 'tests/e2e/ratchet.test.ts', '// ratchet\n');
      place(root, 'tests/e2e/a_new_leg.test.ts', '// a leg someone added believing it would run\n');
      const res = runE2e(root);
      expect(
        res.ran.join('\n'),
        `the new file was never executed — the defect this fix removes:\n${res.out}`,
      ).toMatch(/a_new_leg\.test\.ts/);
      expect(res.out, 'the corpus was not printed, so an omission would still be invisible').toMatch(/phase 1 corpus/);
    });
  });

  test('the ratchet is NOT in phase 1 — it is the gate, not its own input', () => {
    withScratch((root) => {
      place(root, 'tests/e2e/golden-path.test.ts', '// golden path\n');
      place(root, 'tests/e2e/ratchet.test.ts', '// ratchet\n');
      const res = runE2e(root);
      const phase1 = res.ran.find((l) => l.includes('--outputFile=junit-e2e.xml')) ?? '';
      expect(phase1, `phase 1 did not run:\n${res.out}`).toMatch(/golden-path\.test\.ts/);
      expect(phase1, 'the ratchet was fed its own corpus').not.toMatch(/ratchet\.test\.ts/);
    });
  });

  test('plant — a MISSING golden path is refused by name, not quietly run smaller', () => {
    withScratch((root) => {
      place(root, 'tests/e2e/ratchet.test.ts', '// ratchet\n');
      place(root, 'tests/e2e/a_new_leg.test.ts', '// still something to run\n');
      const res = runE2e(root);
      expect(res.status, `a missing golden path passed as a smaller run:\n${res.out}`).toBe(2);
      expect(res.out).toContain('is missing — the golden path and the ratchet are named in the frontier and in this runner.');
    });
  });

  test('anti-vacuity — an empty tests/e2e directory is refused', () => {
    withScratch((root) => {
      place(root, 'tests/e2e/.keep', '');
      const res = runE2e(root);
      expect(res.status, `an empty corpus was accepted:\n${res.out}`).toBe(2);
      expect(res.out).toContain('is missing — the golden path and the ratchet are named in the frontier and in this runner.');
    });
  });
});
