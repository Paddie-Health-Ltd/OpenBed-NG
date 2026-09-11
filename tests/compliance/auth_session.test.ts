import { describe, expect, test } from 'vitest';
import {
  MalformedTokenError,
  SessionHolder,
  SessionExpiredError,
  claimsOf,
  expired,
  secondsUntilExpiry,
  sessionFromTokens,
  sessionFromUrlFragment,
  type Session,
} from '@openbed/auth';

/**
 * THE SESSION MODULE'S STATE MACHINE, with no network and no database.
 *
 * WHAT IS BEING GUARDED. @supabase/supabase-js was dropped from the ward
 * console because it would have made TWO derivation sites for how this system
 * authenticates: one `tests/setup/auth.ts` proves and a different one the app
 * ships. Replacing it means this repository now owns a refresh state machine,
 * and the leg that goes missing in a hand-rolled one is always the same leg --
 * THE FAILURE PATH. A refresh that succeeds is easy to write and easy to test;
 * a refresh that is REFUSED is what decides whether a nurse sees "tap the link
 * again" or a bed count that silently did not save.
 *
 * THE INVARIANT EVERY LEG BELOW IS ABOUT: an unusable session BLOCKS a write.
 * It never lets one appear to succeed, and it never becomes a retry loop.
 *
 * NOT ASSERTED HERE, deliberately: that GoTrue behaves as described. Every
 * response in this file is CONSTRUCTED. The live round trip -- rotation, and
 * the exact refusal code for an invalid refresh token -- is
 * tests/db/auth_refresh_live.test.ts, against the running stack. Two files
 * because they need different things, which is the split
 * .claude/rules/test-conventions.md section 1 draws.
 */

const HOUR = 3600;

/** A JWT assembled at runtime. No literal three-segment token exists in this repository. */
function token(claims: Record<string, unknown>): string {
  const seg = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  return [seg({ alg: 'HS256', typ: 'JWT' }), seg(claims), 'c2lnbmF0dXJlLXBsYWNlaG9sZGVy'].join('.');
}

function tokenResponse(opts: { expSeconds: number; sub?: string; sessionId?: string }): Record<string, unknown> {
  const iat = Math.floor(Date.now() / 1000);
  return {
    access_token: token({
      sub: opts.sub ?? 'ward-account-uuid',
      session_id: opts.sessionId ?? 'session-uuid',
      exp: iat + opts.expSeconds,
      iat,
      role: 'authenticated',
      email: 'maternity@ward.invalid',
    }),
    refresh_token: `refresh-${opts.expSeconds}`,
    expires_in: opts.expSeconds,
    expires_at: iat + opts.expSeconds,
    token_type: 'bearer',
  };
}

const freshSession = (): Session => sessionFromTokens(tokenResponse({ expSeconds: HOUR }));
const expiringSession = (): Session => sessionFromTokens(tokenResponse({ expSeconds: 5 }));

function holderWith(session: Session, refresh: (t: string) => Promise<unknown>): SessionHolder {
  return new SessionHolder({
    apiUrl: 'http://127.0.0.1:54321',
    anonKey: 'not-a-key',
    session,
    refresh,
    // No real backoff: the jitter is asserted by the call count, not by wall time.
    sleep: async () => {},
  });
}

describe('reading a session', () => {
  test('real GoTrue response shape is accepted and carries sub and session_id', () => {
    const s = sessionFromTokens(tokenResponse({ expSeconds: HOUR }));
    expect(s.claims.sub).toBe('ward-account-uuid');
    // CTO condition 2 of the ward-identity decision: the session id must not be
    // derivable back to a mailbox, which starts with it not BEING the user id.
    expect(s.claims.sessionId, 'session_id equals sub — the correlation id would identify the account').not.toBe(
      s.claims.sub,
    );
    expect(s.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test.each([
    ['a response with no session at all', {}],
    ['a response carrying only an access token', { access_token: token({ sub: 'x', session_id: 'y', exp: 1, iat: 0 }) }],
    ['a response that is not an object', 'a string'],
  ])('plant — %s is refused', (_name, body) => {
    expect(() => sessionFromTokens(body)).toThrow(MalformedTokenError);
  });

  test('plant — a token with no session_id names THAT claim, not "invalid token"', () => {
    // Naming the exact missing claim is the difference between an afternoon on
    // the wrong layer and a one-line diagnosis: session_id absent means the
    // GoTrue build changed, which is not the same investigation as a truncated
    // token.
    const bad = { access_token: token({ sub: 'x', exp: 1, iat: 0 }), refresh_token: 'r' };
    expect(() => sessionFromTokens(bad)).toThrow('carries no session_id claim');
  });

  test('plant — a two-segment token is refused as not a JWT', () => {
    expect(() => claimsOf('header.payload')).toThrow('not a three-segment JWT');
  });
});

describe('the sign-in link fragment', () => {
  test('an ordinary redirect fragment yields a session', () => {
    const r = tokenResponse({ expSeconds: HOUR });
    const frag = `#access_token=${r['access_token'] as string}&refresh_token=r1&expires_at=${r['expires_at'] as number}&token_type=bearer`;
    const s = sessionFromUrlFragment(frag);
    expect(s, 'an ordinary sign-in redirect produced no session').not.toBeNull();
    expect(s?.refreshToken).toBe('r1');
  });

  test('positive control — an ordinary page load with no fragment is not an error', () => {
    // test-conventions section 2, the fourth way a leg goes wrong. Opening the
    // console directly is the most ordinary thing a nurse does, and a parser
    // that threw on it would be removed within a day.
    expect(sessionFromUrlFragment('')).toBeNull();
    expect(sessionFromUrlFragment('#')).toBeNull();
  });

  test('plant — an error in the fragment THROWS rather than reading as "not signed in"', () => {
    // The whole point. Read as "no session", the user gets a sign-in screen that
    // will never tell them the link had already been used.
    expect(() => sessionFromUrlFragment('#error=access_denied&error_description=Email+link+is+invalid')).toThrow(
      'the sign-in link was refused by the auth server',
    );
  });

  test('plant — half a session is refused rather than half-used', () => {
    expect(() => sessionFromUrlFragment('#access_token=a.b.c')).toThrow('only half a session');
  });
});

describe('expiry is a decision about flight time, not a fudge factor', () => {
  test('a fresh session is not expired; one inside the skew window is', () => {
    const now = Date.now();
    expect(expired(freshSession(), now, 60)).toBe(false);
    expect(expired(expiringSession(), now, 60), 'a token with 5 seconds left was treated as usable').toBe(true);
  });

  test('secondsUntilExpiry goes negative past the deadline', () => {
    const s = freshSession();
    expect(secondsUntilExpiry(s, Date.now())).toBeGreaterThan(HOUR - 60);
    expect(secondsUntilExpiry(s, Date.now() + 2 * HOUR * 1000)).toBeLessThan(0);
  });
});

describe('the holder — an unusable session blocks the write', () => {
  test('a fresh session needs no refresh at all', async () => {
    let calls = 0;
    const h = holderWith(freshSession(), async () => {
      calls += 1;
      return tokenResponse({ expSeconds: HOUR });
    });
    await h.accessToken();
    expect(calls, 'a valid token was refreshed anyway — that is a rate limit waiting to happen').toBe(0);
  });

  test('an expiring session is refreshed once, and the new token is used', async () => {
    const h = holderWith(expiringSession(), async () => tokenResponse({ expSeconds: HOUR }));
    const before = h.session?.accessToken;
    const after = await h.accessToken();
    expect(after, 'the holder handed back the old token after refreshing').not.toBe(before);
    expect(h.signedOut).toBe(false);
  });

  test('SINGLE FLIGHT — ten concurrent callers produce one refresh', async () => {
    let calls = 0;
    const h = holderWith(expiringSession(), async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      return tokenResponse({ expSeconds: HOUR });
    });
    const tokens = await Promise.all(Array.from({ length: 10 }, () => h.accessToken()));
    expect(calls, 'a burst of calls started a stampede of refreshes').toBe(1);
    expect(new Set(tokens).size, 'concurrent callers got different tokens').toBe(1);
  });

  test('plant — a REFUSED refresh signs out and throws; it never retries', async () => {
    let calls = 0;
    const h = holderWith(expiringSession(), async () => {
      calls += 1;
      throw new MalformedTokenError('the auth server refused the refresh with HTTP 400: Refresh token is not valid');
    });
    await expect(h.accessToken()).rejects.toThrow(SessionExpiredError);
    expect(calls, 'a refusal was retried — a dead session became a spinner').toBe(1);
    expect(h.signedOut, 'a refused refresh left the session in place').toBe(true);
  });

  test('plant — a refused refresh lands in the SAME state as expiry', async () => {
    // One terminal state, one message. Two would mean the UI has to decide
    // which one the user sees, and it will get that wrong at 4am.
    const h = holderWith(expiringSession(), async () => {
      throw new MalformedTokenError('refused');
    });
    await expect(h.accessToken()).rejects.toThrow('tap the link again');
    await expect(h.accessToken()).rejects.toThrow('there is no session -- tap the link again');
  });

  test('a TRANSPORT failure is retried, bounded, and then gives up in the same state', async () => {
    let calls = 0;
    const h = holderWith(expiringSession(), async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    });
    await expect(h.accessToken()).rejects.toThrow('could not reach the auth server');
    expect(calls, 'a transport failure was not retried, or was retried without bound').toBe(3);
    expect(h.signedOut).toBe(true);
  });

  test('a transport failure that recovers does NOT sign the ward out', async () => {
    // The other direction, and the one that matters on a Nigerian mobile
    // network: one dropped request must not end the shift.
    let calls = 0;
    const h = holderWith(expiringSession(), async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return tokenResponse({ expSeconds: HOUR });
    });
    await expect(h.accessToken()).resolves.toBeTypeOf('string');
    expect(h.signedOut, 'a recoverable blip signed the ward out').toBe(false);
  });

  test('plant — a WRONG DEVICE CLOCK does not become a refresh loop', async () => {
    // Finding F3's shape at the one place the auth path reads a wall clock. A
    // handset three hours fast thinks every freshly minted token is already
    // expiring; pre-emptive refreshing would then run at
    // `token_refresh = 150 per 5 minutes per IP` until the ward is locked out.
    // After one refresh that changes nothing, the local check is abandoned and
    // the server's 401 becomes the only expiry signal — which is the authority
    // in any case.
    let calls = 0;
    const h = new SessionHolder({
      apiUrl: 'http://127.0.0.1:54321',
      anonKey: 'not-a-key',
      session: expiringSession(),
      now: () => Date.now() + 3 * HOUR * 1000,
      refresh: async () => {
        calls += 1;
        return tokenResponse({ expSeconds: HOUR });
      },
      sleep: async () => {},
    });
    await h.accessToken();
    await h.accessToken();
    await h.accessToken();
    expect(calls, 'a fast device clock drove one refresh per call').toBe(1);
    expect(h.localClockUntrusted, 'the clock disagreement was not recorded where a reviewer can see it').toBe(true);
  });

  test('signOut is idempotent and leaves no session behind', () => {
    const h = holderWith(freshSession(), async () => tokenResponse({ expSeconds: HOUR }));
    h.signOut();
    h.signOut();
    expect(h.session).toBeNull();
    expect(h.signedOut).toBe(true);
  });
});
