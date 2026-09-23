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
