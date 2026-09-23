import TABLE from '../public-labels.json';

/**
 * WORDS FOR CODES, AND WHICH STATE WINS -- ONE SOURCE FOR BOTH SCREENS
 * (R-2026-09-23-68 C; R-2026-09-23-70 E).
 *
 * The public page and the ward console both show a ward's state. Until -70 E the
 * console printed the database's codes ("ICU_ADULT: NOT_OFFERED, not yet reporting")
 * while the page printed words, and the two applied different precedence, so a
 * PENDING ward's default offering read as a statement on one screen and not the
 * other. Both now read the words from ../public-labels.json and the precedence from
 * precedence() below.
 *
 * A code the table does not know -- an enum value added after the build -- renders a
 * neutral fallback and is logged, once per code, with the code and nothing else.
 * Never the code on the screen, and never a count in the log.
 *
 * NOTHING HERE READS A CLOCK. The public page's age bands stay in
 * apps/public-dashboard/src/age-view.ts, inside that app's device-clock scan.
 */

export type LabelledEnum = keyof typeof TABLE.labels;

const LABELS: Record<LabelledEnum, Record<string, string>> = TABLE.labels;
const logged = new Set<string>();

function unknownCode(type: LabelledEnum, code: unknown): void {
  const key = `${type}:${String(code)}`;
  if (logged.has(key)) return;
  logged.add(key);
  console.error('OpenBed: no label for a code', { enum: type, code });
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
export function stateWords(type: 'ward_offering' | 'monitoring_state' | 'status_source' | 'status_state', code: unknown): string | undefined {
  return lookup(type, code);
}

export const UNKNOWN_STATUS: string = TABLE.fallbacks.status;

/** The four codes that decide how a ward's line reads. */
export interface WardStateCodes {
  readonly monitoring_state: unknown;
  readonly offering: unknown;
  readonly source: unknown;
  readonly state: unknown;
}

/**
 * WHICH STATE WINS, in this order (R-2026-09-23-68 C, the founder's condition;
 * extended by R-2026-09-23-69 (b)):
 *   1. any of the four codes the table does not know -> "Status unknown -- call to
 *      confirm". A state that cannot be read is not guessed at.
 *   2. PENDING or PAUSED -> "not currently reporting", WHATEVER THE OFFERING: a
 *      PENDING ward's offering may be a default nobody chose (004).
 *   3. NOT_OFFERED -> "not offered at this facility". Reached only by a ward that has
 *      left PENDING, and every path out of PENDING states the offering
 *      (tests/compliance/public_labels.test.ts holds that).
 *   4. otherwise the count is shown, followed by `qualifiers`: the words for
 *      status_source ADMIN ("set by admin, not ward-confirmed") and status_state
 *      UNDER_REVIEW ("under review"), each BESIDE the count (002 section 6). WARD and
 *      OK add nothing.
 */
export type Precedence =
  | { readonly kind: 'unknown'; readonly words: string }
  | { readonly kind: 'not-reporting'; readonly words: string }
  | { readonly kind: 'not-offered'; readonly words: string }
  | { readonly kind: 'claim'; readonly qualifiers: string };

export function precedence(codes: WardStateCodes): Precedence {
  const monitoring = stateWords('monitoring_state', codes.monitoring_state);
  const offering = stateWords('ward_offering', codes.offering);
  const source = stateWords('status_source', codes.source);
  const review = stateWords('status_state', codes.state);
  if (monitoring === undefined || offering === undefined || source === undefined || review === undefined) {
    return { kind: 'unknown', words: UNKNOWN_STATUS };
  }
  if (codes.monitoring_state === 'PENDING' || codes.monitoring_state === 'PAUSED') return { kind: 'not-reporting', words: monitoring };
  if (codes.offering === 'NOT_OFFERED') return { kind: 'not-offered', words: offering };
  const qualifiers = [source, review].filter((w) => w !== '').map((w) => ` — ${w}`).join('');
  return { kind: 'claim', qualifiers };
}
