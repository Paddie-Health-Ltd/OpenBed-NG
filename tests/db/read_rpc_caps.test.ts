import { describe, expect, test } from 'vitest';
import { withRole } from '../setup/db.js';
import type { TransactionSql } from 'postgres';

/**
 * THE READ RPC CAPS -- the control that stops a legitimate caller assembling a
 * facility-level time series.
 *
 * The prohibition is a PRODUCT constraint, not a privacy formality: facilities
 * that fear being graded stop telling the truth, and a dishonest bed count kills
 * someone. A table called `ward_status_event` makes a 7-day occupancy chart the
 * most natural feature in the world to offer, so the caps are structural.
 *
 * THE STRONGEST ASSERTION IN THIS FILE IS THE ONE ABOUT AN ABSENT PARAMETER.
 * `ward_status_history` has no offset argument. Not a validated one, not a capped
 * one -- none. A validated offset is one code change away from being a paging
 * loop, and a paging loop over 200-row windows reconstructs exactly the series
 * the cap exists to prevent. You cannot pass what the function does not accept.
 */

const FACILITY = 'dddddddd-0000-4000-8000-000000000001';
const USER = 'dddddddd-0000-4000-8000-0000000000aa';

/**
 * Creates a facility, an ICU ward, a WARD_STAFF ward account scoped to that ward,
 * and N history events.
 *
 * `ward_category` is mandatory for WARD_STAFF under ward_account_scope_matches_role
 * (003). The fixture now has to construct a LEGAL account, which is a tightening
 * rather than an accommodation -- the constraint is what makes a facility-less
 * account unrepresentable.
 */
async function seedFixture(tx: TransactionSql, events: number): Promise<void> {
  await tx.unsafe(`
    insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164)
    values ('${FACILITY}','Cap Test','Ikeja','Lagos',6.6,3.35,'+2348000000098')
  `);
  await tx.unsafe(`
    insert into app.ward_account (id, facility_id, ward_category, role)
    values ('${USER}','${FACILITY}','ICU_ADULT','WARD_STAFF')
  `);
  await tx.unsafe(`
    insert into app.ward_status (id, facility_id, category, offering, bed_count, accepting)
    values ('dddddddd-0000-4000-8000-0000000000bb','${FACILITY}','ICU_ADULT','OFFERED',1,true)
  `);
  await tx.unsafe(`
    insert into app.ward_status_event
      (ward_status_id, facility_id, category, offering, bed_count, accepting, state, source, version, created_at)
    select 'dddddddd-0000-4000-8000-0000000000bb','${FACILITY}','ICU_ADULT','OFFERED', g, true, 'OK','WARD', g,
           now() - (g || ' minutes')::interval
      from generate_series(1, ${events}) g
  `);
}

const CLAIMS = { sub: USER, role: 'authenticated' };

describe('read RPC caps', () => {
  test('ward_status_history returns at most 200 rows however large p_limit is', async () => {
    const n = await withRole(
      'authenticated',
      CLAIMS,
      async (tx) => {
        const rows = await tx.unsafe<{ n: number }[]>(
          `select count(*)::int as n from public.ward_status_history('ICU_ADULT', null, 100000)`,
        );
        return rows[0]?.n ?? -1;
      },
      (tx) => seedFixture(tx, 250),
    );
    expect(n).toBe(200);
  });

  test('a negative or null p_limit cannot bypass the ceiling', async () => {
    const n = await withRole(
      'authenticated',
      CLAIMS,
      async (tx) => {
        const rows = await tx.unsafe<{ n: number }[]>(
          `select count(*)::int as n from public.ward_status_history('ICU_ADULT', null, null)`,
        );
        return rows[0]?.n ?? -1;
      },
      (tx) => seedFixture(tx, 250),
    );
    expect(n).toBe(200);
  });

  test('the 30-day window is clamped, not merely defaulted', async () => {
    // Asking for a year returns 30 days. Clamped rather than rejected, because
    // rejecting would tempt a client author into retrying in 30-day slices --
    // which is the paging loop this cap exists to prevent.
    const n = await withRole(
      'authenticated',
      CLAIMS,
      async (tx) => {
        const rows = await tx.unsafe<{ n: number }[]>(
          `select count(*)::int as n
             from public.ward_status_history('ICU_ADULT', now() - interval '365 days', 200)`,
        );
        return rows[0]?.n ?? -1;
      },
      async (tx) => {
        await seedFixture(tx, 5);
        // One event well outside the window. It must not come back.
        await tx.unsafe(`
          insert into app.ward_status_event
            (ward_status_id, facility_id, category, offering, bed_count, accepting, state, source, version, created_at)
          values ('dddddddd-0000-4000-8000-0000000000bb','${FACILITY}','ICU_ADULT','OFFERED',42,true,'OK','WARD',99,
                  now() - interval '200 days')
        `);
      },
    );
    expect(n).toBe(5);
  });

  test('ward_status_history accepts no offset parameter — absence is the control', async () => {
    const names = await withRole('postgres', null, async (tx) => {
      const rows = await tx.unsafe<{ args: string }[]>(`
        select pg_get_function_identity_arguments(p.oid) as args
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'ward_status_history'
      `);
      return rows.map((r) => r.args);
    });

    expect(names.length, 'ward_status_history is missing').toBe(1);
    const args = names[0] ?? '';
    expect(args).not.toMatch(/offset/i);
    expect(args).not.toMatch(/skip/i);
    expect(args).not.toMatch(/page/i);
    // And no way to name another facility.
    expect(args).not.toMatch(/facility/i);
  });

  test('missing-context — an unauthenticated caller is rejected with 42501', async () => {
    await expect(
      withRole('authenticated', null, async (tx) => {
        await tx.unsafe(`select * from public.my_facility_wards()`);
      }),
    ).rejects.toThrow(/NOT_AUTHENTICATED/);
  });
});
