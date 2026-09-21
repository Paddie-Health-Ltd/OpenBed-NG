import { describe, expect, test } from 'vitest';
import { sql } from '../setup/db.js';
import PUBLIC_RELATIONS from '../../packages/fixtures/public-relations.json';
import FORBIDDEN from '../../packages/fixtures/forbidden-columns.json';

/**
 * RELEASE GATE 1, LEG 2 -- the relations the PUBLIC SNAPSHOT IS BUILT FROM expose
 * no private column.
 *
 * THE TITLE OF THIS FILE USED TO READ "the anonymous read surface", and that went
 * false with migration 018: there is no anonymous read surface in the database any
 * more. The hazard did not move with it. These relations feed
 * app.regenerate_snapshot(), the snapshot becomes /beds.json, and /beds.json is
 * what every visitor reads -- so a private column arriving on one of them is
 * published just as surely as it was when anon could SELECT it directly, and with
 * one fewer place for anyone to notice.
 *
 * WHY A COLUMN TEST AND NOT A ROW TEST. Every requirement that matters here is a
 * column requirement: `reason_code` hidden while `bed_count` on the same row is
 * public; a staff mobile hidden while the facility's public line is public. RLS
 * is row-level and cannot express any of that. So the control is a containment
 * assertion over the actual catalogue.
 *
 * TWO ASSERTIONS, AND THE SECOND IS THE STRONGER ONE.
 *   1. No generator source relation exposes any FORBIDDEN column. Catches a
 *      private column arriving on a public table.
 *   2. public.ward_public's column list equals a FROZEN list EXACTLY -- equality,
 *      not containment. Catches the case assertion 1 cannot: a NEW private
 *      column, with a name nobody thought to forbid, added to the most-read
 *      table in the system. Nobody can predict the next bad column name; everyone
 *      can notice the list changed.
 */

/**
 * Column names that must never be readable by an anonymous caller, WHETHER OR NOT
 * THEY EXIST TODAY. Forbidding an absent name is deliberate: it catches a
 * REINTRODUCTION, which is the likelier failure once a column has been removed.
 *
 * IMPORTED FROM packages/fixtures/forbidden-columns.json, NOT RESTATED (2026-09-18,
 * A1 sprint Bundle 1). The same list now guards a second surface -- the served
 * /beds.json document, in tests/db/beds_json_served.test.ts -- and two literal
 * copies could be edited apart while both stayed green. The shared-fixture link
 * of test-conventions.md section 8: drift now requires editing one file, which
 * reddens both. The list itself did not change in the move.
 *
 * A PRE-EXISTING DEFECT, FIXED HERE RATHER THAN INHERITED. The previous docstring
 * claimed all seven of these "are real column names in this schema, not
 * hypotheticals". That was already false: `refusal_note` has NEVER existed -- it
 * was cut from the first schema draft (kickoff B1) and survives only in comments
 * explaining its removal. The ward-level identity decision made it false for
 * `fingerprint` too. The claim is now split so that each half is true and each
 * half is asserted.
 */
const FORBIDDEN_COLUMNS: readonly string[] = FORBIDDEN.columns;

/**
 * The subset that MUST exist in `app` today. THIS IS THE ANTI-VACUITY LEG: with
 * it, a containment assertion cannot silently decay into a check for a string
 * that occurs nowhere.
 *
 * Deliberately absent from `app`, each with a reason on file:
 *   refusal_note  -- cut from the first schema draft. Never existed.
 *   fingerprint   -- removed from app.device by the ward-level identity decision;
 *                    it was a user_agent by another name.
 *   actor_id, user_id, ip_address, user_agent, display_name -- removed or never
 *                    built under the same decision.
 */
const FORBIDDEN_COLUMNS_THAT_MUST_EXIST = [
  'reason_code',
  'mobile_e164',
  'admin_note',
  'ward_reply',
  'token_hash',
] as const;

/**
 * THE FROZEN COLUMN LIST for public.ward_public — IMPORTED, NOT RESTATED.
 *
 * It was a literal here. That made THREE statements of the same list: migration
 * 007's CREATE TABLE, this test, and packages/fixtures/snapshot-shape.json's
 * `wardColumns`, which the snapshot codec builds its encoder and decoder from.
 * Three statements of one fact drift, and the drift is silent in the direction
 * that matters: the snapshot would carry a column this test never checked was
 * safe to publish anonymously.
 *
 * Now one source. `tests/compliance/snapshot_shape_matches_migration.test.ts`
 * ties the fixture to 007 statically, and this ties it to the LIVE catalogue --
 * so the migration, the anonymous read surface and the wire format are pinned
 * together, and changing any one of them reddens.
 *
 * THE LIVE CHECK IS THE POINT. Asserting the fixture against itself would be
 * self-consistent and prove nothing; what is asserted below is
 * information_schema -- the shape the generator will actually read next time it
 * runs. (This sentence read "which is what anon actually reads" until migration
 * 018 revoked that access. The check is unchanged; only the reason it matters
 * is.)
 */
import WARD_PUBLIC_FROZEN_COLUMNS_SOURCE from '../../packages/fixtures/snapshot-shape.json';
const WARD_PUBLIC_FROZEN_COLUMNS = WARD_PUBLIC_FROZEN_COLUMNS_SOURCE.wardColumns;

/**
 * THE FROZEN COLUMN LIST for public.facility_public. Eight columns, in ordinal
 * order.
 *
 * public.facility_public feeds the snapshot exactly as ward_public does, and
 * until 2026-09-18 it had no exact column list at all -- only the forbidden-name
 * check, which is keyed to seven literal names and is therefore blind to a
 * private column nobody thought to forbid. A facility-level column added here
 * would have reached every reader of /beds.json with no test going red.
 *
 * Asserted for EQUALITY, not containment, for the same reason ward_public is: a
 * subset check passes while a new column sits on the public surface.
 */
const FACILITY_PUBLIC_FROZEN_COLUMNS = [
  'facility_id',
  'name',
  'lga',
  'state',
  'lat',
  'lng',
  'public_phone_e164',
  'updated_at',
];

/**
 * Schemas PostgREST exposes. Anything outside these is not addressable over HTTP
 * whatever its grants say.
 *
 * SCOPED DELIBERATELY. A fresh Supabase project also grants anon privileges on
 * `realtime.messages`, `realtime.subscription`, `supabase_functions.hooks` and
 * `supabase_functions.migrations`. Those are platform-managed, live in schemas
 * that are NOT exposed, and are not this repository's to revoke. Asserting over
 * them would make this test fail on a platform upgrade for no security reason --
 * and a guard that reds for reasons unrelated to what it guards is a guard people
 * learn to ignore.
 *
 * READ FROM packages/fixtures/public-relations.json, and asserted against
 * supabase/config.toml by tests/db/config_drift.test.ts, which reads the same
 * file. The link is an import, not a comment claiming one -- it WAS the latter
 * until this change, which is a Clause 5 defect: present, and not reaching.
 *
 * The shared constant lives in the fixture rather than being exported from this
 * test file, because importing a test module re-registers its tests in whatever
 * imports it.
 */
const EXPOSED_SCHEMAS = PUBLIC_RELATIONS.exposedSchemas;

/**
 * THE SUBJECT OF THIS FILE CHANGED WITH MIGRATION 018, AND THE OLD ONE IS NAMED
 * RATHER THAN QUIETLY REPLACED.
 *
 * Until 018 the corpus below was derived from `information_schema` as *the
 * relations anon holds SELECT on*, and the file's own docstring called that
 * "what anon actually reads". That was true and it is now FALSE: 018 revoked
 * SELECT on all three mirrors from anon and authenticated, so the old derivation
 * returns an EMPTY SET — and every containment assertion underneath it would
 * pass, over nothing, reporting exactly what a working suite reports.
 *
 * THE PROPERTY DID NOT GO AWAY; ITS SURFACE MOVED. What must not carry a private
 * column is now the SERVED DOCUMENT, and that is asserted in
 * tests/db/beds_json_served.test.ts against the real payload (Bundle 1).
 *
 * WHAT THIS FILE ASSERTS NOW is the catalogue BEHIND that document: the three
 * relations app.regenerate_snapshot() reads to build it. A private column
 * arriving on one of them reaches the snapshot, and the snapshot reaches every
 * visitor — so the hazard is unchanged even though nobody can read these tables
 * directly any more.
 *
 * WHY A CHECKED-IN LIST AND NOT A DERIVED ONE. There is no grant, policy or
 * publication membership left that picks out these three, because 018 removed
 * all of them; deriving the corpus from any surviving catalogue predicate would
 * be choosing a proxy and hoping it keeps agreeing. The literal list is the
 * test-conventions section 3 pattern — it decays LOUDLY, because the identity
 * assertion below reddens the moment a public table is added, renamed or
 * dropped. That is the failure this file exists to catch: a new public table
 * carrying a column nobody thought to forbid.
 */
const GENERATOR_SOURCE_RELATIONS = [
  'public.facility_public',
  'public.lga_rollup',
  'public.ward_public',
];

/** Every base table in the exposed schemas, from the live catalogue. */
async function publicBaseRelations(): Promise<string[]> {
  const rows = await sql()<{ table_schema: string; table_name: string }[]>`
    select c.relnamespace::regnamespace::text as table_schema, c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'r'
       and n.nspname = any(${EXPOSED_SCHEMAS})
     order by 1, 2
  `;
  return rows.map((r) => `${r.table_schema}.${r.table_name}`);
}

describe('anon column containment', () => {
  test('the generator source set is exactly the three public mirrors', async () => {
    // Anti-vacuity AND the assertion at once, by IDENTITY rather than by count.
    // public.snapshot_current is the fourth table in the schema and is excluded
    // deliberately: it holds the already-encoded payload, is service_role-only,
    // and its contents are asserted in tests/db/snapshot.test.ts and
    // tests/db/beds_json_served.test.ts. Naming it here keeps its absence a
    // decision rather than an oversight.
    const relations = await publicBaseRelations();
    expect(
      relations.sort(),
      'the set of public base tables changed — a new one must be classified before this suite can pass',
    ).toEqual([...GENERATOR_SOURCE_RELATIONS, 'public.snapshot_current'].sort());
  });


  /**
   * The privilege SET, not merely its membership.
   *
   * THIS ASSERTION FOUND A REAL DEFECT ON ITS FIRST RUN. A fresh Supabase project
   * carries `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO
   * anon, authenticated`, so every new public table arrives with the full
   * privilege set attached. Migration 007's original enumerated
   * `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` looked exhaustive and left TRIGGER
   * and REFERENCES behind -- TRIGGER being the ability to attach a trigger to the
   * table the entire public dashboard reads.
   *
   * A test asserting only "anon can SELECT" would have passed throughout. The set
   * equality is what caught it, and it is why the fix in 007/013 is
   * `REVOKE ALL` then `GRANT SELECT` rather than a longer enumerated list: the
   * next privilege type Postgres adds is covered without anyone noticing it was
   * added.
   *
   * MIGRATION 018 INVERTS THE EXPECTED VALUE AND KEEPS THE HAZARD. The assertion
   * was `rows.length === 3` and `privs === 'SELECT'` for each. 018 revokes that
   * SELECT, so the correct expectation is now the EMPTY SET — for `authenticated`
   * as well as `anon`, since 018 revoked from both.
   *
   * This is a TIGHTENING, not a relaxation, and the direction matters because a
   * removed assertion is the thing Standard O calls a cardinal sin. The old form
   * permitted exactly one privilege on exactly three tables and said nothing
   * about any other public table; the new form permits NOTHING to either client
   * role anywhere in the schema. The default-privileges hazard the docstring
   * above describes is therefore covered MORE widely than before: a new public
   * table arriving with the full default set is caught here, where previously it
   * would have had to be one of the three named mirrors.
   *
   * The anti-vacuity problem this creates is real and is handled by the identity
   * assertion at the top of this describe: an empty result here means something
   * only because the corpus of public tables is separately pinned by name.
   */
  test('no client role holds ANY privilege on any public table — no SELECT, no TRIGGER, no REFERENCES', async () => {
    const rows = await sql()<{ grantee: string; table_name: string; privs: string }[]>`
      select grantee, table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
        from information_schema.table_privileges
       where grantee in ('anon', 'authenticated') and table_schema = 'public'
       group by grantee, table_name
       order by grantee, table_name
    `;

    expect(
      rows.map((r) => `${r.grantee} holds ${r.privs} on public.${r.table_name}`),
      'a client role still holds a privilege on a public table',
    ).toEqual([]);
  });

  test('no generator source relation exposes a forbidden column', async () => {
    // THE CORPUS CHANGED WITH 018 AND THE ASSERTION DID NOT.
    //
    // This subquery used to select the relations anon holds SELECT on. After 018
    // that set is EMPTY, so `leaks` would be empty for a reason that has nothing
    // to do with private columns, and this leg would have gone green forever over
    // a corpus of zero relations. That is the exact shape test-conventions calls
    // a guard that silently scanned nothing.
    //
    // The corpus is now the generator's sources, named at the top of this file
    // and pinned by the identity assertion there. The hazard is unchanged: a
    // forbidden column on one of these reaches the snapshot, and the snapshot
    // reaches every visitor.
    const rows = await sql()<{ table_schema: string; table_name: string; column_name: string }[]>`
      select c.table_schema, c.table_name, c.column_name
        from information_schema.columns c
       where (c.table_schema || '.' || c.table_name) = any(${GENERATOR_SOURCE_RELATIONS})
         and c.column_name = any(${[...FORBIDDEN_COLUMNS]})
    `;

    const leaks = rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`);
    expect(leaks, 'private columns are present on a relation the snapshot is built from').toEqual([]);
  });

  test('ward_public column list regression — the frozen list is unchanged', async () => {
    const rows = await sql()<{ column_name: string }[]>`
      select column_name
        from information_schema.columns
       where table_schema = 'public' and table_name = 'ward_public'
       order by ordinal_position
    `;
    const actual = rows.map((r) => r.column_name);

    // EQUALITY, not containment. A subset check would pass while a new private
    // column sat on the most-read table in the system.
    expect(actual).toEqual(WARD_PUBLIC_FROZEN_COLUMNS);
  });

  test('facility_public column list regression — the frozen list is unchanged', async () => {
    const rows = await sql()<{ column_name: string }[]>`
      select column_name
        from information_schema.columns
       where table_schema = 'public' and table_name = 'facility_public'
       order by ordinal_position
    `;
    const actual = rows.map((r) => r.column_name);

    // EQUALITY, as for ward_public. The two mirrors are the same kind of
    // surface and get the same kind of guard.
    expect(actual).toEqual(FACILITY_PUBLIC_FROZEN_COLUMNS);
  });

  test.each(FORBIDDEN_COLUMNS_THAT_MUST_EXIST)(
    'anti-vacuity — %s genuinely exists in app, so forbidding it is not a no-op',
    async (column) => {
      // A guard that passes because its subject is absent is the defect it was
      // written to close. Every name here must be real somewhere in `app`, or the
      // containment assertion above is testing nothing for that name.
      const [row] = await sql()<{ n: number }[]>`
        select count(*)::int as n from information_schema.columns
         where table_schema = 'app' and column_name = ${column}
      `;
      expect(row?.n, `${column} does not exist in app — the containment test is vacuous for it`)
        .toBeGreaterThan(0);
    },
  );

  test('reason_code exists in app but has never been projected to public', async () => {
    const [pub] = await sql()<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
       where table_schema = 'public' and column_name = 'reason_code'
    `;
    expect(pub?.n, 'reason_code has appeared in the public schema').toBe(0);
  });
});
