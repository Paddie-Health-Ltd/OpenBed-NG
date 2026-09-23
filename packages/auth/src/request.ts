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
 * THE ANSWER IS DELIBERATELY FLATTENED TO TWO OUTCOMES, and this is the half that is
 * easy to undo by accident. OBSERVED 2026-09-23 on the local stack (GoTrue behind
 * Supabase CLI 2.117.0):
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
 * NOT CLOSED HERE, and it cannot be: anyone can POST to /auth/v1/otp directly and read
 * those statuses for themselves. Recorded in R-2026-09-23-66 as a finding, not solved
 * by this form.
 *
 * Bounded: one request with a 12-second timeout, retried once with jitter ONLY when
 * no response arrived. An HTTP answer is never retried -- a retry of a 429 is exactly
 * the traffic the limit exists to stop.
 */

export type SignInRequestOutcome =
  | { readonly kind: 'answered'; readonly status: number }
  | { readonly kind: 'unreachable'; readonly error: string };

export interface SignInRequest {
  readonly apiUrl: string;
  readonly anonKey: string;
  readonly email: string;
  /** Where the link returns to: the console's own origin. */
  readonly redirectTo: string;
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

const REQUEST_TIMEOUT_MS = 12_000;
/**
 * The header supabase-proxy/handler.ts sets on every answer, naming who gave it. A
 * second copy of that file's constant, because the ward console's import closure is
 * [auth, origins] and must not reach the Worker; tests/compliance/proxy_allow_list.test.ts
 * asserts the two are equal.
 */
export const PROXY_HEADER = 'x-openbed-proxy';
const ATTEMPTS = 2;

export async function requestSignInLink(req: SignInRequest): Promise<SignInRequestOutcome> {
  const doFetch = req.fetch ?? fetch;
  const sleep = req.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const url = `${req.apiUrl}/auth/v1/otp?redirect_to=${encodeURIComponent(req.redirectTo)}`;
  let last = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { apikey: req.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: req.email.trim(), create_user: false }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // A REFUSAL BY OUR OWN PROXY IS NOT AN ANSWER (R-2026-09-23-70 B, C3). If
      // api.openbed.ng's allow-list ever stops forwarding this path, the Worker's own
      // 404 would otherwise read as GoTrue having answered, and the ward would be told
      // a link is on its way when none was sent. The Worker marks its refusals, and
      // exposes the header to the page, so this can tell. It says nothing about the
      // address, so it is safe to show.
      if (res.headers.get(PROXY_HEADER) === 'refused') {
        return { kind: 'unreachable', error: `the OpenBed proxy did not forward /auth/v1/otp (HTTP ${res.status})` };
      }
      return { kind: 'answered', status: res.status };
    } catch (e) {
      last = String((e as Error).message ?? e);
      if (attempt < ATTEMPTS) await sleep(300 + Math.random() * 300);
    }
  }
  return { kind: 'unreachable', error: last };
}
