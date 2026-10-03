import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT, place, withScratch } from './_scratch.js';

/**
 * THREE HOLDERS OF THE DIRECT ORIGIN (R-2026-09-30-174 EX-2 d; widened by R-2026-10-02-FF FF-4 b, -182).
 *
 * RESTATED 2026-10-02 (FF-4 b). This header, and the titles below, said "two holders". It now reads: the
 * direct origin is granted BY NAME to the two Functions AND to the ward console's fallback, and to nothing
 * else. The third holder is apps/ward-console/src/main.ts, which hands the origin to the auth package as
 * an ARGUMENT (`fallbackApiUrl`) for D5's availability fallback (R-2026-09-19-23 D5). It is the third and
 * LAST: the admin app does not take it (its CSP does not name it either, security_headers.test.ts), and
 * packages/auth/src never imports it. The original text, kept: "The -58 A exception lets a server-side
 * Function reach Supabase without the Worker proxy, and it is granted by name to two routes: /beds.json
 * and /api/health, whose code lives in packages/snapshot/src/serve.ts and
 * packages/snapshot/src/health_serve.ts." (2026-09-30)
 *
 * The address itself is exported by packages/origins/src/index.ts, and nothing about an export stops a
 * further file, a browser app among them, from importing it: the exception would then have
 * spread with no ruling and no test going red. So this test holds the IMPORTERS of the three
 * names that carry the address to exactly the three files in HOLDERS.
 *
 * THE CORPUS IS DECLARED, and it is proxy_allow_list.test.ts's: every .ts under
 * apps/<app>/src, apps/<app>/functions and packages/<pkg>/src, tests and .d.ts excluded, minus
 * packages/origins/src/index.ts, which DEFINES the names. It is walked here, not imported from
 * that file, because importing a test file runs its tests; the walker below is a copy, and
 * the discovery legs pin it to the declared locations so a drift between the two reds here
 * rather than passing silently (test-conventions.md section 2 (d)).
 *
 * WHAT COUNTS AS AN IMPORT is read from the TypeScript AST, never grepped, and by the NAME
 * imported, not by the module specifier: serve.ts imports through a relative path and an app
 * would import through @openbed/origins, and both must be seen. A named import (including
 * an alias), a re-export of a name, and a namespace import or a star re-export of an origins
 * module each count. A comment or string naming the identifier does not, and a plant proves
 * it (test-conventions.md section 2 (a)).
 *
 * LEGS: ACCEPT the real corpus; ANTI-VACUITY (exactly two are found, and an empty corpus
 * fails); PLANT a third importer in each declared location, a re-export, a namespace import
 * and an alias; POSITIVE CONTROLS (a comment, a string, a local declaration are not imports);
 * and the walker itself is held to the declared locations by a scratch tree.
 *
 * NOT ASSERTED HERE, deliberately: a dynamic import() or a require of the origins module,
 * and a file outside the declared locations (scripts/, tests/), which the declared corpus
 * does not read. The first is not used anywhere in this repository's TypeScript; naming it
 * is not the same as covering it.
 */

const NAMES = new Set(['supabaseDirectOrigin', 'PRODUCTION_SUPABASE_ORIGIN', 'LOCAL_SUPABASE_ORIGIN']);
const DEFINER = 'packages/origins/src/index.ts';
const HOLDERS = ['apps/ward-console/src/main.ts', 'packages/snapshot/src/health_serve.ts', 'packages/snapshot/src/serve.ts'];

/** The declared corpus: apps/<app>/{src,functions} and packages/<pkg>/src, TypeScript, no tests. */
function corpusFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) {
        if (!['node_modules', 'dist', '.functions-build', '.wrangler'].includes(n)) walk(p);
      } else if (n.endsWith('.ts') && !n.endsWith('.test.ts') && !n.endsWith('.d.ts')) out.push(p);
    }
  };
  for (const top of ['apps', 'packages']) {
    const base = join(root, top);
    if (!existsSync(base)) continue;
    for (const a of readdirSync(base)) for (const sub of ['src', 'functions']) walk(join(base, a, sub));
  }
  return out.sort();
}

/** repo-relative path -> source, for the declared corpus, without the definer. */
function readCorpus(root: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of corpusFiles(root)) {
    const rel = relative(root, f).split('\\').join('/');
    if (rel !== DEFINER) m.set(rel, readFileSync(f, 'utf8'));
  }
  return m;
}

const isOriginsModule = (spec: string): boolean => /(^|\/)origins(\/|$)/.test(spec) || spec === '@openbed/origins' || spec.startsWith('@openbed/origins/');

/** Does this source import (or re-export) one of the three names, or reach them by namespace or star? */
function importsDirectOrigin(source: string): boolean {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const nb = st.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb) && nb.elements.some((e) => NAMES.has((e.propertyName ?? e.name).text))) return true;
      if (nb && ts.isNamespaceImport(nb) && isOriginsModule(st.moduleSpecifier.text)) return true;
    }
    if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      const ec = st.exportClause;
      if (ec === undefined && isOriginsModule(st.moduleSpecifier.text)) return true;
      if (ec && ts.isNamedExports(ec) && ec.elements.some((e) => NAMES.has((e.propertyName ?? e.name).text))) return true;
    }
  }
  return false;
}

/** Every way the importers are not exactly the three holders. Empty means they are. */
function holderViolations(corpus: Map<string, string>): string[] {
  if (corpus.size === 0) return ['the corpus is empty: no file was read, so "no third importer" is not evidence'];
  const found = [...corpus].filter(([, src]) => importsDirectOrigin(src)).map(([p]) => p).sort();
  const out: string[] = [];
  for (const f of found) if (!HOLDERS.includes(f)) out.push(`${f} imports the direct origin and is not one of the three holders`);
  for (const h of HOLDERS) if (!found.includes(h)) out.push(`${h} no longer imports the direct origin: the exception named it, and nothing reads it now`);
  return out;
}

const REAL = readCorpus(REPO_ROOT);
const ORIGINS_IMPORT = `import { supabaseDirectOrigin } from '@openbed/origins';\nexport const o = supabaseDirectOrigin('x');\n`;

describe('the direct origin has exactly three holders', () => {
  test('real corpus is accepted — the importers are exactly the ward console, serve.ts and health_serve.ts', () => {
    const v = holderViolations(REAL);
    expect(v, v.join('; ')).toEqual([]);
  });

  test('anti-vacuity — exactly three importers are found in the real corpus, and an empty corpus fails', () => {
    const found = [...REAL].filter(([, s]) => importsDirectOrigin(s)).map(([p]) => p).sort();
    expect(found).toEqual(HOLDERS);
    expect(holderViolations(new Map()).join('; ')).toContain('the corpus is empty');
  });

  test('the real corpus reaches every declared location (an app src, an app functions, a package src)', () => {
    const paths = [...REAL.keys()];
    expect(paths.some((p) => /^apps\/[^/]+\/src\//.test(p)), 'no apps/*/src file was read').toBe(true);
    expect(paths.some((p) => /^apps\/[^/]+\/functions\//.test(p)), 'no apps/*/functions file was read').toBe(true);
    expect(paths.some((p) => /^packages\/[^/]+\/src\//.test(p)), 'no packages/*/src file was read').toBe(true);
    expect(paths.includes(DEFINER), 'the definer must be excluded from the corpus').toBe(false);
  });

  test.each([
    ['an app src file', 'apps/ward-console/src/zz_planted.ts', ORIGINS_IMPORT],
    ['an import in the admin app, which never takes it (FF-4 b)', 'apps/admin/src/zz_planted.ts', ORIGINS_IMPORT],
    ['an import in packages/auth/src, which takes the origin as an argument and never imports it (FF-4 b)', 'packages/auth/src/zz_planted.ts', ORIGINS_IMPORT],
    ['an ALIASED import in a new ward-console file (FF-4 b)', 'apps/ward-console/src/zz_planted.ts', `import { supabaseDirectOrigin as direct } from '@openbed/origins';\nexport const o = direct('x');\n`],
    ['an app functions file', 'apps/public-dashboard/functions/zz_planted.ts', ORIGINS_IMPORT],
    ['a package src file', 'packages/labels/src/zz_planted.ts', ORIGINS_IMPORT],
    ['a relative import of the definer', 'packages/labels/src/zz_planted.ts', `import { supabaseDirectOrigin } from '../../origins/src/index.js';\n`],
    ['an aliased import', 'apps/admin/src/zz_planted.ts', `import { supabaseDirectOrigin as sd } from '@openbed/origins';\nexport const o = sd;\n`],
    ['the production constant', 'apps/admin/src/zz_planted.ts', `import { PRODUCTION_SUPABASE_ORIGIN } from '@openbed/origins';\nexport const o = PRODUCTION_SUPABASE_ORIGIN;\n`],
    ['the local constant', 'apps/admin/src/zz_planted.ts', `import { LOCAL_SUPABASE_ORIGIN } from '@openbed/origins';\nexport const o = LOCAL_SUPABASE_ORIGIN;\n`],
    ['a re-export of the name', 'packages/labels/src/zz_planted.ts', `export { supabaseDirectOrigin } from '@openbed/origins';\n`],
    ['a star re-export of the origins module', 'packages/labels/src/zz_planted.ts', `export * from '../../origins/src/index.js';\n`],
    ['a namespace import of the origins module', 'apps/admin/src/zz_planted.ts', `import * as origins from '@openbed/origins';\nexport const o = origins;\n`],
  ])('plant — a third importer: %s is rejected', (_label, path, source) => {
    const corpus = new Map(REAL);
    corpus.set(path, source);
    expect(corpus.get(path), 'the plant did not land').toBe(source);
    expect(holderViolations(corpus).join('; ')).toContain(`${path} imports the direct origin and is not one of the three holders`);
  });

  test('plant — a holder that stops importing it is rejected as stale', () => {
    const corpus = new Map(REAL);
    corpus.set('packages/snapshot/src/health_serve.ts', 'export const x = 1;\n');
    expect(holderViolations(corpus).join('; ')).toContain('health_serve.ts no longer imports the direct origin');
  });

  test('plant — the ward console ceasing to import it is rejected as stale: the CSP and the fallback would name an origin nothing reads', () => {
    const corpus = new Map(REAL);
    corpus.set('apps/ward-console/src/main.ts', 'export const x = 1;\n');
    expect(holderViolations(corpus).join('; ')).toContain('apps/ward-console/src/main.ts no longer imports the direct origin');
  });

  test.each([
    ['a comment naming the import', `// import { supabaseDirectOrigin } from '@openbed/origins';\nexport const a = 1;\n`],
    ['a string holding an import', `export const a = "import { supabaseDirectOrigin } from '@openbed/origins'";\n`],
    ['a local function that only shares the name', `export function supabaseDirectOrigin(h: string): string { return h; }\n`],
    ['an import of another name from origins', `import { apiOrigin } from '@openbed/origins';\nexport const a = apiOrigin('x');\n`],
    ['a namespace import of something else', `import * as fs from 'node:fs';\nexport const a = fs;\n`],
  ])('control — %s is NOT an import of the direct origin', (_label, source) => {
    expect(importsDirectOrigin(source)).toBe(false);
  });

  test('the walker reads exactly the declared locations: three planted files found, and a test file, a d.ts and node_modules ignored', () => {
    withScratch((root) => {
      place(root, 'apps/a/src/x.ts', 'export const x = 1;\n');
      place(root, 'apps/a/functions/y.ts', 'export const y = 1;\n');
      place(root, 'packages/p/src/z.ts', 'export const z = 1;\n');
      place(root, 'apps/a/src/x.test.ts', 'export const t = 1;\n');
      place(root, 'apps/a/src/x.d.ts', 'export const d: number;\n');
      place(root, 'apps/a/src/node_modules/m/i.ts', 'export const m = 1;\n');
      place(root, 'scripts/outside.ts', 'export const o = 1;\n');
      expect(corpusFiles(root).map((f) => relative(root, f).split('\\').join('/'))).toEqual(['apps/a/functions/y.ts', 'apps/a/src/x.ts', 'packages/p/src/z.ts']);
    });
  });

  test('plant — a third importer written into a scratch tree is rejected end to end', () => {
    withScratch((root) => {
      place(root, 'packages/snapshot/src/serve.ts', ORIGINS_IMPORT);
      place(root, 'packages/snapshot/src/health_serve.ts', ORIGINS_IMPORT);
      place(root, 'apps/ward-console/src/main.ts', ORIGINS_IMPORT);
      place(root, 'apps/a/src/leak.ts', ORIGINS_IMPORT);
      expect(holderViolations(readCorpus(root)).join('; ')).toContain('apps/a/src/leak.ts imports the direct origin');
    });
  });
});
