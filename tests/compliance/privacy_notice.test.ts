// @vitest-environment jsdom
/// <reference lib="dom" />
// DOM TYPES FOR THIS FILE ONLY (see tests/compliance/dashboard_empty_state.test.ts for
// why the root tsconfig carries no DOM).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { renderNotice, type Contacts } from '../../apps/public-dashboard/privacy-notice.js';
import CONTACTS from '../../packages/origins/contacts.json';
import { hasViewport, VIEWPORT_CONTENT } from './_design.js';
import { expectedBlocks, pageBlocks, squash } from './_notice_text.js';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE PAGE AT /privacy IS THE APPROVED NOTICE, WORD FOR WORD (R-2026-09-26-136 DL-1 c;
 * version 1.1 since R-2026-09-28-155 EE-2 and R-2026-09-28-156 EF-1).
 *
 * docs/legal/privacy-notice-v1.1.md is the single source. The founder approved it on
 * 2026-09-28, and Cowork handed it over as a file with its sha256, so the first leg pins
 * that hash: the file cannot be "fixed" by hand without this going red. Version 1.0 stays
 * in the repository as the prior version, unchanged, and its own hash is pinned too: a
 * published version is never edited, a change is a new file.
 *
 * THE BUILT PAGE IS READ, NOT THE RENDERER'S RETURN VALUE. The renderer
 * (apps/public-dashboard/privacy-notice.ts) runs inside the Vite build; a test over its
 * return value would pass while a build step dropped, doubled or re-ordered what it
 * produced. So this reads apps/public-dashboard/dist/privacy.html -- the file Pages
 * serves -- parses it, and compares its text, block by block, against the SOURCE FILE
 * REDUCED TO TEXT BY A SEPARATE, DELIBERATELY SIMPLER METHOD in this file
 * (expectedBlocks). Two derivations that share no code: if the renderer drops a word,
 * re-orders a cell or invents one, the two sides disagree.
 *
 * WITH THE contacts.json SUBSTITUTIONS. Every openbed.ng address on the page is
 * contacts.json's value for the address's local part, so the expected text applies
 * the same lookup. The plant that changes contacts.json's hello address and expects the
 * unchanged page to go red is what shows the page's addresses are compared against
 * contacts.json and not merely against the markdown.
 *
 * The compliance-tests job runs `npm run build` before the guards (.github/workflows/
 * ci.yml), so the built page exists in CI (test-conventions section 8, "a generated
 * corpus must be generated in the same job"). The anti-vacuity leg is what says so if
 * that ever stops being true.
 *
 * NOT ASSERTED HERE, deliberately: that Cloudflare Pages SERVES privacy.html at
 * /privacy -- a property of the host, not of this repository. scripts/readback_pages.sh
 * reads it on the deployment and on openbed.ng after the founder's deploy (DL-1 e).
 */

const SOURCE = join(REPO_ROOT, 'docs', 'legal', 'privacy-notice-v1.1.md');
const PRIOR = join(REPO_ROOT, 'docs', 'legal', 'privacy-notice-v1.0.md');
const BUILT = join(REPO_ROOT, 'apps', 'public-dashboard', 'dist', 'privacy.html');
const PAGE_SOURCE = join(REPO_ROOT, 'apps', 'public-dashboard', 'privacy.html');
const INDEX_SOURCE = join(REPO_ROOT, 'apps', 'public-dashboard', 'index.html');
/** Issued with the file (R-2026-09-28-156 EF-1 a). */
const NOTICE_SHA256 = '9e38c81335715db959651b07096b48d200e48c8199361f3571a0020de5baec76';
/** Version 1.0's, issued with R-2026-09-26-136 DL ("NOTICE INTEGRITY CHECK"). */
const PRIOR_SHA256 = '0921ca415238d5ed96f3d287bf4fe02669a7c0e5cebac25b3f303a22be524db1';
const PLACEHOLDER = '<!-- @PRIVACY_NOTICE@ -->';
const contacts = CONTACTS as unknown as Contacts;

/**
 * Addresses a plant needs, built at run time, so this file never carries an openbed.ng
 * address outside contacts.json's three (tests/compliance/contacts.test.ts scans it).
 */
const DOMAIN = ['openbed', 'ng'].join('.');
const PLANTED_ADDRESS = `planted${'@'}${DOMAIN}`;
const UNKNOWN_ADDRESS = `ops${'@'}${DOMAIN}`;

/** Why a built privacy page is not the notice, or []. Pure: HTML and markdown in. */
function noticeViolations(html: string, markdown: string, book: Contacts): string[] {
  const out: string[] = [];
  if (html.trim() === '') return ['the page is empty'];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (/<script\b/i.test(html)) out.push('the page carries a <script>: it must carry none');
  if (/<[a-zA-Z][^<>]*\sstyle\s*=/.test(html.replace(/<!--[\s\S]*?-->/g, ''))) out.push('the page carries a style= attribute');
  if (/<style\b/i.test(html)) out.push('the page carries an inline <style>');
  if (!hasViewport(html)) out.push(`the page has no <meta name="viewport" content="${VIEWPORT_CONTENT}">`);
  if (doc.getElementById('app') !== null) out.push('the page has an #app root: it is the SPA index, not the notice');
  const strip = doc.getElementById('emergency-strip');
  if (strip === null || !/Emergency:/.test(strip.textContent ?? '') || strip.querySelector('a[href="tel:112"]') === null) {
    out.push('the permanent emergency strip is missing');
  }
  if (squash(doc.querySelector('.site-header .lockup')?.textContent ?? '') !== 'OpenBed') out.push('the lockup is missing');
  if (html.includes(PLACEHOLDER)) out.push('the placeholder was not replaced: the notice was never written in');
  const main = doc.getElementById('notice');
  if (main === null) return [...out, 'the page has no main#notice'];
  const got = pageBlocks(main);
  const want = expectedBlocks(markdown, book);
  if (want.length === 0) return [...out, 'the source reduced to no text: nothing was compared'];
  if (got.length !== want.length) out.push(`the page has ${got.length} text blocks, the source ${want.length}`);
  for (let i = 0; i < Math.max(got.length, want.length); i += 1) {
    if (got[i] !== want[i]) {
      out.push(`block ${i + 1} differs:\n  page:   ${got[i] ?? '(none)'}\n  source: ${want[i] ?? '(none)'}`);
      break;
    }
  }
  return out;
}

const readBuilt = (): string => {
  if (!existsSync(BUILT)) {
    throw new Error(`${BUILT} does not exist: build the dashboard first (npm run build -w @openbed/public-dashboard). CI builds it in the same job.`);
  }
  return readFileSync(BUILT, 'utf8');
};
const markdown = (): string => readFileSync(SOURCE, 'utf8');

describe('the privacy notice at /privacy is the approved text (R-2026-09-26-136 DL-1)', () => {
  test('real docs/legal/privacy-notice-v1.1.md is accepted — its sha256 is the one issued with the file', () => {
    const got = createHash('sha256').update(readFileSync(SOURCE)).digest('hex');
    expect(got, 'the notice file is not the approved text: a paste error, never to be fixed by hand').toBe(NOTICE_SHA256);
  });

  test('the prior version, docs/legal/privacy-notice-v1.0.md, is kept unchanged — its sha256 is still 1.0\'s', () => {
    const got = createHash('sha256').update(readFileSync(PRIOR)).digest('hex');
    expect(got, 'version 1.0 was edited: a published version is never changed, a change is a new file').toBe(PRIOR_SHA256);
  });

  test('the built page states "Version 1.1" and never "Version 1.0" (R-2026-09-28-155 EE-2)', () => {
    const text = squash(new DOMParser().parseFromString(readBuilt(), 'text/html').body.textContent ?? '');
    expect(text).toContain('Version 1.1');
    expect(text, 'the page still states version 1.0').not.toContain('Version 1.0');
  });

  test('real built privacy page is accepted — its text equals the source with contacts.json addresses', () => {
    const out = noticeViolations(readBuilt(), markdown(), contacts);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('real privacy.html holds the one placeholder and index.html none', () => {
    const page = readFileSync(PAGE_SOURCE, 'utf8');
    const index = readFileSync(INDEX_SOURCE, 'utf8');
    expect(page.split(PLACEHOLDER).length - 1, 'privacy.html must hold exactly one placeholder').toBe(1);
    expect(index.includes(PLACEHOLDER), 'index.html holds the privacy-notice placeholder').toBe(false);
    expect(/<script\b/i.test(page), 'privacy.html carries a <script>').toBe(false);
  });

  test('plant — one word changed on the built page is rejected', () => {
    const real = readBuilt();
    // Aimed INSIDE a retention cell of the notice, not at a comment or the head.
    const before = 'then deleted within 30 days';
    expect(real, 'the plant target is not on the page').toContain(before);
    const planted = real.replace(before, 'then deleted within 60 days');
    expect(planted, 'the plant did not land').not.toBe(real);
    const out = noticeViolations(planted, markdown(), contacts);
    expect(out.join('\n')).toContain('differs');
    expect(out.join('\n')).toContain('60 days');
  });

  test('plant — a page whose address is not contacts.json\'s is rejected', () => {
    const changed = { ...contacts, hello: { address: PLANTED_ADDRESS } } as Contacts;
    const out = noticeViolations(readBuilt(), markdown(), changed);
    expect(out.join('\n')).toContain(PLANTED_ADDRESS);
  });

  test.each([
    ['a <script>', (h: string) => h.replace('</body>', '<script src="/x.js"></script></body>'), 'carries a <script>'],
    ['a style= attribute', (h: string) => h.replace('<main id="notice">', '<main id="notice" style="color:red">'), 'style= attribute'],
    ['the SPA root', (h: string) => h.replace('<main id="notice">', '<div id="app"></div><main id="notice">'), '#app root'],
    ['no emergency strip', (h: string) => h.replace('id="emergency-strip"', 'id="strip-gone"'), 'emergency strip is missing'],
    ['no lockup', (h: string) => h.replace('class="lockup"', 'class="gone"'), 'lockup is missing'],
    ['no viewport', (h: string) => h.replace(/<meta name="viewport"[^>]*>/, ''), 'no <meta name="viewport"'],
  ])('plant — %s is rejected', (_name, plant, message) => {
    const real = readBuilt();
    const planted = plant(real);
    expect(planted, 'the plant did not land').not.toBe(real);
    expect(noticeViolations(planted, markdown(), contacts).join('\n')).toContain(message);
  });

  test.each([
    ['an address with no contacts.json entry', `Write to ${UNKNOWN_ADDRESS} today.`, 'no entry in packages/origins/contacts.json'],
    ['a third-level heading', '### Details', 'only # and ## headings'],
    ['a code span', 'Run `rm` now.', 'code spans'],
    ['an unbalanced *', 'This is *not closed.', 'unbalanced'],
    ['raw HTML', 'A <b>bold</b> claim.', 'raw HTML'],
    ['a numbered list', '1. first', 'numbered lists'],
  ])('plant — the renderer refuses %s', (_name, text, message) => {
    expect(() => renderNotice(`# Title\n\n${text}\n`, contacts)).toThrow(message);
  });

  test('real — the renderer accepts the most ordinary notice: a heading and a sentence', () => {
    expect(renderNotice('# Title\n\nWrite to hello@openbed.ng.\n', contacts)).toBe('<h1>Title</h1>\n<p>Write to hello@openbed.ng.</p>');
  });

  test('anti-vacuity — checker over an empty corpus fails', () => {
    expect(noticeViolations('', markdown(), contacts)).toEqual(['the page is empty']);
    expect(noticeViolations(readBuilt(), '', contacts).join('\n')).toContain('nothing was compared');
    expect(() => renderNotice('', contacts)).toThrow('the source is empty');
  });
});
