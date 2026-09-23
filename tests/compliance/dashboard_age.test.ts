// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { facilityColumns, wardColumns } from '../../packages/snapshot/src/codec.js';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';
import { REPO_ROOT } from './_scratch.js';

/**
 * EVERY COUNT CARRIES ITS AGE, AND A STALE PAGE SAYS SO (R-2026-09-23-67 A1-A6).
 *
 * All assertions read the RENDERED page (-29 E2), in the harness the other dashboard
 * tests use. The fetch stub sets `x-openbed-served-at` -- the Pages Function's serve
 * time -- and `performance.now` is controlled, because those two plus the payload are
 * the ONLY clocks the page may use.
 *
 * THE FAILING HALVES A6 ASKS FOR:
 *   - a stale snapshot served to a device whose clock says it is fresh still shows the
 *     banner: `vi.setSystemTime` is used ONLY to put the device clock somewhere
 *     misleading and show it changes nothing;
 *   - a fresh snapshot left open past the banner threshold shows the banner after the
 *     page's own re-render, and not before;
 *   - a ward reported at the moment of a stale snapshot cannot read "just now";
 *   - with no serve-time clock the page never reads fresh.
 * And a source guard: the page's modules make no device-clock read, planted both ways.
 *
 * Thresholds come from the fixture, never from numbers written here.
 */

const B = SHAPE.freshnessBands;
const MIN = 60_000;
const GEN = Date.parse('2026-09-23T03:12:00.000Z'); // 04:12 in Lagos
const iso = (ms: number): string => new Date(ms).toISOString();

function encode(columns: readonly string[], values: Record<string, unknown>): unknown[] {
  return columns.map((c) => values[c] ?? null);
}

const FACILITY = encode(facilityColumns(), {
  facility_id: 'f1', name: 'Synthetic General Hospital', lga: 'Ikeja', state: 'Lagos', lat: 6.6, lng: 3.35,
  public_phone_e164: '+2348000000001', updated_at: iso(GEN),
});

function ward(category: string, updatedMinutesBeforeGen: number, extra: Record<string, unknown> = {}): unknown[] {
  return encode(wardColumns(), {
    facility_id: 'f1', category, offering: 'OFFERED', bed_count: 3, accepting_effective: true, gated_by: null,
    state: 'OK', source: 'WARD', monitoring_state: 'ACTIVE', updated_at: iso(GEN - updatedMinutesBeforeGen * MIN), ...extra,
  });
}

let perfNow = 1_000;

async function renderAt(opts: { wards: unknown[][]; servedAfterGenMinutes: number | null }): Promise<string> {
  document.body.innerHTML = '<main id="app"></main>';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.servedAfterGenMinutes !== null) headers['x-openbed-served-at'] = iso(GEN + opts.servedAfterGenMinutes * MIN);
  const payload = { v: 1, generated_at: iso(GEN), server_now: iso(GEN), facilities: [FACILITY], wards: opts.wards };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers })));
  const { render } = await import('../../apps/public-dashboard/src/main.js');
  await render();
  return text();
}

const text = (): string => document.body.textContent ?? '';
const banner = (): string | null => document.querySelector('#app .snapshot-banner')?.textContent ?? null;
const lines = (): string[] => Array.from(document.querySelectorAll('#app li')).map((li) => li.textContent ?? '');

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  perfNow = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => perfNow);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('each band, in words, on the rendered page', () => {
  test('FRESH — the count, then "updated N min ago", and no banner', async () => {
    await renderAt({ wards: [ward('A_AND_E', 5)], servedAfterGenMinutes: 1 });
    expect(lines()[0]).toBe('A_AND_E: 3 beds — updated 6 min ago');
    expect(banner()).toBeNull();
  });

  test('AGEING — the count stays, "last reported N min ago — call to confirm"', async () => {
    const age = B.greenUnderMinutes + 15;
    await renderAt({ wards: [ward('A_AND_E', age - 1)], servedAfterGenMinutes: 1 });
    expect(lines()[0]).toBe(`A_AND_E: 3 beds — last reported ${age} min ago — call to confirm`);
    expect(document.querySelector('#app li')?.className).toBe('age-aged');
  });

  test('STALE — past the ageing band the age becomes a Lagos time, and the count stays', async () => {
    await renderAt({ wards: [ward('A_AND_E', B.yellowUnderMinutes + 60)], servedAfterGenMinutes: 1 });
    const line = lines()[0] ?? '';
    expect(line).toMatch(/^A_AND_E: 3 beds — last reported at .*01:12.*\(Lagos time\) — call to confirm$/);
    expect(line, 'a stale ward was shown as closed because it is stale').not.toMatch(/not accepting|\b0 beds/);
  });

  test('NO RECENT REPORT — the count leaves the main line and survives only as small print', async () => {
    await renderAt({ wards: [ward('A_AND_E', B.suppressAfterHours * 60 + 30)], servedAfterGenMinutes: 1 });
    const li = document.querySelector('#app li');
    expect(li?.firstChild?.textContent).toBe('A_AND_E: no recent report — call');
    expect(li?.querySelector('small')?.textContent).toMatch(/last known: 3 beds, reported .*\(Lagos time\)/);
  });

  test.each(['PENDING', 'PAUSED'])('%s — "not currently reporting", and no count at all', async (state) => {
    await renderAt({ wards: [ward('A_AND_E', 0, { monitoring_state: state, bed_count: 0 })], servedAfterGenMinutes: 1 });
    expect(lines()[0]).toBe('A_AND_E: not currently reporting');
    expect(text(), `a ${state} ward was shown with a count`).not.toMatch(/\d+\s*beds/);
  });

  test('age never filters or reorders — every ward renders, in the order served', async () => {
    await renderAt({
      wards: [ward('A_AND_E', B.suppressAfterHours * 60 + 5), ward('ICU_ADULT', 1), ward('MATERNITY', B.yellowUnderMinutes + 5)],
      servedAfterGenMinutes: 1,
    });
    expect(lines().map((l) => l.split(':')[0])).toEqual(['A_AND_E', 'ICU_ADULT', 'MATERNITY']);
  });
});

describe('the snapshot banner, and the clock it is measured by', () => {
  test('a snapshot served past the banner threshold after generation shows the banner, naming when it was refreshed', async () => {
    await renderAt({ wards: [ward('A_AND_E', 0)], servedAfterGenMinutes: B.snapshotBannerAfterMinutes + 1 });
    expect(banner()).toMatch(/^This page was last refreshed at .*04:12 \(Lagos time\)\. Counts may be out of date — call before you travel\.$/);
  });

  test('FAILING HALF — the same stale snapshot on a device whose clock says it is fresh STILL shows the banner', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(GEN); // the handset believes the snapshot was generated this instant
    await renderAt({ wards: [ward('A_AND_E', 0)], servedAfterGenMinutes: B.snapshotBannerAfterMinutes + 1 });
    expect(banner(), 'the device clock hid a stale snapshot').not.toBeNull();
  });

  test('FAILING HALF — a stale snapshot cannot make a ward read "just now"', async () => {
    // The ward reported at the very moment the snapshot was generated, and the
    // snapshot has been stale since. Its age is the stall, not zero.
    const stall = B.snapshotBannerAfterMinutes + 7;
    await renderAt({ wards: [ward('A_AND_E', 0)], servedAfterGenMinutes: stall });
    expect(lines()[0]).toBe(`A_AND_E: 3 beds — updated ${stall} min ago`);
    expect(text()).not.toMatch(/less than a minute|just now/);
  });

  test('FAILING HALF — a fresh page left open past the threshold shows the banner after its own re-render, and not before', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await renderAt({ wards: [ward('A_AND_E', 0)], servedAfterGenMinutes: 0 });
    expect(banner(), 'a fresh snapshot opened a banner').toBeNull();
    perfNow += (B.snapshotBannerAfterMinutes + 1) * MIN;
    vi.advanceTimersByTime(30_000);
    expect(banner(), 'the open page never aged').not.toBeNull();
    expect(lines()[0]).toBe(`A_AND_E: 3 beds — updated ${B.snapshotBannerAfterMinutes + 1} min ago`);
  });

  test('NO SERVE-TIME CLOCK — the page never reads fresh: the banner says it cannot tell, and every age is unknown', async () => {
    await renderAt({ wards: [ward('A_AND_E', 0)], servedAfterGenMinutes: null });
    expect(banner()).toBe("We can't confirm how recent this page is. Counts may be out of date — call before you travel.");
    expect(lines()[0]).toBe('A_AND_E: 3 beds — age unknown — call to confirm');
    expect(text()).not.toMatch(/updated/);
  });
});

/** Device-clock reads in page source, comments stripped. Empty means none. */
export function deviceClockReads(source: string): string[] {
  const code = source.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  return [...code.matchAll(/Date\.now\(\)|new Date\(\s*\)|performance\.now\(\)/g)].map((m) => m[0]);
}

describe('the page reads no device clock', () => {
  const FILES = ['apps/public-dashboard/src/main.ts', 'apps/public-dashboard/src/age-view.ts'];

  test.each(FILES)('%s makes no Date.now(), no-argument Date or performance.now() call', (file) => {
    const src = readFileSync(join(REPO_ROOT, file), 'utf8');
    expect(src.length, `${file} is empty, so this checked nothing`).toBeGreaterThan(100);
    expect(deviceClockReads(src)).toEqual([]);
  });

  test('plant — each form of a device-clock read is caught, and one in a comment is not', () => {
    expect(deviceClockReads('const a = Date.now();')).toEqual(['Date.now()']);
    expect(deviceClockReads('const b = new Date();')).toEqual(['new Date()']);
    expect(deviceClockReads('const c = performance.now();')).toEqual(['performance.now()']);
    expect(deviceClockReads('  // Date.now() is banned here')).toEqual([]);
    expect(deviceClockReads('const d = new Date(isoString);'), 'formatting a server instant is not a clock read').toEqual([]);
  });
});
