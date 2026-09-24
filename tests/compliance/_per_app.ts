import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appsWithFunctions, deployableApps } from './_apps.js';

/**
 * EVERY PER-APP FENCE, EACH A FUNCTION OF A ROOT (R-2026-09-24-88 BP-9;
 * R-2026-09-24-93 BU-2 a).
 *
 * A fence asserts that a site listing apps reaches EVERY deployable app, derived from
 * apps/*\/wrangler.toml. Each check reads its site out of `root`, never out of this
 * repository directly, so tests/compliance/per_app_reach.test.ts can run all of them
 * against a SCRATCH tree holding one extra app and require every one to name it, and
 * against an EMPTY tree and require every one to fail. A fence that only ever read
 * the real repository could never be shown to fail on an app it does not reach.
 *
 * The derived sites -- test corpora built with deployableApps() or appsWithFunctions()
 * -- need no fence: they reach a new app by existing. Only sites that hold the set as
 * text are fenced here:
 *   - package.json `typecheck`: the root tsconfig.json EXCLUDES apps/, so an app this
 *     script does not name is never type-checked;
 *   - package.json `build:functions`: an app with a functions/ directory this script
 *     does not build has no .functions-build for the bundle guard to scan;
 *   - .gitignore: one EXACT path per app for its build stamp -- a directory rule would
 *     drop robots.txt from every build (tests/compliance/build_stamp.test.ts);
 *   - packages/fixtures/per-app.json: its three deliberate literal tables.
 */

export interface Fence {
  site: string;
  violations: string[];
}

const NONE = (site: string): Fence => ({ site, violations: ['no deployable app was found under apps/, so this fence reached nothing'] });

function read(root: string, rel: string): string {
  return existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : '';
}

function fixture(root: string): Record<string, Record<string, unknown>> & { deployable_apps?: string[] } {
  const text = read(root, 'packages/fixtures/per-app.json');
  return text === '' ? {} : (JSON.parse(text) as Record<string, Record<string, unknown>>);
}

/** The table's app keys (its `comment` is not an app). */
const keysOf = (table: Record<string, unknown> | undefined): string[] => Object.keys(table ?? {}).filter((k) => k !== 'comment').sort();

export function typecheckFence(root: string): Fence {
  const site = 'package.json typecheck';
  const apps = deployableApps(root);
  if (apps.length === 0) return NONE(site);
  const script = (JSON.parse(read(root, 'package.json') || '{}') as { scripts?: Record<string, string> }).scripts?.['typecheck'] ?? '';
  const violations: string[] = [];
  for (const app of apps) {
    for (const cfg of [`apps/${app}/tsconfig.json`, `apps/${app}/functions/tsconfig.json`]) {
      if (existsSync(join(root, cfg)) && !script.includes(`-p ${cfg}`)) violations.push(`${cfg} exists and \`npm run typecheck\` never checks it (the root tsconfig.json excludes apps/)`);
    }
  }
  return { site, violations };
}

export function buildFunctionsFence(root: string): Fence {
  const site = 'package.json build:functions';
  if (deployableApps(root).length === 0) return NONE(site);
  const script = (JSON.parse(read(root, 'package.json') || '{}') as { scripts?: Record<string, string> }).scripts?.['build:functions'] ?? '';
  return {
    site,
    violations: appsWithFunctions(root)
      .filter((app) => !script.includes(`apps/${app}/functions `) || !script.includes(`apps/${app}/.functions-build`))
      .map((app) => `apps/${app}/functions exists and \`npm run build:functions\` does not build it into apps/${app}/.functions-build`),
  };
}

export function gitignoreFence(root: string): Fence {
  const site = '.gitignore build stamps';
  const apps = deployableApps(root);
  if (apps.length === 0) return NONE(site);
  const lines = new Set(read(root, '.gitignore').split('\n').map((l) => l.trim()));
  return {
    site,
    violations: apps.filter((app) => !lines.has(`apps/${app}/public/version.json`)).map((app) => `.gitignore has no exact line for apps/${app}/public/version.json`),
  };
}

export function fixtureFences(root: string): Fence[] {
  const apps = deployableApps(root);
  const f = fixture(root);
  const sites = ['per-app.json deployable_apps', 'per-app.json client_import_closure', 'per-app.json deploy_targets'];
  if (apps.length === 0) return sites.map(NONE);
  const differ = (have: string[], site: string): string[] =>
    JSON.stringify(have) === JSON.stringify(apps) ? [] : [`${site} names [${have.join(', ')}] but the deployable apps are [${apps.join(', ')}]`];
  const targets = (f['deploy_targets'] ?? {}) as Record<string, { runbook?: string; readback?: string }>;
  const missing = keysOf(targets).flatMap((app) =>
    (['runbook', 'readback'] as const)
      .filter((k) => typeof targets[app]?.[k] !== 'string' || !existsSync(join(root, targets[app]?.[k] as string)))
      .map((k) => `per-app.json deploy_targets names no existing ${k} for ${app}`),
  );
  return [
    { site: sites[0] as string, violations: differ([...(f.deployable_apps ?? [])].sort(), sites[0] as string) },
    { site: sites[1] as string, violations: differ(keysOf(f['client_import_closure']), sites[1] as string) },
    { site: sites[2] as string, violations: [...differ(keysOf(f['deploy_targets']), sites[2] as string), ...missing] },
  ];
}

/** Every fence, over one root. */
export function perAppFences(root: string): Fence[] {
  return [typecheckFence(root), buildFunctionsFence(root), gitignoreFence(root), ...fixtureFences(root)];
}
