import POINTS from '../../../packages/fixtures/lga-reference-points.json';

/**
 * THE 20 LAGOS LGA REFERENCE POINTS (R-2026-10-09 GO, GO-2).
 *
 * The coordinates, the labels and the attribution come from ONE checked-in file,
 * packages/fixtures/lga-reference-points.json, and this module IMPORTS it: no coordinate is retyped
 * here. The file is © OpenStreetMap contributors, available under the Open Database Licence 1.0, and the
 * repository README says so. Each point is OpenStreetMap's representative point for the LGA's boundary
 * relation, except Lagos Island, whose relation point lies in the lagoon, so its place=town node is used
 * (the file's own `rule` says so). A point is a SEARCH STARTING POINT for straight-line distance: never
 * a centre, never a Directions destination, and never a hospital's location.
 *
 * ATTRIBUTION. LGA_ATTRIBUTION is the file's `attribution` field, exported ONCE. Three things read it:
 * the About page build (site-pages.ts), the home page's line under the area picker (main.ts), and the
 * test that asserts the string and its link target. A reader that typed its own copy would be a second
 * derivation site, so none does.
 *
 * NETWORK. Nothing here fetches anything. The link below is an ordinary anchor the visitor may click,
 * which is a navigation, not a call the page makes.
 */

export interface LgaPoint {
  readonly slug: string;
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
}

export const LGA_POINTS: readonly LgaPoint[] = POINTS.points.map((p) => ({ slug: p.slug, label: p.label, lat: p.lat, lng: p.lng }));

/** The point for a slug the picker offers, or undefined. Only the file's own slugs are ever looked up. */
export function lgaBySlug(slug: unknown): LgaPoint | undefined {
  return typeof slug === 'string' ? LGA_POINTS.find((p) => p.slug === slug) : undefined;
}

/** The visible attribution, exactly as the file states it. */
export const LGA_ATTRIBUTION: string = POINTS.attribution;

/** Where the "© OpenStreetMap contributors" part of the attribution links. */
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

const MARK = LGA_ATTRIBUTION.indexOf('©');
/** The attribution up to its copyright sign, which stays plain text. */
export const ATTRIBUTION_PREFIX: string = MARK < 0 ? '' : LGA_ATTRIBUTION.slice(0, MARK);
/** The "© OpenStreetMap contributors" part, which carries the link. */
export const ATTRIBUTION_LINK_TEXT: string = MARK < 0 ? LGA_ATTRIBUTION : LGA_ATTRIBUTION.slice(MARK);
