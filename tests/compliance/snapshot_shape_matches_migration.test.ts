import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';
import { encodeWard, decodeWard, encodeFacility, decodeFacility } from '../../packages/snapshot/src/codec.js';

/**
 * THE SHARED-FIXTURE LINK, AS CODE.
 *
 * `packages/fixtures/snapshot-shape.json` describes its own column arrays as the
 * frozen surface of migration 007. Without this file that description would be a
 * comment claiming a link -- the exact Clause 5 defect test-conventions section 8
 * records three live instances of, all of which sat inside the very pattern meant
 * to prevent drift. So the claim carries its probe: the fixture and the migration
 * are compared, statically, for exact equality in ordinal order.
 *
 * WHY STATIC AND NOT information_schema. This is a `compliance` test and needs no
 * database. The live twin over information_schema already exists as the frozen-list
 * assertions in `tests/db/rls_anon_column_containment.test.ts`; folding that test's
 * literals into this fixture is Stage 1 work and is not smuggled in here. Until it
 * happens there are three statements of the ward_public column list in the
 * repository -- the migration, that test, and this fixture -- and THIS FILE closes
 * two of the three edges. That is stated rather than left for a reader to discover.
 *
 * NOT ASSERTED HERE, deliberately: column TYPES, nullability and constraints. The
 * snapshot is positional, so the property that matters to a decoder is the set and
 * the ORDER of columns; a type change that keeps the name and position cannot shift
 * a payload. It can still change meaning, and nothing here would see it.
 */

const MIGRATION = join(REPO_ROOT, 'database/migrations/007_public_projection_tables.sql');

const KEYWORDS = new Set(['primary', 'constraint', 'unique', 'check', 'foreign', 'exclude', 'like']);

/**
 * Extract a table's column names, in ordinal order, from CREATE TABLE text.
 *
 * Exported so the plants feed it constructed SQL rather than editing the real
 * migration -- a plant applied to a real file can silently no-op, and that is
 * indistinguishable from a guard with a hole.
 *
 * Comments are stripped BEFORE the parenthesis walk, deliberately: 007's column
 * comments contain `app.gate(...)` and `(finding F3)`, and a depth counter that
 * counts those ends the table body in the wrong place and reports a short list.
 */
export function columnsOf(sql: string, qualifiedTable: string): string[] {
  const withoutComments = sql.replace(/--[^\n]*/g, '');
  const opener = new RegExp(
    `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${qualifiedTable.replace('.', '\\.')}\\s*\\(`,
    'i',
  );
  const found = opener.exec(withoutComments);
  if (!found) {
    throw new Error(`no CREATE TABLE for ${qualifiedTable} in the given SQL — the parser found nothing to check`);
  }

  const start = found.index + found[0].length;
  let depth = 1;
  let end = -1;
  for (let i = start; i < withoutComments.length; i += 1) {
    const ch = withoutComments[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error(`unterminated CREATE TABLE body for ${qualifiedTable} — the parser did not find the closing parenthesis`);
  }

  const body = withoutComments.slice(start, end);
  const parts: string[] = [];
  let depth2 = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth2 += 1;
    if (ch === ')') depth2 -= 1;
    if (ch === ',' && depth2 === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);

  const names: string[] = [];
  for (const part of parts) {
    const first = part.trim().split(/\s+/)[0];
    if (first === undefined || first === '') continue;
    if (KEYWORDS.has(first.toLowerCase())) continue;
    names.push(first);
  }
  return names;
}

describe('snapshot shape matches migration 007', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  test('anti-vacuity — the migration corpus is non-empty and holds both tables', () => {
    // If 007 were renamed or emptied, every equality below would compare two
    // things the parser invented and this guard would report green over nothing.
    expect(sql.length, `${MIGRATION} is empty`).toBeGreaterThan(500);
    expect(sql).toContain('public.ward_public');
    expect(sql).toContain('public.facility_public');
  });

  test('ward_public column list regression — the fixture equals the migration exactly', () => {
    const actual = columnsOf(sql, 'public.ward_public');
    expect(actual, `migration 007 and snapshot-shape.json disagree. Parsed: ${JSON.stringify(actual)}`)
      .toEqual(SHAPE.wardColumns);
  });

  test('facility_public column list regression — the fixture equals the migration exactly', () => {
    const actual = columnsOf(sql, 'public.facility_public');
    expect(actual, `migration 007 and snapshot-shape.json disagree. Parsed: ${JSON.stringify(actual)}`)
      .toEqual(SHAPE.facilityColumns);
  });

  const TABLE = 'public.demo';
  const base = `CREATE TABLE IF NOT EXISTS ${TABLE} (
    facility_id uuid NOT NULL,
    -- a comment mentioning app.gate(x, y) and (finding F3)
    bed_count integer,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (facility_id, bed_count)
);`;

  test('positive control — a table with comments, a function call and a table constraint parses correctly', () => {
    // A parser that rejects the real shapes is a guard people route around.
    expect(columnsOf(base, TABLE)).toEqual(['facility_id', 'bed_count', 'updated_at']);
  });

  test('plant — an added column is detected', () => {
    const planted = base.replace('    updated_at timestamptz NOT NULL,', '    reason_code text,\n    updated_at timestamptz NOT NULL,');
    expect(planted, 'the plant did not mutate the SQL — re-check the pattern before blaming the parser').not.toEqual(base);
    expect(columnsOf(planted, TABLE)).toEqual(['facility_id', 'bed_count', 'reason_code', 'updated_at']);
  });

  test('plant — a reordered column is detected, because order is what a positional payload rides on', () => {
    const planted = `CREATE TABLE IF NOT EXISTS ${TABLE} (
    bed_count integer,
    facility_id uuid NOT NULL,
    updated_at timestamptz NOT NULL
);`;
    const parsed = columnsOf(planted, TABLE);
    expect(parsed).not.toEqual(['facility_id', 'bed_count', 'updated_at']);
    expect(parsed).toEqual(['bed_count', 'facility_id', 'updated_at']);
  });

  test('plant — a missing table is fatal rather than an empty list', () => {
    // An empty list compared against an empty fixture would pass. The parser must
    // refuse to produce a verdict it could not derive.
    expect(() => columnsOf('SELECT 1;', TABLE)).toThrow(/no CREATE TABLE/);
  });
});

describe('snapshot codec', () => {
  test('the golden ward rows round-trip through decode and encode unchanged', () => {
    for (const row of SHAPE.golden.wards) {
      expect(encodeWard(decodeWard(row))).toEqual(row);
    }
  });

  test('the golden facility rows round-trip through decode and encode unchanged', () => {
    for (const row of SHAPE.golden.facilities) {
      expect(encodeFacility(decodeFacility(row))).toEqual(row);
    }
  });

  test('decode names the columns the fixture names, in order', () => {
    const first = SHAPE.golden.wards[0];
    expect(first, 'the golden payload has no ward rows — the round-trip legs above are vacuous').toBeDefined();
    expect(Object.keys(decodeWard(first as unknown[]))).toEqual(SHAPE.wardColumns);
  });

  test('plant — a row of the wrong arity is refused rather than silently shifted', () => {
    const short = SHAPE.golden.wards[0]?.slice(0, 3) ?? [];
    expect(() => decodeWard(short)).toThrow(/expected 10 values/);
  });

  test('plant — encoding a row missing a column is refused rather than shifting every later column', () => {
    const complete = decodeWard(SHAPE.golden.wards[0] as unknown[]);
    delete complete['gated_by'];
    expect(() => encodeWard(complete)).toThrow(/missing gated_by/);
  });

  test('the gated ward in the golden payload really is gated — the fixture is not all happy rows', () => {
    const gated = SHAPE.golden.wards.map((r) => decodeWard(r)).filter((r) => r['gated_by'] !== null);
    expect(gated.length, 'no gated row in the golden payload').toBeGreaterThan(0);
    expect(gated[0]?.['accepting_effective'], 'a gated ward is published as accepting').toBe(false);
    expect(gated[0]?.['bed_count'], 'the gated row has no beds, so it cannot catch a decoder that ignores the gate').toBeGreaterThan(0);
  });
});
