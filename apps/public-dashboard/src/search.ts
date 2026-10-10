import type { DecodedRow, SearchRank } from '@openbed/snapshot';
import { WARD_CATEGORIES } from '@openbed/labels';
import { wardLineParts, type ServeClock, type WardLineParts } from './age-view.js';
import { isCoordinate } from './card.js';
import { LGA_POINTS } from './lga-points.js';

/**
 * THE PURE SEARCH LAYER OF THE PUBLIC PAGE (R-2026-10-09 GO, B).
 *
 * No DOM, no clock, no fetch, no storage: every function takes what it needs and returns a value, so it is
 * tested with literals like card.ts is. The clock arrives as the same ServeClock the age words use, so a
 * band is worked out once, in age-view.ts, and this file only reads it.
 *
 *   - parse and write the share link: ONLY `ward` and `area`, each looked up in a fixed table, and the
 *     visitor's raw text is never echoed anywhere;
 *   - eligibility, which keys on the OFFERING first (a ward the hospital stated it does not offer is not
 *     there) and on nothing else: never on a count, never on an age;
 *   - the order, in ONE exported function, orderFacilities, which main.ts calls through its import so a test
 *     can spy on it and count how often the page re-sorts;
 *   - the frozen order of A3: the order is set when a visitor acts and held while the page polls;
 *   - straight-line distance, by the haversine formula.
 *
 * FRESHNESS REORDERS AND NEVER FILTERS. The only thing that removes a hospital from a result is that it
 * does not offer the chosen ward. Hospitals whose reports are old, suppressed or missing stay, and keep
 * their names and phone numbers.
 */

/** The ten ward categories, as the label table names them: the enum values, upper case. */
export const WARD_VALUES: readonly string[] = WARD_CATEGORIES;

/** "any", or one of WARD_VALUES. */
export type WardChoice = string;

/** The URL's spelling of a ward: exactly the lower-case enum value (GO-2 d). */
export const wardSlug = (category: string): string => category.toLowerCase();

const WARD_BY_SLUG: ReadonlyMap<string, string> = new Map(WARD_VALUES.map((c) => [wardSlug(c), c]));
const AREA_SLUGS: ReadonlySet<string> = new Set(LGA_POINTS.map((p) => p.slug));

export interface SearchState {
  readonly ward: WardChoice;
  readonly area: string | null;
}

/**
 * The search the address asked for. Every other key is ignored, so a hand-edited link cannot carry a place
 * in. A value is TRIMMED AND CASE-FOLDED before the lookup (R-2026-09-30-218 GQ-2 a): "MATERNITY", "Maternity"
 * and " maternity " all name the maternity category, and "Apapa" names the area apapa. After that it must be
 * exactly one of the table's own spellings, or it falls back to "any" and to no area. A value longer than 40
 * characters as sent is not read at all, so the fold never works on unbounded input. The first of a repeated key
 * is the one read. The WRITER is unchanged and writes the lower-case slug only (writeSearch below), so the address
 * the page shows and the link it shares stay one spelling.
 *
 * Until GQ the lookup was exact and lower-case only, and the four discovery guides that #134 added linked
 * `?ward=A_AND_E`, `?ward=ICU_ADULT` and the rest in upper case: every one of those links opened the page with
 * no ward chosen, and nothing said so.
 */
export function parseSearch(search: string): SearchState {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { ward: 'any', area: null };
  }
  const fold = (value: string | null): string | null => (value !== null && value.length <= 40 ? value.trim().toLowerCase() : null);
  const ward = fold(params.get('ward'));
  const area = fold(params.get('area'));
  return {
    ward: ward !== null ? (WARD_BY_SLUG.get(ward) ?? 'any') : 'any',
    area: area !== null && AREA_SLUGS.has(area) ? area : null,
  };
}

/**
 * The query string for a search: '' for no search, else '?ward=...&area=...' with `ward` left out for "any".
 * It takes the search state and nothing else, so no position can reach it; a device-location search has no
 * area, and writes ward only.
 */
export function writeSearch(state: SearchState): string {
  const parts: string[] = [];
  if (state.ward !== 'any' && WARD_VALUES.includes(state.ward)) parts.push(`ward=${wardSlug(state.ward)}`);
  if (state.area !== null && AREA_SLUGS.has(state.area)) parts.push(`area=${state.area}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

/**
 * THE SYNONYMS, for typed search only (R-2026-10-09 GO, GO-4 d; Addendum 2, item 2). Mock v5's own words, EXACTLY, one entry per ward
 * category, as the letter gave them; the pull request carries the table for Cowork's check and tests/compliance/search_pure.test.ts pins
 * it as a literal, so a change to one word is a deliberate edit and a red test, never a quiet one. Some words belong to more than one
 * category on purpose ("baby", "children", "icu", "intensive", "surgery"): a typed word finds every bed type that carries it.
 * Typed text is matched against these words and the label (by word prefix, in controls.ts); it is never echoed into the page or the
 * address, and a synonym is never read from or written to the URL.
 */
export const WARD_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  A_AND_E: ['emergency', 'a&e', 'ae', 'accident', 'casualty'],
  THEATRE: ['theatre', 'theater', 'operating', 'surgery', 'operation'],
  SURGICAL: ['surgical', 'surgery'],
  MATERNITY: ['maternity', 'labour', 'labor', 'delivery', 'birth', 'pregnancy', 'pregnant', 'obstetric', 'antenatal'],
  NICU: ['nicu', 'newborn', 'neonatal', 'baby', 'babies', 'infant', 'intensive'],
  SCBU: ['scbu', 'special care', 'baby', 'babies', 'newborn', 'neonatal', 'infant'],
  PAEDIATRIC: ['children', 'child', 'kids', 'paediatric', 'pediatric', 'paeds'],
  ICU_ADULT: ['icu', 'intensive', 'critical care', 'adult', 'itu'],
  ICU_PAEDIATRIC: ['children', 'child', 'kids', 'paediatric', 'pediatric', 'picu', 'icu', 'intensive', 'critical'],
  MEDICAL_ADULT: ['medical', 'general medicine', 'adult'],
};

/** Mean Earth radius, kilometres. */
const EARTH_RADIUS_KM = 6371;

/** Straight-line (great-circle) distance in kilometres between two latitude/longitude pairs, in degrees. */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface Origin {
  readonly lat: number;
  readonly lng: number;
}

/**
 * Distance from the origin to a facility, or null when there is no origin or the facility's coordinates are
 * not both finite numbers in range. A null is "Distance unavailable" and sorts after every calculable one;
 * it is never a distance of zero and never NaN.
 */
export function distanceKm(origin: Origin | null, lat: unknown, lng: unknown): number | null {
  if (origin === null) return null;
  if (!isCoordinate(lat, 90) || !isCoordinate(lng, 180)) return null;
  return haversineKm(origin.lat, origin.lng, lat, lng);
}

/** What a count needs beside it before it may render: a name, and a number to call. */
export interface CallableIdentity {
  readonly name: string;
  readonly phone: string;
}

/**
 * THE ONE DECISION about whether a ward can be shown. Null when its facility is
 * absent from the payload, its name is blank or only whitespace, or it carries no
 * number to call. Every renderer asks this; none decides it for itself.
 */
export function callableIdentity(facility: DecodedRow | undefined): CallableIdentity | null {
  if (facility === undefined) return null;
  const name = facility['name'];
  const phone = facility['public_phone_e164'];
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (typeof phone !== 'string' || phone.trim() === '') return null;
  return { name: name.trim(), phone: phone.trim() };
}

/** One hospital that can be shown, with what an order and a card need. */
export interface Candidate {
  readonly id: string;
  readonly identity: CallableIdentity;
  readonly facility: DecodedRow;
  /** The wards to draw in the card, in the order served: the chosen ward alone, or every ward not hidden. */
  readonly wards: readonly DecodedRow[];
  /** The chosen ward's rank, or null under "Any" (no hospital-wide band is ever derived). */
  readonly rank: SearchRank | null;
  /** Kilometres from the origin, or null when unknown or when there is no origin. */
  readonly distanceKm: number | null;
}

export interface Candidates {
  /** Hospitals the current controls show. N of the coverage line. */
  readonly shown: readonly Candidate[];
  /** Hospitals the page could show under "Any": a callable identity and a ward not hidden. M of the coverage line. */
  readonly listed: number;
  /** Wards dropped because their facility has no callable identity, by facility id and category only. */
  readonly dropped: readonly { readonly facility_id: unknown; readonly category: unknown }[];
  /** How many ward rows had a callable facility at all, hidden or not: zero means nothing can be shown. */
  readonly callableWardRows: number;
}

/**
 * Who is eligible. ELIGIBILITY KEYS ON THE OFFERING FIRST: a ward the hospital stated it does not offer is
 * not in the result, in the chosen-ward view or under "Any". Nothing here reads a count or an age; the band
 * only becomes a RANK, which orders and never removes.
 *
 * M ("listed") is counted from the same rows the page can draw, never from facilities.length: a hospital
 * with no ward rows, with only hidden ones, or with no callable identity is neither shown nor counted.
 */
export function buildCandidates(
  facilities: readonly DecodedRow[],
  wards: readonly DecodedRow[],
  clock: ServeClock,
  ward: WardChoice,
  origin: Origin | null,
): Candidates {
  const byId = new Map<unknown, DecodedRow>(facilities.map((f) => [f['facility_id'], f]));
  const order: unknown[] = [];
  const groups = new Map<unknown, { identity: CallableIdentity; rows: { row: DecodedRow; parts: WardLineParts }[] }>();
  const dropped: { facility_id: unknown; category: unknown }[] = [];
  let callableWardRows = 0;
  for (const row of wards) {
    const id = row['facility_id'];
    const identity = callableIdentity(byId.get(id));
    if (identity === null) {
      dropped.push({ facility_id: id, category: row['category'] });
      continue;
    }
    callableWardRows += 1;
    let group = groups.get(id);
    if (group === undefined) {
      group = { identity, rows: [] };
      groups.set(id, group);
      order.push(id);
    }
    group.rows.push({ row, parts: wardLineParts(row, clock) });
  }

  const shown: Candidate[] = [];
  let listed = 0;
  for (const id of order) {
    const group = groups.get(id);
    const facility = byId.get(id);
    if (group === undefined || facility === undefined) continue;
    const visible = group.rows.filter((r) => !r.parts.hidden);
    if (visible.length === 0) continue;
    listed += 1;
    let chosen = visible;
    if (ward !== 'any') chosen = visible.filter((r) => r.row['category'] === ward);
    if (chosen.length === 0) continue;
    shown.push({
      id: String(id),
      identity: group.identity,
      facility,
      wards: chosen.map((r) => r.row),
      rank: ward === 'any' ? null : (chosen[0]?.parts.rank ?? null),
      distanceKm: distanceKm(origin, facility['lat'], facility['lng']),
    });
  }
  return { shown, listed, dropped, callableWardRows };
}

/** "default" is "Recent reports first" with a ward and "By name" under Any; "nearest" is "Nearest first". */
export type SortChoice = 'default' | 'nearest';

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const byText = (a: string, b: string): number => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
const byId = (a: Candidate, b: Candidate): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byName = (a: Candidate, b: Candidate): number => byText(a.identity.name, b.identity.name);
/** Distance ascending; a facility with no calculable distance goes last. */
const byDistance = (a: Candidate, b: Candidate): number => {
  if (a.distanceKm === null && b.distanceKm === null) return 0;
  if (a.distanceKm === null) return 1;
  if (b.distanceKm === null) return -1;
  return a.distanceKm - b.distanceKm;
};

/**
 * THE ORDER, in one function (GO-4 a). It returns facility ids.
 *
 *   "Recent reports first", with a ward: by rank, then by distance when there is an origin, then by name, then
 *     by facility id. A rank is a BAND: nothing finer, so a report from one minute ago never outranks one from
 *     fifty minutes ago in the same band.
 *   "By name", under Any: by name, then by id. No hospital-wide band is derived from unrelated wards.
 *   "Nearest first": by distance, then name, then id, keeping every row. A facility without a calculable
 *     distance goes last, in both distance orders.
 *
 * The caller holds the result between a visitor's actions (the frozen order below); calling this is a re-sort.
 */
export function orderFacilities(candidates: readonly Candidate[], sort: SortChoice, wardChosen: boolean, hasOrigin: boolean): string[] {
  const list = [...candidates];
  if (sort === 'nearest') {
    list.sort((a, b) => byDistance(a, b) || byName(a, b) || byId(a, b));
  } else if (wardChosen) {
    list.sort(
      (a, b) =>
        (a.rank ?? 4) - (b.rank ?? 4) || (hasOrigin ? byDistance(a, b) : 0) || byName(a, b) || byId(a, b),
    );
  } else {
    list.sort((a, b) => byName(a, b) || byId(a, b));
  }
  return list.map((c) => c.id);
}

/**
 * THE FROZEN ORDER (A3). Set when a visitor acts (the first draw, or any control), held while the page polls.
 * `ids` is the order, `ranks` is each hospital's rank at the moment the order was set, and `setAt` is the
 * Lagos wall time of that moment, read from the server's serve time and never the device clock (or null
 * where the page has no serve time).
 */
export interface FrozenOrder {
  readonly ids: string[];
  readonly ranks: Map<string, SearchRank | null>;
  readonly setAt: string | null;
}

/**
 * Re-apply a frozen order to a fresh poll's candidates. A hospital in the frozen order that is not eligible
 * right now is simply not drawn, and it keeps its place for a later poll that has it again (the order is
 * never pruned). A hospital whose id is NOT in the frozen order is new: it is appended after the frozen ones,
 * in name then id order, recorded in the frozen order at the rank it has now, and stays there until the next
 * re-sort. Nothing is removed because of age.
 */
export function applyFrozenOrder(frozen: FrozenOrder, candidates: readonly Candidate[]): Candidate[] {
  const byCandidateId = new Map(candidates.map((c) => [c.id, c]));
  const known = new Set(frozen.ids);
  const out: Candidate[] = [];
  for (const id of frozen.ids) {
    const c = byCandidateId.get(id);
    if (c !== undefined) out.push(c);
  }
  const fresh = candidates.filter((c) => !known.has(c.id)).sort((a, b) => byName(a, b) || byId(a, b));
  for (const c of fresh) {
    frozen.ids.push(c.id);
    frozen.ranks.set(c.id, c.rank);
    out.push(c);
  }
  return out;
}

/** True when any drawn hospital's rank now differs from its rank when the order was set. */
export function orderHasAged(frozen: FrozenOrder, drawn: readonly Candidate[]): boolean {
  return drawn.some((c) => frozen.ranks.has(c.id) && frozen.ranks.get(c.id) !== c.rank);
}

/** "12.3": one decimal, the figure after "About" in the distance words. */
export function kmText(km: number): string {
  return km.toFixed(1);
}
