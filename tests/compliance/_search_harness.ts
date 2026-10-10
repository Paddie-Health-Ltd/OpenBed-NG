/// <reference lib="dom" />
import { vi } from 'vitest';
import { facilityColumns, wardColumns } from '../../packages/snapshot/src/codec.js';
import { ownTimers } from './_dashboard_import.js';

/**
 * THE HARNESS FOR THE PUBLIC SEARCH TESTS (R-2026-10-09 GO), shared by the rendered-page tests under tests/compliance/search_*.test.ts.
 *
 * It renders the REAL src/main.ts in jsdom, with a stubbed /beds.json, a stubbed geolocation, and the two clocks the page may use under
 * control: the serve-time header (which advances with the monotonic clock, as the Pages Function's does) and performance.now. A test
 * therefore moves time by calling `advance(minutes)`, which moves both, fires the page's 30 second poll the right number of times, and
 * lets every answer settle.
 *
 * WHY EVERY OPEN RE-IMPORTS main.ts. The module holds the visitor's search in memory (that is the design: nothing is stored), so a second
 * test in one file would inherit the first one's selection if the module were cached. vi.resetModules() before each import gives each test
 * a fresh page, exactly as a new tab is one. The caller must call ownTimers() through openPage, and releaseTimers() in afterEach.
 *
 * Every payload row is built from the codec's own column lists, never from a column list of this file's.
 */

export const MIN = 60_000;
export const GEN = Date.parse('2026-09-23T03:12:00.000Z'); // 04:12 in Lagos
export const iso = (ms: number): string => new Date(ms).toISOString();
export const POLL_MS = 30_000;

export interface FacilitySpec {
  id: string;
  name: string;
  lat?: unknown;
  lng?: unknown;
  lga?: string;
  phone?: string;
}

export interface WardSpec {
  facility: string;
  category: string;
  /** Minutes before GEN that the ward last reported. */
  agoMin?: number;
  offering?: string;
  monitoring?: string;
  bed?: number | null;
  accepting?: boolean;
  gatedBy?: string | null;
  source?: string;
  state?: string;
}

export interface World {
  facilities: FacilitySpec[];
  wards: WardSpec[];
  /** street addresses, by facility id; the optional facility_extras block. */
  addresses?: Record<string, string>;
}

function encode(columns: readonly string[], values: Record<string, unknown>): unknown[] {
  return columns.map((c) => (c in values ? values[c] : null));
}

export function facilityRow(f: FacilitySpec): unknown[] {
  return encode(facilityColumns(), {
    facility_id: f.id,
    name: f.name,
    lga: f.lga ?? 'Ikeja',
    state: 'Lagos',
    lat: 'lat' in f ? f.lat : 6.6,
    lng: 'lng' in f ? f.lng : 3.35,
    public_phone_e164: f.phone ?? '+2348000000001',
    updated_at: iso(GEN),
  });
}

export function wardRow(w: WardSpec): unknown[] {
  return encode(wardColumns(), {
    facility_id: w.facility,
    category: w.category,
    offering: w.offering ?? 'OFFERED',
    bed_count: 'bed' in w ? w.bed : 3,
    accepting_effective: w.accepting ?? true,
    gated_by: w.gatedBy ?? null,
    state: w.state ?? 'OK',
    source: w.source ?? 'WARD',
    monitoring_state: w.monitoring ?? 'ACTIVE',
    updated_at: iso(GEN - (w.agoMin ?? 5) * MIN),
  });
}

export function payloadOf(world: World): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    v: 1,
    generated_at: iso(GEN),
    server_now: iso(GEN),
    facilities: world.facilities.map(facilityRow),
    wards: world.wards.map(wardRow),
  };
  if (world.addresses !== undefined) payload['facility_extras'] = Object.entries(world.addresses);
  return payload;
}

export type Geo =
  | { kind: 'absent' }
  | { kind: 'manual' };

/** A geolocation whose answers a test gives by hand, so a slow answer and a stale one can be made. */
export interface GeoStub {
  /** getCurrentPosition calls so far. */
  readonly calls: () => number;
  readonly resolve: (lat: number, lng: number, which?: number) => void;
  readonly reject: (code: number, which?: number) => void;
  /** The options object each call carried. */
  readonly options: () => PositionOptions[];
}

export function stubGeolocation(): GeoStub {
  const pending: { ok: (p: GeolocationPosition) => void; fail: (e: GeolocationPositionError) => void }[] = [];
  const options: PositionOptions[] = [];
  const getCurrentPosition = vi.fn((ok: PositionCallback, fail?: PositionErrorCallback | null, opts?: PositionOptions) => {
    pending.push({ ok, fail: fail ?? (() => undefined) });
    options.push(opts ?? {});
  });
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
  return {
    calls: () => getCurrentPosition.mock.calls.length,
    resolve: (lat, lng, which = pending.length - 1) => pending[which]?.ok({ coords: { latitude: lat, longitude: lng, accuracy: 10 } } as unknown as GeolocationPosition),
    reject: (code, which = pending.length - 1) => pending[which]?.fail({ code, message: 'platform text that must never be shown' } as unknown as GeolocationPositionError),
    options: () => options,
  };
}

export function removeGeolocation(): void {
  Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
}

export interface Page {
  readonly mod: typeof import('../../apps/public-dashboard/src/main.js');
  /** Replace what the next fetch answers; nothing is redrawn until a poll. */
  setWorld(world: World): void;
  /** Make the next fetches fail (a failed poll keeps the held snapshot). */
  setOutage(on: boolean): void;
  /** Move both clocks forward and fire the polls that fall due. */
  advance(minutes: number): Promise<void>;
  /** Fire exactly one poll without moving time. */
  poll(): Promise<void>;
  /** Every URL the page fetched. */
  readonly fetched: string[];
}

export interface OpenOptions {
  world: World;
  /** The address the visitor arrived at, e.g. "?ward=maternity&area=apapa". */
  search?: string;
  /** Serve time, minutes after GEN, at the first fetch. Default 1. null sends no serve-time header at all, so every age is unknown. */
  servedAfterGen?: number | null;
  /** Omit the controls host, as a page that has none. */
  noControls?: boolean;
  /** Answer 503 from the first fetch, as a page opened during an outage is. */
  outageAtStart?: boolean;
}

/** Open the real page. Call releaseTimers() in afterEach. */
export async function openPage(opts: OpenOptions): Promise<Page> {
  ownTimers();
  vi.resetModules();
  let perfNow = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => perfNow);
  const servedAfterGen = opts.servedAfterGen === undefined ? 1 : opts.servedAfterGen;
  const base = (servedAfterGen ?? 0) * MIN;
  let world = opts.world;
  let outage = opts.outageAtStart === true;
  const fetched: string[] = [];
  document.body.innerHTML = `${opts.noControls === true ? '' : '<div id="search"></div>'}<main id="app"></main><footer id="site-footer"></footer>`;
  history.replaceState(null, '', `/${opts.search ?? ''}`);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      fetched.push(String(input));
      if (outage) return new Response('{}', { status: 503 });
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (servedAfterGen !== null) headers['x-openbed-served-at'] = iso(GEN + base + (perfNow - 1_000));
      return new Response(JSON.stringify(payloadOf(world)), { status: 200, headers });
    }),
  );
  const mod = await import('../../apps/public-dashboard/src/main.js');
  // The import itself starts a render, whose fetch (and, in an outage, its retry timer) is faked: the retry waits 150 to 300 ms
  // by a fake timer, so an outage page needs the clock moved past it before its first render can finish.
  const first = mod.render();
  if (outage) await vi.advanceTimersByTimeAsync(400);
  await first;
  const page: Page = {
    mod,
    fetched,
    setWorld(next) {
      world = next;
    },
    setOutage(on) {
      outage = on;
    },
    async advance(minutes) {
      const ms = minutes * MIN;
      perfNow += ms;
      await vi.advanceTimersByTimeAsync(ms);
      await vi.advanceTimersByTimeAsync(0);
    },
    async poll() {
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await vi.advanceTimersByTimeAsync(0);
    },
  };
  return page;
}

// --- reading the page -----------------------------------------------------------------------------

export const app = (): Element => document.querySelector('#app') as Element;
export const pageText = (): string => document.body.textContent ?? '';
export const appText = (): string => app().textContent ?? '';
/** The hospital names on the page, in the order drawn. */
export const cards = (): string[] => Array.from(document.querySelectorAll('#app section.facility h2')).map((h) => h.textContent ?? '');
export const wardLines = (): string[] => Array.from(document.querySelectorAll('#app li')).map((li) => li.textContent ?? '');
export const cardText = (name: string): string => {
  const h = Array.from(document.querySelectorAll('#app section.facility h2')).find((x) => x.textContent === name);
  return h?.parentElement?.textContent ?? '';
};
export const cardEl = (name: string): HTMLElement | null =>
  (Array.from(document.querySelectorAll('#app section.facility h2')).find((x) => x.textContent === name)?.parentElement as HTMLElement | undefined) ?? null;
export const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Choose an option of a combobox the way a visitor does: open it, then click the option with that label. */
export function choose(comboId: 'ward' | 'area', label: string): void {
  const input = byId<HTMLInputElement>(`${comboId}-input`);
  input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const option = Array.from(document.querySelectorAll<HTMLElement>(`#${comboId}-list li`)).find((li) => li.textContent === label);
  if (option === undefined) throw new Error(`the ${comboId} list has no option labelled ${JSON.stringify(label)}`);
  option.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

export function type(comboId: 'ward' | 'area', text: string): void {
  const input = byId<HTMLInputElement>(`${comboId}-input`);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export const tap = (id: string): void => {
  byId(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

/** A key pressed on the combobox's input. */
export function press(comboId: 'ward' | 'area', key: string): KeyboardEvent {
  const input = byId<HTMLInputElement>(`${comboId}-input`);
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  input.dispatchEvent(e);
  return e;
}
