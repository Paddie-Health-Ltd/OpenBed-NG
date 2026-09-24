# PR 3.4b-app C design report: the admin app, its allow-list entries and deploy, the golden-path operator step, and the founder's runbook steps

Date: 2026-09-24 | Prepared by: Claude Code, for Cowork | **A report only. Nothing is built. Nothing hosted was run.**

- **Base:** `main` at `3df27ca5406a5b1ec89287a2a4225a7b34e5a322`. That is #76 (PR B) merged, with parents `78f1e00` and `c054698`. The merge commit's tree is `c054698`'s.
- **Scope:** the kickoff's PR C and BP-2 to BP-5 and BP-11 to BP-14, as amended by:
  - -89 BQ-1 and BQ-2 (the address and Access);
  - -92 BT-3 (the `sb_secret_` shape at H6);
  - -93 BU-1 e (the frequency window in H3 and H6);
  - B as merged (-94 BV-2, -95 BW-1): `per-app.json`, `render_headers.mjs`, `contacts.json`, and the `security_headers` rule.
- **Record:** BX lands as -96 with this PR. The next provisional letter is BY.

_**Evidence convention.** **[read]** means read in the repository at the base above, with a file and line. **[unverified]** means nobody has observed it. **[proposed]** means it is my mechanism for a property Cowork rules, open to change. Every line number is at the base._

---

## 0. Premises that did not hold

These were found while reading for this report. Each changes something below.

1. **There is no facility-creation step in the runbook to supersede.** BP-13 says to supersede "the old step's `agreement_accepted_at` line, which is marked, not deleted". But `docs/runbook-supabase-project-creation.md` mentions `agreement_accepted_at` only in 021's pre-check (:1675-1677) **[read]**.
   - The line is in the 2026-09-22 kickoff (`Sprint Kickoffs/sprint-kickoff-bundle3-operator-path-2026-09-22.md:173`), and that kickoff already marks it superseded at :190 **[read]**.
   - -45 B says "There is no facility-creation step in any runbook" (record :2289) **[read]**.
   - **So C writes the step new.** There is nothing in the runbook to mark. The kickoff is committed unedited (method note 15), so it is not marked either. The new step cites :173 and :190 as what it replaces.
2. **BT-3 would have H6 test the `sb_secret_` shape "against hosted `generate_link`". Since A.2, the script never calls `generate_link`.** Its Auth calls are `POST/GET/PUT admin/users` (`scripts/provision_ward_account.mjs:253-288`) **[read]**.
   - A `generate_link` probe at H6 would **create an unconfirmed Auth user and open that address's email-frequency window**, which are the two things A.2 exists to avoid (-92 BT-2).
   - **Proposed:** H6 tests the exact header shape with a read that creates nothing, `GET /auth/v1/admin/users?per_page=1`, in two halves:
     - the real key with both headers must answer 200;
     - a deliberately wrong `sb_secret_` must answer 401.
   - A 401 or 403 on the real key is a STOP, never a retry with another shape (BT-3's rule, kept). See §8.5.
3. **The widened grant sweep has not run on hosted.**
   - No entry in the record records it as run, or records a result.
   - The runbook heading at :2246 has no result under it, although :2316 says to record one there.
   - The only hosted grant reading on record is 2026-09-13's `anon` × `SELECT` (record :2890; runbook :2240-2244) **[read]**.
   - The kickoff asked this report to say which (H6). **It has not run.**
4. **`frontier.json` does not list the eight unbuilt steps.** It names only `passing_through` (`stale-ward-payload-carries-duty-phone`) and `next_step_fails_with` (`tests/e2e/frontier.json:4-6`) **[read]**. The eight are whatever follows that cut in `packages/fixtures/golden-path-steps.json`'s order. See §7.
5. **022's one-operator index and the E2E harness can collide locally.**
   - `resetE2eCorpus` does not clear a `PLATFORM_ADMIN` (`tests/e2e/_harness.ts:80-93`) **[read]**.
   - Under `ward_account_one_active_operator` (022:73-75), an E2E operator left active would make the db tests' direct `insert … 'PLATFORM_ADMIN'` fail on a shared local database. The examples are `tests/db/platform_admin_session_live.test.ts:44-49` and `tests/db/operator_functions.test.ts:57`.
   - CI runs E2E on its own database (`_harness.ts:18`), so this is a local hazard. §7 closes it.
6. **`operator_edit_facility` is not safe to repeat.** There is no short-circuit for an identical repeat, and the trigger bumps `version` on every UPDATE. So replaying the same call with the same `p_expected_version` answers `VERSION_CONFLICT` (020:466-526, :501-502) **[read]**.
   - BP-4 groups it with the idempotent writes. It is not one of them.
   - §3 therefore never retries it automatically.
   - `operator_record_contact` does short-circuit an identical repeat before its version check (021:471-479) **[read]**.
7. **The contact has its own version.** `operator_record_contact`'s `p_expected_version` is `app.facility_contact.version`, which comes from `operator_get_contact` as `contact.version` and is bumped by its own trigger (021:199-221) **[read]**. It is not `facility.version`, and a first write must pass `NULL` (021:450) **[read]**.
8. **A 23514 is the ONLY signal for four facility fields.**
   - `operator_create_facility` and `operator_edit_facility` validate nothing themselves. A bad latitude, longitude, phone or blank name comes back as PostgREST's 23514, naming `facility_lat_in_nigeria`, `facility_lng_in_nigeria`, `facility_phone_is_e164` or `facility_name_not_blank` (003:116-121, 019:139) **[read]**.
   - The ward console maps every 23514 to one sentence and never reads the name (`apps/ward-console/src/main.ts:177-190`) **[read]**.
   - Admin must read the constraint name out of `message` (§4).
9. **`wardMessageFor` logs the raw response body** (`main.ts:178`) **[read]**. For the ward console that is harmless. **For admin it would break BP-5**, because a refusal body on a contact path can echo request values. Admin's mapper logs the status and the code only (§5).

---

## 1. Screens

One page, `apps/admin/src/main.ts`, with views switched in place. There is no router and no client storage (BP-3). **[proposed]**

**1.1 Signed out.**
- Heading "OpenBed operator".
- A single address field and "Send sign-in link".
- It calls `requestSignInLink` from `packages/auth`, which hard-codes `create_user: false` (`packages/auth/src/request.ts:69`) **[read]**, with `redirectTo` `${window.location.origin}/` (BP-11).
- The same words appear whatever the answer (200, 422, 429 or 500), exactly as the ward console does, because each status would disclose whether the address exists (`request.ts:13-24`) **[read]**.
- **Beneath it, the Access order (BQ-2 c):** "Open this page and pass the Cloudflare check before you ask for a link. Open the link on this same device and browser." That is worded as expected, and it stays **[unverified]** until §6.4's observation.

**1.2 Link failed.** "That link did not work", with the request form again. This is `sessionFromUrlFragment` throwing `MalformedTokenError` (`packages/auth/src/session.ts:199-223`) **[read]**.

**1.3 Stop screens.** They replace the register entirely, and are never a blank register (BP-11):
- `NOT_AN_OPERATOR`: "This sign-in is not the operator's. Ward staff use app.openbed.ng." This is a `WARD_STAFF` session on admin.
- `ACCOUNT_DEACTIVATED`: "This operator account is switched off."
- `NOT_AUTHENTICATED` or a 401: "Signed out", with the form. `SessionHolder.authedFetch` throws `SessionExpiredError` on a 401 (`packages/auth/src/holder.ts:142-161`) **[read]**.
- `SESSION_ID_IS_ACCOUNT_ID` (020:375-389) **[read]**: this can only mean a malformed token, so it gets the fixed "Signed out" sentence.

**1.4 Register.** This is `operator_register()`, which returns `{server_now, facilities:[…]}` (021:653-699) **[read]**. One card per facility, in the order the function returns (`ORDER BY f.name, f.id`). The app never re-sorts and never filters (AJ D8).
- **The checklist is derived from the row, never stored:**
  - created: always true for a returned row;
  - contact on record: `has_contact`;
  - agreement: `agreement_state` of `none`, `recorded` or `withdrawn`;
  - at least one category: `categories.length > 0`;
  - listed: `listed_at`, shown as **"Listed"** or **"Not listed"**, never "Paused".
- **Warnings:**
  - a listed facility with `has_contact` false shows **"No contact on record"** (BD-2 5);
  - a listed facility whose agreement is `withdrawn` shows that state, with the next step named: "Finish the withdrawal steps in the runbook", which is the founder SQL step (BN-4);
  - an inactive facility (`is_active` false) shows "Switched off".
- **Per ward** (a `categories[]` item: `category`, `offering`, `monitoring_state`, `bed_count`, `accepting`, `updated_at`, `has_account`, `provisioning_incomplete`) **[read, 021:677-693]**:
  - login: **"Active"** if `has_account`, **"Setup incomplete"** if `provisioning_incomplete`, else **"None"**;
  - offering and count, as the ward stated them;
  - **"Not yet reporting"** per ward when it has never published. The exact predicate (`monitoring_state` of `PENDING`, or `updated_at` null) is read from the enum at build time **[unverified]**.
- **Freshness:**
  - `freshnessBand(updated_at, server_now, elapsedSinceFetchMs)` (`packages/snapshot/src/freshness.ts:51-77`) **[read]**, with the elapsed time measured by `performance.now()` since the fetch, never `Date.now()`;
  - one band per ward, and the facility's worst band on the card;
  - **the band never filters, sorts or hides a row.**
- **Times** are Lagos absolute, whatever the device's zone (§3.5).
- A **"Reload"** button, plus a reload after every write.

**1.5 Facility detail.** Opened from a card.
- The facility's fields and its categories.
- The **contact**, fetched with `operator_get_contact` only when this view opens (021:586-625) **[read]**. It is held in this view's closure only, and dropped when the view closes (BP-3, BP-5).
- The **agreement** block: `accepted_on`, `version`, `signatory_role` and `withdrawn_on`.
- The actions below. Each one's disabled state and reason come from the same checklist.

**1.6 The forms** (§2 lists each call):
- **Create facility:** name, LGA, state, latitude, longitude, public phone.
  - The phone is normalised to E.164 with a **visible preview before submit**: `0803…`, `234803…` and `+234803…` all become `+234803…` (a pure `normaliseNgPhone`) **[proposed]**.
  - The database CHECK stays the backstop (003:121).
  - Fields are sent **exactly as typed** apart from that normalisation. `St. Nicholas' Hospital` and `Ọ̀dúnlá` go through untouched.
- **Edit facility:** the same fields, carrying the `version` loaded.
- **Add category:** a category plus an offering. The offering is required with no default, because 020:624 calls it "a clinical claim, stated or refused. Never defaulted" **[read]**.
- **Record contact:** full name, job title, email, mobile (with the same preview) and **"SMS opt-in"**.
  - Beside the box: *"Tick only if the contact has agreed to receive SMS from OpenBed. Keep the evidence with the agreement papers. The first opt-in time is kept."* (BP-5; 021:497 keeps the first timestamp **[read]**.)
- **Record agreement:** the accepted-on date, the version label and the signatory's role.
- **List facility:** one button. It is enabled only when the checklist reads contact, recorded agreement and a category. When it is disabled, the reason is shown. SQL refuses in any case (021:273-285) **[read]**.
  - **There is no unlist control**: v1 has no unlisting function (020:62-63), and unlisting stays a founder step (BC-6).
  - **There is no withdraw control**: withdrawal is never a function (BD-2 2, BN-4).

---

## 2. The call set (BP-2)

All eight are `public`, `SECURITY DEFINER` and `SET search_path = ''`, executable by `authenticated` only. `packages/fixtures/function-grants.json:24-31` already lists all eight as `["authenticated"]` **[read]**. Every call is `holder.authedFetch('rpc/<fn>', { method: 'POST', … })`. So each one is a literal call site for `proxy_allow_list.test.ts`'s parser (`:93-140`) **[read]**.

| # | Function | When the app calls it | Request body (all text unless noted) | Response | Safe to repeat |
|---|---|---|---|---|---|
| 1 | `operator_register()` | load, Reload, after every write | `{}` | `{server_now, facilities}` | read |
| 2 | `operator_get_contact(p_facility_id)` | detail view opens | `{p_facility_id}` | `{contact, agreement}`, each nullable | read; writes no audit row (021:606) |
| 3 | `operator_create_facility(p_id, p_name, p_lga, p_state, p_lat float8, p_lng float8, p_public_phone_e164)` | Create | the client's `p_id` + fields | `{facility_id, version, created}` | **yes**: the same id and fields give `created=false` (J2; 020:431-447) |
| 4 | `operator_edit_facility(p_facility_id, p_expected_version int, …same fields)` | Save edit | + `p_expected_version` = loaded `version` | `{facility_id, version}` | **NO** (§0 item 6) |
| 5 | `operator_add_category(p_facility_id, p_category, p_offering)` | Add category | | `{ward_status_id, version, created}` | **yes**, on identical input (020:642-655) |
| 6 | `operator_record_contact(p_facility_id, p_full_name, p_job_title, p_email, p_mobile_e164, p_sms_opt_in bool, p_expected_version int)` | Save contact | `p_expected_version` = `contact.version`, or `null` when there is none | `{facility_id, contact_version}` | **yes**, on identical input, checked before the version (021:471-479) |
| 7 | `operator_record_agreement(p_facility_id, p_accepted_on date, p_version, p_signatory_role)` | Record agreement | | `{facility_id, recorded}` | **yes**, on identical input (021:559-579) |
| 8 | `operator_set_facility_listed(p_facility_id, p_expected_version int)` | List | + the loaded facility `version` | `{facility_id, version, listed_at}` | **yes**: "already listed" returns before the version check (021:260-264) |

Every row is **[read]** from 020 and 021. The line numbers are in the SQL-surface notes for this report.

**The allow-list** (`supabase-proxy/allow-list.json`) **[proposed]**:
- Eight `forward` entries: `{ "method": "POST", "path": "/rest/v1/rpc/<fn>", "reason": "apps/admin: <what the operator is doing>" }`.
- Eight matching `OPTIONS` entries: `{ …, "preflight_for": "POST /rest/v1/rpc/<fn>" }`.
- This follows the existing shape (`:23`, `:28`) **[read]**.
- **Derived from the call sites (-58 A5):** they come from admin's eight `authedFetch` literals, which all go through `api.openbed.ng`.
- **No direct-origin exception is added.**

**Pinned lists in `tests/compliance/proxy_allow_list.test.ts`:**
- The call sites (:330-336) gain eight lines: `POST /rest/v1/rpc/<fn> @ apps/admin/src/<file>.ts`. `requestSignInLink` and `SessionHolder` add none, because their sites are attributed to `packages/auth` **[read]**.
- The read-back scripts (:346-353) gain `scripts/readback_admin.sh`.
- The probes (:356-365) gain admin's probes (§6.3).
- Also, BP-2 cites :333-339. The list is at :330-336, as B's report noted.

---

## 3. State and retry model (BP-4)

**3.1 No client storage.** No `localStorage`, `sessionStorage`, IndexedDB or cookie. The session lives in a `SessionHolder` and is never persisted, for the ward console's reasons (`apps/ward-console/src/main.ts:25-30`; `holder.ts:7-20`) **[read]**. Tokens are removed from the address bar with `history.replaceState`, as the console does (`main.ts:597-600`) **[read]**. **[proposed]**: a compliance test greps admin's source for those storage APIs and fails on any.

**3.2 Reads.** `operator_register` and `operator_get_contact` use `authedFetch`, with its 12 s timeout (`holder.ts:51`) **[read]**. A transport failure on a read is retried **once**, after 300–600 ms of jitter, which is `requestSignInLink`'s policy (`request.ts:57`, `:84`) **[read]**. Then the "could not reach" sentence and a Reload button.

**3.3 Writes. Never retried automatically, and never queued.** A button is disabled from click until its request settles. That is courtesy; the server's idempotency is the guarantee. What happens after a transport failure depends on the call:
- **Create (3):**
  - `p_id` is generated with `crypto.randomUUID()` **once, when the form opens**, and reused for every submit from that form.
  - After a dropped response, the operator presses Create again, sending the same id and fields. The answer `created=false` is shown as **"Created"**, not as an error (J2).
  - Changing a field after a failed submit keeps the id. The server then answers `IDEMPOTENCY_CONFLICT`, whose sentence says a facility with this form's id was already created with other details, and offers a reload.
- **Contact, category, agreement, list (5–8):** safe to repeat on identical input. The operator presses again. Before the repeat, the form reloads nothing, so the body is identical.
- **Edit facility (4):** not safe to repeat (§0 item 6).
  - After a transport failure, the app **reloads the facility and shows its current values** with: *"The connection dropped. This is what is saved now. Check it before editing again."*
  - It never re-sends.
- **`VERSION_CONFLICT`** (edit, contact, list): the sentence *"This facility changed since you opened it. It has been reloaded. Your changes were not saved."* The view reloads. **The operator's values are never re-submitted on top** (BP-4).

**3.4 After every successful write,** `operator_register` is re-read. A detail view that was open is re-read too, including the contact, if its view is open.

**3.5 Time.** `lagosTime` exists only inside the dashboard today (`apps/public-dashboard/src/age-view.ts:52-63`) **[read]**. **[proposed]:**
- move it into `@openbed/snapshot`, beside `freshnessBand`, which admin already needs;
- have the dashboard import it from there;
- give it one test that runs under `TZ=Asia/Hong_Kong` in a child process.

That avoids a second copy of a rule the two screens must agree on (test-conventions §7's shape). The dashboard's import change is in the blast radius (§10).

**3.6 The session.** `SessionHolder` refreshes on demand (`holder.ts:121`, `:164-187`) **[read]**. An expired session goes to 1.1, which is also what happens when the operator in Hong Kong returns hours later. There is no silent re-auth.

---

## 4. The refusal-code table (BP-4)

**4.1 The mapper, `adminMessageFor(status, body)`** **[proposed]**:
- It parses the PostgREST error JSON, and never logs the body (§5).
- The key is the leading `^[A-Z_]+` token of `message`. For `INVALID_ARGUMENT`, the key is the token plus PostgREST's `details` (the DETAIL, a parameter name). For 23514, it is the constraint name read from `message`'s `violates check constraint "<name>"`. For 23502, it is the column.
- Every key maps to a fixed sentence in a new `packages/labels` entry point, `@openbed/labels/admin` (`admin-labels.json`). This is the `./ward` pattern (`packages/labels/src/ward.ts:4-6`) **[read]**, so admin's words never reach the public bundle.
- An unknown key gives a fixed **"Not recognised"** sentence: *"The server refused this, for a reason this page does not recognise. Nothing was changed. Reload and try again."*
- Server text is never rendered.

**4.2 Coverage, held by test.** The ward console's `raisedCodes()` and `coverageViolations` (`tests/compliance/ward_console_render.test.ts:127-153`, `:277-289`) **[read]** are the model. Admin's test parses every `RAISE EXCEPTION '<CODE>'` in the latest definitions of the eight functions plus `app.assert_operator` and `app.operator_session`, and every CHECK constraint on the three tables they write. Both directions must match the label table:
- a code with no sentence reds;
- a sentence with no code reds.

**4.3 The table.** Every code is **[read]**, from 020, 021 and 011:63-66. P0001 is a business refusal and 42501 is an authorisation refusal. The sentences are **[proposed]**.

| Code (SQLSTATE) | Raised by | Operator sentence |
|---|---|---|
| `NOT_AUTHENTICATED` (42501) | all, via `assert_operator` | Signed out. Ask for a new link. |
| `NOT_AN_OPERATOR` (42501) | all | *stop screen 1.3* |
| `ACCOUNT_DEACTIVATED` (42501) | all | *stop screen 1.3* |
| `SESSION_ID_IS_ACCOUNT_ID` (42501) | 3–8 | Signed out. Ask for a new link. |
| `INVALID_ARGUMENT` + `p_id` / `p_facility_id` | 2–8 | This page sent a facility reference the server could not read. Reload. |
| `INVALID_ARGUMENT` + `p_category` | 5 | Choose a ward category from the list. |
| `INVALID_ARGUMENT` + `p_offering` | 5 | Say whether this ward offers the service. It is never assumed. |
| `INVALID_ARGUMENT` + `p_full_name` / `p_job_title` | 6 | The contact's name and job title are both needed. |
| `INVALID_ARGUMENT` + `p_accepted_on` | 7 | Enter the date the agreement was accepted. |
| `INVALID_ARGUMENT` + `p_signatory_role` | 7 | The signatory's role is too long (64 characters at most). |
| `NO_SUCH_FACILITY` (P0001) | 2, 4–8 | This facility no longer exists. Reload. |
| `IDEMPOTENCY_CONFLICT` | 3 | A facility was already created from this form with other details. Reload to see it. |
| `VERSION_CONFLICT` | 4, 6, 8 | This facility changed since you opened it. It has been reloaded, and your changes were not saved. |
| `FACILITY_INACTIVE` | 8 | This facility is switched off, so it cannot be listed. |
| `NO_FACILITY_CONTACT` | 8 | Record a contact before listing. |
| `AGREEMENT_NOT_RECORDED` | 8 | Record the agreement before listing. |
| `AGREEMENT_WITHDRAWN` | 8 | The agreement was withdrawn. A facility cannot be listed on a withdrawn agreement. |
| `NO_CATEGORY` | 8 | Add at least one ward category before listing. |
| `CATEGORY_EXISTS_WITH_OTHER_OFFERING` | 5 | This category already exists with a different offering. Change it from the ward's own record, not here. |
| `NO_CONTACT_CHANNEL` | 6 | Give an email address or a mobile number. |
| `MOBILE_NOT_E164` | 6 | That mobile number is not in international form (+234…). Check the preview. |
| `MOBILE_REQUIRES_SMS_OPT_IN` | 6 | A mobile number is kept only with SMS opt-in ticked. Tick it only if the contact agreed. |
| `AGREEMENT_VERSION_NOT_A_LABEL` | 7 | The agreement version must be a short label, such as `v1` or `2026-09`. |
| `AGREEMENT_DATE_IN_FUTURE` | 7 | The acceptance date cannot be after today in Lagos. |
| `AGREEMENT_ALREADY_RECORDED` | 7 | An agreement is already recorded for this facility. A new one needs the founder's withdrawal steps first. |
| 23514 `facility_lat_in_nigeria` | 3, 4 | Latitude must be between 4.0 and 14.0. Check latitude and longitude are not swapped. |
| 23514 `facility_lng_in_nigeria` | 3, 4 | Longitude must be between 2.5 and 15.0. Check latitude and longitude are not swapped. |
| 23514 `facility_phone_is_e164` | 3, 4 | The public phone is not in international form (+234…). Check the preview. |
| 23514 `facility_name_not_blank` | 3, 4 | The facility needs a name. |
| 23514 `facility_contact_*`, `facility_agreement_*` (6 names; 003:338-345, 021:166-171) | 6, 7 | One sentence each, from the names. Most are pre-empted by the codes above (021:435), and they stay as the backstop. |
| 23502 (a column) | 3, 4 | "<field> is needed", one per column. |
| PGRST202 | any | This operator function is not on the server yet. A migration has not been applied. (The prototype's message, BC-4.) |
| Worker refusal (`x-openbed-proxy: refused`) | any | The gateway does not allow this call yet. The Worker needs its redeploy (H5). |
| unknown | any | *the fixed "Not recognised" sentence* |

The Worker row matters. Until H5, every admin call through `api.openbed.ng` is refused by the Worker. That must read as a named cause, not as "Not recognised". `requestSignInLink` already maps a proxy refusal to `unreachable` (`request.ts:78-80`) **[read]**. Admin's RPC mapper reads the same header **[proposed]**.

---

## 5. CLCO (BP-5)

- **Nothing about a contact is ever logged.**
  - `adminMessageFor` logs `{status, code}` only. It never logs the body, the request values, or a `details` string on a contact path.
  - No `console.*` call anywhere in admin receives a contact object.
  - **Test [proposed]:** in jsdom, spy on every `console` method. Plant a contact whose email and mobile are unique markers. Drive the paths that touch a contact:
    - open the detail view;
    - a refused save for each contact-path code;
    - a transport failure;
    - a 500 whose body echoes the markers.
  - Assert that no recorded console argument, serialised, contains either marker.
  - The plant: a mapper that logs the body turns the test red.
- **The contact is held only while its view is open.** It is never on the register list; `operator_register` carries only `has_contact` (021:657-696) **[read]**. It is never in the DOM after the view closes. **Test:** close the view, then assert the markers are absent from `document.body.innerHTML`.
- **No third party.** There is no analytics, font, error reporter or external script.
  - This is held by B's guards: the fonts lint covers every app's output automatically (`scripts/lint_no_third_party_fonts.sh:31-47`) **[read]**;
  - and admin's `_headers`: `default-src 'self'`, and `connect-src` exactly `'self'` plus the two API origins (§6.1).
- **SMS opt-in** is recorded, never created by the app. The wording is in 1.6.
- **Contact erasure and withdrawal** are founder SQL steps (§8.3, §8.4). The app has no delete control and no withdraw control.

---

## 6. Deploy (BP-11, amended by BQ-2)

**6.1 `apps/admin`** has the ward console's shape: `index.html`, `package.json`, `tsconfig.json`, `vite.config.ts`, `wrangler.toml`, `public/_headers`, `public/robots.txt`, `src/main.ts` and `src/style.css`. **[proposed]**, with each requirement **[read]** from the test named:
- **`package.json` `build`** is `node ../../scripts/stamp_build.mjs ./public/version.json && vite build && node ../../scripts/render_headers.mjs --write dist/_headers`:
  - the stamp comes before `vite build` (`build_stamp.test.ts:117-131`);
  - the built `_headers` must equal the rendering (`security_headers.test.ts:142-148`).
- **`vite.config.ts`** has `envDir: false`, `envPrefix: ['OPENBED_NO_BUILD_ENV_']` and `minify: false` (`tracked_client_keys.test.ts:314-323`).
- **`wrangler.toml`** has `name = "openbed-admin"` and `pages_build_output_dir = "./dist"`. The name `dist` matters: `lint_no_service_role_in_bundle.sh` finds bundles by the path `*/dist/*`, not from `wrangler.toml` (`:103-106`) **[read]**. See §11 item 4.
- **`public/_headers`** is the ward console's file, word for word, with `connect-src 'self' @API_ORIGINS@`. `callsApi('admin')` is true because admin calls `apiOrigin(`, so the placeholder must appear once and neither origin as text (`security_headers.test.ts:51-56`, `:105-114`).
- **`public/robots.txt`** is `User-agent: *` and `Disallow: /` (`robots_txt_shipped.test.ts:48-64`).
- **`src/style.css`** is imported by `main.ts`, because `style-src 'self'` allows no inline style (the dashboard's pattern, `dashboard_identity_and_call.test.ts:208-215`). There is a 44 px minimum on every button, and a tap-target test modelled on :198-206.
- **Contacts:** admin shows no published address. Its bundle must not carry `support@` (`ward_support_contact.test.ts:87-89`), and no operator address exists anywhere in the tree (BQ-1; `contacts.test.ts`).

**6.2 What B's derivations require of a third app.** Each item below reds until it is supplied **[read]**:
- **`packages/fixtures/per-app.json`:**
  - `deployable_apps` gains `admin`;
  - `client_import_closure.admin` is `["auth", "labels", "origins", "snapshot"]`;
  - `deploy_targets.admin` is `{runbook: "docs/runbook-admin-deploy.md", readback: "scripts/readback_admin.sh"}`, and both must exist (`_per_app.ts:84-100`).
- **The root `typecheck`** gains `-p apps/admin/tsconfig.json` (`_per_app.ts:47-59`).
- **`.gitignore`** gains `apps/admin/public/version.json` (`_per_app.ts:73-82`).
- **`tests/compliance/no_phantom_paths.test.ts:117-119`:** three planned-artefact entries (`apps/admin`, `apps/admin/wrangler.toml`, `scripts/readback_admin.sh`) are **deleted**, because the anti-rot check (:350-355) reds once they exist.
- **`tracked_origins`:** admin imports `from '@openbed/origins'`, so its bundle must carry the origins marker and every origin (`:318-339`). That is expected: every environment is compiled in (`origins.json` "why_every_environment…").
- **`tracked_client_keys`:** no `import.meta.env` read in admin's closure (`:252-267`). Admin gains the "both publishable keys in the bundle" check that only the console has now (`:338-343`) **[proposed]**.
- **`tests/compliance/readback_scripts.test.ts`:** its `SCRIPTS` map (:40-47) and the scratch checkout's app list (:82) are hand-written. Both gain admin, plus a `describe` for `readback_admin.sh`. **[proposed]:** make :82's list derive from `deployableApps()`, which is B's pattern. That is one fewer list to remember.
- **`tests/compliance/runbook_ward_console_deploy.test.ts:55-60`** hard-codes `DEPLOY_RUNBOOKS`. Admin's runbook is added to it, so its pasted `read` fences are checked **[proposed]**.
- **Covered automatically:** the fonts lint, the service-role lint (because the directory is `dist`), `deploy_guards`, `eslint_duty_flag_negation`, `freshness_bands` and CI's `npm run build`.

**6.3 `scripts/readback_admin.sh`** **[proposed]**.
- **Usage:** `bash scripts/readback_admin.sh DEPLOYMENT-URL [ROOT]`.
- It sources `readback_common.sh`, like `readback_ward_console.sh`, and reuses its helpers (`rb_require_url`, `rb_head`, `rb_tracked_header admin …`, `site_probe`, `api_probe`, `rb_stamp`, `rb_matches`, `rb_expect*` and `rb_verdict`; `readback_common.sh:54-238`).
- **It probes BOTH hosts (BQ-2 a):** `https://admin.openbed.ng` and the given `*.openbed-admin.pages.dev` deployment URL. It also takes the production alias `openbed-admin.pages.dev`.
- **Step 1, the failing half, first. No Access token.** For each host, GET `/` and `/version.json` without the token.
  - PASS only on Access's own answer: a 302 whose `Location` is on `<team>.cloudflareaccess.com`, or a 403 from Access.
  - **STOP if `/version.json` parses as a stamp, or `/` carries the app shell (the `assets/index-*.js` reference). That means the page is served around Access.**
  - The exact Access answer is **[unverified]** until H6. So step 1 names the two forms and treats any 200 as STOP, never as PASS.
- **Step 2, with the token.** The service token is read only from the environment, as `OPENBED_ACCESS_CLIENT_ID` and `OPENBED_ACCESS_CLIENT_SECRET`, and sent as `CF-Access-Client-Id` and `CF-Access-Client-Secret`.
  - **Not as a curl argument.** A header on the command line is visible in the process table. The script writes the two headers to a mode-600 temporary file under its own trap-cleaned directory and passes `curl -H @file`. **[unverified]** whether that is supported by the pinned curl; the header-file form needs curl ≥ 7.55.
  - The values are never printed or echoed. A missing variable is `ERROR` with exit 2, never PASS (BQ-2 b).
  - Then the ward console's steps:
    - `/version.json`'s commit is HEAD and `dirty` is false;
    - `/` carries exactly the rendered tracked CSP, `Referrer-Policy` and `nosniff`;
    - exactly one bundle, and exactly one publishable key in it.
- **Step 3, the API.**
  - The live-key and dead-key halves on `GET /auth/v1/settings`, as the console does.
  - Plus one operator route through the Worker: `api_probe POST /rest/v1/rpc/operator_register` with the publishable key and no session. The Worker must forward it (`x-openbed-proxy: forwarded`) and PostgREST must refuse it, because `anon` has no EXECUTE. A Worker `refused` there means H5 has not landed. **[proposed]**; the allow-list's `runbook probe:` reason rule applies (`proxy_allow_list.test.ts:200-279`).
- **Legs:** any error exit of its own is registered in `leg-coverage.json` and reached by a test, and the nested-identity pin (BW-1 d) is re-read.

**6.4 The sign-in order behind Access (BQ-2 c). [unverified], and it cannot be observed without a hosted deploy.**
- It needs the admin Pages project, `admin.openbed.ng` and the Access application, all of which are H6.
- **I propose it is observed at H6, founder-side, with Cowork reading it:**
  1. with the Access session already held, request a link, open it, and confirm the register loads;
  2. in a fresh private window with no Access session, request a link (which needs Access passed first), then open the link in a second fresh window, and record whether the fragment survives the Access bounce.
- The admin runbook states the expected order ("pass Access first, then request the link") and marks it **[unverified] until H6's reading**. If the fragment survives both orders, the runbook says so, with the date.
- **This moves one item of the kickoff's definition of done** ("Admin deploys to a preview through the wrapper, and `readback_admin.sh` reads PASS against it") **to H6.** A preview needs the Pages project, which H6 creates. So PR C's merge cannot wait on it without a hosted step before the merge. **Open for Cowork (§11 item 1).**

**6.5 `docs/runbook-admin-deploy.md`**, in the ward-console runbook's shape (`docs/runbook-ward-console-deploy.md` §1-§4) **[read]**:
1. Deploy through the wrapper from `~/Desktop/OpenBed-NG-deploy`: `bash scripts/deploy_pages.sh --branch main admin`, with no change to the wrapper (`deploy_pages.sh:104-119`) **[read]**.
2. The read-back, with a pass table.
3. The two key halves.
4. The security headers, and the local browser walk.
5. **Access:**
   - what it does and **does not** do, since it does not protect the operator RPCs, which answer a JWT through `api.openbed.ng` or the direct origin (BQ-2);
   - both hosts;
   - the service token, from the environment only;
   - the sign-in order.
6. Every `psql` block carries step P's PATH line, `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"` (runbook :85) **[read]**. `runbook_psql_path.test.ts`'s corpus is checked to reach the new file **[unverified]**, and widened if it does not.

---

## 7. The golden path's operator step (BP-12)

**The mechanism.** A step is a `packages/fixtures/golden-path-steps.json` entry with an `id`, `description`, `gate2_clause` and a monotonic `owning_stage` (`ratchet.test.ts:89-118`), plus a `name('<id>')` test in `tests/e2e/golden-path.test.ts`. The ratchet holds the two to the same identity set (:157-165) and requires every step up to the cut to pass (:173-187) **[read]**.

**Placement [proposed].** Five new steps go **first** in the fixture, before `magic-link-minted`, all with `owning_stage` 0, so the order stays non-decreasing:
1. `operator-creates-facility`: `operator_create_facility`, then a repeat with the same id gives `created=false`.
2. `operator-records-contact-and-agreement`: `operator_record_contact` (first write, `p_expected_version` null), then `operator_record_agreement`.
3. `operator-adds-category`: `operator_add_category` (MATERNITY, then THEATRE, as the harness uses today).
4. `operator-lists-facility`: `operator_set_facility_listed`, then `listed_at` is set.
5. `operator-provisions-ward`: `scripts/provision_ward_account.mjs`, as today (`_harness.ts:260-276`), now on a facility the operator made.

Then the existing ward steps run unchanged.

**Why the frontier doesn't regress:**
- These steps sit before the cut and must pass, and they are what makes the later steps possible.
- `frontier.json`'s `passing_through` and `next_step_fails_with` don't move.
- The cut index rises by five. The ratchet computes it from the fixture, not from a count.

**What the harness changes [proposed]:**
- **ALPHA is no longer seeded with direct inserts.** `seedE2eCorpus` stops inserting ALPHA's `facility`, `facility_agreement` and `facility_contact` (`_harness.ts:100-122`); the operator steps create them. The comment at :113-122 already anticipates exactly this (-90 BR-4) **[read]**.
- **BETA stays seeded.** It is the cross-facility control and no operator step touches it.
- **ALPHA's facility id** becomes a harness constant used as `p_id`, so the steps and the later ward steps agree.
- **The operator session** is made through the script's `--role PLATFORM_ADMIN` path, with an `@e2e.invalid` address, then signed in by the harness's existing mint-and-verify path (`tests/setup/auth.ts:306-330`). That path is admin `generate_link`, a harness-only credential route already allowed by the E2E header; the ban there is on `admin/createUser` plus a minted session, and on a hand-signed JWT (`auth.ts:34-37`) **[read]**.
- **The collision in §0 item 5 is closed.** `resetE2eCorpus` deletes the E2E operator's `ward_account` and `invite` rows (matched by the `@e2e.invalid` auth email) before the run. A global teardown does the same after it. So no E2E operator is left active to collide with the db tests' direct insert under 022's index.
  - **The plant:** a teardown that leaves the operator active makes a db test's operator insert fail when run after E2E on one database. That is shown once, locally, and quoted.
- **The calls go through the app's own request builders.** The steps build their bodies with admin's exported `bodies.ts` functions, which the page uses too. So the golden path exercises the same argument shapes the page sends (test-conventions §7's single-source rule). **[proposed]**

---

## 8. The founder's runbook steps (BP-13)

All of these go into `docs/runbook-supabase-project-creation.md` as new sections, except §8.1's sign-in read-back, which cites the admin runbook. Every step has a stop condition and a read-back, and every `psql` fence starts with the PATH line. **Nothing is run until Cowork has read the text.** **[proposed]** text; the facts it rests on are cited.

**8.1 Operator bootstrap.**
- **Preconditions:** 022 applied on hosted, with its fences read. Its section says it must come before the bootstrap (runbook :1700-1702) **[read]**.
- `node scripts/provision_ward_account.mjs --role PLATFORM_ADMIN --email "<the operator's sign-in address>" --project-ref <ref>`, with `SUPABASE_SERVICE_ROLE_KEY` set in the shell and removed afterwards (runbook :145).
  - **The address is typed at run time.** It is written in no fence, no file and no record: BQ-1 (`provision_ward_account.mjs:132-133`) **[read]**. The fence shows the literal placeholder text.
- **The host check** refuses a pair that does not name `--project-ref`'s project (`:191`) **[read]**.
- **Pass:** `provisioned PLATFORM_ADMIN … (the operator)` and `auth user: created, confirmed`.
- **A re-run** prints `an operator account already exists: nothing was done, and no Auth call was made` (`:307-308`) **[read]**.
- **STOP** on any `REFUSED` line, and above all on `OPERATOR_ALREADY_EXISTS` (`:208`).
- **Read-back:**
  1. `select count(*) from app.ward_account where role='PLATFORM_ADMIN' and is_active` reads `1`;
  2. the operator passes Access and requests a link at `admin.openbed.ng`;
  3. the link is piped to `pbpaste | node scripts/readback_signin_link.mjs --mode admin --project-ref <ref>`, which must read `PASS … redirect_to is exactly https://admin.openbed.ng/` (`readback_signin_link.mjs:35`, `:41`, `:148`) **[read]**.
  4. Only then is the link opened, and the register loads, empty.

**8.2 Facility creation.** This is new, and cites the 2026-09-22 kickoff's :173 as the superseded line (§0 item 1).
1. **The -45 stop condition first:** step 4b must read CLOSED on every row. Today row 5 (the backup restore) is OPEN (:744) **[read]**, so this step STOPs at its first line until the drill is done.
2. Create the facility in admin.
3. Record the contact and the agreement.
4. Add the categories.
5. Provision each ward with the script (`--facility`, `--category`). A refusal names the missing gate.
6. List it in admin.
7. Read back `/beds.json`, where the facility appears within the regeneration interval, with `readback_pages.sh`.

**8.3 Agreement withdrawal**, exactly as -82 BJ-1 e restated by -86 BN-4 **[read]**:
1. Set `withdrawn_on` **by founder SQL**, never an operator function.
2. Deactivate the facility's ward accounts. A ward is refused on its next request, because `assert_member` checks `is_active` every call (011:96-111) **[read]**.
3. Clear `listed_at`.
4. Read back `/beds.json`.

The trigger empties the mirror rows in step 1's own transaction (record :3912-3913) **[read]**. The read-back confirms it.

**8.4 Contact erasure:**
1. Delete the facility's `app.facility_contact` row by founder SQL.
2. Read back that `operator_get_contact` returns `contact: null` with the agreement intact, and that the register shows "No contact on record" (BD-2 5).
3. Note the copies outside the database, such as mail correspondence, for the founder to handle.
4. Record the request date and the completion date.

**8.5 H3 and H6, as founder text.**
- **H3 (before admin's first hosted use):**
  - enter the Site URL and redirects exactly: runbook :2770-2816, already written **[read]**;
  - custom SMTP and its processor agreement;
  - **and, per BU-1 e, read once and record:** the hosted Auth rate limits and the email frequency window (`max_frequency`). Hosted values are **[unverified]**; locally it is 1 s.
  - The text tells the operator to wait out the frequency window after any sign-in request or H2 probe before asking again. Since A.2, no admin link is minted on the provisioning path.
- **H5 (after C merges, before H6's deploy):** redeploy the Worker through its wrapper (`scripts/deploy_worker.sh`, then `scripts/readback_worker.sh`) so the sixteen admin entries (eight forward and eight preflight) are live. The runbook doesn't mention H5 today **[read]**. C adds it, with Cowork running the probes, as the kickoff says.
- **H6, with its preconditions stated first and checked:**
  1. A.2 merged: **met**, `78f1e00`;
  2. 022 applied on hosted, with its six fences read: **not yet**;
  3. H2 done, sign-ups off and read back: **not yet**;
  4. H3 done;
  5. H5 done;
  6. PR C merged.

  **Then, in order:**
  1. Create the admin Pages project and `admin.openbed.ng`. Add the project's pages.dev hostnames to the Access application, and issue the service token (BQ-2).
  2. Deploy through the wrapper, and run `readback_admin.sh`.
  3. §6.4's sign-in-order observation.
  4. **BT-3, reshaped (§0 item 2):** `GET /auth/v1/admin/users?per_page=1` with `apikey` and `Authorization: Bearer` both carrying the `sb_secret_` key must answer 200. The same request with a deliberately wrong `sb_secret_…` must answer 401. **A 401 or 403 on the real key is a STOP, never a retry with another shape.**
  5. **The widened grant sweep, failing half first** (runbook :2246-2317): half 1 must return exactly `anon | facility | SELECT`; half 2 must return no rows and count 17 tables. It has **not** run on hosted (§0 item 3), and its result is recorded under its heading.
  6. The operator bootstrap (§8.1).

  **No facility or ward login on hosted until the -45 gate reads clear.**

---

## 9. The QA matrix (the kickoff's list), mapped to tests **[proposed]**

**How the tests are built.** Admin's request bodies and response parsing live in pure modules (`apps/admin/src/bodies.ts` and `parse.ts`). Two kinds of test use them:
- **jsdom** tests in `tests/compliance/admin_render.test.ts` stub `fetch` per path, on `ward_console_render.test.ts`'s `renderAt` pattern;
- a **live** test, `tests/db/admin_calls_live.test.ts`, runs the same builders against real PostgREST with a `PLATFORM_ADMIN` session, using `platform_admin_session_live.test.ts`'s pattern, and cleans up its operator.

| Property | Test |
|---|---|
| A stale ward is present and unhidden | jsdom: a register with a 13-hour-old ward renders its card. **Plant:** a filter on band reds it |
| The band is unchanged under a device clock ±6 h | jsdom: `Date` shifted ±6 h, with the same `server_now` and elapsed time, gives the same band per ward |
| Times are Lagos under `TZ=Asia/Hong_Kong` | the shared `lagosTime`, run in a child process with `TZ=Asia/Hong_Kong` |
| Create: a double click and a dropped response make one facility, shown created | jsdom: the button is disabled in flight; a stubbed network error, then a resubmit carrying the same `p_id`, shows "Created". Live: two calls with one id give one row, the second `created=false` |
| Edit: two tabs, the second gets `VERSION_CONFLICT`, reloads, never overwrites | live: two edits from one loaded version, the second refused, and the row holds the first's values. jsdom: the conflict sentence, a reload, and no second POST |
| Edit after a dropped response is not re-sent | jsdom: after a transport failure, exactly one POST, then a reload, then the "check it" sentence |
| An identical contact repeat is a no-op | live: the same body twice gives the same `contact_version` |
| `MOBILE_NOT_E164` and `MOBILE_REQUIRES_SMS_OPT_IN` sentences | jsdom, from the label table; live, the codes raised |
| Chaotic input stored exactly | live: `St. Nicholas' Hospital` and `Ọ̀dúnlá` round-trip byte for byte through create and then register |
| `0803…`, `234803…` and `+234803…` become E.164 with a preview | a unit test of `normaliseNgPhone`, plus jsdom showing the preview before submit. The most ordinary input is a positive control |
| Swapped latitude and longitude are refused with the constraint named | live: 23514 names `facility_lat_in_nigeria`. jsdom: the sentence names the swap |
| `WARD_STAFF` on admin gets the stop screen | live: a ward session's `operator_register` answers 403 `NOT_AN_OPERATOR`. jsdom: the stop screen, and no register |
| A deactivated operator gets `ACCOUNT_DEACTIVATED`'s sentence | live and jsdom |
| The contact never appears in any console call | jsdom: the §5 spy test, with its plant |
| Every raised code has a sentence, and every sentence a code | a compliance coverage test (§4.2), both directions |
| No client storage | a compliance scan of admin's source |
| The Worker refusal is named | jsdom: `x-openbed-proxy: refused` gives the H5 sentence |

---

## 10. Blast radius (BP-14 C)

- **C adds no SQL.** The D3 closed list is unchanged, `packages/fixtures/function-grants.json` is unchanged (it already lists the eight, :24-31), and no migration is added.
- **`packages/auth`** is shared and unchanged. The ward console's auth tests (`auth_session.test.ts`, and the sign-in legs in `ward_console_render.test.ts`) are re-run.
- **`packages/labels`** gains an `./admin` entry point. The public and ward tables are untouched, which is asserted by the existing label tests.
- **`@openbed/snapshot`** gains `lagosTime`, and the dashboard imports it. The dashboard's render tests and its time output are re-run and compared.
- **The allow-list coverage test** and its three pinned lists change (§2, §6.3).
- **Every per-app derivation now reaches three apps.** The scratch-app plant (`per_app_reach.test.ts`) is re-run and must still red every fence.
- **The E2E harness:** ALPHA moves onto the operator functions, the reset and teardown clear the E2E operator, and the ratchet and frontier are re-attested.
- **The Worker** needs H5 before admin works through `api.openbed.ng`.
- **`readback_scripts.test.ts`, `runbook_ward_console_deploy.test.ts`, `no_phantom_paths`** and the leg register, as §6.2 lists.
- **Unchanged:**
  - the ward console and its CSP;
  - `render_headers.mjs`, since admin uses it as-is;
  - `deploy_pages.sh`;
  - the provisioning script.

---

## 11. Open for Cowork

1. **The preview-deploy item in the definition of done (§6.4).** A preview needs the admin Pages project, which H6 creates, so it cannot happen before C's merge without a hosted step first. **Proposed:** move "admin deploys to a preview, and `readback_admin.sh` reads PASS" and BQ-2 c's sign-in-order observation into H6. C merges on local evidence: the suite, the E2E, and a local `wrangler pages dev` walk under the CSP. The runbook marks the order **[unverified] until H6**.
2. **BT-3's H6 probe reshaped (§0 item 2).** Use `GET admin/users?per_page=1` in two halves, not `generate_link`, because the latter now creates what A.2 removed.
3. **`lagosTime` moved into `@openbed/snapshot` (§3.5),** touching the dashboard's import. The alternative is a second copy in admin, which I recommend against.
4. **`lint_no_service_role_in_bundle.sh` finds bundles by the path `*/dist/*`,** not from each app's `wrangler.toml` (`:103-106`) **[read]**. Admin uses `dist`, so it is covered. But an app whose output directory is named otherwise would fall outside the scan silently, which is the gap B closed for the fonts lint.
   - **Proposed:** C derives this lint's corpus from `wrangler.toml` the same way, with a plant for an app that builds to `build/`.
   - It is a guard change in an app PR, so it is Cowork's call whether it goes here or as its own small PR.
5. **The edit-replay behaviour (§0 item 6, §3.3).** Edit is never retried. After a dropped response the app reloads and says so. The alternative is an idempotency key on `operator_edit_facility`, which is SQL and out of C's scope.
6. **The E2E operator (§7).** It is made by the script and signed in by the harness's mint-and-verify path, then removed at reset and teardown. That is harness-only and follows the existing E2E header's rules.
7. **Admin's CSP `connect-src`** is the same pair as the ward console's (`'self'`, `https://api.openbed.ng`, `http://127.0.0.1:54321`), rendered from `origins.json`. Adding a third app does not widen any app's CSP.

**What this report does not change:** no build, no SQL, nothing hosted. The operator address appears nowhere in it.
