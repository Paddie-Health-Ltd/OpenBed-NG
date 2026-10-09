import { describe, expect, test } from 'vitest';
import { decodeFacility, decodeWard, type DecodedRow } from '../../packages/snapshot/src/codec.js';
import { searchRank } from '../../packages/snapshot/src/freshness.js';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';
import LGA from '../../packages/fixtures/lga-reference-points.json';
import TABLE from '../../packages/labels/public-labels.json';
import {
  applyFrozenOrder,
  buildCandidates,
  callableIdentity,
  distanceKm,
  haversineKm,
  kmText,
  orderFacilities,
  orderHasAged,
  parseSearch,
  WARD_SYNONYMS,
  WARD_VALUES,
  wardSlug,
  writeSearch,
  type Candidate,
  type FrozenOrder,
  type SortChoice,
} from '../../apps/public-dashboard/src/search.js';
import { facilityRow, MIN, wardRow, type FacilitySpec, type WardSpec } from './_search_harness.js';

/**
 * THE PURE SEARCH LAYER (R-2026-10-09 GO, B; the design report's section 8, "Unit -- search.ts").
 *
 * Every expectation is a LITERAL, never the function's own output (test-conventions section 7): the
 * orders are written out, the haversine vectors were computed twice by two formulas (the haversine and
 * the spherical law of cosines, which agree to four decimals) before being typed here, and the
 * synonym table is held against the label table by identity.
 *
 * Each control carries its PLANT: a wrong implementation, built here, that the same assertion helper
 * must reject, so the helper is shown to be able to fail. Where an assertion helper is run over the
 * real function it is the ACCEPT leg, and an empty input is its ANTI-VACUITY leg.
 *
 * NOT ASSERTED HERE, deliberately: how any of this looks, or that a screen reader reads it as intended.
 * jsdom lays nothing out. That is the screenshots, read by Cowork, and the handset check, the founder's.
 */

const B = SHAPE.freshnessBands;
const SERVED = Date.parse('2026-09-23T03:13:00.000Z');
const clock = { servedAt: new Date(SERVED).toISOString(), elapsedMs: 0 };
const GEN = Date.parse('2026-09-23T03:12:00.000Z');

const fac = (id: string, name: string, extra: Partial<FacilitySpec> = {}): DecodedRow => decodeFacility(facilityRow({ id, name, ...extra }) as never);
/** A ward that last reported `ageMin` minutes before the serve time. */
const ward = (facility: string, category: string, ageMin: number, extra: Partial<WardSpec> = {}): DecodedRow =>
  decodeWard(wardRow({ facility, category, agoMin: ageMin - 1, ...extra }) as never);

const APAPA = { lat: LGA.points.find((p) => p.slug === 'apapa')?.lat as number, lng: LGA.points.find((p) => p.slug === 'apapa')?.lng as number };

/** A candidate with only what an order reads. */
const cand = (id: string, name: string, rank: number | null, distance: number | null): Candidate =>
  ({ id, identity: { name, phone: '+2348000000001' }, facility: {} as DecodedRow, wards: [], rank: rank as Candidate['rank'], distanceKm: distance });

type OrderFn = (c: readonly Candidate[], sort: SortChoice, wardChosen: boolean, hasOrigin: boolean) => string[];

// ---------------------------------------------------------------------------
// searchRank, the band order.
// ---------------------------------------------------------------------------

describe('searchRank — fresh, ageing, stale, then unknown or suppressed or paused, then not yet reported', () => {
  test.each([
    [{ state: 'claim', band: 'GREEN' }, 0],
    [{ state: 'claim', band: 'YELLOW' }, 1],
    [{ state: 'claim', band: 'GREY' }, 2],
    [{ state: 'claim', band: 'SUPPRESSED' }, 3],
    [{ state: 'claim', band: null }, 3],
    [{ state: 'unreadable' }, 3],
    [{ state: 'paused' }, 3],
    [{ state: 'not-yet-reported' }, 4],
  ] as const)('%j ranks %i', (input, rank) => {
    expect(searchRank(input)).toBe(rank);
  });

  test('anti-vacuity — five distinct ranks exist, and every one is reachable', () => {
    const all = [
      searchRank({ state: 'claim', band: 'GREEN' }), searchRank({ state: 'claim', band: 'YELLOW' }), searchRank({ state: 'claim', band: 'GREY' }),
      searchRank({ state: 'paused' }), searchRank({ state: 'not-yet-reported' }),
    ];
    expect(new Set(all).size).toBe(5);
  });
});

describe('T-ORD-3 — a ward exactly on a band boundary ranks in the OLDER band, boundaries read from the fixture', () => {
  const rankAt = (ageMin: number): number | null => {
    const found = buildCandidates([fac('f1', 'Boundary')], [ward('f1', 'MATERNITY', ageMin)], clock, 'MATERNITY', null);
    return found.shown[0]?.rank ?? null;
  };
  test.each([
    ['just under the green ceiling', B.greenUnderMinutes - 1, 0],
    ['exactly the green ceiling', B.greenUnderMinutes, 1],
    ['just under the yellow ceiling', B.yellowUnderMinutes - 1, 1],
    ['exactly the yellow ceiling', B.yellowUnderMinutes, 2],
    ['just under the suppression ceiling', B.suppressAfterHours * 60 - 1, 2],
    ['exactly the suppression ceiling', B.suppressAfterHours * 60, 3],
  ])('%s', (_name, age, rank) => {
    expect(rankAt(age)).toBe(rank);
  });
});

// ---------------------------------------------------------------------------
// The order.
// ---------------------------------------------------------------------------

/**
 * Every way an ordering function can be wrong about the ruled order, as messages. Pure over the function, so the plants below feed it
 * a wrong implementation and the real one is the ACCEPT leg.
 */
export function orderingViolations(fn: OrderFn): string[] {
  const out: string[] = [];
  // T-ORD-1: the same band, ordered by distance (with an origin) or name (without), NEVER by how recently. The two wards are 5 and 25
  // minutes old, both GREEN under the fixture's thresholds; the farther one reported more recently.
  const near = cand('b', 'Nearer Hospital', 0, 2);
  const far = cand('a', 'Farther Hospital', 0, 9);
  if (fn([far, near], 'default', true, true).join() !== 'b,a') out.push('same band with an origin: the nearer hospital is not first');
  if (fn([near, far], 'default', true, false).join() !== 'a,b') out.push('same band without an origin: the order is not by name');
  // T-ORD-2: every pair of ranks, fresh before ageing before stale before unknown before not yet reported.
  const ranks = [0, 1, 2, 3, 4];
  for (const hi of ranks) {
    for (const lo of ranks) {
      if (hi >= lo) continue;
      const got = fn([cand('z', 'Zed', lo, 1), cand('a', 'Alpha', hi, 9)], 'default', true, true).join();
      if (got !== 'a,z') out.push(`rank ${hi} did not come before rank ${lo}`);
    }
  }
  // T-ORD-4: "Nearest first" ignores bands and keeps every row, including the not-yet-reported and the suppressed.
  const rows = [cand('c', 'Suppressed Near', 3, 1), cand('d', 'Fresh Far', 0, 8), cand('e', 'Never Reported Middle', 4, 4)];
  if (fn(rows, 'nearest', true, true).join() !== 'c,e,d') out.push('"Nearest first" did not order by distance whatever the band');
  if (fn(rows, 'nearest', true, true).length !== 3) out.push('"Nearest first" dropped a row');
  // A facility with no calculable distance goes last in both distance orders.
  const noDistance = [cand('n', 'No Distance', 0, null), cand('m', 'Has Distance', 4, 20)];
  if (fn(noDistance, 'nearest', true, true).join() !== 'm,n') out.push('"Nearest first": a hospital with no distance was not last');
  if (fn(noDistance, 'default', true, true).join() !== 'n,m') out.push('with a ward and an origin, the band still decides before the distance');
  const sameBandNoDistance = [cand('n', 'Aaa No Distance', 0, null), cand('m', 'Zzz Has Distance', 0, 20)];
  if (fn(sameBandNoDistance, 'default', true, true).join() !== 'm,n') out.push('in one band, a hospital with no distance was not after one with a distance');
  // T-ORD-5: under Any there is no band at all: name without an origin, and the order is by name with one too ("Recent reports first" is a ward-only order).
  const any = [cand('x', 'Beta', null, 1), cand('y', 'Alpha', null, 9)];
  if (fn(any, 'default', false, false).join() !== 'y,x') out.push('under Any, the order is not by name');
  if (fn(any, 'nearest', false, true).join() !== 'x,y') out.push('under Any, "Nearest first" is not by distance');
  // T-ORD-6: the last key is the facility id, so the same input in any order gives the same output.
  const ties = [cand('3', 'Same', 0, 5), cand('1', 'Same', 0, 5), cand('2', 'Same', 0, 5)];
  const a = fn(ties, 'default', true, true).join();
  const b = fn([...ties].reverse(), 'default', true, true).join();
  if (a !== '1,2,3' || b !== '1,2,3') out.push('equal keys were not ordered by facility id');
  return out;
}

describe('the order (GO-4 a) — one function, held against every ruled case', () => {
  test('real orderFacilities is accepted — every pair of ranks, the distance orders, the name order and the id tie-break', () => {
    expect(orderingViolations(orderFacilities)).toEqual([]);
  });

  // Plants: each wrong comparator, each shown rejected by NAME.
  const plants: [string, OrderFn, string][] = [
    ['a comparator that breaks a tie on how recently the ward reported', (c) => c.slice().sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0) || cRecency(x) - cRecency(y) || x.id.localeCompare(y.id)).map((x) => x.id), 'same band with an origin'],
    ['a comparator that puts the not-yet-reported first', (c) => c.slice().sort((x, y) => (y.rank ?? 0) - (x.rank ?? 0) || x.id.localeCompare(y.id)).map((x) => x.id), 'did not come before'],
    ['a comparator that sorts the unknown band before the stale one', (c, s, w, o) => orderFacilities(c.map((x) => ({ ...x, rank: x.rank === 3 ? 2 : x.rank === 2 ? 3 : x.rank })) as Candidate[], s, w, o), 'did not come before'],
    ['a "Nearest first" that drops the rows with no count (rank 3)', (c, s, w, o) => orderFacilities(s === 'nearest' ? c.filter((x) => x.rank !== 3) : c, s, w, o), '"Nearest first" dropped a row'],
    ['a comparator that puts no-distance hospitals first', (c) => c.slice().sort((x, y) => (x.distanceKm ?? -1) - (y.distanceKm ?? -1) || x.id.localeCompare(y.id)).map((x) => x.id), 'with no distance was not last'],
    ['an Any that derives a band from a hospital and sorts by it', (c, s, w, o) => (w ? orderFacilities(c, s, w, o) : c.slice().sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0) || 0).map((x) => x.id)), 'under Any'],
    ['an order with no last key, so equal keys keep the order they arrived in', (c) => c.map((x) => x.id), 'equal keys were not ordered by facility id'],
  ];
  test.each(plants)('plant — %s is rejected', (_name, fn, message) => {
    const out = orderingViolations(fn);
    expect(out.join('\n'), 'the plant was not caught').toContain(message);
  });

  test('anti-vacuity — an order over no hospitals is empty, and the helper over a function that returns nothing is rejected', () => {
    expect(orderFacilities([], 'default', true, true)).toEqual([]);
    expect(orderingViolations(() => []).length).toBeGreaterThan(0);
  });
});

/** Minutes since a candidate reported: the plant above sorts on this, which the real order has no access to. The farther hospital ('a') is the more recent. */
function cRecency(c: Candidate): number {
  return c.id === 'a' ? 5 : 25;
}

// ---------------------------------------------------------------------------
// Eligibility: the offering first, and nothing else filters.
// ---------------------------------------------------------------------------

describe('eligibility keys on the offering, and on nothing else (A1)', () => {
  const facilities = [fac('f1', 'Alpha'), fac('f2', 'Beta')];
  const eligible = (wards: DecodedRow[], choice: string) => buildCandidates(facilities, wards, clock, choice, null);

  test('T-ELIG-1 — zero is not unknown: 0 beds is a claim ranked by its band, null is "not reported" in a claim and carries no digit', () => {
    const zero = eligible([ward('f1', 'MATERNITY', 5, { bed: 0 })], 'MATERNITY');
    expect(zero.shown[0]?.rank).toBe(0);
    const never = eligible([ward('f1', 'MATERNITY', 0, { monitoring: 'PENDING', bed: null })], 'MATERNITY');
    expect(never.shown[0]?.rank).toBe(4);
  });

  test('T-ELIG-2 — NOT_OFFERED is excluded from that ward\'s search and from Any: the only filter', () => {
    const wards = [ward('f1', 'MATERNITY', 5, { offering: 'NOT_OFFERED' }), ward('f1', 'A_AND_E', 5), ward('f2', 'MATERNITY', 5)];
    expect(eligible(wards, 'MATERNITY').shown.map((c) => c.id)).toEqual(['f2']);
    const any = eligible(wards, 'any');
    expect(any.shown.map((c) => c.id)).toEqual(['f1', 'f2']);
    expect(any.shown[0]?.wards.map((w) => w['category'])).toEqual(['A_AND_E']);
  });

  test('plant — an exclusion keyed on bed_count === null instead of on the offering is rejected: a never-reported offered ward must stay', () => {
    const wards = [ward('f1', 'MATERNITY', 0, { monitoring: 'PENDING', bed: null }), ward('f2', 'MATERNITY', 5, { offering: 'NOT_OFFERED', bed: null })];
    const real = eligible(wards, 'MATERNITY').shown.map((c) => c.id);
    expect(real).toEqual(['f1']);
    const planted = wards.filter((w) => w['bed_count'] !== null).map((w) => w['facility_id']);
    expect(planted, 'the planted exclusion agreed with the real one, so it proved nothing').not.toEqual(real);
  });

  test('T-ELIG-3 — OFFERED + null + PENDING is included, ranked last', () => {
    const r = eligible([ward('f1', 'NICU', 0, { monitoring: 'PENDING', bed: null })], 'NICU');
    expect(r.shown.map((c) => c.id)).toEqual(['f1']);
    expect(r.shown[0]?.rank).toBe(4);
  });

  test('T-ELIG-4 — a hospital whose every eligible ward is suppressed is still in the result, with its identity', () => {
    const r = eligible([ward('f1', 'MATERNITY', B.suppressAfterHours * 60 + 30), ward('f2', 'MATERNITY', B.suppressAfterHours * 60 + 90)], 'MATERNITY');
    expect(r.shown.map((c) => c.identity.name)).toEqual(['Alpha', 'Beta']);
    expect(r.shown.map((c) => c.rank)).toEqual([3, 3]);
  });

  test('plant — a filter on the band is rejected by the same expectation: dropping rank 3 leaves no hospital', () => {
    const r = eligible([ward('f1', 'MATERNITY', B.suppressAfterHours * 60 + 30)], 'MATERNITY');
    expect(r.shown.filter((c) => c.rank !== 3), 'the planted band filter did not empty the result').toEqual([]);
    expect(r.shown.length, 'the real result lost the suppressed hospital').toBe(1);
  });

  test('an unreadable offering is SHOWN, as "Status unknown", never hidden (A1, item 1)', () => {
    const r = eligible([ward('f1', 'MATERNITY', 5, { offering: 'MAYBE' })], 'MATERNITY');
    expect(r.shown.map((c) => c.id)).toEqual(['f1']);
    expect(r.shown[0]?.rank).toBe(3);
  });

  test('M counts hospitals with a callable identity and at least one ward not NOT_OFFERED; a hospital with only hidden wards or none counts in neither N nor M (A5)', () => {
    const three = [fac('f1', 'Alpha'), fac('f2', 'Beta'), fac('f3', 'Gamma'), fac('f4', 'Delta')];
    const wards = [
      ward('f1', 'MATERNITY', 5), ward('f1', 'A_AND_E', 5),
      ward('f2', 'MATERNITY', 5, { offering: 'NOT_OFFERED' }), // only hidden: neither
      ward('f3', 'A_AND_E', 5), // offers something else: M yes, N no under MATERNITY
    ];
    const r = buildCandidates(three, wards, clock, 'MATERNITY', null);
    expect(r.shown.map((c) => c.id)).toEqual(['f1']);
    expect(r.listed).toBe(2);
    const all = buildCandidates(three, wards, clock, 'any', null);
    expect(all.shown.length).toBe(all.listed);
    expect(all.listed, 'M must not be facilities.length').not.toBe(three.length);
  });

  test('a facility with no callable identity is dropped, by id and category only, and is in neither count', () => {
    const r = buildCandidates([fac('f1', 'Alpha'), fac('f9', '   ')], [ward('f1', 'A_AND_E', 5), ward('f9', 'A_AND_E', 5)], clock, 'any', null);
    expect(r.shown.map((c) => c.id)).toEqual(['f1']);
    expect(r.dropped).toEqual([{ facility_id: 'f9', category: 'A_AND_E' }]);
    expect(callableIdentity(undefined)).toBeNull();
  });

  test('anti-vacuity — no wards, no facilities and no callable identity give an empty result and a zero', () => {
    const r = buildCandidates([], [], clock, 'any', null);
    expect(r).toEqual({ shown: [], listed: 0, dropped: [], callableWardRows: 0 });
  });
});

// ---------------------------------------------------------------------------
// Distance.
// ---------------------------------------------------------------------------

describe('T-DIST — straight-line distance, vectors computed twice by two formulas and written as literals', () => {
  /** Everything wrong with a haversine implementation, as messages. */
  function distanceViolations(fn: (a: number, b: number, c: number, d: number) => number): string[] {
    const out: string[] = [];
    const near = (got: number, want: number): boolean => Math.abs(got - want) < 0.001;
    if (!near(fn(0, 0, 0, 1), 111.195)) out.push('one degree of longitude at the equator is not 111.195 km');
    const ajeromi = LGA.points.find((p) => p.slug === 'ajeromi-ifelodun');
    const ikeja = LGA.points.find((p) => p.slug === 'ikeja');
    if (!near(fn(APAPA.lat, APAPA.lng, ajeromi?.lat as number, ajeromi?.lng as number), 3.748)) out.push('Apapa to Ajeromi-Ifelodun is not 3.748 km');
    if (!near(fn(APAPA.lat, APAPA.lng, ikeja?.lat as number, ikeja?.lng as number), 17.494)) out.push('Apapa to Ikeja is not 17.494 km');
    // A swapped latitude and longitude is a different place: this pair is wrong by tens of kilometres when swapped.
    if (near(fn(APAPA.lng, APAPA.lat, ikeja?.lng as number, ikeja?.lat as number), 17.494)) out.push('swapping latitude and longitude changed nothing');
    return out;
  }

  test('real haversineKm is accepted', () => {
    expect(distanceViolations(haversineKm)).toEqual([]);
  });

  test.each([
    ['the wrong radius (6371 mistyped as 6731)', (a: number, b: number, c: number, d: number) => haversineKm(a, b, c, d) * (6731 / 6371), 'is not 111.195 km'],
    ['degrees where radians belong', (a: number, b: number, c: number, d: number) => {
      const dl = c - a;
      const dn = d - b;
      return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(a) * Math.cos(c) * Math.sin(dn / 2) ** 2)));
    }, 'is not 111.195 km'],
    ['a longitude and latitude that are always swapped', (a: number, b: number, c: number, d: number) => haversineKm(b, a, d, c), 'is not'],
  ])('plant — %s is rejected', (_name, fn, message) => {
    expect(distanceViolations(fn).join('\n')).toContain(message);
  });

  test('T-DIST-2 — non-finite or out-of-range coordinates are "no distance", never NaN, never zero', () => {
    const o = { lat: 6.4, lng: 3.3 };
    expect(distanceKm(o, null, 3.3)).toBeNull();
    expect(distanceKm(o, 'x', 3.3)).toBeNull();
    expect(distanceKm(o, Number.NaN, 3.3)).toBeNull();
    expect(distanceKm(o, 91, 3.3)).toBeNull();
    expect(distanceKm(o, 6.4, 181)).toBeNull();
    expect(distanceKm(null, 6.4, 3.3)).toBeNull();
    expect(distanceKm(o, 6.4, 3.3)).toBe(0);
  });

  test('T-DIST-3 — a starting point never removes a hospital: the same wards, with and without an origin, give the same set', () => {
    const facilities = [fac('f1', 'Alpha', { lat: 6.45, lng: 3.37 }), fac('f2', 'Beta', { lat: 6.60, lng: 3.35 }), fac('f3', 'Gamma', { lat: null, lng: null })];
    const wards = facilities.map((f) => ward(f['facility_id'] as string, 'MATERNITY', 5));
    const without = buildCandidates(facilities, wards, clock, 'MATERNITY', null).shown.map((c) => c.id).sort();
    const withOrigin = buildCandidates(facilities, wards, clock, 'MATERNITY', APAPA).shown.map((c) => c.id).sort();
    expect(withOrigin).toEqual(without);
    expect(withOrigin).toEqual(['f1', 'f2', 'f3']);
  });

  test('kmText writes one decimal', () => {
    expect(kmText(3.7477)).toBe('3.7');
    expect(kmText(17.4938)).toBe('17.5');
    expect(kmText(0)).toBe('0.0');
  });
});

// ---------------------------------------------------------------------------
// The address.
// ---------------------------------------------------------------------------

describe('T-PARSE-1 — the address is read through two fixed tables, and only `ward` and `area`', () => {
  const slugs = LGA.points.map((p) => p.slug);

  test.each([
    ['', { ward: 'any', area: null }],
    ['?ward=maternity&area=apapa', { ward: 'MATERNITY', area: 'apapa' }],
    ['?area=lagos-island', { ward: 'any', area: 'lagos-island' }],
    ['?ward=a_and_e', { ward: 'A_AND_E', area: null }],
    ['?ward=MATERNITY', { ward: 'any', area: null }],
    ['?ward=Maternity', { ward: 'any', area: null }],
    ['?ward=burns&area=nowhere', { ward: 'any', area: null }],
    ['?ward=maternity&ward=nicu', { ward: 'MATERNITY', area: null }],
    ['?area=apapa&area=ikeja', { ward: 'any', area: 'apapa' }],
    [`?ward=${'a'.repeat(10_000)}`, { ward: 'any', area: null }],
    [`?area=${'a'.repeat(10_000)}`, { ward: 'any', area: null }],
    ['?ward=%3Cscript%3Ealert(1)%3C%2Fscript%3E', { ward: 'any', area: null }],
    ['?area=%E2%82%AC%F0%9F%8F%A5', { ward: 'any', area: null }],
    ['?ward=', { ward: 'any', area: null }],
    ['?area=%20apapa', { ward: 'any', area: null }],
  ])('%s', (search, want) => {
    expect(parseSearch(search)).toEqual(want);
  });

  test.each(['lat', 'lng', 'lon', 'latitude', 'longitude', 'coords', 'near', 'll'])('a `%s` key is ignored: it cannot carry an origin in', (key) => {
    expect(parseSearch(`?${key}=6.5,3.4&ward=maternity`)).toEqual({ ward: 'MATERNITY', area: null });
    expect(writeSearch(parseSearch(`?${key}=6.5,3.4&ward=maternity`))).toBe('?ward=maternity');
  });

  test('every value the writer can emit round-trips, and an area slug and a ward slug are exactly the tables\'', () => {
    for (const w of WARD_VALUES) for (const a of [null, ...slugs]) {
      const state = { ward: w, area: a };
      expect(parseSearch(writeSearch(state))).toEqual(state);
    }
    expect(writeSearch({ ward: 'any', area: null })).toBe('');
    expect(WARD_VALUES.map(wardSlug)).toEqual(['a_and_e', 'icu_adult', 'icu_paediatric', 'medical_adult', 'paediatric', 'theatre', 'surgical', 'maternity', 'nicu', 'scbu']);
  });

  test('plant — a parser that echoes raw input is rejected: an unknown ward must not survive into the written address', () => {
    const echo = (search: string): { ward: string; area: string | null } => ({ ward: new URLSearchParams(search).get('ward') ?? 'any', area: null });
    expect(echo('?ward=burns').ward, 'the plant did not echo').toBe('burns');
    expect(writeSearch(parseSearch('?ward=burns')), 'the real parser let an unknown ward through').toBe('');
  });

  test('T-PARSE-2 — the writer takes the search state and nothing else, so no position can reach it; it ignores a value outside its tables', () => {
    expect(writeSearch({ ward: 'MATERNITY', area: null })).toBe('?ward=maternity');
    expect(writeSearch({ ward: 'burns', area: 'nowhere' })).toBe('');
    expect(writeSearch.length, 'the writer grew a parameter, which a position could ride in on').toBe(1);
  });

  test('anti-vacuity — the 20 areas and 10 wards are all there', () => {
    expect(slugs.length).toBe(20);
    expect(WARD_VALUES.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// The synonym table.
// ---------------------------------------------------------------------------

/** Mock v5's words, exactly as Cowork gave them (R-2026-10-09 GO, Addendum 2, item 2), by category. A second copy of the table, on purpose: it decays loudly. */
const MOCK_V5: Record<string, string[]> = {
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

/** Everything wrong with a synonym table against the labels and mock v5's words, as messages. Pure, so the plants feed it a changed table. */
export function synonymViolations(table: Readonly<Record<string, readonly string[]>>): string[] {
  const out: string[] = [];
  const categories = Object.keys(TABLE.labels.ward_category).sort();
  if (JSON.stringify(Object.keys(table).sort()) !== JSON.stringify(categories)) out.push(`the table's categories are not the ten of the label table: ${JSON.stringify(Object.keys(table).sort())}`);
  for (const [category, words] of Object.entries(table)) {
    if (words.length === 0) out.push(`${category} has no synonym`);
    if (new Set(words).size !== words.length) out.push(`${category} repeats a word`);
    for (const w of words) if (w !== w.toLowerCase() || w.trim() !== w || w === '') out.push(`${category}: "${w}" is not a lower-case word or phrase`);
    if (JSON.stringify(words) !== JSON.stringify(MOCK_V5[category])) out.push(`${category}: ${JSON.stringify(words)} is not mock v5's ${JSON.stringify(MOCK_V5[category])}`);
  }
  return out;
}

describe('the synonym table (GO-4 d; Addendum 2 item 2) — mock v5\'s words, one entry per ward category, validated against the labels by identity', () => {
  test('real WARD_SYNONYMS is accepted: the ten categories of the label table, each exactly mock v5\'s words', () => {
    expect(synonymViolations(WARD_SYNONYMS)).toEqual([]);
    expect([...WARD_VALUES].sort()).toEqual(Object.keys(TABLE.labels.ward_category).sort());
  });

  test('a word may belong to more than one category on purpose, and the ones that do are exactly these', () => {
    const owners = new Map<string, string[]>();
    for (const [category, words] of Object.entries(WARD_SYNONYMS)) for (const w of words) owners.set(w, [...(owners.get(w) ?? []), category]);
    const shared = Object.fromEntries([...owners].filter(([, c]) => c.length > 1).sort(([a], [b]) => a.localeCompare(b)));
    expect(shared).toEqual({
      adult: ['ICU_ADULT', 'MEDICAL_ADULT'],
      babies: ['NICU', 'SCBU'],
      baby: ['NICU', 'SCBU'],
      child: ['PAEDIATRIC', 'ICU_PAEDIATRIC'],
      children: ['PAEDIATRIC', 'ICU_PAEDIATRIC'],
      icu: ['ICU_ADULT', 'ICU_PAEDIATRIC'],
      infant: ['NICU', 'SCBU'],
      intensive: ['NICU', 'ICU_ADULT', 'ICU_PAEDIATRIC'],
      kids: ['PAEDIATRIC', 'ICU_PAEDIATRIC'],
      neonatal: ['NICU', 'SCBU'],
      newborn: ['NICU', 'SCBU'],
      paediatric: ['PAEDIATRIC', 'ICU_PAEDIATRIC'],
      pediatric: ['PAEDIATRIC', 'ICU_PAEDIATRIC'],
      surgery: ['THEATRE', 'SURGICAL'],
    });
  });

  test.each([
    ['labour', 'MATERNITY'], ['delivery', 'MATERNITY'], ['pregnancy', 'MATERNITY'], ['children', 'PAEDIATRIC'], ['kids', 'PAEDIATRIC'],
  ])('the clinicians\' own examples: "%s" is a synonym of %s', (word, category) => {
    expect(WARD_SYNONYMS[category]).toContain(word);
  });

  test.each<[string, (t: Record<string, string[]>) => void, string]>([
    ['a category missing', (t) => { delete t['NICU']; }, 'not the ten of the label table'],
    ['a category the labels lack', (t) => { t['BURNS_UNIT'] = ['burns']; }, 'not the ten of the label table'],
    ['one word changed', (t) => { (t['MATERNITY'] as string[])[1] = 'labor ward'; }, 'MATERNITY'],
    ['one word added', (t) => { (t['SCBU'] as string[]).push('cot'); }, 'SCBU'],
    ['one word removed', (t) => { (t['ICU_ADULT'] as string[]).pop(); }, 'ICU_ADULT'],
    ['a word in capitals', (t) => { (t['THEATRE'] as string[])[0] = 'Theatre'; }, 'not a lower-case word'],
    ['a repeated word', (t) => { (t['SURGICAL'] as string[]).push('surgery'); }, 'repeats a word'],
  ])('plant — %s is rejected', (_name, plant, message) => {
    const copy: Record<string, string[]> = JSON.parse(JSON.stringify(WARD_SYNONYMS));
    plant(copy);
    expect(synonymViolations(copy).join('\n')).toContain(message);
  });

  test('anti-vacuity — an empty table is rejected', () => {
    expect(synonymViolations({}).join('\n')).toContain('not the ten of the label table');
  });
});

// ---------------------------------------------------------------------------
// The frozen order, as a pure function.
// ---------------------------------------------------------------------------

describe('the frozen order (A3), pure', () => {
  const frozenOf = (ids: string[], ranks: Record<string, number | null>): FrozenOrder => ({ ids: [...ids], ranks: new Map(Object.entries(ranks)) as FrozenOrder['ranks'], setAt: '04:13' });
  const c = (id: string, name: string, rank: number | null): Candidate => cand(id, name, rank, null);

  /** Everything wrong with an apply-the-frozen-order function, as messages. */
  function frozenViolations(apply: (f: FrozenOrder, cs: readonly Candidate[]) => Candidate[]): string[] {
    const out: string[] = [];
    // The frozen order wins over the rank the poll now gives: B was first, and has aged below A.
    const f1 = frozenOf(['b', 'a'], { a: 1, b: 0 });
    if (apply(f1, [c('a', 'Alpha', 0), c('b', 'Beta', 2)]).map((x) => x.id).join() !== 'b,a') out.push('a poll re-sorted the frozen order');
    // A hospital missing from one poll keeps its place for the next.
    const f2 = frozenOf(['a', 'b', 'c'], { a: 0, b: 0, c: 0 });
    apply(f2, [c('a', 'A', 0), c('c', 'C', 0)]);
    if (f2.ids.join() !== 'a,b,c') out.push('a hospital missing from a poll was pruned from the frozen order');
    if (apply(f2, [c('c', 'C', 0), c('b', 'B', 0), c('a', 'A', 0)]).map((x) => x.id).join() !== 'a,b,c') out.push('a hospital returning after a poll did not return to its frozen place');
    // A new hospital is appended, after the frozen ones, in name then id order.
    const f3 = frozenOf(['a', 'b'], { a: 0, b: 0 });
    const got = apply(f3, [c('n2', 'Zulu', 0), c('b', 'B', 0), c('n1', 'Alpha New', 0), c('a', 'A', 0)]).map((x) => x.id).join();
    if (got !== 'a,b,n1,n2') out.push('a new hospital was not appended after the frozen ones in name order');
    if (f3.ids.join() !== 'a,b,n1,n2') out.push('a new hospital was not recorded in the frozen order');
    return out;
  }

  test('real applyFrozenOrder is accepted', () => {
    expect(frozenViolations(applyFrozenOrder)).toEqual([]);
  });

  test.each<[string, (f: FrozenOrder, cs: readonly Candidate[]) => Candidate[], string]>([
    ['a re-sort on every draw', (f, cs) => cs.slice().sort((x, y) => (x.rank ?? 0) - (y.rank ?? 0)), 'a poll re-sorted the frozen order'],
    ['a prune of every hospital the poll did not return', (f, cs) => { f.ids.splice(0, f.ids.length, ...cs.map((x) => x.id)); return cs.slice(); }, 'was pruned'],
    ['a new hospital inserted in place by name', (f, cs) => cs.slice().sort((x, y) => x.identity.name.localeCompare(y.identity.name)), 'a poll re-sorted the frozen order'],
  ])('plant — %s is rejected', (_name, apply, message) => {
    expect(frozenViolations(apply).join('\n')).toContain(message);
  });

  test('orderHasAged — true only when a drawn hospital\'s rank now differs from when the order was set', () => {
    const f = frozenOf(['a', 'b'], { a: 0, b: 1 });
    expect(orderHasAged(f, [c('a', 'A', 0), c('b', 'B', 1)])).toBe(false);
    expect(orderHasAged(f, [c('a', 'A', 1), c('b', 'B', 1)])).toBe(true);
    expect(orderHasAged(f, [c('x', 'New', 4)]), 'a hospital not in the order is new, not aged').toBe(false);
    expect(orderHasAged(f, [])).toBe(false);
  });
});

/** The row builders are shared with the rendered tests; this keeps MIN honestly used. */
export const ONE_MINUTE_MS = MIN;
void GEN;
