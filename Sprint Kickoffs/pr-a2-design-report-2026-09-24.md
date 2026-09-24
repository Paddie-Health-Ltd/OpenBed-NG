# PR A.2 design report: sign-ups off, done safely (R-PROVISIONAL-2026-09-24-BT BT-2)

**To:** Cowork. **From:** Claude Code, 2026-09-24. **Status:** design only. Nothing is built and nothing hosted was run.

**Base:** `main` = `abd6ee51a085e57d68e926776c4733a67315b675` (#74 merged; parents `faf984a`, `c199b07`, read from the API).

**Record:** BT lands as R-2026-09-24-92 with the next change that touches the record. That is this PR or B, whichever is first. Next provisional letter: **BU**.

**Evidence kind:** every Auth behaviour below was **observed on the local stack** (GoTrue `v2.196.0`, CLI 2.117.0) on 2026-09-24. The probes ran with `[auth] enable_signup = false` set locally and uncommitted. `supabase/config.toml` was restored afterwards and `git status` read clean. **None of it is a hosted reading.**

---

## 1. What the probes showed

All with `[auth] enable_signup = false` and `[auth.email] enable_signup = true`, so `disable_signup=true` and `external.email=true`.

| # | Call | Result |
|---|---|---|
| P1 | `POST admin/users {email, email_confirm:true}`, new address | HTTP 200, user id; `email_confirmed_at` set |
| P2 | the same, same address again | HTTP 422 `email_exists` |
| P3 | `generate_link` magiclink, existing confirmed user | HTTP 200, **the same id** as P1 |
| P4 | `GET admin/users?filter=<email>&per_page=5` | HTTP 200, one matching user |
| P5, isolated | `generate_link` magiclink, then the ward's own `/otp` at once | **HTTP 429 `over_email_send_rate_limit`**; 2 s later HTTP 200 (local window 1 s) |
| P6 | `generate_link` magiclink, new address (A's flow) | HTTP 200, **unconfirmed** user; its own `/otp` answers 422 `signup_disabled` |
| P7 | `PUT admin/users/{id} {email_confirm:true}` on that user | HTTP 200, now confirmed; its `/otp` answers 200 |
| P8 | the same PUT again | HTTP 200 (a repeat is harmless) |
| P9 | the test harness's route: `generate_link` on a new address, then `POST /verify` | HTTP 200 and a session; the user is confirmed by the verify |

Two facts from these decide the design.

**(i) `generate_link` magiclink opens the user's email-frequency window (P5).** A ward that asks for its own link inside that window gets 429. The console, correctly, tells it "a link is on its way" whatever the answer (`packages/auth/src/request.ts`), so the ward waits for mail that never comes.
- The local window is `max_frequency = "1s"` (`supabase/config.toml:285`).
- **The hosted value has not been read.** No figure is assumed here.
- So A.2 never calls `generate_link` on the provisioning path.

**(ii) A user made by `admin/users` with `email_confirm:true` opens no window.** A fresh confirmed user's `/otp` answered 200 immediately.

---

## 2. The call sequence

A.2 replaces A's single `generate_link` step. Nothing else in A's order changes: the argument check, the key check, the host check, `app.provision_begin`, and then `app.provision_complete`.

After begin returns `open`:

1. **`POST /auth/v1/admin/users {email, email_confirm: true}`.**
   - 200 gives the user id, then **complete**.
2. **On 422 `email_exists`:** `GET /auth/v1/admin/users?filter=<email>&per_page=50`, keeping only the user whose `email` equals the address, compared case-insensitively.
   - Exactly one match gives its id.
   - Zero matches, or more than one, is a loud failure: "setup incomplete". It is never a guess.
3. **If that user's `email_confirmed_at` is null** (an account from A's flow): `PUT /auth/v1/admin/users/{id} {email_confirm: true}`.
4. **`app.provision_complete(invite_id, user_id)`**, unchanged.

**Every Auth call keeps A's rule:**
- 12 s per attempt;
- at most 3 attempts, and only on a network error, a 5xx or a 429, with jittered backoff;
- a 4xx is never retried, **except 422 `email_exists`**, which is not an error but the branch into step 2;
- the headers are unchanged, `apikey` plus `Authorization: Bearer` (BT-3).

**`filter` is exercised by one probe (P4) and is not relied on for exactness.** The exact-email match is done by the script. If the pinned GoTrue ever treated `filter` as something other than a match on email, step 2 finds no user and fails loudly, never silently.

### Auth requests per path (J4 and the zero-Auth rule unchanged)

| Path | Auth requests |
|---|---|
| begin refuses (every gate code) | **0** |
| begin says `complete` (a ward's J4, and the operator's BR-1 b) | **0** |
| new address | **1**: create |
| address already confirmed (a re-run after F3; the address already exists) | **2**: create answers 422, then lookup |
| address from A's flow, unconfirmed | **3**: create answers 422, then lookup, then confirm |

---

## 3. Failure points: the change from A's table

| # | Where it fails | Left behind | Re-run |
|---|---|---|---|
| F2 | create fails (network, 5xx after retries, 4xx other than 422) | open invite; perhaps a confirmed user | create answers 422, lookup, complete |
| F2′ (new) | 422, then the lookup fails or matches no user | open invite, a user | same path; a persistent zero-match is a named STOP, never a guess |
| F2″ (new) | lookup found an unconfirmed user, and the confirm fails | open invite, an unconfirmed user | create answers 422, lookup, confirm, complete |
| F3 | complete fails after the user exists | open invite, a confirmed user | create answers 422, lookup (2 requests), complete |

Every "setup incomplete" message stays a single sentence, and none of these failures reads as a permissions bug.

---

## 4. Accounts made by A's flow (BT-2 c)

**Where they exist:**
- **Hosted: none.** Hosted holds no `app.ward_account` row (-45; step 4b's reading), and A's script has never run against it.
- **Locally:** they exist only where A's script ran. The E2E harness deletes its accounts and `auth.users` rows each run.

**What re-running provisioning does to one:**
- **Invite still open** (setup incomplete): the re-run goes create, 422, lookup, confirm, complete. It is confirmed, and its ward can sign in with sign-ups off.
- **Ward already complete:** begin says `complete`, so there are **zero Auth calls** (J4) and the account **stays unconfirmed**. With sign-ups off, that ward's own `/otp` would answer 422 `signup_disabled`. **J4 is not bent to fix this.**

**The protection is a read-back before H2** (§6): no account holder may be unconfirmed when sign-ups go off. H2 also waits on this change: any operator bootstrapped at H6 must be provisioned by A.2's script, never A's, or that operator is exactly this case. **So A.2 merges before H6's bootstrap.**

---

## 5. Config and its guard (BT-2 b)

- `supabase/config.toml`: `[auth] enable_signup = false`, and `[auth.email] enable_signup` **stays `true`**. False would disable email sign-in outright (422 `email_provider_disabled`, observed for PR A).
- `tests/db/config_drift.test.ts` gains one leg that pins both values. It uses its existing `tomlValue(content, table, key)` reader, which matches a section header exactly, so `[auth]` and `[auth.email]` are told apart (read at `config_drift.test.ts:46-60`).
- **Plants:**
  - `[auth] enable_signup = true` is rejected;
  - `[auth.email] enable_signup = false` is rejected;
  - a config where the two keys are swapped between sections is rejected.

---

## 6. PASS, and H2 (BT-2 c, d)

**PASS is BS-1 b's rule in full,** run on the local stack with the committed config:

1. The script provisions a never-seen address, with **1** Auth request counted.
2. An `auth.users` row exists, **confirmed**.
3. `provision_complete` returns `complete`.
4. The ward's own `requestSignInLink`-shaped `/otp` answers 200, its mailed link verifies to a session, and that session's `my_facility_wards` lists the ward.
5. `/otp` with `create_user:true` for a never-seen address answers 422 `signup_disabled`, and the `auth.users` count for it stays 0.

**Plus, reported:** an account made by A's flow, run through both of §4's cases.

**The build's own control runs the same harness** with the pre-A.2 config, and must show (4) passing and (5) failing, so a PASS cannot come from a broken harness. PR A needed exactly this control, and it found a harness bug.

**H2, a founder step after A.2 merges on a PASS**, with Cowork reading it back:

1. **Read-back first.** Run `select count(*) from app.ward_account w join auth.users u on u.id = w.id where w.is_active and u.email_confirmed_at is null`. It must read `0`; anything else stops the step.
2. Switch "Allow new users to sign up" **off**, and **only** that switch.
3. **Read-back after.** An anonymous request to `/auth/v1/settings` shows `disable_signup: true`, and `external.email: true`.
4. **The failing half.** `/otp` with `create_user:true` for a throwaway `@example.invalid` address answers 422 `signup_disabled` and creates no user. This is a read-only DB check; nothing is cleaned up because nothing is created.

**Until then sign-ups stay on.** That is BT-2's accepted interim risk: an address can create an Auth user, but with no `ward_account` it gets `NOT_A_MEMBER`.

---

## 7. Blast radius

- **`scripts/provision_ward_account.mjs`:** only the Auth step changes. The stub in `tests/db/provision_script.test.ts` gains the three routes: `POST admin/users`, `GET admin/users?filter`, `PUT admin/users/:id`. The zero-Auth matrix is re-asserted per path, with the counts in §2's table.
- **`tests/setup/auth.ts`**, the harness's `generate_link` then `verify` route: **unchanged**. P9 showed it still yields a session with sign-ups off, and the verify confirms the user.
- **The E2E:** provisioning moves to `admin/users`. Its later `mintMagicLink` on a now-confirmed user yields a `magiclink`-type token, which `verify` accepts (P3's type). The build proves this by running the golden path and the ratchet under the new config.
- **`leg-coverage.json`:** the script's legs are restated.
- **Unchanged:** `function-grants.json`, the D3 list and `applied-hosted.json`. There is no SQL in A.2.
- **The full suite runs under the committed sign-ups-off config,** on a fresh DB, with the Standard O attestation.

**Found in passing, and not A.2's to fix: the frequency window also applies to the tests' own `mintMagicLink`** (a `generate_link`). A test that mints a link and then requests `/otp` for the same user inside the window gets 429. No test does that today. The runbook's H3 and H6 text should tell the operator to wait out the window after any admin link. That is PR C's to write.

---

## 8. Open for Cowork

1. §2's lookup uses `GET admin/users?filter=` with an exact match done in the script, and **never** `generate_link`, because of fact (i). Confirm.
2. §4: A.2 merges before H6's bootstrap. Confirm the order A, A.2, then B and C, with H6 after A.2.
3. §6: the H2 read-back SQL and the failing half. Confirm the text before it goes into PR C's runbook, or into A.2's if you prefer it here.
