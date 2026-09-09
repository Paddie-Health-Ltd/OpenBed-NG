import { defineConfig } from 'vitest/config';

/**
 * Two projects, split by what they NEED rather than by what they cover.
 *
 *   db          -- requires Postgres AND PostgREST (`npm run db:start`).
 *   compliance  -- requires nothing but the filesystem.
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
    ],
  },
});
