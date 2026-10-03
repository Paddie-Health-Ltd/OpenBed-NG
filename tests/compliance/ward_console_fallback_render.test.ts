// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.openbed.ng/"}
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import ORIGINS from '../../packages/origins/origins.json';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE WARD CONSOLE, RENDERED AT A PRODUCTION HOST, WITH ITS FALLBACK IN PLAY
 * (R-2026-10-02-FF FF-4 a, c, d; -182).
 *
 * WHY A SEPARATE FILE, AND HOW THE COUNTING PLANT WORKS (FF-4 c asked for this to be named). Under jsdom's
 * default address, localhost, the console's fallback origin IS its primary (origins.json keeps the two equal
 * locally), so every call is sent ONCE and nothing here could be counted. This file's first line sets jsdom's
 * URL to https://app.openbed.ng/ with the `@vitest-environment-options` docblock, so main.ts, which reads
 * `window.location.hostname` once at module load, builds a holder whose primary is the production api origin
 * and whose fallback is the production DIRECT origin. fetch is then replaced by an injected stub that answers
 * by ORIGIN, so a plant can take the Worker away (reject) and read exactly what reached the direct origin.
 * ward_console_render.test.ts and ward_console_design.test.ts stay at localhost, untouched.
 *
 * WHAT IS ASSERTED: the Worker is tried first and the direct origin second (wiring); both origins down is the
 * "the connection to OpenBed failed" sentence (restated 2026-10-03, FG-4 a; it was "could not reach OpenBed"), and a kept session is the "sign-in could not be renewed" sentence, on a
 * publish AND on the handover load; the load's "Try again" re-runs the load with the SAME holder and never
 * reloads the page (a reload ends the session, which lives in memory only); the form's mutation id is
 * unchanged after each of the two new errors; a re-sent publish carries the SAME body, p_composed_at included,
 * with the clock moving between the two sends; a sign-in request falls back like every other call, and the
 * Worker's own `limited` is one send to one origin.
 *
 * NOT ASSERTED HERE, deliberately: that a REAL browser lets the console reach the direct origin. That needs
 * the CSP to name it, which security_headers.test.ts holds for the rendered headers, and a browser runner,
 * which CI does not have (the -70 C3 TRIGGER row). `window.location.reload` itself cannot be spied under
 * jsdom (its members are unforgeable), so "never reloads" is asserted two ways: the source holds no reload
 * call, and the retry visibly reuses the first load's token with no second sign-in.
 *
 * GUARD CLASS: LIVE.
 */

const API = ORIGINS.api.production;
const DIRECT = ORIGINS.supabaseDirect.production;

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** A session fragment whose access token has `secondsLeft` left. */
function sessionFragment(secondsLeft = 3600, tag = 'one'): string {
  const now = Math.floor(Date.now() / 1000);
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    sub: '11111111-1111-4111-8111-111111111111',
    session_id: `22222222-2222-4222-8222-${tag.padEnd(12, '0').slice(0, 12)}`,
    exp: now + secondsLeft,
    iat: now,
    role: 'authenticated',
    email: 'ward@example.invalid',
  })}.sig`;
  return `#access_token=${token}&refresh_token=r-${tag}&expires_at=${now + secondsLeft}&token_type=bearer`;
}

const GOOD_ROW = { category: 'MATERNITY', offering: 'OFFERED', bed_count: 3, accepting: true, version: 4, gated_by: null, monitoring_state: 'ACTIVE', state: 'OK', source: 'WARD', can_publish: true };
const PUBLISHED = [{ version: 5, replayed: false, claim_offering: 'OFFERED', claim_bed_count: 3, claim_accepting: true, public_gated_by: null }];

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const down = (): never => {
  throw new TypeError('fetch failed');
};

interface Sent {
  readonly origin: string;
  readonly path: string;
  readonly init: RequestInit | undefined;
}
/** Answers by origin and path. Returns the record of every request sent, in order. */
type Handler = (sent: Sent) => Response | Promise<Response>;

async function renderAt(fragment: string, handler: Handler): Promise<{ sent: Sent[]; setHandler(h: Handler): void }> {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/${fragment}`);
  const sent: Sent[] = [];
  let current = handler;
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const record = { origin: u.origin, path: u.pathname + u.search, init };
    sent.push(record);
    return current(record);
  }));
  const { render } = await import('../../apps/ward-console/src/main.js');
  await render();
  return { sent, setHandler: (h) => { current = h; } };
}

const text = (): string => document.body.textContent ?? '';
async function until(cond: () => boolean, deadlineMs = 5000): Promise<void> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('the page never reached the expected state');
}

const is = (s: Sent, path: string): boolean => s.path.split('?')[0]?.endsWith(path) === true;
const onlyRows: Handler = (s) => (is(s, '/rest/v1/rpc/my_reporting_wards') ? json(200, [GOOD_ROW]) : json(500, { message: 'unexpected call' }));
const bodyOf = (s: Sent | undefined): Record<string, unknown> => JSON.parse(String(s?.init?.body ?? '{}')) as Record<string, unknown>;
const publishSends = (sent: Sent[]): Sent[] => sent.filter((s) => is(s, '/rest/v1/rpc/publish_ward_status'));

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(Math, 'random').mockReturnValue(0.999);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the console is built for this host — the Worker first, the direct origin as its fallback', () => {
  test('anti-vacuity — this file really runs at a production host, so the fallback is a different origin from the primary', () => {
    expect(window.location.hostname).toBe('app.openbed.ng');
    expect(DIRECT).not.toBe(API);
  });

  test('plant — with the Worker down, the handover loads from the direct origin, the Worker having been tried first', async () => {
    const r = await renderAt(sessionFragment(), (s) => (s.origin === API ? down() : onlyRows(s)));
    await until(() => text().includes('Handover'));
    const rowCalls = r.sent.filter((s) => is(s, '/rest/v1/rpc/my_reporting_wards'));
    expect(rowCalls.map((s) => s.origin), 'the Worker must be tried first and the direct origin second, once each').toEqual([API, DIRECT]);
    expect(text()).toContain('Maternity: 3 beds');
  });

  test('real ordinary path — with the Worker answering, the direct origin is never sent anything', async () => {
    const r = await renderAt(sessionFragment(), onlyRows);
    await until(() => text().includes('Handover'));
    expect(r.sent.map((s) => s.origin)).toEqual([API]);
  });
});

describe('the handover load — "Try again", and a kept session', () => {
  test('plant — both origins down shows the connection-failed sentence and a Try again button; the session is not ended', async () => {
    const m = await import('../../apps/ward-console/src/main.js');
    await renderAt(sessionFragment(), () => down());
    await until(() => text().includes('Could not load the handover list'));
    expect(text()).toContain(m.UNREACHABLE_LOAD);
    expect(text(), 'a kept session was shown as ended').not.toContain('Your session has ended');
    const again = document.querySelector('#app > button') as HTMLButtonElement | null;
    expect(again?.textContent).toBe('Try again');
    expect(again?.className, "Try again is the design system's primary button").toBe('primary');
    expect(again?.type).toBe('button');
    expect(document.querySelector('#app > p.notice-caution')?.textContent, 'the sentence is a caution Notice').toBe(m.UNREACHABLE_LOAD);
  });

  test('plant — Try again re-runs the load with the SAME holder, never reloads the page, and shows the handover once it works', async () => {
    const r = await renderAt(sessionFragment(), () => down());
    await until(() => document.querySelector('#app > button') !== null);
    const firstToken = new Headers(r.sent[0]?.init?.headers).get('Authorization');
    expect(firstToken, 'the first load carried no bearer token').toMatch(/^Bearer /);
    const before = r.sent.length;
    r.setHandler(onlyRows);
    (document.querySelector('#app > button') as HTMLButtonElement).click();
    await until(() => text().includes('Handover'));
    const retried = r.sent.slice(before).filter((s) => is(s, '/rest/v1/rpc/my_reporting_wards'));
    expect(retried.length, 'Try again did not re-run the load').toBeGreaterThan(0);
    expect(new Headers(retried[0]?.init?.headers).get('Authorization'), 'the retry used a different holder or token').toBe(firstToken);
    expect(text(), 'the retry fell back to the sign-in screen').not.toContain('Send a new sign-in link');
    // The source holds no reload call at all: a reload ends the session, which lives in memory only.
    const src = readFileSync(join(REPO_ROOT, 'apps/ward-console/src/main.ts'), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(src, 'main.ts calls location.reload').not.toMatch(/location\s*\.\s*reload|\.reload\s*\(/);
  });

  test('plant — a renewal that is only "not now" on the load shows the kept-session sentence and Try again, and sends nothing but the refresh', async () => {
    const m = await import('../../apps/ward-console/src/main.js');
    const r = await renderAt(sessionFragment(20), (s) => (s.path.startsWith('/auth/v1/token') ? json(503, { msg: 'unavailable' }) : json(500, {})));
    await until(() => text().includes('Could not load the handover list'));
    expect(text()).toContain(m.RENEWAL_UNAVAILABLE_LOAD);
    expect(document.querySelector('#app > button')?.textContent).toBe('Try again');
    expect(r.sent.filter((s) => s.path.startsWith('/auth/v1/token')).length, 'a "not now" refresh was retried').toBe(1);
    expect(r.sent.filter((s) => is(s, '/rest/v1/rpc/my_reporting_wards')).length, 'the load was sent with a spent token').toBe(0);
  });

  test('control — an unrecognised failure still reads the one fixed fallback, with no Try again', async () => {
    const m = await import('../../apps/ward-console/src/main.js');
    await renderAt(sessionFragment(), () => json(502, { message: 'upstream' }));
    await until(() => text().includes('Could not load'));
    expect(text()).toContain(m.UNRECOGNISED);
    expect(document.querySelector('#app > button')).toBeNull();
  });
});

describe('a publish — the new errors keep the session and the form\'s mutation id', () => {
  const tapPublish = (): void => (document.querySelector('form.publish button[type="submit"]') as HTMLButtonElement).click();
  const statusText = (): string => document.querySelector('form.publish p.status')?.textContent ?? '';

  async function oneWard(fragment: string, handler: Handler) {
    const r = await renderAt(fragment, handler);
    await until(() => document.querySelector('form.publish') !== null);
    return r;
  }

  test('plant — both origins down on a publish: the connection-failed sentence, the mutation id unchanged, and the next tap re-sends the SAME id', async () => {
    const m = await import('../../apps/ward-console/src/main.js');
    const ids: string[] = [];
    const real = crypto.randomUUID.bind(crypto);
    vi.spyOn(crypto, 'randomUUID').mockImplementation((() => { const id = real(); ids.push(id); return id; }) as typeof crypto.randomUUID);
    const r = await oneWard(sessionFragment(), (s) => (is(s, '/rest/v1/rpc/publish_ward_status') ? down() : onlyRows(s)));
    const minted = ids.length;
    tapPublish();
    await until(() => statusText() !== '');
    expect(statusText()).toBe(m.UNREACHABLE_PUBLISH);
    expect(document.querySelector('form.publish p.status')?.classList.contains('notice-caution'), 'the sentence is a caution Notice').toBe(true);
    expect(ids.length, 'a failed publish minted a new mutation id').toBe(minted);
    expect(text(), 'a kept session was shown as ended').not.toContain('Your session has ended');
    const firstSends = publishSends(r.sent);
    expect(firstSends.map((s) => s.origin), 'the publish must have been tried at the Worker, then the direct origin').toEqual([API, DIRECT]);
    r.setHandler((s) => (is(s, '/rest/v1/rpc/publish_ward_status') ? json(200, PUBLISHED) : onlyRows(s)));
    tapPublish();
    await until(() => statusText() === 'Published.');
    const resent = bodyOf(publishSends(r.sent).at(-1));
    expect(resent['p_client_mutation_id'], 'the retry did not carry the first attempt\'s mutation id').toBe(bodyOf(firstSends[0])['p_client_mutation_id']);
    expect(ids.length, 'a new id is minted only after a success').toBe(minted + 1);
  });

  test('plant — a renewal that is only "not now" on a publish: the kept-session sentence, nothing sent, the mutation id unchanged, and the next tap publishes', async () => {
    const m = await import('../../apps/ward-console/src/main.js');
    const ids: string[] = [];
    const real = crypto.randomUUID.bind(crypto);
    vi.spyOn(crypto, 'randomUUID').mockImplementation((() => { const id = real(); ids.push(id); return id; }) as typeof crypto.randomUUID);
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    // 65 s left at load: outside the 60 s skew, so the load needs no refresh.
    const r = await oneWard(sessionFragment(65), (s) => {
      if (s.path.startsWith('/auth/v1/token')) return json(503, { msg: 'unavailable' });
      if (is(s, '/rest/v1/rpc/publish_ward_status')) return json(200, PUBLISHED);
      return onlyRows(s);
    });
    const minted = ids.length;
    vi.setSystemTime(Date.now() + 40_000); // the token now has about 25 s left: inside the 30 s the holder will keep
    tapPublish();
    await until(() => statusText() !== '');
    expect(statusText()).toBe(m.RENEWAL_UNAVAILABLE_PUBLISH);
    expect(publishSends(r.sent).length, 'a publish was sent with a token the holder would not keep').toBe(0);
    expect(ids.length, 'a failed publish minted a new mutation id').toBe(minted);
    expect(text(), 'a kept session was shown as ended').not.toContain('Your session has ended');
    // The renewal works now: the same tap publishes, with the id the form already held.
    r.setHandler((s) => {
      if (s.path.startsWith('/auth/v1/token')) {
        const now = Math.floor(Date.now() / 1000);
        const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: '11111111-1111-4111-8111-111111111111', session_id: '22222222-2222-4222-8222-renewed00000', exp: now + 3600, iat: now, role: 'authenticated', email: 'ward@example.invalid' })}.sig`;
        return json(200, { access_token: token, refresh_token: 'r-renewed', expires_in: 3600, expires_at: now + 3600, token_type: 'bearer' });
      }
      return is(s, '/rest/v1/rpc/publish_ward_status') ? json(200, PUBLISHED) : onlyRows(s);
    });
    tapPublish();
    await until(() => statusText() === 'Published.');
    expect(publishSends(r.sent).length).toBe(1);
    expect(ids.length, 'a new id is minted only after a success').toBe(minted + 1);
  });

  test('plant — a publish is sent exactly once in effect: the fallback re-sends the SAME body, p_composed_at included, with the clock moving between the two sends', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    let moved = 0;
    const r = await oneWard(sessionFragment(), (s) => {
      if (is(s, '/rest/v1/rpc/publish_ward_status')) {
        if (s.origin === API) {
          vi.setSystemTime(Date.now() + 5000); // the clock moves between the two sends
          moved += 5000;
          return down();
        }
        return json(200, PUBLISHED);
      }
      return onlyRows(s);
    });
    tapPublish();
    // A deadline well past the 5 s the stub moves the faked clock by: `until` measures its deadline on that clock.
    await until(() => statusText() === 'Published.', 60_000);
    const sends = publishSends(r.sent);
    expect(sends.map((s) => s.origin)).toEqual([API, DIRECT]);
    expect(moved, 'the clock did not move, so equal composed_at proves nothing').toBe(5000);
    expect(String(sends[1]?.init?.body), 'the re-send changed the body').toBe(String(sends[0]?.init?.body));
    expect(bodyOf(sends[1])['p_composed_at']).toBe(bodyOf(sends[0])['p_composed_at']);
    expect(bodyOf(sends[1])['p_client_mutation_id']).toBe(bodyOf(sends[0])['p_client_mutation_id']);
  });
});

describe('the sign-in request falls back like every other call, and the Worker\'s own limit is one send', () => {
  async function ask(handler: Handler): Promise<Sent[]> {
    const r = await renderAt('', handler);
    const form = document.querySelector('form.signin-request') as HTMLFormElement;
    (form.querySelector('input[name="email"]') as HTMLInputElement).value = 'ward@example.invalid';
    (form.querySelector('button') as HTMLButtonElement).click();
    await until(() => (form.querySelector('p.status')?.textContent ?? '') !== '');
    return r.sent;
  }
  const status = (): string => document.querySelector('form.signin-request p.status')?.textContent ?? '';

  test('plant — with the Worker down, a request for a link reaches the direct origin and gets the ordinary answered sentence', async () => {
    const m = await import('../../apps/ward-console/src/main.js');
    const sent = await ask((s) => (s.origin === API ? down() : json(200, {})));
    expect(sent.map((s) => s.origin)).toEqual([API, DIRECT]);
    expect(status()).toBe(m.SIGNIN_ANSWERED);
  });

  test("plant — the Worker's own `limited` shows the new sentence, is sent exactly once, and never reaches the direct origin", async () => {
    const m = await import('../../apps/ward-console/src/main.js');
    const sent = await ask(() => json(429, { message: 'rate limited by the OpenBed proxy' }, { 'x-openbed-proxy': 'limited' }));
    expect(status()).toBe(m.SIGNIN_LIMITED_WORDS);
    expect(sent.length, 'a limited request was retried or sent to the fallback').toBe(1);
    expect(sent[0]?.origin).toBe(API);
    expect(document.querySelector('form.signin-request p.status')?.classList.contains('notice-caution')).toBe(true);
  });
});

/**
 * R-2026-10-02-FG FG-4 (-183). An edit after a failed send gets a NEW mutation id, so an edited body never rides a
 * stale id into 026's step-6 replay; a re-tap with no edit keeps the id; and a response body that fails to read is
 * the connection failing, not an unrecognised answer. Same file, same production-host jsdom, same seam: an injected
 * fetch answering by origin.
 */
describe('FG-4 — an edit after a failed send mints; a body that fails to read is the connection failing', () => {
  const tapPublish = (): void => (document.querySelector('form.publish button[type="submit"]') as HTMLButtonElement).click();
  const statusText = (): string => document.querySelector('form.publish p.status')?.textContent ?? '';
  const countField = (): HTMLInputElement => document.querySelector('form.publish input[name="bed_count"]') as HTMLInputElement;
  const plusStepper = (): HTMLButtonElement => Array.from(document.querySelectorAll('form.publish button.stepper'))[1] as HTMLButtonElement;
  const erroringBody = (status = 200): Response => new Response(new ReadableStream({ start: (c) => c.error(new TypeError('terminated')) }), { status });

  function idSpy(): string[] {
    const ids: string[] = [];
    const real = crypto.randomUUID.bind(crypto);
    vi.spyOn(crypto, 'randomUUID').mockImplementation((() => {
      const id = real();
      ids.push(id);
      return id;
    }) as typeof crypto.randomUUID);
    return ids;
  }
  async function oneWard(handler: Handler) {
    const r = await renderAt(sessionFragment(), handler);
    await until(() => document.querySelector('form.publish') !== null);
    return r;
  }
  const publishDown: Handler = (s) => (is(s, '/rest/v1/rpc/publish_ward_status') ? down() : onlyRows(s));
  const publishOk: Handler = (s) => (is(s, '/rest/v1/rpc/publish_ward_status') ? json(200, PUBLISHED) : onlyRows(s));
  const sentIds = (sent: Sent[]): unknown[] => publishSends(sent).map((s) => bodyOf(s)['p_client_mutation_id']);

  test('plant — fail, edit the count by TYPING, tap: a new id, and the new count in the body', async () => {
    const ids = idSpy();
    const r = await oneWard(publishDown);
    tapPublish();
    await until(() => statusText() !== '');
    expect(statusText(), 'the connection failure was not shown').toContain('may not have been sent');
    const minted = ids.length;
    countField().value = '11';
    countField().dispatchEvent(new Event('input', { bubbles: true }));
    expect(ids.length, 'an edit after a failed send did not mint a new id').toBe(minted + 1);
    r.setHandler(publishOk);
    tapPublish();
    await until(() => statusText() === 'Published.');
    const last = publishSends(r.sent).at(-1);
    expect(bodyOf(last)['p_bed_count'], 'the edited count was not the one sent').toBe(11);
    expect(bodyOf(last)['p_client_mutation_id'], 'the edited body rode the stale id').toBe(ids[minted]);
    expect(bodyOf(last)['p_client_mutation_id']).not.toBe(sentIds(r.sent)[0]);
  });

  test('plant — fail, edit with the + STEPPER, tap: a new id', async () => {
    const ids = idSpy();
    const r = await oneWard(publishDown);
    tapPublish();
    await until(() => statusText() !== '');
    const minted = ids.length;
    plusStepper().click();
    expect(ids.length, 'the stepper is an edit and did not mint').toBe(minted + 1);
    r.setHandler(publishOk);
    tapPublish();
    await until(() => statusText() === 'Published.');
    expect(bodyOf(publishSends(r.sent).at(-1))['p_client_mutation_id']).toBe(ids[minted]);
  });

  test('plant — fail, tap AGAIN with no edit: the SAME id, so it still replays', async () => {
    const ids = idSpy();
    const r = await oneWard(publishDown);
    tapPublish();
    await until(() => statusText() !== '');
    const minted = ids.length;
    r.setHandler(publishOk);
    tapPublish();
    await until(() => statusText() === 'Published.');
    expect(ids.length - minted, 'a re-tap with no edit minted: only the success mints').toBe(1);
    const sent = sentIds(r.sent);
    expect(new Set(sent).size, 'a re-tap with no edit sent a different id').toBe(1);
  });

  test('control — succeed, then edit: a new id after the success as today, and the edit mints nothing more', async () => {
    const ids = idSpy();
    await oneWard(publishOk);
    const initial = ids.length;
    tapPublish();
    await until(() => statusText() === 'Published.');
    expect(ids.length, 'success mints one new id, as before').toBe(initial + 1);
    countField().value = '12';
    countField().dispatchEvent(new Event('input', { bubbles: true }));
    expect(ids.length, 'an edit after a SUCCESS minted a second id').toBe(initial + 1);
  });

  test('plant — a publish answer whose body fails to read is UNREACHABLE_PUBLISH, the id is kept, and the next edit mints', async () => {
    const m = await import('../../apps/ward-console/src/main.js');
    const ids = idSpy();
    await oneWard((s) => (is(s, '/rest/v1/rpc/publish_ward_status') ? erroringBody() : onlyRows(s)));
    const minted = ids.length;
    tapPublish();
    await until(() => statusText() !== '');
    expect(statusText(), 'a body that failed to read was shown as UNRECOGNISED, which tells a ward to reload and end the session').toBe(m.UNREACHABLE_PUBLISH);
    expect(statusText()).not.toContain('Reload the page');
    expect(ids.length, 'the id was not kept').toBe(minted);
    countField().value = '9';
    countField().dispatchEvent(new Event('input', { bubbles: true }));
    expect(ids.length, 'the failed send armed the mint').toBe(minted + 1);
  });

  test('plant — a handover answer whose body fails to read is UNREACHABLE_LOAD with Try again', async () => {
    const m = await import('../../apps/ward-console/src/main.js');
    await renderAt(sessionFragment(), (s) => (is(s, '/rest/v1/rpc/my_reporting_wards') ? erroringBody() : json(500, {})));
    await until(() => text().includes('Could not load the handover list'));
    expect(text()).toContain(m.UNREACHABLE_LOAD);
    expect(text()).not.toContain('Reload the page');
    expect(document.querySelector('#app > button')?.textContent).toBe('Try again');
  });

  test('control — a body that READS but is not JSON is still UNRECOGNISED, at both sites', async () => {
    const m = await import('../../apps/ward-console/src/main.js');
    await oneWard((s) => (is(s, '/rest/v1/rpc/publish_ward_status') ? new Response('<html>nope</html>', { status: 200 }) : onlyRows(s)));
    tapPublish();
    await until(() => statusText() !== '');
    expect(statusText()).toBe(m.UNRECOGNISED);
    await renderAt(sessionFragment(), (s) => (is(s, '/rest/v1/rpc/my_reporting_wards') ? new Response('<html>nope</html>', { status: 200 }) : json(500, {})));
    await until(() => text().includes('Could not load the handover list'));
    expect(text()).toContain(m.UNRECOGNISED);
    expect(document.querySelector('#app > button'), 'a malformed answer is not a connection failure, so no Try again').toBeNull();
  });
});
