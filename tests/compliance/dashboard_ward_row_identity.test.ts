// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { decodeWard, facilityColumns, wardColumns } from '../../packages/snapshot/src/codec.js';
import { wardLine } from '../../apps/public-dashboard/src/age-view.js';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE DESIGN PASS CHANGED NO WORD ON A WARD ROW (the design-pass kickoff, D1).
 *
 * D1 wraps pieces of each ward row in spans so the count can sit in a badge and the age
 * in a mono stamp. The kickoff's rule: "The row's textContent must stay byte-identical
 * to today's wardLine(...).text. Wrap substrings in spans. Never re-derive, reorder or
 * reword." This file renders the REAL page (src/main.ts, in jsdom, the harness the other
 * dashboard tests use) over one synthetic fixture holding every tone and every band, and
 * asserts, row by row:
 *   - the li's textContent is EXACTLY wardLine(row, clock).text -- nothing added, not a
 *     space, not a separator;
 *   - the li's class is exactly `age-<tone>`, as before (dashboard_age.test.ts reads it);
 *   - THE COLOUR RULE (Cowork's call, logged in the kickoff): a badge takes a status fill
 *     only while the claim is fresh (band GREEN) -- Available when accepting with a count
 *     above 0, Full when not accepting or 0 -- and every other row takes the
 *     not-reporting fill. "Limited" is never used. The expectation for each row is a
 *     LITERAL below, not derived from the code under test, so a change to the rule reds;
 *   - DB-2 (R-2026-09-26-126): a QUALIFIED claim ("set by admin, not ward-confirmed",
 *     "under review") takes the not-reporting fill even when fresh: no ward confirmed it;
 *   - the stamp takes its band's colour, and an unknown age is grey, never green;
 *   - DB-4: a row that claims no count gets a neutral stamp and no dot, whatever its band;
 *   - DC-1 (R-2026-09-26-127, as corrected by the founder): "The status fill, the dot and a
 *     GREEN stamp appear only on a GREEN-band, unqualified row with a count, on a page
 *     with no stale banner. Amber marks the YELLOW band wherever the page is not stale.
 *     Everything else is neutral.";
 *   - DB-1: under the page's stale or "can't confirm" banner NOTHING reads as live -- no
 *     status fill, no dot, every stamp neutral -- and the words do not change;
 *   - the static dot exists only on a fresh stamp: style.css holds exactly one ::before,
 *     on .stamp-green (the dot is CSS, so it adds no text to the row).
 *
 * THE CLINICAL-SAFETY LEG (clinical-safety-reviewer, in the kickoff): a green badge on a
 * stale count reads as "go". So no YELLOW, GREY, SUPPRESSED or unknown-age row may carry
 * status-available or status-full, whatever its count -- planted below with a YELLOW row
 * coloured available.
 *
 * NOT ASSERTED HERE, deliberately: that the colours LOOK right. That is the screenshots,
 * read by Cowork and approved by the founder in the browser (box 14).
 */

const MIN = 60_000;
const GEN = Date.parse('2026-09-23T03:12:00.000Z');
const SERVED = GEN + MIN;
const iso = (ms: number): string => new Date(ms).toISOString();

function encode(columns: readonly string[], values: Record<string, unknown>): unknown[] {
  return columns.map((c) => values[c] ?? null);
}

const FACILITY = encode(facilityColumns(), {
  facility_id: 'f1', name: 'Synthetic General Hospital', lga: 'Ikeja', state: 'Lagos', lat: 6.6, lng: 3.35,
  public_phone_e164: '+2348000000001', updated_at: iso(GEN),
});

type Status = 'available' | 'full' | 'unknown';
type Stamp = 'green' | 'yellow' | 'grey' | null;
interface Case {
  readonly name: string;
  readonly row: Record<string, unknown>;
  readonly tone: string;
  readonly status: Status | null; // null: no badge on this row
  readonly stamp: Stamp;
}

// Thresholds from packages/fixtures/snapshot-shape.json: GREEN under 30 min, YELLOW under
// 120, then GREY, and SUPPRESSED past 12 h. Ages below sit well inside each band.
const ageMin = (minutes: number): string => iso(SERVED - minutes * MIN);
const base = {
  facility_id: 'f1', offering: 'OFFERED', bed_count: 3, accepting_effective: true, gated_by: null,
  state: 'OK', source: 'WARD', monitoring_state: 'ACTIVE', updated_at: ageMin(5),
};

const CASES: readonly Case[] = [
  { name: 'fresh, accepting, 3 beds', row: { category: 'A_AND_E' }, tone: 'fresh', status: 'available', stamp: 'green' },
  { name: 'fresh, not accepting, with a reason', row: { category: 'THEATRE', accepting_effective: false, gated_by: 'NO_ANAESTHETIST_ON_DUTY' }, tone: 'fresh', status: 'full', stamp: 'green' },
  { name: 'fresh, 0 beds', row: { category: 'ICU_ADULT', bed_count: 0 }, tone: 'fresh', status: 'full', stamp: 'green' },
  // DB-4 (R-2026-09-26-126): a row that claims no count gets no dot and a neutral stamp,
  // whatever its band. Until DB this row's stamp was green, with the dot.
  { name: 'fresh, never reported a count', row: { category: 'SURGICAL', bed_count: null }, tone: 'fresh', status: null, stamp: 'grey' },
  // DB-2: a qualified claim is not coloured -- one row per qualifier value, and both.
  // Until DB the both-qualifiers row read `available`. DC-1 (R-2026-09-26-127): nor is it
  // shown as live -- no dot, a grey stamp in place of green. Until DC these read `green`.
  { name: 'fresh, set by admin and under review', row: { category: 'MEDICAL_ADULT', source: 'ADMIN', state: 'UNDER_REVIEW' }, tone: 'fresh', status: 'unknown', stamp: 'grey' },
  { name: 'fresh, set by admin', row: { category: 'PAEDIATRIC', source: 'ADMIN' }, tone: 'fresh', status: 'unknown', stamp: 'grey' },
  { name: 'fresh, under review', row: { category: 'ICU_ADULT', state: 'UNDER_REVIEW', bed_count: 0 }, tone: 'fresh', status: 'unknown', stamp: 'grey' },
  { name: 'ageing (YELLOW), 3 beds', row: { category: 'PAEDIATRIC', updated_at: ageMin(45) }, tone: 'aged', status: 'unknown', stamp: 'yellow' },
  // DC-1 as corrected by the founder: amber warns and never signals "live", so a qualified
  // YELLOW row keeps its amber stamp, with no dot.
  { name: 'ageing (YELLOW), set by admin', row: { category: 'SURGICAL', source: 'ADMIN', updated_at: ageMin(45) }, tone: 'aged', status: 'unknown', stamp: 'yellow' },
  { name: 'stale (GREY), 3 beds', row: { category: 'ICU_PAEDIATRIC', updated_at: ageMin(180) }, tone: 'aged', status: 'unknown', stamp: 'grey' },
  { name: 'past the ceiling (SUPPRESSED)', row: { category: 'NICU', updated_at: ageMin(13 * 60) }, tone: 'none', status: null, stamp: null },
  { name: 'not reporting (PENDING)', row: { category: 'MATERNITY', monitoring_state: 'PENDING' }, tone: 'not-reporting', status: null, stamp: null },
  { name: 'not reporting (PAUSED)', row: { category: 'A_AND_E', monitoring_state: 'PAUSED' }, tone: 'not-reporting', status: null, stamp: null },
  { name: 'not offered', row: { category: 'SCBU', offering: 'NOT_OFFERED' }, tone: 'not-offered', status: null, stamp: null },
  { name: 'an unknown code', row: { category: 'THEATRE', monitoring_state: 'NOT_A_STATE' }, tone: 'unknown', status: null, stamp: null },
];

// With no serve-time clock every claim's age is unknown: grey, never green, never a fill.
const UNKNOWN_AGE_CASES: readonly Case[] = [
  { name: 'unknown age, fresh-looking count', row: { category: 'A_AND_E' }, tone: 'unknown', status: 'unknown', stamp: 'grey' },
  { name: 'unknown age, 0 beds', row: { category: 'ICU_ADULT', bed_count: 0 }, tone: 'unknown', status: 'unknown', stamp: 'grey' },
];

const rows = (cases: readonly Case[]): unknown[][] => cases.map((c) => encode(wardColumns(), { ...base, ...c.row }));

async function renderRows(encoded: unknown[][], withClock: boolean, generatedAt: number = GEN): Promise<HTMLLIElement[]> {
  document.body.innerHTML = '<main id="app"></main>';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withClock) headers['x-openbed-served-at'] = iso(SERVED);
  const payload = { v: 1, generated_at: iso(generatedAt), server_now: iso(generatedAt), facilities: [FACILITY], wards: encoded };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers })));
  const { render } = await import('../../apps/public-dashboard/src/main.js');
  await render();
  return Array.from(document.querySelectorAll<HTMLLIElement>('#app li'));
}

/**
 * Every way a rendered row can break the rule, as messages. Pure over the DOM, so the
 * plants below feed it constructed rows instead of editing the renderer.
 */
export function rowViolations(li: HTMLLIElement, expectedText: string, c: Case): string[] {
  const out: string[] = [];
  const at = `row "${c.name}"`;
  if (li.textContent !== expectedText) out.push(`${at}: textContent ${JSON.stringify(li.textContent)} is not wardLine's ${JSON.stringify(expectedText)}`);
  if (li.className !== `age-${c.tone}`) out.push(`${at}: li class "${li.className}" is not "age-${c.tone}"`);
  const badges = li.querySelectorAll('.badge');
  if (c.status === null) {
    if (badges.length !== 0) out.push(`${at}: carries a count badge, and it shows no count`);
  } else if (badges.length !== 1 || !badges[0]?.classList.contains(`status-${c.status}`)) {
    out.push(`${at}: expected one badge with status-${c.status}, found ${Array.from(badges).map((b) => b.className).join(', ') || 'none'}`);
  }
  if (c.stamp !== 'green' && li.querySelector('.status-available, .status-full') !== null) {
    out.push(`${at}: a status fill on a claim that is not fresh -- a green badge on a stale count reads as "go"`);
  }
  const stamps = li.querySelectorAll('.stamp');
  if (c.stamp === null) {
    if (stamps.length !== 0) out.push(`${at}: carries an age stamp, and it shows no age`);
  } else if (stamps.length !== 1 || !stamps[0]?.classList.contains(`stamp-${c.stamp}`)) {
    out.push(`${at}: expected one stamp-${c.stamp}, found ${Array.from(stamps).map((s) => s.className).join(', ') || 'none'}`);
  }
  if (/\d/.test(Array.from(li.querySelectorAll('*')).map((e) => e.className).join(' '))) out.push(`${at}: a class name carries a digit`);
  return out;
}

/**
 * DB-1 (R-2026-09-26-126): WHILE THE PAGE SAYS IT MAY BE OUT OF DATE, NOTHING ON IT READS
 * AS LIVE. Under the stale or "can't confirm" banner no badge takes a status fill, no
 * freshness dot renders, and every stamp is neutral, whatever each row's own band. The
 * design system: "The only living element is the freshness dot, and it only exists when"
 * a snapshot is genuinely current. The dot is CSS on .stamp-green, so no .stamp-green
 * means no dot.
 */
export function stalePageViolations(app: Element): string[] {
  const out: string[] = [];
  if (app.querySelector('.snapshot-banner') === null) out.push('the page shows no snapshot banner: this leg is not looking at a stale page');
  for (const el of Array.from(app.querySelectorAll('.status-available, .status-full'))) out.push(`a status fill under the stale banner: "${el.textContent ?? ''}"`);
  for (const el of Array.from(app.querySelectorAll('.stamp-green'))) out.push(`a fresh stamp (and its dot) under the stale banner: "${el.textContent ?? ''}"`);
  for (const el of Array.from(app.querySelectorAll('.stamp'))) if (!el.classList.contains('stamp-grey')) out.push(`a stamp that is not neutral under the stale banner: ${el.className}`);
  return out;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.spyOn(performance, 'now').mockImplementation(() => 1_000);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a ward row says exactly what wardLine says, and colours only a fresh claim', () => {
  test('real rows, every tone and band — textContent identical to wardLine, the colour rule held', async () => {
    const lis = await renderRows(rows(CASES), true);
    expect(lis.length, 'the page rendered a different number of rows than the fixture holds').toBe(CASES.length);
    const clock = { servedAt: iso(SERVED), elapsedMs: 0 };
    const out = CASES.flatMap((c, i) => rowViolations(lis[i] as HTMLLIElement, wardLine(decodeWard(rows([c])[0] as unknown[]), clock).text, c));
    expect(out, out.join('\n')).toEqual([]);
  });

  test('real rows with no serve-time clock — the age is unknown, the stamp grey, and no fill', async () => {
    const lis = await renderRows(rows(UNKNOWN_AGE_CASES), false);
    expect(lis.length).toBe(UNKNOWN_AGE_CASES.length);
    const clock = { servedAt: null, elapsedMs: 0 };
    const out = UNKNOWN_AGE_CASES.flatMap((c, i) => rowViolations(lis[i] as HTMLLIElement, wardLine(decodeWard(rows([c])[0] as unknown[]), clock).text, c));
    expect(out, out.join('\n')).toEqual([]);
  });

  test('the fixture covers every tone and every stamp colour — the coverage is asserted, not assumed', () => {
    const all = [...CASES, ...UNKNOWN_AGE_CASES];
    expect(new Set(all.map((c) => c.tone))).toEqual(new Set(['fresh', 'aged', 'none', 'not-reporting', 'not-offered', 'unknown']));
    expect(new Set(all.map((c) => c.stamp))).toEqual(new Set(['green', 'yellow', 'grey', null]));
    expect(new Set(all.map((c) => c.status))).toEqual(new Set(['available', 'full', 'unknown', null]));
  });

  test('DB-1 — a stale page asserts nothing as live: no status fill, no dot, every stamp neutral', async () => {
    // Generated ten minutes before it was served: past snapshotBannerAfterMinutes. Every
    // row is fresh by its OWN band, so before DB-1 they read green.
    const lis = await renderRows(rows(CASES), true, SERVED - 10 * MIN);
    expect(lis.length).toBe(CASES.length);
    const app = document.querySelector('#app') as Element;
    expect(app.querySelector('.stamp'), 'the stale page rendered no stamp at all: the leg would pass over nothing').not.toBeNull();
    const out = stalePageViolations(app);
    expect(out, out.join('\n')).toEqual([]);
    const clock = { servedAt: iso(SERVED), elapsedMs: 0 };
    const words = CASES.flatMap((c, i) => (lis[i]?.textContent === wardLine(decodeWard(rows([c])[0] as unknown[]), clock).text ? [] : [c.name]));
    expect(words, 'a stale page changed the words of a row').toEqual([]);
  });

  test("DB-1 — the \"can't confirm\" page asserts nothing as live either", async () => {
    await renderRows(rows(CASES), false);
    const out = stalePageViolations(document.querySelector('#app') as Element);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('plant — a stale page with one fresh stamp is rejected', () => {
    const app = document.createElement('main');
    app.innerHTML = '<p class="snapshot-banner" role="status">x</p><ul><li class="age-fresh"><span class="badge status-unknown">4 beds</span> — <span class="stamp stamp-green">updated 5 min ago</span></li></ul>';
    expect(stalePageViolations(app).join('\n')).toContain('a fresh stamp (and its dot) under the stale banner');
  });

  test('plant — a stale page with a status fill is rejected, and a page with no banner is not taken for a stale one', () => {
    const app = document.createElement('main');
    app.innerHTML = '<p class="snapshot-banner" role="status">x</p><ul><li class="age-fresh"><span class="badge status-available">4 beds</span> — <span class="stamp stamp-grey">updated 5 min ago</span></li></ul>';
    expect(stalePageViolations(app).join('\n')).toContain('a status fill under the stale banner');
    const fresh = document.createElement('main');
    fresh.innerHTML = '<ul><li class="age-fresh"><span class="stamp stamp-grey">x</span></li></ul>';
    expect(stalePageViolations(fresh).join('\n')).toContain('this leg is not looking at a stale page');
  });

  test('plant — a qualified fresh claim coloured available is rejected (DB-2)', () => {
    const c = CASES.find((x) => x.name === 'fresh, set by admin') as Case;
    const li = document.createElement('li');
    li.className = 'age-fresh';
    li.innerHTML = '<span class="ward-category">Paediatric</span>: <span class="badge status-available">3 beds</span> — set by admin, not ward-confirmed — <span class="stamp stamp-green">updated 5 min ago</span>';
    expect(rowViolations(li, li.textContent ?? '', c).join('\n')).toContain('expected one badge with status-unknown');
  });

  test('plant — a qualified fresh claim stamped green, with the dot, is rejected (DC-1)', () => {
    const c = CASES.find((x) => x.name === 'fresh, set by admin') as Case;
    const li = document.createElement('li');
    li.className = 'age-fresh';
    li.innerHTML = '<span class="ward-category">Paediatric</span>: <span class="badge status-unknown">3 beds</span> — set by admin, not ward-confirmed — <span class="stamp stamp-green">updated 5 min ago</span>';
    expect(rowViolations(li, li.textContent ?? '', c).join('\n')).toContain('expected one stamp-grey, found stamp stamp-green');
  });

  test('plant — a row with no count stamped green (with the dot) is rejected (DB-4)', () => {
    const c = CASES.find((x) => x.name === 'fresh, never reported a count') as Case;
    const li = document.createElement('li');
    li.className = 'age-fresh';
    li.innerHTML = '<span class="ward-category">Surgical ward</span>: <span class="ward-words">not yet reporting</span> — <span class="stamp stamp-green">updated 5 min ago</span>';
    expect(rowViolations(li, li.textContent ?? '', c).join('\n')).toContain('expected one stamp-grey');
  });

  test('plant — a renderer that adds one space between the spans is rejected', () => {
    const c = CASES[0] as Case;
    const li = document.createElement('li');
    li.className = 'age-fresh';
    li.innerHTML = '<span class="ward-category">A&amp;E</span>: <span class="badge status-available">3 beds</span> — <span class="stamp stamp-green">updated 6 min ago</span>';
    const expected = li.textContent ?? '';
    li.insertBefore(document.createTextNode(' '), li.lastChild);
    expect(li.textContent, 'the plant did not change the row').not.toBe(expected);
    expect(rowViolations(li, expected, c).join('\n')).toContain('is not wardLine');
  });

  test('plant — a YELLOW row coloured available is rejected: a green badge on a stale count', () => {
    const c = CASES.find((x) => x.stamp === 'yellow') as Case;
    const li = document.createElement('li');
    li.className = 'age-aged';
    li.innerHTML = '<span class="ward-category">Paediatric</span>: <span class="badge status-available">3 beds</span> — <span class="stamp stamp-yellow">last reported 45 min ago — call to confirm</span>';
    const out = rowViolations(li, li.textContent ?? '', c).join('\n');
    expect(out).toContain('a status fill on a claim that is not fresh');
    expect(out).toContain('expected one badge with status-unknown');
  });

  test('plant — an unknown age stamped green is rejected', () => {
    const c = UNKNOWN_AGE_CASES[0] as Case;
    const li = document.createElement('li');
    li.className = 'age-unknown';
    li.innerHTML = '<span class="ward-category">A&amp;E</span>: <span class="badge status-unknown">3 beds</span> — <span class="stamp stamp-green">age unknown — call to confirm</span>';
    expect(rowViolations(li, li.textContent ?? '', c).join('\n')).toContain('expected one stamp-grey');
  });

  test('plant — an extra class on the li is rejected (dashboard_age reads it exactly)', () => {
    const c = CASES[0] as Case;
    const li = document.createElement('li');
    li.className = 'age-fresh available';
    li.innerHTML = '<span class="badge status-available">3 beds</span><span class="stamp stamp-green">x</span>';
    expect(rowViolations(li, li.textContent ?? '', c).join('\n')).toContain('li class "age-fresh available" is not "age-fresh"');
  });

  test('the static dot is CSS on the fresh stamp only — style.css holds exactly one ::before, on .stamp-green', () => {
    const css = readFileSync(join(REPO_ROOT, 'apps', 'public-dashboard', 'src', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const befores = Array.from(css.matchAll(/([^{}]+)::before\s*\{/g)).map((m) => (m[1] ?? '').trim());
    expect(befores, 'a ::before other than the fresh stamp\'s dot').toEqual(['.stamp-green']);
    expect(/animation|@keyframes/.test(css), 'the dot is static: no animation in style.css').toBe(false);
  });
});
