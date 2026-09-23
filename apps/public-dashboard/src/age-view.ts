import { freshnessBand, snapshotAge, type DecodedRow } from '@openbed/snapshot';
import { categoryLabel, reasonLabel, stateWords, UNKNOWN_STATUS } from './labels.js';

/**
 * WHAT A VISITOR IS TOLD ABOUT HOW OLD A COUNT IS (R-2026-09-23-67 A1-A5).
 *
 * A count shown without its age is false confidence: a crew acting on yesterday's
 * "6 beds" loses the window to divert. So every ward line says how old it is, in
 * WORDS -- colour may de-emphasise, never carry the meaning alone.
 *
 * THE BANDS, from packages/fixtures/snapshot-shape.json (PROVISIONAL until a
 * clinician ruling):
 *   FRESH   "updated 6 min ago"
 *   AGEING  "last reported 46 min ago — call to confirm"
 *   STALE   "last reported at 04:12, 23 Sept (Lagos time) — call to confirm" -- past two
 *           hours a relative age is replaced by the time it was reported
 *   STATUS UNKNOWN  "Status unknown — call to confirm", and NO NUMBER anywhere, in any
 *           size (R-2026-09-23-68 B1; v1:242's ceiling). Until -68 the old count
 *           survived as small print, which is the count still on the page.
 *   PENDING / PAUSED  "not currently reporting", and no count at all
 *
 * WHICH STATE WINS, in this order (R-2026-09-23-68 C, the founder's condition):
 *   1. a monitoring_state or offering the label table does not know -> "Status
 *      unknown -- call to confirm". A state this page cannot read is not guessed at.
 *   2. PENDING or PAUSED -> "not currently reporting", WHATEVER THE OFFERING. A new
 *      ward is NOT_OFFERED by default (004) and PENDING by default, so a PENDING
 *      ward's offering may be a default nobody chose.
 *   3. NOT_OFFERED -> "not offered at this facility", with no count, age or
 *      accepting clause. Reached only by a ward that has left PENDING, and the only
 *      path out of PENDING today is publish_ward_status (014), which writes the
 *      offering in the same UPDATE: so this is the offering someone last STATED.
 *      tests/compliance/public_labels.test.ts holds that path to be the only one.
 *   4. otherwise, the count and its age band, below.
 * Every category and reason is shown in words from ./public-labels.json.
 *
 * AGE NEVER CHANGES A CLAIM. A stale ward is not shown as 0 beds or as not accepting
 * because it is stale; whatever the ward itself last said is shown, with its age.
 * And age never filters or reorders: every ward is rendered, in the order served.
 *
 * THE CLOCK. Every age here is `served_at - updated_at + elapsed` (see
 * packages/snapshot/src/anchor.ts): the Pages Function's serve time, the ward's own
 * report time, and monotonic time since the page loaded. The device clock is in none
 * of it -- this module formats fixed instants and never asks what time it is.
 */

export interface ServeClock {
  /** The x-openbed-served-at header, or null when it was absent. */
  readonly servedAt: string | null;
  /** Monotonic milliseconds since the fetch. */
  readonly elapsedMs: number;
}

/** A server timestamp as a Lagos wall time. Formats the instant it is given; reads no clock. */
export function lagosTime(isoString: string): string {
  const at = new Date(isoString);
  const text = at.toLocaleString('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    day: 'numeric',
    month: 'short',
  });
  return `${text} (Lagos time)`;
}

function relative(minutes: number): string {
  if (minutes < 1) return 'less than a minute';
  const whole = Math.floor(minutes);
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export interface WardLine {
  readonly text: string;
  /** For styling only; the words above carry the meaning. */
  readonly tone: 'fresh' | 'aged' | 'none' | 'not-reporting' | 'not-offered' | 'unknown';
}

/** The whole line for one ward: its claim, and how old that claim is. */
export function wardLine(ward: DecodedRow, clock: ServeClock): WardLine {
  const category = categoryLabel(ward['category']);
  const monitoring = stateWords('monitoring_state', ward['monitoring_state']);
  const offering = stateWords('ward_offering', ward['offering']);
  if (monitoring === undefined || offering === undefined) {
    return { text: `${category}: ${UNKNOWN_STATUS}`, tone: 'unknown' };
  }
  if (ward['monitoring_state'] === 'PENDING' || ward['monitoring_state'] === 'PAUSED') {
    return { text: `${category}: ${monitoring}`, tone: 'not-reporting' };
  }
  if (ward['offering'] === 'NOT_OFFERED') {
    return { text: `${category}: ${offering}`, tone: 'not-offered' };
  }

  const bedCount = ward['bed_count'];
  const beds = bedCount === null ? 'not yet reporting' : `${String(bedCount)} beds`;
  const open = ward['accepting_effective'] === true;
  const reason = ward['gated_by'];
  const claim = `${category}: ${beds}${open ? '' : ' — not accepting'}${reason === null || reason === undefined ? '' : ` (${reasonLabel(reason)})`}`;

  const updatedAt = typeof ward['updated_at'] === 'string' ? ward['updated_at'] : '';
  if (clock.servedAt === null || Number.isNaN(Date.parse(clock.servedAt)) || Number.isNaN(Date.parse(updatedAt))) {
    return { text: `${claim} — age unknown — call to confirm`, tone: 'unknown' };
  }

  const f = freshnessBand(updatedAt, clock.servedAt, clock.elapsedMs);
  switch (f.band) {
    case 'GREEN':
      return { text: `${claim} — updated ${relative(f.ageMinutes)} ago`, tone: 'fresh' };
    case 'YELLOW':
      return { text: `${claim} — last reported ${relative(f.ageMinutes)} ago — call to confirm`, tone: 'aged' };
    case 'GREY':
      return { text: `${claim} — last reported at ${lagosTime(updatedAt)} — call to confirm`, tone: 'aged' };
    case 'SUPPRESSED':
      // No count, no reported time, no reason: past the ceiling nothing about the
      // old claim is shown. The facility heading and its call link stay.
      return { text: `${category}: ${UNKNOWN_STATUS}`, tone: 'none' };
  }
}

/** The page-level warning, or null when the snapshot is recent. Unknown age is a warning. */
export function snapshotBanner(generatedAt: string, clock: ServeClock): string | null {
  const age = snapshotAge(generatedAt, clock.servedAt, clock.elapsedMs);
  if (!age.stale) return null;
  if (!age.known) {
    return "We can't confirm how recent this page is. Counts may be out of date — call before you travel.";
  }
  return `This page was last refreshed at ${lagosTime(generatedAt)}. Counts may be out of date — call before you travel.`;
}
