/**
 * scripts/deferred_register.mjs
 *
 * THE DEFERRED-ITEMS REGISTER'S PARSER, importable (R-2026-09-29-171, EU-3 a).
 *
 * The register is the table under "Deferred items — this record is where the list
 * lives" in the decision record, which is held outside this repository (see
 * RECORD_IN_RECORDS_DIR below). Two readers
 * need the same parse: `tests/compliance/deferred_items.test.ts`, which guards the
 * table, and `scripts/pr_evidence.mjs`, which prints the register by kind in the PR
 * evidence block. Until EU the parser lived in the test file, which calls vitest's
 * `describe()` at top level and is TypeScript, so no script could import it; a second
 * copy in the script would be two derivations free to drift apart. So it lives here,
 * once, with its types beside it in `scripts/deferred_register.d.mts` (the precedent is
 * `eslint.config.d.mts`).
 *
 * MOVED WITH NO CHANGE IN BEHAVIOUR. The body is the test file's, with the TypeScript
 * annotations removed. The proof that nothing moved is recorded in R-2026-09-29-171:
 * the test file's (name, status) pairs before and after are identical.
 *
 * STRICT PARSING. A missing section, header or separator, a row without exactly four
 * cells, a row after the table has ended, and an empty register are each returned as an
 * error. None of them is skipped. This module prints nothing and exits nothing: its
 * callers decide what an error means.
 *
 * CLASSIFICATION (Clause 5): LIVE. Its subject, the register, exists.
 */

export const SECTION = '## Deferred items — this record is where the list lives';
export const HEADER = '| Item | Ruling | Gate kind | Gate |';
export const KINDS = ['BOX', 'TRIGGER', 'VERSION'];

/**
 * WHERE THE DECISION RECORD IS READ FROM (FU-1, FU-2). The record is not in this
 * repository: it lives in the founder's records directory, which OPENBED_RECORDS_DIR
 * names, unset by default. Both readers (scripts/pr_evidence.mjs and
 * tests/compliance/deferred_items.test.ts) take the variable's name and the segments
 * below from here, so neither restates them. Segments, not a joined string, because this
 * module imports nothing.
 */
export const RECORDS_DIR_ENV = 'OPENBED_RECORDS_DIR';
export const RECORD_IN_RECORDS_DIR = ['Decision records, sprint kickoffs and sweeps', 'decision-2026-09-14-public-private-split.md'];

/** The register's rows, and every way the table failed to parse. */
export function parseRegister(record) {
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

  const rows = [];
  const errors = [];
  for (let i = header + 2; i < end && (lines[i] ?? '').startsWith('|'); i += 1) {
    const raw = lines[i];
    if (!raw.trimEnd().endsWith('|')) {
      errors.push(`line ${i + 1}: malformed register row (it does not end with "|"): ${raw.slice(0, 80)}`);
      continue;
    }
    const cells = raw.trim().slice(1, -1).split('|').map((c) => c.trim());
    if (cells.length !== 4) {
      errors.push(`line ${i + 1}: malformed register row, 4 cells expected and ${cells.length} found: ${raw.slice(0, 80)}`);
      continue;
    }
    const [item, ruling, kind, gate] = cells;
    rows.push({ item, ruling, kind, gate, line: i + 1 });
  }
  // A line that is not a row ends the table. A row after that point would be silently
  // dropped, so it is a violation, not a row (R-2026-09-26-126: DB-6 asked for a note
  // "under" a row, and a note there would have cut every row below it out of the guard).
  let tableEnd = header + 2;
  while (tableEnd < end && (lines[tableEnd] ?? '').startsWith('|')) tableEnd += 1;
  for (let i = tableEnd; i < end; i += 1) {
    if ((lines[i] ?? '').startsWith('|')) errors.push(`line ${i + 1}: a table row after the table ended -- every row must be in one unbroken table, or it is not read at all`);
  }
  if (rows.length === 0 && errors.length === 0) errors.push('the register has no rows: a guard over an empty table is not a pass');
  return { rows, errors };
}
