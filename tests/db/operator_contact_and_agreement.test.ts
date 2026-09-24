import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * THE CONTACT AND THE AGREEMENT ARE TWO FACTS, WRITTEN BY TWO FUNCTIONS (migration 021;
 * R-2026-09-24-75/76, issued as BC-5 and BD-1).
 *
 * app.facility_contact is a named person's personal data, erasable on request (003).
 * The facility's acceptance of the data-sharing agreement is the basis for processing
 * its wards' data, and must survive any one person's erasure. So it lives in
 * app.facility_agreement, and deleting a contact never touches it.
 *
 * What these legs hold:
 *   - operator_record_contact: each refusal by name, before 003's CHECKs could raise
 *     their own; an identical repeat returns with no write and no audit row; the
 *     contact's OWN version (never facility.version, which would re-project the
 *     public mirrors for a change no visitor sees); a changed email or mobile clears
 *     unreachable_since (BD-2 3); the audit row names fields, never values.
 *   - operator_record_agreement: a future date (by the Africa/Lagos calendar) and a
 *     version that is not a short label are refused; a different agreement is never
 *     overwritten (AGREEMENT_ALREADY_RECORDED); an identical repeat returns.
 *   - the gates read the two tables: listing, and app.provision_begin, need a contact
 *     AND an agreement that is not withdrawn. Each missing half is refused by name.
 *   - operator_register (020's list, restated as an envelope under a new name, since a
 *     return type cannot change in place) carries the database's now(), so the admin
 *     app never computes freshness against the operator's device clock (BC-5 c). Its
 *     agreement_state is none, recorded or withdrawn, never a yes/no that reads a
 *     withdrawal as "no agreement" (BI-1).
 *   - operator_get_contact returns both parts, and nothing to a non-operator.
 *
 * The identity refusals (anon, no session, ward staff, deactivated) for the three new
 * functions are in tests/db/operator_functions.test.ts's CALLS, beside the others.
 *
 * NOT ASSERTED HERE, deliberately: that the envelope carries server_now when there is
 * no facility at all, the day-one case that made it an envelope rather than a
 * per-row column. The seed's facilities carry app.ward_status_event rows, which the
 * append-only trigger (010) forbids deleting even inside a rolled-back transaction, so
 * no leg here can reach an empty app.facility. The body builds server_now outside the
 * facility aggregate; migration 021 states it, and the legs below read it with rows.
 */

const OP = '0b000000-0000-4000-8000-000000000001';
const FAC = '0b000000-0000-4000-8000-0000000000fa';
const EMAIL = 'matron-role@example.invalid';
const MOBILE = '+2348000000401';

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

const claims = (sub: string): Record<string, unknown> => ({ sub, role: 'authenticated', session_id: randomUUID() });

/** An active operator and one unlisted facility with one ward, and nothing else. */
async function fixture(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`insert into app.ward_account (id, role) values ('${OP}', 'PLATFORM_ADMIN')`);
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
    values ('${FAC}', 'Agreement Facility', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000400', null)`);
  await tx.unsafe(`insert into app.ward_status (facility_id, category, offering) values ('${FAC}', 'ICU_ADULT', 'OFFERED')`);
}

const asOperator = <T>(fn: (tx: TransactionSql) => Promise<T>, extra?: (tx: TransactionSql) => Promise<void>): Promise<T> =>
  withRole('authenticated', claims(OP), fn, async (tx) => {
    await fixture(tx);
    if (extra) await extra(tx);
  });

const lit = (v: string | null): string => (v === null ? 'null' : `'${v}'`);

const CONTACT = (o: { email?: string | null; mobile?: string | null; sms?: boolean; version?: number | null; name?: string } = {}): string =>
  `select * from public.operator_record_contact('${FAC}', '${o.name ?? 'Adaeze Example'}', 'Matron', ${lit(o.email === undefined ? EMAIL : o.email)}, ` +
  `${lit(o.mobile === undefined ? null : o.mobile)}, ${o.sms ?? false}, ${o.version === undefined || o.version === null ? 'null' : o.version})`;

const AGREEMENT = (o: { on?: string; version?: string; role?: string | null } = {}): string =>
  `select * from public.operator_record_agreement('${FAC}', '${o.on ?? '2026-09-01'}', '${o.version ?? 'v1.0'}', ${lit(o.role === undefined ? 'CMD' : o.role)})`;

/** A read of an app table, as the owner (authenticated holds no USAGE on app), then back to the caller's role. */
async function owner<T extends readonly unknown[]>(tx: TransactionSql, q: string): Promise<T> {
  await tx.unsafe('reset role');
  const rows = (await tx.unsafe(q)) as unknown as T;
  await tx.unsafe('set local role authenticated');
  return rows;
}

async function audits(tx: TransactionSql, action: string): Promise<{ old_value: unknown; new_value: unknown }[]> {
  await tx.unsafe('reset role');
  return tx.unsafe(`select old_value, new_value from app.audit_log where facility_id = '${FAC}' and action = '${action}' order by id`);
}

describe('operator_record_contact', () => {
  test('an active platform admin records a contact, at contact version 1, with one audit row naming fields and no values', async () => {
    const out = await asOperator(async (tx) => {
      const [r] = await tx.unsafe<{ facility_id: string; contact_version: number }[]>(CONTACT());
      return { r, a: await audits(tx, 'facility_contact.record') };
    });
    expect(out.r).toEqual({ facility_id: FAC, contact_version: 1 });
    expect(out.a).toHaveLength(1);
    const text = JSON.stringify(out.a);
    expect(text).toContain('full_name');
    expect(text, 'a contact VALUE reached the audit log').not.toContain(EMAIL);
    expect(text).not.toContain('Adaeze');
    expect(text).not.toContain('Matron');
  });

  test('J2 — an identical repeat returns the current version with no write and no second audit row', async () => {
    const out = await asOperator(async (tx) => {
      await tx.unsafe(CONTACT());
      const [again] = await tx.unsafe<{ contact_version: number }[]>(CONTACT({ version: null }));
      return { again, a: await audits(tx, 'facility_contact.record') };
    });
    expect(out.again?.contact_version).toBe(1);
    expect(out.a).toHaveLength(1);
  });

  test('an edit at the current version bumps the CONTACT version and leaves facility.version and the facility row untouched', async () => {
    const out = await asOperator(async (tx) => {
      await tx.unsafe(CONTACT());
      const [before] = await owner<{ version: number; updated_at: Date }[]>(tx, `select version, updated_at from app.facility where id = '${FAC}'`);
      const [r] = await tx.unsafe<{ contact_version: number }[]>(CONTACT({ name: 'Adaeze Renamed', version: 1 }));
      const [after] = await owner<{ version: number; updated_at: Date }[]>(tx, `select version, updated_at from app.facility where id = '${FAC}'`);
      return { r, before, after };
    });
    expect(out.r?.contact_version).toBe(2);
    expect(out.after, 'a contact write touched app.facility, which re-projects the public mirrors').toEqual(out.before);
  });

  test('a stale edit is refused VERSION_CONFLICT, naming the current version', async () => {
    const r = await refusal(asOperator(async (tx) => {
      await tx.unsafe(CONTACT());
      await tx.unsafe(CONTACT({ name: 'First Edit', version: 1 }));
      await tx.unsafe(CONTACT({ name: 'Second Edit', version: 1 }));
    }));
    expect(r.message).toBe('VERSION_CONFLICT');
    expect(r.detail).toBe('current_version=2');
  });

  test('an edit with no expected version, over an existing different contact, is refused VERSION_CONFLICT', async () => {
    const r = await refusal(asOperator(async (tx) => {
      await tx.unsafe(CONTACT());
      await tx.unsafe(CONTACT({ name: 'Someone Else', version: null }));
    }));
    expect(r.message).toBe('VERSION_CONFLICT');
    expect(r.detail).toBe('current_version=1');
  });

  test.each<[string, Parameters<typeof CONTACT>[0], string]>([
    ['no email and no mobile', { email: null, mobile: null }, 'NO_CONTACT_CHANNEL'],
    ['a mobile that is not E.164', { mobile: '08000000401', sms: true }, 'MOBILE_NOT_E164'],
    ['a mobile without SMS opt-in', { mobile: MOBILE, sms: false }, 'MOBILE_REQUIRES_SMS_OPT_IN'],
  ])('%s is refused %s, by name, before any CHECK raises', async (_name, o, code) => {
    const r = await refusal(asOperator((tx) => tx.unsafe(CONTACT(o))));
    expect(r.message).toBe(code);
  });

  test('a facility that does not exist is refused NO_SUCH_FACILITY', async () => {
    const r = await refusal(asOperator((tx) => tx.unsafe(CONTACT().replace(FAC, randomUUID()))));
    expect(r.message).toBe('NO_SUCH_FACILITY');
  });

  test('SMS opt-in: true keeps the first opt-in time across edits, false clears it', async () => {
    const out = await asOperator(async (tx) => {
      await tx.unsafe(CONTACT({ mobile: MOBILE, sms: true }));
      const [first] = await owner<{ t: Date }[]>(tx, `select sms_opt_in_at as t from app.facility_contact where facility_id = '${FAC}'`);
      await tx.unsafe(CONTACT({ mobile: MOBILE, sms: true, name: 'Renamed', version: 1 }));
      const [kept] = await owner<{ t: Date }[]>(tx, `select sms_opt_in_at as t from app.facility_contact where facility_id = '${FAC}'`);
      await tx.unsafe(CONTACT({ mobile: null, sms: false, name: 'Renamed', version: 2 }));
      const [cleared] = await owner<{ t: Date | null }[]>(tx, `select sms_opt_in_at as t from app.facility_contact where facility_id = '${FAC}'`);
      return { first: first?.t, kept: kept?.t, cleared: cleared?.t };
    });
    expect(out.first).toBeInstanceOf(Date);
    expect(out.kept).toEqual(out.first);
    expect(out.cleared).toBeNull();
  });

  test('BD-2 3 — a changed email clears unreachable_since, and a name-only edit does not', async () => {
    const out = await asOperator(async (tx) => {
      await tx.unsafe(CONTACT());
      await tx.unsafe('reset role');
      await tx.unsafe(`update app.facility_contact set unreachable_since = now() where facility_id = '${FAC}'`);
      await tx.unsafe(`set local role authenticated`);
      // The bounce write is itself an UPDATE, so it bumped the contact to version 2.
      await tx.unsafe(CONTACT({ name: 'Name Only', version: 2 }));
      const [kept] = await owner<{ u: Date | null }[]>(tx, `select unreachable_since as u from app.facility_contact where facility_id = '${FAC}'`);
      await tx.unsafe(CONTACT({ name: 'Name Only', email: 'new-role@example.invalid', version: 3 }));
      const [cleared] = await owner<{ u: Date | null }[]>(tx, `select unreachable_since as u from app.facility_contact where facility_id = '${FAC}'`);
      return { kept: kept?.u, cleared: cleared?.u };
    });
    expect(out.kept).toBeInstanceOf(Date);
    expect(out.cleared).toBeNull();
  });
});

describe('operator_record_agreement', () => {
  test('an active platform admin records the agreement, with one audit row naming fields and no values', async () => {
    const out = await asOperator(async (tx) => {
      const [r] = await tx.unsafe<{ facility_id: string; recorded: boolean }[]>(AGREEMENT());
      const a = await audits(tx, 'facility_agreement.record');
      const [row] = await tx.unsafe<{ accepted_on: string; version: string; signatory_role: string; recorded_session: string | null }[]>(
        `select accepted_on::text, version, signatory_role, recorded_session::text from app.facility_agreement where facility_id = '${FAC}'`);
      return { r, a, row };
    });
    expect(out.r).toEqual({ facility_id: FAC, recorded: true });
    expect(out.row).toMatchObject({ accepted_on: '2026-09-01', version: 'v1.0', signatory_role: 'CMD' });
    expect(out.row?.recorded_session, 'an operator write carries its session').not.toBeNull();
    expect(out.a).toHaveLength(1);
    expect(JSON.stringify(out.a)).not.toContain('v1.0');
  });

  test('J2 — an identical repeat returns without writing', async () => {
    const out = await asOperator(async (tx) => {
      await tx.unsafe(AGREEMENT());
      const [again] = await tx.unsafe<{ recorded: boolean }[]>(AGREEMENT());
      return { again, a: await audits(tx, 'facility_agreement.record') };
    });
    expect(out.again?.recorded).toBe(false);
    expect(out.a).toHaveLength(1);
  });

  test.each<[string, Parameters<typeof AGREEMENT>[0]]>([
    ['another version', { version: 'v2.0' }],
    ['another date', { on: '2026-09-02' }],
    ['another signatory role', { role: 'Matron' }],
  ])('a different agreement (%s) is never overwritten — AGREEMENT_ALREADY_RECORDED', async (_name, o) => {
    const r = await refusal(asOperator(async (tx) => {
      await tx.unsafe(AGREEMENT());
      await tx.unsafe(AGREEMENT(o));
    }));
    expect(r.message).toBe('AGREEMENT_ALREADY_RECORDED');
  });

  test('a withdrawn agreement is not replaced through the function either — AGREEMENT_ALREADY_RECORDED', async () => {
    const r = await refusal(asOperator(async (tx) => {
      await tx.unsafe(AGREEMENT());
      await tx.unsafe('reset role');
      await tx.unsafe(`update app.facility_agreement set withdrawn_on = '2026-09-10' where facility_id = '${FAC}'`);
      await tx.unsafe('set local role authenticated');
      await tx.unsafe(AGREEMENT({ version: 'v2.0' }));
    }));
    expect(r.message).toBe('AGREEMENT_ALREADY_RECORDED');
  });

  test('a date after today in Africa/Lagos is refused AGREEMENT_DATE_IN_FUTURE, and today is accepted', async () => {
    const r = await refusal(asOperator(async (tx) => {
      const [t] = await tx.unsafe<{ d: string }[]>(`select ((now() at time zone 'Africa/Lagos')::date + 1)::text as d`);
      await tx.unsafe(AGREEMENT({ on: t!.d }));
    }));
    expect(r.message).toBe('AGREEMENT_DATE_IN_FUTURE');
    const ok = await asOperator(async (tx) => {
      const [t] = await tx.unsafe<{ d: string }[]>(`select (now() at time zone 'Africa/Lagos')::date::text as d`);
      const [x] = await tx.unsafe<{ recorded: boolean }[]>(AGREEMENT({ on: t!.d }));
      return x?.recorded;
    });
    expect(ok).toBe(true);
  });

  test.each(['', 'v 1', 'version one', '-v1', 'a'.repeat(33)])('a version that is not a short label (%j) is refused AGREEMENT_VERSION_NOT_A_LABEL', async (v) => {
    const r = await refusal(asOperator((tx) => tx.unsafe(AGREEMENT({ version: v }))));
    expect(r.message).toBe('AGREEMENT_VERSION_NOT_A_LABEL');
  });

  test('the table itself refuses a version that is not a label, whoever writes it', async () => {
    const r = await refusal(withRole('postgres', null, async (tx) => {
      await fixture(tx);
      await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${FAC}', '2026-09-01', 'not a label')`);
    }));
    expect(r.message).toMatch(/facility_agreement_version_is_a_label/);
  });
});

describe('the gates read the two tables — a contact AND an agreement that is not withdrawn', () => {
  const LIST = `select * from public.operator_set_facility_listed('${FAC}', 1)`;
  const BEGIN = `select * from app.provision_begin('${FAC}', 'ICU_ADULT', 'WARD_STAFF')`;

  test('listing: an agreement but no contact is refused NO_FACILITY_CONTACT', async () => {
    const r = await refusal(asOperator(async (tx) => { await tx.unsafe(AGREEMENT()); await tx.unsafe(LIST); }));
    expect(r.message).toBe('NO_FACILITY_CONTACT');
  });

  test('listing: a contact but no agreement is refused AGREEMENT_NOT_RECORDED', async () => {
    const r = await refusal(asOperator(async (tx) => { await tx.unsafe(CONTACT()); await tx.unsafe(LIST); }));
    expect(r.message).toBe('AGREEMENT_NOT_RECORDED');
  });

  test('listing: a withdrawn agreement is refused AGREEMENT_WITHDRAWN', async () => {
    const r = await refusal(asOperator(async (tx) => {
      await tx.unsafe(CONTACT());
      await tx.unsafe(AGREEMENT());
      await tx.unsafe('reset role');
      await tx.unsafe(`update app.facility_agreement set withdrawn_on = '2026-09-10' where facility_id = '${FAC}'`);
      await tx.unsafe('set local role authenticated');
      await tx.unsafe(LIST);
    }));
    expect(r.message).toBe('AGREEMENT_WITHDRAWN');
  });

  test('listing: a contact and an agreement lists the facility', async () => {
    const out = await asOperator(async (tx) => {
      await tx.unsafe(CONTACT());
      await tx.unsafe(AGREEMENT());
      const [r] = await tx.unsafe<{ listed_at: Date | null }[]>(LIST);
      return r?.listed_at;
    });
    expect(out).toBeInstanceOf(Date);
  });

  test.each<[string, string, string[]]>([
    ['an agreement but no contact', 'NO_FACILITY_CONTACT', ['agreement']],
    ['a contact but no agreement', 'AGREEMENT_NOT_RECORDED', ['contact']],
    ['a withdrawn agreement', 'AGREEMENT_WITHDRAWN', ['contact', 'agreement', 'withdraw']],
  ])('provision_begin: %s is refused %s', async (_name, code, steps) => {
    const r = await refusal(withRole('postgres', null, async (tx) => {
      await fixture(tx);
      if (steps.includes('contact')) await tx.unsafe(`insert into app.facility_contact (facility_id, full_name, job_title, email) values ('${FAC}', 'A', 'Matron', '${EMAIL}')`);
      if (steps.includes('agreement')) await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${FAC}', '2026-09-01', 'v1.0')`);
      if (steps.includes('withdraw')) await tx.unsafe(`update app.facility_agreement set withdrawn_on = '2026-09-10' where facility_id = '${FAC}'`);
      await tx.unsafe(BEGIN);
    }));
    expect(r.message).toBe(code);
  });

  test('provision_begin: a contact and an agreement opens an invite', async () => {
    const out = await withRole('postgres', null, async (tx) => {
      await fixture(tx);
      await tx.unsafe(`insert into app.facility_contact (facility_id, full_name, job_title, email) values ('${FAC}', 'A', 'Matron', '${EMAIL}')`);
      await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${FAC}', '2026-09-01', 'v1.0')`);
      const [r] = await tx.unsafe<{ status: string }[]>(BEGIN);
      return r?.status;
    });
    expect(out).toBe('open');
  });

  test('erasing the contact leaves the agreement, and the facility reads no contact and an agreement (BD-2 5)', async () => {
    const out = await asOperator(async (tx) => {
      await tx.unsafe(CONTACT());
      await tx.unsafe(AGREEMENT());
      await tx.unsafe('reset role');
      await tx.unsafe(`delete from app.facility_contact where facility_id = '${FAC}'`);
      const [n] = await owner<{ n: number }[]>(tx, `select count(*)::int as n from app.facility_agreement where facility_id = '${FAC}'`);
      await tx.unsafe('set local role authenticated');
      const [env] = await tx.unsafe<{ l: { facilities: { facility_id: string; has_contact: boolean; agreement_state: string }[] } }[]>(
        'select public.operator_register() as l');
      return { n: n?.n, mine: env?.l.facilities.find((f) => f.facility_id === FAC) };
    });
    expect(out.n).toBe(1);
    expect(out.mine).toMatchObject({ has_contact: false, agreement_state: 'recorded' });
  });
});

describe('operator_register is an envelope carrying the database clock (BC-5 c)', () => {
  test("server_now is the database's now(), and the facilities are inside the envelope", async () => {
    const out = await asOperator(async (tx) => {
      const [env] = await tx.unsafe<{ l: { server_now: string; facilities: { facility_id: string }[] } }[]>('select public.operator_register() as l');
      const [now] = await tx.unsafe<{ t: Date }[]>('select now() as t');
      return { env: env?.l, now: now?.t };
    });
    expect(Date.parse(out.env!.server_now)).toBe(out.now!.getTime());
    expect(out.env!.facilities.some((f) => f.facility_id === FAC)).toBe(true);
  });
});

/**
 * THREE STATES, NOT A YES/NO (R-2026-09-24-81 BI-1). A yes/no read a withdrawn agreement
 * as "no agreement", so the operator recorded one and was refused
 * AGREEMENT_ALREADY_RECORDED -- a dead end that also hid the withdrawal. "Withdrawn" is
 * withdrawn_on IS NOT NULL, the same test the two gates refuse AGREEMENT_WITHDRAWN on.
 *
 * The withdrawal is the owner's UPDATE, which is what the founder's withdrawal step will
 * run (BD-2 2, in 3.4b-app). No function withdraws an agreement.
 */
describe("operator_register's agreement_state — none, recorded or withdrawn (BI-1)", () => {
  type Reg = { l: { facilities: Record<string, unknown>[] } };
  const WITHDRAW = `update app.facility_agreement set withdrawn_on = '2026-09-10' where facility_id = '${FAC}'`;
  async function mine(tx: TransactionSql): Promise<Record<string, unknown> | undefined> {
    const [env] = await tx.unsafe<Reg[]>('select public.operator_register() as l');
    return env?.l.facilities.find((f) => f.facility_id === FAC);
  }

  test.each<[string, string, string[]]>([
    ['no agreement', 'none', []],
    ['an agreement recorded', 'recorded', ['agreement']],
    ['an agreement recorded and then withdrawn', 'withdrawn', ['agreement', 'withdraw']],
  ])('operator reads %s as agreement_state %s, and no agreement_recorded key', async (_name, state, steps) => {
    const out = await asOperator(async (tx) => {
      if (steps.includes('agreement')) await tx.unsafe(AGREEMENT());
      if (steps.includes('withdraw')) {
        await tx.unsafe('reset role');
        await tx.unsafe(WITHDRAW);
        await tx.unsafe('set local role authenticated');
      }
      return mine(tx);
    });
    expect(out, 'the facility is missing from the register').toBeDefined();
    expect(out?.agreement_state).toBe(state);
    expect(out, 'the yes/no field that hid a withdrawal is still returned').not.toHaveProperty('agreement_recorded');
  });

  test('a listed facility whose agreement is then withdrawn reads withdrawn, still listed, and recording again is refused by name', async () => {
    const out = await asOperator(async (tx) => {
      await tx.unsafe(CONTACT());
      await tx.unsafe(AGREEMENT());
      await tx.unsafe(`select * from public.operator_set_facility_listed('${FAC}', 1)`);
      await tx.unsafe('reset role');
      await tx.unsafe(WITHDRAW);
      await tx.unsafe('set local role authenticated');
      const reg = await mine(tx);
      const again = await refusal(tx.savepoint((sp) => sp.unsafe(AGREEMENT({ version: 'v2.0' }))));
      return { reg, again };
    });
    expect(out.reg?.agreement_state).toBe('withdrawn');
    expect(out.reg?.listed_at, 'the withdrawal unlisted the facility, which nothing here does').not.toBeNull();
    expect(out.again.message).toBe('AGREEMENT_ALREADY_RECORDED');
  });
});

describe('operator_get_contact', () => {
  test('returns the contact and the agreement, each with its own fields', async () => {
    const out = await asOperator(async (tx) => {
      await tx.unsafe(CONTACT({ mobile: MOBILE, sms: true }));
      await tx.unsafe(AGREEMENT());
      const [r] = await tx.unsafe<{ c: Record<string, Record<string, unknown> | null> }[]>(`select public.operator_get_contact('${FAC}') as c`);
      return r?.c;
    });
    expect(out?.contact).toMatchObject({ full_name: 'Adaeze Example', job_title: 'Matron', email: EMAIL, mobile_e164: MOBILE, sms_opt_in: true, version: 1 });
    expect(out?.agreement).toMatchObject({ accepted_on: '2026-09-01', version: 'v1.0', signatory_role: 'CMD', withdrawn_on: null });
  });

  test('a facility with neither returns both as null, not a refusal', async () => {
    const out = await asOperator(async (tx) => {
      const [r] = await tx.unsafe<{ c: unknown }[]>(`select public.operator_get_contact('${FAC}') as c`);
      return r?.c;
    });
    expect(out).toEqual({ contact: null, agreement: null });
  });
});
