// @vitest-environment jsdom
/// <reference lib="dom" />
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { encodeFacilityExtra, facilityColumns, wardColumns } from '../../packages/snapshot/src/codec.js';
import { areaLine, directionsUrl, formatPhoneDisplay, LOADING_TEXT } from '../../apps/public-dashboard/src/card.js';
import { ownTimers, releaseTimers } from './_dashboard_import.js';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE PUBLIC FACILITY CARD (R-2026-09-30-214 GN): a street address, "<LGA>, <State>", a Directions link, a
 * number a person can read, and a line that says the page is loading. GUARD CLASS: LIVE: the module under
 * test, apps/public-dashboard/src/card.ts and main.ts's renderer, exists now.
 *
 * EVERY ASSERTION READS THE RENDERED PAGE, in the harness the other dashboard files use: the real
 * main.ts, a stubbed fetch, the DOM. The pure helpers are unit-tested from card.ts directly, with
 * EXPECTED VALUES WRITTEN OUT AS LITERALS and never computed by the function under test.
 *
 * WHAT EACH PLANT CATCHES:
 *   - the Directions table: a link built from a value that is not a finite number in range sends a
 *     dispatcher to Google with a destination of "null,undefined" or the wrong hemisphere;
 *   - the number table: a formatter that splits a number it does not understand shows a wrong number
 *     on a phone someone is about to dial;
 *   - the loading line: a page that shows it BESIDE ward rows, or leaves it after the data arrived,
 *     says "loading" over a full list; one that never goes away on an outage hides the outage.
 *
 * NOT ASSERTED HERE, deliberately: how the card LOOKS at 375 px. jsdom lays nothing out. The screenshots
 * attached to the pull request are the read of that, by a person.
 */

const FID = 'f1000000-0000-4000-8000-000000000001';
const ADDRESS = '12 Example Street, Off Sample Avenue';

describe('formatPhoneDisplay — +234 followed by exactly ten digits, otherwise unchanged', () => {
  test.each<[string, string]>([
    ['+2348000000015', '+234 800 000 0015'],
    ['+2348000000001', '+234 800 000 0001'],
    ['+2347000000000', '+234 700 000 0000'],
    // The plants: each is NOT +234 and exactly ten digits, and must come back byte for byte.
    ['+23480000001', '+23480000001'],
    ['+23480000000155', '+23480000000155'],
    ['+14155552671', '+14155552671'],
    ['+234 800 000 0015', '+234 800 000 0015'],
    ['08000000015', '08000000015'],
    ['+23480000001x', '+23480000001x'],
    ['+2348000000015 ', '+2348000000015 '],
    ['2348000000015', '2348000000015'],
    ['', ''],
  ])('%j reads %j', (input, expected) => {
    expect(formatPhoneDisplay(input)).toBe(expected);
  });
});

describe('directionsUrl — only for a finite latitude and longitude in range', () => {
  test('the most ordinary valid pair builds the exact Google Maps URL', () => {
    expect(directionsUrl(6.5244, 3.3792)).toBe('https://www.google.com/maps/dir/?api=1&destination=6.5244,3.3792');
  });
  test.each<[string, unknown, unknown, string]>([
    ['the equator and the meridian', 0, 0, 'https://www.google.com/maps/dir/?api=1&destination=0,0'],
    ['the extreme valid corner', -90, 180, 'https://www.google.com/maps/dir/?api=1&destination=-90,180'],
    ['the other extreme corner', 90, -180, 'https://www.google.com/maps/dir/?api=1&destination=90,-180'],
  ])('accepts %s', (_n, lat, lng, url) => {
    expect(directionsUrl(lat, lng)).toBe(url);
  });
  test.each<[string, unknown, unknown]>([
    ['a null latitude', null, 3.3],
    ['an undefined longitude', 6.5, undefined],
    ['NaN', Number.NaN, 3.3],
    ['Infinity', 6.5, Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY, 3.3],
    ['a numeric STRING latitude', '6.5', 3.3],
    ['a latitude of 91', 91, 3.3],
    ['a latitude of -91', -91, 3.3],
    ['a longitude of 181', 6.5, 181],
    ['a longitude of -181', 6.5, -181],
    ['a boolean', true, 3.3],
    ['an object', {}, {}],
  ])('plant — %s builds no link', (_n, lat, lng) => {
    expect(directionsUrl(lat, lng)).toBeNull();
  });
  test('a very small coordinate is never written in exponent form, which Google would not read', () => {
    const url = directionsUrl(0.00000001, 3.3);
    expect(url).not.toBeNull();
    expect(url).not.toMatch(/e[-+]?\d/i);
  });
});

describe('areaLine — "<LGA>, <State>", leaving out what is missing', () => {
  test.each<[string, unknown, unknown, string | null]>([
    ['both present', 'Ikeja', 'Lagos', 'Ikeja, Lagos'],
    ['untrimmed', '  Ikeja ', ' Lagos ', 'Ikeja, Lagos'],
    ['a blank LGA', '   ', 'Lagos', 'Lagos'],
    ['a missing State', 'Ikeja', null, 'Ikeja'],
    ['neither', '', undefined, null],
    ['non-strings', 12, {}, null],
  ])('%s', (_n, lga, state, expected) => {
    expect(areaLine(lga, state)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------------------
// The rendered card.
// ---------------------------------------------------------------------------------------

function encode(columns: readonly string[], values: Record<string, unknown>): unknown[] {
  const unknownKeys = Object.keys(values).filter((k) => !columns.includes(k));
  if (unknownKeys.length > 0) throw new Error(`fixture names columns the codec does not have: ${unknownKeys.join(', ')}`);
  return columns.map((c) => values[c] ?? null);
}
const facility = (over: Record<string, unknown> = {}): unknown[] =>
  encode(facilityColumns(), {
    facility_id: FID, name: 'Synthetic General Hospital', lga: 'Ikeja', state: 'Lagos', lat: 6.6, lng: 3.35,
    public_phone_e164: '+2348000000015', updated_at: '2026-09-23T08:00:00+00:00', ...over,
  });
const ward = (): unknown[] =>
  encode(wardColumns(), {
    facility_id: FID, category: 'A_AND_E', offering: 'OFFERED', bed_count: 3, accepting_effective: true,
    gated_by: null, state: 'OK', source: 'WARD', monitoring_state: 'ACTIVE', updated_at: '2026-09-23T08:00:00+00:00',
  });
const envelope = (facilities: unknown[][], wards: unknown[][], extras?: unknown): Record<string, unknown> => ({
  v: 1, generated_at: '2026-09-23T08:00:00+00:00', server_now: '2026-09-23T08:00:00+00:00', facilities, wards,
  ...(extras === undefined ? {} : { facility_extras: extras }),
});
const withAddress = (): Record<string, unknown> => envelope([facility()], [ward()], [encodeFacilityExtra({ facility_id: FID, address: ADDRESS })]);

afterEach(() => {
  releaseTimers();
});

const respond = (p: unknown, status = 200): Response => new Response(JSON.stringify(p), { status, headers: { 'content-type': 'application/json' } });

type Main = typeof import('../../apps/public-dashboard/src/main.js');

/** Imports the module once (its import-time render runs against a quick failure and is flushed), then returns it. */
async function loadMain(): Promise<Main> {
  ownTimers();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
  const mod = await import('../../apps/public-dashboard/src/main.js');
  await vi.advanceTimersByTimeAsync(1_000);
  vi.unstubAllGlobals();
  return mod;
}

async function renderWith(p: unknown): Promise<{ fetches: string[] }> {
  const { render } = await loadMain();
  document.body.innerHTML = '<main id="app"></main>';
  const fetches: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { fetches.push(String(url)); return respond(p); }));
  await render();
  return { fetches };
}

const card = (): Element => {
  const s = document.querySelector('#app section.facility');
  if (s === null) throw new Error(`no facility card rendered:\n${document.body.innerHTML}`);
  return s;
};

describe('the card with an address', () => {
  test('the name, then the address, then "<LGA>, <State>", then Directions, then the call link, then the wards — in that order', async () => {
    await renderWith(withAddress());
    const order = Array.from(card().children).map((c) => `${c.tagName.toLowerCase()}${c.className === '' ? '' : `.${c.className}`}`);
    expect(order).toEqual(['h2', 'p.facility-address', 'p.facility-area', 'a.directions', 'a.call', 'ul']);
    expect(card().querySelector('.facility-address')?.textContent).toBe(ADDRESS);
    expect(card().querySelector('.facility-area')?.textContent).toBe('Ikeja, Lagos');
  });

  test('the address is text, never markup: a tag in it renders as characters', async () => {
    const evil = '<img src=x onerror=alert(1)> 1 Example Street';
    await renderWith(envelope([facility()], [ward()], [encodeFacilityExtra({ facility_id: FID, address: evil })]));
    expect(card().querySelector('.facility-address')?.textContent).toBe(evil);
    expect(card().querySelector('img'), 'the address was parsed as HTML').toBeNull();
  });

  test('the Directions link is exactly the Google Maps URL, opens in a new tab, and carries rel="noopener noreferrer"', async () => {
    await renderWith(withAddress());
    const links = card().querySelectorAll('a.directions');
    expect(links).toHaveLength(1);
    const a = links[0] as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('https://www.google.com/maps/dir/?api=1&destination=6.6,3.35');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.textContent).toBe('Directions');
    expect(a.classList.contains('call'), 'the Directions link is class call, which the call-link guards count').toBe(false);
  });

  test('the call link keeps the E.164 form in its href and shows the number in the readable form', async () => {
    await renderWith(withAddress());
    const call = card().querySelector('a.call') as HTMLAnchorElement;
    expect(call.getAttribute('href')).toBe('tel:+2348000000015');
    expect(call.textContent).toBe('Call to confirm beds: +234 800 000 0015');
    expect(document.querySelectorAll('#app a.call'), 'more than one call link for one facility').toHaveLength(1);
  });

  test('NOTHING IS FETCHED from Google or anywhere else: the only request is /beds.json', async () => {
    const { fetches } = await renderWith(withAddress());
    expect(fetches.length).toBeGreaterThan(0);
    expect(fetches.every((u) => u === '/beds.json'), `a request other than /beds.json: ${fetches.join(', ')}`).toBe(true);
    expect(document.querySelectorAll('#app img, #app iframe, #app script, #app link').length).toBe(0);
  });
});

describe('the card without an address, and the Directions rules on the page', () => {
  test('no address: no address line, but "<LGA>, <State>" and Directions still show', async () => {
    await renderWith(envelope([facility()], [ward()], []));
    expect(card().querySelector('.facility-address')).toBeNull();
    expect(card().querySelector('.facility-area')?.textContent).toBe('Ikeja, Lagos');
    expect(card().querySelector('a.directions')).not.toBeNull();
  });

  test.each<[string, unknown, unknown]>([
    ['a null latitude', null, 3.35],
    ['a string longitude', 6.6, '3.35'],
    ['a latitude of 91', 91, 3.35],
    ['a longitude of -181', 6.6, -181],
  ])('plant — %s: the card renders and shows NO Directions link', async (_n, lat, lng) => {
    await renderWith(envelope([facility({ lat, lng })], [ward()], []));
    expect(card().querySelector('a.directions'), 'a Directions link was built from an invalid coordinate').toBeNull();
    expect(card().querySelector('a.call'), 'a bad coordinate cost the facility its call link').not.toBeNull();
  });

  test('a blank LGA is left out, not rendered as a stray comma or "undefined"', async () => {
    await renderWith(envelope([facility({ lga: '  ' })], [ward()], []));
    expect(card().querySelector('.facility-area')?.textContent).toBe('Lagos');
    expect(document.body.textContent).not.toMatch(/undefined|null|, ,|^,/);
  });
});

describe('an addresses block that cannot be read costs nothing', () => {
  test('a facility_extras row of the wrong width: the cards and the wards still render, with no address, and no outage', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderWith(envelope([facility()], [ward()], [[FID, ADDRESS, 'LEAKED']]));
    expect(card().querySelector('.facility-address')).toBeNull();
    expect(document.querySelector('.outage-state'), 'a bad extras block took the beds down').toBeNull();
    expect(card().querySelectorAll('li').length).toBe(1);
    const logged = JSON.stringify(err.mock.calls);
    expect(logged, 'the log carried the address or the row').not.toContain(ADDRESS);
    expect(logged).not.toContain('LEAKED');
  });

  test('an extras row for a facility that is not in the snapshot is ignored', async () => {
    await renderWith(envelope([facility()], [ward()], [encodeFacilityExtra({ facility_id: 'someone-else', address: 'Not Ours' })]));
    expect(card().querySelector('.facility-address')).toBeNull();
    expect(document.body.textContent).not.toContain('Not Ours');
  });

  test('extras that is not an array is ignored, not thrown on', async () => {
    await renderWith({ ...envelope([facility()], [ward()]), facility_extras: 'nonsense' });
    expect(card().querySelector('.facility-address')).toBeNull();
    expect(document.querySelector('.outage-state')).toBeNull();
  });
});

describe('the new page against a snapshot generated BEFORE 031', () => {
  test('the golden payload as at 6866161, with no facility_extras key, renders its card and wards with no address and no outage', async () => {
    let golden: { golden: Record<string, unknown> };
    try {
      golden = JSON.parse(
        execFileSync('git', ['-C', REPO_ROOT, 'show', '6866161:packages/fixtures/snapshot-golden.json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
      ) as typeof golden;
    } catch (e) {
      throw new Error(`cannot read the golden payload at 6866161 from git (a shallow checkout needs fetch-depth: 0): ${String(e)}`);
    }
    expect(Object.keys(golden.golden), 'the as-at payload already carries the new key, so this is not a pre-031 payload').not.toContain('facility_extras');
    await renderWith(golden.golden);
    expect(card().querySelector('h2')?.textContent).toBe('E2E General Hospital');
    expect(card().querySelector('.facility-address')).toBeNull();
    expect(card().querySelectorAll('li').length).toBeGreaterThan(0);
    expect(document.querySelector('.outage-state')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------
// The loading line.
// ---------------------------------------------------------------------------------------

describe('the loading line', () => {
  test('the wording is exactly the approved sentence', () => {
    expect(LOADING_TEXT).toBe('Loading bed information…');
    expect(LOADING_TEXT).toContain('…');
    expect(LOADING_TEXT, 'the loading line carries a digit').not.toMatch(/\d/);
  });

  /** Starts a render whose fetch the test controls; returns the pending render and the function that answers it. */
  async function startPending(): Promise<{ done: Promise<void>; answer: (r: Response | Error) => void }> {
    const { render } = await loadMain();
    document.body.innerHTML = '<main id="app"></main>';
    let answer!: (r: Response | Error) => void;
    const pending = new Promise<Response>((resolve, reject) => {
      answer = (r) => (r instanceof Error ? reject(r) : resolve(r));
    });
    vi.stubGlobal('fetch', vi.fn(() => pending));
    const done = render();
    await vi.advanceTimersByTimeAsync(0);
    return { done, answer };
  }

  const onlyLoading = (): void => {
    const kids = Array.from(document.querySelectorAll('#app > *'));
    expect(kids.map((k) => `${k.tagName.toLowerCase()}.${k.className}`), 'the loading line is not the only thing in the main area').toEqual(['p.loading-state']);
    expect(kids[0]?.textContent).toBe('Loading bed information…');
    expect(document.querySelectorAll('#app li').length, 'the loading line sits beside ward rows').toBe(0);
  };

  test('before the first answer, the main area holds the loading line and nothing else', async () => {
    const { done, answer } = await startPending();
    onlyLoading();
    answer(respond(withAddress()));
    await done;
  });

  test('it is REPLACED by the snapshot: afterwards no loading line, the card and its wards are there', async () => {
    const { done, answer } = await startPending();
    onlyLoading();
    answer(respond(withAddress()));
    await done;
    expect(document.querySelectorAll('.loading-state').length, 'the loading line outlived the data').toBe(0);
    expect(document.querySelectorAll('#app section.facility').length).toBe(1);
  });

  test('it is REPLACED by the outage notice when the first load fails, and the outage notice is alone', async () => {
    const { done, answer } = await startPending();
    onlyLoading();
    answer(respond({}, 502));
    await vi.advanceTimersByTimeAsync(1_000);
    answer(respond({}, 502));
    await vi.advanceTimersByTimeAsync(1_000);
    await done;
    expect(document.querySelectorAll('.loading-state').length, 'the loading line hid the outage').toBe(0);
    expect(document.querySelectorAll('#app .outage-state').length).toBe(1);
    expect(document.querySelectorAll('#app > *').length).toBe(1);
  });

  test('it is REPLACED by the empty-state line when no facility has joined', async () => {
    const { done, answer } = await startPending();
    onlyLoading();
    answer(respond(envelope([], [])));
    await done;
    expect(document.querySelectorAll('.loading-state').length).toBe(0);
    expect(document.querySelectorAll('#app .empty-state').length).toBe(1);
    expect(document.querySelectorAll('#app > *').length).toBe(1);
  });

  test('a SECOND render over a page that holds data does not flash it: the held cards stay and no loading line appears', async () => {
    await renderWith(withAddress());
    expect(document.querySelectorAll('#app section.facility').length).toBe(1);
    const { render } = await import('../../apps/public-dashboard/src/main.js');
    let answer!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => { answer = resolve; });
    vi.stubGlobal('fetch', vi.fn(() => pending));
    const done = render();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelectorAll('.loading-state').length, 'a re-render flashed the loading line over live data').toBe(0);
    expect(document.querySelectorAll('#app section.facility').length, 'the held card was cleared while the refresh was in flight').toBe(1);
    answer(respond(withAddress()));
    await done;
  });

  test('plant — a page that never gets an answer keeps the loading line and never shows beds: it claims nothing about them', async () => {
    const { done, answer } = await startPending();
    await vi.advanceTimersByTimeAsync(5_000);
    onlyLoading();
    expect(document.body.textContent).not.toMatch(/\d+\s*beds?/i);
    answer(respond(withAddress()));
    await done;
  });
});
