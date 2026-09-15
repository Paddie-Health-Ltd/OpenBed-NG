import { afterAll, describe, expect, test } from 'vitest';
import { signInWard, authedRest } from '../setup/auth.js';
import { sql } from '../setup/db.js';

/**
 * THE 011 REPAIR, OVER HTTP (migration 015).
 *
 * 011's ward_status_history took p_category app.ward_category. authenticated has
 * no USAGE on schema app, and PostgREST names parameter types, so a ward session
 * calling it through PostgREST was refused with 42501 before the function ran --
 * the defect 014's golden-path publish steps exposed on 2026-09-14. An in-database
 * call with an untyped literal never showed it, which is why this proof has to
 * travel the real transport: a GoTrue-issued token, through PostgREST, to the
 * function.
 *
 * WHAT IS COMMITTED, AND WHY IT IS SAFE TO REMOVE. A throwaway facility (INACTIVE,
 * so the projection never publishes it and no mirror assertion elsewhere sees it),
 * one ward and one ward account for the probe's GoTrue user. The probe reads
 * history and writes none, so no append-only row references these and afterAll
 * deletes them in foreign-key order.
 */

const EMAIL = `history-http-probe-${Date.now()}@ward.invalid`;
const FAC = 'aaaa0000-0000-4000-8000-00000000f015';
let userId: string | null = null;

afterAll(async () => {
  const db = sql();
  if (userId) await db`delete from app.ward_account where id = ${userId}::uuid`;
  await db`delete from app.ward_status where facility_id = ${FAC}::uuid`;
  await db`delete from app.facility where id = ${FAC}::uuid`;
  await db`delete from auth.users where email = ${EMAIL}`;
});

describe('client RPCs over PostgREST', () => {
  test("a ward session calls ward_status_history over HTTP and gets rows — 011's app-typed parameter made this 42501", async () => {
    const session = await signInWard(EMAIL);
    userId = session.userId;
    const db = sql();
    await db`
      insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, is_active)
      values (${FAC}::uuid, 'History HTTP Probe', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000094', false)
    `;
    await db`
      insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state)
      values (${FAC}::uuid, 'ICU_ADULT', 'OFFERED', 3, true, 'ACTIVE')
    `;
    await db`
      insert into app.ward_account (id, facility_id, ward_category, role)
      values (${userId}::uuid, ${FAC}::uuid, 'ICU_ADULT', 'WARD_STAFF')
    `;

    const ok = await authedRest('rpc/ward_status_history', session, { method: 'POST', body: { p_category: 'ICU_ADULT' } });
    expect(ok.status, `ward_status_history over HTTP was refused: ${JSON.stringify(ok.body)}`).toBe(200);
    expect(Array.isArray(ok.body), `ward_status_history did not return rows: ${JSON.stringify(ok.body)}`).toBe(true);

    // The refusal of an unknown value also reaches the client intact, as the
    // stable code rather than a type error the client cannot map.
    const bad = await authedRest('rpc/ward_status_history', session, { method: 'POST', body: { p_category: 'NOT_A_WARD' } });
    expect(bad.status, `an unknown category was not refused: ${JSON.stringify(bad.body)}`).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('INVALID_ARGUMENT');
  });
});
