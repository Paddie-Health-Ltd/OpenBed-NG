// @vitest-environment jsdom
/// <reference lib="dom" />
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { facilityColumns, wardColumns } from '../../packages/snapshot/src/codec.js';
import { builtCss } from './_design.js';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE OPENBED LOGO LINKS HOME, ON /privacy AND ON THE BED LIST (R-2026-09-28-159 EI).
 *
 * WHAT THIS CLOSES. The founder found, on openbed.ng/privacy, that the header's mark and
 * "OpenBed" lockup were not a link: the page had no way back to the bed list but the
 * browser's back button, and a visitor who arrived from the ward console's or admin's
 * "Privacy notice" link had no back at all. index.html's header was the same.
 *
 * WHAT IS ASSERTED, over what ships:
 *   - the BUILT privacy page (apps/public-dashboard/dist/privacy.html), and the bed list
 *     as src/main.ts RENDERS it over the BUILT index.html, each have exactly one
 *     <a href="/"> -- relative, so it works on the deployment host and on openbed.ng alike
 *     -- in the site header, class "home-link", named "OpenBed home" by aria-label, and
 *     holding the mark (alt="") and the "OpenBed" lockup;
 *   - the BUILT CSS: every rule naming .home-link sets only layout, color: inherit,
 *     text-decoration: none or the cursor -- so no underline, no colour change and no
 *     hover effect in any state -- and one sets min-height of at least 44px; and the focus
 *     ring the link gets is the design system's own (tokens.css's :focus-visible rule,
 *     2px of --ob-teal-600 at a 2px offset), which no .home-link rule overrides.
 *
 * The built page and CSS exist in CI because compliance-tests builds first (ci.yml), as
 * tests/compliance/privacy_notice.test.ts already relies on.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - that the tap target MEASURES 44px, and that the ring is SEEN. jsdom lays nothing
 *     out and applies no :focus-visible. The rules are asserted from the built CSS's own
 *     text; the rendered box and ring are read in .design-screens/EI/'s screenshots, and
 *     on hosted by the founder's browser check.
 *   - that the lockup's navy and teal are the design system's values. That is
 *     tests/compliance/design_package.test.ts's, over tokens.css; here, only that no
 *     .home-link rule sets a colour of its own.
 */

const DIST = join(REPO_ROOT, 'apps', 'public-dashboard', 'dist');
const BUILT_PRIVACY = join(DIST, 'privacy.html');
const BUILT_INDEX = join(DIST, 'index.html');
const NAME = 'OpenBed home';
const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

function readBuilt(file: string): string {
  if (!existsSync(file)) {
    throw new Error(`ERROR: ${file} is missing. Run 'npm run build' first: a guard over an unbuilt page is not a verdict.`);
  }
  return readFileSync(file, 'utf8');
}

/** Why a page's home link is not the header's one relative link holding the mark and lockup, or []. */
export function homeLinkViolations(doc: Document): string[] {
  const out: string[] = [];
  const home = Array.from(doc.querySelectorAll('a')).filter((a) => a.getAttribute('href') === '/');
  if (home.length !== 1) {
    out.push(`the page has ${home.length} <a href="/">: it must have exactly one, the header's home link`);
    return out;
  }
  const a = home[0] as HTMLAnchorElement;
  if (a.closest('header.site-header') === null) out.push('the home link is not in the site header');
  if (!a.classList.contains('home-link')) out.push('the home link is not class="home-link"');
  if (a.getAttribute('aria-label') !== NAME) out.push(`the home link's accessible name is ${JSON.stringify(a.getAttribute('aria-label'))}, not "${NAME}"`);
  const mark = a.querySelector('img.mark');
  if (mark === null) out.push('the mark is not inside the home link');
  else if (mark.getAttribute('alt') !== '') out.push(`the mark's alt is ${JSON.stringify(mark.getAttribute('alt'))}: it must be empty, the link is named by aria-label`);
  if (squash(a.querySelector('.lockup')?.textContent) !== 'OpenBed') out.push('the lockup is not inside the home link');
  return out;
}

const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

interface Rule { selectors: string[]; decls: [string, string][] }

/** The style rules in a stylesheet, comments stripped. An at-rule's inner rules are read as rules. */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] as string).split(',').map((s) => s.trim()).filter((s) => s !== '');
    const decls = (m[2] as string).split(';').map((d) => d.trim()).filter((d) => d !== '').map((d) => {
      const i = d.indexOf(':');
      return [d.slice(0, i).trim().toLowerCase(), squash(d.slice(i + 1))] as [string, string];
    });
    out.push({ selectors, decls });
  }
  return out;
}

/** Layout the link may set. Anything else on a .home-link rule is an effect, in some state. */
const LAYOUT = new Set(['display', 'align-items', 'gap', 'min-height', 'margin', 'cursor']);
const FOCUS_RING = ':focus-visible{outline:var(--focus-ring-width) solid var(--focus-ring);outline-offset:var(--focus-ring-offset)}';
const RING_TOKENS: [string, string][] = [['--focus-ring', 'var(--ob-teal-600)'], ['--focus-ring-width', '2px'], ['--focus-ring-offset', '2px']];

/** Why a built stylesheet does not draw the home link as EI-1 b says, or []. */
export function homeLinkCssViolations(css: string): string[] {
  const out: string[] = [];
  const all = rules(css);
  const mine = all.filter((r) => r.selectors.some((s) => /\.home-link\b/.test(s)));
  if (mine.length === 0) return ['no rule names .home-link: the link is drawn as a browser link, underlined'];
  for (const r of mine) {
    for (const [prop, value] of r.decls) {
      if (prop === 'color' && value === 'inherit') continue;
      if (prop === 'text-decoration' && value === 'none') continue;
      if (LAYOUT.has(prop)) continue;
      out.push(`"${r.selectors.join(', ')}" sets ${prop}: ${value} -- the home link has no underline, no colour and no effect beyond the cursor, in any state`);
    }
  }
  for (const state of ['', ':hover', ':active', ':visited']) {
    const sel = `.home-link${state}`;
    const r = mine.find((x) => x.selectors.includes(sel) && x.decls.some(([p, v]) => p === 'text-decoration' && v === 'none'));
    if (r === undefined) out.push(`no rule gives ${sel} text-decoration: none -- the design system's a{} underlines it`);
  }
  const heights = mine.filter((r) => r.selectors.includes('.home-link'))
    .flatMap((r) => r.decls.filter(([p]) => p === 'min-height').map(([, v]) => /^(\d+(?:\.\d+)?)px$/.exec(v)))
    .map((m) => (m === null ? NaN : Number(m[1])));
  if (!heights.some((h) => h >= 44)) out.push(`.home-link's min-height is ${heights.length === 0 ? 'unset' : heights.join(', ') + 'px'}: the tap target is at least 44px tall`);
  if (!css.includes(FOCUS_RING)) out.push("the design system's :focus-visible rule is not in the stylesheet: the home link's focus ring is not the design system's");
  const tokens = new Map(all.flatMap((r) => r.decls));
  for (const [name, want] of RING_TOKENS) {
    if (tokens.get(name) !== want) out.push(`${name} is ${JSON.stringify(tokens.get(name) ?? null)}, not ${want}: the focus ring is 2px teal at a 2px offset`);
  }
  return out;
}

/** The built stylesheets that draw the header: the dashboard's and the notice's. */
function headerCss(): { path: string; text: string }[] {
  return builtCss('public-dashboard', REPO_ROOT).files.filter((f) => f.text.includes('.lockup-open'));
}

// One facility, one ward, so the rendered bed list carries a tile and its call link: a
// home link is asserted among every link the page really has, not over an empty page.
function encode(columns: readonly string[], values: Record<string, unknown>): unknown[] {
  const unknownKeys = Object.keys(values).filter((k) => !columns.includes(k));
  if (unknownKeys.length > 0) throw new Error(`fixture names columns the codec does not have: ${unknownKeys.join(', ')}`);
  return columns.map((c) => values[c] ?? null);
}
const PAYLOAD = {
  v: 1,
  facilities: [encode(facilityColumns(), {
    facility_id: 'f1', name: 'Test Facility', lga: 'Ikeja', state: 'Lagos', lat: 6.6, lng: 3.35,
    public_phone_e164: '+2348000000000', updated_at: '2026-09-28T08:00:00+00:00',
  })],
  wards: [encode(wardColumns(), {
    facility_id: 'f1', category: 'A_AND_E', offering: 'OFFERED', bed_count: 3, accepting_effective: true,
    gated_by: null, state: 'OK', source: 'WARD', monitoring_state: 'ACTIVE', updated_at: '2026-09-28T08:00:00+00:00',
  })],
  server_now: '2026-09-28T08:00:00+00:00',
  generated_at: '2026-09-28T08:00:00+00:00',
};

/** The bed list as a visitor gets it: the built index.html's body, then src/main.ts run over it. */
async function renderedIndex(): Promise<Document> {
  document.body.innerHTML = parse(readBuilt(BUILT_INDEX)).body.innerHTML.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200, headers: { 'content-type': 'application/json' } })));
  const { render } = await import('../../apps/public-dashboard/src/main.js');
  await render();
  if (!document.querySelector('a[href^="tel:+234"]')) throw new Error(`ERROR: the bed list did not render its tile: ${squash(document.body.textContent).slice(0, 300)}`);
  return document;
}

const LINK_OPEN = /<a class="home-link" href="\/" aria-label="OpenBed home">/;

/** Removes the home link, keeping what it held -- the page as it was before EI. Asserts it landed. */
function unlink(html: string): string {
  const planted = html.replace(LINK_OPEN, '').replace(/(<span class="lockup">[\s\S]*?<\/span><\/span>\s*)<\/a>/, '$1');
  if (planted === html || /class="home-link"/.test(planted)) throw new Error('the plant did not remove the home link');
  return planted;
}

const PAGE_PLANTS: [string, (h: string) => string, string][] = [
  ['the link removed, the mark and lockup kept', unlink, 'the page has 0 <a href="/">'],
  ['an absolute home URL', (h) => h.replace('class="home-link" href="/"', 'class="home-link" href="https://openbed.ng/"'), 'the page has 0 <a href="/">'],
  ['a second home link', (h) => h.replace('</header>', '</header><a href="/">Home</a>'), 'the page has 2 <a href="/">'],
  ['no accessible name', (h) => h.replace(' aria-label="OpenBed home"', ''), 'accessible name is null'],
  ['the wrong accessible name', (h) => h.replace('aria-label="OpenBed home"', 'aria-label="OpenBed"'), 'accessible name is "OpenBed"'],
  ['the mark given alt text', (h) => h.replace(/(<img class="mark"[^>]*?)alt=""/, '$1alt="OpenBed"'), "the mark's alt is \"OpenBed\""],
  ['the mark outside the link', (h) => h.replace(/(<img class="mark"[^>]*>)\s*/, '').replace('<a class="home-link"', '<img class="mark" alt="" /><a class="home-link"'), 'the mark is not inside the home link'],
  ['the lockup outside the link', (h) => h.replace(/(<span class="lockup">[\s\S]*?<\/span><\/span>)\s*<\/a>/, '</a>$1'), 'the lockup is not inside the home link'],
  ['the link outside the header', (h) => {
    const link = /<a class="home-link"[\s\S]*?<\/a>/.exec(h)?.[0];
    return link === undefined ? h : h.replace(link, '').replace('<header class="site-header">', `${link}<header class="site-header">`);
  }, 'the home link is not in the site header'],
  ['not class="home-link"', (h) => h.replace('<a class="home-link"', '<a class="home"'), 'is not class="home-link"'],
];

const CSS_PLANTS: [string, (c: string) => string, string][] = [
  ['no .home-link rule', (c) => c.replace(/[^{}]*\.home-link[^{}]*\{[^{}]*\}/g, ''), 'no rule names .home-link'],
  ['an underline on hover', (c) => `${c}\n.home-link:hover { text-decoration: underline; }`, 'sets text-decoration: underline'],
  ['a colour on hover', (c) => `${c}\n.home-link:hover { color: var(--ob-teal-700); }`, 'sets color: var(--ob-teal-700)'],
  ['a hover background', (c) => `${c}\n.site-header .home-link:hover { background: var(--ob-navy-50); }`, 'sets background'],
  ['its own focus ring', (c) => `${c}\n.home-link:focus-visible { outline: 3px solid red; }`, 'sets outline: 3px solid red'],
  // Aimed at the .home-link rule itself: the first 44px in the file is the emergency strip's.
  ['a 40px tap target', (c) => c.replace(/(\.home-link \{[^}]*min-height:\s*)44px/, '$140px'), ".home-link's min-height is 40px"],
  ['the underline back in one state', (c) => c.replace('.home-link:visited', '.home-link:target'), 'no rule gives .home-link:visited text-decoration: none'],
  ["the design system's focus ring rule gone", (c) => c.replace(FOCUS_RING, ''), "the design system's :focus-visible rule is not in the stylesheet"],
  ['a 1px focus ring', (c) => c.replace('--focus-ring-width:2px', '--focus-ring-width:1px'), '--focus-ring-width is "1px"'],
];

describe('the OpenBed logo links home, on /privacy and on the bed list (R-2026-09-28-159 EI)', () => {
  test('real built privacy page is accepted — one relative home link in the header holds the mark and the lockup, named "OpenBed home"', () => {
    const out = homeLinkViolations(parse(readBuilt(BUILT_PRIVACY)));
    expect(out, out.join('\n')).toEqual([]);
  });

  test('real bed list, rendered by src/main.ts over the built index.html, is accepted — the same one home link among every link it renders', async () => {
    const doc = await renderedIndex();
    const out = homeLinkViolations(doc);
    expect(out, `${out.join('\n')}\nlinks: ${Array.from(doc.querySelectorAll('a')).map((a) => a.getAttribute('href')).join(' ')}`).toEqual([]);
  });

  test("real built stylesheets are accepted — no underline, colour or hover effect on the link, at least 44px tall, and the design system's 2px teal ring at a 2px offset", () => {
    const files = headerCss();
    expect(files.length, 'the built CSS files drawing the header (the dashboard\'s and the notice\'s)').toBe(2);
    for (const f of files) {
      const out = homeLinkCssViolations(f.text);
      expect(out, `${f.path}\n${out.join('\n')}`).toEqual([]);
    }
  });

  test.each(['privacy.html', 'index.html'])('plant — built %s with the link removed from the header is rejected', (page) => {
    const real = readBuilt(join(DIST, page));
    const out = homeLinkViolations(parse(unlink(real)));
    expect(out.join('\n')).toContain('the page has 0 <a href="/">');
  });

  test.each(PAGE_PLANTS)('plant — the built privacy page with %s is rejected', (_what, plant, want) => {
    const real = readBuilt(BUILT_PRIVACY);
    const planted = plant(real);
    expect(planted, 'the plant did not change the page').not.toBe(real);
    const out = homeLinkViolations(parse(planted));
    expect(out.join('\n'), `violations: ${out.join(' | ')}`).toContain(want);
  });

  test.each(CSS_PLANTS)("plant — the built dashboard stylesheet with %s is rejected", (_what, plant, want) => {
    const real = (headerCss()[0] as { text: string }).text;
    const planted = plant(real);
    expect(planted, 'the plant did not change the stylesheet').not.toBe(real);
    const out = homeLinkCssViolations(planted);
    expect(out.join('\n'), `violations: ${out.join(' | ')}`).toContain(want);
  });

  test('real — the checker accepts the most ordinary home link: the mark and the lockup inside it, and nothing else', () => {
    const doc = parse('<header class="site-header"><a class="home-link" href="/" aria-label="OpenBed home"><img class="mark" alt="" /><span class="lockup"><span>Open</span><span>Bed</span></span></a></header>');
    expect(homeLinkViolations(doc)).toEqual([]);
  });

  test('anti-vacuity — checker over an empty corpus fails', () => {
    expect(homeLinkViolations(parse('')).join('\n')).toContain('the page has 0 <a href="/">');
    expect(homeLinkCssViolations('').join('\n')).toContain('no rule names .home-link');
  });
});
