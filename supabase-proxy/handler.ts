/**
 * THE WORKER'S DECISION, as a function of its inputs (R-2026-09-23-70, PR 3.3).
 *
 * `index.js` binds the production origin and the deployed stamp; `dev.js` binds the
 * local stack for `wrangler dev`; tests call this directly with a stub fetch. There is
 * one decision and three callers, so the deployed behaviour is the tested behaviour.
 *
 * WHAT IT DOES, in order:
 *   1. GET or HEAD /__openbed/version -> the build stamp, answered HERE and never
 *      forwarded. No Supabase service lives under `/__openbed`, and
 *      tests/compliance/proxy_allow_list.test.ts refuses a stamp path that shares a
 *      first segment with one.
 *   2. A method and path on the allow-list (and its one query, where the entry names
 *      one) -> forwarded to the origin unchanged but for the Host, and the answer
 *      gains `x-openbed-proxy: forwarded`. HEAD is served on a GET entry.
 *   3. Anything else -> the Worker's own 404, and Supabase is never contacted.
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

export interface ForwardEntry {
  readonly method: string;
  readonly path: string;
  readonly query?: string;
  readonly reason?: string;
  readonly preflight_for?: string;
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

export function makeHandler(config: HandlerConfig): (request: Request) => Promise<Response> {
  const doFetch = config.fetchImpl ?? ((r: Request) => fetch(r));
  const host = new URL(config.origin).host;

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (url.pathname === STAMP_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
      return new Response(request.method === 'HEAD' ? null : JSON.stringify(config.stamp), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', [PROXY_HEADER]: 'stamp' },
      });
    }

    if (admits(config.list, request.method, url.pathname, url.search) === undefined) return refusal();

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
