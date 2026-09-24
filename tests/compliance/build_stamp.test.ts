import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withScratch, place, REPO_ROOT } from './_scratch.js';
import { deployableApps } from './_apps.js';
import PER_APP from '../../packages/fixtures/per-app.json';

/**
 * THE BUILD STAMP — scripts/stamp_build.mjs (R-2026-09-20-30 A3, redesigned by
 * R-2026-09-22-57 B).
 *
 * WHAT IT IS FOR. The deployment report's fourth clause — "the deployed commit is an
 * ancestor of main" — was an ATTESTATION, the last identifier in this build running
 * on someone's word while every other one is read from the system that issues it.
 * The stamp makes it a READING: the deployed site answers /version.json.
 *
 * WHY THIS FILE NO LONGER READS A BUILT dist. It used to assert that
 * apps/public-dashboard's built stamp named the checkout's HEAD. That assertion is
 * FALSE FOR A CORRECT BUILD the moment a commit is made after it: the artefact is
 * still a truthful record of the commit it was built from, and HEAD has simply
 * moved. The test went red on correct work, and CI hid it by always building first.
 *
 * THE DEFECT WAS WHERE THE ASSERTION LIVED. "The artefact being uploaded names the
 * commit being deployed" is true only AT UPLOAD TIME, so it is asserted in
 * scripts/deploy_pages.sh's readback and proved in
 * tests/compliance/deploy_guards.test.ts. What is true at any time — and is what
 * this file now asserts — is that the stamp names the commit it was WRITTEN from,
 * and keeps naming it afterwards.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that the stamped artefact is the one UPLOADED. That is the wrapper's readback,
 *     asserted in tests/compliance/deploy_guards.test.ts. A stamp is a record; only
 *     the thing performing the upload can check it against what it is uploading.
 *   - that the stamped artefact is the one Cloudflare SERVES. Nothing here can read
 *     a Cloudflare project; that is the deployment report's job.
 *   - that `dirty: false` means the commit is on main. The wrapper checks that; this
 *     file only checks that the state is recorded truthfully, in both directions.
 */
const STAMP_SCRIPT = 'scripts/stamp_build.mjs';

function git(...args: string[]): string {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

interface Run {
  readonly status: number;
  readonly text: string;
}

function stamp(out: string, env: NodeJS.ProcessEnv = {}, cwd: string = REPO_ROOT): Run {
  try {
    const text = execFileSync('node', [join(REPO_ROOT, STAMP_SCRIPT), out], {
      encoding: 'utf8',
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, text };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, text: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** A real git repository with one commit, so the stamp has something to name. */
function scratchRepo(root: string): void {
  place(root, 'a.txt', 'one');
  const g = (...args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' },
    }).trim();
  g('init', '-q');
  g('add', 'a.txt');
  g('-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-qm', 'one');
}

const APPS = deployableApps();

describe('the build stamp', () => {
  test('anti-vacuity — the deployable app list is not empty and names the apps that exist', () => {
    // A DECAYING LITERAL, deliberately (test-conventions section 3). Every per-app
    // leg below is a `test.each` over this list, so a list that silently emptied
    // would turn each of them into zero tests and report the same green.
    expect(APPS.length, 'no deployable apps discovered — every per-app leg below is vacuous').toBeGreaterThan(0);
    // The literal lives in packages/fixtures/per-app.json since PR 3.4b-app B, where
    // tests/compliance/per_app_reach.test.ts can plant against it; it is still a literal.
    expect(APPS, 'the deployable app set changed; every per-app guard needs a look').toEqual(PER_APP.deployable_apps);
  });

  test('plant — no output path is REFUSED, never defaulted to one app (BP-9)', () => {
    let r: Run;
    try {
      r = { status: 0, text: execFileSync('node', [join(REPO_ROOT, STAMP_SCRIPT)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      r = { status: err.status ?? -1, text: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
    expect(r.status, r.text).toBe(2);
    expect(r.text).toContain('usage: node scripts/stamp_build.mjs OUTPUT_PATH -- the stamp has no default; name the version.json this build writes');
  });

  test('the stamp names HEAD at the moment it is written', () => {
    withScratch((root) => {
      const out = join(root, 'version.json');
      const res = stamp(out);
      expect(res.status, `the stamp refused over this repository:\n${res.text}`).toBe(0);
      const s = JSON.parse(readFileSync(out, 'utf8')) as Record<string, unknown>;
      expect(s['commit'], `the stamp does not name this checkout's HEAD:\n${JSON.stringify(s)}`).toBe(git('rev-parse', 'HEAD'));
      expect(typeof s['built_at'], 'the stamp carries no build time').toBe('string');
      expect(typeof s['dirty'], 'the stamp does not say whether the tree was clean').toBe('boolean');
    });
  });

  test.each(APPS)('%s stamps before it bundles', (app) => {
    // THE ORDER IS THE POINT, not merely the presence of the call: `vite build`
    // copies public/ into dist, so a stamp written AFTER it never reaches the
    // artefact and the app deploys carrying whatever stamp the last build left.
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'apps', app, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const build = pkg.scripts?.['build'] ?? '';
    expect(build, `apps/${app} has no build script`).not.toBe('');
    expect(build, `apps/${app} does not stamp, so it would deploy unidentifiable`).toContain('stamp_build.mjs');
    expect(
      build.indexOf('stamp_build.mjs') < build.indexOf('vite build'),
      `apps/${app} stamps AFTER it bundles, so the stamp never reaches dist: ${build}`,
    ).toBe(true);
  });

  test.each(APPS)('%s’s stamp is NOT tracked — a committed stamp goes stale silently', (app) => {
    // Committed, it would keep naming whatever commit last wrote it, and every later
    // report would read a stale SHA that still looks exact.
    const path = `apps/${app}/public/version.json`;
    expect(git('ls-files', path), `${path} is tracked; it must be generated, never committed`).toBe('');
  });

  test.each(APPS)('%s’s stamp is ignored by its own exact path, never by its directory', (app) => {
    const path = `apps/${app}/public/version.json`;
    expect(
      execFileSync('git', ['-C', REPO_ROOT, 'check-ignore', path], { encoding: 'utf8' }).trim(),
      `${path} is ignored by something other than its own exact path — a directory rule here would drop robots.txt from every build`,
    ).toBe(path);
  });

  test.each(APPS)('%s’s robots.txt is still tracked — the ignore covers the file, never the directory', (app) => {
    // The two live in the same directory, and ignoring `public/` would silently drop
    // the crawler directive from every build while the stamp kept working.
    const path = `apps/${app}/public/robots.txt`;
    expect(git('ls-files', path), `${path} is not tracked, so apps/${app}/public/ is anchored by nothing`).toBe(path);
  });

  test('plant — a commit made AFTER the stamp does not change what the stamp says', () => {
    // THE LEG THAT PROVES THE REDESIGN (R-2026-09-22-57 B), and the one the old
    // dist-reading assertion could never make: it compared the stamp with the
    // CURRENT HEAD, so this scenario — the ordinary one, a commit after a build —
    // was precisely what reddened it.
    withScratch((root) => {
      scratchRepo(root);
      const g = (...args: string[]): string =>
        execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      const out = join(root, 'out', 'version.json');

      const res = stamp(out, { OPENBED_STAMP_ROOT: root }, root);
      expect(res.status, `the stamp refused over a scratch repository:\n${res.text}`).toBe(0);
      const stamped = (JSON.parse(readFileSync(out, 'utf8')) as { commit: string }).commit;
      expect(stamped, 'the scratch stamp did not name the scratch repository').toBe(g('rev-parse', 'HEAD'));

      // The plant: move HEAD on, without re-stamping.
      place(root, 'b.txt', 'two');
      g('add', 'b.txt');
      execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-qm', 'two'], { stdio: 'ignore' });
      const moved = g('rev-parse', 'HEAD');
      expect(moved, 'the plant did not move HEAD, so this leg tested nothing').not.toBe(stamped);

      const after = (JSON.parse(readFileSync(out, 'utf8')) as { commit: string }).commit;
      expect(after, 'the stamp changed without being rewritten').toBe(stamped);
      expect(after, 'the stamp names the NEW head — it is not a record of what was built').not.toBe(moved);
    });
  });

  test('plant — a dirty tree is RECORDED, not refused, by the stamp', () => {
    // THE POSITIVE CONTROL for the wrapper's refusal (deploy_guards.test.ts). The
    // two halves must not be the same check: the stamp's job is to record the state
    // truthfully, and REFUSING here would mean a developer could not build at all
    // with an edit in the tree. Refusing to UPLOAD it is the wrapper's job.
    withScratch((root) => {
      scratchRepo(root);
      place(root, 'uncommitted.txt', 'x');
      const out = join(root, 'out', 'version.json');
      const res = stamp(out, { OPENBED_STAMP_ROOT: root }, root);
      expect(res.status, `the stamp refused a dirty tree instead of recording it:\n${res.text}`).toBe(0);
      const s = JSON.parse(readFileSync(out, 'utf8')) as { dirty: boolean };
      expect(s.dirty, 'a dirty tree was stamped as clean — the wrapper would upload it').toBe(true);
    });
  });

  test('plant — outside a git work tree it REFUSES rather than writing a placeholder', () => {
    withScratch((root) => {
      place(root, 'keep.txt', 'x');
      const out = join(root, 'version.json');
      const res = stamp(out, { GIT_CEILING_DIRECTORIES: root, GIT_DIR: join(root, 'nonexistent.git') }, root);
      expect(res.status, `it stamped something it could not identify:\n${res.text}`).toBe(2);
      expect(res.text).toContain('git could not name HEAD, so this build cannot be identified');
      expect(res.text, 'the refusal did not say why a placeholder is worse than nothing').toContain(
        'Refusing to stamp rather than writing a placeholder: the deployment report READS this file.',
      );
      expect(existsSync(out), 'a placeholder stamp was written — the report would read it as an answer').toBe(false);
    });
  });

  test('plant — an output path it cannot write is fatal, not a silently unstamped build', () => {
    withScratch((root) => {
      // A directory where the file should go: writeFileSync fails, and a build that
      // carries no stamp must not look like a build that carries one.
      const out = join(root, 'version.json');
      execFileSync('mkdir', ['-p', out]);
      const res = stamp(out);
      expect(res.status, `an unwritable stamp path was accepted:\n${res.text}`).toBe(2);
      expect(res.text).toContain('could not write the build stamp to');
    });
  });
});
