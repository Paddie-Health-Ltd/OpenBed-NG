import KEYS from '../publishable-keys.json';
import { environmentForHost } from './index.js';

/**
 * THE PUBLISHABLE CLIENT KEY, in its own module (R-2026-09-22-61 A1).
 *
 * WHY IT IS NOT IN ./index.ts, which would be the obvious place. That module is
 * imported by packages/snapshot/src/serve.ts, which is bundled into the
 * /beds.json Pages Function — and when the two shared one file the key was
 * inlined into the FUNCTION's bundle, where a browser key has no business being.
 * The secret scan caught it. Splitting the module means a consumer takes the key
 * only by asking for it.
 *
 * IT IS NOT A SECRET, and that is the basis rather than an excuse: it ships in
 * every client bundle by design and the whole RLS boundary assumes an attacker
 * holds it. The credential that cannot be tracked is the service-role key, and it
 * is not here — nor may it ever be, which its own file and the secret scan both
 * say in terms.
 */

export const PRODUCTION_PUBLISHABLE_KEY = KEYS.production;
export const LOCAL_PUBLISHABLE_KEY = KEYS.local;

/**
 * The publishable key a browser presents, chosen by the SAME host rule as the
 * origin (R-2026-09-22-61 A1).
 *
 * WHY IT IS HERE AND NOT AN ENVIRONMENT VARIABLE. It used to be
 * `import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY']`, read from an untracked
 * .env.local. Two things were wrong with that. The build's contents depended on one
 * laptop -- and worse, Vite inlines the WHOLE env record for a bracket access, so a
 * stale name in that file shipped inside the bundle as well. Tracking the key is
 * what lets this app read no environment at all, which is the property
 * R-2026-09-22-60 asks for.
 *
 * IT IS NOT A SECRET, and that is the basis rather than an excuse: it ships in every
 * client bundle by design and the whole RLS boundary assumes an attacker holds it.
 * The credential that cannot be tracked is the service-role key, and it is not here.
 */
export function publishableKeyFor(hostname: string): string {
  return environmentForHost(hostname) === 'local' ? KEYS.local : KEYS.production;
}
