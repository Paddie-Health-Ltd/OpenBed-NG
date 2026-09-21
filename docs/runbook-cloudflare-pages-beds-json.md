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

> ### HOLD LIFTED 2026-09-21 — THIS STEP IS NOW THE NEXT FOUNDER ACTION
>
> **The hold below was lifted by R-2026-09-20-36 A2 and the conditions it named are
> met** (R-2026-09-21-40). It is kept, struck through in effect rather than deleted,
> because the reasoning is what makes the lift checkable: a reader who finds only
> "go ahead" cannot tell whether the hazard was closed or forgotten.
>
> **What lifted it, each observed rather than assumed:** the empty-state wording and
> the crawler controls merged (#49, #54); the founder deployed from that tree and
> reported the deployment (R-2026-09-21-37, recorded DEPLOYED under -40); and the
> rendered empty state was read back from the deployed artifact in the words a
> visitor sees.
>
> **THE ORIGINAL HOLD, 2026-09-20, for the record:**
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
> step performed. **All three are now done.**

**THIS STEP AND STEPS 5 AND 6 ARE WHAT LIFT THE EVIDENCE GATE ON MIGRATION 018**
(R-2026-09-20-28 B, restated by R-2026-09-21-40). That gate names three things, and
**none of them can be observed on a `*.pages.dev` host**:

1. the apex resolves to Cloudflare, **not** to a `192.0.2.x` TEST-NET-1 placeholder;
2. this cutover is done — `https://openbed.ng/beds.json` reaches the Function;
3. step 5's values and step 6's cache hit are observed **on that URL**.

018 is not written until those are quoted back. The deployment report of 2026-09-21
is `*.pages.dev` evidence and discharges none of them.

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
would pass the step-1 fallback.

**IF THE COMMAND PRINTS NOTHING AT ALL, that is not a pass and not a fail — it is a
check that did not run.** `grep` exits 0 on a match, 1 on no match and **2 when it
could not run**, and all three look identical here: an empty screen. An unset or
mistyped `$BEDS_URL` produces the same empty screen, because `curl` writes its error
to stderr and `grep` then has nothing to match. **Re-run without the pipe** —
`curl -sS -o /dev/null -D - "$BEDS_URL"` — and read what actually came back before
recording anything. **Symptoms:** `content-type: text/html` is step 1;
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
curl -sS -o /dev/null -D - "$BEDS_URL" | grep -i -E '^HTTP|^content-type|^cf-cache-status'
curl -sS -o /dev/null -D - "$BEDS_URL" | grep -i -E '^HTTP|^content-type|^cf-cache-status'
```

**Stop condition — all three from the SECOND block, not `cf-cache-status` alone:**

- `HTTP/2 200` (or `HTTP/1.1 200`)
- `content-type: application/json; charset=utf-8`
- `cf-cache-status: HIT`

The first block may read `MISS` or `HIT`.

**WHY THE STATUS AND CONTENT-TYPE ARE REQUIRED HERE, and this is a correction to
this step rather than a decoration (R-2026-09-21-40).** Until 2026-09-21 this step
grepped `cf-cache-status` **alone**, and a lone `HIT` is satisfied by at least three
things that are not a working Function:

- **the Function missing entirely.** If `functions/` was not discovered at upload —
  the exact failure step 1 warns about — `/beds.json` is answered by the SPA's
  `index.html` **as a static asset**, which Cloudflare's ordinary cache serves and
  marks `HIT`. The step passed while the thing it guards did not exist.
- **a cached 404**, which also carries `cf-cache-status`.
- **a failure response.** A 500, 502 or 503 from the Function is `no-store` and is
  never put in the Cache API by `serveBedsCached` — but nothing in a lone
  `cf-cache-status` line says which document was cached.

**AND WHAT THIS STEP STILL CANNOT DISTINGUISH, named rather than implied:**
`cf-cache-status: HIT` **does not say which cache answered**. The Function's own
Cache API write and the zone's ordinary CDN cache produce the same header. This step
is evidence that *something* cached a 200 JSON document at that URL; it is not, by
itself, proof that `serveBedsCached`'s `cache.put` is what did it. That is also why
step 1 forbids adding a zone Cache Rule for `/beds.json` — a rule there would
manufacture this header and make the step unreadable.

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

**THE HALVES OF THIS PROBE, AND ONE OF THEM IS STILL OWED (R-2026-09-21-40
addendum).** A probe nobody has seen fail is not evidence, so both directions are
recorded here:

- **The failing half IS demonstrated.** Run against a path with no Function
  (`/nonexistent-path`) on deployment `50a0ea4d`, the corrected grep printed
  `HTTP/2 200` and **`content-type: text/html`** — exposing the SPA fallback. The
  previous version of this step, which grepped `cf-cache-status` alone, printed
  nothing at all there and would have been read as "no cache yet" rather than as
  "there is no Function".
- **The passing half CANNOT YET BE OBSERVED, and this step says so rather than
  implying it was checked.** A `cf-cache-status: HIT` requires the custom domain,
  because the Cache API is inert on `*.pages.dev` by design. **Observed on
  `50a0ea4d`: `/beds.json` returns `HTTP/2 200` and `application/json` with NO
  `cf-cache-status` line at all** — consistent with an inert Cache API, and exactly
  why this step is gated on step 4. **The first real pass of this step is the
  founder's, on `openbed.ng`, and it is what lifts the EVIDENCE gate on 018.**

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

**THREE THINGS THIS DEMONSTRATION DOES NOT ESTABLISH (R-2026-09-21-40). They are
named because a 429 is persuasive and narrow:**

1. **A 429 does not say WHICH rule fired.** Cloudflare returns 429 from DDoS
   protection, from Bot Fight Mode and from any other zone mitigation. Seeing one
   proves something throttled you, not that your `/beds.json` rule matched.
2. **The scope claim has no negative control.** This runbook states the rule
   "covers HTTP requests to `/beds.json` on the `openbed.ng` zone — nothing else",
   and a rule mis-scoped to the whole zone produces an identical 429. **Send the
   same burst at a DIFFERENT path on the same zone and confirm it is NOT limited.**
   Without that second reading the scope sentence is untested, and a zone-wide rule
   on a hostname that will carry ward traffic is the exact harm the rule's placement
   exists to avoid.
3. **"Then restore the real threshold" has no read-back.** Nothing here verifies
   the restore happened. **Re-read the rule's threshold in the dashboard after
   restoring and report the value**, because a forgotten low threshold is a live
   outage that no other step in this document would catch.

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
4. **That the commit is on `main` — READ, not asserted.** The build stamps
   `/version.json` (`scripts/stamp_build.mjs`), so this is the deployed artifact
   naming its own source rather than anyone remembering which tree was uploaded.

   ```bash
   read -r DEPLOY_URL
   curl -sS "$DEPLOY_URL/version.json"
   git rev-parse HEAD
   git merge-base --is-ancestor "$(git rev-parse HEAD)" origin/main; echo "ancestor check exit: $? -- 0 means on main, 1 means NOT on main, anything else means the check did not run"
   ```

   **Stop condition — all four, and each is a positive value, not an absence
   (R-2026-09-21-40):**

   - the response **begins `{`**, not `<`. A missing `version.json` is answered by
     the SPA's `index.html` with a **200** — the same fallback that made
     `/robots.txt` look fine before 2026-09-20, and `version.json` sits in the same
     `public/` directory. **HTML here is a failed deployment, not a formatting
     quirk.**
   - `"commit"` **equals** the `git rev-parse HEAD` printed beneath it. A stale
     `version.json` cached from an earlier deployment otherwise passes.
     **Run this block immediately after the deploy, from the tree you deployed**, and
     the two agree. Run it later, after `main` has moved on, and they differ for an
     innocent reason — observed 2026-09-21, when the artifact read `4803d20` and the
     checkout had already advanced to `cf8bcd9`. **In that case compare against the
     commit you deployed from, not against today's HEAD**, and say which you used.
   - `"dirty": false`, stated positively.
   - the ancestor check prints **exit 0**.

   - **`"dirty": true` means the deploy wrapper was BYPASSED** (R-2026-09-20-31 A4).
     The wrapper refuses a dirty tree, so a dirty stamp on a DEPLOYED artifact is not
     a tidiness problem: it says a control was circumvented, and that the artifact
     matches no commit. Report it as a failed deployment, say how the deploy was run,
     and deploy again from a clean tree through the wrapper.
   - **Why the ancestor check is here at all.** This clause's own closing paragraph
     says the report "makes visible the case where what is running was never
     reviewed, because the commit will not be an ancestor of `main`" — and until
     2026-09-21 the clause named that property and supplied **no operation that
     decides it**. `scripts/deploy_pages.sh` runs the check before upload, but this
     clause exists for the case where the wrapper was bypassed, which is exactly the
     case where its check did not run.
   - **`"dirty": true` means the deploy wrapper was BYPASSED** (R-2026-09-20-31 A4).
     The wrapper refuses a dirty tree, so a dirty stamp on a DEPLOYED artifact is not
     a tidiness problem: it says a control was circumvented, and that the artifact
     matches no commit. Report it as a failed deployment, say how the deploy was run,
     and deploy again from a clean tree through the wrapper.

**AND READ BACK FOUR THINGS FROM THE DEPLOYED SITE (R-2026-09-20-31 C; a fourth
added by R-2026-09-21-W A6).** This
deploy is what closes the empty-city hazard, and the only evidence so far that the
empty state reads correctly is a CI assertion over what the CODE produces. **That
proves the code, not the artifact** — the same reason the cache headers are observed
from the edge rather than from the origin. Fetch each, and paste what came back:

5. **The rendered empty state, in the words a visitor sees.** Open the deployment URL
   and copy the sentence on the page. It must say that no facility has joined and
   that this is **not** a report that beds are unavailable. **An empty list, a bare
   zero, or a blank panel is a FAILED deployment**, whatever the build said.
6. **`X-Robots-Tag`, `Content-Type` AND THE STATUS on `/beds.json`, READ WITH A
   GET.** Paste the header lines **and the body prefix**. They must read
   **`HTTP/2 200`** (or `HTTP/1.1 200`), `application/json; charset=utf-8` and
   `noindex, nofollow`, and the body must begin `{"v":`.

   **THE STATUS LINE IS NOT OPTIONAL, and leaving it out was a defect in this step
   (R-2026-09-21-40).** `failure()` in `packages/snapshot/src/serve.ts` emits
   **exactly** `content-type: application/json; charset=utf-8` and
   `x-robots-tag: noindex, nofollow` on every refusal it builds. So a **500**
   (`SUPABASE_URL is not set`), a **502** (the origin refused the credential) and a
   **503** (no snapshot row) all satisfied the two values this step used to name,
   verbatim. The status line was printed and the prose never said what it must read,
   so a reader pasting output and ticking the box could certify a broken deployment.
   That is the shape narrated four paragraphs below about `-I` — committed in the
   same change that narrated it.

   The first line waits for you to paste the DEPLOYMENT URL — this step runs on the
   `*.pages.dev` alias, so it does not reuse the custom-domain variable set in the
   edge-headers step above.

   ```bash
   read -r DEPLOY_URL
   curl -sS -o /dev/null -D - "$DEPLOY_URL/beds.json" | grep -i -E '^HTTP|^content-type|^x-robots-tag'
   curl -sS "$DEPLOY_URL/beds.json" | head -c 120
   ```

   The body read is the second half of the same guard: **an `{"error":` body is a
   failure whatever the status line said**, and `-o /dev/null` alone can never see
   it. Step 5 has carried that rule since 2026-09-20; this step did not.

   **This step said `curl -sSI` until 2026-09-21, and `-I` sends a HEAD.** At that
   moment `/beds.json` had no HEAD handler, so the HEAD was answered by the SPA
   fallback: the step read `content-type: text/html` and the site-wide
   `x-robots-tag: noindex` off the wrong response entirely, and a reader ticking the
   box would have certified a header the Function never sent. A probe that reports
   success for a reason unrelated to what it guards — the shape this project keeps
   finding. Fixed here, and step 8 is what stops it recurring silently.

7. **`/robots.txt` returning ROBOTS CONTENT, not the SPA fallback.** Fetch it and
   paste the body. Before 2026-09-20 that path returned the site's `index.html` with
   a 200, which tells a crawler nothing, so this is fetched and read rather than
   inferred from the file being in `dist`.
8. **GET AND HEAD MUST BOTH RETURN THE FUNCTION'S OWN VALUES on `/beds.json`.** Run
   both and paste both.

   ```bash
   read -r DEPLOY_URL
   echo "--- GET ---"
   curl -sS -o /dev/null -D - "$DEPLOY_URL/beds.json" | grep -i -E '^HTTP|^content-type|^x-robots-tag|^cache-control'
   echo "--- HEAD ---"
   curl -sS -I "$DEPLOY_URL/beds.json" | grep -i -E '^HTTP|^content-type|^x-robots-tag|^cache-control'
   ```

   **Stop condition — these exact values under BOTH headings:**

   - `HTTP/2 200` (or `HTTP/1.1 200`)
   - `content-type: application/json; charset=utf-8`
   - `cache-control: public, s-maxage=30, stale-while-revalidate=300`
   - `x-robots-tag: noindex, nofollow`

   **"THE TWO AGREE" IS NOT THE STOP CONDITION, AND SAYING SO WAS A DEFECT
   (R-2026-09-21-40).** Measured on 2026-09-21: a path with **no Function at all**
   (`/nonexistent-path`) returns `text/html` for GET **and** HEAD — the SPA fallback
   is perfectly consistent across methods, so **a parity test passes on a route that
   lost its Function entirely**. Two `500`s likewise agree on every header
   `failure()` sets. And this step used to grep `^cache-control` while naming **no
   expected value for it**, so `no-store` — the failure header — passed.

   **`text/html` on either is a FAILED deployment**, and specifically means that
   method fell through to the SPA fallback. Some crawlers and monitors issue HEAD, so
   a route that answers differently by method hands them an untagged HTML document
   where a `noindex, nofollow` JSON one was intended.

   **THE HEAD LEG USES `-I`, NOT `-X HEAD`, and the difference is not cosmetic.**
   `curl -X HEAD` overrides the method string but leaves curl expecting a body, so
   against a **correct** HEAD response — headers, `content-length: 135`, no body — it
   fails with `curl: (18) transfer closed with 135 bytes remaining to read`.
   Measured 2026-09-21: **`-X HEAD` failed 8 of 8 runs; `-I` passed 8 of 8.** The
   trap is the direction of the failure: **`-X HEAD` returned exit 0 against the
   PRE-FIX artifact**, because the SPA fallback sent a real body for curl to consume.
   **The probe worked only while the defect it guards existed.**

   **THIS STEP HAS BOTH HALVES DEMONSTRATED (R-2026-09-21-40 addendum), and they are
   recorded because a probe nobody has seen fail is not evidence:**

   - **PASSES** against the fixed artifact — deployment `50a0ea4d`, commit
     `4803d20a3e6c74ae434a464e65575a50f44bdb63`: both methods returned
     `application/json; charset=utf-8` and `noindex, nofollow`.
   - **REPORTS THE DEFECT** two ways. Against the pre-fix artifact `d9b7669e`
     (commit `50c638e`), GET returned `application/json` and HEAD returned
     `text/html`. Against `/nonexistent-path` on the fixed artifact, **both** returned
     `text/html` — which is why the stop condition above is absolute values rather
     than agreement.

> **These read-backs are on the `*.pages.dev` deployment URL or alias. They do NOT
> discharge the edge-headers step**, which is on the custom domain and is part of
> what Bundle 2 waits for. The two look alike in a report and are not the same
> evidence.
>
> **The cutover is no longer HELD** — this sentence said it was until 2026-09-21,
> after R-2026-09-20-36 A2 had lifted it. **What changed is only the hold, not the
> evidence:** the 2026-09-21 report was taken entirely on `*.pages.dev`, and the
> EVIDENCE gate on 018 needs steps 4, 5 and 6 on `openbed.ng` (R-2026-09-21-40).
>
> **NOT OBSERVED AT THE EDGE, and named rather than implied:** `X-Robots-Tag` on a
> FAILURE response. Every failure RESPONSE carries the header in code — see the known
> gap below for the path that produces no response at all — and it is asserted in
> `tests/db/beds_json_served.test.ts`, but 500, 502 and 503 cannot be produced on
> production without breaking production.
>
> **The preview-deployment probe is DECLINED — R-2026-09-20-32 B1 — and not on cost.**
> The reason to observe a header on a failure path is that the path leaks something or
> loses a control. Here the control is `noindex` on a document that, when failing,
> **carries no bed data at all**: the body is `{"error": "<a generic reason>"}`. A
> crawler indexing that is close to harmless, so the observation buys very little, and
> it would add a deployment to a history that is itself evidence in the
> what-is-running question.
>
> **The one condition that reopens it, named so this is a decision and not a
> permanent silence:** a preview deployment against a NON-PRODUCTION project with the
> Preview environment variables unset, **taken if the failure path ever comes to carry
> data.** Until then the header on a failure response is a code assertion, and this
> runbook says so rather than implying it was checked.

> **A KNOWN GAP IN THE DEPLOYED ARTIFACT, recorded so nobody reads the claim above
> unqualified (R-2026-09-20-33 B3).** `serveBedsCached` calls the edge cache outside
> any `try`, so **an exception raised inside a cache operation never reaches the
> failure builder** and carries none of its headers — no `X-Robots-Tag`, no
> `no-store`. It is a rare path and it carries no bed data, which is why the fix was
> sequenced after this deployment rather than before it.
>
> **This caveat names no commit on purpose.** It binds **every artifact built before
> the cache fix lands — including the one this report names.** A SHA written here
> before the deploy happened would be a composed identifier, which is the defect the
> fourth clause exists to remove.
>
> The fix ships as its own pull request immediately after this report: one `try`
> around the cache calls only, never around the origin read.
>
> ---
>
> **CLOSED 2026-09-21, and this note is why the caveat above could not close itself.**
> The fix landed in #54 (`9086364`, merged at `4803d20`) and **is in the artifact the
> 2026-09-21 report names**: `serveBedsCached` now wraps each cache call in its own
> `try`, a read that throws is a miss, a write that throws is skipped, and no cache
> exception escapes the module.
>
> **The caveat deliberately named no commit — correct then, and exactly what made its
> expiry invisible.** Binding "every artifact built before the fix lands" cannot go
> stale, and for the same reason it cannot announce that it has been satisfied: a
> reader in 2026-10 would find a live-sounding KNOWN GAP describing code that no
> longer exists. **A caveat with no expiry condition needs a closing note or it
> outlives its subject.** Superseded by note rather than rewritten, per method note 8.

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
