import { afterAll, describe, expect, test } from 'vitest';
import { signInWard, authedRest, type WardSession } from '../setup/auth.js';
import { sql } from '../setup/db.js';

/**
 * WHAT A REAL PLATFORM_ADMIN SESSION GETS FROM EVERY FUNCTION `authenticated` CAN RUN
 * (R-2026-09-23-71 G). This is asserted, not described.
 *
 * 3.4 bootstraps the first PLATFORM_ADMIN on hosted. That makes reachable, for the
 * first time, app.assert_member()'s early return for that role (011:109-111): a
 * platform admin passes every assert_member check, whatever role it asks for. So
 * this leg drives a GoTrue-issued token, through PostgREST, into each function in
 * the closed list (tests/db/authenticated_executable_closed_list.test.ts), and pins
 * the answer each gives.
 *
 * WHAT IT FOUND, recorded in R-2026-09-23-71 as a premise that did not hold as
 * stated:
 *   - publish_ward_status REFUSES it: its explicit WARD_STAFF check (014:189-193)
 *     gives 42501 INSUFFICIENT_ROLE after assert_member lets it through;
 *   - my_facility_wards and ward_status_history do NOT refuse it. assert_member
 *     returns early, and each then filters on the account's facility, which is NULL
 *     for a platform admin, so each answers 200 with ZERO rows. No data from any
 *     facility, but no refusal either;
 *   - every operator_* function lets it past the identity check. Each is called
 *     with an argument that fails AFTER that check, so the session is shown to pass
 *     the gate and nothing is written: no facility, and no append-only audit row
 *     this test could not remove.
 *
 * WHAT IS COMMITTED, AND REMOVED: one GoTrue user, and its ward_account row as
 * PLATFORM_ADMIN. Nothing else is written. afterAll deletes both.
 */

const EMAIL = `platform-admin-probe-${Date.now()}@ward.invalid`;
const NO_SUCH = '0c000000-0000-4000-8000-00000000dead';
let session: WardSession | null = null;

afterAll(async () => {
  const db = sql();
  if (session) await db`delete from app.ward_account where id = ${session.userId}::uuid`;
  await db`delete from auth.users where email = ${EMAIL}`;
});

async function admin(): Promise<WardSession> {
  if (session) return session;
  session = await signInWard(EMAIL);
  await sql()`insert into app.ward_account (id, role) values (${session.userId}::uuid, 'PLATFORM_ADMIN')`;
  return session;
}

const call = async (fn: string, body: Record<string, unknown>) => authedRest(`rpc/${fn}`, await admin(), { method: 'POST', body });

describe('a real PLATFORM_ADMIN session, function by function', () => {
  test('publish_ward_status — refused 42501 INSUFFICIENT_ROLE by its explicit WARD_STAFF check', async () => {
    const r = await call('publish_ward_status', {
      p_category: 'ICU_ADULT', p_offering: 'OFFERED', p_bed_count: 1, p_accepting: true, p_reason: null,
      p_expected_version: 1, p_client_mutation_id: 'platform-admin-probe', p_composed_at: new Date().toISOString(),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(JSON.stringify(r.body)).toContain('INSUFFICIENT_ROLE');
  });

  test('my_facility_wards — NOT refused: 200 and zero rows, because the account has no facility', async () => {
    const r = await call('my_facility_wards', {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual([]);
  });

  test('ward_status_history — NOT refused: 200 and zero rows, for the same reason', async () => {
    const r = await call('ward_status_history', { p_category: 'ICU_ADULT' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual([]);
  });

  test('operator_register — accepted: 200 and the envelope, with server_now and a facilities array', async () => {
    const r = await call('operator_register', {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const env = r.body as { server_now?: unknown; facilities?: unknown };
    expect(Number.isNaN(Date.parse(String(env.server_now)))).toBe(false);
    expect(Array.isArray(env.facilities)).toBe(true);
  });

  test.each([
    ['operator_create_facility', { p_id: 'not-a-uuid', p_name: 'x', p_lga: 'x', p_state: 'x', p_lat: 6.5, p_lng: 3.4, p_public_phone_e164: '+2348000000000' }, 'INVALID_ARGUMENT'],
    ['operator_edit_facility', { p_facility_id: NO_SUCH, p_expected_version: 1, p_name: 'x', p_lga: 'x', p_state: 'x', p_lat: 6.5, p_lng: 3.4, p_public_phone_e164: '+2348000000000' }, 'NO_SUCH_FACILITY'],
    ['operator_add_category', { p_facility_id: NO_SUCH, p_category: 'ICU_ADULT', p_offering: 'OFFERED' }, 'NO_SUCH_FACILITY'],
    ['operator_set_facility_listed', { p_facility_id: NO_SUCH, p_expected_version: 1 }, 'NO_SUCH_FACILITY'],
    // 021 (R-2026-09-24-75/76).
    ['operator_record_contact', { p_facility_id: NO_SUCH, p_full_name: 'x', p_job_title: 'x', p_email: 'role@example.invalid', p_mobile_e164: null, p_sms_opt_in: false, p_expected_version: null }, 'NO_SUCH_FACILITY'],
    ['operator_record_agreement', { p_facility_id: NO_SUCH, p_accepted_on: '2026-09-01', p_version: 'v1.0', p_signatory_role: 'CMD' }, 'NO_SUCH_FACILITY'],
    ['operator_get_contact', { p_facility_id: NO_SUCH }, 'NO_SUCH_FACILITY'],
  ])('%s — past the identity check: the refusal is the argument, never NOT_AN_OPERATOR, and nothing is written', async (fn, body, expected) => {
    const r = await call(fn, body);
    const text = JSON.stringify(r.body);
    expect(text, `${fn} refused the platform admin at the identity check`).not.toContain('NOT_AN_OPERATOR');
    expect(text).toContain(expected);
  });

  test('the probe wrote nothing a later run would trip over — no facility, no audit row from this session', async () => {
    const [f] = await sql()<{ n: number }[]>`select count(*)::int as n from app.facility where id = ${NO_SUCH}::uuid`;
    expect(f?.n).toBe(0);
  });
});
