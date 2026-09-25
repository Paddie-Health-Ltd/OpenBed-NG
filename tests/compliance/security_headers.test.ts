import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { deployableApps, outputDirOf } from './_apps.js';
import { REPO_ROOT, place, withScratch } from './_scratch.js';
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
 *     apiOrigin() -- THE BUILD TARGET'S API origin from packages/origins/origins.json,
 *     read from that file and never retyped here. The build the founder deploys
 *     renders `production` and names no local host at all (R-2026-09-25-117 CS-2);
 *     `build:local` renders `local` for a local `wrangler pages dev`. Until 2026-09-25
 *     this read "the API origins … production and local", and every build shipped
 *     both;
 *   - and, for such an app, those origins DERIVED, not retyped, in the file itself
 *     (R-2026-09-24-94 BV-2): the tracked _headers names the @API_ORIGINS@
 *     placeholder exactly once, in connect-src, and holds neither origin as text.
 *     scripts/render_headers.mjs fills it from origins.json when the app is built,
 *     and the BUILT _headers must equal that script's rendering of the tracked one.
 *     Every rule above is checked on the rendering -- what actually ships.
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
/** origins.json's own list of what counts as local, read, never retyped. */
const LOCAL_HOSTS: string[] = ORIGINS.localHosts;

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

const PLACEHOLDER = '@API_ORIGINS@';
const RENDERER = join(REPO_ROOT, 'scripts', 'render_headers.mjs');

type Target = 'production' | 'local';

/** scripts/render_headers.mjs run over `text` for `target`, as the build runs it. Never throws. */
function render(text: string, target: Target = 'production', renderer: string = RENDERER): { status: number; out: string; err: string } {
  return withScratch((work) => {
    place(work, '_headers', text);
    const r = spawnSync('node', [renderer, '--target', target, join(work, '_headers')], { encoding: 'utf8' });
    return { status: r.status ?? -1, out: r.stdout, err: r.stderr };
  });
}

/** What the tracked file must say about the API origins BEFORE rendering (BV-2). */
function sourceViolations(text: string, api: boolean): string[] {
  const out: string[] = [];
  const count = text.split(PLACEHOLDER).length - 1;
  const cspLine = text.split('\n').find((l) => /^\s+Content-Security-Policy:/i.test(l)) ?? '';
  const connect = /connect-src([^;]*)/.exec(cspLine)?.[1] ?? '';
  if (api && (count !== 1 || !connect.split(/\s+/).includes(PLACEHOLDER))) out.push(`names ${PLACEHOLDER} ${count} time(s), not exactly once in connect-src, so its API origins are not derived from origins.json`);
  if (!api && count !== 0) out.push(`names ${PLACEHOLDER}, but this app calls no API`);
  for (const o of API_ORIGINS) if (text.includes(o)) out.push(`types the API origin ${o} into the file instead of deriving it from origins.json`);
  return out;
}

/** Every violation of the tracked text: the source rule, then the header rules on its rendering. */
function violations(text: string, app: string, target: Target = 'production'): string[] {
  if (text.trim() === '') return headerViolations(text, expectedFor(app, target));
  const r = render(text, target);
  if (r.status !== 0) return [...sourceViolations(text, callsApi(app)), `the renderer refused: ${r.err.trim()}`];
  return [...sourceViolations(text, callsApi(app)), ...headerViolations(r.out, expectedFor(app, target))];
}

const expectedFor = (app: string, target: Target): string[] => ["'self'", ...(callsApi(app) ? [ORIGINS.api[target]] : [])];
const source = (app: string): string => {
  const p = join(REPO_ROOT, 'apps', app, 'public', '_headers');
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
};

const ward = (): string => source('ward-console');

describe('security headers, per deployable app', () => {
  test('anti-vacuity — more than one app is discovered, and at least one calls the API', () => {
    expect(APPS.length).toBeGreaterThan(1);
    expect(APPS.filter(callsApi).length, 'no app calls apiOrigin(), so the connect-src rule for one is never exercised').toBeGreaterThan(0);
  });

  test.each(APPS)('real %s _headers is accepted, rendered for production and for local', (app) => {
    expect(violations(source(app), app, 'production')).toEqual([]);
    expect(violations(source(app), app, 'local')).toEqual([]);
  });

  test.each(APPS)('%s: the production rendering names no local host in any header value', (app) => {
    const r = render(source(app), 'production');
    expect(r.status, r.err).toBe(0);
    const values = [...headersFor(r.out).values()].join('\n');
    expect(values).not.toBe('');
    for (const host of LOCAL_HOSTS) expect(values, `the production rendering of apps/${app}/public/_headers names ${host}`).not.toContain(host);
  });

  test.each(APPS)('%s: the built output ships the tracked _headers as rendered from origins.json for production', (app) => {
    const built = join(REPO_ROOT, 'apps', app, outputDirOf(app), '_headers');
    expect(existsSync(built), `run \`npm run build\` before the compliance suite — apps/${app} has no built _headers`).toBe(true);
    const r = render(source(app), 'production');
    expect(r.status, r.err).toBe(0);
    expect(readFileSync(built, 'utf8'), `apps/${app}'s built _headers is not the PRODUCTION rendering of its tracked one: was the render step skipped, or built with build:local?`).toBe(r.out);
  });

  // THE BUILD THE FOUNDER DEPLOYS NAMES NO LOCAL ORIGIN (R-2026-09-25-117 CS-2). Until
  // then the renderer filled BOTH api origins into every build, so the live admin and
  // ward-console CSPs carried http://127.0.0.1:54321. Only header VALUES are read, never
  // the file's comment prose, and the local hosts are origins.json's own localHosts.
  test.each(APPS)('%s: the built _headers names no local host in any header value', (app) => {
    const built = join(REPO_ROOT, 'apps', app, outputDirOf(app), '_headers');
    expect(existsSync(built), `run \`npm run build\` before the compliance suite — apps/${app} has no built _headers`).toBe(true);
    const values = [...headersFor(readFileSync(built, 'utf8')).values()].join('\n');
    expect(values, `apps/${app}'s built _headers has no header values at all`).not.toBe('');
    for (const host of LOCAL_HOSTS) expect(values, `apps/${app}'s built _headers names the local host ${host}`).not.toContain(host);
  });

  test('plant — a built _headers that was never rendered is not what the render step makes', () => {
    const r = render(ward());
    expect(r.status, r.err).toBe(0);
    expect(ward(), 'the plant is the tracked file itself, which must hold the placeholder').toContain(PLACEHOLDER);
    expect(ward()).not.toBe(r.out);
  });

  test.each([
    ['no _headers file at all', () => '', 'no _headers file'],
    ['a CSP without frame-ancestors', () => ward().replace("; frame-ancestors 'none'", ''), "CSP frame-ancestors is null, not 'none'"],
    // Aimed at the CSP line itself: the file's header comment also says "connect-src",
    // and a first-occurrence replace would land there, where the parser rightly looks
    // nowhere (a plant that did not reach the parsed line).
    ['connect-src widened by one origin', () => ward().replace(`connect-src 'self' ${PLACEHOLDER}`, `connect-src 'self' https://evil.example ${PLACEHOLDER}`), 'CSP connect-src is ['],
    ["connect-src missing the app's own API origins (the placeholder removed)", () => ward().replace(` ${PLACEHOLDER};`, ';'), 'CSP connect-src is ['],
    ['the API origins typed back in (BV-2: retyped, not derived)', () => ward().replace(PLACEHOLDER, API_ORIGINS.join(' ')), 'into the file instead of deriving it from origins.json'],
    ['the placeholder removed', () => ward().replace(` ${PLACEHOLDER};`, ';'), 'not exactly once in connect-src, so its API origins are not derived from origins.json'],
    ['the placeholder named twice', () => ward().replace(`connect-src 'self' ${PLACEHOLDER}`, `connect-src 'self' ${PLACEHOLDER} ${PLACEHOLDER}`), 'times; it may be filled in exactly one place'],
    ['the placeholder misspelt, so it would ship unrendered', () => ward().replace(PLACEHOLDER, '@API_ORIGIN@'), 'still holds an unrendered placeholder after rendering'],
    ['the placeholder outside connect-src', () => ward().replace(`connect-src 'self' ${PLACEHOLDER};`, "connect-src 'self';").replace("img-src 'self'", `img-src 'self' ${PLACEHOLDER}`), 'not exactly once in connect-src'],
    ["style-src with 'unsafe-inline'", () => ward().replace("style-src 'self'", "style-src 'self' 'unsafe-inline'"), 'CSP style-src is'],
    ['Referrer-Policy: origin', () => ward().replace('Referrer-Policy: no-referrer', 'Referrer-Policy: origin'), 'Referrer-Policy is origin, not no-referrer'],
    ['nosniff missing', () => ward().replace('  X-Content-Type-Options: nosniff\n', ''), 'X-Content-Type-Options is missing, not nosniff'],
    ['the headers set on another path, not /*', () => ward().replace('/*', '/index.html'), 'CSP default-src is null'],
  ])('plant — %s is rejected', (_name, plant, message) => {
    const planted = plant();
    expect(planted, 'the plant did not change the file').not.toBe(ward());
    expect(violations(planted, 'ward-console').join('\n')).toContain(message);
  });

  test('the dashboard, which fetches only its own origin, may not name the API at all', () => {
    const dash = source('public-dashboard');
    expect(violations(dash.replace("connect-src 'self'", "connect-src 'self' https://api.openbed.ng"), 'public-dashboard').join('\n')).toContain('CSP connect-src is [');
    expect(violations(dash.replace("connect-src 'self'", `connect-src 'self' ${PLACEHOLDER}`), 'public-dashboard').join('\n')).toContain('but this app calls no API');
  });
});

describe('scripts/render_headers.mjs', () => {
  test('real ward console _headers renders for production to connect-src exactly self plus api.production', () => {
    const r = render(ward(), 'production');
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain(`connect-src 'self' ${ORIGINS.api.production};`);
    expect(r.out).not.toContain(PLACEHOLDER);
  });

  test('real ward console _headers renders for local to connect-src exactly self plus api.local', () => {
    const r = render(ward(), 'local');
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain(`connect-src 'self' ${ORIGINS.api.local};`);
    expect(r.out).not.toContain(ORIGINS.api.production);
  });

  // THE TARGET IS REQUIRED (R-2026-09-25-117 CS-2): a silent default is what shipped a
  // local origin to production, so neither a missing nor an unknown target renders.
  test('plant — no --target is refused, exit 2, with nothing rendered', () => {
    withScratch((work) => {
      place(work, '_headers', ward());
      const r = spawnSync('node', [RENDERER, join(work, '_headers')], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('ERROR: no --target was given, so the API origin to name is unknown -- name production or local; there is no default, because a silent default shipped a local origin to production');
    });
  });

  test('plant — an unknown --target is refused, exit 2, with nothing rendered', () => {
    withScratch((work) => {
      place(work, '_headers', ward());
      const r = spawnSync('node', [RENDERER, '--target', 'staging', join(work, '_headers')], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain("ERROR: unknown --target 'staging' -- the build target is production or local");
    });
  });

  test('a file with no placeholder renders to itself', () => {
    for (const target of ['production', 'local'] as const) {
      const r = render(source('public-dashboard'), target);
      expect(r.status, r.err).toBe(0);
      expect(r.out).toBe(source('public-dashboard'));
    }
  });

  // The renderer reads origins.json relative to itself, so the plant is a scratch copy
  // of the script beside a planted origins.json -- the real one is never touched.
  test.each([
    ['api.local with a path', { production: ORIGINS.api.production, local: `${ORIGINS.api.local}/rest` }, 'origins.json api.'],
    ['api.production missing', { local: ORIGINS.api.local }, 'is not a bare origin, so it cannot go into a CSP'],
  ])('plant — an origins.json %s is refused, exit 2', (_name, api, message) => {
    withScratch((work) => {
      place(work, 'packages/origins/origins.json', JSON.stringify({ api }));
      place(work, 'scripts/.keep', '');
      copyFileSync(RENDERER, join(work, 'scripts', 'render_headers.mjs'));
      const r = render(ward(), 'production', join(work, 'scripts', 'render_headers.mjs'));
      expect(r.status, r.err).toBe(2);
      expect(r.err).toContain(message);
      expect(r.err).toContain('ERROR: could not render the headers file');
    });
  });

  test('plant — no file named is a usage refusal, exit 2', () => {
    const r = spawnSync('node', [RENDERER], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage: node scripts/render_headers.mjs [--write] --target production|local FILE -- name the build target and the _headers file to render');
  });

  test('plant — an unreadable file is refused with no output, exit 2', () => {
    const r = spawnSync('node', [RENDERER, '--target', 'production', join(REPO_ROOT, 'apps', 'no-such-app', '_headers')], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('ERROR: could not render the headers file');
  });

  test('--write rewrites the file in place with the rendering', () => {
    withScratch((work) => {
      place(work, '_headers', ward());
      const r = spawnSync('node', [RENDERER, '--write', '--target', 'production', join(work, '_headers')], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      expect(readFileSync(join(work, '_headers'), 'utf8')).toBe(render(ward(), 'production').out);
    });
  });
});
