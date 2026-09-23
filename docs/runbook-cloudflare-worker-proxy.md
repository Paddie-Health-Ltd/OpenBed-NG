# Runbook — deploying the `api.openbed.ng` Worker, and proving what it forwards

**Every deploy of `supabase-proxy/` runs all of it.** Since PR 3.3 (R-2026-09-23-70) the
Worker forwards only what the apps call — `supabase-proxy/allow-list.json`, held equal
to the code by `tests/compliance/proxy_allow_list.test.ts` — and answers everything else
itself. A deploy that has not been read back and probed is a claim about what is live,
not a fact.

**Every probe below proves who answered by a HEADER, never by a body shape**
(R-2026-09-23-70 C1). The Worker marks each answer `x-openbed-proxy: forwarded`,
`refused` or `stamp`. Hosted's own no-key answer comes from Supabase's gateway, with a
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

## 2. The read-back — probes 1 to 3 and the stamp, in one run

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
| probe 1 — no key: forwarded, refused by Supabase's gateway | `POST /rest/v1/rpc/my_facility_wards`, no key | `401`, `sb-project-ref: klrlpxysjsjpdkeqdhvl` (read from `packages/origins/origins.json`), `x-openbed-proxy: forwarded` |
| probe 2 — the tracked key: forwarded, accepted | `GET /auth/v1/settings` with the key from `packages/origins/publishable-keys.json` | `200`, `x-openbed-proxy: forwarded` |
| probe 2, HEAD half | the same, as HEAD (`curl -I`, never `-X HEAD`) | `405`, `x-openbed-proxy: forwarded` |
| probe 3 — off the list: refused HERE, Supabase never asked | `GET /rest/v1/` | `404`, `x-openbed-proxy: refused`, body `{"message":"not forwarded by the OpenBed proxy"}` |
| the stamp | `GET` and `HEAD /__openbed/version` | `"commit"` = this checkout's HEAD, `"dirty": false`; HEAD `200` with `x-openbed-proxy: stamp` |

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

## 3. Probe 4 — the deployed source equals the repository's

Read by Cowork through the Cloudflare connector: the deployed `supabase-proxy` script
contains `not forwarded by the OpenBed proxy`, `/__openbed/version`,
`grant_type=refresh_token` and exactly the four `POST` paths and one `GET` path of
`supabase-proxy/allow-list.json`'s `forward` list at the deployed commit. **Pass:** all
present, and no other forwarded path. Nothing in the read-back script can stand in for
this.

## What stays true after this deploy, and what does not

- **The emailed sign-in link is NOT consumed through this Worker.** It opens
  `GET /auth/v1/verify` on the direct `*.supabase.co` origin, named as a direct-origin
  exception in the allow-list (R-2026-09-23-70 C2). **If -55 C routes a custom domain
  through this Worker, `GET /auth/v1/verify` must be listed first, or every sign-in
  link breaks.**
- **The `/beds.json` Function does not use this Worker** (-58 A5); it reads the
  Supabase origin directly until -23 D5 closes.
- **Sign-up is not forwarded.** The ward identity design is invite-only.
