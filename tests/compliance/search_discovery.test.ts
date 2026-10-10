// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { HOME_URL } from '../../packages/origins/src/privacy.js';
import LABELS from '../../packages/labels/public-labels.json';
import CONTACTS from '../../packages/origins/contacts.json';
import type { Contacts } from '../../apps/public-dashboard/privacy-notice.js';
import { expectedBlocks, pageBlocks } from './_notice_text.js';
import { REPO_ROOT } from './_scratch.js';

// LIVE: checks the built informational pages and discovery files. Host deployment,
// Google indexing, ranking and actual hospital coverage are not asserted here.
const SLUGS = ['hospital-bed-availability-nigeria', 'hospital-bed-availability-lagos', 'icu-bed-availability-nigeria', 'hospital-bed-reporting'];
const PATHS = ['/', '/about', '/how-it-works', ...SLUGS.map((slug) => `/${slug}`)];
const dist = join(REPO_ROOT, 'apps/public-dashboard/dist');
const built = (file: string): string => readFileSync(join(dist, file), 'utf8');
const parse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

function guideViolations(slug: string, html: string): string[] {
  const doc = parse(html);
  const out: string[] = [];
  if (!doc.title.trim() || !doc.title.includes('Nigeria') && !doc.title.includes('Lagos')) out.push('missing geographic title');
  if (!doc.querySelector('meta[name="description"]')?.getAttribute('content')) out.push('missing description');
  const canonical = Array.from(doc.querySelectorAll('link[rel="canonical"]'));
  if (canonical.length !== 1 || canonical[0]?.getAttribute('href') !== new URL(`/${slug}`, HOME_URL).href) out.push('wrong canonical');
  if (doc.querySelector('meta[name="robots"]')?.getAttribute('content') !== 'index, follow') out.push('wrong robots');
  if (doc.querySelectorAll('main h1').length !== 1) out.push('missing unique heading');
  if (doc.querySelector('script') !== null) out.push('guide must work without JavaScript');
  const main = doc.querySelector('main');
  const source = readFileSync(join(REPO_ROOT, `docs/site/${slug}.md`), 'utf8');
  if (main === null || JSON.stringify(pageBlocks(main)) !== JSON.stringify(expectedBlocks(source, CONTACTS as unknown as Contacts))) out.push('source text differs');
  if (!doc.querySelector('a[href="/"]')) out.push('missing home link');
  for (const link of Array.from(doc.querySelectorAll('a[href]'))) {
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('tel:') || href.startsWith('mailto:')) continue;
    const url = new URL(href, HOME_URL);
    if (url.origin === new URL(HOME_URL).origin && ![...PATHS, '/privacy'].includes(url.pathname)) out.push(`unknown internal link: ${url.pathname}`);
  }
  return out;
}

function sitemapViolations(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const got = Array.from(doc.getElementsByTagName('loc')).map((loc) => loc.textContent);
  const expected = PATHS.map((path) => new URL(path, HOME_URL).href);
  return doc.querySelector('parsererror') !== null || JSON.stringify(got) !== JSON.stringify(expected) ? ['sitemap must contain exactly the seven public informational URLs'] : [];
}

describe('public search discovery', () => {
  test.each(SLUGS)('real — %s is complete in built HTML with a unique canonical and no script', (slug) => {
    expect(guideViolations(slug, built(`${slug}.html`))).toEqual([]);
  });
  test('plant — wrong text, an incorrect canonical and a script are each detected', () => {
    const slug = SLUGS[0] as string;
    const real = built(`${slug}.html`);
    const plants = [
      [real.replace('<h1>Hospital bed availability in Nigeria</h1>', '<h1>Wrong heading</h1>'), 'source text differs'],
      [real.replace(new URL(`/${slug}`, HOME_URL).href, new URL('/beds.json', HOME_URL).href), 'wrong canonical'],
      [real.replace('</body>', '<script src="/x.js"></script></body>'), 'guide must work without JavaScript'],
      [real.replace(/<title>[^<]*<\/title>/, '<title></title>'), 'missing geographic title'],
      [real.replace(/<meta name="description"[^>]*>/, ''), 'missing description'],
      [real.replace('content="index, follow"', 'content="noindex, nofollow"'), 'wrong robots'],
      [real.replace(/<h1>[^<]*<\/h1>/, ''), 'missing unique heading'],
      [real.replace('href="/"', 'href="/missing"'), 'missing home link'],
      [real.replace('href="/"', 'href="/missing"'), 'unknown internal link: /missing'],
    ];
    for (const [planted, message] of plants) {
      expect(planted, 'plant must change the built page').not.toBe(real);
      expect(guideViolations(slug, planted as string)).toContain(message);
    }
  });
  test('real — homepage discovery heading and guide links are outside the mutable results root', () => {
    const doc = parse(built('index.html'));
    const heading = doc.querySelector('h1');
    expect(heading?.textContent).toBe('Find hospital bed availability in Nigeria');
    expect(heading?.closest('#app')).toBeNull();
    expect(doc.title).toBe('Hospital Bed Availability in Nigeria | OpenBed');
    expect(doc.querySelector('meta[name="description"]')?.getAttribute('content')).toBeTruthy();
    for (const slug of SLUGS) expect(doc.querySelector(`a[href="/${slug}"]`), slug).not.toBeNull();
    expect(doc.querySelectorAll('#site-footer a')).toHaveLength(4);
  });
  test('real — the national guide links every actual ward filter, with no unsupported category', () => {
    const doc = parse(built('hospital-bed-availability-nigeria.html'));
    const codes = Array.from(doc.querySelectorAll('main a[href]')).flatMap((a) => {
      const ward = new URL(a.getAttribute('href') ?? '', HOME_URL).searchParams.get('ward');
      return ward === null ? [] : [ward];
    });
    // GQ-2 b (R-2026-09-30-218): the links carry the ONE lower-case slug the page writes. Until GQ this compared them with the enum's
    // upper-case keys, which pinned the very spelling the page's reader did not accept; search_deeplinks.test.ts parses each one.
    expect(codes.sort()).toEqual(Object.keys(LABELS.labels.ward_category).map((c) => c.toLowerCase()).sort());
  });
  test('real — sitemap lists informational URLs only, with no query strings or hospital records', () => {
    expect(sitemapViolations(built('sitemap.xml'))).toEqual([]);
  });
  test('plant — a bed snapshot substituted for an informational sitemap URL is rejected', () => {
    const real = built('sitemap.xml');
    const planted = real.replace('<loc>' + new URL('/about', HOME_URL).href + '</loc>', '<loc>' + new URL('/beds.json', HOME_URL).href + '</loc>');
    expect(planted).not.toBe(real);
    expect(sitemapViolations(planted)).not.toEqual([]);
  });
  test('anti-vacuity — empty discovery inputs fail', () => {
    expect(guideViolations(SLUGS[0] as string, '')).not.toEqual([]);
    expect(sitemapViolations('')).not.toEqual([]);
  });
});
