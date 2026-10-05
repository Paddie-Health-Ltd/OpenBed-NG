// @vitest-environment jsdom
/// <reference lib="dom" />
// DOM TYPES FOR THIS FILE ONLY (see tests/compliance/dashboard_empty_state.test.ts).
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { robotsMetaContent, robotsTxtSource, SEARCH_VISIBILITY, type SearchVisibility } from '../../packages/origins/src/search.js';
import { place, REPO_ROOT, withScratch } from './_scratch.js';

/**
 * THE ONE SEARCH SETTING DECIDES TWO THINGS, AND NOTHING ELSE (R-2026-09-30-190 FN-3).
 *
 * SEARCH_VISIBILITY (packages/origins/src/search.ts) is shipped as "public" (FN-A; FN-3 first shipped it "hidden"). It decides
 * (a) the meta robots tag of the home, About and How-it-works pages and (b) which tracked
 * file becomes the built robots.txt. Legs, each with a plant:
 *
 *   1. SHIPPED VALUE. The value is "public". A flip in either direction is a one-line pull
 *      request that needs a ruling, and this is the line that reddens until the test is
 *      edited beside it.
 *   2. THE TWO PURE FUNCTIONS, both states, asserted by value.
 *   3. THE FILES. The hidden file, the fallback, is the robots.txt shipped before FN-3 byte
 *      for byte (sha256 pinned). The
 *      public file is PARSED as robots rules and each path is decided by the longest-match
 *      rule: the home, /about and /how-it-works are allowed; /beds.json, /privacy and every
 *      path not named are disallowed.
 *   4. THE BUILT DIST matches the shipped state: dist/robots.txt is a byte copy of the
 *      selected file, and each page's built meta robots is the function's value. A stale
 *      dist, a flipped page and a robots file that disagrees with the setting are each
 *      planted.
 *   5. NOTHING ELSE. Under apps/ and packages/ only search.ts (the definition) and
 *      apps/public-dashboard/vite.config.ts (the one reader) mention the setting.
 *
 * CLASSIFICATION (Clause 5): LIVE for the shipped (public) state, whose files, built dist
 * and one reader exist now. The hidden-state legs guard the fallback: the hidden file is
 * pinned and both pure functions are asserted, over a state that is not the shipped one.
 *
 * NOT ASSERTED HERE, deliberately: that the DEPLOYED site serves the selected robots.txt
 * and the selected meta tag -- a property of what was uploaded, which only
 * scripts/readback_pages.sh can read, after the founder's deploy. And that no Cloudflare
 * header overrides either: the one such header is INFERRED from a code comment and has no
 * source in this repository, so a test could only assert a belief; it is a runbook step
 * (12.4) read by the founder from the live response headers.
 *
 * The X-Robots-Tag on /beds.json (packages/snapshot/src/serve.ts) is independent of this
 * setting and its own tests are unchanged.
 */

const HIDDEN_FILE = join(REPO_ROOT, 'apps', 'public-dashboard', 'public', 'robots.txt');
const PUBLIC_FILE = join(REPO_ROOT, 'apps', 'public-dashboard', 'robots-public.txt');
const DIST = join(REPO_ROOT, 'apps', 'public-dashboard', 'dist');
/** Today's file, as shipped before this change (R-2026-09-30-190 P6). */
const HIDDEN_SHA256 = 'd12fcd98c7664f42c515f3ccb7446746bf34e1fc3efa4bfcccb3160c5b294e33';
const SETTING_PAGES = ['index.html', 'about.html', 'how-it-works.html'] as const;
const NOINDEX = 'noindex, nofollow';
/** The state the setting does NOT ship: the plants aim at it, so the go-live flip needs no plant edited. */
const OTHER: SearchVisibility = SEARCH_VISIBILITY === 'hidden' ? 'public' : 'hidden';
const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

interface Rule { readonly allow: boolean; readonly pattern: string }

/** The `User-agent: *` group's Allow and Disallow lines, comments and blank lines removed. */
function parseRules(text: string): Rule[] {
  const rules: Rule[] = [];
  let inStar = false;
  for (const raw of text.split('\n')) {
    const line = (raw.split('#')[0] ?? '').trim();
    if (line === '') continue;
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = (m[1] ?? '').toLowerCase();
    const value = m[2] ?? '';
    if (key === 'user-agent') inStar = value === '*';
    else if (inStar && key === 'allow') rules.push({ allow: true, pattern: value });
    else if (inStar && key === 'disallow') rules.push({ allow: false, pattern: value });
  }
  return rules;
}

/** Does a rule pattern match a path: prefix match, `$` anchoring the end. */
function matches(pattern: string, path: string): boolean {
  if (pattern === '') return false;
  return pattern.endsWith('$') ? path === pattern.slice(0, -1) : path.startsWith(pattern);
}

/** Whether `path` may be crawled: the longest matching pattern wins, and Allow wins a tie. */
function allowed(rules: Rule[], path: string): boolean {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!matches(r.pattern, path)) continue;
    if (best === null || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best === null ? true : best.allow;
}

const NAMED_ALLOWED = ['/', '/about', '/how-it-works'];
const NOT_ALLOWED = ['/beds.json', '/privacy', '/api/health', '/index.html', '/anything-else', '/facility/1'];

/** Why a robots file is not the public-state file, or []. */
function publicRobotsViolations(text: string): string[] {
  const rules = parseRules(text);
  if (rules.length === 0) return ['the file holds no rule for User-agent: *: nothing was checked'];
  const out: string[] = [];
  for (const p of NAMED_ALLOWED) if (!allowed(rules, p)) out.push(`${p} is disallowed: the public state must allow it`);
  for (const p of NOT_ALLOWED) if (allowed(rules, p)) out.push(`${p} is allowed: the public state must disallow every path it does not name`);
  return out;
}

/** The meta robots content of an HTML page, or null when it has no tag (or two). */
function metaRobots(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tags = Array.from(doc.querySelectorAll('meta[name="robots"]'));
  return tags.length === 1 ? tags[0]?.getAttribute('content') ?? null : null;
}

/** Why a built dist does not match the `visibility` state, or []. */
function distViolations(dist: string, visibility: SearchVisibility): string[] {
  if (!existsSync(dist) || readdirSync(dist).length === 0) return [`${dist} is missing or empty: build the dashboard first (npm run build -w @openbed/public-dashboard)`];
  const out: string[] = [];
  const robots = join(dist, 'robots.txt');
  const want = join(REPO_ROOT, robotsTxtSource(visibility));
  if (!existsSync(robots)) out.push('dist/robots.txt is missing');
  else if (!readFileSync(robots).equals(readFileSync(want))) out.push(`dist/robots.txt is not a byte copy of ${robotsTxtSource(visibility)}`);
  for (const page of SETTING_PAGES) {
    const file = join(dist, page);
    if (!existsSync(file)) { out.push(`dist/${page} is missing`); continue; }
    const got = metaRobots(readFileSync(file, 'utf8'));
    if (got !== robotsMetaContent(visibility)) out.push(`dist/${page}: meta robots is ${JSON.stringify(got)}, the ${visibility} state is ${JSON.stringify(robotsMetaContent(visibility))}`);
  }
  const privacy = join(dist, 'privacy.html');
  if (!existsSync(privacy)) out.push('dist/privacy.html is missing');
  else if (metaRobots(readFileSync(privacy, 'utf8')) !== NOINDEX) out.push(`dist/privacy.html: meta robots must be ${JSON.stringify(NOINDEX)} in both states`);
  return out;
}

const SETTING = 'SEARCH_VISIBILITY';
const DEFINITION = 'packages/origins/src/search.ts';
const READER = 'apps/public-dashboard/vite.config.ts';

/** Every file under apps/ and packages/ other than the definition and the one reader that names the setting. */
function readerViolations(files: { path: string; text: string }[]): string[] {
  if (files.length === 0) return ['no file was scanned: the one-reader check read nothing'];
  if (!files.some((f) => f.path === DEFINITION && f.text.includes(SETTING))) return [`${DEFINITION} does not define ${SETTING}`];
  return files
    .filter((f) => f.path !== DEFINITION && f.path !== READER && f.text.includes(SETTING))
    .map((f) => `${f.path}: reads ${SETTING}; the setting decides the robots tag and robots.txt only, through ${READER}`);
}

function trackedUnder(dirs: string[]): { path: string; text: string }[] {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...dirs], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split('\0').filter((p) => p !== '' && existsSync(join(REPO_ROOT, p))).map((p) => ({ path: p, text: readFileSync(join(REPO_ROOT, p), 'utf8') }));
}

describe('the search setting (R-2026-09-30-190 FN-3)', () => {
  test('real shipped value is "public" — a flip needs a ruling', () => {
    expect(SEARCH_VISIBILITY, 'SEARCH_VISIBILITY is not "public": a flip either way is a one-line pull request that needs its own ruling and edits this line').toBe('public');
  });

  test('the meta robots function states both outputs', () => {
    expect(robotsMetaContent('hidden')).toBe('noindex, nofollow');
    expect(robotsMetaContent('public')).toBe('index, follow');
  });

  test('the robots source function selects the two tracked files', () => {
    expect(robotsTxtSource('hidden')).toBe('apps/public-dashboard/public/robots.txt');
    expect(robotsTxtSource('public')).toBe('apps/public-dashboard/robots-public.txt');
    expect(existsSync(join(REPO_ROOT, robotsTxtSource('hidden')))).toBe(true);
    expect(existsSync(join(REPO_ROOT, robotsTxtSource('public')))).toBe(true);
  });

  test('real hidden-state file is accepted — the fallback, the robots.txt shipped before FN-3, byte for byte', () => {
    expect(sha(HIDDEN_FILE), 'the hidden-state robots.txt is no longer the file shipped before FN-3').toBe(HIDDEN_SHA256);
    expect(allowed(parseRules(readFileSync(HIDDEN_FILE, 'utf8')), '/'), 'the hidden file lets crawlers in').toBe(false);
  });

  test('real public-state file is accepted — the home, /about and /how-it-works allowed, everything else disallowed', () => {
    const out = publicRobotsViolations(readFileSync(PUBLIC_FILE, 'utf8'));
    expect(out, out.join('\n')).toEqual([]);
  });

  test('real public-state file reads exactly the five lines the ruling names', () => {
    expect(readFileSync(PUBLIC_FILE, 'utf8')).toBe('User-agent: *\nAllow: /$\nAllow: /about\nAllow: /how-it-works\nDisallow: /\n');
  });

  test.each([
    ['an Allow: / that opens the whole site', 'User-agent: *\nAllow: /\nDisallow: /\n', '/beds.json is allowed'],
    ['/privacy named in an Allow', 'User-agent: *\nAllow: /$\nAllow: /about\nAllow: /how-it-works\nAllow: /privacy\nDisallow: /\n', '/privacy is allowed'],
    ['no Disallow: /', 'User-agent: *\nAllow: /$\nAllow: /about\nAllow: /how-it-works\n', '/beds.json is allowed'],
    ['/about left out', 'User-agent: *\nAllow: /$\nAllow: /how-it-works\nDisallow: /\n', '/about is disallowed'],
    ['a home that is not allowed', 'User-agent: *\nAllow: /about\nAllow: /how-it-works\nDisallow: /\n', '/ is disallowed'],
  ])('plant — a public-state file with %s is rejected', (_name, text, message) => {
    expect(text, 'the plant is the real file').not.toBe(readFileSync(PUBLIC_FILE, 'utf8'));
    expect(publicRobotsViolations(text).join('\n')).toContain(message);
  });

  test('real built dist is accepted — it matches the shipped state', () => {
    const out = distViolations(DIST, SEARCH_VISIBILITY);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('plant — a dist built in the shipped state read against the other state is rejected on every page and on robots.txt', () => {
    const out = distViolations(DIST, OTHER).join('\n');
    expect(out).toContain(`dist/robots.txt is not a byte copy of ${robotsTxtSource(OTHER)}`);
    for (const page of SETTING_PAGES) expect(out).toContain(`dist/${page}: meta robots is`);
  });

  test('plant — a built privacy.html that says index, follow is rejected', () => {
    withScratch((root) => {
      cpSync(DIST, root, { recursive: true });
      const file = join(root, 'privacy.html');
      const real = readFileSync(file, 'utf8');
      const planted = real.replace('content="noindex, nofollow"', 'content="index, follow"');
      expect(planted, 'the plant did not land').not.toBe(real);
      place(root, 'privacy.html', planted);
      expect(distViolations(root, SEARCH_VISIBILITY).join('\n')).toContain('dist/privacy.html: meta robots must be');
    });
  });

  test('plant — a built page whose tag was flipped, and a robots.txt that disagrees, are each named', () => {
    withScratch((root) => {
      cpSync(DIST, root, { recursive: true });
      const about = readFileSync(join(root, 'about.html'), 'utf8');
      const flipped = about.replace(`content="${robotsMetaContent(SEARCH_VISIBILITY)}"`, `content="${robotsMetaContent(OTHER)}"`);
      expect(flipped, 'the plant did not land').not.toBe(about);
      place(root, 'about.html', flipped);
      place(root, 'robots.txt', readFileSync(join(REPO_ROOT, robotsTxtSource(OTHER)), 'utf8'));
      const out = distViolations(root, SEARCH_VISIBILITY);
      expect(out.join('\n')).toContain(`dist/about.html: meta robots is "${robotsMetaContent(OTHER)}"`);
      expect(out.join('\n')).toContain(`dist/robots.txt is not a byte copy of ${robotsTxtSource(SEARCH_VISIBILITY)}`);
      expect(out.some((l) => l.startsWith('dist/index.html') || l.startsWith('dist/how-it-works.html')), 'an untouched page was named').toBe(false);
    });
  });

  test('real — only the definition and the one reader name the setting under apps/ and packages/', () => {
    const files = trackedUnder(['apps', 'packages']);
    expect(files.map((f) => f.path), 'the reader is not in the corpus').toContain(READER);
    const out = readerViolations(files);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('plant — a second reader of the setting is rejected', () => {
    const out = readerViolations([
      { path: DEFINITION, text: `export const ${SETTING} = 'hidden';` },
      { path: READER, text: `import { ${SETTING} } from 'x';` },
      { path: 'apps/public-dashboard/src/main.ts', text: `if (${SETTING} === 'public') show();` },
    ]);
    expect(out.join('\n')).toContain('apps/public-dashboard/src/main.ts: reads SEARCH_VISIBILITY');
    expect(out.join('\n')).not.toContain(`${READER}:`);
  });

  test('anti-vacuity — checkers over an empty corpus fail', () => {
    expect(publicRobotsViolations('')).toEqual(['the file holds no rule for User-agent: *: nothing was checked']);
    expect(readerViolations([])).toEqual(['no file was scanned: the one-reader check read nothing']);
    withScratch((root) => {
      expect(distViolations(root, SEARCH_VISIBILITY).join('\n')).toContain('is missing or empty: build the dashboard first');
    });
    expect(metaRobots('<html></html>')).toBeNull();
  });
});
