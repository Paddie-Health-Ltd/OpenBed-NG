# supabase-proxy — the Worker behind `api.openbed.ng`

## SUPERSEDED 2026-09-22 — the question below is ANSWERED: KEEP

**R-2026-09-22-55 A** answers the keep-or-remove question this section poses.
`api.openbed.ng` is **KEPT**, and is the only database address every app uses. It
earns its place on three properties the direct Supabase origin does not give:
portability, because changing the Supabase project is one edit to `index.js` and
not a rebuild of every app; resilience against an ISP-level block of
`*.supabase.co`; and somewhere to put Cloudflare rate limits in front of auth.
**A nicer hostname was never the reason** — the criterion below refused exactly
that, and it is still refused.

**Read the section below as the state BEFORE that ruling. It is kept as written,
not deleted**, because it records what this directory meant for the three days it
sat here undecided, and a record is not rewritten to match a later state.

**Two things it said were still true, and PR 3.3 ended both** (R-2026-09-23-70).
It read: *"Nothing here has a guard, a runbook entry or a test … And the Worker still
forwards every path and method, until that allow-list lands."* The Worker now forwards
only `allow-list.json`, held equal to the code by
`tests/compliance/proxy_allow_list.test.ts`; it answers `/__openbed/version` itself;
it deploys through `scripts/deploy_worker.sh`; and its probes are
`docs/runbook-cloudflare-worker-proxy.md`. **The availability answer (`-23 D5`) is
still owed**, and this Worker raises its stakes.

**One thing the KEEP does not buy yet**, recorded so this file does not overclaim
it: none of the three properties above reaches production until a tracked origin
points the apps at this hostname. See `-55 A2`. **The separate question of whether
the name is live at all is now ANSWERED** — see the note at the foot of this file.

---

## The state before R-2026-09-22-55 — this directory is a RECORD, NOT A DECISION

**Its presence in `main` records what is deployed. It is not an endorsement, and
keep-or-remove is UNDECIDED** (R-PROVISIONAL-2026-09-20-N C3).

- This Worker was deployed to the Cloudflare account and ran there while its source
  existed on one laptop and in no remote branch. It came into the repository because
  **keeping production code out of the repository perpetuates the divergence this
  work is closing** — and because landing a Worker's source does not deploy it. It
  was already deployed, so landing it adds no exposure.
- **It is under a scoped review** (R-2026-09-19-23 D). That review states its
  decision criterion BEFORE it runs: the proxy must name what it buys that the direct
  Supabase origin does not. **A more pleasant hostname is cosmetic and does not
  justify an unguarded full passthrough to auth, storage and functions. If nothing
  earns it, the answer is REMOVE**, and this directory goes.
- Nothing here has a guard, a runbook entry or a test yet. That gap is recorded
  (R-2026-09-19-20 C4).

## What it does, read from the source

`index.js` rewrites the `Host` header and forwards **every path and method** to the
Supabase project origin. It holds no credential: it passes through whatever the
caller sends. It grants no new authorization — and it changes both the surface and
the attribution, which is what the review exists to examine.

## The founder's note, recorded verbatim — its UNVERIFIED half is now ANSWERED

**SUPERSEDED 2026-09-22 by `R-2026-09-22-56 A1`, on the infrastructure review's
reads.** `api.openbed.ng` **is live**: with no key a `GET` returns **401**, and
with a key `/auth/v1/health` returns **200**. The 401 body is PostgREST's *"No API
key found in request"*, not Cloudflare's, which is what shows the Worker reached
the Supabase origin and forwarded rather than denying at the edge. **The recorded
contradiction between the note below and the 2026-09-19 `dig` is settled, on the
name being live now** — and `-56 E4` records that it is NOT explained by the
resolver failure found the same day, because that lookup ran on another machine
and returned records.

**The block below is kept as the state before that read, not deleted.** One thing
in it is still true and still open: **Finding D**, that nothing tracked sets the
console's origin, so no file here can say what production talks to. That is Bundle
3 item 1.

This text was written by the founder on 2026-09-19 and appended to the decision
record. It is kept here, beside the thing it describes, rather than in the record's
body, because **its central claim is contradicted by the only reading taken of it**:

> **UNVERIFIED.** On 2026-09-19 a `dig` for `api.openbed.ng` returned NO RECORD,
> while this note says the name is deployed. Both are recorded, neither is resolved,
> and it is the founder's to settle — it is the first thing the review answers
> (R-2026-09-19-21 B2, R-2026-09-19-23 D1).

> `api.openbed.ng` is a Cloudflare Worker (`supabase-proxy/`, committed alongside
> this addendum) that Host-rewrites requests through to the Supabase origin,
> deployed as a stable domain backing
> `app.openbed.ng`/`ward-console` — `apps/ward-console/src/main.ts` already read
> `VITE_SUPABASE_URL` directly against the raw Supabase origin with the anon key
> before this change, so this only changes the hostname the client is pointed
> at, not what it is authorized to reach. Available to future consumers of the
> same API. This is a third domain alongside D1's two; it does not replace or
> change either — `openbed.ng`'s public `/beds.json` Cloudflare Pages Function
> is unaffected.

**One claim in it the repository could not show, RESOLVED 2026-09-22:** that the
ward console reaches Supabase through this hostname. Its origin was a build-time
variable nothing tracked set — Finding D (`R-2026-09-19-21 D`). It is now
`packages/origins/origins.json`, read at runtime from the host, and
`tests/compliance/tracked_origins.test.ts` asserts the built bundle carries that
file. **So this repository can now say what production talks to**, which is the
condition `-55 A` named before any of the KEEP's three properties reached
production.

**Two things that resolution does NOT cover**, said here so the quote above is not
read as fully discharged. The `VITE_SUPABASE_URL` it mentions no longer exists, so
the sentence describes a mechanism that is gone rather than one still in use. And
**the public dashboard's `/beds.json` Function is a NAMED EXCEPTION** — it
addresses the Supabase origin directly, not through this hostname
(`R-2026-09-22-58 A`), so "every app" in the banner above means every BROWSER call.
That exception ends when `R-2026-09-19-23 D5`, availability, closes.
