/**
 * LOCAL ONLY, NEVER DEPLOYED: the same handler and the same allow-list as ./index.js,
 * bound to the local Supabase stack, for `npx wrangler dev supabase-proxy/dev.js`.
 * scripts/deploy_worker.sh deploys ./index.js by name (wrangler.json `main`), and this
 * file carries no stamp, so the golden path and the browser check can run through the
 * real routing decision without touching the hosted project.
 */
import { makeHandler } from './handler.ts';
import LIST from './allow-list.json';

const handle = makeHandler({
  origin: 'http://127.0.0.1:54321',
  list: LIST,
  stamp: { commit: 'local-dev', dirty: true, note: 'supabase-proxy/dev.js -- not a deployment' },
});

export default {
  fetch(request) {
    return handle(request);
  },
};
