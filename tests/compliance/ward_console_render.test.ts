// @vitest-environment jsdom
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

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

const GOOD_ROW = { category: 'MATERNITY', offering: 'OFFERED', bed_count: 3, accepting: true, version: 4, gated_by: null };

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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
  return (url) => (url.endsWith('/rest/v1/rpc/my_facility_wards') ? json(200, rows) : json(500, { message: 'unexpected call' }));
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

const RAISED = [
  ...raisedCodes('011_read_rpcs_capped.sql', 'app.assert_member'),
  ...raisedCodes('011_read_rpcs_capped.sql', 'public.my_facility_wards'),
  ...raisedCodes('014_publish_ward_status.sql', 'public.publish_ward_status'),
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
  ])('plant — a row with %s renders as unreadable with no publish form', async (_label, bad) => {
    const second = { ...bad, category: bad.category === GOOD_ROW.category ? 'ICU_ADULT' : bad.category };
    await renderAt(sessionFragment(), handover([GOOD_ROW, second]));
    await until(() => text().includes('Handover'));
    expect(text(), 'the refused row did not say it could not be read').toContain("could not be read, so it cannot be updated from here");
    expect(document.querySelectorAll('form').length, 'the refused row carries a publish form').toBe(1);
    expect(text(), 'arbitrary server text reached the page as a category').not.toContain(SENTINEL);
  });

  test('positive control — an ordinary row renders with its publish form', async () => {
    await renderAt(sessionFragment(), handover([GOOD_ROW, { ...GOOD_ROW, category: 'ICU_ADULT', offering: 'NOT_OFFERED', bed_count: null }]));
    await until(() => text().includes('Handover'));
    expect(text()).toContain('MATERNITY: OFFERED, 3 beds');
    expect(text()).toContain('ICU_ADULT: NOT_OFFERED, not yet reporting');
    expect(document.querySelectorAll('form').length).toBe(2);
    expect(text()).not.toContain('could not be read');
  });

  test('plant — a ward list that is not a list is refused whole', async () => {
    await renderAt(sessionFragment(), (url) => (url.endsWith('my_facility_wards') ? json(200, { rows: [GOOD_ROW], note: SENTINEL }) : json(500, {})));
    await until(() => text().includes('Could not load'));
    expect(text()).toContain('The ward list could not be read.');
    expect(text()).not.toContain(SENTINEL);
  });
});

describe('D1 — no raw server text reaches the screen', () => {
  test('site 1, the handover load — a recognised refusal shows its fixed sentence and none of the body', async () => {
    await renderAt(sessionFragment(), (url) =>
      url.endsWith('my_facility_wards') ? json(403, { code: '42501', message: 'NOT_A_MEMBER', details: SENTINEL, hint: null }) : json(500, {}),
    );
    await until(() => text().includes('Could not load'));
    expect(text()).toContain('This sign-in is not linked to a ward.');
    expect(text(), 'the server body reached the page').not.toContain(SENTINEL);
    expect(text(), 'the status line is still printed').not.toMatch(/The server answered/);
  });

  test('site 1, the handover load — an unrecognised answer shows the one fixed fallback', async () => {
    await renderAt(sessionFragment(), (url) => (url.endsWith('my_facility_wards') ? json(502, { message: `${SENTINEL} upstream` }) : json(500, {})));
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
      if (url.endsWith('my_facility_wards')) return json(200, [GOOD_ROW]);
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
      if (url.endsWith('my_facility_wards')) return json(200, [GOOD_ROW]);
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
