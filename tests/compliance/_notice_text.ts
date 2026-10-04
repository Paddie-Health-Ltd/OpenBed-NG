/// <reference lib="dom" />
import type { Contacts } from '../../apps/public-dashboard/privacy-notice.js';

/**
 * THE INDEPENDENT TEXT REDUCTION, SHARED BY THE TESTS OVER THE STATIC PAGES
 * (R-2026-09-30-190 FN-2). It was written for tests/compliance/privacy_notice.test.ts and
 * moved here unchanged when a second test needed it; both import it, neither restates
 * it. It shares NOTHING with the renderer in apps/public-dashboard/privacy-notice.ts: no
 * escaping, no HTML, no refusals, which is what makes it a second witness.
 */

export const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * THE INDEPENDENT REDUCTION: the source markdown as the list of text blocks a reader
 * sees -- one per heading, paragraph, list item and table cell, in order -- with the
 * markup characters removed and each openbed.ng address replaced by contacts.json's.
 * It shares nothing with the renderer: no escaping, no HTML, no refusals.
 */
export function expectedBlocks(markdown: string, book: Contacts): string[] {
  const addressFor = (local: string): string => {
    const entry = book[local];
    return typeof entry === 'object' && entry !== null ? entry.address : `${local}@openbed.ng (NOT IN contacts.json)`;
  };
  const plain = (s: string): string =>
    squash(
      s
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .split('*').join('')
        .replace(/([A-Za-z0-9._%+-]+)@openbed\.ng\b/g, (_w, local: string) => addressFor(local)),
    );
  const out: string[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length > 0) out.push(plain(para.join(' ')));
    para = [];
  };
  for (const line of markdown.split('\n')) {
    if (line.trim() === '') { flush(); continue; }
    const heading = /^#{1,2} (.*)$/.exec(line);
    if (heading) { flush(); out.push(plain(heading[1] ?? '')); continue; }
    if (line.startsWith('- ')) { flush(); out.push(plain(line.slice(2))); continue; }
    if (line.startsWith('|')) {
      flush();
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (cells.every((c) => /^-+$/.test(c))) continue;
      for (const c of cells) out.push(plain(c));
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

/** The page's text blocks, in document order: every heading, paragraph, item and cell. */
export function pageBlocks(main: Element): string[] {
  return Array.from(main.querySelectorAll('h1, h2, p, li, th, td')).map((el) => squash(el.textContent ?? ''));
}

