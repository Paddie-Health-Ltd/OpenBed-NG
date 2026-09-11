# Handoff — BedSpace / OpenBed-NG — Stage 0 and the guard-leg sweep — 2026-09-10

Prepared by: Cowork handoff
Supersedes nothing. `docs/handoff-2026-09-10.md` remains the record for the Bundle 1 period; this one continues from it.

## Division of responsibilities

Claude Code implements, tests and ships; **Cowork scoped the stages, ran the specialist review and reviews each pasteback**; the founder holds the hosted apply, the facility agreement and the clinician questions. That split held all session and is the reason `frontier.json`, `golden-path`, and the leg register exist in provable rather than asserted form.

**One thing changed about it.** Branch protection is a GitHub repo setting and Cowork cannot reach it — there is no `gh` and no token in the shell Cowork uses to reach the machine. The flip was authorised by Cowork and **executed by Claude Code**. Do that again the same way; do not wait on Cowork to run it.

## Where things stand

**`main` is at `eda8592` — PR #7 merged. Stage 0 is done and the gate is live.**

`golden-path` is now the seventh required status context on `main`, alongside `repo-lint`, `migration-lint`, `compliance-tests`, `db-tests`, `bundle-guards` and `secret-scan`, with `strict: true` and `enforce_admins: true`. **The commit that installed the gate went through the gate**, not around it — all seven were required and green at merge time.

**PR #8 (`guard-leg-sweep`) is green and unmerged.** Sixteen commits. It is the leg sweep plus the Part C referral-guard spec amendment. Nothing blocks merging it: the gate is live, the checks are green, and no further review is outstanding.

**Stage 1 has not started.** Not a delay — a dependency. See *Open items*.

### The spine — what Stage 0 actually installed

Not a test suite. A **frontier ratchet**: `packages/fixtures/golden-path-steps.json` decomposes Release Gate 2 into 20 ordered steps; `tests/e2e/golden-path.test.ts` runs one real, executed assertion per step; `tests/e2e/frontier.json` records where the path currently stops; `tests/e2e/ratchet.test.ts` is the merge-blocking artifact.

The mechanism worth preserving: the ratchet reds when the step **after** the frontier starts passing. Progress cannot be reported by a human — it is extracted by a failing gate, and moving the frontier is a visible one-line diff in the PR that delivered the work. There is no `.skip` and no `.todo` anywhere in `tests/e2e/`; every unimplemented step is a real failing assertion against code a later stage brings.

Current frontier: `magic-link-expired-refused`, index 3. Observed run 4 passed / 16 failed / 0 skipped, ratchet 10/10. **The frontier got there by four separate observed moves, not by reasoning** — the file carries that rule in its own text, which is why it is trustworthy.

### The leg sweep — what it was and what it found

The trigger: `lint_audit_log_columns.sh`, the guard for CTO condition (1), had its Leg 2 masked by Leg 1 and could never fire. Cowork called it a class rather than an instance. It was.

| | legs | proved |
|---|---|---|
| Baseline, 2026-09-10 | 77 | **1** |
| Now | 86 | **65** |

**The baseline is immutable and must stay that way.** It is a historical fact; the register is the live measurement. Asserting the current total against the baseline was tried and reverted — it demanded the record be rewritten in order to record progress, which is the one thing a baseline must never do.

21 legs remain registered as unreached, each naming a seam that does not exist: 10 `could-not-run` (need an unreadable-input seam whose behaviour under a root CI user is untested), 8 `no-seam`, 3 `no-injectable-hook` — `get_publishable_key.sh`, registered as a **design smell to fix when that script is next touched for its own sake**, not as testing debt.

Real defects found along the way, all closed:

- **Seven fail-open guards**, found after widening the grep guard from the piped `grep -q` form to any grep in a branch position. Including `lint_no_service_role_in_bundle.sh` — the guard between a service-role key and a public browser bundle — and a `lint_no_secrets.sh` narrowing filter where an exit 2 emptied the variable, silently dropping every secret already matched.
- **`seed.sh`'s local-only check was a substring match.** `localhost.attacker.example.com` passed and reached the `psql` step; on a machine with `psql` installed it would have seeded synthetic hospitals into a remote database. Live, not theoretical.
- **The dead legs were genuinely dead.** Deleting `lint_migration_header.sh`'s check-1 arm left every test in that file green; check 2 — the copied-header detector its own header calls load-bearing — was the same.
- **`lint_audit_log_columns.sh`'s anti-vacuity check could be bypassed by the input it exists to catch.** The awk parser `next`ed past the `"columns":` line, so a one-line array meant it never saw the closing bracket and read on into `forbidden`, returning that as the column list. Non-empty, so "refusing to pass vacuously" never fired.
- **`run_e2e.sh` skipped its Standard O attestation on exactly the runs that needed it** — `RATCHET_ST=$?` after a vitest call under `set -e` is unreachable when the ratchet fails. A defect in the gate itself.
- **Five defects in the measuring instrument**, each found by the repository's own guards rather than by inspection. The sharpest: a stale-entry branch guarded by `reg === guards`, so no plant could ever reach it — a leg written in an unprovable shape, inside the instrument built to find legs in that shape.

### Four rules, and the number that is not progress

`.claude/rules/test-conventions.md` §*Three ways a leg becomes unprovable (2026-09-10)* now records them, each with the real defect that produced it: an instrument must not accept prose as evidence, including its own header comments; a leg guarded by an identity check against the production object can never be reached by a plant; a baseline is a historical fact and must never be a live assertion target. Plus the positive-control rule: every guard parsing user-supplied input needs a control that is the **most ordinary valid input**, because a guard that refuses legitimate input gets bypassed by the next person who hits it at 2am.

**Read one figure carefully.** Reached moved 21 → 38 in a single commit with **no coverage added** — those 17 legs were asserted all along and the matcher could not see them. A figure that moves because the ruler changed is not progress, and it is labelled as such in PR #8's body. That matcher had been widened four times, once per way a test happened to be written, which is why the boundary is now comment-versus-code: an instrument that recognises one spelling dictates how tests get written.

### Two process incidents, both recorded rather than buried

**A commit landed on a red suite.** The secret scanner correctly flagged a new test file carrying literal remote Postgres URLs with passwords; `git commit` was chained after a `grep` that succeeds regardless of the test result, so it went through. Amended, never pushed. Two fixes: the trigger was removed (the guard reads the host, so the plants never needed credentials at all — and removing them exposed a parser bug that had been refusing the entirely ordinary `postgresql://localhost:5432/postgres`), and `scripts/gate.sh` now fails the commit on a non-zero status. Written up in PR #8's body in the project's own terms: *the guard reached, the verdict was correct, the process consuming it did not act on it.*

**Push protection is enabled and unverified, deliberately.** `secret_scanning`, `push_protection`, AI detection and `non_provider_patterns` are all on. Whether it would have blocked that push is **not established, and must not be established by pushing a password-bearing commit to a public repo** — that is testing a control by attempting the harm it prevents, the same rule the previous handoff applies to the merge-blocking probe. So this class has no verified control, only two unverified layers, and what caught the incident was a person reading. That is registered as named residue, not left as coverage.

## What's next — in order

**1. Merge PR #8.** Nothing is outstanding on it. The gate is live, the checks are green, and it is the last thing between `main` and a proved guard set. Claude Code merges; no further authorisation needed.

**2. Founder: the hosted apply.** This is the only thing blocking all product progress and it has been outstanding the whole session. It is first among the founder's items for that reason. The sequence, from `docs/runbook-supabase-project-creation.md`:

- Prove the exposed legacy key is dead — assert **401 specifically**, never "not 200". `public.ward_public` does not exist on hosted until the migrations land, so a live key returns 404 there and a dead one returns 401; "not 200" passes on both.
- Apply the migrations. Treat `--dry-run` as a stop condition: **exactly 13 pending**, or stop and report. The apply then says `12 applied this run` and **that is correct** — 001 is applied by a bootstrap step because the ledger cannot record its own creation. Confirm by the ledger, never by the count.
- The three hosted checks: exposed schemas over HTTP, append-only under the non-superuser hosted `postgres`, and hosted magic-link single-use. **Anything not run is recorded as not-run, never as assumed.**

Verified this session rather than assumed: hosted project `klrlpxysjsjpdkeqdhvl` (eu-west-1, ACTIVE_HEALTHY), `app` and `public` both hold **zero tables**, all 13 pending, no `014`. Note the CLI ledger being empty would *not* have settled this — `run_migrations.sh` records in `app.schema_migrations`, not the CLI's table, so an empty CLI ledger is compatible with a completed house-runner apply. The table check is what settles it.

**3. Stage 1, non-migration work.** Available now, in parallel with the apply, and it is where Claude Code should go the moment PR #8 merges: `apps/ward-console/` (magic-link sign-in, one screen, reusing the auth route the E2E harness proved — not a second one), `scripts/provision_ward_account.mjs` (service-role, GoTrue admin invite, insert `app.ward_account` with `id` = the auth user id — a script, not an RPC, because Sprint 1 ships no admin surface for an RPC to have a caller), **two ward accounts at one facility on different categories** (the second exists solely to make the ward-scope check observable), and `packages/snapshot/src/freshness.ts` and `anchor.ts`.

**Stop at `handover-lists-facility-wards`.** The step after it needs `014`.

**4. Stage 1's migration work**, once the apply lands: `014` carrying the `client_mutation_id` unique index, then `publish_ward_status` with its ward-scope check, the symmetric `composed_at` window, and the `session_id ≠ auth.uid()` test against a real GoTrue token — which is the first and only assertion of **CTO condition (2)** anywhere in the codebase.

**5. Stages 2–5** per `Sprint Kickoffs/sprint-kickoff-bedspace-v2-2026-09-10.md`, unchanged.

## Fundamental — carries forward

> **Everything must flow. The system must work end to end. Do not build pretty standalone pieces that do not connect.** Nothing merges that is not reachable from the golden path — **as amended**: that rule is about user-facing features, not control loops. Stage 4 owns zero golden-path steps deliberately; escalation observes the path rather than sitting on it.

> **Any failure must be foundationally resolved.** Fix the root cause, not the symptom. Before calling a fix done, understand everything it touches or could touch — other stages, shared modules, callers, tests, and work already shipped — so the fix does not quietly create a new problem elsewhere. Resolve it in the same pass, in place; do not file a ticket for something that can be fixed now.

That principle is what turned "one masked leg in one guard" into 86 legs measured, seven fail-open guards closed and a live remote-seeding hole shut. **The instance is almost never the class.** Three times this session, asking "what else is in this shape" found more than the original finding: the grep widening found seven, the host-check question found a parser bug shipped one turn earlier, and the leg sweep found five defects in its own instrument.

**Two decisions that must not be rebuilt.** Stage 1 is ward-scoped — no individual accounts, no `actor_identity_map`, no `REFERRER` role, no identity-bearing column on `app.audit_log` and no `detail jsonb`. Stage 5's outcome loop is ward-to-ward, and it is the single place the ward-identity decision gets undone by accident; it will look like a natural thing to do at the time. Leg 5 of the referral guard is what catches it — and Part C found that four of its eight specified plants tripped leg 1 as well, so **deleting leg 2 entirely would have left every plant still redding.** It would have looked correct and proved one leg of five. Build it against the amended spec, not the original.

## Canonical docs

- `Sprint Kickoffs/sprint-kickoff-bedspace-v2-2026-09-10.md` — the six stages, the nine findings in merged code, the migration-window rule, and the four open decisions. **Read first.** Amended this session with the Part C plant-isolation requirement and the Stage 4 exception to the golden-path rule.
- `Sprint Kickoffs/sprint-kickoff-bedspace-v1-2026-09-08.md` — still authoritative for what is *in* each bundle. v2 sequences it; it does not replace it.
- `Sprint Kickoffs/decision-2026-09-08-ward-level-identity.md` — the ward-identity memo and the CTO's two blocking conditions. Condition (2) is still unasserted until Stage 1's migration work.
- `docs/handoff-2026-09-10.md` — the previous handoff: the ward-category audit, the two probes, the CI-intermittent appendix. Note its claim that the grep shape is *"banned mechanically rather than remembered"* was **corrected this session** — one of two forms was banned, and a live instance of the other survived that sweep.
- `docs/runbook-supabase-project-creation.md` — the hosted apply and every hand-check that cannot be automated. §5b now states that magic-link single-use is covered by the local-integration leg only, against a named GoTrue version.
- `docs/runbook-key-rotation.md` — key exposure and the proof-of-death probe.
- `docs/facility-agreement-clause-x-access-addresses.md` — Clause X in operative language, what to build behind it and what deliberately not to, and eight questions for a Nigerian-qualified lawyer. **Founder-side.**
- `.claude/rules/test-conventions.md` and `.claude/rules/code-pipeline.md` — Clause 4, Clause 5, Standard O, plant-then-assert, and the four new rules for unprovable legs.
- `packages/fixtures/leg-coverage.json` — the register. `baseline_2026_09_10` is immutable; `current` moves.
- `packages/fixtures/golden-path-steps.json` and `tests/e2e/frontier.json` — the ratchet's contract and its position.

## Open items / blockers

**Blocking, founder-side.** The hosted apply, in the order above. Nothing in Stages 1–5 that touches a migration can proceed until it lands, and `database/migrations/001–013` must not be edited — the window is closed from now, and every fix is `014` or later.

**Blocking nothing, but unfinished.** 21 registered legs, each with a named seam that does not exist. `get_publishable_key.sh` is the one to look at when that script is next touched — a script with no injectable seam is a design problem, not a testing one. And the push-protection residue: enabled, unverified, and it must stay that way until a cheap non-harmful probe exists.

**Founder-side, non-blocking, carried from the v2 kickoff.** Clause X needs a Nigerian-qualified lawyer before it goes in front of a CMD — two of its eight questions are ripe now: whether a supplier's warranty plus an express no-verification acknowledgement keeps the Operator outside controllership, and what actually binds a Lagos State public tertiary hospital, since that determines whether `agreement_accepted_at` evidences anything. Separately: the NDPC registration threshold question has been asked of nobody, and the public dashboard still has no privacy notice — half a day of writing, and the first artefact a hospital's legal officer asks for.

**Named exception, not a silent ticket.** The four clinician questions are unanswered and time-boxed at two days. Everything landed stands either way: both ward-category corrections have the cheap-if-wrong asymmetry, because recovery is `ALTER TYPE ... ADD VALUE`, the one enum operation that survives a live ledger. **Hesitation on the ICU split blocks; the other three do not.**
