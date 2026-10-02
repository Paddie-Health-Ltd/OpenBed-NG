/**
 * THE TWO-ORIGIN SEND (R-2026-10-02-FF FF-1, -182; R-2026-09-19-23 D5, availability on the clinical path).
 *
 * WHY THIS EXISTS. Every ward-console call goes to the Worker at api.openbed.ng. When the Worker is
 * down, nothing used to fall back: a publish showed UNRECOGNISED and a refresh signed the handset
 * out. A signed-out ward needs a new emailed link, and every link in the project shares 30 emails an
 * hour, so a city-wide network blip at shift change could sign wards out faster than the project can
 * send them links. This function sends to the Worker first and, ONLY in the two cases below, to the
 * Supabase origin directly.
 *
 * THE PROPERTIES, each held by tests/compliance/auth_fallback.test.ts:
 *   1. With no second origin, or a second origin equal to the first, it sends ONCE, exactly as one
 *      fetch does today, and a rejection propagates unwrapped. The admin app passes no second origin.
 *   2. It sends to the second origin ONLY when (a) the fetch to the first REJECTS, for any reason other
 *      than the caller's own aborted signal, or (b) the first ANSWERS with `x-openbed-proxy: refused`,
 *      the Worker's own refusal. Supabase was never contacted in either case, so a re-send cannot
 *      duplicate anything. (b) covers allow-list drift, which the kickoff's platform-sre note names as
 *      a real Worker risk, and differs from the kickoff ("only when the fetch itself rejects") on
 *      purpose. Either one calls `onPrimaryFailed`.
 *   3. It NEVER falls back on any other answer: not on `limited` (the limit is the answer), and not on
 *      a forwarded 401, 4xx or 5xx. An answer the page can read is the server's answer.
 *   4. Each send gets ITS OWN `AbortSignal.timeout`. A signal created once and shared is already
 *      aborted when the first send times out, so the fallback would fail at once. A caller's own
 *      signal REPLACES the timeout, as it does in authedFetch; once it has aborted, nothing more is
 *      sent.
 *   5. The body is re-sent byte for byte. Only a string body, or none, is accepted: a stream cannot be
 *      sent twice, so any other body type throws BEFORE anything is sent.
 *   6. If no origin gives an answer it throws OriginsUnreachableError carrying each cause. That
 *      includes a first origin that answered `refused` and a second that rejected: the refusal is not
 *      handed back as a 404 answer.
 *
 * THE BOUNDS (the constants below and in holder.ts and request.ts; asserted by reading them):
 *   - one call: at most two sends of at most 12 s, so 24 s;
 *   - a refresh: three attempts of that pair with holder.ts's backoff, 73.25 s (36 s before this);
 *   - a sign-in request: two attempts of a pair, 48 s;
 *   - a publish tap's `composed_at`: built before authedFetch, so it ages through a refresh and one
 *     call, 97.25 s, under migration 026's STALE_MUTATION window (read from the migration, not typed).
 *
 * WHAT IS NOT DONE HERE. Stickiness (after a failure the direct origin goes first for five minutes)
 * is the holder's, because the sign-in request is stateless. Which failures sign a session out is
 * the holder's too. This file never reads or writes a session.
 *
 * NOT ASSERTED, and cannot be from this repository: that a browser's fetch rejects when Cloudflare's
 * own error page, which carries no CORS header, answers. That is the Fetch standard's rule; CI has no
 * browser runner (the -70 C3 TRIGGER row).
 */

/**
 * The header supabase-proxy/handler.ts sets on every answer, naming who gave it. A second copy of that
 * file's constant, because the ward console's import closure is [auth, labels, origins] and must not
 * reach the Worker; tests/compliance/proxy_allow_list.test.ts asserts the two are equal (through
 * request.ts, which re-exports this).
 */
export const PROXY_HEADER = 'x-openbed-proxy';

/** Per the SOP: every external call has a timeout, and 12 seconds is the ceiling. */
export const SEND_TIMEOUT_MS = 12_000;

/** A call is at most this many sends: the Worker, then the direct origin. */
export const MAX_SENDS_PER_CALL = 2;

/** The longest one call can take: both sends running to their timeout. */
export const CALL_WORST_CASE_MS = SEND_TIMEOUT_MS * MAX_SENDS_PER_CALL;

/** No origin gave an answer. Carries what each one did, in the order they were tried. */
export class OriginsUnreachableError extends Error {
  readonly causes: readonly unknown[];

  constructor(causes: readonly unknown[]) {
    super(`no origin answered: ${causes.map((c) => describeCause(c)).join('; ')}`);
    this.name = 'OriginsUnreachableError';
    this.causes = causes;
  }
}

export interface FallbackOptions {
  /** Ordered. Only the first two are used. A second equal to the first is dropped. */
  readonly origins: readonly string[];
  /** Injectable. Defaults to the global fetch, looked up at call time. */
  readonly fetch?: typeof fetch;
  /** Injectable. Per send, default 12 s. */
  readonly timeoutMs?: number;
  /** Called when the FIRST origin rejected or answered `refused`, and a second origin exists. */
  readonly onPrimaryFailed?: () => void;
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`;
  return String(cause);
}

const trimSlash = (o: string): string => o.replace(/\/+$/, '');

export async function fetchWithFallback(path: string, init: RequestInit, options: FallbackOptions): Promise<Response> {
  // Refused BEFORE anything is sent: a stream cannot be sent twice.
  if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') {
    throw new TypeError('fetchWithFallback accepts only a string body, or none: a stream cannot be sent twice');
  }
  const origins = options.origins.map(trimSlash).filter((o, i, all) => all.indexOf(o) === i).slice(0, MAX_SENDS_PER_CALL);
  const first = origins[0];
  if (first === undefined) throw new TypeError('fetchWithFallback needs at least one origin');

  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? SEND_TIMEOUT_MS;
  // A NEW signal per send. See property 4.
  const send = (origin: string): Promise<Response> => doFetch(`${origin}${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });

  // One origin: exactly one fetch, unwrapped.
  if (origins.length === 1) return send(first);

  const causes: unknown[] = [];
  for (const [i, origin] of origins.entries()) {
    let res: Response;
    try {
      res = await send(origin);
    } catch (e) {
      // The caller's own abort is the caller's answer. Nothing more is sent.
      if (init.signal?.aborted === true) throw e;
      causes.push(e);
      if (i === 0) options.onPrimaryFailed?.();
      continue;
    }
    if (i === 0 && res.headers.get(PROXY_HEADER) === 'refused') {
      causes.push(new Error(`the OpenBed proxy refused ${path} (HTTP ${res.status})`));
      options.onPrimaryFailed?.();
      // Release the refused answer's body, but never WAIT on it: cancelling a teed stream settles only
      // when every branch has cancelled, and nothing here needs the body.
      void res.body?.cancel().catch(() => undefined);
      continue;
    }
    return res;
  }
  throw new OriginsUnreachableError(causes);
}
