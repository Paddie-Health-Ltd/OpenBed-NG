import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { withScratch, place, REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER THE PREDICTION TOOL -- scripts/predict_counts.mjs.
 *
 * WHY IT EXISTS. Condition I (founder ruling, 2026-09-14) requires the expected
 * suite total to be stated before attest_counts runs. The 015 prediction was
 * typed by hand and labelled one file "42 -> 45" when the artefact said
 * 45 -> 48. The delta was right, so the total agreed and nothing reddened: a
 * composed number inside the control built to catch composed numbers. Ruling
 * R-2026-09-15-02 item 3: baselines come from the artefact. This tool reads
 * them; only deltas and their reasons are typed.
 *
 * THE POSITIVE CONTROL IS A REAL VITEST JUNIT SHAPE: a root <testsuites> with a
 * declared total and one <testsuite name="<file>" tests="N"> per file, as
 * vitest 5.0.0 writes it. The most ordinary input -- an unchanged file plus one
 * new one -- must be accepted (test-conventions.md section 2, the fifth way).
 *
 * NOT ASSERTED HERE, deliberately: that the deltas are right, and that the
 * baseline file came from the base commit. The first is tested by the
 * attestation the prediction precedes -- a disagreement is the finding. The
 * second is provenance, which a tool that sees a file cannot establish.
 */
const TOOL = join(REPO_ROOT, 'scripts/predict_counts.mjs');

function predict(args: string[]): { status: number; out: string } {
  try {
    return { status: 0, out: execFileSync('node', [TOOL, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function suite(name: string, n: number, declared = n): string {
  const cases = Array.from({ length: n }, (_, i) => `    <testcase classname="${name}" name="t${i}" time="0.001">\n    </testcase>`).join('\n');
  return `  <testsuite name="${name}" timestamp="2026-09-15T00:00:00.000Z" hostname="h" tests="${declared}" failures="0" errors="0" skipped="0" time="0.1">\n${cases}\n  </testsuite>`;
}

function junit(suites: [string, number, number?][], rootDeclared?: number): string {
  const total = suites.reduce((a, [, n]) => a + n, 0);
  return `<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites name="vitest tests" tests="${rootDeclared ?? total}" failures="0" errors="0" time="1">\n${suites.map(([s, n, d]) => suite(s, n, d)).join('\n')}\n</testsuites>\n`;
}

const BASE: [string, number][] = [
  ['tests/compliance/down_migration_symmetry.test.ts', 45],
  ['tests/db/read_rpc_caps.test.ts', 5],
];

function run(xml: string, deltas: unknown): { status: number; out: string } {
  return withScratch((root) => {
    place(root, 'junit.xml', xml);
    place(root, 'deltas.json', JSON.stringify(deltas));
    return predict([join(root, 'junit.xml'), join(root, 'deltas.json')]);
  });
}

describe('predict_counts — baselines from the artefact, deltas typed', () => {
  test('real predict_counts accepts an ordinary baseline and prints baselines READ from it', () => {
    const r = run(junit(BASE), {
      deltas: [
        { file: 'tests/compliance/down_migration_symmetry.test.ts', delta: 3, condition: '016', reason: 'three per migration' },
        { file: 'tests/db/new_file.test.ts', delta: 2, condition: 'F', reason: 'real; one plant', new: true },
      ],
    });
    expect(r.status, `an ordinary prediction was refused:\n${r.out}`).toBe(0);
    expect(r.out, `the baseline was not read from the artefact:\n${r.out}`).toContain('tests/compliance/down_migration_symmetry.test.ts  45 -> 48');
    expect(r.out).toContain('tests/db/new_file.test.ts  new -> 2');
    expect(r.out, `the total is not the artefact's plus the deltas:\n${r.out}`).toContain('EXPECTED  : 50 +3 +2 = 55');
  });

  test('plant — a typed baseline is rejected, even when it happens to be right', () => {
    const r = run(junit(BASE), {
      deltas: [{ file: 'tests/compliance/down_migration_symmetry.test.ts', delta: 3, condition: '015', reason: 'x', baseline: 42 }],
    });
    expect(r.status, `a typed baseline was accepted:\n${r.out}`).toBe(2);
    expect(r.out).toContain('carries a typed baseline');
    expect(r.out).toContain('Baselines are read from the JUnit artefact, never typed');
  });

  test('plant — a truncated baseline is rejected', () => {
    const cut = junit(BASE).replace(/<\/testsuites>\s*$/, '');
    const r = run(cut, { deltas: [{ file: 'tests/db/read_rpc_caps.test.ts', delta: 1, condition: 'A', reason: 'x' }] });
    expect(r.status, `a truncated baseline was accepted:\n${r.out}`).toBe(2);
    expect(r.out).toContain('the baseline JUnit file does not end with </testsuites>.');
    expect(r.out).toContain('A baseline cut off mid-write predicts a smaller suite');
  });

  test('plant — a suite whose testcases disagree with its declared total is rejected', () => {
    const r = run(junit([['tests/db/read_rpc_caps.test.ts', 5, 6]], 5), {
      deltas: [{ file: 'tests/db/read_rpc_caps.test.ts', delta: 1, condition: 'A', reason: 'x' }],
    });
    expect(r.status, `a self-inconsistent suite was accepted:\n${r.out}`).toBe(2);
    expect(r.out).toContain('declares tests=6 but holds 5 <testcase> elements.');
    expect(r.out).toContain('A suite that does not agree with its own declared total is not a baseline.');
  });

  test('plant — a root total that disagrees with its suites is rejected', () => {
    const r = run(junit(BASE, 49), { deltas: [{ file: 'tests/db/read_rpc_caps.test.ts', delta: 1, condition: 'A', reason: 'x' }] });
    expect(r.status, `a root/suite disagreement was accepted:\n${r.out}`).toBe(2);
    expect(r.out).toContain('the baseline root declares tests=49 but its suites hold 50 testcases.');
  });

  test('plant — a delta against a file absent from the baseline, not marked new, is rejected', () => {
    const r = run(junit(BASE), { deltas: [{ file: 'tests/db/typo_path.test.ts', delta: 1, condition: 'A', reason: 'x' }] });
    expect(r.status, `a delta against a missing file was accepted:\n${r.out}`).toBe(2);
    expect(r.out).toContain('which is not in the baseline and is not marked new.');
    expect(r.out).toContain('Either the path is wrong or the file is new; say which.');
  });

  test('plant — a file marked new that the baseline already holds is rejected', () => {
    const r = run(junit(BASE), { deltas: [{ file: 'tests/db/read_rpc_caps.test.ts', delta: 1, condition: 'A', reason: 'x', new: true }] });
    expect(r.status, `a mislabelled new file was accepted:\n${r.out}`).toBe(2);
    expect(r.out).toContain('as new, but the baseline already holds it with 5 tests.');
  });

  test('plant — a delta with no reason is rejected', () => {
    const r = run(junit(BASE), { deltas: [{ file: 'tests/db/read_rpc_caps.test.ts', delta: 1, condition: 'A', reason: '  ' }] });
    expect(r.status, `a reasonless delta was accepted:\n${r.out}`).toBe(2);
    expect(r.out).toContain('names no condition or no reason. A delta without its reason cannot be checked against the change.');
  });

  test('plant — a delta that is not an integer is rejected', () => {
    const r = run(junit(BASE), { deltas: [{ file: 'tests/db/read_rpc_caps.test.ts', delta: '3', condition: 'A', reason: 'x' }] });
    expect(r.status, `a string delta was accepted:\n${r.out}`).toBe(2);
    expect(r.out).toContain('needs a string file and an integer delta');
  });

  test('plant — an unknown key is rejected', () => {
    const r = run(junit(BASE), { deltas: [{ file: 'tests/db/read_rpc_caps.test.ts', delta: 1, condition: 'A', reason: 'x', expected: 6 }] });
    expect(r.status, `an unknown key was accepted:\n${r.out}`).toBe(2);
    expect(r.out).toContain('carries keys this script does not accept: expected');
  });

  test('plant — a delta that takes a file below zero is rejected', () => {
    const r = run(junit(BASE), { deltas: [{ file: 'tests/db/read_rpc_caps.test.ts', delta: -6, condition: 'X', reason: 'x' }] });
    expect(r.status, `a negative count was accepted:\n${r.out}`).toBe(2);
    expect(r.out).toContain('below zero tests');
  });

  test('plant — an unreadable baseline and an unreadable deltas file are rejected', () => {
    const a = predict(['/nonexistent/junit.xml', '/nonexistent/deltas.json']);
    expect(a.status, a.out).toBe(2);
    expect(a.out).toContain('cannot read the baseline JUnit file');
    withScratch((root) => {
      place(root, 'junit.xml', junit(BASE));
      place(root, 'deltas.json', '{ not json');
      const b = predict([join(root, 'junit.xml'), join(root, 'deltas.json')]);
      expect(b.status, b.out).toBe(2);
      expect(b.out).toContain('cannot read the deltas file as JSON');
    });
  });

  test('plant — a baseline testsuite with no declared total is rejected', () => {
    const xml = junit(BASE).replace(/ tests="45"/, '');
    const r = run(xml, { deltas: [{ file: 'tests/db/read_rpc_caps.test.ts', delta: 1, condition: 'A', reason: 'x' }] });
    expect(r.status, `a suite with no declared total was accepted:\n${r.out}`).toBe(2);
    expect(r.out).toContain('a baseline <testsuite> carries no name or no declared tests total');
  });

  test('plant — no arguments is a usage failure, not a prediction', () => {
    const r = predict([]);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('usage: node scripts/predict_counts.mjs <baseline-junit.xml> <deltas.json>');
  });

  test('anti-vacuity — a baseline with no testcases, and a deltas file with no deltas, both fail', () => {
    const empty = run(junit([]), { deltas: [{ file: 'tests/db/x.test.ts', delta: 1, condition: 'A', reason: 'x', new: true }] });
    expect(empty.status, `an empty baseline produced a prediction:\n${empty.out}`).toBe(2);
    expect(empty.out).toContain('the baseline JUnit file holds no testcases.');
    expect(empty.out).toContain('A prediction from an empty baseline predicts nothing.');

    const none = run(junit(BASE), { deltas: [] });
    expect(none.status, `an empty deltas file produced a prediction:\n${none.out}`).toBe(2);
    expect(none.out).toContain('the deltas file holds no deltas.');
    expect(none.out).toContain('A change that adds no tests states that with a delta of 0 and its reason');
  });
});
