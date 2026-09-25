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

**Deploy from the deploy checkout, never from a working tree** (the ward console's
reason, R-2026-09-23-70). Refresh it and read its HEAD:

```bash
git -C ~/Desktop/OpenBed-NG-deploy fetch origin && git -C ~/Desktop/OpenBed-NG-deploy checkout --detach origin/main && (cd ~/Desktop/OpenBed-NG-deploy && npm ci)
cd ~/Desktop/OpenBed-NG-deploy && git rev-parse HEAD
```

The last line must print the commit you mean to deploy. Then:

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
login. The read-back was then run against it:

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
R-2026-09-24-97 BY-2 g). `tests/compliance/security_headers.test.ts` holds all three
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
