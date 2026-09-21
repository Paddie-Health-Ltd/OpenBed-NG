// @vitest-environment jsdom
/// <reference lib="dom" />
// DOM TYPES FOR THIS FILE ONLY, deliberately. The root tsconfig gives the whole
// repository ES2023 + node and NO DOM, which is a boundary rather than an oversight:
// server code that reaches for a browser global should not type-check. Only the app
// tsconfigs add DOM. This directive widens one file, and a project-wide `lib` edit
// to make one test compile would quietly remove that boundary everywhere.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { wardColumns, facilityColumns } from '../../packages/snapshot/src/codec.js';
// The ward-category vocabulary is DERIVED from the truth table, never restated here:
// a category added to the fixture must redden this file rather than slip past a
// hand-written list (test-conventions section 3).
import TRUTH_TABLE from '../../packages/fixtures/truth-table.json';

/**
 * THE EMPTY STATE IS ASSERTED AT THE RENDERED SURFACE (R-2026-09-20-29 E2).
 *
 * "No facility has joined yet" and "no beds are available" are DIFFERENT FACTS. A
 * page that renders both as an empty list presents absence of data as data, to a
 * reader who may be routing an ambulance. Observed 2026-09-20 on the live
 * `*.pages.dev` deployment: the served document carried `"wards":[]` and
 * `"facilities":[]`, and the page showed the emergency strip, the indicative-only
 * banner, and an empty list.
 *
 * WHY THE ASSERTION IS ON document.body.textContent AND NOT ON A RETURN VALUE.
 * The payload already carried the distinction and the renderer discarded it. A test
 * over the payload's honesty, or over a helper's return value, PASSES WHILE THE PAGE
 * LIES. This renders into a real DOM and reads the text a visitor would read. Same
 * move as Bundle 1 relocating the containment control onto the served document:
 * assert at the surface the reader actually receives.
 *
 * WHY THIS FILE IS IN THE COMPLIANCE PROJECT AND NOT IN e2e, which is where a
 * browser-ish test would naturally go: `scripts/run_e2e.sh` runs TWO NAMED FILES --
 * `tests/e2e/golden-path.test.ts` and `tests/e2e/ratchet.test.ts`. A new file under
 * `tests/e2e/` is never executed by CI, so this control would have been green
 * because nothing ran it. The `compliance` project is run wholesale
 * (`npx vitest run --project compliance`) by the required `compliance-tests` check,
 * so the control inherits protection without adding a CI job or touching branch
 * protection, which is the founder's.
 *
 * NOT ASSERTED HERE, deliberately (method note 12) -- this catches A RENDERER THAT
 * DISCARDS THE DISTINCTION, and nothing else:
 *   - CSS that hides the text: no stylesheet is loaded here, and a visually hidden
 *     element still has textContent.
 *   - A build step that strips or mangles it: this imports the module, not `dist`.
 *   - A DEPLOY THAT SHIPS A DIFFERENT ARTIFACT: the largest gap, and the live one.
 *     The Pages project is direct-upload, so what runs is whatever working tree was
 *     uploaded -- not necessarily this commit (R-2026-09-20-25). Only the deployment
 *     report, naming artifact, commit and command, closes that.
 */

const EMPTY_PAYLOAD = {
  v: 5048,
  wards: [],
  facilities: [],
  server_now: '2026-09-20T18:45:00.136688+00:00',
  generated_at: '2026-09-20T18:45:00.136688+00:00',
};

/**
 * One facility, one ward, in the served document's ENCODED shape: positional arrays
 * keyed to `snapshot-shape.json`'s column lists. Built FROM those lists rather than
 * written as literal arrays, so a column added to the fixture reddens this file
 * loudly instead of silently shifting every value one position.
 */
function encode(columns: readonly string[], values: Record<string, unknown>): unknown[] {
  const unknownKeys = Object.keys(values).filter((k) => !columns.includes(k));
  if (unknownKeys.length > 0) throw new Error(`fixture names columns the codec does not have: ${unknownKeys.join(', ')}`);
  return columns.map((c) => values[c] ?? null);
}

const FACILITY_ROW = encode(facilityColumns(), {
  facility_id: 'f1',
  name: 'Test Facility',
  lga: 'Ikeja',
  state: 'Lagos',
  lat: 6.6,
  lng: 3.35,
  public_phone_e164: '+2348000000000',
  updated_at: '2026-09-20T18:44:00+00:00',
});

const WARD_ROW = encode(wardColumns(), {
  facility_id: 'f1',
  category: 'A_AND_E',
  offering: 'OFFERED',
  bed_count: 3,
  accepting_effective: true,
  gated_by: null,
  state: 'REPORTED',
  source: 'WARD',
  monitoring_state: 'ACTIVE',
  updated_at: '2026-09-20T18:44:00+00:00',
});

const POPULATED_PAYLOAD = {
  v: 5049,
  wards: [WARD_ROW],
  facilities: [FACILITY_ROW],
  server_now: '2026-09-20T18:45:00.136688+00:00',
  generated_at: '2026-09-20T18:45:00.136688+00:00',
};

async function renderWith(payload: unknown): Promise<string> {
  document.body.innerHTML = '<main id="app"></main>';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })));
  // render() is awaited rather than re-importing the module: the module renders once
  // on import, so a second import would be testing the module cache, not the page.
  const { render } = await import('../../apps/public-dashboard/src/main.js');
  await render();
  return document.body.textContent ?? '';
}

describe('the public dashboard never renders an empty city as a bare zero', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  test('plant — the empty payload, which production served, must not render as an empty list', async () => {
    const text = await renderWith(EMPTY_PAYLOAD);
    expect(text, `the page rendered nothing a reader could act on:\n${text}`).toMatch(/no facility has joined/i);
    expect(text, 'the page did not deny being a bed-availability report').toMatch(/not a report that beds are unavailable/i);
    expect(
      document.querySelectorAll('#app li').length,
      'an empty list was rendered — the defect this test exists to catch',
    ).toBe(0);
  });

  test('the empty state says which fact it is, and does not claim the other', async () => {
    const text = (await renderWith(EMPTY_PAYLOAD)).toLowerCase();
    // The anti-vacuity direction for wording: it must not be satisfied by a page
    // that merely says "0 beds", which is the reading the rule forbids.
    expect(text).not.toMatch(/\b0 beds\b/);
  });

  test('positive control — a populated payload renders wards and NOT the empty-state wording', async () => {
    const text = await renderWith(POPULATED_PAYLOAD);
    expect(text, `the ward did not render:\n${text}`).toMatch(/Test Facility/);
    expect(text, 'the empty-state wording leaked onto a page that has data').not.toMatch(/no facility has joined/i);
    expect(document.querySelectorAll('#app li').length, 'the ward list did not render').toBe(1);
  });

  test('facilities joined but no ward reporting is a THIRD state, distinct from both', async () => {
    const text = await renderWith({ ...EMPTY_PAYLOAD, facilities: POPULATED_PAYLOAD.facilities });
    expect(text, `the third state was collapsed into one of the other two:\n${text}`).toMatch(/none has reported a ward/i);
    expect(text).not.toMatch(/no facility has joined/i);
  });
});

/**
 * THE OUTAGE STATE (R-2026-09-21-44), asserted at the same surface and for a
 * sharper reason than the empty state above.
 *
 * Until 2026-09-21 a failed fetch rendered a hard-coded list of two invented wards
 * with invented bed counts, under the words "showing example data" -- and both
 * rendered as OPEN AND ACCEPTING, because their duty flags were all UNKNOWN and an
 * unknown flag gates nothing. It reached real visitors on openbed.ng whenever the
 * snapshot could not be fetched, decoded or parsed.
 *
 * R-2026-09-20-29 E3 forbids rendering absence as "a bare zero". This is that rule
 * in the other direction: an outage must never render as an availability report.
 *
 * WHY THIS BLOCK EXISTS AT ALL, and it is the method note this change carries:
 * E2 relocated the assertion to the rendered surface, and the file you are reading
 * implemented it -- OVER renderReal ONLY. The path that fabricated data was never
 * rendered in any test. A control aimed at one renderer is not a control over the
 * hazard class.
 *
 * NOT ASSERTED HERE, deliberately: that the deployed artifact contains no example
 * data. That is a property of the BUILD, not of this module, and it is checked by
 * grepping the built bundle in the change that removed it -- named here so nobody
 * reads these legs as covering it.
 */

/** Every ward-category identifier the system knows, from the shared fixture. */
const WARD_CATEGORIES: readonly string[] = [
  ...new Set((TRUTH_TABLE as readonly { category: string }[]).map((r) => r.category)),
];

type FailureMode = 'non-2xx' | 'network' | 'timeout' | 'parse' | 'codec';

/**
 * Every way fetchSnapshot() can give up, per its own docblock. The timeout is
 * simulated by REJECTING with a TimeoutError rather than by hanging: the real path
 * waits 8s per attempt and would cost 16s here for nothing, and the module cannot
 * tell the two apart -- both land in the same bare `catch`.
 */
async function renderWithFailure(mode: FailureMode): Promise<string> {
  document.body.innerHTML = '<main id="app"></main>';
  const timeout = Object.assign(new Error('simulated timeout'), { name: 'TimeoutError' });
  const shortWard = [...Array(3).keys()];
  const responders: Record<FailureMode, () => Promise<Response>> = {
    'non-2xx': async () => new Response('', { status: 502 }),
    network: () => Promise.reject(new TypeError('Failed to fetch')),
    timeout: () => Promise.reject(timeout),
    parse: async () => new Response('this is not json', { status: 200 }),
    codec: async () =>
      new Response(JSON.stringify({ v: 1, generated_at: 'x', server_now: 'x', facilities: [], wards: [shortWard] }), {
        status: 200,
      }),
  };
  vi.stubGlobal('fetch', vi.fn(responders[mode]));
  const { render } = await import('../../apps/public-dashboard/src/main.js');
  await render();
  return document.body.textContent ?? '';
}

describe('a failed fetch renders an outage, never invented data', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  const MODES: FailureMode[] = ['non-2xx', 'network', 'timeout', 'parse', 'codec'];

  test.each(MODES)('%s — the page says it is an outage and denies being an availability report', async (mode) => {
    const text = await renderWithFailure(mode);
    expect(text, `the outage page said nothing a reader could act on:\n${text}`).toMatch(/can.t be loaded right now/i);
    expect(text, 'the outage page did not deny being a bed-availability report').toMatch(
      /not a report that beds are unavailable/i,
    );
    expect(text, 'the outage page did not point anywhere').toMatch(/112 \/ 767/);
  });

  test.each(MODES)('%s — NO INVENTED BED COUNT reaches the page', async (mode) => {
    const text = await renderWithFailure(mode);
    expect(text, `a bed count rendered on an outage page:\n${text}`).not.toMatch(/\d+\s*beds/i);
    expect(
      document.querySelectorAll('#app li').length,
      'the outage page rendered a list — a row is a thing to be misread',
    ).toBe(0);
  });

  test.each(MODES)('%s — NO WARD CATEGORY reaches the page', async (mode) => {
    const text = await renderWithFailure(mode);
    for (const category of WARD_CATEGORIES) {
      expect(text, `the ward category ${category} rendered on an outage page:\n${text}`).not.toContain(category);
    }
  });

  test('the outage state is NOT the empty state — they are different facts', async () => {
    const text = await renderWithFailure('network');
    expect(text, 'an outage was reported as "no facility has joined", which is a claim about the world').not.toMatch(
      /no facility has joined/i,
    );
  });

  /**
   * ANTI-VACUITY FOR THE TWO NEGATIVE ASSERTIONS ABOVE, and it is the leg that makes
   * them mean anything. `not.toMatch(/\d+ beds/)` and `not.toContain(category)` pass
   * trivially against a blank page, a thrown render, or a matcher that can never
   * match. So the SAME two matchers are run against the populated page, where they
   * MUST fire.
   */
  test('anti-vacuity — the same two matchers DO fire on a populated page', async () => {
    const text = await renderWith(POPULATED_PAYLOAD);
    expect(text, 'the bed-count matcher cannot match anything, so its negation proves nothing').toMatch(/\d+\s*beds/i);
    expect(
      WARD_CATEGORIES.some((c) => text.includes(c)),
      'the category matcher cannot match anything, so its negation proves nothing',
    ).toBe(true);
  });
});
