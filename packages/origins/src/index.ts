import ORIGINS from '../origins.json';

/**
 * WHICH DATABASE ADDRESS AN APP CALLS, AND HOW IT IS CHOSEN
 * (R-2026-09-19-21 D1-D3, delivered by R-2026-09-22-57 item 1).
 *
 * WHAT THIS CLOSES. Finding D: nothing in the repository said what the ward console
 * talks to in production. The answer lived in an untracked .env.local on one laptop
 * and in a Pages environment variable nobody could read back, which meant the
 * deployed origin was not a fact this repository held at all.
 *
 * WHY SELECTION IS AT RUNTIME AND NOT AT BUILD TIME. A build-time choice makes
 * "the built bundle carries the production origin" true only for whoever built with
 * the right variable set -- so the assertion would pass on a laptop that happened to
 * be configured and prove nothing about the artefact that ships. Every environment's
 * origins are compiled into every bundle instead. They are PUBLIC values; there is
 * nothing to withhold. See origins.json's own notes, which are the authoritative
 * statement of all of this.
 *
 * THIS MODULE IS THE JSON'S SOLE IMPORTER, deliberately. App code takes these
 * functions, never the JSON, so no bundler ever sees a named-export access it could
 * tree-shake an unused environment out of.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that the origins are REACHABLE. Nothing in a pure function can establish that
 *     a hostname resolves or that a project is up; the runbook's probes do that.
 *   - THE PUBLISHABLE KEY. It lives in the sibling module ./keys.js, and this file
 *     deliberately does not import it. packages/snapshot/src/serve.ts imports THIS
 *     module, and a Pages Function has no business carrying a browser's key: when
 *     the two shared one file, the built Function bundle inlined the key and the
 *     secret scan said so. Observed, not predicted.
 *   - that supabase-proxy/ forwards to the same project. It builds its origin from
 *     its own tracked project id, which is a second derivation site; the two are
 *     bound by an assertion in the tracked-origins guard, not by this file.
 */

export type Environment = 'production' | 'local';

interface OriginPair {
  readonly production: string;
  readonly local: string;
}

const API: OriginPair = ORIGINS.api;
const SUPABASE_DIRECT: OriginPair = ORIGINS.supabaseDirect;

/** Hosts that mean "this is a developer's machine or a test". Everything else is production. */
export const LOCAL_HOSTS: readonly string[] = ORIGINS.localHosts;

export const PRODUCTION_API_ORIGIN = API.production;
export const LOCAL_API_ORIGIN = API.local;
export const PRODUCTION_SUPABASE_ORIGIN = SUPABASE_DIRECT.production;
export const LOCAL_SUPABASE_ORIGIN = SUPABASE_DIRECT.local;

/**
 * TOTAL BY CONSTRUCTION: a listed host is local, anything else is production.
 *
 * It accepts a bare hostname, and tolerates a `host:port` or a URL's `hostname`
 * (which keeps IPv6 brackets, so `[::1]` is on the list in that form). It never
 * returns undefined and never throws, because every caller of this is on a request
 * path where throwing would turn a configuration question into an outage.
 */
export function environmentForHost(hostname: string): Environment {
  const bare = hostname.trim().toLowerCase();
  // Strip a port, but not from a bracketed IPv6 literal, where the colons are the address.
  const host = bare.startsWith('[') ? bare.replace(/\](?::\d+)?$/, ']') : bare.replace(/:\d+$/, '');
  return LOCAL_HOSTS.includes(host) ? 'local' : 'production';
}

/** The address every BROWSER call uses: api.openbed.ng in production (-55 A). */
export function apiOrigin(hostname: string): string {
  return environmentForHost(hostname) === 'local' ? API.local : API.production;
}

/**
 * The address the public dashboard's /beds.json Function uses, and ONLY it.
 *
 * This is the narrow exception of R-2026-09-22-58 A. If you are reaching for it from
 * anywhere else, the answer is apiOrigin() and the exception does not extend to you.
 */
export function supabaseDirectOrigin(hostname: string): string {
  return environmentForHost(hostname) === 'local' ? SUPABASE_DIRECT.local : SUPABASE_DIRECT.production;
}
