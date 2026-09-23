-- ============================================================
-- 020_operator_functions_and_listing.sql
-- ============================================================
-- Bundle 3, PR 3.4a (R-2026-09-23-71, issued as R-PROVISIONAL-2026-09-23-AY; the
-- kickoff's PR 3.4 section, its migration renumbered 019 -> 020 by -66).
-- The first operator write surface, and a facility that is not public until it is
-- LISTED.
--
-- WHAT IT ADDS:
--   1. app.facility.listed_at timestamptz. NULL means unlisted: a facility still
--      being onboarded, which reaches NO public output. It is not quiet mode, and
--      the difference is the rollup (-71 B). A quiet facility writes no mirror row
--      but DOES feed public.lga_rollup. A facility started quiet would enter a
--      public aggregate with a zero count from wards that never reported, and would
--      count toward the k=5 floor, letting a cell clear k with fewer real
--      reporters. quiet_mode stays founder-flipped and orthogonal.
--   2. app.facility.version integer, incremented by trigger on every UPDATE: the
--      stale-edit token (-71 J1). updated_at is microseconds, and a JS Date round
--      trip truncates it to milliseconds, so it cannot be compared for equality.
--   3. app.assert_operator(): the operator check. It is deliberately NOT built on
--      app.assert_member(), which lets a PLATFORM_ADMIN through every role check
--      (011:109-111).
--   4. Five operator functions in `public`, EXECUTE to authenticated only:
--      create, edit, add category, list for the facility, and the freshness list.
--   5. Two provisioning functions in `app`, executable by NO client role:
--      app.provision_begin() and app.provision_complete(). They are the ONE
--      implementation of the invite gates (-71 C, I, J3, J4).
--      scripts/provision_ward_account.mjs calls them as the owner (3.4b). No public
--      function provisions in v1.
--   6. Two unique indexes. One OPEN invite per scope. One ACTIVE WARD_STAFF
--      account per ward (-71 J3: an account is a ward, never a person).
--
-- EVERY PUBLIC MEMBERSHIP PREDICATE, enumerated from the live schema (-71 B asks for
-- each site to be stated). Exactly two SQL sites decide which facilities reach
-- public output, and both gain `AND f.listed_at IS NOT NULL`:
--   - app.project_facility(uuid): 008 and never superseded. The only writer of
--     public.facility_public and public.ward_public.
--   - app.refresh_lga_rollup(): 017, which superseded 009. The only writer of
--     public.lga_rollup.
-- app.regenerate_snapshot() (019) reads only the mirrors, so it inherits the first.
-- publish_ward_status's `public_listed` reads ward_public back, so the same. No
-- view exists anywhere in the migrations. Each body below is the live one, copied
-- from its file with the predicate added and nothing else changed. The down
-- migration restores the originals verbatim.
--
-- B1 -- APPLYING THIS CHANGES NO PUBLIC OUTPUT. `listed_at` is added with a column
-- DEFAULT of now(), which is then dropped. Existing rows take the value without an
-- UPDATE, so no trigger fires: nothing is re-projected, `updated_at` does not move,
-- and every existing facility is listed. New rows default to NULL, i.e. unlisted.
-- Hosted holds 0 facility rows (019:55), so today this backfills nothing there.
-- Seeds and tests that insert facilities after migrations state `listed_at`
-- themselves.
--
-- B2 -- HOW LONG AN UNLISTED FACILITY STAYS VISIBLE. Listing and unlisting reach
-- the mirrors in the same transaction: the 008 trigger fires on any UPDATE of
-- app.facility and has no column list. After that come the snapshot (pg_cron every
-- minute, 017), the edge cache (s-maxage=30, serve.ts; stale-while-revalidate is
-- not honoured by cache.put) and the page's 30 s poll. The worst case is about
-- 120 s, the bound snapshot-shape.json already states, plus up to about 30 s of
-- fetch retries. It has NO upper bound if the generator stops, since the page
-- serves the newest row with no age check. The rollup recomputes every five minutes
-- and has no public reader today. **v1 allows listing only**: there is no unlisting
-- function, and an unlisting is a founder SQL step with that latency.
--
-- -69 (a): operator_add_category requires the offering, with no default, and
-- leaves the ward PENDING. No function here moves a ward out of PENDING, so
-- publish_ward_status stays the only writer of monitoring_state ACTIVE
-- (tests/compliance/public_labels.test.ts).
--
-- Every operator write leaves one app.audit_log row in its own transaction
-- (AJ D10), with session_id from the JWT as in 014. The value records WHICH fields
-- changed and the version, never their free text, so the 256-character cap can
-- never refuse an edit, and no name or address is copied into the audit trail.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS; ALTER COLUMN DROP DEFAULT is a no-op when
-- repeated; CREATE OR REPLACE for every function; DROP TRIGGER IF EXISTS before
-- CREATE TRIGGER; CREATE UNIQUE INDEX IF NOT EXISTS, each preceded by a pre-check
-- that names any existing rows that would violate it; the ledger insert is
-- ON CONFLICT DO NOTHING.
--
-- Deployment ordering gate: none for the schema. USING it on hosted is gated by
-- -45: no facility and no ward account is created there until the gate reads clear.
-- ============================================================


-- ============================================================
-- 1. listed_at and version on app.facility.
-- ============================================================
ALTER TABLE app.facility ADD COLUMN IF NOT EXISTS listed_at timestamptz DEFAULT now();
ALTER TABLE app.facility ALTER COLUMN listed_at DROP DEFAULT;
COMMENT ON COLUMN app.facility.listed_at IS
    'NULL = unlisted: a facility being onboarded, excluded from every public '
    'membership predicate (the mirrors and the rollup). Set by '
    'public.operator_set_facility_listed(). Not quiet_mode: a quiet facility still '
    'feeds public.lga_rollup (R-2026-09-23-71 B).';

ALTER TABLE app.facility ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
COMMENT ON COLUMN app.facility.version IS
    'The stale-edit token: incremented on every UPDATE by trg_facility_version, '
    'returned by operator_list_facilities() and passed back on edit '
    '(R-2026-09-23-71 J1).';

-- Its own trigger, not app.touch_updated_at(): that function serves five tables,
-- and app.ward_status already versions itself by hand in publish_ward_status.
CREATE OR REPLACE FUNCTION app.bump_facility_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $FN$
BEGIN
    NEW.version := OLD.version + 1;
    RETURN NEW;
END;
$FN$;
REVOKE ALL ON FUNCTION app.bump_facility_version() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_facility_version ON app.facility;
CREATE TRIGGER trg_facility_version
    BEFORE UPDATE ON app.facility
    FOR EACH ROW EXECUTE FUNCTION app.bump_facility_version();


-- ============================================================
-- 2. The two public membership predicates, each gaining `listed_at IS NOT NULL`.
-- ============================================================
CREATE OR REPLACE FUNCTION app.project_facility(p_facility_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
DECLARE
    v_visible boolean;
BEGIN
    -- Visible means: the facility exists, is active, is not in quiet mode, and is
    -- LISTED (020; R-2026-09-23-71 B). A facility row that has been deleted yields
    -- NULL, which coalesces to false and therefore removes its mirror rows -- the
    -- correct behaviour.
    SELECT f.is_active AND NOT f.quiet_mode
           AND f.listed_at IS NOT NULL
      INTO v_visible
      FROM app.facility f
     WHERE f.id = p_facility_id;

    v_visible := coalesce(v_visible, false);

    IF NOT v_visible THEN
        -- QUIET, INACTIVE OR GONE: no row, not a filtered row. See the header
        -- for why a DELETE is safe here and a tombstone would not be.
        DELETE FROM public.ward_public     WHERE facility_id = p_facility_id;
        DELETE FROM public.facility_public WHERE facility_id = p_facility_id;
        RETURN;
    END IF;

    -- ---- facility_public ------------------------------------------------
    INSERT INTO public.facility_public
        (facility_id, name, lga, state, lat, lng, public_phone_e164, updated_at)
    SELECT f.id, f.name, f.lga, f.state, f.lat, f.lng, f.public_phone_e164, f.updated_at
      FROM app.facility f
     WHERE f.id = p_facility_id
    ON CONFLICT (facility_id) DO UPDATE SET
        name              = EXCLUDED.name,
        lga               = EXCLUDED.lga,
        state             = EXCLUDED.state,
        lat               = EXCLUDED.lat,
        lng               = EXCLUDED.lng,
        public_phone_e164 = EXCLUDED.public_phone_e164,
        updated_at        = EXCLUDED.updated_at;

    -- ---- ward_public ----------------------------------------------------
    -- accepting_effective composes two things, and both are deliberate:
    --   (a) offering = 'OFFERED'  -- a ward the facility does not offer is never
    --       accepting, whatever its stored claim says. Mirrored by
    --       acceptingEffectiveForWard() in packages/gate/src/gate.ts.
    --   (b) accepting AND gate IS NULL -- the ward's claim, reduced by the gate.
    --       The gate can close; it can never open. The only route to `true` here
    --       is the ward having claimed `true`.
    INSERT INTO public.ward_public
        (facility_id, category, offering, bed_count,
         accepting_effective, gated_by, state, source, monitoring_state, updated_at)
    SELECT
        ws.facility_id,
        ws.category,
        ws.offering,
        ws.bed_count,
        (ws.offering = 'OFFERED'
             AND ws.accepting
             AND app.gate(ws.category, ops.anaesthetist, ops.obstetrician, ops.paediatrician) IS NULL),
        app.gate(ws.category, ops.anaesthetist, ops.obstetrician, ops.paediatrician),
        ws.state,
        ws.source,
        ws.monitoring_state,
        ws.updated_at
      FROM app.ward_status ws
      -- LEFT JOIN, not JOIN. A facility with no facility_ops row must still
      -- publish its wards, ungated: no recorded duty cover is not the same thing
      -- as recorded absence of cover. An inner join here would make every ward at
      -- such a facility silently vanish from the public dashboard.
      LEFT JOIN app.facility_ops ops ON ops.facility_id = ws.facility_id
     WHERE ws.facility_id = p_facility_id
    ON CONFLICT (facility_id, category) DO UPDATE SET
        offering            = EXCLUDED.offering,
        bed_count           = EXCLUDED.bed_count,
        accepting_effective = EXCLUDED.accepting_effective,
        gated_by            = EXCLUDED.gated_by,
        state               = EXCLUDED.state,
        source              = EXCLUDED.source,
        monitoring_state    = EXCLUDED.monitoring_state,
        updated_at          = EXCLUDED.updated_at;

    -- Remove mirror rows whose source ward_status row is gone.
    DELETE FROM public.ward_public wp
     WHERE wp.facility_id = p_facility_id
       AND NOT EXISTS (
           SELECT 1 FROM app.ward_status ws
            WHERE ws.facility_id = wp.facility_id
              AND ws.category    = wp.category
       );
END;
$FN$;

CREATE OR REPLACE FUNCTION app.refresh_lga_rollup()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $FN$
DECLARE
    v_rows integer;
BEGIN
    -- Full recompute. A cell that no longer clears the k-floor must DISAPPEAR,
    -- and an incremental update would leave it behind -- which is precisely the
    -- disclosure the floor exists to prevent.
    DELETE FROM public.lga_rollup;

    WITH contrib AS (
        -- One row per (cell, facility). THE SET.
        SELECT
            f.state,
            f.lga,
            ws.category,
            f.id AS facility_id,
            sum(coalesce(ws.bed_count, 0))::integer AS beds
          FROM app.facility f
          JOIN app.ward_status ws ON ws.facility_id = f.id
         WHERE f.quiet_mode
           AND f.is_active
           AND f.listed_at IS NOT NULL
           AND ws.offering = 'OFFERED'
         GROUP BY f.state, f.lga, ws.category, f.id
    ),
    agg AS (
        SELECT
            c.state,
            c.lga,
            c.category,
            count(DISTINCT c.facility_id)::integer AS facility_count,
            sum(c.beds)::integer                   AS total_beds,
            max(c.beds)::integer                   AS max_facility_beds
          FROM contrib c
         GROUP BY c.state, c.lga, c.category
    )
    INSERT INTO public.lga_rollup (state, lga, category, facility_count, total_beds, updated_at)
    SELECT a.state, a.lga, a.category, a.facility_count, a.total_beds, now()
      FROM agg a
     WHERE CASE
               -- 1. K-FLOOR. Fewer than 5 contributing facilities: suppress.
               --    Stable over time, which is what makes it safe: a cell that is
               --    always absent tells an observer nothing.
               WHEN a.facility_count < 5 THEN false

               -- 2. ALL-ZERO. PUBLISH, and return before any division is reached.
               --
               --    This arm MUST precede arm 3. CASE evaluates its conditions in
               --    order and stops at the first true one, so arm 3's division is
               --    unreachable when total_beds = 0.
               --
               --    Published rather than suppressed because suppressing would not
               --    hide it: if all-zero were the only condition beyond the k-floor
               --    that removed a cell, the cell would be present on normal days
               --    and absent on zero days, and the absence would be the signal.
               --    Suppression buys nothing and costs the most useful thing the
               --    rollup can say.
               WHEN a.total_beds = 0 THEN true

               -- 3. DOMINANCE. Reachable only when total_beds > 0.
               --    NULLIF is belt-and-braces on top of the ordering above: if
               --    anyone ever reorders these arms, this yields NULL (row not
               --    selected) rather than raising division_by_zero and taking the
               --    whole refresh down.
               WHEN a.max_facility_beds::numeric / nullif(a.total_beds, 0) <= 0.40 THEN true

               ELSE false
           END;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$FN$;


-- ============================================================
-- 3. The two unique indexes, each behind a pre-check that NAMES what violates it.
-- ============================================================
DO $$
DECLARE v text;
BEGIN
    SELECT string_agg(coalesce(facility_id::text, 'NULL') || '/' || coalesce(ward_category::text, 'NULL') || '/' || role::text, ', ')
      INTO v
      FROM (SELECT facility_id, ward_category, role FROM app.invite
             WHERE accepted_at IS NULL
             GROUP BY 1, 2, 3 HAVING count(*) > 1) d;
    IF v IS NOT NULL THEN
        RAISE EXCEPTION 'OPEN_INVITE_DUPLICATES' USING DETAIL = v,
              HINT = 'more than one open invite for one scope; accept or delete the extras first';
    END IF;
    SELECT string_agg(facility_id::text || '/' || ward_category::text, ', ')
      INTO v
      FROM (SELECT facility_id, ward_category FROM app.ward_account
             WHERE role = 'WARD_STAFF' AND is_active
             GROUP BY 1, 2 HAVING count(*) > 1) d;
    IF v IS NOT NULL THEN
        RAISE EXCEPTION 'WARD_ACCOUNT_DUPLICATES' USING DETAIL = v,
              HINT = 'a ward holds more than one active account; deactivate all but one first';
    END IF;
END $$;

-- NULLS NOT DISTINCT (PostgreSQL 15+; hosted and local are 17.6): the
-- PLATFORM_ADMIN scope has no facility and no category, and without it every open
-- admin invite would be distinct from every other.
CREATE UNIQUE INDEX IF NOT EXISTS invite_one_open_per_scope
    ON app.invite (facility_id, ward_category, role) NULLS NOT DISTINCT
    WHERE accepted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ward_account_one_active_per_ward
    ON app.ward_account (facility_id, ward_category)
    WHERE role = 'WARD_STAFF' AND is_active;


-- ============================================================
-- 4. app.assert_operator() -- who may operate, from auth.uid() alone.
-- ============================================================
CREATE OR REPLACE FUNCTION app.assert_operator()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $FN$
DECLARE
    v_uid    uuid := auth.uid();
    v_role   app.app_role;
    v_active boolean;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
    END IF;
    SELECT u.role, u.is_active INTO v_role, v_active
      FROM app.ward_account u WHERE u.id = v_uid;
    IF NOT FOUND OR v_role IS DISTINCT FROM 'PLATFORM_ADMIN' THEN
        RAISE EXCEPTION 'NOT_AN_OPERATOR' USING ERRCODE = '42501';
    END IF;
    IF NOT v_active THEN
        RAISE EXCEPTION 'ACCOUNT_DEACTIVATED' USING ERRCODE = '42501';
    END IF;
    RETURN v_uid;
END;
$FN$;
REVOKE ALL ON FUNCTION app.assert_operator() FROM PUBLIC;

-- The session an operator write is attributed to, as 014 reads it. Never the
-- account id: a session_id equal to auth.uid() is refused, because the audit log
-- carries no actor identity by design.
CREATE OR REPLACE FUNCTION app.operator_session(p_uid uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $FN$
DECLARE
    v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
BEGIN
    IF v_session IS NOT DISTINCT FROM p_uid THEN
        RAISE EXCEPTION 'SESSION_ID_IS_ACCOUNT_ID' USING ERRCODE = '42501';
    END IF;
    RETURN v_session;
END;
$FN$;
REVOKE ALL ON FUNCTION app.operator_session(uuid) FROM PUBLIC;


-- ============================================================
-- 5. The operator functions, in `public`, EXECUTE to authenticated only.
-- ============================================================
-- Text parameters, never app-typed: PostgREST names parameter types, and
-- authenticated holds no USAGE on schema app (014:44-52;
-- tests/db/rpc_definer_safety.test.ts C).

CREATE OR REPLACE FUNCTION public.operator_create_facility(
    p_id                text,
    p_name              text,
    p_lga               text,
    p_state             text,
    p_lat               double precision,
    p_lng               double precision,
    p_public_phone_e164 text
)
RETURNS TABLE (facility_id uuid, version integer, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_uid     uuid := app.assert_operator();
    v_session uuid := app.operator_session(v_uid);
    v_id      uuid;
    v_new     uuid;
    v_old     app.facility;
BEGIN
    BEGIN
        v_id := p_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_id';
    END;
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_id';
    END IF;

    -- J2: the client-generated id is the idempotency key. ON CONFLICT DO NOTHING
    -- means a concurrent double submit waits on the key rather than surfacing 23505.
    INSERT INTO app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
    VALUES (v_id, p_name, p_lga, p_state, p_lat, p_lng, p_public_phone_e164, NULL)
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO v_new;

    IF v_new IS NULL THEN
        SELECT * INTO v_old FROM app.facility f WHERE f.id = v_id;
        IF v_old.name IS DISTINCT FROM p_name OR v_old.lga IS DISTINCT FROM p_lga
           OR v_old.state IS DISTINCT FROM p_state OR v_old.lat IS DISTINCT FROM p_lat
           OR v_old.lng IS DISTINCT FROM p_lng
           OR v_old.public_phone_e164 IS DISTINCT FROM p_public_phone_e164 THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'
                  USING DETAIL = 'this facility id already exists with different fields';
        END IF;
        RETURN QUERY SELECT v_old.id, v_old.version, false;
        RETURN;
    END IF;

    -- The duty-flags row in the same transaction, every flag UNKNOWN. A facility
    -- with no row reads as ungated through 006's LEFT JOIN; this makes the unknown
    -- explicit rather than absent.
    INSERT INTO app.facility_ops (facility_id) VALUES (v_id);

    INSERT INTO app.audit_log (facility_id, action, new_value, version, session_id)
    VALUES (v_id, 'facility.create',
            jsonb_build_object('fields', jsonb_build_array('name', 'lga', 'state', 'lat', 'lng', 'public_phone_e164'),
                               'listed', false),
            1, v_session);

    RETURN QUERY SELECT v_id, 1, true;
END;
$FN$;

CREATE OR REPLACE FUNCTION public.operator_edit_facility(
    p_facility_id       text,
    p_expected_version  integer,
    p_name              text,
    p_lga               text,
    p_state             text,
    p_lat               double precision,
    p_lng               double precision,
    p_public_phone_e164 text
)
RETURNS TABLE (facility_id uuid, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_uid     uuid := app.assert_operator();
    v_session uuid := app.operator_session(v_uid);
    v_id      uuid;
    v_old     app.facility;
    v_version integer;
    v_fields  jsonb := '[]'::jsonb;
BEGIN
    BEGIN
        v_id := p_facility_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_facility_id';
    END;

    SELECT * INTO v_old FROM app.facility f WHERE f.id = v_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_SUCH_FACILITY';
    END IF;
    -- J1: the integer version, compared exactly. Never updated_at.
    IF v_old.version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'VERSION_CONFLICT' USING DETAIL = format('current_version=%s', v_old.version);
    END IF;

    IF v_old.name IS DISTINCT FROM p_name THEN v_fields := v_fields || '"name"'; END IF;
    IF v_old.lga IS DISTINCT FROM p_lga THEN v_fields := v_fields || '"lga"'; END IF;
    IF v_old.state IS DISTINCT FROM p_state THEN v_fields := v_fields || '"state"'; END IF;
    IF v_old.lat IS DISTINCT FROM p_lat THEN v_fields := v_fields || '"lat"'; END IF;
    IF v_old.lng IS DISTINCT FROM p_lng THEN v_fields := v_fields || '"lng"'; END IF;
    IF v_old.public_phone_e164 IS DISTINCT FROM p_public_phone_e164 THEN v_fields := v_fields || '"public_phone_e164"'; END IF;

    UPDATE app.facility f
       SET name = p_name, lga = p_lga, state = p_state, lat = p_lat, lng = p_lng,
           public_phone_e164 = p_public_phone_e164
     WHERE f.id = v_id
    RETURNING f.version INTO v_version;

    INSERT INTO app.audit_log (facility_id, action, old_value, new_value, version, session_id)
    VALUES (v_id, 'facility.edit',
            jsonb_build_object('version', v_old.version),
            jsonb_build_object('fields', v_fields, 'version', v_version),
            v_version, v_session);

    RETURN QUERY SELECT v_id, v_version;
END;
$FN$;

CREATE OR REPLACE FUNCTION public.operator_set_facility_listed(
    p_facility_id      text,
    p_expected_version integer
)
RETURNS TABLE (facility_id uuid, version integer, listed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_uid     uuid := app.assert_operator();
    v_session uuid := app.operator_session(v_uid);
    v_id      uuid;
    v_old     app.facility;
    v_version integer;
    v_listed  timestamptz;
BEGIN
    BEGIN
        v_id := p_facility_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_facility_id';
    END;

    SELECT * INTO v_old FROM app.facility f WHERE f.id = v_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_SUCH_FACILITY';
    END IF;
    IF v_old.listed_at IS NOT NULL THEN
        -- Already listed: a repeat is an answer, not a second write.
        RETURN QUERY SELECT v_id, v_old.version, v_old.listed_at;
        RETURN;
    END IF;
    IF v_old.version IS DISTINCT FROM p_expected_version THEN
        RAISE EXCEPTION 'VERSION_CONFLICT' USING DETAIL = format('current_version=%s', v_old.version);
    END IF;

    -- THE PRECONDITIONS (-71 B), each refused by name, in the order an operator
    -- meets them. Listing is the act that makes a facility public, so it requires
    -- what the -45 gate requires of a facility that is public.
    IF NOT v_old.is_active THEN
        RAISE EXCEPTION 'FACILITY_INACTIVE';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = v_id) THEN
        RAISE EXCEPTION 'NO_FACILITY_CONTACT';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = v_id AND c.agreement_accepted_at IS NOT NULL) THEN
        RAISE EXCEPTION 'AGREEMENT_NOT_RECORDED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.ward_status ws WHERE ws.facility_id = v_id) THEN
        RAISE EXCEPTION 'NO_CATEGORY';
    END IF;

    UPDATE app.facility f SET listed_at = now()
     WHERE f.id = v_id
    RETURNING f.version, f.listed_at INTO v_version, v_listed;

    INSERT INTO app.audit_log (facility_id, action, old_value, new_value, version, session_id)
    VALUES (v_id, 'facility.list',
            jsonb_build_object('listed', false), jsonb_build_object('listed', true),
            v_version, v_session);

    RETURN QUERY SELECT v_id, v_version, v_listed;
END;
$FN$;

CREATE OR REPLACE FUNCTION public.operator_add_category(
    p_facility_id text,
    p_category    text,
    p_offering    text
)
RETURNS TABLE (ward_status_id uuid, version integer, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_uid      uuid := app.assert_operator();
    v_session  uuid := app.operator_session(v_uid);
    v_id       uuid;
    v_category app.ward_category;
    v_offering app.ward_offering;
    v_ws       app.ward_status;
    v_new      uuid;
BEGIN
    BEGIN
        v_id := p_facility_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_facility_id';
    END;
    BEGIN
        v_category := p_category::app.ward_category;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_category';
    END;
    -- -69 (a): the offering is a clinical claim, stated or refused. Never defaulted.
    IF p_offering IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_offering';
    END IF;
    BEGIN
        v_offering := p_offering::app.ward_offering;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_offering';
    END;
    IF v_category IS NULL THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_category';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app.facility f WHERE f.id = v_id) THEN
        RAISE EXCEPTION 'NO_SUCH_FACILITY';
    END IF;

    -- J2: a repeat returns the existing ward, never 23505. The ward stays PENDING:
    -- monitoring_state is not written here at all.
    INSERT INTO app.ward_status (facility_id, category, offering)
    VALUES (v_id, v_category, v_offering)
    ON CONFLICT (facility_id, category) DO NOTHING
    RETURNING id INTO v_new;

    IF v_new IS NULL THEN
        SELECT * INTO v_ws FROM app.ward_status ws WHERE ws.facility_id = v_id AND ws.category = v_category;
        IF v_ws.offering IS DISTINCT FROM v_offering THEN
            -- A ward's claims are the ward's to publish (AJ D7). Changing an
            -- offering through the operator surface is not in v1.
            RAISE EXCEPTION 'CATEGORY_EXISTS_WITH_OTHER_OFFERING'
                  USING DETAIL = format('current_offering=%s', v_ws.offering);
        END IF;
        RETURN QUERY SELECT v_ws.id, v_ws.version, false;
        RETURN;
    END IF;

    INSERT INTO app.audit_log (facility_id, ward_category, action, new_value, version, session_id)
    VALUES (v_id, v_category, 'ward_status.add_category',
            jsonb_build_object('offering', v_offering), 1, v_session);

    RETURN QUERY SELECT v_new, 1, true;
END;
$FN$;

CREATE OR REPLACE FUNCTION public.operator_list_facilities()
RETURNS TABLE (
    facility_id        uuid,
    name               text,
    lga                text,
    state              text,
    version            integer,
    listed_at          timestamptz,
    quiet_mode         boolean,
    is_active          boolean,
    has_contact        boolean,
    agreement_recorded boolean,
    categories         jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_uid uuid := app.assert_operator();
BEGIN
    -- EVERY facility and EVERY category (AJ D8). Freshness never filters, sorts out
    -- or hides a row here; the operator is shown the stale ones. The bands are the
    -- page's, from freshnessBand(). No address or name of a person is returned: the
    -- contact is a yes/no, and "provisioning incomplete" comes from app.invite,
    -- never auth.users (-71 C).
    RETURN QUERY
    SELECT f.id, f.name, f.lga, f.state, f.version, f.listed_at, f.quiet_mode, f.is_active,
           EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = f.id),
           EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = f.id AND c.agreement_accepted_at IS NOT NULL),
           coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                          'category', ws.category,
                          'offering', ws.offering,
                          'monitoring_state', ws.monitoring_state,
                          'bed_count', ws.bed_count,
                          'accepting', ws.accepting,
                          'updated_at', ws.updated_at,
                          'has_account', EXISTS (
                              SELECT 1 FROM app.ward_account u
                               WHERE u.facility_id = f.id AND u.ward_category = ws.category
                                 AND u.role = 'WARD_STAFF' AND u.is_active),
                          'provisioning_incomplete',
                              EXISTS (SELECT 1 FROM app.invite i
                                       WHERE i.facility_id = f.id AND i.ward_category = ws.category
                                         AND i.role = 'WARD_STAFF' AND i.accepted_at IS NULL)
                              AND NOT EXISTS (SELECT 1 FROM app.ward_account u
                                       WHERE u.facility_id = f.id AND u.ward_category = ws.category
                                         AND u.role = 'WARD_STAFF' AND u.is_active)
                      ) ORDER BY ws.category)
                 FROM app.ward_status ws WHERE ws.facility_id = f.id
           ), '[]'::jsonb)
      FROM app.facility f
     ORDER BY f.name, f.id;
END;
$FN$;

-- EXECUTE: authenticated only. REVOKE FROM PUBLIC is not enough, because
-- Supabase's default ACL grants EXECUTE on public functions to anon, authenticated
-- and service_role BY NAME (014).
DO $$
DECLARE
    f text;
    r text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'public.operator_create_facility(text, text, text, text, double precision, double precision, text)',
        'public.operator_edit_facility(text, integer, text, text, text, double precision, double precision, text)',
        'public.operator_set_facility_listed(text, integer)',
        'public.operator_add_category(text, text, text)',
        'public.operator_list_facilities()'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
        FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
            END IF;
        END LOOP;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
        END IF;
    END LOOP;
END $$;


-- ============================================================
-- 6. The provisioning gates, in `app`, executable by NO client role.
-- ============================================================
-- ONE implementation of the gates (-71 C). scripts/provision_ward_account.mjs calls
-- these as the owner over the direct database URL (3.4b): begin, then GoTrue's
-- generate_link only if begin says `open`, then complete. Under -71 C no public
-- function provisions in v1, because the admin app cannot create an Auth user
-- without the secret key.

CREATE OR REPLACE FUNCTION app.provision_begin(
    p_facility uuid,
    p_category text,
    p_role     text
)
RETURNS TABLE (status text, invite_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_role     app.app_role;
    v_category app.ward_category;
    v_invite   uuid;
BEGIN
    BEGIN
        v_role := p_role::app.app_role;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_role';
    END;

    IF v_role = 'FACILITY_ADMIN' THEN
        RAISE EXCEPTION 'ROLE_NOT_PROVISIONED_IN_V1' USING DETAIL = 'FACILITY_ADMIN';
    END IF;

    IF v_role = 'WARD_STAFF' THEN
        BEGIN
            v_category := p_category::app.ward_category;
        EXCEPTION WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'p_category';
        END;
        IF p_facility IS NULL OR v_category IS NULL THEN
            RAISE EXCEPTION 'INVALID_ARGUMENT' USING DETAIL = 'a WARD_STAFF invite needs a facility and a category';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM app.facility f WHERE f.id = p_facility) THEN
            RAISE EXCEPTION 'NO_SUCH_FACILITY';
        END IF;
        -- I: the invite gate (-45; AJ D5), in the database and not the UI.
        IF NOT EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = p_facility) THEN
            RAISE EXCEPTION 'NO_FACILITY_CONTACT';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM app.facility_contact c WHERE c.facility_id = p_facility AND c.agreement_accepted_at IS NOT NULL) THEN
            RAISE EXCEPTION 'AGREEMENT_NOT_RECORDED';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM app.ward_status ws WHERE ws.facility_id = p_facility AND ws.category = v_category) THEN
            RAISE EXCEPTION 'NO_SUCH_WARD';
        END IF;
        -- J4: a ward that already has its account is complete. Nothing is opened,
        -- and the script calls no Auth admin endpoint.
        IF EXISTS (SELECT 1 FROM app.ward_account u
                    WHERE u.facility_id = p_facility AND u.ward_category = v_category
                      AND u.role = 'WARD_STAFF' AND u.is_active) THEN
            RETURN QUERY SELECT 'complete'::text, NULL::uuid;
            RETURN;
        END IF;
    ELSE
        -- PLATFORM_ADMIN: no facility, no category (003's scope CHECK), no gate.
        p_facility := NULL;
        v_category := NULL;
    END IF;

    INSERT INTO app.invite (facility_id, ward_category, role)
    VALUES (p_facility, v_category, v_role)
    ON CONFLICT (facility_id, ward_category, role) WHERE accepted_at IS NULL DO NOTHING
    RETURNING id INTO v_invite;

    IF v_invite IS NULL THEN
        SELECT i.id INTO v_invite FROM app.invite i
         WHERE i.facility_id IS NOT DISTINCT FROM p_facility
           AND i.ward_category IS NOT DISTINCT FROM v_category
           AND i.role = v_role AND i.accepted_at IS NULL;
    ELSE
        INSERT INTO app.audit_log (facility_id, ward_category, action, new_value)
        VALUES (p_facility, v_category, 'invite.open', jsonb_build_object('role', v_role));
    END IF;

    RETURN QUERY SELECT 'open'::text, v_invite;
END;
$FN$;

CREATE OR REPLACE FUNCTION app.provision_complete(
    p_invite_id uuid,
    p_user_id   uuid
)
RETURNS TABLE (status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $FN$
#variable_conflict use_column
DECLARE
    v_inv  app.invite;
    v_acct app.ward_account;
BEGIN
    SELECT * INTO v_inv FROM app.invite i WHERE i.id = p_invite_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'NO_SUCH_INVITE';
    END IF;

    SELECT * INTO v_acct FROM app.ward_account u WHERE u.id = p_user_id;
    IF FOUND THEN
        IF v_acct.facility_id IS DISTINCT FROM v_inv.facility_id
           OR v_acct.ward_category IS DISTINCT FROM v_inv.ward_category
           OR v_acct.role IS DISTINCT FROM v_inv.role THEN
            RAISE EXCEPTION 'ACCOUNT_SCOPE_CONFLICT'
                  USING DETAIL = 'this Auth user already holds an account with another scope';
        END IF;
        -- The same account for the same scope: a repeat, not a second write.
        IF v_inv.accepted_at IS NULL THEN
            UPDATE app.invite i SET accepted_at = now() WHERE i.id = p_invite_id;
        END IF;
        RETURN QUERY SELECT 'complete'::text;
        RETURN;
    END IF;

    IF v_inv.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'INVITE_ALREADY_ACCEPTED';
    END IF;

    BEGIN
        INSERT INTO app.ward_account (id, facility_id, ward_category, role)
        VALUES (p_user_id, v_inv.facility_id, v_inv.ward_category, v_inv.role);
    EXCEPTION WHEN unique_violation THEN
        -- J3: one active account per ward. Replacing a ward's address means
        -- deactivating the old account first.
        RAISE EXCEPTION 'WARD_ALREADY_HAS_AN_ACCOUNT'
              USING DETAIL = 'deactivate the ward''s current account before provisioning another';
    END;

    UPDATE app.invite i SET accepted_at = now() WHERE i.id = p_invite_id;

    INSERT INTO app.audit_log (facility_id, ward_category, action, new_value)
    VALUES (v_inv.facility_id, v_inv.ward_category, 'ward_account.provision',
            jsonb_build_object('role', v_inv.role));

    RETURN QUERY SELECT 'complete'::text;
END;
$FN$;

-- Owner only. No client role reaches the gates.
DO $$
DECLARE
    f text;
    r text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'app.provision_begin(uuid, text, text)',
        'app.provision_complete(uuid, uuid)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
        FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
            END IF;
        END LOOP;
    END LOOP;
END $$;


-- ============================================================
-- 7. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('020_operator_functions_and_listing.sql', now())
ON CONFLICT (filename) DO NOTHING;
