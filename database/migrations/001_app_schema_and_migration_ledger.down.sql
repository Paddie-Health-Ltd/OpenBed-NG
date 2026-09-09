-- ============================================================
-- 001_app_schema_and_migration_ledger.down.sql
-- ============================================================
-- Symmetric reversal of 001, in reverse creation order:
--   restore public defaults -> drop the ledger -> drop the schema.
--
-- WARNING, and it is the reason this file has a guard the others do not:
-- dropping schema `app` destroys every base table in the system. On a database
-- that has ever held real data this is not a rollback, it is a deletion. It is
-- written for a local development database and for CI, where the schema is
-- rebuilt from zero on every run.
--
-- The RESTRICT below is deliberate and load-bearing: it makes this file refuse
-- to run while any object still exists in `app`. Reversing 002..013 first is
-- therefore a precondition rather than a suggestion, and forgetting produces a
-- loud error rather than a silent cascade through thirteen migrations' worth of
-- tables.
-- ============================================================


-- ============================================================
-- 1. Restore the `public` default privileges 001 revoked.
-- ============================================================
-- Returns to the Postgres/Supabase default of EXECUTE for PUBLIC on new
-- functions. This is a genuine reversal, not a tidy-up: leaving the revocation
-- in place would mean 001 had a permanent effect that its own down migration did
-- not undo, and tests/db/down_migration_symmetry.test.ts asserts the pairing.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- CREATE on schema public is NOT re-granted. Postgres 15+ removed it from the
-- shipped default, so re-granting it would leave the database in a state 001
-- never found it in -- a reversal that overshoots is still a drift.


-- ============================================================
-- 2. Drop the default-privilege revocations on `app`.
-- ============================================================
-- These must be undone before the schema is dropped, or they persist as
-- orphaned entries in pg_default_acl keyed to a schema that no longer exists.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON TABLES TO anon';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON SEQUENCES TO anon';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON FUNCTIONS TO anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON TABLES TO authenticated';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON SEQUENCES TO authenticated';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT ALL ON FUNCTIONS TO authenticated';
    END IF;
EXCEPTION
    WHEN undefined_object THEN
        -- Schema already gone: nothing to un-revoke. Reversal is still complete.
        NULL;
END $$;


-- ============================================================
-- 3. Drop the ledger, then the schema.
-- ============================================================
DROP TABLE IF EXISTS app.schema_migrations;

-- RESTRICT, not CASCADE. See the header.
DROP SCHEMA IF EXISTS app RESTRICT;
