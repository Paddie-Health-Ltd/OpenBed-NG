# Runbook — the sensor: what tells the founder the snapshot has stopped

**Written 2026-09-30 (R-2026-09-30-175 EY-4), for W2 of the facility-one build.** This is
the one runbook for the sensor. It absorbs the runbook the earlier planning documents call
the snapshot-stopped runbook: they keep their citations as written, and each names a path
whose absence is now the design.

**Status of the drill in section 3: NOT YET RUN on hosted.** It is run before facility
one, then monthly. Until it has alerted on hosted, the sensor box in the Supabase runbook's
12.4 stays unticked; it closes citing this runbook when the alert has arrived.

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

**2. Watch `/api/health`.** Reload the tab. Within about 30 seconds (the edge cache) it reads 503 with
`openbed-fail` and `job_inactive` among the reasons. **Keep the job switched off until the reasons include
`snapshot_stale` AND both alerts have arrived** (`snapshot_stale` takes at least 3 minutes to appear), so the
age arm is seen live and not only the job arm.

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
- when the first alert arrived, on the email and on the phone;
- when it was restored;
- what the restore read-back showed (five rows, all `t`);
- when the monitor read green again.

The drill's alert arriving is what closes the sensor box in the Supabase runbook's 12.4, citing
R-2026-09-30-175 and this runbook.
