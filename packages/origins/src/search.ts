/**
 * THE ONE SEARCH SETTING (R-2026-09-30-190 FN-3).
 *
 * SEARCH_VISIBILITY alone decides three public discovery outputs:
 *   (a) the meta robots tag of the home, About, How-it-works and discovery guides (robotsMetaContent);
 *   (b) which tracked robots file the dashboard build writes to dist/robots.txt
 *       (robotsTxtSource);
 *   (c) whether the public informational sitemap is emitted by the dashboard build.
 * It is shipped as 'public' (R-2026-09-30-190 FN-A; FN-3 first shipped it 'hidden'). 'hidden'
 * stays as the tested fallback: both outputs are asserted and the hidden robots file is
 * pinned to the file shipped before FN-3, so going back is the same one-line edit; the build also omits the informational sitemap.
 * tests/compliance/search_visibility.test.ts asserts the shipped value, so a flip in either
 * direction without a ruling reddens a test.
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

export const SEARCH_VISIBILITY: SearchVisibility = 'public';

/** The content of the meta robots tag on public informational pages. */
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
