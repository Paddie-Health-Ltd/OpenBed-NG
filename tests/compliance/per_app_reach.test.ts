import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { deployableApps } from './_apps.js';
import { perAppFences } from './_per_app.js';
import { REPO_ROOT, place, withScratch } from './_scratch.js';
import PER_APP from '../../packages/fixtures/per-app.json';

/**
 * EVERY PER-APP LIST REACHES EVERY APP (R-2026-09-24-88 BP-9; R-2026-09-24-93 BU-2 a).
 *
 * -71 H counted "seven" per-app lists and named none; the 3.4b-app kickoff named
 * twelve, four of them wrongly. Enumerated at `abd6ee5` for PR B's design report:
 * TWELVE sites that list or hard-code the set of apps, and three per-deploy-target
 * lists. Every one is now either DERIVED from apps/*\/wrangler.toml
 * (tests/compliance/_apps.ts), or FENCED against that derivation
 * (tests/compliance/_per_app.ts), or a deliberate literal in
 * packages/fixtures/per-app.json, whose keys are fenced. The design report of record,
 * Sprint Kickoffs/pr-b-design-report-2026-09-24.md, carries the site-by-site table.
 *
 * THE PLANT IS A SCRATCH APP. A copy of every file the fences read, plus
 * apps/zz-scratch with a wrangler.toml, a tsconfig.json and a functions/ directory,
 * must red EVERY fence, each naming zz-scratch. And an empty tree must red every
 * fence: a fence over no apps has checked nothing.
 */

const SCRATCH = 'zz-scratch';

/** Copies every file a fence reads into `root`, for the real apps. */
function copyReal(root: string): void {
  const files = ['package.json', '.gitignore', 'packages/fixtures/per-app.json'];
  for (const app of deployableApps()) {
    files.push(`apps/${app}/wrangler.toml`);
    for (const f of [`apps/${app}/tsconfig.json`, `apps/${app}/functions/tsconfig.json`]) if (existsSync(join(REPO_ROOT, f))) files.push(f);
  }
  for (const t of Object.entries(PER_APP.deploy_targets).filter(([k]) => k !== 'comment')) {
    const v = t[1] as { runbook: string; readback: string };
    files.push(v.runbook, v.readback);
  }
  for (const f of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    copyFileSync(join(REPO_ROOT, f), join(root, f));
  }
}

describe('per-app reach', () => {
  test('real repository — every fence reaches every deployable app', () => {
    const fences = perAppFences(REPO_ROOT);
    expect(fences.length, 'the fence list parsed to nothing').toBe(6);
    expect(fences.filter((f) => f.violations.length > 0), JSON.stringify(fences, null, 2)).toEqual([]);
  });

  test('the copied tree is the real one: every fence passes on it before the scratch app is added', () => {
    // CONFIRM THE PLANT'S BASE (test-conventions section 8): if the copy dropped a file,
    // the plant below could red for that reason and read as coverage.
    withScratch((root) => {
      copyReal(root);
      const fences = perAppFences(root);
      expect(fences.filter((f) => f.violations.length > 0), JSON.stringify(fences, null, 2)).toEqual([]);
    });
  });

  test('plant — a scratch app reds EVERY fence, and each names it', () => {
    withScratch((root) => {
      copyReal(root);
      place(root, `apps/${SCRATCH}/wrangler.toml`, `name = "openbed-${SCRATCH}"\npages_build_output_dir = "./dist"\n`);
      place(root, `apps/${SCRATCH}/tsconfig.json`, '{}\n');
      place(root, `apps/${SCRATCH}/functions/tsconfig.json`, '{}\n');
      expect(deployableApps(root), 'the scratch app was not discovered, so the plant did not land').toContain(SCRATCH);
      const fences = perAppFences(root);
      const unmoved = fences.filter((f) => !f.violations.some((v) => v.includes(SCRATCH)));
      expect(unmoved.map((f) => f.site), `these fences did not name the scratch app:\n${JSON.stringify(fences, null, 2)}`).toEqual([]);
    });
  });

  test('anti-vacuity — an empty tree reds every fence', () => {
    withScratch((root) => {
      const fences = perAppFences(root);
      expect(fences.filter((f) => f.violations.length === 0).map((f) => f.site), 'a fence passed over a tree with no apps').toEqual([]);
    });
  });

  test('plant — a fixture table missing an app is named, even with every other site correct', () => {
    withScratch((root) => {
      copyReal(root);
      const fixture = JSON.parse(JSON.stringify(PER_APP)) as typeof PER_APP;
      delete (fixture.client_import_closure as Record<string, unknown>)['ward-console'];
      place(root, 'packages/fixtures/per-app.json', JSON.stringify(fixture));
      const fence = perAppFences(root).find((f) => f.site === 'per-app.json client_import_closure');
      // The expected sets are derived, not typed: typed, this line held the two-app set
      // and went red when the third app landed, for a reason unrelated to the fence.
      const apps = deployableApps();
      expect(fence?.violations.join('\n')).toContain(
        `client_import_closure names [${apps.filter((a) => a !== 'ward-console').join(', ')}] but the deployable apps are [${apps.join(', ')}]`,
      );
    });
  });
});
