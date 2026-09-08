# Code Checking Pipeline — Standing Operating Procedure (OpenBed-NG)

**Version 1.0 — 2026-09-08. Sunset review 2026-12-07 (+90 days).**
Silent continuation past a sunset date without a revisit is itself a rule violation.

This is a **slim port** of the pipeline SOP used in the sibling project
PH-Doc-Assistant-v1. It deliberately drops that document's multi-persona stage
choreography (QA specialist → developer → staff engineer → tester → auditor),
its post-merge authorisation gates, its amendment history, and its two-party
`sop-patches/` machinery. OpenBed-NG has one implementer. Porting rules nothing
in this repo can discharge would itself violate Clause 4 below, and dead rules
teach a reader — human or agent — to skim past live ones.

What is kept is what earns its keep in a repository where **most guards ship
before the code they guard exists**. That is the defining condition of Sprint 1
here: Bundle 1 is the security boundary and Bundle 7 is the set of gates over
it, and both land before there is a single feature.

---

## Clause 4 — No phantom enforcement

**No rule, comment, docstring or document in this repository may cite an
enforcement artefact that does not exist at the merge SHA.**

A clause naming a repo-relative script, test, CI job or hook discharges this in
exactly one of three ways, chosen when it is written:

1. **The artefact lands in the same change.**
2. **The clause is rewritten in the weaker form the repo can actually execute** —
   a named human step, a one-command check, no cited script.
3. **The clause does not ship.**

An unbuilt enforcement artefact reads exactly like a built one to every future
reader. That is a false statement at the level of the constitution, and it is
worse than an admitted gap because it stops anyone looking.

**Scope.** A cited path is in scope if it appears in backticks, contains `/`,
and is not introduced as a negative or hypothetical example. Bare basenames
(`ci.yml`) are out of scope. Gitignored paths must be cited *without* backticks
so they do not read as repo paths.

**This applies with full force to hand-checks.** Several things this project
depends on cannot be tested from inside the repository — the Supabase region
pin, the hosted exposed-schemas list, hosted superuser behaviour. Each is
recorded as a checklist step in `docs/runbook-supabase-project-creation.md` and
named as unautomatable in the test that comes closest to it. **Shipping a test
that claims to check one of them would be the exact defect this clause exists to
prevent.**

---

## Clause 5 — Machinery claims carry their probe

Clause 4 ends the phantom that is **absent**. This clause ends the phantom that
is **present and does not reach**.

A statement asserting, in the present tense, that a mechanism exists, is live,
runs, is enforced, or reaches a target must carry the probe that establishes it.
**A date is not a probe and a commit SHA is not a probe.**

This binds hardest on the guards that ship before their subject matter. At the
first commit, the `service_role` bundle grep and the `updated_at`-filter grep
are real jobs running over a real built bundle — but that bundle is a stub, so
their true present-tense claim is *"this guard executes and would catch a
violation, over a corpus that does not yet contain the code it is aimed at."*
Writing "the service-role grep protects the dashboard" instead would be a claim
that is present, plausible, and does not reach.

Every guard is therefore classified, in `README` or in its own header, as one of:

- **LIVE** — the code it guards exists now.
- **GUARD-AHEAD-OF-SUBJECT** — the guard runs and is non-vacuous, but the code it
  is aimed at arrives in a named later bundle.

Reclassifying a guard from GUARD-AHEAD-OF-SUBJECT to LIVE is part of the bundle
that brings its subject matter, not a separate tidy-up.

---

## Standard O — Red-disposition discipline

**A tolerated set of failing tests destroys the ability to tell a new failure
from an old one, and will silently absorb a real regression.**

Before opening a PR, state the **RED-DISPOSITION ATTESTATION** in the PR body:

```
RED-DISPOSITION ATTESTATION (full suite, fresh per-run database)
  Invocation : <the verbatim command, matching CI>
  DB         : fresh per-run (supabase db reset + run_migrations.sh + seed.sh this run;
               NOT a reused local database)
  collected=<N> ran=<N> passed=<N> failed=<N> errored=<N> skipped=<N>
  Disposition: ZERO-RED  |  ONE NAMED GUARD FAILURE — <test id> — <ticket>
```

It holds only if `failed + errored == 0`, `ran > 0`, and the database was
provisioned fresh in that run.

**"exit 0", "CI green" and "green by skip" are not attestations.** A green job is
not a run test: a required check that was skipped reports as passing, and a
database test that silently skipped because it could not connect reports the
same way.

**The six counts are derived, never read off the terminal.** Run vitest with
`--reporter=junit --outputFile=junit.xml` and derive them with
`node scripts/attest_counts.mjs junit.xml`. A terminal summary that scrolled
past is not an artefact. Note that reconciling the count identities proves
internal consistency and never extraction correctness — two different
derivations can both satisfy `ran == passed + failed + errored` and still be
extracting the wrong thing.

**A red is exactly one of these. There is no "pre-existing, CI adjudicates"
bucket.**

- **(i) Fixed at root — a tightening.** The defect is fixed so the assertion is
  the same or stronger.

  > **Cardinal sin, and it blocks however clean CI looks afterwards:** deleting or
  > weakening an assertion, broadening a `catch`, relaxing a tolerance, or adding
  > `.skip` / `.todo` **in order to reach green**. Before merging, run
  > `git diff <base>..<head> -- 'tests/**' | grep -E '^-.*(expect|rejects|toThrow)'`.
  > Every removed or weakened assertion must be paired with a stronger
  > replacement and a rationale, or the change is rejected. Any net-new `.skip`
  > must cite a quarantine ticket.

- **(ii) Proven harness or infrastructure defect — fixed, or made loud.** "Proven"
  needs all three of: a fresh-database reproduction, a **named** mechanism (which
  file, which env var, which migration object — not the bare category), and an
  independently verifiable repro. Turn cryptic per-test noise into one loud
  root-pointing failure.

- **Flaky carve-out — the only grey area.** Requires all of: three fresh-database
  full-suite runs showing pass and fail with no code change; visible quarantine
  that keeps the test running and reported, not a bare skip; a tracked ticket
  with a determinism plan; and a sunset date. Missing any one of these makes it a
  loosening, which is branch (i) and blocking. A growing quarantine list is the
  failure mode resurfacing — stop and reassess.

**Scope guard.** A change owns only the reds on surfaces it touches or asserts
zero on. It is never required to fix an unrelated failure elsewhere. Gating a
clean isolated change on a foreign red is itself the anti-pattern this standard
exists to avoid.

---

## Standard P — Audit method for control-deliverable changes

**Binding:** applies when the deliverable **is** a control — a test, a guard, a
linter, an attestation tool, or a control over another control. **In Sprint 1
that is nearly every change**, because Bundle 1 and Bundle 7 are almost entirely
controls.

Two passes, once each, **in this order**:

1. **Behavioural — *is the module wrong?*** Aimed at false facts in comments,
   headers and citations: a claim about a line number, a grant, a column name, a
   table, a file that does not hold.
2. **Control-integrity — *can the tests fail?*** The plant-then-assert discipline
   in `.claude/rules/test-conventions.md`.

**The order is the whole contribution.** A control-integrity pass presupposes the
module under test is right, so running it first anchors the effort on the wrong
question — and the absence of new integrity findings then reads as convergence
while a false fact sits unexamined.

**Two devices make the ordering real:**

- **Declare the stopping rule before the pass begins**, in the PR body: the
  behavioural question asked, and the kind of finding that ends the pass.
  Declared first, stopping is the documented choice. Declared after, an
  exhausted question iterates forever and reads *nothing found* as convergence.
- **File a BEHAVIOURAL-PASS LEDGER in the PR body.** A shallow behavioural pass
  and a real one produce the same output — *nothing found*. One row per control
  the change delivers, columns:
  `control | question asked | tracked off-diff file re-derived against | planted-wrong value | reported diff`.
  Each row plants a known-wrong value against a file that is **tracked in git
  AND outside this change's own diff** — both conditions, since either alone is
  dodgeable. **A ledger with fewer rows than the change has controls is not a
  discharge:** one plant proves the instrument is live, never its coverage.

A control-integrity finding blocks only on the first pass. **A gap that permits a
false fact blocks on any round.**

**Single-pass exception:** a pure rename or formatting change to an existing
control may run the control-integrity pass alone, if the change states the
behavioural surface is unchanged and cites the diff proving it.

---

## Pre-Merge Gate

All must pass before merge. In CI these are the jobs in `.github/workflows/ci.yml`;
run locally, they are the same commands.

**1. Build.** `npm run build` and `npm run typecheck` exit 0. No unresolved
imports.

**2. Test suite.** `npm run test` exits 0, with the Standard O attestation. No
skipped tests unless documented in the PR body.

**3. Secrets.** `bash scripts/lint_no_secrets.sh` reports **zero** findings.
There is no acceptable threshold — a committed secret is a compromised secret,
and the `anon` key published in the browser bundle makes the `service_role` key
the one credential in this system that cannot be rotated quietly.

> Note the division of labour, and do not misstate it: **GitHub secret scanning
> with push protection is the prevention control** and is a repository setting
> enforced server-side at push time. The `secret-scan` CI job is a **detection**
> control that runs after the push was already accepted. A CI job cannot block a
> push.

**4. Dependency audit.** No critical or high CVEs. **Every new package is
verified to exist on the public registry before it is added** — check the name
against npm, check it has a plausible download count and maintenance history,
and confirm it is not a typosquat. AI agents hallucinate package names and
attackers register the common hallucinations.

**5. AI hallucination spot-check.** Pick three items at random from the
AI-specific block of the self-check below and verify them independently. If any
one fails, the change goes back for a full re-verification of every AI-specific
item — one hallucination means there are probably more.

---

## AI Agent Self-Check Protocol

**Run this before opening any PR and confirm each item in the PR description. A
PR opened without it is incomplete.**

**Build and test**

- [ ] Builds and type-checks with no errors.
- [ ] Full suite ran to ZERO-RED on a fresh per-run database, with the
      RED-DISPOSITION ATTESTATION pasted, derived via `scripts/attest_counts.mjs`.
- [ ] Every test the plan called for exists and passes.
- [ ] No new lint errors.

**Security**

- [ ] No hardcoded secrets, keys or tokens anywhere in the diff.
- [ ] No real facility names, real duty phone numbers, staff names or any
      patient data in code, tests, fixtures, seed data, logs or error messages.
- [ ] Every input validated server-side, not only in the client.
- [ ] Every query parameterised — no string interpolation into SQL.
- [ ] Every new RPC enforces membership server-side from `auth.uid()`, never
      from a caller-supplied `facility_id` argument.

**AI-specific — the block standard pipelines miss**

- [ ] Every `import` resolves to a package that actually exists in
      `package.json` or in this codebase. New dependencies checked against the
      npm registry by name.
- [ ] Every third-party function called actually exists in the version pinned
      here. An agent will confidently call `library.methodThatDoesNotExist()` and
      it looks perfectly reasonable until runtime.
- [ ] Every Postgres feature used behaves as claimed in the version Supabase
      actually runs — not as inferred.
- [ ] No patterns copied from a different architecture. This project has no ORM,
      no PostGIS, and no Realtime on the public path.
- [ ] No `// TODO: implement` placeholders masquerading as finished work.

**OpenBed-specific — the three failure modes this build predicts**

- [ ] **No `!flag` or `flag === false` on a duty flag, and no bare `not` on a
      `tri_state` in SQL.** The flags are three-state. `NOT NULL DEFAULT
      'UNKNOWN'` makes the wrong shape unrepresentable in the database; use
      `is false` / `is not false` in SQL. On day one no facility has touched a
      flag, so a single falsy check renders every hospital in Lagos as closed —
      and in SQL `not <null>` is `null`, which is not `true`, so the row silently
      drops out of a filtered query while the JavaScript version reports it
      truthy. The two layers disagree and neither errors.
- [ ] **No `service_role` or `SUPABASE_SERVICE*` reachable from a client-imported
      module, a `NEXT_PUBLIC_` variable or a `VITE_` variable.** When blocked by
      the security boundary, the temptations are to widen an RLS policy or to
      reach for the service key "temporarily". Base tables are physically
      unreachable, so widening a policy on them achieves nothing; and in a public
      repo a leaked service key is a total compromise of the one credential that
      cannot be rotated quietly.
- [ ] **An oversized audit value is REJECTED, never truncated.** `old_value` and
      `new_value` are capped at 256 characters of *normalised* jsonb. If a value
      does not fit, the write fails and the caller is told. Never trim to fit: a
      silently truncated audit value is a data-integrity failure that would never
      go red, because the record looks complete and is wrong. Note the cap
      measures the form Postgres stores, which is longer than your own JSON string
      -- jsonb inserts a space after each key's colon.
- [ ] **No new `where` / `.filter()` / `.lt()` / `.gt()` on `updated_at` on the
      public search path.** Freshness may reorder results; it may never filter
      them. At 4am every ward in the system is stale, so any freshness filter
      empties the entire result set at exactly the hour the tool matters most.

**Architecture**

- [ ] Every external call has a timeout (≤12s), bounded retries with backoff and
      jitter, and cannot roll back a database write when it fails.
- [ ] Multi-step database operations are one transaction. Status, event, audit
      and outbox rows commit or roll back together.
- [ ] Mutations carry a client-generated idempotency key.
- [ ] **No last-write-wins on a bed count.** Optimistic concurrency on `version`,
      and a 409 surfaces the conflict to the user rather than auto-retrying.
- [ ] No write is ever queued for background replay. A bed count is an assertion
      about *now*; replaying it later manufactures a fresh-looking badge for data
      that was already stale when it was queued.

---

## How to use this document

**Before writing feature code:** there must be a test plan. Name what each test
asserts and, for a control, what its planted false-green is.

**While writing:** read `.claude/rules/test-conventions.md`. It carries the
plant-then-assert contract and the test-name grammar, which are requirements
here rather than style preferences.

**Before opening a PR:** run the self-check above, paste the attestation, and —
if the deliverable is a control — declare the Standard P stopping rule and file
the behavioural-pass ledger.

## What this pipeline does not cover

Product decisions, clinical safety judgement, legal and data-protection
sign-off, and the launch checklist in `docs/runbook-supabase-project-creation.md`.
None of those are engineering gates and none can be discharged by CI.
