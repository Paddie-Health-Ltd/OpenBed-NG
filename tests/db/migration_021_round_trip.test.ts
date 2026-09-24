import { afterAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, psqlCommand } from '../setup/db.js';

/**
 * MIGRATION 021 REVERSES TO EXACTLY THE 020 STATE, CHANGES NO PUBLIC OUTPUT, AND NEVER
 * INVENTS OR LOSES AN AGREEMENT (R-2026-09-24-75/76; BC-5, BD-1), in the idiom of
 * tests/db/migration_020_round_trip.test.ts.
 *
 * The state compared:
 *   - the two restated gates BY VALUE: operator_set_facility_listed and
 *     app.provision_begin against 020's and 021's text;
 *   - app.facility_agreement, the contact's agreement_accepted_at and version columns,
 *     the version trigger, and the functions 021 adds or drops, each by name;
 *   - the ledger row.
 *
 * THE RESTATED GATES DIFFER FROM 020 IN THE AGREEMENT CHECK AND NOTHING ELSE. Each
 * 021 body must equal 020's with only that check replaced, so no other line of a
 * gate that 020's review signed off can move under cover of this one.
 *
 * NEITHER DIRECTION INVENTS OR LOSES AN AGREEMENT. The forward refuses over a contact
 * row carrying agreement_accepted_at (moving it would need a version never recorded).
 * The down refuses while any app.facility_agreement row exists. Both refusals are
 * planted with committed rows, removed again in `finally`.
 *
 * SAFE ON THE SHARED DATABASE for the reason 019's and 020's files give: the db
 * project runs files one at a time, and every leg restores 021 in a `finally`, with
 * an unconditional `afterAll` behind it.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const FORWARD = join(MIG_DIR, '021_facility_agreement_and_contact_write.sql');
const DOWN = join(MIG_DIR, '021_facility_agreement_and_contact_write.down.sql');
const LEDGER = '021_facility_agreement_and_contact_write.sql';

function applyFile(path: string): void {
  const cmd = `${psqlCommand()} -v ON_ERROR_STOP=1 --single-transaction < ${JSON.stringify(path)}`;
  execFileSync('bash', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The error text of an apply that must fail. */
function applyFailure(path: string): string {
  try {
    applyFile(path);
  } catch (e) {
    const err = e as { stderr?: Buffer | string };
    return String(err.stderr ?? '');
  }
  throw new Error(`${path} applied, and it was expected to refuse`);
}

/** The body between `AS $FN$` and `$FN$;` of one function, as a file writes it. */
function bodyFrom(file: string, fn: string): string {
  const text = readFileSync(join(MIG_DIR, file), 'utf8');
  const m = new RegExp(`^CREATE OR REPLACE FUNCTION ${fn.replace('.', '\\.')}\\([\\s\\S]*?AS \\$FN\\$([\\s\\S]*?)^\\$FN\\$;$`, 'm').exec(text);
  if (m === null) throw new Error(`no body for ${fn} in ${file}`);
  return m[1] ?? '';
}

const ADDED = ['app.bump_row_version', 'public.operator_get_contact', 'public.operator_record_agreement', 'public.operator_record_contact', 'public.operator_register'];
const DROPPED = ['public.operator_list_facilities'];

interface State {
  listed: string;
  begin: string;
  agreementTable: boolean;
  contactColumns: string[];
  trigger: number;
  functions: string[];
  ledger: number;
}

async function state(): Promise<State> {
  const db = sql();
  const [l] = await db<{ src: string }[]>`select prosrc as src from pg_proc where oid = 'public.operator_set_facility_listed(text, integer)'::regprocedure`;
  const [b] = await db<{ src: string }[]>`select prosrc as src from pg_proc where oid = 'app.provision_begin(uuid, text, text)'::regprocedure`;
  const [t] = await db<{ r: string | null }[]>`select to_regclass('app.facility_agreement')::text as r`;
  const cols = await db<{ c: string }[]>`
    select column_name as c from information_schema.columns
     where table_schema = 'app' and table_name = 'facility_contact' and column_name in ('agreement_accepted_at', 'version') order by 1`;
  const [tr] = await db<{ n: number }[]>`select count(*)::int as n from pg_trigger where tgname = 'trg_facility_contact_version' and not tgisinternal`;
  const fns = await db<{ f: string }[]>`
    select distinct n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname || '.' || p.proname = any(${[...ADDED, ...DROPPED]}) order by 1`;
  const [g] = await db<{ n: number }[]>`select count(*)::int as n from app.schema_migrations where filename = ${LEDGER}`;
  return {
    listed: l?.src ?? '', begin: b?.src ?? '', agreementTable: t?.r !== null, contactColumns: cols.map((c) => c.c),
    trigger: tr?.n ?? -1, functions: fns.map((f) => f.f), ledger: g?.n ?? -1,
  };
}

const F020 = '020_operator_functions_and_listing.sql';
const F021 = '021_facility_agreement_and_contact_write.sql';
const STATE_021: State = {
  listed: bodyFrom(F021, 'public.operator_set_facility_listed'),
  begin: bodyFrom(F021, 'app.provision_begin'),
  agreementTable: true,
  contactColumns: ['version'],
  trigger: 1,
  functions: [...ADDED].sort(),
  ledger: 1,
};
const STATE_020: State = {
  listed: bodyFrom(F020, 'public.operator_set_facility_listed'),
  begin: bodyFrom(F020, 'app.provision_begin'),
  agreementTable: false,
  contactColumns: ['agreement_accepted_at'],
  trigger: 0,
  functions: [...DROPPED],
  ledger: 0,
};

async function mirrors(): Promise<string> {
  const f = await sql()`select * from public.facility_public order by facility_id`;
  const w = await sql()`select * from public.ward_public order by facility_id, category`;
  return JSON.stringify({ f, w });
}

/** 020's agreement check, and what 021 puts in its place, at one indentation. */
function agreementSwap(body: string, v: string, ind: string): string {
  const old =
    `${ind}IF NOT EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = ${v} AND c.agreement_accepted_at IS NOT NULL) THEN\n` +
    `${ind}    RAISE EXCEPTION 'AGREEMENT_NOT_RECORDED';\n${ind}END IF;\n`;
  const replacement =
    `${ind}IF NOT EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = ${v}) THEN\n` +
    `${ind}    RAISE EXCEPTION 'AGREEMENT_NOT_RECORDED';\n${ind}END IF;\n` +
    `${ind}IF EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = ${v} AND a.withdrawn_on IS NOT NULL) THEN\n` +
    `${ind}    RAISE EXCEPTION 'AGREEMENT_WITHDRAWN';\n${ind}END IF;\n`;
  expect(body.split(old).length - 1, `020's agreement check is not in the body exactly once (${v})`).toBe(1);
  return body.replace(old, replacement);
}

afterAll(() => {
  applyFile(FORWARD);
});

describe('migration 021 round trip', () => {
  test('the database starts in the 021 state, and the bodies discriminate', async () => {
    expect(STATE_020.listed).not.toBe(STATE_021.listed);
    expect(STATE_020.begin).not.toBe(STATE_021.begin);
    expect(await state()).toEqual(STATE_021);
  });

  test("the restated gates are 020's bodies with the agreement check replaced, and nothing else", () => {
    expect(agreementSwap(STATE_020.listed, 'v_id', '    '), 'operator_set_facility_listed moved beyond its agreement check').toBe(STATE_021.listed);
    expect(agreementSwap(STATE_020.begin, 'p_facility', '        '), 'provision_begin moved beyond its agreement check').toBe(STATE_021.begin);
  });

  test("down restores EXACTLY the 020 state — 020's gates and list, the contact's column, no agreement table, no ledger row", async () => {
    try {
      applyFile(DOWN);
      expect(await state(), 'the reversal did not land on 020 exactly').toEqual(STATE_020);
    } finally {
      applyFile(FORWARD);
    }
  });

  test('down then up changes NO public row, not even updated_at', async () => {
    const before = await mirrors();
    expect(JSON.parse(before).f.length, 'the seed projected no facility, so this leg would pass vacuously').toBeGreaterThan(0);
    try {
      applyFile(DOWN);
      applyFile(FORWARD);
      expect(await mirrors(), 'applying 021 changed the public mirrors').toBe(before);
    } finally {
      applyFile(FORWARD);
    }
  });

  test('up after down restores EXACTLY the 021 state, and a re-apply changes nothing', async () => {
    applyFile(DOWN);
    applyFile(FORWARD);
    applyFile(FORWARD);
    expect(await state()).toEqual(STATE_021);
  });

  test('the forward REFUSES over a contact row carrying an agreement — it never invents a version', async () => {
    const [fac] = await sql()<{ id: string }[]>`select id from app.facility order by id limit 1`;
    expect(fac, 'the seed holds no facility, so this plant has nowhere to land').toBeDefined();
    try {
      applyFile(DOWN);
      await sql()`insert into app.facility_contact (facility_id, full_name, job_title, email, agreement_accepted_at)
                  values (${fac!.id}, 'Plant Person', 'Matron', 'plant@example.invalid', now())`;
      const err = applyFailure(FORWARD);
      expect(err).toContain('AGREEMENT_ON_CONTACT_ROWS');
      expect((await state()).agreementTable, 'the refused forward left part of itself behind').toBe(false);
    } finally {
      await sql()`delete from app.facility_contact where email = 'plant@example.invalid'`;
      applyFile(FORWARD);
    }
  });

  test('the down REFUSES while an agreement row exists — it never loses one', async () => {
    const [fac] = await sql()<{ id: string }[]>`select id from app.facility order by id limit 1`;
    try {
      await sql()`insert into app.facility_agreement (facility_id, accepted_on, version) values (${fac!.id}, '2026-09-01', 'plant-v1')`;
      const err = applyFailure(DOWN);
      expect(err).toContain('AGREEMENTS_RECORDED');
      expect(await state(), 'the refused reversal changed the schema').toEqual(STATE_021);
    } finally {
      await sql()`delete from app.facility_agreement where version = 'plant-v1'`;
    }
  });

  test.each([
    ['a reversal that keeps the agreement table', 'DROP TABLE IF EXISTS app.facility_agreement RESTRICT;\n', ''],
    ["a reversal that leaves 021's listing gate", "CREATE OR REPLACE FUNCTION public.operator_set_facility_listed(", 'CREATE OR REPLACE FUNCTION public.zz_not_the_gate('],
  ])('plant — %s is rejected by the exact-state assertion', async (_name, needle, replacement) => {
    const original = readFileSync(DOWN, 'utf8');
    expect(original, `the plant's target is not in the down file: ${needle}`).toContain(needle);
    const tampered = original.replace(needle, replacement);
    const dir = mkdtempSync(join(tmpdir(), 'openbed-021-plant-'));
    const path = join(dir, 'tampered.down.sql');
    writeFileSync(path, tampered, 'utf8');
    try {
      applyFile(path);
      expect(await state(), 'the tampered reversal still produced the 020 state — the plant did not reach an executed statement').not.toEqual(STATE_020);
    } finally {
      await sql().unsafe('drop function if exists public.zz_not_the_gate(text, integer)');
      applyFile(FORWARD);
    }
  });
});
