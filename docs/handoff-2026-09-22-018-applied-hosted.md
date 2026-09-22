# Handoff — OpenBed-NG: 018 applied to hosted, the accumulation boundary CLOSED — 2026-09-22

Prepared by: Claude Code, in the change that records the hosted apply (R-2026-09-22-52).
This is the session boundary record. It supersedes `docs/handoff-2026-09-21-gate-lifted-018-in-flight.md`, which is **left unedited** — it is a dated record of what was believed on 2026-09-21, and method note 8 makes a dated record superseded rather than amended.

---

## The one thing to know

**Migration 018 was applied to `klrlpxysjsjpdkeqdhvl` on 2026-09-22 at 05:40:40 UTC.** The three public mirrors — `public.facility_public`, `public.ward_public`, `public.lga_rollup` — are revoked from `anon` and `authenticated` and removed from the `supabase_realtime` publication, **on the database, not just on `main`**.

**The accumulation boundary that Sprint A1 exists to draw is closed.** From that timestamp the history-is-private commitment is available to a facility agreement, subject to one condition and no others: the use rule on `database/migrations/018_close_mirror_read_and_push_surfaces.down.sql`. That reversal goes to hosted only under a founder ruling naming the reason, and **while it is applied the commitment is false and no agreement may carry it.**

---

## Where things stand

**`main` = `f8dccd6`** before this change. PRs merged 2026-09-21: #54 through #62, ending with #62 `8463e29` (the pre-apply runbook restatement and its five review fixes). **The record's last ruling is `R-2026-09-22-52`**, assigned in this change from the record's last as read on its branch (`R-2026-09-21-51`). **Next provisional letter: AE** (I and O stay skipped).

**Hosted (all MEASURED by the founder, 2026-09-22, pasted in full):**

| | reading |
|---|---|
| migrations | ledger **18**, second dry run `0 migration(s) pending.` |
| mirror reads, publishable key | `HTTP 401`, body `"code":"42501"`, on all three — reads **and** writes |
| `anon`/`authenticated` SELECT | `can_select f` on all six rows |
| `supabase_realtime` | `(0 rows)`; `publication_exists t`, `publication_empty t`; `relreplident d` on all three |
| `snapshot_current` | 1440 rows to `service_role`; `anon` refused, `permission denied for table snapshot_current` |
| cron, after the apply | `openbed_refresh_lga_rollup` 3 succeeded / 0 failed; `openbed_regenerate_snapshot` 16 succeeded / 0 failed |
| public path | `/beds.json` `HTTP/2 200`, `application/json`; `/version.json` commit `76fe917`, `dirty false` |

**Production is unchanged and was not deployed.** The live bundle is still `76fe917`. **018 is invisible from outside, which was the claim**, and the read-back proves it rather than asserting it.

**Nothing is owed founder-side.** The apply is done and recorded.

---

## The four corrections owed from #61 (R-2026-09-21-49 F)

Batched here, as that ruling directed — in the NEXT handoff document, with the 2026-09-21 one untouched.

1. **The demonstrated-failing-half rule is method note 23**, with note 24 as its cheaper prior question. The 2026-09-21 handoff cited notes 21 and 22. **Those are batching and open items** and have nothing to do with probes.
2. **The Supabase `edge_logs` figures — *"5 reads, all CDG, minimum gap 80 s"* — were true when taken and were stale for their own stated window by the time they were written down.** The implementer's own probes landed inside 17:30–17:50Z afterwards, so the window holds at least 7 reads with a minimum gap of **34 s**. **The inference survives**: 34 s still exceeds the 30 s `s-maxage`, so it remains consistent with origin offload. The request-to-log-line mapping is still **NOT CONFIRMED**, and what would close it is a probe that varies one request and reads the matching line, not a larger sample.
3. **`-46` was named for the PR freeze before that number was assigned.** It is correct only because the rulings happened to land in an order that made it so. Numbers are read from the record on landing (method note 16); a number written ahead of its assignment is a composed identifier whichever way it turns out.
4. ***"No PR number seen yet"* was stale the moment #61 opened**, which was before that handoff was read.

---

## What this change did

- Froze the boundary at 18 (`database/migrations/applied-hosted.json`) and moved the placeholder in `tests/compliance/frozen_migrations.test.ts` to 019.
- Restated **nine** sections of `docs/runbook-supabase-project-creation.md` and **three** passages of `docs/runbook-cloudflare-pages-beds-json.md`, each in its own section's history form. **This is the first time the restate rule has been discharged by the change it actually names** rather than by one catching up afterwards.
- Ticked block B, block E, §6's refused-mirrors box and §10's publication box, each with the measured values and the date.
- Gave **15 of 16** governed runbook blocks step P's `export PATH` line as their own first line (step P already had it), and added `tests/compliance/runbook_psql_path.test.ts`, which **derives** that line from step P rather than restating it.

---

## Two corrections to this project's own controls, both found while doing the above

**1. An instruction citing a mechanism that stopped reaching on the day it was last carried out.** Step 5 said a placeholder named after the migration just recorded *"is an edit to a frozen file, and the test reds"*. True on 2026-09-17, false from the moment it was acted on: the fix that day renamed the placeholder to the distinct `NNN_placeholder.sql` form, **and that same rename removed the collision the sentence cites**. Measured three ways against the boundary at 18; the stale placeholder passes 7 of 7. **The move is now hygiene and nothing would catch it being skipped.** OPEN ITEM, trigger *the founder's word or the next apply*: derive that leg's placeholder number from `database/migrations/applied-hosted.json` and retire the manual step.

**2. A parser reading a restatement's quoted history as the live stop condition.** `stopBulletPendingCount` in `tests/compliance/runbook_migration_expectation.test.ts` scanned to the next top-level bullet and took the first backticked count anywhere inside, with a header comment asserting the indented restatement notes carry none. **That was a property of the corpus, not of the parser** — the same family as the `\Z` found in `-51 E`. The next restatement quoted the old count in backticks, as every restatement note in the document does. Caught on the first run by the leg that asserts a plant landed. The span now stops at the first indented sub-bullet.

---

## Open items carried forward

Unchanged from `-51` except where noted. The ones with named triggers: the `.rpc(` lint widening (first call site under `apps/`); the CI job reading `github.event.pull_request.body` (next change to `.github/workflows/ci.yml`); the mechanical provisioning guard; facility one has no written procedure; A3, B2 and D1 gated on the first hosted `app.facility` or `app.ward_account` row; the codec tautology; `s-maxage` against `pollCadenceSeconds`; the Docker Hub limit; the `config_drift` auth hook; the infrastructure inventory; `robots.txt`; Finding D; freshness never wired. **New:** the placeholder derivation above.

---

## For whoever picks this up

The next migration is **019**, whenever there is one. Step 5 now expects `0 migration(s) pending.` until then, and `tests/compliance/runbook_migration_expectation.test.ts` will red the moment a forward migration lands in `database/migrations/` without that section being restated in the same change. **That guard is one quarter of the restate rule.** §6, §7 and §10 are hosted readings; nothing in this repository can derive them, and `.github/PULL_REQUEST_TEMPLATE.md` asking the question is the only thing that reaches them.
