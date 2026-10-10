// @vitest-environment jsdom
/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';
import TABLE from '../../packages/labels/public-labels.json';
import { releaseTimers } from './_dashboard_import.js';
import { app, cards, openPage, type World } from './_search_harness.js';
import { place, REPO_ROOT, runLint, withScratch } from './_scratch.js';

/**
 * AGE NEVER EMPTIES THE PAGE (R-2026-10-09 GO, section 2 and ruling 7; T-FRESH-1, T-FRESH-2) -- THE CONTROL FOR
 * "FRESHNESS MAY REORDER RESULTS AND MAY NEVER FILTER THEM".
 *
 * scripts/lint_no_updated_at_filter.sh is a grep, one line at a time, and it cannot see a band filter:
 * `wards.filter((w) => w.band !== 'SUPPRESSED')` has no timestamp on its line and PASSES. So the grep is NOT
 * what proves the 4am property. This is: it renders the REAL page (src/main.ts in jsdom) over a payload whose
 * every ward is SUPPRESSED, then one whose every age is unknown (no serve-time header), then the 4am case where
 * every ward is stale, in the chosen-ward view and under "Any", and asserts every hospital's NAME and CALL LINK
 * are on the page and that the empty-state sentence is not.
 *
 * Each case has its PLANT: the same helper over a page with one card removed, the call link taken off one card,
 * or the empty-state sentence shown, which it must reject, so the helper is shown able to fail. ANTI-VACUITY: a
 * helper over a page that rendered no card at all is rejected, so it cannot pass over nothing.
 *
 * NOT ASSERTED HERE, deliberately: that a human reads an old report as old. The words carry it, and the
 * clinicians confirm them (the table says PROVISIONAL); that is not something a test can read.
 */

const B = SHAPE.freshnessBands;
const NAMES = ['Alpha General', 'Beta Clinic', 'Gamma Hospital'];
const IDS = ['f1', 'f2', 'f3'];

const worldAt = (ageMin: number, extra: { monitoring?: string; bed?: number | null } = {}): World => ({
  facilities: IDS.map((id, i) => ({ id, name: NAMES[i] as string, phone: `+23480000000${i}1` })),
  wards: IDS.map((id) => ({ facility: id, category: 'MATERNITY', agoMin: ageMin, ...extra })),
});

/** Everything wrong with a page that was meant to show every hospital, as messages. Pure over the DOM, so the plants edit a DOM. */
export function neverEmptyViolations(names: readonly string[]): string[] {
  const out: string[] = [];
  const drawn = cards();
  if (drawn.length === 0) out.push('the page drew no hospital at all, so nothing was checked');
  for (const name of names) {
    if (!drawn.includes(name)) out.push(`${name} is not on the page`);
  }
  for (const h of Array.from(document.querySelectorAll('#app section.facility'))) {
    if (h.querySelector('a.call[href^="tel:"]') === null) out.push(`${h.querySelector('h2')?.textContent ?? '(a card)'} has no call link`);
  }
  if (app().querySelector('.empty-state, .outage-state') !== null) out.push('the empty or outage sentence is on the page');
  return out;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterEach(() => {
  releaseTimers();
});

describe('T-FRESH-1 — age never empties the page: every hospital, name and call link, in every state of age', () => {
  const cases: [string, () => Promise<unknown>][] = [];
  for (const [view, search] of [['the chosen-ward view', '?ward=maternity'], ['"Any"', '']] as const) {
    cases.push(
      [`every ward SUPPRESSED, in ${view}`, () => openPage({ world: worldAt(B.suppressAfterHours * 60 + 90), search })],
      [`every age unknown (no serve-time header), in ${view}`, () => openPage({ world: worldAt(5), search, servedAfterGen: null })],
      [`the 4am case, every ward stale (GREY), in ${view}`, () => openPage({ world: worldAt(6 * 60), search })],
      [`every ward never reported (PENDING), in ${view}`, () => openPage({ world: worldAt(0, { monitoring: 'PENDING', bed: null }), search })],
    );
  }
  test.each(cases)('%s', async (_name, open) => {
    await open();
    expect(neverEmptyViolations(NAMES)).toEqual([]);
    expect(cards()).toHaveLength(3);
  });

  test('the page is not blank on a suppressed ward either: no digit on the row, and the call link is still the hospital\'s', async () => {
    await openPage({ world: worldAt(B.suppressAfterHours * 60 + 90), search: '?ward=maternity' });
    const li = document.querySelector('#app li');
    expect(li?.textContent).toBe(`${TABLE.labels.ward_category.MATERNITY}: ${TABLE.fallbacks.status}`);
    expect(li?.outerHTML ?? '', 'a digit survived on a suppressed row').not.toMatch(/\d/);
    expect(document.querySelector('#app a.call')?.getAttribute('href')).toBe('tel:+2348000000001');
  });

  // PLANTS against the helper: a page that lost something must be rejected by name.
  test.each<[string, () => void, string]>([
    ['one card removed', () => { document.querySelector('#app section.facility')?.remove(); }, 'is not on the page'],
    ['the call link taken off one card', () => { document.querySelector('#app a.call')?.remove(); }, 'has no call link'],
    ['the empty-state sentence shown beside the cards', () => { const p = document.createElement('p'); p.className = 'empty-state'; app().append(p); }, 'the empty or outage sentence is on the page'],
    ['a band filter that drops every suppressed card', () => { document.querySelectorAll('#app section.facility').forEach((n) => n.remove()); }, 'the page drew no hospital at all'],
  ])('plant — %s is rejected', async (_name, plant, message) => {
    await openPage({ world: worldAt(B.suppressAfterHours * 60 + 90), search: '?ward=maternity' });
    expect(neverEmptyViolations(NAMES), 'the page was already wrong before the plant').toEqual([]);
    plant();
    expect(neverEmptyViolations(NAMES).join('\n')).toContain(message);
  });

  test('anti-vacuity — a helper over a page with no card is rejected, and over no names it still demands a card', async () => {
    document.body.innerHTML = '<main id="app"></main>';
    expect(neverEmptyViolations(NAMES).join('\n')).toContain('drew no hospital at all');
    expect(neverEmptyViolations([]).join('\n')).toContain('drew no hospital at all');
  });
});

describe('T-FRESH-2 — the snapshot-stale banner still renders above the results, and the rows stay neutral under it', () => {
  test('a snapshot served past the banner threshold shows its banner first and every hospital after it', async () => {
    await openPage({ world: worldAt(1), servedAfterGen: B.snapshotBannerAfterMinutes + 4, search: '?ward=maternity' });
    expect(app().firstElementChild?.className).toBe('snapshot-banner');
    expect(neverEmptyViolations(NAMES)).toEqual([]);
    expect(document.querySelectorAll('#app .stamp-green, #app .status-available, #app .status-full'), 'a row read as live under the stale banner').toHaveLength(0);
  });
});

describe('the lint is a grep and says so — it cannot see a band filter, which is why the control above exists', () => {
  // NAMED AS A LIMIT, NOT HIDDEN (R-2026-10-09 GO, ruling 7): lint_no_updated_at_filter.sh reads a line at a time for a timestamp beside a
  // filter call. A filter on a BAND has no timestamp on its line. The first leg shows the grep passing it; the second is the control, the
  // same grep refusing the form it was written for, so the first cannot mean the lint ran over nothing.
  test('plant — a band filter with no timestamp on its line PASSES the lint, so the lint is not the control for "age never filters"', () => {
    withScratch((root) => {
      place(root, 'apps/x/src/a.ts', 'export const shown = (cs: { rank: number }[]) => cs.filter((c) => c.rank !== 3);\n');
      const r = runLint('lint_no_updated_at_filter.sh', root);
      expect(r.status, r.stdout).toBe(0);
      expect(r.stdout).toContain('PASS (1 source files scanned)');
    });
  });

  test('control — the form the lint exists for, a timestamp beside a filter call, is refused by the same script on the same tree shape', () => {
    withScratch((root) => {
      place(root, 'apps/x/src/a.ts', 'export const fresh = (ws: { updated_at: string }[]) => ws.filter((w) => w.updated_at > "2026");\n');
      const r = runLint('lint_no_updated_at_filter.sh', root);
      expect(r.status, r.stdout).toBe(1);
    });
  });

  test('real — the lint passes over the real tree, including the search layer, and prints how many files it read', () => {
    const r = runLint('lint_no_updated_at_filter.sh', REPO_ROOT);
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toMatch(/PASS \(\d+ source files scanned\)/);
  });
});
