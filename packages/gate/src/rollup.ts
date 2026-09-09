/**
 * The client mirror of the `public.lga_rollup` k-anonymity rule.
 *
 * THIS FILE AND database/migrations/009_lga_rollup_kfloor.sql ARE ONE ARTIFACT,
 * on exactly the same terms as gate.ts and 006. One rule, two implementations,
 * one fixture, one test block.
 *
 * WHY THE BRANCH ORDER IS FIXED AND NOT A STYLE CHOICE.
 *
 * The obvious formulation is a single conjunction:
 *
 *     facilityCount >= 5 && maxFacilityBeds / totalBeds <= 0.40
 *
 * It is wrong, and it is wrong DIFFERENTLY IN EACH LANGUAGE, which is the worst
 * available outcome. When every contributing facility reports zero beds,
 * `totalBeds` is 0 and:
 *
 *   - Postgres THROWS `division_by_zero`. The refresh fails; the whole rollup
 *     stops updating.
 *   - JavaScript returns `NaN`, and `NaN <= 0.40` is `false`. The cell is
 *     silently SUPPRESSED.
 *
 * So one layer errors loudly and the other quietly hides a cell, from the same
 * input, and neither reports a disagreement. That is the same shape as the
 * tri-state bug in gate.ts: two layers disagreeing, in opposite directions, with
 * no error on either side.
 *
 * The fix is an ordered branch in both implementations, with the zero case
 * answered BEFORE any division is reached.
 *
 * WHY THE ALL-ZERO CELL IS PUBLISHED RATHER THAN SUPPRESSED.
 *
 * Not because it discloses little -- it arguably discloses everything, since a
 * reader can infer each contributor's exact state. The argument is that
 * suppressing it does not hide it. If all-zero were the only condition beyond
 * the k-floor that removed a cell, an observer would see the cell present on
 * normal days and absent on zero days, and infer the zero from its absence.
 * K-floor suppression is stable over time; zero-suppression flickers, and the
 * flicker is the signal.
 *
 * So suppression buys nothing, and it costs the most clinically useful thing the
 * rollup can say -- "nothing available across this LGA" -- at exactly the moment
 * it matters most.
 */

/** Minimum distinct contributing facilities before a cell may exist at all. */
export const K_FLOOR = 5;

/** No single facility may exceed this share of the cell's total beds. */
export const MAX_FACILITY_SHARE = 0.4;

/**
 * One cell's contribution counts.
 *
 * `facilityCount`, `totalBeds` and `maxFacilityBeds` MUST all be computed over
 * THE SAME SET of facilities -- quiet, active facilities in this LGA offering
 * this category. The kickoff says "5 reporting facilities" while the k-floor is
 * about quiet facilities, and those are different sets: if the count ranged over
 * one and the denominator over another, the dominance rule would be measuring a
 * share of something the count never counted, and the control would be
 * incoherent rather than merely wrong.
 */
export interface RollupCell {
  readonly facilityCount: number;
  readonly totalBeds: number;
  readonly maxFacilityBeds: number;
}

/**
 * Whether this cell may be published. Ordered branches, never a conjunction.
 *
 *   1. k-floor    -- fewer than 5 contributors: suppress.
 *   2. all-zero   -- publish, and RETURN BEFORE ANY DIVISION.
 *   3. dominance  -- no facility over 40% of the total.
 */
export function rollupPublishable(cell: RollupCell): boolean {
  // 1. k-floor.
  if (cell.facilityCount < K_FLOOR) return false;

  // 2. All-zero. This branch exists to be taken before step 3 can divide.
  //    Removing it does not make the code simpler, it makes the two
  //    implementations disagree.
  if (cell.totalBeds === 0) return true;

  // 3. Dominance. Reachable only when totalBeds > 0.
  return cell.maxFacilityBeds / cell.totalBeds <= MAX_FACILITY_SHARE;
}
