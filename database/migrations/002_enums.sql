-- ============================================================
-- 002_enums.sql
-- ============================================================
-- Sprint 1, Bundle 1. Every enumerated domain in the system, in `app`.
--
-- Empirical state at base: schema `app` exists (001); it contains only
-- `app.schema_migrations`. No types, no tables.
--
-- WHY ENUMS AND NOT text + CHECK. The kickoff's single most valuable compliance
-- asset is the no-patient-data invariant, and free text is where it dies: a
-- `refusal_note` column is where "the 24yo primip from Ikorodu we called about
-- at 3am" ends up. An enum makes that unrepresentable rather than discouraged.
-- The cost is real and accepted: adding a value is cheap (ALTER TYPE ... ADD
-- VALUE), removing one is not.
--
-- Idempotency: each type is created inside a DO block guarded on pg_type. A
-- re-apply is a no-op. NOTE that this means editing a value in this file does
-- NOT change an already-created type -- that requires a new migration, by
-- design.
--
-- Deployment ordering gate: none. 003 onward depend on this file; nothing
-- depends on them yet.
--
-- Type ledger -- 14 types.
--   FROM THE KICKOFF'S B1 LIST (10 of its 11):
--     ward_category, tri_state, ward_offering, zero_reason, status_state,
--     status_source, app_role, referral_state, refusal_reason, monitoring_state
--
--   NOT BUILT, from that same list (1):
--     blood_status -- CUT from Sprint 1 by the ward-level identity decision
--                     (2026-09-08). It failed the standing test: nothing said
--                     what it means, who maintains it, or how often. It is not
--                     created here rather than created-and-dropped, because in
--                     the pre-first-push window the honest action is that the
--                     type never existed. If blood ships in a later sprint, the
--                     display-only verdict and its three clinical conditions are
--                     already settled and can be lifted straight out of the
--                     closeout pasteback -- and the column must be app.tri_state,
--                     NOT a new type, so that it inherits the duty-flag guards
--                     instead of escaping them the way a distinct type would.
--   ADDED, with reasons, because the kickoff's own B1 TABLE list requires them
--   while its ENUM list omits them (4):
--     gate_reason          -- the kickoff mandates that `gated_by` and
--                             `zero_reason.NO_ANAESTHETIST` "must be different
--                             types with different UI strings", then does not
--                             list the type that makes them different. Without
--                             it the requirement is unimplementable.
--     alert_cause          -- required by app.alert (005).
--     alert_state          -- required by app.alert and app.notification_outbox
--                             (005). The kickoff names the SUPPRESSED value
--                             explicitly ("every suppressed alert is written
--                             with state=SUPPRESSED and a reason").
--     notification_channel -- required by app.notification_outbox (005). The
--                             kickoff requires channels be pluggable and that
--                             "nothing outside the adapter may know which
--                             channel was used", which is a statement about a
--                             typed column that exists.
-- ============================================================


-- ============================================================
-- 1. tri_state -- FINDING F2. The most consequential type in the schema.
-- ============================================================
-- Three states, never two. Columns of this type are NOT NULL DEFAULT 'UNKNOWN',
-- so "nobody has said" is a value rather than an absence.
--
-- The bug this exists to prevent: `anaesthetist_on_duty BOOLEAN` plus
-- `if (!facility.anaesthetist_on_duty)` renders every hospital in Lagos as
-- closed on day one, because no facility has touched the flag yet. In SQL the
-- same expression is worse -- `not <null>` is `null`, which is not `true`, so
-- the row silently drops out of a filtered query while the JavaScript version
-- reports it truthy. The two layers disagree and neither errors.
--
-- Only an explicit 'NO' gates anything. Use `is false` / `is not false` in SQL;
-- never a bare `not`. scripts/lint_sql_no_bare_not_duty_flag.sh enforces the SQL
-- side and the ESLint no-restricted-syntax rule in eslint.config.mjs enforces
-- the TypeScript side.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'tri_state' AND n.nspname = 'app') THEN
        CREATE TYPE app.tri_state AS ENUM ('UNKNOWN', 'YES', 'NO');
    END IF;
END $$;


-- ============================================================
-- 2. ward_category -- the ten published categories.
-- ============================================================
-- Six are gated by a duty flag, four are not:
--   THEATRE, SURGICAL                                <- anaesthetist
--   NICU, SCBU, PAEDIATRIC, ICU_PAEDIATRIC           <- paediatrician
--   MATERNITY                                        <- obstetrician
--   A_AND_E, ICU_ADULT, MEDICAL_ADULT                -- ungated
-- app.gate() in 006 is the single site where that mapping exists.
--
-- ============================================================
-- HOW THIS SET WAS ARRIVED AT, AND WHAT IS DELIBERATELY NOT SPLIT.
-- ============================================================
-- THE KICKOFF NEVER ENUMERATED THESE. It states "all eight categories" as a
-- contract (Gate 3) and names `paediatrician closes NICU/SCBU` as a duty-flag
-- rule, but it lists no category values anywhere. The set was therefore chosen
-- at implementation time, 2026-09-08. On 2026-09-09 an audit of every enum --
-- asking not "are the values right" but "is any value one we would later want to
-- SPLIT or DROP", because adding is cheap and removing is not -- found two
-- defects in that choice. Both are corrected here, in the window, before the
-- first hosted push makes them permanent.
--
--   ICU -> ICU_ADULT + ICU_PAEDIATRIC. Ventilator circuits, tube sizes, drug
--     dosing and nursing competency all differ between adult and paediatric
--     intensive care. A dispatcher routing a child to a facility showing free
--     "ICU" beds that are adult beds has been handed a false positive by the
--     tile. Note `ICU` is not kept to mean adult: a label that answers a
--     narrower question than the reader asked is the defect being removed.
--
--   GENERAL_MEDICAL -> MEDICAL_ADULT, and PAEDIATRIC added. There was no tile
--     at all for a general paediatric admission, which is commoner than a
--     paediatric ICU one. This was an omission in the set proposed at
--     implementation time, not a value that was lost from a specification --
--     the specification never had one.
--
--   Why PAEDIATRIC and not MEDICAL_PAEDIATRIC: most children's wards take
--     medical AND post-surgical children in one unit, so the narrower name
--     would be the same defect in the other direction. The resulting asymmetry
--     with MEDICAL_ADULT is correct, because the underlying reality is
--     asymmetric: adult wards divide medical from surgical, children's wards
--     usually do not. Accuracy beats symmetry in a label that is permanent.
--
-- NOT SPLIT, DELIBERATELY -- recorded so an absent split reads as a decision
-- someone can challenge rather than an oversight nobody noticed:
--   THEATRE, A_AND_E, SURGICAL, MATERNITY are usually one unit taking both
--   adults and children.
--
--   THE RESIDUAL, recorded rather than solved: if PAEDIATRIC absorbs
--   post-operative children then SURGICAL is now DE FACTO ADULT -- the same
--   implicit narrowing, one value further out. This cannot be chased to
--   completion by naming, because where wards divide by age varies by facility
--   and by ward type. It is a clinical-structure question and is open with the
--   clinician.
--
--   The male/female medical split stays closed. It was decided on a DIFFERENT
--   AXIS -- sex, not age -- so splitting on age does not reopen it.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'ward_category' AND n.nspname = 'app') THEN
        CREATE TYPE app.ward_category AS ENUM (
            'A_AND_E',
            'ICU_ADULT',
            'ICU_PAEDIATRIC',
            'MEDICAL_ADULT',
            'PAEDIATRIC',
            'THEATRE',
            'SURGICAL',
            'MATERNITY',
            'NICU',
            'SCBU'
        );
    END IF;
END $$;


-- ============================================================
-- 3. gate_reason -- PUBLIC. Derived from a public duty flag.
-- ============================================================
-- MUST NOT share values with zero_reason (section 5). They collide by name and
-- someone will render the private one because the switch matched. The values
-- here are deliberately longer and differently worded so a copy-paste between
-- the two switches fails to compile rather than silently leaking.
--   public  gate_reason.NO_ANAESTHETIST_ON_DUTY  -- safe to show anyone
--   private zero_reason.NO_ANAESTHETIST          -- ward-entered, never public
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'gate_reason' AND n.nspname = 'app') THEN
        CREATE TYPE app.gate_reason AS ENUM (
            'NO_ANAESTHETIST_ON_DUTY',
            'NO_PAEDIATRICIAN_ON_DUTY',
            'NO_OBSTETRICIAN_ON_DUTY'
        );
    END IF;
END $$;


-- ============================================================
-- 4. ward_offering + monitoring_state -- the three-distinct-states requirement.
-- ============================================================
-- The kickoff: "Three distinct states, never collapsed: NOT_OFFERED,
-- offered-with-count-0, and offered-but-never-updated."
--
-- They are carried by three columns together, not one:
--   offering = 'NOT_OFFERED'                        -- this ward does not exist here
--   offering = 'OFFERED', bed_count = 0             -- exists, currently full
--   offering = 'OFFERED', bed_count IS NULL,
--     monitoring_state = 'PENDING'                  -- exists, never yet reported
--
-- Collapsing the third into the second publishes "0 beds" for a ward nobody has
-- ever updated, which is a claim the facility never made.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'ward_offering' AND n.nspname = 'app') THEN
        CREATE TYPE app.ward_offering AS ENUM ('OFFERED', 'NOT_OFFERED');
    END IF;
END $$;

-- PENDING -> ACTIVE -> PAUSED. A ward is PENDING until its first successful
-- update from a logged-in device, and no silence alert ever fires for a PENDING
-- ward. This makes the first night generate zero alerts by construction rather
-- than by special case: staleness is only meaningful for a ward that has
-- demonstrated someone can and will update it.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'monitoring_state' AND n.nspname = 'app') THEN
        CREATE TYPE app.monitoring_state AS ENUM ('PENDING', 'ACTIVE', 'PAUSED');
    END IF;
END $$;


-- ============================================================
-- 5. zero_reason -- PRIVATE. Ward-entered. Never reaches a public mirror.
-- ============================================================
-- Lives only on app.ward_status_event, never on app.ward_status, so even a
-- catastrophic policy error leaks a bed count rather than a reason (finding F1).
--
-- One-tap chips, whole flow under three seconds, no free text. That speed is a
-- safety control, not a nicety: setting 0 must not cost more than setting 1, or
-- staff will park wards at 1 and a chronic "1 bed" that is actually 0, wearing a
-- green badge, is the most misleading state this system can produce.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'zero_reason' AND n.nspname = 'app') THEN
        CREATE TYPE app.zero_reason AS ENUM (
            'ALL_BEDS_OCCUPIED',
            'NO_ANAESTHETIST',
            'STAFF_SHORTAGE',
            'EQUIPMENT_UNAVAILABLE',
            'WARD_CLOSED',
            'AWAITING_DISCHARGE',
            'INFECTION_CONTROL',
            'OTHER'
        );
    END IF;
END $$;


-- ============================================================
-- 6. status_state + status_source.
-- ============================================================
-- UNDER_REVIEW is set by an admin challenge, which never touches bed_count or
-- accepting -- it only marks the row and pings the ward.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'status_state' AND n.nspname = 'app') THEN
        CREATE TYPE app.status_state AS ENUM ('OK', 'UNDER_REVIEW');
    END IF;
END $$;

-- ADMIN means the public tile must render "set by admin, not ward-confirmed".
-- The distinction is the whole point: an admin-set number carries different
-- weight from a ward-set one and the reader is entitled to know which they have.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'status_source' AND n.nspname = 'app') THEN
        CREATE TYPE app.status_source AS ENUM ('WARD', 'ADMIN');
    END IF;
END $$;


-- ============================================================
-- 7. app_role.
-- ============================================================
-- Anonymous public read needs no account and therefore appears nowhere here.
-- Invite-only onboarding; no public self-registration route exists.
--
-- THERE IS NO 'REFERRER', AND ITS ABSENCE IS LOAD-BEARING (ward-level identity
-- decision, 2026-09-08). The role existed for "a REFERRER who belongs to no
-- participating facility" -- an account with no facility and no ward, which is
-- an individual account wearing a role name. With it gone, the scope CHECK on
-- app.ward_account (003) has NO arm permitting a facility-less account, so an
-- individual account is unrepresentable rather than merely absent.
--
-- A referrer is simply a ward account at a participating facility. A clinician
-- at a facility outside the pilot cannot file an outcome; that is a named v1
-- scope boundary, not an oversight -- an outcome filed by an unknown clinician
-- at an unverified facility is data nothing in this system can learn from, and
-- the accuracy score that would have consumed it is already cut from Sprint 1.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'app_role' AND n.nspname = 'app') THEN
        CREATE TYPE app.app_role AS ENUM (
            'WARD_STAFF',
            'FACILITY_ADMIN',
            'PLATFORM_ADMIN'
        );
    END IF;
END $$;


-- ============================================================
-- 8. referral_state + refusal_reason.
-- ============================================================
-- DISCREPANCY_REPORTED is the internal name for what the kickoff calls
-- FALSE_NEGATIVE_REPORTED. Renamed at the schema level, not only in the UI:
-- the record is a discrepancy between recorded and observed state, not an
-- allegation of misconduct, and the enum value is read back by more people than
-- the label is. Framing determines what people write and what a court later
-- reads back.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'referral_state' AND n.nspname = 'app') THEN
        CREATE TYPE app.referral_state AS ENUM (
            'PENDING',
            'ACCEPTED',
            'REFUSED',
            'DISCREPANCY_REPORTED',
            'WITHDRAWN'
        );
    END IF;
END $$;

-- Structured only. There is deliberately no free-text sibling: the kickoff
-- removed `refusal_note` from the first schema draft for exactly this reason.
-- Note what is NOT here -- nothing describing the patient. Every value is a
-- property of the facility at a moment in time.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'refusal_reason' AND n.nspname = 'app') THEN
        CREATE TYPE app.refusal_reason AS ENUM (
            'NO_BED_ON_ARRIVAL',
            'NO_SPECIALIST_AVAILABLE',
            'EQUIPMENT_UNAVAILABLE',
            'WARD_CLOSED',
            'REDIRECTED_BY_FACILITY',
            'OTHER'
        );
    END IF;
END $$;


-- ============================================================
-- 9. Escalation types (consumed by app.alert / app.notification_outbox in 005).
-- ============================================================
-- Cooldown is keyed per (ward_id, cause), so a ZERO during an ongoing SILENCE
-- episode still gets through.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'alert_cause' AND n.nspname = 'app') THEN
        CREATE TYPE app.alert_cause AS ENUM ('SILENCE', 'ZERO', 'ADMIN_CHALLENGE');
    END IF;
END $$;

-- SUPPRESSED is a written state, never a silent drop. The suppressed count per
-- ward is both the gaming detector and the only later evidence that suppression
-- is not hiding real failures.
--
-- DELIVERED means "accepted by the receiving server", which INCLUDES accepted
-- into a spam folder. It is not evidence a human saw anything. ACKED is the only
-- state that carries that, which is why the ack link exists at all.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'alert_state' AND n.nspname = 'app') THEN
        CREATE TYPE app.alert_state AS ENUM (
            'QUEUED',
            'SENT',
            'DELIVERED',
            'ACKED',
            'SUPPRESSED',
            'BOUNCED',
            'DEAD_LETTERED'
        );
    END IF;
END $$;

-- Ships with EMAIL and IN_APP live; SMS and WHATSAPP exist as adapter stubs,
-- wired and disabled by config, so enabling SMS later is a credential and a
-- config row rather than a refactor. Nothing outside the notification adapter
-- may read this column.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                   WHERE t.typname = 'notification_channel' AND n.nspname = 'app') THEN
        CREATE TYPE app.notification_channel AS ENUM ('EMAIL', 'IN_APP', 'SMS', 'WHATSAPP');
    END IF;
END $$;


-- ============================================================
-- 10. Record migration so re-apply is a no-op.
-- ============================================================
INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('002_enums.sql', now())
ON CONFLICT (filename) DO NOTHING;
