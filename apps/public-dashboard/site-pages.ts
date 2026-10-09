/**
 * THE STATIC PAGES' BUILD-TIME PIECES (R-2026-09-30-190 FN-2, FN-3).
 *
 * vite.config.ts writes five things into the HTML entries at build time, all of them
 * from this file or the tracked sources it names, because the pages ship no script:
 *   - the page text, rendered from a markdown source by privacy-notice.ts's renderer;
 *   - the static footer of About and How-it-works (siteFooter), whose links are the
 *     constants in packages/origins/src/privacy.ts and whose address is read from
 *     packages/origins/contacts.json, the way the home page's footer reads it;
 *   - the meta robots tag of index.html, about.html and how-it-works.html, from
 *     packages/origins/src/search.ts;
 *   - the canonical link of index.html alone, from HOME_URL in packages/origins/src/privacy.ts
 *     (R-2026-10-09 GO, E);
 *   - the attribution of the area reference points on about.html alone, from the one constant in
 *     src/lga-points.ts (R-2026-10-09 GO, GO-2 e).
 * privacy.html takes only the first: its meta robots stays static and noindex.
 * Pure: no file, no clock, no environment.
 */
import { ABOUT_URL, HOME_URL, HOW_IT_WORKS_URL, PRIVACY_NOTICE_URL } from '../../packages/origins/src/privacy.js';
import { robotsMetaContent, type SearchVisibility } from '../../packages/origins/src/search.js';
import { ATTRIBUTION_LINK_TEXT, ATTRIBUTION_PREFIX, OSM_COPYRIGHT_URL } from './src/lga-points.js';
import type { Contacts } from './privacy-notice.js';

export const NOTICE_PLACEHOLDER = '<!-- @PRIVACY_NOTICE@ -->';
export const FOOTER_PLACEHOLDER = '<!-- @SITE_FOOTER@ -->';
export const ROBOTS_PLACEHOLDER = '<!-- @ROBOTS_META@ -->';
export const CANONICAL_PLACEHOLDER = '<!-- @CANONICAL_LINK@ -->';
export const ATTRIBUTION_PLACEHOLDER = '<!-- @ATTRIBUTION@ -->';

export interface PageConfig {
  /** Repo-relative markdown source, or null for a page that carries no rendered text. */
  readonly source: string | null;
  /** The name a renderer refusal carries. */
  readonly name: string;
  readonly footer: boolean;
  /** True where the setting decides the meta robots tag; privacy.html is always noindex. */
  readonly robotsFromSetting: boolean;
  /** True for the one page that names its own canonical address: the home page. */
  readonly canonical: boolean;
  /** True for the one static page that carries the area reference points' attribution: About. */
  readonly attribution: boolean;
}

/** Keyed by the entry's file name. */
export const PAGES: Readonly<Record<string, PageConfig>> = {
  'index.html': { source: null, name: 'home page', footer: false, robotsFromSetting: true, canonical: true, attribution: false },
  'privacy.html': { source: 'docs/legal/privacy-notice-v1.2.md', name: 'privacy notice', footer: false, robotsFromSetting: false, canonical: false, attribution: false },
  'about.html': { source: 'docs/site/about.md', name: 'about page', footer: true, robotsFromSetting: true, canonical: false, attribution: true },
  'how-it-works.html': { source: 'docs/site/how-it-works.md', name: 'how-it-works page', footer: true, robotsFromSetting: true, canonical: false, attribution: false },
};

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The canonical link: the home page's one address, from the constant. */
export function canonicalLink(): string {
  return `<link rel="canonical" href="${escapeHtml(HOME_URL)}" />`;
}

/** The attribution paragraph: the constant's text, its "© OpenStreetMap contributors" part linked. */
export function attributionBlock(): string {
  return `<p class="page-attribution">${escapeHtml(ATTRIBUTION_PREFIX)}<a href="${escapeHtml(OSM_COPYRIGHT_URL)}">${escapeHtml(ATTRIBUTION_LINK_TEXT)}</a></p>`;
}

/** The static footer: the hello address, then About, How it works, Privacy notice. */
export function siteFooter(contacts: Contacts): string {
  const hello = contacts.hello;
  const address = typeof hello === 'object' && hello !== null ? hello.address : undefined;
  if (typeof address !== 'string') throw new Error('site footer: contacts.json has no hello address');
  return (
    '<footer id="site-footer">' +
    `<a href="mailto:${address}">${address}</a>` +
    `<a href="${ABOUT_URL}">About</a>` +
    `<a href="${HOW_IT_WORKS_URL}">How it works</a>` +
    `<a href="${PRIVACY_NOTICE_URL}">Privacy notice</a>` +
    '</footer>'
  );
}

/**
 * One placeholder, exactly, in each page that is meant to have it, and none in any other.
 * A page that names a placeholder it is not configured for, or lacks one it is, stops
 * the build.
 */
function expectPlaceholder(file: string, html: string, placeholder: string, wanted: boolean, what: string): void {
  const n = count(html, placeholder);
  if (wanted && n !== 1) throw new Error(`${file}: expected exactly one ${what} placeholder, found ${n}`);
  if (!wanted && n !== 0) throw new Error(`${file}: the ${what} placeholder does not belong in this page`);
}

export interface BuildInputs {
  readonly markdown: (repoPath: string) => string;
  readonly contacts: Contacts;
  readonly visibility: SearchVisibility;
  readonly render: (markdown: string, contacts: Contacts, name: string) => string;
}

/** The HTML entry `file` (its base name) with every placeholder filled. */
export function fillPage(file: string, html: string, inputs: BuildInputs): string {
  const page = PAGES[file];
  if (page === undefined) {
    for (const [ph, what] of [
      [NOTICE_PLACEHOLDER, 'page-text'],
      [FOOTER_PLACEHOLDER, 'footer'],
      [ROBOTS_PLACEHOLDER, 'robots'],
      [CANONICAL_PLACEHOLDER, 'canonical'],
      [ATTRIBUTION_PLACEHOLDER, 'attribution'],
    ] as const) {
      expectPlaceholder(file, html, ph, false, what);
    }
    return html;
  }
  expectPlaceholder(file, html, NOTICE_PLACEHOLDER, page.source !== null, 'page-text');
  expectPlaceholder(file, html, FOOTER_PLACEHOLDER, page.footer, 'footer');
  expectPlaceholder(file, html, ROBOTS_PLACEHOLDER, page.robotsFromSetting, 'robots');
  expectPlaceholder(file, html, CANONICAL_PLACEHOLDER, page.canonical, 'canonical');
  expectPlaceholder(file, html, ATTRIBUTION_PLACEHOLDER, page.attribution, 'attribution');
  let out = html;
  if (page.source !== null) {
    const text = inputs.render(inputs.markdown(page.source), inputs.contacts, page.name);
    out = out.replace(NOTICE_PLACEHOLDER, () => text);
  }
  if (page.footer) out = out.replace(FOOTER_PLACEHOLDER, () => siteFooter(inputs.contacts));
  if (page.canonical) out = out.replace(CANONICAL_PLACEHOLDER, () => canonicalLink());
  if (page.attribution) out = out.replace(ATTRIBUTION_PLACEHOLDER, () => attributionBlock());
  if (page.robotsFromSetting) {
    const meta = `<meta name="robots" content="${robotsMetaContent(inputs.visibility)}" />`;
    out = out.replace(ROBOTS_PLACEHOLDER, () => meta);
  }
  return out;
}
