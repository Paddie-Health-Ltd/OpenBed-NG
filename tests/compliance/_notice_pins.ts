/**
 * THE PRIVACY NOTICE'S PINS, IN ONE PLACE (R-2026-10-09 GO, GO-3 c; Cowork's advance notice in Addendum 1).
 *
 * Which notice file is current, its version, and the sha256 Cowork issued with it live HERE and nowhere
 * else in the tests. tests/compliance/privacy_notice.test.ts pins the files against them,
 * tests/compliance/readback_scripts.test.ts builds its fake /privacy page from the current file's name,
 * and docs/legal/README.md is asserted to carry every sha below, so a replacement hand-over file (a new
 * sha256, or a new version) moves the constants in this file and the README line, and nothing else in the
 * tests: no prose is copied out of the notice, and no second sha exists to drift.
 *
 * ONE PIN LIVES ELSEWHERE, and it is a different kind of pin. BUILT_PRIVACY_SHA256 in site_pages.test.ts is
 * the sha256 of the BUILT dist/privacy.html, which is a function of the notice, the renderer and the
 * stylesheet's content-hashed filename together; it cannot be computed from the source's sha. A replacement
 * notice re-pins it as well, by the method that constant's own comment states.
 *
 * Every sha is as Cowork issued it with its file, a paste error never to be fixed by hand.
 */

export interface NoticePin {
  /** "1.2": the version the notice states in its own first lines. */
  readonly version: string;
  /** The file's name under docs/legal/. */
  readonly file: string;
  readonly sha256: string;
  /** The ruling that issued it. */
  readonly issuedBy: string;
}

/** The notice the page serves. */
export const CURRENT_NOTICE: NoticePin = {
  version: '1.2',
  file: 'privacy-notice-v1.2.md',
  sha256: 'c48b1b92860ccdd699ee6e29841d95f6d7662d759f34888994a3fcaeffef1f7f',
  issuedBy: 'R-2026-10-09 GO, GO-3 a, replaced by Addendum 2 (Tally BV added as a provider)',
};

/** Prior versions, kept byte for byte: a published version is never edited, a change is a new file. Newest first. */
export const PRIOR_NOTICES: readonly NoticePin[] = [
  {
    version: '1.1',
    file: 'privacy-notice-v1.1.md',
    sha256: '9e38c81335715db959651b07096b48d200e48c8199361f3571a0020de5baec76',
    issuedBy: 'R-2026-09-28-156 EF-1 a',
  },
  {
    version: '1.0',
    file: 'privacy-notice-v1.0.md',
    sha256: '0921ca415238d5ed96f3d287bf4fe02669a7c0e5cebac25b3f303a22be524db1',
    issuedBy: 'R-2026-09-26-136 DL ("NOTICE INTEGRITY CHECK")',
  },
];
