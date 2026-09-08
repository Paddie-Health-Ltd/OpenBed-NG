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
| 006 | `gate_function` | `app.gate()` — **the single derivation site** for the duty-cover gate. Mirrored by `packages/gate/src/gate.ts`; the two are asserted together against one 48-row fixture. |
| 007 | `public_projection_tables` | The three public mirrors. Real tables, not views: Realtime cannot publish a view, and a table's column list can be frozen and asserted. |
| 008 | `projection_triggers` | `app.project_facility()` and triggers on **three** parents — `ward_status`, `facility_ops` and `facility`. Quiet mode is enforced here, in the projection. |
| 009 | `lga_rollup_kfloor` | `app.refresh_lga_rollup()`. Quiet facilities only, k ≥ 5, no facility over 40% of summed beds, and the all-zero cell published before any division. |
| 010 | `append_only_enforcement` | Revokes plus `ENABLE ALWAYS` triggers on the two append-only tables. **Points backwards**: after this, no later migration may rewrite their rows. |
| 011 | `read_rpcs_capped` | `app.assert_member()` and two capped RPCs. No offset parameter exists in either signature — absence is the control. |
| 012 | `indexes` | The seven from the kickoff. No PostGIS. Deliberately nothing that would make a facility-level time series fast. |
| 013 | `realtime_publication_and_grant_sweep` | Publishes the three mirrors and re-asserts every revocation from 001 now that all objects exist. **Last**, because it asserts over everything. |

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
