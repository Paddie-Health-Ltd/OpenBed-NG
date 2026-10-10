# Runbook — deploying the admin app, and reading it back

**The admin app is LIVE since 2026-09-25** (R-2026-09-25-113). H6 steps 2, 6 and 7 read
as they must that day, from the deploy checkout at `5786626`: the read-back PASS, the
sign-in link's `redirect_to` exactly `https://admin.openbed.ng/`, and the sign-in
behind Access in both orders. The readings are in
`docs/runbook-supabase-project-creation.md`, section "H6", and section 4 below.
*Restated 2026-09-25 (R-2026-09-25-113).* Until then this paragraph read: "**The admin
app is NOT live.** It becomes live only when H6 steps 2, 6 and 7 have read as they must
(R-2026-09-24-97 BY-1, BY-2 a). … Until then, nothing here has been run against a
hosted project: PR 3.4b-app C merged on local evidence."

The admin app is the operator's surface at `admin.openbed.ng` (R-2026-09-24-88 BP-11). It
has the ward console's deploy shape, with one difference that changes the read-back:
**Cloudflare Access sits in front of it, since 2026-09-25.** Cowork read it from
outside: every admin host answers 302 to
`https://openbedng.cloudflareaccess.com/cdn-cgi/access/login/<host>`, and the login page
offers GitHub only (R-2026-09-25-113). *Restated 2026-09-25 (R-2026-09-25-112 CN).*
Until then this sentence read "**Cloudflare Access sits in front of it** (R-2026-09-24-89
BQ-2)", from 2026-09-24. **That was not so:** Zero Trust held no application until
2026-09-25 (founder-reported). Before setup, `admin.openbed.ng` answered 522 with no
Access redirect (Cowork's outside read), so nothing was served in the meantime.

A deploy that has not been read back is a claim about what is live, not a fact.

---

## 0. What Cloudflare Access does, and what it does NOT do

**It does:** put a second factor in front of the PAGE. The login method is an identity
provider with two-factor. The one-time PIN to an inbox is off, because a PIN to the
operator's own inbox would be the same factor twice. The policy admits the founder's
identity only.

**It does NOT protect the operator's data.** The operator functions are database
calls. They answer anyone holding the operator's session, through `api.openbed.ng` or
the direct Supabase origin, whatever Access does to the page. **The factor that guards
the data is the operator's mailbox**, where the sign-in link goes. Access is a guard on
the door of one entrance, not on the room.

**Both hosts, or neither.** Access on `admin.openbed.ng` alone leaves the project's
`*.pages.dev` hosts serving the page around it. The admin project's production
pages.dev host and its preview deployments are added to the same Access application
(BQ-2 a). The read-back probes all of them without a token, and any one that serves the
app reads WRONG.

**How it is set up, in this order** (H6 step 1, R-2026-09-25-111 CM as amended by
R-2026-09-25-112 CN; the full text is in `docs/runbook-supabase-project-creation.md`,
section 12.3):

a) create the Pages project `openbed-admin` from the deploy checkout;
b) add the Zero Trust login method GitHub (the founder's account, two-factor on), and
   test it;
c) **create** the self-hosted Access application "OpenBed admin" for `admin.openbed.ng`,
   `openbed-admin.pages.dev` and `*.openbed-admin.pages.dev`, with GitHub the only login
   method, one-time PIN off, and the policy "Founder": Allow, Include the founder's
   identity email only (never written in this repository);
d) issue the service token `openbed-admin-readback` (kept in the founder's password
   manager only), and add a second policy, **Service Auth, Include that token only**;
e) add `admin.openbed.ng` as the Pages project's custom domain, deleting any
   placeholder `admin` DNS record first.

**Without the Service Auth policy, an issued token passes nothing.** Access refuses the
read-back's token half, and step 2 below reads STOP on a correct deploy.

*Restated 2026-09-25 (R-2026-09-25-112 CN).* Until then this section named no setup
order and no Service Auth policy. It assumed an Access application already in front of
`admin.openbed.ng`, which did not exist until 2026-09-25.

**The service token** lets the read-back through Access. It is issued at H6 step 1 and
read by the read-back ONLY from the environment:

- `OPENBED_ACCESS_CLIENT_ID`
- `OPENBED_ACCESS_CLIENT_SECRET`

It is never an argument and never written to a file in this repository. The script
writes it, with mode 600, to a header file inside its own temporary directory, removes
that file on exit, and never prints it. A shell that set it removes it again (runbook
step P's rule).

## 1. Deploy through the wrapper

**FIRST, because the lockfile changed on 2026-10-07 (R-2026-10-07 GL): run the refresh below in full, including its `npm ci --include=optional`.** A deploy checkout whose `node_modules` predates that change still holds the old sharp, and a refresh cut down to its `git` half keeps it.

**Deploy from the deploy checkout, never from a working tree** (the ward console's
reason, R-2026-09-23-70). Set `DEPLOY_TREE` in this shell to its path (the commands below refuse to run while it is unset, so they cannot fall through to the working tree you are standing in), then refresh it and read its HEAD:

```bash
git -C "${DEPLOY_TREE:?set DEPLOY_TREE to the deploy checkout first}" fetch origin && git -C "$DEPLOY_TREE" checkout --detach origin/main && (cd "$DEPLOY_TREE" && npm ci --include=optional)
cd "${DEPLOY_TREE:?set DEPLOY_TREE to the deploy checkout first}" && git rev-parse HEAD
```

*Restated 2026-10-03 (R-2026-10-03-FH FH-3 c, -184). Until then the refresh line above ended with a bare `npm ci)`. The flag guards against an `omit` setting that skips optional packages, and the founder's was empty (`npm config get omit` printed nothing), so on 2026-10-03 it would have changed nothing: the first `npm ci` still left out the native workerd binary for the platform, most likely after a failed optional download, which npm skips without saying so (INFERRED; nothing else was observed). What catches that is the deploy wrappers' own toolchain check, which runs before any build or upload, and not the flag.*

*Added 2026-10-03 (R-2026-10-03-FI FI-3, -185). The deploy wrapper turns wrangler's usage telemetry off for the steps it runs (`WRANGLER_SEND_METRICS=false`). A wrangler run outside the wrapper is not covered; the founder may also run `npx wrangler telemetry disable` once on the deploy machine.*

The last line must print the commit you mean to deploy. Then:

**BEFORE THE DEPLOY COMMAND, CONNECT THE VPN (Proton, UK or NL); the wrapper checks the edge** (R-2026-09-30-217 GP). Cloudflare's Lagos edge answers API calls from Nigerian networks with an HTML 429 (the cause as ruled, from the founder's runs of 2026-10-10, relayed by Cowork), so before anything is built the wrapper reads Cloudflare's own trace, prints the `colo` and `loc` it read, and refuses with exit 1 when the colo is LOS or the loc is NG, and stops with exit 2 (the check could not run) when the trace cannot be read or is not a trace. *Restated 2026-10-10 (R-2026-09-30-218 GQ-5 b). Until then this sentence read "refuses with exit 1 when the colo is LOS, the loc is NG, or the trace cannot be read"; an edge that cannot be read is now a check that could not run, exit 2, and the two are told apart by the status.* If it refuses, connect the VPN, check that the colo it prints is not LOS, and run the same command again. Optionally `export CLOUDFLARE_ACCOUNT_ID=<the account id>` in your shell first, never in a file in this repository: it makes wrangler skip its `GET /accounts` call, which was not the cause and is not fixed by skipping it.

```bash
bash scripts/deploy_pages.sh --branch main admin
```

The wrapper refuses a dirty tree, a commit that is not on `origin/main`, and a build
whose stamp does not name the commit it verified. It builds with `npm run build`, which
renders `_headers` (below). **Never deploy a bare `vite build`:** it ships the
`@API_ORIGINS@` placeholder unrendered, which a browser ignores, leaving `'self'` only
and the sign-in broken. Step 2 then reads WRONG.

**Copy the deployment URL wrangler prints** (`https://<hash>.openbed-admin.pages.dev`).
The read-back takes it as its argument.

## 2. Run the read-back

From the same deploy checkout, with the Access service token in the environment and
the deployment URL in place of `HASH`:

```bash
bash scripts/readback_admin.sh https://HASH.openbed-admin.pages.dev
```

**A URL still holding `HASH` is refused** with `ERROR:` and exit 2, before any request
(since 2026-09-25, R-2026-09-25-113 CO-2). That is never a verdict about the deploy:
put the deployment's own label in its place and run it again.

It runs three steps, and prints one line per check, each `ok` or `WRONG` with the value
it must have. It ends with exactly one verdict: **`PASS:` (exit 0)** or **`STOP:`
(exit 1)**. `ERROR:` with exit 2 means a check could not run, and **a missing token is
exactly that: never a PASS.** Paste the whole output back.

**Pass: every line `ok`, with exactly these values:**

| Line | Must read |
|---|---|
| `step 1 <host>/version.json` and `step 1 <host>/`, for `admin.openbed.ng`, `openbed-admin.pages.dev` and the deployment | **a redirect to `*.cloudflareaccess.com`, or `403`**. **Any `200` is WRONG**: the page is served around Access |
| `step 2 commit` / `step 2 dirty` | **this checkout's HEAD** / **`false`** |
| `step 2 admin.openbed.ng commit` | **this checkout's HEAD** |
| `step 2 content-security-policy` / `referrer-policy` / `x-content-type-options` | exactly what **this checkout's** `apps/admin/public/_headers` sets on `/*`, as rendered by `scripts/render_headers.mjs` |
| `step 2 bundles the page loads` / `publishable keys in the deployed bundle` | **`1`** / **`1`** |
| `step 2 scripts` / `admin.openbed.ng scripts` | **every script is this host's own**. One `script:` line per `<script>` is printed above it. Any inline script, or one from another host (such as `static.cloudflareinsights.com`), is **WRONG** (R-2026-09-25-119 CU-5) |
| `admin.openbed.ng content-security-policy` / `referrer-policy` / `x-content-type-options` / `bundles the page loads` | the same values as step 2's, read on the custom domain with the token, where zone settings apply |
| `step 2 favicon.ico` and `admin.openbed.ng favicon.ico`, each with `status` and `content-type` | **`200`**, **byte for byte this checkout's** `apps/admin/public/favicon.ico`, and a content-type that is **not `text/html`** (that is the SPA fallback answering for the icon). Since the design pass's D3 (R-2026-09-27-139 DO-4) |
| `step 2 page stylesheet` / `stylesheet fonts` / `font status` / `font content-type` | the stylesheet the page links, at least one woff2 it names, **`200`**, and exactly **`font/woff2`**: a font served as anything else fails silently under nosniff. Since D3 |
| `step 3 live half status` / `body` | **`200`** / begins **`{"external":`** |
| `step 3 dead half status` / `body` | **`401`** / contains **`"message":"Invalid API key"`** |
| `step 3 operator call status` / `x-openbed-proxy` | **`401`** / **`forwarded`** |
| last line | **`PASS: …`** |

**What the failures mean:**

- **Step 1 reading `200` on any host:** Access is not in front of that host. **STOP.**
  Add the host to the Access application and re-run. Do not continue to H6's next step.
- **`step 3 operator call x-openbed-proxy` reading `refused`:** the Worker was not
  redeployed with the admin entries (H5). The app cannot work through
  `api.openbed.ng` until it is.
- **The key halves:** as in `docs/runbook-ward-console-deploy.md` section 3. A live
  half that is refused means the deployed key is dead. A dead half that is not refused
  means the probe's own control failed.

## 3. The local reading — what PR C merged on, and what it does not prove

PR C merged on a local run. The app was built and served by `npx wrangler pages dev
apps/admin/dist`, which is a local server: it deploys nothing and needs no Cloudflare
login. The read-back was then run against it. **Since 2026-09-25 the local build is
`npm run build:local -w apps/admin`** (R-2026-09-25-117 CS-2). It names only the local API
origin, and `--local` holds the served CSP to the local rendering. A plain `npm run build`
names only the production origin, so step 2's CSP line would read WRONG here:

```bash
bash scripts/readback_admin.sh --local http://127.0.0.1:8790
```

`--local` takes only a local address. It runs step 2 in full, with no token, and holds the
bundle's key to the tracked production key. It prints `NOT RUN (local)` for:

- step 1, and the token half, because Access exists only on the hosted project;
- the Worker probe, because there is no Worker in front of the local API;
- the two key halves, because the local stack answers `/auth/v1/settings` with 200 for
  ANY key (observed 2026-09-24), so neither half could fail there.

Its verdict says `LOCAL`. **A local PASS is not evidence that admin is live.**

## 4. The page's security headers, and the sign-in order behind Access

The admin app ships the ward console's security headers. That is a tracked
`apps/admin/public/_headers`, whose `connect-src` names `@API_ORIGINS@` and is filled
from `packages/origins/origins.json` when the app is built (R-2026-09-24-94 BV-2,
R-2026-09-24-97 BY-2 g), **with the build target's origin only**: production for
`npm run build`, local for `npm run build:local` (R-2026-09-25-117 CS-2). **Admin's CSP never names
the direct Supabase origin**, which the ward console's does since R-2026-10-02-FF FF-4 g (-182) as
its fallback when the Worker is down: admin has no fallback, its sessions are kept through a Worker
outage, and the operator has the Supabase dashboard. `readback_admin.sh` still expects the API
origin alone, and `tests/compliance/security_headers.test.ts` refuses the second placeholder in
admin's file. `tests/compliance/security_headers.test.ts` holds all three
apps to it.

**A CSP that is too tight breaks the page SILENTLY** (R-2026-09-24-93 BU-2 e). Before any
change to `_headers` is reported:

- the app is built and served locally;
- it is loaded in a real browser, and the console is checked for CSP violations;
- the sign-in is walked end to end against the local stack, to an empty register.

**The sign-in order behind Access, observed on 2026-09-25 at H6 step 7**
(R-2026-09-25-113; founder-reported, read by Cowork). The magic link returns to
`https://admin.openbed.ng/` with the session in the URL fragment, which no server sees.
The question was whether Access's login bounce loses that fragment.

1. **With an Access session held:** the link from H6 step 6 was opened in the same
   browser. It signed in, and the register loaded.
2. **With no Access session** (a fresh private window): the first attempt hit a GitHub
   server error at the Access login. On retry, after the GitHub login, it signed in and
   the register loaded.

**The fragment survives the Access bounce, in both orders.** The operator needs no
special instruction about the order. A GitHub error at the Access login is GitHub's,
not a lost sign-in: retry it.

*Restated 2026-09-25 (R-2026-09-25-113 CO-1).* Until then this paragraph read: "**The
sign-in order behind Access is [unverified] until H6 step 7.** The magic link returns to
`https://admin.openbed.ng/` with the session in the URL fragment, which no server sees.
If Access intercepts that load and bounces through its own login, the fragment may be
lost and the sign-in fail silently. The order expected to work is: 1. open
`admin.openbed.ng` and pass the Access check first; 2. then request the link; 3. then
open the link on the same device and browser. H6 step 7 observes both orders, with an
Access session already held and without one. The result replaces this paragraph, with
its date. If the fragment survives both orders, the paragraph says so."

**Open item (R-2026-09-25-113 CO-3): the production CSP names a local origin.** The
deployed admin CSP's `connect-src` carries `http://127.0.0.1:54321` (H6 step 2's
reading), because `_headers` is rendered from `packages/origins/origins.json`, which
lists the local API next to the production one. The fix is to render `connect-src` per
build target, with a test that a production `_headers` names no `127.0.0.1` and no
`localhost`. **Trigger: the next change that touches `apps/*/public/_headers` or
`scripts/render_headers.mjs`, and before facility one.**
*Since 2026-09-25 the fix is in the code* (R-2026-09-25-117 CS-2): the renderer takes a
required `--target`, and the deployed build renders production only. **The item is not
closed by that merge.** It closes when admin and the ward console are redeployed from the
merged `main` and each read-back reads the new CSP as PASS (section 5 of this runbook and
of the ward-console runbook).

## 5. Redeploy after the CSP change (R-2026-09-25-117 CS-2 f)

**Until this step reads PASS, the deployed admin CSP still names
`http://127.0.0.1:54321`** (H6 step 2 read it on 2026-09-25), because it was built before
the renderer took a target. So before the redeploy, step 2's `content-security-policy`
line reads **WRONG** against this checkout's production rendering. **That WRONG is the
expected failing half.**

1. Refresh the deploy checkout to the merged `main` and deploy, exactly as section 1
   says. `npm run build` now renders `--target production`.
2. Run the read-back, with the Access token, exactly as section 2 says, against the new
   deployment's URL.
3. **PASS:** every line is `ok`, and `step 2 content-security-policy` reads
   `connect-src 'self' https://api.openbed.ng` with no local origin.
4. **The browser check** (R-2026-09-25-118 CT-2, which waives R-2026-09-24-93 BU-2 e's
   local walk for this change only; BU-2 e stands for any later `_headers` change).
   - Open a fresh private window, with the developer console open before the page
     loads.
   - Open `admin.openbed.ng`, pass Access, and sign in as the operator through the magic
     link.
   - **PASS:** signed in, on the register, and no red line in the console.
   - **A Content-Security-Policy violation in the console is a STOP.** Roll the
     `openbed-admin` Pages project back to its previous deployment in the dashboard,
     then read back again.

**Run on 2026-09-25, from the deploy checkout at `dd59c7f`** (R-2026-09-25-119 CU-1;
the founder's terminal and browser, read back by Cowork):
- **Two deploy attempts failed before upload.** Both builds were good and stamped
  `dd59c7f`. Then wrangler's first API call, `GET /accounts`, got **429 Too Many
  Requests** with an HTML body (Ray IDs `a40a4ed129b3724f-LOS` and
  `a40a67277aa5724f-LOS`). Nothing was uploaded, and the live admin was unchanged. Read
  as a transient edge block on the founder's network, not the account.
  - **Open item:** on a second occurrence, evaluate setting `CLOUDFLARE_ACCOUNT_ID` in
    the deploy environment, so wrangler skips `GET /accounts`.
    *Closed 2026-10-10 (R-2026-09-30-217 GP). The second occurrence came on 2026-10-10 (the
    public dashboard's deploy, relayed by Cowork), and setting `CLOUDFLARE_ACCOUNT_ID` did not
    fix it: wrangler's next call, `POST /pages/assets/check-missing`, answered 429 twice
    more. The cause is Cloudflare's Lagos edge answering API calls from Nigerian networks
    with an HTML 429, not the `GET /accounts` call. The deploy wrappers now refuse that edge
    before building (`scripts/edge_guard.sh`), and the step before the deploy command in
    section 1 is the VPN. The note above, "Read as a transient edge block on the founder's
    network", stands as what was read then.*
- **The third attempt deployed** `https://4fc4ffd3.openbed-admin.pages.dev`.
- **Read-back PASS.** Step 1 read 302 to Access on all six host and path pairs. Step 2
  read commit `dd59c7f`, dirty false, and `admin.openbed.ng` commit `dd59c7f`. The CSP
  read `connect-src 'self' https://api.openbed.ng`, with no-referrer, nosniff, one
  bundle and one key. Step 3 read live 200, dead 401, and operator call 401
  `forwarded`.
- **Browser check:** signed in and landed on the register.
  - The console first showed ONE violation, of `script-src`: Cloudflare Web Analytics'
    beacon, `https://static.cloudflareinsights.com/beacon.min.js/…`, blocked by
    `script-src 'self'`.
  - It was injected by a zone setting, not by our build (CU-4 a).
  - Once the founder switched that off and reloaded: **no red line. PASS.**

**Run on 2026-09-27, from the deploy checkout at `ba12ceb`** (R-2026-09-27-142 DR-1;
the founder's terminal, desktop and phone, read back by Cowork). The first deploy of the
design pass's D3:
- **The checkout:** fetched, detached at `origin/main`
  `ba12ceb14ff339a25c81648a30b584741560f2f9` (#91's merge); `npm ci` installed 223
  packages with 0 vulnerabilities.
- **`bash scripts/deploy_pages.sh --branch main admin`:** HEAD on `origin/main` with a
  clean tree; the stamp read back as `ba12ceb`, clean; 12 files uploaded and 1 already
  present; deployed `https://0651ec07.openbed-admin.pages.dev`. No 429.
- **`readback_admin.sh`, with the Access service token in the environment: PASS.**
  - Step 1: all six host and path pairs read 302 to Access.
  - Step 2: commit `ba12ceb`, dirty false, and `admin.openbed.ng` commit `ba12ceb`. The
    CSP read `connect-src 'self' https://api.openbed.ng` with the rest of the tracked
    policy, no-referrer and nosniff; every script was the host's own, one bundle
    (`assets/index-BUNoU7__.js`), on both hosts.
  - **The favicon on both hosts:** 200, byte for byte `apps/admin/public/favicon.ico`,
    served as `image/vnd.microsoft.icon`.
  - **A self-hosted font:** the stylesheet `/assets/index-BMxr-KSG.css` names 6 woff2;
    the first, `public-sans-latin-400`, read 200 and `font/woff2`. One publishable key.
  - Step 3: live 200, dead 401 "Invalid API key", and the operator call 401 `forwarded`.
  - The last line: "PASS: Access answers every host without the token; with it, the
    stamp names this checkout and the page ships this checkout's headers, favicon, a
    self-hosted font and key; the key is accepted, a wrong one refused, and the Worker
    forwards the operator calls."
- **Desktop, through Access and the magic link:** no red line in the console. The
  Network tab, filtered to woff2, showed the three Public Sans weights, 200, initiated by
  `index-BMxr-KSG.css`, the stylesheet the read-back named.
- **Phone:** "all good", the founder's word.
- **The hosted register is empty:** no facility exists, so the facility view was not
  seen on hosted. Its first hosted sight is step 2a of 12.4 in
  `docs/runbook-supabase-project-creation.md`.

This, together with the ward-console runbook's section 5, is the closing condition of
the facility-one checklist's CSP box (the Supabase runbook, 12.4 step 1).

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

*Added 2026-09-27 (R-2026-09-27-139 DO-1 b):* a third zone setting did the same on
2026-09-27. Email Address Obfuscation (Scrape Shield) rewrote the addresses on the
dashboard's /privacy and injected a script there, on `openbed.ng` only, and
`scripts/readback_pages.sh` read it WRONG. It is off, and all three zone settings that
must stay off are listed in `docs/runbook-cloudflare-pages-beds-json.md`. Admin's host
is in the same zone, so the same three apply to `admin.openbed.ng`.
