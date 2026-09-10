# Sprint Kickoff — BedSpace / OpenBed-NG v1, Bundles 2–6

Date: 2026-09-10 | Prepared by: Cowork sprint-push
Reviewed by: staff-engineer, platform-sre, clco-persona
Predecessor: `Sprint Kickoffs/sprint-kickoff-bedspace-v1-2026-09-08.md` (still authoritative for bundle *contents*)

---

## Division of responsibilities

Claude Code implements, tests and ships every stage below. **Cowork has done the scoping, the sequencing and the specialist review; the calls in this document are settled inputs, not open questions** — except the four in *Open decisions needing your call*, which cannot be resolved by an engineer. The founder holds the hosted apply, the facility agreement and the clinician questions; those run in parallel and only one of them touches the build order (see *The migration window*).

**This document does not re-specify Bundles 2–6.** The v1 kickoff's `## Bundles` section does that and it stands unamended except where §*Nine findings* below says otherwise. What this document supplies is the thing the v1 kickoff could not: **an execution order**, now that there is a real codebase to order work against.

---

## Why the order changes, and what that costs

The v1 bundle order is layer-shaped — the whole write path, then the whole read path. The dependencies behind it are real, so the order is right. **But layer-shaped is exactly the shape that produces disconnected parts**, which is the one thing the fundamental forbids:

> **Everything must flow. The system must work end to end. Do not build pretty standalone pieces that do not connect.**

So the bundles keep their contents and lose their granularity. Six **stages**, each a slice through the layers rather than one layer:

| Stage | What it is | v1 bundles it draws on |
|---|---|---|
| **0** | The spine — E2E ratchet, auth harness, snapshot contract | none (new) |
| **1** | The vertical slice — one ward, one category, one count, on screen | B2 min + B3 min + B4 min |
| **2** | Widen the write path | rest of B3, rest of B2 |
| **3** | Widen the read path | rest of B4 |
| **4** | Escalation and notification reliability | B5 |
| **5** | Outcome capture | B6 |

Stage 1 is deliberately ugly, narrow and **connected**. A mismatch between the write path and the read path is then found on day two rather than after both are finished.

**The cost, stated honestly:** a one-ward, one-category, one-account slice cannot observe concurrency, cross-ward scope, sort order, quiet mode or a duty-flag flip. Six of those are cheap to pin *now* with a test or a shape decision, and Stage 1 pins them; the rest are named in Stage 2 and 3 as things the slice provably did not cover. A slice that hides a defect and does not say so is worse than no slice.

---

## Nine findings in the merged code

All nine were verified against the files during scoping, not inferred. Six are defects, three are traps in correct code. **Each is scoped into a stage below — none is ticketed**, per the standing rule.

**Defects.**

1. **`app.refresh_lga_rollup()` has no production caller.** Its only invocations in the repository are `database/seed/001_synthetic_seed.sql:165` and `tests/db/lga_rollup_kfloor.test.ts`. No trigger, no `pg_cron` entry, no scheduled job. Quiet facilities' rollup is frozen at seed time and will never move. Bundle 1's DoD passed because the seed happens to call it. This is a Clause 5 defect — a mechanism present and not reaching — and it is the sixth instance of that shape this fortnight. → **Stage 3.**

2. **`client_mutation_id` has no index and no unique constraint.** `database/migrations/004:183` declares it as bare `text`; `012_indexes.sql` does not mention it. Idempotency on retry is currently nominal: a retried write inserts a second event and bumps `version` twice. → **Stage 1.**

3. **`ward_reply` is capped at 1000 characters and the comment above it says 256.** `005:208` sets `char_length(ward_reply) <= 1000`. `005:97`, describing the audit-value cap, says it is *"in the same idiom as `referral_ward_reply_capped`: 256 holds `{"bed_count":4,"accepting":true}` and does not hold a narrative. A narrative is where a patient enters a system that has none."* The two disagree by a factor of four, and the larger one is on the only field a human is invited to type prose into. The stated compensating control — RPC-layer patient-information validation — does not exist and is not reliably buildable. → **Stage 5**, with the cap.

4. **`app.referral.updated_at` has no touch trigger.** `005` creates four tables and zero triggers. The column has `DEFAULT now()` and is thereafter whatever a writer supplies, including nothing. `ward_replied_at` is evidence in the qualified-privilege story and an unstamped sibling beside it degrades the record. → **Stage 5.**

5. **`.ci/ci-gate-exceptions.yml:27` cites a test that does not exist.** It names `tests/compliance/ci_gate_exceptions.test.ts`; the assertions actually live in `tests/compliance/ci_required_checks_not_paths_filtered.test.ts`. It escapes `no_phantom_paths.test.ts` only because the citation is not in backticks. A live Clause 4 phantom, in the one file whose purpose is to make CI exemptions visible. → **Stage 0.**

6. **Two guards whose headers describe something other than what they do.** `packages/fixtures/package.json` exports only `./truth-table.json`, while `config_drift.test.ts` reaches `public-relations.json` by relative path — the exports map is decorative. And `scripts/lint_from_allowlist.sh:31` extracts the allowlist with a fixed alternation, `grep -oE '"(facility_public|ward_public|lga_rollup|my_facility_wards|ward_status_history)"'`, while its header says the allowlist is not hardcoded there. It fails closed, so it is not dangerous — but Stage 1 adds a sixth name to that allowlist and the header will then be false in a way that matters. → **Stage 0.**

**Traps in correct code — no fix, a recorded decision.**

7. **A duty-flag flip does not change `updated_at`.** `008:145` writes `ward_public.updated_at = ws.updated_at`. That is right: the ward's claim did not change, only the derived gate. The consequence is that **any snapshot version counter derived from `max(updated_at)` will fail to regenerate after the anaesthetist goes off duty** — publishing a theatre as open when the gate has closed it. Recorded as a shape decision in Stage 1: `v` is a monotonic run counter or a content hash, **never a timestamp aggregate**.

8. **`011` explicitly defers ward-scope enforcement on writes to Bundle 3** (`011:12–14`: *"a WARD_STAFF account may only write its own ward — needs a `p_category` argument that no current caller passes, so it is Bundle 3 work"*). With one account and one category, an RPC that checks facility membership but never checks `p_category` behaves identically to one that does. Stage 1 provisions a second same-facility account for the sole purpose of making the difference observable.

9. **`app.facility_contact` has `agreement_accepted_at` and no `agreement_version`.** A bare timestamp records *when* a facility accepted; it cannot answer whether the document they accepted contained the role-address clause, once the agreement has been revised even once. → **Stage 2**, one column.

---

## The migration window

The founder's next irreversible step is applying migrations 001–013 to hosted, with a stop condition of **exactly 13 pending**. A `014_*.sql` merged to `main` before that makes the dry run report 14 and the founder stops — a self-inflicted block on the last step of the hosted setup.

**This resolves itself, and no coordination is required, because Stage 0 contains no migrations at all.** The spine touches `tests/`, `scripts/`, `packages/` and `.github/` only. By the time Stage 1 needs `014`, the apply is done.

Two rules follow, and they hold for the rest of the project:

- **Do not edit 001–013.** Treat the window as closed from today rather than from the moment the apply lands. Every fix above is `014` or later. The failure mode being prevented is a Stage 1 fix quietly editing `004` on a branch that outlives the apply, after which the ledger and the schema disagree and nothing errors.
- **If the apply slips past Stage 0,** do not hold the sprint. Restate the runbook's stop condition as *the thirteen named files* rather than a count, and say so in the pasteback so the founder is not reading a number that has moved.

Everything else — `tests/`, `scripts/`, `apps/`, `packages/`, `.github/` — merges freely throughout. Nothing in Stages 0–5 needs the hosted project: `db-tests` and the new E2E job provision their own local stack and local GoTrue is a real GoTrue.

---

## Stage 0 — The spine

**Why bundled together:** the fundamental says write the golden-path E2E early and let it be red. There is no Playwright, no E2E project and no CI job, so *"let it be red"* is currently a phantom — there is nothing to be red. This stage builds the thing that can go red, and it touches no migration, so it is also the work that runs while the founder applies to hosted.

### The problem with a deliberately-red test, and the mechanism that solves it

A deliberately-red **merge-blocking** test blocks every merge for the whole sprint. A **non-required** job red from inception is an unread sensor. A **skipped** job is worse than both — `tests/compliance/ci_required_checks_not_paths_filtered.test.ts` exists because GitHub counts a skipped required check as passing.

The way out is that *the E2E being incomplete* and *the gate being green* are compatible claims, if what gates is **the shape of the incompleteness**. Build a **frontier ratchet**:

- `packages/fixtures/golden-path-steps.json` — the ordered decomposition of Gate 2, one step per id, each tagged with the stage that lands it. One derivation site, imported by both files below.
- `tests/e2e/golden-path.test.ts` — one `test()` per step, in order, real assertions against a real stack.
- `tests/e2e/frontier.json` — `{ "passing_through": "<step-id>", "reason": "<stage that lands the next step>" }`.
- `tests/e2e/ratchet.test.ts` — **this** is the merge-blocking artifact, and it asserts four things:
  1. every step at or before `passing_through` passed — catches regression;
  2. the **first step after** `passing_through` **failed** — this is the whole design;
  3. the step-id set in `golden-path.test.ts` equals the fixture exactly — nobody moves the frontier by deleting a step;
  4. `collected > 0` on the e2e junit, via `scripts/attest_counts.mjs` — the anti-vacuity leg.

Assertion (2) is what makes progress non-optional. When Stage 1 lands `publish_ward_status`, the `publish-count` step starts passing, **the ratchet reds**, and the only way to green it is to move the frontier — a visible one-line diff in the PR that delivered the work. Progress is extracted by a failing gate rather than reported by a human.

**No `.skip` and no `.todo`, anywhere in `tests/e2e/`.** Standard O's cardinal sin is reaching green by skipping; a skipped step reads as passing to (1) and dodges (2). Every unimplemented step is a real, executed, failing assertion against something that does not exist yet.

**Tasks:**

- [ ] `packages/fixtures/golden-path-steps.json`, decomposing Gate 2 as restated below. Each entry: `id`, `description`, `owning_stage`, `needs_browser` (boolean).
- [ ] `tests/e2e/` — a third vitest project, `fileParallelism: false`, `sequence.concurrent: false`, seeding its own `E2E_`-prefixed facility rather than mutating seed rows.
- [ ] **A seventh CI job, `golden-path`, merge-blocking and added to branch protection.** Own runner, own `supabase start`, own database — *not* shared with `db-tests`. Rationale in the safety notes. No `if:`, no paths filter, no `continue-on-error`; `.ci/ci-gate-exceptions.yml` stays an empty list.
- [ ] Add `'golden-path'` to `EXPECTED_JOBS` in `ci_required_checks_not_paths_filtered.test.ts:51`. **That test reddening is the feature** — adding a CI job is supposed to force a decision about whether it gates merges. Add the seventh `PROVISIONAL` label with it; a ceiling copied from `db-tests` without one is a false measurement claim.
- [ ] **Fix finding 5** — `.ci/ci-gate-exceptions.yml:27` must cite `tests/compliance/ci_required_checks_not_paths_filtered.test.ts`, in backticks, so `no_phantom_paths.test.ts` covers it from now on.
- [ ] **Fix finding 6** — either make `packages/fixtures/package.json`'s exports map real and have `config_drift.test.ts` use it, or delete the map and say the imports are relative. Same for `lint_from_allowlist.sh`: fix the parser or fix the header. Do not leave either header asserting something the code does not do.
- [ ] `tests/setup/auth.ts` — the real-token harness. **This must precede the Stage 1 write RPC.** `tests/setup/db.ts` fakes identity with `SET LOCAL request.jwt.claims`, which is right for RLS probes and structurally cannot test the seam Stage 1 exists to prove: that a GoTrue-issued token's `sub` resolves to an `app.ward_account` row, and that `session_id` is a real per-session claim. A hand-forged claims blob contains whatever you put in it, so a `session_id ≠ uid` test written against it asserts your own fixture back at you.
- [ ] `sqlSecond()` in `tests/setup/db.ts`, with a header saying why it exists and that it must never be used for role-switching tests. `postgres({ max: 1 })` at `tests/setup/db.ts:27` is deliberate — it stops `SET ROLE` leaking across pooled connections — and it also makes two concurrent transactions impossible, which makes Bundle 3's stated DoD currently unwritable.
- [ ] `packages/fixtures/snapshot-shape.json` and `packages/snapshot/src/codec.ts` — see Stage 1, but land the shape here. It depends on nothing in Stage 1 and it is the artefact whose late decision forces rework on both sides.

### Magic-link auth in CI — the mechanism, and the one that would be a lie

`supabase/config.toml:151–152` has `[local_smtp] enabled = false`. There is no Inbucket and no SMTP, so `signInWithOtp` cannot send anything. Three routes, and the dividing line is **which leg gets bypassed**:

| Route | Verdict |
|---|---|
| Enable local SMTP / Inbucket | Adds a container to every cold start to buy fidelity over the **email template and transport**, which is not the property Gate 2 claims. And `[auth.rate_limit] email_sent = 2` per hour would bite immediately. No. |
| **`admin/generate_link` → public `POST /auth/v1/verify`** | **Use this.** Bypasses only the transport. Single-use lives entirely in the *consumption* leg, and that leg runs for real, over HTTP, against real GoTrue, with the anon key. |
| `admin/createUser` + minting a session, or hand-signing a JWT | Bypasses `/verify` itself — obtains a ward session without ever consuming a link, then claims to have proved magic-link auth. **Ban it in the `tests/e2e/` header by name.** |

Read the `generate_link` response field names off the GoTrue in the pinned CLI (`supabase` 2.117.0), not off the docs — print it verbatim in the first commit and assert against what came back. And mint **one** ward session per E2E run and reuse it: `[auth.rate_limit] sign_in_sign_ups = 30` and `token_verifications = 30` are per 5 minutes **per IP**, and a CI runner is one IP. A ratchet re-minting per step is a 429 waiting to be misfiled as a flake.

**The single-use probe — run it, and keep the runbook checkbox open.** Add it as an E2E step: mint → verify (session issued) → verify the same `token_hash` again (must be refused) → mint, force expiry, verify (must be refused). Record *how* expiry was forced, because that changes what was proved. Then, per test-conventions §4, the file header carries: *NOT ASSERTED HERE, deliberately: hosted magic-link single-use. Local GoTrue is pinned by the Supabase CLI; hosted auth is upgraded by Supabase out-of-band and is not that version.* And `docs/runbook-supabase-project-creation.md` §5b currently reads *"Covered by tests: nothing."* — after this lands that sentence is false and must become *"the local-integration leg only, against GoTrue \<version\>; the hosted vendor property remains uncovered and this checkbox is still the only control."* Have the job print `curl -s http://127.0.0.1:54321/auth/v1/health` every run so the local claim always carries the version it is true of.

### Gate 2, restated — [CORRECTED]

Gate 2 requires *"the tile reflects it **within 60 seconds with no page refresh**"*. That was written against A1's Realtime design. **A1 was reversed**: public reads come from a static snapshot at `s-maxage=30, stale-while-revalidate=300`, which may legitimately serve a five-minute-old payload.

Written as-is, the spine encodes a requirement the chosen architecture cannot meet — and the natural fix when it goes red at 3am is to add Realtime back, which is the decision that was reversed for a measured reason. **Restate before writing the spine:**

> …the ward publishes → **a client poll at the snapshot's own cadence reflects the new count**, where the cadence is a named constant in `snapshot-shape.json` and the assertion is written against that constant, not against a wall-clock number in prose → …

Everything else in Gate 2 stands.

**Specialist input incorporated:** platform-SRE produced the ratchet, the auth route table, the separate-job rationale and the Gate 2 correction. Staff-engineer supplied the ordering finding — that the harness and the snapshot contract both run *ahead* of B2 rather than inside it.

**Safety/quality notes.** The E2E gets its own database and its own runner, for four reasons, and the first is decisive: **`db-tests` is a rollback-only suite over a pristine corpus.** `withRole()` throws a sentinel to force rollback precisely so a probe never mutates what later assertions run against. The golden path must **commit** — a published count has to fire the 008 triggers and reach the mirrors. Committing into that database makes `seed_shapes.test.ts` and Gate 3's exact-cardinality assertion order-dependent, which is the exact class of nondeterminism the last session spent a day diagnosing. Manufacturing a second instance of it to save a container pull is a bad trade. Beyond that: `fileParallelism: false` exists because the RLS suite mutates roles and grants; a second database on the same Postgres does not work because PostgREST and GoTrue are bound to `postgres`; and a ratchet break reddening a check named `db-tests` is a misleading sensor.

**Start browserless.** Only two Gate 2 steps genuinely need a browser — the distance-sorted tile render, and the poll reflecting an update. Everything else is HTTP and SQL. Put Playwright behind the last two ratchet steps, landing in Stage 3, and declare it in `golden-path-steps.json` via `needs_browser` so its absence is a visible frontier position rather than an assumption. Header line: *NOT ASSERTED HERE, deliberately: real browser paint. jsdom with fake timers proves the poll fires, not that a phone renders it.*

**Clause 5 classification:** the `golden-path` job is **GUARD-AHEAD-OF-SUBJECT**, and its header states the claim exactly — *this job executes the full Gate 2 decomposition against a real stack and is non-vacuous; steps beyond the frontier fail because the code they target arrives in the named stage.* Each fixture entry's `owning_stage` is its own reclassification receipt, and moving the frontier is mechanically the only way to green the ratchet.

**Blast radius:** adding a seventh job reddens `ci_required_checks_not_paths_filtered.test.ts` by design — that is the one test that must be updated in the same commit. `tests/setup/db.ts` gains `sqlSecond()` and loses nothing; existing callers of `sql()` are unaffected because `max: 1` and `withRole()` are untouched. The two header fixes in finding 6 change no behaviour — `lint_from_allowlist.sh` already fails closed. No migration is touched, so the founder's hosted apply is not affected in either direction.

**Definition of done:** `golden-path` is green and merge-blocking with the frontier at the last step Bundle 1 delivers; deleting a step from `golden-path.test.ts` reds the ratchet; moving the frontier forward one step without implementing anything reds it; an empty e2e run reds it via `attest_counts.mjs`; the single-use probe passes locally and the runbook sentence is corrected; a real GoTrue access token authenticates a PostgREST request from `tests/setup/auth.ts`.

---

## Stage 1 — The vertical slice

**Why bundled together:** this is the smallest thing that is *connected*. One ward account signs in with a real magic link, publishes one bed count for one category, and that number reaches the public dashboard through the projection and the snapshot. Everything in it exists because removing it would break the chain; everything not in it is in Stage 2 or 3.

### From Bundle 2 — three things

- [ ] **The `auth.uid()` → `app.ward_account.id` seam.** Nothing in the repository creates a `ward_account` today; `003`'s `id` is a bare `uuid PRIMARY KEY` with no FK to `auth.users` and no writer. Build `scripts/provision_ward_account.mjs`: service-role, calls the GoTrue admin API to invite a role address, inserts the matching `app.ward_account` row with `id = <auth user id>`, stamps `app.invite.accepted_at`. **A script, not an RPC** — Sprint 1 ships no self-serve admin surface anywhere, so an `accept_invite` RPC would be a public write surface with no caller, and holding the client-reachable write surface at exactly one function is what keeps `rls_rpc_execute_allowlist.test.ts` cheap to keep honest.
- [ ] Magic-link sign-in in a new `apps/ward-console/`. One screen. Session held by supabase-js.
- [ ] **A second ward account at the same facility, on a different category.** Its only purpose is to make finding 8 observable. Without it the ward-scope check and its absence are indistinguishable.

Deferred to Stage 2, and the slice is not a lie without them: `app.device` binding and any `token_hash` write (nothing on the golden path reads it); the facility-admin deactivate action (`app.assert_member` already blocks `is_active = false`, and `cross_tenant_writes.test.ts` already proves it).

### From Bundle 3 — one RPC, and the rules that cannot be added later without a migration

```sql
public.publish_ward_status(
    p_category           app.ward_category,
    p_offering           app.ward_offering,
    p_bed_count          integer,
    p_accepting          boolean,
    p_reason             app.zero_reason,
    p_expected_version   integer,
    p_client_mutation_id text,
    p_composed_at        timestamptz
) RETURNS TABLE (
    version             integer,
    updated_at          timestamptz,
    bed_count           integer,
    accepting_effective boolean,
    gated_by            app.gate_reason
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
```

Four load-bearing properties of that signature:

- [ ] **No `p_facility_id`.** Resolved from `auth.uid()` exactly as `public.my_facility_wards()` does. The absence is the control, in the same idiom as the missing `p_offset` in `ward_status_history`.
- [ ] **It returns `accepting_effective` and `gated_by`** — from the same derivation the projection just ran. Not decoration: it makes the nurse's screen show what the public sees, which delivers most of B3's gate-notification task for free and removes any reason for the console to recompute the gate.
- [ ] **Grants via the by-name `DO` block from `011` §2, never `REVOKE ... FROM PUBLIC`.** Supabase's `pg_default_acl` grants EXECUTE to `anon`, `authenticated` and `service_role` *by name*, so a revoke from PUBLIC leaves it intact. This exact hole was one of the two live ACL defects the suite caught on its first run.
- [ ] **Error contract:** `42501` for auth via `app.assert_member`; `P0001` with the code as the first token for rules — `ZERO_REQUIRES_REASON`, `STALE_MUTATION`, `FUTURE_MUTATION`, `VERSION_CONFLICT`, `WARD_SCOPE_DENIED`. Clients map codes, never message text.

Inside it, one transaction: `UPDATE app.ward_status … WHERE facility_id = v_facility AND category = p_category AND version = p_expected_version RETURNING`; zero rows raises `VERSION_CONFLICT` with the current version in `DETAIL`. Then `INSERT app.ward_status_event`, then `INSERT app.audit_log`. The 008 trigger fires in the same transaction and nothing further is needed to reach `public.ward_public`.

**Six things the slice would otherwise hide. All cheap, all invisible if skipped.**

- [ ] **Ward-scope enforcement** (finding 8): `IF v_role = 'WARD_STAFF' AND v_ward_category IS DISTINCT FROM p_category THEN RAISE … ERRCODE = '42501'`, tested with the second account. Without it, the widening pass is where a MATERNITY account starts writing `ICU_PAEDIATRIC` counts.
- [ ] **A symmetric `composed_at` window.** The spec is `now() - composed_at > interval '2 minutes'` → `STALE_MUTATION`. A handset three hours **fast** — the exact device F3 is about — sends a future `composed_at`, the difference is negative, and the check passes forever. Add `IF p_composed_at > now() + interval '30 seconds' THEN RAISE 'FUTURE_MUTATION'`. One device in the slice means zero skew, so this is otherwise unobservable.
- [ ] **`014`: the idempotency index** (finding 2). `CREATE UNIQUE INDEX IF NOT EXISTS ward_status_event_client_mutation_uidx ON app.ward_status_event (ward_status_id, client_mutation_id) WHERE client_mutation_id IS NOT NULL`. Test: the same `client_mutation_id` twice yields one event row, one version bump, the same returned payload.
- [ ] **The `session_id ≠ auth.uid()` test, against a real GoTrue token.** `005` says explicitly that a CHECK cannot enforce this and that the rule belongs to the Bundle 3 writer RPC and must be asserted there. Derive it once as `(auth.jwt() ->> 'session_id')::uuid`; assert it differs from `auth.uid()` and that it changes across two GoTrue sessions of the same account. Without this test, **CTO condition (2) of the ward-identity memo is a comment**.
- [ ] **The sequential version-conflict test** — publish twice with `expected_version = 1`. Needs no second connection and catches the whole optimistic-locking class. The interleaved two-connection test is Stage 2, on `sqlSecond()`.
- [ ] **Server-side `ZERO_REQUIRES_REASON`** — one `IF`. The one-tap chip UI is Stage 2; the server rule is not.

Deferred to Stage 2: admin challenge, admin publish, the +/- counter, optimistic UI, the 90-second bounded retry, single-in-flight, parked-at-1.

### From Bundle 4 — the contract, the generator, one tile

- [ ] **`packages/fixtures/snapshot-shape.json`** (landed in Stage 0). Carries `envelope`, `facilityColumns`, `wardColumns` — the frozen `public.ward_public` list from `007` — a named `pollCadenceSeconds`, and a `golden` payload.
- [ ] **`packages/snapshot/src/codec.ts` — one implementation, not two.** Both sides importing the JSON and each writing their own mapping is two derivation sites one layer down. Build `encodeWard` / `decodeWard` from `wardColumns` at module load; the generator imports the encoder, the dashboard imports the decoder, **neither contains a column list**.
- [ ] `packages/snapshot/src/freshness.ts` and `anchor.ts`. **Not in `packages/gate`** — see the safety notes.
- [ ] **`app.regenerate_snapshot()`**, `SECURITY DEFINER`, `SET search_path = ''`, EXECUTE revoked from PUBLIC and granted to `service_role` only. Reads the three mirrors, writes one row to `public.snapshot_current` **and** `app.system_heartbeat.last_snapshot_at` **in the same transaction**, so it can never claim a regeneration that did not commit.
- [ ] **`v` is a monotonic run counter or a content hash — never a timestamp aggregate** (finding 7). Record the reason in the fixture, not only in the function.
- [ ] **The snapshot never carries duty flags.** The F2 ESLint rule matches on *identifier names* (`/anaesthetist|obstetrician|paediatrician/i`); arrays-of-arrays destroys names, and `!f[3]` is invisible to it. Today the payload carries only `gated_by`, so exposure is zero — but the natural widening ("show *why* it's closed in a tooltip") is exactly what reintroduces it. Written down as a decision in the fixture comment, because it is currently a property nobody has stated.
- [ ] The tile: name, phone as the only full-width action, count, absolute timestamp with explicit `Africa/Lagos`, freshness band. Plus the persistent *"indicative — call before you travel"* banner and the permanent 767 / 112 / LASAMBUS strip. Roughly fifteen lines of static markup, and they are what makes an ugly slice not dangerous if anyone opens it.
- [ ] `/api/health` returning 500 when `now() - last_snapshot_at > 5 minutes` or the database is unreachable.
- [ ] **`docs/runbook-snapshot-stopped.md`** — symptom, check (*is the Supabase project paused* — ten seconds, by far the likeliest), action, escalation, and what fixed looks like (`version` incrementing across two fetches 60s apart).
- [ ] **A planted positive, run once, with the observation recorded.** `select cron.unschedule('regenerate_snapshot')` → confirm `/api/health` goes 500 → confirm the email arrives → re-schedule. Record the **observed** detection latency, not a designed one. A sensor that has never fired is not a sensor.

Deferred to Stage 3: geolocation, haversine, the LGA fallback, the first-run interstitial, the display-state log, `lga_rollup` in the payload, the service worker.

**One deferral that is a prohibition, not a gap: with one facility there is no sort. Do not implement a placeholder.** `order by updated_at desc` is the sort collapse named in Gate 3, it will look sensible when written, and it will survive the widening pass.

**Specialist input incorporated:** staff-engineer produced the RPC signature, all six hidden-defect pins, the codec design and the `packages/gate` boundary call. Platform-SRE supplied the in-database generator, the heartbeat-in-the-same-transaction rule and the planted positive.

**Safety/quality notes.** Two placement decisions carry real weight. First, **the generator must not live under `apps/`** — `scripts/lint_no_service_role_in_bundle.sh` scans `apps/**/dist/**` and would correctly red on the generator's own service-role reference; under `packages/` it is still scanned by `lint_no_updated_at_filter.sh`, which is what you want, because the generator is the single most likely home for the 4am filter. Second, **freshness does not go in `packages/gate`.** That package has a specific identity: rules implemented *twice*, in SQL and TypeScript, pinned by a shared fixture in one block. Freshness has exactly one derivation site by design — the server stamps `updated_at` and emits `server_now` and deliberately never computes an age. Putting it in `packages/gate` invites the next contributor to write the SQL twin for symmetry, and the SQL twin of a freshness rule is `where updated_at > now() - interval '2 hours'` — the precise collapse `lint_no_updated_at_filter.sh` exists to ban.

**The generator's death is camouflaged by correct UI behaviour, and this is the trap worth naming.** A dead generator degrades into grey badges, "last known", and at 24h "Status unknown — call to confirm" — exactly the states Bundle 4 is designed to render *calmly*. `stale-while-revalidate=300` keeps the CDN serving a plausible file for five minutes after the origin dies. So the sensor cannot be the dashboard, and it cannot be a timestamp either: a generator that runs and emits an identical payload looks fine on `generated_at`. **The discriminating signal is that `version` stopped incrementing**, backed by the transactional heartbeat. Both are in this stage rather than waiting for Bundle 5, because the slice is the first thing that can actually stop.

**Blast radius.** `014` adds one index and no column, so nothing shipped changes shape; `rls_anon_column_containment.test.ts` and the frozen-list assertions are untouched. Replacing that test's literal FROZEN list with `snapshot-shape.json`'s `wardColumns` makes `007`'s table, the anon-surface guard and the snapshot contract one source instead of three — do it in this stage, and confirm `rls_anon_column_containment` still passes against the live `information_schema` rather than only against the fixture. Adding `publish_ward_status` adds a sixth name to `lint_from_allowlist.sh`'s allowlist, which is why finding 6 is fixed in Stage 0 rather than here. Note also that the lint greps `.from(` only, so `.rpc('publish_ward_status')` is entirely outside its coverage — add that as a NOT-ASSERTED line rather than leaving it as an assumption. `public.my_facility_wards()` returns every category of the facility, including other wards' private `reason_code`, to a single-ward account; within a facility that is probably right, but it is currently an accident rather than a decision, and the slice will not surface it — record it in Stage 2.

**Definition of done:** the golden-path frontier has moved through `publish-count` and `tile-shows-count`; a real magic link produces a session that publishes and the number appears in `public.ward_public` and then in `snapshot_current`; a second publish at a stale `expected_version` raises `VERSION_CONFLICT`; the second ward account is refused with `WARD_SCOPE_DENIED`; a `composed_at` three minutes old and one thirty-one seconds in the future are both refused; the same `client_mutation_id` twice yields one event; `session_id` differs from `auth.uid()` and changes across sessions; unscheduling the generator drives `/api/health` to 500 and the observed latency is written down.

---

## Stage 2 — Widen the write path

**Why bundled together:** everything here is the rest of one screen and one transaction boundary. The counter, the zero modal, the admin challenge and the concurrency behaviour are a single unit of behaviour and cannot be verified apart — that was the v1 rationale for Bundle 3 and it still holds. What changed is that the transaction boundary already exists, so this stage widens it rather than inventing it.

**Tasks:** everything in the v1 kickoff's Bundle 3 not already delivered by Stage 1 — the +/- counter as local state transmitting an absolute value, the zero-reason chips under three seconds, admin challenge (`state='UNDER_REVIEW'`, never touching `bed_count` or `accepting`, bumping `version`), admin publish with mandatory `admin_note`, optimistic UI rendering pending as visibly unconfirmed, the failure message naming the **public** state, single in-flight per ward, out-of-order response handling, the 90-second bounded retry, `touch-action: manipulation`, `pointerup`, the delta-threshold confirm, gate notification to the ward, parked-at-1 detection. Plus the rest of Bundle 2 — `app.device` binding on `token_hash`, the facility-admin deactivate action.

**And the Background Sync prohibition, which is a task, not a note.** No Background Sync registration for bed writes, ever. A queued bed count is strictly worse than a failed one: the payload is an absolute assertion about *now*, replaying it at T+15min manufactures a green badge for data that was already stale when queued, and the optimistic UI has already told the nurse it published so nobody re-checks. Stage 1's `FUTURE_MUTATION` and `STALE_MUTATION` arms make any rogue replay harmless by construction; this keeps the mechanism from existing at all.

**Three additions from this scoping pass:**

- [ ] **The interleaved concurrency test**, on Stage 0's `sqlSecond()`: both connections read `version = 1`, both write, exactly one succeeds and the other sees a conflict carrying the winner's value. This is Bundle 3's stated DoD and it was unwritable until `sqlSecond()` existed.
- [ ] **`014`+: add `ORDER BY ws.category` to the `INSERT … SELECT` in `app.project_facility`.** `008` recomputes every ward of the facility and takes `public.ward_public` row locks in plan order, so two concurrent writers to different categories of one facility can take the same locks in different orders. One ward in Stage 1 could not surface this; two writers here can. Fixed by ordering the lock acquisition, in a new migration — `008` is applied and is not edited.
- [ ] **`014`+: `agreement_version text` on `app.facility_contact`** (finding 9), with the table's existing CHECK idiom: `CHECK ((agreement_accepted_at IS NULL AND agreement_version IS NULL) OR (agreement_accepted_at IS NOT NULL AND agreement_version IS NOT NULL))`.
- [ ] **The invite gate.** No invite may be issued for a facility whose `app.facility_contact.agreement_accepted_at IS NULL`. Cross-table, so it is a guard clause at the top of the invite path beside `app.assert_member`, plus a `tests/db/` leg with one plant — null the timestamp, assert the raise. This is what stops the role-address clause being a paragraph in a PDF that reaches some facilities and not others in an order nobody records.
- [ ] Record the `my_facility_wards()` cross-ward `reason_code` visibility as a **decision** in the function's comment — within a facility it is right; it is currently an accident.

**Specialist input incorporated:** staff-engineer supplied the deadlock finding and the interleaved test. CLCO supplied the invite gate and `agreement_version`, and — importantly — **argued against** two things that look like the obvious mitigations here: an `is_role_address` boolean and a `gmail.com`/`yahoo.com` heuristic at invite time. Both are refused, and the reasoning is in the safety notes because it will otherwise be re-proposed.

**Safety/quality notes — the design-induced defect, restated because it is the one that will actually bite.** Setting 0 costs a modal, a reason code and an alert to your boss. Setting 1 costs nothing. Staff will find this within a fortnight, and a chronic "1 bed" that is actually 0, wearing a green badge, is the most misleading state this system can produce. It will not appear in any test written against the spec, **because the spec is what causes it.** Two-part fix, both in this stage: make honesty cheap (one-tap chips, sub-three-second flow) and detect the residue (parked-at-1).

**Why there is no `is_role_address` column.** A magic link must be sent to an address; a ward role address is not personal data and a nurse's personal Gmail is; there is no technical check that distinguishes them and there will not be one. The mitigation is contractual (see `docs/facility-agreement-clause-x-access-addresses.md`). A boolean recording the Operator's belief is worse than absent for two reasons. `app.invite` deliberately holds **no address** — the address lives once, in `auth.users` — so a flag *about* an address on a table that has none is an assertion about an object that is not there. And the clause's operative move is that **the Operator makes no determination and relies on the facility's warranty**; a column in which the Operator records `true` is a self-generated document in which the Operator did make one. In a dispute it is the counterparty's exhibit. A domain heuristic fails on the same precedent that cut `fingerprint` — no consumer, no defined response — with one more defect: `amina.bello@lasuth.gov.ng` is a personal address on a facility domain and passes cleanly, so its false-negative rate is highest on exactly the population that matters, while its green teaches everyone the question has been answered.

**Blast radius.** `ORDER BY ws.category` changes lock acquisition order and nothing observable: `projection_ward_public.test.ts`, `projection_quiet_mode.test.ts` and `gate_semantics.test.ts` assert row contents, not ordering, and the upsert is already idempotent per `migration_idempotency.test.ts`'s content-hash digest — re-run that after the change rather than assuming. `agreement_version` is additive and nullable-when-unaccepted, so `facility_contact`'s `has_a_channel` and `sms_requires_optin` constraints are unaffected; the table is deliberately outside the append-only set so the row stays erasable, and adding a column does not change that. The invite gate is the first cross-table precondition in the codebase — it must raise `P0001` with a stable code, not a bare exception, or the console cannot distinguish it from a network failure. Admin challenge bumping `version` means an in-flight nurse write hits `VERSION_CONFLICT` rather than silently clearing the review flag; that interaction is the reason the version column exists and Stage 1's conflict tests already cover the mechanism.

**Definition of done:** two simulated concurrent nurses produce a visible conflict rather than a silent overwrite, on two real connections; an admin challenge survives an in-flight nurse write; zeroing without a reason is impossible from the UI and from the RPC; a failed write leaves the UI showing the **server's** value with the public-state message; a forwarded magic link cannot publish; deactivation immediately blocks publish; an invite against a facility with no accepted agreement raises.

**This stage moves the golden-path frontier by zero steps, and that is correct rather than a gap.** An earlier draft of this line claimed the frontier moves through the update-request steps. It cannot: those steps are owned by Stage 3, because `owning_stage` names the stage that makes a step *pass* and the update request is Bundle 4 work. Everything Stage 2 delivers widens a step Stage 1 already made pass. See the reachability rule under *Standing constraints*, where Stage 2 is one of the two worked examples.

---

## Stage 3 — Widen the read path

**Why bundled together:** the snapshot generator, the client derivation and the tile are one contract, and this is where the second facility arrives — which is the first moment sort order, distance, quiet mode and the staleness ceiling become observable at all.

**Tasks:** everything in the v1 kickoff's Bundle 4 not delivered by Stage 1 — client haversine with coordinates never leaving the device, the `(freshness_bucket asc, distance asc, facility_id asc)` sort key, freshness bands with the absolute timestamp always shown, "last known" on grey, the 24-hour suppression ceiling, geolocation never blocking first render with the full fallback order, the always-visible LGA control, update-request with its rate limits and TTL, the first-run interstitial, `noindex` and the public-surface rate limit, the service worker with `NetworkOnly` on all data routes, the 24-month display-state log, and Cloudflare Pages deployment. Plus Playwright and the last two ratchet steps.

**Three additions from this scoping pass:**

- [ ] **The F3 compliance guard** — specified below. The handoff records it as *not built, a Bundle 4 instruction rather than a control that exists*; this is where it becomes a control.
- [ ] **Give `app.refresh_lga_rollup()` a caller** (finding 1). It runs inside `app.regenerate_snapshot()`, in the same transaction, before the rollup is read. Add a test that mutates a quiet facility's ward and asserts the published rollup moved — the current suite calls the function explicitly, so it proves the function works and not that anything invokes it.
- [ ] **The public rate limit persists no IP address.** See the safety notes; this is a shape decision that must be made before the update-request table is created, not after.

### The F3 guard, specified to implement

**An ESLint `no-restricted-syntax` rule, not a tenth shell script.** It parses the AST, so it cannot fire on a commented-out example or a string literal — and every guard in this repo documents its own banned shape in its header, which has already bitten once. `tests/compliance/eslint_duty_flag_negation.test.ts` is a proven plant harness to copy.

Scoped to `apps/**/*.ts`, `apps/**/*.tsx` and `packages/snapshot/src/**/*.ts`. Bans: `Date.now()`, `new Date()` with no arguments, `Date.UTC`, and `performance.timeOrigin` — the sneaky one, a monotonic source recombined into wall-clock. **`new Date(isoString)` stays legal**; the tile must render "Updated 04:12, 8 Sep" from `updated_at`, and a rule that rejects that is a rubber stamp someone disables within a fortnight.

Plants, one per distinct failure mode: `Date.now() - Date.parse(w.updated_at)` (the canonical F3 regression, the one a slow Android turns green); `new Date().getTime() - t`; `+new Date() - +new Date(w.updated_at)` (the coercion form); `performance.timeOrigin + performance.now()`. Positive control: `new Date(row.updated_at).toLocaleString('en-NG')` must lint clean.

The ACCEPT leg needs a third clause — `expect(lintedPaths).toContain('packages/snapshot/src/freshness.ts')` — because without it the leg accepts a corpus containing no freshness code at all, which is what a guard shipped ahead of its subject accepts by default. Attach `result.messages` to every assertion, per the 2026-09-09 rule. Anti-vacuity leg: point ESLint at a scratch tree holding only a `.md` file and assert the run reports zero files linted, which catches a `files:` glob that stopped matching after a rename.

The correct anchor is `freshnessBand(updatedAtIso, serverNowIso, elapsedSinceFetchMs)` — pure, reading no clock. The elapsed term comes from `performance.now()` sampled at fetch and again at render: monotonic elapsed time, not a wall clock, so it cannot be wrong by three hours. One line in `packages/snapshot/src/anchor.ts`, annotated `OPENBED-CLOCK-ANCHOR` in the same grep-able idiom as `OPENBED-FRESHNESS-ORDER-ONLY`. **The correct annotation count is one**, and that count is itself reviewable.

**NOT ASSERTED HERE, deliberately** — put all of this in the header, per test-conventions §4: it does not assert the freshness computation is *correct*, only that no display module reads a wall clock — a module that anchors properly and mis-computes the 60-minute boundary passes, and that is the golden-fixture band test's job. It does not reach transitive dependencies; a date library reading the system clock inside `node_modules` is invisible to a rule scoped to first-party globs, and the mitigation is the dashboard's zero-runtime-dependency posture, which is a property of `package.json` and not a control here. It does not see a clock read arriving as *data* — if something upstream replaces `server_now` with a locally computed value every display module still passes, and the codec's decode is the choke point for that. And once a value is in a variable it cannot distinguish a legitimate monotonic anchor from a wall-clock read; `OPENBED-CLOCK-ANCHOR` is a declaration, not a proof.

**Specialist input incorporated:** staff-engineer specified the guard, its plants and its boundary. CLCO supplied the IP finding and the privacy-notice gap.

**Safety/quality notes — the 4am gate stands unamended**, and the subtle failure is still the sort collapsing rather than a filter: `order by updated_at desc` puts a fresh facility 90km away above a stale one 2km away, and at 4am degenerates to "whoever last touched the app", which correlates with nothing clinically useful. Stage 1's prohibition on a placeholder sort is what keeps that from arriving as legacy.

**The IP problem, which is the Bundle 6 trap one stage early and has not been named anywhere before now.** Bundle 4 says the update-request is *"rate-limited per device, per IP, per facility per hour"* and offers *"IP-derived state as a labelled editable guess"*. No `app.update_request` table exists yet. Whoever builds it will add `ip` or `ip_hash` or `client_ip` and it will look completely natural — you cannot rate-limit per IP without an IP. **CTO condition (1) of the ward-identity memo says an IP address is personal data in its own right.** The whole position survives Bundle 6 only to be falsified here, by a column the spec explicitly asks for, on a table created by someone who read the memo and correctly concluded it was about accounts. What would be held is IP addresses of members of the public who used a Lagos hospital bed-finder, keyed to a facility and a ward — so with an inference about the searcher's likely medical need attached — with no lawful basis recorded, no retention period and no notice. That is materially worse than anything the ward-identity decision removed.

**The call, and it must be made before the table is created:** the public rate limit is enforced **at the edge** (Cloudflare), and no IP is persisted in Postgres. Cloudflare already sees the IP as a network necessity and holds it under its own terms; a copy in the database is a new holding you own. If a server-side counter proves genuinely necessary, it holds a **truncated, per-day-salted hash with a hard 24-hour TTL and no foreign key to anything**, so what is held is "this bucket has asked four times today" — a count rather than an identifier. That is exactly the shape the memo prescribed for `fingerprint` if it ever shipped; use that precedent by name so it reads as consistency rather than invention. And take the geolocation fallback from Cloudflare's `CF-IPCountry` header at the edge, or drop it — a third-party IP-geolocation API means a public user's IP goes to an unnamed processor abroad with no DPA and no notice, to produce a "labelled editable guess" the always-visible LGA control already covers. **Extend the fixture-driven exact-column-list guard to `app.update_request` in the commit that creates the table**, not after.

**Blast radius.** Calling `refresh_lga_rollup()` from `regenerate_snapshot()` puts a full rollup recompute in the snapshot's transaction; at a few hundred facilities that is trivial, but `lga_rollup_kfloor.test.ts` currently calls the function directly inside a rolled-back transaction and must keep doing so — do not rewrite those tests to go through the generator, or the k-floor assertions start depending on the generator's correctness. The 24-hour display ceiling and Stage 4's 2h/6h escalation thresholds are **independent constants and must not be shared**: a ward past 24h is still escalated, because silence is the trigger, but its number is no longer published. The service worker is the last thing added, not the first; `NetworkOnly` on `/rest/v1/*`, every RPC and the snapshot is non-negotiable, because the Workbox `StaleWhileRevalidate` default is the recipe everyone copies and it paints yesterday's bed counts under a full green badge.

**Definition of done:** all three release gates green, with Gate 2 as restated in Stage 0; a denied geolocation permission still yields an ordered non-empty list; the offline page shows no tiles; a quiet facility's rollup moves when its ward moves; the F3 guard reds on all four plants and passes its positive control and its anti-vacuity leg; no IP address exists in any `app` table.

---

## Stage 4 — Escalation and notification reliability

**Why bundled together:** unchanged from the v1 kickoff's Bundle 5 — the sweep, the outbox, the suppression state machine and the dispatcher are one control loop, and any piece alone either fails silently or spams a matron into muting the channel permanently, which destroys the anti-gaming mechanism the verification model rests on.

**Tasks:** the whole of Bundle 5 as written. It is the one bundle this scoping pass did not restructure, because platform-SRE produced it end to end and the reasoning has held.

**Two things it inherits from earlier stages rather than building:**

- [ ] **The dual scheduler already exists.** Stage 1 stood up `pg_cron` plus the external caller for `regenerate_snapshot`, for the reason Bundle 5 gives — Supabase pauses free projects after 7 days of low activity, pg_cron's own activity does not count toward preventing it, and pg_cron cannot report its own death because it *is* the thing that is off. The sweep joins the same schedule rather than inventing a second one.
- [ ] **`/api/health` and the heartbeat already exist.** Bundle 5 widens `/api/health`'s second condition (zero notifications reaching DELIVERED or ACKED in 24h while at least one was QUEUED) and builds the full `/status` page on top of the minimal surface Stage 1 shipped.

**Three additions from this scoping pass:**

- [ ] **Execute the email provider's DPA before the first send.** NDPA s.29 requires a written processor agreement; all of Resend, Postmark and SES publish a click-through DPA and executing it takes under an hour. This is currently unpapered and it is a real obligation, not a formality.
- [ ] **Record which provider sends magic links and which sends escalations** in `docs/runbook-supabase-project-creation.md`, beside the region pin and the exposed-schemas check. If Supabase's built-in SMTP sends the links and Resend sends the alerts, that is **two** processors — and **Residue A physically lives in the first one's delivery logs**, which the runbook does not currently name. Set log retention on both accounts to the shortest offered.
- [ ] **A distinct provider account for notifications, with its own API key under a distinctly-named env var**, recorded in the runbook. Bundle 2 requires the notification contact store to be physically separate from any Paddie Health marketing infrastructure — no shared table, no shared list, no shared provider account — and that is what makes the non-commercial covenant credible rather than aspirational. A compliance guard is the wrong instrument for a fact about provider accounts; a named account plus Clause X.7 of the facility agreement is the right one.

**Specialist input incorporated:** platform-SRE, as in v1. CLCO added the DPA, the s.41 transfer basis, the two-processor finding and the provider-separation control.

**Safety/quality notes.** The way this is most likely to be quietly broken for a week is unchanged and worth restating: **not the sweep dying** — that has loud symptoms, because the public dashboard dies with it and someone complains — but the sweep running perfectly, alerts created, the provider returning 200 and a "delivered" webhook, and every message landing in spam. Every admin stops seeing alerts, nobody reports it because a missing alert has no complainant, and every light in the stack is green. Email makes the provider's own success signal *actively misleading*, because "delivered" means accepted by the receiving server, which includes accepted-into-spam. SPF/DKIM/DMARC before the first send is the prevention; the daily synthetic probe and the weekly human reply-OK check are the detection, and they are two sensors that do not share a failure mode. **A sensor that has never fired is not a sensor** — plant a failure into each and record the observed detection, as Stage 1 did for the generator.

**Blast radius:** the outbox is written from Stage 1's and Stage 2's transactions, so those RPCs enqueue rather than send — an SMS provider timeout must never roll back a bed count. The 2h/6h thresholds stay independent of Stage 3's 24h display ceiling. The channel change touches nothing in Stages 1–3 or 5 because no caller outside the adapter knows the channel, which is the test of whether the adapter boundary was drawn correctly. The dispatcher must handle a recipient with **no** reachable channel by falling back to in-app plus the daily digest and flagging the facility on `/status`, never by silently dropping.

**Definition of done:** as Bundle 5, unchanged — plus the DPA is executed, both processors are named in the runbook, and the notification provider account is demonstrably separate.

---

## Stage 5 — Outcome capture

**Why bundled together:** small, and it closes the loop the golden path requires. Deliberately thin — the governance wrapper is Sprint 2, because the raw capture is what the E2E needs and the wrapper is process, not path.

**Tasks:** the v1 kickoff's Bundle 6 as written — the ward-to-ward referral, the one-tap outcome, the non-accusatory UI rename, structured fields only, invited ward accounts only, rate limiting, the right of reply, the audit write, and the publication prohibition.

**Four additions from this scoping pass. The first two are the reason this stage was reviewed separately.**

- [ ] **`014`+: cap `ward_reply` at 240 characters** (finding 3). It currently holds 1000, which is twenty copies of *"the 24yo primip from Ikorodu we called about at 3am"* — the exact sentence `005`'s own comment gives as the thing free text must not hold. 240 holds *"Our NICU was full at 03:00 — the portal figure was about 40 minutes old"* and does not hold a case history. The field stays: the qualified-privilege argument for a right of reply is sound. The cap is what makes it a reply rather than a report. **Enforce it in the UI as a visible counter, not silently at the server** — a 1000-character box with a server rejection at 240 is both a worse experience and a worse control. Label the field *"Reply about the availability figure — do not include any patient information"*, as the label, not a hint.
- [ ] **`014`+: a touch trigger on `app.referral.updated_at`** (finding 4), matching `app.touch_updated_at()` from `003`.
- [ ] **The referral column guard** — specified below.
- [ ] **The export prohibition, as a guard rather than a sentence.** Bundle 6 says *"enforce as a code-level constraint on the export path, not a convention"*. There is no export path yet, which is exactly why the guard is written now: extend `lint_from_allowlist.sh`'s corpus so `app.referral` and `app.audit_log` may not be referenced anywhere under `apps/` or in the snapshot generator's source, with a plant per direction.

### The referral guard

Same triple as the audit-log guard, so a reader who knows one knows the other: `packages/fixtures/referral-columns.json`, `scripts/lint_referral_ward_to_ward.sh`, `tests/compliance/referral_ward_to_ward.test.ts`, plus the live twin `tests/db/referral_column_list.test.ts` over `information_schema`. **Ship both halves or the coverage claim is half-true.**

Five legs:

1. **Set equality.** `app.referral`'s parsed column list equals the fixture exactly, in both directions. Growth *and* shrink fail. This is the leg that catches the column nobody thought to forbid — a forbidden-name list only catches names somebody already imagined.
2. **Forbidden names**, for the louder message and to cover the ALTER vector. Two families, and the second is the one that does not appear on the audit-log list: *referrer-identity* (`referrer_account_id`, `ward_account_id`, `actor_id`, `user_id`, `clinician_id`, `clinician_name`, `filed_by`, `created_by`, `email`, `mobile_e164`, `ip_address`, `user_agent`, `device_id`, …) and **patient-identity** (`patient_id`, `patient_name`, `age`, `dob`, `sex`, `mrn`, `hospital_number`, `diagnosis`, `presenting_complaint`, `clinical_summary`, `notes`, `refusal_note`, `free_text`, `comment`, `detail`, …).
3. **The free-text budget.** `app.referral` may carry **exactly one** `text` column, it must be named `ward_reply`, and it must be covered by a `char_length` CHECK at or below the fixture's N. Any second uncapped `text` column violates regardless of its name. This is the leg that stops `refusal_note` walking back in under a name nobody listed — which is how the last three controls in this repo were walked around.
4. **No later `ALTER TABLE app.referral ADD COLUMN`** in any forward migration. Straight lift from the audit-log guard, same explicit exit-code separation — 1 is a finding, anything else is fatal and loud, per the `scripts/lint_grep_exit_codes.sh` ban.
5. **The referrer is never a parameter.** No function signature in `database/migrations/` may declare a parameter whose name contains `referrer_facility_id` or `referrer_category`. **This is the leg that catches the trap the handoff names.** The undo will not arrive as a schema change; it will arrive as `log_referral_outcome(p_referrer_facility_id uuid, p_referrer_category app.ward_category, …)`, written by someone who needed the referring ward and had it to hand — the natural thing to do at the time, exactly as predicted. Leg 5 makes it a red test in the same commit rather than a review catch.

**PLANTS MUST ISOLATE THE LEG THEY TARGET — added 2026-09-10, and this is the difference between a five-leg guard and a one-leg guard wearing a five-leg label.**

All five legs accumulate; none short-circuits. So a plant that trips several still exits non-zero, and an assertion on the exit status proves only that *something* fired. **Leg 1 is set equality, which fires on almost any column change — so as originally specified it MASKED legs 2 and 3 completely.** Walking the original plant list:

| plant | targets | actually fires | isolated? |
|---|---|---|---|
| `referring_clinician_id uuid` | leg 2 | legs 1 **and** 2 | **no** |
| `patient_age integer` | leg 2 | legs 1 **and** 2 | **no** |
| `filed_by_name text` | leg 1 | legs 1 **and** 3 (a second `text` column) | **no** |
| `refusal_note text` uncapped | leg 3 | legs 1 **and** 3 | **no** |
| cap raised 240 → 1000 | leg 3 | leg 3 only | yes |
| removing `referrer_category` | leg 1 shrink | leg 1 only | yes |
| `014_plant.sql` with an `ALTER` | leg 4 | leg 4 only | yes |
| `CREATE FUNCTION` with `p_referrer_facility_id` | leg 5 | leg 5 only | yes |

**Delete leg 2's implementation entirely and every plant above still reds.** Same for leg 3's forbidden-second-`text` arm. The guard would look correct and would prove one leg.

**The rule, and it is the same fix the audit-log guard needed on 2026-09-10:** every plant satisfies all earlier legs so exactly one can fire, and asserts **that leg's own message** rather than the exit status. Concretely, a leg-2 plant adds the forbidden name to **both** the migration and the fixture's column list, so set equality passes and only the forbidden-name check can produce the failure; a leg-3 plant does the same for its second `text` column. Each assertion is `expect(res.stdout, …).toContain('<that leg's message>')`, which means **every leg needs a distinct static message** — a guard printing only a filename and a diff gives a test nothing to assert and a reader at 2am nothing to act on.

**Leg 5 is last and therefore the most masked**, and it is the one that catches the trap the handoff names. Its plant is already isolated by construction — a `CREATE FUNCTION` in a file with no `CREATE TABLE` cannot trip legs 1 through 4 — but it must still assert leg 5's message, or a future refactor that folds leg 5's condition into leg 4's would be invisible.

**Verify each plant by NEUTERING the leg it targets: only that plant may red.** A plant not verified that way is an assumption, not evidence. See `.claude/rules/test-conventions.md` §2 for the general form and the three shapes that make a leg unprovable.

Positive control: reordering `portal_viewed_at` and `arrived_at` must exit 0, or people learn to disable the guard rather than read it. Three anti-vacuity legs, all exiting 2 and all asserting their own message, since their statuses are identical: no `CREATE TABLE app.referral` in the corpus; fixture absent; fixture present but parsing to zero columns.

**Clause 5 classification: GUARD-AHEAD-OF-SUBJECT.** Legs 1–4 execute non-vacuously over the real migrations today. Leg 5 is non-vacuous only in the negative sense — the function it forbids does not exist yet, which is the point of writing it before Bundle 6 rather than after. Reclassify to LIVE as part of this stage, in the script header, in the same idiom as `lint_audit_log_columns.sh`.

**What it does NOT cover — in the header, not in a ticket.** The **contents** of `ward_reply`: a column-list guard is structurally blind to what a human types into a permitted column, and this is the largest residual risk on the table. The real controls are the 240-character cap (structural), the field label (behavioural, partial), and RPC-layer validation — which **does not exist, is not reliably buildable, and must not be described as a control**. The **re-identifiability of the tuple** (below); nothing mechanical catches it and nothing should try. A **new sibling table** — `app.referral_note`, `app.outcome_detail` — carrying what this one refuses would pass every leg; the generalisation is a checked-in inventory of tables in `app` with any new table failing the build until it has a column-list fixture, and that is Sprint 2, named here so the boundary is known rather than missed. The **client**: a form collecting a clinician's name and discarding it before the RPC leaves no trace, and that is acceptable, because the property being defended is what the database holds.

**Specialist input incorporated:** CLCO produced the whole of this section, and confirmed against `005` that the shipped `app.referral` **does** hold the ward-to-ward property on the axis the memo was watching — no `actor_id`, no clinician column, no facility-less party, `referral_not_self` present — while finding two leaks on an axis nobody was watching.

**Safety/quality notes — the identity decision was aimed at the wrong noun.** Every control in this repository protects the *user*. Bundle 6 introduces a third party — **the patient** — and nothing in the design, the memo or the guard set is pointed at them. Free text on a referral will not contain a clinician; it will contain a patient, and a patient in a transfer context is health data under NDPA s.30, requiring a basis this system has never claimed, from a data subject it has no relationship with and cannot notify. That is the highest-consequence category of data anywhere in the product, arriving through the one table with no column-list guard on it. Hence the cap and the guard, in this stage, before the table has rows.

**And a sentence that has to change in about six places.** The tuple itself is quasi-identifying: `(referrer_facility, MATERNITY, receiving_facility, NICU, portal_viewed_at, arrived_at)` singles out one transfer of one patient at one time, and anyone holding either hospital's admission records re-identifies that patient in a single join. NDPA's definition reaches indirect identification by reference to information obtainable by the controller **or by another person**, which is exactly this. It is not fatal and needs no redesign — the processing is minimal, structured, unpublished and defensible. But it means:

> **"We hold no personal data" becomes false the moment this table has rows, independently of `ward_reply`.**

The correct claim is scoped, and it is still a strong differentiator: **no natural person is identified in the operational record, no account belongs to an individual, and no individual is attributed to any published figure.** The unscoped version currently appears in the handoff, the memo and several schema comments. Fix it everywhere before a facility or a funder quotes it back.

**Blast radius.** The `ward_reply` cap is a tightening CHECK on a table with no production rows, so nothing existing violates it — but confirm the seed does not plant a longer reply before shipping the migration. The touch trigger changes `updated_at` from writer-supplied to server-stamped, which is what `003`'s `app.touch_updated_at()` already does for four other tables and is the shape `timestamps_are_timestamptz.test.ts` expects. Extending `lint_from_allowlist.sh` for the export prohibition touches the same file finding 6 fixes in Stage 0 — do that fix first or the header claim compounds. The referral guard's live twin queries `information_schema` and therefore needs the `db` project, not `compliance`; put the halves in their correct projects or the static half will silently become the only one that runs.

**Definition of done:** as Bundle 6 — plus the guard reds on all eight plants, passes its positive control and all three anti-vacuity legs; `ward_reply` rejects 241 characters at the database and shows a counter in the UI; `app.referral.updated_at` is server-stamped; a reference to `app.referral` in any client source reds `bundle-guards`; and the golden path logs an ACCEPTED outcome that appears in the audit log, closing the last ratchet step.

---

## Standing constraints — carried forward, do not rebuild

**The fundamental.**

> Everything must flow. The system must work end to end. Do not build pretty standalone pieces that do not connect.

And its operational form: **no user-facing feature merges that is not reachable from the golden path.** If a feature cannot be reached by a user walking the dashboard from the front, it is a standalone thing however well it is tested. The ratchet is what turns that from a principle into a gate.

**Read as written — it is about user-facing features, not about ratchet steps, and not about control loops.** A stage that moves the frontier by zero steps has not broken this rule, and the distinction is written down here once so it is not re-argued at the stage that needs it. Two worked examples, and they fail the naive reading for different reasons:

- **Stage 4 is a control loop.** Escalation, the outbox and the dispatcher *observe* the golden path rather than sitting on it. Nothing a referrer or a nurse walks through reaches them, and that is what they are for. They own no step in `packages/fixtures/golden-path-steps.json` and their evidence is Bundle 5's own definition of done, which is unusually strong.
- **Stage 2 is user-facing and fully reachable**, and still owns no step. The counter, the zero-reason chips, admin challenge and the optimistic UI all *widen* steps that already pass — they deepen the path rather than extending it. The frontier is a sensor for reach, not for depth, and a stage can do real work without moving it.

The rule that does bind both is the one above it: everything must flow. A feature no user can reach is still forbidden. A feature that makes an already-reachable step better is not.

**Any failure must be foundationally resolved.** Fix the root cause, not the symptom. Understand what a fix touches — other stages, shared modules, callers, tests, and work already shipped — before calling it done. Resolve it in the same pass rather than filing it. Every one of the nine findings above is scoped into a stage for this reason; none is a ticket.

**Three decisions that must not be re-derived.**

- **Ward-scoped throughout.** No individual accounts, no `actor_identity_map`, no `REFERRER` role, no identity-bearing column on `app.audit_log`, and **no `detail jsonb`** — a column-list guard is blind to `detail->>'ip'`, so keeping it would have made the guard vacuous against the exact attack it names. The `ward_account_scope_matches_role` CHECK in `003` has deliberately no arm permitting a facility-less account below `PLATFORM_ADMIN`; absence of the role plus absence of the arm is what makes the property structural.
- **The ward-to-ward outcome loop** (Stage 5). Named by the handoff as the single place the ward-identity decision gets undone by accident, and now guarded mechanically by leg 5.
- **`app.tri_state` for any future duty or status flag**, never a new type. `blood_status` is cut from Sprint 1 and, when it ships, must be `app.tri_state` so it inherits the duty-flag guards rather than escaping them — which is what a distinct type did last time.

**If a facility cannot supply a ward-level address.** If a pilot facility insists on individual nurse logins, **do not quietly add individual accounts.** Stop and re-open `decision-2026-09-08-ward-level-identity.md`. That is the single condition that would make the design unworkable, and it should be tested at facility #1 rather than discovered at facility #20.

**And the pattern the corrections section exists for.** Five instances this fortnight of *a mechanism present and not reaching*: the `grep` exit-2 fail-open guard, the `sed` plant that never planted, three phantom cross-file links, the `fingerprint` alert with no consumer, and now `refresh_lga_rollup()` with no caller. Finding 6's two false headers are the same family. When something claims to check a thing, the claim needs a probe — that is Clause 5, and it is the rule that has earned its keep.

---

## Open decisions needing your call

Four. None blocks the start of Stage 0.

**1. Gate 2's latency clause — restated, and you should see it.** Gate 2 says the tile reflects a ward update *"within 60 seconds with no page refresh"*. That was written against the Realtime design that A1 reversed; the snapshot architecture serves at `s-maxage=30, stale-while-revalidate=300` and cannot guarantee it. Stage 0 restates the assertion against a named cadence constant instead. **The reason this is your call rather than a logged default:** it changes a release gate you signed off, and if the product promise really is sub-minute, the architecture is the thing that has to change, not the gate. My read is that it should not — a bed count is not a live feed, and Realtime was reversed for measured reasons (free-tier refuses connections past 200 concurrent, and a dropped WebSocket looks open to JavaScript). Say if you disagree, because the answer changes Stage 1's generator cadence.

**2. The facility agreement's Clause X.** Drafted and delivered as `docs/facility-agreement-clause-x-access-addresses.md`. It closes Residue A, and it carries the COO's leaver-rotation line, so the ward-identity memo's two facility-agreement obligations are both in it. **It needs a Nigerian-qualified lawyer before it goes in front of a CMD** — eight specific questions are listed at the end of that document. Two are ripe now rather than later: whether a supplier's warranty plus an express no-verification acknowledgement keeps you outside controllership for an individual address supplied in breach, and what actually binds a Lagos State public tertiary hospital (CMD signature, HEFAMAA, a Ministry delegation) — because the answer determines whether `agreement_accepted_at` evidences anything at all.

**3. NDPC registration — the threshold question has never been asked.** Whether you are a *data controller of major importance* requiring registration turns on data-subject volume and sector, and health is a sector regulators look at first. It needs an answer before facility #20, not before facility #1. It is on no list anywhere; it is now on this one.

**4. A public privacy notice does not exist.** Bundle 4's first-run interstitial is a **terms** acceptance and is well designed as one; it is not a privacy notice and does not attempt to be. NDPA s.34 requires information at the point of collection, and the dashboard does process — an IP at the edge on every request, geolocation permission state, update-request events, the 24-month display-state log. The strongest facts here are all in your favour and none of them is stated anywhere a person can see: coordinates never leave the device, there is no account, no tracking pixel, no analytics. Half a day of writing. It is the first artefact a hospital's legal officer or an NDPC officer asks for, and its absence is the cheapest bad look in the product. **Whether it ships with Stage 3 or before the first facility goes live is your call**; that it must exist is not.

---

## Supporting docs

- `docs/facility-agreement-clause-x-access-addresses.md` — the role-address clause in operative language, what to build behind it (and what deliberately not to), and the lawyer handoff. **Founder-side, not Claude Code scope.**
- `Sprint Kickoffs/sprint-kickoff-bedspace-v1-2026-09-08.md` — still authoritative for what is *in* each bundle. This document sequences it; it does not replace it.
- `Sprint Kickoffs/decision-2026-09-08-ward-level-identity.md` — the ward-identity memo and the CTO's two conditions. Condition (2) is asserted for the first time in Stage 1.
- `docs/handoff-2026-09-10.md` — the ward-category audit, the two probes, and the appendix on the CI intermittent.
- `.claude/rules/code-pipeline.md` and `.claude/rules/test-conventions.md` — Clause 4, Clause 5, Standard O and the plant-then-assert contract. Every guard specified above is written against these.

No standalone staff-engineer plan or QA spec is produced. With the codebase now real, the specialist findings attach to concrete files and are folded into the stages above rather than into thin separate documents; the two worth generating once Stage 3 lands are a Playwright spec expanding Gates 2 and 3, and the `ARCHITECTURE.md` the repo needs anyway.
