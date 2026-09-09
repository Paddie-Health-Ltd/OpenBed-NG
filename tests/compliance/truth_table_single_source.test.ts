import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';
import TRUTH_TABLE from '../../packages/fixtures/truth-table.json';

/**
 * THE STRUCTURE THAT STOPS THE TWO GATE DERIVATIONS DRIFTING.
 *
 * tests/db/gate_truth_table.test.ts asserts that SQL and TypeScript AGREE. This
 * file asserts the thing that keeps that assertion meaningful: that both call
 * sites live inside ONE `test.each` block, over ONE fixture, with no second copy
 * of the table anywhere.
 *
 * Two separate blocks over the same fixture would look equivalent and would not
 * be: they can be edited apart, `.skip`-ed apart, or reordered, and can drift
 * while both stay green. The single block makes running one side without the
 * other impossible to express.
 *
 * NOT ASSERTED HERE, deliberately: that the fixture's expected values are
 * correct. Nothing can assert that -- the fixture IS the specification,
 * transcribed from the kickoff's prose. Its correctness is a review obligation
 * discharged once, at the commit that introduced it. What decays over time, and
 * what these tests cover, is the STRUCTURE around it.
 */

const TEST_FILE = join(REPO_ROOT, 'tests', 'db', 'gate_truth_table.test.ts');

describe('truth table single source', () => {
  test('the fixture holds exactly the specified 60 rows', () => {
    expect(TRUTH_TABLE).toHaveLength(60);
  });

  test('every fixture row is distinct', () => {
    const keys = new Set(
      (TRUTH_TABLE as Record<string, unknown>[]).map((r) =>
        [r['category'], r['anaesthetist'], r['obstetrician'], r['paediatrician'], r['accepting']].join('|'),
      ),
    );
    expect(keys.size).toBe(60);
  });

  test('both derivation sites are called inside ONE test.each block', () => {
    const src = readFileSync(TEST_FILE, 'utf8');

    // Locate the test.each(ROWS) block and take its body up to the next
    // top-level `test(` or `});` at the same depth. Crude, and deliberately so:
    // a parser would be more precise and would also be more likely to silently
    // stop matching after a refactor.
    const start = src.indexOf('test.each(ROWS)');
    expect(start, 'no `test.each(ROWS)` block found — the structure has changed').toBeGreaterThan(-1);

    const nextTest = src.indexOf('\n  test(', start);
    const body = src.slice(start, nextTest === -1 ? src.length : nextTest);

    expect(body, 'the SQL derivation is not called inside the test.each block').toContain('sqlGate(');
    expect(body, 'the TypeScript derivation is not called inside the test.each block').toContain('gate(');
    expect(body).toContain('row.expected_gated_by');
  });

  test('no second literal truth table exists under tests/ or packages/', () => {
    // A copied table is the exact failure this structure prevents: two fixtures,
    // one updated, both green.
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (name === 'node_modules' || name === 'dist') continue;
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (full === join(REPO_ROOT, 'packages', 'fixtures', 'truth-table.json')) continue;
        if (!/\.(ts|json)$/.test(name)) continue;

        const content = readFileSync(full, 'utf8');
        if (content.includes('expected_gated_by') && content.includes('expected_accepting_effective')) {
          // The db test legitimately REFERENCES these field names; a second table
          // would also DEFINE them as data. Distinguish by looking for a literal
          // object assigning them.
          if (/expected_gated_by"?\s*:\s*("|null)/.test(content)) {
            offenders.push(full.replace(`${REPO_ROOT}/`, ''));
          }
        }
      }
    };

    walk(join(REPO_ROOT, 'tests'));
    walk(join(REPO_ROOT, 'packages'));

    expect(offenders, 'a second copy of the truth table exists').toEqual([]);
  });

  test('the fixture is referenced by the db test rather than inlined', () => {
    const src = readFileSync(TEST_FILE, 'utf8');
    expect(src).toContain("packages/fixtures/truth-table.json");
  });
});
