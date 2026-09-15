import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';

/**
 * THE SNAPSHOT GENERATOR (migration 016) -- app.regenerate_snapshot().
 *
 * Every test runs inside withRole()'s always-rolled-back transaction, so no
 * snapshot row, heartbeat value or planted function survives the test.
 *
 * WHAT IS ASSERTED, AND THE RULING EACH COMES FROM.
 *   - THE GENERATED PAYLOAD'S COLUMNS ARE THE FIXTURE'S (R2:310 "what guards the
 *     snapshot's columns today: nothing"). Asserted BY VALUE against the mirror
 *     rows the generator read, in packages/fixtures/snapshot-shape.json's
 *     order -- arity alone would accept two swapped columns. The fixture is
 *     imported, never restated. With
 *     tests/compliance/snapshot_shape_matches_migration.test.ts (007 -> fixture)
 *     this closes the chain 007 -> fixture -> generated payload. The
 *     anti-vacuity plant is an extra column in the generator's selection: a
 *     fixture and a generator written from one list in one hour agree
 *     regardless, so the checker must be shown to red on a generator that
 *     disagrees.
 *   - READS FAIL LOUDLY (R-2026-09-15-05). Owned by a role without BYPASSRLS,
 *     the generator must RAISE at its first read, never write an empty
 *     snapshot. The counter-control removes only the `row_security = off`
 *     attribute from the same planted owner and shows the silent empty
 *     snapshot it prevents -- so the attribute, not something else, is what
 *     makes the failure loud.
 *   - ROWS DROPPED BETWEEN READ AND ENCODE ARE REFUSED (the count check,
 *     re-aimed by R-2026-09-15-05).
 *   - READS ONLY PUBLISHED SURFACES; WRITES ONLY snapshot_current AND THE
 *     HEARTBEAT (R-2026-09-15-04), read off the live function source.
 *   - RETENTION BITES, v FROM THE SEQUENCE, THE HEARTBEAT IN THE SAME
 *     TRANSACTION, A GATED WARD CARRIED AS GATED.
 *   - READER service_role ONLY; EXECUTE OWNER ONLY.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - Hosted role attributes. Local `postgres` is rolsuper f / rolbypassrls t
 *     (observed 2026-09-15); hosted is the founder's check. The loud-read plant
 *     proves what happens if hosted differs; it cannot prove hosted does not.
 *   - The schedule. Nothing calls the generator in 016; pg_cron and its catalogue
 *     assertion are 017.
 *   - public.lga_rollup. Out of 016 by ruling; v2's finding 1 stays open.
 */

const WRITES_ALLOWED = ['app.system_heartbeat', 'public.snapshot_current'];
const READS_ALLOWED = ['public.facility_public', 'public.ward_public'];
const APP_CALLS_ALLOWED = ['snapshot_retention'];

type Row = Record<string, unknown>;

async function generate(tx: TransactionSql): Promise<{ v: number; payload: Row }> {
  const [out] = await tx.unsafe<{ v: string }[]>('select app.regenerate_snapshot() as v');
  const [row] = await tx.unsafe<{ v: string; payload: Row }[]>(
    'select v, payload from public.snapshot_current where v = $1',
    [out?.v] as never[],
  );
  if (!row) throw new Error(`the generator returned v=${out?.v} and no row carries it`);
  return { v: Number(row.v), payload: row.payload };
}

/** Every way a generated payload can disagree with the fixture or with the mirrors it read. */
async function payloadViolations(tx: TransactionSql): Promise<{ violations: string[]; facilities: number; wards: number }> {
  const { v, payload } = await generate(tx);
  const out: string[] = [];

  const keys = Object.keys(payload).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...SHAPE.envelope].sort())) {
    out.push(`payload envelope is ${JSON.stringify(keys)}, the fixture's is ${JSON.stringify([...SHAPE.envelope].sort())}`);
  }
  if (Number(payload['v']) !== v) out.push(`payload.v is ${String(payload['v'])} but the row is v=${v}`);

  const check = async (name: 'facilities' | 'wards', table: string, columns: string[], keyOf: (r: Row) => string) => {
    const mirror = await tx.unsafe<{ r: Row }[]>(`select to_jsonb(t) as r from ${table} t`);
    const byKey = new Map(mirror.map((m) => [keyOf(m.r), m.r]));
    const encoded = (payload[name] ?? []) as unknown[][];
    if (encoded.length !== mirror.length) out.push(`${name}: payload has ${encoded.length} rows, ${table} has ${mirror.length}`);
    for (const row of encoded) {
      if (row.length !== columns.length) {
        out.push(`${name}: a row has ${row.length} values, the fixture has ${columns.length} columns`);
        continue;
      }
      const asRow = Object.fromEntries(columns.map((c, i) => [c, row[i]]));
      const src = byKey.get(keyOf(asRow));
      if (!src) {
        out.push(`${name}: encoded row ${JSON.stringify(row.slice(0, 2))} matches no ${table} row`);
        continue;
      }
      for (const [i, c] of columns.entries()) {
        if (JSON.stringify(row[i]) !== JSON.stringify(src[c])) {
          out.push(`${name}: position ${i} should be ${c}=${JSON.stringify(src[c])}, the payload holds ${JSON.stringify(row[i])}`);
        }
      }
    }
    return encoded.length;
  };

  const facilities = await check('facilities', 'public.facility_public', SHAPE.facilityColumns, (r) => String(r['facility_id']));
  const wards = await check('wards', 'public.ward_public', SHAPE.wardColumns, (r) => `${String(r['facility_id'])}|${String(r['category'])}`);
  return { violations: out, facilities, wards };
}

/** Rewrites the live generator inside the test transaction. Refuses a plant that did not land. */
async function plantGenerator(tx: TransactionSql, from: string, to: string): Promise<void> {
  const [def] = await tx.unsafe<{ d: string }[]>(`select pg_get_functiondef('app.regenerate_snapshot()'::regprocedure) as d`);
  const src = def?.d ?? '';
  const count = src.split(from).length - 1;
  if (count !== 1) throw new Error(`generator plant anchor found ${count} times; the plant did not land`);
  await tx.unsafe(src.replace(from, to));
}

/** The generator's reads, writes and app.* calls, read off the live function body. */
async function surfaceViolations(tx: TransactionSql): Promise<{ violations: string[]; writes: string[]; reads: string[] }> {
  const [row] = await tx.unsafe<{ src: string }[]>(`select prosrc as src from pg_proc where oid = 'app.regenerate_snapshot()'::regprocedure`);
  const body = (row?.src ?? '').replace(/--[^\n]*/g, ' ');
  const writes = [...body.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+([a-z_]+\.[a-z_]+)/gi)].map((m) => (m[1] ?? '').toLowerCase());
  const reads = [...body.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+\.[a-z_]+)/gi)].map((m) => (m[1] ?? '').toLowerCase());
  const appCalls = [...body.matchAll(/\bapp\.([a-z_]+)\s*\(/gi)].map((m) => (m[1] ?? '').toLowerCase());
  const out: string[] = [];
  for (const w of new Set(writes)) if (!WRITES_ALLOWED.includes(w)) out.push(`the generator writes ${w}`);
  for (const r of new Set(reads)) if (!READS_ALLOWED.includes(r) && !WRITES_ALLOWED.includes(r)) out.push(`the generator reads ${r}`);
  for (const c of new Set(appCalls)) if (!APP_CALLS_ALLOWED.includes(c)) out.push(`the generator calls app.${c}()`);
  return { violations: out, writes, reads };
}

async function refusal(fn: () => Promise<unknown>): Promise<{ message: string; detail?: string | undefined }> {
  try {
    await fn();
  } catch (e) {
    const err = e as { message: string; detail?: string };
    return { message: err.message, detail: err.detail };
  }
  throw new Error('expected a refusal and the call succeeded');
}

describe('snapshot generator — 016', () => {
  test('the generated payload carries exactly the fixture columns, by value, for every mirror row', async () => {
    const r = await withRole('postgres', null, (tx) => payloadViolations(tx));
    expect(r.facilities, 'no facilities in the mirrors — the column check compared nothing').toBeGreaterThan(0);
    expect(r.wards, 'no wards in the mirrors — the column check compared nothing').toBeGreaterThan(0);
    expect(r.violations, 'the generated payload disagrees with the fixture or the mirrors').toEqual([]);
  });

  test('plant — an extra column in the generator selection is caught by the payload column check', async () => {
    const r = await withRole('postgres', null, (tx) => payloadViolations(tx), (tx) =>
      plantGenerator(tx, 'src.monitoring_state, src.updated_at\n', 'src.monitoring_state, src.updated_at, src.bed_count\n'),
    );
    expect(r.violations.join('\n')).toContain('wards: a row has 11 values, the fixture has 10 columns');
  });

  test('plant — two swapped columns in the generator selection are caught by value', async () => {
    const r = await withRole('postgres', null, (tx) => payloadViolations(tx), (tx) =>
      plantGenerator(tx, 'src.gated_by, src.state, src.source,', 'src.gated_by, src.source, src.state,'),
    );
    expect(r.violations.join('\n')).toContain('wards: position 6 should be state=');
  });

  test('v comes from the sequence and increments, and the heartbeat moves in the same transaction', async () => {
    const r = await withRole('postgres', null, async (tx) => {
      const a = await generate(tx);
      const b = await generate(tx);
      const [beat] = await tx.unsafe<{ same: boolean }[]>('select last_snapshot_at = now() as same from app.system_heartbeat');
      const [gen] = await tx.unsafe<{ same: boolean }[]>('select generated_at = now() as same from public.snapshot_current where v = $1', [b.v] as never[]);
      return { a: a.v, b: b.v, beat: beat?.same, gen: gen?.same, payloadNow: b.payload['server_now'] };
    });
    expect(r.b, 'v did not increment between two runs').toBeGreaterThan(r.a);
    expect(r.beat, 'last_snapshot_at is not this transaction’s time').toBe(true);
    expect(r.gen, 'generated_at is not this transaction’s time').toBe(true);
    expect(typeof r.payloadNow, 'the payload carries no server_now').toBe('string');
  });

  test('a gated ward is carried as gated — accepting_effective false with its gated_by', async () => {
    const r = await withRole('postgres', null, async (tx) => {
      const [gated] = await tx.unsafe<{ facility_id: string; category: string; gated_by: string }[]>(
        `select facility_id::text, category::text, gated_by::text from public.ward_public
          where accepting_effective is false and gated_by is not null order by 1, 2 limit 1`,
      );
      const { payload } = await generate(tx);
      const cols = SHAPE.wardColumns;
      const hit = ((payload['wards'] ?? []) as unknown[][]).find(
        (w) => w[cols.indexOf('facility_id')] === gated?.facility_id && w[cols.indexOf('category')] === gated?.category,
      );
      return { gated, hit, cols };
    });
    expect(r.gated, 'no gated ward in the mirror — this test would compare nothing').toBeDefined();
    expect(r.hit, 'the gated ward is absent from the snapshot').toBeDefined();
    expect(r.hit?.[r.cols.indexOf('accepting_effective')], 'the snapshot shows a gated ward as accepting').toBe(false);
    expect(r.hit?.[r.cols.indexOf('gated_by')]).toBe(r.gated?.gated_by);
  });

  test('the retention bound bites — rows older than app.snapshot_retention() are pruned in the same run', async () => {
    const r = await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`insert into public.snapshot_current (generated_at, payload)
                       select now() - app.snapshot_retention() - (g || ' hours')::interval, '{}'::jsonb
                         from generate_series(1, 5) g`);
      await tx.unsafe(`insert into public.snapshot_current (generated_at, payload)
                       select now() - interval '1 hour', '{}'::jsonb from generate_series(1, 2)`);
      const [before] = await tx.unsafe<{ old: string; total: string }[]>(
        `select count(*) filter (where generated_at < now() - app.snapshot_retention()) as old, count(*) as total from public.snapshot_current`,
      );
      await generate(tx);
      const [after] = await tx.unsafe<{ old: string; recent: string }[]>(
        `select count(*) filter (where generated_at < now() - app.snapshot_retention()) as old,
                count(*) filter (where generated_at >= now() - app.snapshot_retention()) as recent
           from public.snapshot_current`,
      );
      return { beforeOld: Number(before?.old), afterOld: Number(after?.old), afterRecent: Number(after?.recent), beforeTotal: Number(before?.total) };
    });
    expect(r.beforeOld, 'the plant did not put rows past the window').toBeGreaterThanOrEqual(5);
    expect(r.afterOld, 'rows older than the retention window survived a run').toBe(0);
    expect(r.afterRecent, 'rows inside the window were pruned, or the new row is missing').toBeGreaterThanOrEqual(3);
  });

  test('plant — rows dropped between read and encode are refused with SNAPSHOT_ROWS_DROPPED', async () => {
    const r = await withRole('postgres', null, (tx) => refusal(() => generate(tx)), (tx) =>
      plantGenerator(tx, ") ORDER BY src.facility_id, src.category), '[]'::jsonb) AS rows\n          FROM src\n",
        ") ORDER BY src.facility_id, src.category), '[]'::jsonb) AS rows\n          FROM src WHERE src.category::text <> 'A_AND_E'\n"),
    );
    expect(r.message).toContain('SNAPSHOT_ROWS_DROPPED');
    expect(r.detail).toContain('public.ward_public read');
  });

  test('plant — owned by a role without BYPASSRLS, the generator RAISES at its first read', async () => {
    const r = await withRole('postgres', null, (tx) => refusal(() => generate(tx)), async (tx) => {
      await nonBypassOwner(tx);
    });
    expect(r.message).toContain('query would be affected by row-level security policy for table "facility_public"');
  });

  test('counter-control — without row_security = off, and with a write policy on snapshot_current, the same owner publishes a silent EMPTY snapshot', async () => {
    // The hazard the attribute exists for, reproduced, so the plant above proves
    // the ATTRIBUTE makes the failure loud rather than something else. The write
    // policy is part of the plant: as built, snapshot_current has zero policies,
    // so a non-bypass owner's INSERT is refused anyway (next test). A policy
    // letting the generator's role write is the change that would turn the
    // silent read into a published empty file.
    const r = await withRole('postgres', null, async (tx) => {
      const { payload } = await generate(tx);
      const [mirror] = await tx.unsafe<{ n: string }[]>('select count(*) as n from public.ward_public');
      return { encoded: ((payload['wards'] ?? []) as unknown[]).length, mirror: Number(mirror?.n) };
    }, async (tx) => {
      await nonBypassOwner(tx);
      await tx.unsafe('alter function app.regenerate_snapshot() reset row_security');
      await tx.unsafe(`create policy zz_plant_generator_writes on public.snapshot_current
                         for all to zz_snapshot_nobypass using (true) with check (true)`);
    });
    expect(r.mirror, 'the mirror is empty, so empty output would prove nothing').toBeGreaterThan(0);
    expect(r.encoded, 'without the attribute the non-bypass owner still read rows — the plant did not reproduce the hazard').toBe(0);
  });

  test('counter-control — without row_security = off, as built, the failure lands on the snapshot write and names the wrong table', async () => {
    // Observed 2026-09-15. Zero policies on snapshot_current refuse the
    // non-bypass owner's INSERT, so today's table would not publish an empty
    // snapshot even without the attribute -- but the reads have ALREADY returned
    // zero rows silently, and the error points at snapshot_current rather than
    // at the mirror that was read wrongly. The attribute fails at the defect and
    // names it; this leg records what the fallback looks like.
    const r = await withRole('postgres', null, (tx) => refusal(() => generate(tx)), async (tx) => {
      await nonBypassOwner(tx);
      await tx.unsafe('alter function app.regenerate_snapshot() reset row_security');
    });
    expect(r.message).toContain('new row violates row-level security policy for table "snapshot_current"');
  });

  test('the generator reads only published surfaces and writes only snapshot_current and the heartbeat', async () => {
    const r = await withRole('postgres', null, (tx) => surfaceViolations(tx));
    expect(r.writes, 'no writes parsed from the generator — the check read nothing').toEqual(
      expect.arrayContaining(['public.snapshot_current', 'app.system_heartbeat']),
    );
    expect(r.reads, 'no reads parsed from the generator — the check read nothing').toEqual(
      expect.arrayContaining(['public.facility_public', 'public.ward_public']),
    );
    expect(r.violations, 'the generator reaches past its two clauses').toEqual([]);
  });

  test.each([
    ['a refresh of the rollup', '    RETURN v_v;', '    PERFORM app.refresh_lga_rollup();\n    RETURN v_v;', 'the generator calls app.refresh_lga_rollup()'],
    ['a write to another published surface', '    RETURN v_v;', '    DELETE FROM public.lga_rollup WHERE false;\n    RETURN v_v;', 'the generator writes public.lga_rollup'],
    ['a base-table read', '    RETURN v_v;', '    PERFORM 1 FROM app.ward_status LIMIT 1;\n    RETURN v_v;', 'the generator reads app.ward_status'],
  ])('plant — %s is caught by the surface check', async (_label, from, to, expected) => {
    const r = await withRole('postgres', null, (tx) => surfaceViolations(tx), (tx) => plantGenerator(tx, from, to));
    expect(r.violations).toContain(expected);
  });

  test.each(['anon', 'authenticated'] as const)('%s select on snapshot_current is rejected — service_role only', async (role) => {
    const r = await withRole(role, null, (tx) => refusal(() => tx.unsafe('select v from public.snapshot_current limit 1')));
    expect(r.message).toContain('permission denied for table snapshot_current');
  });

  test('service_role reads snapshot_current; RLS is forced with zero policies', async () => {
    const r = await withRole('service_role', null, async (tx) => {
      const [n] = await tx.unsafe<{ n: string }[]>('select count(*) as n from public.snapshot_current');
      return Number(n?.n);
    }, async (tx) => {
      await tx.unsafe(`insert into public.snapshot_current (generated_at, payload) values (now(), '{}'::jsonb)`);
    });
    expect(r, 'service_role could not read the row the setup wrote').toBeGreaterThanOrEqual(1);
    const cat = await withRole('postgres', null, async (tx) => {
      const [c] = await tx.unsafe<{ enabled: boolean; forced: boolean; policies: string }[]>(
        `select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
                (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'snapshot_current') as policies
           from pg_class c where c.oid = 'public.snapshot_current'::regclass`,
      );
      return c;
    });
    expect(cat?.enabled).toBe(true);
    expect(cat?.forced).toBe(true);
    expect(Number(cat?.policies), 'a policy on snapshot_current opens a second serving path').toBe(0);
  });

  test('EXECUTE on the generator and the retention constant is held by the owner only', async () => {
    const rows = await withRole('postgres', null, (tx) =>
      tx.unsafe<{ fn: string; role: string; ok: boolean }[]>(
        `select f as fn, r as role, has_function_privilege(r, f::regprocedure, 'EXECUTE') as ok
           from unnest(array['app.regenerate_snapshot()', 'app.snapshot_retention()']) f,
                unnest(array['anon', 'authenticated', 'service_role']) r
          order by 1, 2`,
      ),
    );
    expect(rows.length, 'the privilege check enumerated nothing').toBe(6);
    expect(rows.filter((x) => x.ok).map((x) => `${x.role}:${x.fn}`), 'a client role can run the generator').toEqual([]);
  });
});

/**
 * Hands the generator to a fresh role WITHOUT BYPASSRLS that holds every table
 * privilege the generator needs, so the only thing standing between it and the
 * mirrors is RLS. Rolled back with the test.
 */
async function nonBypassOwner(tx: TransactionSql): Promise<void> {
  await tx.unsafe('create role zz_snapshot_nobypass nologin nobypassrls');
  await tx.unsafe('grant zz_snapshot_nobypass to postgres');
  await tx.unsafe('grant usage on schema app, public to zz_snapshot_nobypass');
  // ALTER FUNCTION ... OWNER TO needs the new owner to hold CREATE on the
  // function's schema (observed: "permission denied for schema app" without it).
  await tx.unsafe('grant create on schema app to zz_snapshot_nobypass');
  await tx.unsafe('grant select on public.facility_public, public.ward_public to zz_snapshot_nobypass');
  await tx.unsafe('grant select, insert, delete on public.snapshot_current to zz_snapshot_nobypass');
  await tx.unsafe(`grant usage on sequence ${'public.snapshot_current_v_seq'} to zz_snapshot_nobypass`);
  await tx.unsafe('grant select, update on app.system_heartbeat to zz_snapshot_nobypass');
  await tx.unsafe('grant execute on function app.snapshot_retention() to zz_snapshot_nobypass');
  await tx.unsafe('alter function app.regenerate_snapshot() owner to zz_snapshot_nobypass');
}
