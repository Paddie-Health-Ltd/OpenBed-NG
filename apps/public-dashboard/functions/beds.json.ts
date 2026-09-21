/**
 * GET /beds.json -- the public read path A1 ruled into existence.
 *
 * A small adapter by design. Everything that decides what anon receives lives in
 * packages/snapshot/src/serve.ts, which the root type-check covers and which
 * tests/db/beds_json_served.test.ts drives against the real local PostgREST.
 *
 * The filename is the route: Cloudflare Pages Functions strip the `.ts` and serve
 * this at `/beds.json`. Proved by running it under `wrangler pages dev` on
 * 2026-09-18 (200 with the expected headers at /beds.json; /beds fell through to
 * the SPA), not inferred from the documentation.
 *
 * THAT PROOF WAS GET-ONLY, AND THE GAP IT LEFT WAS MEASURED, NOT INFERRED. On
 * 2026-09-21, against the deployed artifact, `HEAD /beds.json` returned 200 with
 * `content-type: text/html` -- the SPA's index, served as a fallback because the
 * only export here matched GET. It therefore carried NEITHER of the headers this
 * route exists to set: no `cache-control: public, s-maxage=30`, and only the
 * site-wide `x-robots-tag: noindex` instead of this module's `noindex, nofollow`.
 * The route answered differently by method, and some crawlers and monitors issue
 * HEAD. A control path confirmed the mechanism: an invented path with no Function
 * at all answered HEAD identically, so the fallback -- not a method-specific
 * refusal by the Functions router -- is what was replying.
 *
 * THE CACHE IS EXPLICIT. A Function's response is not cached by the CDN from its
 * Cache-Control header alone; `caches.default` is how it gets there. See
 * serveBedsCached in serve.ts for what that covers and what it does not -- in
 * short: per data centre, no stale-while-revalidate, and NOT custom-domain-only.
 * This line read "custom domains only" until 2026-09-21. That was a Workers fact
 * about *.workers.dev applied to a Pages Function; Cloudflare's Cache API
 * reference says Pages functions have functional cache operations "whether
 * attached to custom domains or `*.pages.dev` domains" (R-2026-09-21-42).
 *
 * WHAT THE RESPONSE SAYS ABOUT THAT CACHE. serveBedsCached sets
 * `x-openbed-edge-cache` on every response here -- hit, miss, nostore, read-error
 * or unavailable. It exists because `cf-cache-status` describes the ZONE's cache,
 * not this one, and reads `DYNAMIC` for this path whether the Function's cache hit
 * or missed. The runbook's cache step reads the marker, not cf-cache-status.
 *
 * The environment holds SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, set in the
 * Pages project by the founder (docs/runbook-cloudflare-pages-beds-json.md,
 * its environment step). This is server-side code: it never ships to a browser, and nothing
 * here may be imported by apps/public-dashboard/src, which is what does.
 */
import { serveBedsCached, type BedsEnv, type EdgeCache } from '../../../packages/snapshot/src/serve.js';

interface PagesContext {
  readonly env: BedsEnv;
  readonly request: Request;
  waitUntil(promise: Promise<unknown>): void;
}

export const onRequestGet = (context: PagesContext): Promise<Response> => {
  const edge = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  return serveBedsCached(context, edge);
};

/**
 * HEAD IS THE SAME READ, AND IT IS AN EXPORT RATHER THAN A ROUTER DEFAULT.
 *
 * Pages matches handlers by method, so without this line a HEAD does not reach
 * this module at all and the SPA fallback answers it untagged (see above).
 *
 * This alias is SAFE ONLY BECAUSE serveBedsCached NORMALISES ITS CACHE KEY TO A
 * GET. Cloudflare's Cache API reference states `cache.put` throws for any non-GET
 * request, so aliasing HEAD onto a handler that keyed the cache on the incoming
 * request would throw on every HEAD. Read serveBedsCached before changing either
 * half; they are one mechanism in two files (R-2026-09-21-W A2).
 *
 * The runtime omits the body for a HEAD; tests/db/beds_json_served.test.ts asserts
 * that rather than assuming it (W A4).
 */
export const onRequestHead = onRequestGet;
