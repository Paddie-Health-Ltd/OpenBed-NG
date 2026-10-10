// @vitest-environment jsdom
/// <reference lib="dom" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import LABELS from '../../packages/labels/public-labels.json';
import LGA from '../../packages/fixtures/lga-reference-points.json';
import { HOME_URL } from '../../packages/origins/src/privacy.js';
import { parseSearch, wardSlug, WARD_VALUES } from '../../apps/public-dashboard/src/search.js';
import { REPO_ROOT } from './_scratch.js';

/**
 * EVERY DEEP LINK ON THE OPENBED GUIDE PAGES LANDS ON THE SEARCH IT NAMES (R-2026-09-30-218 GQ-2 c).
 *
 * THE DEFECT, root cause. #134 added four guide pages whose tables link `https://openbed.ng/?ward=A_AND_E`,
 * `?ward=ICU_ADULT` and eight more in UPPER case, while the page's address reader looked a ward up in a table of
 * lower-case spellings. Every one of those ten links opened the page with NO ward chosen, silently. A test of #134's
 * own checked the links against the enum's keys and so pinned the upper case. This file reads each link the way
 * a visitor's browser hands it to the page, through the page's own `parseSearch`, and compares the result with
 * the search the link's own words name.
 *
 * THE CORPUS IS THE PAGES, NOT A LIST OF THIS FILE'S OWN (test-conventions section 3). Two corpora, each discovered:
 *   - every `docs/site/*.md` file, link by link;
 *   - every .html file in apps/public-dashboard/dist (the build output, gitignored, so named here without backticks), the BUILT pages, read with a DOM parser.
 * A link counts when it is on the openbed.ng origin and carries a query string.
 *
 * WHAT A LINK MUST DO:
 *   1. name a search in its words: a table row's "OpenBed category" cell, else the link's own text, must name exactly
 *      one ward category (by its label in packages/labels/public-labels.json); or the link text must start with an
 *      LGA's label (packages/fixtures/lga-reference-points.json);
 *   2. carry that search in its address in the ONE spelling the page writes: the lower-case ward slug or area slug
 *      (so a share link and a guide link are the same string);
 *   3. parse, through the real `parseSearch`, to a ward or an area that is not the default and is the one named.
 * The declared matrix: across the markdown, every one of the ten ward categories and every one of the twenty areas is
 * linked, and the set of wards and areas found equals that matrix by identity, so a guide that loses a link or
 * gains an unknown one is a red test.
 *
 * NOT ASSERTED HERE, deliberately: that the guide's words are right about the wards, that a link resolves to
 * hospitals (a ward with no hospital reporting it shows the ordinary empty state), or what a search engine
 * does with a link. Nothing here crawls.
 */

type Parse = (search: string) => { ward: string; area: string | null };

interface DeepLink {
  readonly where: string;
  readonly href: string;
  readonly text: string;
  /** The "OpenBed category" cell of the table row the link is in, or null outside a table. */
  readonly cell: string | null;
}

const ORIGIN = new URL(HOME_URL).origin;
const LABEL_BY_WARD = LABELS.labels.ward_category as Record<string, string>;
const AREA_LABELS = LGA.points.map((p) => ({ slug: p.slug, label: p.label }));

const DOCS = join(REPO_ROOT, 'docs', 'site');
const DIST = join(REPO_ROOT, 'apps', 'public-dashboard', 'dist');

/** The pages as markdown: one DeepLink per `[text](url)` on the openbed.ng origin with a query string. */
export function markdownLinks(file: string, md: string): DeepLink[] {
  const out: DeepLink[] = [];
  for (const line of md.split('\n')) {
    const cells = line.startsWith('|') ? line.split('|').map((c) => c.trim()) : null;
    for (const m of line.matchAll(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g)) {
      let url: URL;
      try {
        url = new URL(m[2] as string);
      } catch {
        continue;
      }
      if (url.origin === ORIGIN && url.search !== '') out.push({ where: file, href: m[2] as string, text: m[1] as string, cell: cells === null ? null : (cells[2] ?? null) });
    }
  }
  return out;
}

/** The built pages: one DeepLink per anchor on the origin with a query string. */
export function htmlLinks(file: string, html: string): DeepLink[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: DeepLink[] = [];
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    let url: URL;
    try {
      url = new URL(href, HOME_URL);
    } catch {
      continue;
    }
    if (url.origin !== ORIGIN || url.search === '') continue;
    const tr = a.closest('tr');
    out.push({ where: file, href, text: a.textContent ?? '', cell: tr === null ? null : (tr.querySelectorAll('td')[1]?.textContent?.trim() ?? null) });
  }
  return out;
}

/** The ward category the words name: the label equals the table cell, else exactly one label is inside the link text. */
function wardNamed(link: DeepLink): string | null {
  if (link.cell !== null) {
    const hit = Object.entries(LABEL_BY_WARD).filter(([, label]) => label === link.cell);
    return hit.length === 1 ? (hit[0] as [string, string])[0] : null;
  }
  const hit = Object.entries(LABEL_BY_WARD).filter(([, label]) => link.text.includes(label));
  return hit.length === 1 ? (hit[0] as [string, string])[0] : null;
}

/** The area the words name: the LGA whose label is the first words of the link text, the longest such label. */
function areaNamed(link: DeepLink): string | null {
  const hit = AREA_LABELS.filter((a) => link.text === a.label || link.text.startsWith(`${a.label} `)).sort((a, b) => b.label.length - a.label.length);
  return hit[0]?.slug ?? null;
}

export interface Found {
  readonly wards: Set<string>;
  readonly areas: Set<string>;
}

/** Every violation, and the wards and areas the links named. `parse` is the seam a plant reverts the fix through. */
export function deepLinkViolations(links: readonly DeepLink[], parse: Parse = parseSearch): { violations: string[]; found: Found } {
  const violations: string[] = [];
  const found: Found = { wards: new Set(), areas: new Set() };
  if (links.length === 0) return { violations: ['no deep link was found, so nothing was checked'], found };
  for (const link of links) {
    const id = `${link.where}: [${link.text}](${link.href})`;
    const params = new URL(link.href, HOME_URL).searchParams;
    const keys = [...params.keys()].sort().join(',');
    if (keys !== 'ward' && keys !== 'area') {
      violations.push(`${id}: carries ${keys === '' ? 'no key' : `the key(s) ${keys}`}, and a deep link carries exactly one of ward or area`);
      continue;
    }
    const got = parse(new URL(link.href, HOME_URL).search);
    if (keys === 'ward') {
      const named = wardNamed(link);
      if (named === null) {
        violations.push(`${id}: its words name no single ward category`);
        continue;
      }
      found.wards.add(named);
      if (params.get('ward') !== wardSlug(named)) violations.push(`${id}: the address spells the ward "${params.get('ward')}", not the one lower-case slug "${wardSlug(named)}"`);
      if (got.ward === 'any') violations.push(`${id}: parses to the default ("any"), so the link opens no ward`);
      else if (got.ward !== named) violations.push(`${id}: parses to ${got.ward}, but its words name ${named}`);
    } else {
      const named = areaNamed(link);
      if (named === null) {
        violations.push(`${id}: its text starts with no LGA's label`);
        continue;
      }
      found.areas.add(named);
      if (params.get('area') !== named) violations.push(`${id}: the address spells the area "${params.get('area')}", not the one slug "${named}"`);
      if (got.area === null) violations.push(`${id}: parses to no area, so the link opens no area`);
      else if (got.area !== named) violations.push(`${id}: parses to ${got.area}, but its words name ${named}`);
    }
  }
  return { violations, found };
}

/** The parser as it stood before GQ: an exact, lower-case lookup. Used ONLY to revert the fix in a plant. */
const legacyParse: Parse = (search) => {
  const params = new URLSearchParams(search);
  const ward = params.get('ward');
  const area = params.get('area');
  const bySlug = new Map(WARD_VALUES.map((c) => [wardSlug(c), c]));
  const slugs = new Set(AREA_LABELS.map((a) => a.slug));
  return { ward: ward !== null && ward.length <= 40 ? (bySlug.get(ward) ?? 'any') : 'any', area: area !== null && slugs.has(area) ? area : null };
};

const mdFiles = (): string[] => readdirSync(DOCS).filter((n) => n.endsWith('.md')).sort();
const htmlFiles = (): string[] => readdirSync(DIST).filter((n) => n.endsWith('.html')).sort();
const allMarkdown = (): DeepLink[] => mdFiles().flatMap((f) => markdownLinks(`docs/site/${f}`, readFileSync(join(DOCS, f), 'utf8')));
const allHtml = (): DeepLink[] => htmlFiles().flatMap((f) => htmlLinks(`dist/${f}`, readFileSync(join(DIST, f), 'utf8')));

const ALL_WARDS = Object.keys(LABEL_BY_WARD).sort();
const ALL_AREAS = AREA_LABELS.map((a) => a.slug).sort();

/** A base for the plants: the national guide's source with the maternity row, as a one-file corpus. */
const nationalMd = (): string => readFileSync(join(DOCS, 'hospital-bed-availability-nigeria.md'), 'utf8');
const lagosMd = (): string => readFileSync(join(DOCS, 'hospital-bed-availability-lagos.md'), 'utf8');

describe('every deep link in docs/site lands on the search its words name', () => {
  test('anti-vacuity — the corpus is discovered, not empty, and covers every ward category and every area by identity', () => {
    expect(mdFiles().length, 'no markdown page was found under docs/site').toBeGreaterThan(0);
    const { violations, found } = deepLinkViolations(allMarkdown());
    expect(violations).toEqual([]);
    expect([...found.wards].sort(), 'the markdown links do not cover exactly the ten ward categories').toEqual(ALL_WARDS);
    expect([...found.areas].sort(), 'the markdown links do not cover exactly the twenty areas').toEqual(ALL_AREAS);
  });

  test('anti-vacuity — a checker given no links fails', () => {
    expect(deepLinkViolations([]).violations).toEqual(['no deep link was found, so nothing was checked']);
  });

  test('plant — an upper-case ward link, with the parser fix reverted, is rejected as opening no ward', () => {
    const planted = nationalMd().replace('?ward=maternity', '?ward=MATERNITY');
    expect(planted, 'the plant did not land').not.toBe(nationalMd());
    const { violations } = deepLinkViolations(markdownLinks('planted.md', planted), legacyParse);
    expect(violations.join('\n')).toContain('parses to the default ("any"), so the link opens no ward');
  });

  test('plant — an upper-case ward link is rejected even with the fixed parser, because the guides use the one lower-case slug', () => {
    const planted = nationalMd().replace('?ward=maternity', '?ward=MATERNITY');
    const { violations } = deepLinkViolations(markdownLinks('planted.md', planted));
    expect(violations.join('\n')).toContain('the address spells the ward "MATERNITY", not the one lower-case slug "maternity"');
  });

  test('plant — a link to a ward that does not exist is rejected', () => {
    const planted = nationalMd().replace('?ward=maternity', '?ward=burns_unit');
    expect(planted).not.toBe(nationalMd());
    const { violations } = deepLinkViolations(markdownLinks('planted.md', planted));
    const text = violations.join('\n');
    expect(text).toContain('parses to the default ("any"), so the link opens no ward');
    expect(text).toContain('not the one lower-case slug "maternity"');
  });

  test('plant — a link whose address names a different ward from its words is rejected', () => {
    const planted = nationalMd().replace('?ward=maternity', '?ward=nicu');
    expect(planted).not.toBe(nationalMd());
    expect(deepLinkViolations(markdownLinks('planted.md', planted)).violations.join('\n')).toContain('parses to NICU, but its words name MATERNITY');
  });

  test('plant — an area link whose address names a different area from its text is rejected, and a non-existent area is rejected', () => {
    const different = lagosMd().replace('?area=apapa', '?area=ikeja');
    expect(different).not.toBe(lagosMd());
    expect(deepLinkViolations(markdownLinks('planted.md', different)).violations.join('\n')).toContain('parses to ikeja, but its words name apapa');
    const missing = lagosMd().replace('?area=apapa', '?area=atlantis');
    expect(missing).not.toBe(lagosMd());
    expect(deepLinkViolations(markdownLinks('planted.md', missing)).violations.join('\n')).toContain('parses to no area, so the link opens no area');
  });

  test('plant — a link carrying both keys, or a key this page does not read, is rejected', () => {
    const both = nationalMd().replace('?ward=maternity', '?ward=maternity&area=ikeja');
    expect(deepLinkViolations(markdownLinks('planted.md', both)).violations.join('\n')).toContain('exactly one of ward or area');
    const other = nationalMd().replace('?ward=maternity', '?lat=6.5&ward=maternity');
    expect(deepLinkViolations(markdownLinks('planted.md', other)).violations.join('\n')).toContain('exactly one of ward or area');
  });
});

describe('every deep link in the BUILT pages lands on the search its words name', () => {
  test('anti-vacuity — the built pages exist and hold deep links: a missing build fails here, loudly', () => {
    expect(htmlFiles().length, `no built page under ${DIST}: run the build first`).toBeGreaterThan(0);
    expect(allHtml().length, 'no deep link in any built page').toBeGreaterThan(0);
  });

  test('real built pages are accepted, and they link every ward category and every area', () => {
    const { violations, found } = deepLinkViolations(allHtml());
    expect(violations).toEqual([]);
    expect([...found.wards].sort()).toEqual(ALL_WARDS);
    expect([...found.areas].sort()).toEqual(ALL_AREAS);
  });

  test('plant — an upper-case link in a built page, with the parser fix reverted, is rejected', () => {
    const real = readFileSync(join(DIST, 'hospital-bed-availability-nigeria.html'), 'utf8');
    const planted = real.replace('?ward=maternity', '?ward=MATERNITY');
    expect(planted, 'the plant did not land').not.toBe(real);
    const { violations } = deepLinkViolations(htmlLinks('planted.html', planted), legacyParse);
    expect(violations.join('\n')).toContain('parses to the default ("any"), so the link opens no ward');
  });

  test('plant — a link to a ward that does not exist in a built page is rejected', () => {
    const real = readFileSync(join(DIST, 'icu-bed-availability-nigeria.html'), 'utf8');
    const planted = real.replace('?ward=nicu', '?ward=burns_unit');
    expect(planted).not.toBe(real);
    expect(deepLinkViolations(htmlLinks('planted.html', planted)).violations.join('\n')).toContain('parses to the default ("any"), so the link opens no ward');
  });
});
