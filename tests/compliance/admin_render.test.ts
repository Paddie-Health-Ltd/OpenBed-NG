// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { REPO_ROOT } from './_scratch.js';
import ADMIN_LABELS from '../../packages/labels/admin-labels.json';
import { normaliseNgPhone } from '../../apps/admin/src/bodies.js';
import { adminMessageFor } from '../../apps/admin/src/messages.js';

/**
 * THE ADMIN APP, RENDERED (R-2026-09-24-97; the PR 3.4b-app C design report, sections
 * 1-5 and 9).
 *
 * Every assertion reads the page the operator would see, under jsdom, with fetch
 * stubbed per path so each server answer can be planted exactly -- the ward console's
 * pattern (tests/compliance/ward_console_render.test.ts). What the server does with the
 * bodies is tests/db/admin_calls_live.test.ts's, over the same builders.
 *
 *   THE REGISTER NEVER HIDES A ROW (AJ D8): a ward thirteen hours stale is shown, in the
 *   server's order, and a row that could not be read is shown as unreadable in place.
 *   Its band comes from server_now and monotonic time, so a device clock six hours out
 *   either way changes nothing.
 *   WRITES ARE NEVER RE-SENT (BP-4; R-2026-09-24-97 BY-2 e): create keeps one id per
 *   form, so a retry after a dropped answer makes one facility and shows it created;
 *   edit is sent once, and a dropped answer reloads and says so; a VERSION_CONFLICT
 *   reloads and never re-submits.
 *   A 23514 IS READ BY CONSTRAINT NAME: a swapped latitude says so.
 *   THE CONTACT IS NEVER LOGGED (BP-5): every console method is spied across the paths
 *   that touch a contact, with the contact's values as markers.
 *   EVERY REFUSAL HAS A SENTENCE, AND EVERY SENTENCE A REFUSAL: the label table is held
 *   to the codes the migrations raise and the CHECK constraints they declare, both ways.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that the page works under its CSP in a real browser. jsdom enforces no CSP. That
 *     is the local browser walk before every report (BU-2 e), and H6 on hosted.
 *   - the live round trip. tests/db/admin_calls_live.test.ts.
 */

const MIG = join(REPO_ROOT, 'database', 'migrations');
const SERVER_NOW = '2026-09-24T12:00:00.000Z';
const MARK_EMAIL = 'marker-contact-7f3a@example.invalid';
const MARK_MOBILE = '+2348000007373';
const MARK_NAME = 'Marker Person Ọ̀dúnlá';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sessionFragment(secondsLeft = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    sub: '11111111-1111-4111-8111-111111111111',
    session_id: '22222222-2222-4222-8222-222222222222',
    exp: now + secondsLeft,
    iat: now,
    role: 'authenticated',
    email: 'operator@example.invalid',
  })}.sig`;
  return `#access_token=${token}&refresh_token=r1&expires_at=${now + secondsLeft}&token_type=bearer`;
}

const hoursAgo = (h: number): string => new Date(Date.parse(SERVER_NOW) - h * 3600_000).toISOString();

const FAC_A = '0a000000-0000-4000-8000-00000000000a';
const FAC_B = '0b000000-0000-4000-8000-00000000000b';

function ward(category: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category,
    offering: 'OFFERED',
    monitoring_state: 'ACTIVE',
    bed_count: 3,
    accepting: true,
    updated_at: hoursAgo(0.1),
    has_account: true,
    provisioning_incomplete: false,
    ...over,
  };
}

function facility(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    facility_id: id,
    name: "St. Placeholder's Hospital",
    lga: 'Lagos Island',
    state: 'Lagos',
    lat: 6.45,
    lng: 3.4,
    public_phone_e164: '+2348000000303',
    version: 4,
    listed_at: '2026-09-20T09:00:00.000Z',
    quiet_mode: false,
    is_active: true,
    has_contact: true,
    agreement_state: 'recorded',
    categories: [ward('MATERNITY')],
    // 026's three keys (R-2026-09-27-144 DT i, k): the register refuses a row without them.
    reporting_model: 'WARD',
    reporter_login: 'none',
    hefamaa_reg_no: null,
    // 029's three keys (R-2026-09-30-201 GA): the register refuses a row without them. A WARD approval
    // beside the ward logins reads MATCHES, a plain line, so no test below counts a caution it did not ask for.
    approved_model: 'WARD',
    approved_on: '2026-09-15',
    reporting_approval_state: 'MATCHES',
    ...over,
  };
}

const REGISTER = {
  server_now: SERVER_NOW, retention_alert: [],
  facilities: [
    facility(FAC_A, {
      categories: [ward('ICU_ADULT', { updated_at: hoursAgo(13) }), ward('MATERNITY'), ward('THEATRE', { monitoring_state: 'PENDING', bed_count: null, updated_at: null, has_account: false, provisioning_incomplete: true })],
    }),
    facility(FAC_B, { name: 'Ọ̀dúnlá General', listed_at: null, has_contact: false, agreement_state: 'none', categories: [] }),
  ],
};


/**
 * THE SCHEDULER'S STATUS, healthy (R-2026-09-30-175 EY-3): the snapshot 30 seconds old on
 * the database's clock, and the five openbed_ jobs all switched on with a succeeded last run.
 * A default answer for operator_scheduler_status, so a fake that has no opinion about the
 * System status still answers it the way a healthy server does.
 */
const JOB_NAMES = ['openbed_check_withdrawn_facility_accounts', 'openbed_erase_lapsed_ward_logins', 'openbed_prune_ended_auth_sessions', 'openbed_refresh_lga_rollup', 'openbed_regenerate_snapshot'];
const HEALTHY_STATUS = {
  server_now: SERVER_NOW,
  generated_at: '2026-09-24T11:59:30.000Z',
  last_snapshot_at: '2026-09-24T11:59:30.000Z',
  jobs: JOB_NAMES.map((name) => ({ name, active: true, schedule: '* * * * *', last_status: 'succeeded', last_start_time: '2026-09-24T11:59:00.000Z' })),
};

const CONTACT = {
  contact: { full_name: MARK_NAME, job_title: 'Medical Director', email: MARK_EMAIL, mobile_e164: MARK_MOBILE, sms_opt_in: true, unreachable_since: null, version: 2 },
  agreement: { accepted_on: '2026-09-01', version: 'v1', signatory_role: 'Medical Director', withdrawn_on: null },
};

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** The normal server, with overrides by RPC name. */
function server(over: Record<string, Route> = {}): Route {
  return (url, init) => {
    const fn = /\/rpc\/([a-z_]+)$/.exec(url)?.[1] ?? '';
    const o = over[fn];
    if (o !== undefined) return o(url, init);
    if (fn === 'operator_register') return json(200, REGISTER);
    if (fn === 'operator_get_contact') return json(200, CONTACT);
    // R-2026-09-30-175 EY-3: the System status is loaded beside the register.
    if (fn === 'operator_scheduler_status') return json(200, HEALTHY_STATUS);
    return json(500, { message: 'unexpected call' });
  };
}

async function renderAt(fragment: string, route: Route) {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/${fragment}`);
  const stub = vi.fn(async (url: string | URL, init?: RequestInit) => route(String(url), init));
  vi.stubGlobal('fetch', stub);
  const { render } = await import('../../apps/admin/src/main.js');
  await render();
  return stub;
}

function text(): string {
  return document.body.textContent ?? '';
}

async function until(cond: () => boolean, deadlineMs = 5000): Promise<void> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`the page never reached the expected state. It reads: ${text().slice(0, 400)}`);
}

function calls(stub: ReturnType<typeof vi.fn>, fn: string): Record<string, unknown>[] {
  return stub.mock.calls
    .filter(([u]) => String(u).endsWith(`/rpc/${fn}`))
    .map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')) as Record<string, unknown>);
}

function button(label: string): HTMLButtonElement {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent === label);
  if (b === undefined) throw new Error(`no button "${label}" on the page: ${text().slice(0, 300)}`);
  return b;
}

function setInput(formClass: string, name: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(`form.${formClass} [name="${name}"]`);
  if (input === null) throw new Error(`no input ${name} in form.${formClass}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function submit(formClass: string): void {
  const f = document.querySelector<HTMLFormElement>(`form.${formClass}`);
  if (f === null) throw new Error(`no form.${formClass}`);
  f.requestSubmit();
}

function fillFacility(formClass: string): void {
  setInput(formClass, 'name', "St. Placeholder's Hospital");
  setInput(formClass, 'lga', 'Lagos Island');
  setInput(formClass, 'state', 'Lagos');
  setInput(formClass, 'lat', '6.45');
  setInput(formClass, 'lng', '3.40');
  setInput(formClass, 'phone', '0800 000 0303');
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the register', () => {
  test('real register renders every facility in the server’s order, and never hides the thirteen-hour-stale ward', async () => {
    await renderAt(sessionFragment(), server());
    await until(() => text().includes('Facilities'));
    const cards = Array.from(document.querySelectorAll<HTMLElement>('li.facility')).map((c) => c.dataset['facilityId']);
    expect(cards).toEqual([FAC_A, FAC_B]);
    const stale = Array.from(document.querySelectorAll<HTMLElement>('li.ward')).find((w) => (w.textContent ?? '').startsWith('Adult ICU'));
    expect(stale, 'the stale ward is not on the page').toBeDefined();
    expect(stale?.dataset['band']).toBe('SUPPRESSED');
    expect(stale?.textContent).toContain('3 beds, last reported at 24 Sept, 00:00 (Lagos time)');
  });

  test('a one-bed ward reads "1 bed", never "1 beds" (R-2026-09-27-144 DT Bundle 4; DP-5 a)', async () => {
    const one = { ...REGISTER, facilities: [facility(FAC_A, { categories: [ward('MATERNITY', { bed_count: 1 })] })] };
    await renderAt(sessionFragment(), server({ operator_register: () => json(200, one) }));
    await until(() => text().includes('Facilities'));
    const line = document.querySelector<HTMLElement>('li.ward')?.textContent ?? '';
    expect(line, line).toContain(': 1 bed, last reported at ');
    expect(line).not.toContain('1 beds');
  });

  test('the checklist is derived from the row, and the words are Listed / Not listed, never Paused', async () => {
    await renderAt(sessionFragment(), server());
    await until(() => text().includes('Facilities'));
    expect(text()).toContain('Listed');
    expect(text()).toContain('Not listed');
    expect(text()).not.toMatch(/paused/i);
    expect(text()).toContain('Agreement: none');
    expect(text()).toContain('Not yet reporting');
    expect(text()).toContain('Setup incomplete');
  });

  test('a listed facility with no contact, and one whose agreement is withdrawn, each say so', async () => {
    const reg = {
      server_now: SERVER_NOW, retention_alert: [],
      facilities: [facility(FAC_A, { has_contact: false }), facility(FAC_B, { agreement_state: 'withdrawn' })],
    };
    await renderAt(sessionFragment(), server({ operator_register: () => json(200, reg) }));
    await until(() => text().includes('Facilities'));
    expect(text()).toContain(ADMIN_LABELS.screens.NO_CONTACT_WARNING);
    expect(text()).toContain(ADMIN_LABELS.screens.WITHDRAWN_WARNING);
  });

  test('a row that could not be read is shown in its place, never dropped', async () => {
    const reg = { server_now: SERVER_NOW, retention_alert: [], facilities: [facility(FAC_A, { version: 'four' }), facility(FAC_B)] };
    await renderAt(sessionFragment(), server({ operator_register: () => json(200, reg) }));
    await until(() => text().includes('Facilities'));
    expect(document.querySelectorAll('li.facility')).toHaveLength(2);
    expect(text()).toContain("This facility's record could not be read.");
  });

  test.each([6, -6])('the band is unchanged with the device clock %d hours out, because it comes from server_now', async (hours) => {
    await renderAt(sessionFragment(), server());
    await until(() => text().includes('Facilities'));
    const before = Array.from(document.querySelectorAll<HTMLElement>('li.ward')).map((w) => w.dataset['band'] ?? '-');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + hours * 3600_000);
    await renderAt(sessionFragment(), server());
    vi.useRealTimers();
    await until(() => text().includes('Facilities'));
    const after = Array.from(document.querySelectorAll<HTMLElement>('li.ward')).map((w) => w.dataset['band'] ?? '-');
    expect(after).toEqual(before);
    expect(before).toContain('SUPPRESSED');
    expect(before).toContain('GREEN');
  });
});

describe('the stop screens and named refusals', () => {
  test.each([
    ['NOT_AN_OPERATOR', ADMIN_LABELS.codes.NOT_AN_OPERATOR],
    ['ACCOUNT_DEACTIVATED', ADMIN_LABELS.codes.ACCOUNT_DEACTIVATED],
  ])('a %s session gets the stop screen, never a register', async (code, sentence) => {
    await renderAt(sessionFragment(), server({ operator_register: () => json(403, { code: '42501', message: code }) }));
    await until(() => text().includes(sentence));
    expect(text()).toContain(ADMIN_LABELS.screens.STOP_HEADING);
    expect(document.querySelector('ul.register')).toBeNull();
  });

  test('a Worker refusal is named as the missing redeploy (H5), not as "not recognised"', async () => {
    await renderAt(sessionFragment(), server({ operator_register: () => json(404, { error: 'not forwarded' }, { 'x-openbed-proxy': 'refused' }) }));
    await until(() => text().includes(ADMIN_LABELS.fixed.WORKER_REFUSED));
  });

  test('no raw server text reaches the screen', async () => {
    const SENTINEL = 'SENTINEL_admin_internal_detail';
    await renderAt(sessionFragment(), server({ operator_register: () => json(400, { code: 'P0001', message: `WEIRD_THING ${SENTINEL}`, details: SENTINEL }) }));
    await until(() => text().includes(ADMIN_LABELS.fixed.UNRECOGNISED));
    expect(text()).not.toContain(SENTINEL);
  });

  test('a swapped latitude is refused with its constraint named in the sentence', () => {
    const r = adminMessageFor(400, null, JSON.stringify({ code: '23514', message: 'new row for relation "facility" violates check constraint "facility_lat_in_nigeria"' }));
    expect(r.key).toBe('constraint:facility_lat_in_nigeria');
    expect(r.sentence).toContain('latitude and longitude are not swapped');
  });

  test('a code with digits in it is read whole: MOBILE_NOT_E164', () => {
    const r = adminMessageFor(400, null, JSON.stringify({ code: 'P0001', message: 'MOBILE_NOT_E164' }));
    expect(r.key).toBe('MOBILE_NOT_E164');
  });

  test('INVALID_ARGUMENT is read with its parameter', () => {
    expect(adminMessageFor(400, null, JSON.stringify({ code: 'P0001', message: 'INVALID_ARGUMENT', details: 'p_offering' })).sentence).toBe(ADMIN_LABELS.codes['INVALID_ARGUMENT:p_offering']);
  });
});

describe('writes are never re-sent', () => {
  test('create: a double click sends once, a dropped answer and a retry send the SAME id, and the page shows it created', async () => {
    let n = 0;
    const stub = await renderAt(
      sessionFragment(),
      server({
        operator_create_facility: () => {
          n += 1;
          if (n === 1) throw new TypeError('network dropped');
          return json(200, [{ facility_id: FAC_A, version: 1, created: false }]);
        },
      }),
    );
    await until(() => text().includes('Facilities'));
    button('New facility').click();
    fillFacility('create-facility');
    submit('create-facility');
    submit('create-facility'); // the double click, while the first is in flight
    await until(() => text().includes(ADMIN_LABELS.fixed.UNREACHABLE));
    expect(calls(stub, 'operator_create_facility'), 'the double click sent twice').toHaveLength(1);
    submit('create-facility');
    await until(() => text().includes(ADMIN_LABELS.fixed.CREATED));
    const bodies = calls(stub, 'operator_create_facility');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.['p_id']).toBe(bodies[1]?.['p_id']);
    expect(bodies[0]?.['p_public_phone_e164']).toBe('+2348000000303');
    expect(bodies[0]?.['p_name'], 'the name was not sent exactly as typed').toBe("St. Placeholder's Hospital");
  });

  test('edit: a dropped answer is NEVER re-sent -- the page reloads and says so', async () => {
    const stub = await renderAt(sessionFragment(), server({ operator_edit_facility: () => { throw new TypeError('network dropped'); } }));
    await until(() => text().includes('Facilities'));
    button('Open').click();
    await until(() => document.querySelector('form.edit-facility') !== null);
    fillFacility('edit-facility');
    submit('edit-facility');
    await until(() => text().includes(ADMIN_LABELS.fixed.EDIT_DROPPED));
    expect(calls(stub, 'operator_edit_facility')).toHaveLength(1);
    expect(calls(stub, 'operator_edit_facility')[0]?.['p_expected_version']).toBe(4);
  });

  test('edit: VERSION_CONFLICT reloads and says the facility changed, and the values are not re-submitted', async () => {
    const stub = await renderAt(sessionFragment(), server({ operator_edit_facility: () => json(400, { code: 'P0001', message: 'VERSION_CONFLICT', details: 'current_version=5' }) }));
    await until(() => text().includes('Facilities'));
    button('Open').click();
    await until(() => document.querySelector('form.edit-facility') !== null);
    const registerReadsBefore = calls(stub, 'operator_register').length;
    fillFacility('edit-facility');
    submit('edit-facility');
    await until(() => text().includes(ADMIN_LABELS.codes.VERSION_CONFLICT));
    expect(calls(stub, 'operator_edit_facility')).toHaveLength(1);
    expect(calls(stub, 'operator_register').length, 'the facility was not reloaded').toBeGreaterThan(registerReadsBefore);
  });

  test('contact: the first write sends a null version; an edit sends the CONTACT’s version, not the facility’s', async () => {
    const stub = await renderAt(sessionFragment(), server({ operator_record_contact: () => json(200, [{ facility_id: FAC_A, contact_version: 3 }]) }));
    await until(() => text().includes('Facilities'));
    button('Open').click();
    await until(() => document.querySelector('form.record-contact') !== null);
    submit('record-contact');
    await until(() => calls(stub, 'operator_record_contact').length === 1);
    expect(calls(stub, 'operator_record_contact')[0]?.['p_expected_version']).toBe(2);
  });
});

describe('the edit form shows what is saved, and a phone change needs a confirm (R-2026-09-24-98 BZ-3)', () => {
  const EDITED = () => json(200, [{ facility_id: FAC_A, version: 5 }]);
  async function openEdit(route: Route = server({ operator_edit_facility: EDITED })) {
    const stub = await renderAt(sessionFragment(), route);
    await until(() => text().includes('Facilities'));
    button('Open').click();
    await until(() => document.querySelector('form.edit-facility') !== null);
    return stub;
  }
  const value = (name: string): string => document.querySelector<HTMLInputElement>(`form.edit-facility [name="${name}"]`)?.value ?? '(no input)';
  const panel = (): HTMLElement | null => document.querySelector<HTMLElement>('div.phone-confirm');

  test('all six fields are prefilled from the register row, the phone and location included', async () => {
    await openEdit();
    expect([value('name'), value('lga'), value('state'), value('lat'), value('lng'), value('phone')]).toEqual([
      "St. Placeholder's Hospital", 'Lagos Island', 'Lagos', '6.45', '3.4', '+2348000000303',
    ]);
    expect(text(), 'the retype note survived').not.toContain('Enter all three as they should be now');
  });

  test('a change that leaves the phone alone is sent on Save, once, with no confirm', async () => {
    const stub = await openEdit();
    setInput('edit-facility', 'name', "St. Placeholder's Hospital (Annex)");
    submit('edit-facility');
    await until(() => calls(stub, 'operator_edit_facility').length === 1);
    expect(panel()?.hidden, 'a confirm appeared for a change that did not touch the phone').not.toBe(false);
    expect(calls(stub, 'operator_edit_facility')[0]?.['p_public_phone_e164']).toBe('+2348000000303');
  });

  test('a phone change sends NOTHING on Save: the confirm shows <saved> → <new> first', async () => {
    const stub = await openEdit();
    setInput('edit-facility', 'phone', '0800 000 0404');
    submit('edit-facility');
    await until(() => panel()?.hidden === false);
    expect(panel()?.textContent).toContain('Public phone: +2348000000303 → +2348000000404');
    await new Promise((r) => setTimeout(r, 50));
    expect(calls(stub, 'operator_edit_facility'), 'a phone change was sent before it was confirmed').toHaveLength(0);
  });

  test('Cancel sends nothing, and closes the confirm', async () => {
    const stub = await openEdit();
    setInput('edit-facility', 'phone', '0800 000 0404');
    submit('edit-facility');
    await until(() => panel()?.hidden === false);
    button(ADMIN_LABELS.screens.CANCEL).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(panel()?.hidden).toBe(true);
    expect(calls(stub, 'operator_edit_facility'), 'Cancel sent the edit').toHaveLength(0);
  });

  test('Confirm sends the edit exactly once, with the new phone', async () => {
    const stub = await openEdit();
    setInput('edit-facility', 'phone', '0800 000 0404');
    submit('edit-facility');
    await until(() => panel()?.hidden === false);
    button(ADMIN_LABELS.screens.CONFIRM_PHONE).click();
    await until(() => calls(stub, 'operator_edit_facility').length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls(stub, 'operator_edit_facility')).toHaveLength(1);
    expect(calls(stub, 'operator_edit_facility')[0]?.['p_public_phone_e164']).toBe('+2348000000404');
  });

  test('a latitude change is shown as <saved> → <new>, and sent on Save with no confirm', async () => {
    const stub = await openEdit();
    setInput('edit-facility', 'lat', '6.46');
    expect(text()).toContain('Latitude: 6.45 → 6.46');
    submit('edit-facility');
    await until(() => calls(stub, 'operator_edit_facility').length === 1);
    expect(panel()?.hidden).not.toBe(false);
    expect(calls(stub, 'operator_edit_facility')[0]?.['p_lat']).toBe(6.46);
  });

  test('a register row without 023’s keys is unreadable, never defaulted', async () => {
    const row = facility(FAC_A);
    delete row['public_phone_e164'];
    await renderAt(sessionFragment(), server({ operator_register: () => json(200, { server_now: SERVER_NOW, retention_alert: [], facilities: [row] }) }));
    await until(() => text().includes('Facilities'));
    expect(text()).toContain("This facility's record could not be read.");
  });
});

describe('the phone preview', () => {
  test.each([
    ['0800 000 0303', '+2348000000303'],
    ['2348000000303', '+2348000000303'],
    ['+234 800 000 0303', '+2348000000303'],
    ['(0800) 000-0303', '+2348000000303'],
  ])('%s is read as %s', (raw, e164) => {
    expect(normaliseNgPhone(raw)).toBe(e164);
  });

  test.each(['0800', 'call me', '+0800123'])('%s is not guessed: null', (raw) => {
    expect(normaliseNgPhone(raw)).toBeNull();
  });

  test('the preview is on the page before submit', async () => {
    await renderAt(sessionFragment(), server());
    await until(() => text().includes('Facilities'));
    button('New facility').click();
    setInput('create-facility', 'phone', '0800 000 0303');
    expect(text()).toContain(`${ADMIN_LABELS.screens.PHONE_PREVIEW} +2348000000303`);
  });
});

describe('the contact is a named person’s data (BP-5)', () => {
  test('the contact is on the page only while its view is open', async () => {
    await renderAt(sessionFragment(), server());
    await until(() => text().includes('Facilities'));
    expect(document.body.innerHTML).not.toContain(MARK_NAME);
    button('Open').click();
    await until(() => text().includes(MARK_NAME));
    button('Back').click();
    await until(() => text().includes('Facilities'));
    expect(document.body.innerHTML).not.toContain(MARK_NAME);
    expect(document.body.innerHTML).not.toContain(MARK_EMAIL);
  });

  const MARKERS = [MARK_EMAIL, MARK_MOBILE, MARK_NAME];
  function spyAll() {
    return (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
  }
  function leaked(spies: ReturnType<typeof spyAll>): string[] {
    const seen = spies.flatMap((s) => s.mock.calls.map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a) ?? String(a))).join(' ')));
    return MARKERS.filter((m) => seen.some((line) => line.includes(m)));
  }

  test.each([
    ['a refused save whose body echoes the values', () => json(400, { code: 'P0001', message: 'MOBILE_NOT_E164', details: `${MARK_MOBILE} ${MARK_EMAIL}`, hint: MARK_NAME })],
    ['a 500 whose body echoes the values', () => json(500, { message: `${MARK_EMAIL} ${MARK_MOBILE} ${MARK_NAME}` })],
    ['a dropped answer', () => { throw new TypeError(`network dropped ${MARK_EMAIL}`); }],
  ])('no console call on the contact path carries the contact — %s', async (_name, answer) => {
    const spies = spyAll();
    await renderAt(sessionFragment(), server({ operator_record_contact: answer }));
    await until(() => text().includes('Facilities'));
    button('Open').click();
    await until(() => document.querySelector('form.record-contact') !== null);
    submit('record-contact');
    await until(() => (document.querySelector('form.record-contact p.status')?.textContent ?? '') !== '');
    expect(leaked(spies), 'a console call carried the contact').toEqual([]);
  });

  test('plant — a mapper that logs the response body is caught by the same spy', async () => {
    const spies = spyAll();
    const { wardMessageFor } = await import('../../apps/ward-console/src/main.js');
    wardMessageFor(400, JSON.stringify({ message: 'MOBILE_NOT_E164', details: MARK_EMAIL }));
    expect(leaked(spies), 'the spy did not see a body logged with the contact in it').toContain(MARK_EMAIL);
  });
});

describe('Bundle 3: the reporting model, the HEFAMAA number, the retention alert, and DP-5 b (R-2026-09-27-144 DT)', () => {
  const S = ADMIN_LABELS.screens;
  const HEFAMAA_SENTENCE = ADMIN_LABELS.codes['INVALID_ARGUMENT:p_hefamaa_reg_no'];
  const withRegister = (facilities: Record<string, unknown>[], over: Record<string, unknown> = {}) =>
    server({ operator_register: () => json(200, { server_now: SERVER_NOW, retention_alert: [], facilities, ...over }) });
  async function openFirst(route: Route) {
    const stub = await renderAt(sessionFragment(), route);
    await until(() => text().includes('Facilities'));
    button('Open').click();
    await until(() => document.querySelector('section.registration-detail') !== null);
    return stub;
  }

  test.each([
    ['FACILITY', 'One login for the whole facility'],
    ['WARD', 'One login per ward'],
    ['NONE', 'No reporting login yet'],
  ])('the register shows reporting_model %s as "%s"', async (model, words) => {
    await renderAt(sessionFragment(), withRegister([facility(FAC_A, { reporting_model: model })]));
    await until(() => text().includes('Facilities'));
    expect(document.querySelector('li.facility .reporting-model')?.textContent).toBe(words);
  });

  test('under a facility login every ward line reads "Reported by the facility login", never its own login state; the detail view says the same', async () => {
    const wards = [ward('MATERNITY'), ward('THEATRE', { has_account: false, provisioning_incomplete: false })];
    await renderAt(sessionFragment(), withRegister([facility(FAC_A, { reporting_model: 'FACILITY', reporter_login: 'active', categories: wards })]));
    await until(() => text().includes('Facilities'));
    const lines = Array.from(document.querySelectorAll('li.facility ul.wards li')).map((l) => l.textContent ?? '');
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.endsWith(`— ${S.REPORTED_BY_FACILITY}`), `a ward line under the facility login reads: ${l}`).toBe(true);
      expect(l).not.toContain(S.LOGIN_NONE);
    }
    button('Open').click();
    await until(() => document.querySelector('section.wards-detail .reporting-model') !== null);
    expect(document.querySelector('section.wards-detail .reporting-model')?.textContent).toBe(S.REPORTING_MODEL_FACILITY);
    expect(Array.from(document.querySelectorAll('section.wards-detail ul.wards li')).every((l) => (l.textContent ?? '').endsWith(S.REPORTED_BY_FACILITY))).toBe(true);
  });

  test('a ward login keeps its per-ward login state', async () => {
    await renderAt(sessionFragment(), withRegister([facility(FAC_A, { reporting_model: 'WARD' })]));
    await until(() => text().includes('Facilities'));
    expect(document.querySelector('li.facility ul.wards li')?.textContent).toContain(`— ${S.LOGIN_ACTIVE}`);
    expect(text()).not.toContain(S.REPORTED_BY_FACILITY);
  });

  test.each([
    ['no reporting_model', { reporting_model: undefined }],
    ['a reporting_model it does not know', { reporting_model: 'BOTH' }],
    ['a reporter_login it does not know', { reporter_login: 'maybe' }],
    ['a hefamaa_reg_no that is a number', { hefamaa_reg_no: 42 }],
  ])('plant — a row with %s is unreadable, never defaulted', async (_name, over) => {
    const row = facility(FAC_A, over);
    for (const [k, v] of Object.entries(over)) if (v === undefined) delete row[k];
    await renderAt(sessionFragment(), withRegister([row]));
    await until(() => text().includes('Facilities'));
    expect(text()).toContain("This facility's record could not be read.");
  });

  test('a non-empty retention_alert is a caution Notice at the TOP of the register, one per job, in Lagos time', async () => {
    const alert = [
      { job: 'openbed_erase_lapsed_ward_logins', end_time: '2026-09-24T01:37:12Z' },
      { job: 'openbed_prune_ended_auth_sessions', end_time: '2026-09-24T01:27:05Z' },
    ];
    await renderAt(sessionFragment(), withRegister([facility(FAC_A)], { retention_alert: alert }));
    await until(() => text().includes('Facilities'));
    const notes = Array.from(document.querySelectorAll('p.retention-alert'));
    expect(notes.map((n) => n.textContent)).toEqual([
      'A data-retention job did not complete: openbed_erase_lapsed_ward_logins, 24 Sept, 02:37 (Lagos time). Follow the Supabase runbook, 12.5 step 5.',
      'A data-retention job did not complete: openbed_prune_ended_auth_sessions, 24 Sept, 02:27 (Lagos time). Follow the Supabase runbook, 12.5 step 5.',
    ]);
    for (const n of notes) expect(n.classList.contains('notice-caution')).toBe(true);
    // At the top: straight after the heading, before the register's own controls.
    expect(document.querySelector('#app > h1')?.nextElementSibling).toBe(notes[0]);
  });

  test('an empty retention_alert shows no alert; one that cannot be read is never read as empty', async () => {
    await renderAt(sessionFragment(), withRegister([facility(FAC_A)]));
    await until(() => text().includes('Facilities'));
    expect(document.querySelector('p.retention-alert')).toBeNull();
    for (const bad of [null, [{ job: 'x' }], 'none']) {
      await renderAt(sessionFragment(), withRegister([facility(FAC_A)], { retention_alert: bad }));
      await until(() => text().includes(ADMIN_LABELS.fixed.UNRECOGNISED));
      expect(document.querySelector('ul.register'), `a retention_alert of ${JSON.stringify(bad)} was read as nothing wrong`).toBeNull();
    }
  });

  test('the Registration section is prefilled with the saved number, and Save sends it with the FACILITY version', async () => {
    const stub = await openFirst(withRegister([facility(FAC_A, { hefamaa_reg_no: 'HEF/LA/0042' })], {}));
    const input = document.querySelector<HTMLInputElement>('form.record-registration [name="hefamaa_reg_no"]');
    expect(input?.value).toBe('HEF/LA/0042');
    expect(document.querySelector('form.record-registration label')?.firstChild?.textContent).toBe(`${S.HEFAMAA_LABEL} `);
    setInput('record-registration', 'hefamaa_reg_no', 'HEF/LA/0043');
    submit('record-registration');
    await until(() => calls(stub, 'operator_record_registration').length === 1);
    expect(calls(stub, 'operator_record_registration')[0]).toEqual({ p_facility_id: FAC_A, p_expected_version: 4, p_hefamaa_reg_no: 'HEF/LA/0043' });
  });

  test('an emptied field sends null, which clears the number, and the page says "Registration saved."', async () => {
    const stub = await openFirst(
      server({
        operator_register: () => json(200, { server_now: SERVER_NOW, retention_alert: [], facilities: [facility(FAC_A, { hefamaa_reg_no: 'HEF/LA/0042' })] }),
        operator_record_registration: () => json(200, [{ facility_id: FAC_A, version: 5 }]),
      }),
    );
    setInput('record-registration', 'hefamaa_reg_no', '');
    submit('record-registration');
    await until(() => text().includes(S.REGISTRATION_SAVED));
    expect(calls(stub, 'operator_record_registration')[0]?.['p_hefamaa_reg_no']).toBeNull();
    const status = document.querySelector('#app > p.status');
    expect(status?.textContent).toBe('Registration saved.');
    expect(status?.classList.contains('notice-info')).toBe(true);
  });

  test.each([
    ['only spaces', '   '],
    ['a space before it', ' HEF/1'],
    ['a space after it', 'HEF/1 '],
    ['65 characters', 'H'.repeat(65)],
  ])('%s is refused on the page, in its sentence, with focus on the field, and nothing is sent', async (_name, value) => {
    const stub = await openFirst(withRegister([facility(FAC_A)]));
    setInput('record-registration', 'hefamaa_reg_no', value);
    submit('record-registration');
    await until(() => (document.querySelector('form.record-registration p.status')?.textContent ?? '') !== '');
    expect(document.querySelector('form.record-registration p.status')?.textContent).toBe(HEFAMAA_SENTENCE);
    expect(document.activeElement?.getAttribute('name')).toBe('hefamaa_reg_no');
    expect(calls(stub, 'operator_record_registration')).toHaveLength(0);
  });

  test('64 characters, and one with a space inside, are sent', async () => {
    for (const value of ['H'.repeat(64), 'HEF LA 0042']) {
      const stub = await openFirst(withRegister([facility(FAC_A)]));
      setInput('record-registration', 'hefamaa_reg_no', value);
      submit('record-registration');
      await until(() => calls(stub, 'operator_record_registration').length === 1);
      expect(calls(stub, 'operator_record_registration')[0]?.['p_hefamaa_reg_no']).toBe(value);
    }
  });

  test("the server's own refusals: INVALID_ARGUMENT p_hefamaa_reg_no and the column's CHECK both read as the page's sentence", async () => {
    expect(adminMessageFor(400, null, JSON.stringify({ code: 'P0001', message: 'INVALID_ARGUMENT', details: 'p_hefamaa_reg_no' })).sentence).toBe(HEFAMAA_SENTENCE);
    expect(adminMessageFor(400, null, JSON.stringify({ code: '23514', message: 'new row for relation "facility" violates check constraint "facility_hefamaa_reg_no_form"' })).sentence).toBe(HEFAMAA_SENTENCE);
    await openFirst(server({ operator_record_registration: () => json(400, { code: 'P0001', message: 'INVALID_ARGUMENT', details: 'p_hefamaa_reg_no' }) }));
    setInput('record-registration', 'hefamaa_reg_no', 'HEF/1');
    submit('record-registration');
    await until(() => (document.querySelector('form.record-registration p.status')?.textContent ?? '') !== '');
    expect(document.querySelector('form.record-registration p.status')?.textContent).toBe(HEFAMAA_SENTENCE);
  });

  test('VERSION_CONFLICT reloads the facility and says so; the number is never re-sent', async () => {
    const stub = await openFirst(server({ operator_record_registration: () => json(409, { code: 'P0001', message: 'VERSION_CONFLICT', details: 'current_version=5' }) }));
    setInput('record-registration', 'hefamaa_reg_no', 'HEF/1');
    submit('record-registration');
    await until(() => text().includes(ADMIN_LABELS.codes.VERSION_CONFLICT));
    expect(calls(stub, 'operator_record_registration')).toHaveLength(1);
  });

  test('DV-3 — the contact email refusals render the page\'s existing sentence: INVALID_ARGUMENT p_email and the email CHECK', async () => {
    const sentence = ADMIN_LABELS.codes['INVALID_ARGUMENT:p_email'];
    expect(ADMIN_LABELS.constraints.facility_contact_email_form).toBe(sentence);
    for (const body of [
      { code: 'P0001', message: 'INVALID_ARGUMENT', details: 'p_email' },
      { code: '23514', message: 'new row for relation "facility_contact" violates check constraint "facility_contact_email_form"' },
    ]) {
      await openFirst(server({ operator_record_contact: () => json(400, body) }));
      setInput('record-contact', 'email', 'ada@example.invalid');
      submit('record-contact');
      await until(() => (document.querySelector('form.record-contact p.status')?.textContent ?? '') !== '');
      expect(document.querySelector('form.record-contact p.status')?.textContent).toBe(sentence);
    }
  });

  test('DP-5 b 1 — the register-unreachable screen has the Reload button, and it reloads', async () => {
    let n = 0;
    const route = server({
      operator_register: () => {
        n += 1;
        if (n <= 2) throw new TypeError('down');
        return json(200, REGISTER);
      },
    });
    await renderAt(sessionFragment(), route);
    await until(() => text().includes(ADMIN_LABELS.fixed.UNREACHABLE));
    button(S.RELOAD).click();
    await until(() => document.querySelector('ul.register') !== null);
  });

  test.each(['NOT_AN_OPERATOR', 'ACCOUNT_DEACTIVATED'])('DP-5 b 2 — the %s stop screen has Sign out, and it returns to the sign-in', async (code) => {
    await renderAt(sessionFragment(), server({ operator_register: () => json(403, { code: '42501', message: code }) }));
    await until(() => text().includes(S.STOP_HEADING));
    button(S.SIGN_OUT).click();
    expect(document.querySelector('form.signin-request'), 'Sign out did not return to the sign-in').not.toBeNull();
    expect(text()).toContain(S.ACCESS_ORDER);
    expect(text()).not.toContain(S.STOP_HEADING);
  });

  test('DP-5 b 3 and 4 — a contact that could not be READ says so in both sections, never "Nothing was changed"', async () => {
    for (const contactRoute of [() => json(200, { not: 'a contact' }), () => json(400, { code: 'P0001', message: 'SOMETHING_NEW' })]) {
      await openFirst(server({ operator_get_contact: contactRoute }));
      expect(document.querySelector('section.contact-detail p')?.textContent).toBe(S.CONTACT_UNREADABLE);
      expect(document.querySelector('section.agreement-detail p')?.textContent).toBe(S.AGREEMENT_NEEDS_CONTACT);
      expect(text()).not.toContain('Nothing was changed');
    }
  });

  test('DP-5 b 5 — the detail view reads "Listed 20 Sept, 10:00 (Lagos time)", with no bracket inside a bracket', async () => {
    await openFirst(server());
    const lines = Array.from(document.querySelectorAll('section.facility-detail > p')).map((p) => p.textContent ?? '');
    expect(lines).toContain('Listed 20 Sept, 10:00 (Lagos time)');
    expect(text()).not.toContain('((Lagos time))');
    expect(text()).not.toContain('Listed (');
  });

  test('DP-5 b 6 — every facility, contact, agreement and registration field, and both selects, carry autocomplete="off"; the sign-in email keeps email', async () => {
    await openFirst(server({ operator_get_contact: () => json(200, { contact: CONTACT.contact, agreement: null }) }));
    const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('form.operator-form input, form.operator-form select'));
    expect(fields.length, 'the detail view has no operator fields to check').toBeGreaterThanOrEqual(15);
    const off = fields.filter((f) => f.getAttribute('autocomplete') !== 'off').map((f) => f.name);
    expect(off, 'these operator fields let the browser offer the operator\'s own details').toEqual([]);
    await renderAt('', () => json(500, {}));
    expect(document.querySelector<HTMLInputElement>('form.signin-request input[name="email"]')?.getAttribute('autocomplete')).toBe('email');
  });

  test('the HEFAMAA number is never on openbed.ng or the ward console: neither app\'s source names it', () => {
    const src = (dir: string): string =>
      readdirSync(join(REPO_ROOT, dir), { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && /\.(ts|html|css)$/.test(e.name))
        .map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'))
        .join('\n');
    for (const dir of ['apps/public-dashboard/src', 'apps/ward-console/src', 'packages/snapshot/src']) {
      const all = src(dir);
      expect(all.length, `${dir} was read as empty`).toBeGreaterThan(1000);
      expect(all.toLowerCase(), `${dir} names the HEFAMAA number`).not.toContain('hefamaa');
    }
    expect(src('apps/admin/src').toLowerCase(), 'the positive control: admin itself names it').toContain('hefamaa');
  });
});

describe('every refusal has a sentence, and every sentence a refusal', () => {
  const FUNCTIONS = [
    'public.operator_register',
    'public.operator_get_contact',
    'public.operator_create_facility',
    'public.operator_edit_facility',
    'public.operator_add_category',
    'public.operator_record_contact',
    'public.operator_record_agreement',
    'public.operator_set_facility_listed',
    // The ninth (R-2026-09-27-144 DT Bundle 3): the Registration section's write (026).
    'public.operator_record_registration',
    // The tenth (R-2026-09-30-201 GA): the approved reporting model's write (029). Its codes need
    // sentences, both ways, exactly as the nine before it.
    'public.operator_record_reporting_approval',
    'app.assert_operator',
    'app.operator_session',
  ];
  const FORWARD = readdirSync(MIG).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('.down.sql')).sort();

  /**
   * The LATEST definition of `fn`: the last forward migration that creates it, sliced
   * from its CREATE to the close of ITS OWN dollar-quote tag. A slice to the next `$$;`
   * runs on into the functions after it -- these bodies are tagged $FN$, and a DO block's
   * `$$;` further down would be read as the end (found building this test: two of
   * provision_begin's codes were credited to operator_set_facility_listed that way).
   */
  function latestBody(fn: string): string {
    const file = [...FORWARD].reverse().find((f) => readFileSync(join(MIG, f), 'utf8').includes(`CREATE OR REPLACE FUNCTION ${fn}(`));
    if (file === undefined) throw new Error(`${fn} is defined in no forward migration`);
    const src = readFileSync(join(MIG, file), 'utf8');
    const start = src.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`);
    const tag = /AS (\$[A-Za-z_]*\$)/.exec(src.slice(start))?.[1];
    if (tag === undefined) throw new Error(`${fn} in ${file} has no dollar-quoted body`);
    const open = src.indexOf(tag, start);
    const close = src.indexOf(tag, open + tag.length);
    return src.slice(start, close);
  }

  /** Every key a RAISE in those functions produces. The pattern allows digits (MOBILE_NOT_E164). */
  function raisedKeys(): string[] {
    const out = new Set<string>();
    for (const fn of FUNCTIONS) {
      for (const m of latestBody(fn).matchAll(/RAISE EXCEPTION '([A-Z][A-Z0-9_]*)'(?:\s+USING\s+DETAIL\s*=\s*'([a-z_]+)')?/g)) {
        out.add(m[1] === 'INVALID_ARGUMENT' ? `INVALID_ARGUMENT:${m[2] ?? ''}` : (m[1] as string));
      }
    }
    return [...out].sort();
  }

  /**
   * Every CHECK constraint the migrations declare on the three tables the operator
   * writes. Each file is read IN STATEMENT ORDER: a DROP removes a name and a later ADD
   * puts it back. Until R-2026-09-27-144 every ADD in a file was applied before every
   * DROP, so the drop-then-add idiom (DROP CONSTRAINT IF EXISTS x; ADD CONSTRAINT x) --
   * 026's, for its two new CHECKs -- dropped the file's own new constraints from the
   * corpus, and this leg stayed green while tests/db/admin_calls_live.test.ts, over the
   * live catalogue, went red. The plant below holds the order.
   */
  function checkNamesIn(sources: readonly string[]): string[] {
    const out = new Set<string>();
    const re = /(DROP CONSTRAINT (?:IF EXISTS )?|CONSTRAINT\s+)((?:facility|facility_contact|facility_agreement)_[a-z0-9_]+)(\s+CHECK)?/g;
    for (const src of sources) {
      for (const m of src.matchAll(re)) {
        if ((m[1] as string).startsWith('DROP')) out.delete(m[2] as string);
        else if (m[3] !== undefined) out.add(m[2] as string);
      }
    }
    return [...out].sort();
  }
  const checkNames = (): string[] => checkNamesIn(FORWARD.map((f) => readFileSync(join(MIG, f), 'utf8')));

  function coverage(raised: string[], table: string[]): string[] {
    const out: string[] = [];
    for (const c of raised) if (!table.includes(c)) out.push(`${c} can be raised at the admin app and has no sentence`);
    for (const c of table) if (!raised.includes(c)) out.push(`${c} has a sentence and nothing raises it`);
    return out;
  }

  test('the code table covers EXACTLY the codes the ten functions and their two guards can raise', () => {
    const raised = raisedKeys();
    expect(raised.length, 'no codes parsed from the migrations — the checker read nothing').toBeGreaterThan(20);
    expect(raised).toContain('MOBILE_NOT_E164');
    expect(coverage(raised, Object.keys(ADMIN_LABELS.codes).sort())).toEqual([]);
  });

  test('the constraint table covers EXACTLY the CHECK constraints on facility, facility_contact and facility_agreement', () => {
    const names = checkNames();
    expect(names.length, 'no constraints parsed').toBeGreaterThan(5);
    expect(coverage(names, Object.keys(ADMIN_LABELS.constraints).sort())).toEqual([]);
  });

  test('plant — a CHECK dropped and added again in one file is still in the corpus, and one dropped for good is not', () => {
    expect(checkNamesIn([
      'ALTER TABLE app.facility DROP CONSTRAINT IF EXISTS facility_planted_form;\nALTER TABLE app.facility ADD CONSTRAINT facility_planted_form\n    CHECK (true);\n',
    ])).toEqual(['facility_planted_form']);
    expect(checkNamesIn([
      'ALTER TABLE app.facility ADD CONSTRAINT facility_planted_form CHECK (true);\n',
      'ALTER TABLE app.facility DROP CONSTRAINT IF EXISTS facility_planted_form;\n',
    ])).toEqual([]);
  });

  test('plant — a new RAISE with no sentence, and a sentence nothing raises, are both caught', () => {
    const raised = raisedKeys();
    const table = Object.keys(ADMIN_LABELS.codes);
    expect(coverage([...raised, 'FACILITY_ON_FIRE'], table)).toContain('FACILITY_ON_FIRE can be raised at the admin app and has no sentence');
    expect(coverage(raised.filter((c) => c !== 'NO_CATEGORY'), table)).toContain('NO_CATEGORY has a sentence and nothing raises it');
  });

  test('anti-vacuity — the body slice stops at the function’s own tag, so a neighbour’s codes are not credited', () => {
    // provision_begin follows operator_set_facility_listed in 021; its NO_SUCH_WARD must
    // not be read as the listing function's.
    expect(latestBody('public.operator_set_facility_listed')).not.toContain('NO_SUCH_WARD');
    expect(raisedKeys()).not.toContain('NO_SUCH_WARD');
  });
});

describe('the app’s own source', () => {
  const SRC = join(REPO_ROOT, 'apps', 'admin', 'src');
  const source = (): string => readdirSync(SRC).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(join(SRC, f), 'utf8')).join('\n');
  const storageViolations = (code: string): string[] =>
    ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie'].filter((api) => code.includes(api));

  test('real admin source stores nothing client-side (BP-3)', () => {
    expect(source().length).toBeGreaterThan(1000);
    // The header comment names the four APIs to say none is used; comments are removed first.
    const code = source().replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(storageViolations(code)).toEqual([]);
  });

  test('plant — a sessionStorage write is caught', () => {
    expect(storageViolations("sessionStorage.setItem('k', 'v');")).toEqual(['sessionStorage']);
  });

  test('every button is a 44px tap target, from a stylesheet file, never an inline style', () => {
    const css = readFileSync(join(REPO_ROOT, 'apps', 'admin', 'src', 'style.css'), 'utf8');
    const rule = /(^|\n)button\s*\{([^}]*)\}/.exec(css)?.[2] ?? '';
    expect(Number(/min-height:\s*(\d+)px/.exec(rule)?.[1] ?? 0)).toBeGreaterThanOrEqual(44);
    expect(Number(/min-width:\s*(\d+)px/.exec(rule)?.[1] ?? 0)).toBeGreaterThanOrEqual(44);
    const html = readFileSync(join(REPO_ROOT, 'apps', 'admin', 'index.html'), 'utf8');
    expect(html).not.toMatch(/<style/i);
    expect(readFileSync(join(SRC, 'main.ts'), 'utf8')).toContain("import './style.css';");
  });
});

/**
 * R-2026-10-02-FF FF-2 e: A RENEWAL THAT IS ONLY "NOT NOW" KEEPS THE OPERATOR'S SESSION. Admin has no fallback origin, but it gets the
 * holder's classification: a refresh that answers 503 does not end the session, and the operator is told so, on the page, in
 * one sentence, at each of the places admin handles an ended session (post, render, guarded, form).
 *
 * post() RETHROWS RenewalUnavailableError. Had it turned it into `unreachable`, read() would have retried it after 300-600 ms,
 * which is the automatic retry the holder forbids; the refresh endpoint being asked EXACTLY ONCE is what discriminates.
 */
describe('a renewal that is only "not now" keeps the operator\'s session (R-2026-10-02-FF FF-2 e)', () => {
  const refresh503: Route = (url) => (url.includes('/auth/v1/token') ? json(503, { msg: 'unavailable' }) : json(500, { message: 'unexpected call' }));
  const tokenCalls = (stub: ReturnType<typeof vi.fn>): number => stub.mock.calls.filter(([u]) => String(u).includes('/auth/v1/token')).length;

  test('plant — render(): the register load with a refresh that says 503 shows the kept-session sentence, sends nothing else, and does not retry', async () => {
    const stub = await renderAt(sessionFragment(20), refresh503);
    await until(() => text().includes(ADMIN_LABELS.screens.RENEWAL_UNAVAILABLE));
    await new Promise((r) => setTimeout(r, 900)); // longer than read()'s 300-600 ms retry would take
    expect(tokenCalls(stub), 'the refresh was asked more than once: the renewal failure became a retry').toBe(1);
    expect(calls(stub, 'operator_register').length, 'a call was sent with a token the holder would not keep').toBe(0);
    expect(text(), 'a kept session was shown as signed out').not.toContain(ADMIN_LABELS.screens.SIGNED_OUT);
    expect(ADMIN_LABELS.screens.RENEWAL_UNAVAILABLE).toBe('Your sign-in could not be renewed just now. Your sign-in is kept. Wait one minute, then try again.');
  });

  /** A register loaded with 65 s on the token, then the clock moved so the token has about 25 s: inside what the holder will keep. */
  async function loadedThenSpent(over: Record<string, Route> = {}): Promise<ReturnType<typeof vi.fn>> {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    const stub = await renderAt(sessionFragment(65), (url, init) => (url.includes('/auth/v1/token') ? json(503, { msg: 'unavailable' }) : server(over)(url, init)));
    await until(() => text().includes('Facilities'));
    vi.setSystemTime(Date.now() + 40_000);
    return stub;
  }

  test('plant — a form: a write with a refresh that says 503 shows the sentence under the form, sends no write, and keeps the page', async () => {
    const stub = await loadedThenSpent();
    button('New facility').click();
    await until(() => document.querySelector('form.create-facility') !== null);
    fillFacility('create-facility');
    submit('create-facility');
    await until(() => (document.querySelector('form.create-facility p.status')?.textContent ?? '') !== '');
    expect(document.querySelector('form.create-facility p.status')?.textContent).toBe(ADMIN_LABELS.screens.RENEWAL_UNAVAILABLE);
    expect(calls(stub, 'operator_create_facility').length, 'a write was sent with a token the holder would not keep').toBe(0);
    expect(text(), 'a kept session was shown as signed out').not.toContain(ADMIN_LABELS.screens.SIGNED_OUT);
  });

  test('plant — a view load started from a button (guarded): the sentence replaces the view, and the session is kept', async () => {
    const stub = await loadedThenSpent();
    button(ADMIN_LABELS.screens.RELOAD).click();
    await until(() => text().includes(ADMIN_LABELS.screens.RENEWAL_UNAVAILABLE));
    expect(text(), 'a kept session was shown as signed out').not.toContain(ADMIN_LABELS.screens.SIGNED_OUT);
    expect(calls(stub, 'operator_register').length, 'only the first load sent the register').toBe(1);
  });

  test('control — a REFUSED refresh (a 400) still signs the operator out', async () => {
    await renderAt(sessionFragment(20), (url) => (url.includes('/auth/v1/token') ? json(400, { error_code: 'validation_failed', msg: 'Refresh token is not valid' }) : json(500, {})));
    await until(() => text().includes(ADMIN_LABELS.screens.SIGNED_OUT));
    expect(text()).not.toContain(ADMIN_LABELS.screens.RENEWAL_UNAVAILABLE);
  });
});

/**
 * R-2026-10-02-FG FG-5 (-183): "Try again" for a kept session, READS ONLY. The operator's only way forward from the
 * kept-session sentence used to be a reload, which ends the session FF-2 had just kept. guarded()'s callers and what
 * each thunk is: the register's Reload, the loader's own Reload, the two Back buttons and render()'s catch re-run
 * loadRegister (reads); the Open button re-runs openFacility (a read); and the confirmed public-phone edit, the one
 * WRITE, re-opens the facility and never re-sends the edit.
 */
describe('a kept session has a Try again, and it never re-sends a write (FG-5)', () => {
  const SRC = join(REPO_ROOT, 'apps', 'admin', 'src');
  function renewedBody(): Record<string, unknown> {
    const now = Math.floor(Date.now() / 1000);
    const access = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: '11111111-1111-4111-8111-111111111111', session_id: '22222222-2222-4222-8222-renewed00000', exp: now + 3600, iat: now, role: 'authenticated', email: 'operator@example.invalid' })}.sig`;
    return { access_token: access, refresh_token: 'r-renewed', expires_in: 3600, expires_at: now + 3600, token_type: 'bearer' };
  }
  /** One router whose refresh answers by MODE: 'down' is a 503 (not now), 'ok' is a renewed session. Everything else is the normal server. */
  function modal(initial: 'ok' | 'down', over: Record<string, Route> = {}): { route: Route; mode(m: 'ok' | 'down'): void } {
    let m = initial;
    const normal = server(over);
    return {
      route: (url, init) => (url.includes('/auth/v1/token') ? (m === 'ok' ? json(200, renewedBody()) : json(503, { msg: 'unavailable' })) : normal(url, init)),
      mode: (next) => { m = next; },
    };
  }
  const tryAgain = (): HTMLButtonElement => button(ADMIN_LABELS.screens.TRY_AGAIN);
  const registerCalls = (stub: ReturnType<typeof vi.fn>): number => calls(stub, 'operator_register').length;
  const cards = (): number => document.querySelectorAll('li.facility').length;

  test('plant — render(): the kept-session screen has a Try again that re-runs the register load with the same holder', async () => {
    const r = modal('down');
    const stub = await renderAt(sessionFragment(20), r.route);
    await until(() => document.querySelector('button.primary') !== null && text().includes(ADMIN_LABELS.screens.RENEWAL_UNAVAILABLE));
    expect(tryAgain().className, "Try again is the design system's primary button").toBe('primary');
    expect(tryAgain().type).toBe('button');
    expect(registerCalls(stub), 'nothing is sent with a token the holder would not keep').toBe(0);
    r.mode('ok');
    tryAgain().click();
    await until(() => registerCalls(stub) === 1 && cards() > 0);
    expect(text(), 'Try again signed the operator out').not.toContain(ADMIN_LABELS.screens.SIGNED_OUT);
  });

  test('plant — guarded(): the Reload that meets a kept-session failure shows Try again, which re-runs its own loader', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    const r = modal('ok');
    const stub = await renderAt(sessionFragment(65), r.route);
    await until(() => registerCalls(stub) === 1 && cards() > 0);
    r.mode('down');
    vi.setSystemTime(Date.now() + 40_000); // about 25 s left on the token: inside what the holder will keep
    button(ADMIN_LABELS.screens.RELOAD).click();
    await until(() => text().includes(ADMIN_LABELS.screens.RENEWAL_UNAVAILABLE) && document.querySelector('button.primary') !== null);
    expect(registerCalls(stub), 'the Reload sent a register call with a spent token').toBe(1);
    r.mode('ok');
    tryAgain().click();
    await until(() => registerCalls(stub) === 2 && cards() > 0);
  });

  test('plant — the confirmed public-phone edit, a WRITE: its Try again re-opens the facility and NEVER re-sends the edit', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    const r = modal('ok', { operator_edit_facility: () => json(200, [{ facility_id: FAC_A, version: 5 }]) });
    const stub = await renderAt(sessionFragment(65), r.route);
    await until(() => registerCalls(stub) === 1 && cards() > 0);
    button('Open').click();
    await until(() => document.querySelector('form.edit-facility') !== null);
    setInput('edit-facility', 'phone', '0800 000 0404');
    submit('edit-facility');
    await until(() => document.querySelector<HTMLElement>('div.phone-confirm')?.hidden === false);
    r.mode('down');
    vi.setSystemTime(Date.now() + 40_000);
    button(ADMIN_LABELS.screens.CONFIRM_PHONE).click();
    await until(() => text().includes(ADMIN_LABELS.screens.RENEWAL_UNAVAILABLE) && document.querySelector('button.primary') !== null);
    expect(calls(stub, 'operator_edit_facility'), 'the edit was sent with a token the holder would not keep').toHaveLength(0);
    const reads = registerCalls(stub);
    r.mode('ok');
    tryAgain().click();
    await until(() => registerCalls(stub) === reads + 1 && document.querySelector('form.edit-facility') !== null);
    expect(calls(stub, 'operator_edit_facility'), 'Try again RE-SENT the edit: a write must never be re-sent from here').toHaveLength(0);
  });

  test('plant — no Try again calls location.reload (the source holds no reload call at all)', () => {
    const src = readFileSync(join(SRC, 'main.ts'), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(src, 'admin calls location.reload').not.toMatch(/location\s*\.\s*reload|\.reload\s*\(/);
  });
});

describe('the sign-in request', () => {
  test('the request carries create_user:false, returns to this origin, and says the same words for 200, 422, 429 and 500', async () => {
    const said: string[] = [];
    for (const status of [200, 422, 429, 500]) {
      const stub = await renderAt('', (url) => (url.includes('/auth/v1/otp') ? json(status, {}) : json(500, {})));
      await until(() => document.querySelector('form.signin-request') !== null);
      setInput('signin-request', 'email', 'someone@example.invalid');
      submit('signin-request');
      await until(() => (document.querySelector('form.signin-request p.status')?.textContent ?? '') !== '');
      said.push(document.querySelector('form.signin-request p.status')?.textContent ?? '');
      const [url, init] = stub.mock.calls.find(([u]) => String(u).includes('/auth/v1/otp')) ?? [];
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({ email: 'someone@example.invalid', create_user: false });
      expect(decodeURIComponent(String(url))).toContain(`redirect_to=${window.location.origin}/`);
    }
    expect(new Set(said).size).toBe(1);
    expect(said[0]).toBe(ADMIN_LABELS.screens.REQUEST_ANSWERED);
  });

  // R-2026-10-02-FF FF-3 c. Only the Worker's OWN marker earns its sentence; every other 429 is Supabase's, per-USER, and
  // reveals the address, so it stays in the one flat answer the test above holds (200, 422, 429 and 500, all unmarked).
  test("the Worker's own `limited` 429 shows its own sentence as a caution Notice and is sent exactly once", async () => {
    const stub = await renderAt('', (url) => (url.includes('/auth/v1/otp') ? json(429, { message: 'rate limited by the OpenBed proxy' }, { 'x-openbed-proxy': 'limited' }) : json(500, {})));
    await until(() => document.querySelector('form.signin-request') !== null);
    setInput('signin-request', 'email', 'someone@example.invalid');
    submit('signin-request');
    await until(() => (document.querySelector('form.signin-request p.status')?.textContent ?? '') !== '');
    expect(document.querySelector('form.signin-request p.status')?.textContent).toBe(ADMIN_LABELS.screens.REQUEST_LIMITED);
    expect(ADMIN_LABELS.screens.REQUEST_LIMITED).toBe('Too many sign-in links were asked for from this network just now. Wait one minute, then ask again.');
    expect(document.querySelector('form.signin-request p.status')?.classList.contains('notice-caution')).toBe(true);
    expect(stub.mock.calls.filter(([u]) => String(u).includes('/auth/v1/otp')).length, 'a limited request was retried').toBe(1);
  });

  test('the signed-out page names the Access order before asking for a link', async () => {
    await renderAt('', () => json(500, {}));
    await until(() => document.querySelector('form.signin-request') !== null);
    expect(text()).toContain(ADMIN_LABELS.screens.ACCESS_ORDER);
  });
});

describe('029 — the approved reporting model: four states, the null cell, and the form (R-2026-09-30-201 GA; ruling FX P2)', () => {
  const S = ADMIN_LABELS.screens;
  const C = ADMIN_LABELS.codes;
  const withRegister = (facilities: Record<string, unknown>[], over: Record<string, Route> = {}) =>
    server({ operator_register: () => json(200, { server_now: SERVER_NOW, retention_alert: [], facilities }), ...over });
  async function openFirst(route: Route) {
    const stub = await renderAt(sessionFragment(), route);
    await until(() => text().includes('Facilities'));
    button('Open').click();
    await until(() => document.querySelector('section.approval-detail') !== null);
    return stub;
  }
  const FAC = 'one login for the whole facility';
  const WARD = 'one login per ward';
  const approved = (model: 'FACILITY' | 'WARD', state: string, extra: Record<string, unknown> = {}) => ({
    approved_model: model, approved_on: '2026-09-15', reporting_approval_state: state, ...extra,
  });

  // The design report's section 6, word for word. A literal here and not the label table, so a
  // reworded sentence reds this file instead of passing through its own source.
  const STATES: [string, Record<string, unknown>, string, string, boolean][] = [
    [
      'NOT_YET_PROVISIONED, whole facility',
      approved('FACILITY', 'NOT_YET_PROVISIONED', { reporting_model: 'NONE' }),
      `Approved: ${FAC}. Not set up yet.`,
      `This facility approved ${FAC} on 2026-09-15. That login is not set up yet.`,
      false,
    ],
    [
      'NOT_YET_PROVISIONED, per ward',
      approved('WARD', 'NOT_YET_PROVISIONED', { reporting_model: 'NONE' }),
      `Approved: ${WARD}. Not set up yet.`,
      `This facility approved ${WARD} on 2026-09-15. No ward login is set up yet.`,
      false,
    ],
    [
      'APPROVAL_NOT_RECORDED',
      { reporting_model: 'WARD', approved_model: null, approved_on: null, reporting_approval_state: 'APPROVAL_NOT_RECORDED' },
      'Logins are active. No approved reporting model is on file.',
      "This facility has active logins, but no approved reporting model is recorded. Record it from the facility's signed Schedule 1.",
      true,
    ],
    [
      'MATCHES, per ward',
      approved('WARD', 'MATCHES', { reporting_model: 'WARD' }),
      `Logins match the approved model: ${WARD}.`,
      `The active logins match what the facility approved on 2026-09-15: ${WARD}.`,
      false,
    ],
    [
      'MATCHES, whole facility',
      approved('FACILITY', 'MATCHES', { reporting_model: 'FACILITY', reporter_login: 'active' }),
      `Logins match the approved model: ${FAC}.`,
      `The active logins match what the facility approved on 2026-09-15: ${FAC}.`,
      false,
    ],
    [
      'MISMATCH',
      approved('FACILITY', 'MISMATCH', { reporting_model: 'WARD' }),
      `Logins do not match the approved model. Approved: ${FAC}. Active: ${WARD}.`,
      `The active logins do not match what the facility approved on 2026-09-15. Approved: ${FAC}. Active: ${WARD}. Do not add logins until this is resolved.`,
      true,
    ],
    [
      'null: no approval and no login',
      { reporting_model: 'NONE', approved_model: null, approved_on: null, reporting_approval_state: null },
      'No approved reporting model is on file yet.',
      "No reporting model is approved for this facility yet. Record it from the facility's signed Schedule 1 before any login is set up.",
      false,
    ],
  ];

  test.each(STATES)('the register line for %s reads the sentence, and is a caution only where the operator must act', async (_name, over, registerLine, _detail, caution) => {
    await renderAt(sessionFragment(), withRegister([facility(FAC_A, over)]));
    await until(() => text().includes('Facilities'));
    const line = document.querySelector('li.facility .reporting-approval');
    expect(line?.textContent).toBe(registerLine);
    expect(line?.classList.contains('notice-caution'), `the caution tone is wrong for: ${registerLine}`).toBe(caution);
    // The model line that was already there is untouched.
    expect(document.querySelector('li.facility .reporting-model')?.textContent).toBe(
      { FACILITY: S.REPORTING_MODEL_FACILITY, WARD: S.REPORTING_MODEL_WARD, NONE: S.REPORTING_MODEL_NONE }[over['reporting_model'] as 'FACILITY' | 'WARD' | 'NONE'],
    );
  });

  test.each(STATES)('the detail view for %s reads the sentence, and the form is offered under a recorded agreement', async (_name, over, _register, detailLine, caution) => {
    await openFirst(withRegister([facility(FAC_A, over)]));
    const line = document.querySelector('section.approval-detail > p');
    expect(line?.textContent).toBe(detailLine);
    expect(line?.classList.contains('notice-caution')).toBe(caution);
    expect(document.querySelector('section.approval-detail h2')?.textContent).toBe(S.APPROVAL_HEADING);
    expect(document.querySelector('section.approval-detail form.record-reporting-approval'), 'no approval form under a recorded agreement').not.toBeNull();
  });

  test('a withdrawn facility shows the withdrawn line only in the register, and the withdrawn sentence with NO form in the detail view', async () => {
    await renderAt(sessionFragment(), withRegister([facility(FAC_A, { agreement_state: 'withdrawn', ...approved('WARD', 'MATCHES') })]));
    await until(() => text().includes('Facilities'));
    expect(document.querySelector('li.facility .reporting-approval'), 'a withdrawn facility shows an approval line in the register').toBeNull();
    expect(Array.from(document.querySelectorAll('li.facility .warning')).map((n) => n.textContent)).toContain(S.WITHDRAWN_WARNING);
    button('Open').click();
    await until(() => document.querySelector('section.approval-detail') !== null);
    expect(document.querySelector('section.approval-detail > p')?.textContent).toBe('This facility has withdrawn. Its approved reporting model stays on file for the record.');
    expect(document.querySelector('form.record-reporting-approval')).toBeNull();
  });

  test('a facility with no agreement says to record it first, and offers no approval form', async () => {
    await openFirst(withRegister([facility(FAC_A, { agreement_state: 'none', reporting_model: 'NONE', approved_model: null, approved_on: null, reporting_approval_state: null })]));
    expect(document.querySelector('section.approval-detail > p')?.textContent).toBe('Record the agreement first. The approved reporting model is recorded under it.');
    expect(document.querySelector('form.record-reporting-approval')).toBeNull();
  });

  test.each<[string, Record<string, unknown>]>([
    ['approved_model absent (a database at 028)', { approved_model: undefined }],
    ['approved_on absent', { approved_on: undefined }],
    ['reporting_approval_state absent', { reporting_approval_state: undefined }],
    ['an approved_model it does not know', { approved_model: 'BOTH' }],
    ['an approved_model in the wrong case', { approved_model: 'ward' }],
    ['an approved_on that is not a date string', { approved_on: 'yesterday' }],
    ['an approved_on that is a number', { approved_on: 20260915 }],
    ['an approved_on with a time on it', { approved_on: '2026-09-15T00:00:00Z' }],
    ['a state it does not know', { reporting_approval_state: 'MAYBE' }],
    ['a state in the wrong case', { reporting_approval_state: 'matches' }],
    ['a state that compares against an approval, with none', { approved_model: null, approved_on: null, reporting_approval_state: 'MATCHES' }],
    ['APPROVAL_NOT_RECORDED beside an approval', { reporting_approval_state: 'APPROVAL_NOT_RECORDED' }],
    ['a null state beside an approval', { reporting_approval_state: null }],
    ['a model with no date', { approved_on: null }],
    ['a date with no model', { approved_model: null, reporting_approval_state: null }],
  ])('plant — a row with %s is unreadable, never defaulted', async (_name, over) => {
    const row = facility(FAC_A, { ...approved('WARD', 'MATCHES'), ...over });
    for (const [k, v] of Object.entries(over)) if (v === undefined) delete row[k];
    await renderAt(sessionFragment(), withRegister([row]));
    await until(() => text().includes('Facilities'));
    expect(text()).toContain("This facility's record could not be read.");
    expect(document.querySelector('li.facility .reporting-approval'), 'an unreadable row shows an approval line').toBeNull();
  });

  test('the form sends exactly the four parameters, with the title trimmed and no version, and the page says it was recorded', async () => {
    // The register is read at page load and again when the facility opens, so the "before" state
    // holds for two reads; the re-read after the write is the third.
    let reads = 0;
    const stub = await openFirst(
      server({
        operator_register: () => {
          reads += 1;
          return json(200, { server_now: SERVER_NOW, retention_alert: [], facilities: [facility(FAC_A, reads <= 2 ? { reporting_model: 'WARD', approved_model: null, approved_on: null, reporting_approval_state: 'APPROVAL_NOT_RECORDED' } : approved('WARD', 'MATCHES'))] });
        },
        operator_record_reporting_approval: () => json(200, [{ facility_id: FAC_A, recorded: true }]),
      }),
    );
    expect(document.querySelector('section.approval-detail > p')?.textContent).toBe(
      "This facility has active logins, but no approved reporting model is recorded. Record it from the facility's signed Schedule 1.",
    );
    setInput('record-reporting-approval', 'model', 'WARD');
    setInput('record-reporting-approval', 'approved_on', '2026-09-15');
    setInput('record-reporting-approval', 'approved_by_role', '  Medical Director ');
    submit('record-reporting-approval');
    await until(() => text().includes(S.APPROVAL_SAVED));
    expect(calls(stub, 'operator_record_reporting_approval')).toEqual([
      { p_facility_id: FAC_A, p_model: 'WARD', p_approved_on: '2026-09-15', p_approved_by_role: 'Medical Director' },
    ]);
    const status = document.querySelector('#app > p.status');
    expect(status?.textContent).toBe('Reporting approval recorded.');
    expect(status?.classList.contains('notice-info')).toBe(true);
    // The sentence follows the re-read register, and the form is empty again, ready for a correction.
    expect(document.querySelector('section.approval-detail > p')?.textContent).toBe(`The active logins match what the facility approved on 2026-09-15: ${WARD}.`);
    expect(document.querySelector<HTMLSelectElement>('form.record-reporting-approval [name="model"]')?.value).toBe('');
    expect(document.querySelector<HTMLInputElement>('form.record-reporting-approval [name="approved_on"]')?.value).toBe('');
  });

  test('a blank title is sent as null', async () => {
    const stub = await openFirst(withRegister([facility(FAC_A)], { operator_record_reporting_approval: () => json(200, [{ facility_id: FAC_A, recorded: true }]) }));
    setInput('record-reporting-approval', 'model', 'FACILITY');
    setInput('record-reporting-approval', 'approved_on', '2026-09-16');
    submit('record-reporting-approval');
    await until(() => calls(stub, 'operator_record_reporting_approval').length === 1);
    expect(calls(stub, 'operator_record_reporting_approval')[0]).toEqual({ p_facility_id: FAC_A, p_model: 'FACILITY', p_approved_on: '2026-09-16', p_approved_by_role: null });
  });

  test.each<[string, [string, string, string], string, string]>([
    ['no model chosen', ['', '2026-09-15', ''], C['INVALID_ARGUMENT:p_model'] as string, 'model'],
    ['no date', ['WARD', '', ''], C['INVALID_ARGUMENT:p_approved_on'] as string, 'approved_on'],
    ['a title of 65 characters', ['WARD', '2026-09-15', 'x'.repeat(65)], C['INVALID_ARGUMENT:p_approved_by_role'] as string, 'approved_by_role'],
  ])('%s is refused on the page, in its sentence and the caution tone, with focus on the field, and nothing is sent', async (_name, [model, on, title], sentence, field) => {
    const stub = await openFirst(withRegister([facility(FAC_A)]));
    setInput('record-reporting-approval', 'model', model);
    setInput('record-reporting-approval', 'approved_on', on);
    setInput('record-reporting-approval', 'approved_by_role', title);
    submit('record-reporting-approval');
    await until(() => (document.querySelector('form.record-reporting-approval p.status')?.textContent ?? '') !== '');
    const status = document.querySelector('form.record-reporting-approval p.status');
    expect(status?.textContent).toBe(sentence);
    expect(status?.classList.contains('notice-caution')).toBe(true);
    expect(document.activeElement?.getAttribute('name')).toBe(field);
    expect(calls(stub, 'operator_record_reporting_approval')).toHaveLength(0);
  });

  test('a title of exactly 64 characters is sent', async () => {
    const stub = await openFirst(withRegister([facility(FAC_A)], { operator_record_reporting_approval: () => json(200, [{ facility_id: FAC_A, recorded: true }]) }));
    setInput('record-reporting-approval', 'model', 'WARD');
    setInput('record-reporting-approval', 'approved_on', '2026-09-15');
    setInput('record-reporting-approval', 'approved_by_role', 'x'.repeat(64));
    submit('record-reporting-approval');
    await until(() => calls(stub, 'operator_record_reporting_approval').length === 1);
    expect(calls(stub, 'operator_record_reporting_approval')[0]?.['p_approved_by_role']).toBe('x'.repeat(64));
  });

  test.each([
    ['APPROVAL_DATE_IN_FUTURE', 'The approval date cannot be after today in Lagos.'],
    ['APPROVAL_BEFORE_AGREEMENT', 'The approval date cannot be earlier than the date the agreement was accepted.'],
  ])("the server's %s refusal reads as the page's sentence, in the caution tone, and the form keeps what was typed", async (code, sentence) => {
    expect(C[code as keyof typeof C]).toBe(sentence);
    const stub = await openFirst(withRegister([facility(FAC_A)], { operator_record_reporting_approval: () => json(400, { code: 'P0001', message: code }) }));
    setInput('record-reporting-approval', 'model', 'WARD');
    setInput('record-reporting-approval', 'approved_on', '2026-09-15');
    submit('record-reporting-approval');
    await until(() => (document.querySelector('form.record-reporting-approval p.status')?.textContent ?? '') !== '');
    const status = document.querySelector('form.record-reporting-approval p.status');
    expect(status?.textContent).toBe(sentence);
    expect(status?.classList.contains('notice-caution')).toBe(true);
    expect(calls(stub, 'operator_record_reporting_approval')).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>('form.record-reporting-approval [name="approved_on"]')?.value, 'a refused form discarded the operator\'s input').toBe('2026-09-15');
  });

  test('a dropped answer is NEVER re-sent: the form says it could not reach the server, and one request was made', async () => {
    const stub = await openFirst(withRegister([facility(FAC_A)], { operator_record_reporting_approval: () => { throw new TypeError('down'); } }));
    setInput('record-reporting-approval', 'model', 'WARD');
    setInput('record-reporting-approval', 'approved_on', '2026-09-15');
    submit('record-reporting-approval');
    await until(() => (document.querySelector('form.record-reporting-approval p.status')?.textContent ?? '') !== '');
    expect(document.querySelector('form.record-reporting-approval p.status')?.textContent).toBe(ADMIN_LABELS.fixed.UNREACHABLE);
    expect(calls(stub, 'operator_record_reporting_approval')).toHaveLength(1);
  });

  test('the model select offers exactly the two models, in the register\'s words, after the empty choice', async () => {
    await openFirst(withRegister([facility(FAC_A)]));
    const options = Array.from(document.querySelectorAll('form.record-reporting-approval [name="model"] option')).map((o) => [(o as HTMLOptionElement).value, o.textContent]);
    expect(options).toEqual([['', 'Choose'], ['FACILITY', S.REPORTING_MODEL_FACILITY], ['WARD', S.REPORTING_MODEL_WARD]]);
    expect(document.querySelector('form.record-reporting-approval [name="version"]'), 'the approval form carries a version field').toBeNull();
  });
});
