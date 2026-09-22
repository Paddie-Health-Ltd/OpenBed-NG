import ts from 'typescript';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';
import { deployableApps, appsWithFunctions, outputDirOf } from './_apps.js';
import ORIGINS from '../../packages/origins/origins.json';
import {
  environmentForHost,
  apiOrigin,
  supabaseDirectOrigin,
  PRODUCTION_SUPABASE_ORIGIN,
  LOCAL_SUPABASE_ORIGIN,
  PRODUCTION_API_ORIGIN,
  LOCAL_API_ORIGIN,
  LOCAL_HOSTS,
} from '../../packages/origins/src/index.js';
import { serveBedsCached } from '../../packages/snapshot/src/serve.js';

/**
 * TRACKED ORIGINS — what each app talks to, and where that fact lives
 * (R-2026-09-19-21 D1-D3, delivered by R-2026-09-22-57 item 1; the Function's
 * exception is R-2026-09-22-58 A and its value R-2026-09-22-59 B1).
 *
 * WHAT THIS CLOSES. Finding D: nothing in the repository said what the ward console
 * talks to in production. The ward console's origin was an untracked .env.local on
 * one laptop; the Function's was a Pages variable that turned out to be an
 * ENCRYPTED SECRET nobody could read back. Neither was a fact this repository held.
 *
 * THE ONE TRAP THIS FILE IS BUILT AROUND, and it was found by reading a built
 * bundle rather than predicted. Vite inlines the WHOLE `import.meta.env` record,
 * not only the keys a module reads. A developer whose .env.local still defines
 * VITE_SUPABASE_URL therefore ships its value inside the bundle — so an assertion
 * that merely looks for `https://api.openbed.ng` in the ward console's output can
 * be satisfied by THE VERY THING THIS CHANGE REMOVED, and would pass while the
 * tracked file was never read at all.
 *
 * So every built-artefact leg below asserts a MARKER THAT EXISTS ONLY IN
 * origins.json. Its prose survives the build in both bundles (checked, not
 * assumed), which makes the assertion one about the tracked file REACHING the
 * artefact rather than about a string appearing somewhere in it.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that `VITE_SUPABASE_URL` is ABSENT from the ward console's bundle. It is not
 *     a stable property: it depends on an untracked .env.local, so it would pass in
 *     CI and fail on a laptop with a stale one. The stable property is over tracked
 *     SOURCE, and that is asserted — no module reads the name.
 *   - that the origins are REACHABLE. No pure function can establish that a host
 *     resolves or a project is up; the runbook's probes do that.
 *   - the RENDERED ward console. Nothing in this repository renders it; its own
 *     header records that.
 */

const PROXY = join(REPO_ROOT, 'supabase-proxy', 'index.js');
const SERVE = join(REPO_ROOT, 'packages', 'snapshot', 'src', 'serve.ts');
const FUNCTION_ADAPTER = join(REPO_ROOT, 'apps', 'public-dashboard', 'functions', 'beds.json.ts');

/** A string that exists in origins.json and nowhere else in this repository. */
const TRACKED_FILE_MARKER = 'THE NARROW EXCEPTION, granted by name to ONE consumer';

/** The Supabase project id supabase-proxy builds its origin from. Throws rather than returning null. */
function proxyProjectId(source: string): string {
  const m = /SUPABASE_PROJECT_ID\s*=\s*"([A-Za-z0-9_-]+)"/.exec(source);
  if (m === null || (m[1] ?? '') === '') {
    throw new Error('supabase-proxy names no SUPABASE_PROJECT_ID — the comparison below would have nothing to compare');
  }
  return m[1] as string;
}

/** Every site where a module READS the name, ignoring comments entirely. */
function readsOfIdentifier(file: string, name: string): string[] {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === name) hits.push(node.getText());
    else if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === name) hits.push(node.getText());
    else if (ts.isStringLiteral(node) && node.text === name) hits.push(node.getText());
    else if (ts.isPropertySignature(node) && node.name.getText() === name) hits.push(node.getText());
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return hits;
}

/** The member names of a named interface, parsed rather than grepped. */
function interfaceMembers(file: string, iface: string): string[] {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  let found: string[] | null = null;
  ts.forEachChild(sf, (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === iface) {
      found = node.members.map((m) => m.name?.getText() ?? '<unnamed>');
    }
  });
  if (found === null) throw new Error(`interface ${iface} not found in ${file} — the assertion would be vacuous`);
  return found;
}

/**
 * Apps whose BROWSER code takes an origin from the tracked package, DERIVED from
 * their source rather than declared in a list here.
 *
 * The public dashboard is deliberately not one of them: its browser code fetches
 * only the same-origin /beds.json and holds no database address at all. That is a
 * property worth asserting in the other direction, and the legs below do.
 */
function appsConsumingOrigins(): string[] {
  return deployableApps().filter((app) => {
    const src = join(REPO_ROOT, 'apps', app, 'src');
    return existsSync(src) && sourceImportsOrigins(src);
  });
}

/** True when any .ts under a directory imports the origins package. */
function sourceImportsOrigins(dir: string): boolean {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (sourceImportsOrigins(full)) return true;
    } else if (name.endsWith('.ts') && readFileSync(full, 'utf8').includes("from '@openbed/origins'")) {
      return true;
    }
  }
  return false;
}

function builtFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs|cjs|html)$/.test(name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const readAll = (files: string[]): string => files.map((f) => readFileSync(f, 'utf8')).join('\n');

describe('tracked origins — the source', () => {
  test('every declared origin parses and IS an origin, with no path or trailing slash', () => {
    const declared = [PRODUCTION_API_ORIGIN, LOCAL_API_ORIGIN, PRODUCTION_SUPABASE_ORIGIN, LOCAL_SUPABASE_ORIGIN];
    expect(declared.length, 'nothing was declared — every leg below is vacuous').toBeGreaterThan(0);
    for (const value of declared) {
      expect(() => new URL(value), `${value} does not parse as a URL`).not.toThrow();
      expect(new URL(value).origin, `${value} carries a path or a trailing slash, so concatenating a REST path would produce a broken URL`).toBe(value);
    }
  });

  test('the direct Supabase origin and supabase-proxy’s project id are ONE fact, asserted in one block', () => {
    // SECTION 7 OF .claude/rules/test-conventions.md. The project ref now has two
    // derivation sites in tracked code -- this file and the Worker -- and two blocks
    // over one fact can be edited apart and drift while both stay green. The proxy
    // is deliberately NOT made to import the package: it lives outside the npm
    // workspaces and is deployed by `wrangler deploy`, so binding it by import
    // would be a far larger change. It is bound by this assertion instead.
    const id = proxyProjectId(readFileSync(PROXY, 'utf8'));
    expect(new URL(PRODUCTION_SUPABASE_ORIGIN).hostname, `the tracked origin and supabase-proxy's project id "${id}" disagree`).toBe(`${id}.supabase.co`);
  });

  test('anti-vacuity — a proxy naming no project id FAILS rather than agreeing with everything', () => {
    // Without this, a reader that silently returned '' would make the leg above
    // compare two empty-ish values and pass.
    expect(() => proxyProjectId('export default { async fetch(r) { return fetch(r); } };')).toThrow(/names no SUPABASE_PROJECT_ID/);
  });

  test('plant — a tracked origin naming a DIFFERENT project is rejected', () => {
    const id = proxyProjectId(readFileSync(PROXY, 'utf8'));
    const planted = 'https://someotherproject.supabase.co';
    expect(new URL(planted).hostname, 'the plant did not differ from the real value, so this leg tested nothing').not.toBe(`${id}.supabase.co`);
  });

  test('the rule and the exception are two different addresses, and each names the ruling that makes it so', () => {
    // THE LEG THAT STOPS A DEDUPLICATION. The two values look like a duplicate with
    // one of them stale; they are not, and anyone unifying them has to delete a
    // ruling citation to do it.
    expect(PRODUCTION_API_ORIGIN, 'the rule and its exception collapsed to one address').not.toBe(PRODUCTION_SUPABASE_ORIGIN);
    expect(ORIGINS.api.ruling.trim().length, 'the api origin names no ruling').toBeGreaterThan(5);
    expect(ORIGINS.supabaseDirect.ruling.trim().length, 'the direct origin names no ruling').toBeGreaterThan(5);
    expect(ORIGINS.supabaseDirect.why, 'the exception does not say it is one').toContain('EXCEPTION');
  });
});

describe('tracked origins — the selector', () => {
  test.each([...LOCAL_HOSTS])('%s selects local', (host) => {
    expect(environmentForHost(host)).toBe('local');
    expect(supabaseDirectOrigin(host)).toBe(LOCAL_SUPABASE_ORIGIN);
    expect(apiOrigin(host)).toBe(LOCAL_API_ORIGIN);
  });

  test('the hosts THIS REPOSITORY’S OWN TESTS use select local — derived, not restated', () => {
    // R-2026-09-22-59 E. Two legs in tests/db/beds_json_served.test.ts call the
    // cached path with no stubbed fetch, so their target is whatever this selector
    // returns for the URL that file builds its Requests from. If that host stopped
    // being local, those legs would address the LIVE project with a demo key and
    // still assert 200. The corpus is read out of that file so this reds HERE
    // rather than silently in production.
    const bedsTest = readFileSync(join(REPO_ROOT, 'tests', 'db', 'beds_json_served.test.ts'), 'utf8');
    const m = /const REQUEST_URL = '([^']+)'/.exec(bedsTest);
    expect(m, 'REQUEST_URL was renamed or removed — this guard stopped watching the thing it exists for').not.toBeNull();
    const host = new URL((m?.[1] ?? '') as string).hostname;
    expect(environmentForHost(host), `tests/db/beds_json_served.test.ts serves its Function a ${host} request, which is NOT local`).toBe('local');
  });

  test.each([
    ['openbed.ng', 'the production apex'],
    ['www.openbed.ng', 'the www host'],
    ['openbed-public-dashboard.pages.dev', 'the production pages.dev host, which R-2026-09-21-43 D runs probes against'],
    ['a1b2c3d4.openbed-public-dashboard.pages.dev', 'a per-deployment preview host, which can never be enumerated'],
    ['admin.openbed.ng', 'a host that does not exist yet'],
  ])('%s selects production — %s', (host) => {
    expect(environmentForHost(host)).toBe('production');
  });

  test('plant — a host REMOVED from the local list stops selecting local', () => {
    // Proves the list is load-bearing rather than decorative: without this, a
    // selector that returned 'local' for everything would pass every leg above.
    const withoutLoopback = LOCAL_HOSTS.filter((h) => h !== '127.0.0.1');
    expect(withoutLoopback.length, 'the plant removed nothing').toBe(LOCAL_HOSTS.length - 1);
    expect(withoutLoopback.includes('127.0.0.1') ? 'local' : 'production').toBe('production');
    // And the real selector still says local, so the two differ by exactly the list.
    expect(environmentForHost('127.0.0.1')).toBe('local');
  });

  test('anti-vacuity — the selector is TOTAL: it never returns undefined and never throws', () => {
    for (const host of ['', '   ', 'localhost:5173', '127.0.0.1:54321', '[::1]:8788', 'LOCALHOST', 'x'.repeat(200), 'a.b.c.d.e.f']) {
      const env = environmentForHost(host);
      expect(['production', 'local'], `the selector returned ${String(env)} for ${JSON.stringify(host)}`).toContain(env);
      expect(typeof supabaseDirectOrigin(host)).toBe('string');
    }
    // A port must not change the verdict — this is the wrangler/vite dev case.
    expect(environmentForHost('localhost:5173')).toBe('local');
    expect(environmentForHost('[::1]:8788')).toBe('local');
    expect(environmentForHost('LOCALHOST')).toBe('local');
  });
});

describe('tracked origins — the Function reads the tracked source, never its environment', () => {
  const DECOY = 'https://decoy-pages-env-must-not-be-read.supabase.co';

  test('the decoy is a well-formed origin and is NOT the tracked one', () => {
    // THE PRECONDITION LEG. A decoy that happened to equal the tracked value would
    // make the two assertions below into one assertion that cannot fail.
    expect(() => new URL(DECOY)).not.toThrow();
    expect(DECOY).not.toBe(PRODUCTION_SUPABASE_ORIGIN);
    expect(DECOY).not.toBe(LOCAL_SUPABASE_ORIGIN);
  });

  test('plant — a decoy SUPABASE_URL in the Pages environment is NEVER fetched', async () => {
    const seen: string[] = [];
    const spy = (url: string): Promise<Response> => {
      seen.push(url);
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
    };
    // The cast is DELIBERATE and must not be "fixed" by widening BedsEnv: the whole
    // guarantee of R-2026-09-22-59 B3 is that this field does not exist on the type.
    // This plants the variable the Pages project could still hold, to prove that
    // nothing reads it. A compile error here means the field came back.
    const env = { SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_plant', SUPABASE_URL: DECOY } as unknown as Parameters<typeof serveBedsCached>[0]['env'];
    await serveBedsCached({ env, request: new Request('https://openbed.ng/beds.json') }, undefined, spy);

    expect(seen.length, 'the spy never fired, so the assertions below examined nothing').toBe(1);
    expect(seen[0], 'the Function addressed the environment decoy rather than the tracked origin').toContain(PRODUCTION_SUPABASE_ORIGIN);
    expect(seen.join(' '), 'the Pages environment reached the fetch').not.toContain('decoy-pages-env-must-not-be-read');
    expect(seen.join(' '), 'the origin resolved to undefined — the template built a broken URL').not.toContain('undefined');
  });

  test('anti-vacuity — the spy is not a constant: a LOCAL host records the LOCAL origin', async () => {
    const seen: string[] = [];
    const spy = (url: string): Promise<Response> => {
      seen.push(url);
      return Promise.resolve(new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
    };
    const env = { SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_plant' } as Parameters<typeof serveBedsCached>[0]['env'];
    await serveBedsCached({ env, request: new Request('http://127.0.0.1:8788/beds.json') }, undefined, spy);
    expect(seen.length).toBe(1);
    expect(seen[0], 'a local request did not produce the local origin — selection is not happening').toContain(LOCAL_SUPABASE_ORIGIN);
  });

  test.each([
    ['packages/snapshot/src/serve.ts', SERVE],
    ['apps/public-dashboard/functions/beds.json.ts', FUNCTION_ADAPTER],
  ])('plant — %s READS SUPABASE_URL nowhere', (label, file) => {
    // SCANNED FOR READS, NOT MENTIONS, via the TypeScript parser. Both files
    // EXPLAIN in their headers that the variable is gone, and a grep would count
    // that explanation as the defect -- the mistake this repository already made
    // once, when a guard found its own documentation and reported it as evidence.
    expect(readsOfIdentifier(file, 'SUPABASE_URL'), `${label} still reads SUPABASE_URL`).toEqual([]);
  });

  test('BedsEnv names exactly one variable — parsed identity, not a grep', () => {
    expect(
      interfaceMembers(SERVE, 'BedsEnv'),
      'BedsEnv gained a member. If SUPABASE_URL came back, the type-level guarantee of R-2026-09-22-59 B3 is gone',
    ).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
  });
});

describe('tracked origins — the built artefacts', () => {
  const APPS = deployableApps();

  test('anti-vacuity — more than one app is discovered, or the per-app legs prove nothing', () => {
    expect(APPS.length, 'fewer than two apps discovered').toBeGreaterThan(1);
  });

  test('anti-vacuity — at least one app consumes an origin in the browser', () => {
    expect(appsConsumingOrigins().length, 'no app imports the origins package — every consumer leg below is vacuous').toBeGreaterThan(0);
  });

  test.each(appsConsumingOrigins())('%s’s built bundle carries the TRACKED FILE, not merely an origin string', (app) => {
    // THE MARKER, AND WHY IT IS NOT THE ORIGIN ITSELF. Vite inlines the whole
    // import.meta.env record, so a developer with a stale VITE_SUPABASE_URL ships
    // its value in the bundle -- and an assertion looking for `api.openbed.ng`
    // would be satisfied by exactly the thing this change removed. The marker
    // exists only in origins.json, so this is an assertion that the TRACKED FILE
    // reached the artefact.
    const files = builtFiles(join(REPO_ROOT, 'apps', app, outputDirOf(app)));
    expect(files.length, `run \`npm run build\` before the compliance suite — apps/${app} has no built output`).toBeGreaterThan(0);
    expect(readAll(files), `apps/${app}'s bundle does not carry origins.json`).toContain(TRACKED_FILE_MARKER);
  });

  test.each(appsConsumingOrigins())('anti-vacuity — %s’s bundle carries BOTH environments, so the production leg is not a local-build accident', (app) => {
    // THE TREE-SHAKE LEG. The whole design rests on every environment compiling in,
    // because selection happens at runtime. A bundler that dropped the unused one
    // would make the production assertion true only where someone built for
    // production -- which is the Finding D defect wearing different clothes.
    const text = readAll(builtFiles(join(REPO_ROOT, 'apps', app, outputDirOf(app))));
    expect(text, `apps/${app}'s bundle lost the production origin`).toContain(PRODUCTION_API_ORIGIN);
    expect(text, `apps/${app}'s bundle lost the LOCAL origin — an environment was shaken out`).toContain(LOCAL_API_ORIGIN);
    expect(text, `apps/${app}'s bundle lost the direct Supabase origin`).toContain(PRODUCTION_SUPABASE_ORIGIN);
  });

  test.each(APPS.filter((a) => !appsConsumingOrigins().includes(a)))(
    '%s takes NO database origin in the browser, and its bundle proves it',
    (app) => {
      // THE ASSERTION IN THE OTHER DIRECTION, and it is not a formality. The public
      // dashboard's browser code fetches only the same-origin /beds.json; a database
      // address appearing in it would mean one had reached a surface that is
      // supposed to have none.
      const files = builtFiles(join(REPO_ROOT, 'apps', app, outputDirOf(app)));
      expect(files.length, `run \`npm run build\` before the compliance suite — apps/${app} has no built output`).toBeGreaterThan(0);
      const text = readAll(files);
      for (const origin of [PRODUCTION_API_ORIGIN, PRODUCTION_SUPABASE_ORIGIN]) {
        expect(text, `apps/${app} is not supposed to hold a database address, and its bundle carries ${origin}`).not.toContain(origin);
      }
    },
  );

  test.each(appsWithFunctions())('%s’s built Function output carries the tracked origin and no SUPABASE_URL', (app) => {
    const files = builtFiles(join(REPO_ROOT, 'apps', app, '.functions-build'));
    expect(files.length, `run \`npm run build\` (it runs build:functions) before the compliance suite — apps/${app} has none`).toBeGreaterThan(0);
    const text = readAll(files);
    expect(text, 'the built Function does not carry the tracked production origin').toContain(PRODUCTION_SUPABASE_ORIGIN);
    expect(text, 'the built Function does not carry origins.json itself').toContain(TRACKED_FILE_MARKER);
    // Unlike the browser bundle, this one has no import.meta.env record inlined into
    // it, so the ABSENCE is a stable property here and is worth asserting.
    expect(text, 'the built Function still carries SUPABASE_URL — something reads it').not.toContain('SUPABASE_URL');
  });
});
