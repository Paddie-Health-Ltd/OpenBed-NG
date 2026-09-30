/**
 * THE HEALTH ENDPOINT'S HANDLER: one probe, one decision, one cache (R-2026-09-29-173
 * EW-2). The decision is health.ts and is pure; this file is everything that touches the
 * network or the edge cache, so tests can drive it with an injected fetch and cache the
 * way tests/db/beds_json_served.test.ts drives serveBedsCached.
 *
 * THE ORIGIN IS THE DIRECT ONE, BY NAME. Like /beds.json, this route reads Supabase
 * without the Worker proxy (R-2026-09-22-58 A, extended to this route by EW-2 a), because
 * a health check that rode the proxy would report the proxy's health, not the
 * scheduler's. The exception is named in packages/origins, in its origins.json `why`, and
 * in supabase-proxy/allow-list.json under direct_origin_exceptions, whose entry names THIS
 * file, because the one URL below lives here. The origin comes from the request's own
 * hostname through supabaseDirectOrigin, never from the environment.
 *
 * THE CALL. `public.health_probe()` over PostgREST as service_role, with the key the Pages
 * project already holds for /beds.json. It is the only service_role grant on a function
 * in this repository; it is read-only and triggers nothing (migration 027).
 *
 * THE CACHE differs from serveBedsCached on purpose:
 *   - BOTH 200 AND 503 ARE STORED, for 30 seconds. A 503 stored is what stops a monitor,
 *     a crawler or a flood from turning one dead database into one origin call per
 *     request. serveBedsCached stores a 200 only, because there a cached failure would
 *     keep serving a stale document; here the answer IS the status.
 *   - The stored copy carries `cache-control: public, s-maxage=30` and NO
 *     stale-while-revalidate (the Cache API does not honour it, and an alarm must not
 *     serve a stale answer on purpose).
 *   - The OUTGOING response carries `cache-control: no-store` and the marker
 *     `x-openbed-edge-cache`, set on the outgoing response only, so a stored copy can
 *     never carry a marker describing an earlier request.
 *   - THE KEY DROPS THE QUERY STRING: `new Request(new URL('/api/health', request.url),
 *     { method: 'GET' })`. A caller cannot mint a new entry per query string and reach
 *     the database each time, and it is a GET because the Cache API refuses to put a
 *     HEAD. The key is built from the parsed URL's origin, never from the incoming
 *     request, so GET and HEAD share one entry.
 * NOT ASSERTED HERE, deliberately: that Cloudflare's edge keeps a stored 503. The tests
 * prove this code stores and reads one through the Cache API's interface; whether the
 * platform honours it is read from the marker on the deployed route (scripts/readback_pages.sh
 * reads the route's status and marker, not the cache state).
 *
 * THE FAILURE MODES all answer 503 with the reason probe_failed: a missing key, a refusal,
 * a timeout (5 seconds, injectable), a body that is not the expected JSON, and anything
 * this function throws. A top-level catch answers it, so the endpoint cannot fail in a
 * way a keyword monitor would read as healthy.
 *
 * THE HEADERS on every response, GET and HEAD alike: `x-openbed-health: ok` or `fail`,
 * `x-robots-tag: noindex, nofollow` and `x-content-type-options: nosniff`, set here because
 * Pages does not apply an app's `_headers` file to a Function's response.
 *
 * This reads no clock: see health.ts.
 */
import { decideHealth, type HealthDecision, type ProbeInput } from './health.js';
import { EDGE_CACHE_HEADER, NOSNIFF, ROBOTS_TAG, authHeaders, type EdgeCache } from './serve.js';
import { supabaseDirectOrigin } from '../../origins/src/index.js';

/** The Function's environment: the one name, read server-side only. */
export interface HealthEnv {
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
}

export const HEALTH_HEADER = 'x-openbed-health';
export const HEALTH_STORED_CACHE_CONTROL = 'public, s-maxage=30';
export const HEALTH_OUTGOING_CACHE_CONTROL = 'no-store';
export const HEALTH_PROBE_TIMEOUT_MS = 5000;

type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Response>;

export type HealthCacheState = 'hit' | 'miss' | 'read-error' | 'unavailable';

/** One POST to the probe. Never throws: every failure is a value the decision reads. */
async function callProbe(
  origin: string,
  env: HealthEnv,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<ProbeInput> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { outcome: 'failed', why: 'missing_key' };
  const url = `${origin}/rest/v1/rpc/health_probe`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { ...authHeaders(key), 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as { name?: string }).name;
    return { outcome: 'failed', why: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
  }
  if (res.status !== 200) return { outcome: 'answered', status: res.status, body: null };
  try {
    return { outcome: 'answered', status: res.status, body: (await res.json()) as unknown };
  } catch {
    return { outcome: 'failed', why: 'non_json' };
  }
}

function buildResponse(d: HealthDecision, cacheControl: string): Response {
  return new Response(JSON.stringify(d.body), {
    status: d.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      [HEALTH_HEADER]: d.ok ? 'ok' : 'fail',
      'x-robots-tag': ROBOTS_TAG,
      'x-content-type-options': NOSNIFF,
    },
  });
}

export async function serveHealthCached(
  ctx: { env: HealthEnv; request: Request; waitUntil?: (p: Promise<unknown>) => void },
  cache: EdgeCache | undefined,
  fetchImpl: FetchLike = fetch,
  opts: { timeoutMs?: number } = {},
): Promise<Response> {
  try {
    // THE KEY IS A GET ON THE ROUTE'S OWN PATH: no query, and no method from the wire.
    const key = new Request(new URL('/api/health', ctx.request.url), { method: 'GET' });

    // What is RETURNED: HEAD gets no body, and every response is no-store with the marker
    // for THIS request. What is STORED is never passed through here.
    const asRequested = (r: Response, state: HealthCacheState): Response => {
      const out = new Response(ctx.request.method === 'HEAD' ? null : r.body, {
        status: r.status,
        statusText: r.statusText,
        headers: r.headers,
      });
      out.headers.set('cache-control', HEALTH_OUTGOING_CACHE_CONTROL);
      out.headers.set(EDGE_CACHE_HEADER, state);
      return out;
    };

    let readThrew = false;
    if (cache) {
      // ONLY THE CACHE CALL IS INSIDE THIS TRY, and it must stay that way: a catch
      // spanning the probe would turn a real failure into a cache miss.
      try {
        const hit = await cache.match(key, { ignoreMethod: true });
        if (hit) return asRequested(hit, 'hit');
      } catch (e) {
        console.error('health: the edge cache read failed; treating it as a miss', e);
        readThrew = true;
      }
    }

    // THE ORIGIN IS CHOSEN FROM THE REQUEST THIS FUNCTION WAS SERVED, as /beds.json's is.
    const probe = await callProbe(
      supabaseDirectOrigin(new URL(ctx.request.url).hostname),
      ctx.env,
      fetchImpl,
      opts.timeoutMs ?? HEALTH_PROBE_TIMEOUT_MS,
    );
    const decision = decideHealth(probe);

    if (cache) {
      // Both statuses are stored. A write that throws costs the cache hit and nothing
      // else; the rejection is handled on the promise because on the waitUntil path
      // nothing awaits it here.
      try {
        const stored = cache.put(key, buildResponse(decision, HEALTH_STORED_CACHE_CONTROL)).catch((e: unknown) => {
          console.error('health: the edge cache write failed; serving the answer uncached', e);
        });
        if (ctx.waitUntil) ctx.waitUntil(stored);
        else await stored;
      } catch (e) {
        console.error('health: the edge cache write threw; serving the answer uncached', e);
      }
    }

    const state: HealthCacheState = cache === undefined ? 'unavailable' : readThrew ? 'read-error' : 'miss';
    return asRequested(buildResponse(decision, HEALTH_OUTGOING_CACHE_CONTROL), state);
  } catch (e) {
    // Nothing above should throw. If it does, the answer is still a 503 that names the
    // probe, never an unhandled error a keyword monitor could mistake for silence.
    console.error('health: an unexpected error; answering probe_failed', e);
    const d = decideHealth({ outcome: 'failed', why: 'network' });
    const out = buildResponse(d, HEALTH_OUTGOING_CACHE_CONTROL);
    out.headers.set(EDGE_CACHE_HEADER, 'unavailable');
    return out;
  }
}
