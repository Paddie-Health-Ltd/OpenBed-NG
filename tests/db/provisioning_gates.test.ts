import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { sql, sqlSecond, withRole } from '../setup/db.js';

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
 * then makes zero Auth admin calls is asserted against the script, by counting
 * requests at a stub GoTrue: tests/db/provision_script.test.ts.
 *
 * 022 (R-2026-09-24-90 BR-1), the last describe block below:
 *   - at most ONE active PLATFORM_ADMIN, by a partial unique index; begin on an
 *     operator that already exists is `complete` and opens nothing;
 *   - complete REACTIVATES a deactivated account of the same scope, against an open
 *     invite only, with its own audit action;
 *   - every one-active refusal is named by its constraint, never a raw 23505.
 */

const FAC = '0b000000-0000-4000-8000-0000000000fa';
const EMAIL = 'onboarding-contact@example.invalid';

/**
 * 029 (GA; ruling FX P2): app.provision_begin refuses a reporting login that contradicts the
 * LATEST approval, and any reporting login at a facility with no approval. So a "signed"
 * facility here carries one approval, WARD unless the test says otherwise, and a test that
 * begins the other kind appends one: the gate reads the latest. These rows are written
 * directly, as the owner, inside the rolled-back transaction, so no approval outlives a
 * test (the 020-028 round trips reverse 029, which refuses while any row exists).
 */
async function approve(tx: TransactionSql, model: 'WARD' | 'FACILITY'): Promise<void> {
  await tx.unsafe(`
    insert into app.facility_reporting_approval (facility_id, model, approved_on, agreement_version)
    values ('${FAC}', '${model}', '2026-09-15', 'v1.0')`);
}

async function facility(tx: TransactionSql, contact: 'none' | 'unsigned' | 'signed', approval: 'WARD' | 'FACILITY' | null = 'WARD'): Promise<void> {
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
    if (approval !== null) await approve(tx, approval);
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

describe('022 — one active operator, and reactivation through the gates (R-2026-09-24-90 BR-1)', () => {
  const deactivate = (tx: TransactionSql, id: string) =>
    tx.unsafe(`update app.ward_account set is_active = false, deactivated_at = now() where id = '${id}'`);

  test('BR-1 b — begin on an operator that already exists returns complete and opens NOTHING', async () => {
    await withRole('postgres', null, async (tx) => {
      const b = await begin(tx, '', 'PLATFORM_ADMIN', null);
      await complete(tx, b.invite_id ?? '', randomUUID());
      const [before] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.invite where role = 'PLATFORM_ADMIN'`);
      expect(await begin(tx, '', 'PLATFORM_ADMIN', null)).toEqual({ status: 'complete', invite_id: null });
      const [after] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.invite where role = 'PLATFORM_ADMIN'`);
      expect(after?.n, 'begin opened an operator invite while an operator exists').toBe(before?.n);
    });
  });

  test('BR-1 a — a second active PLATFORM_ADMIN is refused OPERATOR_ALREADY_EXISTS by name, never a raw 23505', async () => {
    await withRole('postgres', null, async (tx) => {
      // The invite is opened while no operator exists; one then appears by another path.
      const b = await begin(tx, '', 'PLATFORM_ADMIN', null);
      await tx.unsafe(`insert into app.ward_account (id, role) values ('${randomUUID()}', 'PLATFORM_ADMIN')`);
      const r = await refusal(tx.savepoint((sp) => sp.unsafe(`select * from app.provision_complete('${b.invite_id}', '${randomUUID()}')`)));
      expect(r.message).toBe('OPERATOR_ALREADY_EXISTS');
      expect(r.code, 'the refusal surfaced as the raw unique violation').not.toBe('23505');
    });
  });

  test('BR-1 c — a deactivated ward re-provisioned through the gates is REACTIVATED, with its own audit row', async () => {
    const user = randomUUID();
    await withRole('postgres', null, async (tx) => {
      const first = await begin(tx);
      await complete(tx, first.invite_id ?? '', user);
      await deactivate(tx, user);
      const again = await begin(tx);
      expect(again.status, 'begin treated a switched-off ward as complete').toBe('open');
      expect(await complete(tx, again.invite_id ?? '', user)).toBe('reactivated');
      const [acct] = await tx.unsafe<{ is_active: boolean; off: boolean }[]>(`select is_active, deactivated_at is not null as off from app.ward_account where id = '${user}'`);
      expect(acct).toEqual({ is_active: true, off: false });
      const [inv] = await tx.unsafe<{ accepted: boolean }[]>(`select accepted_at is not null as accepted from app.invite where id = '${again.invite_id}'`);
      expect(inv?.accepted).toBe(true);
      const audits = await tx.unsafe<{ action: string }[]>(`select action from app.audit_log where facility_id = '${FAC}' and action like 'ward_account.%' order by id`);
      expect(audits.map((a) => a.action)).toEqual(['ward_account.provision', 'ward_account.reactivate']);
    }, (tx) => facility(tx, 'signed'));
  });

  test("BR-1 c — a deactivated operator re-provisioned through the gates is reactivated", async () => {
    const user = randomUUID();
    await withRole('postgres', null, async (tx) => {
      const first = await begin(tx, '', 'PLATFORM_ADMIN', null);
      await complete(tx, first.invite_id ?? '', user);
      await deactivate(tx, user);
      const again = await begin(tx, '', 'PLATFORM_ADMIN', null);
      expect(again.status).toBe('open');
      expect(await complete(tx, again.invite_id ?? '', user)).toBe('reactivated');
    });
  });

  test("a withdrawn facility's deactivated ward is refused AGREEMENT_WITHDRAWN at begin, and never reaches complete", async () => {
    const user = randomUUID();
    const r = await refusal(
      withRole('postgres', null, async (tx) => {
        const first = await begin(tx);
        await complete(tx, first.invite_id ?? '', user);
        await deactivate(tx, user);
        await tx.unsafe(`update app.facility_agreement set withdrawn_on = '2026-09-20' where facility_id = '${FAC}'`);
        await begin(tx);
      }, (tx) => facility(tx, 'signed')),
    );
    expect(r.message).toBe('AGREEMENT_WITHDRAWN');
  });

  test('reactivation while the ward holds another active account is refused WARD_ALREADY_HAS_AN_ACCOUNT by name', async () => {
    const old = randomUUID();
    await withRole('postgres', null, async (tx) => {
      const first = await begin(tx);
      await complete(tx, first.invite_id ?? '', old);
      await deactivate(tx, old);
      const second = await begin(tx);
      await complete(tx, second.invite_id ?? '', randomUUID());
      // begin now says complete (J4), so the open invite is made directly.
      const [inv] = await tx.unsafe<{ id: string }[]>(`insert into app.invite (facility_id, ward_category, role) values ('${FAC}', 'ICU_ADULT', 'WARD_STAFF') returning id`);
      const r = await refusal(tx.savepoint((sp) => sp.unsafe(`select * from app.provision_complete('${inv?.id}', '${old}')`)));
      expect(r.message).toBe('WARD_ALREADY_HAS_AN_ACCOUNT');
      expect(r.code).not.toBe('23505');
    }, (tx) => facility(tx, 'signed'));
  });

  test('an inactive account is NOT reactivated over an invite that is already accepted', async () => {
    const user = randomUUID();
    await withRole('postgres', null, async (tx) => {
      const first = await begin(tx);
      await complete(tx, first.invite_id ?? '', user);
      await deactivate(tx, user);
      const r = await refusal(tx.savepoint((sp) => sp.unsafe(`select * from app.provision_complete('${first.invite_id}', '${user}')`)));
      expect(r.message).toBe('INVITE_ALREADY_ACCEPTED');
      const [acct] = await tx.unsafe<{ is_active: boolean }[]>(`select is_active from app.ward_account where id = '${user}'`);
      expect(acct?.is_active, 'the account was switched back on without an open invite').toBe(false);
    }, (tx) => facility(tx, 'signed'));
  });

  test('two concurrent complete() calls on one invite, over two real connections: one wins, the other is named', async () => {
    // COMMITS, because two connections cannot share a rolled-back transaction. The
    // operator scope needs no facility, so nothing is left behind but the append-only
    // audit rows; finally removes the invite and any account, so no active
    // PLATFORM_ADMIN outlives this test (R-2026-09-24-91 BS-1 a).
    const [a, b] = [randomUUID(), randomUUID()];
    const [inv] = await sql()<{ invite_id: string; status: string }[]>`select * from app.provision_begin(NULL, NULL, 'PLATFORM_ADMIN')`;
    try {
      expect(inv?.status, 'an operator already exists on this database, so the race has nothing to race for').toBe('open');
      const results = await Promise.allSettled([
        sql()`select * from app.provision_complete(${inv!.invite_id}::uuid, ${a}::uuid)`,
        sqlSecond()`select * from app.provision_complete(${inv!.invite_id}::uuid, ${b}::uuid)`,
      ]);
      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(won, JSON.stringify(results)).toHaveLength(1);
      expect(lost.map((l) => (l.reason as Error).message)).toEqual(['INVITE_ALREADY_ACCEPTED']);
      const [n] = await sql()<{ n: number }[]>`select count(*)::int as n from app.ward_account where id in (${a}::uuid, ${b}::uuid)`;
      expect(n?.n, 'both racers created an account').toBe(1);
    } finally {
      await sql()`delete from app.ward_account where id in (${a}::uuid, ${b}::uuid)`;
      if (inv) await sql()`delete from app.invite where id = ${inv.invite_id}::uuid`;
    }
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

describe('026 — the facility reporter is provisioned through the same gates, and one source reports per ward (R-2026-09-27-144 DT c, g)', () => {
  const REPORTER = 'FACILITY_REPORTER';
  const deactivate = (tx: TransactionSql, id: string) =>
    tx.unsafe(`update app.ward_account set is_active = false, deactivated_at = now() where id = '${id}'`);
  const reporterBegin = (tx: TransactionSql): Promise<Begin> => begin(tx, '', REPORTER);
  const insertAccount = (tx: TransactionSql, role: 'WARD_STAFF' | 'FACILITY_REPORTER', id: string = randomUUID()): Promise<unknown> =>
    tx.unsafe(`insert into app.ward_account (id, facility_id, ward_category, role) values ('${id}', '${FAC}', ${role === 'WARD_STAFF' ? "'ICU_ADULT'" : 'null'}, '${role}')`);

  test('the reporter is provisioned: begin opens a facility-scoped invite with no category, complete makes the account, and a second begin is complete', async () => {
    const user = randomUUID();
    await withRole('postgres', null, async (tx) => {
      const b = await reporterBegin(tx);
      expect(b.status).toBe('open');
      const [inv] = await tx.unsafe<{ facility_id: string; ward_category: string | null; role: string }[]>(
        `select facility_id, ward_category, role from app.invite where id = '${b.invite_id}'`,
      );
      expect(inv).toEqual({ facility_id: FAC, ward_category: null, role: REPORTER });
      expect(await complete(tx, b.invite_id ?? '', user)).toBe('complete');
      const [acct] = await tx.unsafe<{ role: string; facility_id: string; ward_category: string | null; is_active: boolean }[]>(
        `select role, facility_id, ward_category, is_active from app.ward_account where id = '${user}'`,
      );
      expect(acct).toEqual({ role: REPORTER, facility_id: FAC, ward_category: null, is_active: true });
      expect(await reporterBegin(tx), 'begin opened a second reporter invite while one is active').toEqual({ status: 'complete', invite_id: null });
    }, (tx) => facility(tx, 'signed', 'FACILITY'));
  });

  test('a reporter invite with a category is refused INVALID_ARGUMENT', async () => {
    const r = await refusal(withRole('postgres', null, (tx) => begin(tx, 'ICU_ADULT', REPORTER), (tx) => facility(tx, 'signed')));
    expect(r.message).toBe('INVALID_ARGUMENT');
  });

  test('a reporter invite with no facility is refused INVALID_ARGUMENT — never provisioned as the operator (the 022 ELSE)', async () => {
    const r = await refusal(withRole('postgres', null, (tx) => begin(tx, '', REPORTER, null), (tx) => facility(tx, 'signed')));
    expect(r.message).toBe('INVALID_ARGUMENT');
  });

  test.each<[string, 'none' | 'unsigned' | 'withdrawn', string]>([
    ['no contact', 'none', 'NO_FACILITY_CONTACT'],
    ['no agreement', 'unsigned', 'AGREEMENT_NOT_RECORDED'],
    ['a withdrawn agreement', 'withdrawn', 'AGREEMENT_WITHDRAWN'],
  ])('a reporter at a facility with %s is refused %s', async (_what, state, code) => {
    const r = await refusal(withRole('postgres', null, (tx) => reporterBegin(tx), async (tx) => {
      await facility(tx, state === 'withdrawn' ? 'signed' : state);
      if (state === 'withdrawn') await tx.unsafe(`update app.facility_agreement set withdrawn_on = '2026-09-20' where facility_id = '${FAC}'`);
    }));
    expect(r.message).toBe(code);
  });

  test('a reporter at a facility with no ward is refused NO_CATEGORY', async () => {
    const r = await refusal(withRole('postgres', null, (tx) => reporterBegin(tx), async (tx) => {
      await facility(tx, 'signed');
      await tx.unsafe(`delete from app.ward_status where facility_id = '${FAC}'`);
    }));
    expect(r.message).toBe('NO_CATEGORY');
  });

  test('FACILITY_ADMIN falls to the ELSE and is refused ROLE_NOT_PROVISIONED_IN_V1, naming the role', async () => {
    const r = await refusal(withRole('postgres', null, (tx) => tx.unsafe(`select * from app.provision_begin('${FAC}', NULL, 'FACILITY_ADMIN')`), (tx) => facility(tx, 'signed')));
    expect(r.message).toBe('ROLE_NOT_PROVISIONED_IN_V1');
  });

  test('a reporter where a ward login is active is refused REPORTING_MODEL_CONFLICT at begin, and opens no invite', async () => {
    await withRole('postgres', null, async (tx) => {
      const w = await begin(tx);
      await complete(tx, w.invite_id ?? '', randomUUID());
      // 029: the approval now says FACILITY, so the gate passes and the conflict is what refuses.
      await approve(tx, 'FACILITY');
      const r = await refusal(tx.savepoint((sp) => sp.unsafe(`select * from app.provision_begin('${FAC}', NULL, '${REPORTER}')`)));
      expect(r.message).toBe('REPORTING_MODEL_CONFLICT');
      const [n] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.invite where facility_id = '${FAC}' and role = '${REPORTER}'`);
      expect(n?.n, 'an invite opened despite the conflict').toBe(0);
    }, (tx) => facility(tx, 'signed'));
  });

  test('a ward login where a reporter is active is refused REPORTING_MODEL_CONFLICT at begin, and opens no invite', async () => {
    await withRole('postgres', null, async (tx) => {
      const b = await reporterBegin(tx);
      await complete(tx, b.invite_id ?? '', randomUUID());
      // 029: the approval now says WARD, so the gate passes and the conflict is what refuses.
      await approve(tx, 'WARD');
      const r = await refusal(tx.savepoint((sp) => sp.unsafe(`select * from app.provision_begin('${FAC}', 'ICU_ADULT', 'WARD_STAFF')`)));
      expect(r.message).toBe('REPORTING_MODEL_CONFLICT');
      const [n] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.invite where facility_id = '${FAC}' and role = 'WARD_STAFF'`);
      expect(n?.n, 'an invite opened despite the conflict').toBe(0);
    }, (tx) => facility(tx, 'signed', 'FACILITY'));
  });

  test.each<['WARD_STAFF' | 'FACILITY_REPORTER', 'WARD_STAFF' | 'FACILITY_REPORTER']>([
    ['WARD_STAFF', 'FACILITY_REPORTER'],
    ['FACILITY_REPORTER', 'WARD_STAFF'],
  ])('the trigger — an active %s makes a direct INSERT of an active %s at the same facility REPORTING_MODEL_CONFLICT', async (first, second) => {
    await withRole('postgres', null, async (tx) => {
      await insertAccount(tx, first);
      const r = await refusal(tx.savepoint((sp) => insertAccount(sp, second)));
      expect(r.message).toBe('REPORTING_MODEL_CONFLICT');
    }, (tx) => facility(tx, 'signed'));
  });

  test('the trigger — reactivating a ward login while a reporter is active is REPORTING_MODEL_CONFLICT, through provision_complete and by hand', async () => {
    const ward = randomUUID();
    await withRole('postgres', null, async (tx) => {
      const w = await begin(tx);
      await complete(tx, w.invite_id ?? '', ward);
      await deactivate(tx, ward);
      await approve(tx, 'FACILITY');
      const b = await reporterBegin(tx);
      await complete(tx, b.invite_id ?? '', randomUUID());
      // begin refuses the ward now (above), so the reopening invite is made directly.
      const [inv] = await tx.unsafe<{ id: string }[]>(`insert into app.invite (facility_id, ward_category, role) values ('${FAC}', 'ICU_ADULT', 'WARD_STAFF') returning id`);
      const viaComplete = await refusal(tx.savepoint((sp) => sp.unsafe(`select * from app.provision_complete('${inv?.id}', '${ward}')`)));
      expect(viaComplete.message).toBe('REPORTING_MODEL_CONFLICT');
      const byHand = await refusal(tx.savepoint((sp) => sp.unsafe(`update app.ward_account set is_active = true, deactivated_at = null where id = '${ward}'`)));
      expect(byHand.message).toBe('REPORTING_MODEL_CONFLICT');
    }, (tx) => facility(tx, 'signed'));
  });

  test('control — an INACTIVE ward login beside an active reporter is accepted: the rule is about who reports now', async () => {
    await withRole('postgres', null, async (tx) => {
      await insertAccount(tx, 'FACILITY_REPORTER');
      await tx.unsafe(`insert into app.ward_account (id, facility_id, ward_category, role, is_active, deactivated_at) values ('${randomUUID()}', '${FAC}', 'ICU_ADULT', 'WARD_STAFF', false, now())`);
      const [n] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from app.ward_account where facility_id = '${FAC}'`);
      expect(n?.n).toBe(2);
    }, (tx) => facility(tx, 'signed'));
  });

  test('the trigger refuses to run under REPEATABLE READ, where its read could not see a concurrent writer', async () => {
    const sentinel = new Error('rollback');
    let message = '';
    try {
      await sql().begin('isolation level repeatable read', async (tx) => {
        await facility(tx, 'signed');
        try {
          await tx.savepoint((sp) => insertAccount(sp, 'FACILITY_REPORTER'));
        } catch (e) {
          message = (e as Error).message;
        }
        throw sentinel;
      });
    } catch (e) {
      if (e !== sentinel) throw e;
    }
    expect(message).toBe('REPORTING_MODEL_CHECK_ISOLATION');
  });

  test('a second active reporter is refused REPORTER_ALREADY_EXISTS by name, never a raw 23505 — and the index refuses it written directly', async () => {
    await withRole('postgres', null, async (tx) => {
      // The invite is opened while no reporter exists; one then appears by another path.
      const b = await reporterBegin(tx);
      await insertAccount(tx, 'FACILITY_REPORTER');
      const r = await refusal(tx.savepoint((sp) => sp.unsafe(`select * from app.provision_complete('${b.invite_id}', '${randomUUID()}')`)));
      expect(r.message).toBe('REPORTER_ALREADY_EXISTS');
      expect(r.code, 'the refusal surfaced as the raw unique violation').not.toBe('23505');
      const raw = await refusal(tx.savepoint((sp) => insertAccount(sp, 'FACILITY_REPORTER')));
      expect(raw.code, 'the index did not refuse a second active reporter written directly').toBe('23505');
      expect(raw.message).toContain('ward_account_one_active_reporter');
    }, (tx) => facility(tx, 'signed', 'FACILITY'));
  });

  test('a deactivated reporter re-provisioned through the gates is reactivated', async () => {
    const user = randomUUID();
    await withRole('postgres', null, async (tx) => {
      const first = await reporterBegin(tx);
      await complete(tx, first.invite_id ?? '', user);
      await deactivate(tx, user);
      const again = await reporterBegin(tx);
      expect(again.status, 'begin treated a switched-off reporter as complete').toBe('open');
      expect(await complete(tx, again.invite_id ?? '', user)).toBe('reactivated');
    }, (tx) => facility(tx, 'signed', 'FACILITY'));
  });

  test('an erased reporter login is refused LOGIN_ERASED, as a ward login is', async () => {
    const user = randomUUID();
    await withRole('postgres', null, async (tx) => {
      const first = await reporterBegin(tx);
      await complete(tx, first.invite_id ?? '', user);
      await tx.unsafe(`update app.ward_account set is_active = false, deactivated_at = now() - interval '40 days', login_erased_at = now() where id = '${user}'`);
      const again = await reporterBegin(tx);
      const r = await refusal(tx.savepoint((sp) => sp.unsafe(`select * from app.provision_complete('${again.invite_id}', '${user}')`)));
      expect(r.message).toBe('LOGIN_ERASED');
    }, (tx) => facility(tx, 'signed', 'FACILITY'));
  });

  test('the race — a reporter and a ward login activated at one facility over two real connections: exactly one succeeds, and the second WAITED on the first', async () => {
    // COMMITS, because two connections cannot share a rolled-back transaction. Its own
    // facility id, so no other test's rows are touched; direct inserts, so no
    // append-only audit row pins the facility; finally removes every row it made.
    const RACE = '0d000000-0000-4000-8000-0000000000fa';
    const [reporter, ward] = [randomUUID(), randomUUID()];
    let release!: () => void;
    const released = new Promise<void>((r) => { release = r; });
    let inserted!: () => void;
    const aInserted = new Promise<void>((r) => { inserted = r; });
    try {
      await sql().unsafe(`
        insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
        values ('${RACE}', 'Race Facility', 'Yaba', 'Lagos', 6.51, 3.38, '+2348000000402', NULL)`);
      await sql().unsafe(`insert into app.ward_status (facility_id, category, offering) values ('${RACE}', 'ICU_ADULT', 'OFFERED')`);

      const a = sql().begin(async (tx) => {
        await tx.unsafe(`insert into app.ward_account (id, facility_id, ward_category, role) values ('${reporter}', '${RACE}', null, 'FACILITY_REPORTER')`);
        inserted();
        await released;
      });
      // Proceeds once A's INSERT has landed -- or fails here, naming A's error, if it
      // could not land (a reporter row the scope CHECK refuses, before 026).
      await Promise.race([aInserted, a.then(() => undefined)]);
      let bSettled = false;
      const b = sqlSecond()
        .unsafe(`insert into app.ward_account (id, facility_id, ward_category, role) values ('${ward}', '${RACE}', 'ICU_ADULT', 'WARD_STAFF')`)
        .finally(() => { bSettled = true; });
      await new Promise((r) => setTimeout(r, 500));
      const waited = !bSettled;
      release();
      const results = await Promise.allSettled([a, b]);
      expect(waited, 'the ward login did not wait for the reporter\'s transaction: nothing serialised them').toBe(true);
      expect(results.map((r) => r.status), JSON.stringify(results)).toEqual(['fulfilled', 'rejected']);
      expect(((results[1] as PromiseRejectedResult).reason as Error).message).toBe('REPORTING_MODEL_CONFLICT');
      const [n] = await sql()<{ n: number }[]>`select count(*)::int as n from app.ward_account where facility_id = ${RACE}::uuid and is_active`;
      expect(n?.n, 'both kinds of login are active at one facility').toBe(1);
    } finally {
      release();
      await sql()`delete from app.ward_account where id in (${reporter}::uuid, ${ward}::uuid)`;
      await sql()`delete from app.ward_status where facility_id = ${RACE}::uuid`;
      await sql()`delete from app.facility where id = ${RACE}::uuid`;
    }
  });
});
