import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withScratch, REPO_ROOT } from './_scratch.js';
import { deployableApps } from './_apps.js';
import ORIGINS_JSON from '../../packages/origins/origins.json';
import LIST_JSON from '../../supabase-proxy/allow-list.json';
import { makeHandler, PROXY_HEADER, type AllowList } from '../../supabase-proxy/handler.js';

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
  limits: join(REPO_ROOT, 'scripts', 'readback_worker_limits.sh'),
  publicOutput: join(REPO_ROOT, 'scripts', 'readback_public_output.sh'),
  grants: join(REPO_ROOT, 'scripts', 'readback_function_grants.sh'),
  admin: join(REPO_ROOT, 'scripts', ADMIN_NAME),
};

/** `connects` overrides the stub's `%{num_connects}`: 1 on a call's first URL and 0 after it, as one reused connection reads. */
type Answer = { status: number; headers?: Record<string, string>; body?: string; bodyBase64?: string; connects?: number } | { fail: number } | { out: string };
type Fixtures = Record<string, Answer | Answer[]>;

interface Run {
  status: number;
  out: string;
  calls: string[];
  /** One entry per curl INVOCATION, with the number of URLs it carried (`calls` holds one line per URL). */
  invocations: { urls: number; fmt: string | null }[];
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
  // The tracked robots.txt the dashboard read-back compares both hosts against, byte for
  // byte (R-2026-09-25-119 CU-5 c).
  if (opts.headers !== false) copyFileSync(join(REPO_ROOT, 'apps', 'public-dashboard', 'public', 'robots.txt'), join(work, 'apps', 'public-dashboard', 'public', 'robots.txt'));
  // And the tracked favicon, which both hosts must serve byte for byte (R-2026-09-26-122 CX-3).
  if (opts.headers !== false) copyFileSync(join(REPO_ROOT, 'apps', 'public-dashboard', 'public', 'favicon.ico'), join(work, 'apps', 'public-dashboard', 'public', 'favicon.ico'));
  // The ward console's, since D2 (R-2026-09-26-132 DH-3).
  if (opts.headers !== false) copyFileSync(join(REPO_ROOT, 'apps', 'ward-console', 'public', 'favicon.ico'), join(work, 'apps', 'ward-console', 'public', 'favicon.ico'));
  // And admin's, since D3 (R-2026-09-27-139 DO-4).
  if (opts.headers !== false) copyFileSync(join(REPO_ROOT, 'apps', 'admin', 'public', 'favicon.ico'), join(work, 'apps', 'admin', 'public', 'favicon.ico'));
  // The limits proof reads LIMIT_VERIFY's number from the deploy checkout's wrangler.json, never a literal.
  mkdirSync(join(work, 'supabase-proxy'), { recursive: true });
  copyFileSync(join(REPO_ROOT, 'supabase-proxy', 'wrangler.json'), join(work, 'supabase-proxy', 'wrangler.json'));
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

/**
 * A curl stub that answers from the fixture by "METHOD URL", or "METHOD URL apikey=KEY" first.
 * A request that presents as a BROWSER -- a Mozilla/ User-Agent and an Accept naming
 * text/html -- is logged and keyed with " browser" (before " access"), and a fixture keyed
 * that way answers it in preference to the plain one (R-2026-09-25-119 CU-5). That is how a
 * plant serves one page to a browser and another to a plain client, as Cloudflare's zone
 * settings did: if a read-back stops presenting as a browser, it gets the plain page.
 */
function stubBin(root: string): string {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'curl'),
    `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
if (a[0] === '--version') {
  // STUB_CURL_VERSION_FAIL makes the version call itself fail, as a broken ~/.curlrc or a missing library would (R-2026-09-30-181 FE-4 c).
  if (process.env.STUB_CURL_VERSION_FAIL) { process.stderr.write('curl: (2) planted failure of --version\\n'); process.exit(Number(process.env.STUB_CURL_VERSION_FAIL)); }
  process.stdout.write((process.env.STUB_CURL_VERSION || 'curl 8.7.1 (stub)') + '\\n'); process.exit(0);
}
// EVERY request starts with -q so curl ignores the caller's ~/.curlrc (R-2026-09-30-181 FE-5): a curl that does not is refused here, with
// a status no script reads as an answer, so removing -q from any one site is red.
if (a[0] !== '-q') { process.stderr.write('curl stub: the first argument must be -q, so that ~/.curlrc is not read\\n'); process.exit(98); }
let method = 'GET', head = false, dump = null, fmt = null, http11 = false, getMode = false, failEarly = false;
const urls = [], outs = [], hdrs = [], data = [];
for (let i = 0; i < a.length; i++) {
  const x = a[i];
  if (x === '-X') method = a[++i];
  else if (x === '-I') head = true;
  else if (x === '-o') outs.push(a[++i]);
  else if (x === '-D') dump = a[++i];
  else if (x === '-w') fmt = a[++i];
  else if (x === '-H') hdrs.push(a[++i]);
  else if (x === '-d' || x === '-m') i++;
  else if (x === '--http1.1') http11 = true;
  else if (x === '--fail-early') failEarly = true;
  else if (x === '-G') getMode = true;
  else if (x === '--data-urlencode') data.push(a[++i]);
  else if (/^https?:/.test(x)) urls.push(x);
}
if (head) method = 'HEAD';
const upgrade = hdrs.some((h) => /^Upgrade:\\s*websocket/i.test(h));
// The three headers that make a websocket upgrade one (R-2026-09-30-178 FB-3 l): without Connection and the two Sec-WebSocket
// headers Cloudflare's own edge answers 400 before the Worker runs, so a probe that drops one tests nothing.
const hv = (name) => { const h = hdrs.find((x) => x.toLowerCase().startsWith(name.toLowerCase() + ':')); return h ? h.slice(name.length + 1).trim() : ''; };
const conn = hv('Connection'), wsv = hv('Sec-WebSocket-Version'), wsk = hv('Sec-WebSocket-Key');
// -H @FILE reads headers from a file, one per line (readback_admin.sh's Access token).
// The stub records only WHETHER the token came, never its value.
for (const h of hdrs.filter((x) => x.startsWith('@'))) hdrs.push(...fs.readFileSync(h.slice(1), 'utf8').split('\\n').filter(Boolean));
const access = hdrs.some((h) => /^CF-Access-Client-Id:\\s*\\S/i.test(h)) && hdrs.some((h) => /^CF-Access-Client-Secret:\\s*\\S/i.test(h));
const apikey = (hdrs.map((h) => /^apikey:\\s*(.*)$/i.exec(h)).find(Boolean) || [])[1];
const browser = hdrs.some((h) => /^User-Agent:.*Mozilla\\//i.test(h)) && hdrs.some((h) => /^Accept:.*text\\/html/i.test(h));
// One entry per curl INVOCATION, apart from STUB_LOG's one line per URL: the limits proof must be ONE call with 3L URLs
// (R-2026-09-30-180 FD-1 e). The ward tests build their own env and set no invocation log.
if (process.env.STUB_INVOKE_LOG) fs.appendFileSync(process.env.STUB_INVOKE_LOG, JSON.stringify({ urls: urls.length, fmt }) + '\\n');
const fx = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURES, 'utf8'));
// -w, as real curl prints it after EACH transfer: %{http_code}, %header{name}, %{num_connects} (1 on the first URL of a
// call, 0 on the reused connection after it, unless the answer says otherwise) and %{time_total}; a literal backslash-n
// in the format becomes a newline.
const wline = (status, headers, connects) => fmt
  .replace(/%\\{http_code\\}/g, String(status))
  .replace(/%header\\{([^}]*)\\}/g, (_, name) => { const e = Object.entries(headers || {}).find(([h]) => h.toLowerCase() === name.toLowerCase()); return e ? String(e[1]) : ''; })
  .replace(/%\\{num_connects\\}/g, String(connects))
  .replace(/%\\{time_total\\}/g, '0.001')
  .replace(/\\\\n/g, '\\n');
// STUB_CURL_DROP_W=N withholds the last N -w lines: the short output a curl that lost a transfer would print.
const dropW = Number(process.env.STUB_CURL_DROP_W || 0);
// STUB_CURL_EXTRA_W=1 prints ONE MORE -w line than there are URLs: the other way a count can be wrong (R-2026-09-30-181 FE-3).
const extraW = Number(process.env.STUB_CURL_EXTRA_W || 0);
let lastW = '';
let rc = 0;
for (let n = 0; n < urls.length; n++) {
  let url = urls[n];
  // -G with --data-urlencode puts each NAME=CONTENT in the query of EVERY url, the content percent-encoded as curl does
  // (R-2026-09-30-177 FA-1 d): a fixture is keyed on the whole URL, so a probe that drops a parameter has no answer.
  if (getMode && data.length) url += (url.includes('?') ? '&' : '?') + data.map((d) => { const j = d.indexOf('='); return d.slice(0, j) + '=' + encodeURIComponent(d.slice(j + 1)); }).join('&');
  fs.appendFileSync(process.env.STUB_LOG, method + ' ' + url + (apikey ? ' apikey=' + apikey : '') + (browser ? ' browser' : '') + (access ? ' access' : '') + (http11 ? ' http1.1' : '') + (upgrade ? ' upgrade' : '') + (conn ? ' connection=' + conn : '') + (wsv ? ' ws-version=' + wsv : '') + (wsk ? ' ws-key=' + wsk : '') + '\\n');
  const base = method + ' ' + url;
  const cands = (apikey ? [base + ' apikey=' + apikey] : [])
    .concat(browser && access ? [base + ' browser access'] : [], browser ? [base + ' browser'] : [], access ? [base + ' access'] : [], [base]);
  const k = cands.find((c) => c in fx) || base;
  let ans = fx[k];
  if (ans === undefined) { process.stderr.write('curl: (6) Could not resolve host (no fixture for ' + k + ')\\n'); process.exit(6); }
  if (Array.isArray(ans)) {
    const counts = fs.existsSync(process.env.STUB_COUNTS) ? JSON.parse(fs.readFileSync(process.env.STUB_COUNTS, 'utf8')) : {};
    const c = counts[k] || 0;
    counts[k] = c + 1;
    fs.writeFileSync(process.env.STUB_COUNTS, JSON.stringify(counts));
    ans = ans[Math.min(c, ans.length - 1)];
  }
  if (ans.fail) {
    process.stderr.write('curl: (' + ans.fail + ') planted failure\\n');
    // Real curl: with --fail-early, or with one URL, a failed transfer ends the run with its code. Without it the run goes
    // on, the failed URL prints 000, and the LAST transfer decides the exit code, so a mid-run failure exits 0.
    if (failEarly || urls.length === 1) process.exit(ans.fail);
    if (fmt && n < urls.length - dropW) process.stdout.write(wline('000', {}, 0));
    rc = ans.fail;
    continue;
  }
  rc = 0;
  const text = 'HTTP/2 ' + ans.status + '\\r\\n' + Object.entries(ans.headers || {}).map(([h, v]) => h + ': ' + v + '\\r\\n').join('') + '\\r\\n';
  if (dump) fs.writeFileSync(dump, text);
  const body = head ? text : (ans.bodyBase64 ? Buffer.from(ans.bodyBase64, 'base64') : (ans.body || ''));
  if (outs[n]) fs.writeFileSync(outs[n], body); else process.stdout.write(body);
  lastW = wline(ans.status, ans.headers, ans.connects !== undefined ? ans.connects : (n === 0 ? 1 : 0));
  if (fmt && n < urls.length - dropW) process.stdout.write(lastW);
}
if (fmt && extraW > 0 && lastW !== '') for (let e = 0; e < extraW; e++) process.stdout.write(lastW);
process.exit(rc);
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
  const invokeLog = join(root, 'invocations.log');
  writeFileSync(log, '');
  writeFileSync(invokeLog, '');
  writeFileSync(join(root, 'fixtures.json'), JSON.stringify(fixtures));
  const fullEnv = {
    ...process.env,
    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
    STUB_LOG: log,
    STUB_INVOKE_LOG: invokeLog,
    STUB_FIXTURES: join(root, 'fixtures.json'),
    STUB_COUNTS: join(root, 'counts.json'),
    READBACK_SERVED_AT_SLEEP: '0',
    READBACK_LIMITS_SLEEP: '0',
    ...env,
  };
  const calls = (): string[] => readFileSync(log, 'utf8').split('\n').filter((l) => l !== '');
  const invocations = (): { urls: number; fmt: string | null }[] => readFileSync(invokeLog, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as { urls: number; fmt: string | null });
  try {
    const out = execFileSync('bash', [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: fullEnv });
    return { status: 0, out, calls: calls(), invocations: invocations() };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}`, calls: calls(), invocations: invocations() };
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
    ['readback_worker_limits.sh', SCRIPTS.limits],
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
    ['readback_worker_limits.sh', 'http://api.openbed.ng', "STOP: 'http://api.openbed.ng' is not an https:// URL, so nothing was probed."],
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
const DASH_DOMAIN = 'https://openbed.ng';
const DASH_PAGE = '<!doctype html><script type="module" crossorigin src="/assets/index-iIcFdl6r.js"></script><link rel="stylesheet" crossorigin href="/assets/index-DTILzLDb.css">';
/** The tracked favicon, read, never retyped: what both hosts must serve byte for byte (R-2026-09-26-122 CX-3). */
const FAVICON = readFileSync(join(REPO_ROOT, 'apps', 'public-dashboard', 'public', 'favicon.ico'));
const FAVICON_ANSWER: Answer = { status: 200, headers: { 'content-type': 'image/x-icon' }, bodyBase64: FAVICON.toString('base64') };
const DASH_CSS = "@font-face{font-family:'Public Sans';src:url('/assets/public-sans-latin-400-normal-8Rpg0ruU.woff2') format('woff2')}";
const FONT_PATH = '/assets/public-sans-latin-400-normal-8Rpg0ruU.woff2';
/** The tracked robots.txt, read, never retyped: what both hosts must serve byte for byte. */
const ROBOTS_TXT = readFileSync(join(REPO_ROOT, 'apps', 'public-dashboard', 'public', 'robots.txt'), 'utf8');
/**
 * /privacy as Pages serves it (R-2026-09-26-136 DL-1 e): a page with no script and no
 * #app root, carrying the notice's own words, read from the tracked source, never retyped.
 */
const noticePage = (file: string): string => `<!doctype html><html><body><main id="notice">${readFileSync(join(REPO_ROOT, 'docs', 'legal', file), 'utf8')}</main></body></html>`;
/** Version 1.1, what a deploy from this checkout serves (R-2026-09-28-155 EE-3). */
const PRIVACY_PAGE = noticePage('privacy-notice-v1.1.md');
/** Version 1.0, what 2633ccc0 serves today: the prior version, which this read-back must now refuse. */
const PRIOR_PRIVACY_PAGE = noticePage('privacy-notice-v1.0.md');
/**
 * /api/health as the deployed Function answers it (R-2026-09-29-173 EW-2 h): a 200 whose
 * marker header the SPA fallback can never carry. HEAD carries the same headers and no body.
 */
const HEALTH_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-openbed-health': 'ok',
  'x-openbed-edge-cache': 'miss',
  'x-robots-tag': 'noindex, nofollow',
  'x-content-type-options': 'nosniff',
};
const HEALTH_BODY = '{"ok":true,"health":"openbed-ok","reasons":[],"snapshot_age_s":31,"checked_at":"2026-09-30T04:00:00.000+00:00","job":null}';
const HEALTH_FAIL_ANSWER: Answer = {
  status: 503,
  headers: { ...HEALTH_HEADERS, 'x-openbed-health': 'fail' },
  body: '{"ok":false,"health":"openbed-fail","reasons":["snapshot_stale"],"snapshot_age_s":400,"checked_at":"2026-09-30T04:00:00.000+00:00","job":null}',
};
const PRIVACY_ANSWER: Answer = { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: PRIVACY_PAGE };
/** The dashboard's index as the SPA fallback serves it for a missing page: its bundle, and the #app root it fills. */
const SPA_INDEX = `${DASH_PAGE}<main id="app"></main>`;

function pagesFixtures(head: string): Fixtures {
  const beds = (servedAt: string): Answer => ({ status: 200, headers: { ...BEDS_HEADERS, 'x-openbed-served-at': servedAt }, body: BEDS_BODY });
  return {
    [`GET ${SITE}/version.json`]: { status: 200, headers: { 'content-type': 'application/json' }, body: stampOf(head) },
    // read-back 6, read-back 8's GET, then the two serve-time reads.
    [`GET ${SITE}/beds.json`]: [beds('2026-09-23T18:48:44.001Z'), beds('2026-09-23T18:48:47.300Z'), beds('2026-09-23T18:48:50.582Z'), beds('2026-09-23T18:48:56.068Z')],
    [`HEAD ${SITE}/beds.json`]: { status: 200, headers: { ...BEDS_HEADERS, 'x-openbed-served-at': '2026-09-23T18:48:48.000Z' } },
    [`GET ${SITE}/`]: { status: 200, headers: { 'content-type': 'text/html', ...trackedHeaders('public-dashboard') }, body: DASH_PAGE },
    // The custom domain, where zone settings apply, and robots.txt on both hosts (CU-5 b, c).
    [`GET ${DASH_DOMAIN}/`]: { status: 200, headers: { 'content-type': 'text/html', ...trackedHeaders('public-dashboard') }, body: DASH_PAGE },
    [`GET ${SITE}/robots.txt`]: { status: 200, headers: { 'content-type': 'text/plain' }, body: ROBOTS_TXT },
    [`GET ${DASH_DOMAIN}/robots.txt`]: { status: 200, headers: { 'content-type': 'text/plain' }, body: ROBOTS_TXT },
    // The favicon on both hosts, and one self-hosted font through the page's stylesheet (D1).
    [`GET ${SITE}/favicon.ico`]: FAVICON_ANSWER,
    [`GET ${DASH_DOMAIN}/favicon.ico`]: FAVICON_ANSWER,
    [`GET ${SITE}/assets/index-DTILzLDb.css`]: { status: 200, headers: { 'content-type': 'text/css; charset=utf-8' }, body: DASH_CSS },
    [`GET ${SITE}${FONT_PATH}`]: { status: 200, headers: { 'content-type': 'font/woff2' }, body: 'wOF2' },
    // The health endpoint, GET and HEAD, on both hosts (R-2026-09-29-173 EW-2 h).
    [`GET ${SITE}/api/health`]: { status: 200, headers: HEALTH_HEADERS, body: HEALTH_BODY },
    [`HEAD ${SITE}/api/health`]: { status: 200, headers: HEALTH_HEADERS },
    [`GET ${DASH_DOMAIN}/api/health`]: { status: 200, headers: HEALTH_HEADERS, body: HEALTH_BODY },
    [`HEAD ${DASH_DOMAIN}/api/health`]: { status: 200, headers: HEALTH_HEADERS },
    // The privacy notice on both hosts (DL-1 e).
    [`GET ${SITE}/privacy`]: PRIVACY_ANSWER,
    [`GET ${DASH_DOMAIN}/privacy`]: PRIVACY_ANSWER,
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
      expect(r.out).toContain("PASS: read-backs 4, 6, 7 and 8, the page's security headers and scripts on both hosts, the favicon on both hosts, the health endpoint on both hosts, the privacy notice on both hosts, a self-hosted font, and the serve-time stamp read as they must.");
      for (const check of [
        'page scripts', 'openbed.ng content-security-policy', 'openbed.ng scripts', 'read-back 7 robots.txt', 'read-back 7 openbed.ng robots.txt',
        'favicon.ico status', 'favicon.ico', 'favicon.ico content-type', 'openbed.ng favicon.ico status', 'openbed.ng favicon.ico', 'openbed.ng favicon.ico content-type',
        'page stylesheet', 'stylesheet fonts', 'font status', 'font content-type',
        'privacy status', 'privacy content-type', 'privacy controller', 'privacy version', 'privacy is not the SPA index', 'privacy scripts',
        'openbed.ng privacy status', 'openbed.ng privacy content-type', 'openbed.ng privacy controller', 'openbed.ng privacy version',
        'openbed.ng privacy is not the SPA index', 'openbed.ng privacy scripts',
        'health GET status', 'health GET x-openbed-health', 'health GET x-robots-tag',
        'health HEAD status', 'health HEAD x-openbed-health', 'health HEAD x-robots-tag',
        'openbed.ng health GET status', 'openbed.ng health GET x-openbed-health', 'openbed.ng health GET x-robots-tag',
        'openbed.ng health HEAD status', 'openbed.ng health HEAD x-openbed-health', 'openbed.ng health HEAD x-robots-tag',
        // R-2026-09-30-174 EX-2 c: the keyword the monitor keys on, and nosniff on both methods.
        'health GET body', 'health GET x-content-type-options', 'health HEAD x-content-type-options',
        'openbed.ng health GET body', 'openbed.ng health GET x-content-type-options', 'openbed.ng health HEAD x-content-type-options',
      ]) {
        expect(r.out, `the check "${check}" never ran`).toContain(`  ok     ${check}: `);
      }
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
    // The health endpoint (R-2026-09-29-173 EW-2 h): the marker, not the status, is the signal.
    ['a 503 fail from /api/health', (f) => { f[`GET ${SITE}/api/health`] = HEALTH_FAIL_ANSWER; }, 'health GET status'],
    ['a 503 fail from /api/health, and its marker', (f) => { f[`GET ${SITE}/api/health`] = HEALTH_FAIL_ANSWER; }, 'health GET x-openbed-health'],
    ['the SPA fallback answering HEAD /api/health: a 200 text/html with no marker', (f) => { f[`HEAD ${SITE}/api/health`] = { status: 200, headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' } }; }, 'health HEAD x-openbed-health'],
    ['the SPA fallback answering GET /api/health: a 200 text/html with no marker', (f) => { f[`GET ${SITE}/api/health`] = { status: 200, headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' }, body: '<!doctype html><html></html>' }; }, 'health GET x-openbed-health'],
    ['/api/health with the wrong robots tag', (f) => { f[`HEAD ${SITE}/api/health`] = { status: 200, headers: { ...HEALTH_HEADERS, 'x-robots-tag': 'noindex' } }; }, 'health HEAD x-robots-tag'],
    ['openbed.ng alone failing /api/health', (f) => { f[`GET ${DASH_DOMAIN}/api/health`] = HEALTH_FAIL_ANSWER; }, 'openbed.ng health GET status'],
    // R-2026-09-30-174 EX-2 c: the monitor keys on the KEYWORD in the GET body, which a header cannot stand in for.
    ['a 200 from /api/health carrying the marker header but no openbed-ok in the GET body', (f) => { f[`GET ${SITE}/api/health`] = { status: 200, headers: HEALTH_HEADERS, body: '{"ok":true,"health":"fine"}' }; }, 'health GET body'],
    ['openbed.ng alone: a 200 from /api/health carrying the marker header but no openbed-ok in the GET body', (f) => { f[`GET ${DASH_DOMAIN}/api/health`] = { status: 200, headers: HEALTH_HEADERS, body: '{"ok":true,"health":"fine"}' }; }, 'openbed.ng health GET body'],
    ['/api/health GET without nosniff', (f) => { f[`GET ${SITE}/api/health`] = { status: 200, headers: without(HEALTH_HEADERS, 'x-content-type-options'), body: HEALTH_BODY }; }, 'health GET x-content-type-options'],
    ['/api/health HEAD without nosniff', (f) => { f[`HEAD ${SITE}/api/health`] = { status: 200, headers: without(HEALTH_HEADERS, 'x-content-type-options') }; }, 'health HEAD x-content-type-options'],
    ['openbed.ng alone: /api/health GET without nosniff', (f) => { f[`GET ${DASH_DOMAIN}/api/health`] = { status: 200, headers: without(HEALTH_HEADERS, 'x-content-type-options'), body: HEALTH_BODY }; }, 'openbed.ng health GET x-content-type-options'],
    ['openbed.ng alone: /api/health HEAD without nosniff', (f) => { f[`HEAD ${DASH_DOMAIN}/api/health`] = { status: 200, headers: without(HEALTH_HEADERS, 'x-content-type-options') }; }, 'openbed.ng health HEAD x-content-type-options'],
    ['openbed.ng alone answering HEAD /api/health from the SPA', (f) => { f[`HEAD ${DASH_DOMAIN}/api/health`] = { status: 200, headers: { 'content-type': 'text/html' } }; }, 'openbed.ng health HEAD x-openbed-health'],
    ['a page with no Referrer-Policy', (f) => { f[`GET ${SITE}/`] = { status: 200, headers: without(trackedHeaders('public-dashboard'), 'referrer-policy') }; }, 'page referrer-policy'],
    // The design pass (D1; R-2026-09-26-122 CX-3): the favicon is never the SPA's HTML, on either host.
    ['/favicon.ico answered by the SPA fallback', (f) => { f[`GET ${SITE}/favicon.ico`] = { status: 200, headers: { 'content-type': 'text/html' }, body: DASH_PAGE }; }, 'favicon.ico content-type'],
    ['/favicon.ico answered by the SPA fallback on openbed.ng only', (f) => { f[`GET ${DASH_DOMAIN}/favicon.ico`] = { status: 200, headers: { 'content-type': 'text/html' }, body: DASH_PAGE }; }, 'openbed.ng favicon.ico content-type'],
    // The privacy notice (R-2026-09-26-136 DL-1 e): today's deployment answers /privacy with
    // the SPA index, 200 text/html, so the status and type alone would PASS it.
    ['/privacy answered by the SPA fallback', (f) => { f[`GET ${SITE}/privacy`] = { status: 200, headers: { 'content-type': 'text/html' }, body: SPA_INDEX }; }, 'privacy is not the SPA index'],
    ['/privacy answered by the SPA fallback on openbed.ng only', (f) => { f[`GET ${DASH_DOMAIN}/privacy`] = { status: 200, headers: { 'content-type': 'text/html' }, body: SPA_INDEX }; }, 'openbed.ng privacy is not the SPA index'],
    ['/privacy not found', (f) => { f[`GET ${SITE}/privacy`] = { status: 404, headers: { 'content-type': 'text/html' }, body: 'Not found' }; }, 'privacy status'],
    ['/privacy without the controller', (f) => { f[`GET ${SITE}/privacy`] = { ...PRIVACY_ANSWER, body: PRIVACY_PAGE.split('Paddie Health Ltd').join('The operator') }; }, 'privacy controller'],
    ['/privacy of another version', (f) => { f[`GET ${DASH_DOMAIN}/privacy`] = { ...PRIVACY_ANSWER, body: PRIVACY_PAGE.split('Version 1.1').join('Version 2.0') }; }, 'openbed.ng privacy version'],
    ['/privacy carrying a script', (f) => { f[`GET ${SITE}/privacy`] = { ...PRIVACY_ANSWER, body: PRIVACY_PAGE.replace('</body>', '<script src="/x.js"></script></body>') }; }, 'privacy scripts'],
    ['/privacy served as plain text', (f) => { f[`GET ${SITE}/privacy`] = { ...PRIVACY_ANSWER, headers: { 'content-type': 'text/plain' } }; }, 'privacy content-type'],
    ['a favicon that is not the tracked icon', (f) => { f[`GET ${SITE}/favicon.ico`] = { status: 200, headers: { 'content-type': 'image/x-icon' }, bodyBase64: Buffer.from('not the icon').toString('base64') }; }, 'favicon.ico'],
    ['a font served as application/octet-stream', (f) => { f[`GET ${SITE}${FONT_PATH}`] = { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: 'wOF2' }; }, 'font content-type'],
    ['a stylesheet that names no woff2', (f) => { f[`GET ${SITE}/assets/index-DTILzLDb.css`] = { status: 200, headers: { 'content-type': 'text/css' }, body: 'body{margin:0}' }; }, 'stylesheet fonts'],
    ['a page that links no stylesheet', (f) => { const page = { status: 200, headers: { 'content-type': 'text/html', ...trackedHeaders('public-dashboard') }, body: '<!doctype html><script type="module" crossorigin src="/assets/index-iIcFdl6r.js"></script>' }; f[`GET ${SITE}/`] = page; }, 'page stylesheet'],
  ])('plant — %s is a STOP', (_label, plant, check) => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const f = pagesFixtures(head);
      plant(f, head);
      expectStopAt(run(root, SCRIPTS.pages, [SITE, work], f), check);
    });
  });

  test('a deployment still serving privacy notice 1.0 (as 2633ccc0 does) reads WRONG on the version on both hosts, and STOPs (R-2026-09-28-155 EE-3)', () => {
    withScratch((root) => {
      const work = repo(root);
      const f = pagesFixtures(git(work, 'rev-parse', 'HEAD').trim());
      f[`GET ${SITE}/privacy`] = { ...PRIVACY_ANSWER, body: PRIOR_PRIVACY_PAGE };
      f[`GET ${DASH_DOMAIN}/privacy`] = { ...PRIVACY_ANSWER, body: PRIOR_PRIVACY_PAGE };
      const r = run(root, SCRIPTS.pages, [SITE, work], f);
      expectStopAt(r, 'privacy version');
      expect(r.out).toContain('  WRONG  openbed.ng privacy version: ');
      expect(r.out, 'the 1.0 page failed on something other than its version').toContain('  ok     privacy controller: ');
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
const WARD_DOMAIN = 'https://app.openbed.ng';
const API = 'https://api.openbed.ng';
const DEPLOYED_KEY = 'sb_publishable_DEPLOYED_KEY_IN_THE_BUNDLE';
const WRONG_KEY = 'sb_publishable_DELIBERATELY_WRONG_FOR_THE_FAILING_HALF';

/** The ward console's page since D2: its one module script and its built stylesheet. */
const WARD_PAGE = '<!doctype html><script type="module" crossorigin src="/assets/index-B7kFspkD.js"></script><link rel="stylesheet" crossorigin href="/assets/index-Dzzg2EAS.css">';
/** The ward console's tracked favicon, read, never retyped (D2; R-2026-09-26-122 CX-3). */
const WARD_FAVICON: Answer = { status: 200, headers: { 'content-type': 'image/x-icon' }, bodyBase64: readFileSync(join(REPO_ROOT, 'apps', 'ward-console', 'public', 'favicon.ico')).toString('base64') };

function wardFixtures(head: string): Fixtures {
  return {
    [`GET ${WARD}/version.json`]: { status: 200, body: stampOf(head) },
    [`GET ${WARD}/`]: { status: 200, headers: { 'content-type': 'text/html', ...trackedHeaders('ward-console') }, body: WARD_PAGE },
    // The custom domain serves the same deployment (R-2026-09-25-119 CU-5 b).
    [`GET ${WARD_DOMAIN}/`]: { status: 200, headers: { 'content-type': 'text/html', ...trackedHeaders('ward-console') }, body: WARD_PAGE },
    // The favicon on both hosts, and one self-hosted font through the page's stylesheet (D2).
    [`GET ${WARD}/favicon.ico`]: WARD_FAVICON,
    [`GET ${WARD_DOMAIN}/favicon.ico`]: WARD_FAVICON,
    [`GET ${WARD}/assets/index-Dzzg2EAS.css`]: { status: 200, headers: { 'content-type': 'text/css; charset=utf-8' }, body: DASH_CSS },
    [`GET ${WARD}${FONT_PATH}`]: { status: 200, headers: { 'content-type': 'font/woff2' }, body: 'wOF2' },
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
        // D2 (R-2026-09-26-132 DH-3): the favicon on both hosts, and a self-hosted font.
        'favicon.ico status', 'favicon.ico', 'favicon.ico content-type',
        'app.openbed.ng favicon.ico status', 'app.openbed.ng favicon.ico', 'app.openbed.ng favicon.ico content-type',
        'page stylesheet', 'stylesheet fonts', 'font status', 'font content-type',
      ]) {
        expect(r.out, `the check "${check}" never ran`).toContain(`  ok     ${check}: `);
      }
      expect(r.out).toContain('PASS: the stamp names this checkout, the favicon on both hosts and a self-hosted font are served as they must be, the deployed key is accepted at the edge, and a wrong key is refused.');
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
    // The design pass (D2; R-2026-09-26-122 CX-3): the favicon is never the SPA's HTML, on either host, and the fonts are self-hosted woff2.
    ['/favicon.ico answered by the SPA fallback', (f) => { f[`GET ${WARD}/favicon.ico`] = { status: 200, headers: { 'content-type': 'text/html' }, body: WARD_PAGE }; }, 'favicon.ico content-type'],
    ['/favicon.ico answered by the SPA fallback on app.openbed.ng only', (f) => { f[`GET ${WARD_DOMAIN}/favicon.ico`] = { status: 200, headers: { 'content-type': 'text/html' }, body: WARD_PAGE }; }, 'app.openbed.ng favicon.ico content-type'],
    ['a favicon that is not the tracked icon', (f) => { f[`GET ${WARD}/favicon.ico`] = { status: 200, headers: { 'content-type': 'image/x-icon' }, bodyBase64: Buffer.from('not the icon').toString('base64') }; }, 'favicon.ico'],
    ['a font served as application/octet-stream', (f) => { f[`GET ${WARD}${FONT_PATH}`] = { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: 'wOF2' }; }, 'font content-type'],
    ['a stylesheet that names no woff2', (f) => { f[`GET ${WARD}/assets/index-Dzzg2EAS.css`] = { status: 200, headers: { 'content-type': 'text/css' }, body: 'body{margin:0}' }; }, 'stylesheet fonts'],
    ['a page that links no stylesheet', (f) => { const page = { status: 200, headers: { 'content-type': 'text/html', ...trackedHeaders('ward-console') }, body: '<!doctype html><script type="module" crossorigin src="/assets/index-B7kFspkD.js"></script>' }; f[`GET ${WARD}/`] = page; f[`GET ${WARD_DOMAIN}/`] = page; }, 'page stylesheet'],
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
// scripts/readback_worker.sh -- probes 1 to 3, 5, 5b, 6, 7 and the stamp.
// ---------------------------------------------------------------------------

/** The Worker's stamp since W3: the deploy stamp plus which rate-limit bindings it holds. */
const workerStampOf = (commit: string, bound: { otp?: boolean; verify?: boolean; refresh?: boolean } = {}): string =>
  JSON.stringify({ commit, dirty: false, built_at: '2026-09-23T18:46:32.411Z', limits_bound: { otp: true, verify: true, refresh: true, ...bound } });

const REFUSED_BODY = '{"message":"not forwarded by the OpenBed proxy"}';
/** What the stub logs for a request sent as probes 5 and 5b send it: HTTP/1.1, an upgrade, and all three companion headers. */
const WS_TAIL = ' http1.1 upgrade connection=Upgrade ws-version=13 ws-key=dGhlIHNhbXBsZSBub25jZQ==';
const ADMIN = 'https://admin.openbed.ng';
/** Probe 7's request as curl builds it from -G and --data-urlencode: three parameters, the redirect percent-encoded. */
const VERIFY_PROBE_URL = `${API}/auth/v1/verify?token=probe&type=magiclink&redirect_to=https%3A%2F%2Fadmin.openbed.ng%2F`;
/** The fixture key for it. */
const VERIFY_GET = `GET ${VERIFY_PROBE_URL}`;

function workerFixtures(head: string): Fixtures {
  const fwd = { 'x-openbed-proxy': 'forwarded' };
  const refused = { status: 404, headers: { 'x-openbed-proxy': 'refused' }, body: REFUSED_BODY };
  return {
    [`POST ${API}/rest/v1/rpc/my_reporting_wards`]: { status: 401, headers: { 'sb-project-ref': 'klrlpxysjsjpdkeqdhvl', ...fwd }, body: '{"message":"No API key found in request"}' },
    // Probe 1b (R-2026-09-27-144 DT k): the HEFAMAA write's path, the same no-key answer.
    [`POST ${API}/rest/v1/rpc/operator_record_registration`]: { status: 401, headers: { 'sb-project-ref': 'klrlpxysjsjpdkeqdhvl', ...fwd }, body: '{"message":"No API key found in request"}' },
    // Probe 2's GET, then probe 5b's: the SAME request line with the tracked key, answered in call order.
    [`GET ${API}/auth/v1/settings apikey=${TRACKED_KEY}`]: [{ status: 200, headers: fwd, body: '{"external":{"email":true}}' }, refused],
    [`HEAD ${API}/auth/v1/settings apikey=${TRACKED_KEY}`]: { status: 405, headers: fwd },
    [`GET ${API}/rest/v1/`]: refused,
    // Probes 5 and 6: services the Worker never reaches.
    [`GET ${API}/realtime/v1/websocket`]: refused,
    [`GET ${API}/storage/v1/object/public/probe`]: refused,
    // Probe 7. A STUB value, not an observation: the status and the Location's fragment are what
    // GoTrue is expected to answer a junk token with; the first hosted read records the real status
    // (R-2026-09-30-177 FA-1 d). What the script holds is only 3xx, forwarded, and the Location's ORIGIN.
    [VERIFY_GET]: { status: 303, headers: { ...fwd, location: `${ADMIN}/#error=access_denied&error_code=otp_expired` } },
    [`GET ${API}/__openbed/version`]: { status: 200, headers: { 'x-openbed-proxy': 'stamp' }, body: workerStampOf(head) },
    [`HEAD ${API}/__openbed/version`]: { status: 200, headers: { 'x-openbed-proxy': 'stamp' } },
  };
}

/** probe 7 and the limits proof must name the same admin origin as the sign-in link read-back does. */
export function adminOriginDrift(script: string, linkReadback: string): string[] {
  const here = /^ADMIN_ORIGIN='([^']+)'$/m.exec(script)?.[1];
  const there = /admin:\s*'([^']+)'/.exec(linkReadback)?.[1];
  if (here === undefined || there === undefined) return ['ADMIN ORIGIN UNREADABLE: one of the two files names no admin origin, so nothing was compared'];
  return `${here}/` === there ? [] : [`ADMIN ORIGIN DRIFT: the script probes ${here}/ and scripts/readback_signin_link.mjs expects ${there}`];
}

describe('scripts/readback_worker.sh', () => {
  test('real read-back is accepted — the answers observed on 2026-09-23, plus probes 5, 5b, 6 and 7, give PASS, with every check ok', () => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const r = run(root, SCRIPTS.worker, [API, work], workerFixtures(head));
      expect(r.status, r.out).toBe(0);
      for (const check of [
        'probe 1 status',
        'probe 1 sb-project-ref',
        'probe 1 x-openbed-proxy',
        'probe 1b status',
        'probe 1b sb-project-ref',
        'probe 1b x-openbed-proxy',
        'probe 2 GET status',
        'probe 2 GET x-openbed-proxy',
        'probe 2 HEAD status',
        'probe 2 HEAD x-openbed-proxy',
        'probe 3 status',
        'probe 3 x-openbed-proxy',
        'probe 3 body',
        'probe 5 status',
        'probe 5 x-openbed-proxy',
        'probe 5 body',
        'probe 5b status',
        'probe 5b x-openbed-proxy',
        'probe 5b body',
        'probe 6 status',
        'probe 6 x-openbed-proxy',
        'probe 6 body',
        'probe 7 status',
        'probe 7 x-openbed-proxy',
        'probe 7 Location origin',
        'stamp commit',
        'stamp dirty',
        'stamp limits_bound otp',
        'stamp limits_bound verify',
        'stamp limits_bound refresh',
        'stamp HEAD status',
        'stamp HEAD x-openbed-proxy',
      ]) {
        expect(r.out, `the check "${check}" never ran`).toContain(`  ok     ${check}: `);
      }
      expect(r.out).toContain('PASS: probes 1 to 3, 5, 5b, 6 and 7 and the stamp read as they must. Probe 4, the deployed source, is Cowork');
      expect(r.calls, 'probe 2 did not send the tracked key').toContain(`GET ${API}/auth/v1/settings apikey=${TRACKED_KEY}`);
      // Probe 5 and 5b must reach the stub as HTTP/1.1 upgrades: over HTTP/2 curl drops the header and the probe tests nothing.
      expect(r.calls, 'probe 5 was not sent as an HTTP/1.1 websocket upgrade with Connection and both Sec-WebSocket headers').toContain(`GET ${API}/realtime/v1/websocket${WS_TAIL}`);
      expect(r.calls, 'probe 5b was not sent as an HTTP/1.1 upgrade WITH the tracked key and the same headers').toContain(`GET ${API}/auth/v1/settings apikey=${TRACKED_KEY}${WS_TAIL}`);
      expect(r.calls, 'probe 6 was not sent').toContain(`GET ${API}/storage/v1/object/public/probe`);
      // Probe 7 carries all three parameters, the redirect percent-encoded, and the verify path has no other form.
      const seven = r.calls.filter((c) => c.startsWith(`GET ${API}/auth/v1/verify`));
      expect(seven).toEqual([`GET ${VERIFY_PROBE_URL}`]);
    });
  });

  test.each<[string, (f: Fixtures) => void, string]>([
    ['a 401 that did not come through the Worker', (f) => { f[`POST ${API}/rest/v1/rpc/my_reporting_wards`] = { status: 401, headers: { 'sb-project-ref': 'klrlpxysjsjpdkeqdhvl' } }; }, 'probe 1 x-openbed-proxy'],
    ['another project answering', (f) => { f[`POST ${API}/rest/v1/rpc/my_reporting_wards`] = { status: 401, headers: { 'sb-project-ref': 'someotherproject', 'x-openbed-proxy': 'forwarded' } }; }, 'probe 1 sb-project-ref'],
    ["the HEFAMAA write's path dropped from the list", (f) => { f[`POST ${API}/rest/v1/rpc/operator_record_registration`] = { status: 404, headers: { 'x-openbed-proxy': 'refused' }, body: REFUSED_BODY }; }, 'probe 1b status'],
    ['the settings path refused by the list', (f) => { f[`GET ${API}/auth/v1/settings apikey=${TRACKED_KEY}`] = { status: 404, headers: { 'x-openbed-proxy': 'refused' } }; }, 'probe 2 GET status'],
    ['HEAD answering 200, the value the runbook stated before it was observed', (f) => { f[`HEAD ${API}/auth/v1/settings apikey=${TRACKED_KEY}`] = { status: 200, headers: { 'x-openbed-proxy': 'forwarded' } }; }, 'probe 2 HEAD status'],
    ["Supabase's own 404 at the off-list path, as a Worker that forwards everything would give", (f) => { f[`GET ${API}/rest/v1/`] = { status: 404, body: '{"error":"requested path is invalid"}' }; }, 'probe 3 x-openbed-proxy'],
    // Probe 5 and 6: a Worker that forwards the service reads WRONG, and the script STOPs.
    ['a Worker forwarding a websocket upgrade on Realtime', (f) => { f[`GET ${API}/realtime/v1/websocket`] = { status: 101, headers: { 'x-openbed-proxy': 'forwarded' } }; }, 'probe 5 status'],
    ["Cloudflare's own 400 answering before the Worker ran, so the upgrade proved nothing", (f) => { f[`GET ${API}/realtime/v1/websocket`] = { status: 400 }; }, 'probe 5 status'],
    ['a Worker forwarding Storage', (f) => { f[`GET ${API}/storage/v1/object/public/probe`] = { status: 400, headers: { 'x-openbed-proxy': 'forwarded' }, body: '{"error":"Bucket not found"}' }; }, 'probe 6 status'],
    ['a Worker that answers Storage with a 404 of its own making but not marked', (f) => { f[`GET ${API}/storage/v1/object/public/probe`] = { status: 404, body: REFUSED_BODY }; }, 'probe 6 x-openbed-proxy'],
    // Probe 5b: the only hosted test of the Upgrade rule on a LISTED path. A Worker without it forwards.
    ['a Worker without the Upgrade refusal forwarding the upgrade on a listed path', (f) => { f[`GET ${API}/auth/v1/settings apikey=${TRACKED_KEY}`] = [{ status: 200, headers: { 'x-openbed-proxy': 'forwarded' }, body: '{}' }, { status: 200, headers: { 'x-openbed-proxy': 'forwarded' }, body: '{}' }]; }, 'probe 5b status'],
    // Probe 7, one plant per checked line.
    ['verify answering 200, not a redirect', (f) => { f[VERIFY_GET] = { status: 200, headers: { 'x-openbed-proxy': 'forwarded', location: `${ADMIN}/` } }; }, 'probe 7 status'],
    ['verify answered by the Worker as a refusal', (f) => { f[VERIFY_GET] = { status: 303, headers: { 'x-openbed-proxy': 'refused', location: `${ADMIN}/` } }; }, 'probe 7 x-openbed-proxy'],
    ['a redirect to the Supabase host', (f) => { f[VERIFY_GET] = { status: 303, headers: { 'x-openbed-proxy': 'forwarded', location: 'https://klrlpxysjsjpdkeqdhvl.supabase.co/auth/v1/verify' } }; }, 'probe 7 Location origin'],
    ['a redirect to api.openbed.ng itself', (f) => { f[VERIFY_GET] = { status: 303, headers: { 'x-openbed-proxy': 'forwarded', location: `${API}/auth/v1/verify` } }; }, 'probe 7 Location origin'],
    ["a redirect to the ward console: the Site URL GoTrue falls back to when redirect_to is lost", (f) => { f[VERIFY_GET] = { status: 303, headers: { 'x-openbed-proxy': 'forwarded', location: 'https://app.openbed.ng/' } }; }, 'probe 7 Location origin'],
    ['a Location on the admin host over plain http', (f) => { f[VERIFY_GET] = { status: 303, headers: { 'x-openbed-proxy': 'forwarded', location: 'http://admin.openbed.ng/' } }; }, 'probe 7 Location origin'],
    ['a Location on a subdomain of the admin host', (f) => { f[VERIFY_GET] = { status: 303, headers: { 'x-openbed-proxy': 'forwarded', location: 'https://evil.admin.openbed.ng/' } }; }, 'probe 7 Location origin'],
    ['a relative Location', (f) => { f[VERIFY_GET] = { status: 303, headers: { 'x-openbed-proxy': 'forwarded', location: '/' } }; }, 'probe 7 Location origin'],
    ['no Location at all', (f) => { f[VERIFY_GET] = { status: 303, headers: { 'x-openbed-proxy': 'forwarded' } }; }, 'probe 7 Location origin'],
    ['the previous Worker still serving its stamp', (f) => { f[`GET ${API}/__openbed/version`] = { status: 200, headers: { 'x-openbed-proxy': 'stamp' }, body: workerStampOf('0'.repeat(40)) }; }, 'stamp commit'],
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

  test.each<[string, string, { otp?: boolean; verify?: boolean; refresh?: boolean }]>([
    ['LIMIT_OTP unbound', 'stamp limits_bound otp', { otp: false }],
    ['LIMIT_VERIFY unbound', 'stamp limits_bound verify', { verify: false }],
    ['LIMIT_REFRESH unbound', 'stamp limits_bound refresh', { refresh: false }],
  ])('plant — a Worker with %s is a STOP, so a limiter that silently forwards cannot read as live', (_label, check, bound) => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const f = workerFixtures(head);
      f[`GET ${API}/__openbed/version`] = { status: 200, headers: { 'x-openbed-proxy': 'stamp' }, body: workerStampOf(head, bound) };
      expectStopAt(run(root, SCRIPTS.worker, [API, work], f), check);
    });
  });

  test('plant — a Worker from before W3, whose stamp carries no limits_bound at all, is a STOP on all three', () => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      const f = workerFixtures(head);
      f[`GET ${API}/__openbed/version`] = { status: 200, headers: { 'x-openbed-proxy': 'stamp' }, body: stampOf(head) };
      const r = run(root, SCRIPTS.worker, [API, work], f);
      for (const c of ['otp', 'verify', 'refresh']) expect(r.out).toContain(`  WRONG  stamp limits_bound ${c}: read '(absent)', must be 'true'`);
      expectStopAt(r, 'stamp limits_bound otp');
    });
  });

  test('probe 7 and the limits proof name the same admin origin as the sign-in link read-back, and a drifted one is rejected', () => {
    const link = readFileSync(join(REPO_ROOT, 'scripts', 'readback_signin_link.mjs'), 'utf8');
    for (const name of ['readback_worker.sh', 'readback_worker_limits.sh']) {
      const text = readFileSync(join(REPO_ROOT, 'scripts', name), 'utf8');
      expect(adminOriginDrift(text, link), name).toEqual([]);
      const drifted = text.replace("ADMIN_ORIGIN='https://admin.openbed.ng'", "ADMIN_ORIGIN='https://app.openbed.ng'");
      expect(drifted, `the plant did not change ${name}`).not.toBe(text);
      expect(adminOriginDrift(drifted, link)).toEqual([`ADMIN ORIGIN DRIFT: the script probes https://app.openbed.ng/ and scripts/readback_signin_link.mjs expects https://admin.openbed.ng/`]);
    }
    expect(adminOriginDrift('', link), 'an empty script compared equal').toEqual(['ADMIN ORIGIN UNREADABLE: one of the two files names no admin origin, so nothing was compared']);
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
// scripts/readback_worker_limits.sh -- the hosted proof of the verify limit, run once.
// ---------------------------------------------------------------------------

describe('scripts/readback_worker_limits.sh (R-2026-09-30-177 FA-3 i; over ONE connection, R-2026-09-30-180 FD-1)', () => {
  const LIMIT = (JSON.parse(readFileSync(join(REPO_ROOT, 'supabase-proxy', 'wrangler.json'), 'utf8')) as { ratelimits: { name: string; simple: { limit: number } }[] }).ratelimits.find((b) => b.name === 'LIMIT_VERIFY')?.simple.limit ?? 0;
  // 3L requests (FB-1 f): counting is eventually consistent, so a limited answer needs room to appear.
  const TOTAL = LIMIT * 3;
  const fwd: Answer = { status: 303, headers: { 'x-openbed-proxy': 'forwarded', location: `${ADMIN}/#error=access_denied` } };
  const lim: Answer = { status: 429, headers: { 'x-openbed-proxy': 'limited', 'retry-after': '60' } };
  /** The one -w format the proof prints per request: a `|` separator, because an empty header field must stay a field. */
  const W_FORMAT = '%{http_code}|%header{x-openbed-proxy}|%{num_connects}|%{time_total}\\n';
  /** L forwarded, then the rest limited: the answers a live limit gives. */
  const live = (): Answer[] => [...Array.from({ length: LIMIT }, () => fwd), ...Array.from({ length: TOTAL - LIMIT }, () => lim)];
  /** The limited tail after one planted answer at position L+1. */
  const tail = (): Answer[] => Array.from({ length: TOTAL - LIMIT - 1 }, () => lim);
  const go = (answers: Answer[] | Answer, env: Record<string, string> = {}, mutate?: (work: string) => void) =>
    withScratch((root) => {
      const work = repo(root);
      mutate?.(work);
      return run(root, SCRIPTS.limits, [API, work], { [VERIFY_GET]: answers }, env);
    });
  /** As `go`, with a `sleep` that logs, so a test can say whether the pause ran before a refusal. */
  const goLoggingSleep = (answers: Answer[] | Answer, env: Record<string, string> = {}) =>
    withScratch((root) => {
      const work = repo(root);
      mkdirSync(join(root, 'bin'), { recursive: true });
      writeFileSync(join(root, 'bin', 'sleep'), `#!/usr/bin/env bash\necho "SLEEP $1" >> "$STUB_LOG"\n`, 'utf8');
      chmodSync(join(root, 'bin', 'sleep'), 0o755);
      return run(root, SCRIPTS.limits, [API, work], { [VERIFY_GET]: answers }, env);
    });

  test('the limit under test is read from wrangler.json, and is a real number', () => {
    expect(LIMIT, 'wrangler.json holds no LIMIT_VERIFY limit, so every leg below tested a limit of zero').toBeGreaterThan(0);
  });

  test('real read-back is accepted — L forwarded then a `limited` 429 gives PASS, from ONE curl invocation of 3L URLs with all three parameters (FD-1 e)', () => {
    const r = go(live());
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`PASS: the first ${LIMIT} verify requests were forwarded and a later one was limited by the Worker`);
    expect(r.invocations, 'the proof was not ONE curl call, so its requests did not share a connection').toEqual([{ urls: TOTAL, fmt: W_FORMAT }]);
    expect(r.calls.length, 'the proof did not send 3L requests').toBe(TOTAL);
    expect(r.calls.every((c) => c === `GET ${VERIFY_PROBE_URL}`), r.calls.join('\n')).toBe(true);
    expect(r.out).toContain(`  ok     request ${LIMIT + 1} of ${TOTAL}: 429, x-openbed-proxy 'limited'`);
    expect(r.out).toContain(`  ok     connection reuse: every one of the ${TOTAL - 1} requests after the first reused its connection`);
  });

  test('real read-back is accepted — L+1 forwarded then limited is eventual consistency, as hosted read 6 forwarded then 9 limited (FD-1 e)', () => {
    const answers: Answer[] = [...Array.from({ length: LIMIT + 1 }, () => fwd), ...Array.from({ length: TOTAL - LIMIT - 1 }, () => lim)];
    const r = go(answers);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`  ok     request ${LIMIT + 1} of ${TOTAL}: 303, x-openbed-proxy 'forwarded'`);
    expect(r.out).toContain(`  ok     request ${LIMIT + 2} of ${TOTAL}: 429, x-openbed-proxy 'limited'`);
    expect(r.out).toContain('PASS: ');
  });

  // BEHAVIOURAL PASS, W3.1 row 2 (R-2026-09-30-180): the script's markers were typed, and nothing tied them to the file that
  // writes them. Planting `limited` -> `throttled` in supabase-proxy/handler.ts reddened every handler test and left every
  // test of this script green, so a renamed marker would have surfaced only as a STOP on hosted. The real handler's own
  // answers are read here, and the script must test for exactly the header and the values it writes.
  test('the proof tests for the header and the markers the real handler writes: `limited` on its 429, `forwarded` on a pass (behavioural pass)', async () => {
    const origin = 'https://example-ref.supabase.co';
    const handle = makeHandler({ origin, list: LIST_JSON as unknown as AllowList, stamp: { commit: 'a'.repeat(40), dirty: false, built_at: '2026-10-01T00:00:00.000Z' }, fetchImpl: async () => new Response('', { status: 303 }) });
    const verify = (): Request => new Request('https://api.openbed.ng/auth/v1/verify?token=probe&type=magiclink&redirect_to=https%3A%2F%2Fadmin.openbed.ng%2F');
    const over = await handle(verify(), { LIMIT_VERIFY: { limit: async () => ({ success: false }) } });
    const under = await handle(verify(), { LIMIT_VERIFY: { limit: async () => ({ success: true }) } });
    expect(over.status, 'the handler no longer answers an over-limit verify with a 429').toBe(429);
    const script = readFileSync(SCRIPTS.limits, 'utf8');
    expect(script, "the script tests for a marker the handler's 429 does not carry").toContain(`[ "$who" = "${String(over.headers.get(PROXY_HEADER))}" ]`);
    expect(script, "the script tests for a marker the handler's forwarded answer does not carry").toContain(`[ "$who" = "${String(under.headers.get(PROXY_HEADER))}" ]`);
    expect(readFileSync(SCRIPTS.common, 'utf8'), 'rb_fetch_times prints another header than the one the handler writes').toContain(`%header{${PROXY_HEADER}}`);
  });

  test('it sleeps 61 seconds before the FIRST request, unless told otherwise', () => {
    withScratch((root) => {
      const work = repo(root);
      mkdirSync(join(root, 'bin'), { recursive: true });
      writeFileSync(join(root, 'bin', 'sleep'), `#!/usr/bin/env bash\necho "SLEEP $1" >> "$STUB_LOG"\n`, 'utf8');
      chmodSync(join(root, 'bin', 'sleep'), 0o755);
      // An empty override reads as unset, so the script's own default is what runs.
      const r = run(root, SCRIPTS.limits, [API, work], { [VERIFY_GET]: live() }, { READBACK_LIMITS_SLEEP: '' });
      expect(r.status, r.out).toBe(0);
      expect(r.calls[0], 'the pause was not the first thing the script did').toBe('SLEEP 61');
      expect(r.calls.slice(1).every((c) => c.startsWith('GET '))).toBe(true);
    });
  });

  test.each<[string, Answer[], string, string]>([
    ["a 429 without `limited`, which is Supabase's own bucket", [...Array.from({ length: LIMIT }, () => fwd), { status: 429, headers: { 'x-openbed-proxy': 'forwarded' } }, ...tail()], `request ${LIMIT + 1} of ${TOTAL}`, "a 429 must read 'limited': this one is Supabase's own bucket, not the Worker's"],
    ['`limited` on one of the first L', [fwd, fwd, lim, ...Array.from({ length: TOTAL - 3 }, () => fwd)], 'request 3 of ' + TOTAL, `must be 'forwarded': one of the first ${LIMIT} was limited`],
    ['an answer that is neither forwarded nor limited', [fwd, { status: 404, headers: { 'x-openbed-proxy': 'refused' } }, ...Array.from({ length: TOTAL - 2 }, () => lim)], 'request 2 of ' + TOTAL, `must be 'forwarded', or 'limited' after the first ${LIMIT}`],
    ['`limited` carried by a status that is not 429', [...Array.from({ length: LIMIT }, () => fwd), { status: 200, headers: { 'x-openbed-proxy': 'limited' } }, ...tail()], `request ${LIMIT + 1} of ${TOTAL}`, 'a limited answer must be a 429'],
    // THE BOUNDARY (FB-3 d): L-1 forwarded, then `limited` at request L itself. One of the first L, and the off-by-one a
    // loop of `<` for `<=` would accept.
    ['`limited` at request L, the last of the first L (the boundary)', [...Array.from({ length: LIMIT - 1 }, () => fwd), lim, ...Array.from({ length: TOTAL - LIMIT }, () => lim)], `request ${LIMIT} of ${TOTAL}`, `must be 'forwarded': one of the first ${LIMIT} was limited`],
  ])('plant — %s is a STOP', (_label, answers, check, msg) => {
    const r = go(answers);
    expectStopAt(r, check);
    expect(r.out).toContain(msg);
  });

  test('plant — an answer with NO x-openbed-proxy header reads an empty field, not a shifted one (FD-1 a: the separator keeps an empty field)', () => {
    const r = go({ status: 303 });
    expectStopAt(r, `request 1 of ${TOTAL}`);
    expect(r.out).toContain(`read '303, x-openbed-proxy ''`);
    // A separator that collapsed the empty field would shift the connection count into its place and misread it.
    expect(r.out).toContain(`  ok     connection reuse: every one of the ${TOTAL - 1} requests after the first reused its connection`);
  });

  test('plant — no 429 at all is a STOP THE FIRST TIME, with the elapsed seconds, and no advice to wait and run it again (FD-1 c)', () => {
    const r = go(fwd);
    expectStopAt(r, 'a limited answer');
    expect(r.out).toContain('Over one connection a miss is a real STOP the first time: paste this whole output back for Cowork');
    expect(r.out, 'the old advice to wait and run it again is back').not.toContain('wait 2 minutes and run this once more');
    expect(r.out, "the STOP did not print the call's elapsed seconds").toMatch(/none in \d+ requests over one connection, the call took \d+s/);
    expect(r.calls.length).toBe(TOTAL);
  });

  test('plant — a request after the first that opened a NEW connection reads WRONG, because the count was split across machines (FD-1 b)', () => {
    const answers = live();
    answers[LIMIT + 1] = { ...lim, connects: 1 };
    const r = go(answers);
    expectStopAt(r, 'connection reuse');
    expect(r.out).toContain(`read '1 of the ${TOTAL - 1} requests after the first opened a new connection'`);
    expect(r.out).toContain('the requests did not share one connection, so the count was split across machines and proves nothing');
  });

  test('plant — every request on its own connection is the connection STOP and nothing else: the missing 429 is explained by it, not reported twice (FD-1 b)', () => {
    const r = go({ ...fwd, connects: 1 } as Answer);
    expectStopAt(r, 'connection reuse');
    expect(r.out).toContain(`read '${TOTAL - 1} of the ${TOTAL - 1} requests after the first opened a new connection'`);
    expect(r.out, 'the no-429 verdict was printed on top of the connection one').not.toContain('  WRONG  a limited answer: ');
  });

  test('could not run — a curl failure is an ERROR with no verdict', () => {
    const r = go({ fail: 7 });
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain(`ERROR: curl exited 7 on GET ${API}/auth/v1/verify -- the check did not run`);
    expect(r.out).not.toContain('PASS:');
    expect(r.out).not.toContain('STOP:');
  });

  test('could not run — a curl failure PART WAY is an ERROR, never a 000 read as a STOP (FD-1 a: --fail-early)', () => {
    // Without --fail-early real curl goes on after a failed URL, prints 000 for it and exits 0 when the last URL succeeds.
    const answers: Answer[] = [...Array.from({ length: LIMIT + 1 }, () => fwd), { fail: 7 }, ...Array.from({ length: TOTAL - LIMIT - 2 }, () => lim)];
    const r = go(answers);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain(`ERROR: curl exited 7 on GET ${API}/auth/v1/verify -- the check did not run`);
    expect(r.out).not.toContain('WRONG');
    expect(r.out).not.toContain('STOP:');
  });

  test('could not run — fewer -w lines than requests is an ERROR, because the connection check would read a gap (FD-1 a)', () => {
    const r = go(live(), { STUB_CURL_DROP_W: '1' });
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain(`ERROR: curl printed ${TOTAL - 1} result lines for ${TOTAL} requests sent in one call, so the connection check has nothing to read -- nothing was proved`);
    expect(r.out).not.toContain('PASS:');
    expect(r.out).not.toContain('STOP:');
    expect(r.invocations.length, 'the short-output plant did not reach the one call').toBe(1);
  });

  test.each([
    ['7.83.1, just below the first curl with %header{}', 'curl 7.83.1 (x86_64-apple-darwin) libcurl/7.83.1'],
    ['7.54.0', 'curl 7.54.0 (stub)'],
    ['6.9.9', 'curl 6.9.9 (stub)'],
  ])('could not run — curl %s is an ERROR naming the version line, before the sleep, with nothing sent (FD-1 a)', (_label, line) => {
    const r = goLoggingSleep(live(), { STUB_CURL_VERSION: line });
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain(`ERROR: the -w option's %header{} needs curl 7.84.0 or later, and this curl reads ${line}, so the proof cannot read the Worker's answers; nothing was sent`);
    expect(r.calls, 'the sleep ran, or a request went out, before the version was read').toEqual([]);
    expect(r.invocations).toEqual([]);
  });

  test.each([
    ['not a curl version line at all', 'not curl at all'],
    ['a version with no minor number', 'curl 8 (stub)'],
    ['a version whose numbers are not numbers', 'curl x.y.z (stub)'],
  ])('could not run — %s is an ERROR too: an unreadable version is not a pass (FD-1 a)', (_label, line) => {
    const r = goLoggingSleep(live(), { STUB_CURL_VERSION: line });
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain(`ERROR: the -w option's %header{} needs curl 7.84.0 or later, and this curl reads ${line}, so the proof cannot read the Worker's answers; nothing was sent`);
    expect(r.calls).toEqual([]);
  });

  test.each([
    ['7.84.0, the first curl with %header{}', 'curl 7.84.0 (stub)'],
    ['7.100.2, a minor number with three digits', 'curl 7.100.2 (stub)'],
    ['8.0.1, a higher major with a lower minor', 'curl 8.0.1 (stub)'],
    ['8.7.1, the ordinary current curl', 'curl 8.7.1 (stub)'],
    // FE-4 a: a two-digit major. A gate that compares one digit, or only 8, rejects it.
    ['10.0.0, a two-digit major', 'curl 10.0.0 (stub)'],
  ])('real read-back is accepted — curl %s passes the version check (FD-1 a)', (_label, line) => {
    const r = go(live(), { STUB_CURL_VERSION: line });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('PASS: ');
  });

  test('plant — a request after the first that reports TWO new connections reads WRONG too: the check is "not 0", not "not 1" (FE-4 b)', () => {
    const answers = live();
    answers[LIMIT + 3] = { ...lim, connects: 2 };
    const r = go(answers);
    expectStopAt(r, 'connection reuse');
    expect(r.out).toContain(`read '1 of the ${TOTAL - 1} requests after the first opened a new connection'`);
  });

  test('could not run — MORE -w lines than requests is an ERROR too: the count must equal, not only reach (FE-3)', () => {
    const r = go(live(), { STUB_CURL_EXTRA_W: '1' });
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain(`ERROR: curl printed ${TOTAL + 1} result lines for ${TOTAL} requests sent in one call, so the connection check has nothing to read -- nothing was proved`);
    expect(r.out).not.toContain('PASS:');
    expect(r.out).not.toContain('STOP:');
  });

  test('the limit is LIMIT_VERIFY\'s and not another binding\'s, and not a literal: a work copy with LIMIT_VERIFY at 4 sends 12 requests and says "the first 4" (FE-2)', () => {
    const FOUR = 4;
    const answers: Answer[] = [...Array.from({ length: FOUR }, () => fwd), ...Array.from({ length: FOUR * 3 - FOUR }, () => lim)];
    const r = go(answers, {}, (work) => {
      const f = join(work, 'supabase-proxy', 'wrangler.json');
      const w = JSON.parse(readFileSync(f, 'utf8')) as { ratelimits: { name: string; simple: { limit: number } }[] };
      const b = w.ratelimits.find((x) => x.name === 'LIMIT_VERIFY');
      expect(b, 'the work copy holds no LIMIT_VERIFY, so the plant did not land').toBeDefined();
      if (b !== undefined) b.simple.limit = FOUR;
      // The other two bindings stay as they are: LIMIT_OTP is 5, like LIMIT_VERIFY, which is what hid a read of the wrong one.
      expect(w.ratelimits.filter((x) => x.name !== 'LIMIT_VERIFY').map((x) => x.simple.limit), 'the plant moved another binding').toEqual([5, 10]);
      writeFileSync(f, JSON.stringify(w));
    });
    expect(r.status, r.out).toBe(0);
    expect(r.invocations, 'the proof did not send three times LIMIT_VERIFY\'s limit').toEqual([{ urls: FOUR * 3, fmt: W_FORMAT }]);
    expect(r.out).toContain(`PASS: the first ${FOUR} verify requests were forwarded and a later one was limited by the Worker`);
    expect(r.out).toContain(`sending ${FOUR * 3} verify requests`);
  });

  test('could not run — a curl --version that FAILS is an ERROR with exit 2, never curl\'s own exit code, and nothing is sent, before the sleep (FE-4 c)', () => {
    const r = goLoggingSleep(live(), { STUB_CURL_VERSION_FAIL: '1' });
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('ERROR: curl --version itself failed, so the proof cannot tell whether this curl can print a response header, and nothing was sent; curl exited 1');
    expect(r.out).not.toContain('PASS:');
    expect(r.out).not.toContain('STOP:');
    expect(r.calls, 'the sleep ran, or a request went out, before the version call failed').toEqual([]);
    expect(r.invocations).toEqual([]);
  });

  test('could not run — a wrangler.json with no LIMIT_VERIFY is an ERROR, and nothing is sent', () => {
    const r = go(live(), {}, (work) => writeFileSync(join(work, 'supabase-proxy', 'wrangler.json'), '{"ratelimits":[]}'));
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain("ERROR: could not read LIMIT_VERIFY's simple.limit from");
    expect(r.out).toContain('(node exited 3) -- nothing was sent');
    expect(r.calls).toEqual([]);
  });

  test('could not run — a sleep override that is not a whole number is an ERROR, and nothing is sent', () => {
    const r = go(live(), { READBACK_LIMITS_SLEEP: '1m' });
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain("ERROR: READBACK_LIMITS_SLEEP='1m' is not a whole number of seconds -- nothing was sent");
    expect(r.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The shared file's own could-not-run legs, reached through a script.
// ---------------------------------------------------------------------------

describe('scripts/readback_common.sh — node failing is an ERROR, never a verdict', () => {
  test('could not run — node failing while reading a Location header is an ERROR, never a verdict (probe 7)', () => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      mkdirSync(join(root, 'bin'), { recursive: true });
      // A node that fails ONLY on the Location read -- the one whose code names `u.origin` -- and
      // delegates every other call (the tracked-key read, the stamp, the curl stub) to the real one,
      // so the plant reaches the leg it is for and not an earlier one.
      writeFileSync(join(root, 'bin', 'node'), `#!/usr/bin/env bash\ncase "$2" in *u.origin*) exit 9 ;; esac\nexec "${process.execPath}" "$@"\n`);
      chmodSync(join(root, 'bin', 'node'), 0o755);
      const r = run(root, SCRIPTS.worker, [API, work], workerFixtures(head));
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('ERROR: node exited 9 reading a Location header -- the check did not run, so this read-back has no verdict');
      expect(r.out, 'probe 7 was never reached, so this planted an earlier failure').toContain('=== probe 7:');
      expect(r.out).not.toContain('PASS:');
      expect(r.out).not.toContain('STOP:');
    });
  });

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
/** Admin's page since D3: its one module script and its built stylesheet. */
const ADMIN_SHELL = '<!doctype html><script type="module" crossorigin src="/assets/index-Ad3m1nXy.js"></script><link rel="stylesheet" crossorigin href="/assets/index-Ad3mCss0.css">';
/** Admin's tracked favicon, read, never retyped (D3; R-2026-09-26-122 CX-3). */
const ADMIN_FAVICON: Answer = { status: 200, headers: { 'content-type': 'image/x-icon' }, bodyBase64: readFileSync(join(REPO_ROOT, 'apps', 'admin', 'public', 'favicon.ico')).toString('base64') };

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
  // The custom domain's page, with the token (R-2026-09-25-119 CU-5 b).
  f[`GET https://admin.openbed.ng/${tok}`] = { status: 200, headers: { 'content-type': 'text/html', ...trackedHeaders('admin', withAccess ? 'production' : 'local') }, body: ADMIN_SHELL };
  // A hosted deploy serves the production rendering; the --local server (no Access) serves build:local's.
  f[`GET ${site}/${tok}`] = { status: 200, headers: { 'content-type': 'text/html', ...trackedHeaders('admin', withAccess ? 'production' : 'local') }, body: ADMIN_SHELL };
  f[`GET ${site}/assets/index-Ad3m1nXy.js${tok}`] = { status: 200, body: `const k="${withAccess ? DEPLOYED_KEY : TRACKED_KEY}";` };
  // D3: the favicon on each host the run reads (both, hosted; the one, --local), and one
  // self-hosted font through the page's stylesheet -- all with the token when there is one.
  f[`GET ${site}/favicon.ico${tok}`] = ADMIN_FAVICON;
  if (withAccess) f[`GET https://admin.openbed.ng/favicon.ico${tok}`] = ADMIN_FAVICON;
  f[`GET ${site}/assets/index-Ad3mCss0.css${tok}`] = { status: 200, headers: { 'content-type': 'text/css; charset=utf-8' }, body: DASH_CSS };
  f[`GET ${site}${FONT_PATH}${tok}`] = { status: 200, headers: { 'content-type': 'font/woff2' }, body: 'wOF2' };
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
      // D3 (R-2026-09-27-139 DO-4): the favicon on both hosts, and a self-hosted font, each read.
      for (const label of [
        'step 2 favicon.ico status', 'step 2 favicon.ico', 'step 2 favicon.ico content-type',
        'admin.openbed.ng favicon.ico status', 'admin.openbed.ng favicon.ico', 'admin.openbed.ng favicon.ico content-type',
        'step 2 page stylesheet', 'step 2 stylesheet fonts', 'step 2 font status', 'step 2 font content-type',
      ]) expect(r.out, `the check "${label}" never ran`).toContain(`  ok     ${label}: `);
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
    // The design pass (D3; R-2026-09-26-122 CX-3): the favicon is never the SPA's HTML, on either host, and the fonts are self-hosted woff2.
    ['/favicon.ico answered by the SPA fallback', (f: Fixtures) => { f[`GET ${ADMIN_SITE}/favicon.ico access`] = { status: 200, headers: { 'content-type': 'text/html' }, body: ADMIN_SHELL }; }, 'step 2 favicon.ico content-type'],
    ['/favicon.ico answered by the SPA fallback on admin.openbed.ng only', (f: Fixtures) => { f['GET https://admin.openbed.ng/favicon.ico access'] = { status: 200, headers: { 'content-type': 'text/html' }, body: ADMIN_SHELL }; }, 'admin.openbed.ng favicon.ico content-type'],
    ['a favicon that is not the tracked icon', (f: Fixtures) => { f[`GET ${ADMIN_SITE}/favicon.ico access`] = { status: 200, headers: { 'content-type': 'image/x-icon' }, bodyBase64: Buffer.from('not the icon').toString('base64') }; }, 'step 2 favicon.ico'],
    ['a page that links no stylesheet', (f: Fixtures) => { f[`GET ${ADMIN_SITE}/ access`] = { status: 200, headers: { 'content-type': 'text/html', ...trackedHeaders('admin') }, body: '<!doctype html><script type="module" crossorigin src="/assets/index-Ad3m1nXy.js"></script>' }; }, 'step 2 page stylesheet'],
    ['a stylesheet that names no woff2', (f: Fixtures) => { f[`GET ${ADMIN_SITE}/assets/index-Ad3mCss0.css access`] = { status: 200, headers: { 'content-type': 'text/css' }, body: 'body{margin:0}' }; }, 'step 2 stylesheet fonts'],
    ['a font served as text/plain', (f: Fixtures) => { f[`GET ${ADMIN_SITE}${FONT_PATH} access`] = { status: 200, headers: { 'content-type': 'text/plain' }, body: 'wOF2' }; }, 'step 2 font content-type'],
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

  test('a curl --version that FAILS is an ERROR with exit 2, never curl\'s own exit code, and the token is never sent (FE-4 c)', () => {
    withScratch((root) => {
      const work = repo(root);
      const r = runAdmin(root, work, adminFixtures(git(work, 'rev-parse', 'HEAD').trim()), { ...ACCESS_ENV, STUB_CURL_VERSION_FAIL: '1' });
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('ERROR: curl --version itself failed, so the token half cannot tell whether this curl reads headers from a file, and nothing was sent; curl exited 1');
      expect(r.out).not.toContain('PASS:');
      expect(r.out).not.toContain('STOP:');
      expect(r.calls.some((c) => c.endsWith(' access')), 'a request carrying the token went out').toBe(false);
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

    test('plant — a local favicon that is not the tracked icon is a STOP (D3)', () => {
      withScratch((root) => {
        const work = repo(root);
        const f = adminFixtures(git(work, 'rev-parse', 'HEAD').trim(), ADMIN_LOCAL, false);
        f[`GET ${ADMIN_LOCAL}/favicon.ico`] = { status: 200, headers: { 'content-type': 'text/html' }, body: ADMIN_SHELL };
        expectStopAt(runAdmin(root, work, f, {}, ['--local', ADMIN_LOCAL, work]), 'step 2 favicon.ico');
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

// ---------------------------------------------------------------------------
// THE READ-BACKS SEE WHAT A BROWSER SEES (R-2026-09-25-119 CU-5). On 2026-09-25 two
// Cloudflare zone settings changed what openbed.ng's hosts served, and no read-back saw
// either: Web Analytics injected a beacon <script> into the HTML ONLY for a browser-like
// request, and a managed robots.txt block was prepended on the custom domain only. Every
// page is now fetched as a browser, every <script> is listed, the custom domain is read
// as well as the deployment, and robots.txt is compared byte for byte.
// ---------------------------------------------------------------------------

const BEACON = '<script defer src="https://static.cloudflareinsights.com/beacon.min.js/v31edd6df95cf4e85bb4c19e7a9bdbcba1788362987495" data-cf-beacon=\'{"token":"PLANTED"}\'></script>';
const MANAGED_ROBOTS = '# As a condition of accessing this website, you agree to abide by the following content signals:\nUser-agent: *\nContent-Signal: search=yes,ai-train=no,use=reference\nAllow: /\n\n';

interface Target { name: string; script: string; site: string; page: string; domainPage: string; env: Record<string, string>; fixtures: (head: string) => Fixtures; scriptsLabel: string; domainLabel: string }
const TARGETS: Target[] = [
  { name: 'readback_ward_console.sh', script: SCRIPTS.ward, site: WARD, page: `GET ${WARD}/`, domainPage: `GET ${WARD_DOMAIN}/`, env: {}, fixtures: wardFixtures, scriptsLabel: 'step 3 scripts', domainLabel: 'app.openbed.ng' },
  { name: ADMIN_NAME, script: SCRIPTS.admin, site: ADMIN_SITE, page: `GET ${ADMIN_SITE}/ access`, domainPage: 'GET https://admin.openbed.ng/ access', env: ACCESS_ENV, fixtures: (h) => adminFixtures(h), scriptsLabel: 'step 2 scripts', domainLabel: 'admin.openbed.ng' },
  { name: 'readback_pages.sh', script: SCRIPTS.pages, site: SITE, page: `GET ${SITE}/`, domainPage: `GET ${DASH_DOMAIN}/`, env: {}, fixtures: pagesFixtures, scriptsLabel: 'page scripts', domainLabel: 'openbed.ng' },
];

/** The page a fixture serves at `key`, with `html` spliced in before its first <script>. */
function withInPage(f: Fixtures, key: string, html: string, asKey = key): void {
  const ans = f[key] as { status: number; headers?: Record<string, string>; body?: string };
  f[asKey] = { ...ans, body: (ans.body ?? '').replace('<script', `${html}<script`) };
}

describe('the read-backs see what a browser sees (R-2026-09-25-119 CU-5)', () => {
  test.each(TARGETS.map((t) => [t.name, t] as const))('real %s is accepted — every page fetched as a browser, the custom domain read, every script listed', (_name, t) => {
    withScratch((root) => {
      const work = repo(root);
      const r = run(root, t.script, [t.site, work], t.fixtures(git(work, 'rev-parse', 'HEAD').trim()), t.env);
      expect(r.status, r.out).toBe(0);
      expect(r.out).toContain(`  ok     ${t.scriptsLabel}: `);
      expect(r.out).toContain(`  ok     ${t.domainLabel} content-security-policy: `);
      expect(r.out).toContain(`  ok     ${t.domainLabel} scripts: `);
      const pageCalls = r.calls.filter((c) => /^GET https:\/\/[^ ]+\/( |$)/.test(c));
      expect(pageCalls.length, 'no page was fetched').toBeGreaterThan(1);
      for (const c of pageCalls) expect(c, 'a page was fetched without presenting as a browser').toContain(' browser');
    });
  });

  // THE BEACON: served ONLY to a browser. If a read-back stops presenting as one, it is
  // served the clean page, and this plant goes green by being blind (CU-5 e).
  test.each(TARGETS.map((t) => [t.name, t] as const))('plant — %s: a beacon <script> injected only for a browser is a STOP naming it', (_name, t) => {
    withScratch((root) => {
      const work = repo(root);
      const f = t.fixtures(git(work, 'rev-parse', 'HEAD').trim());
      const asKey = t.page.endsWith(' access') ? t.page.replace(/ access$/, ' browser access') : `${t.page} browser`;
      withInPage(f, t.page, BEACON, asKey);
      const r = run(root, t.script, [t.site, work], f, t.env);
      expectStopAt(r, t.scriptsLabel);
      expect(r.out).toContain('https://static.cloudflareinsights.com/beacon.min.js/');
    });
  });

  test('plant — an inline <script> is a STOP', () => {
    withScratch((root) => {
      const work = repo(root);
      const f = wardFixtures(git(work, 'rev-parse', 'HEAD').trim());
      withInPage(f, `GET ${WARD}/`, '<script>window.planted = 1</script>');
      expectStopAt(run(root, SCRIPTS.ward, [WARD, work], f), 'step 3 scripts');
    });
  });

  test.each(TARGETS.map((t) => [t.name, t] as const))('plant — %s: a custom domain whose CSP differs from the deployment is a STOP', (_name, t) => {
    withScratch((root) => {
      const work = repo(root);
      const f = t.fixtures(git(work, 'rev-parse', 'HEAD').trim());
      const ans = f[t.domainPage] as { status: number; headers: Record<string, string>; body: string };
      f[t.domainPage] = { ...ans, headers: { ...ans.headers, 'content-security-policy': "default-src 'self'" } };
      expectStopAt(run(root, t.script, [t.site, work], f, t.env), `${t.domainLabel} content-security-policy`);
    });
  });

  test("plant — a /robots.txt with Cloudflare's managed block prepended is a STOP", () => {
    withScratch((root) => {
      const work = repo(root);
      const f = pagesFixtures(git(work, 'rev-parse', 'HEAD').trim());
      f[`GET ${SITE}/robots.txt`] = { status: 200, headers: { 'content-type': 'text/plain' }, body: MANAGED_ROBOTS + ROBOTS_TXT };
      expectStopAt(run(root, SCRIPTS.pages, [SITE, work], f), 'read-back 7 robots.txt');
    });
  });

  test('plant — a /robots.txt that differs only on openbed.ng is a STOP', () => {
    withScratch((root) => {
      const work = repo(root);
      const f = pagesFixtures(git(work, 'rev-parse', 'HEAD').trim());
      f[`GET ${DASH_DOMAIN}/robots.txt`] = { status: 200, headers: { 'content-type': 'text/plain' }, body: MANAGED_ROBOTS + ROBOTS_TXT };
      const r = run(root, SCRIPTS.pages, [SITE, work], f);
      expectStopAt(r, 'read-back 7 openbed.ng robots.txt');
      expect(r.out, 'the deployment copy was clean, so its line must read ok').toContain('  ok     read-back 7 robots.txt: ');
    });
  });
});

describe('CU-5 could-not-run legs: a check that cannot run is an ERROR, never a verdict', () => {
  test('could not run — node failing while listing the page\'s scripts is an ERROR', () => {
    withScratch((root) => {
      const work = repo(root);
      const bin = stubBin(root);
      const realNode = process.execPath;
      // The curl stub runs on the real node; the scripts' own node calls reach this stub,
      // which fails ONLY the script listing (its code carries the marker) and delegates
      // everything else, so the plant reaches the leg it is for.
      writeFileSync(join(bin, 'curl'), readFileSync(join(bin, 'curl'), 'utf8').replace('#!/usr/bin/env node', `#!${realNode}`));
      writeFileSync(join(bin, 'node'), `#!/usr/bin/env bash\ncase "$*" in *OPENBED_RB_SCRIPTS*) exit 9 ;; esac\nexec "${realNode}" "$@"\n`);
      chmodSync(join(bin, 'node'), 0o755);
      const r = run(root, SCRIPTS.ward, [WARD, work], wardFixtures(git(work, 'rev-parse', 'HEAD').trim()));
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain("ERROR: node exited 9 listing the page's scripts -- the check did not run, so this read-back has no verdict");
      expect(r.out).not.toContain('PASS:');
    });
  });

  test('could not run — cmp failing to compare robots.txt is an ERROR', () => {
    withScratch((root) => {
      const work = repo(root);
      const bin = stubBin(root);
      writeFileSync(join(bin, 'cmp'), '#!/usr/bin/env bash\nexit 2\n');
      chmodSync(join(bin, 'cmp'), 0o755);
      const r = run(root, SCRIPTS.pages, [SITE, work], pagesFixtures(git(work, 'rev-parse', 'HEAD').trim()));
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('ERROR: cmp exited 2 comparing a response body with');
      expect(r.out).not.toContain('PASS:');
    });
  });

  test('could not run — a checkout with no tracked robots.txt is an ERROR', () => {
    withScratch((root) => {
      const work = repo(root);
      const head = git(work, 'rev-parse', 'HEAD').trim();
      rmSync(join(work, 'apps', 'public-dashboard', 'public', 'robots.txt'));
      const r = run(root, SCRIPTS.pages, [SITE, work], pagesFixtures(head));
      expect(r.status, r.out).toBe(2);
      expect(r.out).toContain('to compare against -- the check did not run, so this read-back has no verdict');
      expect(r.out).not.toContain('PASS:');
    });
  });
});
