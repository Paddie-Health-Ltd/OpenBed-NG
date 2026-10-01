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
 * THE SIZING ARGUMENT (why 20, 20 and 60; the key is the client address, so one
 * hospital's NAT address is one key):
 *   - a handset refreshes about once an hour, so a 30-ward hospital sends about one
 *     refresh a minute;
 *   - at a 07:00 or 19:00 shift change, 20 wards each ask for a link and open it within a
 *     few minutes, which is under 20 a minute of each;
 *   - reconnect after an outage: refresh is lazy (packages/auth/src/holder.ts
 *     accessToken), so after an ISP or power cut longer than the token's life every
 *     handset behind one address refreshes when it next acts, and a limited refresh is
 *     terminal (holder.ts reads any non-2xx as SessionExpiredError). LIMIT_REFRESH must
 *     therefore exceed the reporting logins at the largest listed facility. Facility one
 *     is a small private hospital with one facility-level login; the register's TRIGGER
 *     holds it for later facilities;
 *   - one address held at these limits cannot drain Supabase's shared per-IP buckets once
 *     they are raised (runbook, W3 hosted steps a): draining takes more than six
 *     addresses for sign-in or verify and more than five for refresh.
 *
 * GUARD CLASS (Clause 5): LIVE. The bindings, the entries that name them and the handler
 * that reads them all exist at this commit.
 *
 * NOT ASSERTED HERE, deliberately: that Cloudflare accepted the bindings, or enforces the
 * numbers -- the upload is the proof (runbook, W3 hosted steps b), and counters are local
 * to each Cloudflare location and eventually consistent, so no test in this repository
 * can state what a given address will see. Assertable only by a deploy; verified by
 * scripts/readback_worker_limits.sh as a hosted step.
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
    if (b.simple?.period !== 60) out.push(`LIMIT PERIOD: ${b.name ?? '(unnamed)'} counts over ${String(b.simple?.period)} seconds, and every limit here is per 60`);
    if (!Number.isInteger(b.simple?.limit) || (b.simple?.limit ?? 0) < 1) out.push(`LIMIT VALUE: ${b.name ?? '(unnamed)'} has no positive integer simple.limit`);
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
      'LIMIT_OTP 20/60',
      'LIMIT_VERIFY 20/60',
      'LIMIT_REFRESH 60/60',
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
    const planted = { ratelimits: [...(WRANGLER_TYPED.ratelimits ?? []), { name: 'LIMIT_SPARE', namespace_id: '3199', simple: { limit: 5, period: 60 } }] };
    expect(limitViolations(LIST_TYPED, planted)).toEqual(['LIMIT UNUSED: wrangler.json binds LIMIT_SPARE and no allow-list entry names it']);
  });

  test('plant — two bindings sharing a namespace_id are rejected', () => {
    const planted = { ratelimits: (WRANGLER_TYPED.ratelimits ?? []).map((b) => (b.name === 'LIMIT_VERIFY' ? { ...b, namespace_id: '3101' } : b)) };
    expect(limitViolations(LIST_TYPED, planted)).toEqual(['LIMIT NAMESPACE: namespace_id 3101 is shared, so those bindings would share counters']);
  });

  test('plant — a period other than 60 is rejected', () => {
    const planted = { ratelimits: (WRANGLER_TYPED.ratelimits ?? []).map((b) => (b.name === 'LIMIT_OTP' ? { ...b, simple: { limit: 20, period: 10 } } : b)) };
    expect(limitViolations(LIST_TYPED, planted)).toEqual(['LIMIT PERIOD: LIMIT_OTP counts over 10 seconds, and every limit here is per 60']);
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

describe('the limited-link sentence has one source (FA-3 e)', () => {
  test('the handler copy equals packages/labels/ward-labels.json, and is one sentence-group a nurse can act on', () => {
    expect(VERIFY_LIMITED_TEXT).toBe(WARD.proxy.VERIFY_LIMITED);
    expect(VERIFY_LIMITED_TEXT).toContain('Wait one minute');
    expect(VERIFY_LIMITED_TEXT).toContain('It has not been used.');
  });

  test('plant — an edited copy is not equal to the label', () => {
    expect(`${VERIFY_LIMITED_TEXT} Please try later.`, 'a diverged copy compared equal').not.toBe(WARD.proxy.VERIFY_LIMITED);
  });
});
