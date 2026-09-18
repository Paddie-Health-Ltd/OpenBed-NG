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
 * THE CACHE IS EXPLICIT. A Function's response is not cached by the CDN from its
 * Cache-Control header alone; `caches.default` is how it gets there. See
 * serveBedsCached in serve.ts for what that covers and what it does not -- in
 * short, custom domains only, and per data centre.
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
