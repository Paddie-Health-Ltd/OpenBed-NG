// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { facilityColumns, wardColumns } from '../../packages/snapshot/src/codec.js';
import { REPO_ROOT } from './_scratch.js';

/**
 * A COUNT RENDERS ONLY BESIDE A FACILITY SOMEONE CAN CALL (R-2026-09-23-66 B, C).
 *
 * WHAT THIS CLOSES. apps/public-dashboard rendered "(unknown facility) — ICU_ADULT:
 * 6 beds" for a ward whose facility was missing from the payload, and " —
 * ICU_ADULT: 6 beds" for a blank name: a count with no callable identity, as if a
 * crew could act on it. The founder ruled the ward DROPPED -- no sentence, no count
 * -- with one condition that is the safety half: dropping must never produce a page
 * that reads as "no beds". And every facility shown gets ONE tap-to-call link.
 *
 * EVERY ASSERTION READS THE RENDERED PAGE (-29 E2), in the harness
 * tests/compliance/dashboard_empty_state.test.ts uses: the real module, a stubbed
 * fetch, textContent and the DOM.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - that the tap target MEASURES 44px. jsdom lays nothing out. The rule that
 *     sizes it is asserted from src/style.css's own text (index.html's inline <style>
 *     until PR 3.4b-app B moved it for the CSP); how a real browser renders
 *     it is a deploy-time read-back, not something this suite can see.
 *   - that the number is ANSWERED. E.164 proves the format only. Onboarding
 *     confirms the line is staffed 24/7 by someone who can confirm bed status, with
 *     a test call (R-2026-09-23-66 C4, a founder-side item).
 */

function encode(columns: readonly string[], values: Record<string, unknown>): unknown[] {
  const unknownKeys = Object.keys(values).filter((k) => !columns.includes(k));
  if (unknownKeys.length > 0) throw new Error(`fixture names columns the codec does not have: ${unknownKeys.join(', ')}`);
  return columns.map((c) => values[c] ?? null);
}

function facility(id: string, name: unknown, phone: unknown = '+2348000000001'): unknown[] {
  return encode(facilityColumns(), {
    facility_id: id, name, lga: 'Ikeja', state: 'Lagos', lat: 6.6, lng: 3.35,
    public_phone_e164: phone, updated_at: '2026-09-23T08:00:00+00:00',
  });
}

function ward(facilityId: string, category: string, beds: number): unknown[] {
  return encode(wardColumns(), {
    facility_id: facilityId, category, offering: 'OFFERED', bed_count: beds, accepting_effective: true,
    gated_by: null, state: 'OK', source: 'WARD', monitoring_state: 'ACTIVE', updated_at: '2026-09-23T08:00:00+00:00',
  });
}

function payload(facilities: unknown[][], wards: unknown[][]) {
  return { v: 1, generated_at: '2026-09-23T08:00:00+00:00', server_now: '2026-09-23T08:00:00+00:00', facilities, wards };
}

async function renderWith(p: unknown): Promise<string> {
  document.body.innerHTML = '<main id="app"></main>';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json' } })));
  const { render } = await import('../../apps/public-dashboard/src/main.js');
  await render();
  return document.body.textContent ?? '';
}

/** Every way the rendered call links disagree with the payload. Empty means they agree. */
export function callLinkViolations(doc: Document, shown: { name: string; phone: string }[]): string[] {
  const out: string[] = [];
  const links = Array.from(doc.querySelectorAll('#app a.call')) as HTMLAnchorElement[];
  if (links.length !== shown.length) out.push(`${links.length} call links for ${shown.length} facilities shown`);
  const sections = Array.from(doc.querySelectorAll('#app section.facility'));
  for (const f of shown) {
    const section = sections.find((s) => s.querySelector('h2')?.textContent === f.name);
    if (!section) {
      out.push(`${f.name} is not shown under its own name`);
      continue;
    }
    const own = Array.from(section.querySelectorAll('a.call')) as HTMLAnchorElement[];
    if (own.length !== 1) out.push(`${f.name} carries ${own.length} call links, not one`);
    for (const a of own) {
      if (a.getAttribute('href') !== `tel:${f.phone}`) out.push(`${f.name}'s link dials ${a.getAttribute('href')}, not tel:${f.phone}`);
      if (!(a.textContent ?? '').includes(f.phone)) out.push(`${f.name}'s link does not show the number ${f.phone}`);
      if (!(a.textContent ?? '').includes('Call to confirm beds')) out.push(`${f.name}'s link is not labelled "Call to confirm beds"`);
    }
  }
  return out;
}

/** The smallest tap dimension an a.call rule in `css` declares, or null if it declares none. */
export function callTapTargetPx(css: string): { minHeight: number | null; minWidth: number | null } {
  const rule = /a\.call\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  const px = (prop: string) => {
    const m = new RegExp(`${prop}\\s*:\\s*(\\d+)px`).exec(rule);
    return m === null ? null : Number(m[1]);
  };
  return { minHeight: px('min-height'), minWidth: px('min-width') };
}

/**
 * THE COUNT IS SUBORDINATE TO THE PHONE NUMBER (v1:243; R-2026-09-26-126 DB-3, with the
 * founder's size order): the facility name, then the number to call, then the count --
 * 24 > 20 > 18 px. Read as the LITERAL font-size of three rules in style.css, the same
 * reason callTapTargetPx reads literal px: a var() cannot be compared here. A rule that
 * declares no literal font-size reads null, and null fails.
 */
export function sizeOrder(css: string): { name: number | null; phone: number | null; badge: number | null } {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const size = (selector: string): number | null => {
    const rule = new RegExp(`(?:^|\\})\\s*${selector}\\s*\\{([^}]*)\\}`).exec(bare)?.[1] ?? '';
    const m = /font-size\s*:\s*(\d+)px/.exec(rule);
    return m === null ? null : Number(m[1]);
  };
  return { name: size('section\\.facility h2'), phone: size('a\\.call \\.phone'), badge: size('\\.badge') };
}

export function sizeOrderViolations(css: string): string[] {
  const { name, phone, badge } = sizeOrder(css);
  const out: string[] = [];
  if (name === null || phone === null || badge === null) return [`a rule declares no literal font-size in px: name ${String(name)}, phone ${String(phone)}, badge ${String(badge)}`];
  if (!(name > phone)) out.push(`the facility name (${name}px) is not larger than the phone number (${phone}px)`);
  if (!(phone > badge)) out.push(`the phone number (${phone}px) is not larger than the count (${badge}px): the count must be subordinate to the number to call`);
  return out;
}

const GOOD = facility('f1', 'Synthetic General Hospital');
const GOOD_WARD = ward('f1', 'A_AND_E', 3);
const SECRET_COUNT = 47;

describe('a count renders only beside a callable facility', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test.each([
    ['missing from the payload', null],
    ['named with an empty string', facility('f2', '')],
    ['named with spaces only', facility('f2', '   ')],
    ['named with a tab only', facility('f2', '\t')],
    ['carrying no number to call', facility('f2', 'Synthetic Annex', null)],
  ])('plant — a ward whose facility is %s is not rendered, and its count is not logged', async (_label, second) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const text = await renderWith(payload(second === null ? [GOOD] : [GOOD, second], [GOOD_WARD, ward('f2', 'ICU_ADULT', SECRET_COUNT)]));

    expect(text, 'the identified facility vanished too').toContain('Synthetic General Hospital');
    expect(text).toMatch(/Emergency \(A&E\): 3 beds/);
    expect(text, 'the dropped ward rendered').not.toContain('Adult ICU');
    expect(text, 'the dropped ward rendered, as a code').not.toContain('ICU_ADULT');
    expect(text, "the dropped ward's count rendered").not.toMatch(new RegExp(`\\b${SECRET_COUNT}\\b`));
    expect(document.querySelectorAll('#app li').length, 'the dropped ward still has a list item').toBe(1);

    // At least once, not exactly once: the module also renders on its FIRST import,
    // so the first test in this file sees two renders of the same payload.
    expect(error.mock.calls.length, 'the drop was not logged').toBeGreaterThanOrEqual(1);
    for (const call of error.mock.calls) {
      const logged = JSON.stringify(call);
      expect(logged, 'something other than the dropped ward was logged').toContain('ICU_ADULT');
      expect(logged, 'the log carries the count the page refused to show').not.toContain(String(SECRET_COUNT));
    }
  });

  test('SAFETY — when EVERY ward is dropped the page reads as an outage, never as "no beds"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const text = await renderWith(payload([facility('f2', '  ')], [ward('f2', 'ICU_ADULT', SECRET_COUNT), ward('ghost', 'A_AND_E', 2)]));
    expect(text).toMatch(/can.t be loaded right now/i);
    expect(text).toMatch(/not a report that beds are unavailable/i);
    expect(text).toMatch(/112 \/ 767/);
    expect(text, 'an all-dropped page reads as an empty city').not.toMatch(/no facility has joined|none has reported a ward/i);
    expect(text).not.toMatch(/\d+\s*beds/i);
    expect(document.querySelectorAll('#app li').length).toBe(0);
    expect(document.querySelectorAll('#app a.call').length, 'a call link rendered for a dropped ward').toBe(0);
  });

  test('positive control — an ordinary identified ward renders under its facility with its count', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const text = await renderWith(payload([GOOD], [GOOD_WARD]));
    expect(text).toContain('Synthetic General Hospital');
    expect(text).toMatch(/Emergency \(A&E\): 3 beds/);
    expect(error, 'an ordinary ward was reported as dropped').not.toHaveBeenCalled();
  });
});

describe('one tap-to-call link per facility', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  const TWO = payload(
    [facility('f1', 'Synthetic General Hospital', '+2348000000001'), facility('f2', 'Synthetic Annex', '+2348000000002')],
    [ward('f1', 'A_AND_E', 3), ward('f1', 'ICU_ADULT', 1), ward('f2', 'MATERNITY', 2)],
  );
  const SHOWN = [
    { name: 'Synthetic General Hospital', phone: '+2348000000001' },
    { name: 'Synthetic Annex', phone: '+2348000000002' },
  ];

  test('real render is accepted — each facility dials its own number, shows it, once, however many wards it has', async () => {
    await renderWith(TWO);
    expect(callLinkViolations(document, SHOWN)).toEqual([]);
    expect(document.querySelectorAll('#app a.call').length, 'two wards produced two links').toBe(2);
    expect(document.querySelectorAll('#app li').length).toBe(3);
  });

  test('plant — a link that dials the wrong number is rejected', async () => {
    await renderWith(TWO);
    const link = document.querySelector<HTMLAnchorElement>('#app a.call');
    link?.setAttribute('href', 'tel:+2348000000009');
    expect(link?.getAttribute('href'), 'the plant did not change the link').toBe('tel:+2348000000009');
    expect(callLinkViolations(document, SHOWN).join('\n')).toContain("Synthetic General Hospital's link dials tel:+2348000000009");
  });

  test('plant — a link per WARD rather than per facility is rejected', async () => {
    await renderWith(TWO);
    const section = document.querySelector('#app section.facility');
    const extra = section?.querySelector('a.call')?.cloneNode(true);
    if (extra) section?.appendChild(extra);
    expect(callLinkViolations(document, SHOWN).join('\n')).toContain('carries 2 call links, not one');
  });

  test('anti-vacuity — a page with no links fails the checker', () => {
    document.body.innerHTML = '<main id="app"></main>';
    expect(callLinkViolations(document, SHOWN).join('\n')).toContain('0 call links for 2 facilities shown');
  });

  test("the link's tap target is declared at least 44 x 44 CSS px, and a smaller rule is refused", () => {
    const css = readFileSync(join(REPO_ROOT, 'apps', 'public-dashboard', 'src', 'style.css'), 'utf8');
    const real = callTapTargetPx(css);
    expect(real.minHeight ?? 0, 'style.css declares no min-height of 44px or more on a.call').toBeGreaterThanOrEqual(44);
    expect(real.minWidth ?? 0, 'style.css declares no min-width of 44px or more on a.call').toBeGreaterThanOrEqual(44);
    const planted = callTapTargetPx(css.replace(/min-height:\s*52px/, 'min-height: 40px'));
    expect(planted.minHeight, 'the plant did not reach the rule').toBe(40);
    expect(callTapTargetPx('<style>a.other { min-height: 44px }</style>'), 'a rule for another selector was read').toEqual({ minHeight: null, minWidth: null });
  });

  test('real style.css holds the size order name > phone > count, as literal px (DB-3)', () => {
    const css = readFileSync(join(REPO_ROOT, 'apps', 'public-dashboard', 'src', 'style.css'), 'utf8');
    const out = sizeOrderViolations(css);
    expect(out, `${out.join('\n')} -- read ${JSON.stringify(sizeOrder(css))}`).toEqual([]);
  });

  test.each([
    ['the count raised above the phone', '.badge { font-size: 28px; }', 'is not larger than the count'],
    ['the phone lowered below the count', 'a.call .phone { font-size: 16px; }', 'is not larger than the count'],
    ['the name lowered below the phone', 'section.facility h2 { font-size: 18px; }', 'is not larger than the phone number'],
  ])('plant — %s is rejected', (_name, override, message) => {
    const base = 'section.facility h2 { font-size: 24px; }\na.call .phone { font-size: 20px; }\n.badge { font-size: 18px; }\n';
    expect(sizeOrderViolations(base), 'the ordinary valid order must be accepted').toEqual([]);
    const sel = override.slice(0, override.indexOf('{')).trim();
    const planted = base.split('\n').map((l) => (l.startsWith(sel + ' ') ? override : l)).join('\n');
    expect(planted, 'the plant did not change the rules').not.toBe(base);
    expect(sizeOrderViolations(planted).join('\n')).toContain(message);
  });

  test('anti-vacuity — a size declared through var() reads as null and fails', () => {
    expect(sizeOrderViolations('section.facility h2 { font: var(--text-title); }\na.call .phone { font-size: 20px; }\n.badge { font-size: 18px; }').join('\n')).toContain('declares no literal font-size');
  });

  test('index.html carries NO inline <style>, which the CSP would block silently, and main.ts imports the stylesheet', () => {
    // Comments stripped first: the page's own comment explains the move, and prose is
    // not evidence either way (test-conventions section 2(a)).
    const html = readFileSync(join(REPO_ROOT, 'apps', 'public-dashboard', 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    expect(html, 'an inline <style> is back in index.html; style-src is self only').not.toMatch(/<style[\s>]/i);
    expect('<head><style>a{}</style></head>', 'the check cannot see an inline block, so it proves nothing').toMatch(/<style[\s>]/i);
    expect(readFileSync(join(REPO_ROOT, 'apps', 'public-dashboard', 'src', 'main.ts'), 'utf8')).toContain("import './style.css';");
  });
});
