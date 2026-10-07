// @vitest-environment jsdom
/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { facilityColumns, wardColumns, POLL_CADENCE_SECONDS } from '../../packages/snapshot/src/codec.js';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';

/**
 * THE PUBLIC PAGE NEVER GOES BLANK, AND AN OUTAGE RECOVERS BY ITSELF (R-2026-10-07 GJ).
 *
 * Until GJ, `void render()` had no catch, so any throw on a first render left the main area empty, and a
 * first-load outage never retried, because polling started only after a successful load. The rules that
 * do not change: an outage is never rendered as an availability report (R-2026-09-21-44); nothing renders
 * that did not come from the server; a failed poll while data is held keeps the held snapshot.
 *
 * FOUR LEGS, each driven by the page's own interval under fake timers (a second render() is a reload, and
 * the point is that no reload happens), each owning every timer and fetch it starts, which the class guard
 * (tests/setup/compliance-guard.ts) enforces:
 *   a. the first load answers 500 and the next poll answers 200: the real snapshot replaces the outage
 *      notice with no reload, and normal polling continues from there;
 *   b. renderReal throws on a VALID snapshot: the outage notice renders, the main area is not empty, the
 *      fault is logged by error NAME only (the planted message carries payload-looking text that must
 *      not reach the console), and the page recovers when the throwing stops;
 *   c. a snapshot is held and a poll answers 500: the held snapshot stays, and the outage never shows
 *      (unchanged behaviour: this leg is red only against a planted regression, not against the old page);
 *   d. repeated outages and recoveries leave exactly ONE interval running, counted through the fake clock.
 *
 * ANTI-VACUITY is tests/compliance/dashboard_never_blank_antivacuity.test.ts, which runs a copy of THIS file
 * against planted variants of the page and shows each leg turn red. DASHBOARD below is the one line it swaps.
 *
 * NOT ASSERTED HERE, deliberately: what the wording of the outage notice should become. GJ asks for a
 * proposed sentence in the pull request and ships none; outageMessage() is unchanged, and
 * tests/compliance/dashboard_empty_state.test.ts still holds its meaning.
 */

const DASHBOARD = '../../apps/public-dashboard/src/main.js';

const CADENCE_MS = POLL_CADENCE_SECONDS * 1000;
const FOUR = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const;
const GEN = Date.parse('2026-09-23T03:12:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

function encode(columns: readonly string[], values: Record<string, unknown>): unknown[] {
  return columns.map((c) => values[c] ?? null);
}
const FACILITY = encode(facilityColumns(), {
  facility_id: 'f1', name: 'Synthetic General Hospital', lga: 'Ikeja', state: 'Lagos', lat: 6.6, lng: 3.35,
  public_phone_e164: '+2348000000001', updated_at: iso(GEN),
});
const ward = (bedCount: number): unknown[] =>
  encode(wardColumns(), {
    facility_id: 'f1', category: 'A_AND_E', offering: 'OFFERED', bed_count: bedCount, accepting_effective: true,
    gated_by: null, state: 'OK', source: 'WARD', monitoring_state: 'ACTIVE', updated_at: iso(GEN),
  });

/** The server: what it serves, and whether it answers. */
const server = { beds: 3, failing: false };
const fetchMock = vi.fn(async (): Promise<Response> => {
  if (server.failing) return new Response('{}', { status: 500 });
  const payload = { v: 1, generated_at: iso(GEN), server_now: iso(GEN), facilities: [FACILITY], wards: [ward(server.beds)] };
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
});

const lines = (): string[] => Array.from(document.querySelectorAll('#app li')).map((li) => li.textContent ?? '');
const text = (): string => document.getElementById('app')?.textContent ?? '';
const outageShown = (): boolean => document.querySelector('#app .outage-state') !== null;

type Dashboard = { render: () => Promise<void> };

/** A fresh module, so its import-time render() runs: that IS the first load. Fake timers are already installed. */
async function openPage(): Promise<Dashboard> {
  vi.resetModules();
  document.body.innerHTML = '<main id="app"></main><footer id="site-footer"></footer>';
  const mod = (await import(/* @vite-ignore */ DASHBOARD)) as Dashboard;
  await settle();
  return mod;
}

/** Lets a fetch and its one jittered retry (150 to 300 ms) finish, whatever the jitter. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(1_000);
}

/** One poll interval later, then enough for the poll's own retry to finish. Stays inside one cadence. */
async function pollOnce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(CADENCE_MS - 1_000);
  await vi.advanceTimersByTimeAsync(2_000);
}

beforeEach(() => {
  vi.restoreAllMocks();
  fetchMock.mockClear();
  server.beds = 3;
  server.failing = false;
  vi.useFakeTimers({ toFake: [...FOUR] });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the public page never goes blank, and an outage recovers by itself', () => {
  test('a — the first load answers 500 and the next poll answers 200: the real snapshot replaces the outage notice with no reload', async () => {
    server.failing = true;
    await openPage();
    expect(text(), 'the first load did not render the outage').toMatch(/can.t be loaded right now/i);
    expect(lines(), 'the outage rendered a list').toEqual([]);
    expect(vi.getTimerCount(), 'no poll interval is running after a first-load outage').toBe(1);
    const callsAtOutage = fetchMock.mock.calls.length;

    server.failing = false;
    await pollOnce();
    expect(fetchMock.mock.calls.length, 'the page never polled after the outage').toBeGreaterThan(callsAtOutage);
    expect(lines()[0] ?? '', 'the real snapshot did not replace the outage notice').toMatch(/: 3 beds/);
    expect(outageShown(), 'the outage notice is still on the page').toBe(false);
    expect(text()).not.toMatch(/can.t be loaded right now/i);
    expect(vi.getTimerCount(), 'recovery left a second interval running').toBe(1);

    server.beds = 5;
    await pollOnce();
    expect(lines()[0] ?? '', 'normal polling did not continue after the recovery').toMatch(/: 5 beds/);
  });

  test('b — renderReal throws on a valid snapshot: the outage notice renders, the main area is not empty, the fault is logged by name only, and the page recovers', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let throwing = true;
    const real = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
      if (throwing && tag === 'section') throw new Error('planted render fault quoting PAYLOAD-WARD-NAME-71');
      return real(tag, options);
    }) as typeof document.createElement);

    await openPage();
    expect(document.getElementById('app')?.children.length ?? 0, 'the main area is EMPTY after a render fault').toBeGreaterThan(0);
    expect(outageShown(), 'a render fault on a valid snapshot did not fall back to the outage notice').toBe(true);
    expect(text()).toMatch(/can.t be loaded right now/i);
    expect(text(), 'the outage notice is not an availability report').toMatch(/NOT a report that beds are unavailable/);
    expect(lines(), 'a half-drawn list is on the page').toEqual([]);
    const everything = JSON.stringify(logged.mock.calls);
    expect(everything, 'the render fault was not logged').toContain('"error":"Error"');
    expect(everything, "the fault's message, which can carry payload text, reached the console").not.toContain('PAYLOAD-WARD-NAME-71');

    throwing = false;
    await pollOnce();
    expect(lines()[0] ?? '', 'the page did not recover once the throwing stopped').toMatch(/: 3 beds/);
    expect(outageShown()).toBe(false);
  });

  test('c — a snapshot is held and a poll answers 500: the held snapshot stays and the outage never shows', async () => {
    await openPage();
    expect(lines()[0] ?? '').toMatch(/: 3 beds/);

    server.failing = true;
    const callsHeld = fetchMock.mock.calls.length;
    for (let tick = 1; tick <= 3; tick += 1) {
      await pollOnce();
      expect(lines()[0] ?? '', `tick ${tick}: the held snapshot was lost`).toMatch(/: 3 beds/);
      expect(outageShown(), `tick ${tick}: a failed poll showed the outage while a snapshot was held`).toBe(false);
      expect(text(), `tick ${tick}: the outage wording appeared`).not.toMatch(/can.t be loaded right now/i);
    }
    expect(fetchMock.mock.calls.length, 'the page never polled, so this proved nothing about a failed poll').toBeGreaterThan(callsHeld);
  });

  test('d — repeated outages and recoveries leave exactly one interval running, starting from a first-load outage', async () => {
    // It starts with a first-load OUTAGE on purpose: against the page before GJ a successful first load already
    // left one interval, so a leg that began there could not tell the two apart (found by running it red first).
    server.failing = true;
    const mod = await openPage();
    expect(outageShown(), 'the first load did not render the outage').toBe(true);
    expect(vi.getTimerCount(), 'a first-load outage did not leave exactly one interval running').toBe(1);

    const cycle: boolean[] = [false, true, false, false, true, true, false, true, false];
    for (const [i, failing] of cycle.entries()) {
      server.failing = failing;
      await pollOnce();
      expect(vi.getTimerCount(), `after poll ${i + 1} (${failing ? 'outage' : 'recovery'}) the number of running intervals is not one`).toBe(1);
      expect(outageShown() || lines().length > 0, `after poll ${i + 1} the main area is empty`).toBe(true);
    }

    // A reload (render() called again) replaces the interval rather than adding one.
    server.failing = false;
    const reloaded = mod.render();
    await settle();
    await reloaded;
    expect(vi.getTimerCount(), 'a reload left more than one interval running').toBe(1);
    expect(lines()[0] ?? '').toMatch(/: 3 beds/);
  });

  test('anti-vacuity — the model server really does fail and recover, and the interval is the fake clock\'s', async () => {
    expect(SHAPE.pollCadenceSeconds, 'the cadence this file waits is not the fixture\'s').toBe(POLL_CADENCE_SECONDS);
    server.failing = true;
    expect((await fetchMock()).status).toBe(500);
    server.failing = false;
    expect((await fetchMock()).status).toBe(200);
    fetchMock.mockClear();
    const handle = setInterval(() => undefined, CADENCE_MS);
    expect(vi.getTimerCount(), 'the interval is not on the fake clock, so the counts above would read zero').toBe(1);
    clearInterval(handle);
    expect(vi.getTimerCount()).toBe(0);
  });
});
