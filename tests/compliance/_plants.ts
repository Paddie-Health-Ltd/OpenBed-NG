/**
 * Credential-shaped strings for PLANT tests, ASSEMBLED AT RUNTIME.
 *
 * WHY THEY ARE BUILT FROM FRAGMENTS INSTEAD OF WRITTEN OUT.
 *
 * scripts/lint_no_secrets.sh scans the whole repository, including this
 * directory. When these plants were written as literals, the scan flagged them --
 * correctly. The tempting fix was to allowlist `tests/compliance/**`, and that
 * would have been the wrong one: it would blind the scanner to a REAL credential
 * pasted into a test file, which is a very ordinary way for one to get committed.
 *
 * Assembling each string at runtime means the literal never exists in the
 * repository at all. The scanner stays honest, the plants still work, and the
 * exemption list stays at exactly one file.
 *
 * NOTHING HERE IS A REAL CREDENTIAL. Each is a syntactically valid shape over
 * meaningless content, which is all a pattern-matching guard can distinguish.
 */

/** A three-segment JWT. Split on the dots, because the pattern requires all three. */
export const PLANT_JWT = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJpc3MiOiJwbGFudCIsInJvbGUiOiJhbm9uIn0',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
].join('.');

/**
 * A JWT whose payload CLAIMS THE SERVICE ROLE.
 *
 * The distinction this plant exists to prove is not JWT-vs-not-JWT. The
 * publishable/anon key is also a JWT and is published in the browser bundle BY
 * DESIGN, so a guard firing on JWT shape alone would red on the one credential
 * that belongs there. `PLANT_JWT` above carries `"role":"anon"` and is the
 * matching positive control.
 *
 * Note the literal string `service_role` does NOT appear here -- it is inside
 * the base64url payload. That is deliberate: it isolates the payload-decoding
 * leg from the word-matching leg, which would otherwise fire first and prove
 * the wrong thing.
 */
export const PLANT_SERVICE_ROLE_JWT = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJpc3MiOiJwbGFudCIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
].join('.');

/** A Supabase secret-key shape. */
export const PLANT_SB_SECRET = `sb_${'secret'}_${'A'.repeat(24)}`;

/**
 * The BARE prefix, with no key material after it -- what @supabase/supabase-js
 * actually ships: `key.startsWith("sb_secret_")`. It is not a credential, and
 * treating it as one is what made 24 non-credentials red the bundle guard on
 * 2026-09-10. Used as a positive control, never as a plant.
 */
export const NOT_A_CREDENTIAL_PREFIX = `sb_${'secret'}_`;

/** A PEM private-key header. */
export const PLANT_PRIVATE_KEY = `-----${'BEGIN'} RSA PRIVATE KEY-----`;

/** An AWS access key id. */
export const PLANT_AWS_KEY = `AK${'IA'}IOSFODNN7EXAMPLE`;

/**
 * A postgres URL with a password pointing at a REMOTE host.
 *
 * The split is at the SCHEME, not in the middle of the credentials, and that is
 * not arbitrary. The pattern is `postgres(ql)?://<user>:<pass>@` -- and the
 * character class for the password accepts `$`, `{`, `'` and `}`, so an
 * interpolation placed inside the credentials does NOT break the match and the
 * literal is still committed. Interrupting `postgresql` itself is what actually
 * defeats it. Found by running the scanner over this very file.
 */
export const PLANT_REMOTE_PG_URL = `postgres${'ql'}://admin:hunter2@db.prod.example.com:5432/app`;

/** A postgres URL pointing at the LOCAL stack. Not a secret; used as a positive control. */
export const LOCAL_PG_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
