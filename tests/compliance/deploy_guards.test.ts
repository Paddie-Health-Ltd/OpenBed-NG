import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withScratch, place, REPO_ROOT } from './_scratch.js';
import { deployableApps, pagesProjectOf } from './_apps.js';
import { TRACE_ONLY_CURL } from './_edge_stub.js';

/**
 * GUARDS OVER THE DEPLOY PATH — scripts/deploy_pages.sh and scripts/run_e2e.sh
 * (R-2026-09-20-30 A4 and C2).
 *
 * WHY BOTH ARE HERE. They are the same defect in two places: a step that appears to
 * do its job while doing nothing. The deploy wrapper exists because a direct-upload
 * deployment can carry any tree; the runner fix exists because that runner ran two
 * NAMED files while everyone believed it ran the directory.
 *
 * HOW. Each leg builds a scratch git repository and puts a stubbed `npx` (and `npm`
 * where needed) first on PATH, so nothing is built, uploaded, or run for real. A stubbed
 * `curl` answers the edge guard's trace request and nothing else (tests/compliance/_edge_stub.ts,
 * R-2026-09-30-217 GP); without it every leg would ask Cloudflare. The
 * stub RECORDS that it was invoked, which is what makes the accept legs non-vacuous:
 * a script that refused everything, or that silently did nothing, would pass a bare
 * "exit 0" assertion.
 *
 * THE EDGE (R-2026-09-30-217 GP). The block after the main one holds only the wrapper's WIRING of
 * scripts/edge_guard.sh: where in its order the wrapper asks, and that a refusal builds and uploads
 * nothing. The table of traces is tests/compliance/edge_guard.test.ts.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that the wrapper is a CONTROL. It is local and defeatable: `npx wrangler pages
 *     deploy` by hand bypasses it, and so does editing it. It removes the accident,
 *     not the deliberate act. Its own header says so.
 *   - that what Cloudflare serves matches what was uploaded. Nothing in this
 *     repository can read a Cloudflare project. /version.json plus the deployment
 *     report cover that, and only after a deploy has happened.
 *   - that the real `wrangler` behaves as the stub does. The stub proves the wrapper
 *     reached the upload step, never that the upload works.
 *   - that the Pages project named in a wrangler.toml exists in the Cloudflare
 *     account. An unknown app is refused here by the absence of a wrangler.toml,
 *     which is a different claim from the project existing at the other end.
 *
 * THE APP ARGUMENT (R-2026-09-22-57 B). The wrapper takes APP, and the accept leg is
 * a `test.each` over the DERIVED app list, so an app added in a later bundle gets its
 * own accept leg by existing. The scratch tree's wrangler.toml is written from the
 * real one's project name, so a leg cannot pass against an app this repository does
 * not actually deploy.
 */

const DEPLOY_SCRIPT = 'scripts/deploy_pages.sh';
const RUN_E2E_SCRIPT = 'scripts/run_e2e.sh';

interface Run { status: number; out: string; ran: string[]; /** `<cmd> WRANGLER_SEND_METRICS=<value>` per stub call, in a separate file so `ran` is unchanged. */ metrics: string[] }

function exec(cmd: string, args: string[], env: Record<string, string>, cwd?: string): { status: number; out: string } {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env }, cwd });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * A scratch repo with an `origin` it can fetch, so the wrapper's ancestor check is
 * real.
 *
 * THE APP FILES ARE PART OF THE SEED COMMIT, not written afterwards. An untracked
 * wrangler.toml would make the tree DIRTY, and the wrapper refuses a dirty tree
 * BEFORE it reaches the ancestor and origin checks — so every plant below those two
 * would have passed for the wrong reason, reporting a refusal it never tested.
 */
function repoWithOrigin(root: string, apps: readonly string[] = deployableApps()): void {
  const upstream = join(root, 'upstream.git');
  const work = join(root, 'work');
  mkdirSync(work, { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', upstream], { stdio: 'ignore' });
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'config', 'user.email', 'plant@example.invalid');
  git(work, 'config', 'user.name', 'Plant');
  writeFileSync(join(work, 'seed.txt'), 'seed\n', 'utf8');
  for (const app of apps) placeApp(root, app, pagesProjectOf(app));
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'seed');
  git(work, 'remote', 'add', 'origin', upstream);
  git(work, 'push', '-q', 'origin', 'main');
}

/**
 * Writes the stub `npm`/`npx` onto a PATH directory and returns it.
 *
 * THE `npm` STUB IS THE BUILD, and that is deliberate: the wrapper's stamp readback
 * has nothing to read unless the build step writes a stamp, so a stub that only
 * logged would make the readback's refusal fire on every accept leg. It writes
 * $STUB_STAMP_BODY to $STUB_STAMP, which each plant overrides.
 *
 * IT WRITES AFTER `git status --porcelain` HAS ALREADY RUN, so the stamp it creates
 * never makes the scratch tree dirty and never disturbs the refusal legs above.
 */
function stubBin(root: string): string {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'npm'),
    `#!/usr/bin/env bash
echo "npm $*" >> "$STUB_LOG"
echo "npm WRANGLER_SEND_METRICS=\${WRANGLER_SEND_METRICS:-unset}" >> "$STUB_LOG.env"
if [ -n "\${STUB_STAMP:-}" ]; then
  mkdir -p "$(dirname "\$STUB_STAMP")"
  printf '%s' "\$STUB_STAMP_BODY" > "\$STUB_STAMP"
fi
exit 0
`,
    'utf8',
  );
  writeFileSync(join(bin, 'npx'), `#!/usr/bin/env bash\necho "npx $*" >> "$STUB_LOG"\necho "npx WRANGLER_SEND_METRICS=\${WRANGLER_SEND_METRICS:-unset}" >> "$STUB_LOG.env"\nexit 0\n`, 'utf8');
  chmodSync(join(bin, 'npm'), 0o755);
  chmodSync(join(bin, 'npx'), 0o755);
  // THE EDGE GUARD'S TRACE (R-2026-09-30-217 GP). Without this stand-in every leg below would ask Cloudflare for
  // the real trace, and a run from Lagos would be refused by the very guard these legs are not about. The one
  // stand-in is shared with tests/compliance/edge_guard.test.ts and answers a trace request and nothing else.
  writeFileSync(join(bin, 'curl'), TRACE_ONLY_CURL, 'utf8');
  chmodSync(join(bin, 'curl'), 0o755);
  stubWorkerd(root);
  return bin;
}

/**
 * THE `workerd` STAND-IN (R-2026-10-03-FH FH-3 b). The wrapper checks its own toolchain
 * with `node -e "require('workerd')"` from the work tree, and node finds this package by
 * walking up from there. It sits in the scratch ROOT's node_modules -- the PARENT of
 * `work/`, outside the git tree -- so it never dirties the tree and the real
 * node_modules is never touched. With STUB_WORKERD_MISSING set it throws workerd's own
 * "could not be found" message, which is what an `npm ci` that skipped the optional
 * platform binary produces. Without a stand-in every scratch tree has no node_modules
 * and the check would refuse every accept leg.
 */
function stubWorkerd(root: string): void {
  const dir = join(root, 'node_modules', 'workerd');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'index.js'),
    `if (process.env.STUB_WORKERD_MISSING) throw new Error('The package "@cloudflare/workerd-darwin-arm64" could not be found, and is needed by workerd.');\n`,
    'utf8',
  );
}

/**
 * The stamp a correct build would write for the scratch repo's current HEAD.
 *
 * It tolerates there being no repository: the not-a-git-work-tree leg has no HEAD to
 * name, and the wrapper refuses long before the readback, so what this returns there
 * is never read. Throwing instead would make that leg fail in the harness rather
 * than in the guard, which reports the wrong thing.
 */
function goodStamp(root: string): string {
  let head = 'no-head';
  try {
    head = git(join(root, 'work'), 'rev-parse', 'HEAD').trim();
  } catch {
    /* no repository here; see above */
  }
  return JSON.stringify({ commit: head, dirty: false, built_at: new Date().toISOString() });
}

/**
 * The SCRATCH tree's build output directory: what placeApp writes into each scratch
 * wrangler.toml, and where the stub build writes its stamp. It is a fact about the
 * scratch tree, not about any real app -- so it is one named constant here, never
 * tests/compliance/_apps.ts's outputDirOf(), which reads the real repository and has
 * no entry for the plants' made-up apps (PR 3.4b-app B, BP-9).
 */
const SCRATCH_OUT_DIR = 'dist';

/** Gives the scratch work tree the wrangler.toml the wrapper reads its registry from. */
function placeApp(root: string, app: string, project: string, outDir: string | null = SCRATCH_OUT_DIR): void {
  const lines = [`name = "${project}"`];
  if (outDir !== null) lines.push(`pages_build_output_dir = "./${outDir}"`);
  place(root, `work/apps/${app}/wrangler.toml`, `${lines.join('\n')}\n`);
}

interface DeployOpts {
  readonly app?: string;
  readonly env?: Record<string, string>;
  /** Overrides the stamp the stubbed build writes; null writes no stamp at all. */
  readonly stamp?: string | null;
}

/** Runs the real wrapper against the scratch work tree with `npm`/`npx` stubbed. */
function deploy(root: string, opts: DeployOpts = {}): Run {
  // ONE REPRESENTATIVE APP, deliberately (BP-9, a literal kept with its reason): the
  // argument-parsing plants need one real app to parse, and the accept legs below are
  // derived per app with deployableApps().
  const app = opts.app ?? 'public-dashboard';
  const work = join(root, 'work');
  const bin = stubBin(root);
  const log = join(root, 'ran.log');
  const stampEnv: Record<string, string> =
    opts.stamp === null
      ? {}
      : { STUB_STAMP: join(work, 'apps', app, SCRATCH_OUT_DIR, 'version.json'), STUB_STAMP_BODY: opts.stamp ?? goodStamp(root) };
  const r = exec('bash', [join(REPO_ROOT, DEPLOY_SCRIPT), app, work], {
    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
    STUB_LOG: log,
    ...stampEnv,
    ...(opts.env ?? {}),
  });
  const lines = (f: string): string[] => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []);
  return { ...r, ran: lines(log), metrics: lines(`${log}.env`) };
}

describe('deploy_pages.sh — the accident case, refused', () => {
  test('anti-vacuity — there is at least one deployable app to accept', () => {
    expect(deployableApps().length, 'no deployable apps discovered — the accept legs below are vacuous').toBeGreaterThan(0);
  });

  test.each(deployableApps())('accept — %s: a clean tree whose HEAD is on origin/main reaches the upload', (app) => {
    withScratch((root) => {
      repoWithOrigin(root);
      const res = deploy(root, { app });
      expect(res.status, `a clean, merged tree was refused for ${app}:\n${res.out}`).toBe(0);
      // NON-VACUITY: the accept leg means nothing unless the upload was reached.
      expect(res.ran.join('\n'), `the wrapper exited 0 without reaching wrangler:\n${res.out}`).toMatch(/npx wrangler pages deploy --branch main/);
      expect(res.ran.join('\n'), 'the build never ran, so no stamp would exist').toMatch(/npm run build/);
      expect(res.out, 'the wrapper did not print what the deployment report needs').toMatch(/from which commit/);
      // IDENTITY, NOT PRESENCE: the report must name the project this app deploys
      // to, or a report could be quoted against the wrong site.
      expect(res.out, `the report does not name ${app}'s Pages project`).toContain(pagesProjectOf(app));
      // THE READBACK MUST HAVE RUN. Without this, a readback that silently stopped
      // executing would leave every plant below green and this leg green too.
      expect(res.out, 'the stamp readback did not run').toContain('the stamp reads back as');
    });
  });

  test('plant — a workerd platform binary that npm skipped is refused before any build, and the missing package is named', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const work = join(root, 'work');
      // PRECONDITION, independent of the wrapper: the stand-in itself throws with the plant's env.
      // If this fails the plant did not land; if only the assertions below fail, the wrapper is at fault.
      stubWorkerd(root);
      const direct = exec('node', ['-e', "require('workerd')"], { STUB_WORKERD_MISSING: '1' }, work);
      expect(direct.status, `the stand-in did not throw, so the plant cannot land:\n${direct.out}`).not.toBe(0);
      expect(direct.out).toContain('could not be found, and is needed by workerd');
      const res = deploy(root, { env: { STUB_WORKERD_MISSING: '1' } });
      expect(res.status, `a missing workerd package was not refused with 2:\n${res.out}`).toBe(2);
      expect(res.out, 'the missing package was not named').toContain('could not be found, and is needed by workerd');
      expect(res.out).toContain('the native platform package that workerd needs is not installed here, so wrangler cannot run and nothing was built or uploaded');
      expect(res.out, 'the refusal did not say how to fix it').toContain('npm ci --include=optional');
      // BEFORE ANY BUILD, STAMP OR UPLOAD: the stub log holds no npm and no npx line, and the
      // stub build never wrote a stamp. A check placed after the build would fail the first.
      expect(res.ran, `the wrapper built or uploaded after the toolchain check failed:\n${res.ran.join('\n')}`).toEqual([]);
      expect(existsSync(join(work, 'apps', 'public-dashboard', SCRATCH_OUT_DIR, 'version.json')), 'a stamp exists, so the build ran').toBe(false);
      expect(res.out, 'the wrapper announced a build before its toolchain check').not.toContain('building public-dashboard');
    });
  });

  // R-2026-10-03-FI FI-3. Wrangler sends usage telemetry unless refused (the same in 4.134.0 and 4.147.0, which
  // prints its notice once per version, so the bump showed it). The wrapper refuses it for every step it runs, for
  // data minimisation. THE CALLER'S ENVIRONMENT SAYS true, so a runner that already has it false cannot pass vacuously.
  // `npm run build` runs wrangler too (build:functions), so BOTH stubs record what they were given.
  test('plant — wrangler telemetry is switched off for the build and the upload, whatever the caller exports', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const res = deploy(root, { env: { WRANGLER_SEND_METRICS: 'true' } });
      expect(res.status, `a clean, merged tree was refused:\n${res.out}`).toBe(0);
      expect(res.metrics, `the wrapper did not pass WRANGLER_SEND_METRICS=false to its steps:\n${res.metrics.join('\n')}`).toEqual([
        'npm WRANGLER_SEND_METRICS=false',
        'npx WRANGLER_SEND_METRICS=false',
      ]);
    });
  });

  // R-2026-10-03-FI FI-5. With the stand-in in place no plant meets the toolchain check first, so nothing else holds its
  // POSITION: moving it before the ancestor check reddened nothing. A refusal about WHAT is being deployed is reported
  // before one about the machine, and this plant is what says so. Both faults at once: the toolchain ERROR must NOT appear.
  test('plant — an unmerged HEAD is refused as unmerged even when workerd is also missing, so the toolchain check runs after the ancestor check', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const work = join(root, 'work');
      writeFileSync(join(work, 'local-only.txt'), 'x\n', 'utf8');
      git(work, 'add', '-A');
      git(work, 'commit', '-q', '-m', 'a commit no PR merged');
      stubWorkerd(root);
      const direct = exec('node', ['-e', "require('workerd')"], { STUB_WORKERD_MISSING: '1' }, work);
      expect(direct.status, `the stand-in did not throw, so the second fault was never planted:\n${direct.out}`).not.toBe(0);
      const res = deploy(root, { env: { STUB_WORKERD_MISSING: '1' } });
      expect(res.status, `not refused as unmerged:\n${res.out}`).toBe(1);
      expect(res.out).toContain('is not an ancestor of origin/main, so this is code no pull request merged');
      expect(res.out, 'the toolchain check ran before the ancestor check').not.toContain('the native platform package that workerd needs');
    });
  });

  test('plant — a dirty working tree is refused, and the dirty paths are named', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      writeFileSync(join(root, 'work', 'uncommitted.txt'), 'x\n', 'utf8');
      const res = deploy(root);
      expect(res.status, `a dirty tree was deployed:\n${res.out}`).toBe(1);
      expect(res.out).toContain('the working tree has uncommitted changes, so the deployed artifact would match no commit');
      expect(res.out, 'the refusal did not name the offending path').toMatch(/uncommitted\.txt/);
      expect(res.ran.join('\n'), 'it refused AFTER reaching wrangler').not.toMatch(/wrangler/);
    });
  });

  test('plant — a HEAD that is not an ancestor of origin/main is refused', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const work = join(root, 'work');
      writeFileSync(join(work, 'local-only.txt'), 'x\n', 'utf8');
      git(work, 'add', '-A');
      git(work, 'commit', '-q', '-m', 'a commit no PR merged');
      const res = deploy(root);
      expect(res.status, `unmerged code was deployed:\n${res.out}`).toBe(1);
      expect(res.out).toContain('is not an ancestor of origin/main, so this is code no pull request merged');
      expect(res.ran.join('\n')).not.toMatch(/wrangler/);
    });
  });

  test('plant — --branch with no value is refused rather than deploying to ""', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const bin = stubBin(root);
      const res = exec('bash', [join(REPO_ROOT, DEPLOY_SCRIPT), '--branch'], {
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        STUB_LOG: join(root, 'ran.log'),
      });
      expect(res.status, `an empty branch name was accepted:\n${res.out}`).toBe(2);
      expect(res.out).toContain('--branch was given with no value');
    });
  });

  test('plant — an app with no wrangler.toml is REFUSED, never defaulted to another site', () => {
    // THE DEFAULTING FAILURE IS THE POINT. A wrapper that fell back to the first app
    // it knew would deploy the public dashboard when someone typed the admin app's
    // name — the accident wearing the guard's uniform.
    withScratch((root) => {
      repoWithOrigin(root);
      const res = deploy(root, { app: 'no-such-app' });
      expect(res.status, `an unknown app name was accepted:\n${res.out}`).toBe(2);
      expect(res.out).toContain('is not a deployable app -- apps/');
      expect(res.out, 'the refusal did not say what makes an app deployable').toContain(
        'Deployable apps are the directories under apps/ that carry a wrangler.toml.',
      );
      expect(res.ran.join('\n'), 'it refused AFTER reaching wrangler').not.toMatch(/wrangler/);
    });
  });

  test('plant — a wrangler.toml naming no Pages project is refused, not uploaded to ""', () => {
    withScratch((root) => {
      repoWithOrigin(root, []);
      place(root, 'work/apps/nameless/wrangler.toml', 'pages_build_output_dir = "./dist"\n');
      const work = join(root, 'work');
      git(work, 'add', '-A');
      git(work, 'commit', '-q', '-m', 'nameless app');
      git(work, 'push', '-q', 'origin', 'main');
      const res = deploy(root, { app: 'nameless' });
      expect(res.status, `an app with no project name was accepted:\n${res.out}`).toBe(2);
      expect(res.out).toContain('names no Pages project, so there is nothing to upload to');
      expect(res.ran.join('\n')).not.toMatch(/wrangler/);
    });
  });

  test('plant — a wrangler.toml naming no build output directory is refused', () => {
    // The stamp readback has to know where the built artefact is. An app whose
    // output directory is unstated would skip that check rather than fail it.
    withScratch((root) => {
      repoWithOrigin(root, []);
      place(root, 'work/apps/nodir/wrangler.toml', 'name = "openbed-nodir"\n');
      const work = join(root, 'work');
      git(work, 'add', '-A');
      git(work, 'commit', '-q', '-m', 'app with no output dir');
      git(work, 'push', '-q', 'origin', 'main');
      const res = deploy(root, { app: 'nodir' });
      expect(res.status, `an app with no output directory was accepted:\n${res.out}`).toBe(2);
      expect(res.out).toContain('names no pages_build_output_dir, so the build stamp cannot be found');
      expect(res.ran.join('\n')).not.toMatch(/wrangler/);
    });
  });

  test('plant — no app named at all is refused, not defaulted to the first app', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const bin = stubBin(root);
      const res = exec('bash', [join(REPO_ROOT, DEPLOY_SCRIPT)], {
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        STUB_LOG: join(root, 'ran.log'),
      });
      expect(res.status, `the wrapper ran with no app named:\n${res.out}`).toBe(2);
      expect(res.out).toContain('no app named -- this wrapper takes');
    });
  });

  test('plant — an unknown option is refused rather than taken as the app name', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const bin = stubBin(root);
      const res = exec('bash', [join(REPO_ROOT, DEPLOY_SCRIPT), '--dry-run', 'public-dashboard', join(root, 'work')], {
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        STUB_LOG: join(root, 'ran.log'),
      });
      expect(res.status, `an unknown option was swallowed:\n${res.out}`).toBe(2);
      // Two assertions, deliberately: the first is what the user sees, the second is
      // the leg's own identity. The message interpolates $1, so the run-time text and
      // the registered identity can never be the same string.
      expect(res.out).toContain('unknown option --dry-run');
      expect(res.out).toContain('unknown option');
    });
  });

  test('plant — --branch AFTER the app name is still honoured, not taken as ROOT', () => {
    // THE DEFECT THE ARGUMENT LOOP CLOSES (R-2026-09-22-57 B). Under the old
    // first-position-only check this invocation deployed to the DEFAULT branch and
    // said nothing, because --branch landed in the ROOT slot.
    withScratch((root) => {
      repoWithOrigin(root);
      const bin = stubBin(root);
      const log = join(root, 'ran.log');
      const res = exec('bash', [join(REPO_ROOT, DEPLOY_SCRIPT), 'public-dashboard', join(root, 'work'), '--branch', 'preview'], {
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        STUB_LOG: log,
        STUB_STAMP: join(root, 'work', 'apps', 'public-dashboard', SCRATCH_OUT_DIR, 'version.json'),
        STUB_STAMP_BODY: goodStamp(root),
      });
      const ran = existsSync(log) ? readFileSync(log, 'utf8') : '';
      expect(res.status, `a trailing --branch was not honoured:\n${res.out}`).toBe(0);
      expect(ran, 'the branch argument was ignored — this is the silent-default defect').toMatch(
        /npx wrangler pages deploy --branch preview/,
      );
    });
  });

  test('plant — a third positional argument is refused rather than silently dropped', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const bin = stubBin(root);
      const res = exec('bash', [join(REPO_ROOT, DEPLOY_SCRIPT), 'public-dashboard', join(root, 'work'), 'extra'], {
        PATH: `${bin}:${process.env['PATH'] ?? ''}`,
        STUB_LOG: join(root, 'ran.log'),
      });
      expect(res.status, `a stray argument was ignored:\n${res.out}`).toBe(2);
      expect(res.out).toContain('too many arguments -- this wrapper takes');
    });
  });

  test('plant — an unreachable origin is refused, because a stale ref weakens the check silently', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      // Point origin at nothing. The ancestor check would still "work" against the
      // last-fetched ref, which is the quietly-weaker outcome this refuses.
      git(join(root, 'work'), 'remote', 'set-url', 'origin', join(root, 'no-such-remote.git'));
      const res = deploy(root);
      expect(res.status, `it deployed against a stale origin/main:\n${res.out}`).toBe(2);
      expect(res.out).toContain('), so the ancestor check would be made against a stale ref');
      expect(res.ran.join('\n')).not.toMatch(/wrangler/);
    });
  });

  test('plant — a build that wrote NO stamp is refused, not uploaded unidentifiable', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const res = deploy(root, { stamp: null });
      expect(res.status, `an unstamped artifact was uploaded:\n${res.out}`).toBe(1);
      expect(res.out).toContain('so what would be uploaded cannot be identified');
      expect(res.ran.join('\n'), 'it refused AFTER reaching wrangler').not.toMatch(/wrangler/);
    });
  });

  test('plant — a stamp naming a DIFFERENT commit is refused: the stale build directory', () => {
    // THE ACCIDENT THIS CLOSES. Every check above passed on HEAD — clean tree,
    // ancestor of origin/main — and the bytes in dist are from an older build. The
    // working tree and the artifact are different things, and only this compares
    // the second one.
    withScratch((root) => {
      repoWithOrigin(root);
      const stale = '0'.repeat(40);
      const res = deploy(root, { stamp: JSON.stringify({ commit: stale, dirty: false }) });
      expect(res.status, `a stale build directory was uploaded:\n${res.out}`).toBe(1);
      expect(res.out).toContain('-- the built artifact is not the commit that was checked');
      expect(res.out, 'the refusal did not name the commit actually stamped').toContain(stale);
      expect(res.ran.join('\n'), 'it refused AFTER reaching wrangler').not.toMatch(/wrangler/);
    });
  });

  test('plant — a stamp marked dirty is refused even though the tree checked clean', () => {
    // The two halves must not collapse: the stamp RECORDS dirtiness (asserted in
    // tests/compliance/build_stamp.test.ts, which requires exit 0 there), and the
    // wrapper REFUSES it. A dirty stamp here means something wrote into the tree
    // during the build, after the clean check passed.
    withScratch((root) => {
      repoWithOrigin(root);
      const head = git(join(root, 'work'), 'rev-parse', 'HEAD').trim();
      const res = deploy(root, { stamp: JSON.stringify({ commit: head, dirty: true }) });
      expect(res.status, `a dirty artifact was uploaded:\n${res.out}`).toBe(1);
      expect(res.out).toContain('the stamp says the tree was dirty');
      expect(res.ran.join('\n'), 'it refused AFTER reaching wrangler').not.toMatch(/wrangler/);
    });
  });

  test.each([
    ['not JSON at all', 'not json'],
    ['JSON with no commit', '{"dirty":false}'],
    ['JSON whose dirty is a string', '{"commit":"abc","dirty":"false"}'],
  ])('plant — a stamp that is %s FAILS LOUDLY rather than being read as agreement', (_label, body) => {
    // A READBACK THAT COULD NOT RUN MUST NOT REPORT A VERDICT (test-conventions,
    // 2026-09-10). Exit 2, not 1: "the check did not run" is a different outcome
    // from "the check ran and refused", and collapsing them is the defect.
    withScratch((root) => {
      repoWithOrigin(root);
      const res = deploy(root, { stamp: body });
      expect(res.status, `an unreadable stamp was treated as a verdict:\n${res.out}`).toBe(2);
      expect(res.out).toContain('is not readable JSON carrying a commit and a dirty flag, so the readback did not run');
      expect(res.ran.join('\n'), 'it refused AFTER reaching wrangler').not.toMatch(/wrangler/);
    });
  });

  test('anti-vacuity — a tree that is not a git work tree is refused loudly', () => {
    withScratch((root) => {
      mkdirSync(join(root, 'work'), { recursive: true });
      const res = deploy(root);
      expect(res.status, `a non-repository was deployed:\n${res.out}`).toBe(2);
      expect(res.out).toContain('is not a git work tree, so nothing about this build can be checked');
    });
  });
});

const TRACE_CALL = 'curl -q -sS -m 12 https://www.cloudflare.com/cdn-cgi/trace';
const REFUSAL_SENTENCE =
  "Cloudflare's Lagos edge refuses deploys from Nigerian networks (R-2026-09-30-217 GP). Connect a VPN exiting outside Nigeria, check colo is not LOS, and run this again.";
const UNREAD_SENTENCE = 'The check could not run, so nothing was built or uploaded. Check the connection, or connect a VPN exiting outside Nigeria, and run this again.';

/**
 * THE EDGE (R-2026-09-30-217 GP, GP-3). The trace table lives in tests/compliance/edge_guard.test.ts; THIS block
 * holds the wrapper's WIRING: that it asks, where in its order it asks, and that a refusal builds and uploads
 * nothing.
 */
describe('deploy_pages.sh — the edge it would go out through is read before anything is built', () => {
  const builtOrUploaded = (ran: string[]): string[] => ran.filter((l) => /^np[mx] /.test(l));

  test('accept — an ordinary London edge is printed, then the build, then the upload, in that order', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const res = deploy(root);
      expect(res.status, `a clean, merged tree on a London edge was refused:\n${res.out}`).toBe(0);
      expect(res.out, 'the edge was not printed').toContain('deploy_pages.sh: edge trace reads colo=LHR loc=GB');
      const at = (needle: string): number => res.ran.findIndex((l) => l.includes(needle));
      expect(at(TRACE_CALL), `the guard never asked for a trace:\n${res.ran.join('\n')}`).toBeGreaterThanOrEqual(0);
      expect(at(TRACE_CALL), 'the trace was read after the build').toBeLessThan(at('npm run build'));
      expect(at('npm run build'), 'the build did not come before the upload').toBeLessThan(at('npx wrangler pages deploy'));
    });
  });

  test.each([
    // A Lagos or Nigerian edge is REFUSED (exit 1); an edge that cannot be read is a check that COULD NOT RUN (exit 2), R-2026-09-30-218 GQ-5 b.
    ['colo LOS (refused, exit 1)', { STUB_TRACE_BODY: 'colo=LOS\nloc=GB\n' }, 1, REFUSAL_SENTENCE],
    ['loc NG (refused, exit 1)', { STUB_TRACE_BODY: 'colo=LHR\nloc=NG\n' }, 1, REFUSAL_SENTENCE],
    ['an answer that is not a trace (the check could not run, exit 2)', { STUB_TRACE_BODY: '<html>429 Too Many Requests</html>' }, 2, UNREAD_SENTENCE],
    ['a trace that cannot be fetched (the check could not run, exit 2)', { STUB_TRACE_EXIT: '6' }, 2, UNREAD_SENTENCE],
  ])('plant — %s stops the wrapper BEFORE the build, and nothing is built, stamped or uploaded', (_label, env, status, sentence) => {
    withScratch((root) => {
      repoWithOrigin(root);
      const res = deploy(root, { env });
      expect(res.status, `a stopped edge was deployed from:\n${res.out}`).toBe(status);
      expect(res.out).toContain(sentence);
      expect(res.out, 'the other kind of stop\'s sentence was printed').not.toContain(sentence === REFUSAL_SENTENCE ? UNREAD_SENTENCE : REFUSAL_SENTENCE);
      expect(res.ran, 'the guard never asked for a trace').toContain(TRACE_CALL);
      // BEFORE ANY BUILD OR UPLOAD: no npm line (the build) and no npx line (the upload) in the stub log, and the
      // stub build never wrote a stamp. A guard placed after the build would fail the first two.
      expect(builtOrUploaded(res.ran), `the wrapper built or uploaded after the edge was refused:\n${res.ran.join('\n')}`).toEqual([]);
      expect(existsSync(join(root, 'work', 'apps', 'public-dashboard', SCRATCH_OUT_DIR, 'version.json')), 'a stamp exists, so the build ran').toBe(false);
      expect(res.out, 'the wrapper announced a build before refusing').not.toContain('building public-dashboard');
    });
  });

  test('plant — an unmerged HEAD is refused as unmerged even on a Lagos edge, so the edge is read after the ancestor check', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const work = join(root, 'work');
      writeFileSync(join(work, 'local-only.txt'), 'x\n', 'utf8');
      git(work, 'add', '-A');
      git(work, 'commit', '-q', '-m', 'a commit no PR merged');
      const res = deploy(root, { env: { STUB_TRACE_BODY: 'colo=LOS\nloc=NG\n' } });
      expect(res.status, `not refused as unmerged:\n${res.out}`).toBe(1);
      expect(res.out).toContain('is not an ancestor of origin/main, so this is code no pull request merged');
      expect(res.out, 'the edge was judged before the ancestor check').not.toContain(REFUSAL_SENTENCE);
      expect(res.ran, 'the trace was asked for before the ancestor check').toEqual([]);
    });
  });

  test('plant — a missing workerd package is refused as a toolchain fault even on a Lagos edge, so the edge is read after the toolchain check', () => {
    withScratch((root) => {
      repoWithOrigin(root);
      const res = deploy(root, { env: { STUB_WORKERD_MISSING: '1', STUB_TRACE_BODY: 'colo=LOS\nloc=NG\n' } });
      expect(res.status, `not refused as a toolchain fault:\n${res.out}`).toBe(2);
      expect(res.out).toContain('the native platform package that workerd needs is not installed here');
      expect(res.out, 'the edge was judged before the toolchain check').not.toContain(REFUSAL_SENTENCE);
      expect(res.ran, 'the trace was asked for before the toolchain check').toEqual([]);
    });
  });
});

/** Runs the real run_e2e.sh against a scratch tree whose `npx` is a stub. */
function runE2e(root: string, env: Record<string, string> = {}): Run {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(root, 'ran.log');
  // The stub reads --outputFile= (not "$4", which is the word `e2e`), writes that file unless
  // told not to, and exits by phase: STUB_E2E_EXIT for junit-e2e.xml, STUB_RATCHET_EXIT for
  // junit-ratchet.xml. A non-zero phase writes a report holding one failure.
  const npxStub = [
    '#!/usr/bin/env bash',
    'echo "npx $*" >> "$STUB_LOG"',
    'out=""',
    'for a in "$@"; do case "$a" in --outputFile=*) out="${a#--outputFile=}" ;; esac; done',
    'st=0; nofile=""',
    'case "$out" in',
    '  junit-e2e.xml) st="${STUB_E2E_EXIT:-0}"; nofile="${STUB_E2E_NOFILE:-}" ;;',
    '  junit-ratchet.xml) st="${STUB_RATCHET_EXIT:-0}" ;;',
    'esac',
    'if [ -n "$out" ] && [ -z "$nofile" ]; then',
    '  if [ "$st" -ne 0 ]; then f=1; else f=0; fi',
    `  printf '<testsuites tests="1" failures="%s" errors="0"><testsuite><testcase name="a"></testcase></testsuite></testsuites>' "$f" > "$out"`,
    'fi',
    'exit "$st"',
    '',
  ].join('\n');
  writeFileSync(join(bin, 'npx'), npxStub, 'utf8');
  chmodSync(join(bin, 'npx'), 0o755);
  writeFileSync(join(bin, 'node'), `#!/usr/bin/env bash\necho "node $*" >> "$STUB_LOG"\nexit 0\n`, 'utf8');
  chmodSync(join(bin, 'node'), 0o755);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(join(REPO_ROOT, RUN_E2E_SCRIPT), join(root, 'scripts', 'run_e2e.sh'));
  const r = exec('bash', [join(root, 'scripts', 'run_e2e.sh')], {
    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
    STUB_LOG: log,
    ...env,
  });
  return { ...r, ran: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [], metrics: [] };
}

describe('run_e2e.sh — no file in tests/e2e is silently omitted', () => {
  test('plant — a NEW file in tests/e2e is executed, which the two named invocations never did', () => {
    withScratch((root) => {
      place(root, 'tests/e2e/golden-path.test.ts', '// golden path\n');
      place(root, 'tests/e2e/ratchet.test.ts', '// ratchet\n');
      place(root, 'tests/e2e/a_new_leg.test.ts', '// a leg someone added believing it would run\n');
      const res = runE2e(root);
      expect(
        res.ran.join('\n'),
        `the new file was never executed — the defect this fix removes:\n${res.out}`,
      ).toMatch(/a_new_leg\.test\.ts/);
      expect(res.out, 'the corpus was not printed, so an omission would still be invisible').toMatch(/phase 1 corpus/);
    });
  });

  test('the ratchet is NOT in phase 1 — it is the gate, not its own input', () => {
    withScratch((root) => {
      place(root, 'tests/e2e/golden-path.test.ts', '// golden path\n');
      place(root, 'tests/e2e/ratchet.test.ts', '// ratchet\n');
      const res = runE2e(root);
      const phase1 = res.ran.find((l) => l.includes('--outputFile=junit-e2e.xml')) ?? '';
      expect(phase1, `phase 1 did not run:\n${res.out}`).toMatch(/golden-path\.test\.ts/);
      expect(phase1, 'the ratchet was fed its own corpus').not.toMatch(/ratchet\.test\.ts/);
    });
  });

  test('plant — a MISSING golden path is refused by name, not quietly run smaller', () => {
    withScratch((root) => {
      place(root, 'tests/e2e/ratchet.test.ts', '// ratchet\n');
      place(root, 'tests/e2e/a_new_leg.test.ts', '// still something to run\n');
      const res = runE2e(root);
      expect(res.status, `a missing golden path passed as a smaller run:\n${res.out}`).toBe(2);
      expect(res.out).toContain('is missing — the golden path and the ratchet are named in the frontier and in this runner.');
    });
  });

  test('anti-vacuity — an empty tests/e2e directory is refused', () => {
    withScratch((root) => {
      place(root, 'tests/e2e/.keep', '');
      const res = runE2e(root);
      expect(res.status, `an empty corpus was accepted:\n${res.out}`).toBe(2);
      expect(res.out).toContain('is missing — the golden path and the ratchet are named in the frontier and in this runner.');
    });
  });
});

/**
 * run_e2e.sh's TWO PHASES, each with its own exit (R-2026-09-29-172, EV-2 b).
 *
 * THE DEFECT, older than S-c. The npx stub above wrote to "$4", which is the word `e2e` (the
 * arguments are `vitest run --project e2e ...`), so it never wrote junit-e2e.xml. Both tests
 * above that reach phase 1 therefore exited 2 at "phase 1 produced no junit-e2e.xml", and
 * phase 2 ran in none: the "phase 1 may be red, phase 2 gates" contract in the script's header
 * was asserted by no test, and the register recorded its leg as needing a chmod 000 seam that
 * the stub had been reaching all along without asserting it.
 *
 * THE STUB NOW reads --outputFile=, writes that file, and exits STUB_E2E_EXIT for phase 1 or
 * STUB_RATCHET_EXIT for phase 2. STUB_E2E_NOFILE skips phase 1's write. `node` stays a
 * recorder, so what the script attested is read from its call log.
 */
describe('run_e2e.sh — phase 1 may be red, and only phase 2 gates', () => {
  const ATTEST_RATCHET = 'node scripts/attest_counts.mjs junit-ratchet.xml';
  const drive = (env: Record<string, string>): Run =>
    withScratch((root) => {
      place(root, 'tests/e2e/golden-path.test.ts', '// golden path\n');
      place(root, 'tests/e2e/ratchet.test.ts', '// ratchet\n');
      return runE2e(root, env);
    });
  /** Every attestation the script ran, from the recorder. */
  const attested = (r: Run): string[] => r.ran.filter((l) => l.startsWith('node ') && l.includes('attest_counts.mjs'));
  const expectAttestedOnlyTheRatchet = (r: Run): void => {
    expect(attested(r), `attest_counts must run once, on the ratchet's file and never phase 1's:\n${r.out}\n${r.ran.join('\n')}`).toEqual([ATTEST_RATCHET]);
  };

  test('plant — phase 1 red and the ratchet green exits 0: phase 1 never gates', () => {
    const r = drive({ STUB_E2E_EXIT: '1' });
    expect(r.status, `a red phase 1 gated the run:\n${r.out}`).toBe(0);
    expectAttestedOnlyTheRatchet(r);
  });

  test('plant — phase 1 green and the ratchet red exits 1: phase 2 gates', () => {
    const r = drive({ STUB_RATCHET_EXIT: '1' });
    expect(r.status, `a red ratchet passed:\n${r.out}`).toBe(1);
    expectAttestedOnlyTheRatchet(r);
  });

  test('plant — both phases red exits 1, with the ratchet still attested', () => {
    const r = drive({ STUB_E2E_EXIT: '1', STUB_RATCHET_EXIT: '1' });
    expect(r.status, `a red ratchet passed behind a red phase 1:\n${r.out}`).toBe(1);
    expectAttestedOnlyTheRatchet(r);
  });

  test('positive control — both phases green exits 0, with the ratchet attested', () => {
    const r = drive({});
    expect(r.status, r.out).toBe(0);
    expectAttestedOnlyTheRatchet(r);
  });

  test('plant — a phase 1 that writes no junit-e2e.xml is refused by name, exit 2, and the ratchet never runs', () => {
    const r = drive({ STUB_E2E_NOFILE: '1' });
    expect(r.status, `a missing phase 1 report was accepted:\n${r.out}`).toBe(2);
    expect(r.out).toContain('phase 1 produced no junit-e2e.xml — the golden path did not run at all.');
    expect(r.ran.some((l) => l.includes('junit-ratchet.xml')), `the ratchet ran over a phase 1 that never reported:\n${r.ran.join('\n')}`).toBe(false);
  });
});
