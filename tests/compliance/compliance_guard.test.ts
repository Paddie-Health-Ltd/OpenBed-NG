import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCases, type Case } from './_junit.js';
import { place, REPO_ROOT, withScratch } from './_scratch.js';

/**
 * THE COMPLIANCE PROJECT'S CLASS GUARD, PLANTED (R-2026-10-07 GI, addendum 1 B and C).
 *
 * tests/setup/compliance-guard.ts makes a test file fail when it ends with anything it started still
 * scheduled, or when it reaches an unmocked fetch. A guard that rejects everything is a rubber stamp and
 * one that accepts everything is the defect it closes, so this file runs a REAL child vitest over scratch
 * fixture files, with the real setup file loaded by absolute path, and reads the JUnit it writes.
 *
 * THE FIXTURES, each a whole test file:
 *   - a real setTimeout left pending                      (the shape of CI run 37602732458)
 *   - a real setInterval left pending                     (the dashboard's 30 s poll)
 *   - an unmocked fetch whose rejection the code swallows (the dashboard's own try/catch)
 *   - a fake timer left pending                           (vi.getTimerCount() above zero)
 *   - a stubbed fetch call that never settles             (the unanswered publish request)
 *   - OWNED: fake timers, a stubbed fetch that settles, everything disposed
 *   - OWNED BY ITS OWN afterAll: a real timer cleared in the file's own afterAll, which runs BEFORE the
 *     guard's (hooks run in reverse registration order, and the guard registers first)
 * Five are rejected, naming what they left. Two are accepted.
 *
 * ANTI-VACUITY, three ways: (1) the same seven files under a config with NO setup file all pass, so the
 * guard is what fails the five; (2) the JUnit reader refuses a run that collected nothing; (3) the five
 * rejections each name the thing left behind, not a bare failure.
 *
 * NOT ASSERTED HERE, deliberately: that every real compliance file owns its side effects. That is what the
 * guard does when the whole project runs, and the project being green under it is the evidence.
 */

const VITEST = join(REPO_ROOT, 'node_modules', '.bin', 'vitest');
const GUARD = join(REPO_ROOT, 'tests', 'setup', 'compliance-guard.ts');

const FIXTURES: Record<string, string> = {
  'timer.test.mjs': "test('leaves a real timer', () => { setTimeout(() => {}, 60000); });\n",
  'interval.test.mjs': "test('leaves a real interval', () => { setInterval(() => {}, 30000); });\n",
  'swallowed.test.mjs':
    "test('reaches an unmocked fetch and swallows the rejection', async () => { try { await fetch('/beds.json'); } catch { /* swallowed, as the dashboard does */ } });\n",
  'fake.test.mjs': "test('leaves a fake timer', () => { vi.useFakeTimers(); setTimeout(() => {}, 1000); });\n",
  'inflight.test.mjs':
    "test('leaves a stubbed fetch unsettled', () => { vi.stubGlobal('fetch', () => new Promise(() => {})); void fetch('/publish'); });\n",
  'owned.test.mjs':
    "afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });\n" +
    "test('owns what it starts', async () => {\n  vi.useFakeTimers();\n  vi.stubGlobal('fetch', async () => new Response('{}'));\n  setTimeout(() => {}, 1000);\n  await fetch('/beds.json');\n  await vi.runOnlyPendingTimersAsync();\n});\n",
  'own_afterall.test.mjs':
    "let t;\nafterAll(() => { clearTimeout(t); });\ntest('cleans up in its own afterAll', () => { t = setTimeout(() => {}, 60000); });\n",
};
const REJECTED: Record<string, RegExp[]> = {
  'timer.test.mjs': [/real timer\(s\) still pending/, /setTimeout\(60000 ms\)/],
  'interval.test.mjs': [/real timer\(s\) still pending/, /setInterval\(30000 ms\)/],
  // "during this test": attributed to the test that made the call, by afterEach, not left for afterAll to find between tests.
  'swallowed.test.mjs': [/UNMOCKED FETCH/, /fetch\(\/beds\.json\)/, /during this test/],
  'fake.test.mjs': [/fake timer\(s\) still pending/],
  'inflight.test.mjs': [/stubbed fetch call\(s\) still in flight/, /fetch\(\/publish\)/],
};
const ACCEPTED = ['owned.test.mjs', 'own_afterall.test.mjs'];

function childRun(root: string, withGuard: boolean): Case[] {
  const setup = withGuard ? `, setupFiles: [${JSON.stringify(GUARD)}]` : '';
  place(root, 'vitest.config.mjs', `export default { test: { include: ['**/*.test.mjs'], globals: true${setup} } };\n`);
  for (const [name, body] of Object.entries(FIXTURES)) place(root, name, body);
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
    log = `${x.stdout ?? ''}${x.stderr ?? ''}`; // a red child run exits 1; the JUnit is what matters
  }
  expect(existsSync(out), `the child vitest wrote no JUnit file:\n${log}`).toBe(true);
  return readCases(readFileSync(out, 'utf8'));
}

/** The files with at least one failing case, and the text of their failures. */
function failuresByFile(cases: Case[]): Map<string, string> {
  const byFile = new Map<string, string>();
  for (const c of cases) {
    if (!c.failed) continue;
    const file = Object.keys(FIXTURES).find((f) => c.file.endsWith(f));
    if (file === undefined) throw new Error(`a failing case belongs to no fixture: ${JSON.stringify(c.file)} ${c.name}`);
    byFile.set(file, `${byFile.get(file) ?? ''}\n${c.name}\n${c.body}`);
  }
  return byFile;
}

describe('the compliance class guard', () => {
  const FIXTURE_NAMES = Object.keys(FIXTURES).sort();

  test('plant — each file that leaves something scheduled, or reaches an unmocked fetch, is rejected, naming what it left', () => {
    withScratch((root) => {
      const cases = childRun(root, true);
      const failures = failuresByFile(cases);
      expect([...failures.keys()].sort(), 'the guard rejected the wrong set of files').toEqual(Object.keys(REJECTED).sort());
      for (const [file, wants] of Object.entries(REJECTED)) {
        for (const want of wants) {
          expect(failures.get(file), `${file}: the failure does not say ${want}`).toMatch(want);
        }
      }
    });
  });

  test('real files that own their side effects are accepted, including one that cleans up in its own afterAll', () => {
    withScratch((root) => {
      const cases = childRun(root, true);
      const failing = new Set(failuresByFile(cases).keys());
      for (const file of ACCEPTED) {
        expect(cases.some((c) => c.file.endsWith(file)), `${file} was not collected, so its acceptance proves nothing`).toBe(true);
        expect(failing.has(file), `${file} owns its side effects and was rejected`).toBe(false);
      }
    });
  });

  test('anti-vacuity — the same seven files under a config with no guard all pass, so the guard is what rejects the five', () => {
    withScratch((root) => {
      const cases = childRun(root, false);
      const files = new Set(cases.map((c) => FIXTURE_NAMES.find((f) => c.file.endsWith(f))));
      expect([...files].sort(), 'not every fixture ran, so "all pass" would prove nothing').toEqual(FIXTURE_NAMES);
      expect(failuresByFile(cases).size, 'a fixture failed without the guard: it fails for its own reasons').toBe(0);
    });
  });

  test('anti-vacuity — the reader refuses a run that collected nothing', () => {
    expect(() => readCases('<?xml version="1.0"?><testsuites name="vitest tests" tests="0" failures="0" errors="0"></testsuites>')).toThrow(
      'collected no test cases',
    );
  });
});
