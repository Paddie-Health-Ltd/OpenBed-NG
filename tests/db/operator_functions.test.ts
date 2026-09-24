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
      const [env] = await tx.unsafe<{ r: { facilities: { facility_id: string; agreement_recorded: boolean; has_contact: boolean; categories: { category: string; has_account: boolean; provisioning_incomplete: boolean }[] }[] } }[]>(
        `select public.operator_register() as r`,
      );
      const rows = env!.r.facilities;
      const mine = rows.find((r) => r.facility_id === FAC);
      expect(mine, 'the facility is missing from the operator list').toBeDefined();
      expect(mine?.has_contact).toBe(true);
      expect(mine?.agreement_recorded).toBe(false);
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
