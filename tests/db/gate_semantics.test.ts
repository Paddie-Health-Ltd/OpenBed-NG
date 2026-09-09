import { describe, expect, test } from 'vitest';
import { withRole } from '../setup/db.js';
import type { TransactionSql } from 'postgres';

/**
 * GATE SEMANTICS end-to-end, through the projection rather than through
 * app.gate() alone.
 *
 * tests/db/gate_truth_table.test.ts proves the two DERIVATIONS agree. This file
 * proves the three behaviours the kickoff names, as observed in
 * public.ward_public -- which is what a user actually sees, and where a correct
 * gate can still be wired up wrongly.
 */

const FAC = 'eeeeeeee-0000-4000-8000-000000000001';

async function seed(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164)
    values ('${FAC}','Gate Semantics','Ikeja','Lagos',6.6,3.35,'+2348000000097')
  `);
  await tx.unsafe(`insert into app.facility_ops (facility_id) values ('${FAC}')`);
  await tx.unsafe(`
    insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state)
    values ('${FAC}','THEATRE','OFFERED',3,true,'ACTIVE'),
           ('${FAC}','SURGICAL','OFFERED',4,true,'ACTIVE'),
           ('${FAC}','NICU','OFFERED',2,true,'ACTIVE')
  `);
}

interface MirrorRow { category: string; accepting_effective: boolean; gated_by: string | null }

async function mirror(tx: TransactionSql): Promise<Record<string, MirrorRow>> {
  const rows = await tx.unsafe<MirrorRow[]>(`
    select category::text as category, accepting_effective, gated_by::text as gated_by
      from public.ward_public where facility_id = '${FAC}'
  `);
  return Object.fromEntries(rows.map((r) => [r.category, r]));
}

describe('gate semantics through the projection', () => {
  test("anaesthetist='NO' closes THEATRE and SURGICAL while the ward's claim stays true", async () => {
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`update app.facility_ops set anaesthetist='NO' where facility_id='${FAC}'`);
      const m = await mirror(tx);

      expect(m['THEATRE']?.accepting_effective).toBe(false);
      expect(m['THEATRE']?.gated_by).toBe('NO_ANAESTHETIST_ON_DUTY');
      expect(m['SURGICAL']?.accepting_effective).toBe(false);

      // The cross-gate case: a missing anaesthetist does not close a neonatal unit.
      expect(m['NICU']?.accepting_effective).toBe(true);
      expect(m['NICU']?.gated_by).toBeNull();

      // FINDING F1: the ward's own claim is untouched in the base table.
      const claims = await tx.unsafe<{ category: string; accepting: boolean }[]>(
        `select category::text as category, accepting from app.ward_status where facility_id='${FAC}'`,
      );
      for (const row of claims) {
        expect(row.accepting, `${row.category}'s stored claim was modified by the gate`).toBe(true);
      }
    }, seed);
  });

  test('flipping the flag back to UNKNOWN restores the ward with ZERO writes to ward_status', async () => {
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`update app.facility_ops set anaesthetist='NO' where facility_id='${FAC}'`);
      const before = await tx.unsafe<{ v: number }[]>(
        `select sum(version)::int as v from app.ward_status where facility_id='${FAC}'`,
      );

      await tx.unsafe(`update app.facility_ops set anaesthetist='UNKNOWN' where facility_id='${FAC}'`);
      const m = await mirror(tx);

      expect(m['THEATRE']?.accepting_effective).toBe(true);
      expect(m['THEATRE']?.gated_by).toBeNull();

      // The whole point of deriving rather than storing. If restoring required a
      // human to re-publish a number that never changed, it would not happen --
      // and the ward would sit closed until someone noticed.
      const after = await tx.unsafe<{ v: number }[]>(
        `select sum(version)::int as v from app.ward_status where facility_id='${FAC}'`,
      );
      expect(after[0]?.v, 'ward_status was written to during un-gating').toBe(before[0]?.v);
    }, seed);
  });

  test("anaesthetist='YES' never promotes a ward that said it is not accepting", async () => {
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`update app.ward_status set accepting=false where facility_id='${FAC}' and category='THEATRE'`);
      await tx.unsafe(`update app.facility_ops set anaesthetist='YES' where facility_id='${FAC}'`);
      const m = await mirror(tx);

      // The gate reduces only. There is no arrangement of duty flags that opens
      // a ward which said no.
      expect(m['THEATRE']?.accepting_effective).toBe(false);
      expect(m['THEATRE']?.gated_by).toBeNull();
    }, seed);
  });

  test('a facility with NO facility_ops row publishes its wards ungated', async () => {
    // The LEFT JOIN case. An inner join here would make every ward at a facility
    // that has never recorded duty cover silently vanish from the dashboard --
    // and absence of a claim must never read as a negative claim.
    await withRole('postgres', null, async (tx) => {
      await tx.unsafe(`delete from app.facility_ops where facility_id='${FAC}'`);
      const m = await mirror(tx);
      expect(Object.keys(m).sort()).toEqual(['NICU', 'SURGICAL', 'THEATRE']);
      for (const row of Object.values(m)) {
        expect(row.gated_by).toBeNull();
        expect(row.accepting_effective).toBe(true);
      }
    }, seed);
  });
});
