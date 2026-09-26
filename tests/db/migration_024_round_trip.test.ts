import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * MIGRATION 024 REVERSES TO EXACTLY THE 023 STATE AND RE-APPLIES TO EXACTLY ITS OWN
 * (R-2026-09-26-136 DL-2 g, h), in the idiom of tests/db/migration_022_round_trip.test.ts.
 *
 * The state compared, by value:
 *   - app.provision_complete's body: 024's text, and 022's after the down;
 *   - whether each retention function exists, and its EXECUTE grants (owner only);
 *   - the login_erased_at column and the two CHECKs;
 *   - the two job names in cron.job;
 *   - app.facility_contact's comment: G1's, and 003's verbatim after the down;
 *   - the ledger row.
 *
 * 024's provision_complete is 022's with exactly one block inserted after `IF FOUND
 * THEN`, asserted as an exact replace, so no other line of the provisioning gate can
 * move under cover of this one.
 *
 * THE DOWN REFUSES WHILE A LOGIN IS MARKED ERASED, like 022's OPERATOR_INDEX_IN_USE:
 * the column and its CHECK are then the only guard against reactivating one.
 *
 * EVERY LEG RUNS INSIDE ONE ROLLED-BACK TRANSACTION. Every migration above 024 is
 * reversed first, newest first.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const LEDGER = '024_retention_jobs.sql';
const FORWARD = join(MIG_DIR, LEDGER);
const DOWN = join(MIG_DIR, '024_retention_jobs.down.sql');
const F022 = '022_one_operator_and_reactivation.sql';
const F003 = '003_app_facility_and_identity_tables.sql';

async function apply(tx: TransactionSql, path: string): Promise<void> {
  await tx.unsafe(readFileSync(path, 'utf8'));
}

const LATER = readdirSync(MIG_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('.down.sql') && f > LEDGER).sort();

const inTx = <T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> =>
  withRole('postgres', null, async (tx) => {
    for (const f of LATER.slice().reverse()) await apply(tx, join(MIG_DIR, f.replace(/\.sql$/, '.down.sql')));
    return fn(tx);
  });

/** The body between `AS $FN$` and `$FN$;` of one function, as a file writes it. */
function bodyFrom(file: string, fn: string): string {
  const text = readFileSync(join(MIG_DIR, file), 'utf8');
  const m = new RegExp(`^CREATE OR REPLACE FUNCTION ${fn.replace('.', '\\.')}\\([\\s\\S]*?AS \\$FN\\$([\\s\\S]*?)^\\$FN\\$;$`, 'm').exec(text);
  if (m === null) throw new Error(`no body for ${fn} in ${file}`);
  return m[1] ?? '';
}

/** A COMMENT ON TABLE's text as Postgres stores it: the literals joined, '' unescaped. */
function commentFrom(file: string, table: string): string {
  const text = readFileSync(join(MIG_DIR, file), 'utf8');
  const m = new RegExp(`COMMENT ON TABLE ${table.replace('.', '\\.')} IS\\s*((?:'(?:[^']|'')*'\\s*)+);`).exec(text);
  if (m === null) throw new Error(`no comment on ${table} in ${file}`);
  return [...(m[1] ?? '').matchAll(/'((?:[^']|'')*)'/g)].map((x) => (x[1] ?? '').replace(/''/g, "'")).join('');
}

interface State {
  complete: string;
  functions: Record<string, { exists: boolean; anyone: boolean }>;
  column: number;
  checks: string[];
  jobs: string[];
  comment: string;
  ledger: number;
}

const FNS = ['app.erase_lapsed_ward_logins()', 'app.prune_ended_auth_sessions()'];
const JOBS = ['openbed_erase_lapsed_ward_logins', 'openbed_prune_ended_auth_sessions'];

async function state(tx: TransactionSql): Promise<State> {
  const [c] = await tx.unsafe<{ src: string }[]>(`select prosrc as src from pg_proc where oid = to_regprocedure('app.provision_complete(uuid, uuid)')`);
  const functions: State['functions'] = {};
  for (const f of FNS) {
    const [r] = await tx.unsafe<{ exists: boolean; anyone: boolean }[]>(`
      select to_regprocedure($1) is not null as exists,
             coalesce((select bool_or(has_function_privilege(r, to_regprocedure($1), 'EXECUTE'))
                         from unnest(array['anon', 'authenticated', 'service_role']) r), false) as anyone`, [f] as never[]);
    functions[f] = { exists: r?.exists ?? false, anyone: r?.anyone ?? true };
  }
  const [col] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from information_schema.columns where table_schema = 'app' and table_name = 'ward_account' and column_name = 'login_erased_at'`);
  const checks = await tx.unsafe<{ conname: string }[]>(`select conname from pg_constraint where conname in ('ward_account_erased_never_active', 'audit_log_login_erase_ward_only') order by conname`);
  const jobs = await tx.unsafe<{ jobname: string }[]>(`select jobname from cron.job where jobname = any($1) order by jobname`, [JOBS] as never[]);
  const [cm] = await tx.unsafe<{ c: string }[]>(`select obj_description('app.facility_contact'::regclass, 'pg_class') as c`);
  const [l] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.schema_migrations where filename = $1', [LEDGER] as never[]);
  return {
    complete: c?.src ?? '',
    functions,
    column: col?.n ?? -1,
    checks: checks.map((r) => r.conname),
    jobs: jobs.map((r) => r.jobname),
    comment: cm?.c ?? '',
    ledger: l?.n ?? -1,
  };
}

const STATE_024: State = {
  complete: bodyFrom(LEDGER, 'app.provision_complete'),
  functions: Object.fromEntries(FNS.map((f) => [f, { exists: true, anyone: false }])),
  column: 1,
  checks: ['audit_log_login_erase_ward_only', 'ward_account_erased_never_active'],
  jobs: JOBS,
  comment: commentFrom(LEDGER, 'app.facility_contact'),
  ledger: 1,
};
const STATE_023: State = {
  complete: bodyFrom(F022, 'app.provision_complete'),
  functions: Object.fromEntries(FNS.map((f) => [f, { exists: false, anyone: false }])),
  column: 0,
  checks: [],
  jobs: [],
  comment: commentFrom(F003, 'app.facility_contact'),
  ledger: 0,
};

/** DL-2 b's refusal, as 024 inserts it after `IF FOUND THEN` in 022's body. */
const FOUND = '    SELECT * INTO v_acct FROM app.ward_account u WHERE u.id = p_user_id;\n    IF FOUND THEN\n';

describe('migration 024 round trip', () => {
  test('the database starts in the 024 state, and the two states discriminate', async () => {
    expect(STATE_023.complete).not.toBe(STATE_024.complete);
    expect(STATE_023.comment).not.toBe(STATE_024.comment);
    expect(await inTx(state)).toEqual(STATE_024);
  });

  test("024's provision_complete is 022's with exactly one block inserted, and that block is the LOGIN_ERASED refusal", () => {
    expect(STATE_023.complete.split(FOUND).length - 1, "022's `IF FOUND THEN` is not in the body exactly once").toBe(1);
    const [head = '', tail = ''] = STATE_024.complete.split(FOUND);
    expect(STATE_023.complete.startsWith(head + FOUND), 'the body moved above the insertion').toBe(true);
    const rest = STATE_023.complete.slice((head + FOUND).length);
    expect(tail.endsWith(rest), 'the body moved below the insertion').toBe(true);
    const inserted = tail.slice(0, tail.length - rest.length);
    expect(inserted).toContain("RAISE EXCEPTION 'LOGIN_ERASED'");
    expect(inserted).toContain("HINT = 'provision a new login'");
  });

  test("down restores EXACTLY the 023 state — 022's body, 003's comment, no function, column, CHECK, job or ledger row", async () => {
    const s = await inTx(async (tx) => {
      await apply(tx, DOWN);
      return state(tx);
    });
    expect(s, 'the reversal did not land on 023 exactly').toEqual(STATE_023);
  });

  test('up after down restores EXACTLY the 024 state — idempotent over 023 and over itself', async () => {
    const s = await inTx(async (tx) => {
      await apply(tx, DOWN);
      await apply(tx, FORWARD);
      await apply(tx, FORWARD);
      return state(tx);
    });
    expect(s).toEqual(STATE_024);
  });

  test('the down REFUSES while a login is marked erased, and changes nothing', async () => {
    const r = await inTx(async (tx) => {
      const [w] = await tx.unsafe<{ facility: string; category: string }[]>(`
        select ws.facility_id::text as facility, ws.category::text as category from app.ward_status ws order by 1, 2 limit 1`);
      await tx.unsafe(`
        insert into app.ward_account (id, facility_id, ward_category, role, is_active, deactivated_at, login_erased_at)
        values (gen_random_uuid(), $1, $2::app.ward_category, 'WARD_STAFF', false, now() - interval '40 days', now())`, [w?.facility, w?.category] as never[]);
      await tx.unsafe('savepoint before_down');
      let message = '';
      try {
        await apply(tx, DOWN);
      } catch (e) {
        message = (e as { message: string }).message;
      }
      await tx.unsafe('rollback to savepoint before_down');
      return { message, after: await state(tx) };
    });
    expect(r.message).toBe('LOGINS_ERASED');
    expect(r.after).toEqual(STATE_024);
  });
});
