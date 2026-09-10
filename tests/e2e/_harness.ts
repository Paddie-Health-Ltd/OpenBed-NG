import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from '../setup/db.js';

/**
 * THE E2E CORPUS. Two E2E_-prefixed facilities, seeded by this file and COMMITTED.
 *
 * WHY IT SEEDS ITS OWN AND NEVER TOUCHES database/seed. The `db` project is
 * rollback-only over a pristine corpus -- withRole() throws a sentinel precisely
 * so a probe never mutates what later assertions run against. The golden path
 * must COMMIT: a published count has to fire the 008 triggers and reach the
 * mirrors, and a rolled-back publish reaches nothing. Committing into the seeded
 * rows would make seed_shapes.test.ts and Gate 3's exact-cardinality assertion
 * order-dependent, which is the class of nondeterminism a previous session spent
 * a day diagnosing. So: separate rows, separate prefix, removed and rebuilt on
 * every run, and a separate database in CI.
 *
 * WHY TWO FACILITIES. With one there is no sort, and the distance-ordering steps
 * cannot be made to pass honestly. Coordinates are fixed and far enough apart
 * that the ordering is not a floating-point coin toss: roughly 12km, Lagos Island
 * to Ikeja.
 *
 * WHY ONE WARD IS AGED. Gate 2 has a referrer reaching a STALE ward and finding a
 * duty phone number. A corpus of uniformly fresh rows cannot show that, and the
 * freshness band under test would always be the same one.
 */

export const E2E_PREFIX = 'E2E_';

export const ALPHA = {
  id: 'e2e00000-0000-4000-8000-000000000001',
  name: 'E2E_Alpha General Hospital',
  lga: 'E2E_LGA_ALPHA',
  lat: 6.5244,
  lng: 3.3792,
  phone: '+2348000000001',
} as const;

export const BETA = {
  id: 'e2e00000-0000-4000-8000-000000000002',
  name: 'E2E_Beta Teaching Hospital',
  lga: 'E2E_LGA_BETA',
  lat: 6.6018,
  lng: 3.3515,
  phone: '+2348000000002',
} as const;

/** The ward account the golden path signs in as. A ROLE address, never a person. */
export const WARD_EMAIL = 'e2e-maternity-alpha@e2e.invalid';
/** Second account at the same facility, different category. Exists to make ward-scope observable. */
export const WARD_EMAIL_SECOND = 'e2e-theatre-alpha@e2e.invalid';

export const PUBLISH_CATEGORY = 'MATERNITY';
export const SECOND_CATEGORY = 'THEATRE';

/** The ward deliberately left stale, for the duty-phone step. */
export const STALE_CATEGORY = 'ICU_ADULT';

/**
 * Remove every E2E_ row, then rebuild.
 *
 * Deletion is by the prefix and the fixed ids, never "delete everything": a helper
 * that truncates is one careless import away from wiping the seeded corpus the
 * `db` suite depends on.
 */
export async function resetE2eCorpus(): Promise<void> {
  const db = sql();
  await db`delete from app.facility where id in (${ALPHA.id}::uuid, ${BETA.id}::uuid)`;
  await db`delete from auth.users where email like ${`%@e2e.invalid`}`;
}

export async function seedE2eCorpus(): Promise<void> {
  const db = sql();

  for (const f of [ALPHA, BETA]) {
    await db`
      insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, quiet_mode)
      values (${f.id}::uuid, ${f.name}, ${f.lga}, 'Lagos', ${f.lat}, ${f.lng}, ${f.phone}, false)
      on conflict (id) do nothing
    `;
    // Duty flags left at their NOT NULL DEFAULT 'UNKNOWN' -- the state every real
    // facility is in on day one. If the gate ever treats UNKNOWN as closed, these
    // rows go dark and the golden path goes with them.
    await db`insert into app.facility_ops (facility_id) values (${f.id}::uuid) on conflict (facility_id) do nothing`;
  }

  // Alpha: the ward the golden path publishes to, never updated yet.
  await db`
    insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state, source)
    values (${ALPHA.id}::uuid, ${PUBLISH_CATEGORY}::app.ward_category, 'OFFERED', null, true, 'PENDING', 'WARD')
    on conflict (facility_id, category) do nothing
  `;
  await db`
    insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state, source)
    values (${ALPHA.id}::uuid, ${SECOND_CATEGORY}::app.ward_category, 'OFFERED', null, true, 'PENDING', 'WARD')
    on conflict (facility_id, category) do nothing
  `;

  // A deliberately STALE ward. updated_at is supplied explicitly rather than
  // defaulted: app.touch_updated_at() is a BEFORE UPDATE trigger, so ageing this
  // row with an UPDATE would stamp it back to now() and silently undo the point.
  await db`
    insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state, source, updated_at)
    values (${ALPHA.id}::uuid, ${STALE_CATEGORY}::app.ward_category, 'OFFERED', 3, true, 'ACTIVE', 'WARD', now() - interval '4 hours')
    on conflict (facility_id, category) do nothing
  `;

  await db`
    insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state, source)
    values (${BETA.id}::uuid, ${PUBLISH_CATEGORY}::app.ward_category, 'OFFERED', 2, true, 'ACTIVE', 'WARD')
    on conflict (facility_id, category) do nothing
  `;
}

/** Loud, and it names what was missing. A corpus that half-seeded is worse than none. */
export async function assertE2eCorpus(): Promise<void> {
  const db = sql();
  const [facilities] = await db<{ n: number }[]>`
    select count(*)::int as n from public.facility_public where facility_id in (${ALPHA.id}::uuid, ${BETA.id}::uuid)
  `;
  const [wards] = await db<{ n: number }[]>`
    select count(*)::int as n from public.ward_public where facility_id in (${ALPHA.id}::uuid, ${BETA.id}::uuid)
  `;
  if (!facilities || facilities.n !== 2) {
    throw new Error(`E2E corpus: expected 2 facilities in public.facility_public, found ${facilities?.n ?? 0}. The 008 projection trigger did not fire.`);
  }
  if (!wards || wards.n !== 4) {
    throw new Error(`E2E corpus: expected 4 wards in public.ward_public, found ${wards?.n ?? 0}.`);
  }
}

/**
 * Reach a module A LATER STAGE BRINGS, without breaking the type gate today.
 *
 * THE PROBLEM. Steps past the frontier must be REAL, EXECUTED, FAILING assertions
 * -- no .skip and no .todo. Several of them target modules that do not exist yet.
 * A static import of one would fail `npm run typecheck` for every developer from
 * now until the stage that lands it, and a type gate that is red for months is a
 * gate people learn to route around. That trade buys nothing: the step still has
 * to fail, and it fails either way.
 *
 * WHAT THIS DOES NOT DO. It does not make the step pass, and it does not soften
 * the failure. It makes the failure PRECISE -- `MODULE_NOT_BUILT:` naming the path
 * and the stage -- so `tests/e2e/frontier.json` can name that exact signal and the
 * ratchet can tell "the code is not written yet" from "the test is broken". Those
 * are the same red without it.
 *
 * WHEN THE MODULE LANDS, DELETE THE CALL. Replace it with a static import in the
 * same commit that creates the module. Leaving it behind would mean a genuine
 * later breakage reports as MODULE_NOT_BUILT, which is the fallback-that-stops-
 * reaching shape this repository has caught before.
 */
export async function loadFuture<T>(relativeToE2eDir: string, owningStage: number): Promise<T> {
  const abs = join(import.meta.dirname, relativeToE2eDir);
  if (!existsSync(abs)) {
    throw new Error(
      `MODULE_NOT_BUILT: ${relativeToE2eDir} — arrives in stage ${owningStage} and does not exist yet`,
    );
  }
  return (await import(abs)) as T;
}
