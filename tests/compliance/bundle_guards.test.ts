import { describe, expect, test } from 'vitest';
import { runLint, withScratch, place, REPO_ROOT } from './_scratch.js';
import { deployableApps, appsWithFunctions, outputDirOf } from './_apps.js';
import { PLANT_SB_SECRET, PLANT_SERVICE_ROLE_JWT, PLANT_JWT, NOT_A_CREDENTIAL_PREFIX } from './_plants.js';
import {
  appliedViolations, appSource, builtCss, designSource, FONT_HOSTS, fontHostViolations, hasViewport,
  indexHtml, inlineStyleViolations, TOKEN, VIEWPORT_CONTENT, type BuiltCss,
} from './_design.js';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GUARDS OVER GUARDS -- the three checks that run against client code:
 *   scripts/lint_no_service_role_in_bundle.sh
 *   scripts/lint_no_updated_at_filter.sh
 *   scripts/lint_from_allowlist.sh
 *
 * CLASSIFICATION (Clause 5 of .claude/rules/code-pipeline.md). The two guards no
 * longer share one classification -- their true subjects arrived on different
 * schedules, and lumping them together is exactly the kind of claim that reads
 * as covered when only half of it is. See each guard's own header for the
 * authoritative text; summarised here so a reader of this file doesn't have to
 * cross-reference to know what's being exercised:
 *
 *   scripts/lint_no_service_role_in_bundle.sh's CLIENT corpus -- LIVE. Its
 *     stated subject, "a real authenticated client fetch", is
 *     apps/ward-console/src/main.ts's holder.authedFetch calls (the handover
 *     read, live since commits fb925b2/349e72e, and the publish screen).
 *   scripts/lint_no_updated_at_filter.sh -- still GUARD-AHEAD-OF-SUBJECT. Its
 *     subject, distance-based public search and filtering on the dashboard, is
 *     still Bundle 4 work and has not landed. It runs today over
 *     apps/public-dashboard/src/main.ts's real /beds.json fetch-and-render
 *     path (the Bundle 1 stub survives only as that fetch's failure fallback),
 *     which filters on nothing -- so the guard stays non-vacuous and clean
 *     without its true subject having arrived.
 *
 * The service-role guard's SERVER-SIDE corpus -- the built Pages Functions
 * output -- is separately LIVE, from 2026-09-18 (A1 sprint, Bundle 1): the
 * /beds.json Function exists and holds the service-role credential now.
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

  /**
   * Places a built file at `apps/<app>/<outDir>/...` AND the app's wrangler.toml naming
   * <outDir>. Since PR 3.4b-app C (R-2026-09-24-97 BY-2 d) the guard reads each app's
   * `pages_build_output_dir` rather than globbing `apps/*\/dist`, so a plant without a
   * wrangler.toml is not in any app -- and would be ignored, correctly.
   */
  const placeBundle = (root: string, rel: string, body: string): void => {
    const [, app, outDir] = /^apps\/([^/]+)\/([^/]+)\//.exec(rel) ?? [];
    if (!app || !outDir) throw new Error(`placeBundle needs apps/<app>/<outDir>/...: ${rel}`);
    place(root, `apps/${app}/wrangler.toml`, `name = "x-${app}"\npages_build_output_dir = "./${outDir}"\n`);
    place(root, rel, body);
  };

  test.each(deployableApps())('the real built bundle of %s is accepted', (app) => {
    const dist = join(REPO_ROOT, 'apps', app, outputDirOf(app));
    expect(existsSync(dist), `run \`npm run build\` before the compliance suite — apps/${app} has no built output`).toBe(true);
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, res.stdout).toBe(0);
  });

  test('the real Pages Functions output is scanned, not skipped — a renamed functions/ cannot go quietly vacuous', () => {
    // The server-side corpus is reported by count, not failed, when no app has a
    // functions/ directory (a scratch tree planting only a client bundle has
    // none). That leaves one way for the half to rot silently: functions/ renamed
    // or moved. This leg closes it for the real repository by requiring the
    // count be non-zero.
    const withFns = appsWithFunctions();
    expect(withFns.length, 'no app has a functions/ directory — this leg is vacuous').toBeGreaterThan(0);
    for (const app of withFns) {
      const built = join(REPO_ROOT, 'apps', app, '.functions-build');
      expect(existsSync(built), `run \`npm run build\` (it runs build:functions) before the compliance suite — apps/${app} has none`).toBe(true);
    }
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, res.stdout).toBe(0);
    const m = res.stdout.match(/(\d+) server-side function files scanned/);
    expect(m, `the PASS line did not report a server-side count:\n${res.stdout}`).not.toBeNull();
    expect(Number(m?.[1]), `the server-side corpus scanned nothing:\n${res.stdout}`).toBeGreaterThan(0);
  });

  test('anti-vacuity — more than one app is discovered, or the per-app plants below prove nothing', () => {
    // The plants below exist to show the scan REACHES each app. With one app they
    // would be indistinguishable from the single-app plants that already exist.
    expect(deployableApps().length, 'fewer than two apps — the per-app reach plants are vacuous').toBeGreaterThan(1);
  });

  test.each(deployableApps())(
    'plant — a credential in apps/%s is caught while every OTHER app is clean',
    (dirty) => {
      // -21 D4: the scan's reach to each app is "to be confirmed explicitly, with a
      // plant, in that change, not assumed". The lint reads each app's output
      // directory from its wrangler.toml (since PR 3.4b-app C; until then it globbed
      // apps/*/dist), and A CORPUS THAT MATCHES IS NOT PROOF IT REACHED. Every other plant in this file uses one
      // synthetic app called `x`, so "the second app is scanned too" was unasserted.
      //
      // Each app's file is named after the app, so the assertion is on IDENTITY: it
      // is not enough that the guard refused, it must have refused because of THIS
      // app's bundle.
      withScratch((root) => {
        for (const app of deployableApps()) {
          placeBundle(
            root,
            `apps/${app}/${outputDirOf(app)}/assets/${app}.js`,
            app === dirty ? `const k = "${PLANT_SB_SECRET}";` : 'export const x = 1;',
          );
        }
        const res = runLint(LINT, root);
        expect(res.status, `a credential in apps/${dirty} was not caught:\n${res.stdout}`).toBe(1);
        expect(res.stdout, `the guard refused but did not name apps/${dirty}`).toContain(`apps/${dirty}/${outputDirOf(dirty)}`);
        for (const clean of deployableApps().filter((a) => a !== dirty)) {
          expect(res.stdout, `the guard named apps/${clean}, which carries no credential`).not.toContain(
            `apps/${clean}/${outputDirOf(clean)}/assets/${clean}.js`,
          );
        }
      });
    },
  );

  test.each(appsWithFunctions())('plant — a credential in apps/%s/.functions-build is caught', (app) => {
    withScratch((root) => {
      placeBundle(root, `apps/${app}/${outputDirOf(app)}/assets/${app}.js`, 'export const x = 1;');
      place(root, `apps/${app}/functions/beds.json.ts`, 'export const onRequestGet = () => new Response("{}");');
      place(root, `apps/${app}/.functions-build/${app}.js`, `const k = "${PLANT_SB_SECRET}";`);
      const res = runLint(LINT, root);
      expect(res.status, `a committed key in apps/${app}'s Function output was not caught:\n${res.stdout}`).toBe(1);
      expect(res.stdout, `the guard refused but did not name apps/${app}'s Function output`).toContain(
        `apps/${app}/.functions-build`,
      );
    });
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
      placeBundle(root, 'apps/x/dist/assets/index.js', code);
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
   * The guard's header declares five extensions and, since PR 3.4b-app C, ONE
   * location: whatever directory each app's wrangler.toml names. That is a CLAIM
   * ABOUT COVERAGE, and a claim its corpus does not support is invisible from the
   * green: the uncovered corner produces no failures because nothing looked.
   * Before this existed, only `dist/**` + `.js` was ever planted, so eight of the
   * ten declared cells were a description rather than a control. The two locations
   * below are two output-directory NAMES, dist and build, each named by its app's
   * wrangler.toml -- the second is the one the old path glob never reached.
   *
   * A credential is planted in EVERY declared cell and every one must be
   * rejected. Parsed identity over the declared matrix, not a count of files
   * the `find` happened to return.
   */
  const DECLARED_LOCATIONS = ['dist/assets', 'build/static/chunks'];
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
      placeBundle(root, `apps/x/${loc}/f.${ext}`, bodies[ext] as string);
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
      placeBundle(root, 'apps/x/dist/assets/index.js', code);
      const res = runLint(LINT, root);
      expect(res.status, `legitimate bundle content was refused:\n${res.stdout}`).toBe(0);
    });
  });

  test('plant — a credential in an app that builds to build/, not dist/, is caught (BY-2 d)', () => {
    // THE GAP THIS CHANGE CLOSES. Until PR 3.4b-app C the corpus was the path glob
    // */dist/* (and */.next/static/*): an app whose wrangler.toml names build/ was
    // never scanned, and the guard said PASS over the apps it did find. A clean
    // dist/ app sits beside it, so a PASS here would be the old behaviour exactly.
    withScratch((root) => {
      placeBundle(root, 'apps/clean/dist/assets/index.js', 'export const x = 1;');
      placeBundle(root, 'apps/y/build/assets/main.js', `const k = "${PLANT_SB_SECRET}";`);
      const res = runLint(LINT, root);
      expect(res.status, `a credential in an app that builds to build/ was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, 'the guard did not name the rule it enforces').toContain(RULE);
      expect(res.stdout, 'the guard refused but did not name the build/ bundle').toContain('apps/y/build/assets/main.js');
    });
  });

  test('the corpus is the directory wrangler.toml NAMES: a stray dist/ beside a build/ app is not scanned', () => {
    // The other half of reading the output directory rather than assuming it. A
    // dist/ that the app does not deploy is not its bundle; scanning it would make
    // the verdict about a file nobody ships. Positive control: this is accepted.
    withScratch((root) => {
      placeBundle(root, 'apps/y/build/assets/main.js', 'export const x = 1;');
      place(root, 'apps/y/dist/assets/leftover.js', `const k = "${PLANT_SB_SECRET}";`);
      const res = runLint(LINT, root);
      expect(res.status, `a file outside the named output directory decided the verdict:\n${res.stdout}`).toBe(0);
      expect(res.stdout).toContain('1 built files scanned in 1 app(s)');
    });
  });

  test('a bundle that will not parse FAILS LOUDLY rather than being skipped', () => {
    // Comment stripping needs a real parse, and a parse can fail. Whichever
    // branch that lands on is what it silently becomes: re-scanning raw is
    // noisy-but-safe, skipping is FAIL-OPEN, and both are verdicts from a check
    // that did not run. So it is exit 2, distinct from both clean and dirty.
    withScratch((root) => {
      placeBundle(root, 'apps/x/dist/assets/index.js', 'const k = ((((;');
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

  test('anti-vacuity — no built output FAILS rather than passing, naming the unbuilt app', () => {
    // The failure this guard is most likely to have in practice: the build step
    // was skipped and the scan ran over an empty directory. Per app now: one built
    // app cannot hide an unbuilt one.
    withScratch((root) => {
      placeBundle(root, 'apps/built/dist/assets/index.js', 'export const x = 1;');
      place(root, 'apps/x/wrangler.toml', 'name = "x-x"\npages_build_output_dir = "./dist"\n');
      place(root, 'apps/x/src/main.ts', 'export const x = 1;');
      const res = runLint(LINT, root);
      expect(res.status, 'scanning an unbuilt app reported success').toBe(2);
      expect(res.stdout, 'the empty-corpus refusal did not name itself').toContain('has no built client bundle in');
      expect(res.stdout, 'the refusal did not name the unbuilt app').toContain('apps/x/dist');
    });
  });

  test('anti-vacuity — a tree with no deployable app FAILS rather than passing', () => {
    withScratch((root) => {
      place(root, 'apps/x/src/main.ts', 'export const x = 1;');
      const res = runLint(LINT, root);
      expect(res.status, 'a tree with no app reported success').toBe(2);
      expect(res.stdout).toContain('no deployable app (apps/*/wrangler.toml) under');
    });
  });

  test('plant — a wrangler.toml naming no output directory is refused, never defaulted to dist', () => {
    withScratch((root) => {
      place(root, 'apps/x/wrangler.toml', 'name = "x-x"\n');
      place(root, 'apps/x/dist/assets/index.js', `const k = "${PLANT_SB_SECRET}";`);
      const res = runLint(LINT, root);
      expect(res.status, `a wrangler.toml with no output dir was defaulted:\n${res.stdout}`).toBe(2);
      expect(res.stdout).toContain('names no pages_build_output_dir, so its built client bundle cannot be found.');
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

  /**
   * THE SERVER-SIDE CORPUS -- the built Pages Functions output (A1 sprint,
   * Bundle 1). It is scanned for a COMMITTED credential value with the scanner's
   * literal tiers only; the identifier-name tier is withheld, because a Function
   * legitimately reads its key from the platform environment by NAME. See the
   * headers of both scripts for why.
   *
   * Each scratch tree carries a CLEAN client bundle as well, so the legs below
   * also prove a clean client corpus cannot mask a dirty server-side one.
   */
  const SERVER_RULE = 'service-role credential committed as a literal in server-side code';
  const SERVER_VERDICT =
    'lint_no_service_role_in_bundle.sh: FAILED — a service-role credential is committed as a literal in server-side code';
  const placeFunction = (root: string, file: string, body: string): void => {
    placeBundle(root, 'apps/x/dist/assets/index.js', 'export const x = 1;');
    place(root, 'apps/x/functions/beds.json.ts', 'export const onRequestGet = () => new Response("{}");');
    place(root, `apps/x/.functions-build/${file}`, body);
  };
  const LEGIT_ENV_READ = 'export const k = (env) => env.SUPABASE_SERVICE_ROLE_KEY;';

  test.each([
    ['a literal sb_secret_ key with material', `export const k = "${PLANT_SB_SECRET}";`],
    ['a JWT whose payload claims role=service_role', `export const k = "${PLANT_SERVICE_ROLE_JWT}";`],
    ['a key ASSEMBLED from the prefix', `export const k = "${NOT_A_CREDENTIAL_PREFIX}" + material;`],
    ['a literal key inside a COMMENT', `// leftover: ${PLANT_SB_SECRET}\nexport const x = 1;`],
  ])('plant — %s in the built Functions output is rejected', (_name, code) => {
    withScratch((root) => {
      placeFunction(root, 'index.js', code);
      const res = runLint(LINT, root);
      expect(res.status, `a committed credential in a Function was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, 'the scanner did not name the server-side rule').toContain(SERVER_RULE);
      expect(res.stdout, 'the shell half printed no server-side verdict of its own').toContain(SERVER_VERDICT);
    });
  });

  test.each(['js', 'mjs'])('corpus scope — a credential in apps/x/.functions-build/f.%s is rejected', (ext) => {
    withScratch((root) => {
      placeFunction(root, `f.${ext}`, `export const k = "${PLANT_SB_SECRET}";`);
      const res = runLint(LINT, root);
      expect(res.status, `a declared server-side extension does not actually scan:\n${res.stdout}`).toBe(1);
      expect(res.stdout).toContain(SERVER_RULE);
    });
  });

  test('positive control — a Function reading its key from the environment BY NAME is accepted', () => {
    // The correct shape of a server-side secret. Rejecting it is the trap the
    // guard's header predicted: a scan that reds on correct server code gets
    // widened, and the widened guard is what ships.
    withScratch((root) => {
      placeFunction(root, 'index.js', LEGIT_ENV_READ);
      const res = runLint(LINT, root);
      expect(res.status, `the legitimate env read was refused server-side:\n${res.stdout}`).toBe(0);
      expect(res.stdout).toContain('1 server-side function files scanned');
    });
  });

  test('control for the leg above — the SAME env read in a client bundle is still rejected', () => {
    // The pair is the proof the server-side corpus did not loosen the client
    // one: identical text, accepted where it is correct and refused where it
    // would ship to a browser. If this ever passes, the client corpus lost its
    // identifier-name tier.
    withScratch((root) => {
      placeBundle(root, 'apps/x/dist/assets/index.js', LEGIT_ENV_READ);
      const res = runLint(LINT, root);
      expect(res.status, `the client corpus accepted a service-role env name:\n${res.stdout}`).toBe(1);
      expect(res.stdout).toContain(RULE);
    });
  });

  test('anti-vacuity — a functions/ directory with no built output FAILS rather than passing', () => {
    withScratch((root) => {
      placeBundle(root, 'apps/x/dist/assets/index.js', 'export const x = 1;');
      place(root, 'apps/x/functions/beds.json.ts', 'export const onRequestGet = () => new Response("{}");');
      const res = runLint(LINT, root);
      expect(res.status, `an unbuilt Function was reported clean:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the refusal did not name itself').toContain('has a functions/ directory but no built Functions output');
    });
  });

  test('a server-side scan that could not run FAILS LOUDLY rather than reporting clean', () => {
    // The shell half's relay for a scanner exit it does not recognise, on the
    // server-side corpus. An unreadable file is what makes the server-side scan
    // exit 2: it never parses, so a parse failure cannot. Whichever branch "could
    // not run" lands on is what it silently becomes, so the relay is asserted.
    withScratch((root) => {
      placeFunction(root, 'index.js', 'export const x = 1;');
      const built = join(root, 'apps/x/.functions-build/index.js');
      chmodSync(built, 0o000);
      try {
        const res = runLint(LINT, root);
        expect(res.status, `an unreadable Function bundle did not stop the scan:\n${res.stdout}`).toBe(2);
        expect(res.stdout, 'the shell half did not relay the server-side refusal').toContain(
          'the server-side scan did not run (scanner exited 2)',
        );
      } finally {
        chmodSync(built, 0o644);
      }
    });
  });

  test('anti-vacuity — the scanner invoked in server-side mode with no files refuses', () => {
    const res = runScanner(['--server-side']);
    expect(res.status, `server-side mode accepted an empty corpus:\n${res.stdout}`).toBe(2);
    expect(res.stdout).toContain('no files given to scan');
  });

  test('a file with more hits than it prints says how many it withheld', () => {
    // The finding list is truncated at 12 so one catastrophic file cannot bury
    // the other files' findings. A truncation that does not say it truncated
    // reads as a complete report, and the reader stops at twelve believing
    // that is all there is.
    withScratch((root) => {
      const many = Array.from({ length: 15 }, (_, i) => `const k${i} = "${PLANT_SB_SECRET}";`).join('\n');
      placeBundle(root, 'apps/x/dist/assets/index.js', many);
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
      expect(res.stdout, 'the summary line that names the verdict was not printed').toContain('lint_no_updated_at_filter.sh: FAILED (');
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
    // Only the two keys the LINT reads. realtimePublicationMembers is deliberately
    // absent: this guard is over the lint, and the lint must never read it.
    place(root, 'packages/fixtures/public-relations.json', JSON.stringify({
      clientAddressableRelations: ['facility_public', 'ward_public', 'lga_rollup'],
      rpcs: ['my_facility_wards', 'ward_status_history'],
    }));
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
      expect(res.stdout, 'the summary line that names the verdict was not printed').toContain('lint_from_allowlist.sh: FAILED (');
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

  // MIGRATION 018 MAKES ONE HALF OF THE ALLOWLIST EMPTY, and the pair below is
  // what keeps that from being mistaken for a broken fixture in either
  // direction. Until 018 `clientAddressableRelations` always named three
  // relations, so "the relation half is empty" was not a state this guard had
  // ever been shown in.
  //
  // WHAT IS ALREADY COVERED AND IS NOT REPEATED HERE: an allowlist whose two
  // halves are BOTH empty is asserted further down — "an allowlist that parses
  // cleanly to NOTHING refuses to pass". That leg is the union being empty. The
  // pair below is about the union being NON-empty while one half is empty, which
  // is a different branch and the one 018 actually produces.
  test('positive control — the post-018 shape, an empty relation half with RPCs, is accepted', () => {
    withScratch((root) => {
      // THE MOST ORDINARY VALID INPUT after 018, which test-conventions requires
      // every input-parsing guard to carry. Without it, a lint that refused ANY
      // empty array would satisfy the both-empty leg below AND reject the real
      // fixture — and a guard that refuses legitimate input is the one the next
      // person disables.
      place(root, 'packages/fixtures/public-relations.json', JSON.stringify({
        clientAddressableRelations: [],
        rpcs: ['my_facility_wards', 'ward_status_history', 'publish_ward_status'],
      }));
      place(root, 'apps/x/src/query.ts', "const q = await fetchJson('/beds.json');");
      const res = runLint(LINT, root);
      expect(res.status, `the real post-018 allowlist shape was refused:\n${res.stdout}`).toBe(0);
    });
  });

  test('plant — with the relation half empty, a mirror in client code is rejected', () => {
    withScratch((root) => {
      // The post-018 agreement, asserted rather than assumed: what the database
      // refuses, the lint refuses. This exact query is ACCEPTED by the
      // positive-control leg above that scaffolds the three mirrors, so this is
      // the leg whose verdict the migration flips — and the only one that shows
      // emptying the relation half did anything at all.
      place(root, 'packages/fixtures/public-relations.json', JSON.stringify({
        clientAddressableRelations: [],
        rpcs: ['my_facility_wards', 'ward_status_history', 'publish_ward_status'],
      }));
      place(root, 'apps/x/src/query.ts', "const q = db.from('ward_public').select('facility_id,category,bed_count');");
      const res = runLint(LINT, root);
      expect(res.status, `a revoked mirror was still accepted in client code:\n${res.stdout}`).toBe(1);
      expect(res.stdout, 'a DIFFERENT rule fired than the one this plant targets').toContain('is not on the public allowlist');
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
        clientAddressableRelations: ['facility_public', 'ward_public', 'lga_rollup', 'bed_ledger_public'],
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
        clientAddressableRelations: ['facility_public', 'ward_public', 'lga_rollup'],
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
      place(root, 'packages/fixtures/public-relations.json', JSON.stringify({ clientAddressableRelations: [], rpcs: [] }, null, 2));
      place(root, 'apps/x/src/query.ts', "const q = db.from('ward_public').select('id');");
      const res = runLint(LINT, root);
      expect(res.status, `an empty allowlist produced a verdict:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the vacuous-allowlist refusal did not name itself').toContain('allowlist parsed to nothing');
    });
  });

  test('anti-vacuity — no app source at all refuses to pass', () => {
    withScratch((root) => {
      place(root, 'packages/fixtures/public-relations.json',
        JSON.stringify({ clientAddressableRelations: ['ward_public'], rpcs: ['my_facility_wards'] }, null, 2));
      place(root, 'README.md', 'x');
      const res = runLint(LINT, root);
      expect(res.status, `an empty source corpus reported clean:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the empty-corpus refusal did not name itself').toContain('no app source found under');
    });
  });

  test('plant — a malformed allowlist STOPS the run rather than parsing to nothing', () => {
    withScratch((root) => {
      place(root, 'packages/fixtures/public-relations.json', JSON.stringify({ clientAddressableRelations: ['ward_public'] }));
      place(root, 'apps/x/src/query.ts', "const q = db.from('ward_public').select('x');");
      const res = runLint(LINT, root);
      expect(res.status, `a fixture missing its rpcs array still produced a verdict:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the malformed-fixture refusal did not name itself').toContain('could not read');
    });
  });
});

/**
 * NO THIRD-PARTY FONT HOST IN ANY BUILT APP -- scripts/lint_no_third_party_fonts.sh
 * (R-2026-09-24-88 BP-10; PR 3.4b-app B).
 *
 * The declared corpus is every deployable app's built output, in js, mjs, cjs, html
 * AND css: a font host sits in CSS as often as in markup. The matrix below plants one
 * host per declared type in each app, and a dirty app must be caught while every
 * other app stays clean (test-conventions section 2(d): assert the declared scope by
 * identity, one plant per type x location). The plant hosts are built at run time.
 */
describe('lint_no_third_party_fonts.sh', () => {
  const LINT = 'lint_no_third_party_fonts.sh';
  const TYPES = ['js', 'mjs', 'cjs', 'html', 'css'] as const;
  const HOSTS = [['fonts', 'googleapis', 'com'].join('.'), ['fonts', 'gstatic', 'com'].join('.')];

  /** A scratch tree with every real app built clean, one file per declared type. */
  function cleanTree(root: string): void {
    for (const app of deployableApps()) {
      place(root, `apps/${app}/wrangler.toml`, `name = "x-${app}"\npages_build_output_dir = "./${outputDirOf(app)}"\n`);
      for (const t of TYPES) place(root, `apps/${app}/${outputDirOf(app)}/assets/clean.${t}`, t === 'css' ? 'body { font-family: system-ui; }' : 'export const x = 1;');
    }
  }

  test('real built apps are accepted', () => {
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, res.stdout).toBe(0);
    expect(res.stdout).toContain('lint_no_third_party_fonts.sh: PASS');
  });

  test('the clean scratch tree is accepted -- the plants below start from green', () => {
    withScratch((root) => {
      cleanTree(root);
      const res = runLint(LINT, root);
      expect(res.status, res.stdout).toBe(0);
    });
  });

  test.each(deployableApps().flatMap((app) => TYPES.flatMap((t) => HOSTS.map((h) => [app, t, h] as const))))(
    'plant — %s: a .%s file loading %s is rejected, and only that app is named',
    (dirty, type, host) => {
      withScratch((root) => {
        cleanTree(root);
        const file = `apps/${dirty}/${outputDirOf(dirty)}/assets/font.${type}`;
        place(root, file, type === 'css' ? `@import url("https://${host}/css2?family=X");` : `const u = "https://${host}/x";`);
        const res = runLint(LINT, root);
        expect(res.status, res.stdout).toBe(1);
        expect(res.stdout).toContain(file);
        expect(res.stdout).toContain('lint_no_third_party_fonts.sh: FAILED (1 file(s)) -- a third-party font host is in a built app');
        for (const clean of deployableApps().filter((a) => a !== dirty)) expect(res.stdout).not.toContain(`apps/${clean}/`);
      });
    },
  );

  test('anti-vacuity — an unbuilt app FAILS rather than passing, and is named', () => {
    withScratch((root) => {
      cleanTree(root);
      place(root, 'apps/unbuilt/wrangler.toml', 'name = "x-unbuilt"\npages_build_output_dir = "./dist"\n');
      const res = runLint(LINT, root);
      expect(res.status, res.stdout).toBe(2);
      expect(res.stdout).toContain('has no built output in');
      expect(res.stdout).toContain(". Run 'npm run build' first: a font guard over an unbuilt app is not a pass.");
      expect(res.stdout).toContain('apps/unbuilt');
    });
  });

  test('anti-vacuity — a tree with no deployable app FAILS rather than passing', () => {
    withScratch((root) => {
      const res = runLint(LINT, root);
      expect(res.status, res.stdout).toBe(2);
      expect(res.stdout).toContain('no deployable app (apps/*/wrangler.toml) under');
    });
  });

  test('could not run — an unreadable built file is an ERROR, never reported clean', () => {
    withScratch((root) => {
      cleanTree(root);
      const app = deployableApps()[0] as string;
      const target = join(root, 'apps', app, outputDirOf(app), 'assets', 'clean.js');
      chmodSync(target, 0o000);
      try {
        // CONFIRM THE PLANT LANDED: as root the mode is ignored and this leg would test nothing.
        expect(() => execFileSync('cat', [target], { stdio: 'ignore' }), 'the planted file is still readable -- running as root?').toThrow();
        const res = runLint(LINT, root);
        expect(res.status, res.stdout).toBe(2);
        expect(res.stdout).toContain('over the built apps -- the check did not run');
        expect(res.stdout).not.toContain('lint_no_third_party_fonts.sh: PASS');
      } finally {
        chmodSync(target, 0o644);
      }
    });
  });

  test('plant — a wrangler.toml naming no output directory is refused, never defaulted', () => {
    withScratch((root) => {
      cleanTree(root);
      place(root, 'apps/nodir/wrangler.toml', 'name = "x-nodir"\n');
      const res = runLint(LINT, root);
      expect(res.status, res.stdout).toBe(2);
      expect(res.stdout).toContain('names no pages_build_output_dir, so its built output cannot be found');
    });
  });
});

/**
 * THE DESIGN IS APPLIED (the design-pass kickoff, D1; the helpers and their reasons are
 * in tests/compliance/_design.ts).
 *
 * Each app's state is CLASSIFIED below, and the classification is compared with the
 * derived app set by identity, so a new app cannot slip past unclassified. A guard is
 * either REAL for an app, or PENDING until the PR that applies the design to it:
 *
 *   PENDING (R-2026-09-26-125 DA-1). Not test.todo, which the attestation counts as
 *   skipped, and not test.fails, which passes whenever the body throws for ANY reason
 *   (a wrong path, a missing dist) while claiming the app still fails the guard. A
 *   PENDING leg is a plain test asserting the app's CURRENT, specific state -- "has no
 *   viewport meta" -- so it passes for the one reason it names, goes red the moment
 *   D2 or D3 fixes the app, and its message says to replace it with the real guard in
 *   that PR. A missing file or build output makes it ERROR, never pass (DA-2).
 *
 * The no-inline-style and no-Google-font-host guards are REAL for all three apps
 * already: all three pass today.
 */
type DesignState = 'real' | 'pending D2' | 'pending D3';
const DESIGN_STATE: Record<string, { viewport: DesignState; applied: DesignState }> = {
  'public-dashboard': { viewport: 'real', applied: 'real' },
  'ward-console': { viewport: 'pending D2', applied: 'pending D2' },
  admin: { viewport: 'real', applied: 'pending D3' },
};
const FLIP = (pr: string): string =>
  `this app now meets the guard — replace this leg with the real guard in this PR (${pr}; R-2026-09-26-125 DA)`;

/** A pending viewport leg's verdict: null while the app still lacks it, the flip message once it has it. */
export function pendingViewport(html: string, pr: string): string | null {
  return hasViewport(html) ? FLIP(pr) : null;
}

/** A pending applied leg's verdict: null while the built CSS carries neither the token nor a font-face. */
export function pendingApplied(css: BuiltCss, pr: string): string | null {
  const anyToken = css.files.some((f) => f.text.includes(TOKEN));
  const anyFace = css.files.some((f) => /@font-face/.test(f.text));
  return anyToken || anyFace ? FLIP(pr) : null;
}

describe('the design is applied, and stays applied', () => {
  const apps = deployableApps();

  test('anti-vacuity — the guard sees apps, and every app is classified by identity', () => {
    expect(apps.length, 'no deployable app found: a design guard over no app is not a pass').toBeGreaterThan(0);
    expect(deployableApps(join(REPO_ROOT, 'tests')), 'the app discovery found apps where there are none').toEqual([]);
    expect(Object.keys(DESIGN_STATE).sort(), 'an app is not classified as real or pending for the design guards').toEqual(apps);
  });

  for (const app of Object.keys(DESIGN_STATE).sort()) {
    const state = DESIGN_STATE[app] as { viewport: DesignState; applied: DesignState };
    if (state.viewport === 'real') {
      test(`real apps/${app}/index.html has the viewport meta`, () => {
        expect(hasViewport(indexHtml(app, REPO_ROOT)), `apps/${app}/index.html has no <meta name="viewport" content="${VIEWPORT_CONTENT}">`).toBe(true);
      });
    } else {
      const pr = state.viewport.replace('pending ', '');
      test(`PENDING ${pr}: apps/${app}/index.html has no viewport meta`, () => {
        const verdict = pendingViewport(indexHtml(app, REPO_ROOT), pr);
        expect(verdict, verdict ?? '').toBeNull();
      });
    }
    if (state.applied === 'real') {
      test(`real apps/${app} build carries the design tokens and self-hosted woff2 fonts`, () => {
        const out = appliedViolations(builtCss(app, REPO_ROOT));
        expect(out, out.join('\n')).toEqual([]);
      });
    } else {
      const pr = state.applied.replace('pending ', '');
      test(`PENDING ${pr}: apps/${app}'s built CSS carries neither ${TOKEN} nor an @font-face`, () => {
        const verdict = pendingApplied(builtCss(app, REPO_ROOT), pr);
        expect(verdict, verdict ?? '').toBeNull();
      });
    }
  }

  test('real — no app source carries an inline style (style=, .style, setAttribute(\'style\'))', () => {
    const files = apps.flatMap((a) => appSource(a, REPO_ROOT));
    for (const a of apps) expect(files, `apps/${a}/index.html is not in the corpus`).toContain(join(REPO_ROOT, 'apps', a, 'index.html'));
    expect(files.filter((f) => f.endsWith('.ts')).length, 'no .ts source found: the corpus is empty').toBeGreaterThan(0);
    const out = files.flatMap((f) => inlineStyleViolations(f.replace(`${REPO_ROOT}/`, ''), readFileSync(f, 'utf8')));
    expect(out, out.join('\n')).toEqual([]);
  });

  test('real — no Google font host in any app\'s source or in packages/design', () => {
    const design = designSource(REPO_ROOT);
    for (const f of ['tokens.css', 'fonts.css', 'openbed-mark.svg', 'package.json']) {
      expect(design, `packages/design/${f} is not in the corpus`).toContain(join(REPO_ROOT, 'packages', 'design', f));
    }
    const files = [...apps.flatMap((a) => appSource(a, REPO_ROOT)), ...design];
    const out = files.flatMap((f) => fontHostViolations(f.replace(`${REPO_ROOT}/`, ''), readFileSync(f, 'utf8')));
    expect(out, out.join('\n')).toEqual([]);
  });

  test.each([
    ['no viewport at all', '<head><title>x</title></head>'],
    ['a viewport only inside a comment', '<!-- <meta name="viewport" content="width=device-width, initial-scale=1"> -->'],
    ['a viewport with another content', '<meta name="viewport" content="width=1024">'],
  ])('plant — viewport: %s is rejected', (_name, html) => {
    expect(hasViewport(html)).toBe(false);
  });

  test("the most ordinary viewport is accepted, in either quote style and admin's spacing", () => {
    expect(hasViewport('<meta name="viewport" content="width=device-width, initial-scale=1" />')).toBe(true);
    expect(hasViewport("<meta content='width=device-width,initial-scale=1' name='viewport'>")).toBe(true);
  });

  test.each([
    ['no CSS at all', [], 'the build holds no CSS file at all'],
    ['CSS without the token', [{ name: 'a.css', text: '@font-face{font-family:x;src:url(/assets/f.woff2) format("woff2")}' }], `no built CSS file carries the design token ${TOKEN}`],
    ['the token without a font-face', [{ name: 'a.css', text: `:root{${TOKEN}:#1b3a5c}` }], 'no built CSS file holds an @font-face'],
    ['a font-face from another origin', [{ name: 'a.css', text: `:root{${TOKEN}:#1b3a5c}@font-face{src:url(https://fonts.example.com/f.woff2)}` }], 'an @font-face src is not same-origin: https://fonts.example.com/f.woff2'],
    ['a protocol-relative font-face', [{ name: 'a.css', text: `:root{${TOKEN}:#1b3a5c}@font-face{src:url(//cdn.example.com/f.woff2)}` }], 'an @font-face src is not same-origin: //cdn.example.com/f.woff2'],
    ['a data: font-face', [{ name: 'a.css', text: `:root{${TOKEN}:#1b3a5c}@font-face{src:url(data:font/woff2;base64,AAAA)}` }], 'an @font-face src is not same-origin: data:font/woff2;base64,AAAA'],
    ['a woff, not a woff2', [{ name: 'a.css', text: `:root{${TOKEN}:#1b3a5c}@font-face{src:url(/assets/f.woff)}` }], 'an @font-face src is not a woff2: /assets/f.woff'],
    ['a font-face naming a file the build lacks', [{ name: 'a.css', text: `:root{${TOKEN}:#1b3a5c}@font-face{src:url('/assets/missing.woff2') format('woff2')}` }], 'an @font-face src names a file the build does not hold'],
  ])('plant — applied: %s is rejected', (_name, files, message) => {
    withScratch((root) => {
      place(root, 'dist/assets/f.woff2', 'x');
      const css: BuiltCss = { dist: join(root, 'dist'), files: (files as { name: string; text: string }[]).map((f) => ({ path: join(root, 'dist', 'assets', f.name), text: f.text })) };
      expect(appliedViolations(css).join('\n')).toContain(message);
    });
  });

  test('the most ordinary applied build is accepted', () => {
    withScratch((root) => {
      place(root, 'dist/assets/f.woff2', 'x');
      const css: BuiltCss = { dist: join(root, 'dist'), files: [{ path: join(root, 'dist', 'assets', 'i.css'), text: `:root{${TOKEN}:#1b3a5c}@font-face{font-family:'Public Sans';src:url('/assets/f.woff2') format('woff2')}` }] };
      expect(appliedViolations(css)).toEqual([]);
    });
  });

  test.each([
    ['index.html', '<div style="color:red">x</div>', 'a style= attribute'],
    ['main.ts', "el.style.color = 'red';", 'a .style access'],
    ['main.ts', "el['style'].color = 'red';", "a ['style'] access"],
    ['main.ts', "el.setAttribute('style', 'color:red');", "setAttribute('style', ...)"],
    ['main.ts', "root.innerHTML = '<p style=\"color:red\">x</p>';", 'markup with a style= attribute'],
    ['main.ts', 'root.innerHTML = `<p style="color:${c}">x</p>`;', 'markup with a style= attribute'],
  ])('plant — inline style in %s: %s is rejected', (file, text, message) => {
    expect(inlineStyleViolations(file, text).join('\n')).toContain(message);
  });

  test('an ordinary module is accepted: a stylesheet import, a class name, and the word style in a comment', () => {
    expect(inlineStyleViolations('main.ts', "import './style.css';\n// style= is set nowhere\nel.className = 'call';")).toEqual([]);
  });

  test.each(FONT_HOSTS)('plant — the font host %s in source is rejected', (host) => {
    expect(fontHostViolations('fonts.css', `@import url("https://${host}/css2?family=X");`).join('\n')).toContain(`names ${host}`);
  });

  test('DA-2 — each PENDING leg fails with its flip message once its app meets the guard', () => {
    expect(pendingViewport('<meta name="viewport" content="width=device-width, initial-scale=1">', 'D2')).toBe(FLIP('D2'));
    expect(pendingViewport('<head></head>', 'D2')).toBeNull();
    withScratch((root) => {
      const dist = join(root, 'dist');
      const withToken: BuiltCss = { dist, files: [{ path: join(dist, 'a.css'), text: `:root{${TOKEN}:#1b3a5c}` }] };
      const withFace: BuiltCss = { dist, files: [{ path: join(dist, 'a.css'), text: "@font-face{src:url('/f.woff2')}" }] };
      const bare: BuiltCss = { dist, files: [{ path: join(dist, 'a.css'), text: 'button{min-height:44px}' }] };
      expect(pendingApplied(withToken, 'D3')).toBe(FLIP('D3'));
      expect(pendingApplied(withFace, 'D3')).toBe(FLIP('D3'));
      expect(pendingApplied(bare, 'D3')).toBeNull();
      expect(pendingApplied({ dist, files: [] }, 'D2')).toBeNull();
    });
  });

  test('DA-2 — a missing index.html or build output makes a leg ERROR, never pass', () => {
    withScratch((root) => {
      place(root, 'apps/zz-app/wrangler.toml', 'name = "zz"\npages_build_output_dir = "./dist"\n');
      expect(() => indexHtml('zz-app', root)).toThrow('index.html is missing');
      expect(() => builtCss('zz-app', root)).toThrow('has no built output');
    });
  });
});
