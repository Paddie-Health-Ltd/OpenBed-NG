import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sqlSecond, withRole } from '../setup/db.js';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';

/**
 * THE SNAPSHOT CANNOT CARRY A WARD WITHOUT ITS FACILITY (R-2026-09-23-66 A1-A3).
 *
 * THE RACE, AND WHY IT HAS TO BE FORCED. 016's generator read public.facility_public
 * in one statement and public.ward_public in the next. Under READ COMMITTED each
 * statement takes a fresh snapshot, so a facility and its wards committed BETWEEN
 * the two -- 008 writes them in one transaction -- land in the second read and not
 * the first: the payload carries a ward whose facility it does not carry, and the
 * dashboard used to print "(unknown facility)" beside its count. The window is a
 * few microseconds, so waiting for it would test nothing. It is forced instead:
 *
 *   - connection B takes advisory lock K;
 *   - connection A runs a PLANTED COPY of a generator body with
 *     `PERFORM pg_advisory_xact_lock(K)` at a chosen seam, and blocks there;
 *   - the test waits until pg_locks shows A waiting on K -- a reading, not a sleep;
 *   - B COMMITS a newly visible facility and ward through app.*, then releases K;
 *   - A finishes, and the test reads its payload.
 *
 * RED: 016's body, taken from its file, with the lock between READ 1 and READ 2.
 * GREEN: 019's body, taken from ITS file, with the lock at each of its only two
 * seams -- before the one read statement and after it. A single statement has no
 * inside seam to put a lock in; that is the fix, and a structural leg asserts the
 * live generator still has that shape.
 *
 * AND THE CONSTRAINTS THAT MAKE THE ORPHAN UNREPRESENTABLE IN THE MIRRORS THEMSELVES:
 * the FK refuses a ward row for an absent facility, and the name CHECK refuses a
 * blank name in every form observed to pass `btrim`.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - that the FK stops the RACE. It does not, and could not: the race is a read
 *     skew across two snapshots, not a stored orphan. B's rows satisfy the FK. The
 *     RED leg below runs WITH the FK in place, which is the proof that the single
 *     read, not the constraint, is what closes it.
 *   - the hosted ctype. Whether [:space:] matches U+00A0 depends on it; the plant
 *     below is observed on the local stack only.
 */

const MIG = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const FILE_016 = join(MIG, '016_snapshot.sql');
const FILE_019 = join(MIG, '019_snapshot_single_read_and_mirror_integrity.sql');

const K = 190023;
const FAC = '99999999-0000-4000-8000-0000000019a1';
const FAC_NAME = 'Race Probe Facility';

/** The generator's CREATE statement as written in a migration file. */
function generatorFrom(file: string): string {
  const text = readFileSync(file, 'utf8');
  const m = /^CREATE OR REPLACE FUNCTION app\.regenerate_snapshot\(\)[\s\S]*?^\$FN\$;$/m.exec(text);
  if (m === null) throw new Error(`no app.regenerate_snapshot() definition in ${file}`);
  return m[0];
}

/** A renamed copy of a generator with an advisory-lock wait inserted before `anchor`. Refuses a plant that did not land. */
function plantedRace(body: string, anchor: string): string {
  const count = body.split(anchor).length - 1;
  if (count !== 1) throw new Error(`race anchor found ${count} times; the plant did not land: ${anchor}`);
  return body
    .replace('FUNCTION app.regenerate_snapshot()', 'FUNCTION app.zz_race_generator()')
    .replace(anchor, `    PERFORM pg_advisory_xact_lock(${K});\n${anchor}`);
}

/** Every statement of a plpgsql body that reads a mirror, keyed by mirror. */
export function mirrorReadStatements(prosrc: string): { facility: number[]; ward: number[] } {
  const statements = prosrc.replace(/--[^\n]*/g, ' ').split(';');
  const hits = (table: string) => statements.flatMap((s, i) => (new RegExp(`\\bFROM\\s+${table}\\b`, 'i').test(s) ? [i] : []));
  return { facility: hits('public\\.facility_public'), ward: hits('public\\.ward_public') };
}

type Payload = { facilities: unknown[][]; wards: unknown[][] };

async function waitUntilAWaits(): Promise<void> {
  const B = sqlSecond();
  for (let i = 0; i < 200; i += 1) {
    const [row] = await B<{ waiting: boolean }[]>`
      select exists (select 1 from pg_locks where locktype = 'advisory' and objid = ${K} and not granted) as waiting`;
    if (row?.waiting) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`connection A never waited on advisory lock ${K} -- the planted seam was not reached`);
}

/**
 * Runs `plantedSql` on connection A while B commits a new facility and ward at the
 * seam. Returns A's payload. Always releases K and removes B's rows.
 */
async function race(plantedSql: string): Promise<Payload> {
  const B = sqlSecond();
  await B`select pg_advisory_lock(${K})`;
  let released = false;
  const a = withRole('postgres', null, async (tx) => {
    const [out] = await tx.unsafe<{ v: string }[]>('select app.zz_race_generator() as v');
    const [row] = await tx.unsafe<{ payload: Payload }[]>('select payload from public.snapshot_current where v = $1', [out?.v] as never[]);
    if (!row) throw new Error('the planted generator wrote no row');
    return row.payload;
  }, async (tx) => {
    await tx.unsafe(plantedSql);
  });
  a.catch(() => undefined);
  try {
    await waitUntilAWaits();
    await B.begin(async (t) => {
      await t.unsafe(`insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164)
                      values ('${FAC}', '${FAC_NAME}', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000019')`);
      await t.unsafe(`insert into app.facility_ops (facility_id) values ('${FAC}')`);
      await t.unsafe(`insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state)
                      values ('${FAC}', 'ICU_ADULT', 'OFFERED', 5, true, 'ACTIVE')`);
    });
    await B`select pg_advisory_unlock(${K})`;
    released = true;
    return await a;
  } finally {
    if (!released) await B`select pg_advisory_unlock(${K})`;
    await B.unsafe(`delete from app.facility where id = '${FAC}'`);
  }
}

function read(p: Payload): { orphans: string[]; facilityPresent: boolean; wardPresent: boolean } {
  const fid = SHAPE.facilityColumns.indexOf('facility_id');
  const wid = SHAPE.wardColumns.indexOf('facility_id');
  const cat = SHAPE.wardColumns.indexOf('category');
  const facilities = new Set(p.facilities.map((f) => String(f[fid])));
  const orphans = p.wards.filter((w) => !facilities.has(String(w[wid]))).map((w) => `${String(w[wid])}|${String(w[cat])}`);
  return {
    orphans,
    facilityPresent: facilities.has(FAC),
    wardPresent: p.wards.some((w) => String(w[wid]) === FAC),
  };
}

describe('the snapshot reads both mirrors from one snapshot — 019', () => {
  test('RED on 016 — a facility committed between the two reads leaves its ward orphaned in the payload', async () => {
    const r = read(await race(plantedRace(generatorFrom(FILE_016), '    -- READ 2: public.ward_public, the same way.')));
    expect(r.orphans, 'the two-statement generator did not tear — the seam did not reproduce the race').toContain(`${FAC}|ICU_ADULT`);
    expect(r.facilityPresent, 'READ 1 saw the facility, so B committed before it and the race was not staged').toBe(false);
  });

  test('GREEN on 019 — the same commit at the seam BEFORE the one read: facility and ward arrive together', async () => {
    const r = read(await race(plantedRace(generatorFrom(FILE_019), '    -- ONE READ: both mirrors, in one statement')));
    expect(r.orphans, 'the single-read generator produced an orphan').toEqual([]);
    expect([r.facilityPresent, r.wardPresent], 'the commit before the read was not seen whole').toEqual([true, true]);
  });

  test('GREEN on 019 — the same commit at the seam AFTER the one read: neither arrives, and nothing is orphaned', async () => {
    const r = read(await race(plantedRace(generatorFrom(FILE_019), '    IF jsonb_array_length(v_facilities) <> v_fac_read THEN')));
    expect(r.orphans, 'the single-read generator produced an orphan').toEqual([]);
    expect([r.facilityPresent, r.wardPresent], 'a commit after the read leaked into it').toEqual([false, false]);
  });

  test('the live generator reads both mirrors in exactly one statement, and 016 did not', async () => {
    const live = await withRole('postgres', null, async (tx) => {
      const [row] = await tx.unsafe<{ src: string }[]>(`select prosrc as src from pg_proc where oid = 'app.regenerate_snapshot()'::regprocedure`);
      return row?.src ?? '';
    });
    const now = mirrorReadStatements(live);
    expect(now.facility.length, 'the live generator does not read facility_public exactly once').toBe(1);
    expect(now.ward, 'the two mirrors are read in different statements').toEqual(now.facility);

    // PLANT: the checker over 016's own body must see two statements.
    const old = mirrorReadStatements(generatorFrom(FILE_016));
    expect(old.facility.length).toBe(1);
    expect(old.ward, "the checker cannot tell 016's two statements from one").not.toEqual(old.facility);
  });
});

describe('the mirrors and the facility name refuse what the page must not show — 019', () => {
  test('plant — a ward_public row for an absent facility is refused by ward_public_facility_id_fkey', async () => {
    // A REAL row re-pointed at an absent facility, so every other column is one the
    // table already accepts: the first version of this plant guessed an enum label,
    // failed with 22P02 before the FK was consulted, and proved nothing.
    const r = await withRole('postgres', null, async (tx) => {
      const [src] = await tx.unsafe<{ n: string }[]>('select count(*) as n from public.ward_public');
      if (Number(src?.n) === 0) return { code: 'no source row', constraint: undefined };
      try {
        await tx.unsafe(`insert into public.ward_public
          select '99999999-0000-4000-8000-0000000019ff'::uuid, category, offering, bed_count, accepting_effective,
                 gated_by, state, source, monitoring_state, updated_at
            from public.ward_public limit 1`);
      } catch (e) {
        const err = e as { code?: string; constraint_name?: string };
        return { code: err.code, constraint: err.constraint_name };
      }
      return { code: 'accepted', constraint: undefined };
    });
    expect(r.code, 'an orphan ward row was stored').toBe('23503');
    expect(r.constraint).toBe('ward_public_facility_id_fkey');
  });

  test.each([
    ['empty', ''],
    ['spaces', '   '],
    ['a tab', '\t'],
    ['a newline between spaces', ' \n '],
    ['a no-break space (local ctype only)', ' '],
  ])('plant — a facility name that is %s is refused by facility_name_not_blank', async (_label, name) => {
    const r = await withRole('postgres', null, async (tx) => {
      try {
        await tx.unsafe(`insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164)
                         values ('99999999-0000-4000-8000-0000000019b1', $1, 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000019')`, [name] as never[]);
      } catch (e) {
        const err = e as { code?: string; constraint_name?: string };
        return { code: err.code, constraint: err.constraint_name };
      }
      return { code: 'accepted', constraint: undefined };
    });
    expect(r.code, `a blank facility name (${JSON.stringify(name)}) was stored`).toBe('23514');
    expect(r.constraint).toBe('facility_name_not_blank');
  });

  test('positive control — an ordinary facility name is accepted, and renaming it to blank is refused', async () => {
    const r = await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164)
                       values ('99999999-0000-4000-8000-0000000019b2', 'Synthetic General Hospital', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000019')`);
      try {
        await tx.unsafe(`update app.facility set name = '  ' where id = '99999999-0000-4000-8000-0000000019b2'`);
      } catch (e) {
        return (e as { constraint_name?: string }).constraint_name;
      }
      return 'rename accepted';
    });
    expect(r).toBe('facility_name_not_blank');
  });
});
