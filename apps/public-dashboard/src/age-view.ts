import { freshnessBand, lagosTime, snapshotAge, type DecodedRow } from '@openbed/snapshot';
import { categoryLabel, precedence, reasonLabel, UNKNOWN_STATUS } from './labels.js';

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
 * WHICH STATE WINS is precedence() in packages/labels/src/index.ts, shared with the
 * ward console since R-2026-09-23-70 E so the two screens cannot disagree:
 *   1. any of monitoring_state, offering, status_source or status_state that the
 *      label table does not know -> "Status unknown -- call to confirm";
 *   2. PENDING or PAUSED -> "not currently reporting", WHATEVER THE OFFERING;
 *   3. NOT_OFFERED -> "not offered at this facility", with no count, age or
 *      accepting clause -- reached only by a ward that has left PENDING, and every
 *      path out of PENDING states the offering (tests/compliance/public_labels.test.ts);
 *   4. otherwise, the count, the words for an ADMIN source and an UNDER_REVIEW state
 *      BESIDE it (R-2026-09-23-69 (b); 002 section 6), and its age band, below.
 * Every category, reason and state is shown in words from the shared table.
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

/**
 * ONE PIECE OF A WARD LINE, FOR STYLING ONLY (the design pass, D1). The renderer wraps
 * each piece that has a `role` in a span and appends the rest as plain text, so the
 * row's textContent is the pieces joined -- which is wardLine(...).text, because
 * wardLine is built from these same pieces. Nothing here adds a word.
 */
export interface WardLineSegment {
  readonly text: string;
  readonly role?: 'category' | 'badge' | 'words' | 'stamp';
}

/**
 * THE COLOUR RULE (the design-pass kickoff, D1, "Cowork's call"). A count badge takes a
 * status fill only while its claim is FRESH (band GREEN): a green badge on a stale count
 * reads as "go". Available is accepting with a count above 0; Full is not accepting, or
 * 0. Everything else -- YELLOW, GREY, SUPPRESSED, an unknown age, a null count, and every
 * state that is not a claim -- is `unknown`. "Limited" is never used: no threshold for it
 * has been ruled. The words carry everything; colour is never the only signal.
 */
export type WardStatus = 'available' | 'full' | 'unknown';

export interface WardLineParts {
  readonly tone: WardLine['tone'];
  /** The freshness band, or null when there is no age to band (not a claim, or age unknown). */
  readonly band: 'GREEN' | 'YELLOW' | 'GREY' | 'SUPPRESSED' | null;
  readonly status: WardStatus;
  readonly segments: readonly WardLineSegment[];
}

/** The whole line for one ward, in pieces: its claim, and how old that claim is. */
export function wardLineParts(ward: DecodedRow, clock: ServeClock): WardLineParts {
  const category = categoryLabel(ward['category']);
  const head: WardLineSegment[] = [{ text: category, role: 'category' }, { text: ': ' }];
  const p = precedence({
    monitoring_state: ward['monitoring_state'],
    offering: ward['offering'],
    source: ward['source'],
    state: ward['state'],
  });
  if (p.kind === 'unknown' || p.kind === 'not-reporting' || p.kind === 'not-offered') {
    return { tone: p.kind, band: null, status: 'unknown', segments: [...head, { text: p.words, role: 'words' }] };
  }

  const bedCount = ward['bed_count'];
  const open = ward['accepting_effective'] === true;
  const reason = ward['gated_by'];
  const count: WardLineSegment =
    bedCount === null ? { text: 'not yet reporting', role: 'words' } : { text: `${String(bedCount)} beds`, role: 'badge' };
  const rest = `${open ? '' : ' — not accepting'}${reason === null || reason === undefined ? '' : ` (${reasonLabel(reason)})`}${p.qualifiers}`;
  const claim: WardLineSegment[] = rest === '' ? [...head, count] : [...head, count, { text: rest }];
  const aged = (band: WardLineParts['band'], tone: WardLine['tone'], stamp: string, status: WardStatus = 'unknown'): WardLineParts => ({
    tone,
    band,
    status,
    segments: [...claim, { text: ' — ' }, { text: stamp, role: 'stamp' }],
  });

  const updatedAt = typeof ward['updated_at'] === 'string' ? ward['updated_at'] : '';
  if (clock.servedAt === null || Number.isNaN(Date.parse(clock.servedAt)) || Number.isNaN(Date.parse(updatedAt))) {
    return aged(null, 'unknown', 'age unknown — call to confirm');
  }

  const f = freshnessBand(updatedAt, clock.servedAt, clock.elapsedMs);
  switch (f.band) {
    case 'GREEN': {
      const status: WardStatus =
        typeof bedCount !== 'number' ? 'unknown' : open && bedCount > 0 ? 'available' : 'full';
      return aged('GREEN', 'fresh', `updated ${relative(f.ageMinutes)} ago`, status);
    }
    case 'YELLOW':
      return aged('YELLOW', 'aged', `last reported ${relative(f.ageMinutes)} ago — call to confirm`);
    case 'GREY':
      return aged('GREY', 'aged', `last reported at ${lagosTime(updatedAt)} — call to confirm`);
    case 'SUPPRESSED':
      // No count, no reported time, no reason: past the ceiling nothing about the
      // old claim is shown. The facility heading and its call link stay.
      return { tone: 'none', band: 'SUPPRESSED', status: 'unknown', segments: [...head, { text: UNKNOWN_STATUS, role: 'words' }] };
  }
}

/** The whole line for one ward as one string: the pieces above, joined. */
export function wardLine(ward: DecodedRow, clock: ServeClock): WardLine {
  const parts = wardLineParts(ward, clock);
  return { text: parts.segments.map((s) => s.text).join(''), tone: parts.tone };
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
