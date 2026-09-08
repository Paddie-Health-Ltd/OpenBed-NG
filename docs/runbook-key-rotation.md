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
