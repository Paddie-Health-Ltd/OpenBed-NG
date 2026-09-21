# Sprint Kickoff — Make A1 true: the accumulation boundary

Date: 2026-09-17 | Prepared by: Cowork sprint-push
Reviewed by: cto-persona, clco-persona, staff-engineer, platform-sre, qa-specialist
Base: `main` at `262ad61`. Migrations frozen at 017; `frozen_migrations` placeholder at 018.

_Base corrected 2026-09-17 (R-2026-09-17-11 A1, R-2026-09-17-12): this document was written against `feefcf3`, which #36 superseded before the sprint started. A base SHA is a citation, and method note 11's rule about self-editing documents applies to the repository's own head as much as to a line number._

---

## Division of responsibilities

Claude Code implements, tests and ships the code in each bundle below. Cowork has
done the scoping, bundling and specialist review; rulings R-2026-09-17-03 through
-09 and the four measured probes behind them are settled inputs, not open
questions. The founder holds the hosted apply, the Cloudflare account, and the one
item in *Open decisions needing your call*.

**Read this before starting.** One item is not Claude Code's to decide and is
marked. Everything else is a logged judgment call with its reasoning stated — argue
with it deliberately rather than drifting past it.

---

## Why this sprint exists, in one paragraph

A1 ruled that public reads come from a static snapshot, not PostgREST. **That was
never made true.** The snapshot generator exists (016) and is scheduled (017), but
`public.snapshot_current` is service_role-only and nothing publishes it anywhere, so
there is no static document and no edge. Meanwhile two decisions taken *before* A1
were never revisited: v1:142's Realtime publication of the three mirrors, and
v1:258's anon `SELECT` grants on them. Between them they are the public read path
today, and both concede what the design forbids. Measured on 2026-09-17: a bare anon
`select=*` on `ward_public` returns every row in one request, offset paging works so
`max_rows = 1000` is a page size rather than a cap, nothing throttles any of it, and
an anon Realtime subscriber receives every write with full records at zero request
cost. `M/016:90-93` already states the governing principle — a second serving path
around the CDN, with no `s-maxage`, disagreeing with the edge on freshness, is a
defect — and applies it to `snapshot_current` only. **This sprint applies it to the
tables it was not applied to, and builds the serving path that makes doing so safe.**

---

## Sprint scope

**In:** the public read path, end to end. A Cloudflare Pages Function serving the
snapshot with cache headers and a rate limit; migration 018 closing the direct read
and push surfaces; and the two sensors (`/api/health`, `/status`) that seven
enumeration items have been blocked on for want of a host.

**Out, explicitly:** the Bundle 4 dashboard UI (tiles, geolocation, interstitial,
emergency strip, service worker) — this sprint builds the document the dashboard will
fetch, not the dashboard.

> **SCOPING DRIFT, CORRECTED 2026-09-20 (R-2026-09-20-29 E4).** That sentence was
> written on the premise that nothing consumes `/beds.json` yet. **The DEPLOYED
> dashboard fetches it** — code that reached production without review, the same
> family as the direct-upload finding. So the consuming surface exists now, and with
> it the rule that **any public surface rendering bed data must distinguish "no
> facilities onboarded" from "no beds available", asserted at the rendered surface**.
> What stays out of this sprint is the rest of the Bundle 4 UI. The B5 alert sweep, outbox and dispatcher. The `scripts/`
survey, which follows this sprint. Anything touching `ward_status_event` retention.

**Honest sizing:** bundles 1 and 2 are the accumulation boundary and **must ship in
that order** — closing the direct read before the serving path exists leaves no
public read path at all. Bundle 3 is independent once the host exists and can ship
any time after Bundle 1. Two of the three involve a credential or a grant change on
the security boundary that gates onboarding; neither should be compressed.

---

## Bundles

### Bundle 1: The serving leg — `/beds.json` at the edge

**Why bundled together:** the Function, the credential it holds, the guard that
proves the credential never reaches a browser, and the assertion on the document it
serves are one artifact. Shipping the Function without the guard extension ships the
first server-side credential in this project's history with no scanner aimed at it;
shipping the payload assertions without the Function leaves them with nothing to
assert. The rate limit is here rather than in its own bundle because it protects this
route and its scope is defined by this route's shape.

**Tasks:**

- [ ] Cloudflare Pages Function serving `GET /beds.json` from
      `public.snapshot_current`, newest `v`, with
      `Cache-Control: public, s-maxage=30, stale-while-revalidate=300` (v1:235,
      and `snapshot-shape.json`'s `pollCadenceSeconds` is written against the same 30).
- [ ] **The Function holds the service_role key in its environment and nothing
      else does.** Never a `VITE_`-prefixed or otherwise client-exposed variable.
      `snapshot_current` is service_role-only by grant and by its one RLS policy
      (`M/016:145-190`); that decision is not reopened here.
- [ ] Extend `scripts/lint_no_service_role_in_bundle.sh` and
      `scripts/scan_bundle_credentials.mjs` to cover the Pages Functions output as
      well as `apps/**/dist/**`, asserting the key appears in neither the client
      bundle nor anything shipped to a browser. **Plant both ways** and prove the
      extension reddens on a planted key, per house convention.
- [ ] Edge rate limit on the served route — **a founder-configured zone-level WAF
      rate-limiting rule on `openbed.ng`, recorded OWED as the rate-limit step of the
      Bundle 1 runbook, gated by its custom-domain cutover step. Not in code, and nothing is added to the wrangler config.**
      **[CORRECTED 2026-09-17 (R-2026-09-17-12) before this document was first
      committed: this task was scoped expecting the limit to live in the wrangler
      config via Cloudflare's Rate Limiting binding. That binding is a WORKERS
      feature — it is absent from the eleven bindings the Pages Functions
      wrangler-configuration page enumerates, and the binding's own page does not
      mention Pages at all. Checked against the platform actually shipping, which is
      method note 14.]**
      Per method note 12 the runbook step records **what the rule covers and what it
      does not**, all four:
      it covers HTTP requests to `/beds.json` on the `openbed.ng` zone;
      it does **not** see the Supabase Realtime websocket, which never transits this
      zone and is a different origin entirely;
      its counters are **per Cloudflare location, not global**;
      and it does **not** bound accumulation — paging within the limit still yields a
      series over time. **The boundary is Bundle 2's revoke; this is a throttle.**
- [ ] Assert the SERVED DOCUMENT, not only the table: its column lists equal
      `snapshot-shape.json`'s `wardColumns` and `facilityColumns` exactly, and
      contain none of `rls_anon_column_containment.test.ts`'s `FORBIDDEN_COLUMNS`.
      This is the containment control relocated to the surface anon will actually
      receive; see Bundle 2's blast radius.
- [ ] Verify the cache headers are actually served from the edge, not merely set in
      code — a header asserted in a unit test and stripped by the platform is the
      "green light examining nothing" shape.

**Specialist input incorporated:** *cto-persona* rejected the alternative of pushing
the snapshot to R2/KV from the database: it needs egress from Postgres (`pg_net`),
adds a writer and a bucket to the surface, and buys nothing over a cached read the
edge already collapses to roughly one origin read per `s-maxage`. **[CORRECTED 2026-09-21 (R-2026-09-21-43): the collapse is PER DATA CENTRE, not global -- the Cache API does not use Tiered Cache. MEASURED that day: snapshot reads reached this project from SIX colos in 24 hours (LOS, CDG, PER, LIS, MRS, DUB). So it is one origin read per `s-maxage` PER LOCATION. `packages/snapshot/src/serve.ts` already said this; this line did not. **The rejection still stands** -- six reads per 30 seconds is still nothing, and R2/KV would not have been per-location anyway.]** *platform-sre*
required the last task — the header check must observe the response, because the
whole cost argument in A1 rests on the edge actually caching. *clco-persona* raised
no new processor: Cloudflare already serves the dashboard and is already on the open
s.29/s.41 item, which is why this host was chosen (R-2026-09-17-05).

**Safety/quality notes:** this is the first server-side credential in the project.
`v1:368` names reaching for the service-role key and landing it in a client-imported
module or a `NEXT_PUBLIC_`/`VITE_` variable as one of the three predicted assistant
failure modes, and in a public repository it is a total compromise of a credential
that cannot be rotated quietly. The guard extension is not a nice-to-have in this
bundle; it is the reason the bundle is safe to ship.

**Blast radius:** the extended credential guard now scans a second tree — confirm it
still reddens on the existing `apps/**/dist/**` plant, so the extension has not
loosened the original. `apps/public-dashboard/src/main.ts` is the Bundle 1 stub whose
stated purpose is giving the dist greps a real bundle to scan; it is untouched here
and still serves that purpose. Nothing consumes `/beds.json` yet — the dashboard
fetch arrives in Bundle 4 — so this bundle adds a surface without changing a caller.

**Definition of done:** a request to `/beds.json` returns the current snapshot with
the specified headers, observed from the edge and not only from the origin; a second
request inside `s-maxage` is served by the cache; the planted service-role key
reddens the extended guard in both trees; the served document's column lists match
the frozen fixture exactly and carry no forbidden column; **the rate limit is
recorded OWED as the runbook's rate-limit step with its scope stated — demonstration
is founder-side.**

**Who performs each criterion, and on which side of the custom domain (method note
13; split by R-2026-09-18-16 C3).** The Cache API works only on a custom domain and
the rate-limiting rule is zone-level, so two criteria cannot be met until `openbed.ng`
is live on the Pages project. R-2026-09-17-12 wrote them as independent of that; they
are not. **[CORRECTED 2026-09-21 (R-2026-09-21-42): the ORDERING stands and the
REASON given for half of it does not. "The Cache API works only on a custom domain"
is a `*.workers.dev` fact about Workers; Cloudflare's Cache API reference says
"Workers deployed to custom domains have access to functional `cache` operations. So
do Pages functions, whether attached to custom domains or `*.pages.dev` domains."
The cache criterion is still owed on `openbed.ng` — because R-2026-09-20-28 B's
EVIDENCE gate is worded that way, not because the mechanism is absent elsewhere. The
rate-limit half is unaffected: a zone WAF rule really is zone-level.]**

- **Demonstrable before the domain, by the implementer:** the Function serves the
  current snapshot; the served document's column lists match the frozen fixture and
  carry no forbidden column; the planted service-role key reddens the extended guard
  in both trees; and the extension still reddens on the existing `apps/**/dist/**`
  plant. Plus a local `wrangler pages dev` proof of the route, the document and the
  headers **as set in code**.
- **OWED to the founder, in the runbook, in this order:** create the Pages project;
  set the service-role key in the Function environment; deploy; **the custom-domain
  cutover, which GATES the next three**; observe the headers from the edge; prove a
  cache hit inside `s-maxage`; configure the rate-limiting rule.
- **The cache criterion is OWED and UNMET until it is observed on the custom domain**
  by the runbook's cache-hit step. It is never marked met from a `*.pages.dev`
  preview, ~~where the Cache API has no effect~~, and **never marked met from the local
  Miniflare run either.** That run is evidence that the cache code path EXECUTES —
  the Function reads and writes the cache as written. It is NOT evidence for the
  criterion, because it simulates the very thing the criterion exists to observe:
  a hit served by Cloudflare's edge on the real domain (R-2026-09-18-17 B1). **[CORRECTED
  2026-09-21 (R-2026-09-21-42): the struck clause was false — Pages Functions have
  functional cache operations on `*.pages.dev` too. The conclusion is unchanged, and
  now rests on the gate's wording rather than on an absent mechanism. A SECOND and
  larger correction belongs here: until 2026-09-21 the runbook's cache-hit step read
  `cf-cache-status`, which reports the ZONE CDN's cache and not this Function's, and
  returns `DYNAMIC` for this URL whether the Function's cache hit or missed. **The
  criterion had no observable that could take two values**, so it could not have been
  observed anywhere, on any domain. It is now read from `x-openbed-edge-cache`, which
  `packages/snapshot/src/serve.ts` sets from what it actually did.]**

**Bundle 1 merges with the founder's seven OWED, and Bundle 2 starts on the
deployment report — the edge-headers and cache-hit steps, on the custom domain —
not on this merge** (R-2026-09-17-11 C).

---

### Bundle 2: Migration 018 — closing the direct read and push surfaces

**Why bundled together:** the anon `SELECT` grants and the Realtime publication
membership are the same root — decisions taken before A1 and never revisited — and
they are the same property: what an anonymous holder of the published key may address
directly. Splitting them ships half a boundary, which is precisely the failure C2
exposed when a rate limit "enforced at the edge" was believed to cover a surface the
edge cannot see. **Depends on Bundle 1**; do not start it before `/beds.json` serves.

**Tasks:**

- [ ] **Migration 018.** Remove `public.facility_public`, `public.ward_public` and
      `public.lga_rollup` from the `supabase_realtime` publication, and revoke
      `SELECT` on all three from `anon` and `authenticated`. 001–017 are frozen, so
      this is a new migration with its `.down.sql`, not an edit.
      **ANSWERED 2026-09-19: the founder's decision is REVOKE** (R-2026-09-19-24 B1).
      **TWO GATES, and only one is lifted** (R-2026-09-20-28 B): the DECISION gate is
      discharged; the EVIDENCE gate is not. 018 removes the direct read path on the
      premise that the served path works, and that premise is NOT CONFIRMED while the
      cache criterion is OWED and the custom-domain cutover has not happened. **018 is
      not written until the founder's deployment report lands** — and under direct
      upload that report must name which artifact, from which commit, by which
      command, because it cannot be inferred from a merge.
- [ ] **Re-point the three `authenticated` probes, inside this change**
      (R-2026-09-19-24 B4): `tests/e2e/golden-path.test.ts` line 108 and
      `tests/db/auth_refresh_live.test.ts` lines 148 and 239 prove a token works by
      reading `ward_public` over HTTP, which this migration revokes. They move to a
      relation an `authenticated` ward session still reads, such as
      `rpc/my_facility_wards`. Not after the migration: in it.
- [ ] **The hosted exposed-schemas hand-check, founder-side** (R-2026-09-20-27 D2).
      It bears on exactly this bundle's property — what an anonymous holder of the
      published key may address — so it belongs here rather than floating. The
      repository cannot assert a hosted dashboard setting
      (`.claude/rules/test-conventions.md` section 4). Confirm `app` is absent from
      the exposed list; that also disposes of Supabase's advisor report of RLS
      disabled on 16 `app.*` tables, which assumes `app` is PostgREST-exposed.
- [ ] **The hosted apply is where the boundary closes** (R-2026-09-19-24 B5).
      Founder-side OWED, in `docs/runbook-supabase-project-creation.md`'s apply step.
      Until it is recorded, the history-is-private commitment is not available,
      whatever this PR's state.
- [ ] Update `packages/fixtures/public-relations.json`. Its `mirrors` list is the
      client `.from()` allowlist read by `scripts/lint_from_allowlist.sh` AND the
      expected publication membership asserted by `tests/db/config_drift.test.ts`.
      **Those two meanings come apart under this change** and the file must stop
      serving both from one key, or one of them will be silently wrong.
- [ ] Restate `config_drift.test.ts`'s publication assertion. It currently asserts
      membership *equals* the three mirrors — a guard built to catch drift of exactly
      this kind, so it is reasoned about and restated, never deleted around.
- [ ] Relocate, do not delete, the containment control.
      `rls_anon_column_containment.test.ts` asserts against `information_schema` for
      relations its docstring calls "what anon actually reads". After this migration
      that premise is false. The property moves to the served payload (Bundle 1); this
      test's *stated subject* is corrected to the catalogue behind the generator, and
      its docstring says so rather than continuing to claim an anon read surface.
- [ ] `rls_anon_reachability.test.ts` and `rls_anon_writes_rejected.test.ts` get
      **stronger**, not vacuous — anon now reaches nothing. Extend them to assert the
      new denial explicitly rather than leaving it implied.
- [ ] Amend v1:142 and v1:258 in the kickoff with `[SWEEP]`-style markers: both are
      live rules whose reason A1 removed. Per method note 11, cite by section name.

**Specialist input incorporated:** *cto-persona* supplied the ordering constraint —
Bundle 1 first, because the interval between closing the direct path and opening the
served one is an interval with no public read path at all. *staff-engineer* found the
`public-relations.json` double meaning; it is the highest-value item in this bundle
because both consumers would keep passing while one of them meant the wrong thing.
*qa-specialist* required the reachability and writes-rejected extensions: a negative
test that passes because the surface vanished has stopped testing the thing it names.

**Safety/quality notes:** the temptation here is to delete `config_drift`'s
publication assertion because it now fails. That assertion exists to catch publication
drift, which is the exact class of change being made, so it is restated to the new
expected membership with a comment recording why the membership changed and when.
Deleting it removes the only guard that would notice someone adding the mirrors back.

**Blast radius, and this is the bundle that has one:**
- `tests/db/config_drift.test.ts` — publication membership assertion, restated above.
- `packages/fixtures/public-relations.json` — `mirrors` serves two consumers with
  different meanings; both traced and separated.
- `scripts/lint_from_allowlist.sh` — the client `.from()` allowlist. If anon may
  address no mirror, the allowlist's correct content is a decision, not a deletion:
  confirm what client code is permitted to address after this change and say so.
- `tests/db/rls_anon_column_containment.test.ts` — premise corrected, property
  relocated to Bundle 1.
- **Three test probes move inside 018's change** (R-2026-09-19-22 A, which corrects
  this entry). It used to say `tests/e2e/golden-path.test.ts` "reads
  `public.snapshot_current` through the db harness as service_role, not over HTTP,
  so it is unaffected by the anon revoke — confirmed at `feefcf3`". That was true of
  its `snapshot_current` reads and FALSE of the file: line 108, present since
  `25238e6` (2026-09-10), proves a GoTrue token by an HTTP read of `ward_public` as
  `authenticated`. `tests/db/auth_refresh_live.test.ts` does the same at lines 148
  and 239. 018 revokes `SELECT` from `authenticated`, so all three go red unless they
  are re-pointed to a relation an `authenticated` ward session still reads, such as
  `rpc/my_facility_wards`. Line 161 expects a 401 on a tampered token, which fails
  before privileges, so it stays.
  **So 018 breaks no application code and no database object:** every function that
  references a mirror is SECURITY DEFINER, and no view depends on one. It moves three
  test probes, **and those re-points are carried inside 018's own change**
  (R-2026-09-19-23 B1).
- `apps/public-dashboard` — the Bundle 1 stub performs no fetch, so no client breaks.
- **Every route by which client code reaches the three mirrors, traced and reported
  BEFORE the revoke half is written** (R-2026-09-19-20 C2). 018 revokes from
  `authenticated` as well as `anon`, and a signed-in ward-console request runs as
  `authenticated`. As built, the console addresses `rpc/my_facility_wards` and
  `/auth/v1` and no mirror directly. Whether that RPC reaches a mirror, and under which
  role, is part of the trace. A second route has also appeared: a proxy hostname on
  the `openbed.ng` zone that forwards every path to the Supabase origin. Its status is
  held for the founder, and the console's use of it is UNVERIFIED. The revoke is not
  written until the trace covers every route.
  **TRACED, R-2026-09-19-21 C4.**
  - `public.my_facility_wards()` is SECURITY DEFINER (011, and `prosecdef` on the
    live catalogue). It reads `app.ward_account`, `app.ward_status`,
    `app.ward_status_event` and, through `app.gate_for_facility`, `app.facility_ops`,
    and none of the three mirrors. The console as built survives the revoke.
  - The public dashboard fetches nothing, and the `/beds.json` Function reads
    `public.snapshot_current` as service_role.
  - Re-run this trace if any client gains a read.
- **The console's production API origin is recorded nowhere** (R-2026-09-19-21 D).
  `VITE_SUPABASE_URL` is read and never set in the repository, so this trace covers
  the code and cannot cover which origin the deployed console is built against.
  Named, not fixed here. **Its fix (R-2026-09-19-22 D):**
  - a tracked config file whose name is not `.env*`, keyed by environment and read
    at build time;
  - a test asserting the built bundle carries the production value;
  - the bundle scanner's coverage of the console's build confirmed with a plant.

  It is its own PR, after the proxy review decides the value.
- Enumeration items #27, #78 and #79 change state; the sweep section records the
  change rather than rewriting the verdicts, which were true at `db528f8`.

**Definition of done:** anon holds no grant on any mirror and receives no Realtime
event from one, both demonstrated by a probe in the same shape as the E1/E2 runs and
with the service-role control that proves the probe can see anything at all; the
restated `config_drift` assertion reddens when a mirror is added back; the
reachability and writes-rejected suites assert the new denial; `public-relations.json`
no longer serves two meanings from one key; a fresh-database run is green.

---

### Bundle 3: The sensors — `/api/health` and `/status`

**Why bundled together:** both are Pages Functions on the host Bundle 1 stands up,
both read `app.system_heartbeat`, and both exist to answer one question — is the
scheduler alive. Seven enumeration items have been unbuildable for want of this host
and they close together or not at all. Independent of Bundle 2; needs Bundle 1.

**Tasks:**

- [ ] `/api/health`, non-200 when the heartbeat is stale or the database is
      unreachable. **Scope call, logged:** v1:294 keys this on
      `last_sweep_at > 45 minutes`, and the sweep does not exist — only the snapshot
      job does. Key it on `last_snapshot_at` and the `cron.job` / `cron.job_run_details`
      state, which is what R-2026-09-16-07 preserved of the sensor argument. The sweep
      condition arrives with B5 and the code says so.
- [ ] `/status`, token-gated. **Scope call, logged:** v1:295 specifies a long list of
      metrics, most of which measure alerts, outbox rows and deliveries that do not
      exist. Build what exists — heartbeat and its age, snapshot version and age, both
      jobs' `active` flag and last run status — and leave the rest named in the code as
      arriving with B5, rather than rendering rows that are structurally always zero.
      **A dashboard whose panels cannot move is the sensor-that-has-never-fired shape
      v1:316 names.**
- [ ] The external sensor that does not share pg_cron's failure mode, per
      R-2026-09-16-07. **PROPOSED, NOT VERIFIED (method note 3): Cloudflare Cron
      Triggers are a Workers feature and may not be available to Pages Functions.**
      Check first. If they are not, the sensor is a small separate Worker and that is
      a scope change to report, not to work around.
- [ ] Amend the seven enumeration items and their kickoff markers from "ruled, build
      not yet scoped" to their built state: #28, #30, #87, #88, #89, #92, #107.

**Specialist input incorporated:** *platform-sre* supplied both scope-downs and the
reason they are not corner-cutting: a health check keyed on a condition that can never
fire, and a status page of permanently-zero rows, are both green lights examining
nothing — the failure this project has now caught four times. *clco-persona* required
`/status` stay token-gated even while its contents are boring, because its contents
stop being boring the moment B5 lands and nobody re-gates a page that was open.

**Safety/quality notes:** the daily digest of v1:296 is deliberately NOT in this
bundle. It depends on the email adapter and the provider decision, both B5, and
building a digest with nothing to report is the same defect as the status page of
zeros. `/api/health` returning non-200 must be demonstrated by stopping the job, not
by asserting the code path — the control that fired for real on the 2026-09-17 hosted
apply did so because someone ran it.

**Blast radius:** `docs/runbook-supabase-project-creation.md` step 5's post-apply
reads and the stopped-scheduler runbook first step amended by R-2026-09-16-07 both
describe reading `cron.job` by hand; `/api/health` now does it, so the runbook gains
the endpoint as the first check and keeps the manual read as the fallback. Nothing
else consumes `app.system_heartbeat` today.

**Definition of done:** `/api/health` returns non-200 with the snapshot job stopped
and 200 with it running, both observed; `/status` renders live values behind its
token and 401s without it; the external sensor's availability is answered one way or
the other and reported; the seven items carry their built state.

---

## Open decisions needing your call — ANSWERED 2026-09-19

**There was one, and R-2026-09-17-09 D put it in your hands rather than Claude
Code's. It is answered: REVOKE** (R-2026-09-19-24 B1), decided on 2026-09-19 and
after the C4 trace returned rather than before it. **The question, its reasoning and
the objection against it are kept below rather than deleted**, because the decision is
only readable with them. What changed: Bundle 2's revoke half may be written, and
Bundle 2's start still waits on your deployment report.

**Revoking anon `SELECT` on the three mirrors (Bundle 2).** Cowork's recommendation
is to revoke, and the reasoning is that it is not a new idea but `M/016:90-93`'s own
principle applied consistently: that comment refuses an anon-readable
`snapshot_current` because it would be "a second serving path around the CDN, with no
`s-maxage`, disagreeing with the edge on freshness". Direct anon reads of the mirrors
are exactly that, and C1 measured what they concede. Against it: v1:258 keeps the
grants deliberately as defence in depth, on the reasoning that "a future contributor
may add a direct read" — the grants are a tripwire as much as a permission, and
revoking removes the surface the column-containment control was aimed at. Cowork's
answer to that objection is Bundle 1's relocation of the control to the served
document, which is where the public surface will actually be; but the objection is
real and **the decision was yours; you took it on 2026-09-19 and it is REVOKE.**
The technical cost was then measured at zero: `my_facility_wards` is SECURITY
DEFINER and reads no mirror, every function touching one is SECURITY DEFINER, no
view depends on one, and no client code reads one. What it costs instead is three
test probes, re-pointed inside 018's own change.

**The alternative, kept for the reader who asks what declining would have meant:
If you decline the revoke, Bundle 2 ships the
publication half alone and the rate limit in Bundle 1 becomes the whole of the pull
defence — say so explicitly rather than letting it become the default by silence,
because a rate limit is a throttle and not a boundary.**

Everything else proceeded per operating defaults, with the two `/api/health` and
`/status` scope-downs and the credential-handling call logged in their bundles.

---

## Fundamental — carries forward

> **Any failure must be foundationally resolved.** Fix the root cause, not the
> symptom. Before calling a fix done, understand everything it touches or could
> touch — other bundles, shared modules, downstream consumers — so the fix doesn't
> quietly create a new problem elsewhere. Resolve issues in the same pass, in place;
> don't file a ticket for something that can be fixed now.

This sprint is that rule applied to a root named two rulings before it was acted on.
R-2026-09-17-06 identified that 013 published the mirrors on a rationale A1 had
already reversed; R-09 found the anon grants were the same story, and that scoping a
sprint around the two symptoms would have missed it a second time. Bundles 1 and 2
are one fix, in one order, for one root.

## Supporting docs

None as separate files. Every persona's input was a handful of points that belong in
the bundle they bear on, and inventing thin documents around them would bury the parts
Claude Code needs. The evidence base is already committed: the four probes and their
results are in the decision record under R-2026-09-17-07 and -08, and the enumeration
items are in `Sprint Kickoffs/sweep-2026-09-17-v1-enumeration.md`.
