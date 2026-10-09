// @vitest-environment jsdom
/// <reference lib="dom" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { releaseTimers } from './_dashboard_import.js';
import { REPO_ROOT } from './_scratch.js';
import { byId, choose, openPage, removeGeolocation, stubGeolocation, tap, type World } from './_search_harness.js';

/**
 * THE VISITOR'S POSITION GOES NOWHERE (R-2026-10-09 GO, section 4 and GO-4 H; T-LEAK-1, T-LEAK-2, T-STORE-1).
 *
 * "Near me" hands the page a position, and the page promises, in the privacy notice, that OpenBed never receives or stores it. A claim
 * of "never" needs a probe (Clause 5), so this drives a whole session with a SENTINEL position whose digits appear nowhere else in
 * the suite, and records every place a value could leave the page or be kept:
 *   network    fetch (URL and init), XMLHttpRequest, navigator.sendBeacon, WebSocket, window.open, postMessage;
 *   storage    localStorage and sessionStorage setItem, the document.cookie setter, indexedDB.open;
 *   address    history.replaceState and pushState (url AND state), location.href, location.hash, document.title, window.name;
 *   sharing    navigator.clipboard.writeText, navigator.share;
 *   console    log, info, warn, error, debug, trace and table;
 *   markup     every inserted element's src and href, new Image().src, every attribute value, the whole document's HTML;
 *   announcer  every text change inside an aria-live region, recorded by a MutationObserver.
 * It looks for the sentinel in FIVE FORMS: the full pair, the numbers to three, four and five decimals, encodeURIComponent of "lat,lng",
 * and longitude then latitude.
 *
 * THE THREE LEGS. ACCEPT: the clean session leaks nothing, AND the origin really was taken ("From your location" is shown and the
 * "Nearest first" order differs from the name order), so a session that never used the position cannot pass for one that kept it
 * quiet. PLANT: a leak into each sink, each of which must be caught by the same helper. ANTI-VACUITY, first: BEFORE any sink is stubbed
 * and before the position is given, every sentinel form is shown to occur ZERO times in the clean page, so a hit afterwards can only
 * have come from the position.
 *
 * NOT ASSERTED HERE, deliberately: what the browser or the operating system sends to its own location provider to find the device.
 * That is the browser's, no test in this repository can see it, and the notice says "may use its location service" for that reason.
 */

const LAT = 6.123457;
const LNG = 3.654322;
/** The five forms. Each is a string a leak would carry. */
const FORMS: Record<string, string> = {
  'the full pair': '6.123457',
  'the longitude in full': '3.654322',
  'latitude to 5 decimals': '6.12345',
  'longitude to 5 decimals': '3.65432',
  'latitude to 4 decimals': '6.1234',
  'longitude to 4 decimals': '3.6543',
  'latitude to 3 decimals': '6.123',
  'longitude to 3 decimals': '3.654',
  'encodeURIComponent of "lat,lng"': encodeURIComponent(`${LAT},${LNG}`),
  'lat,lng': `${LAT},${LNG}`,
  'longitude then latitude': `${LNG},${LAT}`,
  'encodeURIComponent of "lng,lat"': encodeURIComponent(`${LNG},${LAT}`),
};

const WORLD: World = {
  facilities: [
    // Named so that the name order (Alpha, Mid, Zulu) is NOT the distance order from the sentinel (Zulu, Mid, Alpha).
    { id: 'fa', name: 'Zulu General', lat: 6.45, lng: 3.37 },
    { id: 'fi', name: 'Alpha Medical', lat: 6.6, lng: 3.35 },
    { id: 'fe', name: 'Mid Clinic', lat: 6.5857, lng: 3.9757 },
  ],
  wards: [
    { facility: 'fa', category: 'MATERNITY', agoMin: 50 },
    { facility: 'fi', category: 'MATERNITY', agoMin: 5 },
    { facility: 'fe', category: 'MATERNITY', agoMin: 200 },
  ],
};

interface Recorder {
  readonly seen: string[];
  /** Text of every aria-live region at every change. */
  readonly announced: string[];
  /** Every fetch URL. */
  readonly fetched: string[];
  readonly stop: () => void;
}

/** Every sink, recorded. Installed before the page is opened, torn down with stop(). */
function installRecorder(): Recorder {
  const seen: string[] = [];
  const announced: string[] = [];
  const fetched: string[] = [];
  const note = (where: string, ...args: unknown[]): void => {
    seen.push(`${where} ${args.map((a) => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); } }).join(' ')}`);
  };
  const undo: (() => void)[] = [];
  const spy = <T extends object, K extends keyof T>(obj: T, key: K, label: string): void => {
    const original = obj[key] as unknown as (...a: unknown[]) => unknown;
    const wrapped = function (this: unknown, ...a: unknown[]): unknown {
      note(label, ...a);
      return typeof original === 'function' ? original.apply(this, a) : undefined;
    };
    (obj as Record<string, unknown>)[key as string] = wrapped;
    undo.push(() => { (obj as Record<string, unknown>)[key as string] = original; });
  };
  const define = (obj: object, key: string, value: unknown): void => {
    const prior = Object.getOwnPropertyDescriptor(obj, key);
    Object.defineProperty(obj, key, { value, configurable: true, writable: true });
    undo.push(() => { if (prior) Object.defineProperty(obj, key, prior); else delete (obj as Record<string, unknown>)[key]; });
  };

  for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table'] as const) spy(console, m, `console.${m}`);
  spy(history, 'replaceState', 'history.replaceState');
  spy(history, 'pushState', 'history.pushState');
  spy(Storage.prototype, 'setItem', 'Storage.setItem');
  spy(XMLHttpRequest.prototype, 'open', 'XMLHttpRequest.open');
  spy(XMLHttpRequest.prototype, 'send', 'XMLHttpRequest.send');
  spy(window, 'open', 'window.open');
  spy(window, 'postMessage', 'window.postMessage');
  define(navigator, 'sendBeacon', (...a: unknown[]) => { note('navigator.sendBeacon', ...a); return true; });
  define(navigator, 'share', async (...a: unknown[]) => { note('navigator.share', ...a); });
  define(navigator, 'clipboard', { writeText: async (...a: unknown[]) => { note('navigator.clipboard.writeText', ...a); } });
  define(window, 'indexedDB', { open: (...a: unknown[]) => { note('indexedDB.open', ...a); return {}; } });
  define(window, 'WebSocket', class { constructor(...a: unknown[]) { note('WebSocket', ...a); } });
  Object.defineProperty(document, 'cookie', { set: (v: string) => { note('document.cookie', v); }, get: () => '', configurable: true });
  undo.push(() => { delete (document as unknown as Record<string, unknown>)['cookie']; });
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable: true, set(v: string) { note('Image.src', v); }, get() { return ''; } });
  undo.push(() => { if (srcDesc) Object.defineProperty(HTMLImageElement.prototype, 'src', srcDesc); });

  // aria-live text, and every inserted element's src and href, from a MutationObserver over the whole document.
  const readLive = (): void => {
    for (const el of Array.from(document.querySelectorAll('[aria-live], [role="status"], [role="alert"]'))) announced.push(el.textContent ?? '');
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of Array.from(r.addedNodes)) {
        if (n instanceof Element) {
          for (const e of [n, ...Array.from(n.querySelectorAll('*'))]) {
            for (const attr of ['src', 'href', 'action', 'data']) if (e.hasAttribute(attr)) note(`inserted ${e.tagName.toLowerCase()}[${attr}]`, e.getAttribute(attr));
          }
        }
      }
      if (r.type === 'attributes' && (r.attributeName === 'src' || r.attributeName === 'href')) note(`attribute ${r.attributeName}`, (r.target as Element).getAttribute(r.attributeName));
    }
    readLive();
  });
  observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  undo.push(() => observer.disconnect());

  return {
    seen,
    announced,
    fetched,
    stop: () => { for (const u of undo.reverse()) u(); },
  };
}

/** Everything the page holds that a leak could ride in, as one string per place. */
function placesOf(rec: Recorder): Record<string, string> {
  const attrs: string[] = [];
  for (const el of Array.from(document.querySelectorAll('*'))) for (const a of Array.from(el.attributes)) attrs.push(`${a.name}=${a.value}`);
  return {
    'recorded calls': rec.seen.join('\n'),
    'aria-live text': rec.announced.join('\n'),
    'fetch urls': rec.fetched.join('\n'),
    'location.href': location.href,
    'location.hash': location.hash,
    'document.title': document.title,
    'window.name': window.name,
    'every attribute value': attrs.join('\n'),
    'the document HTML': document.documentElement.outerHTML,
  };
}

/** Where, and in which form, the sentinel occurs. Empty means a clean session. */
export function leakViolations(rec: Recorder): string[] {
  const out: string[] = [];
  for (const [place, text] of Object.entries(placesOf(rec))) {
    for (const [form, needle] of Object.entries(FORMS)) {
      if (text.includes(needle)) out.push(`${form} (${needle}) reached ${place}`);
    }
  }
  // Every fetch URL must be exactly /beds.json: no query string, no second endpoint.
  for (const u of rec.fetched) if (u !== '/beds.json') out.push(`a fetch went to ${u}, not exactly /beds.json`);
  return out;
}

let rec: Recorder;

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  removeGeolocation();
  // The plants write into the address, the title and the window's name; a plant must not outlive its test.
  document.title = '';
  window.name = '';
  history.replaceState(null, '', '/');
});
afterEach(() => {
  rec?.stop();
  releaseTimers();
});

/** Open the page with the recorder on, then record the page's own fetches too. */
async function openRecorded(search = '?ward=maternity') {
  rec = installRecorder();
  const page = await openPage({ world: WORLD, search });
  // The harness stubs fetch itself; read its log of URLs into the recorder.
  rec.fetched.push(...page.fetched);
  return page;
}

describe('T-LEAK-1 — a whole session with a sentinel position leaks it nowhere, in any of five forms', () => {
  test('ANTI-VACUITY: before any sink is stubbed and before the position is given, every form occurs zero times in the clean page', async () => {
    const page = await openPage({ world: WORLD, search: '?ward=maternity' });
    const html = document.documentElement.outerHTML;
    for (const [form, needle] of Object.entries(FORMS)) expect(html.split(needle).length - 1, `${form} (${needle}) is already on the clean page`).toBe(0);
    for (const u of page.fetched) for (const needle of Object.values(FORMS)) expect(u).not.toContain(needle);
  });

  test('ACCEPT: tap, success, change the order, choose an area, tap again, poll, fail, copy the link — nothing leaks, and the origin was taken', async () => {
    const geo = stubGeolocation();
    const page = await openRecorded();
    expect(leakViolations(rec), 'the page leaked before the position existed').toEqual([]);

    tap('near-me');
    geo.resolve(LAT, LNG);
    // The origin was TAKEN: the words say so, and the order differs from the name order, so a session that ignored the position cannot pass.
    expect(byId('origin-text').textContent).toBe('From your location');
    const names = (): string[] => Array.from(document.querySelectorAll('#app section.facility h2')).map((h) => h.textContent ?? '');
    byId<HTMLSelectElement>('order-select').value = 'nearest';
    byId('order-select').dispatchEvent(new Event('change', { bubbles: true }));
    const nearest = names();
    expect(nearest).toEqual(['Zulu General', 'Mid Clinic', 'Alpha Medical']);
    expect(nearest, 'the nearest order is the name order, so the origin was not used').not.toEqual([...nearest].sort());
    expect(document.querySelector('.facility-distance')?.textContent).toMatch(/^About \d+\.\d km away · straight line$/);

    choose('area', 'Epe');
    tap('near-me');
    geo.resolve(LAT, LNG);
    await page.poll();
    tap('near-me');
    geo.reject(1);
    page.setOutage(true);
    await page.advance(2);
    page.setOutage(false);
    await page.advance(1);
    tap('copy-link');
    await Promise.resolve();
    await Promise.resolve();
    tap('origin-clear');
    rec.fetched.splice(0, rec.fetched.length, ...page.fetched);

    expect(page.fetched.length, 'the page made no fetch, so the fetch check proved nothing').toBeGreaterThan(2);
    expect(rec.seen.filter((s) => s.startsWith('navigator.clipboard.writeText')).length, 'the link was never written, so the clipboard check proved nothing').toBe(1);
    expect(rec.seen.some((s) => s.startsWith('history.replaceState')), 'the address was never written').toBe(true);
    expect(rec.announced.some((t) => t.includes('Location permission was declined')), 'the live region never announced a failure').toBe(true);
    expect(leakViolations(rec), leakViolations(rec).join('\n')).toEqual([]);
    expect(page.fetched.every((u) => u === '/beds.json')).toBe(true);
  });

  // PLANTS: a leak into each sink, each of which the same helper must catch.
  const plants: [string, () => void, string][] = [
    ['a fetch URL carrying the position', () => { rec.fetched.push(`/beds.json?ll=${encodeURIComponent(`${LAT},${LNG}`)}`); }, 'not exactly /beds.json'],
    ['history.replaceState with the position in its URL', () => { history.replaceState(null, '', `/?near=${LAT},${LNG}`); }, 'reached recorded calls'],
    ['history.replaceState with the position in its state', () => { history.replaceState({ lat: LAT, lng: LNG }, ''); }, 'reached recorded calls'],
    ['localStorage', () => { localStorage.setItem('last', String(LAT)); }, 'reached recorded calls'],
    ['a cookie', () => { document.cookie = `at=${LNG}`; }, 'reached recorded calls'],
    ['indexedDB', () => { (window.indexedDB as unknown as { open: (n: string) => void }).open(`pos-${LAT}`); }, 'reached recorded calls'],
    ['sendBeacon', () => { navigator.sendBeacon('/x', `${LAT},${LNG}`); }, 'reached recorded calls'],
    ['XMLHttpRequest', () => { const x = new XMLHttpRequest(); x.open('GET', `/x?${LAT}`); }, 'reached recorded calls'],
    ['WebSocket', () => { new WebSocket(`wss://x/${LNG}`); }, 'reached recorded calls'],
    ['window.open', () => { window.open(`https://x/?q=${LAT}`); }, 'reached recorded calls'],
    ['postMessage', () => { window.postMessage({ lat: LAT }, '*'); }, 'reached recorded calls'],
    ['the clipboard', () => { void navigator.clipboard.writeText(`https://openbed.ng/?near=${LAT},${LNG}`); }, 'reached recorded calls'],
    ['navigator.share', () => { void navigator.share({ url: `https://openbed.ng/?at=${LNG}` }); }, 'reached recorded calls'],
    ['console.log', () => { console.log(LAT); }, 'reached recorded calls'],
    ['console.trace', () => { console.trace(String(LNG)); }, 'reached recorded calls'],
    ['console.table', () => { console.table({ lat: LAT, lng: LNG }); }, 'reached recorded calls'],
    ['a data- attribute', () => { byId('coverage').setAttribute('data-here', `${LAT}`); }, 'reached every attribute value'],
    ['document.title', () => { document.title = `Near ${LAT}`; }, 'reached document.title'],
    ['window.name', () => { window.name = String(LNG); }, 'reached window.name'],
    ['an inserted element\'s src', () => { const i = document.createElement('iframe'); i.setAttribute('src', `https://x/${LAT}`); document.body.append(i); }, 'reached recorded calls'],
    ['new Image().src', () => { const i = new Image(); i.src = `https://x/p.gif?lat=${LAT}`; }, 'reached recorded calls'],
    ['an aria-live announcement', () => { byId('location-status').textContent = `You are at ${LAT}, ${LNG}`; }, 'reached aria-live text'],
    ['the longitude then the latitude, in the address hash', () => { location.hash = `${LNG},${LAT}`; }, 'reached location.hash'],
  ];
  test.each(plants)('plant — a leak into %s is rejected', async (_name, plant, where) => {
    await openRecorded();
    expect(leakViolations(rec), 'the page was already leaking before the plant').toEqual([]);
    plant();
    await Promise.resolve();
    const out = leakViolations(rec).join('\n');
    expect(out, 'the plant was not caught').toContain(where);
  });

  test('plant — the plants reach the sinks the recorder watches: a recorder that records nothing would reject none of them', async () => {
    await openRecorded();
    const before = rec.seen.length;
    console.log('x');
    localStorage.setItem('k', 'v');
    expect(rec.seen.length - before).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Static: geolocation lives in one file; nothing is stored.
// ---------------------------------------------------------------------------

const SRC = join(REPO_ROOT, 'apps', 'public-dashboard', 'src');
const tsFiles = (dir: string): string[] => readdirSync(dir).filter((n) => n.endsWith('.ts')).sort();
/** Source lines that are code: comments are not read, because comments quote the banned names to explain them. */
const codeOf = (text: string): string =>
  text.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

/** Files whose code names `needle`, from a map of file name to text. Pure, so the plants feed it constructed trees. */
export function filesNaming(files: Record<string, string>, needle: RegExp): string[] {
  return Object.entries(files).filter(([, text]) => needle.test(codeOf(text))).map(([name]) => name).sort();
}

const real = (): Record<string, string> => Object.fromEntries(tsFiles(SRC).map((n) => [n, readFileSync(join(SRC, n), 'utf8')]));

describe('T-LEAK-2 — `geolocation` is named in one file, and that file holds none of the banned identifiers', () => {
  test('real — only locate.ts names geolocation', () => {
    expect(filesNaming(real(), /geolocation/)).toEqual(['locate.ts']);
  });

  test('real — locate.ts names none of the identifiers a position could leave by', () => {
    const banned = /sendBeacon|XMLHttpRequest|WebSocket|EventSource|localStorage|sessionStorage|indexedDB|document\.cookie|history\.|location\.|fetch\(|console\.|clipboard|navigator\.share|postMessage|new Image|watchPosition|permissions\.query/;
    expect(filesNaming({ 'locate.ts': real()['locate.ts'] as string }, banned)).toEqual([]);
  });

  test('real — nothing in the page ever calls watchPosition or permissions.query', () => {
    expect(filesNaming(real(), /watchPosition|permissions\.query/)).toEqual([]);
  });

  test('plant — a second file naming geolocation, and a banned identifier in locate.ts, are each rejected', () => {
    const planted = { ...real(), 'card.ts': `${real()['card.ts']}\nnavigator.geolocation.getCurrentPosition(() => {});\n` };
    expect(filesNaming(planted, /geolocation/)).toEqual(['card.ts', 'locate.ts']);
    const leaky = (real()['locate.ts'] as string).replace('let token = 0;', 'let token = 0;\nconsole.log(device);');
    expect(leaky, 'the plant did not land').not.toBe(real()['locate.ts']);
    expect(filesNaming({ 'locate.ts': leaky }, /console\./)).toEqual(['locate.ts']);
  });

  test('a comment that quotes the banned name is not code, and a known-present control: the control finds geolocation in locate.ts at all', () => {
    expect(filesNaming({ 'a.ts': '// navigator.geolocation is only in locate.ts\n' }, /geolocation/)).toEqual([]);
    expect(filesNaming(real(), /getCurrentPosition/)).toEqual(['locate.ts']);
  });

  test('anti-vacuity — the corpus is every module of the page, and names the six it must', () => {
    expect(Object.keys(real())).toEqual(expect.arrayContaining(['main.ts', 'locate.ts', 'search.ts', 'controls.ts', 'lga-points.ts', 'age-view.ts']));
    expect(filesNaming({}, /geolocation/)).toEqual([]);
  });
});

describe('T-STORE-1 — the page stores nothing in the browser, which the notice states', () => {
  const STORES = /localStorage|sessionStorage|document\.cookie|indexedDB|caches\.open|serviceWorker|navigator\.storage/;

  test('real — no module of the page names a browser store', () => {
    expect(filesNaming(real(), STORES)).toEqual([]);
  });

  test('plant — each store is caught in a constructed module', () => {
    for (const name of ['localStorage', 'sessionStorage', 'document.cookie', 'indexedDB', 'caches.open', 'navigator.serviceWorker', 'navigator.storage']) {
      expect(filesNaming({ 'x.ts': `const a = ${name};` }, STORES), name).toEqual(['x.ts']);
    }
  });

  test('known-present control — the same scan finds `history.replaceState`, which the page does use, so the scan can find a name at all', () => {
    expect(filesNaming(real(), /history\.replaceState/)).toEqual(['main.ts']);
  });

  test('the notice still says it, and it is the sentence the scan holds true', () => {
    const notice = readFileSync(join(REPO_ROOT, 'docs', 'legal', 'privacy-notice-v1.2.md'), 'utf8');
    expect(notice).toContain('stores nothing in your browser');
  });

  test('anti-vacuity — a scan over no files finds nothing, and the corpus is not empty', () => {
    expect(filesNaming({}, STORES)).toEqual([]);
    expect(tsFiles(SRC).length).toBeGreaterThan(5);
  });
});
