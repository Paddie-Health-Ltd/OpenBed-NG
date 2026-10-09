// @vitest-environment jsdom
/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import LGA from '../../packages/fixtures/lga-reference-points.json';
import TABLE from '../../packages/labels/public-labels.json';
import { releaseTimers } from './_dashboard_import.js';
import {
  app, appText, byId, cardEl, cards, choose, openPage, pageText, press, removeGeolocation, stubGeolocation, tap, type, wardLines, type World,
} from './_search_harness.js';

/**
 * THE SEARCH CONTROLS AND WHAT THEY DRAW (R-2026-10-09 GO, C and D; T-CTRL-1 to 3, T-GEO-1 and 2, T-SHARE-1, T-DIR-1, T-CARD-1 and 2,
 * T-LABEL-1 and 2, T-EMPTY-1 and 2, T-A11Y-1, T-SPEC-1, and the five states the letter names).
 *
 * Every assertion reads the RENDERED page, from the real src/main.ts in jsdom with a stubbed /beds.json and a stubbed geolocation
 * (tests/compliance/_search_harness.ts). Distances are LITERALS, computed twice by two formulas before being typed here.
 *
 * Each rule that is a control carries its PLANT: a page or a pure helper made wrong, which the same assertion must reject. Where the
 * plant is a change to src/ itself (a re-sort on every draw, a selection on blur) the pull request shows it with scripts/neuter.sh.
 *
 * NOT ASSERTED HERE, deliberately: layout. jsdom lays nothing out, so tap-target sizes, wrapping at 360 and 375 px and how any of it
 * looks are the screenshots Cowork reads; and the real permission prompt on a handset (allow, deny, airplane mode) is the founder's check.
 */

const P = TABLE.phrases;
const W = TABLE.labels.ward_category;

/** Apapa, Ikeja, Epe, a hospital with no coordinates, one that offers only A&E, one with every ward NOT_OFFERED, and one with no ward row. */
const WORLD: World = {
  facilities: [
    { id: 'fa', name: 'Apapa General', lat: 6.45, lng: 3.37, lga: 'Apapa' },
    { id: 'fi', name: 'Ikeja Medical', lat: 6.6, lng: 3.35 },
    { id: 'fe', name: 'Epe Clinic', lat: 6.5857, lng: 3.9757, lga: 'Epe' },
    // No coordinates. The database cannot store this (lat and lng are NOT NULL, migration 003), so the state is reachable only from a malformed or
    // hand-made payload; it is built by hand here because the page must still draw the hospital, say "Distance unavailable" and offer no Directions.
    { id: 'fn', name: 'Null Coordinates Hospital', lat: null, lng: null },
    { id: 'fc', name: 'Casualty Only Hospital' },
    { id: 'fh', name: 'Hidden Only Hospital' },
    { id: 'fz', name: 'Wardless Hospital' },
  ],
  wards: [
    { facility: 'fa', category: 'MATERNITY', agoMin: 50 },
    { facility: 'fi', category: 'MATERNITY', agoMin: 5 },
    { facility: 'fi', category: 'A_AND_E', agoMin: 5 },
    { facility: 'fe', category: 'MATERNITY', agoMin: 200 },
    { facility: 'fn', category: 'MATERNITY', agoMin: 3 },
    { facility: 'fc', category: 'A_AND_E', agoMin: 5 },
    { facility: 'fh', category: 'MATERNITY', offering: 'NOT_OFFERED', monitoring: 'PENDING', bed: null, accepting: false },
  ],
};

const DEFAULT_MATERNITY = ['Ikeja Medical', 'Null Coordinates Hospital', 'Apapa General', 'Epe Clinic'];
const NEAREST_FROM_APAPA = ['Apapa General', 'Ikeja Medical', 'Epe Clinic', 'Null Coordinates Hospital'];
const BY_NAME = ['Apapa General', 'Casualty Only Hospital', 'Epe Clinic', 'Ikeja Medical', 'Null Coordinates Hospital'];

const statusText = (): string => byId('location-status').textContent ?? '';
const originText = (): string => (byId('origin-line').hidden ? '' : (byId('origin-text').textContent ?? ''));
const orderOptions = (): (string | null)[] => Array.from(byId<HTMLSelectElement>('order-select').options).map((o) => o.textContent);
const optionTexts = (id: 'ward' | 'area'): string[] => Array.from(document.querySelectorAll(`#${id}-list li`)).map((li) => li.textContent ?? '');
const visibleOptions = (id: 'ward' | 'area'): string[] =>
  Array.from(document.querySelectorAll<HTMLElement>(`#${id}-list li`)).filter((li) => !li.hidden).map((li) => li.textContent ?? '');
const distanceOf = (name: string): string | null => cardEl(name)?.querySelector('.facility-distance')?.textContent ?? null;

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  removeGeolocation();
});
afterEach(() => {
  releaseTimers();
});

// ---------------------------------------------------------------------------
// The two comboboxes.
// ---------------------------------------------------------------------------

describe('T-CTRL-2 — both pickers are searchable comboboxes: a labelled input, a listbox, the active option announced', () => {
  test('each input has a visible label tied to it, the combobox role, a listbox it controls, and starts closed', async () => {
    await openPage({ world: WORLD });
    for (const [id, label] of [['ward', P.ward_label], ['area', P.area_label]] as const) {
      const input = byId<HTMLInputElement>(`${id}-input`);
      const labelEl = document.querySelector(`label[for="${id}-input"]`);
      expect(labelEl?.textContent, `${id} has no label`).toBe(label);
      expect(input.getAttribute('role')).toBe('combobox');
      expect(input.getAttribute('aria-controls')).toBe(`${id}-list`);
      expect(input.getAttribute('aria-expanded')).toBe('false');
      expect(byId(`${id}-list`).getAttribute('role')).toBe('listbox');
      expect(byId(`${id}-list`).hidden).toBe(true);
    }
    expect(byId<HTMLInputElement>('ward-input').value).toBe(P.any_ward);
    expect(byId<HTMLInputElement>('area-input').value).toBe(P.any_area);
  });

  test('the controls sit outside #app and never inside it, and the near-me button, the order control and the origin line have names', async () => {
    await openPage({ world: WORLD });
    expect(app().contains(byId('search')), 'the controls are inside #app, so a poll would replace them').toBe(false);
    expect(byId('search').contains(byId('ward-input'))).toBe(true);
    expect(byId('near-me').textContent).toBe('Near me');
    // A VISIBLE label, like the two pickers' (Addendum 2, item 4 a): the same words as before, and no class that hides it.
    const orderLabel = document.querySelector('label[for="order-select"]');
    expect(orderLabel?.textContent).toBe('Order');
    expect(orderLabel?.textContent).toBe(P.order_label);
    expect(orderLabel?.className, 'the Order label is visually hidden').toBe('');
    expect(orderLabel?.closest('[hidden]'), 'the Order label sits inside a hidden element').toBeNull();
    expect(byId('origin-clear').getAttribute('aria-label')).toBe('Clear starting point');
    expect(byId('origin-clear').textContent).toBe('Clear');
  });

  test('both option lists are fixed tables: 1 + 10 bed types, 1 + 20 areas, in the label table\'s and the points file\'s own order', async () => {
    await openPage({ world: WORLD });
    expect(optionTexts('ward')).toEqual([P.any_ward, ...Object.values(W)]);
    expect(optionTexts('area')).toEqual([P.any_area, ...LGA.points.map((p) => p.label)]);
  });

  test('keyboard: ArrowDown opens the list and moves the active option, announced by aria-activedescendant, and selects NOTHING', async () => {
    await openPage({ world: WORLD });
    const input = byId<HTMLInputElement>('ward-input');
    input.focus();
    expect(press('ward', 'ArrowDown').defaultPrevented).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const first = input.getAttribute('aria-activedescendant');
    expect(first, 'the active option was not announced').toBe('ward-opt-0');
    press('ward', 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe('ward-opt-1');
    expect(document.getElementById('ward-opt-1')?.getAttribute('role')).toBe('option');
    expect(input.value, 'an arrow key changed the text').toBe(P.any_ward);
    expect(cards(), 'an arrow key changed the selection').toEqual(BY_NAME);
  });

  test('Enter on the active option selects it; Escape closes the list and restores the text to the current selection', async () => {
    await openPage({ world: WORLD });
    const input = byId<HTMLInputElement>('ward-input');
    press('ward', 'ArrowDown');
    press('ward', 'ArrowDown');
    press('ward', 'ArrowDown');
    const active = document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent;
    expect(active).toBe(W.ICU_ADULT);
    press('ward', 'Escape');
    expect(byId('ward-list').hidden).toBe(true);
    expect(input.value, 'Escape did not restore the current selection\'s label').toBe(P.any_ward);
    expect(cards(), 'Escape selected').toEqual(BY_NAME);
    const activeLabel = (): string | undefined => document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent ?? undefined;
    press('ward', 'ArrowDown');
    for (let i = 0; i < 12 && activeLabel() !== W.MATERNITY; i += 1) press('ward', 'ArrowDown');
    expect(activeLabel(), 'the arrow keys never reached Maternity').toBe(W.MATERNITY);
    press('ward', 'Enter');
    expect(input.value).toBe(W.MATERNITY);
    expect(cards()).toEqual(DEFAULT_MATERNITY);
  });

  test('a selection happens on a pointer click and never on typing or on blur', async () => {
    await openPage({ world: WORLD });
    type('ward', 'mat');
    expect(visibleOptions('ward'), 'typing did not filter the list, or matched inside a word ("premature")').toEqual([W.MATERNITY]);
    expect(cards(), 'typing selected').toEqual(BY_NAME);
    const input = byId<HTMLInputElement>('ward-input');
    input.dispatchEvent(new FocusEvent('blur'));
    expect(input.value, 'blur did not restore the selection\'s label').toBe(P.any_ward);
    expect(cards(), 'blur selected').toEqual(BY_NAME);
    choose('ward', W.MATERNITY);
    expect(input.value).toBe(W.MATERNITY);
    expect(cards()).toEqual(DEFAULT_MATERNITY);
  });

  test('typed words find a bed type through its synonyms, and a word with no match shows the message and a "Clear search" button that restores the whole list', async () => {
    await openPage({ world: WORLD });
    type('ward', 'labour');
    expect(visibleOptions('ward')).toEqual([W.MATERNITY]);
    type('ward', 'paeds');
    expect(visibleOptions('ward'), 'a word that belongs to one bed type finds only it').toEqual([W.PAEDIATRIC]);
    type('ward', 'infant');
    expect(visibleOptions('ward'), 'a word the two newborn units share finds both').toEqual([W.NICU, W.SCBU]);
    type('ward', 'kids');
    expect(visibleOptions('ward'), 'a word that belongs to two bed types finds both').toEqual([W.ICU_PAEDIATRIC, W.PAEDIATRIC]);
    type('ward', 'intensive care');
    expect(visibleOptions('ward'), 'each typed word must start a word of the option: "intensive care" finds Adult ICU alone').toEqual([W.ICU_ADULT]);
    type('ward', 'a&e');
    expect(visibleOptions('ward'), 'an ampersand stays inside a word').toEqual([W.A_AND_E]);
    type('ward', 'zzzz');
    expect(visibleOptions('ward')).toEqual([]);
    expect(byId('ward-list').hidden, 'an EMPTY bordered list was left on the page beside the no-match message').toBe(true);
    expect(byId<HTMLInputElement>('ward-input').getAttribute('aria-expanded')).toBe('true');
    const none = document.querySelector<HTMLElement>('#ward-input ~ .combo-none') as HTMLElement;
    expect(none.hidden, 'no message for a word that matches nothing').toBe(false);
    expect(none.textContent).toBe(`${P.no_match_ward}${P.clear_search}`);
    (none.querySelector('button') as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(byId<HTMLInputElement>('ward-input').value).toBe('');
    expect(visibleOptions('ward').length, '"Clear search" did not restore every option').toBe(11);
    expect(byId('ward-list').hidden, '"Clear search" left the list closed').toBe(false);
    expect(none.hidden, 'the message outlived "Clear search"').toBe(true);
    expect(cards(), 'Clear search selected').toEqual(BY_NAME);
  });

  test('typed text is never echoed into the page, a message or the address', async () => {
    await openPage({ world: WORLD });
    const sentinel = 'zzq<b>owned</b>';
    type('area', sentinel);
    type('ward', sentinel);
    expect(pageText(), 'typed text reached the page text outside the input').not.toContain(sentinel);
    expect(document.body.innerHTML, 'typed text reached the markup').not.toContain('owned</b>');
    expect(location.search).toBe('');
  });

  test('a ward and an area can be found by their ordinary names, and choosing them writes the address', async () => {
    await openPage({ world: WORLD });
    choose('ward', W.MATERNITY);
    expect(location.search).toBe('?ward=maternity');
    choose('area', 'Apapa');
    expect(location.search).toBe('?ward=maternity&area=apapa');
    choose('area', P.any_area);
    expect(location.search).toBe('?ward=maternity');
    choose('ward', P.any_ward);
    expect(location.search).toBe('');
  });
});

describe('T-CTRL-1 — a poll replaces the results, and keeps the controls, their text, their open list and their focus', () => {
  test('the same input elements, the typed text, the open list and the active option survive a poll', async () => {
    const page = await openPage({ world: WORLD });
    const input = byId<HTMLInputElement>('ward-input');
    input.focus();
    type('ward', 'mat');
    const active = input.getAttribute('aria-activedescendant');
    expect(active).toBe('ward-opt-8');
    await page.poll();
    expect(byId<HTMLInputElement>('ward-input'), 'a poll replaced the input').toBe(input);
    expect(input.value, 'a poll changed the input text').toBe('mat');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(byId('ward-list').hidden, 'a poll closed the list').toBe(false);
    expect(input.getAttribute('aria-activedescendant'), 'a poll moved the active option').toBe(active);
    expect(visibleOptions('ward'), 'a poll rebuilt or refiltered the list').toEqual([W.MATERNITY]);
    expect(document.activeElement, 'a poll took focus from the input').toBe(input);
  });

  test('focus on the order control, on the near-me button and on the area input survives a poll', async () => {
    const page = await openPage({ world: WORLD, search: '?ward=maternity&area=apapa' });
    for (const id of ['order-select', 'near-me', 'area-input']) {
      const el = byId(id);
      el.focus();
      await page.poll();
      expect(byId(id), `a poll replaced #${id}`).toBe(el);
      expect(document.activeElement, `a poll took focus from #${id}`).toBe(el);
    }
  });

  test('a selection survives a poll: the ward, the area and the origin line are as the visitor left them', async () => {
    const page = await openPage({ world: WORLD });
    choose('ward', W.MATERNITY);
    choose('area', 'Apapa');
    await page.advance(2);
    expect(byId<HTMLInputElement>('ward-input').value).toBe(W.MATERNITY);
    expect(byId<HTMLInputElement>('area-input').value).toBe('Apapa');
    expect(originText()).toBe('From the Apapa reference point');
  });

  test('the coverage line updates its numerals in place and is not a live region; the location status is the one live region', async () => {
    const page = await openPage({ world: WORLD, search: '?ward=maternity' });
    const coverage = byId('coverage');
    expect(coverage.textContent).toBe('Showing 4 of 5 participating hospitals. OpenBed does not yet cover every hospital in Lagos.');
    expect(coverage.getAttribute('aria-live'), 'the coverage line is a live region').toBeNull();
    expect(coverage.closest('[aria-live]'), 'the coverage line sits inside a live region').toBeNull();
    expect(coverage.getAttribute('role')).toBeNull();
    const grown: World = { ...WORLD, facilities: [...WORLD.facilities, { id: 'fx', name: 'Xylo Hospital' }], wards: [...WORLD.wards, { facility: 'fx', category: 'MATERNITY' }] };
    page.setWorld(grown);
    await page.poll();
    expect(byId('coverage'), 'a poll replaced the coverage line').toBe(coverage);
    expect(coverage.textContent).toBe('Showing 5 of 6 participating hospitals. OpenBed does not yet cover every hospital in Lagos.');
    const live = Array.from(document.querySelectorAll('[aria-live]'));
    expect(live.map((e) => e.id)).toEqual(['location-status']);
    expect(byId('location-status').getAttribute('role')).toBe('status');
  });
});

// ---------------------------------------------------------------------------
// The order control, the starting point and the distance.
// ---------------------------------------------------------------------------

describe('the order control (GO-4 a) and the starting point', () => {
  test('with a ward and no origin: "Recent reports first" alone, with its alphabetical explanation; under Any: "By name", no explanation', async () => {
    await openPage({ world: WORLD, search: '?ward=maternity' });
    expect(orderOptions()).toEqual([P.order_recent]);
    expect(byId('order-explain').textContent).toBe('Grouped by report age; alphabetical within each group.');
    choose('ward', P.any_ward);
    expect(orderOptions()).toEqual([P.order_name]);
    expect(byId('order-explain').hidden).toBe(true);
  });

  test('choosing an area sets the starting point: the origin line, "Nearest first" offered, the distance on every card, no hospital removed (T-DIST-3)', async () => {
    await openPage({ world: WORLD, search: '?ward=maternity' });
    choose('area', 'Apapa');
    expect(originText()).toBe('From the Apapa reference point');
    expect(orderOptions()).toEqual([P.order_recent, P.order_nearest]);
    expect(byId('order-explain').textContent).toBe('Grouped by report age; nearest within each group.');
    expect(cards(), 'choosing an area removed or reordered a hospital it should not have').toEqual(DEFAULT_MATERNITY);
    expect(distanceOf('Apapa General')).toBe('About 0.6 km from the Apapa reference point · straight line');
    expect(distanceOf('Ikeja Medical')).toBe('About 17.3 km from the Apapa reference point · straight line');
    expect(distanceOf('Epe Clinic')).toBe('About 68.9 km from the Apapa reference point · straight line');
    expect(distanceOf('Null Coordinates Hospital')).toBe('Distance unavailable');
  });

  test('"Nearest first" orders by distance whatever the age, keeps every hospital, and puts the one with no distance last', async () => {
    await openPage({ world: WORLD, search: '?ward=maternity&area=apapa' });
    byId<HTMLSelectElement>('order-select').value = 'nearest';
    byId('order-select').dispatchEvent(new Event('change', { bubbles: true }));
    expect(cards()).toEqual(NEAREST_FROM_APAPA);
    expect(byId('order-explain').textContent).toBe('Nearest first, whatever the age of the report. Each card shows its age.');
    expect(wardLines().length, '"Nearest first" dropped a ward row').toBe(4);
  });

  test('"Clear" while "Nearest first" is selected removes the origin line and returns the order to the view\'s default, re-sorted', async () => {
    await openPage({ world: WORLD, search: '?ward=maternity&area=apapa' });
    byId<HTMLSelectElement>('order-select').value = 'nearest';
    byId('order-select').dispatchEvent(new Event('change', { bubbles: true }));
    expect(cards()).toEqual(NEAREST_FROM_APAPA);
    tap('origin-clear');
    expect(byId('origin-line').hidden).toBe(true);
    expect(orderOptions()).toEqual([P.order_recent]);
    expect(byId<HTMLSelectElement>('order-select').value).toBe('default');
    expect(cards()).toEqual(DEFAULT_MATERNITY);
    expect(document.querySelector('.facility-distance'), 'a distance outlived its origin').toBeNull();
    expect(location.search).toBe('?ward=maternity');
  });

  test('moving between a ward and Any maps the two default orders onto each other, and "Nearest first" carries over', async () => {
    await openPage({ world: WORLD, search: '?ward=maternity&area=apapa' });
    byId<HTMLSelectElement>('order-select').value = 'nearest';
    byId('order-select').dispatchEvent(new Event('change', { bubbles: true }));
    choose('ward', P.any_ward);
    expect(byId<HTMLSelectElement>('order-select').value, '"Nearest first" did not carry over to Any').toBe('nearest');
    expect(orderOptions()).toEqual([P.order_name, P.order_nearest]);
    // The casualty-only hospital shares Ikeja Medical's coordinates, so the tie is broken by name.
    expect(cards()).toEqual(['Apapa General', 'Casualty Only Hospital', 'Ikeja Medical', 'Epe Clinic', 'Null Coordinates Hospital']);
  });

  test('plant — the distance wording is the ruled words: a distance that is not "straight line" is rejected', () => {
    const ok = /^About \d+\.\d km from the .+ reference point · straight line$/;
    expect(ok.test('About 0.6 km from the Apapa reference point · straight line')).toBe(true);
    expect(ok.test('About 0.6 km from the Apapa centre · straight line'), 'the plant said "centre"').toBe(false);
    expect(ok.test('About 0.6 km from the Apapa reference point'), 'the plant dropped "straight line"').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Near me.
// ---------------------------------------------------------------------------

describe('T-GEO — "Near me" asks once per tap, and never before it', () => {
  test('T-GEO-1: nothing asks the device on load, on a bed-type choice, on an area choice, or on a poll', async () => {
    const geo = stubGeolocation();
    const page = await openPage({ world: WORLD });
    choose('ward', W.MATERNITY);
    choose('area', 'Apapa');
    await page.advance(2);
    expect(geo.calls()).toBe(0);
    tap('near-me');
    expect(geo.calls()).toBe(1);
    expect(geo.options()[0]).toEqual({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 });
  });

  test('a successful tap sets "From your location", clears the area picker, offers "Nearest first", and writes no area to the address', async () => {
    const geo = stubGeolocation();
    await openPage({ world: WORLD, search: '?ward=maternity&area=apapa' });
    tap('near-me');
    geo.resolve(6.5, 3.4);
    expect(originText()).toBe('From your location');
    expect(byId<HTMLInputElement>('area-input').value, 'the area picker kept an area beside a device origin').toBe(P.any_area);
    expect(orderOptions()).toEqual([P.order_recent, P.order_nearest]);
    expect(distanceOf('Apapa General')).toBe('About 6.5 km away · straight line');
    expect(distanceOf('Ikeja Medical')).toBe('About 12.4 km away · straight line');
    expect(distanceOf('Epe Clinic')).toBe('About 64.3 km away · straight line');
    expect(distanceOf('Null Coordinates Hospital')).toBe('Distance unavailable');
    expect(location.search, 'a device search wrote an area').toBe('?ward=maternity');
    expect(cards()).toEqual(DEFAULT_MATERNITY);
  });

  test.each([
    [1, 'Location permission was declined. Choose an area instead.'],
    [2, 'Your location could not be found. Choose an area instead.'],
    [3, 'Finding your location took too long. Choose an area instead.'],
  ])('T-GEO-2: error code %i shows its sentence, keeps the picker usable, and the page is not blank', async (code, sentence) => {
    const geo = stubGeolocation();
    await openPage({ world: WORLD, search: '?ward=maternity' });
    tap('near-me');
    geo.reject(code);
    expect(statusText()).toBe(sentence);
    expect(statusText(), 'the browser\'s own error text was shown').not.toContain('platform text');
    expect(byId('origin-line').hidden, 'a failure set a starting point').toBe(true);
    expect(cards()).toEqual(DEFAULT_MATERNITY);
    choose('area', 'Ikeja');
    expect(originText()).toBe('From the Ikeja reference point');
    expect(statusText(), 'the failure sentence outlived an area choice').toBe('');
  });

  test('T-GEO-2: no geolocation at all, a position that is not a position, and a call that throws each give the "could not be found" sentence', async () => {
    const unavailable = 'Your location could not be found. Choose an area instead.';
    removeGeolocation();
    await openPage({ world: WORLD });
    tap('near-me');
    expect(statusText(), 'unsupported').toBe(unavailable);
    releaseTimers();

    const geo = stubGeolocation();
    await openPage({ world: WORLD });
    tap('near-me');
    geo.resolve(Number.NaN, 3.4);
    expect(statusText(), 'NaN').toBe(unavailable);
    expect(byId('origin-line').hidden).toBe(true);
    tap('near-me');
    geo.resolve(91, 3.4);
    expect(statusText(), 'out of range').toBe(unavailable);
    releaseTimers();

    await openPage({ world: WORLD });
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: () => { throw new Error('boom'); } }, configurable: true });
    tap('near-me');
    expect(statusText(), 'a synchronous throw').toBe(unavailable);
    expect(cards().length).toBe(5);
  });

  test('a failed second tap leaves the origin the first one set', async () => {
    const geo = stubGeolocation();
    await openPage({ world: WORLD, search: '?ward=maternity' });
    tap('near-me');
    geo.resolve(6.5, 3.4);
    expect(originText()).toBe('From your location');
    tap('near-me');
    geo.reject(1);
    expect(originText(), 'a refusal threw away the earlier origin').toBe('From your location');
    expect(statusText()).toBe('Location permission was declined. Choose an area instead.');
  });

  test('a stale answer is dropped silently: after a newer tap, an area choice or Clear, an older callback sets no origin, shows no message and re-sorts nothing', async () => {
    const geo = stubGeolocation();
    const page = await openPage({ world: WORLD, search: '?ward=maternity' });
    const searchModule = await import('../../apps/public-dashboard/src/search.js');
    // two taps: only the second counts
    tap('near-me');
    tap('near-me');
    geo.resolve(6.5, 3.4, 0);
    expect(byId('origin-line').hidden, 'the first (stale) tap\'s answer set an origin').toBe(true);
    geo.resolve(6.5, 3.4, 1);
    expect(originText()).toBe('From your location');
    // a tap, then an area choice: the tap's answer is stale
    tap('near-me');
    choose('area', 'Epe');
    geo.resolve(6.0, 3.0, 2);
    expect(originText(), 'a stale answer replaced the area the visitor chose').toBe('From the Epe reference point');
    // a tap, then Clear
    tap('near-me');
    tap('origin-clear');
    geo.resolve(6.0, 3.0, 3);
    expect(byId('origin-line').hidden, 'a stale answer set an origin after Clear').toBe(true);
    // a stale failure is silent too
    tap('near-me');
    tap('near-me');
    geo.reject(1, 4);
    expect(statusText(), 'a stale failure spoke').toBe('');
    // a poll or a bed-type change never advances the token: a pending answer survives them
    tap('near-me');
    await page.poll();
    choose('ward', W.MATERNITY);
    geo.resolve(6.5, 3.4, 6);
    expect(originText(), 'a poll or a ward change made a pending answer stale').toBe('From your location');
    void searchModule;
  });

  test('choosing an area while a device origin is held discards the device origin, and Clear returns focus to the area picker', async () => {
    const geo = stubGeolocation();
    await openPage({ world: WORLD, search: '?ward=maternity' });
    tap('near-me');
    geo.resolve(6.5, 3.4);
    choose('area', 'Apapa');
    expect(originText()).toBe('From the Apapa reference point');
    tap('origin-clear');
    expect(document.activeElement).toBe(byId('area-input'));
    expect(originText()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The share link, Directions, and the home line under the picker.
// ---------------------------------------------------------------------------

describe('T-SHARE-1 and T-DIR-1 — the link and Directions carry no visitor position', () => {
  const clipboard = (): { text: () => string | null } => {
    let written: string | null = null;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async (t: string) => { written = t; }) }, configurable: true });
    return { text: () => written };
  };

  test('"Copy link to this search" writes the address\'s own ward and area onto the home URL, and says "Link copied"', async () => {
    const c = clipboard();
    await openPage({ world: WORLD, search: '?ward=maternity&area=apapa' });
    expect(byId('copy-link').textContent).toBe('Copy link to this search');
    tap('copy-link');
    await Promise.resolve();
    await Promise.resolve();
    expect(c.text()).toBe('https://openbed.ng/?ward=maternity&area=apapa');
    expect(statusText()).toBe('Link copied');
    expect(byId('share-note').textContent).toBe('The link carries only the bed type and area you chose.');
  });

  test('after a device search the link holds the ward only, no area and no coordinate, and the note says the recipient chooses their own', async () => {
    const c = clipboard();
    const geo = stubGeolocation();
    await openPage({ world: WORLD, search: '?ward=maternity&area=apapa' });
    tap('near-me');
    geo.resolve(6.123457, 3.654322);
    tap('copy-link');
    await Promise.resolve();
    await Promise.resolve();
    expect(c.text()).toBe('https://openbed.ng/?ward=maternity');
    expect(c.text()).not.toMatch(/6\.12|3\.65|area=/);
    expect(byId('share-note').textContent).toBe('Your location is not in the link. The person you send it to chooses their own starting point.');
  });

  test('T-DIR-1: Directions carries the hospital\'s own coordinates and no visitor coordinate; a hospital with null coordinates has no Directions link', async () => {
    const geo = stubGeolocation();
    await openPage({ world: WORLD, search: '?ward=maternity' });
    tap('near-me');
    geo.resolve(6.123457, 3.654322);
    const href = (name: string): string | null => cardEl(name)?.querySelector('a.directions')?.getAttribute('href') ?? null;
    expect(href('Apapa General')).toBe('https://www.google.com/maps/dir/?api=1&destination=6.45,3.37');
    expect(document.body.innerHTML, 'a visitor coordinate reached a link').not.toMatch(/6\.123457|3\.654322|6\.12346|3\.65432/);
    expect(href('Null Coordinates Hospital'), 'a hospital with no coordinates got a Directions link').toBeNull();
    expect(cardEl('Null Coordinates Hospital')?.querySelector('a.call'), 'the call link went with the coordinates').not.toBeNull();
  });
});

describe('T-ATTR-1 — the home page\'s attribution line, one of three readers of one constant', () => {
  test('the line under the area picker carries the constant\'s text, with "© OpenStreetMap contributors" linked to the copyright page', async () => {
    await openPage({ world: WORLD });
    const line = byId('area-attribution');
    expect(line.textContent).toBe(LGA.attribution);
    const link = line.querySelector('a');
    expect(link?.textContent).toBe('© OpenStreetMap contributors');
    expect(link?.getAttribute('href')).toBe('https://www.openstreetmap.org/copyright');
    expect(app().contains(line), 'the attribution sits inside #app').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The card.
// ---------------------------------------------------------------------------

describe('T-CARD-1 and 2 — the chosen ward leads, and a count never reads as "accepting"', () => {
  test('T-CARD-1: the card reads name, area, distance, Directions, call, then the chosen ward alone', async () => {
    await openPage({ world: { ...WORLD, addresses: { fa: '1 Wharf Road, Apapa' } }, search: '?ward=maternity&area=apapa' });
    const card = cardEl('Apapa General') as HTMLElement;
    const kinds = Array.from(card.children).map((c) => (c.tagName === 'H2' ? 'name' : c.tagName === 'UL' ? 'UL' : (c.className.split(' ')[0] ?? c.tagName)));
    expect(kinds).toEqual(['name', 'facility-address', 'facility-area', 'facility-distance', 'directions', 'call', 'UL']);
    expect(card.querySelector('.facility-address')?.textContent).toBe('1 Wharf Road, Apapa');
    expect(card.querySelector('.facility-area')?.textContent).toBe('Apapa, Lagos');
    expect(card.querySelectorAll('li').length, 'the chosen-ward card drew other wards').toBe(1);
    expect(card.querySelector('li')?.textContent).toBe(`${W.MATERNITY}: 3 beds reported\u00a0— last reported 51 min ago — call to confirm`);
  });

  test('T-CARD-1: under Any each hospital keeps its per-ward presentation and no count is summed across categories', async () => {
    await openPage({ world: WORLD });
    const card = cardEl('Ikeja Medical') as HTMLElement;
    // In the order served: the fixture lists the hospital's maternity ward before its A&E.
    expect(Array.from(card.querySelectorAll('li')).map((l) => l.textContent)).toEqual([
      `${W.MATERNITY}: 3 beds reported\u00a0— updated 6 min ago`,
      `${W.A_AND_E}: 3 beds reported\u00a0— updated 6 min ago`,
    ]);
    expect(card.textContent, 'a count was summed').not.toMatch(/\b6 beds/);
  });

  test.each([
    ['FRESH', 5, `${W.MATERNITY}: 3 beds reported\u00a0— not accepting (no anaesthetist on duty)\u00a0— updated 6 min ago`],
    ['AGEING', 50, `${W.MATERNITY}: 3 beds reported\u00a0— not accepting (no anaesthetist on duty)\u00a0— last reported 51 min ago — call to confirm`],
  ])('T-CARD-2: a positive count with accepting_effective false reads "not accepting" with its reason when %s', async (_band, ago, line) => {
    await openPage({ world: { facilities: [{ id: 'f1', name: 'Gated Hospital' }], wards: [{ facility: 'f1', category: 'MATERNITY', agoMin: ago, accepting: false, gatedBy: 'NO_ANAESTHETIST_ON_DUTY' }] }, search: '?ward=maternity' });
    expect(wardLines()[0]).toBe(line);
    expect(wardLines()[0], 'a positive count read as available').not.toMatch(/available/i);
  });

  test('T-CARD-2: when STALE, the last known count and the last reported admissions words say not accepting, with the gate reason when there is one', async () => {
    const world = (gated: boolean): World => ({
      facilities: [{ id: 'f1', name: 'Gated Hospital' }],
      wards: [{ facility: 'f1', category: 'MATERNITY', agoMin: 200, accepting: false, gatedBy: gated ? 'NO_ANAESTHETIST_ON_DUTY' : null }],
    });
    await openPage({ world: world(true), search: '?ward=maternity' });
    expect(wardLines()[0]).toMatch(new RegExp(`^${W.MATERNITY}: Last known: 3 beds\u00a0— Last reported not accepting admissions \\(no anaesthetist on duty\\)\u00a0— last reported at .*\\(Lagos time\\) — call to confirm$`));
    releaseTimers();
    await openPage({ world: world(false), search: '?ward=maternity' });
    expect(wardLines()[0]).toMatch(new RegExp(`^${W.MATERNITY}: Last known: 3 beds\u00a0— Last reported not accepting admissions\u00a0— last reported at .*\\(Lagos time\\) — call to confirm$`));
  });

  test('a null count after a first report reads "Bed count not reported" (STALE: "Last known: bed count not reported"), never "not yet reporting", never zero', async () => {
    await openPage({ world: { facilities: [{ id: 'f1', name: 'Quiet Hospital' }], wards: [{ facility: 'f1', category: 'MATERNITY', agoMin: 5, bed: null }] }, search: '?ward=maternity' });
    expect(wardLines()[0]).toBe(`${W.MATERNITY}: Bed count not reported\u00a0— updated 6 min ago`);
    expect(pageText()).not.toContain('not yet reporting');
    releaseTimers();
    await openPage({ world: { facilities: [{ id: 'f1', name: 'Quiet Hospital' }], wards: [{ facility: 'f1', category: 'MATERNITY', agoMin: 200, bed: null }] }, search: '?ward=maternity' });
    expect(wardLines()[0]).toMatch(new RegExp(`^${W.MATERNITY}: Last known: bed count not reported\u00a0— ${P.last_accepting}\u00a0— last reported at`));
    expect(pageText()).not.toContain('not yet reporting');
  });

  test('SUPPRESSED shows no digit anywhere in the row, and the distance sits outside it (T-SPEC-1)', async () => {
    await openPage({ world: { facilities: [{ id: 'f1', name: 'Old Hospital', lat: 6.45, lng: 3.37 }], wards: [{ facility: 'f1', category: 'MATERNITY', agoMin: 900 }] }, search: '?ward=maternity&area=apapa' });
    const li = document.querySelector('#app li') as HTMLElement;
    expect(li.textContent).toBe(`${W.MATERNITY}: Status unknown — call to confirm`);
    expect(li.outerHTML, 'a digit survived on the row').not.toMatch(/\d/);
    expect(li.querySelector('.facility-distance'), 'the distance is inside the ward row').toBeNull();
    expect(cardEl('Old Hospital')?.querySelector('.facility-distance')?.textContent).toMatch(/^About \d/);
  });
});

// ---------------------------------------------------------------------------
// The public phrases, and the states the letter names.
// ---------------------------------------------------------------------------

describe('T-LABEL-1 and 2, T-A11Y-1 and the five states (GO, H) — the public phrases render exactly as ruled', () => {
  test('the three ruled phrases carry their em dash, and the shared console words appear nowhere on the public page', async () => {
    expect(P.not_yet_reported).toBe('Availability not yet reported — call to confirm');
    expect(P.reporting_paused).toBe('Reporting paused — call to confirm');
    expect(TABLE.fallbacks.status).toBe('Status unknown — call to confirm');
    await openPage({
      world: {
        facilities: [{ id: 'f1', name: 'Mixed Hospital' }],
        wards: [
          { facility: 'f1', category: 'MATERNITY', monitoring: 'PENDING', bed: null, agoMin: 0 },
          { facility: 'f1', category: 'A_AND_E', monitoring: 'PAUSED', agoMin: 0 },
          { facility: 'f1', category: 'NICU', monitoring: 'WHATEVER' },
        ],
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(wardLines()).toEqual([`${W.MATERNITY}: ${P.not_yet_reported}`, `${W.A_AND_E}: ${P.reporting_paused}`, `${W.NICU}: Status unknown — call to confirm`]);
    expect(pageText()).not.toContain('not currently reporting');
    expect(pageText()).not.toContain('not yet reporting');
    expect(pageText()).not.toContain('not offered at this facility');
  });

  test('T-LABEL-1: the shared console strings are unchanged in the table the ward console reads', () => {
    expect(TABLE.labels.monitoring_state.PENDING).toBe('not currently reporting');
    expect(TABLE.labels.monitoring_state.PAUSED).toBe('not currently reporting');
    expect(TABLE.labels.ward_offering.NOT_OFFERED).toBe('not offered at this facility');
  });

  test('a ward the hospital offers but has never reported is listed, and a ward offered by no listed hospital gets the empty sentence with 112 / 767 (T-EMPTY-1)', async () => {
    await openPage({ world: WORLD, search: '?ward=nicu' });
    expect(app().querySelector('.empty-state')?.textContent).toBe(`No participating hospital currently lists ${W.NICU}. Try another bed type or choose "Any bed type". Call the facility directly, or 112 / 767 in an emergency.`);
    expect(appText()).not.toContain('No facility has joined');
    expect(app().querySelector('.outage-state')).toBeNull();
    expect(byId('coverage').textContent).toBe('Showing 0 of 5 participating hospitals. OpenBed does not yet cover every hospital in Lagos.');
    expect(document.getElementById('emergency-strip') ?? document.body, 'the emergency strip is part of index.html, not of this page').toBeTruthy();
    expect(cards()).toEqual([]);
  });

  test('T-EMPTY-2: N and M are counted from what the page can draw — a hospital with only hidden wards, one with no ward rows, and one with no callable identity count in neither', async () => {
    await openPage({ world: WORLD });
    expect(byId('coverage').textContent).toBe('Showing 5 of 5 participating hospitals. OpenBed does not yet cover every hospital in Lagos.');
    expect(cards()).toEqual(BY_NAME);
    expect(WORLD.facilities.length, 'M must not be facilities.length').not.toBe(5);
  });

  test('the hospital with only NOT_OFFERED wards and the one with no ward rows are not drawn at all', async () => {
    await openPage({ world: WORLD });
    expect(cards()).not.toContain('Hidden Only Hospital');
    expect(cards()).not.toContain('Wardless Hospital');
  });

  test('every facility NOT_OFFERED is neither "no facility has joined" nor an availability report', async () => {
    await openPage({ world: { facilities: [{ id: 'f1', name: 'Only Hidden' }], wards: [{ facility: 'f1', category: 'MATERNITY', offering: 'NOT_OFFERED' }] } });
    expect(appText()).toContain('Facilities have joined, but none has reported a ward yet.');
    expect(appText()).toContain('NOT a report that beds are unavailable');
    expect(cards()).toEqual([]);
  });

  test('T-A11Y-1: zero, none, old and suppressed are each carried by words, not by colour alone', async () => {
    await openPage({
      world: {
        facilities: [
          { id: 'f0', name: 'Zero Hospital' }, { id: 'f1', name: 'None Hospital' }, { id: 'f2', name: 'Old Hospital' }, { id: 'f3', name: 'Suppressed Hospital' },
        ],
        wards: [
          { facility: 'f0', category: 'MATERNITY', agoMin: 5, bed: 0 },
          { facility: 'f1', category: 'MATERNITY', monitoring: 'PENDING', bed: null, agoMin: 0 },
          { facility: 'f2', category: 'MATERNITY', agoMin: 400 },
          { facility: 'f3', category: 'MATERNITY', agoMin: 900 },
        ],
      },
      search: '?ward=maternity',
    });
    const lineFor = (name: string): string => cardEl(name)?.querySelector('li')?.textContent ?? '';
    expect(lineFor('Zero Hospital')).toBe(`${W.MATERNITY}: 0 beds reported\u00a0— updated 6 min ago`);
    expect(lineFor('None Hospital')).toBe(`${W.MATERNITY}: ${P.not_yet_reported}`);
    expect(lineFor('Old Hospital')).toContain('Last known: 3 beds');
    expect(lineFor('Suppressed Hospital')).toBe(`${W.MATERNITY}: Status unknown — call to confirm`);
  });
});

describe('the page with no controls host, and an address that asks for something unknown', () => {
  test('a page with no #search host still draws every hospital, on the default order', async () => {
    await openPage({ world: WORLD, noControls: true });
    expect(cards()).toEqual(BY_NAME);
  });

  test.each([
    ['?ward=burns&area=nowhere&lat=6.5&lng=3.4', BY_NAME],
    ['?ward=maternity&area=nowhere', DEFAULT_MATERNITY],
    ['?ward=MATERNITY', BY_NAME],
  ])('the address %s falls back safely and is written back clean', async (search, order) => {
    await openPage({ world: WORLD, search });
    expect(cards()).toEqual(order);
    expect(location.search, 'an unsupported value survived into the address').not.toMatch(/burns|nowhere|lat=|lng=/);
  });

  test('an address with a ward and an area opens with both chosen and both shown', async () => {
    await openPage({ world: WORLD, search: '?ward=maternity&area=ikeja' });
    expect(byId<HTMLInputElement>('ward-input').value).toBe(W.MATERNITY);
    expect(byId<HTMLInputElement>('area-input').value).toBe('Ikeja');
    expect(originText()).toBe('From the Ikeja reference point');
    expect(location.search).toBe('?ward=maternity&area=ikeja');
  });
});

// ---------------------------------------------------------------------------
// A dash never stands alone (Addendum 2, item 4 b).
// ---------------------------------------------------------------------------

/**
 * On a phone the age stamp takes its own line, so the dash before it ends the line above. With a plain space before the dash, a long claim
 * (a gate reason in brackets, "0 beds reported") let the dash wrap alone onto a line of its own at 360 px. With a NON-BREAKING space it travels
 * with the word before it. A browser breaks a line at a plain space and never at U+00A0, so what a test can hold is the TEXT: in every ward row
 * that has a stamp, the characters immediately before the stamp are U+00A0, an em dash and one space, and a plain-space form is absent.
 */
export function danglingDashViolations(rows: readonly Element[]): string[] {
  const out: string[] = [];
  let checked = 0;
  for (const li of rows) {
    const stamp = li.querySelector('.stamp');
    if (stamp === null) continue;
    checked += 1;
    const text = li.textContent ?? '';
    const at = text.lastIndexOf(stamp.textContent ?? '');
    const before = text.slice(Math.max(0, at - 3), at);
    if (before !== '\u00a0— ') out.push(`the characters before the stamp "${stamp.textContent}" are ${JSON.stringify(before)}, not a non-breaking space, a dash and a space`);
    if (/[^\u00a0] — (updated|last reported|age unknown|not accepting|Last reported|set by admin|under review)/.test(text)) out.push(`a plain-space dash before a stamp in "${text}"`);
  }
  if (checked === 0) out.push('no ward row with a stamp was checked');
  return out;
}

describe('the dash before the age stamp is joined to the word before it', () => {
  const gated = (ago: number, extra: Record<string, unknown> = {}): World => ({
    facilities: [{ id: 'f1', name: 'Gated Hospital' }],
    wards: [{ facility: 'f1', category: 'MATERNITY', agoMin: ago, accepting: false, gatedBy: 'NO_ANAESTHETIST_ON_DUTY', ...extra }],
  });

  test.each<[string, World]>([
    ['FRESH and gated, the case the review found', gated(5)],
    ['AGEING and gated', gated(50)],
    ['zero beds', { facilities: [{ id: 'f1', name: 'Zero Hospital' }], wards: [{ facility: 'f1', category: 'MATERNITY', agoMin: 5, bed: 0 }] }],
    ['STALE', gated(200)],
    ['a count that was never given', { facilities: [{ id: 'f1', name: 'Quiet Hospital' }], wards: [{ facility: 'f1', category: 'MATERNITY', agoMin: 5, bed: null }] }],
  ])('%s', async (_name, world) => {
    await openPage({ world, search: '?ward=maternity' });
    expect(danglingDashViolations(Array.from(document.querySelectorAll('#app li')))).toEqual([]);
  });

  test('an age that cannot be measured has the same join', async () => {
    await openPage({ world: gated(5), search: '?ward=maternity', servedAfterGen: null });
    expect(danglingDashViolations(Array.from(document.querySelectorAll('#app li')))).toEqual([]);
  });

  test('plant — a row whose dash follows a plain space is rejected, and so is a row with the dash missing', async () => {
    await openPage({ world: gated(5), search: '?ward=maternity' });
    const li = document.querySelector('#app li') as HTMLElement;
    const real = li.innerHTML;
    // The LAST dash is the one before the stamp (a gated row has an earlier one before "not accepting").
    const cut = real.lastIndexOf('&nbsp;— ');
    li.innerHTML = `${real.slice(0, cut)} — ${real.slice(cut + '&nbsp;— '.length)}`;
    expect(li.innerHTML, 'the plant did not land').not.toBe(real);
    expect(danglingDashViolations([li]).join('\n')).toContain('not a non-breaking space');
    li.innerHTML = `${real.slice(0, cut)}${real.slice(cut + '&nbsp;— '.length)}`;
    expect(danglingDashViolations([li]).join('\n')).toContain('not a non-breaking space');
  });

  test('anti-vacuity — a page with no stamped row is rejected, not passed', () => {
    expect(danglingDashViolations([])).toEqual(['no ward row with a stamp was checked']);
    const li = document.createElement('li');
    li.textContent = 'Maternity: Status unknown — call to confirm';
    expect(danglingDashViolations([li])).toEqual(['no ward row with a stamp was checked']);
  });
});
