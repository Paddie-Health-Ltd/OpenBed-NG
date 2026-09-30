import { describe, expect, test } from 'vitest';
import {
  HEALTH_HEADER,
  HEALTH_OUTGOING_CACHE_CONTROL,
  HEALTH_STORED_CACHE_CONTROL,
  serveHealthCached,
} from '../../packages/snapshot/src/health_serve.js';
import { EDGE_CACHE_HEADER, type EdgeCache } from '../../packages/snapshot/src/serve.js';
import { HEALTH_FAIL, HEALTH_OK, SNAPSHOT_JOB } from '../../packages/snapshot/src/health.js';
import * as adapter from '../../apps/public-dashboard/functions/api/health.js';

/**
 * THE HEALTH HANDLER (R-2026-09-29-173 EW-2 f, g), driven with an INJECTED fetch and an
 * injected cache, the way tests/db/beds_json_served.test.ts drives serveBedsCached. No
 * database and no network: it lives in `compliance`, which runs wholesale, because this
 * project needs nothing started (test-conventions.md §1).
 *
 * WHAT IS ASSERTED, and the plant that makes each real:
 *   - A PROBE RESULT GIVES 200 AND THE KEYWORD; a closed port gives 503 and the other one.
 *   - HEAD IS EXPORTED AND CARRIES THE MARKER ON A COLD CACHE. The fake cache below refuses
 *     to put a non-GET, as Cloudflare's does, so a handler that keyed on the incoming HEAD
 *     would throw here. Red first with the HEAD export removed.
 *   - THE KEY DROPS THE QUERY: ?a=1 and ?a=2 share one entry. Red first with the key built
 *     from the incoming request.
 *   - BOTH 200 AND 503 ARE STORED: after a failed probe, two calls within 30 seconds make
 *     ONE origin fetch. Red first with the store restricted to a 200.
 *   - THE STORED COPY says `public, s-maxage=30` with no stale-while-revalidate and no
 *     marker; the OUTGOING response says `no-store` and carries the marker.
 *   - EVERY FAILURE IS A 503: a 401, a 404, a non-JSON 200, a missing key, a timeout (inside
 *     one second, with the timeout injected), a request that throws when read.
 *
 * NOT ASSERTED HERE, deliberately: that Cloudflare's edge honours a stored 503, or that the
 * Cache API's real `put` accepts one. The fake implements the interface's method rule and
 * nothing else. What the deployed route does is the marker read by
 * scripts/readback_pages.sh, and nothing in the repository can read it before a deploy.
 */

// A local host on purpose: supabaseDirectOrigin then names the local stack, never the
// hosted project. The path is the route's.
const URL_OF = (q = ''): string => `http://127.0.0.1:8788/api/health${q}`;
const LOCAL_ORIGIN = 'http://127.0.0.1:54321';
const KEY = 'test-only-not-a-credential';

const SERVER_NOW = '2026-09-30T04:00:00.000+00:00';
const FRESH = {
  server_now: SERVER_NOW,
  generated_at: '2026-09-30T03:59:30.000+00:00',
  last_snapshot_at: '2026-09-30T03:59:30.000+00:00',
  jobs: [{ name: SNAPSHOT_JOB, active: true, last_status: 'succeeded', last_start_time: '2026-09-30T03:59:00.000+00:00' }],
};

/** Cloudflare's Cache API rule that matters here: put throws for any non-GET key. */
function fakeCache(): EdgeCache & { store: Map<string, Response>; puts: number; matches: number } {
  const store = new Map<string, Response>();
  return {
    store,
    puts: 0,
    matches: 0,
    async match(request, options) {
      this.matches += 1;
      if (request.method !== 'GET' && !options?.ignoreMethod) return undefined;
      const hit = store.get(request.url);
      return hit ? hit.clone() : undefined;
    },
    async put(request, response) {
      if (request.method !== 'GET') throw new TypeError('Cannot cache response to non-GET request.');
      this.puts += 1;
      store.set(request.url, response.clone());
    },
  };
}

interface Call {
  url: string;
  method: string | undefined;
  headers: Record<string, string> | undefined;
  body: string | undefined;
}
type Init = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal };
function scripted(answer: (call: Call, init: Init | undefined) => Promise<Response>): {
  calls: Call[];
  fetchImpl: (input: string, init?: Init) => Promise<Response>;
} {
  const calls: Call[] = [];
  return {
    calls,
    fetchImpl: (input, init) => {
      const call = { url: input, method: init?.method, headers: init?.headers, body: init?.body };
      calls.push(call);
      return answer(call, init);
    },
  };
}
const ok = (): Promise<Response> => Promise.resolve(Response.json(FRESH));
const closedPort = (): Promise<Response> => Promise.reject(new TypeError('fetch failed'));

function ctx(request: Request, env: { SUPABASE_SERVICE_ROLE_KEY?: string } = { SUPABASE_SERVICE_ROLE_KEY: KEY }) {
  return { env, request };
}
const get = (q = ''): Request => new Request(URL_OF(q), { method: 'GET' });
const head = (q = ''): Request => new Request(URL_OF(q), { method: 'HEAD' });

describe('the health handler answers from one probe', () => {
  test('a probe result gives 200, the keyword and the ruled headers', async () => {
    const { fetchImpl, calls } = scripted(ok);
    const res = await serveHealthCached(ctx(get()), undefined, fetchImpl);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; health: string; reasons: string[]; job: { name: string } };
    expect(body).toMatchObject({ ok: true, health: HEALTH_OK, reasons: [] });
    expect(body.job.name).toBe(SNAPSHOT_JOB);
    expect(res.headers.get(HEALTH_HEADER)).toBe('ok');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe(HEALTH_OUTGOING_CACHE_CONTROL);
    expect(res.headers.get(EDGE_CACHE_HEADER)).toBe('unavailable');
    expect(calls).toHaveLength(1);
  });

  test('the probe is ONE POST to the direct origin, with the service key and an empty body', async () => {
    const { fetchImpl, calls } = scripted(ok);
    await serveHealthCached(ctx(get()), undefined, fetchImpl);
    expect(calls[0]?.url).toBe(`${LOCAL_ORIGIN}/rest/v1/rpc/health_probe`);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toBe('{}');
    expect(calls[0]?.headers?.apikey).toBe(KEY);
    expect(calls[0]?.headers?.['content-type']).toBe('application/json');
  });

  test('a closed port gives 503, the other keyword and the fail marker', async () => {
    const { fetchImpl } = scripted(closedPort);
    const res = await serveHealthCached(ctx(get()), undefined, fetchImpl);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { health: string; reasons: string[] };
    expect(body).toMatchObject({ health: HEALTH_FAIL, reasons: ['probe_failed'] });
    expect(res.headers.get(HEALTH_HEADER)).toBe('fail');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  test.each([
    ['401', () => Promise.resolve(new Response('{"message":"Invalid API key"}', { status: 401 }))],
    ['404', () => Promise.resolve(new Response('{"code":"PGRST202"}', { status: 404 }))],
    ['a 200 that is not JSON', () => Promise.resolve(new Response('<html>not json</html>', { status: 200 }))],
    ['a 200 holding an empty array', () => Promise.resolve(Response.json([]))],
    ['a 200 holding null', () => Promise.resolve(Response.json(null))],
  ])('plant — an origin answering %s is a 503 probe_failed', async (_label, answer) => {
    const { fetchImpl } = scripted(answer);
    const res = await serveHealthCached(ctx(get()), undefined, fetchImpl);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { reasons: string[] }).reasons).toEqual(['probe_failed']);
  });

  test('plant — a missing service key is a 503 probe_failed and makes NO origin call', async () => {
    const { fetchImpl, calls } = scripted(ok);
    const res = await serveHealthCached(ctx(get(), {}), undefined, fetchImpl);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { reasons: string[] }).reasons).toEqual(['probe_failed']);
    expect(calls).toHaveLength(0);
  });

  test('plant — a probe that never answers is a 503 inside one second, with the timeout injected', async () => {
    // Resolves never; rejects the way AbortSignal.timeout does once the signal fires.
    const { fetchImpl } = scripted(
      (_call, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const started = performance.now();
    const res = await serveHealthCached(ctx(get()), undefined, fetchImpl, { timeoutMs: 50 });
    const elapsed = performance.now() - started;
    expect(res.status).toBe(503);
    expect(((await res.json()) as { reasons: string[] }).reasons).toEqual(['probe_failed']);
    expect(elapsed, `the timeout took ${elapsed} ms`).toBeLessThan(1000);
  });

  test('plant — a request that throws when read is still answered, as a 503 probe_failed', async () => {
    const hostile = { method: 'GET' } as unknown as Request;
    Object.defineProperty(hostile, 'url', {
      get() {
        throw new Error('planted: the url is unreadable');
      },
    });
    const { fetchImpl } = scripted(ok);
    const res = await serveHealthCached({ env: { SUPABASE_SERVICE_ROLE_KEY: KEY }, request: hostile }, fakeCache(), fetchImpl);
    expect(res.status).toBe(503);
    expect(res.headers.get(HEALTH_HEADER)).toBe('fail');
    expect(((await res.json()) as { reasons: string[] }).reasons).toEqual(['probe_failed']);
  });
});

describe('the health handler answers HEAD as it answers GET', () => {
  test('HEAD on a cold cache carries the marker, the health header and no body', async () => {
    const cache = fakeCache();
    const { fetchImpl, calls } = scripted(ok);
    const res = await serveHealthCached(ctx(head()), cache, fetchImpl);
    expect(res.status).toBe(200);
    expect(res.headers.get(HEALTH_HEADER)).toBe('ok');
    expect(res.headers.get(EDGE_CACHE_HEADER)).toBe('miss');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('');
    expect(calls).toHaveLength(1);
    expect(cache.puts, 'a HEAD must still populate the entry, under a GET key').toBe(1);
  });

  test('the Pages adapter exports HEAD as well as GET, and they are the same handler', () => {
    expect(typeof adapter.onRequestGet).toBe('function');
    expect(typeof adapter.onRequestHead).toBe('function');
    expect(adapter.onRequestHead).toBe(adapter.onRequestGet);
  });

  test('GET and HEAD share one entry', async () => {
    const cache = fakeCache();
    const { fetchImpl, calls } = scripted(ok);
    await serveHealthCached(ctx(head()), cache, fetchImpl);
    const res = await serveHealthCached(ctx(get()), cache, fetchImpl);
    expect(res.headers.get(EDGE_CACHE_HEADER)).toBe('hit');
    expect(((await res.json()) as { health: string }).health).toBe(HEALTH_OK);
    expect(calls).toHaveLength(1);
  });
});

describe('the health handler caches BOTH answers, for thirty seconds, on a key with no query', () => {
  test('?a=1 and ?a=2 share one entry: a flood of query strings makes one origin call', async () => {
    const cache = fakeCache();
    const { fetchImpl, calls } = scripted(ok);
    const first = await serveHealthCached(ctx(get('?a=1')), cache, fetchImpl);
    const second = await serveHealthCached(ctx(get('?a=2')), cache, fetchImpl);
    const third = await serveHealthCached(ctx(get()), cache, fetchImpl);
    expect(first.headers.get(EDGE_CACHE_HEADER)).toBe('miss');
    expect(second.headers.get(EDGE_CACHE_HEADER)).toBe('hit');
    expect(third.headers.get(EDGE_CACHE_HEADER)).toBe('hit');
    expect(calls).toHaveLength(1);
    expect([...cache.store.keys()]).toEqual([URL_OF()]);
  });

  test('two calls within 30 seconds after a FAILED probe make ONE origin fetch', async () => {
    const cache = fakeCache();
    const { fetchImpl, calls } = scripted(closedPort);
    const first = await serveHealthCached(ctx(get()), cache, fetchImpl);
    const second = await serveHealthCached(ctx(get()), cache, fetchImpl);
    expect(first.status).toBe(503);
    expect(second.status, 'the second answer is the stored 503').toBe(503);
    expect(second.headers.get(EDGE_CACHE_HEADER)).toBe('hit');
    expect(second.headers.get(HEALTH_HEADER)).toBe('fail');
    expect(calls).toHaveLength(1);
  });

  test('a 200 is stored too, and served as a hit', async () => {
    const cache = fakeCache();
    const { fetchImpl, calls } = scripted(ok);
    await serveHealthCached(ctx(get()), cache, fetchImpl);
    const second = await serveHealthCached(ctx(get()), cache, fetchImpl);
    expect(second.status).toBe(200);
    expect(second.headers.get(EDGE_CACHE_HEADER)).toBe('hit');
    expect(calls).toHaveLength(1);
  });

  test.each([
    ['a 200', ok, 200],
    ['a 503', closedPort, 503],
  ])('the STORED copy of %s says public, s-maxage=30, no stale-while-revalidate and carries no marker', async (_label, answer, status) => {
    const cache = fakeCache();
    const { fetchImpl } = scripted(answer);
    const out = await serveHealthCached(ctx(get()), cache, fetchImpl);
    const stored = cache.store.get(URL_OF());
    expect(stored?.status).toBe(status);
    expect(stored?.headers.get('cache-control')).toBe(HEALTH_STORED_CACHE_CONTROL);
    expect(stored?.headers.get('cache-control')).toBe('public, s-maxage=30');
    expect(stored?.headers.get('cache-control')).not.toContain('stale-while-revalidate');
    expect(stored?.headers.has(EDGE_CACHE_HEADER), 'a marker was STORED: a later hit would carry an earlier request\'s state').toBe(false);
    expect(out.headers.get('cache-control')).toBe('no-store');
    expect(out.headers.get(EDGE_CACHE_HEADER)).toBe('miss');
  });

  test('a cache read that throws is a read-error marker, and the origin is still asked', async () => {
    const cache = fakeCache();
    cache.match = () => Promise.reject(new Error('planted: the read failed'));
    const { fetchImpl, calls } = scripted(ok);
    const res = await serveHealthCached(ctx(get()), cache, fetchImpl);
    expect(res.status).toBe(200);
    expect(res.headers.get(EDGE_CACHE_HEADER)).toBe('read-error');
    expect(calls).toHaveLength(1);
  });

  test('a cache write that throws costs the hit and nothing else', async () => {
    const cache = fakeCache();
    cache.put = () => Promise.reject(new Error('planted: the write failed'));
    const { fetchImpl } = scripted(ok);
    const res = await serveHealthCached(ctx(get()), cache, fetchImpl);
    expect(res.status).toBe(200);
  });
});
