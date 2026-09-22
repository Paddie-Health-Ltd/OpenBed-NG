import ts from 'typescript';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';
import { PLANT_SERVICE_ROLE_JWT, PLANT_SB_SECRET, PLANT_JWT } from './_plants.js';
import { deployableApps, outputDirOf } from './_apps.js';
import KEYS from '../../packages/origins/publishable-keys.json';
import { PRODUCTION_PUBLISHABLE_KEY, LOCAL_PUBLISHABLE_KEY, publishableKeyFor } from '../../packages/origins/src/keys.js';

/**
 * THE TRACKED CLIENT KEY, AND THE CLOSED ENV ROUTES
 * (R-2026-09-22-60, and R-2026-09-22-61 A1/B1/B3).
 *
 * WHAT THIS CLOSES. A production build used to take values out of an untracked
 * .env.local, because Vite inlines the WHOLE `import.meta.env` record for a bracket
 * access. A name nothing read any more — VITE_SUPABASE_URL — therefore shipped
 * inside the ward console's bundle, and the bundle's contents depended on one
 * laptop. That is Finding D's hazard surviving the change written to close it.
 *
 * THE LOAD-BEARING GUARANTEE IS THE ABSENCE OF A READ, not the configuration.
 * With no `import.meta.env` read anywhere in an app's source, Vite's define never
 * fires and no env record is emitted at all. `envDir: false` and the unused
 * `envPrefix` are the belt: the first closes the FILE route, the second the SHELL
 * route — and only the second reaches it, because Vite copies prefixed `process.env`
 * entries in after the files and they outrank every one.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - A BUILD WITH A PLANTED .env FILE. The plant AP B2 describes has to write into
 *     a developer's own app directory, where `apps/ward-console/.env.local` is the
 *     founder's file — a test that wrote there could destroy it, and a crash between
 *     the write and the cleanup would leave it destroyed. It is run BY HAND and
 *     quoted in the pull request instead, red against the old configuration and
 *     green against this one. What IS asserted here is every input that plant
 *     depends on: the config, the absence of a read, and the built output.
 *   - that the production key is VALID. Only the hosted project can say that;
 *     `scripts/get_publishable_key.sh` is where the value came from and the runbook
 *     is where a rotation is checked.
 */

const KEY_FILE = 'packages/origins/publishable-keys.json';

/** Decode a JWT payload without verifying it — enough to read `role`. */
function jwtRole(value: string): string | null {
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from((parts[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * Why a value is refused, or null if it is an acceptable client key.
 *
 * BY KIND, NEVER BY LENGTH (R-2026-09-22-61 B1). A length rule would pass any
 * long secret and fail any short legitimate key, which is a check whose verdict has
 * nothing to do with what it guards.
 */
export function clientKeyViolation(value: string): string | null {
  if (value.trim() === '') return 'the key is empty';
  if (value.startsWith('sb_secret_')) return 'an sb_secret_ key is a SERVICE credential and must never ship in a client bundle';
  if (value.startsWith('sb_publishable_')) return null;
  const role = jwtRole(value);
  if (role === null) return 'the value is neither an sb_publishable_ key nor a decodable JWT, so its kind cannot be established';
  if (role !== 'anon') return `the JWT claims role="${role}"; a client key must claim role="anon"`;
  return null;
}

/** Every site where a module READS `import.meta.env`, ignoring comments. */
function importMetaEnvReads(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'env' && node.expression.getText().endsWith('import.meta')) {
      hits.push(node.parent.getText().slice(0, 80));
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return hits;
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const APPS = deployableApps();

describe('the tracked client key', () => {
  test('anti-vacuity — the tracked file holds both environments and they differ', () => {
    // Without this, a file that had lost its values would satisfy every "is not a
    // secret" assertion below for free.
    expect(PRODUCTION_PUBLISHABLE_KEY.length, 'the production key is empty').toBeGreaterThan(10);
    expect(LOCAL_PUBLISHABLE_KEY.length, 'the local key is empty').toBeGreaterThan(10);
    expect(PRODUCTION_PUBLISHABLE_KEY, 'the two environments carry the same key — one of them is wrong').not.toBe(LOCAL_PUBLISHABLE_KEY);
  });

  test.each([['production'], ['local']])('the %s key is a client key, judged by KIND', (env) => {
    const value = (KEYS as Record<string, string>)[env] ?? '';
    expect(clientKeyViolation(value), `${KEY_FILE}'s ${env} key is not a client key`).toBeNull();
  });

  test('the production key is publishable-shaped and the local one is an anon JWT', () => {
    // Identity, not just "not a secret": a publishable key where a JWT belongs, or
    // the reverse, would mean the environments had been swapped.
    expect(PRODUCTION_PUBLISHABLE_KEY.startsWith('sb_publishable_'), 'the production key is not an sb_publishable_ key').toBe(true);
    expect(jwtRole(LOCAL_PUBLISHABLE_KEY), 'the local key is not a JWT claiming role=anon').toBe('anon');
  });

  test.each([
    ['a service-role JWT', PLANT_SERVICE_ROLE_JWT, 'role="service_role"'],
    ['an sb_secret_ key', PLANT_SB_SECRET, 'SERVICE credential'],
    ['an empty value', '', 'empty'],
    ['a value of no recognisable kind', 'not-a-key-at-all', 'kind cannot be established'],
  ])('plant — %s in the tracked slot is refused', (_label, value, expected) => {
    const why = clientKeyViolation(value);
    expect(why, `${_label} was accepted as a client key`).not.toBeNull();
    expect(why ?? '', 'the refusal did not say what kind of thing it refused').toContain(expected);
  });

  test('positive control — an ordinary anon JWT is accepted', () => {
    // THE MOST ORDINARY VALID INPUT. A guard that refused it would be switched off
    // by whoever hit it (test-conventions section 2, fifth clause).
    expect(clientKeyViolation(PLANT_JWT)).toBeNull();
  });

  test('the key is chosen by the SAME host rule as the origin', () => {
    expect(publishableKeyFor('openbed.ng')).toBe(PRODUCTION_PUBLISHABLE_KEY);
    expect(publishableKeyFor('127.0.0.1')).toBe(LOCAL_PUBLISHABLE_KEY);
    expect(publishableKeyFor('localhost:5173')).toBe(LOCAL_PUBLISHABLE_KEY);
  });
});

describe('no environment reaches a build', () => {
  test('anti-vacuity — there is at least one app to assert about', () => {
    expect(APPS.length, 'no deployable apps discovered').toBeGreaterThan(0);
  });

  test.each(APPS)('%s reads import.meta.env NOWHERE in its source', (app) => {
    // THE LOAD-BEARING ONE. With no read, Vite emits no env record at all, so
    // neither a file nor the shell can reach the output. Scanned for READS via the
    // TypeScript parser, so both apps can keep EXPLAINING in their comments why the
    // read is gone without the guard counting the explanation as the defect.
    const files = sourceFiles(join(REPO_ROOT, 'apps', app, 'src'));
    expect(files.length, `apps/${app}/src has no TypeScript to scan`).toBeGreaterThan(0);
    for (const file of files) {
      expect(importMetaEnvReads(file), `${file.replace(`${REPO_ROOT}/`, '')} reads import.meta.env`).toEqual([]);
    }
  });

  test.each(APPS)('%s closes BOTH env routes in its vite config', (app) => {
    const cfg = readFileSync(join(REPO_ROOT, 'apps', app, 'vite.config.ts'), 'utf8');
    // The FILE route.
    expect(cfg, `apps/${app} does not set envDir: false, so a .env file could reach its build`).toMatch(/envDir:\s*false/);
    // The SHELL route, which envDir does NOT close: Vite copies prefixed process.env
    // entries in afterwards and they outrank every file.
    const prefix = /envPrefix:\s*\[\s*'([^']+)'/.exec(cfg);
    expect(prefix, `apps/${app} does not set envPrefix, so a VITE_ variable in the shell still reaches its build`).not.toBeNull();
    expect(prefix?.[1], `apps/${app}'s envPrefix is VITE_, which is the prefix this project must NOT expose`).not.toBe('VITE_');
  });

  test.each(APPS)('%s’s built bundle carries no env record at all', (app) => {
    const dir = join(REPO_ROOT, 'apps', app, outputDirOf(app));
    const files = sourceFiles(dir).concat(
      existsSync(dir) ? readdirSync(join(dir, 'assets'), { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.js')).map((e) => join(dir, 'assets', e.name)) : [],
    );
    expect(files.length, `run \`npm run build\` before the compliance suite — apps/${app} has no built output`).toBeGreaterThan(0);
    const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    // Vite's env record always carries these two. Their absence is the observable
    // that says the define never fired.
    expect(text, `apps/${app}'s bundle carries an inlined import.meta.env record`).not.toContain('"BASE_URL"');
    expect(text, `apps/${app}'s bundle carries an inlined import.meta.env record`).not.toContain('"SSR"');
  });

  test('the ward console’s built bundle carries the TRACKED key, from the tracked file', () => {
    const dir = join(REPO_ROOT, 'apps', 'ward-console', 'dist', 'assets');
    const text = readdirSync(dir).filter((n) => n.endsWith('.js')).map((n) => readFileSync(join(dir, n), 'utf8')).join('\n');
    expect(text, 'the ward console ships no publishable key').toContain(PRODUCTION_PUBLISHABLE_KEY);
    expect(text, 'the ward console lost the local key — an environment was shaken out').toContain(LOCAL_PUBLISHABLE_KEY);
  });

  test('the built Pages Function carries NO client key — it has no business holding one', () => {
    // OBSERVED, NOT PREDICTED. When the key and the origin selector shared one
    // module, packages/snapshot/src/serve.ts dragged the key into the Function's
    // bundle and the secret scan said so. The split is what keeps it out, and this
    // is what would notice if the split were undone.
    const dir = join(REPO_ROOT, 'apps', 'public-dashboard', '.functions-build');
    expect(existsSync(dir), 'run `npm run build` before the compliance suite').toBe(true);
    const text = readdirSync(dir).filter((n) => n.endsWith('.js')).map((n) => readFileSync(join(dir, n), 'utf8')).join('\n');
    expect(text, 'the Pages Function bundle carries the local client key').not.toContain(LOCAL_PUBLISHABLE_KEY);
    expect(text, 'the Pages Function bundle carries the production client key').not.toContain(PRODUCTION_PUBLISHABLE_KEY);
  });
});
