# Runbook — the sensor: what tells the founder the snapshot has stopped

**Written 2026-09-30 (R-2026-09-30-175 EY-4), for W2 of the facility-one build.** This is
the one runbook for the sensor. It absorbs the runbook the earlier planning documents call
the snapshot-stopped runbook: they keep their citations as written, and each names a path
whose absence is now the design.

**Status of the drill in section 3: run on hosted on 2026-09-30, and its alert arrived**,
by email and by phone push, both at 20:59Z (the record is at the end of section 3). It is
run monthly. The sensor box in the Supabase runbook's 12.4 is ticked on that alert
(R-2026-09-30-177 FA-5 d). **The age arm, `snapshot_stale`, was NOT observed on hosted
in that drill, and was read on the second, on 2026-10-03** (R-2026-09-30-186 FJ-1 g): the
second box in 12.4 closed on it.
*Restated 2026-10-01 (R-2026-09-30-177 FA-5 c): until then this read "NOT YET RUN on
hosted. It is run before facility one, then monthly. Until it has alerted on hosted, the
sensor box in the Supabase runbook's 12.4 stays unticked; it closes citing this runbook
when the alert has arrived."*
*Restated 2026-10-04 (R-2026-09-30-186 FJ-1 g): until then the bold sentence read "**The
age arm, `snapshot_stale`, was NOT observed on hosted in that drill:** a second box in 12.4
stays open until a drill records when it first showed." The second drill's record, at the
end of section 3, is the reading that closed that box.*

Every psql block here begins with step P's PATH line from the Supabase runbook
(`docs/runbook-supabase-project-creation.md`), and the connection line is pasted alone:
the value is given at its prompt, and the block after it ends with the `unset`.

---

## 1. What watches what

**The public page degrades on its own.** From 3 minutes after the last snapshot, the page
greys its rows and shows a banner. Nothing in that reaches a person who is not looking at it.
The sensor exists so that something OUTSIDE both Supabase and Cloudflare tells the founder.

**`/api/health` is the endpoint.** It is a Pages Function on the public site. It reads one
function, `public.health_probe()`, as `service_role`, and answers:

- **200** with `openbed-ok` in the body, when the newest snapshot is young and its scheduled job
  is present and switched on;
- **503** with `openbed-fail` in the body and the reasons listed, otherwise.

**Its four reasons, and what each means:**

| Reason | Means | Threshold |
|---|---|---|
| `snapshot_stale` | The newest snapshot is old, or there is none, or its timestamp is in the future | 3 minutes, the same threshold the public banner uses; a timestamp more than 5 seconds ahead of the database's clock counts as stale |
| `job_absent` | No pg_cron job named `openbed_regenerate_snapshot` | none |
| `job_inactive` | That job exists and is switched off | none |
| `probe_failed` | The probe did not produce a usable answer: an error, a timeout (5 seconds), a refusal, a missing key, or a body of the wrong shape | none |

A failed LAST RUN is deliberately not a reason: one transient failure would alarm while the public
page shows no banner. A job that keeps failing stops new snapshots, the age passes the
threshold, and `snapshot_stale` catches it. The admin app's System status shows a failed last
run as its own line, so the operator sees it there.

The answer is cached at the edge for 30 seconds, both 200 and 503, so a change in the database
shows on `/api/health` within about 30 seconds.

**The monitor** is UptimeRobot (free): a keyword monitor on `openbed.ng/api/health`, keyword
`openbed-ok`, alerting when the keyword does NOT exist, every 5 minutes, by email to the support
address and by push to the founder's phone app. Created by the founder on 2026-09-30 and reading green;
that is the founder's reading, relayed by Cowork, not something this repository can show.

**The second monitor** (R-2026-10-02-FF FF-5 d, -182) is on the Worker, in UptimeRobot, worded as the first:
a keyword monitor on `api.openbed.ng/auth/v1/settings`, with the publishable key as `apikey` in the
QUERY (`https://api.openbed.ng/auth/v1/settings?apikey=<the tracked publishable key>`), keyword
`"disable_signup"`, alerting when it does NOT exist, every 5 minutes, to the same two contacts: the
support address by email and the founder's phone app by push. **The key is in the query, not a header,
because UptimeRobot's Free plan cannot send one** (its pricing page, read 2026-10-02: "Custom HTTP
Headers & Statuses" starts at Solo). Supabase documents the key as a header, so **whether the hosted
gateway accepts it in the query is NOT CONFIRMED until `scripts/readback_worker.sh` probe 8 reads it**
(`docs/runbook-cloudflare-worker-proxy.md` section 2). Create this monitor only after probe 8 reads
PASS. The keyword is GoTrue's own: the Worker's refusal, Cloudflare's error pages and the site's HTML
cannot contain it, so only a real settings answer keeps the monitor green.

**Created by the founder on 2026-10-03, reading green; the keyword was entered with its quotes.** Its
name is "OpenBed Worker (api.openbed.ng)", type Keyword, every 5 minutes, alerting when the keyword does
not exist, to the support address by email and the founder's phone app. The URL, carrying the publishable
key in the query, was put on the clipboard from the tracked file and never printed. The founder's screenshot
of the monitor list shows both monitors green ("OpenBed health" up 2 days 20 hours, this one up 3 minutes
41 seconds). That is the founder's reading, relayed by Cowork, not something this repository can show
(R-2026-10-03-FH FH-1 d, -184).

*Restated 2026-10-03 (R-2026-10-03-FH FH-1 c, -184). **Probe 8 read PASS on hosted** on the founder's W4
run of 2026-10-03: 200, `forwarded`, with `disable_signup` found, so the hosted gateway DOES accept the key
in the query, and the monitor was created after it, as the order required. Until then this paragraph said
"whether the hosted gateway accepts it in the query is NOT CONFIRMED until `scripts/readback_worker.sh`
probe 8 reads it" and "Create this monitor only after probe 8 reads PASS". Both sentences are kept above as
the order the steps were meant to run in; the first no longer holds.*

**What the second monitor watches:** DNS, the route, the Worker running, the allow-list forwarding
`/auth/v1/settings`, and Supabase's gateway answering. **What it cannot see: whether the ward console's
fallback works.** A ward never sees the fallback, which is the point, so this monitor is the only signal
that the Worker is down (`docs/runbook-cloudflare-worker-proxy.md` section 6). **The key lives in this
monitor's URL**, so a publishable-key rotation moves it in the same change
(`docs/runbook-key-rotation.md`): without that, the monitor goes red on every rotation, which is loud, and wrong.

**The monitor reads a body keyword, not a status,** because the founder set the Pages project to
FAIL OPEN (the founder's reading of 2026-09-30, recorded in R-2026-09-30-174). Once the free daily
request pool is spent, `/api/health` is not answered by the Function at all: the site's own HTML
comes back with a 200. A status check would read that as healthy for as long as the pool stays spent.
The keyword cannot be faked by the site's HTML.

**What the monitor cannot see:** that the database's job actually ran, only that the newest snapshot
row is young and the job is present and on. A job that is on and failing every run reads 503 through
the age, after 3 minutes.

---

## 2. An alert arrived

**First, open `openbed.ng/api/health` in a browser tab.** Read what the tab shows. Do not run
`curl` for this: the tab is what the monitor would see, and it is enough. Then take the branch
that matches.

- **The tab reads 200 `openbed-ok`.** It has recovered. Write down the time, and read System status for a
  failed last run.
- **The page is the site's HTML, not JSON.** The Function did not run. Either the free daily pool is
  spent (fail open; read the Cloudflare dashboard's daily request count for the Pages project) or the
  Function is not deployed. **A spent pool never reads `probe_failed`:** a spent pool means the
  Function was never reached. If the pool is spent, the alert is the sensor working, and the fix is
  the plan, not the database.
- **`snapshot_stale`.** Open the admin app's System status and read the two ages and the five jobs. If
  every job reads Running and the snapshot is old, the snapshot job is failing: its row on System status
  shows its last run, and the probe read below shows the same as `last_status`. Stop and report.
- **`job_inactive` or `job_absent`.** Run the jobs read, below. A job that reads `f` is switched off:
  someone did it, or a drill was left unrestored. If it is `openbed_regenerate_snapshot`, restore it by
  section 3's steps 4 and 5. If it is any other job, stop and report: the restore fence switches on the
  snapshot job only. A job that is missing is a defect: stop and report.
- **`probe_failed`.** First whether Supabase is up (its status page and the dashboard), then whether the
  Pages Function holds its `service_role` key: a rotated or removed key reads here, because the probe
  is refused. Do not paste the key anywhere. Redeploy from the runbook that deploys Pages if the key was
  changed.

**The probe, read as `service_role`.** This is exactly what the Function reads. It prints `SET`,
then one line of JSON: `server_now`, `generated_at`, `last_snapshot_at` and the five jobs.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"; read -rs DATABASE_URL && export DATABASE_URL
```

Paste the line above on its own, and give it its value at its prompt. Then paste:

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
psql "$DATABASE_URL" -Atc 'set role service_role; select public.health_probe()'
unset DATABASE_URL
```

Read `generated_at` against `server_now`: the difference is the snapshot's age on the database's clock.

**The jobs read.** Which of the five `openbed_` jobs are switched on.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"; read -rs DATABASE_URL && export DATABASE_URL
```

Paste the line above on its own, and give it its value at its prompt. Then paste:

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
psql "$DATABASE_URL" -Atc "select jobname, active from cron.job where starts_with(jobname, 'openbed_') order by 1;"
unset DATABASE_URL
```

Five rows are expected on hosted. `t` is switched on and `f` is switched off.

**What to tell wards, and when.** While the snapshot is stale the public page already says so, so
visitors are not misled. Wards keep reporting as normal: the server stores each report it accepts, and the
public page shows it once the snapshot job has run. A ward whose own page says a save failed sends it
again by hand; nothing is queued anywhere to be replayed later. Tell a ward only if the stop lasts longer
than an hour, and then say what you know: that the page is out of date, that their reports are safe, and when
you expect it back.

**When to restore.** As soon as the cause is understood and it is safe to. Restoring only switches the
existing job back on; it creates nothing. After it, the snapshot regenerates within a minute, and the monitor
goes green within one of its 5-minute checks plus the 30-second cache.

---

## 3. The fire drill

**Run before facility one, then monthly.** The alarm is only known to work if it has alerted. This drill
switches the snapshot job off on hosted, reads the alert arrive, and switches it on again.

**While the job is off, the public page shows its stale banner.** No facility is listed yet, so that harms no
one today. **After facility one, the monthly drill runs in the small hours, Lagos time, with a note to the wards
first.**

**Do not run `readback_pages.sh` during a drill:** it stops on the 503 the drill is producing on purpose.

**Before you start, open two things:** `openbed.ng/api/health` in a browser tab, and the phone with the
monitor's app and the email inbox in view. Write down the time you pause.

**If you stop the drill for any reason after step 1, go straight to step 4 and then step 5. Never leave
the job switched off.**

**1. Pause the snapshot job.**

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"; read -rs DATABASE_URL && export DATABASE_URL
```

Paste the line above on its own, and give it its value at its prompt. Then paste:

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
psql "$DATABASE_URL" -c "select cron.alter_job(jobid, active := false) from cron.job where jobname = 'openbed_regenerate_snapshot' and username = current_user"
unset DATABASE_URL
```

It must print `(1 row)`. `(0 rows)`, or any `ERROR` line: stop and report; nothing was switched off.

**2. Watch `/api/health`.** Reload the tab about every 30 seconds, from the first reload after the pause.

- (1) **Paste each reload's whole body to Cowork as you read it.** Its `checked_at` is the database's clock at the
  probe, so nothing is timed by eye.
- (2) The first body with `job_inactive` in `reasons` gives the first time. It reads 503 with `openbed-fail` within
  about 30 seconds (the edge cache).
- (3) The first body with `snapshot_stale` in `reasons` gives the second time. It takes at least 3 minutes to
  appear.
- (4) **Keep the job switched off until the body with `snapshot_stale` has been pasted AND both alerts have
  arrived**, so the age arm is seen live and not only the job arm.

The cache holds an answer for 30 seconds, so a body's `checked_at` can lag the reload by up to that long, and the
first body may already show both reasons. Then each time is "showing by that `checked_at`", not "first at it". A
body that repeats the last one's `checked_at` is fine: paste it and reload again. The pause time and the two alert
times stay written down by hand, because they have no body.

*Restated 2026-10-01 (R-2026-09-30-177 FA-5 c): until then this step said to keep the job off until the reasons
included `snapshot_stale`, and did not say to write the times down; on 2026-09-30 the job was restored once both
alerts had arrived and neither time was noted (see the record below).*

*Restated 2026-10-04 (R-2026-09-30-186 FJ-3 a): until then the live text of this step, from "Reload the tab.", read:*
"Reload the tab. Within about 30 seconds (the edge cache) it reads 503 with `openbed-fail` and `job_inactive` among
the reasons. **Write down, as they happen, the time `job_inactive` first shows and the time `snapshot_stale` first
shows. Keep the job switched off until the second is written down AND both alerts have arrived** (`snapshot_stale`
takes at least 3 minutes to appear), so the age arm is seen live and not only the job arm. Reload the tab every 30
seconds or so: the time written is the first reload that shows it." *On 2026-09-30 neither time was written; on
2026-10-03 one was, and it was the one that arrived as a paste of the body (see the two records below). A body
carries `checked_at`, so a pasted body is a reading and a remembered minute is not; the step made the reading
depend on a note taken while watching, and no longer does.*

**3. Record the alert's arrival, on the email AND on the phone.** The monitor checks every 5 minutes, so
the first alert can take that long after the 503 begins. Write down both times. If neither alert has arrived
15 minutes after the tab first read 503, go to step 4 anyway, restore, and report that the monitor did not alert.

**4. Restore the job.**

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"; read -rs DATABASE_URL && export DATABASE_URL
```

Paste the line above on its own, and give it its value at its prompt. Then paste:

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
psql "$DATABASE_URL" -c "select cron.alter_job(jobid, active := true) from cron.job where jobname = 'openbed_regenerate_snapshot' and username = current_user"
unset DATABASE_URL
```

It must print `(1 row)`. Then step 5, whatever it printed.

**5. The restore read-back, in its own fence.** The jobs read must show FIVE rows, all `t`.
**Anything else: STOP.** A `f` means a job is still switched off; do not go on to the next step, and do
not treat the drill as finished. Run the restore fence again, then this one, and report if it will not read
five `t`.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"; read -rs DATABASE_URL && export DATABASE_URL
```

Paste the line above on its own, and give it its value at its prompt. Then paste:

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
psql "$DATABASE_URL" -Atc "select jobname, active from cron.job where starts_with(jobname, 'openbed_') order by 1;"
unset DATABASE_URL
```

**6. Watch the monitor go green again.** Reload the `/api/health` tab: 200 with `openbed-ok` within about 30
seconds. The monitor reads green within its next 5-minute check.

**7. The records.** Write down, in the change that records the drill:

- when the job was paused;
- **when `job_inactive` first showed, and when `snapshot_stale` first showed** (step 2) (the `checked_at` of the
  first body that carried each);
- when the first alert arrived, on the email and on the phone;
- when it was restored;
- what the restore read-back showed (five rows, all `t`);
- when the monitor read green again.

*Restated 2026-10-04 (R-2026-09-30-186 FJ-3 b): until then the second bullet read* "**when `job_inactive` first
showed, and when `snapshot_stale` first showed** (step 2);". *Step 2 now gets each time from a pasted body, so the
record names the body.*

**And the monthly log read, which is Cowork's, taken with the drill:** the count of `429`
answers for `api.openbed.ng` (the Worker's own `limited` answers) from Cloudflare's traffic
analytics for that hostname, filtered to status `429`, which is an aggregate and carries no
address (the Worker keeps no request logs, DL-3); and any Supabase `429` on
`/auth/v1/otp`, `/auth/v1/verify` or `/auth/v1/token` at the Worker's address, from
Supabase's edge logs. **That read is the reader of the register's trigger on the shared
per-IP bucket** (R-2026-09-30-177 FA-5 e): a Supabase `429` there means the edge limits
did not hold back the traffic that reached Supabase (they slow a careless or naive flood
and do not bound a deliberate one, because Cloudflare's counters are per machine and
synced asynchronously), and the trigger has fired. *Restated 2026-10-01
(R-2026-09-30-180 FD-2 a): until then this read* "means the edge limits no longer protect
the other wards, and the trigger has fired". If Cloudflare's analytics does
not offer the status filter, record that: the Worker-side half of this read is then NOT
ASSERTED, and the Supabase half stands alone.

The drill's alert arriving is what closes the sensor box in the Supabase runbook's 12.4, citing
R-2026-09-30-175 and this runbook. **The `snapshot_stale` box closed on 2026-10-04, on the second
drill's record below** (R-2026-09-30-186 FJ-1 g). *Restated 2026-10-04 (R-2026-09-30-186 FJ-1 g): until
then this read* "**The `snapshot_stale` box closes on a drill that records the second time in step 2.**"

### Record: the first drill on hosted, 2026-09-30 (R-2026-09-30-175, R-2026-09-30-177 FA-5 c)

Run by the founder from `~/Desktop/OpenBed-NG-deploy` at `7b71b28`, each fence read back by Cowork
before the next. **Observed**, from the founder's terminal and the alert email and phone push, as
relayed by Cowork:

- paused at **20:54:46Z**, one `cron.alter_job` row;
- the first alert, by **email** and by **phone push**, both at **20:59Z**;
- restored at **21:02:14Z**, one `cron.alter_job` row (the job was off for 7 minutes 28 seconds);
- the restore read-back: five rows, all `t`;
- the monitor green again at **21:04Z**.

**NOT OBSERVED: `snapshot_stale`.** The founder restored the job once both alerts had arrived and did
not note when `job_inactive` or `snapshot_stale` first appeared. **By the timings** `snapshot_stale` was
showing from about 20:57:30Z, but that is **inference, not a reading**. The job arm and the alert path are
proven on hosted. The age arm is proven locally only (`tests/compliance/health_decision.test.ts`, over the decision in `packages/snapshot/src/health.ts`).
The root cause is that step 7's list of what to record did not ask for those times, so nothing prompted
them; it asks now. A drill that records both closes the `snapshot_stale` box in 12.4.

*Restated 2026-10-04 (R-2026-09-30-186 FJ-1 b): the second drill, below, read `snapshot_stale` on hosted. The
paragraph above stands as the 2026-09-30 drill's record.*

### Record: the second drill on hosted, 2026-10-03 (R-2026-09-30-186 FJ-1 b)

Run by the founder, from section 3, one fence at a time, each fence read back by Cowork before the next, at main
`2f9111f`. Claude Code ran nothing. **Observed**, from the founder's terminal, the pasted `/api/health` bodies, and
the alert email and phone push, as relayed by Cowork (hosted-run-drill-2026-10-03-readings.md, in Cowork's build
records; R-2026-09-30-186 FJ-1 b). In time order:

- paused at **23:04Z**, the terminal printing `(1 row)`;
- **`job_inactive` first showed: NOT OBSERVED.** The founder did not note it (step 7 asks for it);
- the first alert, on the **phone app** and by **email**, both at **23:06Z**, to the minute;
- **`snapshot_stale`** first showed, on the first reload the founder noticed it on, at **23:07:07Z**. The body he
  pasted read `reasons` `["snapshot_stale","job_inactive"]` and `snapshot_age_s` 188, with the job inactive and its
  last start at 23:04:00;
- restored at **23:10Z**, the terminal printing `(1 row)`;
- the restore read-back: five rows, all `t`;
- the monitor ("OpenBed health") green again at **23:11Z**;
- a body at **23:12:48Z** read `openbed-ok`, `snapshot_age_s` 48, the job active. That is a reading, and **not
  necessarily the first** `openbed-ok`.

The job was off for about 6 minutes. **The times are in Z.** The founder gave them on his own clock, which reads one
hour ahead of UTC; that offset is **inferred** from the pasted body's `checked_at` and `last_start_time`, and he did
not state it. `checked_at` is the database's clock at the probe (`server_now`), not the founder's, and the 30-second
edge cache means a body can lag his reload by up to 30 seconds.

**READ.** The age arm, `snapshot_stale`, shows live on hosted for the first time: a body with `snapshot_stale` in its
`reasons` and `snapshot_age_s` 188 was pasted, where the 2026-09-30 drill's reading of the age arm was inference from
timings. The alert path worked again, on both channels, at 23:06Z.

**INFERRED, not read.** The first alert came from the job arm, because it arrived a minute before `snapshot_stale`
showed at 23:07:07Z. No body from before 23:07 was read, so nothing in a body says what the reasons were at 23:06.

**NOT CLAIMED.** When `job_inactive` first showed. That 23:12:48Z is the first `openbed-ok`. And that the **second**
monitor ("OpenBed Worker (api.openbed.ng)") alerts: this drill pauses the snapshot job, which the FIRST monitor
watches. The second monitor has been read green and has not been seen to alert; its path to the founder's two
contacts was configured as the first's was and has not been exercised. The founder ruled on 2026-10-04 that it needs
no test. That is his ruling and not a deferral, so it has no row in the register.

**The monthly log read** (step 7, Cowork's), taken with the drill, from Supabase's edge logs for the project:

- 22:55Z to 23:20Z on 2026-10-03, every path: 19 requests, all 200, 3 of them on `/auth/v1/` (all
  `/auth/v1/settings`);
- 00:00Z to 23:30Z on 2026-10-03, the `/auth/v1/` paths only: `/auth/v1/settings` 69 at 200, 2 at 401 and 1 at 405;
  `/auth/v1/verify` 1 at 303. No request to `/auth/v1/otp` or `/auth/v1/token`, and no `429` read anywhere. That the
  401, 405 and 303 match the same day's W4 read-back probes is **inferred**;
- **not read:** paths outside `/auth/v1/` over those 23.5 hours, and anything before 00:00Z on 2026-10-03. The
  trigger on the shared per-IP bucket (a Supabase `429` at the Worker's address) has not fired in what was read.

**The Worker's half of that read is NOT ASSERTED.** The founder read Cloudflare's traffic analytics for the account
(Free plan) on 2026-10-04, and it offers no filter on status code, so the `429` count for `api.openbed.ng` cannot be
read. That is the founder's reading, relayed by Cowork, and not something this repository can show. The Worker keeps
no request logs (DL-3), so there is no other source, and the Supabase half above stands alone, as step 7 says it
then does.

This record closes the `snapshot_stale` box in the Supabase runbook's 12.4 (R-2026-09-30-186 FJ-1 d).
