-- ============================================================
-- 004_app_ward_status_tables.sql
-- ============================================================
-- Sprint 1, Bundle 1. The ward status row -- FINDING F1 -- its append-only
-- event history, and the escalation bookkeeping that reads them.
--
-- Empirical state at base: 001 (schema + revoke wall), 002 (13 enum types),
-- 003 (facility, facility_ops, ward_account, facility_contact, device, invite,
-- and app.touch_updated_at()). Verified at apply time: `select filename from
-- app.schema_migrations` returns exactly those three files.
--
-- WARD-LEVEL IDENTITY (decision, 2026-09-08). Nothing in this file attributes a
-- write to a person. ward_status has no updated_by, ward_status_event has no
-- actor_id, and app.challenge has no raised_by -- an account is a ward, so
-- (facility_id, category) IS the actor, and the ward-versus-admin distinction the
-- public tile renders is already carried by ward_status.source.
--
-- Empirical anchors:
--   - 003 section 1: app.touch_updated_at(), reused here rather than redefined.
--     One definition, so a change to the clock rule cannot apply to one table
--     and not another.
--   - 002 section 4: app.ward_offering + app.monitoring_state carry the
--     three-distinct-states requirement between them; the CHECK constraints in
--     section 1 below are what stop the third state collapsing into the second.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS; triggers guarded on pg_trigger.
--
-- Deployment ordering gate: 010 adds the append-only enforcement to
-- app.ward_status_event. Between this migration and that one the event table is
-- writable by the migration role. That window exists only inside a single
-- migration run and no application code exists yet; it is named here rather
-- than left implicit.
--
-- Object ledger -- 5 tables, 2 triggers:
--   app.ward_status        + trg_ward_status_touch
--   app.ward_status_event
--   app.challenge
--   app.ward_alert_state
--   app.system_heartbeat   + trg_system_heartbeat_touch
-- ============================================================


-- ============================================================
-- 1. app.ward_status -- the live row. FINDING F1.
-- ============================================================
-- `accepting` on this table is THE WARD'S OWN CLAIM and is stored untouched,
-- forever. The safety gate -- anaesthetist off duty closes Theatre and Surgical,
-- and so on -- is derived at READ time by app.gate() (006) and written only into
-- the public projection (008). It never overwrites anything here.
--
-- WHY NOT A TRIGGER THAT CLEARS `accepting` WHEN A FLAG GOES TO 'NO':
--   The anaesthetist goes off duty at 22:00 and the trigger clobbers the ward's
--   claim. At 06:00 they are back and there is nothing to restore, because the
--   claim was destroyed. It is also precisely the silent overwrite this design
--   forbids an administrator from doing -- a robot doing it faster and with no
--   attribution.
--
-- NOTE WHAT IS ABSENT: there is no `reason_code` column on this table. Zero
-- reasons live only on app.ward_status_event, so even a catastrophic policy
-- error on the projection leaks a bed count rather than a reason. The ward
-- console reads reasons back through a capped RPC (011), not from this row.
-- tests/db/rls_anon_column_containment.test.ts asserts the absence.
CREATE TABLE IF NOT EXISTS app.ward_status (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id   uuid NOT NULL REFERENCES app.facility(id) ON DELETE CASCADE,
    category      app.ward_category NOT NULL,

    offering      app.ward_offering  NOT NULL DEFAULT 'NOT_OFFERED',

    -- NULL means "never updated". It is NOT zero, and the projection must never
    -- render it as zero.
    bed_count     integer,

    -- THE CLAIM. Never derived, never overwritten by any automatic process.
    accepting     boolean NOT NULL DEFAULT true,

    state         app.status_state     NOT NULL DEFAULT 'OK',
    source        app.status_source    NOT NULL DEFAULT 'WARD',
    monitoring_state app.monitoring_state NOT NULL DEFAULT 'PENDING',

    -- Optimistic concurrency. The write RPC matches on this and returns 409 with
    -- the current row attached when it does not match. An admin challenge also
    -- bumps it, so an in-flight nurse write cannot silently clear a review flag.
    --
    -- On 409 the client must NOT auto-retry with the fresh version -- that is
    -- last-write-wins with extra steps. It shows the conflict. Friction is
    -- correct here.
    version       integer NOT NULL DEFAULT 1,

    -- Server-stamped by trg_ward_status_touch. Never client-supplied (F3).
    updated_at    timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ward_status_one_row_per_ward UNIQUE (facility_id, category),

    -- Upper bound is a typo guard, not a capacity model: no ward in this system
    -- has 500 beds, and a fat-fingered 4000 published as fact is worse than a
    -- rejected write.
    CONSTRAINT ward_status_bed_count_sane CHECK (bed_count IS NULL OR bed_count BETWEEN 0 AND 500),

    -- THE THREE DISTINCT STATES, ENFORCED RATHER THAN DOCUMENTED.
    --   NOT_OFFERED                          -> bed_count IS NULL
    --   OFFERED + bed_count = 0              -> exists, currently full
    --   OFFERED + bed_count IS NULL          -> exists, never yet reported
    -- Without this constraint a NOT_OFFERED ward can carry a stale count, and
    -- the projection then has to guess which of the three it is looking at.
    CONSTRAINT ward_status_not_offered_has_no_count
        CHECK (offering = 'OFFERED' OR bed_count IS NULL)
);

COMMENT ON TABLE app.ward_status IS
    'One row per (facility, category). `accepting` is the ward''s own claim and is '
    'never derived, never overwritten by an automatic process, and never gated '
    'here -- gating happens at read time in app.gate() and lands only in '
    'public.ward_public.accepting_effective.';

COMMENT ON COLUMN app.ward_status.accepting IS
    'FINDING F1. The ward''s claim, stored untouched. A duty-flag gate reduces '
    'what the public sees; it never edits this value. Flipping a duty flag back to '
    'YES or UNKNOWN restores the public state with zero writes to this table.';

COMMENT ON COLUMN app.ward_status.bed_count IS
    'NULL means never reported, which is a different thing from zero. Rendering '
    'NULL as 0 publishes a claim the facility never made.';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ward_status_touch') THEN
        EXECUTE 'CREATE TRIGGER trg_ward_status_touch
                     BEFORE UPDATE ON app.ward_status
                     FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()';
    END IF;
END $$;


-- ============================================================
-- 2. app.ward_status_event -- append-only history.
-- ============================================================
-- Enforcement (REVOKE + a BEFORE UPDATE OR DELETE trigger declared ENABLE
-- ALWAYS) lands in 010. This table is created first because 011's read RPC and
-- the write path both address it.
CREATE TABLE IF NOT EXISTS app.ward_status_event (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ward_status_id uuid NOT NULL REFERENCES app.ward_status(id) ON DELETE RESTRICT,

    -- Denormalised so history survives and remains queryable by facility even if
    -- a ward row is restructured. ON DELETE RESTRICT above means it cannot be
    -- orphaned in the first place; this is belt and braces on an append-only
    -- table, where a repair is not available after the fact.
    facility_id    uuid NOT NULL REFERENCES app.facility(id) ON DELETE RESTRICT,
    category       app.ward_category NOT NULL,

    offering       app.ward_offering NOT NULL,
    bed_count      integer,
    accepting      boolean NOT NULL,
    state          app.status_state  NOT NULL,
    source         app.status_source NOT NULL,

    -- PRIVATE, AND THIS IS THE ONLY TABLE IT EXISTS ON (finding F1).
    -- Never projected, never published, never returned to an anonymous caller.
    reason_code    app.zero_reason,

    -- Mandatory when source = 'ADMIN'. Private. The public tile says only "set by
    -- admin, not ward-confirmed"; the reason an admin overrode a ward is between
    -- the admin, the ward and the audit trail.
    admin_note     text,

    -- THERE IS NO actor_id, AND ITS ABSENCE IS THE DESIGN (ward-level identity,
    -- 2026-09-08). An earlier draft carried an opaque actor_id resolved through
    -- app.actor_identity_map, severed after an attribution window. Both are gone:
    -- with no individual accounts there is nothing to map and nothing to sever,
    -- so the event stream is clean by construction rather than by expiry.
    --
    -- There is deliberately no session_id here either. The decision enumerates
    -- the AUDIT row exhaustively; the event row is not enumerated, and adding an
    -- identity-shaped column to the event stream is exactly the sibling-field
    -- creep the audit-column guard exists to stop. Burst correlation is already
    -- available from client_mutation_id + created_at + (facility_id, category).

    version        integer NOT NULL,

    -- Idempotency for the write path: a retried request with the same value is
    -- applied once.
    client_mutation_id text,

    -- When the CLIENT composed the write. The server rejects anything older than
    -- two minutes with STALE_MUTATION. Built even though no offline queue exists,
    -- because it makes any rogue replay -- a resurrected service worker, a
    -- retried fetch, a back button -- harmless by construction rather than by
    -- vigilance.
    composed_at    timestamptz,

    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ward_status_event_admin_note_requires_admin
        CHECK (source = 'ADMIN' OR admin_note IS NULL),

    CONSTRAINT ward_status_event_bed_count_sane
        CHECK (bed_count IS NULL OR bed_count BETWEEN 0 AND 500)
);

-- THE COMMENT THE KICKOFF REQUIRES, AND IT STATES THE PRODUCT REASON RATHER THAN
-- THE RULE. An assistant that reads this will not build the chart.
COMMENT ON TABLE app.ward_status_event IS
    'Append-only history of every published ward status.

     DO NOT BUILD A PUBLIC TIME SERIES ON THIS TABLE. Not a 7-day occupancy chart,
     not a facility comparison, not a weekly digest, not an export. The read RPCs
     in 011 are hard-capped at 200 rows and a 30-day window, with no offset
     paging and no CSV, specifically so that a legitimate caller cannot assemble
     one.

     The reason is not privacy paperwork. History is private because facilities
     that fear being graded stop telling the truth, and a dishonest bed count
     kills someone. A table called ward_status_event makes an occupancy chart the
     most natural thing in the world to offer, which is exactly why the
     prohibition is written here, on the table, rather than in a document nobody
     opens.';

COMMENT ON COLUMN app.ward_status_event.reason_code IS
    'PRIVATE. The only place a zero reason is stored. Distinct in type and in '
    'wording from public.ward_public.gated_by, which is a gate_reason -- they '
    'collide by name and someone will render the private one because the switch '
    'matched.';


-- ============================================================
-- 3. app.challenge -- an admin questions a ward's number.
-- ============================================================
-- Sets ward_status.state = 'UNDER_REVIEW' and enqueues a ward ping. NEVER
-- touches bed_count or accepting: an administrator who disbelieves a number does
-- not get to silently replace it, they get to ask.
--
-- Ward-scoped, with no individual attribution on either side of the exchange.
CREATE TABLE IF NOT EXISTS app.challenge (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ward_status_id uuid NOT NULL REFERENCES app.ward_status(id) ON DELETE CASCADE,
    -- No raised_by / resolved_by, and NO raised_by_scope EITHER. The absence is a
    -- deliberate scope decision, not a gap -- do not read it as "source unknown".
    --
    -- EVERY CHALLENGE IN V1 IS PLATFORM-SOURCED BY CONSTRUCTION, because Sprint 1
    -- ships no facility-admin surface at all. That is the same reason quiet mode
    -- is founder-flipped. So a two-value enum would have one unreachable value,
    -- which is the shape that got blood_status cut.
    --
    -- Deferring costs nothing, and the asymmetry is worth knowing: after the
    -- ledger goes live, `ALTER TYPE ... ADD VALUE` remains permitted and cheap --
    -- it is REMOVAL and REORDERING that are expensive. So the value can be added
    -- in the same change that ships facility-admin challenge, and only then.
    raised_at      timestamptz NOT NULL DEFAULT now(),
    resolved_at    timestamptz,

    -- Private. Never surfaces on a public tile.
    admin_note     text
);


-- ============================================================
-- 4. app.ward_alert_state -- escalation episode bookkeeping.
-- ============================================================
-- Consumed by B5's sweep. Created here because the sweep's idempotency key
-- needs these columns to exist before the dispatcher does.
CREATE TABLE IF NOT EXISTS app.ward_alert_state (
    ward_status_id uuid NOT NULL REFERENCES app.ward_status(id) ON DELETE CASCADE,
    cause          app.alert_cause NOT NULL,

    -- The ward's updated_at at the moment staleness began. It does NOT change
    -- until the ward actually updates, which is what makes the sweep a single
    -- idempotent INSERT ... SELECT ... ON CONFLICT DO NOTHING. Running it twice,
    -- concurrently, from two schedulers is then free -- and that is what makes
    -- the dual-scheduler design cost nothing to reason about.
    episode_start  timestamptz NOT NULL,

    last_alert_at  timestamptz,

    -- Drives the escalating cooldown: immediate, +2h, +6h, +24h, capped. A ward
    -- stale for three days produces 5 alerts, not 288.
    alert_count    integer NOT NULL DEFAULT 0,

    -- Every suppressed alert is COUNTED, never silently dropped. This number is
    -- both the gaming detector and the only later evidence that suppression is
    -- not hiding real failures.
    suppressed_count integer NOT NULL DEFAULT 0,

    acked_at       timestamptz,
    updated_at     timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (ward_status_id, cause)
);


-- ============================================================
-- 5. app.system_heartbeat -- one row, and it is a liveness sensor.
-- ============================================================
-- The sweep writes last_sweep_at on every run. /api/health returns 500 when it
-- is older than 45 minutes, and an external prober that does not share the
-- failure mode it measures turns that into an email.
--
-- The reason this exists at all: Supabase pauses a free project after 7 days of
-- low activity, pg_cron's own activity does NOT count toward preventing the
-- pause, and a paused project's sweep stops silently. pg_cron cannot report its
-- own death, because it is the thing that is off.
CREATE TABLE IF NOT EXISTS app.system_heartbeat (
    -- Single-row table. The CHECK is what makes it single-row.
    id            boolean PRIMARY KEY DEFAULT true,
    last_sweep_at timestamptz,
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT system_heartbeat_is_singleton CHECK (id)
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_system_heartbeat_touch') THEN
        EXECUTE 'CREATE TRIGGER trg_system_heartbeat_touch
                     BEFORE UPDATE ON app.system_heartbeat
                     FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()';
    END IF;
END $$;

INSERT INTO app.system_heartbeat (id, last_sweep_at) VALUES (true, NULL)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 6. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('004_app_ward_status_tables.sql', now())
ON CONFLICT (filename) DO NOTHING;
