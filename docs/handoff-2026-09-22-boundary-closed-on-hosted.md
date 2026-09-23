# Handoff — OpenBed-NG: 018 applied, accumulation boundary closed on hosted — 2026-09-22

Prepared by: Cowork handoff. This file is not in the repo. To commit it, Claude Code adds it to `docs/` with the next substantive change (R-46 batching). **Don't leave it untracked in the repo:** any untracked file makes `scripts/deploy_pages.sh` refuse to deploy.

---

## Division of responsibilities

Claude Code writes, tests and ships changes, assigns ruling numbers on landing, and holds AE on a branch until the next substantive change. Cowork reviews every PR against the files themselves, not against the PR description, and turns hosted steps into instructions the founder can paste. The founder merges when he gives the word, runs every hosted step himself, deploys only through the wrapper, and owns Cloudflare, DNS, email and all facility-side decisions.

---

## Where things stand

**`main` = `0cfab92`.** PRs merged this session, all read and checked by Cowork before the merge word:

- **#61 `3b232b6`**: migration 018. It removes the three mirrors (`facility_public`, `ward_public`, `lga_rollup`) from `supabase_realtime` and revokes SELECT from anon and authenticated. The down file reverses exactly that and nothing more. The PR also re-pointed the auth probes, which had passed with no session at all, to `rpc/my_facility_wards`. Rulings -46, -47, -48.
- **#62 `f8dccd6`**: the runbook changes needed before the apply. §5, §6 and §10 were updated for 018. #61 had left them stale. Block B (the "before" reading) and block E (the read-back) were added. The restate rule now covers every hosted expectation, and there is a new PR template. Guard `runbook_migration_expectation.test.ts` checks §5 against the migrations directory. The ESLint ignores now cover `.wrangler`, `coverage`, and Supabase's `.branches` and `.temp` folders, and a test asserts the exemption list is empty. Rulings -49 (AB), -50 (AC), -51 (AD).
- **#63 `0cfab92`**: records the hosted apply. The frozen boundary is now 18, observed 2026-09-22, and the placeholder moved to 019. Nine runbook sections and three Cloudflare passages were updated, and every 018 checkbox is ticked from the founder's pasted output. Every one of the 16 runbook blocks that calls `psql` or `run_migrations.sh` now carries step P's PATH line itself, and a guard derives that line from step P. Ruling -52.

**Hosted database (the founder measured every value, 2026-09-22):**

- **Before the apply:** 3 × HTTP 200 on the mirror reads. The publication held all three mirrors. Ledger 17. The dry run showed exactly one `WOULD APPLY`, 018.
- **Apply at 05:40:40 UTC:** `1 applied this run`. Ledger 18, then 0 pending.
- **Read-back:** `can_select` is `f` for anon and authenticated on all three mirrors. There are 1,440 snapshot rows visible to service_role, and anon is refused. After the apply, the rollup ran 3 times and the snapshot job 16 times, with 0 failures. Over HTTP, the READ and WRITE on all three mirrors return 401 with body code 42501. The publication exists and is empty. relreplident is `d` on all three.
- **THE ACCUMULATION BOUNDARY CLOSED ON HOSTED AT 2026-09-22 05:40:40 UTC.** From then on, a facility agreement can include the history-is-private commitment. The one condition is the 018.down.sql use rule: it is never applied to hosted without a founder ruling that names the reason, and while it is applied, no agreement may carry the commitment.

**Production:** still deployment `76fe917`, `dirty: false`. No deploy is owed. 018 changed nothing a visitor can see, and item 4 of the read-back confirmed `/beds.json` still returns 200 JSON.

**In flight with Claude Code:** **R-PROVISIONAL-2026-09-22-AE**. The frozen_migrations placeholder number should be derived from `applied-hosted.json` instead of typed in by hand, and the runbook's "move the placeholder" step removed. Proof required: pointing the derivation at a frozen number turns the check red. This is record-only, so it goes on a holding branch, not a PR. It is expected to land as **R-2026-09-22-53**, but read the number from the record. Status: **issued, not yet reported back.**

**Record:** the last ruling on main is **R-2026-09-22-52**. **Next provisional letter: AF** (skip I and O).

---

## What's next — in order

1. **Confirm AE landed as intended.** It should be on a pushed branch, with no PR opened, carrying the ruling, the ledger row and the derivation plus its failing half. It rides the next substantive change. *First, because it's the only thing in flight.*
2. **Infrastructure review.** This gates Bundle 3. The scope carries over unchanged from the 2026-09-21 handoff:
   - `supabase-proxy` in front of `api.openbed.ng` (default is to remove it unless it earns its place);
   - the stray `openbedng` Worker, which has no domains and no routes;
   - `openbed-ward-console` on Pages, which has no build stamp and which the wrapper can't deploy;
   - DNS leftovers: `www` (not a Pages custom domain yet), and `mail.` and `ftp.` (proxied CNAMEs that mail doesn't use);
   - DNS and SSL for `app.` and `admin.`;
   - hosted `public.rls_auto_enable()` / `ensure_rls`, which are undeclared and have PUBLIC EXECUTE;
   - the orphan auth user `security@openbed.ng`;
   - a GET check that `api.openbed.ng` returns 401.

   Run it as a Cowork review, with plain founder steps for anything in the dashboard.
3. **Bundle 3 kickoff** via sprint-push, after the review. Its scope is fixed by ruling Z: tracked origins for every app (Finding D); a deploy guard and build stamp for every app; admin.openbed.ng v1; and the publish-screen fixes. admin.openbed.ng v1 covers operator sign-in, creating and editing facilities and categories, server-side ward-login provisioning per category, and a facility list with per-category freshness that operators see and that is never used as a filter.
4. **Before the first hosted `app.facility` or `app.ward_account` row:** fix A3, B2 and the publish-screen raw-text item, and write a facility-creation runbook step. None exists yet.

---

## Fundamental — carries forward

> **Fundamental: any failure must be foundationally resolved.** Fix the root cause, not the symptom. Before calling a fix done, understand everything it touches or could touch — other bundles, shared modules, downstream consumers — so the fix doesn't quietly create a new problem elsewhere. Resolve issues in the same pass, in place — don't file a ticket for something that can be fixed now.

The deliberate exceptions are the open items below. Each has a named trigger.

---

## How this build is run — read before issuing anything

- **Rulings:** Cowork issues `R-PROVISIONAL-<date>-<letter>` and never numbers. Claude Code numbers them on landing. Paste ruling blocks in their own turn. R-46 freeze: record-only work batches into the next substantive change. A named exception is allowed when a hosted step can't proceed without it; #62 was one.
- **Review the files, not the PR body.** Cowork's device shell can read the repo at `~/Desktop/OpenBed-NG` once folder access is granted. Read only; never run git there. This session's reviews found real defects that the PR descriptions didn't show.
- **Cowork errors this session, so the next one doesn't repeat them:**
  - (a) I passed #61 without checking that the runbook's hosted expectations matched the new migration. When reviewing any migration PR, check §5/§6/§7/§10 and the Cloudflare runbook.
  - (b) I walked the founder through the hosted apply without step P, so he hit `psql: command not found` twice. Now fixed at the root: every psql block carries the PATH line itself.
  - (c) The previous handoff cited "method notes 21–25" for the demonstrated-failing-half rule. It is **method note 23**.
- **Hosted steps:** quote the runbook blocks word for word from main. Build in a stop before any irreversible step, and have the founder paste the output back to Cowork. The founder uses the **Session pooler** connection string (port 5432), never the transaction pooler, and it goes only into the silent `read -rs` prompt.
- **Every probe needs a demonstrated failing half** (note 23). Use `curl -I` for HEAD, never `-X HEAD`. Read `x-openbed-edge-cache` only when the colos match.
- **Founder shell:** paste commands, never output. zsh doesn't treat `#` as a comment. Merges happen only on his explicit word. Deploys only through `scripts/deploy_pages.sh`, and every report quotes `/version.json`.

---

## Canonical docs

- `Sprint Kickoffs/decision-2026-09-14-public-private-split.md`: every ruling through -52, the method notes, the provisional ledger and the NDPA processor table. Read it before revisiting any decision.
- `Sprint Kickoffs/sprint-kickoff-a1-accumulation-boundary-2026-09-17.md`: the Bundle 2 and 018 task list, now discharged.
- `docs/runbook-supabase-project-creation.md`: the hosted runbook. Step P; §5 (now expects 0 pending) with the general restate rule; the 018 blocks B and E and the closure record; §6 (all refused, including the local-vs-hosted table); §10 (empty publication).
- `docs/runbook-cloudflare-pages-beds-json.md`: deploy, read-backs, the rate-limit rule, and the §4b go-live trigger.
- `database/migrations/018_close_mirror_read_and_push_surfaces.sql` and `.down.sql`: what closed the boundary, and the reversal with its use rule.
- `database/migrations/applied-hosted.json`: the frozen boundary, 18 files.
- `tests/compliance/runbook_migration_expectation.test.ts`: the §5 guard. It parses three places in the section and cross-checks them.
- The step-P PATH guard and the ESLint exemption test added in #62/#63: see those PRs for the filenames.
- `.github/PULL_REQUEST_TEMPLATE.md`: asks which runbook expectations a migration changes.
- `scripts/deploy_pages.sh`, `scripts/stamp_build.mjs`, `scripts/provision_ward_account.mjs`: the deploy guard, the build stamp, and the STOP block before the first row.
- `docs/handoff-2026-09-21-gate-lifted-018-in-flight.md`: the previous handoff in the chain, committed in #61 unedited. Its four discrepancies are listed in #61's body; (c) above is the one that matters.
- **Cowork Project doc `claude/product-bible-draft.md`**: still awaiting founder approval. Context only, never an authority.

---

## Open items / blockers

**Blocker on the build path:** none.

**Must be fixed before the first hosted facility or ward_account row:** A3; B2 plus the publish-screen raw-text item; the missing facility-creation runbook step; a possible mechanical provisioning guard.

**Open items, each with its trigger:**

| Item | Trigger |
|---|---|
| Placeholder derivation | AE, in flight |
| The restate rule is only mechanical for §5. §6, §7 and §10 are hosted readings that only the PR template reaches | Next migration |
| `.rpc(` lint widening | First call site under `apps/` |
| F3 ESLint guard | Next build or lint config change |
| `s-maxage` ↔ `pollCadenceSeconds` coupling | Next change to either |
| Docker Hub rate limit | Next failure |
| config_drift doesn't guard the auth hook block | Next `config.toml` auth change |
| codec.ts tautological legs | Next codec change |
| Step 4 gating step 6 (-43) | — |
| Gate 2 at about 120 s | — |
| The regex readers | After facility one |
| `robots.txt` / `noindex` | Facility one |

**Optional:** 27 stale local branches from earlier sprints, all long merged. Sweep them on the founder's word.

**Founder-side, not blocking:**

- SPF: two `v=spf1` records on the apex. Confirm the `+a +mx +include:re…` one is unused, delete it, and recheck DKIM in Proton.
- Add `www.openbed.ng` as a Pages custom domain.
- Approve the product bible draft.
- The WAF rate-limit rule (runbook step 7).
- Auth Site URL is still `localhost:3000`, and custom SMTP is needed. Both are needed before Bundle 3's first real use.
- The facility agreement. It can now carry the history-is-private commitment, subject to the down-file use rule. The legal wording is the founder's.
