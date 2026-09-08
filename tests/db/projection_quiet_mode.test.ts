import { describe, expect, test } from 'vitest';
import { sql, withRole } from '../setup/db.js';
import type { TransactionSql } from 'postgres';

/**
 * QUIET MODE -- a quiet facility has NO ROW in either public mirror.
 *
 * Not a filtered row. Not a redacted row. No row. That is why it is enforced in
 * the PROJECTION and not as an RLS policy: a policy filters rows for a reader,
 * and what is required is that the data never reaches the published table at all.
 *
 * The facility's contribution survives only inside public.lga_rollup, behind the
 * k-floor.
 */

const FAC = 'ffffffff-0000-4000-8000-000000000001';

async function seed(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, quiet_mode)
    values ('${FAC}','Quiet Under Test','Eti-Osa','Lagos',6.45,3.42,'+2348000000096', false)
  `);
  await tx.unsafe(`insert into app.facility_ops (facility_id) values ('${FAC}')`);
  await tx.unsafe(`
    insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state)
    values ('${FAC}','ICU','OFFERED',5,true,'ACTIVE'),
           ('${FAC}','A_AND_E','OFFERED',2,true,'ACTIVE')
  `);
}

describe('quiet mode', () => {
  test('flipping a visible facility to quiet removes it from both mirrors', async () => {
    await withRole('postgres', null, async (tx) => {
      const before = await tx.unsafe<{ n: number }[]>(
        `select count(*)::int as n from public.ward_public where facility_id='${FAC}'`,
      );
      expect(before[0]?.n, 'fixture did not publish — the test would pass vacuously').toBe(2);

      await tx.unsafe(`update app.facility set quiet_mode=true where id='${FAC}'`);

      const wards = await tx.unsafe<{ n: number }[]>(
        `select count(*)::int as n from public.ward_public where facility_id='${FAC}'`,
      );
      const facs = await tx.unsafe<{ n: number }[]>(
        `select count(*)::int as n from public.facility_public where facility_id='${FAC}'`,
      );
      expect(wards[0]?.n).toBe(0);
      expect(facs[0]?.n).toBe(0);
    }, seed);
  });

  test('flipping back restores it — quiet mode is reversible, not destructive', async () => {
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`update app.facility set quiet_mode=true where id='${FAC}'`);
      await tx.unsafe(`update app.facility set quiet_mode=false where id='${FAC}'`);
      const rows = await tx.unsafe<{ n: number }[]>(
        `select count(*)::int as n from public.ward_public where facility_id='${FAC}'`,
      );
      expect(rows[0]?.n).toBe(2);
    }, seed);
  });

  test('no seeded quiet facility appears in either mirror', async () => {
    // Against the committed seed, which contains six quiet facilities.
    const [wards] = await sql()<{ n: number }[]>`
      select count(*)::int as n
        from public.ward_public w
        join app.facility f on f.id = w.facility_id
       where f.quiet_mode
    `;
    const [facs] = await sql()<{ n: number }[]>`
      select count(*)::int as n
        from public.facility_public p
        join app.facility f on f.id = p.facility_id
       where f.quiet_mode
    `;
    expect(wards?.n, 'a quiet facility leaked into ward_public').toBe(0);
    expect(facs?.n, 'a quiet facility leaked into facility_public').toBe(0);
  });

  test('the seed actually contains quiet facilities — the guard is not vacuous', async () => {
    const [row] = await sql()<{ n: number }[]>`
      select count(*)::int as n from app.facility where quiet_mode
    `;
    expect(row?.n, 'no quiet facilities in the seed; the leak tests prove nothing').toBeGreaterThanOrEqual(5);
  });
});
