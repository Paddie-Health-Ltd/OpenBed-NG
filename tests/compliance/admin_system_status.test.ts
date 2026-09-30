// @vitest-environment jsdom
/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';
import ADMIN_LABELS from '../../packages/labels/admin-labels.json';
import { SNAPSHOT_JOB } from '../../packages/snapshot/src/health.js';
import { FUTURE_TOLERANCE_MS, lagosTime } from '../../packages/snapshot/src/index.js';
import { parseSchedulerStatus } from '../../apps/admin/src/parse.js';

/**
 * THE ADMIN "SYSTEM STATUS" SECTION (R-2026-09-30-175 EY-3), rendered under jsdom with fetch
 * stubbed per RPC name, in the pattern of tests/compliance/admin_render.test.ts.
 *
 * WHAT IS ASSERTED, and each plant's neuter (the line it changes, so a PLANT's red is the
 * behaviour changing and not the bytes):
 *   - a healthy status shows the two ages, five job rows and NO caution line;
 *   - a STALE snapshot shows the Notice, and its displayed age is the snapshotAge of the
 *     database's own two timestamps. Neuters: statusSection's `snapshot_stale` arm removed
 *     (no Notice); snapshotAge(...) replaced by a literal 3 in ageLine (the age reads 3);
 *   - the boundary is BANDS.snapshotBannerAfterMinutes, DERIVED from the fixture: one second
 *     under it shows no Notice, one second over it shows one;
 *   - a SWITCHED-OFF job shows its own line, once (the snapshot job's line is the decision's
 *     job_inactive and is not repeated); a job whose last run did not succeed shows its line;
 *     a missing snapshot job shows the missing-job line;
 *   - a FUTURE generated_at shows the Notice and reads "age not known", never a clamped zero.
 *     Neuter: the `snapshot_age_s === null` guard removed (the age reads "less than a minute");
 *   - a STATUS-LOAD FAILURE is a caution statusLine INSIDE the section, and the register still
 *     renders, in full. Neuter: the failure line replaced by an empty section;
 *   - and the reverse: a register that cannot be read leaves the section on the page;
 *   - Reload reloads both.
 *
 * NOT ASSERTED HERE, deliberately: that the alert and this page agree in every state. That
 * is by construction (both call decideHealth) and tests/compliance/health_decision.test.ts
 * holds the decision; a second copy of its truth table here would be a second place to drift.
 */

const SERVER_NOW = '2026-09-24T12:00:00.000Z';
const BANNER_S = SHAPE.freshnessBands.snapshotBannerAfterMinutes * 60;
const W = ADMIN_LABELS.screens;
const F = ADMIN_LABELS.fixed;
const FAC_A = '0a000000-0000-4000-8000-0000000000aa';
const FAC_B = '0a000000-0000-4000-8000-0000000000bb';

const JOB_NAMES = ['openbed_check_withdrawn_facility_accounts', 'openbed_erase_lapsed_ward_logins', 'openbed_prune_ended_auth_sessions', 'openbed_refresh_lga_rollup', SNAPSHOT_JOB];
const RUN_AT = '2026-09-24T11:59:00.000Z';

const secondsBefore = (s: number): string => new Date(Date.parse(SERVER_NOW) - s * 1000).toISOString();

interface Job {
  name: string;
  active: boolean;
  schedule: string;
  last_status: string | null;
  last_start_time: string | null;
}
interface Status {
  server_now: string;
  generated_at: string | null;
  last_snapshot_at: string | null;
  jobs: Job[];
}

function healthy(over: Partial<Status> = {}): Status {
  return {
    server_now: SERVER_NOW,
    generated_at: secondsBefore(30),
    last_snapshot_at: secondsBefore(30),
    jobs: JOB_NAMES.map((name) => ({ name, active: true, schedule: '* * * * *', last_status: 'succeeded', last_start_time: RUN_AT })),
    ...over,
  };
}
const withJob = (name: string, over: Partial<Job>): Job[] => healthy().jobs.map((j) => (j.name === name ? { ...j, ...over } : j));

function facility(id: string, name: string): Record<string, unknown> {
  return {
    facility_id: id, name, lga: 'Ikeja', state: 'Lagos', lat: 6.6, lng: 3.35, public_phone_e164: '+2348000000301', version: 4,
    listed_at: SERVER_NOW, is_active: true, has_contact: true, agreement_state: 'recorded', categories: [],
    reporting_model: 'NONE', reporter_login: 'none', hefamaa_reg_no: null,
  };
}
const REGISTER = { server_now: SERVER_NOW, retention_alert: [], facilities: [facility(FAC_A, 'Facility A'), facility(FAC_B, 'Facility B')] };

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** A body that is not JSON, answered as a success (EZ-1). */
const html200 = (): Response => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });

/** A body cut off mid-read: the stream errors after its first bytes, so res.json() / res.text() reject (EZ-1). */
const cutOff = (status: number): Response =>
  new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"server_now":'));
        c.error(new TypeError('cut off mid-read'));
      },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );

/** The server: the register and the status, each answering as `over` says, by RPC name. */
function server(over: { register?: Route; status?: Route | Status } = {}): Route {
  return (url, init) => {
    const fn = /\/rpc\/([a-z_]+)$/.exec(url)?.[1] ?? '';
    if (fn === 'operator_register') return over.register === undefined ? json(200, REGISTER) : over.register(url, init);
    if (fn === 'operator_scheduler_status') {
      const s = over.status ?? healthy();
      return typeof s === 'function' ? s(url, init) : json(200, s);
    }
    return json(500, { message: 'unexpected call' });
  };
}

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function sessionFragment(): string {
  const now = Math.floor(Date.now() / 1000);
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    sub: '11111111-1111-4111-8111-111111111111', session_id: '22222222-2222-4222-8222-222222222222',
    exp: now + 3600, iat: now, role: 'authenticated', email: 'operator@example.invalid',
  })}.sig`;
  return `#access_token=${token}&refresh_token=r1&expires_at=${now + 3600}&token_type=bearer`;
}

async function renderAt(route: Route) {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/${sessionFragment()}`);
  const stub = vi.fn(async (url: string | URL, init?: RequestInit) => route(String(url), init));
  vi.stubGlobal('fetch', stub);
  const { render } = await import('../../apps/admin/src/main.js');
  await render();
  await until(() => document.querySelector('section.system-status') !== null);
  return stub;
}

async function until(cond: () => boolean, deadlineMs = 5000): Promise<void> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`the page never reached the expected state. It reads: ${(document.body.textContent ?? '').slice(0, 400)}`);
}

const callCount = (stub: ReturnType<typeof vi.fn>, fn: string): number => stub.mock.calls.filter(([u]) => String(u).endsWith(`/rpc/${fn}`)).length;

/** The section, or a failure that says it is not there: an absent section must never read as a clean one. */
function section(): HTMLElement {
  const s = document.querySelector<HTMLElement>('section.system-status');
  if (s === null) throw new Error('there is no System status section on the page, so nothing about it can be asserted');
  return s;
}
const cautions = (): string[] => Array.from(section().querySelectorAll('p.system-caution')).map((p) => p.textContent ?? '');
const ageLines = (): string[] => Array.from(section().querySelectorAll('p.system-age')).map((p) => p.textContent ?? '');
const jobRows = (): string[] => Array.from(section().querySelectorAll('ul.system-jobs li')).map((li) => li.textContent ?? '');
const facilityCount = (): number => document.querySelectorAll('li.facility').length;

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the System status section, healthy', () => {
  test('real healthy status is accepted — two ages, five job rows in the server\'s order, no caution line', async () => {
    await renderAt(server());
    expect(section().querySelector('h2')?.textContent).toBe(W.SYSTEM_STATUS_HEADING);
    expect(cautions(), cautions().join(' | ')).toEqual([]);
    expect(ageLines()).toEqual([`${W.SNAPSHOT_LABEL}: ${W.AGE_UNDER_MINUTE}`, `${W.HEARTBEAT_LABEL}: ${W.AGE_UNDER_MINUTE}`]);
    expect(jobRows()).toEqual(JOB_NAMES.map((n) => `${n}: ${W.JOB_RUNNING} — ${W.JOB_LAST_RUN} succeeded, ${lagosTime(RUN_AT)}`));
    const line = section().querySelector('p.status');
    expect(line?.textContent, 'the status line must be empty when the status was read').toBe('');
    expect(line?.getAttribute('role')).toBe('status');
  });

  test('anti-vacuity — a page with no System status section fails the check rather than passing it', async () => {
    await renderAt(server());
    section().remove();
    expect(() => cautions()).toThrow('there is no System status section');
  });
});

describe('a stale snapshot', () => {
  test('plant — a snapshot 47 minutes old shows the Notice, its age from snapshotAge, and the register is untouched', async () => {
    await renderAt(server({ status: healthy({ generated_at: secondsBefore(47 * 60) }) }));
    expect(cautions(), cautions().join(' | ')).toEqual([W.STALE_NOTICE]);
    // The displayed age is the snapshotAge of the two database timestamps, plus the elapsed
    // time since the fetch (milliseconds here). A literal in its place reads a different number.
    expect(ageLines()[0]).toBe(`${W.SNAPSHOT_LABEL}: 47 ${W.AGE_MINUTES}`);
    expect(facilityCount(), 'the status must never filter the register').toBe(2);
  });

  test('the boundary is the banner threshold from the fixture — one second under shows no Notice, one second over shows one', async () => {
    await renderAt(server({ status: healthy({ generated_at: secondsBefore(BANNER_S - 1) }) }));
    expect(cautions(), 'a snapshot one second under the banner threshold read as stale').toEqual([]);
    await renderAt(server({ status: healthy({ generated_at: secondsBefore(BANNER_S + 1) }) }));
    expect(cautions(), 'a snapshot one second over the banner threshold did not read as stale').toEqual([W.STALE_NOTICE]);
  });

  test('plant — no snapshot at all is stale, and says so', async () => {
    await renderAt(server({ status: healthy({ generated_at: null }) }));
    expect(cautions()).toEqual([W.STALE_NOTICE]);
    expect(ageLines()[0]).toBe(W.SNAPSHOT_NONE);
  });

  test('plant — a generated_at in the FUTURE shows the Notice and an age that is not known, never zero', async () => {
    await renderAt(server({ status: healthy({ generated_at: new Date(Date.parse(SERVER_NOW) + 60_000).toISOString() }) }));
    expect(cautions(), 'a future generated_at did not raise the Notice /api/health raises').toEqual([W.STALE_NOTICE]);
    expect(ageLines()[0]).toBe(`${W.SNAPSHOT_LABEL}: ${W.AGE_NOT_KNOWN}`);
  });
});

describe('the heartbeat is its own line (R-2026-09-30-176 EZ-2)', () => {
  test('plant — the heartbeat reads from ITS OWN timestamp: 10 minutes, beside a snapshot under a minute', async () => {
    await renderAt(server({ status: healthy({ generated_at: secondsBefore(30), last_snapshot_at: secondsBefore(600) }) }));
    // The fixture's two timestamps are one instant, so a view that read the snapshot's for both would pass.
    expect(ageLines()).toEqual([`${W.SNAPSHOT_LABEL}: ${W.AGE_UNDER_MINUTE}`, `${W.HEARTBEAT_LABEL}: 10 ${W.AGE_MINUTES}`]);
    expect(cautions(), 'an old heartbeat beside a fresh snapshot is not the alert\'s reason').toEqual([]);
  });

  test('plant — a heartbeat in the FUTURE reads "age not known", never a clamped zero', async () => {
    const ahead = new Date(Date.parse(SERVER_NOW) + FUTURE_TOLERANCE_MS + 1).toISOString();
    await renderAt(server({ status: healthy({ last_snapshot_at: ahead }) }));
    expect(ageLines()[1]).toBe(`${W.HEARTBEAT_LABEL}: ${W.AGE_NOT_KNOWN}`);
  });

  test('a heartbeat exactly FUTURE_TOLERANCE_MS ahead is still an age, the boundary the decision uses', async () => {
    const edge = new Date(Date.parse(SERVER_NOW) + FUTURE_TOLERANCE_MS).toISOString();
    await renderAt(server({ status: healthy({ last_snapshot_at: edge }) }));
    expect(ageLines()[1]).toBe(`${W.HEARTBEAT_LABEL}: ${W.AGE_UNDER_MINUTE}`);
  });

  test('plant — a null heartbeat is a line saying "age not known", never nothing', async () => {
    await renderAt(server({ status: healthy({ last_snapshot_at: null }) }));
    expect(ageLines()).toEqual([`${W.SNAPSHOT_LABEL}: ${W.AGE_UNDER_MINUTE}`, `${W.HEARTBEAT_LABEL}: ${W.AGE_NOT_KNOWN}`]);
  });
});

describe('the jobs', () => {
  test('plant — a switched-off job shows its line and its row reads Switched off', async () => {
    await renderAt(server({ status: healthy({ jobs: withJob('openbed_refresh_lga_rollup', { active: false }) }) }));
    expect(cautions()).toEqual([`${W.JOB_INACTIVE_LEAD} openbed_refresh_lga_rollup. ${W.SCHEDULER_ACTION}`]);
    expect(jobRows().find((r) => r.startsWith('openbed_refresh_lga_rollup:'))).toContain(W.JOB_SWITCHED_OFF);
  });

  test('plant — the snapshot job switched off shows ONE line, from the decision, and the snapshot Notice is not raised for it alone', async () => {
    await renderAt(server({ status: healthy({ jobs: withJob(SNAPSHOT_JOB, { active: false }) }) }));
    expect(cautions(), cautions().join(' | ')).toEqual([`${W.JOB_INACTIVE_LEAD} ${SNAPSHOT_JOB}. ${W.SCHEDULER_ACTION}`]);
  });

  test('plant — a job whose last finished run failed shows its line, though the alert does not raise it', async () => {
    await renderAt(server({ status: healthy({ jobs: withJob('openbed_erase_lapsed_ward_logins', { last_status: 'failed' }) }) }));
    expect(cautions()).toEqual([`${W.JOB_FAILED_LEAD} openbed_erase_lapsed_ward_logins. ${W.SCHEDULER_ACTION}`]);
  });

  test('plant — a missing snapshot job shows the missing-job line', async () => {
    await renderAt(server({ status: healthy({ jobs: healthy().jobs.filter((j) => j.name !== SNAPSHOT_JOB) }) }));
    expect(cautions()).toEqual([`${W.JOB_MISSING_LEAD} ${SNAPSHOT_JOB}. ${W.SCHEDULER_ACTION}`]);
  });

  test('a job with no finished run is shown as such, and is not a caution', async () => {
    await renderAt(server({ status: healthy({ jobs: withJob('openbed_prune_ended_auth_sessions', { last_status: null, last_start_time: null }) }) }));
    expect(cautions()).toEqual([]);
    expect(jobRows().find((r) => r.startsWith('openbed_prune_ended_auth_sessions:'))).toBe(`openbed_prune_ended_auth_sessions: ${W.JOB_RUNNING} — ${W.JOB_NO_RUN}`);
  });
});

describe('the two loads fail on their own', () => {
  test.each<[string, Route, string]>([
    ['a 500 the page does not recognise', () => json(500, { message: 'unexpected' }), F.UNRECOGNISED],
    ['no answer at all', () => { throw new TypeError('down'); }, F.UNREACHABLE],
    ['a status that is not the shape 027 returns', () => json(200, { server_now: SERVER_NOW }), F.UNRECOGNISED],
    ['a function that is not on the server', () => json(404, { code: 'PGRST202', message: 'not found' }), F.FUNCTION_MISSING],
    // EZ-2 c: a status whose server_now is not a time is unreadable, never a healthy-looking section.
    ['a status whose server_now is not a time', () => json(200, healthy({ server_now: 'not a time' })), F.UNRECOGNISED],
    // EZ-1 (R-2026-09-30-176): a body that cannot be READ is the section's own failure, never the page's.
    ['a 200 whose body is not JSON', html200, F.UNRECOGNISED],
    ['a 200 whose body is cut off mid-read', () => cutOff(200), F.UNRECOGNISED],
    ['a refusal whose body is cut off mid-read', () => cutOff(500), F.UNRECOGNISED],
  ])('plant — %s is a caution statusLine INSIDE the section, and the register still renders', async (_name, status, sentence) => {
    await renderAt(server({ status }));
    const line = section().querySelector('p.status');
    expect(line?.textContent).toBe(sentence);
    expect(line?.classList.contains('notice-caution'), 'the failure is not a caution').toBe(true);
    expect(facilityCount(), 'a failed status load hid the register').toBe(2);
    expect(document.querySelector('h1')?.textContent).toBe(W.REGISTER_HEADING);
  });

  test.each<[string, Route, string]>([
    ['a register the page does not recognise', () => json(500, { message: 'unexpected' }), F.UNRECOGNISED],
    ['a register that could not be reached', () => { throw new TypeError('down'); }, F.UNREACHABLE],
    // EZ-1: the register's own UNRECOGNISED, exactly as an unrecognised shape is, with the section present.
    ['a register that is not the shape the register returns', () => json(200, { server_now: SERVER_NOW }), F.UNRECOGNISED],
    ['a register answering a 200 whose body is not JSON', html200, F.UNRECOGNISED],
    ['a register whose 200 body is cut off mid-read', () => cutOff(200), F.UNRECOGNISED],
    ['a register refusal whose body is cut off mid-read', () => cutOff(500), F.UNRECOGNISED],
  ])('plant — %s leaves the System status on the page, under its sentence', async (_name, register, sentence) => {
    await renderAt(server({ register }));
    expect(document.querySelector('#app > p.notice-caution')?.textContent).toBe(sentence);
    expect(facilityCount()).toBe(0);
    expect(cautions()).toEqual([]);
    expect(jobRows()).toHaveLength(5);
  });

  test('Reload reloads BOTH: the register and the status are each read again', async () => {
    const stub = await renderAt(server());
    expect([callCount(stub, 'operator_register'), callCount(stub, 'operator_scheduler_status')]).toEqual([1, 1]);
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent === W.RELOAD)?.click();
    await until(() => callCount(stub, 'operator_scheduler_status') === 2);
    expect([callCount(stub, 'operator_register'), callCount(stub, 'operator_scheduler_status')]).toEqual([2, 2]);
  });
});

describe('parseSchedulerStatus reads exactly the shape 027 returns', () => {
  const REAL = healthy();
  test('real status is accepted', () => {
    expect(parseSchedulerStatus(REAL)).toMatchObject({ serverNow: SERVER_NOW, jobs: expect.any(Array) });
    expect(parseSchedulerStatus(REAL)?.jobs).toHaveLength(5);
  });
  test.each<[string, (s: Status) => unknown]>([
    ['a missing server_now', (s) => ({ ...s, server_now: undefined })],
    ['a numeric generated_at', (s) => ({ ...s, generated_at: 3 })],
    ['a jobs value that is not an array', (s) => ({ ...s, jobs: {} })],
    ['a job with no active flag', (s) => ({ ...s, jobs: [{ ...s.jobs[0], active: undefined }] })],
    ['a job that is not an object', (s) => ({ ...s, jobs: [...s.jobs, 'x'] })],
    ['an array in place of the object', () => []],
  ])('plant — %s is unreadable', (_name, plant) => {
    const planted = plant(REAL);
    expect(planted, 'the plant did not change the input').not.toEqual(REAL);
    expect(parseSchedulerStatus(planted)).toBeNull();
  });
  // EZ-2 c (R-2026-09-30-176): a timestamp that is not one is unreadable, so the section says so and
  // the decision's probe_failed is never silent.
  test.each<[string, (s: Status) => unknown]>([
    ['a server_now that is not a time', (s) => ({ ...s, server_now: 'not a time' })],
    ['a generated_at that is not a time', (s) => ({ ...s, generated_at: 'yesterday-ish' })],
    ['a last_snapshot_at that is not a time', (s) => ({ ...s, last_snapshot_at: 'soon' })],
    ['a job last_start_time that is not a time', (s) => ({ ...s, jobs: [{ ...s.jobs[0], last_start_time: 'later' }, ...s.jobs.slice(1)] })],
  ])('plant — %s is unreadable', (_name, plant) => {
    const planted = plant(REAL);
    expect(planted, 'the plant did not change the input').not.toEqual(REAL);
    expect(parseSchedulerStatus(planted)).toBeNull();
  });
  test('null timestamps stay readable: a never-generated snapshot, no heartbeat, a job with no run', () => {
    const s = healthy({ generated_at: null, last_snapshot_at: null, jobs: withJob('openbed_prune_ended_auth_sessions', { last_status: null, last_start_time: null }) });
    expect(parseSchedulerStatus(s)).not.toBeNull();
  });
  test('anti-vacuity — null and an empty object are unreadable rather than an empty status', () => {
    expect(parseSchedulerStatus(null)).toBeNull();
    expect(parseSchedulerStatus({})).toBeNull();
  });
});
