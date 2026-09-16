# Sprint Kickoff — Migration 017, the snapshot schedule
Date: 2026-09-16 | Prepared by: Cowork sprint-push
Base: `main` at `af36ba1`. Hosted holds 001-016. Nothing open.

**File location note.** Written in `cowork-handoff/`, outside the repo, and moved
here with the 017 PR as the founder directed. The body below is the 386-line
version of 2026-09-16 (R-2026-09-16-13) with one change: the Bundle 2 line on
`packages/fixtures/leg-coverage.json` is struck, with its dated correction, as
R-2026-09-16-11 directed. The R-2026-09-16-07 to -13 blocks in
`Sprint Kickoffs/decision-2026-09-14-public-private-split.md` record what the
Bundle 0 probes found and how this document's contradictions were corrected.

## Division of responsibilities

Claude Code implements, tests and ships the bundles below; Cowork has done the
scoping, the route ruling and the blast-radius pass and treats those as settled
inputs; the founder runs the hosted apply and holds anything touching a
credential or the dashboard.

## The route, ruled

**R-2026-09-16-07: pg_cron running as `postgres`, single head.** `cron.schedule`
runs as the scheduling role, `postgres` already owns `app.regenerate_snapshot()`
and holds `rolbypassrls t` hosted (R-2026-09-16-02), so **no grant is needed and
no new public surface is created**. Decision 3 stays closed. The two rejected
options and why are in "What was considered and rejected" below.

## Three findings that changed the shape — read before scoping anything

1. **There is no server, so half of v1:293 was never buildable.** `apps/public-dashboard`
   and `apps/ward-console` are both Vite static builds on Cloudflare Pages, and
   there is no `api` directory anywhere in the repository. `/api/sweep` and
   `/api/health` (v1:293-294) have no host. The external caller of the "dual
   scheduler" could only ever have targeted a server that does not exist or
   PostgREST — and PostgREST is the public wrapper, i.e. decision 3. **The caller
   route and the scheduler shape were always one decision, not two.**
2. **The keep-alive rationale is dead, and v1 contradicts itself about it.**
   v1:293 justifies the external caller because "Supabase pauses free projects
   after 7 days… its traffic doubles as the keep-alive". v1:396, in the same
   document, settles "Supabase Pro at $25/month accepted, which buys backups,
   **no pausing** and higher ceilings" — and the project was upgraded to Pro on
   2026-09-12. v1:363 then makes "is the Supabase project paused" the first
   diagnostic step of the sweep runbook, for a project that cannot pause.
   **The sensor argument survives untouched** — pg_cron cannot report its own
   death because it *is* the thing that stops — but detection does not require an
   HTTP endpoint. 016 already writes `app.system_heartbeat.last_snapshot_at` on
   every run; anything that reads that column is a sensor not sharing pg_cron's
   failure mode. Detection is **out of scope here** and belongs to the sprint that
   owns alerting; 017 must leave the heartbeat usable, which it already is.
3. **The cadence has never been ruled, and the obvious reading is wrong.**
   v1:293's "every 10 minutes" is the **alert sweep's** cadence, not the
   snapshot's. The snapshot's own cadence is stated once, at v1:65: regenerated
   **every 60 seconds**. Reading 293 as the snapshot's would put an up-to-10-minute
   stale board behind an `s-maxage=30` cache and defeat finding F3 — freshness is
   the product. **Cowork's call, logged not asked (reversible in a one-line
   migration): `* * * * *`, one minute** — the nearest cron expression to v1:65's
   sixty seconds. _Corrected 2026-09-16: this line previously called one minute
   "the pg_cron floor". That was a library-level assertion made without a probe,
   in the document whose first bundle exists because pg_cron cannot be reasoned
   from a sandbox. The cadence never rested on it and the claim is withdrawn._
   See Bundle 1 blast radius for the volume consequence.

## Bundles

### Bundle 0: the probe that decides the shape — FIRST MOVE, GATES EVERYTHING

**Why bundled together:** pg_cron semantics cannot be reasoned from a sandbox,
and everything below assumes answers nobody has observed. This is a STOP+PROBE,
not a code change: run it, report the answers, then write Bundle 1.

**Binding questions, answered against the local stack (`npm run db:start`), each
with the command and its raw output:**

- [ ] Does `create extension if not exists pg_cron;` succeed as `postgres` on the
      local Supabase image? pg_cron requires `shared_preload_libraries`; if it is
      not preloaded locally, **stop and report** — the whole of Bundle 2 changes
      from a local assertion to a hosted hand check, and that is a different sprint.
- [ ] What schema does it land in, and what is in `cron.job`'s column list?
- [ ] Can `postgres` call `cron.schedule(name, schedule, command)` and does the
      3-argument by-name form **upsert** on re-run, or does it create a duplicate?
      Migration idempotency depends on the answer, and **nothing existing would
      catch a duplicate** — `tests/db/migration_idempotency.test.ts` asserts
      re-application is a no-op against the SCHEMA, and a second `cron.job` row is
      DATA. That is why the duplicate check is Bundle 2's, not something already
      covered. _Corrected 2026-09-16 (R-2026-09-16-11): this question previously
      said migration_idempotency "will catch it either way". R-09 withdrew that
      claim in Bundle 2 and this line was left standing — the withdrawal and the
      claim sat 160 lines apart in one document — l.74 and l.234 before this fix.
      _Corrected again (R-2026-09-16-13): the note first said "eleven lines". A
      figure written without counting, in a note whose subject is a claim that was
      not checked._
- [ ] Does a scheduled job actually fire locally, and does `cron.job_run_details`
      exist on this pg_cron version? If runs are not recorded, Bundle 2 asserts
      the job's existence and configuration only, and says so rather than
      implying it asserts execution.
- [ ] With `row_security = off` added, does `app.refresh_lga_rollup()` RAISE for a
      non-bypass caller rather than silently affecting zero rows? Prove it the way
      016's leg does, not by reading the source.
- [ ] What role does `cron.job.username` show for a job scheduled by `postgres`?
      This is the route ruling's own premise and it should be observed, not assumed.

- [ ] **Does re-scheduling an existing job reset `active` to true?** Claude Code's
      question, and it is the one that would have bitten: `migration_idempotency`
      re-applies 017 MID-SUITE, so if re-scheduling un-pauses the jobs, the
      globalSetup pause is defeated for every test that runs after it — and the
      flake comes back somewhere new, having been "fixed". If it does reset, the
      pause is re-applied after any re-application, and whichever test re-applies
      owns restoring it.
- [ ] **Is `cron.schedule` transactional?** Schedule a job inside a transaction,
      roll back, and read `cron.job`. If the rollback leaves no trace, Bundle 2
      uses the rolled-back re-application design below; if it does not, Bundle 2
      falls back to pausing. This question decides Bundle 2's shape, so answer it
      before writing either.

**Definition of done:** **every question above**, each with its command and raw
output — stated as the list, not as a count, so adding a question cannot make this
line wrong. _Corrected 2026-09-16: this read "the five answers" while the list had
grown to six. A stated count disagreeing with its own list, in the sprint that
followed the sweep about stated counts disagreeing with their own lists._ Plus a
one-line statement of whether Bundle 2 is provable locally. No migration written
until this is reported.

### Bundle 1: migration 017 — the extension, the schedule, the down file

**Why bundled together:** one migration file, its down file and its header are a
single reviewable unit, and this project's convention is that a migration ships
with the test that makes it true (condition C) — so Bundle 2's assertions ride in
the same PR, not a later one.

**Tasks:**
- [ ] `database/migrations/017_snapshot_schedule.sql`, following 016's header
      conventions: what it does, what is deliberately out, and the ruling that
      decided each.
- [ ] `create extension if not exists pg_cron;` — guarded per Bundle 0's answer.
- [ ] Schedule `app.regenerate_snapshot()` at `* * * * *` under a stable job name
      (`openbed_regenerate_snapshot`), written so re-application is a no-op. If
      Bundle 0 shows the by-name form does not upsert, guard with an explicit
      unschedule-if-exists inside a `DO` block, the way 016's policy is guarded.
- [ ] **No GRANT.** The job runs as `postgres`, which owns the function. Record
      that in the header as the route ruling, with the reason: `service_role` has
      no USAGE on schema `app`, so a grant was never a route.
- [ ] **Schedule `app.refresh_lga_rollup()` as a second job** (`openbed_refresh_lga_rollup`),
      **`*/5 * * * *`** — Cowork's call, logged: a full DELETE-and-recompute of a
      published table is heavier than the snapshot and nothing reads it yet, so
      five minutes fixes "frozen at seed time" cheaply. Revisit when Stage 3 gives
      it a reader. **This closes v2's finding 1** (R-2026-09-16-08), open since
      2026-09-10. 016 declined to be its caller for a reason that does not apply
      here: calling it *from the generator* would make the generator a writer of a
      published surface inside the public read path, holding base-table locks in
      the snapshot transaction. A separate job is its own transaction, outside
      that path — which is what 016's header means by "any scheduled caller solves
      it, not this one".
- [ ] **REPAIR `app.refresh_lga_rollup()` IN 017, BEFORE SCHEDULING IT.** Giving a
      dormant function a caller activates whatever latent hazard it carries, and
      this one carries the fail-silent hazard the snapshot was protected from:
      009:63 is `SECURITY DEFINER` with `search_path = ''` and does
      `DELETE FROM public.lga_rollup` then recomputes, while `public.lga_rollup` is
      `ENABLE` + `FORCE ROW LEVEL SECURITY` (007:189,195) — and the function carries
      **no** `SET row_security = off`. **Observed 2026-09-16, in rolled-back
      transactions against the local database, not asserted:** with a non-bypass
      owner and any cell publishing, the INSERT is refused loudly — but where the
      recompute should make a cell VANISH below the k-floor, the function returns 0
      silently and **the cell stays published with its exact bed count**. That is
      not a stale aggregate; it is the disclosure the k-floor exists to prevent,
      persisting because the DELETE affected nothing. With the repair, the same case
      raises at the DELETE ("query would be affected by row-level security policy"),
      and the real path under `postgres` is unchanged. It works today only because
      `postgres` bypasses, which is precisely the attribute R-2026-09-15-07 refused
      to depend on. _Corrected 2026-09-16: this bundle previously said "deletes
      nothing, inserts nothing, and nothing errors". Half right, and the half it
      missed is the worse one._ **009 is frozen**, so the repair is a `CREATE OR REPLACE` in 017 — new
      authoring in a new file, not an edit to applied history. Mirror 016:217 and
      carry the reasoning in 017's header.
- [ ] `database/migrations/017_snapshot_schedule.down.sql` — unschedule **both** jobs
      by name,
      and state whether it drops the extension (recommend: no; dropping a cluster
      extension on the way down is a wider blast radius than the migration's own).
      All sixteen forward migrations have a down file; this keeps that unbroken.
- [ ] Self-ledger `INSERT INTO app.schema_migrations` as every migration does.
- [ ] **`cron` must NOT be added to `[api] schemas`.** `tests/db/config_drift.test.ts`
      already asserts the exposed-schema list; leave that control to do its job and
      do not touch the list.

**Specialist input incorporated:** cto-persona and platform-sre, consulted inline.
The single-head shape is the platform-sre call: one scheduler with a heartbeat a
later sensor reads beats two schedulers where the second needs infrastructure that
does not exist. The CTO point is the grant — the schema wall makes `service_role`
a non-route regardless of its BYPASSRLS, so the owner-runs-it shape is the only one
that adds no surface. No CLCO review: no PHI reaches this path, the snapshot is
already-published mirror data, and the exposed-schema list is unchanged.

**Safety/quality notes:** retention needs no second job — `app.snapshot_retention()`
returns 24h and `app.regenerate_snapshot()` prunes against it, so scheduling the
generator schedules retention. State that in the header so nobody adds a second
cron entry for it later.

**Blast radius — verified, not assumed:**
- **A new `cron` schema appears in the database.** Every catalogue test was checked
  for dynamic schema enumeration: `rls_enabled_everywhere` (`nspname = 'public'`,
  `table_schema = 'app'`), `timestamps_are_timestamptz` (`in ('app','public')`),
  `append_only_enforcement`, `rpc_definer_safety` (`nspname = 'public'`),
  `read_rpc_caps` and `rls_anon_*` are **all pinned to `app` and `public`**. None
  sees `cron`. Confirmed at `af36ba1`; re-confirm if any of them is generalised.
- **Cadence volume.** At one minute with 24-hour retention, `public.snapshot_current`
  plateaus at ~1440 rows. Measure the real payload size during the build and state
  the resulting steady-state size in the PR; if it is material, the cadence is a
  one-line change and this is the moment to say so, not after the hosted apply.
- **`app.regenerate_snapshot()` is unchanged.** 016 is frozen
  (`database/migrations/applied-hosted.json`) and the guard on `main` will red on
  any edit to it. Everything 017 needs is additive.

**Definition of done:** fresh-database run green with the predicted total stated
*before* the run; `migration_idempotency` green (017 re-applies as a no-op);
commit gate and CI green; the down file exercised.

### Bundle 2: condition F's analogue

**Why bundled together:** it ships in Bundle 1's PR. 016's header commits to it
explicitly — "The schedule: 017, with condition F's analogue asserting the job
exists, is active and is on schedule. F can only assert a mechanism that exists."

**Tasks:**
- [ ] `tests/db/snapshot_schedule_state.test.ts`, modelled on
      `tests/db/projection_trigger_state.test.ts`, which is condition F itself.
- [ ] **BOTH mechanisms, because there are TWO problems and each fixes only one**
      (R-2026-09-16-10). _Corrected 2026-09-16: R-09 offered the rolled-back
      re-application as the preferred single answer with pausing as a fallback.
      That was wrong. The observed 2-in-83 flake was in `migration_idempotency`,
      caused by the live snapshot job writing `app.system_heartbeat` inside that
      test's before/after digest. A rolled-back transaction in condition F does
      nothing about it — the suite still flakes, and Standard O blocks that
      whichever test it lands in._
      - **Suite isolation — the db project's globalSetup**
        (`tests/setup/global-setup.ts`) pauses BOTH jobs with
        `cron.alter_job(active := false)`. This is what keeps
        `migration_idempotency` clear, and it is not optional.
      - **Condition F's own assertion — the rolled-back re-application**, if
        Bundle 0 Q7 says `cron.schedule` is transactional. F reads
        `active`/`schedule`/`command`/`username` **from its own re-application,
        never from the live rows**, and gets the duplicate check in the same
        mechanism. If Q7 says no, F re-applies in its own test and asserts that
        committed state, then restores the paused state itself.
      - **F never reads the ambient rows' `active` flag**, so no marker is needed
        anywhere and the instrument-swap hazard does not arise.
      - **What this does NOT prove:** that the jobs are active on hosted. The local
        suite asserts what the migration produces; the hosted jobs are confirmed at
        the apply, in the runbook. Say so in the test header so nobody later reads
        a green suite as a live-schedule guarantee.
- [ ] **Catch a duplicate job.** `migration_idempotency` would NOT catch one, and
      the claim that it would — **in Bundle 0's third question**, cited by name
      rather than by line — is withdrawn: it asserts re-application is a
      no-op against the schema, and a second `cron.job` row is data, not schema.
      Re-apply 017 in the same test and assert **exactly one row per job name**,
      with a plant that inserts a duplicate and proves the assertion reds.
- [ ] **Two jobs, asserted separately** — `openbed_regenerate_snapshot` and
      `openbed_refresh_lga_rollup`. Parametrise over the pair; do not assert one
      and assume the other.
- [ ] **A leg for the repair:** `app.refresh_lga_rollup()` carries
      `row_security = off` and RAISES for a non-bypass caller, with the plant that
      proves it — the same shape as 016's. Without this the repair is a source
      edit nobody checked.
- [ ] Assert **exactly**, per job: the job exists; `active` true; the schedule string
      equal to what 017 sets; the command equal to what 017 sets; `username` equal
      to the role Bundle 0 observed. Exact equality, not "contains".
- [ ] **Plants, each proving the assertion reds:** the job unscheduled; the job
      present but `active` false; the schedule string altered. A guard with no
      demonstrated failure case is the shape this repository keeps catching.
- [ ] Confirm the plant landed before trusting any plant — the step that caught
      the `004_ward_status.sql` misnaming in #29.
- [ ] ~~Register the new legs in `packages/fixtures/leg-coverage.json` and state the
      totals move in the PR body.~~ _Corrected 2026-09-16 (R-2026-09-16-11): that
      register covers guard scripts in `scripts/` only; this change adds none, and
      the register correctly does not move._

**Specialist input incorporated:** qa-specialist, inline. The assertion set is
existence + active + schedule + command + username because each is a distinct way
the job can be present and not reaching: unscheduled, scheduled-but-off,
scheduled-wrong, and scheduled-as-the-wrong-role. Dropping any one leaves a
Clause 5 hole.

**Blast radius:** NOT n/a. _Corrected 2026-09-16 (R-2026-09-16-11): this read
"n/a — new test file", written before R-09 and R-10 added the pause. It was wrong
by the time those landed._ This bundle now reaches:
- `tests/setup/global-setup.ts` — the db run's pause, and the loud failure if it
  cannot pause;
- the e2e run's pause and `scripts/seed.sh`, which is where the window from
  migration to end-of-run is actually closed;
- `tests/e2e/golden-path.test.ts` step 9, whose comment changes to say its subject
  is its OWN call;
- `tests/db/migration_idempotency.test.ts` — unchanged in text, but its freedom
  from the live jobs now depends on the pause holding. That dependency is the
  thing to re-check if the pause ever moves;
- `database/local/pause_scheduled_jobs.sql`, `tests/setup/db.ts` and
  `tests/db/scheduled_jobs_paused.test.ts` — the pause itself, its checker, and the
  leg that proves it. _Added by R-2026-09-16-13: the first correction of this blast
  radius still left out the three files the pause is actually made of. Nothing it
  said was wrong; it was incomplete, which is the failure mode a blast radius
  exists to prevent._

**A note on citations in this document.** Two of the corrections above originally
cited line numbers. A line number inside a document that edits itself is stale as
soon as anything above it moves — which is what correcting this document did. Cite
the section or the question by NAME.

**Definition of done:** **every plant in the task list above** demonstrated red,
each one named with its result, and the real repository green, with the
plant-landed confirmation shown. _Corrected 2026-09-16 (R-2026-09-16-11): this
said "all three plants" while the list had grown well past three. Second stated
count in this document to disagree with its own list — see Bundle 0's done-line.
Both are now expressed as the list. A count written beside a list that is still
being edited is a defect waiting for the next edit, and this document produced two
of them in one sitting._

### Bundle 3: the records — and the carry obligation this PR discharges

**Why bundled together:** all documentation, all in the same PR, and one of them
is owed.

**Tasks:**
- [ ] **Discharge the carry obligation.** The resume memory holds a watch line
      owed to the `R-2026-09-16-04` block in
      `Sprint Kickoffs/decision-2026-09-14-public-private-split.md`, to be added by
      the next PR that touches the repository. **This is that PR.** The line: the
      first exercise of `scripts/freeze_applied_migrations.mjs` in anger is 017's
      own hosted apply, via the runbook step that regenerates
      `applied-hosted.json`; every refusal has a plant but the path has never been
      walked end to end.
- [ ] **017 falsifies three of the sweep's own entries. Update them in this PR:**
      `sweep-2026-09-15-v2-enumeration.md` item **#3** (v2:46, "no trigger, no
      `pg_cron` entry, no scheduled job"); the v2 sweep section's VERIFIED line
      "finding 1 … still has no production caller, and finding 1 stays OPEN"; and
      finding 1's own "→ Stage 3" routing at v2:46. Each gets a dated marker, not a
      rewrite. Restate the verdict counts if any item changes class, the way
      R-2026-09-16-03 required — and state the unit, since that is the row the
      whole sweep argument turned on.
- [ ] Record R-2026-09-16-08: finding 1 closed by 017's second job, with 016's
      reason for declining and why a separate job is not the same thing — **and the
      repair's real justification as observed**: the silent path is narrow but it
      leaks a below-floor cell at its exact bed count, which is the k-floor's whole
      subject. Cite the probe, not the kickoff's first wording.
- [ ] Record R-2026-09-16-07 (the route) as a ruling block, with the three findings
      above — particularly that the dual scheduler's external half was never
      buildable on a static host, and that v1:293 and v1:396 contradict each other
      about pausing.
- [ ] **Sweep v1's stale premises.** v1:293's keep-alive rationale, v1:363's
      "is the project paused" first diagnostic step, and v1:65-vs-293's cadence
      disagreement. Mark them in place with dated `[SWEEP 2026-09-16: …]` markers,
      following the live-rule/dated-record discriminator (method note 8): v1 is a
      **planning document with live rules in it**, so its rules are amended and its
      historical statements are annotated, never rewritten.
- [ ] Restate runbook step 5's dry-run expectation for a project at 016: **one**
      `WOULD APPLY` line, `017_snapshot_schedule.sql`, and `1 migration(s) pending.`
- [ ] Add the hosted-apply note for 017: whether `pg_cron` needs enabling from the
      Supabase dashboard before the migration can create it. **Founder-side if so.**

**Safety/quality notes:** the v1 sweep is scoped to premises 017 depends on. A full
v1 enumeration on the model of `sweep-2026-09-15-v2-enumeration.md` is worth doing
and is **not** in this sprint — see Open decisions.

**Definition of done:** the carry obligation is discharged and the resume memory
updated to say so; the three v1 markers are in place; step 5 reads correctly for a
project at 016.

## What was considered and rejected

- **Direct owner connection.** Needs a host and a stored production credential.
  There is no server, so in practice it is a GitHub Action — which v1:293 already
  ruled out (10-30 minutes late, dropped under load, auto-disabled after 60 days).
  A new credential for a problem pg_cron solves without one.
- **Public wrapper with EXECUTE for `service_role`.** The only shape that makes an
  external HTTP caller possible without building a server, and the reason it loses:
  it reopens decision 3, closed on 2026-09-15 on prevention-over-detection grounds,
  and puts a generator trigger on the public API surface.

## Open decisions — all three ruled 2026-09-16

1. **`refresh_lga_rollup()` scheduled in 017 — YES** (R-2026-09-16-08). Folded into
   Bundles 1 and 2 above, together with the repair that giving it a caller makes
   necessary. The reasoning that won: a Clause 5 defect kept open because its fix
   would be premature is the "not needed yet" deferral in costume, and the cost is
   one cron entry.
2. **A full v1 sweep — YES, its own pass, after 017 lands.** Not in this sprint.
   The pre-017 sweep enumerated 96 claims from **v2 only**; v1 has never been
   swept, carries 017's design rationale, and gave up three stale premises to a
   glance while this sprint was scoped. On the
   `sweep-2026-09-15-v2-enumeration.md` model, targeting the tense and applying
   method note 8's live-rule / dated-record discriminator. **Queue it; do not
   start it inside 017's PR** — mixing a sweep into a migration PR is how a
   migration review becomes a documentation review.
3. **pg_cron on hosted — founder-side, gated on Bundle 0.** If the extension needs
   dashboard enablement it happens before the hosted apply, and the runbook says so.

## Supporting docs

None. Every specialist input fitted inline; manufacturing thin standalone files
for it would bury the parts Claude Code actually needs.
