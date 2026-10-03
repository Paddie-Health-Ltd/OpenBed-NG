import WARD from '../ward-labels.json';

/**
 * WORDS ONLY THE WARD CONSOLE SHOWS (R-2026-09-23-70 E), from ../ward-labels.json.
 * A separate entry point, so the public page's bundle never carries them: the public
 * table must cover exactly what the public page receives.
 */

/** app.zero_reason (002), in its declared order, with words a ward reads. */
export const ZERO_REASONS: ReadonlyArray<readonly [string, string]> = Object.entries(WARD.zero_reason);

/** The publish form's choice of offering: a ward choosing, not the public line's statement. */
export const OFFERING_CHOICES: ReadonlyArray<readonly ['OFFERED' | 'NOT_OFFERED', string]> = [
  ['OFFERED', WARD.offering_choice.OFFERED],
  ['NOT_OFFERED', WARD.offering_choice.NOT_OFFERED],
];

/**
 * The stop a session with NO ward is shown (R-2026-09-24-88 BP-8). Zero rows from
 * my_reporting_wards is never a ward: it is an operator's session that fell back here,
 * or broken data. The console appends its support sentence to NO_WARD.
 */
export const NO_WARD_HEADING: string = WARD.session.NO_WARD_HEADING;
export const NO_WARD: string = WARD.session.NO_WARD;

/**
 * What a sign-in request is told when the Worker ITSELF limited it (R-2026-10-02-FF FF-3). Only the
 * Worker's own marker earns this sentence: Supabase's per-user 429 still reads as "answered", because
 * it reveals whether the address exists. The admin app keeps the same words as `screens.REQUEST_LIMITED`.
 */
export const SIGNIN_LIMITED: string = WARD.signin.LIMITED;
