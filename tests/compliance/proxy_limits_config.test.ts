import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';
import LIST from '../../supabase-proxy/allow-list.json';
import WRANGLER from '../../supabase-proxy/wrangler.json';
import WARD from '../../packages/labels/ward-labels.json';
import { LIMIT_BINDINGS, VERIFY_LIMITED_TEXT, type AllowList } from '../../supabase-proxy/handler.js';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE WORKER'S EDGE LIMITS ARE ONE SET OF NUMBERS IN ONE PLACE (R-2026-09-30-177 FA-3 b).
 *
 * The number Cloudflare enforces is the `simple.limit` of a binding in
 * supabase-proxy/wrangler.json. supabase-proxy/allow-list.json holds only the NAME of the
 * binding that counts an entry, and the handler holds no number at all, so there is no
 * second copy to drift. This file holds the two files together, and the handler's
 * `limited` answer and the way index.js and dev.js hand `env` to it.
 *
 * THE SIZING ARGUMENT (why 5, 5 and 10 per 10 seconds; restated by R-2026-09-30-178 FB-1 c
 * after FA's was found false). Read the code that builds the bucket, not only the setting
 * that tunes it:
 *   - THE KEY is the client address, so one hospital's NAT address is one key.
 *   - SUPABASE'S PER-IP BUCKETS BURST TO A FIXED 30. GoTrue builds its token and verify
 *     buckets with a hard-coded `SetBurst(30)` and its OTP bucket with a limiter whose burst
 *     is also 30 (supabase/auth, internal/api/apilimiter/apilimiter.go, read at ce9a8eee on
 *     2026-09-22). The dashboard's per-5-minute figure sets only the REFILL rate, so the
 *     burst cannot be raised, and every facility shares the 30 through the Worker's one
 *     address (the attribution read of 2026-09-30).
 *   - A CLOUDFLARE `simple` LIMIT COUNTS PER PERIOD and does not spread requests across it.
 *     At 60 seconds one address could send its whole limit in one second and empty the
 *     shared bucket, so a ward's refresh that landed while it was empty would get
 *     Supabase's own 429, which holder.ts turns into a sign-out. [RESTATED 2026-10-02, R-2026-10-02-FF
 *     FF-2 f: it no longer does. holder.ts keeps the session on a 429, and sends no refresh for 60 s; the
 *     sentence above is the text as written on 2026-09-30.] The period is therefore 10
 *     seconds, and the limit is chosen so ONE address's worst case stays under the burst:
 *     with a fixed window an address can get about twice its limit in any 10 seconds (a
 *     full window either side of a boundary), so 2 x limit must be under 30. At 5, 5 and 10
 *     that is 10, 10 and 20; sustained, 30, 30 and 60 a minute. Counting is permissive,
 *     eventually consistent and per Cloudflare location, so 2 x limit is the DESIGN bound,
 *     not a guarantee. At that bound one address alone cannot empty a bucket; three can for
 *     otp or verify, and two for refresh. That is the register's TRIGGER (a distributed
 *     drain), and a city-wide reconnect can still empty the 30: a clinical-path question for
 *     W4, not a number to tune here.
 *   - SHIFT CHANGE: 30 links a minute per address is above 20 wards asking within a few
 *     minutes, but six links REQUESTED in ONE 10-second window at one address is possible at
 *     a teaching hospital, and the sixth REQUEST (POST /otp) gets the flat "answered" message
 *     with no email. Six links OPENED (GET verify) in one window is the other case: the sixth
 *     opened gets the VERIFY_LIMITED sentence and the link is not spent. Whether a limited
 *     request gets its own message is W4's ruling (R-2026-09-30-178 FB-4; corrected by
 *     R-2026-09-30-179 FC-6 b, which had said "opened" where it meant "requested").
 *     [RESTATED 2026-10-02, R-2026-10-02-FF FF-3: W4 ruled YES. A request the WORKER limited gets its
 *     own sentence (`signin.LIMITED` in packages/labels/ward-labels.json); Supabase's own 429, which has
 *     no marker, still reads as the flat "answered" message, because it reveals the address.]
 *   - RECONNECT: refresh is lazy (packages/auth/src/holder.ts accessToken), so after an ISP
 *     or power cut longer than the token's life every handset behind one address refreshes
 *     when it next acts, and a limited refresh is terminal today (holder.ts reads any
 *     non-2xx as SessionExpiredError). [RESTATED 2026-10-02, R-2026-10-02-FF FF-2 f: a limited
 *     refresh is NOT terminal now. holder.ts keeps the session on a 429, a 409, a 5xx, a refused
 *     answer or no answer, and ends it only when the refresh token itself is refused; the sentence
 *     above is the text as written on 2026-09-30.] LIMIT_REFRESH bounds how many handsets behind one
 *     address may refresh in one 10-second window. Facility one is a small private
 *     hospital with one facility-level login; the register's TRIGGER holds it for later
 *     facilities.
 *     [RESTATED 2026-10-03, R-2026-10-02-FG FG-9 b: that TRIGGER (the LIMIT_REFRESH row) LEFT the register in
 *     -182, because a limited refresh no longer signs a handset out; the sentence above is the text as written
 *     on 2026-09-30. What still holds a later facility to this arithmetic is the CQ-4 TRIGGER on the 30 emails
 *     an hour, which carries every sign-in link.]
 *   - WHAT THE LIMITS DO, AND WHAT THEY DO NOT (R-2026-09-30-180 FD-2 a). There is one limit
 *     per key per Cloudflare location, but the counters are cached on the machine running
 *     the Worker and updated asynchronously (Cloudflare: "permissive, eventually consistent,
 *     and intentionally designed to not be used as an accurate accounting system"). A client
 *     that keeps one connection, as a browser or a ward's handset does, is counted as
 *     designed: on hosted, 2026-10-01, one connection read 6 forwarded, then limited. A
 *     client that opens a new connection per request can exceed the limits until the counts
 *     catch up: on hosted, 2026-10-01, 15 forwarded, twice. So the edge limits slow a
 *     careless or naive flood and do NOT bound a deliberate one; Supabase's raised per-IP
 *     limits (W3 hosted step a) and the register's TRIGGER on a distributed drain are the
 *     backstop. RESTATED 2026-10-01 (R-2026-09-30-180 FD-2 a): the period bullet above stands
 *     as it was written ("Counting is permissive, eventually consistent and per Cloudflare
 *     location, so 2 x limit is the DESIGN bound, not a guarantee. At that bound one address
 *     alone cannot empty a bucket"), and it holds for a client on ONE connection only. The
 *     2 x limit rule this file asserts is the rule for that client, which is the client the
 *     numbers are sized for.
 *
 * GUARD CLASS (Clause 5): LIVE. The bindings, the entries that name them and the handler
 * that reads them all exist at this commit.
 *
 * NOT ASSERTED HERE, deliberately: that Cloudflare accepted the bindings, or enforces the
 * numbers -- the upload is the proof (runbook, W3 hosted steps b), and the counters are
 * cached on the machine that runs the Worker and updated asynchronously, so a client on one
 * connection is counted as designed and a client that opens a new connection per request
 * can exceed the limits until the counts catch up, and no test in this repository can state
 * what a given address will see. Assertable only by a deploy; verified by
 * scripts/readback_worker_limits.sh as a hosted step, over one connection. RESTATED
 * 2026-10-02 (R-2026-09-30-181 FE-6 a), in the terms of R-2026-09-30-180 FD-2 a: until then
 * this block read "...and counters are local to each Cloudflare location and eventually
 * consistent, so no test in this repository can state what a given address will see".
 *
 * NOT ASSERTED HERE, deliberately: that the Worker's plan includes Workers Rate
 * Limiting. Cloudflare's rate-limit page names no plan, and a test cannot read an
 * account's plan without a credential this public repository does not hold.
 */

interface Ratelimit {
  name?: string;
  namespace_id?: string;
  simple?: { limit?: number; period?: number };
}
interface Wrangler {
  ratelimits?: Ratelimit[];
}

/**
 * SUPABASE'S FIXED PER-IP BURST. GoTrue's apilimiter.go builds the per-IP token and verify
 * buckets with `SetBurst(30)`, and the OTP bucket through a limiter whose burst is also 30
 * (supabase/auth at ce9a8eee, read 2026-09-22). The dashboard cannot change it: its
 * per-5-minute figure sets only the refill rate.
 */
export const SUPABASE_PER_IP_BURST = 30;
/** Every period is 10 seconds: a longer window lets one address send its whole limit at once. */
export const WINDOW_SECONDS = 10;

const LIST_TYPED = LIST as unknown as AllowList;
const WRANGLER_TYPED = WRANGLER as unknown as Wrangler;

/** Everything wrong between the allow-list's `limit` names and wrangler.json's bindings. */
export function limitViolations(list: AllowList, wrangler: Wrangler): string[] {
  const out: string[] = [];
  const bindings = wrangler.ratelimits ?? [];
  const names = bindings.map((b) => b.name ?? '');
  const named = new Set<string>();
  for (const e of list.forward) {
    if (e.limit === undefined) continue;
    if (e.method === 'OPTIONS') out.push(`LIMIT ON OPTIONS: ${e.method} ${e.path} names ${e.limit}, and a preflight is never counted`);
    named.add(e.limit);
    if (!names.includes(e.limit)) out.push(`LIMIT UNBOUND: ${e.method} ${e.path} names ${e.limit}, which wrangler.json does not bind`);
  }
  for (const b of bindings) {
    if (!named.has(b.name ?? '')) out.push(`LIMIT UNUSED: wrangler.json binds ${b.name ?? '(unnamed)'} and no allow-list entry names it`);
    if (b.simple?.period !== WINDOW_SECONDS) out.push(`LIMIT PERIOD: ${b.name ?? '(unnamed)'} counts over ${String(b.simple?.period)} seconds, and every period here is ${WINDOW_SECONDS}: a longer window lets one address send its whole limit in one second`);
    if (!Number.isInteger(b.simple?.limit) || (b.simple?.limit ?? 0) < 1) out.push(`LIMIT VALUE: ${b.name ?? '(unnamed)'} has no positive integer simple.limit`);
    else if (2 * (b.simple?.limit ?? 0) >= SUPABASE_PER_IP_BURST) {
      out.push(`LIMIT BURST: ${b.name ?? '(unnamed)'} allows 2 x ${String(b.simple?.limit)} = ${2 * (b.simple?.limit ?? 0)} requests across a window boundary, which is not under Supabase's fixed per-IP burst of ${SUPABASE_PER_IP_BURST}`);
    }
  }
  const ids = bindings.map((b) => b.namespace_id ?? '');
  for (const id of new Set(ids)) {
    if (ids.filter((x) => x === id).length > 1) out.push(`LIMIT NAMESPACE: namespace_id ${id} is shared, so those bindings would share counters`);
  }
  for (const b of bindings) {
    if (!/^[1-9][0-9]*$/.test(b.namespace_id ?? '')) out.push(`LIMIT NAMESPACE: ${b.name ?? '(unnamed)'} has no namespace_id that is a positive integer string`);
  }
  // The stamp reports these three by name; a binding the handler cannot name is invisible there.
  for (const n of Object.values(LIMIT_BINDINGS)) {
    if (!names.includes(n)) out.push(`LIMIT STAMP: the handler reports ${n} in limits_bound and wrangler.json does not bind it`);
  }
  return out;
}

describe('the edge limits: wrangler.json is the one source of their numbers (FA-3 b)', () => {
  test('the real allow-list and the real wrangler.json agree', () => {
    expect(limitViolations(LIST_TYPED, WRANGLER_TYPED)).toEqual([]);
  });

  test('the three bindings are the ones the design names, by identity', () => {
    expect((WRANGLER_TYPED.ratelimits ?? []).map((b) => `${b.name} ${b.simple?.limit}/${b.simple?.period}`)).toEqual([
      'LIMIT_OTP 5/10',
      'LIMIT_VERIFY 5/10',
      'LIMIT_REFRESH 10/10',
    ]);
    expect(LIST_TYPED.forward.filter((e) => e.limit !== undefined).map((e) => `${e.method} ${e.path} -> ${e.limit}`)).toEqual([
      'POST /auth/v1/otp -> LIMIT_OTP',
      'POST /auth/v1/token -> LIMIT_REFRESH',
      'GET /auth/v1/verify -> LIMIT_VERIFY',
    ]);
  });

  test('plant — an entry naming a binding wrangler.json does not hold is rejected', () => {
    const planted = { forward: LIST_TYPED.forward.map((e) => (e.limit === 'LIMIT_OTP' ? { ...e, limit: 'LIMIT_OTPX' } : e)) };
    const v = limitViolations(planted, WRANGLER_TYPED);
    expect(v).toContain('LIMIT UNBOUND: POST /auth/v1/otp names LIMIT_OTPX, which wrangler.json does not bind');
    expect(v).toContain('LIMIT UNUSED: wrangler.json binds LIMIT_OTP and no allow-list entry names it');
  });

  test('plant — a binding removed from wrangler.json while an entry names it is rejected', () => {
    const planted = { ratelimits: (WRANGLER_TYPED.ratelimits ?? []).filter((b) => b.name !== 'LIMIT_VERIFY') };
    expect(planted.ratelimits.length, 'the plant did not remove a binding').toBe(2);
    const v = limitViolations(LIST_TYPED, planted);
    expect(v).toContain('LIMIT UNBOUND: GET /auth/v1/verify names LIMIT_VERIFY, which wrangler.json does not bind');
    expect(v).toContain('LIMIT STAMP: the handler reports LIMIT_VERIFY in limits_bound and wrangler.json does not bind it');
  });

  test('plant — a binding no entry names is rejected', () => {
    const planted = { ratelimits: [...(WRANGLER_TYPED.ratelimits ?? []), { name: 'LIMIT_SPARE', namespace_id: '3199', simple: { limit: 5, period: WINDOW_SECONDS } }] };
    expect(limitViolations(LIST_TYPED, planted)).toEqual(['LIMIT UNUSED: wrangler.json binds LIMIT_SPARE and no allow-list entry names it']);
  });

  test('plant — two bindings sharing a namespace_id are rejected', () => {
    const planted = { ratelimits: (WRANGLER_TYPED.ratelimits ?? []).map((b) => (b.name === 'LIMIT_VERIFY' ? { ...b, namespace_id: '3101' } : b)) };
    expect(limitViolations(LIST_TYPED, planted)).toEqual(['LIMIT NAMESPACE: namespace_id 3101 is shared, so those bindings would share counters']);
  });

  test('plant — a period other than 10 is rejected, and only the period rule fires', () => {
    // The REAL limit is kept, so the burst rule stays quiet and the message is the period's alone.
    const planted = { ratelimits: (WRANGLER_TYPED.ratelimits ?? []).map((b) => (b.name === 'LIMIT_OTP' ? { ...b, simple: { ...b.simple, period: 60 } } : b)) };
    expect(planted.ratelimits.find((b) => b.name === 'LIMIT_OTP')?.simple?.period, 'the plant did not move the period').toBe(60);
    expect(limitViolations(LIST_TYPED, planted)).toEqual([`LIMIT PERIOD: LIMIT_OTP counts over 60 seconds, and every period here is ${WINDOW_SECONDS}: a longer window lets one address send its whole limit in one second`]);
  });

  test("the burst rule: 2 x limit must be UNDER Supabase's fixed 30 — a limit of 14 is accepted, 15 is rejected", () => {
    const withOtp = (limit: number): Wrangler => ({ ratelimits: (WRANGLER_TYPED.ratelimits ?? []).map((b) => (b.name === 'LIMIT_OTP' ? { ...b, simple: { ...b.simple, limit } } : b)) });
    expect(limitViolations(LIST_TYPED, withOtp(14)), '2 x 14 = 28 is under 30 and must be accepted').toEqual([]);
    expect(limitViolations(LIST_TYPED, withOtp(15))).toEqual([`LIMIT BURST: LIMIT_OTP allows 2 x 15 = 30 requests across a window boundary, which is not under Supabase's fixed per-IP burst of ${SUPABASE_PER_IP_BURST}`]);
    expect(limitViolations(LIST_TYPED, withOtp(16))).toEqual([`LIMIT BURST: LIMIT_OTP allows 2 x 16 = 32 requests across a window boundary, which is not under Supabase's fixed per-IP burst of ${SUPABASE_PER_IP_BURST}`]);
  });

  test('plant — FA\'s own figures (20, 20 and 60 per 60 seconds) are rejected on both rules, which is how the false sizing would have been caught', () => {
    const fa: Wrangler = { ratelimits: (WRANGLER_TYPED.ratelimits ?? []).map((b) => ({ ...b, simple: { limit: b.name === 'LIMIT_REFRESH' ? 60 : 20, period: 60 } })) };
    const v = limitViolations(LIST_TYPED, fa);
    expect(v.filter((x) => x.startsWith('LIMIT PERIOD')).length).toBe(3);
    expect(v.filter((x) => x.startsWith('LIMIT BURST')).length).toBe(3);
  });

  test('plant — a limit on an OPTIONS entry is rejected', () => {
    const planted = { forward: LIST_TYPED.forward.map((e) => (e.method === 'OPTIONS' && e.path === '/auth/v1/otp' ? { ...e, limit: 'LIMIT_OTP' } : e)) };
    expect(limitViolations(planted, WRANGLER_TYPED)).toEqual(['LIMIT ON OPTIONS: OPTIONS /auth/v1/otp names LIMIT_OTP, and a preflight is never counted']);
  });

  test('anti-vacuity — a wrangler.json with no bindings is not an agreeing one', () => {
    const v = limitViolations(LIST_TYPED, {});
    expect(v.filter((x) => x.startsWith('LIMIT UNBOUND')).length, 'an empty binding set passed as agreeing').toBe(3);
  });
});

// ---------------------------------------------------------------------------
// index.js and dev.js hand `env` to the handler.
// ---------------------------------------------------------------------------

/**
 * A missing binding FORWARDS (a limiter must never take sign-in down), so a Worker whose
 * `fetch(request)` forgot `env` would have every limit silently off. The stamp's
 * `limits_bound` would show it on hosted; this is the same fact, held before deploy.
 * Read with the TypeScript parser: the `fetch` method of the default export takes
 * (request, env) and calls `handle(request, env)`.
 */
export function envPassViolations(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out: string[] = [];
  let found = false;
  const visit = (n: ts.Node): void => {
    if (ts.isMethodDeclaration(n) && n.name.getText(sf) === 'fetch') {
      found = true;
      const params = n.parameters.map((p) => p.name.getText(sf));
      if (params[0] !== 'request' || params[1] !== 'env') {
        out.push(`ENV NOT TAKEN: ${file} fetch(${params.join(', ')}) does not take (request, env)`);
      }
      let passed = false;
      const scan = (x: ts.Node): void => {
        if (ts.isCallExpression(x) && x.expression.getText(sf) === 'handle') {
          passed = x.arguments.length === 2 && x.arguments[0]?.getText(sf) === 'request' && x.arguments[1]?.getText(sf) === 'env';
        }
        ts.forEachChild(x, scan);
      };
      if (n.body !== undefined) scan(n.body);
      if (!passed) out.push(`ENV NOT PASSED: ${file} calls handle without (request, env), so every rate limit is silently off`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!found) out.push(`NO FETCH METHOD: ${file} has no fetch method, so nothing was checked`);
  return out;
}

describe('the Worker entry points hand env to the handler (FA-3 f)', () => {
  const FILES = ['supabase-proxy/index.js', 'supabase-proxy/dev.js'];

  test.each(FILES)('real %s is accepted', (f) => {
    expect(envPassViolations(f, readFileSync(join(REPO_ROOT, f), 'utf8'))).toEqual([]);
  });

  test.each(FILES)('plant — %s calling handle(request) without env is rejected', (f) => {
    const real = readFileSync(join(REPO_ROOT, f), 'utf8');
    const planted = real.replace('return handle(request, env);', 'return handle(request);');
    expect(planted, 'the plant did not change the return line').not.toBe(real);
    expect(envPassViolations(f, planted)).toEqual([`ENV NOT PASSED: ${f} calls handle without (request, env), so every rate limit is silently off`]);
  });

  test.each(FILES)('plant — %s whose fetch does not take env is rejected', (f) => {
    const real = readFileSync(join(REPO_ROOT, f), 'utf8');
    const planted = real.replace('fetch(request, env) {', 'fetch(request) {');
    expect(planted, 'the plant did not change the signature').not.toBe(real);
    expect(envPassViolations(f, planted)).toContain(`ENV NOT TAKEN: ${f} fetch(request) does not take (request, env)`);
  });

  test('anti-vacuity — a file with no fetch method fails rather than passing', () => {
    expect(envPassViolations('supabase-proxy/empty.js', 'export default {};\n')).toEqual(['NO FETCH METHOD: supabase-proxy/empty.js has no fetch method, so nothing was checked']);
  });
});

// ---------------------------------------------------------------------------
// The sentence a nurse reads on a limited link.
// ---------------------------------------------------------------------------

/**
 * The handler's copy of the limited-link sentence against the label it is held equal to. A
 * checker, so a plant has something to be rejected BY (the FA version called expect() on a
 * concatenation, which asserted nothing about any code).
 */
export function labelViolations(handlerCopy: string, label: string): string[] {
  return handlerCopy === label ? [] : ["LABEL DRIFT: the handler's copy of the limited-link sentence differs from packages/labels/ward-labels.json proxy.VERIFY_LIMITED"];
}

describe('the limited-link sentence has one source (FA-3 e; FB-1 d, FB-3 j)', () => {
  test('real pair is accepted — the handler copy equals the label, and says what is now true', () => {
    expect(labelViolations(VERIFY_LIMITED_TEXT, WARD.proxy.VERIFY_LIMITED)).toEqual([]);
    expect(VERIFY_LIMITED_TEXT).toContain('just now');
    expect(VERIFY_LIMITED_TEXT, '"in the last minute" is no longer true of a 10-second window').not.toContain('in the last minute');
    expect(VERIFY_LIMITED_TEXT).toContain('Wait one minute');
    expect(VERIFY_LIMITED_TEXT).toContain('It has not been used.');
  });

  test('plant — one word changed in the handler copy is rejected, by its own message', () => {
    const planted = VERIFY_LIMITED_TEXT.replace('Wait one minute', 'Wait a minute');
    expect(planted, 'the plant did not change the copy').not.toBe(VERIFY_LIMITED_TEXT);
    expect(labelViolations(planted, WARD.proxy.VERIFY_LIMITED)).toEqual(["LABEL DRIFT: the handler's copy of the limited-link sentence differs from packages/labels/ward-labels.json proxy.VERIFY_LIMITED"]);
  });

  test('anti-vacuity — an empty copy is not the label', () => {
    expect(labelViolations('', WARD.proxy.VERIFY_LIMITED)).toHaveLength(1);
  });
});
