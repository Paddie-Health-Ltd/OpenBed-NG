// @vitest-environment jsdom
/// <reference lib="dom" />
// DOM TYPES FOR THIS FILE ONLY, deliberately. The root tsconfig gives the whole
// repository ES2023 + node and NO DOM, which is a boundary rather than an oversight:
// server code that reaches for a browser global should not type-check. Only the app
// tsconfigs add DOM. This directive widens one file, and a project-wide `lib` edit
// to make one test compile would quietly remove that boundary everywhere.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { wardColumns, facilityColumns } from '../../packages/snapshot/src/codec.js';

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
