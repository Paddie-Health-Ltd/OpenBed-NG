/**
 * THE SERVING LEG — what `GET /beds.json` returns. A1 sprint, Bundle 1.
 *
 * A1 ruled that public reads come from a static snapshot behind a CDN, not from
 * PostgREST. Migrations 016 and 017 build and schedule the snapshot, but
 * `public.snapshot_current` is service_role-only and nothing published it. This
 * module is the read that publishes it: one row, the newest `v`, served with
 * cache headers so the edge collapses public traffic to roughly one origin read
 * per `s-maxage`.
 *
 * WHY IT LIVES HERE AND NOT IN THE FUNCTION FILE. The Pages Function at
 * apps/public-dashboard/functions/beds.json.ts is a two-line adapter. Everything
 * that decides what anon receives is in this file, which the root type-check
 * covers and which tests/db/beds_json_served.test.ts drives against the real
 * local PostgREST. A handler that could only be exercised under wrangler would be
 * a control that is only ever run by hand.
 *
 * THE CREDENTIAL. The Function reads `SUPABASE_SERVICE_ROLE_KEY` from its own
 * environment. It is the first server-side credential in this project. It is
 * NEVER a `VITE_`-prefixed variable -- Vite inlines those into the browser bundle
 * -- and this module never echoes it, logs it or returns it: every error path
 * names the variable, never its value.
 *
 * WHAT IS REFUSED RATHER THAN SERVED. Each of these would otherwise reach the
 * edge as a 200 and be cached for 30 seconds:
 *   - no snapshot row (a fresh or reset project)          -> 503, no-store
 *   - a payload whose envelope or row arity does not match
 *     packages/fixtures/snapshot-shape.json               -> 502, no-store
 *   - the origin unreachable, timing out, or answering 5xx -> 504/502, no-store
 *   - the origin refusing the credential (401/403)        -> 502, no-store
 * A failure is never cached, so the next request retries the origin rather than
 * serving the failure for the life of `s-maxage`.
 *
 * THE FIFTH OUTCOME, AND WHY THE LIST NO LONGER NEEDS IT. An exception raised by
 * the edge cache itself was neither served nor refused: serveBedsCached's cache
 * calls sat outside any try, so it escaped failure() and reached the client as an
 * unhandled Function exception carrying none of the headers above -- no
 * X-Robots-Tag, no no-store. That is the defect R-2026-09-20-32 B3-bis reported
 * and R-2026-09-20-33 ruled. It is closed below: a cache read that throws is a
 * miss, a cache write that throws is skipped, and either way the response served
 * is the one this module built. The outcome stops existing rather than joining
 * the list.
 *
 * WHAT THIS DOES NOT DO, by ruling. It does not rate-limit. The Cloudflare Rate
 * Limiting binding is a Workers feature and is absent from the Pages Functions
 * binding list (R-2026-09-17-12); the limit is a founder-configured zone WAF
 * rule, recorded OWED in docs/runbook-cloudflare-pages-beds-json.md.
 *
 * NO WALL CLOCK -- BY CONSTRUCTION, NOT BY ENFORCEMENT. Freshness comes from the
 * payload's own `server_now`; this module reads no clock, and its timeout is an
 * AbortSignal, not a timestamp comparison.
 *
 * THIS PARAGRAPH USED TO CLAIM THIS DIRECTORY WAS "inside the ESLint Date ban
 * (finding F3)". THERE IS NO SUCH RULE, and the claim is corrected here rather
 * than left standing (Clause 4, discharge route 2 -- the weaker form the repo can
 * actually execute). eslint.config.mjs carries only the F2 duty-flag block; the
 * one F3 control that is a Date ban lives in tests/compliance/freshness_bands.test.ts
 * and is a regex over freshness.ts ALONE -- that file also reads anchor.ts, but for
 * an annotation count, which is not a clock check -- so nothing reaches this file;
 * and the rule itself
 * is specified-and-unbuilt in
 * Sprint Kickoffs/sprint-kickoff-bedspace-v2-2026-09-10.md. A `Date.now()` added
 * to this file today would pass lint, CI and every compliance test. Building the
 * guard is an open item with a trigger, not this change.
 */
import { decodeFacility, decodeWard } from './codec.js';
import shape from '../../fixtures/snapshot-shape.json';

/** The Function's environment. Both names are read server-side only. */
export interface BedsEnv {
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_SERVICE_ROLE_KEY?: string;
}

/**
 * v1's Bundle 4 snapshot task and the snapshot shape fixture's `pollCadenceSeconds`
 * are both written against `s-maxage=30`. Changing one without the other makes
 * the poll cadence and the cache disagree about how stale a document may be.
 */
export const CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=300';
export const FAILURE_CACHE_CONTROL = 'no-store';

/**
 * X-Robots-Tag, as an HTTP HEADER, because nothing else reaches this document
 * (R-2026-09-20-29 F).
 *
 * The dashboard's `noindex` meta tag covers its HTML page and CANNOT cover a JSON
 * response -- there is nowhere in JSON to put a meta tag. Without this header the
 * only instruction a crawler has about /beds.json is the site's robots.txt, and
 * before 2026-09-20 that path returned the SPA's HTML with a 200, which tells a
 * crawler nothing at all.
 *
 * WHY IT IS NOT MERELY ABOUT SEARCH RESULTS. This document is a public snapshot of
 * bed state. Fetched politely once a minute by an archive service, it becomes,
 * over months, exactly the time series this design forbids: built from legitimate
 * reads, never tripping a rate limit that counts over ten seconds, and untouched by
 * migration 018, whose revoke does not govern this route.
 *
 * NOT ASSERTED HERE, deliberately: that this stops anyone. It governs WELL-BEHAVED
 * crawlers. A determined collector ignores it, and this is not a substitute for
 * Bundle 2's revoke.
 */
export const ROBOTS_TAG = 'noindex, nofollow';

/** The upstream read's bounds. The pipeline caps an external call at 12s. */
export const UPSTREAM_TIMEOUT_MS = 8000;
export const UPSTREAM_ATTEMPTS = 2;

export interface SnapshotRow {
  readonly v: number;
  readonly payload: unknown;
}

type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

/**
 * THE HEADERS DEPEND ON WHICH FAMILY THE KEY BELONGS TO, and neither scheme is
 * right for both. Observed on the local stack, 2026-09-18:
 *
 *   legacy JWT service key, `apikey` only           -> 401, runs as ANON
 *   legacy JWT service key, `apikey` + Bearer       -> 200
 *   new `sb_secret_` key,   `apikey` only           -> 200
 *
 * Supabase's API-keys guide says of the new family: "Send publishable and secret
 * keys on the `apikey` header, not on `Authorization: Bearer`. Because the keys
 * aren't JWTs, anything that tries to verify one as a JWT fails." The local stack
 * happens to accept an sb_secret_ key as Bearer too, so a local green cannot tell
 * the two schemes apart -- which is exactly why this follows each family's
 * documented rule rather than whatever local tolerates.
 *
 * This project DISABLED its legacy keys, so hosted runs the sb_secret_ path.
 * Its end-to-end proof is the edge-headers step of docs/runbook-cloudflare-pages-beds-json.md.
 */
export function authHeaders(key: string): Record<string, string> {
  return key.startsWith('sb_secret_')
    ? { apikey: key, accept: 'application/json' }
    : { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' };
}

function failure(status: number, reason: string): Response {
  return new Response(JSON.stringify({ error: reason }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': FAILURE_CACHE_CONTROL,
      'x-robots-tag': ROBOTS_TAG,
    },
  });
}

/**
 * The document's shape, checked against the frozen fixture before it is served.
 * Returns a list of problems; empty means servable.
 *
 * Envelope keys are compared as a SET against `envelope` -- parsed identity, not a
 * count. Every row is decoded through the codec, which throws on a wrong arity:
 * a positional payload with an extra value decodes into the wrong columns, and a
 * column appended by the generator would otherwise ship silently.
 */
export function payloadProblems(payload: unknown): string[] {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['payload is not a JSON object'];
  }
  const doc = payload as Record<string, unknown>;
  const problems: string[] = [];

  const expected = [...shape.envelope].sort();
  const actual = Object.keys(doc).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    problems.push(`envelope is ${JSON.stringify(actual)}, the fixture's is ${JSON.stringify(expected)}`);
  }

  const rows: Array<[string, (r: readonly unknown[]) => unknown]> = [
    ['wards', decodeWard],
    ['facilities', decodeFacility],
  ];
  for (const [key, decode] of rows) {
    const list = doc[key];
    if (!Array.isArray(list)) {
      problems.push(`${key} is not an array`);
      continue;
    }
    list.forEach((row, i) => {
      if (!Array.isArray(row)) {
        problems.push(`${key}[${i}] is not an array`);
        return;
      }
      try {
        decode(row);
      } catch (e) {
        problems.push(`${key}[${i}]: ${(e as Error).message}`);
      }
    });
  }
  return problems;
}

/** Builds the response for a row that has already been read. Pure. */
export function buildBedsResponse(row: SnapshotRow | null): Response {
  if (row === null) {
    return failure(503, 'no snapshot has been generated yet');
  }
  const problems = payloadProblems(row.payload);
  if (problems.length > 0) {
    return failure(502, `snapshot payload does not match the frozen shape: ${problems.slice(0, 3).join('; ')}`);
  }
  return new Response(JSON.stringify(row.payload), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': CACHE_CONTROL,
      'x-robots-tag': ROBOTS_TAG,
    },
  });
}

class UpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Reads the newest snapshot row as service_role. Bounded: a timeout per attempt,
 * at most UPSTREAM_ATTEMPTS attempts, jittered backoff between them, and no
 * retry on a 4xx -- a refused credential will not start working on the second
 * try, and retrying it only delays the loud failure.
 */
export async function fetchNewestSnapshot(
  env: BedsEnv,
  fetchImpl: FetchLike = fetch,
  opts: { timeoutMs?: number; attempts?: number } = {},
): Promise<SnapshotRow | null> {
  const timeoutMs = opts.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const attempts = opts.attempts ?? UPSTREAM_ATTEMPTS;
  const url = `${env.SUPABASE_URL}/rest/v1/snapshot_current?select=v,payload&order=v.desc&limit=1`;
  const key = env.SUPABASE_SERVICE_ROLE_KEY as string;

  const backoff = (): Promise<void> => new Promise((r) => setTimeout(r, 150 + Math.floor(Math.random() * 150)));

  // Three outcomes per attempt, each with one path:
  //   network error or timeout -> retryable
  //   5xx                      -> retryable
  //   4xx                      -> NOT retryable; thrown at once
  let last: UpstreamError | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: authHeaders(key), signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const name = (e as { name?: string }).name;
      last =
        name === 'TimeoutError' || name === 'AbortError'
          ? new UpstreamError(504, `the snapshot read timed out after ${attempt} attempt(s) of ${timeoutMs}ms`)
          : new UpstreamError(502, `the snapshot read could not reach the origin after ${attempt} attempt(s)`);
      if (attempt < attempts) await backoff();
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      throw new UpstreamError(502, `the origin refused the service-role credential (HTTP ${res.status})`);
    }
    if (res.status >= 400 && res.status < 500) {
      throw new UpstreamError(502, `the origin rejected the snapshot read (HTTP ${res.status})`);
    }
    if (res.status >= 500) {
      last = new UpstreamError(502, `the origin failed the snapshot read (HTTP ${res.status}) after ${attempt} attempt(s)`);
      if (attempt < attempts) await backoff();
      continue;
    }

    const rows = (await res.json()) as SnapshotRow[];
    return Array.isArray(rows) && rows.length > 0 ? (rows[0] as SnapshotRow) : null;
  }
  throw last ?? new UpstreamError(502, 'the snapshot read made no attempt');
}

/**
 * THE EDGE CACHE IS EXPLICIT, BECAUSE A FUNCTION'S RESPONSE IS NOT CACHED FROM ITS
 * HEADERS ALONE. A Pages Function is a Worker, and Cloudflare caches a Worker's
 * own response only through the Cache API (`cache.put`) -- setting
 * `Cache-Control: s-maxage=30` on it does not by itself put it in the CDN cache.
 * Without this, every request would run the Function and read Supabase, which is
 * the opposite of A1's cost argument: roughly one origin read per s-maxage.
 *
 * What that buys, and what it does not, stated so the runbook can check it:
 *   - It is PER DATA CENTRE. The Cache API does not use Tiered Cache, so it is
 *     roughly one origin read per s-maxage per location, not globally. Two
 *     requests that land in different locations can both miss without anything
 *     being wrong, which is why the runbook's step re-runs rather than failing.
 *   - It does NOT honour `stale-while-revalidate`. Cloudflare's Cache API
 *     reference states that `stale-while-revalidate` and `stale-if-error` "are
 *     not supported when using the `cache.put` or `cache.match` methods". The
 *     header is still correct to send -- browsers and any downstream cache honour
 *     it -- but it buys nothing HERE. Until 2026-09-21 this line read "NOT
 *     verified"; it is now answered, and answered against what we assumed.
 *   - IT IS NOT LIMITED TO A CUSTOM DOMAIN, and the claim that it was is
 *     CORRECTED HERE RATHER THAN QUIETLY DROPPED (R-2026-09-21-42). This comment
 *     read "It works ONLY on a custom domain ... Cache API operations on
 *     *.workers.dev deployments have no effect". That is a WORKERS fact, and a
 *     Pages Function on *.pages.dev is not a Worker on *.workers.dev. The same
 *     reference paragraph says so explicitly: "Workers deployed to custom domains
 *     have access to functional `cache` operations. So do Pages functions,
 *     whether attached to custom domains or `*.pages.dev` domains." The runbook's
 *     cache step still runs on openbed.ng, because the EVIDENCE gate is worded
 *     that way -- but NOT for the reason this comment used to give.
 * Only a 200 is ever stored. A failure is `no-store` and is never put in the
 * cache, so the next request retries the origin.
 *
 * AND NONE OF IT WAS OBSERVABLE UNTIL THIS HEADER EXISTED. `cf-cache-status`
 * reports the ZONE CDN's decision, which is a different cache: the reference calls
 * the two mechanisms "independent". For a `.json` path with no Cache Rule that
 * decision is `DYNAMIC` on every single request -- measured on openbed.ng on
 * 2026-09-21, twice, with the Function's cache in an unknown state. A value that is
 * identical whether this code hit or missed cannot be a stop condition, so the
 * runbook's cache step could never pass. `x-openbed-edge-cache` is what this
 * function actually did, on this request.
 */
export const EDGE_CACHE_HEADER = 'x-openbed-edge-cache';

/**
 * The CLOSED set of values `x-openbed-edge-cache` may take. Closed so the runbook
 * can name an exact string, and so a value outside it is a test failure rather than
 * a line nobody notices.
 *
 * Evaluated in a fixed precedence -- unavailable, read-error, hit, nostore, miss --
 * so the state is a total function of what happened, never a coincidence of branch
 * order:
 *   - `unavailable` -- no cache object in this environment. Nothing was read or
 *     written. Reachable in the node test process and in Cloudflare's dashboard
 *     editor and Playground; NOT expected at the edge.
 *   - `read-error`  -- the cache read THREW. Served from the origin. Ranked above
 *     miss/nostore because a cache that throws is the more informative fault.
 *   - `hit`         -- the cache returned an entry and this response IS that entry.
 *     serveBeds was not called and the origin was not read. THIS is the criterion.
 *   - `nostore`     -- origin read, and the response was deliberately not stored
 *     because it is not a 200. Every failure() carries this.
 *   - `miss`        -- origin read, a 200, and a store was ATTEMPTED.
 *
 * `miss` DOES NOT CLAIM THE STORE SUCCEEDED, and the distinction is the whole
 * discipline: on the waitUntil path nothing awaits the put, so the outcome is not
 * knowable when this response is built. Asserting it would be a Clause 5 defect
 * inside the fix for one. The log line is what reports a write that failed.
 */
export type EdgeCacheState = 'hit' | 'miss' | 'nostore' | 'read-error' | 'unavailable';

/**
 * The cause that goes in the log beside the state. Each string says what was
 * OBSERVED, never what is presumed to follow from it -- `miss` in particular says
 * a write was attempted and stops there.
 */
const EDGE_CACHE_CAUSE: Readonly<Record<EdgeCacheState, string>> = {
  hit: 'served from the edge cache, the origin was not read',
  miss: 'not in the edge cache; read the origin and attempted a write (the write may still fail, and logs above say so if it did)',
  nostore: 'not a 200, so deliberately not stored; the next request retries the origin',
  'read-error': 'the edge cache read threw, so the origin was read; see the error logged above',
  unavailable: 'no edge cache in this environment, so nothing was read or written',
};

export interface EdgeCache {
  match(request: Request, options?: { ignoreMethod?: boolean }): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export async function serveBedsCached(
  ctx: { env: BedsEnv; request: Request; waitUntil?: (p: Promise<unknown>) => void },
  cache: EdgeCache | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  /*
   * THE KEY IS ALWAYS A GET, WHATEVER METHOD ARRIVED ON THE WIRE.
   *
   * Cloudflare's Cache API reference states that `cache.put` THROWS for a request
   * whose method is anything other than GET. Keying on `ctx.request` therefore
   * made a HEAD throw on every single request once HEAD started reaching this
   * function -- routinely, into the catch below, which exists for the rare case.
   * An exception log that fires on ordinary traffic is how the genuinely unusual
   * ones get ignored (R-2026-09-21-W A3).
   *
   * Normalising the key also gives GET and HEAD ONE shared entry, which is what
   * the HTTP semantics want: a HEAD is a GET without the body.
   */
  const key = new Request(ctx.request.url, { method: 'GET' });

  /*
   * A HEAD RESPONSE CARRIES HEADERS ONLY, AND THIS MODULE STRIPS THE BODY ITSELF.
   *
   * The runtime is expected to drop a body on a HEAD, but "expected to" is not an
   * assertion, and the stripping is exactly the sort of thing that is true on one
   * platform and quietly not on another. Doing it here makes it a property of this
   * code, which tests/db/beds_json_served.test.ts can hold it to (R-2026-09-21-W
   * A4). The headers -- content-type, cache-control, x-robots-tag -- are preserved
   * exactly, which is the whole point of routing HEAD here in the first place.
   *
   * Note this is applied to what is RETURNED, never to what is STORED: the cache
   * always receives the full-bodied response under the GET key, so a HEAD can
   * populate an entry that a later GET reads with its body intact.
   *
   * THE CACHE MARKER IS SET HERE FOR THE SAME REASON, AND IT IS THE REASON THIS IS
   * ONE FUNCTION RATHER THAN TWO. `x-openbed-edge-cache` describes what happened on
   * THIS request. If it were set before `cache.put`, the stored object would carry
   * `miss` forever and every later HIT would serve the word "miss" -- or, set the
   * other way, a stored `hit` would be served on a request that missed. A marker
   * that can be stored is a lie waiting for its second reader. Setting it on the
   * outgoing response ONLY makes that unrepresentable rather than merely avoided,
   * and it is why the stored copy carries no marker at all (R-2026-09-21-42).
   *
   * GET/HEAD parity extends to this header, and falls out of being here rather than
   * being a rule anyone has to remember.
   */
  const asRequested = (r: Response, state: EdgeCacheState): Response => {
    const out = new Response(ctx.request.method === 'HEAD' ? null : r.body, {
      status: r.status,
      statusText: r.statusText,
      headers: r.headers,
    });
    out.headers.set(EDGE_CACHE_HEADER, state);
    return out;
  };

  let readThrew = false;

  if (cache) {
    /*
     * ONLY THE CACHE CALL IS INSIDE THIS TRY, AND IT MUST STAY THAT WAY.
     *
     * Do not widen it to cover `serveBeds` below. A catch spanning the origin
     * read would convert a real failure into a cache miss and suppress exactly
     * what failure() exists to tag -- a worse version of the defect this try
     * closes (R-2026-09-20-33 B4). A cache is an optimisation; its failure must
     * never become the visitor's failure, and it must never hide the origin's.
     */
    try {
      const hit = await cache.match(key, { ignoreMethod: true });
      if (hit) {
        console.log(`beds.json: ${EDGE_CACHE_HEADER}=hit; served from the edge cache, the origin was not read`);
        return asRequested(hit, 'hit');
      }
    } catch (e) {
      // Still invisible to the client AS A FAILURE (R-2026-09-20-33 B5): a read
      // that throws is a miss, and a miss goes to the origin. What is no longer
      // invisible is THAT IT HAPPENED -- the marker says `read-error` rather than
      // `miss`, because "the cache is empty" and "the cache is broken" are
      // different facts and the runbook has to be able to tell them apart.
      console.error('beds.json: the edge cache read failed; treating it as a miss', e);
      readThrew = true;
    }
  }

  const res = await serveBeds(ctx.env, fetchImpl);

  if (cache && res.status === 200) {
    /*
     * A write that throws costs the cache hit and nothing else -- the response is
     * already built and is returned either way.
     *
     * The rejection is handled on the PROMISE rather than only by the try, because
     * on the waitUntil path nothing awaits it here: an async rejection would then
     * escape this try entirely and become an unhandled rejection. The try still
     * wraps the call for a SYNCHRONOUS throw. Both shapes are covered because the
     * reference does not say which one `put` uses.
     */
    try {
      const stored = cache.put(key, res.clone()).catch((e: unknown) => {
        console.error('beds.json: the edge cache write failed; serving the response uncached', e);
      });
      if (ctx.waitUntil) ctx.waitUntil(stored);
      else await stored;
    } catch (e) {
      console.error('beds.json: the edge cache write threw; serving the response uncached', e);
    }
  }

  /*
   * THE STATE IS COMPUTED FROM WHAT HAPPENED, IN A FIXED PRECEDENCE, and it is a
   * total function -- see EdgeCacheState above for what each value means and why
   * `miss` stops short of claiming the write landed.
   */
  const state: EdgeCacheState =
    cache === undefined ? 'unavailable' : readThrew ? 'read-error' : res.status === 200 ? 'miss' : 'nostore';

  /*
   * LOGGED WITH ITS CAUSE, because a marker reading `miss` at the edge otherwise
   * leaves the founder with nothing to look at. The existing console.error lines
   * cover a read or write that THREW; this one covers the ordinary cases, which is
   * exactly where a cache that silently stores nothing would hide.
   */
  console.log(`beds.json: ${EDGE_CACHE_HEADER}=${state}; ${EDGE_CACHE_CAUSE[state]}`);

  return asRequested(res, state);
}

/** The whole request: environment checked, row read, response built. */
export async function serveBeds(
  env: BedsEnv,
  fetchImpl: FetchLike = fetch,
  opts: { timeoutMs?: number; attempts?: number } = {},
): Promise<Response> {
  for (const name of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const) {
    if (!env[name]) return failure(500, `${name} is not set in the Function environment`);
  }
  try {
    return buildBedsResponse(await fetchNewestSnapshot(env, fetchImpl, opts));
  } catch (e) {
    if (e instanceof UpstreamError) return failure(e.status, e.message);
    return failure(502, 'the snapshot read failed');
  }
}
