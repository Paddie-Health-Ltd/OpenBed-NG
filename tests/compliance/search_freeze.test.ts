// @vitest-environment jsdom
/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';
import TABLE from '../../packages/labels/public-labels.json';
import { releaseTimers } from './_dashboard_import.js';
import { app, byId, cards, choose, openPage, wardLines, type World } from './_search_harness.js';

/**
 * THE ORDER IS FROZEN BETWEEN A VISITOR'S ACTIONS (R-2026-10-09 GO, A3; T-FREEZE-1 to 4).
 *
 * A dispatcher reading the list must not see it reshuffle under their eyes because a ward crossed a band on a
 * 30 second poll. So the order is set when the page loads and when a control changes, and held while the page
 * polls; counts, ages and words still update in place on every poll.
 *
 * THE SORT IS SPIED THROUGH ITS IMPORT. src/search.ts exports ONE ordering function, orderFacilities, and
 * main.ts calls it through that import, so this file wraps it in a spy (vi.mock) and counts. The counts are
 * asserted, but they are NOT the control: a re-sort-on-every-draw plant that happened to leave the call count
 * alone would pass a count-only test. So THE FIXTURE MAKES A RE-SORT CHANGE THE ORDER: a ward on the poll is
 * reported later than another, so the two would swap if the page re-sorted. The order is asserted as well, so a
 * re-sort-every-draw plant reds the ORDER assertion itself, not only the count (shown with scripts/neuter.sh in
 * the pull request: the plant resets the held order at the top of every draw).
 *
 * NOT ASSERTED HERE, deliberately: how the aged-order line looks, or that a person notices it. That is the
 * screenshot, and the clinicians' confirmation of the line's words, which the table marks PROVISIONAL.
 */

vi.mock('../../apps/public-dashboard/src/search.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../apps/public-dashboard/src/search.js')>();
  return { ...real, orderFacilities: vi.fn(real.orderFacilities) };
});

const B = SHAPE.freshnessBands;
const PHRASES = TABLE.phrases;
const MATERNITY = TABLE.labels.ward_category.MATERNITY;

/** The number of times the page has computed an order. */
async function sorts(): Promise<number> {
  const search = await import('../../apps/public-dashboard/src/search.js');
  return vi.mocked(search.orderFacilities).mock.calls.length;
}

/**
 * Two hospitals that both offer maternity. Alpha reported 25 minutes before GEN and Beta 24, so at the first draw, one minute
 * after GEN, both are fresh (under the green ceiling) and the order is by name: Alpha, then Beta.
 */
const pair = (alphaAgo: number, betaAgo: number): World => ({
  facilities: [{ id: 'fa', name: 'Alpha General', phone: '+2348000000011' }, { id: 'fb', name: 'Beta Clinic', phone: '+2348000000012' }],
  wards: [{ facility: 'fa', category: 'MATERNITY', agoMin: alphaAgo }, { facility: 'fb', category: 'MATERNITY', agoMin: betaAgo }],
});

/** Ten minutes on, Beta has just reported (it is fresh) and Alpha has aged into the next band: a re-sort would put Beta first. */
const betaReportsLater = (): World => pair(25, -8);

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterEach(() => {
  releaseTimers();
});

describe('T-FREEZE-1 — a ward crossing a band on a poll keeps its place and updates its words in place', () => {
  test('the order does not move through twenty polls, the words do, and the sort ran once', async () => {
    const page = await openPage({ world: pair(25, 24), search: '?ward=maternity' });
    expect(cards()).toEqual(['Alpha General', 'Beta Clinic']);
    expect(await sorts(), 'the sort ran other than once at load').toBe(1);
    expect(wardLines()[0]).toBe(`${MATERNITY}: 3 beds reported\u00a0— updated 26 min ago`);

    page.setWorld(betaReportsLater());
    await page.advance(10); // twenty 30 s polls
    // Alpha is now YELLOW (36 min) and Beta is GREEN (3 min): a re-sort would put Beta first.
    expect(cards(), 'a poll re-sorted the list: Beta moved above Alpha').toEqual(['Alpha General', 'Beta Clinic']);
    expect(wardLines()[0], 'Alpha\'s words did not update in place').toBe(`${MATERNITY}: 3 beds reported\u00a0— last reported 36 min ago — call to confirm`);
    expect(wardLines()[1]).toBe(`${MATERNITY}: 3 beds reported\u00a0— updated 3 min ago`);
    expect(await sorts(), 'the sort ran again on a poll').toBe(1);
  });

  test('the aged-order line appears on the first crossing, names the time the order was set, and carries the ruled words', async () => {
    const page = await openPage({ world: pair(25, 24), search: '?ward=maternity' });
    expect(byId('aged-order').hidden, 'the line showed before any report had aged').toBe(true);
    page.setWorld(betaReportsLater());
    await page.advance(10);
    expect(byId('aged-order').hidden).toBe(false);
    expect(byId('aged-order').textContent).toBe(PHRASES.aged_order.replace('{time}', '04:13'));
    expect(byId('aged-order').textContent).toBe("Order set at 04:13. Some reports have aged since — check each card's age, or change a control to re-sort.");
  });

  test('the aged-order line is removed on a re-sort, and the re-sort puts Beta first', async () => {
    const page = await openPage({ world: pair(25, 24), search: '?ward=maternity' });
    page.setWorld(betaReportsLater());
    await page.advance(10);
    expect(byId('aged-order').hidden).toBe(false);
    choose('ward', 'Any bed type');
    choose('ward', MATERNITY);
    expect(byId('aged-order').hidden, 'the line survived a re-sort').toBe(true);
    expect(cards(), 'the re-sort did not apply the band order').toEqual(['Beta Clinic', 'Alpha General']);
  });

  test('crossing two hours switches "N beds reported" to "Last known: N beds" on the same hospital, and crossing twelve removes every digit', async () => {
    const page = await openPage({ world: { facilities: [{ id: 'fa', name: 'Alpha General' }], wards: [{ facility: 'fa', category: 'MATERNITY', agoMin: B.yellowUnderMinutes - 20 }] }, search: '?ward=maternity' });
    expect(wardLines()[0]).toMatch(/^Maternity: 3 beds reported\u00a0— last reported .* ago — call to confirm$/);
    await page.advance(25); // past two hours
    expect(wardLines()[0]).toMatch(new RegExp(`^${MATERNITY}: Last known: 3 beds\u00a0— ${PHRASES.last_accepting}\u00a0— last reported at .*\\(Lagos time\\) — call to confirm$`));
    expect(wardLines()[0], 'a stale count was still said in the present tense').not.toContain('beds reported');
    await page.advance(B.suppressAfterHours * 60); // past twelve hours
    expect(wardLines()[0]).toBe(`${MATERNITY}: Status unknown — call to confirm`);
    expect(document.querySelector('#app li')?.outerHTML ?? '', 'a digit survived on a suppressed row').not.toMatch(/\d/);
    expect(cards(), 'a suppressed hospital left the page').toEqual(['Alpha General']);
  });

  // The helper the order assertion uses, with its plant: a list in the other order is rejected, so a re-sort cannot hide behind a count.
  test('plant — the assertion over the order rejects a re-sorted list: Beta above Alpha is not "frozen"', () => {
    const frozen = ['Alpha General', 'Beta Clinic'];
    const orderViolation = (got: string[]): string | null => (JSON.stringify(got) === JSON.stringify(frozen) ? null : `the order moved to ${got.join(', ')}`);
    expect(orderViolation(['Alpha General', 'Beta Clinic'])).toBeNull();
    expect(orderViolation(['Beta Clinic', 'Alpha General'])).toContain('moved to Beta Clinic, Alpha General');
  });
});

describe('T-FREEZE-2 — a control change re-sorts: once, and not more than once', () => {
  test('the sort runs once at load, still once after polls, twice after one control change, and the new order is applied', async () => {
    const page = await openPage({ world: pair(25, 24), search: '?ward=maternity' });
    page.setWorld(betaReportsLater());
    await page.advance(10);
    expect(await sorts()).toBe(1);
    expect(cards()).toEqual(['Alpha General', 'Beta Clinic']);
    choose('ward', 'Any bed type');
    expect(await sorts(), 'one control change did not re-sort exactly once').toBe(2);
    choose('ward', MATERNITY);
    expect(await sorts()).toBe(3);
    expect(cards()).toEqual(['Beta Clinic', 'Alpha General']);
  });

  test('with no starting point the order control offers "Recent reports first" alone, and the page has sorted once', async () => {
    await openPage({ world: pair(25, 24), search: '?ward=maternity' });
    expect(Array.from(byId<HTMLSelectElement>('order-select').options).map((o) => o.textContent)).toEqual(['Recent reports first']);
    expect(await sorts()).toBe(1);
  });
});

describe('T-FREEZE-3 — a hospital that is new on a poll is appended, never inserted in place', () => {
  test('a hospital whose name sorts first is drawn last until the next re-sort', async () => {
    const page = await openPage({ world: pair(25, 24), search: '?ward=maternity' });
    const world = pair(25, 24);
    world.facilities.push({ id: 'fz', name: 'Aardvark Maternity', phone: '+2348000000013' });
    world.wards.push({ facility: 'fz', category: 'MATERNITY', agoMin: 24 });
    page.setWorld(world);
    await page.poll();
    expect(cards(), 'a new hospital was inserted where it would sort').toEqual(['Alpha General', 'Beta Clinic', 'Aardvark Maternity']);
    expect(await sorts(), 'a new hospital re-sorted the list').toBe(1);
    choose('ward', 'Any bed type');
    choose('ward', MATERNITY);
    expect(cards()[0], 'a re-sort did not place it by name').toBe('Aardvark Maternity');
  });
});

describe('T-FREEZE-4 — an outage and a recovery', () => {
  test('a page opened during an outage computes its order once, at the first good draw, and holds it after', async () => {
    const page = await openPage({ world: pair(25, 24), search: '?ward=maternity', outageAtStart: true });
    expect(app().querySelector('.outage-state'), 'the outage notice was not shown').not.toBeNull();
    expect(await sorts(), 'an order was computed with nothing to order').toBe(0);
    page.setOutage(false);
    await page.poll();
    expect(cards()).toEqual(['Alpha General', 'Beta Clinic']);
    expect(await sorts(), 'the first good draw did not set the order exactly once').toBe(1);
    page.setWorld(betaReportsLater());
    await page.advance(10);
    expect(cards()).toEqual(['Alpha General', 'Beta Clinic']);
    expect(await sorts()).toBe(1);
  });

  test('a failed poll that leaves the results on screen keeps the order: the recovery does not re-sort', async () => {
    const page = await openPage({ world: pair(25, 24), search: '?ward=maternity' });
    page.setOutage(true);
    await page.advance(3);
    expect(cards(), 'a failed poll blanked the list').toEqual(['Alpha General', 'Beta Clinic']);
    expect(app().querySelector('.outage-state'), 'a failed poll showed the outage while good data was held').toBeNull();
    page.setOutage(false);
    page.setWorld(betaReportsLater());
    await page.advance(7);
    expect(cards(), 'the recovery re-sorted the held list').toEqual(['Alpha General', 'Beta Clinic']);
    expect(await sorts()).toBe(1);
  });

  test('a hospital missing from one poll returns to its frozen place on the next', async () => {
    const page = await openPage({ world: pair(25, 24), search: '?ward=maternity' });
    const only = pair(25, 24);
    only.facilities.splice(0, 1);
    only.wards.splice(0, 1);
    page.setWorld(only);
    await page.poll();
    expect(cards(), 'the missing hospital was drawn').toEqual(['Beta Clinic']);
    page.setWorld(pair(25, 24));
    await page.poll();
    expect(cards(), 'the returning hospital did not return to its frozen place').toEqual(['Alpha General', 'Beta Clinic']);
    expect(await sorts()).toBe(1);
  });
});
