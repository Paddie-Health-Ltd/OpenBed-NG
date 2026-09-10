import { describe, expect, test } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseLegs, parseInstrumentLegs, assertedByScript, isReached, legsWithoutIdentity, duplicateIds, type Leg } from './_legs.js';
import { REPO_ROOT } from './_scratch.js';
import REGISTER from '../../packages/fixtures/leg-coverage.json';

/**
 * THE UNREACHED-LEG RATCHET.
 *
 * WHY THIS EXISTS. `scripts/lint_audit_log_columns.sh` produced two independent
 * defects in two sessions -- a grep exit-2 fail-open, then leg-masking -- and
 * NEITHER was found by anything mechanical. A guard proved by "it reds on a
 * plant" is proved only for whichever leg fires FIRST. Every leg after that is
 * unverified and looks identical to a working one: green.
 *
 * A leg is REACHED only when a compliance test asserts a substring of that leg's
 * OWN MESSAGE. Not when the guard merely exits non-zero -- that is satisfied by
 * any earlier leg. Not when the message appears in a test's header comment --
 * every one of these guards documents its own messages in prose, and counting
 * that is the comment-claiming-a-link defect again.
 *
 * MEASURED 2026-09-10, before the sweep: 77 legs, ONE reached.
 *
 * A NAMED RESIDUE IS A LIST, AND LISTS ROT. So the residue is registered rather
 * than listed, on the PLANNED_ARTEFACTS model, with anti-rot in both directions.
 * The count can fall freely; it can only rise through a deliberate, visible,
 * reviewed entry in packages/fixtures/leg-coverage.json.
 *
 * NOT ASSERTED HERE, deliberately: that a reached leg's plant ISOLATES it --
 * that every earlier leg is satisfied so only this one can fire. That is a
 * property of the planted input, not of the text, and a check claiming it would
 * be theatre. The discipline is the method: verify a plant by NEUTERING the leg
 * it targets and confirming only that leg reds. This file makes the message
 * assertion mandatory, which is the part that IS mechanically checkable.
 */

const SCRIPTS = join(REPO_ROOT, 'scripts');
/** This file. Its own violation branches are legs and are registered like any other. */
const INSTRUMENT = 'tests/compliance/leg_coverage.test.ts';
const TESTS = join(REPO_ROOT, 'tests/compliance');
const REASONS = new Set(['status-only', 'could-not-run', 'no-seam', 'no-injectable-hook']);

interface Entry {
  state: string;
  reason?: string;
  why?: string;
  closes_with?: string;
}
const guards = REGISTER.guards as unknown as Record<string, Record<string, Entry>>;

function registered(): { script: string; id: string; entry: Entry }[] {
  return Object.entries(guards).flatMap(([script, legs]) =>
    Object.entries(legs).map(([id, entry]) => ({ script, id, entry })),
  );
}

/** The pure decision, so the plants feed it constructed input. */
export function registerViolations(
  legs: Leg[],
  reg: Record<string, Record<string, Entry>>,
  asserted: Map<string, string[]>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const leg of legs) {
    seen.add(`${leg.script}::${leg.id}`);
    const entry = reg[leg.script]?.[leg.id];
    if (!entry) {
      out.push(`${leg.script}: leg "${leg.id}" is not in the register — add it as reached or registered`);
      continue;
    }
    const reached = isReached(leg, asserted);
    if (entry.state === 'reached' && !reached) {
      out.push(`${leg.script}: leg "${leg.id}" is marked reached but no test asserts its message`);
    }
    if (entry.state === 'registered' && reached) {
      out.push(`${leg.script}: leg "${leg.id}" IS now reached — delete its register entry`);
    }
    if (entry.state === 'registered' && !REASONS.has(entry.reason ?? '')) {
      out.push(`${leg.script}: leg "${leg.id}" has reason "${String(entry.reason)}", which is not one of the allowed reasons`);
    }
    if (entry.state === 'registered' && !(entry.why ?? '').trim()) {
      out.push(`${leg.script}: leg "${leg.id}" is registered with no reason given`);
    }
  }

  // Iterate the register PASSED IN, not the module-level one. It was
  // `if (reg === guards && ...)`, which made this branch unreachable by any
  // plant -- a leg I wrote in an unprovable shape while building the thing whose
  // whole purpose is finding legs in that shape.
  for (const [script, legsOf] of Object.entries(reg)) {
    for (const id of Object.keys(legsOf)) {
      if (!seen.has(`${script}::${id}`)) {
        out.push(`${script}: register names leg "${id}", which no longer exists in the script`);
      }
    }
  }
  return out.sort();
}

describe('leg coverage register', () => {
  const legs = [...parseLegs(SCRIPTS), ...parseInstrumentLegs(join(REPO_ROOT, INSTRUMENT), INSTRUMENT)];
  const asserted = assertedByScript(TESTS);
  // The instrument's own assertions are its evidence, exactly as a guard's test
  // file is the guard's. Without this it could never prove any of its own legs.
  asserted.set(INSTRUMENT, asserted.get('lint_grep_exit_codes.sh') === undefined ? [] : []);
  asserted.set(INSTRUMENT, [...(readFileSync(join(REPO_ROOT, INSTRUMENT), 'utf8').matchAll(/\.toContain\(\s*(['"`])((?:[^\\]|\\.)*?)\1/g))].map((m) => m[2] as string));

  test('anti-vacuity — legs were parsed and the register is not empty', () => {
    expect(legs.length, 'no legs parsed — the parser stopped matching').toBeGreaterThan(50);
    expect(registered().length, 'the register parsed to nothing').toBeGreaterThan(50);
    expect(asserted.size, 'no test file was mapped to any guard').toBeGreaterThan(5);
  });

  test('every leg has an assertable identity', () => {
    // A leg whose message is entirely interpolated cannot be proved and cannot be
    // read at 2am either: the operator gets a filename and a grep dump with no
    // statement of which rule fired. Seven legs were in that state on 2026-09-10.
    expect(legsWithoutIdentity(SCRIPTS), 'these failure sites carry no static message').toEqual([]);
  });

  test('no two legs in one script share an identity', () => {
    expect(duplicateIds(legs), 'an ambiguous identity is not an identity').toEqual([]);
  });

  test('the register and the scripts agree, in both directions', () => {
    expect(registerViolations(legs, guards, asserted), 'leg register is out of step with the guards').toEqual([]);
  });

  test('the recorded baseline still matches what is measured', () => {
    // The number future sessions will want and cannot reconstruct.
    const reached = legs.filter((l) => isReached(l, asserted)).length;
    const base = REGISTER.baseline_2026_09_10;
    const now = REGISTER.current;

    // THE BASELINE IS HISTORY AND DOES NOT MOVE. `current` is the measurement.
    // An earlier version asserted the leg TOTAL against the baseline, which
    // reddened the moment a legitimate new guard was added -- it demanded the
    // historical record be rewritten to record progress, which is the one thing
    // it must never do.
    expect(legs.length, 'the register is out of step with the measured leg total').toBe(now.legs_total);
    expect(reached, 'current.reached does not match what is measured').toBe(now.reached);

    // THE RATCHET. Progress is free; regression is not.
    expect(
      reached,
      `reached is ${reached}; the 2026-09-10 baseline was ${base.reached}. A fall means a leg stopped being proved.`,
    ).toBeGreaterThanOrEqual(base.reached);
  });

  const LEG: Leg = { script: 'lint_x.sh', line: 1, id: 'the planted leg message' };
  const REG_OK = { 'lint_x.sh': { 'the planted leg message': { state: 'registered', reason: 'status-only', why: 'because' } } };

  test('plant — a leg absent from the register is rejected', () => {
    const out = registerViolations([LEG], {}, new Map());
    expect(out.length, `an unregistered leg was accepted: ${JSON.stringify(out)}`).toBe(1);
    expect(out[0]).toContain('is not in the register');
  });

  test('plant — a registered leg that IS now reached is rejected', () => {
    // The anti-rot direction that stops the register outliving the gap.
    const out = registerViolations([LEG], REG_OK, new Map([['lint_x.sh', ['the planted leg message']]]));
    expect(out.length, `a closed gap kept its exemption: ${JSON.stringify(out)}`).toBe(1);
    expect(out[0]).toContain('IS now reached');
  });

  test('plant — a leg marked reached that nothing asserts is rejected', () => {
    const out = registerViolations([LEG], { 'lint_x.sh': { 'the planted leg message': { state: 'reached' } } }, new Map());
    expect(out.length, `a false reached claim was accepted: ${JSON.stringify(out)}`).toBe(1);
    expect(out[0]).toContain('marked reached but no test asserts');
  });

  test('plant — a register entry with an unrecognised reason is rejected', () => {
    const out = registerViolations([LEG], { 'lint_x.sh': { 'the planted leg message': { state: 'registered', reason: 'because I said so', why: 'x' } } }, new Map());
    expect(out.length, `an arbitrary reason was accepted: ${JSON.stringify(out)}`).toBe(1);
    expect(out[0]).toContain('is not one of the allowed reasons');
  });

  test('plant — a registered leg with no reason given is rejected', () => {
    const out = registerViolations([LEG], { 'lint_x.sh': { 'the planted leg message': { state: 'registered', reason: 'status-only', why: '   ' } } }, new Map());
    expect(out.length, `an empty reason was accepted: ${JSON.stringify(out)}`).toBe(1);
    expect(out[0]).toContain('is registered with no reason given');
  });

  test('plant — a register entry naming a leg that no longer exists is rejected', () => {
    // The other anti-rot direction: a guard is rewritten, its message changes,
    // and the stale entry keeps counting toward the registered total forever.
    const out = registerViolations([], { 'lint_x.sh': { 'a leg that was deleted': { state: 'registered', reason: 'no-seam', why: 'x' } } }, new Map());
    expect(out.length, `a stale entry survived: ${JSON.stringify(out)}`).toBe(1);
    expect(out[0]).toContain('which no longer exists in the script');
  });

  test('positive control — a properly registered, genuinely unreached leg is accepted', () => {
    expect(registerViolations([LEG], REG_OK, new Map([['lint_x.sh', ['something unrelated']]])), 'the register rejected the case it exists for').toEqual([]);
  });
});
