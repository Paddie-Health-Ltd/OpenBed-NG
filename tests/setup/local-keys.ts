/**
 * Well-known LOCAL Supabase keys.
 *
 * THESE ARE NOT SECRETS AND COMMITTING THEM IS DELIBERATE. Every `supabase
 * start` on every machine in the world mints exactly these, from the published
 * demo JWT secret ("super-secret-jwt-token-with-at-least-32-characters-long").
 * They authenticate against 127.0.0.1 and nothing else.
 *
 * Having the real anon key checked in is what lets the RLS negative suite make
 * a genuine anonymous HTTP request through PostgREST -- the same shape of
 * request a browser makes -- rather than a hand-forged token that proves less.
 *
 * scripts/lint_no_secrets.sh allowlists this file BY PATH, and only for the
 * local-credential patterns. It is the only file in the repository permitted to
 * contain a JWT. If the scan flags a key anywhere else, that key is real.
 */

export const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const LOCAL_API_URL = 'http://127.0.0.1:54321';

export const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export const LOCAL_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export const dbUrl = (): string => process.env['DATABASE_URL'] ?? LOCAL_DB_URL;
export const apiUrl = (): string => process.env['SUPABASE_API_URL'] ?? LOCAL_API_URL;
export const anonKey = (): string => process.env['SUPABASE_ANON_KEY'] ?? LOCAL_ANON_KEY;

/**
 * The service-role key, for the ONE thing that needs it: minting a magic link
 * through the GoTrue admin API in tests/setup/auth.ts.
 *
 * The constant above it has been exported since this file was written and had no
 * accessor, so it was the only credential here with no env override -- meaning a
 * CI run pointed at a different stack would have silently used the local one.
 *
 * This is test-harness code and is never bundled. scripts/lint_no_service_role_in_bundle.sh
 * scans the built output under apps -- dist and .next -- only, which is the corpus
 * that matters: the key must never reach a browser. Nothing under tests/ ships.
 */
export const serviceRoleKey = (): string =>
  process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? LOCAL_SERVICE_ROLE_KEY;
