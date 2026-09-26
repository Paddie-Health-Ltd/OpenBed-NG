import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

/**
 * GUARD: THE DEFERRED-ITEMS REGISTER AND THE FACILITY-ONE CHECKLIST HOLD EACH OTHER
 * (R-2026-09-26-121 CW-6).
 *
 * THE DEFECT. R-2026-09-24-75 BC-7 deferred the public-site and ward-console design pass
 * until it "waits for Cowork's brief". That gate had no observable event and no checklist
 * box. The facility-one checklist at runbook 12.4 step 1 was compiled by searching for the
 * phrase "before facility one", and BC-7 contained no such phrase. So the pass fell out of
 * every list that drives work, and nothing went red.
 *
 * THE RULE (method note 22, as amended by CW-4). Every deferral names exactly one gate:
 *   - BOX: a box at runbook 12.4 step 1;
 *   - TRIGGER: an observable event;
 *   - VERSION: out of v1, reconsidered at a named point.
 * The decision record's section "Deferred items — this record is where the list lives"
 * holds one row per gated deferral.
 *
 * WHAT THIS FILE REFUSES, one plant per failure mode:
 *   (a) a Gate kind that is not exactly BOX, TRIGGER or VERSION;
 *   (b) an empty Gate, or one reading TBD, ? or pending;
 *   (c) a BOX row whose ruling no box at 12.4 step 1 carries;
 *   (d) an unticked box at 12.4 step 1 that no BOX row names.
 * (c) and (d) are the two directions of one consistency, so neither side can drift alone.
 * A BOX row's Ruling must also be an R-YYYY-MM-DD-nn id, or (c) could not check it.
 *
 * STRICT PARSING. Both files are markdown, and a lenient parser fails open. A missing
 * section, a missing header or separator, a row without exactly four cells, an empty
 * register and a step 1 with no boxes are each a violation. None of them is skipped.
 *
 * A ruling is matched with whitespace collapsed, because a box wraps its citation across
 * lines. It is also bounded on both sides, so R-2026-09-25-11 never matches inside
 * R-2026-09-25-113.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - that a gate is TRUE, or that a TRIGGER names an event someone can observe. Both are
 *     judgements about what a sentence means, made by reading (CW-5's sweep), not by a
 *     parser. A check that a trigger merely has words in it would pass "waits for X".
 *   - that a BOX row whose box is TICKED has left the register. CW-6 does not ask for
 *     it, and it is reported for Cowork to rule. Until then, a closed item's row can
 *     outlive its box without going red.
 *   - that the register is COMPLETE. No parser can find a deferral that no one wrote
 *     down as one. The sweep that seeded the register is recorded in CW's entry.
 */

const RECORD = join(REPO_ROOT, 'Sprint Kickoffs', 'decision-2026-09-14-public-private-split.md');
const RUNBOOK = join(REPO_ROOT, 'docs', 'runbook-supabase-project-creation.md');

export const SECTION = '## Deferred items — this record is where the list lives';
export const HEADER = '| Item | Ruling | Gate kind | Gate |';
export const STEP_HEADING = '### 12.4 Creating a facility';
const STEP_END = /^2\. \*\*Create\*\*/;
export const KINDS = ['BOX', 'TRIGGER', 'VERSION'] as const;
const NOT_A_GATE = new Set(['', 'tbd', '?', 'pending']);
const RULING_ID = /^R-\d{4}-\d{2}-\d{2}-\d+(?![\w-])/;

export interface Row {
  item: string;
  ruling: string;
  kind: string;
  gate: string;
  line: number;
}

export interface Box {
  ticked: boolean;
  text: string;
}

/** The register's rows, and every way the table failed to parse. */
export function parseRegister(record: string): { rows: Row[]; errors: string[] } {
  const lines = record.split('\n');
  const start = lines.indexOf(SECTION);
  if (start === -1) return { rows: [], errors: [`no section "${SECTION}" in the record`] };
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end === -1) end = lines.length;

  const header = lines.findIndex((l, i) => i > start && i < end && l === HEADER);
  if (header === -1) return { rows: [], errors: [`no table headed "${HEADER}" in the register section`] };
  if (!/^\|(?:\s*:?-{3,}:?\s*\|){4}$/.test(lines[header + 1] ?? '')) {
    return { rows: [], errors: [`line ${header + 2}: the register's header row has no four-column separator under it`] };
  }

  const rows: Row[] = [];
  const errors: string[] = [];
  for (let i = header + 2; i < end && (lines[i] ?? '').startsWith('|'); i += 1) {
    const raw = lines[i] as string;
    if (!raw.trimEnd().endsWith('|')) {
      errors.push(`line ${i + 1}: malformed register row (it does not end with "|"): ${raw.slice(0, 80)}`);
      continue;
    }
    const cells = raw.trim().slice(1, -1).split('|').map((c) => c.trim());
    if (cells.length !== 4) {
      errors.push(`line ${i + 1}: malformed register row, 4 cells expected and ${cells.length} found: ${raw.slice(0, 80)}`);
      continue;
    }
    const [item, ruling, kind, gate] = cells as [string, string, string, string];
    rows.push({ item, ruling, kind, gate, line: i + 1 });
  }
  if (rows.length === 0 && errors.length === 0) errors.push('the register has no rows: a guard over an empty table is not a pass');
  return { rows, errors };
}

/** The boxes at runbook 12.4 step 1, each with its continuation lines. */
export function parseStep1Boxes(runbook: string): { boxes: Box[]; errors: string[] } {
  const lines = runbook.split('\n');
  const start = lines.indexOf(STEP_HEADING);
  if (start === -1) return { boxes: [], errors: [`no heading "${STEP_HEADING}" in the runbook`] };
  const end = lines.findIndex((l, i) => i > start && STEP_END.test(l.trim()));
  if (end === -1) return { boxes: [], errors: ['12.4 has no step 2 ("2. **Create**"), so step 1 has no end'] };

  const boxes: Box[] = [];
  let cur: { indent: number; ticked: boolean; parts: string[] } | null = null;
  const flush = (): void => {
    if (cur) boxes.push({ ticked: cur.ticked, text: cur.parts.join(' ').replace(/\s+/g, ' ').trim() });
    cur = null;
  };
  for (let i = start + 1; i < end; i += 1) {
    const line = lines[i] as string;
    const m = /^(\s*)- \[([ xX])\] (.*)$/.exec(line);
    if (m) {
      flush();
      cur = { indent: (m[1] as string).length, ticked: m[2] !== ' ', parts: [m[3] as string] };
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (cur && line.trim() !== '' && indent > cur.indent) cur.parts.push(line.trim());
    else flush();
  }
  flush();
  if (boxes.length === 0) return { boxes, errors: ['runbook 12.4 step 1 holds no boxes: a guard over an empty checklist is not a pass'] };
  return { boxes, errors: [] };
}

/** Does `text` carry `ruling`, with whitespace collapsed and a boundary on each side? */
export function carries(text: string, ruling: string): boolean {
  const flat = ruling.replace(/\s+/g, ' ').trim();
  if (flat === '') return false;
  const esc = flat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])${esc}(?![\\w-])`).test(text.replace(/\s+/g, ' '));
}

const bare = (cell: string): string => cell.replace(/[*_`]/g, '').trim();

export function registerViolations(rows: readonly Row[], boxes: readonly Box[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const where = `line ${r.line}, "${r.item.slice(0, 60)}"`;
    if (!(KINDS as readonly string[]).includes(r.kind)) {
      out.push(`(a) ${where}: Gate kind "${r.kind}" is not BOX, TRIGGER or VERSION`);
    }
    if (NOT_A_GATE.has(bare(r.gate).toLowerCase())) {
      out.push(`(b) ${where}: Gate "${r.gate}" is not a gate`);
    }
    if (bare(r.ruling) === '') out.push(`${where}: the Ruling cell is empty`);
    if (r.kind === 'BOX') {
      if (!RULING_ID.test(r.ruling)) {
        out.push(`(c) ${where}: BOX row's Ruling "${r.ruling}" is not an R-YYYY-MM-DD-nn id, so no box can be matched to it`);
      } else if (!boxes.some((b) => carries(b.text, r.ruling))) {
        out.push(`(c) ${where}: BOX row cites ${r.ruling}, and no box at runbook 12.4 step 1 carries it`);
      }
    }
  }
  for (const b of boxes) {
    if (b.ticked) continue;
    if (!rows.some((r) => r.kind === 'BOX' && carries(b.text, r.ruling))) {
      out.push(`(d) an unticked box at runbook 12.4 step 1 has no BOX row in the register: "${b.text.slice(0, 100)}"`);
    }
  }
  return out;
}

/** Everything wrong with a record and runbook pair, parse failures first. */
export function check(record: string, runbook: string): string[] {
  const reg = parseRegister(record);
  const step = parseStep1Boxes(runbook);
  return [...reg.errors, ...step.errors, ...registerViolations(reg.rows, step.boxes)];
}

// ---------------------------------------------------------------------------
// The most ordinary valid input, which every plant below mutates by one thing.
// ---------------------------------------------------------------------------

const OK_RECORD = [
  '# A record',
  '',
  SECTION,
  '',
  'Some prose.',
  '',
  HEADER,
  '|---|---|---|---|',
  '| The first item | R-2026-01-01-01 A1 | BOX | Its box at runbook 12.4 step 1 |',
  '| The second item | R-2026-01-01-02 B | TRIGGER | The first ward-path code containing a digit |',
  '| The third item | R-2026-01-01-03 C | VERSION | Out of v1, reconsidered at v2 scoping |',
  '',
  '## Method notes',
  '',
].join('\n');

const OK_RUNBOOK = [
  STEP_HEADING,
  '',
  '1. **The stop conditions first.**',
  '   - [ ] The first item, with its citation wrapped across a line. (R-2026-01-01-01',
  '     A1)',
  '   - [x] A closed item. (R-2026-01-01-09 Z)',
  '     - a nested note under it',
  '2. **Create** the facility.',
  '',
].join('\n');

/** Apply a plant and prove it took, so a plant that no-ops cannot read as a hole. */
function plant(base: string, from: string, to: string): string {
  const out = base.replace(from, to);
  expect(out, `the plant did not change the text: "${from}" not found`).not.toBe(base);
  return out;
}

describe('the deferred-items register and the facility-one checklist hold each other', () => {
  test('real record and runbook are accepted — every row gated, every box and BOX row matched', () => {
    const record = readFileSync(RECORD, 'utf8');
    const runbook = readFileSync(RUNBOOK, 'utf8');
    const out = check(record, runbook);
    expect(out, out.join('\n')).toEqual([]);
    const { rows } = parseRegister(record);
    const { boxes } = parseStep1Boxes(runbook);
    expect(rows.length, `rows parsed: ${rows.length}`).toBeGreaterThan(0);
    expect(boxes.filter((b) => !b.ticked).length, `boxes parsed: ${JSON.stringify(boxes.map((b) => b.text.slice(0, 40)))}`).toBeGreaterThan(0);
  });

  test('the most ordinary valid register and checklist are accepted', () => {
    const out = check(OK_RECORD, OK_RUNBOOK);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('a ticked box needs no BOX row — (d) is about unticked boxes only', () => {
    // The fixture's ticked box cites a ruling no row names, and it is accepted above.
    const { boxes } = parseStep1Boxes(OK_RUNBOOK);
    expect(boxes.map((b) => b.ticked)).toEqual([false, true]);
    expect(boxes[1]?.text).toContain('a nested note under it');
  });

  test.each(['Trigger', 'BOX/TRIGGER', 'OPEN'])('plant (a) — Gate kind "%s" is rejected', (kind) => {
    const bad = plant(OK_RECORD, '| TRIGGER |', `| ${kind} |`);
    expect(check(bad, OK_RUNBOOK).join('\n')).toContain(`(a) line 10, "The second item": Gate kind "${kind}" is not BOX, TRIGGER or VERSION`);
  });

  test.each(['', 'TBD', '?', 'pending', '**Pending**'])('plant (b) — Gate "%s" is rejected', (gate) => {
    const bad = plant(OK_RECORD, '| The first ward-path code containing a digit |', `| ${gate} |`);
    expect(check(bad, OK_RUNBOOK).join('\n')).toContain('(b) line 10, "The second item": Gate');
  });

  test('plant (c) — a BOX row citing a ruling no box carries is rejected', () => {
    const bad = plant(OK_RECORD, '| The third item | R-2026-01-01-03 C | VERSION |', '| The third item | R-2026-01-01-03 C | BOX |');
    expect(check(bad, OK_RUNBOOK).join('\n')).toContain('(c) line 11, "The third item": BOX row cites R-2026-01-01-03 C, and no box at runbook 12.4 step 1 carries it');
  });

  test('plant (c) — a ruling is matched bounded: -01 never matches inside -013', () => {
    const runbook = plant(OK_RUNBOOK, '(R-2026-01-01-01\n     A1)', '(R-2026-01-01-013 A1)');
    const record = plant(OK_RECORD, 'R-2026-01-01-01 A1', 'R-2026-01-01-01');
    const out = check(record, runbook).join('\n');
    expect(out).toContain('(c) line 9, "The first item": BOX row cites R-2026-01-01-01, and no box');
    expect(out).toContain('(d) an unticked box');
  });

  test('plant (c) — a BOX row whose Ruling is not an R- id is rejected', () => {
    const bad = plant(OK_RECORD, '| R-2026-01-01-01 A1 | BOX |', '| R1 (b) | BOX |');
    expect(check(bad, OK_RUNBOOK).join('\n')).toContain('(c) line 9, "The first item": BOX row\'s Ruling "R1 (b)" is not an R-YYYY-MM-DD-nn id');
  });

  test('plant (d) — an unticked box with no BOX row is rejected', () => {
    const bad = plant(OK_RUNBOOK, '   - [x] A closed item.', '   - [ ] A new open item.');
    expect(check(OK_RECORD, bad).join('\n')).toContain('(d) an unticked box at runbook 12.4 step 1 has no BOX row in the register: "A new open item. (R-2026-01-01-09 Z)');
  });

  test('plant (d) — a box whose BOX row became a TRIGGER is rejected', () => {
    const bad = plant(OK_RECORD, '| R-2026-01-01-01 A1 | BOX |', '| R-2026-01-01-01 A1 | TRIGGER |');
    expect(check(bad, OK_RUNBOOK).join('\n')).toContain('(d) an unticked box at runbook 12.4 step 1 has no BOX row in the register: "The first item');
  });

  test('plant — an empty Ruling cell is rejected', () => {
    const bad = plant(OK_RECORD, '| R-2026-01-01-02 B |', '|  |');
    expect(check(bad, OK_RUNBOOK).join('\n')).toContain('line 10, "The second item": the Ruling cell is empty');
  });

  test.each([
    ['three cells', '| The second item | R-2026-01-01-02 B | TRIGGER |', '3 found'],
    ['five cells', '| The second item | R-2026-01-01-02 B | TRIGGER | a | b |', '5 found'],
  ])('plant — a malformed row (%s) fails rather than being skipped', (_name, row, found) => {
    const bad = plant(OK_RECORD, '| The second item | R-2026-01-01-02 B | TRIGGER | The first ward-path code containing a digit |', row);
    expect(check(bad, OK_RUNBOOK).join('\n')).toContain(`line 10: malformed register row, 4 cells expected and ${found}`);
  });

  test('plant — a row that does not end with "|" fails rather than being skipped', () => {
    const bad = plant(OK_RECORD, 'containing a digit |', 'containing a digit');
    expect(check(bad, OK_RUNBOOK).join('\n')).toContain('line 10: malformed register row (it does not end with "|")');
  });

  test('plant — a header with no separator under it fails', () => {
    const bad = plant(OK_RECORD, '|---|---|---|---|\n', '');
    expect(check(bad, OK_RUNBOOK).join('\n')).toContain("the register's header row has no four-column separator under it");
  });

  test('anti-vacuity — a register with no rows fails', () => {
    const empty = OK_RECORD.split('\n').filter((l) => !l.startsWith('| The ')).join('\n');
    expect(empty).not.toBe(OK_RECORD);
    expect(check(empty, OK_RUNBOOK).join('\n')).toContain('the register has no rows');
  });

  test('anti-vacuity — a record with no register section fails', () => {
    const bad = plant(OK_RECORD, SECTION, '## Deferred items');
    expect(check(bad, OK_RUNBOOK).join('\n')).toContain(`no section "${SECTION}" in the record`);
  });

  test('anti-vacuity — a section with no table headed exactly as ruled fails', () => {
    const bad = plant(OK_RECORD, HEADER, '| Item | Ruling | Kind | Gate |');
    expect(check(bad, OK_RUNBOOK).join('\n')).toContain(`no table headed "${HEADER}"`);
  });

  test('anti-vacuity — a step 1 with no boxes fails', () => {
    const empty = OK_RUNBOOK.split('\n').filter((l) => !/- \[|^\s+(A1\)|- a nested)/.test(l)).join('\n');
    expect(empty).not.toBe(OK_RUNBOOK);
    expect(check(OK_RECORD, empty).join('\n')).toContain('runbook 12.4 step 1 holds no boxes');
  });

  test('anti-vacuity — a runbook with no 12.4 heading, or no step 2 to end step 1, fails', () => {
    expect(check(OK_RECORD, plant(OK_RUNBOOK, STEP_HEADING, '### 12.4 Something else')).join('\n')).toContain(`no heading "${STEP_HEADING}"`);
    expect(check(OK_RECORD, plant(OK_RUNBOOK, '2. **Create**', '2. Create')).join('\n')).toContain('12.4 has no step 2');
  });
});
