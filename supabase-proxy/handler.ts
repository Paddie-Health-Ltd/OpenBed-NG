/**
 * THE WORKER'S DECISION, as a function of its inputs (R-2026-09-23-70, PR 3.3).
 *
 * `index.js` binds the production origin and the deployed stamp; `dev.js` binds the
 * local stack for `wrangler dev`; tests call this directly with a stub fetch. There is
 * one decision and three callers, so the deployed behaviour is the tested behaviour.
 *
 * WHAT IT DOES, in order (R-2026-09-30-177 FA-1, FA-3; the order is the design):
 *   1. GET or HEAD /__openbed/version -> the build stamp, answered HERE and never
 *      forwarded. No Supabase service lives under `/__openbed`, and
 *      tests/compliance/proxy_allow_list.test.ts refuses a stamp path that shares a
 *      first segment with one. The stamp is the deploy stamp plus `limits_bound`,
 *      computed per request from `env`: which rate-limit bindings this deployment
 *      actually holds. The bindings are invisible in the dashboard and Worker logging
 *      is off, so this is the only place a missing one can be read.
 *   2. Any request carrying an `Upgrade` header -> refused, before the allow-list. The
 *      header is copied on forward (step 5), so without this a websocket upgrade on a
 *      LISTED GET reaches Supabase.
 *   3. A method and path on the allow-list (and its one query, where the entry names
 *      one), else the Worker's own 404 and Supabase is never contacted. A refused
 *      request is never counted against a limit.
 *   4. An entry that names a `limit` is counted per client address. Over the limit ->
 *      the Worker's own 429, marked `x-openbed-proxy: limited`; Supabase is not
 *      contacted and the token is not spent. OPTIONS entries carry no limit. A missing
 *      binding, or a limiter that throws, FORWARDS: a limiter must never take sign-in
 *      down.
 *   5. Forwarded to the origin unchanged but for the Host, and the answer gains
 *      `x-openbed-proxy: forwarded`. HEAD is served on a GET entry.
 *
 * WHY THE LIMITS EXIST. Every request through this Worker reaches Supabase from one
 * Cloudflare address (observed, R-2026-09-30-177), so Supabase's per-IP auth buckets
 * are shared by every ward. The limits bound each CLIENT; they are not a defence
 * against a distributed drain (that is a register TRIGGER). The numbers are the
 * `simple.limit` of each binding in wrangler.json, which is their one source; the
 * sizing argument is in tests/compliance/proxy_limits_config.test.ts.
 *
 * WHY EVERY ANSWER SAYS WHO GAVE IT. A 404 or a 401 from here and one from Supabase
 * look alike, and a probe that cannot tell them apart passes on the wrong one. So
 * the header, never a body shape, is the pass signal (R-2026-09-23-70 C1): hosted's
 * no-key 401 comes from Supabase's gateway, with a body nothing here controls.
 *
 * WHY THE REFUSAL CARRIES CORS HEADERS (C3). The ward console runs on another origin.
 * Without `access-control-allow-origin` a browser hides the refusal entirely, and
 * without `access-control-expose-headers` the page cannot read `x-openbed-proxy` --
 * so packages/auth/src/request.ts could not tell "refused here" from "answered by
 * GoTrue", and a ward would be told a link was on its way when none was sent.
 *
 * NOT AN AUTH BOUNDARY, and it does not claim to be. A forwarded request is
 * authorised exactly as it would be at the origin. What this adds is that nothing
 * the apps do not call is reachable through api.openbed.ng at all.
 */

export const STAMP_PATH = '/__openbed/version';
export const PROXY_HEADER = 'x-openbed-proxy';

/** The binding names wrangler.json declares, by the stamp's key for each. */
export const LIMIT_BINDINGS = { otp: 'LIMIT_OTP', verify: 'LIMIT_VERIFY', refresh: 'LIMIT_REFRESH' } as const;

/** What the Worker's `env` offers: Workers Rate Limiting bindings, by name. */
export type ProxyEnv = Readonly<Record<string, unknown>>;

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * The sentence a nurse reads when a sign-in link is limited. A copy of
 * packages/labels/ward-labels.json `proxy.VERIFY_LIMITED`: this directory is outside the
 * npm workspaces and cannot import it, and a test holds the two equal.
 */
export const VERIFY_LIMITED_TEXT =
  'Too many sign-in links were opened from this network in the last minute. Wait one minute, then open the same link again. It has not been used.';
export const LIMITED_JSON = '{"message":"rate limited by the OpenBed proxy"}';
/** Used when the request carries no client address (local, tests): still limited, never unlimited. */
export const NO_ADDRESS_KEY = 'no-client-address';

export interface ForwardEntry {
  readonly method: string;
  readonly path: string;
  readonly query?: string;
  readonly reason?: string;
  readonly preflight_for?: string;
  /** The name of the rate-limit binding that counts this entry, per client address. */
  readonly limit?: string;
}

export interface AllowList {
  readonly forward: readonly ForwardEntry[];
}

export interface HandlerConfig {
  /** e.g. https://<ref>.supabase.co -- no trailing slash. */
  readonly origin: string;
  readonly list: AllowList;
  /** The build stamp, served at STAMP_PATH. */
  readonly stamp: unknown;
  readonly fetchImpl?: (request: Request) => Promise<Response>;
}

/** The entry that admits this request, or undefined. HEAD is admitted by a GET entry. */
export function admits(list: AllowList, method: string, pathname: string, search: string): ForwardEntry | undefined {
  const m = method === 'HEAD' ? 'GET' : method;
  return list.forward.find(
    (e) => e.method === m && e.path === pathname && (e.query === undefined || search === `?${e.query}`),
  );
}

/**
 * The key a client is counted under: Cloudflare's `cf-connecting-ip`, which Cloudflare
 * sets at our edge and a client cannot supply. An IPv6 address is keyed on its /64,
 * since one subscriber holds a whole /64. Nothing here is logged or stored.
 */
export function limitKey(address: string | null): string {
  const raw = (address ?? '').trim();
  if (raw === '') return NO_ADDRESS_KEY;
  if (!raw.includes(':')) return raw;
  const groups = expandV6(raw);
  return groups === null ? raw : `${groups.slice(0, 4).join(':')}::/64`;
}

/** Eight 4-digit hex groups, or null when `a` is not an IPv6 address this can read. */
function expandV6(a: string): string[] | null {
  let s = a.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (tail !== null) {
    const o = tail.slice(1, 5).map(Number);
    if (o.some((n) => !Number.isInteger(n) || n > 255)) return null;
    const hex = (hi: number, lo: number): string => ((hi << 8) | lo).toString(16);
    s = `${s.slice(0, tail.index)}${hex(o[0] ?? 0, o[1] ?? 0)}:${hex(o[2] ?? 0, o[3] ?? 0)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const part = (h: string | undefined): string[] => (h === undefined || h === '' ? [] : h.split(':'));
  const head = part(halves[0]);
  let groups: string[];
  if (halves.length === 2) {
    const rest = part(halves[1]);
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<string>(missing).fill('0'), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, '0'));
}

export function refusal(): Response {
  return new Response('{"message":"not forwarded by the OpenBed proxy"}', {
    status: 404,
    headers: {
      'content-type': 'application/json',
      [PROXY_HEADER]: 'refused',
      'access-control-allow-origin': '*',
      'access-control-expose-headers': PROXY_HEADER,
    },
  });
}

/** The answer for a request over its limit. Answered here: Supabase is not contacted, no token is spent. */
export function limited(entry: ForwardEntry, method: string): Response {
  const isLink = entry.path === '/auth/v1/verify';
  const body = isLink ? VERIFY_LIMITED_TEXT : LIMITED_JSON;
  return new Response(method === 'HEAD' ? null : body, {
    status: 429,
    headers: {
      'content-type': isLink ? 'text/plain; charset=utf-8' : 'application/json',
      [PROXY_HEADER]: 'limited',
      'retry-after': '60',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-expose-headers': PROXY_HEADER,
    },
  });
}

function limiterNamed(env: ProxyEnv | undefined, name: string): RateLimiter | undefined {
  const b = env?.[name] as Partial<RateLimiter> | undefined;
  return typeof b?.limit === 'function' ? (b as RateLimiter) : undefined;
}

/** True only when a bound limiter counted this client and said no. Everything else forwards. */
async function overLimit(env: ProxyEnv | undefined, entry: ForwardEntry, request: Request): Promise<boolean> {
  if (entry.limit === undefined) return false;
  const limiter = limiterNamed(env, entry.limit);
  if (limiter === undefined) return false;
  try {
    const verdict = await limiter.limit({ key: limitKey(request.headers.get('cf-connecting-ip')) });
    return verdict.success === false;
  } catch {
    return false;
  }
}

export function makeHandler(config: HandlerConfig): (request: Request, env?: ProxyEnv) => Promise<Response> {
  const doFetch = config.fetchImpl ?? ((r: Request) => fetch(r));
  const host = new URL(config.origin).host;

  return async (request: Request, env?: ProxyEnv): Promise<Response> => {
    const url = new URL(request.url);

    if (url.pathname === STAMP_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
      const base = typeof config.stamp === 'object' && config.stamp !== null ? config.stamp : {};
      const limits_bound = {
        otp: limiterNamed(env, LIMIT_BINDINGS.otp) !== undefined,
        verify: limiterNamed(env, LIMIT_BINDINGS.verify) !== undefined,
        refresh: limiterNamed(env, LIMIT_BINDINGS.refresh) !== undefined,
      };
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({ ...base, limits_bound }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', [PROXY_HEADER]: 'stamp' },
      });
    }

    if (request.headers.has('upgrade')) return refusal();

    const entry = admits(config.list, request.method, url.pathname, url.search);
    if (entry === undefined) return refusal();
    if (await overLimit(env, entry, request)) return limited(entry, request.method);

    const headers = new Headers(request.headers);
    headers.set('Host', host);
    const upstream = await doFetch(
      new Request(new URL(url.pathname + url.search, config.origin), {
        method: request.method,
        headers,
        // Buffered, not streamed: every body this forwards is a small JSON request, and a
        // streamed body needs `duplex: 'half'` under Node's fetch, which the tests use.
        body: request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer(),
        redirect: 'manual',
      }),
    );
    const answer = new Response(upstream.body, upstream);
    answer.headers.set(PROXY_HEADER, 'forwarded');
    return answer;
  };
}
