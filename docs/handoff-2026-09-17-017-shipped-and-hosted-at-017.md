# Handoff — OpenBed-NG: 017 shipped, hosted at 001–017, nothing open — 2026-09-17
Prepared by: Cowork handoff

**File location note.** This sits in `cowork-handoff/`, outside the repo, like its
three predecessors. **It should ride into `docs/` with the next PR that touches the
repository**, whichever that is — not held for a particular sprint. Its predecessor,
`docs/handoff-2026-09-15-rulings-06-to-09-and-hosted-rows.md`, rode in with #28.

---

## Division of responsibilities

Claude Code implements, tests and ships — it has **nothing in flight**; Cowork
scoped 017, ruled R-2026-09-16-07 through R-2026-09-17-02, and reviewed every PR
head; the founder runs the hosted applies and holds anything touching a credential
or the dashboard. Unchanged across the session.

---

## Where things stand

**`main` is `db528f8`** (parents `3d25b76` and `f450f5a`), working tree clean.
**Hosted holds 001–017.** The frozen boundary is at 17 and the
`frozen_migrations` test placeholder is `018_placeholder.sql`. **Nothing is open** —
no PR, no branch, no obligation.

Verified by Cowork on `main`, not taken as reported: `db528f8`'s two parents;
`applied-hosted.json` reading `observed 2026-09-17`, `ruling R-2026-09-17-01`,
`ledger_rows 17`, 17 entries ending `017_snapshot_schedule.sql`, with all seventeen
digests recomputed against the tree and no mismatches.

### Shipped this session — PRs #28 through #32

- **#28** — R-2026-09-15-09's follow-ups; the sweep's unit stated and recounted to
  70/5/9/5/7 over 96 claims; the 96-item enumeration moved out of a session
  transcript and into the repo; R-09's own ruling block written.
- **#29** — the hosted apply of 014–016 recorded; **the freeze rule became a
  criterion** — a migration is frozen once recorded in hosted's
  `app.schema_migrations` — with the boundary living in one file and a guard that
  survives the obvious way round it (contiguous prefix + ledger-count agreement,
  not a hash set alone).
- **#30** — the R-2026-09-16-04 ruling block.
- **#31** — **migration 017**: `pg_cron`, the snapshot schedule at `* * * * *`, the
  rollup schedule at `*/5 * * * *`, condition F's analogue (19 tests), the
  `app.refresh_lga_rollup()` repair, and the job pause covering migration-to-end-of-run.
  **Closed v2's finding 1**, open since 2026-09-10.
- **#32** — the hosted apply of 017 recorded; boundary regenerated at 17;
  placeholder moved to 018.

### The hosted apply of 017 — observed 2026-09-17, founder-run

pg_cron 1.6.4 available and preloaded (same version the local probes ran against);
one `WOULD APPLY`; ledger 17 and a second dry run clean; schema-cache probe PASS;
**three** functions owned by `postgres`; the reader policy unchanged and exact;
both jobs `active=true` as `postgres` with the schedules and commands 017 sets;
`refresh_lga_rollup` `proconfig` reading `search_path="",row_security=off` on
hosted; runs `refresh_lga_rollup succeeded 3` and `regenerate_snapshot succeeded 13`,
no failures. The 13:3 ratio is consistent with the two cadences over ~13 minutes.

### Three things worth carrying, because they are not obvious from the repo

- **The rollup repair was the real find.** Scheduling `app.refresh_lga_rollup()`
  looked like three lines. The function is `SECURITY DEFINER`, deletes and
  recomputes `public.lga_rollup`, and that table is `ENABLE` + `FORCE ROW LEVEL
  SECURITY` — and the function carried no `row_security = off`. Observed, not
  reasoned: with a non-bypass owner the INSERT is refused loudly whenever any cell
  publishes, **but where a cell should VANISH below the k-floor it stays published
  at its exact bed count**. That is the disclosure the floor exists to prevent.
  009 is frozen, so the repair is a `CREATE OR REPLACE` in 017.
- **The scheduler's external half was never buildable.** Both apps are Vite static
  builds on Cloudflare Pages and there is no `api` directory; `/api/sweep` and
  `/api/health` (v1:293-294) have no host. The caller route and the scheduler shape
  were always one decision. The keep-alive rationale also died with the Pro
  upgrade — and v1 contradicts itself about pausing, at :293 against :396.
- **The migration runner refused a count over a dead connection**, on a real hosted
  apply, when a trailing space in a pasted connection string made psql look for a
  database named `postgres `. A count over a failed connection is indistinguishable
  from one against a virgin database, and that count is the apply's stop condition.
  Step 5 now names the symptom.

---

## What's next — in order

Nothing is owed and nothing is in flight, so this is a priority ordering rather
than a dependency chain. **The founder picks up; Claude Code starts nothing until
a kickoff exists.**

1. **The full v1 sweep.** Ruled 2026-09-16 as its own pass, after 017. First
   because it is the largest known gap in the record: the pre-017 sweep enumerated
   96 claims from **v2 only**, v1 has never been swept, and it carries the design
   rationale for work still ahead. Three stale premises fell out of it incidentally
   while scoping 017 — :293's keep-alive, :363's "is the project paused" first
   diagnostic step, and the :65-vs-:293 cadence disagreement. Model it on
   `Sprint Kickoffs/sweep-2026-09-15-v2-enumeration.md`: target the present tense,
   apply method note 8's live-rule / dated-record discriminator, and state the unit.
2. **The `scripts/` survey.** Its target is now sharper than "does this run":
   *is the stated reason it works, or fails, the actual reason* (method note 7).
   Named candidates are in the decision record. A worked example to look for first:
   a counter or grep whose exclusion pattern overlaps its own subject — a diff
   line-counter excluding `^--` also excludes every removed markdown bullet and
   reports zero removed, which reads as "nothing was deleted".
3. **Tick reconciliation.**
4. **Facility-one onboarding**, which is founder-side and blocked on B1 and B2 —
   the facility's contractual agreement to publish live capacity, and custom SMTP
   with the NDPA s.29 processor agreement. Nothing in the repo moves these.

---

## Fundamental — carries forward

> **Any failure must be foundationally resolved.** Fix the root cause, not the
> symptom. Before calling a fix done, understand everything it touches or could
> touch — other bundles, shared modules, downstream consumers — so the fix doesn't
> quietly create a new problem elsewhere. Resolve issues in the same pass, in
> place — don't file a ticket for something that can be fixed now.

No named exceptions this session. Everything found was fixed in the pass that
found it, including the three e2e/seeding items that arrived as "reported, not
built" and the three self-contradictions in the 017 kickoff.

---

## Canonical docs

- `Sprint Kickoffs/decision-2026-09-14-public-private-split.md` — **the single home
  for every ruling**, now through R-2026-09-17-02, plus method notes 1–8. Read
  before revisiting any decision. Note 7 (an explanation carrying a decision is a
  premise too) and note 8 (a live rule is amended; a dated record is superseded)
  are the two that did the most work this session.
- `Sprint Kickoffs/sprint-kickoff-017-schedule-2026-09-16.md` — 017's kickoff, with
  every correction dated in place. Worth reading for the corrections as much as the
  plan: two stated counts that disagreed with their own lists, a blast radius that
  was incomplete rather than wrong, and a standing note to cite sections by name
  rather than line number inside a document that edits itself.
- `Sprint Kickoffs/sweep-2026-09-15-v2-enumeration.md` — the 96 enumerated claims
  with citations and verdicts. The model for item 1 above.
- `Sprint Kickoffs/sprint-kickoff-bedspace-v2-2026-09-10.md` — the live sprint
  scope, swept, with inline `[SWEEP …]` markers.
- `Sprint Kickoffs/sprint-kickoff-bedspace-v1-2026-09-08.md` — **NOT swept.** Holds
  the snapshot architecture, the Cloudflare Pages decision (A2), the cache headers
  (30/300 wins, R2) and the alerting design. Treat its present-tense claims as
  unverified until item 1 runs.
- `database/migrations/applied-hosted.json` — the frozen boundary. The one home for
  which migrations hosted has run; both live no-edit rules cite it rather than
  restating a range.
- `database/migrations/017_snapshot_schedule.sql` — its header is the primary record
  of the schedule's design, the route ruling and the rollup repair.
- `tests/compliance/frozen_migrations.test.ts` + `scripts/freeze_applied_migrations.mjs`
  — the guard and its recorder. **The recorder runs once per hosted apply, from
  runbook step 5**, and its first run in anger was 2026-09-17.
- `tests/db/snapshot_schedule_state.test.ts` — condition F's analogue, 19 tests.
  Asserts what 017 PRODUCES from a rolled-back re-application; the db run pauses
  both jobs, so **a green suite is not a live-schedule guarantee** — hosted is
  confirmed at the apply.
- `database/local/pause_scheduled_jobs.sql` — the pause, applied from `scripts/seed.sh`
  after its local-only host check. Local and CI only.
- `docs/runbook-supabase-project-creation.md` — the hosted runbook. Step 5 now
  carries the pg_cron pre-check, the connection-string note, the three-function
  owner read, the reader-policy read, the jobs-and-runs read, and the
  frozen-boundary recording with its template at 18.
- `.claude/rules/test-conventions.md` — house rules. §8's premise rule and the
  "a check that could not run must never report a verdict" rule both fired for real
  this session.
- `docs/handoff-2026-09-15-rulings-06-to-09-and-hosted-rows.md` — the prior link,
  and the chain back from there.

---

## Open items / blockers

**None owed by either side.** The three queued items above are unstarted by
decision, not by blockage.

**Founder-side, unchanged and not blocking the repo:** B1 the facility agreement;
B2 custom SMTP plus the NDPA s.29 processor agreement; Cloudflare's s.29 agreement
and s.41 transfer basis; step 9's two remaining legs (magiclink single use, real-time
expiry — the expiry restore must come LAST); Auth Site URL still `http://localhost:3000`;
step 11's rotation-runbook attestation; and the `noindex` ruling, where the founder's
"static shell indexable" reverses v1:250 and v2:273 and `noindex` stands until he rules.

**Still open by prior ruling:** O1 the dispatch tier (LASAMBUS org-level credential
vs individual accounts — individual accounts reopen the ward-level identity lock);
O2 the granularity floor, not adopted, with a conditional revisit trigger.

**Local environment:** a fresh-database run needs `psql` on PATH (Homebrew keg-only
`libpq`), a database connection variable, and the Docker daemon running. All three
have now produced a zero-test collection at least once; each failed loudly and was
correctly left uncounted. Three instances is a category, not bad luck.

**Method note worth keeping.** Cowork's error rate stayed on the mechanism side
again: every false premise this session was a claim about how something behaves,
asserted from reading rather than running, and each was falsified by Claude Code
executing it — step 9's supposed vacuity, the seeding collision's severity, "the
amended 017", and three stated counts. Every property-level and sequencing ruling
held. The loop works in the direction it was designed to work, and the cheapest
defence remains: run it before asserting it.
