import { describe, expect, test } from 'vitest';
import { join } from 'node:path';
import { parseLegs, assertedSubstrings, isReached, legsWithoutIdentity, duplicateIds, type Leg } from './_legs.js';
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
  asserted: string[],
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

  for (const { script, id } of registered()) {
    if (reg === guards && !seen.has(`${script}::${id}`)) {
      out.push(`${script}: register names leg "${id}", which no longer exists in the script`);
    }
  }
  return out.sort();
}

describe('leg coverage register', () => {
  const legs = parseLegs(SCRIPTS);
  const asserted = assertedSubstrings(TESTS);

  test('anti-vacuity — legs were parsed and the register is not empty', () => {
    expect(legs.length, 'no legs parsed — the parser stopped matching').toBeGreaterThan(50);
    expect(registered().length, 'the register parsed to nothing').toBeGreaterThan(50);
    expect(asserted.length, 'no toContain assertions found anywhere').toBeGreaterThan(5);
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
    expect(legs.length, 'leg total moved without the baseline being restated').toBe(REGISTER.baseline_2026_09_10.legs_total);
    expect(
      reached,
      `reached count is ${reached}; the register records ${REGISTER.baseline_2026_09_10.reached} at baseline. ` +
        'If this rose, that is the ratchet working — delete the closed entries and restate the baseline.',
    ).toBeGreaterThanOrEqual(REGISTER.baseline_2026_09_10.reached);
  });

  const LEG: Leg = { script: 'lint_x.sh', line: 1, id: 'the planted leg message' };
  const REG_OK = { 'lint_x.sh': { 'the planted leg message': { state: 'registered', reason: 'status-only', why: 'because' } } };

  test('plant — a leg absent from the register is rejected', () => {
    const out = registerViolations([LEG], {}, []);
    expect(out.length, `an unregistered leg was accepted: ${JSON.stringify(out)}`).toBe(1);
    expect(out[0]).toContain('is not in the register');
  });

  test('plant — a registered leg that IS now reached is rejected', () => {
    // The anti-rot direction that stops the register outliving the gap.
    const out = registerViolations([LEG], REG_OK, ['the planted leg message']);
    expect(out.length, `a closed gap kept its exemption: ${JSON.stringify(out)}`).toBe(1);
    expect(out[0]).toContain('IS now reached');
  });

  test('plant — a leg marked reached that nothing asserts is rejected', () => {
    const out = registerViolations([LEG], { 'lint_x.sh': { 'the planted leg message': { state: 'reached' } } }, []);
    expect(out.length, `a false reached claim was accepted: ${JSON.stringify(out)}`).toBe(1);
    expect(out[0]).toContain('marked reached but no test asserts');
  });

  test('plant — a register entry with an unrecognised reason is rejected', () => {
    const out = registerViolations([LEG], { 'lint_x.sh': { 'the planted leg message': { state: 'registered', reason: 'because I said so', why: 'x' } } }, []);
    expect(out.length, `an arbitrary reason was accepted: ${JSON.stringify(out)}`).toBe(1);
    expect(out[0]).toContain('is not one of the allowed reasons');
  });

  test('positive control — a properly registered, genuinely unreached leg is accepted', () => {
    expect(registerViolations([LEG], REG_OK, ['something unrelated']), 'the register rejected the case it exists for').toEqual([]);
  });
});
