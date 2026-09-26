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

/**
 * FINDING F3, THE DISPLAY PATH'S CLOCK (R-2026-09-21-38 D1; built by PR F, R-2026-09-26-130
 * DF-1). Specified in `Sprint Kickoffs/sprint-kickoff-bedspace-v2-2026-09-10.md` ("The F3
 * guard, specified to implement") and unbuilt until PR F.
 *
 * A device clock is wrong on a real handset -- hours off, a year off, set by hand -- and a
 * freshness age computed from it lies in exactly the direction that sends a crew to a
 * ward whose count is stale. Every age on the page is `served_at - updated_at + elapsed`
 * (packages/snapshot/src/anchor.ts): the Function's serve time, the ward's own report time,
 * and monotonic time since the fetch. So in the scope below this rule refuses the four
 * ways to read wall-clock time: Date.now, Date.UTC, performance.timeOrigin (a monotonic
 * source recombined into wall-clock -- the sneaky one), and `new Date()` with no arguments.
 * `new Date(isoString)`, Date.parse and performance.now stay legal: formatting a stated
 * instant, and measuring elapsed time, read no clock.
 *
 * ITS OWN RULE ID, deliberately. Flat config replaces a rule's options per block rather
 * than merging them, so a second `no-restricted-syntax` block would silently drop F2's
 * selectors above, and a line exemption naming `no-restricted-syntax` would switch F2 off
 * on that line too. `openbed/no-wall-clock` is exempted, and disabled, alone.
 *
 * EXACTLY TWO CALL SITES ARE EXEMPT (DF-1 b), each with
 * `eslint-disable-next-line openbed/no-wall-clock -- OPENBED-CLOCK-READ: <ruling>`:
 * the Function's serve-time stamp in packages/snapshot/src/serve.ts, and the ward
 * console's p_composed_at in apps/ward-console/src/main.ts. Both are deliberate clock
 * reads, ruled after the spec was written. tests/compliance/eslint_wall_clock.test.ts pins
 * that set by file and reason, and refuses any other disable of this rule in scope.
 */
const noWallClock = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const name = (node) => (node.type === 'Identifier' ? node.name : node.type === 'Literal' ? String(node.value) : null);
    const isPerformance = (node) =>
      (node.type === 'Identifier' && node.name === 'performance') ||
      (node.type === 'MemberExpression' && name(node.property) === 'performance' &&
        node.object.type === 'Identifier' && ['globalThis', 'window', 'self'].includes(node.object.name));
    return {
      MemberExpression(node) {
        const prop = name(node.property);
        if (node.object.type === 'Identifier' && node.object.name === 'Date' && (prop === 'now' || prop === 'UTC')) {
          context.report({ node, message: `Date.${prop} reads the device clock (F3). Ages come from served_at - updated_at + elapsed; see packages/snapshot/src/anchor.ts.` });
        }
        if (prop === 'timeOrigin' && isPerformance(node.object)) {
          context.report({ node, message: 'performance.timeOrigin turns a monotonic clock back into wall-clock time (F3). Use performance.now() for elapsed time only.' });
        }
      },
      NewExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'Date' && node.arguments.length === 0) {
          context.report({ node, message: 'new Date() with no argument reads the device clock (F3). new Date(isoString) formats a stated instant and is fine.' });
        }
      },
    };
  },
};

export default tseslint.config(
  {
    // GENERATED AND TOOL-STATE DIRECTORIES. Linting them lints esbuild, wrangler or
    // the Supabase CLI, not this repository.
    //
    // EVERY DIRECTORY `.gitignore` EXCLUDES BELONGS HERE, and that is asserted rather
    // than remembered: tests/compliance/eslint_ignores_cover_gitignore.test.ts derives
    // the list from `.gitignore` itself and reds when the two come apart.
    //
    // WHY THE GUARD EXISTS (R-2026-09-21-49). `.wrangler/` and `.functions-build/` sit
    // on adjacent lines of `.gitignore` under one comment ending "Both generated, never
    // committed." Only the second was carried across to this array. The result was 67
    // ESLint errors inside a wrangler build artefact -- invisible in CI, because
    // `repo-lint` never builds, and therefore surviving for as long as nobody ran a
    // build and a lint on the same machine. Four of the eight directory entries were
    // uncovered when it was finally measured, not one.
    //
    // `packages/fixtures/**` is NOT gitignored and is ignored here deliberately: it is
    // checked-in JSON fixtures, not code. The guard runs in one direction only --
    // gitignored directories must appear here -- so it does not object.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/.functions-build/**',
      '**/.wrangler/**',
      '**/coverage/**',
      'supabase/.branches/**',
      'supabase/.temp/**',
      'packages/fixtures/**',
      '**/.design-screens/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.mts', '**/*.mjs'],
    rules: {
      'no-restricted-syntax': ['error', ...dutyFlagRules],
    },
  },
  {
    // F3 (above): the spec's scope, exactly (DF-1 a).
    files: ['apps/**/*.ts', 'apps/**/*.tsx', 'packages/snapshot/src/**/*.ts'],
    plugins: { openbed: { rules: { 'no-wall-clock': noWallClock } } },
    rules: {
      'openbed/no-wall-clock': 'error',
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
