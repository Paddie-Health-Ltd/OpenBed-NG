/**
 * THE PRIVACY NOTICE'S ONE URL (R-2026-09-26-136 DL-1 d). The openbed.ng footer, the
 * ward console's sign-in screen and the admin sign-in screen all link here, and each
 * reads it from this constant; tests/compliance/privacy_links.test.ts asserts every link
 * and refuses the URL typed anywhere else under apps/ or packages/.
 *
 * Its own module, like support.ts and contacts.ts, so a bundle that imports it carries
 * this string and nothing else from the package. Not in contacts.json, which holds
 * addresses only (DL-1 d).
 */
export const PRIVACY_NOTICE_URL = 'https://openbed.ng/privacy';

/**
 * THE TWO STATIC PAGES' URLS (R-2026-09-30-190 FN-2), beside the notice's. The footers of
 * the home page, About and How-it-works link here, each reading these constants;
 * tests/compliance/privacy_links.test.ts asserts every link and refuses the URLs typed
 * anywhere else under apps/ or packages/.
 */
export const ABOUT_URL = 'https://openbed.ng/about';
export const HOW_IT_WORKS_URL = 'https://openbed.ng/how-it-works';

/**
 * THE HOME PAGE'S URL (R-2026-10-09 GO, E). The canonical link of the home page, written into index.html at
 * build time, and the base a shared search link is built on. Its own constant, like the three above, so the
 * address is typed once under apps/ and packages/.
 */
export const HOME_URL = 'https://openbed.ng/';
