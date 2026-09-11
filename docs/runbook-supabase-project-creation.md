# Runbook — Creating the hosted Supabase project

**This is a hand checklist. Nothing in this repository can enforce any of it, and
that is why it is written down rather than tested.**

Several properties this system depends on live in the Supabase dashboard, not in
the schema. A test claiming to verify them would be phantom enforcement
(`.claude/rules/code-pipeline.md`, Clause 4). Each step below says what the local
suite *does* cover, so the gap is visible rather than implied.

Work through this in the order printed. **Step 0 comes before the first push, and
steps 1 and 2 cannot be undone later.**

---

## Run them in this order

**The order printed below IS the instruction.** This file previously ran
1, 2, 3, 4, 5, 3b, 4b, 5b, 6, 7, 8 while its own header said *"Work through this
in order"* — so `3b. Backups and PITR — confirm BEFORE any real data exists` sat
after what was then §5, and anyone working top to bottom did backups last. That
is the one ordering the section exists to prevent. **A runbook is read under
pressure by someone who did not write it**, and no amount of in-section prose
outranks the sequence it is printed in.

Each heading keeps its old identifier as *(was §N)* so earlier references still
resolve — `tests/setup/auth.ts` and the sprint kickoff both cite "§5b", and a
kickoff is a historical record that does not get rewritten.

| # | Step | Why here |
|---|---|---|
| 0 | Repository settings (GitHub) *(was §8)* | Its own text: "Do these BEFORE the first push." |
| 1 | Region *(was §1)* | Fixed at creation and cannot be changed. |
| 2 | Exposed schemas *(was §2)* | The security boundary, and irreversible in practice once clients exist. |
| 3 | Auth session bounds *(was §9)* | A dashboard setting that must be in force before the first ward signs in. |
| 4 | Backups and PITR *(was §3b)* | Its own title: BEFORE any real data exists. Switching it on after the apply that needed it is too late. |
| 5 | Apply migrations *(was §3)* | Needs everything above it. |
| 6 | Verify the boundary by hand *(was §4)* | Its own text: run immediately after the apply. |
| 7 | Postgres version, recorded *(was §4b)* | Recorded alongside the apply. |
| 8 | Append-only on the hosted role graph *(was §5)* | Needs the migrations applied. |
| 9 | Magic-link single-use *(was §5b)* | Needs hosted auth reachable; independent of the tables. |
| 10 | Realtime publication *(was §6)* | The publication is created by the migrations. |
| 11 | Keys *(was §7)* | Storage hygiene; no dependency, last because nothing waits on it. |

### Read the rotation runbook before step 6

**Before running the hand curls in step 6, read
[`runbook-key-rotation.md`](runbook-key-rotation.md) § "Verifying a rotation —
a rotation you have not probed is a claim".** That section holds the rule
step 6 depends on — *name the exact signal that means pass, never a negation* —
and this runbook cites it only from step 11, long after the curls have been run.

**Not for ordering reasons, and the difference matters enough to write down.**
It was suggested that the legacy-key probe must run BEFORE the apply because a
live key starts returning 404 once the tables exist. **It is the other way
round, and the probe works in both states**, because PostgREST answers 401
ahead of any schema lookup:

| | dead legacy key | live legacy key |
|---|---|---|
| **before** the apply | 401 | 404 with `PGRST205` |
| **after** the apply | 401 | 200 |

What fails before the apply is a *"not 200"* checkbox, which passes on the 404
that means *the key is alive and you tested nothing*. The rotation runbook
already says exactly that and already forbids it. **A wrong reason is a false
fact even where the conclusion holds**, which is the point §4 of
`.claude/rules/test-conventions.md` makes about the region pin, so the corrected
version is recorded here rather than the ordering claim.

---

## 0. Repository settings (GitHub, not Supabase)  *(was §8)*

### Do these BEFORE the first push

- [x] **Secret scanning with push protection ON.** This is the *prevention*
      control, enforced server-side by GitHub at push time; the `secret-scan` CI
      job is only *detection*, and runs after a push has already been accepted.
      Enable it **before** the first push, not after — this repository is already
      public, and switched on afterwards the largest push in the project's
      history is the one it never saw.

      Verified enabled 2026-09-10 via the repository API: `secret_scanning`,
      `secret_scanning_push_protection`, `secret_scanning_ai_detection` and
      `secret_scanning_non_provider_patterns` all `enabled`.

      **NOT ASSERTED ANYWHERE, and this class has NO VERIFIED CONTROL.** Being
      enabled is a configuration fact, not evidence that it blocks anything.
      `non_provider_patterns` — the path a Postgres connection string falls
      under — is heuristic, and its behaviour on any particular string is not
      predictable from the setting being on. So what stands between a
      credential-bearing commit and this public repository is two UNVERIFIED
      layers: push protection, never observed blocking anything, and a detection
      job that runs after the push was already accepted.

      On 2026-09-10 a password-bearing Postgres URL in a new test file was
      caught by `scripts/lint_no_secrets.sh` — whose verdict the commit sequence
      then stepped over, because it chained `git commit` after a `grep` of the
      output. **What actually caught it was a person reading.**

      **That sentence previously read "`scripts/gate.sh` now makes a local
      verdict binding", and it was false.** It happened AGAIN the same day,
      after `gate.sh` existed: the gate ran, printed `FAILED`, and `git commit`
      sat on the next line rather than after `&&`. A verdict something else must
      remember to consume is not binding, which is the finding this repository
      keeps making about its own guards. `scripts/commit.sh` now runs the gate
      and commits only on exit 0, so there is no second step to order — and its
      header, like `gate.sh`'s, says it is not a control: a bare `git commit`
      bypasses it completely.

      Two read-only probes were considered and neither closes this:
      the secret-scanning alert history is empty, which is equally consistent
      with *nothing was ever committed* and with *scanning is not reaching*; and
      a known-revoked provider-format token would establish only that provider
      patterns are blocked — already implied by the setting — while saying
      nothing about the heuristic path, and would put a deliberate
      secret-shaped string into a public repository's alert history to answer a
      question nobody asked.

      **Closes only on evidence of an actual block**, which cannot be
      manufactured without pushing a real secret to a public repository. That is
      the same rule this project applies to the merge-blocking probe: you do not
      establish a control by attempting the harm it prevents.

- [ ] **Branch protection on `main`, requiring exactly these SEVEN checks:**
      `repo-lint`, `migration-lint`, `compliance-tests`, `db-tests`,
      `bundle-guards`, `secret-scan`, `golden-path`.

      **CORRECTED 2026-09-10 — it said SIX and listed six.** `golden-path` was
      added when the frontier ratchet landed, and a runbook that names the
      required set WRONGLY is worse than one that says "see the settings",
      because this list is what gets used to restore protection after an
      incident. `golden-path` runs the Gate 2 decomposition against a real stack
      and gates on the ratchet; without it in this list, a restore would quietly
      drop the only check that proves the golden path still runs.

      **The required-check names must equal `ci.yml`'s job names AS A SET, and
      this is the item most likely to be wrong.** GitHub matches required checks
      by NAME STRING. A job that exists, runs, goes red and is simply not on the
      required list is a **vacuous gate — the merge proceeds**. This is the same
      `set(parsed) === set(table)` discipline the test suite applies to column
      lists, applied to a GitHub setting that no test can reach.

      Derive both sides and compare, rather than trusting either:

      ```bash
      # what CI actually defines
      node -e "const y=require('js-yaml');const f=require('fs');\
      console.log(Object.keys(y.load(f.readFileSync('.github/workflows/ci.yml','utf8')).jobs).sort().join('\n'))"

      # what main actually requires
      gh api repos/Paddie-Health-Ltd/OpenBed-NG/branches/main/protection \
        --jq '.required_status_checks.contexts | sort | .[]'
      ```

      *(Six is the count of CI JOBS. Seven is the count of security GATES
      demonstrated red on demand — they live across these six jobs. Do not
      require a seventh check name; there is no seventh job.)*

- [ ] **"Do not allow bypassing the above settings" ON.** Easy to miss on a solo
      repository and the one that matters most there: a single implementer who is
      also repository admin makes every gate advisory for the only person who will
      ever hit one.

      ```bash
      gh api repos/Paddie-Health-Ltd/OpenBed-NG/branches/main/protection \
        --jq '{enforce_admins:.enforce_admins.enabled}'
      ```

- [x] **Verified 2026-09-09 that a red required check produces `BLOCKED`.**
      A/B/A on PR #1 with settings held constant: six green -> `CLEAN`; two red ->
      `BLOCKED`; six green -> `CLEAN`. All six checks had REPORTED in every state,
      so this is not the checks-pending case.

      **Keep this claim at the strength of the evidence.** What was observed is
      GitHub's *computed* `mergeStateStatus`, together with `enforce_admins: true`
      verified independently above. It is **not** a merge attempt that was
      refused. Do not close that gap by attempting a merge while red: the only way
      to observe an actual refusal is to try the thing whose failure mode is
      landing a known-bad commit on `main`. Computed status plus verified
      `enforce_admins` is the correct stopping point.

- [ ] Private vulnerability reporting enabled (referenced by `SECURITY.md`)

**Covered by tests: nothing, and for the same reason as the region (step 1).**
Reading branch protection needs a token in CI, in a public repository. Assertable,
declined on credential-surface grounds, verified here with the commands above so
it is re-derivable rather than trusted.

---


## 1. Region — `eu-west-1`. **DISCHARGED 2026-09-09.**  *(was §1)*

**Corrected 2026-09-09. This runbook previously said `af-south-1` (Cape Town),
and that value was never achievable: Supabase has no African region.** Its list is
Asia Pacific, North America, Europe and South America. `af-south-1` is an AWS
region name that Supabase does not offer, so the original pin was a spec citing
something that does not exist. Recorded here so nobody re-derives it.

**Verified, not assumed** (2026-09-09, <https://supabase.com/docs/guides/platform/regions>):
Supabase offers 17 regions — `us-west-1/2`, `us-east-1/2`, `ca-central-1`,
`eu-west-1/2/3`, `eu-central-1/2`, `eu-north-1`, `ap-south-1`,
`ap-southeast-1/2`, `ap-northeast-1/2`, `sa-east-1`. **None is in Africa.**
`eu-west-1` is West EU (Ireland).

**The region is fixed at creation and cannot be changed.** Moving means a new
project and a data migration with an outage in the middle — so the pin still
matters, it simply had to be a region that exists.

### Verification — a probe, not a dashboard glance

Re-derivable by anyone with a management token. Do not read this off the
dashboard; read it from the API, so the answer is evidence rather than a memory.

```bash
# Prints the full project objects. Read region / status / Postgres version off
# the output rather than through a field path this runbook guessed at.
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects | jq .
```

*The endpoint returns `V1ProjectWithDatabaseResponse`, so `region` and `status`
are top level and the Postgres version sits inside a nested database object. The
exact key was **not** verified when this was written, which is why the command
above prints everything instead of asserting a path. If you pin a `jq` filter
later, confirm the field names against the response first — a runbook step that
fails on a wrong path is a step people stop running.*

**Result on file:**

```
project : OpenBed NG
ref     : klrlpxysjsjpdkeqdhvl
region  : eu-west-1
status  : ACTIVE_HEALTHY
postgres: 17.6.1
verified: 2026-09-09, Supabase Management API
```

- [x] Project exists in `eu-west-1`, verified via the Management API on 2026-09-09

**Covered by tests: nothing, and the reason has changed.** It is *not* that the
region is unreachable from the repository — a test could call the Management API
above. It is that doing so needs a management token in CI, in a public
repository, for a class of credential the SOP says cannot be rotated quietly.
**Assertable, declined on credential-surface grounds, verified here instead.**

### What did NOT survive the correction, and one thing that never held

The original entry justified the pin as *"keeps the data on the continent, which
is materially easier to defend under NDPA s.41 transfer rules."*

- **"On the continent"** is now false, and was unachievable for any Supabase region.
- **The s.41 leg never followed from the geographic claim in the first place.**
  NDPA s.41 turns on Nigeria versus not-Nigeria, not Africa versus not-Africa —
  **Cape Town was as much a cross-border transfer as Dublin.** That sentence was
  doing rhetorical work rather than legal work when it was written. Do not read
  the correction as losing a protection: there was none to lose.
- **Whether `eu-west-1` is defensible under s.41 is a CLCO question and is
  deliberately not answered here.** It attaches only to the residue — role
  addresses in `auth.users` and one facility contact — which is the *same* single
  open CLCO item already on file, not a new thread.

---


## 2. Exposed schemas — `public` and `graphql_public` ONLY  *(was §2)*

Dashboard → Settings → API → Exposed schemas. **`app` must not appear.**

This is *the* security boundary. Every base table lives in `app`, and its absence
from this list is what makes PostgREST refuse with `PGRST106` before any RLS
policy is even consulted. Decision A3: RLS is the second line, not the only one.

- [ ] Exposed schemas is exactly `public, graphql_public`
- [ ] `extra_search_path` does not include `app`

**Covered by tests: partially, and only locally.** The control is three parts and
only two are automatable:

| Part | Where |
|---|---|
| A live anon request for `app` is refused with `PGRST106` | `tests/db/rls_anon_reachability.test.ts` — **local PostgREST only** |
| `supabase/config.toml` `[api] schemas` excludes `app` | `tests/db/config_drift.test.ts` — static |
| The **hosted** setting excludes `app` | **this checkbox** |

---


## 3. Auth session bounds — the ward-identity guarantee  *(was §9)*

Dashboard -> Authentication -> Sessions.

- [ ] **Time-box user sessions** enabled, set to **24 hours**
- [ ] **Inactivity timeout** enabled, set to **8 hours**

**This is not hardening, it is a load-bearing product decision.** The
ward-identity memo resolved revocation in the CTO's favour *because* short
sessions make an offboarding SOP unnecessary: access follows **physical control
of the ward handset**, and a nurse who no longer holds it loses access by
default with no revocation step anyone has to remember. The COO's alternative --
an SOP a Nigerian clinic files a leaver notification under -- was rejected as one
that would not run. **If these bounds are not set, the thing that was dropped in
their favour is not in force, and nothing in the product would say so.**

Until 2026-09-11 the local `[auth.sessions]` block was commented out and neither
bound was set. It is now set in `supabase/config.toml`, and
`tests/db/auth_refresh_live.test.ts` proves BOTH bounds against the running
stack -- a session aged past `timebox` and one aged past `inactivity_timeout`
are each refused renewal, with distinct messages, and an hour-old session still
renews. **That covers the local stack only. This checkbox is the hosted half and
there is no test that can reach it.**

### The 25-hour nuance, because the memo does not state it

**The bound governs RENEWAL, not the token already in the handset.** An access
token minted before the session hit its time-box stays valid until its own
`exp`. Measured on 2026-09-11: PostgREST answered **200** to a token from a
session 30 hours old. So the real worst case is `timebox` **plus** `jwt_expiry`
-- **25 hours**, not 24. Shortening `jwt_expiry` shortens that tail and costs a
refresh round trip per hour of use; it has not been done, and the number is
written here so the decision is made with it rather than around it.

**Covered by tests: the local-integration leg only, against GoTrue v2.196.0.**
The hosted setting is a dashboard value with no in-database representation, and
hosted auth is upgraded by Supabase out-of-band and is not that version.

---


## 4. Backups and PITR — confirm BEFORE any real data exists  *(was §3b)*

Supabase Pro was chosen partly for backups. Verify the setting rather than the
plan: the first apply that *needs* a restore point is the first apply where
switching it on afterwards is too late.

```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  https://api.supabase.com/v1/projects/klrlpxysjsjpdkeqdhvl/database/backups | jq .
```

- [ ] Daily backups enabled, and a backup listed
- [ ] PITR status recorded (Pro add-on; note whether it is on, rather than assuming)

**Covered by tests: nothing** — same class as the region pin. Assertable via the
Management API, declined on credential-surface grounds, verified here instead.

A snapshot is moot for the FIRST apply, because the database is empty and there
is nothing to restore. It stops being moot the moment that apply succeeds.

---


## 5. Apply migrations  *(was §3)*

```bash
read -rs DATABASE_URL && export DATABASE_URL   # prompts; keeps the password out of ~/.zsh_history
bash scripts/run_migrations.sh --dry-run       # STOP CONDITION: exactly 13 pending
bash scripts/run_migrations.sh
```

Use `read -rs`, not an inline `export DATABASE_URL='...'` -- the connection
string carries the hosted database password and an inline export writes it into
your shell history.

**The dry run is a stop condition, not a look.** Anything other than
`13 migration(s) pending.` -- stop and report. A dry run without a stated
expectation is just output.

### Expected output, including the one line that looks like a failure and is not

On a virgin database the two commands report **different numbers**, and the
second is lower:

```
13 migration(s) pending.          <- dry run
Migrations complete (12 applied this run).   <- apply
```

**Twelve is correct. Nothing was skipped.** Migration 001 creates the `app`
schema, the revoke wall and `app.schema_migrations` itself, so it cannot be
recorded by a ledger that does not exist yet. The runner applies and ledgers it
in a separate **bootstrap** step, and the apply loop then counts only what it
applied itself -- 002 through 013, which is twelve. The dry run has no bootstrap
branch: `is_applied` returns 0 while the ledger is absent, so it counts all
thirteen as pending. The two numbers are measuring different things.

**Confirm it by the ledger, which is the artefact that matters, not by the
count:**

```bash
psql "$DATABASE_URL" -Atc "select count(*) from app.schema_migrations"   # expect 13
bash scripts/run_migrations.sh --dry-run                                 # expect 0 pending
```

Verified against a virgin local database on 2026-09-10: dry run 13 pending,
apply `12 applied this run`, ledger 13 rows, second dry run 0 pending.

### What happens if it dies partway -- documented, not discovered

Each migration is applied with **both** `--single-transaction` and
`ON_ERROR_STOP=1`. The two are only safe together:

| Missing flag | Failure |
|---|---|
| no `--single-transaction` | psql autocommits per statement, so a file failing at statement 7 of 12 leaves 1-6 **committed** and unledgered |
| no `ON_ERROR_STOP` | the transaction rolls back, every later statement fails, the closing COMMIT becomes a ROLLBACK -- **and psql exits 0**. The runner reports success over a database that received nothing |

Measured on this stack, not assumed: `--single-transaction` alone exits **0** on
a mid-file error; with `ON_ERROR_STOP` it exits **3**. Both roll back.

So a migration either applies completely or not at all, and because every
migration ends by inserting its own filename into `app.schema_migrations`, the
DDL and its ledger row commit together -- the schema and the ledger cannot
disagree about a file.

**Residual window:** the belt-and-braces `INSERT ... ON CONFLICT DO NOTHING` the
script runs *after* the file is a separate statement. If the connection drops in
between, the file is applied and already self-ledgered, so that insert was
redundant. **Recovery in every case is: run it again.** The runner skips ledgered
files and re-applies the rest, and
`tests/db/migration_idempotency.test.ts` is what makes re-application safe to
rely on.

Proven by `tests/db/migration_runner_atomicity.test.ts`, which plants a
mid-migration failure and asserts nothing applied and nothing ledgered.

Do **not** run `scripts/seed.sh`. It refuses any non-local database by design —
the seed inserts synthetic facilities that would be indistinguishable from real
ones.

- [ ] All 13 migrations applied; `select count(*) from app.schema_migrations` returns 13

---


## 6. Verify the boundary by hand, against the hosted project  *(was §4)*

Run these against the hosted project with the **publishable** key. Every one
must fail.

**THE KEY MUST BE THE `sb_publishable_` ONE, NOT THE LEGACY `anon` JWT.**
Disabling legacy API keys on 2026-09-09 killed the legacy `anon` key as well as
the exposed `service_role` one — they are signed by the same secret. A probe
still written against the old format now fails at *authentication*, before
PostgREST ever consults a schema, and records a boundary that was never
exercised. That is a false negative of exactly the same shape as the "not 200"
rotation probe in `runbook-key-rotation.md`: the check passes for a reason
unrelated to what it guards. Take the key from the script, never from a
remembered value.

```bash
KEY="$(bash scripts/get_publishable_key.sh)"
SUPABASE_URL="https://klrlpxysjsjpdkeqdhvl.supabase.co"

# A 401 on ANY of these means the key is wrong, not that the boundary held.
curl -s -w '\nHTTP %{http_code}\n' \
  "$SUPABASE_URL/rest/v1/facility?select=*" \
  -H "apikey: $KEY" -H "Accept-Profile: app"       # expect 406, body names PGRST106

curl -s "$SUPABASE_URL/rest/v1/ward_public?select=*" \
  -H "apikey: $KEY" | head -c 200                  # expect rows, SELECT only

curl -s -X POST "$SUPABASE_URL/rest/v1/ward_public" \
  -H "apikey: $KEY" -d '{}' -w '\nHTTP %{http_code}\n'   # expect 4xx, body says why
```

- [ ] `app` schema unreachable with the publishable key
- [ ] The three mirrors readable
- [ ] Anon write refused

### Check (a), HTTP half — run immediately after the apply

```bash
KEY="$(bash scripts/get_publishable_key.sh)"
REF=klrlpxysjsjpdkeqdhvl

# 1. Asking for the `app` schema must be refused with PGRST106, BEFORE any
#    policy is consulted. This is the boundary; RLS is the second line.
curl -s "https://$REF.supabase.co/rest/v1/facility?select=*" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Accept-Profile: app"

# 2. And by bare name, in case `app` ever reaches extra_search_path.
for t in facility ward_status audit_log facility_contact schema_migrations; do
  printf '%s -> ' "$t"
  curl -s -o /dev/null -w '%{http_code}\n' "https://$REF.supabase.co/rest/v1/$t?select=*" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
done
```

- [ ] (1) returns `PGRST106` / HTTP 406
- [ ] (2) returns no 200 for any name
- [ ] Result recorded with a date

**WHY THIS IS A CURL STEP AND NOT A VITEST TEST.**
`tests/setup/global-setup.ts` gates the entire `db` project on a live
`DATABASE_URL` and on `app.schema_migrations` existing, so a hosted-only probe
cannot run there — and two of the four assertions in
`tests/db/rls_anon_reachability.test.ts` query the catalogue directly rather than
over HTTP. That is a design constraint, not a defect: hand checks belong in this
runbook. **Do not "fix" it by pointing the test suite at hosted.**

The catalogue half of check (a) — that `anon` holds no `USAGE` on `app`, and the
per-table enumeration — rides along with step 8 below, in the shell that already
holds `DATABASE_URL`. Splitting it that way costs no extra round trip and keeps
this half free of any credential.

---


## 7. Postgres version — local and hosted, recorded  *(was §4b)*

| Where | Version | Source |
|---|---|---|
| Hosted | 17.6.1.**166** | Management API, 2026-09-09 |
| Local (`supabase start`) | 17.6.1.**167** | image `public.ecr.aws/supabase/postgres:17.6.1.167` |

**Same major and minor; the patch differs by one (166 vs 167).** No major-version
divergence to reason about, and the earlier record of "17.6.1 both" was true at
that precision but not at patch level.

**Do not read that as making step 8 less necessary.** The hosted append-only hand
check exists because of the **role graph** — Supabase's `postgres` role is a
superuser locally and is not hosted — and that asymmetry is independent of the
Postgres version. Matching versions remove one confound; they remove none of the
reason for the check.

Re-derive with:

```bash
docker ps --format '{{.Image}}' | grep supabase/postgres   # local
# hosted: the same Management API call as step 1
```

---


## 8. Append-only, verified on the hosted role graph  *(was §5)*

**This is the step the local suite genuinely cannot stand in for**, and the reason
is specific rather than general.

Supabase's `postgres` role **is a superuser on a local stack and is not on a
hosted project**. `tests/db/append_only_enforcement.test.ts` proves the trigger
fires for a local superuser, which is strong evidence — but the *grant* half of
that test describes the local role graph, and the hosted one differs.

Connect to the hosted project as the service role and confirm both raise:

```sql
update app.audit_log set action = 'tampered' where id = (select min(id) from app.audit_log);
delete from app.ward_status_event where id = (select min(id) from app.ward_status_event);
```

- [ ] Both raise `APPEND_ONLY_VIOLATION`
- [ ] `select tgenabled from pg_trigger where tgname like '%append_only%'` returns `A` for both

---


## 9. Magic-link single-use — an INHERITED assumption, so probe it  *(was §5b)*

`app.invite` used to carry `token_hash UNIQUE`, and that constraint was doing
single-use enforcement. It is gone: Supabase auth now mints, expires, validates
and resends the link, and a second credential store here would have had no minter
and no validator.

**That trade converts an assertion we owned into an assumption about a vendor.**
Removing our own enforcement is right; inheriting someone else's without a probe
is exactly the Clause 5 shape — a mechanism believed present that nothing
establishes. The Self-Check Protocol already requires that every Postgres feature
behave as claimed *in the version Supabase actually runs* rather than as inferred;
the same discipline applies to hosted auth.

Verify once, empirically, on the hosted project:

1. Invite a test ward account and capture the magic link.
2. Consume it. Confirm a session is issued.
3. **Consume the same link a second time.** It must be refused.
4. Let a second link expire, then attempt it. It must be refused.

- [ ] A magic link cannot be consumed twice
- [ ] An expired magic link is refused
- [ ] Recorded: the Supabase auth version these were observed against

**Covered by tests: the local-integration leg only, against GoTrue v2.196.0**
(the build shipped by Supabase CLI 2.117.0, printed by the `golden-path` job on
every run from `/auth/v1/health`). `tests/e2e/golden-path.test.ts` mints a link
through the admin API, consumes it at the public `POST /auth/v1/verify`, and
asserts that a second use and an expired link are both refused with HTTP 403
`otp_expired`.

**The hosted vendor property remains uncovered, and this checkbox is still the
only control over it.** Supabase upgrades hosted auth out-of-band, so the hosted
GoTrue is not the version above and no test in this repository can reach it.

Two details that change what the local leg proves, recorded because a reader
deciding whether this checkbox is still needed will decide from them:

- Expiry is FORCED, by ageing `auth.users.confirmation_sent_at` past
  `otp_expiry`. Established by controlled probe with a positive control -- ageing
  `auth.one_time_tokens.created_at` instead has no effect at all. So what is
  proved is that GoTrue refuses a token whose sent-at is outside the window, not
  that it expires one on its own after an hour of real time.
- Only the email TRANSPORT is bypassed. `[local_smtp]` is disabled, so the link
  is minted through the admin API; the consumption leg runs for real over HTTP
  with the anon key. Nothing in the suite mints a session without consuming a
  link.

**Item 3 of the checklist above is therefore discharged for local and open for
hosted.** Record the hosted auth version here when you run these by hand.

---


## 10. Realtime publication  *(was §6)*

- [ ] `select tablename from pg_publication_tables where pubname='supabase_realtime'` returns exactly
      `facility_public`, `ward_public`, `lga_rollup`
- [ ] `select relreplident from pg_class where relname in (...)` returns `d` for all three —
      **never `f`.** `FULL` ships the whole old row in a DELETE payload, Realtime
      DELETE events are not RLS-filtered, and quiet mode removes rows by DELETE.

---


## 11. Keys  *(was §7)*

- [ ] `service_role` key stored in the server-side secret store only
- [ ] It appears in no `NEXT_PUBLIC_*` or `VITE_*` variable anywhere
- [ ] Rotation procedure read: [`runbook-key-rotation.md`](runbook-key-rotation.md)

---


## What remains un-automatable, and stays that way

| Property | Why no test can cover it |
|---|---|
| Region pin | Assertable via the Management API, declined on credential-surface grounds |
| Hosted exposed-schemas list | A dashboard setting with no in-database representation |
| Hosted superuser semantics | The local role graph differs from the hosted one |
| Hosted auth session bounds (`timebox`, `inactivity_timeout`) | A dashboard setting with no in-database representation. Both bounds ARE proved locally in `tests/db/auth_refresh_live.test.ts`; the hosted values are step 9 |
| Magic-link single-use and expiry | Enforced by Supabase auth, not by this schema, since `app.invite` no longer holds a token |
| Branch protection and its required-check set | A GitHub setting; reading it in CI needs a token this public repository should not carry |
| Push protection | A GitHub repository setting; CI runs after the push |

Adding a test that appeared to cover any of these would be worse than the gap,
because it would stop anyone looking.

