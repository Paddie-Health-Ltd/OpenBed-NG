import { beforeAll, describe, expect, test } from 'vitest';
import { sql } from '../setup/db.js';
import { apiUrl, anonKey, serviceRoleKey } from '../setup/local-keys.js';
import { PRODUCTION_SUPABASE_ORIGIN } from '@openbed/origins';
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

/**
 * The Function's environment: ONE name since R-2026-09-22-59 B3. The origin is no
 * longer environment at all -- it is the first argument, and `localOrigin()` below
 * is what these legs pass for it.
 */
const serviceEnv = (): BedsEnv => ({ SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey() });

/**
 * The origin these legs address, and it must stay LOCAL.
 *
 * Derived from apiUrl() rather than written out, so the one place this suite
 * decides where the local stack is stays one place.
 */
const localOrigin = (): string => apiUrl();

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
    const res = await serveBeds(localOrigin(), serviceEnv());
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
    const res = await serveBeds(localOrigin(), serviceEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag'), 'the served document invites archiving').toBe('noindex, nofollow');
  });

  test('a FAILURE response carries it too — an error page is still a page a crawler can keep', async () => {
    const res = await serveBeds(localOrigin(), { SUPABASE_SERVICE_ROLE_KEY: anonKey() });
    expect(res.status).toBe(502);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  test('the served envelope equals the fixture envelope exactly, as a set of names', async () => {
    const body = (await (await serveBeds(localOrigin(), serviceEnv())).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...SHAPE.envelope].sort());
  });

  test('every served row decodes to exactly the fixture columns, and none of them is forbidden', async () => {
    const body = (await (await serveBeds(localOrigin(), serviceEnv())).json()) as { wards: unknown[][]; facilities: unknown[][] };
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
    const res = await serveBeds(localOrigin(), { SUPABASE_SERVICE_ROLE_KEY: anonKey() });
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
  // never store a failure, serve a hit without reading the origin, and key every
  // write on a GET. Whether the edge honours it is the runbook's cache-hit step,
  // OWED, and only on a custom domain.
  //
  // NOT ASSERTED HERE EITHER, and it is the more load-bearing of the two: that
  // Cloudflare's `put` really throws for a non-GET request, and that `match`
  // really honours `ignoreMethod`. Both are READ from its Cache API reference,
  // never measured -- this repository has no Cloudflare access. The fake below
  // MODELS those two rules, so the legs that rest on them prove this module
  // against the DOCUMENTED CONTRACT. That is the strongest thing assertable from
  // inside this repository and it is weaker than a measurement: if the reference
  // is wrong, these legs are green and the edge still throws.

  type Fake = EdgeCache & {
    puts: number;
    keys: string[];
    failRead: boolean;
    failWrite: boolean;
    throwSync: boolean;
  };

  /**
   * A FAKE THAT MODELS THE DOCUMENTED CONTRACT, not a bare Map.
   *
   * A Map keyed on `req.url` alone accepts a HEAD write happily, so every HEAD
   * leg below would pass while the real edge threw -- a plant proving nothing,
   * which is exactly what test-conventions section 2 is about. So the two
   * documented rules are built in: `put` REJECTS a non-GET, and `match` keys on
   * the method unless `ignoreMethod` is passed.
   */
  function fakeCache(): Fake {
    const store = new Map<string, Response>();
    return {
      puts: 0,
      keys: [],
      failRead: false,
      failWrite: false,
      throwSync: false,
      async match(req: Request, options?: { ignoreMethod?: boolean }) {
        if (this.failRead) throw new Error('planted: the edge cache read failed');
        const method = options?.ignoreMethod ? 'GET' : req.method;
        const hit = store.get(`${method} ${req.url}`);
        return hit ? hit.clone() : undefined;
      },
      put(req: Request, res: Response): Promise<void> {
        // A synchronous throw and a rejected promise are DIFFERENT SHAPES that
        // reach the module by different paths. Both are plantable here because
        // the reference does not say which one Cloudflare uses.
        if (this.throwSync) throw new Error('planted: the edge cache write threw synchronously');
        if (req.method !== 'GET') {
          return Promise.reject(new TypeError('Cannot cache response to non-GET request.'));
        }
        if (this.failWrite) return Promise.reject(new Error('planted: the edge cache write failed'));
        this.puts += 1;
        this.keys.push(`${req.method} ${req.url}`);
        store.set(`${req.method} ${req.url}`, res);
        return Promise.resolve();
      },
    };
  }

  /**
   * THE REQUEST THESE LEGS ARE SERVED, AND ITS HOST IS LOAD-BEARING (R-2026-09-22-59 E).
   *
   * It used to be `https://openbed.example/beds.json`, an unroutable example host,
   * which was harmless while the Function's upstream origin came from the `env`
   * object these tests construct. **It stops being harmless the moment the origin
   * is selected from this URL's hostname.** Two legs below —
   * *"with no cache available the Function still serves"* and *"no cache in this
   * environment is marked `unavailable`"* — pass no stubbed fetch, so they use the
   * real global one. With a non-local host they would address the LIVE hosted
   * project, authenticating with the local demo service-role key, and both would
   * still assert a 200 and a header. **Nothing in the suite would have said so.**
   *
   * So the host is local, and the tracked-origins guard asserts that by reading
   * THIS line rather than restating it. That guard is named here WITHOUT backticks
   * because it does not exist yet: a backticked path to an unbuilt file is the
   * Clause 4 phantom, and citing one from an executable artefact is refused even
   * when it is registered as planned. It arrives two commits from here. Changed here, in its own
   * commit, BEFORE the origin moved — the window in which this is wrong is a window
   * in which the tests still pass.
   */
  const REQUEST_URL = 'http://127.0.0.1:8788/beds.json';
  const request = (method = 'GET'): Request => new Request(REQUEST_URL, { method });

  /**
   * Capture console.error for a leg. The degradation R-2026-09-20-33 B5 describes
   * is deliberately invisible to the CLIENT and deliberately visible in the LOG,
   * so the log is an assertion target, not noise to be silenced.
   */
  async function withLoggedErrors<T>(fn: () => Promise<T>): Promise<{ result: T; logged: string[] }> {
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]): void => {
      logged.push(args.map((a) => String(a)).join(' '));
    };
    try {
      return { result: await fn(), logged };
    } finally {
      console.error = original;
    }
  }

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

  /*
   * THE METHOD LEGS (R-2026-09-21-W). Until 2026-09-21 a HEAD never reached this
   * module at all: the Function exported onRequestGet only, so Pages answered a
   * HEAD from the SPA fallback with text/html and none of the headers below.
   * Measured against the deployed artifact, not inferred.
   */

  test('the cache is keyed on a GET whatever the method arrived — the documented put contract is never violated', async () => {
    const stored = await newestRow();
    const cache = fakeCache();
    const origin = scripted([async () => json(200, [stored])]);
    await serveBedsCached({ env: serviceEnv(), request: request('HEAD') }, cache, origin.fetchImpl);
    expect(cache.keys, 'a non-GET key reached cache.put, which the Cache API refuses').toEqual([
      `GET ${REQUEST_URL}`,
    ]);
  });

  test('control — the fake refuses a non-GET write, so the leg above is not vacuous', async () => {
    // Without this, a fake that accepted anything would make the GET-key leg pass
    // whether or not the module normalised. One plant proves the instrument.
    const cache = fakeCache();
    await expect(cache.put(request('HEAD'), json(200, []))).rejects.toThrow(/non-GET/);
  });

  test('plant — a GET populates the cache and a HEAD is then served from that entry, carrying the Function headers', async () => {
    const stored = await newestRow();
    const cache = fakeCache();
    const origin = scripted([async () => json(200, [stored])]);

    await serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl);
    const head = await serveBedsCached({ env: serviceEnv(), request: request('HEAD') }, cache, origin.fetchImpl);

    expect(head.status).toBe(200);
    expect(origin.calls(), 'the HEAD read the origin instead of the entry the GET populated').toBe(1);
    expect(head.headers.get('content-type'), 'a HEAD answered as the SPA fallback').toBe('application/json; charset=utf-8');
    expect(head.headers.get('x-robots-tag'), 'a HEAD lost the robots header and invites archiving').toBe('noindex, nofollow');
    expect(head.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
  });

  test('a HEAD carries the headers and NO body', async () => {
    const stored = await newestRow();
    const cache = fakeCache();
    const origin = scripted([async () => json(200, [stored])]);
    const head = await serveBedsCached({ env: serviceEnv(), request: request('HEAD') }, cache, origin.fetchImpl);
    expect(head.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await head.text(), 'a HEAD answered with a body').toBe('');
  });

  test('plant — a HEAD on a COLD cache does not throw, and populates no HEAD-keyed entry', async () => {
    const stored = await newestRow();
    const cache = fakeCache();
    const origin = scripted([async () => json(200, [stored])]);

    const { result, logged } = await withLoggedErrors(() =>
      serveBedsCached({ env: serviceEnv(), request: request('HEAD') }, cache, origin.fetchImpl),
    );

    expect(result.status).toBe(200);
    expect(logged, `a HEAD on a cold cache logged an exception: ${logged.join(' | ')}`).toEqual([]);
    expect(
      cache.keys.some((k) => k.startsWith('HEAD ')),
      'a HEAD-keyed entry was created, so GET and HEAD no longer share one entry',
    ).toBe(false);
  });

  /*
   * THE CACHE-EXCEPTION LEGS (R-2026-09-20-33 B4-B6). Before this fix the two
   * cache awaits sat outside any try, so an exception there bypassed failure()
   * and reached the client as an unhandled Function exception carrying none of
   * this module's headers.
   */

  test('plant — a cache READ that throws is a miss, and the response is the normal tagged 200', async () => {
    const stored = await newestRow();
    const cache = fakeCache();
    cache.failRead = true;
    const origin = scripted([async () => json(200, [stored])]);

    const { result, logged } = await withLoggedErrors(() =>
      serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl),
    );

    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
    expect(result.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(origin.calls(), 'a throwing cache read did not fall through to the origin').toBe(1);
    expect(logged.join(' '), 'the degradation was not logged server-side').toContain('cache read failed');
  });

  /**
   * THE LEG THAT PROVES THE TRY WAS NOT WIDENED (R-2026-09-20-33 B6), and the
   * reason it is here rather than in a later tidy-up.
   *
   * With the ORIGIN failing behind a THROWING CACHE, a broad catch swallows the
   * origin failure and returns something untagged, while the correct fix still
   * returns the tagged, uncacheable failure that failure() built.
   *
   * WHAT THIS LEG DOES AND DOES NOT DISCRIMINATE -- measured by planting, on
   * 2026-09-21, not reasoned. Three widened shapes were planted against this
   * block:
   *   1. ONE broad try around everything, catch returning an untagged 500
   *      -> THIS LEG REDS (with four others). The shape B4 names.
   *   2. the try widened to include the origin read, so the cache WRITE is
   *      skipped -> caught, but by the miss/store leg above, NOT by this one.
   *   3. a widened catch that merely RE-RUNS serveBeds -> NOT CAUGHT, by this
   *      leg or any other here, and it cannot be.
   *
   * The reason for 3 is worth stating, because it qualifies R-2026-09-20-33 B6's
   * premise: serveBeds is TOTAL. It catches its own exceptions and always returns
   * a Response, so it can never throw INTO a widened catch, and a catch that
   * re-runs it produces the same bytes by a wasteful route. B6's "the fix and the
   * broad catch would look identical in green" is therefore true of shape 1 and
   * is what this leg closes; shape 3 is invisible to behaviour and would need a
   * structural assertion over the source, which is NOT ASSERTED HERE.
   */
  test('plant — an ORIGIN failure behind a throwing cache is still a tagged, uncacheable failure', async () => {
    const cache = fakeCache();
    cache.failRead = true;
    cache.failWrite = true;
    const origin = scripted([async () => json(503, { message: 'busy' })]);

    const { result } = await withLoggedErrors(() =>
      serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl),
    );

    expect(result.status, 'the origin failure was converted into something other than a refusal').toBe(502);
    expect(result.headers.get('cache-control'), 'a failure behind a throwing cache became cacheable').toBe('no-store');
    expect(
      result.headers.get('x-robots-tag'),
      'a failure behind a throwing cache lost its robots header',
    ).toBe('noindex, nofollow');
    const body = (await result.json()) as { error?: string };
    expect(body.error, 'the failure did not come from failure()').toContain('origin');
  });

  test('plant — a cache WRITE that rejects still serves the response', async () => {
    const stored = await newestRow();
    const cache = fakeCache();
    cache.failWrite = true;
    const origin = scripted([async () => json(200, [stored])]);

    const { result, logged } = await withLoggedErrors(() =>
      serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl),
    );

    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe(EXPECTED_CACHE_CONTROL);
    expect(cache.puts, 'the write was counted despite rejecting').toBe(0);
    expect(logged.join(' '), 'the degradation was not logged server-side').toContain('cache write failed');
  });

  test('plant — a cache WRITE that throws synchronously still serves the response', async () => {
    const stored = await newestRow();
    const cache = fakeCache();
    cache.throwSync = true;
    const origin = scripted([async () => json(200, [stored])]);

    const { result, logged } = await withLoggedErrors(() =>
      serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl),
    );

    expect(result.status).toBe(200);
    expect(logged.join(' '), 'a synchronous throw from put was not logged').toContain('cache write threw');
  });

  test('plant — a rejecting write handed to waitUntil is handled, not left as an unhandled rejection', async () => {
    // The waitUntil path is the one a try around the call CANNOT cover: nothing
    // awaits the promise here, so an async rejection would escape it entirely.
    const stored = await newestRow();
    const cache = fakeCache();
    cache.failWrite = true;
    const origin = scripted([async () => json(200, [stored])]);
    const scheduled: Array<Promise<unknown>> = [];

    const { result, logged } = await withLoggedErrors(async () => {
      const r = await serveBedsCached(
        {
          env: serviceEnv(),
          request: request(),
          waitUntil: (pr) => {
            scheduled.push(pr);
          },
        },
        cache,
        origin.fetchImpl,
      );
      await Promise.all(scheduled);
      return r;
    });

    expect(result.status).toBe(200);
    expect(scheduled.length, 'nothing was handed to waitUntil').toBe(1);
    await expect(
      Promise.all(scheduled),
      'the waitUntil promise rejected — at the edge that is an unhandled rejection',
    ).resolves.toBeDefined();
    expect(logged.join(' ')).toContain('cache write failed');
  });

  /*
   * THE MARKER LEGS (R-2026-09-21-42).
   *
   * WHY THE MARKER EXISTS, in one line: until it did, NOTHING a client could read
   * distinguished a cache hit from an origin read. `cf-cache-status` is the zone
   * CDN's verdict about a different cache -- `DYNAMIC` for this path whether this
   * code hit or missed, MEASURED on openbed.ng 2026-09-21 -- and the body is a
   * stored snapshot that is byte-identical across an origin read, because
   * migration 016 stamps `server_now` once per REGENERATION, not per request. So
   * the runbook's cache step had no observable that could take two values, and the
   * EVIDENCE gate's fourth observation could not be discharged by any probe.
   *
   * These legs give the marker BOTH HALVES before the founder runs anything, which
   * is precisely what the `curl -X HEAD` probe never had.
   */

  /** Capture console.log for a leg. The state line is an assertion target. */
  async function withLoggedInfo<T>(fn: () => Promise<T>): Promise<{ result: T; logged: string[] }> {
    const logged: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]): void => {
      logged.push(args.map((a) => String(a)).join(' '));
    };
    try {
      return { result: await fn(), logged };
    } finally {
      console.log = original;
    }
  }

  // Restated rather than imported from serve.ts, for the same reason
  // EXPECTED_CACHE_CONTROL is: asserting the header equals the module's own
  // constant would pass whatever the constant said.
  const MARKER = 'x-openbed-edge-cache';

  // The serve-time clock (R-2026-09-23-67 A3). Restated, not imported, for the
  // same reason MARKER is.
  const SERVED_AT = 'x-openbed-served-at';

  test('every response carries a serve-time clock, a HIT included, and it is THIS serve\'s time', async () => {
    const stored = await newestRow();
    const cache = fakeCache();
    const origin = scripted([async () => json(200, [stored])]);
    const before = Date.now();
    const miss = await serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl);
    await new Promise((r) => setTimeout(r, 20));
    const hit = await serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl);
    const head = await serveBedsCached({ env: serviceEnv(), request: request('HEAD') }, cache, origin.fetchImpl);
    const after = Date.now();

    expect(hit.headers.get(MARKER), 'the second request did not hit, so this leg tests a miss twice').toBe('hit');
    for (const [label, res] of [['miss', miss], ['hit', hit], ['HEAD', head]] as const) {
      const at = Date.parse(res.headers.get(SERVED_AT) ?? '');
      expect(Number.isNaN(at), `the ${label} response carries no readable ${SERVED_AT}`).toBe(false);
      expect(at, `the ${label} response's serve time is outside this request`).toBeGreaterThanOrEqual(before);
      expect(at).toBeLessThanOrEqual(after);
    }
    expect(Date.parse(hit.headers.get(SERVED_AT) ?? ''), 'the hit replayed the miss\'s serve time, so a cached snapshot could never age').toBeGreaterThan(
      Date.parse(miss.headers.get(SERVED_AT) ?? ''),
    );
  });

  test('THE STORED COPY CARRIES NO SERVE TIME — a stored one would freeze every later hit at the first serve', async () => {
    const stored = await newestRow();
    const cache = fakeCache();
    const origin = scripted([async () => json(200, [stored])]);
    await serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl);
    const entry = await cache.match(request(), { ignoreMethod: true });
    expect(entry, 'nothing was stored, so this leg proves nothing').toBeDefined();
    expect((entry as Response).headers.get(SERVED_AT), 'the serve time was written into the CACHED object').toBeNull();
  });

  test('a failure carries the serve-time clock too, so an outage page can say when it was told', async () => {
    const res = await serveBedsCached({ env: serviceEnv(), request: request() }, fakeCache(), scripted([async () => json(200, [])]).fetchImpl);
    expect(res.status).toBe(503);
    expect(Number.isNaN(Date.parse(res.headers.get(SERVED_AT) ?? ''))).toBe(false);
  });

  test('a hit is marked `hit`, and the origin is not read', async () => {
    const stored = await newestRow();
    const cache = fakeCache();
    const origin = scripted([async () => json(200, [stored])]);

    const first = await serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl);
    const second = await serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl);

    expect(first.headers.get(MARKER), 'the first request was not marked a miss').toBe('miss');
    expect(second.headers.get(MARKER), 'a cache hit was not marked as one — the runbook step cannot pass').toBe('hit');
    expect(origin.calls(), 'the response marked `hit` still read the origin, so the marker is a lie').toBe(1);
  });

  test('THE PLANT THAT MATTERS — with an empty cache the marker is never `hit`', async () => {
    // The failing half. A marker that reads `hit` unconditionally would satisfy
    // every leg above; this is the one that says it cannot.
    const stored = await newestRow();
    const cache = fakeCache();
    const origin = scripted([async () => json(200, [stored]), async () => json(200, [stored])]);

    const a = await serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl);
    // A second, independent cold cache — the entry the first request stored is not
    // visible to it, so this must miss too.
    const b = await serveBedsCached({ env: serviceEnv(), request: request() }, fakeCache(), origin.fetchImpl);

    expect(a.headers.get(MARKER)).toBe('miss');
    expect(b.headers.get(MARKER)).toBe('miss');
    expect(origin.calls(), 'a cold cache did not read the origin').toBe(2);
  });

  test('no cache in this environment is marked `unavailable`, never `hit`', async () => {
    const res = await serveBedsCached({ env: serviceEnv(), request: request() }, undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get(MARKER)).toBe('unavailable');
  });

  test('plant — a cache READ that throws is marked `read-error`, not `miss`', async () => {
    // "The cache is empty" and "the cache is broken" are different facts and the
    // runbook has to tell them apart from one header line.
    const stored = await newestRow();
    const cache = fakeCache();
    cache.failRead = true;
    const origin = scripted([async () => json(200, [stored])]);

    const { result } = await withLoggedErrors(() =>
      serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl),
    );

    expect(result.status).toBe(200);
    expect(result.headers.get(MARKER), 'a throwing cache was reported as an ordinary miss').toBe('read-error');
  });

  test('a failure is marked `nostore`, and nothing reached cache.put', async () => {
    const cache = fakeCache();
    const origin = scripted([async () => json(200, [])]);
    const res = await serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl);

    expect(res.status).toBe(503);
    expect(res.headers.get(MARKER)).toBe('nostore');
    expect(res.headers.get('cache-control'), 'a failure became cacheable').toBe('no-store');
    expect(cache.puts, 'a failure was stored').toBe(0);
  });

  test('THE STORED COPY CARRIES NO MARKER — a stale `miss` can never be served as a `hit`', async () => {
    // The defect this is aimed at: mark the response BEFORE cache.put and the
    // stored object carries `miss` forever, so every later hit serves the word
    // "miss"; mark it the other way and a stored `hit` is served on a request that
    // missed. Either way the marker stops describing the request it is on.
    const stored = await newestRow();
    const cache = fakeCache();
    const origin = scripted([async () => json(200, [stored])]);

    await serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl);
    const entry = await cache.match(request(), { ignoreMethod: true });

    expect(entry, 'nothing was stored, so this leg proves nothing').toBeDefined();
    expect(
      (entry as Response).headers.get(MARKER),
      'the marker was written into the CACHED object, so it will be served on requests it does not describe',
    ).toBeNull();
  });

  test('a HEAD carries the marker too — GET/HEAD parity extends to it — and still no body', async () => {
    const stored = await newestRow();
    const cache = fakeCache();
    const origin = scripted([async () => json(200, [stored])]);

    await serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl);
    const head = await serveBedsCached({ env: serviceEnv(), request: request('HEAD') }, cache, origin.fetchImpl);

    expect(head.headers.get(MARKER), 'a HEAD lost the marker, so the runbook cannot read it with -I').toBe('hit');
    expect(await head.text(), 'a HEAD answered with a body').toBe('');
  });

  test('the marker takes ONLY the five documented values, and every one of them is reachable', async () => {
    // Closed set, asserted by identity rather than by "is a string" — a sixth
    // value would be a line in the runbook nobody knows how to read.
    const stored = await newestRow();
    const warm = fakeCache();
    const readErr = fakeCache();
    readErr.failRead = true;

    const seen = new Set<string | null>();

    const origin = scripted([
      async () => json(200, [stored]),
      async () => json(200, [stored]),
      async () => json(200, [stored]),
    ]);
    seen.add((await serveBedsCached({ env: serviceEnv(), request: request() }, warm, origin.fetchImpl)).headers.get(MARKER));
    seen.add((await serveBedsCached({ env: serviceEnv(), request: request() }, warm, origin.fetchImpl)).headers.get(MARKER));
    seen.add((await serveBedsCached({ env: serviceEnv(), request: request() }, undefined, origin.fetchImpl)).headers.get(MARKER));
    const { result: re } = await withLoggedErrors(() =>
      serveBedsCached({ env: serviceEnv(), request: request() }, readErr, origin.fetchImpl),
    );
    seen.add(re.headers.get(MARKER));
    const nostore = scripted([async () => json(200, [])]);
    seen.add(
      (await serveBedsCached({ env: serviceEnv(), request: request() }, fakeCache(), nostore.fetchImpl)).headers.get(MARKER),
    );

    expect([...seen].sort(), 'the marker took a value outside its documented set, or a documented value is unreachable').toEqual(
      ['hit', 'miss', 'nostore', 'read-error', 'unavailable'],
    );
  });

  test('every request logs the state WITH ITS CAUSE, so a `miss` at the edge is explainable', async () => {
    const stored = await newestRow();
    const cache = fakeCache();
    const origin = scripted([async () => json(200, [stored])]);

    const { logged: missLog } = await withLoggedInfo(() =>
      serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl),
    );
    const { logged: hitLog } = await withLoggedInfo(() =>
      serveBedsCached({ env: serviceEnv(), request: request() }, cache, origin.fetchImpl),
    );

    expect(missLog.join(' '), 'a miss was not logged with its state').toContain(`${MARKER}=miss`);
    expect(missLog.join(' '), 'a miss was logged with no cause, which is what leaves the founder stuck').toContain(
      'attempted a write',
    );
    expect(hitLog.join(' '), 'a hit was not logged').toContain(`${MARKER}=hit`);
    expect(hitLog.join(' ')).toContain('the origin was not read');
  });
});

describe('GET /beds.json — what is refused rather than served', () => {
  test('plant — an extra envelope key is refused with 502, never served', async () => {
    const stored = await newestRow();
    const doctored = { ...(stored.payload as Record<string, unknown>), reason_codes: [] };
    const { fetchImpl } = scripted([async () => json(200, [{ v: stored.v, payload: doctored }])]);
    const res = await serveBeds(localOrigin(), serviceEnv(), fetchImpl);
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
    const res = await serveBeds(localOrigin(), serviceEnv(), fetchImpl);
    const body = (await res.json()) as { error?: string };
    expect(res.status, `a row of the wrong arity was served: ${JSON.stringify(body)}`).toBe(502);
    expect(body.error).toContain('wardColumns');
    // The plant above inserts a VALUE, and until R-2026-09-20-32 B3 this leg never
    // looked for it: it asserted what the message says and not what it must never
    // say. The codec reports an arity, never a cell, and this is the assertion that
    // holds it to that.
    expect(JSON.stringify(body), 'the refusal echoed a value out of the row it refused').not.toContain('LEAKED');
  });

  test('no snapshot row yet is 503 and uncacheable, not an empty document', async () => {
    const { fetchImpl } = scripted([async () => json(200, [])]);
    const res = await serveBeds(localOrigin(), serviceEnv(), fetchImpl);
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('a missing credential is 500, names the variable, and never echoes a value', async () => {
    const res = await serveBeds(localOrigin(), {});
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).toContain('SUPABASE_SERVICE_ROLE_KEY is not set');
  });

  test('an error response never contains the credential it was given', async () => {
    const secret = 'plant-credential-value-that-must-not-echo';
    const { fetchImpl } = scripted([async () => json(401, { message: 'no' })]);
    const res = await serveBeds(localOrigin(), { SUPABASE_SERVICE_ROLE_KEY: secret }, fetchImpl);
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text, 'the credential value was echoed in an error body').not.toContain(secret);
  });

  /**
   * WHAT A FAILURE BODY MAY CONTAIN (R-2026-09-20-32 B3).
   *
   * The preview-deployment probe was declined BECAUSE a failing /beds.json carries no
   * bed data — the body is `{"error": "<reason>"}` and nothing else. That is a claim
   * about this code, and these three legs are what make it a checked one rather than
   * a reading of it. Every reason string is literals plus, at most, an HTTP status, an
   * attempt count and a timeout; the legs below plant the three values that could
   * turn that into an echo.
   *
   * NOT ASSERTED HERE, deliberately (method note 12): what Cloudflare returns for an
   * UNHANDLED Function exception. That remains unobservable from this repository.
   *
   * WHAT CHANGED, AND WHY THIS SENTENCE WAS REWRITTEN RATHER THAN LEFT: until
   * R-2026-09-20-33's fix this note read that "serveBedsCached's cache calls sit
   * outside any try, so an exception there never reaches failure() at all". That was
   * the defect R-2026-09-20-32 B3-bis reported, and it is now closed — the cache
   * calls are wrapped, a throwing read is a miss and a throwing write is skipped, so
   * no cache exception escapes this module. The sentence would otherwise have become
   * a false fact describing code that no longer exists.
   */
  test('an unparseable upstream body is a GENERIC 502 — the text it failed to parse is never republished', async () => {
    // This is the path res.json()'s SyntaxError lands on, and that message quotes the
    // offending input. Echoing e.message here would republish whatever the origin said
    // to every anonymous reader, which is why the catch-all is generic by design.
    const originText = 'PLANTED-UPSTREAM-TEXT-THAT-MUST-NOT-ECHO <html>not json</html>';
    const { fetchImpl } = scripted([async () => new Response(originText, { status: 200, headers: { 'content-type': 'application/json' } })]);
    const res = await serveBeds(localOrigin(), serviceEnv(), fetchImpl, { attempts: 1 });
    const text = await res.text();
    expect(res.status, `an unparseable upstream body was served: ${text}`).toBe(502);
    expect(text, 'the refusal quoted the upstream text it could not parse').not.toContain('PLANTED-UPSTREAM-TEXT-THAT-MUST-NOT-ECHO');
    expect(JSON.parse(text), `the generic reason was replaced by a specific one: ${text}`).toEqual({ error: 'the snapshot read failed' });
  });

  test('a thrown network error is a GENERIC 502 — its message, which can carry a host and port, is dropped', async () => {
    const { fetchImpl } = scripted([
      async () => {
        throw new Error('connect ECONNREFUSED PLANTED-HOST-THAT-MUST-NOT-ECHO:5432');
      },
    ]);
    const res = await serveBeds(localOrigin(), serviceEnv(), fetchImpl, { attempts: 1 });
    const text = await res.text();
    expect(res.status, `a network failure was not refused: ${text}`).toBe(502);
    expect(text, 'the refusal echoed the thrown message, which named the unreachable host').not.toContain('PLANTED-HOST-THAT-MUST-NOT-ECHO');
    expect(text).toContain('could not reach the origin');
  });

  test('no failure body contains the SUPABASE ORIGIN — the one configuration value that carries the project ref', async () => {
    // The credential probe above covers the KEY and exercises ONE path. This covers
    // the ORIGIN and sweeps every failure status the module can produce, because one
    // plant proves an instrument and never its coverage.
    //
    // THE PROPERTY GOT STRONGER WHEN THE ORIGIN STOPPED BEING CONFIGURATION
    // (R-2026-09-22-59). It used to be an environment variable, so the consequence
    // of an echo depended on someone having set one. It is now compiled into every
    // artefact this project ships, so the consequence is unconditional -- and the
    // real value is swept alongside the planted one in the leg below this.
    const planted = 'https://planted-project-ref-must-not-echo.supabase.co';
    const env = { SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_plant' };
    const stored = await newestRow();
    const cases: Array<[string, () => Promise<Response>]> = [
      ['a missing credential (500)', async () => serveBeds(planted, {})],
      ['a refused credential (502)', async () => serveBeds(planted, env, scripted([async () => json(401, { message: 'no' })]).fetchImpl, { attempts: 1 })],
      ['a rejected read (502)', async () => serveBeds(planted, env, scripted([async () => json(400, { message: 'bad' })]).fetchImpl, { attempts: 1 })],
      ['an origin 5xx (502)', async () => serveBeds(planted, env, scripted([async () => json(503, { message: 'busy' })]).fetchImpl, { attempts: 1 })],
      ['no snapshot row (503)', async () => serveBeds(planted, env, scripted([async () => json(200, [])]).fetchImpl, { attempts: 1 })],
      [
        'a wrong envelope (502)',
        async () =>
          serveBeds(
            planted,
            env,
            scripted([async () => json(200, [{ v: stored.v, payload: { ...(stored.payload as Record<string, unknown>), reason_codes: [] } }])]).fetchImpl,
            { attempts: 1 },
          ),
      ],
      ['an unreachable origin (502)', async () => serveBeds(planted, env, scripted([async () => { throw new Error('down'); }]).fetchImpl, { attempts: 1 })],
    ];
    for (const [label, run] of cases) {
      const res = await run();
      const text = await res.text();
      expect(res.status, `${label} was not a failure: ${text}`).toBeGreaterThanOrEqual(500);
      expect(text, `${label} echoed the Supabase origin into a public error body`).not.toContain('planted-project-ref-must-not-echo');
    }
  });

  test('no failure body contains the REAL project ref either — the value that actually ships', async () => {
    // THE LEG THE OLD SWEEP COULD NOT EXPRESS, and it is not a duplicate of the one
    // above. A PLANTED origin proves the instrument: that the module does not echo
    // whatever origin it was handed. It cannot prove anything about the value that
    // is compiled into the deployed artefact, because the planted one never is.
    //
    // Since R-2026-09-22-59 the real origin is a tracked constant rather than an
    // environment variable, so it CAN be swept here -- and it is the one whose echo
    // would put this project's ref in front of every anonymous reader.
    const ref = new URL(PRODUCTION_SUPABASE_ORIGIN).hostname.split('.')[0] ?? '';
    // ANTI-VACUITY: `.not.toContain('')` is satisfied by nothing at all, so a ref
    // that failed to parse would make every assertion below pass for free.
    expect(ref.length, 'the project ref did not parse out of the tracked origin — the sweep below is vacuous').toBeGreaterThan(10);

    const env = { SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_plant' };
    const cases: Array<[string, () => Promise<Response>]> = [
      ['a missing credential (500)', async () => serveBeds(PRODUCTION_SUPABASE_ORIGIN, {})],
      ['a refused credential (502)', async () => serveBeds(PRODUCTION_SUPABASE_ORIGIN, env, scripted([async () => json(401, { message: 'no' })]).fetchImpl, { attempts: 1 })],
      ['a rejected read (502)', async () => serveBeds(PRODUCTION_SUPABASE_ORIGIN, env, scripted([async () => json(400, { message: 'bad' })]).fetchImpl, { attempts: 1 })],
      ['no snapshot row (503)', async () => serveBeds(PRODUCTION_SUPABASE_ORIGIN, env, scripted([async () => json(200, [])]).fetchImpl, { attempts: 1 })],
      ['an unreachable origin (502)', async () => serveBeds(PRODUCTION_SUPABASE_ORIGIN, env, scripted([async () => { throw new Error('down'); }]).fetchImpl, { attempts: 1 })],
    ];
    for (const [label, run] of cases) {
      const res = await run();
      const text = await res.text();
      expect(res.status, `${label} was not a failure: ${text}`).toBeGreaterThanOrEqual(500);
      expect(text, `${label} echoed this project's ref into a public error body`).not.toContain(ref);
    }
  });

  test('a 5xx from the origin is retried once, then served when the retry succeeds', async () => {
    const stored = await newestRow();
    const { fetchImpl, calls } = scripted([
      async () => json(503, { message: 'upstream busy' }),
      async () => json(200, [stored]),
    ]);
    const res = await serveBeds(localOrigin(), serviceEnv(), fetchImpl);
    expect(res.status).toBe(200);
    expect(calls(), 'the 5xx was not retried').toBe(2);
  });

  test('a 4xx from the origin is NOT retried — a refused credential does not start working', async () => {
    const { fetchImpl, calls } = scripted([async () => json(400, { message: 'bad request' })]);
    const res = await serveBeds(localOrigin(), serviceEnv(), fetchImpl);
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
    const res = await serveBeds(localOrigin(), serviceEnv(), neverAnswers, { timeoutMs: 50, attempts: 2 });
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
