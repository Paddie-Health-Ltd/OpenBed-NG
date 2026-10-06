import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, copyMigrations, place, withScratch } from './_scratch.js';
import FIXTURE from '../../packages/fixtures/reporting-approval-columns.json';

/**
 * THE TWO COLUMN LISTS THAT HOLD WHAT A FACILITY SIGNED, AND NEITHER MAY GROW BY ACCIDENT
 * (migration 029; R-2026-09-30-201 GA; ruling FX P2, requirement 2).
 *
 * app.facility_reporting_approval is the append-only history of the reporting model a facility
 * approved. app.facility_agreement is the acceptance record, one row per facility, never
 * overwritten. The approval is kept OUT of the acceptance record because a model on that row
 * would be overwritten by the first approved change, and clause 8.6 of the agreement (as the
 * ruling cites it) says the acceptance record holds a date, a version and a job title and is
 * kept permanently. So: the approval table's column list is exact and carries no identity or
 * free-text column, and the agreement's column list does not move at all.
 *
 * This is the STATIC leg. It parses the CREATE TABLE blocks in database/migrations/ and
 * compares each against packages/fixtures/reporting-approval-columns.json. Its sibling,
 * tests/db/reporting_approval_column_list.test.ts, reads the live catalogue against the same
 * file. They are two blocks, not one (.claude/rules/test-conventions.md section 7), because they
 * live in different vitest projects and one has no database; both import the one fixture and
 * neither restates it (section 8), so drift needs an edit to that file, which reddens both.
 *
 * NO NEW SCRIPT. The audit-log column guard is a shell script with its own charter row and
 * leg-register entries. This one is TypeScript over the migration text and adds none of those,
 * and the choice is stated here so nobody reads the difference as an oversight.
 *
 * CLASSIFICATION (Clause 5): LIVE. Both tables exist in the migrations now, 021 and 029.
 *
 * NOT ASSERTED HERE, deliberately: the CONTENTS of a row, and any change made by a route this
 * parser cannot see (a DO block that runs ALTER TABLE through EXECUTE). The live catalogue read
 * in tests/db/reporting_approval_column_list.test.ts is the leg that covers those.
 */

interface Fixture {
  approval: { table: string; columns: readonly string[]; forbidden: readonly string[] };
  agreement: { table: string; columns: readonly string[] };
}

/** Forward migrations under `root`, as [file, text]. */
function forwardMigrations(root: string): [string, string][] {
  const dir = join(root, 'database', 'migrations');
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('.down.sql'))
    .sort()
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
}

/**
 * Every column name of every `CREATE TABLE [IF NOT EXISTS] <table> (` block, one array per
 * block. A block runs from that line, at column 0, to the next line that is exactly `);`.
 * A column line is indented exactly four spaces and starts with a lowercase identifier:
 * comments, CONSTRAINT lines and their continuations never match.
 */
function blocksOf(text: string, table: string): string[][] {
  const lines = text.split('\n');
  const start = new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?${table.replace('.', '\\.')}\\s*\\(\\s*$`);
  const out: string[][] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!start.test(lines[i] ?? '')) continue;
    const cols: string[] = [];
    for (let j = i + 1; j < lines.length && (lines[j] ?? '').trim() !== ');'; j += 1) {
      const m = /^ {4}([a-z_][a-z0-9_]*)\s+\S/.exec(lines[j] ?? '');
      if (m !== null) cols.push(m[1] as string);
    }
    out.push(cols);
  }
  return out;
}

/** The text with `--` comments removed, so a sentence in a comment is never read as a statement. */
const stripComments = (text: string): string => text.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

function violations(root: string, fx: Fixture): string[] {
  const out: string[] = [];
  const migs = forwardMigrations(root);
  if (migs.length === 0) return ['no forward migration was read, so no column list was checked'];
  if (fx.approval.columns.length === 0 || fx.agreement.columns.length === 0 || fx.approval.forbidden.length === 0) {
    return ['the fixture has an empty list, so it would allow anything'];
  }
  for (const [label, table, expected] of [
    ['approval', fx.approval.table, fx.approval.columns],
    ['agreement', fx.agreement.table, fx.agreement.columns],
  ] as const) {
    const blocks = migs.flatMap(([, text]) => blocksOf(text, table));
    if (blocks.length !== 1) {
      out.push(`${table}: expected exactly one CREATE TABLE block, found ${blocks.length}`);
      continue;
    }
    const actual = blocks[0] as string[];
    const extra = actual.filter((c) => !expected.includes(c));
    const missing = expected.filter((c) => !actual.includes(c));
    if (extra.length > 0) out.push(`${table} has columns not in the fixture: ${extra.join(', ')}`);
    if (missing.length > 0) out.push(`the fixture names columns ${table} does not have: ${missing.join(', ')}`);
    if (label === 'approval') {
      for (const c of actual) if (fx.approval.forbidden.includes(c)) out.push(`${table} has the forbidden column '${c}'`);
    }
    const alter = new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${table.replace('.', '\\.')}\\b[^;]*\\bADD\\s+COLUMN\\b`, 'i');
    for (const [file, text] of migs) {
      if (alter.test(stripComments(text))) out.push(`${file}: ALTER TABLE ${table} ADD COLUMN`);
    }
  }
  return out;
}

/** Replaces `from` with `to` exactly once, and throws if the plant did not land. */
function mutate(text: string, from: string, to: string): string {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`the plant did not land: its anchor occurs ${n} times, not once: ${from.slice(0, 80)}`);
  return text.replace(from, () => to);
}

const APPROVAL_FILE = '029_facility_reporting_approval.sql';
const AGREEMENT_FILE = '021_facility_agreement_and_contact_write.sql';

/** A scratch copy of the corpus with one migration rewritten. */
function plant(root: string, file: string, edit: (text: string) => string): void {
  copyMigrations(root);
  const target = join(root, 'database', 'migrations', file);
  writeFileSync(target, edit(readFileSync(target, 'utf8')), 'utf8');
}

describe('the approval and agreement column lists, statically', () => {
  test('real migration corpus is accepted', () => {
    const v = violations(REPO_ROOT, FIXTURE);
    expect(v, v.join('\n')).toEqual([]);
  });

  test('the fixture is read as written: eight approval columns, seven agreement columns, and a populated forbidden list', () => {
    expect(FIXTURE.approval.columns).toEqual(['id', 'facility_id', 'model', 'approved_on', 'agreement_version', 'approved_by_role', 'recorded_at', 'recorded_session']);
    expect(FIXTURE.agreement.columns).toEqual(['facility_id', 'accepted_on', 'version', 'signatory_role', 'recorded_at', 'recorded_session', 'withdrawn_on']);
    expect(FIXTURE.approval.forbidden.length).toBeGreaterThan(10);
  });

  test('the parser finds each block in the real corpus, with the columns the fixture lists (it is not accepting by finding nothing)', () => {
    const migs = forwardMigrations(REPO_ROOT);
    expect(migs.flatMap(([, t]) => blocksOf(t, FIXTURE.approval.table))).toEqual([[...FIXTURE.approval.columns]]);
    expect(migs.flatMap(([, t]) => blocksOf(t, FIXTURE.agreement.table))).toEqual([[...FIXTURE.agreement.columns]]);
  });

  test.each([
    ['a full_name column on the approval table (forbidden, and not in the fixture)', APPROVAL_FILE, '    recorded_session  uuid,\n', '    recorded_session  uuid,\n    full_name         text,\n', ['has columns not in the fixture: full_name', "the forbidden column 'full_name'"]],
    ['an unforbidden column on the approval table', APPROVAL_FILE, '    recorded_session  uuid,\n', '    recorded_session  uuid,\n    updated_by_email  text,\n', ['has columns not in the fixture: updated_by_email']],
    ['a removed approval column', APPROVAL_FILE, '    approved_on       date NOT NULL,\n', '', ['the fixture names columns app.facility_reporting_approval does not have: approved_on']],
    // THE PLANT THAT HOLDS REQUIREMENT 2, aimed at a tracked file this change does not edit.
    ['a reporting_model column on app.facility_agreement (the acceptance record)', AGREEMENT_FILE, '    withdrawn_on     date,\n', '    withdrawn_on     date,\n    reporting_model  text,\n', ['app.facility_agreement has columns not in the fixture: reporting_model']],
    ['an approved_on column on app.facility_agreement', AGREEMENT_FILE, '    withdrawn_on     date,\n', '    withdrawn_on     date,\n    approved_on      date,\n', ['app.facility_agreement has columns not in the fixture: approved_on']],
    ['a removed agreement column', AGREEMENT_FILE, '    signatory_role   text,\n', '', ['the fixture names columns app.facility_agreement does not have: signatory_role']],
  ])('plant — %s is rejected, by the leg that names it', (_name, file, from, to, messages) => {
    withScratch((root) => {
      plant(root, file, (t) => mutate(t, from, to));
      const v = violations(root, FIXTURE);
      expect(v.length, `the plant was accepted: ${JSON.stringify(v)}`).toBeGreaterThan(0);
      for (const m of messages) expect(v.join('\n'), `no violation names: ${m}`).toContain(m);
    });
  });

  test('plant — a forbidden name that SET EQUALITY ACCEPTS is rejected by the forbidden-name leg alone', () => {
    // The forbidden name is added to BOTH the migration and the fixture, so equality passes and
    // only the forbidden-name leg can produce the failure (the audit-log guard's Leg 2 plant).
    withScratch((root) => {
      plant(root, APPROVAL_FILE, (t) => mutate(t, '    recorded_session  uuid,\n', '    recorded_session  uuid,\n    notes             text,\n'));
      const widened: Fixture = { ...FIXTURE, approval: { ...FIXTURE.approval, columns: [...FIXTURE.approval.columns, 'notes'] } };
      const v = violations(root, widened);
      expect(v).toEqual(["app.facility_reporting_approval has the forbidden column 'notes'"]);
    });
  });

  test.each([
    ['the agreement table, adding the model', 'app.facility_agreement', 'ALTER TABLE app.facility_agreement ADD COLUMN reporting_model text;'],
    ['the agreement table, in lower case and across lines', 'app.facility_agreement', 'alter table app.facility_agreement\n    add column if not exists approved_on date;'],
    ['the approval table', 'app.facility_reporting_approval', 'ALTER TABLE app.facility_reporting_approval ADD COLUMN approver_name text;'],
  ])('plant — a later migration with ALTER TABLE ... ADD COLUMN on %s is rejected', (_name, table, statement) => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/030_plant.sql', `-- ===\n-- 030_plant.sql\n-- Idempotency: n/a\n-- ===\n${statement}\nVALUES ('030_plant.sql')\n`);
      const v = violations(root, FIXTURE);
      expect(v.join('\n'), `an ALTER ... ADD COLUMN was accepted: ${JSON.stringify(v)}`).toContain(`030_plant.sql: ALTER TABLE ${table} ADD COLUMN`);
    });
  });

  test('a sentence in a COMMENT that reads like an ALTER ... ADD COLUMN is not a statement, and is accepted', () => {
    // The most ordinary valid input: a migration header that talks about the very thing the guard
    // forbids (test-conventions section 2, the fifth way a guard goes wrong). Without this leg the
    // guard would red on its own explanation, and be loosened at 2am.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/030_plant.sql', `-- ===\n-- 030_plant.sql\n-- Idempotency: n/a\n-- A later ALTER TABLE app.facility_agreement ADD COLUMN would be refused.\n-- ===\nSELECT 1;\nVALUES ('030_plant.sql')\n`);
      expect(violations(root, FIXTURE)).toEqual([]);
    });
  });

  test('plant — a SECOND CREATE TABLE block for the approval table is refused, not silently merged', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/030_plant.sql',
        `-- ===\n-- 030_plant.sql\n-- Idempotency: n/a\n-- ===\nCREATE TABLE IF NOT EXISTS app.facility_reporting_approval (\n${FIXTURE.approval.columns.map((c) => `    ${c} text`).join(',\n')}\n);\nVALUES ('030_plant.sql')\n`);
      expect(violations(root, FIXTURE).join('\n')).toContain('expected exactly one CREATE TABLE block, found 2');
    });
  });

  test('positive control — reordering two approval columns is accepted: it is a SET check, and a harmless reformat must not red', () => {
    withScratch((root) => {
      plant(root, APPROVAL_FILE, (t) =>
        mutate(
          t,
          '    model             app.reporting_model NOT NULL,\n    approved_on       date NOT NULL,\n',
          '    approved_on       date NOT NULL,\n    model             app.reporting_model NOT NULL,\n',
        ));
      expect(violations(root, FIXTURE)).toEqual([]);
    });
  });

  test('anti-vacuity — a corpus with no migration at all fails, and names itself', () => {
    withScratch((root) => {
      place(root, 'unrelated.txt', 'x');
      expect(violations(root, FIXTURE)).toEqual(['no forward migration was read, so no column list was checked']);
    });
  });

  test('anti-vacuity — a corpus with no CREATE TABLE for either table fails, for each', () => {
    withScratch((root) => {
      place(root, 'database/migrations/001_x.sql', 'select 1;');
      const v = violations(root, FIXTURE);
      expect(v).toEqual([
        'app.facility_reporting_approval: expected exactly one CREATE TABLE block, found 0',
        'app.facility_agreement: expected exactly one CREATE TABLE block, found 0',
      ]);
    });
  });

  test.each([
    ['an empty approval column list', { ...FIXTURE, approval: { ...FIXTURE.approval, columns: [] } }],
    ['an empty agreement column list', { ...FIXTURE, agreement: { ...FIXTURE.agreement, columns: [] } }],
    ['an empty forbidden list', { ...FIXTURE, approval: { ...FIXTURE.approval, forbidden: [] } }],
  ])('anti-vacuity — a fixture with %s fails rather than allowing everything', (_name, fx) => {
    expect(violations(REPO_ROOT, fx as Fixture)).toEqual(['the fixture has an empty list, so it would allow anything']);
  });
});
