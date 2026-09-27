import { afterAll, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres, { type TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';
import { dbUrl } from '../setup/local-keys.js';

/**
 * THE RETENTION SCHEDULE'S TWO JOBS DO WHAT THE PRIVACY NOTICE SAYS, AND NOTHING MORE
 * (R-2026-09-26-136 DL-2; DL-2 a amended by the founder, 2026-09-26).
 *
 * The notice promises: a ward's sign-in address is deleted within 30 days of its
 * account being closed; sign-in sessions are deleted 30 days after they end. Migration
 * 024 implements both as SECURITY DEFINER functions run by pg_cron. This file calls
 * the functions directly, as postgres, inside rolled-back transactions -- the jobs
 * themselves are paused on every local and CI database (database/local/
 * pause_scheduled_jobs.sql), and a job's run is not something a test can wait for.
 *
 * WHAT IS ASSERTED.
 *   Erasure (DL-2 a; the threshold by R-2026-09-27-137 DM-1): deactivated 30 days ->
 *     the Auth user and every auth row that carries the address or a session are gone,
 *     the row is marked, one audit row names the WARD; deactivated 28 days -> kept; a
 *     PLATFORM_ADMIN -> never; an
 *     active account -> never. Two erasures for one ward write two rows: the count is
 *     the evidence, not an identifier.
 *   The audit row is ward only (DL-2 a amended, d): the exact shape is accepted when
 *     written directly (the most ordinary valid input); the ward_account id inside
 *     new_value, a uuid smuggled as the role, and a session_id are each REFUSED by the
 *     database -- the jsonb loophole 005's column guards cannot see.
 *   The missed withdrawal step (DM-2, which moved it out of the erasure): an active
 *     account at a facility withdrawn more than 30 days ago makes
 *     app.check_withdrawn_facility_accounts() RAISE, so its pg_cron run is recorded
 *     as failed; it deletes nothing; with no such account it does not raise; and the
 *     erasure itself no longer raises or warns.
 *   No comeback (DL-2 b): provision_complete refuses an erased login with LOGIN_ERASED
 *     and its hint; a hand-run UPDATE reactivating one violates the CHECK.
 *   Sessions (DL-2 c; the threshold by DM-1): ended 30 days ago -> deleted with its
 *     refresh tokens; 28 days
 *     -> kept; both through the last-use path and the created_at + 24 h path; and the
 *     result does not move with the session's TimeZone (refreshed_at is timestamp
 *     without time zone).
 *   THE THRESHOLD IS 29 DAYS, AND THE JOBS RUN DAILY (DM-1). The notice promises
 *     deletion WITHIN 30 days; a daily run at a 30-day threshold deleted on day 30 or
 *     31. At 29 days every deletion lands within 30 days of the event. So the legs sit
 *     one day either side of the promise: 30 days is gone, 28 days is kept.
 *   The jobs (DL-2 e; the third by DM-2 b): 024 applied twice leaves exactly one row per job name, on its
 *     schedule, as postgres; a same-name job under a second role is reported (017's
 *     Condition F pattern).
 *   The G1 comment (DL-2 f), word for word.
 *
 * NOT ASSERTED HERE, deliberately: that the jobs RUN on hosted, and on what the
 * founder can see of a WARNING there. Both are hosted facts; 024's runbook section
 * reads the jobs after the apply.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const MIGRATION = join(MIG_DIR, '024_retention_jobs.sql');

type Tx = TransactionSql;

interface Ward {
  facility: string;
  category: string;
}

/** A seeded ward that has no active WARD_STAFF account, so a planted one fits 020's index. */
async function freeWard(tx: Tx, skip: Ward[] = []): Promise<Ward> {
  const rows = await tx.unsafe<{ facility: string; category: string }[]>(`
    select ws.facility_id::text as facility, ws.category::text as category
      from app.ward_status ws
     where not exists (select 1 from app.ward_account u
                        where u.facility_id = ws.facility_id and u.ward_category = ws.category and u.is_active)
     order by 1, 2`);
  const w = rows.find((r) => !skip.some((s) => s.facility === r.facility && s.category === r.category));
  if (w === undefined) throw new Error('precondition: no seeded ward without an active account -- run db:reset');
  return w;
}

interface LoginSpec {
  ward?: Ward | null;
  role?: 'WARD_STAFF' | 'PLATFORM_ADMIN';
  /** null: active. A number: deactivated that many days ago. */
  deactivatedDaysAgo: number | null;
}

/**
 * Plants a login: an auth.users row with an identity, a one-time token, a session and a
 * refresh token (by user AND by session), and its app.ward_account row. Returns its id.
 * The address is example.test, and exists only inside the rolled-back transaction.
 */
async function plantLogin(tx: Tx, spec: LoginSpec): Promise<string> {
  const [{ id } = { id: '' }] = await tx.unsafe<{ id: string }[]>('select gen_random_uuid()::text as id');
  const email = `ward-${id.slice(0, 8)}@example.test`;
  await tx.unsafe(`insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', $2)`, [id, email] as never[]);
  await tx.unsafe(`insert into auth.identities (provider_id, user_id, identity_data, provider) values ($1::text, $3::uuid, jsonb_build_object('email', $2::text), 'email')`, [id, email, id] as never[]);
  await tx.unsafe(`insert into auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to) values (gen_random_uuid(), $1, 'confirmation_token', 'planted', $2)`, [id, email] as never[]);
  const [{ sid } = { sid: '' }] = await tx.unsafe<{ sid: string }[]>(`insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), $1, now(), now()) returning id::text as sid`, [id] as never[]);
  await tx.unsafe(`insert into auth.refresh_tokens (token, user_id, session_id) values ('planted-by-session-' || $1, $1, $2)`, [id, sid] as never[]);
  await tx.unsafe(`insert into auth.refresh_tokens (token, user_id, session_id) values ('planted-by-user-' || $1, $1, null)`, [id] as never[]);
  const role = spec.role ?? 'WARD_STAFF';
  const ward = role === 'PLATFORM_ADMIN' ? null : (spec.ward ?? (await freeWard(tx)));
  const active = spec.deactivatedDaysAgo === null;
  await tx.unsafe(
    `insert into app.ward_account (id, facility_id, ward_category, role, is_active, deactivated_at)
     values ($1, $2, $3::app.ward_category, $4::app.app_role, $5, case when $5 then null else now() - make_interval(days => $6::int) end)`,
    [id, ward?.facility ?? null, ward?.category ?? null, role, active, spec.deactivatedDaysAgo ?? 0] as never[],
  );
  return id;
}

interface AuthCounts {
  users: number;
  identities: number;
  one_time_tokens: number;
  sessions: number;
  refresh_tokens: number;
}

async function authCounts(tx: Tx, id: string): Promise<AuthCounts> {
  const [r] = await tx.unsafe<AuthCounts[]>(`
    select (select count(*)::int from auth.users where id = $1::uuid) as users,
           (select count(*)::int from auth.identities where user_id = $1::uuid) as identities,
           (select count(*)::int from auth.one_time_tokens where user_id = $1::uuid) as one_time_tokens,
           (select count(*)::int from auth.sessions where user_id = $1::uuid) as sessions,
           (select count(*)::int from auth.refresh_tokens where user_id = $2::text) as refresh_tokens`, [id, id] as never[]);
  if (r === undefined) throw new Error('no count row');
  return r;
}

/** Days either side of the 29-day threshold (DM-1): due, and not yet due. */
const DUE = 30;
const NOT_DUE = 28;

const PLANTED: AuthCounts = { users: 1, identities: 1, one_time_tokens: 1, sessions: 1, refresh_tokens: 2 };
const GONE: AuthCounts = { users: 0, identities: 0, one_time_tokens: 0, sessions: 0, refresh_tokens: 0 };

async function erasedAt(tx: Tx, id: string): Promise<string | null> {
  const [r] = await tx.unsafe<{ at: string | null }[]>('select login_erased_at::text as at from app.ward_account where id = $1', [id] as never[]);
  return r?.at ?? null;
}

/** The erasure audit rows this transaction wrote for one ward (occurred_at is now(), the transaction's time). */
async function eraseRows(tx: Tx, w: Ward): Promise<{ new_value: unknown; old_value: unknown; session_id: string | null; version: number | null }[]> {
  return tx.unsafe(`
    select new_value, old_value, session_id::text as session_id, version from app.audit_log
     where action = 'ward_account.login_erase' and facility_id = $1 and ward_category = $2::app.ward_category
       and occurred_at = now()`, [w.facility, w.category] as never[]);
}

async function erase(tx: Tx): Promise<number> {
  const [r] = await tx.unsafe<{ n: number }[]>('select app.erase_lapsed_ward_logins() as n');
  return r?.n ?? -1;
}

async function refusal(fn: () => Promise<unknown>): Promise<{ message: string; hint?: string; constraint_name?: string }> {
  try {
    await fn();
  } catch (e) {
    return e as { message: string; hint?: string; constraint_name?: string };
  }
  throw new Error('expected a refusal and the call succeeded');
}

const asPostgres = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => withRole('postgres', null, fn);

/**
 * A THIRD CONNECTION, FOR ONE THING: COLLECTING A WARNING. The shared pools discard
 * notices (onnotice: () => {} in tests/setup/db.ts). This one connects as postgres,
 * never switches role, and always rolls back, so it reintroduces none of the hazards
 * those pools close.
 */
let warnPool: ReturnType<typeof postgres> | null = null;
let notices: string[] = [];
function warnSql(): ReturnType<typeof postgres> {
  warnPool ??= postgres(dbUrl(), { max: 1, connect_timeout: 10, onnotice: (n) => { notices.push(`${n.severity}: ${n.message}`); } });
  return warnPool;
}
afterAll(async () => {
  await warnPool?.end();
});

/** Runs fn in a rolled-back transaction on the warning connection, and returns what it raised. */
async function withNotices(fn: (tx: Tx) => Promise<void>): Promise<string[]> {
  notices = [];
  const sentinel = new Error('rollback');
  try {
    await warnSql().begin(async (tx) => {
      await fn(tx);
      throw sentinel;
    });
  } catch (e) {
    if (e !== sentinel) throw e;
  }
  return notices;
}

describe('the retention jobs erase lapsed logins, ward-level (R-2026-09-26-136 DL-2 a, b)', () => {
  test('a login deactivated 30 days ago is erased: every auth row gone, the row marked, one ward-level audit row', async () => {
    const r = await asPostgres(async (tx) => {
      const w = await freeWard(tx);
      const id = await plantLogin(tx, { ward: w, deactivatedDaysAgo: DUE });
      const before = await authCounts(tx, id);
      const n = await erase(tx);
      return { before, after: await authCounts(tx, id), n, at: await erasedAt(tx, id), rows: await eraseRows(tx, w) };
    });
    expect(r.before, 'the plant did not land').toEqual(PLANTED);
    expect(r.n).toBeGreaterThanOrEqual(1);
    expect(r.after, 'an auth row carrying the address or a session survived erasure').toEqual(GONE);
    expect(r.at, 'the erased row is not marked').not.toBeNull();
    expect(r.rows).toEqual([{ new_value: { role: 'WARD_STAFF' }, old_value: null, session_id: null, version: null }]);
  });

  test('a login deactivated 28 days ago is kept, with no audit row', async () => {
    const r = await asPostgres(async (tx) => {
      const w = await freeWard(tx);
      const id = await plantLogin(tx, { ward: w, deactivatedDaysAgo: NOT_DUE });
      await erase(tx);
      return { after: await authCounts(tx, id), at: await erasedAt(tx, id), rows: await eraseRows(tx, w) };
    });
    expect(r.after).toEqual(PLANTED);
    expect(r.at).toBeNull();
    expect(r.rows).toEqual([]);
  });

  test('a PLATFORM_ADMIN deactivated 30 days ago is never erased', async () => {
    const r = await asPostgres(async (tx) => {
      const id = await plantLogin(tx, { role: 'PLATFORM_ADMIN', deactivatedDaysAgo: DUE });
      await erase(tx);
      return { after: await authCounts(tx, id), at: await erasedAt(tx, id) };
    });
    expect(r.after).toEqual(PLANTED);
    expect(r.at).toBeNull();
  });

  test('an active login is never erased, however old', async () => {
    const r = await asPostgres(async (tx) => {
      const w = await freeWard(tx);
      const id = await plantLogin(tx, { ward: w, deactivatedDaysAgo: null });
      await tx.unsafe(`update auth.users set created_at = now() - interval '400 days' where id = $1`, [id] as never[]);
      await erase(tx);
      return { after: await authCounts(tx, id), at: await erasedAt(tx, id), rows: await eraseRows(tx, w) };
    });
    expect(r.after).toEqual(PLANTED);
    expect(r.at).toBeNull();
    expect(r.rows).toEqual([]);
  });

  test('two logins erased for one ward write two rows, each ward-level', async () => {
    const r = await asPostgres(async (tx) => {
      const w = await freeWard(tx);
      await plantLogin(tx, { ward: w, deactivatedDaysAgo: DUE });
      await plantLogin(tx, { ward: w, deactivatedDaysAgo: 45 });
      await erase(tx);
      return eraseRows(tx, w);
    });
    expect(r).toEqual([
      { new_value: { role: 'WARD_STAFF' }, old_value: null, session_id: null, version: null },
      { new_value: { role: 'WARD_STAFF' }, old_value: null, session_id: null, version: null },
    ]);
  });

  test('a second run erases nothing it already erased', async () => {
    const r = await asPostgres(async (tx) => {
      const w = await freeWard(tx);
      await plantLogin(tx, { ward: w, deactivatedDaysAgo: DUE });
      await erase(tx);
      await erase(tx);
      return eraseRows(tx, w);
    });
    expect(r.length, 'a re-run wrote a second audit row for the same erasure').toBe(1);
  });
});

describe('the erasure audit row is ward only, by the database (DL-2 a amended, d)', () => {
  const insert = (tx: Tx, w: Ward, newValue: string, extra = '', extraValue = ''): Promise<unknown> =>
    tx.unsafe(`insert into app.audit_log (facility_id, ward_category, action, new_value${extra}) values ($1, $2::app.ward_category, 'ward_account.login_erase', ${newValue}${extraValue})`, [w.facility, w.category] as never[]);

  test('real — the ward-level shape is accepted when written directly', async () => {
    const rows = await asPostgres(async (tx) => {
      const w = await freeWard(tx);
      await insert(tx, w, `'{"role":"WARD_STAFF"}'::jsonb`);
      return eraseRows(tx, w);
    });
    expect(rows).toEqual([{ new_value: { role: 'WARD_STAFF' }, old_value: null, session_id: null, version: null }]);
  });

  test.each([
    ['the ward_account id inside new_value', `jsonb_build_object('role', 'WARD_STAFF', 'ward_account', gen_random_uuid())`, '', ''],
    ['a uuid smuggled as the role', `jsonb_build_object('role', gen_random_uuid()::text)`, '', ''],
    ['an address inside new_value', `jsonb_build_object('role', 'WARD_STAFF', 'email', 'ward@example.test')`, '', ''],
    ['a session_id', `'{"role":"WARD_STAFF"}'::jsonb`, ', session_id', ', gen_random_uuid()'],
    ['a new_value that is not an object', `'"WARD_STAFF"'::jsonb`, '', ''],
  ])('plant — %s is refused by audit_log_login_erase_ward_only', async (_name, newValue, extra, extraValue) => {
    const e = await asPostgres(async (tx) => {
      const w = await freeWard(tx);
      return refusal(() => insert(tx, w, newValue, extra, extraValue));
    });
    expect(e.message).toContain('audit_log_login_erase_ward_only');
  });
});

describe('a missed withdrawal step is SEEN: its own job fails (R-2026-09-27-137 DM-2)', () => {
  /** Plants an active account at a facility whose agreement was withdrawn `days` ago. */
  async function plantWithdrawn(tx: Tx, days: number): Promise<{ w: Ward; id: string }> {
    const w = await freeWard(tx);
    const id = await plantLogin(tx, { ward: w, deactivatedDaysAgo: null });
    await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version, signatory_role) values ($1, current_date - 90, 'v1', 'CMD')
                     on conflict (facility_id) do nothing`, [w.facility] as never[]);
    await tx.unsafe(`update app.facility_agreement set accepted_on = least(accepted_on, current_date - 90), withdrawn_on = current_date - $2::int where facility_id = $1`, [w.facility, days] as never[]);
    return { w, id };
  }

  test('an active account at a facility withdrawn 31 days ago makes check_withdrawn_facility_accounts() RAISE, and nothing is deleted', async () => {
    const r = await asPostgres(async (tx) => {
      const { w, id } = await plantWithdrawn(tx, 31);
      await tx.unsafe('savepoint before_check');
      const e = await refusal(() => tx.unsafe('select app.check_withdrawn_facility_accounts()'));
      await tx.unsafe('rollback to savepoint before_check');
      const [a] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.audit_log where action = 'ward_account.login_erase' and facility_id = $1 and occurred_at = now()`, [w.facility] as never[]);
      return { message: e.message, after: await authCounts(tx, id), audit: a?.n ?? -1 };
    });
    expect(r.message).toMatch(/^WITHDRAWN_FACILITY_ACTIVE_ACCOUNTS: 1 active account\(s\) at a facility whose agreement was withdrawn more than 30 days ago/);
    expect(r.after, 'an active account at a withdrawn facility lost an auth row').toEqual(PLANTED);
    expect(r.audit).toBe(0);
  });

  test('control — with no such account, check_withdrawn_facility_accounts() does not raise', async () => {
    const n = await asPostgres(async (tx) => {
      const [r] = await tx.unsafe<{ n: number }[]>('select app.check_withdrawn_facility_accounts() as n');
      return r?.n;
    });
    expect(n).toBe(0);
  });

  test('the erasure no longer raises or warns for a withdrawn facility\'s active account', async () => {
    let erased = -1;
    const got = await withNotices(async (tx) => {
      await plantWithdrawn(tx, 31);
      const [r] = await tx.unsafe<{ n: number }[]>('select app.erase_lapsed_ward_logins() as n');
      erased = r?.n ?? -1;
    });
    expect(erased, 'the erasure raised or returned nothing').toBeGreaterThanOrEqual(0);
    expect(got.filter((n) => n.includes('WITHDRAWN_FACILITY_ACTIVE_ACCOUNTS')), 'the erasure still warns').toEqual([]);
  });
});

describe('an erased login never comes back (DL-2 b)', () => {
  test('provision_complete refuses an erased login with LOGIN_ERASED and its hint', async () => {
    const e = await asPostgres(async (tx) => {
      const w = await freeWard(tx);
      const id = await plantLogin(tx, { ward: w, deactivatedDaysAgo: DUE });
      await erase(tx);
      if ((await erasedAt(tx, id)) === null) throw new Error('the plant did not land: the login was not erased');
      const [inv] = await tx.unsafe<{ id: string }[]>(`insert into app.invite (facility_id, ward_category, role) values ($1, $2::app.ward_category, 'WARD_STAFF') returning id::text as id`, [w.facility, w.category] as never[]);
      return refusal(() => tx.unsafe('select * from app.provision_complete($1::uuid, $2::uuid)', [inv?.id, id] as never[]));
    });
    expect(e.message).toBe('LOGIN_ERASED');
    expect(e.hint).toBe('provision a new login');
  });

  test('a hand-run UPDATE reactivating an erased login violates ward_account_erased_never_active', async () => {
    const e = await asPostgres(async (tx) => {
      const w = await freeWard(tx);
      const id = await plantLogin(tx, { ward: w, deactivatedDaysAgo: DUE });
      await erase(tx);
      return refusal(() => tx.unsafe('update app.ward_account set is_active = true, deactivated_at = null where id = $1', [id] as never[]));
    });
    expect(e.message).toContain('ward_account_erased_never_active');
  });

  test('control — a deactivated login that was NOT erased still reactivates', async () => {
    const status = await asPostgres(async (tx) => {
      const w = await freeWard(tx);
      const id = await plantLogin(tx, { ward: w, deactivatedDaysAgo: NOT_DUE });
      const [inv] = await tx.unsafe<{ id: string }[]>(`insert into app.invite (facility_id, ward_category, role) values ($1, $2::app.ward_category, 'WARD_STAFF') returning id::text as id`, [w.facility, w.category] as never[]);
      const [r] = await tx.unsafe<{ status: string }[]>('select * from app.provision_complete($1::uuid, $2::uuid)', [inv?.id, id] as never[]);
      return r?.status;
    });
    expect(status).toBe('reactivated');
  });
});

describe('sessions are deleted within 30 days of their end (DL-2 c; DM-1)', () => {
  /** A session whose last use was `usedDaysAgo` days ago (UTC), created `createdDaysAgo` ago. */
  async function plantSession(tx: Tx, createdDaysAgo: number, usedDaysAgo: number | null): Promise<string> {
    const [{ id } = { id: '' }] = await tx.unsafe<{ id: string }[]>('select gen_random_uuid()::text as id');
    await tx.unsafe(`insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', $2)`, [id, `s-${id.slice(0, 8)}@example.test`] as never[]);
    const [{ sid } = { sid: '' }] = await tx.unsafe<{ sid: string }[]>(`
      insert into auth.sessions (id, user_id, created_at, updated_at, refreshed_at)
      values (gen_random_uuid(), $1,
              now() - make_interval(secs => $2::float8 * 86400),
              now() - make_interval(secs => $2::float8 * 86400),
              case when $3::float8 is null then null else (now() AT TIME ZONE 'UTC') - make_interval(secs => $3::float8 * 86400) end)
      returning id::text as sid`, [id, createdDaysAgo, usedDaysAgo] as never[]);
    await tx.unsafe(`insert into auth.refresh_tokens (token, user_id, session_id) values ('planted-' || $1, $1, $2)`, [id, sid] as never[]);
    return sid;
  }

  async function left(tx: Tx, sid: string): Promise<{ sessions: number; refresh_tokens: number }> {
    const [r] = await tx.unsafe<{ sessions: number; refresh_tokens: number }[]>(`
      select (select count(*)::int from auth.sessions where id = $1::uuid) as sessions,
             (select count(*)::int from auth.refresh_tokens where session_id = $1::uuid) as refresh_tokens`, [sid] as never[]);
    return r ?? { sessions: -1, refresh_tokens: -1 };
  }

  test.each([
    ['last used 30 days ago', 40, DUE, { sessions: 0, refresh_tokens: 0 }],
    ['last used 28 days ago', 40, NOT_DUE, { sessions: 1, refresh_tokens: 1 }],
    ['never refreshed, created 31 days ago (ended at created + 24 h, 30 days ago)', 31, null, { sessions: 0, refresh_tokens: 0 }],
    ['never refreshed, created 29 days ago (ended 28 days ago)', 29, null, { sessions: 1, refresh_tokens: 1 }],
  ] as const)('a session %s', async (_name, created, used, want) => {
    const r = await asPostgres(async (tx) => {
      const sid = await plantSession(tx, created, used);
      const before = await left(tx, sid);
      await tx.unsafe('select app.prune_ended_auth_sessions()');
      return { before, after: await left(tx, sid) };
    });
    expect(r.before, 'the plant did not land').toEqual({ sessions: 1, refresh_tokens: 1 });
    expect(r.after).toEqual(want);
  });

  test('the result does not move with the TimeZone: a session last used 28.75 days ago is kept at UTC+14', async () => {
    // refreshed_at is timestamp WITHOUT time zone, written in UTC. Read bare under a
    // TimeZone of +14 it would look 14 hours older -- 29.33 days -- and be deleted.
    // Re-pointed to the 29-day threshold by DM-1 b; at 30 days it planted 29.75.
    const r = await asPostgres(async (tx) => {
      const sid = await plantSession(tx, 40, 28.75);
      await tx.unsafe(`set local timezone = 'Pacific/Kiritimati'`);
      const [bare] = await tx.unsafe<{ old: boolean }[]>(`
        select greatest(created_at + interval '24 hours', coalesce(refreshed_at, updated_at, created_at)) < now() - interval '29 days' as old
          from auth.sessions where id = $1::uuid`, [sid] as never[]);
      await tx.unsafe('select app.prune_ended_auth_sessions()');
      return { bareWouldDelete: bare?.old, after: await left(tx, sid) };
    });
    expect(r.bareWouldDelete, 'the plant does not discriminate: the bare expression keeps it too').toBe(true);
    expect(r.after).toEqual({ sessions: 1, refresh_tokens: 1 });
  });
});

describe('the three jobs, and the G1 comment (DL-2 e, f; DM-2 b)', () => {
  interface Job { jobname: string; schedule: string; command: string; username: string }
  const EXPECTED: Job[] = [
    { jobname: 'openbed_erase_lapsed_ward_logins', schedule: '17 2 * * *', command: 'select app.erase_lapsed_ward_logins()', username: 'postgres' },
    { jobname: 'openbed_prune_ended_auth_sessions', schedule: '27 2 * * *', command: 'select app.prune_ended_auth_sessions()', username: 'postgres' },
    { jobname: 'openbed_check_withdrawn_facility_accounts', schedule: '37 2 * * *', command: 'select app.check_withdrawn_facility_accounts()', username: 'postgres' },
  ];

  async function applyTwiceFromEmpty(tx: Tx): Promise<void> {
    for (const j of EXPECTED) {
      await tx.unsafe('select cron.unschedule(jobname) from cron.job where jobname = $1 and username = current_user', [j.jobname] as never[]);
    }
    const [left] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from cron.job where jobname = any($1)', [EXPECTED.map((j) => j.jobname)] as never[]);
    if (left?.n !== 0) throw new Error(`precondition: ${left?.n} job row(s) survived unscheduling`);
    const text = readFileSync(MIGRATION, 'utf8');
    await tx.unsafe(text);
    await tx.unsafe(text);
  }

  async function violations(tx: Tx, job: Job): Promise<string[]> {
    const rows = await tx.unsafe<(Job & { active: boolean })[]>('select jobname, schedule, command, username, active from cron.job where jobname = $1 order by username', [job.jobname] as never[]);
    if (rows.length === 0) return [`${job.jobname} is not scheduled`];
    const out: string[] = [];
    if (rows.length > 1) out.push(`${job.jobname} is scheduled ${rows.length} times (${rows.map((r) => r.username).join(', ')})`);
    for (const r of rows) {
      if (r.schedule !== job.schedule) out.push(`${job.jobname} schedule is '${r.schedule}'`);
      if (r.command !== job.command) out.push(`${job.jobname} command is '${r.command}'`);
      if (r.username !== job.username) out.push(`${job.jobname} runs as '${r.username}'`);
      if (r.active !== true) out.push(`${job.jobname} is not active`);
    }
    return out;
  }

  test.each(EXPECTED)('024 schedules $jobname exactly once, on schedule, as postgres — even applied twice', async (job) => {
    const v = await withRole('postgres', null, (tx) => violations(tx, job), applyTwiceFromEmpty);
    expect(v).toEqual([]);
  });

  test.each(EXPECTED)('plant — a second $jobname under another role is reported', async (job) => {
    const v = await withRole('postgres', null, (tx) => violations(tx, job), async (tx) => {
      await applyTwiceFromEmpty(tx);
      await tx.unsafe('create role zz_cron_second nologin');
      await tx.unsafe('grant zz_cron_second to postgres');
      await tx.unsafe('grant usage on schema cron to zz_cron_second');
      await tx.unsafe('set local role zz_cron_second');
      await tx.unsafe('select cron.schedule($1, $2, $3)', [job.jobname, job.schedule, job.command] as never[]);
      await tx.unsafe('reset role');
    });
    expect(v).toContain(`${job.jobname} is scheduled 2 times (postgres, zz_cron_second)`);
  });

  test('anti-vacuity — with every job unscheduled the checker reports each missing', async () => {
    const v = await withRole('postgres', null, async (tx) => (await Promise.all(EXPECTED.map((j) => violations(tx, j)))).flat(), async (tx) => {
      for (const j of EXPECTED) await tx.unsafe('select cron.unschedule(jobname) from cron.job where jobname = $1', [j.jobname] as never[]);
    });
    expect(v).toEqual(EXPECTED.map((j) => `${j.jobname} is not scheduled`));
  });

  test('the facility_contact comment is G1\'s, word for word', async () => {
    const [r] = await asPostgres((tx) => tx.unsafe<{ c: string }[]>(`select obj_description('app.facility_contact'::regclass, 'pg_class') as c`));
    expect(r?.c).toBe(
      "One invited human per facility (CMD or matron): business-contact data held on the legitimate-interests basis (NDPA s.25(1)(f)), not contract: the contact is not a party to the facility agreement (G1, founder's decision 2026-09-26). DELIBERATELY NOT append-only -- this row must stay deletable on request, which is why 010 names it as outside the append-only set. Nothing here ever reaches app.audit_log, app.ward_status_event, or any public mirror.",
    );
  });
});
