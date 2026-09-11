import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { withScratch, place, REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER THE ATTESTATION TOOL -- scripts/attest_counts.mjs.
 *
 * WRITTEN 2026-09-10 because the leg parser was extended to .mjs and found this
 * script had FIVE legs and no test of any kind. It had been outside the corpus
 * since it was written: the parser matched `echo "FAIL:"` and this file says
 * `console.error`, so it reported as having no legs rather than as having
 * untested ones. A boundary is not a clean bill of health.
 *
 * WHY THE SUBJECT MATTERS. Standard O's whole point is that the six counts are
 * DERIVED, never read off a terminal, because "CI green" and "exit 0" are not
 * attestations -- a required check that was skipped reports as passing, and a
 * database test that silently skipped reports the same way. This script IS the
 * derivation. If it miscounts, every attestation in every pull request is wrong
 * in the direction nobody checks.
 *
 * NOT ASSERTED HERE, deliberately: that the counts match what vitest actually
 * ran. This tool sees a JUnit file, not a test run, and a reporter that wrote a
 * wrong file would be faithfully summarised. The control for that is the
 * anti-vacuity leg -- zero testcases is exit 2 -- plus the ratchet, which reads
 * per-step identity from the same file and would disagree.
 */
const TOOL = join(REPO_ROOT, 'scripts/attest_counts.mjs');

function attest(args: string[]): { status: number; out: string } {
  try {
    return { status: 0, out: execFileSync('node', [TOOL, ...args], { encoding: 'utf8' }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const suite = (cases: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n<testsuite name="s">\n${cases}\n</testsuite>\n</testsuites>\n`;

const pass = (n: string): string => `<testcase classname="c" name="${n}" time="0.01"/>`;
const fail = (n: string): string => `<testcase classname="c" name="${n}"><failure message="m">boom</failure></testcase>`;
const err = (n: string): string => `<testcase classname="c" name="${n}"><error message="m">boom</error></testcase>`;
const skip = (n: string): string => `<testcase classname="c" name="${n}"><skipped/></testcase>`;

describe('attest_counts', () => {
  test('leg — no argument is a usage failure, not a pass', () => {
    const res = attest([]);
    expect(res.status, `running with no argument did not fail:\n${res.out}`).toBe(2);
    expect(res.out).toContain('usage: node scripts/attest_counts.mjs <junit.xml>');
  });

  test('leg — a MISSING junit file is exit 2, and says why', () => {
    // The leg that matters most in CI: an absent report is not a green suite.
    const res = attest([join(REPO_ROOT, 'no-such-file.xml')]);
    expect(res.status, `a missing report was treated as a pass:\n${res.out}`).toBe(2);
    expect(res.out).toContain('cannot read');
    expect(res.out, 'the tool did not say why a missing file is not a pass').toContain('A missing JUnit file is NOT a pass. The suite did not report.');
  });

  test('leg — zero testcases is exit 2, distinct from red', () => {
    // The anti-vacuity leg the ratchet relies on: it distinguishes "the suite
    // collected nothing" (2) from "the suite was red" (1), and the ratchet keys
    // on exactly that difference.
    withScratch((root) => {
      place(root, 'j.xml', suite(''));
      const res = attest([join(root, 'j.xml')]);
      expect(res.status, `an empty suite reported a disposition:\n${res.out}`).toBe(2);
      expect(res.out).toContain('no <testcase> elements found.');
      expect(res.out).toContain('A suite that collected zero tests is not green — it is silent.');
    });
  });

  test('ZERO-RED: all passing is exit 0 with the six counts correct', () => {
    withScratch((root) => {
      place(root, 'j.xml', suite([pass('a'), pass('b'), pass('c')].join('\n')));
      const res = attest([join(root, 'j.xml')]);
      expect(res.status, `a clean suite was not ZERO-RED:\n${res.out}`).toBe(0);
      expect(res.out).toContain('collected=3 ran=3 passed=3 failed=0 errored=0 skipped=0');
      expect(res.out).toContain('ZERO-RED');
    });
  });

  test('RED: a failure is exit 1 and is counted, not swallowed', () => {
    withScratch((root) => {
      place(root, 'j.xml', suite([pass('a'), fail('b'), err('c')].join('\n')));
      const res = attest([join(root, 'j.xml')]);
      expect(res.status, `a red suite reported success:\n${res.out}`).toBe(1);
      expect(res.out).toContain('collected=3 ran=3 passed=1 failed=1 errored=1 skipped=0');
      expect(res.out).not.toContain('ZERO-RED');
    });
  });

  test('a SKIPPED test is visible in the counts — green-by-skip is the thing this exists to expose', () => {
    // test-conventions section 6: `skipped` is one of the six counts precisely so
    // that green-by-skip is visible in the attestation rather than invisible in a
    // terminal summary.
    withScratch((root) => {
      place(root, 'j.xml', suite([pass('a'), skip('b')].join('\n')));
      const res = attest([join(root, 'j.xml')]);
      expect(res.out).toContain('collected=2 ran=1 passed=1 failed=0 errored=0 skipped=1');
      expect(res.status, 'a suite that skipped a test was still ZERO-RED, which is correct — but it must SAY so').toBe(0);
      expect(res.out, 'a skipped test was not called out').toMatch(/NOTE|skipped/);
    });
  });

  test('the identities hold, and they are printed', () => {
    withScratch((root) => {
      place(root, 'j.xml', suite([pass('a'), fail('b'), skip('c')].join('\n')));
      const res = attest([join(root, 'j.xml')]);
      expect(res.out).toContain('ran === passed+failed+errored -> true');
      expect(res.out).toContain('collected === ran+skipped     -> true');
    });
  });
});
