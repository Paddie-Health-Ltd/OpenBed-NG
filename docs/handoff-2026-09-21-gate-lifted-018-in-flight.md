# Handoff — OpenBed-NG: evidence gate lifted, 018 in flight — 2026-09-21 (evening)

Prepared by: Cowork handoff. Authored into `docs/`; it lands with the **018 PR** (freeze rule: record-only material batches into 018).
**Until that PR commits it, this file is untracked and `scripts/deploy_pages.sh` will refuse to deploy** (the wrapper refuses any non-empty `git status --porcelain`). If a deploy is needed before 018 merges, move this file out of the repo first.

---

## Division of responsibilities

Claude Code writes, tests and ships 018 (with every batched record item) and assigns ruling numbers on landing. Cowork has recorded the current state and sequence, and resumes review and founder-step translation next session. The founder merges on explicit word, deploys through the wrapper, runs the hosted apply of 018, and owns Cloudflare, DNS, email and the facility-side decisions.

---

## Where things stand

**`main` = `76fe917`.** PRs merged today: #54 `4803d20` (cache fix, HEAD parity, T–W on the record), #55 `cf8bcd9` (`public-relations.json` split), #56 `b137dd1` (runbook probe sweep, Z), #57 `66829eb` (`x-openbed-edge-cache` marker), #58 `86c9125` (stale-while-revalidate consequences, colo precondition on step 6), #59 `12e670b` (**safety: fabricated bed counts and golden fixture removed from the public bundle**), #60 `76fe917` (go-live trigger is "first facility / ward_account row"; STOP block in `provision_ward_account.mjs`; runbook §4b).
The record's last ruling is **R-2026-09-21-45**, reported by Claude Code. R-2026-09-21-46 (the PR freeze) is written into the 018 PR. The record's provisional ledger is authoritative for which letter maps to which number. **Next provisional letter: AB** (skip I, O).

**Production (all MEASURED by the founder or Cowork):**
- `openbed.ng` is live on Pages. The custom domain is Active and the apex record is a CNAME to `openbed-public-dashboard.pages.dev`, proxied. The `A 192.0.2.1` placeholder is gone.
- Deployed commit **`76fe917`**, `dirty: false` (deployment `99e56bc0`).
- Outage state (read-back 5b, via DevTools request blocking): honest text only, with no counts, wards or facility names. **AA's safety defect is closed in production.**
- Empty state renders correctly (Cowork read it in the built-in browser).
- **EVIDENCE gate on 018: LIFTED.** Observations 1–4 pass. Step 6: same colo (CDG), `miss` then `hit`, then `miss` after 40 s. Supabase edge logs 17:30–17:50Z: 5 reads, all CDG, minimum gap 80 s, which is consistent with origin offload (request-to-log-line mapping not confirmed).
- W (R-2026-09-21-37) is recorded DEPLOYED (`*.pages.dev` evidence).

**In flight with Claude Code:** migration **018** (Bundle 2): remove the three mirrors from `supabase_realtime`, REVOKE SELECT from anon and authenticated, with `.down.sql`. Decisions issued to it this session:
- `clientAddressableRelations = []`. Widening the lint to `.rpc(` is an open item; its trigger is the first call site under `apps/`.
- `018.down.sql` is a **full symmetric reversal** to the exact 017 state. The header distinguishes 013's precedent and states the consequence. It is never applied to hosted without a founder ruling. An up→down→up round-trip test has exact-set assertions and a plant.
- Before writing, Claude Code confirms that no production read path depends on anon or authenticated SELECT on the mirrors.
Status: **reported in progress, not verified.** No PR number seen yet.

**The PR freeze (R-2026-09-21-46, pending record):** the next PR is 018. Every record-only item batches into it. The only exception is a safety defect reachable by a real visitor today, named as such.

---

## What's next — in order

1. **Review the 018 PR.** Check it carries all batched items: the step-6 / 5b read-back record, R-46, AA's production closure, the -45 items, and this handoff doc. Check the two decisions above and the dependency confirmation. Merge on the founder's word. *First because it is in flight and it is the boundary work.*
2. **Founder: hosted apply of 018.** The accumulation boundary closes **on the hosted apply, not on merge.** Until it is recorded, no facility agreement may promise private history. Cowork translates the runbook's apply and read-back steps into plain instructions (read the runbook; don't paraphrase from memory).
3. **Infrastructure review.** This now gates Bundle 3 (Z). Scope: `supabase-proxy` in front of `api.openbed.ng` (D0: remove unless it earns its place); the stray `openbedng` Worker (confirmed today: no custom domains, no routes); `openbed-ward-console` Pages status and commit (no build stamp, and the wrapper can't deploy it); DNS leftovers `www` (not yet a Pages custom domain, so it probably errors), `mail.` and `ftp.` (proxied CNAMEs, unused by mail); DNS/SSL for `app.` and `admin.`; hosted `public.rls_auto_enable()` / `ensure_rls` (undeclared, PUBLIC EXECUTE); orphan auth user `security@openbed.ng`; a GET proof for `api.openbed.ng` expecting 401.
4. **Bundle 3 kickoff** (via sprint-push, after the review). Scope is fixed by Z: tracked origins for every app (Finding D), a deploy guard and build stamp for every app, admin.openbed.ng v1 (operator sign-in, facility and categories create/edit, per-category ward-login provisioning server-side, and the facility list with per-category freshness shown to operators only and never used as a filter), and the publish-screen fixes.
5. **Before the first hosted `app.facility` or `app.ward_account` row** (whatever the reason): fix A3 and B2 plus the publish-screen raw-text item, and write a facility-creation step (none exists in any runbook).

---

## Fundamental — carries forward

> **Fundamental: any failure must be foundationally resolved.** Fix the root cause, not the symptom. Before calling a fix done, understand everything it touches or could touch — other bundles, shared modules, downstream consumers — so the fix doesn't quietly create a new problem elsewhere. Resolve issues in the same pass, in place — don't file a ticket for something that can be fixed now.

Deliberate exceptions are the open items below. Each is deferred under T or U with a named trigger, not silently.

---

## How this build is run — read before issuing anything

- Cowork issues `R-PROVISIONAL-<date>-<letter>` and never numbers. Claude Code assigns numbers on landing and keeps the ledger. Paste ruling blocks in their own turn.
- **Read state; don't assert it.** Today's Cowork errors, all caught by Claude Code: sequencing 018 on a handoff claim without reading the kickoff's EVIDENCE gate; citing the unapproved product bible as authority; framing asks as "own PR", which produced six record-only PRs; a read-only `git status` that left a `.git/index.lock` (removed). Don't run git commands in the founder's repo from Cowork's device shell.
- **Merges happen only on the founder's explicit word, per PR.** Deploys run only through `scripts/deploy_pages.sh`, and every report quotes `/version.json`. Merging changes nothing a visitor sees; only a deploy does.
- **Every probe needs a demonstrated failing half** (method notes 21–25). For HEAD reads use `curl -I`, never `-X HEAD`. `cf-cache-status` is the zone CDN's verdict. Read `x-openbed-edge-cache` only when both `cf-ray` colo codes match; a split pair means rerun, not a result, with up to five pairs.
- **Founder shell notes:** paste commands, never output (output pasted into zsh creates junk files). If a host "can't resolve", flush the DNS cache with `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`; the Mac now also uses 1.1.1.1. Any untracked file in the repo blocks the deploy wrapper.
- **Stale-while-revalidate is not honoured by the Function's cache** (DOCUMENTED). The real end-to-end freshness bound is about 120 s, per -43.

---

## Canonical docs

- `Sprint Kickoffs/decision-2026-09-14-public-private-split.md` — every ruling through -45, the method notes, the provisional ledger and the NDPA processor table. Read before revisiting any decision.
- `Sprint Kickoffs/sprint-kickoff-a1-accumulation-boundary-2026-09-17.md` — Bundle 2 and 018's task list and blast radius, plus the EVIDENCE gate text.
- `docs/runbook-cloudflare-pages-beds-json.md` — founder hosted steps: deploy, read-backs 5/5b/6/7/8, the rate-limit rule, §4b go-live trigger.
- `docs/runbook-supabase-project-creation.md` — the hosted Supabase runbook; step 8 carries the append-only probe's rollback warning.
- `scripts/deploy_pages.sh`, `scripts/stamp_build.mjs` — the deploy guard and commit stamp.
- `scripts/provision_ward_account.mjs` — carries the STOP block (first-row trigger).
- `packages/snapshot/src/serve.ts`, `apps/public-dashboard/functions/beds.json.ts` — serving and the edge-cache marker.
- `apps/public-dashboard/src/main.ts` — outage and empty states (no stub).
- `docs/handoff-2026-09-21-deployed-and-reported.md` — the prior link in the chain.
- **Cowork Project doc `claude/product-bible-draft.md`** — draft product bible, **awaiting founder approval**. Context only, never authority, until it's committed under its own ruling.

---

## Open items / blockers

**Blocker on the build path:** none. 018 is unblocked.

**Must be fixed before the first hosted facility or ward_account row:** A3 (`(unknown facility)` beside a real count; options recorded, not decided); B2 (ward console defaults `offering ?? 'NOT_OFFERED'`, `version ?? 0`, which must be refused, not defaulted) together with the publish-screen raw-text item; the missing facility-creation runbook step; a possible mechanical provisioning guard (shape recorded; it must test the host first).

**Open items with triggers:** the `.rpc(` lint widening (first call site); the F3 ESLint guard (next build/lint config change); the `s-maxage` ↔ `pollCadenceSeconds` coupling (next change to either); the Docker Hub rate limit in stack jobs (next such failure, fixed in that PR); config_drift not guarding the auth hook block (next `config.toml` auth change); the codec.ts tautological legs (next codec change); step 4 gating step 6 with no remaining technical reason (-43); Gate 2 revisitable at about 120 s (-43); the regex readers (after facility one); Finding D (now in Bundle 3); `robots.txt` / `noindex` (facility one).

**Founder-side, not blocking 018:**
- The SPF fix: there are two `v=spf1` TXT records on the apex. Confirm the `+a +mx +include:re…` one is unused, then delete it and keep Proton's. Recheck DKIM in Proton.
- Add `www.openbed.ng` as a Pages custom domain.
- Review and approve the product bible draft.
- The WAF rate-limit rule (runbook step 7; its cutover gate is now met).
- Auth Site URL is still `localhost:3000`, and custom SMTP is needed; both before Bundle 3's first real use.
- The facility agreement.
