/**
 * Types for `eslint.config.mjs`, so it can be imported by a test rather than
 * re-parsed from source.
 *
 * WHY THIS FILE EXISTS. `tests/compliance/eslint_ignores_cover_gitignore.test.ts`
 * asserts that every directory `.gitignore` excludes is also excluded by ESLint.
 * The alternative to importing the config is regexing the `ignores` array out of
 * the source, which would assert against a pattern of the file's TEXT rather than
 * against the value ESLint actually receives -- test-conventions section 3's
 * "assert on parsed identity, never on a count of matching lines", one level up.
 *
 * DELIBERATELY NARROW. Only `ignores` is declared, because only `ignores` is read.
 * A wider declaration would be a claim about the flat-config shape that this
 * repository has no reason to make and would have to maintain.
 */
declare const config: { ignores?: string[] }[];
export default config;
