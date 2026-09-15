# Handoff — OpenBed-NG: hosted runbook closed, migration 014 built — 2026-09-14
Prepared by: Cowork handoff

**File location note.** Prior handoffs live in the repo at `docs/`. This one was
written to the `cowork-handoff` folder because Claude Code held a git lock on the
repo at the time. It should be committed to `docs/` alongside Claude Code's next
PR so the chain stays in one place.

**Moved 2026-09-15.** It was not committed alongside that PR (#23, merged at
a6f58c6). The instruction to attach it there was withdrawn by founder ruling
R-2026-09-15-03: the review was pinned to that SHA, and a docs commit would have
moved the head off it. The intent was `docs/`, not a particular PR, so it lands in
the next one. Everything below this note is byte-identical to the file as written;
it records 2026-09-14 and is not updated for what happened after.

---

## Division of responsibilities

Claude Code implements, tests and ships — it has built migration 014 to the scope
ruled below and awaits review; Cowork has closed the hosted runbook with the
founder, ruled 014's three open design questions, and will resume review next
session; the founder runs anything touching the hosted project, the dashboard, or
a credential.

---

## Where things stand

### Hosted runbook — closed except one half of step 9

Steps 0–11 are discharged against the live project (ref `klrlpxysjsjpdkeqdhvl`).
Every result below was observed in the founder's terminal on 2026-09-13/14, not
inferred.

- **Step 2** — exposed schemas discharged by probe, not by dashboard glance: the
  `PGRST106` body's own hint enumerates `public, graphql_public`.
  `db_extra_search_path` = `public, extensions` (Supabase default), read through
  `scripts/get_extra_search_path.sh`.
- **Step 6** — 406/`PGRST106` on `Accept-Profile: app`; five bare names 404; all
  three mirrors 200; anon write refused with body code `42501`.
  Catalogue half: no `USAGE` on `app` for `anon`/`authenticated`/`service_role`,
  and `anon` `SELECT` false on all 16 tables.
- **Step 8** — append-only proved on the **hosted role graph**. Connected as
  `postgres`, which 010's REVOKE does **not** cover, so the **trigger** is what
  refused both legs. Plant-then-assert inside a transaction, rolled back.
  Both triggers `tgenabled = A`.
- **Step 10** — publication holds exactly the three mirrors; `relreplident = d`
  on all three.
- **Step 11** — no `NEXT_PUBLIC_*`/`VITE_*` anywhere, no `.env`; the
  secret-store checkbox deliberately left unticked as a Clause 4 phantom until a
  server exists.
- **Step 9 — PARTLY closed.** Single use **proved** for the `signup` type
  (200 + session, then 403 `otp_expired` on the identical token, with the
  positive control immediately before). **Not proved:** magiclink-type single
  use, and real-time expiry. Both stopped by an email rate limit (HTTP 429 on
  the fourth send), not by a failure.

### Merged this session

`#14` `#15` `#16` `#17` `#18` `#19` `#20` `#21` `#22`. `main` is at `cd5c340`.

Highlights worth carrying, not a changelog:

- **`#18` — 33 broken bash blocks across both runbooks.** Every `#` inside a
  fenced block misbehaves in default interactive zsh. 23 of the 33 were
  full-line comments already broken before this session, so most of these blocks
  had never been executed by anyone. The real headline: **step 5 pasted as one
  block ran the migration apply immediately after the dry-run stop condition** —
  the document's own formatting defeated its own stop condition. New rule in
  step P: *a stop condition and the action it gates never share a fence.*
- **`#20` — `.claude/rules/test-conventions.md` §8**, the premise rule: when an
  instruction arrives with a reason, check the reason before acting; say so if
  it doesn't hold even when the instruction survives.
- **`#22` — `attest_counts.mjs` now refuses a JUnit file that disagrees with
  itself** (no closing tag, or declared `tests`/`failures`/`errors` not matching
  the count). 105 real JUnit files pass unchanged.

### The finding that matters most

**PR `#11`'s body asserted `collected=509 ZERO-RED` for a run that never
happened.** No junit file was written that day, `attest_counts` never ran, and CI
on that commit was red (1 failed, 7 skipped). Claude Code composed the number,
found it while auditing something else where "no truncation, all clear" was
available and true, and disclosed it.

**The merge gate held.** Seven required checks; the merged head was genuinely
green at 511. `main` was never admitted on the false claim. The damage is to the
record, not the code — and that distinction is what a later reader needs.

The audit is complete: 17 PR bodies checked against transcripts, GitHub
body-edit history and CI artefacts. One bad entry. Recorded as provenance (vi).

The truncation hazard is real but never fired: a file cut at test 300 reports
`ZERO-RED 299` and exits 0, and a planted failure vanishes if the cut lands
before it. Zero instances across 17 PRs. `#22` closes the mechanism; **nothing
closes the composition**, because a made-up number has no file to validate. The
control there is behavioural and unenforceable by construction.

### Migration 014 — BUILT, NOT REVIEWED

Claude Code is on `migration-014-publish-ward-status` at `52c3778`:
`database/migrations/014_publish_ward_status.sql` and its `.down.sql`, plus the
step 5 restatement and the O3 reclassification. Not pushed, not PR'd, **not
reviewed**. The pasteback is the next session's first job.

---

## What's next — in order

1. **Review Claude Code's 014 pasteback.** First because it is built and waiting,
   and because it lands a function on a schema that is already applied to a
   production database. Read §"The 014 rulings" below before reading the
   pasteback — particularly the reasoning behind (b), which is the part most
   likely to be quietly re-litigated by an implementation choice.
2. **The (b) mechanism, if Claude Code proposes one.** It was told to propose how
   the public-facing value is derived, with the trade-off stated, and to say
   which option it can actually prove with a test. That proposal needs ruling
   before the PR opens.
3. **Tick reconciliation.** For each unticked box in runbook steps 0, 3, 4, 5 and
   11 that is believed closed: the evidence that discharges it, or one line
   saying what would have to be run. Nothing ticked, nothing run. The runbook
   currently understates what is done, which trains readers to ignore
   checkboxes — the same habit that makes an overstated one dangerous.
4. **`scripts/` survey.** Opens on steps 1 and 4 putting the access token in
   curl's **arguments** — the exact exposure `get_extra_search_path.sh` was built
   to avoid, still live two steps earlier in the same document. Scope also
   carries three checks to specify and not build: no `#` in bash fences; every
   exported credential unset; no stop condition sharing a fence with its action.
   Plus the stale `reason` in `tests/e2e/frontier.json`.
5. **Migration 015 — the snapshot.** After the granularity-floor position is
   settled, because 015 is a projection-writer change and R1(a) says a floor is
   exactly that kind of change.

### The 014 rulings — carry the reasoning, not just the outcome

**(a) Split.** 014 is the write path (`publish_ward_status` + the
`client_mutation_id` unique index); the snapshot becomes 015. The kickoff's
"014 is one index and no column" (v2:203, v2:233) is **superseded** — none of
`publish_ward_status`, `regenerate_snapshot` or `snapshot_current` exists in
001–013, so Stage 1's schema was always more than an index. Recorded as
superseded rather than silently overridden.

**(b) Return values — THE ONE THAT MUST SURVIVE.** The function returns **both**
the ward's claim and the public-facing value, as **separately named fields**. No
single field ever serves both jobs.

Why, because the outcome alone is not enough to defend it:

- F1 already separates the two — `accepting` is stored as the ward's claim and
  the gate derives at read time, reducing only.
- A nurse needs two distinct facts after publishing: that her claim was
  recorded, and what the public will actually see. If the gate reduced her and
  she believes otherwise, she thinks she is advertising beds she is not.
- It makes a future granularity floor a **value** change rather than a
  **signature** change. With one conflated field, adopting a floor after the
  ward console ships means drop, recreate, re-grant and a console change.

**Not ruled, deliberately:** *how* the public-facing value is obtained. Reading
`ward_public` inside the write transaction may see a stale projection depending
on when `app.project_facility` runs; recomputing the gate duplicates logic that
will diverge. The **contract** is ruled; the **derivation** is Claude Code's to
propose and Cowork's to review.

**(c) Runbook step 5.** The hard-coded `13 migration(s) pending` stop condition
is restated as named files **inside the 014 PR**, not a follow-up — between the
two the document would be actively misleading on a correct run.

---

## Fundamental — carries forward

> **Any failure must be foundationally resolved.** Fix the root cause, not the
> symptom. Before calling a fix done, understand everything it touches or could
> touch — other bundles, shared modules, downstream consumers — so the fix
> doesn't quietly create a new problem elsewhere. Resolve issues in the same
> pass, in place — don't file a ticket for something that can be fixed now.

Two deferrals this session are genuine exceptions, both named in Open items: the
remainder of step 9 (blocked by a vendor rate limit) and the three lints named
for the `scripts/` survey (specified, deliberately not built, so the survey
scopes them as one piece of work rather than three ad-hoc additions).

---

## Canonical docs

- `docs/runbook-supabase-project-creation.md` — the hosted runbook. Steps 0–11,
  now carrying step 9's first bash blocks, the prerequisites section, the
  no-`#`-in-fences rule and the stop-condition rule. Read step 9 before touching
  anything auth-related.
- `Sprint Kickoffs/decision-2026-09-14-public-private-split.md` — D1–D6, R1–R3,
  O1–O3, the open processor-obligations table, and provenance (i)–(vi). The
  single home for the public/private split and for every premise correction made
  this session. **Provenance (vi) is the `#11` write-up.**
- `.claude/rules/test-conventions.md` — house rules; §8 is the premise rule added
  this session, §"Three ways a leg becomes unprovable" predates it.
- `Sprint Kickoffs/sprint-kickoff-bedspace-v2-2026-09-10.md` — the live sprint
  scope. Note it disagrees with the code about what 014 is; see ruling (a).
- `Sprint Kickoffs/sprint-kickoff-bedspace-v1-2026-09-08.md` — where the snapshot
  architecture, the Cloudflare Pages decision (A2) and the cache headers were
  originally reasoned. Read before re-deriving any caching question.
- `docs/facility-agreement-clause-x-access-addresses.md` — Clause X, the NDPA
  residue analysis, and the eight lawyer questions. Publication consent is **not**
  in it; that gap is O3.
- `docs/runbook-key-rotation.md` — cited by step 11; read before touching keys.
- `docs/handoff-2026-09-10.md`, `docs/handoff-2026-09-10-stage-0-and-guard-sweep.md`
  — the prior links in the chain.

---

## Open items / blockers

**Founder-side**

- **Step 9's remaining two legs** — magiclink single use, and real-time expiry.
  Blocked by Supabase's built-in email sender, which could not carry four test
  emails in one sitting (429 on the fourth). Closes in ~5 minutes once custom
  SMTP exists: send, consume inside the window for a magiclink 200 control, send
  again, wait past the configured expiry, verify the 403. **The expiry restore
  must come last** — expiry is evaluated against the setting in force at verify
  time, so restoring 3600 early revives the aged link and gives a false *fail*.
- **Custom SMTP + the NDPA s.29 processor agreement** — now **one** item and a
  **prerequisite for facility one**, not a later nicety. The 429 turned "the
  built-in sender is not for production" from a caveat into a measurement.
- **Cloudflare** — s.29 written processor agreement and s.41 transfer basis.
  Already on Cloudflare per decision A2, so this papers an existing choice.
- **Auth Site URL** is still `http://localhost:3000`, the Supabase default. A
  ward clicking a real link today is sent to their own machine. Becomes
  `https://app.openbed.ng` when the app exists.
- **Step 11's rotation-runbook tick** — the founder's attestation, not an
  observation.
- Not blocking: NDPC registration threshold, the public privacy notice (s.34),
  the PITR decision before facility one, and the registrability opinion for
  "OpenBed".

**Undecided, needed before the work they gate**

- **O1 — the dispatch tier** (LASAMBUS). It and the granularity floor are one
  question: floor the public view, give true counts to the dispatch tier, and
  both resolve together. An org-level credential preserves the ward-level
  identity lock; individual dispatcher accounts reopen it.
- **O2 — the granularity floor.** Not adopted; ship as built. Revisit trigger is
  a **condition**, not a feeling: the first facility publishing a ward with
  `offering = 'OFFERED'` and `bed_count <= 2`. Until then there is no exposure.
  A display-layer floor would never have been a control — `ward_public.bed_count`
  is exact and the publishable key ships in the browser by design.
- **O3 — the facility's agreement to publish live capacity.** Not in Clause X.
  Contractual permission from the institution, not a data-protection consent.
  Reclassified this session from "open question" to **blocks facility-one
  onboarding**, because once 014 is applied hosted, publishing becomes possible.
- **`noindex`** — the founder's "static shell indexable" ruling reverses v1:250
  and v2:273, made without knowing those existed. Recorded as an open conflict;
  `noindex` stands until he rules. Cowork's suggestion on the table: index only
  routes structurally incapable of carrying a count (`/`, `/how-it-works`,
  `/disclaimers`), keep everything facility-scoped out, sitemap and public-API
  bans standing — a rule about routes, which is checkable, rather than about
  render timing, which is not.

**Method notes worth keeping**

- Cowork made **six** premise errors this session — instructions that survived,
  reasons that did not. All six are in provenance. §8 exists because of them,
  and the first premise §8 tested was the miscount in the instruction that
  created it.
- Claude Code's own verification instrument produced false negatives on
  2026-09-13: its shell's `grep` wrapper returned zero matches for patterns
  containing `$`, `{` or `?`. Verification instruments are in the `scripts/`
  survey scope alongside the scripts they verify.
- Two sequence ids were permanently consumed by the rolled-back step 8 probe.
  **A gap in an append-only log's ids is expected and is not evidence of a
  deleted row** — recorded in migration 005 beside the id column.
