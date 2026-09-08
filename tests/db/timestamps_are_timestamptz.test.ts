import { describe, expect, test } from 'vitest';
import { sql, withRole } from '../setup/db.js';

/**
 * EVERY timestamp column is `timestamptz`.
 *
 * The kickoff is blunt about this: "a single `timestamp without time zone` in
 * this schema is a defect". The reason is finding F3. Freshness is the product --
 * a bed count without a trustworthy age is not information, it is a rumour -- and
 * a naive timestamp silently acquires whatever timezone the reader assumes. In a
 * system whose escalation thresholds are evaluated in Africa/Lagos while the
 * database runs in UTC, a one-hour offset moves the quiet-hours boundary and
 * produces a 05:00 alert storm. That is the likeliest cause the first time one
 * appears.
 */
describe('timestamp columns', () => {
  test('no column anywhere in app or public is timestamp without time zone', async () => {
    const rows = await sql()<{ table_schema: string; table_name: string; column_name: string }[]>`
      select table_schema, table_name, column_name
        from information_schema.columns
       where table_schema in ('app', 'public')
         and data_type = 'timestamp without time zone'
       order by 1, 2, 3
    `;
    expect(
      rows.map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`),
      'naive timestamp columns found',
    ).toEqual([]);
  });

  test('there are timestamptz columns to have checked — the guard is not vacuous', async () => {
    const [row] = await sql()<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
       where table_schema in ('app', 'public') and data_type = 'timestamp with time zone'
    `;
    expect(row?.n, 'no timestamptz columns at all; the guard above proves nothing').toBeGreaterThan(20);
  });

  test('updated_at is server-stamped and a client-supplied value is discarded', async () => {
    // FINDING F3, COROLLARY. A ward phone with a fast clock writing a future
    // timestamp would stay green for hours after it stopped being true, and the
    // read path could not detect it. The trigger overwrites unconditionally --
    // this is a confiscation, not a default.
    //
    // Written as sequential statements inside one transaction rather than as a
    // single CTE: a data-modifying CTE sees the statement's snapshot, so an
    // UPDATE arm cannot see a row INSERTed by a sibling arm and would silently
    // match zero rows.
    const future = await withRole('postgres', null, async (tx) => {
      const ins = await tx.unsafe<{ id: string }[]>(`
        insert into app.facility (name, lga, state, lat, lng, public_phone_e164, updated_at)
        values ('TZ Probe', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000091', now() + interval '10 years')
        returning id
      `);
      const id = ins[0]?.id;

      // Even on INSERT the value must not survive into the future: the BEFORE
      // UPDATE trigger does not fire on INSERT, so this first check documents
      // what is and is not covered.
      const afterInsert = await tx.unsafe<{ future: boolean }[]>(
        `select updated_at > now() + interval '1 day' as future from app.facility where id = '${id}'`,
      );

      // The UPDATE path, which is where the trigger fires and where a ward phone
      // would actually be writing.
      await tx.unsafe(`
        update app.facility set name = 'TZ Probe 2', updated_at = now() + interval '10 years'
         where id = '${id}'
      `);
      const afterUpdate = await tx.unsafe<{ future: boolean }[]>(
        `select updated_at > now() + interval '1 day' as future from app.facility where id = '${id}'`,
      );

      return { insert: afterInsert[0]?.future, update: afterUpdate[0]?.future };
    });

    // The assertion that matters: no client-supplied value survives an UPDATE.
    expect(future.update, 'a client-supplied future updated_at survived the trigger').toBe(false);

    // NOT ASSERTED AS A PASS: the INSERT path. app.touch_updated_at() is a BEFORE
    // UPDATE trigger only, so an INSERT carrying an absurd updated_at is stored
    // as given -- recorded here as a known gap rather than hidden. It is not
    // reachable in production because no client role can INSERT into app at all
    // (tests/db/rls_enabled_everywhere.test.ts asserts the grants), and every
    // write arrives through a SECURITY DEFINER RPC that does not accept the
    // column. If a future bundle ever adds a client-reachable INSERT path, this
    // must become a BEFORE INSERT OR UPDATE trigger.
    expect(typeof future.insert).toBe('boolean');
  });
});
