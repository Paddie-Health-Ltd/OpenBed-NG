# Runbook — deploying the ward console, and reading it back

**Every ward-console deploy runs all three steps, including the first one (H4).**
Steps 2 and 3 are one script run, not a paste (R-2026-09-23-70, the H4 note: on H4
itself, `read -r DEPLOY_URL` consumed the next pasted line, every probe ran against an
empty host, and a good deploy read as a failed one).
A deploy that has not been read back is a claim about what is live, not a fact.

The ward console is the one app here whose bundle carries a **credential**: the
publishable key, tracked in `packages/origins/publishable-keys.json` since
R-2026-09-22-61. **No test in this repository can tell a live key from a dead one** —
a revoked key is still perfectly well-formed, and every guard over it stays green.
**Step 3 is the only check that can**, which is why it runs on every deploy and not
only on a rotation (R-2026-09-23-64).

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
bash scripts/deploy_pages.sh --branch main ward-console
```

The wrapper refuses a dirty tree, a commit that is not on `origin/main`, and a build
whose stamp does not name the commit it verified. **Copy the deployment URL wrangler
prints** (`https://<hash>.openbed-ward-console.pages.dev`); steps 2 and 3 take it as
their argument. Once `app.openbed.ng` exists, either URL works — they serve the same
deployment.

## 2. Run the read-back — it reads `/version.json` and runs step 3's probe

From the same deploy checkout, with the deployment URL from step 1 in place of
`HASH`:

```bash
bash scripts/readback_ward_console.sh https://HASH.openbed-ward-console.pages.dev
```

**Step 2** is its first two checks: the deployed `/version.json` must name **this
checkout's HEAD** (the commit the wrapper printed) with `"dirty": false`. Run it before
refreshing the checkout.

## 3. The live-key probe — BOTH halves, run by the same script

Step 3 reads the key **out of the deployed bundle**, never out of the repository:
the property is that the key the deployment actually ships is accepted, and a key read
from a checkout would prove something about the checkout. It then makes the same
request twice: once with that key, once with a key that is deliberately wrong. **The
wrong-key half is not optional.** Without it, a probe that could never fail would read
exactly like one that passed.

The script prints one line per check, each `ok` or `WRONG` with the value it must
have, and ends with exactly one verdict, **`PASS:` (exit 0)** or **`STOP:` (exit 1)**.
Paste the whole output back. `ERROR:` with exit 2 means a check could not run (no
network, or not run from a checkout), which is neither a pass nor a failure of the
deploy. **Run with no URL, or a non-https one, it STOPs before sending anything** — the
failing half of H4's false STOP.

**Pass — every line `ok`, exactly these values:**

| Line | Must read |
|---|---|
| `step 2 commit` / `step 2 dirty` | **this checkout's HEAD** / **`false`** |
| `step 3 bundles the page loads` | **`1`** |
| `step 3 publishable keys in the deployed bundle` | **`1`** |
| `step 3 scripts` / `app.openbed.ng scripts` | **every script is this host's own**. One `script:` line per `<script>` is printed above it. Any inline script, or one from another host (such as `static.cloudflareinsights.com`), is **WRONG** (R-2026-09-25-119 CU-5) |
| `app.openbed.ng content-security-policy` / `referrer-policy` / `x-content-type-options` / `bundles the page loads` | the same values as step 3's, read on the custom domain, where zone settings apply |
| `step 3 content-security-policy` / `referrer-policy` / `x-content-type-options` | exactly what **this checkout's** `apps/ward-console/public/_headers` sets on `/*`, as rendered by `scripts/render_headers.mjs` (section 4) |
| `step 3 live half status` / `body` | **`200`** / begins **`{"external":`** |
| `step 3 dead half status` / `body` | **`401`** / contains **`"message":"Invalid API key"`** |
| last line | **`PASS: …`** |

**Why `/auth/v1/settings` and not `/rest/v1/`, and it is the reason this probe can
fail at all.** Observed 2026-09-23 (R-2026-09-23-64 C): at the PostgREST root, the
tracked key returns **401 `"Secret API key required"`** and a wrong key returns
**401 `"Invalid API key"`**. **Both are 401.** A status-only probe there would certify a
dead key as live. `/auth/v1/settings` answers **200** for a live key and **401** for a
dead one, and its bodies differ too. It is a **settings read, not a sign-in**: it
sends no email and does not exercise the per-IP auth limits that
R-2026-09-19-23 D4 forbids touching.

**What each failure means:**

- **`step 3 bundles the page loads` or `publishable keys in the deployed bundle`
  reading `0`** — the page or its asset did not load (wrong URL, or a deployment that
  is not the ward console). Not a key problem.
- **`… keys in the deployed bundle` reading `2`** — the bundle carries two different
  publishable keys. Stop; the tracked file and the build disagree.
- **live half `401` with `"Invalid API key"`** — **the deployed key is dead.** It was
  rotated and the tracked line was not updated, or the deployment predates the
  update. See the rotation step in `docs/runbook-key-rotation.md`.
- **dead half anything but `401` + `Invalid API key`** — the probe's own control
  failed, so the live half proves nothing either. Report the output.

**This read-back is the one the rotation step points at**; there is no second copy
of the probe to drift from this one.

## 4. The page's security headers — and why a green read-back is not enough

The console ships a tracked `apps/ward-console/public/_headers` (PR 3.4b-app B; R-2026-09-24-88
BP-10), which Vite copies into the build: a Content-Security-Policy, `Referrer-Policy:
no-referrer` (the sign-in lands with tokens in the URL fragment) and `X-Content-Type-Options:
nosniff`. Step 3's three header lines compare what the deployment serves on `/` against
**this checkout's** file, read by the script, never retyped. So a deploy that dropped or
changed a header reads `WRONG`.

**The CSP's API origins are not in the file** (R-2026-09-24-94 BV-2). Its `connect-src` names
`@API_ORIGINS@`, and `npm run build` fills that from `packages/origins/origins.json` with
`scripts/render_headers.mjs --target production`: **the production API origin only**.
`npm run build:local` fills the local one only, for a local server (R-2026-09-25-117 CS-2).
The read-back renders the tracked file for production before comparing. *Restated
2026-09-25.* Until then this read "fills that from `packages/origins/origins.json` (`api`,
production and local: the pair `apiOrigin()` chooses between)", and every build named both. So a build that
skipped the render step ships `@API_ORIGINS@` literally, which a browser ignores, leaving
`'self'` only and the sign-in broken; step 3 reads that as `WRONG`. Build with `npm run
build`, never a bare `vite build`.

**A CSP that is too tight breaks the page SILENTLY** (R-2026-09-24-93 BU-2 e). The browser
blocks a stylesheet, a script or a fetch and says so only in its own developer console.
The page may render half-working, every curl-level check above still reads `ok`, and
`tests/compliance/security_headers.test.ts` still passes, because it checks the file, not
the browser. So:

- **Before any change to `_headers` is reported,** the app is built and served locally
  under its headers: `npm run build:local -w apps/ward-console`, then
  `npx wrangler pages dev apps/ward-console/dist`. A plain `npm run build` names only the
  production API, so its sign-in would be refused against the local stack. That is a local
  server: it deploys nothing and needs no Cloudflare login. The app is then loaded in a
  real browser, the console is checked for a CSP violation, and the sign-in is walked end
  to end against the local stack: request a link, open it from the local mail catcher, and
  see the handover load.
- **That local walk is not evidence of production.** The production reading is this
  read-back, on the deploy, plus one load of the deployed page in a browser with its
  console open. A `WRONG` on any header line, or a CSP violation in that console, is a
  STOP.

## 5. Redeploy after the CSP change (R-2026-09-25-117 CS-2 f)

**Until this step reads PASS, the deployed ward console's CSP still names
`http://127.0.0.1:54321`**, because it was built before the renderer took a target. So
before the redeploy, step 3's `content-security-policy` line reads **WRONG** against this
checkout's production rendering. **That WRONG is the expected failing half**: it shows
the read-back tells the old header from the new one.

1. Refresh the deploy checkout to the merged `main` and deploy, exactly as section 1
   says. `npm run build` now renders `--target production`.
2. Run the read-back, exactly as section 2 says.
3. **PASS:** every line is `ok`, and `step 3 content-security-policy` reads
   `connect-src 'self' https://api.openbed.ng` with no local origin.
4. **The browser check** (R-2026-09-25-118 CT-2, which waives R-2026-09-24-93 BU-2 e's
   local walk for this change only; BU-2 e stands for any later `_headers` change).
   - Open a fresh private window, with the developer console open before the page
     loads.
   - Open `app.openbed.ng`, and request a sign-in link for an address on the reserved
     `example.invalid` domain. Sign-ups are off, so no user is made and no email is
     sent, but the request still goes to `api.openbed.ng`.
   - **PASS:** the page shows "If this address belongs to a ward, a sign-in link is on
     its way to it. Open it on this handset. …", and there is no red line in the
     console. The page shows the same sentence whatever the API answered, by design, so
     that a refusal cannot reveal whether an address exists
     (`apps/ward-console/src/main.ts`, `SIGNIN_ANSWERED`).
   - **A CSP block shows "The request could not be sent. Check this handset is online,
     then try again."** That, or a Content-Security-Policy violation in the console, is
     a STOP. Roll the `openbed-ward-console` Pages project back to its previous
     deployment in the dashboard, then read back again.
5. **The hosted auth hooks are off** (R-2026-09-26-131 DG-3). Added 2026-09-26, and
   first due at D2's hosted deploy.
   - In the Supabase dashboard for project `klrlpxysjsjpdkeqdhvl`, open
     Authentication → Hooks.
   - **PASS:** no hook is enabled: neither the custom access token hook nor any other.
     Roles are table lookups enforced in the database (R-2026-09-21-41 A), and a hook
     that minted claims would be a second source of who may do what.
   - Record the founder's word with this deploy's run, below. The local
     `supabase/config.toml` is guarded by `tests/compliance/auth_hooks_off.test.ts`; the
     hosted setting is not readable from this repository, so this step is its only
     check. The register row "The hosted project's auth hooks are off" leaves the
     decision record in the pull request that records this read.
   - **An enabled hook is a STOP.** Report it before anything else is done.

**Run on 2026-09-25, from the deploy checkout at `dd59c7f`** (R-2026-09-25-119 CU-2;
the founder's terminal and browser, read back by Cowork):
- **Deployed** `https://20de9ab4.openbed-ward-console.pages.dev`.
- **Read-back PASS.** Commit `dd59c7f`, dirty false. The CSP read `connect-src 'self'
  https://api.openbed.ng`, with no-referrer, nosniff, one bundle
  (`assets/index-BOfXUqtX.js`) and one key. Live 200, dead 401.
- **Cowork, with a browser User-Agent:** `app.openbed.ng` serves `/version.json` commit
  `dd59c7f`, with the same CSP.
- **Browser check on `app.openbed.ng`:** the page showed the uniform sentence, which
  ends by naming the ward-facing support address, and the console had no red line.
  **PASS.**

This, together with the admin runbook's section 5, is the closing condition of the
facility-one checklist's CSP box (the Supabase runbook, 12.4 step 1).

**THE PAGE CHECKS SEE WHAT A BROWSER SEES, ON THE CUSTOM DOMAIN TOO (R-2026-09-25-119
CU-5).** Since 2026-09-26 every page fetch presents as a browser (a browser User-Agent,
and `Accept: text/html`). Every `<script>` the page carries is listed, and any script
that is inline or from another host reads WRONG. The same checks then run on the custom
domain. **Why (CU-4):** on 2026-09-25 two Cloudflare zone settings for `openbed.ng`
were changing what we served, and no read-back saw either:
- Web Analytics injected a beacon `<script>` into the HTML **only for a browser-like
  request**;
- a managed `robots.txt` was prepended **only on the custom domain**.

A plain curl against the deployment URL saw a clean page. *Restated 2026-09-26:* until
then the page was fetched once, as plain curl, on the deployment URL, and only its
bundle was counted.
