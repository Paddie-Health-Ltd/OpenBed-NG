# Handoff — OpenBed-NG: the v1 sweep, four probes, and a sprint scoped but not started — 2026-09-17

Prepared by: Cowork handoff

**File location note.** This sits in `cowork-handoff/`, outside the repo, like its
four predecessors. **It should ride into `docs/` with the next PR that touches the
repository** — as should `handoff-2026-09-17-017-shipped-and-hosted-at-017.md`, which
carried the same instruction this morning and **has not ridden in yet**. Two are now
owed, not one.

---

## Division of responsibilities

Claude Code implements, tests and ships; this session it also ran four probes Cowork
could not and corrected six of Cowork's premises. Cowork swept the v1 kickoff, ruled
R-2026-09-17-03 through -11, and scoped the accumulation-boundary sprint. The founder
holds the Cloudflare account, the hosted applies, and the one open decision in the
kickoff. Unchanged in shape; the correction traffic ran one way more than usual and
the record says so.

---

## Where things stand

**`main` is `feefcf3`** (#35's merge). **`#36` is open and green at `2801289`** on
branch `accumulation-boundary-2026-09-17`, carrying the R-08 record. Migrations are
frozen at 017, hosted holds 001–017, and the `frozen_migrations` placeholder is at 018.
Nothing has been started on the sprint below.

**The one thing that must happen first, and it is not in any PR yet.** The decision
record carries rulings through **R-2026-09-17-08**. Verified by Cowork on the branch,
not assumed: `grep` for R-09, R-10 and R-11 in
`Sprint Kickoffs/decision-2026-09-14-public-private-split.md` returns zero.
**Rulings R-09, R-10 and R-11 exist only in a session transcript.** That is precisely
the defect PR #28 fixed for the v2 enumeration in the first place, reappearing at the
other end of the same day. They carry the E1 retraction's final shape, the sequencing
re-rule, the sprint, the DoD split, and method notes 10 through 13. If the next
session does nothing else, it lands these.

### Shipped this session — PRs #33 through #35, with #36 open

- **#33** — the v1 sweep landed: the enumeration committed, the kickoff marked, the
  `is false` prescription corrected in all four editable homes plus the SOP, and the
  "48 rows" drift fixed in four files.
- **#34** — the three design rulings, method note 9, and (amended before merge, not
  after) the E1 retraction, so the overstatement never sat in `main` unqualified.
- **#35** — E2 measured against its baseline, the accumulation boundary named as the
  root, notes 10 and 11, and two frozen-migration corrections.
- **#36, open** — the accumulation-boundary record and C1's result.

### The v1 sweep — 118 items

66 HOLDS / 24 FAILS / 12 STALE / 7 SUPERSEDED-IN-DOC / 9 NOT CHECKABLE, in
`Sprint Kickoffs/sweep-2026-09-17-v1-enumeration.md`, with a **committed** parser that
re-derives the table from the file's own verdicts. Cowork ran that parser independently
and reproduced all six counts.

Two clusters carried most of the failures. Seven items traced to v1:81 putting "the
API" on Vercel — a server that was never built, which R-2026-09-16-07 had found from
the `/api/sweep` end and marked as one leaf while the root stayed live. Five were the
`toni.health` → `openbed.ng` rename, which had reached `NOTICE` and `SECURITY.md` but
not the document that gates the first send.

### The four probes, and what they settled

Claude Code ran all four; Cowork could not, and two of them overturned Cowork's
framing rather than confirming it.

- **#12** — `is false`, `is not false` and bare `not` all raise a type error against
  `app.tri_state`. The prescription was wrong in five places including the SOP, and the
  lint's *stated reason* was the nullable-boolean silent drop, which is the shape F2
  rejected. Header now states what it actually catches.
- **#27** — an anon subscriber receives every `postgres_changes` event on the public
  mirrors, with full records, service-role control receiving identically.
  "Realtime is retained for authenticated devices only" is not enforced by the database.
- **E1, retracted** — Cowork wrote the DELETE stream as defeating quiet mode.
  `M/008:34-47` had already reasoned about exactly that payload and defended it, ending
  "which is exactly the observable fact quiet mode creates and cannot hide." The
  corrected delta over a poller is **timing resolution**, nothing more.
- **E2, measured and conditional** — against a watcher polling faster than writes
  arrive, push adds nothing; against writes inside the poll interval it is complete
  where polling is lossy. The delta is bounded by a write cadence nobody has observed
  and cannot observe before facility one.
- **C1/C2** — nothing rate-limits the data API, and `max_rows = 1000` is a page size
  with working offset paging. **The pull path already concedes the series.**

### The root everything landed on

**The design prevents history from being READ and does not prevent it from being
ACCUMULATED.** `ward_status_event` is private and the history RPC is capped, but every
read of current state is legitimate and a series is many of them. The only control that
could cover accumulation is rate limiting, which is specified at v1:250 for an unrelated
reason, unbuilt, and sited where a websocket never passes.

Underneath that, the same root twice: **decisions left standing after A1 reversed their
reason.** v1:142's Realtime publication and v1:258's anon `SELECT` grants both predate
A1's ruling that public reads come from a static snapshot. `M/016:90-93` already states
the governing principle and applies it to `snapshot_current` only.

---

## What's next — in order

1. **Land R-09, R-10 and R-11 in the decision record.** First because they are
   unrecorded outside a transcript, and everything below cites them. See *Open items*.
2. **Merge #36**, then correct the kickoff's stated base — it says `feefcf3`, which
   #36 supersedes (R-11 A1).
3. **Bundle 1 of the accumulation sprint** — the Pages Function serving `/beds.json`,
   its rate limit in `wrangler` config, the credential guard extension, and the
   served-document assertions. Merges with its five hosted steps recorded **OWED**;
   the founder deploys and observes.
4. **Bundle 2** — migration 018. **Gated on the founder's deployment report, not on
   Bundle 1's merge** (R-11 C): merging code does not open a served path, and the
   ordering exists so there is never an interval with no public read path. Its revoke
   half is additionally gated on the open decision below.
5. **Bundle 3** — `/api/health` and `/status`, closing the seven `/api` items.
   Independent of Bundle 2; needs Bundle 1.
6. **The `scripts/` survey**, with two items already named: the unguarded `<> 'NO'` /
   `NOT (flag = 'NO')` forms, and the fact that nothing validates SQL fragments quoted
   in prose — which is how a corrections section came to prescribe a form that does not
   compile.
7. **Tick reconciliation.**
8. **Facility-one onboarding**, founder-side.

---

## Method notes added this session — 9 through 13

Four came out of Cowork being wrong in a way worth generalising, and Claude Code
narrowed every one of them.

- **9** — a tool you ran is not a tool that exists. Binds the citation, not the running.
- **10** — severity is marginal over the existing public baseline. State what is already
  obtainable, then claim only the delta.
- **11** — cite by section name, not line number, inside a document that edits itself.
  Three drifts this session, all caused by markers the same chain added.
- **12** — a control names its enforcement point, and the point is checked: that it
  exists, and that it can see the whole surface. Where it cannot, name the part it
  misses rather than dropping a control that is right for the rest.
- **13** *(proposed, not yet recorded)* — a definition of done names who performs each
  criterion; one the addressee cannot perform is OWED, not done-when.

**The pattern worth carrying.** Every one of Cowork's property and sequencing rulings
held again. Every failure was a mechanism claim, a count, a citation, or — once — a
severity reached for beyond the evidence, in the same session that enumerated
twenty-one instances of that exact move in someone else's document. The loop works in
the direction it was designed to: Claude Code runs it, and the finding gets smaller and
truer each time.

---

## Fundamental — carries forward

> **Any failure must be foundationally resolved.** Fix the root cause, not the
> symptom. Before calling a fix done, understand everything it touches or could
> touch — other bundles, shared modules, downstream consumers — so the fix doesn't
> quietly create a new problem elsewhere. Resolve issues in the same pass, in place —
> don't file a ticket for something that can be fixed now.

Named exceptions this session, both deliberate and both with their reason stated: the
seven `/api` items were marked and not amended, because what replaced them was a design
ruling with no kickoff; and D1's missing-`performance.now()` question is **PARKED**, not
open, because settling it needs field data the product deliberately does not collect.

---

## Canonical docs

- `Sprint Kickoffs/decision-2026-09-14-public-private-split.md` — **the single home for
  every ruling**, currently through R-08, plus method notes 1–12. Read before
  revisiting any decision. Notes 9–12 all did work this session.
- `Sprint Kickoffs/sprint-kickoff-a1-accumulation-boundary-2026-09-17.md` — the sprint
  scoped this session, three bundles, untracked on the branch. Carries the bundle
  ordering, the blast radii, two logged scope calls and the one founder decision.
- `Sprint Kickoffs/sweep-2026-09-17-v1-enumeration.md` — the 118 items with citations,
  verdicts, and the committed parser that re-derives the counts.
- `Sprint Kickoffs/sweep-2026-09-15-v2-enumeration.md` — the 96-item v2 sweep, the
  model this one followed.
- `Sprint Kickoffs/sprint-kickoff-bedspace-v1-2026-09-08.md` — **now swept**, with
  markers inline. Its A1, A2 and A3 sections are the design this sprint makes true.
- `Sprint Kickoffs/sprint-kickoff-bedspace-v2-2026-09-10.md` — the live sprint scope,
  swept.
- `database/migrations/applied-hosted.json` — the frozen boundary, at 17.
- `database/migrations/016_snapshot.sql` — its header at 90-93 carries the principle
  the whole sprint rests on, and applies it to one table only.
- `database/migrations/008_projection_triggers.sql` — 34-47 is the defence of quiet
  mode as a DELETE, and is what retracted E1.
- `scripts/lint_sql_no_bare_not_duty_flag.sh` — header rewritten this session to state
  what it actually catches, and naming two forms nothing catches.
- `docs/runbook-supabase-project-creation.md` — the hosted runbook; Bundle 1's founder
  runbook follows its step-5 shape.
- `.claude/rules/code-pipeline.md` — house rules; its duty-flag self-check was corrected
  this session and the PR flagged it as a rules change.
- `cowork-handoff/handoff-2026-09-17-017-shipped-and-hosted-at-017.md` — the prior
  link, and still owed its ride into `docs/`.

---

## Open items / blockers

**Owed by the next session, and it is the first thing:** R-2026-09-17-09, -10 and -11
are not in the decision record. Neither is method note 13. They exist only in a session
transcript — the #28 defect, recurring.

**Owed by the repository:** two handoff docs now wait to ride into `docs/` — this one
and its predecessor.

**The one decision in the sprint, and it is the founder's** (R-09 D): whether to revoke
anon `SELECT` on the three mirrors in migration 018. Cowork recommends revoking, on the
grounds that `M/016:90-93`'s own principle says so; the real counter is that v1:258
keeps those grants as a tripwire and the column-containment control is aimed at them.
Bundle 1 relocates that control to the served document, which Cowork thinks answers it.
**If declined, say so explicitly — the rate limit then becomes the whole pull defence,
and a throttle is not a boundary.**

**Unverified, to check when Bundle 3 starts:** whether Cloudflare Pages Functions
support scheduled handlers. If not, the external sensor is a separate Worker and that
is a scope change to report, not to work around.

**Founder-side, unchanged except where narrowed:** B1 the facility agreement — quiet
mode **can** be promised honestly, but **the history-is-private commitment cannot until
the accumulation boundary is closed**; B2 custom SMTP and the NDPA s.29 processor
agreement; Cloudflare's s.29 agreement and s.41 transfer basis, now also covering Pages
Functions; step 9's two remaining legs; Auth Site URL still `http://localhost:3000`;
step 11's rotation attestation; and the `noindex` ruling.

**Still open by prior ruling:** O1 the dispatch tier; O2 the granularity floor.

**Local environment:** `psql` and Docker are absent from the Cowork machine, which is
why both handed-over checks were handed over. That is now a known and permanent split,
not an incident.
