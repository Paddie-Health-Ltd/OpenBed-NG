import { describe, expect, test } from 'vitest';
import { ESLint } from 'eslint';
import { REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER A GUARD -- the `no-restricted-syntax` duty-flag rule in
 * eslint.config.mjs. FINDING F2, TYPESCRIPT SIDE.
 *
 * Run through ESLint's Node API rather than the CLI, so the plants never touch
 * the working tree. `lintText` with a `filePath` inside the project makes the
 * flat config resolve exactly as it would for a real file.
 *
 * This rule is LIVE, not ahead-of-subject: packages/gate/src/gate.ts and
 * apps/public-dashboard/src/main.ts both pass duty flags today.
 */

const eslint = new ESLint({ cwd: REPO_ROOT });
const AS_IF_IN = 'packages/gate/src/__plant__.ts';

async function restrictedSyntaxHits(code: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath: AS_IF_IN });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax').length;
}

describe('eslint duty-flag rule', () => {
  test.each([
    ['bare negation of a property', 'declare const facility: { anaesthetist: string };\nexport const c = !facility.anaesthetist;\n'],
    ['bare negation of an identifier', 'declare const anaesthetist: string;\nexport const c = !anaesthetist;\n'],
    ['=== false', 'declare const anaesthetist: unknown;\nexport const c = anaesthetist === false;\n'],
    ['== false', 'declare const obstetrician: unknown;\nexport const c = obstetrician == false;\n'],
    ['false === flag (reversed operands)', 'declare const paediatrician: unknown;\nexport const c = false === paediatrician;\n'],
    ['Boolean() coercion', 'declare const paediatrician: unknown;\nexport const c = Boolean(paediatrician);\n'],
    ['camelCase property', 'declare const o: { anaesthetistOnDuty: boolean };\nexport const c = !o.anaesthetistOnDuty;\n'],
  ])('plant — %s is rejected', async (_name, code) => {
    expect(await restrictedSyntaxHits(code), 'the F2 shape was accepted').toBeGreaterThan(0);
  });

  test.each([
    ['explicit comparison to NO', "declare const anaesthetist: string;\nexport const c = anaesthetist === 'NO';\n"],
    ['explicit comparison to UNKNOWN', "declare const paediatrician: string;\nexport const c = paediatrician !== 'UNKNOWN';\n"],
    ['negation of an unrelated identifier', 'declare const loading: boolean;\nexport const c = !loading;\n'],
  ])('positive control — %s is accepted', async (_name, code) => {
    // A rule that rejects everything is a rubber stamp. These are the forms the
    // codebase actually uses, and they must remain writable.
    expect(await restrictedSyntaxHits(code), 'a correct form was rejected').toBe(0);
  });

  test('the real source tree passes the rule', async () => {
    const results = await eslint.lintFiles([
      'packages/gate/src/**/*.ts',
      'apps/public-dashboard/src/**/*.ts',
    ]);
    expect(results.length, 'no files linted — the guard is vacuous').toBeGreaterThan(0);
    const hits = results.flatMap((r) => r.messages).filter((m) => m.ruleId === 'no-restricted-syntax');
    expect(hits.map((m) => m.message), 'real source violates the duty-flag rule').toEqual([]);
  });

  test('the rule is configured at error severity, not warn', async () => {
    // A warning does not fail a build, so a rule configured at `warn` is not a
    // gate at all -- it is a comment that shows up in a log nobody reads.
    const [result] = await eslint.lintText(
      'declare const anaesthetist: string;\nexport const c = !anaesthetist;\n',
      { filePath: AS_IF_IN },
    );
    const msg = (result?.messages ?? []).find((m) => m.ruleId === 'no-restricted-syntax');
    expect(msg?.severity, 'the duty-flag rule is not at error severity').toBe(2);
  });
});
