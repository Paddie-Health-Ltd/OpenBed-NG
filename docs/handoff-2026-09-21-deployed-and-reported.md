# Handoff — OpenBed-NG: deployed, reported, and back to the sprint — 2026-09-21

Prepared by: Cowork handoff. Authored into `docs/` per R-2026-09-18-13; it lands
with the next PR that touches the repository (the cache-fix PR).

---

## Division of responsibilities

Claude Code implements, tests, ships and **assigns every ruling number on landing**;
Cowork issues rulings under provisional ids (`R-PROVISIONAL-<date>-<letter>`),
scopes and reviews; the founder holds Cloudflare, the hosted applies, deploys (via
`scripts/deploy_pages.sh`) and the facility-side decisions.

---

## Where things stand

**`main` is `50c638e`** (#53 merged). Rulings landed in the record run through
**R-2026-09-20-33**, as reported by Claude Code.

**Deployed and reported — the report is complete.** Founder deployed `50c638e` with
`bash scripts/deploy_pages.sh --branch main` to
`https://d9b7669e.openbed-public-dashboard.pages.dev`. Read back from the deployed site
by the founder, 2026-09-20:

- `/version.json` — commit `50c638efe0daca5cad1ffd82d10fccb2eacf4d89`, `dirty: false`.
  Clause 4 is a quotation, not an attestation.
- The empty state reads: *"No facility has joined OpenBed yet, so there is nothing to
  show. This is NOT a report that beds are unavailable…"* — the empty-city hazard is
  closed.
- `GET /beds.json` — `application/json`, `cache-control: public, s-maxage=30,
  stale-while-revalidate=300`, `x-robots-tag: noindex, nofollow`, body
  `{"v":…,"wards":[],"facilities":…}`.
- `/robots.txt` — real robots content (`User-agent: *` / `Disallow: /`), not the SPA
  fallback.
- **Finding:** a `HEAD /beds.json` falls past the Function to the SPA fallback
  (`text/html`, weaker headers). Ruled in W; fix in flight.

**Consequences:** the cutover hold is lifted, and **Bundle 2's gate (the deployment
report, R-2026-09-17-11 C) is discharged.**

**In flight with Claude Code:** branch `cache-try-and-head-parity`, uncommitted edits
to `serve.ts`, `beds.json.ts`, the runbook and `beds_json_served.test.ts` — the cache
fix. Status as last seen by Cowork: work in progress, not yet a PR. Not verified done.

**Four provisional rulings exist only in transcript / resume memory** — T, U, V, W
(2026-09-20/21). By the batching rule (T A4) they land inside the cache-fix PR, with a
hard deadline of **2026-09-27**. Until then they are the method-note-15 defect, bounded
by date. Their substance:

- **T** — stop opening a record PR per ruling (batch weekly or with the governing code
  change); **no new scope until facility one is onboarded**; findings become open items,
  not work.
- **U** — the path is **cache fix → Bundle 2**, nothing between. The
  `public-relations.json` split moves *into* Bundle 2 as its first task. Everything else
  is an open item with a named trigger (see Open items).
- **V** — the deployment report accepted; cutover hold lifts; Bundle 2 unblocked; the
  HEAD divergence folded into the cache fix; `robots.txt` `Disallow: /` revisited at
  facility one.
- **W** — the HEAD fix is a **GET-normalised cache key** (key on an explicit GET Request,
  `match` with `ignoreMethod: true`, export `onRequestHead`). Cowork's "two lines" claim
  failed: `cache.put` throws on non-GET. HEAD responses carry headers only. The runbook's
  line-403 `curl -sSI` (a HEAD) becomes a GET header read, **plus** a read-back asserting
  GET and HEAD return the same content-type and x-robots-tag — the probe is the root fix.

**Stray junk in the repo root:** five **zero-byte** untracked files — `node`, `npm`,
`openbed-ng@0.0.0`, `openbg@0.0.0`, `wrangler` — created when deploy output was pasted
back into zsh (`> name` creates a file). Harmless. Delete them; never commit them.

---

## What's next — in order

1. **The cache-fix PR** (in flight). Carries: S's B4–B6 (one `try` around the cache
   calls **only** — widening it would convert real failures into cache misses; plants
   proving an origin failure is still tagged), W's HEAD fix and its plants, W's runbook
   line-403 fix and both-methods read-back, the correction to the refusal list in
   `serve.ts`, **and the record entries for T, U, V, W** (numbers assigned by Claude
   Code on landing), plus this handoff doc. First because it is in flight and it closes
   the rulings-in-transcript interval.
2. **Bundle 2**, per the A1 kickoff, in this order within it:
   a. the `public-relations.json` split (two keys, identical content — a no-op refactor
      that removes the coincidence before 018 makes the meanings diverge);
   b. **migration 018**: remove the three mirrors from `supabase_realtime`, **revoke
      `SELECT` from `anon` and `authenticated`** (founder decided REVOKE, R-2026-09-19-24),
      with `.down.sql`; re-point `golden-path.test.ts:108` and
      `auth_refresh_live.test.ts:148,:239` inside the same change; restate — never
      delete — `config_drift`'s publication assertion; correct
      `rls_anon_column_containment`'s stated subject; make reachability and
      writes-rejected tests *stronger*; `[SWEEP]` markers on v1:142 and v1:258.
   Why second: its gate is discharged and it is what actually closes the accumulation
   boundary.
3. **Founder: hosted apply of 018.** The boundary closes **on the hosted apply, not on
   merge**. Until that apply is recorded, the facility agreement cannot carry a
   history-is-private commitment.
4. **The infrastructure inventory and review — before facility one onboards.** A gate,
   not a deferral (see Open items).
5. Facility-one onboarding, founder-side.

---

## Fundamental — carries forward

> **Any failure must be foundationally resolved.** Fix the root cause, not the
> symptom. Before calling a fix done, understand everything it touches or could touch —
> other bundles, shared modules, downstream consumers — so the fix doesn't quietly
> create a new problem elsewhere. Resolve issues in the same pass, in place — don't file
> a ticket for something that can be fixed now.

Deliberate exceptions, with reasons: every item under *Open items* is deferred by
ruling T/U (no new scope until facility one) with a named trigger — not silently.

---

## How this build is run now — read before issuing anything

- **Cowork never assigns ruling numbers.** Blocks use `R-PROVISIONAL-<date>-<letter>`
  (skip letters confusable in an id: I, O). Claude Code reads the record's actual last,
  assigns, reports back, and keeps the **provisional ledger** in the record. Last letter
  issued: **W**.
- **Paste ruling blocks in their own turn.** Three blocks were lost (void -18, E, G), all
  in turns that mixed conversation with a block.
- **Cowork's factual claims are provisional**, whatever their subject: each carries its
  evidence kind (DOCUMENTED-availability / DOCUMENTED-guidance / MEASURED / INFERRED /
  NOT CONFIRMED); "confirmed at <ref>" names the check run and its result; a NOT
  CONFIRMED claim names what would close it. Claude Code verifies before recording.
- **The honest pattern, 2026-09-17 → 21:** Cowork's property, ordering and scoping
  rulings held; its mechanism claims, citations, counts and assertions about system state
  repeatedly failed and were caught by Claude Code. Read state; don't assert it.
- **Deploys** run only through `scripts/deploy_pages.sh`; a report quotes
  `/version.json`. `dirty: true` there means the wrapper was **bypassed**. Read-backs use
  **GET**, not `curl -I`.

---

## Canonical docs

- `Sprint Kickoffs/decision-2026-09-14-public-private-split.md` — the single home for
  every ruling (through R-2026-09-20-33), the method notes, the provisional ledger and
  the NDPA processor table. Read before revisiting any decision.
- `Sprint Kickoffs/sprint-kickoff-a1-accumulation-boundary-2026-09-17.md` — the sprint:
  Bundle 2's full task list and blast radius, the 018 decision with its reasoning.
- `docs/runbook-cloudflare-pages-beds-json.md` — the founder's ordered hosted steps:
  deploy, read-backs, custom-domain cutover, rate-limit rule (Free-plan values recorded),
  push-protection coverage check.
- `docs/runbook-supabase-project-creation.md` — hosted Supabase runbook; the shape every
  founder step follows.
- `docs/handoff-2026-09-20-pages-direct-upload.md` — why deploys are direct-upload and
  what that decoupled.
- `docs/handoff-2026-09-17-v1-sweep-and-the-accumulation-boundary.md` — the prior link
  in the chain; the accumulation boundary as the root.
- `scripts/deploy_pages.sh`, `scripts/stamp_build.mjs` — the deploy guard and the
  commit stamp.
- `packages/snapshot/src/serve.ts`, `apps/public-dashboard/functions/beds.json.ts` — the
  serving code the cache fix touches.
- `supabase-proxy/README.md` — the proxy landed marked as *under review, not endorsed*.
- `.claude/rules/code-pipeline.md` — house rules (identifiers read not composed; branch
  deletion only after `MERGED` reads back; merge-order rule).

---

## Open items / blockers

**Open items with triggers — not work until the trigger fires:**
- **Infrastructure inventory and review → BEFORE facility one onboards.** Covers
  `supabase-proxy/` (full passthrough to auth, storage and functions, in front of the
  ward console), the stray `openbedng` Worker, and the `openbed-ward-console` Pages
  project of unknown status. Starts from D0's criterion (remove by default unless it buys
  something the direct origin doesn't), and resolves the recorded contradiction: the
  founder's addendum says `api.openbed.ng` is deployed; `dig` returned no record.
- Two regex readers (`assertedByScript`'s script mapping; `leg_coverage.test.ts`
  reading its own assertions), **plus** re-checking tests whose shape was a concession to
  the literal matcher → first work after facility one.
- Finding D (the repository cannot state the production API address; fix is a tracked
  non-`.env` config asserted in the built bundle) → with the next change touching build
  config.
- Publish screen echoes raw server text to a ward user on an unrecognised status →
  must be fixed before facility one.
- `robots.txt` `Disallow: /` and `noindex` → revisit at facility one.

**Founder-side, not blocking Bundle 2:** custom-domain cutover (hold lifted); the WAF
rate-limit rule on `/beds.json` (Free: one rule per zone, IP-keyed, 10 s period —
a throttle, not a boundary); confirm from GitHub's pattern list whether push protection
covers `sb_secret_` and the legacy service-role JWT (never test by pushing a key);
complete the NDPA inventory row for Cloudflare as API sub-processor from the review's
findings; B2 custom SMTP / s.29; Auth Site URL still `localhost:3000`; the facility
agreement.

**Blocker:** none on the build path. T, U, V, W must land by 2026-09-27.
