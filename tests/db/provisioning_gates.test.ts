import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { sql, withRole } from '../setup/db.js';

/**
 * THE PROVISIONING GATES: ONE IMPLEMENTATION, IN SQL (R-2026-09-23-71 C, I, J3, J4).
 *
 * app.provision_begin() and app.provision_complete() are the only implementation of
 * the gates on ward-login provisioning. No second copy lives in JS.
 * scripts/provision_ward_account.mjs calls them as the database owner (3.4b), and no
 * client role can execute them.
 *
 * Under -71 C no operator RPC provisions in v1: the admin app cannot create an Auth
 * user without the secret key, so nothing public calls these functions.
 *
 * THE GATES, each refused by name:
 *   - I: the facility has no facility_contact row (NO_FACILITY_CONTACT), or has
 *     one with no agreement recorded (AGREEMENT_NOT_RECORDED). The -45 invite gate
 *     is in the database, not the UI;
 *   - the category has not been added to the facility (NO_SUCH_WARD).
 *
 * THE CARDINALITY (J3). An account is a ward, never a person, so a ward has at most
 * ONE active WARD_STAFF account. That is a partial unique index. Replacing a ward's
 * address means deactivating the old account first.
 *
 * J4: begin on a ward that already has its account returns `complete` and opens
 * nothing. That tells the script not to call generate_link, which would mint a new
 * token and could invalidate a link the ward already requested. That the script
 * then makes zero Auth admin calls is 3.4b's test, against the script.
 */

const FAC = '0b000000-0000-4000-8000-0000000000fa';
const EMAIL = 'onboarding-contact@example.invalid';

async function facility(tx: TransactionSql, contact: 'none' | 'unsigned' | 'signed'): Promise<void> {
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
    values ('${FAC}', 'Provisioning Facility', 'Yaba', 'Lagos', 6.51, 3.38, '+2348000000401', NULL)`);
  await tx.unsafe(`insert into app.ward_status (facility_id, category, offering) values ('${FAC}', 'ICU_ADULT', 'OFFERED')`);
  if (contact !== 'none') {
    await tx.unsafe(`
      insert into app.facility_contact (facility_id, full_name, job_title, email)
      values ('${FAC}', 'Named Person', 'Medical Director', '${EMAIL}')`);
  }
  // 021 (BD-1): a signed agreement is its own row, never the contact's.
  if (contact === 'signed') {
    await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${FAC}', '2026-09-01', 'v1.0')`);
  }
}

interface Refusal {
  message: string;
  code: string | undefined;
}
async function refusal(p: Promise<unknown>): Promise<Refusal> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; message: string };
    return { message: x.message, code: x.code };
  }
  throw new Error('expected a refusal, and the call succeeded');
}

type Begin = { status: string; invite_id: string | null };
const begin = async (tx: TransactionSql, category = 'ICU_ADULT', role = 'WARD_STAFF', fac: string | null = FAC): Promise<Begin> => {
  const [r] = await tx.unsafe<Begin[]>(`select * from app.provision_begin(${fac === null ? 'NULL' : `'${fac}'`}, ${category === '' ? 'NULL' : `'${category}'`}, '${role}')`);
  if (r === undefined) throw new Error('provision_begin returned no row');
  return r;
};
const complete = async (tx: TransactionSql, invite: string, user: string): Promise<string> => {
  const [r] = await tx.unsafe<{ status: string }[]>(`select * from app.provision_complete('${invite}', '${user}')`);
  return r?.status ?? '(no row)';
};

describe('the provisioning gates refuse by name', () => {
  test('I — a facility with no facility_contact row is refused NO_FACILITY_CONTACT', async () => {
    const r = await refusal(withRole('postgres', null, (tx) => begin(tx), (tx) => facility(tx, 'none')));
    expect(r.message).toBe('NO_FACILITY_CONTACT');
  });

  test('I — a contact with no recorded agreement is refused AGREEMENT_NOT_RECORDED', async () => {
    const r = await refusal(withRole('postgres', null, (tx) => begin(tx), (tx) => facility(tx, 'unsigned')));
    expect(r.message).toBe('AGREEMENT_NOT_RECORDED');
  });

  test('a category that was never added is refused NO_SUCH_WARD', async () => {
    const r = await refusal(withRole('postgres', null, (tx) => begin(tx, 'MATERNITY'), (tx) => facility(tx, 'signed')));
    expect(r.message).toBe('NO_SUCH_WARD');
  });

  test('FACILITY_ADMIN is not provisioned in v1, and says so', async () => {
    const r = await refusal(withRole('postgres', null, (tx) => begin(tx, '', 'FACILITY_ADMIN'), (tx) => facility(tx, 'signed')));
    expect(r.message).toBe('ROLE_NOT_PROVISIONED_IN_V1');
  });
});

describe('begin and complete are idempotent, and a ward has one active account', () => {
  test('begin opens one invite, and a second begin returns THE SAME invite rather than a duplicate', async () => {
    await withRole('postgres', null, async (tx) => {
      const a = await begin(tx);
      const b = await begin(tx);
      expect(a.status).toBe('open');
      expect(b).toEqual(a);
      const [n] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.invite where facility_id = '${FAC}' and accepted_at is null`);
      expect(n?.n).toBe(1);
    }, (tx) => facility(tx, 'signed'));
  });

  test('complete creates the account with id = the Auth user id, accepts the invite, and a repeat changes nothing', async () => {
    const user = randomUUID();
    await withRole('postgres', null, async (tx) => {
      const { invite_id } = await begin(tx);
      expect(await complete(tx, invite_id ?? '', user)).toBe('complete');
      expect(await complete(tx, invite_id ?? '', user)).toBe('complete');
      const [acct] = await tx.unsafe<{ role: string; facility_id: string; ward_category: string; is_active: boolean }[]>(
        `select role, facility_id, ward_category, is_active from app.ward_account where id = '${user}'`,
      );
      expect(acct).toEqual({ role: 'WARD_STAFF', facility_id: FAC, ward_category: 'ICU_ADULT', is_active: true });
      const [inv] = await tx.unsafe<{ accepted: boolean }[]>(`select accepted_at is not null as accepted from app.invite where id = '${invite_id}'`);
      expect(inv?.accepted).toBe(true);
      const [audits] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.audit_log where action = 'ward_account.provision' and facility_id = '${FAC}'`);
      expect(audits?.n, 'the repeat wrote a second audit row').toBe(1);
    }, (tx) => facility(tx, 'signed'));
  });

  test('J4 — begin on a ward that already has its account returns complete and opens NOTHING', async () => {
    await withRole('postgres', null, async (tx) => {
      const { invite_id } = await begin(tx);
      await complete(tx, invite_id ?? '', randomUUID());
      const [before] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.invite where facility_id = '${FAC}'`);
      expect(await begin(tx)).toEqual({ status: 'complete', invite_id: null });
      const [after] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.invite where facility_id = '${FAC}'`);
      expect(after?.n, 'begin opened an invite on a complete ward').toBe(before?.n);
    }, (tx) => facility(tx, 'signed'));
  });

  test('J3 — a second ACTIVE account for the same ward is refused, by the function and by the index', async () => {
    await withRole('postgres', null, async (tx) => {
      const { invite_id } = await begin(tx);
      await complete(tx, invite_id ?? '', randomUUID());
      // An open invite for the same ward, as a second address would have made before J3.
      const [second] = await tx.unsafe<{ id: string }[]>(`insert into app.invite (facility_id, ward_category, role) values ('${FAC}', 'ICU_ADULT', 'WARD_STAFF') returning id`);
      const r = await refusal(tx.savepoint((sp) => sp.unsafe(`select * from app.provision_complete('${second?.id}', '${randomUUID()}')`)));
      expect(r.message).toBe('WARD_ALREADY_HAS_AN_ACCOUNT');
      const raw = await refusal(
        tx.savepoint((sp) => sp.unsafe(`insert into app.ward_account (id, facility_id, ward_category, role) values ('${randomUUID()}', '${FAC}', 'ICU_ADULT', 'WARD_STAFF')`)),
      );
      expect(raw.code, 'the index did not refuse a second active account written directly').toBe('23505');
      expect(raw.message).toContain('ward_account_one_active_per_ward');
    }, (tx) => facility(tx, 'signed'));
  });

  test('replacing a ward address — deactivate the old account, and the ward can be provisioned again', async () => {
    await withRole('postgres', null, async (tx) => {
      const old = randomUUID();
      const first = await begin(tx);
      await complete(tx, first.invite_id ?? '', old);
      await tx.unsafe(`update app.ward_account set is_active = false, deactivated_at = now() where id = '${old}'`);
      const again = await begin(tx);
      expect(again.status).toBe('open');
      expect(await complete(tx, again.invite_id ?? '', randomUUID())).toBe('complete');
    }, (tx) => facility(tx, 'signed'));
  });

  test('a user who already holds an account of ANOTHER scope is refused ACCOUNT_SCOPE_CONFLICT', async () => {
    const user = randomUUID();
    const r = await refusal(
      withRole('postgres', null, async (tx) => {
        await tx.unsafe(`insert into app.ward_status (facility_id, category, offering) values ('${FAC}', 'MATERNITY', 'OFFERED')`);
        const a = await begin(tx, 'ICU_ADULT');
        await complete(tx, a.invite_id ?? '', user);
        const b = await begin(tx, 'MATERNITY');
        await complete(tx, b.invite_id ?? '', user);
      }, (tx) => facility(tx, 'signed')),
    );
    expect(r.message).toBe('ACCOUNT_SCOPE_CONFLICT');
  });

  test('the first PLATFORM_ADMIN is bootstrapped through the same functions, with no facility gate', async () => {
    const user = randomUUID();
    await withRole('postgres', null, async (tx) => {
      const b = await begin(tx, '', 'PLATFORM_ADMIN', null);
      expect(b.status).toBe('open');
      expect(await begin(tx, '', 'PLATFORM_ADMIN', null), 'a second begin opened a second admin invite').toEqual(b);
      expect(await complete(tx, b.invite_id ?? '', user)).toBe('complete');
      const [acct] = await tx.unsafe<{ role: string; facility_id: string | null }[]>(`select role, facility_id from app.ward_account where id = '${user}'`);
      expect(acct).toEqual({ role: 'PLATFORM_ADMIN', facility_id: null });
    });
  });
});

describe('no client role can reach the gates', () => {
  test.each(['anon', 'authenticated', 'service_role'])('%s holds no EXECUTE on app.provision_begin or app.provision_complete', async (role) => {
    const rows = await sql()<{ f: string; can: boolean }[]>`
      select p.proname as f, has_function_privilege(${role}, p.oid, 'EXECUTE') as can
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname in ('provision_begin', 'provision_complete')
       order by 1`;
    expect(rows, 'the two gate functions do not exist, so this leg checked nothing').toHaveLength(2);
    expect(rows.every((r) => !r.can), JSON.stringify(rows)).toBe(true);
  });
});
