import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withScratch, place, REPO_ROOT } from './_scratch.js';
import { deployableApps, pagesProjectOf } from './_apps.js';

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
 * where needed) first on PATH, so nothing is built, uploaded, or run for real. The
 * stub RECORDS that it was invoked, which is what makes the accept legs non-vacuous:
 * a script that refused everything, or that silently did nothing, would pass a bare
 * "exit 0" assertion.
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

interface Run { status: number; out: string; ran: string[] }

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
if [ -n "\${STUB_STAMP:-}" ]; then
  mkdir -p "$(dirname "\$STUB_STAMP")"
  printf '%s' "\$STUB_STAMP_BODY" > "\$STUB_STAMP"
fi
exit 0
`,
    'utf8',
  );
  writeFileSync(join(bin, 'npx'), `#!/usr/bin/env bash\necho "npx $*" >> "$STUB_LOG"\nexit 0\n`, 'utf8');
  chmodSync(join(bin, 'npm'), 0o755);
  chmodSync(join(bin, 'npx'), 0o755);
  return bin;
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
  return { ...r, ran: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [] };
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

/** Runs the real run_e2e.sh against a scratch tree whose `npx` is a stub. */
function runE2e(root: string): Run {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(root, 'ran.log');
  writeFileSync(join(bin, 'npx'), `#!/usr/bin/env bash\necho "npx $*" >> "$STUB_LOG"\nprintf '<testsuites tests="0"></testsuites>' > "$4"\nexit 0\n`, 'utf8');
  chmodSync(join(bin, 'npx'), 0o755);
  writeFileSync(join(bin, 'node'), `#!/usr/bin/env bash\necho "node $*" >> "$STUB_LOG"\nexit 0\n`, 'utf8');
  chmodSync(join(bin, 'node'), 0o755);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(join(REPO_ROOT, RUN_E2E_SCRIPT), join(root, 'scripts', 'run_e2e.sh'));
  const r = exec('bash', [join(root, 'scripts', 'run_e2e.sh')], {
    PATH: `${bin}:${process.env['PATH'] ?? ''}`,
    STUB_LOG: log,
  });
  return { ...r, ran: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [] };
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
