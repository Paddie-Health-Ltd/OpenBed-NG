import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';
import { JOB_KEYS, TOP_KEYS } from '../../packages/snapshot/src/health.js';

/**
 * MIGRATION 028: public.operator_scheduler_status() (R-2026-09-30-175 EY-2). The operator's
 * read of the scheduler's status: app.assert_operator() first, then app.scheduler_status()'s
 * result and nothing else. It is NOT operator_register, which is untouched.
 *
 * EVERY LEG RUNS INSIDE withRole()'s ALWAYS-ROLLED-BACK TRANSACTION, and every PLANT runs
 * 028's DOWN first and then the planted forward inside that transaction: CREATE OR REPLACE
 * keeps the old function's ACL, so a grant plant applied over the real function would
 * inherit the real revokes and prove nothing.
 *
 * A PLANT LEG'S RED IS THE BEHAVIOUR CHANGING, not the bytes: each plant below asserts the
 * violation only the executed, planted path can produce (a non-operator ANSWERED; anon
 * ABLE to execute), which is also the check that the plant reached the code it targets.
 *
 * WHAT IS ASSERTED:
 *   - THE PIN: the normalised body of the function, from pg_proc, is exactly
 *     'BEGIN PERFORM app.assert_operator(); RETURN app.scheduler_status(); END;', with the
 *     language, argument count, return type, STABLE, definer and empty search_path; and its
 *     result holds exactly the keys packages/snapshot/src/health.ts names (TOP_KEYS and
 *     JOB_KEYS, the one list tests/db/health_probe.test.ts pins health_probe to as well).
 *   - THE REFUSAL: an authenticated user who is not an operator is refused NOT_AN_OPERATOR.
 *     Red against 028 with the assert_operator line removed.
 *   - THE ANSWER: the operator is answered, and the result IS app.scheduler_status()'s.
 *   - THE GRANTS: anon cannot execute it, read as has_function_privilege('anon', ...) =
 *     false, because assert_operator's own refusal is also 42501 and a 42501 does not
 *     discriminate. Red against 028 with its REVOKE ALL ... FROM PUBLIC removed: anon then
 *     executes through PUBLIC. This is also the standing proof of R-2026-09-30-175 EY-1's
 *     correction that PUBLIC's built-in EXECUTE, not a named grant, is what reaches anon.
 *
 * NOT ASSERTED HERE, deliberately: the hosted grant. That is
 * scripts/readback_function_grants.sh as the founder's fence 6 after the apply.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const FORWARD_TEXT = readFileSync(join(MIG_DIR, '028_operator_scheduler_status.sql'), 'utf8');
const DOWN_TEXT = readFileSync(join(MIG_DIR, '028_operator_scheduler_status.down.sql'), 'utf8');

const OP = '0a000000-0000-4000-8000-000000000001';
const WARD = '0a000000-0000-4000-8000-000000000002';
const FAC = '0a000000-0000-4000-8000-0000000000fa';
const FN = 'public.operator_scheduler_status()';

type Row = Record<string, unknown>;
type Setup = (tx: TransactionSql) => Promise<void>;

const claims = (sub: string): Record<string, unknown> => ({ sub, role: 'authenticated', session_id: randomUUID() });

/** An active operator and a ward account at a facility, and nothing else. */
const accounts: Setup = async (tx) => {
  await tx.unsafe(`insert into app.ward_account (id, role) values ('${OP}', 'PLATFORM_ADMIN')`);
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
    values ('${FAC}', 'Existing Facility', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000301', now())`);
  await tx.unsafe(`insert into app.ward_status (facility_id, category, offering) values ('${FAC}', 'ICU_ADULT', 'OFFERED')`);
  await tx.unsafe(`insert into app.ward_account (id, facility_id, ward_category, role) values ('${WARD}', '${FAC}', 'ICU_ADULT', 'WARD_STAFF')`);
};

/** The setup a plant uses: the accounts, 028's DOWN, then the planted forward. */
const planted = (text: string): Setup => async (tx) => {
  await accounts(tx);
  await tx.unsafe(DOWN_TEXT);
  await tx.unsafe(text);
};

/** Change the real forward, and refuse to go on when the change did not land. */
function plant(needle: string, replacement: string): string {
  expect(FORWARD_TEXT.split(needle).length - 1, `the statement to plant against is not exactly once in 028: ${needle}`).toBe(1);
  const text = FORWARD_TEXT.replace(needle, replacement);
  expect(text, 'the plant did not change the text').not.toBe(FORWARD_TEXT);
  return text;
}

async function call(tx: TransactionSql): Promise<Row> {
  const [row] = await tx.unsafe<{ p: Row }[]>(`select ${FN} as p`);
  if (!row) throw new Error('operator_scheduler_status returned no row');
  return row.p;
}

const PIN_DEFINITION_SQL = String.raw`select btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g')) = 'BEGIN PERFORM app.assert_operator(); RETURN app.scheduler_status(); END;'
     and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
     and p.pronargs = 0 and p.prorettype = 'jsonb'::regtype and p.provolatile = 's'
     and p.prosecdef and p.proconfig = array['search_path=""'] as pinned
  from pg_proc p where p.oid = 'public.operator_scheduler_status()'::regprocedure`;

/** Every way the function is not exactly what 028 writes; empty means it is. Read as the operator. */
async function pinViolations(tx: TransactionSql): Promise<string[]> {
  const out: string[] = [];
  const [def] = await tx.unsafe<{ pinned: boolean | null }[]>(PIN_DEFINITION_SQL);
  if (def?.pinned !== true) out.push('definition: operator_scheduler_status is not exactly the assert-then-delegate definer 028 writes');
  const p = await call(tx);
  const top = Object.keys(p).sort();
  if (JSON.stringify(top) !== JSON.stringify(TOP_KEYS)) out.push(`top-level keys: ${top.join(',')} is not exactly ${TOP_KEYS.join(',')}`);
  const jobs = Array.isArray(p.jobs) ? (p.jobs as Row[]) : [];
  if (jobs.length === 0) out.push('job keys: the result holds no job element, so the key check would be vacuous');
  for (const j of jobs) {
    const keys = Object.keys(j).sort();
    if (JSON.stringify(keys) !== JSON.stringify(JOB_KEYS)) out.push(`job keys: ${keys.join(',')} is not exactly ${JOB_KEYS.join(',')}`);
  }
  return out;
}

const asOperator = <T>(fn: (tx: TransactionSql) => Promise<T>, setup: Setup = accounts): Promise<T> => withRole('authenticated', claims(OP), fn, setup);

/** A non-operator that is answered is a violation; a refusal other than NOT_AN_OPERATOR is one too. */
async function refusalViolations(setup: Setup): Promise<string[]> {
  const out: string[] = [];
  for (const [who, sub] of [['ward staff', WARD], ['an account-less session', randomUUID()]] as const) {
    try {
      await withRole('authenticated', claims(sub), call, setup);
      out.push(`${who} was ANSWERED`);
    } catch (e) {
      const m = (e as { message?: string }).message;
      if (m !== 'NOT_AN_OPERATOR') out.push(`${who} was refused with ${String(m)}, not NOT_AN_OPERATOR`);
    }
  }
  return out;
}

/** What each client role can do with EXECUTE, counting PUBLIC (has_function_privilege does). */
async function grantViolations(setup: Setup = accounts): Promise<string[]> {
  const rows = await withRole('postgres', null, (tx) =>
    tx.unsafe<{ role: string; ok: boolean }[]>(
      `select r.role, has_function_privilege(r.role, '${FN}', 'EXECUTE') as ok
         from unnest(array['anon', 'authenticated', 'service_role']) as r(role) order by 1`,
    ),
    setup,
  );
  const [pub] = await withRole('postgres', null, (tx) =>
    tx.unsafe<{ p: boolean }[]>(`select coalesce(bool_or(a.grantee = 0), false) as p from pg_proc f, aclexplode(f.proacl) a where f.oid = '${FN}'::regprocedure`),
    setup,
  );
  const out: string[] = [];
  for (const r of rows) {
    if (r.role === 'authenticated' && !r.ok) out.push('authenticated cannot execute it');
    if (r.role !== 'authenticated' && r.ok) out.push(`${r.role} CAN execute it`);
  }
  if (pub?.p !== false) out.push('PUBLIC holds EXECUTE on it');
  return out;
}

/** Rename the real read aside inside the plant's transaction, so a plant can wrap it. */
const WRAP_READ = 'alter function app.scheduler_status() rename to scheduler_status_real';
const wrapper = (body: string): string =>
  `create function app.scheduler_status() returns jsonb language plpgsql stable security definer set search_path = '' as $$ begin ${body} end; $$`;

describe('the operator answered, the non-operator refused', () => {
  test('operator is answered — the result IS app.scheduler_status()', async () => {
    const [viaOperator, direct] = await asOperator(async (tx) => {
      const viaOperator = await call(tx);
      await tx.unsafe('reset role');
      const [row] = await tx.unsafe<{ p: Row }[]>('select app.scheduler_status() as p');
      return [viaOperator, row?.p] as const;
    });
    expect(viaOperator).toEqual(direct);
    expect(Object.keys(viaOperator).sort()).toEqual([...TOP_KEYS]);
  });

  test('non-operator authenticated user is refused with NOT_AN_OPERATOR — real 028 reads no violation', async () => {
    const v = await refusalViolations(accounts);
    expect(v, v.join('; ')).toEqual([]);
  });

  test('plant — 028 with its assert_operator line removed answers a non-operator, and is rejected', async () => {
    const text = plant('PERFORM app.assert_operator();', '');
    const v = await refusalViolations(planted(text));
    expect(v.filter((x) => x.endsWith('was ANSWERED')), v.join('; ')).toHaveLength(2);
  });

  test('anti-vacuity — a database with no operator account refuses the operator, so the answer leg cannot pass on an empty fixture', async () => {
    await expect(asOperator(call, async () => undefined)).rejects.toMatchObject({ code: '42501', message: 'NOT_AN_OPERATOR' });
  });
});

describe('who may execute it', () => {
  test('anon can not execute it, and authenticated can — real 028 reads no violation (has_function_privilege, PUBLIC counted)', async () => {
    const v = await grantViolations();
    expect(v, v.join('; ')).toEqual([]);
  });

  test('plant — 028 with its REVOKE ALL ... FROM PUBLIC removed lets anon execute through PUBLIC, and is rejected', async () => {
    const text = plant("EXECUTE 'REVOKE ALL ON FUNCTION public.operator_scheduler_status() FROM PUBLIC';", 'NULL;');
    const v = await grantViolations(planted(text));
    expect(v, v.join('; ')).toEqual(expect.arrayContaining(['anon CAN execute it', 'service_role CAN execute it', 'PUBLIC holds EXECUTE on it']));
  });

  test('plant — 028 granting service_role as well is rejected: health_probe stays its one function', async () => {
    const text = plant(
      "EXECUTE 'GRANT EXECUTE ON FUNCTION public.operator_scheduler_status() TO authenticated';",
      "EXECUTE 'GRANT EXECUTE ON FUNCTION public.operator_scheduler_status() TO authenticated, service_role';",
    );
    const v = await grantViolations(planted(text));
    expect(v).toEqual(['service_role CAN execute it']);
  });

  test('anti-vacuity — a function that does not exist fails the grant read rather than passing it', async () => {
    await expect(grantViolations(async (tx) => {
      await accounts(tx);
      await tx.unsafe(DOWN_TEXT);
    })).rejects.toThrow();
  });
});

describe('the pin: exactly the assert-then-delegate definer, and exactly the shared keys', () => {
  test('real operator_scheduler_status is accepted — the definition and the keys read no violation', async () => {
    const v = await asOperator(pinViolations);
    expect(v, v.join('; ')).toEqual([]);
  });

  test('plant — a body with an extra statement is rejected', async () => {
    const text = plant('PERFORM app.assert_operator();', 'PERFORM app.assert_operator();\n    PERFORM 1;');
    const v = await asOperator(pinViolations, planted(text));
    expect(v.filter((x) => x.startsWith('definition:')), v.join('; ')).toHaveLength(1);
  });

  test('plant — an extra top-level key is rejected', async () => {
    const v = await asOperator(pinViolations, async (tx) => {
      await accounts(tx);
      await tx.unsafe(WRAP_READ);
      await tx.unsafe(wrapper(`return app.scheduler_status_real() || jsonb_build_object('payload', '[]'::jsonb);`));
    });
    expect(v.filter((x) => x.startsWith('top-level keys:') && x.includes('payload')), v.join('; ')).toHaveLength(1);
  });

  test('plant — an extra key on a job is rejected', async () => {
    const v = await asOperator(pinViolations, async (tx) => {
      await accounts(tx);
      await tx.unsafe(WRAP_READ);
      await tx.unsafe(
        wrapper(`return jsonb_set(app.scheduler_status_real(), '{jobs}', (select jsonb_agg(j || jsonb_build_object('payload', 'x')) from jsonb_array_elements(app.scheduler_status_real() -> 'jobs') j));`),
      );
    });
    expect(v.filter((x) => x.startsWith('job keys:') && x.includes('payload')).length, v.join('; ')).toBeGreaterThan(0);
  });

  test('anti-vacuity — a result with no job element fails the key check rather than passing it', async () => {
    const v = await asOperator(pinViolations, async (tx) => {
      await accounts(tx);
      await tx.unsafe(WRAP_READ);
      await tx.unsafe(wrapper(`return jsonb_set(app.scheduler_status_real(), '{jobs}', '[]'::jsonb);`));
    });
    expect(v.filter((x) => x.includes('vacuous')), v.join('; ')).toHaveLength(1);
  });
});
