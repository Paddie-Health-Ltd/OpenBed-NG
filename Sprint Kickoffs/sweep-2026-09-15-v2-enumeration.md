# Pre-017 sweep of the v2 kickoff — the enumeration

_Recorded 2026-09-15. Ruling R-2026-09-15-08 commissioned the sweep; R-2026-09-15-10 required its count to be re-derivable from a stated unit._

This is the enumeration behind the verdict table in `Sprint Kickoffs/sprint-kickoff-bedspace-v2-2026-09-10.md`, section *Pre-017 sweep — recorded 2026-09-15*. Until R-2026-09-15-10 it existed only in a session-local agent transcript, while that section said the citations were kept.

**Unit.** One enumerated claim per numbered item: a claim at its citation in the kickoff. An item carrying several assertions takes one verdict (for example #41, two failed assertions; #25, three config values), and where an item has a part that is not checkable from the repository it takes its repository-checkable verdict (#19, #25, #81; #4 and #77 since R-2026-09-15-10).

**Line numbers** are the kickoff as read at 984ff1b, before the sweep added its markers; they have since shifted. `M/` means `database/migrations/`.

**Verdict words.** HOLDS = VERIFIED. FAILS = SUPERSEDED, failed. STALE = SUPERSEDED, stale (true when written; the repository moved on). SUPERSEDED-IN-DOC = superseded by a later section of the kickoff. NOT CHECKABLE = a vendor, hosted or history fact.

**Amendments since the enumeration was taken:** #4 and #77, NOT CHECKABLE → HOLDS (R-2026-09-15-10 A1). No other verdict changed.

| Verdict | Count | Items |
|---|---|---|
| HOLDS (VERIFIED) | 70 | every item not listed below |
| FAILS | 5 | #41, #59, #61, #67, #71 |
| STALE | 9 | #5, #9, #10, #11, #18, #27, #30, #46, #83 |
| SUPERSEDED-IN-DOC | 5 | #16, #33, #38, #45, #94 |
| NOT CHECKABLE | 7 | #28, #44, #60, #64, #74, #79, #91 |

Total 96. Every item below ends with its verdict in bold; the last bold verdict word in an item is its verdict.

**Found in passing, outside the 96:** `M/005:211`'s comment that patient-information validation "also runs at the RPC layer" is false. 005 is applied and is not edited; the kickoff's sweep section records the correction.

---

## Header and division of responsibilities
1. **v2:5** "Predecessor: `Sprint Kickoffs/sprint-kickoff-bedspace-v1-2026-09-08.md`" – the file exists. **HOLDS**.
2. **v2:13** "The v1 kickoff's `## Bundles` section" – found at v1:127. **HOLDS**.

## Nine findings
3. **v2:46** "`app.refresh_lga_rollup()` has no production caller … No trigger, no `pg_cron` entry"
   - Evidence: a grep across database, scripts, tests, apps, packages, .github and supabase finds only `database/seed/001_synthetic_seed.sql:165` and `tests/db/lga_rollup_kfloor.test.ts:99,121,136`.
   - `tests/db/snapshot.test.ts:287` is a planted string, not a caller.
   - M/016:34-45 says calling it from the generator is rejected, and that finding 1 "is real and stays OPEN".
   - **HOLDS**.
4. **v2:46** "it is the sixth instance of that shape this fortnight" – v2:433 says "Five instances". The document contradicts itself, and the count is history rather than repo state. **NOT CHECKABLE** as first marked. **Amended to HOLDS by R-2026-09-15-10 A1:** with finding 6's two headers in the family (v2:433's own clause), the paragraph names six families and nine instances; finding 1's "sixth" is the sixth family, and "Five" counts the five families in its own list before that clause adds the sixth. Whether that many occurred is history and stays parked; the item takes its repository-checkable verdict, as #19, #25 and #81 do. **HOLDS**.
5. **v2:48** "`client_mutation_id` has no index and no unique constraint … `012_indexes.sql` does not mention it"
   - At writing: M/004:183 is `client_mutation_id text,`, and grepping 012 for it gives zero hits (the same grep hits M/014).
   - Now: M/014:123-124 creates `UNIQUE INDEX … ward_status_event_client_mutation_uidx ON app.ward_status_event (ward_status_id, client_mutation_id)`.
   - **STALE**.
6. **v2:50** "`005:208` sets `char_length(ward_reply) <= 1000`. `005:97` … 256"
   - The content is right: the cap is at M/005:219 and the 256 idiom comment at M/005:107.
   - The line numbers have drifted. At commit 0d6ca5d, line 97 was the 256 comment and line 208 was `CONSTRAINT referral_ward_reply_capped`; commit 4e90f36 later edited 005.
   - **HOLDS**, with stale line references.
7. **v2:50** "RPC-layer patient-information validation — does not exist"
   - M/005:211 still claims "Validation for patient information also runs at the RPC layer".
   - No referral RPC exists, and grepping M/014 for "patient" finds nothing (the same grep method hits M/014 for other terms).
   - **HOLDS**. The 005 comment is a live false claim.
8. **v2:52** "`005` creates four tables and zero triggers … `DEFAULT now()`"
   - Four `CREATE TABLE`s at M/005:69,174,249,288 and no `CREATE TRIGGER` in 005. The control grep hits M/003:136, :184 and :357.
   - `updated_at … DEFAULT now()` is at M/005:216. Grepping 014–016 for "referral" finds nothing, so no trigger was added since.
   - **HOLDS**.
9. **v2:54** "`.ci/ci-gate-exceptions.yml:27` cites a test that does not exist"
   - At commit ffdc5a8, line 27 read `# tests/compliance/ci_gate_exceptions.test.ts asserts…`. That file is absent from `ls tests/compliance`, which does list `ci_required_checks_not_paths_filtered.test.ts`.
   - Now: the file cites the correct test in backticks and records "FINDING 5, fixed 2026-09-10" (fixed in commit 31ac05e).
   - **STALE**.
10. **v2:56** "`packages/fixtures/package.json` exports only `./truth-table.json`"
    - At ffdc5a8 there was an `"exports": {"./truth-table.json"…}` map.
    - The current `packages/fixtures/package.json` description says "there is no exports map".
    - `tests/db/config_drift.test.ts:5` imports `public-relations.json` by relative path.
    - **STALE**.
11. **v2:56** "`scripts/lint_from_allowlist.sh:31` extracts the allowlist with a fixed alternation"
    - ffdc5a8:31 is exactly that `grep -oE '"(facility_public|…|ward_status_history)"'`.
    - Commit 31ac05e replaced it with a node parser, and the header records "FINDING 6, fixed".
    - **STALE**.
12. **v2:56 / v2:150** "It fails closed" / "already fails closed" – the current script exits 2 on a missing, unparseable or empty allowlist (`lint_from_allowlist.sh` body lines 12, 31, 33). **HOLDS**.
13. **v2:60** "`008:145` writes `ward_public.updated_at = ws.updated_at`" – M/008:132 lists `updated_at` among the inserted columns, M/008:145 selects `ws.updated_at`, and M/008:161 has `updated_at = EXCLUDED.updated_at`. **HOLDS**.
14. **v2:62** "`011:12–14`: a WARD_STAFF account may only write its own ward — needs a `p_category`…" – the quote is at M/011:12-15. **HOLDS**.
15. **v2:64** "`app.facility_contact` has `agreement_accepted_at` and no `agreement_version`" – M/003:328 has the column. Grepping `database/` for `agreement_version` finds nothing; the control term `agreement_accepted_at` hits. **HOLDS**.

## The migration window
16. **v2:70** "applying migrations 001–013 to hosted, with a stop condition of **exactly 13 pending**"
    - Whether hosted has been applied is not visible in the repo.
    - The count rule is superseded by v2:484 ("names files, not a count"); the runbook's `docs/runbook-supabase-project-creation.md:131` now requires that the `WOULD APPLY` lines name exactly the migration files not yet applied.
    - **SUPERSEDED-IN-DOC**.
17. **v2:79** "`db-tests` and the new E2E job provision their own local stack" – `.github/workflows/ci.yml:135` is `db-tests`, and the `golden-path` job (ci.yml:199) runs `npx supabase start` inside its own block. **HOLDS**.

## Stage 0
18. **v2:85** "There is no Playwright, no E2E project and no CI job"
    - The E2E project and CI job now exist: `tests/e2e/` holds 5 files and ci.yml:199 is `golden-path`.
    - Playwright is still absent: grepping `package.json` and `apps/*/package.json` for playwright finds nothing, while `vitest` hits `package.json:25`.
    - **STALE** (partly still true).
19. **v2:89** "`tests/compliance/ci_required_checks_not_paths_filtered.test.ts` exists" – it exists. The part about GitHub counting a skipped check as passing is a vendor fact and not checkable. **HOLDS**.
20. **v2:110** "`.ci/ci-gate-exceptions.yml` stays an empty list" – `exceptions: []` at line 36. **HOLDS**.
21. **v2:111** "`EXPECTED_JOBS` in `ci_required_checks_not_paths_filtered.test.ts:51`" – it is at :51, and `'golden-path'` is now at :55. **HOLDS**.
22. **v2:114** "`tests/setup/db.ts` fakes identity with `SET LOCAL request.jwt.claims`" – `tests/setup/db.ts:124`. **HOLDS**.
23. **v2:115** "`postgres({ max: 1 })` at `tests/setup/db.ts:27`" – `max: 1,` is at :27. `sqlSecond()` now exists at :63. **HOLDS**.
24. **v2:120** "`supabase/config.toml:151–152` has `[local_smtp] enabled = false`" – exact match at 151-152. **HOLDS**.
25. **v2:124, :128** rate limits "`email_sent = 2`", "`sign_in_sign_ups = 30`", "`token_verifications = 30`" – `supabase/config.toml:243,245,253,255`. The per-IP / per-5-minutes semantics are vendor behaviour. **HOLDS**.
26. **v2:128** "the pinned CLI (`supabase` 2.117.0)" – `package.json:37`. **HOLDS**.
27. **v2:130** "runbook §5b currently reads *'Covered by tests: nothing.'*"
    - §5b was renumbered to step 9 (`docs/runbook-supabase-project-creation.md:42`).
    - The sentence now reads "Covered by tests: the local-integration leg only, against GoTrue v2.196.0" (:515).
    - **STALE**.
28. **v2:134** "public reads come from a static snapshot at `s-maxage=30, stale-while-revalidate=300`"
    - This is recorded only as prose in `packages/fixtures/snapshot-shape.json:4` and `golden-path-steps.json:4`.
    - A grep of apps, packages, scripts and docs finds no header config; the CDN is hosted.
    - **NOT CHECKABLE**.
29. **v2:144** "`withRole()` throws a sentinel to force rollback"; `seed_shapes.test.ts` – `tests/setup/db.ts:118,127`, and `tests/db/seed_shapes.test.ts` exists. **HOLDS**.

## Stage 1
30. **v2:162** "Nothing in the repository creates a `ward_account` today" – `scripts/provision_ward_account.mjs` and `tests/compliance/provision_ward_account.test.ts` now exist, and `frontier.json` says "DISCHARGED 2026-09-10 … provision_ward_account.mjs writes the ward_account row". **STALE**.
31. **v2:162** "`003`'s `id` is a bare `uuid PRIMARY KEY` with no FK to `auth.users`" – M/003:219. Grepping 003 for `REFERENCES auth` finds nothing, while `REFERENCES app.facility` hits M/003:152. **HOLDS**.
32. **v2:166** "`app.assert_member` already blocks `is_active = false`, and `cross_tenant_writes.test.ts` already proves it" – M/011:105 raises `ACCOUNT_DEACTIVATED` (42501), and `tests/db/cross_tenant_writes.test.ts:108-120` checks it. **HOLDS**.
33. **v2:170-190** the signature with `app.*` enum parameters and a 5-column return
    - Superseded by the marker at v2:170, plus v2:476 and v2:482.
    - The repo matches the supersession: M/014:134 has `p_category text`, and M/014:146 adds `replayed`.
    - **SUPERSEDED-IN-DOC**.
34. **v2:194** "Resolved from `auth.uid()` exactly as `public.my_facility_wards()` does … the missing `p_offset` in `ward_status_history`" – M/011:164 and M/011:225 ("no p_offset"). **HOLDS**.
35. **v2:196** "by-name `DO` block from `011` §2"; "`pg_default_acl` grants EXECUTE to `anon`, `authenticated` and `service_role` *by name*"
    - The `DO` block is at M/011:201-212, inside section 2 (M/011:131).
    - The ACL was observed and recorded at M/001:150-160, "Found by tests/db/rls_rpc_execute_allowlist.test.ts on its first run".
    - **HOLDS**.
36. **v2:197** "`42501` for auth via `app.assert_member`" – M/011:88-123. **HOLDS**.
37. **v2:199** "The 008 trigger fires in the same transaction"
    - M/008:209 calls `PERFORM app.project_facility`.
    - Grepping 008 for "DEFERR" finds nothing; the same grep hits `REVOKE` at M/008:184.
    - M/014:26-29 says the triggers are "not deferred".
    - **HOLDS**.
38. **v2:205** "`014`: the idempotency index" – **known failure, confirmed**
    - Superseded in the document at v2:205 and v2:467.
    - In the repo, M/014 is the whole write path: `publish_ward_status` at M/014:134 and the index at M/014:123.
    - **SUPERSEDED-IN-DOC**.
39. **v2:206** "`005` says explicitly that a CHECK cannot enforce this and that the rule belongs to the Bundle 3 writer RPC" – M/005:135-140 ("A CHECK may not call auth.uid() … belongs to the Bundle 3 writer RPC and must be asserted there"). **HOLDS**.
40. **v2:214** "the frozen `public.ward_public` list from `007`"; the fixture "(landed in Stage 0)" – `packages/fixtures/snapshot-shape.json` exists, and `tests/db/rls_anon_column_containment.test.ts:94-95` imports its `wardColumns`. **HOLDS**.
41. **v2:217** "`app.regenerate_snapshot()` … EXECUTE revoked from PUBLIC and granted to `service_role` only. Reads the three mirrors" – **known failure, confirmed**
    - The function exists with `SECURITY DEFINER` and `SET search_path = ''` (M/016:211-216), and PUBLIC is revoked (M/016:310).
    - The grant to `service_role` **fails**. M/016:315-318 revokes EXECUTE from anon, authenticated and service_role, and M/016:114-116 says: "EXECUTE: OWNER ONLY … service_role has no USAGE on schema app … v2:217's 'EXECUTE granted to service_role' is a grant nobody can exercise".
    - The revoke wall: M/001:121 `REVOKE ALL ON SCHEMA app FROM PUBLIC`, M/001:99 and :109 for anon and authenticated, and M/013:88,96 as a by-name loop plus a PUBLIC revoke. I did not re-read 013's role array.
    - No migration contains `GRANT USAGE ON SCHEMA app`. The control grep for `GRANT EXECUTE ON FUNCTION public.` hits M/014:333 and M/011:212.
    - "Three mirrors" also **fails**: it reads only `facility_public` and `ward_public` (M/016:225-251), and `lga_rollup` is excluded on purpose (M/016:41-45).
    - The same-transaction heartbeat part holds (M/016:285-288, M/016:141).
    - **FAILS**.
42. **v2:219** "The F2 ESLint rule matches on *identifier names*"; "Today the payload carries only `gated_by`" – `eslint.config.mjs:28` defines `DUTY_FLAG = 'anaesthetist|obstetrician|paediatrician'`. The ward array at M/016:240-243 has `gated_by` and no duty flags. **HOLDS**.
43. **v2:231** "`lint_no_service_role_in_bundle.sh` scans `apps/**/dist/**`"; "under `packages/` it is still scanned by `lint_no_updated_at_filter.sh`"; `packages/gate` holds twin rules pinned by a shared fixture
    - `scripts/lint_no_service_role_in_bundle.sh:25,54`
    - `scripts/lint_no_updated_at_filter.sh:36`
    - `packages/gate/src/gate.ts:10,73,156`
    - **HOLDS**.
44. **v2:233** "`stale-while-revalidate=300` keeps the CDN serving" – CDN behaviour. **NOT CHECKABLE**.
45. **v2:235** "`014` adds one index and no column, so nothing shipped changes shape" – **known failure, confirmed**
    - Superseded in the document at v2:235 and v2:467.
    - In the repo, M/014 adds a function and an index, and M/016:141 and :147 add `last_snapshot_at` and `public.snapshot_current`.
    - **SUPERSEDED-IN-DOC**.
46. **v2:235** "Replacing that test's literal FROZEN list" – `ward_public`'s list is now imported from the fixture (`rls_anon_column_containment.test.ts:94-95`). Only the `facility_public` list is still literal (:110). **STALE**.
47. **v2:235** "the lint greps `.from(` only, so `.rpc('publish_ward_status')` is entirely outside its coverage" – the `lint_from_allowlist.sh` header block "NOT ASSERTED HERE … matches `.from(` and `.select('*')` only". **HOLDS**.
48. **v2:235** "`public.my_facility_wards()` returns every category … including other wards' private `reason_code`" – M/011:133-134 and :183-193 filter only on `WHERE ws.facility_id = v_facility`. **HOLDS**.

## Stage 2
49. **v2:243** "the transaction boundary already exists" – true today through M/014: `assert_member` at :185, the event insert at :282 and the audit insert at :290. **HOLDS**.
50. **v2:252** "`008` recomputes every ward … takes `public.ward_public` row locks in plan order"
    - M/008:130-161 has the `INSERT … SELECT` with no ORDER BY.
    - A repo-wide grep for `ORDER BY ws.category` finds only M/011:192, which also serves as the control. It was not fixed in 014–016.
    - **HOLDS**.
51. **v2:253** "the table's existing CHECK idiom" – M/003:341-345 (`sms_requires_optin`, `has_a_channel`). **HOLDS**.
52. **v2:261** "`app.invite` deliberately holds **no address** — the address lives once, in `auth.users`" – M/003:420 and :481-482. **HOLDS**.
53. **v2:263** named tests, constraints, and "deliberately outside the append-only set"
    - `projection_ward_public`, `projection_quiet_mode`, `gate_semantics` and `migration_idempotency` all exist in `tests/db`, with the digest at `migration_idempotency.test.ts:48`.
    - The constraints are at M/003:341 and :344.
    - M/010:47-50 confirms `facility_contact` is deliberately NOT append-only.
    - **HOLDS**.

## Stage 3
54. **v2:279** "The handoff records it as *not built*" – `docs/handoff-2026-09-10.md:96`. `eslint.config.mjs` still has no `Date.now` rule. **HOLDS**.
55. **v2:285** "`tests/compliance/eslint_duty_flag_negation.test.ts` is a proven plant harness" – the file exists. **HOLDS**.
56. **v2:293** "the same grep-able idiom as `OPENBED-FRESHNESS-ORDER-ONLY`" – `scripts/lint_no_updated_at_filter.sh:22,48`. **HOLDS**.
57. **v2:301** "No `app.update_request` table exists yet"
    - Grepping `database/`, `scripts/`, `apps/` and `packages/` finds only fixture prose (`golden-path-steps.json:101`). The control term `facility_contact` hits M/005 and M/010.
    - `frontier.json` records the next step failing with a 404.
    - **HOLDS**.
58. **v2:305** "`lga_rollup_kfloor.test.ts` currently calls the function directly inside a rolled-back transaction" – `:98-99` inside `withRole`, whose rollback sentinel is at `db.ts:118`. **HOLDS**.

## Stage 4
59. **v2:319** "The dual scheduler already exists. Stage 1 stood up `pg_cron` plus the external caller" – **known failure, confirmed**
    - Search: grep for `pg_cron|cron\.schedule|cron\.unschedule` over supabase/, database/, scripts/, .github/, apps/, packages/ and tests/.
    - Every hit is a comment:
      - M/016:6 "The schedule that calls the generator (pg_cron) is 017, not this file"
      - M/016:117 "an external caller needs a route that 017 must choose"
      - M/004:299-300 and M/005:272
      - `tests/db/snapshot.test.ts:50` "Nothing calls the generator in 016"
    - No 017 migration exists.
    - Control: the same grep for `system_heartbeat` hits M/004.down and M/016.
    - **FAILS**.
60. **v2:319** "Supabase pauses free projects after 7 days … pg_cron's own activity does not count" – vendor behaviour. **NOT CHECKABLE**.
61. **v2:320** "`/api/health` … already exist[s] … the minimal surface Stage 1 shipped" – **known failure, confirmed**
    - A grep for `api/health` over apps, packages, scripts, .github, supabase, database and tests finds only M/004:294, a comment.
    - `apps/public-dashboard` contains only `index.html`, `build.sh`, `src/main.ts` and config files, with no route. `docs/runbook-snapshot-stopped.md` is also missing.
    - Control: the same grep for `publish_ward_status` hits `apps/ward-console/src/main.ts:28`.
    - **FAILS**.
62. **v2:320** "the heartbeat already exist[s]" – `app.system_heartbeat` at M/004:302 with `last_sweep_at` at :305. `last_snapshot_at` was added at M/016:141 and is written at M/016:288. **HOLDS**.
63. **v2:325** "Residue A … which the runbook does not currently name" – grepping the runbook for "Residue A" finds nothing; the same method hits "SMTP" at runbook:1287 and :1330. **HOLDS**.
64. **v2:324** "This is currently unpapered" (the DPA) – an external legal fact. Runbook:1287-1289 lists it as an open obligation, which is consistent. **NOT CHECKABLE**.

## Stage 5
65. **v2:346** "It currently holds 1000 … `005`'s own comment gives as the thing free text must not hold" – M/005:219 and M/005:195. **HOLDS**.
66. **v2:347** "`app.touch_updated_at()` from `003`" – M/003:62. **HOLDS**.
67. **v2:402** "what `003`'s `app.touch_updated_at()` already does for four other tables" – it is used by **five** triggers: M/003:138 (facility), :186 (facility_ops), :359 (facility_contact), M/004:130 (ward_status) and M/004:315 (system_heartbeat). **FAILS** (miscount).
68. **v2:353** the audit-log guard triple
    - `packages/fixtures/audit-log-columns.json`
    - `scripts/lint_audit_log_columns.sh`
    - `tests/compliance/audit_log_no_identity_columns.test.ts`
    - live twin `tests/db/audit_log_column_list.test.ts`
    - All exist. **HOLDS**.
69. **v2:360** "the `scripts/lint_grep_exit_codes.sh` ban" – :18-19 and :47. **HOLDS**.
70. **v2:384** "`.claude/rules/test-conventions.md` §2 … the three shapes" – §2 is at :35. The heading now says "Four ways … extended 2026-09-11" (:55), while the body still says "three specific shapes" (:58). **HOLDS** (drifted).
71. **v2:388** "Legs 1–4 execute non-vacuously over the real migrations today"
    - None of the referral guard's files exist: `referral-columns.json`, `lint_referral_ward_to_ward.sh`, `referral_ward_to_ward.test.ts` and `referral_column_list.test.ts` are all absent from their directory listings.
    - The audit-log triple in those same listings is present, which proves the method.
    - The "same idiom as `lint_audit_log_columns.sh`" part holds (:28-30).
    - **FAILS** as a present-tense claim.
72. **v2:392** "the shipped `app.referral` **does** hold … no `actor_id`, no clinician column … `referral_not_self` present" – the column list at M/005:174-218 has no actor or clinician column, and the constraint is at M/005:225. **HOLDS**.
73. **v2:402** "`timestamps_are_timestamptz.test.ts` expects"; "reds `bundle-guards`" – `tests/db/timestamps_are_timestamptz.test.ts` exists, and `bundle-guards` is at ci.yml:282. **HOLDS**.
74. **v2:402** "a table with no production rows" – hosted data. **NOT CHECKABLE**.

## Standing constraints
75. **v2:427** "No … `actor_identity_map`, no `REFERRER` role … no `detail jsonb`"; "`ward_account_scope_matches_role` CHECK in `003`" – M/005:7 (deleted), M/002:272, M/005:51 and M/003:245. **HOLDS**.
76. **v2:429** "`blood_status` is cut from Sprint 1"; `app.tri_state` – M/002:30 and M/002:81. **HOLDS**.
77. **v2:433** "Five instances this fortnight" – history, and it contradicts v2:46. **NOT CHECKABLE** as first marked. **Amended to HOLDS by R-2026-09-15-10 A1:** with finding 6's two headers in the family (v2:433's own clause), the paragraph names six families and nine instances; finding 1's "sixth" is the sixth family, and "Five" counts the five families in its own list before that clause adds the sixth. Whether that many occurred is history and stays parked; the item takes its repository-checkable verdict, as #19, #25 and #81 do. **HOLDS**.

## Open decisions and resolved items
78. **v2:443** "Drafted and delivered as `docs/facility-agreement-clause-x-access-addresses.md`" – the file exists. **HOLDS**.
79. **v2:441** "free-tier refuses connections past 200 concurrent" – vendor limit. **NOT CHECKABLE**.
80. **v2:447** "A public privacy notice does not exist" – `find -iname '*privacy*'` finds nothing, while the same directory listing shows the `docs/` files. **HOLDS**.
81. **v2:459** "`SECURITY.md` now names `security@openbed.ng`" – `SECURITY.md:11`. The DNS and receipt details are not checkable. **HOLDS**.
82. **v2:461** page title, README and NOTICE read OpenBed; BedSpace stays protected; `package.json` name and description
    - `apps/public-dashboard/index.html:10` is `<title>OpenBed</title>`.
    - `README.md:1` is "# OpenBed-NG".
    - `NOTICE:1` and `:40` contain "BedSpace".
    - `package.json:2` is `openbed-ng`, and `:7` begins "BedSpace —".
    - **HOLDS**.

## Superseded section (2026-09-14)
83. **v2:467** "`apps/ward-console/src/main.ts`, `tests/e2e/_harness.ts` and `tests/e2e/frontier.json` each named `publish_ward_status` as migration 014" – **the frontier line, confirmed**
    - `main.ts:29` and `_harness.ts:219` still say 014.
    - At commit 7cfc960, `frontier.json` had `passing_through: "ward-republishes"`, with a reason naming migration 014.
    - Now `grep -c 014 tests/e2e/frontier.json` returns 0. `passing_through` is `"stale-ward-payload-carries-duty-phone"` and the next step, `update-request-fired`, fails with "expected 404 to be 200".
    - The frontier is past v2:237's DoD target (`tile-shows-count`).
    - **STALE** for the frontier leg.
84. **v2:469** "None of `public.publish_ward_status`, `app.regenerate_snapshot` or `public.snapshot_current` exists in migrations 001–013. `app.system_heartbeat` (004) has `last_sweep_at` and no `last_snapshot_at`"
    - `grep -l` over 001–013 finds nothing; the control hits M/014.
    - M/004:305.
    - All three now exist in 014/016 (M/016:141, :147, :211).
    - **HOLDS** (as scoped to 001–013).
85. **v2:474** "the snapshot migration (now 016) carries its own schema change … `last_snapshot_at`" – M/016:141. **HOLDS**.
86. **v2:480** "public fields are read back from `public.ward_public` in the same transaction … `tests/db/publish_ward_status.test.ts` proves it, including a planted floor"
    - M/014:26-29 and :313.
    - The test is at :434 and the plant at :448-451.
    - I did not re-read each `claim_*` / `public_*` field name.
    - **HOLDS**.
87. **v2:482** "001's revoke wall gives `authenticated` no USAGE on schema `app`"; the parameters are text; `INVALID_ARGUMENT`; the 011 defect was fixed in 015
    - M/001:109 and :121; M/014:134 and :197.
    - M/011:280 had the `app.ward_category` signature; M/015:62 drops it and M/015:69 recreates it with `p_category text`.
    - **HOLDS**.
88. **v2:484** "runbook step 5's stop condition names files" – runbook:131. **HOLDS**.
89. **v2:488** "Migration 015 is `015_ward_status_history_text_category.sql`" – the file exists. **HOLDS**.
90. **v2:493** "`authenticated` also holds EXECUTE on none of `app`'s functions, and `app.project_facility` has PUBLIC revoked (008, and again 013)"
    - M/001:112 and :115, M/013:91.
    - Grepping all migrations for `GRANT EXECUTE ON FUNCTION app.` finds nothing; the control grep for `public.` hits.
    - M/008:184 and M/013:99.
    - **HOLDS** in the static migrations.
91. **v2:497** "anon's PostgREST OpenAPI document already carries `ward_category` values" – a runtime observation. **NOT CHECKABLE**.
92. **v2:498** "condition G — a replay is named in the response" – M/014:35 and :146 (`replayed boolean`). **HOLDS**.
93. **v2:500** "gating conditions A–I … recorded in `decision-2026-09-14-public-private-split.md`" – that file, lines 495-510. **HOLDS**.
94. **v2:471** "the snapshot is 015" – superseded by v2:471's own marker and v2:488. The repo has `016_snapshot.sql`. **SUPERSEDED-IN-DOC**.

## Supporting docs
95. **v2:504-508** the listed documents exist
    - v1 kickoff, ward-identity decision, `docs/handoff-2026-09-10.md` (probes at :53), `.claude/rules/code-pipeline.md` and `test-conventions.md`: all exist.
    - I did not individually confirm the handoff's "ward-category audit" and "CI intermittent" contents.
    - **HOLDS**.
96. **v2:510** "the `ARCHITECTURE.md` the repo needs" (implies it is absent) – the file-existence test reports it MISSING, while the same test reports `README.md` as EXISTS. **HOLDS**.
