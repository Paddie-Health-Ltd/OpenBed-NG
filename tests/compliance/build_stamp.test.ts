import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withScratch, place, REPO_ROOT } from './_scratch.js';

/**
 * THE BUILD STAMP — scripts/stamp_build.mjs (R-2026-09-20-30 A3).
 *
 * WHAT IT IS FOR. The deployment report's fourth clause — "the deployed commit is an
 * ancestor of main" — was an ATTESTATION, the last identifier in this build running
 * on someone's word while every other one is read from the system that issues it.
 * The stamp makes it a READING: the deployed site answers /version.json.
 *
 * WHAT THESE LEGS ASSERT, and they are deliberately about the ARTIFACT rather than
 * the script's return value: a stamp that exists only in a variable proves nothing
 * about what a deploy would upload.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that the stamped artifact is the one Cloudflare serves. Nothing here can read
 *     a Cloudflare project; that is the deployment report's job, and the wrapper's.
 *   - that `dirty: false` means the commit is on main. The wrapper checks that; this
 *     file only checks that the commit is recorded truthfully.
 */
const STAMP_SCRIPT = 'scripts/stamp_build.mjs';
const STAMP_BUILT = join(REPO_ROOT, 'apps', 'public-dashboard', 'dist', 'version.json');

function git(...args: string[]): string {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

describe('the build stamp', () => {
  test('the BUILT bundle carries version.json, and its commit is this checkout HEAD', () => {
    expect(existsSync(STAMP_BUILT), 'run `npm run build` before the compliance suite').toBe(true);
    const stamp = JSON.parse(readFileSync(STAMP_BUILT, 'utf8')) as Record<string, unknown>;
    expect(stamp['commit'], `the stamp does not name this checkout's HEAD — a report reading it would name the wrong build:\n${JSON.stringify(stamp)}`).toBe(git('rev-parse', 'HEAD'));
    expect(typeof stamp['built_at'], 'the stamp carries no build time').toBe('string');
    expect(typeof stamp['dirty'], 'the stamp does not say whether the tree was clean').toBe('boolean');
  });

  test('the stamp is NOT tracked — a committed stamp goes stale silently', () => {
    // It is generated at build time and gitignored. Committed, it would keep
    // naming whatever commit last wrote it, and every later report would read a
    // stale SHA that still looks exact.
    const tracked = git('ls-files', 'apps/public-dashboard/public/version.json');
    expect(tracked, 'version.json is tracked; it must be generated, never committed').toBe('');
    expect(execFileSync('git', ['-C', REPO_ROOT, 'check-ignore', 'apps/public-dashboard/public/version.json'], { encoding: 'utf8' }).trim())
      .toBe('apps/public-dashboard/public/version.json');
  });

  test('robots.txt is still tracked — the ignore covers the file, never the directory', () => {
    // The two live in the same directory, and ignoring `public/` would silently drop
    // the crawler directive from every build while this stamp kept working.
    expect(git('ls-files', 'apps/public-dashboard/public/robots.txt')).toBe('apps/public-dashboard/public/robots.txt');
  });

  test('plant — outside a git work tree it REFUSES rather than writing a placeholder', () => {
    withScratch((root) => {
      place(root, 'keep.txt', 'x');
      const out = join(root, 'version.json');
      let status = 0;
      let text = '';
      try {
        text = execFileSync('node', [join(REPO_ROOT, STAMP_SCRIPT), out], {
          encoding: 'utf8',
          cwd: root,
          env: { ...process.env, GIT_CEILING_DIRECTORIES: root, GIT_DIR: join(root, 'nonexistent.git') },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        status = err.status ?? -1;
        text = `${err.stdout ?? ''}${err.stderr ?? ''}`;
      }
      expect(status, `it stamped something it could not identify:\n${text}`).toBe(2);
      expect(text).toContain('git could not name HEAD, so this build cannot be identified');
      expect(text, 'the refusal did not say why a placeholder is worse than nothing').toContain('Refusing to stamp rather than writing a placeholder: the deployment report READS this file.');
      expect(existsSync(out), 'a placeholder stamp was written — the report would read it as an answer').toBe(false);
    });
  });

  test('plant — an output path it cannot write is fatal, not a silently unstamped build', () => {
    withScratch((root) => {
      // A directory where the file should go: writeFileSync fails, and a build that
      // carries no stamp must not look like a build that carries one.
      const out = join(root, 'version.json');
      execFileSync('mkdir', ['-p', out]);
      let status = 0;
      let text = '';
      try {
        text = execFileSync('node', [join(REPO_ROOT, STAMP_SCRIPT), out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        status = err.status ?? -1;
        text = `${err.stdout ?? ''}${err.stderr ?? ''}`;
      }
      expect(status, `an unwritable stamp path was accepted:\n${text}`).toBe(2);
      expect(text).toContain('could not write the build stamp to');
    });
  });
});
