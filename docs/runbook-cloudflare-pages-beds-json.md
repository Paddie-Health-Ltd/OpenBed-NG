# Runbook — `/beds.json` on Cloudflare Pages (A1 sprint, Bundle 1)

**Every step here is OWED, and its owner is the founder.** The implementer has no
Cloudflare access and is issued no deploy token (R-2026-09-17-11 B4, declined
deliberately). Bundle 1 merges with these seven steps open. **Bundle 2 — migration
018 — starts on your report of steps 5 and 6, not on Bundle 1's merge**
(R-2026-09-17-11 C): the ordering exists so there is never an interval with no
public read path, and merging code does not open one.

**Steps 6 and 7 are GATED by step 4, the custom-domain cutover** (R-2026-09-18-16
C2, amending R-2026-09-17-12, which wrote them as independent). The Cache API works
only on a custom domain, and the WAF rate-limiting rule is zone-level, so both need
`openbed.ng` live on the Pages project first. Neither may be marked met from a
`*.pages.dev` URL.

**What was proved before this runbook, and what was not.** Locally, under
`wrangler pages dev` against the local Supabase stack (2026-09-18): the route
`/beds.json` resolves; it returns 200 with
`Cache-Control: public, s-maxage=30, stale-while-revalidate=300` and the fixture's
envelope; it works with both key families (the legacy JWT and a new `sb_secret_`
key); and a second request inside `s-maxage` was served from the local cache
simulation after the origin had moved on. **None of that proves the edge.** A
header set in code can be stripped by the platform, and a local cache is a
simulation. **The cache path cannot be exercised on Cloudflare at all before the
custom domain exists** — on `*.pages.dev` the Cache API has no effect by design.
The local simulation is evidence that the cache code path EXECUTES; it is **not**
evidence for the cache criterion, which stays OWED and UNMET until step 6 observes
a hit on the custom domain (R-2026-09-18-17 B1). Steps 5 and 6 are the only proof
of the edge, and they are yours.

Run every block **in bash or with `zsh -f`**, and paste one block at a time. The
blocks hold commands only; default interactive zsh does not treat `#` as a comment.

**One exception to how these blocks were verified, stated rather than left implied.**
Every fence here is verified by pasting it, except the deploy step's: pasting it
**performs a deployment** to the live project. It was verified by reading instead —
the same reasoning the deploy step itself gives for not testing the `--branch`
question against this project, since that project's deploy history is evidence in an
open question. A fence with a side effect on production is not made safe by being
short.

---

## 1. The Pages project — create it, or confirm the one that exists

**THIS PROJECT IS DIRECT-UPLOAD, NOT GIT-CONNECTED. REPORTED by the founder,
2026-09-20:** the dashboard offers no **Retry deployment** button, and the project
was created by `wrangler pages project create` rather than by connecting a
repository. Not independently verified from inside the repository, and it cannot be
— nothing here can read a Cloudflare project's settings.

**What follows from it, and it is the reason this section was rewritten: pushing to
`main` does not deploy anything.** Until 2026-09-20 this runbook said it did. A
merge changes the repository and leaves the running site untouched, silently. Every
deployment is an explicit upload from a working tree — the deploy step below.

- **Project name** `openbed-public-dashboard` — it matches `name` in
  `apps/public-dashboard/wrangler.toml`.
- **Root directory** and **Build output directory** are git-build settings and do
  **not** exist for a direct upload. Their job is done instead by
  `pages_build_output_dir` in `apps/public-dashboard/wrangler.toml`, and by the
  directory you run `wrangler` from — see the deploy step.
- **Production branch** — this one still exists, and it decides which deployments
  read the **Production** environment variables. It is the value the deploy step's
  `--branch` must match. **Read it rather than assuming `main`:**
  `npx wrangler pages project list` prints it.

**Symptom that the Function is not in the upload:** `/beds.json` answers **200 with
`content-type: text/html`** — the SPA's `index.html`, served as a fallback because
no Function matched. It looks like success. The edge-headers step's content-type
check is what catches it; this exact fallback was observed locally for an unrouted
path. Under direct upload the cause is that `wrangler` ran from the wrong directory,
so `functions/` was never discovered.

**Do not add a zone Cache Rule for `/beds.json`.** The Function caches its own
response (see the cache-hit step). A zone rule would serve a cached response before the Function
runs, and Cloudflare warns that caching in front of Pages Functions can break them.

## 2. The Function's environment — two variables, Production

In the Pages project's environment-variable settings, for the **Production** environment (the menu label is Cloudflare's and is not recorded here, because it was not observed):

- `SUPABASE_URL` — the hosted API URL, `https://klrlpxysjsjpdkeqdhvl.supabase.co`.
  Plain text.
- `SUPABASE_SERVICE_ROLE_KEY` — **the hosted secret key, `sb_secret_…`**, added as
  an **encrypted secret**. This project's legacy JWT keys are disabled, so the new
  secret key is the only service credential.

**The two key families are sent differently, and getting it wrong looks like a
permissions problem rather than an auth one.** The Function chooses by the key's
prefix (`authHeaders` in `packages/snapshot/src/serve.ts`):

| key family | where | headers the Function sends | observed if sent the other way |
|---|---|---|---|
| new secret key, `sb_secret_…` | **hosted** (legacy keys disabled) | `apikey` only | Supabase's API-keys guide: these keys "aren't JWTs, [so] anything that tries to verify one as a JWT fails" |
| legacy JWT service key, `eyJ…` | the **local** stack | `apikey` **and** `Authorization: Bearer` | with `apikey` alone the request runs as **anon**: 401, `42501` permission denied on `snapshot_current` |

These are the implementer's findings of 2026-09-18, cited to where they were read:
the Supabase guide for the first row, and a run against the local stack for the
second. They were not re-verified by Cowork.

**Never** give either a `VITE_` prefix — Vite inlines `VITE_` variables into the
browser bundle. **Never** put either in `wrangler.toml`, which is committed.

**WHICH DEPLOYMENTS SEE THESE VARIABLES.** A variable saved under **Production** is
read only by a deployment that counts as production — under direct upload, one made
with `--branch <production branch>`. That is why the deploy step requires the flag,
and it is worth reading that step before saving anything here. Two consequences
follow. A deployment made on any other branch value reads the **Preview** set
instead, and finds these unset. And **saving a variable does not reach deployments
that already exist** — it binds when a deployment is created, so a change here needs
a fresh deploy to take effect (OBSERVED 2026-09-20: variables added to Production
while a deployment was live did not reach it; a new deploy picked them up).

**Symptoms:**
- **500, `SUPABASE_URL is not set in the Function environment`** — the same
  diagnosis as the next line. The Function checks `SUPABASE_URL` first, so this is
  the message you see when **both** are missing.
- **500, `SUPABASE_SERVICE_ROLE_KEY is not set in the Function environment`** —
  the variable is missing, or set under Preview rather than Production, or set
  after the running deployment was created.
- **502, `the origin refused the service-role credential (HTTP 401)`** — the wrong
  key was pasted, most often the **publishable** key instead of the secret one, or
  a key that has been revoked. Supabase also returns 401 for a secret key sent from
  a browser `User-Agent`; a Function should not send one, so if 401 persists with
  the right key, that is the next thing to rule out.
- **502, `the origin rejected the snapshot read (HTTP 4xx)`** — the URL is wrong.

## 3. Deploy

**This project is direct-upload (see the Pages-project step). Pushing to `main`
deploys nothing.** Build, then upload explicitly:

```bash
cd apps/public-dashboard
npx wrangler pages deploy --branch main
```

Substitute the production branch the Pages-project step told you to read; `main` is
written here because that is what this project reports, not because it is a default
to assume.

Three things about that command, each of which has its own failure if you drop it:

- **Always pass `--branch` explicitly.** It is what makes the deployment count as
  production and read the Production variables from the environment step. Pass it
  every time, including when the value looks obvious.
- **Pass no positional directory.** `apps/public-dashboard/wrangler.toml` declares
  `pages_build_output_dir`, and supplying a path as well conflicts with it.
- **Run it from `apps/public-dashboard`.** That is what lets wrangler discover
  `functions/` and compile `/beds.json` into the upload. From the repository root it
  will not, and you get the text/html fallback described in the Pages-project step.

Build first, from the repository root, so the upload carries current output:
`npm run build`. **Do not use `apps/public-dashboard/build.sh` here** — that is the
Pages *git* build command, and it exits early when nothing under
`apps/public-dashboard` or `packages/` changed, leaving no `dist` to upload.

**OBSERVED 2026-09-20**, against this project: the command above returned
`Compiled Worker successfully`, `Uploading Functions bundle`, and a deployment URL;
a request to that deployment's `/beds.json` then returned the live snapshot, which
is only possible if the Production variables bound.

> **NOT CONFIRMED — what happens if `--branch` is omitted.** Cloudflare's Wrangler
> Configuration page, under "Production and preview deployments", says the flag is
> optional and that Wrangler infers the branch from the repository you are in — but
> that sentence is conditioned on *"If you use git integration"*, and this project
> is direct-upload. **No deploy without `--branch` has been run here**, so whether
> omitting it yields a preview deployment on this project is inferred, not observed.
> The instruction above does not depend on it either way.
> **What would close this:** one deploy with `--branch` omitted against a
> **non-production** Pages project, or Cloudflare documenting the non-git case.
> **Do not run that test against this project** — its deploy history is evidence in
> the open question of what is running versus what was reviewed
> (`docs/handoff-2026-09-20-pages-direct-upload.md`).

Then, in the deployment's **Functions** tab, `/beds.json` must be listed.

**Symptom:** the Functions tab is empty or absent — wrangler was run from the wrong
directory; see the third bullet above.

## 4. Custom-domain cutover — `openbed.ng` on the Pages project. GATES steps 6 and 7

> ### HELD — DO NOT PERFORM THIS STEP YET (2026-09-20)
>
> **Cowork rescinded its own instruction.** This step was listed as the founder's
> first action on 2026-09-19. It is held because **pointing `openbed.ng` at the Pages
> project would publish the empty-city page to a real domain.**
>
> No facility has been onboarded. The served document carries `"wards":[]` and
> `"facilities":[]`, and the deployed page renders that as an empty list — nothing on
> it distinguishes *no facility has joined* from *no beds are available*. A visitor
> may be routing an ambulance, and those are different facts.
>
> **The apex timing out is currently the only thing limiting exposure.** The
> `*.pages.dev` alias is reachable, which is why the fix is not merely cosmetic.
>
> **What lifts the hold, in order:** the empty-state wording and the crawler controls
> (`robots.txt`, and `X-Robots-Tag` on `/beds.json`) merge; the founder deploys from
> that tree and reports the deployment per *Reporting back*; and only then is this
> step performed.

Attach `openbed.ng` to the Pages project as a custom domain, and confirm the
dashboard reports it active. **Nothing in steps 6 and 7 may be attempted, or marked
met, before this step is done** — the Cache API has no effect on `*.pages.dev`, and
the rate-limiting rule lives on the `openbed.ng` zone.

**Stop condition:** a request to `https://openbed.ng/beds.json` reaches the
Function — step 5's checks pass on that URL.

**Symptom:** `openbed.ng` still serves something else, or not at all — the domain
is not yet attached to this Pages project, or its DNS has not moved. Steps 6 and 7
wait.

## 5. Observe the headers FROM THE EDGE — on the custom domain

Use the **custom domain** (`https://openbed.ng/beds.json`) once step 4 is done, not
the `*.pages.dev` preview URL — step 6 only works on a custom domain, so observe
both steps on the same URL. The first line waits for you to paste it.

```bash
read -r BEDS_URL
curl -sS -o /dev/null -D - "$BEDS_URL" | grep -i -E '^HTTP|^cache-control|^content-type|^cf-cache-status'
```

**Stop condition — all three exactly, observed rather than inferred:**

- `HTTP/2 200` (or `HTTP/1.1 200`)
- `cache-control: public, s-maxage=30, stale-while-revalidate=300`
- `content-type: application/json; charset=utf-8`

**Name the pass by these values, never by a negation** — "not 404" or "some 2xx"
would pass the step-1 fallback. **Symptoms:** `content-type: text/html` is step 1;
a different or missing `cache-control` means something on the zone rewrote it (a
Transform Rule or Cache Rule); a 5xx means go to step 2's symptoms.

**503, `no snapshot has been generated yet`** — `public.snapshot_current` is empty.
A freshly created or reset database has no snapshot row until the generator runs:
the implementer observed on 2026-09-18 that a local `npm run db:reset` leaves the
table empty, because the seed pauses the pg_cron jobs and never calls the
generator. On hosted, the `openbed_regenerate_snapshot` job (migration 017) fills
it every minute, so a 503 there means the job is not running — read `cron.job` and
`cron.job_run_details` as in `docs/runbook-supabase-project-creation.md` step 5.

Then confirm the body is the snapshot and not an error document:

```bash
curl -sS "$BEDS_URL" | head -c 120
```

**Stop condition:** the output begins `{"v":` with a number, and carries a `"wards":`
key whose value is a JSON array. An `{"error":` body is a failure whatever the
status line said.

**`"wards":[]` PASSES THIS STEP. Do not report it as a failure.** Until 2026-09-20
this stop condition demanded `"wards":[[` — an array containing at least one ward —
which **cannot match a healthy system that has no facilities onboarded yet**, and
would have made this step read FAILED on a correct deployment. OBSERVED 2026-09-20:
the deployed Function returned `{"v":4993,"wards":[],"facilities":[],…}`, while
`app.facility`, `app.ward_status`, `public.ward_public` and `public.facility_public`
were all at zero rows and `public.snapshot_current` held 1440 rows generated one per
minute. **An empty `wards` array is a question about onboarding, not about this
deployment**, and the two must not be confused: the generator faithfully publishing
an empty city is the system working.

## 6. Prove a cache hit inside `s-maxage` — on the same custom domain. GATED by step 4

The Function stores a 200 with Cloudflare's Cache API. **That works only on a custom
domain, and it is per data centre, not global** — so two requests from the same
place, within 30 seconds:

```bash
curl -sS -o /dev/null -D - "$BEDS_URL" | grep -i '^cf-cache-status'
curl -sS -o /dev/null -D - "$BEDS_URL" | grep -i '^cf-cache-status'
```

**Stop condition:** the **second** line reads `cf-cache-status: HIT`. The first may
read `MISS` or `HIT`.

**Symptoms:**
- **Both `MISS`, or no `cf-cache-status` line at all** — the Cache API is not
  storing the response. First rule out the URL: on `*.pages.dev` the Cache API has
  no effect by design, which is why step 4 gates this one. On the custom domain, it
  is a finding: report it rather than adding a zone Cache Rule to force it (see
  step 1).
- **`DYNAMIC`** — Cloudflare considered the response uncacheable; report the full
  header block from step 5.

**What this step does not prove, recorded so nobody assumes it:** whether the Cache
API honours `stale-while-revalidate` is unverified. The header is still sent, for
browsers and any downstream cache.

## 7. The rate limit — a zone WAF rule, not code. GATED by step 4

In the `openbed.ng` zone's **WAF rate-limiting rules** (menu path not observed, so not stated): one rule
matching **URI Path equals `/beds.json`**, counting by IP, with a threshold that a
client polling every 30 seconds can never reach. There is nothing in code and
nothing in `wrangler.toml`: the Rate Limiting binding is a Workers feature, absent
from the Pages Functions binding list (R-2026-09-17-12).

**Record the rule's scope with it — all five, because each is a way it could be
over-trusted (method note 12):**

1. It covers **HTTP requests to `/beds.json` on the `openbed.ng` zone** — nothing
   else.
2. It **cannot see the Supabase Realtime websocket**, which never transits this
   zone; it is a different origin entirely.
3. Its counters are **per Cloudflare location, not global**.
4. It **does not bound accumulation**: paging within the limit still yields a
   series over time. **The boundary is Bundle 2's revoke. This is a throttle.**
5. **A 10-second window cannot address accumulation at all** (R-2026-09-19-22 C2). A
   client polling every 30 seconds, the cadence `pollCadenceSeconds` itself
   advertises, makes at most one request per window, so it never trips the rule at
   any threshold. The rule stops burst scraping of a document that is already public
   and already cached at the edge. Against accumulation it does nothing.

**Why this route gets the zone's only rule** (R-2026-09-19-22 C3). With one rule,
the cheaper false positive wins it. Here a false positive briefly denies a member of
the public a bed-availability page. On a hostname carrying ward traffic, it would
deny a ward nurse a status update, the failure this product exists to prevent. That
second harm is prospective: no publish screen exists yet.

**The parameters (R-2026-09-19-21). Each line says what kind of claim it is.**
- **DOCUMENTED** on Cloudflare's rate-limiting-rules pages, read 2026-09-19 (overview
  and availability table, request rate calculation, rule parameters). On Free:
  - the counting characteristic is **IP**, with no other available;
  - the period is **10 seconds**;
  - the mitigation timeout is **10 seconds**;
  - counters are **per data centre, not global**;
  - some excess requests can pass before enforcement, because counters update with
    a delay;
  - **ONE rule per zone**, whose expression may use Path and Verified Bot. So this
    rule is the zone's only one: another hostname on the zone cannot get its own
    rule on Free. Rules per zone by plan, from the same table: Free 1, Pro 2,
    Business 5, Enterprise 100.
- **NOT CONFIRMED, and WITHDRAWN by Cowork:** "action is Block; no Log-only or
  Managed Challenge action". Its source was a tutorial's recommended setting, not
  an availability matrix (method note 20). No page read lists actions by plan, and
  the parameters page implies that Free can use challenge actions. **Record which actions the dashboard actually offers you**
  when you create the rule, and choose **Block** if it is available.
- **CHOSEN, not documented: 60 requests per 10 seconds per IP.** A legitimate
  client polls every 30 seconds (`pollCadenceSeconds` in
  `packages/fixtures/snapshot-shape.json`, and `s-maxage=30`), so it makes at most
  one request per window. At 60 per window, about 180 simultaneous pollers can share
  one address before it blocks.
- **Why the headroom is not generosity.** Nigerian mobile networks use carrier-grade
  NAT heavily, and a hospital or a carrier can put hundreds of legitimate users
  behind one address. A threshold tight enough to stop a determined scraper would
  block a whole network of real users. It must survive CGNAT, so it **cannot** be
  tight enough to be a boundary.

**After deploying, watch Security Events. If legitimate traffic trips the rule,
RAISE THE THRESHOLD — DO NOT REMOVE THE RULE.** Removing it is the tempting move at
2am, and it takes the throttle with it. Assume no observation period: the rule
blocks from the moment it deploys unless the dashboard shows you a log-only action.

**Demonstrate it rejecting:** set a temporarily low threshold, send requests past
it, and observe **HTTP 429** from the edge; then restore the real threshold.

**If your plan does not permit the rule, report it unmet and leave it unmet**
(R-2026-09-17-12 E). Do not substitute a Durable Object limiter or move the
deployment to Workers: the control is not load-bearing, and both were rejected
with their reasons recorded.

---

## Reporting back

For each step: done or not done, and the **observed** lines — the cutover from the
custom-domain step, the three headers and body prefix from the edge-headers step,
both `cf-cache-status` lines from the cache-hit step, and the 429 from the
rate-limit step. The edge-headers and cache-hit steps together, on the custom
domain, are the deployment report Bundle 2 waits on.

**NAME THE DEPLOYMENT ITSELF — four things, every time (added 2026-09-20; the
fourth added by R-2026-09-20-30, which also made it a READING):**

1. **Which artifact** was deployed — the Pages project and the deployment id or URL
   wrangler printed.
2. **From which commit** — the SHA of the working tree it was uploaded from, read
   back from `git rev-parse HEAD`, never composed or abbreviated by hand.
3. **By which command** — the verbatim invocation, including `--branch`.
4. **That the commit is on `main` — READ, not asserted.** Fetch `/version.json` from
   the site you just deployed and paste what it returns. The build stamps it
   (`scripts/stamp_build.mjs`), so this is the deployed artifact naming its own
   source rather than anyone remembering which tree was uploaded.
   - **`"dirty": true` means the deploy wrapper was BYPASSED** (R-2026-09-20-31 A4).
     The wrapper refuses a dirty tree, so a dirty stamp on a DEPLOYED artifact is not
     a tidiness problem: it says a control was circumvented, and that the artifact
     matches no commit. Report it as a failed deployment, say how the deploy was run,
     and deploy again from a clean tree through the wrapper.

**AND READ BACK THREE THINGS FROM THE DEPLOYED SITE (R-2026-09-20-31 C).** This
deploy is what closes the empty-city hazard, and the only evidence so far that the
empty state reads correctly is a CI assertion over what the CODE produces. **That
proves the code, not the artifact** — the same reason the cache headers are observed
from the edge rather than from the origin. Fetch each, and paste what came back:

5. **The rendered empty state, in the words a visitor sees.** Open the deployment URL
   and copy the sentence on the page. It must say that no facility has joined and
   that this is **not** a report that beds are unavailable. **An empty list, a bare
   zero, or a blank panel is a FAILED deployment**, whatever the build said.
6. **`X-Robots-Tag` on `/beds.json`** — `curl -sSI <url>/beds.json` and paste the
   header lines.
7. **`/robots.txt` returning ROBOTS CONTENT, not the SPA fallback.** Fetch it and
   paste the body. Before 2026-09-20 that path returned the site's `index.html` with
   a 200, which tells a crawler nothing, so this is fetched and read rather than
   inferred from the file being in `dist`.

> **These read-backs are on the `*.pages.dev` deployment URL or alias, because the
> custom-domain cutover is HELD. They do NOT discharge the edge-headers step**, which
> is on the custom domain and is part of what Bundle 2 waits for. The two look alike
> in a report and are not the same evidence.
>
> **NOT OBSERVED AT THE EDGE, and named rather than implied:** `X-Robots-Tag` on a
> FAILURE response. Every failure path carries the header in code and it is asserted
> in `tests/db/beds_json_served.test.ts`, but 500, 502 and 503 cannot be produced on
> production without breaking production. A preview deployment (any `--branch` other
> than the production branch) would return the 500 with its headers on a throwaway
> URL — at the cost of one more deployment in a history that is itself evidence. Ask
> before running it.

**If any read-back does not return what is expected, that is a scope change to
report, not to work around, and the custom-domain cutover stays held.**

**Why this is required rather than tidy.** Before 2026-09-20 these steps assumed a
deployment had happened by some mechanism that was never named, and this runbook
named the wrong one — it said to push to `main`, which for a direct-upload project
deploys nothing. A report can therefore say "deployed" when nothing was, and every
step below it inherits that. Naming the artifact, the commit and the command is what
makes the report checkable by someone who was not there. It also makes visible the
case where what is running was never reviewed, because the commit will not be an
ancestor of `main`.

**USE THE WRAPPER, and what it does not do.** `bash scripts/deploy_pages.sh --branch
<production branch>` refuses a dirty tree, refuses a `HEAD` that is not an ancestor
of `origin/main`, builds (which stamps the artifact), uploads, and then prints all
four clauses for this report. **It is local and defeatable** — running wrangler by
hand bypasses it entirely — so it removes the accident, not the deliberate act, and
it still cannot see what Cloudflare serves afterwards. That is what clause 4's
reading is for.
