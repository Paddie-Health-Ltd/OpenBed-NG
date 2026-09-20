# Handoff — OpenBed-NG: the Pages project is direct-upload, and what that implies — 2026-09-20
Prepared by: Claude Code (handback session)

**For the main build session.** This session was asked to do one thing — redeploy
`openbed-public-dashboard` so its Pages Function would pick up the Production
environment variables the founder had added. That is done and verified. Doing it
surfaced a finding larger than the task, which is the reason this file exists.

Two rulings govern this work and **neither has a real number yet**:
**R-PROVISIONAL-2026-09-20-H** and **R-PROVISIONAL-2026-09-20-J**. (The letter I was
skipped deliberately — too easily misread as a pronoun in a ruling id. No block is
missing.) They are handed to the main session to land, because the record's last is
**R-2026-09-19-24** and it lives in the `record-r24` worktree, not in this tree.
Assigning a number from a tree that does not contain the record's last would be a
composed identifier — the defect method note 16 exists to prevent.

---

## 1. The finding: what is running is not what was reviewed

**Claim, for the main session to rule on. REPORTED, not verified by this session.**

The Cloudflare Pages project `openbed-public-dashboard` is **direct-upload, not
git-connected** — REPORTED by the founder on 2026-09-20: the dashboard offers no
**Retry deployment** button, and the project was created with
`wrangler pages project create` rather than by connecting a repository. Nothing
inside this repository can verify that; no test here can read a Cloudflare project's
settings.

If it holds, three things follow:

1. **Merging a PR deploys nothing.** The running site changes only when someone
   uploads a working tree.
2. **Deployment and review are fully decoupled.** Nothing forces the deployed
   artifact to be a commit that passed a gate, or a commit on `main` at all.
3. **It has already happened.** Production was serving five commits that existed in
   no remote branch until this session pushed them as a backup (section 3). They
   passed no gate and are not ancestors of `main`.

**This is the same shape as the `supabase-proxy` finding** — production diverging
from the record — and it is larger than either defect this session fixed.

### What it changes about the founder-side sequence

The steps recorded at R-2026-09-19-23 and after assume a deployment occurred by some
mechanism that was never named. `docs/runbook-cloudflare-pages-beds-json.md` named
the wrong one: until this change its deploy step said *"Push to `main`, or trigger a
production deployment from the dashboard"*, which for a direct-upload project
deploys nothing while appearing to succeed.

**That runbook feeds the founder's deployment report, and that report is the gate on
migration 018 (R-2026-09-17-11 C).** A procedure that deploys nothing while
appearing to succeed can produce a report saying "deployed" when nothing was. The
record already carries one unresolved instance of exactly that shape — the
`api.openbed.ng` addendum says deployed; `dig` returned no record.

The mechanism now has to be named, and the deployment report has to say **which
artifact, from which commit, by which command**. That requirement is now written
into the runbook's reporting section.

---

## 2. What was fixed, and on which branch

Branch **`runbook-pages-direct-upload`**, cut from `origin/main` at `55dbcec`.
**No PR, no merge** — the review belongs to the main session.

It was cut from `origin/main` rather than from the backup branch deliberately.
The backup branch is 12 behind `main`, and its copy of the runbook predates
R-2026-09-19-21 and R-2026-09-19-22. **A stale-base edit to a file those rulings
have since amended can revert them while merging cleanly** — a conflict announces
itself, a silent revert does not. Confirmed after editing that section 7 still
carries both rulings and its five-item scope list.

`docs/runbook-cloudflare-pages-beds-json.md`, one commit. Every corrected fact
carries its evidence kind, matching the DOCUMENTED / NOT CONFIRMED / CHOSEN style
R-2026-09-19-21 already established in that file:

| Correction | Kind |
|---|---|
| Project is direct-upload; pushing to `main` deploys nothing | **REPORTED** by the founder, 2026-09-20; not independently verifiable from the repository |
| Deploy is `cd apps/public-dashboard && npx wrangler pages deploy --branch <production branch>` | **OBSERVED** 2026-09-20 — returned `Compiled Worker successfully`, `Uploading Functions bundle`, a deployment URL; that deployment then served the live snapshot, which requires Production variables to have bound |
| Root directory / Build output directory do not exist for a direct upload | Follows from the above; their job is done by `pages_build_output_dir` and the working directory |
| Production variables bind at deployment creation, so a saved variable needs a fresh deploy | **OBSERVED** 2026-09-20 — this is the defect that opened this session |
| What happens if `--branch` is omitted | **NOT CONFIRMED** — see section 5 |
| `"wards":[]` passes the body check | **OBSERVED** 2026-09-20 — see section 4 |

---

## 3. The backup branch — frozen, and unreviewed

**`proxy-and-ward-console-publish`**, head
**`ec0f5783aabcea8ed8aa6c9201669f18c73357cb`**.

The SHA was read back from `git rev-parse HEAD` and independently from
`gh api repos/.../git/ref/heads/proxy-and-ward-console-publish`; the two agree. It
was not composed or abbreviated by hand.

**THESE FIVE COMMITS ARE A BACKUP OF UNREVIEWED WORK. THEY HAVE PASSED NO GATE.**
No attestation, no self-check, no PR — `gh pr list --head
proxy-and-ward-console-publish --state all` returns empty. A branch sitting on the
remote otherwise reads as something that was reviewed, which is why this paragraph
is here rather than implied.

```
ec0f578  guard headers: correct two stale Clause-5 classifications
1b3591b  ward-console: build the publish screen, add its Pages config
56f26ea  public-dashboard: replace the stubWards fixture with a real /beds.json fetch
83fd40c  decision doc: tighten the api.openbed.ng addendum's repo-path claim
6e6f10c  commit supabase-proxy/: the Cloudflare Worker backing api.openbed.ng
```

It exists because production was serving this code while it existed only on one
laptop. It is `5 ahead, 12 behind` `origin/main`.

**It is frozen. Do not rebase it, force-push it, or tidy it.** Rewriting those SHAs
would make `ec0f578` stop identifying the deployed code, and that identification is
the only reason the branch was recorded. The name was chosen to describe its
contents; `bundle1-beds-json` was deliberately **not** reused, because that name
already resolves to merged, closed PR #39, and an identifier resolving to two
different things is the defect method note 16 and R-2026-09-19-20 exist to prevent.

Its PR and review belong to the main session.

---

## 4. The deployment, as it stands

Deployment **`40c61fb4`** on `openbed-public-dashboard`, uploaded from
`ec0f5783aabcea8ed8aa6c9201669f18c73357cb` by
`cd apps/public-dashboard && npx wrangler pages deploy --branch main`.

OBSERVED on both the deployment URL and the production `*.pages.dev` alias:

- `HTTP/2 200`
- `content-type: application/json; charset=utf-8` — not the `text/html` SPA
  fallback, so the Function routed
- `cache-control: public, s-maxage=30, stale-while-revalidate=300` — a failure body
  is always `no-store`, so this is a real response from the Function
- body `{"v":4993,"wards":[],"facilities":[],"server_now":…,"generated_at":…}`

**The empty arrays are correct, and the runbook previously said they were a
failure.** Its body stop condition demanded `"wards":[[`, which cannot match a
system with no facilities onboarded — it would have made the step read FAILED on a
correct deployment. Read read-only from the hosted project on 2026-09-20:
`public.snapshot_current` holds 1440 rows, newest `v` climbing exactly one per
minute, while `app.facility`, `app.ward_status`, `public.ward_public` and
`public.facility_public` are all at **zero rows**. The generator is faithfully
publishing an empty city. **No facility has been onboarded** — the public read path
is live and serving nothing, which is an onboarding question, not a deployment one.

**No cache criterion may be recorded from any of this.** `cf-cache-status` is
meaningless on `*.pages.dev`; that step stays OWED until the `openbed.ng`
custom-domain cutover (R-2026-09-18-17 B1).

---

## 5. Open item carried forward

**NOT CONFIRMED: what happens when `--branch` is omitted on a direct-upload
project.** Cloudflare's Wrangler Configuration page, under "Production and preview
deployments", says the flag is optional and that Wrangler infers the branch from the
repository you are in — but that sentence is conditioned on *"If you use git
integration"*, and this project is direct-upload. No deploy without `--branch` was
run here.

**What would close it:** one deploy with `--branch` omitted against a
**non-production** Pages project, or Cloudflare documenting the non-git case.

**Do not run that test against `openbed-public-dashboard`.** Its deploy history is
evidence in the section 1 question, and a throwaway deployment muddies the one
record that question depends on — the probe would be the harm it investigates.

The runbook's deploy instruction was written to be correct either way: it says to
pass `--branch` always, and the uncertainty sits in a note beside the step rather
than inside it, so the procedure does not rest on a contested premise.

---

## 6. Also open, not touched by this session

- **A stray Worker `openbedng`** exists in the Cloudflare account (created
  2026-09-18 20:46), still carrying the Hello World template body. It is not in this
  repository. Worth confirming it holds no route on the `openbed.ng` zone before the
  custom-domain cutover, where it could intercept.
- **Supabase's advisor reports RLS disabled on 16 `app.*` tables.** Very likely a
  false positive: the advisory assumes `app` is PostgREST-exposed, and this
  architecture makes base tables unreachable instead. But the hosted exposed-schemas
  list is a runbook hand-check, not something the repository can assert
  (`.claude/rules/test-conventions.md`, section 4). Confirm `app` is absent from it.
- **PR #45 / `record-r24`** was untouched. This session read that worktree read-only
  to establish the record's last ruling number and never wrote to it.
