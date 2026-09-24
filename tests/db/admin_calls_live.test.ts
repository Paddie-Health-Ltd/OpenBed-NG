import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { signInWard, authedRest, type WardSession } from '../setup/auth.js';
import { sql } from '../setup/db.js';
import ADMIN_LABELS from '../../packages/labels/admin-labels.json';
import {
  RPC,
  addCategoryBody,
  createFacilityBody,
  editFacilityBody,
  recordContactBody,
  registerBody,
  type ContactFields,
  type FacilityFields,
} from '../../apps/admin/src/bodies.js';
import { adminMessageFor } from '../../apps/admin/src/messages.js';

/**
 * THE ADMIN APP'S CALLS, AGAINST REAL POSTGREST, WITH A REAL OPERATOR SESSION
 * (R-2026-09-24-97; the PR 3.4b-app C design report, section 9).
 *
 * Every body is built by apps/admin/src/bodies.ts -- the builders the page sends -- so
 * what is proved here is the page's own request shape, not a copy of it. Every refusal
 * is read through apps/admin/src/messages.ts, so a server message that stopped matching
 * what the page parses (a constraint name, a 23502's column) reds here.
 *
 * THE SHARED-FIXTURE LINK (test-conventions section 8): packages/labels/admin-labels.json's
 * `constraints` and `not_null` tables are held to the LIVE catalogue here, and its
 * `codes` table to the migrations' RAISEs in tests/compliance/admin_render.test.ts. A
 * drift in either reds both.
 *
 * WHAT IS COMMITTED, AND WHAT IS LEFT. An operator and a ward user (GoTrue users and
 * ward_account rows): afterAll deletes both. Facilities created through the operator
 * functions CANNOT be deleted -- each carries an append-only audit row that references it
 * (audit_log -> facility, RESTRICT) -- so they are made with per-run ids and a name no
 * other test reads, NEVER LISTED (so nothing reaches the public output), and switched
 * off in afterAll.
 */

const RUN = Date.now().toString(36);
const OPERATOR_EMAIL = `admin-live-op-${RUN}@ward.invalid`;
const WARD_EMAIL = `admin-live-ward-${RUN}@ward.invalid`;
const created: string[] = [];
let operator: WardSession | null = null;
let wardUser: WardSession | null = null;

afterAll(async () => {
  const db = sql();
  for (const s of [operator, wardUser]) if (s) await db`delete from app.ward_account where id = ${s.userId}::uuid`;
  await db`delete from auth.users where email in (${OPERATOR_EMAIL}, ${WARD_EMAIL})`;
  for (const id of created) await db`update app.facility set is_active = false where id = ${id}::uuid`;
});

async function op(): Promise<WardSession> {
  if (operator) return operator;
  operator = await signInWard(OPERATOR_EMAIL);
  // 022's one-operator index: if another operator is active on this database, this insert
  // fails loudly, naming the index -- the collision the E2E teardown exists to prevent.
  await sql()`insert into app.ward_account (id, role) values (${operator.userId}::uuid, 'PLATFORM_ADMIN')`;
  return operator;
}

async function call(fn: string, body: unknown, session?: WardSession) {
  return authedRest(`rpc/${fn}`, session ?? (await op()), { method: 'POST', body: body as Record<string, unknown> });
}

const refusal = (r: { status: number; body: unknown }) => adminMessageFor(r.status, null, JSON.stringify(r.body));

const FIELDS: FacilityFields = {
  name: `ADMIN_LIVE ${RUN} St. Nicholas' Hospital — Ọ̀dúnlá`,
  lga: 'Lagos Island',
  state: 'Lagos',
  lat: 6.45,
  lng: 3.4,
  publicPhoneE164: '+2348031234567',
};

async function newFacility(over: Partial<FacilityFields> = {}): Promise<string> {
  const id = randomUUID();
  const r = await call(RPC.createFacility, createFacilityBody(id, { ...FIELDS, ...over }));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  created.push(id);
  return id;
}

async function registerRow(id: string): Promise<Record<string, unknown>> {
  const r = await call(RPC.register, registerBody());
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const row = (r.body as { facilities: Record<string, unknown>[] }).facilities.find((f) => f['facility_id'] === id);
  expect(row, `facility ${id} is not in the register`).toBeDefined();
  return row as Record<string, unknown>;
}

describe('the admin app’s calls, live', () => {
  test('operator creates a facility: the same id and fields again answer created=false, and a changed field is IDEMPOTENCY_CONFLICT', async () => {
    const id = randomUUID();
    const first = await call(RPC.createFacility, createFacilityBody(id, FIELDS));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    created.push(id);
    expect((first.body as { created: boolean }[])[0]?.created).toBe(true);
    const again = await call(RPC.createFacility, createFacilityBody(id, FIELDS));
    expect((again.body as { created: boolean }[])[0]?.created, 'a retry with the same id made a second facility').toBe(false);
    const [n] = await sql()<{ n: number }[]>`select count(*)::int as n from app.facility where id = ${id}::uuid`;
    expect(n?.n).toBe(1);
    const changed = await call(RPC.createFacility, createFacilityBody(id, { ...FIELDS, lga: 'Ikeja' }));
    expect(refusal(changed).key).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('chaotic input is stored exactly as entered: an apostrophe, a dash and a diacritic round-trip byte for byte', async () => {
    const id = await newFacility();
    expect((await registerRow(id))['name']).toBe(FIELDS.name);
  });

  test('operator create with latitude and longitude swapped is rejected, 23514 naming facility_lat_in_nigeria, read as its sentence', async () => {
    const r = await call(RPC.createFacility, createFacilityBody(randomUUID(), { ...FIELDS, lat: 3.4, lng: 6.45 }));
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    const m = refusal(r);
    expect(m.key).toBe('constraint:facility_lat_in_nigeria');
    expect(m.sentence).toBe(ADMIN_LABELS.constraints.facility_lat_in_nigeria);
  });

  test('operator create with a field missing is rejected, 23502 naming the column, read as its sentence', async () => {
    const body = { ...createFacilityBody(randomUUID(), FIELDS), p_lga: null };
    const r = await call(RPC.createFacility, body);
    const m = refusal(r);
    expect(m.key, JSON.stringify(r.body)).toBe('not_null:facility.lga');
    expect(m.sentence).toBe(ADMIN_LABELS.not_null['facility.lga']);
  });

  test('two tabs edit one facility: the second is refused VERSION_CONFLICT, and the row keeps the first edit', async () => {
    const id = await newFacility();
    const loaded = (await registerRow(id))['version'] as number;
    const tabA = await call(RPC.editFacility, editFacilityBody(id, loaded, { ...FIELDS, name: `${FIELDS.name} A` }));
    expect(tabA.status, JSON.stringify(tabA.body)).toBe(200);
    const tabB = await call(RPC.editFacility, editFacilityBody(id, loaded, { ...FIELDS, name: `${FIELDS.name} B` }));
    expect(refusal(tabB).key).toBe('VERSION_CONFLICT');
    expect((await registerRow(id))['name']).toBe(`${FIELDS.name} A`);
  });

  test('replaying an edit is refused VERSION_CONFLICT -- why the page never re-sends one (BY-2 e)', async () => {
    const id = await newFacility();
    const loaded = (await registerRow(id))['version'] as number;
    const body = editFacilityBody(id, loaded, { ...FIELDS, state: 'Ogun' });
    expect((await call(RPC.editFacility, body)).status).toBe(200);
    expect(refusal(await call(RPC.editFacility, body)).key).toBe('VERSION_CONFLICT');
  });

  const CONTACT: ContactFields = { fullName: 'Synthetic Contact', jobTitle: 'Medical Director', email: 'contact-admin-live@example.invalid', mobileE164: null, smsOptIn: false };

  test('an identical contact repeat is a no-op: the same contact version, before the version is checked', async () => {
    const id = await newFacility();
    const first = await call(RPC.recordContact, recordContactBody(id, CONTACT, null));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const v = (first.body as { contact_version: number }[])[0]?.contact_version;
    const again = await call(RPC.recordContact, recordContactBody(id, CONTACT, null));
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect((again.body as { contact_version: number }[])[0]?.contact_version).toBe(v);
  });

  test.each([
    ['MOBILE_NOT_E164', { mobileE164: '08031234567', smsOptIn: true }],
    ['MOBILE_REQUIRES_SMS_OPT_IN', { mobileE164: '+2348031234567', smsOptIn: false }],
  ])('operator contact write is rejected %s, read as its sentence', async (code, over) => {
    const id = await newFacility();
    const m = refusal(await call(RPC.recordContact, recordContactBody(id, { ...CONTACT, ...over }, null)));
    expect(m.key).toBe(code);
    expect(m.sentence).toBe(ADMIN_LABELS.codes[code as keyof typeof ADMIN_LABELS.codes]);
  });

  test('ward staff on the admin app is rejected NOT_AN_OPERATOR -- the stop screen, never a register', async () => {
    const id = await newFacility();
    expect((await call(RPC.addCategory, addCategoryBody(id, 'MATERNITY', 'OFFERED'))).status).toBe(200);
    wardUser = await signInWard(WARD_EMAIL);
    await sql()`insert into app.ward_account (id, role, facility_id, ward_category) values (${wardUser.userId}::uuid, 'WARD_STAFF', ${id}::uuid, 'MATERNITY')`;
    const r = await call(RPC.register, registerBody(), wardUser);
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(refusal(r).key).toBe('NOT_AN_OPERATOR');
  });

  test('a deactivated operator is rejected ACCOUNT_DEACTIVATED, read as its sentence', async () => {
    const s = await op();
    await sql()`update app.ward_account set is_active = false, deactivated_at = now() where id = ${s.userId}::uuid`;
    try {
      const r = await call(RPC.register, registerBody());
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(refusal(r).key).toBe('ACCOUNT_DEACTIVATED');
    } finally {
      await sql()`update app.ward_account set is_active = true, deactivated_at = null where id = ${s.userId}::uuid`;
    }
  });
});

describe('the label tables against the live catalogue (the shared-fixture link)', () => {
  test('constraints: exactly the CHECK constraints on facility, facility_contact and facility_agreement', async () => {
    const rows = await sql()<{ n: string }[]>`
      select conname as n from pg_constraint
       where contype = 'c' and conrelid in ('app.facility'::regclass, 'app.facility_contact'::regclass, 'app.facility_agreement'::regclass)`;
    expect(rows.map((r) => r.n).sort()).toEqual(Object.keys(ADMIN_LABELS.constraints).sort());
  });

  test('not_null: exactly the NOT NULL columns with no default that an operator function writes', async () => {
    const rows = await sql()<{ n: string }[]>`
      select table_name || '.' || column_name as n from information_schema.columns
       where table_schema = 'app' and table_name in ('facility', 'facility_contact', 'facility_agreement')
         and is_nullable = 'NO' and column_default is null and column_name <> 'facility_id'`;
    expect(rows.map((r) => r.n).sort()).toEqual(Object.keys(ADMIN_LABELS.not_null).sort());
  });
});
