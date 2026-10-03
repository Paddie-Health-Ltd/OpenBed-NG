import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { OriginsUnreachableError, RenewalUnavailableError, SessionHolder, type Session } from '@openbed/auth';
import { submitPublish, type PublishForm, type WardRow } from '../../apps/ward-console/src/publish.js';
import LIST from '../../supabase-proxy/allow-list.json';
import { makeHandler, type AllowList, type ProxyEnv } from '../../supabase-proxy/handler.js';
import { signInWard, type WardSession } from '../setup/auth.js';
import { sql } from '../setup/db.js';
import { anonKey, apiUrl } from '../setup/local-keys.js';

/**
 * A LOCAL PLANT TAKES THE WORKER AWAY AND A PUBLISH STILL LANDS EXACTLY ONCE
 * (R-2026-10-02-FF FF-4 f, -182): the kickoff's definition of done for D5, run against the local stack.
 *
 * THE SETUP, each part real:
 *   - the PRIMARY origin is supabase-proxy/handler.ts's own makeHandler, built from the real allow-list and served
 *     from an in-process node:http server (a small adapter turns the request into a web Request and the Response
 *     back into bytes). It is the code that runs at api.openbed.ng, with its upstream fetch pointed at the local stack;
 *   - the FALLBACK is the local stack (127.0.0.1:54321), reached through a COUNTING FORWARDER, so that case 4 can
 *     assert the fallback origin received NOTHING. The forwarder adds no behaviour: it relays each request to the stack;
 *   - the client is SessionHolder and the console's own submitPublish, moved into apps/ward-console/src/publish.ts so
 *     a test with no DOM can call it (main.ts reads `window` at module load).
 *
 * THE CASES, and what each asserts (every case counts app.ward_status_event rows for ITS mutation id):
 *   1. the Worker is closed before the call: published, ONE row, replayed false.
 *   2. the Worker forwards to the stack, then DESTROYS THE SOCKET before answering (the lost answer): the fallback
 *      re-sends, ONE row, replayed TRUE. ANTI-VACUITY: makeHandler's `fetchImpl` is wrapped to record the upstream
 *      status, and it was 200 before the socket died, so the first send really committed.
 *   3. the Worker is built from an allow-list WITHOUT publish_ward_status, so it answers `refused`: ONE row, replayed false.
 *   4. the access token is inside the skew and LIMIT_REFRESH is faked at 0: the refresh gets the Worker's `limited`
 *      and is NOT sent to the fallback. RenewalUnavailableError, ZERO rows, the session kept, the fallback received nothing.
 *   5. the Worker is closed and the token is inside the skew: the refresh goes to the fallback, then the publish
 *      does. ONE row. It runs LAST: it is the only case that really rotates the GoTrue refresh token.
 *   6. both origins are closed: OriginsUnreachableError, ZERO rows, the session kept.
 *
 * CLOSED PORTS, NOT HUNG ONES: the db project's testTimeout is 30 s, and a hung origin would cost the client 12 s a
 * send. "Closed" is a port that was listening and is not: the connection is refused at once.
 *
 * LIMIT_REFRESH FAKED AT ZERO. There is no helper that sets a limit to 0 (proxy_allow_list.test.ts's fakeLimits()
 * counts from wrangler.json's figures). The Worker reads a limiter from `env[name].limit`, so the per-case env gives
 * LIMIT_REFRESH a limiter that always answers `{ success: false }`, as readback_scripts.test.ts does for LIMIT_VERIFY.
 *
 * WHAT IS COMMITTED, AND WHICH TESTS COULD SEE IT. The publishes commit to append-only tables (ON DELETE RESTRICT,
 * 004 and 010), so this file's facility and ward can never be deleted; afterAll removes only the ward login and its
 * GoTrue user, so no active account outlives the file. The facility has a fixed id that sorts last, is INACTIVE and
 * UNLISTED (so no projection, snapshot or mirror carries it), and its ward is ICU_ADULT. The db tests that read
 * ward_status or its events ACROSS facilities, and why none counts these rows:
 *   - migration_idempotency, runbook_sql_live and runbook_12_4_12_5_sql_live fingerprint every `app` table, but within
 *     ONE test, before and after the same step, and files run one at a time (fileParallelism false);
 *   - retention_jobs and migration_024_round_trip pick "the first ward by order" and plant inside rolled-back
 *     transactions: this ward's id sorts last, and it has no active account once afterAll has run;
 *   - the snapshot, rollup, health_probe and mirror counts read public.ward_public and snapshot_current, which carry
 *     only ACTIVE and LISTED facilities: this one is neither;
 *   - seed_shapes reads one event by category NICU with a reason code: nothing here publishes NICU;
 *   - no test counts 'ward_status.publish' audit rows across facilities (publish_ward_status.test.ts filters by facility).
 * The whole db project is run after this file is added, and its result is in the PR.
 *
 * NOT ASSERTED HERE, deliberately: that the Worker is really down on hosted. No hosted step takes the Worker away
 * (no ward login exists on hosted, DY-2, and production is not broken to prove a fallback). NOT ASSERTED HERE: that a
 * real browser reaches the direct origin under the CSP; security_headers.test.ts holds the rendered headers, and CI
 * has no browser runner.
 *
 * GUARD CLASS: LIVE.
 */

const STACK = apiUrl();
const FAC = 'ffff0000-0000-4000-8000-00000000f4e2';
const CATEGORY = 'ICU_ADULT';
const EMAIL = `fallback-acceptance-${Date.now()}@ward.invalid`;
const LIST_TYPED = LIST as unknown as AllowList;
const NO_PUBLISH: AllowList = { forward: LIST_TYPED.forward.filter((e) => !e.path.endsWith('/publish_ward_status')) };

let session: WardSession;

/** A web Request from a node request, a node response from a web Response; null means "destroy the socket, say nothing". */
type Handle = (request: Request) => Promise<Response | null>;

function bridge(handle: Handle): Promise<{ server: Server; url: string }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive'].includes(k) || v === undefined) continue;
        headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      }
      const hasBody = !['GET', 'HEAD'].includes(req.method ?? 'GET');
      const request = new Request(`http://127.0.0.1${req.url ?? '/'}`, { method: req.method ?? 'GET', headers, ...(hasBody ? { body: Buffer.concat(chunks) } : {}) });
      const answer = await handle(request);
      if (answer === null) {
        req.socket.destroy();
        return;
      }
      const out = Buffer.from(await answer.arrayBuffer());
      const outHeaders: Record<string, string> = {};
      answer.headers.forEach((v, k) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'].includes(k)) outHeaders[k] = v;
      });
      res.writeHead(answer.status, { ...outHeaders, 'content-length': String(out.length) });
      res.end(out);
    })();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }));
  });
}

/** A CLOSED port: it listened, and does not. A connection to it is refused at once. */
async function closedPort(): Promise<string> {
  const { server, url } = await bridge(async () => null);
  await new Promise<void>((r) => server.close(() => r()));
  return url;
}

const forwardToStack = (request: Request): Promise<Response> => {
  const u = new URL(request.url);
  return fetch(new Request(new URL(u.pathname + u.search, STACK), request));
};

const open: Server[] = [];
async function serve(handle: Handle): Promise<string> {
  const { server, url } = await bridge(handle);
  open.push(server);
  return url;
}

/** The fallback: the local stack, behind a forwarder that counts what reaches it. */
async function countingFallback(): Promise<{ url: string; received: string[] }> {
  const received: string[] = [];
  const url = await serve(async (request) => {
    const u = new URL(request.url);
    received.push(`${request.method} ${u.pathname}`);
    return forwardToStack(request);
  });
  return { url, received };
}

/** The real Worker handler, with its upstream fetch pointed at the local stack and the upstream status recorded. */
function worker(list: AllowList = LIST_TYPED, env: ProxyEnv = {}): { handle: Handle; upstream: number[]; answers: { status: number; marker: string | null }[] } {
  const upstream: number[] = [];
  /** What the Worker ANSWERED, recorded (R-2026-10-02-FG FG-9 f): its status and its x-openbed-proxy marker. */
  const answers: { status: number; marker: string | null }[] = [];
  const handler = makeHandler({
    origin: STACK,
    list,
    stamp: { commit: 'acceptance' },
    fetchImpl: async (r) => {
      const res = await fetch(r);
      upstream.push(res.status);
      return res;
    },
  });
  return {
    handle: async (request) => {
      const answer = await handler(request, env);
      answers.push({ status: answer.status, marker: answer.headers.get('x-openbed-proxy') });
      return answer;
    },
    upstream,
    answers,
  };
}

const form: PublishForm = { offering: 'OFFERED', bedCount: 7, accepting: true, reason: null };

async function currentWard(): Promise<WardRow> {
  const [row] = await sql()<{ version: number }[]>`select version from app.ward_status where facility_id = ${FAC}::uuid and category = ${CATEGORY}`;
  if (row === undefined) throw new Error('the acceptance ward does not exist');
  return { category: CATEGORY, offering: 'OFFERED', bedCount: 3, accepting: true, version: row.version, gatedBy: null, monitoringState: 'ACTIVE', source: 'WARD', state: 'OK', canPublish: true };
}

async function rowsFor(mutationId: string): Promise<number> {
  const [row] = await sql()<{ n: number }[]>`
    select count(*)::int as n from app.ward_status_event e
      join app.ward_status ws on ws.id = e.ward_status_id
     where ws.facility_id = ${FAC}::uuid and ws.category = ${CATEGORY} and e.client_mutation_id = ${mutationId}
  `;
  return row?.n ?? 0;
}

/** The session as the stack minted it, or with its access token reckoned to be inside the 60 s skew (the holder reads expiresAt). */
const real = (): Session => ({ ...session });
const insideSkew = (): Session => ({ ...session, expiresAt: Math.floor(Date.now() / 1000) + 20 });

function holder(primary: string, fallback: string, s: Session): SessionHolder {
  return new SessionHolder({ apiUrl: primary, fallbackApiUrl: fallback, anonKey: anonKey(), session: s, sleep: async () => {} });
}

beforeAll(async () => {
  session = await signInWard(EMAIL);
  const db = sql();
  await db`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, is_active)
    values (${FAC}::uuid, 'Fallback Acceptance Probe', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000194', false)
    on conflict (id) do nothing
  `;
  await db`
    insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state)
    values (${FAC}::uuid, ${CATEGORY}, 'OFFERED', 3, true, 'ACTIVE')
    on conflict (facility_id, category) do nothing
  `;
  await db`
    insert into app.ward_account (id, facility_id, ward_category, role)
    values (${session.userId}::uuid, ${FAC}::uuid, ${CATEGORY}, 'WARD_STAFF')
  `;
});

afterAll(async () => {
  await Promise.all(open.map((s) => new Promise<void>((r) => { s.close(() => r()); s.closeAllConnections(); })));
  const db = sql();
  await db`delete from app.ward_account where id = ${session?.userId ?? randomUUID()}::uuid`;
  await db`delete from auth.users where email = ${EMAIL}`;
});

describe('a local plant takes the Worker away and a publish still lands exactly once (D5)', () => {
  test('anti-vacuity — the Worker adapter really serves the real handler: an ordinary publish through it lands once, with the direct origin never touched', async () => {
    const w = worker();
    const primary = await serve(w.handle);
    const fb = await countingFallback();
    const id = randomUUID();
    const out = await submitPublish(holder(primary, fb.url, real()), await currentWard(), form, id);
    expect(out.ok && !out.result.replayed, `the ordinary path did not publish once: ${JSON.stringify(out)}`).toBe(true);
    expect(await rowsFor(id)).toBe(1);
    expect(w.upstream, 'the handler never reached the stack, so the adapter is not what is being tested').toEqual([200]);
    expect(fb.received, 'the fallback was used although the Worker was healthy').toEqual([]);
  });

  test('1. the Worker is closed before the call: published, one row, replayed false', async () => {
    const fb = await countingFallback();
    const id = randomUUID();
    const out = await submitPublish(holder(await closedPort(), fb.url, real()), await currentWard(), form, id);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.ok && out.result.replayed, 'the first and only send was reported as a replay').toBe(false);
    expect(await rowsFor(id), 'exactly one event row for the mutation id').toBe(1);
    expect(fb.received.some((r) => r.endsWith('/publish_ward_status')), 'the publish never reached the fallback').toBe(true);
  });

  test('2. the Worker forwards, then destroys the socket before answering (the lost answer): the fallback re-sends, one row, replayed TRUE', async () => {
    const w = worker();
    const primary = await serve(async (request) => {
      await w.handle(request); // the upstream answers, the write COMMITS; the answer is then lost
      return null;
    });
    const fb = await countingFallback();
    const id = randomUUID();
    const out = await submitPublish(holder(primary, fb.url, real()), await currentWard(), form, id);
    expect(w.upstream, 'ANTI-VACUITY: the upstream must have answered 200 before the socket died, or nothing was lost').toEqual([200]);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.ok && out.result.replayed, 'the re-send of a lost answer must REPLAY, not write again').toBe(true);
    expect(await rowsFor(id), 'exactly one event row: the re-send did not duplicate').toBe(1);
    expect(fb.received.filter((r) => r.endsWith('/publish_ward_status')).length, 'the fallback re-sent exactly once').toBe(1);
  });

  test("3. the Worker's allow-list does not carry publish_ward_status, so it answers `refused`: the fallback sends it, one row, replayed false", async () => {
    const w = worker(NO_PUBLISH);
    const primary = await serve(w.handle);
    const fb = await countingFallback();
    const id = randomUUID();
    const out = await submitPublish(holder(primary, fb.url, real()), await currentWard(), form, id);
    expect(w.upstream, 'the Worker forwarded a publish its list does not carry').toEqual([]);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(out.ok && out.result.replayed).toBe(false);
    expect(await rowsFor(id)).toBe(1);
  });

  test('4. the token is inside the skew and LIMIT_REFRESH is zero: the refresh gets `limited`, is not sent to the fallback, nothing is written, the session is kept', async () => {
    const w = worker(LIST_TYPED, { LIMIT_REFRESH: { limit: async () => ({ success: false }) } });
    const primary = await serve(w.handle);
    const fb = await countingFallback();
    const id = randomUUID();
    const h = holder(primary, fb.url, insideSkew());
    await expect(submitPublish(h, await currentWard(), form, id)).rejects.toBeInstanceOf(RenewalUnavailableError);
    expect(await rowsFor(id), 'a publish was written although the renewal said not now').toBe(0);
    expect(h.signedOut, 'a limited refresh signed the ward out').toBe(false);
    expect(fb.received, 'the fallback origin received a request: a limit was re-sent into').toEqual([]);
    expect(w.upstream, 'the limited refresh reached the stack').toEqual([]);
    // FG-9 f: the Worker's own answer, read directly beside the two empty lists above. Without it, "nothing reached the
    // stack or the fallback" is also true of a Worker that was never asked, or one that answered something else.
    expect(w.answers, 'the Worker answered the limited refresh with a 429 marked limited, exactly once').toEqual([{ status: 429, marker: 'limited' }]);
  });

  test('6. both origins are closed: OriginsUnreachableError, nothing is written, the session is kept', async () => {
    const id = randomUUID();
    const h = holder(await closedPort(), await closedPort(), real());
    await expect(submitPublish(h, await currentWard(), form, id)).rejects.toBeInstanceOf(OriginsUnreachableError);
    expect(await rowsFor(id)).toBe(0);
    expect(h.signedOut, 'an unreachable pair of origins signed the ward out').toBe(false);
  });

  // LAST: this is the one case that really rotates the GoTrue refresh token. Every case above either never refreshes
  // or has its refresh stopped before GoTrue, so the minted refresh token is still valid here.
  test('5. the Worker is closed and the token is inside the skew: the refresh goes to the fallback, then the publish does; one row', async () => {
    const fb = await countingFallback();
    const id = randomUUID();
    const h = holder(await closedPort(), fb.url, insideSkew());
    const out = await submitPublish(h, await currentWard(), form, id);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(await rowsFor(id)).toBe(1);
    expect(h.signedOut).toBe(false);
    const sentToFallback = fb.received.filter((r) => r.startsWith('POST /auth/v1/token') || r.endsWith('/publish_ward_status'));
    expect(sentToFallback, 'the refresh must reach the fallback before the publish does').toEqual(['POST /auth/v1/token', 'POST /rest/v1/rpc/publish_ward_status']);
  });
});
