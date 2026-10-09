// @vitest-environment jsdom
/// <reference lib="dom" />
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { HOME_URL } from '../../packages/origins/src/privacy.js';
import { ATTRIBUTION_LINK_TEXT, ATTRIBUTION_PREFIX, LGA_ATTRIBUTION, LGA_POINTS, OSM_COPYRIGHT_URL } from '../../apps/public-dashboard/src/lga-points.js';
import POINTS from '../../packages/fixtures/lga-reference-points.json';
import { CURRENT_NOTICE } from './_notice_pins.js';
import { REPO_ROOT, withScratch, place } from './_scratch.js';

/**
 * THE STATIC CONTROLS OF THE SEARCH CHANGE (R-2026-10-09 GO): T-CAN-1, T-ATTR-1, T-LGA-1 and its sha leg, T-PRIV-1, and the licence line.
 *
 * Every control has its three legs, named as the conventions ask: PLANT (the false-green, rejected), ACCEPT (the real artefact,
 * accepted) and ANTI-VACUITY (an empty corpus fails). The LGA content plants are run against a TEMPORARY COPY of the points with the sha
 * leg left out, so the sha pin cannot be what rejects them; the sha leg has its own plant, one byte changed.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - that each of the 20 points lies INSIDE its own LGA's boundary and inside no other. That needs boundary polygons, which are not in
 *     this repository. Cowork checked all 20 against OpenStreetMap on 2026-10-09 (inside its own, inside no other, and a swapped
 *     latitude/longitude control fails), and the file's own `rule` field says so; the Lagos State box below is the part a test can hold;
 *   - that openbed.ng serves a canonical tag. That is the host's and the deployed page's: scripts/readback_pages.sh reads the pages, and
 *     the canonical tag is deliberately NOT the control that keeps search results out of an index: robots-public.txt is (its "Allow: /$"
 *     and "Disallow: /" keep any address with a query string out of a crawl, which is INFERRED from RFC 9309's matching rules and not
 *     observed on a crawler), and tests/compliance/search_visibility.test.ts pins that file.
 */

const DASH = join(REPO_ROOT, 'apps', 'public-dashboard');
const DIST = join(DASH, 'dist');

const built = (file: string): string => {
  const path = join(DIST, file);
  if (!existsSync(path)) throw new Error(`${path} does not exist: build the dashboard first (npm run build -w @openbed/public-dashboard). CI builds it in the same job.`);
  return readFileSync(path, 'utf8');
};

// ---------------------------------------------------------------------------
// T-CAN-1
// ---------------------------------------------------------------------------

/** Why a built page's canonical tags are not what the page must carry, or []. */
export function canonicalViolations(html: string, want: string | null): string[] {
  if (html.trim() === '') return ['the page is empty, so no canonical was checked'];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const links = Array.from(doc.querySelectorAll('link[rel="canonical"]'));
  const hrefs = links.map((l) => l.getAttribute('href'));
  if (want === null) return links.length === 0 ? [] : [`the page carries a canonical it must not: ${JSON.stringify(hrefs)}`];
  if (links.length === 0) return ['the page has no canonical'];
  if (links.length > 1) return [`the page has ${links.length} canonicals, it must have exactly one: ${JSON.stringify(hrefs)}`];
  return hrefs[0] === want ? [] : [`the canonical is ${JSON.stringify(hrefs[0])}, it must equal HOME_URL ${JSON.stringify(want)}`];
}

describe('T-CAN-1 — the home page names one canonical address, from the one constant', () => {
  test('real built index.html carries exactly one canonical, equal to HOME_URL, and the three other pages carry none', () => {
    expect(canonicalViolations(built('index.html'), HOME_URL)).toEqual([]);
    for (const f of ['privacy.html', 'about.html', 'how-it-works.html']) expect(canonicalViolations(built(f), null), f).toEqual([]);
  });

  test('HOME_URL is the home page, and it is typed once under apps/ and packages/', () => {
    expect(HOME_URL).toBe('https://openbed.ng/');
    const typed: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|html)$/.test(e.name) && readFileSync(p, 'utf8').split('\n').some((l) => /['"`]https:\/\/openbed\.ng\/['"`]/.test(l))) typed.push(p.slice(REPO_ROOT.length + 1));
      }
    };
    walk(join(REPO_ROOT, 'apps'));
    walk(join(REPO_ROOT, 'packages'));
    expect(typed, 'the home URL is typed somewhere other than packages/origins/src/privacy.ts').toEqual(['packages/origins/src/privacy.ts']);
  });

  test.each<[string, (h: string) => string, string]>([
    ['a second canonical', (h) => h.replace('</head>', '<link rel="canonical" href="https://openbed.ng/other" /></head>'), 'has 2 canonicals'],
    ['the wrong host', (h) => h.replace(`href="${HOME_URL}"`, 'href="https://example.com/"'), 'must equal HOME_URL'],
    ['no canonical at all', (h) => h.replace(/<link rel="canonical"[^>]*>/, ''), 'has no canonical'],
  ])('plant — %s is rejected', (_name, plant, message) => {
    const real = built('index.html');
    const planted = plant(real);
    expect(planted, 'the plant did not land').not.toBe(real);
    expect(canonicalViolations(planted, HOME_URL).join('\n')).toContain(message);
  });

  test('plant — a canonical on the privacy page is rejected', () => {
    const real = built('privacy.html');
    const planted = real.replace('</head>', `<link rel="canonical" href="${HOME_URL}" /></head>`);
    expect(planted).not.toBe(real);
    expect(canonicalViolations(planted, null).join('\n')).toContain('must not');
  });

  test('anti-vacuity — an empty page and an empty dist both fail', () => {
    expect(canonicalViolations('', HOME_URL)).toEqual(['the page is empty, so no canonical was checked']);
    withScratch((root) => {
      expect(() => readFileSync(join(root, 'dist', 'index.html'))).toThrow();
      expect(existsSync(join(root, 'dist'))).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// T-ATTR-1: three readers of one constant.
// ---------------------------------------------------------------------------

/** Why a chunk of HTML is not the ruled attribution, or []: the string, and the link's target. */
export function attributionViolations(html: string): string[] {
  if (html.trim() === '') return ['no markup, so no attribution was checked'];
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const text = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  if (!text.includes(LGA_ATTRIBUTION)) out.push(`the visible text does not hold "${LGA_ATTRIBUTION}"`);
  const links = Array.from(doc.querySelectorAll('a')).filter((a) => a.textContent === ATTRIBUTION_LINK_TEXT);
  if (links.length !== 1) out.push(`the "${ATTRIBUTION_LINK_TEXT}" part is not linked exactly once`);
  else if (links[0]?.getAttribute('href') !== OSM_COPYRIGHT_URL) out.push(`the link goes to ${JSON.stringify(links[0]?.getAttribute('href'))}, not ${OSM_COPYRIGHT_URL}`);
  return out;
}

describe('T-ATTR-1 — the attribution string and its link target, in each of the three places that read the constant', () => {
  const aboutBlock = (): string => /<p class="page-attribution">[\s\S]*?<\/p>/.exec(built('about.html'))?.[0] ?? '';

  test('the constant is the points file\'s own field, and splits into a plain prefix and a linked part with nothing lost', () => {
    expect(LGA_ATTRIBUTION).toBe(POINTS.attribution);
    expect(LGA_ATTRIBUTION).toBe('Area reference points © OpenStreetMap contributors');
    expect(`${ATTRIBUTION_PREFIX}${ATTRIBUTION_LINK_TEXT}`).toBe(LGA_ATTRIBUTION);
    expect(OSM_COPYRIGHT_URL).toBe('https://www.openstreetmap.org/copyright');
  });

  test('reader 1 — the built About page carries the string, with the "© OpenStreetMap contributors" part linked to the copyright page', () => {
    expect(aboutBlock(), 'About has no attribution block').not.toBe('');
    expect(attributionViolations(aboutBlock())).toEqual([]);
  });

  test('reader 2 — the points file itself carries the attribution field, which is the constant\'s one source', () => {
    const file = readFileSync(join(REPO_ROOT, 'packages', 'fixtures', 'lga-reference-points.json'), 'utf8');
    expect((JSON.parse(file) as { attribution: string }).attribution).toBe(LGA_ATTRIBUTION);
  });

  test('the About text itself carries no hand-typed copy of the string: it comes only from the build', () => {
    expect(readFileSync(join(REPO_ROOT, 'docs', 'site', 'about.md'), 'utf8')).not.toContain('OpenStreetMap');
  });

  // The home page's own reader is held in search_controls.test.ts (the rendered line under the picker); here its plants run on a
  // constructed copy of what it renders, through the same helper.
  const homeLine = `<p id="area-attribution" class="attribution">${ATTRIBUTION_PREFIX}<a href="${OSM_COPYRIGHT_URL}">${ATTRIBUTION_LINK_TEXT}</a></p>`;

  test('ACCEPT — the markup each reader produces passes the helper', () => {
    expect(attributionViolations(homeLine)).toEqual([]);
  });

  test.each<[string, string, (h: string) => string, string]>([
    ['the About block', 'about', (h) => h, ''],
    ['the home line', 'home', (h) => h, ''],
  ])('plant — removing the string, or the link, or changing its target, from %s is rejected', (_name, which) => {
    const real = which === 'about' ? aboutBlock() : homeLine;
    const removeLink = real.replace(/<a [^>]*>([^<]*)<\/a>/, '$1');
    const removeString = real.replace('OpenStreetMap', 'Open Street Map');
    const wrongTarget = real.replace(OSM_COPYRIGHT_URL, 'https://example.com/copyright');
    const empty = real.replace(/>[^<]*</, '><');
    for (const [label, planted, message] of [
      ['the link removed', removeLink, 'not linked exactly once'],
      ['the string changed', removeString, 'does not hold'],
      ['the target changed', wrongTarget, 'not https://www.openstreetmap.org/copyright'],
    ] as const) {
      expect(planted, `the plant "${label}" did not land`).not.toBe(real);
      expect(attributionViolations(planted).join('\n'), label).toContain(message);
    }
    void empty;
  });

  test('anti-vacuity — no markup fails', () => {
    expect(attributionViolations('')).toEqual(['no markup, so no attribution was checked']);
  });
});

// ---------------------------------------------------------------------------
// T-LGA-1
// ---------------------------------------------------------------------------

const DECLARED_SLUGS = [
  'agege', 'ajeromi-ifelodun', 'alimosho', 'amuwo-odofin', 'apapa', 'badagry', 'epe', 'eti-osa', 'ibeju-lekki', 'ifako-ijaiye',
  'ikeja', 'ikorodu', 'kosofe', 'lagos-island', 'lagos-mainland', 'mushin', 'ojo', 'oshodi-isolo', 'shomolu', 'surulere',
];
/** Lagos State's box, generously: north 6.9, south 6.2, west 2.6, east 4.4. A latitude/longitude pair swapped lands far outside it. */
const BOX = { lat: [6.2, 6.9], lng: [2.6, 4.4] } as const;
const PINNED_SHA256 = '390617bab88733a7eed5039473a0c04e6dbada109904a50d71f920dcf6aa5887';

interface PointsFile { attribution: string; points: { slug: string; label: string; lat: number; lng: number; osm_type?: string; osm_id?: number; boundary_relation?: number }[] }

/** What is wrong with a points file's CONTENT, as messages. The sha leg is separate and is not run here, so a content plant is caught by the content. */
export function lgaViolations(file: PointsFile): string[] {
  const out: string[] = [];
  if (!Array.isArray(file.points) || file.points.length === 0) return ['the file holds no points, so nothing was checked'];
  if (file.points.length !== 20) out.push(`the file holds ${file.points.length} points, it must hold 20`);
  const slugs = file.points.map((p) => p.slug);
  if (JSON.stringify([...slugs].sort()) !== JSON.stringify([...DECLARED_SLUGS].sort())) out.push(`the slugs are not the declared 20: ${JSON.stringify(slugs)}`);
  if (new Set(slugs).size !== slugs.length) out.push('a slug appears twice');
  const coords = file.points.map((p) => `${p.lat},${p.lng}`);
  if (new Set(coords).size !== coords.length) out.push('two LGAs share one coordinate pair');
  for (const p of file.points) {
    if (typeof p.lat !== 'number' || !Number.isFinite(p.lat) || typeof p.lng !== 'number' || !Number.isFinite(p.lng)) {
      out.push(`${p.slug}: a coordinate is not a finite number`);
      continue;
    }
    if (p.lat < BOX.lat[0] || p.lat > BOX.lat[1] || p.lng < BOX.lng[0] || p.lng > BOX.lng[1]) out.push(`${p.slug}: ${p.lat},${p.lng} is outside the Lagos State box`);
    if (typeof p.label !== 'string' || p.label.trim() === '') out.push(`${p.slug}: no label`);
    if (typeof p.osm_type !== 'string' || typeof p.osm_id !== 'number') out.push(`${p.slug}: no source (osm_type and osm_id)`);
  }
  return out;
}

/** The sha leg, apart from the content: the bytes must be the ones Cowork issued. */
export function lgaShaViolation(bytes: Buffer): string | null {
  const got = createHash('sha256').update(bytes).digest('hex');
  return got === PINNED_SHA256 ? null : `the points file is not the approved copy (sha256 ${got}): a paste error, never to be fixed by hand`;
}

const realBytes = (): Buffer => readFileSync(join(REPO_ROOT, 'packages', 'fixtures', 'lga-reference-points.json'));
const realFile = (): PointsFile => JSON.parse(realBytes().toString('utf8')) as PointsFile;
const clone = (): PointsFile => JSON.parse(JSON.stringify(realFile())) as PointsFile;

describe('T-LGA-1 — the 20 reference points: the declared names, inside Lagos, each with its source', () => {
  test('real points are accepted by the content leg', () => {
    expect(lgaViolations(realFile())).toEqual([]);
  });

  test('the points the page offers are exactly the file\'s, in its order, with no coordinate retyped anywhere under the page\'s source', () => {
    expect(LGA_POINTS.map((p) => p.slug)).toEqual(realFile().points.map((p) => p.slug));
    expect(LGA_POINTS.map((p) => [p.label, p.lat, p.lng])).toEqual(realFile().points.map((p) => [p.label, p.lat, p.lng]));
    const src = readdirSync(join(DASH, 'src')).filter((n) => n.endsWith('.ts')).map((n) => readFileSync(join(DASH, 'src', n), 'utf8')).join('\n');
    for (const p of realFile().points) {
      expect(src, `${p.slug}'s latitude is typed in the page's source`).not.toContain(String(p.lat));
      expect(src, `${p.slug}'s longitude is typed in the page's source`).not.toContain(String(p.lng));
    }
    expect(src, 'the points are imported from the fixture').toContain("../../../packages/fixtures/lga-reference-points.json");
  });

  test('the file states its rule, and the rule says the points are never centres and never Directions destinations', () => {
    const file = realFile() as unknown as { rule: string };
    expect(file.rule).toContain('never centres');
    expect(file.rule).toContain('never Directions destinations');
  });

  // Each CONTENT plant is run against a temporary copy of the points and the content leg only, so the sha leg cannot be what rejects it.
  test.each<[string, (f: PointsFile) => void, string]>([
    ['a swapped latitude and longitude', (f) => { const p = f.points[4] as PointsFile['points'][number]; [p.lat, p.lng] = [p.lng, p.lat]; }, 'outside the Lagos State box'],
    ['a 21st entry', (f) => { f.points.push({ slug: 'atlantis', label: 'Atlantis', lat: 6.5, lng: 3.4, osm_type: 'node', osm_id: 1 }); }, 'must hold 20'],
    ['a duplicate entry in place of another', (f) => { const first = f.points[0] as PointsFile['points'][number]; f.points[1] = { ...first }; }, 'a slug appears twice'],
    ['a point outside Lagos', (f) => { (f.points[6] as PointsFile['points'][number]).lng = 8.5; }, 'outside the Lagos State box'],
    ['a coordinate that is not a number', (f) => { (f.points[2] as unknown as { lat: string }).lat = 'six'; }, 'not a finite number'],
    ['a point with no source', (f) => { delete (f.points[3] as { osm_id?: number }).osm_id; }, 'no source'],
    ['a renamed LGA', (f) => { (f.points[7] as PointsFile['points'][number]).slug = 'victoria-island'; }, 'not the declared 20'],
    ['an empty label', (f) => { (f.points[8] as PointsFile['points'][number]).label = ' '; }, 'no label'],
  ])('plant — %s is rejected by the content leg alone', (_name, plant, message) => {
    withScratch((root) => {
      place(root, 'points.json', JSON.stringify(realFile()));
      const copy = JSON.parse(readFileSync(join(root, 'points.json'), 'utf8')) as PointsFile;
      plant(copy);
      expect(JSON.stringify(copy), 'the plant did not land').not.toBe(JSON.stringify(realFile()));
      expect(lgaViolations(copy).join('\n')).toContain(message);
    });
  });

  test('the sha leg — the real file is the approved copy, 4782 bytes ending in one newline', () => {
    expect(lgaShaViolation(realBytes())).toBeNull();
    expect(realBytes().length).toBe(4782);
    expect(realBytes().at(-1)).toBe(0x0a);
    expect(realBytes().at(-2)).not.toBe(0x0a);
  });

  test('plant — one byte changed in a copy fails the sha leg, and the content leg alone does NOT notice it (so the sha leg is not redundant)', () => {
    const bytes = Buffer.from(realBytes());
    const at = bytes.indexOf(Buffer.from('6.6252516'));
    expect(at, 'the plant target is not in the file').toBeGreaterThan(0);
    bytes[at + 6] = bytes[at + 6] === 0x35 ? 0x36 : 0x35;
    expect(Buffer.compare(bytes, realBytes()), 'the plant did not land').not.toBe(0);
    expect(lgaShaViolation(bytes)).toContain('not the approved copy');
    expect(lgaViolations(JSON.parse(bytes.toString('utf8')) as PointsFile), 'the content leg saw a one-digit change').toEqual([]);
  });

  test('anti-vacuity — a file with no points fails the content leg', () => {
    expect(lgaViolations({ attribution: 'x', points: [] })).toEqual(['the file holds no points, so nothing was checked']);
    expect(clone().points.length).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// T-PRIV-1, and the licence line.
// ---------------------------------------------------------------------------

/**
 * While the page can ask for a location, the notice must not say it never asks. Pure over the page's source and the notice, so the
 * plant can reinstate the old bullet. The two things it holds: the version 1.1 bullet is absent, and the notice names "Near me".
 */
export function noticeVsPageViolations(pageSource: string, notice: string): string[] {
  const out: string[] = [];
  const pageAsks = /geolocation/.test(pageSource.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n'));
  if (!pageAsks) return ['the page does not ask for a location, so this check has nothing to hold the notice against'];
  if (/does not ask for or record\s+\*\*your location\*\*/i.test(notice)) out.push('the notice still says OpenBed does not ask for your location, and the page can ask');
  if (!notice.includes('Near me')) out.push('the notice does not mention "Near me", the button that asks');
  if (!/does not receive or store your location/.test(notice)) out.push('the notice does not say OpenBed does not receive or store your location');
  return out;
}

describe('T-PRIV-1 — the notice no longer says "does not ask for your location" while the page can ask', () => {
  const pageSource = (): string => readFileSync(join(DASH, 'src', 'locate.ts'), 'utf8');
  const notice = (): string => readFileSync(join(REPO_ROOT, 'docs', 'legal', CURRENT_NOTICE.file), 'utf8');
  const oldBullet = (): string => readFileSync(join(REPO_ROOT, 'docs', 'legal', 'privacy-notice-v1.1.md'), 'utf8').split('\n').find((l) => l.includes('your location')) ?? '';

  test('real notice is accepted', () => {
    expect(noticeVsPageViolations(pageSource(), notice())).toEqual([]);
  });

  test('plant — the old bullet reinstated in place of the new one is rejected, on a temporary copy of the notice', () => {
    withScratch((root) => {
      const current = notice();
      const newBullet = current.split('\n').find((l) => l.includes('Near me')) as string;
      expect(newBullet, 'the new bullet is not in the notice').toBeTruthy();
      expect(oldBullet(), 'the old bullet is not in version 1.1').toContain('does not ask for or record');
      place(root, 'notice.md', current.replace(newBullet, oldBullet()));
      const planted = readFileSync(join(root, 'notice.md'), 'utf8');
      expect(planted, 'the plant did not land').not.toBe(current);
      const out = noticeVsPageViolations(pageSource(), planted).join('\n');
      expect(out).toContain('still says OpenBed does not ask for your location');
      expect(out).toContain('does not say OpenBed does not receive or store your location');
    });
  });

  test('plant — a notice that is silent about location altogether is rejected', () => {
    expect(noticeVsPageViolations(pageSource(), '# Notice\n\nNothing about it.\n').join('\n')).toContain('does not mention "Near me"');
  });

  test('anti-vacuity — over a page source that never asks, the check says it has nothing to hold the notice against', () => {
    expect(noticeVsPageViolations('export const x = 1;', notice())).toEqual(['the page does not ask for a location, so this check has nothing to hold the notice against']);
  });

  test('the About page makes the same statement, and no longer says it does not ask', () => {
    const about = readFileSync(join(REPO_ROOT, 'docs', 'site', 'about.md'), 'utf8');
    expect(about).toContain("- **Your location stays on your device.** It is used only if you tap 'Near me', to work out distances in your browser. OpenBed never receives or stores it.");
    expect(about).not.toContain('does not ask for your location');
    expect(about).toContain('- **It holds no patient information.** It does not ask for, record or show anything about patients.\n');
  });
});

describe('the licence line for the points file', () => {
  const LINE = "packages/fixtures/lga-reference-points.json is © OpenStreetMap contributors and is available under the Open Database Licence 1.0 (https://opendatacommons.org/licenses/odbl/1-0/). It is not covered by this repository's own licence.";
  test('the root README carries the licence line, once, word for word', () => {
    const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
    expect(readme.split(LINE).length - 1).toBe(1);
  });
  test('plant — a README without it is rejected, and the points file\'s own licence field names the same licence', () => {
    expect('# Readme\n'.includes(LINE)).toBe(false);
    expect(realFile() as unknown as { licence: string }).toMatchObject({ licence: expect.stringContaining('ODbL 1.0') as unknown as string });
  });
});

// ---------------------------------------------------------------------------
// The phrase table: every phrase is used, and every use names a phrase.
// ---------------------------------------------------------------------------

import TABLE from '../../packages/labels/public-labels.json';

/** Phrase keys named by `phrase('key'` (or by countSegments('key', ...), which says one through phrase()) in a body of source, comments excluded. */
export function phraseUses(source: string): string[] {
  const code = source.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  return [...code.matchAll(/\b(?:phrase|countSegments)\(\s*'([a-z_]+)'/g)].map((m) => m[1] as string);
}

/** Why the table and its uses disagree, or []. */
export function phraseViolations(keys: string[], uses: string[]): string[] {
  const out: string[] = [];
  if (keys.length === 0) return ['the phrase table is empty, so nothing was checked'];
  for (const k of keys) if (!uses.includes(k)) out.push(`phrase ${k} is in the table and nothing says it`);
  for (const u of new Set(uses)) if (!keys.includes(u)) out.push(`the page says phrase ${u}, which the table does not hold`);
  return out;
}

describe('the public phrase table (GO-4 e) — every phrase is spoken somewhere, and every spoken phrase is in the table', () => {
  const sources = (): string => readdirSync(join(DASH, 'src')).filter((n) => n.endsWith('.ts')).map((n) => readFileSync(join(DASH, 'src', n), 'utf8')).join('\n');
  const keys = (): string[] => Object.keys((TABLE as unknown as { phrases: Record<string, string> }).phrases);

  test('real — no dead phrase and no phrase the table lacks', () => {
    expect(phraseViolations(keys(), phraseUses(sources()))).toEqual([]);
  });

  test('plant — a phrase nothing says, and a use of a phrase the table lacks, are each named', () => {
    expect(phraseViolations([...keys(), 'never_spoken'], phraseUses(sources())).join('\n')).toContain('never_spoken is in the table and nothing says it');
    expect(phraseViolations(keys(), [...phraseUses(sources()), 'typo_key']).join('\n')).toContain('typo_key, which the table does not hold');
  });

  test('anti-vacuity — an empty table fails, and a comment quoting phrase() is not a use', () => {
    expect(phraseViolations([], ['a'])).toEqual(['the phrase table is empty, so nothing was checked']);
    expect(phraseUses("// phrase('ghost')\n * phrase('ghost2')\n")).toEqual([]);
    expect(phraseUses("phrase('coverage', { n: '1' })")).toEqual(['coverage']);
  });

  test('every phrase slot name in the table is lower case letters, so the strict filler\'s pattern reads every one', () => {
    for (const [k, v] of Object.entries((TABLE as unknown as { phrases: Record<string, string> }).phrases)) {
      const braces = v.match(/\{[^}]*\}/g) ?? [];
      for (const b of braces) expect(b, `${k} has a slot the filler cannot read`).toMatch(/^\{[a-z]+\}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// The stylesheet: a control the script hides with `hidden` must really be hidden.
// ---------------------------------------------------------------------------

/**
 * A rule that sets `display` on a class outranks the user agent's own `[hidden] { display: none }`, so an element the script hides with the
 * `hidden` attribute can stay on screen. That happened in the first screenshot pass (the no-match message and its "Clear search" button were
 * visible all the time), and jsdom, which lays nothing out, could not see it. What a test can hold is that the stylesheet carries the rule
 * that makes `hidden` win inside the controls, and that it is marked !important so no later display rule outranks it.
 */
export function hiddenWinsViolations(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  if (bare.trim() === '') return ['the stylesheet is empty, so nothing was checked'];
  const rule = /#search\s+\[hidden\]\s*\{([^}]*)\}/.exec(bare)?.[1] ?? '';
  const out: string[] = [];
  if (!/display\s*:\s*none\s*!important/.test(rule)) out.push('the controls\' stylesheet has no `#search [hidden] { display: none !important }`, so a `display` rule can show a hidden control');
  return out;
}

describe('the controls\' stylesheet makes `hidden` win', () => {
  const css = (): string => readFileSync(join(DASH, 'src', 'style.css'), 'utf8');
  test('real style.css is accepted', () => {
    expect(hiddenWinsViolations(css())).toEqual([]);
  });
  test('plant — the rule removed, or without !important, is rejected', () => {
    const real = css();
    const removed = real.replace('#search [hidden] { display: none !important; }', '');
    expect(removed, 'the plant did not land').not.toBe(real);
    expect(hiddenWinsViolations(removed).join('\n')).toContain('no `#search [hidden]');
    expect(hiddenWinsViolations(real.replace('display: none !important', 'display: none')).join('\n')).toContain('no `#search [hidden]');
  });
  test('anti-vacuity — an empty stylesheet fails', () => {
    expect(hiddenWinsViolations('')).toEqual(['the stylesheet is empty, so nothing was checked']);
  });
});
