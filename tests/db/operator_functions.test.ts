import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * THE OPERATOR FUNCTIONS OF MIGRATION 020 (R-2026-09-23-71; kickoff AJ D1-D3, D7, D8, D10).
 *
 * Identity comes from `auth.uid()` in the database, joined to app.ward_account, and
 * requires `role = 'PLATFORM_ADMIN' AND is_active` (app.assert_operator()). It is
 * never an argument and never a Function's word. Each function is refused by name
 * for every other caller, and each write leaves one audit row in its own transaction.
 *
 * THE STAFF-ENGINEER FINDINGS, each with the double call that would have shown it:
 *   - J1: the stale-edit check is an integer row version, not `updated_at`, which a
 *     JS Date round trip truncates to milliseconds;
 *   - J2: create is idempotent on a client-generated id, and add-category on
 *     (facility, category). A repeat returns the existing row and never surfaces
 *     23505. The same id with different fields is refused.
 *
 * -69 (a): add-category requires an explicit offering, with no default, and leaves
 * the ward PENDING. No operator path leaves PENDING, so
 * tests/compliance/public_labels.test.ts still names publish_ward_status as the
 * only writer of ACTIVE.
 *
 * NOT ASSERTED HERE: what a real GoTrue session gets. That is
 * tests/db/platform_admin_session_live.test.ts, over HTTP. These legs fake the
 * claims inside a rolled-back transaction, which is what lets every refusal run
 * against a fixture no caller could otherwise create.
 */

const OP = '0a000000-0000-4000-8000-000000000001';
const WARD = '0a000000-0000-4000-8000-000000000002';
const FAC = '0a000000-0000-4000-8000-0000000000fa';
const CONTACT_EMAIL = 'onboarding-contact@example.invalid';

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

/** An active operator, a ward account at another facility, and nothing else. */
async function accounts(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`insert into app.ward_account (id, role) values ('${OP}', 'PLATFORM_ADMIN')`);
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
    values ('${FAC}', 'Existing Facility', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000301', now())`);
  await tx.unsafe(`insert into app.ward_status (facility_id, category, offering) values ('${FAC}', 'ICU_ADULT', 'OFFERED')`);
  await tx.unsafe(`insert into app.ward_account (id, facility_id, ward_category, role) values ('${WARD}', '${FAC}', 'ICU_ADULT', 'WARD_STAFF')`);
}

const CREATE = (id: string, name = 'New Facility'): string =>
  `select * from public.operator_create_facility('${id}', '${name}', 'Surulere', 'Lagos', 6.5, 3.36, '+2348000000302')`;

/** One call per operator function, each valid, so a refusal can only come from the identity check. */
const CALLS: [string, (id: string) => string][] = [
  ['operator_create_facility', (id) => CREATE(id)],
  ['operator_edit_facility', () => `select * from public.operator_edit_facility('${FAC}', 1, 'Renamed', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000301')`],
  ['operator_add_category', () => `select * from public.operator_add_category('${FAC}', 'MATERNITY', 'OFFERED')`],
  ['operator_set_facility_listed', () => `select * from public.operator_set_facility_listed('${FAC}', 1)`],
  ['operator_register', () => `select public.operator_register()`],
  // 021 (R-2026-09-24-75/76): the contact and agreement writes, and the operator's read.
  ['operator_record_contact', () => `select * from public.operator_record_contact('${FAC}', 'A Person', 'Matron', 'role@example.invalid', null, false, null)`],
  ['operator_record_agreement', () => `select * from public.operator_record_agreement('${FAC}', '2026-09-01', 'v1.0', 'CMD')`],
  ['operator_get_contact', () => `select public.operator_get_contact('${FAC}')`],
  // 026 (R-2026-09-27-144 DT k): the HEFAMAA registration number's one writer.
  ['operator_record_registration', () => `select * from public.operator_record_registration('${FAC}', 1, 'LSHEFAMAA-0001')`],
  // 028 (R-2026-09-30-175 EY-2): the scheduler's status, for the admin System status view.
  ['operator_scheduler_status', () => `select public.operator_scheduler_status()`],
  // 029 (R-2026-09-30-201 GA): the approved reporting model's one writer.
  ['operator_record_reporting_approval', () => `select * from public.operator_record_reporting_approval('${FAC}', 'WARD', '2026-09-15', 'CMD')`],
];

describe('the operator functions refuse every caller that is not an active PLATFORM_ADMIN', () => {
  test.each(CALLS)('anon %s is rejected with permission denied, before any body runs', async (_name, call) => {
    const r = await refusal(withRole('anon', null, (tx) => tx.unsafe(call(randomUUID())), accounts));
    expect(r.message).toMatch(/permission denied for function/);
    expect(r.code).toBe('42501');
  });

  test.each(CALLS)('missing-auth %s is rejected with NOT_AUTHENTICATED', async (_name, call) => {
    const r = await refusal(withRole('authenticated', null, (tx) => tx.unsafe(call(randomUUID())), accounts));
    expect(r.message).toBe('NOT_AUTHENTICATED');
    expect(r.code).toBe('42501');
  });

  test.each(CALLS)('ward staff %s is rejected with NOT_AN_OPERATOR', async (_name, call) => {
    const r = await refusal(withRole('authenticated', claims(WARD), (tx) => tx.unsafe(call(randomUUID())), accounts));
    expect(r.message).toBe('NOT_AN_OPERATOR');
    expect(r.code).toBe('42501');
  });

  // 026 (DT): the facility-level reporting login is not an operator either.
  test.each(CALLS)('facility reporter %s is rejected with NOT_AN_OPERATOR', async (_name, call) => {
    const REPORTER = '0a000000-0000-4000-8000-000000000003';
    const r = await refusal(withRole('authenticated', claims(REPORTER), (tx) => tx.unsafe(call(randomUUID())), async (tx) => {
      await accounts(tx);
      await tx.unsafe(`
        insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
        values ('0a000000-0000-4000-8000-0000000000fb', 'Reporter Facility', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000303', null)`);
      await tx.unsafe(`insert into app.ward_account (id, facility_id, role) values ('${REPORTER}', '0a000000-0000-4000-8000-0000000000fb', 'FACILITY_REPORTER')`);
    }));
    expect(r.message).toBe('NOT_AN_OPERATOR');
    expect(r.code).toBe('42501');
  });

  test.each(CALLS)('an account-less session %s is rejected with NOT_AN_OPERATOR', async (_name, call) => {
    const r = await refusal(withRole('authenticated', claims(randomUUID()), (tx) => tx.unsafe(call(randomUUID())), accounts));
    expect(r.message).toBe('NOT_AN_OPERATOR');
  });

  test.each(CALLS)('a deactivated platform admin %s is rejected with ACCOUNT_DEACTIVATED', async (_name, call) => {
    const r = await refusal(
      withRole('authenticated', claims(OP), (tx) => tx.unsafe(call(randomUUID())), async (tx) => {
        await accounts(tx);
        await tx.unsafe(`update app.ward_account set is_active = false, deactivated_at = now() where id = '${OP}'`);
      }),
    );
    expect(r.message).toBe('ACCOUNT_DEACTIVATED');
    expect(r.code).toBe('42501');
  });
});

async function auditCount(tx: TransactionSql, action: string): Promise<number> {
  const [r] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.audit_log where action = '${action}'`);
  return r?.n ?? -1;
}

describe('operator_create_facility', () => {
  test('an active platform admin creates a facility UNLISTED, with its duty-flags row, and one audit row', async () => {
    const id = randomUUID();
    await withRole('authenticated', claims(OP), async (tx) => {
      const [row] = await tx.unsafe<{ facility_id: string; version: number; created: boolean }[]>(CREATE(id));
      expect(row).toEqual({ facility_id: id, version: 1, created: true });
      await tx.unsafe('RESET ROLE');
      const [f] = await tx.unsafe<{ listed: boolean; quiet: boolean; flags: string }[]>(`
        select f.listed_at is not null as listed, f.quiet_mode as quiet,
               ops.anaesthetist || ',' || ops.obstetrician || ',' || ops.paediatrician as flags
          from app.facility f join app.facility_ops ops on ops.facility_id = f.id where f.id = '${id}'`);
      expect(f).toEqual({ listed: false, quiet: false, flags: 'UNKNOWN,UNKNOWN,UNKNOWN' });
      const [pub] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from public.facility_public where facility_id = '${id}'`);
      expect(pub?.n, 'a new facility reached the public mirror before it was listed').toBe(0);
      const [audits] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.audit_log where action = 'facility.create' and facility_id = '${id}'`);
      expect(audits?.n).toBe(1);
    }, accounts);
  });

  test('J2 — a double submit with identical fields returns the same row, writes nothing twice, never 23505', async () => {
    const id = randomUUID();
    await withRole('authenticated', claims(OP), async (tx) => {
      const [first] = await tx.unsafe<{ created: boolean }[]>(CREATE(id));
      const [second] = await tx.unsafe<{ facility_id: string; version: number; created: boolean }[]>(CREATE(id));
      expect(first?.created).toBe(true);
      expect(second).toEqual({ facility_id: id, version: 1, created: false });
      await tx.unsafe('RESET ROLE');
      const [n] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.audit_log where action = 'facility.create' and facility_id = '${id}'`);
      expect(n?.n, 'the replay wrote a second audit row').toBe(1);
    }, accounts);
  });

  test('J2 — the same id with different fields is refused IDEMPOTENCY_CONFLICT', async () => {
    const id = randomUUID();
    const r = await refusal(
      withRole('authenticated', claims(OP), async (tx) => {
        await tx.unsafe(CREATE(id));
        await tx.unsafe(CREATE(id, 'A Different Name'));
      }, accounts),
    );
    expect(r.message).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('a malformed id is refused INVALID_ARGUMENT naming the parameter', async () => {
    const r = await refusal(withRole('authenticated', claims(OP), (tx) => tx.unsafe(CREATE('not-a-uuid')), accounts));
    expect(r.message).toBe('INVALID_ARGUMENT');
    expect(r.detail).toBe('p_id');
  });
});

describe('operator_edit_facility', () => {
  const EDIT = (version: number, name: string): string =>
    `select * from public.operator_edit_facility('${FAC}', ${version}, '${name}', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000301')`;

  test('J1 — two edits from the same loaded version: the first lands, the second is refused and names the current version', async () => {
    const r = await refusal(
      withRole('authenticated', claims(OP), async (tx) => {
        const [first] = await tx.unsafe<{ version: number }[]>(EDIT(1, 'First Edit'));
        expect(first?.version).toBe(2);
        await tx.unsafe(EDIT(1, 'Second Edit From The Same Load'));
      }, accounts),
    );
    expect(r.message).toBe('VERSION_CONFLICT');
    expect(r.detail).toBe('current_version=2');
  });

  test('an edit writes one audit row that names the changed fields, not their text', async () => {
    await withRole('authenticated', claims(OP), async (tx) => {
      await tx.unsafe(EDIT(1, 'Edited Name'));
      await tx.unsafe('RESET ROLE');
      const [a] = await tx.unsafe<{ new_value: { fields: string[]; version: number } }[]>(
        `select new_value from app.audit_log where action = 'facility.edit' and facility_id = '${FAC}'`,
      );
      expect(a?.new_value).toEqual({ fields: ['name'], version: 2 });
    }, accounts);
  });
});

describe('operator_add_category', () => {
  test('-69 (a) — the offering is required: NULL is refused, never defaulted', async () => {
    const r = await refusal(withRole('authenticated', claims(OP), (tx) => tx.unsafe(`select * from public.operator_add_category('${FAC}', 'MATERNITY', NULL)`), accounts));
    expect(r.message).toBe('INVALID_ARGUMENT');
    expect(r.detail).toBe('p_offering');
  });

  test('a new category is PENDING with the stated offering, and one audit row', async () => {
    await withRole('authenticated', claims(OP), async (tx) => {
      const [row] = await tx.unsafe<{ created: boolean }[]>(`select * from public.operator_add_category('${FAC}', 'MATERNITY', 'NOT_OFFERED')`);
      expect(row?.created).toBe(true);
      await tx.unsafe('RESET ROLE');
      const [ws] = await tx.unsafe<{ offering: string; monitoring_state: string }[]>(
        `select offering, monitoring_state from app.ward_status where facility_id = '${FAC}' and category = 'MATERNITY'`,
      );
      expect(ws).toEqual({ offering: 'NOT_OFFERED', monitoring_state: 'PENDING' });
      expect(await auditCount(tx, 'ward_status.add_category')).toBeGreaterThanOrEqual(1);
    }, accounts);
  });

  test('J2 — a repeat with the same offering returns the existing ward and never surfaces 23505', async () => {
    await withRole('authenticated', claims(OP), async (tx) => {
      const [again] = await tx.unsafe<{ created: boolean }[]>(`select * from public.operator_add_category('${FAC}', 'ICU_ADULT', 'OFFERED')`);
      expect(again?.created).toBe(false);
    }, accounts);
  });

  test('a repeat with a DIFFERENT offering is refused — a ward claim is not operator-editable (AJ D7)', async () => {
    const r = await refusal(withRole('authenticated', claims(OP), (tx) => tx.unsafe(`select * from public.operator_add_category('${FAC}', 'ICU_ADULT', 'NOT_OFFERED')`), accounts));
    expect(r.message).toBe('CATEGORY_EXISTS_WITH_OTHER_OFFERING');
  });
});

describe('operator_set_facility_listed — the preconditions, each refused by name', () => {
  async function unlisted(tx: TransactionSql): Promise<void> {
    await accounts(tx);
    await tx.unsafe(`update app.facility set listed_at = NULL where id = '${FAC}'`);
  }
  // Every UPDATE bumps the row version; the fixture's own update makes it 2.
  const LIST = `select * from public.operator_set_facility_listed('${FAC}', 2)`;

  test('I — no facility_contact row is refused NO_FACILITY_CONTACT', async () => {
    const r = await refusal(withRole('authenticated', claims(OP), (tx) => tx.unsafe(LIST), unlisted));
    expect(r.message).toBe('NO_FACILITY_CONTACT');
  });

  test('a contact with no recorded agreement is refused AGREEMENT_NOT_RECORDED', async () => {
    const r = await refusal(
      withRole('authenticated', claims(OP), (tx) => tx.unsafe(LIST), async (tx) => {
        await unlisted(tx);
        await tx.unsafe(`insert into app.facility_contact (facility_id, full_name, job_title, email) values ('${FAC}', 'Named Person', 'Medical Director', '${CONTACT_EMAIL}')`);
      }),
    );
    expect(r.message).toBe('AGREEMENT_NOT_RECORDED');
  });

  test('with the agreement recorded, listing lands, publishes in the same transaction, and writes one audit row', async () => {
    await withRole('authenticated', claims(OP), async (tx) => {
      const [row] = await tx.unsafe<{ version: number; listed_at: string | null }[]>(LIST);
      expect(row?.version).toBe(3);
      expect(row?.listed_at).not.toBeNull();
      await tx.unsafe('RESET ROLE');
      const [pub] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from public.facility_public where facility_id = '${FAC}'`);
      expect(pub?.n).toBe(1);
      expect(await auditCount(tx, 'facility.list')).toBeGreaterThanOrEqual(1);
    }, async (tx) => {
      await unlisted(tx);
      await tx.unsafe(`insert into app.facility_contact (facility_id, full_name, job_title, email) values ('${FAC}', 'Named Person', 'Medical Director', '${CONTACT_EMAIL}')`);
      // 021 (BD-1): the agreement is its own row, never the contact's.
      await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${FAC}', '2026-09-01', 'v1.0')`);
    });
  });

  test('a facility with no category is refused NO_CATEGORY', async () => {
    const r = await refusal(
      withRole('authenticated', claims(OP), (tx) => tx.unsafe(LIST), async (tx) => {
        await unlisted(tx);
        await tx.unsafe(`delete from app.ward_account where id = '${WARD}'`);
        await tx.unsafe(`delete from app.ward_status where facility_id = '${FAC}'`);
        await tx.unsafe(`insert into app.facility_contact (facility_id, full_name, job_title, email) values ('${FAC}', 'Named Person', 'Medical Director', '${CONTACT_EMAIL}')`);
        // 021 (BD-1): the agreement is its own row, never the contact's.
        await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${FAC}', '2026-09-01', 'v1.0')`);
      }),
    );
    expect(r.message).toBe('NO_CATEGORY');
  });
});

describe("operator_register — every facility, every category, and no email (020's list, as 021's envelope)", () => {
  test('provisioning_incomplete is derived from an open invite with no account, and the output carries no address', async () => {
    await withRole('authenticated', claims(OP), async (tx) => {
      const [env] = await tx.unsafe<{ r: { facilities: { facility_id: string; agreement_state: string; has_contact: boolean; categories: { category: string; has_account: boolean; provisioning_incomplete: boolean }[] }[] } }[]>(
        `select public.operator_register() as r`,
      );
      const rows = env!.r.facilities;
      const mine = rows.find((r) => r.facility_id === FAC);
      expect(mine, 'the facility is missing from the operator list').toBeDefined();
      expect(mine?.has_contact).toBe(true);
      expect(mine?.agreement_state, 'a contact and no agreement').toBe('none');
      const byCat = Object.fromEntries((mine?.categories ?? []).map((c) => [c.category, c]));
      expect(byCat['ICU_ADULT']).toMatchObject({ has_account: true, provisioning_incomplete: false });
      expect(byCat['MATERNITY']).toMatchObject({ has_account: false, provisioning_incomplete: true });
      expect(JSON.stringify(rows), 'an operator function returned an email address').not.toContain('@');
    }, async (tx) => {
      await accounts(tx);
      await tx.unsafe(`insert into app.facility_contact (facility_id, full_name, job_title, email) values ('${FAC}', 'Named Person', 'Medical Director', '${CONTACT_EMAIL}')`);
      await tx.unsafe(`insert into app.ward_status (facility_id, category, offering) values ('${FAC}', 'MATERNITY', 'OFFERED')`);
      await tx.unsafe(`insert into app.invite (facility_id, ward_category, role) values ('${FAC}', 'MATERNITY', 'WARD_STAFF')`);
    });
  });

  test('a stale category is LISTED, never filtered out (AJ D8)', async () => {
    await withRole('authenticated', claims(OP), async (tx) => {
      const [env] = await tx.unsafe<{ r: { facilities: { facility_id: string; categories: { category: string }[] }[] } }[]>(`select public.operator_register() as r`);
      const rows = env!.r.facilities;
      const cats = rows.find((r) => r.facility_id === FAC)?.categories.map((c) => c.category);
      expect(cats).toContain('MATERNITY');
    }, async (tx) => {
      await accounts(tx);
      // INSERTED stale: the touch trigger would reset updated_at on an UPDATE.
      await tx.unsafe(`insert into app.ward_status (facility_id, category, offering, updated_at) values ('${FAC}', 'MATERNITY', 'OFFERED', now() - interval '30 days')`);
    });
  });
});

// ============================================================
// 026 (R-2026-09-27-144 DT i, k)
// ============================================================

const FAC_R = '0a000000-0000-4000-8000-0000000000fc';

interface RegisterCategory {
  category: string;
  has_account: boolean;
  provisioning_incomplete: boolean;
}
interface RegisterFacility {
  facility_id: string;
  reporting_model: string;
  reporter_login: string;
  hefamaa_reg_no: string | null;
  version: number;
  categories: RegisterCategory[];
}
interface Register {
  retention_alert: { job: string; end_time: string }[];
  facilities: RegisterFacility[];
}

/** An active operator and one unlisted facility with two wards, and no login at it. */
async function reporterFacility(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`insert into app.ward_account (id, role) values ('${OP}', 'PLATFORM_ADMIN')`);
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
    values ('${FAC_R}', 'Model Facility', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000304', null)`);
  await tx.unsafe(`insert into app.ward_status (facility_id, category, offering) values ('${FAC_R}', 'ICU_ADULT', 'OFFERED'), ('${FAC_R}', 'MATERNITY', 'OFFERED')`);
}

async function register(tx: TransactionSql): Promise<Register> {
  const [env] = await tx.unsafe<{ r: Register }[]>('select public.operator_register() as r');
  if (env === undefined) throw new Error('operator_register returned no row');
  return env.r;
}
const mine = (r: Register): RegisterFacility => {
  const f = r.facilities.find((x) => x.facility_id === FAC_R);
  if (f === undefined) throw new Error('the facility is missing from the register');
  return f;
};
const byCategory = (f: RegisterFacility): Record<string, Omit<RegisterCategory, 'category'>> =>
  Object.fromEntries(f.categories.map((c) => [c.category, { has_account: c.has_account, provisioning_incomplete: c.provisioning_incomplete }]));

describe('operator_register — the reporting model and the reporting login, per facility (026, DT i)', () => {
  test.each<[string, string, { reporting_model: string; reporter_login: string }, Record<string, Omit<RegisterCategory, 'category'>>]>([
    ['no login at all', '', { reporting_model: 'NONE', reporter_login: 'none' }, {
      ICU_ADULT: { has_account: false, provisioning_incomplete: false },
      MATERNITY: { has_account: false, provisioning_incomplete: false },
    }],
    ['one active ward login', `insert into app.ward_account (id, facility_id, ward_category, role) values (gen_random_uuid(), '${FAC_R}', 'ICU_ADULT', 'WARD_STAFF')`,
      { reporting_model: 'WARD', reporter_login: 'none' }, {
        ICU_ADULT: { has_account: true, provisioning_incomplete: false },
        MATERNITY: { has_account: false, provisioning_incomplete: false },
      }],
    ['an open ward invite', `insert into app.invite (facility_id, ward_category, role) values ('${FAC_R}', 'MATERNITY', 'WARD_STAFF')`,
      { reporting_model: 'NONE', reporter_login: 'none' }, {
        ICU_ADULT: { has_account: false, provisioning_incomplete: false },
        MATERNITY: { has_account: false, provisioning_incomplete: true },
      }],
    ['an open reporter invite', `insert into app.invite (facility_id, ward_category, role) values ('${FAC_R}', null, 'FACILITY_REPORTER')`,
      { reporting_model: 'NONE', reporter_login: 'setup incomplete' }, {
        ICU_ADULT: { has_account: false, provisioning_incomplete: true },
        MATERNITY: { has_account: false, provisioning_incomplete: true },
      }],
    ['an active reporter', `insert into app.ward_account (id, facility_id, ward_category, role) values (gen_random_uuid(), '${FAC_R}', null, 'FACILITY_REPORTER')`,
      { reporting_model: 'FACILITY', reporter_login: 'active' }, {
        ICU_ADULT: { has_account: true, provisioning_incomplete: false },
        MATERNITY: { has_account: true, provisioning_incomplete: false },
      }],
    ['an active reporter and its accepted invite', `
      insert into app.invite (facility_id, ward_category, role, accepted_at) values ('${FAC_R}', null, 'FACILITY_REPORTER', now());
      insert into app.ward_account (id, facility_id, ward_category, role) values (gen_random_uuid(), '${FAC_R}', null, 'FACILITY_REPORTER')`,
      { reporting_model: 'FACILITY', reporter_login: 'active' }, {
        ICU_ADULT: { has_account: true, provisioning_incomplete: false },
        MATERNITY: { has_account: true, provisioning_incomplete: false },
      }],
    ['a deactivated reporter', `insert into app.ward_account (id, facility_id, ward_category, role, is_active, deactivated_at) values (gen_random_uuid(), '${FAC_R}', null, 'FACILITY_REPORTER', false, now())`,
      { reporting_model: 'NONE', reporter_login: 'none' }, {
        ICU_ADULT: { has_account: false, provisioning_incomplete: false },
        MATERNITY: { has_account: false, provisioning_incomplete: false },
      }],
  ])('with %s', async (_state, plant, facilityLevel, categories) => {
    const f = await withRole('authenticated', claims(OP), async (tx) => mine(await register(tx)), async (tx) => {
      await reporterFacility(tx);
      if (plant !== '') await tx.unsafe(plant);
    });
    expect({ reporting_model: f.reporting_model, reporter_login: f.reporter_login }).toEqual(facilityLevel);
    expect(byCategory(f)).toEqual(categories);
  });
});

describe('operator_register — retention_alert names a retention job whose last finished run failed (026, DT i; DM-2 e)', () => {
  const at = (s: string): string => new Date(s).toISOString();
  /**
   * Plants one run of a job, by name, as pg_cron would record it. Rolled back with the
   * test. runid is given, not drawn: postgres holds INSERT on cron.job_run_details and
   * no USAGE on its sequence (observed locally, 2026-09-27), and each plant is later
   * than the one before, which is the order the alert reads.
   */
  const run = (job: string, status: string, end: string | null): string => `
    insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
    select j.jobid, (select coalesce(max(runid), 0) + 1 from cron.job_run_details), 1, current_database(), 'postgres', j.command,
           '${status}', '${status === 'failed' ? 'ERROR: planted' : '1 row'}',
           ${end === null ? "now()" : `'${end}'::timestamptz - interval '1 minute'`}, ${end === null ? 'null' : `'${end}'::timestamptz`}
      from cron.job j where j.jobname = '${job}' and j.username = 'postgres'`;
  const alertWith = (...plants: string[]) =>
    withRole('authenticated', claims(OP), async (tx) => (await register(tx)).retention_alert, async (tx) => {
      await reporterFacility(tx);
      for (const p of plants) {
        const r = await tx.unsafe(p);
        if (r.count !== 1) throw new Error(`the plant did not land: ${p}`);
      }
    });

  test('empty when no retention job has run', async () => {
    expect(await alertWith()).toEqual([]);
  });

  test('a failed run of the erasure names the job and the run\'s end', async () => {
    expect(await alertWith(run('openbed_erase_lapsed_ward_logins', 'failed', '2026-09-27 02:17:05+00'))).toEqual([
      { job: 'openbed_erase_lapsed_ward_logins', end_time: at('2026-09-27T02:17:05Z').replace('.000Z', '+00:00') },
    ]);
  });

  test('each of the three jobs is watched, in name order', async () => {
    const alert = await alertWith(
      run('openbed_prune_ended_auth_sessions', 'failed', '2026-09-27 02:27:05+00'),
      run('openbed_check_withdrawn_facility_accounts', 'failed', '2026-09-27 02:37:05+00'),
      run('openbed_erase_lapsed_ward_logins', 'failed', '2026-09-27 02:17:05+00'),
    );
    expect(alert.map((a) => a.job)).toEqual([
      'openbed_check_withdrawn_facility_accounts',
      'openbed_erase_lapsed_ward_logins',
      'openbed_prune_ended_auth_sessions',
    ]);
  });

  test('a later succeeded run clears the alert: only the most recent finished run counts', async () => {
    expect(await alertWith(
      run('openbed_erase_lapsed_ward_logins', 'failed', '2026-09-26 02:17:05+00'),
      run('openbed_erase_lapsed_ward_logins', 'succeeded', '2026-09-27 02:17:05+00'),
    )).toEqual([]);
  });

  test('a run still in progress is not an alert, and does not hide the failed run before it', async () => {
    expect(await alertWith(
      run('openbed_erase_lapsed_ward_logins', 'failed', '2026-09-26 02:17:05+00'),
      run('openbed_erase_lapsed_ward_logins', 'running', null),
    )).toEqual([{ job: 'openbed_erase_lapsed_ward_logins', end_time: '2026-09-26T02:17:05+00:00' }]);
  });

  test('a failed run of a job that is not a retention job is not this alert', async () => {
    expect(await alertWith(run('openbed_regenerate_snapshot', 'failed', '2026-09-27 02:00:05+00'))).toEqual([]);
  });
});

describe('operator_record_registration — the HEFAMAA registration number (026, DT k)', () => {
  const RECORD = (value: string | null, version: number | null = 1): string =>
    `select * from public.operator_record_registration('${FAC_R}', ${version === null ? 'null' : version}, ${value === null ? 'null' : `'${value.replace(/'/g, "''")}'`})`;
  const asOp = <T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> => withRole('authenticated', claims(OP), fn, reporterFacility);
  async function registrationAudits(tx: TransactionSql): Promise<{ old_value: unknown; new_value: unknown; version: number }[]> {
    await tx.unsafe('reset role');
    return tx.unsafe(`select old_value, new_value, version from app.audit_log where facility_id = '${FAC_R}' and action = 'facility.registration' order by id`);
  }

  test('an operator records the number: the facility version moves, the register reads it back, and one audit row carries the number only', async () => {
    const out = await asOp(async (tx) => {
      const [r] = await tx.unsafe<{ facility_id: string; version: number }[]>(RECORD('LSHEFAMAA/2024/0137'));
      const f = mine(await register(tx));
      return { r, f, a: await registrationAudits(tx) };
    });
    expect(out.r).toEqual({ facility_id: FAC_R, version: 2 });
    expect(out.f.hefamaa_reg_no).toBe('LSHEFAMAA/2024/0137');
    expect(out.f.version).toBe(2);
    expect(out.a).toEqual([{ old_value: { hefamaa_reg_no: null }, new_value: { hefamaa_reg_no: 'LSHEFAMAA/2024/0137' }, version: 2 }]);
  });

  test('J2 — an identical repeat returns the current version with no write and no second audit row', async () => {
    const out = await asOp(async (tx) => {
      await tx.unsafe(RECORD('LSHEFAMAA/2024/0137'));
      const [again] = await tx.unsafe<{ version: number }[]>(RECORD('LSHEFAMAA/2024/0137', 1));
      return { again, a: await registrationAudits(tx) };
    });
    expect(out.again?.version).toBe(2);
    expect(out.a).toHaveLength(1);
  });

  test('J1 — a stale version is refused VERSION_CONFLICT, naming the current version, and nothing changes', async () => {
    const out = await asOp(async (tx) => {
      await tx.unsafe(RECORD('LSHEFAMAA/2024/0137'));
      const r = await refusal(tx.savepoint((sp) => sp.unsafe(RECORD('LSHEFAMAA/2024/0999', 1))));
      return { r, f: mine(await register(tx)) };
    });
    expect(out.r.message).toBe('VERSION_CONFLICT');
    expect(out.r.detail).toBe('current_version=2');
    expect(out.f.hefamaa_reg_no).toBe('LSHEFAMAA/2024/0137');
  });

  test('NULL clears a recorded number', async () => {
    const f = await asOp(async (tx) => {
      await tx.unsafe(RECORD('LSHEFAMAA/2024/0137'));
      await tx.unsafe(RECORD(null, 2));
      return mine(await register(tx));
    });
    expect(f.hefamaa_reg_no).toBeNull();
    expect(f.version).toBe(3);
  });

  test('the ordinary number and a 64-character number are accepted', async () => {
    const f = await asOp(async (tx) => {
      await tx.unsafe(RECORD('A'.repeat(64)));
      return mine(await register(tx));
    });
    expect(f.hefamaa_reg_no).toBe('A'.repeat(64));
  });

  test.each([
    ['blank', ''],
    ['only spaces', '   '],
    ['a leading space', ' LSHEFAMAA/0137'],
    ['a trailing space', 'LSHEFAMAA/0137 '],
    ['a trailing tab', 'LSHEFAMAA/0137\t'],
    ['65 characters', 'A'.repeat(65)],
  ])('a number with %s is refused INVALID_ARGUMENT naming p_hefamaa_reg_no', async (_what, value) => {
    const r = await refusal(asOp((tx) => tx.unsafe(RECORD(value))));
    expect(r.message).toBe('INVALID_ARGUMENT');
    expect(r.detail).toBe('p_hefamaa_reg_no');
  });

  test.each([
    ['blank', "''"],
    ['a leading space', "' LSHEFAMAA/0137'"],
    ['a trailing space', "'LSHEFAMAA/0137 '"],
    ['65 characters', `'${'A'.repeat(65)}'`],
  ])('facility_hefamaa_reg_no_form refuses a number with %s written directly', async (_what, literal) => {
    const e = await refusal(withRole('postgres', null, (tx) => tx.unsafe(`update app.facility set hefamaa_reg_no = ${literal} where id = '${FAC_R}'`), reporterFacility));
    expect(e.code).toBe('23514');
    expect(e.message).toContain('facility_hefamaa_reg_no_form');
  });

  test('a facility that does not exist is refused NO_SUCH_FACILITY, and a malformed id INVALID_ARGUMENT', async () => {
    const missing = await refusal(asOp((tx) => tx.unsafe(RECORD('LSHEFAMAA/0137').replace(FAC_R, randomUUID()))));
    expect(missing.message).toBe('NO_SUCH_FACILITY');
    const malformed = await refusal(asOp((tx) => tx.unsafe(RECORD('LSHEFAMAA/0137').replace(FAC_R, 'not-a-uuid'))));
    expect(malformed.message).toBe('INVALID_ARGUMENT');
    expect(malformed.detail).toBe('p_facility_id');
  });
});
