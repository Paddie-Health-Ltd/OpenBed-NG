import { CALL_WORST_CASE_MS, PROXY_HEADER, fetchWithFallback } from './fallback.js';

export { PROXY_HEADER };

/**
 * A WARD ASKS FOR A NEW SIGN-IN LINK (the Bundle 3 kickoff, AJ F2; R-2026-09-23-66).
 *
 * Sessions are time-boxed at 24 hours and links are single-use, and until this the
 * console could only say "open the link sent to this ward's address" -- nothing let a
 * ward sign in again the next day. The founder chose a ward-side request over an
 * operator "resend", because the ward-identity model rests on physical control of the
 * handset, not on the operator.
 *
 * `create_user: false` IS THE SECURITY PROPERTY. An address GoTrue does not know is
 * REFUSED, never created: without it this form would be an open sign-up.
 *
 * THE ANSWER IS DELIBERATELY FLATTENED, and this is the half that is easy to undo by
 * accident. OBSERVED 2026-09-23 on the local stack (GoTrue behind Supabase CLI 2.117.0):
 *   - a KNOWN address answers 200 `{}`, and an immediate repeat answers
 *     429 `over_email_send_rate_limit`;
 *   - an UNKNOWN address answers 422 `otp_disabled` ("Signups not allowed for otp"),
 *     every time -- it never reaches a rate limit, because no mail is sent.
 * So every distinct status is evidence about whether the address exists, a 429
 * included. The console must say ONE thing whichever of them came back, and this
 * function makes that the only thing it CAN say: it returns `answered` for any HTTP
 * response and `unreachable` only when no response arrived at all, which does not
 * depend on the address. The status is returned for the log, never for the screen.
 *
 * RESTATED 2026-10-02 (R-2026-10-02-FF FF-3, -182): "two outcomes" is now THREE, and the reason for
 * flattening does not reach the third. `limited` is returned ONLY for an answer carrying
 * `x-openbed-proxy: limited`, the Worker's OWN per-address limit. That limit says nothing about whether
 * an address exists, so a distinct message leaks nothing. Supabase's own 429 on /otp carries no marker;
 * it is GoTrue's per-USER limit, it DOES reveal the address, and it stays `answered`. A `limited`
 * answer is never retried and never sent to the fallback origin: the limit is the answer.
 *
 * NOT CLOSED HERE, and it cannot be: anyone can POST to /auth/v1/otp directly and read
 * those statuses for themselves. Recorded in R-2026-09-23-66 as a finding, not solved
 * by this form.
 *
 * Bounded. THE ORIGINAL TEXT (2026-09-23): "one request with a 12-second timeout, retried once with
 * jitter ONLY when no response arrived. An HTTP answer is never retried -- a retry of a 429 is exactly
 * the traffic the limit exists to stop." RESTATED 2026-10-02 (FF-1): each of the two attempts is a PAIR
 * of sends (the Worker, then the direct origin when there is one and the Worker rejected or refused),
 * so the worst case is two attempts of at most 24 s: 48 s, plus at most 0.6 s of jitter. With no
 * `fallbackApiUrl` it is the original, one send per attempt.
 *
 * A request falls back like every other call, so a ward can ask for a link while the Worker is down.
 * The EMAILED link still opens on api.openbed.ng until the two email templates are rolled back to the
 * default confirmation-URL variable (docs/runbook-cloudflare-worker-proxy.md, section 6), so a NEW
 * sign-in does not survive a Worker outage even though the request for one does.
 */

export type SignInRequestOutcome =
  | { readonly kind: 'answered'; readonly status: number }
  | { readonly kind: 'limited' }
  | { readonly kind: 'unreachable'; readonly error: string };

export interface SignInRequest {
  readonly apiUrl: string;
  /** The origin to fall back to, or none. Equal to `apiUrl` means none. Taken as an argument, never imported. */
  readonly fallbackApiUrl?: string;
  readonly anonKey: string;
  readonly email: string;
  /** Where the link returns to: the console's own origin. */
  readonly redirectTo: string;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Two attempts, each a pair of sends: held by tests/compliance/auth_fallback.test.ts. */
export const SIGNIN_ATTEMPTS = 2;

/** The worst case, without the jitter between attempts: two attempts of 24 s. */
export const SIGNIN_WORST_CASE_MS = SIGNIN_ATTEMPTS * CALL_WORST_CASE_MS;

/**
 * The wait before the second attempt: 300 ms plus `r` (0 to 1) of 300 ms of jitter. THE ONE SOURCE
 * (R-2026-10-02-FG FG-2, -183): the sleep below calls it with Math.random(), and the maximum is the same
 * function at 1, so the 0.6 s the header states can never be a copy of the formula the sleep uses.
 */
export const signInBackoffMs = (r: number): number => 300 + r * 300;

/** The longest wait between the two attempts: 600 ms. */
export const SIGNIN_BACKOFF_MAX_MS = signInBackoffMs(1);

export async function requestSignInLink(req: SignInRequest): Promise<SignInRequestOutcome> {
  const sleep = req.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const origins = req.fallbackApiUrl === undefined ? [req.apiUrl] : [req.apiUrl, req.fallbackApiUrl];
  let last = '';
  for (let attempt = 1; attempt <= SIGNIN_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetchWithFallback(
        `/auth/v1/otp?redirect_to=${encodeURIComponent(req.redirectTo)}`,
        {
          method: 'POST',
          headers: { apikey: req.anonKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: req.email.trim(), create_user: false }),
        },
        { origins, ...(req.fetch === undefined ? {} : { fetch: req.fetch }) },
      );
      const marker = res.headers.get(PROXY_HEADER);
      // A REFUSAL BY OUR OWN PROXY IS NOT AN ANSWER (R-2026-09-23-70 B, C3). If
      // api.openbed.ng's allow-list ever stops forwarding this path, the Worker's own
      // 404 would otherwise read as GoTrue having answered, and the ward would be told
      // a link is on its way when none was sent. The Worker marks its refusals, and
      // exposes the header to the page, so this can tell. It says nothing about the
      // address, so it is safe to show. (Reached only with no second origin, or when the
      // second origin also refused: otherwise the fallback has already re-sent it.)
      if (marker === 'refused') {
        return { kind: 'unreachable', error: `the OpenBed proxy did not forward /auth/v1/otp (HTTP ${res.status})` };
      }
      // THE WORKER'S OWN LIMIT (FF-3 a). Never retried: a retry is the traffic the limit exists to stop.
      if (marker === 'limited') return { kind: 'limited' };
      return { kind: 'answered', status: res.status };
    } catch (e) {
      last = String((e as Error).message ?? e);
      if (attempt < SIGNIN_ATTEMPTS) await sleep(signInBackoffMs(Math.random()));
    }
  }
  return { kind: 'unreachable', error: last };
}
