/**
 * WORDS FOR CODES live in packages/labels since R-2026-09-23-70 E, shared with the
 * ward console so the two screens cannot disagree. This file stays, as a re-export,
 * because tests/compliance/dashboard_age.test.ts names it and scans every file in
 * this directory for device-clock reads.
 */
export { categoryLabel, reasonLabel, stateWords, precedence, isLabelled, UNKNOWN_STATUS } from '@openbed/labels';
export type { LabelledEnum, Precedence, WardStateCodes } from '@openbed/labels';
