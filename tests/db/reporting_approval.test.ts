import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { sql, withRole } from '../setup/db.js';

/**
 * THE APPROVED REPORTING MODEL: recorded, kept as history, and reconciled against the logins
 * (migration 029; R-2026-09-30-201 GA; ruling FX P2; the design report
 * docs/approved-reporting-model-design-report-2026-10-06.md and the founder's six decisions).
 *
 * What these legs hold:
 *   - public.operator_record_reporting_approval: each refusal by name (the two dates of
 *     decision 4 included), before any CHECK could raise its own; an identical repeat of the
 *     latest approval appends nothing; anything else appends and the earlier row is kept;
 *     the version is the acceptance row's and no argument can change it; one audit row per
 *     append, naming the model and never the title.
 *   - app.facility_reporting_approval is append-only: UPDATE, DELETE and, beyond 010's
 *     pattern, TRUNCATE are refused even to the owner (decision 5), both triggers are
 *     ENABLE ALWAYS, and no client role holds any privilege on the table.
 *   - public.operator_register(): reporting_approval_state reads each of the four states, or
 *     JSON null for a facility with neither an approval nor a login (decision 3), compared
 *     against the LATEST approval only; the keys that were already there keep their values.
 *   - app.provision_begin: a reporting login that contradicts the latest approval, and any
 *     reporting login where none is recorded, is refused REPORTING_MODEL_NOT_APPROVED with a
 *     DETAIL that says which (decision 2), after the "already active" exit and before
 *     REPORTING_MODEL_CONFLICT, which stays as the backstop.
 *
 * Every row here is written inside a rolled-back transaction. The table is append-only, so a
 * committed row could never be deleted by these tests, and migration 029's down refuses
 * while any exists, which would red every earlier migration's round trip.
 *
 * The identity refusals (anon, no session, ward staff, deactivated) for the new function are
 * in tests/db/operator_functions.test.ts's CALLS, beside the others.
 *
 * NOT ASSERTED HERE, deliberately: that the hosted database has the table and its triggers.
 * That is the runbook's "029's apply" readings, and a test that claimed to check it would
 * need a credential this repository declines to hold.
 */

const OP = '0b000000-0000-4000-8000-0000000000a1';
const FAC = '0b000000-0000-4000-8000-0000000000fb';
const EMAIL = 'approval-contact@example.invalid';

interface Refusal {
  code: string | undefined;
  message: string;
  detail: string | undefined;
}
async function refusal(p: Promise<unknown>): Promise<Refusal> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; message: string; detail?: string };
    return { code: x.code, message: x.message, detail: x.detail };
  }
  throw new Error('expected a refusal, and the call succeeded');
}

const claims = (sub: string) => ({ sub, role: 'authenticated', session_id: randomUUID() });
const lit = (v: string | null): string => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);

type Model = 'WARD' | 'FACILITY';

/** An active operator, one facility with one ward, and (by default) its recorded acceptance. */
async function fixture(tx: TransactionSql, o: { agreement: boolean; contact?: boolean } = { agreement: true }): Promise<void> {
  await tx.unsafe(`insert into app.ward_account (id, role) values ('${OP}', 'PLATFORM_ADMIN')`);
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
    values ('${FAC}', 'Approval Facility', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000500', null)`);
  await tx.unsafe(`insert into app.ward_status (facility_id, category, offering) values ('${FAC}', 'ICU_ADULT', 'OFFERED')`);
  if (o.contact === true) {
    await tx.unsafe(`insert into app.facility_contact (facility_id, full_name, job_title, email) values ('${FAC}', 'A Person', 'Matron', '${EMAIL}')`);
  }
  if (o.agreement) {
    await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${FAC}', '2026-09-01', 'v1.0')`);
  }
}

/** A direct owner insert of one approval, for the legs that are about what READS the table. */
const approveRow = (tx: TransactionSql, model: Model, on = '2026-09-15'): Promise<unknown> =>
  tx.unsafe(`
    insert into app.facility_reporting_approval (facility_id, model, approved_on, agreement_version)
    values ('${FAC}', '${model}', '${on}', 'v1.0')`);

const wardLogin = (tx: TransactionSql, active = true): Promise<unknown> =>
  tx.unsafe(`
    insert into app.ward_account (id, facility_id, ward_category, role, is_active, deactivated_at)
    values ('${randomUUID()}', '${FAC}', 'ICU_ADULT', 'WARD_STAFF', ${active}, ${active ? 'null' : 'now()'})`);
const reporterLogin = (tx: TransactionSql): Promise<unknown> =>
  tx.unsafe(`insert into app.ward_account (id, facility_id, ward_category, role) values ('${randomUUID()}', '${FAC}', null, 'FACILITY_REPORTER')`);

interface AsOperator {
  agreement?: boolean;
  /** Runs as the owner, inside the transaction, BEFORE the role switch. */
  extra?: (tx: TransactionSql) => Promise<void>;
}
const asOperator = <T>(fn: (tx: TransactionSql) => Promise<T>, o: AsOperator = {}): Promise<T> =>
  withRole('authenticated', claims(OP), fn, async (tx) => {
    await fixture(tx, { agreement: o.agreement ?? true });
    if (o.extra) await o.extra(tx);
  });

/** Reads as the owner and returns to the operator's role, as the other operator tests do. */
async function owner<T extends object>(tx: TransactionSql, q: string): Promise<T[]> {
  await tx.unsafe('reset role');
  try {
    return await tx.unsafe<T[]>(q);
  } finally {
    await tx.unsafe('set local role authenticated');
  }
}

interface ApproveArgs {
  fac?: string | null;
  model?: string | null;
  on?: string | null;
  role?: string | null;
}
const APPROVE = (o: ApproveArgs = {}): string =>
  `select * from public.operator_record_reporting_approval(${lit(o.fac === undefined ? FAC : o.fac)}, ${lit(o.model === undefined ? 'WARD' : o.model)}, ${
    o.on === null ? 'NULL::date' : `${lit(o.on ?? '2026-09-15')}::date`
  }, ${lit(o.role === undefined ? 'Matron' : o.role)})`;

interface Row {
  model: string;
  approved_on: string;
  agreement_version: string;
  approved_by_role: string | null;
  recorded_session: string | null;
}
const rows = (tx: TransactionSql): Promise<Row[]> =>
  owner<Row>(tx, `select model::text, approved_on::text, agreement_version, approved_by_role, recorded_session::text
                    from app.facility_reporting_approval where facility_id = '${FAC}' order by id`);
const audits = (tx: TransactionSql) =>
  owner<{ old_value: unknown; new_value: unknown }>(tx, `select old_value, new_value from app.audit_log where facility_id = '${FAC}' and action = 'reporting_approval.record' order by id`);

describe('operator_record_reporting_approval', () => {
  test('an active platform admin records the first approval: the version is the acceptance row\'s, and one audit row names the model and no title', async () => {
    const out = await asOperator(async (tx) => {
      const [r] = await tx.unsafe<{ facility_id: string; recorded: boolean }[]>(APPROVE());
      return { r, rows: await rows(tx), audits: await audits(tx) };
    });
    expect(out.r).toEqual({ facility_id: FAC, recorded: true });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ model: 'WARD', approved_on: '2026-09-15', agreement_version: 'v1.0', approved_by_role: 'Matron' });
    expect(out.rows[0]?.recorded_session, 'an operator write carries its session').not.toBeNull();
    expect(out.audits).toEqual([{ old_value: null, new_value: { model: 'WARD' } }]);
    expect(JSON.stringify(out.audits), 'the audit row carries the title').not.toContain('Matron');
  });

  test('no argument can set the agreement version: the function takes exactly four, and none is a version', async () => {
    const [fn] = await sql()<{ args: string }[]>`
      select pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'operator_record_reporting_approval'`;
    expect(fn?.args).toBe('p_facility_id text, p_model text, p_approved_on date, p_approved_by_role text');
  });

  test('an identical repeat of the latest approval appends nothing and returns recorded=false, with no second audit row', async () => {
    const out = await asOperator(async (tx) => {
      await tx.unsafe(APPROVE());
      const [again] = await tx.unsafe<{ recorded: boolean }[]>(APPROVE());
      return { again, rows: await rows(tx), audits: await audits(tx) };
    });
    expect(out.again?.recorded).toBe(false);
    expect(out.rows).toHaveLength(1);
    expect(out.audits).toHaveLength(1);
  });

  test('a changed model appends a second row, and the first row is kept', async () => {
    const out = await asOperator(async (tx) => {
      await tx.unsafe(APPROVE({ model: 'WARD' }));
      const [second] = await tx.unsafe<{ recorded: boolean }[]>(APPROVE({ model: 'FACILITY' }));
      return { second, rows: await rows(tx), audits: await audits(tx) };
    });
    expect(out.second?.recorded).toBe(true);
    expect(out.rows.map((r) => r.model)).toEqual(['WARD', 'FACILITY']);
    expect(out.audits[1]).toEqual({ old_value: { model: 'WARD' }, new_value: { model: 'FACILITY' } });
  });

  test.each<[string, ApproveArgs]>([
    ['a corrected date', { on: '2026-09-16' }],
    ['a corrected title', { role: 'Medical Director' }],
  ])('%s appends, because the table is append-only and a correction has no other path; the earlier row is kept', async (_name, corrected) => {
    const out = await asOperator(async (tx) => {
      await tx.unsafe(APPROVE());
      const [second] = await tx.unsafe<{ recorded: boolean }[]>(APPROVE(corrected));
      return { second, rows: await rows(tx) };
    });
    expect(out.second?.recorded).toBe(true);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({ approved_on: '2026-09-15', approved_by_role: 'Matron' });
  });

  test('a blank title is stored as no title, and a title is trimmed', async () => {
    const out = await asOperator(async (tx) => {
      await tx.unsafe(APPROVE({ role: '   ' }));
      await tx.unsafe(APPROVE({ role: '  Matron  ', on: '2026-09-16' }));
      return rows(tx);
    });
    expect(out.map((r) => r.approved_by_role)).toEqual([null, 'Matron']);
  });

  test('a date equal to the acceptance date is accepted', async () => {
    const out = await asOperator((tx) => tx.unsafe<{ recorded: boolean }[]>(APPROVE({ on: '2026-09-01' })));
    expect(out[0]?.recorded).toBe(true);
  });

  test.each<[string, string, AsOperator, (tx: TransactionSql) => Promise<unknown>]>([
    ['a facility with no agreement', 'AGREEMENT_NOT_RECORDED', { agreement: false }, (tx) => tx.unsafe(APPROVE())],
    [
      'a withdrawn agreement',
      'AGREEMENT_WITHDRAWN',
      { extra: async (tx) => void (await tx.unsafe(`update app.facility_agreement set withdrawn_on = '2026-09-10' where facility_id = '${FAC}'`)) },
      (tx) => tx.unsafe(APPROVE()),
    ],
    ['a date before the acceptance date', 'APPROVAL_BEFORE_AGREEMENT', {}, (tx) => tx.unsafe(APPROVE({ on: '2026-08-31' }))],
    [
      'a date after today by the Lagos calendar',
      'APPROVAL_DATE_IN_FUTURE',
      {},
      async (tx) => {
        const [d] = await owner<{ d: string }>(tx, `select ((now() at time zone 'Africa/Lagos')::date + 1)::text as d`);
        return tx.unsafe(APPROVE({ on: d?.d ?? '' }));
      },
    ],
    ['a facility that does not exist', 'NO_SUCH_FACILITY', {}, (tx) => tx.unsafe(APPROVE({ fac: randomUUID() }))],
  ])('%s is rejected with %s', async (_name, code, opts, call) => {
    const r = await refusal(asOperator(call, opts));
    expect(r.message).toBe(code);
  });

  test.each<[string, ApproveArgs, string]>([
    ['a facility id that is not a uuid', { fac: 'not-a-uuid' }, 'p_facility_id'],
    ['a null facility id', { fac: null }, 'p_facility_id'],
    ['a model that is neither FACILITY nor WARD', { model: 'BOTH' }, 'p_model'],
    ['a null model', { model: null }, 'p_model'],
    ['a null date', { on: null }, 'p_approved_on'],
    ['a title of 65 characters', { role: 'x'.repeat(65) }, 'p_approved_by_role'],
  ])('%s is rejected with INVALID_ARGUMENT naming %s', async (_name, args, param) => {
    const r = await refusal(asOperator((tx) => tx.unsafe(APPROVE(args))));
    expect(r.message).toBe('INVALID_ARGUMENT');
    expect(r.detail).toBe(param);
  });

  test('a title of exactly 64 characters is accepted', async () => {
    const out = await asOperator((tx) => tx.unsafe<{ recorded: boolean }[]>(APPROVE({ role: 'x'.repeat(64) })));
    expect(out[0]?.recorded).toBe(true);
  });
});

describe('app.facility_reporting_approval is append-only, and the owner cannot truncate it either', () => {
  const setup = async (tx: TransactionSql): Promise<void> => {
    await fixture(tx);
    await approveRow(tx, 'WARD');
  };

  test('UPDATE raises APPEND_ONLY_VIOLATION, even as the table owner postgres', async () => {
    await expect(
      withRole('postgres', null, (tx) => tx.unsafe(`update app.facility_reporting_approval set model = 'FACILITY'`), setup),
    ).rejects.toThrow(/APPEND_ONLY_VIOLATION/);
  });

  test('DELETE raises APPEND_ONLY_VIOLATION, even as the table owner postgres', async () => {
    await expect(
      withRole('postgres', null, (tx) => tx.unsafe(`delete from app.facility_reporting_approval`), setup),
    ).rejects.toThrow(/APPEND_ONLY_VIOLATION/);
  });

  test('TRUNCATE raises APPEND_ONLY_VIOLATION, even as the table owner postgres (the statement-level trigger 010 does not have)', async () => {
    await expect(
      withRole('postgres', null, (tx) => tx.unsafe(`truncate app.facility_reporting_approval`), setup),
    ).rejects.toThrow(/APPEND_ONLY_VIOLATION/);
  });

  test('positive control — an INSERT by the owner still works, so the three refusals above are not an always-raising trigger', async () => {
    const n = await withRole('postgres', null, async (tx) => {
      const [c] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.facility_reporting_approval where facility_id = '${FAC}'`);
      return c?.n;
    }, setup);
    expect(n).toBe(1);
  });

  test('both triggers are ENABLE ALWAYS, and each is the shape it claims: row-level UPDATE or DELETE, and statement-level TRUNCATE', async () => {
    const trigs = await sql()<{ tgname: string; tgenabled: string; tgtype: number }[]>`
      select tgname, tgenabled::text, tgtype::int
        from pg_trigger
       where tgrelid = 'app.facility_reporting_approval'::regclass and not tgisinternal
       order by tgname`;
    expect(trigs.map((t) => t.tgname)).toEqual(['trg_facility_reporting_approval_append_only', 'trg_facility_reporting_approval_no_truncate']);
    expect(trigs.map((t) => t.tgenabled), 'a trigger is not ENABLE ALWAYS').toEqual(['A', 'A']);
    const [rowLevel, truncate] = trigs;
    // tgtype bits: 1 row-level, 2 BEFORE, 8 DELETE, 16 UPDATE, 32 TRUNCATE.
    expect((rowLevel?.tgtype ?? 0) & (1 | 2 | 8 | 16), 'the row trigger is not BEFORE UPDATE OR DELETE FOR EACH ROW').toBe(1 | 2 | 8 | 16);
    expect((rowLevel?.tgtype ?? 0) & 32, 'the row trigger also claims TRUNCATE').toBe(0);
    expect((truncate?.tgtype ?? 0) & (2 | 32), 'the truncate trigger is not BEFORE TRUNCATE').toBe(2 | 32);
    expect((truncate?.tgtype ?? 0) & 1, 'the truncate trigger is row-level, which can never see a TRUNCATE').toBe(0);
  });

  test.each(['anon', 'authenticated', 'service_role'])('%s holds no privilege on the table at all', async (role) => {
    const privs = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
    const held: string[] = [];
    for (const p of privs) {
      const [r] = await sql()<{ can: boolean }[]>`select has_table_privilege(${role}, 'app.facility_reporting_approval', ${p}) as can`;
      if (r?.can) held.push(p);
    }
    expect(held).toEqual([]);
  });
});

describe('operator_register(): the approval keys and the four states', () => {
  type Reg = Record<string, unknown>;
  const facilityRow = async (tx: TransactionSql): Promise<Reg> => {
    const [r] = await tx.unsafe<{ r: { facilities: Reg[] } }[]>(`select public.operator_register() as r`);
    const f = r?.r.facilities.find((x) => x['facility_id'] === FAC);
    if (f === undefined) throw new Error('the register does not list the fixture facility');
    return f;
  };

  test('a facility with neither an approval nor a login reads JSON null for all three keys, and reporting_model NONE', async () => {
    const f = await asOperator(facilityRow);
    for (const k of ['approved_model', 'approved_on', 'reporting_approval_state']) {
      expect(k in f, `the register does not carry ${k}`).toBe(true);
      expect(f[k], `${k} is not JSON null`).toBeNull();
    }
    expect(f['reporting_model']).toBe('NONE');
  });

  test.each<[string, (tx: TransactionSql) => Promise<void>, { approved: string | null; state: string; model: string; login: string }]>([
    ['an approval and no login', async (tx) => void (await approveRow(tx, 'WARD')), { approved: 'WARD', state: 'NOT_YET_PROVISIONED', model: 'NONE', login: 'none' }],
    ['a ward login and no approval', async (tx) => void (await wardLogin(tx)), { approved: null, state: 'APPROVAL_NOT_RECORDED', model: 'WARD', login: 'none' }],
    ['a facility login and no approval', async (tx) => void (await reporterLogin(tx)), { approved: null, state: 'APPROVAL_NOT_RECORDED', model: 'FACILITY', login: 'active' }],
    ['a WARD approval and a ward login', async (tx) => { await approveRow(tx, 'WARD'); await wardLogin(tx); }, { approved: 'WARD', state: 'MATCHES', model: 'WARD', login: 'none' }],
    ['a FACILITY approval and a facility login', async (tx) => { await approveRow(tx, 'FACILITY'); await reporterLogin(tx); }, { approved: 'FACILITY', state: 'MATCHES', model: 'FACILITY', login: 'active' }],
    ['a FACILITY approval and a ward login', async (tx) => { await approveRow(tx, 'FACILITY'); await wardLogin(tx); }, { approved: 'FACILITY', state: 'MISMATCH', model: 'WARD', login: 'none' }],
    ['a WARD approval and a facility login', async (tx) => { await approveRow(tx, 'WARD'); await reporterLogin(tx); }, { approved: 'WARD', state: 'MISMATCH', model: 'FACILITY', login: 'active' }],
    ['a WARD approval and a DEACTIVATED ward login', async (tx) => { await approveRow(tx, 'WARD'); await wardLogin(tx, false); }, { approved: 'WARD', state: 'NOT_YET_PROVISIONED', model: 'NONE', login: 'none' }],
    [
      'a FACILITY approval and an open facility-login invite that no one has accepted',
      async (tx) => {
        await approveRow(tx, 'FACILITY');
        await tx.unsafe(`insert into app.invite (facility_id, ward_category, role) values ('${FAC}', null, 'FACILITY_REPORTER')`);
      },
      { approved: 'FACILITY', state: 'NOT_YET_PROVISIONED', model: 'NONE', login: 'setup incomplete' },
    ],
  ])('%s reads the state the table says', async (_name, extra, want) => {
    const f = await asOperator(facilityRow, { extra });
    expect(f['approved_model']).toBe(want.approved);
    expect(f['reporting_approval_state']).toBe(want.state);
    // The keys that were there before 029 keep their values.
    expect(f['reporting_model']).toBe(want.model);
    expect(f['reporter_login']).toBe(want.login);
  });

  test('only the LATEST approval is compared: a second approval flips MATCHES to MISMATCH, and a third flips it back', async () => {
    const states = await asOperator(
      async (tx) => {
        const seen: unknown[] = [];
        seen.push((await facilityRow(tx))['reporting_approval_state']);
        await tx.unsafe(APPROVE({ model: 'FACILITY' }));
        seen.push((await facilityRow(tx))['reporting_approval_state']);
        await tx.unsafe(APPROVE({ model: 'WARD', on: '2026-09-17' }));
        seen.push((await facilityRow(tx))['reporting_approval_state']);
        return seen;
      },
      { extra: async (tx) => { await approveRow(tx, 'WARD'); await wardLogin(tx); } },
    );
    expect(states).toEqual(['MATCHES', 'MISMATCH', 'MATCHES']);
  });

  test('approved_on is the date of the latest approval, as a date', async () => {
    const f = await asOperator(async (tx) => {
      await tx.unsafe(APPROVE({ on: '2026-09-15' }));
      await tx.unsafe(APPROVE({ on: '2026-09-17', model: 'FACILITY' }));
      return facilityRow(tx);
    });
    expect(f['approved_on']).toBe('2026-09-17');
    expect(f['approved_model']).toBe('FACILITY');
  });

  test('a withdrawn facility is still returned with its computed state, and agreement_state reads withdrawn', async () => {
    const f = await asOperator(facilityRow, {
      extra: async (tx) => {
        await approveRow(tx, 'WARD');
        await wardLogin(tx);
        await tx.unsafe(`update app.facility_agreement set withdrawn_on = '2026-09-10' where facility_id = '${FAC}'`);
      },
    });
    expect(f['agreement_state']).toBe('withdrawn');
    expect(f['reporting_approval_state'], 'a withdrawn facility with an active login must not be blanked').toBe('MATCHES');
  });
});

describe('app.provision_begin: the approval gate', () => {
  type Begin = { status: string; invite_id: string | null };
  const gateFixture = (approvals: Model[]) => async (tx: TransactionSql): Promise<void> => {
    await fixture(tx, { agreement: true, contact: true });
    for (const [i, m] of approvals.entries()) await approveRow(tx, m, `2026-09-${String(15 + i).padStart(2, '0')}`);
  };
  const begin = async (tx: TransactionSql, role: 'WARD_STAFF' | 'FACILITY_REPORTER' | 'FACILITY_ADMIN'): Promise<Begin> => {
    const cat = role === 'WARD_STAFF' ? "'ICU_ADULT'" : 'NULL';
    const [r] = await tx.unsafe<Begin[]>(`select * from app.provision_begin('${FAC}', ${cat}, '${role}')`);
    if (r === undefined) throw new Error('provision_begin returned no row');
    return r;
  };
  const invites = async (tx: TransactionSql): Promise<number> => {
    const [n] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.invite where facility_id = '${FAC}'`);
    return n?.n ?? -1;
  };

  test.each<[string, 'WARD_STAFF' | 'FACILITY_REPORTER', Model[], string]>([
    ['a ward login where no approval is recorded', 'WARD_STAFF', [], 'no reporting model is approved for this facility'],
    ['a facility login where no approval is recorded', 'FACILITY_REPORTER', [], 'no reporting model is approved for this facility'],
    ['a ward login where the latest approval is FACILITY', 'WARD_STAFF', ['FACILITY'], 'the latest approval is FACILITY reporting, and this login is a ward login'],
    ['a facility login where the latest approval is WARD', 'FACILITY_REPORTER', ['WARD'], 'the latest approval is WARD reporting, and this login is a facility-level login'],
  ])('%s is rejected with REPORTING_MODEL_NOT_APPROVED, with a DETAIL that says which, and opens no invite', async (_name, role, approvals, detail) => {
    await withRole('postgres', null, async (tx) => {
      const r = await refusal(tx.savepoint((sp) => begin(sp, role)));
      expect(r.message).toBe('REPORTING_MODEL_NOT_APPROVED');
      expect(r.detail).toBe(detail);
      expect(await invites(tx), 'an invite opened despite the refusal').toBe(0);
    }, gateFixture(approvals));
  });

  test.each<['WARD_STAFF' | 'FACILITY_REPORTER', Model]>([
    ['WARD_STAFF', 'WARD'],
    ['FACILITY_REPORTER', 'FACILITY'],
  ])('a %s login that agrees with the latest approval (%s) opens an invite', async (role, model) => {
    const b = await withRole('postgres', null, (tx) => begin(tx, role), gateFixture([model]));
    expect(b.status).toBe('open');
  });

  test('the gate reads the LATEST approval, not the first: after WARD then FACILITY, a facility login opens and a ward login is refused', async () => {
    await withRole('postgres', null, async (tx) => {
      expect((await begin(tx, 'FACILITY_REPORTER')).status).toBe('open');
      const r = await refusal(tx.savepoint((sp) => begin(sp, 'WARD_STAFF')));
      expect(r.message).toBe('REPORTING_MODEL_NOT_APPROVED');
    }, gateFixture(['WARD', 'FACILITY']));
  });

  test('J4 — an already-active login returns complete without consulting any approval, for a ward and for a facility login', async () => {
    await withRole('postgres', null, async (tx) => {
      await wardLogin(tx);
      expect(await begin(tx, 'WARD_STAFF')).toEqual({ status: 'complete', invite_id: null });
    }, gateFixture([]));
    await withRole('postgres', null, async (tx) => {
      await reporterLogin(tx);
      expect(await begin(tx, 'FACILITY_REPORTER')).toEqual({ status: 'complete', invite_id: null });
    }, gateFixture([]));
  });

  test('the model switch, in order: approve, deactivate, provision — and each wrong order is refused with its own code', async () => {
    await withRole('postgres', null, async (tx) => {
      // The facility reports per ward, approved so. Management then approves a facility login.
      await wardLogin(tx);
      await approveRow(tx, 'FACILITY', '2026-09-20');
      // Approved, but the ward logins are still active: the conflict is what refuses.
      const stillActive = await refusal(tx.savepoint((sp) => begin(sp, 'FACILITY_REPORTER')));
      expect(stillActive.message).toBe('REPORTING_MODEL_CONFLICT');
      // Deactivated: the facility login now opens.
      await tx.unsafe(`update app.ward_account set is_active = false, deactivated_at = now() where facility_id = '${FAC}' and role = 'WARD_STAFF'`);
      expect((await begin(tx, 'FACILITY_REPORTER')).status).toBe('open');
    }, gateFixture(['WARD']));

    // The other wrong order: the ward logins are deactivated first, but nothing was approved.
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`update app.ward_account set is_active = false, deactivated_at = now() where facility_id = '${FAC}' and role = 'WARD_STAFF'`);
      const r = await refusal(tx.savepoint((sp) => begin(sp, 'FACILITY_REPORTER')));
      expect(r.message).toBe('REPORTING_MODEL_NOT_APPROVED');
    }, async (tx) => {
      await gateFixture(['WARD'])(tx);
      await wardLogin(tx);
    });
  });

  test('the approval gate sits BEFORE the conflict check: a contradicting login at a facility whose other kind is active reads the approval refusal', async () => {
    await withRole('postgres', null, async (tx) => {
      await reporterLogin(tx);
      const r = await refusal(tx.savepoint((sp) => begin(sp, 'WARD_STAFF')));
      expect(r.message).toBe('REPORTING_MODEL_NOT_APPROVED');
    }, gateFixture(['FACILITY']));
  });

  test('REPORTING_MODEL_CONFLICT is still the backstop: the trigger refuses a second kind of active login written directly, whatever the approval says', async () => {
    await withRole('postgres', null, async (tx) => {
      await wardLogin(tx);
      const r = await refusal(tx.savepoint((sp) => reporterLogin(sp)));
      expect(r.message).toBe('REPORTING_MODEL_CONFLICT');
    }, gateFixture(['FACILITY']));
  });

  test.each<[string, Model[]]>([
    ['no approval', []],
    ['an approval', ['WARD']],
  ])('FACILITY_ADMIN is still refused ROLE_NOT_PROVISIONED_IN_V1 with %s: the role branch is not touched', async (_name, approvals) => {
    const r = await refusal(withRole('postgres', null, (tx) => begin(tx, 'FACILITY_ADMIN'), gateFixture(approvals)));
    expect(r.message).toBe('ROLE_NOT_PROVISIONED_IN_V1');
  });
});
