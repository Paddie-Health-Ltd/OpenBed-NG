import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

/**
 * EVERY PLACE AN APP ENDS A SESSION ALSO HANDLES A RENEWAL THAT IS ONLY "NOT NOW"
 * (R-2026-10-02-FF FF-2 d, -182).
 *
 * WHAT IS BEING GUARDED. packages/auth/src/holder.ts now throws TWO errors out of accessToken():
 * SessionExpiredError (the session is over; sign out) and RenewalUnavailableError (the session is
 * KEPT; the renewal could not be done just now). A catch site that knew only the first would treat
 * the second as "something else" and show UNRECOGNISED, or, worse, an `else` that signs the ward
 * out: the very failure this change removes. So every `instanceof SessionExpiredError` in both apps
 * must have a `RenewalUnavailableError` branch in the SAME nearest enclosing catch clause, or in the
 * same function passed to `.catch()`.
 *
 * THE CORPUS IS DECLARED: every .ts under apps/ward-console/src and apps/admin/src, tests and .d.ts
 * excluded. It is read with the TypeScript parser, never grepped, so a comment or a string that names
 * the class is not a site (a plant proves it). The anti-vacuity leg asserts EXACTLY SIX sites, found
 * by AST on 2026-10-02: admin has two in catch clauses (post, render) and two in `.catch()` callbacks
 * (guarded, form); the ward console has two in catch clauses (the publish, and the handover load). A
 * seventh site with its branch is a legitimate addition that edits the declared table below; one
 * without its branch is the failure.
 *
 * NOT ASSERTED HERE, deliberately: that the branch DOES the right thing (shows the kept-session
 * sentence, keeps the mutation id). That is rendered and asserted in ward_console_render.test.ts and
 * admin_render.test.ts; this file only holds that a branch exists where the other error is handled.
 * NOT ASSERTED HERE, deliberately: a SessionExpiredError caught in a `.then(null, fn)` second
 * argument or a promise `finally`. The repository uses neither, so such a site is reported as
 * UNCLASSIFIED rather than silently skipped, and the author decides.
 *
 * GUARD CLASS: LIVE. The apps it guards exist in this change.
 */

type Form = 'catch' | 'callback';

interface Site {
  readonly file: string;
  readonly line: number;
  readonly form: Form;
}

const DECLARED: readonly { file: string; form: Form; count: number }[] = [
  { file: 'apps/admin/src/main.ts', form: 'catch', count: 2 },
  { file: 'apps/admin/src/main.ts', form: 'callback', count: 2 },
  { file: 'apps/ward-console/src/main.ts', form: 'catch', count: 2 },
];

/** The declared corpus. */
function corpusFiles(root: string): string[] {
  const out: string[] = [];
  for (const dir of ['apps/ward-console/src', 'apps/admin/src']) {
    let names: string[] = [];
    try {
      names = readdirSync(join(root, dir));
    } catch {
      names = [];
    }
    for (const n of names) if (n.endsWith('.ts') && !n.endsWith('.test.ts') && !n.endsWith('.d.ts')) out.push(join(dir, n));
  }
  return out.sort();
}

function realSources(): Record<string, string> {
  return Object.fromEntries(corpusFiles(REPO_ROOT).map((f) => [f, readFileSync(join(REPO_ROOT, f), 'utf8')]));
}

/** `x instanceof <name>`, the right-hand side being exactly that identifier. */
function isInstanceOf(n: ts.Node, name: string): n is ts.BinaryExpression {
  return ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && ts.isIdentifier(n.right) && n.right.text === name;
}

/** The nearest enclosing catch clause, or the nearest function that is an argument of `.catch(...)`. */
function containerOf(n: ts.Node): { node: ts.Node; form: Form } | null {
  for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
    if (ts.isCatchClause(p)) return { node: p, form: 'catch' };
    if (ts.isFunctionLike(p)) {
      const call = p.parent;
      if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'catch' && call.arguments.includes(p as ts.Expression)) {
        return { node: p, form: 'callback' };
      }
      // A function that is neither: the site is not in a catch clause or a .catch callback.
      return null;
    }
  }
  return null;
}

/** Every `instanceof SessionExpiredError`, and the violations among them. */
export function catchSites(sources: Record<string, string>): { sites: Site[]; violations: string[] } {
  const sites: Site[] = [];
  const violations: string[] = [];
  for (const [file, text] of Object.entries(sources)) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const expired: ts.BinaryExpression[] = [];
    const renewal = new Set<ts.Node>();
    const visit = (n: ts.Node): void => {
      if (isInstanceOf(n, 'SessionExpiredError')) expired.push(n);
      if (isInstanceOf(n, 'RenewalUnavailableError')) {
        const c = containerOf(n);
        if (c !== null) renewal.add(c.node);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    for (const n of expired) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      const c = containerOf(n);
      if (c === null) {
        violations.push(`${file}:${line} UNCLASSIFIED: an instanceof SessionExpiredError that is in neither a catch clause nor a .catch() callback`);
        continue;
      }
      sites.push({ file, line, form: c.form });
      if (!renewal.has(c.node)) {
        violations.push(`${file}:${line} has no RenewalUnavailableError branch in the same ${c.form === 'catch' ? 'catch clause' : '.catch() callback'}: a kept session would be treated as "something else"`);
      }
    }
  }
  return { sites, violations };
}

/** The anti-vacuity and identity rule: a checker over nothing fails, and the discovered sites equal the declared table. */
function corpusViolations(sources: Record<string, string>, declared = DECLARED): string[] {
  const { sites, violations } = catchSites(sources);
  const out = [...violations];
  if (Object.keys(sources).length === 0) out.push('the corpus is empty: nothing was checked');
  const found = new Map<string, number>();
  for (const s of sites) found.set(`${s.file} ${s.form}`, (found.get(`${s.file} ${s.form}`) ?? 0) + 1);
  const want = new Map(declared.map((d) => [`${d.file} ${d.form}`, d.count]));
  for (const [k, v] of want) if (found.get(k) !== v) out.push(`declared ${v} ${k} site(s), found ${found.get(k) ?? 0}`);
  for (const [k, v] of found) if (!want.has(k)) out.push(`found ${v} undeclared ${k} site(s)`);
  return out;
}

const ONE_CATCH = (body: string): string => `try { go(); } catch (e) { ${body} }`;

describe('every catch site that ends a session also handles a kept one', () => {
  test('real corpus is accepted — every instanceof SessionExpiredError has its RenewalUnavailableError branch, and the sites are the declared six', () => {
    const v = corpusViolations(realSources());
    expect(v, v.join('\n')).toEqual([]);
  });

  test('anti-vacuity — the real corpus holds exactly six sites, in the declared forms', () => {
    const { sites } = catchSites(realSources());
    expect(sites.length, 'a site was added or lost without editing the declared table').toBe(6);
    expect(corpusFiles(REPO_ROOT).length, 'the corpus walker found no files').toBeGreaterThan(1);
  });

  test('anti-vacuity — a checker over an empty corpus fails', () => {
    const v = corpusViolations({});
    expect(v.join('\n')).toContain('the corpus is empty');
  });

  test('plant — a catch clause that knows only SessionExpiredError is rejected', () => {
    const { violations } = catchSites({ 'a.ts': ONE_CATCH('if (e instanceof SessionExpiredError) { out(); }') });
    expect(violations.join('\n')).toContain('has no RenewalUnavailableError branch in the same catch clause');
  });

  test('plant — a .catch() callback that knows only SessionExpiredError is rejected', () => {
    const { violations } = catchSites({ 'a.ts': 'p.catch((e: unknown) => { if (e instanceof SessionExpiredError) out(); });' });
    expect(violations.join('\n')).toContain('has no RenewalUnavailableError branch in the same .catch() callback');
  });

  test('plant — the branch in a DIFFERENT catch clause does not count', () => {
    const text = `${ONE_CATCH('if (e instanceof SessionExpiredError) { out(); }')}\n${ONE_CATCH('if (e instanceof RenewalUnavailableError) { out(); }')}`;
    const { violations } = catchSites({ 'a.ts': text });
    expect(violations.length, 'a branch in another catch clause was accepted').toBe(1);
  });

  test('plant — the branch in a nested catch inside the clause does not count for the outer one', () => {
    const text = ONE_CATCH('if (e instanceof SessionExpiredError) { out(); } try { go(); } catch (f) { if (f instanceof RenewalUnavailableError) out(); }');
    const { violations } = catchSites({ 'a.ts': text });
    expect(violations.length, 'a branch in a nested catch was credited to the outer clause').toBe(1);
  });

  test('plant — a site in neither a catch clause nor a .catch() callback is reported UNCLASSIFIED', () => {
    const { violations } = catchSites({ 'a.ts': 'const f = (e: unknown) => e instanceof SessionExpiredError;' });
    expect(violations.join('\n')).toContain('UNCLASSIFIED');
  });

  test('plant — a seventh site not in the declared table is rejected by identity', () => {
    const real = realSources();
    const planted = { ...real, 'apps/admin/src/zz_planted.ts': ONE_CATCH('if (e instanceof SessionExpiredError) { out(); } else if (e instanceof RenewalUnavailableError) { out(); }') };
    expect(corpusViolations(planted).join('\n')).toContain('undeclared');
  });

  test('control — the ordinary correct catch, with both branches, is accepted', () => {
    const { sites, violations } = catchSites({ 'a.ts': ONE_CATCH('if (e instanceof SessionExpiredError) { a(); return; } if (e instanceof RenewalUnavailableError) { b(); return; }') });
    expect(sites.length).toBe(1);
    expect(violations).toEqual([]);
  });

  test('control — a comment or a string naming the class is NOT a site', () => {
    const text = "// if (e instanceof SessionExpiredError) {}\nconst s = 'e instanceof SessionExpiredError';\n";
    const { sites, violations } = catchSites({ 'a.ts': text });
    expect(sites).toEqual([]);
    expect(violations).toEqual([]);
  });

  test('control — an instanceof of another class is NOT a site', () => {
    expect(catchSites({ 'a.ts': ONE_CATCH('if (e instanceof TypeError) out();') }).sites).toEqual([]);
  });

  test('the walker reads exactly the declared locations', () => {
    const files = corpusFiles(REPO_ROOT);
    for (const f of files) expect(['apps/ward-console/src', 'apps/admin/src'].some((d) => relative(REPO_ROOT, join(REPO_ROOT, f)).startsWith(d))).toBe(true);
    expect(files).toContain('apps/ward-console/src/publish.ts');
    expect(files).toContain('apps/ward-console/src/main.ts');
    expect(files).toContain('apps/admin/src/main.ts');
  });
});
