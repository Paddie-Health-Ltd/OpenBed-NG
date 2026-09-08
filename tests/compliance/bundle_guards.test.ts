import { describe, expect, test } from 'vitest';
import { runLint, withScratch, place, REPO_ROOT } from './_scratch.js';
import { PLANT_SB_SECRET } from './_plants.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GUARDS OVER GUARDS -- the three checks that run against client code:
 *   scripts/lint_no_service_role_in_bundle.sh
 *   scripts/lint_no_updated_at_filter.sh
 *   scripts/lint_from_allowlist.sh
 *
 * CLASSIFICATION (Clause 5 of .claude/rules/code-pipeline.md). The first two are
 * GUARD-AHEAD-OF-SUBJECT: they execute, they are non-vacuous, and they run over
 * the Bundle 1 dashboard stub -- but the code they are AIMED at, a real Supabase
 * client and a real freshness computation, arrives in Bundle 4. They become LIVE
 * as part of that bundle.
 *
 * That is not a reason to weaken them now. It is a reason to say so plainly here
 * rather than let a reader infer coverage that does not yet exist.
 *
 * The ANTI-VACUITY leg carries unusual weight for the bundle grep specifically:
 * its corpus is BUILT output, so the natural failure is "nobody ran the build"
 * and the natural wrong answer is to report clean over an empty directory.
 */

describe('service-role bundle guard', () => {
  const LINT = 'lint_no_service_role_in_bundle.sh';

  test('the real built bundle is accepted', () => {
    const dist = join(REPO_ROOT, 'apps', 'public-dashboard', 'dist');
    expect(existsSync(dist), 'run `npm run build` before the compliance suite').toBe(true);
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, res.stdout).toBe(0);
  });

  test.each([
    ['service_role literal', 'const k = "service_role";'],
    ['SUPABASE_SERVICE env name', 'const k = process.env.SUPABASE_SERVICE_KEY;'],
    ['sb_secret_ prefix', `const k = "${PLANT_SB_SECRET}";`],
  ])('plant — %s in a built bundle is rejected', (_name, code) => {
    withScratch((root) => {
      place(root, 'apps/x/dist/assets/index.js', code);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
    });
  });

  test('positive control — an ordinary bundle is accepted', () => {
    withScratch((root) => {
      place(root, 'apps/x/dist/assets/index.js', 'export const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;');
      expect(runLint(LINT, root).status).toBe(0);
    });
  });

  test('anti-vacuity — no built output FAILS rather than passing', () => {
    // The failure this guard is most likely to have in practice: the build step
    // was skipped and the grep scanned an empty directory.
    withScratch((root) => {
      place(root, 'apps/x/src/main.ts', 'export const x = 1;');
      const res = runLint(LINT, root);
      expect(res.status, 'grepping zero built files reported success').toBe(2);
    });
  });
});

describe('updated_at filter guard', () => {
  const LINT = 'lint_no_updated_at_filter.sh';

  test('the real source tree is accepted', () => {
    expect(runLint(LINT, REPO_ROOT).status).toBe(0);
  });

  test.each([
    ['.lt() on updated_at', "const q = db.from('ward_public').lt('updated_at', cutoff);"],
    ['.gt() on updated_at', "const q = db.from('ward_public').gt('updated_at', cutoff);"],
    ['.filter() on updated_at', "const q = db.from('ward_public').filter('updated_at', 'gte', cutoff);"],
    ['a WHERE clause on updated_at', "const sql = `select * from ward_public where updated_at > now() - interval '2 hours'`;"],
  ])('plant — %s is rejected', (_name, code) => {
    withScratch((root) => {
      place(root, 'apps/x/src/query.ts', code);
      const res = runLint(LINT, root);
      expect(res.status, `THE 4AM BUG WAS ACCEPTED:\n${res.stdout}`).toBe(1);
    });
  });

  test('positive control — ORDERING by updated_at is allowed', () => {
    // Freshness MAY reorder. It may never filter. If this were rejected, the
    // sort key the product depends on would be unwritable and someone would
    // disable the guard to ship.
    withScratch((root) => {
      place(root, 'apps/x/src/query.ts', "const q = db.from('ward_public').order('updated_at', { ascending: false });");
      expect(runLint(LINT, root).status).toBe(0);
    });
  });

  test('positive control — an annotated ordering line is allowed', () => {
    withScratch((root) => {
      place(root, 'apps/x/src/query.ts',
        "// OPENBED-FRESHNESS-ORDER-ONLY\nconst sql = `select * from ward_public order by updated_at desc`;");
      expect(runLint(LINT, root).status).toBe(0);
    });
  });

  test('anti-vacuity — an empty source tree FAILS', () => {
    withScratch((root) => {
      place(root, 'README.md', 'x');
      expect(runLint(LINT, root).status).toBe(2);
    });
  });
});

describe('from() allowlist guard', () => {
  const LINT = 'lint_from_allowlist.sh';

  function scaffold(root: string): void {
    place(root, 'packages/fixtures/public-relations.json',
      JSON.stringify({ mirrors: ['facility_public', 'ward_public', 'lga_rollup'], rpcs: ['my_facility_wards', 'ward_status_history'] }));
  }

  test('the real source tree is accepted', () => {
    expect(runLint(LINT, REPO_ROOT).status).toBe(0);
  });

  test.each([
    ['a base table in app', "const q = db.from('ward_status').select('bed_count');"],
    ['the audit log', "const q = db.from('audit_log').select('action');"],
    ['select(*)', "const q = db.from('ward_public').select('*');"],
  ])('plant — %s is rejected', (_name, code) => {
    withScratch((root) => {
      scaffold(root);
      place(root, 'apps/x/src/query.ts', code);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
    });
  });

  test('positive control — an allowlisted mirror with named columns is accepted', () => {
    withScratch((root) => {
      scaffold(root);
      place(root, 'apps/x/src/query.ts', "const q = db.from('ward_public').select('facility_id,category,bed_count');");
      expect(runLint(LINT, root).status).toBe(0);
    });
  });

  test('anti-vacuity — a missing allowlist FAILS rather than allowing everything', () => {
    withScratch((root) => {
      place(root, 'apps/x/src/query.ts', "const q = db.from('anything').select('x');");
      expect(runLint(LINT, root).status).toBe(2);
    });
  });
});
