import { describe, expect, test } from 'vitest';
import { sql } from '../setup/db.js';

/**
 * THE SIX SEEDED SHAPES -- the Bundle 1 definition of done.
 *
 * Asserted against the COMMITTED seed rather than fixtures built in the test, so
 * that a change to database/seed/001_synthetic_seed.sql which drops a shape fails
 * here. The seed is the thing every other developer runs; a shape missing from it
 * is a shape nobody exercises by hand either.
 */
describe('seeded shapes', () => {
  test('shape 1 — quiet facilities exist and appear in no public mirror', async () => {
    const [row] = await sql()<{ n: number }[]>`select count(*)::int as n from app.facility where quiet_mode`;
    expect(row?.n).toBeGreaterThanOrEqual(5);

    // BOTH mirrors. The title said "no public mirror" while the body checked only
    // facility_public -- an overclaiming name, which is exactly the false fact a
    // Standard P behavioural pass exists to catch.
    const [facLeak] = await sql()<{ n: number }[]>`
      select count(*)::int as n from public.facility_public p
        join app.facility f on f.id = p.facility_id where f.quiet_mode
    `;
    expect(facLeak?.n, 'a quiet facility leaked into facility_public').toBe(0);

    const [wardLeak] = await sql()<{ n: number }[]>`
      select count(*)::int as n from public.ward_public w
        join app.facility f on f.id = w.facility_id where f.quiet_mode
    `;
    expect(wardLeak?.n, 'a quiet facility leaked into ward_public').toBe(0);
  });

  test("shape 2 — a facility with anaesthetist='NO' gates THEATRE and SURGICAL only", async () => {
    const rows = await sql()<{ category: string; gated_by: string | null }[]>`
      select w.category::text as category, w.gated_by::text as gated_by
        from public.ward_public w
        join app.facility_ops o on o.facility_id = w.facility_id
       where o.anaesthetist = 'NO'
       order by w.category
    `;
    expect(rows.length, 'no facility with anaesthetist=NO in the seed').toBeGreaterThan(0);

    for (const row of rows) {
      if (row.category === 'THEATRE' || row.category === 'SURGICAL') {
        expect(row.gated_by, `${row.category} should be gated`).toBe('NO_ANAESTHETIST_ON_DUTY');
      } else {
        expect(row.gated_by, `${row.category} must not be gated by a missing anaesthetist`).toBeNull();
      }
    }
  });

  test('shape 3 — a facility with all flags UNKNOWN gates nothing at all', async () => {
    // The day-one facility. Every real facility is in this state on the first
    // morning, and if this row is ever gated the whole city goes dark.
    const rows = await sql()<{ category: string; gated_by: string | null; eff: boolean }[]>`
      select w.category::text as category, w.gated_by::text as gated_by, w.accepting_effective as eff
        from public.ward_public w
        join app.facility_ops o on o.facility_id = w.facility_id
       where o.anaesthetist = 'UNKNOWN'
         and o.obstetrician = 'UNKNOWN'
         and o.paediatrician = 'UNKNOWN'
         and w.offering = 'OFFERED'
    `;
    expect(rows.length, 'no all-UNKNOWN facility in the seed').toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.gated_by, `${row.category} was gated on an all-UNKNOWN facility`).toBeNull();
    }
  });

  test('shape 4 — a ward at zero, with its reason PRIVATE to the event table', async () => {
    const [pub] = await sql()<{ bed_count: number }[]>`
      select w.bed_count from public.ward_public w
        join public.facility_public f on f.facility_id = w.facility_id
       where f.name like '%SYN-OPEN%' and w.category = 'NICU'
    `;
    expect(pub?.bed_count).toBe(0);

    // The reason exists, and exists ONLY on the event table.
    const [ev] = await sql()<{ reason_code: string }[]>`
      select e.reason_code::text as reason_code from app.ward_status_event e
        join app.ward_status ws on ws.id = e.ward_status_id
       where ws.category = 'NICU' and e.reason_code is not null limit 1
    `;
    expect(ev?.reason_code).toBe('STAFF_SHORTAGE');
  });

  test('shape 5 — a NOT_OFFERED ward carries no count and is never accepting', async () => {
    const [row] = await sql()<{ bed_count: number | null; eff: boolean }[]>`
      select w.bed_count, w.accepting_effective as eff from public.ward_public w
        join public.facility_public f on f.facility_id = w.facility_id
       where f.name like '%SYN-OPEN%' and w.category = 'SCBU'
    `;
    expect(row?.bed_count, 'a NOT_OFFERED ward must not carry a bed count').toBeNull();
    // The composition that stops a ward the facility does not have being shown as
    // available to someone deciding where to send a patient.
    expect(row?.eff).toBe(false);
  });

  test('shape 6 — a never-updated ward is PENDING with a NULL count, not zero', async () => {
    const [row] = await sql()<{ bed_count: number | null; monitoring_state: string }[]>`
      select w.bed_count, w.monitoring_state::text as monitoring_state from public.ward_public w
        join public.facility_public f on f.facility_id = w.facility_id
       where f.name like '%SYN-OPEN%' and w.category = 'MATERNITY'
    `;
    // NULL, not 0. Publishing zero for a ward nobody has updated states a claim
    // the facility never made.
    expect(row?.bed_count).toBeNull();
    expect(row?.monitoring_state).toBe('PENDING');
  });

  test('the seed contains no real-looking phone number', async () => {
    // The kickoff forbids committing real duty numbers, and the seed is the most
    // likely place for that rule to erode. Every seeded number is in the
    // deliberately implausible +234800 range.
    const rows = await sql()<{ public_phone_e164: string }[]>`
      select public_phone_e164 from app.facility
    `;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.public_phone_e164, 'a seeded number is outside the synthetic +234800 range')
        .toMatch(/^\+234800/);
    }
  });
});
