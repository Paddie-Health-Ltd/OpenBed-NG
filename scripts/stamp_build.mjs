#!/usr/bin/env node
/**
 * scripts/stamp_build.mjs
 *
 * WRITE THE COMMIT INTO THE ARTIFACT, so "what is deployed" can be FETCHED rather
 * than remembered (R-2026-09-20-30 A3).
 *
 * THE DEFECT THIS CLOSES. This project's Pages deployment is direct-upload, so
 * merging proves review and uploading proves deployment, and nothing binds the two:
 * production once served five commits that existed in no remote branch. The
 * deployment report's fourth clause -- "the commit is an ancestor of main" -- was
 * the last identifier in this build still running on someone's word. Every other
 * one is read from the system that issues it (method note 16). This makes that one
 * a reading too: the deployed site answers /version.json, and the report quotes it.
 *
 * WHY A SEPARATE DOCUMENT AND NOT A FIELD IN /beds.json. That document's envelope is
 * frozen and asserted by set-equality against packages/fixtures/snapshot-shape.json,
 * and it is generated in the DATABASE by app.regenerate_snapshot(). Adding a build
 * field would mean changing a frozen shape, its fixture and a generator, for a
 * detail about the client build. /version.json sits beside it and costs none of that.
 *
 * A COMMIT SHA IS PUBLISHED DELIBERATELY. This repository is public (read from the
 * repository API, 2026-09-20), so the SHA discloses nothing that `git log` does not.
 * In a private repository this file would carry a short build id mapped to the
 * commit in the decision record instead.
 *
 * IT REFUSES RATHER THAN GUESSING. If git cannot answer, this exits non-zero instead
 * of writing "unknown": the deployment report READS this file, so a stamp that
 * cannot identify the build is worse than no stamp at all -- it looks like an answer.
 *
 * `dirty` IS RECORDED, NOT REFUSED HERE. Refusing a dirty tree is the deploy
 * wrapper's job (scripts/deploy_pages.sh); a build is a legitimate thing to run on a
 * dirty tree. But an artifact built from uncommitted changes is not identified by
 * its commit, so the file says so and the reader can see it.
 *
 * NOT ASSERTED BY THIS FILE, deliberately (method note 12):
 *   - that the stamped artifact is the one uploaded. Nothing here can see
 *     Cloudflare. The deploy wrapper and the deployment report cover that.
 *   - that the commit is on main. That is the wrapper's check, and the report's.
 *
 * Usage: node scripts/stamp_build.mjs [OUTPUT_PATH]
 * Exit: 0 written; 2 git could not answer, or the output could not be written.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(ROOT, 'apps', 'public-dashboard', 'public', 'version.json');

function git(...args) {
  return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

let commit;
try {
  commit = git('rev-parse', 'HEAD');
} catch (e) {
  console.error(`ERROR: git could not name HEAD, so this build cannot be identified: ${String(e.message).trim()}`);
  console.error('  Refusing to stamp rather than writing a placeholder: the deployment report READS this file.');
  process.exit(2);
}

if (!/^[0-9a-f]{40}$/.test(commit)) {
  console.error(`ERROR: git returned something that is not a commit id: ${JSON.stringify(commit)}`);
  process.exit(2);
}

let dirty;
try {
  dirty = git('status', '--porcelain') !== '';
} catch (e) {
  console.error(`ERROR: git could not report the working tree state: ${String(e.message).trim()}`);
  process.exit(2);
}

const stamp = {
  commit,
  dirty,
  built_at: new Date().toISOString(),
  note: 'Written by scripts/stamp_build.mjs at build time. `commit` identifies the source of THIS artifact; `dirty` true means it was built from uncommitted changes and its commit does not identify it.',
};

try {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
} catch (e) {
  console.error(`ERROR: could not write the build stamp to ${OUT}: ${String(e.message).trim()}`);
  process.exit(2);
}

console.log(`stamp_build.mjs: ${OUT} <- ${commit}${dirty ? ' (DIRTY TREE)' : ''}`);
