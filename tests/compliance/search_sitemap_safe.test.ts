// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE SITEMAP LISTS INFORMATION PAGES AND NOTHING ELSE (R-2026-09-30-218 GQ-3 b).
 *
 * The kickoff forbade a sitemap that lists facility or ward contacts, because a named ward's duty number is an
 * obvious prank-call and harassment vector. A sitemap is emitted now (#134), approved by the founder on 2026-10-10
 * on the footing that it lists the guide and information pages only. tests/compliance/search_discovery.test.ts holds
 * the exact seven addresses; this file holds the PROPERTY the approval rests on, independently of that list, so that
 * adding an eighth address cannot also add a contact:
 *   - no address carries a query string or a fragment (a filter or a ward link);
 *   - no address, and no other text in the file, holds a facility id (a UUID);
 *   - no address, and no other text in the file, holds a phone number (a run of seven or more digits, with or
 *     without spaces, dashes, dots, a leading plus or brackets, and a tel: scheme);
 *   - no address is a data path (`/beds.json`, `/api/`), and every address is on the one origin.
 * The file read is the BUILT sitemap, apps/public-dashboard/dist/sitemap.xml (gitignored build output, so named without backticks).
 *
 * NOT ASSERTED HERE, deliberately: that the pages the sitemap lists are right, that a search engine reads the
 * file, or that a name in a page's path is not a hospital's (the seven paths are asserted by name in
 * search_discovery.test.ts). A hospital's NAME in a path would pass the id and number checks; the exact list is
 * what holds that.
 */

const SITEMAP = join(REPO_ROOT, 'apps', 'public-dashboard', 'dist', 'sitemap.xml');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Seven or more digits once the usual separators are dropped from a run of digit-like characters.
const NUMBERISH = /\+?\(?\d[\d\s().-]{5,}\d/g;

export function sitemapSafetyViolations(xml: string, origin = 'https://openbed.ng'): string[] {
  const out: string[] = [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') !== null) return ['the sitemap is not well-formed XML'];
  const locs = Array.from(doc.getElementsByTagName('loc')).map((l) => (l.textContent ?? '').trim());
  if (locs.length === 0) return ['the sitemap lists no address, so nothing was checked'];
  for (const loc of locs) {
    let url: URL;
    try {
      url = new URL(loc);
    } catch {
      out.push(`an address that is not a URL: ${loc}`);
      continue;
    }
    if (url.origin !== origin) out.push(`an address off the origin: ${loc}`);
    if (url.search !== '' || url.hash !== '' || loc.includes('?') || loc.includes('#')) out.push(`an address with a query string or fragment: ${loc}`);
    if (/^\/(beds\.json|api\/|facility|ward)/i.test(url.pathname)) out.push(`an address that is a data or record path: ${loc}`);
  }
  if (UUID.test(xml)) out.push('the sitemap holds a facility id (a UUID)');
  for (const run of xml.replace(/<\?xml[^>]*\?>/, '').replace(/xmlns="[^"]*"/g, '').match(NUMBERISH) ?? []) {
    if (run.replace(/\D/g, '').length >= 7) out.push(`the sitemap holds something shaped like a phone number: ${run.trim()}`);
  }
  if (/tel:|mailto:/i.test(xml)) out.push('the sitemap holds a tel: or mailto: address');
  return out;
}

const real = (): string => readFileSync(SITEMAP, 'utf8');
const swap = (xml: string, from: string, to: string): string => {
  const out = xml.replace(from, to);
  expect(out, `the plant did not land: "${from}" not found`).not.toBe(xml);
  return out;
};

describe('the built sitemap holds no facility id, phone number or query-string address', () => {
  test('real built sitemap is accepted', () => {
    expect(sitemapSafetyViolations(real())).toEqual([]);
  });

  test('anti-vacuity — an empty sitemap, one with no address, and one that is not XML all fail', () => {
    expect(sitemapSafetyViolations('')).not.toEqual([]);
    expect(sitemapSafetyViolations('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>')).toContain('the sitemap lists no address, so nothing was checked');
  });

  test('plant — a query-string address (a ward link) is rejected', () => {
    expect(sitemapSafetyViolations(swap(real(), '<loc>https://openbed.ng/about</loc>', '<loc>https://openbed.ng/?ward=maternity</loc>')).join('\n')).toContain('query string or fragment');
  });

  test('plant — a fragment address is rejected', () => {
    expect(sitemapSafetyViolations(swap(real(), '<loc>https://openbed.ng/about</loc>', '<loc>https://openbed.ng/about#contact</loc>')).join('\n')).toContain('query string or fragment');
  });

  test('plant — a facility id in an address is rejected', () => {
    const planted = swap(real(), '<loc>https://openbed.ng/about</loc>', '<loc>https://openbed.ng/facility/144cab4a-55af-4962-b2be-8c1003ece518</loc>');
    const text = sitemapSafetyViolations(planted).join('\n');
    expect(text).toContain('a facility id');
    expect(text).toContain('a data or record path');
  });

  test.each([
    ['a Lagos mobile number written with a plus', '+234 803 000 0000'],
    ['a national number written without spaces', '08030000000'],
    ['a number with dashes', '0803-000-0000'],
    ['a number with brackets and dots', '(0803) 000.0000'],
  ])('plant — %s inside an address is rejected', (_label, number) => {
    const planted = swap(real(), '<loc>https://openbed.ng/about</loc>', `<loc>https://openbed.ng/about/${number}</loc>`);
    expect(sitemapSafetyViolations(planted).join('\n')).toContain('shaped like a phone number');
  });

  test('plant — a phone number in a comment, outside any address, is rejected', () => {
    expect(sitemapSafetyViolations(swap(real(), '<urlset', '<!-- duty 08030000000 --><urlset')).join('\n')).toContain('shaped like a phone number');
  });

  test('plant — a tel: address and an address on another origin are each rejected', () => {
    expect(sitemapSafetyViolations(swap(real(), '<loc>https://openbed.ng/about</loc>', '<loc>tel:112</loc>')).join('\n')).toContain('tel: or mailto:');
    expect(sitemapSafetyViolations(swap(real(), '<loc>https://openbed.ng/about</loc>', '<loc>https://example.com/about</loc>')).join('\n')).toContain('off the origin');
  });

  test('plant — a data path address is rejected', () => {
    expect(sitemapSafetyViolations(swap(real(), '<loc>https://openbed.ng/about</loc>', '<loc>https://openbed.ng/beds.json</loc>')).join('\n')).toContain('a data or record path');
  });
});

/**
 * THE COMMENT IN index.html (GQ-3 a). The kickoff's rule and the sitemap's approved footing are written beside the robots tag, where the next
 * person to edit that file reads them. The two sentences below are asserted as they stand; a reworded comment is a deliberate edit here.
 */
const COMMENT_SENTENCES = [
  'it forbade a sitemap that lists facility or ward',
  'it lists only the guide and',
];
const INDEX_SOURCE = join(REPO_ROOT, 'apps', 'public-dashboard', 'index.html');
const flat = (t: string): string => t.replace(/\s+/g, ' ');

export function commentViolations(html: string): string[] {
  const text = flat(html);
  return COMMENT_SENTENCES.filter((sentence) => !text.includes(sentence)).map((sentence) => `index.html does not say: "${sentence}"`);
}

describe('index.html says why a sitemap exists and what it may list', () => {
  test('real index.html carries both sentences', () => {
    expect(commentViolations(readFileSync(INDEX_SOURCE, 'utf8'))).toEqual([]);
  });

  test.each(COMMENT_SENTENCES)('plant — an index.html without "%s" is rejected', (sentence) => {
    const real = readFileSync(INDEX_SOURCE, 'utf8');
    const planted = flat(real).replace(sentence, 'x');
    expect(planted, 'the plant did not land').not.toBe(flat(real));
    expect(commentViolations(planted)).toEqual([`index.html does not say: "${sentence}"`]);
  });

  test('anti-vacuity — an empty index.html fails both', () => {
    expect(commentViolations('')).toHaveLength(COMMENT_SENTENCES.length);
  });
});
