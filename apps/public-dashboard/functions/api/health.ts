/**
 * GET and HEAD /api/health -- the endpoint an external uptime monitor polls to learn that
 * the snapshot job has stopped (R-2026-09-29-173 EW-2).
 *
 * A small adapter by design, as beds.json.ts is. What decides 200 or 503 is
 * packages/snapshot/src/health.ts (pure); everything that touches the network or the
 * edge cache is packages/snapshot/src/health_serve.ts, which tests/db drives with an
 * injected fetch and cache. The filename is the route: /api/health, from the directory
 * and the name.
 *
 * The body carries the keyword `openbed-ok` or `openbed-fail`, because the SPA answers
 * an unknown path with a 200 and its own HTML, and a monitor that checked the status
 * alone would read green for as long as the site was up. The header `x-openbed-health`
 * is there for scripts/readback_pages.sh, which can read headers where the free
 * monitors cannot.
 *
 * THE ENVIRONMENT HOLDS ONE NAME: SUPABASE_SERVICE_ROLE_KEY, the same one /beds.json
 * uses. This is server-side code: it never ships to a browser, and nothing here may be
 * imported by apps/public-dashboard/src, which is what does.
 */
import { serveHealthCached, type HealthEnv } from '../../../../packages/snapshot/src/health_serve.js';
import type { EdgeCache } from '../../../../packages/snapshot/src/serve.js';

interface PagesContext {
  readonly env: HealthEnv;
  readonly request: Request;
  waitUntil(promise: Promise<unknown>): void;
}

export const onRequestGet = (context: PagesContext): Promise<Response> => {
  const edge = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  return serveHealthCached(context, edge);
};

/**
 * HEAD IS AN EXPORT, NOT A ROUTER DEFAULT. Pages matches handlers by method, so without
 * this line a HEAD never reaches the handler and the SPA fallback answers it with a 200
 * and no marker, which is the failure /beds.json showed on 2026-09-21 (see beds.json.ts).
 * It is safe to alias only because serveHealthCached keys its cache on a GET it builds
 * itself; the Cache API refuses to put a HEAD.
 */
export const onRequestHead = onRequestGet;
