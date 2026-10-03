import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { signInWard, type WardSession } from '../setup/auth.js';
import { sql, sqlSecond } from '../setup/db.js';
import { dbUrl } from '../setup/local-keys.js';

/**
 * A RE-SEND OF A PUBLISH THAT IS STILL IN FLIGHT REPLAYS; IT NEVER DUPLICATES
 * (R-2026-10-02-FF FF-4 e, -182).
 *
 * WHY THIS IS A TEST. The ward console's fallback re-sends a publish, byte for byte, when the answer to the
 * first send was lost (packages/auth/src/fallback.ts). The first send may NOT have finished: a Worker that
 * forwarded the request and then hung leaves the original still running at the database while the re-send
 * arrives. D5 rests on "a re-send is safe, call by call", and for publish_ward_status that is read from
 * migration 026: step 5 takes FOR UPDATE on the ward row BEFORE step 6's replay check, so a concurrent retry
 * "waits here and then finds the event the first one wrote". The function is VOLATILE and runs at READ
 * COMMITTED, so step 6 reads with a fresh snapshot after the wait. That was PREDICTED by reading. This file is
 * the measurement.
 *
 * THE SHAPE. Two connections, as the same ward, each in a real transaction that COMMITS (tests/setup/db.ts's
 * withRole() always rolls back, and tests/db/provisioning_gates.test.ts's precedent is two autocommit calls, so
 * neither can hold a transaction open). A calls the function and HOLDS, with its row lock and an uncommitted
 * event. B calls it with the SAME body. B must be seen BLOCKED ON A LOCK, by a third observer connection reading
 * pg_stat_activity, before A commits: a B that merely returned late would prove nothing about step 5. Then A
 * commits, B returns, and the assertions are: B's `replayed` is TRUE, A's is false, and there is exactly ONE
 * event row for the mutation id.
 *
 * BOTH TRANSACTIONS RUN AS `postgres`, NOT AS A SWITCHED ROLE. tests/setup/db.ts says sqlSecond() is never for a
 * role-switching test, and this is not one: nothing here switches role. The function is SECURITY DEFINER and
 * reads its identity from auth.uid() and auth.jwt(), which read the `request.jwt.claims` setting, so each
 * transaction sets only that (set_config, transaction-local) and the call is exactly the one a ward session
 * makes through PostgREST, minus the transport. RLS is not what is under test; the lock is.
 *
 * WHAT IS COMMITTED. A fixed-id facility, INACTIVE and UNLISTED so no projection or mirror ever carries it, with
 * one ward and one ward login. The event and audit rows are append-only with ON DELETE RESTRICT (004, 010), so
 * the facility and ward can never be deleted; afterAll removes only the ward login and its GoTrue user, so no
 * active account outlives the file (the 022, 025 and 026 down-migration tests care). Its UUID sorts last, so the
 * tests that pick "the first ward by order" (retention_jobs, migration_024_round_trip) do not meet it first.
 * A re-run without a database reset finds the rows and uses them: the version is READ, never assumed.
 *
 * NOT ASSERTED HERE, deliberately: that this test would go red without step 5's FOR UPDATE, BY THE TEST ITSELF in CI. CI cannot
 * apply a modified migration to its database. RESTATED 2026-10-03 (R-2026-10-02-FG, -183): the neuter WAS run, once, by
 * scripts/neuter.sh with its `apply` and `probe` hooks (the harness re-applies the planted 026 to the local database and
 * probes the function body's md5, then restores and re-probes), and it reddened exactly this plant, with the sequential
 * control green. So the lock IS in the path, measured, not argued; the run is a session fact, not a CI one. The old text,
 * kept: "A neuter would need to rewrite migration 026 and reset the database, which the compliance neuter harness does not
 * do ... a function with the lock removed would show no blocked backend and reds there, but that is argued, not run."
 * (2026-10-02). WHICH assertion inside the plant reddened (the lock-wait observation, or an exception from B) was not read:
 * the harness reports test names, not messages.
 * NOT ASSERTED HERE: the Worker, the fallback, or HTTP. That is ward_console_fallback_acceptance.test.ts.
 */

const FAC = 'ffff0000-0000-4000-8000-00000000f4e1';
const CATEGORY = 'ICU_ADULT';
const EMAIL = `concurrent-resend-${Date.now()}@ward.invalid`;

let session: WardSession;
let version = 0;
const observer = postgres(dbUrl(), { max: 1, onnotice: () => {}, connect_timeout: 10 });

beforeAll(async () => {
  session = await signInWard(EMAIL);
  const db = sql();
  await db`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, is_active)
    values (${FAC}::uuid, 'Concurrent Resend Probe', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000193', false)
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
  const [row] = await db<{ version: number }[]>`select version from app.ward_status where facility_id = ${FAC}::uuid and category = ${CATEGORY}`;
  if (row === undefined) throw new Error('the probe ward was not created, so the test would publish to nothing');
  version = row.version;
});

afterAll(async () => {
  const db = sql();
  await db`delete from app.ward_account where id = ${session?.userId ?? randomUUID()}::uuid`;
  await db`delete from auth.users where email = ${EMAIL}`;
  await observer.end({ timeout: 5 });
});

/**
 * The ward's version, READ from the database at the start of each test (R-2026-10-02-FG, -183). It was a module variable
 * the first test updated at its END, so when that test failed (as it must under the FOR UPDATE neuter, V10) the second
 * test sent a STALE expected version and failed too: a cascade, not independent evidence. Each test now reads its own.
 */
async function currentVersion(): Promise<number> {
  const [row] = await sql()<{ version: number }[]>`select version from app.ward_status where facility_id = ${FAC}::uuid and category = ${CATEGORY}`;
  if (row === undefined) throw new Error('the probe ward does not exist');
  return row.version;
}

interface PublishRow {
  readonly replayed: boolean;
  readonly version: number;
}

describe('a re-send while the first send is still running', () => {
  test('plant — B, re-sending the same body while A is held open, waits on the ward row, then returns replayed = true and writes nothing; one event row exists', async () => {
    const mutationId = randomUUID();
    const composedAt = new Date().toISOString();
    const claims = JSON.stringify({ sub: session.userId, role: 'authenticated', aud: 'authenticated', session_id: randomUUID(), email: EMAIL });
    version = await currentVersion();
    const body = [CATEGORY, 'OFFERED', 7, true, null, version, mutationId, composedAt] as const;

    const call = async (tx: postgres.TransactionSql): Promise<PublishRow> => {
      await tx`select set_config('request.jwt.claims', ${claims}, true)`;
      const rows = await tx<PublishRow[]>`
        select replayed, version from public.publish_ward_status(${body[0]}, ${body[1]}, ${body[2]}, ${body[3]}, ${body[4]}, ${body[5]}, ${body[6]}, ${body[7]}::timestamptz)
      `;
      const row = rows[0];
      if (row === undefined) throw new Error('publish_ward_status returned no row');
      return row;
    };

    let aCalled!: () => void;
    const aHasCalled = new Promise<void>((r) => { aCalled = r; });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    // A: BEGIN, call, and HOLD. Returning from the callback is the COMMIT.
    const a = sql().begin(async (tx) => {
      const row = await call(tx);
      aCalled();
      await gate;
      return row;
    });
    await aHasCalled;

    // B: the same body, on the second connection. It must block at step 5.
    let bSettled = false;
    const b = sqlSecond().begin(async (tx) => call(tx)).finally(() => { bSettled = true; });

    // B must be seen BLOCKED ON A LOCK: a B that was merely slow would prove nothing about step 5.
    let blocked = 0;
    for (let i = 0; i < 100 && blocked === 0; i += 1) {
      const rows = await observer<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
         where wait_event_type = 'Lock' and query ilike '%publish_ward_status%' and pid <> pg_backend_pid()
      `;
      blocked = rows[0]?.n ?? 0;
      if (blocked === 0) await new Promise((r) => setTimeout(r, 50));
    }
    expect(blocked, 'B was never seen waiting on a lock: either it did not reach step 5, or the lock is not in the path').toBeGreaterThan(0);
    expect(bSettled, 'B returned while A was still open: it did not wait for the first send').toBe(false);

    release();
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra.replayed, 'the first send was reported as a replay').toBe(false);
    expect(rb.replayed, 'the re-send was not a replay: the same mutation id wrote twice, or conflicted').toBe(true);
    expect(rb.version, 'the replay reports what is true now, which is the version A wrote').toBe(ra.version);

    const [count] = await sql()<{ n: number }[]>`
      select count(*)::int as n from app.ward_status_event e
        join app.ward_status ws on ws.id = e.ward_status_id
       where ws.facility_id = ${FAC}::uuid and ws.category = ${CATEGORY} and e.client_mutation_id = ${mutationId}
    `;
    expect(count?.n, 'the mutation id must have exactly ONE event row').toBe(1);
    version = ra.version;
  });

  test('control — the ordinary sequential re-send, after the first has committed, is also a replay with no new row', async () => {
    version = await currentVersion();
    const mutationId = randomUUID();
    const composedAt = new Date().toISOString();
    const claims = JSON.stringify({ sub: session.userId, role: 'authenticated', aud: 'authenticated', session_id: randomUUID(), email: EMAIL });
    const send = (): Promise<PublishRow> =>
      sql().begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${claims}, true)`;
        const rows = await tx<PublishRow[]>`
          select replayed, version from public.publish_ward_status(${CATEGORY}, 'OFFERED', 8, true, null, ${version}, ${mutationId}, ${composedAt}::timestamptz)
        `;
        return rows[0] as PublishRow;
      });
    const first = await send();
    const second = await send();
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    const [count] = await sql()<{ n: number }[]>`select count(*)::int as n from app.ward_status_event where client_mutation_id = ${mutationId}`;
    expect(count?.n).toBe(1);
    version = first.version;
  });
});
