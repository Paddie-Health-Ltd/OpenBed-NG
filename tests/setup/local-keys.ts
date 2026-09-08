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
