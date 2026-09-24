import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { deployableApps, outputDirOf } from './_apps.js';
import { REPO_ROOT } from './_scratch.js';
import ORIGINS from '../../packages/origins/origins.json';

/**
 * EVERY DEPLOYABLE APP SHIPS ITS SECURITY HEADERS (R-2026-09-24-88 BP-10;
 * R-2026-09-24-93 BU-2 c, d, e; PR 3.4b-app B).
 *
 * Each app has a tracked apps/<app>/public/_headers, which Vite copies into its build
 * output, holding for every path:
 *   - a Content-Security-Policy with default-src 'self', script-src 'self',
 *     style-src 'self' (no 'unsafe-inline', no hash), object-src 'none',
 *     base-uri 'none' and frame-ancestors 'none';
 *   - connect-src EXACTLY 'self', plus -- for an app whose browser code calls
 *     apiOrigin() -- the API origins packages/origins/origins.json gives it,
 *     production and local, read from that file and never retyped here;
 *   - Referrer-Policy: no-referrer (the ward console's sign-in lands with tokens in
 *     the URL fragment);
 *   - X-Content-Type-Options: nosniff.
 * The set of apps is derived (tests/compliance/_apps.ts), so a new app is held to
 * this by existing.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - THAT THE CSP WORKS IN A BROWSER. **A CSP that is too tight breaks a page
 *     SILENTLY**: the browser blocks a stylesheet, a script or a fetch and says so only
 *     in its own console, and every assertion here would still pass. So each app is
 *     loaded in a real browser, locally, under these headers, and the ward console's
 *     sign-in is walked end to end, before a change to this file is reported
 *     (R-2026-09-24-93 BU-2 e; the ward-console deploy runbook repeats this).
 *   - That Cloudflare Pages applies _headers to a Function's response. It is
 *     understood not to, which is why /beds.json sets nosniff itself
 *     (packages/snapshot/src/serve.ts; tests/db/beds_json_served.test.ts), and why a
 *     local `wrangler pages dev` reading is not evidence of production. The
 *     production reading is scripts/readback_pages.sh on a real deploy.
 */

const APPS = deployableApps();
const API_ORIGINS = [ORIGINS.api.production, ORIGINS.api.local];

/** Whether an app's browser source selects an API origin at run time. */
function callsApi(app: string): boolean {
  const dir = join(REPO_ROOT, 'apps', app, 'src');
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.ts'))
    .some((f) => /\bapiOrigin\(/.test(readFileSync(join(dir, f), 'utf8')));
}

/** The headers a `_headers` file sets on `/*`, as a map. Comment lines are skipped. */
function headersFor(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let inAll = false;
  for (const raw of text.split('\n')) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) { inAll = raw.trim() === '/*'; continue; }
    if (!inAll) continue;
    const i = raw.indexOf(':');
    if (i > 0) out.set(raw.slice(0, i).trim().toLowerCase(), raw.slice(i + 1).trim());
  }
  return out;
}

function headerViolations(text: string, expectedConnect: string[]): string[] {
  if (text.trim() === '') return ['no _headers file, so the app ships no security headers'];
  const h = headersFor(text);
  const out: string[] = [];
  const csp = new Map((h.get('content-security-policy') ?? '').split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [name, ...values] = d.split(/\s+/);
    return [name as string, values];
  }));
  const need: [string, string[]][] = [
    ['default-src', ["'self'"]], ['script-src', ["'self'"]], ['style-src', ["'self'"]],
    ['object-src', ["'none'"]], ['base-uri', ["'none'"]], ['frame-ancestors', ["'none'"]],
  ];
  for (const [d, v] of need) if (JSON.stringify(csp.get(d)) !== JSON.stringify(v)) out.push(`CSP ${d} is ${JSON.stringify(csp.get(d) ?? null)}, not ${v.join(' ')}`);
  const connect = [...(csp.get('connect-src') ?? [])].sort();
  if (JSON.stringify(connect) !== JSON.stringify([...expectedConnect].sort())) out.push(`CSP connect-src is [${connect.join(' ')}], not [${[...expectedConnect].sort().join(' ')}]`);
  if (h.get('referrer-policy') !== 'no-referrer') out.push(`Referrer-Policy is ${h.get('referrer-policy') ?? 'missing'}, not no-referrer`);
  if (h.get('x-content-type-options') !== 'nosniff') out.push(`X-Content-Type-Options is ${h.get('x-content-type-options') ?? 'missing'}, not nosniff`);
  return out;
}

const expectedFor = (app: string): string[] => ["'self'", ...(callsApi(app) ? API_ORIGINS : [])];
const source = (app: string): string => {
  const p = join(REPO_ROOT, 'apps', app, 'public', '_headers');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
};

describe('security headers, per deployable app', () => {
  test('anti-vacuity — more than one app is discovered, and at least one calls the API', () => {
    expect(APPS.length).toBeGreaterThan(1);
    expect(APPS.filter(callsApi).length, 'no app calls apiOrigin(), so the connect-src rule for one is never exercised').toBeGreaterThan(0);
  });

  test.each(APPS)('real %s _headers is accepted', (app) => {
    expect(headerViolations(source(app), expectedFor(app))).toEqual([]);
  });

  test.each(APPS)('%s: the built output ships the same _headers', (app) => {
    const built = join(REPO_ROOT, 'apps', app, outputDirOf(app), '_headers');
    expect(existsSync(built), `run \`npm run build\` before the compliance suite — apps/${app} has no built _headers`).toBe(true);
    expect(readFileSync(built, 'utf8')).toBe(source(app));
  });

  const ward = (): string => source('ward-console');
  test.each([
    ['no _headers file at all', () => '', 'no _headers file'],
    ['a CSP without frame-ancestors', () => ward().replace("; frame-ancestors 'none'", ''), "CSP frame-ancestors is null, not 'none'"],
    // Aimed at the CSP line itself: the file's header comment also says "connect-src",
    // and a first-occurrence replace would land there, where the parser rightly looks
    // nowhere (a plant that did not reach the parsed line).
    ['connect-src widened by one origin', () => ward().replace("connect-src 'self' https://api", "connect-src 'self' https://evil.example https://api"), 'CSP connect-src is ['],
    ["connect-src missing the app's own API origin", () => ward().replace(' https://api.openbed.ng', ''), 'CSP connect-src is ['],
    ["style-src with 'unsafe-inline'", () => ward().replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"), 'CSP style-src is'],
    ['Referrer-Policy: origin', () => ward().replace('Referrer-Policy: no-referrer', 'Referrer-Policy: origin'), 'Referrer-Policy is origin, not no-referrer'],
    ['nosniff missing', () => ward().replace('  X-Content-Type-Options: nosniff\n', ''), 'X-Content-Type-Options is missing, not nosniff'],
    ['the headers set on another path, not /*', () => ward().replace('/*', '/index.html'), 'CSP default-src is null'],
  ])('plant — %s is rejected', (_name, plant, message) => {
    const planted = plant();
    expect(planted, 'the plant did not change the file').not.toBe(ward());
    expect(headerViolations(planted, expectedFor('ward-console')).join('\n')).toContain(message);
  });

  test('the dashboard, which fetches only its own origin, may not name the API at all', () => {
    const dash = source('public-dashboard');
    expect(headerViolations(dash.replace("connect-src 'self'", "connect-src 'self' https://api.openbed.ng"), expectedFor('public-dashboard')).join('\n')).toContain('CSP connect-src is [');
  });
});
