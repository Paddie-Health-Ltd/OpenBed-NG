# Sprint Kickoff: Bundle 3, PR 3.4b-app — `admin.openbed.ng` v1 and what it stands on

Date: 2026-09-24 | Prepared by: Cowork sprint-push
Reviewed by Cowork from the staff-engineer, qa-specialist, clco-persona and platform-sre perspectives, each loaded as its own skill. Code survey read-only at `main` = `faf984a`.
Base: `main` at `faf984a`. Hosted: migrations 001–021 applied, frozen at 21. No facility and no ward_account row on hosted. The -45 gate is NOT clear: no backup has ever been restored (-74 BB-4).
Scope source: -71 C, E, H and J4; -72 AZ-1, AZ-3 and its found-on-landing item; -73 BA-1 and BA-3; -75 BC-3, BC-4, BC-6 and BC-7; -76 BD-1 and BD-2; -78 BF-1 c; -79 BG-1; -81 BI-1; -82 BJ-1 e; -83 BK-1; -86 BN-2 and BN-4; the carry notes under PR 3.4 in `Sprint Kickoffs/sprint-kickoff-bundle3-operator-path-2026-09-22.md`.
Provisional ruling carried here: **R-PROVISIONAL-2026-09-24-BP**. BO lands as -87 with the first PR below. BP lands as -88 in the same PR.

_Evidence convention: **[read]** means Cowork read it in the repository at `faf984a` on 2026-09-24. **[unverified]** means nobody has read it yet. Every line number is at `faf984a`._

---

## Division of responsibilities

Claude Code implements, tests and ships the three pull requests below, and proposes each mechanism. Where this document names a mechanism, it illustrates a property. If the two come apart, say so, and argue a disagreement openly rather than quietly doing something else. Cowork rules the properties and reviews each PR against GitHub and the files before the founder's merge word. The founder gives every merge word, runs every hosted step from `~/Desktop/OpenBed-NG-deploy`, and holds the two open decisions at the end.

---

## Why this exists, in one paragraph

The founder needs to see and run onboarding before facility one: which facilities exist, which have a contact and an agreement, which are listed, and which wards have a working login. Today that takes SQL. -71 C settled the shape. The admin app does reads and the `operator_*` writes under the operator's own session. Provisioning stays in the script, over one SQL implementation of the gates. No Cloudflare Function holds the secret key. 020 and 021 built the SQL surface, and both are on hosted. What remains is the app, the script moved onto the gates, the guards a third app needs, and the founder's runbook steps. **This sprint onboards no facility.** Nothing here creates a hosted facility or ward_account row. That waits for the -45 gate.

---

## A finding that changes the order (staff-engineer)

**The only provisioning path bypasses the gates it is supposed to go through.** `scripts/provision_ward_account.mjs` never calls `app.provision_begin` or `app.provision_complete`. It calls GoTrue's `admin/generate_link` first (`:144-158`), then inserts an already-accepted `app.invite` and an `app.ward_account` directly, in one transaction (`:169-179`) **[read]**. So:

- none of 021's gates runs on the one path that creates logins: `NO_FACILITY_CONTACT`, `AGREEMENT_NOT_RECORDED` and `AGREEMENT_WITHDRAWN` (021:301-383);
- J4 is not met. A re-run on a complete ward calls `generate_link` again, which mints a new token and can invalidate a link the ward already asked for;
- runbook step 4b row 4 reads **CLOSED** for "no invite for a facility without a contact and a recorded agreement". The gate exists in SQL, but nothing on the provisioning path reaches it. **The row states a property the system does not hold.**

**Exposure today: none.** Hosted has no facility, and the -45 gate still holds on BB-4. **Root-cause fix:** the script goes through the gates (PR A). Step 4b row 4 is restated in the same PR to say where the property became true, with the test that holds it. Until PR A merges, that row overstates, and PR A's body says so.

---

## Sprint scope

**In:**

| # | Item | Source | PR |
|---|---|---|---|
| 1 | The provisioning script goes through `provision_begin`/`provision_complete`: zero Auth calls on a complete ward; a host check; a `PLATFORM_ADMIN` bootstrap | -71 C, J4; -72 AZ-3; -73 BA-3 | A |
| 2 | The two unverified Auth behaviours, tested against the script: `generate_link` with sign-ups off, and `sb_secret_` accepted as `apikey` alone | -71 C | A |
| 3 | The ward console's stop message for a session with no ward | -72 found-on-landing | A |
| 4 | The redirect read-back script | -73 BA-1; -72 AZ-1 | A |
| 5 | Step 4b row 4 restated with evidence | this document's finding | A |
| 6 | Every per-app list derived from one source, with a test that reds on an unreached app | -71 H | B |
| 7 | One tracked contacts file, read by every page and document that states an address, or tested against them | -75 BC-3 | B |
| 8 | A bundle guard against Google Fonts hosts, across all apps | -75 BC-6 | B |
| 9 | Security headers on every deployable app, derived like item 6 | platform-sre, this document | B |
| 10 | The admin app | -71 C, E; -75 BC-4, BC-6; -76 BD-1; -81 BI-1; -86 BN-2 | C |
| 11 | The Worker allow-list entries for the calls the admin app makes | -58 A5; -86 BN-2 | C |
| 12 | The admin deploy through the wrapper, a `readback_admin.sh`, and an admin deploy runbook | -54 A2 pattern | C |
| 13 | The golden path gains an operator step | PR 3.4's definition of done | C |
| 14 | Runbook steps: operator bootstrap, facility creation, agreement withdrawal, contact erasure, H3 and H6 text | -45 B (owed); -82 BJ-1 e; -86 BN-4; -76 BD-2 2 and 5 | C |

**Out, so they don't drift in:**

- **The privacy notice draft.** It is next, as a document for CLCO review, and reads item 7's contacts file.
- **The public-site and ward-console design pass.** It waits for Cowork's brief from the prototypes (-75 BC-7).
- **Unlisting from the app.** It stays a founder step (BC-6).
- **Withdrawal from the app.** It is never a function (-76 BD-2 2; -86 BN-4).
- **A facility-admin surface, invite lists, update requests, sorting, "who's on it", overrides and duty-flag gating** (BC-6, BC-7).
- **An audit row on reading a contact.** It stays open, and its trigger is a second `PLATFORM_ADMIN` (BD-2 1).
- **Moving provisioning into the app.** The default home would be a Supabase Edge Function, under its own design (-71 C).
- **The sensor bundle, -55 C, -23 D2–D5, and the backup restore drill.** The drill is the founder's (BB-4).

---

## R-PROVISIONAL-2026-09-24-BP — Cowork's calls for 3.4b-app

Record-only. Lands as -88 in PR A, with -87 (BO) and this kickoff committed unedited to `Sprint Kickoffs/` (method note 15). Next provisional letter: BQ.

**BP-1 — THREE PULL REQUESTS, IN ORDER A, B, C.**
- A changes the one path that creates logins, and must not share a review with a UI.
- B is guards and derivations the third app must land on, so C adds an app the derivation already reaches.
- C is the app and the runbook steps that describe it.

A and B touch disjoint files, so B may be built while A is in review. Merge order stays A, B, C. **Each PR's design report reaches Cowork before its build, and each PR's report before its merge.**

**BP-2 — THE ADMIN APP CALLS ALL EIGHT `operator_*` FUNCTIONS**, as -71 C rules ("reads and the operator_* writes under the operator's own session"):
- `operator_register`
- `operator_get_contact`
- `operator_create_facility`
- `operator_edit_facility`
- `operator_add_category`
- `operator_record_contact`
- `operator_record_agreement`
- `operator_set_facility_listed`

Each gets a `forward` entry, and each POST gets an `OPTIONS` `preflight_for` entry in `supabase-proxy/allow-list.json`, derived from the call sites as -58 A5 requires. The pinned list in `tests/compliance/proxy_allow_list.test.ts:333-339` is updated. **Cowork's 2026-09-24 handoff said "operator_register and the three writes". That count was Cowork's error and is superseded here.**

**BP-3 — WHAT THE APP SHOWS, derived from database facts only. Nothing is stored client-side.**
- **The register** (`operator_register`) lists every facility. The checklist is derived, never kept:
  - facility created;
  - contact on record (`has_contact`);
  - agreement (`agreement_state`: none, recorded or withdrawn);
  - at least one category;
  - listed.

  Show "Listed" or "Not listed" (`listed_at`), never "Paused". A listed facility with `has_contact` false shows "no contact on record" (BD-2 5). A listed facility whose agreement is withdrawn shows that state, with the founder's withdrawal step named as the way out.
- **Per ward:**
  - login: "active" (`has_account`), "setup incomplete" (`provisioning_incomplete`) or "none";
  - offering and count as the ward stated them;
  - "Not yet reporting" for a ward that has never published, per ward only.
- **Freshness** comes from `freshnessBand(updated_at, server_now, elapsedSinceFetchMs)` (`packages/snapshot/src/freshness.ts:51`). It is computed against the register's `server_now` and never the device clock. **It never filters, sorts or hides a row** (AJ D8).
- **Times** are Lagos absolute times whatever the device's zone. The operator is often in Hong Kong. The layout, wording, worst-ward facility band and PGRST202 message may follow the prototype (BC-4). **`platform-admin-src` is not copied in, and its sample data never enters a fixture.**
- **The contact** is read with `operator_get_contact` only when one facility's detail is opened. It is held only while that view is open, never kept in the register list, and **never logged** (see BP-5).

**BP-4 — EVERY WRITE IS SAFE TO REPEAT, AND A STALE EDIT IS NEVER SILENT.**
- **Create:** the client generates the facility id once, before the first attempt, and reuses it on every retry (020's J2). A retry after a dropped connection shows the created facility, not an error.
- **Edits** (`operator_edit_facility`, `operator_record_contact`) pass the version they loaded. A `VERSION_CONFLICT` says the facility changed since it was opened, and reloads. It never re-submits the operator's values on top.
- **Buttons** are disabled while their request is in flight. The server's idempotency is the guarantee; the button is courtesy.
- **Every refusal code** named in 020/021 maps to a fixed operator sentence, and an unknown one to a fixed "not recognised" sentence. That includes `NOT_AN_OPERATOR`, `ACCOUNT_DEACTIVATED`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `NO_CATEGORY`, `AGREEMENT_*`, `MOBILE_*`, `NO_CONTACT_CHANNEL` and a 23514 naming its constraint. Server text is never rendered raw, as in the ward console's `wardMessageFor`.

**BP-5 — CLCO: THE CONTACT IS A NAMED PERSON'S DATA.**
- **Never logged anywhere.** Not in the browser console, not in any error path. On a refusal, log the status and the refusal code only, never a response body from `operator_get_contact`, and never request values. A test plants a contact and asserts that no console call made on that path carries its email or mobile.
- **No third-party script, analytics, font or error reporter** in the admin app. Item 8's guard and item 9's `connect-src` hold this.
- **SMS opt-in** is recorded, never created. Beside the control, the app says the box is ticked only when the contact agreed to SMS, and that the evidence is kept with the agreement papers. `sms_opt_in_at` keeps the first moment.
- The audit trail records the NAMES of changed fields and never their values (021:505-509) **[read]**, so erasure stays possible (003's header). Keep it that way: a test asserts that no `facility_contact.record` audit row contains the planted contact's email or mobile.

**BP-6 — THE SCRIPT GOES THROUGH THE GATES (PR A).** The properties:
1. **Begin first.** `app.provision_begin` runs before any Auth admin call. `complete` exits 0 with zero Auth admin requests (J4; AZ-3). A refusal (`NO_FACILITY_CONTACT`, `AGREEMENT_NOT_RECORDED`, `AGREEMENT_WITHDRAWN`, `NO_SUCH_WARD` and so on) exits non-zero, names the code, and makes zero Auth calls.
2. **Then the link.** Only on `open` does it call `generate_link`, then `app.provision_complete(invite_id, user_id)`.
3. **Retry-safe from every point of failure.** If `complete` fails after the auth user exists, a re-run finds the same open invite and completes. It must not read as a permissions bug (the script's own header names that failure). Report the failure-point table: after begin, after `generate_link`, after complete.
4. **One implementation of the gates, in SQL.** The script inserts into no `app.*` table directly.
5. **A host check.** The script can write only to the project it is told to, and a run meant for local cannot reach hosted. Propose the mechanism. At minimum, the Auth URL and the database URL must name the same project, and a non-local target needs an explicit flag naming its project ref. Plants for both mismatches.
6. **`PLATFORM_ADMIN` bootstrap:** no facility and no category, through `provision_begin` with that role. The runbook step makes the address a role address (AJ D9; see Open decision 1).
7. **The premise sentence** "Sprint 1 ships no self-serve admin surface" (`:47-49`) becomes untrue with PR C. It is marked superseded (method note 8), not deleted.
8. **The two unverified Auth behaviours** (-71 C) are tested against the script on the local stack, with results quoted: `generate_link` with `enable_signup = false`, and a `sb_secret_`-shaped key as `apikey` alone. If the sign-ups-off result means a `config.toml` change, propose it with its `config_drift` leg. The hosted toggle (H2) is not changed until this reads.
9. **Blast radius:** `tests/e2e/_harness.ts:250-266` provisions two wards through the script, so the E2E facility now needs a contact and an agreement first. That comes through `operator_record_contact` and `operator_record_agreement` under an operator session, or through the seed where the harness needs no operator. Say which and why. `tests/compliance/provision_ward_account.test.ts` and `tests/db/provisioning_gates.test.ts:29`, which names this exact test as 3.4b's job, are updated.

**BP-7 — THE REDIRECT READ-BACK SCRIPT (PR A).** The founder gives it the sign-in link from the operator's email. It:
- decodes `redirect_to` and prints both forms;
- reads **STOP** unless the link's host is the project's own Auth host and `redirect_to` is exactly `https://admin.openbed.ng/` (or `https://app.openbed.ng/` in ward mode);
- reads STOP, never PASS, on a fallback to the Site URL (AZ-1);
- refuses anything that is not a link.

**The link is a live credential.** So:
- the script reads it from standard input, never from an argument, which would land in shell history;
- it never prints the token. It prints the link with the token redacted;
- it follows no link and makes no request.

Plants: a fallback link, a foreign host, a percent-encoded `redirect_to`, and a token that must not appear in the output.

**BP-8 — THE WARD CONSOLE'S ZERO-WARD SESSION (PR A).** Zero rows from `my_facility_wards` is never a legitimate ward: a `WARD_STAFF` account always has its ward. It is an operator's fallen-back session, or broken data. The console shows a stop message, not an empty handover. Wording to propose, with its words in `packages/labels`: this sign-in isn't linked to a ward, and an operator should use admin.openbed.ng. It must never render the handover list. Test with a real `PLATFORM_ADMIN` session (`tests/db/platform_admin_session_live.test.ts:62` already gets 200 and zero rows) **[read]**.

**BP-9 — ONE SOURCE FOR PER-APP LISTS (PR B).** -71 H says "seven" and names none. Cowork's survey at `faf984a` found **eight multi-app literal lists and four single-app hard-codes**, twelve sites in all:
- `package.json:23` (typecheck), where the root `tsconfig.json:26` excludes `apps`;
- `.gitignore:55-56`;
- `build_stamp.test.ts:87` and `:125-129`;
- `tracked_client_keys.test.ts:192-199`;
- `proxy_allow_list.test.ts:318-325`, `:333-339` and `:346-353`;
- `runbook_ward_console_deploy.test.ts:55-60`;
- `ward_support_contact.test.ts:82-83`;
- `eslint_duty_flag_negation.test.ts:50-51`;
- `scripts/stamp_build.mjs:58`;
- `package.json:25`;
- `freshness_bands.test.ts:202`.

`tests/compliance/_apps.ts:54-85` already derives deployable apps from `apps/*/wrangler.toml`. **Enumerate every site yourself; don't take this list.** Derive each from `_apps.ts`, or keep it as a deliberate literal. A deliberate literal says why and keeps a plant. The test must fail when an `apps/*` directory exists that a derivation does not reach: plant a scratch app. Report the final count against "seven".

**BP-10 — CONTACTS, FONTS, HEADERS (PR B).**
- **Contacts.** One tracked file holds `security@`, `hello@` and `support@openbed.ng` and their purposes. It extends or replaces `packages/origins/ward-support.json` (say which). `SECURITY.md`, every page that states an address, and later the privacy notice read it, or are tested against it. There is no `privacy@`, and a test fails on one anywhere outside the decision record.
- **Fonts.** A bundle guard across every deployable app fails on `fonts.googleapis.com` or `fonts.gstatic.com`, with a plant. None are present today **[read]**. The admin app uses the system font stack, which settles self-hosting for v1 by using none.
- **Headers.** Every deployable app ships a Pages `_headers`:
  - a CSP with `default-src 'self'`, `connect-src` limited to the app's tracked API origin, and `frame-ancestors 'none'`;
  - `Referrer-Policy: no-referrer`, since the ward console's URL fragment carries tokens at sign-in;
  - `X-Content-Type-Options: nosniff`.

  The set of apps is derived as in BP-9. Report what each app ships today. If the public dashboard's snapshot Function needs another `connect-src`, say so rather than widening every app.

**BP-11 — ADMIN DEPLOY (PR C), the same shape as the ward console.**
- `apps/admin/wrangler.toml`, with a stamp before `vite build`, a tracked `robots.txt` disallowing everything, and a vite config with `envDir: false`.
- Sign-in through `packages/auth`'s `requestSignInLink` with `create_user: false` and `redirectTo` `${origin}/`, with no session persistence (the ward console's reasons, `main.ts:25-30`).
- The origin from `@openbed/origins`.
- Deployed through `scripts/deploy_pages.sh`, with a new `scripts/readback_admin.sh` whose probes enter the allow-list's coverage.
- A new admin deploy runbook, with every `psql` block carrying step P's PATH line (-52).
- An admin session opened by a `WARD_STAFF` account shows a stop screen on `NOT_AN_OPERATOR`, never a blank register.

**BP-12 — THE GOLDEN PATH'S OPERATOR STEP (PR C).** Locally, through the same functions the app calls, it:
1. creates a facility;
2. records a contact and an agreement;
3. adds a category;
4. lists the facility;
5. provisions that ward through the script, which now goes through the gates;
6. then runs the existing ward steps.

Propose where it sits relative to the ratchet (`tests/e2e/frontier.json`) so the frontier doesn't regress.

**BP-13 — THE FOUNDER'S RUNBOOK STEPS (PR C)**, each with a stop condition and a read-back, and nothing run until Cowork has read the text:
- **Operator bootstrap:** the script's `PLATFORM_ADMIN` path, the host check, the role address (Open decision 1), then a sign-in through admin read back with BP-7's script.
- **Facility creation**, superseding the old step's `agreement_accepted_at` line, which is marked, not deleted:
  1. the -45 stop condition checked first;
  2. create in admin;
  3. record contact and agreement;
  4. add categories;
  5. provision wards with the script;
  6. list;
  7. read back `/beds.json`.
- **Agreement withdrawal**, exactly -82 BJ-1 e as restated by -86 BN-4:
  1. set `withdrawn_on` by founder SQL;
  2. deactivate the facility's ward accounts, which takes effect on the ward's next request, because `assert_member` checks `is_active` every call (011:99-105 **[read]**) and the console already says "switched off";
  3. clear `listed_at`;
  4. read back `/beds.json`.
- **Contact erasure:**
  1. delete the facility's `app.facility_contact` row by founder SQL;
  2. read back that `operator_get_contact` returns `contact: null` with the agreement intact, and that the register warns "no contact on record";
  3. note the copies outside the database, such as mail correspondence, for the founder to handle;
  4. record the request date and the completion date.
- **H3 and H6** as founder text: exact strings, sequence, and BP-7's read-back.

**BP-14 — BLAST RADIUS, STATED PER PR, AND CONFIRMED BEFORE THE MERGE WORD:**
- **A:** the E2E harness; the ward console's render tests and golden path; `provisioning_gates.test.ts`; step 4b; and the function-grants fixture, which A must not change.
- **B:** every test that held a literal app list; CI's `npm run build`; the ward console's and dashboard's deploy read-backs, now that headers ship (re-run both locally against a preview).
- **C:** the allow-list coverage test; `tracked_client_keys` closure; `packages/auth`, which is shared (re-run the ward console's auth tests); the D3 closed list, which C must not change, since C adds no SQL; the Worker, whose new entries need a Worker redeploy (H5 shape) before admin works through `api.openbed.ng`.

---

## Bundles

### PR A: provisioning through the gates, the zero-ward stop, and the redirect read-back

**Why bundled together:** every item sits on the sign-in and provisioning path, and each is useful before the app exists. A is what makes step 4b's invite gate true, and it has the highest integrity stakes, so it goes first and alone.
**Tasks:**
- [ ] Design report first: the script's call order, the failure-point table (BP-6 3), and the host-check mechanism (BP-6 5).
- [ ] The script through `provision_begin`/`provision_complete`, with no direct `app.*` inserts (BP-6 1-4).
- [ ] The host check with both plants, and the `PLATFORM_ADMIN` bootstrap (BP-6 5-6).
- [ ] The header's premise sentence marked superseded (BP-6 7).
- [ ] The two Auth behaviours tested and quoted (BP-6 8).
- [ ] The E2E harness moved onto the gates (BP-6 9).
- [ ] The redirect read-back script with its plants (BP-7).
- [ ] The ward console's zero-ward stop message, and its words in `packages/labels` (BP-8).
- [ ] Step 4b row 4 restated: "CLOSED by PR A", with the test names.
- [ ] Record: -87 (BO), -88 (BP), and this kickoff committed unedited.

**Specialist input incorporated:**
- *staff-engineer:* the bypass finding; J4 re-checked against the code; retry from every failure point; the host check. The link is a credential, so it goes through stdin, is never printed, and nothing is followed.
- *qa-specialist:* the zero-Auth-call assertion counts requests at a stub, not a log line. Each refusal code is asserted with zero Auth calls. The zero-ward stop is tested with a real `PLATFORM_ADMIN` session.

**Safety/quality notes:** the script is the only way a login is made. A regression here hands a login to a facility with no agreement, so every gate refusal is a test with the Auth stub asserting zero requests.
**Blast radius:** BP-14 A.
**Definition of done:**
- The full suite and attestation are green.
- The refusal and zero-Auth matrix is quoted.
- The two Auth results are quoted.
- The E2E is green through the gates.
- Step 4b row 4 cites the tests that now hold it.

### PR B: one source for per-app lists; contacts, fonts and headers

**Why bundled together:** each item is a repo-wide guard or derivation that a third app must land on. None touches the provisioning path or SQL.
**Tasks:**
- [ ] Enumerate and derive every per-app list, with the scratch-app plant (BP-9).
- [ ] The tracked contacts file and its tests, including no `privacy@` (BP-10).
- [ ] The Google Fonts bundle guard with its plant (BP-10).
- [ ] `_headers` for every deployable app, derived, with the current state reported first (BP-10).

**Specialist input incorporated:**
- *platform-sre:* headers per app, derived, not hand-listed. `Referrer-Policy` because of the token-carrying fragment. The deploy read-backs are re-run after headers land.
- *clco-persona:* one contacts file, so the privacy notice and the site cannot disagree about where a data request goes.

**Safety/quality notes:** a CSP that is too tight breaks a working app silently in the browser. Each app is loaded under its CSP in a real browser locally, and its read-back re-run, before the report.
**Blast radius:** BP-14 B.
**Definition of done:**
- The full suite and attestation are green.
- The scratch-app plant reds every derivation it should.
- The final list count is reported against "seven".
- Each app loads under its headers.

### PR C: the admin app, its allow-list entries and deploy, the golden-path operator step, and the founder's runbook steps

**Why bundled together:** the app, the calls it makes, its deploy and the steps that use it are one feature. None is usable alone. There is no SQL in this PR.
**Tasks:**
- [ ] Design report first: screens, the call set (BP-2), the state and retry model (BP-4), and the refusal-code table (BP-4).
- [ ] `apps/admin` per BP-3, BP-4, BP-5 and BP-11.
- [ ] Allow-list entries and preflights for the eight calls, with the pinned list updated (BP-2).
- [ ] `scripts/readback_admin.sh` and the admin deploy runbook (BP-11).
- [ ] The golden-path operator step (BP-12).
- [ ] The runbook steps (BP-13).

**Specialist input incorporated:**
- *qa-specialist* (the tests to build):
  - Register: a stale ward is present and unhidden (plant: a filter by band reds it). The band is unchanged under a device clock skewed ±6h, because it comes from `server_now`. Times are Lagos under `TZ=Asia/Hong_Kong`.
  - Create: a double click and a dropped response followed by a retry make one facility, and the UI shows it created.
  - Edit: two tabs editing the same facility; the second gets `VERSION_CONFLICT`, reloads and never overwrites.
  - Contact: identical repeat is a no-op. `MOBILE_NOT_E164` and `MOBILE_REQUIRES_SMS_OPT_IN` show their sentences.
  - Chaotic input is stored exactly as entered: a name with an apostrophe, a hyphen and a diacritic, such as `St. Nicholas' Hospital` and `Ọ̀dúnlá`.
  - Phones `0803…`, `234803…` and `+234803…` are normalised to E.164 with a visible preview before submit. The database CHECK (003:121) stays the backstop.
  - Swapped lat/lng is refused by 003:116-117 with its constraint named in the sentence.
  - Sessions: a `WARD_STAFF` session on admin gives the stop screen. A deactivated operator gives `ACCOUNT_DEACTIVATED`'s sentence.
  - The contact never appears in any console call (BP-5).
- *clco-persona:* BP-5, the erasure step, and the SMS opt-in wording.
- *platform-sre:* deploy parity with the ward console, the Worker redeploy ordering (H5 shape before H6), and `readback_admin.sh`.

**Safety/quality notes:** the admin writes reach the public page once a facility is listed. Listing is refused in SQL until contact, agreement and a category exist (021:232-299), and the app shows why, per the checklist. Nothing in C reaches hosted until H3 and H6, and no facility is created until the -45 gate clears.
**Blast radius:** BP-14 C.
**Definition of done:**
- The full suite and attestation are green.
- The QA matrix above is quoted.
- The golden path is green with its operator step.
- Admin deploys to a preview through the wrapper, and `readback_admin.sh` reads PASS against it.
- The runbook steps are written, and the founder runs nothing yet.

---

## Hosted and founder-side steps (the founder runs them; Cowork turns each into paste-ready commands when its turn comes)

- **H2. After PR A:** read "Allow new users to sign up". Change it only if BP-6 8 shows provisioning survives the change.
- **H3. Before admin's first hosted use:** Site URL `https://app.openbed.ng`; redirects `https://app.openbed.ng/` and `https://admin.openbed.ng/`, exact; custom SMTP and its NDPA processor agreement.
- **H5-shape. After PR C:** redeploy the Worker through its wrapper so the eight admin entries are live. Cowork runs the probes.
- **H6. After PR C and H3:**
  - Create the admin Pages project and `admin.openbed.ng`, and deploy through the wrapper.
  - Run `readback_admin.sh`.
  - Run the widened grant sweep with its failing half: runbook section "The WIDENED grant sweep — run once when Bundle 3 lands" (AJ A2) **[read]**. Claude Code states in PR C's report whether the record shows it has already run on hosted.
  - Bootstrap the operator with the script (BP-13), and read back the sign-in with BP-7.
  - **No facility or ward login on hosted until the -45 gate reads clear.**
- **The backup restore drill (BB-4)** is the founder's, and the one item holding the -45 gate.

---

## Open decisions needing your call

1. **The operator's sign-in address (needed at H6).** It must be a role address at `openbed.ng` (AJ D9). The record fixes exactly three published addresses: security@, hello@ and support@. **Cowork's default is a fourth, unpublished, sign-in-only address.** That keeps the one credential that can list a facility out of the shared general inbox, and off every public page where it could be phished or enumerated. The rule of three is about published contacts. The alternative is using hello@, which keeps three addresses, but anyone with access to hello@ can then sign in as the operator. Your call. Nothing before H6 depends on it.
2. **Cloudflare Access in front of `admin.openbed.ng` (optional).** It adds a second factor before the page loads. It does **not** protect the API: the RPCs are reachable with a JWT through `api.openbed.ng` or the direct origin. The real factor stays the operator's mailbox. It is reversible and dashboard-only. It isn't required by any ruling, and the default is off.

Everything else is a logged call above, with its reasoning.

---

## Fundamental: carries forward

> **Any failure must be foundationally resolved.** Fix the root cause, not the symptom. Before calling a fix done, understand everything it touches or could touch — other bundles, shared modules, downstream consumers — so the fix doesn't quietly create a new problem elsewhere. Resolve issues in the same pass, in place — don't file a ticket for something that can be fixed now.

The deliberate exceptions are the out-of-scope items above, each with its trigger or its owner.

---

## Supporting docs

None separate. Each specialist's input fits in its PR's notes. A standalone QA plan for PR C is worth writing once its design report names the screens, not before.

## LAWYER HANDOFF (CLCO, for the founder's Nigerian counsel; not blocking any PR)

1. **Erasure timing.** Under the NDPA 2023's right to erasure, what is the response deadline for a business-contact erasure request, and does keeping the contact's name in the signed agreement papers (outside the database) fall within an exemption?
2. **Withdrawal retention.** After a facility withdraws its data-sharing agreement, what retention period applies to that facility's historical ward-status events (append-only, 010), and on what basis may they be kept?
3. **SMS opt-in evidence.** Is a recorded opt-in timestamp, with the written agreement held on paper, adequate evidence of consent for SMS to a facility's business contact, or is a separate signed consent needed?
