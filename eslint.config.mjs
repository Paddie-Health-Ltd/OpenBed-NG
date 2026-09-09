import tseslint from 'typescript-eslint';

/**
 * FINDING F2, TYPESCRIPT SIDE.
 *
 * The `no-restricted-syntax` block below is the highest-value rule in this
 * config and the reason the file exists. A duty flag has THREE states, and the
 * natural shape --
 *
 *     if (!facility.anaesthetist) closed = true;
 *
 * -- looks like clean code and renders EVERY HOSPITAL IN LAGOS AS CLOSED on day
 * one, when no facility has touched the flag and every value is 'UNKNOWN'.
 *
 * Its SQL twin is worse: `not anaesthetist` on a NULL evaluates to NULL, which
 * is not TRUE, so the row silently drops out of a filtered query while the
 * JavaScript reports it truthy. The two layers disagree and neither errors.
 * scripts/lint_sql_no_bare_not_duty_flag.sh guards that side.
 *
 * This rule is LIVE, not aspirational: packages/gate/src/gate.ts and
 * apps/public-dashboard/src/main.ts both call the gate with duty flags today, so
 * the rule has real call sites to protect from commit one.
 * tests/compliance/eslint_duty_flag_negation.test.ts plants each banned form and
 * asserts ESLint rejects it -- and asserts the real source is accepted, because a
 * rule that rejects everything is a rubber stamp.
 */

const DUTY_FLAG = 'anaesthetist|obstetrician|paediatrician';

const dutyFlagRules = [
  {
    // !anaesthetist  /  !flags.anaesthetist  /  !ops.paediatrician
    selector: `UnaryExpression[operator='!'] Identifier[name=/${DUTY_FLAG}/i]`,
    message:
      'Duty flags are three-state (UNKNOWN | YES | NO), not booleans. `!flag` treats the ' +
      'day-one UNKNOWN as closed and renders every hospital as unavailable. Compare explicitly: ' +
      "flag === 'NO'.",
  },
  {
    // anaesthetist === false  /  flags.obstetrician == false  /  false === flag
    selector:
      `BinaryExpression[operator=/^[!=]==?$/][right.value=false] Identifier[name=/${DUTY_FLAG}/i], ` +
      `BinaryExpression[operator=/^[!=]==?$/][left.value=false] Identifier[name=/${DUTY_FLAG}/i]`,
    message:
      "Duty flags are three-state, so `=== false` is never meaningful. Compare to 'NO', 'YES' " +
      "or 'UNKNOWN' explicitly.",
  },
  {
    // Boolean(anaesthetist) — the same falsy coercion wearing a function call.
    selector: `CallExpression[callee.name='Boolean'] Identifier[name=/${DUTY_FLAG}/i]`,
    message:
      'Coercing a three-state duty flag to boolean loses the distinction between UNKNOWN and NO, ' +
      'which is the whole of finding F2.',
  },
];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.next/**', 'packages/fixtures/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mts', '**/*.mjs'],
    rules: {
      'no-restricted-syntax': ['error', ...dutyFlagRules],
    },
  },
  {
    // Tests deliberately construct the wrong shapes in order to assert they are
    // rejected. Exempting them is necessary; exempting anything else is not.
    files: ['tests/**/*.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
