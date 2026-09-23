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
 * local-credential patterns.
 *
 * IT IS NO LONGER THE ONLY FILE PERMITTED TO CONTAIN A JWT, and that sentence used
 * to say it was. Since R-2026-09-22-61 the local ANON key lives in
 * packages/origins/publishable-keys.json, because the ward console needs it too and
 * two literals of one value can be edited apart and drift while both stay green
 * (test-conventions section 7). It is IMPORTED below rather than restated here.
 * That file's allowlist entry covers the JWT pattern ONLY -- a Supabase secret key
 * is still refused there by the scan itself.
 *
 * WHAT DID NOT MOVE IS THE SERVICE-ROLE KEY. It is a service credential and must
 * never enter a package that browser code imports. If the scan flags a key anywhere
 * other than these two files, that key is real.
 */
import { LOCAL_PUBLISHABLE_KEY } from '@openbed/origins/keys';

export const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const LOCAL_API_URL = 'http://127.0.0.1:54321';

/** Re-exported, never restated: packages/origins/publishable-keys.json is the one site. */
export const LOCAL_ANON_KEY = LOCAL_PUBLISHABLE_KEY;

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
