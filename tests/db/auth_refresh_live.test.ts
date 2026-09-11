import { afterAll, describe, expect, test } from 'vitest';
import { SessionHolder, SessionExpiredError, claimsOf, type Session } from '@openbed/auth';
import { signInWard } from '../setup/auth.js';
import { apiUrl, anonKey } from '../setup/local-keys.js';
import { sql } from '../setup/db.js';

/**
 * THE REFRESH ROUND TRIP, AGAINST THE RUNNING GoTrue.
 *
 * WHY THIS FILE EXISTS SEPARATELY. tests/compliance/auth_session.test.ts proves
 * the state machine against CONSTRUCTED responses -- fast, no stack, and it can
 * plant failures a real server will not produce on demand. It cannot establish
 * that GoTrue answers the way the module assumes. This file does only that, and
 * only the parts the module actually depends on:
 *
 *   1. POST /auth/v1/token?grant_type=refresh_token returns a session, and the
 *      refresh token is ROTATED (`enable_refresh_token_rotation = true`).
 *   2. An invalid refresh token is refused with HTTP 400 and
 *      "Refresh token is not valid" -- NOT the 401 one would guess. The module
 *      names that exact signal rather than testing for "not 200", because "not
 *      200" is satisfied by a network error, by a proxy page, and by a probe
 *      whose own precondition is missing.
 *   3. The server is the authority on expiry: a token it refuses with 401 ends
 *      the session regardless of what the device clock believed.
 *
 * LOUD FAILURE, NOT SKIP (test-conventions section 6). If GoTrue is unreachable
 * these tests FAIL. A suite that quietly declines to run reports the same green
 * as one that ran, and this is the only evidence the console's auth path works.
 *
 * ONE MINT FOR THE WHOLE FILE. [auth.rate_limit] sign_in_sign_ups = 30 per five
 * minutes PER IP, and a CI runner is one IP.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - That reuse of a rotated refresh token OUTSIDE the reuse window is
 *     refused. `refresh_token_reuse_interval = 10` makes an immediate reuse
 *     legitimately succeed, so proving the refusal needs a ten-second wait in
 *     the suite. It is a VENDOR property rather than this module's behaviour,
 *     and the module's own response to a refusal is planted in the compliance
 *     file.
 *   - That the hosted GoTrue behaves as the local one does. Local GoTrue is
 *     pinned by the Supabase CLI; hosted auth is upgraded by Supabase
 *     out-of-band and is not that version. That asymmetry is a runbook step.
 */

const EMAIL = `refresh-probe-${Date.now()}@ward.invalid`;

/**
 * ONE MINT, SHARED. Not a convenience: see the rate-limit note in the header.
 * A promise rather than a value so concurrent tests await the same mint instead
 * of racing into two.
 *
 * Safe to share even though the first test ROTATES the refresh token, because
 * nothing after it refreshes with the original: the later tests use a
 * deliberately invalid token, a direct fetch, or a session that is not near
 * expiry at all.
 */
let minted: Promise<Session> | null = null;
function ward(): Promise<Session> {
  minted ??= signInWard(EMAIL);
  return minted;
}

afterAll(async () => {
  // The probe address is not part of any corpus. Leaving it behind would make
  // auth.users grow by one row per run and quietly change what a later test
  // measuring "an address GoTrue has never seen" is measuring.
  await sql()`delete from auth.users where email = ${EMAIL}`;
});

/** A real session whose expiry is backdated, so the holder must refresh for real. */
function staleCopy(session: Session): Session {
  return { ...session, expiresAt: Math.floor(Date.now() / 1000) - 10 };
}

function realHolder(session: Session): SessionHolder {
  // NO `refresh` OVERRIDE. The whole point of this file is the real transport.
  return new SessionHolder({ apiUrl: apiUrl(), anonKey: anonKey(), session });
}

describe('refresh against live GoTrue', () => {
  test('a real refresh returns a new access token and ROTATES the refresh token', async () => {
    const session = await ward();
    const holder = realHolder(staleCopy(session));

    const renewed = await holder.accessToken();
    expect(renewed, 'the refresh returned the same access token').not.toBe(session.accessToken);

    const after = holder.session;
    expect(after, 'the holder dropped the session after a successful refresh').not.toBeNull();
    expect(after?.refreshToken, 'the refresh token was not rotated — enable_refresh_token_rotation is off').not.toBe(
      session.refreshToken,
    );

    // The renewed token is the same account and the same auth session.
    const before = claimsOf(session.accessToken);
    const now = claimsOf(renewed);
    expect(now.sub, 'a refresh changed which account is signed in').toBe(before.sub);
    expect(now.sessionId, 'a refresh changed the audit correlation id mid-session').toBe(before.sessionId);
    expect(now.exp, 'the renewed token expires no later than the one it replaced').toBeGreaterThan(before.exp - 1);

    expect(holder.localClockUntrusted, 'a correct clock was recorded as untrusted').toBe(false);
  });

  test('an INVALID refresh token is refused, and the holder signs out rather than retrying', async () => {
    const session = await ward();
    const holder = realHolder({ ...staleCopy(session), refreshToken: 'not-a-real-refresh-token' });

    await expect(holder.accessToken()).rejects.toThrow(SessionExpiredError);
    await expect(holder.accessToken()).rejects.toThrow('tap the link again');
    expect(holder.signedOut, 'a refused refresh left a dead session in place').toBe(true);
  });

  test('the refusal signal is HTTP 400 with "Refresh token is not valid" — the exact signal, not a negation', async () => {
    // Asserted directly against GoTrue rather than through the module, because
    // this is the FACT the module is written against. If Supabase changes it,
    // this reddens here with the new answer in the message, instead of the
    // module silently classifying a new code as a transport failure and
    // retrying it three times.
    const res = await fetch(`${apiUrl()}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: anonKey(), Authorization: `Bearer ${anonKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'not-a-real-refresh-token' }),
    });
    const body = await res.text();
    expect(res.status, `GoTrue's refusal code changed. Body: ${body}`).toBe(400);
    expect(body, `GoTrue's refusal message changed: ${body}`).toContain('Refresh token is not valid');
  });

  test('authedFetch reaches PostgREST with a real session', async () => {
    const session = await ward();
    const holder = realHolder(session);
    const res = await holder.authedFetch('ward_public?select=facility_id&limit=1');
    expect(res.status, `an authenticated read of the public mirror failed: ${await res.text()}`).toBe(200);
  });

  test('a 401 from the server ends the session whatever the device clock believed', async () => {
    // THE BACKSTOP. The local expiry check is an optimisation; the server is the
    // authority. A tampered token is not expired by any clock, and must still
    // end the session rather than hand back a Response the caller reads as
    // success.
    const session = await ward();
    const tampered: Session = { ...session, accessToken: `${session.accessToken}tamper` };
    const holder = realHolder(tampered);

    await expect(holder.authedFetch('ward_public?select=facility_id&limit=1')).rejects.toThrow(
      'the server refused the session with 401',
    );
    expect(holder.signedOut, 'a 401 left the session in place').toBe(true);
  });
});
