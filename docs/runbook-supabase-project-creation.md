# Runbook — Creating the hosted Supabase project

**This is a hand checklist. Nothing in this repository can enforce any of it, and
that is why it is written down rather than tested.**

Several properties this system depends on live in the Supabase dashboard, not in
the schema. A test claiming to verify them would be phantom enforcement
(`.claude/rules/code-pipeline.md`, Clause 4). Each step below says what the local
suite *does* cover, so the gap is visible rather than implied.

Work through this in order. Steps 1 and 2 cannot be undone later.

---

## 1. Region — `eu-west-1`. **DISCHARGED 2026-09-09.**

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

## 2. Exposed schemas — `public` and `graphql_public` ONLY

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

## 3. Apply migrations

```bash
export DATABASE_URL='<the hosted connection string>'
bash scripts/run_migrations.sh
```

Do **not** run `scripts/seed.sh`. It refuses any non-local database by design —
the seed inserts synthetic facilities that would be indistinguishable from real
ones.

- [ ] All 13 migrations applied; `select count(*) from app.schema_migrations` returns 13

---

## 4. Verify the boundary by hand, against the hosted project

Run these against the hosted project with the **anon** key. Every one must fail.

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "$SUPABASE_URL/rest/v1/facility?select=*" \
  -H "apikey: $ANON_KEY" -H "Accept-Profile: app"          # expect 406 PGRST106

curl -s "$SUPABASE_URL/rest/v1/ward_public?select=*" \
  -H "apikey: $ANON_KEY" | head -c 200                      # expect rows, SELECT only

curl -s -X POST "$SUPABASE_URL/rest/v1/ward_public" \
  -H "apikey: $ANON_KEY" -d '{}' -o /dev/null -w '%{http_code}\n'   # expect 4xx
```

- [ ] `app` schema unreachable with the anon key
- [ ] The three mirrors readable
- [ ] Anon write refused

---

## 5. Append-only, verified on the hosted role graph

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

## 4b. Postgres version — local and hosted, recorded

| Where | Version | Source |
|---|---|---|
| Hosted | 17.6.1 | Management API, 2026-09-09 |
| Local (`supabase start`) | 17.6.1 | image `public.ecr.aws/supabase/postgres:17.6.1.167` |

**They match**, so there is no major-version divergence to reason about.

**Do not read that as making step 5 less necessary.** The hosted append-only hand
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

## 5b. Magic-link single-use — an INHERITED assumption, so probe it

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

**Covered by tests: nothing.** No test in this repository can reach hosted auth,
and the local stack's GoTrue may not match the hosted version. This checkbox is
the only control.

---

## 6. Realtime publication

- [ ] `select tablename from pg_publication_tables where pubname='supabase_realtime'` returns exactly
      `facility_public`, `ward_public`, `lga_rollup`
- [ ] `select relreplident from pg_class where relname in (...)` returns `d` for all three —
      **never `f`.** `FULL` ships the whole old row in a DELETE payload, Realtime
      DELETE events are not RLS-filtered, and quiet mode removes rows by DELETE.

---

## 7. Keys

- [ ] `service_role` key stored in the server-side secret store only
- [ ] It appears in no `NEXT_PUBLIC_*` or `VITE_*` variable anywhere
- [ ] Rotation procedure read: [`runbook-key-rotation.md`](runbook-key-rotation.md)

---

## 8. Repository settings (GitHub, not Supabase)

### Do these BEFORE the first push

- [ ] **Secret scanning with push protection ON.** This is the *prevention*
      control, enforced server-side by GitHub at push time; the `secret-scan` CI
      job is only *detection*, and runs after a push has already been accepted.
      Enable it **before** the first push, not after — this repository is already
      public, and switched on afterwards the largest push in the project's
      history is the one it never saw.

- [ ] **Branch protection on `main`, requiring exactly these SIX checks:**
      `repo-lint`, `migration-lint`, `compliance-tests`, `db-tests`,
      `bundle-guards`, `secret-scan`.

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

## What remains un-automatable, and stays that way

| Property | Why no test can cover it |
|---|---|
| Region pin | Assertable via the Management API, declined on credential-surface grounds |
| Hosted exposed-schemas list | A dashboard setting with no in-database representation |
| Hosted superuser semantics | The local role graph differs from the hosted one |
| Magic-link single-use and expiry | Enforced by Supabase auth, not by this schema, since `app.invite` no longer holds a token |
| Branch protection and its required-check set | A GitHub setting; reading it in CI needs a token this public repository should not carry |
| Push protection | A GitHub repository setting; CI runs after the push |

Adding a test that appeared to cover any of these would be worse than the gap,
because it would stop anyone looking.
