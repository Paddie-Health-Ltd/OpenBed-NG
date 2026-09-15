import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sql } from '../setup/db.js';
import { serviceRoleKey } from '../setup/local-keys.js';

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
 * Remove the E2E_ accounts, and take the E2E_ facilities OUT OF PUBLIC VIEW.
 *
 * Deletion is by the prefix and the fixed ids, never "delete everything": a helper
 * that truncates is one careless import away from wiping the seeded corpus the
 * `db` suite depends on.
 *
 * THE FACILITIES ARE DEACTIVATED, NOT DELETED, SINCE 014. Once the golden path
 * publishes, app.ward_status_event and app.audit_log hold rows for these
 * facilities. Both reference app.facility (and the event references
 * app.ward_status) ON DELETE RESTRICT, and 010 makes both tables append-only, so
 * the history cannot be removed and neither can the rows it points at. That is
 * the schema working, not something to route around with CASCADE or by disabling
 * the append-only triggers.
 *
 * Deactivating removes both facilities from every public mirror (008 deletes the
 * mirror rows of an inactive facility), so the `db` suite's mirror assertions see
 * nothing of them. seedE2eCorpus() reactivates them and restores the baseline.
 */
export async function resetE2eCorpus(): Promise<void> {
  const db = sql();
  // ORDER MATTERS, and the constraint that forces it is deliberate.
  // app.ward_account.facility_id is REFERENCES app.facility(id) ON DELETE
  // RESTRICT -- a facility cannot be deleted out from under an account, so an
  // account can never be orphaned into a facility-less state that the
  // ward_account_scope_matches_role CHECK exists to make unrepresentable.
  // Accounts carry no history (events and audit rows have no actor), so they are
  // still deleted and re-provisioned every run.
  await db`delete from app.ward_account where facility_id in (${ALPHA.id}::uuid, ${BETA.id}::uuid)`;
  await db`delete from app.invite where facility_id in (${ALPHA.id}::uuid, ${BETA.id}::uuid)`;
  await db`update app.facility set is_active = false where id in (${ALPHA.id}::uuid, ${BETA.id}::uuid)`;
  await db`delete from auth.users where email like ${`%@e2e.invalid`}`;
}

export async function seedE2eCorpus(): Promise<void> {
  const db = sql();

  for (const f of [ALPHA, BETA]) {
    // Reactivated on conflict: resetE2eCorpus() deactivates rather than deletes.
    await db`
      insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, quiet_mode, is_active)
      values (${f.id}::uuid, ${f.name}, ${f.lga}, 'Lagos', ${f.lat}, ${f.lng}, ${f.phone}, false, true)
      on conflict (id) do update set is_active = true, quiet_mode = false
    `;
    // Duty flags at 'UNKNOWN' -- the state every real facility is in on day one.
    // If the gate ever treats UNKNOWN as closed, these rows go dark and the golden
    // path goes with them. Reset on conflict, so a run that set a flag cannot
    // leak it into the next.
    await db`
      insert into app.facility_ops (facility_id) values (${f.id}::uuid)
      on conflict (facility_id) do update
        set anaesthetist = 'UNKNOWN', obstetrician = 'UNKNOWN', paediatrician = 'UNKNOWN'
    `;
  }

  // THE WARD BASELINE IS RESTORED WITH ROW TRIGGERS SUPPRESSED, and that is why
  // it is one transaction with session_replication_role = replica:
  //   - app.touch_updated_at() is a BEFORE UPDATE trigger. Restoring the STALE
  //     ward through an ordinary UPDATE would stamp it back to now() and silently
  //     undo the point of having one.
  //   - version must return to 1, because the golden path publishes with
  //     p_expected_version 1.
  // replica suppresses ordinary triggers, including the 008 projection, so the
  // mirrors are brought up to date explicitly afterwards. The append-only guards
  // are ENABLE ALWAYS and still fire -- and this touches neither of their tables.
  // Setting session_replication_role is superuser-only in stock Postgres, and
  // postgres is NOT a superuser here (rolsuper f, observed 2026-09-15). It works
  // because Supabase's supautils extension lets members of
  // supautils.privileged_role (supabase_privileged_role, which postgres is a
  // member of) set the settings in supautils.privileged_role_allowed_configs, and
  // session_replication_role is on that list -- observed locally 2026-09-15. CI
  // is OBSERVED too, not inferred from the image: the golden-path job runs this
  // function through scripts/run_e2e.sh and passed 10/10 on 2439938, and it
  // could not have without the grant, because this fails loudly when the grant
  // is absent. It must be SET inside the session; PGOPTIONS at connection start is
  // refused. Anywhere that grant is absent this fails loudly rather than seeding
  // half a corpus. Recorded as a vendor dependency, LOCAL AND CI ONLY, in the
  // un-automatable table of docs/runbook-supabase-project-creation.md.
  const wards: [string, string, string, number | null, string, string][] = [
    // facility, category, offering, bed_count, monitoring_state, updated_at offset
    [ALPHA.id, PUBLISH_CATEGORY, 'OFFERED', null, 'PENDING', '0 seconds'], // the ward the golden path publishes to
    [ALPHA.id, SECOND_CATEGORY, 'OFFERED', null, 'PENDING', '0 seconds'],
    [ALPHA.id, STALE_CATEGORY, 'OFFERED', 3, 'ACTIVE', '4 hours'], // deliberately stale
    [BETA.id, PUBLISH_CATEGORY, 'OFFERED', 2, 'ACTIVE', '0 seconds'],
  ];
  await db.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    for (const [facility, category, offering, bedCount, monitoring, age] of wards) {
      await tx`
        insert into app.ward_status
          (facility_id, category, offering, bed_count, accepting, state, source, monitoring_state, version, updated_at)
        values
          (${facility}::uuid, ${category}::app.ward_category, ${offering}::app.ward_offering, ${bedCount}, true,
           'OK', 'WARD', ${monitoring}::app.monitoring_state, 1, now() - ${age}::interval)
        on conflict (facility_id, category) do update set
          offering = excluded.offering, bed_count = excluded.bed_count, accepting = true,
          state = 'OK', source = 'WARD', monitoring_state = excluded.monitoring_state,
          version = 1, updated_at = excluded.updated_at
      `;
    }
  });
  for (const f of [ALPHA, BETA]) {
    await db`select app.project_facility(${f.id}::uuid)`;
  }
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

/**
 * Provision the golden path's ward accounts THROUGH THE PRODUCTION SCRIPT.
 *
 * NOT a direct insert into app.ward_account. An E2E that seeds its own account
 * row proves a fixture: it would pass whether or not scripts/provision_ward_account.mjs
 * works, and the seam the golden path exists to demonstrate -- a GoTrue-issued
 * token whose `sub` resolves to a ward account -- would be asserted against rows
 * the test wrote itself. The script is the only sanctioned way to create one, so
 * it is the way the E2E creates one.
 *
 * TWO ACCOUNTS AT ONE FACILITY, ON DIFFERENT CATEGORIES. The second exists
 * solely to make ward-scope enforcement observable: with one account, an RPC
 * that checks facility membership but never checks p_category behaves
 * identically to one that does. The check now exists -- publish_ward_status
 * (014) refuses WARD_SCOPE_DENIED -- and it is proved in
 * tests/db/publish_ward_status.test.ts, inside a rolled-back transaction. No
 * golden-path step publishes as this account, because Gate 2's path is one ward
 * publishing; the account is provisioned here so the production script is
 * exercised for a second category.
 */
export function provisionE2eWardAccounts(): void {
  for (const [email, category] of [
    [WARD_EMAIL, PUBLISH_CATEGORY],
    [WARD_EMAIL_SECOND, SECOND_CATEGORY],
  ] as const) {
    execFileSync(
      'node',
      [
        join(import.meta.dirname, '..', '..', 'scripts', 'provision_ward_account.mjs'),
        '--email', email,
        '--facility', ALPHA.id,
        '--category', category,
      ],
      { encoding: 'utf8', env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey() } },
    );
  }
}
