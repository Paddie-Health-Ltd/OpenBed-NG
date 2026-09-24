# PR A design report: 3.4b-app, amended for BQ and BR

To: Cowork. From: Claude Code, 2026-09-24. **Design only. Nothing built, nothing committed, nothing run on hosted.**
Amended for R-PROVISIONAL-2026-09-24-BQ (the founder's two answers) and -BR (Cowork's ruling on the first version of this report). After BR-5's copy, the build waits for Cowork's build word.

## Context

Cowork's 3.4b-app kickoff (R-PROVISIONAL-2026-09-24-BP) splits the work into three PRs, merged A, B, C (BP-1). **PR A** does five things:
- routes the provisioning script through the SQL gates;
- adds **migration 022** (BR-1);
- adds a host check;
- adds the ward console's stop for a session with no ward;
- adds the redirect read-back script.

**What changed in this version:**
- §2 and §2a now carry BR-1's 022 design.
- The script's own read-back step is removed, because BR-1 refuses any second implementation of a gate outside SQL.
- §4 carries BQ-1.
- §8 states the exact `enable_signup` rule text that BR-3 asks for.
- §9 adds BR-1 e's tests.
- The record list gains -89 and -90.

**Kickoff integrity.** `~/cowork-handoff/sprint-kickoff-bundle3-3.4b-app-2026-09-24.md` reads sha256 `cdde3c78c76a05986655debf242d72a23c577bcb23f98f79123556a21ab09f56` and 31132 bytes, both matching. Base: `main` = `faf984a6a1dfda94be6ab02af8ba4084d667f33d`.

**Record, carried by PR A.** The decision file's last ruling is -86 (`:4089`). PR A adds:
- -87 (BO);
- -88 (BP);
- -89 (BQ);
- -90 (BR);
- the kickoff, copied unedited into `Sprint Kickoffs/`, with its sha256 re-read after the copy.

**Proposed:** this report is also committed unedited beside the kickoff, as the design of record (method note 15). Next provisional letter: **BS**.

**BR's premises, checked before acting (standing rule):**
- -82's text says "021:313-322" (decision file `:3932`), and so does BJ's ledger row (`:4205`). Both hold as BR says.
- The one-open-invite index is partial on `accepted_at IS NULL` (020:332-334). Holds.
- `provision_complete` never reads `is_active` (020:863-876). Holds.
- 003's `ward_account_deactivated_consistently` CHECK exists (003:234-236). It requires `is_active` ⇔ `deactivated_at IS NULL`. Holds.
- Audit actions are constrained by a verb **regex**, not a list (005:146, `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`). So `ward_account.reactivate` needs no schema change.
- Fence 6 is "Who can execute what" (runbook `:1517`).

---

## 0. The kickoff's finding: confirmed

`scripts/provision_ward_account.mjs` at `faf984a` never calls `app.provision_begin` or `app.provision_complete`:
- `provision_begin` appears once, in a comment at `:23`;
- `provision_complete` appears nowhere;
- the script calls `generate_link` first (`:144-163`), then inserts an accepted invite and an account directly (`:169-179`).

None of the gates runs on the only path that creates logins. J4 is unmet, and the `on conflict (id) do nothing` at `:177` hides the repeat.

Step 4b row 4 (runbook `:645`) reads CLOSED on SQL-only evidence, and its 021 citation, `313-322`, is the role parse. PR A restates the row as **CLOSED by PR A**, citing **021:341, 344 and 347** (022's lines once it lands) and the script tests. Until PR A merges, its body says the row overstates.

---

## 1. The script's call order

1. **Arguments** (no I/O).
   - WARD_STAFF needs `--facility` and `--category`.
   - PLATFORM_ADMIN refuses either one if given, since SQL would silently null them.
   - Exit 1 with the usage line.
2. **Key present** (no I/O). The existing STOP stays, and still exits 2.
3. **Host check** (§3; no I/O). It runs before any `postgres()` connection or `fetch`. Exit 2.
4. **`app.provision_begin(facility, category, role)`**, as `postgres` over `DATABASE_URL`, autocommit, with `application_name = 'provision_ward_account'`.
   - A raise gives exit 1, the refusal code named, and **zero Auth requests**.
   - `complete` gives exit 0 and **zero Auth requests**, printing:
     - WARD_STAFF: `already complete: nothing opened, no Auth call made`;
     - PLATFORM_ADMIN: `an operator account already exists: nothing was done` (BR-1 b). It never prints "provisioned".
   - `open` carries `invite_id` on.
5. **`POST {api}/auth/v1/admin/generate_link`** with `{type:'magiclink', email}`.
   - Each attempt has a 12 s `AbortSignal.timeout`.
   - At most 3 attempts, and only on a network error, 5xx or 429. Backoff is 0.5 s·2ⁿ with full jitter. A 4xx is never retried.
   - `hashed_token` and `action_link` are never printed.
6. **`app.provision_complete(invite_id, user_id)`**, autocommit. The returned status is printed as given:
   - `complete` → `provisioned`;
   - `reactivated` → `reactivated` (BR-1 c);
   - **any other status is exit 1** (`unrecognised status from provision_complete`), never success.

**The read-back step from the first version is removed.** BR-1 puts the reactivation property in SQL, and a script check of it would be the second implementation that BR-1 refuses.

**Begin and complete are two statements, not one transaction.** An Auth call sits between them. Holding a transaction across it would either roll back a write when the call fails, or hold locks for up to 36 s. Complete takes the invite `FOR UPDATE` (020:858).

**BP-6 4.** The script writes no `app.*` table. A compliance leg scans its non-comment source for `insert into`, `update ` and `delete from` aimed at `app.`, with a plant.

---

## 2. Failure-point table (BP-6 3), with 022 applied

| # | Where it fails | State left behind | What the re-run does | Register shows | Exit and message |
|---|---|---|---|---|---|
| F0 | arguments, key or host check | nothing | same refusal until the environment is fixed | — | 1 for usage; 2 otherwise, naming the mismatch |
| F1 | begin raises a gate code | nothing (the raise rolls back) | same refusal until the fact is fixed | — | 1, `refused by app.provision_begin: <CODE>`, zero Auth requests |
| F2 | after begin, `generate_link` fails | one **open** invite; perhaps an Auth user | begin returns **the same** invite (021:366-375), then `generate_link`, then complete | `provisioning_incomplete` | 1, `setup incomplete: invite <id> is open and no account exists yet — re-run the same command` |
| F3 | after `generate_link`, complete fails in transit | open invite and an Auth user; no account | begin returns the same invite; `generate_link` returns **the same user id**; complete writes | `provisioning_incomplete` | 1, the same sentence, **never read as a permissions bug** |
| F3′ | complete raises `ACCOUNT_SCOPE_CONFLICT`, `WARD_ALREADY_HAS_AN_ACCOUNT`, `OPERATOR_ALREADY_EXISTS` or `INVITE_ALREADY_ACCEPTED` | open invite and an Auth user | same refusal; a human decision is needed | `provisioning_incomplete` | 1, the code and one fixed sentence |
| F4 | complete commits, but the reply is lost | a complete account | begin returns `complete`, with **zero Auth requests** | `has_account` | re-run: 0 |
| F5 | (no longer a failure) the address's account of this scope was deactivated | — | begin's gates run (so a withdrawn facility stops at `AGREEMENT_WITHDRAWN`), then `generate_link` returns the same user, and complete **reactivates** | `has_account` | 0, `reactivated` |

**The second `generate_link` in F2 and F3 is safe.** No active account exists at that point, so no ward is using the console. F4's state is the success state, so the J4 test covers it.

### 2a. Migration 022 (BR-1)

**Name:** `database/migrations/022_one_operator_and_reactivation.sql`, with its `.down.sql`. It does these things and nothing else:

- **Pre-check.** Refuse to apply while more than one active PLATFORM_ADMIN exists: `RAISE EXCEPTION 'PLATFORM_ADMIN_DUPLICATES'`, with the count in DETAIL. This is the shape of 020's `WARD_ACCOUNT_DUPLICATES` pre-check (020:~315-326). Hosted has none.
- **(a) Index.** `CREATE UNIQUE INDEX IF NOT EXISTS ward_account_one_active_operator ON app.ward_account (role) WHERE role = 'PLATFORM_ADMIN' AND is_active`. It is the same partial-unique shape as `ward_account_one_active_per_ward` (020:336-338).
- **(b) `provision_begin`.** 021's body verbatim, plus one arm in the PLATFORM_ADMIN branch: when an active PLATFORM_ADMIN exists, `RETURN QUERY SELECT 'complete', NULL::uuid`. That opens nothing and writes no audit row.
- **(c) `provision_complete`.** 020's body (021 did not restate it), changed in two places:
  - **Same-scope account found and inactive.**
    - If the invite is still open: `UPDATE … SET is_active = true, deactivated_at = NULL`, which keeps 003's CHECK. Then accept the invite, write audit `ward_account.reactivate`, and return `'reactivated'`.
    - If the invite is already accepted: `INVITE_ALREADY_ACCEPTED`. Reactivation is tied to an open invite, which is to say to begin's gates having run for it.
  - **Every `unique_violation`, on the insert and on the reactivating update**, reads `GET STACKED DIAGNOSTICS … CONSTRAINT_NAME`:
    - `ward_account_one_active_per_ward` becomes `WARD_ALREADY_HAS_AN_ACCOUNT`;
    - `ward_account_one_active_operator` becomes `OPERATOR_ALREADY_EXISTS`;
    - any other constraint is **re-raised unchanged**, never relabelled.

  The mapping keys on the constraint name, never on the role.
- **Grants and signatures.** Both are `CREATE OR REPLACE` with unchanged signatures, and the return type stays `TABLE(status text)`, where `'reactivated'` is a new value, not a new type.
  - PostgreSQL keeps a replaced function's owner and ACL. The owner-only revoke loop is re-run anyway, idempotently, as 020 does.
  - **`packages/fixtures/function-grants.json` is unchanged, and no public function is added.**
  - **Fence 6 is unaffected**: it reads who can execute what, and 022 changes neither the function list nor any grant. So unlike 021, there is no "do not run fence 6 between merge and apply" window.
- **The down migration** restores 021's `provision_begin` and 020's `provision_complete` verbatim, copied from those files, drops the index `RESTRICT`, and deletes the ledger row.
  - **What "refuses while its own index would be needed" means here:** while an active PLATFORM_ADMIN exists, the index is the only thing between a provisioning run and a silent second operator (BD-2 1's trigger). So the down **refuses** (`OPERATOR_INDEX_IN_USE`, with the count) while one exists. Reversing past it is a founder decision taken by hand, which is the shape of 021's `AGREEMENTS_RECORDED`.
  - Nothing else needs a refusal. A reactivated account is an ordinary row under 021, and `ward_account.reactivate` audit rows satisfy 005's regex. **Cowork to confirm this reading.**
- **The ledger insert** is `ON CONFLICT DO NOTHING`, and the header passes the migration header lint. `database/migrations/README.md` gets 022's row.
- **Tests on 022 itself:**
  - a round trip in the rolled-back-transaction idiom (BL-1; the shape of `migration_021_round_trip.test.ts`), with bodies compared against 021's and 020's text;
  - `migration_idempotency` re-applied over 021 and over itself;
  - `down_migration_symmetry`.
- **Step 5** is restated for **one pending migration, 022**, at the three sites `runbook_migration_expectation.test.ts` parses. The guard derives that count, and I re-read it at build rather than trusting "three". `applied-hosted.json` is untouched (boundary 21).
- **Hosted (BR-1 f).** A new runbook section, "022's apply", covers the six fences with 022's expectations, as a founder step after PR A merges and **before H6's operator bootstrap**. The -45 gate is unaffected: 022 creates no facility and no ward_account row.

**Build-time check, named now.** The down's refusal fires on any database holding an active PLATFORM_ADMIN. `platform_admin_session_live.test.ts` commits one and cleans it up `afterAll`. Before the round-trip and idempotency legs rely on reversal, I check that no committed operator row is live when they run.

---

## 3. Host check (BP-6 5)

`scripts/provision_target.mjs` exports `classifyTarget({apiUrl, dbUrl, projectRef})`, which parses with WHATWG `new URL()` and never by string surgery (the `seed.sh` instance).

| URL | Local when | Hosted when | Otherwise |
|---|---|---|---|
| `SUPABASE_API_URL` | `http:` and host ∈ {`127.0.0.1`, `localhost`, `[::1]`}, any port | `https:` and host exactly `<ref>.supabase.co`, with `<ref>` = `[a-z0-9]{20}` | refuse, including `api.openbed.ng` |
| `DATABASE_URL` | the same host set | `db.<ref>.supabase.co`, or `*.pooler.supabase.com` with user `postgres.<ref>` | refuse |

**Rules.**
- Both local, with no flag: accept.
- Both hosted with the same ref, and `--project-ref` equal to it: accept.
- Everything else is refused, and the message names both classifications. That covers a local and hosted mix in either direction, two refs, hosted without the flag, a mismatched flag, and a flag on a local run.
- A variable set to `''` is refused, never treated as unset.

**NOT ASSERTED, in the header:**
- that the key belongs to the project, because `sb_secret_` carries no ref (a wrong key is F2, loud);
- **that the -45 gate is clear.** The host check is not that guard.

**Tests (compliance):**
- **ACCEPT:** unset defaults resolve as local, and ordinary hosted direct and pooler pairs are accepted, including a password holding `@` and `:`.
- **PLANT 1:** two different refs.
- **PLANT 2:** hosted without the flag.
- **Further plants:** the mix in both directions; a flag on a local run; a mismatched flag; `api.openbed.ng`; `http://<ref>.supabase.co`; `DATABASE_URL=''`.
- **ANTI-VACUITY:** empty or garbage inputs refuse.
- **End to end (tests/db):** PLANT 1's shape against the real local DB gives exit 2 with the host-check sentence and an unchanged `app.invite` count.

---

## 4. PLATFORM_ADMIN bootstrap (BP-6 6, BQ-1)

The command is `node scripts/provision_ward_account.mjs --role PLATFORM_ADMIN --email <address>`: begin, then `generate_link`, then complete, and scope NULL. With 022:
- a re-run is `complete` with zero Auth requests;
- a second address is refused by the index, named `OPERATOR_ALREADY_EXISTS`;
- a deactivated operator re-provisioned through the gates is reactivated.

**BQ-1 in PR A.** The operator's sign-in address never enters the repository. The script takes it only as `--email` at run time, and has no default or example with a real domain. Its usage line and header say `<the operator's sign-in address>`. Every test address is `@example.invalid` or `@e2e.invalid`. PR A adds no `@openbed.ng` address, and the zero-ward stop's support address comes from the existing `WARD_SUPPORT_EMAIL`. So PR B's widened contacts test will find nothing of PR A's to object to. The bootstrap runbook step is PR C's.

---

## 5. E2E harness (BP-6 9, accepted in BR-4)

`seedE2eCorpus()` upserts one synthetic `app.facility_contact` per E2E facility (`@e2e.invalid`, no SMS opt-in), beside the `app.facility_agreement` it already upserts (`tests/e2e/_harness.ts:108-112`). Without it, provisioning at `:250-266` is refused `NO_FACILITY_CONTACT`.

PR C's BP-12 moves ALPHA onto the operator functions. `database/seed/001_synthetic_seed.sql` is unchanged, since its listed facilities are the "no contact on record" state that PR C's register must show.

---

## 6. The zero-ward stop (BP-8; BR-2)

In `render()` (`apps/ward-console/src/main.ts:595-610`), before `renderHandover`: `if (rows.length === 0) { show(NO_WARD_HEADING, NO_WARD_SESSION); return; }`. That gives a heading and one paragraph, with no list and no form.

**Words, in `packages/labels`** (`ward-labels.json` `session.NO_WARD`, exported from `@openbed/labels/ward`):
- Heading: **"Not linked to a ward"**.
- Sentence: **"This sign-in isn't linked to a ward, so there is nothing to hand over. If you run OpenBed, sign in at admin.openbed.ng instead."**
- Then the existing `ASK_FOR_HELP` sentence, carrying `WARD_SUPPORT_EMAIL` (BR-2).

**Where it sits:**
- It is not a `WARD_MESSAGES` key, because `ward_console_render.test.ts:139-152` flags keys that nothing raises.
- It is added to `consoleMessages()` in `ward_support_contact.test.ts`.
- If `tracked_origins.test.ts` scans this source, the admin origin is added to `@openbed/origins` and the sentence reads from it. The string is never written around the guard.

**Tests:**
- **Render (jsdom):** the fixture's body shows the stop, with no `<form>`, no `<ul>` and no "Handover". PLANT: today's code reds it.
- **Shared-fixture link (§8 of the test conventions):** `platform_admin_session_live.test.ts:62` asserts that the live body equals the same checked-in fixture.

---

## 7. The redirect read-back script (BP-7; accepted in BR-4)

`scripts/readback_signin_link.mjs`, run as `pbpaste | node scripts/readback_signin_link.mjs --mode admin|ward --project-ref <ref>`.

**Input.**
- The link comes on stdin only, and **any argument that looks like a link is refused**, with a STOP telling the founder to request a new link.
- `--mode` has no default.

**Checks, in order** (STOP is exit 1; unusable input is exit 2):
1. One `https:` line with no userinfo and no port. Node's `TypeError` echoes its input, so it is caught and never printed.
2. Host exactly `<ref>.supabase.co`.
3. Path `/auth/v1/verify`.
4. Exactly one `redirect_to`. A missing one is a STOP, named as the Site URL fallback.
5. Decode once, then compare exactly to `https://admin.openbed.ng/` or `https://app.openbed.ng/`.
   - The Site URL in admin mode is STOP (AZ-1), never PASS.
   - A value still holding `%` after one decode is STOP as double-encoded.
   - In ward mode, a difference of only the trailing slash is named as such.

**Output.**
- Both forms of `redirect_to`.
- The link with every other parameter value and the fragment `<redacted>`. This is an allow-list, so only `redirect_to` and `type` print.
- PASS or STOP last.
- It makes **no request**. A source leg bans `fetch(`, `http`, `https`, `net`, `dns` and `child_process`, with a plant.

**Legs:**
- **Plants:**
  - the Site URL fallback;
  - no `redirect_to`;
  - a foreign host;
  - a lookalike host;
  - a double-encoded target;
  - a duplicate `redirect_to`;
  - the link given as an argument;
  - empty stdin;
  - a non-URL.
- **The token leg:** a planted token and `token_hash` must be absent from stdout+stderr on **every** path.
- **ACCEPT:** the link exactly as GoTrue emits it, and the percent-encoded correct target.
- **ANTI-VACUITY:** empty stdin.
- New legs are registered in `leg-coverage.json`.

---

## 8. The two Auth behaviours (BP-6 8; BR-3, BR-4)

**The rule text, for Cowork to rule on (BR-3):**

> **ENABLE_SIGNUP RULE.** On the local stack, with `enable_signup = false` in both `[auth]` (`supabase/config.toml:229`) and `[auth.email]` (`:276`), the stack restarted, the script is run through the gates for an address GoTrue has never seen.
> **Pass** means all three of:
> - `admin/generate_link` answered HTTP 200 with a user id;
> - an `auth.users` row exists for that address;
> - `provision_complete` returned `complete`.
>
> On a pass, PR A commits both settings as `false`, with a `config_drift` leg pinning them (plant: `true` is rejected), and the full suite and the E2E run under them.
> **Any other result** — a refusal, or a 200 with no user created — means PR A commits no change to `config.toml`, quotes the result verbatim, and stops for a ruling.
> **In both cases PR A does not change H2.** H2 becomes a founder step after PR A merges, and only on a pass.

**`sb_secret_` as `apikey` alone.**
- Read the local secret key from `supabase status -o env` (read-only).
- Call `generate_link` with `apikey` alone, and with `apikey` plus Bearer, for the demo JWT and for `sb_secret_`. Quote all four statuses.
- The script sends the shape that works for both. The `SUPABASE_SERVICE_ROLE_KEY` variable name is kept.
- **If the local CLI issues no `sb_secret_` key, PR A says so and infers nothing from the JWT.** It then becomes a hosted read at H6 with a failing half, written into PR C's bootstrap step (BR-4).

---

## 9. Test plan and blast radius (BP-14 A, BR-1 e)

**`tests/db/provision_script.test.ts`** (new). The script runs as an **async** child process (`execFileSync` would deadlock the in-process stub) against a request-counting local HTTP stub. Rows are committed with fresh ids and cleaned the harness's way. The cases:
- each begin refusal, each with zero stub requests:
  - `NO_FACILITY_CONTACT`
  - `AGREEMENT_NOT_RECORDED`
  - `AGREEMENT_WITHDRAWN`
  - `NO_SUCH_WARD`
  - `NO_SUCH_FACILITY`
  - `ROLE_NOT_PROVISIONED_IN_V1`
- the happy path, with one request;
- the J4 WARD_STAFF re-run, with zero requests;
- F2: stub 500, then 400; the invite is open; a re-run completes on the same invite id;
- F3: the stub terminates the script's backend by `application_name` before answering; the run exits "setup incomplete", and a re-run completes;
- retries: 503, 503, 200 gives 3 requests; 503 every time gives exactly 3 requests and exit 1;
- the canned token is never in the output;
- the host-check end-to-end plant;
- **from BR-1 e:**
  - a re-run of the operator bootstrap makes **zero** Auth requests and prints "already exists";
  - a deactivated ward re-provisioned through the gates is **reactivated**, with a `ward_account.reactivate` audit row, and the script prints "reactivated";
  - a withdrawn facility's deactivated ward is refused `AGREEMENT_WITHDRAWN` at begin, with **zero** Auth requests.

**`tests/db/provisioning_gates.test.ts`** gains, at the SQL level:
- **a second PLATFORM_ADMIN refused by name.** Begin opens an invite while no operator is active. A second operator is then made active. `complete` raises `OPERATOR_ALREADY_EXISTS`, not 23505.
- reactivation while another account is active for the ward raises `WARD_ALREADY_HAS_AN_ACCOUNT` by name;
- an inactive account whose invite is already accepted is not reactivated;
- **two concurrent `complete()` calls** on one invite, over two real connections with different user ids: one returns `complete`, and the other raises `INVITE_ALREADY_ACCEPTED`.

Its lines 27-30 are restated to cite the script test.

**Changed elsewhere:**
- **`tests/compliance/provision_ward_account.test.ts`** keeps its usage and key legs, and adds the PLATFORM_ADMIN usage legs, the no-`app.*`-write leg and §3's legs. Its unreachable-GoTrue leg (`:68`) moves to the db test, because begin now reaches the database first.
- **`leg-coverage.json`**: the three `no-seam` legs become reached, via the stub. New legs are registered, and `current` moves.
- **022's own tests**, listed in §2a.
- **The ward console and E2E**, per §5 and §6. The golden path and ratchet are re-run, and `frontier.json` must not regress.

**Unchanged, and confirmed before the merge word:**
- `function-grants.json`;
- the D3 closed list;
- `applied-hosted.json`;
- public output.

**Docs:**
- the script header restated, with `:47-49` marked superseded (method note 8) and "no host check" restated;
- step 4b row 4;
- step 5;
- 022's apply section;
- the README row;
- the record, -87 to -90.

**PR A body:**
- the Standard O attestation;
- the Standard P stopping rule, declared first;
- the behavioural-pass ledger, with one row per control: host check, read-back script, zero-ward stop, no-`app.*`-write leg, zero-Auth matrix, 022's index, 022's begin arm, 022's reactivation, and 022's constraint-name mapping;
- the two Auth results and the matrix, quoted from output.

## Verification (at build)

- `npm run build`, `npm run typecheck` and `bash scripts/lint_no_secrets.sh`.
- The full suite on a fresh per-run database (`supabase db reset`, `run_migrations.sh`, `seed.sh`), with counts from `node scripts/attest_counts.mjs junit.xml`.
- `bash scripts/run_e2e.sh`.

**Nothing hosted.**

## After approval (BR-5), then STOP

1. Copy this file to `~/cowork-handoff/pr-a-design-report-2026-09-24.md`.
2. Print its `shasum -a 256` and `wc -c`.
3. Stop, with no build until Cowork's build word.

## Open for Cowork

1. Confirm the reading of the down's refusal (§2a): refuse while an active PLATFORM_ADMIN exists.
2. Rule on the ENABLE_SIGNUP RULE text (§8).
3. Whether to commit this report beside the kickoff (proposed).
