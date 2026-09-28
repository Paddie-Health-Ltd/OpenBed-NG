import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * MIGRATION 026 REVERSES TO EXACTLY THE 025 STATE AND RE-APPLIES TO EXACTLY ITS OWN
 * (R-2026-09-27-144 DT), in the idiom of tests/db/migration_024_round_trip.test.ts.
 *
 * The state compared, by value:
 *   - the bodies of the seven functions 026 replaces, and of the two it creates:
 *     026's text, and after the down the text of the file that last wrote each
 *     (011, 014, 021, 022, 023, 024), or absence;
 *   - the rename (R-2026-09-27-145 DU-1): my_reporting_wards() exists in 026 and not
 *     in 025, my_facility_wards() the other way round, each with EXECUTE to
 *     authenticated only where it exists, and my_reporting_wards() ends in can_publish;
 *   - the definitions of the two scope CHECKs, the erasure CHECK, the email and
 *     HEFAMAA CHECKs, the reporter's index and the trigger;
 *   - the hefamaa_reg_no column;
 *   - the ledger row.
 *
 * FIVE OF 026's BODIES ARE THEIR SOURCE'S TEXT WITH NAMED EDITS, asserted here as
 * exact replacements, so no other line of those functions can move under cover of
 * 026: app.assert_member (011), public.publish_ward_status (014),
 * public.operator_record_contact (021), public.operator_register (023) and
 * app.provision_complete (024). app.provision_begin and my_reporting_wards() are
 * rewritten, and are compared as whole bodies.
 *
 * THE DOWN REFUSES while data depends on 026: a row holding FACILITY_REPORTER, a
 * reporter's erasure audit row, or a recorded HEFAMAA number.
 *
 * EVERY LEG RUNS INSIDE ONE ROLLED-BACK TRANSACTION. Every migration above 026 is
 * reversed first, newest first.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const LEDGER = '026_facility_reporter_and_checks.sql';
const FORWARD = join(MIG_DIR, LEDGER);
const DOWN = join(MIG_DIR, '026_facility_reporter_and_checks.down.sql');

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
  const m = new RegExp(`^CREATE (?:OR REPLACE )?FUNCTION ${fn.replace('.', '\\.')}\\([\\s\\S]*?AS \\$FN\\$([\\s\\S]*?)^\\$FN\\$;$`, 'm').exec(text);
  if (m === null) throw new Error(`no body for ${fn} in ${file}`);
  return m[1] ?? '';
}

/** Each function 026 touches: [name, the file that wrote it at 025 (null: absent), whether it exists at 026]. */
const FUNCTIONS: Record<string, readonly [string, string | null, boolean?]> = {
  'app.assert_member(uuid, app.app_role)': ['app.assert_member', '011_read_rpcs_capped.sql'],
  'public.my_facility_wards()': ['public.my_facility_wards', '011_read_rpcs_capped.sql', false],
  'public.my_reporting_wards()': ['public.my_reporting_wards', null],
  'public.publish_ward_status(text, text, integer, boolean, text, integer, text, timestamptz)': ['public.publish_ward_status', '014_publish_ward_status.sql'],
  'public.operator_record_contact(text, text, text, text, text, boolean, integer)': ['public.operator_record_contact', '021_facility_agreement_and_contact_write.sql'],
  'app.provision_begin(uuid, text, text)': ['app.provision_begin', '022_one_operator_and_reactivation.sql'],
  'public.operator_register()': ['public.operator_register', '023_operator_register_location_and_phone.sql'],
  'app.provision_complete(uuid, uuid)': ['app.provision_complete', '024_retention_jobs.sql'],
  'public.operator_record_registration(text, integer, text)': ['public.operator_record_registration', null],
  'app.enforce_one_reporting_source()': ['app.enforce_one_reporting_source', null],
};
const RENAMED = ['public.my_facility_wards()', 'public.my_reporting_wards()'] as const;

const CONSTRAINTS = [
  'audit_log_login_erase_ward_only',
  'facility_contact_email_form',
  'facility_hefamaa_reg_no_form',
  'invite_scope_matches_role',
  'ward_account_scope_matches_role',
];

interface State {
  bodies: Record<string, string | null>;
  reportingColumns: string | null;
  grants: Record<string, string[] | null>;
  constraints: Record<string, string | null>;
  index: string | null;
  trigger: string | null;
  column: number;
  ledger: number;
}

async function state(tx: TransactionSql): Promise<State> {
  const bodies: State['bodies'] = {};
  for (const sig of Object.keys(FUNCTIONS)) {
    const [r] = await tx.unsafe<{ src: string | null }[]>('select (select prosrc from pg_proc where oid = to_regprocedure($1)) as src', [sig] as never[]);
    bodies[sig] = r?.src ?? null;
  }
  const [cols] = await tx.unsafe<{ c: string | null }[]>(`select pg_get_function_result(to_regprocedure('public.my_reporting_wards()')) as c`);
  const grants: State['grants'] = {};
  for (const f of RENAMED) {
    const [g] = await tx.unsafe<{ r: string[] | null }[]>(`
      select case when to_regprocedure($1) is null then null else
             array(select r from unnest(array['anon', 'authenticated', 'service_role']) r
                    where has_function_privilege(r, to_regprocedure($1), 'EXECUTE') order by r) end as r`, [f] as never[]);
    grants[f] = g?.r ?? null;
  }
  const constraints: State['constraints'] = {};
  for (const c of CONSTRAINTS) {
    const [r] = await tx.unsafe<{ d: string | null }[]>('select (select pg_get_constraintdef(oid) from pg_constraint where conname = $1) as d', [c] as never[]);
    constraints[c] = r?.d ?? null;
  }
  const [ix] = await tx.unsafe<{ d: string | null }[]>(`select (select indexdef from pg_indexes where schemaname = 'app' and indexname = 'ward_account_one_active_reporter') as d`);
  const [tg] = await tx.unsafe<{ d: string | null }[]>(`select (select pg_get_triggerdef(oid) from pg_trigger where tgname = 'trg_ward_account_one_reporting_source') as d`);
  const [col] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from information_schema.columns where table_schema = 'app' and table_name = 'facility' and column_name = 'hefamaa_reg_no'`);
  const [l] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.schema_migrations where filename = $1', [LEDGER] as never[]);
  return {
    bodies,
    reportingColumns: cols?.c ?? null,
    grants,
    constraints,
    index: ix?.d ?? null,
    trigger: tg?.d ?? null,
    column: col?.n ?? -1,
    ledger: l?.n ?? -1,
  };
}

const bodies026 = Object.fromEntries(Object.entries(FUNCTIONS).map(([sig, [fn, , in026]]) => [sig, in026 === false ? null : bodyFrom(LEDGER, fn)]));
const bodies025 = Object.fromEntries(Object.entries(FUNCTIONS).map(([sig, [fn, file]]) => [sig, file === null ? null : bodyFrom(file, fn)]));

const REPORTER_ARM = "(role = 'FACILITY_REPORTER'::app.app_role) AND (facility_id IS NOT NULL) AND (ward_category IS NULL)";

/** The edits 026 makes to each body it takes from an earlier file: [from, to] pairs, each matching once. */
const EDITS: Record<string, [string, string][]> = {
  'app.assert_member(uuid, app.app_role)': [[
    "(p_required = 'WARD_STAFF' AND v_role = 'FACILITY_ADMIN')",
    "(p_required = 'WARD_STAFF' AND v_role IN ('FACILITY_ADMIN', 'FACILITY_REPORTER'))",
  ]],
  'public.publish_ward_status(text, text, integer, boolean, text, integer, text, timestamptz)': [
    ["IF v_role IS DISTINCT FROM 'WARD_STAFF' THEN", "IF v_role IS DISTINCT FROM 'WARD_STAFF' AND v_role IS DISTINCT FROM 'FACILITY_REPORTER' THEN"],
    ["'publish_ward_status is ward staff only; admin publish is Stage 2'", "'publish_ward_status is ward staff or the facility reporter only; admin publish is Stage 2'"],
    ['IF v_ward_category IS DISTINCT FROM v_category THEN', "IF v_role = 'WARD_STAFF' AND v_ward_category IS DISTINCT FROM v_category THEN"],
  ],
  'public.operator_record_contact(text, text, text, text, text, boolean, integer)': [[
    "        RAISE EXCEPTION 'NO_CONTACT_CHANNEL';\n    END IF;\n",
    "        RAISE EXCEPTION 'NO_CONTACT_CHANNEL';\n    END IF;\n" +
      "    IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' THEN\n" +
      "        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_email';\n    END IF;\n",
  ]],
  'app.provision_complete(uuid, uuid)': [],
  'public.operator_register()': [],
};

/** Strips `--` comment lines and blank lines: the edits' comments are not their substance. */
const code = (body: string): string => body.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('--')).join('\n');

describe('migration 026 round trip', () => {
  test('the database starts in the 026 state, and the two states discriminate', async () => {
    for (const sig of Object.keys(FUNCTIONS)) expect(bodies025[sig], `${sig} is the same in both states`).not.toBe(bodies026[sig]);
    const s = await inTx(state);
    expect(s.bodies).toEqual(bodies026);
    expect(s.reportingColumns).toMatch(/^TABLE\(category app\.ward_category, .*, can_publish boolean\)$/);
    expect(s.grants).toEqual({ 'public.my_facility_wards()': null, 'public.my_reporting_wards()': ['authenticated'] });
    expect(s.constraints.ward_account_scope_matches_role).toContain(REPORTER_ARM);
    expect(s.constraints.invite_scope_matches_role).toContain(REPORTER_ARM);
    expect(s.constraints.audit_log_login_erase_ward_only).toContain("'FACILITY_REPORTER'");
    expect(s.constraints.facility_contact_email_form).not.toBeNull();
    expect(s.constraints.facility_hefamaa_reg_no_form).not.toBeNull();
    expect(s.index).toBe("CREATE UNIQUE INDEX ward_account_one_active_reporter ON app.ward_account USING btree (facility_id) WHERE ((role = 'FACILITY_REPORTER'::app.app_role) AND is_active)");
    expect(s.trigger).toBe('CREATE TRIGGER trg_ward_account_one_reporting_source BEFORE INSERT OR UPDATE OF role, facility_id, is_active ON app.ward_account FOR EACH ROW EXECUTE FUNCTION app.enforce_one_reporting_source()');
    expect(s.column).toBe(1);
    expect(s.ledger).toBe(1);
  });

  test.each(Object.keys(EDITS).filter((sig) => EDITS[sig]!.length > 0))("026's %s is its source's body with exactly the named edits, and nothing else", (sig) => {
    let expected = code(bodies025[sig] ?? '');
    for (const [from, to] of EDITS[sig]!) {
      const f = code(from);
      expect(expected.split(f).length - 1, `the edit's anchor is not in the source body exactly once: ${from}`).toBe(1);
      expected = expected.replace(f, () => code(to));
    }
    expect(code(bodies026[sig] ?? '')).toBe(expected);
  });

  test("026's provision_complete is 024's with the reporter's index named in both unique-violation handlers, and nothing else", () => {
    const src = code(bodies025['app.provision_complete(uuid, uuid)'] ?? '');
    const out = code(bodies026['app.provision_complete(uuid, uuid)'] ?? '');
    const handler = [
      "ELSIF v_constraint = 'ward_account_one_active_reporter' THEN",
      "RAISE EXCEPTION 'REPORTER_ALREADY_EXISTS'",
      "USING DETAIL = 'deactivate the facility''s current reporting login before provisioning another';",
    ];
    expect(out.split('\n').filter((l) => !src.split('\n').includes(l)).map((l) => l.trim())).toEqual([...handler, ...handler]);
    expect(src.split('\n').filter((l) => !out.split('\n').includes(l)), 'a line of 024\'s body was removed').toEqual([]);
  });

  test("026's operator_register is 023's with only lines added, and every changed line names the reporter, the HEFAMAA number or the retention alert", () => {
    const src = code(bodies025['public.operator_register()'] ?? '').split('\n');
    const out = code(bodies026['public.operator_register()'] ?? '').split('\n');
    const removed = src.filter((l) => !out.includes(l));
    // The per-category has_account / provisioning_incomplete predicates are rewritten:
    // these are the only lines of 023's body allowed to go.
    expect(removed.map((l) => l.trim())).toEqual([
      'WHERE u.facility_id = f.id AND u.ward_category = ws.category',
      "AND u.role = 'WARD_STAFF' AND u.is_active),",
      'WHERE i.facility_id = f.id AND i.ward_category = ws.category',
      "AND i.role = 'WARD_STAFF' AND i.accepted_at IS NULL)",
      'WHERE u.facility_id = f.id AND u.ward_category = ws.category',
      "AND u.role = 'WARD_STAFF' AND u.is_active)",
    ]);
    const joined = out.join('\n');
    for (const key of ["'retention_alert'", "'hefamaa_reg_no', f.hefamaa_reg_no", "'reporting_model'", "'reporter_login'"]) {
      expect(joined, `026's register does not carry ${key}`).toContain(key);
    }
  });

  test('down restores EXACTLY the 025 state — every body its source\'s, 011\'s my_facility_wards with its grant, 003\'s and 024\'s CHECKs, no index, trigger, column or ledger row', async () => {
    const s = await inTx(async (tx) => {
      await apply(tx, DOWN);
      return state(tx);
    });
    expect(s.bodies).toEqual(bodies025);
    expect(s.reportingColumns).toBeNull();
    expect(s.grants).toEqual({ 'public.my_facility_wards()': ['authenticated'], 'public.my_reporting_wards()': null });
    expect(s.constraints.ward_account_scope_matches_role).not.toContain('FACILITY_REPORTER');
    expect(s.constraints.invite_scope_matches_role).not.toContain('FACILITY_REPORTER');
    expect(s.constraints.audit_log_login_erase_ward_only).not.toContain('FACILITY_REPORTER');
    expect(s.constraints.facility_contact_email_form).toBeNull();
    expect(s.constraints.facility_hefamaa_reg_no_form).toBeNull();
    expect({ index: s.index, trigger: s.trigger, column: s.column, ledger: s.ledger }).toEqual({ index: null, trigger: null, column: 0, ledger: 0 });
  });

  test('up after down restores EXACTLY the 026 state — idempotent over 025 and over itself', async () => {
    const [before, after] = await inTx(async (tx) => {
      const b = await state(tx);
      await apply(tx, DOWN);
      await apply(tx, FORWARD);
      await apply(tx, FORWARD);
      return [b, await state(tx)];
    });
    expect(after).toEqual(before);
  });

  test.each<[string, string, string]>([
    ['a row holds FACILITY_REPORTER', 'REPORTER_ROWS_EXIST',
      `insert into app.ward_account (id, facility_id, role) values (gen_random_uuid(), $1, 'FACILITY_REPORTER')`],
    ["a reporter's erasure audit row exists", 'REPORTER_ERASURES_EXIST',
      `insert into app.audit_log (facility_id, action, new_value) values ($1, 'ward_account.login_erase', '{"role":"FACILITY_REPORTER"}'::jsonb)`],
    ['a HEFAMAA number is recorded', 'HEFAMAA_NUMBERS_RECORDED',
      `update app.facility set hefamaa_reg_no = 'LSHEFAMAA/0137' where id = $1`],
  ])('the down REFUSES while %s, and changes nothing', async (_what, code, plant) => {
    const r = await inTx(async (tx) => {
      const before = await state(tx);
      const [f] = await tx.unsafe<{ id: string }[]>(`
        select f.id::text as id from app.facility f
         where not exists (select 1 from app.ward_account u where u.facility_id = f.id and u.is_active)
         order by 1 limit 1`);
      if (f === undefined) throw new Error('precondition: no seeded facility without an active login -- run db:reset');
      const planted = await tx.unsafe(plant, [f.id] as never[]);
      if (planted.count !== 1) throw new Error(`the plant did not land: ${plant}`);
      await tx.unsafe('savepoint before_down');
      let message = '';
      try {
        await apply(tx, DOWN);
      } catch (e) {
        message = (e as { message: string }).message;
      }
      await tx.unsafe('rollback to savepoint before_down');
      return { message, before, after: await state(tx) };
    });
    expect(r.message).toBe(code);
    expect(r.after).toEqual(r.before);
  });
});
