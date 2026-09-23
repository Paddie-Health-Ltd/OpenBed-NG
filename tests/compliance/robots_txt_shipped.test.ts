import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';
import { deployableApps, outputDirOf } from './_apps.js';

/**
 * `robots.txt` MUST REACH THE BUILD, not merely exist in the repository
 * (R-2026-09-20-29 F).
 *
 * Until 2026-09-20 the deployed site had none: a request for `/robots.txt` returned
 * the SPA's `index.html` with a 200, so a crawler received a page it could not parse
 * as rules and proceeded. **No directive is not a permissive directive.**
 *
 * The source file lives in Vite's `public/` directory, which is copied into `dist`
 * by convention rather than by anything this repository controls. A convention is
 * exactly the kind of thing that changes under a config edit nobody connects to
 * crawler policy, and the failure is silent: the file is still in git, the site
 * still builds, and the directive is simply gone. So this asserts the BUILT
 * ARTEFACT, which is the corpus a deploy uploads.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that any crawler obeys it. It governs WELL-BEHAVED crawlers, and it is not a
 *     boundary against a determined collector. The boundary is Bundle 2's revoke.
 *   - that the DEPLOYED site serves it. The Pages project is direct-upload, so what
 *     runs is whatever tree was uploaded (R-2026-09-20-25). Only the deployment
 *     report closes that gap.
 *   - anything about `/beds.json`, which no `robots.txt` rule can carry a directive
 *     INTO: that route is covered by the `X-Robots-Tag` header, asserted in
 *     tests/db/beds_json_served.test.ts.
 *
 * WIDENED TO EVERY DEPLOYABLE APP by R-2026-09-22-57 B. The ward console is an
 * authenticated operational surface, so the argument is stronger there than here: a
 * magic-link URL that reached an index would be a session in a search result. The
 * per-app list is DERIVED (tests/compliance/_apps.ts), so an app added in a later
 * bundle is covered by existing rather than by someone remembering this file.
 */
const APPS = deployableApps();

const sourceFor = (app: string): string => join(REPO_ROOT, 'apps', app, 'public', 'robots.txt');
const builtFor = (app: string): string => join(REPO_ROOT, 'apps', app, outputDirOf(app), 'robots.txt');

describe('robots.txt', () => {
  test('anti-vacuity — there is at least one app to assert about', () => {
    expect(APPS.length, 'no deployable apps discovered — every leg below is vacuous').toBeGreaterThan(0);
  });

  test.each(APPS)('%s: the source file exists and disallows the whole site', (app) => {
    const source = sourceFor(app);
    expect(existsSync(source), `no robots.txt source at ${source}`).toBe(true);
    const text = readFileSync(source, 'utf8');
    expect(text, `apps/${app}'s robots.txt names no user-agent, so it applies to nobody`).toMatch(/^User-agent:\s*\*$/m);
    expect(text, `apps/${app}'s robots.txt allows the site it was written to disallow`).toMatch(/^Disallow:\s*\/$/m);
  });

  test.each(APPS)('%s: the BUILT bundle carries it — the artefact a deploy uploads', (app) => {
    const built = builtFor(app);
    expect(
      existsSync(built),
      `apps/${app}: robots.txt is in the repository but not in its build output — run \`npm run build\`; if the build ran, Vite's public/ copying is no longer reaching it, and the deployed site has no crawler directive at all`,
    ).toBe(true);
    expect(readFileSync(built, 'utf8')).toBe(readFileSync(sourceFor(app), 'utf8'));
  });
});
