import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';

/**
 * WHICH APPS ARE DEPLOYABLE, DERIVED RATHER THAN DECLARED (R-2026-09-22-57 B).
 *
 * A deployable app is a directory under `apps/` carrying a `wrangler.toml`, and its
 * Pages project name and build output directory are read out of that file.
 *
 * WHY DERIVED. `apps/*\/wrangler.toml` is already the artefact Cloudflare itself
 * reads. A second tracked list of app names would be a RESTATEMENT of a fact that
 * already has a home, and a restatement drifts -- which is the exact failure
 * tests/compliance/lint_migrations_all_complete.test.ts exists to catch one
 * directory over. Deriving it also means an app added in a later bundle becomes
 * covered by every per-app guard BY EXISTING, rather than by someone remembering to
 * extend a list.
 *
 * WHY THERE IS STILL A LITERAL TABLE. tests/compliance/build_stamp.test.ts asserts
 * this function's result against a checked-in list of names, which lives in
 * packages/fixtures/per-app.json since PR 3.4b-app B. That is deliberate and
 * it is not a magic number: it decays LOUDLY the moment an app is added or renamed,
 * which is the review you want (.claude/rules/test-conventions.md section 3 --
 * assert on parsed identity, never on a count).
 *
 * WHY supabase-proxy IS NOT HERE. It is a Worker, configured by a wrangler.json,
 * and it lives outside `apps/`. It is deployed by `wrangler deploy`, not
 * `wrangler pages deploy`, so it is excluded by construction rather than by a name
 * this file would have to remember.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that the Pages project named in a wrangler.toml exists in the Cloudflare
 *     account. Nothing in this repository can read that account; it is a runbook
 *     step, and the deployment report is what closes it.
 */

/** Minimal TOML read: the value of a top-level `key = "value"` line. */
function tomlString(text: string, key: string): string | null {
  for (const line of text.split('\n')) {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`).exec(line);
    if (m) return m[1] ?? null;
  }
  return null;
}

function wranglerFor(app: string, root: string = REPO_ROOT): string {
  const file = join(root, 'apps', app, 'wrangler.toml');
  if (!existsSync(file)) {
    throw new Error(`apps/${app} has no wrangler.toml, so it is not a deployable Pages app`);
  }
  return readFileSync(file, 'utf8');
}

/** Directories under apps/ carrying a wrangler.toml, sorted. */
export function deployableApps(root: string = REPO_ROOT): string[] {
  const dir = join(root, 'apps');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(join(dir, name, 'wrangler.toml')))
    .sort();
}

/** Apps carrying a functions/ directory — the server-side bundle-scan corpus. */
export function appsWithFunctions(root: string = REPO_ROOT): string[] {
  return deployableApps(root).filter((app) => existsSync(join(root, 'apps', app, 'functions')));
}

/** The Cloudflare Pages project an app deploys to. */
export function pagesProjectOf(app: string, root: string = REPO_ROOT): string {
  const name = tomlString(wranglerFor(app, root), 'name');
  if (name === null || name === '') {
    throw new Error(`apps/${app}/wrangler.toml names no Pages project`);
  }
  return name;
}

/** An app's build output directory, relative to the app (leading "./" stripped). */
export function outputDirOf(app: string, root: string = REPO_ROOT): string {
  const dir = tomlString(wranglerFor(app, root), 'pages_build_output_dir');
  if (dir === null || dir === '') {
    throw new Error(`apps/${app}/wrangler.toml names no pages_build_output_dir`);
  }
  return dir.replace(/^\.?\//, '');
}
