import { ADMIN_CODES, ADMIN_CONSTRAINTS, ADMIN_FIXED, ADMIN_NOT_NULL } from '@openbed/labels/admin';

/**
 * WHAT THE OPERATOR IS TOLD, FOR EVERY ANSWER THE SERVER CAN GIVE (R-2026-09-24-97;
 * the PR 3.4b-app C design report, section 4).
 *
 * Every refusal maps to a KEY, and every key to a fixed sentence in
 * packages/labels/admin-labels.json. Server text is never shown. The key is:
 *   - `x-openbed-proxy: refused`             -> WORKER_REFUSED (H5 has not landed)
 *   - PostgREST PGRST202                     -> FUNCTION_MISSING
 *   - 23514, by the CONSTRAINT NAME in the message -> constraint:<name>
 *   - 23502, by the column and relation      -> not_null:<table>.<column>
 *   - INVALID_ARGUMENT, with its DETAIL      -> INVALID_ARGUMENT:<param>
 *   - otherwise the leading code of `message` -> <CODE>
 * A key with no sentence is UNRECOGNISED.
 *
 * A 23514 IS READ BY NAME because it is the only signal a bad latitude, longitude,
 * phone or blank name gives: 020's create and edit validate none of them (the design
 * report's section 0 item 8). The ward console maps every 23514 to one sentence; that
 * would tell the operator "something is wrong" about a swapped latitude.
 *
 * THE CODE PATTERN ALLOWS DIGITS: `MOBILE_NOT_E164` is a real code (021:440), and a
 * pattern of [A-Z_] alone reads it as nothing -- the defect PR A's refusal-code pattern
 * had (R-2026-09-24-91).
 *
 * NOTHING ABOUT A CONTACT IS EVER LOGGED (BP-5). This logs the status and the KEY, and
 * only a key this table knows, never the response body: a refusal on a contact path
 * can echo the values sent, and the ward console's mapper, which logs the body, would
 * put a named person's email in the browser console. tests/compliance/admin_render.test.ts
 * spies every console method across the contact paths.
 */

export interface Refusal {
  readonly key: string;
  readonly sentence: string;
}

function keyFor(headers: Headers | null, body: string): string {
  if (headers?.get('x-openbed-proxy') === 'refused') return 'WORKER_REFUSED';
  let parsed: { message?: unknown; code?: unknown; details?: unknown };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    return 'UNRECOGNISED';
  }
  if (typeof parsed !== 'object' || parsed === null) return 'UNRECOGNISED';
  const code = typeof parsed.code === 'string' ? parsed.code : '';
  const message = typeof parsed.message === 'string' ? parsed.message : '';
  if (code === 'PGRST202') return 'FUNCTION_MISSING';
  if (code === '23514') {
    const name = /violates check constraint "([a-z0-9_]+)"/.exec(message)?.[1];
    return name === undefined ? 'UNRECOGNISED' : `constraint:${name}`;
  }
  if (code === '23502') {
    const m = /null value in column "([a-z0-9_]+)" of relation "([a-z0-9_]+)"/.exec(message);
    return m === null ? 'UNRECOGNISED' : `not_null:${m[2] as string}.${m[1] as string}`;
  }
  const token = /^([A-Z][A-Z0-9_]*)\b/.exec(message)?.[1] ?? '';
  if (token === 'INVALID_ARGUMENT') {
    const param = typeof parsed.details === 'string' && /^p_[a-z_]+$/.test(parsed.details) ? parsed.details : '';
    return `INVALID_ARGUMENT:${param}`;
  }
  return token === '' ? 'UNRECOGNISED' : token;
}

/** The sentence for a key, or null when this table does not word it. */
export function sentenceFor(key: string): string | null {
  if (key.startsWith('constraint:')) return ADMIN_CONSTRAINTS[key.slice('constraint:'.length)] ?? null;
  if (key.startsWith('not_null:')) return ADMIN_NOT_NULL[key.slice('not_null:'.length)] ?? null;
  if (Object.hasOwn(ADMIN_FIXED, key)) return ADMIN_FIXED[key as keyof typeof ADMIN_FIXED];
  return Object.hasOwn(ADMIN_CODES, key) ? (ADMIN_CODES[key] as string) : null;
}

/** The refusal, logged as status and key only. An unknown key is UNRECOGNISED, and logged as that. */
export function adminMessageFor(status: number, headers: Headers | null, body: string): Refusal {
  const raw = keyFor(headers, body);
  const sentence = sentenceFor(raw);
  const key = sentence === null ? 'UNRECOGNISED' : raw;
  console.error('OpenBed admin: the server refused a request', { status, key });
  return { key, sentence: sentence ?? ADMIN_FIXED.UNRECOGNISED };
}
