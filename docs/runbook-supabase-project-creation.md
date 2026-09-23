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
| P | Prerequisites — `psql` on PATH | Steps 5, 6, 8 and 10 need it, and it is never on PATH by default. |
| 0 | Repository settings (GitHub) *(was §8)* | Its own text: "Do these BEFORE the first push." |
| 1 | Region *(was §1)* | Fixed at creation and cannot be changed. |
| 2 | Exposed schemas *(was §2)* | The security boundary, and irreversible in practice once clients exist. |
| 3 | Auth session bounds *(was §9)* | A dashboard setting that must be in force before the first ward signs in. |
| 4 | Backups and PITR *(was §3b)* | Its own title: BEFORE any real data exists. Switching it on after the apply that needed it is too late. |
| 5 | Apply migrations *(was §3)* | Needs everything above it. |
| 6 | Verify the boundary by hand *(was §4)* | Its own text: run immediately after the apply. |
| 7 | Postgres version, recorded *(was §4b)* | Recorded alongside the apply. |
| 8 | Append-only on the hosted role graph *(was §5)* | Needs the migrations applied. |
| 9 | Magic-link single-use *(was §5b)* | Needs hosted auth reachable; independent of the tables. **Partly closed 2026-09-14**; the remainder needs custom SMTP. |
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

## P. Prerequisites — do this in every new shell

**`psql` is not on PATH, and that has now cost two sessions.** On the machine
these steps are run from, it is Homebrew's **keg-only** `libpq`, which Homebrew
deliberately does not link onto PATH. A bare `psql` exits 127 (command not
found), and a step that chains on it proves nothing.

The second command is a stop condition: it must print a version. Recorded
2026-09-13: `psql (PostgreSQL) 18.6`.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
psql --version
```

Anything other than a version line — stop. Do not run step 5, 6, 8 or 10 until
it prints one. The client version this project was applied through is recorded
in step 7.

### EVERY BLOCK THAT NEEDS `psql` CARRIES THE FIRST LINE ITSELF (R-2026-09-22-52)

**The `export PATH` line above is repeated as the first line of every fenced block
in this runbook that invokes `psql`, or that invokes `scripts/run_migrations.sh`,
which invokes `psql`.** It is idempotent: running it in a shell that has already
had step P costs nothing and changes nothing.

This is the rule this document already applies to credentials — *each block that
needs one reads it itself rather than inheriting it from an earlier step* — extended
to the one other thing a block inherits from the shell it is pasted into. **Step P
remains where the version check lives and where the reason is explained**; what the
blocks carry is the one line, not the check.

**WHY, and it is an observation rather than a precaution.** On 2026-09-22, applying
migration 018, the founder pasted step 5's pre-apply block into a fresh shell and got
`zsh: command not found: psql`, twice, before any database was read. Nothing reached
the database and nothing was at risk — but the failure was the shell's bare message,
not this project's. **`scripts/run_migrations.sh` has a named stop condition for
exactly this** — `ERROR: psql not on PATH. Install postgresql-client, or set
OPENBED_PSQL.` — and **none of the direct `psql` blocks had one**, which is why the
block that bypasses the runner is the one that failed rawly. Sixteen blocks are
governed; fifteen needed the line.

**THE PATH IS MACHINE-SPECIFIC and this is the only place that decides it.**
`/opt/homebrew/opt/libpq/bin` is Homebrew's prefix on **Apple silicon**; an Intel
Mac uses `/usr/local`, and a Linux host has `psql` on PATH already or installs
`postgresql-client`. **A different machine changes step P and the governed blocks
together** — `tests/compliance/runbook_psql_path.test.ts` derives the expected line
from this block, so editing it here reds every block that still carries the old one,
rather than letting the two drift.

### Every bash block in this runbook holds commands only

**No `#` comment appears inside a bash block, and none may be added.** In an
interactive zsh -- the macOS default shell -- `#` does not start a comment
unless the `interactivecomments` option is set, and it is off by default. A
pasted comment then runs as a command named `#`; words after a `;` in it run as
further commands; backticks in it execute; and **an apostrophe in it opens a
quote that silently swallows every real command after it.** Observed on
2026-09-14 by pasting each of the 33 comment lines these two runbooks carried
into `zsh -f -i`, with `interactivecomments` switched on as the counter-control:
all 33 misbehaved. **The worst was an apostrophe** — `step 2's`, added in #16
on 2026-09-13 — that stopped step 6 check (a) 2's loop from running at all:
**1 curl call where 6 are written**, and a vacuous "no 200". It was live on
`main` from 2026-09-13 21:28 until #18 removed it at 2026-09-14 09:48, and it
post-dates the founder's recorded step 6 run. Every explanation now sits in the
prose above its block.

**Do not "fix" this by turning `interactivecomments` on.** It is a remembered
step: a new terminal reintroduces every defect, and it makes a comment inside a
block look safe to add back.

### Every block that reads a credential removes it again

A block that reads a secret into the shell -- the Supabase personal access
token, the database connection string, or a link or session token (step 9) --
**ends with `unset`**, and each
block that needs one reads it itself rather than inheriting it from an earlier
step. A credential left exported lives for the rest of the terminal session, and
a personal access token outranks `service_role`.

**Not yet true of steps 1 and 4**, recorded rather than implied: both pass
`$SUPABASE_ACCESS_TOKEN` straight into curl's arguments, where the process list
can show it, and neither says how the token is set or removed. They are open
items for the `scripts/` survey, not examples to copy.

### A stop condition and the action it gates never share a fence

**This was the most serious defect #18 fixed — more serious than the comments.**
Step 5's dry run is a stop condition: its `WOULD APPLY` lines must name exactly
the migration files not yet applied, or stop. Until 2026-09-14 it sat in the same block as the apply, so pasting that
block ran the apply immediately after the dry run, before anyone could read the
count. **The runbook declared a stop condition, and its own formatting defeated
it.**

**The rule, which is checkable:** a command whose output is a stop condition,
and a command that acts on the hosted project only if that condition passes, are
never in the same bash block.
- A block may still print its own verdict (`STOP`, `PASS`, `FAIL`), as step 2's
  probe and step 6's key guards do, **provided nothing after the verdict in that
  block changes hosted state.**
- Checked on 2026-09-14 against every stop condition in both runbooks: step P's
  `psql --version`, step 5's dry run, step 2's probe and step 6's two key guards
  all comply. Step 9's key guard, added later the same day, complies too: its
  only other command is a read-only GET, and the link request and the verify
  are separate blocks.

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

      **Re-read 2026-09-19, still enabled** (R-2026-09-18-17, R-2026-09-19-19):
      `gh api repos/Paddie-Health-Ltd/OpenBed-NG --jq .security_and_analysis`
      returned `secret_scanning_push_protection: enabled`, with
      `secret_scanning`, `secret_scanning_ai_detection` and
      `secret_scanning_non_provider_patterns` also `enabled`. A ruling that day
      proposed enabling it as a new step; this entry already recorded it done,
      and the API agreed (method note 19). **Enabled is not coverage** (method
      note 18): it has still never been observed blocking anything here.

- [ ] **OWED to the founder — which Supabase key formats push protection
      covers. A DOCUMENTATION check, never a push test** (R-2026-09-19-19 B3).
      From GitHub's list of supported secret-scanning patterns, record SEPARATELY
      for each of the two formats this project uses whether it is covered by
      push protection:
      1. the short-string keys, `sb_secret_…` and `sb_publishable_…`;
      2. the legacy service-role JWT.

      They may differ. Supabase's partner entry predates the short-string
      format, and Supabase's own API-keys documentation makes no scanning claim
      for it. Record what the list says, with the date read; do not infer one
      format's coverage from the other's.

      **Why not a push test.** A block would prove coverage, but a non-block
      proves nothing: partner patterns commonly check entropy or a checksum, so
      a fabricated key may pass for reasons unrelated to coverage. And the
      fabricated string then sits in a public repository's history needing
      removal. The documentation check is deterministic both ways and leaves no
      residue. A push test given on 2026-09-19 was WITHDRAWN by R-2026-09-19-19
      B4. If it was already run: a block stands as positive evidence and is
      recorded here; any other outcome, delete the branch it was pushed on and
      confirm `main` does not contain the string.

      The in-repository backstop for credential FILES is the location check in
      `scripts/lint_no_secrets.sh`, which reports after the push. It does not
      block, and it is not a substitute for this item.

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

      What CI actually defines:

      ```bash
      node -e "const y=require('js-yaml');const f=require('fs');\
      console.log(Object.keys(y.load(f.readFileSync('.github/workflows/ci.yml','utf8')).jobs).sort().join('\n'))"
      ```

      What `main` actually requires:

      ```bash
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

This prints the full project objects. Read region, status and Postgres version
off the output rather than through a field path this runbook guessed at.

```bash
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

- [x] Exposed schemas is exactly `public, graphql_public` — **discharged by probe,
      2026-09-13, project `klrlpxysjsjpdkeqdhvl`.** Not read off the dashboard:
      the live project states the list itself. Step 6 check (a) 1, under the
      publishable key, returned HTTP 406 with a `PGRST106` body carrying

      ```
      hint: "Only the following schemas are exposed: public, graphql_public"
      ```

      That hint is PostgREST reporting its own `db-schemas`, so it is the hosted
      setting, observed. Re-derive it by re-running step 6 check (a) 1 and
      reading the `hint` field.
- [x] `extra_search_path` does not include `app` — **DISCHARGED BY PROBE,
      2026-09-13, project `klrlpxysjsjpdkeqdhvl`.** The founder's run of the
      caller below printed, verbatim:

      ```
      db_extra_search_path = public, extensions
      PASS: app absent from db_extra_search_path
      ```

      **`public, extensions` is the Supabase default: nothing in this project
      ever set it.** So this PASS records an untouched default rather than a
      deliberate configuration, and a later change to that setting in the
      dashboard would not announce itself anywhere in this repository.

      How this box came to be discharged, kept because the wrong routes are
      tempting: the step 6 404s did not close it. PostgREST's configuration
      reference says of
      `db-extra-search-path`: *"These schemas tables, views and functions don't
      get API endpoints, they can only be referred from the database objects
      inside your db-schemas."* So a bare-name request (step 6 check (a) 2)
      returns 404 **whether or not** `app` is in that list — the five 404s on
      2026-09-13 look identical in both states and cannot discharge this box.
      The session `search_path` observed for `postgres` that day was
      `"$user", public, extensions`; that is a **different setting** and is
      recorded as context only, never as this checkbox's evidence.
      **The probe that does discriminate reads the setting itself, and the
      obvious way to run it is dangerous.** The setting is served by the
      Management API endpoint `GET /v1/projects/<ref>/postgrest`, which returns
      the **whole** PostgREST configuration. Per Supabase's own OpenAPI schema
      (`PostgrestConfigWithJWTSecretResponse`, read 2026-09-13) that response
      includes **`jwt_secret`**.

      > **⚠ NEVER RUN A BARE CURL AGAINST THAT ENDPOINT, AND NEVER PASTE ITS RAW
      > RESPONSE ANYWHERE** — not into a chat, a transcript, an issue, a PR, or a
      > terminal you will copy from. A JWT secret is a signing credential: treat
      > it exactly as the `service_role` key, because holding it can allow minting
      > tokens the project accepts. This is the 2026-09-09 incident — a bare
      > `api-keys` call dumped the `service_role` key into a session transcript
      > and forced a rotation — replayed at a different endpoint.
      >
      > - **The probe reads exactly ONE field, `db_extra_search_path`, and prints
      >   nothing else.** The filter lives inside a script, so the bare call is
      >   written nowhere in this repository's documentation — the same structural
      >   move as the publishable-key script in step 6, for the same reason.
      > - **Use `scripts/get_extra_search_path.sh`, and nothing else.** It
      >   selects the one field by name from a checked JSON object, prints that
      >   value or nothing, and reports every failure in its own words with a
      >   non-zero exit. The token goes to curl on stdin, never in argv.
      >   `tests/compliance/get_extra_search_path.test.ts` plants a canary in
      >   every other documented field — `jwt_secret` included — and asserts none
      >   reaches stdout or stderr. **Do not improvise the call by hand, and do not
      >   add the bare call to this document.**

      **The caller refuses an empty value before judging anything**, for the same
      reason step 6 refuses an empty key: a script that fails inside `$( )` leaves
      the variable empty and the shell carries on. The pass signal is named, never
      a negation.

      The first line waits silently for the token: paste it and press Enter.
      Never put it inline, where it would land in shell history. **The last line
      removes it from the shell.** A personal access token outranks
      `service_role`, and nothing after this block needs it.

      ```bash
      read -rs SUPABASE_ACCESS_TOKEN && export SUPABASE_ACCESS_TOKEN
      ESP="$(bash scripts/get_extra_search_path.sh)" || ESP=
      case "$ESP" in
        "") echo "STOP: no db_extra_search_path value. Read the script's own message above. Do not tick." ;;
        *)  norm=",${ESP:?no value -- refusing to judge},"
            norm="${norm//[[:space:]]/}"; norm="${norm//\"/}"
            echo "db_extra_search_path = $ESP"
            case "$norm" in
              *,app,*) echo "FAIL: app present in db_extra_search_path" ;;
              *)       echo "PASS: app absent from db_extra_search_path" ;;
            esac ;;
      esac
      unset SUPABASE_ACCESS_TOKEN
      ```

      Tick this box only on the line `PASS: app absent from db_extra_search_path`,
      and record it with the printed value and the date. **If the script refuses
      with `db_extra_search_path is present and EMPTY`**, an empty list cannot
      contain `app` — but it is refused because empty output is also what a broken
      filter produces, so record that message itself as the result rather than a
      PASS line. **Any other STOP: do not tick.**

      **THE FIRST RUN WAS A STOP CONDITION, AND IT PASSED ON 2026-09-13.** The
      script's fixture is taken from Supabase's documentation, not from a captured
      response — the exact setup under which `scripts/get_publishable_key.sh`,
      cited as the sanctioned method for four days, was wrong at the first pipe on
      its first execution. This time the documented shape matched the real
      response. What that does and does not confirm is recorded in the script's
      own header. **The rule stands for any future first run**, after a change to
      the script or to Supabase's API: if it exits non-zero, that is an assumption
      failing. Stop and report it as such. **Do not work around it** — no
      hand-written call, no edited filter, no bare curl against the endpoint.

**Covered by tests: partially, and only locally.** The control is three parts and
only two are automatable:

| Part | Where |
|---|---|
| A live anon request for `app` is refused with `PGRST106` | `tests/db/rls_anon_reachability.test.ts` — **local PostgREST only** |
| `supabase/config.toml` `[api] schemas` excludes `app` | `tests/db/config_drift.test.ts` — static |
| The **hosted** setting excludes `app` | **Recorded probe results, 2026-09-13:** the live `PGRST106` hint, `Only the following schemas are exposed: public, graphql_public`; and `scripts/get_extra_search_path.sh` reading `db_extra_search_path = public, extensions`, the untouched Supabase default (both above). Hand probes, not tests |

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
The hosted setting is a dashboard value with no in-database representation.
Supabase can upgrade hosted auth at any time and without notice, while the CLI
pins the local version. On 2026-09-14 hosted reported the same v2.196.0 (step 9).
That is a snapshot the next hosted upgrade silently invalidates, and it says
nothing about the hosted session-bound **values**, which remain this step's.

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


## 4b. STOP — before the FIRST facility or ward-account row exists

**Three defects must be fixed before the first `app.facility` row or the first
`app.ward_account` row is created on THIS hosted project** — whatever the reason
for creating it: a test, a staging trial, a signed agreement or no agreement at
all (R-2026-09-21-45).

**The trigger is the ROW, not the occasion.** Onboarding can be staged, and an
account created "just to try it" puts all three live before anyone intends it.
**They are unreachable only while those two tables are empty, and that is the
whole of their safety.** Read on this project **2026-09-21 16:58 UTC:
`app.facility` 0, `app.ward_account` 0.**

| # | Defect | Why it matters | Where |
|---|---|---|---|
| 1 | `'(unknown facility)'` is rendered beside a **real** bed count when a ward references a facility absent from the payload | a count with no callable identity, rendered as if actionable — it tells someone routing an ambulance that beds exist somewhere they cannot ring | `apps/public-dashboard/src/main.ts` |
| 2 | `wardRowFrom` **defaults** a clinical claim (`offering ?? 'NOT_OFFERED'`) and a concurrency token (`version ?? 0`, which becomes `p_expected_version`) | asserts to a ward something the server never said, and turns optimistic concurrency into a guess. Refuse the malformed row instead | `apps/ward-console/src/main.ts` |
| 3 | the publish screen echoes **raw server text** to a ward user on an unrecognised status (R-2026-09-20-30 D1) | a clinical user mid-emergency should not be reading a database error, and server text can carry internals. Same screen as 2 | `apps/ward-console/src/main.ts` |

**A fourth item gates the same moment and is SPECIFIED BUT NOT BUILT:** the invite
gate — no invite for a facility whose `app.facility_contact.agreement_accepted_at`
is null. The column exists (migration 003); **nothing reads it**, and there is no
invite-issuing function anywhere, so this is an absence rather than a defect.
Named here because it gates this same moment.

**HOW TO CHECK THE CONDITION, rather than remembering it.** Connect as step P
says, then:

**Step P's PATH line is carried in below**, because this block calls `psql` itself.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
psql "$DATABASE_URL" -tAc "select (select count(*) from app.facility) as facility, (select count(*) from app.ward_account) as ward_account"
```

**Stop condition:** `0|0`. **Anything else means the gate has already passed and
the three defects above are LIVE**, not pending — report that rather than
continuing.

**BOTH READINGS OF THIS CHECK ARE DEMONSTRATED** (method note 23 — a probe nobody
has seen fail is not evidence). Pasted into `zsh -f -i`, 2026-09-21:

- **against this hosted project: `0|0`** — the passing reading;
- **against a local development database: `8|0`** — the failing reading, because
  `database/seed/001_synthetic_seed.sql` inserts synthetic facilities on every
  `npm run db:reset`.

**That second reading is also why this stays a human step rather than becoming a
script that refuses.** A guard keyed on "a facility row exists" fires on every
local reset and is removed by the next person who hits it. Any mechanical version
must test the HOST first — see R-2026-09-21-45.

> **THIS IS A NAMED HUMAN STEP. Nothing enforces it.** No script reads the list
> above and none is cited here, because none exists (Clause 4). A mechanical
> guard is proposed and deliberately not built — see R-2026-09-21-45. Note that
> `scripts/provision_ward_account.mjs`, the only sanctioned way to create a ward
> account, **has no host check at all**: pointing it at this project is one
> environment variable. Its header carries this same block.

**Why this section sits beside the backups one.** Section 4 exists because some
things must be true *before any real data exists*, and after that it is too late.
This is the same shape: after the first row, these three stop being theoretical.

---


## 5. Apply migrations  *(was §3)*

**Two blocks, run separately, because the dry run is a stop condition and the
apply must not follow it until you have read the count.** Until 2026-09-14 both
commands sat in one block, so pasting it ran the apply straight after the dry run
and the stop condition could not be honoured by anyone who pasted the block.

Each block's first line waits silently for the connection string: paste it and
press Enter. Use `read -rs`, not an inline `export DATABASE_URL='...'` -- the
connection string carries the hosted database password and an inline export
writes it into your shell history. **Each block's last line removes it from the
shell again.**

The dry run. **Stop condition: the `WOULD APPLY` lines name exactly the migration
files this project has not yet received -- no more, no fewer.**

**Step P's PATH line is carried in below**, because `scripts/run_migrations.sh` calls `psql`.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
read -rs DATABASE_URL && export DATABASE_URL
bash scripts/run_migrations.sh --dry-run
unset DATABASE_URL
```

**An error naming a database with a leading or trailing space -- `psql: database
"postgres " does not exist` -- is a stray character in the pasted connection
string, not a missing database.** `read -rs` hides what you paste, by design, so a
trailing space is invisible and will recur. Re-paste the string; do not
investigate the project. Observed on hosted 2026-09-17, on the first dry run of
017's apply (R-2026-09-17-01).

**What held on that run is the reason this is recorded, not the typo.**
`scripts/run_migrations.sh` refused to report ANY migration count over the failed
connection: it printed psql's error and "NO MIGRATION COUNT IS REPORTED", and
exited 3. A count over a dead connection is indistinguishable from one taken
against a virgin database, and that count is this step's stop condition. That is
`.claude/rules/test-conventions.md`'s "a check that could not run must never report
a verdict" firing on a real hosted apply -- the first time, per R-2026-09-17-01.
The refusal was added on 2026-09-12 (commit 4b75f43), after the same script
printed `13 migration(s) pending.` against a host that did not resolve.

**The dry run is a stop condition, not a look.** A dry run without a stated
expectation is just output. The expectation is stated as **files, not a count**:
a count moves every time a migration is added, and a stop condition that reads
wrong on a correct run teaches whoever runs it to ignore stop conditions. Until
2026-09-14 this read `exactly 13 migration(s) pending.`, and migration 014 made
that wrong.

- **The hosted project today** holds 001 through 019 (see step 7), and the
  repository holds nothing newer. Every file up to and including
  `019_snapshot_single_read_and_mirror_integrity.sql` must read `already applied`;
  there must be no `WOULD APPLY` line; and the dry run must end
  `0 migration(s) pending.`
- **Restated 2026-09-23 (R-2026-09-23-69), in the change that records 019's hosted
  apply.** Until then this expected 001 through 018, exactly one `WOULD APPLY` line
  naming `019_snapshot_single_read_and_mirror_integrity.sql`, and
  `1 migration(s) pending.` The founder's dry run printed exactly that on
  2026-09-23, and the apply that followed took the ledger to 19.
- **Restated 2026-09-23 (R-2026-09-23-66), in the change that ADDS 019** -- the
  change the rule at the top of this list asks for. Until then this expected no
  `WOULD APPLY` line and `0 migration(s) pending.`, which was right while the
  repository and hosted both ended at 018.
- **Restated 2026-09-22 (R-2026-09-22-52), in the change that records 018's hosted
  apply.** Until then this expected 001 through 017, exactly one `WOULD APPLY` line
  naming `018_close_mirror_read_and_push_surfaces.sql`, and `1 migration(s) pending.`
  The founder's dry run printed exactly that, and the apply that followed it at
  **2026-09-22 05:40:40 UTC** is where the accumulation boundary closed. This is the
  first restatement of this list made by the change the rule actually asks for --
  the one that records the apply -- rather than by a change catching up afterwards.
- **Restated 2026-09-21 (R-2026-09-21-50), in the change that PRECEDES 018's
  hosted apply — and it should have been restated in the change that ADDED 018.**
  Until then this expected no `WOULD APPLY` line and `0 migration(s) pending.`,
  which was right while the repository ended at 017. **#61 merged migration 018
  and left this list alone**, so between that merge and this change the document
  said a correct dry run must print nothing pending, while a correct dry run
  printed 018. That is the failure the last bullet of this list exists to
  prevent, and it happened anyway — which is why
  `tests/compliance/runbook_migration_expectation.test.ts` now derives this
  expectation from the migrations directory instead of trusting anyone to
  remember.
- **Restated 2026-09-17 (R-2026-09-17-01), in the change that records 017's
  apply.** Until then this expected exactly one `WOULD APPLY` line,
  `017_snapshot_schedule.sql`, and `1 migration(s) pending.` The founder's run
  printed exactly that and applied it.
- **Restated 2026-09-16 (R-2026-09-16-09), in the change that adds 017.** Until
  then this expected no `WOULD APPLY` line and `0 migration(s) pending.`, which was
  right for a project at 016 while the repository also ended at 016.
- **Restated 2026-09-16 (R-2026-09-16-02).** Until that day this expected three
  `WOULD APPLY` lines -- `014_publish_ward_status.sql`,
  `015_ward_status_history_text_category.sql`, `016_snapshot.sql` -- and
  `3 migration(s) pending.` The founder's run printed exactly those three, in
  that order, and applied them. Left as it was, the expectation would now read
  wrong on a correct run, which is the failure this section is about.
- **Any `WOULD APPLY` line AT ALL, or any count other than
  `0 migration(s) pending.`: stop and report.** A file pending means either a
  migration reached the repository after the list was last restated, or hosted is
  not where this document says it is.
  - *Restated 2026-09-23 (R-2026-09-23-69), in the change that records 019's hosted
    apply. Until then this bullet read "Any `WOULD APPLY` line OTHER than the one
    named above, or any count other than `1 migration(s) pending.`", which was right
    from 019's merge until the apply.*
  - *Restated 2026-09-23 (R-2026-09-23-66), in the change that adds 019. Until then
    this bullet read "Any `WOULD APPLY` line AT ALL, or any count other than
    `0 migration(s) pending.`", which was right while the repository ended at 018.*
  - *Restated 2026-09-22 (R-2026-09-22-52), in the change that records 018's hosted
    apply. Until then this bullet read "Any `WOULD APPLY` line OTHER than the one
    named above, or any count other than `1 migration(s) pending.`", which was right
    from #62's merge until the apply. The count is spelled out here rather than
    deferred to "the one stated" so this bullet reads alone, and so
    `tests/compliance/runbook_migration_expectation.test.ts` can parse it.*
  - *Restated 2026-09-21 (R-2026-09-21-51). Until then this bullet read "Any
    `WOULD APPLY` line at all, or any count other than zero", which was right while
    the repository ended at 017 and **contradicted the first bullet of this list
    from the moment 018 was named there.** It was missed by the change that
    restated the rest of the list — the same defect, in the change written to fix
    it. The count is spelled out here rather than deferred to "the one stated" so
    this bullet reads alone, and so
    `tests/compliance/runbook_migration_expectation.test.ts` can parse it and
    assert all three statements of the expectation agree.*
- **When a migration is added,** this list is restated in the same change that
  adds it, never in a follow-up: in between, the document would be wrong.

#### THE RESTATE RULE, AND IT GOVERNS MORE THAN THIS LIST (R-2026-09-21-50)

**Every section of either runbook that states an expected HOSTED state a migration
can change is restated in the change that ADDS the migration, never in a
follow-up.** Both runbooks: this one and `docs/runbook-cloudflare-pages-beds-json.md`.

The sections that carry it today are marked with a pointer back here:

| Section | What it expects that a migration can falsify |
|---|---|
| §5, the list above | which files are pending, and the pending count |
| §6 | whether the publishable key can read the three mirrors |
| §10 | which tables are in `supabase_realtime` |
| §7 | which migrations hosted holds |

**Why it is being widened now.** The rule above already existed and was scoped to
"this list". §6 and §10 had no such rule — and migration 018, merged in #61,
falsified both of them while §5 was the only section anyone thought to check.
**A rule that covers one instance of a class teaches everyone that the rest of the
class is fine.**

**NOT ASSERTED BY ANY SCRIPT, and it cannot be** (Clause 4 route 2 — a named human
step, no cited artefact). §6's and §10's expectations are readings taken against the
hosted project; nothing inside this repository can derive them, and a test claiming
to check them would be the phantom enforcement Clause 4 forbids. §5's expectation
IS derivable, and is now derived —
`tests/compliance/runbook_migration_expectation.test.ts`. **One of the four is
mechanical and three are human. Do not read the guard as covering the table.**

**The mechanical half that does reach all four** is the pull-request template:
`.github/PULL_REQUEST_TEMPLATE.md` asks every change touching
`database/migrations/` which runbook expectations it changes, and "none" has to
carry a reason. A template cannot force an answer; it puts the question where it
will be read.

### Before applying 017: pg_cron must be available to the database

**Why (R-2026-09-16-07).** `017_snapshot_schedule.sql` runs `CREATE EXTENSION IF
NOT EXISTS pg_cron`. pg_cron only loads if it is in `shared_preload_libraries`,
and whether the hosted project offers it is a platform fact the repository cannot
assert. Locally it is preloaded, 1.6.4, not installed (observed 2026-09-16). If
hosted does not offer it, the apply fails inside 017's transaction and nothing of
017 commits -- safe, but the fix is founder-side and belongs before the apply.

This block only reads. The first line waits silently for the connection string;
the last removes it.

**Step P's PATH line is carried in below**, because this block calls `psql` itself.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
read -rs DATABASE_URL && export DATABASE_URL
psql "$DATABASE_URL" -Atc "select name || ' default=' || default_version || ' installed=' || coalesce(installed_version, 'none') from pg_available_extensions where name = 'pg_cron'"
psql "$DATABASE_URL" -Atc "select 'preloaded=' || (current_setting('shared_preload_libraries') like '%pg_cron%')"
unset DATABASE_URL
```

- **PASS:** a `pg_cron default=... installed=...` line, and `preloaded=true`.
  `installed=none` is expected before the apply.
- **No `pg_cron` line, or `preloaded=false`: stop.** Enabling the extension is a
  dashboard action and is the founder's. Do not run the apply until this read
  passes.

- [x] pg_cron available on hosted before 017's apply, 2026-09-17: `pg_cron default=1.6.4 installed=none` and `preloaded=true`. Hosted pg_cron 1.6.4 matches the local 1.6.4 the Bundle 0 probes ran against.

Only after reading those lines, the apply:

**Step P's PATH line is carried in below**, because `scripts/run_migrations.sh` calls `psql`.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
read -rs DATABASE_URL && export DATABASE_URL
bash scripts/run_migrations.sh
unset DATABASE_URL
```

### After the apply: PostgREST must be serving 015's signature, not a cached one

**Why this exists (ruling R-2026-09-15-02).** PostgREST caches the schema, and 015
drops `ward_status_history` and recreates it with a `text` parameter. Supabase's
DDL event trigger should make PostgREST reload, and "should" is how a
production-only failure gets written. So the reload is sent explicitly, then the
answer is probed. No session is needed, which is the point: a ward session cannot
exist before onboarding (B1 in
`Sprint Kickoffs/decision-2026-09-14-public-private-split.md`).

**The mechanism, observed 2026-09-15 on the local stack (PostgREST 16.2, Supabase
CLI 2.117.0) with the local anon key.** Both answers are HTTP 401 with code
`42501`; they differ in the object they name.
- **A fresh cache** resolves the `text` signature, calls the function, and the
  grant refuses anon: `permission denied for function ward_status_history`.
- **A stale cache** still holds 011's `app.ward_category` signature, casts to it,
  and fails on the schema: `permission denied for schema app`. Planted by applying
  015 with the DDL event triggers suppressed (`session_replication_role =
  replica`) after a reload in 011's state.

**The fresh-cache string is now observed hosted.** The founder ran this step's
blocks against `klrlpxysjsjpdkeqdhvl` on 2026-09-16, after the apply of 014-016,
with the key this step's own block obtains, and the probe answered PASS on
`permission denied for function ward_status_history`. **The stale-cache string
has still never been seen hosted** -- it was planted locally. Both
strings are vendor prose, which changes. That is why the probe below passes on
one exact string only. **An answer matching NEITHER string is a FAILURE, never a
pass**: a probe that passes once it stops understanding the answer is vacuous.

The reload. The first line waits silently for the connection string; the last
removes it.

**Step P's PATH line is carried in below**, because this block calls `psql` itself.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
read -rs DATABASE_URL && export DATABASE_URL
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "notify pgrst, 'reload schema'"
unset DATABASE_URL
```

Wait a few seconds, then take the key exactly as step 6 does:

```bash
KEY="$(bash scripts/get_publishable_key.sh)" || KEY=
case "$KEY" in
  sb_publishable_?*) echo "key obtained" ;;
  *) echo "STOP: no usable publishable key. Do not run the probe -- its answer now means nothing."; KEY= ;;
esac
```

The probe. It prints a verdict, not the body:

```bash
BODY="$(curl -s --max-time 12 -X POST "https://klrlpxysjsjpdkeqdhvl.supabase.co/rest/v1/rpc/ward_status_history" -H "apikey: ${KEY:?no key -- refusing to probe}" -H "Content-Type: application/json" -d '{"p_category":"ICU_ADULT"}')" || BODY=
case "$BODY" in
  *'"permission denied for function ward_status_history"'*) echo "PASS: PostgREST resolved the text signature and the grant refused anon" ;;
  *'"permission denied for schema app"'*) echo "STOP: stale schema cache -- send the reload again, wait, and re-probe" ;;
  *) echo "FAIL: the answer matches neither observed message -- the probe no longer understands it" ;;
esac
unset KEY BODY
```

- **PASS:** tick the box below.
- **STOP:** run the reload block again, wait, and re-run the probe. A second STOP
  is reported, not retried a third time.
- **FAIL:** stop and report. Do not tick. Do not rewrite the expected string to
  match what came back without a new observation of both states.

- [x] Post-apply probe, 2026-09-16: **PASS**, matching the fresh-cache string `permission denied for function ward_status_history`
- [x] Post-apply probe after 017, 2026-09-17: reload NOTIFY sent, **PASS** on the same fresh-cache string

### After the apply: who owns the SECURITY DEFINER writers

**Why (R-2026-09-15-08, H2).** `app.project_facility` (008) and
`app.regenerate_snapshot()` (016) run as their OWNER, so the owner's role
attributes decide whether their reads and writes on the FORCE-RLS mirrors bypass
RLS. Hosted `postgres` holds `rolbypassrls t` (observed 2026-09-15). **The owner
was observed on 2026-09-16: both functions are owned by `postgres`,** the role
that applies the migrations, which closes H2 in full (R-2026-09-16-02). The read
below is kept as the check every future apply runs.

**From 017 on it reads THREE functions.** 017 gives `app.refresh_lga_rollup()`
(009) a scheduled caller and `row_security = off`, so its owner matters in the
same way: the job runs it as `postgres`, and an owner without BYPASSRLS would make
every refresh raise.

The first line waits silently for the connection string; the last removes it.

**Step P's PATH line is carried in below**, because this block calls `psql` itself.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
read -rs DATABASE_URL && export DATABASE_URL
psql "$DATABASE_URL" -Atc "select proname || ' owner=' || pg_get_userbyid(proowner) from pg_proc where proname in ('project_facility', 'refresh_lga_rollup', 'regenerate_snapshot') order by proname"
unset DATABASE_URL
```

- **PASS:** exactly three lines, `project_facility owner=postgres`,
  `refresh_lga_rollup owner=postgres` and `regenerate_snapshot owner=postgres`.
  Record them with the date. Recorded 2026-09-16, before 017, with the two lines
  that query then read.
- **Any other owner, or fewer lines: stop and report.** Do not change ownership
  by hand; a different owner changes what `row_security = off` and the FORCE RLS
  tables mean for all three functions.

- [x] Owners read, 2026-09-16: `project_facility owner=postgres` and `regenerate_snapshot owner=postgres`
- [x] Owners read after 017, 2026-09-17, three lines: `project_facility owner=postgres`, `refresh_lga_rollup owner=postgres`, `regenerate_snapshot owner=postgres`

### After the apply: the reader policy is actually there

**Why this exists (R-2026-09-16-02).** 016 creates `public.snapshot_current`'s one
reader policy inside a `pg_policies`-guarded `DO` block, so psql echoes `DO`
whether the block created the policy or found one already there. **The apply's own
output cannot witness the policy.** Nor would an ordinary read notice its absence:
`service_role` holds `rolbypassrls t` on hosted, so it returns the rows either
way, and a missing policy would surface only at the platform change the policy
exists to survive -- the restore or upgrade that clears that attribute. So the
policy is read directly.

This block only reads. The first line waits silently for the connection string;
the last removes it.

**Step P's PATH line is carried in below**, because this block calls `psql` itself.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
read -rs DATABASE_URL && export DATABASE_URL
psql "$DATABASE_URL" -Atc "select policyname || ' | ' || cmd || ' | permissive=' || permissive || ' | roles=' || roles::text || ' | qual=' || coalesce(qual,'(null)') || ' | with_check=' || coalesce(with_check,'(null)') from pg_policies where schemaname = 'public' and tablename = 'snapshot_current' order by policyname"
psql "$DATABASE_URL" -Atc "select relrowsecurity || ' ' || relforcerowsecurity from pg_class where oid = 'public.snapshot_current'::regclass"
unset DATABASE_URL
```

**PASS: exactly one policy row, and exactly these two lines.**

```
snapshot_current_service_role_select | SELECT | permissive=PERMISSIVE | roles={service_role} | qual=true | with_check=(null)
true true
```

**It is `true true`, not `t t`, and that is not a typo.** `relrowsecurity` and
`relforcerowsecurity` are `boolean`, and concatenating a boolean into text renders
`true` or `false`. `t` and `f` are only psql's column DISPLAY form, which `-Atc`
with `||` never produces. The first draft of this step's ruling expected `t t`;
the run printed `true true`. A stop condition that reads wrong on a correct run
teaches whoever runs it to ignore stop conditions -- the same reason this step
expresses the dry run as files rather than as a count.

**Stop and report on anything else:** zero rows, more than one policy, or any
difference in the name, the command, the role, the qualifier or the check.
**Never create or alter the policy by hand.** Hosted would then carry a policy no
migration produced, out of step with `database/migrations/016_snapshot.sql` and
with `tests/db/snapshot.test.ts`, which asserts this exact shape on every run.

- [x] Reader policy read, 2026-09-16: one row, `snapshot_current_service_role_select | SELECT | permissive=PERMISSIVE | roles={service_role} | qual=true | with_check=(null)`, and `true true`
- [x] Reader policy read after 017, 2026-09-17: unchanged and exact -- the same one row and `true true`

### After the apply of 017: the two jobs are scheduled, active, and running

**Why (R-2026-09-16-10).** The repository cannot prove the hosted jobs are live.
`tests/db/snapshot_schedule_state.test.ts` asserts what 017 PRODUCES, from a
rolled-back re-application, and the db test run deliberately pauses both jobs so
they cannot write mid-test. A green suite is therefore not a live-schedule
guarantee. This step is where "active on hosted" is observed. **On hosted the jobs
must NOT be paused**; nothing here pauses them.

This block only reads. The first line waits silently for the connection string;
the last removes it.

**Step P's PATH line is carried in below**, because this block calls `psql` itself.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
read -rs DATABASE_URL && export DATABASE_URL
psql "$DATABASE_URL" -Atc "select jobname || ' | ' || schedule || ' | ' || command || ' | ' || username || ' | active=' || active from cron.job where jobname like 'openbed_%' order by jobname"
psql "$DATABASE_URL" -Atc "select proname || ' ' || array_to_string(proconfig, ',') from pg_proc where proname = 'refresh_lga_rollup'"
unset DATABASE_URL
```

**PASS: exactly these three lines.**

```
openbed_refresh_lga_rollup | */5 * * * * | select app.refresh_lga_rollup() | postgres | active=true
openbed_regenerate_snapshot | * * * * * | select app.regenerate_snapshot() | postgres | active=true
refresh_lga_rollup search_path="",row_security=off
```

Then **wait at least five minutes**, so both jobs have had a tick, and read the
runs. This block only reads.

**Step P's PATH line is carried in below**, because this block calls `psql` itself.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
read -rs DATABASE_URL && export DATABASE_URL
psql "$DATABASE_URL" -Atc "select j.jobname || ' ' || d.status || ' ' || count(*) from cron.job_run_details d join cron.job j using (jobid) where j.jobname like 'openbed_%' group by j.jobname, d.status order by 1"
unset DATABASE_URL
```

- **PASS:** a `succeeded` line for BOTH jobs, and no `failed` line. Each line is
  the job, the status and a run count, e.g. `openbed_regenerate_snapshot succeeded 5`.
- **A `failed` line for `openbed_refresh_lga_rollup` alone, once, beside
  `succeeded` lines,** can be a lost race with another refresh: two overlapping
  refreshes make the second fail on the primary key and leave correct rows (observed
  locally 2026-09-16, and recorded in 017's header). Read again after the next
  tick; a second `failed` is stopped and reported.
- **Anything else -- a missing job, `active=false`, another role, a different
  schedule or command, no `succeeded` line: stop and report.** Do not reschedule
  or alter a job by hand; hosted would then run a schedule no migration produced.

- [x] 017's jobs read on hosted, 2026-09-17: `openbed_refresh_lga_rollup | */5 * * * * | select app.refresh_lga_rollup() | postgres | active=true`, `openbed_regenerate_snapshot | * * * * * | select app.regenerate_snapshot() | postgres | active=true`, `refresh_lga_rollup search_path="",row_security=off`; runs `openbed_refresh_lga_rollup succeeded 3` and `openbed_regenerate_snapshot succeeded 13`, no `failed` line (consistent with five-minute and one-minute cadences over about thirteen minutes)

### After the apply: record the frozen boundary in the repository

**Why (R-2026-09-16-03).** A migration recorded in hosted's `app.schema_migrations`
has already run there, and editing the file afterwards makes this repository
disagree with the database **silently** -- the ledger still holds the filename and
the schema still holds the old shape. The rule is therefore a criterion, not a
range: **frozen once ledgered.** `database/migrations/applied-hosted.json` is the
one place the range lives, and `tests/compliance/frozen_migrations.test.ts` reds
when a frozen file's bytes change.

**That file cannot see hosted, so this step is what keeps it true.** Run it with
the ledger count read in the block above -- not with a number from memory. The
recorder refuses if that count and the repository's forward migrations disagree.

### 018's apply CLOSED the boundary — 2026-09-22 05:40:40 UTC

**DISCHARGED, founder-side (method note 13; R-2026-09-19-24 B5), recorded by
R-2026-09-22-52.** Hosted holds 001-018. Migration 018 removed the three public
mirrors from the `supabase_realtime` publication and revoked `SELECT` on them from
`anon` and `authenticated` — the founder's decision of 2026-09-19, answering
R-2026-09-17-09 D.

**THE ACCUMULATION BOUNDARY CLOSED ON HOSTED AT 2026-09-22 05:40:40 UTC**, the
timestamp of the apply run itself, read `date -u` in the same session. Block B was
taken minutes before it and block E minutes after it, on the same project; both
readings are below, and each is the other's failing half.

**From that moment the history-is-private commitment is available to a facility
agreement** — subject to one condition and no others: the use rule on
`018_close_mirror_read_and_push_surfaces.down.sql`, immediately below. While that
reversal is applied to the hosted project the commitment is false, and no agreement
may carry it.

*Restated 2026-09-22 (R-2026-09-22-52), in the change that records the apply.* Until
then this block read *"Hosted holds 001-017; 018 is merged and NOT applied"* and
*"until this apply is recorded, the history-is-private commitment is NOT available,
whatever any pull request's state"*. **The distinction it was written to hold did
hold**: a merged migration changes this repository and not the database a facility's
data sits in, and the commitment opened on the apply rather than on #61's merge.

#### B. BEFORE THE APPLY — take the reading 018 is about to change

**This is the failing half of everything in the post-apply block, and it is only
available now.** Method note 23: a probe nobody has seen give the other answer is
not evidence. After the apply, §6 expects a refusal and §10 expects an empty
publication; run both NOW, while the correct answer is still the opposite one, and
paste the output. The same two probes, opposite verdicts, minutes apart, on one
project.

**Do not skip this because the answer is already known.** Knowing it is not the
same as having recorded it, and after the apply it cannot be taken again.

**This block takes the key itself.** It is the same guard step 6 uses, and it is
here rather than pointed at, because this document's own rule is that *each block
that needs a credential reads it itself rather than inheriting it from an earlier
step*. The `case` arm is what makes the refusals below mean something: a script
that fails inside `$( )` leaves `KEY` empty and the shell carries on, and every
probe then returns 401 — which reads as "the boundary held".

```bash
KEY="$(bash scripts/get_publishable_key.sh)" || KEY=
case "$KEY" in
  sb_publishable_?*) echo "key obtained" ;;
  *) echo "STOP: no usable publishable key. Do not run the probe -- a 200 or a 401 now means nothing."; KEY= ;;
esac
SUPABASE_URL="https://klrlpxysjsjpdkeqdhvl.supabase.co"
for t in facility_public ward_public lga_rollup; do
  printf '== %s READ  ' "$t"
  curl -s -o /dev/null -w 'HTTP %{http_code}\n' "$SUPABASE_URL/rest/v1/$t?select=*&limit=1" \
    -H "apikey: ${KEY:?no key -- refusing to probe}"
done
unset KEY SUPABASE_URL
```

The publication half. The first line waits silently for the connection string; the
last removes it from the shell.

**Step P's PATH line is carried in below**, because this block calls `psql` itself.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
read -rs DATABASE_URL && export DATABASE_URL
psql "$DATABASE_URL" -c "select coalesce(string_agg(tablename, ', ' order by tablename), '(empty)') as published from pg_publication_tables where pubname = 'supabase_realtime';"
unset DATABASE_URL
```

**Expected BEFORE the apply** — MEASURED on `klrlpxysjsjpdkeqdhvl`, 2026-09-21:

- all three reads `HTTP 200`;
- `published` reads `facility_public, lga_rollup, ward_public`.

**If either already shows the post-018 answer, STOP.** It means 018 has been applied
already, or something else revoked those grants, and the apply below is not the
change you think it is.

- [x] Pre-apply reading taken and pasted, 2026-09-22, founder's run on `klrlpxysjsjpdkeqdhvl` (R-2026-09-22-52): `facility_public`, `ward_public` and `lga_rollup` each `HTTP 200`; `published` read `facility_public, lga_rollup, ward_public`; ledger `17`; the dry run printed exactly one `WOULD APPLY` line, `018_close_mirror_read_and_push_surfaces.sql`, and `1 migration(s) pending.` **Neither half showed the post-018 answer, so the apply below was the change it was thought to be.**

Apply it through this step like any other, then record the boundary below.

#### STOP — `018_close_mirror_read_and_push_surfaces.down.sql` is never applied here on anyone's own authority

**018 ships a full symmetric reversal, and applying it to the HOSTED project
re-opens the boundary this step closes.** It restores `SELECT` on
`public.facility_public`, `public.ward_public` and `public.lga_rollup` to `anon`
and `authenticated`, and puts all three back into the `supabase_realtime`
publication. The published key is in the browser bundle, so that is every visitor.

`ward_public` carries per-ward bed counts and their update times. A caller who can
poll it can accumulate the history this project does not publish, which is the
whole reason Sprint A1 exists.

- **The condition:** the hosted reversal is applied only under a founder ruling
  that names the reason. Not to unblock a deploy, not to make a test pass, not
  because a later migration failed and this looked like the way back.
- **While it is applied, no facility agreement may carry a history-is-private
  commitment.** If one already has been signed, the reversal is not available at
  all until that is resolved — the commitment is about the hosted database, and
  this makes it false.
- **Locally it is ordinary.** `tests/db/migration_018_round_trip.test.ts` applies
  it and puts it back on every run. The rule above is about the hosted project and
  nothing else.

**Nothing enforces this and nothing can** — a reversal is applied by a person with
a database URL, and no check inside this repository sits between them and `psql`.
The same paragraph is in the down file's own header, so it is met whether someone
arrives here or opens that file first.

#### E. AFTER THE APPLY — the 018 read-back

**Four items. Each states its PASS, its stop condition, and its failing half.**
Items 1 and 2 have theirs from block B above, taken minutes earlier on this same
project; items 3 and 4 carry their own.

**The first line asks for the apply time** — the timestamp of the run you just
did, UTC, e.g. `2026-09-21 21:05:00+00`. Item 3 needs it, and it is read in this
block rather than assumed from an earlier one.

**Step P's PATH line is carried in below**, because this block calls `psql` itself.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
printf 'apply time (UTC, e.g. 2026-09-21 21:05:00+00): '; read -r APPLY_TS
read -rs DATABASE_URL && export DATABASE_URL
psql "$DATABASE_URL" -v apply_ts="$APPLY_TS" <<'SQL'
select r.rolname, c.relname,
       has_table_privilege(r.rolname, 'public.' || c.relname, 'SELECT') as can_select
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) as r(rolname)
 where n.nspname = 'public'
   and c.relname in ('facility_public', 'ward_public', 'lga_rollup')
 order by r.rolname, c.relname;

select count(*) as snapshot_rows_visible_to_service_role
  from public.snapshot_current;

select j.jobname,
       count(*) filter (where d.status = 'succeeded')                      as succeeded_after_apply,
       count(*) filter (where d.status = 'failed')                         as failed_after_apply,
       count(*) filter (where d.status not in ('succeeded', 'failed'))     as in_flight,
       max(d.start_time)                                                   as last_start
  from cron.job j
  left join cron.job_run_details d
    on d.jobid = j.jobid
   and d.start_time > :'apply_ts'::timestamptz
 where j.jobname in ('openbed_refresh_lga_rollup', 'openbed_regenerate_snapshot')
 group by j.jobname order by j.jobname;

begin;
set local role anon;
select count(*) as anon_can_read_snapshot from public.snapshot_current;
rollback;
SQL
unset DATABASE_URL APPLY_TS
```

**1. Neither client role can read a mirror.** PASS: `can_select` is `f` on all
**six** rows. **Stop condition:** any `t`. *Failing half: block B, where all three
reads returned 200 — the grant was there and is now gone.*

**2. The served path still works, and `anon` still cannot reach it.** PASS:
`snapshot_rows_visible_to_service_role` is greater than 0, **and the last statement
fails with `ERROR: permission denied for table snapshot_current`.** **Stop
condition:** 0 rows, or that last statement RETURNING A COUNT instead of erroring.

*The failing half is in the block, not claimed for it.* The error is the
demonstration: `snapshot_current` is service-role-only, so the same query that
succeeds for the connecting role must fail for `anon`. **The connecting role is
`postgres`, which is a member of `anon`** — `pg_has_role('postgres','anon','MEMBER')`
is `t` locally and on hosted — so `set local role anon` is available to it, and
verified locally before this block was written. The `rollback` still runs after the
aborted transaction, which is why the probe is last.

**3. The SECURITY DEFINER premise holds LIVE — this is the item that would catch a
real mistake.** 018 was written on the reasoning that every writer of the mirrors is
a `SECURITY DEFINER` function and so is unaffected by a revoke on `anon` and
`authenticated`. That is an argument until a job runs.

PASS: for **both** jobs, `succeeded_after_apply` is 1 or more and
`failed_after_apply` is 0. **Stop condition:** any `failed_after_apply` above 0, or
a `succeeded_after_apply` of 0 for either job six minutes after the apply — the
rollup runs every five minutes and the snapshot every minute.

- **`in_flight` is NOT a failure and is why it has its own column.** pg_cron writes
  six status values — `starting`, `running`, `sending`, `connecting`, `succeeded`,
  `failed` (`GetCronStatus` in `src/job_metadata.c`, pg_cron **v1.6.4**, the version
  this project runs). **Four of the six are non-terminal**, so at a one-minute
  cadence a run in flight at the moment you read is ordinary. An earlier draft of
  this step counted `status <> 'succeeded'` as failure and would have stopped the
  founder on a healthy system.
- **One `failed` on `openbed_refresh_lga_rollup` alone, beside succeeded runs, may
  be the documented lost race** — two overlapping refreshes make the second fail on
  the primary key and leave correct rows (recorded in 017's header, and in the jobs
  step above). Read again after the next tick; **a second `failed` is stopped and
  reported.** Any `failed` on `openbed_regenerate_snapshot` stops at the first.
- **Only runs AFTER the apply count.** The filter is on `start_time`, so the
  thousands of healthy runs before it neither mask a new failure nor supply a pass.

**4. The public path is unchanged, end to end.**

```bash
curl -sS -o /dev/null -D - https://openbed.ng/beds.json | grep -i -E '^HTTP|^content-type|^x-openbed-edge-cache|^cf-ray'
curl -sS https://openbed.ng/version.json
```

PASS: `HTTP/2 200`, `content-type: application/json; charset=utf-8`, and
`/version.json` quoted in the report. **Stop condition:** anything else — in
particular a body beginning `{"error":`. **018 must be invisible from the outside;
that is the claim.** *Failing half: section 6 of the Pages runbook carries its own, and
the `x-openbed-edge-cache` marker gives a second value on demand.*

- [x] 018 read-back taken and pasted, 2026-09-22, founder's run on `klrlpxysjsjpdkeqdhvl` (R-2026-09-22-52). **Item 1:** `can_select` is `f` on all six rows — `anon` and `authenticated` × the three mirrors. **Item 2:** `snapshot_rows_visible_to_service_role` is `1440`, and the `anon` probe failed with `ERROR: permission denied for table snapshot_current`, the `rollback` running after it as designed. **Item 3:** `openbed_refresh_lga_rollup` 3 succeeded / 0 failed / 0 in flight, last start `2026-09-22 05:55:00.038948+00`; `openbed_regenerate_snapshot` 16 succeeded / 0 failed / 0 in flight, last start `2026-09-22 05:56:00.010272+00` — **so the SECURITY DEFINER premise 018 was written on is confirmed LIVE, not argued.** **Item 4:** `/beds.json` `HTTP/2 200`, `content-type: application/json; charset=utf-8`, `x-openbed-edge-cache: miss`, `cf-ray … -CDG`; `/version.json` commit `76fe917933df113626dffacac585ed0e3f7bf3b4`, `dirty false` — **018 is invisible from the outside, which is the claim.**

**For the next apply (019) the count is 19**, with the apply's date and the
ruling that records it written in before pasting. As printed below the date and
ruling are placeholders, and the recorder refuses a malformed date, so an unedited
paste fails loudly rather than recording anything. The invocations that recorded
the boundary so far: `node scripts/freeze_applied_migrations.mjs 16 2026-09-16 R-2026-09-16-02`
(001-016), `node scripts/freeze_applied_migrations.mjs 17 2026-09-17 R-2026-09-17-01`
(001-017) and `node scripts/freeze_applied_migrations.mjs 18 2026-09-22 R-2026-09-22-52`
(001-018).

> **THERE IS NO PLACEHOLDER TO MOVE, AND THERE USED TO BE — removed 2026-09-22 by
> R-2026-09-22-53.** Until then this step said: *"In the same change, move the
> placeholder in `tests/compliance/frozen_migrations.test.ts`'s unfrozen-migration
> test to the next number."* **That leg now DERIVES its number from
> `database/migrations/applied-hosted.json`**, so recording a boundary moves it by
> definition and there is nothing left to carry.
>
> **Why it went rather than being guarded, because the reason is the interesting
> part** (R-2026-09-22-52 B2, Clause 5). The instruction used to justify itself:
> *"A placeholder named after the migration just recorded is an edit to a frozen
> file, and the test reds (observed 2026-09-17, when 017 was recorded)."* **True on
> 2026-09-17 and false from the moment it was acted on** — the red that day was
> `frozen migration 017_snapshot_schedule.sql CHANGED`, and it fired because the
> placeholder was then literally named after a real frozen migration. The fix that
> day renamed it to the distinct `NNN_placeholder.sql` form, **and that same rename
> removed the mechanism the sentence cited.**
>
> MEASURED 2026-09-22 against the boundary at 18: a placeholder left at
> `018_placeholder.sql` passed 7 of 7; `016_placeholder.sql` and
> `017_placeholder.sql` red; `018_close_mirror_read_and_push_surfaces.sql` reds with
> `CHANGED`. **Whether a stale placeholder reddened was an alphabetical accident** —
> the prefix check only notices one that sorts BEFORE the real migration at its own
> number, and `c` < `p` < `s`. So the hand-carried step was unenforced from
> 2026-09-17 onward, and nothing would have reported it being skipped.

```bash
node scripts/freeze_applied_migrations.mjs 19 YYYY-MM-DD R-YYYY-MM-DD-NN
```

- **PASS:** it prints the count it recorded, and the first and last file. Commit
  the updated `database/migrations/applied-hosted.json` in the pull request that
  records this apply.
- **A refusal is a stop condition, not a nudge to pass a different number.** It
  means the repository and hosted are not at the same point: either a migration
  is in the repo and unapplied, or hosted ran a file this checkout does not hold.
- **Never run this to green a failing `frozen_migrations` test.** That test fails
  because an applied migration was edited, and the fix for that is a new
  migration.

- [x] Frozen boundary recorded, 2026-09-16: 16 migrations, `001_app_schema_and_migration_ledger.sql` first, `016_snapshot.sql` last
- [x] Frozen boundary recorded, 2026-09-17: 17 migrations, `001_app_schema_and_migration_ledger.sql` first, `017_snapshot_schedule.sql` last (R-2026-09-17-01), with the frozen_migrations placeholder moved to 018 in the same change
- [x] Frozen boundary recorded, 2026-09-22: 18 migrations, `001_app_schema_and_migration_ledger.sql` first, `018_close_mirror_read_and_push_surfaces.sql` last (R-2026-09-22-52), with the frozen_migrations placeholder moved to 019 in the same change. `ledger_rows: 18`, matching the `18` read from hosted `app.schema_migrations` in the apply session; the recorder would have refused any other number.
- [x] Frozen boundary recorded, 2026-09-23: 19 migrations, `001_app_schema_and_migration_ledger.sql` first, `019_snapshot_single_read_and_mirror_integrity.sql` last (R-2026-09-23-69). `ledger_rows: 19`, matching the `19` the founder read from hosted `app.schema_migrations` after the apply. No placeholder was moved by hand: since R-2026-09-22-53 `tests/compliance/frozen_migrations.test.ts` derives it from this boundary, so it is now 020.

### Expected output, including the one line that looks like a failure and is not

**On the hosted project today** (001 through 019 applied, nothing newer in the
repository), the dry run prints nineteen `already applied` lines and:

```
0 migration(s) pending.
```

*Restated 2026-09-23 (R-2026-09-23-69), in the change that records 019's hosted
apply.* Until then this block described the state BEFORE that apply: eighteen
`already applied` lines, one WOULD APPLY line naming
`019_snapshot_single_read_and_mirror_integrity.sql`, and a count of one. That is
exactly what the founder's dry run printed on 2026-09-23, and it is kept below with
the other dated runs rather than overwritten.

*Restated 2026-09-23 (R-2026-09-23-66), in the change that adds 019.* Until then
this block showed eighteen `already applied` lines, no WOULD APPLY line, and a
count of zero -- right while the repository ended at 018.

*Restated 2026-09-22 (R-2026-09-22-52), in the change that records 018's hosted
apply.* Until then this block described the state BEFORE that apply: seventeen
`already applied` lines, one WOULD APPLY line naming
`018_close_mirror_read_and_push_surfaces.sql`, and a count of one. That is exactly
what the founder's dry run printed on 2026-09-22, and it is kept below with the
other dated runs rather than overwritten.

**The second dry run is part of an apply, not an optional extra.** It is the
reading recorded in the checkbox at the end of this section, and it is the half
that says the apply did what the first dry run promised.

**On 2026-09-23, when 019 was pending,** the same two commands printed this (the
founder's terminal output; the eighteen `already applied` lines are omitted, and the
apply's echo was `DO`, `DO`, `DO`, `ALTER TABLE`, `CREATE FUNCTION`, `COMMENT`,
`REVOKE`, `DO`, `INSERT 0 1`, `INSERT 0 0` -- the last two are 019's own ledger row,
then the runner's `ON CONFLICT` no-op):

```
  WOULD APPLY     : 019_snapshot_single_read_and_mirror_integrity.sql   <- dry run
1 migration(s) pending.
Migrations complete (1 applied this run).                               <- apply
```

**On 2026-09-22, when 018 was pending,** the same two commands printed this -- the
run that closed the accumulation boundary (the seventeen `already applied` lines
are omitted):

```
  WOULD APPLY     : 018_close_mirror_read_and_push_surfaces.sql   <- dry run
1 migration(s) pending.
Migrations complete (1 applied this run).                         <- apply
```

**On 2026-09-17, when 017 was pending,** the same two commands printed this, and
the apply's echo mapped one-for-one to 017's statements in order, with the two
`cron.schedule` calls returning jobids 1 and 2 (the first cron jobs on the
project):

```
  WOULD APPLY     : 017_snapshot_schedule.sql   <- dry run
1 migration(s) pending.
Migrations complete (1 applied this run).       <- apply
```

**On 2026-09-16, when 014-016 were still pending,** the same two commands printed
this -- kept because it is what a project one apply behind looks like (the
thirteen `already applied` lines are omitted):

```
  WOULD APPLY     : 014_publish_ward_status.sql                 <- dry run, first
  WOULD APPLY     : 015_ward_status_history_text_category.sql   <- dry run, second
  WOULD APPLY     : 016_snapshot.sql                            <- dry run, third
3 migration(s) pending.
Migrations complete (3 applied this run).   <- apply
```

**On a virgin database** the two commands report **different numbers**, and the
second is lower:

```
19 migration(s) pending.          <- dry run
Migrations complete (18 applied this run).   <- apply
```

*Restated 2026-09-23 (R-2026-09-23-69). This block read `18` and `17` -- right while
the repository ended at 018 -- and the change that added 019 did not restate it,
so from that merge it named a count one lower than a correct virgin run prints. It is
not one of the hosted expectations the guard parses; it was found by reading the
section for this restatement.*

**Eighteen is correct there. Nothing was skipped.** Migration 001 creates the `app`
schema, the revoke wall and `app.schema_migrations` itself, so it cannot be
recorded by a ledger that does not exist yet. The runner applies and ledgers it
in a separate **bootstrap** step, and the apply loop then counts only what it
applied itself -- 002 through 019, which is eighteen. The dry run has no bootstrap
branch: `is_applied` returns 0 while the ledger is absent, so it counts all
nineteen as pending. The two numbers are measuring different things.

**Confirm it by the ledger, which is the artefact that matters, not by the
count:**

Expect the ledger query to return one row per forward migration file APPLIED TO
THAT PROJECT. **On hosted today that is `19`, with `0 migration(s) pending.` from the
dry run** -- the founder read `19` after 019's apply on 2026-09-23, and the second
dry run printed `0 migration(s) pending.` *Restated 2026-09-23 (R-2026-09-23-69),
in the change that records that apply; until then it read `18` with
`1 migration(s) pending.`* *Restated 2026-09-23 (R-2026-09-23-67): this is the
FOURTH statement of the pending expectation in this section, and the change that added
019 restated the other three and missed it, so from that merge until this change it
read `18` with `0 migration(s) pending.` while a correct dry run printed one.
`tests/compliance/runbook_migration_expectation.test.ts` now reads this site too.*
(Restated 2026-09-22, R-2026-09-22-52; until then it read `17` and
`1 migration(s) pending.`, which is what the founder read minutes before the
apply.) **The ledger count and the pending count move together
and in opposite directions** — if one changes and the other does not, stop: the
apply did not do what the dry run said it would.
The first line waits silently for the connection string; the last removes it.

**Step P's PATH line is carried in below**, because this block calls `psql` itself.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
read -rs DATABASE_URL && export DATABASE_URL
psql "$DATABASE_URL" -Atc "select count(*) from app.schema_migrations"
bash scripts/run_migrations.sh --dry-run
unset DATABASE_URL
```

Verified against a virgin local database on 2026-09-10: dry run 13 pending,
apply `12 applied this run`, ledger 13 rows, second dry run 0 pending.

Observed on hosted `klrlpxysjsjpdkeqdhvl` on 2026-09-16, after the apply of
014-016: ledger **16 rows**, second dry run `0 migration(s) pending.`

Observed on hosted `klrlpxysjsjpdkeqdhvl` on 2026-09-17, after the apply of 017:
ledger **17 rows**, second dry run `0 migration(s) pending.`

Observed on hosted `klrlpxysjsjpdkeqdhvl` on 2026-09-22, after the apply of 018:
ledger **18 rows**, second dry run `0 migration(s) pending.` **The pre-apply
readings were taken in the same session and are recorded in block B below**, which
is what makes each of them the other's failing half.

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

- [x] Every forward migration applied, `016_snapshot.sql` last, 2026-09-16: ledger 16 rows, and the second dry run reported `0 migration(s) pending.`
- [x] 017 applied, `017_snapshot_schedule.sql` last, 2026-09-17: dry run one `WOULD APPLY 017_snapshot_schedule.sql` and `1 migration(s) pending.`; apply `Migrations complete (1 applied this run).`; ledger 17 rows, and the second dry run reported `0 migration(s) pending.`
- [x] 018 applied, `018_close_mirror_read_and_push_surfaces.sql` last, **2026-09-22 05:40:40 UTC**: ledger 17 rows before; dry run one `WOULD APPLY     : 018_close_mirror_read_and_push_surfaces.sql` and `1 migration(s) pending.`; apply echoed `DO`, `DO`, `INSERT 0 1`, `INSERT 0 0` then `Migrations complete (1 applied this run).`; ledger 18 rows, and the second dry run reported `0 migration(s) pending.` **The two `DO` blocks are 018's idempotent publication drop and its per-role revoke; `INSERT 0 1` is the migration ledgering itself and `INSERT 0 0` the runner's belt-and-braces `ON CONFLICT DO NOTHING`, which is a no-op precisely because the file had already ledgered itself.** This is the apply that closed the accumulation boundary (R-2026-09-22-52).

---


## 6. Verify the boundary by hand, against the hosted project  *(was §4)*

> **GOVERNED BY THE RESTATE RULE** (step 5, R-2026-09-21-50): this step states an
> expected HOSTED state that a migration can falsify, so it is restated in the change
> that ADDS the migration. It was not restated for 018, and that is the finding that
> widened the rule. No script can check this one — the expectation is a hosted reading.

Run these against the hosted project with the **publishable** key. **Since
migration 018, EVERY probe in this step must be refused — the schema probe, the
three mirror reads and the three writes alike.**

*Restated 2026-09-22 (R-2026-09-22-52), in the change that records 018's hosted
apply.* **Until 2026-09-22 this expectation was a PREDICTION derived from a local
database with 018 applied; it is now a hosted READING**, taken by the founder
minutes after the apply and recorded in the table below. The wording did not have
to change, which is the point worth noting: the change is in what stands behind it.
Before the apply this step could only be honest by saying so, and it did.

*Restated 2026-09-21 (R-2026-09-21-50), and it should have been restated in the
change that ADDED 018 — see the restate rule in step 5.* Until then this line read
*"the three mirror reads must **succeed**"*, which was true from 007 until 018
revoked `SELECT` on all three mirrors from `anon` and `authenticated`. Before that
it read *"Every one must fail"*, which was false for the reads. **The line has now
been wrong in both directions, eleven days apart**, which is the argument for the
rule rather than for a better memory.

**THE KEY MUST BE THE `sb_publishable_` ONE, NOT THE LEGACY `anon` JWT.**
Disabling legacy API keys on 2026-09-09 killed the legacy `anon` key as well as
the exposed `service_role` one — they are signed by the same secret. A probe
still written against the old format now fails at *authentication*, before
PostgREST ever consults a schema, and records a boundary that was never
exercised. That is a false negative of exactly the same shape as the "not 200"
rotation probe in `runbook-key-rotation.md`: the check passes for a reason
unrelated to what it guards. Take the key from the script, never from a
remembered value.

**AND NEVER RUN A PROBE ON AN EMPTY KEY.** Until 2026-09-13 both blocks below
did a bare `KEY="$(bash scripts/get_publishable_key.sh)"`. A script that fails
inside a command substitution leaves `KEY` empty and the shell carries on, so
every probe returned 401 -- which this runbook reads as "the key is wrong". The
script's own stop condition cannot reach past a caller's `$( )`. So the guard
lives here, at the caller: one check collapses any bad value to empty, and every
use refuses empty.

```bash
KEY="$(bash scripts/get_publishable_key.sh)" || KEY=
case "$KEY" in
  sb_publishable_?*) echo "key obtained" ;;
  *) echo "STOP: no usable publishable key. Do not run the probes -- a 401 now means nothing."; KEY= ;;
esac
SUPABASE_URL="https://klrlpxysjsjpdkeqdhvl.supabase.co"
```

With the guard above, an empty or malformed key can no longer reach a probe:
every use is `${KEY:?...}`, which refuses to run the command at all. So a 401
below means a REAL key was refused -- the key is wrong -- never that the boundary
held, and never that the key fetch quietly failed.

The schema probe. Expect HTTP 406, with a body naming `PGRST106`:

```bash
curl -s -w '\nHTTP %{http_code}\n' \
  "$SUPABASE_URL/rest/v1/facility?select=*" \
  -H "apikey: ${KEY:?no key -- refusing to probe}" -H "Accept-Profile: app"
```

All three mirrors, read and write. The checkboxes below claim all three, so the
probe covers all three -- `ward_public` alone did not reach what they claim.
**Since 018, the READ and the WRITE pass on the same condition: body code
`42501`** -- read the body, as the next paragraph explains.

**THE READ AND THE WRITE NOW RETURN THE SAME ANSWER, AND THAT IS WORTH KNOWING
BEFORE YOU READ THE OUTPUT.** MEASURED locally against a database with 018 applied:

```
HTTP 401
{"code":"42501","details":null,
 "hint":"Grant the required privileges to the current role with: GRANT SELECT ON public.ward_public TO anon;",
 "message":"permission denied for table ward_public"}
```

That is byte-for-byte the shape the WRITE has returned since 007. **So the write
probe no longer tells you anything the read probe has not already told you.** It is
kept, and its job has changed: it is now a regression check that would catch a
future `INSERT` grant, not independent evidence about today. Stated here because a
probe whose value has quietly changed is one people keep running for the old
reason.

```bash
for t in facility_public ward_public lga_rollup; do
  printf '== %s READ  ' "$t"
  curl -s -w '\nHTTP %{http_code}\n' "$SUPABASE_URL/rest/v1/$t?select=*" \
    -H "apikey: ${KEY:?no key -- refusing to probe}" | head -c 300
  printf '\n== %s WRITE ' "$t"
  curl -s -X POST "$SUPABASE_URL/rest/v1/$t" \
    -H "apikey: ${KEY:?no key -- refusing to probe}" -H "Content-Type: application/json" \
    -d '{}' -w '\nHTTP %{http_code}\n'
done
```

**"ANON REFUSED" IS READ OFF THE BODY, NEVER THE STATUS — reads as well as
writes since 018.** PostgREST maps a
Postgres privilege failure (SQLSTATE `42501`) on an anonymous request to **HTTP
401** — the same status a dead or wrong key produces. So a 401 here is compatible
with *the grant refused the write* and with *the key was never accepted*, and only
the body separates them. **The pass condition is `"code":"42501"` in the body.**
This is the same false-negative family this step already warns about for the
legacy key, one layer lower. *Recorded as a correction:* the stated read of this
check on 2026-09-13 was "not 401", which is wrong — 401 is exactly what the
passing result looks like.

**AND A LOCAL-VS-HOSTED ASYMMETRY, because the value above was derived locally and
this step runs on hosted** (`.claude/rules/test-conventions.md` section 4). MEASURED
2026-09-21, both sides:

| | a real key, table revoked | a GARBAGE key | no key at all |
|---|---|---|---|
| **local stack** | 401, body `42501` | 401, body `42501` | 401, body `42501` |
| **hosted** | 401, body `42501` | 401, `{"message":"Invalid API key"}` | 401, `{"message":"No API key found in request"}` |

**Locally the body rule does NOT discriminate a dead key from a revoked table; on
hosted it does.** Neither hosted refusal carries `42501`.

**AND THE HOSTED "real key, table revoked" CELL IS NOW MEASURED ON THE RELATIONS
THIS STEP ACTUALLY PROBES** (R-2026-09-22-52). When that table was taken on
2026-09-21 **no mirror was revoked on hosted** — 018 had not been applied — so
whatever relation gave that cell its value, it was not one of the three this step
asks about. It held, and it was standing on a neighbouring case. Since the apply of
2026-09-22 all three mirrors are revoked on hosted and all six probes return
`HTTP 401` with `"code":"42501"`, which is the cell measured where it is used. So the pass condition
here is sound where this step runs, and anyone reproducing it against the local
stack is not reproducing the discrimination. **This is the `$ANON_KEY` family
again** — a probe that passes because authentication failed rather than because the
boundary held — and the body code is what keeps it out.

**Results, 2026-09-13, project `klrlpxysjsjpdkeqdhvl`** (founder's run). **The
READ column is SUPERSEDED by migration 018 and is kept, not overwritten** — it is
what a correct project returned before the revoke, and step 5's pre-apply block
re-takes exactly this reading so the two can be compared. The WRITE column is
unchanged and still current: `anon` never held `INSERT`.

| Mirror | Read | Write |
|---|---|---|
| `facility_public` | HTTP 200 | HTTP 401, body code `42501` |
| `ward_public` | HTTP 200 | HTTP 401, body `{"code":"42501", … "permission denied for table ward_public"}` |
| `lga_rollup` | HTTP 200 | HTTP 401, body code `42501` |

- [x] `app` schema unreachable with the publishable key — check (a) 1 below, 406 / `PGRST106`
- [x] The three mirrors readable — 200 on all three, 2026-09-13. **SUPERSEDED by
      migration 018 (R-2026-09-21-50): after the hosted apply the correct reading
      is a REFUSAL, body code `42501`, on all three.** Left ticked as the dated
      record it is; the post-018 reading is a new box below.
- [x] **The three mirrors REFUSED — body code `42501` on all three** — 2026-09-22,
      founder's run on `klrlpxysjsjpdkeqdhvl` after 018's hosted apply
      (R-2026-09-22-52), key obtained under the guard (`key obtained`). READ **and**
      WRITE, all three:

      | Mirror | Read | Write |
      |---|---|---|
      | `facility_public` | HTTP 401, `{"code":"42501", … "permission denied for table facility_public"}` | HTTP 401, same body code |
      | `ward_public` | HTTP 401, `{"code":"42501", … "permission denied for table ward_public"}` | HTTP 401, same body code |
      | `lga_rollup` | HTTP 401, `{"code":"42501", … "permission denied for table lga_rollup"}` | HTTP 401, same body code |

      **The failing half is step 5's block B**, run on the same project earlier in
      the same session, before the apply: the same three reads returned `HTTP 200`. Two verdicts, one
      probe, one project, minutes apart — which is what method note 23 asks for and
      what this step could not supply on its own until today.
- [x] Anon write refused — body code `42501` on all three, 2026-09-13

### Check (a), HTTP half — run immediately after the apply

```bash
KEY="$(bash scripts/get_publishable_key.sh)" || KEY=
case "$KEY" in
  sb_publishable_?*) echo "key obtained" ;;
  *) echo "STOP: no usable publishable key. Do not run the probes -- a 401 now means nothing."; KEY= ;;
esac
REF=klrlpxysjsjpdkeqdhvl
```

**1.** Asking for the `app` schema must be refused with `PGRST106`, BEFORE any
policy is consulted. This is the boundary; RLS is the second line.

```bash
curl -s "https://$REF.supabase.co/rest/v1/facility?select=*" \
  -H "apikey: ${KEY:?no key -- refusing to probe}" -H "Authorization: Bearer ${KEY:?no key -- refusing to probe}" -H "Accept-Profile: app"
```

**2.** And by bare name: no `app` table may answer under the default profile.
**A 404 here can never detect `app` in `extra_search_path`, in either state.**
That setting only affects name, function and type resolution inside the
database; it never creates an endpoint, so a bare name 404s whether `app` is in
it or not. The only evidence for that checkbox is step 2's single-field probe --
never this loop. "No 200 for any name" only means something if check 1 above
returned exactly 406 / `PGRST106` in THIS shell. A dead key produces "no 200" too.

```bash
for t in facility ward_status audit_log facility_contact schema_migrations; do
  printf '%s -> ' "$t"
  curl -s -o /dev/null -w '%{http_code}\n' "https://$REF.supabase.co/rest/v1/$t?select=*" \
    -H "apikey: ${KEY:?no key -- refusing to probe}" -H "Authorization: Bearer ${KEY:?no key -- refusing to probe}"
done
```

- [x] (1) returns `PGRST106` / HTTP 406 — 2026-09-13: HTTP 406, body
      `{"code":"PGRST106", … "message":"Invalid schema: app"}`, with the exposed-schemas
      hint recorded in step 2
- [x] (2) returns no 200 for any name — 2026-09-13: `facility` 404, `ward_status` 404,
      `audit_log` 404, `facility_contact` 404, `schema_migrations` 404. Meaningful
      because (1) returned 406 under the same key in the same shell
- [x] Result recorded with a date — 2026-09-13, project `klrlpxysjsjpdkeqdhvl`

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

**Catalogue half, result 2026-09-13, project `klrlpxysjsjpdkeqdhvl`.** It was
skipped when step 8 first ran and was run afterwards, so it is recorded here
rather than implied by step 8:

- `has_schema_privilege(<role>, 'app', 'USAGE')`: `anon` **f**, `authenticated`
  **f**, `service_role` **f**.
- `has_table_privilege('anon', <table>, 'SELECT')` across **all 16** tables in
  `app`: **f on every one** — `alert`, `audit_log`, `challenge`, `device`,
  `facility`, `facility_contact`, `facility_ops`, `invite`,
  `notification_outbox`, `referral`, `schema_migrations`, `system_heartbeat`,
  `ward_account`, `ward_alert_state`, `ward_status`, `ward_status_event`. 16 rows.

### The WIDENED grant sweep — run once when Bundle 3 lands (R-2026-09-22-57 A2)

**Why it widens.** The 2026-09-13 reading above covers **one role and one
privilege**: `anon` × `SELECT`. The local test it is the hosted counterpart of —
*"no client role holds any grant on any table in app"* in
`tests/db/rls_enabled_everywhere.test.ts` — covers **three grantees × every
privilege type × every table**. The hosted half has been the narrower of the two
since it was written, and **PR 3.4 adds the first functions executable by
`authenticated` since migration 014**, which is the change that makes the gap
matter rather than merely exist.

**Run it once, after Bundle 3's last pull request has merged and been applied.**
It is a hand check because nothing in the repository can reach the hosted
catalogue; that is a design constraint and not a defect (test-conventions §4).

**BOTH HALVES ARE RUN IN THE SAME SITTING, and the failing half FIRST.** A sweep
that can only ever return zero rows proves nothing, and "zero rows" is exactly what
a broken query returns. Do not record the result of the second block without the
output of the first.

**Half 1 — the failing half. It must return a row.**

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
GRANT SELECT ON app.facility TO anon;
SELECT grantee, table_name, privilege_type
  FROM information_schema.table_privileges
 WHERE table_schema = 'app'
   AND grantee IN ('anon', 'authenticated', 'PUBLIC')
 ORDER BY grantee, table_name, privilege_type;
ROLLBACK;
SQL
```

Expect **exactly one row**: `anon | facility | SELECT`. The `ROLLBACK` is what
removes the grant — the transaction never commits, so nothing is left behind even
if the block is interrupted. **If this returns no rows, the query is broken and
half 2 means nothing.**

**Half 2 — the real sweep. It must return no rows, and must count 16 tables.**

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT grantee, table_name, privilege_type
  FROM information_schema.table_privileges
 WHERE table_schema = 'app'
   AND grantee IN ('anon', 'authenticated', 'PUBLIC')
 ORDER BY grantee, table_name, privilege_type;

SELECT count(*) AS app_tables_enumerated
  FROM information_schema.tables
 WHERE table_schema = 'app' AND table_type = 'BASE TABLE';
SQL
```

**The second query is the anti-vacuity half and it is not optional.** An empty
grant result is the same output whether the schema holds 16 tables with no grants
or holds none at all — a schema that had been renamed would report a clean
boundary. It must print **16**, matching the enumeration recorded above and the
count the local test pins.

**The tables are enumerated FROM THE CATALOGUE, never from the list above.** A
literal list here would go stale the moment a migration adds a table, and would go
stale silently, in the direction that reports clean.

**Record the result under this heading with the date and the project ref**, in the
same shape as the 2026-09-13 reading: both halves' output, not a summary of them.

---


## 7. Postgres version — local and hosted, recorded  *(was §4b)*

| Where | Version | Source |
|---|---|---|
| Hosted | 17.6.1.**166** | Management API, 2026-09-09 |
| Local (`supabase start`) | 17.6.1.**167** | image `public.ecr.aws/supabase/postgres:17.6.1.167` |
| **Client** used for the hosted apply of 001-013 | `psql` **18.6** (Homebrew keg-only `libpq`, see step P) | `psql --version`, 2026-09-13 |
| **Client** used for the hosted apply of 014-016 | `psql` **18.6**, the same client | confirmed by the founder for the 2026-09-16 run (R-2026-09-16-03). **Not carried forward from the row above** -- an assumed client is the thing this row exists to prevent |
| **Client** used for the hosted apply of 017 | `psql` **18.6** | observed by the founder for the 2026-09-17 run (R-2026-09-17-01), not carried forward |
| **Client** used for the hosted apply of 018 | `psql` **18.6** | observed by the founder for the 2026-09-22 run (R-2026-09-22-52): `psql (PostgreSQL) 18.6`, printed by step P in that same session. Not carried forward |
| **Client** used for the hosted apply of 019 | **not reported** | the founder's 2026-09-23 output (R-2026-09-23-69) shows step P's PATH line and the Session pooler, and no `psql --version` line. Not carried forward from the row above |

**The client is newer than the server: psql 18.6 against server 17.6.1.166.**
The migrations applied on 2026-09-16 and 2026-09-17 went to project
`klrlpxysjsjpdkeqdhvl` through that client, and steps 6, 8 and 10 were run through
it on 2026-09-13. *(This read "All thirteen migrations" until 2026-09-21, four lines
above a sentence saying hosted holds 001 through 017. It was already wrong at 014
and nobody was counting; found in the 018 sweep, corrected to name the runs rather
than a number that has to be maintained.)* This table
previously recorded server versions only, which left the one tool every SQL
result above passed through unrecorded.

**Hosted now holds 001 through 019.** Migrations 014, 015 and 016 were applied on
2026-09-16 (R-2026-09-16-02), 017 on 2026-09-17 (R-2026-09-17-01), **018 on
2026-09-22 at 05:40:40 UTC (R-2026-09-22-52)**, and **019 on 2026-09-23
(R-2026-09-23-69)**; step 5 carries each run's output, its post-apply probe, the
owners read, the reader-policy read, 017's jobs read, 018's pre-apply reading and
read-back, and the frozen-boundary record.

*Restated 2026-09-23 (R-2026-09-23-69), in the change that records 019's hosted
apply.* Until then this read *"Hosted now holds 001 through 018."*

*Restated 2026-09-22 (R-2026-09-22-52), in the change that records 018's hosted
apply.* Until then this read *"Hosted now holds 001 through 017. Migration 018 is
merged and NOT applied — see step 5's 'next apply is 018' block, which is where that
closes."* It closed there, exactly as written. **This line is one of the five places
step 5's state is stated** (R-2026-09-21-51 A2), and it is in this table rather than
in step 5 because it is the one a reader checking the Postgres version arrives at
without passing step 5 at all.

**Same major and minor; the patch differs by one (166 vs 167).** No major-version
divergence to reason about, and the earlier record of "17.6.1 both" was true at
that precision but not at patch level.

**Do not read that as making step 8 less necessary.** The hosted append-only hand
check exists because a local green on a role-sensitive control is not a hosted
fact until the hosted role graph is observed. This paragraph used to give the
reason as "Supabase's `postgres` role is a superuser locally and is not hosted".
**Observed 2026-09-15, that is false on both sides:**
- local `postgres` is `rolsuper f`, `rolbypassrls t`;
- hosted `postgres` on `klrlpxysjsjpdkeqdhvl` is `rolsuper f`, `rolbypassrls t`.

The graphs match on those attributes (recorded in
`Sprint Kickoffs/decision-2026-09-14-public-private-split.md`, "Hosted role rows
— R-2026-09-15-08"). Step 8's result stands on what it observed on hosted, not on
the old asymmetry.

Re-derive with:

Locally:

```bash
docker ps --format '{{.Image}}' | grep supabase/postgres
```

Hosted: the same Management API call as step 1.

---


## 8. Append-only, verified on the hosted role graph  *(was §5)*

**This is the step the local suite genuinely cannot stand in for**, and the reason
is specific rather than general.

`tests/db/append_only_enforcement.test.ts` proves the trigger fires locally,
which is strong evidence — but a local result is not a hosted fact until the
hosted role graph has been observed, and this step is where it is observed.
_Corrected 2026-09-15:_ this paragraph said `postgres` "is a superuser on a local
stack and is not on a hosted project". Observed, it is superuser on neither:
`rolsuper f` and `rolbypassrls t` both locally and on `klrlpxysjsjpdkeqdhvl`.

### The SQL this step used to carry was a no-op, and that is observed

It read:

```sql
update app.audit_log set action = 'tampered' where id = (select min(id) from app.audit_log);
delete from app.ward_status_event where id = (select min(id) from app.ward_status_event);
```

**Against empty tables that matches zero rows, and the triggers are
`FOR EACH ROW`: zero rows is zero firings, no exception, and a checkbox ticked
on nothing.** Not argued — observed: the probe below planted into both tables and
got back `audit_log id 1, event id 1`, so both were empty at the moment the old
statements would have run. It is replaced by a plant-then-assert block.

### The probe — run verbatim, connected with `DATABASE_URL` (step P first)

The first line waits silently for the connection string: paste it and press
Enter. **The last line removes it from the shell.** Those two lines were added on
2026-09-14; until then this block had no `read` of its own and relied on the
variable step 5 left exported for the rest of the session. **The SQL between the
heredoc markers is unchanged from the run recorded below.**

**Step P's PATH line is carried in below**, because this block calls `psql` itself.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
read -rs DATABASE_URL && export DATABASE_URL
psql "$DATABASE_URL" <<'SQL'
begin;
do $probe$
declare
  fid uuid; wid uuid; eid bigint; aid bigint; n integer; msg text;
  ok_u boolean := false; ok_d boolean := false;
begin
  insert into app.facility (name, lga, state, lat, lng, public_phone_e164)
    values ('ZZ_PROBE_ROLLED_BACK','Ikeja','Lagos',6.6,3.35,'+2348000000000')
    returning id into fid;
  insert into app.ward_status (facility_id, category, offering, bed_count)
    values (fid,'ICU_ADULT','OFFERED',3) returning id into wid;
  insert into app.ward_status_event
    (ward_status_id, facility_id, category, offering, bed_count, accepting, state, source, version)
    values (wid, fid,'ICU_ADULT','OFFERED',3,true,'OK','WARD',1) returning id into eid;
  insert into app.audit_log (facility_id, ward_category, action, new_value, version)
    values (fid,'ICU_ADULT','probe.append_only','{"bed_count":3}'::jsonb,1) returning id into aid;
  raise notice 'CONTROL PASS: inserts accepted. audit_log id %, event id %', aid, eid;

  begin
    update app.audit_log set action = 'tampered.probe' where id = aid;
    get diagnostics n = row_count;
    raise notice 'LEG 1 FAIL: update not refused, % row(s) changed', n;
  exception when others then
    msg := SQLERRM;
    if msg like 'APPEND_ONLY_VIOLATION%' then ok_u := true;
      raise notice 'LEG 1 PASS trigger: %', msg;
    elsif SQLSTATE = '42501' then
      raise notice 'LEG 1 PARTIAL grant-only, trigger never reached: %', msg;
    else raise notice 'LEG 1 FAIL wrong reason [%]: %', SQLSTATE, msg;
    end if;
  end;

  begin
    delete from app.ward_status_event where id = eid;
    get diagnostics n = row_count;
    raise notice 'LEG 2 FAIL: delete not refused, % row(s) removed', n;
  exception when others then
    msg := SQLERRM;
    if msg like 'APPEND_ONLY_VIOLATION%' then ok_d := true;
      raise notice 'LEG 2 PASS trigger: %', msg;
    elsif SQLSTATE = '42501' then
      raise notice 'LEG 2 PARTIAL grant-only, trigger never reached: %', msg;
    else raise notice 'LEG 2 FAIL wrong reason [%]: %', SQLSTATE, msg;
    end if;
  end;

  if ok_u and ok_d then raise notice 'RESULT: BOTH LEGS PROVED ON THE HOSTED ROLE GRAPH';
  else raise notice 'RESULT: NOT PROVED';
  end if;
end
$probe$;
rollback;
SQL
unset DATABASE_URL
```

**Three properties of this block are load-bearing. An edit that loses any one of
them turns it back into a rubber stamp:**

1. **The `CONTROL PASS` notice fires before the two legs.** "Both refused" can
   then never be satisfied by a broken connection, a missing table or a failed
   plant — without the control line there is no result.
2. **SQLSTATE `42501` is reported separately from `APPEND_ONLY_VIOLATION`.** A
   grant-level refusal can never be recorded as the trigger firing; it reports
   `PARTIAL grant-only`.
3. **AND IT IS THE ONLY HOSTED `insert into app.facility` WRITTEN DOWN ANYWHERE
   — which makes the `rollback;` load-bearing for section 4b, not just for
   hygiene (R-2026-09-21-45).** If that line is ever changed to `commit;`, or the
   session dies between the insert and the rollback leaving the row committed,
   **this probe creates the first facility row** and the three defects named in
   section 4b stop being theoretical. **After running this step, re-check:**

   **Step P's PATH line is carried in below**, because this block calls `psql` itself.

   ```bash
   export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
   psql "$DATABASE_URL" -tAc "select count(*) from app.facility"
   ```

   **Stop condition: `0`.** Anything else means the probe left a row behind.

4. **The whole thing rolls back.** These tables are append-only, so a planted row
   that committed could never be removed.

### Result, 2026-09-13, project `klrlpxysjsjpdkeqdhvl`

Output, verbatim:

```
BEGIN
NOTICE:  CONTROL PASS: inserts accepted. audit_log id 1, event id 1
NOTICE:  LEG 1 PASS trigger: APPEND_ONLY_VIOLATION: UPDATE on app.audit_log is not permitted
NOTICE:  LEG 2 PASS trigger: APPEND_ONLY_VIOLATION: DELETE on app.ward_status_event is not permitted
NOTICE:  RESULT: BOTH LEGS PROVED ON THE HOSTED ROLE GRAPH
DO
ROLLBACK
```

Trigger state:

```
 trg_audit_log_append_only         | app.audit_log         | A
 trg_ward_status_event_append_only | app.ward_status_event | A
(2 rows)
```

**The role, which is what makes this result exact:** `current_user = postgres`,
`session_user = postgres`. Migration 010 revokes `UPDATE` and `DELETE` from
`anon`, `authenticated` and `service_role` — **not from `postgres`**. So
`postgres` still held both privileges, and **the trigger is what refused.** That
is the defence-in-depth layer holding for the one role the grant layer
deliberately does not cover, on the hosted role graph where `postgres` is not a
superuser (observed 2026-09-15: `rolsuper f`, `rolbypassrls t` — and the same
locally, so this holds on both).

**What this does NOT prove:** the **grant** leg on hosted. No update or delete was
attempted as `anon`, `authenticated` or `service_role`, so the revocations were
not exercised here. Only the trigger leg is proved.

- [x] Both legs PASS **via the trigger** (`APPEND_ONLY_VIOLATION`, not `42501`), as
      `postgres`, after `CONTROL PASS` — 2026-09-13
- [x] Both triggers present with `tgenabled = A`, on `app.audit_log` and
      `app.ward_status_event` — 2026-09-13

### ID gaps in the append-only tables are expected — read this before auditing them

**The rolled-back probe permanently consumed `app.audit_log` id 1 and
`app.ward_status_event` id 1.** Identity sequences are non-transactional: a value
handed out inside a transaction that rolls back is never handed out again. **The
first real row in each table is id 2.**

**A gap in the id sequence of an append-only table is NOT evidence of a deleted
row.** Any rolled-back or failed insert leaves one. Without this note, the first
person to audit these tables finds a missing row 1 in a table that cannot lose
rows. What would indicate tampering is the trigger not being `tgenabled = A` —
the check above — not a gap. The same note sits beside the id column in
`database/migrations/005_app_audit_referral_outbox_tables.sql`.

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

Verified empirically on the hosted project **on 2026-09-14, project
`klrlpxysjsjpdkeqdhvl`, hosted GoTrue v2.196.0. The step is partly closed.** What
remains is blocked by the built-in email sender's rate limit, not by a failure.

- [x] A **signup-type** link cannot be consumed twice: 200, then 403
      `otp_expired`. The positive control ran immediately before the refusal,
      in the same shell, so the refusal cannot be a malformed call.
- [ ] A **magiclink-type** link cannot be consumed twice. Not run: the rate
      limit ended the sitting.
- [ ] An expired link is refused **on real time alone**. Not proved; see the
      near-miss below.
- [x] Recorded: the Supabase auth version these were observed against,
      **v2.196.0**

### The two link types, and what actually decides between them

The emailed link carries a `type`, and the verify body must echo it: GoTrue
looks a `signup` token up by the account's confirmation token and a `magiclink`
token by its recovery token, so the wrong type finds nothing.

**The account decides the type, not the request.** An address GoTrue has never
seen, or one whose email is not yet confirmed, is sent a `signup` link. A
confirmed account is sent a `magiclink` link. `create_user` does not choose
between them: it defaults to `true`, so omitting it sends the same request, and
`false` only refuses an address GoTrue does not know. This was read in the GoTrue
v2.196.0 source (supabase/auth, internal/api/otp.go and
internal/api/magic_link.go) on 2026-09-14, and matches what the local harness
recorded in `tests/setup/auth.ts`.

With Confirm email on, the first request for a new address therefore yields
`signup`, and every request after that link has been consumed yields
`magiclink`.

### The commands, as run on 2026-09-14

Step P first. The first block is the key guard, and it must print `KEY OK`. Its
only other command is a read-only GET, so it complies with step P's
stop-condition rule.

```bash
KEY="$(bash scripts/get_publishable_key.sh)" || KEY=
case "$KEY" in
  sb_publishable_?*) echo "KEY OK" ;;
  *) echo "STOP: no usable publishable key." ; KEY= ;;
esac
REF=klrlpxysjsjpdkeqdhvl
curl -s "https://$REF.supabase.co/auth/v1/health" -H "apikey: ${KEY:?no key}"
```

Observed:

```text
{"version":"v2.196.0","name":"GoTrue","description":"GoTrue is a user registration and authentication API"}
```

The next block requests a link. It changes hosted state: it creates the account
if absent and sends an email. So it is its own block, run only after the block
above printed `KEY OK`.

```bash
curl -s -X POST "https://$REF.supabase.co/auth/v1/otp" \
  -H "apikey: ${KEY:?no key}" \
  -H "Content-Type: application/json" \
  -d '{"email":"security@openbed.ng","create_user":true}' \
  -w '\nHTTP %{http_code}\n'
```

Observed: `{}` and `HTTP 200`. The emailed link had this shape:

```text
https://<ref>.supabase.co/auth/v1/verify?token=<TOKEN>&type=signup&redirect_to=http://localhost:3000
```

The next block consumes the link at the public endpoint with the publishable
key. It mirrors `verifyToken` in `tests/setup/auth.ts`, and this is the only leg
single use lives in. At the silent prompt, paste the `token` value from the link.
To test a second use, run the block again and paste the same value.

Four properties of it are deliberate; keep all four:

1. **The token reaches curl on stdin, through `printf`.** `printf` is a shell
   builtin, so the token never becomes a process argument that the process list
   can show. Steps 1 and 4 still have that exposure; see step P.
2. **`read -rs`**, so the token is neither echoed nor kept in history.
3. **The response is filtered.** A successful verify returns a live access token
   and refresh token. The `jq` reduces the response to a summary, so no session
   credential reaches the terminal or a transcript.
4. **It ends with `unset TOKEN BODY`.** That line was added after the run, under
   step P's credential rule: until it runs, `BODY` holds the live session.

```bash
read -rs TOKEN
BODY="$(printf '{"type":"signup","token_hash":"%s"}' "${TOKEN:?no token}" | \
  curl -s -X POST "https://$REF.supabase.co/auth/v1/verify" \
    -H "apikey: ${KEY:?no key}" -H "Content-Type: application/json" \
    --data-binary @- -w '\n%{http_code}')"
echo "$BODY" | tail -1
echo "$BODY" | sed '$d' | jq -c 'if .access_token then {result:"SESSION ISSUED", token_type, expires_in, email:.user.email} else . end'
unset TOKEN BODY
```

Observed:

```text
first use    200
             {"result":"SESSION ISSUED","token_type":"bearer","expires_in":3600,"email":"security@openbed.ng"}
same token   403
             {"code":403,"error_code":"otp_expired","msg":"Email link is invalid or has expired"}
```

### A 403 from this endpoint never means one thing, so every 403 here needs a same-type 200

`POST /auth/v1/verify` returns **one** refusal body, 403 `otp_expired` with
"Email link is invalid or has expired", for four different situations:

- **A token the lookup cannot find.** The `type` chooses which stored token the
  hash is matched against, so a token verified with the wrong type finds nothing,
  and so does one that was never issued. GoTrue v2.196.0 (supabase/auth,
  internal/api/verify.go) returns the body above at line 664.
- **A token that has aged past Email OTP Expiration.** It is found, judged
  expired, and gets the same body from a different branch, at line 692.
- **A token already consumed.** Its refusal was observed on 2026-09-14, above,
  and the body is the same.

**So on this endpoint a 403 never distinguishes a spent token, a token malformed
for its type, and an aged one.** That is a property of the endpoint, not a
judgement about any particular run, and no amount of care in reading the 403
recovers the difference.

**The only thing that gives any 403 in this step a meaning is a 200 at the same
type, first, in the same shell.** The 200 establishes that the key, the request
shape and the type are right. Only then can a later 403 be attributed to the
property under test. That governs every 403 in this step: the signup single-use
result above, and steps 4 and 7 of the closing procedure below. **A 403 without
its same-type 200 is not a weak result. It is no result.**

### Why real-time expiry is NOT proved: the near-miss

A `magiclink` token did return 403 after more than 120 seconds. No `magiclink`
verify had returned 200 in that shell. By the mechanism above, that 403 is what a
spent token, a request malformed for the type and an aged token all return, so it
carries no information about expiry. It is recorded as a data point, not a pass
and not a close call.

It is the dead-key 401 (the fallback entry in §8 of
`.claude/rules/test-conventions.md`) and step 8's empty-table no-op in a third
costume: a check reporting the expected refusal for a reason unrelated to what it
guards.

Signup single use is proved precisely because its 403 has that 200.

### Expiry is a dashboard value, and restoring it is part of the procedure

The setting is the dashboard field **Email OTP Expiration**, in seconds. No API
call was used.
- Observed at 3600, set to 120, then 300, for the attempt, and **restored to 3600
  by the founder.** The project's value is 3600.
- Lowering it changes production auth, so restoring it is a step of this
  procedure, not an afterthought. It is also the **last** step, for the reason
  given in the closing procedure below.

### Rate limit and Site URL, observed

- **HTTP 429 on the fourth OTP request of the sitting.** The count is what makes
  "the built-in sender cannot support this procedure" a measurement rather than an
  impression. That makes custom SMTP a prerequisite for facility one. It is
  recorded **once**, as one item with the email provider's written processor
  agreement, in the open processor obligations of
  `Sprint Kickoffs/decision-2026-09-14-public-private-split.md`. Point to it there;
  do not restate it here.
- **`redirect_to=http://localhost:3000` in both links examined.** That is the
  Supabase default Site URL. A ward clicking a real link today would be sent to
  their own machine. See the Site URL row of the un-automatable table at the end
  of this runbook.

### Hosted and local ran the same GoTrue on 2026-09-14: a snapshot, not a discharge

**Covered by tests: the local-integration leg only, against GoTrue v2.196.0**
(the build shipped by Supabase CLI 2.117.0, printed by the `golden-path` job on
every run from `/auth/v1/health`). `tests/e2e/golden-path.test.ts` mints a link
through the admin API, consumes it at the public `POST /auth/v1/verify`, and
asserts that a second use and an expired link are both refused with HTTP 403
`otp_expired`.

**Supabase can upgrade hosted auth at any time and without notice, while the CLI
pins the local version.** On 2026-09-14 the two matched: hosted `/auth/v1/health`
reported v2.196.0. The local single-use and expiry-refusal legs were therefore
proved against the binary hosted was running that day.

**That does not discharge any box above.** It is a snapshot that the next hosted
upgrade silently invalidates, and no test in this repository can reach hosted.
The boxes remain the only control over the hosted property.

Two details that change what the local leg proves, recorded because a reader
deciding whether these boxes are still needed will decide from them:

- Expiry is FORCED, by ageing `auth.users.confirmation_sent_at` past
  `otp_expiry`. Established by controlled probe with a positive control -- ageing
  `auth.one_time_tokens.created_at` instead has no effect at all. So what is
  proved is that GoTrue refuses a token whose sent-at is outside the window, not
  that it expires one on its own after an hour of real time.
- Only the email TRANSPORT is bypassed: the link is minted through the admin API,
  and the consumption leg runs for real over HTTP with the anon key. Nothing in the
  suite mints a session without consuming a link. *Restated 2026-09-23
  (R-2026-09-23-66): this read "`[local_smtp]` is disabled", which stopped being
  true when the mail catcher was turned on for
  `tests/db/ward_signin_request_live.test.ts` -- the one test where delivery is the
  property. The harness above still bypasses the transport, by choice.*

### How step 9 closes, so nobody re-derives it

**Precondition: custom SMTP is configured** (the email-provider row of the open
processor obligations in
`Sprint Kickoffs/decision-2026-09-14-public-private-split.md`). After that it
takes two emails and about five minutes, using the three blocks above.
`security@openbed.ng` is now confirmed, so every link it is sent is `magiclink`.

1. Run the key block. It must print `KEY OK`.
2. Run the link-request block. Check that the emailed link says `type=magiclink`.
3. Run the verify block with `"type":"magiclink"` in place of `"type":"signup"`.
   That word is the only change. It must print 200 and `SESSION ISSUED`. **This
   is the control.**
4. Run the verify block again with the same token. It must print 403
   `otp_expired`. Tick the magiclink single-use box.
5. In the dashboard, lower Email OTP Expiration (2026-09-14 used 120).
6. Run the link-request block for a second link, then wait past the lowered
   expiry.
7. Run the verify block with `"type":"magiclink"` and the second token. It must
   print 403 `otp_expired`. Tick the expiry box. The 200 in step 3 is what gives
   this 403 its meaning.
8. **Only then** restore Email OTP Expiration to 3600, and confirm the dashboard
   shows 3600. **This order is load-bearing, not tidiness. Do not reorder it for
   neatness** — for example, by restoring the setting straight after the second
   link is sent.
   - GoTrue does not stamp an expiry onto a link when it is sent. It judges
     expiry **when the link is verified**, comparing the link's sent-at time
     against the setting **in force at that moment** (supabase/auth v2.196.0,
     internal/api/verify.go, lines 685–692 and 791–793).
   - So restoring 3600 before step 7 puts the aged link back inside the window.
     Step 7 then prints **200** where 403 is required.
   - **That is a false fail, and it points the wrong way.** It reads as "hosted
     GoTrue does not enforce expiry", which is a finding about the vendor, when
     the only defect is the order the steps were run in.

Record the hosted auth version again when these are run. A change from v2.196.0
is a finding in its own right.

---


## 10. Realtime publication  *(was §6)*

> **GOVERNED BY THE RESTATE RULE** (step 5, R-2026-09-21-50): this step states an
> expected HOSTED state that a migration can falsify, so it is restated in the change
> that ADDS the migration. It was not restated for 018, and its stop condition would
> have returned `f` on a correct project. No script can check this one — the
> expectation is a hosted reading.

**EXACTLY the expected set, not "the expected ones are present".** A presence
check passes with a fourth table published, and a fourth published table is a
fourth stream of DELETE payloads nobody reviewed. So assert set equality, with no
schema filter — a table from any schema reddens it. The first line waits silently
for the connection string; the last line removes it from the shell. In the output,
the middle query's `publication_empty` column is the assertion: **PASS is `t`**.

**SINCE MIGRATION 018 THE EXPECTED SET IS EMPTY.** 018 removes all three mirrors
from `supabase_realtime`; this repository publishes nothing to Realtime after it.

*Restated 2026-09-22 (R-2026-09-22-52), in the change that records 018's hosted
apply.* **This was an expectation until 2026-09-22 and is now a hosted reading** —
the founder's post-apply run returned zero rows, `publication_exists t` and
`publication_empty t`, recorded in the checkbox below. Its failing half is step 5's
block B, which returned all three mirrors from the same query before the apply.

*Restated 2026-09-21 (R-2026-09-21-50), and it should have been restated in the
change that ADDED 018 — see the restate rule in step 5.* Until then the query
compared against `array['facility_public','lga_rollup','ward_public']` and PASS was
`exactly_three = t`. **After 018's hosted apply that query returns `f` on a
correct project** — a stop condition that fails on success, which is precisely what
step 5 says teaches people to ignore stop conditions. It was left behind by #61 and
found by a sweep.

**The discipline is unchanged and is the whole point: set equality, not a presence
check.** An empty expectation is the easiest of all to satisfy by accident — a
query against the wrong publication name returns no rows too — so the FIRST query
below now establishes that the publication EXISTS before the second asserts it is
empty.

**Step P's PATH line is carried in below**, because this block calls `psql` itself.

```bash
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
read -rs DATABASE_URL && export DATABASE_URL
psql "$DATABASE_URL" <<'SQL'
select schemaname, tablename from pg_publication_tables
 where pubname = 'supabase_realtime' order by tablename;

select exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       as publication_exists;

select coalesce(array_agg(tablename::text order by tablename), '{}')
       = '{}'::text[] as publication_empty
  from pg_publication_tables where pubname = 'supabase_realtime';

select relname, relreplident from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and relname in ('facility_public','ward_public','lga_rollup');
SQL
unset DATABASE_URL
```

- [x] The publication contains **exactly** `facility_public`, `lga_rollup`,
      `ward_public` — 2026-09-13, project `klrlpxysjsjpdkeqdhvl`: those three,
      exactly 3 rows. **SUPERSEDED by migration 018 (R-2026-09-21-50).** Left
      ticked as the dated record it is.
- [x] **`publication_exists` is `t` AND `publication_empty` is `t`** — 2026-09-22,
      founder's run on `klrlpxysjsjpdkeqdhvl` after 018's hosted apply
      (R-2026-09-22-52). Both, in that order — the first is what stops an empty
      result from meaning "wrong publication name", and it is `t`, so the empty set
      below is an empty publication rather than a missing one. The first query
      returned **`(0 rows)`**, and `relreplident` is still `d` on all three.
      **Failing half: step 5's block B**, where the same `pg_publication_tables`
      query against the same project returned
      `facility_public, lga_rollup, ward_public` before the apply.
- [x] `relreplident` is `d` for all three — **MOOT since 018, not false.** These
      tables are no longer published, so no DELETE payload leaves them at all; the
      check is kept as a tripwire for the day one is published again, and the
      observed values below are still correct. —
      **never `f`.** `FULL` ships the whole old row in a DELETE payload, Realtime
      DELETE events are not RLS-filtered, and quiet mode removes rows by DELETE.
      2026-09-13: `facility_public` d, `ward_public` d, `lga_rollup` d

The local half is asserted by `tests/db/config_drift.test.ts`, per 013's header —
**and since 018 it asserts that the publication EXISTS and that its membership
equals the (now empty) list in `packages/fixtures/public-relations.json`**, which
is the same exists-then-compare shape as the two queries above. The
`relreplident` half is unchanged. These checkboxes are the hosted half.

---


## 11. Keys  *(was §7)*

- [ ] **OPENS WHEN BUNDLE 3 SHIPS A SERVER. Do not tick before then.**
      `service_role` key stored in the server-side secret store only.

      **There is no server yet, so there is no server-side secret store for this
      to describe.** Ticking it would certify a store that does not exist — the
      phantom Clause 4 of `.claude/rules/code-pipeline.md` forbids. What is
      observed instead, 2026-09-13, project `klrlpxysjsjpdkeqdhvl`:

      - The key exists in Supabase and in **no repository file**.
      - There is **no `.env` at the repository root**, and none is tracked.
      - **No `NEXT_PUBLIC_*` or `VITE_*` assignment exists anywhere in the
        tree.** The only `VITE_` names in application code are two **reads** of
        public values in `apps/ward-console/src/main.ts`
        (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
        - **SUPERSEDED 2026-09-22 — it is ONE read now, not two**
          (R-2026-09-22-59). `VITE_SUPABASE_URL` is gone: the origin is tracked
          configuration in `packages/origins/origins.json`. The reading above is
          left as it was taken, because a dated observation is not rewritten to
          match a later state; **the conclusion it supports is unchanged and
          strengthened** — one fewer public value is carried in an untracked file.
      - **Every `service_role` string in the repository is a name, never a key
        value.** It is the Postgres role name in SQL and test code, and otherwise
        the filename of `scripts/lint_no_service_role_in_bundle.sh` where other
        files cite it; that guard's detection patterns in
        `scripts/scan_bundle_credentials.mjs`; comments about the legacy JWT in
        `scripts/get_publishable_key.sh`; a comment in `supabase/config.toml`; the
        key's *name* field in
        `packages/fixtures/supabase-api-keys-response.redacted.json`; and prose in
        docs, rules and sprint kickoffs.
- [x] It appears in no `NEXT_PUBLIC_*` or `VITE_*` variable anywhere — 2026-09-13,
      per the observed state above
- [ ] Rotation procedure read: [`runbook-key-rotation.md`](runbook-key-rotation.md)
      — the founder's own attestation, left for them to tick

---


## What remains un-automatable, and stays that way

| Property | Why no test can cover it |
|---|---|
| Region pin | Assertable via the Management API, declined on credential-surface grounds |
| Hosted exposed-schemas list | A dashboard setting with no in-database representation — **but not unobservable.** Discharged by hand probe on 2026-09-13: the live project's `PGRST106` body carries `hint: "Only the following schemas are exposed: public, graphql_public"` (step 2). No test carries it, because the suite never targets hosted (step 6). `extra_search_path` is a separate setting, discharged by its own single-field probe on 2026-09-13 (step 2): `public, extensions`, the untouched Supabase default |
| Hosted Auth Site URL and redirect allowlist | A dashboard setting with no in-database representation, the same idiom as the exposed-schemas list. Decided 2026-09-14 (`Sprint Kickoffs/decision-2026-09-14-public-private-split.md`, D2): the Site URL is on `app.openbed.ng`, the allowlist is confined to it, and `openbed.ng` is never an auth redirect target. **Observed 2026-09-14 (step 9): the hosted Site URL is still http://localhost:3000, the Supabase default.** It arrives as `redirect_to` in every link examined, so a ward clicking a real link today is sent to their own machine. It becomes https://app.openbed.ng when the app exists. Record the exact hosted strings here when they are entered. The values in `supabase/config.toml` are local-only |
| Hosted role attributes | A property of Supabase-managed roles; no migration can assert it and a platform upgrade or project restore can change it. **Observed 2026-09-15 by Cowork, read-only:** hosted `postgres` and `service_role` are both `rolsuper f`, `rolbypassrls t`, identical to local. The old row said the local role graph differs from the hosted one; on these attributes it does not. Re-observe after any Supabase platform change |
| Hosted auth session bounds (`timebox`, `inactivity_timeout`) | A dashboard setting with no in-database representation. Both bounds ARE proved locally in `tests/db/auth_refresh_live.test.ts`; the hosted values are step 3 |
| Magic-link single-use and expiry | Enforced by Supabase auth, not by this schema, since `app.invite` no longer holds a token. Step 9 is the hand check, partly closed on 2026-09-14. Closing it needs custom SMTP, which is recorded once, as the email-provider row of the open processor obligations in `Sprint Kickoffs/decision-2026-09-14-public-private-split.md` |
| E2E harness: `session_replication_role` via supautils — **LOCAL AND CI ONLY** | A vendor dependency of `tests/e2e/_harness.ts`'s `seedE2eCorpus()`, found 2026-09-15 while correcting a false "because superuser" claim. Setting `session_replication_role` needs superuser **by default**, and `postgres` is `rolsuper f`. On PostgreSQL 17 (`supabase/config.toml` pins `major_version = 17`) there is another route: `GRANT SET ON PARAMETER session_replication_role`, available since PG15. **That route is not the one in use here:** `has_parameter_privilege('postgres', 'session_replication_role', 'SET')` is f (observed 2026-09-15). `postgres` can set it because it is a member of `supabase_privileged_role` (= `supautils.privileged_role`), and `session_replication_role` is on `supautils.privileged_role_allowed_configs`. **Observed** locally on 2026-09-15, and in CI on 2439938 through the `golden-path` job's frontier ratchet, `tests/e2e/ratchet.test.ts`. That is 10 tests, not the 20-step golden path. Its anti-vacuity leg, and its "every step at or before the frontier PASSED" leg, cannot be green unless the corpus seeded, and both were green. **Failure mode:** grant absent → `seedE2eCorpus()` fails loudly and seeds nothing, never half a corpus. **Not a hosted dependency:** the E2E never targets the hosted project, so there is no hosted equivalent to look for. Re-observe after a Supabase CLI or Postgres image upgrade |
| Branch protection and its required-check set | A GitHub setting; reading it in CI needs a token this public repository should not carry |
| Push protection | A GitHub repository setting; CI runs after the push |

Adding a test that appeared to cover any of these would be worse than the gap,
because it would stop anyone looking.

