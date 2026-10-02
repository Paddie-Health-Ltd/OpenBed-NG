import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  MalformedTokenError,
  OriginsUnreachableError,
  PROXY_HEADER,
  RenewalUnavailableError,
  SessionHolder,
  fetchWithFallback,
  sessionFromTokens,
  type Session,
} from '@openbed/auth';
import {
  CALL_WORST_CASE_MS,
  MAX_SENDS_PER_CALL,
  SEND_TIMEOUT_MS,
} from '../../packages/auth/src/fallback.js';
import {
  COMPOSED_AT_AGE_BOUND_MS,
  REFRESH_ATTEMPTS,
  REFRESH_BACKOFF_MAX_MS,
  REFRESH_WORST_CASE_MS,
  STICKY_WINDOW_MS,
} from '../../packages/auth/src/holder.js';
import { SIGNIN_ATTEMPTS, SIGNIN_WORST_CASE_MS } from '../../packages/auth/src/request.js';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE TWO-ORIGIN FALLBACK (R-2026-10-02-FF FF-1, -182), with no network and no database.
 *
 * WHAT IS BEING GUARDED. The ward console's calls go to api.openbed.ng, the Worker. When the Worker
 * is gone, a handset must reach the Supabase origin directly instead, or a city-wide blip at shift
 * change leaves every ward unable to publish. The fallback is a mechanism that is correct on the day
 * it is written and silently stops reaching if any of its rules rot, so each rule below is a PLANT:
 * a constructed false-green the guard has to reject.
 *
 * THE RULES, each with its leg:
 *   - a rejecting first origin is re-sent ONCE to the second, byte for byte;
 *   - the Worker's own `refused` answer is re-sent too (Supabase was never contacted);
 *   - no origin answering is an OriginsUnreachableError, never a 404 handed back as an answer;
 *   - `limited` and every FORWARDED answer is the server's answer and is never re-sent;
 *   - one origin, or two equal origins, is one send and a rejection propagates raw;
 *   - each send has its OWN timeout signal (a shared one is already aborted for the second send);
 *   - a stream body is refused before anything is sent;
 *   - a caller's own aborted signal sends nothing more;
 *   - STICKY for five minutes, ended by a clock set back;
 *   - the refresh rides the same mechanism;
 *   - the bounds the header states are read from the constants and held under 026's STALE_MUTATION.
 *
 * NOT ASSERTED HERE, deliberately: that a REAL browser's fetch rejects (and the page reads nothing)
 * when Cloudflare's own error page, which carries no CORS header, answers. That is the Fetch
 * standard's CORS rule, DOCUMENTED, and CI has no browser runner (the -70 C3 TRIGGER row); what is
 * asserted is the code's reaction to a rejection however it arose.
 * NOT ASSERTED HERE, deliberately: the Worker serving a real request and a socket dying mid-answer.
 * That needs node:http and the local stack, so it is tests/db/ward_console_fallback_acceptance.test.ts.
 *
 * GUARD CLASS: LIVE. The code it guards exists in this change.
 */

const HOUR = 3600;
const WORKER = 'https://worker.invalid';
const DIRECT = 'https://direct.invalid';

function token(claims: Record<string, unknown>): string {
  const seg = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
  return [seg({ alg: 'HS256', typ: 'JWT' }), seg(claims), 'c2lnbmF0dXJlLXBsYWNlaG9sZGVy'].join('.');
}

function tokenResponse(expSeconds: number, tag = 'a'): Record<string, unknown> {
  const iat = Math.floor(Date.now() / 1000);
  return {
    access_token: token({ sub: 'ward-account-uuid', session_id: `session-${tag}`, exp: iat + expSeconds, iat, role: 'authenticated', email: 'maternity@ward.invalid' }),
    refresh_token: `refresh-${tag}-${expSeconds}`,
    expires_in: expSeconds,
    expires_at: iat + expSeconds,
    token_type: 'bearer',
  };
}

const sessionExpiringIn = (s: number, tag = 'a'): Session => sessionFromTokens(tokenResponse(s, tag));

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

/** A scripted fetch that records every send. A script entry is a Response, or an Error to reject with. */
function scripted(script: Array<Response | Error | ((c: Call) => Promise<Response>)>): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];
  let i = 0;
  const impl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    if (step === undefined) throw new Error('scripted fetch has no steps');
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step(call);
    return step.clone();
  };
  return { calls, fetch: impl as typeof fetch };
}

const down = (): Error => new TypeError('fetch failed');
const refused = (): Response => new Response('{"message":"not forwarded by the OpenBed proxy"}', { status: 404, headers: { [PROXY_HEADER]: 'refused' } });
const limited = (): Response => new Response('{"message":"rate limited"}', { status: 429, headers: { [PROXY_HEADER]: 'limited' } });
const ok = (): Response => new Response('{"ok":true}', { status: 200, headers: { [PROXY_HEADER]: 'forwarded' } });

const BOTH = { origins: [WORKER, DIRECT] } as const;

describe('fetchWithFallback — when it sends to the second origin', () => {
  test('plant — a rejecting first origin is re-sent once, with the same method, path, headers and body', async () => {
    const s = scripted([down(), ok()]);
    const init = { method: 'POST', headers: { apikey: 'k', 'Content-Type': 'application/json' }, body: '{"p":1}' };
    const res = await fetchWithFallback(`/rest/v1/rpc/x`, init, { ...BOTH, fetch: s.fetch });
    expect(res.status, 'the second origin answered and its answer was not returned').toBe(200);
    expect(s.calls.map((c) => c.url), 'not exactly one send per origin, in order').toEqual([`${WORKER}/rest/v1/rpc/x`, `${DIRECT}/rest/v1/rpc/x`]);
    const [first, second] = s.calls;
    expect(second?.init.method, 'the re-send changed the method').toBe(first?.init.method);
    expect(second?.init.headers, 'the re-send changed the headers').toEqual(first?.init.headers);
    expect(second?.init.body, 'the re-send changed the body, which must be byte for byte').toBe('{"p":1}');
  });

  test("plant — the Worker's own `refused` answer is re-sent once, and onPrimaryFailed fires", async () => {
    const s = scripted([refused(), ok()]);
    let failed = 0;
    const res = await fetchWithFallback(`/rest/v1/rpc/x`, { method: 'POST', body: '{}' }, { ...BOTH, fetch: s.fetch, onPrimaryFailed: () => { failed += 1; } });
    expect(res.status).toBe(200);
    expect(s.calls.length, 'a refused answer was not re-sent, or was re-sent more than once').toBe(2);
    expect(failed, 'onPrimaryFailed did not fire for a refused answer').toBe(1);
  });

  test('plant — a rejecting first origin fires onPrimaryFailed exactly once', async () => {
    const s = scripted([down(), ok()]);
    let failed = 0;
    await fetchWithFallback(`/rest/v1/rpc/x`, { method: 'POST', body: '{}' }, { ...BOTH, fetch: s.fetch, onPrimaryFailed: () => { failed += 1; } });
    expect(failed).toBe(1);
  });

  test('plant — `refused` and then a rejecting second origin is OriginsUnreachableError, never the 404 as an answer', async () => {
    const s = scripted([refused(), down()]);
    let caught: unknown = null;
    let returned: Response | null = null;
    try {
      returned = await fetchWithFallback(`/rest/v1/rpc/x`, { method: 'POST', body: '{}' }, { ...BOTH, fetch: s.fetch });
    } catch (e) {
      caught = e;
    }
    expect(returned, 'the Worker\'s refusal was handed back as if it were an answer').toBeNull();
    expect(caught).toBeInstanceOf(OriginsUnreachableError);
    expect((caught as OriginsUnreachableError).causes.length, 'each cause must be carried').toBe(2);
  });

  test('plant — both origins rejecting is OriginsUnreachableError carrying both causes', async () => {
    const s = scripted([down(), down()]);
    await expect(fetchWithFallback(`/rest/v1/rpc/x`, { method: 'POST', body: '{}' }, { ...BOTH, fetch: s.fetch })).rejects.toBeInstanceOf(OriginsUnreachableError);
    expect(s.calls.length, 'more than two sends in one call').toBe(MAX_SENDS_PER_CALL);
  });
});

describe('fetchWithFallback — answers the page can read are the server\'s answers', () => {
  test("plant — a first origin answering `limited` is returned, and the second origin is NEVER called", async () => {
    const s = scripted([limited(), ok()]);
    const res = await fetchWithFallback(`/rest/v1/rpc/x`, { method: 'POST', body: '{}' }, { ...BOTH, fetch: s.fetch });
    expect(res.status).toBe(429);
    expect(s.calls.length, 'a limited answer was re-sent: the limit is the answer').toBe(1);
  });

  test.each([401, 404, 409, 429, 500, 503])('plant — a forwarded %i with no marker is returned and never re-sent', async (status) => {
    const s = scripted([new Response('{}', { status }), ok()]);
    const res = await fetchWithFallback(`/rest/v1/rpc/x`, { method: 'POST', body: '{}' }, { ...BOTH, fetch: s.fetch });
    expect(res.status, `a forwarded ${status} was replaced by the second origin's answer`).toBe(status);
    expect(s.calls.length, `a forwarded ${status} was re-sent`).toBe(1);
  });
});

describe('fetchWithFallback — one origin is one send', () => {
  test('plant — no second origin: one send, and a rejection propagates raw, as one fetch does today', async () => {
    const s = scripted([down(), ok()]);
    const error = await fetchWithFallback(`/rest/v1/rpc/x`, { method: 'POST', body: '{}' }, { origins: [WORKER], fetch: s.fetch }).catch((e: unknown) => e);
    expect(error, 'a single origin must not wrap its rejection').toBeInstanceOf(TypeError);
    expect(s.calls.length).toBe(1);
  });

  test('plant — a second origin EQUAL to the first (with a trailing slash) is one send', async () => {
    const s = scripted([down(), ok()]);
    const error = await fetchWithFallback(`/rest/v1/rpc/x`, { method: 'POST', body: '{}' }, { origins: [WORKER, `${WORKER}/`], fetch: s.fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(s.calls.length, 'the same address was sent to twice').toBe(1);
  });

  test('plant — a single origin returns a `refused` answer as it is, because there is nowhere else to send it', async () => {
    const s = scripted([refused(), ok()]);
    const res = await fetchWithFallback(`/rest/v1/rpc/x`, { method: 'POST', body: '{}' }, { origins: [WORKER], fetch: s.fetch });
    expect(res.status).toBe(404);
    expect(res.headers.get(PROXY_HEADER)).toBe('refused');
    expect(s.calls.length).toBe(1);
  });

  test('real call with no body and an ordinary origin list is accepted', async () => {
    const s = scripted([ok()]);
    const res = await fetchWithFallback(`/auth/v1/settings`, { method: 'GET' }, { ...BOTH, fetch: s.fetch });
    expect(res.status).toBe(200);
    expect(s.calls.length).toBe(1);
  });
});

describe('fetchWithFallback — signals and bodies', () => {
  test("plant — each send gets its OWN timeout signal; the second is a different object and is not aborted when sent", async () => {
    // A first-origin stub that settles only when ITS signal aborts. Fake timers do not drive AbortSignal.timeout
    // (measured 2026-10-02), so this is real time with a 50 ms timeout.
    const signals: Array<AbortSignal | null | undefined> = [];
    const abortedAtSend: boolean[] = [];
    const s = scripted([
      (c) => new Promise<Response>((_, reject) => {
        signals.push(c.init.signal);
        abortedAtSend.push(c.init.signal?.aborted ?? false);
        c.init.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
      }),
      async (c) => {
        signals.push(c.init.signal);
        abortedAtSend.push(c.init.signal?.aborted ?? false);
        return ok();
      },
    ]);
    const res = await fetchWithFallback(`/rest/v1/rpc/x`, { method: 'POST', body: '{}' }, { ...BOTH, fetch: s.fetch, timeoutMs: 50 });
    expect(res.status, 'the second send did not complete after the first timed out').toBe(200);
    expect(signals.length).toBe(2);
    expect(signals[0], 'the first send carried no signal').toBeTruthy();
    expect(signals[1], 'the second send reused the first send\'s signal object').not.toBe(signals[0]);
    expect(abortedAtSend[1], 'the second send\'s signal was already aborted when it was sent').toBe(false);
  });

  test('plant — a stream body throws before any send', async () => {
    const s = scripted([ok()]);
    const body = new ReadableStream();
    await expect(fetchWithFallback(`/rest/v1/rpc/x`, { method: 'POST', body } as RequestInit, { ...BOTH, fetch: s.fetch })).rejects.toThrow(/string body/);
    expect(s.calls.length, 'something was sent before the body was refused').toBe(0);
  });

  test("plant — a caller's own aborted signal sends nothing more", async () => {
    const own = new AbortController();
    const s = scripted([
      async () => {
        own.abort();
        throw new DOMException('aborted by the caller', 'AbortError');
      },
      ok(),
    ]);
    const error = await fetchWithFallback(`/rest/v1/rpc/x`, { method: 'POST', body: '{}', signal: own.signal }, { ...BOTH, fetch: s.fetch }).catch((e: unknown) => e);
    expect(error, 'the caller\'s abort was turned into a fallback or a wrapped error').toBeInstanceOf(DOMException);
    expect(s.calls.length, 'a send happened after the caller aborted').toBe(1);
  });

  test("a caller's own signal REPLACES the timeout, as authedFetch's does", async () => {
    const own = new AbortController();
    const s = scripted([ok()]);
    await fetchWithFallback(`/rest/v1/rpc/x`, { method: 'POST', body: '{}', signal: own.signal }, { ...BOTH, fetch: s.fetch });
    expect(s.calls[0]?.init.signal).toBe(own.signal);
  });
});

describe('the holder — sticky for five minutes', () => {
  function holder(script: Parameters<typeof scripted>[0], clock: { t: number }, session = sessionExpiringIn(HOUR)): { h: SessionHolder; calls: Call[] } {
    const s = scripted(script);
    const h = new SessionHolder({
      apiUrl: WORKER,
      fallbackApiUrl: DIRECT,
      anonKey: 'not-a-key',
      session,
      now: () => clock.t,
      fetch: s.fetch,
      sleep: async () => {},
    });
    return { h, calls: s.calls };
  }
  const origin = (c: Call | undefined): string => (c === undefined ? '' : new URL(c.url).origin);

  test('plant — after a failure the next call goes to the direct origin FIRST; at +5 min the Worker goes first again', async () => {
    const clock = { t: Date.now() };
    const { h, calls } = holder([down(), ok(), ok(), ok()], clock);
    await h.authedFetch('rpc/a', { method: 'POST', body: '{}' });
    expect(calls.map(origin), 'the first call should try the Worker then the direct origin').toEqual([WORKER, DIRECT]);
    await h.authedFetch('rpc/b', { method: 'POST', body: '{}' });
    expect(origin(calls[2]), 'inside the window the direct origin must go first, so a hung Worker does not cost every action 12 s').toBe(DIRECT);
    clock.t += STICKY_WINDOW_MS + 1;
    await h.authedFetch('rpc/c', { method: 'POST', body: '{}' });
    expect(origin(calls[3]), 'after five minutes the Worker must go first again').toBe(WORKER);
  });

  test('plant — a clock set BACK ends the window, it never extends it', async () => {
    const clock = { t: Date.now() };
    const { h, calls } = holder([down(), ok(), ok()], clock);
    await h.authedFetch('rpc/a', { method: 'POST', body: '{}' });
    clock.t -= 60_000;
    await h.authedFetch('rpc/b', { method: 'POST', body: '{}' });
    expect(origin(calls[2]), 'a backwards clock left the window open').toBe(WORKER);
  });

  test('plant — a failure of the direct origin inside the window does not restart it', async () => {
    const clock = { t: Date.now() };
    // call 1: Worker down, direct ok (window opens at t0). call 2, at +4 min: direct down, Worker ok.
    // call 3, at +5 min + 1 s from t0: the window must have ended, because call 2 did not restart it.
    const { h, calls } = holder([down(), ok(), down(), ok(), ok()], clock);
    await h.authedFetch('rpc/a', { method: 'POST', body: '{}' });
    clock.t += 4 * 60_000;
    await h.authedFetch('rpc/b', { method: 'POST', body: '{}' });
    expect(calls.map(origin).slice(2, 4), 'inside the window: direct first, Worker as the fallback').toEqual([DIRECT, WORKER]);
    clock.t += 60_000 + 1000;
    await h.authedFetch('rpc/c', { method: 'POST', body: '{}' });
    expect(origin(calls[4]), 'the direct origin\'s failure restarted the window').toBe(WORKER);
  });

  test('plant — a `refused` answer starts the window too', async () => {
    const clock = { t: Date.now() };
    const { h, calls } = holder([refused(), ok(), ok()], clock);
    await h.authedFetch('rpc/a', { method: 'POST', body: '{}' });
    await h.authedFetch('rpc/b', { method: 'POST', body: '{}' });
    expect(origin(calls[2])).toBe(DIRECT);
  });

  test('real ordinary path — a healthy Worker is sent to once and the window never opens', async () => {
    const clock = { t: Date.now() };
    const { h, calls } = holder([ok(), ok()], clock);
    await h.authedFetch('rpc/a', { method: 'POST', body: '{}' });
    await h.authedFetch('rpc/b', { method: 'POST', body: '{}' });
    expect(calls.map(origin)).toEqual([WORKER, WORKER]);
  });
});

describe('the holder — the refresh rides the same mechanism', () => {
  test('plant — a rejecting Worker and a direct origin that answers a session give the new session, and the next authedFetch carries the new token', async () => {
    const fresh = tokenResponse(HOUR, 'renewed');
    const s = scripted([
      down(), // refresh, Worker
      new Response(JSON.stringify(fresh), { status: 200 }), // refresh, direct
      ok(), // the publish, to the origin the window now puts first
    ]);
    const h = new SessionHolder({ apiUrl: WORKER, fallbackApiUrl: DIRECT, anonKey: 'not-a-key', session: sessionExpiringIn(20), fetch: s.fetch, sleep: async () => {} });
    await h.authedFetch('rpc/a', { method: 'POST', body: '{}' });
    expect(h.signedOut, 'a refresh that fell back signed the ward out').toBe(false);
    expect(s.calls.slice(0, 2).map((c) => new URL(c.url).origin)).toEqual([WORKER, DIRECT]);
    expect(new URL(s.calls[0]?.url ?? '').pathname).toBe('/auth/v1/token');
    const sent = new Headers(s.calls[2]?.init.headers).get('Authorization');
    expect(sent, 'the send after the refresh did not carry the new token').toBe(`Bearer ${String(fresh['access_token'])}`);
  });

  test('plant — three attempts of the refresh pair, then the session is kept (RenewalUnavailableError)', async () => {
    const s = scripted([down()]);
    const h = new SessionHolder({ apiUrl: WORKER, fallbackApiUrl: DIRECT, anonKey: 'not-a-key', session: sessionExpiringIn(20), fetch: s.fetch, sleep: async () => {} });
    await expect(h.accessToken()).rejects.toBeInstanceOf(RenewalUnavailableError);
    expect(s.calls.length, 'REFRESH_ATTEMPTS attempts of a pair of sends').toBe(REFRESH_ATTEMPTS * MAX_SENDS_PER_CALL);
    expect(h.signedOut).toBe(false);
  });

  test('a MalformedTokenError is still the type the injected transport throws for an answer', () => {
    expect(new MalformedTokenError('x')).toBeInstanceOf(Error);
  });
});

describe('the bounds the header states, read from the constants', () => {
  test('one call is at most two sends of at most 12 s: 24 s', () => {
    expect(SEND_TIMEOUT_MS).toBe(12_000);
    expect(MAX_SENDS_PER_CALL).toBe(2);
    expect(CALL_WORST_CASE_MS).toBe(24_000);
  });

  test('a refresh is three attempts of that pair with the existing backoff: 73.25 s', () => {
    expect(REFRESH_ATTEMPTS).toBe(3);
    // Backoff before attempt 2 is at most 500 ms and before attempt 3 at most 750 ms (2**(n-1)*250 + 250 jitter).
    expect([REFRESH_BACKOFF_MAX_MS(1), REFRESH_BACKOFF_MAX_MS(2)]).toEqual([500, 750]);
    expect(REFRESH_WORST_CASE_MS).toBe(3 * 24_000 + 500 + 750);
    expect(REFRESH_WORST_CASE_MS).toBe(73_250);
  });

  test('a sign-in request is two attempts of a pair: 48 s', () => {
    expect(SIGNIN_ATTEMPTS).toBe(2);
    expect(SIGNIN_WORST_CASE_MS).toBe(48_000);
  });

  test("a publish tap's composed_at ages through a refresh and one call, and stays under 026's STALE_MUTATION window", () => {
    expect(COMPOSED_AT_AGE_BOUND_MS).toBe(REFRESH_WORST_CASE_MS + CALL_WORST_CASE_MS);
    const sql = readFileSync(join(REPO_ROOT, 'database', 'migrations', '026_facility_reporter_and_checks.sql'), 'utf8');
    const m = /now\(\) - p_composed_at > interval '(\d+) minutes?'/.exec(sql);
    expect(m, 'the STALE_MUTATION interval could not be read from migration 026, so the budget is unchecked').not.toBeNull();
    const windowMs = Number(m?.[1]) * 60_000;
    expect(COMPOSED_AT_AGE_BOUND_MS, 'a publish that falls back through a refresh would be refused as STALE_MUTATION').toBeLessThan(windowMs);
  });

  test('anti-vacuity — the migration read for the window is not empty', () => {
    const sql = readFileSync(join(REPO_ROOT, 'database', 'migrations', '026_facility_reporter_and_checks.sql'), 'utf8');
    expect(sql.length).toBeGreaterThan(1000);
  });
});
