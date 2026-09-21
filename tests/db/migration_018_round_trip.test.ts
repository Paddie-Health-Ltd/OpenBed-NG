import { afterAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, psqlCommand } from '../setup/db.js';

/**
 * MIGRATION 018 REVERSES TO EXACTLY THE 017 STATE, AND NO FURTHER.
 *
 * 018 closes the two surfaces an anonymous holder of the published key can
 * address directly: SELECT on the three public mirrors, and Realtime events from
 * them. Its `.down.sql` is a FULL SYMMETRIC REVERSAL -- it puts both back.
 *
 * WHY A REVERSAL THIS FILE EXISTS TO POLICE. A down migration is written last
 * and tested least, and this one restores a SECURITY BOUNDARY in the opening
 * direction. The failure that matters is not "the reversal does not work"; it is
 * "the reversal works AND does a little more" -- a `GRANT ALL` where the forward
 * revoked `SELECT`, a fourth relation, a third role. That overshoot leaves the
 * database looking reverted and standing wider than it ever stood, and nothing
 * else in this repository would notice: tests/compliance/down_migration_symmetry
 * is static and checks only that a reversal EXISTS and mentions what the forward
 * created.
 *
 * SO THE ASSERTIONS ARE EXACT SETS IN BOTH DIRECTIONS, not "anon can read again".
 * After `down`, the state must equal 017's exactly. After `up` again, it must
 * equal 018's exactly. An assertion that merely checked reachability would pass
 * for `GRANT ALL TO PUBLIC`.
 *
 * WHY THIS IS SAFE TO RUN AGAINST THE SHARED TEST DATABASE. The `db` project
 * sets `fileParallelism: false` precisely because the RLS suites mutate grants,
 * so no other file is executing while this one is. Every test here restores the
 * forward state in a `finally`, and `afterAll` restores it once more -- because a
 * file that left the database in the 017 state would hand the next run a silent
 * false green on the boundary suites, which is the worst outcome available here.
 */

const MIG_DIR = join(import.meta.dirname, '..', '..', 'database', 'migrations');
const FORWARD = join(MIG_DIR, '018_close_mirror_read_and_push_surfaces.sql');
const DOWN = join(MIG_DIR, '018_close_mirror_read_and_push_surfaces.down.sql');

const MIRRORS = ['facility_public', 'lga_rollup', 'ward_public'];

/** Applies one SQL file with psql, exactly as the runner does. Throws on error. */
function applyFile(path: string): void {
  const cmd = `${psqlCommand()} -v ON_ERROR_STOP=1 --single-transaction < ${JSON.stringify(path)}`;
  execFileSync('bash', ['-c', cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Everything 018 or its reversal could legitimately touch, as a comparable set.
 *
 * `service_role` IS INCLUDED DELIBERATELY, and it is the half that catches an
 * overshoot. Neither direction of 018 mentions that role, so its grants must be
 * BYTE-IDENTICAL before and after. A reversal that reached for `GRANT ... TO
 * anon, authenticated, service_role` -- the three-role form that appears all over
 * Supabase's own defaults and is the easiest thing in the world to paste --
 * changes nothing a client-role assertion would see.
 */
async function boundaryState(): Promise<{ publication: string[]; grants: string[] }> {
  const pub = await sql()<{ rel: string }[]>`
    select schemaname || '.' || tablename as rel
      from pg_publication_tables
     where pubname = 'supabase_realtime'
     order by schemaname, tablename
  `;
  const grants = await sql()<{ row: string }[]>`
    select grantee || ' ' || table_name || ' ' || string_agg(privilege_type, ',' order by privilege_type) as row
      from information_schema.table_privileges
     where table_schema = 'public'
       and grantee in ('anon', 'authenticated', 'service_role')
     group by grantee, table_name
     order by grantee, table_name
  `;
  return { publication: pub.map((r) => r.rel), grants: grants.map((r) => r.row) };
}

/** service_role's grants, which BOTH directions must leave untouched. */
const SERVICE_ROLE_GRANTS = [
  'service_role facility_public DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
  'service_role lga_rollup DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
  'service_role snapshot_current SELECT',
  'service_role ward_public DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE',
];

/** The state 018 produces: no publication members, no client-role grant anywhere. */
const STATE_018 = {
  publication: [] as string[],
  grants: [...SERVICE_ROLE_GRANTS],
};

/** The state 017 left behind: three published mirrors, EXACTLY SELECT for two roles. */
const STATE_017 = {
  publication: MIRRORS.map((m) => `public.${m}`),
  grants: [
    ...MIRRORS.map((m) => `anon ${m} SELECT`),
    ...MIRRORS.map((m) => `authenticated ${m} SELECT`),
    ...SERVICE_ROLE_GRANTS,
  ].sort(),
};

function sorted(s: { publication: string[]; grants: string[] }) {
  return { publication: [...s.publication].sort(), grants: [...s.grants].sort() };
}

afterAll(() => {
  // Unconditional. If a test threw between `down` and `up`, the database is
  // sitting in the 017 state with the boundary open, and every suite after this
  // one would assert against it.
  applyFile(FORWARD);
});

describe('migration 018 round trip', () => {
  test('the database starts in the 018 state — otherwise nothing below means anything', async () => {
    // ANTI-VACUITY, and it is not ceremony: if the suite is run against a
    // database where 018 was never applied, the `down` assertion below would pass
    // without the reversal having done anything at all.
    expect(sorted(await boundaryState())).toEqual(sorted(STATE_018));
  });

  test('down restores EXACTLY the 017 state', async () => {
    try {
      applyFile(DOWN);
      expect(
        sorted(await boundaryState()),
        'the reversal did not land on 017 exactly — check for an overshoot before assuming it under-applied',
      ).toEqual(sorted(STATE_017));
    } finally {
      applyFile(FORWARD);
    }
  });

  test('up after down restores EXACTLY the 018 state', async () => {
    applyFile(DOWN);
    applyFile(FORWARD);
    expect(sorted(await boundaryState())).toEqual(sorted(STATE_018));
  });

  test('the ledger row goes with it in both directions', async () => {
    const name = '018_close_mirror_read_and_push_surfaces.sql';
    try {
      applyFile(DOWN);
      const afterDown = await sql()<{ n: number }[]>`
        select count(*)::int as n from app.schema_migrations where filename = ${name}
      `;
      expect(afterDown[0]?.n, 'the reversal left its ledger row behind — a re-run would skip it').toBe(0);
    } finally {
      applyFile(FORWARD);
    }
    const afterUp = await sql()<{ n: number }[]>`
      select count(*)::int as n from app.schema_migrations where filename = ${name}
    `;
    expect(afterUp[0]?.n, 'the forward migration did not re-register itself').toBe(1);
  });

  /**
   * THE PLANT, and it is the reason this file is worth its runtime.
   *
   * The three legs above all pass against a reversal that is correct AND against
   * one that is too generous in a way they happen not to look at -- unless the
   * assertions really are exact sets. This constructs the overshoot and proves
   * they reject it.
   *
   * TWO SHAPES, because they fail differently and a real mistake could be either:
   *   (a) WIDER PRIVILEGE -- `GRANT ALL` where the forward revoked SELECT. The
   *       roles are right and the database ends up wider than 017 ever was.
   *   (b) WIDER RELATION SET -- the reversal hands back one more table than the
   *       forward took away. `public.snapshot_current` is the one that matters:
   *       it is service_role-only, it holds the ENTIRE encoded payload, and it
   *       sits in the same schema one comma away from the three mirrors.
   *
   * A THIRD SHAPE WAS TRIED AND IS DELIBERATELY NOT HERE, because it is not a
   * hazard: `TO anon, authenticated, service_role` -- the three-role form
   * Supabase's own defaults use -- produces a state IDENTICAL to a correct
   * reversal. service_role already holds ALL on the mirrors, so granting it
   * SELECT is a true no-op and the database is not one privilege wider. The plant
   * was written, it did not discriminate, and the reason it did not is a fact
   * about Postgres rather than a gap in the assertions. Recording that is worth
   * more than a leg that would have looked like coverage.
   *
   * Per test-conventions, the plant is CONSTRUCTED in a scratch directory and
   * never committed, and each leg confirms the tampered file actually changed the
   * executed statement rather than trusting that the replacement matched.
   */
  test.each([
    ['a WIDER PRIVILEGE — GRANT ALL where the forward revoked SELECT', 'GRANT SELECT ON', 'GRANT ALL ON'],
    [
      'a WIDER RELATION SET — snapshot_current handed back alongside the mirrors',
      'GRANT SELECT ON public.facility_public, public.ward_public, public.lga_rollup TO %I',
      'GRANT SELECT ON public.facility_public, public.ward_public, public.lga_rollup, public.snapshot_current TO %I',
    ],
  ])('plant — %s is rejected by the exact-set assertion', async (_name, needle, replacement) => {
    const original = readFileSync(DOWN, 'utf8');
    expect(original, `the plant's target text is not in the down file: ${needle}`).toContain(needle);

    const tampered = original.replace(needle, replacement);
    expect(tampered, 'the plant did not change the file').not.toBe(original);

    const dir = mkdtempSync(join(tmpdir(), 'openbed-018-plant-'));
    const path = join(dir, 'tampered.down.sql');
    writeFileSync(path, tampered, 'utf8');

    try {
      applyFile(path);
      const state = sorted(await boundaryState());

      // CONFIRM THE PLANT REACHED THE EXECUTED PATH, not merely the bytes. A
      // replacement that landed in a comment would leave the state correct, the
      // assertion below would fail, and the conclusion drawn would be about the
      // test rather than about the plant.
      expect(
        state,
        'the tampered reversal produced the correct 017 state — the plant did not reach the executed GRANT',
      ).not.toEqual(sorted(STATE_017));

      expect(state).not.toEqual(sorted(STATE_018));
    } finally {
      // The tampered grants are not undone by the forward migration alone: it
      // revokes SELECT from two roles, and shape (a) handed out six other
      // privileges while shape (b) touched a third role. Put the mirrors back to
      // a known floor first, then re-apply 018 over it.
      const repair = join(dir, 'repair.sql');
      writeFileSync(
        repair,
        [
          'REVOKE ALL ON public.facility_public, public.ward_public, public.lga_rollup, public.snapshot_current FROM anon;',
          'REVOKE ALL ON public.facility_public, public.ward_public, public.lga_rollup, public.snapshot_current FROM authenticated;',
        ].join('\n'),
        'utf8',
      );
      applyFile(repair);
      applyFile(FORWARD);
    }
  });
});
