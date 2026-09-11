import { sessionFromTokens, type Session } from '@openbed/auth';
import { apiUrl, anonKey, serviceRoleKey } from './local-keys.js';
import { sql } from './db.js';

/**
 * THE REAL-TOKEN HARNESS. A GoTrue-issued access token, obtained by consuming a
 * magic link over HTTP.
 *
 * WHY IT CANNOT BE tests/setup/db.ts. That file fakes identity with
 * `SET LOCAL request.jwt.claims`, which is exactly right for an RLS probe and
 * structurally cannot test the seam the golden path exists to prove. A hand-forged
 * claims blob CONTAINS WHATEVER YOU PUT IN IT, so a `session_id != auth.uid()`
 * assertion written against one asserts your own fixture back at you. The claims
 * here are minted by GoTrue and nobody in this repository chooses them.
 *
 * THE ROUTE, AND THE ONE THAT WOULD BE A LIE.
 *
 * supabase/config.toml has [local_smtp] enabled = false. There is no Inbucket and
 * no SMTP, so signInWithOtp cannot deliver anything. Three routes exist and the
 * dividing line is WHICH LEG GETS BYPASSED:
 *
 *   - Enabling local SMTP buys fidelity over the email TEMPLATE and TRANSPORT,
 *     which is not the property Gate 2 claims, at the cost of a container on every
 *     cold start. [auth.rate_limit] email_sent = 2 per hour would also bite
 *     immediately.
 *   - admin/generate_link then the public POST /auth/v1/verify -- THIS ONE.
 *     Only the transport is bypassed. Single use lives entirely in the CONSUMPTION
 *     leg, and that leg runs for real, over HTTP, against real GoTrue, with the
 *     anon key.
 *   - admin/createUser plus minting a session, or hand-signing a JWT. BANNED.
 *     Both obtain a ward session WITHOUT EVER CONSUMING A LINK and then claim to
 *     have proved magic-link auth. Named here so the ban is not folklore.
 *
 * Note the ban is on bypassing /verify, not on the admin API as such: minting the
 * link through the admin API is the transport bypass and is the point.
 *
 * EVERYTHING BELOW WAS READ OFF THE RUNNING GoTrue, NOT OFF THE DOCUMENTATION,
 * on 2026-09-10 against v2.196.0 (Supabase CLI 2.117.0). Two things differ from
 * what a reasonable person would assume, and both would have produced a harness
 * that fails for the wrong reason:
 *
 *   1. The minted token field is `hashed_token`. POST /verify takes it as
 *      `token_hash`. The names are transposed across the two calls.
 *   2. generate_link with {"type":"magiclink"} for an address GoTrue has never
 *      seen returns `verification_type: "signup"`, and /verify REFUSES
 *      type "magiclink" for that token. So the type is READ BACK from the mint
 *      response and echoed, never assumed. An existing confirmed user yields
 *      "magiclink"; a new one yields "signup"; the harness does not care which.
 *
 * NOT ASSERTED HERE, deliberately: hosted magic-link single-use. Local GoTrue is
 * pinned by the Supabase CLI; hosted auth is upgraded by Supabase out-of-band and
 * is not that version. docs/runbook-supabase-project-creation.md section 5b is
 * the only control over the hosted property and stays open.
 */

export interface MintedLink {
  /** The long token. GoTrue calls it `hashed_token` here and `token_hash` at /verify. */
  hashedToken: string;
  /** Echoed back to /verify verbatim. "signup" for an unseen address, "magiclink" for a known one. */
  verificationType: string;
  /** The auth.users id. Becomes `sub`, and Stage 1's ward_account row is keyed to it. */
  userId: string;
  email: string;
  actionLink: string;
  /** The whole response, so a test can print what actually came back. */
  raw: Record<string, unknown>;
}

export interface VerifyOutcome {
  status: number;
  body: Record<string, unknown>;
}

/**
 * A signed-in ward, in the SHARED session shape plus the two conveniences this
 * suite reads constantly.
 *
 * IT EXTENDS `Session` FROM @openbed/auth RATHER THAN RESTATING IT. This
 * harness proved the magic-link route before any app existed, and for a while
 * it was the only place that knew how to read a GoTrue token response -- so
 * when the ward console needed the same knowledge, the choice was one
 * derivation site or two. Two would have meant the harness proving one path
 * while the app shipped another, at the auth seam, which is the drift §7 of
 * .claude/rules/test-conventions.md closes everywhere else.
 *
 * What stays HERE is minting: `generate_link` is service-role and must never be
 * reachable from a browser bundle. See packages/auth/src/session.ts.
 */
export interface WardSession extends Session {
  readonly userId: string;
  /** From the JWT. Per-session and NOT equal to userId -- CTO condition 2. */
  readonly sessionId: string;
  readonly email: string;
}

function authHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Loud, and carrying what actually arrived. A harness that swallows a
    // non-JSON body reports "auth failed" for a proxy error page.
    throw new Error(`GoTrue returned a non-JSON body (HTTP ${res.status}): ${text.slice(0, 400)}`);
  }
}

/** The GoTrue build under test, so every local claim carries the version it is true of. */
export async function gotrueVersion(): Promise<string> {
  const res = await fetch(`${apiUrl()}/auth/v1/health`);
  const body = await readJson(res);
  const version = body['version'];
  if (typeof version !== 'string') {
    throw new Error(`/auth/v1/health did not report a version: ${JSON.stringify(body)}`);
  }
  return version;
}

/** Mint a link through the admin API. This is the transport bypass, and the only one. */
export async function mintMagicLink(email: string): Promise<MintedLink> {
  const res = await fetch(`${apiUrl()}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: authHeaders(serviceRoleKey()),
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const body = await readJson(res);
  if (res.status !== 200) {
    throw new Error(`admin/generate_link failed (HTTP ${res.status}): ${JSON.stringify(body)}`);
  }

  const hashedToken = body['hashed_token'];
  const verificationType = body['verification_type'];
  const userId = body['id'];
  const actionLink = body['action_link'];
  if (typeof hashedToken !== 'string' || typeof verificationType !== 'string' || typeof userId !== 'string') {
    throw new Error(
      'admin/generate_link response is not the shape this harness was written against. ' +
        `Expected hashed_token, verification_type and id. Received keys: ${Object.keys(body).sort().join(', ')}`,
    );
  }

  return {
    hashedToken,
    verificationType,
    userId,
    email,
    actionLink: typeof actionLink === 'string' ? actionLink : '',
    raw: body,
  };
}

/**
 * Consume a link at the PUBLIC endpoint, with the anon key. This is the leg that
 * runs for real, and it is the only leg single-use lives in.
 *
 * Returns the outcome rather than throwing, because the refusal cases are
 * assertions rather than errors.
 */
export async function verifyToken(link: Pick<MintedLink, 'hashedToken' | 'verificationType'>): Promise<VerifyOutcome> {
  const res = await fetch(`${apiUrl()}/auth/v1/verify`, {
    method: 'POST',
    headers: authHeaders(anonKey()),
    body: JSON.stringify({ type: link.verificationType, token_hash: link.hashedToken }),
  });
  return { status: res.status, body: await readJson(res) };
}

/**
 * Force a minted link to be expired.
 *
 * HOW, AND WHY IT IS THIS AND NOT SOMETHING ELSE -- the mechanism changes what the
 * expiry step proves, so it is recorded rather than left to the reader.
 *
 * Established by controlled probe on 2026-09-10 against GoTrue v2.196.0, with a
 * positive control that returned 200:
 *
 *   aged auth.users.confirmation_sent_at back 2h        -> /verify 403
 *   aged auth.one_time_tokens.created_at back 2h        -> /verify 200  (no effect)
 *   aged both                                            -> /verify 403
 *   aged nothing                                         -> /verify 200  (control)
 *
 * So expiry is driven by the SENT-AT COLUMN ON auth.users, not by the token row,
 * and a harness that aged one_time_tokens would have produced a step that passes
 * only when something else is broken.
 *
 * The alternative -- lowering otp_expiry in supabase/config.toml -- is rejected:
 * that setting is global to the stack every other step runs against, and a step
 * that alters shared auth configuration to make itself pass has changed the thing
 * it was measuring.
 *
 * NOT ASSERTED HERE, deliberately: that GoTrue expires a link ON ITS OWN after
 * otp_expiry seconds of real time. What is proved is that GoTrue refuses a token
 * whose sent-at is older than the window. Waiting an hour in CI to prove the
 * stronger claim is not a trade anyone should take.
 */
export async function forceLinkExpiry(email: string, olderThan = '2 hours'): Promise<void> {
  const db = sql();
  const rows = await db<{ email: string }[]>`
    update auth.users
       set confirmation_sent_at = now() - ${olderThan}::interval,
           recovery_sent_at     = case when recovery_sent_at is null then null
                                       else now() - ${olderThan}::interval end
     where email = ${email}
    returning email
  `;
  if (rows.length !== 1) {
    // The plant must be confirmed to have planted. A silent no-op here is
    // indistinguishable from GoTrue failing to expire the link, and it points
    // the investigation at the wrong component.
    throw new Error(
      `forceLinkExpiry did not update exactly one auth.users row for ${email} (updated ${rows.length}). ` +
        'The expiry step would then be asserting nothing.',
    );
  }
}

/**
 * Mint and consume in one go, returning a usable session. Throws on any refusal.
 *
 * THE PARSE IS `sessionFromTokens`, THE SAME ONE THE CONSOLE USES. It already
 * refuses a response with no session, names the keys that were present when it
 * does, and requires `sub` and `session_id` -- so the hand-rolled versions of
 * all three that used to live here are gone rather than duplicated. If GoTrue's
 * response shape changes, both sides red together; that is the whole point of
 * there being one of them.
 */
export async function signInWard(email: string): Promise<WardSession> {
  const link = await mintMagicLink(email);
  const outcome = await verifyToken(link);
  if (outcome.status !== 200) {
    throw new Error(`/auth/v1/verify refused a fresh link (HTTP ${outcome.status}): ${JSON.stringify(outcome.body)}`);
  }
  const session = sessionFromTokens(outcome.body);
  return { ...session, userId: session.claims.sub, sessionId: session.claims.sessionId, email };
}

/**
 * ONE SESSION PER RUN, REUSED.
 *
 * [auth.rate_limit] sign_in_sign_ups = 30 and token_verifications = 30, both per
 * FIVE MINUTES PER IP -- and a CI runner is one IP. A suite that mints per step
 * walks into a 429 that will be misfiled as a flake, on the day someone adds the
 * step that crosses the line rather than on the day the mistake was made.
 */
let cached: WardSession | null = null;

export async function wardSession(email: string): Promise<WardSession> {
  if (cached && cached.email === email) return cached;
  cached = await signInWard(email);
  return cached;
}

export function resetWardSession(): void {
  cached = null;
}

export interface RestOutcome {
  status: number;
  body: unknown;
}

/** A PostgREST request as the ward, with a token GoTrue actually issued. */
export async function authedRest(
  path: string,
  session: WardSession,
  opts: { method?: string; body?: unknown; profile?: string } = {},
): Promise<RestOutcome> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    apikey: anonKey(),
    Authorization: `Bearer ${session.accessToken}`,
    'Content-Type': 'application/json',
  };
  if (opts.profile !== undefined) {
    headers[method === 'GET' ? 'Accept-Profile' : 'Content-Profile'] = opts.profile;
  }

  const res = await fetch(`${apiUrl()}/rest/v1/${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    // A non-JSON body is legitimate for 204 and for some errors. Keep the text.
  }
  return { status: res.status, body };
}
