# Sprint Kickoff: Bundle 3, the operator path to facility one

Date: 2026-09-22 | Prepared by: Cowork sprint-push
Reviewed inline by Cowork, not by separate persona agents, from the cto-persona, staff-engineer, clco-persona, platform-sre and qa-specialist perspectives.
Base: `main` at `0cfab92`. Holding branch `record-ae-placeholder-derivation` at `a8b28fe` (AE–AH plus the -56 A10 note). Migrations 001–018 are frozen.
Scope source: **R-2026-09-22-54 A**, **-55 B**, **-56 C**, and **-56 D**, which leaves the grant gaps to Cowork. **Nothing in this document is sourced from a handoff.**
Provisional ruling carried here: **R-PROVISIONAL-2026-09-22-AJ** (next letter after AH; I and O skipped). Claude Code numbers it when it lands. The founder's two scope answers (2026-09-22) are recorded in it as AJ F.

_Evidence convention for this document: **[read]** means Cowork read it in the repository on the founder's device, read-only, on 2026-09-22, at the branch head above. **[founder]** means the founder's reading, as recorded in -56. **[unverified]** means nobody has read it yet._

---

## Division of responsibilities

Claude Code implements, tests and ships the code in the four pull requests below, and proposes each mechanism. Cowork rules the properties (method note 5). Where this document names a mechanism, it illustrates a property and is not an instruction; say so when the two come apart. The founder gives every merge word, runs every hosted and dashboard step, and answered the two scope items under *Open decisions* on 2026-09-22.

**Read this before starting.** The two scope items that were the founder's to decide have been answered, and they are recorded in AJ F. Everything else is a logged judgment call with its reasoning. If you disagree with one, argue it openly rather than quietly doing something else.

---

## Why this bundle exists, in one paragraph

Today the only way to put a facility, a category or a ward login onto the hosted project is SQL and a script run with the service-role key. Nothing in the repository says what the ward console talks to in production (Finding D). Only one of the three deployable artefacts can be deployed through a guard. And the proxy that -55 kept still forwards every path to every Supabase service. Bundle 3 builds the operator's route to facility one — tracked origins, guarded and stamped deploys for every artefact, `admin.openbed.ng` v1, and the ward publish screen made safe — and it hardens what that route runs over. **Bundle 3 onboards no facility.** The first hosted `app.facility` or `app.ward_account` row stays behind the -45 gate. This bundle is what lets that gate be met.

---

## Sprint scope

**In** (with the source for each item):

| # | Item | Source |
|---|---|---|
| 1 | Tracked origins for every app, including server-side Functions | -54 A1, Finding D (`R-2026-09-19-21 D`) |
| 2 | A deploy guard and build stamp for every deployable artefact: public dashboard, ward console, admin, proxy | -54 A2, -55 B2, -56 A3 |
| 3 | `admin.openbed.ng` v1 | -54 A3 |
| 4 | The publish-screen fixes: B2 and `R-2026-09-20-30 D1` | -54 A4, -45 |
| 5 | Proxy hardening: allow-list read from the code, guard, stamp, probes, README | -55 B |
| 6 | A migration lint requiring every `public` table to ENABLE and FORCE RLS | -56 C |
| 7 | Close two of -56 D's three grant gaps: a positive control on the USAGE test, and the hosted grant check widened | -56 D, Cowork's call (AJ A) |
| 8 | Fix the build-stamp check that turns red after every commit | -54 A2 (it is the stamp item), AJ B |
| 9 | Cut over DNS and SSL for `app.` and `admin.`, and deploy the ward console through the wrapper (founder-side steps) | -56 A3, A4 |
| 10 | A3: the public dashboard's `(unknown facility)` beside a real count | Founder, 2026-09-22 (AJ F1) |
| 11 | The ward's own request for a new sign-in link | Founder, 2026-09-22 (AJ F2) |

**Carried by the first pull request (record-only, R-46):** the rebase of AE–AH and the A10 note; the supersession mark on the A1 kickoff's `### Bundle 3: The sensors`, pointing at -54 B and naming the sensor bundle as that section's home; this kickoff, committed to `Sprint Kickoffs/` (method note 15); the Cowork handoff `handoff-2026-09-22-infra-review-closed.md`, added to `docs/` exactly as the founder pastes it; the AJ ruling block and its ledger row. **In that PR's body, listed and not fixed:** the 2026-09-22 boundary handoff's "This file is not in the repo"; its "fixed by ruling Z" claim; and the top-level tracked-entry guard, still an open item (trigger: next stray path found in a commit).

**Out**, stated so they don't drift in:

- the sensor bundle (-54 B; after Bundle 3)
- -55 C, the host the magic-link emails point at (trigger: before facility one)
- -23 D2–D5 (open, before facility one, per -56 A9). **D5, availability, becomes more load-bearing with PR 3.3, and is still not answered here.**
- the -17-12 G cron check (due before the sensor bundle is scoped)
- the WAF rate-limit rule
- custom SMTP and its processor agreement (founder-side, but it gates this bundle's first hosted use; see *Hosted and founder-side steps*)

---

## R-PROVISIONAL-2026-09-22-AJ: Cowork's calls for this bundle

Record-only. Claude Code numbers it on landing and adds its ledger row in PR 3.1.

**A — Two of -56 D's three gaps go into Bundle 3; one does not.**

- **A1. The USAGE test gets its positive control.** `tests/db/rls_anon_reachability.test.ts`, *"anon holds no USAGE on the app schema at the grant level"* **[read]**, asserts `false` for `anon` and `authenticated` with nothing showing the same call can return `true`. So a misspelled privilege string would read as the boundary holding. The fix is a control in the same test: the identical `has_schema_privilege` call returns `true` for a role known to hold USAGE on `app`. Claude Code reads which role that is from the catalogue; it is not assumed here. The test name should also stop saying only `anon` when it checks both roles.
- **A2. The hosted grant check is widened** from `anon` × `SELECT` to `anon`, `authenticated` and `PUBLIC` × every privilege type × every table in `app`. It matches the local test *"no client role holds any grant on any table in app"* **[read]**, including that test's anti-vacuity pin on the 16 table names, and it has a failing half the founder runs in the same sitting (a role that does hold a grant returns rows). It is a runbook step, since nothing in the repository can reach the hosted catalogue. It is **run once when Bundle 3 lands**, because PR 3.4 adds the first authenticated-executable functions since 014.
- **A3. The third gap, the hosted exposed-schemas list, stays a hand reading.** That is by design, per test-conventions §4 and `config_drift.test.ts`'s header. It is not in scope.

**B — The build-stamp check is redesigned, not rebuilt around.** `tests/compliance/build_stamp.test.ts` asserts that `apps/public-dashboard/dist/version.json` names the checkout's HEAD **[read]**. That `dist` is built before a commit, so the test turns red after every commit made after a build. CI hides this because it builds before running the compliance suite **[read]**. **The defect is where the assertion lives, not how the check runs.** The property that matters is *the artefact being uploaded names the commit being deployed*, and that is true only at upload time. So:

- the **deploy wrapper** reads the freshly built stamp after its build step and **refuses to upload** unless the stamped commit equals the HEAD it verified and `dirty` is `false`. A planted stale stamp must make it refuse, by name.
- the **compliance test** stops reading a shared `dist`. It runs the stamp script into a scratch output and asserts the commit matches at that moment, keeping its refusal plants.
- one stamp mechanism covers every artefact (item 2), not one per app.

**C — The pull-request shape.** Bundle 3 ships as **four pull requests, in order**, not one. R-46 batches *record-only* work, and its D clause gives the reason: the overhead is waste *for a paragraph*. These are four changes with different risk and different reviewers. A migration adding operator write functions must not share a review with a wrapper refactor, and the clinical-screen fix must not wait behind the admin app. **All record-only material rides PR 3.1**, as R-46 requires.

**D — Admin architecture properties.** Claude Code proposes the mechanism against these properties.

- **D1. Identity comes from `auth.uid()` in the database, never from an argument and never from a Function.** Every operator action is authorised inside Postgres by a check that reads `auth.uid()`, joins `app.ward_account`, and requires `role = 'PLATFORM_ADMIN' AND is_active`. This is `app.assert_member()`'s rule ("it NEVER trusts a facility_id passed as an argument"), applied to operators. A Function that verified a token and passed a user id on would move the seam somewhere nothing tests it.
- **D2. The operator write functions are `SECURITY DEFINER` in `public`, granted `EXECUTE` to `authenticated` only,** with the operator check as their first statement. A ward session that calls one is refused by name. `ANON_EXECUTABLE_ALLOWLIST` stays empty **[read]**.
- **D3. The authenticated-executable set becomes a closed, named list.** Today the three-RPC test is a positive control only, and no test asserts that *nothing else* is authenticated-executable **[read]**. PR 3.4 adds that assertion, on identity rather than count (test-conventions §3), and lists the new functions in it.
- **D4. Ward-login provisioning is server-side, in an admin Pages Function holding the service-role key.** This is the pattern `apps/public-dashboard/functions/` already uses **[read]**, and it is the only place the GoTrue admin API can be called from. The Function **does not decide who the caller is.** It forwards the caller's bearer to an authenticated operator function, which answers from `auth.uid()` (D1), and it acts only on that function's success.
- **D5. The invite gate from -45 is built here, because this is the invite-issuing path.** No ward login is provisioned for a facility whose `app.facility_contact.agreement_accepted_at` is null. The refusal is enforced in the database function, not in the UI.
- **D6. `app.facility_contact` is not edited in admin v1.** It is the one named human in the system and holds personal data under contract (migration 003). Putting it in an operator form is a design task under the NDPA, not a v1 field. It is written by the facility-creation runbook step (PR 3.4 writes that step, a -45 owed item delivered here). Admin v1 **shows** whether a facility's agreement is recorded, and refuses provisioning while it isn't.
- **D7. Categories are add-only in v1.** A category is an `app.ward_status` row, `UNIQUE (facility_id, category)`, and `ward_status_event` references it `ON DELETE RESTRICT` **[read]**. There is no retired state, so a category cannot be removed without a schema decision. "Edit categories" in v1 means *add a category to a facility*. The ward's claims (offering, bed count, accepting) are never editable by an operator in v1; admin override is Bundle 4 territory (`source = 'ADMIN'` needs `admin_note`). **Open item, trigger: the first category added in error.**
- **D8. The operator's freshness list** shows every facility and every category, and **never uses freshness to filter, sort out, hide or suppress** a row. The operator is shown the stale rows. It computes bands with `packages/snapshot/src/freshness.ts`'s `freshnessBand` **[read]**, so there is one derivation site (test-conventions §7). It sits behind the operator check and reaches nothing public.
- **D9. The operator's sign-in address is a role address at `openbed.ng`, never a personal mailbox.** `PLATFORM_ADMIN` is a `ward_account` row, and the 2026-09-08 identity decision is that an account represents a ward or a facility, never a natural person. An operator account on a personal address would be the first person-account in the system. Nothing technical can check this (the provisioning script's header says so) **[read]**, so it goes in the runbook step that creates the operator.
- **D10. Every operator write leaves an `app.audit_log` row** in the same transaction, following `publish_ward_status`'s existing pattern **[read]**, with no actor identity column (there isn't one, by design).

**E — Server-side origins follow -55 A.** -55 A says `api.openbed.ng` "is the only database address every app uses". That includes Functions. So every browser *and* server-side call goes through it, and the allow-list (item 5) is read from **all** of it. **One consequence the founder must see before PR 3.1 merges:** if the public dashboard's Function currently uses the direct `*.supabase.co` origin **[unverified]**, moving it puts the Worker on the `/beds.json` read path for the first time. That is -23 D5's question, which is still open. Logged as a judgment call below. It is not a stop.

**F — The founder's scope answers, 2026-09-22, which bring two items into Bundle 3 under note 22.**

- **F1. A3 is IN, in PR 3.2.** The reason: Bundle 3 ships the tool that creates the first row the -45 gate governs, so every item on that gate belongs in the same bundle. Otherwise admin v1 lands and can't be used on hosted. It's the same hazard class as B2: a count or claim rendered as if it can be acted on.
- **F2. The ward's request for a new sign-in link is IN, in PR 3.2, as a form in the ward console.** Sessions are time-boxed at 24 hours (runbook §3), links are single-use (§9), and the console only says "Open the sign-in link sent to this ward's address" **[read]**. Nothing let a ward sign in again the next day. The founder chose the ward-side form over an operator "resend" because the ward-identity model rests on physical control of the handset, not on the operator.

---

## Bundles

### PR 3.1: Deploy and origin foundation, plus the record carrier

**Why bundled together:** everything else deploys through what this PR builds. Items 1, 2 and 8 are one mechanism: what a build talks to, and proof of which commit was uploaded. Item 6 and AJ A1 are guard-only changes with no runtime effect. They ride here, not on the admin PR, so the admin PR's review is about the admin app. Low clinical risk; all guards.

**Tasks:**

- [ ] **Record carrier.** Rebase AE–AH and A10 onto `main`. Add the AJ block and its ledger row, the A1 kickoff's supersession mark, this kickoff under `Sprint Kickoffs/`, and the Cowork handoff under `docs/` (founder pastes it). Add the PR-body list. **Stage named paths only, and quote `git diff --cached -M --name-status` against the claimed paths** (your standing control).
- [ ] **Tracked origins, every app.** Build configuration goes in a tracked file whose name is not `.env*` (`R-2026-09-19-21 D1`–`D3`), keyed by environment, carrying only public values. **A test asserts the built bundle of each app contains the production origin**; that is what closes Finding D. It covers the ward console and the public dashboard now, and the admin app when PR 3.4 adds it. It also covers server-side Functions: the origin a Function calls comes from the tracked file too, and only the secret stays in the Pages environment.
- [ ] **`lint_no_secrets.sh` is not widened.** `.env.production` stays refused (`-21 D1`). If the publishable key has to be tracked, give it a stated basis: it is shipped in every client bundle by design. Check it against `docs/runbook-key-rotation.md` so a rotation updates one tracked line, and confirm the runbook says so.
- [ ] **The bundle credential scanners cover every app's built output, proved with a plant per app** (`-21 D4`: *"to be confirmed explicitly, with a plant, in that change, not assumed"*). That means the ward console now and admin in PR 3.4. `lint_no_service_role_in_bundle.sh` globs `apps/*/dist` **[read]**. A glob is not a plant.
- [ ] **One deploy wrapper for every Pages app.** `scripts/deploy_pages.sh` deploys only `apps/public-dashboard` **[read]**. It takes the app as an argument, keeps every existing refusal, and gains the stamp readback from AJ B. **Every existing leg in `deploy_guards.test.ts` is kept.** Add a leg per app, plus a leg that an unknown app name is refused, not defaulted.
- [ ] **One build stamp for every Pages app**, served at `/version.json` by each. The ward console's build currently has no stamp step **[read]**.
- [ ] **AJ B:** move the stamp assertion into the wrapper and redesign `build_stamp.test.ts` so it no longer reads a shared `dist`.
- [ ] **-56 C: the public-table RLS lint**, with all four registration constraints exactly as -56 C states them. It must pass over frozen 001–018 as they stand. Failing half: a planted `public` table without ENABLE, and separately without FORCE, turns it red.
- [ ] **AJ A1:** the USAGE positive control, and the test name corrected.
- [ ] **AJ A2:** the widened hosted grant check, written as a runbook step with its failing half. It is run at landing (see *Hosted and founder-side steps*).

**Specialist input incorporated:** *platform-sre:* the stamp readback belongs at upload, not in the suite (AJ B); one wrapper, not one per app, so a fix lands once. *staff-engineer:* the wrapper's app argument is a new input to a guard, so an unrecognised value must be refused. *qa-specialist:* a plant per app for the credential scan, because a glob that matches is not proof it reaches.
**Safety/quality notes:** tracked origins change what production builds read. The public dashboard's production build must produce the same origin its current deploy uses, or E's consequence applies (see the logged item under *Open decisions*). The RLS lint's complement is `rls_enabled_everywhere.test.ts`; the lint's header names that.
**Blast radius:** the wrapper is used by `docs/runbook-cloudflare-pages-beds-json.md`'s deploy step and quoted in every deployment report. Restate the runbook's command in the same change (R-50's restate rule), so the report's third clause names the new invocation. `build_stamp.test.ts`'s refusal plants, and the `robots.txt` and gitignore legs, stay. The `.gitignore` stamp line covers only the public dashboard's `public/version.json` **[read]**, so each new stamped app needs its own ignore line, and a leg that the file stays untracked.
**Definition of done:** full suite green, with the prediction and attestation pair; every new guard shown red by its plant and green restored, both quoted; the wrapper deploys each of the two existing apps against the stub; `build_stamp` stays green across a commit made after a build (demonstrate it); PR body carries the list. **OWED to the founder after merge:** deploy the public dashboard through the new wrapper and quote `/version.json`.

### PR 3.2: Clinical-screen fixes (publish screen, A3, ward sign-in request)

**Why its own PR:** these are the changes in Bundle 3 that alter what a clinician or an ambulance crew sees. They need a review focused on that, not one diluted by the admin app. B2, D1 and the sign-in request are all on the ward console. A3 is on the public dashboard, but it's the same hazard class (a claim rendered as if actionable), and together they're the -45 gate's code items. They can land as soon as 3.1 does.

**Tasks:**

- [ ] **B2:** `wardRowFrom` **refuses** a malformed row. It never defaults `offering` (a clinical claim) or `version` (the concurrency token that becomes `p_expected_version`). The ruled shape is refusal (-44 E) **[read]**. `category ?? '(unnamed ward)'` gets the same treatment. A row with no category cannot be published for, and must not look like one that can.
- [ ] **D1:** the publish screen and the handover load **never show raw server text** to a ward user. Both `The server answered ${res.status}. ${text}` sites are covered **[read]**. Every recognised rejection code gets a fixed ward-facing message. Anything unrecognised gets one fixed message telling the ward to reload and, if it continues, to phone (no internals). The raw text may go to the console log, never to the screen.
- [ ] **A3 (AJ F1):** the public dashboard never renders a bed count beside `(unknown facility)` or any other placeholder identity. -44 E leaves two options open: suppress the row with a signal the operator can see, or render the gap in words pointing to 112/767. **Propose one with its reason, and the founder picks.** Cowork's lean, recorded: *a count with no callable identity must not render as if actionable.* Whichever is chosen, it also covers every other renderer in the same hazard class (method note 25).
- [ ] **Ward sign-in request (AJ F2):** the ward console's signed-out screen gets a form that requests a new link for the ward's address, with `create_user: false`, so an address GoTrue doesn't know is refused, never created. The screen tells the ward it was sent, without saying whether the address exists; the same message either way, so the form can't be used to find out which addresses exist. Both GoTrue's rate limit and the email rate limit surface as a fixed ward message. The path goes through the allow-list (PR 3.3's coverage test picks it up). Test it against the local stack's mail catcher, end to end: request, receive, consume, handover loads.
- [ ] **Keep what's already right:** 409 is not auto-retried, the mutation id is reused on a retry of the same attempt, and `null` renders as "not yet reporting".
- [ ] Tests: unit legs for each malformed-row shape being refused; a leg that an unrecognised server body never appears in rendered DOM (a plant containing a sentinel string); an A3 leg with a planted ward whose facility is missing from the payload, asserting no count renders as actionable; the sign-in request legs (a known address gets a link; an unknown one creates no `auth.users` row and shows the same message); golden-path steps still pass.

**Specialist input incorporated:** *clco lens:* the sign-in form must not become a way to find out which addresses exist, or a way to create accounts (`create_user: false`, the same message either way). *clinical lens:* a refused row must say so on screen, not vanish. A ward that sees fewer categories than it has will publish for the wrong one or not at all. *qa-specialist:* the "never render raw text" leg asserts on the rendered DOM, not on the function's return value.
**Safety/quality notes:** unreachable on hosted today (0 `ward_account` rows, -44 D **[founder]**), so there is no production urgency. Its reason to exist is the -45 gate. The sign-in form sends real email once custom SMTP exists (H3). Until then, the built-in sender's limit applies.
**Blast radius:** `renderHandover` and `publishFormFor` are the only consumers of `WardRow` **[read]**. `tests/e2e/golden-path.test.ts` drives this screen; confirm its steps still pass unchanged. A3 touches `apps/public-dashboard/src/main.ts`'s render path, so `dashboard_empty_state.test.ts` and the -44 example-data deletion still hold. The sign-in request adds one auth path to the allow-list.
**Definition of done:** plants red then green, quoted; golden path green; no string from a server body reaches the DOM in any tested path.

### PR 3.3: Proxy hardening (-55 B)

**Why its own PR:** a different artefact (a Worker), a different deploy path (`wrangler deploy`, not Pages), and a live production dependency. The allow-list is read from the code, so it goes after 3.1 has fixed where the code's origins live. It does not need the admin app to exist, because the coverage test makes 3.4 extend it.

**Tasks:**

- [ ] **Allow-list, read from the code.** The Worker forwards only the method-and-path prefixes the apps actually call, browser and server-side (AJ E). Everything else gets **404 from the Worker, without contacting Supabase**. Derive the list with a parser, not a regex (method note 17). A test asserts that every path any app calls is on the list, and that nothing on the list is called by nothing. So when PR 3.4 adds admin calls, this test turns red until the list is updated. Today's calls include `rest/v1/rpc/my_facility_wards`, `rpc/publish_ward_status`, `auth/v1/token?grant_type=refresh_token` and `rest/v1/snapshot_current` (from the Function) **[read]**. The full set is yours to derive, not this list's.
- [ ] **Stamp and guard for the Worker.** The same mechanism as 3.1, extended (-55 B2). The Worker answers its build commit on a path it serves itself, never forwarded. The deploy goes through a wrapper with 3.1's refusals.
- [ ] **Probes, each with a failing half** (-55 B3), written into the runbook with the exact pass signal:
  - no key → **401** with PostgREST's body (the -56 A1 finding: the body proves the Worker forwarded);
  - key → **200** on `/auth/v1/health`;
  - an off-list path → **404 whose body or header identifies the Worker**, and which is not a Supabase 404;
  - the deployed source equals the repo source (Cowork can read it through the Cloudflare connector).
  - Use `curl -I` for HEAD, never `-X HEAD`.
- [ ] **README:** mark the RECORD-NOT-DECISION banner superseded by -55 A; keep the old text.
- [ ] **Sign-up surface:** read `enable_signup` in `supabase/config.toml` (it is `true` in `[auth]` and in `[auth.email]` **[read]**). Report whether the allow-list should forward `auth/v1/signup` at all. The ward-identity design is invite-only and says *"there is no public self-registration route anywhere"*. See *Hosted and founder-side steps*, H2, for the hosted half. **Report, don't change `config.toml`** in this PR. Whether GoTrue's admin invite path still works with sign-ups disabled is a question to answer with a probe in PR 3.4, not an assumption.

**Specialist input incorporated:** *platform-sre:* the off-list probe's pass signal must tell the Worker's 404 apart from Supabase's, or a Worker that forwards everything passes it. That is note 24's question: can the observable take two values? *cto-persona:* the allow-list is a property of what is deployed, so the source-equality probe is what makes it evidence.
**Safety/quality notes:** a too-narrow list breaks the ward console in production. The coverage test is the guard against that, and the deploy happens after 3.1's tracked origins land. **-23 D5 (availability) is not answered by this PR, and this PR raises its stakes.** Say so in the PR body.
**Blast radius:** every browser call and, per AJ E, every server-side call. Before deploy, confirm the golden path runs against a local Worker with the list in place (`wrangler dev`), not only against the direct local API.
**Definition of done:** the coverage test is red for a planted unlisted call and red for a planted unused entry, then green; four probes written with their failing halves; README updated. **OWED to the founder:** deploy the Worker through its wrapper; Cowork reads the deployed source and runs the probes.

### PR 3.4: `admin.openbed.ng` v1

**Why bundled together:** the admin app, its Functions, migration 019 and the facility-creation runbook step are one feature. None of them works without the others, and they share one security property (AJ D1). This is the highest-risk PR in the bundle and the only one with a migration, so it goes last, on a base whose deploy path and origins are already settled.

**Tasks:**

- [ ] **Migration 019: the operator functions.** Following AJ D1–D3, D5, D7, D8 and D10, 019 adds functions in `public` for: create and edit a facility (`app.facility`; whether the matching `app.facility_ops` row is created at the same time is your call to state, since a missing row reads as ungated through 006's LEFT JOIN **[read]**, so it's a consistency choice, not a requirement); add a category; list facilities with each category's `updated_at` for the freshness list; and the invite-gated provisioning step. All are `SECURITY DEFINER` with `SET search_path = ''`, `EXECUTE` to `authenticated` only, and the operator check first. **019 is the first real migration after the frozen boundary.** Read how the AE placeholder leg behaves when a real `019_*` file exists; don't assume it. Down migration symmetric; round-trip test in the `migration_018_round_trip` idiom.
- [ ] **Provisioning Function (AJ D4).** It forwards the caller's bearer to the operator gate, calls the GoTrue admin API with the service key, and records `app.invite` and `app.ward_account` with `id = auth user id`. **A half-provisioned account (auth user exists, `ward_account` doesn't) must be retry-safe and must not look like a permissions bug**: the provisioning script's header names that exact failure **[read]**. Report the ordering and idempotency design before building it.
- [ ] **`scripts/provision_ward_account.mjs`:** gains a host check (its header says it has none **[read]**) and a `PLATFORM_ADMIN` path (no facility, no category, matching the scope CHECK) for bootstrapping the first operator. Its "A SCRIPT, NOT AN RPC" rationale rests on *"Sprint 1 ships no self-serve admin surface"*. That premise stops being true in this PR. Amend that sentence, marked as superseded (method note 8), and don't delete it.
- [ ] **The admin app** (`apps/` sibling, Pages project, `admin.openbed.ng`): operator sign-in by magic link using `packages/auth` (one derivation site for authentication, as the ward console's header argues **[read]**); request the link with `create_user: false`; no session persistence. Facility create/edit; category add; the freshness list (AJ D8); per-category provisioning (refused, and saying why, while the agreement isn't recorded). Tracked origin, stamp and wrapper from 3.1. Credential-scan plant. Allow-list extended through 3.3's coverage test.
- [ ] **Sign-ups-disabled probe:** with `enable_signup = false` locally, show whether the provisioning path still creates the user and sends or returns a working link. If it does, propose the `config.toml` change and its `config_drift` leg. If it doesn't, report what it needs. Either way, the result decides step H2 below.
- [ ] **Facility-creation runbook step** (owed since -45 B): creating the operator (a role address, AJ D9), creating a facility in admin, writing `app.facility_contact` with `agreement_accepted_at` by the step's SQL, adding categories, provisioning, and the -45 stop condition checked first. Every `psql` block carries step P's PATH line (-52).
- [ ] **Tests:** each operator function refused for `anon`, for a `WARD_STAFF` session, and for an inactive `PLATFORM_ADMIN`, and accepted for an active one; provisioning refused while the agreement is null, then accepted once it's set; the closed authenticated-executable list (AJ D3); a stale category present in the freshness list output (plant); audit row per write; cross-tenant: an operator write never touches another facility's rows by argument substitution.

**Specialist input incorporated:** *cto-persona:* identity in the database (D1), functions granted to `authenticated` and not the service key everywhere (D2), and one Function only where GoTrue's admin API forces it (D4). *clco-persona:* no personal data entry in v1 (D6), a role address for the operator (D9), and the invite gate at the database (D5). The magic-link sender is an unpapered processor until custom SMTP and its processor agreement exist, which gates hosted use (H3). *staff-engineer:* half-provisioning, retry and idempotency; the first unfrozen migration against the AE leg. *qa-specialist:* the refusal matrix above.
**Safety/quality notes:** using admin v1 against hosted **creates the first rows the -45 gate governs**. It must not be used on hosted until the gate's items are all discharged: B2 and D1 (PR 3.2), A3 (PR 3.2), the facility-creation step (this PR), and the invite gate (this PR).
**Blast radius:** `packages/auth` is shared with the ward console, so any change there re-runs the ward console's auth tests and golden path. `rpc_definer_safety.test.ts`'s grant-set assertion (D) covers named functions only **[read]**, so add the new ones. `rls_rpc_execute_allowlist` stays at an empty anon list. The snapshot and projection triggers fire on `facility` and `facility_ops` writes, so confirm a facility created through admin projects correctly and that a `quiet_mode` facility writes no public row (`projection_quiet_mode.test.ts`).
**Definition of done:** full suite green with the prediction and attestation pair; the refusal matrix quoted; the golden path extended with an operator step that creates a facility, adds a category and provisions a ward, locally; the runbook step written; admin deploys to its Pages project through the wrapper against the stub. **OWED to the founder:** hosted steps H3 and H6.

---

## Hosted and founder-side steps (founder runs; Cowork turns each into paste-ready commands when its turn comes)

- **H1. Read before PR 3.1 merges:** the Pages environment variable `SUPABASE_URL` on `openbed-public-dashboard` (the value is a URL, not a secret). This settles AJ E's consequence.
- **H2. Read now:** Supabase → Authentication → Sign In / Providers → **"Allow new users to sign up"**, on or off **[unverified]**. If it's on, the hosted project accepts self-registration for any address through either hostname, which contradicts the invite-only design and puts third-party addresses in `auth.users`. **Don't change it until PR 3.4's probe shows provisioning survives the change.**
- **H3. Before admin's first hosted use:** custom SMTP and the NDPA s.29 processor agreement, as one item (see the processor-obligations table in the decision record). Supabase's built-in sender returned 429 on the fourth request in one sitting (runbook §9), so it can't carry operator sign-in. Auth Site URL (still `localhost:3000`) and redirect URLs to include `https://app.openbed.ng` and `https://admin.openbed.ng`.
- **H4. After PR 3.1 and 3.2 merge:** create the ward console's custom domain `app.openbed.ng` in Pages. Deploy it through the wrapper. Quote `/version.json`. Cowork reads DNS over DoH and checks both halves: no record before, 200 after.
- **H5. After PR 3.3 merges:** deploy the Worker through its wrapper; Cowork runs the four probes and reads the deployed source.
- **H6. After PR 3.4 merges:** create the admin Pages project and the `admin.openbed.ng` custom domain, deploy through the wrapper, run the widened grant check (AJ A2) with its failing half, and bootstrap the first operator (a role address). **No facility or ward login gets created on hosted until the -45 gate reads clear.**
- **Optional hardening, your call:** Cloudflare Access in front of `admin.openbed.ng`, which adds a second factor on the operator surface. It's dashboard configuration, reversible, and free at this size **[unverified: check the plan]**. Not required by any ruling.

---

## Open decisions needing your call

**Answered by the founder on 2026-09-22 (AJ F):** A3 is IN, in PR 3.2. The ward's new-link request is IN, in PR 3.2, as a ward-console form.

**Still open, and yours to pick when Claude Code proposes it:** A3's fix shape (suppress with an operator signal, or render the gap in words).

**Logged, not a stop:** AJ E follows -55 A literally and routes server-side Functions through `api.openbed.ng`. If H1 shows the public dashboard's Function uses the direct origin today, PR 3.1 would put the Worker on the `/beds.json` path while D5 is unanswered. **The default is to follow -55 A.** Say so if you'd rather keep the public read path on the direct origin until D5 closes. That would be a narrow exception to -55 A, with its own line in the record.

---

## Fundamental: carries forward

> **Any failure must be foundationally resolved.** Fix the root cause, not the symptom. Before calling a fix done, understand everything it touches or could touch — other bundles, shared modules, downstream consumers — so the fix doesn't quietly create a new problem elsewhere. Resolve issues in the same pass, in place — don't file a ticket for something that can be fixed now.

The deliberate exceptions are the out-of-scope items above, each with its named trigger.

---

## Supporting docs

None separate. Every persona's input fits in its bundle's notes. A standalone staff-engineer plan for PR 3.4's provisioning ordering is worth writing once Claude Code has reported its design, not before.
