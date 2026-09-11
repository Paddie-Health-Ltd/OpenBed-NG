/**
 * THE ONE DERIVATION SITE FOR HOW THIS SYSTEM AUTHENTICATES.
 *
 * WHY THIS PACKAGE EXISTS. `tests/setup/auth.ts` proved the whole magic-link
 * route with plain `fetch` before any app used it. Had the ward console then
 * reached for @supabase/supabase-js, this system would have had TWO derivation
 * sites for its own auth: one the harness proves and a different one the app
 * ships. That is the shape §7 of .claude/rules/test-conventions.md closes
 * everywhere else, and it is worse here than usual, because the thing that
 * would drift is the auth seam.
 *
 * WHAT THIS FILE IS NOT, AND THE LINE IS LOAD-BEARING. It CONSUMES a session;
 * it never MINTS one. Minting goes through GoTrue's admin API with the
 * service-role key, which is server-side by definition. A shared module
 * carrying the mint would put `SUPABASE_SERVICE` into the ward console's
 * bundle, and `scripts/lint_no_service_role_in_bundle.sh` would red. The split
 * is enforced by that guard rather than by this paragraph.
 *
 * EVERYTHING HERE IS PURE. No clock, no network, no storage. The stateful half
 * is `holder.ts`.
 *
 * ON THE DEVICE CLOCK, because finding F3 is in this repository and someone
 * will reasonably ask. `packages/snapshot/src/anchor.ts` refuses the wall clock
 * outright: a phone three hours slow renders a four-hour-old bed count GREEN,
 * with no server in the loop to contradict it, and the tile is confidently
 * wrong. SESSION EXPIRY IS NOT THAT SHAPE. The server validates `exp` on every
 * single request, so the local check here is only an OPTIMISATION that avoids a
 * round trip which is certain to 401. Skew degrades it to one wasted request
 * (clock slow) or one early refresh (clock fast), never to a silent wrong
 * answer. The authority is the server; this is a hint. `holder.ts` carries the
 * guard against a fast clock turning that hint into a refresh loop.
 */

/** The claims this system actually depends on. GoTrue emits more; these are the contract. */
export interface Claims {
  /** The auth user id. Equals `app.ward_account.id` -- the seam scripts/provision_ward_account.mjs creates. */
  readonly sub: string;
  /**
   * Per-session and NOT equal to `sub`. CTO condition 2 of the ward-identity
   * decision: the audit row may carry a session id for correlating a burst of
   * edits, it must not be derivable back to a mailbox, and it must not outlive
   * the session.
   */
  readonly sessionId: string;
  /** Seconds since the epoch, server-issued. */
  readonly exp: number;
  readonly iat: number;
  readonly role: string;
  readonly email: string | null;
}

export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Seconds since the epoch, from the server's own `expires_at`. */
  readonly expiresAt: number;
  readonly claims: Claims;
}

/** Thrown by everything in this package when a token is unusable. Never swallowed into a default. */
export class MalformedTokenError extends Error {}

/**
 * Base64url -> JSON, in both runtimes, WITHOUT depending on either one's types.
 *
 * This package is imported by the ward console (DOM, no @types/node) and by the
 * test harness (node, no DOM). Referencing `atob` or `Buffer` as globals would
 * make one of the two fail to type-check, and the tempting fix -- adding
 * @types/node to a browser app -- is how `Buffer` ends up in a bundle. So both
 * are reached through `globalThis` with an explicit shape.
 */
interface Base64Runtime {
  atob?: (s: string) => string;
  Buffer?: { from(s: string, encoding: string): { toString(encoding: string): string } };
}

function base64UrlToJson(segment: string): unknown {
  const pad = segment.length % 4 === 0 ? '' : '='.repeat(4 - (segment.length % 4));
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const g = globalThis as unknown as Base64Runtime;

  let bytes: string;
  if (typeof g.atob === 'function') bytes = g.atob(b64);
  else if (g.Buffer !== undefined) bytes = g.Buffer.from(b64, 'base64').toString('binary');
  // NOT a silent empty string. A runtime with neither decoder cannot read a
  // token at all, and a decoder that returns nothing would surface as "this
  // token carries no sub" -- sending the reader to the wrong layer entirely.
  else throw new Error('this runtime has neither atob nor Buffer, so no token can be decoded');

  const text = decodeURIComponent(
    Array.from(bytes, (ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
  );
  return JSON.parse(text);
}

/**
 * Reads the claims out of an access token.
 *
 * THIS IS A DECODE, NOT A VERIFICATION, and saying so is the point. Nothing
 * here checks the signature -- the client has no key to check it with, and a
 * client-side check would be security theatre either way. The server verifies.
 * What this is for is knowing WHEN to refresh and WHICH ward account is signed
 * in, both of which are the server's answers being read back.
 */
export function claimsOf(accessToken: string): Claims {
  const parts = accessToken.split('.');
  if (parts.length !== 3) {
    throw new MalformedTokenError(`access token is not a three-segment JWT (${parts.length} segments)`);
  }
  let raw: Record<string, unknown>;
  try {
    raw = base64UrlToJson(parts[1] as string) as Record<string, unknown>;
  } catch (e) {
    throw new MalformedTokenError(`access token payload did not decode as JSON: ${String((e as Error).message)}`);
  }

  const sub = raw['sub'];
  const sessionId = raw['session_id'];
  const exp = raw['exp'];
  const iat = raw['iat'];
  // NAME THE EXACT MISSING CLAIM. "invalid token" sends the reader to the wrong
  // layer; `session_id` missing means the GoTrue build changed, and that is a
  // different investigation from a truncated token.
  if (typeof sub !== 'string' || sub.length === 0) throw new MalformedTokenError('access token carries no sub claim');
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new MalformedTokenError('access token carries no session_id claim -- the audit correlation id would be absent');
  }
  if (typeof exp !== 'number') throw new MalformedTokenError('access token carries no numeric exp claim');
  if (typeof iat !== 'number') throw new MalformedTokenError('access token carries no numeric iat claim');

  const email = raw['email'];
  return {
    sub,
    sessionId,
    exp,
    iat,
    role: typeof raw['role'] === 'string' ? (raw['role'] as string) : 'unknown',
    email: typeof email === 'string' ? email : null,
  };
}

/** Seconds until the session's own expiry, by the supplied clock. Negative once past. */
export function secondsUntilExpiry(session: Session, nowMs: number): number {
  return session.expiresAt - Math.floor(nowMs / 1000);
}

/**
 * True when the session is past `expiresAt`, or close enough that a request
 * sent now would plausibly arrive after it.
 *
 * `skewSeconds` is not a fudge factor for a bad clock -- see the header. It is
 * the flight time of the request being authorised: a token with four seconds
 * left is expired for any practical purpose.
 */
export function expired(session: Session, nowMs: number, skewSeconds = 0): boolean {
  return secondsUntilExpiry(session, nowMs) <= skewSeconds;
}

/**
 * Builds a Session from a GoTrue token response.
 *
 * SHAPE PROBED, NOT ASSUMED, on GoTrue v2.196.0 (Supabase CLI 2.117.0),
 * 2026-09-11: POST /auth/v1/verify and POST /auth/v1/token?grant_type=refresh_token
 * BOTH return `access_token, refresh_token, expires_in, expires_at, token_type,
 * user`. The same discipline that found `hashed_token` minted and `token_hash`
 * consumed -- two names for one value across two calls -- applies here.
 */
export function sessionFromTokens(body: unknown): Session {
  if (typeof body !== 'object' || body === null) {
    throw new MalformedTokenError('token response was not an object, so no session could be read from it');
  }
  const b = body as Record<string, unknown>;
  const accessToken = b['access_token'];
  const refreshToken = b['refresh_token'];
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    throw new MalformedTokenError(
      `token response carried no session. Keys present: ${Object.keys(b).sort().join(', ') || '(none)'}`,
    );
  }
  const claims = claimsOf(accessToken);
  // `expires_at` is the server's own absolute answer and is preferred. `exp`
  // from the token is the same number by construction; falling back to it means
  // one fewer thing to go wrong if GoTrue ever stops sending the field.
  const expiresAt = typeof b['expires_at'] === 'number' ? (b['expires_at'] as number) : claims.exp;
  return { accessToken, refreshToken, expiresAt, claims };
}

/**
 * Reads a session out of the URL fragment GoTrue redirects back with.
 *
 * THE FRAGMENT, NOT THE QUERY, and that is a security property rather than a
 * convention: a fragment is never sent to a server, so the tokens do not appear
 * in the access logs of whatever is hosting the console.
 *
 * Returns null when there is no session in the fragment -- an ordinary page
 * load. THROWS when GoTrue put an ERROR there, because an error silently read
 * as "no session" is a user staring at a sign-in screen that will never say why.
 */
export function sessionFromUrlFragment(fragment: string): Session | null {
  const hash = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (hash.length === 0) return null;
  const params = new URLSearchParams(hash);

  const error = params.get('error') ?? params.get('error_code');
  if (error !== null) {
    const description = params.get('error_description') ?? '(no description given)';
    throw new MalformedTokenError(`the sign-in link was refused by the auth server: ${error} -- ${description}`);
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken === null && refreshToken === null) return null;
  if (accessToken === null || refreshToken === null) {
    throw new MalformedTokenError('the sign-in link carried only half a session, so it cannot be used');
  }

  const expiresAtRaw = params.get('expires_at');
  return sessionFromTokens({
    access_token: accessToken,
    refresh_token: refreshToken,
    ...(expiresAtRaw === null ? {} : { expires_at: Number(expiresAtRaw) }),
  });
}
