# supabase-proxy — the Worker behind `api.openbed.ng`

## READ THIS FIRST: this directory is a RECORD, NOT A DECISION

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

## The founder's note, recorded verbatim and UNVERIFIED

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

**One claim in it the repository cannot show:** that the ward console reaches
Supabase through this hostname. The console's origin is a build-time variable that
nothing tracked sets — Finding D (R-2026-09-19-21 D). Until that is fixed, no file
here can say what production talks to.
