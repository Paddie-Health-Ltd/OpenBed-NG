/**
 * The client mirror of `app.gate()`.
 *
 * THIS FILE AND database/migrations/006_gate_function.sql ARE ONE ARTIFACT.
 * They implement the same rule twice, deliberately, because the server derives
 * the gate for the public projection and the client needs to explain the result
 * without a round trip. Two implementations of a safety rule is a drift risk by
 * construction, so the drift is closed by test rather than by discipline:
 *
 *   packages/fixtures/truth-table.json   -- one fixture, 48 rows
 *   tests/db/gate_truth_table.test.ts    -- ONE test.each block, BOTH call sites
 *
 * One block makes it structurally impossible to run one side without the other.
 * If you change the mapping here, change 006 in the same commit; the truth table
 * fails until both agree.
 *
 * FINDING F2 -- WHY THERE IS NO BOOLEAN ANYWHERE IN THIS FILE.
 * A duty flag has three states, not two. The natural shape is
 * `anaesthetistOnDuty: boolean` with `if (!anaesthetistOnDuty) closed = true`,
 * and on day one -- when no facility has touched the flag -- that single line
 * renders every hospital in Lagos as closed. It looks like clean code, which is
 * what makes it the highest-consequence bug available in this build.
 *
 * The ESLint rule in eslint.config.mjs bans `!` and `=== false` on any
 * identifier matching /anaesthetist|obstetrician|paediatrician/ precisely so
 * that reintroducing the shape fails the build rather than the city.
 */

/** Three states. `UNKNOWN` is the default and means nobody has said. */
export type TriState = 'UNKNOWN' | 'YES' | 'NO';

/** The eight published ward categories. Mirrors `app.ward_category`. */
export type WardCategory =
  | 'A_AND_E'
  | 'ICU_ADULT'
  | 'ICU_PAEDIATRIC'
  | 'MEDICAL_ADULT'
  | 'PAEDIATRIC'
  | 'THEATRE'
  | 'SURGICAL'
  | 'MATERNITY'
  | 'NICU'
  | 'SCBU';

/**
 * PUBLIC reason a category is gated. Mirrors `app.gate_reason`.
 *
 * Deliberately worded differently from the PRIVATE `zero_reason.NO_ANAESTHETIST`
 * that a ward enters by hand. The two collide by name and someone will render
 * the private one because the switch matched; distinct strings make that a
 * type error rather than a leak.
 */
export type GateReason =
  | 'NO_ANAESTHETIST_ON_DUTY'
  | 'NO_PAEDIATRICIAN_ON_DUTY'
  | 'NO_OBSTETRICIAN_ON_DUTY';

/** Duty cover as recorded by the facility. Mirrors `app.facility_ops`. */
export interface DutyFlags {
  readonly anaesthetist: TriState;
  readonly obstetrician: TriState;
  readonly paediatrician: TriState;
}

/**
 * Returns the reason this category is closed by duty cover, or `null` if it is
 * not. Exactly mirrors `app.gate()` in 006.
 *
 * Only an explicit `'NO'` gates anything: `'UNKNOWN'` and `'YES'` both return
 * `null`, for every category.
 *
 * The comparisons below are `=== 'NO'` rather than any negation. That is the
 * TypeScript twin of the SQL's `IS NOT DISTINCT FROM 'NO'`: both are total,
 * both answer false for an absent value, and so both give the same answer when
 * a flag arrives missing. A negation would not -- and the failure would not be
 * "the gate is wrong", it would be "the gate is wrong on the client only, while
 * the server says something else, and neither errors".
 */
export function gate(
  category: WardCategory,
  anaesthetist: TriState,
  obstetrician: TriState,
  paediatrician: TriState,
): GateReason | null {
  switch (category) {
    case 'THEATRE':
    case 'SURGICAL':
      return anaesthetist === 'NO' ? 'NO_ANAESTHETIST_ON_DUTY' : null;

    // All four paediatric-facing categories, not just the neonatal two.
    //
    // DEFAULT PENDING CLINICIAN CONFIRMATION, and stated rather than left to be
    // derived. This is TRANSCRIPTION of the existing rule to the categories added
    // on 2026-09-09, not a new rule: a paediatric ICU with no paediatrician on
    // duty is not paediatric capacity, by the same argument that gates Theatre on
    // the anaesthetist. Whether ONE flag is the right granularity across neonatal
    // and paediatric intensive care is open -- but a single flag is the
    // conservative reading and it preserves current behaviour.
    case 'NICU':
    case 'SCBU':
    case 'PAEDIATRIC':
    case 'ICU_PAEDIATRIC':
      return paediatrician === 'NO' ? 'NO_PAEDIATRICIAN_ON_DUTY' : null;

    case 'MATERNITY':
      return obstetrician === 'NO' ? 'NO_OBSTETRICIAN_ON_DUTY' : null;

    // Ungated. No duty flag closes these.
    case 'A_AND_E':
    case 'ICU_ADULT':
    case 'MEDICAL_ADULT':
      return null;

    default: {
      // Exhaustiveness. Adding a category to WardCategory without deciding
      // whether it is gated fails to compile here -- which is the moment to
      // decide, rather than after it silently defaulted to open in production.
      const unreachable: never = category;
      return unreachable;
    }
  }
}

/** Convenience form over a `DutyFlags` object. Same rule, same answers. */
export function gateForFlags(category: WardCategory, flags: DutyFlags): GateReason | null {
  return gate(category, flags.anaesthetist, flags.obstetrician, flags.paediatrician);
}

/**
 * THE GATE REDUCES ONLY.
 *
 * `accepting` is the ward's own claim and is never edited. This combines it with
 * the gate for display. A gate can close a ward that said it was accepting; a
 * duty flag of `'YES'` can never open one that said it was not.
 *
 * Written as an explicit conjunction rather than any cleverer form so that the
 * one-directional property is readable at a glance and provable from the shape:
 * the only way to get `true` out is for the ward to have claimed `true`.
 */
export function acceptingEffective(accepting: boolean, gateReason: GateReason | null): boolean {
  return accepting && gateReason === null;
}

/** Whether the facility offers this ward at all. Mirrors `app.ward_offering`. */
export type WardOffering = 'OFFERED' | 'NOT_OFFERED';

/**
 * The composition the projection actually publishes into
 * `public.ward_public.accepting_effective`.
 *
 * A ward the facility does not offer is never accepting, whatever its stored
 * claim says. Folding that in HERE rather than leaving it to each reader is
 * deliberate: `accepting_effective` is the column a consumer will reach for, and
 * a NOT_OFFERED ward reporting `true` would put a ward that does not exist in
 * front of someone deciding where to send a patient. One composition, one place,
 * mirrored by the SQL in migration 008.
 */
export function acceptingEffectiveForWard(
  offering: WardOffering,
  accepting: boolean,
  gateReason: GateReason | null,
): boolean {
  return offering === 'OFFERED' && acceptingEffective(accepting, gateReason);
}
