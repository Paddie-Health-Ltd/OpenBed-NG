import { beforeAll, describe, expect, test } from 'vitest';
import { sql } from '../setup/db.js';
import { apiUrl, anonKey, serviceRoleKey } from '../setup/local-keys.js';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';
import FORBIDDEN from '../../packages/fixtures/forbidden-columns.json';
import { decodeFacility, decodeWard } from '../../packages/snapshot/src/codec.js';
import { authHeaders, serveBeds, serveBedsCached, type BedsEnv, type EdgeCache } from '../../packages/snapshot/src/serve.js';

/**
 * THE SERVED DOCUMENT -- what anon receives from GET /beds.json. A1 sprint,
 * Bundle 1.
 *
 * WHY THIS IS NOT tests/db/snapshot.test.ts AGAIN. That file asserts the
 * GENERATOR: the payload stored in public.snapshot_current, by value, against
 * the mirrors. This file asserts the SERVING LEG: the response the Function
 * returns, read over real HTTP from the local PostgREST with the service-role
 * key, exactly as the deployed Function reads it. A generator that is right and
 * a server that mangles, truncates or re-shapes what it serves would pass the
 * first file and fail this one.
 *
 * THE CONTAINMENT CONTROL, RELOCATED. tests/db/rls_anon_column_containment.test.ts
 * asserts that no anon-readable RELATION carries a forbidden column. The A1
 * kickoff moves the public surface from those relations to this document, so
 * the same property is asserted here, against the same list, imported from
 * packages/fixtures/forbidden-columns.json rather than restated.
 *
 * THE CACHE-CONTROL VALUE IS ASSERTED AS A LITERAL, NOT AS serve.ts's CONSTANT.
 * Asserting the header equals CACHE_CONTROL would pass whatever CACHE_CONTROL
 * said. The literal is v1's Bundle 4 snapshot task, restated where a change to
 * it has to be made twice.
 *
 * NOT ASSERTED HERE, deliberately: that the edge SERVES these headers, or that a
 * second request inside s-maxage is a cache hit. Both are properties of the
 * Cloudflare deployment, not of this code, and the implementer has no Cloudflare
 * access (R-2026-09-17-11 B4). They are OWED in docs/runbook-cloudflare-pages-beds-json.md,
 * in its edge-headers and cache-hit steps, both gated by its custom-domain cutover. A header asserted here and
 * stripped by the platform is the green-light-examining-nothing shape, which is
 * why this file says what it does not prove.
 */

const EXPECTED_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=300';

/**
 * GENERATE THE ROW THIS FILE SERVES, COMMITTED. A fresh `npm run db:reset` leaves
 * public.snapshot_current EMPTY: scripts/seed.sh pauses the pg_cron jobs and does
 * not call the generator. This file was first written assuming the seed produced
 * a row -- observed on 2026-09-18 to be false, when every leg failed on a fresh
 * database and passed only after other suites had committed rows. A test that
 * depends on another file having run first is order-coupled and false on its own.
 * So the row is generated here, as `postgres`, which owns the generator and holds
 * its only EXECUTE (migration 016). It commits because the Function reads over
 * HTTP, through PostgREST, on a different connection.
 */
beforeAll(async () => {
  await sql().unsafe('select app.regenerate_snapshot()');
});

const serviceEnv = (): BedsEnv => ({ SUPABASE_URL: apiUrl(), SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey() });

/** A fetch that answers from a script, recording every call. */
function scripted(steps: Array<() => Promise<Response>>): {
  fetchImpl: (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;
  calls: () => number;
} {
  let n = 0;
  return {
    fetchImpl: () => {
      const step = steps[Math.min(n, steps.length - 1)];
      n += 1;
      return (step as () => Promise<Response>)();
    },
    calls: () => n,
  };
}
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The forbidden names a column list carries. The predicate the plant below exercises. */
const forbiddenIn = (columns: readonly string[]): string[] => columns.filter((c) => FORBIDDEN.columns.includes(c));

async function newestRow(): Promise<{ v: number; payload: unknown }> {
  const rows = await sql()<{ v: string; payload: unknown }[]>`
    select v, payload from public.snapshot_current order by v desc limit 1
  `;
  if (rows.length === 0) {
    throw new Error(
      'no row in public.snapshot_current even though beforeAll generated one -- app.regenerate_snapshot() did not ' +
        'commit a row. This test FAILS rather than skipping: a served-document test over no document proves nothing.',
    );
  }
  const row = rows[0] as { v: string; payload: unknown };
  return { v: Number(row.v), payload: row.payload };
}

describe('GET /beds.json — the served document', () => {
  test('the Function serves the newest snapshot, as service_role, with the edge cache headers', async () => {
    const stored = await newestRow();
    const res = await serveBeds(serviceEnv());
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status, `the Function did not serve the snapshot: ${JSON.stringify(body)}`).toBe(200);
    expect(res.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(body['v'], 'the served document is not the newest snapshot row').toBe(stored.v);
  });

  test('the served document carries X-Robots-Tag, which is the only crawler directive that reaches JSON', async () => {
    // A meta tag cannot live in a JSON document, and before 2026-09-20 /robots.txt
    // returned the SPA's HTML with a 200 -- a crawler was told nothing. Collected
    // politely over months, this document IS the time series the design forbids
    // (R-2026-09-20-29 F). Asserted against the literal, not against the constant:
    // asserting it equals the constant would pass whatever the constant became.
    const res = await serveBeds(serviceEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag'), 'the served document invites archiving').toBe('noindex, nofollow');
  });

  test('a FAILURE response carries it too — an error page is still a page a crawler can keep', async () => {
    const res = await serveBeds({ SUPABASE_URL: apiUrl(), SUPABASE_SERVICE_ROLE_KEY: anonKey() });
    expect(res.status).toBe(502);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  test('the served envelope equals the fixture envelope exactly, as a set of names', async () => {
    const body = (await (await serveBeds(serviceEnv())).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...SHAPE.envelope].sort());
  });

  test('every served row decodes to exactly the fixture columns, and none of them is forbidden', async () => {
    const body = (await (await serveBeds(serviceEnv())).json()) as { wards: unknown[][]; facilities: unknown[][] };
    expect(body.wards.length, 'the served document carries no ward rows -- nothing was asserted').toBeGreaterThan(0);
    expect(body.facilities.length, 'the served document carries no facility rows -- nothing was asserted').toBeGreaterThan(0);

    for (const row of body.wards) expect(Object.keys(decodeWard(row))).toEqual(SHAPE.wardColumns);
    for (const row of body.facilities) expect(Object.keys(decodeFacility(row))).toEqual(SHAPE.facilityColumns);

    expect(forbiddenIn(SHAPE.wardColumns), 'a forbidden column is in the served ward rows').toEqual([]);
    expect(forbiddenIn(SHAPE.facilityColumns), 'a forbidden column is in the served facility rows').toEqual([]);
  });

  test('plant — a column list carrying reason_code is caught by the forbidden-column check', () => {
    // The predicate above over the real lists returns []. A predicate that
    // returned [] for everything would pass it too; this is the leg that proves
    // it can find something.
    expect(forbiddenIn([...SHAPE.wardColumns, 'reason_code'])).toEqual(['reason_code']);
  });

  test('anon holding the published key cannot make the Function serve — the read needs service_role', async () => {
    // The Function's credential is not decorative: snapshot_current is
    // service_role-only (migration 016). With the anon key the origin refuses,
    // and the Function says so rather than serving an empty document.
    const res = await serveBeds({ SUPABASE_URL: apiUrl(), SUPABASE_SERVICE_ROLE_KEY: anonKey() });
    const body = (await res.json()) as { error?: string };
    expect(res.status, `the Function served with the anon key: ${JSON.stringify(body)}`).toBe(502);
    expect(body.error).toMatch(/refused the service-role credential|rejected the snapshot read/);
    expect(res.headers.get('cache-control'), 'a failure was made cacheable').toBe('no-store');
  });
});

describe('GET /beds.json — the credential header follows the key family', () => {
  // NOT ASSERTED END-TO-END HERE, deliberately: the sb_secret_ path over real
  // HTTP. The local stack's sb_secret_ key is not in tests/setup/local-keys.ts,
  // the one file scripts/lint_no_secrets.sh allowlists for credentials, and
  // widening that allowlist is a secrets-control change outside this bundle.
  // The local stack would also accept the key as Bearer, so an end-to-end green
  // here could not tell the two schemes apart anyway. Hosted -- where legacy
  // keys are disabled and sb_secret_ is the only service credential -- is the
  // proof that matters: the edge-headers step of docs/runbook-cloudflare-pages-beds-json.md.

  test('a legacy JWT service key is sent as apikey AND Bearer — apikey alone runs as anon', () => {
    const h = authHeaders(serviceRoleKey());
    expect(h['apikey']).toBe(serviceRoleKey());
    expect(h['authorization']).toBe(`Bearer ${serviceRoleKey()}`);
  });

  test('an sb_secret_ key is sent as apikey ONLY — never as Bearer, which Supabase verifies as a JWT', () => {
    const planted = `sb_${'secret'}_${'B'.repeat(24)}`;
    const h = authHeaders(planted);
    expect(h['apikey']).toBe(planted);
    expect(h, 'an sb_secret_ key was placed in the Authorization header').not.toHaveProperty('authorization');
  });
});

describe('GET /beds.json — the explicit edge cache', () => {
  // NOT ASSERTED HERE, deliberately: that Cloudflare's cache behaves like this
  // fake. The fake proves what the Function ASKS of the cache -- store a 200,
  // never store a failure, serve a hit without reading the origin. Whether the
  // edge honours it is the runbook's cache-hit step, OWED, and only on a custom domain.

  function fakeCache(): EdgeCache & { puts: number } {
    const store = new Map<string, Response>();
    return {
      puts: 0,
      async match(req) {
        const r = store.get(req.url);
        return r ? r.clone() : undefined;
      },
      async put(req, res) {
        this.puts += 1;
        store.set(req.url, res);
      },
    };
  }
  const request = (): Request => new Request('https://openbed.example/beds.json');

  test('a miss reads the origin once and stores the 200; the next request is a hit that reads nothing', async () => {
    const stored = await newestRow();
    const cache = fakeCache();
    const origin = scripted([async () => json(200, [stored])]);

    const first = await serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl);
    const second = await serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(origin.calls(), 'a cache hit still read the origin').toBe(1);
    expect(cache.puts).toBe(1);
    expect(second.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
  });

  test('a failure is never stored — the next request retries the origin', async () => {
    const cache = fakeCache();
    const origin = scripted([async () => json(200, [])]);
    const first = await serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl);
    await serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl);
    expect(first.status).toBe(503);
    expect(cache.puts, 'a 503 was stored in the edge cache').toBe(0);
    expect(origin.calls(), 'the second request did not retry the origin').toBe(2);
  });

  test('with no cache available the Function still serves — a missing Cache API is not an outage', async () => {
    const res = await serveBedsCached({ env: serviceEnv(), request: request() }, undefined);
    expect(res.status).toBe(200);
  });
});

describe('GET /beds.json — what is refused rather than served', () => {
  test('plant — an extra envelope key is refused with 502, never served', async () => {
    const stored = await newestRow();
    const doctored = { ...(stored.payload as Record<string, unknown>), reason_codes: [] };
    const { fetchImpl } = scripted([async () => json(200, [{ v: stored.v, payload: doctored }])]);
    const res = await serveBeds(serviceEnv(), fetchImpl);
    const body = (await res.json()) as { error?: string };
    expect(res.status, `a malformed document was served: ${JSON.stringify(body)}`).toBe(502);
    expect(body.error).toContain('envelope');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('plant — a ward row with one value too many is refused with 502, never served', async () => {
    const stored = await newestRow();
    const payload = stored.payload as { wards: unknown[][] };
    const wards = payload.wards.map((r, i) => (i === 0 ? [...r, 'LEAKED'] : r));
    const { fetchImpl } = scripted([async () => json(200, [{ v: stored.v, payload: { ...payload, wards } }])]);
    const res = await serveBeds(serviceEnv(), fetchImpl);
    const body = (await res.json()) as { error?: string };
    expect(res.status, `a row of the wrong arity was served: ${JSON.stringify(body)}`).toBe(502);
    expect(body.error).toContain('wardColumns');
  });

  test('no snapshot row yet is 503 and uncacheable, not an empty document', async () => {
    const { fetchImpl } = scripted([async () => json(200, [])]);
    const res = await serveBeds(serviceEnv(), fetchImpl);
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('a missing credential is 500, names the variable, and never echoes a value', async () => {
    const res = await serveBeds({ SUPABASE_URL: apiUrl() });
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).toContain('SUPABASE_SERVICE_ROLE_KEY is not set');
  });

  test('an error response never contains the credential it was given', async () => {
    const secret = 'plant-credential-value-that-must-not-echo';
    const { fetchImpl } = scripted([async () => json(401, { message: 'no' })]);
    const res = await serveBeds({ SUPABASE_URL: apiUrl(), SUPABASE_SERVICE_ROLE_KEY: secret }, fetchImpl);
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text, 'the credential value was echoed in an error body').not.toContain(secret);
  });

  test('a 5xx from the origin is retried once, then served when the retry succeeds', async () => {
    const stored = await newestRow();
    const { fetchImpl, calls } = scripted([
      async () => json(503, { message: 'upstream busy' }),
      async () => json(200, [stored]),
    ]);
    const res = await serveBeds(serviceEnv(), fetchImpl);
    expect(res.status).toBe(200);
    expect(calls(), 'the 5xx was not retried').toBe(2);
  });

  test('a 4xx from the origin is NOT retried — a refused credential does not start working', async () => {
    const { fetchImpl, calls } = scripted([async () => json(400, { message: 'bad request' })]);
    const res = await serveBeds(serviceEnv(), fetchImpl);
    expect(res.status).toBe(502);
    expect(calls(), 'a 4xx was retried').toBe(1);
  });

  test('an origin that never answers times out, is retried a bounded number of times, and is 504', async () => {
    // A fetch that NEVER settles by itself. The only thing that can end it is the
    // AbortSignal serve.ts passes in, so this exercises the real timeout wiring
    // rather than a stub that rejects on its own clock.
    let calls = 0;
    const neverAnswers = (_url: string, init?: { signal?: AbortSignal }): Promise<Response> => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    };
    const res = await serveBeds(serviceEnv(), neverAnswers, { timeoutMs: 50, attempts: 2 });
    const body = (await res.json()) as { error?: string };
    expect(res.status, `a hung origin was not timed out: ${JSON.stringify(body)}`).toBe(504);
    expect(calls, 'the timeout was retried an unbounded or zero number of times').toBe(2);
    expect(body.error).toContain('timed out');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('control — a fetch given no signal would hang, so the timeout is what ended the leg above', async () => {
    // Without this, the leg above could pass because the stub rejected for some
    // other reason. Here the same stub runs WITHOUT serve.ts's signal and is
    // raced against a short timer: it must still be pending.
    const pending = new Promise<Response>(() => undefined);
    const winner = await Promise.race([pending.then(() => 'settled'), new Promise((r) => setTimeout(() => r('still pending'), 80))]);
    expect(winner).toBe('still pending');
  });
});
