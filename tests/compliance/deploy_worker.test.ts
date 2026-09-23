import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withScratch, REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER scripts/deploy_worker.sh (R-2026-09-23-70; PR 3.3).
 *
 * The same shape as tests/compliance/deploy_guards.test.ts: every leg builds a scratch
 * git repository with a fetchable origin and puts stubbed `npm`, `npx` and `curl` first
 * on PATH, so nothing is stamped for real, uploaded or fetched from the internet.
 *   - the `npm` stub IS the stamp step: it writes $STUB_STAMP_BODY where the wrapper
 *     will read it, so each stamp refusal can be planted;
 *   - the `npx` stub records that the upload was reached, which is what makes the
 *     accept leg non-vacuous and lets every refusal assert that NOTHING was uploaded;
 *   - the `curl` stub answers the live read-back from a list of bodies, one per
 *     attempt, so "the old Worker answered first" and "it never changed" are plants.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that the wrapper is a CONTROL: `npx wrangler deploy` by hand bypasses it;
 *   - that real wrangler behaves as the stub does, or that the live Worker's SOURCE is
 *     this repository's -- that is the runbook's source-equality probe.
 */

const SCRIPT = join(REPO_ROOT, 'scripts', 'deploy_worker.sh');

interface Run {
  status: number;
  out: string;
  log: string;
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A scratch repo with an origin, holding the one Worker target in its seed commit. */
function repo(root: string): string {
  const upstream = join(root, 'upstream.git');
  const work = join(root, 'work');
  mkdirSync(join(work, 'supabase-proxy'), { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', upstream], { stdio: 'ignore' });
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.email', 'plant@example.invalid');
  git(work, 'config', 'user.name', 'Plant');
  writeFileSync(join(work, 'supabase-proxy', 'wrangler.json'), '{"name":"supabase-proxy","main":"index.js"}\n');
  // The stamp is gitignored in the real tree, so writing it must not dirty this one.
  writeFileSync(join(work, '.gitignore'), 'supabase-proxy/version.json\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'seed');
  git(work, 'remote', 'add', 'origin', upstream);
  git(work, 'push', '-q', 'origin', 'main');
  return work;
}

function stubBin(root: string): string {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const write = (name: string, body: string): void => {
    writeFileSync(join(bin, name), body, 'utf8');
    chmodSync(join(bin, name), 0o755);
  };
  write('npm', `#!/usr/bin/env bash
echo "npm $*" >> "$STUB_LOG"
if [ -n "\${STUB_STAMP_BODY:-}" ]; then mkdir -p "$(dirname "$STUB_STAMP")"; printf '%s' "$STUB_STAMP_BODY" > "$STUB_STAMP"; fi
exit 0
`);
  write('npx', '#!/usr/bin/env bash\necho "npx $*" >> "$STUB_LOG"\nexit 0\n');
  // One body per attempt, separated by "|"; the last repeats. "FAIL" means curl fails.
  write('curl', `#!/usr/bin/env bash
echo "curl $*" >> "$STUB_LOG"
n=$(cat "$STUB_CURL_COUNT" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$STUB_CURL_COUNT"
IFS='|' read -r -a bodies <<< "$STUB_CURL_BODIES"
idx=$((n - 1)); [ "$idx" -ge "\${#bodies[@]}" ] && idx=$((\${#bodies[@]} - 1))
b="\${bodies[$idx]}"
[ "$b" = "FAIL" ] && { echo "curl: (6) Could not resolve host" >&2; exit 6; }
printf '%s' "$b"
`);
  return bin;
}

const stampOf = (commit: string, dirty = false): string => JSON.stringify({ commit, dirty, built_at: '2026-09-23T00:00:00.000Z' });

function run(root: string, work: string, opts: { target?: string | null; stampBody?: string | null; curl?: string[]; rootArg?: string } = {}): Run {
  const bin = stubBin(root);
  const log = join(root, 'stub.log');
  writeFileSync(log, '');
  const head = existsSync(join(work, '.git')) ? git(work, 'rev-parse', 'HEAD').trim() : 'no-head';
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
    STUB_LOG: log,
    STUB_STAMP: join(work, 'supabase-proxy', 'version.json'),
    STUB_STAMP_BODY: opts.stampBody === undefined ? stampOf(head) : (opts.stampBody ?? ''),
    STUB_CURL_BODIES: (opts.curl ?? [stampOf(head)]).join('|'),
    STUB_CURL_COUNT: join(root, 'curl.count'),
    DEPLOY_WORKER_READBACK_ATTEMPTS: '3',
    DEPLOY_WORKER_READBACK_SLEEP: '0',
  };
  const args = [SCRIPT, ...(opts.target === null ? [] : [opts.target ?? 'supabase-proxy']), opts.rootArg ?? work];
  try {
    const out = execFileSync('bash', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
    return { status: 0, out, log: readFileSync(log, 'utf8') };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}`, log: readFileSync(log, 'utf8') };
  }
}

const uploaded = (r: Run): boolean => r.log.includes('npx wrangler deploy');

describe('scripts/deploy_worker.sh', () => {
  test('real deploy path is accepted — clean tree on main, stamp names HEAD, the live stamp names HEAD on a later attempt', () => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const r = run(root, work, { curl: [stampOf('0'.repeat(40)), stampOf(head)] });
      expect(r.status, r.out).toBe(0);
      expect(uploaded(r), `the upload was never reached:\n${r.log}`).toBe(true);
      expect(r.log).toContain('npm run --silent stamp:worker');
      expect(r.out).toContain(`DONE. https://api.openbed.ng/__openbed/version names ${head} (attempt 2 of 3)`);
    });
  });

  test('plant — an unknown target is refused, never defaulted, and nothing is uploaded', () => {
    withScratch((root) => {
      const work = repo(root);
      const r = run(root, work, { target: 'supabase-proxyy' });
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain("REFUSING: 'supabase-proxyy' is not a Worker target");
      expect(r.out).toContain('/wrangler.json does not exist');
      expect(uploaded(r)).toBe(false);
    });
  });

  test('plant — no target at all is refused', () => {
    withScratch((root) => {
      const work = repo(root);
      const r = run(root, work, { target: null, rootArg: '' });
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('no target given -- usage: bash scripts/deploy_worker.sh supabase-proxy');
    });
  });

  test('plant — a directory that is not a git work tree is refused', () => {
    withScratch((root) => {
      mkdirSync(join(root, 'plain', 'supabase-proxy'), { recursive: true });
      const r = run(root, join(root, 'plain'));
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('is not a git work tree, so nothing about this build can be checked');
      expect(uploaded(r)).toBe(false);
    });
  });

  test('plant — a failed fetch of origin/main is refused', () => {
    withScratch((root) => {
      const work = repo(root);
      rmSync(join(root, 'upstream.git'), { recursive: true, force: true });
      const r = run(root, work);
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('REFUSING: could not fetch origin/main');
      expect(r.out).toContain('), so the ancestor check would be made against a stale ref');
      expect(uploaded(r)).toBe(false);
    });
  });

  test('plant — a dirty tree is refused', () => {
    withScratch((root) => {
      const work = repo(root);
      writeFileSync(join(work, 'uncommitted.txt'), 'x\n');
      const r = run(root, work);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('the working tree has uncommitted changes, so the deployed Worker would match no commit');
      expect(uploaded(r)).toBe(false);
    });
  });

  test('plant — a HEAD that is not on origin/main is refused', () => {
    withScratch((root) => {
      const work = repo(root);
      writeFileSync(join(work, 'unmerged.txt'), 'x\n');
      git(work, 'add', 'unmerged.txt');
      git(work, 'commit', '-q', '-m', 'not on main');
      const r = run(root, work);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('is not an ancestor of origin/main, so this is code no pull request merged');
      expect(uploaded(r)).toBe(false);
    });
  });

  test.each([
    ['missing', null, 1, ', so the Worker about to be uploaded cannot be identified'],
    ['unreadable', 'not json', 2, 'is not readable JSON carrying a commit and a dirty flag, so the readback did not run'],
    ['dirty', 'DIRTY', 1, 'the stamp says the tree was dirty, so the Worker about to be uploaded is identified by no commit'],
    ['another commit', 'OTHER', 1, 'the artefact is not the commit that was checked'],
  ] as const)('plant — a stamp that is %s is refused before upload', (_label, body, status, message) => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const stampBody = body === 'DIRTY' ? stampOf(head, true) : body === 'OTHER' ? stampOf('f'.repeat(40)) : body;
      const r = run(root, work, { stampBody });
      expect(r.status, r.out).toBe(status);
      expect(r.out).toContain(message);
      expect(uploaded(r), 'a refused stamp still reached the upload').toBe(false);
    });
  });

  test('plant — the live stamp still naming the PREVIOUS commit is a STOP, never a pass', () => {
    withScratch((root) => {
      const work = repo(root);
      const r = run(root, work, { curl: [stampOf('0'.repeat(40))] });
      expect(r.status, r.out).toBe(1);
      expect(uploaded(r)).toBe(true);
      expect(r.out).toContain(`STOP: after 3 attempts https://api.openbed.ng/__openbed/version still gave commit ${'0'.repeat(40)}`);
      expect(r.out).not.toContain('DONE.');
      expect(readFileSync(join(root, 'curl.count'), 'utf8').trim(), 'the read-back was not bounded at its attempts').toBe('3');
    });
  });

  test('plant — no answer at all from the live stamp is a STOP', () => {
    withScratch((root) => {
      const work = repo(root);
      const r = run(root, work, { curl: ['FAIL'] });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('STOP: after 3 attempts https://api.openbed.ng/__openbed/version still gave no answer (curl exited 6)');
    });
  });

  test('plant — an answer that is not a stamp (the old passthrough 404) is a STOP', () => {
    withScratch((root) => {
      const work = repo(root);
      const r = run(root, work, { curl: ['{"error":"requested path is invalid"}'] });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('still gave a body that is not a stamp');
    });
  });
});
