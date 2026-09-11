import { describe, expect, test } from 'vitest';
import { runLint, withScratch, place, REPO_ROOT } from './_scratch.js';
import { PLANT_SB_SECRET, PLANT_SERVICE_ROLE_JWT, PLANT_JWT, NOT_A_CREDENTIAL_PREFIX } from './_plants.js';
import { execFileSync } from 'node:child_process';
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

/** Runs scripts/scan_bundle_credentials.mjs directly, capturing status rather than throwing. */
function runScanner(args: string[]): { status: number; stdout: string } {
  try {
    const stdout = execFileSync('node', [join(REPO_ROOT, 'scripts/scan_bundle_credentials.mjs'), ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('service-role bundle guard', () => {
  const LINT = 'lint_no_service_role_in_bundle.sh';
  const RULE = 'service-role credential reachable from a built client bundle';

  test('the real built bundle is accepted', () => {
    const dist = join(REPO_ROOT, 'apps', 'public-dashboard', 'dist');
    expect(existsSync(dist), 'run `npm run build` before the compliance suite').toBe(true);
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, res.stdout).toBe(0);
  });

  test.each([
    ['service_role literal', 'const k = "service_role";'],
    ['SUPABASE_SERVICE env name', 'const k = process.env.SUPABASE_SERVICE_KEY;'],
    ['sb_secret_ key with material', `const k = "${PLANT_SB_SECRET}";`],
    ['a JWT whose payload claims role=service_role', `const k = "${PLANT_SERVICE_ROLE_JWT}";`],
    ['a key ASSEMBLED from the prefix', `const k = "${NOT_A_CREDENTIAL_PREFIX}" + material;`],
    ['the same assembly by template', `const k = \`${NOT_A_CREDENTIAL_PREFIX}\${material}\`;`],
    ['a literal key INSIDE A COMMENT', `// leftover: ${PLANT_SB_SECRET}\nexport const x = 1;`],
    ['a literal key in a BLOCK comment', `/* ${PLANT_SB_SECRET} */\nexport const x = 1;`],
  ])('plant — %s in a built bundle is rejected', (_name, code) => {
    withScratch((root) => {
      place(root, 'apps/x/dist/assets/index.js', code);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, 'the guard did not name the rule it enforces').toContain(RULE);
      // The shell half's own verdict, asserted separately from the scanner's
      // finding. They are two scripts and two legs; one assertion crediting
      // both is the over-crediting this repository's leg register exists to
      // make visible.
      expect(res.stdout, 'the shell half printed no verdict of its own').toContain(
        'lint_no_service_role_in_bundle.sh: FAILED — a credential is reachable from a built client bundle',
      );
    });
  });

  /**
   * THE CORPUS-SCOPE MATRIX -- test-conventions.md section 2(d).
   *
   * The guard's header declares five extensions and two locations. That is a
   * CLAIM ABOUT COVERAGE, and a claim its corpus does not support is invisible
   * from the green: the uncovered corner produces no failures because nothing
   * looked. Before this existed, only `dist/**` + `.js` was ever planted, so
   * eight of the ten declared cells were a description rather than a control.
   *
   * A credential is planted in EVERY declared cell and every one must be
   * rejected. Parsed identity over the declared matrix, not a count of files
   * the `find` happened to return.
   */
  const DECLARED_LOCATIONS = ['dist/assets', '.next/static/chunks'];
  const DECLARED_EXTENSIONS = ['js', 'mjs', 'cjs', 'html', 'json'];
  const MATRIX = DECLARED_LOCATIONS.flatMap((loc) => DECLARED_EXTENSIONS.map((ext) => [loc, ext] as const));

  test.each(MATRIX)('corpus scope — a credential in apps/x/%s/f.%s is rejected', (loc, ext) => {
    withScratch((root) => {
      // Each body is VALID for its own file type. A .json file holding
      // JavaScript would be rejected for the wrong reason, and a plant that
      // lands for the wrong reason proves nothing about the cell it claims.
      const bodies: Record<string, string> = {
        js: `const k = "${PLANT_SB_SECRET}";`,
        mjs: `export const k = "${PLANT_SB_SECRET}";`,
        cjs: `module.exports = { k: "${PLANT_SB_SECRET}" };`,
        html: `<!doctype html><script>const k = "${PLANT_SB_SECRET}";</script>`,
        json: JSON.stringify({ k: PLANT_SB_SECRET }),
      };
      place(root, `apps/x/${loc}/f.${ext}`, bodies[ext] as string);
      const res = runLint(LINT, root);
      expect(res.status, `a declared cell of the corpus does not actually scan:\n${res.stdout}`).toBe(1);
      expect(res.stdout, 'the guard did not name the rule it enforces').toContain(RULE);
    });
  });

  test.each([
    ['an ordinary VITE_ env read', 'export const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;'],
    [
      'the JSDoc warning AGAINST the thing this guards',
      '/**\n * This function should only be called on a server.\n * Never expose your `service_role` key in the browser.\n */\nexport const f = () => 1;',
    ],
    ['a bare prefix predicate, no key material', `const isNew = (k) => k.startsWith("${NOT_A_CREDENTIAL_PREFIX}");`],
    ['the anon JWT, which ships in the bundle BY DESIGN', `const k = "${PLANT_JWT}";`],
  ])('positive control — %s is accepted', (_name, code) => {
    // test-conventions.md section 2, the fourth way a leg goes wrong: a guard
    // that refuses legitimate input is disabled by the next person who hits it.
    // Every one of these four reddened this guard before 2026-09-10, and the
    // second is the exact 23-of-24 case: the guard firing on the warning
    // against the thing it guards.
    withScratch((root) => {
      place(root, 'apps/x/dist/assets/index.js', code);
      const res = runLint(LINT, root);
      expect(res.status, `legitimate bundle content was refused:\n${res.stdout}`).toBe(0);
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
      expect(res.stdout, 'the guard did not name the rule it enforces').toContain(RULE);
    });
  });

  test('a bundle that will not parse FAILS LOUDLY rather than being skipped', () => {
    // Comment stripping needs a real parse, and a parse can fail. Whichever
    // branch that lands on is what it silently becomes: re-scanning raw is
    // noisy-but-safe, skipping is FAIL-OPEN, and both are verdicts from a check
    // that did not run. So it is exit 2, distinct from both clean and dirty.
    withScratch((root) => {
      place(root, 'apps/x/dist/assets/index.js', 'const k = ((((;');
      const res = runLint(LINT, root);
      expect(res.status, `an unparseable bundle did not stop the scan:\n${res.stdout}`).toBe(2);
      // The scanner's own refusal...
      expect(res.stdout, 'the refusal did not name its cause').toContain(
        'as JavaScript -- comment stripping needs a real parse, so the bundle scan did not run',
      );
      // ...and, separately, the shell half relaying an exit status it does not
      // recognise. Whichever branch "could not run" lands on is what it
      // silently becomes, so the relay is asserted rather than assumed.
      expect(res.stdout, 'the shell half did not report the scanner’s refusal').toContain(
        'the bundle scan did not run (scanner exited 2)',
      );
    });
  });

  test('anti-vacuity — no built output FAILS rather than passing', () => {
    // The failure this guard is most likely to have in practice: the build step
    // was skipped and the scan ran over an empty directory.
    withScratch((root) => {
      place(root, 'apps/x/src/main.ts', 'export const x = 1;');
      const res = runLint(LINT, root);
      expect(res.status, 'scanning zero built files reported success').toBe(2);
      expect(res.stdout, 'the empty-corpus refusal did not name itself').toContain('no built client bundles found under');
    });
  });

  test('anti-vacuity — the scanner invoked with no files refuses', () => {
    // The shell half guarantees at least one file, so this leg is unreachable
    // THROUGH it. It is reachable by calling the scanner directly, which is what
    // happens here: a scanner that reported clean over an empty argv would make
    // the whole guard vacuous the moment the shell half's `find` stopped
    // resolving.
    const res = runScanner([]);
    expect(res.status, `the scanner accepted an empty corpus:\n${res.stdout}`).toBe(2);
    expect(res.stdout).toContain('no files given to scan');
    expect(res.stdout, 'the refusal did not say how to invoke it').toContain(
      'Usage: node scripts/scan_bundle_credentials.mjs',
    );
  });

  test('a file with more hits than it prints says how many it withheld', () => {
    // The finding list is truncated at 12 so one catastrophic file cannot bury
    // the other files' findings. A truncation that does not say it truncated
    // reads as a complete report, and the reader stops at twelve believing
    // that is all there is.
    withScratch((root) => {
      const many = Array.from({ length: 15 }, (_, i) => `const k${i} = "${PLANT_SB_SECRET}";`).join('\n');
      place(root, 'apps/x/dist/assets/index.js', many);
      const res = runLint(LINT, root);
      expect(res.status, `15 credentials were accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, 'the truncated report did not say it was truncated').toContain('more in this file');
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
      expect(res.stdout, 'the guard did not name the rule it enforces').toContain('updated_at used as a FILTER on the public search path');
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
      const res = runLint(LINT, root);
      expect(res.status, `an empty corpus did not fail loudly:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the empty-corpus refusal did not name itself').toContain('no client source found under');
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

  // TWO DIFFERENT RULES share this table -- the allowlist check and the
  // select('*') ban -- and they exit identically. Each row names which one it
  // should trip, so a plant that reds through the wrong rule is visible.
  test.each([
    ['a base table in app', "const q = db.from('ward_status').select('bed_count');", 'is not on the public allowlist'],
    ['the audit log', "const q = db.from('audit_log').select('action');", 'is not on the public allowlist'],
    ['select(*)', "const q = db.from('ward_public').select('*');", ".select('*') is banned — name the columns"],
  ])('plant — %s is rejected, naming that rule', (_name, code, message) => {
    withScratch((root) => {
      scaffold(root);
      place(root, 'apps/x/src/query.ts', code);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, `a DIFFERENT rule fired than the one this plant targets:\n${res.stdout}`).toContain(message);
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
      expect(res.stdout, 'the allowlist rule did not name itself').toContain('is not on the public allowlist');
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
      expect(res.stdout, 'the allowlist rule did not name itself').toContain('is not on the public allowlist');
    });
  });

  test('anti-vacuity — an allowlist that parses cleanly to NOTHING refuses to pass', () => {
    // Distinct from missing and from malformed: this fixture is valid JSON with
    // both keys present and both empty. A guard reading an empty allowlist would
    // reject every query -- failing closed, but for a reason unrelated to what it
    // guards, which is not a verdict.
    withScratch((root) => {
      place(root, 'packages/fixtures/public-relations.json', JSON.stringify({ mirrors: [], rpcs: [] }, null, 2));
      place(root, 'apps/x/src/query.ts', "const q = db.from('ward_public').select('id');");
      const res = runLint(LINT, root);
      expect(res.status, `an empty allowlist produced a verdict:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the vacuous-allowlist refusal did not name itself').toContain('allowlist parsed to nothing');
    });
  });

  test('anti-vacuity — no app source at all refuses to pass', () => {
    withScratch((root) => {
      place(root, 'packages/fixtures/public-relations.json',
        JSON.stringify({ mirrors: ['ward_public'], rpcs: ['my_facility_wards'] }, null, 2));
      place(root, 'README.md', 'x');
      const res = runLint(LINT, root);
      expect(res.status, `an empty source corpus reported clean:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the empty-corpus refusal did not name itself').toContain('no app source found under');
    });
  });

  test('plant — a malformed allowlist STOPS the run rather than parsing to nothing', () => {
    withScratch((root) => {
      place(root, 'packages/fixtures/public-relations.json', JSON.stringify({ mirrors: ['ward_public'] }));
      place(root, 'apps/x/src/query.ts', "const q = db.from('ward_public').select('x');");
      const res = runLint(LINT, root);
      expect(res.status, `a fixture missing its rpcs array still produced a verdict:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the malformed-fixture refusal did not name itself').toContain('could not read');
    });
  });
});
