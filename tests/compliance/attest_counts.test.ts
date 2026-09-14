import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
 * EXTENDED 2026-09-14: THE FILE MUST AGREE WITH ITSELF. Two plants passed the
 * old script with exit 0: a report truncated between testcases attested a
 * smaller ZERO-RED, and one cut off before a failing testcase hid the failure.
 * The script now refuses a file with no closing </testsuites>, a root with no
 * declared totals, and any disagreement between the declared tests / failures /
 * errors and what the file holds. Each refusal has one plant below, isolated so
 * that it is the refusal that fires first.
 *
 * THE POSITIVE CONTROLS ARE REAL VITEST OUTPUT, NOT HAND-WRITTEN XML. A refusal
 * that rejects legitimate input is disabled by the next person who hits it
 * (test-conventions section 2, the fifth way). The most ordinary valid input to
 * this tool is a file vitest wrote, so the controls run the pinned vitest in a
 * scratch project and attest what it produced: an all-pass run, the #11 shape
 * (a beforeAll that throws -- one failing entry carrying two <failure>
 * elements, and skipped tests), and an unhandled error. An honest red must stay
 * RED (exit 1), never become a refusal (exit 2).
 *
 * NOT ASSERTED HERE, deliberately:
 *   - WHETHER ANY RUN PRODUCED THE COUNTS. This tool sees a file, and a number
 *     composed without a run has no file. PR #11 recorded collected=509
 *     ZERO-RED that no run produced (found 2026-09-14; the merge gate held).
 *     Nothing here could have caught that, and these tests must not be read as
 *     covering it. The control is behavioural -- counts only from this script's
 *     real output, only for the commit being pushed -- and it is unenforceable
 *     by construction.
 *   - That vitest's own declaration is right. A reporter that wrote a wrong file
 *     consistently -- wrong totals matching wrong testcases -- is faithfully
 *     summarised. The ratchet, which reads per-step identity, is the cross-check.
 *   - Skipped totals, which vitest does not declare on the root.
 */
const TOOL = join(REPO_ROOT, 'scripts/attest_counts.mjs');
const VITEST = join(REPO_ROOT, 'node_modules/.bin/vitest');

function attest(args: string[]): { status: number; out: string } {
  try {
    return { status: 0, out: execFileSync('node', [TOOL, ...args], { encoding: 'utf8' }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

interface Declared {
  tests: number;
  failures: number;
  errors: number;
}

/** Totals the way vitest declares them: per testcase, not per element. */
function declaredFor(cases: string): Declared {
  const bodies = cases.match(/<testcase\b[\s\S]*?(\/>|<\/testcase>)/g) ?? [];
  return {
    tests: bodies.length,
    failures: bodies.filter((b) => /<failure\b/.test(b)).length,
    errors: bodies.filter((b) => !/<failure\b/.test(b) && /<error\b/.test(b)).length,
  };
}

const suite = (cases: string, declared: Declared = declaredFor(cases)): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="vitest tests" tests="${declared.tests}" failures="${declared.failures}" errors="${declared.errors}" time="0.1">\n<testsuite name="s">\n${cases}\n</testsuite>\n</testsuites>\n`;

const pass = (n: string): string => `<testcase classname="c" name="${n}" time="0.01"/>`;
const fail = (n: string): string => `<testcase classname="c" name="${n}"><failure message="m">boom</failure></testcase>`;
const err = (n: string): string => `<testcase classname="c" name="${n}"><error message="m">boom</error></testcase>`;
const skip = (n: string): string => `<testcase classname="c" name="${n}"><skipped/></testcase>`;

/**
 * Run the pinned vitest over a scratch project and return the JUnit it wrote.
 * The scratch root is under the OS temp directory, outside this repository's
 * vitest.config.ts, and the config written here is the only one it sees.
 * VITEST_* variables from the enclosing run are dropped so the child is a
 * fresh run, not a worker of this one.
 */
function realVitestJunit(root: string, files: Record<string, string>): { junit: string; log: string } {
  place(root, 'vitest.config.mjs', "export default { test: { include: ['**/*.test.mjs'], globals: true } };\n");
  for (const [name, body] of Object.entries(files)) place(root, name, body);
  const out = join(root, 'junit.xml');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST')));
  let log = '';
  try {
    log = execFileSync(VITEST, ['run', '--root', root, '--config', join(root, 'vitest.config.mjs'), '--reporter=junit', `--outputFile=${out}`], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string };
    log = `${x.stdout ?? ''}${x.stderr ?? ''}`; // a red child run exits 1; the file is what matters
  }
  expect(existsSync(out), `the child vitest wrote no JUnit file, so there is nothing to attest:\n${log}`).toBe(true);
  return { junit: out, log };
}

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

describe('attest_counts — a file that does not agree with itself is not an attestation', () => {
  test('plant — a report with no closing </testsuites> is refused, even when its totals agree', () => {
    // Isolated: the declared totals match the testcases present, so ONLY the
    // missing closing tag can fire. This is the one truncation a count check
    // alone would miss -- a file cut off after its last testcase.
    withScratch((root) => {
      const full = suite([pass('a'), pass('b')].join('\n'));
      const cut = full.slice(0, full.indexOf('</testsuite>'));
      expect(cut, 'the plant did not remove the closing tag').not.toContain('</testsuites>');
      place(root, 'j.xml', cut);
      const res = attest([join(root, 'j.xml')]);
      expect(res.status, `an unfinished report was attested:\n${res.out}`).toBe(2);
      expect(res.out).toContain('the JUnit file does not end with </testsuites>.');
      expect(res.out).toContain('A report cut off mid-write is not a smaller pass. The counts it yields are not the counts of the run.');
      expect(res.out).not.toContain('ZERO-RED');
    });
  });

  test('plant — a root that declares no totals is refused, not waved through', () => {
    withScratch((root) => {
      place(root, 'j.xml', `<?xml version="1.0"?>\n<testsuites>\n<testsuite name="s">\n${pass('a')}\n</testsuite>\n</testsuites>\n`);
      const res = attest([join(root, 'j.xml')]);
      expect(res.status, `a file with nothing to check against was attested:\n${res.out}`).toBe(2);
      expect(res.out).toContain('the JUnit root <testsuites> declares no tests/failures/errors totals.');
      expect(res.out).toContain('Without a declaration there is nothing to check the counts against, and a check that could not run reports no verdict.');
      expect(res.out).not.toContain('ZERO-RED');
    });
  });

  test('plant — declared tests= above the testcases present is refused', () => {
    withScratch((root) => {
      const cases = [pass('a'), pass('b'), pass('c')].join('\n');
      place(root, 'j.xml', suite(cases, { tests: 4, failures: 0, errors: 0 }));
      const res = attest([join(root, 'j.xml')]);
      expect(res.status, `a file missing a declared testcase was attested:\n${res.out}`).toBe(2);
      expect(res.out).toContain('the root declares tests=4 but the file holds 3 <testcase> elements.');
      expect(res.out).toContain('A file whose testcases do not add up to its own declared total is not a complete record of the run.');
      expect(res.out).not.toContain('ZERO-RED');
    });
  });

  test('plant — declared failures= the file does not hold is refused, with tests= agreeing', () => {
    // Isolated: three testcases declared, three present, so only the failure
    // count disagrees -- the failing testcase's <failure> is the thing lost.
    withScratch((root) => {
      const cases = [pass('a'), pass('b'), pass('c')].join('\n');
      place(root, 'j.xml', suite(cases, { tests: 3, failures: 1, errors: 0 }));
      const res = attest([join(root, 'j.xml')]);
      expect(res.status, `a file that lost a declared failure was attested:\n${res.out}`).toBe(2);
      expect(res.out).toContain('the root declares failures=1 but 0 testcases hold a <failure>.');
      expect(res.out).toContain('A failure the declaration counts and the file does not hold was lost, or never written.');
      expect(res.out).not.toContain('ZERO-RED');
    });
  });

  test('plant — declared errors= the file does not hold is refused, with tests= and failures= agreeing', () => {
    withScratch((root) => {
      const cases = [pass('a'), pass('b')].join('\n');
      place(root, 'j.xml', suite(cases, { tests: 2, failures: 0, errors: 1 }));
      const res = attest([join(root, 'j.xml')]);
      expect(res.status, `a file that lost a declared unhandled error was attested:\n${res.out}`).toBe(2);
      expect(res.out).toContain('the root declares errors=1 but 0 testcases hold an <error>.');
      expect(res.out).toContain('An unhandled error the declaration counts and the file does not hold was lost, or never written.');
      expect(res.out).not.toContain('ZERO-RED');
    });
  });

  test('regression — the 2026-09-14 plant: a report truncated between testcases no longer attests a smaller ZERO-RED', () => {
    withScratch((root) => {
      const full = suite(['a', 'b', 'c', 'd', 'e'].map(pass).join('\n'));
      const cut = full.slice(0, full.indexOf('name="d"') - '<testcase classname="c" '.length);
      place(root, 'j.xml', cut);
      const res = attest([join(root, 'j.xml')]);
      expect(res.status, `a truncated report attested a disposition:\n${res.out}`).toBe(2);
      expect(res.out).not.toContain('ZERO-RED');
      expect(res.out).not.toContain('collected=3');
    });
  });

  test('regression — the 2026-09-14 plant: a failure in a cut-off tail is not hidden behind ZERO-RED', () => {
    withScratch((root) => {
      const full = suite([pass('a'), pass('b'), fail('lost')].join('\n'));
      const cut = full.slice(0, full.indexOf('name="lost"') - '<testcase classname="c" '.length);
      expect(cut, 'the plant did not cut the failing testcase off').not.toContain('<failure');
      place(root, 'j.xml', cut);
      const res = attest([join(root, 'j.xml')]);
      expect(res.status, `a report that lost its failure attested a disposition:\n${res.out}`).toBe(2);
      expect(res.out).not.toContain('ZERO-RED');
    });
  });
});

describe('attest_counts — positive controls: real vitest output is the most ordinary valid input', () => {
  test('real vitest, all passing — accepted as ZERO-RED', () => {
    withScratch((root) => {
      const { junit, log } = realVitestJunit(root, {
        'ordinary.test.mjs': "test('adds', () => { expect(1 + 1).toBe(2); });\ntest('contains', () => { expect('ward').toContain('war'); });\n",
      });
      const res = attest([junit]);
      expect(res.status, `real, clean vitest output was not accepted:\n${res.out}\n--- child vitest ---\n${log}\n--- junit ---\n${readFileSync(junit, 'utf8')}`).toBe(0);
      expect(res.out).toContain('collected=2 ran=2 passed=2 failed=0 errored=0 skipped=0');
      expect(res.out).toContain('ZERO-RED');
    });
  });

  test('real vitest, the #11 shape — a throwing beforeAll plus a failing test stays RED (exit 1), never a refusal', () => {
    // vitest reports a suite whose hook threw as ONE extra failing testcase and
    // skips the suite's tests. `failures` counts testcases, so this file declares
    // failures=2 for a failing test plus the hook entry. A refusal that counted
    // <failure> elements, or ignored the injected entry, would turn this honest
    // red into exit 2 -- which is the refusal being disabled at 2am.
    withScratch((root) => {
      const { junit, log } = realVitestJunit(root, {
        'hook.test.mjs':
          "describe('hook suite', () => {\n  beforeAll(() => { throw new Error('planted beforeAll failure'); });\n  afterAll(() => { throw new Error('planted afterAll failure'); });\n  test('skipped by the hook x', () => {});\n  test('skipped by the hook y', () => {});\n});\n",
        'fail.test.mjs': "test('planted failing test', () => { expect(1).toBe(2); });\ntest('a passing neighbour', () => { expect(1).toBe(1); });\n",
      });
      const res = attest([junit]);
      expect(res.status, `real red vitest output was not RED:\n${res.out}\n--- child vitest ---\n${log}\n--- junit ---\n${readFileSync(junit, 'utf8')}`).toBe(1);
      expect(res.out).toContain('collected=5 ran=3 passed=1 failed=2 errored=0 skipped=2');
      expect(res.out).not.toContain('ZERO-RED');
    });
  });

  test('real vitest, an unhandled error — stays RED (exit 1) with errored counted, never a refusal', () => {
    withScratch((root) => {
      const { junit, log } = realVitestJunit(root, {
        'unhandled.test.mjs':
          "test('leaks an unhandled rejection', async () => { Promise.reject(new Error('planted unhandled')); await new Promise((r) => setTimeout(r, 20)); });\ntest('a passing neighbour', () => {});\n",
      });
      const res = attest([junit]);
      expect(res.status, `real vitest output with an unhandled error was not RED:\n${res.out}\n--- child vitest ---\n${log}\n--- junit ---\n${readFileSync(junit, 'utf8')}`).toBe(1);
      expect(res.out).toContain('collected=3 ran=3 passed=2 failed=0 errored=1 skipped=0');
      expect(res.out).not.toContain('ZERO-RED');
    });
  });
});
