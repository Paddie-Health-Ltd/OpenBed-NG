# Runbook — deploying the ward console, and reading it back

**Every ward-console deploy runs all three steps, including the first one (H4).**
A deploy that has not been read back is a claim about what is live, not a fact.

The ward console is the one app here whose bundle carries a **credential**: the
publishable key, tracked in `packages/origins/publishable-keys.json` since
R-2026-09-22-61. **No test in this repository can tell a live key from a dead one** —
a revoked key is still perfectly well-formed, and every guard over it stays green.
**Step 3 is the only check that can**, which is why it runs on every deploy and not
only on a rotation (R-2026-09-23-64).

---

## 1. Deploy through the wrapper

From a clean checkout of `main`:

```bash
bash scripts/deploy_pages.sh --branch main ward-console
```

The wrapper refuses a dirty tree, a commit that is not on `origin/main`, and a build
whose stamp does not name the commit it verified. **Copy the deployment URL it
prints** (`https://<hash>.openbed-ward-console.pages.dev`); steps 2 and 3 read it.
Once `app.openbed.ng` exists, either URL works — they serve the same deployment.

## 2. Read back `/version.json`

**The first line waits for the DEPLOYMENT URL from step 1.**

```bash
read -r DEPLOY_URL
curl -sS -m 12 "$DEPLOY_URL/version.json"
```

**Stop condition:** `"commit"` is the commit the wrapper printed, and `"dirty"` is
`false`. Anything else, stop and report the output.

## 3. The live-key probe — BOTH halves, in the same paste

**The first line waits for the DEPLOYMENT URL again.** The block reads the key **out
of the deployed bundle**, never out of the repository: the property is that the key
the deployment actually ships is accepted, and a key read from a checkout would
prove something about the checkout.

It then makes the same request twice: once with that key, once with a key that is
deliberately wrong. **The wrong-key half is not optional.** Without it, a probe that
could never fail would read exactly like one that passed.

**NO `exit` IN THIS BLOCK, and no variable called `path` or `status`.** It is pasted
into an interactive shell, where `exit` closes the terminal; and in zsh `path` is
tied to `$PATH` and `status` is read-only, so assigning either breaks the shell in a
way that looks like a network failure.

```bash
read -r DEPLOY_URL
BUNDLE="$(curl -sS -m 12 "$DEPLOY_URL/" | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | sort -u)"
DEPLOYED_KEY="$(curl -sS -m 12 "$DEPLOY_URL/$BUNDLE" | grep -o 'sb_publishable_[A-Za-z0-9_-]*' | sort -u)"
KEYS_FOUND="$(printf '%s\n' "$DEPLOYED_KEY" | grep -c 'sb_publishable_')"
LIVE_OUT="$(curl -sS -m 12 -w '\n%{http_code}' -H "apikey: $DEPLOYED_KEY" https://api.openbed.ng/auth/v1/settings)"
DEAD_OUT="$(curl -sS -m 12 -w '\n%{http_code}' -H "apikey: sb_publishable_DELIBERATELY_WRONG_FOR_THE_FAILING_HALF" https://api.openbed.ng/auth/v1/settings)"
LIVE_CODE="${LIVE_OUT##*$'\n'}"; LIVE_BODY="${LIVE_OUT%$'\n'*}"
DEAD_CODE="${DEAD_OUT##*$'\n'}"; DEAD_BODY="${DEAD_OUT%$'\n'*}"
echo "bundle: $BUNDLE"
echo "publishable keys in the deployed bundle: $KEYS_FOUND"
echo "live half: $LIVE_CODE ${LIVE_BODY:0:14}"
echo "dead half: $DEAD_CODE ${DEAD_BODY:0:60}"
OK=1
[ "$KEYS_FOUND" = 1 ] || OK=0
[ "$LIVE_CODE" = 200 ] || OK=0
case "$LIVE_BODY" in '{"external":'*) ;; *) OK=0 ;; esac
[ "$DEAD_CODE" = 401 ] || OK=0
case "$DEAD_BODY" in *'"message":"Invalid API key"'*) ;; *) OK=0 ;; esac
[ "$OK" = 1 ] && echo "PASS: the deployed key is accepted at the edge, and a wrong key is refused." || echo "STOP: see the four lines above. Do not report this deploy as good."
```

**Pass — all four, exactly:**

| Line | Must read |
|---|---|
| `publishable keys in the deployed bundle:` | **`1`** |
| `live half:` | **`200 {"external":`** |
| `dead half:` | **`401`** and **`{"message":"Invalid API key"`** |
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

- **`publishable keys in the deployed bundle: 0`** — the page or its asset did not
  load (wrong URL, or a deployment that is not the ward console). Not a key problem.
- **`… : 2`** — the bundle carries two different publishable keys. Stop; the tracked
  file and the build disagree.
- **live half `401` with `"Invalid API key"`** — **the deployed key is dead.** It was
  rotated and the tracked line was not updated, or the deployment predates the
  update. See the rotation step in `docs/runbook-key-rotation.md`.
- **dead half anything but `401` + `Invalid API key`** — the probe's own control
  failed, so the live half proves nothing either. Report the output.

**This read-back is the one the rotation step points at**; there is no second copy
of the probe to drift from this one.
