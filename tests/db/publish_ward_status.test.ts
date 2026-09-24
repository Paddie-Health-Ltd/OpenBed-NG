import { describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * THE WRITE PATH -- public.publish_ward_status (migration 014).
 *
 * THE CONTRACT CARRIES TWO FACTS AND NO FIELD SERVES BOTH (founder ruling,
 * 2026-09-14). claim_* is what the ward said; public_* is what the public will
 * see, read back from public.ward_public in the same transaction. Finding F1 is
 * why: the gate can reduce a claim, and a nurse told only one number can believe
 * she is advertising beds she is not. The gated-ward test below is that case.
 *
 * THE DERIVATION IS PROVED, NOT ASSERTED. Two tests carry it:
 *   - the returned public fields EQUAL the mirror row after the call, for an
 *     ungated, a gated, a NOT_OFFERED and a quiet ward -- and public_listed is
 *     false exactly when the mirror has no row;
 *   - a floor planted where the projection writes (a trigger on
 *     public.ward_public, rolled back with everything else) reaches
 *     public_bed_count while claim_bed_count stays exact, WITH NO CHANGE TO THE
 *     RPC. A function that recomputed the public value instead of reading it
 *     back cannot pass that test, and that is the property the ruling depends on:
 *     a floor changes a value, not a signature.
 *
 * EVERY PROBE ROLLS BACK. The seed below is created inside each transaction and
 * disappears with it; the shared corpus is never touched.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - HOSTED ROW-LEVEL SECURITY ON THE MIRRORS. public.ward_public is FORCE ROW
 *     LEVEL SECURITY (007), and reading it inside the function needs the owner to
 *     bypass that. Locally postgres holds BYPASSRLS (rolsuper f), and this suite
 *     cannot observe hosted. Observed 2026-09-15: hosted postgres is the same,
 *     rolsuper f / rolbypassrls t; the hosted OWNER of these functions is read in
 *     runbook step 5 after the apply. The projection's own upsert needs the same
 *     privilege in the same transaction, so a hosted owner without it would fail
 *     loudly there first.
 *   - That session_id comes from a REAL GoTrue session. Claims here are hand-set,
 *     which is fine for the refusal but cannot show a GoTrue-minted session id
 *     differs from the account and changes across sessions. That is
 *     tests/db/publish_session_id_live.test.ts.
 *   - Two interleaved writers. The sequential VERSION_CONFLICT case is here; the
 *     two-connection race is Stage 2, on sqlSecond().
 */

const FAC_OPEN = '88888888-0000-4000-8000-000000000001';
const FAC_GATED = '88888888-0000-4000-8000-000000000002';
const FAC_QUIET = '88888888-0000-4000-8000-000000000003';

const U_MATERNITY = '88888888-0000-4000-8000-0000000000a1';
const U_SCBU = '88888888-0000-4000-8000-0000000000a2';
const U_ICU = '88888888-0000-4000-8000-0000000000a3';
const U_THEATRE_GATED = '88888888-0000-4000-8000-0000000000a4';
const U_QUIET = '88888888-0000-4000-8000-0000000000a5';
const U_ADMIN = '88888888-0000-4000-8000-0000000000a6';

async function seed(tx: TransactionSql): Promise<void> {
  for (const [id, name, quiet] of [
    [FAC_OPEN, 'Publish Open', false],
    [FAC_GATED, 'Publish Gated', false],
    [FAC_QUIET, 'Publish Quiet', true],
  ] as const) {
    await tx.unsafe(`
      insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, quiet_mode, listed_at)
      values ('${id}', '${name}', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000091', ${quiet}, now())
    `);
    // 021 (R-2026-09-24-83 BK-1): public requires an active agreement. Synthetic.
    await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${id}', '2026-09-01', 'v1.0')`);
  }
  // The gate's input. Only the gated facility records an absent anaesthetist;
  // the others have no facility_ops row at all, which the projection treats as
  // ungated (no recorded cover is not recorded absence of cover).
  await tx.unsafe(`insert into app.facility_ops (facility_id, anaesthetist) values ('${FAC_GATED}', 'NO')`);

  await tx.unsafe(`
    insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state) values
      ('${FAC_OPEN}',  'MATERNITY', 'OFFERED',     null, true, 'PENDING'),
      ('${FAC_OPEN}',  'SCBU',      'NOT_OFFERED', null, true, 'PENDING'),
      ('${FAC_OPEN}',  'ICU_ADULT', 'OFFERED',     3,    true, 'ACTIVE'),
      ('${FAC_GATED}', 'THEATRE',   'OFFERED',     2,    true, 'ACTIVE'),
      ('${FAC_QUIET}', 'ICU_ADULT', 'OFFERED',     3,    true, 'ACTIVE')
  `);

  await tx.unsafe(`
    insert into app.ward_account (id, facility_id, ward_category, role) values
      ('${U_MATERNITY}',     '${FAC_OPEN}',  'MATERNITY', 'WARD_STAFF'),
      ('${U_SCBU}',          '${FAC_OPEN}',  'SCBU',      'WARD_STAFF'),
      ('${U_ICU}',           '${FAC_OPEN}',  'ICU_ADULT', 'WARD_STAFF'),
      ('${U_THEATRE_GATED}', '${FAC_GATED}', 'THEATRE',   'WARD_STAFF'),
      ('${U_QUIET}',         '${FAC_QUIET}', 'ICU_ADULT', 'WARD_STAFF'),
      ('${U_ADMIN}',         '${FAC_OPEN}',  null,        'FACILITY_ADMIN')
  `);
}

/** Claims as PostgREST would set them. session_id is a fresh uuid unless given. */
function claims(sub: string, sessionId: string = randomUUID()): Record<string, unknown> {
  return { sub, role: 'authenticated', session_id: sessionId };
}

interface Contract {
  version: number;
  updated_at: Date;
  replayed: boolean;
  claim_offering: string;
  claim_bed_count: number | null;
  claim_accepting: boolean;
  public_listed: boolean;
  public_bed_count: number | null;
  public_accepting_effective: boolean | null;
  public_gated_by: string | null;
}

interface PublishArgs {
  category: string;
  offering?: string;
  bedCount?: number | null;
  accepting?: boolean;
  reason?: string | null;
  expectedVersion?: number | null;
  mutationId?: string | null;
  composedAt?: string | null;
}

/**
 * An UNTYPED SQL literal. Never `::app.ward_category`.
 *
 * `authenticated` has no USAGE on schema `app` -- that is 001's revoke wall -- so
 * naming an app type in the caller's SQL is refused with "permission denied for
 * schema app" before the function is reached. A client never names the type: the
 * argument arrives untyped and resolves against the function's signature. The
 * values here are the test's own constants, not input.
 */
function lit(v: string | number | boolean | null): string {
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

async function publish(tx: TransactionSql, a: PublishArgs): Promise<Contract> {
  const args = [
    a.category,
    a.offering ?? 'OFFERED',
    'bedCount' in a ? (a.bedCount ?? null) : 4,
    a.accepting ?? true,
    a.reason ?? null,
    'expectedVersion' in a ? (a.expectedVersion ?? null) : 1,
    'mutationId' in a ? (a.mutationId ?? null) : randomUUID(),
    'composedAt' in a ? (a.composedAt ?? null) : new Date().toISOString(),
  ];
  const rows = await tx.unsafe<Contract[]>(`select * from public.publish_ward_status(${args.map(lit).join(', ')})`);
  const row = rows[0];
  if (!row) throw new Error('publish_ward_status returned no row');
  return row;
}

interface Refusal {
  code: string | undefined;
  message: string;
  detail: string | undefined;
}

/** The call must fail. Returns what it failed with, so the exact signal is asserted. */
async function refusal(p: Promise<unknown>): Promise<Refusal> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; message: string; detail?: string };
    return { code: x.code, message: x.message, detail: x.detail };
  }
  throw new Error('expected a refusal, and the call succeeded');
}

describe('publish_ward_status — the write path', () => {
  test('ward staff at their own facility publishes successfully — claim and public returned, event and audit written, PENDING becomes ACTIVE', async () => {
    const session = randomUUID();
    const out = await withRole(
      'authenticated',
      claims(U_MATERNITY, session),
      async (tx) => {
        const c = await publish(tx, { category: 'MATERNITY', bedCount: 4, mutationId: 'first-publish' });
        await tx.unsafe('RESET ROLE');
        const events = await tx.unsafe<{ version: number; bed_count: number; client_mutation_id: string }[]>(
          `select e.version, e.bed_count, e.client_mutation_id from app.ward_status_event e
             join app.ward_status ws on ws.id = e.ward_status_id
            where ws.facility_id = '${FAC_OPEN}' and ws.category = 'MATERNITY'`,
        );
        const audits = await tx.unsafe<{ action: string; version: number; session_id: string; new_value: unknown }[]>(
          `select action, version, session_id::text as session_id, new_value from app.audit_log
            where facility_id = '${FAC_OPEN}' and ward_category = 'MATERNITY'`,
        );
        const ward = await tx.unsafe<{ monitoring_state: string; source: string }[]>(
          `select monitoring_state::text as monitoring_state, source::text as source from app.ward_status
            where facility_id = '${FAC_OPEN}' and category = 'MATERNITY'`,
        );
        return { c, events, audits, ward };
      },
      seed,
    );

    expect(out.c.version, 'the first publish did not move version from 1 to 2').toBe(2);
    expect(out.c.replayed, 'a fresh publish was reported as a replay').toBe(false);
    expect(out.c.claim_bed_count, 'the claim was not returned as recorded').toBe(4);
    expect(out.c.claim_accepting).toBe(true);
    expect(out.c.claim_offering).toBe('OFFERED');
    expect(out.c.public_listed, 'an active, non-quiet facility is not listed').toBe(true);
    expect(out.c.public_bed_count, 'the public count differs from an ungated claim').toBe(4);
    expect(out.c.public_accepting_effective).toBe(true);
    expect(out.c.public_gated_by).toBeNull();

    expect(out.events, 'the publish did not write exactly one event').toHaveLength(1);
    expect(out.events[0]).toMatchObject({ version: 2, bed_count: 4, client_mutation_id: 'first-publish' });
    expect(out.audits, 'the publish did not write exactly one audit row').toHaveLength(1);
    expect(out.audits[0]).toMatchObject({ action: 'ward_status.publish', version: 2, session_id: session });
    expect(out.audits[0]?.new_value).toEqual({ offering: 'OFFERED', bed_count: 4, accepting: true });
    expect(out.ward[0], 'a first publish did not move the ward out of PENDING').toEqual({ monitoring_state: 'ACTIVE', source: 'WARD' });
  });

  test('missing-auth publish is rejected with 42501 NOT_AUTHENTICATED', async () => {
    const r = await refusal(withRole('authenticated', null, (tx) => publish(tx, { category: 'MATERNITY' }), seed));
    expect(r.message).toContain('NOT_AUTHENTICATED');
    expect(r.code).toBe('42501');
  });

  test('deactivated ward staff publish is rejected with ACCOUNT_DEACTIVATED', async () => {
    const r = await refusal(
      withRole('authenticated', claims(U_MATERNITY), (tx) => publish(tx, { category: 'MATERNITY' }), async (tx) => {
        await seed(tx);
        await tx.unsafe(`update app.ward_account set is_active = false, deactivated_at = now() where id = '${U_MATERNITY}'`);
      }),
    );
    expect(r.message).toContain('ACCOUNT_DEACTIVATED');
    expect(r.code).toBe('42501');
  });

  test('facility admin publish is rejected with INSUFFICIENT_ROLE — admin publish is Stage 2, and would falsify source', async () => {
    const r = await refusal(withRole('authenticated', claims(U_ADMIN), (tx) => publish(tx, { category: 'MATERNITY' }), seed));
    expect(r.message).toContain('INSUFFICIENT_ROLE');
    expect(r.code).toBe('42501');
  });

  test.each([
    ['p_category', { category: 'NOT_A_WARD' }],
    ['p_offering', { category: 'MATERNITY', offering: 'MAYBE' }],
    ['p_reason', { category: 'MATERNITY', bedCount: 0, reason: 'BECAUSE' }],
  ] as const)('an unknown %s value is rejected with INVALID_ARGUMENT naming the parameter', async (param, args) => {
    const r = await refusal(withRole('authenticated', claims(U_MATERNITY), (tx) => publish(tx, args), seed));
    expect(r.message).toContain('INVALID_ARGUMENT');
    expect(r.code).toBe('P0001');
    expect(r.detail, 'the refusal did not name the parameter').toBe(param);
  });

  test.each([
    ['lower-cased', 'maternity'],
    ['space-padded', ' MATERNITY'],
  ] as const)('a %s category is rejected with INVALID_ARGUMENT — the function accepts exactly what the enum accepts, with no normalisation', async (_label, category) => {
    const r = await refusal(withRole('authenticated', claims(U_MATERNITY), (tx) => publish(tx, { category }), seed));
    expect(r.message).toContain('INVALID_ARGUMENT');
    expect(r.detail).toBe('p_category');
  });

  test('ward staff publish to another category is rejected with WARD_SCOPE_DENIED', async () => {
    const r = await refusal(withRole('authenticated', claims(U_MATERNITY), (tx) => publish(tx, { category: 'ICU_ADULT' }), seed));
    expect(r.message).toContain('WARD_SCOPE_DENIED');
    expect(r.code).toBe('42501');
  });

  test('stale expected_version publish is rejected with VERSION_CONFLICT carrying the current version, and the row is unchanged', async () => {
    const out = await withRole(
      'authenticated',
      claims(U_ICU),
      async (tx) => {
        await publish(tx, { category: 'ICU_ADULT', bedCount: 5, expectedVersion: 1 });
        const r = await refusal(tx.savepoint((sp) => publish(sp, { category: 'ICU_ADULT', bedCount: 9, expectedVersion: 1 })));
        await tx.unsafe('RESET ROLE');
        const [row] = await tx.unsafe<{ version: number; bed_count: number }[]>(
          `select version, bed_count from app.ward_status where facility_id = '${FAC_OPEN}' and category = 'ICU_ADULT'`,
        );
        return { r, row };
      },
      seed,
    );
    expect(out.r.message).toContain('VERSION_CONFLICT');
    expect(out.r.code).toBe('P0001');
    expect(out.r.detail, 'the conflict did not carry the current version').toBe('current_version=2');
    expect(out.row, 'a refused write changed the row').toEqual({ version: 2, bed_count: 5 });
  });

  test('composed_at three minutes old is rejected with STALE_MUTATION', async () => {
    const composedAt = new Date(Date.now() - 3 * 60_000).toISOString();
    const r = await refusal(withRole('authenticated', claims(U_MATERNITY), (tx) => publish(tx, { category: 'MATERNITY', composedAt }), seed));
    expect(r.message).toContain('STALE_MUTATION');
    expect(r.code).toBe('P0001');
  });

  test('composed_at thirty-one seconds ahead is rejected with FUTURE_MUTATION — a fast handset must not pass the staleness check forever', async () => {
    const composedAt = new Date(Date.now() + 31_000).toISOString();
    const r = await refusal(withRole('authenticated', claims(U_MATERNITY), (tx) => publish(tx, { category: 'MATERNITY', composedAt }), seed));
    expect(r.message).toContain('FUTURE_MUTATION');
    expect(r.code).toBe('P0001');
  });

  test('zero beds offered with no reason is rejected with ZERO_REQUIRES_REASON', async () => {
    const r = await refusal(withRole('authenticated', claims(U_ICU), (tx) => publish(tx, { category: 'ICU_ADULT', bedCount: 0, reason: null }), seed));
    expect(r.message).toContain('ZERO_REQUIRES_REASON');
    expect(r.code).toBe('P0001');
  });

  test('ward staff publishing zero beds with a reason succeeds, and the reason lands on the event and not the ward', async () => {
    const out = await withRole(
      'authenticated',
      claims(U_ICU),
      async (tx) => {
        const c = await publish(tx, { category: 'ICU_ADULT', bedCount: 0, reason: 'ALL_BEDS_OCCUPIED' });
        await tx.unsafe('RESET ROLE');
        const [ev] = await tx.unsafe<{ reason_code: string }[]>(
          `select e.reason_code::text as reason_code from app.ward_status_event e
             join app.ward_status ws on ws.id = e.ward_status_id
            where ws.facility_id = '${FAC_OPEN}' and ws.category = 'ICU_ADULT'`,
        );
        return { c, ev };
      },
      seed,
    );
    expect(out.c.claim_bed_count).toBe(0);
    expect(out.ev?.reason_code).toBe('ALL_BEDS_OCCUPIED');
  });

  test('missing-context publish with no client_mutation_id is rejected with MISSING_MUTATION_CONTEXT', async () => {
    const r = await refusal(withRole('authenticated', claims(U_MATERNITY), (tx) => publish(tx, { category: 'MATERNITY', mutationId: null }), seed));
    expect(r.message).toContain('MISSING_MUTATION_CONTEXT');
    expect(r.code).toBe('P0001');
  });

  test('missing-context publish with no composed_at is rejected with MISSING_MUTATION_CONTEXT', async () => {
    const r = await refusal(withRole('authenticated', claims(U_MATERNITY), (tx) => publish(tx, { category: 'MATERNITY', composedAt: null }), seed));
    expect(r.message).toContain('MISSING_MUTATION_CONTEXT');
    expect(r.code).toBe('P0001');
  });

  test('a NOT_OFFERED ward publishing a count is rejected by the existing CHECK with 23514', async () => {
    const r = await refusal(
      withRole('authenticated', claims(U_SCBU), (tx) => publish(tx, { category: 'SCBU', offering: 'NOT_OFFERED', bedCount: 2 }), seed),
    );
    expect(r.code).toBe('23514');
    expect(r.message).toContain('ward_status_not_offered_has_no_count');
  });

  test('a session_id equal to auth.uid() is rejected with SESSION_ID_IS_ACCOUNT_ID — the audit correlation id must never be the account', async () => {
    const r = await refusal(withRole('authenticated', claims(U_MATERNITY, U_MATERNITY), (tx) => publish(tx, { category: 'MATERNITY' }), seed));
    expect(r.message).toContain('SESSION_ID_IS_ACCOUNT_ID');
    expect(r.code).toBe('42501');
  });

  test('the same client_mutation_id twice yields one event, one version bump and the same payload', async () => {
    const composedAt = new Date().toISOString();
    const out = await withRole(
      'authenticated',
      claims(U_MATERNITY),
      async (tx) => {
        const first = await publish(tx, { category: 'MATERNITY', bedCount: 4, mutationId: 'retried', composedAt });
        // A retry carries the SAME body, including the now-stale expected_version.
        const second = await publish(tx, { category: 'MATERNITY', bedCount: 4, mutationId: 'retried', composedAt });
        await tx.unsafe('RESET ROLE');
        const [counts] = await tx.unsafe<{ events: number; audits: number; version: number }[]>(`
          select
            (select count(*)::int from app.ward_status_event e join app.ward_status ws on ws.id = e.ward_status_id
              where ws.facility_id = '${FAC_OPEN}' and ws.category = 'MATERNITY') as events,
            (select count(*)::int from app.audit_log where facility_id = '${FAC_OPEN}' and ward_category = 'MATERNITY') as audits,
            (select version from app.ward_status where facility_id = '${FAC_OPEN}' and category = 'MATERNITY') as version
        `);
        return { first, second, counts };
      },
      seed,
    );
    // Condition G: a replay is NAMED. version alone cannot distinguish it -- an
    // immediate retry returns the same version the original call returned.
    expect(out.first.replayed, 'a fresh publish was reported as a replay').toBe(false);
    expect(out.second.replayed, 'a replay was not named as one in the response').toBe(true);
    expect({ ...out.second, replayed: false }, 'a replay returned different state').toEqual(out.first);
    expect(out.counts, 'a replay wrote a second event, a second audit row, or bumped version twice').toEqual({ events: 1, audits: 1, version: 2 });
  });

  test('a gated ward returns claim_accepting=true and public_accepting_effective=false with public_gated_by NO_ANAESTHETIST_ON_DUTY', async () => {
    // F1, the case the two-field contract exists for. The nurse claimed she is
    // accepting; the public sees a closed theatre. One field could not say both.
    const c = await withRole(
      'authenticated',
      claims(U_THEATRE_GATED),
      (tx) => publish(tx, { category: 'THEATRE', bedCount: 2, accepting: true }),
      seed,
    );
    expect(c.claim_accepting, 'the claim was rewritten by the gate').toBe(true);
    expect(c.public_listed).toBe(true);
    expect(c.public_accepting_effective, 'the public value ignored the gate').toBe(false);
    expect(c.public_gated_by).toBe('NO_ANAESTHETIST_ON_DUTY');
  });

  test('a quiet facility records the claim and returns public_listed=false with null public fields', async () => {
    const c = await withRole('authenticated', claims(U_QUIET), (tx) => publish(tx, { category: 'ICU_ADULT', bedCount: 5 }), seed);
    expect(c.claim_bed_count, 'a quiet facility did not record the claim').toBe(5);
    expect(c.version).toBe(2);
    expect(c.public_listed, 'a quiet facility was reported as listed').toBe(false);
    expect(c.public_bed_count).toBeNull();
    expect(c.public_accepting_effective).toBeNull();
    expect(c.public_gated_by).toBeNull();
  });

  test.each([
    ['ungated', U_MATERNITY, FAC_OPEN, { category: 'MATERNITY', bedCount: 4 }],
    ['gated', U_THEATRE_GATED, FAC_GATED, { category: 'THEATRE', bedCount: 2 }],
    ['NOT_OFFERED', U_SCBU, FAC_OPEN, { category: 'SCBU', offering: 'NOT_OFFERED', bedCount: null }],
    ['quiet', U_QUIET, FAC_QUIET, { category: 'ICU_ADULT', bedCount: 5 }],
  ] as const)('returned public fields equal public.ward_public after the call — %s ward', async (_label, user, facility, args) => {
    const out = await withRole(
      'authenticated',
      claims(user),
      async (tx) => {
        const c = await publish(tx, args);
        await tx.unsafe('RESET ROLE');
        const mirror = await tx.unsafe<{ bed_count: number | null; accepting_effective: boolean; gated_by: string | null }[]>(
          `select bed_count, accepting_effective, gated_by::text as gated_by from public.ward_public
            where facility_id = '${facility}' and category = '${args.category}'`,
        );
        return { c, mirror };
      },
      seed,
    );
    expect(out.c.public_listed, 'public_listed disagrees with whether the mirror holds a row').toBe(out.mirror.length === 1);
    const row = out.mirror[0];
    expect(
      { bed: out.c.public_bed_count, eff: out.c.public_accepting_effective, gated: out.c.public_gated_by },
      'the returned public fields are not what the projection wrote',
    ).toEqual({ bed: row?.bed_count ?? null, eff: row?.accepting_effective ?? null, gated: row?.gated_by ?? null });
  });

  test('a floor applied where the projection writes reaches public_bed_count without any change to the RPC', async () => {
    const out = await withRole(
      'authenticated',
      claims(U_MATERNITY),
      async (tx) => {
        const c = await publish(tx, { category: 'MATERNITY', bedCount: 7 });
        await tx.unsafe('RESET ROLE');
        const [mirror] = await tx.unsafe<{ bed_count: number }[]>(
          `select bed_count from public.ward_public where facility_id = '${FAC_OPEN}' and category = 'MATERNITY'`,
        );
        return { c, mirror };
      },
      async (tx) => {
        await seed(tx);
        // THE PLANT: a granularity floor of 5, applied to whatever the projection
        // writes into the mirror. Rolled back with the transaction.
        await tx.unsafe(`
          create function public.zz_plant_floor_bed_count() returns trigger language plpgsql as $$
          begin new.bed_count := (new.bed_count / 5) * 5; return new; end $$
        `);
        await tx.unsafe(`
          create trigger zz_plant_floor before insert or update on public.ward_public
          for each row execute function public.zz_plant_floor_bed_count()
        `);
      },
    );
    expect(out.mirror?.bed_count, 'the plant did not land: the mirror was not floored').toBe(5);
    expect(out.c.claim_bed_count, 'the floor leaked into the claim').toBe(7);
    expect(out.c.public_bed_count, 'the public field did not carry the floored value the projection wrote').toBe(5);
  });

  test('publish_ward_status signature regression — no facility argument, exactly the eight parameters and the two-fact result', async () => {
    const [row] = await withRole('postgres', null, (tx) =>
      tx.unsafe<{ args: string; result: string }[]>(`
        select pg_get_function_identity_arguments('public.publish_ward_status'::regproc) as args,
               pg_get_function_result('public.publish_ward_status'::regproc) as result
      `),
    );
    // text, not app enums: authenticated has no USAGE on schema app, and
    // PostgREST names parameter types, so an app-typed parameter is uncallable
    // over HTTP. Observed on the golden path on 2026-09-14 as 42501.
    expect(row?.args).toBe(
      'p_category text, p_offering text, p_bed_count integer, p_accepting boolean, ' +
        'p_reason text, p_expected_version integer, p_client_mutation_id text, p_composed_at timestamp with time zone',
    );
    const [appTyped] = await withRole('postgres', null, (tx) =>
      tx.unsafe<{ n: number }[]>(`
        select count(*)::int as n
          from unnest((select proargtypes from pg_proc where oid = 'public.publish_ward_status'::regproc)) t(oid)
          join pg_type ty on ty.oid = t.oid
          join pg_namespace ns on ns.oid = ty.typnamespace
         where ns.nspname = 'app'
      `),
    );
    expect(appTyped?.n, 'a parameter is typed in schema app, which no client can name').toBe(0);
    expect(row?.result).toBe(
      'TABLE(version integer, updated_at timestamp with time zone, replayed boolean, claim_offering app.ward_offering, claim_bed_count integer, ' +
        'claim_accepting boolean, public_listed boolean, public_bed_count integer, public_accepting_effective boolean, ' +
        'public_gated_by app.gate_reason)',
    );
  });

  test('ward_status_event_client_mutation_uidx regression — unique, partial, on (ward_status_id, client_mutation_id)', async () => {
    const [row] = await withRole('postgres', null, (tx) =>
      tx.unsafe<{ indexdef: string }[]>(`select indexdef from pg_indexes where indexname = 'ward_status_event_client_mutation_uidx'`),
    );
    expect(row?.indexdef, 'the idempotency index is missing').toBeDefined();
    expect(row?.indexdef).toContain('CREATE UNIQUE INDEX');
    expect(row?.indexdef).toContain('(ward_status_id, client_mutation_id)');
    expect(row?.indexdef).toContain('WHERE (client_mutation_id IS NOT NULL)');
  });
});
