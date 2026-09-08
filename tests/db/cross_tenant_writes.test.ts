import { describe, expect, test } from 'vitest';
import { withRole } from '../setup/db.js';
import type { TransactionSql } from 'postgres';

/**
 * CROSS-TENANT ISOLATION at the RPC boundary.
 *
 * Under ward-level identity (2026-09-08) auth.uid() resolves a WARD ACCOUNT
 * rather than a person. Every assertion below is unchanged in substance -- only
 * the table name and the account's ward scope moved -- which is the CTO's claim
 * made checkable: this alters what an identity MEANS, not how it is enforced.
 *
 * app.assert_member() reads auth.uid() and NEVER trusts a facility_id argument.
 * The distinction is the whole control: a facility_id parameter is what the
 * caller WANTS to act on; auth.uid() is who they ARE, and the check is that the
 * two agree.
 *
 * THIN IN BUNDLE 1, deliberately. There is no write path yet -- Bundle 3 builds
 * it -- so this file covers the read RPCs and assert_member() directly. Bundle 3
 * adds WARD-SCOPE enforcement on writes (a WARD_STAFF account may write only its
 * own ward), which needs a p_category argument no current caller passes. The
 * cases here must keep passing unchanged when it lands; that is what makes them a
 * regression suite rather than scaffolding.
 *
 * (An earlier draft of this header said Bundle 2 would extend assert_member with
 * "device binding and shift re-identification". Both are void: there is no person
 * to re-identify, and the second-device alert was cut with app.device.fingerprint.)
 */

const FAC_A = '77777777-0000-4000-8000-00000000000a';
const FAC_B = '77777777-0000-4000-8000-00000000000b';
const USER_A = '77777777-0000-4000-8000-0000000000aa';

async function seedTwoFacilities(tx: TransactionSql): Promise<void> {
  for (const [id, name] of [[FAC_A, 'Facility A'], [FAC_B, 'Facility B']] as const) {
    await tx.unsafe(`
      insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164)
      values ('${id}','${name}','Ikeja','Lagos',6.6,3.35,'+2348000000090')
    `);
    await tx.unsafe(`
      insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state)
      values ('${id}','ICU','OFFERED',3,true,'ACTIVE')
    `);
  }
  await tx.unsafe(`
    insert into app.ward_account (id, facility_id, ward_category, role)
    values ('${USER_A}','${FAC_A}','ICU','WARD_STAFF')
  `);
}

const CLAIMS_A = { sub: USER_A, role: 'authenticated' };

/**
 * assert_member() is exercised as `postgres`, not as `authenticated`, and that is
 * a finding rather than a shortcut.
 *
 * app.assert_member() lives in the `app` schema, which no client role can reach
 * -- `authenticated` calling it directly gets "permission denied for schema app"
 * before any of its logic runs. That is the boundary working: the function is
 * internal, and clients reach it only through the SECURITY DEFINER RPCs in
 * `public`, which run as their owner.
 *
 * So there are two different things to test and they need two different callers:
 *   - the FUNCTION'S LOGIC (below, as postgres, with JWT claims set via SET LOCAL
 *     -- auth.uid() reads request.jwt.claims and is role-independent); and
 *   - the FACT that a client cannot call it directly, asserted explicitly in the
 *     last test in this file rather than left as an accident of the others.
 */

describe('cross-tenant isolation', () => {
  test("same-facility read succeeds and returns only that facility's wards", async () => {
    // The positive control. Without it, an assert_member() that rejected
    // everything would satisfy every negative case in this file.
    const rows = await withRole(
      'authenticated', CLAIMS_A,
      async (tx) => tx.unsafe<{ category: string }[]>(`select category::text as category from public.my_facility_wards()`),
      seedTwoFacilities,
    );
    expect(rows.map((r) => r.category)).toEqual(['ICU']);
  });

  test('cross-facility assert_member is rejected with CROSS_FACILITY_DENIED', async () => {
    await expect(
      withRole('postgres', CLAIMS_A, async (tx) => {
        await tx.unsafe(`select app.assert_member('${FAC_B}'::uuid, 'WARD_STAFF'::app.app_role)`);
      }, seedTwoFacilities),
    ).rejects.toThrow(/CROSS_FACILITY_DENIED/);
  });

  test('missing-context — no auth.uid() is rejected with NOT_AUTHENTICATED', async () => {
    await expect(
      withRole('postgres', null, async (tx) => {
        await tx.unsafe(`select app.assert_member('${FAC_A}'::uuid, 'WARD_STAFF'::app.app_role)`);
      }, seedTwoFacilities),
    ).rejects.toThrow(/NOT_AUTHENTICATED/);
  });

  test('an unknown subject is rejected with NOT_A_MEMBER', async () => {
    await expect(
      withRole('postgres', { sub: '77777777-0000-4000-8000-0000000000ff', role: 'authenticated' },
        async (tx) => {
          await tx.unsafe(`select app.assert_member('${FAC_A}'::uuid, 'WARD_STAFF'::app.app_role)`);
        }, seedTwoFacilities),
    ).rejects.toThrow(/NOT_A_MEMBER/);
  });

  test('a deactivated account is blocked immediately, not at token expiry', async () => {
    // A facility admin's deactivate action must take effect on the next request.
    // An orphaned account at a hospital is a security failure and a
    // data-protection failure at the same time.
    await expect(
      withRole('postgres', CLAIMS_A, async (tx) => {
        await tx.unsafe(`select app.assert_member('${FAC_A}'::uuid, 'WARD_STAFF'::app.app_role)`);
      }, async (tx) => {
        await seedTwoFacilities(tx);
        await tx.unsafe(`
          update app.ward_account set is_active=false, deactivated_at=now() where id='${USER_A}'
        `);
      }),
    ).rejects.toThrow(/ACCOUNT_DEACTIVATED/);
  });

  test('a WARD_STAFF cannot act with FACILITY_ADMIN authority', async () => {
    await expect(
      withRole('postgres', CLAIMS_A, async (tx) => {
        await tx.unsafe(`select app.assert_member('${FAC_A}'::uuid, 'FACILITY_ADMIN'::app.app_role)`);
      }, seedTwoFacilities),
    ).rejects.toThrow(/INSUFFICIENT_ROLE/);
  });

  test('a FACILITY_ADMIN may act with WARD_STAFF authority, and only downward', async () => {
    const ok = await withRole('postgres', CLAIMS_A, async (tx) => {
      const rows = await tx.unsafe<{ uid: string }[]>(
        `select app.assert_member('${FAC_A}'::uuid, 'WARD_STAFF'::app.app_role) as uid`,
      );
      return rows[0]?.uid;
    }, async (tx) => {
      await seedTwoFacilities(tx);
      // ward_category MUST be nulled in the same statement: a FACILITY_ADMIN has
      // no single ward, and ward_account_scope_matches_role rejects the row
      // otherwise. The fixture has to build a LEGAL account -- a tightening, not
      // a relaxation (Standard O branch (i)).
      await tx.unsafe(`
        update app.ward_account set role='FACILITY_ADMIN', ward_category=null where id='${USER_A}'
      `);
    });
    expect(ok).toBe(USER_A);
  });

  test('an authenticated client cannot call app.assert_member directly at all', async () => {
    // The schema boundary, asserted on purpose rather than relied on by accident.
    // Clients reach this logic only through the SECURITY DEFINER RPCs in `public`.
    await expect(
      withRole('authenticated', CLAIMS_A, async (tx) => {
        await tx.unsafe(`select app.assert_member('${FAC_A}'::uuid, 'WARD_STAFF'::app.app_role)`);
      }, seedTwoFacilities),
    ).rejects.toThrow(/permission denied for schema app/);
  });
});
