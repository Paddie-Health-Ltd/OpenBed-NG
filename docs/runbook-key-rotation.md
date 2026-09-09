# Runbook — Key rotation

**Symptom that brings you here:** a credential has been committed, pasted into a
chat or an issue, sent to a third party, or is simply suspected of exposure.

**A committed secret is a compromised secret.** Deleting the line does not undo
it — the value is in the git history, in every clone, and quite possibly in a
scraper's index within minutes. Rotate first, clean up second.

---

## Which key is it?

| Key | Blast radius | Urgency |
|---|---|---|
| `service_role` | **Total.** Bypasses every RLS policy by design. Read and write on every table, including the audit log. | Immediate |
| `anon` | Low. It is *published in the browser bundle by design*; the security model assumes an attacker has it. | Not an incident on its own |
| Database password | Total, if the database is network-reachable | Immediate |
| Transactional email API key | Can send mail as `toni.health` — a phishing vector against facility administrators | Immediate |

**If you are unsure, treat it as `service_role`.**

---

## Rotating `service_role`

1. **Rotate at the source.** Supabase Dashboard → Settings → API → *Generate new
   service role key*. The old key stops working immediately; that is the point.
2. **Update the server-side secret store** (Vercel environment variables, or
   wherever `/api` reads from). Redeploy.
3. **Do not put it anywhere else.** Not in `.env` in the repository, not in a
   `NEXT_PUBLIC_*` or `VITE_*` variable, not in a CI variable that a fork's pull
   request can read.
4. **Verify the boundary still holds** — run the RLS negative suite against the
   hosted project, and confirm `bash scripts/lint_no_service_role_in_bundle.sh`
   passes against a fresh build.
5. **Check what the key touched while exposed.** `app.audit_log` is append-only
   and cannot be edited by a service-role script (migration 010), so it is
   trustworthy here even if the key was used. Look for `app.audit_log` rows whose
   `facility_id` / `ward_category` you cannot account for, and for
   `app.ward_status_event` rows with no corresponding `app.ward_status` change.

   Note there is no actor to trace: under ward-level identity nothing records who
   made a write beyond the ward itself, so the question is *which ward's data
   moved*, never *which person moved it*.

---

## Cleaning the history

Rotation makes the leaked value useless. History cleanup is about not shipping a
credential-shaped string in a public repository, and it is secondary.

```bash
# Confirm what is actually in history before rewriting anything.
git log -p -S '<the leaked fragment>' --all | head -50
```

If it must be removed, use `git filter-repo` (not `filter-branch`), force-push,
and **tell every clone holder to re-clone** — a rewrite does not reach their
existing checkouts, and a stale local branch will push the value straight back.

If the repository is public, assume the value was scraped. The rewrite is
hygiene, not remediation.

---

## Never run `supabase projects api-keys` bare

It does **not** fetch the anon key. It dumps **every** key the project has,
including the full legacy `service_role` JWT.

That happened on 2026-09-09: the bare subcommand was run to obtain an anon key
for a boundary probe, and the `service_role` JWT landed in a session transcript.
The key was rotated. Blast radius was measured rather than assumed — repository,
scratchpad, `~/.supabase` and `.env` files were all grepped and all clean, so the
transcript was the only exposure surface, and nothing was deployed with it.

**Use [`scripts/get_publishable_key.sh`](../scripts/get_publishable_key.sh)**,
which prints exactly one key and never a secret. The bare subcommand appears
nowhere in this repository's documentation, deliberately — a `jq` filter written
into a runbook is a symptom fix, because the next person types the subcommand.

## Verifying a rotation — a rotation you have not probed is a claim

`docs/` documents the procedure. This is the proof.

After rotating or disabling a key, **assert the old one is dead**:

```bash
# KEEP THE BODY. `-o /dev/null` is what makes this probe lie -- see below.
curl -s -w '\nHTTP %{http_code}\n' \
  "https://<ref>.supabase.co/rest/v1/ward_public?select=facility_id&limit=1" \
  -H "apikey: <THE OLD KEY>" -H "Authorization: Bearer <THE OLD KEY>"
```

**ASSERT 401 SPECIFICALLY, NEVER "not 200".** There are three readings and only
one of them is a pass:

| Reading | Means |
|---|---|
| **401** | The key is dead. **This is the only pass.** |
| **404** with `PGRST205` in the body | The key is *live* and authenticated fine; the table just does not exist yet. **The rotation is unproven and you have tested nothing.** |
| **200** | The rotation did not take. |

This is not hypothetical. `public.ward_public` does not exist on the hosted
project until migrations 001-013 are applied, so before the apply this endpoint
returns a non-200 **whether the old key is dead or alive** — and `-o /dev/null`
discards the one thing that tells them apart. A "not 200" checkbox passes on the
404 and records a rotation that was never demonstrated.

The general form of the defect: **a probe whose pass condition is satisfied by
its own precondition being absent.** Same shape as an anti-vacuity failure, and
the same fix — name the expected signal exactly, and read the body that carries
it.

- [ ] Old key returns **401** — not merely non-200, and not 404
- [ ] New key works for whatever legitimately needs it
- [ ] All exposure surfaces re-grepped **after** the rotation, to catch anything
      written during the interval

**On the 2026-09-09 event specifically:** the remediation chosen was to **disable
legacy API keys** rather than rotate the JWT secret. Legacy `anon` and
`service_role` are signed by the same secret, so rotating it would have taken the
anon key as collateral; the project already had `sb_publishable_` and
`sb_secret_` provisioned, nothing referenced the hosted keys, and no server-side
store existed to update. The exposed legacy JWT becomes inert.

## Prevention, and the honest division of labour

- **GitHub secret scanning with push protection** — the prevention control. It is
  a repository setting, enforced server-side by GitHub at push time. It is the
  only thing here that can stop a commit from arriving.
- **`scripts/lint_no_secrets.sh`**, the `secret-scan` CI job — **detection**. It
  runs after the push has already been accepted. It can fail a build; it cannot
  stop a commit.

Do not describe the CI job as if it prevented anything. See `SECURITY.md`.

One file is allowlisted by path: `tests/setup/local-keys.ts`, which holds the
well-known local Supabase demo keys. Those are minted identically by every
`supabase start` on every machine and authenticate against `127.0.0.1` only.
**A key found anywhere else is real.**
