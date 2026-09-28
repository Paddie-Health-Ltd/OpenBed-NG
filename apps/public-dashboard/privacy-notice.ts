/**
 * THE PRIVACY NOTICE, RENDERED AT BUILD TIME (R-2026-09-26-136 DL-1 b, c).
 *
 * docs/legal/privacy-notice-v1.1.md is the single source (version 1.1 since
 * R-2026-09-28-155 EE-2; 1.0 stays beside it, unchanged). vite.config.ts reads it and
 * packages/origins/contacts.json, calls renderNotice(), and writes the result into
 * privacy.html in place of its one placeholder. The page ships no script: everything
 * here runs in Node, once, during the build.
 *
 * A CLOSED SUBSET, AND ANYTHING OUTSIDE IT THROWS. The notice uses `#` and `##`
 * headings, paragraphs, `-` lists, pipe tables, `**strong**`, `*em*` and one
 * `[text](https://...)` link. A construct this file does not know -- a third-level
 * heading, a numbered list, a quote, code, an image, raw HTML, an unbalanced `*` --
 * is refused with its line number rather than passed through as literal characters,
 * because a notice that renders a word wrongly is a notice that says something the
 * founder did not approve. A markdown package would render more, and silently.
 *
 * EVERY openbed.ng ADDRESS COMES FROM contacts.json (DL-1 c). An address in the text
 * is looked up by its local part (`hello`, `support`, `security`) and the page carries
 * contacts.json's value. An address with no entry there throws. So the page cannot name
 * an address the rest of the project does not publish, and a change to contacts.json
 * reaches the page without anyone typing it twice.
 *
 * tests/compliance/privacy_notice.test.ts checks the BUILT page against the source file
 * with an independent text reduction, so this renderer is not its own witness.
 */

export interface Contact {
  readonly address: string;
}

export type Contacts = Readonly<Record<string, Contact | string>>;

const ADDRESS = /([A-Za-z0-9._%+-]+)@openbed\.ng\b/g;
const LINK = /\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function refuse(line: number, why: string): never {
  throw new Error(`privacy notice line ${line}: ${why}`);
}

/** The published address for a local part, from contacts.json, or a refusal. */
function published(contacts: Contacts, local: string, line: number): string {
  const entry = contacts[local];
  const address = typeof entry === 'object' && entry !== null ? entry.address : undefined;
  if (typeof address !== 'string' || !address.endsWith('@openbed.ng')) {
    refuse(line, `${local}@openbed.ng has no entry in packages/origins/contacts.json`);
  }
  return address;
}

/** Inline markup: the link, strong, em and the addresses. Refuses anything else. */
function inline(raw: string, contacts: Contacts, line: number): string {
  if (raw.includes('`')) refuse(line, 'code spans are not in the notice subset');
  if (raw.includes('<') || raw.includes('>')) refuse(line, 'raw HTML is not in the notice subset');
  if (raw.includes('![')) refuse(line, 'images are not in the notice subset');
  let text = escapeHtml(raw);
  const links: string[] = [];
  text = text.replace(LINK, (_whole, label: string, url: string) => {
    links.push(`<a href="${url}">${label}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  if (text.includes('](') || text.includes('[')) refuse(line, 'a link that is not [text](https://...)');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  if (text.includes('*')) refuse(line, 'an unbalanced or nested * is not in the notice subset');
  text = text.replace(ADDRESS, (_whole, local: string) => published(contacts, local, line));
  // The link placeholders go back last, so an address or a * inside a link is never
  // rewritten by the passes above.
  return text.replace(/\u0000(\d+)\u0000/g, (_whole, i: string) => links[Number(i)] ?? '');
}

function cells(row: string, line: number): string[] {
  const trimmed = row.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) refuse(line, 'a table row must start and end with |');
  return trimmed.slice(1, -1).split('|').map((c) => c.trim());
}

/** The header cell's words, with its markup removed, for a stacked row's label. */
function plainLabel(cell: string): string {
  return escapeHtml(cell.replace(/\*+/g, ''));
}

/**
 * The notice as HTML, from its markdown and the published contacts. Pure: no file,
 * no clock, no environment.
 */
export function renderNotice(markdown: string, contacts: Contacts): string {
  if (markdown.trim() === '') throw new Error('privacy notice: the source is empty');
  const lines = markdown.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const lineNo = i + 1;
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    if (/^#{3,}\s/.test(line)) refuse(lineNo, 'only # and ## headings are in the notice subset');
    if (/^\d+[.)]\s/.test(line)) refuse(lineNo, 'numbered lists are not in the notice subset');
    if (/^>/.test(line)) refuse(lineNo, 'quotes are not in the notice subset');
    if (/^\s+\S/.test(line)) refuse(lineNo, 'indented lines are not in the notice subset');
    if (line.startsWith('# ')) {
      out.push(`<h1>${inline(line.slice(2), contacts, lineNo)}</h1>`);
      i += 1;
      continue;
    }
    if (line.startsWith('## ')) {
      out.push(`<h2>${inline(line.slice(3), contacts, lineNo)}</h2>`);
      i += 1;
      continue;
    }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('- ')) {
        items.push(`<li>${inline((lines[i] ?? '').slice(2), contacts, i + 1)}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (line.startsWith('|')) {
      const header = cells(line, lineNo);
      const separator = cells(lines[i + 1] ?? '', lineNo + 1);
      if (separator.length !== header.length || !separator.every((c) => /^:?-{3,}:?$/.test(c))) {
        refuse(lineNo + 1, 'a table header must be followed by a --- separator of the same width');
      }
      i += 2;
      const rows: string[] = [];
      while (i < lines.length && (lines[i] ?? '').startsWith('|')) {
        const row = cells(lines[i] ?? '', i + 1);
        if (row.length !== header.length) refuse(i + 1, `a table row has ${row.length} cells, the header ${header.length}`);
        const tds = row.map((c, k) => `<td data-label="${plainLabel(header[k] ?? '')}">${inline(c, contacts, i + 1)}</td>`);
        rows.push(`<tr>${tds.join('')}</tr>`);
        i += 1;
      }
      if (rows.length === 0) refuse(lineNo, 'a table with no rows');
      const ths = header.map((c) => `<th scope="col">${inline(c, contacts, lineNo)}</th>`);
      out.push(`<table><thead><tr>${ths.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
      continue;
    }
    if (line.startsWith('#')) refuse(lineNo, 'a heading needs a space after its #');
    // A paragraph: this line and every following line up to a blank or a block.
    const para: string[] = [];
    while (i < lines.length) {
      const next = lines[i] ?? '';
      if (next.trim() === '' || /^(#|- |\|)/.test(next)) break;
      para.push(inline(next, contacts, i + 1));
      i += 1;
    }
    out.push(`<p>${para.join(' ')}</p>`);
  }
  return out.join('\n');
}
