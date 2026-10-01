# Sprint Kickoff — Facility-one build boxes (EW)
Date: 2026-09-29 | Prepared by: Cowork sprint-push | Main at `f882f72` (#106's merge)

## Division of responsibilities
Claude Code builds, tests and ships the four PRs below, one letter at a time (EW opens W1). Cowork has scoped and bundled the work, run the specialist review, and reviews each PR from its own clone. The founder runs every hosted step, and makes the four calls listed at the end.

## Sprint scope
This sprint closes the five facility-one boxes at runbook 12.4 step 1 that need building:
- the sensor bundle (R-2026-09-22-54 B);
- the proxy's surface (R-2026-09-19-23 D3);
- attribution: which client address Supabase sees (D4);
- the proxy's availability on the clinical path (D5);
- where the magic-link emails point (R-2026-09-22-55 C).

A box is ticked only by a ruling that closes it. Each PR's merge letter says which box it closes, and the founder's hosted step is part of the close where one is named.

**Out of scope:** the paperwork boxes (the register, Proton, the B1 clause), the clinicians' box, the 24/7 number, the ward line and `noindex`. Those are the founder's. The D2 Cloudflare scope cell is already written (DL-6 a); it closes when the founder approves register row 3. W3 fixes the runbook line that still calls it "to be completed".

**One scope change, reported as the A1 kickoff asked (:376-379).** R-2026-09-17-12 G is answered: Pages Functions cannot run on a schedule. Cron Triggers exist for Workers only ([Cloudflare: migrate from Pages](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/), [Pages Functions API](https://developers.cloudflare.com/pages/functions/api-reference/)). The external sensor becomes an external uptime monitor polling a health endpoint. It sits outside both Supabase and Cloudflare, so it does not share pg_cron's failure mode, or Cloudflare's.

## What is true today (read from main, f882f72)
- There are five pg_cron jobs: the snapshot every minute, the LGA rollup every 5 minutes (017), and three daily retention jobs (024). Hosted is at 026.
- `app.system_heartbeat.last_snapshot_at` is written in the snapshot's own transaction. `last_sweep_at` is always NULL: no sweep exists.
- There is no health endpoint, and nothing alerts anyone. The public page already degrades honestly when the scheduler dies: from 3 minutes it shows "Counts may be out of date — call before you travel" and greys every row. What is missing is an alarm that reaches the founder.
- The Worker forwards only its allow-list: Auth OTP, token refresh and settings, and 11 RPCs. Everything else gets the Worker's own 404. It copies every request header to Supabase.
- Every request through `api.openbed.ng` reaches Supabase from one Cloudflare address. Cross-zone subrequests set CF-Connecting-IP to a single Cloudflare IP. Supabase honours a forwarded client IP only through `Sb-Forwarded-For` with a secret key. **So every ward shares one per-IP bucket:** 30 OTP requests or 150 junk refreshes in 5 minutes from anyone locks out every ward in the city. Inferred from [Cloudflare's header docs](https://developers.cloudflare.com/fundamentals/reference/http-headers/) and [Supabase's rate-limit docs](https://supabase.com/docs/guides/auth/rate-limits); W3 has the founder read it from the logs.
- If the Worker fails, every ward-console and admin call fails. A nurse sees "Something went wrong. Reload…", and nobody else is told. `/beds.json` keeps serving from the direct origin, so the public sees ageing counts, not wrong ones.
- The magic link today is a GET on `klrlpxysjsjpdkeqdhvl.supabase.co/auth/v1/verify`, observed at H6 step 6.

## Bundles

### W1: Sensor data and `/api/health` (EW, this letter)
**Why bundled together:** the migration has no consumer without the endpoint, and the endpoint has nothing to read without the migration. Both change the public dashboard's deployed surface and need one hosted apply.
**Tasks:**
- [ ] Migration `027_scheduler_status.sql` with its down: `app.scheduler_status()`, plus `public.health_probe()` for service_role only. It is the repo's first service_role grant.
- [ ] `apps/public-dashboard/functions/api/health.ts`, a thin adapter, with the decision in `packages/snapshot/src/health.ts`. 200 or 503, by GET and HEAD. The body carries the keyword `openbed-ok` or `openbed-fail` for the monitor. An `x-openbed-health` header is there for the read-back. A 30 s edge cache stores both answers.
- [ ] A 503 when the snapshot is at or past the public banner's age (computed on the database's clock), or when the snapshot job is absent or inactive, or when the probe fails. A single failed run is not an alarm: the age catches repeated failure.
- [ ] Tests on the pure decision, on the migration inside a rolled-back transaction, and on the handler.
**Specialist input incorporated:**
- platform-sre: detect outside both Supabase and Cloudflare. HEAD must be exported, because a missing HEAD fell through to the SPA with a 200 on `/beds.json`. The free monitors check a body keyword, not headers, so the keyword is what stops a monitor reading the SPA's 200 as green.
- cto: one threshold for the banner and the alarm.
- clco: no personal data in the body. The public body names the snapshot job only; the retention jobs are the operator's.
**Safety/quality notes:** a monitor that sees the SPA's 200 would read green forever; the body keyword and a HEAD plant close that. The cache key drops the query string, so a flood cannot bypass it to reach the database.
**Blast radius:**
- The -58 A direct-origin exception extends from `/beds.json` to `/api/health`, and `packages/origins` says so beside it.
- `packages/fixtures/function-grants.json` gains its first service_role entry. The anon allow-list and the authenticated closed list do not move. The frozen boundary moves to 27.
- The -58 A exception is also named in origins.json and in the Worker's allow-list; all three move together.
- `/beds.json` is untouched.
**Definition of done:** 027 applied on hosted and frozen at 27; the public dashboard redeployed; `readback_pages.sh` reads `/api/health` 200 with the marker, by GET and by HEAD.

### W2: Operator status view, the runbook and the fire drill
**Why bundled together:** the admin view, the drill and the record close the sensor box together. The drill can only run once W1 is live.
**Tasks:**
- [ ] `public.operator_scheduler_status()` behind `assert_operator`.
- [ ] An admin "System status" view: snapshot age, heartbeat age, and each of the five jobs' `active` flag and last run.
- [ ] Its allow-list entry, and a Worker redeploy.
- [ ] `docs/runbook-sensor.md`: monitor setup, the fire drill (pause the snapshot job on hosted, expect an alert, restore), and a monthly repeat.
- [ ] The monitor is listed in the processor-obligations table, holding the operator's contact address only.
- [ ] The seven A1 markers amended:
  - #87 and #88 built;
  - #92 restated as the drill;
  - #30 moot, since Vercel is gone;
  - #28 and #107 already amended;
  - #89 (the daily digest) out of v1, with a VERSION row.
**Specialist input incorporated:**
- clco: `/status` is gated by operator sign-in, so no new bearer secret.
- platform-sre: the drill runs before facility one, while a stale banner harms nobody.
**Definition of done:** the founder creates the monitor, runs the hosted drill, the alert arrives, and its timestamp is recorded. That closes the sensor box.

### W3: The proxy's surface, attribution and the magic-link host
**Why bundled together:** all three are the Worker's allow-list and headers. -55 C's verify route joins the shared per-IP bucket unless D4's fix lands with it.
**Tasks:**
- [ ] D3: runbook §5 "Surface", generated from the allow-list.
- [ ] D3: two refusal probes (a websocket upgrade, and a storage path).
- [ ] D3: a test that reds on any forward entry under `/realtime`, `/storage`, `/functions` or `/graphql`.
- [ ] D4: the Workers Rate Limiting binding, keyed on the edge `cf-connecting-ip`, on OTP and token refresh. Its 429 is marked `x-openbed-proxy: limited`, carries the CORS headers `refusal()` does, and is read as answered by the client. Its limit is sized for a whole hospital behind one NAT address, since the binding counts per data centre over 10 or 60 seconds.
- [ ] D4: the founder raises Supabase's per-IP sign-in and refresh limits so the shared bucket is not what bites.
- [ ] D4: the founder reads, from Supabase's edge logs, the client address Supabase recorded for one proxied request and one direct request.
- [ ] -55 C, option T1: the Magic Link and Confirm Signup templates link to `api.openbed.ng/auth/v1/verify?token={{ .TokenHash }}&type=magiclink&redirect_to={{ .RedirectTo }}` (`type=signup` for Confirm Signup; GET verify reads `token`, not `token_hash`). GET verify moves from the direct-origin exception to the forward list. The founder compares against the hosted default link, then edits the templates.
- [ ] Fix the stale D2 line in the runbook.
**Specialist input incorporated:**
- cto: no secret key in the Worker (it stays "not an auth boundary"), so `Sb-Forwarded-For` is refused.
- platform-sre: `Location` passes through untouched once verify is forwarded, so its probe reads the redirect.
**Safety/quality notes:** T1 keeps the link a GET, as today's link is, so a mail scanner that prefetches links can burn a token, exactly as it can today. T2 (a fragment token posted by the app) is the named fallback if that is ever seen.
**Register triggers this fires:** -70 A (a uniform `/otp` answer, "-55 C lands") and -70 C2 (GET verify listed on the Worker). W3's letter rules on both.
**Definition of done:** the probes read on hosted; the log read recorded; a real sign-in email's link host reads `api.openbed.ng`; the D3, D4 and -55 C boxes ruled closed.

### W4: The ward console survives a Worker failure
**Why bundled together:** it is the only change on the clinical path, so it goes alone.
**Tasks:**
- [ ] The ward console falls back to the direct Supabase origin for `my_reporting_wards`, `publish_ward_status` and the refresh.
- [ ] The fallback fires only when the fetch itself rejects: no response, or a timeout. Cloudflare's error pages carry no CORS headers, so the browser can read nothing else about them. It never fires on any answer the page can read. The Worker exposes `x-openbed-proxy` and `sb-project-ref` on forwarded answers, with a browser-context plant.
- [ ] It reuses the mutation id, so a retry replays and never duplicates.
- [ ] The ward console's `connect-src` gains the direct origin; admin's does not.
- [ ] The monitor gains a forwarded probe: keyed settings must return 200 marked `forwarded`.
- [ ] Runbook §6 "Worker down".
**Specialist input incorporated:**
- platform-sre: a Cloudflare outage takes Pages down too, so the Worker's added risk is configuration (a bad deploy, a lost domain, allow-list drift, the Free plan's 100,000-a-day cap). The fallback removes that.
- cto: the fallback adds a path and removes none. An ISP block on `supabase.co` only disables the fallback, since the Worker reaches Supabase server-side.
**Register triggers this fires:** -58 A6 (the snapshot Function keeps its direct origin), which now covers `/api/health` too. W4's letter rules on it.
**Definition of done:** a local plant takes the Worker away and a publish still lands exactly once; the ward console is redeployed and read back; the D5 box ruled closed.

*Note 2026-10-01 (R-2026-09-30-177 FA-3 g): two client changes are clinical-path changes and belong to W4, and W4's letter rules on them; this note is their gate. W3 changed neither client and pinned today's reading of both with a test. (1) Whether a limited session refresh keeps the session until its access token expires: today `packages/auth/src/holder.ts` turns any non-2xx answer on refresh, the Worker's own `limited` 429 included, into `SessionExpiredError`, so a limited refresh signs the handset out, as Supabase's own 429 does. (2) Whether a limited `/otp` request gets its own message: today `packages/auth/src/request.ts` reads any answer but `x-openbed-proxy: refused` as answered, so a limited 429 gets the fixed "answered" message. A per-IP limit says nothing about the address, so R-2026-09-23-70 A's reason for flattening the `/otp` answer does not apply to it. A legitimate hospital never reaches these limits: only an address sending more than 20 links or 60 refreshes a minute sees them.*

*Note restated 2026-10-01 (R-2026-09-30-178 FB-4). The note above stands as it was written; this one replaces it as W4's gate for both questions. (1) **Whether ANY 429 on refresh, the Worker's own `limited` or Supabase's own, keeps the session until its access token expires.** `packages/auth/src/holder.ts` treats both as `SessionExpiredError`, and Supabase's per-IP buckets burst to a FIXED 30 that no setting changes, shared by every facility through the Worker's one address, so a city-wide reconnect can still draw Supabase's own 429 however the Worker's limits are sized. (2) **Whether a limited `/otp` request gets its own message** stands as written: today `packages/auth/src/request.ts` reads any answer but `x-openbed-proxy: refused` as answered, and a per-IP limit says nothing about the address. It now includes the sixth link REQUESTED in one 10-second window at one address, which gets the flat "answered" message with no email; the sixth link OPENED in one window gets the limited-link sentence and the link is not spent (corrected by R-2026-09-30-179 FC-6 b, which had said "opened" for both). The closing sentence's figures become this letter's: the limits are 5 link requests, 5 link opens and 10 refreshes per client address in a 10-second window (wrangler.json is the source), so a legitimate hospital rarely reaches them, and a teaching hospital's shift change can reach the request limit.*

## Open decisions needing your call
1. **The Workers plan (read, then maybe $5/month).** Read which plan the Cloudflare account is on. On Free, Pages Functions and Workers share one pool of 100,000 requests a day. Every public hit on `/beds.json` or `/api/health` draws on it, and past it the ward proxy returns an error until midnight UTC ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/)). **Recommended: Workers Paid, $5 a month.** Needed before W1's redeploy. Also record the Pages project's "fail open / fail closed" setting.
2. **The uptime monitor.** **Recommended: UptimeRobot's free plan.** It runs a 5-minute GET keyword check on `openbed-ok`, alerting `support@openbed.ng`, and its terms allow commercial use ([UptimeRobot terms](https://uptimerobot.com/terms/)). Worst case, you hear about 8½ minutes after the snapshot job dies. Confirm phone-app push at sign-up, since you are in Hong Kong and the hospitals are in Lagos. Better Stack's free tier checks every 3 minutes, but it is framed for personal projects and alerts only by email and Slack. $0. Needed at W2's hosted step.
3. **Supabase's custom-domain add-on ($10 a month).** **Recommended: no.** T1 points the link at `api.openbed.ng` without it, and keeps the Worker's allow-list and probes ([Supabase custom domains](https://supabase.com/docs/guides/platform/manage-your-usage/custom-domains)).
4. **Approve register row 3** (the Cloudflare processor agreement). That closes the D2 box, and it is already on your review list.

Everything else was settled by the team, and is logged in the bundles above.

## Supporting docs
- `Sprint Kickoffs/sprint-kickoff-a1-accumulation-boundary-2026-09-17.md` §"Bundle 3: The sensors" (:341-397): the original sensor scope, superseded by -54 B and carried here.
- `Sprint Kickoffs/sweep-2026-09-17-v1-enumeration.md`: the seven items W2 amends.
- `docs/runbook-cloudflare-worker-proxy.md`: the Worker's runbook, which W3 and W4 extend.
