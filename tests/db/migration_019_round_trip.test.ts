import { afterAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, psqlCommand } from '../setup/db.js';

/**
 * MIGRATION 019 REVERSES TO EXACTLY THE 018 STATE, AND ITS PRE-CHECKS NAME WHAT THEY FIND.
 *
 * 019 changes three things (R-2026-09-23-66 A1-A3): the generator's body (one
 * read statement), a foreign key on public.ward_public, and a CHECK on
 * app.facility.name. The state compared here is exactly those three plus the
 * ledger row, in the idiom of tests/db/migration_018_round_trip.test.ts:
 *   - the generator's prosrc, compared BY VALUE with the body written in 016 or
 *     019 -- not "some body", so a reversal that left 019's body in place, or
 *     restored a paraphrase of 016's, is refused;
 *   - both constraints by name, with convalidated and condeferrable;
 *   - the ledger row.
 *
 * AND THE PRE-CHECKS, which exist so a hosted apply over data that already
 * violates a constraint stops with the rows NAMED rather than with a bare
 * constraint error. Each is planted: 019 is reversed, a violating row is
 * COMMITTED, and the forward apply must fail naming it. The row is removed and
 * 019 re-applied in a `finally`.
 *
 * SAFE ON THE SHARED DATABASE for the reason 018's file gives: the db project
 * runs files one at a time, and every leg restores 019 in a `finally`, with an
 * unconditional `afterAll` behind it.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const FORWARD = join(MIG_DIR, '019_snapshot_single_read_and_mirror_integrity.sql');
const DOWN = join(MIG_DIR, '019_snapshot_single_read_and_mirror_integrity.down.sql');
const LEDGER = '019_snapshot_single_read_and_mirror_integrity.sql';

function applyFile(path: string): void {
  const cmd = `${psqlCommand()} -v ON_ERROR_STOP=1 --single-transaction < ${JSON.stringify(path)}`;
  execFileSync('bash', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The error text of an apply that must fail. Throws if it succeeds. */
function applyFailure(path: string): string {
  try {
    applyFile(path);
  } catch (e) {
    const err = e as { stderr?: Buffer | string };
    return String(err.stderr ?? '');
  }
  throw new Error(`${path} applied, and it was expected to refuse`);
}

/** The body between `AS $FN$` and `$FN$;` of the generator as a file writes it. */
function bodyFrom(file: string): string {
  const text = readFileSync(join(MIG_DIR, file), 'utf8');
  const m = /^CREATE OR REPLACE FUNCTION app\.regenerate_snapshot\(\)[\s\S]*?AS \$FN\$([\s\S]*?)^\$FN\$;$/m.exec(text);
  if (m === null) throw new Error(`no generator body in ${file}`);
  return m[1] ?? '';
}

const BODY_016 = bodyFrom('016_snapshot.sql');
const BODY_019 = bodyFrom('019_snapshot_single_read_and_mirror_integrity.sql');

async function state(): Promise<{ body: string; constraints: string[]; ledger: number }> {
  const [fn] = await sql()<{ src: string }[]>`select prosrc as src from pg_proc where oid = 'app.regenerate_snapshot()'::regprocedure`;
  const constraints = await sql()<{ row: string }[]>`
    select conname || ' validated=' || convalidated || ' deferrable=' || condeferrable as row
      from pg_constraint
     where conname in ('ward_public_facility_id_fkey', 'facility_name_not_blank')
     order by conname`;
  const [ledger] = await sql()<{ n: number }[]>`select count(*)::int as n from app.schema_migrations where filename = ${LEDGER}`;
  return { body: fn?.src ?? '', constraints: constraints.map((c) => c.row), ledger: ledger?.n ?? -1 };
}

const STATE_019 = {
  body: BODY_019,
  constraints: ['facility_name_not_blank validated=true deferrable=false', 'ward_public_facility_id_fkey validated=true deferrable=false'],
  ledger: 1,
};
const STATE_018 = { body: BODY_016, constraints: [] as string[], ledger: 0 };

afterAll(() => {
  applyFile(FORWARD);
});

describe('migration 019 round trip', () => {
  test('the database starts in the 019 state — otherwise nothing below means anything', async () => {
    expect(BODY_016, 'the two bodies are identical, so the body comparison discriminates nothing').not.toBe(BODY_019);
    expect(await state()).toEqual(STATE_019);
  });

  test('down restores EXACTLY the 018 state — 016 body, no constraints, no ledger row', async () => {
    try {
      applyFile(DOWN);
      expect(await state(), 'the reversal did not land on 018 exactly').toEqual(STATE_018);
    } finally {
      applyFile(FORWARD);
    }
  });

  test('up after down restores EXACTLY the 019 state, and a re-apply changes nothing', async () => {
    applyFile(DOWN);
    applyFile(FORWARD);
    applyFile(FORWARD);
    expect(await state()).toEqual(STATE_019);
  });

  test.each([
    ['a reversal that keeps the foreign key', 'ALTER TABLE public.ward_public DROP CONSTRAINT IF EXISTS ward_public_facility_id_fkey RESTRICT;\n', ''],
    ['a reversal that leaves 019\'s generator in place', 'CREATE OR REPLACE FUNCTION app.regenerate_snapshot()', 'CREATE OR REPLACE FUNCTION app.zz_not_the_generator()'],
  ])('plant — %s is rejected by the exact-state assertion', async (_name, needle, replacement) => {
    const original = readFileSync(DOWN, 'utf8');
    expect(original, `the plant's target is not in the down file: ${needle}`).toContain(needle);
    const tampered = original.replace(needle, replacement);
    expect(tampered, 'the plant did not change the file').not.toBe(original);
    const dir = mkdtempSync(join(tmpdir(), 'openbed-019-plant-'));
    const path = join(dir, 'tampered.down.sql');
    writeFileSync(path, tampered, 'utf8');
    try {
      applyFile(path);
      const s = await state();
      // CONFIRM THE PLANT REACHED THE EXECUTED PATH: the tampered reversal must
      // not produce the correct 018 state, or the next line proves nothing.
      expect(s, 'the tampered reversal still produced the 018 state — the plant did not reach an executed statement').not.toEqual(STATE_018);
      expect(s).not.toEqual(STATE_019);
    } finally {
      await sql().unsafe('drop function if exists app.zz_not_the_generator()');
      applyFile(FORWARD);
    }
  });

  test('plant — an orphaned ward row stops the forward apply with MIRROR_ORPHANS, naming it', async () => {
    const ghost = '99999999-0000-4000-8000-0000000019c1';
    try {
      applyFile(DOWN);
      await sql().unsafe(`insert into public.ward_public
        select '${ghost}'::uuid, category, offering, bed_count, accepting_effective,
               gated_by, state, source, monitoring_state, updated_at
          from public.ward_public limit 1`);
      const err = applyFailure(FORWARD);
      expect(err, 'the forward apply did not refuse on an orphan').toContain('MIRROR_ORPHANS');
      expect(err, 'the refusal did not NAME the orphan').toContain(ghost);
    } finally {
      await sql().unsafe(`delete from public.ward_public where facility_id = '${ghost}'`);
      applyFile(FORWARD);
    }
  });

  test('plant — a blank facility name stops the forward apply with FACILITY_NAME_BLANK, naming it', async () => {
    const blank = '99999999-0000-4000-8000-0000000019c2';
    try {
      applyFile(DOWN);
      await sql().unsafe(`insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164)
                          values ('${blank}', E'\\t ', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000019')`);
      const err = applyFailure(FORWARD);
      expect(err, 'the forward apply did not refuse on a blank name').toContain('FACILITY_NAME_BLANK');
      expect(err, 'the refusal did not NAME the facility').toContain(blank);
    } finally {
      await sql().unsafe(`delete from app.facility where id = '${blank}'`);
      applyFile(FORWARD);
    }
  });
});
