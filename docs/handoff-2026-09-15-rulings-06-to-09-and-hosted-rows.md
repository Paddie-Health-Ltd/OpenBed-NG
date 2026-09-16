# Handoff — OpenBed-NG: rulings 06–09, three PRs merged, hosted rows observed — 2026-09-15
Prepared by: Cowork handoff

**File location note.** This sits in `cowork-handoff/`, outside the repo, like its two
predecessors. `docs/handoff-2026-09-15-016-scope-and-rulings.md` rode into `docs/` with
PR #26. **This one should ride into `docs/` with the 017 PR** so the chain stays in one
place.

**Moved 2026-09-15, into #28, not the 017 PR.** This follows founder ruling
R-2026-09-15-10: with its amendments #28 closes the R-09 cycle, and `main` should carry
the record before the hosted apply. Everything below this note is byte-identical to the
file as written. Superseded or corrected since, each recorded in
`Sprint Kickoffs/decision-2026-09-14-public-private-split.md` (R-2026-09-15-09 and -10):
- **F1–F3 "can ride in the 017 PR"** rode in #28 instead, with R-10's amendments.
- **The sweep's verdict split "68 / 5 / 9 / 5 / 9"** is now 70 VERIFIED / 5 failed /
  9 stale / 5 in-document / 7 not checkable, still 96. The unit is now stated: one
  enumerated claim, listed in `Sprint Kickoffs/sweep-2026-09-15-v2-enumeration.md`.
  - The instance-count items (v2:46 "sixth", v2:433 "Five") moved from not checkable to
    VERIFIED. Finding 6's two headers are in the family, which gives six families and
    nine instances, and "sixth" reconstructs.
- **"Four new failures beyond the five known"** mixes verdict classes:
  - two are failed: the referral guard's legs and the touch-trigger count;
  - finding 2 overtaken by 014 is stale;
  - 005:211's false comment is outside the 96, found in passing.
  - The five known were three failed claims and two superseded in the document.
- **"Six places found by grep, including 010's header"** is six places corrected, plus
  010 recorded and not edited.
- **The "proposed, not ruled" defect family** was judged coherent, restated for both
  directions, and accepted as method note 7 (R-10).
- **"Hosted still holds 001–013"** was true when written. The founder applied 014–016
  on 2026-09-16 (R-2026-09-16-02), so hosted now holds 001–016, and the "what's next"
  list's first item is done.

---

## Division of responsibilities

Claude Code implements, tests and ships — it has nothing in flight, three PRs merged and
017 not started; Cowork reviewed #25, #26 and #27, issued rulings R-2026-09-15-06 through
-09, and observed the hosted role rows; the founder runs the hosted apply, holds the
017 caller-route decision, and owns anything touching a credential or the dashboard.

---

## Where things stand

**All three PRs merged. `origin/main` is at `3a45e67`.** Migrations 001–016 exist in the
repo; **hosted still holds 001–013.**

### PR #25 — migration 016, the snapshot (merged, `ca79b5d`)

Approved at R-2026-09-15-06. The table, the generator and the heartbeat column; the
rollup and the schedule both out, as ruled. What made it approvable:

- **The payload column chain closes both ways.** `snapshot_shape_matches_migration.test.ts`
  pins 007 → fixture with its own parser plants; `snapshot.test.ts` pins fixture →
  generated payload *by value against the live mirror rows*, with an extra-column plant
  and a swapped-column plant. R2:310's "what guards the snapshot's columns today: nothing"
  is answered.
- **The loud-read control split honestly into two legs** — the write-policy plant showing
  the silent empty snapshot, and the as-built leg showing the error naming the wrong
  table. Claude Code's narrowing of the hazard was a real correction, not a softening.
- **The surface check reads the live function body** with three plants (rollup refresh,
  foreign published write, base-table read).
- N10/N15 classified: genuine coverage, no collateral, so future neuters stay loud.

_CI figures (438 + 246 = 684) are **as reported by Claude Code**; Cowork read the merged
code, not the CI run._

### PR #26 — the reader policy (merged, `9e77e9c`)

Cowork found at R-2026-09-15-06 that `snapshot_current` was FORCE RLS with zero policies,
so `service_role` read it **because it held BYPASSRLS, not because it held the grant** —
the same silent-zero failure the generator had just been protected from, relocated onto
the path that reaches the public. Claude Code then observed the hazard directly (a
non-bypass member of `service_role` reads rows=0; rows=1 with a policy; anon still
refused by the missing grant) and offered two mechanisms.

R-2026-09-15-07 ruled **the policy, not `ALTER ROLE ... row_security = off`** — prevention
over detection, because the reader has an alternative the generator did not — and
**amend 016 in a follow-up PR** rather than renumber, with four conditions. All four met,
two exceeded:

- **C1** the `pg_policies` guard, the header citing its probe, and a new policies
  component in the idempotency digest, with a plant that adds a *second* policy under a
  different name — the failure a careless "idempotent" rewrite actually produces;
- **C2** the ledger's blindness to the two versions of 016 recorded as a bounded
  acceptance, with its boundary and a void condition;
- **C3** the "zero policies" reasoning rewritten, not annotated, in all three places
  that carried it;
- **C4** the policy asserted exactly — name, cmd, permissive, roles, qual, with_check —
  with a non-bypass-member plant and a policy-dropped counter-control.

`rls_anon_writes_rejected` went 3 → 4 policies without dilution: exact names kept,
SELECT-only shape kept.

**Claude Code corrected Cowork here, with an observation.** R-2026-09-15-06 item (3) said
the count check "guards MATERIALIZED staying put". EXPLAIN shows otherwise: a CTE
referenced twice is materialised regardless, and `NOT MATERIALIZED` still reads under one
statement snapshot. The check guards a **source edit** and nothing else, and the header
and test name now say so.

### PR #27 — the pre-017 sweep and the hosted rows (merged, `2439938`)

Approved at R-2026-09-15-09. Better than the ruling asked for: **96 assertions enumerated
with citations**, verdicts split four ways (68 verified / 5 superseded-failed / 9
superseded-stale / 5 already superseded in-document / 9 not checkable from the repo).
Four new failures beyond the five known — the referral guard's "legs 1–4 execute today"
with none of its four files present, the touch-trigger count (five, not four), 005:211's
phantom RPC-layer validation, and finding 2 overtaken by 014.

The superuser claim was swept, not patched: six places found by grep, including 010's
header (applied, so recorded rather than edited) and a comment in 014 (**comment only**;
014 is unapplied hosted).

**The method note worth keeping, and worth promoting:** *a grep for "already" matched
mostly prose and missed the claims that had failed, because they were worded as plain
present-tense facts.* The sweep target is the present tense, not a phrase.

### The hosted role rows — observed by Cowork, read-only

| role | `rolsuper` | `rolbypassrls` |
|---|---|---|
| `postgres` | f | t |
| `service_role` | f | t |

Run on Supabase project `klrlpxysjsjpdkeqdhvl`, 2026-09-15, via the Supabase MCP. Claude
Code confirmed the ref against runbook step 1, v1:105 and the ward-level identity memo
before recording it. Both rows identical to local. Recorded at R-2026-09-15-08 as H1–H3:

- **H1** — the hosted hold is lifted. The generator's owner holds BYPASSRLS, so
  `row_security = off` will not raise hosted; 016 is not dead on arrival.
- **H2** — R-2026-09-15-06 item (2) closed on the attributes: 008's `project_facility`
  DELETEs do not silently remove nothing. **One half still rests on inference** —
  Cowork closed it on the role attribute alone, and Claude Code caught that a
  `SECURITY DEFINER` function runs as its *owner*, which has not been observed hosted.
  The runbook now carries the post-apply owner read that closes it.
- **H3** — `test-conventions.md` §4 closed. The original claim ("superuser locally, not
  hosted") was wrong in both directions.

**The reader policy stays, as defence in depth rather than a fix for a live fault.** The
hazard was never live hosted. The reasoning was never that the attribute was false; it
was that the read should not depend on an attribute Supabase manages and a platform
upgrade or restore can change.

---

## What's next — in order

1. **The hosted apply of 014–016 — founder, runbook step 5.** First because everything
   else stacks on it and because 017's schedule cannot be built against a hosted project
   that does not yet hold the generator. From the amended 016 on `main`, so C2's boundary
   holds. The sequence: dry run showing **three** `WOULD APPLY` lines → apply → ledger
   check at **16 rows** → reload and probe → **the new owner read**. Both functions
   owned by `postgres` closes H2's inferred half; any other owner, or fewer than two
   lines, stops and reports rather than being fixed by hand.
2. **The three R-2026-09-15-09 follow-ups** (F1–F3, in Open items). Small, and they can
   ride in the 017 PR rather than taking their own.
3. **017 — pg_cron, the schedule, and condition F's analogue** asserting the job exists,
   is active and is on schedule. Its caller route is still undecided; see Open items.
4. **Tick reconciliation**, then the **`scripts/` survey** — which now has a sharper
   target if the proposed method note holds (see Open items).

---

## Fundamental — carries forward

> **Any failure must be foundationally resolved.** Fix the root cause, not the symptom.
> Before calling a fix done, understand everything it touches or could touch — other
> bundles, shared modules, downstream consumers — so the fix doesn't quietly create a new
> problem elsewhere. Resolve issues in the same pass, in place — don't file a ticket for
> something that can be fixed now.

Named exceptions this session, all in Open items: finding 1's orphan caller (deferred to
Stage 3 by v2:225), the `scripts/` survey's specified-not-built lints, the remainder of
runbook step 9 (vendor rate limit), and the idempotency digest's uncovered grants and RLS
flags (disclosed in #26, on the survey list).

---

## Canonical docs

- `Sprint Kickoffs/decision-2026-09-14-public-private-split.md` — **the single home for
  every ruling.** D1–D6, R1–R3, O1–O3, M1–M3, conditions A–I, 016's seven rulings, the
  method notes, and now R-2026-09-15-06 through -09 including the hosted role rows table.
  Read before revisiting any decision.
- `Sprint Kickoffs/sprint-kickoff-bedspace-v2-2026-09-10.md` — the live sprint scope,
  **now swept**. Its "Pre-017 sweep — recorded 2026-09-15" section carries the verdict
  table and the enumeration; inline `[SWEEP 2026-09-15: …]` markers sit on superseded
  claims. Its present-tense existence claims are no longer unverified.
- `Sprint Kickoffs/sprint-kickoff-bedspace-v1-2026-09-08.md` — where the snapshot
  architecture, the Cloudflare Pages decision (A2) and the cache headers were reasoned.
  :258 is load-bearing for the reader decision. 30/300 wins over 60/600 (R2).
- `docs/runbook-supabase-project-creation.md` — the hosted runbook. **Step 5 now carries
  the post-apply owner read**; step 8's reason is corrected; the unautomatable table's
  "hosted superuser semantics" row is now "hosted role attributes", with the observed
  values.
- `database/migrations/016_snapshot.sql` — its header is the primary record of the
  snapshot's design: the two-clause constraint, the reader decision, the amendment note,
  and what `SNAPSHOT_ROWS_DROPPED` actually guards.
- `tests/db/snapshot.test.ts` — every 016 property with its plant. Read the file header
  before changing any assertion in it.
- `.claude/rules/test-conventions.md` — house rules. §8 is the premise rule; §4 is now
  closed; Standard P governs the tracked verification instruments.
- `database/migrations/007_public_projection_tables.sql` and `008_projection_triggers.sql`
  — the three mirrors and their single writer. 008:176-177 is the principle behind 016's
  constraint.
- `packages/fixtures/snapshot-shape.json` and
  `tests/compliance/snapshot_shape_matches_migration.test.ts` — the first two links of
  the column chain 016 closes.
- `docs/handoff-2026-09-15-016-scope-and-rulings.md` — the prior link, moved into `docs/`
  by #26. Carries 016's seven rulings in full.
- `docs/handoff-2026-09-14-runbook-close-and-014.md` — the link before that.
- `docs/runbook-key-rotation.md`, `docs/facility-agreement-clause-x-access-addresses.md`
  — cited by step 11 and by O3 respectively.

---

## Open items / blockers

**R-2026-09-15-09 follow-ups — Claude Code, small, can ride in the 017 PR**

- **F1 — the instance-count contradiction was parked whole and is partly answerable.**
  It sits under "not checkable from the repository" beside vendor facts. Whether N
  incidents occurred is history and stays parked; whether the document's stated count
  matches its own list is repo state and fails — five bullets, but one is "three phantom
  cross-file links", so seven instances across five families, while the sentence says
  five and finding 1 says sixth. Resolve by stating the unit.
- **F2 — `tests/e2e/_harness.ts` infers where an observation exists.** It says supautils
  is "true of CI's stack by the same image". CI's golden path passed 10/10 on `2439938`
  and `seedE2eCorpus` fails loudly without that grant, so CI is **observed**.
- **F3 — the supautils dependency lives in one code comment.** Membership of
  `supabase_privileged_role` plus `session_replication_role` being on
  `supautils.privileged_role_allowed_configs` is a named vendor dependency of the E2E
  harness. Record it in the runbook's unautomatable table with its failure mode (grant
  absent → seeds nothing, fails loudly) and note it is **local and CI only**, not hosted.

**Proposed, not ruled — awaiting Claude Code's judgment**

- **A fourth defect family, distinct from Clause 5.** Clause 5 is *a mechanism present
  and not reaching* — something that does not fire. The proposed family is the opposite:
  **the thing works and the stated reason it works was never checked.** Four candidates:
  zsh/`PIPESTATUS`; the superuser claim (six places, load-bearing for a hosted hand
  check); the count-equality control; `session_replication_role`. If it holds it gives
  the `scripts/` survey a sharper target than "does this run": *is the stated reason it
  works the actual reason.* Claude Code was asked to say if the four do not cohere.

**Undecided, needed before the work they gate**

- **017's caller route.** `service_role` has no USAGE on schema `app`, so a grant is not
  a route. The options are pg_cron running as `postgres` (no grant needed), a direct
  owner connection, or a `public` wrapper with EXECUTE for `service_role` — and that last
  reopens the reader decision just closed. `service_role` holding BYPASSRLS hosted does
  **not** make this choice; the public-surface question does.
- **B1 / O3 — the facility's contractual agreement to publish live capacity.** Blocks
  facility-one onboarding. Not the apply.
- **O1 — the dispatch tier** (LASAMBUS). An org-level credential preserves the ward-level
  identity lock; individual dispatcher accounts reopen it.
- **O2 — the granularity floor.** Not adopted; ship as built. Revisit trigger is a
  condition: the first facility publishing a ward with `offering = 'OFFERED'` and
  `bed_count <= 2`.
- **`noindex`** — the founder's "static shell indexable" ruling reverses v1:250 and
  v2:273, made without knowing those existed. `noindex` stands until he rules. Cowork's
  suggestion on the table: index only routes structurally incapable of carrying a count.
- **Finding 1 — `refresh_lga_rollup()` has no caller.** Deferred to Stage 3 with the
  rollup payload key, by v2:225, not by neglect. Confirmed still open by the sweep.

**Founder-side**

- **Step 9's remaining two legs** — magiclink single use, and real-time expiry. Blocked by
  Supabase's built-in email sender (429 on the fourth send). ~5 minutes once custom SMTP
  exists. **The expiry restore must come last.**
- **Custom SMTP + the NDPA s.29 processor agreement** — one item, prerequisite for
  facility one.
- **Cloudflare** — s.29 written processor agreement and s.41 transfer basis.
- **Auth Site URL** is still `http://localhost:3000`. Becomes `https://app.openbed.ng`
  when the app exists.
- **Step 11's rotation-runbook tick** — the founder's attestation.
- Not blocking: NDPC registration threshold, the public privacy notice (s.34), the PITR
  decision before facility one, the "OpenBed" registrability opinion.

**Method note worth keeping**

Cowork's error rate stayed on the mechanism side this session, as the property/mechanism
rule predicts. Two claims were caught by Claude Code and corrected with observations:
the count check "guarding MATERIALIZED" (EXPLAIN), and H2 closed on the role attribute
when the `SECURITY DEFINER` owner is the other half. Every property-level ruling held.
That is the review loop working in the direction it was designed to work.
