// @vitest-environment jsdom
/// <reference lib="dom" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { REPO_ROOT } from './_scratch.js';
import { noticeCssViolations, toneViolations, type Tone } from './_design.js';
import ADMIN_LABELS from '../../packages/labels/admin-labels.json';
import { lagosTime } from '../../packages/snapshot/src/index.js';

/**
 * ADMIN'S DESIGN PASS, AND WHAT IT MUST NOT CHANGE (the design-pass kickoff, D3;
 * R-2026-09-27-139 DO-4, DO-5).
 *
 * The design guards shared with the other apps (viewport, tokens, self-hosted fonts, no
 * inline style, no Google font host) are tests/compliance/bundle_guards.test.ts's, and the
 * favicon's is tests/compliance/design_package.test.ts's. This file holds what is admin's
 * own:
 *
 *   THE HEADER -- the mark, the live-text lockup and "Platform admin" beside it.
 *   THE TONES -- every status line and every refusal is a Notice in the design system's
 *     tone, words unchanged: info for what went through, caution for every refusal or
 *     failure; every p.status is announced (role="status"). The register's warnings are
 *     caution Notices. The Notice CSS is the design system's, and admin has no green.
 *   ITS OWN VALIDATION (DO-4 c, DO-5) -- every operator form sets noValidate and answers a
 *     value it cannot send with its own sentence, focused on the field to fix, sending
 *     nothing. The one check only the browser made -- an email field's form -- is made by
 *     the form itself, so nothing it caught is let through. The sign-in form keeps the
 *     browser's validation, as the ward console's does (-134 DJ).
 *   AN UPDATE CHANGES ONLY WHAT IT UPDATED (DO-4 d; the ward console's -133 DI-1) -- a
 *     write in one section leaves every other form's node, unsent input and Notice where
 *     it was; a form holding unsent input keeps the version it was filled from, and one
 *     holding none moves to the newest.
 *   THE WORDS "Listed" / "Not listed", NEVER "Paused" (BC-6).
 *   THE SIZES -- 44 px controls and the 960 px table threshold, read as LITERAL px from
 *     apps/admin/src/style.css, because a var() cannot be compared here.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - what a real browser PAINTS: the cards below 960 px and the table at 960 px and wider.
 *     jsdom lays nothing out. The screenshots (.design-screens/D3/, for Cowork) and the
 *     founder's browser check after the deploy are that reading.
 *   - that no OTHER word changed. The sentences a server answer can produce are asserted
 *     here, the exact-text legs in tests/compliance/admin_render.test.ts pass unchanged,
 *     and the diff of apps/admin/src/main.ts is the rest of the proof, the reviewer's read.
 *   - the browser's own validation bubble on the sign-in form. jsdom has no bubble; this
 *     file asserts only that the form keeps the browser's validation, so an empty address
 *     is never sent. The bubble is a screenshot (DO-5 d).
 */

const SRC = join(REPO_ROOT, 'apps', 'admin', 'src');
const SERVER_NOW = '2026-09-24T12:00:00.000Z';
const FAC_A = '0a000000-0000-4000-8000-00000000000a';
const FAC_B = '0b000000-0000-4000-8000-00000000000b';
const W = ADMIN_LABELS.screens;
const F = ADMIN_LABELS.fixed;
const C = ADMIN_LABELS.codes as Record<string, string>;

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
    email: 'operator@example.invalid',
  })}.sig`;
  return `#access_token=${token}&refresh_token=r1&expires_at=${now + 3600}&token_type=bearer`;
}

const ward = (category: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  category,
  offering: 'OFFERED',
  monitoring_state: 'ACTIVE',
  bed_count: 3,
  accepting: true,
  updated_at: '2026-09-24T11:54:00.000Z',
  has_account: true,
  provisioning_incomplete: false,
  ...over,
});

const facility = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  facility_id: id,
  name: 'Example General Hospital',
  lga: 'Lagos Island',
  state: 'Lagos',
  lat: 6.45,
  lng: 3.4,
  public_phone_e164: '+2348000000303',
  address: '12 Example Street, Lagos Island',
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
});


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
  contact: { full_name: 'Ada Example', job_title: 'Medical Director', email: 'ada@example.invalid', mobile_e164: '+2348000007373', sms_opt_in: true, unreachable_since: null, version: 2 },
  agreement: { accepted_on: '2026-09-01', version: 'v1', signatory_role: 'Medical Director', withdrawn_on: null },
};
const NO_AGREEMENT = { ...CONTACT, agreement: null };

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const refusal = (code: string): Response => json(400, { code: 'P0001', message: code });

/**
 * A server whose register is `facilities()` AT EACH READ, so a test can change the saved
 * state between reads; other calls answer from `over` by RPC name.
 */
function server(facilities: () => Record<string, unknown>[], over: Record<string, Route> = {}, contact: () => unknown = () => CONTACT): Route {
  return (url, init) => {
    const fn = /\/rpc\/([a-z_]+)$/.exec(url)?.[1] ?? '';
    const o = over[fn];
    if (o !== undefined) return o(url, init);
    if (fn === 'operator_register') return json(200, { server_now: SERVER_NOW, retention_alert: [], facilities: facilities() });
    if (fn === 'operator_get_contact') return json(200, contact());
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

const text = (): string => document.body.textContent ?? '';

async function until(cond: () => boolean, deadlineMs = 5000): Promise<void> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`the page never reached the expected state. It reads: ${text().slice(0, 400)}`);
}

/** Lets every pending answer and re-read finish. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 0));
};

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

function input(formClass: string, name: string): HTMLInputElement {
  const i = document.querySelector<HTMLInputElement>(`form.${formClass} [name="${name}"]`);
  if (i === null) throw new Error(`no input ${name} in form.${formClass}`);
  return i;
}

function setInput(formClass: string, name: string, value: string): void {
  const i = input(formClass, name);
  i.value = value;
  i.dispatchEvent(new Event('input', { bubbles: true }));
}

function submit(formClass: string): void {
  const f = document.querySelector<HTMLFormElement>(`form.${formClass}`);
  if (f === null) throw new Error(`no form.${formClass}`);
  f.requestSubmit();
}

const formStatus = (formClass: string): HTMLParagraphElement | null => document.querySelector(`form.${formClass} p.status`);
const pageStatus = (): HTMLParagraphElement | null => document.querySelector('#app > p.status');

/** Facility A's view, opened from the register. */
async function openA(route: Route) {
  const stub = await renderAt(sessionFragment(), route);
  await until(() => document.querySelector('li.facility') !== null);
  const card = document.querySelector<HTMLElement>(`li.facility[data-facility-id="${FAC_A}"]`);
  if (card === null) throw new Error('facility A is not on the register');
  (card.querySelector('button') as HTMLButtonElement).click();
  await until(() => document.querySelector('form.edit-facility') !== null);
  return stub;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------------- header

/** Why index.html's header is not the D3 lockup: the mark, "Open" "Bed" as live text, "Platform admin". */
export function headerViolations(html: string): string[] {
  const bare = html.replace(/<!--[\s\S]*?-->/g, '');
  const header = /<header class="site-header">([\s\S]*?)<\/header>/.exec(bare)?.[1];
  if (header === undefined) return ['index.html has no <header class="site-header">'];
  const out: string[] = [];
  if (!/<img class="mark" src="[^"]*openbed-mark\.svg" width="28" height="28" alt="" \/>/.test(header)) out.push('the header has no 28 px mark');
  if (!header.includes('<span class="lockup"><span class="lockup-open">Open</span><span class="lockup-bed">Bed</span></span>')) out.push('the lockup is not "Open" "Bed" as live text');
  if (!header.includes('<span class="lockup-role">Platform admin</span>')) out.push('"Platform admin" is not beside the lockup');
  if (!/<main id="app"><\/main>/.test(bare)) out.push('the app does not render into <main id="app">');
  return out;
}

describe('the header: the mark, the live-text lockup and "Platform admin"', () => {
  const HTML = readFileSync(join(REPO_ROOT, 'apps', 'admin', 'index.html'), 'utf8');
  test('real apps/admin/index.html is accepted', () => {
    const out = headerViolations(HTML);
    expect(out, out.join('\n')).toEqual([]);
  });
  test.each<[string, (h: string) => string, string]>([
    ['"Platform admin" removed', (h) => h.replace('<span class="lockup-role">Platform admin</span>', ''), '"Platform admin" is not beside the lockup'],
    ['the lockup outlined as an image', (h) => h.replace('<span class="lockup"><span class="lockup-open">Open</span><span class="lockup-bed">Bed</span></span>', '<img src="lockup.svg" alt="OpenBed" />'), 'the lockup is not "Open" "Bed" as live text'],
    ['the mark dropped', (h) => h.replace(/<img class="mark"[^>]*\/>/, ''), 'the header has no 28 px mark'],
    ['the header only inside a comment', (h) => h.replace('<header class="site-header">', '<!-- <header class="site-header">').replace('</header>', '</header> -->'), 'index.html has no <header class="site-header">'],
  ])('plant — %s is rejected', (_name, plant, message) => {
    const planted = plant(HTML);
    expect(planted, 'the plant did not change the file').not.toBe(HTML);
    expect(headerViolations(planted).join('\n')).toContain(message);
  });
  test('anti-vacuity — checker over an empty corpus fails', () => {
    expect(headerViolations('')).toEqual(['index.html has no <header class="site-header">']);
  });
});

// ---------------------------------------------------------------------------------- tones

describe('every outcome is a Notice in the design system\'s tone, and every status is announced', () => {
  test('each sentence renders in its tone: info for what went through, caution for every refusal or failure', async () => {
    const rows: { what: string; el: Element | null; text: string; tone: Tone }[] = [];
    const facs = () => [facility(FAC_A, { listed_at: null }), facility(FAC_B, { is_active: false, agreement_state: 'withdrawn', has_contact: false }), { facility_id: 'not-a-row' }];

    // The register: its warnings, and what a failed load says.
    await renderAt(sessionFragment(), server(facs));
    await until(() => document.querySelectorAll('li.facility').length === 3);
    rows.push({ what: 'unreadable row', el: document.querySelector('li.facility:not([data-facility-id]) p'), text: "This facility's record could not be read. Reload the page.", tone: 'caution' });
    const warnings = Array.from(document.querySelectorAll(`li.facility[data-facility-id="${FAC_B}"] p.warning`));
    rows.push({ what: 'switched-off warning', el: warnings[0] ?? null, text: W.SWITCHED_OFF, tone: 'caution' });
    rows.push({ what: 'listed-with-no-contact warning', el: warnings[1] ?? null, text: W.NO_CONTACT_WARNING, tone: 'caution' });
    rows.push({ what: 'withdrawn warning', el: warnings[2] ?? null, text: W.WITHDRAWN_WARNING, tone: 'caution' });
    await renderAt(sessionFragment(), () => { throw new TypeError('down'); });
    await until(() => document.querySelector('#app > p') !== null);
    rows.push({ what: 'register unreachable', el: document.querySelector('#app > p'), text: F.UNREACHABLE, tone: 'caution' });
    await renderAt(sessionFragment(), () => json(200, { nonsense: true }));
    await until(() => document.querySelector('#app > p') !== null);
    rows.push({ what: 'register unrecognised', el: document.querySelector('#app > p'), text: F.UNRECOGNISED, tone: 'caution' });
    await renderAt(sessionFragment(), () => json(403, { code: '42501', message: 'NOT_AN_OPERATOR' }));
    await until(() => document.querySelector('#app > p') !== null);
    rows.push({ what: 'stop: not an operator', el: document.querySelector('#app > p'), text: C['NOT_AN_OPERATOR'] as string, tone: 'caution' });
    await renderAt('#error=access_denied&error_code=otp_expired', () => json(500, {}));
    rows.push({ what: 'bad link', el: document.querySelector('#app > p'), text: W.BAD_LINK, tone: 'caution' });

    // Create: a created facility, a refusal, and a value the form cannot send.
    const create = async (answer: Route, lat = '6.45') => {
      await renderAt(sessionFragment(), server(facs, { operator_create_facility: answer }));
      await until(() => document.querySelector('li.facility') !== null);
      button('New facility').click();
      for (const [n, v] of [['name', 'New Hospital'], ['lga', 'Ikeja'], ['state', 'Lagos'], ['address', '3 Example Road, Ikeja'], ['lat', lat], ['lng', '3.35'], ['phone', '0800 000 0303']]) setInput('create-facility', n as string, v as string);
      submit('create-facility');
      await until(() => (formStatus('create-facility')?.textContent ?? '') !== '' || (pageStatus()?.textContent ?? '') !== '');
      await settle();
    };
    await create(() => json(200, [{ facility_id: FAC_A, version: 1, created: true }]));
    rows.push({ what: 'created', el: pageStatus(), text: F.CREATED, tone: 'info' });
    await create(() => refusal('IDEMPOTENCY_CONFLICT'));
    rows.push({ what: 'create refused', el: formStatus('create-facility'), text: C['IDEMPOTENCY_CONFLICT'] as string, tone: 'caution' });
    await create(() => json(200, []), '');
    rows.push({ what: 'create: no latitude', el: formStatus('create-facility'), text: 'Enter the latitude as a number, such as 6.5244.', tone: 'caution' });

    // One facility: each write's outcome.
    const detail = async (over: Record<string, Route>, act: () => void, contact: () => unknown = () => CONTACT, fac = () => [facility(FAC_A)]) => {
      await openA(server(fac, over, contact));
      act();
      await until(() => (pageStatus()?.textContent ?? '') !== '' || Array.from(document.querySelectorAll('form p.status')).some((p) => (p.textContent ?? '') !== ''));
      await settle();
    };
    await detail({ operator_edit_facility: () => json(200, [{ facility_id: FAC_A, version: 5 }]) }, () => { setInput('edit-facility', 'name', 'Renamed'); submit('edit-facility'); });
    rows.push({ what: 'saved', el: pageStatus(), text: 'Saved.', tone: 'info' });
    await detail({ operator_edit_facility: () => json(400, { code: 'P0001', message: 'VERSION_CONFLICT', details: 'current_version=5' }) }, () => { setInput('edit-facility', 'name', 'Renamed'); submit('edit-facility'); });
    rows.push({ what: 'edit conflict', el: pageStatus(), text: C['VERSION_CONFLICT'] as string, tone: 'caution' });
    await detail({ operator_edit_facility: () => { throw new TypeError('dropped'); } }, () => { setInput('edit-facility', 'name', 'Renamed'); submit('edit-facility'); });
    rows.push({ what: 'edit dropped', el: pageStatus(), text: F.EDIT_DROPPED, tone: 'caution' });
    await detail({ operator_add_category: () => json(200, [{ ward_status_id: 'x', version: 0, created: true }]) }, () => { setInput('add-category', 'category', 'NICU'); setInput('add-category', 'offering', 'OFFERED'); submit('add-category'); });
    rows.push({ what: 'ward category added', el: pageStatus(), text: 'Ward category added.', tone: 'info' });
    await detail({ operator_add_category: () => { throw new TypeError('dropped'); } }, () => { setInput('add-category', 'category', 'NICU'); setInput('add-category', 'offering', 'OFFERED'); submit('add-category'); });
    rows.push({ what: 'add category unreachable', el: formStatus('add-category'), text: F.UNREACHABLE, tone: 'caution' });
    await detail({ operator_record_contact: () => json(200, [{ facility_id: FAC_A, contact_version: 3 }]) }, () => submit('record-contact'));
    rows.push({ what: 'contact saved', el: pageStatus(), text: 'Contact saved.', tone: 'info' });
    await detail({ operator_record_contact: () => refusal('NO_CONTACT_CHANNEL') }, () => submit('record-contact'));
    rows.push({ what: 'contact refused', el: formStatus('record-contact'), text: C['NO_CONTACT_CHANNEL'] as string, tone: 'caution' });
    await detail({ operator_record_agreement: () => json(200, [{ facility_id: FAC_A }]) }, () => { setInput('record-agreement', 'accepted_on', '2026-09-01'); setInput('record-agreement', 'version', 'v1'); submit('record-agreement'); }, () => NO_AGREEMENT);
    rows.push({ what: 'agreement recorded', el: pageStatus(), text: 'Agreement recorded.', tone: 'info' });
    await detail({ operator_set_facility_listed: () => json(200, [{ facility_id: FAC_A, version: 5, listed_at: SERVER_NOW }]) }, () => submit('list-facility'), () => CONTACT, () => [facility(FAC_A, { listed_at: null })]);
    rows.push({ what: 'listed', el: pageStatus(), text: 'Listed.', tone: 'info' });

    // Bundle 3 (R-2026-09-27-144 DT): the registration's outcomes, the retention alert, and
    // DP-5 b's two read-failure sentences.
    await detail({ operator_record_registration: () => json(200, [{ facility_id: FAC_A, version: 5 }]) }, () => { setInput('record-registration', 'hefamaa_reg_no', 'HEF/LA/0042'); submit('record-registration'); });
    rows.push({ what: 'registration saved', el: pageStatus(), text: W.REGISTRATION_SAVED, tone: 'info' });
    await detail({}, () => { setInput('record-registration', 'hefamaa_reg_no', ' HEF/LA/0042'); submit('record-registration'); });
    rows.push({ what: 'registration refused on the page', el: formStatus('record-registration'), text: C['INVALID_ARGUMENT:p_hefamaa_reg_no'] as string, tone: 'caution' });
    await renderAt(sessionFragment(), (url) => (url.endsWith('/rpc/operator_scheduler_status') ? json(200, HEALTHY_STATUS) : json(200, { server_now: SERVER_NOW, retention_alert: [{ job: 'openbed_erase_lapsed_ward_logins', end_time: SERVER_NOW }], facilities: [] })));
    await until(() => document.querySelector('p.retention-alert') !== null);
    rows.push({ what: 'retention alert', el: document.querySelector('p.retention-alert'), text: `${W.RETENTION_ALERT_LEAD} openbed_erase_lapsed_ward_logins, ${lagosTime(SERVER_NOW)}. ${W.RETENTION_ALERT_ACTION}`, tone: 'caution' });
    // The System status (R-2026-09-30-175 EY-3): each Notice and line its section can say.
    const statusPage = async (status: () => Response | Promise<Response>) => {
      await renderAt(sessionFragment(), server(() => [], { operator_scheduler_status: status }));
      await until(() => document.querySelector('section.system-status') !== null);
    };
    const stat = (patch: Record<string, unknown>) => () => json(200, { ...HEALTHY_STATUS, ...patch });
    const jobOff = (name: string, patch: Record<string, unknown>) => HEALTHY_STATUS.jobs.map((j) => (j.name === name ? { ...j, ...patch } : j));
    await statusPage(stat({ generated_at: '2026-09-24T11:00:00.000Z' }));
    rows.push({ what: 'system status: stale snapshot', el: document.querySelector('section.system-status p.system-caution'), text: W.STALE_NOTICE, tone: 'caution' });
    await statusPage(stat({ jobs: jobOff('openbed_refresh_lga_rollup', { active: false }) }));
    rows.push({ what: 'system status: a job switched off', el: document.querySelector('section.system-status p.system-caution'), text: `${W.JOB_INACTIVE_LEAD} openbed_refresh_lga_rollup. ${W.SCHEDULER_ACTION}`, tone: 'caution' });
    await statusPage(stat({ jobs: jobOff('openbed_erase_lapsed_ward_logins', { last_status: 'failed' }) }));
    rows.push({ what: 'system status: a job whose last run failed', el: document.querySelector('section.system-status p.system-caution'), text: `${W.JOB_FAILED_LEAD} openbed_erase_lapsed_ward_logins. ${W.SCHEDULER_ACTION}`, tone: 'caution' });
    await statusPage(stat({ jobs: HEALTHY_STATUS.jobs.filter((j) => j.name !== 'openbed_regenerate_snapshot') }));
    rows.push({ what: 'system status: the snapshot job is missing', el: document.querySelector('section.system-status p.system-caution'), text: `${W.JOB_MISSING_LEAD} openbed_regenerate_snapshot. ${W.SCHEDULER_ACTION}`, tone: 'caution' });
    await statusPage(() => json(500, { message: 'unexpected call' }));
    rows.push({ what: 'system status: the load failed', el: document.querySelector('section.system-status p.status'), text: F.UNRECOGNISED, tone: 'caution' });

    await openA(server(() => [facility(FAC_A)], {}, () => ({ not: 'a contact' })));
    rows.push({ what: 'contact could not be read', el: document.querySelector('section.contact-detail p'), text: W.CONTACT_UNREADABLE, tone: 'caution' });
    rows.push({ what: 'agreement waits on the contact', el: document.querySelector('section.agreement-detail p'), text: W.AGREEMENT_NEEDS_CONTACT, tone: 'caution' });

    // The sign-in form.
    const signIn = async (route: Route) => {
      await renderAt('', route);
      setInput('signin-request', 'email', 'operator@example.invalid');
      submit('signin-request');
      await until(() => (formStatus('signin-request')?.textContent ?? '') !== '');
      return formStatus('signin-request');
    };
    rows.push({ what: 'sign-in answered', el: await signIn(() => json(200, {})), text: W.REQUEST_ANSWERED, tone: 'info' });
    rows.push({ what: 'sign-in unreachable', el: await signIn(() => { throw new TypeError('down'); }), text: W.REQUEST_UNREACHABLE, tone: 'caution' });

    // 27 until R-2026-09-30-175 EY-3, which adds the System status's five Notices and lines.
    expect(rows.length).toBe(32);
    const out = toneViolations(rows);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('the signed-out landing\'s instruction is lead text, not a Notice', async () => {
    await renderAt('', () => json(500, {}));
    const p = document.querySelector('#app > p');
    expect(p?.textContent).toBe(W.ACCESS_ORDER);
    expect(p?.classList.contains('lead')).toBe(true);
    expect(p?.classList.contains('notice'), 'the page\'s own instruction is drawn as a refusal').toBe(false);
  });

  test('every p.status carries role="status": the register, every form of a facility, and the sign-in form', async () => {
    await openA(server(() => [facility(FAC_A, { listed_at: null })], {}, () => NO_AGREEMENT));
    const statuses = Array.from(document.querySelectorAll('p.status'));
    // The page's line, and edit, record-registration (DT Bundle 3), add-category,
    // record-contact, record-agreement, record-reporting-approval (029, R-2026-09-30-201 GA),
    // list-facility.
    expect(statuses.length).toBe(8);
    await renderAt(sessionFragment(), server(() => [facility(FAC_A)]));
    await until(() => document.querySelector('li.facility') !== null);
    statuses.push(...Array.from(document.querySelectorAll('p.status')));
    await renderAt('', () => json(500, {}));
    statuses.push(...Array.from(document.querySelectorAll('p.status')));
    // R-2026-09-30-175 EY-3: the register now holds the System status section's own line, so
    // the register adds one and the total is 11 (the detail view's 8, above, has no section).
    expect(statuses.length).toBe(11);
    for (const s of statuses) expect(s.getAttribute('role'), 'a status line is not announced').toBe('status');
  });
});

describe('the Notice rules are the design system\'s, and admin has no green', () => {
  const CSS = readFileSync(join(SRC, 'style.css'), 'utf8');
  test('real apps/admin/src/style.css is accepted', () => {
    const out = noticeCssViolations(CSS, 'admin');
    expect(out, out.join('\n')).toEqual([]);
  });
  test.each<[string, (c: string) => string, string]>([
    ['a caution Notice in the info colours', (c) => c.replace('color: #6d4c12', 'color: var(--ob-navy-800)'), '.notice-caution does not declare color: #6d4c12'],
    ['a green success tone', (c) => `${c}\n.notice-ok { background: var(--ob-status-available-bg); }\n`, 'admin names --ob-status-available'],
  ])('plant — %s is rejected', (_name, plant, message) => {
    const planted = plant(CSS);
    expect(planted, 'the plant did not change the file').not.toBe(CSS);
    expect(noticeCssViolations(planted, 'admin').join('\n')).toContain(message);
  });
  test('anti-vacuity — checker over an empty corpus fails', () => {
    expect(noticeCssViolations('', 'admin').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------- validation

interface Checked {
  what: string;
  /** The sentence the form must say. */
  text: string;
  status: HTMLParagraphElement | null;
  /** The field that must hold focus. */
  field: Element | null;
  focused: Element | null;
  /** Calls to the write this form makes, after the press. */
  sent: number;
}

/** Why a form's own validation did not answer as it must: its sentence, as a caution Notice, focus on the field, nothing sent. */
export function validationViolations(rows: Checked[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.status === null || r.field === null) { out.push(`${r.what}: nothing rendered`); continue; }
    out.push(...toneViolations([{ what: r.what, el: r.status, text: r.text, tone: 'caution' }]));
    if (r.focused !== r.field) out.push(`${r.what}: focus is not on the field to fix`);
    if (r.sent !== 0) out.push(`${r.what}: ${String(r.sent)} request(s) sent for a value the form refused`);
  }
  return out;
}

describe('the operator forms do their own validation (DO-4 c); the sign-in form keeps the browser\'s (DO-5)', () => {
  test('every operator form sets noValidate; the sign-in form does not', async () => {
    await openA(server(() => [facility(FAC_A, { listed_at: null })], {}, () => NO_AGREEMENT));
    const operator = Array.from(document.querySelectorAll<HTMLFormElement>('form'));
    expect(operator.map((f) => f.classList[0]).sort()).toEqual(['add-category', 'edit-facility', 'list-facility', 'record-agreement', 'record-contact', 'record-registration', 'record-reporting-approval']);
    await renderAt(sessionFragment(), server(() => []));
    await until(() => document.querySelector('ul.register') !== null);
    button('New facility').click();
    operator.push(document.querySelector('form.create-facility') as HTMLFormElement);
    for (const f of operator) expect(f.noValidate, `form.${f.classList[0] ?? '?'} lets the browser answer in its own words`).toBe(true);
    await renderAt('', () => json(500, {}));
    const signIn = document.querySelector<HTMLFormElement>('form.signin-request');
    expect(signIn?.noValidate, 'the sign-in form must keep the browser\'s validation (-134 DJ; DO-5 b)').toBe(false);
  });

  test('the sign-in form sends nothing for an empty or malformed address: the browser\'s validation stops it', async () => {
    for (const address of ['', 'not-an-address']) {
      const stub = await renderAt('', () => json(200, {}));
      setInput('signin-request', 'email', address);
      submit('signin-request');
      await settle();
      expect(stub.mock.calls.filter(([u]) => String(u).includes('/auth/v1/otp')), `"${address}" was sent`).toHaveLength(0);
    }
  });

  test('each value a form cannot send gets its sentence as a caution Notice, focus on its field, and nothing is sent', async () => {
    const rows: Checked[] = [];
    const facs = () => [facility(FAC_A)];
    const row = (what: string, text: string, formClass: string, name: string, stub: ReturnType<typeof vi.fn>, rpc: string): Checked => ({
      what,
      text,
      status: formStatus(formClass),
      field: document.querySelector(`form.${formClass} [name="${name}"]`),
      focused: document.activeElement,
      sent: calls(stub, rpc).length,
    });

    for (const [name, value, text] of [
      ['lat', '', 'Enter the latitude as a number, such as 6.5244.'],
      ['lng', 'east', 'Enter the longitude as a number, such as 3.3792.'],
      ['phone', '12', 'The public phone is not in international form (+234...). Check the preview.'],
      // 031 (R-2026-09-30-214 GN): the street address, in the sentence the label table holds for the server's own refusal.
      ['address', '', 'Enter the street address as it should show to the public: 1 to 200 characters, on one line.'],
      ['address', '1 Example\u2028Street', 'Enter the street address as it should show to the public: 1 to 200 characters, on one line.'],
    ] as const) {
      const stub = await openA(server(facs));
      setInput('edit-facility', name, value);
      submit('edit-facility');
      await settle();
      rows.push(row(`edit: ${name} "${value}"`, text, 'edit-facility', name, stub, 'operator_edit_facility'));
    }
    let stub = await openA(server(facs));
    submit('add-category');
    await settle();
    rows.push(row('add-category: no category', 'Choose a ward category and whether it is offered.', 'add-category', 'category', stub, 'operator_add_category'));
    stub = await openA(server(facs));
    setInput('add-category', 'category', 'NICU');
    submit('add-category');
    await settle();
    rows.push(row('add-category: no offering', 'Choose a ward category and whether it is offered.', 'add-category', 'offering', stub, 'operator_add_category'));
    stub = await openA(server(facs));
    setInput('record-contact', 'mobile', '12');
    submit('record-contact');
    await settle();
    rows.push(row('contact: a mobile that is not a number', 'That mobile number is not in international form (+234...). Check the preview.', 'record-contact', 'mobile', stub, 'operator_record_contact'));
    // THE CHECK ONLY THE BROWSER MADE: an email field's form. 021 checks no email's form, so
    // with noValidate this sentence is the only thing between a typo and the saved contact.
    stub = await openA(server(facs));
    setInput('record-contact', 'email', 'ada.example.invalid');
    submit('record-contact');
    await settle();
    rows.push(row('contact: an email with no @', 'That email address is not in a form this page can read. Check it for a missing @ or a space.', 'record-contact', 'email', stub, 'operator_record_contact'));
    // Nine rows: the seven that stood before 031, plus the two street-address rows (R-2026-09-30-214 GN). The count is
    // the anti-vacuity leg: a loop that checked fewer would pass on what it did check.
    expect(rows.length).toBe(9);
    const out = validationViolations(rows);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('plant — a sentence in the info tone, focus left on the button, and a refused value that was sent are each rejected', () => {
    const p = (cls: string, t: string): HTMLParagraphElement => { const el = document.createElement('p'); el.className = cls; el.textContent = t; return el; };
    const field = document.createElement('input');
    const other = document.createElement('button');
    const good: Checked = { what: 'x', text: 's', status: p('status notice notice-caution', 's'), field, focused: field, sent: 0 };
    expect(validationViolations([good])).toEqual([]);
    expect(validationViolations([{ ...good, status: p('status notice notice-info', 's') }])).toEqual(['x: tone info, not caution']);
    expect(validationViolations([{ ...good, focused: other }])).toEqual(['x: focus is not on the field to fix']);
    expect(validationViolations([{ ...good, sent: 1 }])).toEqual(['x: 1 request(s) sent for a value the form refused']);
  });

  test('anti-vacuity — checker over an empty corpus fails', () => {
    expect(validationViolations([{ what: 'x', text: 's', status: null, field: null, focused: null, sent: 0 }])).toEqual(['x: nothing rendered']);
  });
});

// ---------------------------------------------------------------------------------- DI-1

describe('an update changes only what it updated (DO-4 d)', () => {
  test('with two forms holding a Notice and unsent input, a third form\'s write leaves both on the SAME nodes, and the wards list shows the new ward', async () => {
    let categories = [ward('MATERNITY')];
    const stub = await openA(
      server(() => [facility(FAC_A, { categories })], {
        operator_edit_facility: () => refusal('NO_SUCH_FACILITY'),
        operator_add_category: () => {
          categories = [...categories, ward('NICU', { monitoring_state: 'PENDING', updated_at: null, bed_count: null, has_account: false })];
          return json(200, [{ ward_status_id: 'x', version: 0, created: true }]);
        },
      }),
    );
    // The edit form: a refused Save, so its Notice stands and its value never went out.
    const editForm = document.querySelector('form.edit-facility') as HTMLFormElement;
    setInput('edit-facility', 'name', 'Unsent name');
    submit('edit-facility');
    await until(() => (formStatus('edit-facility')?.textContent ?? '') !== '');
    const editNotice = formStatus('edit-facility')?.textContent;
    expect(editNotice, 'precondition: the edit form holds a refusal').toBe(C['NO_SUCH_FACILITY']);
    // The contact form: typed and never sent.
    const contactForm = document.querySelector('form.record-contact') as HTMLFormElement;
    setInput('record-contact', 'full_name', 'Unsent Contact');
    setInput('record-contact', 'job_title', 'Unsent Title');

    setInput('add-category', 'category', 'NICU');
    setInput('add-category', 'offering', 'OFFERED');
    submit('add-category');
    await until(() => pageStatus()?.textContent === 'Ward category added.');
    await settle();

    expect(calls(stub, 'operator_add_category')).toHaveLength(1);
    expect(document.querySelector('form.edit-facility'), 'the edit form was rebuilt by a write that was not its own').toBe(editForm);
    expect(editForm.isConnected).toBe(true);
    expect(input('edit-facility', 'name').value, 'the edit form\'s unsent value was lost').toBe('Unsent name');
    expect(formStatus('edit-facility')?.textContent, 'the edit form\'s Notice was lost').toBe(editNotice);
    expect(document.querySelector('form.record-contact'), 'the contact form was rebuilt by a write that was not its own').toBe(contactForm);
    expect(input('record-contact', 'full_name').value, 'the contact form\'s unsent value was lost').toBe('Unsent Contact');
    expect(input('record-contact', 'job_title').value).toBe('Unsent Title');
    const wards = Array.from(document.querySelectorAll('.wards-detail li.ward')).map((li) => li.textContent ?? '');
    expect(wards, 'the new ward is not on the list').toHaveLength(2);
    expect(wards[1]).toContain('Newborn ICU (NICU)');
  });

  test('a form holding unsent input keeps the version it was filled from; one holding none moves to the newest', async () => {
    let version = 4;
    let listedAt: string | null = null;
    const stub = await openA(
      server(() => [facility(FAC_A, { version, listed_at: listedAt })], {
        operator_set_facility_listed: () => {
          version = 5;
          listedAt = SERVER_NOW;
          return json(200, [{ facility_id: FAC_A, version, listed_at: listedAt }]);
        },
        operator_edit_facility: () => json(200, [{ facility_id: FAC_A, version: version + 1 }]),
      }),
    );
    // Untouched edit form: listing bumps the facility's version, and the form follows it.
    submit('list-facility');
    await until(() => pageStatus()?.textContent === 'Listed.');
    await settle();
    setInput('edit-facility', 'name', 'After listing');
    submit('edit-facility');
    await until(() => calls(stub, 'operator_edit_facility').length === 1);
    expect(calls(stub, 'operator_edit_facility')[0]?.['p_expected_version'], 'an untouched edit form kept a version this page itself superseded').toBe(5);
  });

  test('an edit typed BEFORE another change to the facility is sent against the row it was typed on, so the server can refuse it', async () => {
    let version = 4;
    let listedAt: string | null = null;
    const stub = await openA(
      server(() => [facility(FAC_A, { version, listed_at: listedAt })], {
        operator_set_facility_listed: () => {
          version = 5;
          listedAt = SERVER_NOW;
          return json(200, [{ facility_id: FAC_A, version, listed_at: listedAt }]);
        },
        operator_edit_facility: () => json(400, { code: 'P0001', message: 'VERSION_CONFLICT', details: 'current_version=5' }),
      }),
    );
    setInput('edit-facility', 'name', 'Typed before listing');
    submit('list-facility');
    await until(() => pageStatus()?.textContent === 'Listed.');
    await settle();
    expect(input('edit-facility', 'name').value, 'the unsent edit was overwritten by the re-read').toBe('Typed before listing');
    submit('edit-facility');
    await until(() => calls(stub, 'operator_edit_facility').length === 1);
    expect(calls(stub, 'operator_edit_facility')[0]?.['p_expected_version'], 'the edit was sent against a row the operator never saw: a lost update').toBe(4);
    await until(() => pageStatus()?.textContent === C['VERSION_CONFLICT']);
  });
});

// ---------------------------------------------------------------------------------- words

/** Why a corpus shows "Paused" (BC-6: Listed / Not listed, never "Paused"), or []. */
export function pausedViolations(files: { path: string; text: string }[]): string[] {
  if (files.length === 0) return ['no admin source or label file was read'];
  return files.filter((f) => /\bpaused\b/i.test(f.text)).map((f) => `${f.path} says "Paused"`);
}

describe('Listed / Not listed as words, never "Paused" (BC-6)', () => {
  const corpus = (): { path: string; text: string }[] => [
    ...readdirSync(SRC).filter((f) => /\.(ts|css)$/.test(f)).map((f) => ({ path: `apps/admin/src/${f}`, text: readFileSync(join(SRC, f), 'utf8') })),
    { path: 'apps/admin/index.html', text: readFileSync(join(REPO_ROOT, 'apps', 'admin', 'index.html'), 'utf8') },
    { path: 'packages/labels/admin-labels.json', text: readFileSync(join(REPO_ROOT, 'packages', 'labels', 'admin-labels.json'), 'utf8') },
  ];
  test('real admin source and labels are accepted', () => {
    const out = pausedViolations(corpus());
    expect(out, out.join('\n')).toEqual([]);
  });
  test('the register shows each facility\'s standing in words', async () => {
    await renderAt(sessionFragment(), server(() => [facility(FAC_A), facility(FAC_B, { listed_at: null })]));
    await until(() => document.querySelectorAll('li.facility').length === 2);
    expect(Array.from(document.querySelectorAll('p.listed')).map((p) => p.textContent)).toEqual([W.LISTED, W.NOT_LISTED]);
  });
  test('plant — a "Paused" label is rejected', () => {
    const files = corpus();
    const planted = files.map((f) => (f.path.endsWith('admin-labels.json') ? { ...f, text: f.text.replace(`"${W.NOT_LISTED}"`, '"Paused"') } : f));
    expect(planted.map((f) => f.text), 'the plant did not change the labels').not.toEqual(files.map((f) => f.text));
    expect(pausedViolations(planted)).toEqual(['packages/labels/admin-labels.json says "Paused"']);
  });
  test('anti-vacuity — checker over an empty corpus fails', () => {
    expect(pausedViolations([])).toEqual(['no admin source or label file was read']);
  });
});

// ---------------------------------------------------------------------------------- sizes

const bareCss = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const ruleOf = (css: string, selector: string): string | null => {
  const re = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  return re.exec(css)?.[1] ?? null;
};
const px = (rule: string | null, prop: string): number | null => {
  const m = rule === null ? null : new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*(\\d+)px`).exec(rule);
  return m === null ? null : Number(m[1]);
};

/** Why style.css misses a size D3 requires, or the table threshold, or []. Literal px only. */
export function adminSizeViolations(css: string): string[] {
  const bare = bareCss(css);
  const out: string[] = [];
  for (const [selector, prop] of [
    ['button', 'min-height'],
    ['button', 'min-width'],
    ['label.field input,\nselect.select', 'min-height'],
    ['label.check', 'min-height'],
  ] as const) {
    const v = px(ruleOf(bare, selector), prop);
    if (v === null || v < 44) out.push(`${selector.replace('\n', ' ')} declares no literal ${prop} of at least 44px`);
  }
  const wide = /@media\s*\(min-width:\s*(\d+)px\)\s*\{([\s\S]*?\n)\}/g;
  let table = false;
  for (const m of bare.matchAll(wide)) {
    if (m[1] === '960' && /li\.facility\s*\{[^}]*grid-template-columns\s*:/.test(m[2] ?? '')) table = true;
  }
  if (!table) out.push('no @media (min-width: 960px) rule lays li.facility out as a table row (grid-template-columns)');
  const card = ruleOf(bare, 'li.facility');
  if (card === null || !card.includes('background: var(--surface-card)')) out.push('li.facility is not a card below 960 px');
  return out;
}

describe('the sizes D3 requires, read as literal px from apps/admin/src/style.css', () => {
  const CSS = readFileSync(join(SRC, 'style.css'), 'utf8');
  test('real apps/admin/src/style.css is accepted', () => {
    const out = adminSizeViolations(CSS);
    expect(out, out.join('\n')).toEqual([]);
  });
  test.each<[string, (c: string) => string, string]>([
    ['the table threshold moved to 900 px', (c) => c.replace('@media (min-width: 960px)', '@media (min-width: 900px)'), 'no @media (min-width: 960px) rule'],
    ['an input at 40 px', (c) => c.replace(/(label\.field input,\nselect\.select \{[^}]*?)min-height: 44px/, '$1min-height: 40px'), 'label.field input, select.select declares no literal min-height'],
    ['a size given through var()', (c) => c.replace(/(label\.check \{[^}]*?)min-height: 44px/, '$1min-height: var(--hit-min)'), 'label.check declares no literal min-height'],
    ['the register never a card', (c) => c.replace(/(\nli\.facility \{[^}]*?)background: var\(--surface-card\);/, '$1'), 'li.facility is not a card below 960 px'],
  ])('plant — %s is rejected', (_name, plant, message) => {
    const planted = plant(CSS);
    expect(planted, 'the plant did not change the file').not.toBe(CSS);
    expect(adminSizeViolations(planted).join('\n')).toContain(message);
  });
  test('anti-vacuity — checker over an empty corpus fails', () => {
    expect(adminSizeViolations('')).toHaveLength(6);
  });
});
