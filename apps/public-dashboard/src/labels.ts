import TABLE from './public-labels.json';

/**
 * WORDS FOR CODES, from ./public-labels.json (R-2026-09-23-68 C). The page never
 * prints a raw code: `ICU_ADULT` and `NO_ANAESTHETIST_ON_DUTY` are the database's
 * words, not a reader's.
 *
 * A code the table does not know -- an enum value added after this page was built --
 * renders the table's neutral fallback and is logged, once per code, with the code
 * and nothing else. Never the code on the page, and never a count in the log.
 */

export type LabelledEnum = keyof typeof TABLE.labels;

const LABELS: Record<LabelledEnum, Record<string, string>> = TABLE.labels;
const logged = new Set<string>();

function unknownCode(type: LabelledEnum, code: unknown): void {
  const key = `${type}:${String(code)}`;
  if (logged.has(key)) return;
  logged.add(key);
  console.error('OpenBed: no public label for a code in the snapshot', { enum: type, code });
}

/** True when the table has decided what this code shows (possibly nothing). */
export function isLabelled(type: LabelledEnum, code: unknown): code is string {
  return typeof code === 'string' && Object.hasOwn(LABELS[type], code);
}

/** The words for a code, or undefined -- logged -- when the table does not know it. */
function lookup(type: LabelledEnum, code: unknown): string | undefined {
  if (isLabelled(type, code)) return LABELS[type][code];
  unknownCode(type, code);
  return undefined;
}

export function categoryLabel(code: unknown): string {
  return lookup('ward_category', code) ?? TABLE.fallbacks.ward_category;
}

export function reasonLabel(code: unknown): string {
  return lookup('gate_reason', code) ?? TABLE.fallbacks.gate_reason;
}

/** The words a state adds to the line ('' for none), or undefined -- logged -- when unknown. */
export function stateWords(type: 'ward_offering' | 'monitoring_state', code: unknown): string | undefined {
  return lookup(type, code);
}

export const UNKNOWN_STATUS: string = TABLE.fallbacks.status;
