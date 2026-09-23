import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withScratch, REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER THE DEPLOY READ-BACK SCRIPTS: scripts/readback_pages.sh,
 * scripts/readback_ward_console.sh and scripts/readback_worker.sh, and their shared
 * scripts/readback_common.sh (R-2026-09-23-70, the H4 note: every multi-line founder
 * read-back becomes a script that takes the URL as its argument).
 *
 * Each leg builds a scratch git repository with a fetchable origin, and puts a
 * `curl` stub first on PATH that answers from a fixture keyed by METHOD and URL (and
 * by apikey, where one is sent). So nothing is fetched from the internet, and every
 * value a read-back checks can be planted wrong. The ACCEPT fixtures are the answers
 * observed on hosted on 2026-09-23 (the -70 notes for steps (a), (b) and (c)).
 *
 * Every script has these legs:
 *   - ACCEPT: the observed answers give PASS, exit 0, and every check prints ok;
 *   - PLANT, THE ARGUMENT: no URL, an http:// URL and a bare https:// each STOP with
 *     exit 2 and ZERO requests. H4's false STOP probed an empty host, and that must
 *     now be impossible;
 *   - PLANT, ONE PER CHECKED PROPERTY: the wrong value reads WRONG on the line that
 *     names that check, and the verdict is STOP with exit 1. Naming the line is how
 *     each plant shows it reached the check it targets (test-conventions, 2026-09-21);
 *   - COULD NOT RUN: a request that fails gives ERROR and exit 2, never a verdict.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that hosted still answers as it did on 2026-09-23. Only a run at the edge can
 *     show that, and a change there reads WRONG and STOPs, loudly;
 *   - that real curl treats these flags as the stub does. The stub reads -X, -I, -D,
 *     -o, -w and -H exactly as the scripts pass them, and the scripts' flags are
 *     those of the runbook fences they replace, which ran against hosted.
 */

/** The shared file's legs are reached through the three scripts that source it. */
const COMMON_NAME = 'readback_common.sh';

const SCRIPTS = {
  common: join(REPO_ROOT, 'scripts', COMMON_NAME),
  pages: join(REPO_ROOT, 'scripts', 'readback_pages.sh'),
  ward: join(REPO_ROOT, 'scripts', 'readback_ward_console.sh'),
  worker: join(REPO_ROOT, 'scripts', 'readback_worker.sh'),
};

type Answer = { status: number; headers?: Record<string, string>; body?: string } | { fail: number };
type Fixtures = Record<string, Answer | Answer[]>;

interface Run {
  status: number;
  out: string;
  calls: string[];
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const TRACKED_KEY = 'sb_publishable_TRACKED_KEY_FOR_THE_WORKER_PROBE';

/** A scratch checkout with an origin and the two tracked origin files the Worker read-back reads. */
function repo(root: string, opts: { pushed?: boolean; remote?: boolean } = {}): string {
  const upstream = join(root, 'upstream.git');
  const work = join(root, 'work');
  mkdirSync(join(work, 'packages', 'origins'), { recursive: true });
  git(root, 'init', '-q', '--bare', '-b', 'main', upstream);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.email', 'plant@example.invalid');
  git(work, 'config', 'user.name', 'Plant');
  writeFileSync(join(work, 'packages', 'origins', 'publishable-keys.json'), JSON.stringify({ production: TRACKED_KEY }));
  writeFileSync(join(work, 'packages', 'origins', 'origins.json'), JSON.stringify({ supabaseDirect: { production: 'https://klrlpxysjsjpdkeqdhvl.supabase.co' } }));
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'seed');
  if (opts.remote !== false) {
    git(work, 'remote', 'add', 'origin', upstream);
    git(work, 'push', '-q', 'origin', 'main');
    git(work, 'fetch', '-q', 'origin');
  }
  if (opts.pushed === false) git(work, 'commit', '-q', '--allow-empty', '-m', 'never pushed');
  return work;
}

/** A curl stub that answers from the fixture by "METHOD URL", or "METHOD URL apikey=KEY" first. */
function stubBin(root: string): string {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'curl'),
    `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
let method = 'GET', head = false, out = null, dump = null, fmt = null, url = null;
const hdrs = [];
for (let i = 0; i < a.length; i++) {
  const x = a[i];
  if (x === '-X') method = a[++i];
  else if (x === '-I') head = true;
  else if (x === '-o') out = a[++i];
  else if (x === '-D') dump = a[++i];
  else if (x === '-w') fmt = a[++i];
  else if (x === '-H') hdrs.push(a[++i]);
  else if (x === '-d' || x === '-m') i++;
  else if (/^https?:/.test(x)) url = x;
}
if (head) method = 'HEAD';
const apikey = (hdrs.map((h) => /^apikey:\\s*(.*)$/i.exec(h)).find(Boolean) || [])[1];
fs.appendFileSync(process.env.STUB_LOG, method + ' ' + url + (apikey ? ' apikey=' + apikey : '') + '\\n');
const fx = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURES, 'utf8'));
const k = apikey && (method + ' ' + url + ' apikey=' + apikey) in fx ? method + ' ' + url + ' apikey=' + apikey : method + ' ' + url;
let ans = fx[k];
if (ans === undefined) { process.stderr.write('curl: (6) Could not resolve host (no fixture for ' + k + ')\\n'); process.exit(6); }
if (Array.isArray(ans)) {
  const counts = fs.existsSync(process.env.STUB_COUNTS) ? JSON.parse(fs.readFileSync(process.env.STUB_COUNTS, 'utf8')) : {};
  const n = counts[k] || 0;
  counts[k] = n + 1;
  fs.writeFileSync(process.env.STUB_COUNTS, JSON.stringify(counts));
  ans = ans[Math.min(n, ans.length - 1)];
}
if (ans.fail) { process.stderr.write('curl: (' + ans.fail + ') planted failure\\n'); process.exit(ans.fail); }
const text = 'HTTP/2 ' + ans.status + '\\r\\n' + Object.entries(ans.headers || {}).map(([h, v]) => h + ': ' + v + '\\r\\n').join('') + '\\r\\n';
if (dump) fs.writeFileSync(dump, text);
const body = head ? text : (ans.body || '');
if (out) fs.writeFileSync(out, body); else process.stdout.write(body);
if (fmt) process.stdout.write(fmt.replace('%{http_code}', String(ans.status)));
`,
    'utf8',
  );
  chmodSync(join(bin, 'curl'), 0o755);
  return bin;
}

function run(root: string, script: string, args: string[], fixtures: Fixtures, env: Record<string, string> = {}): Run {
  const bin = stubBin(root);
  const log = join(root, 'stub.log');
  writeFileSync(log, '');
  writeFileSync(join(root, 'fixtures.json'), JSON.stringify(fixtures));
  const fullEnv = {
    ...process.env,
    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
    STUB_LOG: log,
    STUB_FIXTURES: join(root, 'fixtures.json'),
    STUB_COUNTS: join(root, 'counts.json'),
    READBACK_SERVED_AT_SLEEP: '0',
    ...env,
  };
  const calls = (): string[] => readFileSync(log, 'utf8').split('\n').filter((l) => l !== '');
  try {
    const out = execFileSync('bash', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: fullEnv });
    return { status: 0, out, calls: calls() };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}`, calls: calls() };
  }
}

const stampOf = (commit: string, dirty = false): string => JSON.stringify({ commit, dirty, built_at: '2026-09-23T18:46:32.411Z' });

/** The shape of every STOP a leg plants: WRONG on the named check, then the one STOP verdict. */
function expectStopAt(r: Run, check: string): void {
  expect(r.status, r.out).toBe(1);
  expect(r.out, `the plant did not reach the check it targets: ${check}`).toContain(`  WRONG  ${check}: `);
  expect(r.out).toContain('STOP: a line above reads WRONG. Do not report this deploy as good; paste this whole output back.');
  expect(r.out).not.toContain('PASS:');
}

// ---------------------------------------------------------------------------
// The argument refusal, for every script: STOP, exit 2, and nothing fetched.
// ---------------------------------------------------------------------------

describe('scripts/readback_common.sh — a URL that is missing or not https:// is refused before any request', () => {
  test.each([
    ['readback_pages.sh', SCRIPTS.pages],
    ['readback_ward_console.sh', SCRIPTS.ward],
    ['readback_worker.sh', SCRIPTS.worker],
  ])('plant — %s with no argument STOPs, names the missing URL, and probes nothing', (name, script) => {
    withScratch((root) => {
      const work = repo(root);
      const r = run(root, script, [], {});
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('STOP: no URL was given, so nothing was probed.');
      expect(r.out).toContain(`  Usage: bash scripts/${name} https://`);
      expect(r.calls, 'a request was made with no URL -- the H4 false STOP').toEqual([]);
      expect(existsSync(work)).toBe(true);
    });
  });

  test.each([
    ['readback_pages.sh', 'http://abc.openbed-public-dashboard.pages.dev', "STOP: 'http://abc.openbed-public-dashboard.pages.dev' is not an https:// URL, so nothing was probed."],
    ['readback_ward_console.sh', 'abc.openbed-ward-console.pages.dev', "STOP: 'abc.openbed-ward-console.pages.dev' is not an https:// URL, so nothing was probed."],
    ['readback_worker.sh', 'https://', "STOP: 'https://' is not a usable https:// URL, so nothing was probed."],
    ['readback_pages.sh', 'https://abc.openbed-public-dashboard.pages.dev curl -sS', 'is not a usable https:// URL, so nothing was probed.'],
  ])('plant — %s refuses %s before any request', (name, url, expected) => {
    withScratch((root) => {
      const work = repo(root);
      const r = run(root, join(REPO_ROOT, 'scripts', name), [url, work], {});
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain(expected);
      expect(r.calls).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// scripts/readback_pages.sh -- read-backs 4, 6 and 8, and the serve-time stamp.
// ---------------------------------------------------------------------------

const SITE = 'https://cc2b76f9.openbed-public-dashboard.pages.dev';
const BEDS_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, s-maxage=30, stale-while-revalidate=300',
  'x-robots-tag': 'noindex, nofollow',
};
const BEDS_BODY = '{"v":9371,"wards":[],"facilities":[]}';

function pagesFixtures(head: string): Fixtures {
  const beds = (servedAt: string): Answer => ({ status: 200, headers: { ...BEDS_HEADERS, 'x-openbed-served-at': servedAt }, body: BEDS_BODY });
  return {
    [`GET ${SITE}/version.json`]: { status: 200, headers: { 'content-type': 'application/json' }, body: stampOf(head) },
    // read-back 6, read-back 8's GET, then the two serve-time reads.
    [`GET ${SITE}/beds.json`]: [beds('2026-09-23T18:48:44.001Z'), beds('2026-09-23T18:48:47.300Z'), beds('2026-09-23T18:48:50.582Z'), beds('2026-09-23T18:48:56.068Z')],
    [`HEAD ${SITE}/beds.json`]: { status: 200, headers: { ...BEDS_HEADERS, 'x-openbed-served-at': '2026-09-23T18:48:48.000Z' } },
  };
}

describe('scripts/readback_pages.sh', () => {
  test('real read-back is accepted — the answers observed on 2026-09-23 give PASS, with every check ok', () => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const r = run(root, SCRIPTS.pages, [SITE, work], pagesFixtures(head));
      expect(r.status, r.out).toBe(0);
      for (const check of [
        'read-back 4 body',
        'read-back 4 commit',
        'read-back 4 dirty',
        'read-back 4 ancestor check exit (0 means on origin/main)',
        'read-back 6 status',
        'read-back 6 content-type',
        'read-back 6 x-robots-tag',
        'read-back 6 body',
        'read-back 8 GET status',
        'read-back 8 GET cache-control',
        'read-back 8 HEAD status',
        'read-back 8 HEAD content-type',
        'read-back 8 HEAD cache-control',
        'read-back 8 HEAD x-robots-tag',
        'serve-time stamp, first read',
        'serve-time stamp, second read',
        'serve-time stamp advances',
      ]) {
        expect(r.out, `the check "${check}" never ran`).toContain(`  ok     ${check}: `);
      }
      expect(r.out).toContain('PASS: read-backs 4, 6 and 8 and the serve-time stamp read as they must.');
      expect(r.calls).toContain(`HEAD ${SITE}/beds.json`);
    });
  });

  test.each<[string, (f: Fixtures, head: string) => void, string]>([
    ['a stamp naming another commit', (f) => { f[`GET ${SITE}/version.json`] = { status: 200, body: stampOf('0'.repeat(40)) }; }, 'read-back 4 commit'],
    ['a dirty stamp', (f, head) => { f[`GET ${SITE}/version.json`] = { status: 200, body: stampOf(head, true) }; }, 'read-back 4 dirty'],
    ['the SPA fallback answering /version.json', (f) => { f[`GET ${SITE}/version.json`] = { status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><html></html>' }; }, 'read-back 4 body'],
    ['a 500 from the Function carrying the same two headers', (f) => { f[`GET ${SITE}/beds.json`] = { status: 500, headers: BEDS_HEADERS, body: '{"error":"SUPABASE_SERVICE_ROLE_KEY is not set"}' }; }, 'read-back 6 status'],
    ['an {"error": body behind a 200', (f) => { f[`GET ${SITE}/beds.json`] = { status: 200, headers: { ...BEDS_HEADERS, 'x-openbed-served-at': '2026-09-23T18:48:50.582Z' }, body: '{"error":"no snapshot"}' }; }, 'read-back 6 body'],
    ['HEAD answered by the SPA fallback', (f) => { f[`HEAD ${SITE}/beds.json`] = { status: 200, headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' } }; }, 'read-back 8 HEAD content-type'],
    ['the failure cache header, no-store', (f) => { f[`HEAD ${SITE}/beds.json`] = { status: 200, headers: { ...BEDS_HEADERS, 'cache-control': 'no-store' } }; }, 'read-back 8 HEAD cache-control'],
    ['a serve-time stamp that does not advance', (f) => { f[`GET ${SITE}/beds.json`] = { status: 200, headers: { ...BEDS_HEADERS, 'x-openbed-served-at': '2026-09-23T18:48:50.582Z' }, body: BEDS_BODY }; }, 'serve-time stamp advances'],
    ['no serve-time stamp at all', (f) => { f[`GET ${SITE}/beds.json`] = { status: 200, headers: BEDS_HEADERS, body: BEDS_BODY }; }, 'serve-time stamp, first read'],
  ])('plant — %s is a STOP', (_label, plant, check) => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const f = pagesFixtures(head);
      plant(f, head);
      expectStopAt(run(root, SCRIPTS.pages, [SITE, work], f), check);
    });
  });

  test('plant — a checkout whose HEAD is not on origin/main is a STOP, even when the stamp names it', () => {
    withScratch((root) => {
      const work = repo(root, { pushed: false });
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const r = run(root, SCRIPTS.pages, [SITE, work], pagesFixtures(head));
      expect(r.out).toContain('  ok     read-back 4 commit: ');
      expectStopAt(r, 'read-back 4 ancestor check exit (0 means on origin/main)');
    });
  });

  test('could not run — an ancestor check that cannot run is an ERROR, never a verdict', () => {
    withScratch((root) => {
      const work = repo(root, { remote: false });
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const r = run(root, SCRIPTS.pages, [SITE, work], pagesFixtures(head));
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('ERROR: the ancestor check did not run (git merge-base exited 128) -- this read-back has no verdict');
      expect(r.out).not.toContain('PASS:');
      expect(r.out).not.toContain('STOP: a line above');
    });
  });

  test('could not run — a request that fails is an ERROR, never a verdict', () => {
    withScratch((root) => {
      const work = repo(root);
      const r = run(root, SCRIPTS.pages, [SITE, work], { [`GET ${SITE}/version.json`]: { fail: 6 } });
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain(`ERROR: curl exited 6 on GET ${SITE}/version.json -- the check did not run, so this read-back has no verdict`);
      expect(r.out).not.toContain('PASS:');
    });
  });

  test('could not run — a directory that is not a checkout is an ERROR naming the deploy checkout', () => {
    withScratch((root) => {
      const r = run(root, SCRIPTS.pages, [SITE, join(root, 'not-a-checkout')], {});
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('-- run this from the deploy checkout; nothing was checked');
      expect(r.out).toContain('ERROR: git could not read HEAD in');
      expect(r.calls).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// scripts/readback_ward_console.sh -- step 2's stamp and step 3's live-key probe.
// ---------------------------------------------------------------------------

const WARD = 'https://6abd577d.openbed-ward-console.pages.dev';
const API = 'https://api.openbed.ng';
const DEPLOYED_KEY = 'sb_publishable_DEPLOYED_KEY_IN_THE_BUNDLE';
const WRONG_KEY = 'sb_publishable_DELIBERATELY_WRONG_FOR_THE_FAILING_HALF';

function wardFixtures(head: string): Fixtures {
  return {
    [`GET ${WARD}/version.json`]: { status: 200, body: stampOf(head) },
    [`GET ${WARD}/`]: { status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html><script type="module" crossorigin src="/assets/index-B7kFspkD.js"></script>' },
    [`GET ${WARD}/assets/index-B7kFspkD.js`]: { status: 200, body: `const k="${DEPLOYED_KEY}";` },
    [`GET ${API}/auth/v1/settings apikey=${DEPLOYED_KEY}`]: { status: 200, headers: { 'x-openbed-proxy': 'forwarded' }, body: '{"external":{"email":true}}' },
    [`GET ${API}/auth/v1/settings apikey=${WRONG_KEY}`]: { status: 401, headers: { 'x-openbed-proxy': 'forwarded' }, body: '{"message":"Invalid API key","hint":"Double check your Supabase `anon` or `service_role` API key."}' },
  };
}

describe('scripts/readback_ward_console.sh', () => {
  test('real read-back is accepted — the answers observed on 2026-09-23 give PASS, with every check ok', () => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const r = run(root, SCRIPTS.ward, [WARD, work], wardFixtures(head));
      expect(r.status, r.out).toBe(0);
      for (const check of [
        'step 2 commit',
        'step 2 dirty',
        'step 3 bundles the page loads',
        'step 3 publishable keys in the deployed bundle',
        'step 3 live half status',
        'step 3 live half body',
        'step 3 dead half status',
        'step 3 dead half body',
      ]) {
        expect(r.out, `the check "${check}" never ran`).toContain(`  ok     ${check}: `);
      }
      expect(r.out).toContain('PASS: the stamp names this checkout, the deployed key is accepted at the edge, and a wrong key is refused.');
      expect(r.calls, 'the key was not read out of the DEPLOYED bundle').toContain(`GET ${API}/auth/v1/settings apikey=${DEPLOYED_KEY}`);
      expect(r.calls, 'the failing half was never sent').toContain(`GET ${API}/auth/v1/settings apikey=${WRONG_KEY}`);
    });
  });

  test.each<[string, (f: Fixtures) => void, string]>([
    ['a stamp naming another commit', (f) => { f[`GET ${WARD}/version.json`] = { status: 200, body: stampOf('0'.repeat(40)) }; }, 'step 2 commit'],
    ['two publishable keys in the bundle', (f) => { f[`GET ${WARD}/assets/index-B7kFspkD.js`] = { status: 200, body: `const k="${DEPLOYED_KEY}",j="sb_publishable_A_SECOND_KEY";` }; }, 'step 3 publishable keys in the deployed bundle'],
    ['a page that loads no bundle', (f) => { f[`GET ${WARD}/`] = { status: 200, body: '<!doctype html><p>not the ward console</p>' }; }, 'step 3 bundles the page loads'],
    ['a dead deployed key', (f) => { f[`GET ${API}/auth/v1/settings apikey=${DEPLOYED_KEY}`] = { status: 401, body: '{"message":"Invalid API key"}' }; }, 'step 3 live half status'],
    ['a failing half that does not fail', (f) => { f[`GET ${API}/auth/v1/settings apikey=${WRONG_KEY}`] = { status: 200, body: '{"external":{}}' }; }, 'step 3 dead half status'],
    ['a live body that is not the settings object', (f) => { f[`GET ${API}/auth/v1/settings apikey=${DEPLOYED_KEY}`] = { status: 200, body: '{"message":"ok"}' }; }, 'step 3 live half body'],
  ])('plant — %s is a STOP', (_label, plant, check) => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const f = wardFixtures(head);
      plant(f);
      expectStopAt(run(root, SCRIPTS.ward, [WARD, work], f), check);
    });
  });
});

// ---------------------------------------------------------------------------
// scripts/readback_worker.sh -- probes 1 to 3 and the stamp.
// ---------------------------------------------------------------------------

function workerFixtures(head: string): Fixtures {
  const fwd = { 'x-openbed-proxy': 'forwarded' };
  return {
    [`POST ${API}/rest/v1/rpc/my_facility_wards`]: { status: 401, headers: { 'sb-project-ref': 'klrlpxysjsjpdkeqdhvl', ...fwd }, body: '{"message":"No API key found in request"}' },
    [`GET ${API}/auth/v1/settings apikey=${TRACKED_KEY}`]: { status: 200, headers: fwd, body: '{"external":{"email":true}}' },
    [`HEAD ${API}/auth/v1/settings apikey=${TRACKED_KEY}`]: { status: 405, headers: fwd },
    [`GET ${API}/rest/v1/`]: { status: 404, headers: { 'x-openbed-proxy': 'refused' }, body: '{"message":"not forwarded by the OpenBed proxy"}' },
    [`GET ${API}/__openbed/version`]: { status: 200, headers: { 'x-openbed-proxy': 'stamp' }, body: stampOf(head) },
    [`HEAD ${API}/__openbed/version`]: { status: 200, headers: { 'x-openbed-proxy': 'stamp' } },
  };
}

describe('scripts/readback_worker.sh', () => {
  test('real read-back is accepted — the answers observed on 2026-09-23 give PASS, with every check ok', () => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const r = run(root, SCRIPTS.worker, [API, work], workerFixtures(head));
      expect(r.status, r.out).toBe(0);
      for (const check of [
        'probe 1 status',
        'probe 1 sb-project-ref',
        'probe 1 x-openbed-proxy',
        'probe 2 GET status',
        'probe 2 GET x-openbed-proxy',
        'probe 2 HEAD status',
        'probe 2 HEAD x-openbed-proxy',
        'probe 3 status',
        'probe 3 x-openbed-proxy',
        'probe 3 body',
        'stamp commit',
        'stamp dirty',
        'stamp HEAD status',
        'stamp HEAD x-openbed-proxy',
      ]) {
        expect(r.out, `the check "${check}" never ran`).toContain(`  ok     ${check}: `);
      }
      expect(r.out).toContain('PASS: probes 1 to 3 and the stamp read as they must. Probe 4, the deployed source, is Cowork');
      expect(r.calls, 'probe 2 did not send the tracked key').toContain(`GET ${API}/auth/v1/settings apikey=${TRACKED_KEY}`);
    });
  });

  test.each<[string, (f: Fixtures) => void, string]>([
    ['a 401 that did not come through the Worker', (f) => { f[`POST ${API}/rest/v1/rpc/my_facility_wards`] = { status: 401, headers: { 'sb-project-ref': 'klrlpxysjsjpdkeqdhvl' } }; }, 'probe 1 x-openbed-proxy'],
    ['another project answering', (f) => { f[`POST ${API}/rest/v1/rpc/my_facility_wards`] = { status: 401, headers: { 'sb-project-ref': 'someotherproject', 'x-openbed-proxy': 'forwarded' } }; }, 'probe 1 sb-project-ref'],
    ['the settings path refused by the list', (f) => { f[`GET ${API}/auth/v1/settings apikey=${TRACKED_KEY}`] = { status: 404, headers: { 'x-openbed-proxy': 'refused' } }; }, 'probe 2 GET status'],
    ['HEAD answering 200, the value the runbook stated before it was observed', (f) => { f[`HEAD ${API}/auth/v1/settings apikey=${TRACKED_KEY}`] = { status: 200, headers: { 'x-openbed-proxy': 'forwarded' } }; }, 'probe 2 HEAD status'],
    ["Supabase's own 404 at the off-list path, as a Worker that forwards everything would give", (f) => { f[`GET ${API}/rest/v1/`] = { status: 404, body: '{"error":"requested path is invalid"}' }; }, 'probe 3 x-openbed-proxy'],
    ['the previous Worker still serving its stamp', (f) => { f[`GET ${API}/__openbed/version`] = { status: 200, headers: { 'x-openbed-proxy': 'stamp' }, body: stampOf('0'.repeat(40)) }; }, 'stamp commit'],
    ['the stamp path answered by Supabase, not the Worker', (f) => { f[`HEAD ${API}/__openbed/version`] = { status: 404 }; }, 'stamp HEAD x-openbed-proxy'],
  ])('plant — %s is a STOP', (_label, plant, check) => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const f = workerFixtures(head);
      plant(f);
      expectStopAt(run(root, SCRIPTS.worker, [API, work], f), check);
    });
  });

  test('could not run — a checkout without the tracked key file is an ERROR, never a verdict', () => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      execFileSync('rm', [join(work, 'packages', 'origins', 'publishable-keys.json')]);
      const r = run(root, SCRIPTS.worker, [API, work], workerFixtures(head));
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('ERROR: could not read the tracked publishable key from');
      expect(r.out).toContain('/packages/origins/publishable-keys.json (node exited 1) -- nothing was checked');
      expect(r.calls).toEqual([]);
    });
  });

  test('could not run — a checkout without the tracked origins file is an ERROR, never a verdict', () => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      execFileSync('rm', [join(work, 'packages', 'origins', 'origins.json')]);
      const r = run(root, SCRIPTS.worker, [API, work], workerFixtures(head));
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('ERROR: could not read the Supabase project ref from');
      expect(r.calls).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// The shared file's own could-not-run legs, reached through a script.
// ---------------------------------------------------------------------------

describe('scripts/readback_common.sh — node failing is an ERROR, never a verdict', () => {
  test('could not run — node failing while reading a stamp or searching a body is an ERROR', () => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const bin = stubBin(root);
      // A node that always fails, AFTER the curl stub (which is itself node) has run:
      // the stub is called by absolute interpreter path below, so only the scripts'
      // own node calls reach this one.
      const realNode = process.execPath;
      writeFileSync(join(bin, 'curl'), readFileSync(join(bin, 'curl'), 'utf8').replace('#!/usr/bin/env node', `#!${realNode}`));
      writeFileSync(join(bin, 'node'), '#!/usr/bin/env bash\nexit 9\n');
      chmodSync(join(bin, 'node'), 0o755);
      writeFileSync(join(root, 'fixtures.json'), JSON.stringify(wardFixtures(head)));
      writeFileSync(join(root, 'stub.log'), '');
      let out = '';
      let status = 0;
      try {
        out = execFileSync('bash', [SCRIPTS.ward, WARD, work], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}`, STUB_LOG: join(root, 'stub.log'), STUB_FIXTURES: join(root, 'fixtures.json'), STUB_COUNTS: join(root, 'counts.json') },
        });
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        status = err.status ?? -1;
        out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
      }
      expect(status, out).toBe(2);
      expect(out).toContain('ERROR: node exited 9 reading a version stamp -- the check did not run, so this read-back has no verdict');
      expect(out).not.toContain('PASS:');
    });
  });

  test('could not run — node failing while searching the page is an ERROR', () => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const bin = stubBin(root);
      const realNode = process.execPath;
      writeFileSync(join(bin, 'curl'), readFileSync(join(bin, 'curl'), 'utf8').replace('#!/usr/bin/env node', `#!${realNode}`));
      // This node passes the stamp read (it delegates) and fails the body search.
      writeFileSync(join(bin, 'node'), `#!/usr/bin/env bash\ncase "$2" in *'new RegExp'*) exit 9 ;; esac\nexec "${realNode}" "$@"\n`);
      chmodSync(join(bin, 'node'), 0o755);
      writeFileSync(join(root, 'fixtures.json'), JSON.stringify(wardFixtures(head)));
      writeFileSync(join(root, 'stub.log'), '');
      let out = '';
      let status = 0;
      try {
        out = execFileSync('bash', [SCRIPTS.ward, WARD, work], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}`, STUB_LOG: join(root, 'stub.log'), STUB_FIXTURES: join(root, 'fixtures.json'), STUB_COUNTS: join(root, 'counts.json') },
        });
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        status = err.status ?? -1;
        out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
      }
      expect(status, out).toBe(2);
      expect(out).toContain('ERROR: node exited 9 searching a response body -- the check did not run, so this read-back has no verdict');
      expect(out).toContain('  ok     step 2 commit: ');
    });
  });
});
