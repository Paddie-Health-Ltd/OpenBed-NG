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

  test('plant — a credential in .next/static is rejected, not only in dist', () => {
    // The guard's find predicate declares TWO paths: */dist/* and */.next/static/*.
    // Only the first was ever planted, so the second half of the scope was a
    // coverage claim with nothing behind it -- a `-path` that stopped matching
    // after a framework change would have gone unnoticed.
    withScratch((root) => {
      place(root, 'apps/x/.next/static/chunks/main.js', `const k = "${PLANT_SB_SECRET}";`);
      const res = runLint(LINT, root);
      expect(res.status, `a credential in .next/static was accepted:\n${res.stdout}`).toBe(1);
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
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, `the real tree was rejected:\n${res.stdout}`).toBe(0);
  });

  test.each([
    ['.lt() on updated_at', "const q = db.from('ward_public').lt('updated_at', cutoff);"],
    ['.gt() on updated_at', "const q = db.from('ward_public').gt('updated_at', cutoff);"],
    ['.filter() on updated_at', "const q = db.from('ward_public').filter('updated_at', 'gte', cutoff);"],
    ['a WHERE clause on updated_at', "const sql = `select * from ward_public where updated_at > now() - interval '2 hours'`;"],
    // The guard matches `updated_at|updatedAt`. The camelCase half was unplanted,
    // and camelCase is the form a TypeScript client actually writes after a codec
    // maps the row -- so it is the likelier carrier of the 4am bug, not the rarer.
    ['.lt() on the camelCase updatedAt', "const q = db.from('ward_public').lt('updatedAt', cutoff);"],
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
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, `the real tree was rejected:\n${res.stdout}`).toBe(0);
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
      const res = runLint(LINT, root);
      expect(res.status, `a correct query was rejected:\n${res.stdout}`).toBe(0);
    });
  });

  test('anti-vacuity — a missing allowlist FAILS rather than allowing everything', () => {
    withScratch((root) => {
      place(root, 'apps/x/src/query.ts', "const q = db.from('anything').select('x');");
      const res = runLint(LINT, root);
      expect(res.status, `a missing allowlist did not stop the run:\n${res.stdout}`).toBe(2);
      // Delete the `[ -f "$ALLOWLIST_JSON" ]` check and node's own catch exits 3,
      // so the next leg exits 2 anyway. The message is the whole distinction.
      expect(res.stdout, 'the missing-allowlist refusal did not name itself').toContain('allowlist not found at');
    });
  });

  // FINDING 6's PROBE. The header claims the allowlist is READ FROM the fixture
  // rather than hardcoded. Before 2026-09-10 that claim was false -- the parser
  // was a fixed five-name alternation, so the fixture was a filter over names the
  // script already knew. These two legs are the claim's probe, and they only mean
  // something as a PAIR: the first alone could pass because the name was
  // hardcoded, the second alone could pass because the parser returned nothing.
  const SIXTH = "const q = db.from('bed_ledger_public').select('facility_id');";

  test('the fixture is the SOURCE of names — a sixth relation in the fixture is accepted', () => {
    withScratch((root) => {
      place(root, 'packages/fixtures/public-relations.json', JSON.stringify({
        mirrors: ['facility_public', 'ward_public', 'lga_rollup', 'bed_ledger_public'],
        rpcs: ['my_facility_wards', 'ward_status_history'],
      }));
      place(root, 'apps/x/src/query.ts', SIXTH);
      const res = runLint(LINT, root);
      expect(res.status, `a relation named in the fixture was rejected — the parser is not reading it:\n${res.stdout}`).toBe(0);
    });
  });

  test('control for the leg above — the same query is rejected when the fixture omits it', () => {
    withScratch((root) => {
      scaffold(root);
      place(root, 'apps/x/src/query.ts', SIXTH);
      const res = runLint(LINT, root);
      expect(res.status, `a relation absent from the fixture was accepted:\n${res.stdout}`).toBe(1);
    });
  });

  test('plant — a relation named only in the fixture COMMENT does not become allowlisted', () => {
    // The by-key parse, asserted. An all-strings extraction over this fixture
    // would pull the base table out of the prose and silently allow it.
    withScratch((root) => {
      place(root, 'packages/fixtures/public-relations.json', JSON.stringify({
        comment: 'These mirror app.ward_status and must never expose it directly.',
        exposedSchemas: ['public', 'graphql_public'],
        mirrors: ['facility_public', 'ward_public', 'lga_rollup'],
        rpcs: ['my_facility_wards', 'ward_status_history'],
      }));
      place(root, 'apps/x/src/query.ts', "const q = db.from('ward_status').select('bed_count');");
      const res = runLint(LINT, root);
      expect(res.status, `a name from the fixture's prose was treated as allowlisted:\n${res.stdout}`).toBe(1);
    });
  });

  test('plant — a malformed allowlist STOPS the run rather than parsing to nothing', () => {
    withScratch((root) => {
      place(root, 'packages/fixtures/public-relations.json', JSON.stringify({ mirrors: ['ward_public'] }));
      place(root, 'apps/x/src/query.ts', "const q = db.from('ward_public').select('x');");
      const res = runLint(LINT, root);
      expect(res.status, `a fixture missing its rpcs array still produced a verdict:\n${res.stdout}`).toBe(2);
    });
  });
});
