import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { REPO_ROOT } from './_scratch.js';

/**
 * EVERY UNREADABLE-FILE LEG CARRIES ONE PRECONDITION, THE SAME ONE (R-2026-09-29-165, EO-2).
 *
 * WHY IT EXISTS. A leg that makes a file unreadable with chmodSync(<target>, 0o000) and then
 * runs a lint proves the lint's could-not-run branch only for a user who cannot read a mode-000
 * file. Root can. Under root the plant does not take, the lint reads the file, and the leg
 * fails on some later assertion that does not say why, or passes for a reason unrelated to
 * what it guards. On main at bbdefbf the eight sites carried three different forms: five an
 * accessSync(R_OK) precondition, one readFileSync, one `cat`, and bundle_guards' server-side
 * relay leg none at all (EN-3).
 *
 * THE RULE. Every chmodSync(<target>, <mode 0>) in tests/ is followed, inside the same test
 * and before that test's next runLint, spawnSync or execFileSync, by exactly:
 *
 *   expect(() => accessSync(<target>, constants.R_OK), 'this user can read a mode-000 file; the plant did not take').toThrow();
 *
 * naming the same target argument, compared after whitespace is normalised.
 *
 * PARSED, NEVER MATCHED AS TEXT. TypeScript's own parser decides what is a call, as it does in
 * tests/compliance/_legs.ts. So text inside a string is never a site, and this file's own
 * plants, which are strings, cannot trip it. A site's mode is the numeric value 0 (0o000, 0)
 * or the string '000'. Its test is the nearest enclosing callback passed to test, it or their
 * .each; a site outside any test is held against the rest of its file.
 *
 * ROOT SEAM. modeZeroSites() takes the root whose tests/ it reads; the plants below aim it at
 * a scratch tree of .ts files, never at this repository's own.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - That the precondition HOLDS. It is an expect() in its own test; under root it fails with
 *     its message, which is the design (EO-2 c), and nothing here runs it.
 *   - How many LEGS each site makes. A test.each of two is one site and two legs, and legs come
 *     from vitest's test list, not from this parse.
 *   - A chmod whose mode is computed (a variable, an expression). None exists in tests/ today;
 *     such a site would be invisible here.
 *
 * LIVE: its subject, the eight sites, exists now.
 */

const SPAWNS = new Set(['runLint', 'spawnSync', 'execFileSync']);
const TESTS = new Set(['test', 'it']);
const MESSAGE = 'this user can read a mode-000 file; the plant did not take';

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The one precondition line, for a target. */
export const precondition = (target: string): string => `expect(() => accessSync(${target}, constants.R_OK), '${MESSAGE}').toThrow();`;

export interface Site {
  file: string;
  line: number;
  target: string;
}

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFilesUnder(p));
    else if (e.isFile() && e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const calleeName = (c: ts.CallExpression): string | undefined => {
  const e = c.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
};

/** A test's callee: test, it, test.each(...), test.skip and the like, by the name at its root. */
function isTestCallee(e: ts.Expression): boolean {
  if (ts.isIdentifier(e)) return TESTS.has(e.text);
  if (ts.isPropertyAccessExpression(e)) return isTestCallee(e.expression);
  if (ts.isCallExpression(e)) return isTestCallee(e.expression);
  return false;
}

function modeIsZero(arg: ts.Expression | undefined): boolean {
  if (arg === undefined) return false;
  if (ts.isNumericLiteral(arg)) return Number(arg.getText()) === 0;
  if (ts.isStringLiteral(arg)) return arg.text === '000';
  return false;
}

/** The nearest enclosing callback passed to a test, or the file. */
function testScope(node: ts.Node): ts.Node {
  for (let n: ts.Node | undefined = node.parent; n !== undefined; n = n.parent) {
    if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent !== undefined && ts.isCallExpression(n.parent) && n.parent.arguments.includes(n as ts.Expression) && isTestCallee(n.parent.expression)) return n;
  }
  return node.getSourceFile();
}

function descendants(node: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  const walk = (n: ts.Node): void => {
    out.push(n);
    n.forEachChild(walk);
  };
  node.forEachChild(walk);
  return out;
}

/** Every mode-000 site under `<root>/tests`, and every way one is not held. */
export function modeZeroSites(root: string): { sites: Site[]; violations: string[] } {
  const sites: Site[] = [];
  const violations: string[] = [];
  for (const path of tsFilesUnder(join(root, 'tests'))) {
    const file = relative(root, path);
    const sf = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const node of descendants(sf)) {
      if (!ts.isCallExpression(node) || calleeName(node) !== 'chmodSync' || !modeIsZero(node.arguments[1])) continue;
      const targetNode = node.arguments[0];
      if (targetNode === undefined) continue;
      const target = norm(targetNode.getText());
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      sites.push({ file, line, target });
      const where = `${file}:${line}:${target}`;

      const scope = testScope(node);
      const after = descendants(scope).filter((n) => n.getStart() >= node.getEnd());
      const next = after.find((n): n is ts.CallExpression => ts.isCallExpression(n) && SPAWNS.has(calleeName(n) ?? ''));
      if (next === undefined) {
        violations.push(`${where}: no runLint, spawnSync or execFileSync follows this mode-000 chmod in its test, so nothing reads the file it made unreadable`);
        continue;
      }
      const want = norm(precondition(target));
      const held = after.some((n) => ts.isExpressionStatement(n) && n.getEnd() <= next.getStart() && norm(n.getText()) === want);
      if (!held) {
        const at = sf.getLineAndCharacterOfPosition(next.getStart()).line + 1;
        violations.push(`${where}: not followed, before its ${calleeName(next) ?? ''} at line ${at}, by the one precondition: ${want}`);
      }
    }
  }
  if (sites.length === 0) violations.push(`no mode-000 chmodSync site was found under ${join(root, 'tests')}: the guard scanned nothing`);
  return { sites, violations };
}

/** A scratch tree holding one test file with `source`, and the guard's verdict over it. */
function scan(source: string): { sites: Site[]; violations: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'openbed-mode-000-'));
  try {
    mkdirSync(join(root, 'tests', 'compliance'), { recursive: true });
    writeFileSync(join(root, 'tests', 'compliance', 'planted.test.ts'), source, 'utf8');
    return modeZeroSites(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const HELD = [
  "test('an unreadable file fails loudly', () => {",
  '  withScratch((root) => {',
  "    const target = join(root, 'x.sql');",
  '    chmodSync(target, 0o000);',
  '    try {',
  `      ${precondition('target')}`,
  '      const res = runLint(LINT, root);',
  '      expect(res.status).toBe(2);',
  '    } finally {',
  '      chmodSync(target, 0o644);',
  '    }',
  '  });',
  '});',
  '',
].join('\n');

describe('every mode-000 leg carries the one accessSync precondition', () => {
  test('real tests/ tree is accepted, and its sites are printed', () => {
    const { sites, violations } = modeZeroSites(REPO_ROOT);
    console.info(`mode-000 sites (${sites.length}):\n  ${sites.map((s) => `${s.file}:${s.line}:${s.target}`).join('\n  ')}`);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  test('positive control — the ordinary held site is accepted', () => {
    const r = scan(HELD);
    expect(r.sites.map((s) => `${s.file}:${s.line}:${s.target}`)).toEqual(['tests/compliance/planted.test.ts:4:target']);
    expect(r.violations, r.violations.join('\n')).toEqual([]);
  });

  test('positive control — a chmod to 0o644 is not a site', () => {
    const r = scan(HELD.replace('chmodSync(target, 0o000);', 'chmodSync(target, 0o644);'));
    expect(r.sites).toEqual([]);
  });

  test('positive control — a mode-000 chmod inside a string is not a site', () => {
    const r = scan(`const text = "chmodSync(target, 0o000); runLint(LINT, root);";\n${HELD}`);
    expect(r.sites.map((s) => s.line)).toEqual([5]);
    expect(r.violations).toEqual([]);
  });

  test('plant — a site with no precondition is rejected', () => {
    const src = HELD.replace(`      ${precondition('target')}\n`, '');
    expect(src, 'the plant did not land').not.toBe(HELD);
    expect(scan(src).violations).toEqual([`tests/compliance/planted.test.ts:4:target: not followed, before its runLint at line 6, by the one precondition: ${precondition('target')}`]);
  });

  test('plant — the readFileSync form is rejected', () => {
    const src = HELD.replace(precondition('target'), "expect(() => readFileSync(target), 'the planted file is still readable -- running as root?').toThrow();");
    expect(src, 'the plant did not land').not.toBe(HELD);
    expect(scan(src).violations.join('\n')).toContain('tests/compliance/planted.test.ts:4:target: not followed, before its runLint at line 7, by the one precondition');
  });

  test('plant — a precondition on another target is rejected', () => {
    const src = HELD.replace(precondition('target'), precondition('other'));
    expect(src, 'the plant did not land').not.toBe(HELD);
    expect(scan(src).violations.join('\n')).toContain('tests/compliance/planted.test.ts:4:target: not followed, before its runLint at line 7, by the one precondition');
  });

  test('plant — a precondition after the spawn is rejected', () => {
    const src = HELD.replace(`      ${precondition('target')}\n      const res = runLint(LINT, root);\n`, `      const res = runLint(LINT, root);\n      ${precondition('target')}\n`);
    expect(src, 'the plant did not land').not.toBe(HELD);
    expect(scan(src).violations.join('\n')).toContain('not followed, before its runLint at line 6');
  });

  test('plant — a site that no lint or spawn follows is rejected', () => {
    const src = HELD.replace('      const res = runLint(LINT, root);\n      expect(res.status).toBe(2);\n', '');
    expect(src, 'the plant did not land').not.toBe(HELD);
    expect(scan(src).violations).toEqual(['tests/compliance/planted.test.ts:4:target: no runLint, spawnSync or execFileSync follows this mode-000 chmod in its test, so nothing reads the file it made unreadable']);
  });

  test('anti-vacuity — checker over an empty corpus fails', () => {
    const r = scan('export const nothing = 1;\n');
    expect(r.violations.join('\n')).toContain('no mode-000 chmodSync site was found under');
  });
});
