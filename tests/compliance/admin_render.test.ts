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
    name: "St. Nicholas' Hospital",
    lga: 'Lagos Island',
    state: 'Lagos',
    version: 4,
    listed_at: '2026-09-20T09:00:00.000Z',
    quiet_mode: false,
    is_active: true,
    has_contact: true,
    agreement_state: 'recorded',
    categories: [ward('MATERNITY')],
    ...over,
  };
}

const REGISTER = {
  server_now: SERVER_NOW,
  facilities: [
    facility(FAC_A, {
      categories: [ward('ICU_ADULT', { updated_at: hoursAgo(13) }), ward('MATERNITY'), ward('THEATRE', { monitoring_state: 'PENDING', bed_count: null, updated_at: null, has_account: false, provisioning_incomplete: true })],
    }),
    facility(FAC_B, { name: 'Ọ̀dúnlá General', listed_at: null, has_contact: false, agreement_state: 'none', categories: [] }),
  ],
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
  setInput(formClass, 'name', "St. Nicholas' Hospital");
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
      server_now: SERVER_NOW,
      facilities: [facility(FAC_A, { has_contact: false }), facility(FAC_B, { agreement_state: 'withdrawn' })],
    };
    await renderAt(sessionFragment(), server({ operator_register: () => json(200, reg) }));
    await until(() => text().includes('Facilities'));
    expect(text()).toContain(ADMIN_LABELS.screens.NO_CONTACT_WARNING);
    expect(text()).toContain(ADMIN_LABELS.screens.WITHDRAWN_WARNING);
  });

  test('a row that could not be read is shown in its place, never dropped', async () => {
    const reg = { server_now: SERVER_NOW, facilities: [facility(FAC_A, { version: 'four' }), facility(FAC_B)] };
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
    expect(bodies[0]?.['p_name'], 'the name was not sent exactly as typed').toBe("St. Nicholas' Hospital");
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

  /** Every CHECK constraint the migrations declare on the three tables the operator writes. */
  function checkNames(): string[] {
    const out = new Set<string>();
    for (const f of FORWARD) {
      const src = readFileSync(join(MIG, f), 'utf8');
      for (const m of src.matchAll(/CONSTRAINT\s+((?:facility|facility_contact|facility_agreement)_[a-z0-9_]+)\s+CHECK/g)) out.add(m[1] as string);
      for (const m of src.matchAll(/DROP CONSTRAINT (?:IF EXISTS )?((?:facility|facility_contact|facility_agreement)_[a-z0-9_]+)/g)) out.delete(m[1] as string);
    }
    return [...out].sort();
  }

  function coverage(raised: string[], table: string[]): string[] {
    const out: string[] = [];
    for (const c of raised) if (!table.includes(c)) out.push(`${c} can be raised at the admin app and has no sentence`);
    for (const c of table) if (!raised.includes(c)) out.push(`${c} has a sentence and nothing raises it`);
    return out;
  }

  test('the code table covers EXACTLY the codes the eight functions and their two guards can raise', () => {
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

  test('the signed-out page names the Access order before asking for a link', async () => {
    await renderAt('', () => json(500, {}));
    await until(() => document.querySelector('form.signin-request') !== null);
    expect(text()).toContain(ADMIN_LABELS.screens.ACCESS_ORDER);
  });
});
