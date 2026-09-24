import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * MIGRATION 022 REVERSES TO EXACTLY THE 021 STATE, CHANGES NO PUBLIC OUTPUT, AND ITS
 * DOWN NEVER DROPS THE ONLY GUARD AGAINST A SECOND OPERATOR (R-2026-09-24-90 BR-1 d,
 * R-2026-09-24-91 BS-1 a), in the idiom of tests/db/migration_021_round_trip.test.ts.
 *
 * The state compared:
 *   - app.provision_begin and app.provision_complete BY VALUE, against 022's text and
 *     against the text they replace (021's begin, 020's complete);
 *   - the one-active-operator index, by name;
 *   - the ledger row.
 *
 * THE RESTATED BODIES MOVE ONLY WHERE BR-1 SAYS. begin is 021's with one arm added
 * in the PLATFORM_ADMIN branch, asserted exactly. complete is 020's with lines only
 * ADDED, except the old unique-violation handler, whose lines are the only ones
 * removed: a line-level diff asserts that, so no other line of a gate 020's review
 * signed off can move under cover of this one. What the added lines DO is asserted
 * by behaviour, in tests/db/provisioning_gates.test.ts.
 *
 * THE DOWN REFUSES WHILE AN ACTIVE PLATFORM_ADMIN EXISTS (BS-1 a), because it restores
 * 021's begin, which opens a fresh operator invite on a re-run. The forward refuses
 * over more than one, naming the count. Both refusals are planted below.
 *
 * EVERY LEG RUNS INSIDE ONE ROLLED-BACK TRANSACTION (BL-1): scripts/run_migrations.sh
 * applies each file with --single-transaction, so applying the file TEXT inside a
 * transaction is faithful, and nothing here is committed.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const FORWARD = join(MIG_DIR, '022_one_operator_and_reactivation.sql');
const DOWN = join(MIG_DIR, '022_one_operator_and_reactivation.down.sql');
const LEDGER = '022_one_operator_and_reactivation.sql';
const F020 = '020_operator_functions_and_listing.sql';
const F021 = '021_facility_agreement_and_contact_write.sql';
const F022 = LEDGER;

async function apply(tx: TransactionSql, path: string, text = readFileSync(path, 'utf8')): Promise<void> {
  await tx.unsafe(text);
}

async function refusal(tx: TransactionSql, path: string): Promise<{ message: string; detail: string }> {
  try {
    await tx.savepoint((sp) => apply(sp, path));
  } catch (e) {
    const err = e as { message: string; detail?: string };
    return { message: err.message, detail: err.detail ?? '' };
  }
  throw new Error(`${path} applied, and it was expected to refuse`);
}

const inTx = <T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> => withRole('postgres', null, fn);

/** The body between `AS $FN$` and `$FN$;` of one function, as a file writes it. */
function bodyFrom(file: string, fn: string): string {
  const text = readFileSync(join(MIG_DIR, file), 'utf8');
  const m = new RegExp(`^CREATE OR REPLACE FUNCTION ${fn.replace('.', '\\.')}\\([\\s\\S]*?AS \\$FN\\$([\\s\\S]*?)^\\$FN\\$;$`, 'm').exec(text);
  if (m === null) throw new Error(`no body for ${fn} in ${file}`);
  return m[1] ?? '';
}

interface State {
  begin: string;
  complete: string;
  index: number;
  ledger: number;
}

async function state(tx: TransactionSql): Promise<State> {
  const src = async (sig: string): Promise<string> =>
    (await tx.unsafe<{ src: string }[]>('select prosrc as src from pg_proc where oid = to_regprocedure($1)', [sig] as never[]))[0]?.src ?? '';
  const [i] = await tx.unsafe<{ n: number }[]>(`select count(*)::int as n from pg_indexes where schemaname = 'app' and indexname = 'ward_account_one_active_operator'`);
  const [g] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.schema_migrations where filename = $1', [LEDGER] as never[]);
  return {
    begin: await src('app.provision_begin(uuid, text, text)'),
    complete: await src('app.provision_complete(uuid, uuid)'),
    index: i?.n ?? -1,
    ledger: g?.n ?? -1,
  };
}

const STATE_022: State = { begin: bodyFrom(F022, 'app.provision_begin'), complete: bodyFrom(F022, 'app.provision_complete'), index: 1, ledger: 1 };
const STATE_021: State = { begin: bodyFrom(F021, 'app.provision_begin'), complete: bodyFrom(F020, 'app.provision_complete'), index: 0, ledger: 0 };

/** BR-1 b's arm, as 022 inserts it after the PLATFORM_ADMIN branch nulls the scope. */
const NULLS = '        p_facility := NULL;\n        v_category := NULL;\n';
const ARM =
  "        -- R-2026-09-24-90 BR-1 b: an active operator is complete. Nothing is opened,\n" +
  '        -- and the script calls no Auth admin endpoint.\n' +
  '        IF EXISTS (SELECT 1 FROM app.ward_account u\n' +
  "                    WHERE u.role = 'PLATFORM_ADMIN' AND u.is_active) THEN\n" +
  "            RETURN QUERY SELECT 'complete'::text, NULL::uuid;\n" +
  '            RETURN;\n' +
  '        END IF;\n';

/** The lines of `a` that a longest-common-subsequence alignment with `b` does not keep. */
function removedLines(a: string[], b: string[]): string[] {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push(a[i++]!); else j++;
  }
  while (i < a.length) out.push(a[i++]!);
  return out;
}

/** 020's handler lines, the only lines of 020's complete that 022 removes: they are re-issued deeper, inside the constraint-name mapping. */
const OLD_HANDLER = [
  "        -- J3: one active account per ward. Replacing a ward's address means",
  '        -- deactivating the old account first.',
  "        RAISE EXCEPTION 'WARD_ALREADY_HAS_AN_ACCOUNT'",
  "              USING DETAIL = 'deactivate the ward''s current account before provisioning another';",
];

async function publicOutput(tx: TransactionSql): Promise<unknown[]> {
  const f = await tx.unsafe('select * from public.facility_public order by facility_id');
  const w = await tx.unsafe('select * from public.ward_public order by facility_id, category');
  const r = await tx.unsafe('select * from public.lga_rollup order by state, lga, category');
  return [[...f], [...w], [...r]];
}

const addOperator = (tx: TransactionSql): Promise<unknown> =>
  tx.unsafe(`insert into app.ward_account (id, role) values (gen_random_uuid(), 'PLATFORM_ADMIN')`);

describe('migration 022 round trip', () => {
  test('the database starts in the 022 state, and the bodies discriminate', async () => {
    expect(STATE_021.begin).not.toBe(STATE_022.begin);
    expect(STATE_021.complete).not.toBe(STATE_022.complete);
    expect(await inTx(state)).toEqual(STATE_022);
  });

  test("022's begin is 021's with only BR-1 b's operator arm added", () => {
    expect(STATE_021.begin.split(NULLS).length - 1, "021's PLATFORM_ADMIN branch is not in the body exactly once").toBe(1);
    expect(STATE_021.begin.replace(NULLS, NULLS + ARM), 'provision_begin moved beyond the operator arm').toBe(STATE_022.begin);
  });

  test("022's complete removes no line of 020's except the old unique-violation handler", () => {
    const removed = removedLines(STATE_021.complete.split('\n'), STATE_022.complete.split('\n'));
    expect(removed, 'provision_complete lost a line of 020 that BR-1 does not replace').toEqual(OLD_HANDLER);
  });

  test("down restores EXACTLY the 021 state — 021's begin, 020's complete, no index, no ledger row", async () => {
    const s = await inTx(async (tx) => {
      await apply(tx, DOWN);
      return state(tx);
    });
    expect(s, 'the reversal did not land on 021 exactly').toEqual(STATE_021);
  });

  test('neither the down nor a re-apply writes a public row', async () => {
    const r = await inTx(async (tx) => {
      const before = await publicOutput(tx);
      await apply(tx, FORWARD);
      const reapplied = await publicOutput(tx);
      await apply(tx, DOWN);
      return { before, reapplied, down: await publicOutput(tx) };
    });
    expect((r.before[0] as unknown[]).length, 'the seed projected no facility, so this leg would pass vacuously').toBeGreaterThan(0);
    expect(r.reapplied, 'a re-apply of 022 changed the public output').toEqual(r.before);
    expect(r.down, 'the down changed the public output').toEqual(r.before);
  });

  test('up after down restores EXACTLY the 022 state, and a re-apply changes nothing', async () => {
    const s = await inTx(async (tx) => {
      await apply(tx, DOWN);
      await apply(tx, FORWARD);
      await apply(tx, FORWARD);
      return state(tx);
    });
    expect(s).toEqual(STATE_022);
  });

  test('the down REFUSES while an active PLATFORM_ADMIN exists, naming the count — it never drops the only guard (BS-1 a)', async () => {
    const r = await inTx(async (tx) => {
      await addOperator(tx);
      const refused = await refusal(tx, DOWN);
      return { refused, s: await state(tx) };
    });
    expect(r.refused.message).toBe('OPERATOR_INDEX_IN_USE');
    expect(r.refused.detail, 'the refusal does not name the count').toContain('1 active PLATFORM_ADMIN account(s) exist');
    expect(r.s, 'the refused reversal changed the schema').toEqual(STATE_022);
  });

  test('a deactivated operator does not hold the down — only an active one does', async () => {
    const s = await inTx(async (tx) => {
      await tx.unsafe(`insert into app.ward_account (id, role, is_active, deactivated_at) values (gen_random_uuid(), 'PLATFORM_ADMIN', false, now())`);
      await apply(tx, DOWN);
      return state(tx);
    });
    expect(s).toEqual(STATE_021);
  });

  test('the forward REFUSES over two active PLATFORM_ADMIN accounts, naming the count, and leaves nothing behind', async () => {
    const r = await inTx(async (tx) => {
      await apply(tx, DOWN);
      await addOperator(tx);
      await addOperator(tx);
      const refused = await refusal(tx, FORWARD);
      return { refused, s: await state(tx) };
    });
    expect(r.refused.message).toBe('PLATFORM_ADMIN_DUPLICATES');
    expect(r.refused.detail, 'the refusal does not name the count').toContain('2 active PLATFORM_ADMIN accounts exist');
    expect(r.s, 'the refused forward left part of itself behind').toEqual(STATE_021);
  });

  test('the index refuses a second active PLATFORM_ADMIN by its own name', async () => {
    const err = await inTx(async (tx) => {
      await addOperator(tx);
      try {
        await tx.savepoint((sp) => addOperator(sp));
      } catch (e) {
        return e as { code?: string; constraint_name?: string };
      }
      return null;
    });
    expect(err, 'a second active operator was admitted').not.toBeNull();
    expect(err?.code).toBe('23505');
    expect(err?.constraint_name).toBe('ward_account_one_active_operator');
  });

  test.each([
    ['a reversal that keeps the index', 'DROP INDEX IF EXISTS app.ward_account_one_active_operator RESTRICT;\n', ''],
    ["a reversal that leaves 022's begin", 'CREATE OR REPLACE FUNCTION app.provision_begin(', 'CREATE OR REPLACE FUNCTION app.zz_not_the_gate('],
  ])('plant — %s is rejected by the exact-state assertion', async (_name, needle, replacement) => {
    const original = readFileSync(DOWN, 'utf8');
    expect(original, `the plant's target is not in the down file: ${needle}`).toContain(needle);
    const tampered = original.replace(needle, replacement);
    const s = await inTx(async (tx) => {
      await apply(tx, DOWN, tampered);
      return state(tx);
    });
    expect(s, 'the tampered reversal still produced the 021 state — the plant did not reach an executed statement').not.toEqual(STATE_021);
  });
});
