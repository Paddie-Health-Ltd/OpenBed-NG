// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { REPO_ROOT } from './_scratch.js';
import ZERO_WARD from '../../packages/fixtures/platform-admin-my-reporting-wards.json';

/**
 * THE WARD CONSOLE, RENDERED (R-2026-09-23-66; the kickoff's B2 and D1).
 *
 * The first test that renders this console. Every assertion reads the page a ward
 * would see, under jsdom, with fetch stubbed per path so each server answer can be
 * planted exactly.
 *
 *   B2 -- A MALFORMED ROW IS REFUSED, NEVER DEFAULTED. One plant per shape. A
 *         refused row shows a fixed sentence and carries NO publish form: a row
 *         that cannot be read must not look like one that can be published for.
 *   D1 -- NO RAW SERVER TEXT REACHES THE SCREEN, at all three sites that used to
 *         print it: the publish status, the handover load, and the bad-link screen
 *         (the third, which the kickoff did not name). Each plant carries a
 *         SENTINEL string in the server's answer and asserts it is absent from the
 *         DOM. The message table is asserted to cover EXACTLY the codes the three
 *         functions this console calls can raise, parsed from the migrations.
 *   THE TWO FORM DEFECTS -- a NOT_OFFERED publish sends no count (004's CHECK
 *         refused every one before), and the zero-beds reason is a choice of the
 *         eight app.zero_reason values (the server refused free text).
 *   THE SIGN-IN REQUEST (AJ F2) -- the request carries create_user:false, and the
 *         page says the SAME words for 200, 422, 429 and 500, because GoTrue's own
 *         statuses tell a known address from an unknown one (observed 2026-09-23).
 *         The end-to-end route, mail included, is
 *         tests/db/ward_signin_request_live.test.ts.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - the live round trip against PostgREST. The request bodies are asserted here;
 *     that the server accepts them is tests/db/publish_ward_status.test.ts's.
 *   - hidden inputs' LAYOUT. `hidden` is asserted as an attribute; what a real
 *     browser paints is a deploy-time read-back.
 */

const MIG = join(REPO_ROOT, 'database', 'migrations');
const SENTINEL = 'SENTINEL_7f3a_internal_detail';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sessionFragment(): string {
  const now = Math.floor(Date.now() / 1000);
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    sub: '11111111-1111-4111-8111-111111111111',
    session_id: '22222222-2222-4222-8222-222222222222',
    exp: now + 3600,
    iat: now,
    role: 'authenticated',
    email: 'ward@example.invalid',
  })}.sig`;
  return `#access_token=${token}&refresh_token=r1&expires_at=${now + 3600}&token_type=bearer`;
}

// monitoring_state, state and source are what my_facility_wards always returned
// (011:142-154) and my_reporting_wards returns (026); the console read none of them
// until -70 E.
const GOOD_ROW = { category: 'MATERNITY', offering: 'OFFERED', bed_count: 3, accepting: true, version: 4, gated_by: null, monitoring_state: 'ACTIVE', state: 'OK', source: 'WARD', can_publish: true };
// can_publish is 026's (R-2026-09-27-144 DT, Bundle 2): a row without it renders read-only,
// so every fixture row that exercises the publish form says the server lets this login publish it.

/** Every value of every app enum the console can receive, read from the migrations. */
function enumCodes(): string[] {
  const src = readFileSync(join(MIG, '002_enums.sql'), 'utf8');
  const out: string[] = [];
  for (const type of ['ward_category', 'ward_offering', 'monitoring_state', 'gate_reason', 'status_state', 'status_source']) {
    const m = new RegExp(`CREATE TYPE app\\.${type} AS ENUM \\(([\\s\\S]*?)\\);`).exec(src);
    if (m === null) throw new Error(`app.${type} was not found in 002_enums.sql`);
    out.push(...[...(m[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((x) => x[1] ?? ''));
  }
  return out;
}
const CATEGORY_CODES = ['A_AND_E', 'ICU_ADULT', 'ICU_PAEDIATRIC', 'MEDICAL_ADULT', 'PAEDIATRIC', 'THEATRE', 'SURGICAL', 'MATERNITY', 'NICU', 'SCBU'];

/** Codes appearing as whole words, except those a label itself keeps (NICU, SCBU). */
function rawCodes(text: string, codes: string[]): string[] {
  const keptByALabel = new Set(['NICU', 'SCBU', 'ICU', 'E']);
  return codes.filter((c) => !keptByALabel.has(c) && new RegExp(`(^|[^A-Za-z_])${c}([^A-Za-z_]|$)`).test(text));
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Renders the console at `fragment` with fetch answered by `route`. Returns the stub, to read request bodies. */
async function renderAt(fragment: string, route: Route) {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/${fragment}`);
  const stub = vi.fn(async (url: string | URL, init?: RequestInit) => route(String(url), init));
  vi.stubGlobal('fetch', stub);
  const { render } = await import('../../apps/ward-console/src/main.js');
  await render();
  return stub;
}

function text(): string {
  return document.body.textContent ?? '';
}

/**
 * Waits for the page to reach a state, up to a DEADLINE rather than a count of polls.
 *
 * FIVE SECONDS, AND WHY. This was 100 polls of 5ms -- about half a second -- and the
 * sign-in request retries once after a jittered 300-600ms sleep when no answer came
 * back (packages/auth/src/request.ts). So the wait was SHORTER than the code's own
 * documented backoff: green locally when the jitter happened to fit, red on CI when it
 * did not (run 35850012069, a4d28bc). Reproduced deterministically by pinning the
 * jitter to its maximum. The deadline now exceeds the worst case with room, and the
 * leg that depends on it pins the jitter so every run exercises that worst case.
 */
async function until(cond: () => boolean, deadlineMs = 5000): Promise<void> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('the page never reached the expected state');
}

function handover(rows: unknown[]): Route {
  return (url) => (url.endsWith('/rest/v1/rpc/my_reporting_wards') ? json(200, rows) : json(500, { message: 'unexpected call' }));
}

/** The codes a RAISE in `fn` can produce, parsed from the migration that defines it. */
function raisedCodes(file: string, fn: string): string[] {
  const src = readFileSync(join(MIG, file), 'utf8');
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`);
  if (start < 0) throw new Error(`${fn} is not defined in ${file}`);
  const end = src.indexOf('$$;', start);
  const body = src.slice(start, end < 0 ? undefined : end);
  return [...body.matchAll(/RAISE EXCEPTION '([A-Z_]+)'/g)].map((m) => m[1] as string);
}

/** Codes the server can raise at this console that the table does not word, and table entries no function raises. */
export function coverageViolations(raised: string[], table: readonly string[]): string[] {
  const out: string[] = [];
  const t = new Set(table);
  const r = new Set(raised);
  for (const c of r) if (!t.has(c)) out.push(`${c} can be raised at the console and has no fixed message`);
  for (const c of t) if (!r.has(c) && c !== '23514') out.push(`${c} has a message and nothing raises it`);
  return out;
}

// The definitions in force: 026 last wrote all three (R-2026-09-27-144 DT d, e;
// R-2026-09-27-145 DU-1 renamed 011's my_facility_wards).
const RAISED = [
  ...raisedCodes('026_facility_reporter_and_checks.sql', 'app.assert_member'),
  ...raisedCodes('026_facility_reporter_and_checks.sql', 'public.my_reporting_wards'),
  ...raisedCodes('026_facility_reporter_and_checks.sql', 'public.publish_ward_status'),
];

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('B2 — a malformed ward row is refused, never defaulted', () => {
  test.each([
    ['no category', { ...GOOD_ROW, category: undefined }],
    ['a category that is not an enum label', { ...GOOD_ROW, category: `<b>${SENTINEL}</b>` }],
    ['no offering', { ...GOOD_ROW, offering: undefined }],
    ['an offering outside OFFERED / NOT_OFFERED', { ...GOOD_ROW, offering: 'MAYBE' }],
    ['no version', { ...GOOD_ROW, version: undefined }],
    ['version 0', { ...GOOD_ROW, version: 0 }],
    ['a version sent as text', { ...GOOD_ROW, version: '4' }],
    ['a negative count', { ...GOOD_ROW, bed_count: -1 }],
    ['a fractional count', { ...GOOD_ROW, bed_count: 2.5 }],
    ['no accepting', { ...GOOD_ROW, accepting: undefined }],
    ['accepting sent as text', { ...GOOD_ROW, accepting: 'yes' }],
    ['no monitoring_state', { ...GOOD_ROW, monitoring_state: undefined }],
    ['no status source', { ...GOOD_ROW, source: undefined }],
    ['no status state', { ...GOOD_ROW, state: undefined }],
  ])('plant — a row with %s renders as unreadable with no publish form', async (_label, bad) => {
    const second = { ...bad, category: bad.category === GOOD_ROW.category ? 'ICU_ADULT' : bad.category };
    await renderAt(sessionFragment(), handover([GOOD_ROW, second]));
    await until(() => text().includes('Handover'));
    expect(text(), 'the refused row did not say it could not be read').toContain("could not be read, so it cannot be updated from here");
    expect(document.querySelectorAll('form').length, 'the refused row carries a publish form').toBe(1);
    expect(text(), 'arbitrary server text reached the page as a category').not.toContain(SENTINEL);
  });

  test('positive control — ordinary rows render in WORDS, with their publish forms (R-2026-09-23-70 E)', async () => {
    // Until -70 E these read "MATERNITY: OFFERED, 3 beds" and "ICU_ADULT: NOT_OFFERED,
    // not yet reporting": the database's codes, and a PENDING default shown as a
    // statement. The words and the precedence are now the public page's, from one
    // shared table.
    await renderAt(sessionFragment(), handover([
      GOOD_ROW,
      { ...GOOD_ROW, category: 'ICU_ADULT', offering: 'NOT_OFFERED', bed_count: null },
      { ...GOOD_ROW, category: 'THEATRE', offering: 'NOT_OFFERED', bed_count: null, monitoring_state: 'PENDING' },
      { ...GOOD_ROW, category: 'SURGICAL', accepting: false, gated_by: 'NO_ANAESTHETIST_ON_DUTY', source: 'ADMIN', state: 'UNDER_REVIEW' },
    ]));
    await until(() => text().includes('Handover'));
    expect(text()).toContain('Maternity: 3 beds');
    expect(text()).toContain('Adult ICU: not offered at this facility');
    expect(text(), 'a PENDING ward showed its default offering as a statement').toContain('Operating theatre: not currently reporting');
    expect(text()).toContain('Surgical ward: 3 beds — not accepting (no anaesthetist on duty) — set by admin, not ward-confirmed — under review');
    expect(document.querySelectorAll('form').length).toBe(4);
    expect(text()).not.toContain('could not be read');
  });

  test('no enum code the migrations define reaches the console, and the plant that shows one is caught', async () => {
    const codes = enumCodes();
    expect(codes.length, 'no enum was parsed from the migrations').toBeGreaterThan(20);
    const categories = codes.filter((c) => CATEGORY_CODES.includes(c));
    await renderAt(sessionFragment(), handover([
      ...categories.map((category) => ({ ...GOOD_ROW, category })),
      { ...GOOD_ROW, category: 'ICU_ADULT', offering: 'NOT_OFFERED', bed_count: null, monitoring_state: 'PAUSED' },
      { ...GOOD_ROW, category: 'THEATRE', accepting: false, gated_by: 'NO_ANAESTHETIST_ON_DUTY', source: 'ADMIN', state: 'UNDER_REVIEW' },
    ]));
    await until(() => text().includes('Handover'));
    const summaries = Array.from(document.querySelectorAll('li > p')).map((p) => p.textContent ?? '').join('\n');
    expect(summaries.length, 'no summary lines were rendered').toBeGreaterThan(0);
    expect(rawCodes(summaries, codes), 'a raw code reached the ward console').toEqual([]);
    // The plant: the pre-E summary line, which this check must reject.
    expect(rawCodes('MATERNITY: OFFERED, 3 beds (NO_ANAESTHETIST_ON_DUTY)', codes)).toEqual(['MATERNITY', 'OFFERED', 'NO_ANAESTHETIST_ON_DUTY']);
  });

  test('plant — a ward list that is not a list is refused whole', async () => {
    await renderAt(sessionFragment(), (url) => (url.endsWith('my_reporting_wards') ? json(200, { rows: [GOOD_ROW], note: SENTINEL }) : json(500, {})));
    await until(() => text().includes('Could not load'));
    expect(text()).toContain('The ward list could not be read.');
    expect(text()).not.toContain(SENTINEL);
  });
});

describe('a bed count in words (R-2026-09-27-144 DT Bundle 4; R-2026-09-27-140 DP-5 a)', () => {
  test.each([[1, '1 bed'], [0, '0 beds'], [2, '2 beds']])('the handover summary for a count of %s reads "%s"', async (n, words) => {
    const m = await import('../../apps/ward-console/src/main.js');
    const { categoryLabel } = await import('../../packages/labels/src/index.js');
    const line = m.summaryLine({ category: 'MATERNITY', offering: 'OFFERED', bedCount: n, accepting: true, version: 5, gatedBy: null, monitoringState: 'ACTIVE', source: 'WARD', state: 'OK', canPublish: true });
    expect(line).toBe(`${categoryLabel('MATERNITY')}: ${words}`);
  });
});

describe('can_publish decides which rows carry a form (R-2026-09-27-144 DT, Bundle 2; resolves -139 DO-3)', () => {
  // The server's flag, not a guess: 026's my_reporting_wards() says, per row, whether THIS
  // login may publish it. Until Bundle 2 every row carried a form, so a ward login was
  // offered Publish on wards WARD_SCOPE_DENIED would refuse (DO-3).
  const readOnly = () => Array.from(document.querySelectorAll('li.ward')).filter((li) => li.querySelector('form') === null);

  test("a ward login's own ward carries the one form, and its two other wards read-only, each with the muted line", async () => {
    await renderAt(sessionFragment(), handover([
      { ...GOOD_ROW, can_publish: true },
      { ...GOOD_ROW, category: 'ICU_ADULT', can_publish: false },
      { ...GOOD_ROW, category: 'THEATRE', can_publish: false },
    ]));
    await until(() => text().includes('Handover'));
    expect(document.querySelectorAll('form.publish').length, 'the rows the server did not let this login publish carry a form').toBe(1);
    expect(document.querySelector('li.ward form.publish')?.closest('li')?.querySelector('p.summary')?.textContent).toBe('Maternity: 3 beds');
    const ro = readOnly();
    expect(ro.map((li) => li.querySelector('p.summary')?.textContent)).toEqual(['Adult ICU: 3 beds', 'Operating theatre: 3 beds']);
    for (const li of ro) {
      const line = li.querySelector('p.reports-own');
      expect(line?.textContent, 'a read-only row does not say why it has no form').toBe('This ward reports from its own login.');
      expect(line?.classList.contains('notice'), 'the read-only line is a Notice, and it refuses nothing').toBe(false);
      expect(li.querySelector('button'), 'a read-only row carries a control').toBeNull();
    }
  });

  test('a facility login, can_publish true on every ward, carries a form on every row and no read-only line', async () => {
    await renderAt(sessionFragment(), handover([
      { ...GOOD_ROW, can_publish: true },
      { ...GOOD_ROW, category: 'ICU_ADULT', can_publish: true },
      { ...GOOD_ROW, category: 'THEATRE', can_publish: true },
    ]));
    await until(() => text().includes('Handover'));
    expect(document.querySelectorAll('form.publish').length).toBe(3);
    expect(text()).not.toContain('This ward reports from its own login.');
  });

  test('a row WITHOUT can_publish is read-only, never publishable (DT: missing reads as false)', async () => {
    const older: Record<string, unknown> = { ...GOOD_ROW };
    delete older['can_publish'];
    await renderAt(sessionFragment(), handover([older]));
    await until(() => text().includes('Handover'));
    expect(document.querySelectorAll('form').length, 'a row with no can_publish carries a form').toBe(0);
    expect(text()).toContain('Maternity: 3 beds');
    expect(text()).toContain('This ward reports from its own login.');
    expect(text(), 'a missing flag was treated as an unreadable row').not.toContain('could not be read');
  });

  test.each([
    ['sent as text', 'true'],
    ['sent as a number', 1],
    ['null', null],
  ])('plant — can_publish %s is refused: the row renders as unreadable with no form', async (_label, value) => {
    await renderAt(sessionFragment(), handover([{ ...GOOD_ROW, can_publish: value }]));
    await until(() => text().includes('Handover'));
    expect(document.querySelectorAll('form').length, 'a malformed flag was guessed into a form').toBe(0);
    expect(text()).toContain("could not be read, so it cannot be updated from here");
  });
});

describe('D1 — no raw server text reaches the screen', () => {
  test('site 1, the handover load — a recognised refusal shows its fixed sentence and none of the body', async () => {
    await renderAt(sessionFragment(), (url) =>
      url.endsWith('my_reporting_wards') ? json(403, { code: '42501', message: 'NOT_A_MEMBER', details: SENTINEL, hint: null }) : json(500, {}),
    );
    await until(() => text().includes('Could not load'));
    expect(text()).toContain('This sign-in is not linked to a ward.');
    expect(text(), 'the server body reached the page').not.toContain(SENTINEL);
    expect(text(), 'the status line is still printed').not.toMatch(/The server answered/);
  });

  // R-2026-09-28-151 EA-5: a facility login reads this sentence too, so it names the
  // sign-in and not a ward. The lead and the session-ended sentence are held exactly in
  // tests/compliance/ward_console_design.test.ts.
  test('site 1, the handover load — ACCOUNT_DEACTIVATED reads "This sign-in has been switched off", not a ward\'s account (EA-5)', async () => {
    await renderAt(sessionFragment(), (url) =>
      url.endsWith('my_reporting_wards') ? json(403, { code: '42501', message: 'ACCOUNT_DEACTIVATED', details: SENTINEL, hint: null }) : json(500, {}),
    );
    await until(() => text().includes('Could not load'));
    expect(text()).toContain('This sign-in has been switched off. To fix this, ');
    expect(text(), 'the pre-EA-5 sentence is still shown').not.toContain("This ward's account has been switched off.");
    expect(text()).not.toContain(SENTINEL);
  });

  test('site 1, the handover load — an unrecognised answer shows the one fixed fallback', async () => {
    await renderAt(sessionFragment(), (url) => (url.endsWith('my_reporting_wards') ? json(502, { message: `${SENTINEL} upstream` }) : json(500, {})));
    await until(() => text().includes('Could not load'));
    expect(text()).toContain('Something went wrong. Reload the page and try again.');
    expect(text()).not.toContain(SENTINEL);
  });

  test.each([
    ['a recognised code', { code: 'P0001', message: 'VERSION_CONFLICT', details: `current_version=${SENTINEL}` }, 'Someone else already updated this ward.'],
    ['an unrecognised code', { code: 'P0001', message: `BRAND_NEW_CODE ${SENTINEL}` }, 'Something went wrong. Reload the page and try again.'],
    ['a CHECK violation', { code: '23514', message: `new row violates check constraint "${SENTINEL}"` }, 'a count must be between 0 and 500'],
    ['a body that is not JSON', `<html>${SENTINEL}</html>`, 'Something went wrong. Reload the page and try again.'],
  ])('site 2, the publish status — %s shows a fixed sentence and none of the body', async (_label, body, expected) => {
    await renderAt(sessionFragment(), (url) => {
      if (url.endsWith('my_reporting_wards')) return json(200, [GOOD_ROW]);
      if (url.endsWith('publish_ward_status')) {
        return typeof body === 'string' ? new Response(body, { status: 400 }) : json(400, body);
      }
      return json(500, {});
    });
    await until(() => document.querySelector('form') !== null);
    document.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => (document.querySelector('p.status')?.textContent ?? '') !== '');
    expect(document.querySelector('p.status')?.textContent).toContain(expected);
    expect(text(), 'the server body reached the page').not.toContain(SENTINEL);
  });

  test("site 3, the bad-link screen — GoTrue's own words go to the log, never the page", async () => {
    await renderAt(`#error=access_denied&error_code=otp_expired&error_description=${encodeURIComponent(SENTINEL)}`, () => json(500, {}));
    expect(text()).toContain('That link did not work');
    expect(text()).toContain('It may have been used already, or it has expired.');
    expect(text(), "GoTrue's error text reached the page").not.toContain(SENTINEL);
    expect(text()).not.toContain('otp_expired');
  });

  test('the message table covers EXACTLY the codes the three functions can raise', async () => {
    const { WARD_MESSAGES } = await import('../../apps/ward-console/src/main.js');
    expect(RAISED.length, 'no codes parsed from the migrations — the checker read nothing').toBeGreaterThan(10);
    expect(coverageViolations(RAISED, Object.keys(WARD_MESSAGES))).toEqual([]);
  });

  test('plant — a new RAISE with no message, and a message nothing raises, are both caught', async () => {
    const { WARD_MESSAGES } = await import('../../apps/ward-console/src/main.js');
    const keys = Object.keys(WARD_MESSAGES);
    expect(coverageViolations([...RAISED, 'WARD_ON_FIRE'], keys)).toContain('WARD_ON_FIRE can be raised at the console and has no fixed message');
    expect(coverageViolations(RAISED.filter((c) => c !== 'NO_SUCH_WARD'), keys)).toContain('NO_SUCH_WARD has a message and nothing raises it');
  });
});

describe('the publish form sends what the server accepts', () => {
  async function submitWith(setup: (form: HTMLFormElement) => void) {
    const stub = await renderAt(sessionFragment(), (url) => {
      if (url.endsWith('my_reporting_wards')) return json(200, [GOOD_ROW]);
      if (url.endsWith('publish_ward_status')) {
        return json(200, [{ version: 5, replayed: false, claim_offering: 'NOT_OFFERED', claim_bed_count: null, claim_accepting: false, public_gated_by: null }]);
      }
      return json(500, {});
    });
    await until(() => document.querySelector('form') !== null);
    const form = document.querySelector('form') as HTMLFormElement;
    setup(form);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => stub.mock.calls.some(([u]) => String(u).endsWith('publish_ward_status')) || (form.querySelector('p.status')?.textContent ?? '') !== '');
    const call = stub.mock.calls.find(([u]) => String(u).endsWith('publish_ward_status'));
    return { form, body: call ? (JSON.parse(String(call[1]?.body)) as Record<string, unknown>) : null };
  }

  test('NOT_OFFERED sends no count and does not claim to be accepting; the count and accepting are hidden', async () => {
    const { body, form } = await submitWith((form) => {
      const select = form.querySelector('select[name="offering"]') as HTMLSelectElement;
      select.value = 'NOT_OFFERED';
      select.dispatchEvent(new Event('change'));
      expect((form.querySelector('input[name="bed_count"]') as HTMLInputElement).hidden, 'the count input is still shown').toBe(true);
    });
    expect(body, 'no publish was sent').not.toBeNull();
    expect(body?.['p_offering']).toBe('NOT_OFFERED');
    expect(body?.['p_bed_count'], 'a NOT_OFFERED publish still sends a count, which 004 refuses').toBeNull();
    expect(body?.['p_accepting']).toBe(false);
    expect(form).toBeDefined();
  });

  test('OFFERED with zero beds sends the chosen app.zero_reason value', async () => {
    const { body } = await submitWith((form) => {
      const count = form.querySelector('input[name="bed_count"]') as HTMLInputElement;
      count.value = '0';
      count.dispatchEvent(new Event('input'));
      const reason = form.querySelector('select[name="reason"]') as HTMLSelectElement;
      expect(reason.hidden, 'the reason is not offered when zero beds are entered').toBe(false);
      reason.value = 'NO_ANAESTHETIST';
    });
    expect(body?.['p_bed_count']).toBe(0);
    expect(body?.['p_reason']).toBe('NO_ANAESTHETIST');
  });

  test('OFFERED with zero beds and no reason is stopped before it is sent', async () => {
    const { body, form } = await submitWith((form) => {
      const count = form.querySelector('input[name="bed_count"]') as HTMLInputElement;
      count.value = '0';
      count.dispatchEvent(new Event('input'));
    });
    expect(body, 'a zero-with-no-reason publish was sent').toBeNull();
    expect(form.querySelector('p.status')?.textContent).toContain('needs a reason');
  });

  test('the reason choices are EXACTLY app.zero_reason, in its order', async () => {
    const enumSrc = readFileSync(join(MIG, '002_enums.sql'), 'utf8');
    const m = /CREATE TYPE app\.zero_reason AS ENUM \(([\s\S]*?)\);/.exec(enumSrc);
    const labels = [...(m?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
    expect(labels.length, 'app.zero_reason was not parsed').toBe(8);
    const { ZERO_REASONS } = await import('../../apps/ward-console/src/main.js');
    expect(ZERO_REASONS.map(([v]) => v)).toEqual(labels);
  });
});

describe('the ward asks for a new sign-in link, and cannot learn whether an address exists', () => {
  async function requestWith(route: Route, fragment = '') {
    const stub = await renderAt(fragment, route);
    const form = document.querySelector('form.signin-request') as HTMLFormElement | null;
    expect(form, 'the screen offers no way to ask for a new link').not.toBeNull();
    (form?.querySelector('input[name="email"]') as HTMLInputElement).value = ' ward@example.invalid ';
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => (form?.querySelector('p.status')?.textContent ?? '') !== '');
    return { stub, status: form?.querySelector('p.status')?.textContent ?? '' };
  }

  test('the request carries create_user:false, the trimmed address, and returns to this origin', async () => {
    const { stub } = await requestWith(() => json(200, {}));
    const [url, init] = stub.mock.calls.find(([u]) => String(u).includes('/auth/v1/otp')) ?? [];
    expect(String(url)).toContain(`/auth/v1/otp?redirect_to=${encodeURIComponent(`${window.location.origin}/`)}`);
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'ward@example.invalid', create_user: false });
  });

  // OBSERVED 2026-09-23 on the local stack: known -> 200 then 429; unknown -> 422
  // every time. Each status is evidence about the address, so all read the same.
  test('200, 422, 429 and 500 all produce the SAME words, and none of the server text', async () => {
    const seen: string[] = [];
    for (const [status, body] of [
      [200, {}],
      [422, { code: 422, error_code: 'otp_disabled', msg: `Signups not allowed for otp ${SENTINEL}` }],
      [429, { code: 429, error_code: 'over_email_send_rate_limit', msg: `after 0 seconds ${SENTINEL}` }],
      [500, { code: 500, msg: `Error sending magic link ${SENTINEL}` }],
    ] as const) {
      const { status: said } = await requestWith(() => json(status, body));
      expect(text(), `HTTP ${status}'s text reached the page`).not.toContain(SENTINEL);
      seen.push(said);
    }
    expect(new Set(seen).size, `the page told a ${seen.length}-way story: ${JSON.stringify(seen)}`).toBe(1);
    expect(seen[0]).toContain('If this address belongs to a ward');
  });

  test('no answer at all is the one other outcome, and it says nothing about the address', async () => {
    // The WORST-CASE jitter, every run: the retry sleeps its maximum ~600ms.
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const { status } = await requestWith(() => {
      throw new TypeError(`network down ${SENTINEL}`);
    });
    expect(status).toContain('The request could not be sent.');
    expect(status, 'the unreachable message is the answered one — the comparison above could not see a difference').not.toContain('If this address belongs to a ward');
    expect(text()).not.toContain(SENTINEL);
  });

  // R-2026-10-02-FF FF-3 c. Only the Worker's OWN marker earns the sentence, because only the Worker's per-address
  // limit says nothing about whether an address exists. Supabase's own 429 (a per-USER limit, which does reveal the
  // address) carries no marker and stays in the one flat answer the test above holds.
  test("the Worker's own `limited` 429 shows its own sentence as a caution Notice and is sent exactly once; no marker, it reads as answered", async () => {
    const m = await import('../../apps/ward-console/src/main.js');
    const limited = await requestWith(() => json(429, { message: 'rate limited by the OpenBed proxy' }, { 'x-openbed-proxy': 'limited' }), '');
    expect(limited.status).toBe(m.SIGNIN_LIMITED_WORDS);
    expect(limited.status).toBe('Too many sign-in links were asked for from this network just now. Wait one minute, then ask again.');
    expect(document.querySelector('form.signin-request p.status')?.classList.contains('notice-caution'), 'the limited sentence is a caution Notice').toBe(true);
    expect(limited.stub.mock.calls.filter(([u]) => String(u).includes('/auth/v1/otp')).length, 'a limited request was retried').toBe(1);
    // The same status WITHOUT the Worker's marker is Supabase's and reads as the flat answer.
    for (const status of [200, 422, 429]) {
      const answered = await requestWith(() => json(status, {}), '');
      expect(answered.status, `HTTP ${status} with no marker did not read as answered`).toBe(m.SIGNIN_ANSWERED);
    }
  });

  test('the address field is labelled "Sign-in email address" (DT Bundle 2: a facility login signs in here too)', async () => {
    await renderAt('', () => json(200, {}));
    const label = document.querySelector('form.signin-request label.field');
    expect(label?.firstChild?.textContent, 'the sign-in label is not the new sentence').toBe('Sign-in email address ');
    expect(text(), "the old label, \"This ward's email address\", is still on the page").not.toContain("This ward's email address");
  });

  test('the bad-link screen offers the same request', async () => {
    const { status } = await requestWith(() => json(200, {}), '#error=access_denied&error_code=otp_expired');
    expect(text()).toContain('That link did not work');
    expect(status).toContain('If this address belongs to a ward');
  });

  test('an HTTP answer is never retried; only a missing answer is, once', async () => {
    const { requestSignInLink } = await import('../../packages/auth/src/request.js');
    const answered = vi.fn(async () => json(429, {}));
    const a = await requestSignInLink({ apiUrl: 'http://x', anonKey: 'k', email: 'e', redirectTo: 'http://y/', fetch: answered as never, sleep: async () => undefined });
    expect(a).toEqual({ kind: 'answered', status: 429 });
    expect(answered, 'a 429 was retried — exactly the traffic the limit exists to stop').toHaveBeenCalledTimes(1);
    const down = vi.fn(async () => {
      throw new TypeError('down');
    });
    const b = await requestSignInLink({ apiUrl: 'http://x', anonKey: 'k', email: 'e', redirectTo: 'http://y/', fetch: down as never, sleep: async () => undefined });
    expect(b.kind).toBe('unreachable');
    expect(down, 'a missing answer was not retried, or was retried without bound').toHaveBeenCalledTimes(2);
  });
});

/**
 * BP-8 (R-2026-09-24-88): a session with NO ward is a stop, never an empty handover.
 * Rendered against packages/fixtures/platform-admin-my-reporting-wards.json, the body
 * tests/db/platform_admin_session_live.test.ts asserts a real PLATFORM_ADMIN session
 * gets. Until PR 3.4b-app A the console drew "Handover", "Signed in as …" and an empty
 * list for it: a sign-in that looked as if it worked.
 */
function zeroWardViolations(page: Document): string[] {
  const out: string[] = [];
  const words = page.body.textContent ?? '';
  if (!words.includes('Not linked to a ward')) out.push('no zero-ward stop heading');
  if (!words.includes('admin.openbed.ng')) out.push('the stop does not send an operator to admin.openbed.ng');
  if (words.includes('Handover')) out.push('the handover heading was drawn');
  if (page.querySelectorAll('ul').length > 0) out.push('a list was drawn');
  if (page.querySelectorAll('form').length > 0) out.push('a form was drawn');
  return out;
}

describe('the zero-ward session (BP-8)', () => {
  test('real console — a PLATFORM_ADMIN session (zero rows) gets the stop, with the support sentence, and no list or form', async () => {
    await renderAt(sessionFragment(), handover(ZERO_WARD.body));
    await until(() => text().includes('Not linked to a ward'));
    expect(zeroWardViolations(document)).toEqual([]);
    const m = await import('../../apps/ward-console/src/main.js');
    expect(text()).toContain(m.NO_WARD_SESSION);
    expect(m.NO_WARD_SESSION, 'the stop dropped the support sentence (BR-2)').toContain('email ');
  });

  test('plant — the pre-3.4b-app page, an empty handover list, is rejected', () => {
    document.body.innerHTML = '<div id="app"><h1>Handover</h1><p>Signed in as ward@example.invalid.</p><ul></ul></div>';
    expect(zeroWardViolations(document)).toEqual([
      'no zero-ward stop heading',
      'the stop does not send an operator to admin.openbed.ng',
      'the handover heading was drawn',
      'a list was drawn',
    ]);
  });

  test('anti-vacuity — an empty page is not a stop', () => {
    document.body.innerHTML = '<div id="app"></div>';
    expect(zeroWardViolations(document)).toContain('no zero-ward stop heading');
  });

  test('a ward WITH rows still gets its handover — the stop fires on zero rows only', async () => {
    await renderAt(sessionFragment(), handover([GOOD_ROW]));
    await until(() => text().includes('Handover'));
    expect(text()).not.toContain('Not linked to a ward');
  });
});
