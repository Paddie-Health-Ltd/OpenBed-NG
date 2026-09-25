import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withScratch, REPO_ROOT } from './_scratch.js';
import { deployableApps } from './_apps.js';
import ORIGINS_JSON from '../../packages/origins/origins.json';

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
/** Named, as the shared file is, so the leg register credits this file's admin assertions to it. */
const ADMIN_NAME = 'readback_admin.sh';

const SCRIPTS = {
  common: join(REPO_ROOT, 'scripts', COMMON_NAME),
  pages: join(REPO_ROOT, 'scripts', 'readback_pages.sh'),
  ward: join(REPO_ROOT, 'scripts', 'readback_ward_console.sh'),
  worker: join(REPO_ROOT, 'scripts', 'readback_worker.sh'),
  publicOutput: join(REPO_ROOT, 'scripts', 'readback_public_output.sh'),
  grants: join(REPO_ROOT, 'scripts', 'readback_function_grants.sh'),
  admin: join(REPO_ROOT, 'scripts', ADMIN_NAME),
};

type Answer = { status: number; headers?: Record<string, string>; body?: string } | { fail: number } | { out: string };
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
/** The real api entry, so the scratch checkout renders the ward CSP as the real one does. */
const REAL_API = JSON.parse(readFileSync(join(REPO_ROOT, 'packages', 'origins', 'origins.json'), 'utf8')).api as unknown;

/** A scratch checkout with an origin and the two tracked origin files the Worker read-back reads. */
function repo(root: string, opts: { pushed?: boolean; remote?: boolean; headers?: boolean } = {}): string {
  const upstream = join(root, 'upstream.git');
  const work = join(root, 'work');
  mkdirSync(join(work, 'packages', 'origins'), { recursive: true });
  git(root, 'init', '-q', '--bare', '-b', 'main', upstream);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.email', 'plant@example.invalid');
  git(work, 'config', 'user.name', 'Plant');
  writeFileSync(join(work, 'packages', 'origins', 'publishable-keys.json'), JSON.stringify({ production: TRACKED_KEY }));
  writeFileSync(join(work, 'packages', 'origins', 'origins.json'), JSON.stringify({ supabaseDirect: { production: 'https://klrlpxysjsjpdkeqdhvl.supabase.co' }, api: REAL_API }));
  // The tracked _headers each read-back compares a page's security headers against (BP-10),
  // and the renderer that fills the ward console's API origins from origins.json (BV-2).
  mkdirSync(join(work, 'scripts'), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'scripts', 'render_headers.mjs'), join(work, 'scripts', 'render_headers.mjs'));
  // Every deployable app, derived (PR 3.4b-app C): a hand list here left the admin app's
  // _headers out of the scratch checkout until it was added by name.
  if (opts.headers !== false) {
    for (const app of deployableApps()) {
      mkdirSync(join(work, 'apps', app, 'public'), { recursive: true });
      copyFileSync(join(REPO_ROOT, 'apps', app, 'public', '_headers'), join(work, 'apps', app, 'public', '_headers'));
    }
  }
  // The admin read-back reads its Pages project name from here, never retyped.
  mkdirSync(join(work, 'apps', 'admin'), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'apps', 'admin', 'wrangler.toml'), join(work, 'apps', 'admin', 'wrangler.toml'));
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
if (a[0] === '--version') { process.stdout.write((process.env.STUB_CURL_VERSION || 'curl 8.7.1 (stub)') + '\\n'); process.exit(0); }
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
// -H @FILE reads headers from a file, one per line (readback_admin.sh's Access token).
// The stub records only WHETHER the token came, never its value.
for (const h of hdrs.filter((x) => x.startsWith('@'))) hdrs.push(...fs.readFileSync(h.slice(1), 'utf8').split('\\n').filter(Boolean));
const access = hdrs.some((h) => /^CF-Access-Client-Id:\\s*\\S/i.test(h)) && hdrs.some((h) => /^CF-Access-Client-Secret:\\s*\\S/i.test(h));
const apikey = (hdrs.map((h) => /^apikey:\\s*(.*)$/i.exec(h)).find(Boolean) || [])[1];
fs.appendFileSync(process.env.STUB_LOG, method + ' ' + url + (apikey ? ' apikey=' + apikey : '') + (access ? ' access' : '') + '\\n');
const fx = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURES, 'utf8'));
const k = apikey && (method + ' ' + url + ' apikey=' + apikey) in fx ? method + ' ' + url + ' apikey=' + apikey
  : access && (method + ' ' + url + ' access') in fx ? method + ' ' + url + ' access' : method + ' ' + url;
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
  // A psql stub for scripts/readback_public_output.sh: it answers from the same fixture
  // file, keyed "PSQL <table>" by the public table the -c query reads, and logs that key.
  writeFileSync(
    join(bin, 'psql'),
    `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
const q = a[a.lastIndexOf('-c') + 1] || '';
const t = (/from (?:public|pg_catalog)\\.([a-z_]+)/.exec(q) || [])[1] || '(no table)';
const k = 'PSQL ' + t;
fs.appendFileSync(process.env.STUB_LOG, k + '\\n');
const ans = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURES, 'utf8'))[k];
if (ans === undefined || ans.fail) { process.stderr.write('psql: error: planted failure for ' + k + '\\n'); process.exit(ans && ans.fail ? ans.fail : 2); }
process.stdout.write(ans.out + '\\n');
`,
    'utf8',
  );
  chmodSync(join(bin, 'psql'), 0o755);
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

  // THE RUNBOOK'S PLACEHOLDER, PASTED UNCHANGED (R-2026-09-25-113 CO-2). At H6 step 2
  // the fence's literal https://HASH.openbed-admin.pages.dev was run as written: step 1
  // read ok, the HASH-host lines read WRONG against a deployment that does not exist,
  // and the verdict was STOP -- a verdict about a deploy nobody named. A placeholder is
  // not a deployment, so it is an ERROR with no verdict, and nothing is fetched. The
  // token is set, so the missing-token ERROR cannot stand in for this one.
  test.each([
    ['readback_pages.sh', 'https://HASH.openbed-public-dashboard.pages.dev'],
    ['readback_ward_console.sh', 'https://HASH.openbed-ward-console.pages.dev'],
    ['readback_admin.sh', 'https://HASH.openbed-admin.pages.dev'],
    ['readback_admin.sh', 'https://HASH.openbed-admin.pages.dev/'],
  ])("plant — %s refuses the runbook's HASH placeholder %s with ERROR, exit 2, and probes nothing", (name, url) => {
    withScratch((root) => {
      const work = repo(root);
      const r = run(root, join(REPO_ROOT, 'scripts', name), [url, work], {}, ACCESS_ENV);
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain(`ERROR: '${url}' still holds the runbook's placeholder HASH -- paste the deployment URL wrangler printed in its place. Nothing was probed, so this read-back has no verdict`);
      expect(r.out, 'a placeholder read as a verdict about a deploy').not.toContain('STOP:');
      expect(r.out).not.toContain('PASS:');
      expect(r.calls, 'a request was made to the placeholder host').toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// scripts/readback_pages.sh -- read-backs 4, 6 and 8, and the serve-time stamp.
// ---------------------------------------------------------------------------

/**
 * The headers a tracked _headers file sets on /*, AS RENDERED by scripts/render_headers.mjs
 * for a build target (BV-2; R-2026-09-25-117 CS-2), lower-cased names -- the read-backs'
 * source of truth, and what a deploy serves. A hosted deploy is `production`; only
 * readback_admin.sh --local serves a `local` build.
 */
function trackedHeaders(app: string, target: 'production' | 'local' = 'production'): Record<string, string> {
  const out: Record<string, string> = {};
  let inAll = false;
  const rendered = execFileSync('node', [join(REPO_ROOT, 'scripts', 'render_headers.mjs'), '--target', target, join(REPO_ROOT, 'apps', app, 'public', '_headers')], { encoding: 'utf8' });
  for (const raw of rendered.split('\n')) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) { inAll = raw.trim() === '/*'; continue; }
    const i = raw.indexOf(':');
    if (inAll && i > 0) out[raw.slice(0, i).trim().toLowerCase()] = raw.slice(i + 1).trim();
  }
  return out;
}

/** A copy of `headers` with one header removed -- the shape a plant needs. */
function without(headers: Record<string, string>, name: string): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([k]) => k !== name));
}

const SITE = 'https://cc2b76f9.openbed-public-dashboard.pages.dev';
const BEDS_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, s-maxage=30, stale-while-revalidate=300',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
};
const BEDS_BODY = '{"v":9371,"wards":[],"facilities":[]}';

function pagesFixtures(head: string): Fixtures {
  const beds = (servedAt: string): Answer => ({ status: 200, headers: { ...BEDS_HEADERS, 'x-openbed-served-at': servedAt }, body: BEDS_BODY });
  return {
    [`GET ${SITE}/version.json`]: { status: 200, headers: { 'content-type': 'application/json' }, body: stampOf(head) },
    // read-back 6, read-back 8's GET, then the two serve-time reads.
    [`GET ${SITE}/beds.json`]: [beds('2026-09-23T18:48:44.001Z'), beds('2026-09-23T18:48:47.300Z'), beds('2026-09-23T18:48:50.582Z'), beds('2026-09-23T18:48:56.068Z')],
    [`HEAD ${SITE}/beds.json`]: { status: 200, headers: { ...BEDS_HEADERS, 'x-openbed-served-at': '2026-09-23T18:48:48.000Z' } },
    [`GET ${SITE}/`]: { status: 200, headers: { 'content-type': 'text/html', ...trackedHeaders('public-dashboard') }, body: '<!doctype html>' },
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
        'read-back 6 x-content-type-options',
        'read-back 6 body',
        'read-back 8 GET status',
        'read-back 8 GET cache-control',
        'read-back 8 HEAD status',
        'read-back 8 HEAD content-type',
        'read-back 8 HEAD cache-control',
        'read-back 8 HEAD x-robots-tag',
        'read-back 8 GET x-content-type-options',
        'read-back 8 HEAD x-content-type-options',
        'page status',
        'page content-security-policy',
        'page referrer-policy',
        'page x-content-type-options',
        'serve-time stamp, first read',
        'serve-time stamp, second read',
        'serve-time stamp advances',
      ]) {
        expect(r.out, `the check "${check}" never ran`).toContain(`  ok     ${check}: `);
      }
      expect(r.out).toContain("PASS: read-backs 4, 6 and 8, the page's security headers and the serve-time stamp read as they must.");
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
    ['/beds.json without nosniff (BU-2 d)', (f) => { f[`HEAD ${SITE}/beds.json`] = { status: 200, headers: without(BEDS_HEADERS, 'x-content-type-options') }; }, 'read-back 8 HEAD x-content-type-options'],
    ['a page CSP that differs from the tracked one', (f) => { f[`GET ${SITE}/`] = { status: 200, headers: { ...trackedHeaders('public-dashboard'), 'content-security-policy': "default-src *" } }; }, 'page content-security-policy'],
    ['a page with no Referrer-Policy', (f) => { f[`GET ${SITE}/`] = { status: 200, headers: without(trackedHeaders('public-dashboard'), 'referrer-policy') }; }, 'page referrer-policy'],
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
    [`GET ${WARD}/`]: { status: 200, headers: { 'content-type': 'text/html', ...trackedHeaders('ward-console') }, body: '<!doctype html><script type="module" crossorigin src="/assets/index-B7kFspkD.js"></script>' },
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
        'step 3 content-security-policy',
        'step 3 referrer-policy',
        'step 3 x-content-type-options',
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
    ['a console page served with no CSP', (f) => { f[`GET ${WARD}/`] = { status: 200, headers: without(trackedHeaders('ward-console'), 'content-security-policy'), body: '<!doctype html><script type="module" crossorigin src="/assets/index-B7kFspkD.js"></script>' }; }, 'step 3 content-security-policy'],
    // THE PRE-CS DEPLOY (R-2026-09-25-117 CS-2 f): its CSP names the local origin beside the production one. Held to the
    // production rendering, it reads WRONG, which is the failing half of the ward console's redeploy step.
    ['the pre-CS deployment, whose CSP also names the local origin', (f) => { const h = trackedHeaders('ward-console'); f[`GET ${WARD}/`] = { status: 200, headers: { ...h, 'content-security-policy': (h['content-security-policy'] as string).replace(ORIGINS_JSON.api.production, `${ORIGINS_JSON.api.production} ${ORIGINS_JSON.api.local}`) }, body: '<!doctype html><script type="module" crossorigin src="/assets/index-B7kFspkD.js"></script>' }; }, 'step 3 content-security-policy'],
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
      // It delegates ONLY the header render (BV-2), which the read-back runs before the
      // stamp: without that, this plant stops at the render and never reaches the leg
      // it is for. The render's own failure is a leg of its own, planted below.
      writeFileSync(join(bin, 'node'), `#!/usr/bin/env bash\ncase "$1" in *render_headers.mjs) exec "${realNode}" "$@" ;; esac\nexit 9\n`);
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

// ---------------------------------------------------------------------------
// scripts/readback_public_output.sh -- 020's hosted apply must change no public
// output (R-2026-09-24-73 BA-2). Before the apply it prints a FINGERPRINT; after,
// given that fingerprint, it reads PASS or STOP naming each part that moved.
// ---------------------------------------------------------------------------

const ORIGIN = 'https://openbed.ng';
const EMPTY = '0:d41d8cd98f00';
const DB_ENV = { DATABASE_URL: 'postgresql://stub@db.invalid:5432/postgres' };

const bedsBody = (v: number, generatedAt: string, facilities: unknown[] = [], wards: unknown[] = []): string =>
  JSON.stringify({ v, generated_at: generatedAt, server_now: generatedAt, facilities, wards });

const FACILITY_ROW = ['f-1', 'Synthetic General', 'Ikeja', 'Lagos', 6.6, 3.3, '+2340000000000', '2026-09-24T01:00:00Z'];
const WARD_ROW = ['f-1', 'MATERNITY', 'OFFERED', 3, '2026-09-24T01:00:00Z'];

function outputFixtures(opts: { empty?: boolean; body?: string } = {}): Fixtures {
  const facilities = opts.empty ? [] : [FACILITY_ROW];
  const wards = opts.empty ? [] : [WARD_ROW];
  return {
    [`GET ${ORIGIN}/beds.json`]: { status: 200, headers: { 'content-type': 'application/json' }, body: opts.body ?? bedsBody(9371, '2026-09-24T01:00:00Z', facilities, wards) },
    'PSQL facility_public': { out: opts.empty ? EMPTY : '1:0a1b2c3d4e5f' },
    'PSQL ward_public': { out: opts.empty ? EMPTY : '1:1a2b3c4d5e6f' },
    'PSQL lga_rollup': { out: EMPTY },
  };
}

const FINGERPRINT_LINE = /^FINGERPRINT (beds\.json=\d+\/\d+:[0-9a-f]{12},facility_public=\d+:[0-9a-f]{12},ward_public=\d+:[0-9a-f]{12},lga_rollup=\d+:[0-9a-f]{12})$/m;

/** The before-reading's fingerprint, as the founder would copy it. */
function before(root: string, fixtures: Fixtures): string {
  const r = run(root, SCRIPTS.publicOutput, [ORIGIN], fixtures, DB_ENV);
  expect(r.status, r.out).toBe(0);
  const m = FINGERPRINT_LINE.exec(r.out);
  expect(m, `no FINGERPRINT line was printed:\n${r.out}`).not.toBeNull();
  return m![1]!;
}

describe('scripts/readback_public_output.sh', () => {
  test('real reading is accepted — before the apply it prints the four parts and one FINGERPRINT, and reads nothing else', () => {
    withScratch((root) => {
      const r = run(root, SCRIPTS.publicOutput, [ORIGIN], outputFixtures(), DB_ENV);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toMatch(FINGERPRINT_LINE);
      expect(r.out).toContain('RECORDED: the reading before the apply. Keep the FINGERPRINT line.');
      expect(r.out).toContain(`  bash scripts/readback_public_output.sh ${ORIGIN} '`);
      expect(r.out).not.toContain('PASS:');
      expect(r.calls).toEqual([`GET ${ORIGIN}/beds.json`, 'PSQL facility_public', 'PSQL ward_public', 'PSQL lga_rollup']);
    });
  });

  test('real reading is accepted — after the apply, the same output gives PASS with every part ok', () => {
    withScratch((root) => {
      const fp = before(root, outputFixtures());
      const r = run(root, SCRIPTS.publicOutput, [ORIGIN, fp], outputFixtures(), DB_ENV);
      expect(r.status, r.out).toBe(0);
      for (const part of ['beds.json', 'facility_public', 'ward_public', 'lga_rollup']) {
        expect(r.out, `the part "${part}" was never compared`).toContain(`  ok     ${part}: `);
      }
      expect(r.out).toContain('PASS: the public output reads exactly as it did before the apply.');
      expect(r.out).not.toContain('VACUOUS');
    });
  });

  test('plant — an empty hosted project passes only as VACUOUS FOR B1, never as a plain PASS', () => {
    withScratch((root) => {
      const fp = before(root, outputFixtures({ empty: true }));
      const r = run(root, SCRIPTS.publicOutput, [ORIGIN, fp], outputFixtures({ empty: true }), DB_ENV);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain('NOTE: every count, before and after, is 0.');
      expect(r.out).toContain('PASS (VACUOUS FOR B1): the apply created no public row. With nothing public before it, this cannot show that it changed none.');
      expect(r.out).not.toContain('PASS: the public output reads exactly');
    });
  });

  test('plant — only the envelope moving (v, generated_at, server_now) is not a change', () => {
    withScratch((root) => {
      const fp = before(root, outputFixtures());
      const later = outputFixtures({ body: bedsBody(9384, '2026-09-24T01:13:00Z', [FACILITY_ROW], [WARD_ROW]) });
      const r = run(root, SCRIPTS.publicOutput, [ORIGIN, fp], later, DB_ENV);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain('PASS: the public output reads exactly as it did before the apply.');
    });
  });

  test.each<[string, (f: Fixtures) => void, string]>([
    ['a facility row whose updated_at moved in beds.json', (f) => { f[`GET ${ORIGIN}/beds.json`] = { status: 200, body: bedsBody(9384, '2026-09-24T01:13:00Z', [[...FACILITY_ROW.slice(0, 7), '2026-09-24T01:05:00Z']], [WARD_ROW]) }; }, 'beds.json'],
    ['a ward row gone from beds.json', (f) => { f[`GET ${ORIGIN}/beds.json`] = { status: 200, body: bedsBody(9384, '2026-09-24T01:13:00Z', [FACILITY_ROW], []) }; }, 'beds.json'],
    ['beds.json answering the SPA fallback', (f) => { f[`GET ${ORIGIN}/beds.json`] = { status: 200, body: '<!doctype html><html></html>' }; }, 'beds.json'],
    ['beds.json answering 500', (f) => { f[`GET ${ORIGIN}/beds.json`] = { status: 500, body: bedsBody(1, 'x', [FACILITY_ROW], [WARD_ROW]) }; }, 'beds.json'],
    ['facility_public with the same count and other contents', (f) => { f['PSQL facility_public'] = { out: '1:ffffffffffff' }; }, 'facility_public'],
    ['ward_public with a row more', (f) => { f['PSQL ward_public'] = { out: '2:1a2b3c4d5e6f' }; }, 'ward_public'],
    ['lga_rollup with a row', (f) => { f['PSQL lga_rollup'] = { out: '1:abcdefabcdef' }; }, 'lga_rollup'],
  ])('plant — %s after the apply is a STOP naming it', (_name, plant, part) => {
    withScratch((root) => {
      const fp = before(root, outputFixtures());
      const after = outputFixtures();
      plant(after);
      const r = run(root, SCRIPTS.publicOutput, [ORIGIN, fp], after, DB_ENV);
      expectStopAt(r, part);
      expect(r.out).toContain('The public output changed across the apply. Run nothing further; paste this whole output back.');
    });
  });

  test('plant — a before-reading that is not a snapshot is no baseline, and says do not apply', () => {
    withScratch((root) => {
      const r = run(root, SCRIPTS.publicOutput, [ORIGIN], outputFixtures({ body: '<!doctype html>' }), DB_ENV);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain(`STOP: ${ORIGIN}/beds.json did not answer a snapshot (read 'not-a-snapshot'), so this reading is no baseline. Do not apply.`);
      expect(r.out).not.toMatch(FINGERPRINT_LINE);
    });
  });

  test('plant — no URL, and an http:// URL, STOP with nothing read', () => {
    withScratch((root) => {
      for (const args of [[], ['http://openbed.ng']]) {
        const r = run(root, SCRIPTS.publicOutput, args, outputFixtures(), DB_ENV);
        expect(r.status, r.out).toBe(2);
        expect(r.out).toContain('Usage: bash scripts/readback_public_output.sh https://openbed.ng');
        expect(r.calls, 'something was read with no usable URL').toEqual([]);
      }
    });
  });

  test('plant — no DATABASE_URL STOPs before beds.json or any table is read', () => {
    withScratch((root) => {
      const r = run(root, SCRIPTS.publicOutput, [ORIGIN], outputFixtures(), { DATABASE_URL: '' });
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('STOP: DATABASE_URL is not set, so nothing was read.');
      expect(r.calls).toEqual([]);
    });
  });

  test('plant — a second argument that is not a fingerprint this script printed STOPs before anything is read', () => {
    withScratch((root) => {
      const r = run(root, SCRIPTS.publicOutput, [ORIGIN, 'FINGERPRINT beds.json=0/0:abc'], outputFixtures(), DB_ENV);
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain("is not a fingerprint this script printed, so nothing was read. Copy the value after 'FINGERPRINT ' from the before-reading, inside single quotes.");
      expect(r.calls).toEqual([]);
    });
  });

  test('could not run — psql failing is an ERROR naming the table, never a verdict', () => {
    withScratch((root) => {
      const f = outputFixtures();
      f['PSQL ward_public'] = { fail: 2 };
      const r = run(root, SCRIPTS.publicOutput, [ORIGIN], f, DB_ENV);
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('ERROR: psql exited 2 reading public.ward_public -- 127 means psql is not on PATH (step P). The reading did not run, so it has no verdict');
      expect(r.out).not.toMatch(FINGERPRINT_LINE);
      expect(r.out).not.toContain('PASS');
    });
  });

  test('could not run — psql answering something that is not a count and a digest is an ERROR, never a verdict', () => {
    withScratch((root) => {
      const f = outputFixtures();
      f['PSQL lga_rollup'] = { out: 'relation does not exist' };
      const r = run(root, SCRIPTS.publicOutput, [ORIGIN], f, DB_ENV);
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain("is not a count and a digest -- the reading did not run, so it has no verdict");
      expect(r.out).not.toMatch(FINGERPRINT_LINE);
    });
  });

  test('could not run — node failing while summarising beds.json is an ERROR, never a verdict', () => {
    withScratch((root) => {
      const bin = stubBin(root);
      const realNode = process.execPath;
      for (const stub of ['curl', 'psql']) {
        writeFileSync(join(bin, stub), readFileSync(join(bin, stub), 'utf8').replace('#!/usr/bin/env node', `#!${realNode}`));
      }
      writeFileSync(join(bin, 'node'), '#!/usr/bin/env bash\nexit 9\n');
      chmodSync(join(bin, 'node'), 0o755);
      writeFileSync(join(root, 'fixtures.json'), JSON.stringify(outputFixtures()));
      writeFileSync(join(root, 'stub.log'), '');
      let out = '';
      let status = 0;
      try {
        out = execFileSync('bash', [SCRIPTS.publicOutput, ORIGIN], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, ...DB_ENV, PATH: `${bin}:${process.env['PATH'] ?? ''}`, STUB_LOG: join(root, 'stub.log'), STUB_FIXTURES: join(root, 'fixtures.json'), STUB_COUNTS: join(root, 'counts.json') },
        });
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        status = err.status ?? -1;
        out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
      }
      expect(status, out).toBe(2);
      expect(out).toContain('ERROR: node exited 9 summarising beds.json -- the reading did not run, so it has no verdict');
      expect(out).not.toMatch(FINGERPRINT_LINE);
    });
  });
});

// ---------------------------------------------------------------------------
// scripts/readback_function_grants.sh -- fence 6 of 020's apply (R-2026-09-24-74
// BB-2): who can EXECUTE every function, held to packages/fixtures/function-grants.json.
// The query and the comparison against a real schema are tests/db/function_grants.test.ts;
// these legs are the script's own refusals and verdicts, over the psql stub.
// ---------------------------------------------------------------------------

type GrantsFixture = { functions: Record<string, { execute: string[] }> };
const GRANTS_FX = JSON.parse(readFileSync(join(REPO_ROOT, 'packages', 'fixtures', 'function-grants.json'), 'utf8')) as GrantsFixture;

/** The rows the grants query would read on a database that matches the fixture. */
function grantRows(): Record<string, string> {
  return Object.fromEntries(Object.entries(GRANTS_FX.functions).map(([id, g]) => [id, g.execute.join(',')]));
}
/**
 * Each row is identity|roles|owner|return type|security definer (R-2026-09-24-77 BE-1).
 * The last three are compared only for a hosted_only entry, so the main rows carry any
 * plausible value.
 */
const MAIN_TAIL = 'postgres|void|f';
/** The one hosted_only function, as fence 6 of 020's apply read it on 2026-09-24. */
const HOSTED = 'public.rls_auto_enable()';
const HOSTED_ROW = `${HOSTED}|anon,authenticated,service_role|postgres|event_trigger|t`;
const grantsAnswer = (r: Record<string, string>, extra: string[] = []): Fixtures => ({
  'PSQL pg_proc': { out: [...Object.entries(r).map(([id, roles]) => `${id}|${roles}|${MAIN_TAIL}`), ...extra].join('\n') },
});

describe('scripts/readback_function_grants.sh', () => {
  test('real reading is accepted — rows matching the fixture give PASS, with every function ok', () => {
    withScratch((root) => {
      const r = run(root, SCRIPTS.grants, [], grantsAnswer(grantRows()), DB_ENV);
      expect(r.status, r.out).toBe(0);
      for (const id of Object.keys(GRANTS_FX.functions)) expect(r.out, `the function ${id} was never compared`).toContain(`  ok     ${id} EXECUTE: `);
      expect(r.out).toContain('PASS: every function in app, graphql_public and public is executable by exactly the roles packages/fixtures/function-grants.json names.');
      expect(r.calls).toEqual(['PSQL pg_proc']);
      expect(r.out, 'a hosted_only function absent from this database is not a failure').toContain(`  ok     ${HOSTED} (hosted-only): absent`);
    });
  });

  test('real reading is accepted — the hosted_only function, with every recorded property as fence 6 read it, gives PASS', () => {
    withScratch((root) => {
      const r = run(root, SCRIPTS.grants, [], grantsAnswer(grantRows(), [HOSTED_ROW]), DB_ENV);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain(`  ok     ${HOSTED} (hosted-only): anon,authenticated,service_role owner=postgres returns=event_trigger definer=true`);
      expect(r.out).toContain('PASS: every function in app, graphql_public and public is executable by exactly the roles packages/fixtures/function-grants.json names.');
    });
  });

  test.each<[string, string]>([
    ['a return type that is callable (void)', `${HOSTED}|anon,authenticated,service_role|postgres|void|t`],
    ['its grants reduced', `${HOSTED}|authenticated,service_role|postgres|event_trigger|t`],
    ['another owner', `${HOSTED}|anon,authenticated,service_role|supabase_admin|event_trigger|t`],
    ['no longer SECURITY DEFINER', `${HOSTED}|anon,authenticated,service_role|postgres|event_trigger|f`],
  ])('plant — the hosted_only function with %s is a STOP naming it (BE-1 b)', (_name, row) => {
    withScratch((root) => {
      const r = run(root, SCRIPTS.grants, [], grantsAnswer(grantRows(), [row]), DB_ENV);
      expectStopAt(r, `${HOSTED} (hosted-only)`);
    });
  });

  test('could not run — a fixture naming one function in both sections is an ERROR, never a verdict', () => {
    withScratch((root) => {
      mkdirSync(join(root, 'packages', 'fixtures'), { recursive: true });
      const fx = JSON.parse(readFileSync(join(REPO_ROOT, 'packages', 'fixtures', 'function-grants.json'), 'utf8')) as { functions: Record<string, unknown>; hosted_only: Record<string, unknown> };
      fx.hosted_only['app.provision_begin(uuid, text, text)'] = { execute: [], owner: 'postgres', returns: 'record', security_definer: true, why: 'planted' };
      writeFileSync(join(root, 'packages', 'fixtures', 'function-grants.json'), JSON.stringify(fx));
      const r = run(root, SCRIPTS.grants, [root], grantsAnswer(grantRows()), DB_ENV);
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('names a function in both its functions and hosted_only sections: app.provision_begin(uuid, text, text) -- the reading did not run, so it has no verdict');
    });
  });

  test.each<[string, (g: Record<string, string>) => void, string]>([
    ['anon holding EXECUTE on a provisioning gate', (g) => { g['app.provision_begin(uuid, text, text)'] = 'anon'; }, 'app.provision_begin(uuid, text, text) EXECUTE'],
    ['service_role holding a default grant the migrations should have revoked', (g) => { g['public.operator_register()'] = 'authenticated,service_role'; }, 'public.operator_register() EXECUTE'],
    ['authenticated missing a grant the fixture gives it', (g) => { g['public.publish_ward_status(text, text, integer, boolean, text, integer, text, timestamp with time zone)'] = ''; }, 'public.publish_ward_status(text, text, integer, boolean, text, integer, text, timestamp with time zone) EXECUTE'],
    ['a function the fixture does not name', (g) => { g['public.zz_hosted_only()'] = 'anon,authenticated,service_role'; }, 'public.zz_hosted_only() EXECUTE'],
    ['a fixture function the database lacks', (g) => { delete g['app.provision_complete(uuid, uuid)']; }, 'app.provision_complete(uuid, uuid) EXECUTE'],
  ])('plant — %s is a STOP naming it', (_name, plant, check) => {
    withScratch((root) => {
      const g = grantRows();
      plant(g);
      const r = run(root, SCRIPTS.grants, [], grantsAnswer(g), DB_ENV);
      expectStopAt(r, check);
      expect(r.out).toContain("A function's EXECUTE grants are not what the fixture says. Run nothing further; paste this whole output back.");
    });
  });

  test('plant — no DATABASE_URL STOPs before anything is read', () => {
    withScratch((root) => {
      const r = run(root, SCRIPTS.grants, [], grantsAnswer(grantRows()), { DATABASE_URL: '' });
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('STOP: DATABASE_URL is not set, so nothing was read.');
      expect(r.calls).toEqual([]);
    });
  });

  test('could not run — psql failing is an ERROR, never a verdict', () => {
    withScratch((root) => {
      const r = run(root, SCRIPTS.grants, [], { 'PSQL pg_proc': { fail: 2 } }, DB_ENV);
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('ERROR: psql exited 2 reading the function grants -- 127 means psql is not on PATH (step P). The reading did not run, so it has no verdict');
      expect(r.out).not.toContain('PASS');
    });
  });

  test('could not run — a row that is not a function and its roles is an ERROR, never a verdict', () => {
    withScratch((root) => {
      const r = run(root, SCRIPTS.grants, [], { 'PSQL pg_proc': { out: 'ERROR:  permission denied for table pg_proc' } }, DB_ENV);
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain("ERROR: psql answered a line that is not a function and its roles: 'ERROR:  permission denied for table pg_proc' -- the reading did not run, so it has no verdict");
    });
  });

  test('anti-vacuity — a query that read no functions is an ERROR, never a PASS', () => {
    withScratch((root) => {
      const r = run(root, SCRIPTS.grants, [], { 'PSQL pg_proc': { out: '' } }, DB_ENV);
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('ERROR: the query read no functions at all -- the reading did not run, so it has no verdict');
      expect(r.out).not.toContain('PASS');
    });
  });

  test('could not run — a checkout without the fixture is an ERROR, never a verdict', () => {
    withScratch((root) => {
      const r = run(root, SCRIPTS.grants, [root], grantsAnswer(grantRows()), DB_ENV);
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('/packages/fixtures/function-grants.json -- the reading did not run, so it has no verdict');
    });
  });

  test('could not run — node failing while comparing is an ERROR, never a verdict', () => {
    withScratch((root) => {
      const bin = stubBin(root);
      const realNode = process.execPath;
      writeFileSync(join(bin, 'psql'), readFileSync(join(bin, 'psql'), 'utf8').replace('#!/usr/bin/env node', `#!${realNode}`));
      writeFileSync(join(bin, 'node'), '#!/usr/bin/env bash\nexit 9\n');
      chmodSync(join(bin, 'node'), 0o755);
      writeFileSync(join(root, 'fixtures.json'), JSON.stringify(grantsAnswer(grantRows())));
      writeFileSync(join(root, 'stub.log'), '');
      let out = '';
      let status = 0;
      try {
        out = execFileSync('bash', [SCRIPTS.grants], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, ...DB_ENV, PATH: `${bin}:${process.env['PATH'] ?? ''}`, STUB_LOG: join(root, 'stub.log'), STUB_FIXTURES: join(root, 'fixtures.json'), STUB_COUNTS: join(root, 'counts.json') },
        });
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        status = err.status ?? -1;
        out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
      }
      expect(status, out).toBe(2);
      expect(out).toContain('ERROR: node exited 9 comparing the function grants -- the reading did not run, so it has no verdict');
    });
  });
});

describe('rb_tracked_header — the expected security headers come from the checkout, or there is no verdict', () => {
  test.each([
    ['readback_pages.sh', (): string => SCRIPTS.pages, (): string => SITE, pagesFixtures],
    ['readback_ward_console.sh', (): string => SCRIPTS.ward, (): string => WARD, wardFixtures],
  ] as const)('%s: a checkout with no tracked _headers is an ERROR with exit 2, never a verdict', (_name, script, site, fixtures) => {
    withScratch((root) => {
      const work = repo(root, { headers: false });
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const r = run(root, script(), [site(), work], fixtures(head));
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('ERROR: this checkout holds no tracked _headers file for the app at ');
      expect(r.out).toContain('so the expected content-security-policy cannot be read');
      expect(r.out).not.toContain('PASS:');
    });
  });

  test('a tracked _headers the renderer refuses is an ERROR with exit 2, never a verdict', () => {
    withScratch((root) => {
      const work = repo(root);
      const file = join(work, 'apps', 'ward-console', 'public', '_headers');
      const planted = readFileSync(file, 'utf8').replace('@API_ORIGINS@', '@API_ORIGINS@ @API_ORIGINS@');
      expect(planted, 'the plant did not land: the tracked ward _headers holds no placeholder').not.toBe(readFileSync(file, 'utf8'));
      writeFileSync(file, planted);
      git(work, 'commit', '-q', '-am', 'placeholder twice');
      git(work, 'push', '-q', 'origin', 'main');
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const r = run(root, SCRIPTS.ward, [WARD, work], wardFixtures(head));
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('could not render');
      expect(r.out).toContain('so the expected content-security-policy is unknown -- this read-back has no verdict');
      expect(r.out).not.toContain('PASS:');
    });
  });

  test('the served ward CSP is held to the RENDERED origins: the raw tracked line, placeholder and all, is a FAIL', () => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const raw = /Content-Security-Policy:\s*(.*)/.exec(readFileSync(join(REPO_ROOT, 'apps', 'ward-console', 'public', '_headers'), 'utf8'))?.[1] ?? '';
      expect(raw, 'the tracked line holds no placeholder, so this plant proves nothing').toContain('@API_ORIGINS@');
      const f = wardFixtures(head);
      f[`GET ${WARD}/`] = { status: 200, headers: { 'content-type': 'text/html', ...trackedHeaders('ward-console'), 'content-security-policy': raw }, body: '<!doctype html><script type="module" crossorigin src="/assets/index-B7kFspkD.js"></script>' };
      const r = run(root, SCRIPTS.ward, [WARD, work], f);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain('step 3 content-security-policy');
    });
  });

  test('a tracked _headers that sets no CSP on /* is an ERROR with exit 2', () => {
    withScratch((root) => {
      const work = repo(root);
      writeFileSync(join(work, 'apps', 'public-dashboard', 'public', '_headers'), '/*\n  Referrer-Policy: no-referrer\n');
      git(work, 'commit', '-q', '-am', 'no csp');
      git(work, 'push', '-q', 'origin', 'main');
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const r = run(root, SCRIPTS.pages, [SITE, work], pagesFixtures(head));
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('sets no content-security-policy on /*, so the expected value cannot be read -- this read-back has no verdict');
    });
  });
});

// ---------------------------------------------------------------------------
// scripts/readback_admin.sh -- Access first, then the token half, then the API
// (R-2026-09-24-97 BY-2 a; the PR 3.4b-app C design report, section 6.3).
// ---------------------------------------------------------------------------

const ADMIN_SITE = 'https://a1b2c3d4.openbed-admin.pages.dev';
const ADMIN_HOSTS = ['https://admin.openbed.ng', 'https://openbed-admin.pages.dev', ADMIN_SITE];
const ADMIN_LOCAL = 'http://127.0.0.1:8790';
const ACCESS_LOGIN = { status: 302, headers: { location: 'https://openbed.cloudflareaccess.com/cdn-cgi/access/login/admin.openbed.ng' } };
const ACCESS_ENV = { OPENBED_ACCESS_CLIENT_ID: 'access-id-PLANTED-7f3a.access', OPENBED_ACCESS_CLIENT_SECRET: 'access-secret-PLANTED-9c1e' };
const ADMIN_SHELL = '<!doctype html><script type="module" crossorigin src="/assets/index-Ad3m1nXy.js"></script>';

/** What admin's pages answer: Access without the token, the app with it. */
function adminFixtures(head: string, site = ADMIN_SITE, withAccess = true): Fixtures {
  const f: Fixtures = {};
  if (withAccess) {
    for (const host of ADMIN_HOSTS) {
      f[`GET ${host}/version.json`] = ACCESS_LOGIN;
      f[`GET ${host}/`] = ACCESS_LOGIN;
    }
  }
  const tok = withAccess ? ' access' : '';
  f[`GET ${site}/version.json${tok}`] = { status: 200, body: stampOf(head) };
  f[`GET https://admin.openbed.ng/version.json${tok}`] = { status: 200, body: stampOf(head) };
  // A hosted deploy serves the production rendering; the --local server (no Access) serves build:local's.
  f[`GET ${site}/${tok}`] = { status: 200, headers: { 'content-type': 'text/html', ...trackedHeaders('admin', withAccess ? 'production' : 'local') }, body: ADMIN_SHELL };
  f[`GET ${site}/assets/index-Ad3m1nXy.js${tok}`] = { status: 200, body: `const k="${withAccess ? DEPLOYED_KEY : TRACKED_KEY}";` };
  f[`GET ${API}/auth/v1/settings apikey=${DEPLOYED_KEY}`] = { status: 200, headers: { 'x-openbed-proxy': 'forwarded' }, body: '{"external":{"email":true}}' };
  f[`GET ${API}/auth/v1/settings apikey=${WRONG_KEY}`] = { status: 401, headers: { 'x-openbed-proxy': 'forwarded' }, body: '{"message":"Invalid API key"}' };
  f[`POST ${API}/rest/v1/rpc/operator_register`] = { status: 401, headers: { 'x-openbed-proxy': 'forwarded' }, body: '{"code":"42501"}' };
  return f;
}

describe('readback_admin.sh — Access first, the token from the environment only', () => {
  const runAdmin = (root: string, work: string, f: Fixtures, env: Record<string, string> = ACCESS_ENV, args: string[] = [ADMIN_SITE, work]) =>
    run(root, SCRIPTS.admin, args, f, env);

  test('real read-back is accepted — Access answers every host without the token; with it, the app is this checkout', () => {
    withScratch((root) => {
      const work = repo(root);
      const r = runAdmin(root, work, adminFixtures(git(work, 'rev-parse', 'HEAD').trim()));
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain('PASS: Access answers every host without the token');
      // The FAILING HALF FIRST: every host was probed without the token before any with it.
      const firstToken = r.calls.findIndex((c) => c.endsWith(' access'));
      expect(r.calls.slice(0, firstToken).filter((c) => c.startsWith('GET ') && !c.includes(API))).toHaveLength(6);
      // The token is never printed and never on curl's command line (the stub logs argv-derived keys only).
      expect(r.out).not.toContain(ACCESS_ENV.OPENBED_ACCESS_CLIENT_SECRET);
      expect(r.out).not.toContain(ACCESS_ENV.OPENBED_ACCESS_CLIENT_ID);
      expect(r.calls.join('\n')).not.toContain(ACCESS_ENV.OPENBED_ACCESS_CLIENT_SECRET);
    });
  });

  test('a 403 from Access is accepted as Access answering, the same as its redirect', () => {
    withScratch((root) => {
      const work = repo(root);
      const f = adminFixtures(git(work, 'rev-parse', 'HEAD').trim());
      f[`GET https://openbed-admin.pages.dev/`] = { status: 403, body: 'Forbidden' };
      expect(runAdmin(root, work, f).status).toBe(0);
    });
  });

  test.each([
    ['the pages.dev host serves the stamp WITHOUT the token -- the page is around Access', (f: Fixtures, head: string) => { f['GET https://openbed-admin.pages.dev/version.json'] = { status: 200, body: stampOf(head) }; }, 'step 1 https://openbed-admin.pages.dev/version.json'],
    ['admin.openbed.ng serves the app shell without the token', (f: Fixtures) => { f['GET https://admin.openbed.ng/'] = { status: 200, body: ADMIN_SHELL }; }, 'step 1 https://admin.openbed.ng/'],
    ['a redirect, but not to Access', (f: Fixtures) => { f[`GET ${ADMIN_SITE}/`] = { status: 302, headers: { location: 'https://evil.example/login' } }; }, `step 1 ${ADMIN_SITE}/`],
    ['a stamp naming another commit', (f: Fixtures) => { f[`GET ${ADMIN_SITE}/version.json access`] = { status: 200, body: stampOf('0'.repeat(40)) }; }, 'step 2 commit'],
    ['admin.openbed.ng serving a different deployment', (f: Fixtures) => { f['GET https://admin.openbed.ng/version.json access'] = { status: 200, body: stampOf('1'.repeat(40)) }; }, 'step 2 admin.openbed.ng commit'],
    ['a page CSP that is not the tracked one', (f: Fixtures) => { f[`GET ${ADMIN_SITE}/ access`] = { status: 200, headers: { ...trackedHeaders('admin'), 'content-security-policy': "default-src *" }, body: ADMIN_SHELL }; }, 'step 2 content-security-policy'],
    ['the Worker refusing the operator call (H5 not landed)', (f: Fixtures) => { f[`POST ${API}/rest/v1/rpc/operator_register`] = { status: 404, headers: { 'x-openbed-proxy': 'refused' } }; }, 'step 3 operator call x-openbed-proxy'],
  ] as const)('plant — %s is a STOP', (_name, plant, check) => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const f = adminFixtures(head);
      plant(f, head);
      expectStopAt(runAdmin(root, work, f), check);
    });
  });

  test('a missing token is an ERROR with exit 2, never a PASS -- after the failing half ran', () => {
    withScratch((root) => {
      const work = repo(root);
      const r = runAdmin(root, work, adminFixtures(git(work, 'rev-parse', 'HEAD').trim()), { OPENBED_ACCESS_CLIENT_ID: '', OPENBED_ACCESS_CLIENT_SECRET: '' });
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('OPENBED_ACCESS_CLIENT_ID and OPENBED_ACCESS_CLIENT_SECRET must both be set in the environment -- the token half cannot run, so this read-back has no verdict');
      expect(r.out).not.toContain('PASS:');
      expect(r.calls.some((c) => c.endsWith(' access')), 'a request went out with a token that was not set').toBe(false);
    });
  });

  test('a curl that cannot read headers from a file is an ERROR, and the token is never sent on the command line', () => {
    withScratch((root) => {
      const work = repo(root);
      const r = runAdmin(root, work, adminFixtures(git(work, 'rev-parse', 'HEAD').trim()), { ...ACCESS_ENV, STUB_CURL_VERSION: 'curl 7.54.0 (stub)' });
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('this curl cannot read headers from a file (-H @file needs 7.55 or later), so the token would have to go on the command line -- nothing was sent');
      expect(r.calls.some((c) => c.endsWith(' access'))).toBe(false);
    });
  });

  test('a checkout whose admin wrangler.toml names no project is an ERROR: the hosts to probe are unknown', () => {
    withScratch((root) => {
      const work = repo(root);
      writeFileSync(join(work, 'apps', 'admin', 'wrangler.toml'), 'pages_build_output_dir = "./dist"\n');
      git(work, 'commit', '-q', '-am', 'no name');
      git(work, 'push', '-q', 'origin', 'main');
      const r = runAdmin(root, work, adminFixtures(git(work, 'rev-parse', 'HEAD').trim()));
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('apps/admin/wrangler.toml names no Pages project in this checkout, so the hosts to probe are unknown -- nothing was checked');
      expect(r.calls).toEqual([]);
    });
  });

  describe('--local (BY-2 a): what runs without Access, and what is NOT RUN', () => {
    test('real local read-back is accepted, says what did not run, and calls neither Access nor api.openbed.ng', () => {
      withScratch((root) => {
        const work = repo(root);
        const r = runAdmin(root, work, adminFixtures(git(work, 'rev-parse', 'HEAD').trim(), ADMIN_LOCAL, false), {}, ['--local', ADMIN_LOCAL, work]);
        expect(r.status, r.out).toBe(0);
        expect(r.out).toContain('=== step 1: NOT RUN (local)');
        expect(r.out).toContain('NOT RUN (local): the live and dead key halves');
        expect(r.out).toContain('NOT RUN (local): the Worker probe');
        expect(r.out).toContain('LOCAL RUN: step 1, the token half, both key halves and the Worker probe were NOT RUN. This is not a production verdict');
        expect(r.out).toContain('PASS: LOCAL --');
        expect(r.calls.filter((c) => !c.startsWith(`GET ${ADMIN_LOCAL}`)), 'a local run reached beyond the local server').toEqual([]);
      });
    });

    test('--local on a hosted URL is an ERROR, and nothing is probed', () => {
      withScratch((root) => {
        const work = repo(root);
        const r = runAdmin(root, work, {}, {}, ['--local', ADMIN_SITE, work]);
        expect(r.status, r.out).toBe(2);
        expect(r.out).toContain("--local takes only a local address (http://127.0.0.1:PORT), and '");
        expect(r.calls).toEqual([]);
      });
    });

    test('plant — a local bundle carrying a key that is not the tracked one is a STOP', () => {
      withScratch((root) => {
        const work = repo(root);
        const f = adminFixtures(git(work, 'rev-parse', 'HEAD').trim(), ADMIN_LOCAL, false);
        f[`GET ${ADMIN_LOCAL}/assets/index-Ad3m1nXy.js`] = { status: 200, body: 'const k="sb_publishable_SOME_OTHER_KEY";' };
        expectStopAt(runAdmin(root, work, f, {}, ['--local', ADMIN_LOCAL, work]), "step 3 the bundle's key is the tracked production key");
      });
    });

    test('a local run that cannot read the tracked key is an ERROR, never a verdict', () => {
      withScratch((root) => {
        const work = repo(root);
        writeFileSync(join(work, 'packages', 'origins', 'publishable-keys.json'), 'not json');
        git(work, 'commit', '-q', '-am', 'broken keys');
        git(work, 'push', '-q', 'origin', 'main');
        const r = runAdmin(root, work, adminFixtures(git(work, 'rev-parse', 'HEAD').trim(), ADMIN_LOCAL, false), {}, ['--local', ADMIN_LOCAL, work]);
        expect(r.status, r.out).toBe(2);
        expect(r.out).toContain('could not read packages/origins/publishable-keys.json (node exited');
        expect(r.out).toContain('the key check did not run, so this read-back has no verdict');
      });
    });
  });
});
