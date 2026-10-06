# Runbook — deploying the `api.openbed.ng` Worker, and proving what it forwards

**Every deploy of `supabase-proxy/` runs all of it.** Since PR 3.3 (R-2026-09-23-70) the
Worker forwards only what the apps call — `supabase-proxy/allow-list.json`, held equal
to the code by `tests/compliance/proxy_allow_list.test.ts` — and answers everything else
itself. A deploy that has not been read back and probed is a claim about what is live,
not a fact.

**Every probe below proves who answered by a HEADER, never by a body shape**
(R-2026-09-23-70 C1). The Worker marks each answer `x-openbed-proxy: forwarded`,
`refused`, `limited` (since W3, R-2026-09-30-177: its own 429, section 5) or `stamp`. Hosted's own no-key answer comes from Supabase's gateway, with a
body this repository does not control, so a probe keyed to a body would STOP on a
correct deploy — or pass on the wrong one.

**Nothing below is pasted except one-line commands.** The probes and the stamp read
are `scripts/readback_worker.sh`, run with bash (R-2026-09-23-70, the H4 note: three
paste failures in one day, one of them a false STOP). The rules a pasted block needed
(no `exit`, no variable called `path` or `status`) therefore no longer apply.

**-23 D5 (availability) is still open, and this Worker raises its stakes:** every ward
call now depends on it as well as on Supabase. Nothing here answers that.

---

## 1. Deploy through the wrapper

**Deploy from the deploy checkout, never from a working tree (R-2026-09-23-70, after
#67).** The implementer's working tree is a clone of this repository too, and a
`git checkout main` there was refused on 2026-09-23 over uncommitted work in progress.
The deploy checkout is a separate `git worktree`, detached at `origin/main`, that
nothing else writes to. Before every deploy, set `DEPLOY_TREE` in this shell to its path (the commands below refuse to run while it is unset, so they cannot fall through to the working tree you are standing in), refresh it, and read its HEAD:

```bash
git -C "${DEPLOY_TREE:?set DEPLOY_TREE to the deploy checkout first}" fetch origin && git -C "$DEPLOY_TREE" checkout --detach origin/main && (cd "$DEPLOY_TREE" && npm ci --include=optional)
cd "${DEPLOY_TREE:?set DEPLOY_TREE to the deploy checkout first}" && git rev-parse HEAD
```

*Restated 2026-10-03 (R-2026-10-03-FH FH-3 c, -184). Until then the refresh line above ended with a bare `npm ci)`. The flag guards against an `omit` setting that skips optional packages, and the founder's was empty (`npm config get omit` printed nothing), so on 2026-10-03 it would have changed nothing: the first `npm ci` still left out the native workerd binary for the platform, most likely after a failed optional download, which npm skips without saying so (INFERRED; nothing else was observed). What catches that is the deploy wrappers' own toolchain check, which runs before any build or upload, and not the flag.*

*Added 2026-10-03 (R-2026-10-03-FI FI-3, -185). The deploy wrapper turns wrangler's usage telemetry off for the steps it runs (`WRANGLER_SEND_METRICS=false`). A wrangler run outside the wrapper is not covered; the founder may also run `npx wrangler telemetry disable` once on the deploy machine.*

The last line must print the commit you mean to deploy. Every command below runs from
that directory.

From a clean checkout of `main`:

```bash
bash scripts/deploy_worker.sh supabase-proxy
```

It refuses a dirty tree, a commit not on `origin/main`, a stamp that is not HEAD's,
and any target but `supabase-proxy`. After `wrangler deploy` it reads
`/__openbed/version` until it names HEAD, for about a minute, and then **STOPs** —
it never passes on the previous Worker.

**Pass:** its last lines read `DONE. https://api.openbed.ng/__openbed/version names
<HEAD> (attempt N of 12).` **Anything ending `STOP:` — do not report the deploy as
done;** the old Worker may still be serving.

## 2. The read-back — probes 1 to 3, 5, 5b, 6, 7, 8 and the stamp, in one run

From the same deploy checkout, straight after the wrapper's `DONE`:

```bash
bash scripts/readback_worker.sh https://api.openbed.ng
```

It prints one line per check, each `ok` or `WRONG` with the value it must have, and
ends with exactly one verdict: **`PASS:` (exit 0)** or **`STOP:` (exit 1)**. **Paste
the whole output back.** Exit 2 with `ERROR:` means a check could not run (no
network, or not run from a checkout), which is neither a pass nor a failure of the
deploy. Run with no URL, or a non-https one, it STOPs before sending anything.

**What it checks, and the value each must read** (observed on hosted 2026-09-23, the
-70 H5 note):

| Check | Request | Must read |
|---|---|---|
| probe 1 — no key: forwarded, refused by Supabase's gateway | `POST /rest/v1/rpc/my_reporting_wards`, no key | `401`, `sb-project-ref: klrlpxysjsjpdkeqdhvl` (read from `packages/origins/origins.json`), `x-openbed-proxy: forwarded` |
| probe 1b — the HEFAMAA write, no key: forwarded, refused by Supabase's gateway | `POST /rest/v1/rpc/operator_record_registration`, no key | the same three values as probe 1 |
| probe 2 — the tracked key: forwarded, accepted | `GET /auth/v1/settings` with the key from `packages/origins/publishable-keys.json` | `200`, `x-openbed-proxy: forwarded` |
| probe 2, HEAD half | the same, as HEAD (`curl -I`, never `-X HEAD`) | `405`, `x-openbed-proxy: forwarded` |
| probe 3 — off the list: refused HERE, Supabase never asked | `GET /rest/v1/` | `404`, `x-openbed-proxy: refused`, body `{"message":"not forwarded by the OpenBed proxy"}` |
| probe 5 — a websocket upgrade on a service the Worker never reaches | `GET /realtime/v1/websocket` over HTTP/1.1 with `Upgrade`, `Connection`, `Sec-WebSocket-Version` and `Sec-WebSocket-Key` | the same three values as probe 3 |
| probe 5b — the same upgrade on a LISTED path, with the key | `GET /auth/v1/settings` over HTTP/1.1 with the same four headers and the tracked key | the same three values as probe 3: the Worker refuses an `Upgrade` before it reads the list |
| probe 6 — a service the Worker never reaches | `GET /storage/v1/object/public/probe` | the same three values as probe 3 |
| probe 7 — the sign-in link's redirect (spends one verify token) | `GET /auth/v1/verify?token=probe&type=magiclink&redirect_to=<the admin origin>/` | `x-openbed-proxy: forwarded`, a `3xx`, and a `Location` whose ORIGIN is exactly `https://admin.openbed.ng` |
| probe 8 — the sensor's request: the key in the QUERY, no header (R-2026-10-02-FF FF-5) | `GET /auth/v1/settings?apikey=<the tracked key>` | `200`, `x-openbed-proxy: forwarded`, and a body containing `"disable_signup"` |
| the stamp | `GET` and `HEAD /__openbed/version` | `"commit"` = this checkout's HEAD, `"dirty": false`, and `limits_bound` true for `otp`, `verify` and `refresh`; HEAD `200` with `x-openbed-proxy: stamp` |

*Restated 2026-10-01 (R-2026-09-30-177 FA-1, FA-3): probes 5, 5b, 6 and 7 and `limits_bound`
are new. Probe 5 sends all four upgrade headers over HTTP/1.1 because over HTTP/2, curl's
default, curl drops `Upgrade` and `Connection`, and without the two `Sec-WebSocket` headers
Cloudflare's own edge answers 400 before the Worker runs. Probe 7's `Location` is the admin
origin, not the Site URL (the ward console) that Auth falls back to when it loses
`redirect_to`, so a Worker that loses the parameter reads WRONG. **The status hosted returns
to probe 7 is recorded the first time it is read** (W3 hosted step b); the script holds only
that it is a 3xx. `limits_bound` is the only place a missing rate-limit binding is visible,
because the bindings are not shown in the dashboard and Worker logging is off.*

*Added 2026-10-02 (R-2026-10-02-FF FF-5, -182): probe 8 is the request the second sensor monitor
makes. UptimeRobot's Free plan has keyword monitoring but no custom HTTP headers (read
2026-10-02: "Custom HTTP Headers & Statuses" starts at Solo), so the monitor carries the key in
the query, where Supabase documents it as a header. **Whether the hosted gateway accepts
`?apikey=` for a publishable key is NOT CONFIRMED until this probe reads 200 on hosted.** If it
does not, STOP: do not create the monitor, and Cowork rules. `"disable_signup"` is in GoTrue's
settings answer (INFERRED from its handler; probe 8 is what reads it on hosted), and the Worker's
refusal, Cloudflare's error pages and the site's own HTML cannot contain it, so a keyword monitor
on it cannot be satisfied by a page that is not GoTrue's. Probe 8's three checks are `rb_expect`
reads, not legs.*

*Restated 2026-10-03 (R-2026-10-03-FH FH-1 c, -184). **Probe 8 is CONFIRMED on hosted.** On the
founder's W4 run of 2026-10-03 (read back by Cowork) it read 200, `forwarded`, with `disable_signup`
found in the body, so the hosted gateway DOES take a publishable key from the query, and
`"disable_signup"` is in the settings answer as hosted serves it: no longer only INFERRED from
GoTrue's handler. The STOP clause above was not triggered. Until then the note above read, and is kept
as the record of what was known on 2026-10-02: "Whether the hosted gateway accepts `?apikey=` for a
publishable key is NOT CONFIRMED until this probe reads 200 on hosted", and "(INFERRED from its
handler; probe 8 is what reads it on hosted)".*

*Restated 2026-09-27 (R-2026-09-27-145 DU-2; R-2026-09-27-144 DT k): probe 1's path read
`/rest/v1/rpc/my_facility_wards` until 026 renamed that function, and probe 1b is new. The
values in both rows are the gateway's no-key answer observed on 2026-09-23 on the OLD path;
they are first read on the new paths by the Worker read-back in 025 and 026's hosted run.*

**What the WRONG lines mean:**

- **probe 1, a 401 with no proxy header** — it came from somewhere that is not this
  Worker. **A 404 with `refused`** means the list lost this path, and the ward
  console cannot load.
- **probe 2, HEAD `200`** — this runbook said 200 until 2026-09-23, a value written
  without being observed. Hosted answers `405`: Supabase does not serve HEAD on this
  path, so the `forwarded` header is what proves the Worker forwarded it, and the GET
  half is what proves the tracked key is accepted. This path stays forwarded because
  the ward console's live-key read-back uses it (docs/runbook-ward-console-deploy.md
  step 3; R-2026-09-23-65 B1).
- **probe 3, `{"error":"requested path is invalid"}` with no proxy header** — that is
  Supabase's own 404 at an unknown path, observed by Cowork on 2026-09-23 against the
  old passthrough Worker. It is exactly what a Worker that forwards everything gives.
- **the stamp naming another commit** — the previous Worker is still serving.
- **probe 5 or 6, a status that is not `404`, or no `refused`** — the Worker forwarded a
  service it must never reach. **A `400` with no proxy header on probe 5** is
  Cloudflare's edge answering before the Worker ran: the upgrade headers were not all
  sent, and the probe tested nothing.
- **probe 5b, a `200` with `forwarded`** — the Worker lacks the `Upgrade` refusal (a
  Worker from before W3), so a websocket upgrade on a listed path reaches Supabase.
- **probe 7, a `Location` on the Supabase host, on `api.openbed.ng`, relative, absent, or
  on the ward console** — the redirect is not landing on the admin app. The ward console
  is the Site URL fallback, which is what a lost `redirect_to` produces.
- **the stamp's `limits_bound` reading `false` or `(absent)`** — a binding is not
  attached to the deployed Worker, so that limit forwards everything. `(absent)` is a
  Worker from before W3.

## 3. Probe 4 — the deployed source equals the repository's

Read by Cowork through the Cloudflare connector: the deployed `supabase-proxy` script
contains `not forwarded by the OpenBed proxy`, `/__openbed/version` and
`grant_type=refresh_token`, and its bundled allow-list equals
`supabase-proxy/allow-list.json` **at the deployed commit, entry for entry**:
- every `forward` entry: method, path and query, the `OPTIONS` preflights included;
- its `direct_origin_exceptions`;
- its `refusal_probes`.

**The expected set is taken from that file at that commit, never from this page.** A
count written here goes stale the next time an app gains a call. **Pass:** every entry
present, and no other forwarded path. Nothing in the read-back script can stand in for
this.

On 2026-09-25, at `b056ad1` (H5, R-2026-09-25-110), `forward` was 12 `POST`, 1 `GET` and
12 `OPTIONS`, and probe 4 read PASS.

*Restated 2026-10-01 (R-2026-09-30-177).* The allow-list also carries a `limit` on three
entries now, and `GET /auth/v1/verify` is in `forward` and no longer a direct-origin
exception; the counts at W3's commit are in the table in section 5, which is rendered from
the file. Probe 4's rule is unchanged: the expected set is the file's, entry for entry,
`limit` included.

*Restated 2026-09-25 (R-2026-09-25-110).* Until then this read "exactly the four `POST`
paths and one `GET` path of `supabase-proxy/allow-list.json`'s `forward` list at the
deployed commit". It went stale when PR 3.4b-app C (#77) added sixteen entries, the
eight operator calls and their eight preflights, and did not restate it.

## 4. Worker request logging is off (R-2026-09-26-136 DL-3)

`supabase-proxy/wrangler.json` carries `"observability": { "enabled": false }`, pinned by
`tests/compliance/worker_observability.test.ts`. Every call to the database crosses
this Worker: sign-in requests carrying an address, access tokens, and every visitor's
IP address and headers. The privacy notice says OpenBed keeps no copy of a visitor's
request details, so the Worker keeps no request logs (the record of processing, G4).

**The setting reaches Cloudflare only on a deploy.** The founder's step, after the pull
request that sets it merges: redeploy with `bash scripts/deploy_worker.sh supabase-proxy`
by section 1 above, then run `bash scripts/readback_worker.sh` by section 2. Both must
read as those sections say. The Worker's logging state in Cloudflare's dashboard is not
readable from this repository, so nothing here asserts the deployed setting.

- [x] Redeployed with logging off, and read back (the date, the commit, and the read-back's last line). On 2026-09-27, from the deploy checkout at `3623d2b` (#90's merge; R-2026-09-27-139 DO-1 c, completed by DO-6): `deploy_worker.sh supabase-proxy`, Current Version ID `ea32b1ae-3107-4f9a-a406-7f3d361a91cb`, the stamp confirmed on attempt 1; `readback_worker.sh` read PASS on probes 1 to 3 and the stamp (Cowork's reading of the founder's output). Its last line is the script's success verdict, `PASS: probes 1 to 3 and the stamp read as they must. Probe 4, the deployed source, is Cowork's, read through the Cloudflare connector.`, quoted from `scripts/readback_worker.sh` at `3623d2b`, not from the founder's terminal. Probe 4, read by Cowork through the Cloudflare connector: the deployed source is the proxy handler with the tracked allow-list, and `version.json` reads commit `3623d2b`, dirty false.
  - **The hosted setting, read by the founder on 2026-09-27** (R-2026-09-27-139 DO-6): Cloudflare dashboard, Workers & Pages → `supabase-proxy` → Settings → Observability reads **disabled**, for the `ea32b1ae` deploy. That matches `supabase-proxy/wrangler.json` `"observability": { "enabled": false }`. The connector cannot read this setting, so the founder's read is its only observation, and it is recorded here as that.

## 5. Surface — what `api.openbed.ng` forwards (R-2026-09-30-177 FA-1, FA-3)

Every `forward` entry of `supabase-proxy/allow-list.json`, in file order, with the limit
bound to it. **This table is rendered, not written:** `tests/compliance/proxy_surface_table.test.ts`
renders it from the allow-list and `supabase-proxy/wrangler.json` and compares it byte for
byte with the text between the markers, so an entry added, removed or reworded, or a limit
that moves, turns the build red until this page is restated.

<!-- surface:begin -->
| Method | Path | Pinned query | Limit | Reason |
|---|---|---|---|---|
| POST | /auth/v1/otp | — | LIMIT_OTP (5 per 10 s) | packages/auth/src/request.ts: a ward, or the operator on admin.openbed.ng, asks for its own sign-in link |
| POST | /auth/v1/token | grant_type=refresh_token | LIMIT_REFRESH (10 per 10 s) | packages/auth/src/holder.ts: session refresh, the only grant the code sends |
| POST | /rest/v1/rpc/my_reporting_wards | — | — | apps/ward-console: the handover load |
| POST | /rest/v1/rpc/publish_ward_status | — | — | apps/ward-console: a ward publishes |
| POST | /rest/v1/rpc/operator_register | — | — | apps/admin: the register load, and reload after every write |
| POST | /rest/v1/rpc/operator_scheduler_status | — | — | apps/admin: the system status load |
| POST | /rest/v1/rpc/operator_get_contact | — | — | apps/admin: a facility's detail opens |
| POST | /rest/v1/rpc/operator_create_facility | — | — | apps/admin: the operator creates a facility |
| POST | /rest/v1/rpc/operator_edit_facility | — | — | apps/admin: the operator edits a facility |
| POST | /rest/v1/rpc/operator_add_category | — | — | apps/admin: the operator adds a ward category |
| POST | /rest/v1/rpc/operator_record_contact | — | — | apps/admin: the operator records a facility's contact |
| POST | /rest/v1/rpc/operator_record_agreement | — | — | apps/admin: the operator records a facility's agreement |
| POST | /rest/v1/rpc/operator_set_facility_listed | — | — | apps/admin: the operator lists a facility |
| POST | /rest/v1/rpc/operator_record_registration | — | — | apps/admin: the operator records a facility's HEFAMAA registration number (R-2026-09-27-144 DT k, Bundle 3), and probe 1b of docs/runbook-cloudflare-worker-proxy.md, run by scripts/readback_worker.sh |
| POST | /rest/v1/rpc/operator_record_reporting_approval | — | — | apps/admin: the operator records the reporting model a facility approved in its signed Schedule 1 (R-2026-09-30-201 GA; ruling FX P2) |
| GET | /auth/v1/settings | — | — | runbook probe: the ward console's live-key probe (docs/runbook-ward-console-deploy.md step 3, run by scripts/readback_ward_console.sh; R-2026-09-23-65 B2), and probe 2 of docs/runbook-cloudflare-worker-proxy.md, run by scripts/readback_worker.sh |
| GET | /auth/v1/verify | — | LIMIT_VERIFY (5 per 10 s) | the emailed sign-in link: docs/auth-email-templates/ (R-2026-09-22-55 C, option T1) |
| OPTIONS | /auth/v1/otp | — | — | preflight for POST /auth/v1/otp |
| OPTIONS | /auth/v1/token | — | — | preflight for POST /auth/v1/token |
| OPTIONS | /rest/v1/rpc/my_reporting_wards | — | — | preflight for POST /rest/v1/rpc/my_reporting_wards |
| OPTIONS | /rest/v1/rpc/publish_ward_status | — | — | preflight for POST /rest/v1/rpc/publish_ward_status |
| OPTIONS | /rest/v1/rpc/operator_register | — | — | preflight for POST /rest/v1/rpc/operator_register |
| OPTIONS | /rest/v1/rpc/operator_scheduler_status | — | — | preflight for POST /rest/v1/rpc/operator_scheduler_status |
| OPTIONS | /rest/v1/rpc/operator_get_contact | — | — | preflight for POST /rest/v1/rpc/operator_get_contact |
| OPTIONS | /rest/v1/rpc/operator_create_facility | — | — | preflight for POST /rest/v1/rpc/operator_create_facility |
| OPTIONS | /rest/v1/rpc/operator_edit_facility | — | — | preflight for POST /rest/v1/rpc/operator_edit_facility |
| OPTIONS | /rest/v1/rpc/operator_add_category | — | — | preflight for POST /rest/v1/rpc/operator_add_category |
| OPTIONS | /rest/v1/rpc/operator_record_contact | — | — | preflight for POST /rest/v1/rpc/operator_record_contact |
| OPTIONS | /rest/v1/rpc/operator_record_agreement | — | — | preflight for POST /rest/v1/rpc/operator_record_agreement |
| OPTIONS | /rest/v1/rpc/operator_set_facility_listed | — | — | preflight for POST /rest/v1/rpc/operator_set_facility_listed |
| OPTIONS | /rest/v1/rpc/operator_record_registration | — | — | preflight for POST /rest/v1/rpc/operator_record_registration |
| OPTIONS | /rest/v1/rpc/operator_record_reporting_approval | — | — | preflight for POST /rest/v1/rpc/operator_record_reporting_approval |
<!-- surface:end -->

**Methods.** `POST`, `GET` and `OPTIONS` only; `HEAD` is served on a `GET` entry.
Everything else is refused by the Worker and never reaches Supabase.

**Services reached.** Auth's four paths (`otp`, `token`, `verify`, `settings`) and
PostgREST's `rpc`, and nothing else. A forward entry under Realtime, Storage, Functions,
GraphQL, pg-meta, Auth's admin API, or PostgREST outside `rpc` turns
`tests/compliance/proxy_allow_list.test.ts` red (`SERVICE`), and probe 6 and probe 5 read
it on hosted.

**Websocket upgrades.** None is forwarded. The handler refuses any request carrying an
`Upgrade` header before it reads the list, because the header would otherwise be copied
on to Supabase from a listed `GET`. Probe 5 reads it on a service the Worker never
reaches; probe 5b is the only hosted test of it on a listed path.

**Location under manual redirect.** The Worker fetches with `redirect: "manual"` and
passes a `Location` through untouched. Verify is the one path that redirects; probe 7
reads where it lands.

**CORS.** The Worker's own answers, `refused` and `limited`, carry
`access-control-allow-origin: *` and expose `x-openbed-proxy`, so a browser page can read
which of them it got. Preflights reach the gateway only for paths a browser calls by
`fetch`; verify has none, because a sign-in link is a navigation.

**The limits** (FA-3, re-sized by FB-1). Three `ratelimits` bindings in `wrangler.json` count
sign-in requests, link opens and session refreshes per client address, over a 10-second
window, at the Cloudflare location that served each. Counters are cached on the machine
that runs the Worker and updated asynchronously (Cloudflare: "permissive, eventually
consistent, and intentionally designed to not be used as an accurate accounting system"),
so they are per machine and not per location alone; the bindings are not shown in the
dashboard. A request
over its limit is answered by the Worker, `429`, `x-openbed-proxy: limited`, `retry-after: 60`
(deliberately conservative: the window is 10 seconds, but a fixed window can be crossed at a
boundary), and Supabase is not contacted. A missing binding, a limiter that fails, and a
limiter that does not answer within a quarter of a second, all forward: a limiter must never
take sign-in down, and `limits_bound` in the stamp is where a missing binding would show.

**Why 10 seconds, and why the limits are small.** The key is the client address, so one
hospital's NAT address is one key. **Supabase's per-IP buckets burst to a FIXED 30** that the
dashboard cannot change (GoTrue's `apilimiter.go` builds them with `SetBurst(30)`; the
dashboard figure sets only the refill rate), and every facility shares that 30 through the
Worker's one address. A Cloudflare `simple` limit counts per period and does not spread
requests across it, so with a fixed window one address can get about twice its limit in any
10 seconds, and **twice the limit must stay under 30** (the test holds it). At that design
bound one address on ONE CONNECTION cannot empty a bucket; three can for otp or verify, and
two for refresh, which is the register's trigger on a distributed drain. A client that opens
a new connection for every request is not held to that bound (see "What the edge limits do, and what they do not", below). At a shift change, six links
REQUESTED in one 10-second window at one address is possible at a teaching hospital, and the
sixth request (`POST /auth/v1/otp`) can get the flat "answered" message and no email; the
sixth link OPENED (`GET /auth/v1/verify`) in one window can get the limited-link sentence
instead, and then the link is not spent. A request for a link that the Worker limited gets its
own message since W4: "Too many sign-in links were asked for from this network just now. Wait one
minute, then ask again." (R-2026-10-02-FF FF-3). Refresh is lazy, and a limited refresh no longer
signs a handset out: it keeps the session and the old access token while that has more than 30
seconds left, sends no refresh for 60 seconds, and otherwise tells the ward the sign-in could not be
renewed just now and is kept (FF-2). `LIMIT_REFRESH` therefore bounds how many handsets behind one
address may refresh in one window, and a handset past it waits a minute instead of being signed out.
The full argument is in the header of `tests/compliance/proxy_limits_config.test.ts`.

*Restated 2026-10-02 (R-2026-10-02-FF FF-2 f, FF-3, -182). Until then this paragraph read:*
"Whether a limited request gets its own message is W4's ruling. Refresh is lazy and a limited
refresh is terminal today, so `LIMIT_REFRESH` can sign handsets out when more than its limit behind
one address refresh in one window; facility one has one login."

*Restated 2026-10-02 (R-2026-09-30-181 FE-6 d). With per-machine counting these are at-most
outcomes, not certainties. Until then this paragraph read:* "the sixth request (`POST
/auth/v1/otp`) gets the flat "answered" message and no email; the sixth link OPENED (`GET
/auth/v1/verify`) in one window gets the limited-link sentence instead, and the link is not
spent", *and* "so `LIMIT_REFRESH` bounds how many handsets behind one address may refresh in
one window".

*Restated 2026-10-01 (R-2026-09-30-178 FB-1 c). Until then this paragraph read:* "Three
`ratelimits` bindings in `wrangler.json` count sign-in requests, link opens and session
refreshes per client address, over 60 seconds, at the Cloudflare location that served each.
[...] A request over its limit is answered by the Worker, `429`, `x-openbed-proxy: limited`,
`retry-after: 60`, and Supabase is not contacted." *The 60-second figures could let one
address empty the 30-burst in one second.*

**What the edge limits do, and what they do not (R-2026-09-30-180 FD-2 a).** There is one
limit per key per Cloudflare location, but the counters are cached on the machine running the
Worker and updated asynchronously. A client that keeps one connection, as a browser or a
ward's handset does, is counted as designed: on hosted, 2026-10-01, one connection read 6
forwarded and then every later request answered `limited`. A client that opens a new
connection for every request can exceed the limits until the counts catch up: on hosted,
2026-10-01, the limits proof sent 15 requests that way, twice, and all 15 were forwarded both
times. **So the edge limits slow a careless or naive flood and do not bound a deliberate
one.** Supabase's raised per-IP limits (W3 hosted step a) and the register's trigger on a
distributed drain are the backstop. *Restated 2026-10-01 (R-2026-09-30-180 FD-2 a). Until
then the two paragraphs above, with "Counters are local to each location, permissive and
eventually consistent" and "At that design bound one address alone cannot empty a bucket",
read as if the limits bound every client at the design figure; that holds for a client on
one connection and does not hold for a client that opens a new connection for every
request.*

## 6. Worker down (R-2026-10-02-FF FF-6, -182; R-2026-09-19-23 D5)

This answers D5's four questions, in order: what breaks, how anyone notices, what the client does, and
what to do. **Nothing in it has been run on hosted.** No hosted step takes the Worker away: no ward
login exists on hosted (DY-2), and production is not broken to prove a fallback. The fallback is proved
locally, by `tests/db/ward_console_fallback_acceptance.test.ts`.

### a. What breaks

| The outage | The ward console | Admin | The public page | Sign-in links |
|---|---|---|---|---|
| **A Worker that throws or is undeployed** (Cloudflare answers its own error page, 1101 for a throw) | It falls back, so load, publish, refresh and a link request all work. A NEW sign-in does not: the emailed link opens on the Worker. | Fails, but its sessions are kept (FF-2). The operator has the Supabase dashboard. | `/beds.json` and `/api/health` read Supabase directly and are unaffected. | Dead until the Worker is back or the templates are rolled back. |
| **A lost route or DNS** (`api.openbed.ng` does not resolve, or no route reaches the Worker) | The same as above. | The same as above. | Unaffected. | Dead, as above. |
| **The Free plan's daily pool spent** (error 1027) | The same as above: Cloudflare's page carries no CORS header, so the browser's fetch rejects. | The same as above. | Unaffected. | Dead, as above. |
| **Allow-list drift** (the Worker answers `refused` for a path an app calls) | It falls back on the Worker's own `refused`, which proves Supabase was never contacted, so a re-send cannot duplicate anything. | Shows the "Worker refused" sentence. Sessions are kept. | Unaffected. | Dead if the drifted path is `/auth/v1/verify`; otherwise as above. |
| **A Cloudflare-wide outage** | **The Pages sites are down too, and nothing here helps.** | Down with the site. | Down with the site. | Nothing to open them on. |

**An ISP block of `*.supabase.co` only disables the fallback**: the Worker path still works, because
the browser reaches `api.openbed.ng`, which is not on that block.

### b. How anyone notices

By **the second monitor** (`docs/runbook-sensor.md` section 1): a keyword monitor on
`api.openbed.ng/auth/v1/settings`, by email to the support address and by push to the founder's
phone. **A ward never sees the fallback, which is the point, so that monitor is the only signal.** It
cannot see whether the fallback itself works.

### c. What the client does

The ward console sends each call to the Worker first and, only when the Worker does not answer or
answers with its own `refused`, sends the SAME call byte for byte to the Supabase origin directly; a
publish re-sent that way replays and never writes twice (migration 026 steps 5 and 6, measured by
`tests/db/publish_concurrent_resend.test.ts`). After a Worker failure it tries the direct origin first
for five minutes, and a renewal that is only "not now" (a 429, a 409, a 5xx, a `refused`, or no answer)
keeps the session and tells the ward so, where it used to sign the handset out. It never retries a
write in the background.

**The bounds, each read from the code by `tests/compliance/auth_fallback.test.ts`:** one call is at
most two sends of 12 s, so 24 s; a refresh is three attempts of that pair with its backoff, 73.25 s
(36 s before this change); a sign-in request is two attempts of a pair, 48 s; and a publish tap's
`composed_at` ages at most 97.25 s, under migration 026's two-minute STALE_MUTATION window.

### d. What to do

1. Read the stamp and run the read-back, and write down the time and what failed:
   `bash scripts/readback_worker.sh https://api.openbed.ng` from the deploy checkout (section 2).
2. If a deploy caused it, redeploy the last good commit by section 1, and read back again.
3. **If the Worker is not reading back PASS within 30 minutes of the alert, OR a ward reports it
   cannot sign in, roll the two templates back** to the default confirmation URL variable (W3 hosted
   step c's rollback). New links then open on the direct origin, and the console's fallback carries the
   rest. This is the dashboard edit, and it is issued by Cowork one fence at a time:

   ```text
   Supabase dashboard, Authentication, Email Templates: in BOTH the Magic Link and the Confirm signup
   template, put the default confirmation URL variable back as the href. Read both back.
   ```

4. Once `readback_worker.sh` reads PASS again, re-paste the tracked template bodies (the BODY only, from
   after the header's closing line, as W3 step c does and FE-1 ruled), then read a real link back. Each
   command is issued on its own, and the second copy replaces the first on the clipboard, so each is
   pasted and saved BEFORE the next is copied:

   ```bash
   sed '1,/^-->$/d' docs/auth-email-templates/magic-link.html | pbcopy
   ```

   Paste it into the Magic Link template, replacing the body, and save.

   ```bash
   sed '1,/^-->$/d' docs/auth-email-templates/confirm-signup.html | pbcopy
   ```

   Paste it into the Confirm signup template, replacing the body, and save.

   Wait 2 minutes after the second save.

   Request an operator link at admin.openbed.ng and copy it from the email.

   ```bash
   pbpaste | node scripts/readback_signin_link.mjs --mode admin --project-ref klrlpxysjsjpdkeqdhvl
   ```

   *Restated 2026-10-03 (R-2026-10-02-FG FG-6, -183). Until then this step ran the two `pbcopy` fences and
   the link reader back to back: the second copy overwrote the first before anything was pasted, and
   `pbpaste` then fed the Confirm signup body to the link reader. The paste, the wait and the request are
   W3 step c's. The 2 minutes give the template change time to reach new emails and let the verify limit's
   window pass from any link opened during the outage; W3's wait follows the limits proof, which this
   section has no counterpart for.*

5. Cowork reads the edge logs for the outage window, as at the monthly drill
   (`docs/runbook-sensor.md` section 3).

**NOT ASSERTED, and not assertable from this repository:** that the 30-minute figure in step 3 is the
right one. It is a decision, taken once, and `tests/compliance/worker_down_runbook.test.ts` holds that it
is stated in one place, and (since FG-6) the ORDER of step 4's lines: each `sed` fence before its own paste-and-save
line, and the wait and the request before the link reader. *Restated 2026-10-03 (FG-6). Until then this read:*
"holds only that it is stated in one place." 

## W3 hosted steps (R-2026-09-30-177 FA-6)

**Run on 2026-10-01** by the founder, from the dashboards and the deploy checkout
at `48b2af5307d93b415733a499c94305808e4c4e11` (#109's merge). Each step was read back by
Cowork before the next (R-2026-09-30-180 FD-5 c); the readings are in the checkbox after step
e. Claude Code ran nothing hosted. Steps a, b and c read PASS. Step b.2 stood in by a
one-connection read: the proof as written then opened a new connection for every request and
stopped twice, for the reason step b.2's restated note gives, and Cowork ruled the one-
connection read, 6 forwarded then 9 `limited`, as the proof of the limiter on hosted. Step c
pasted the tracked template BODIES only, from the `<h2>` line down: the header comment holds
internal notes and ruling references, and a comment would travel in every email's source.
**Step e ran on 2026-10-03**, and its record is `docs/runbook-sensor.md`'s second drill record (R-2026-09-30-186 FJ-1 c).
*Restated 2026-10-04 (R-2026-09-30-186 FJ-1 c): until then this read:* "**Step e is outstanding** and may run on any day."
*Restated 2026-10-01 (R-2026-09-30-180 FD-5 c): until then this section opened with:*
"**Written, not run.** Cowork issues them one at a time after the merge word."
**The order is load-bearing:** Supabase's buckets are raised before the Worker's limiter is live, and
the Worker must forward verify before any email links to it, or every sign-in link hits
the Worker's refusal. **Once the templates link to `api.openbed.ng`, deploying a Worker
from before W3 breaks every sign-in link. Put the templates back first** (step c's
rollback).

a. **Supabase: Authentication, Rate Limits, and the Email provider settings.** Read and
   record everything first: each value, and its burst if shown. **The burst is fixed at 30 in
   GoTrue and cannot be set** (`SetBurst(30)` in `apilimiter.go`, read at `ce9a8eee`): the
   raise below sets the refill rate, and "its burst if shown" stays a read. Then set sign-ups and
   sign-ins per IP to 600 per 5 minutes; token verifications per IP to 600 per 5 minutes;
   token refreshes per IP to 1500 per 5 minutes; Email OTP length to the longest the
   dashboard offers (wards click links and never type the code, and the verify raise lets
   one address make more guesses at a code). Read and record, unchanged: Email OTP
   expiration, and emails sent per hour (project-wide, not per IP; Cowork compares it with
   the shift-change arithmetic before step b). **If a field will not take its value, or is
   not editable, record what it shows and STOP. Do not run step b; Cowork rules.**
b. **The Worker.** **First, read the zone's Pseudo IPv4 setting** (R-2026-09-30-178 FB-1 i):
   in the Cloudflare dashboard, on the `openbed.ng` zone, Network, Pseudo IPv4, and record it.
   If it reads "Overwrite Headers", `cf-connecting-ip` carries a pseudo IPv4 value in place of
   the client's IPv6 address, which defeats the /64 key: **STOP for Cowork.** "Off" or "Add
   header" proceeds. Then redeploy by section 1. **If the upload refuses a binding: STOP, and
   do not run step c** (the founder's call on Workers Paid then belongs to the register's
   plan trigger). Then, from the deploy checkout: 1. `bash scripts/readback_worker.sh
   https://api.openbed.ng` with probes 5, 5b, 6 and 7 and `limits_bound` all true;
   2. `bash scripts/readback_worker_limits.sh https://api.openbed.ng`, once (it sleeps 61
   seconds, then sends three times the limit in verify requests, all in ONE curl invocation
   so that they share one connection, and reads that they did; run it only after step a);
   3. probe 4, by Cowork. Record the status probe 7 returned.
   *Restated 2026-10-01 (R-2026-09-30-178 FB-1 c, f, i): until then step b.2 read "...it sleeps
   61 seconds, then sends the limit plus five verify requests; run it only after step a...",
   and step b had no Pseudo IPv4 read.*
   *Restated 2026-10-01 (R-2026-09-30-180 FD-1 f): until then step b.2 read "...it sleeps 61
   seconds, then sends three times the limit in verify requests; run it only after step
   a...". The proof now runs over one connection, and checks that it did, because
   Cloudflare caches each count on the machine that runs the Worker and syncs it
   asynchronously, so a new connection per request lands on machines whose counts have not
   caught up. On 2026-10-01 the old proof stopped twice (15 forwarded, none limited), and
   the same 15 requests over one connection read 6 forwarded and 9 limited. Its record is
   -180's (the decision record, held outside this repository).*
c. **The templates, only after a and b read as they must.** 1. Read the dashboard's
   current Magic Link and Confirm signup templates and give them to Cowork, who compares
   them with the tracked files in `docs/auth-email-templates/` before anything is pasted;
   2. paste the tracked BODY only: everything after the header's closing `-->` line
   (`sed '1,/^-->$/d' docs/auth-email-templates/magic-link.html | pbcopy`, and the same for
   `confirm-signup.html`), which starts at the unindented `<h2>` line, as on 2026-10-01;
   never the header comment, which holds internal notes and would travel in every email's
   source (R-2026-09-30-181 FE-1); 3. wait 2 minutes after step b.2, then request an operator
   link and pipe it into `scripts/readback_signin_link.mjs --mode admin`: PASS; 4. sign in
   with it, through Access, to the register. **Rollback:** put the default confirmation URL
   variable back as the href, in both templates.
   *Restated 2026-10-02 (R-2026-09-30-181 FE-1): until then step c.2 read "paste the tracked
   files". Cowork had ruled on 2026-10-01 that only the body is pasted, but the ruling stood only
   in the "Run on" paragraph; a rollback re-paste of the whole file would have carried the header
   comment into every email. "From the `<h2>` line down" is ambiguous, because each header
   quotes the default body with an indented `<h2>`, so an unanchored `sed -n '/<h2>/,$p'`
   starts inside the comment: the command above is anchored on the header's closing line, and
   `tests/compliance/proxy_allow_list.test.ts` runs it over both templates.*
d. **The closes, which the 12.4 step names:** D3 on probes 5, 5b, 6 and 7; D4 on step a,
   the limits proof and `limits_bound`, with Cowork's attribution read; -55 C on step c's
   PASS and the sign-in.
e. **The drill again,** by `docs/runbook-sensor.md` section 3 as amended, on the same day
   or any later one: both times recorded, and the job kept off until `snapshot_stale` is
   written down. Its record closes the `snapshot_stale` box in 12.4.
   *Restated 2026-10-04 (R-2026-09-30-186 FJ-1 c): step e ran on 2026-10-03. `snapshot_stale` was recorded (read on
   hosted at 23:07:07Z, `snapshot_age_s` 188); `job_inactive` was NOT OBSERVED; and the job was kept off until
   `snapshot_stale` was written down, as this step says. Its record is `docs/runbook-sensor.md`'s second drill
   record, and it closed the `snapshot_stale` box in 12.4. Until then this step stood as written above, as a step
   not yet run.*

- [x] On 2026-10-01, steps a, b and c, from the dashboards and the deploy checkout at `48b2af5307d93b415733a499c94305808e4c4e11`. The readings are the founder's, relayed by Cowork (the W3 hosted-run readings, kept in Cowork's records held outside this repository; R-2026-09-30-180 FD-5 b). **Step a:** sign-ups and sign-ins per IP 30 to 600 per 5 minutes; token verifications 30 to 600; token refreshes 150 to 1500; email OTP length 8 to 10, held after save (GoTrue accepts 6 to 10 and resets anything else to 6); unchanged: emails sent 30 an hour (project-wide), OTP expiration 3600 s, SMS, anonymous and Web3; the page shows no burst figure; "Enable IP address forwarding" OFF, unchanged. PASS. **Step b:** Pseudo IPv4 on the `openbed.ng` zone read Off; `deploy_worker.sh` DONE at attempt 1 of 12, wrangler 4.134.0 listing `env.LIMIT_OTP` (5 requests/10s), `env.LIMIT_VERIFY` (5 requests/10s) and `env.LIMIT_REFRESH` (10 requests/10s), version `ea537d20-17a8-4181-9534-3048510d84a5`; **the upload accepted all three bindings on the account's free Workers plan**, which answers FA-3 a (the plan trigger in the register is untouched). `readback_worker.sh` PASS: probes 1, 1b, 2 and 3 as before; probes 5, 5b and 6 read 404, refused, the Worker's own body; probe 7 read STATUS 303, forwarded, `Location` origin exactly the admin origin (its first hosted reading); the stamp read `48b2af5`, dirty false, `limits_bound` all true. Probe 4, Cowork's reading through the Cloudflare connector: PASS, the bundle equal to `supabase-proxy/allow-list.json` at `48b2af5` entry for entry (forward 30: 14 POST, 2 GET, 14 OPTIONS; 2 direct-origin exceptions; 3 refusal probes). **Step b.2:** `readback_worker_limits.sh` STOPPED twice, 15 forwarded and none limited each time (the loop took 16 s, then 17 s); one diagnostic Cowork authorised, the same 15 verifies in a single curl invocation, read requests 1 to 6 forwarded and 7 to 15 `limited`; the cause is Cloudflare's per-machine counters, not the Worker. **Step c:** both live template bodies were Supabase's defaults before the change; the tracked BODY was pasted (from `<h2>` down, by a terminal command, never retyped); both read back equal to the tracked bodies, subjects unchanged; `readback_signin_link.mjs --mode admin` read PASS on a real operator link (`redirect_to` percent-encoded in lower case, decoding to exactly the admin origin); the operator signed in and reached the register at `admin.openbed.ng`; Cowork's `edge_logs` read, 20:25Z to 20:50Z, showed two link requests and two link opens, all from Cloudflare, and over 19:00Z to 20:50Z all 149 Cloudflare-borne requests carried one and the same client address (not recorded here). PASS. **Step e:** run on 2026-10-03; see the sensor runbook's second drill record.
  *Restated 2026-10-04 (R-2026-09-30-186 FJ-1 c): until then the last words of the line above read* "**Step e:** not run."

## W4 hosted steps (R-2026-10-02-FF FF-9, -182)

**Run on 2026-10-03** by the founder, from the deploy checkout at
`87aa410005e6b306ec15485a68cd8c741e201944` (#111's merge). Each step was read back by Cowork before the
next (R-2026-10-03-FH FH-1 b); the readings are in the checkbox after step d. Claude Code ran nothing
hosted. Steps a, b and c read PASS, and D5 closed on them (R-2026-10-03-FH FH-2). **Two things the run
found are not in the steps as written.** The ward console's first build FAILED before upload, because the
first `npm ci` had skipped the native workerd binary for the platform without saying so; nothing was
deployed, and `npm ci --include=optional` added it (the deploy wrappers now check for it before any
build, FH-3). And the ward console's first read-back gave NO VERDICT: curl exit 28, a 12-second timeout
on the founder's network, while Cowork's fetch from outside read 200 in 0.55 s; the re-run read PASS.
*Restated 2026-10-03 (R-2026-10-03-FH FH-1 b, -184): until then this section opened with:* "**Written,
not run.** Cowork issues them one at a time, after the merge word on W4's pull request."

Cowork issued them one at a time, after the merge word on W4's pull request. Claude
Code runs nothing hosted. They are D5's closing readings (R-2026-09-19-23 D5, by R-2026-09-22-56 A9), and
they are read together with the local proof, `tests/db/ward_console_fallback_acceptance.test.ts`.

**No hosted step takes the Worker away.** No ward login exists on hosted (DY-2), and production is not
broken to prove a fallback. What the hosted steps prove is that every piece the fallback relies on is
deployed and reads as it must: the ward console's CSP names the direct origin, admin's still does not, the
Worker is at the merge commit, and the monitor that is the only signal of a Worker outage is alive.

a. **The ward console, then the admin app, each redeployed at the merge commit by its own runbook**
   (`docs/runbook-ward-console-deploy.md` and `docs/runbook-admin-deploy.md`, section 1 of each), each
   read back before the next. `bash scripts/readback_ward_console.sh` reads PASS, and it now expects the
   direct Supabase origin in `connect-src`; `bash scripts/readback_admin.sh` reads PASS, and it still
   expects the API origin alone.
b. **The Worker, redeployed at the merge commit by section 1.** No forward entry changes. The bundle does,
   because `allow-list.json`'s serve.ts reason was restated (FF-7), so the redeploy is needed for probe 4 as
   well as for the stamp (`readback_worker.sh` requires the stamp to equal this checkout's HEAD).
   *Restated 2026-10-03 (R-2026-10-02-FG FG-9 e, -183); until then this step read: "There is no code change
   to the Worker. The redeploy is for the stamp, because `readback_worker.sh` requires the stamp to equal this
   checkout's HEAD." It missed that supabase-proxy/index.js bundles the allow-list file, so a reason text is
   a deploy.*
   Then `bash scripts/readback_worker.sh https://api.openbed.ng`, whole, probe 8 included. **If probe 8
   reads the gateway refusing the key in the query: STOP. Do not create the monitor; Cowork rules.**
   Probe 4, the deployed source equalling the repository's, is Cowork's, through the Cloudflare connector.
c. **The second monitor, created in UptimeRobot as `docs/runbook-sensor.md` section 1 words it**, only
   after b reads PASS. It reads green within 10 minutes, and the founder's screenshot is the reading.
d. **The close: D5**, in `docs/runbook-supabase-project-creation.md` step 12.4, on a, b and c together with
   the local proof. The founder's readings are relayed by Cowork, and nothing in this repository can show them.

- [x] On 2026-10-03, steps a, b and c, from the deploy checkout at `87aa410005e6b306ec15485a68cd8c741e201944`. The readings are the founder's, relayed by Cowork (the W4 hosted-run readings, kept in Cowork's records held outside this repository; R-2026-10-03-FH FH-1 b). **Step a:** `deploy_pages.sh --branch main ward-console`: the first build FAILED before upload, `wrangler pages functions build` throwing that the platform's workerd package could not be found (`npm config get omit` printed nothing; `npm ci --include=optional` added 223 packages against the first run's 222, with the platform binary present; INFERRED: npm skipped a failed optional download without saying so; the lockfile lists the package and had not changed since 48b2af5). The ward console deployed as 7414a2e2 (project openbed-ward-console), stamp 87aa410, clean, read back by the wrapper before upload. `readback_ward_console.sh`, first run: NO VERDICT, curl exit 28 on /version.json from the founder's network (Cowork's outside fetch at the same moment: 200, commit 87aa410, dirty false); second run PASS: `connect-src 'self'`, the API origin and the direct Supabase origin on the deployment and on app.openbed.ng, scripts own-host, favicon byte-equal on both hosts, font/woff2 served, one publishable key in the bundle (live half 200, dead half 401). Admin deployed as 8a0d148c, stamp 87aa410, clean; `readback_admin.sh` PASS: without the Access service token all six host reads gave 302 to Access, the stamp named 87aa410 on the deployment and on admin.openbed.ng, the CSP is `connect-src 'self'` and the API origin only on both, the operator call answered 401, marked `forwarded`. **Step b:** `deploy_worker.sh supabase-proxy` DONE, version `f9f88b09-d297-447e-bf9d-f4e847e371ed`, bindings LIMIT_OTP and LIMIT_VERIFY at 5 requests per 10 s and LIMIT_REFRESH at 10 per 10 s, the stamp naming 87aa410 on attempt 1 of 12. `readback_worker.sh https://api.openbed.ng` PASS: probes 1 and 1b 401 forwarded; probe 2 GET 200 and HEAD 405, both forwarded; probes 3, 5, 5b and 6 404, refused, the Worker's own body; probe 7 303 forwarded with the `Location` origin admin.openbed.ng; **probe 8 read 200, forwarded, with `disable_signup` found, so the hosted gateway takes a publishable key from the query**; the stamp 87aa410, dirty false, `limits_bound` all true, HEAD 200 marked `stamp`. Probe 4, Cowork's reading through the Cloudflare connector: PASS, the bundled stamp 87aa410 with dirty false, the bundled allow-list 30 forward entries, 2 direct_origin_exceptions and 3 refusal_probes with FF-7's restated serve.ts reason, and handler.ts matching the repository's. **Step c:** the second monitor created in UptimeRobot (Free): "OpenBed Worker (api.openbed.ng)", type Keyword, on the settings URL with the publishable key in the query (put on the clipboard from the tracked file, never printed), keyword `"disable_signup"` with its quotes, alerting when the keyword does not exist, every 5 minutes, to the support address by email and the founder's phone app. The founder's screenshot of the monitor list shows both monitors green: "OpenBed health" up 2 days 20 hours and the new one up 3 minutes 41 seconds. **Not run, by design:** no hosted step took the Worker away (FF-9), and no ward login exists on hosted (DY-2); the fallback's proof is local, `tests/db/ward_console_fallback_acceptance.test.ts`, green in CI on 87aa410 (push run 37115451672). **Step d:** D5 closed in the runbook's 12.4 step 1 by R-2026-10-03-FH FH-2.
  *Restated 2026-10-03 (R-2026-10-03-FH FH-1 b, -184): until then this box read:* "- [ ] W4's hosted steps a, b and c. Not run."

## What stays true after this deploy, and what does not

- **The emailed sign-in link is consumed through this Worker, since W3.** It opens
  `GET /auth/v1/verify` on `api.openbed.ng`, listed in `forward` and counted by
  `LIMIT_VERIFY` (R-2026-09-30-177 FA-2, option T1). **Once the Magic Link and Confirm
  signup templates link here, deploying a Worker from before W3 breaks every sign-in
  link. Put the templates back first** (step c's rollback above). T2, a fragment token
  the app posts, stays the named fallback; T1 keeps the link a GET, as it always was, so
  a mail scanner that prefetches it can spend a token, exactly as it can today.
  *Restated 2026-10-01 (R-2026-09-30-177 FA-2). Until then this bullet read:* "The emailed
  sign-in link is NOT consumed through this Worker. It opens `GET /auth/v1/verify` on the
  direct `*.supabase.co` origin, named as a direct-origin exception in the allow-list
  (R-2026-09-23-70 C2). If -55 C routes a custom domain through this Worker,
  `GET /auth/v1/verify` must be listed first, or every sign-in link breaks."
- **The `/beds.json` Function does not use this Worker** (-58 A5); it reads the
  Supabase origin directly as standing design (R-2026-10-02-FF FF-7, -182).
  *Restated 2026-10-02. Until then this bullet read:* "it reads the Supabase origin
  directly until -23 D5 closes." `/api/health` does the same, for the same reasons and one
  more: a health check through the Worker would report the Worker's health.
- **Sign-up is not forwarded.** The ward identity design is invite-only.
