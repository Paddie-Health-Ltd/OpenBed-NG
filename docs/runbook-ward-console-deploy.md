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
