// @vitest-environment jsdom
/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { facilityColumns, wardColumns, POLL_CADENCE_SECONDS } from '../../packages/snapshot/src/codec.js';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';

/**
 * THE PAGE POLLS, AND A FAILED POLL NEVER COSTS THE READER WHAT THEY HAD
 * (R-2026-09-23-68 A; release gate 2 as restated 2026-09-10).
 *
 * The fetch stub is a small model of the server: a snapshot it would serve, a serve
 * clock that advances with the test's monotonic clock, and a switch that makes every
 * request fail. Timers are faked so a poll is driven by the page's own interval,
 * never by the test calling render() again -- a second render() is a reload, and the
 * gate says "with no page refresh".
 *
 * THE FAILING HALVES AV A4 ASKS FOR, each red against the page before -68 (which
 * fetched once and only re-rendered):
 *   - a changed count reaches the page at the cadence, and not before it;
 *   - a failed poll keeps the rows, never shows the outage, and the banner arrives
 *     once the HELD snapshot passes the threshold -- the fetch count is asserted, so a
 *     page that never polled cannot pass by rendering what it already had;
 *   - every fetch, first load and poll alike, bypasses the browser's HTTP cache.
 *
 * Cadence and thresholds come from the fixture, never from numbers written here.
 *
 * NOT ASSERTED HERE, deliberately: what a real browser's HTTP cache does with
 * `cache: 'no-store'`. jsdom has no HTTP cache; this asserts the page ASKS for no
 * stored copy, which is the part this repository controls.
 */

const B = SHAPE.freshnessBands;
const MIN = 60_000;
const CADENCE_MS = POLL_CADENCE_SECONDS * 1000;
const GEN = Date.parse('2026-09-23T03:12:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

function encode(columns: readonly string[], values: Record<string, unknown>): unknown[] {
  return columns.map((c) => values[c] ?? null);
}

const FACILITY = encode(facilityColumns(), {
  facility_id: 'f1', name: 'Synthetic General Hospital', lga: 'Ikeja', state: 'Lagos', lat: 6.6, lng: 3.35,
  public_phone_e164: '+2348000000001', updated_at: iso(GEN),
});

function ward(bedCount: number, updatedAt: number): unknown[] {
  return encode(wardColumns(), {
    facility_id: 'f1', category: 'A_AND_E', offering: 'OFFERED', bed_count: bedCount, accepting_effective: true,
    gated_by: null, state: 'OK', source: 'WARD', monitoring_state: 'ACTIVE', updated_at: iso(updatedAt),
  });
}

let perfNow = 1_000;

/** The server: what it serves, and whether it answers. Its serve clock is GEN + monotonic time. */
const server = { generatedAt: GEN, wards: [ward(3, GEN)], failing: false };

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
  if (server.failing) throw new TypeError('Failed to fetch');
  const payload = { v: 1, generated_at: iso(server.generatedAt), server_now: iso(server.generatedAt), facilities: [FACILITY], wards: server.wards };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-openbed-served-at': iso(GEN + (perfNow - 1_000)) },
  });
});

const lines = (): string[] => Array.from(document.querySelectorAll('#app li')).map((li) => li.textContent ?? '');
const banner = (): string | null => document.querySelector('#app .snapshot-banner')?.textContent ?? null;
const text = (): string => document.body.textContent ?? '';

/** Advance both clocks together: the page's monotonic clock and its timers. */
async function wait(ms: number): Promise<void> {
  perfNow += ms;
  await vi.advanceTimersByTimeAsync(ms);
}

async function openPage(): Promise<void> {
  document.body.innerHTML = '<main id="app"></main>';
  const { render } = await import('../../apps/public-dashboard/src/main.js');
  fetchMock.mockClear();
  await render();
}

beforeEach(() => {
  vi.restoreAllMocks();
  perfNow = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => perfNow);
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  server.generatedAt = GEN;
  server.wards = [ward(3, GEN)];
  server.failing = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the page polls at the snapshot cadence', () => {
  test('FAILING HALF — a changed count reaches the open page at the cadence, with no reload, and not before', async () => {
    await openPage();
    expect(lines()[0] ?? '').toMatch(/: 3 beds/);

    server.generatedAt = GEN + CADENCE_MS;
    server.wards = [ward(5, GEN + CADENCE_MS)];
    await wait(CADENCE_MS - 1);
    expect(fetchMock.mock.calls.length, 'the page polled before its cadence').toBe(1);
    expect(lines()[0] ?? '').toMatch(/: 3 beds/);

    await wait(1);
    expect(fetchMock.mock.calls.length, 'the page never polled').toBe(2);
    expect(lines()[0] ?? '', 'the poll did not reach the page').toMatch(/: 5 beds/);
  });

  test('a successful poll re-anchors the age: fresh data on a long-open tab raises no banner', async () => {
    await openPage();
    for (let tick = 0; tick < 10; tick += 1) {
      server.generatedAt = GEN + (perfNow - 1_000) + CADENCE_MS;
      await wait(CADENCE_MS);
    }
    expect(fetchMock.mock.calls.length).toBe(11);
    expect(banner(), 'a tab polling fresh data was told its page was out of date').toBeNull();
  });
});

describe('a failed poll keeps what the reader had', () => {
  test('FAILING HALF — the held rows stay, the outage never shows, and the banner arrives once the held snapshot passes the threshold', async () => {
    await openPage();
    server.failing = true;
    const ticksToBanner = Math.ceil((B.snapshotBannerAfterMinutes * MIN) / CADENCE_MS);

    for (let tick = 1; tick < ticksToBanner; tick += 1) {
      await wait(CADENCE_MS);
      expect(lines()[0] ?? '', `tick ${tick}: the held rows were lost`).toMatch(/: 3 beds/);
      expect(text(), `tick ${tick}: a failed poll showed the outage while good data was held`).not.toMatch(/can.t be loaded right now/i);
      expect(banner(), `tick ${tick}: the banner came early`).toBeNull();
    }
    await wait(CADENCE_MS);
    expect(banner(), 'the held snapshot passed the threshold and no banner appeared').not.toBeNull();
    expect(lines()[0] ?? '', 'the rows went when the banner came').toMatch(/: 3 beds/);
    expect(fetchMock.mock.calls.length, 'the page never tried to poll, so this proved nothing about a failed poll').toBeGreaterThan(ticksToBanner);
  });

  test('a failed poll followed by a good one shows the new data and clears the banner', async () => {
    await openPage();
    server.failing = true;
    for (let tick = 0; tick <= Math.ceil((B.snapshotBannerAfterMinutes * MIN) / CADENCE_MS); tick += 1) await wait(CADENCE_MS);
    expect(banner()).not.toBeNull();

    server.failing = false;
    server.generatedAt = GEN + (perfNow - 1_000);
    server.wards = [ward(7, server.generatedAt)];
    await wait(CADENCE_MS);
    expect(lines()[0] ?? '').toMatch(/: 7 beds/);
    expect(banner(), 'recovered data kept the stale banner').toBeNull();
  });

  test('only a first load with nothing held shows the outage', async () => {
    server.failing = true;
    document.body.innerHTML = '<main id="app"></main>';
    const { render } = await import('../../apps/public-dashboard/src/main.js');
    const done = render();
    await vi.advanceTimersByTimeAsync(1_000); // the one retry's jittered backoff
    await done;
    expect(text()).toMatch(/can.t be loaded right now/i);
    expect(document.querySelectorAll('#app li').length).toBe(0);
  });
});

describe('every fetch bypasses the browser cache', () => {
  test('FAILING HALF — the first load and every poll ask for no stored copy', async () => {
    await openPage();
    await wait(CADENCE_MS);
    await wait(CADENCE_MS);
    expect(fetchMock.mock.calls.length, 'too few fetches to say anything about the polls').toBe(3);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe('/beds.json');
      expect(init?.cache, 'a fetch could be answered from the HTTP cache, with an older serve time').toBe('no-store');
    }
  });
});
