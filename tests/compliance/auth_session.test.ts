import { describe, expect, test, vi } from 'vitest';
import {
  MalformedTokenError,
  RenewalUnavailableError,
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

  test("the Worker's own `limited` 429 on refresh KEEPS the session, is sent exactly once, and never signs out (R-2026-10-02-FF FF-2; replaces the 2026-10-01 pin that read it as SessionExpiredError)", async () => {
    // STANDARD O PAIRING. Removed: `rejects.toThrow(SessionExpiredError)` and `expect(h.signedOut).toBe(true)`
    // (the W3 pin of R-2026-09-30-177 FA-3 g, which said W4 would decide whether a limited refresh keeps the
    // session). Replaced by stronger assertions in the opposite direction: RenewalUnavailableError once the
    // token is inside 30 s, signedOut FALSE, the refresh sent EXACTLY once (the old count, kept), and the OLD
    // token returned while it still has more than 30 s. A hospital reaches the Worker's limit only when more
    // than the LIMIT_REFRESH figure (wrangler.json) of its handsets behind one address refresh in one 10-second
    // window; Supabase's own 429 is the same case (see the table test below).
    const answered = vi.fn(async () => new Response('{"message":"rate limited by the OpenBed proxy"}', { status: 429, headers: { 'x-openbed-proxy': 'limited', 'retry-after': '60' } }));
    vi.stubGlobal('fetch', answered);
    try {
      const h = new SessionHolder({ apiUrl: 'https://api.openbed.ng', anonKey: 'not-a-key', session: expiringSession(), sleep: async () => {} });
      await expect(h.accessToken()).rejects.toBeInstanceOf(RenewalUnavailableError);
      expect(answered, 'a limited refresh was retried, or never sent').toHaveBeenCalledTimes(1);
      expect(h.signedOut, 'a limited refresh signed the ward out').toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('a TRANSPORT failure is retried, bounded, and then KEEPS the session (R-2026-10-02-FF FF-2; replaces the same-state-as-expiry reading)', async () => {
    // STANDARD O PAIRING. Removed: `rejects.toThrow('could not reach the auth server')` and
    // `expect(h.signedOut).toBe(true)`. Replaced by RenewalUnavailableError, signedOut FALSE, and the exact
    // attempt count (three, kept): a dropped connection says "not now", not "no".
    let calls = 0;
    const h = holderWith(expiringSession(), async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    });
    await expect(h.accessToken()).rejects.toBeInstanceOf(RenewalUnavailableError);
    expect(calls, 'a transport failure was not retried, or was retried without bound').toBe(3);
    expect(h.signedOut, 'a transport failure signed the ward out').toBe(false);
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

/**
 * R-2026-10-02-FF FF-2: WHAT KEEPS A SESSION AND WHAT ENDS IT. One classification, read from the NUMBER on
 * the answer (the status, and whether the Worker marked it `refused`), never from message text.
 *   NOT NOW -> kept: 429 (whoever sent it), 409 (GoTrue's lock collision), any 5xx, an answer the Worker
 *     marked `refused`, and no answer at all.
 *   REFUSED -> signed out: any other 4xx, a 2xx that is not a session, a status-less MalformedTokenError.
 * The answers are CONSTRUCTED here; GoTrue's real refusal code is tests/db/auth_refresh_live.test.ts.
 */
describe('the classification — what keeps a session and what ends it (R-2026-10-02-FF FF-2)', () => {
  const sessionWithSeconds = (s: number): Session => sessionFromTokens(tokenResponse({ expSeconds: s }));

  function realTransport(answer: () => Response | Promise<Response>, clock: { t: number } = { t: Date.now() }, session = sessionWithSeconds(40)): { h: SessionHolder; sent: ReturnType<typeof vi.fn> } {
    const sent = vi.fn(async () => answer());
    const h = new SessionHolder({
      apiUrl: 'https://api.openbed.ng',
      anonKey: 'not-a-key',
      session,
      now: () => clock.t,
      fetch: sent as unknown as typeof fetch,
      sleep: async () => {},
    });
    return { h, sent };
  }

  const notNow: Array<[string, () => Response]> = [
    ["the Worker's `limited` 429", () => new Response('{}', { status: 429, headers: { 'x-openbed-proxy': 'limited' } })],
    ["Supabase's own 429 (no marker)", () => new Response('{"msg":"over_request_rate_limit"}', { status: 429 })],
    ["GoTrue's 409 on a concurrent refresh", () => new Response('{"msg":"Too many concurrent token refresh requests"}', { status: 409 })],
    ['a 502', () => new Response('bad gateway', { status: 502 })],
    ['a 503', () => new Response('unavailable', { status: 503 })],
    ["the Worker's `refused` 404, on a holder with no fallback origin (admin's shape)", () => new Response('{}', { status: 404, headers: { 'x-openbed-proxy': 'refused' } })],
  ];

  test.each(notNow)('plant — %s keeps the session: the old token while it has more than 30 s, RenewalUnavailableError inside 30 s, and no retry', async (_label, answer) => {
    const forty = realTransport(answer, { t: Date.now() }, sessionWithSeconds(40));
    const old = forty.h.session?.accessToken;
    await expect(forty.h.accessToken(), 'with 40 s left the OLD token should have been returned').resolves.toBe(old);
    expect(forty.h.signedOut, 'a "not now" answer signed the ward out').toBe(false);
    expect(forty.sent, 'a "not now" answer was retried').toHaveBeenCalledTimes(1);

    const twenty = realTransport(answer, { t: Date.now() }, sessionWithSeconds(20));
    await expect(twenty.h.accessToken(), 'with 20 s left there is no usable token to return').rejects.toBeInstanceOf(RenewalUnavailableError);
    expect(twenty.h.signedOut, 'a "not now" answer signed the ward out').toBe(false);
    expect(twenty.sent, 'a "not now" answer was retried').toHaveBeenCalledTimes(1);
  });

  test('plant — three rejecting attempts keep the session: RenewalUnavailableError after exactly three attempts', async () => {
    const { h, sent } = realTransport(() => {
      throw new TypeError('fetch failed');
    }, { t: Date.now() }, sessionWithSeconds(20));
    await expect(h.accessToken()).rejects.toBeInstanceOf(RenewalUnavailableError);
    expect(sent).toHaveBeenCalledTimes(3);
    expect(h.signedOut).toBe(false);
  });

  const refusedAnswers: Array<[string, () => Response]> = [
    ['a 400 validation_failed (as probed 2026-09-11)', () => new Response('{"error_code":"validation_failed","msg":"Refresh token is not valid"}', { status: 400 })],
    ['a 400 refresh_token_already_used', () => new Response('{"error_code":"refresh_token_already_used"}', { status: 400 })],
    ['a 401', () => new Response('{}', { status: 401 })],
    ['a 403', () => new Response('{}', { status: 403 })],
    ['a 422', () => new Response('{}', { status: 422 })],
  ];

  test.each(refusedAnswers)('plant — %s signs out, throws SessionExpiredError, and is not retried', async (_label, answer) => {
    const { h, sent } = realTransport(answer, { t: Date.now() }, sessionWithSeconds(40));
    await expect(h.accessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(h.signedOut, 'a refusal left the session in place').toBe(true);
    expect(sent, 'a refusal was retried').toHaveBeenCalledTimes(1);
  });

  test('plant — a 200 whose body is not a session signs out', async () => {
    const { h } = realTransport(() => new Response('{"hello":"world"}', { status: 200 }), { t: Date.now() }, sessionWithSeconds(40));
    await expect(h.accessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(h.signedOut).toBe(true);
  });

  test('plant — a MalformedTokenError that carries no status signs out', async () => {
    const h = holderWith(expiringSession(), async () => {
      throw new MalformedTokenError('no status travels with this one');
    });
    await expect(h.accessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(h.signedOut).toBe(true);
  });

  test('plant — after a 429 no refresh is sent at +59 s, and one is sent at +61 s', async () => {
    const clock = { t: Date.now() };
    const answers: Array<() => Response> = [
      () => new Response('{}', { status: 429, headers: { 'x-openbed-proxy': 'limited' } }),
      () => new Response(JSON.stringify(tokenResponse({ expSeconds: HOUR })), { status: 200 }),
    ];
    let i = 0;
    const { h, sent } = realTransport(() => (answers[i++] ?? answers[1]!)(), clock, sessionWithSeconds(40));
    await h.accessToken();
    expect(sent).toHaveBeenCalledTimes(1);
    clock.t += 59_000;
    await expect(h.accessToken(), 'the old token is spent by now, and nothing may be sent').rejects.toBeInstanceOf(RenewalUnavailableError);
    expect(sent, 'a refresh was sent inside the 60 s cooldown after a 429').toHaveBeenCalledTimes(1);
    clock.t += 2_000;
    await expect(h.accessToken()).resolves.toBeTypeOf('string');
    expect(sent, 'no refresh was sent once the cooldown had ended').toHaveBeenCalledTimes(2);
  });

  test('plant — a clock set back ends the cooldown, it never extends it', async () => {
    const clock = { t: Date.now() };
    const { h, sent } = realTransport(() => new Response('{}', { status: 429 }), clock, sessionWithSeconds(40));
    await h.accessToken();
    clock.t -= 10_000;
    await h.accessToken().catch(() => undefined);
    expect(sent, 'a clock moved backwards left the cooldown in force').toHaveBeenCalledTimes(2);
  });

  test('plant — a 503 sets NO cooldown: the next call sends', async () => {
    const { h, sent } = realTransport(() => new Response('unavailable', { status: 503 }), { t: Date.now() }, sessionWithSeconds(40));
    await h.accessToken();
    await h.accessToken();
    expect(sent, 'a 503 started a cooldown that only a 429 may start').toHaveBeenCalledTimes(2);
  });

  test('plant — five concurrent accessToken() calls during a 429 make ONE refresh and all five get the same outcome', async () => {
    const { h, sent } = realTransport(() => new Response('{}', { status: 429, headers: { 'x-openbed-proxy': 'limited' } }), { t: Date.now() }, sessionWithSeconds(20));
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => h.accessToken()));
    expect(sent, 'concurrent callers started more than one refresh').toHaveBeenCalledTimes(1);
    expect(outcomes.map((o) => o.status), 'the five callers did not share one outcome').toEqual(Array(5).fill('rejected'));
    for (const o of outcomes) expect((o as PromiseRejectedResult).reason).toBeInstanceOf(RenewalUnavailableError);
    expect(h.signedOut).toBe(false);
  });

  test('plant — while the device clock is untrusted nothing here changes: the holder never refreshes early', async () => {
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
    expect(calls).toBe(1);
    expect(h.localClockUntrusted).toBe(true);
  });
});
