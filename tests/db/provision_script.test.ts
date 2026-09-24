import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { sql, sqlSecond } from '../setup/db.js';
import { dbUrl } from '../setup/local-keys.js';

/**
 * THE PROVISIONING SCRIPT GOES THROUGH THE GATES (R-2026-09-24-88 BP-6; R-2026-09-24-90
 * BR-1 e), asserted against scripts/provision_ward_account.mjs itself, run as a child
 * process, against the real local database and a STUB GoTrue.
 *
 * THE ZERO-AUTH ASSERTIONS COUNT REQUESTS AT THE STUB, never a log line (the kickoff's
 * QA pass). The stub is an in-process HTTP server on a scratch port; the script is
 * pointed at it with SUPABASE_API_URL, which the host check classifies as the local
 * stack (127.0.0.1, any port). So the child runs ASYNCHRONOUSLY: execFileSync would
 * block the event loop the stub answers on, and every run would hang.
 *
 * EVERY RUN IS A TOKEN LEG. The stub's 200 body carries a planted token in
 * `hashed_token`, `email_otp` and `action_link`, and run() asserts the token is absent
 * from the script's stdout and stderr on every path, pass or fail.
 *
 * THE FIXTURES ARE COMMITTED, because the script opens its own connection. Four
 * facilities with fixed ids are upserted UNLISTED (so nothing is public), and never
 * deleted: app.audit_log holds a facility ON DELETE RESTRICT, and the provisioning
 * functions write audit rows. After each test the accounts and invites these tests
 * made are deleted, so no active PLATFORM_ADMIN outlives a test (R-2026-09-24-91
 * BS-1 a: migration 022's down refuses while one exists).
 *
 * F3, THE FAILURE AFTER THE AUTH USER EXISTS, IS INJECTED IN FLIGHT. The design
 * report proposed terminating the script's backend before the stub answers. On
 * checking, postgres.js reconnects silently for the next query, so that plant would
 * have changed nothing and the leg would have passed on an untouched path
 * (test-conventions section 8, "confirm the plant mutated THE PATH UNDER TEST"). So
 * the stub first takes a row lock on the open invite, answers, waits until
 * pg_stat_activity shows the script's provision_complete BLOCKED on that lock, and
 * terminates that backend mid-statement. The leg asserts the block was observed.
 *
 * NOT ASSERTED HERE, deliberately: the two `unrecognised status` legs. They fire
 * only if provision_begin or provision_complete returns a status the script does not
 * know, which needs a changed SQL function; they are registered, not planted.
 * NOT ASSERTED HERE: GoTrue's own behaviour. That is tested against the real local
 * GoTrue and quoted in PR 3.4b-app A's body (BP-6 8).
 */

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts/provision_ward_account.mjs');
const TOKEN = 'PLANTEDTOKEN0ce8b1d4a9f2';

const FAC_OK = '0b000000-0000-4000-8000-0000000005a1';
const FAC_NO_CONTACT = '0b000000-0000-4000-8000-0000000005a2';
const FAC_NO_AGREEMENT = '0b000000-0000-4000-8000-0000000005a3';
const FAC_WITHDRAWN = '0b000000-0000-4000-8000-0000000005a4';
const FACILITIES = [FAC_OK, FAC_NO_CONTACT, FAC_NO_AGREEMENT, FAC_WITHDRAWN];

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
let server: Server;
let stubUrl = '';
let handler: Handler = (_req, res) => reply(res, 500, { msg: 'no handler set' });
let requests: string[] = [];
const operators: string[] = [];

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
const userBody = (id: string) => ({
  id,
  hashed_token: TOKEN,
  email_otp: TOKEN,
  verification_type: 'signup',
  action_link: `http://127.0.0.1:54321/auth/v1/verify?token=${TOKEN}&type=magiclink`,
});
/** A stub that answers each request with the next entry, and the last entry for ever after. */
function answers(...queue: [number, unknown][]): Handler {
  let i = 0;
  return (_req, res) => {
    const [status, body] = queue[Math.min(i++, queue.length - 1)]!;
    reply(res, status, body);
  };
}

interface Run {
  status: number;
  out: string;
}
async function run(args: string[], env: Record<string, string> = {}): Promise<Run> {
  const child = spawn('node', [SCRIPT, ...args], {
    env: { ...process.env, SUPABASE_API_URL: stubUrl, DATABASE_URL: dbUrl(), SUPABASE_SERVICE_ROLE_KEY: 'stub-key', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr.on('data', (d: Buffer) => (out += d.toString()));
  const status = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? -1)));
  expect(out, `the script printed GoTrue's token (args ${args.join(' ')})`).not.toContain(TOKEN);
  return { status, out };
}
const ward = (fac: string, category = 'ICU_ADULT') => ['--email', 'ward-role@example.invalid', '--facility', fac, '--category', category];
const operator = (email = 'operator-role@example.invalid') => ['--email', email, '--role', 'PLATFORM_ADMIN'];

async function openInvites(fac: string): Promise<{ id: string }[]> {
  return sql()<{ id: string }[]>`select id from app.invite where facility_id = ${fac}::uuid and accepted_at is null`;
}
async function account(id: string) {
  const [a] = await sql()<{ role: string; facility_id: string | null; ward_category: string | null; is_active: boolean }[]>`
    select role, facility_id, ward_category, is_active from app.ward_account where id = ${id}::uuid`;
  return a;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    req.resume();
    req.on('end', () => void handler(req, res));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  stubUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const db = sql();
  for (const [i, fac] of FACILITIES.entries()) {
    await db`
      insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
      values (${fac}::uuid, ${`Provisioning Script Facility ${i + 1}`}, 'Yaba', 'Lagos', 6.51, 3.38, ${`+23480000005${i}1`}, NULL)
      on conflict (id) do nothing`;
    await db`insert into app.ward_status (facility_id, category, offering) values (${fac}::uuid, 'ICU_ADULT', 'OFFERED') on conflict do nothing`;
  }
  for (const fac of [FAC_OK, FAC_NO_AGREEMENT, FAC_WITHDRAWN]) {
    await db`insert into app.facility_contact (facility_id, full_name, job_title, email)
             values (${fac}::uuid, 'Synthetic Contact', 'Medical Director', 'contact@example.invalid') on conflict (facility_id) do nothing`;
  }
  await db`insert into app.facility_agreement (facility_id, accepted_on, version) values (${FAC_OK}::uuid, '2026-09-01', 'synthetic-v1')
           on conflict (facility_id) do update set withdrawn_on = null`;
  await db`insert into app.facility_agreement (facility_id, accepted_on, version, withdrawn_on) values (${FAC_WITHDRAWN}::uuid, '2026-09-01', 'synthetic-v1', '2026-09-20')
           on conflict (facility_id) do update set withdrawn_on = '2026-09-20'`;
  const [n] = await db<{ n: number }[]>`select count(*)::int as n from app.facility where id = any(${FACILITIES}::uuid[]) and listed_at is not null`;
  expect(n?.n, 'a script-test facility is listed, so it could reach public output').toBe(0);
});

afterEach(async () => {
  const db = sql();
  await db`delete from app.ward_account where facility_id = any(${FACILITIES}::uuid[])`;
  await db`delete from app.invite where facility_id = any(${FACILITIES}::uuid[])`;
  await db`delete from app.ward_account where role = 'PLATFORM_ADMIN' and id = any(${operators}::uuid[])`;
  await db`delete from app.invite where role = 'PLATFORM_ADMIN'`;
  requests = [];
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('the script refuses at app.provision_begin, and makes ZERO Auth requests', () => {
  test.each([
    ['a facility with no contact', ward(FAC_NO_CONTACT), 'NO_FACILITY_CONTACT', FAC_NO_CONTACT],
    ['a contact with no agreement', ward(FAC_NO_AGREEMENT), 'AGREEMENT_NOT_RECORDED', FAC_NO_AGREEMENT],
    ['a withdrawn agreement', ward(FAC_WITHDRAWN), 'AGREEMENT_WITHDRAWN', FAC_WITHDRAWN],
    ['a category never added', ward(FAC_OK, 'MATERNITY'), 'NO_SUCH_WARD', FAC_OK],
    ['a facility that does not exist', ward(randomUUID()), 'NO_SUCH_FACILITY', FAC_OK],
    ['FACILITY_ADMIN', [...ward(FAC_OK), '--role', 'FACILITY_ADMIN'], 'ROLE_NOT_PROVISIONED_IN_V1', FAC_OK],
  ])('%s is refused %s', async (_name, args, code, fac) => {
    handler = answers([200, userBody(randomUUID())]);
    const r = await run(args);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(`REFUSED by app.provision_begin: ${code}`);
    expect(r.out).toContain('. No invite was opened and no Auth call was made.');
    expect(requests, 'a refused run reached the Auth admin API').toEqual([]);
    expect(await openInvites(fac), 'a refused run opened an invite').toEqual([]);
  });
});

describe('the happy path, and J4', () => {
  test('a gated ward is provisioned with ONE Auth request, and the account id is the auth user id', async () => {
    const user = randomUUID();
    handler = answers([200, userBody(user)]);
    const r = await run(ward(FAC_OK));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`provisioned WARD_STAFF ward-role@example.invalid -> account ${user}`);
    expect(requests).toEqual(['POST /auth/v1/admin/generate_link']);
    expect(await account(user)).toEqual({ role: 'WARD_STAFF', facility_id: FAC_OK, ward_category: 'ICU_ADULT', is_active: true });
    expect(await openInvites(FAC_OK), 'the invite was left open').toEqual([]);
  });

  test('J4 — a re-run on a complete ward makes ZERO Auth requests and changes nothing', async () => {
    handler = answers([200, userBody(randomUUID())]);
    expect((await run(ward(FAC_OK))).status).toBe(0);
    requests = [];
    const [before] = await sql()<{ n: number }[]>`select count(*)::int as n from app.invite where facility_id = ${FAC_OK}::uuid`;
    const r = await run(ward(FAC_OK));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('already complete');
    expect(requests, 'a re-run on a complete ward called the Auth admin API').toEqual([]);
    const [after] = await sql()<{ n: number }[]>`select count(*)::int as n from app.invite where facility_id = ${FAC_OK}::uuid`;
    expect(after?.n).toBe(before?.n);
  });
});

describe('retry-safe from every point of failure (BP-6 3)', () => {
  test('F2 — generate_link fails: the invite stays open, the run says so, and a re-run completes on THE SAME invite', async () => {
    handler = answers([500, { msg: 'down' }]);
    const first = await run(ward(FAC_OK));
    expect(first.status, first.out).toBe(1);
    expect(requests, 'a 500 was retried other than exactly three times').toHaveLength(3);
    const [open] = await openInvites(FAC_OK);
    expect(first.out).toContain(`setup incomplete: invite ${open?.id} is open and no account exists yet`);
    expect(first.out).toContain('is open and no account exists yet — re-run the same command. Cause');
    expect(first.out).toContain('admin/generate_link refused the invite (HTTP 500)');

    requests = [];
    handler = answers([400, { msg: 'bad request' }]);
    const second = await run(ward(FAC_OK));
    expect(second.status).toBe(1);
    expect(requests, 'a 4xx was retried').toHaveLength(1);
    expect((await openInvites(FAC_OK)).map((i) => i.id), 'the re-run opened a second invite').toEqual([open?.id]);

    const user = randomUUID();
    handler = answers([200, userBody(user)]);
    const third = await run(ward(FAC_OK));
    expect(third.status, third.out).toBe(0);
    const [inv] = await sql()<{ accepted: boolean }[]>`select accepted_at is not null as accepted from app.invite where id = ${open!.id}::uuid`;
    expect(inv?.accepted, 'the completing run did not accept the invite the failed runs opened').toBe(true);
    expect((await account(user))?.is_active).toBe(true);
  });

  test('bounded retries — 503, 503, 200 provisions with exactly three requests', async () => {
    handler = answers([503, {}], [503, {}], [200, userBody(randomUUID())]);
    const r = await run(ward(FAC_OK));
    expect(r.status, r.out).toBe(0);
    expect(requests).toHaveLength(3);
  });

  test('an unreachable GoTrue fails loudly after three attempts, and leaves the invite open rather than half-provisioning', async () => {
    const r = await run(ward(FAC_OK), { SUPABASE_API_URL: 'http://127.0.0.1:59999' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('admin/generate_link could not be reached after 3 attempts');
    expect(r.out).toContain('setup incomplete');
    expect(await openInvites(FAC_OK)).toHaveLength(1);
  });

  test.each([
    ['a 200 with a body that is not JSON', 'not json', 'GoTrue returned a non-JSON body (HTTP 200)'],
    ['a 200 with no user id', { hashed_token: TOKEN }, 'admin/generate_link returned no auth user id. Keys: hashed_token'],
  ])('a reachable but misbehaving GoTrue — %s — is named, and the invite stays open', async (_name, body, message) => {
    handler = answers([200, body]);
    const r = await run(ward(FAC_OK));
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(message);
    expect(r.out).toContain('setup incomplete');
    expect(await openInvites(FAC_OK)).toHaveLength(1);
  });

  test('F3 — complete fails in flight after the auth user exists: "setup incomplete", never a permissions bug, and a re-run completes', async () => {
    const user = randomUUID();
    let observed = false;
    let locking: Promise<unknown> = Promise.resolve();
    handler = (_req, res) => {
      locking = sqlSecond().begin(async (tx) => {
        await tx`select 1 from app.invite where facility_id = ${FAC_OK}::uuid and accepted_at is null for update`;
        reply(res, 200, userBody(user));
        for (let i = 0; i < 200 && !observed; i++) {
          const waiting = await sql()<{ pid: number }[]>`
            select pid from pg_stat_activity where application_name = 'provision_ward_account' and wait_event_type = 'Lock'`;
          if (waiting[0] !== undefined) {
            await sql()`select pg_terminate_backend(${waiting[0].pid})`;
            observed = true;
          } else {
            await new Promise((r) => setTimeout(r, 25));
          }
        }
      });
    };
    const first = await run(ward(FAC_OK));
    await locking;
    expect(observed, "the plant never saw the script's provision_complete waiting, so it failed on some other path").toBe(true);
    expect(first.status, first.out).toBe(1);
    expect(first.out).toContain('setup incomplete: invite');
    expect(first.out).not.toMatch(/NOT_A_MEMBER|permission denied/);
    expect(await account(user), 'an account exists after the complete that was killed').toBeUndefined();

    handler = answers([200, userBody(user)]);
    const second = await run(ward(FAC_OK));
    expect(second.status, second.out).toBe(0);
    expect((await account(user))?.is_active).toBe(true);
  });

  test("F3' — complete refuses ACCOUNT_SCOPE_CONFLICT by name, and the invite stays open", async () => {
    const user = randomUUID();
    await sql()`insert into app.ward_account (id, facility_id, ward_category, role) values (${user}::uuid, ${FAC_NO_CONTACT}::uuid, 'ICU_ADULT', 'WARD_STAFF')`;
    handler = answers([200, userBody(user)]);
    const r = await run(ward(FAC_OK));
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('REFUSED by app.provision_complete: ACCOUNT_SCOPE_CONFLICT');
    expect(await openInvites(FAC_OK)).toHaveLength(1);
  });

  test('a database that cannot be reached fails loudly, before any Auth request', async () => {
    const r = await run(ward(FAC_OK), { DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:59998/postgres' });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('provisioning failed for ward-role@example.invalid');
    expect(requests).toEqual([]);
  });
});

describe('022 through the script (R-2026-09-24-90 BR-1 e)', () => {
  test('a deactivated ward re-provisioned through the gates is REACTIVATED, with its own audit row', async () => {
    const user = randomUUID();
    handler = answers([200, userBody(user)]);
    expect((await run(ward(FAC_OK))).status).toBe(0);
    await sql()`update app.ward_account set is_active = false, deactivated_at = now() where id = ${user}::uuid`;
    const audits = async () =>
      (await sql()<{ n: number }[]>`select count(*)::int as n from app.audit_log where facility_id = ${FAC_OK}::uuid and action = 'ward_account.reactivate'`)[0]?.n ?? -1;
    const before = await audits();
    requests = [];
    const r = await run(ward(FAC_OK));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`reactivated WARD_STAFF ward-role@example.invalid -> account ${user}`);
    expect(requests).toHaveLength(1);
    expect((await account(user))?.is_active).toBe(true);
    expect(await audits(), 'the reactivation did not write exactly one audit row of its own').toBe(before + 1);
  });

  test("a withdrawn facility's deactivated ward is refused AGREEMENT_WITHDRAWN at begin, with ZERO Auth requests", async () => {
    const user = randomUUID();
    await sql()`insert into app.ward_account (id, facility_id, ward_category, role, is_active, deactivated_at)
                values (${user}::uuid, ${FAC_WITHDRAWN}::uuid, 'ICU_ADULT', 'WARD_STAFF', false, now())`;
    handler = answers([200, userBody(user)]);
    const r = await run(ward(FAC_WITHDRAWN));
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('REFUSED by app.provision_begin: AGREEMENT_WITHDRAWN');
    expect(requests).toEqual([]);
    expect((await account(user))?.is_active, 'the withdrawn ward was switched back on').toBe(false);
  });

  test('the operator is bootstrapped with ONE Auth request; a re-run, or a second address, makes ZERO and never makes a second operator', async () => {
    const first = randomUUID();
    const second = randomUUID();
    operators.push(first, second);
    handler = answers([200, userBody(first)]);
    const boot = await run(operator());
    expect(boot.status, boot.out).toBe(0);
    expect(requests).toHaveLength(1);
    expect(await account(first)).toEqual({ role: 'PLATFORM_ADMIN', facility_id: null, ward_category: null, is_active: true });

    for (const email of ['operator-role@example.invalid', 'another-address@example.invalid']) {
      requests = [];
      handler = answers([200, userBody(second)]);
      const again = await run(operator(email));
      expect(again.status, again.out).toBe(0);
      expect(again.out).toContain('an operator account already exists: nothing was done');
      expect(again.out).not.toContain('provisioned');
      expect(requests, `a re-run for ${email} called the Auth admin API`).toEqual([]);
    }
    const [n] = await sql()<{ n: number }[]>`select count(*)::int as n from app.ward_account where role = 'PLATFORM_ADMIN' and is_active`;
    expect(n?.n, 'a second address became a second operator').toBe(1);
  });

  test('the operator form refuses a facility or a category, rather than letting SQL silently drop them', async () => {
    const r = await run([...operator(), '--facility', FAC_OK]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('usage: node scripts/provision_ward_account.mjs');
    expect(requests).toEqual([]);
  });
});

describe('the host check refuses before anything is read or written', () => {
  test('plant — a hosted-shaped database URL beside the local Auth stub is refused, and the stub is never called', async () => {
    // No password on the hosted-shaped URL: scripts/lint_no_secrets.sh refuses one for any
    // host but this machine. That a refusal never prints a password is asserted in
    // tests/compliance/provision_ward_account.test.ts, on a local URL.
    const r = await run(ward(FAC_OK), { DATABASE_URL: 'postgresql://postgres@db.bbbbbbbbbbbbbbbbbbbb.supabase.co:5432/postgres' });
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('REFUSING: the host check did not pass, and nothing was read or written');
    expect(r.out).toContain('DATABASE_URL names project bbbbbbbbbbbbbbbbbbbb');
    expect(requests).toEqual([]);
  });

  test('plant — a hosted-shaped Auth URL beside the real local database is refused, and no invite is opened', async () => {
    const [before] = await sql()<{ n: number }[]>`select count(*)::int as n from app.invite`;
    const r = await run(ward(FAC_OK), { SUPABASE_API_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' });
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('SUPABASE_API_URL names project aaaaaaaaaaaaaaaaaaaa and DATABASE_URL names the local stack');
    const [after] = await sql()<{ n: number }[]>`select count(*)::int as n from app.invite`;
    expect(after?.n, 'the refused run opened an invite').toBe(before?.n);
  });
});
