import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * MIGRATION 029 REVERSES TO EXACTLY THE 028 STATE AND RE-APPLIES TO EXACTLY ITS OWN
 * (R-2026-09-30-201 GA; ruling FX P2), in the idiom of tests/db/migration_026_round_trip.test.ts.
 *
 * The state compared, by value:
 *   - the bodies of the two functions 029 restates (app.provision_begin and
 *     public.operator_register: 029's text, and after the down 026's, which is the file
 *     that last wrote each) and of the one it creates;
 *   - the EXECUTE grants of all three: the new function to authenticated alone, and
 *     provision_begin to its owner alone, as before;
 *   - the table, the enum's labels, the two CHECKs, the latest-approval index and the two
 *     triggers, each by its definition and its enabled state ('A', ENABLE ALWAYS);
 *   - the ledger row.
 *
 * BOTH RESTATED BODIES ARE 026's TEXT WITH NAMED EDITS, asserted as exact replacements, so no
 * other line of either function can move under cover of 029.
 *
 * THE DOWN REFUSES while any approval exists (REPORTING_APPROVALS_RECORDED), and changes
 * nothing when it does.
 *
 * THREE PLANTS, each a false-green the controls above must see, and each confirmed to have
 * mutated the artefact before the conclusion is drawn (test-conventions section 8):
 *   - a trigger that exists without ENABLE ALWAYS;
 *   - the gate placed BEFORE the "already active" exit, which would refuse a login that
 *     already exists;
 *   - the register comparing against the EARLIEST approval and not the latest.
 *
 * EVERY LEG RUNS INSIDE ONE ROLLED-BACK TRANSACTION. Every migration above 029 is reversed
 * first, newest first (030 today).
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const LEDGER = '029_facility_reporting_approval.sql';
const FORWARD = join(MIG_DIR, LEDGER);
const DOWN = join(MIG_DIR, '029_facility_reporting_approval.down.sql');
const PRIOR = '026_facility_reporter_and_checks.sql';

async function apply(tx: TransactionSql, path: string, text?: string): Promise<void> {
  await tx.unsafe(text ?? readFileSync(path, 'utf8'));
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

const PB = 'app.provision_begin(uuid, text, text)';
const REG = 'public.operator_register()';
const OPW = 'public.operator_record_reporting_approval(text, text, date, text)';
const FUNCTIONS: Record<string, readonly [string, string | null]> = {
  [PB]: ['app.provision_begin', PRIOR],
  [REG]: ['public.operator_register', PRIOR],
  [OPW]: ['public.operator_record_reporting_approval', null],
};

const TRIGGERS = ['trg_facility_reporting_approval_append_only', 'trg_facility_reporting_approval_no_truncate'];
const CONSTRAINTS = ['reporting_approval_role_is_short', 'reporting_approval_version_is_a_label'];

interface State {
  bodies: Record<string, string | null>;
  grants: Record<string, string[] | null>;
  table: string | null;
  enumLabels: string | null;
  triggers: Record<string, string | null>;
  constraints: Record<string, string | null>;
  index: string | null;
  ledger: number;
}

async function state(tx: TransactionSql): Promise<State> {
  const bodies: State['bodies'] = {};
  const grants: State['grants'] = {};
  for (const sig of Object.keys(FUNCTIONS)) {
    const [r] = await tx.unsafe<{ src: string | null }[]>('select (select prosrc from pg_proc where oid = to_regprocedure($1)) as src', [sig] as never[]);
    bodies[sig] = r?.src ?? null;
    const [g] = await tx.unsafe<{ r: string[] | null }[]>(
      `select case when to_regprocedure($1) is null then null else
              array(select r from unnest(array['anon', 'authenticated', 'service_role']) r
                     where has_function_privilege(r, to_regprocedure($1), 'EXECUTE') order by r) end as r`,
      [sig] as never[],
    );
    grants[sig] = g?.r ?? null;
  }
  const [t] = await tx.unsafe<{ t: string | null }[]>(`select to_regclass('app.facility_reporting_approval')::text as t`);
  const [e] = await tx.unsafe<{ l: string | null }[]>(
    `select case when to_regtype('app.reporting_model') is null then null
                else array(select enumlabel from pg_enum where enumtypid = to_regtype('app.reporting_model') order by enumsortorder)::text end as l`,
  );
  const triggers: State['triggers'] = {};
  for (const n of TRIGGERS) {
    const [r] = await tx.unsafe<{ d: string | null }[]>(
      `select (select tgenabled::text || ':' || pg_get_triggerdef(oid) from pg_trigger where tgname = $1) as d`, [n] as never[]);
    triggers[n] = r?.d ?? null;
  }
  const constraints: State['constraints'] = {};
  for (const c of CONSTRAINTS) {
    const [r] = await tx.unsafe<{ d: string | null }[]>('select (select pg_get_constraintdef(oid) from pg_constraint where conname = $1) as d', [c] as never[]);
    constraints[c] = r?.d ?? null;
  }
  const [ix] = await tx.unsafe<{ d: string | null }[]>(`select (select indexdef from pg_indexes where schemaname = 'app' and indexname = 'reporting_approval_latest') as d`);
  const [l] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.schema_migrations where filename = $1', [LEDGER] as never[]);
  return { bodies, grants, table: t?.t ?? null, enumLabels: e?.l ?? null, triggers, constraints, index: ix?.d ?? null, ledger: l?.n ?? -1 };
}

const bodies029 = Object.fromEntries(Object.entries(FUNCTIONS).map(([sig, [fn]]) => [sig, bodyFrom(LEDGER, fn)]));
const bodies026 = Object.fromEntries(Object.entries(FUNCTIONS).map(([sig, [fn, file]]) => [sig, file === null ? null : bodyFrom(file, fn)]));

/** Strips `--` comment lines and blank lines: the edits' comments are not their substance. */
const code = (body: string): string => body.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('--')).join('\n');

const GATE = (kind: 'WARD' | 'FACILITY', login: string): string => `        SELECT r.model INTO v_approved
          FROM app.facility_reporting_approval r
         WHERE r.facility_id = p_facility
         ORDER BY r.id DESC
         LIMIT 1;
        IF v_approved IS NULL THEN
            RAISE EXCEPTION 'REPORTING_MODEL_NOT_APPROVED'
                  USING DETAIL = 'no reporting model is approved for this facility';
        ELSIF v_approved IS DISTINCT FROM '${kind}' THEN
            RAISE EXCEPTION 'REPORTING_MODEL_NOT_APPROVED'
                  USING DETAIL = format('the latest approval is %s reporting, and this login is ${login}', v_approved);
        END IF;
`;
const WARD_CONFLICT =
  "        IF EXISTS (SELECT 1 FROM app.ward_account u\n                    WHERE u.facility_id = p_facility AND u.role = 'FACILITY_REPORTER' AND u.is_active) THEN\n            RAISE EXCEPTION 'REPORTING_MODEL_CONFLICT'\n";
const REPORTER_CONFLICT =
  "        IF EXISTS (SELECT 1 FROM app.ward_account u\n                    WHERE u.facility_id = p_facility AND u.role = 'WARD_STAFF' AND u.is_active) THEN\n            RAISE EXCEPTION 'REPORTING_MODEL_CONFLICT'\n";

const REG_KEYS_OLD = `                       'reporting_model', CASE
                           WHEN EXISTS (SELECT 1 FROM app.ward_account u
                                         WHERE u.facility_id = f.id AND u.role = 'FACILITY_REPORTER' AND u.is_active) THEN 'FACILITY'
                           WHEN EXISTS (SELECT 1 FROM app.ward_account u
                                         WHERE u.facility_id = f.id AND u.role = 'WARD_STAFF' AND u.is_active) THEN 'WARD'
                           ELSE 'NONE' END,
`;
const REG_KEYS_NEW = `                       'reporting_model', dm.m,
                       'approved_model', ap.model,
                       'approved_on', ap.approved_on,
                       'reporting_approval_state', CASE
                           WHEN ap.model IS NULL AND dm.m = 'NONE' THEN NULL
                           WHEN ap.model IS NULL THEN 'APPROVAL_NOT_RECORDED'
                           WHEN dm.m = 'NONE' THEN 'NOT_YET_PROVISIONED'
                           WHEN ap.model::text = dm.m THEN 'MATCHES'
                           ELSE 'MISMATCH' END,
`;
const REG_FROM_OLD = "              FROM app.facility f\n        ), '[]'::jsonb));\n";
const REG_FROM_NEW = `              FROM app.facility f
              LEFT JOIN LATERAL (
                    SELECT r.model, r.approved_on
                      FROM app.facility_reporting_approval r
                     WHERE r.facility_id = f.id
                     ORDER BY r.id DESC
                     LIMIT 1) ap ON true
              CROSS JOIN LATERAL (
                    SELECT CASE
                        WHEN EXISTS (SELECT 1 FROM app.ward_account u
                                      WHERE u.facility_id = f.id AND u.role = 'FACILITY_REPORTER' AND u.is_active) THEN 'FACILITY'
                        WHEN EXISTS (SELECT 1 FROM app.ward_account u
                                      WHERE u.facility_id = f.id AND u.role = 'WARD_STAFF' AND u.is_active) THEN 'WARD'
                        ELSE 'NONE' END AS m) dm
        ), '[]'::jsonb));
`;

/** The edits 029 makes to each body it takes from 026: [from, to] pairs, each matching once. */
const EDITS: Record<string, [string, string][]> = {
  [PB]: [
    ['    v_invite   uuid;\nBEGIN\n', '    v_invite   uuid;\n    v_approved app.reporting_model;\nBEGIN\n'],
    [WARD_CONFLICT, GATE('WARD', 'a ward login') + WARD_CONFLICT],
    [REPORTER_CONFLICT, GATE('FACILITY', 'a facility-level login') + REPORTER_CONFLICT],
  ],
  [REG]: [
    [REG_KEYS_OLD, REG_KEYS_NEW],
    [REG_FROM_OLD, REG_FROM_NEW],
  ],
};

const OPERATOR = '0b000000-0000-4000-8000-0000000000c1';
const FAC = '0b000000-0000-4000-8000-0000000000c2';

/** An operator, a facility with a contact, an agreement and a ward: what the gate and the register read. */
async function scene(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`insert into app.ward_account (id, role) values ('${OPERATOR}', 'PLATFORM_ADMIN')`);
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
    values ('${FAC}', 'Round Trip Facility', 'Yaba', 'Lagos', 6.51, 3.38, '+2348000000503', null)`);
  await tx.unsafe(`insert into app.ward_status (facility_id, category, offering) values ('${FAC}', 'ICU_ADULT', 'OFFERED')`);
  await tx.unsafe(`insert into app.facility_contact (facility_id, full_name, job_title, email) values ('${FAC}', 'A Person', 'Matron', 'rt-contact@example.invalid')`);
  await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${FAC}', '2026-09-01', 'v1.0')`);
}
const asOperatorSession = (tx: TransactionSql): Promise<unknown> =>
  tx.unsafe(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: OPERATOR, role: 'authenticated', session_id: randomUUID() })}', true)`);
const registerState = async (tx: TransactionSql): Promise<unknown> => {
  await asOperatorSession(tx);
  const [r] = await tx.unsafe<{ r: { facilities: Record<string, unknown>[] } }[]>(`select public.operator_register() as r`);
  return r?.r.facilities.find((f) => f['facility_id'] === FAC)?.['reporting_approval_state'];
};
const beginWard = async (tx: TransactionSql): Promise<string> => {
  const [r] = await tx.unsafe<{ status: string }[]>(`select * from app.provision_begin('${FAC}', 'ICU_ADULT', 'WARD_STAFF')`);
  return r?.status ?? '(no row)';
};

/** Replaces `from` with `to` exactly once, and says so if the plant did not land. */
function mutate(text: string, from: string, to: string): string {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`the plant did not land: its anchor occurs ${n} times, not once: ${from.slice(0, 80)}`);
  const out = text.replace(from, () => to);
  if (out === text) throw new Error('the plant changed nothing');
  return out;
}

describe('migration 029 round trip', () => {
  test('the database starts in the 029 state, and the two states discriminate', async () => {
    // 030 (R-2026-09-30-205 GE) is the one migration above 029: it touches 010's two tables and
    // none of 029's objects, and inTx reverses it first. Pinned by name, so a further migration
    // above 029 reds this and its effect on 029's state is re-read, as the empty list did.
    expect(LATER, 'the set of migrations above 029 changed: this file reverses them first, and its own state expectations must be re-read').toEqual([
      '030_truncate_guard_audit_tables.sql',
    ]);
    for (const sig of Object.keys(FUNCTIONS)) expect(bodies026[sig], `${sig} is the same in both states`).not.toBe(bodies029[sig]);
    const s = await inTx(state);
    expect(s.bodies).toEqual(bodies029);
    expect(s.grants).toEqual({ [PB]: [], [REG]: ['authenticated'], [OPW]: ['authenticated'] });
    expect(s.table).toBe('app.facility_reporting_approval');
    expect(s.enumLabels).toBe('{FACILITY,WARD}');
    expect(s.triggers).toEqual({
      trg_facility_reporting_approval_append_only:
        'A:CREATE TRIGGER trg_facility_reporting_approval_append_only BEFORE DELETE OR UPDATE ON app.facility_reporting_approval FOR EACH ROW EXECUTE FUNCTION app.raise_append_only()',
      trg_facility_reporting_approval_no_truncate:
        'A:CREATE TRIGGER trg_facility_reporting_approval_no_truncate BEFORE TRUNCATE ON app.facility_reporting_approval FOR EACH STATEMENT EXECUTE FUNCTION app.raise_append_only()',
    });
    expect(s.constraints).toEqual({
      reporting_approval_role_is_short: 'CHECK (((approved_by_role IS NULL) OR ((length(approved_by_role) >= 1) AND (length(approved_by_role) <= 64))))',
      reporting_approval_version_is_a_label: "CHECK ((agreement_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'::text))",
    });
    expect(s.index).toBe('CREATE INDEX reporting_approval_latest ON app.facility_reporting_approval USING btree (facility_id, id DESC)');
    expect(s.ledger).toBe(1);
  });

  test.each(Object.keys(EDITS))("029's %s is 026's body with exactly the named edits, and nothing else", (sig) => {
    let expected = code(bodies026[sig] ?? '');
    for (const [from, to] of EDITS[sig]!) {
      const f = code(from);
      expect(expected.split(f).length - 1, `the edit's anchor is not in 026's body exactly once: ${from}`).toBe(1);
      expected = expected.replace(f, () => code(to));
    }
    expect(code(bodies029[sig] ?? '')).toBe(expected);
  });

  test("029's provision_begin keeps 026's signature, return shape and security: only the body moved", async () => {
    const meta = async (tx: TransactionSql) => {
      const [m] = await tx.unsafe<{ r: string; secdef: boolean; cfg: string[] | null }[]>(
        `select pg_get_function_result(oid) as r, prosecdef as secdef, proconfig as cfg from pg_proc where oid = to_regprocedure('${PB}')`);
      return m;
    };
    const [after, before] = await inTx(async (tx) => {
      const a = await meta(tx);
      await apply(tx, DOWN);
      return [a, await meta(tx)];
    });
    expect(after).toEqual(before);
    expect(after?.r).toBe('TABLE(status text, invite_id uuid)');
  });

  test("down restores EXACTLY the 028 state — 026's two bodies, no table, enum, trigger, index or ledger row", async () => {
    const s = await inTx(async (tx) => {
      await apply(tx, DOWN);
      return state(tx);
    });
    expect(s.bodies).toEqual(bodies026);
    expect(s.grants).toEqual({ [PB]: [], [REG]: ['authenticated'], [OPW]: null });
    expect(s).toMatchObject({
      table: null,
      enumLabels: null,
      triggers: { trg_facility_reporting_approval_append_only: null, trg_facility_reporting_approval_no_truncate: null },
      constraints: { reporting_approval_role_is_short: null, reporting_approval_version_is_a_label: null },
      index: null,
      ledger: 0,
    });
  });

  test('down twice is a no-op, and up after down restores EXACTLY the 029 state — idempotent over 028 and over itself', async () => {
    const [start, twice, back, again] = await inTx(async (tx) => {
      const a = await state(tx);
      await apply(tx, DOWN);
      await apply(tx, DOWN);
      const b = await state(tx);
      await apply(tx, FORWARD);
      const c = await state(tx);
      await apply(tx, FORWARD);
      return [a, b, c, await state(tx)];
    });
    expect(twice.bodies).toEqual(bodies026);
    expect(twice.table).toBeNull();
    expect(back).toEqual(start);
    expect(again, 'a second application changed the 029 state').toEqual(start);
  });

  test('re-applying the forward migration inserts no row, and the down refuses nothing while the table is empty', async () => {
    const n = await inTx(async (tx) => {
      await apply(tx, FORWARD);
      const [c] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.facility_reporting_approval');
      return c?.n;
    });
    expect(n).toBe(0);
  });

  test('the down REFUSES while an approval is recorded, with REPORTING_APPROVALS_RECORDED, and changes nothing', async () => {
    const r = await inTx(async (tx) => {
      await scene(tx);
      await tx.unsafe(`insert into app.facility_reporting_approval (facility_id, model, approved_on, agreement_version) values ('${FAC}', 'WARD', '2026-09-15', 'v1.0')`);
      const before = await state(tx);
      let message = '';
      let detail = '';
      try {
        await tx.savepoint((sp) => apply(sp, DOWN));
      } catch (e) {
        message = (e as { message: string }).message;
        detail = (e as { detail?: string }).detail ?? '';
      }
      return { message, detail, same: JSON.stringify(await state(tx)) === JSON.stringify(before) };
    });
    expect(r.message).toBe('REPORTING_APPROVALS_RECORDED');
    expect(r.detail).toContain('1 app.facility_reporting_approval row(s) exist');
    expect(r.same, 'a refused down changed the schema').toBe(true);
  });

  describe('plants — each false-green is mutated in, confirmed mutated, and seen', () => {
    test('plant — a trigger that exists without ENABLE ALWAYS reads O, not A, so the state check would red', async () => {
      const forward = readFileSync(FORWARD, 'utf8');
      const planted = mutate(
        forward,
        "    EXECUTE 'ALTER TABLE app.facility_reporting_approval ENABLE ALWAYS TRIGGER trg_facility_reporting_approval_no_truncate';\n",
        '',
      );
      const seen = await inTx(async (tx) => {
        await tx.unsafe('alter table app.facility_reporting_approval enable trigger trg_facility_reporting_approval_no_truncate');
        await apply(tx, FORWARD, planted);
        const withPlant = (await state(tx)).triggers['trg_facility_reporting_approval_no_truncate'];
        await apply(tx, FORWARD);
        return { withPlant, restored: (await state(tx)).triggers['trg_facility_reporting_approval_no_truncate'] };
      });
      expect(seen.withPlant?.startsWith('O:'), 'the planted migration left the trigger ENABLE ALWAYS: the plant did not take effect').toBe(true);
      expect(seen.restored?.startsWith('A:'), 'the real migration did not restore ENABLE ALWAYS').toBe(true);
    });

    test('plant — the gate placed BEFORE the "already active" exit refuses a login that already exists; the real one returns complete', async () => {
      const forward = readFileSync(FORWARD, 'utf8');
      const start = forward.indexOf("        -- 029 (GA; ruling FX P2, the founder's decision 2): the LATEST approval decides which");
      const endMarker = forward.indexOf("ELSIF v_approved IS DISTINCT FROM 'WARD'", start);
      const end = forward.indexOf('        END IF;\n', endMarker) + '        END IF;\n'.length;
      const j4 = forward.indexOf('        -- J4: a ward that already has its account is complete.');
      expect(start, 'the ward gate was not found').toBeGreaterThan(0);
      expect(j4, 'the J4 exit was not found').toBeGreaterThan(0);
      expect(j4, 'the gate is already before the J4 exit: the real migration has the wrong order').toBeLessThan(start);
      const block = forward.slice(start, end);
      const planted = forward.slice(0, j4) + block + forward.slice(j4, start) + forward.slice(end);
      expect(planted.length, 'the plant changed the length: it moved nothing, or it duplicated').toBe(forward.length);
      expect(planted).not.toBe(forward);

      const seen = await inTx(async (tx) => {
        await scene(tx);
        await tx.unsafe(`insert into app.ward_account (id, facility_id, ward_category, role) values ('${randomUUID()}', '${FAC}', 'ICU_ADULT', 'WARD_STAFF')`);
        const real = await beginWard(tx);
        await apply(tx, FORWARD, planted);
        let plantedOutcome = '';
        try {
          await tx.savepoint((sp) => beginWard(sp));
          plantedOutcome = 'complete';
        } catch (e) {
          plantedOutcome = (e as { message: string }).message;
        }
        return { real, plantedOutcome };
      });
      expect(seen.real, 'the real gate did not return complete for an already-active login').toBe('complete');
      expect(seen.plantedOutcome, 'the misplaced gate was not seen by the already-active check').toBe('REPORTING_MODEL_NOT_APPROVED');
    });

    test('plant — a register that compares against the EARLIEST approval reads MATCHES where the real one reads MISMATCH', async () => {
      const forward = readFileSync(FORWARD, 'utf8');
      const planted = mutate(
        forward,
        '                     ORDER BY r.id DESC\n                     LIMIT 1) ap ON true',
        '                     ORDER BY r.id ASC\n                     LIMIT 1) ap ON true',
      );
      const seen = await inTx(async (tx) => {
        await scene(tx);
        await tx.unsafe(`insert into app.facility_reporting_approval (facility_id, model, approved_on, agreement_version) values ('${FAC}', 'WARD', '2026-09-15', 'v1.0')`);
        await tx.unsafe(`insert into app.facility_reporting_approval (facility_id, model, approved_on, agreement_version) values ('${FAC}', 'FACILITY', '2026-09-20', 'v1.0')`);
        await tx.unsafe(`insert into app.ward_account (id, facility_id, ward_category, role) values ('${randomUUID()}', '${FAC}', 'ICU_ADULT', 'WARD_STAFF')`);
        const real = await registerState(tx);
        await apply(tx, FORWARD, planted);
        return { real, plantedState: await registerState(tx) };
      });
      expect(seen.real, 'the real register did not compare against the latest approval').toBe('MISMATCH');
      expect(seen.plantedState, 'the earliest-approval plant was not seen').toBe('MATCHES');
    });

    test('plant — a down with its refusal weakened to a notice drops the table over a recorded approval; the real down refuses', async () => {
      const down = readFileSync(DOWN, 'utf8');
      const planted = mutate(down, "            RAISE EXCEPTION 'REPORTING_APPROVALS_RECORDED'", "            RAISE NOTICE 'REPORTING_APPROVALS_RECORDED'");
      const seen = await inTx(async (tx) => {
        await scene(tx);
        await tx.unsafe(`insert into app.facility_reporting_approval (facility_id, model, approved_on, agreement_version) values ('${FAC}', 'WARD', '2026-09-15', 'v1.0')`);
        let real = '';
        try {
          await tx.savepoint((sp) => apply(sp, DOWN));
        } catch (e) {
          real = (e as { message: string }).message;
        }
        await apply(tx, DOWN, planted);
        return { real, tableAfterPlant: (await state(tx)).table };
      });
      expect(seen.real).toBe('REPORTING_APPROVALS_RECORDED');
      expect(seen.tableAfterPlant, 'the weakened down did not drop the table: the plant did not take effect').toBeNull();
    });
  });
});
