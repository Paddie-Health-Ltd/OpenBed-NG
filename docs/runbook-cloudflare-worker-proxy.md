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
#67).** `~/Desktop/OpenBed-NG` is also the implementer's working tree, and a
`git checkout main` there was refused on 2026-09-23 over uncommitted work in progress.
The deploy checkout is a separate `git worktree`, detached at `origin/main`, that
nothing else writes to. Before every deploy, refresh it and read its HEAD:

```bash
git -C ~/Desktop/OpenBed-NG-deploy fetch origin && git -C ~/Desktop/OpenBed-NG-deploy checkout --detach origin/main && (cd ~/Desktop/OpenBed-NG-deploy && npm ci)
cd ~/Desktop/OpenBed-NG-deploy && git rev-parse HEAD
```

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

## 2. The read-back — probes 1 to 3, 5, 5b, 6, 7 and the stamp, in one run

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
a new connection for every request is not held to that bound (see the next paragraph). At a shift change, six links
REQUESTED in one 10-second window at one address is possible at a teaching hospital, and the
sixth request (`POST /auth/v1/otp`) gets the flat "answered" message and no email; the sixth
link OPENED (`GET /auth/v1/verify`) in one window gets the limited-link sentence instead, and
the link is not spent. Whether a limited request gets its own message is W4's ruling. Refresh is lazy and a limited refresh is terminal today, so `LIMIT_REFRESH`
bounds how many handsets behind one address may refresh in one window; facility one has one
login. The full argument is in the header of `tests/compliance/proxy_limits_config.test.ts`.

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

## W3 hosted steps (R-2026-09-30-177 FA-6)

**Run on 2026-10-01** by the founder, from the dashboards and `~/Desktop/OpenBed-NG-deploy`
at `48b2af5307d93b415733a499c94305808e4c4e11` (#109's merge). Each step was read back by
Cowork before the next (R-2026-09-30-180 FD-5 c); the readings are in the checkbox after step
e. Claude Code ran nothing hosted. Steps a, b and c read PASS. Step b.2 stood in by a
one-connection read: the proof as written then opened a new connection for every request and
stopped twice, for the reason step b.2's restated note gives, and Cowork ruled the one-
connection read, 6 forwarded then 9 `limited`, as the proof of the limiter on hosted. Step c
pasted the tracked template BODIES only, from the `<h2>` line down: the header comment holds
internal notes and ruling references, and a comment would travel in every email's source.
**Step e is outstanding** and may run on any day.
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
   -180's (`Sprint Kickoffs/decision-2026-09-14-public-private-split.md`).*
c. **The templates, only after a and b read as they must.** 1. Read the dashboard's
   current Magic Link and Confirm signup templates and give them to Cowork, who compares
   them with the tracked files in `docs/auth-email-templates/` before anything is pasted;
   2. paste the tracked files; 3. wait 2 minutes after step b.2, then request an operator
   link and pipe it into `scripts/readback_signin_link.mjs --mode admin`: PASS; 4. sign in
   with it, through Access, to the register. **Rollback:** put the default confirmation URL
   variable back as the href, in both templates.
d. **The closes, which the 12.4 step names:** D3 on probes 5, 5b, 6 and 7; D4 on step a,
   the limits proof and `limits_bound`, with Cowork's attribution read; -55 C on step c's
   PASS and the sign-in.
e. **The drill again,** by `docs/runbook-sensor.md` section 3 as amended, on the same day
   or any later one: both times recorded, and the job kept off until `snapshot_stale` is
   written down. Its record closes the `snapshot_stale` box in 12.4.

- [x] On 2026-10-01, steps a, b and c, from the dashboards and `~/Desktop/OpenBed-NG-deploy` at `48b2af5307d93b415733a499c94305808e4c4e11`. The readings are the founder's, relayed by Cowork (hosted-run-w3-2026-10-01-readings.md, in Cowork's build records; R-2026-09-30-180 FD-5 b). **Step a:** sign-ups and sign-ins per IP 30 to 600 per 5 minutes; token verifications 30 to 600; token refreshes 150 to 1500; email OTP length 8 to 10, held after save (GoTrue accepts 6 to 10 and resets anything else to 6); unchanged: emails sent 30 an hour (project-wide), OTP expiration 3600 s, SMS, anonymous and Web3; the page shows no burst figure; "Enable IP address forwarding" OFF, unchanged. PASS. **Step b:** Pseudo IPv4 on the `openbed.ng` zone read Off; `deploy_worker.sh` DONE at attempt 1 of 12, wrangler 4.134.0 listing `env.LIMIT_OTP` (5 requests/10s), `env.LIMIT_VERIFY` (5 requests/10s) and `env.LIMIT_REFRESH` (10 requests/10s), version `ea537d20-17a8-4181-9534-3048510d84a5`; **the upload accepted all three bindings on the account's free Workers plan**, which answers FA-3 a (the plan trigger in the register is untouched). `readback_worker.sh` PASS: probes 1, 1b, 2 and 3 as before; probes 5, 5b and 6 read 404, refused, the Worker's own body; probe 7 read STATUS 303, forwarded, `Location` origin exactly the admin origin (its first hosted reading); the stamp read `48b2af5`, dirty false, `limits_bound` all true. Probe 4, Cowork's reading through the Cloudflare connector: PASS, the bundle equal to `supabase-proxy/allow-list.json` at `48b2af5` entry for entry (forward 30: 14 POST, 2 GET, 14 OPTIONS; 2 direct-origin exceptions; 3 refusal probes). **Step b.2:** `readback_worker_limits.sh` STOPPED twice, 15 forwarded and none limited each time (the loop took 16 s, then 17 s); one diagnostic Cowork authorised, the same 15 verifies in a single curl invocation, read requests 1 to 6 forwarded and 7 to 15 `limited`; the cause is Cloudflare's per-machine counters, not the Worker. **Step c:** both live template bodies were Supabase's defaults before the change; the tracked BODY was pasted (from `<h2>` down, by a terminal command, never retyped); both read back equal to the tracked bodies, subjects unchanged; `readback_signin_link.mjs --mode admin` read PASS on a real operator link (`redirect_to` percent-encoded in lower case, decoding to exactly the admin origin); the operator signed in and reached the register at `admin.openbed.ng`; Cowork's `edge_logs` read, 20:25Z to 20:50Z, showed two link requests and two link opens, all from Cloudflare, and over 19:00Z to 20:50Z all 149 Cloudflare-borne requests carried one and the same client address (not recorded here). PASS. **Step e:** not run.

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
  Supabase origin directly until -23 D5 closes.
- **Sign-up is not forwarded.** The ward identity design is invite-only.
