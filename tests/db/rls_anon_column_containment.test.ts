import { describe, expect, test } from 'vitest';
import { sql } from '../setup/db.js';
import PUBLIC_RELATIONS from '../../packages/fixtures/public-relations.json';

/**
 * RELEASE GATE 1, LEG 2 -- the anonymous read surface exposes no private column.
 *
 * WHY A COLUMN TEST AND NOT A ROW TEST. Every requirement that matters here is a
 * column requirement: `reason_code` hidden while `bed_count` on the same row is
 * public; a staff mobile hidden while the facility's public line is public. RLS
 * is row-level and cannot express any of that. So the control is a containment
 * assertion over the actual catalogue.
 *
 * TWO ASSERTIONS, AND THE SECOND IS THE STRONGER ONE.
 *   1. No anon-readable relation exposes any FORBIDDEN column. Catches a private
 *      column arriving on a public table.
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
 * A PRE-EXISTING DEFECT, FIXED HERE RATHER THAN INHERITED. The previous docstring
 * claimed all seven of these "are real column names in this schema, not
 * hypotheticals". That was already false: `refusal_note` has NEVER existed -- it
 * was cut from the first schema draft (kickoff B1) and survives only in comments
 * explaining its removal. The ward-level identity decision made it false for
 * `fingerprint` too. The claim is now split so that each half is true and each
 * half is asserted.
 */
const FORBIDDEN_COLUMNS = [
  'reason_code',
  'mobile_e164',
  'admin_note',
  'refusal_note',
  'ward_reply',
  'token_hash',
  'fingerprint',
  // Added by the ward-level identity decision (2026-09-08). Banned from the
  // audit log and the event stream by that decision; banned from the anonymous
  // surface here as well, at zero cost.
  'actor_id',
  'user_id',
  'ip_address',
  'user_agent',
  'display_name',
] as const;

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
 * information_schema, which is what anon actually reads.
 */
import WARD_PUBLIC_FROZEN_COLUMNS_SOURCE from '../../packages/fixtures/snapshot-shape.json';
const WARD_PUBLIC_FROZEN_COLUMNS = WARD_PUBLIC_FROZEN_COLUMNS_SOURCE.wardColumns;

/**
 * THE FROZEN COLUMN LIST for public.facility_public. Eight columns, in ordinal
 * order.
 *
 * public.facility_public is an anon-readable surface exactly as ward_public is,
 * and until now it had no exact column list at all -- only the forbidden-name
 * check, which is keyed to seven literal names and is therefore blind to a
 * private column nobody thought to forbid. A facility-level column added here
 * would have reached every anonymous reader with no test going red.
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

/** Relations an anonymous caller can SELECT from, within the exposed schemas. */
async function anonReadableRelations(): Promise<string[]> {
  const rows = await sql()<{ table_schema: string; table_name: string }[]>`
    select distinct table_schema, table_name
      from information_schema.table_privileges
     where grantee = 'anon'
       and privilege_type = 'SELECT'
       and table_schema = any(${EXPOSED_SCHEMAS})
     order by table_schema, table_name
  `;
  return rows.map((r) => `${r.table_schema}.${r.table_name}`);
}

describe('anon column containment', () => {
  test('the anon-readable set is exactly the three public mirrors', async () => {
    // Anti-vacuity AND the assertion at once. If this returned an empty set, every
    // containment check below would pass while proving nothing.
    const relations = await anonReadableRelations();
    expect(relations.sort()).toEqual([
      'public.facility_public',
      'public.lga_rollup',
      'public.ward_public',
    ]);
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
   */
  test('anon holds exactly SELECT on each mirror — no TRIGGER, no REFERENCES, no writes', async () => {
    const rows = await sql()<{ table_name: string; privs: string }[]>`
      select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
        from information_schema.table_privileges
       where grantee = 'anon' and table_schema = 'public'
       group by table_name
       order by table_name
    `;

    expect(rows.length, 'no mirror grants found — the assertion would be vacuous').toBe(3);
    for (const row of rows) {
      expect(row.privs, `anon holds more than SELECT on public.${row.table_name}`).toBe('SELECT');
    }
  });

  test('no anon-readable relation exposes a forbidden column', async () => {
    const rows = await sql()<{ table_schema: string; table_name: string; column_name: string }[]>`
      select c.table_schema, c.table_name, c.column_name
        from information_schema.columns c
       where (c.table_schema, c.table_name) in (
             select distinct p.table_schema, p.table_name
               from information_schema.table_privileges p
              where p.grantee = 'anon' and p.privilege_type = 'SELECT'
                and p.table_schema = any(${EXPOSED_SCHEMAS})
       )
         and c.column_name = any(${[...FORBIDDEN_COLUMNS]})
    `;

    const leaks = rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`);
    expect(leaks, 'private columns are readable by anon').toEqual([]);
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
