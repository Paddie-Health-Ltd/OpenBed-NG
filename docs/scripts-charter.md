# The scripts charter

_Added by R-2026-09-29-171 (EU-4), the last item of the `scripts/` survey. One row per file directly under `scripts/`, library and declaration files included._

**What a row says.**
- **Stated reason:** the reason the file's own header gives, in 15 words or fewer.
- **Planting test(s):** the tests that run the file and plant a failure in it. A test that only reads or greps the file's text is not a planting test. A library file is credited through its callers, which its row names after "via".
- **Both ways?:** yes when those tests plant a failure that is refused AND show an ordinary input accepted.
- **Probed or outcome only:** probed when a plant makes the stated reason the only difference and the outcome flips, with the refusal's content asserted. A test asserting only an exit code is outcome only.
- **Legs reached / registered:** counted by state from `packages/fixtures/leg-coverage.json`. A file with no legs reads `0 / 0`.
- **Verdict:** FINDING when the tests cell is none, both ways is no, or the reason was probed for outcome only. Otherwise NOT ASSERTED for a hosted script, whose live verdict is never run here, and OK for every other. FINDING outranks NOT ASSERTED.

**A FINDING is not fixed here.** Each is ruled on in S-c's merge letter. It gets a register row only if that letter gives it one.

**Held by `tests/compliance/scripts_charter.test.ts`:** the rows equal the files, each named test exists, each legs cell matches the leg register, each reason fits, and each verdict follows the rule. A leg change now also edits this file. That the "probed" and "both ways" cells are TRUE is a reading, made by the reviewer and the merge letter, not by a parser.

**Hosted,** for the verdict rule: `deploy_*`, `readback_*` except `readback_signin_link.mjs` (which makes no request), `get_extra_search_path.sh`, `get_publishable_key.sh` and `provision_ward_account.mjs`. The list is declared in the guard.

| Script | Stated reason | Planting test(s) | Both ways? | Probed or outcome only | Legs reached / registered | Verdict |
|---|---|---|---|---|---|---|
| attest_counts.mjs | Derive the six red-disposition counts from the JUnit artefact, never a terminal summary. | `tests/compliance/attest_counts.test.ts`, `tests/compliance/pr_evidence.test.ts` | yes | probed | 15 / 0 | OK |
| check_pr_migration_line.mjs | A migration PR must answer the template's runbook-expectations line; a template cannot force it. | `tests/compliance/pr_migration_line.test.ts` | yes | probed | 6 / 0 | OK |
| commit.sh | The one commit entry point: the gate is the commit's precondition, not a remembered step. | `tests/compliance/commit_gate.test.ts`, `tests/compliance/runner_aggregation.test.ts` | yes | probed | 3 / 1 | OK |
| deferred_register.d.mts | Types for deferred_register.mjs, so a TypeScript test imports its parser, not a copy. | via deferred_register.mjs, the module it declares: `tests/compliance/deferred_register_types.test.ts` | yes | probed | 0 / 0 | OK |
| deferred_register.mjs | The register's strict parser, importable by its test and by pr_evidence.mjs alike. | via deferred_items.test.ts, pr_evidence.mjs: `tests/compliance/deferred_items.test.ts`, `tests/compliance/pr_evidence.test.ts` | yes | probed | 0 / 0 | OK |
| deploy_pages.sh | Deploy a Pages app, refusing a dirty or unmerged tree and an unknown app. | `tests/compliance/deploy_guards.test.ts` | yes | probed | 15 / 1 | NOT ASSERTED |
| deploy_worker.sh | Deploy the api.openbed.ng Worker with deploy_pages.sh's refusals, then read its stamp back. | `tests/compliance/deploy_worker.test.ts` | yes | probed | 10 / 1 | NOT ASSERTED |
| freeze_applied_migrations.mjs | Record what hosted applied; refuse a ledger count that disagrees with the repository. | `tests/compliance/freeze_applied_migrations.test.ts` | yes | probed | 8 / 0 | OK |
| gate.sh | One command, one exit status for the local pre-merge checks; not a control. | `tests/compliance/runner_aggregation.test.ts` | yes | probed | 2 / 0 | OK |
| get_extra_search_path.sh | Print only PostgREST's db_extra_search_path; the endpoint's answer also carries jwt_secret. | `tests/compliance/get_extra_search_path.test.ts` | yes | probed | 11 / 0 | NOT ASSERTED |
| get_publishable_key.sh | Print only the publishable key; the bare CLI call printed service_role too. | `tests/compliance/get_publishable_key.test.ts` | yes | probed | 8 / 0 | NOT ASSERTED |
| lint_audit_log_columns.sh | audit_log's columns equal the fixture exactly; no identity-bearing column such as ip_address. | `tests/compliance/audit_log_no_identity_columns.test.ts` | yes | probed | 14 / 2 | OK |
| lint_from_allowlist.sh | Client code addresses only allowlisted mirrors and RPCs, and never selects every column. | `tests/compliance/bundle_guards.test.ts` | yes | probed | 7 / 1 | OK |
| lint_grep_exit_codes.sh | No script branches on grep: its exit 2 silently becomes a match or clean. | `tests/compliance/lint_grep_exit_codes.test.ts` | yes | probed | 8 / 0 | OK |
| lint_migration_header.sh | Every forward migration carries the house banner and registers itself in the ledger. | `tests/compliance/lint_migration_header.test.ts` | yes | probed | 8 / 2 | OK |
| lint_migrations_all.sh | Run every migration lint and report every failure, not stop at the first. | `tests/compliance/runner_aggregation.test.ts`, `tests/compliance/lint_migrations_all_complete.test.ts` | yes | probed | 1 / 0 | OK |
| lint_no_drop_cascade.sh | A forward migration may not DROP TABLE ... CASCADE without an override annotation. | `tests/compliance/lint_no_drop_cascade.test.ts` | yes | probed | 4 / 0 | OK |
| lint_no_replica_identity_full.sh | No migration sets REPLICA IDENTITY FULL; it broadcasts deleted rows' contents. | `tests/compliance/lint_no_replica_identity_full.test.ts` | yes | probed | 5 / 1 | OK |
| lint_no_secrets.sh | The repository secret scan: detection in CI, while push protection is the prevention. | `tests/compliance/no_secrets.test.ts` | yes | probed | 10 / 0 | OK |
| lint_no_service_role_in_bundle.sh | No service-role credential may reach any built client bundle. | `tests/compliance/bundle_guards.test.ts` | yes | probed | 8 / 0 | OK |
| lint_no_third_party_fonts.sh | No third-party font host in any built app; it leaks visitors' addresses. | `tests/compliance/bundle_guards.test.ts` | yes | probed | 5 / 0 | OK |
| lint_no_updated_at_filter.sh | Freshness may reorder results, never filter them: at 4am every ward is stale. | `tests/compliance/bundle_guards.test.ts` | yes | probed | 4 / 1 | OK |
| lint_public_table_rls.sh | A table put in public must ENABLE and FORCE row level security, same migration. | `tests/compliance/lint_public_table_rls.test.ts` | yes | probed | 15 / 1 | OK |
| lint_sql_no_bare_not_duty_flag.sh | No bare NOT and no negated equality on a three-state duty flag. | `tests/compliance/lint_sql_bare_not_duty_flag.test.ts` | yes | probed | 6 / 1 | OK |
| lint_sql_quoted_in_prose.sh | Prose SQL comparing to an unquoted YES, NO or UNKNOWN is caught; readers copy it. | `tests/compliance/lint_sql_quoted_in_prose.test.ts` | yes | probed | 9 / 0 | OK |
| neuter.sh | The tracked neuter harness: plant, run the named tests, restore; an untracked one lied. | `tests/compliance/neuter.test.ts` | yes | probed | 10 / 2 | OK |
| neuter_plant.mjs | neuter.sh's plant half; a plant that does not land is fatal. | `tests/compliance/neuter.test.ts` | yes | probed | 13 / 0 | OK |
| pr_evidence.mjs | The PR evidence block, only from one CI run's artefacts, bound to the tested merge. | `tests/compliance/pr_evidence.test.ts` | yes | probed | 42 / 0 | OK |
| predict_counts.mjs | Predict totals from an artefact baseline plus typed deltas; a typed baseline is refused. | `tests/compliance/predict_counts.test.ts` | yes | probed | 22 / 0 | OK |
| provision_target.mjs | The host check: a local run never reaches hosted; hosted writes only the named project. | via provision_ward_account.mjs: `tests/compliance/provision_ward_account.test.ts`, `tests/db/provision_script.test.ts` | yes | probed | 0 / 0 | OK |
| provision_ward_account.mjs | Provision one reporting account through the SQL gates, with one confirmed Auth user. | `tests/db/provision_script.test.ts`, `tests/compliance/provision_ward_account.test.ts` | yes | probed | 18 / 2 | NOT ASSERTED |
| readback_admin.sh | Admin read-back: Access answers first without the token, then the app matches the checkout. | `tests/compliance/readback_scripts.test.ts` | yes | probed | 5 / 0 | NOT ASSERTED |
| readback_common.sh | Shared read-back machinery: a bad URL is refused before any request; one verdict. | via readback_pages.sh, readback_ward_console.sh, readback_worker.sh, readback_worker_limits.sh, readback_admin.sh, readback_public_output.sh, readback_function_grants.sh: `tests/compliance/readback_scripts.test.ts`, `tests/db/function_grants.test.ts` | yes | probed | 11 / 0 | NOT ASSERTED |
| readback_function_grants.sh | Read who can EXECUTE each function, and hold the answer exactly to the fixture. | `tests/compliance/readback_scripts.test.ts`, `tests/db/function_grants.test.ts` | yes | probed | 6 / 0 | NOT ASSERTED |
| readback_pages.sh | The public dashboard's deploy read-backs: 4, 6, 8, /api/health, the privacy notice and the stamp. | `tests/compliance/readback_scripts.test.ts` | yes | probed | 1 / 0 | NOT ASSERTED |
| readback_public_output.sh | A hosted apply changes no public output: readings before and after are compared. | `tests/compliance/readback_scripts.test.ts` | yes | probed | 3 / 0 | NOT ASSERTED |
| readback_signin_link.mjs | A sign-in link goes through api.openbed.ng and lands exactly on its redirect. | `tests/compliance/readback_signin_link.test.ts` | yes | probed | 16 / 0 | OK |
| readback_ward_console.sh | The ward console read-back: its stamp, the deployed key accepted, a wrong key refused. | `tests/compliance/readback_scripts.test.ts` | yes | probed | 0 / 0 | NOT ASSERTED |
| readback_worker.sh | The Worker read-back: each probe proves by header who answered, plus the stamp. | `tests/compliance/readback_scripts.test.ts` | yes | probed | 2 / 0 | NOT ASSERTED |
| readback_worker_limits.sh | Prove the Worker's verify limit is live, once: L forwarded, then a limited 429. | `tests/compliance/readback_scripts.test.ts` | yes | probed | 2 / 0 | NOT ASSERTED |
| render_headers.mjs | Fill the CSP placeholder with the build target's origin only; there is no default target. | `tests/compliance/security_headers.test.ts`, `tests/compliance/readback_scripts.test.ts` | yes | probed | 7 / 0 | OK |
| run_e2e.sh | The golden path in two phases: generate, which may be red, then the ratchet gates. | `tests/compliance/deploy_guards.test.ts` | yes | probed | 2 / 0 | OK |
| run_migrations.sh | Apply migrations in order, each file atomically, skipping those already in the ledger. | `tests/db/migration_runner_atomicity.test.ts`, `tests/db/migration_runner_connection_failure.test.ts`, `tests/compliance/run_migrations_guards.test.ts` | yes | probed | 4 / 3 | OK |
| scan_bundle_credentials.mjs | The bundle guard's matching half: parsed, so documentation of the hazard never fires. | `tests/compliance/bundle_guards.test.ts` | yes | probed | 6 / 1 | OK |
| seed.sh | Load the synthetic seed, and refuse any database that is not obviously local. | `tests/compliance/seed_local_only.test.ts` | yes | probed | 5 / 3 | OK |
| stamp_build.mjs | Write the commit into the build, so what is deployed is fetched, not remembered. | `tests/compliance/build_stamp.test.ts` | yes | probed | 4 / 2 | OK |

**The charter reads 0 FINDING rows** (R-2026-09-29-172, EV-2). It read two when it landed, in R-2026-09-29-171, and the merge letter ruled on both by fixing them in the same pull request, with no register row for either:
- **`deferred_register.d.mts`** had no test that executes it. `tests/compliance/deferred_register_types.test.ts` now parses it with TypeScript's parser and compares it with the module as it runs: the declared value exports, the KINDS tuple, and Row's members with their types.
- **`run_e2e.sh`** had no plant for its stated reason. Its test stub wrote to the word `e2e` rather than to the report file, so phase 2 had run in no test. The stub now reads `--outputFile=`, and plants cover phase 1 red with the ratchet green, phase 1 green with the ratchet red, both red, both green, and a phase 1 that writes no report.
