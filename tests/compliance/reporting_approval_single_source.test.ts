import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE FOUR STATES ARE DERIVED IN SQL, ONCE, AND NO TYPESCRIPT REIMPLEMENTS THEM
 * (migration 029; R-2026-09-30-201 GA; ruling FX P2; the design report's section 7, and -71 C and
 * BP-6 4 as the ruling cites them: the gates have one implementation, in SQL).
 *
 * public.operator_register() compares the logins that are active against the LATEST approval and
 * returns one of four strings, or JSON null. The admin app READS that string and picks a sentence
 * for it. If the page also compared the two models itself, there would be two derivation sites for
 * one rule, and they could drift while both stayed green: the page saying MATCHES where the database
 * says MISMATCH, which tells the operator the logins are what management approved when they are not.
 *
 * Two legs:
 *   1. In the admin app's source, no line compares reportingModel with approvedModel, and no line
 *      PRODUCES one of the four state strings (a return, an assignment, a ternary arm, an object
 *      value). READING one (a case, a comparison of the state to a literal, the type union) is fine,
 *      and is what the page does.
 *   2. In migration 029, the state CASE exists once: each of its four result strings is produced by
 *      exactly one line of code.
 *
 * Each leg has a PLANT, an ACCEPT (the real artefact) and an ANTI-VACUITY leg. The plants of leg 1
 * are fed through a tracked file this change does not touch, so the checker is shown to bite on
 * text it was not written beside.
 *
 * CLASSIFICATION (Clause 5): LIVE. Both the admin source and migration 029 exist now.
 *
 * NOT ASSERTED HERE, deliberately: a comparison made through an intermediate variable
 * (`const a = f.approvedModel; a === f.reportingModel`). The check reads each line for the two
 * models as the operands of one comparison; following a value through a binding would need a
 * parser, and the review that reads this diff is the control for it.
 * NOT ASSERTED HERE, deliberately: that the SQL CASE is right. That is
 * tests/db/reporting_approval.test.ts, which reads each state from the live database. This file
 * asserts only WHERE the rule lives.
 */

const STATES = ['NOT_YET_PROVISIONED', 'APPROVAL_NOT_RECORDED', 'MATCHES', 'MISMATCH'] as const;

interface Source {
  file: string;
  text: string;
}

const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');

/** The checks of leg 1, over TypeScript sources. */
function tsViolations(sources: Source[]): string[] {
  if (sources.length === 0) return ['no source was read, so nothing was checked'];
  const out: string[] = [];
  // The two models as the OPERANDS of one comparison, in either order. A line that merely holds both
  // (a null test on one, an index by the other) is not a comparison of them.
  const compare = /\b(?:\w+\.)*reportingModel\s*[!=]==?\s*(?:\w+\.)*approvedModel\b|\b(?:\w+\.)*approvedModel\s*[!=]==?\s*(?:\w+\.)*reportingModel\b/;
  // A state string PRODUCED: returned, assigned (not a comparison), a ternary arm, or an object value.
  const state = STATES.join('|');
  const produced = new RegExp(`(?:\\breturn\\s+|(?<![=!<>])=\\s*|\\?\\s*|(?<!case\\s):\\s*)['"\`](?:${state})['"\`]`);
  for (const { file, text } of sources) {
    stripComments(text).split('\n').forEach((line, i) => {
      // A one-line `type` alias declares the four strings; it produces no value.
      if (/^\s*(?:export\s+)?type\s/.test(line)) return;
      if (compare.test(line)) out.push(`${file}:${i + 1}: compares reportingModel with approvedModel`);
      if (produced.test(line)) out.push(`${file}:${i + 1}: produces a reporting approval state`);
    });
  }
  return out;
}

const ADMIN_SRC = join(REPO_ROOT, 'apps', 'admin', 'src');
const adminSources = (): Source[] =>
  readdirSync(ADMIN_SRC)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ file: `apps/admin/src/${f}`, text: readFileSync(join(ADMIN_SRC, f), 'utf8') }));

/** Leg 2: how many lines of code in migration 029's forward file produce each state string. */
function sqlProducers(migration: string): Record<string, number> {
  const code = migration
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const counts: Record<string, number> = {};
  for (const s of STATES) counts[s] = code.split('\n').filter((l) => new RegExp(`THEN '${s}'|ELSE '${s}'`).test(l)).length;
  return counts;
}

const MIGRATION_029 = join(REPO_ROOT, 'database', 'migrations', '029_facility_reporting_approval.sql');

describe('the four reporting approval states have one derivation site: the database', () => {
  test('real admin source is accepted: it reads the state and never produces it', () => {
    const v = tsViolations(adminSources());
    expect(v, v.join('\n')).toEqual([]);
  });

  test('the checker is looking at the right files: the admin app reads the state, so the guard has something to be wrong about', () => {
    const all = adminSources();
    expect(all.map((s) => s.file)).toEqual(expect.arrayContaining(['apps/admin/src/main.ts', 'apps/admin/src/parse.ts', 'apps/admin/src/bodies.ts']));
    expect(all.find((s) => s.file.endsWith('main.ts'))?.text, 'main.ts does not read reportingApprovalState').toContain('reportingApprovalState');
    expect(all.find((s) => s.file.endsWith('parse.ts'))?.text, 'parse.ts does not name a state').toContain("'MISMATCH'");
  });

  // The plants append a line to a tracked file this change does not edit, then run the checker.
  const OFF_DIFF = 'apps/ward-console/src/publish.ts';
  const plantOnto = (line: string): Source[] => [{ file: OFF_DIFF, text: `${readFileSync(join(REPO_ROOT, OFF_DIFF), 'utf8')}\n${line}\n` }];

  test.each([
    ['a comparison of the two models', 'const same = f.reportingModel === f.approvedModel;', 'compares reportingModel with approvedModel'],
    ['a comparison in the other order, negated', 'if (f.approvedModel !== f.reportingModel) warn();', 'compares reportingModel with approvedModel'],
    ['a state returned', "function s(): string { return 'MATCHES'; }", 'produces a reporting approval state'],
    ['a state assigned', "let s = 'MISMATCH';", 'produces a reporting approval state'],
    ['a state as a ternary arm', "const s = ok ? 'NOT_YET_PROVISIONED' : 'APPROVAL_NOT_RECORDED';", 'produces a reporting approval state'],
    ['a state as an object value', "const o = { state: 'MATCHES' };", 'produces a reporting approval state'],
    ['a state in double quotes', 'const s = ok ? "MISMATCH" : null;', 'produces a reporting approval state'],
  ])('plant — %s is rejected', (_name, line, message) => {
    const v = tsViolations(plantOnto(line));
    expect(v.join('\n'), `the plant was accepted: ${JSON.stringify(v)}`).toContain(message);
  });

  test.each([
    ['a case label', "case 'MATCHES':"],
    ['a comparison of the state to a literal', "const needsAction = f.reportingApprovalState === 'MISMATCH';"],
    ['a negated comparison of the state to a literal', "if (f.reportingApprovalState !== 'APPROVAL_NOT_RECORDED') ok();"],
    ['a type union', "type S = 'NOT_YET_PROVISIONED' | 'MATCHES';"],
    ['a comparison against a literal model, on a line that does not mention the other model', "const w = f.approvedModel === 'WARD';"],
    // THE REAL SHAPE of the page's own sentence-picking line: a null test on one model and an index by the other.
    ['both models on one line, with no comparison between them', "const words = { A: f.approvedModel === null ? '' : W[f.approvedModel], B: W[f.reportingModel] };"],
    ['a comment that talks about the rule', "// a MATCHES here would be wrong: return 'MATCHES' is the database's job, and f.reportingModel === f.approvedModel too."],
  ])('positive control — %s is accepted: the most ordinary valid input, so the guard is not loosened at 2am', (_name, line) => {
    expect(tsViolations(plantOnto(line)), `the guard refused ordinary code: ${line}`).toEqual([]);
  });

  test('anti-vacuity — a corpus with no source fails, and names itself', () => {
    expect(tsViolations([])).toEqual(['no source was read, so nothing was checked']);
  });

  test('migration 029 produces each of the four states on exactly one line of code', () => {
    expect(sqlProducers(readFileSync(MIGRATION_029, 'utf8'))).toEqual({ NOT_YET_PROVISIONED: 1, APPROVAL_NOT_RECORDED: 1, MATCHES: 1, MISMATCH: 1 });
  });

  test('plant — a second copy of the state CASE in the migration is counted, so the rule could not be derived twice unseen', () => {
    const real = readFileSync(MIGRATION_029, 'utf8');
    const planted = `${real}\nSELECT CASE WHEN a THEN 'MATCHES' ELSE 'MISMATCH' END;\n`;
    expect(planted).not.toBe(real);
    const counts = sqlProducers(planted);
    expect(counts['MATCHES']).toBe(2);
    expect(counts['MISMATCH']).toBe(2);
  });

  test('plant — a state string in a COMMENT of the migration is not counted as a producer', () => {
    const real = readFileSync(MIGRATION_029, 'utf8');
    const planted = `${real}\n-- THEN 'MATCHES' and ELSE 'MISMATCH' are the arms.\n`;
    expect(sqlProducers(planted)).toEqual({ NOT_YET_PROVISIONED: 1, APPROVAL_NOT_RECORDED: 1, MATCHES: 1, MISMATCH: 1 });
  });

  test('anti-vacuity — an empty migration produces nothing, which is what the exact-one assertion refuses', () => {
    expect(sqlProducers('')).toEqual({ NOT_YET_PROVISIONED: 0, APPROVAL_NOT_RECORDED: 0, MATCHES: 0, MISMATCH: 0 });
  });
});
