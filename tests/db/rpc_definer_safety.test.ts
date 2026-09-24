import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { sql, withRole } from '../setup/db.js';

/**
 * DEFINER SAFETY FOR THE CLIENT-CALLABLE RPCs THAT TAKE ARGUMENTS
 * (conditions B, C and D of the founder's rulings on migrations 014 and 015).
 *
 * B. anon cannot EXECUTE them AT ALL. With SECURITY DEFINER the outcome to want
 *    is that the function NEVER RUNS for anon -- refused by the privilege system
 *    before its body starts. A function that runs and then refuses inside is a
 *    different and weaker result: the body executed with its owner's rights.
 *
 * C. NO FUNCTION IN public TAKES AN app-TYPED INPUT PARAMETER. Across every
 *    function, with no exception list. authenticated has no USAGE on schema app
 *    and PostgREST names parameter types, so such a function is uncallable by
 *    any client (42501). Result columns are deliberately not checked: returning
 *    app types works over HTTP, and all three RPCs do it. This ships with 015,
 *    the migration that makes it true.
 *
 * D. THE GRANT SET IS EXACTLY WHAT 011 ESTABLISHED: the owner and authenticated
 *    hold EXECUTE, and nobody else -- no PUBLIC, no anon, no service_role.
 *
 * tests/db/rls_rpc_execute_allowlist.test.ts asserts the anon-executable set is
 * empty across all of public. This file names the RPCs (two until 020, seven since) and asserts the
 * stronger outcomes above for each.
 */

const RPCS = [
  {
    name: 'publish_ward_status',
    signature: 'public.publish_ward_status(text, text, integer, boolean, text, integer, text, timestamptz)',
    call: `select * from public.publish_ward_status('MATERNITY', 'OFFERED', 1, true, null, 1, 'definer-probe', now())`,
  },
  {
    name: 'ward_status_history',
    signature: 'public.ward_status_history(text, timestamptz, integer)',
    call: `select * from public.ward_status_history('ICU_ADULT', null, 1)`,
  },
  // The operator functions of 020 (R-2026-09-23-71): the first authenticated write
  // surface since 014, so each gets the anon refusal and the exact ACL below.
  {
    name: 'operator_create_facility',
    signature: 'public.operator_create_facility(text, text, text, text, double precision, double precision, text)',
    call: `select * from public.operator_create_facility('00000000-0000-4000-8000-000000000000', 'x', 'x', 'x', 6.5, 3.4, '+2348000000000')`,
  },
  {
    name: 'operator_edit_facility',
    signature: 'public.operator_edit_facility(text, integer, text, text, text, double precision, double precision, text)',
    call: `select * from public.operator_edit_facility('00000000-0000-4000-8000-000000000000', 1, 'x', 'x', 'x', 6.5, 3.4, '+2348000000000')`,
  },
  {
    name: 'operator_set_facility_listed',
    signature: 'public.operator_set_facility_listed(text, integer)',
    call: `select * from public.operator_set_facility_listed('00000000-0000-4000-8000-000000000000', 1)`,
  },
  {
    name: 'operator_add_category',
    signature: 'public.operator_add_category(text, text, text)',
    call: `select * from public.operator_add_category('00000000-0000-4000-8000-000000000000', 'ICU_ADULT', 'OFFERED')`,
  },
  {
    name: 'operator_list_facilities',
    signature: 'public.operator_list_facilities()',
    call: `select * from public.operator_list_facilities()`,
  },
] as const;

/** Every function in public with an input parameter whose type lives in schema app. */
async function appTypedInputParams(tx: TransactionSql): Promise<string[]> {
  const rows = await tx.unsafe<{ fn: string }[]>(`
    select p.oid::regprocedure::text as fn
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and exists (
         select 1
           from unnest(p.proargtypes) t(oid)
           join pg_type ty on ty.oid = t.oid
           join pg_namespace tn on tn.oid = ty.typnamespace
          where tn.nspname = 'app'
       )
     order by 1
  `);
  return rows.map((r) => r.fn);
}

describe('definer safety — B, C, D', () => {
  test.each(RPCS)('anon cannot EXECUTE $name at all — the call is refused before the function body runs', async ({ signature, call }) => {
    const [priv] = await sql()<{ ok: boolean }[]>`select has_function_privilege('anon', ${signature}::regprocedure, 'EXECUTE') as ok`;
    expect(priv?.ok, `anon holds EXECUTE on ${signature}`).toBe(false);

    let err: { code?: string; message: string } | undefined;
    try {
      await withRole('anon', null, async (tx) => {
        await tx.unsafe(call);
      });
    } catch (e) {
      err = e as { code?: string; message: string };
    }
    expect(err, `anon's call to ${signature} was not refused`).toBeDefined();
    // The PRIVILEGE refusal, not one raised from inside the body (NOT_AUTHENTICATED
    // would mean the function ran).
    expect(err?.message).toMatch(/permission denied for function/);
    expect(err?.message).not.toContain('NOT_AUTHENTICATED');
    expect(err?.code).toBe('42501');
  });

  test('no function in public takes an app-typed input parameter — across all functions, with no exception list', async () => {
    const out = await withRole('postgres', null, async (tx) => {
      const [total] = await tx.unsafe<{ n: number }[]>(
        `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`,
      );
      return { total: total?.n ?? 0, offenders: await appTypedInputParams(tx) };
    });
    expect(out.total, 'no functions in public at all — the check is vacuous').toBeGreaterThan(0);
    expect(out.offenders, 'these public functions take a parameter no client can name').toEqual([]);
  });

  test('plant — a public function with an app-typed parameter is caught by the same check', async () => {
    const offenders = await withRole('postgres', null, (tx) => appTypedInputParams(tx), async (tx) => {
      await tx.unsafe(`create function public.zz_plant_app_typed(p app.ward_category) returns integer language sql as 'select 1'`);
    });
    expect(offenders.join('\n'), 'the planted app-typed parameter was not detected').toMatch(/zz_plant_app_typed\(app\.ward_category\)/);
  });

  test.each(RPCS)('$name grant set is exactly the owner and authenticated — no PUBLIC, anon or service_role', async ({ signature }) => {
    const rows = await sql()<{ grant: string; owner: string }[]>`
      select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end || ':' || a.privilege_type as grant,
             pg_get_userbyid(p.proowner) as owner
        from pg_proc p, aclexplode(p.proacl) a
       where p.oid = ${signature}::regprocedure
       order by 1
    `;
    // aclexplode(NULL) yields nothing, and a NULL proacl means PUBLIC's default
    // EXECUTE -- so an empty result must fail here, not pass.
    expect(rows.length, `${signature} has no explicit ACL, which means PUBLIC may execute it`).toBeGreaterThan(0);
    const owner = rows[0]?.owner ?? '';
    expect(rows.map((r) => r.grant), `${signature} grant set drifted from 011's`).toEqual(
      [`${owner}:EXECUTE`, 'authenticated:EXECUTE'].sort(),
    );
  });
});
