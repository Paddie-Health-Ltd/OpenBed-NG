import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

/**
 * WHAT packages/design SHIPS, PINNED (the design-pass kickoff, D1).
 *
 *   - tokens.css is the design system's six token files, each copied byte for byte
 *     under a header naming it and its sha256. Every section is re-hashed here against
 *     its own header, so a hand edit to a token reds; the order is the design system's
 *     styles.css order. The design system itself is on the founder's Mac, outside this
 *     repository, so the hashes were read from it when the file was written and recorded
 *     in the decision record's D1 entry -- this test proves the file still matches what
 *     was recorded, NOT that the design system has not moved since.
 *   - fonts.css self-hosts exactly the faces the tokens use (Public Sans 400/600/700, IBM
 *     Plex Mono 400/500/600), woff2 only, font-display: swap, every src a fontsource
 *     package file, no @import and no host.
 *   - openbed-mark.svg is the brand mark exactly as the kickoff quotes it. The brand
 *     sheet itself is not on disk (read 2026-09-26: the design system's assets/ folder
 *     does not exist), so the kickoff's quoted geometry is the source.
 *   - the exports map names every file an app imports, and every file it names exists
 *     (tests/compliance/tracked_client_keys.test.ts resolves subpaths through it).
 *   - the public dashboard ships a real /favicon.ico (R-2026-09-26-122 CX-3): an ICO,
 *     copied unchanged into the build, so that path is never the SPA's HTML.
 *   - NOTICE carries both fonts' OFL-1.1 attributions.
 */

const DESIGN = join(REPO_ROOT, 'packages', 'design');
const ORDER = ['colors.css', 'typography.css', 'spacing.css', 'surfaces.css', 'motion.css', 'base.css'];
const HEADER = /\n\/\* ---- tokens\/([a-z]+\.css) \(sha256 ([0-9a-f]{64})\) ---- \*\/\n/g;

/** Each section of tokens.css: its declared file, declared hash and actual bytes. */
export function tokenSections(text: string): { file: string; declared: string; actual: string }[] {
  const heads = Array.from(text.matchAll(HEADER));
  return heads.map((h, i) => {
    const start = (h.index ?? 0) + h[0].length;
    const end = i + 1 < heads.length ? (heads[i + 1]?.index ?? text.length) : text.length;
    const body = text.slice(start, end);
    return { file: h[1] ?? '', declared: h[2] ?? '', actual: createHash('sha256').update(body, 'utf8').digest('hex') };
  });
}

export function tokenViolations(text: string): string[] {
  const out: string[] = [];
  const sections = tokenSections(text);
  const files = sections.map((s) => s.file);
  if (JSON.stringify(files) !== JSON.stringify(ORDER)) out.push(`tokens.css sections are ${JSON.stringify(files)}, not the design system's order ${JSON.stringify(ORDER)}`);
  for (const s of sections) if (s.declared !== s.actual) out.push(`tokens/${s.file} was edited after it was copied: its section hashes to ${s.actual}, its header says ${s.declared}`);
  if (/@import|url\(/.test(text.replace(/\/\*[\s\S]*?\*\//g, ''))) out.push('tokens.css imports or fetches something: the design system\'s fonts.css must not be copied in');
  return out;
}

const FACES = [
  ['Public Sans', 'public-sans', 400], ['Public Sans', 'public-sans', 600], ['Public Sans', 'public-sans', 700],
  ['IBM Plex Mono', 'ibm-plex-mono', 400], ['IBM Plex Mono', 'ibm-plex-mono', 500], ['IBM Plex Mono', 'ibm-plex-mono', 600],
] as const;

export function fontViolations(text: string): string[] {
  const out: string[] = [];
  const faces = Array.from(text.matchAll(/@font-face\s*\{([^}]*)\}/g)).map((m) => m[1] ?? '');
  const seen = faces.map((f) => `${/font-family:\s*'([^']+)'/.exec(f)?.[1] ?? '?'} ${/font-weight:\s*(\d+)/.exec(f)?.[1] ?? '?'}`);
  const want = FACES.map(([fam, , w]) => `${fam} ${w}`);
  if (JSON.stringify(seen) !== JSON.stringify(want)) out.push(`fonts.css declares ${JSON.stringify(seen)}, not ${JSON.stringify(want)}`);
  faces.forEach((f, i) => {
    const [, pkg, w] = FACES[i] ?? ['', '', 0];
    if (!/font-display:\s*swap;/.test(f)) out.push(`face ${seen[i]}: no font-display: swap`);
    const urls = Array.from(f.matchAll(/url\('([^']+)'\)/g)).map((m) => m[1]);
    if (urls.length !== 1 || urls[0] !== `@fontsource/${pkg}/files/${pkg}-latin-${w}-normal.woff2`) {
      out.push(`face ${seen[i]}: src is ${JSON.stringify(urls)}, not the one fontsource latin woff2`);
    }
  });
  if (/@import|https?:|\/\/fonts/.test(text.replace(/\/\*[\s\S]*?\*\//g, ''))) out.push('fonts.css imports or names a host');
  return out;
}

const MARK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">' +
  '<path d="M6,13 L6,10 A4,4 0 0 1 10,6 L22,6 A4,4 0 0 1 26,10 L26,22 A4,4 0 0 1 22,26 L10,26 A4,4 0 0 1 6,22 L6,19" fill="none" stroke="#1b3a5c" stroke-width="2.2" stroke-linecap="round"/>' +
  '<circle cx="6" cy="16" r="2.3" fill="#2f8f8a"/></svg>\n';

describe('packages/design ships what the design system and the kickoff specify', () => {
  test('real tokens.css is accepted — every section in order and unedited', () => {
    const text = readFileSync(join(DESIGN, 'tokens.css'), 'utf8');
    expect(tokenSections(text).length, 'no token section parsed: the header pattern stopped matching').toBe(ORDER.length);
    const out = tokenViolations(text);
    expect(out, out.join('\n')).toEqual([]);
    expect(text).toContain('--ob-navy-700');
  });

  test('plant — a token edited after the copy is rejected', () => {
    const text = readFileSync(join(DESIGN, 'tokens.css'), 'utf8');
    const planted = text.replace('--ob-navy-700:#1b3a5c', '--ob-navy-700:#1b3a5d');
    expect(planted, 'the plant did not change the file').not.toBe(text);
    expect(tokenViolations(planted).join('\n')).toContain('tokens/colors.css was edited after it was copied');
  });

  test('plant — sections out of order, and a copied Google import, are rejected', () => {
    const text = readFileSync(join(DESIGN, 'tokens.css'), 'utf8');
    const swapped = text.replace('tokens/colors.css', 'tokens/zzzzzz.css');
    expect(tokenViolations(swapped).join('\n')).toContain("not the design system's order");
    expect(tokenViolations(`${text}@import url("x.css");\n`).join('\n')).toContain('imports or fetches something');
  });

  test('anti-vacuity — a tokens.css with no sections is rejected', () => {
    expect(tokenViolations(':root{}').join('\n')).toContain("not the design system's order");
  });

  test('real fonts.css is accepted — six faces, woff2 from fontsource, swap, no host', () => {
    const out = fontViolations(readFileSync(join(DESIGN, 'fonts.css'), 'utf8'));
    expect(out, out.join('\n')).toEqual([]);
  });

  test.each([
    ['a woff fallback added', (t: string) => t.replace("format('woff2');", "format('woff2'), url('@fontsource/public-sans/files/public-sans-latin-400-normal.woff') format('woff');"), 'not the one fontsource latin woff2'],
    ['font-display dropped', (t: string) => t.replace('font-display: swap;', ''), 'no font-display: swap'],
    ['a Google import', (t: string) => `@import url("https://example.com/css");\n${t}`, 'imports or names a host'],
    ['a weight dropped', (t: string) => t.replace(/@font-face \{[^}]*font-weight: 700;[^}]*\}/, ''), 'fonts.css declares'],
  ])('plant — fonts.css with %s is rejected', (_name, mutate, message) => {
    const text = readFileSync(join(DESIGN, 'fonts.css'), 'utf8');
    const planted = mutate(text);
    expect(planted, 'the plant did not change the file').not.toBe(text);
    expect(fontViolations(planted).join('\n')).toContain(message);
  });

  test('every font file fonts.css names is installed', () => {
    for (const [, pkg, w] of FACES) {
      const file = join(REPO_ROOT, 'node_modules', '@fontsource', pkg, 'files', `${pkg}-latin-${w}-normal.woff2`);
      expect(existsSync(file), `${file} is not installed: run npm ci`).toBe(true);
    }
  });

  test('the mark is the kickoff\'s geometry, byte for byte', () => {
    expect(readFileSync(join(DESIGN, 'openbed-mark.svg'), 'utf8')).toBe(MARK);
  });

  test('the exports map names every shipped file, and every file it names exists', () => {
    const pkg = JSON.parse(readFileSync(join(DESIGN, 'package.json'), 'utf8')) as { name: string; exports: Record<string, string> };
    expect(pkg.name).toBe('@openbed/design');
    const shipped = readdirSync(DESIGN).filter((f) => f !== 'package.json').sort();
    expect(Object.values(pkg.exports).map((p) => p.replace(/^\.\//, '')).sort()).toEqual(shipped);
    for (const p of Object.values(pkg.exports)) expect(existsSync(join(DESIGN, p)), `${p} is exported and missing`).toBe(true);
  });

  test('the public dashboard ships a real /favicon.ico, copied unchanged into the build, and links the SVG icon', () => {
    const src = readFileSync(join(REPO_ROOT, 'apps', 'public-dashboard', 'public', 'favicon.ico'));
    expect(Array.from(src.subarray(0, 4)), 'public/favicon.ico is not an ICO (magic 00 00 01 00)').toEqual([0, 0, 1, 0]);
    expect(src.readUInt16LE(4), 'public/favicon.ico holds no image').toBeGreaterThan(0);
    const built = join(REPO_ROOT, 'apps', 'public-dashboard', 'dist', 'favicon.ico');
    expect(existsSync(built), 'dist/favicon.ico is missing: run npm run build').toBe(true);
    expect(readFileSync(built).equals(src), 'dist/favicon.ico differs from public/favicon.ico').toBe(true);
    const html = readFileSync(join(REPO_ROOT, 'apps', 'public-dashboard', 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    expect(html).toMatch(/<link rel="icon" type="image\/svg\+xml" href="[^"]*openbed-mark\.svg" \/>/);
  });

  test('NOTICE carries both fonts\' OFL-1.1 attributions', () => {
    const notice = readFileSync(join(REPO_ROOT, 'NOTICE'), 'utf8').replace(/\s+/g, ' ');
    for (const s of ['SIL Open Font License, Version 1.1', '@fontsource/public-sans 5.3.0', 'The Public Sans Project Authors', '@fontsource/ibm-plex-mono 5.3.0', 'Copyright 2017 IBM Corp.']) {
      expect(notice, `NOTICE does not say: ${s}`).toContain(s);
    }
    const pkg = JSON.parse(readFileSync(join(DESIGN, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies, 'NOTICE names versions the package no longer pins').toEqual({ '@fontsource/ibm-plex-mono': '5.3.0', '@fontsource/public-sans': '5.3.0' });
  });
});
