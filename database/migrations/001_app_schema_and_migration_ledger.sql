-- ============================================================
-- 001_app_schema_and_migration_ledger.sql
-- ============================================================
-- Sprint 1, Bundle 1 -- the security boundary. Kickoff finding A3:
-- "RLS is not the boundary. Physical separation is."
--
-- Empirical state at base: EMPTY DATABASE. This is the first migration in a
-- greenfield project; the only pre-existing objects are those a fresh Supabase
-- project ships with (the `public` schema, and the `anon`, `authenticated`,
-- `service_role` and `postgres` roles).
--
-- WHY THIS FILE IS FIRST, AND WHY THAT IS NOT COSMETIC.
--   Every REVOKE below is a *wall*, and a wall built after the building is a
--   wall with a hole in it. If a table were created before the default
--   privileges were revoked, that table would carry whatever grants the cloud
--   default hands out, and nothing later in the sequence re-derives it. 013
--   re-asserts the whole set as a sweep, but a sweep is a second line -- this
--   ordering is the first.
--
-- Empirical anchors:
--   - supabase/config.toml [api] schemas = ["public", "graphql_public"].
--     `app` is absent from that list, so PostgREST cannot address anything in
--     this schema at any policy setting. THAT is the boundary. Everything in
--     this file is defence in depth behind it.
--   - supabase/config.toml [api] auto_expose_new_tables = true (the cloud
--     default, deliberately matched). It is why the revocations below are
--     written against `anon` explicitly and not assumed.
--
-- Idempotency: CREATE ... IF NOT EXISTS plus REVOKE/GRANT, which are naturally
-- idempotent. Re-apply is a no-op.
--
-- Deployment ordering gate: none. Nothing depends on this and it depends on
-- nothing. It is safe on a virgin database and safe to re-run.
--
-- Grant scope ledger (this migration creates no policies; it creates absences):
--   SCHEMA app         -- ALL revoked from anon, authenticated, PUBLIC
--   app DEFAULT PRIVS  -- ALL revoked on TABLES, SEQUENCES, FUNCTIONS
--                         from anon, authenticated, PUBLIC
--   SCHEMA public      -- CREATE revoked from PUBLIC
--   public DEFAULT PRIVS -- EXECUTE revoked on FUNCTIONS from PUBLIC *and* from
--                         anon, authenticated and service_role BY NAME (see
--                         section 4 -- revoking from PUBLIC alone does not
--                         remove Supabase's own by-name grants)
--   Total: 4 revocation groups. tests/db/config_drift.test.ts asserts all four.
--
-- KNOWN LIMIT, stated here so it is not mistaken for a guarantee (Clause 5):
--   ALTER DEFAULT PRIVILEGES applies only to objects created by the role that
--   runs it -- here, the migration role. A function created by `supabase_admin`
--   through the dashboard SQL editor is NOT covered by section 4 below, and
--   `supabase_admin` demonstrably carries its own by-name EXECUTE-to-anon default
--   ACL that this migration cannot revoke. The
--   default privilege is PREVENTION; the actual CONTROL is
--   tests/db/rls_rpc_execute_allowlist.test.ts, which enumerates every function
--   in `public` that is executable by PUBLIC or anon and asserts the set is
--   empty regardless of who created it.
-- ============================================================


-- ============================================================
-- 1. The private schema.
-- ============================================================
CREATE SCHEMA IF NOT EXISTS app;

COMMENT ON SCHEMA app IS
    'Private base tables. NOT in supabase/config.toml [api] schemas, therefore '
    'unreachable by PostgREST at any RLS policy setting. Nothing in here is ever '
    'read directly by a client: the public read path reads the projection tables '
    'in `public`, and authenticated clients go through capped SECURITY DEFINER '
    'RPCs. If you find yourself wanting to expose a table from this schema, the '
    'answer is a projection column or an RPC, never an entry in the exposed-schemas list.';


-- ============================================================
-- 2. The migration ledger.
-- ============================================================
-- Deliberately in `app`, not `public`. In `public` an anonymous client could
-- enumerate every migration filename over PostgREST -- a map of the schema, in a
-- repository that also explains what each migration does. scripts/run_migrations.sh
-- bootstraps and reads this table.
CREATE TABLE IF NOT EXISTS app.schema_migrations (
    filename   text        PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.schema_migrations IS
    'Applied-migration ledger, written by scripts/run_migrations.sh. In `app` so it '
    'is not enumerable by an anonymous PostgREST caller.';


-- ============================================================
-- 3. The revoke wall on `app`.
-- ============================================================
DO $$
BEGIN
    -- Roles a fresh Supabase project ships. Guarded because a bare postgres
    -- container (the CI fallback described in the plan) has none of them, and
    -- this migration must not be the thing that fails there.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON SCHEMA app FROM anon';
        EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon';
        EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM anon';
        EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM anon';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM anon';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM anon';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM anon';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON SCHEMA app FROM authenticated';
        EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM authenticated';
        EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM authenticated';
        EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM authenticated';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM authenticated';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM authenticated';
        EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM authenticated';
    END IF;
END $$;

-- PUBLIC is every role, present and future, including `anon` and including any
-- role added later by a Supabase platform upgrade. Revoked unconditionally.
REVOKE ALL ON SCHEMA app FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM PUBLIC;


-- ============================================================
-- 4. The `public` schema: no CREATE, and no function is executable by default.
-- ============================================================
-- Postgres 15+ already removes CREATE on `public` from PUBLIC. Restated because
-- a restated default is auditable and an assumed one is not.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- THE SINGLE HIGHEST-LEVERAGE LINE IN THIS BUNDLE.
--
-- SECURITY DEFINER functions default to EXECUTE for PUBLIC, and PUBLIC includes
-- anon. That is the most commonly missed hole in a Supabase project, and it
-- bypasses every RLS policy anyone writes, because a definer function runs as
-- its owner. Revoking the default means every future function in `public` starts
-- unexecutable and has to be granted deliberately -- the safe direction.
--
-- Read the KNOWN LIMIT in the header before treating this as sufficient.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- AND THE NAMED ROLES, WHICH IS NOT THE SAME THING AND IS EASY TO GET WRONG.
--
-- Revoking from PUBLIC above does NOT remove a grant made to `anon` BY NAME, and
-- a fresh Supabase project makes exactly that grant:
--
--   select defaclacl from pg_default_acl d join pg_namespace n
--     on n.oid = d.defaclnamespace where n.nspname='public' and defaclobjtype='f';
--   -> {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres,
--       service_role=X/postgres}   (and an identical entry set by supabase_admin)
--
-- So every function created in `public` arrives EXECUTABLE BY ANON, and a
-- REVOKE ... FROM PUBLIC is a no-op against it. Since a SECURITY DEFINER
-- function runs as its owner, that is a complete bypass of every RLS policy in
-- the database -- the policies stay correct and become irrelevant.
--
-- Found by tests/db/rls_rpc_execute_allowlist.test.ts on its first run against
-- migration 011, which had revoked only from PUBLIC.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM service_role;


-- ============================================================
-- 5. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('001_app_schema_and_migration_ledger.sql', now())
ON CONFLICT (filename) DO NOTHING;
