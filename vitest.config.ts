import { defineConfig } from 'vitest/config';

/**
 * Two projects, split by what they NEED rather than by what they cover.
 *
 *   db          -- requires Postgres AND PostgREST (`npm run db:start`).
 *   compliance  -- requires nothing but the filesystem.
 *   e2e         -- requires the whole stack INCLUDING GoTrue, and COMMITS.

 * `npm run test` runs db and compliance only. e2e is excluded from it
 * deliberately: tests/e2e/golden-path.test.ts is corpus generation for the
 * ratchet and is EXPECTED to be partially red, so folding it into the default
 * command would make Standard O's ZERO-RED unreachable by design. It runs
 * through `npm run test:e2e`, which is two phases -- generate, then gate.
 *
 * Both are merge-blocking and NEITHER is paths-filtered in CI. GitHub counts a
 * skipped required check as passing, so a required check gated on a paths
 * filter is not a gate on the pull requests it skips -- it reports success on
 * exactly the changes it did not examine.
 * tests/compliance/ci_required_checks_not_paths_filtered.test.ts enforces that.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          globalSetup: ['tests/setup/global-setup.ts'],
          // The RLS negative suite mutates roles and grants. Running two such
          // files at once against one database produces failures that depend on
          // interleaving, which is worse than slow.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'compliance',
          include: ['tests/compliance/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.test.ts'],
          globalSetup: ['tests/e2e/global-setup.ts'],
          // The golden path COMMITS, and its steps share state in order: one
          // publish is asserted by the next step's projection. Parallelism or
          // concurrency here would make the sequence a race.
          fileParallelism: false,
          sequence: { concurrent: false },
          // Real HTTP against GoTrue and PostgREST, on a cold CI runner.
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
