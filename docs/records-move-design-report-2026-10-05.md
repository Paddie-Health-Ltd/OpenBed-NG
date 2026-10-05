# Records move: design report (letter FT)

**Issued as R-PROVISIONAL-2026-10-05-FT, by Cowork, 2026-10-05. A design report only.** No file moves, no deletion, no test change in this pull request. The report is read by Cowork, with the staff-engineer and platform-sre checks, and the founder holds the choice in section 3.

**Base:** main at `4a5d2f7`, read from git and the API on 2026-10-05.

**Evidence kinds, marked on each claim.** OBSERVED-BY-ME: read or run by me in this session. SWEEP: found by one of three read-only `git grep -F` sweeps of tracked files this session, each with a known-present control hit; the sweep's file and line citations were not all re-read by me, and where I re-read one it says so. INFERRED and NOT VERIFIED are named where they apply.

**This report names the move set by path because it is about them.** After the move those paths no longer resolve in the repository. To keep the phantom-path guard from reading this file as a citation that will rot, the paths of files that will leave are written without backticks. Proposed files that do not exist are named in prose, not as paths (Clause 4).

---

## The move set

29 tracked files (OBSERVED-BY-ME, `git ls-files`): 16 under "Sprint Kickoffs/", 12 handoff documents under `docs`, and the facility-agreement clause-X access-addresses document. Not in the set: `docs/legal`, `docs/site`, `SECURITY.md`, `README.md`, `LICENSE`, the runbooks, `.claude/rules`.

The set is recomputed with `git ls-files` at move time. It will not be the same bytes as today: ruling -195 (FS) lands in the decision record in this pull request.

---

## 0. Premises checked

A reason given with an instruction is a premise, and a premise that fails is said so even where the instruction survives.

1. **"The register-count tripwire."** There is no assertion over the register count. `scripts/pr_evidence.mjs` prints `Register : N (kinds), from the tree` at line 582 (OBSERVED-BY-ME). `tests/compliance/deferred_items.test.ts` asserts the row count is greater than zero (line 197, SWEEP). The decision record itself says no test pinned the old counts. So the tripwire is a printed line that a human reads, not a test. Its new home is the same printed line (section 2).
2. **"contacts reads content as input."** It does not use the move set's content as input. `tests/compliance/contacts.test.ts` exempts the two path prefixes (line 37) and asserts the walk reaches "Sprint Kickoffs/" (line 70) (OBSERVED-BY-ME). It is a location dependency. After the move the exemption is dead code and line 70 is red.
3. **"A visible skip."** The repository has no skip anywhere (SWEEP: no `skipIf`, `.skip`, `.todo`). `.claude/rules/test-conventions.md` section 6 requires a test that cannot reach what it needs to fail, and Standard O in `.claude/rules/code-pipeline.md` treats a net-new `.skip` as a cardinal-sin shape. A records-absent skip would be the first in the repository and needs a written exception (sections 1 and 2).
4. **"Runbooks and .claude/rules are NOT in the set."** True, but three backticked citations of a handoff document in them go red under the phantom guard once the files leave (section 1, class c).
5. **"Local paths from the earlier scrub letter."** I do not have that letter. Section 4's inventory is my own grep. Whether it is the letter's set is NOT VERIFIED.
6. **A correction to my own working plan, found while writing section 2.** I had assumed the leg register's pinned figures can only rise. They are pinned by exact equality: `tests/compliance/leg_coverage.test.ts` asserts the measured leg total, reached count and registered count each `toBe` the `current` block (lines 259, 260 and 266, OBSERVED-BY-ME). Only the 2026-09-10 baseline block is a floor (reached at least 1). So a leg added or removed reds the test until `current` is restated in the same change.

---

## 1. Inventory, with the smallest change for each

Convention proposed: one environment variable, OPENBED_RECORDS_DIR, unset by default (the repository already uses OPENBED-prefixed names, and an out-of-repository records directory already exists for the legal texts, named in `docs/legal/README.md`). Where a test must skip, the skipped test's own name carries the reason, for example "needs OPENBED_RECORDS_DIR".

### (a) Reads content as input

| Consumer | What it does today | Smallest change |
|---|---|---|
| `tests/compliance/deferred_items.test.ts` (lines 58, 191) | Reads the decision record and holds its register against the unticked boxes at runbook 12.4 step 1 | Only the real-record legs wait on the variable: skipped, with the reason in the name, when it is unset. The synthetic plants and the empty-corpus leg stay in CI |
| `scripts/pr_evidence.mjs` (line 119 and the read at 484-489) | Reads the record under `--root`, prints the register line, refuses with exit 2 if it cannot read it | Resolve the record under the records directory. Unset gives the existing refusal with its message naming the variable. No skip: it is a tool run by hand, not a CI job |
| `tests/compliance/pr_evidence.test.ts` (lines 63, 326) | Builds a synthetic record in a scratch repository | Point the scratch record at a scratch records directory. The real record is never read |
| `scripts/lint_sql_quoted_in_prose.sh` (lines 42, 64) with `tests/compliance/lint_sql_quoted_in_prose.test.ts` (lines 26, 98-124) | Scans every tracked `.md`; excludes the decision record by name; the test asserts the excluded path is a tracked file | The record leaves the tree, so the exclusion is dead. Delete it. Rewrite the stale-exclusion legs to assert the script excludes nothing. The other 28 files in the set scan clean today (SWEEP). Scanning private records with this lint is dropped: its purpose is SQL that gets pasted from runbooks |
| `tests/compliance/contacts.test.ts` (lines 14, 20, 37, 70, 106-110) | Exempts the move set from the address check; asserts the walk reaches it | Delete the exemption and line 70. Anti-vacuity moves to a corpus that stays (the runbooks). Rewrite the plant as "no exemption: a file at a handoff-style path is scanned" |
| `scripts/lint_no_secrets.sh` (the `secret-scan` job) | Scans every `.md` | No change; the scanned set shrinks. A local scan of the records directory is a founder choice: the script requires a git work tree as its root (line 105, OBSERVED-BY-ME), so a plain directory is refused. NOT ASSERTED otherwise |

### (b) Cites a path only (no test reads these)

SWEEP (none re-read by me except where stated elsewhere in this report): `scripts/deferred_register.mjs` (line 7), `eslint.config.mjs` (59), `packages/snapshot/src/serve.ts` (84), `supabase-proxy/index.js` (5), `supabase/config.toml` (334), `database/migrations/README.md` (92, 145), `tests/compliance/per_app_reach.test.ts` (19), `scripts/provision_ward_account.mjs` (95, the clause-X document, unbackticked), `.claude/rules/code-pipeline.md` (266), `docs/runbook-cloudflare-worker-proxy.md` (488), `packages/origins/contacts.json` (2, prose naming the tree), nine citations in `docs/runbook-supabase-project-creation.md`, and test-header prose in `tests/compliance/contacts.test.ts` and `tests/compliance/no_phantom_paths.test.ts`.

Change: reword to "the decision record, held outside the repository", or drop the sentence. One coupling to keep in step: `tests/compliance/lint_sql_quoted_in_prose.test.ts` asserts that the script's own header names the excluded path, so that header and that test are edited together.

### (c) Covered by the phantom-path guard

The guard scans every `md|ts|tsx|sh|sql|yml|yaml|mjs|json|toml` file for a backticked path that contains a slash and begins with a known top-level directory, and requires it to exist. "Sprint Kickoffs/..." can never match its pattern (a capital and a space), so citations of the record are invisible to it. Handoff paths do match.

- **Three backticked handoff citations in files that stay** (OBSERVED-BY-ME): `.claude/rules/test-conventions.md` lines 402 and 407, and `docs/runbook-cloudflare-pages-beds-json.md` line 237. Each goes red once the file leaves. Reword. About 50 more citations of handoff and clause-X paths sit inside move-set files and leave with them (SWEEP).
- `tests/compliance/no_phantom_paths.test.ts`, lines 50-63: two exemption keys name moved files. Its anti-rot legs would red ("matches no citation"). Delete both keys, each paired with the reason that its subject left.
- Lines 118-123, `PLANNED_ARTEFACTS`: four planned paths are cited only from one kickoff document (SWEEP). Once it leaves, the anti-rot leg reds "registered but cited nowhere". Remove the four entries. This removes assertions, so under Standard O it is paired with a stated rationale: the planning document is no longer in the repository, and the entries would be a claim nothing can retire. It is not a deletion to reach green.
- Line 143, the `PLANNING_DOC` pattern, and the plants at lines 379 and 436: retarget or retire with the entries above.
- `tests/compliance/top_level_tracked_entries.test.ts`, line 67: remove "Sprint Kickoffs" from the expected set. It is an allowlist compared by identity, so it fails loudly by design.
- The guard loses 1,385 of 1,826 citations (SWEEP, measured). Its anti-vacuity floor (more than 30) is still met.

### Frozen migrations

No SQL migration cites a move-set path (SWEEP). Twelve of them say "the kickoff" without naming it. A byte change to an applied migration fails the frozen-migrations test, so they stay as written. A reader of one of those comments is pointed at a record that is no longer public. That is accepted and stated here.

### Not asserted now, to be read at move time

`docs/scripts-charter.md` pins a leg count per script. `scripts/predict_counts.mjs` takes per-file deltas from the previous run; I read its header (OBSERVED-BY-ME) but not whether it accepts a delta that removes tests. NOT VERIFIED. The move deletes real-record tests, so that must be read first.

---

## 2. What public CI would no longer prove, and where it runs instead

**No longer proven in public CI:**

1. The real record's register agrees with the unticked boxes at runbook 12.4 step 1 (the real-record legs of the deferred-items test).
2. The real record parses under the register parser.
3. Secret, address and SQL-quoting scans over the 29 files.
4. The existence of the 1,385 citations those files hold.

**Still proven in public CI:** the PLANT and ANTI-VACUITY legs of every checker above, over synthetic corpora. Only the ACCEPT leg over the real artefact moves. `.claude/rules/test-conventions.md` section 2 says a guard ships all three legs; this makes the third conditional, and the report says so rather than leaving it to be found.

**Where it runs instead:** locally, by the implementer, before each pull request, with OPENBED_RECORDS_DIR set to the founder's records directory. The pull request body states the command, the run and skipped counts, and the printed register line. This is a human step. Nothing blocks a pull request that omits it, and no script is cited as enforcing it (Clause 4, the weaker form the repository can execute).

**The register-count tripwire's new home** is the printed Register line of `scripts/pr_evidence.mjs`, run by hand with the variable set. Unset, it refuses with exit 2, which is its behaviour today with a message that names the cause. It is not in CI and was not. Cowork's own read of the register at each review is the second reader.

**Does any pinned count or the leg register move?**

- **No register count is pinned** (premise 1). None moves.
- **Attestation totals** (compliance 2665, db 958, ratchet 10 at `4a5d2f7`, read by me from the push run's artefacts) are attested per run and not pinned. The compliance total will fall by the real-record tests that skip or go; the PR body states the new figures from its own run.
- **The leg register moves only through failure-site edits in guard scripts**, and `current` must then be restated in the same change (premise 6). Expected: the refusal message in `scripts/pr_evidence.mjs` that today reads "the decision record is not readable at" is a registered reached leg (SWEEP); rewording it to name the variable renames one leg's identity, and a separate message for the unset variable would add one leg with a plant. Deleting the exemption in the SQL lint changes no failure message. The result is measured with the leg-coverage test at move time. NOT CLAIMED until run.
- **The charter's per-script counts** follow the same rule and are read at move time.

**Guard classification (Clause 5).** The two classes, LIVE and GUARD-AHEAD-OF-SUBJECT, do not describe a guard that runs only where the records are present. A third, for example LOCAL-ONLY (subject held outside the repository), needs a ruling. It is proposed, not adopted here.

**How the evidence block shows a skip.** `scripts/attest_counts.mjs` counts a skipped case from its `<skipped` tag, prints `skipped=N`, leaves the Disposition at ZERO-RED when `ran` is above zero, and adds a note that each skip needs a named reason (SWEEP). A skip is not a red. It does not read the reason from the XML. The reason lives in the skipped test's name. Whether the junit file keeps that name for a skipped case is NOT VERIFIED until built. An optional line in the evidence block, SET or UNSET for the records directory, would be a new leg and a separate decision.

**Rule text that changes in the same pass** (`.claude/rules/test-conventions.md` section 8): a named exception to section 6 for a records-absent subject, a sentence in Standard O that a records-absent skip is a declared and counted skip and not a quarantine, and the Clause 5 class above. These are pipeline amendments. Cowork and the founder rule on them. I do not write them here.

---

## 3. Two ways to keep the guards live

| | A. Records directory on the founder's Mac, local run | B. Private companion repository; CI pulls it with a founder-created token |
|---|---|---|
| Build | One variable, one skip pattern, three rule sentences | A new job or checkout step, a token held as a CI secret, a new required check (the job set is pinned by `packages/fixtures/required-checks.json` and a test), a runbook step |
| Upkeep | The founder keeps the directory current; guards run before each pull request | Token expiry, rotation, an access review |
| Enforcement | A human step | Machine-enforced on same-repository pull requests only; a fork receives no secrets and so skips |
| Leak surface | None new | CI logs of a public repository are world-readable, and a failing guard over private text would print it. The token is reachable by workflow code that any pull request with write access can edit. The repository's own precedent declines a management token in CI on credential-surface grounds (`.claude/rules/test-conventions.md` section 4) |
| Skips in public CI | The real-record legs skip | None |

**Recommendation: A.** There is one implementer, so the enforcement gap is small, and B opens a log-leak path that defeats the reason for the move. Cowork leans the same way. **The founder holds the choice.**

A variant for Cowork if a skip is unacceptable: put the real-record legs in a vitest project that CI never runs. That removes the first-skip exception but leaves no CI line at all for those legs. Noted, not recommended.

---

## 4. Scrub items

**The location remark.** A comment at `apps/admin/src/main.ts` lines 64-67 says where the operator often is (OBSERVED-BY-ME). Proposed neutral sentence: "the operator's device may be in any time zone." It is a comment-only edit. `tests/compliance/lagos_time.test.ts` (line 55) plants a non-Lagos device zone as a fixture and makes no claim about the operator. Changing it would be a test change; whether to is Cowork's call.

**Local paths.** This is my inventory (premise 5), SWEEP except where marked.

- Home-relative paths to the deploy working tree appear in six runbooks. No test, script, package or app mentions that path (OBSERVED-BY-ME, `git grep -F` over those four trees, no hit). Reword to "the deploy working tree".
- `docs/legal/README.md` (line 21) names the out-of-repository records directory with a home-relative path. Reword.
- `docs/runbook-cloudflare-worker-proxy.md` (lines 519, 565) name private reading files. Reword.
- The libpq PATH line in runbooks is a tool-install path, not a personal one, and four tests require the literal line: `tests/compliance/runbook_psql_path.test.ts`, `tests/compliance/runbook_read_pasted_alone.test.ts`, `tests/compliance/runbook_no_history_expansion.test.ts` and `tests/db/runbook_sql_live.test.ts`. Recommendation: leave it. Scrubbing it means changing four guards.
- Paths inside the move set leave with it.

---

## 5. Sequence

1. This pull request, carrying FS, merges. **Nothing moves before FS has landed.**
2. Cowork checks this report, with the staff-engineer and platform-sre checks. The founder chooses A or B and rules on the rule amendments.
3. At move time, from main as it is then: list the set with `git ls-files`; copy the files into the founder's BedSpace folder; compute sha256 on each source and each copy and compare them. Any mismatch stops the move. **The founder deletes nothing.**
4. After the copies are checked, one pull request removes the files and applies sections 1, 2 and 4. It runs the full suite on a fresh database and derives its counts with `scripts/attest_counts.mjs`.
5. The founder merges. A branch is deleted only after MERGED is read back from the API, as a separate step.

---

## 6. What moving does not do

Moving the files removes nothing from git history, from open or closed pull request threads, from forks or clones, or from copies already taken. The repository stays public, and what has been published stays published. Anything in the set that should not have been public is treated as already disclosed, and that is handled outside this move.

---

## Decisions requested

1. Section 3: A or B. The founder's.
2. Section 2: the three rule amendments (the exception to section 6, the Standard O sentence, the Clause 5 class), or the variant in section 3.
3. Section 4: whether the libpq PATH line stays, and whether the fixture zone in the time test changes.
4. Section 1: confirm that the SQL lint is dropped over private records and that the four planned-artefact entries are removed with a rationale.

Nothing is hosted. Nothing is deployed. No source, test or page changes.
