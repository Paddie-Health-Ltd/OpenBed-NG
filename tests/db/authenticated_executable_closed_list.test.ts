import { describe, expect, test } from 'vitest';
import { sql, withRole } from '../setup/db.js';

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

/** Each entry: schema.function, and why `authenticated` may run it. */
const CLOSED_LIST: Record<string, string> = {
  'graphql_public.graphql': 'Supabase-owned; the GraphQL entry point shipped with every project, not written here',
  'public.my_facility_wards': '011: a ward loads its own facility\'s wards',
  'public.publish_ward_status': '014: a ward publishes',
  'public.ward_status_history': '015: a ward reads its own history',
  'public.operator_add_category': '020: an operator adds a category (-71 E)',
  'public.operator_create_facility': '020: an operator creates a facility (-71 E)',
  'public.operator_edit_facility': '020: an operator edits a facility (-71 E, J1)',
  'public.operator_list_facilities': '020: the operator\'s list (AJ D8)',
  'public.operator_set_facility_listed': '020: an operator lists a facility (-71 B)',
};

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
