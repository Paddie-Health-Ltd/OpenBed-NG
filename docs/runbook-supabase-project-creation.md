# Runbook — Creating the hosted Supabase project

**This is a hand checklist. Nothing in this repository can enforce any of it, and
that is why it is written down rather than tested.**

Several properties this system depends on live in the Supabase dashboard, not in
the schema. A test claiming to verify them would be phantom enforcement
(`.claude/rules/code-pipeline.md`, Clause 4). Each step below says what the local
suite *does* cover, so the gap is visible rather than implied.

Work through this in order. Steps 1 and 2 cannot be undone later.

---

## 1. Region — `af-south-1` (Cape Town). **LAUNCH BLOCKER.**

Select `af-south-1` at project creation.

**The region is fixed at creation and cannot be changed.** Moving later means
creating a new project and migrating data, which for this system means a
migration of health-facility operational data with an outage in the middle.

Why it matters beyond latency: it keeps the data on the continent, which is
materially easier to defend under NDPA s.41 transfer rules, and it is the better
answer to a facility that asks where their numbers are stored.

- [ ] Project created in `af-south-1`
- [ ] Verified in Dashboard → Settings → General → Region

**Covered by tests: nothing.** No query can report a project's region to the
suite. This checkbox is the only control.

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

- [ ] Branch protection on `main` requires all six checks: `repo-lint`,
      `migration-lint`, `compliance-tests`, `db-tests`, `bundle-guards`,
      `secret-scan`
- [ ] Secret scanning **with push protection** enabled — this is the prevention
      control; the `secret-scan` CI job is only detection
- [ ] Private vulnerability reporting enabled (referenced by `SECURITY.md`)

---

## What remains un-automatable, and stays that way

| Property | Why no test can cover it |
|---|---|
| Region pin | Not exposed to any query the suite can run |
| Hosted exposed-schemas list | A dashboard setting with no in-database representation |
| Hosted superuser semantics | The local role graph differs from the hosted one |
| Magic-link single-use and expiry | Enforced by Supabase auth, not by this schema, since `app.invite` no longer holds a token |
| Push protection | A GitHub repository setting; CI runs after the push |

Adding a test that appeared to cover any of these would be worse than the gap,
because it would stop anyone looking.
