import { describe, expect, test } from 'vitest';
import { sql } from '../setup/db.js';
import FIXTURE from '../../packages/fixtures/reporting-approval-columns.json';

/**
 * THE AUTHORITATIVE LEG of the two column lists in packages/fixtures/reporting-approval-columns.json:
 * the live columns of app.facility_reporting_approval and of app.facility_agreement, read from
 * information_schema, equal the shared fixture exactly, in order (migration 029; ruling FX P2,
 * requirement 2).
 *
 * Its sibling, tests/compliance/reporting_approval_columns.test.ts, parses the migration text
 * statically. This one reads the catalogue, so it catches a column introduced by any route the
 * parser cannot see. They cannot be one test.each block (.claude/rules/test-conventions.md
 * section 7): they live in different vitest projects and one has no database. Both import the
 * one fixture and neither restates it (section 8), so drift needs an edit to that file, which
 * reddens both.
 */

const live = async (table: string): Promise<string[]> => {
  const [schema, name] = table.split('.') as [string, string];
  const rows = await sql()<{ column_name: string }[]>`
    select column_name
      from information_schema.columns
     where table_schema = ${schema} and table_name = ${name}
     order by ordinal_position`;
  return rows.map((r) => r.column_name);
};

describe('the reporting approval and agreement column lists', () => {
  test('the fixture is not vacuous: both lists and the forbidden list are populated', () => {
    expect(FIXTURE.approval.columns.length).toBeGreaterThan(5);
    expect(FIXTURE.approval.forbidden.length).toBeGreaterThan(10);
    expect(FIXTURE.agreement.columns.length).toBeGreaterThan(5);
  });

  test('app.facility_reporting_approval: the live column list equals the fixture exactly, in order', async () => {
    const cols = await live(FIXTURE.approval.table);
    expect(cols.length, 'the table was not found — the assertion would be vacuous').toBeGreaterThan(0);
    expect(cols).toEqual(FIXTURE.approval.columns);
  });

  test('app.facility_reporting_approval: no forbidden identity-bearing or free-text column exists', async () => {
    const cols = await live(FIXTURE.approval.table);
    expect(cols.filter((c) => FIXTURE.approval.forbidden.includes(c)), 'forbidden columns on the approval table').toEqual([]);
  });

  test('app.facility_agreement: the live column list is UNCHANGED — no model, approval or history column has landed on the acceptance record', async () => {
    const cols = await live(FIXTURE.agreement.table);
    expect(cols.length, 'the table was not found — the assertion would be vacuous').toBeGreaterThan(0);
    expect(cols).toEqual(FIXTURE.agreement.columns);
  });
});
