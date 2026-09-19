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

---

## 1. The Pages project — create it, or confirm the one that exists

In the Cloudflare dashboard, the Pages project for the public dashboard must have:

- **Project name** `openbed-public-dashboard` — it matches `name` in
  `apps/public-dashboard/wrangler.toml`.
- **Root directory** `apps/public-dashboard`. **This is the setting that decides
  whether the Function deploys at all**: Pages looks for `functions/` at the
  project root.
- **Build output directory** `dist`.
- **Production branch** `main`.

**Symptom of a wrong root directory:** `/beds.json` answers **200 with
`content-type: text/html`** — the SPA's `index.html`, served as a fallback because
no Function matched. It looks like success. Step 4's content-type check is what
catches it; this exact fallback was observed locally for an unrouted path.

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

**Symptoms:**
- **500, `SUPABASE_SERVICE_ROLE_KEY is not set in the Function environment`** —
  the variable is missing, or set under Preview rather than Production.
- **502, `the origin refused the service-role credential (HTTP 401)`** — the wrong
  key was pasted, most often the **publishable** key instead of the secret one, or
  a key that has been revoked. Supabase also returns 401 for a secret key sent from
  a browser `User-Agent`; a Function should not send one, so if 401 persists with
  the right key, that is the next thing to rule out.
- **502, `the origin rejected the snapshot read (HTTP 4xx)`** — the URL is wrong.

## 3. Deploy

Push to `main`, or trigger a production deployment from the dashboard. In the
deployment's **Functions** tab, `/beds.json` must be listed.

**Symptom:** the Functions tab is empty or absent — go back to step 1's root
directory.

## 4. Custom-domain cutover — `openbed.ng` on the Pages project. GATES steps 6 and 7

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

**Stop condition:** the output begins `{"v":` or contains `"v":` with a number and
`"wards":[[`. An `{"error":` body is a failure whatever the status line said.

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

**Record the rule's scope with it — all four, because each is a way it could be
over-trusted (method note 12):**

1. It covers **HTTP requests to `/beds.json` on the `openbed.ng` zone** — nothing
   else.
2. It **cannot see the Supabase Realtime websocket**, which never transits this
   zone; it is a different origin entirely.
3. Its counters are **per Cloudflare location, not global**.
4. It **does not bound accumulation**: paging within the limit still yields a
   series over time. **The boundary is Bundle 2's revoke. This is a throttle.**

**Demonstrate it rejecting:** set a temporarily low threshold, send requests past
it, and observe **HTTP 429** from the edge; then restore the real threshold.

**If your plan does not permit the rule, report it unmet and leave it unmet**
(R-2026-09-17-12 E). Do not substitute a Durable Object limiter or move the
deployment to Workers: the control is not load-bearing, and both were rejected
with their reasons recorded.

---

## Reporting back

For each step: done or not done, and the **observed** lines — the cutover from
step 4, the three headers and body prefix from step 5, both `cf-cache-status` lines
from step 6, and the 429 from step 7. Steps 5 and 6 together, on the custom domain,
are the deployment report Bundle 2 waits on.
