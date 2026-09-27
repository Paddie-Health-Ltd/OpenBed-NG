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
