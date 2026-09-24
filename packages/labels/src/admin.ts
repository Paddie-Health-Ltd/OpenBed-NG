import ADMIN from '../admin-labels.json';
import PUBLIC from '../public-labels.json';

/**
 * WORDS ONLY THE ADMIN APP SHOWS (R-2026-09-24-97; PR 3.4b-app C), from
 * ../admin-labels.json. A separate entry point, as ./ward is, so neither the public
 * page's bundle nor the ward console's carries them.
 *
 * The tables are data, not logic: apps/admin/src/messages.ts decides which key a
 * refusal maps to, and falls back to FIXED.UNRECOGNISED for any key not here.
 */

/** Refusal code (or `INVALID_ARGUMENT:<param>`) -> sentence. */
export const ADMIN_CODES: Readonly<Record<string, string>> = ADMIN.codes;
/** CHECK constraint name -> sentence, for a 23514. */
export const ADMIN_CONSTRAINTS: Readonly<Record<string, string>> = ADMIN.constraints;
/** `<table>.<column>` -> sentence, for a 23502. */
export const ADMIN_NOT_NULL: Readonly<Record<string, string>> = ADMIN.not_null;
/** Sentences that do not come from a server code. */
export const ADMIN_FIXED: Readonly<Record<keyof typeof ADMIN.fixed, string>> = ADMIN.fixed;
/** Every other word on the admin screens. */
export const ADMIN_SCREENS: Readonly<Record<keyof typeof ADMIN.screens, string>> = ADMIN.screens;

/**
 * app.ward_category's values, for the add-category form: the keys of the public table,
 * which tests/db/public_labels_enum.test.ts holds equal to the enum. Not retyped here.
 */
export const WARD_CATEGORIES: readonly string[] = Object.keys(PUBLIC.labels.ward_category);
