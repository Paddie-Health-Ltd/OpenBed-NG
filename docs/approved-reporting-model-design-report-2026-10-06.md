# The approved reporting model: design report (letter FY)

**Written in answer to R-PROVISIONAL-2026-10-06-FY, issued by Cowork on 2026-10-06. A design report only.** No migration, no application code, no test change in this pull request. The report is read by Cowork, and the founder holds the choices listed under "Decisions requested". The build letter follows Cowork's review.

**Base:** main at `395cec3`, read from git on 2026-10-06.

**Evidence kinds, marked on each claim.** OBSERVED-BY-ME: read or run by me in this session. EXPLORER: read by a read-only explorer in this session and not re-read by me; where I re-read one it says OBSERVED-BY-ME instead. INFERRED and NOT VERIFIED are named where they apply. Nothing in this report was run against a database: every claim about behaviour is read from source, and the plan in section 7 is what would run.

**Two rulings ride in this pull request and land in the decision record, which is held outside the repository:** FW as -198 and FX as -199. FX's text is in the records directory, in the ruling file named "ruling-2026-10-06-FX-reporting-model-position". It is cited here and not copied.

**Proposed files and functions do not exist yet,** so they are named in prose and never in backticks with a slash, to keep the phantom-path guard from reading this report as a citation (Clause 4). Only paths that exist at this base are backticked.

---

## 0. Premises checked

A reason given with an instruction is a premise, and a premise that fails is said so even where the instruction survives. Items 1 to 6 do not match the code as the ruling states them. Item 7 is a reference I could not re-read.

1. **"`app.assert_member`'s WARD_STAFF widening (026)."** The widening that admits FACILITY_ADMIN is 011's, not 026's. 011 reads `IF v_role = p_required OR (p_required = 'WARD_STAFF' AND v_role = 'FACILITY_ADMIN')` at lines 117-119 (OBSERVED-BY-ME). What 026 did was add FACILITY_REPORTER to that list, at lines 293-294 (OBSERVED-BY-ME). The conclusion in the ruling survives: today FACILITY_ADMIN can do whatever WARD_STAFF can, and cannot publish only because `publish_ward_status` refuses it by name (026, lines 364-368, OBSERVED-BY-ME). The inventory in section 8 uses the correct origin.
2. **"The clauses."** Clauses 2.1, 6.8, 8.3, 8.4 and 8.6 are cited by the ruling. None of them appears anywhere in this repository (EXPLORER, a search of `database`, `docs`, `scripts`, `apps`, `packages`, `tests` and `supabase`). The agreement is held outside it. This report cites the clause numbers as the ruling gives them and does not quote the agreement. The repository's own words for withdrawal are "final in this version", at runbook 12.5, which cites a ruling and not a clause (OBSERVED-BY-ME).
3. **"Suspension (clause 8.4)."** The schema has no suspension. Nothing on a facility, a listing or a login records one. The nearest columns are `is_active`, `quiet_mode` and `monitoring_state`, and none of them means suspended (EXPLORER, a search for the word found only a test that uses it as an invalid input). Section 3 says what that does to the answer.
4. **"The 4b count check."** The name matches two different things, and I am not sure which the ruling means. Both are unaffected by this design (section 3). (i) The runbook's step 4b hand check, a `psql` count of facilities and non-operator ward accounts that reads `0|0` before facility one (runbook line 903, OBSERVED-BY-ME). (ii) Section 4b of migration 024, `app.check_withdrawn_facility_accounts()`, a daily pg_cron job that fails while an account is still active at a facility withdrawn more than 30 days ago (024, lines 235-273, OBSERVED-BY-ME). Because the ruling sets it beside withdrawal, I read (ii) as the likelier meaning and answer for both.
5. **"The register's four states."** They are not exhaustive. A facility with no approval and no active login, which is every facility between its creation and its first approval, belongs to none of the four. Section 4 gives it a value and asks for a ruling.
6. **"Founder SQL only where the admin app cannot reach."** The admin app cannot reach deactivation, and the design does not change that. Deactivating a facility's logins is founder SQL, with no operator function, and is named so in the runbook (12.5, "there is none, deliberately", OBSERVED-BY-ME). A reporting-model switch therefore has one founder-SQL step in it (section 2).
7. **"-71 C and BP-6 4."** The ruling's references say the gates have one implementation, in SQL. They are records held outside the repository, and I did not re-read them. The statement is consistent with the code: `scripts/provision_ward_account.mjs` carries refusal sentences only, and the gates are in `app.provision_begin` (OBSERVED-BY-ME). This is a reference I could not check, and not a mismatch.

---

## 1. (a) The table, and why not columns on the agreement

**The shape I recommend: one new append-only table, `app.facility_reporting_approval`.** It is a sketch, not a migration, and nothing runs it. It is fenced as text and not as sql on purpose: `tests/db/runbook_sql_live.test.ts` refuses a sql fence outside the runbooks, because nothing there would run it.

```text
CREATE TABLE app.facility_reporting_approval (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    facility_id       uuid NOT NULL REFERENCES app.facility(id) ON DELETE RESTRICT,
    model             app.reporting_model NOT NULL,      -- 'FACILITY' | 'WARD'
    approved_on       date NOT NULL,
    agreement_version text NOT NULL,                     -- copied from the acceptance row
    approved_by_role  text,                              -- a job title, never a name
    recorded_at       timestamptz NOT NULL DEFAULT now(),
    recorded_session  uuid,
    CONSTRAINT reporting_approval_version_is_a_label
        CHECK (agreement_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
    CONSTRAINT reporting_approval_role_is_short
        CHECK (approved_by_role IS NULL OR length(approved_by_role) BETWEEN 1 AND 64)
);
```

- **Why these columns.** The ruling asks for the model, the date approved, the agreement version it came from, and at most a job title. The version label and the 64-character title rule are copied from `app.facility_agreement` (021, lines 166-169, OBSERVED-BY-ME), so a version or a title means the same thing in both tables. There is no name column, no free-text column and no address, so no erasure request can reach the table.
- **"Latest in force" is the row with the highest `id` for the facility.** An identity column orders the rows without trusting a clock or a date the operator typed. The approval date is what management signed, and it is not what orders the history.
- **The enum is new.** `app.reporting_model` has the values FACILITY and WARD. Enums are this repository's convention for a closed set (002, lines 7-12, EXPLORER), and the two values are the strings `operator_register()` already returns for the derived model (026, lines 1235-1240, OBSERVED-BY-ME), so the comparison in section 4 needs no mapping.
- **The constraint names do not start with `facility_` on purpose.** `tests/compliance/admin_render.test.ts` reads every `CONSTRAINT facility_… CHECK` in the migrations and requires an admin sentence for each (the pattern at line 838, OBSERVED-BY-ME). A constraint named for this table with that prefix would join the list and need a sentence the operator can never see, because the function refuses before a CHECK could fire. Whether `tests/db/admin_calls_live.test.ts` also selects by prefix is NOT VERIFIED, and the build letter reads it.
- **Why this is not columns on `app.facility_agreement`, which the ruling forbids, and what else fails.**
  - Columns on that row (requirement 2). The row is one per facility, its primary key is `facility_id` (021, line 150), and `operator_record_agreement` never replaces it: anything other than an identical repeat raises `AGREEMENT_ALREADY_RECORDED` (021, line 582, OBSERVED-BY-ME). A changed approval would overwrite the earlier one, or the function would have to stop refusing, which weakens the acceptance record.
  - A jsonb array of approvals on that row. It is still on that row, and it needs the row updated, which the table's own comment says nothing does (021, lines 177-178, OBSERVED-BY-ME).
  - Reusing `app.audit_log`. It would keep a history, but it caps each value at 256 characters, it holds a verb and a field list and no queryable current state, and it is not meant to be read by a function as data (005, lines 146-152, EXPLORER). The audit row for the write stays (section 1, below), and it is not the record.
  - A column on `app.facility`. That table is edited in place, with a trigger-bumped `version` (020), so it has the same overwrite problem and mixes a signed fact into an operational row.
- **No backfill, deliberately.** The migration inserts no row. Deriving facility one's approval from its active logins would record the very thing the approval exists to check them against, and ruling FX says the operator enters it from the signed Schedule 1 once this ships. A row inserted by a migration would also move the `contents` component of the idempotency digest on a re-apply (see section 4, "Migration and idempotency").

**How 010's append-only enforcement applies.** 010 is frozen, so it is not edited. Its pieces are reusable (OBSERVED-BY-ME, 010, lines 74-133):

- `app.raise_append_only()` is generic. It raises `APPEND_ONLY_VIOLATION` with the table's own name, from `TG_TABLE_NAME`. The new migration points one more trigger at it.
- The revoke: `REVOKE UPDATE, DELETE, TRUNCATE` from PUBLIC and then by name from `anon`, `authenticated` and `service_role`.
- The trigger: `BEFORE UPDATE OR DELETE ... FOR EACH ROW`, then `ALTER TABLE ... ENABLE ALWAYS TRIGGER`, so it still fires under `session_replication_role = 'replica'`. The new trigger name follows 010's pattern.
- **One divergence I recommend, and it is a finding about 010.** 010's triggers fire on UPDATE and DELETE only. TRUNCATE is stopped for the three client roles by the REVOKE, and I found no trigger that stops it for the table's owner (010 lines 117 and 129, OBSERVED-BY-ME). Whether the owner can truncate `app.audit_log` today is NOT VERIFIED, because I did not run it. For the new table I recommend a second, statement-level `BEFORE TRUNCATE` trigger, which costs one statement, and a test that the owner is refused. Whether to widen 010's two tables the same way is a separate question and is not asked here.
- **Correcting a wrong entry is an append.** The hint 010 prints says so. A mistyped date, model or title is corrected by recording the right values, and the earlier row stays.

**Retention.** I recommend permanent, with no job and nothing to erase.

- The table holds a date, a version label, a closed two-value model and a job title. It holds no personal data, which is the property clause 8.6 states for the acceptance record, as the ruling cites it (clause number as given; not in the repository, premise 2).
- The facility key is `ON DELETE RESTRICT`, as every facility foreign key is, so the rows cannot be deleted by deleting the facility, and no function or job deletes them.
- **Which record it follows.** Neither clause names this table. Clause 8.6, as cited, covers the acceptance record. The approval is evidence of what management approved under that acceptance, so I recommend it is kept for as long as the acceptance record is, which is permanently. A withdrawal does not purge it, as it does not purge the acceptance row (runbook 12.5). That is my recommendation and not a stated rule, and it is listed under "Decisions requested" for the founder and counsel, because a retention rule is not an engineering gate.
- **What would change the answer:** if counsel reads the approval as outside the acceptance record and wants it erased after some period, the table needs a purge, and an append-only table needs an exception for it. Nothing here builds toward that.

**The write.** A new operator function, `public.operator_record_reporting_approval(p_facility_id text, p_model text, p_approved_on date, p_approved_by_role text)`, beside `operator_record_agreement` and built on the same pattern (021, lines 515-584, OBSERVED-BY-ME). `app.assert_operator()` first, then `app.operator_session()`, then text arguments cast with `INVALID_ARGUMENT` and a DETAIL, then named refusals before any CHECK can fire.

- Refusals, in order: `INVALID_ARGUMENT` for a bad facility id or a model that is not FACILITY or WARD; `NO_SUCH_FACILITY`; `AGREEMENT_NOT_RECORDED` (there is nothing to approve under); `AGREEMENT_WITHDRAWN` (final, so no approval is recorded after it); a future `p_approved_on` by the Lagos calendar, as 021 does for the acceptance date (a new code, for example `APPROVAL_DATE_IN_FUTURE`); and a title over 64 characters as `INVALID_ARGUMENT`.
- **The version is not a parameter.** The function copies it from the facility's acceptance row. It cannot be mistyped, and it cannot name a version the facility did not accept. This is a departure from `operator_record_agreement`, which takes the version because it is the record of it.
- **Identical repeat and correction.** If the facility's latest approval has the same model, date and title, the function appends nothing and returns `recorded = false`, as 021 does. Anything else appends, including a corrected date or title. I considered refusing a same-model, different-date request as "unchanged", and decided against it: append-only leaves a correction no other path.
- **Serialising.** The function takes the facility row `FOR UPDATE` before it reads the latest approval, as the 026 trigger does before it counts active logins (026, line 212, OBSERVED-BY-ME). Two approvals at once, or an approval and a login activation at once, are then ordered.
- **Audit.** One `app.audit_log` row per append, action `reporting_approval.record`, with the earlier model in `old_value` and the new in `new_value`, each a few characters of jsonb, far inside the 256-character cap. The cap measures normalised jsonb, which adds a space after each colon (005, EXPLORER), and the values here are small enough that this does not matter. Nothing is truncated: an oversized value would be refused, and none can be produced here.
- **Founder SQL is not needed for the write.** The admin app reaches it. The one thing the admin app cannot reach is the deactivation in a model switch (premise 6).

---

## 2. (b) Should `app.provision_begin` refuse?

**Recommendation: yes, in SQL, in both cases.**

- **Contradiction.** A reporting login whose kind disagrees with the facility's latest approval is refused with a new code, `REPORTING_MODEL_NOT_APPROVED`, with the approved model in DETAIL.
- **No approval recorded.** Any reporting login at a facility with no approval is refused with the same code and a DETAIL that says none is recorded.
- **Where.** In both reporting branches, after the "already active, return complete" exit and before `REPORTING_MODEL_CONFLICT` (026, lines 658-670 and 698-707, OBSERVED-BY-ME). Three consequences:
  - A re-run for a login that is already active still returns `complete`, as J4 requires: nothing opens and the script makes no Auth call.
  - The refusal is raised before an invite opens, so the script has made no Auth call. A refusal after the Auth user exists leaves an orphaned user, which the runbook already has to handle for the two refusals `provision_complete` can raise (runbook 12.4 step 5b, OBSERVED-BY-ME). This one never reaches that path.
  - A facility that has both a contradicting approval and an active login of the other kind reads the approval refusal, which names the cause, and not the generic conflict.
- **One implementation, in SQL.** `scripts/provision_ward_account.mjs` carries only a sentence per code (its table at lines 232-250, OBSERVED-BY-ME) and gains one for the new code. Neither the script nor the admin app reimplements the rule (-71 C and BP-6 4, as cited in the ruling; the code agrees, premise 7). `app.provision_begin` is not among the nine functions whose codes the admin labels are held to (OBSERVED-BY-ME, `admin_render.test.ts`, lines 785-794), so the new code needs a script sentence and no admin sentence.
- **Mechanics.** The new migration restates `app.provision_begin` with `CREATE OR REPLACE`, keeping its signature and its `RETURNS TABLE (status text, invite_id uuid)` result, so nothing about the idempotency invariant changes (section 4). Its grants are owner-only and stay so.

**What this does to facility one if it is provisioned before this ships.**

- Its active logins are untouched. Nothing in the migration reads or changes them.
- The register reads APPROVAL_NOT_RECORDED for it (section 4).
- A re-run of a login that is already active returns `complete`. A **new** login at facility one, for another ward or the first after a deactivation, is refused until the operator records its approval from the signed Schedule 1. Reactivating a deactivated login goes through `provision_begin` first, so it is refused the same way (the reactivation sits in `provision_complete`, against an invite that only `provision_begin` opens: 026, lines 788-820, EXPLORER).
- The recovery is one operator step in the admin app, and it is the step the ruling already asks for ("for facility one, the signed Schedule 1 is the record, entered by the operator once P2 ships").
- **The trade-off.** Refusing when none is recorded stops an onboarding in progress until the approval is entered. The alternative, refusing only a contradiction, leaves APPROVAL_NOT_RECORDED as a state a new facility can reach and stay in, because nothing forces anyone to record. The refusal is what makes "the operator provisions what the signed Schedule 1 approved" a rule and not a hope. If that cost is too high for the weeks before facility two, the contradiction refusal can ship first and the none-recorded refusal later, as a second one-line change to the same function. I do not recommend it.

**A model switch in progress (deactivate first, then provision).**

1. The operator records the new approval in the admin app. The register reads MISMATCH, and stays there until step 2. This is transitional and correct: approval and logins disagree, because they do.
2. The founder deactivates the old kind of login with SQL, the same step as 12.5's step 2 but not for the whole facility. The register reads NOT_YET_PROVISIONED.
3. The founder provisions the new kind. `app.provision_begin` agrees with the approval, and `REPORTING_MODEL_CONFLICT` does not fire because no other kind is active. The register reads MATCHES.

Provisioning before step 1 is refused by the new gate. Provisioning between 1 and 2 is refused by `REPORTING_MODEL_CONFLICT`. So the three steps cannot be done in any other order, and each refusal names its cause. A switch needs a runbook procedure with a read-back for step 2, which is section 5.

**A gap, INFERRED and not built against.** The gate is at `provision_begin`, the point an invite opens. `app.provision_complete` runs later, after the Auth user exists. An approval recorded between the two would let the account be created against the new approval, and the register would then honestly read MISMATCH. I do not recommend a second gate in `provision_complete`: its refusals arrive after an Auth user exists and a re-run cannot fix them (runbook 12.4 step 5b), and the window needs two operator actions within one script run. The register is the backstop.

---

## 3. (c) Interactions

| Thing | What happens | Evidence |
|---|---|---|
| **Withdrawal** (clause 8.3, final) | Approval rows stay: the table is append-only and has no deletion path. The record function refuses a withdrawn facility, so a withdrawn facility's history is closed. After 12.5 step 2 deactivates its logins, the register would compute NOT_YET_PROVISIONED, which reads like a pending onboarding. The screen therefore leads with the withdrawn line, and the approval state is secondary (section 6). | 021 table and `operator_register`, OBSERVED-BY-ME; runbook 12.5, OBSERVED-BY-ME |
| **Suspension** (clause 8.4) | No interaction: nothing in the schema is a suspension (premise 3). If a later build adds one, whether it hides the approval is that build's question. | EXPLORER |
| **Reactivation** | A deactivated login returns through `provision_begin` and then `provision_complete`. The new gate sits in the first, so a reactivation is checked against the latest approval like any new login. | 026, EXPLORER |
| **`REPORTING_MODEL_CONFLICT`** | Unchanged, and kept as the backstop. The trigger `trg_ward_account_one_reporting_source` still stops two kinds of login being active together, whatever `provision_begin` says, so a direct insert by a privileged role cannot create one. The approval gate does not replace it. | 026, lines 198-233, OBSERVED-BY-ME |
| **4b, the runbook hand count** | Unaffected. It counts `app.facility` rows and non-operator `app.ward_account` rows, and a new table that is not an account changes neither count. It reads `0|0` before facility one as before. | runbook line 903, OBSERVED-BY-ME |
| **4b, the 024 check** | Unaffected. It joins active accounts to `app.facility_agreement.withdrawn_on` and does not read the new table. It remains the only thing that notices a missed 12.5 step 2, and the register's state does not stand in for it: a withdrawn facility with a login still active reads MATCHES or MISMATCH, which says nothing about withdrawal. | 024, lines 246-266, OBSERVED-BY-ME |
| **Unlisted facility** | The state does not depend on `listed_at`. Provisioning happens before listing (the golden-path test asserts the provisioned facility stays unlisted: EXPLORER), and `provision_begin` never reads `listed_at` (OBSERVED-BY-ME, its body in 026). An unlisted facility reads its state like any other. | 026, lines 609-742 |
| **What the register shows for a withdrawn facility** | `agreement_state` reads `withdrawn` (as today), and the new approval state is returned as computed. It is not blanked, because a withdrawn facility with an active login is a fact the operator should still see. | 026, lines 1229-1232, OBSERVED-BY-ME |

---

## 4. (d) The register's return shape

**Recommendation: add keys to each facility object in `operator_register()`. Do not rename it.**

- `operator_register()` returns `jsonb` (026, line 1171, OBSERVED-BY-ME). A new key inside the object is not a return-type change, so 021's note (lines 36-51, OBSERVED-BY-ME) does not bite. That note is about changing a function's return type in place, which makes the older migration fail on re-apply: 020's list became 021's envelope under a new name for that reason. 023 and 026 each added keys to this function the same way (the migration README rows for 023 and 026, OBSERVED-BY-ME).
- The new keys on each facility: `approved_model` (FACILITY, WARD, or null), `approved_on` (a date or null), and `reporting_approval_state`, described below. The existing `reporting_model` (the model the active logins make) stays exactly as it is.
- **The four states, computed in SQL once, from two things.** `approved` is the latest approval's model for the facility, or null. `derived` is the existing `reporting_model` expression (FACILITY, WARD or NONE). Compare against the latest approval only.

  | approved | derived | `reporting_approval_state` |
  |---|---|---|
  | set | NONE | NOT_YET_PROVISIONED |
  | null | FACILITY or WARD | APPROVAL_NOT_RECORDED |
  | set | the same | MATCHES |
  | set | the other kind | MISMATCH |
  | null | NONE | **null** (the gap in premise 5) |

- **The fifth cell, and my recommendation for it.** A new facility has neither an approval nor a login, and the ruling's four states do not name it. I recommend the key reads JSON null, not a fifth string, so the four named states stay exactly four and the code that reads them cannot confuse "nothing recorded yet" with a state of reconciliation. The screen gives null its own sentence (section 6). It is listed under "Decisions requested".
- **What MATCHES means.** It compares the kind of login, not coverage. A per-ward facility with two of its five wards provisioned reads MATCHES, and the wards without a login keep their own `has_account` and `provisioning_incomplete` flags (026, lines 1257-1270, OBSERVED-BY-ME). An open facility-reporter invite that is not yet accepted leaves `derived` at NONE, so the state reads NOT_YET_PROVISIONED while setup is incomplete, which is the honest reading.
- **The admin app.** `apps/admin/src/parse.ts` refuses any value it does not know, rather than guessing (lines 117-129, OBSERVED-BY-ME), so it must be extended to accept exactly the four strings or null, and the new keys, in the same change. A model it cannot read is an unreadable register, as for `reporting_model` today.
- **Migration and idempotency, read and not run.** `tests/db/migration_idempotency.test.ts` applies every forward migration in sorted order and compares a digest of the whole schema and every `app` table's rows before and after (OBSERVED-BY-ME, lines 88-100). Because the re-application is in order, the later definition of a function wins at the end, so restating `app.provision_begin` and `operator_register()` in a new migration is the same move 020, 021, 022 and 026 each made. Two things the new migration must hold to: its enum is created inside a `DO` block guarded on `pg_type`, as 002's are, and it inserts no row.
- **Grants and the closed list.** The new function is executable by `authenticated` alone, with `REVOKE ALL` from PUBLIC and from the three named roles first, as every `operator_*` function is (026, lines 1280-1293, OBSERVED-BY-ME). It needs an entry in `packages/fixtures/function-grants.json` and two entries in `supabase-proxy/allow-list.json`, one for the POST and one for its preflight (the existing pair for `operator_record_agreement` is at lines 45 and 61, OBSERVED-BY-ME).

---

## 5. (e) Runbook 12.4 step 5, restated

Today step 5 opens with a question to the facility ("Does one nurse in charge know the beds for the whole hospital on each shift?") and routes to 5a or 5b by the answer (lines 4847-4853, OBSERVED-BY-ME). The ruling's position is that the operator provisions what the signed Schedule 1 approved. So the step reads the signed form and stops asking.

**The new step 3a, lettered and not numbered**, after "3. Record the contact and the agreement" and before "4. Add the ward categories". This is how the runbook added 2a without moving the numbers other records cite (line 4838, OBSERVED-BY-ME):

> 3a. **Record the approved reporting model** in the facility's detail view, from the facility's signed Schedule 1, Part A ("Who reports"). Read the box the facility ticked. Do not ask the facility, and do not infer it from who is available to sign in. Enter the model (one login for the whole facility, or one login per ward), the date the facility signed it, and the signer's job title. **Never a name.** PASS: the facility's line in the register reads "Approved: …" and not "No approved reporting model is on file yet."

**Step 5's first paragraph, replaced** ("First, ask the facility…" and its three bullets):

> **Provision to what step 3a recorded.** The register's reporting line for this facility names the approved model. Read it, and then:
> - **One login for the whole facility:** step 5b.
> - **One login per ward:** step 5a, one ward at a time.
> - **The register says no model is approved:** stop. Do step 3a first. `app.provision_begin` refuses any reporting login at a facility with no approval (`REPORTING_MODEL_NOT_APPROVED`).
> - **Never both at one facility:** one reporting source per ward, as before (`REPORTING_MODEL_CONFLICT`).

**Step 6, after the last login for this facility, gains a read-back:** the facility's register line must read "Logins match the approved model", and the state must be MATCHES. NOT_YET_PROVISIONED after the last intended login means a login is missing, and MISMATCH means stop.

**A new procedure under 12.4, "Changing a facility's reporting model"**, with the three steps of section 2 and a read-back after each: the register line after step 1, the count of active logins at the facility after step 2 (a founder SQL block, in the form of 12.5 step 2, and so a new fence the runbook-SQL tests must run), and the register line after step 3.

**What the runbook edit must keep green, from the existing guards (OBSERVED-BY-ME unless marked):**
- `tests/compliance/runbook_migration_expectation.test.ts` derives step 5's pending-migration expectation from the migrations directory, so the migration's own pull request restates it. This report does not edit the runbook.
- The deferred-items test reads 12.4 from its heading to the line starting "2. **Create**", so step 1's boxes are not touched by any of this (EXPLORER).
- `tests/db/runbook_12_4_12_5_sql_live.test.ts` runs fences by anchor text (the 6a, 6b and 12.5 anchors). A new SQL fence needs its own anchor and psql counts, and renaming an existing anchor reds it (EXPLORER).
- The runbook's pasted-block guards (no history expansion, the libpq path line, one `read` line followed by an `unset`) apply to any new fence (EXPLORER).
- The pull request carrying the migration must answer the template's "Runbook expectations this migration changes" line (`.github/PULL_REQUEST_TEMPLATE.md`, OBSERVED-BY-ME).

---

## 6. (f) Admin wording

Plain sentences, in the register and in the detail view. Each is a label key under the screens in `packages/labels/admin-labels.json`, beside the existing reporting-model words ("One login for the whole facility", "One login per ward", "No reporting login yet": EXPLORER). The wording is provisional, like the file's own status.

| State | Register line | Detail view |
|---|---|---|
| NOT_YET_PROVISIONED, whole facility | "Approved: one login for the whole facility. Not set up yet." | "This facility approved one login for the whole facility on {date}. That login is not set up yet." |
| NOT_YET_PROVISIONED, per ward | "Approved: one login per ward. Not set up yet." | "This facility approved one login per ward on {date}. No ward login is set up yet." |
| APPROVAL_NOT_RECORDED | "Logins are active. No approved reporting model is on file." | "This facility has active logins, but no approved reporting model is recorded. Record it from the facility's signed Schedule 1." |
| MATCHES | "Logins match the approved model: {one login for the whole facility / one login per ward}." | "The active logins match what the facility approved on {date}: {one login for the whole facility / one login per ward}." |
| MISMATCH | "Logins do not match the approved model. Approved: {A}. Active: {B}." | "The active logins do not match what the facility approved on {date}. Approved: {A}. Active: {B}. Do not add logins until this is resolved." |
| null (nothing yet) | "No approved reporting model is on file yet." | "No reporting model is approved for this facility yet. Record it from the facility's signed Schedule 1 before any login is set up." |
| Any state, facility withdrawn | the withdrawn line only | "This facility has withdrawn. Its approved reporting model stays on file for the record." |

- **The withdrawn facility is the one place the state must not lead.** NOT_YET_PROVISIONED on a withdrawn facility reads as an onboarding waiting to finish (section 3). The screen shows the withdrawn line, and the approval line only in the detail view.
- **Dates** are shown as the date the facility signed, as stored. The operator's device clock is not used.
- **Labels and codes.** The admin app's label table is held to the codes the operator functions raise, both ways (`tests/compliance/admin_render.test.ts`, lines 856-861, OBSERVED-BY-ME), and the new function becomes the tenth in that list. Each code it can raise needs a sentence, and the test's own name and count change with it. Which of its codes already have a sentence (`AGREEMENT_WITHDRAWN` and `AGREEMENT_NOT_RECORDED` may, since other operator functions raise them) is read from the label table by the build letter, and is NOT VERIFIED here.
- The approval form has three fields: the model, the date, and the job title. It has no version field, because the function copies the version.

---

## 7. (g) The test plan

Names only, in this repository's grammar (`.claude/rules/test-conventions.md`, section 5). **Nothing below is built, and nothing here claims a run.** Each control states its planted false-green.

**`db` tests (Postgres and PostgREST):**

- `operator record_reporting_approval — an operator records the first approval succeeds`
- `operator record_reporting_approval — an identical repeat appends nothing and returns recorded=false`
- `operator record_reporting_approval — a changed model appends a second row and the first is kept`
- `operator record_reporting_approval — a corrected date or title appends and the earlier row is kept`
- `operator record_reporting_approval — a facility with no agreement rejected with AGREEMENT_NOT_RECORDED`
- `operator record_reporting_approval — a withdrawn facility rejected with AGREEMENT_WITHDRAWN`
- `operator record_reporting_approval — a future date rejected`
- `operator record_reporting_approval — a model that is neither FACILITY nor WARD rejected with INVALID_ARGUMENT`
- `operator record_reporting_approval — the version is the acceptance row's, and no argument can change it`
- `ward staff and anon calls to record_reporting_approval rejected` (the existing cross-tenant and role grammar)
- `append-only — update, delete and truncate on facility_reporting_approval are rejected for postgres and for each client role, and the triggers read ENABLE ALWAYS`
- `audit — an append writes one reporting_approval.record row carrying the old and new model, inside the 256-character cap`
- `register — each of the four states, and the null cell, read as the table says`
- `register — after a second approval, only the latest is compared`
- `register — a withdrawn facility returns its computed state and agreement_state withdrawn`
- `provision_begin — a login that contradicts the latest approval is rejected with REPORTING_MODEL_NOT_APPROVED, in both directions`
- `provision_begin — a login at a facility with no approval is rejected with REPORTING_MODEL_NOT_APPROVED`
- `provision_begin — an already-active login returns complete without an approval check`
- `provision_begin — the model switch, in order: approve, deactivate, provision, and each wrong order refused with its own code`
- `provision_begin — FACILITY_ADMIN still reaches ROLE_NOT_PROVISIONED_IN_V1`
- `migration 029 — round trip, re-apply changes nothing, and the down refuses while an approval row exists` (the per-migration pattern from 018 to 028, and 021's `AGREEMENTS_RECORDED` refusal as the model)

**Planted false-greens, and the leg each one proves:**

- A gate that checks only the contradiction and not the none-recorded case. The none-recorded test reds.
- A gate placed before the "already active" exit. The already-active test reds.
- A comparison against the earliest approval, or against any approval. The "latest only" test reds.
- An UPDATE or TRUNCATE trigger that is created but not `ENABLE ALWAYS`. The trigger-state assertion reds, as `tests/db/config_drift.test.ts` does for 010's two.

**Hard-coded lists and fixtures the build edits, each of which reds when the table or function arrives (OBSERVED-BY-ME):**

- `tests/db/append_only_enforcement.test.ts`, the table list at line 34 and the name list at line 116.
- `tests/db/config_drift.test.ts`, the trigger names and the count of two at lines 221-226.
- `tests/db/rls_enabled_everywhere.test.ts`, the exact list of `app` tables (17 today, lines 88-107).
- The function fixtures and closed lists: `packages/fixtures/function-grants.json`, the authenticated-executable closed list, `tests/db/rls_rpc_execute_allowlist.test.ts` and `tests/db/rpc_definer_safety.test.ts`, plus the two proxy entries (EXPLORER for the last three files).
- The label table and the tenth operator function in `tests/compliance/admin_render.test.ts`, and the facility id, the model, the date and the title in `apps/admin/src/bodies.ts` (EXPLORER).
- The migration README table gains a row, and the migration's down file is paired and checked by `tests/compliance/down_migration_symmetry.test.ts` (EXPLORER).

**`compliance` rows (no database):**

- `plant — a table with a person's name column is rejected` and `real facility_reporting_approval column list is accepted` and `anti-vacuity — checker over an empty column list fails`: the new table's column list is a checked-in fixture with a forbidden-identity list, in the form of `packages/fixtures/audit-log-columns.json`, read by a lint and by a `db` test (the shared-fixture link, `.claude/rules/test-conventions.md` section 8, OBSERVED-BY-ME).
- `real facility_agreement column list is unchanged` is how requirement 2 is held: no approval column ever lands on that table. It reads the migrations' columns for `app.facility_agreement` and asserts the set by identity.
- `register — the four-state rule is derived in SQL only`: no TypeScript reimplements it, by the same shape as the existing single-implementation check for the provisioning gates (`tests/compliance/provision_ward_account.test.ts`, EXPLORER).
- Rendered text for all four states and the null case, over `jsdom`, with an unknown value refused (`admin_render.test.ts`'s existing style).
- The leg register and `docs/scripts-charter.md`: no guard script changes, so `current` and the per-script counts do not move. The one possible exception is the new sentence in `scripts/provision_ward_account.mjs`; whether an entry in its sentence table is a registered leg is NOT VERIFIED and the build letter reads `tests/compliance/_legs.ts` first. If it is, the `current` block is restated in the same change (`tests/compliance/leg_coverage.test.ts` pins it by exact equality: the FT report's premise 6).

**NOT ASSERTED, deliberately:**

- The hosted apply of the migration, and that hosted `app` has the new table and trigger. These are runbook steps like every earlier migration's, and `applied-hosted.json` is written only by a hosted apply. Asserting them would need the management credential this repository declines (`.claude/rules/test-conventions.md` section 4).
- That the owner role cannot truncate `app.audit_log` today (section 1). It is a question about 010 and is not tested here.

---

## 8. The P3 inventory: what admits FACILITY_ADMIN through `app.assert_member`

**An inventory only. Nothing is changed.** FACILITY_ADMIN stays unprovisionable in v1, and this feeds the later read-only rule.

`app.assert_member(p_facility_id uuid, p_required app.app_role)` has had two definitions: 011 (lines 67-125) and 026 (lines 239-300), and 026's is current (OBSERVED-BY-ME). A caller passing `'WARD_STAFF'` admits a FACILITY_ADMIN, and since 026 a FACILITY_REPORTER too (premise 1). Every caller in the migrations was swept with `git grep` over the forward files (OBSERVED-BY-ME):

| Function (current definition) | The call | Reads or writes | What a FACILITY_ADMIN gets |
|---|---|---|---|
| `public.publish_ward_status` (026, call at line 360) | `app.assert_member(v_facility, 'WARD_STAFF')` | **Writes**: `app.ward_status`, `app.ward_status_event` and `app.audit_log` (EXPLORER for the three tables) | Admitted by `assert_member`, then refused by name at lines 364-368 with `INSUFFICIENT_ROLE` |
| `public.my_reporting_wards()` (026, call at line 555) | `app.assert_member(v_facility, 'WARD_STAFF')` | Reads its own facility's wards and their latest event (EXPLORER) | Admitted. `can_publish` is false for the role (EXPLORER) |
| `public.ward_status_history` (015, call at line 98; 026 does not restate it) | `app.assert_member(v_facility, 'WARD_STAFF')` | Reads its own facility's events, capped at 200 rows and 30 days (EXPLORER) | Admitted. Nothing narrows it by role |

Earlier definitions of the same three (011, 014) are superseded and are not callers any more (EXPLORER). No caller passes `'FACILITY_ADMIN'` or `'FACILITY_REPORTER'` as the required role (the sweep found only the `'WARD_STAFF'` calls above, OBSERVED-BY-ME).

**Notes that feed the later read-only rule:**

- **Today the effective surface is two reads.** The one write is refused by a name check inside the function and not by `assert_member`. A fourth function that calls `assert_member` with `'WARD_STAFF'` and writes would admit FACILITY_ADMIN to the write unless its author remembered the name check. That is the accident ruling FX describes. The sweep above is how the next author finds out.
- **`assert_member` also lets PLATFORM_ADMIN through every check** and for every facility (026, lines 280-283, OBSERVED-BY-ME). A read-only rule keyed on role has to say what it does about the operator.
- **`ward_status_history` is granted to `authenticated` and is not in the proxy's allow-list** (`packages/fixtures/function-grants.json`, line 41; the allow-list holds `my_reporting_wards` and `publish_ward_status` only, OBSERVED-BY-ME, a search of the proxy for the name found nothing). It is a read, so it does no harm; the later screen should decide whether to route it.
- **FACILITY_ADMIN is unprovisionable only through one door.** `app.provision_begin` raises `ROLE_NOT_PROVISIONED_IN_V1` in its final ELSE (026, lines 719-722, OBSERVED-BY-ME). The enum value, the scope CHECK's FACILITY_ADMIN arm and `assert_member` all still honour the role, and tests insert it directly as the owner (EXPLORER: three test files). A privileged role could create a FACILITY_ADMIN membership by direct insert, and nothing in the schema forbids it. That is the state ruling FX meant by "unprovisionable in v1".
- **The app code never names the role.** A search of `apps`, `packages` and `scripts` for FACILITY_ADMIN found nothing (OBSERVED-BY-ME).
- **There are no RLS policies on the role set.** Authorisation is entirely inside the SECURITY DEFINER functions, and the `app` schema is not exposed to PostgREST (EXPLORER).

---

## 9. What this does not do

- It builds nothing and applies nothing. No migration, function, table, label or test exists after this pull request that did not exist before it.
- It does not change who may be provisioned. FACILITY_ADMIN stays refused.
- It does not answer the state-oversight, management-screen or break-glass questions in ruling FX (P3's build, P4 and P5). Those are phased against pilot scope.
- It does not touch `app.facility_agreement`, and section 7 holds a test that says so.

---

## Decisions requested

1. **Section 1, retention.** Permanent, no job, kept alongside the acceptance record. The founder's choice, with counsel's read of clause 8.6 as cited.
2. **Section 2, the gate.** Refuse both a contradiction and a none-recorded login (recommended), or a contradiction only for now.
3. **Section 4, the cell the four states leave out.** A facility with no approval and no login: JSON null (recommended), or a fifth state with its own name.
4. **Section 1, the date.** Whether the approval date may precede the acceptance date. The report proposes no lower bound and only the future-date refusal, because Schedule 1 may be signed on a different day from the acceptance recorded for the same facility. I do not know which day the acceptance row records in practice.
5. **Section 1, TRUNCATE.** The new table gets a statement-level truncate trigger, which 010's two tables do not have. Whether to widen 010's tables the same way is a separate letter.
6. **Section 5.** Whether the new step is lettered 3a (recommended, so no cited number moves) or the steps renumber.

Nothing is hosted. Nothing is deployed. No source, test or page changes.
