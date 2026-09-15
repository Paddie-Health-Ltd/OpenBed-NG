# Handoff — OpenBed-NG: #23 and #24 ruled, 016 scoped — 2026-09-15
Prepared by: Cowork handoff

**File location note.** This sits in `cowork-handoff/`, outside the repo, like its
predecessor. The previous handoff was routed into `docs/` by PR #24. This one
should ride into `docs/` with the 016 PR so the chain stays in one place.

**Moved 2026-09-15, after 016 merged (#25), in the follow-up change ruled by
R-2026-09-15-06 and -07.** Everything below this note is byte-identical to the
file as written; it records the moment before 016 was built. Superseded or closed
since, each recorded in
`Sprint Kickoffs/decision-2026-09-14-public-private-split.md`:
- **The PIPESTATUS mechanism below is the one corrected in #24.** zsh does not set
  `PIPESTATUS` at all, so it is empty at any index; 1-indexing is a second trap, on
  `pipestatus`.
- **"Writing an empty snapshot the edge would serve"** was narrowed while 016 was
  built: as built, a non-bypass generator's INSERT is refused too.
- **The four items under "To verify next session" are closed:**
  - #23 merged;
  - the N10/N15 classification is in #24's body;
  - `app.system_heartbeat` has no RLS;
  - the memo staleness was fixed in #25.
- **Decision (3)'s "zero policies"** became exactly one policy, SELECT TO
  `service_role`, in 016's amendment. The reader is still `service_role` only, by
  grant.

---

## Division of responsibilities

Claude Code implements, tests and ships — it has PR #24 open and awaiting merge,
and 016 scoped but not started; Cowork has reviewed #23 and #24, ruled the five
016 scope decisions plus two mechanism questions, and will resume review when
016's pasteback arrives; the founder runs anything touching the hosted project,
the dashboard, or a credential.

---

## Where things stand

### Migrations 014 and 015 — PR #23

Reviewed and **approved to merge** at `a6f58c6`, on CI evidence: 7/7 required
checks, 610 tests split 382 compliance / 228 db, matching the local
fresh-database total. The load-bearing point is that **CI is the evidence, not
the local run** — GitHub Actions does not use the founder's zsh, and every local
verification failure in this project has come from that shell.

Conditions A–I all held before #23 opened. Notable outcomes: the refusal of an
unknown enum value derives from the cast failing rather than a duplicated value
list; `anon` holds no EXECUTE on either RPC, so the body never runs; the catalogue
test carries no exception list; `replayed` was added because `version` cannot
distinguish a replay.

**#23's merge is not confirmed in any pasteback this session.** PR #24 exists and
carries the before-016 work, which implies #23 merged — that is inference, not
observation. Verify first thing next session.

### Before-016 work — PR #24

Open and unmerged at `c618b8f` as of the last report. **Approved to merge.**
7/7 checks, 663 tests (435 compliance + 228 db), matching the local total. The
prediction, generated from the previous run's artefact before anything ran, also
said 663 — condition I now works as designed, with only the deltas composed.

Contains: the shell pin, verification instruments tracked in `scripts/` under
Standard P, condition I baselines read from artefacts, the previous handoff moved
into `docs/`, the runbook step 5 post-apply probe, and the new method-note rules.

**Unreported:** the N10/N15 classification. The three tests that over-fired were
to be named and each classified as genuinely covering its refusal or as
collateral. Collateral would mean entanglement, which makes every future neuter
noisier. Ask for it; it does not hold up the merge.

### The finding that shaped this session

**PIPESTATUS was the fifth false verification result from one cause.** The
mechanism is exact: zsh arrays are 1-indexed and zsh's array is `$pipestatus`, so
`${PIPESTATUS[0]}` is empty rather than wrong.

Five incidents, one cause — `#`-in-fences breaking 33 runbook blocks, grep
returning zero matches for `$`/`{`/`?`, two file paths passed as one argument,
PIPESTATUS at N13, PIPESTATUS again. Each had been patched individually; nothing
had touched the shell. The fix in #24 is `#!/usr/bin/env bash` with
`set -euo pipefail`, invoked directly, with **no exception list** — the three
aggregating runners (`gate.sh`, `commit.sh`, `lint_migrations_all.sh`) capture
each check's status explicitly rather than being exempted. Without `-e` an
aggregating runner catches only the failures it counts; a typo or a failed `cd`
between checks passes invisibly.

### Migration 016 — SCOPED, NOT STARTED

Nothing exists. `snapshot_current`, `regenerate_snapshot` and `last_snapshot_at`
appear only in 014's header, `tests/e2e/golden-path.test.ts`, `frontier.json` and
planning docs. Claude Code produced a researched scope proposal with no code and
verified its two load-bearing claims itself.

The five decisions and two mechanism questions are ruled below. **016 is ruled
but unbuilt; the next pasteback is its first review.**

---

## What's next — in order

1. **Confirm #23 merged, then merge #24.** First because everything else stacks
   on it, and because building 016 on an unmerged #24 invites branch drift. Get
   the N10/N15 classification in the same breath.
2. **Build 016 to the ruled scope.** The table, generator and heartbeat column
   only. The rulings are in `R-2026-09-15-04` and `-05`, both recorded in the
   decision memo.
3. **The pre-017 kickoff sweep.** Every "already exists" / "already stood up"
   assertion in the v2 kickoff, marked verified or superseded. Five have now
   failed against the repo; see Open items.
4. **017 — pg_cron, the schedule, and condition F's analogue** asserting the job
   exists, is active and is on schedule. Its unresolved design question is in
   Open items.
5. **Tick reconciliation**, then the **`scripts/` survey**.

---

## The 016 rulings — carry the reasoning, not just the outcome

**The constraint was restated, and this is the version that matters.** "Derives
from `ward_public`, never the base tables" was pitched at the wrong level.
`lga_rollup` is a published surface with its own control — the k-floor and the
0.40 dominance rule — so reading it would never have been an ungated route. The
real defect in v2:280 is that `refresh_lga_rollup()` makes the generator a
**writer of a published surface** inside the public read path, with base-table
locks in the snapshot transaction. 008:176-177 already states the principle:
`project_facility` is "the single writer of `public.facility_public` and
`public.ward_public`."

> The generator **reads** only published surfaces. The generator **writes** only
> `snapshot_current` and the heartbeat.

**(1) Rollup — out of 016.** No refresh call, no payload key; its own ruling at
Stage 3. v2:225 already defers the payload key, and the fixture envelope has no
rollup key, so the refresh would compute something nothing reads. v2:280's reason
— finding 1, the orphan needs a caller — is real and does not imply its
instruction: any scheduled caller solves it.

**(2) Scheduler — split.** 016 is the table, generator and heartbeat column; 017
is the extension, the schedule and the job assertion. Different blast radius,
independent down-paths, and condition F can only assert a mechanism that exists.

**(3) Reader — `service_role` only, not anon-readable.** Decided by a line already
in the record: v1:258, the mirrors are "defence-in-depth rather than the serving
path." The serving path is the static file at the edge, so an anon-readable
`snapshot_current` is a **second serving path bypassing the CDN** — the exact load
the snapshot exists to prevent, with no `s-maxage`, so the two paths can disagree
on freshness and the dead-generator signal differs by which one you read. "No
wider than anon can already read" is true by construction only, and R2:310 says
nothing guards that construction until 016's test lands. RLS enabled and FORCEd,
zero policies, revoked from PUBLIC/anon/authenticated, SELECT to `service_role`.

Consequence: `config_drift:146` and `rls_enabled_everywhere:27,37` enumerate all
public tables and change either way. `rls_anon_column_containment:195` and
`rls_anon_writes_rejected:56` count anon's grants and policies — under
service_role-only they stay at 3 and need no change, which preserves what they
assert rather than diluting it.

**(4) Retention — append, bounded, pruned in the insert's own transaction.** Not
for the reason first offered: "v stopped incrementing" works with a single updated
row too. It carries because this system's signature failure is a silent stop — the
heartbeat says it is stale *now*, history says *when it stopped and for how long*,
which is what v2:223's write-up needs. Pruning inside the generator's transaction
avoids creating a second orphan function needing a caller.

**(5) `v` — bigint from a sequence.** Stronger than "a hash doesn't increment": a
content hash is *identical across two runs when nothing changed*, so "v hasn't
moved in 60s" becomes ambiguous — dead generator, or a quiet night? Bed
availability has quiet nights, and quiet is when Supabase's pause behaviour bites
(004:299-300). From the sequence, not `max(v)+1`. Carry 005's recorded note: a gap
in the sequence is expected and is **not** evidence of a missing snapshot.

**(6) The RLS control — `SET row_security = off`, as a function attribute.**
Cowork's proposed count-equality check was **null** under the hazard it targeted:
if the role cannot bypass RLS, the payload read and the count read both return
zero and the check passes exactly when the system is broken. Claude Code caught it
and proposed better — and the replacement is not a test at all. With
`row_security = off`, Postgres raises rather than applying a policy, so a
non-bypass role fails at the read instead of writing an empty snapshot the edge
would serve for 300 seconds. It also beats a `rolbypassrls`/`rolsuper` assertion,
which checks a proxy and would fail a generator that a later legitimate policy
made work.

Required: the plant — run the generator as a non-bypass owner and prove it raises.
Count-equality stays, re-aimed at rows dropped between read and encode, with its
own plant. Pairing worth keeping: `row_security = off` catches the generator
losing its bypass; `rls_enabled_everywhere.test.ts` catches RLS being dropped from
a mirror.

**(7) EXECUTE — owner only; 017 grants the caller.** `service_role` has no USAGE
on schema `app` (observed locally, and hosted on 2026-09-13), so v2:217's grant
could never be exercised. A grant nobody can use is a capability claim the schema
makes and cannot honour — the same defect M1 rejected at 014, where an enum
parameter meant no client could call the function.

**The test that matters most.** R2:310 says "what guards the snapshot's columns
today: nothing." The generated-payload column test is that guard, and it has a
tautology risk — a fixture and a generator written from the same list in the same
hour agree regardless. It needs a plant: add a column to the generator's selection
and prove the test goes red. With it the chain closes: 007 → fixture (existing
compliance test) → generated payload (new).

---

## Method rules added this session

All four are recorded in the decision memo's method notes.

- **Ruling ids.** Every Cowork ruling block carries `R-YYYY-MM-DD-nn` on its first
  line, and Claude Code states the id it received before acting. Added because a
  stale block was pasted and was indistinguishable from a repeat, costing a full
  round trip — a silent transport failure, the same class as the zsh findings.
- **Observed or inferred.** Every load-bearing claim in a Cowork ruling is tagged.
  Added because Cowork stated a Postgres default (functions grant EXECUTE to
  PUBLIC) as an observed fact about this database without checking it was still in
  force. It wasn't.
- **Proposed, not verified.** Any instruction naming a command, SHA, PR or
  runnable check is checked for feasibility before execution.
- **Cowork rules the property; Claude Code proposes the mechanism.** Every Cowork
  ruling that held stated a property that must be true. Every one that failed
  specified *how*. Ruling (b) at 014 held because it ruled the contract and left
  the derivation open; the count-equality control, the session-200 probe and the
  handoff-into-#23 instruction each failed because they reached past the property
  into the mechanism.

---

## Fundamental — carries forward

> **Any failure must be foundationally resolved.** Fix the root cause, not the
> symptom. Before calling a fix done, understand everything it touches or could
> touch — other bundles, shared modules, downstream consumers — so the fix doesn't
> quietly create a new problem elsewhere. Resolve issues in the same pass, in
> place — don't file a ticket for something that can be fixed now.

Named exceptions this session, all in Open items: the remainder of step 9 (vendor
rate limit), the `scripts/` survey's three specified-not-built lints, and finding
1's orphan caller (deferred to Stage 3 by v2:225, not by neglect).

---

## Canonical docs

- `Sprint Kickoffs/decision-2026-09-14-public-private-split.md` — D1–D6, R1–R3,
  O1–O3, M1–M3, conditions A–I, the method notes, and provenance (i)–(vi). The
  single home for the public/private split and every premise correction. Read
  before revisiting any decision.
- `Sprint Kickoffs/sprint-kickoff-bedspace-v2-2026-09-10.md` — the live sprint
  scope. **Treat its Stage-1 "already exists" claims as unverified**; five have now
  failed. Lines that matter for 016: :217 (generator), :218 (v), :221–223
  (`/api/health`, the runbook, the unschedule drill), :225 (rollup deferred to
  Stage 3), :231 (generator not under `apps/`), :280 (rollup inside the generator —
  superseded), :305 (rollup tests keep calling directly).
- `Sprint Kickoffs/sprint-kickoff-bedspace-v1-2026-09-08.md` — where the snapshot
  architecture, the Cloudflare Pages decision (A2) and the cache headers were
  reasoned. :258 is load-bearing for decision (3). Note :65 says 60/600 and :235
  says 30/300; R2 records that 30/300 wins.
- `docs/runbook-supabase-project-creation.md` — the hosted runbook, steps 0–11,
  now carrying the step 5 post-apply probe. Read step 9 before touching anything
  auth-related.
- `.claude/rules/test-conventions.md` — house rules. §8 is the premise rule;
  Standard P now governs the tracked verification instruments.
- `database/migrations/007_public_projection_tables.sql` — the three mirrors,
  their RLS, policies and grants. :59-60 and :146-152 are why the rollup cannot
  come from `ward_public`.
- `database/migrations/008_projection_triggers.sql` — `project_facility`, the
  single writer of the two mirrors. :176-177 is the principle behind the restated
  016 constraint.
- `database/migrations/009_lga_rollup_kfloor.sql` — `refresh_lga_rollup()`, the
  k-floor rule, and the header confirming it has no scheduled caller.
- `packages/fixtures/snapshot-shape.json` and
  `tests/compliance/snapshot_shape_matches_migration.test.ts` — the first two
  links of the column chain 016 must close.
- `docs/handoff-2026-09-14-runbook-close-and-014.md` — the prior link, moved into
  `docs/` by #24.
- `docs/runbook-key-rotation.md`, `docs/facility-agreement-clause-x-access-addresses.md`
  — cited by step 11 and by O3 respectively.

---

## Open items / blockers

**Founder-side**

- **Step 9's remaining two legs** — magiclink single use, and real-time expiry.
  Blocked by Supabase's built-in email sender (429 on the fourth send). Closes in
  ~5 minutes once custom SMTP exists. **The expiry restore must come last** —
  expiry is evaluated against the setting in force at verify time.
- **Custom SMTP + the NDPA s.29 processor agreement** — one item, and a
  prerequisite for facility one.
- **Cloudflare** — s.29 written processor agreement and s.41 transfer basis.
- **Auth Site URL** is still `http://localhost:3000`. Becomes
  `https://app.openbed.ng` when the app exists.
- **Step 11's rotation-runbook tick** — the founder's attestation.
- Not blocking: NDPC registration threshold, the public privacy notice (s.34),
  the PITR decision before facility one, the "OpenBed" registrability opinion.

**Undecided, needed before the work they gate**

- **B1 / O3 — the facility's contractual agreement to publish live capacity.**
  Blocks facility-one onboarding. Not the merge, and not the hosted apply.
- **O1 — the dispatch tier** (LASAMBUS). An org-level credential preserves the
  ward-level identity lock; individual dispatcher accounts reopen it.
- **O2 — the granularity floor.** Not adopted; ship as built. Revisit trigger is a
  condition: the first facility publishing a ward with `offering = 'OFFERED'` and
  `bed_count <= 2`. 014's floor test showed adopting one later is a value change,
  not a signature change.
- **`noindex`** — the founder's "static shell indexable" ruling reverses v1:250 and
  v2:273, made without knowing those existed. `noindex` stands until he rules.
  Cowork's suggestion on the table: index only routes structurally incapable of
  carrying a count, which is a rule about routes and therefore checkable.
- **017's caller route.** The schema wall means granting `service_role` EXECUTE on
  `app.regenerate_snapshot` is not a route at all. The real options are pg_cron
  running as postgres (no grant needed), a direct connection as the owner, or a
  `public` wrapper with EXECUTE for `service_role` — and that last one reopens the
  public-surface question decision (3) just closed. Face it deliberately in 017.
- **Finding 1 — `refresh_lga_rollup()` has no caller.** Deferred to Stage 3 with
  the rollup payload key, not fixed by folding it into the generator.

**To verify next session**

- **#23's merge.** Approved; not confirmed in any pasteback. PR #24's existence
  implies it. Inference, not observation.
- **The N10/N15 classification.** Three tests over-fired on the 014 neuters; each
  needs classifying as genuinely covering its refusal or as collateral.
- **RLS status on `app.system_heartbeat`.** Claude Code flagged it unchecked, and
  `row_security = off` puts it in the loud path.
- **Decision-memo staleness**, to be fixed in the 016 PR: :313-314 still names the
  old frontier (it is now `ward-republishes`), the v2:215 citation should be :217,
  R2:289-291 restates the dead `service_role` grant, and 003:98-101 and :129-132
  say `app.lga_rollup` where the table is `public.lga_rollup`.

**Method note worth keeping**

Cowork's error rate this session sits entirely on the mechanism side. Every
property-level ruling held; the count-equality control, the session-200 probe and
the handoff-into-#23 instruction all failed, and Claude Code caught each one
before it reached code. That is the review loop working, not a delay — and it is
why the property/mechanism rule now exists.
