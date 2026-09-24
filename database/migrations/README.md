# Migrations

Raw SQL, applied in lexical order by [`scripts/run_migrations.sh`](../../scripts/run_migrations.sh)
and ledgered in `app.schema_migrations`.

**The Supabase CLI does not apply these.** `[db.migrations] enabled = false` in
[`supabase/config.toml`](../../supabase/config.toml), and `supabase/migrations/`
is deliberately empty. Two runners over one schema corrupts it — the CLI uses its
own timestamp naming and its own ledger, and has no concept of a symmetric
reversal. Consequence: `supabase db reset` resets to **empty**. Use
`npm run db:reset`, which is reset + migrate + seed.

## Conventions

- `NNN_slug.sql` with a zero-padded three-digit prefix, plus a paired
  `NNN_slug.down.sql` that reverses it symmetrically.
- A `-- ===` banner naming the file, the empirical state it assumes, its
  anchors, an idempotency note, and a deployment-ordering gate.
- All DDL guarded so re-apply is a no-op.
- A footer registering the file in `app.schema_migrations`.
- The reversal drops in reverse creation order and uses `RESTRICT`, never
  `CASCADE` — a still-referenced object should raise, because that means an
  earlier migration has not been reversed yet.

Enforced by [`scripts/lint_migration_header.sh`](../../scripts/lint_migration_header.sh),
[`scripts/lint_no_drop_cascade.sh`](../../scripts/lint_no_drop_cascade.sh),
[`scripts/lint_no_replica_identity_full.sh`](../../scripts/lint_no_replica_identity_full.sh),
[`scripts/lint_sql_no_bare_not_duty_flag.sh`](../../scripts/lint_sql_no_bare_not_duty_flag.sh)
and `tests/compliance/down_migration_symmetry.test.ts`.

## The files

| # | File | Purpose |
|---|---|---|
| 001 | `app_schema_and_migration_ledger` | The `app` schema, the ledger, and **the revoke wall**. First so no table exists before the grants are locked down. Revokes `EXECUTE` on future `public` functions from `PUBLIC` *and from `anon`/`authenticated`/`service_role` by name* — revoking from `PUBLIC` alone does not remove Supabase's own by-name grants. |
| 002 | `enums` | 14 types. `tri_state` (finding **F2**) is the consequential one. Includes `gate_reason`, which the kickoff requires but does not list. Excludes `blood_status` (cut from Sprint 1) and the `REFERRER` role value — a referrer is a ward account, and the role permitted a facility-less account. |
| 003 | `app_facility_and_identity_tables` | `facility` (Nigeria bounding box, E.164 check), `facility_ops` (**the duty flags**), `ward_account` (**an account is a ward, never a person**), `facility_contact` (the one invited human per facility, deliberately erasable, carrying `agreement_accepted_at` as the evidence for the role-address clause), `device`, `invite` (**the onboarding chase list, not a credential store** — no address, no token, no expiry). Plus `app.touch_updated_at()`. |
| 004 | `app_ward_status_tables` | `ward_status` — **finding F1**, `accepting` is the ward's claim and is never derived. `ward_status_event` (append-only, the only home of `reason_code`, and carrying **no actor**), `challenge`, `ward_alert_state`, `system_heartbeat`. |
| 005 | `app_audit_referral_outbox_tables` | `audit_log` (**no personal data at all** — no actor, no detail jsonb; column list frozen by two guards), `referral` (**ward-to-ward**), `alert`, `notification_outbox`. |
| 006 | `gate_function` | `app.gate()` — **the single derivation site** for the duty-cover gate. Mirrored by `packages/gate/src/gate.ts`; the two are asserted together against one 60-row fixture. |
| 007 | `public_projection_tables` | The three public mirrors. Real tables, not views: Realtime cannot publish a view, and a table's column list can be frozen and asserted. |
| 008 | `projection_triggers` | `app.project_facility()` and triggers on **three** parents — `ward_status`, `facility_ops` and `facility`. Quiet mode is enforced here, in the projection. |
| 009 | `lga_rollup_kfloor` | `app.refresh_lga_rollup()`. Quiet facilities only, k ≥ 5, no facility over 40% of summed beds, and the all-zero cell published before any division. |
| 010 | `append_only_enforcement` | Revokes plus `ENABLE ALWAYS` triggers on the two append-only tables. **Points backwards**: after this, no later migration may rewrite their rows. |
| 011 | `read_rpcs_capped` | `app.assert_member()` and two capped RPCs. No offset parameter exists in either signature — absence is the control. |
| 012 | `indexes` | The seven from the kickoff. No PostGIS. Deliberately nothing that would make a facility-level time series fast. |
| 013 | `realtime_publication_and_grant_sweep` | Publishes the three mirrors and re-asserts every revocation from 001 now that all objects exist. **Last of Bundle 1**, because it asserts over everything that existed when it ran. It is applied and not edited; later migrations carry their own by-name grants. |
| 014 | `publish_ward_status` | **The write path.** `public.publish_ward_status()`, plus a unique partial index on `ward_status_event (ward_status_id, client_mutation_id)` that makes a retry a replay. Returns the ward's claim and the public view as separate fields, the public view read back from `ward_public`. Parameters are `text` because a client cannot name an `app` type. The snapshot is 016. |
| 015 | `ward_status_history_text_category` | **The 011 repair.** `public.ward_status_history` is dropped and recreated with a `text` category, cast inside the function, because no client can pass an `app`-typed parameter through PostgREST. The caps and grants are 011's, unchanged. |
| 016 | `snapshot` | **The snapshot.** `public.snapshot_current` (`service_role`-only: RLS forced, zero policies), `app.regenerate_snapshot()`, `app.snapshot_retention()` and `app.system_heartbeat.last_snapshot_at`. The generator reads only the two mirrors and writes only the snapshot and the heartbeat, in one transaction; `row_security = off` makes a caller without bypass fail loudly; EXECUTE is owner only. The rollup is out; the schedule is 017. |
| 017 | `snapshot_schedule` | **The schedule.** pg_cron, and two jobs run as `postgres`: `openbed_regenerate_snapshot` every minute and `openbed_refresh_lga_rollup` every five, which gives 009's refresh its first production caller. Repairs `app.refresh_lga_rollup()` with `SET row_security = off` by `CREATE OR REPLACE` (009 is frozen), because a caller activates the path where an owner without BYPASSRLS leaves a below-floor cell published. No grant; `cron` is not exposed. The down file unschedules both jobs and does not drop the extension. |
| 018 | `close_mirror_read_and_push_surfaces` | **The accumulation boundary.** Revokes `SELECT` on the three mirrors from `anon` and `authenticated` and removes them from `supabase_realtime`, so the only public read path is `/beds.json`. The 007 policies stay, unreachable. The down file restores exactly that enumerated set and no more. *(Row added 2026-09-23 by R-2026-09-23-66: this table stopped at 017 when 018 landed.)* |
| 019 | `snapshot_single_read_and_mirror_integrity` | **No ward without its facility.** `app.regenerate_snapshot()` reads both mirrors in **one statement**, so a facility committed between two reads can no longer leave its wards orphaned in the payload (016 read them in two). Adds the FK `ward_public_facility_id_fkey` and `facility_name_not_blank` on `app.facility` (a regex, because `btrim` alone lets a tab-only name through), each behind a read-only pre-check that names what it finds. Deliberately no orphan assertion in the generator: a failed run would freeze the public counts with no visible sign. |
| 020 | `operator_functions_and_listing` | **The first operator write surface, and listing.** Adds `app.facility.listed_at` (NULL = unlisted: excluded from the mirrors AND the rollup, unlike quiet mode, which still feeds the rollup) and a trigger-bumped `version`. Five `public.operator_*` functions, EXECUTE to `authenticated` only, behind `app.assert_operator()`. The provisioning gates as `app.provision_begin` / `app.provision_complete`, executable by no client role. One open invite per scope and one active account per ward, as unique indexes behind pre-checks. The backfill is a column DEFAULT, not an UPDATE, so applying it changes no public row (R-2026-09-23-71). |
| 021 | `facility_agreement_and_contact_write` | **The contact and agreement writes, with the agreement moved off the person's row.** Adds `app.facility_agreement` (accepted_on date, a version label, a signatory ROLE, withdrawn_on): the basis for processing a facility's ward data, which no erasure of the contact person may touch (R-2026-09-24-76 BD-1). Drops `facility_contact.agreement_accepted_at`, behind a pre-check that refuses rather than invent a version, and gives the contact its own trigger-bumped `version`. Adds `public.operator_record_contact`, `public.operator_record_agreement` and `public.operator_get_contact`. Restates the listing and provisioning gates to need a contact AND an unwithdrawn agreement. Restates 020's list as `public.operator_register()`, an envelope carrying `server_now`, under a new name because a return type cannot change in place. |
| 022 | `one_operator_and_reactivation` | **At most one active operator, and a switched-off ward reactivated through the gates** (R-2026-09-24-90 BR-1). A partial unique index `ward_account_one_active_operator` (role PLATFORM_ADMIN, active), behind a pre-check naming any duplicates. `app.provision_begin` is 021's body plus one arm: with an active operator, a PLATFORM_ADMIN begin is `complete` and opens nothing, so a re-run of the bootstrap makes no Auth call and a second address never becomes a second operator. `app.provision_complete` is 020's body plus reactivation of a deactivated account of the same scope, against an open invite only (audit `ward_account.reactivate`, status `reactivated`), and every one-active unique violation named by its constraint (`WARD_ALREADY_HAS_AN_ACCOUNT`, `OPERATOR_ALREADY_EXISTS`), never a raw 23505. Signatures, return types and grants unchanged; no public function. The down restores 021's begin and 020's complete verbatim and refuses while an active PLATFORM_ADMIN exists (`OPERATOR_INDEX_IN_USE`, BS-1 a). |

## Corrections to frozen migrations

A migration recorded in `database/migrations/applied-hosted.json` is frozen and is
never edited, so a false comment inside one is corrected here, and in the ruling
block that found it, rather than in the file. Recorded 2026-09-17 by the v1 sweep
(R-2026-09-17-03 and -04, `Sprint Kickoffs/sweep-2026-09-17-v1-enumeration.md`).
The 2026-09-15 correction to 005:211 is repeated here so every correction lives in
one place.

- **002:74** — "Use `is false` / `is not false` in SQL". Neither compiles against
  `app.tri_state` ("argument of IS FALSE must be type boolean"; observed, local
  PostgreSQL 17.6). The form is `IS NOT DISTINCT FROM 'NO'`, and its complement is
  `IS DISTINCT FROM 'NO'`.
- **004:294** — "/api/health returns 500 when it …". There is no `/api` host: both
  apps are static builds and no API directory exists. The sensor argument survives
  as `app.system_heartbeat`, read directly (R-2026-09-16-07). What replaces the
  external caller is an open design question with no kickoff.
- **005:211** — "Validation for patient information also runs at the RPC layer".
  No referral RPC exists, and nothing in any migration inspects the content of
  `ward_reply`. Only the 1000-character cap is real. First found by the v2 sweep
  (#7), and found again independently by the v1 sweep (#63, #97).
- **006:75-83** — the form is right and the stated reason is not. The comment says
  `= 'NO'` and `IS NOT DISTINCT FROM 'NO'` "diverge exactly when an argument
  arrives NULL" and the CASE branch is then "silently not taken". Observed over
  YES/UNKNOWN/NO/NULL: in a CASE arm and in a WHERE clause the two forms agree,
  because NULL and false both skip, and `app.gate()` returns NULL for a NULL flag.
  They diverge only under negation: `<> 'NO'` drops the NULL row, while
  `IS DISTINCT FROM 'NO'` keeps it. `IS NOT DISTINCT FROM` is the right choice
  because it stays total when negated.

Added 2026-09-17 by R-2026-09-17-07, from reading these two files while probing the
Realtime publication:

- **008, the quiet-mode block** — "its categories are the same eight every facility
  has". Ten since the 2026-09-09 ward-category audit, the same drift as the truth
  table's 48. The argument the sentence supports does not depend on the number.
  **The rest of that block is correct and was under-read rather than wrong:** it
  anticipated the DELETE payload a Realtime subscriber receives, named both primary
  keys, and concluded the payload "leaks nothing beyond 'this facility stopped being
  listed', which is exactly the observable fact quiet mode creates and cannot hide."
  A 2026-09-17 probe reported that payload as a finding without reading this defence;
  the defence stands and the finding was retracted.
- **013, the REALTIME AND THE THREE MIRRORS note** — "Realtime is retained for
  AUTHENTICATED ward and admin devices only". False as a property of the database:
  observed 2026-09-17, a subscriber holding only the anon key receives INSERT, UPDATE
  and DELETE events on all three mirrors, with a service-role control receiving the
  same in the same run. The REPLICA IDENTITY half of the same note is correct, and
  DEFAULT is what keeps the DELETE payload to the primary key.

## Ward-level identity

Migrations 002–005, 010–012 were amended in place on 2026-09-08, before the first
hosted push, by `Sprint Kickoffs/decision-2026-09-08-ward-level-identity.md`.
There are no individual accounts: an auth account represents a ward, or a facility
for admin. The audit log and the event stream contain no personal data, so they
need no retention period and no partitioning. Editing in place rather than adding
a migration 014 was possible only because no authoritative ledger existed yet —
after the first push, 010 makes the audit table's shape effectively frozen.

## Seed

[`../seed/001_synthetic_seed.sql`](../seed/001_synthetic_seed.sql) is **not** a
migration and is **not** ledgered. `scripts/seed.sh` refuses any non-local
database. Seed data that rides the migration ledger reaches every environment the
ledger reaches.
