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

**Paste each block into an interactive shell.** No `exit`, and no variable called
`path` or `status` (both break zsh).

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

## 2. The four probes — each with its failing half built in

**Probe 1 — no key: forwarded, and refused by Supabase's gateway.**

```bash
curl -sS -o /dev/null -D - -X POST https://api.openbed.ng/rest/v1/rpc/my_facility_wards -H 'Content-Type: application/json' -d '{}' | grep -i -E '^HTTP|^sb-project-ref|^x-openbed-proxy'
```

**Pass — all three:** `HTTP/2 401`, `sb-project-ref: klrlpxysjsjpdkeqdhvl`,
`x-openbed-proxy: forwarded`. A 401 without the proxy header came from somewhere that
is not this Worker; a 404 with `x-openbed-proxy: refused` means the list lost this path
and the ward console cannot load.

**Probe 2 — the tracked key: forwarded, and accepted.** The key is read from the
checkout, where it is tracked (R-2026-09-22-61); it is the publishable key, public by
design.

```bash
KEY="$(node -e 'process.stdout.write(require("./packages/origins/publishable-keys.json").production)')"
curl -sS -o /dev/null -D - -H "apikey: $KEY" https://api.openbed.ng/auth/v1/settings | grep -i -E '^HTTP|^x-openbed-proxy'
curl -sS -I -H "apikey: $KEY" https://api.openbed.ng/auth/v1/settings | grep -i -E '^HTTP|^x-openbed-proxy'
```

**Pass:** the GET read shows `HTTP/2 200` and `x-openbed-proxy: forwarded`. The HEAD
read (sent with `curl -I` — never `-X HEAD`, which waits for a body that never comes)
shows `HTTP/2 405` and `x-openbed-proxy: forwarded`: Supabase does not serve HEAD on
this path (observed on hosted 2026-09-23, Cowork's reading and the founder's H5 output),
so the header is what proves the Worker forwarded it, and the GET half is what proves
the tracked key is accepted. **Until 2026-09-23 this read "both … `HTTP/2 200`" — a
value stated without being observed** (R-2026-09-23-70, the H5 note). This is the path the ward console's live-key probe uses (docs/runbook-ward-console-deploy.md
step 3), which is why it stays forwarded (R-2026-09-23-65 B1).

**Probe 3 — off the list: refused HERE, and Supabase is never asked.**

```bash
curl -sS -D - https://api.openbed.ng/rest/v1/ | grep -i -E '^HTTP|^x-openbed-proxy|not forwarded'
```

**Pass — all three:** `HTTP/2 404`, `x-openbed-proxy: refused`, and the body line
`{"message":"not forwarded by the OpenBed proxy"}`. **Supabase's own 404 at an unknown
path reads `{"error":"requested path is invalid"}` with no proxy header** — observed by
Cowork on 2026-09-23 against the old passthrough Worker (-70) — and it is exactly the
answer a Worker that forwards everything would give.

**Probe 4 — the deployed source equals the repository's.** Read by Cowork through the
Cloudflare connector: the deployed `supabase-proxy` script contains
`not forwarded by the OpenBed proxy`, `/__openbed/version`, `grant_type=refresh_token`
and exactly the four `POST` paths and one `GET` path of `supabase-proxy/allow-list.json`'s
`forward` list at the deployed commit. **Pass:** all present, and no other forwarded
path.

## 3. The stamp

```bash
curl -sS https://api.openbed.ng/__openbed/version
curl -sS -I https://api.openbed.ng/__openbed/version | grep -i -E '^HTTP|^x-openbed-proxy'
```

**Pass:** the first prints `"commit"` equal to the wrapper's HEAD and `"dirty": false`;
the second shows `HTTP/2 200` and `x-openbed-proxy: stamp`.

## What stays true after this deploy, and what does not

- **The emailed sign-in link is NOT consumed through this Worker.** It opens
  `GET /auth/v1/verify` on the direct `*.supabase.co` origin, named as a direct-origin
  exception in the allow-list (R-2026-09-23-70 C2). **If -55 C routes a custom domain
  through this Worker, `GET /auth/v1/verify` must be listed first, or every sign-in
  link breaks.**
- **The `/beds.json` Function does not use this Worker** (-58 A5); it reads the
  Supabase origin directly until -23 D5 closes.
- **Sign-up is not forwarded.** The ward identity design is invite-only.
