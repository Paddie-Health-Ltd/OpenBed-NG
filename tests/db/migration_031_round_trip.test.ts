import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * MIGRATION 031 ADDS THE FACILITY ADDRESS AND REPLACES TWO OPERATOR SIGNATURES, AND REVERSES TO
 * EXACTLY THE 030 STATE (R-2026-09-30-214 GN), in the idiom of tests/db/migration_023_round_trip.test.ts.
 *
 * GUARD CLASS: LIVE. 031 exists, and every leg runs against it.
 *
 * The state compared, before and after the down:
 *   - the BODY of each of five functions, by value, against the file that last wrote it
 *     (020 for create and edit, 021 for project_facility, 029 for operator_register, 019 for
 *     regenerate_snapshot);
 *   - which SIGNATURES of create and edit exist, so the replacement is proved to be one
 *     function each and not an overload (addendum 1 to GN: REPLACE);
 *   - who may EXECUTE the two operator functions: authenticated only, never anon or service_role;
 *   - whether the `address` column exists on app.facility and on public.facility_public;
 *   - the ledger row.
 *
 * THE BODIES MOVE ONLY WHERE GN SAYS. operator_register and project_facility are asserted as exact
 * replaces of their predecessors, so no other line can move under cover of this one. For
 * regenerate_snapshot the FACILITY AND WARD ARRAYS ARE ASSERTED UNCHANGED, by text: the whole of
 * the compatibility argument is that the wire format of a facility row did not move.
 *
 * EVERY LEG RUNS INSIDE ONE ROLLED-BACK TRANSACTION, as scripts/run_migrations.sh applies each
 * file with --single-transaction. Every migration above 031 is reversed first, newest first.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const LEDGER = '031_facility_address.sql';
const FORWARD = join(MIG_DIR, LEDGER);
const DOWN = join(MIG_DIR, '031_facility_address.down.sql');

async function apply(tx: TransactionSql, path: string, text = readFileSync(path, 'utf8')): Promise<void> {
  await tx.unsafe(text);
}

const LATER = readdirSync(MIG_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.endsWith('.down.sql') && f > LEDGER).sort();

const inTx = <T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> =>
  withRole('postgres', null, async (tx) => {
    for (const f of LATER.slice().reverse()) await apply(tx, join(MIG_DIR, f.replace(/\.sql$/, '.down.sql')));
    return fn(tx);
  });

function bodyFrom(file: string, fn: string): string {
  const text = readFileSync(join(MIG_DIR, file), 'utf8');
  const m = new RegExp(`^CREATE OR REPLACE FUNCTION ${fn.replace('.', '\\.')}\\([\\s\\S]*?AS \\$FN\\$([\\s\\S]*?)^\\$FN\\$;$`, 'm').exec(text);
  if (m === null) throw new Error(`no body for ${fn} in ${file}`);
  return m[1] ?? '';
}

const F019 = '019_snapshot_single_read_and_mirror_integrity.sql';
const F020 = '020_operator_functions_and_listing.sql';
const F021 = '021_facility_agreement_and_contact_write.sql';
const F029 = '029_facility_reporting_approval.sql';

// OLD_ARITY_ON_PURPOSE: the two lines below name the signatures 030 has and the down restores, to compare against.
const CREATE_7 = 'public.operator_create_facility(text, text, text, text, double precision, double precision, text)';
const CREATE_8 = 'public.operator_create_facility(text, text, text, text, double precision, double precision, text, text)';
// OLD_ARITY_ON_PURPOSE
const EDIT_8 = 'public.operator_edit_facility(text, integer, text, text, text, double precision, double precision, text)';
const EDIT_9 = 'public.operator_edit_facility(text, integer, text, text, text, double precision, double precision, text, text)';

interface State {
  bodies: Record<string, string>;
  /** The argument count of every overload that exists, by name. */
  arities: { create: number[]; edit: number[] };
  execute: Record<string, { anon: boolean; authenticated: boolean; service_role: boolean }>;
  addressColumns: { facility: boolean; facility_public: boolean };
  ledger: number;
}

const body = async (tx: TransactionSql, sig: string): Promise<string> => {
  const [p] = await tx.unsafe<{ src: string }[]>(`select prosrc as src from pg_proc where oid = to_regprocedure('${sig}')`);
  return p?.src ?? '(absent)';
};

async function state(tx: TransactionSql, signatures: { create: string; edit: string }): Promise<State> {
  const arities = async (name: string): Promise<number[]> =>
    (await tx.unsafe<{ n: number }[]>(`select pronargs::int as n from pg_proc where proname = '${name}' and pronamespace = 'public'::regnamespace order by 1`)).map((r) => r.n);
  const priv = async (sig: string) => {
    const [g] = await tx.unsafe<{ anon: boolean; authenticated: boolean; service_role: boolean }[]>(`
      select has_function_privilege('anon', '${sig}', 'EXECUTE') as anon,
             has_function_privilege('authenticated', '${sig}', 'EXECUTE') as authenticated,
             has_function_privilege('service_role', '${sig}', 'EXECUTE') as service_role`);
    return g ?? { anon: true, authenticated: false, service_role: true };
  };
  const col = async (schema: string, table: string): Promise<boolean> => {
    const [c] = await tx.unsafe<{ n: number }[]>(
      `select count(*)::int as n from information_schema.columns where table_schema = '${schema}' and table_name = '${table}' and column_name = 'address'`,
    );
    return (c?.n ?? 0) === 1;
  };
  const [l] = await tx.unsafe<{ n: number }[]>('select count(*)::int as n from app.schema_migrations where filename = $1', [LEDGER] as never[]);
  return {
    bodies: {
      create: await body(tx, signatures.create),
      edit: await body(tx, signatures.edit),
      project_facility: await body(tx, 'app.project_facility(uuid)'),
      operator_register: await body(tx, 'public.operator_register()'),
      regenerate_snapshot: await body(tx, 'app.regenerate_snapshot()'),
    },
    arities: { create: await arities('operator_create_facility'), edit: await arities('operator_edit_facility') },
    execute: { create: await priv(signatures.create), edit: await priv(signatures.edit) },
    addressColumns: { facility: await col('app', 'facility'), facility_public: await col('public', 'facility_public') },
    ledger: l?.n ?? -1,
  };
}

const AUTHENTICATED_ONLY = { anon: false, authenticated: true, service_role: false };

const STATE_030: State = {
  bodies: {
    create: bodyFrom(F020, 'public.operator_create_facility'),
    edit: bodyFrom(F020, 'public.operator_edit_facility'),
    project_facility: bodyFrom(F021, 'app.project_facility'),
    operator_register: bodyFrom(F029, 'public.operator_register'),
    regenerate_snapshot: bodyFrom(F019, 'app.regenerate_snapshot'),
  },
  arities: { create: [7], edit: [8] },
  execute: { create: AUTHENTICATED_ONLY, edit: AUTHENTICATED_ONLY },
  addressColumns: { facility: false, facility_public: false },
  ledger: 0,
};

const STATE_031_BODIES = {
  create: bodyFrom(LEDGER, 'public.operator_create_facility'),
  edit: bodyFrom(LEDGER, 'public.operator_edit_facility'),
  project_facility: bodyFrom(LEDGER, 'app.project_facility'),
  operator_register: bodyFrom(LEDGER, 'public.operator_register'),
  regenerate_snapshot: bodyFrom(LEDGER, 'app.regenerate_snapshot'),
};

const STATE_031: State = {
  bodies: STATE_031_BODIES,
  arities: { create: [8], edit: [9] },
  execute: { create: AUTHENTICATED_ONLY, edit: AUTHENTICATED_ONLY },
  addressColumns: { facility: true, facility_public: true },
  ledger: 1,
};

const OLD = { create: CREATE_7, edit: EDIT_8 };
const NEW = { create: CREATE_8, edit: EDIT_9 };

describe('migration 031 round trip', () => {
  test('the database starts in the 031 state, and every body discriminates from its predecessor', async () => {
    for (const k of Object.keys(STATE_030.bodies)) {
      expect(STATE_031.bodies[k], `${k}: 031's body is byte-identical to its predecessor, so the round trip would not discriminate`).not.toBe(STATE_030.bodies[k]);
    }
    expect(await inTx((tx) => state(tx, NEW))).toEqual(STATE_031);
  });

  test("operator_register is 029's with exactly one key inserted after public_phone_e164", () => {
    const line = "                       'public_phone_e164', f.public_phone_e164,\n";
    const key = "                       'address', f.address,\n";
    const was = STATE_030.bodies['operator_register'] ?? '';
    expect(was.split(line).length - 1, "029's public_phone_e164 line is not in the body exactly once").toBe(1);
    expect(was.replace(line, line + key), 'operator_register moved beyond the one key').toBe(STATE_031.bodies['operator_register']);
  });

  test("project_facility is 021's with `address` added to the column list, the select list and the conflict set — three replaces and nothing else", () => {
    let was = STATE_030.bodies['project_facility'] ?? '';
    const steps: [string, string][] = [
      ['(facility_id, name, lga, state, lat, lng, public_phone_e164, updated_at)', '(facility_id, name, lga, state, lat, lng, public_phone_e164, address, updated_at)'],
      ['f.public_phone_e164, f.updated_at', 'f.public_phone_e164, f.address, f.updated_at'],
      ['        public_phone_e164 = EXCLUDED.public_phone_e164,\n', '        public_phone_e164 = EXCLUDED.public_phone_e164,\n        address           = EXCLUDED.address,\n'],
    ];
    for (const [from, to] of steps) {
      expect(was.split(from).length - 1, `021 does not carry ${JSON.stringify(from)} exactly once`).toBe(1);
      was = was.replace(from, to);
    }
    expect(was, 'project_facility moved beyond the address').toBe(STATE_031.bodies['project_facility']);
  });

  test("regenerate_snapshot keeps 019's facility array and ward array BYTE FOR BYTE — the wire format of a facility row did not move", () => {
    const facilityArray =
      'SELECT coalesce(jsonb_agg(jsonb_build_array(\n' +
      '                   fsrc.facility_id, fsrc.name, fsrc.lga, fsrc.state, fsrc.lat, fsrc.lng,\n' +
      '                   fsrc.public_phone_e164, fsrc.updated_at\n' +
      "               ) ORDER BY fsrc.facility_id), '[]'::jsonb) AS rows";
    const wardArray =
      'SELECT coalesce(jsonb_agg(jsonb_build_array(\n' +
      '                   src.facility_id, src.category, src.offering, src.bed_count,\n' +
      '                   src.accepting_effective, src.gated_by, src.state, src.source,\n' +
      '                   src.monitoring_state, src.updated_at\n' +
      "               ) ORDER BY src.facility_id, src.category), '[]'::jsonb) AS rows";
    for (const [name, needle] of [['facility', facilityArray], ['ward', wardArray]] as const) {
      expect(STATE_030.bodies['regenerate_snapshot'], `019 no longer carries the ${name} array verbatim, so the assertion below is vacuous`).toContain(needle);
      expect(STATE_031.bodies['regenerate_snapshot'], `031 changed the ${name} array`).toContain(needle);
    }
    expect(STATE_031.bodies['regenerate_snapshot']).toContain("'facility_extras'");
    expect(STATE_031.bodies['regenerate_snapshot']).toContain('SNAPSHOT_ROWS_DROPPED');
  });

  test('up leaves exactly ONE create (8 arguments) and ONE edit (9 arguments): a replacement, not an overload', async () => {
    const s = await inTx((tx) => state(tx, NEW));
    expect(s.arities).toEqual({ create: [8], edit: [9] });
  });

  test("down restores EXACTLY the 030 state — 020/021/029/019's bodies, the old signatures only, no column, no ledger row", async () => {
    const s = await inTx(async (tx) => {
      await apply(tx, DOWN);
      return state(tx, OLD);
    });
    expect(s, 'the reversal did not land on 030 exactly').toEqual(STATE_030);
  });

  test('up after down restores EXACTLY the 031 state — idempotent over itself', async () => {
    const s = await inTx(async (tx) => {
      await apply(tx, DOWN);
      await apply(tx, FORWARD);
      await apply(tx, FORWARD);
      return state(tx, NEW);
    });
    expect(s).toEqual(STATE_031);
  });

  test('neither the down nor a re-apply writes a public row', async () => {
    const out = async (tx: TransactionSql): Promise<unknown[]> => {
      const f = await tx.unsafe('select facility_id, name, lga, state, lat, lng, public_phone_e164, updated_at from public.facility_public order by facility_id');
      const w = await tx.unsafe('select * from public.ward_public order by facility_id, category');
      const r = await tx.unsafe('select * from public.lga_rollup order by state, lga, category');
      return [[...f], [...w], [...r]];
    };
    const r = await inTx(async (tx) => {
      const before = await out(tx);
      await apply(tx, FORWARD);
      const reapplied = await out(tx);
      await apply(tx, DOWN);
      return { before, reapplied, down: await out(tx) };
    });
    expect((r.before[0] as unknown[]).length, 'the seed projected no facility, so this leg would pass vacuously').toBeGreaterThan(0);
    expect(r.reapplied, 'a re-apply of 031 changed the public output').toEqual(r.before);
    expect(r.down, 'the down changed the public output').toEqual(r.before);
  });

  test("plant — a reversal that leaves 031's create in place is rejected by the exact-state assertion", async () => {
    const original = readFileSync(DOWN, 'utf8');
    const needle = 'DROP FUNCTION IF EXISTS public.operator_create_facility(text, text, text, text, double precision, double precision, text, text)';
    expect(original, "the plant's target is not in the down file").toContain(needle);
    const tampered = original.replace(needle, 'SELECT 1');
    const s = await inTx(async (tx) => {
      await apply(tx, DOWN, tampered);
      return state(tx, OLD);
    });
    expect(s, 'the tampered reversal still produced the 030 state — the plant did not reach an executed statement').not.toEqual(STATE_030);
  });
});
