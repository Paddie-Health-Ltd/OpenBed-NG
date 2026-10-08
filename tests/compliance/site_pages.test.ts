// @vitest-environment jsdom
/// <reference lib="dom" />
// DOM TYPES FOR THIS FILE ONLY (see tests/compliance/dashboard_empty_state.test.ts).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { renderNotice, type Contacts } from '../../apps/public-dashboard/privacy-notice.js';
import { fillPage, FOOTER_PLACEHOLDER, NOTICE_PLACEHOLDER, PAGES, ROBOTS_PLACEHOLDER, siteFooter, type BuildInputs } from '../../apps/public-dashboard/site-pages.js';
import CONTACTS from '../../packages/origins/contacts.json';
import { ABOUT_URL, HOW_IT_WORKS_URL, PRIVACY_NOTICE_URL } from '../../packages/origins/src/privacy.js';
import { robotsMetaContent, SEARCH_VISIBILITY } from '../../packages/origins/src/search.js';
import { hasViewport, VIEWPORT_CONTENT } from './_design.js';
import { expectedBlocks, pageBlocks, squash } from './_notice_text.js';
import { REPO_ROOT, withScratch } from './_scratch.js';

/**
 * THE PAGES AT /about AND /how-it-works ARE THE APPROVED COPY, WORD FOR WORD
 * (R-2026-09-30-190 FN-1, FN-2).
 *
 * Built as /privacy is (tests/compliance/privacy_notice.test.ts): the source files
 * docs/site/about.md and docs/site/how-it-works.md are rendered into the pages at build
 * time, with a pinned sha256 each ("a published text is not edited by hand, a change is a
 * new file"), and the BUILT pages are read and compared, block by block, with the source
 * reduced to text by the independent method in tests/compliance/_notice_text.ts. The
 * Medical Advisor has not yet read these words: if a later ruling changes a word, it
 * replaces both pins in this file.
 *
 * Legs: the two pins; the built privacy.html is byte for byte what it was before this
 * change (its own sha256, taken from the build before any edit); each page's text, exact
 * title and description, meta robots (the setting's value), emergency strip, lockup link
 * home, static footer, and the absence of any script, style, style= attribute or event
 * handler attribute; the set of entries the dashboard builds; and the build step's
 * rules (the renderer's refusal names the page, a placeholder where it does not belong
 * stops the build).
 *
 * CLASSIFICATION (Clause 5): LIVE. The pages, their sources and the build step exist now.
 *
 * NOT ASSERTED HERE, deliberately: that the founder's hosts SERVE the pages at /about and
 * /how-it-works -- the host's property; scripts/readback_pages.sh reads them after the
 * deploy. And that the Medical Advisor has approved the copy: there is no written
 * confirmation in this repository to assert against, and a test claiming it would be the
 * defect Clause 4 names.
 */

const contacts = CONTACTS as unknown as Contacts;
const DASH = join(REPO_ROOT, 'apps', 'public-dashboard');
const DIST = join(DASH, 'dist');

/** sha256 of each file as Cowork issued it (R-2026-09-30-190 FN-1). */
const ABOUT_SHA256 = '2eeeadce5479fd253582bd393946ac960757e05b7ff3248c51baffbc3211ec97';
const HOW_SHA256 = 'd2aa6f70cfa52f755d0527655baa5cd43905e2dcf88aa240fb864f44e96aaabc';
/**
 * The built dist/privacy.html before FN-2: FN-2 says it stays byte for byte.
 *
 * RESTATED 2026-10-08 (R-2026-09-30-214 GN), in the change that styles the facility card. Until then this was
 * 'fd00dc10392b8dc85c8432d8a8f9d95d9b3e128ce4cf2ace7e8129d578162869'. privacy.css imports style.css, so any
 * change to style.css changes the content hash in the filename of the stylesheet privacy.html links
 * (`privacy-Ceml8vr4.css` became `privacy-C5hzVzfN.css`), and with it the page's bytes. NOTHING ELSE moved,
 * and that was MEASURED rather than assumed: the base commit 6866161 was built in a scratch worktree
 * (reproducing the old value exactly), and this build's privacy.html with that one filename put back is
 * byte-identical to it (`diff` empty, the same sha256). The privacy notice's words, markup and links are
 * unchanged. The next change to style.css moves this again, for the same reason; the proof above is how to
 * check that it is the only thing that moved.
 */
const BUILT_PRIVACY_SHA256 = '977aac3fe61d8a8f17fc028eae46eaa829b1823107711e513478e14edf63d8e8';

interface Spec {
  readonly file: string;
  readonly source: string;
  readonly sha256: string;
  readonly title: string;
  readonly description: string;
  /** A phrase on the built page, and its one-word change, for the text plant. */
  readonly before: string;
  readonly after: string;
  /** True where the text carries a link to the privacy notice that must equal the constant. */
  readonly privacyLinkInText: boolean;
}

const SPECS: readonly Spec[] = [
  {
    file: 'about.html',
    source: 'docs/site/about.md',
    sha256: ABOUT_SHA256,
    title: 'About OpenBed',
    description: "OpenBed is a free public map of hospital bed availability in Lagos, run by Paddie Health Ltd. Each count is the hospital's own, shown with how recently it was updated.",
    before: 'There are no scores',
    after: 'There are some scores',
    privacyLinkInText: true,
  },
  {
    file: 'how-it-works.html',
    source: 'docs/site/how-it-works.md',
    sha256: HOW_SHA256,
    title: 'How OpenBed works',
    description: 'How OpenBed shows hospital bed availability in Lagos: who updates each count, how its age is shown, and why every page says to call before you travel.',
    before: 'within one working day',
    after: 'within one working week',
    privacyLinkInText: false,
  },
];

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const sourceOf = (spec: Spec): string => readFileSync(join(REPO_ROOT, spec.source), 'utf8');
const builtOf = (spec: Spec): string => {
  const file = join(DIST, spec.file);
  if (!existsSync(file)) {
    throw new Error(`${file} does not exist: build the dashboard first (npm run build -w @openbed/public-dashboard). CI builds it in the same job.`);
  }
  return readFileSync(file, 'utf8');
};

/** The footer's four links, in order: the hello address, About, How it works, Privacy notice. */
function expectedFooter(book: Contacts): { href: string; text: string }[] {
  const hello = book.hello;
  const address = typeof hello === 'object' && hello !== null ? hello.address : '(no hello address)';
  return [
    { href: `mailto:${address}`, text: address },
    { href: ABOUT_URL, text: 'About' },
    { href: HOW_IT_WORKS_URL, text: 'How it works' },
    { href: PRIVACY_NOTICE_URL, text: 'Privacy notice' },
  ];
}

/** Why a built static page is not the approved page, or []. Pure: HTML and markdown in. */
function pageViolations(html: string, markdown: string, spec: Spec, book: Contacts): string[] {
  if (html.trim() === '') return ['the page is empty'];
  const out: string[] = [];
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (/<script\b/i.test(html)) out.push('the page carries a <script>: it must carry none');
  if (/<style\b/i.test(html)) out.push('the page carries an inline <style>');
  if (/<[a-zA-Z][^<>]*\sstyle\s*=/.test(stripped)) out.push('the page carries a style= attribute');
  if (/<[a-zA-Z][^<>]*\son[a-zA-Z]+\s*=/.test(stripped)) out.push('the page carries an event-handler attribute');
  if (!hasViewport(html)) out.push(`the page has no <meta name="viewport" content="${VIEWPORT_CONTENT}">`);
  if (doc.getElementById('app') !== null) out.push('the page has an #app root: it is the SPA index, not this page');
  for (const ph of [NOTICE_PLACEHOLDER, FOOTER_PLACEHOLDER, ROBOTS_PLACEHOLDER]) {
    if (html.includes(ph)) out.push(`the placeholder ${ph} was not replaced`);
  }
  if (doc.title !== spec.title) out.push(`the title is ${JSON.stringify(doc.title)}, it must be ${JSON.stringify(spec.title)}`);
  const description = doc.querySelectorAll('meta[name="description"]');
  if (description.length !== 1 || description[0]?.getAttribute('content') !== spec.description) {
    out.push(`the description is not exactly ${JSON.stringify(spec.description)}`);
  }
  const robots = doc.querySelectorAll('meta[name="robots"]');
  const wantRobots = robotsMetaContent(SEARCH_VISIBILITY);
  if (robots.length !== 1 || robots[0]?.getAttribute('content') !== wantRobots) out.push(`the meta robots tag is not exactly ${JSON.stringify(wantRobots)}`);
  const strip = doc.getElementById('emergency-strip');
  if (strip === null || !/Emergency:/.test(strip.textContent ?? '') || strip.querySelector('a[href="tel:112"]') === null || strip.querySelector('a[href="tel:767"]') === null) {
    out.push('the permanent emergency strip is missing');
  }
  const home = Array.from(doc.querySelectorAll('.site-header a.home-link')).filter((a) => a.getAttribute('href') === '/');
  if (home.length !== 1 || squash(home[0]?.querySelector('.lockup')?.textContent ?? '') !== 'OpenBed') out.push('the lockup does not link home');
  const links = Array.from(doc.querySelectorAll('footer#site-footer a')).map((a) => ({ href: a.getAttribute('href') ?? '', text: squash(a.textContent ?? '') }));
  const want = expectedFooter(book);
  if (JSON.stringify(links) !== JSON.stringify(want)) out.push(`the footer links are ${JSON.stringify(links)}, they must be ${JSON.stringify(want)}`);
  const main = doc.getElementById('notice');
  if (main === null) return [...out, 'the page has no main#notice'];
  const got = pageBlocks(main);
  const expected = expectedBlocks(markdown, book);
  if (expected.length === 0) return [...out, 'the source reduced to no text: nothing was compared'];
  if (got.length !== expected.length) out.push(`the page has ${got.length} text blocks, the source ${expected.length}`);
  for (let i = 0; i < Math.max(got.length, expected.length); i += 1) {
    if (got[i] !== expected[i]) {
      out.push(`block ${i + 1} differs:\n  page:   ${got[i] ?? '(none)'}\n  source: ${expected[i] ?? '(none)'}`);
      break;
    }
  }
  return out;
}

/** Why a set of top-level HTML entries is not the declared set, or []. */
function entryViolations(found: string[], declared: string[]): string[] {
  if (found.length === 0) return ['no HTML entry was found: an entries check over nothing is not a pass'];
  const out: string[] = [];
  for (const f of found) if (!declared.includes(f)) out.push(`${f} is an entry the page table does not declare`);
  for (const d of declared) if (!found.includes(d)) out.push(`${d} is declared and was not found`);
  return out;
}

const htmlIn = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.html')).sort() : []);

describe('the static pages are the approved copy (R-2026-09-30-190 FN-1, FN-2)', () => {
  test.each(SPECS)('real $source is accepted — its sha256 is the one issued with the file', (spec) => {
    const text = readFileSync(join(REPO_ROOT, spec.source));
    expect(sha(text), `${spec.source} is not the approved copy: a paste error, never to be fixed by hand`).toBe(spec.sha256);
    expect(text.at(-1), 'the file must end in a newline').toBe(0x0a);
    expect(text.at(-2), 'the file must end in exactly one newline').not.toBe(0x0a);
  });

  test('real built privacy.html is accepted — byte for byte what it was before FN-2', () => {
    const file = join(DIST, 'privacy.html');
    expect(existsSync(file), `${file} does not exist: build the dashboard first`).toBe(true);
    expect(sha(readFileSync(file)), 'the built privacy.html changed: FN-2 forbids it').toBe(BUILT_PRIVACY_SHA256);
  });

  test.each(SPECS)('real built $file is accepted — text, title, description, robots tag, strip, lockup and footer', (spec) => {
    const out = pageViolations(builtOf(spec), sourceOf(spec), spec, contacts);
    expect(out, out.join('\n')).toEqual([]);
  });

  test.each(SPECS)('real $file text opens with the source\'s own heading', (spec) => {
    const heading = /^# (.*)$/m.exec(sourceOf(spec))?.[1] ?? '';
    const h1 = new DOMParser().parseFromString(builtOf(spec), 'text/html').querySelector('main#notice h1');
    expect(heading).not.toBe('');
    expect(squash(h1?.textContent ?? '')).toBe(heading);
  });

  describe.each(SPECS)('plants against $file', (spec) => {
    test('plant — one word changed on the built page is rejected', () => {
      const real = builtOf(spec);
      expect(real, 'the plant target is not on the page').toContain(spec.before);
      const planted = real.replace(spec.before, spec.after);
      expect(planted, 'the plant did not land').not.toBe(real);
      const out = pageViolations(planted, sourceOf(spec), spec, contacts).join('\n');
      expect(out).toContain('differs');
      expect(out).toContain(spec.after);
    });

    test('plant — one word of the source changed under an unchanged page is rejected', () => {
      const markdown = sourceOf(spec);
      const planted = markdown.replace(spec.before, spec.after);
      expect(planted, 'the plant did not land').not.toBe(markdown);
      expect(pageViolations(builtOf(spec), planted, spec, contacts).join('\n')).toContain('differs');
    });

    test.each([
      ['a changed title', (h: string) => h.replace(`<title>${spec.title}</title>`, `<title>${spec.title}s</title>`), 'the title is'],
      ['a changed description', (h: string) => h.replace(spec.description.slice(0, 20), `${spec.description.slice(0, 19)}!`), 'the description is not exactly'],
      ['a flipped robots tag', (h: string) => h.replace(/(<meta name="robots" content=")[^"]*"/, `$1${robotsMetaContent(SEARCH_VISIBILITY === 'hidden' ? 'public' : 'hidden')}"`), 'the meta robots tag is not exactly'],
      ['a <script>', (h: string) => h.replace('</body>', '<script src="/x.js"></script></body>'), 'carries a <script>'],
      ['an inline <style>', (h: string) => h.replace('</head>', '<style>a{}</style></head>'), 'inline <style>'],
      ['a style= attribute', (h: string) => h.replace('<main id="notice">', '<main id="notice" style="color:red">'), 'style= attribute'],
      ['an event-handler attribute', (h: string) => h.replace('<main id="notice">', '<main id="notice" onclick="x()">'), 'event-handler attribute'],
      ['the SPA root', (h: string) => h.replace('<main id="notice">', '<div id="app"></div><main id="notice">'), '#app root'],
      ['no emergency strip', (h: string) => h.replace('id="emergency-strip"', 'id="strip-gone"'), 'emergency strip is missing'],
      ['a lockup that does not link home', (h: string) => h.replace('class="home-link" href="/"', 'class="home-link" href="/elsewhere"'), 'lockup does not link home'],
      ['an unreplaced placeholder', (h: string) => h.replace('</main>', `${NOTICE_PLACEHOLDER}</main>`), 'was not replaced'],
      ['no viewport', (h: string) => h.replace(/<meta name="viewport"[^>]*>/, ''), 'no <meta name="viewport"'],
      ['a footer About link pointed elsewhere', (h: string) => h.replace(`href="${ABOUT_URL}"`, 'href="https://openbed.ng/elsewhere"'), 'the footer links are'],
      ['a footer link with other words', (h: string) => h.replace('>How it works</a>', '>Read more</a>'), 'the footer links are'],
      ['a footer without the privacy link', (h: string) => h.replace(new RegExp(`<a href="${PRIVACY_NOTICE_URL}">Privacy notice</a>`), ''), 'the footer links are'],
    ])('plant — %s is rejected', (_name, plant, message) => {
      const real = builtOf(spec);
      const planted = plant(real);
      expect(planted, 'the plant did not land').not.toBe(real);
      expect(pageViolations(planted, sourceOf(spec), spec, contacts).join('\n')).toContain(message);
    });

    test('plant — a footer address that is not contacts.json\'s is rejected', () => {
      const changed = { ...contacts, hello: { address: `planted${'@'}${['openbed', 'ng'].join('.')}` } } as Contacts;
      expect(pageViolations(builtOf(spec), sourceOf(spec), spec, changed).join('\n')).toContain('planted');
    });
  });

  test('real About carries its link to the privacy notice, and the link is the one constant', () => {
    const spec = SPECS[0] as Spec;
    const doc = new DOMParser().parseFromString(builtOf(spec), 'text/html');
    const hrefs = Array.from(doc.querySelectorAll('main#notice a')).map((a) => a.getAttribute('href'));
    expect(hrefs, 'About\'s text must link the privacy notice, once, to PRIVACY_NOTICE_URL').toEqual([PRIVACY_NOTICE_URL]);
  });

  test('real how-it-works text carries no link at all', () => {
    const doc = new DOMParser().parseFromString(builtOf(SPECS[1] as Spec), 'text/html');
    expect(Array.from(doc.querySelectorAll('main#notice a'))).toEqual([]);
  });

  test('real — the dashboard builds exactly the entries the page table declares', () => {
    const declared = Object.keys(PAGES).sort();
    expect(entryViolations(htmlIn(DASH), declared), 'source entries').toEqual([]);
    expect(entryViolations(htmlIn(DIST), declared), 'built entries').toEqual([]);
  });

  test('plant — an undeclared entry, and a declared one that is missing, are each named', () => {
    const declared = Object.keys(PAGES).sort();
    expect(entryViolations([...declared, 'extra.html'], declared)).toEqual(['extra.html is an entry the page table does not declare']);
    expect(entryViolations(declared.filter((f) => f !== 'about.html'), declared)).toEqual(['about.html is declared and was not found']);
  });

  test('plant — a dist missing a page is rejected by the built-page leg', () => {
    withScratch((root) => {
      expect(entryViolations(htmlIn(root), Object.keys(PAGES).sort())).toEqual(['no HTML entry was found: an entries check over nothing is not a pass']);
    });
  });
});

describe('the build step\'s rules for the static pages (R-2026-09-30-190 FN-2, FN-3)', () => {
  const inputs = (visibility: 'hidden' | 'public' = 'hidden'): BuildInputs => ({
    markdown: () => '# Title\n\nWrite to hello@openbed.ng.\n',
    contacts,
    visibility,
    render: renderNotice,
  });
  const shell = (...body: string[]): string => `<head>${body.join('')}</head><main>${NOTICE_PLACEHOLDER}</main>${FOOTER_PLACEHOLDER}`;

  test('real — the renderer\'s refusal names the page it was rendering, and the privacy notice by default', () => {
    expect(() => renderNotice('# T\n\n### x\n', contacts, 'about page')).toThrow('about page line 3: only # and ## headings');
    expect(() => renderNotice('# T\n\n### x\n', contacts)).toThrow('privacy notice line 3: only # and ## headings');
    expect(() => renderNotice('', contacts, 'how-it-works page')).toThrow('how-it-works page: the source is empty');
  });

  test('real — the most ordinary page fills every placeholder it declares', () => {
    const html = fillPage('about.html', shell(ROBOTS_PLACEHOLDER), inputs());
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toContain(siteFooter(contacts));
    for (const ph of [NOTICE_PLACEHOLDER, FOOTER_PLACEHOLDER, ROBOTS_PLACEHOLDER]) expect(html).not.toContain(ph);
  });

  test('the public state writes index, follow into the three setting pages, and never into privacy.html', () => {
    expect(fillPage('about.html', shell(ROBOTS_PLACEHOLDER), inputs('public'))).toContain('<meta name="robots" content="index, follow" />');
    expect(fillPage('index.html', `<head>${ROBOTS_PLACEHOLDER}</head>`, inputs('public'))).toContain('content="index, follow"');
    expect(PAGES['privacy.html']?.robotsFromSetting, 'privacy.html must be noindex in both states').toBe(false);
    expect(() => fillPage('privacy.html', `<head>${ROBOTS_PLACEHOLDER}</head>${NOTICE_PLACEHOLDER}`, inputs('public'))).toThrow('robots placeholder does not belong');
  });

  test.each([
    ['a page text placeholder in the dashboard index', 'index.html', `${ROBOTS_PLACEHOLDER}${NOTICE_PLACEHOLDER}`, 'page-text placeholder does not belong'],
    ['a page text placeholder in an unknown page', 'other.html', NOTICE_PLACEHOLDER, 'page-text placeholder does not belong'],
    ['a second page text placeholder', 'about.html', shell(ROBOTS_PLACEHOLDER, NOTICE_PLACEHOLDER), 'expected exactly one page-text placeholder, found 2'],
    ['no page text placeholder', 'about.html', `<head>${ROBOTS_PLACEHOLDER}</head>${FOOTER_PLACEHOLDER}`, 'expected exactly one page-text placeholder, found 0'],
    ['no footer placeholder on a page that needs one', 'how-it-works.html', `<head>${ROBOTS_PLACEHOLDER}</head>${NOTICE_PLACEHOLDER}`, 'expected exactly one footer placeholder, found 0'],
    ['a footer placeholder on the privacy notice', 'privacy.html', `${NOTICE_PLACEHOLDER}${FOOTER_PLACEHOLDER}`, 'footer placeholder does not belong'],
    ['no robots placeholder on a page the setting decides', 'about.html', `${NOTICE_PLACEHOLDER}${FOOTER_PLACEHOLDER}`, 'expected exactly one robots placeholder, found 0'],
  ])('plant — %s stops the build', (_name, file, html, message) => {
    expect(() => fillPage(file, html, inputs())).toThrow(message);
  });

  test('anti-vacuity — the page table is not empty, and the footer refuses a missing address', () => {
    expect(Object.keys(PAGES).length, 'no page declared: every leg above is vacuous').toBe(4);
    expect(() => siteFooter({})).toThrow('contacts.json has no hello address');
  });
});
