/**
 * THE ONE SEARCH SETTING (R-2026-09-30-190 FN-3).
 *
 * SEARCH_VISIBILITY alone decides two things, and nothing else:
 *   (a) the meta robots tag of the home, About and How-it-works pages (robotsMetaContent);
 *   (b) which tracked robots file the dashboard build writes to dist/robots.txt
 *       (robotsTxtSource).
 * It is shipped as 'hidden'. The go-live flip is a one-line edit of this value, in a pull
 * request of its own, and tests/compliance/search_visibility.test.ts asserts the shipped
 * value, so a flip without a ruling reddens a test.
 *
 * NOT decided here, deliberately: the privacy notice page, whose meta robots stays
 * "noindex, nofollow" in both states, and the X-Robots-Tag on /beds.json, which
 * packages/snapshot/src/serve.ts sets as noindex in both states. Both are independent of
 * this value.
 *
 * Its own module, like privacy.ts, so a build that imports it carries this and nothing
 * else from the package. Pure: no file, no clock, no environment.
 */
export type SearchVisibility = 'hidden' | 'public';

export const SEARCH_VISIBILITY: SearchVisibility = 'hidden';

/** The content of the meta robots tag on the home, About and How-it-works pages. */
export function robotsMetaContent(visibility: SearchVisibility): string {
  return visibility === 'public' ? 'index, follow' : 'noindex, nofollow';
}

/**
 * The tracked file the built robots.txt is a byte copy of, relative to the repository
 * root. 'hidden' is the file the dashboard has always shipped.
 */
export function robotsTxtSource(visibility: SearchVisibility): string {
  return visibility === 'public'
    ? 'apps/public-dashboard/robots-public.txt'
    : 'apps/public-dashboard/public/robots.txt';
}
