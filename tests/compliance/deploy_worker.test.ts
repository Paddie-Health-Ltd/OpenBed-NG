import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withScratch, REPO_ROOT } from './_scratch.js';
import { TRACE_ANSWER } from './_edge_stub.js';

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
  /** `npx WRANGLER_SEND_METRICS=<value>` per stub npx call, in a separate file so `log` is unchanged. */
  metrics: string[];
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
  write('npx', '#!/usr/bin/env bash\necho "npx $*" >> "$STUB_LOG"\necho "npx WRANGLER_SEND_METRICS=${WRANGLER_SEND_METRICS:-unset}" >> "$STUB_LOG.env"\nexit 0\n');
  // One body per attempt, separated by "|"; the last repeats. "FAIL" means curl fails.
  write('curl', `#!/usr/bin/env bash
echo "curl $*" >> "$STUB_LOG"
# Every request starts with -q so curl ignores the caller's ~/.curlrc (R-2026-09-30-181 FE-5).
[ "$1" = "-q" ] || { echo "curl stub: the first argument must be -q, so that ~/.curlrc is not read" >&2; exit 98; }
# THE EDGE GUARD'S TRACE (R-2026-09-30-217 GP) is answered BEFORE the counter below, so it is never counted as a
# read-back attempt: the plants that move the read-back on by attempt keep meaning what they say.
${TRACE_ANSWER}n=$(cat "$STUB_CURL_COUNT" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$STUB_CURL_COUNT"
IFS='|' read -r -a bodies <<< "$STUB_CURL_BODIES"
idx=$((n - 1)); [ "$idx" -ge "\${#bodies[@]}" ] && idx=$((\${#bodies[@]} - 1))
b="\${bodies[$idx]}"
[ "$b" = "FAIL" ] && { echo "curl: (6) Could not resolve host" >&2; exit 6; }
printf '%s' "$b"
`);
  stubWorkerd(root);
  return bin;
}

/**
 * THE `workerd` STAND-IN (R-2026-10-03-FH FH-3 b), the same as in deploy_guards.test.ts. The
 * wrapper checks its own toolchain with `node -e "require('workerd')"` from the work tree, and
 * node finds this package by walking up from there: it sits in the scratch ROOT's node_modules,
 * the PARENT of `work/`, outside the git tree, so it never dirties the tree and the real
 * node_modules is never touched. With STUB_WORKERD_MISSING set it throws workerd's own "could
 * not be found" message, which is what an `npm ci` that skipped the optional platform binary
 * produces. Without it every scratch tree has no node_modules and the check refuses every leg.
 */
function stubWorkerd(root: string): void {
  const dir = join(root, 'node_modules', 'workerd');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'index.js'),
    `if (process.env.STUB_WORKERD_MISSING) throw new Error('The package "@cloudflare/workerd-darwin-arm64" could not be found, and is needed by workerd.');\n`,
    'utf8',
  );
}

const stampOf = (commit: string, dirty = false): string => JSON.stringify({ commit, dirty, built_at: '2026-09-23T00:00:00.000Z' });

const metricsOf = (log: string): string[] => (existsSync(`${log}.env`) ? readFileSync(`${log}.env`, 'utf8').trim().split('\n').filter(Boolean) : []);

function run(root: string, work: string, opts: { target?: string | null; stampBody?: string | null; curl?: string[]; rootArg?: string; env?: Record<string, string> } = {}): Run {
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
    ...(opts.env ?? {}),
  };
  const args = [SCRIPT, ...(opts.target === null ? [] : [opts.target ?? 'supabase-proxy']), opts.rootArg ?? work];
  try {
    const out = execFileSync('bash', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
    return { status: 0, out, log: readFileSync(log, 'utf8'), metrics: metricsOf(log) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}`, log: readFileSync(log, 'utf8'), metrics: metricsOf(log) };
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
      expect(r.out, 'the wrapper does not point at the read-back script').toContain("Now run: bash scripts/readback_worker.sh https://api.openbed.ng -- probe 4 is Cowork's");
    });
  });

  test('plant — a workerd platform binary that npm skipped is refused before the stamp, and the missing package is named', () => {
    withScratch((root) => {
      const work = repo(root);
      // PRECONDITION, independent of the wrapper: the stand-in itself throws with the plant's env.
      // If this fails the plant did not land; if only the assertions below fail, the wrapper is at fault.
      stubWorkerd(root);
      let directStatus = 0;
      let directOut = '';
      try {
        execFileSync('node', ['-e', "require('workerd')"], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: work, env: { ...process.env, STUB_WORKERD_MISSING: '1' } });
      } catch (e) {
        const err = e as { status?: number; stderr?: string };
        directStatus = err.status ?? -1;
        directOut = err.stderr ?? '';
      }
      expect(directStatus, `the stand-in did not throw, so the plant cannot land:\n${directOut}`).not.toBe(0);
      expect(directOut).toContain('could not be found, and is needed by workerd');
      const r = run(root, work, { env: { STUB_WORKERD_MISSING: '1' } });
      expect(r.status, `a missing workerd package was not refused with 2:\n${r.out}`).toBe(2);
      expect(r.out, 'the missing package was not named').toContain('could not be found, and is needed by workerd');
      expect(r.out).toContain('the native platform package that workerd needs is not installed here, so wrangler cannot run and nothing was stamped or uploaded');
      expect(r.out, 'the refusal did not say how to fix it').toContain('npm ci --include=optional');
      // BEFORE THE STAMP OR THE UPLOAD: the stub log holds no npm, npx or curl line.
      expect(r.log, `the wrapper stamped, uploaded or read back after the toolchain check failed:\n${r.log}`).toBe('');
      expect(uploaded(r)).toBe(false);
      expect(existsSync(join(work, 'supabase-proxy', 'version.json')), 'a stamp exists, so the stamp step ran').toBe(false);
    });
  });

  // R-2026-10-03-FI FI-3. Wrangler sends usage telemetry unless refused (the same in 4.134.0 and 4.147.0). The wrapper refuses
  // it for the upload, for data minimisation. THE CALLER'S ENVIRONMENT SAYS true, so a runner that already has it false cannot
  // pass vacuously. Only the upload runs wrangler here: the stamp step (`npm run stamp:worker`) runs none.
  test('plant — wrangler telemetry is switched off for the upload, whatever the caller exports', () => {
    withScratch((root) => {
      const work = repo(root);
      const r = run(root, work, { env: { WRANGLER_SEND_METRICS: 'true' } });
      expect(r.status, r.out).toBe(0);
      expect(r.metrics, `the wrapper did not pass WRANGLER_SEND_METRICS=false to the upload:\n${r.metrics.join('\n')}`).toEqual(['npx WRANGLER_SEND_METRICS=false']);
    });
  });

  // R-2026-10-03-FI FI-5. With the stand-in in place no plant meets the toolchain check first, so nothing else holds its
  // POSITION. A refusal about WHAT is being deployed is reported before one about the machine; both faults at once, and the
  // toolchain ERROR must NOT appear.
  test('plant — an unmerged HEAD is refused as unmerged even when workerd is also missing, so the toolchain check runs after the ancestor check', () => {
    withScratch((root) => {
      const work = repo(root);
      writeFileSync(join(work, 'unmerged.txt'), 'x\n');
      git(work, 'add', 'unmerged.txt');
      git(work, 'commit', '-q', '-m', 'not on main');
      stubWorkerd(root);
      let directStatus = 0;
      try {
        execFileSync('node', ['-e', "require('workerd')"], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: work, env: { ...process.env, STUB_WORKERD_MISSING: '1' } });
      } catch (e) {
        directStatus = (e as { status?: number }).status ?? -1;
      }
      expect(directStatus, 'the stand-in did not throw, so the second fault was never planted').not.toBe(0);
      const r = run(root, work, { env: { STUB_WORKERD_MISSING: '1' } });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('is not an ancestor of origin/main, so this is code no pull request merged');
      expect(r.out, 'the toolchain check ran before the ancestor check').not.toContain('the native platform package that workerd needs');
      expect(uploaded(r)).toBe(false);
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

const TRACE_CALL = 'curl -q -sS -m 12 https://www.cloudflare.com/cdn-cgi/trace';
const REFUSAL_SENTENCE =
  "Cloudflare's Lagos edge refuses deploys from Nigerian networks (R-2026-09-30-217 GP). Connect a VPN exiting outside Nigeria, check colo is not LOS, and run this again.";
const UNREAD_SENTENCE = 'The check could not run, so nothing was built or uploaded. Check the connection, or connect a VPN exiting outside Nigeria, and run this again.';

/**
 * THE EDGE (R-2026-09-30-217 GP, GP-3). The trace table lives in tests/compliance/edge_guard.test.ts; THIS block
 * holds the Worker wrapper's WIRING: that it asks, where in its order it asks, and that a refusal stamps and
 * uploads nothing.
 */
describe('scripts/deploy_worker.sh — the edge it would go out through is read before anything is stamped', () => {
  test('accept — an ordinary London edge is printed, then the stamp, then the upload, and the trace is not a read-back attempt', () => {
    withScratch((root) => {
      const work = repo(root);
      const r = run(root, work);
      expect(r.status, `a clean, merged tree on a London edge was refused:\n${r.out}`).toBe(0);
      expect(r.out, 'the edge was not printed').toContain('deploy_worker.sh: edge trace reads colo=LHR loc=GB');
      const lines = r.log.trim().split('\n');
      const at = (needle: string): number => lines.findIndex((l) => l.includes(needle));
      expect(at(TRACE_CALL), `the guard never asked for a trace:\n${r.log}`).toBeGreaterThanOrEqual(0);
      expect(at(TRACE_CALL), 'the trace was read after the stamp').toBeLessThan(at('npm run --silent stamp:worker'));
      expect(at('npm run --silent stamp:worker'), 'the stamp did not come before the upload').toBeLessThan(at('npx wrangler deploy'));
      // The read-back found the stamp on its FIRST attempt: the trace request did not use one up.
      expect(r.out).toContain('(attempt 1 of 3)');
    });
  });

  test.each([
    // A Lagos or Nigerian edge is REFUSED (exit 1); an edge that cannot be read is a check that COULD NOT RUN (exit 2), R-2026-09-30-218 GQ-5 b.
    ['colo LOS (refused, exit 1)', { STUB_TRACE_BODY: 'colo=LOS\nloc=GB\n' }, 1, REFUSAL_SENTENCE],
    ['loc NG (refused, exit 1)', { STUB_TRACE_BODY: 'colo=LHR\nloc=NG\n' }, 1, REFUSAL_SENTENCE],
    ['an answer that is not a trace (the check could not run, exit 2)', { STUB_TRACE_BODY: '<html>429 Too Many Requests</html>' }, 2, UNREAD_SENTENCE],
    ['a trace that cannot be fetched (the check could not run, exit 2)', { STUB_TRACE_EXIT: '6' }, 2, UNREAD_SENTENCE],
  ])('plant — %s stops the wrapper BEFORE the stamp, and nothing is stamped, uploaded or read back', (_label, env, status, sentence) => {
    withScratch((root) => {
      const work = repo(root);
      const r = run(root, work, { env });
      expect(r.status, `a stopped edge was deployed from:\n${r.out}`).toBe(status);
      expect(r.out).toContain(sentence);
      expect(r.out, 'the other kind of stop\'s sentence was printed').not.toContain(sentence === REFUSAL_SENTENCE ? UNREAD_SENTENCE : REFUSAL_SENTENCE);
      expect(r.log, 'the guard never asked for a trace').toContain(TRACE_CALL);
      expect(r.log, `the wrapper stamped after the edge was refused:\n${r.log}`).not.toContain('npm run --silent stamp:worker');
      expect(uploaded(r), 'a refused edge still reached the upload').toBe(false);
      expect(r.log, 'a refused edge still reached the live read-back').not.toContain('api.openbed.ng');
      expect(existsSync(join(work, 'supabase-proxy', 'version.json')), 'a stamp exists, so the stamp step ran').toBe(false);
      expect(r.out, 'the wrapper announced a stamp before refusing').not.toContain('stamping supabase-proxy');
    });
  });

  test('plant — an unmerged HEAD is refused as unmerged even on a Lagos edge, so the edge is read after the ancestor check', () => {
    withScratch((root) => {
      const work = repo(root);
      writeFileSync(join(work, 'unmerged.txt'), 'x\n');
      git(work, 'add', 'unmerged.txt');
      git(work, 'commit', '-q', '-m', 'not on main');
      const r = run(root, work, { env: { STUB_TRACE_BODY: 'colo=LOS\nloc=NG\n' } });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('is not an ancestor of origin/main, so this is code no pull request merged');
      expect(r.out, 'the edge was judged before the ancestor check').not.toContain(REFUSAL_SENTENCE);
      expect(r.log, 'the trace was asked for before the ancestor check').toBe('');
    });
  });

  test('plant — a missing workerd package is refused as a toolchain fault even on a Lagos edge, so the edge is read after the toolchain check', () => {
    withScratch((root) => {
      const work = repo(root);
      const r = run(root, work, { env: { STUB_WORKERD_MISSING: '1', STUB_TRACE_BODY: 'colo=LOS\nloc=NG\n' } });
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('the native platform package that workerd needs is not installed here');
      expect(r.out, 'the edge was judged before the toolchain check').not.toContain(REFUSAL_SENTENCE);
      expect(r.log, 'the trace was asked for before the toolchain check').toBe('');
    });
  });
});
