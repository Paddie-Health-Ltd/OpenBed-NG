import shape from '../../fixtures/snapshot-shape.json';

/**
 * FRESHNESS BANDS — a pure function that reads no clock.
 *
 * Every input is passed in. There is no `Date.now()`, no `new Date()` with no
 * arguments, and no `performance.now()` in this file: the monotonic term is
 * sampled once in `anchor.ts` and handed here as a number. That is what makes
 * this testable at a boundary rather than at a moment.
 *
 * NOT IN `packages/gate`, deliberately, and the reason is a trap rather than a
 * preference. That package's identity is rules implemented TWICE -- once in SQL
 * and once in TypeScript -- pinned by a shared fixture in one test.each block.
 * Freshness has exactly ONE derivation site by design: the server stamps the
 * row's timestamp and emits `server_now`, and deliberately never computes an
 * age. Putting this in `packages/gate` invites the next contributor to write the
 * SQL twin for symmetry, and THE SQL TWIN OF A FRESHNESS RULE IS A WHERE CLAUSE
 * ON THAT TIMESTAMP -- the precise collapse
 * `scripts/lint_no_updated_at_filter.sh` exists to ban. The banned form is not
 * spelled out here: that lint scans this directory, and a guard that fires on
 * its own documentation is a guard someone switches off.
 *
 * LIVE SINCE R-2026-09-23-67: the public dashboard renders every ward's age through
 * this module, and its thresholds are the PROVISIONAL ones in
 * packages/fixtures/snapshot-shape.json. Until then it was GUARD-AHEAD-OF-SUBJECT --
 * correct, tested, and reaching no production caller (R-2026-09-17-05).
 *
 * FRESHNESS MAY REORDER RESULTS. IT MAY NEVER FILTER THEM. At 4am every ward in
 * the system is stale, so a freshness filter empties the entire result set at
 * exactly the hour the tool matters most. `SUPPRESSED` removes the COUNT from a
 * tile; it never removes the tile, the facility or the phone number.
 */

const BANDS = shape.freshnessBands;

export type FreshnessBand = 'GREEN' | 'YELLOW' | 'GREY' | 'SUPPRESSED';

export interface Freshness {
  readonly band: FreshnessBand;
  readonly ageMinutes: number;
  /** GREY prefixes the count with "last known"; SUPPRESSED replaces it entirely. */
  readonly showsCount: boolean;
}

/**
 * @param updatedAtIso  server-stamped, from the ward row
 * @param serverNowIso  a SERVER clock at serve time -- the x-openbed-served-at header,
 *                      not the envelope's server_now, which is generation time
 * @param elapsedSinceFetchMs  monotonic, from anchor.elapsedSince()
 */
export function freshnessBand(
  updatedAtIso: string,
  serverNowIso: string,
  elapsedSinceFetchMs: number,
): Freshness {
  const updatedAt = Date.parse(updatedAtIso);
  const serverNow = Date.parse(serverNowIso);
  if (Number.isNaN(updatedAt) || Number.isNaN(serverNow)) {
    // Unparseable input is SUPPRESSED, never GREEN. The safe direction for an
    // unknown age is "we do not know", because the alternative is a green badge
    // on a row whose age could not be computed.
    return { band: 'SUPPRESSED', ageMinutes: Number.NaN, showsCount: false };
  }

  // Clamped at zero. A ward whose updated_at is AHEAD of server_now is a clock
  // problem on the writer, not a negative age, and a negative age would sort
  // fresher than anything real.
  const ageMs = Math.max(0, serverNow - updatedAt) + Math.max(0, elapsedSinceFetchMs);
  const ageMinutes = ageMs / 60_000;

  if (ageMinutes >= BANDS.suppressAfterHours * 60) {
    return { band: 'SUPPRESSED', ageMinutes, showsCount: false };
  }
  if (ageMinutes < BANDS.greenUnderMinutes) return { band: 'GREEN', ageMinutes, showsCount: true };
  if (ageMinutes < BANDS.yellowUnderMinutes) return { band: 'YELLOW', ageMinutes, showsCount: true };
  return { band: 'GREY', ageMinutes, showsCount: true };
}

/** How old the SNAPSHOT is, as the page measures it. */
export interface SnapshotAge {
  /** False when the serve-time clock was missing or unreadable. */
  readonly known: boolean;
  /** True from snapshotBannerAfterMinutes, AND whenever the age is unknown. */
  readonly stale: boolean;
  readonly ageMinutes: number;
}

/**
 * THE SNAPSHOT'S OWN AGE (R-2026-09-23-67 A3): served_at - generated_at + elapsed.
 *
 * WHY THIS CANNOT READ FRESH WHILE THE SNAPSHOT IS STALE. `servedAtIso` is minted by
 * the Pages Function on each response, so it advances whether or not the generator
 * runs; `generatedAtIso` stops advancing the moment the job stalls. Their difference
 * therefore grows with the stall. The elapsed term grows with the time the page has
 * been open. Neither term is the device clock.
 *
 * AN UNKNOWN AGE IS STALE. A missing or unparseable serve-time header means the page
 * cannot measure the snapshot at all, and "we cannot tell" must read as a warning,
 * never as fresh.
 */
export function snapshotAge(generatedAtIso: string, servedAtIso: string | null, elapsedSinceFetchMs: number): SnapshotAge {
  const generated = Date.parse(generatedAtIso);
  const served = servedAtIso === null ? Number.NaN : Date.parse(servedAtIso);
  if (Number.isNaN(generated) || Number.isNaN(served)) {
    return { known: false, stale: true, ageMinutes: Number.NaN };
  }
  const ageMinutes = (Math.max(0, served - generated) + Math.max(0, elapsedSinceFetchMs)) / 60_000;
  return { known: true, stale: ageMinutes >= BANDS.snapshotBannerAfterMinutes, ageMinutes };
}

/**
 * The sort bucket. LOWER IS FRESHER, and it is an ORDERING input only.
 *
 * The sort key is `(freshness_bucket asc, distance asc, facility_id asc)`. The
 * stable third key stops the list reshuffling under a user mid-decision.
 */
export function freshnessBucket(band: FreshnessBand): number {
  return { GREEN: 0, YELLOW: 1, GREY: 2, SUPPRESSED: 3 }[band];
}
