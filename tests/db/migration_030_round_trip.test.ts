import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * MIGRATION 030 REVERSES TO EXACTLY THE 029 STATE AND RE-APPLIES TO EXACTLY ITS OWN
 * (R-2026-09-30-205 GE), in the idiom of tests/db/migration_029_round_trip.test.ts.
 *
 * 030 adds one thing to each of 010's two tables: a statement-level BEFORE TRUNCATE trigger
 * calling app.raise_append_only(). It adds no function, no grant, no row and no column, and
 * this file asserts those absences too, because "nothing else" is a claim the migration's
 * header makes and a claim is not a control.
 *
 * The state compared, by value:
 *   - the two new triggers, each by its definition and its enabled state ('A', ENABLE ALWAYS);
 *   - 010's two row-level triggers, which must be exactly as they were;
 *   - the body of app.raise_append_only() (010's, unedited) and its EXECUTE grants;
 *   - the TRUNCATE, UPDATE and DELETE privileges of the client roles on both tables;
 *   - the row counts of both tables (030 inserts nothing);
 *   - the ledger row.
 *
 * FOUR PLANTS, each a false-green the controls above must see, and each confirmed to have
 * mutated the artefact before the conclusion is drawn (test-conventions section 8):
 *   - a trigger that exists without ENABLE ALWAYS;
 *   - a trigger on the wrong event (BEFORE UPDATE, not BEFORE TRUNCATE): the owner truncates;
 *   - a trigger created AFTER TRUNCATE. THIS ONE IS A SHAPE PLANT AND NOT A BEHAVIOURAL ONE,
 *     and the file says so because the first draft claimed otherwise: an AFTER trigger that
 *     raises also refuses (the exception rolls the statement back), which this file's own
 *     first run showed. BEFORE is still the requirement, because it refuses before any row is
 *     touched and matches 029; the shape read is what holds it, and the plant shows that read
 *     can fail;
 *   - the pg_trigger guard naming a trigger that already exists, so the CREATE is skipped.
 * A row-level TRUNCATE trigger is not planted: PostgreSQL refuses to create one, so the wrong
 * shape is unrepresentable, and the shape check below reads the bits that make it so.
 *
 * EVERY LEG RUNS INSIDE ONE ROLLED-BACK TRANSACTION. Every migration above 030 is reversed
 * first, newest first (none today).
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const LEDGER = '030_truncate_guard_audit_tables.sql';
const FORWARD = join(MIG_DIR, LEDGER);
const DOWN = join(MIG_DIR, '030_truncate_guard_audit_tables.down.sql');

const NEW_TRIGGERS: Record<string, string> = {
  trg_audit_log_no_truncate: 'app.audit_log',
  trg_ward_status_event_no_truncate: 'app.ward_status_event',
};
const OLD_TRIGGERS: Record<string, string> = {
  trg_audit_log_append_only: 'app.audit_log',
  trg_ward_status_event_append_only: 'app.ward_status_event',
};
const TABLES = ['app.audit_log', 'app.ward_status_event'] as const;

const LATER = readdirSync(MIG_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('.down.sql') && f > LEDGER).sort();

async function apply(tx: TransactionSql, path: string, text?: string): Promise<void> {
  await tx.unsafe(text ?? readFileSync(path, 'utf8'));
}

const inTx = <T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> =>
  withRole('postgres', null, async (tx) => {
    for (const f of LATER.slice().reverse()) await apply(tx, join(MIG_DIR, f.replace(/\.sql$/, '.down.sql')));
    return fn(tx);
  });

interface State {
  newTriggers: Record<string, string | null>;
  oldTriggers: Record<string, string | null>;
  functionBody: string | null;
  functionGrants: string[];
  clientPrivileges: Record<string, string[]>;
  rowCounts: Record<string, number>;
  ledger: number;
}

async function state(tx: TransactionSql): Promise<State> {
  const trig = async (name: string): Promise<string | null> => {
    const [r] = await tx.unsafe<{ d: string | null }[]>(
      `select (select tgenabled::text || ':' || pg_get_triggerdef(oid) from pg_trigger where tgname = $1) as d`,
      [name] as never[],
    );
    return r?.d ?? null;
  };
  const newTriggers: State['newTriggers'] = {};
  for (const n of Object.keys(NEW_TRIGGERS)) newTriggers[n] = await trig(n);
  const oldTriggers: State['oldTriggers'] = {};
  for (const n of Object.keys(OLD_TRIGGERS)) oldTriggers[n] = await trig(n);
  const [f] = await tx.unsafe<{ src: string | null }[]>(`select (select prosrc from pg_proc where oid = to_regprocedure('app.raise_append_only()')) as src`);
  const [g] = await tx.unsafe<{ r: string[] }[]>(
    `select array(select r from unnest(array['anon', 'authenticated', 'service_role']) r
                   where has_function_privilege(r, to_regprocedure('app.raise_append_only()'), 'EXECUTE') order by r) as r`,
  );
  const clientPrivileges: State['clientPrivileges'] = {};
  const rowCounts: State['rowCounts'] = {};
  for (const t of TABLES) {
    const [p] = await tx.unsafe<{ p: string[] }[]>(
      `select array(select r || ':' || priv
                      from unnest(array['anon', 'authenticated', 'service_role']) r,
                           unnest(array['INSERT', 'SELECT', 'UPDATE', 'DELETE', 'TRUNCATE']) priv
                     where has_table_privilege(r, '${t}', priv) order by 1) as p`,
    );
    clientPrivileges[t] = p?.p ?? [];
    const [c] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from ${t}`);
    rowCounts[t] = c?.n ?? -1;
  }
  const [l] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.schema_migrations where filename = $1', [LEDGER] as never[]);
  return {
    newTriggers,
    oldTriggers,
    functionBody: f?.src ?? null,
    functionGrants: g?.r ?? [],
    clientPrivileges,
    rowCounts,
    ledger: l?.n ?? -1,
  };
}

/** Replaces `from` with `to` exactly once, and says so if the plant did not land. */
function mutate(text: string, from: string, to: string): string {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`the plant did not land: its anchor occurs ${n} times, not once: ${from.slice(0, 80)}`);
  const out = text.replace(from, () => to);
  if (out === text) throw new Error('the plant changed nothing');
  return out;
}

const NEW_DEF = (name: string, table: string): string =>
  `A:CREATE TRIGGER ${name} BEFORE TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION app.raise_append_only()`;
const OLD_DEF = (name: string, table: string): string =>
  `A:CREATE TRIGGER ${name} BEFORE DELETE OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION app.raise_append_only()`;

describe('migration 030 round trip', () => {
  test('the database starts in the 030 state, and the two states discriminate', async () => {
    expect(LATER, 'a migration above 030 exists: this file reverses it first, and its own state expectations must be re-read').toEqual([]);
    const s = await inTx(state);
    expect(s.newTriggers).toEqual(Object.fromEntries(Object.entries(NEW_TRIGGERS).map(([n, t]) => [n, NEW_DEF(n, t)])));
    expect(s.oldTriggers).toEqual(Object.fromEntries(Object.entries(OLD_TRIGGERS).map(([n, t]) => [n, OLD_DEF(n, t)])));
    expect(s.ledger).toBe(1);
    const down = await inTx(async (tx) => {
      await apply(tx, DOWN);
      return state(tx);
    });
    expect(down.newTriggers, 'the down changed nothing: the two states do not discriminate').not.toEqual(s.newTriggers);
  });

  test("each new trigger is the shape it claims: BEFORE, statement-level, TRUNCATE alone, ENABLE ALWAYS", async () => {
    const rows = await inTx((tx) =>
      tx.unsafe<{ tgname: string; tgtype: number; tgenabled: string; fn: string }[]>(
        `select tgname, tgtype::int as tgtype, tgenabled::text as tgenabled, tgfoid::regprocedure::text as fn
           from pg_trigger where tgname in ('trg_audit_log_no_truncate', 'trg_ward_status_event_no_truncate') order by tgname`,
      ),
    );
    expect(rows.map((r) => r.tgname)).toEqual(['trg_audit_log_no_truncate', 'trg_ward_status_event_no_truncate']);
    for (const r of rows) {
      // tgtype bits: 1 row-level, 2 BEFORE, 4 INSERT, 8 DELETE, 16 UPDATE, 32 TRUNCATE.
      expect(r.tgtype, `${r.tgname}: BEFORE TRUNCATE at statement level, and no other event (BEFORE 2 + TRUNCATE 32)`).toBe(2 | 32);
      expect(r.tgenabled, `${r.tgname} is not ENABLE ALWAYS`).toBe('A');
      expect(r.fn).toBe('app.raise_append_only()');
    }
  });

  test("down restores EXACTLY the 029 state — no truncate trigger, and 010's row triggers, function, grants and rows untouched", async () => {
    const [start, after] = await inTx(async (tx) => {
      const a = await state(tx);
      await apply(tx, DOWN);
      return [a, await state(tx)];
    });
    expect(after.newTriggers).toEqual({ trg_audit_log_no_truncate: null, trg_ward_status_event_no_truncate: null });
    expect(after.ledger).toBe(0);
    expect(after.oldTriggers, "the down touched 010's row triggers").toEqual(start.oldTriggers);
    expect(after.functionBody, "the down touched app.raise_append_only()").toBe(start.functionBody);
    expect(after.functionGrants).toEqual(start.functionGrants);
    expect(after.clientPrivileges, 'the down changed a client privilege on the two tables').toEqual(start.clientPrivileges);
    expect(after.rowCounts, 'the down changed a row count').toEqual(start.rowCounts);
  });

  test('down twice is a no-op, and up after down restores EXACTLY the 030 state — idempotent over 029 and over itself', async () => {
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
    expect(twice.newTriggers).toEqual({ trg_audit_log_no_truncate: null, trg_ward_status_event_no_truncate: null });
    expect(back).toEqual(start);
    expect(again, 'a second application changed the 030 state').toEqual(start);
  });

  test("030 changes nothing but the two triggers and its ledger row: function, grants, privileges and rows are as 029 left them", async () => {
    const [before, after] = await inTx(async (tx) => {
      await apply(tx, DOWN);
      const b = await state(tx);
      await apply(tx, FORWARD);
      return [b, await state(tx)];
    });
    expect(after.functionBody).toBe(before.functionBody);
    expect(after.functionGrants).toEqual(before.functionGrants);
    expect(after.clientPrivileges).toEqual(before.clientPrivileges);
    expect(after.rowCounts).toEqual(before.rowCounts);
    expect(after.oldTriggers).toEqual(before.oldTriggers);
    expect(after.ledger - before.ledger).toBe(1);
  });

  describe('plants — each false-green is mutated in, confirmed mutated, and seen', () => {
    test('plant — a trigger that exists without ENABLE ALWAYS reads O, not A, so the state check would red', async () => {
      const forward = readFileSync(FORWARD, 'utf8');
      const planted = mutate(
        forward,
        "    EXECUTE 'ALTER TABLE app.audit_log ENABLE ALWAYS TRIGGER trg_audit_log_no_truncate';\n",
        '',
      );
      const seen = await inTx(async (tx) => {
        await tx.unsafe('alter table app.audit_log enable trigger trg_audit_log_no_truncate');
        await apply(tx, FORWARD, planted);
        const withPlant = (await state(tx)).newTriggers['trg_audit_log_no_truncate'];
        await apply(tx, FORWARD);
        return { withPlant, restored: (await state(tx)).newTriggers['trg_audit_log_no_truncate'] };
      });
      expect(seen.withPlant?.startsWith('O:'), 'the planted migration left the trigger ENABLE ALWAYS: the plant did not take effect').toBe(true);
      expect(seen.restored?.startsWith('A:'), 'the real migration did not restore ENABLE ALWAYS').toBe(true);
    });

    test('plant — a trigger on the wrong event (BEFORE UPDATE) lets the owner truncate; the real BEFORE TRUNCATE trigger refuses', async () => {
      const forward = readFileSync(FORWARD, 'utf8');
      const planted = mutate(forward, '                     BEFORE TRUNCATE ON app.audit_log\n', '                     BEFORE UPDATE ON app.audit_log\n');
      const truncateOutcome = async (tx: TransactionSql): Promise<string> => {
        try {
          await tx.savepoint((sp) => sp.unsafe('truncate app.audit_log'));
          return 'truncated';
        } catch (e) {
          return (e as { message: string }).message;
        }
      };
      const seen = await inTx(async (tx) => {
        await tx.unsafe(`insert into app.audit_log (action) values ('test.round_trip_030')`);
        const real = await truncateOutcome(tx);
        await apply(tx, DOWN);
        await apply(tx, FORWARD, planted);
        const def = (await state(tx)).newTriggers['trg_audit_log_no_truncate'];
        return { real, def, plantedOutcome: await truncateOutcome(tx) };
      });
      expect(seen.def, 'the planted trigger is not on UPDATE: the plant did not take effect').toContain('BEFORE UPDATE ON app.audit_log');
      expect(seen.real).toMatch(/APPEND_ONLY_VIOLATION: TRUNCATE on app\.audit_log/);
      expect(seen.plantedOutcome, 'the wrong-event trigger did not let the truncate through').toBe('truncated');
    });

    test('plant — a trigger created AFTER TRUNCATE reads tgtype 32, not 34, so the shape check would red', async () => {
      const forward = readFileSync(FORWARD, 'utf8');
      const planted = mutate(forward, '                     BEFORE TRUNCATE ON app.audit_log\n', '                     AFTER TRUNCATE ON app.audit_log\n');
      const seen = await inTx(async (tx) => {
        const read = async (): Promise<number | undefined> => {
          const [r] = await tx.unsafe<{ t: number }[]>(`select tgtype::int as t from pg_trigger where tgname = 'trg_audit_log_no_truncate'`);
          return r?.t;
        };
        const real = await read();
        await apply(tx, DOWN);
        await apply(tx, FORWARD, planted);
        return { real, plantedType: await read() };
      });
      expect(seen.real).toBe(2 | 32);
      expect(seen.plantedType, 'the planted trigger is not AFTER: the plant did not take effect').toBe(32);
    });

    test('plant — a pg_trigger guard naming a trigger that already exists skips the CREATE, and the unconditional ENABLE ALWAYS then fails loudly instead of leaving the table unguarded', async () => {
      const forward = readFileSync(FORWARD, 'utf8');
      const planted = mutate(
        forward,
        "WHERE tgname = 'trg_ward_status_event_no_truncate') THEN",
        "WHERE tgname = 'trg_ward_status_event_append_only') THEN",
      );
      const seen = await inTx(async (tx) => {
        await apply(tx, DOWN);
        let message = '';
        try {
          await tx.savepoint((sp) => apply(sp, FORWARD, planted));
          message = '(applied without error)';
        } catch (e) {
          message = (e as { message: string }).message;
        }
        const [t] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from pg_trigger where tgname = 'trg_ward_status_event_no_truncate'`);
        await apply(tx, FORWARD);
        const real = (await state(tx)).newTriggers['trg_ward_status_event_no_truncate'];
        return { message, triggersAfterPlant: t?.n, real };
      });
      expect(seen.triggersAfterPlant, 'the planted file created the trigger anyway: the plant did not take effect').toBe(0);
      expect(seen.message).toMatch(/trigger "trg_ward_status_event_no_truncate" for table "ward_status_event" does not exist/);
      expect(seen.real, 'the real file did not create the trigger').toBe(NEW_DEF('trg_ward_status_event_no_truncate', 'app.ward_status_event'));
    });
  });
});
