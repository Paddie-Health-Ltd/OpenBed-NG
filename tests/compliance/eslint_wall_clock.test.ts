import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import ts from 'typescript';
import * as yaml from 'js-yaml';
import { ESLint } from 'eslint';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT, place } from './_scratch.js';

/**
 * F3: THE DISPLAY PATH READS NO DEVICE CLOCK (R-2026-09-21-38 D1; built by PR F,
 * R-2026-09-26-130 DF-1). The rule is `openbed/no-wall-clock` in eslint.config.mjs,
 * specified in the v2 kickoff ("The F3 guard, specified to implement") and unbuilt until
 * PR F -- while packages/snapshot/src/serve.ts said, truthfully, "THERE IS NO SUCH RULE".
 *
 * LEGS, each through ESLint's own API so nothing here is a grep:
 *   - PLANT, one per ban the spec names: Date.now, a no-argument `new Date()` (plain and in
 *     the coercion form), performance.timeOrigin, Date.UTC;
 *   - POSITIVE CONTROLS, the most ordinary legal code: `new Date(iso).toLocaleString(...)`,
 *     Date.parse, performance.now;
 *   - ACCEPT: the real scope lints with no hit, and the linted files include
 *     packages/snapshot/src/freshness.ts (the spec's third clause);
 *   - ANTI-VACUITY: a tree holding no TypeScript lints nothing, so "no hit" is only
 *     evidence alongside a non-empty file list;
 *   - DF-1 c, THE EXEMPTIONS PINNED: exactly two deliberate clock reads are exempt, by FILE
 *     and REASON, never by line number. Any other disable of this rule in scope is refused:
 *     a third one, one without OPENBED-CLOCK-READ or a ruling id, one naming another rule
 *     too, a file- or block-wide `eslint-disable`, or an `eslint-disable-line`;
 *   - DF-1 d, CI ACTUALLY LINTS THESE FILES: repo-lint runs `npx eslint .`, none of the
 *     scoped files is ignored, and the resolved config for each carries the rule as an
 *     error.
 *
 * NOT ASSERTED HERE, deliberately (the spec's own list, v2 kickoff "NOT ASSERTED"):
 *   - that the age COMPUTATION is right -- tests/compliance/freshness_bands.test.ts;
 *   - transitive dependencies: a package outside the scope that reads a clock is not seen;
 *   - a clock read arriving as data, or through an alias: `const p = globalThis.performance;
 *     p.timeOrigin` evades an AST rule, as `const D = Date; D.now()` does. anchor.ts aliases
 *     performance for .now(), which is legal;
 *   - `Date()` called without `new`, which also returns the current time: the spec does not
 *     name it and DF-1 a keeps the bans exactly as written. Reported for Cowork.
 */

const RULE = 'openbed/no-wall-clock';
const SCOPE = ['apps/**/*.ts', 'apps/**/*.tsx', 'packages/snapshot/src/**/*.ts'];
const eslint = new ESLint({ cwd: REPO_ROOT, errorOnUnmatchedPattern: false });
const AS_IF_IN = 'apps/public-dashboard/src/__plant__.ts';

async function hits(code: string, filePath: string = AS_IF_IN): Promise<ESLint.LintResult['messages']> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === RULE);
}

/**
 * Every eslint directive comment in a file. The comments come from a real PARSE
 * (ts.createSourceFile, then the comment ranges around every node), never a bare scanner:
 * a scanner has no parse context, cannot tell a regex literal from a division, and -- as
 * observed while writing this file -- lost the ward console's exemption comment behind an
 * earlier mis-tokenised stretch. Method note 17.
 */
export interface Directive {
  readonly file: string;
  readonly kind: 'eslint-disable' | 'eslint-disable-line' | 'eslint-disable-next-line' | 'eslint-enable';
  readonly rules: readonly string[];
  readonly reason: string;
}

export function directives(file: string, text: string): Directive[] {
  const out: Directive[] = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const seen = new Map<number, string>();
  const collect = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const r of ranges ?? []) seen.set(r.pos, text.slice(r.pos, r.end));
  };
  const visit = (node: ts.Node): void => {
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, node.getEnd()));
    ts.forEachChild(node, visit);
  };
  visit(source);
  collect(ts.getLeadingCommentRanges(text, source.endOfFileToken.getFullStart()));
  for (const [, raw] of [...seen.entries()].sort((a, b) => a[0] - b[0])) {
    const body = raw.replace(/^\/\/|^\/\*|\*\/$/g, '').trim();
    const m = /^(eslint-disable-next-line|eslint-disable-line|eslint-disable|eslint-enable)\b\s*([\s\S]*)$/.exec(body);
    if (m === null) continue;
    const [head, reason = ''] = (m[2] ?? '').split(/\s--\s/);
    const rules = (head ?? '').split(',').map((r) => r.trim()).filter(Boolean);
    out.push({ file, kind: m[1] as Directive['kind'], rules, reason: reason.trim() });
  }
  return out;
}

/** The two exemptions DF-1 b rules, by file and reason. */
export const EXPECTED_EXEMPTIONS: readonly { file: string; reason: string }[] = [
  { file: 'apps/ward-console/src/main.ts', reason: "OPENBED-CLOCK-READ: R-2026-09-26-130 DF-1 b, the device's composed_at for 014's symmetric STALE/FUTURE_MUTATION window (the v2 kickoff's Stage 2)" },
  { file: 'packages/snapshot/src/serve.ts', reason: "OPENBED-CLOCK-READ: R-2026-09-23-67 A3, the Function's serve-time stamp, the one wall-clock read on the server" },
];

export function exemptionViolations(files: readonly { path: string; text: string }[], expected = EXPECTED_EXEMPTIONS): string[] {
  const out: string[] = [];
  const found: { file: string; reason: string }[] = [];
  for (const f of files) {
    for (const d of directives(f.path, f.text)) {
      const touches = d.rules.length === 0 || d.rules.includes(RULE);
      if (!touches) continue;
      if (d.kind === 'eslint-enable') continue;
      if (d.kind !== 'eslint-disable-next-line') {
        out.push(`${f.path}: a ${d.kind === 'eslint-disable' ? 'file- or block-wide eslint-disable' : 'eslint-disable-line'} ${d.rules.length === 0 ? 'naming no rule' : `of ${RULE}`}: only eslint-disable-next-line with a named reason is allowed`);
        continue;
      }
      if (d.rules.length !== 1 || d.rules[0] !== RULE) {
        out.push(`${f.path}: a disable naming ${d.rules.length === 0 ? 'no rule (so every rule)' : d.rules.join(', ')}: an exemption names ${RULE} and nothing else`);
        continue;
      }
      if (!d.reason.startsWith('OPENBED-CLOCK-READ:') || !/R-\d{4}-\d{2}-\d{2}-\d+/.test(d.reason)) {
        out.push(`${f.path}: an exemption without the OPENBED-CLOCK-READ marker and a ruling id: "${d.reason}"`);
        continue;
      }
      found.push({ file: f.path, reason: d.reason });
    }
  }
  const key = (e: { file: string; reason: string }): string => `${e.file} :: ${e.reason}`;
  const want = new Set(expected.map(key));
  const have = new Set(found.map(key));
  for (const k of have) if (!want.has(k)) out.push(`an exemption that is not one of the two DF-1 b rules: ${k}`);
  for (const k of want) if (!have.has(k)) out.push(`a ruled exemption is missing or its reason changed: ${k}`);
  if (found.length !== have.size) out.push('the same exemption appears twice');
  return out;
}

async function lintedScope(): Promise<ESLint.LintResult[]> {
  return eslint.lintFiles(SCOPE);
}

describe('F3 — no device clock in the display path (openbed/no-wall-clock)', () => {
  test.each([
    ['Date.now() in an age', 'export const age = (u: string): number => Date.now() - Date.parse(u);\n'],
    ['a no-argument new Date() and getTime', 'export const age = (t: number): number => new Date().getTime() - t;\n'],
    ['the coercion form', 'export const age = (u: string): number => +new Date() - +new Date(u);\n'],
    ['performance.timeOrigin recombined into wall-clock', 'export const now = (): number => performance.timeOrigin + performance.now();\n'],
    ['globalThis.performance.timeOrigin', 'export const origin = (): number => globalThis.performance.timeOrigin;\n'],
    ['Date.UTC', 'export const t = (): number => Date.UTC(2026, 0, 1);\n'],
  ])('plant — %s is rejected', async (_name, code) => {
    const out = await hits(code);
    expect(out.length, `the F3 shape was accepted: ${JSON.stringify(out)}`).toBeGreaterThan(0);
    expect(out[0]?.severity, 'the rule is not an error').toBe(2);
  });

  test.each([
    ['formatting a stated instant', "export const shown = (row: { updated_at: string }): string => new Date(row.updated_at).toLocaleString('en-NG');\n"],
    ['Date.parse', 'export const at = (u: string): number => Date.parse(u);\n'],
    ['performance.now for elapsed time', 'export const elapsed = (m: number): number => performance.now() - m;\n'],
  ])('positive control — %s is accepted', async (_name, code) => {
    const out = await hits(code);
    expect(out, JSON.stringify(out)).toEqual([]);
  });

  test('real scope is accepted — every app and packages/snapshot/src lint with no hit, freshness.ts among them', async () => {
    const results = await lintedScope();
    const paths = results.map((r) => relative(REPO_ROOT, r.filePath));
    expect(results.length, 'no files linted — the guard is vacuous').toBeGreaterThan(5);
    expect(paths).toContain('packages/snapshot/src/freshness.ts');
    expect(paths).toContain('packages/snapshot/src/serve.ts');
    expect(paths).toContain('apps/ward-console/src/main.ts');
    const found = results.flatMap((r) => r.messages.filter((m) => m.ruleId === RULE).map((m) => `${relative(REPO_ROOT, r.filePath)}:${m.line} ${m.message}`));
    expect(found, found.join('\n')).toEqual([]);
  });

  test('anti-vacuity — a tree with no TypeScript lints nothing, so an empty file list is not a pass', async () => {
    // Managed by hand around the await: _scratch.ts's withScratch is synchronous, and
    // would remove the tree before an async lint ran -- a zero from a tree that no longer
    // exists, which is the vacuous pass this leg exists to rule out.
    const root = mkdtempSync(join(tmpdir(), 'openbed-plant-'));
    try {
      place(root, 'apps/x/README.md', '# nothing to lint\n');
      place(root, 'apps/x/src/control.ts', 'export const x = new Date();\n');
      const scratch = new ESLint({ cwd: root, overrideConfigFile: join(REPO_ROOT, 'eslint.config.mjs'), errorOnUnmatchedPattern: false });
      const control = await scratch.lintFiles(SCOPE);
      expect(control.length, 'the scratch tree was not linted at all: the empty case below would prove nothing').toBe(1);
      expect(control[0]?.messages.some((m) => m.ruleId === RULE), 'the scratch lint does not run the rule').toBe(true);
      rmSync(join(root, 'apps', 'x', 'src'), { recursive: true, force: true });
      const results = await scratch.lintFiles(SCOPE);
      expect(results.length, JSON.stringify(results.map((r) => r.filePath))).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('DF-1 c — real exemptions are exactly the two ruled, by file and reason', async () => {
    const results = await lintedScope();
    const files = results.map((r) => ({ path: relative(REPO_ROOT, r.filePath), text: readFileSync(r.filePath, 'utf8') }));
    const out = exemptionViolations(files);
    expect(out, out.join('\n')).toEqual([]);
  });

  test.each([
    ['a third exemption', "// eslint-disable-next-line openbed/no-wall-clock -- OPENBED-CLOCK-READ: R-2026-09-26-130 DF-1 b, one more\nconst t = new Date();\n", 'an exemption that is not one of the two DF-1 b rules'],
    ['an exemption with no marker', '// eslint-disable-next-line openbed/no-wall-clock -- because I needed it\nconst t = new Date();\n', 'without the OPENBED-CLOCK-READ marker and a ruling id'],
    ['an exemption with the marker and no ruling id', '// eslint-disable-next-line openbed/no-wall-clock -- OPENBED-CLOCK-READ: trust me\nconst t = new Date();\n', 'without the OPENBED-CLOCK-READ marker and a ruling id'],
    ['a disable naming two rules', '// eslint-disable-next-line openbed/no-wall-clock, no-console -- OPENBED-CLOCK-READ: R-2026-09-26-130 DF-1 b\nconst t = new Date();\n', 'an exemption names openbed/no-wall-clock and nothing else'],
    ['a disable naming no rule', '// eslint-disable-next-line\nconst t = new Date();\n', 'naming no rule (so every rule)'],
    ['a file-wide disable', '/* eslint-disable openbed/no-wall-clock */\nconst t = new Date();\n', 'a file- or block-wide eslint-disable'],
    ['a file-wide disable of every rule', '/* eslint-disable */\nconst t = new Date();\n', 'a file- or block-wide eslint-disable naming no rule'],
    ['an eslint-disable-line', 'const t = new Date(); // eslint-disable-line openbed/no-wall-clock -- OPENBED-CLOCK-READ: R-2026-09-26-130 DF-1 b\n', 'eslint-disable-line'],
  ])('plant — %s is refused', (_name, text, message) => {
    const out = exemptionViolations([{ path: 'apps/public-dashboard/src/plant.ts', text }]);
    expect(out.join('\n')).toContain(message);
  });

  test('plant — a ruled exemption whose reason was edited is refused, and a string that looks like a directive is not one', () => {
    const edited = exemptionViolations([{ path: 'packages/snapshot/src/serve.ts', text: '// eslint-disable-next-line openbed/no-wall-clock -- OPENBED-CLOCK-READ: R-2026-09-23-67 A3, edited\nx;\n' }], [EXPECTED_EXEMPTIONS[1] as { file: string; reason: string }]);
    expect(edited.join('\n')).toContain('a ruled exemption is missing or its reason changed');
    expect(directives('a.ts', "const s = '// eslint-disable-next-line openbed/no-wall-clock';\n")).toEqual([]);
  });

  test('DF-1 d — CI lints these files: repo-lint runs eslint over the tree, and the rule is an error for each scoped file', async () => {
    const ci = yaml.load(readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')) as { jobs: Record<string, { steps: { run?: string }[] }> };
    const runs = (ci.jobs['repo-lint']?.steps ?? []).map((s) => s.run ?? '');
    expect(runs, 'repo-lint no longer runs ESLint over the whole tree').toContain('npx eslint .');
    for (const file of ['apps/public-dashboard/src/main.ts', 'apps/ward-console/src/main.ts', 'apps/admin/src/main.ts', 'packages/snapshot/src/serve.ts', 'packages/snapshot/src/freshness.ts']) {
      expect(await eslint.isPathIgnored(join(REPO_ROOT, file)), `${file} is ignored by ESLint`).toBe(false);
      const config = (await eslint.calculateConfigForFile(join(REPO_ROOT, file))) as { rules?: Record<string, unknown> };
      expect(config.rules?.[RULE], `${file} does not carry ${RULE}`).toEqual([2]);
    }
    const outside = (await eslint.calculateConfigForFile(join(REPO_ROOT, 'packages', 'gate', 'src', 'gate.ts'))) as { rules?: Record<string, unknown> };
    expect(outside.rules?.[RULE], 'the check cannot tell a scoped file from an unscoped one').toBeUndefined();
  });
});
