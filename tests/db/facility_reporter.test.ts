import { describe, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';

/**
 * THE FACILITY-LEVEL LOGIN PUBLISHES AS A WARD DOES, FOR ANY WARD AT ITS OWN FACILITY,
 * AND THE SERVER SAYS WHICH ROWS A LOGIN MAY PUBLISH (migration 026; R-2026-09-27-144
 * DT e, f; the read renamed by R-2026-09-27-145 DU-1; the reporting model is
 * R-2026-09-27-141 DQ-3).
 *
 * WHAT IS ASSERTED.
 *   publish_ward_status (DT e):
 *     - a FACILITY_REPORTER publishes ANY category at its own facility, with source
 *       WARD on the ward and on its event;
 *     - its publish lands on its OWN facility's ward only: the function takes no
 *       facility argument, so the assertion is that a same-category ward at another
 *       facility is untouched;
 *     - a reporter naming a category its facility does not have reads NO_SUCH_WARD;
 *     - a ward login publishing another category is still WARD_SCOPE_DENIED;
 *     - a FACILITY_ADMIN is still refused INSUFFICIENT_ROLE.
 *   my_reporting_wards().can_publish (DT f; DU-1, DU-5), per role: a ward login's own category
 *     only; every row for the reporter; no row for a FACILITY_ADMIN; and a
 *     PLATFORM_ADMIN still reads zero rows. The flag is asserted AGAINST the publish
 *     it predicts: for each row, can_publish is true exactly when the publish lands.
 *
 * EVERY PROBE ROLLS BACK. The seed is created inside each transaction.
 *
 * NOT ASSERTED HERE, deliberately: the console acting on can_publish. That is Bundle 2
 * of DT, which renders a Publish form only where the flag is true.
 */

const FAC = '0c000000-0000-4000-8000-0000000000fa';
const FAC_OTHER = '0c000000-0000-4000-8000-0000000000fb';

const U_REPORTER = '0c000000-0000-4000-8000-0000000000a1';
const U_WARD = '0c000000-0000-4000-8000-0000000000a2';
const U_ADMIN = '0c000000-0000-4000-8000-0000000000a3';
const U_OPERATOR = '0c000000-0000-4000-8000-0000000000a4';
const U_OTHER_REPORTER = '0c000000-0000-4000-8000-0000000000a5';

const CATEGORIES = ['ICU_ADULT', 'MATERNITY', 'THEATRE'] as const;

/**
 * Two listed facilities, each with an active agreement. FAC has three wards; FAC_OTHER
 * has MATERNITY only, so a same-category ward exists elsewhere. The accounts are
 * seeded per test: the one-source trigger refuses a reporter and a ward login active
 * at one facility together, so a facility carries one model at a time.
 */
async function facilities(tx: TransactionSql): Promise<void> {
  for (const [id, name] of [[FAC, 'Reporter Facility'], [FAC_OTHER, 'Other Facility']] as const) {
    await tx.unsafe(`
      insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
      values ('${id}', '${name}', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000501', now())`);
    await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${id}', '2026-09-01', 'v1.0')`);
  }
  for (const c of CATEGORIES) {
    await tx.unsafe(`insert into app.ward_status (facility_id, category, offering, monitoring_state) values ('${FAC}', '${c}', 'OFFERED', 'PENDING')`);
  }
  await tx.unsafe(`insert into app.ward_status (facility_id, category, offering, bed_count, monitoring_state) values ('${FAC_OTHER}', 'MATERNITY', 'OFFERED', 7, 'ACTIVE')`);
}

type Model = 'FACILITY' | 'WARD';

/** The facilities, plus FAC's accounts under one reporting model, plus the other facility's own reporter. */
const seed = (model: Model) => async (tx: TransactionSql): Promise<void> => {
  await facilities(tx);
  if (model === 'FACILITY') {
    await tx.unsafe(`insert into app.ward_account (id, facility_id, ward_category, role) values ('${U_REPORTER}', '${FAC}', null, 'FACILITY_REPORTER')`);
  } else {
    await tx.unsafe(`insert into app.ward_account (id, facility_id, ward_category, role) values ('${U_WARD}', '${FAC}', 'MATERNITY', 'WARD_STAFF')`);
  }
  await tx.unsafe(`
    insert into app.ward_account (id, facility_id, ward_category, role) values
      ('${U_ADMIN}', '${FAC}', null, 'FACILITY_ADMIN'),
      ('${U_OTHER_REPORTER}', '${FAC_OTHER}', null, 'FACILITY_REPORTER')`);
  await tx.unsafe(`insert into app.ward_account (id, role) values ('${U_OPERATOR}', 'PLATFORM_ADMIN')`);
};

const claims = (sub: string): Record<string, unknown> => ({ sub, role: 'authenticated', session_id: randomUUID() });

interface Refusal {
  code: string | undefined;
  message: string;
}
async function refusal(p: Promise<unknown>): Promise<Refusal> {
  try {
    await p;
  } catch (e) {
    const x = e as { code?: string; message: string };
    return { code: x.code, message: x.message };
  }
  throw new Error('expected a refusal, and the call succeeded');
}

/** An UNTYPED category literal: authenticated cannot name app types (see publish_ward_status.test.ts). */
const PUBLISH = (category: string, beds: number): string =>
  `select version, claim_bed_count from public.publish_ward_status('${category}', 'OFFERED', ${beds}, true, null, 1, '${randomUUID()}', now())`;

interface Row {
  category: string;
  can_publish: boolean;
}
const WARDS = 'select category::text as category, can_publish from public.my_reporting_wards() order by category';

describe('the facility reporter publishes as a ward does, for any ward at its own facility (DT e)', () => {
  test('facility reporter at its own facility publishes on two categories successfully — both land, source WARD on the ward and the event', async () => {
    const out = await withRole('authenticated', claims(U_REPORTER), async (tx) => {
      const [a] = await tx.unsafe<{ version: number; claim_bed_count: number }[]>(PUBLISH('ICU_ADULT', 3));
      const [b] = await tx.unsafe<{ version: number; claim_bed_count: number }[]>(PUBLISH('THEATRE', 1));
      await tx.unsafe('reset role');
      const wards = await tx.unsafe<{ category: string; bed_count: number | null; source: string }[]>(`
        select category::text as category, bed_count, source::text as source from app.ward_status
         where facility_id = '${FAC}' order by category`);
      const events = await tx.unsafe<{ category: string; source: string }[]>(`
        select category::text as category, source::text as source from app.ward_status_event
         where facility_id = '${FAC}' order by category`);
      return { a, b, wards, events };
    }, seed('FACILITY'));
    expect(out.a).toEqual({ version: 2, claim_bed_count: 3 });
    expect(out.b).toEqual({ version: 2, claim_bed_count: 1 });
    expect(out.wards).toEqual([
      { category: 'ICU_ADULT', bed_count: 3, source: 'WARD' },
      { category: 'MATERNITY', bed_count: null, source: 'WARD' },
      { category: 'THEATRE', bed_count: 1, source: 'WARD' },
    ]);
    expect(out.events, 'a reporter publish was not recorded as the facility\'s own claim, source WARD').toEqual([
      { category: 'ICU_ADULT', source: 'WARD' },
      { category: 'THEATRE', source: 'WARD' },
    ]);
  });

  test("facility reporter publish lands on its own facility's ward only — a same-category ward at another facility is untouched", async () => {
    const out = await withRole('authenticated', claims(U_REPORTER), async (tx) => {
      await tx.unsafe(PUBLISH('MATERNITY', 2));
      await tx.unsafe('reset role');
      return tx.unsafe<{ facility: string; bed_count: number; version: number }[]>(`
        select facility_id::text as facility, bed_count, version from app.ward_status
         where category = 'MATERNITY' and facility_id in ('${FAC}', '${FAC_OTHER}') order by facility_id`);
    }, seed('FACILITY'));
    expect(out).toEqual([
      { facility: FAC, bed_count: 2, version: 2 },
      { facility: FAC_OTHER, bed_count: 7, version: 1 },
    ]);
  });

  test('facility reporter publish on a category its facility does not have is rejected with NO_SUCH_WARD', async () => {
    const r = await refusal(withRole('authenticated', claims(U_REPORTER), (tx) => tx.unsafe(PUBLISH('SCBU', 1)), seed('FACILITY')));
    expect(r.message).toBe('NO_SUCH_WARD');
  });

  test('ward staff publish to another category is still rejected with WARD_SCOPE_DENIED', async () => {
    const r = await refusal(withRole('authenticated', claims(U_WARD), (tx) => tx.unsafe(PUBLISH('ICU_ADULT', 1)), seed('WARD')));
    expect(r.message).toBe('WARD_SCOPE_DENIED');
    expect(r.code).toBe('42501');
  });

  test('facility admin publish is still rejected with INSUFFICIENT_ROLE — the reporter is not an admin', async () => {
    const r = await refusal(withRole('authenticated', claims(U_ADMIN), (tx) => tx.unsafe(PUBLISH('MATERNITY', 1)), seed('FACILITY')));
    expect(r.message).toBe('INSUFFICIENT_ROLE');
    expect(r.code).toBe('42501');
  });
});

describe('my_reporting_wards() says which rows this login may publish, decided by the server (DT f; DU-1)', () => {
  test.each<[string, string, Model, Row[]]>([
    ['ward staff', U_WARD, 'WARD', [
      { category: 'ICU_ADULT', can_publish: false },
      { category: 'MATERNITY', can_publish: true },
      { category: 'THEATRE', can_publish: false },
    ]],
    ['facility reporter', U_REPORTER, 'FACILITY', [
      { category: 'ICU_ADULT', can_publish: true },
      { category: 'MATERNITY', can_publish: true },
      { category: 'THEATRE', can_publish: true },
    ]],
    ['facility admin', U_ADMIN, 'FACILITY', [
      { category: 'ICU_ADULT', can_publish: false },
      { category: 'MATERNITY', can_publish: false },
      { category: 'THEATRE', can_publish: false },
    ]],
  ])('%s reads can_publish per row', async (_who, id, model, expected) => {
    const rows = await withRole('authenticated', claims(id), (tx) => tx.unsafe<Row[]>(WARDS), seed(model));
    expect(rows).toEqual(expected);
  });

  test('a platform admin still reads zero rows', async () => {
    const rows = await withRole('authenticated', claims(U_OPERATOR), (tx) => tx.unsafe<Row[]>(WARDS), seed('FACILITY'));
    expect(rows).toEqual([]);
  });

  test.each<[string, string, Model]>([
    ['ward staff', U_WARD, 'WARD'],
    ['facility reporter', U_REPORTER, 'FACILITY'],
    ['facility admin', U_ADMIN, 'FACILITY'],
  ])('%s — can_publish is true exactly where publish_ward_status lands', async (_who, id, model) => {
    const out = await withRole('authenticated', claims(id), async (tx) => {
      const rows = await tx.unsafe<Row[]>(WARDS);
      const landed: Record<string, boolean> = {};
      for (const r of rows) {
        await tx.unsafe('savepoint probe');
        try {
          await tx.unsafe(PUBLISH(r.category, 1));
          landed[r.category] = true;
        } catch {
          landed[r.category] = false;
        }
        await tx.unsafe('rollback to savepoint probe');
      }
      return { rows, landed };
    }, seed(model));
    expect(out.rows.length, 'no rows to compare: the seed did not land').toBe(CATEGORIES.length);
    expect(Object.fromEntries(out.rows.map((r) => [r.category, r.can_publish]))).toEqual(out.landed);
  });
});

describe('the rename is complete: public.my_facility_wards() is gone (R-2026-09-27-145 DU-1, DU-5)', () => {
  test('after a fresh apply, public.my_facility_wards() does not exist and public.my_reporting_wards() does, EXECUTE to authenticated only', async () => {
    const [r] = await withRole('postgres', null, (tx) => tx.unsafe<{ old: string | null; new: string | null; grantees: string[] }[]>(`
      select to_regprocedure('public.my_facility_wards()')::text as old,
             to_regprocedure('public.my_reporting_wards()')::text as new,
             array(select g from unnest(array['anon', 'authenticated', 'service_role']) g
                    where has_function_privilege(g, 'public.my_reporting_wards()', 'EXECUTE') order by g) as grantees`));
    expect(r).toEqual({ old: null, new: 'my_reporting_wards()', grantees: ['authenticated'] });
  });
});
