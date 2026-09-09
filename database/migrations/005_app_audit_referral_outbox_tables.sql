-- ============================================================
-- 005_app_audit_referral_outbox_tables.sql
-- ============================================================
-- Sprint 1, Bundle 1. The audit log, outcome capture, and the escalation outbox.
--
-- WARD-LEVEL IDENTITY (decision, 2026-09-08). This file previously carried
-- app.actor_identity_map and an A5 decaying-attribution split. Both are DELETED:
-- with no individual accounts there is no natural person to map and nothing to
-- sever. The audit log now contains no personal data at all, which is why it
-- needs no retention period and no partitioning.
--
-- Empirical state at base: 001-004 applied. app.ward_status and
-- app.ward_status_event exist; app.ward_account and app.facility_contact exist.
--
-- Empirical anchors:
--   - 004 section 2: app.ward_status_event carries NO actor_id. The event stream
--     and the audit log are both clean by construction.
--   - 003 section 5: app.facility_contact is the notification recipient and is
--     deliberately outside 010's append-only set.
--   - 002 section 9: app.alert_cause, app.alert_state, app.notification_channel.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS throughout.
--
-- Deployment ordering gate: 010 makes app.audit_log append-only. As with 004,
-- the table is writable by the migration role between this file and that one.
--
-- Object ledger -- 4 tables:
--   app.audit_log
--   app.referral
--   app.alert
--   app.notification_outbox
-- ============================================================


-- ============================================================
-- 1. app.audit_log -- permanent, and containing NO PERSONAL DATA AT ALL.
-- ============================================================
-- Ward-level identity decision, 2026-09-08, CTO condition (1).
--
-- The exhaustive shape is: facility_id, ward_category, action, old_value,
-- new_value, version, occurred_at, session_id -- plus the surrogate key below.
-- packages/fixtures/audit-log-columns.json holds that list, and two guards
-- assert it: scripts/lint_audit_log_columns.sh statically over the migrations,
-- and tests/db/audit_log_column_list.test.ts over information_schema.
--
-- FOUR COLUMNS WERE REMOVED, AND THREE OF THEM ARE THE POINT.
--   actor_id     -- there is no natural person in the system to point at.
--   subject_type / subject_id -- `subject_id text` accepted ANY identifier: an
--                   account id, an address, anything. facility_id +
--                   ward_category are the subject now.
--   detail jsonb -- THE MOST IMPORTANT REMOVAL HERE. Its own comment already
--                   conceded it was "the most likely place in the schema for the
--                   no-patient-data invariant to fail, because jsonb accepts
--                   anything". A guard keyed to a COLUMN LIST is structurally
--                   blind to `detail->>'ip'`, so keeping this column would have
--                   made CTO condition (1) VACUOUS AGAINST THE EXACT ATTACK IT
--                   NAMES. old_value/new_value replace it, capped.
--
-- Retention: NONE, and none is needed. The earlier design carried a decaying
-- attribution window and a severing job; both are deleted, because with no
-- personal data in this table storage limitation does not bite on it.
-- Append-only and permanent is correct. This resolves, in favour of A5, the
-- contradiction between A5 ("the operational record survives permanently,
-- pseudonymous") and the kickoff's Sprint 2 line ("pseudonymous events 24
-- months") -- recorded here so it is not reopened.
--
-- Partitioning was recommended earlier to provide a lawful deletion path. That
-- problem is gone, so partitioning is NOT built. Considered and declined.
CREATE TABLE IF NOT EXISTS app.audit_log (
    -- SURROGATE KEY, and it is a reading of "nothing else" rather than an
    -- oversight. It carries no information about anyone -- a monotonic counter
    -- over the table, identical in kind to app.ward_status_event.id, which nobody
    -- has called attribution. Without it an append-only log has no addressable
    -- row and cannot be cited in a discrepancy report, which is what the log is
    -- for. It is enumerated in the guard's fixture, so disagreeing with this
    -- reading is a one-line diff and a red test, not a silent choice.
    --
    -- IT MUST NEVER REACH THE PUBLIC SNAPSHOT: a sequential id leaks total write
    -- volume across every facility.
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- NULLABLE: a platform-scope action has no facility, and forcing a sentinel
    -- would be worse. Note that 010 makes this table append-only, so a later
    -- migration cannot relax a NOT NULL here -- nullable is the reversible choice
    -- and it is being made deliberately, in the window, while it still can be.
    facility_id   uuid REFERENCES app.facility(id) ON DELETE RESTRICT,

    -- The ward. NEVER the person. NULL means a facility-scope action.
    ward_category app.ward_category,

    -- Machine-readable verb, e.g. 'ward_status.publish'. Clients map codes;
    -- nothing keys off message text. The CHECK makes a sentence unrepresentable
    -- rather than merely discouraged -- which is the lesson of `detail`.
    action        text NOT NULL,

    -- Structured before/after values. The length cap is a SAFETY control, not a
    -- storage one, in the same idiom as referral_ward_reply_capped: 256
    -- characters holds {"bed_count":4,"accepting":true} and does not hold a
    -- narrative. A narrative is where a patient enters a system that has none.
    --
    -- AN OVERSIZED VALUE IS REJECTED, NEVER TRUNCATED. The CHECK constraints
    -- below raise 23514; Postgres does not truncate on a CHECK, so the schema
    -- already behaves correctly and tests/db/audit_log_value_cap.test.ts proves
    -- it. The rule is written here because THE RISK IS NOT IN THE SCHEMA -- it is
    -- in the Bundle 3 writer, which will one day meet a value that does not fit
    -- and be tempted to make it fit.
    --
    -- It must not. A silently truncated audit value is a data-integrity failure
    -- that would NEVER GO RED: the record looks complete and is wrong, and
    -- nothing downstream can tell the difference. If a value does not fit, the
    -- write fails and the caller is told. If values legitimately need more room,
    -- raise the cap in a migration with a reason -- do not shrink the data to
    -- suit the column.
    old_value     jsonb,
    new_value     jsonb,

    version       integer,

    occurred_at   timestamptz NOT NULL DEFAULT now(),

    -- OPAQUE, SHORT-LIVED, NOT DERIVABLE BACK TO A MAILBOX (CTO condition 2).
    -- uuid rather than text, because a uuid is structurally incapable of carrying
    -- an address while a text column is not.
    --
    -- THE SCHEMA CANNOT ENFORCE ANY OF THOSE THREE PROPERTIES. A CHECK may not
    -- call auth.uid(), so nothing here stops a future writer stamping auth.uid()
    -- into this column -- which would be a stable per-account identifier across
    -- every session, the exact opposite of short-lived, and it would look correct
    -- in review. That rule belongs to the Bundle 3 writer RPC and must be
    -- asserted there. Named here rather than implied by the type.
    --
    -- There is deliberately NO app.session table for this to reference. Such a
    -- table is where the mailbox link would come back.
    session_id    uuid,

    CONSTRAINT audit_log_action_is_a_verb
        CHECK (action ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),

    CONSTRAINT audit_log_old_value_capped
        CHECK (old_value IS NULL OR length(old_value::text) <= 256),

    CONSTRAINT audit_log_new_value_capped
        CHECK (new_value IS NULL OR length(new_value::text) <= 256)
);

COMMENT ON TABLE app.audit_log IS
    'Append-only operational record containing NO PERSONAL DATA. The actor is a '
    'ward -- (facility_id, ward_category) -- never a person, because no natural '
    'person has an account in this system.

     Do not add a column here without changing packages/fixtures/audit-log-columns.json
     in the same commit: two guards assert the column list for EXACT equality, and
     that is what stops an ip_address or a user_agent arriving through a sibling
     field nobody thought to forbid.';


-- ============================================================
-- 2. app.referral -- outcome capture (Bundle 6's table, created here).
-- ============================================================
-- A record of a DISCREPANCY between recorded and observed state. NOT a report of
-- misconduct. That framing is in this comment as well as in the UI because the
-- schema is read by more people than the label is, and framing determines what
-- people write and what a court later reads back.
CREATE TABLE IF NOT EXISTS app.referral (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- WARD-TO-WARD. Resolved from auth.uid() inside the RPC, NEVER from a
    -- parameter. The referring party is a ward, not a clinician: this is the one
    -- place the ward-level identity decision could be undone later by accident,
    -- so it is shaped correctly before anything is built on it.
    referrer_facility_id uuid NOT NULL REFERENCES app.facility(id) ON DELETE RESTRICT,
    referrer_category    app.ward_category NOT NULL,

    -- BOTH SIDES ARE EXPLICITLY QUALIFIED. Two facility-shaped columns on one
    -- table with one of them called plain `facility_id` is a bug factory, and
    -- after the first hosted push it could not be renamed without also touching
    -- 012's index.
    receiving_facility_id uuid NOT NULL REFERENCES app.facility(id) ON DELETE RESTRICT,
    receiving_category    app.ward_category NOT NULL,

    state        app.referral_state NOT NULL DEFAULT 'PENDING',

    -- Structured only. There is deliberately no free-text sibling anywhere on
    -- this table: `refusal_note` was removed from the first schema draft because
    -- free text is where "the 24yo primip from Ikorodu we called about at 3am"
    -- ends up, and that single sentence would break the no-patient-data
    -- invariant that is this project's most valuable compliance asset.
    refusal_reason app.refusal_reason,

    -- The structured fields the discrepancy record consists of.
    portal_viewed_at timestamptz,
    arrived_at       timestamptz,

    -- KEPT, capped, private, never public. The right of reply is the qualified-
    -- privilege defence: it is what makes a discrepancy report defensible rather
    -- than a publication about a named facility. It carries the same retention as
    -- an attributed log entry.
    --
    -- The length cap is a safety control, not a storage one: a 1000-character box
    -- invites a narrative, and a narrative about a transfer contains a patient.
    -- Validation for patient information also runs at the RPC layer.
    ward_reply       text,
    ward_replied_at  timestamptz,

    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT referral_ward_reply_capped
        CHECK (ward_reply IS NULL OR char_length(ward_reply) <= 1000),

    CONSTRAINT referral_refusal_reason_requires_refused
        CHECK (state = 'REFUSED' OR refusal_reason IS NULL),

    -- A ward does not refer to itself.
    CONSTRAINT referral_not_self
        CHECK (referrer_facility_id <> receiving_facility_id
            OR referrer_category   <> receiving_category)
);

COMMENT ON TABLE app.referral IS
    'A referral and its outcome, WARD TO WARD. No individual clinician is
     recorded on either side, because no individual has an account. A DISCREPANCY_REPORTED row records a difference '
    'between what the portal showed and what was observed on arrival -- it is not '
    'an allegation about a facility or a person.

     NOTHING HERE IS PUBLISHED. No comparison view, no facility-level figure in '
    'any funder material, no export. That is an architectural constraint rather '
    'than a default setting, because the qualified-privilege defence depends on '
    'not publishing beyond the interested parties.

     No accuracy score reads this table in Sprint 1. The raw capture exists so a '
    'score is computable later; the scoring, the digest and the surfacing are '
    'deliberately not built.';


-- ============================================================
-- 3. app.alert -- one row per escalation episode, per cause.
-- ============================================================
CREATE TABLE IF NOT EXISTS app.alert (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ward_status_id uuid NOT NULL REFERENCES app.ward_status(id) ON DELETE CASCADE,
    cause          app.alert_cause NOT NULL,

    -- See app.ward_alert_state.episode_start (004). Stable for the life of the
    -- episode, which is what makes the unique constraint below an idempotency key
    -- rather than a race.
    episode_start  timestamptz NOT NULL,

    state          app.alert_state NOT NULL DEFAULT 'QUEUED',

    -- Set whenever state = 'SUPPRESSED'. NEVER a silent drop: a suppressed alert
    -- that left no row is indistinguishable from an alert that was never needed,
    -- and the difference is the only evidence that suppression is not hiding real
    -- failures.
    suppressed_reason text,

    created_at     timestamptz NOT NULL DEFAULT now(),

    -- THE IDEMPOTENCY KEY. Makes the sweep a single
    -- INSERT ... SELECT ... ON CONFLICT DO NOTHING, so running it twice, or
    -- concurrently from two schedulers, is free. That property is what lets the
    -- dual scheduler (pg_cron plus an external caller that does not share its
    -- failure mode) cost nothing to reason about.
    CONSTRAINT alert_episode_idempotent UNIQUE (ward_status_id, cause, episode_start),

    CONSTRAINT alert_suppressed_has_reason
        CHECK (state <> 'SUPPRESSED' OR suppressed_reason IS NOT NULL)
);


-- ============================================================
-- 4. app.notification_outbox -- transactional outbox.
-- ============================================================
-- The row is enqueued in the SAME TRANSACTION as the write that caused it. A
-- separate dispatcher (FOR UPDATE SKIP LOCKED) delivers it. Never
-- fire-and-forget from the write path: a provider timeout must not roll back a
-- bed count, and a lost notification must not be invisible.
CREATE TABLE IF NOT EXISTS app.notification_outbox (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id     uuid REFERENCES app.alert(id) ON DELETE CASCADE,

    -- Points at app.facility_contact, which is NOT in 010's append-only set, so
    -- ON DELETE SET NULL stays executable and the contact remains individually
    -- deletable on request.
    recipient_contact_id uuid REFERENCES app.facility_contact(id) ON DELETE SET NULL,

    -- Written by the adapter. NOTHING OUTSIDE THE NOTIFICATION ADAPTER MAY READ
    -- THIS COLUMN. That is the test of whether the adapter boundary was drawn
    -- correctly: switching the launch channel from email to SMS must touch no
    -- caller.
    channel      app.notification_channel NOT NULL,

    state        app.alert_state NOT NULL DEFAULT 'QUEUED',

    attempts        integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz,

    -- Provider error text. Machine-facing; never rendered to a facility.
    last_error   text,

    dispatched_at timestamptz,

    -- Set from a provider webhook. DELIVERED means accepted by the receiving
    -- server, WHICH INCLUDES ACCEPTED INTO A SPAM FOLDER. The provider's own
    -- success signal is actively misleading here, so this column is not evidence
    -- that anyone saw anything.
    delivered_at timestamptz,

    -- The only column that is evidence a human saw it. One tap on a tokenised
    -- link, no login required. This is why the daily synthetic probe and the
    -- weekly reply-OK check exist: without an ack, a healthy sweep and a dead
    -- delivery layer look identical, and every light in the stack stays green.
    acked_at     timestamptz,

    -- Hash only, never the token itself.
    ack_token_hash text,

    created_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT notification_outbox_ack_token_hash_unique UNIQUE (ack_token_hash)
);

COMMENT ON COLUMN app.notification_outbox.delivered_at IS
    'Provider said the receiving server accepted the message. That includes '
    'acceptance into a spam folder. Not evidence of delivery to a human -- only '
    'acked_at is that.';


-- ============================================================
-- 5. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('005_app_audit_referral_outbox_tables.sql', now())
ON CONFLICT (filename) DO NOTHING;
