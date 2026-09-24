import { describe, expect, test } from 'vitest';
import { sql, withRole } from '../setup/db.js';
import GRANTS from '../../packages/fixtures/function-grants.json';

/**
 * THE FUNCTIONS `authenticated` CAN RUN ARE A CLOSED, NAMED LIST (kickoff AJ D3;
 * R-2026-09-23-71 G).
 *
 * Until migration 020 the only related check was
 * tests/db/rls_rpc_execute_allowlist.test.ts's positive control: three named RPCs,
 * each executable by `authenticated`. Nothing asserted that NOTHING ELSE was. 020
 * adds the first authenticated-executable functions since 014, and with them the
 * first PLATFORM_ADMIN write surface. So the set is now asserted by identity
 * (test-conventions §3), not by count. A function granted to `authenticated` by
 * anyone, for any reason, turns this red until it is named here with its reason.
 *
 * THE SCOPE is the schemas PostgREST exposes: `public` and `graphql_public`. That
 * is supabase/config.toml's [api] schemas, held equal to
 * packages/fixtures/public-relations.json by tests/db/config_drift.test.ts. A
 * function in a schema PostgREST does not expose cannot be called over the API, and
 * `authenticated` holds no USAGE on `app` (001).
 *
 * NOT ASSERTED HERE: what each function gives a platform admin. That is
 * tests/db/platform_admin_session_live.test.ts, over a real session.
 */

const EXPOSED = ['public', 'graphql_public'];

/**
 * THE LIST IS DERIVED, NEVER WRITTEN HERE (R-2026-09-24-74 BB-2). Its one source is
 * packages/fixtures/function-grants.json, which scripts/readback_function_grants.sh
 * also holds hosted to after an apply. Until 2026-09-24 the list was a literal in
 * this file. Each entry is schema.function, and why `authenticated` may run it: every
 * fixture entry in an exposed schema whose `execute` includes authenticated.
 */
const CLOSED_LIST: Record<string, string> = Object.fromEntries(
  Object.entries(GRANTS.functions as Record<string, { execute: string[]; why: string }>)
    .filter(([identity, g]) => EXPOSED.includes(identity.split('.')[0]!) && g.execute.includes('authenticated'))
    .map(([identity, g]) => [identity.slice(0, identity.indexOf('(')), g.why]),
);

async function executable(tx: { unsafe: <T>(q: string) => Promise<T> } = sql() as never): Promise<string[]> {
  const rows = await tx.unsafe<{ f: string }[]>(`
    select n.nspname || '.' || p.proname as f
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in (${EXPOSED.map((s) => `'${s}'`).join(', ')})
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     order by 1`);
  return [...new Set(rows.map((r) => r.f))];
}

export function closedListViolations(found: string[], list: Record<string, string> = CLOSED_LIST): string[] {
  const out: string[] = [];
  for (const f of found) if (!(f in list)) out.push(`NOT ON THE LIST: authenticated can execute ${f}, and nothing names why`);
  for (const f of Object.keys(list)) if (!found.includes(f)) out.push(`STALE ENTRY: ${f} is listed and authenticated cannot execute it`);
  return out;
}

describe('the authenticated-executable surface', () => {
  test('the derived list names exactly the functions the migrations grant — the nine held as a literal until 2026-09-24, as restated by 021', () => {
    // 021: operator_list_facilities restated as operator_register (a return type cannot
    // change in place), plus operator_record_contact, operator_record_agreement and
    // operator_get_contact.
    expect(Object.keys(CLOSED_LIST).sort()).toEqual([
      'graphql_public.graphql',
      'public.my_facility_wards',
      'public.operator_add_category',
      'public.operator_create_facility',
      'public.operator_edit_facility',
      'public.operator_get_contact',
      'public.operator_record_agreement',
      'public.operator_record_contact',
      'public.operator_register',
      'public.operator_set_facility_listed',
      'public.publish_ward_status',
      'public.ward_status_history',
    ]);
  });

  test('real catalogue is accepted — exactly the named list, by identity', async () => {
    expect(closedListViolations(await executable())).toEqual([]);
  });

  test('anti-vacuity — an empty catalogue reading is rejected, not passed', () => {
    expect(closedListViolations([]).length).toBe(Object.keys(CLOSED_LIST).length);
  });

  test('plant — a function granted to authenticated and named nowhere is rejected', async () => {
    const found = await withRole('postgres', null, async (tx) => {
      await tx.unsafe('create function public.zz_planted_grant() returns int language sql as $$ select 1 $$');
      await tx.unsafe('grant execute on function public.zz_planted_grant() to authenticated');
      return executable(tx as never);
    });
    expect(closedListViolations(found)).toEqual(['NOT ON THE LIST: authenticated can execute public.zz_planted_grant, and nothing names why']);
  });

  test('plant — an entry for a function that no longer exists is rejected as stale', async () => {
    const found = await executable();
    expect(closedListViolations(found, { ...CLOSED_LIST, 'public.retired_rpc': 'planted' })).toEqual([
      'STALE ENTRY: public.retired_rpc is listed and authenticated cannot execute it',
    ]);
  });
});
