import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { DOCS, docsUnder, shellFences, type Doc } from './_fences.js';
import { REPO_ROOT, place, withScratch } from './_scratch.js';

/**
 * A SHELL BLOCK THAT READS A VALUE IS PASTED ALONE (R-2026-09-28-150 DZ-3 c).
 *
 * THE DEFECT, relayed from hosted run 1 (R-2026-09-28-149 DY): "the pasted read -rs
 * swallowed a line". A block holding `read -rs DATABASE_URL && export DATABASE_URL` and
 * then a command hands `read` its NEXT pasted line as the value, whenever the paste reaches
 * the shell line by line. psql then got a command's text for a connection string and fell
 * back to the local socket. How the founder's terminal delivered that paste is not
 * established, and DZ-2 says it need not be: the rule removes the case.
 *
 * THE RULE (DZ-3 a and b): a block that reads a value is ONE line, the connection line, and
 * nothing follows the read in it. It is pasted alone, and the value is given at its prompt.
 * The commands are the NEXT shell block, and it ends with an `unset` naming every variable
 * the connection line read.
 *
 * WHAT IS CHECKED, over every shell fence (tests/compliance/_fences.ts) in every .md under
 * docs/, at any depth:
 *   (a) a fence holding a `read` has no line after its first reading line: all its reads
 *       are on that one line;
 *   (b) the next shell fence in the same document exists, holds no `read` of its own, and
 *       its last line is `unset` naming every variable the connection line read.
 *
 * WIDER THAN DZ-3 c's WORDING, and reported as such: DZ-3 c names `read -rs`. A plain
 * `read -r` swallows the next pasted line in exactly the same way (silence changes what is
 * echoed, not what is read), and step 5's provisioning block held three of them. So (a) and
 * (b) read any `read -r` or `read -rs`. Fifteen plain reads were converted with the 44
 * silent ones.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - HOW THE BLOCK BEHAVES WHEN PASTED. That is a terminal's behaviour, and no file can
 *     show it. It was read by pasting into zsh under a pseudo-terminal with bracketed paste
 *     on, and again with it off, recorded in R-2026-09-28-150 (DZ-3 d).
 *   - that the ORDER of the values a connection line waits for matches the prose. The
 *     conversion kept each block's order; the prose is the reader's.
 */

const READ = /(^|[;&]\s*)read\s+-rs?\s+\w+/;
const NAME = /read\s+-rs?\s+(\w+)/g;

export function readViolations(docs: readonly Doc[]): string[] {
  const { fences, errors } = shellFences(docs);
  const out = [...errors];
  const reading = fences.filter((f) => f.lines.some((l) => READ.test(l.text)));
  if (reading.length === 0) out.push('no shell fence under docs/ reads a value: a guard over nothing is not a pass');
  for (const f of reading) {
    const at = `${f.doc}:${f.line}`;
    // From the FIRST read, not the last: a second read on its own line is itself a line a
    // line-by-line paste hands to the first read as its value. (A first version measured
    // from the last read, and its own two-reads plant was accepted.)
    const first = f.lines.findIndex((l) => READ.test(l.text));
    const after = f.lines.slice(first + 1).filter((l) => l.text.trim() !== '');
    if (after.length > 0) {
      out.push(`${at}: a block that reads a value has ${after.length} line(s) after the read, so a line-by-line paste hands the first of them to read as the value: ${(after[0]?.text ?? '').trim().slice(0, 80)}`);
    }
    const names = f.lines.flatMap((l) => [...l.text.matchAll(NAME)].map((m) => m[1] as string));
    const next = fences.find((g) => g.doc === f.doc && g.line > f.line);
    if (next === undefined) {
      out.push(`${at}: a connection block with no command block after it in ${f.doc}`);
      continue;
    }
    if (next.lines.some((l) => READ.test(l.text))) {
      out.push(`${next.doc}:${next.line}: the command block after the connection block at line ${f.line} reads a value itself`);
    }
    const tail = [...next.lines].reverse().find((l) => l.text.trim() !== '')?.text.trim() ?? '';
    const unset = tail.startsWith('unset ') ? tail.split(/\s+/).slice(1) : [];
    const missing = names.filter((n) => !unset.includes(n));
    if (missing.length > 0) {
      out.push(`${next.doc}:${next.line}: the command block after the connection block at line ${f.line} does not end by unsetting ${missing.join(', ')}`);
    }
  }
  return out;
}

const REAL = docsUnder(REPO_ROOT);
const RUNBOOK = join(DOCS, 'runbook-supabase-project-creation.md');

function inScratch(files: Record<string, string>): string[] {
  return withScratch((root) => {
    for (const [p, text] of Object.entries(files)) place(root, join(DOCS, p), text);
    return readViolations(docsUnder(root));
  });
}

const PAIR = (read: string, cmd: string, indent = ''): string =>
  [`${indent}\`\`\`bash`, `${indent}${read}`, `${indent}\`\`\``, '', `${indent}Then paste:`, '', `${indent}\`\`\`bash`, ...cmd.split('\n').map((l) => indent + l), `${indent}\`\`\``, ''].join('\n');

describe('a shell block that reads a value is pasted alone (DZ-3 c)', () => {
  test('real docs/ is accepted — every connection line is alone, and its command block unsets what it read', () => {
    const out = readViolations(REAL);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('anti-vacuity — the corpus holds the connection blocks it claims, and a docs/ with none fails', () => {
    const { fences } = shellFences(REAL);
    const reading = fences.filter((f) => f.lines.some((l) => READ.test(l.text)));
    // 43 on 2026-09-28: 41 in the Supabase runbook and 2 in the Pages runbook (DZ-3 b).
    expect(reading.length, `connection blocks read: ${reading.length}`).toBeGreaterThanOrEqual(43);
    expect(new Set(reading.map((f) => f.doc))).toEqual(new Set([RUNBOOK, join(DOCS, 'runbook-cloudflare-pages-beds-json.md')]));
    expect(inScratch({ 'runbook-x.md': '```bash\necho no reads\n```\n' }).join('\n')).toContain('no shell fence under docs/ reads a value');
  });

  test('the most ordinary valid pair is accepted: step P\'s line and a silent read, then psql and its unset', () => {
    const out = inScratch({
      'runbook-x.md': PAIR('export PATH="/opt/homebrew/opt/libpq/bin:$PATH"; read -rs DATABASE_URL && export DATABASE_URL', 'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"\npsql "$DATABASE_URL" -tAc "select 1"\nunset DATABASE_URL'),
    });
    expect(out, out.join('\n')).toEqual([]);
  });

  test('plant — the observed shape, a read -rs with a psql line after it in one block, is rejected', () => {
    const planted = REAL.map((d) =>
      d.doc === RUNBOOK
        ? { doc: d.doc, text: d.text.replace(/```bash\nexport PATH="\/opt\/homebrew\/opt\/libpq\/bin:\$PATH"; read -rs DATABASE_URL && export DATABASE_URL\n```/, () => '```bash\nexport PATH="/opt/homebrew/opt/libpq/bin:$PATH"; read -rs DATABASE_URL && export DATABASE_URL\npsql "$DATABASE_URL" -tAc "select 1"\n```') }
        : d,
    );
    expect(planted.find((d) => d.doc === RUNBOOK)?.text, 'the plant did not land').not.toBe(REAL.find((d) => d.doc === RUNBOOK)?.text);
    expect(readViolations(planted).join('\n')).toContain('a block that reads a value has 1 line(s) after the read, so a line-by-line paste hands the first of them to read as the value: psql "$DATABASE_URL"');
  });

  test.each([
    ['a plain read -r followed by a command (wider than DZ-3 c: the same swallow)', 'read -r BEDS_URL\ncurl -sS "$BEDS_URL"', 'a block that reads a value has 1 line(s) after the read'],
    ['two reads on two lines, the first with a line after it', 'read -r A\nread -rs B && export B', 'a block that reads a value has'],
  ])('plant — %s is rejected', (_name, block, message) => {
    const out = inScratch({ 'runbook-x.md': `\`\`\`bash\n${block}\n\`\`\`\n\nThen:\n\n\`\`\`bash\necho "$A"\nunset A B BEDS_URL\n\`\`\`\n` });
    expect(out.join('\n')).toContain(message);
  });

  test('plant — a read inside an indented fence (a list item) with a line after it is rejected', () => {
    const out = inScratch({ 'nested/runbook-y.md': `1. A step:\n\n   \`\`\`bash\n   read -rs TOKEN && export TOKEN\n   curl -H "x: $TOKEN" https://example.invalid\n   \`\`\`\n\n   \`\`\`bash\n   unset TOKEN\n   \`\`\`\n` });
    expect(out.join('\n')).toContain(`${join(DOCS, 'nested', 'runbook-y.md')}:3: a block that reads a value has 1 line(s) after the read`);
  });

  test.each([
    ['a command block that does not unset at all', 'psql "$DATABASE_URL" -tAc "select 1"', 'does not end by unsetting PROBE, DATABASE_URL'],
    ['a command block whose unset misses one of two values', 'echo "$PROBE"\nunset DATABASE_URL', 'does not end by unsetting PROBE'],
    ['a command block that reads a value of its own', 'read -r X\nunset DATABASE_URL PROBE X', 'reads a value itself'],
  ])('plant — %s is rejected', (_name, cmd, message) => {
    const out = inScratch({ 'runbook-x.md': PAIR('read -r PROBE; read -rs DATABASE_URL && export DATABASE_URL', cmd) });
    expect(out.join('\n')).toContain(message);
  });

  test('plant — a connection block with no command block after it is rejected', () => {
    const out = inScratch({ 'runbook-x.md': 'Step.\n\n```bash\nread -rs DATABASE_URL && export DATABASE_URL\n```\n' });
    expect(out.join('\n')).toContain('a connection block with no command block after it');
  });
});
