-- ============================================================
-- 003_app_facility_and_identity_tables.sql
-- ============================================================
-- Sprint 1, Bundle 1. Facilities, their operational duty flags, and the identity
-- tables the whole governance model rests on.
--
-- Empirical state at base: schema `app` and its revoke wall exist (001); the 15
-- enum types exist (002). No tables other than app.schema_migrations.
--
-- Empirical anchors:
--   - 002 section 1: app.tri_state ('UNKNOWN','YES','NO'). Every duty flag below
--     is that type, NOT NULL DEFAULT 'UNKNOWN' -- finding F2.
--   - 001 section 3: the revoke wall and the revoked default privileges mean
--     every table created here starts unreachable by anon and authenticated. No
--     GRANT appears in this file, and that is the intended end state: nothing in
--     `app` is ever granted to a client role.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS; trigger creation guarded on pg_trigger.
-- Re-apply is a no-op.
--
-- Deployment ordering gate: none yet. No application code reads these tables;
-- the RPCs that will (011) are not written until this file has landed.
--
-- Object ledger -- 6 tables, 1 function, 3 triggers:
--   app.facility          + trg_facility_touch
--   app.facility_ops      + trg_facility_ops_touch
--   app.ward_account
--   app.facility_contact  + trg_facility_contact_touch
--   app.device
--   app.invite
--   app.touch_updated_at()   -- shared BEFORE UPDATE trigger function
--
-- WARD-LEVEL IDENTITY (decision, 2026-09-08). There are no individual accounts.
-- app.app_user became app.ward_account; app.staff_contact was replaced by
-- app.facility_contact; app.device lost its fingerprint column. Nothing in this
-- file records a natural person except app.facility_contact, which holds the one
-- invited human per facility on a contract basis and is deliberately erasable.
--
-- COLUMN NAMES THAT ARE LOAD-BEARING. `mobile_e164` and `token_hash` are named
-- exactly as the kickoff's forbidden-column list names them, and
-- tests/db/rls_anon_column_containment.test.ts asserts no anon-readable relation
-- exposes them. Renaming one here silently weakens that test into a check for a
-- string that no longer occurs -- if you rename one, change the test's list in
-- the same commit. `fingerprint` is on that forbidden list and now occurs
-- NOWHERE in the schema; the test keeps forbidding it deliberately, so that a
-- reintroduction is caught.
-- ============================================================


-- ============================================================
-- 1. Shared updated_at trigger function.
-- ============================================================
-- FINDING F3, COROLLARY. `updated_at` is set by the database from now(), and a
-- client may never supply it. A ward phone with a fast clock writing a future
-- timestamp would stay green for hours after it stopped being true, and the read
-- path could not detect it. NEW.updated_at is overwritten unconditionally, which
-- is the point: this is not a default, it is a confiscation.
--
-- SET search_path = '' with fully-qualified names, per A3: a caller-controlled
-- search_path against a function that runs on someone else's table is privilege
-- escalation waiting to happen.
CREATE OR REPLACE FUNCTION app.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $FN$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$FN$;

COMMENT ON FUNCTION app.touch_updated_at() IS
    'BEFORE UPDATE trigger: stamps updated_at from the server clock, discarding '
    'whatever the client sent. Finding F3 corollary -- freshness is only '
    'meaningful if the timestamp came from one authoritative clock.';


-- ============================================================
-- 2. app.facility
-- ============================================================
CREATE TABLE IF NOT EXISTS app.facility (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text        NOT NULL,
    lga                text        NOT NULL,
    state              text        NOT NULL,

    -- Straight-line distance is computed on the client from these. They are
    -- published in the snapshot; the USER's coordinates never leave the device.
    lat                double precision NOT NULL,
    lng                double precision NOT NULL,

    -- The single most important column in the public payload. The kickoff makes
    -- Call the only full-width primary action on every tile, with the bed count
    -- visually subordinate to it.
    public_phone_e164  text        NOT NULL,

    -- Quiet mode. Enforced in the PROJECTION (008), never as an RLS policy: a
    -- policy filters rows, and what is needed is that a quiet facility's rows are
    -- never written to a public mirror at all, while its contribution still
    -- reaches app.lga_rollup.
    --
    -- Founder-flipped in v1 -- a config action, no self-serve admin surface.
    quiet_mode         boolean     NOT NULL DEFAULT false,

    is_active          boolean     NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    -- Nigeria bounding box. Catches transposed lat/lng and coordinates parsed
    -- out of degrees-minutes-seconds, either of which silently places a Lagos
    -- facility in Cameroon or the Gulf of Guinea -- and a wrong coordinate does
    -- not look wrong, it just sorts to the bottom of a distance-ordered list and
    -- is never called.
    -- Nigeria spans roughly 4.27N-13.89N and 2.67E-14.68E; padded slightly.
    CONSTRAINT facility_lat_in_nigeria CHECK (lat BETWEEN 4.0 AND 14.0),
    CONSTRAINT facility_lng_in_nigeria CHECK (lng BETWEEN 2.5 AND 15.0),

    -- E.164 only. A locally formatted 0803... in a tel: link fails from a
    -- roaming or dual-SIM handset, which is a large share of the intended users.
    CONSTRAINT facility_phone_is_e164 CHECK (public_phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

COMMENT ON TABLE app.facility IS
    'One row per participating facility. Never committed to the repository as '
    'seed data: database/seed/ is synthetic only, and the real facility list is '
    'operational data.';

COMMENT ON COLUMN app.facility.quiet_mode IS
    'When true this facility contributes to app.lga_rollup only and no row for it '
    'is ever written to public.facility_public or public.ward_public. Enforced in '
    'the projection trigger (008), not by an RLS policy.';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_facility_touch') THEN
        EXECUTE 'CREATE TRIGGER trg_facility_touch
                     BEFORE UPDATE ON app.facility
                     FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()';
    END IF;
END $$;


-- ============================================================
-- 3. app.facility_ops -- THE DUTY FLAGS. Finding F2 lives here.
-- ============================================================
-- One row per facility. Separate from app.facility because these change on a
-- shift cadence while the facility's identity does not, and because the
-- projection trigger (008) fires on THIS table as well as on ward_status -- a
-- flag flipping back to YES or UNKNOWN must un-gate the ward's original claim
-- with zero human action.
CREATE TABLE IF NOT EXISTS app.facility_ops (
    facility_id    uuid PRIMARY KEY REFERENCES app.facility(id) ON DELETE CASCADE,

    -- THREE STATES, NEVER TWO. NOT NULL DEFAULT 'UNKNOWN' makes the nullable
    -- boolean unrepresentable. Only an explicit 'NO' gates anything; 'UNKNOWN'
    -- and 'YES' both gate nothing.
    --
    -- On day one no facility has touched any of these. If they were booleans,
    -- a single `if (!anaesthetist_on_duty)` would render every hospital in Lagos
    -- as closed -- and the SQL twin `not anaesthetist_on_duty` would evaluate to
    -- NULL on a NULL, dropping the row out of a filtered query entirely while
    -- the JavaScript reported it truthy. Two layers disagreeing, neither
    -- erroring.
    anaesthetist   app.tri_state NOT NULL DEFAULT 'UNKNOWN',
    obstetrician   app.tri_state NOT NULL DEFAULT 'UNKNOWN',
    paediatrician  app.tri_state NOT NULL DEFAULT 'UNKNOWN',

    updated_at     timestamptz NOT NULL DEFAULT now(),
    created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app.facility_ops IS
    'Duty-cover flags, per facility. Read ONLY by app.gate() and by the projection '
    'trigger. These reduce a ward category to closed; they can never promote one. '
    'A YES here does not open a ward that said it is not accepting.';

COMMENT ON COLUMN app.facility_ops.anaesthetist IS
    'Gates THEATRE and SURGICAL when, and only when, the value is exactly NO. '
    'Never test this with a bare NOT: in SQL, `not anaesthetist` on the UNKNOWN '
    'default is not TRUE, and the row vanishes from any filtered query.';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_facility_ops_touch') THEN
        EXECUTE 'CREATE TRIGGER trg_facility_ops_touch
                     BEFORE UPDATE ON app.facility_ops
                     FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()';
    END IF;
END $$;


-- ============================================================
-- 4. app.ward_account -- AN ACCOUNT IS A WARD, NEVER A PERSON.
-- ============================================================
-- Ward-level identity decision, 2026-09-08. There are no individual accounts in
-- this system. An auth account represents a ward, or a facility for admin. It
-- never represents a natural person, and nothing here records one.
--
-- WHY THIS IS NOT A WEAKER VERSION OF INDIVIDUAL ACCOUNTS. The anti-pattern
-- everyone reaches for is a shared PASSWORD -- memorable, portable, and retained
-- by a leaver forever. This is not that. Access arrives as a magic link to the
-- ward's own mailbox or duty handset with a short session, so access follows
-- PHYSICAL CONTROL OF THE WARD DEVICE -- the control the facility already
-- exercises and we never could. Someone who leaves and no longer holds the
-- handset loses access by default, with no revocation step for anyone to
-- remember. The individual-account alternative depends on a clinic filing an
-- offboarding request, which does not reliably happen.
--
-- NOTE THE NAME IS INACCURATE FOR ONE ROW IN FOUR: a FACILITY_ADMIN or
-- PLATFORM_ADMIN account has no single ward. `ward_account` is still the right
-- name, because the schema is read by more people than the decision memo is, and
-- a neutral `account` would not tell a future reader that a row is not a person.
-- Same argument 002 makes for DISCREPANCY_REPORTED over FALSE_NEGATIVE_REPORTED.
--
-- Invite-only. There is no public self-registration route anywhere in this
-- system, so there is no column here a stranger could ever populate.
CREATE TABLE IF NOT EXISTS app.ward_account (
    -- Equals auth.uid(). app.assert_member() reads auth.uid() and joins here;
    -- it NEVER trusts a facility_id passed as an argument.
    id             uuid PRIMARY KEY,

    facility_id    uuid REFERENCES app.facility(id) ON DELETE RESTRICT,

    -- NULL is NOT "unknown" here. It means facility scope or platform scope, and
    -- the CHECK below is what keeps those two readings distinguishable instead of
    -- collapsed into one ambiguous absence.
    ward_category  app.ward_category,

    role           app.app_role NOT NULL,

    is_active      boolean NOT NULL DEFAULT true,
    deactivated_at timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ward_account_deactivated_consistently
        CHECK ((is_active AND deactivated_at IS NULL)
            OR (NOT is_active AND deactivated_at IS NOT NULL)),

    -- THE CONSTRAINT THAT MAKES AN INDIVIDUAL ACCOUNT UNREPRESENTABLE.
    --
    -- There is deliberately NO ARM PERMITTING A FACILITY-LESS ACCOUNT below
    -- PLATFORM_ADMIN. The old `REFERRER` role had exactly that shape -- "a
    -- REFERRER who belongs to no participating facility" -- and it was removed
    -- from app.app_role in 002 for this reason. Absence of the role plus absence
    -- of the arm is what makes the property structural instead of documented.
    CONSTRAINT ward_account_scope_matches_role
        CHECK (
             (role = 'WARD_STAFF'     AND facility_id IS NOT NULL AND ward_category IS NOT NULL)
          OR (role = 'FACILITY_ADMIN' AND facility_id IS NOT NULL AND ward_category IS NULL)
          OR (role = 'PLATFORM_ADMIN' AND facility_id IS NULL     AND ward_category IS NULL)
        )
);

COMMENT ON TABLE app.ward_account IS
    'An auth account representing a WARD, or a facility for admin roles. Never a '
    'natural person. id equals auth.uid(). There is no display name, no contact '
    'detail and no last-seen timestamp here, and their absence is the design: the '
    'operational record must contain no personal data, so there is no personal '
    'data for it to contain.';

COMMENT ON COLUMN app.ward_account.ward_category IS
    'NULL means facility scope (FACILITY_ADMIN) or platform scope '
    '(PLATFORM_ADMIN), never "not yet known" -- ward_account_scope_matches_role '
    'is what keeps those readings apart.';


-- ============================================================
-- 5. app.facility_contact -- THE ONE NAMED HUMAN IN THE SYSTEM.
-- ============================================================
-- Replaces app.staff_contact, which held per-person contact details and is
-- exactly what the ward-level identity decision removes.
--
-- This is the second of the two irreducible residues named in that decision.
-- (The first is the login address held by Supabase in auth.users and at the
-- email provider; nothing in this schema stores it.) One invited human per
-- facility -- a CMD or matron who agreed to be the point of contact -- holding
-- business-contact data on a contract basis. Standard, minimal, and deletable.
--
-- THE LOAD-BEARING PROPERTY IS WHAT IS *NOT* HERE: no append-only trigger.
-- 010 makes app.audit_log and app.ward_status_event immutable; this table is
-- deliberately outside that set, because a business contact must be erasable on
-- request. Adding a trigger here "for consistency" would destroy the erasure
-- route, which is why 010's header names this table explicitly.
--
-- And neither residue touches the audit log or the event stream. That is what
-- keeps the operational record clean.
CREATE TABLE IF NOT EXISTS app.facility_contact (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id   uuid NOT NULL REFERENCES app.facility(id) ON DELETE CASCADE,

    full_name     text NOT NULL,
    job_title     text NOT NULL,

    email         text,

    -- NAME KEPT EXACTLY. `mobile_e164` is on the kickoff's forbidden-column list,
    -- and tests/db/rls_anon_column_containment.test.ts asserts no anon-readable
    -- relation exposes it. Renaming it would silently degrade that assertion into
    -- a check for a string that occurs nowhere -- the guard would still pass, and
    -- would be guarding nothing.
    mobile_e164   text,
    sms_opt_in_at timestamptz,

    -- Set from a provider hard-bounce webhook. A hard bounce is a dead address:
    -- stop sending, surface it, never retry.
    unreachable_since timestamptz,

    -- THE EVIDENCE FOR A LOAD-BEARING CONTROL, not ceremony.
    --
    -- What is accepted is the FACILITY AGREEMENT, including the clause that
    -- addresses supplied must be role addresses rather than individual ones. The
    -- entire personal-data position of this system rests on that clause: it is
    -- what makes a login address identify a ward rather than a person, and we
    -- cannot verify from the outside which kind we have been given. A
    -- machine-readable record that the obligation was accepted is therefore the
    -- evidence for the control, and it belongs where the obligation was taken on.
    --
    -- DELIBERATELY NOT NAMED privacy_notice_accepted_at. That name implies
    -- data-subject CONSENT, and there is no consent basis here -- the basis is
    -- CONTRACT. An employee cannot freely consent to her employer in any case,
    -- which is why the earlier staff-privacy-notice column was removed rather
    -- than renamed.
    --
    -- NULLABLE, deliberately. NULL is the queryable "has not accepted yet" state,
    -- and that is exactly the state worth surfacing -- a facility whose agreement
    -- is unaccepted is the one to chase. NOT NULL would make that state
    -- unrepresentable and force a placeholder timestamp, which is worse evidence
    -- than an honest absence.
    agreement_accepted_at timestamptz,

    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    -- "One invited human per facility", made structural rather than documented.
    -- facility_id is NOT NULL, so NULL-distinctness cannot defeat this the way it
    -- would on a nullable column.
    CONSTRAINT facility_contact_one_per_facility UNIQUE (facility_id),

    CONSTRAINT facility_contact_mobile_is_e164
        CHECK (mobile_e164 IS NULL OR mobile_e164 ~ '^\+[1-9][0-9]{7,14}$'),

    CONSTRAINT facility_contact_sms_requires_optin
        CHECK (mobile_e164 IS NULL OR sms_opt_in_at IS NOT NULL),

    CONSTRAINT facility_contact_has_a_channel
        CHECK (email IS NOT NULL OR mobile_e164 IS NOT NULL)
);

COMMENT ON TABLE app.facility_contact IS
    'One invited human per facility (CMD or matron), business-contact data on a '
    'contract basis. DELIBERATELY NOT append-only -- this row must stay deletable '
    'on request, which is why 010 names it as outside the append-only set. '
    'Nothing here ever reaches app.audit_log, app.ward_status_event, or any public '
    'mirror.';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_facility_contact_touch') THEN
        EXECUTE 'CREATE TRIGGER trg_facility_contact_touch
                     BEFORE UPDATE ON app.facility_contact
                     FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()';
    END IF;
END $$;


-- ============================================================
-- 6. app.device -- binds a ward ACCOUNT to a device. No person involved.
-- ============================================================
-- Survives ward-level identity, re-scoped from a person to a ward account.
--
-- NOTE WHAT WAS REMOVED AND WHY, because the reasoning generalises.
--
-- `fingerprint` is gone. It was header-derived -- which is to say it was a
-- user_agent wearing a different name -- and it existed to power a second-device
-- alert. Two independent reasons it goes:
--
--   1. The alert has no consumer in Sprint 1. No admin surface to fire into, no
--      defined response. That is the same defect that cut blood_status from this
--      sprint, so it gets the same cut.
--   2. The mechanism was self-defeating. The alert works by fingerprinting the
--      UNAUTHORISED device -- and the unauthorised device is, by definition, the
--      personal phone someone forwarded the ward link to. So the control would
--      have captured an online identifier of a personal device: precisely the
--      thing ward-level identity removes, arriving through the control meant to
--      protect it.
--
-- IF IT EVER SHIPS it is a per-facility SALTED HASH, never a raw fingerprint, so
-- what is held is a COUNT OF DISTINCT DEVICES rather than an identifier of any
-- one of them.
CREATE TABLE IF NOT EXISTS app.device (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ward_account_id uuid NOT NULL REFERENCES app.ward_account(id) ON DELETE CASCADE,

    -- The token itself is NEVER stored. Only a hash of it, so a database
    -- disclosure does not hand over working credentials.
    token_hash      text NOT NULL,

    bound_at        timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz,
    revoked_at      timestamptz,

    CONSTRAINT device_token_hash_unique UNIQUE (token_hash)
);

COMMENT ON TABLE app.device IS
    'Binds a ward account to a device. Carries a token HASH and nothing that '
    'identifies a person or a handset. There is no fingerprint column and there '
    'must not be one: it would be a user_agent by another name, on a table joined '
    'to the account, while the audit row bans user_agent outright.';


-- ============================================================
-- 7. app.invite -- THE ONBOARDING CHASE LIST. Not a credential store.
-- ============================================================
-- Records that an invite was issued for a (facility, ward, role), and whether it
-- was accepted. That is the whole job, and it is a job nothing else does: under
-- invite-only onboarding, "who has been invited and has not accepted" IS the
-- launch list.
--
-- WHAT IS NOT HERE, AND WHY EACH ABSENCE IS DELIBERATE.
--
--   email / role_address -- THE ADDRESS LIVES ONCE, in Supabase auth.users. The
--     ward-level identity decision names exactly two residues for it, and a
--     column here would have been a third. Resend does not need us to hold it:
--     Supabase's admin API reads it back from auth.users, which is the falsifier
--     for this design and it does not fire.
--
--   token_hash / expires_at -- Supabase mints, expires, validates and resends the
--     link. Columns here would be a second credential store with NO MINTER AND NO
--     VALIDATOR: decoration, not a control, by the same test that cut the
--     second-device alert. And two lifecycles that can disagree are worse than
--     one we do not own -- the moment expires_at says dead and Supabase says
--     alive, the honest answer to "when does this link stop working?" is
--     whichever one the code happens to check, which nobody will remember.
--
--   consumed_by / created_by -- consumed_by was 1:1 with the account the
--     acceptance creates. created_by in v1 resolves to the controller in every
--     case, so it added no control while putting a person-shaped FK on this table.
--
-- NOT ASSERTED HERE, deliberately -- AND THIS IS AN INHERITED ASSUMPTION, NOT
-- MERELY A REMOVAL. `UNIQUE (token_hash)` was doing SINGLE-USE enforcement, and
-- it was OURS. Dropping it converts an assertion we owned into an assumption
-- about a vendor. Removing our own enforcement is the right trade; inheriting
-- someone else's without a probe is the Clause 5 shape -- a mechanism believed
-- present that nothing here establishes. Magic-link single-use is therefore a
-- HAND CHECK in docs/runbook-supabase-project-creation.md, alongside the
-- eu-west-1 region pin and the hosted exposed-schemas list. Verify it once,
-- empirically, against the version Supabase actually runs.
CREATE TABLE IF NOT EXISTS app.invite (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    facility_id   uuid REFERENCES app.facility(id) ON DELETE CASCADE,

    -- Scoped exactly as app.ward_account is, so an invite and the account it
    -- creates cannot disagree about scope.
    ward_category app.ward_category,

    role          app.app_role NOT NULL,

    invited_at    timestamptz NOT NULL DEFAULT now(),

    -- NULL is the chase list. A facility with an invite and no acceptance is the
    -- one to call.
    accepted_at   timestamptz,

    -- The same three-arm CHECK as app.ward_account (section 4). There is no arm
    -- permitting a facility-less invite below PLATFORM_ADMIN, for the same reason
    -- there is no such account: that shape was an individual account wearing a
    -- role name.
    CONSTRAINT invite_scope_matches_role
        CHECK (
             (role = 'WARD_STAFF'     AND facility_id IS NOT NULL AND ward_category IS NOT NULL)
          OR (role = 'FACILITY_ADMIN' AND facility_id IS NOT NULL AND ward_category IS NULL)
          OR (role = 'PLATFORM_ADMIN' AND facility_id IS NULL     AND ward_category IS NULL)
        )
);

COMMENT ON TABLE app.invite IS
    'The onboarding chase list: who has been invited, to which ward, and whether '
    'they accepted. There is no public self-registration route in this system, so '
    'every account originates from a row here.

     This is NOT a credential store and must not become one. No address, no token '
    'hash, no expiry -- Supabase auth owns the link and the address, and a second '
    'copy of either here would be a store with no minter and no validator.';


-- ============================================================
-- 8. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('003_app_facility_and_identity_tables.sql', now())
ON CONFLICT (filename) DO NOTHING;
