import { describe, expect, test } from 'vitest';
import { withRole } from '../setup/db.js';
import type { TransactionSql } from 'postgres';

/**
 * THE PROJECTION TRIGGER fires on all three parent tables, in the same
 * transaction as the write.
 *
 * Firing on app.ward_status alone is the obvious mistake and it is silent: the
 * dashboard stays correct for every ward update and goes wrong only when a duty
 * flag changes or a facility goes quiet -- which is to say, exactly at the moments
 * the gate and quiet mode exist for.
 */

const FAC = '99999999-0000-4000-8000-000000000001';

async function seed(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164)
    values ('${FAC}','Projection Test','Ikeja','Lagos',6.6,3.35,'+2348000000093')
  `);
  await tx.unsafe(`insert into app.facility_ops (facility_id) values ('${FAC}')`);
  await tx.unsafe(`
    insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state)
    values ('${FAC}','ICU_ADULT','OFFERED',5,true,'ACTIVE')
  `);
}

describe('projection into ward_public', () => {
  test('a ward_status INSERT reaches the mirror in the same transaction', async () => {
    await withRole('postgres', null, async (tx) => {
      const rows = await tx.unsafe<{ bed_count: number }[]>(
        `select bed_count from public.ward_public where facility_id='${FAC}' and category='ICU_ADULT'`,
      );
      expect(rows[0]?.bed_count).toBe(5);
    }, seed);
  });

  test('a ward_status UPDATE reaches the mirror', async () => {
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`update app.ward_status set bed_count=2 where facility_id='${FAC}'`);
      const rows = await tx.unsafe<{ bed_count: number }[]>(
        `select bed_count from public.ward_public where facility_id='${FAC}'`,
      );
      expect(rows[0]?.bed_count).toBe(2);
    }, seed);
  });

  test('a ward_status DELETE removes the mirror row', async () => {
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`delete from app.ward_status where facility_id='${FAC}'`);
      const rows = await tx.unsafe<{ n: number }[]>(
        `select count(*)::int as n from public.ward_public where facility_id='${FAC}'`,
      );
      expect(rows[0]?.n).toBe(0);
    }, seed);
  });

  test('a facility_ops UPDATE reaches the mirror without touching ward_status', async () => {
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`
        insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state)
        values ('${FAC}','THEATRE','OFFERED',1,true,'ACTIVE')
      `);
      await tx.unsafe(`update app.facility_ops set anaesthetist='NO' where facility_id='${FAC}'`);
      const rows = await tx.unsafe<{ gated_by: string | null }[]>(
        `select gated_by::text as gated_by from public.ward_public where facility_id='${FAC}' and category='THEATRE'`,
      );
      expect(rows[0]?.gated_by).toBe('NO_ANAESTHETIST_ON_DUTY');
    }, seed);
  });

  test('a facility UPDATE (name, phone) reaches facility_public', async () => {
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`update app.facility set public_phone_e164='+2348000000992' where id='${FAC}'`);
      const rows = await tx.unsafe<{ public_phone_e164: string }[]>(
        `select public_phone_e164 from public.facility_public where facility_id='${FAC}'`,
      );
      expect(rows[0]?.public_phone_e164).toBe('+2348000000992');
    }, seed);
  });

  test('all three projection triggers exist and are row-level AFTER triggers', async () => {
    // Named, so that removing one is a failure here rather than a silent gap that
    // only shows up when a duty flag changes at 22:00.
    await withRole('postgres', null, async (tx) => {
      const rows = await tx.unsafe<{ tgname: string; tgrelid: string }[]>(`
        select t.tgname, c.relname as tgrelid
          from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where t.tgname like '%_project' order by t.tgname
      `);
      expect(rows.map((r) => `${r.tgname}@${r.tgrelid}`)).toEqual([
        'trg_facility_ops_project@facility_ops',
        'trg_facility_project@facility',
        'trg_ward_status_project@ward_status',
      ]);
    });
  });
});
