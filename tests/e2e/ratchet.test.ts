import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import STEPS from '../../packages/fixtures/golden-path-steps.json';
import FRONTIER_RAW from './frontier.json';

/** The JSON types both fields as `null` today; they are `string | null` by contract. */
interface Frontier {
  passing_through: string | null;
  next_step_fails_with: string | null;
}
const FRONTIER = FRONTIER_RAW as unknown as Frontier;

/**
 * THE FRONTIER RATCHET. This file is the merge-blocking artefact, not
 * tests/e2e/golden-path.test.ts.
 *
 * THE PROBLEM IT SOLVES. A deliberately-red merge-blocking test blocks every
 * merge for a whole sprint. A non-required job red from inception is an unread
 * sensor. A skipped job is worse than both, because GitHub counts a skipped
 * required check as passing. The way out is that "the E2E is incomplete" and "the
 * gate is green" are compatible claims -- if what gates is THE SHAPE OF THE
 * INCOMPLETENESS.
 *
 * So the golden path runs, is allowed to be partially red, and writes a junit
 * file. This suite reads that file and asserts the incompleteness is exactly the
 * shape frontier.json declares. When a stage lands its step, the step starts
 * passing, THIS SUITE REDS, and the only way to green it is to move the frontier
 * -- a visible one-line diff in the pull request that delivered the work.
 * Progress is extracted by a failing gate rather than reported by a human.
 *
 * WHY IT PARSES THE JUNIT ITSELF. scripts/attest_counts.mjs is a flat count over
 * testcase elements with no per-test identity, so it cannot answer "did step N
 * pass". It is exactly right for the anti-vacuity leg, where its distinct exit 2
 * on an empty corpus is the signal, and that is what it is used for below.
 *
 * NOT ASSERTED HERE, deliberately: that a passing step passed for the right
 * reason. A step asserting the wrong thing passes this gate. The mitigation is
 * that each step is a real assertion against a real stack, reviewed when written
 * -- not something this file can reach.
 */

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const JUNIT = process.env['E2E_JUNIT'] ?? join(REPO_ROOT, 'junit-e2e.xml');
const GOLDEN_PATH_SRC = join(REPO_ROOT, 'tests/e2e/golden-path.test.ts');

interface CaseResult {
  name: string;
  failed: boolean;
  skipped: boolean;
  message: string;
}

/** Exported so the invariant plants can feed it constructed XML. */
export function parseJunit(xml: string): CaseResult[] {
  const out: CaseResult[] = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = m[1] ?? '';
    const body = m[3] ?? '';
    const nameMatch = /\bname="([^"]*)"/.exec(attrs);
    out.push({
      name: decodeEntities(nameMatch?.[1] ?? ''),
      failed: /<(failure|error)\b/.test(body),
      skipped: /<skipped\b/.test(body),
      message: decodeEntities(body),
    });
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, '\n')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const ids = STEPS.steps.map((s) => s.id);

function resultFor(cases: CaseResult[], id: string): CaseResult | undefined {
  return cases.find((c) => c.name.includes(`${id} — `));
}

describe('golden-path-steps fixture invariants', () => {
  test('owning_stage is monotonically non-decreasing', () => {
    // Without this a frontier position can become unreachable: if step N is owned
    // by a later stage than step N+1, no single passing_through value can ever
    // describe the truth and the ratchet is unsatisfiable rather than red.
    const stages = STEPS.steps.map((s) => s.owning_stage);
    const breaks = stages
      .map((s, i) => (i > 0 && (stages[i - 1] ?? 0) > s ? `${ids[i - 1]}(${stages[i - 1]}) -> ${ids[i]}(${s})` : null))
      .filter((x): x is string => x !== null);
    expect(breaks, 'owning_stage decreases down the list').toEqual([]);
  });

  test('step ids are unique and the list is non-empty', () => {
    expect(ids.length, 'the fixture decomposes gate 2 into nothing').toBeGreaterThan(0);
    expect(ids.length - new Set(ids).size, 'duplicate step ids').toBe(0);
  });

  test('exactly two steps need a browser, contiguous, none before playwright arrives', () => {
    const flagged = STEPS.steps.map((s, i) => ({ i, s })).filter(({ s }) => s.needs_browser);
    expect(flagged.length, 'the browser-step count changed').toBe(2);
    // NOT "after every browserless step" -- gate 2 ends with two browserless
    // outcome steps, so that phrasing is false. What matters is that Playwright
    // is not needed before the stage that brings it.
    expect(flagged.every(({ s }) => s.owning_stage >= 3), 'a browser step is owned before playwright lands').toBe(true);
    expect((flagged[1]?.i ?? 0) - (flagged[0]?.i ?? 0), 'the browser steps are not contiguous').toBe(1);
  });

  test('every step names the gate 2 clause it discharges', () => {
    const silent = STEPS.steps.filter((s) => !s.gate2_clause || s.gate2_clause.length === 0).map((s) => s.id);
    expect(silent, 'a step no longer maps back to the gate that was signed off').toEqual([]);
  });

  test('the frontier names a real step, and its two fields are null together or set together', () => {
    const { passing_through: pt, next_step_fails_with: nx } = FRONTIER;
    if (pt !== null) {
      expect(ids, `frontier.json points at "${pt}", which is not a step`).toContain(pt);
    }
    expect(
      pt === null ? nx === null : true,
      'passing_through is null but next_step_fails_with is set — nothing has been observed, so nothing can be named',
    ).toBe(true);
  });
});

describe('frontier ratchet', () => {
  const haveJunit = existsSync(JUNIT);

  test('anti-vacuity — the e2e run produced a junit with testcases in it', () => {
    // Loud, per test-conventions section 6. A guard whose corpus is generated
    // must generate it in the same job; a missing file here means the golden path
    // did not run, and a ratchet over nothing reports the same green as a ratchet
    // over a full pass.
    expect(haveJunit, `no e2e junit at ${JUNIT}. Run: npm run test:e2e`).toBe(true);

    // attest_counts.mjs exits 2 on zero testcases, 1 on red, 0 on zero-red. The
    // golden path is EXPECTED to be red, so only exit 2 is a failure here.
    let status = 0;
    let output = '';
    try {
      output = execFileSync('node', [join(REPO_ROOT, 'scripts/attest_counts.mjs'), JUNIT], { encoding: 'utf8' });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      status = err.status ?? -1;
      output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    expect(status, `attest_counts reported an empty corpus:\n${output}`).not.toBe(2);
    expect(output, 'attest_counts produced no attestation').toContain('collected=');
  });

  test('the step-id set in golden-path.test.ts equals the fixture exactly', () => {
    // Nobody moves the frontier by deleting a step. Parsed identity, not a count:
    // the same number of steps with one renamed would satisfy a count.
    const src = readFileSync(GOLDEN_PATH_SRC, 'utf8');
    const declared = [...src.matchAll(/name\('([^']+)'\)/g)].map((m) => m[1]);
    expect([...declared].sort(), 'golden-path.test.ts and the fixture disagree about the step list').toEqual(
      [...ids].sort(),
    );
  });

  test('no step is skipped — a skipped step reads as passing to the frontier check', () => {
    if (!haveJunit) return void expect(haveJunit, 'no junit; see the anti-vacuity leg').toBe(true);
    const cases = parseJunit(readFileSync(JUNIT, 'utf8'));
    expect(cases.filter((c) => c.skipped).map((c) => c.name), 'a golden-path step was skipped').toEqual([]);
  });

  test('every step at or before the frontier PASSED', () => {
    if (!haveJunit) return void expect(haveJunit, 'no junit; see the anti-vacuity leg').toBe(true);
    const cases = parseJunit(readFileSync(JUNIT, 'utf8'));
    const cut = FRONTIER.passing_through === null ? -1 : ids.indexOf(FRONTIER.passing_through);

    const regressed: string[] = [];
    for (let i = 0; i <= cut; i += 1) {
      const id = ids[i];
      if (id === undefined) continue;
      const res = resultFor(cases, id);
      if (!res) regressed.push(`${id} — did not run at all`);
      else if (res.failed) regressed.push(`${id} — ${res.message.slice(0, 300)}`);
    }
    expect(regressed, 'a step at or before the frontier regressed').toEqual([]);
  });

  test('the first step AFTER the frontier failed, with the failure the frontier names', () => {
    if (!haveJunit) return void expect(haveJunit, 'no junit; see the anti-vacuity leg').toBe(true);
    const cases = parseJunit(readFileSync(JUNIT, 'utf8'));
    const cut = FRONTIER.passing_through === null ? -1 : ids.indexOf(FRONTIER.passing_through);
    const nextId = ids[cut + 1];

    if (nextId === undefined) {
      // The frontier is at the last step: the whole gate passes and there is
      // nothing left to ratchet.
      expect(FRONTIER.next_step_fails_with, 'the frontier is complete, so nothing should be named as failing').toBeNull();
      return;
    }

    const res = resultFor(cases, nextId);
    expect(res, `${nextId} did not run`).toBeDefined();
    expect(
      res?.failed,
      `${nextId} PASSED. The work landed — move the frontier forward to it and name the next failure. ` +
        'This red is the ratchet doing its job, not a defect.',
    ).toBe(true);

    // WHY, not merely THAT. Assertion (2) without this is satisfied by a step
    // failing with "ReferenceError: sql is not defined" exactly as well as by one
    // failing because the RPC does not exist -- a check reporting a verdict for a
    // reason unrelated to what it guards.
    expect(
      FRONTIER.next_step_fails_with,
      'the frontier does not name the expected failure, so assertion (2) would accept any failure at all',
    ).not.toBeNull();
    expect(
      res?.message ?? '',
      `${nextId} failed for a DIFFERENT reason than the frontier names. ` +
        `Expected the message to contain "${String(FRONTIER.next_step_fails_with)}". Received:\n${(res?.message ?? '').slice(0, 800)}`,
    ).toContain(String(FRONTIER.next_step_fails_with));
  });
});
