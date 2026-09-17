# Sweep of the v1 kickoff — the enumeration

_Recorded 2026-09-17. The v1 kickoff had never been swept. Ruled its own pass on
2026-09-16, after 017; run against the tree at `db528f8`._

This is the enumeration behind the verdict table in
`Sprint Kickoffs/sprint-kickoff-bedspace-v1-2026-09-08.md`, section
*Sweep — recorded 2026-09-17*. It is committed rather than left in a session
transcript, which is R-2026-09-15-10 A2 applied to this sweep from the start.

**Unit.** One enumerated claim per numbered item: a present-tense assertion at
its citation in the kickoff. The same unit as
`sweep-2026-09-15-v2-enumeration.md`, so the two counts are comparable. An item
carrying several assertions takes one verdict, and where an item has a part that
is not checkable from the repository it takes its repository-checkable verdict.

**What is in scope, and the one way this differs from the v2 sweep.** v1 was
written on 2026-09-08, before any code existed, so most of its body is task
checkboxes — imperatives, not assertions — and those are **out**. A checkbox is
enumerated only where it carries an embedded present-tense assertion
(`:139` "`reason_code` does not exist on this table"), and rationale and
blast-radius prose are **in**, per method note 7: an explanation carrying a
decision is a premise too. Method note 6 sets the target: every present-tense
assertion that something exists, is in place, was stood up, runs or is asserted.

**Method note 8 applied.** Each finding below is marked LIVE RULE (binds future
behaviour, must be correct now — amend it) or DATED RECORD (describes a moment —
supersede with a note, never rewrite). v1 mixes the two more heavily than v2 did,
because its architecture sections are decisions and its bundle sections are
instructions.

**Line numbers** are the kickoff as read at `db528f8`. Two sweep markers from
2026-09-16 (`:65`, `:293`, `:363`) are already in the file and shift nothing
below them that this pass cites. `M/` means `database/migrations/`.

**Verdict words**, carried over unchanged. HOLDS = VERIFIED. FAILS = SUPERSEDED,
failed. STALE = true when written; the repository or the world moved on.
SUPERSEDED-IN-DOC = superseded by a later section of the kickoff, or by an
implementation decision that recorded its own reason. NOT CHECKABLE = a vendor,
hosted or history fact, **or a check this pass could not run** — `psql` and
Docker are both absent from this machine, so two mechanism questions are handed
to Claude Code rather than answered from reading. A check that could not run does
not report a verdict.

| Verdict | Count | Items |
|---|---|---|
| HOLDS (VERIFIED) | 66 | every item not listed below |
| FAILS | 21 | #5, #13, #15, #28, #30, #31, #36, #63, #71, #78, #79, #87, #88, #89, #90, #92, #97, #107, #109, #115, #116 |
| STALE | 12 | #1, #4, #25, #33, #41, #51, #61, #91, #95, #110, #113, #117 |
| SUPERSEDED-IN-DOC | 7 | #22, #48, #55, #72, #86, #96, #104 |
| NOT CHECKABLE | 11 | #3, #12, #19, #20, #26, #27, #29, #69, #80, #81, #111 |

Total 117. Every item below ends with its verdict in bold; the last bold verdict
word in an item is its verdict, and the table above is derived from those, not
typed alongside them — see the reconciliation at the end.

**The two questions this pass could not answer, and hands over.** Both are
mechanism claims, which is where the record says Cowork's errors live:

- **#12** — whether `is false` is even applicable to a `tri_state` enum column.
  v1:35 prescribes it; the shipped form is `IS NOT DISTINCT FROM 'NO'`.
- **#27** — whether an `anon` key receives Realtime change events on
  `public.ward_public`, which is what v1:73's "authenticated devices only" turns
  on. The three relations in the `supabase_realtime` publication are exactly the
  anon-readable mirrors.

**Found in passing, outside the enumeration:**

- `scripts/lint_sql_no_bare_not_duty_flag.sh:29` says "the 48-row truth table".
  The fixture is 60 rows and `tests/db/gate_truth_table.test.ts:130-131` asserts
  "exactly 3 x 10 x 2 = 60". This is item #61's stale count, propagated into a
  guard's own header. The script is live and editable.
- `M/004:294` carries "`/api/health` returns 500 when it …" — item #87's dead
  premise inside an applied migration. 004 is frozen: it takes a supersede note,
  not an edit.
- `M/005:211`'s "Validation for patient information also runs at the RPC layer"
  was found false by the v2 sweep (#7) and is reconfirmed here independently. It
  is the mechanism behind items #63 and #97.
- v1:137's enum list names ten types and omits `gate_reason`, `alert_cause`,
  `alert_state` and `notification_channel`; fourteen exist. Already recorded at
  `database/migrations/README.md:36`. It is a task list, so it is not enumerated.

---

## Header and division of responsibilities

1. **v1:5** "Domain: `toni.health`" — the product is **OpenBed** and the domain
   **openbed.ng**, decided 2026-09-13. `NOTICE:40` already names both, and
   `SECURITY.md:11` already uses `security@openbed.ng`. DATED RECORD in this
   position — it is a header stating what was true on 2026-09-08. **STALE**.
2. **v1:5** "Escalation channel at launch: **email**" — `M/002:378`
   `app.notification_channel` is `EMAIL, IN_APP, SMS, WHATSAPP`, which is the
   adapter shape this names. The dispatcher is unbuilt; the decision stands.
   **HOLDS**.
3. **v1:4** "Reviewed by: cto-persona, clco-persona, staff-engineer,
   platform-sre" — history. **NOT CHECKABLE**.
4. **v1:11** "The only genuinely open items are in *Open decisions needing your
   call*" — true when written. The open set is now larger and lives elsewhere:
   O1 and O2 by prior ruling, B1 and B2 founder-side, step 9's two remaining
   legs, the rotation attestation, and the `noindex` ruling. **STALE**.
5. **v1:13** "Three findings are design-level … **Two of them** reverse
   decisions made earlier in the scoping session" — **known failure, confirmed by
   running it.** `grep -n REVERSED` on the kickoff returns four lines: `:11`
   (the sentence defining the marker), `:37` (F3), `:61` (A1) and `:242`
   ("[REVERSED, partially]"). Of the three findings F1, F2 and F3, **exactly one**
   carries the marker. A1 is an architecture decision, not one of the three
   findings, and the sentence is explicitly about the findings. LIVE RULE only in
   the weak sense that it tells a reader what to expect; it is wrong either way.
   **FAILS**.

## The three findings

6. **v1:23** the gate is "derived at read time, in exactly one place, and written
   only into the public projection" — `M/006` is the single derivation site
   (`app.gate`, IMMUTABLE), `M/008` writes the result into `public.ward_public`
   and nowhere else. The TypeScript mirror at `packages/gate/src/gate.ts` is
   pinned to the same fixture in one `test.each` block, which is the kickoff's
   own :154 requirement rather than a second authority. **HOLDS**.
7. **v1:25** "A generated column cannot read another table" — an engine fact,
   restated as the stated reason at `M/006:24`. Not run here; it is the premise
   the repository acted on and the repository agrees. **HOLDS**.
8. **v1:27** "The gate **reduces only**. A `YES` flag can never promote a ward
   that said it is not accepting." — `M/006:120-121`, "Reduces only -- it can
   never promote a ward that said it is not accepting", and the 60-row truth
   table exercises both claim values against all three flag states. **HOLDS**.
9. **v1:31** "`NOT NULL DEFAULT 'UNKNOWN'`. Only an explicit `NO` gates
   anything." — `M/002:81` creates `app.tri_state` as `('UNKNOWN','YES','NO')`
   and `M/006` gates on `IS NOT DISTINCT FROM 'NO'`, so `UNKNOWN` and `YES` both
   return NULL. **HOLDS**.
10. **v1:33** "`not anaesthetist_on_duty` on a NULL evaluates to NULL … the row
    silently drops out of any filtered query while the JavaScript version reports
    it as truthy. The two layers disagree and neither errors." — restated almost
    verbatim as the stated reason at
    `scripts/lint_sql_no_bare_not_duty_flag.sh:10-13`, which is the guard built
    on it. **HOLDS**.
11. **v1:33** "that single line renders **every hospital in Lagos as closed**" —
    the day-one `UNKNOWN` case, and `eslint.config.mjs:33-35` carries the same
    sentence as its rule message: "`!flag` treats the day-one UNKNOWN as closed
    and renders every hospital as unavailable". **HOLDS**.
12. **v1:35** "use `is false` / `is not false` in SQL — never bare `not`" — the
    bare-`not` prohibition is enforced
    (`scripts/lint_sql_no_bare_not_duty_flag.sh`, planted both ways in
    `tests/compliance/lint_sql_bare_not_duty_flag.test.ts`). The **prescribed
    positive form is not what shipped**: `M/006` uses
    `IS NOT DISTINCT FROM 'NO'`, and the duty flags are an enum, not a boolean,
    which is F2's own decision two lines earlier. Whether `is false` against an
    enum column is a type error — which would make this sentence prescribe
    something that cannot compile, and would also make
    `lint_sql_no_bare_not_duty_flag.sh:15`'s list of "correct forms" wrong —
    needs a live database. `psql` and Docker are absent here. **NOT CHECKABLE**
    this pass; handed to Claude Code.
13. **v1:41** "the client computes `skew = server_now - Date.now()` and anchors
    it against `performance.now()`" — **known failure, confirmed.** There is no
    skew term anywhere: `grep -rn skew` across the tree returns only
    `packages/auth` session-expiry flight time and a *test of the opposite*.
    `packages/snapshot/src/anchor.ts:17` gives the shipped formula as
    `age = (server_now - updated_at) + (monotonic elapsed since the fetch)`, and
    `:21` states "There is no third term, and adding one -- a `Date.now()`
    anywhere in the display path -- reintroduces F3 in full." So the mechanism
    this sentence prescribes is the one the implementation explicitly bans.
    `tests/compliance/freshness_bands.test.ts:67-69` asserts a device clock three
    hours out in either direction does not change the band. LIVE RULE, and the
    code is right. **FAILS**.
14. **v1:41** "anchors it against `performance.now()` (monotonic, survives a
    mid-session clock jump)" — `packages/snapshot/src/anchor.ts:46-56`,
    `markFetch()` and `elapsedSince()`, monotonic and never negative. The
    monotonic half of F3 shipped exactly as described. **HOLDS**.
15. **v1:41** "If skew has never been anchored by a successful fetch, the badge
    degrades to 'age unknown' — never green." — with no skew term there is
    nothing to anchor, and the never-anchored case is
    `anchor.ts:46-49`: where `performance.now()` is absent the elapsed term is
    `0`, which `:41-44` calls "a known, bounded, honest degradation" that
    "understates age". An understated age **can** render GREEN. The
    never-green guarantee survives only for unparseable input, which
    `freshness.ts:52-57` returns as `SUPPRESSED`. The property v1 wanted is
    delivered by a different and better route, but not the one this sentence
    states, and as worded the guarantee is false. **FAILS**.
16. **v1:41** "Clamp negative ages to zero." — `packages/snapshot/src/freshness.ts:62`,
    `Math.max(0, serverNow - updatedAt) + Math.max(0, elapsedSinceFetchMs)`, with
    the reason given: a negative age "would sort fresher than anything real".
    **HOLDS**.
17. **v1:41** "Render absolute timestamps with an explicit `Africa/Lagos`
    timezone, not device locale." — asserted in the golden path at
    `tests/e2e/golden-path.test.ts:316-317` and named as a step in
    `packages/fixtures/golden-path-steps.json:87`. **HOLDS**.
18. **v1:43** "`updated_at` is set by a `BEFORE UPDATE` trigger using `now()`,
    and clients may never supply it" — `app.touch_updated_at()` at `M/003:62-71`
    does `NEW.updated_at := now()`, its comment at `:74` says it discards
    "whatever the client sent", and five `trg_*_touch` triggers attach it
    (`M/003:136,184,357`, `M/004:128,313`). **HOLDS**.

## Sprint scope

19. **v1:51** the five out-of-scope items "plausibly bring BedSpace inside
    medical-device regulation" — a CLCO judgment, not a repository fact.
    **NOT CHECKABLE**.
20. **v1:53** the accuracy score "was already suppressed during pilot, so nothing
    is lost" — history. **NOT CHECKABLE**.
21. **v1:55** "B7 runs alongside from commit one" — `.github/workflows/ci.yml`
    carries seven jobs and the `scripts/lint_*` family and
    `tests/compliance/` both date from the earliest migrations. **HOLDS**.

## A1 — the static snapshot

22. **v1:65** "`GET /beds.json` is regenerated every 60 seconds … `s-maxage=60,
    stale-while-revalidate=600`" — already swept 2026-09-16, marker in place.
    The headers are superseded within the document by :235's
    `s-maxage=30, stale-while-revalidate=300`. **SUPERSEDED-IN-DOC**.
23. **v1:65** "the ward projection as arrays-of-arrays" — `packages/snapshot/src/codec.ts`
    builds its encoder and decoder from `snapshot-shape.json`'s `wardColumns` and
    `facilityColumns` at module load, and the golden payload in that fixture is
    arrays-of-arrays. "Roughly a third the bytes" is unmeasured and takes the
    repository-checkable verdict. **HOLDS**.
24. **v1:65** "The client does haversine locally, so **the user's coordinates
    never leave the device**" — recorded as a binding property at `M/007:67`
    ("The client does haversine locally against these, which is why the USER's
    …") and `M/012:9`, and there is no coordinate in any request path because
    there is no request path: the client is a static build against a CDN
    document. The tile itself is unbuilt. **HOLDS**.
25. **v1:70** "The Supabase free tier caps … 200 concurrent Realtime connections
    … Uncached egress of 5GB" — true of the free tier when written; the project
    has been on Pro since 2026-09-12, which v1:396 itself settles. DATED RECORD.
    **STALE**.
26. **v1:71** "Supabase Realtime has no gap-fill — events missed while
    disconnected are gone permanently" — vendor behaviour. **NOT CHECKABLE**.
27. **v1:73** "**Realtime is retained for authenticated ward and admin devices
    only**" — `M/013:41` adds exactly `public.facility_public`,
    `public.ward_public` and `public.lga_rollup` to `supabase_realtime`, and
    those three are the **anon-readable** mirrors; `public.snapshot_current` is
    deliberately not published (`config_drift.test.ts:146`). Nothing subscribes
    yet — `grep -rn "subscribe\|channel(" apps/*/src/*.ts` returns nothing — so
    the consumer side is unbuilt. Whether an `anon` key would in fact receive
    change events on `ward_public`, which is what "authenticated only" turns on,
    needs a live database. **NOT CHECKABLE** this pass; handed to Claude Code.
28. **v1:75** "'Tile flips live via Realtime with no refresh' becomes 'tile flips
    within 60 seconds with no refresh.'" — **known failure, confirmed.**
    `packages/fixtures/golden-path-steps.json:4` records the restatement in full:
    the clause "was written against the Realtime design that A1 reversed",
    `stale-while-revalidate=300` "may legitimately serve a five-minute-old
    payload", so "the original clause encodes a requirement the chosen
    architecture cannot meet", and it was restated on 2026-09-10, founder's call,
    to "a client poll at the snapshot's own cadence reflects the new count". LIVE
    RULE — it is the wording of a release gate. Paired with #107. **FAILS**.

## A2, A2b — hosting and domain

29. **v1:81** "Vercel Hobby is non-commercial-use only" — vendor terms.
    **NOT CHECKABLE**.
30. **v1:81** "**Authenticated app routes and the API stay on Vercel.**" —
    **known failure, confirmed independently of R-2026-09-16-07.** There is no
    `vercel.json` at the root or in either app, no `api` directory anywhere, and
    `apps/public-dashboard` and `apps/ward-console` are both Vite static builds
    (`vite.config.ts`, `build.sh`). R-2026-09-16-07 found the same absence from
    the `/api/sweep` end and marked :293; **this sentence is where the claim
    originates and it has no marker.** LIVE RULE: it names a hosting split that
    does not exist, and three B5 items (#87, #88, #89) rest on it. **FAILS**.
31. **v1:85** "Public dashboard at `toni.health`, authenticated app at
    `app.toni.health`, transactional mail from `toni.health`" — the domain is
    `openbed.ng` since 2026-09-13. Unlike #1 this is a **LIVE RULE**: it names
    the hostnames a deployment and a sending reputation get built on, and :284
    makes the sending domain a pre-send gate. It must be amended, not
    superseded. **FAILS**.
32. **v1:87** the lead-generation exposure, and a separate domain making the
    non-commercial covenant "structural rather than contractual" — the argument
    is about separateness, not about the specific string, and it survives the
    rename intact; `NOTICE:38-45` carries the trademark half and
    `README:33-42` the covenant half, stated honestly. **HOLDS**.
33. **v1:89** "'BedSpace' is arguably descriptive … If the product name follows
    the domain, the trademark problem largely dissolves. That is a naming
    decision … flagged, not assumed." — the decision has since been taken:
    OpenBed, 2026-09-13. Pairs with #113. DATED RECORD. **STALE**.

## A3 — the security boundary

34. **v1:93** "RLS is row-level. Every requirement here is a column requirement
    or an aggregation requirement, and RLS can express neither." — the shape the
    whole boundary is built on: `rls_anon_column_containment.test.ts` asserts
    the column set, `lga_rollup_kfloor.test.ts` the aggregation floor, and
    neither is expressible as a `USING` clause. **HOLDS**.
35. **v1:95** private base tables in an `app` schema not in the exposed-schemas
    list; `public` holds only projections plus the RPC surface —
    `packages/fixtures/public-relations.json` gives `exposedSchemas` as
    `["public","graphql_public"]`, `config_drift.test.ts:130` asserts it against
    `supabase/config.toml`, and `M/001:99-130` is the revoke wall. **HOLDS**.
36. **v1:99** "`SECURITY DEFINER` functions default to `EXECUTE` for `PUBLIC` …
    Every RPC needs `REVOKE EXECUTE ... FROM PUBLIC` then `GRANT ... TO
    authenticated`." — **known failure, confirmed, and the most consequential
    item in this sweep.** `M/001:143-160` records what was actually observed: a
    fresh Supabase project's `pg_default_acl` grants EXECUTE on functions in
    `public` to `anon`, `authenticated` and `service_role` **by name**, so
    "every function created in `public` arrives EXECUTABLE BY ANON, and a
    `REVOKE ... FROM PUBLIC` is a no-op against it." It was "Found by
    `tests/db/rls_rpc_execute_allowlist.test.ts` on its first run against
    migration 011, **which had revoked only from PUBLIC**" — that is, against a
    migration that did exactly what this sentence prescribes. 001 therefore
    revokes the default from PUBLIC **and** from all three named roles
    (`M/001:161-163`), and `config_drift.test.ts:169` asserts the by-name default
    is gone. The decision record already logged the narrower version of this
    correction on 2026-09-15 ("The EXECUTE claim stated a Postgres default … as
    an observed fact about this database. It was not in force here") and made it
    method note 2; **the v1 sentence it came from was never corrected.** LIVE
    RULE, and the prescribed remedy is demonstrably insufficient. **FAILS**.
37. **v1:100** "Every definer function needs `SET search_path = ''` with
    fully-qualified names, or a caller-controlled search_path is privilege
    escalation." — `tests/db/rpc_definer_safety.test.ts` asserts it across the
    catalogue, and every function in `M/006`, `M/011`, `M/014` and `M/016`
    carries it. `M/006:68-69` gives the same reason. **HOLDS**.
38. **v1:101** "Realtime `DELETE` events are **not** RLS-filtered, and `REPLICA
    IDENTITY FULL` ships the whole old row … Never delete from a published table
    (tombstone instead)" — the vendor half is not run here. The repository half
    is enforced and, notably, the design **does** delete from a published table:
    `M/008:34` "QUIET MODE IS A DELETE FROM THE MIRROR, AND THAT NEEDS
    DEFENDING", safe only because `M/007` pins all three mirrors to REPLICA
    IDENTITY DEFAULT, which ships nothing but the primary key
    (`config_drift.test.ts:133-138`), backed by
    `scripts/lint_no_replica_identity_full.sh`. The prohibition's *reason* is
    load-bearing and correct; its *form* ("never delete") is not what shipped,
    and the deviation is defended in place. Takes its repository-checkable
    verdict. **HOLDS**.

## A4, A5 — region and attribution

39. **v1:105** region pinned `eu-west-1`, ref `klrlpxysjsjpdkeqdhvl`, verified
    via the Management API on 2026-09-09 — `database/migrations/applied-hosted.json:13`
    carries the ref and `docs/runbook-supabase-project-creation.md:318-325`
    carries both with the verification date. **HOLDS**.
40. **v1:111-113** the three original rationales, struck: "keeps data on the
    continent" false and unachievable; the s.41 leg "never followed from the
    geographic claim"; Lagos latency "unmeasured, and not claimed either way" —
    a correctly-marked DATED RECORD, and the second is method note 7's shape
    caught before the note existed. **HOLDS**.
41. **v1:115** the residue attaches to "the **same single open CLCO item already
    on file**, not a new thread" — the founder-side legal set is now several
    threads: B1 the facility agreement, B2 custom SMTP with the NDPA s.29
    processor agreement, and Cloudflare's s.29 agreement and s.41 transfer
    basis. True when written. **STALE**.
42. **v1:121** "`actor_identity_map` does not exist. The actor is
    `(facility_id, ward_category)`." — no such table is created anywhere;
    `M/004:169` and `M/005:7` both record it as deleted, and
    `rls_enabled_everywhere.test.ts:81` carries it on the OUT list. **HOLDS**.
43. **v1:123** "the audit log needs no retention period and no partitioning;
    append-only and permanent is correct" — `M/010` enforces append-only on
    `app.audit_log` with a revoke and an `ENABLE ALWAYS` trigger, and no
    retention job exists. Contradicted by v1:408; see #116. **HOLDS**.
44. **v1:123** "The two irreducible residues are the login address held by
    Supabase in `auth.users`, and one invited human per facility in
    `app.facility_contact` … deliberately outside the append-only set so it stays
    erasable." — `app.facility_contact` is created in `M/003` and is not among
    the two tables `M/010` locks. **HOLDS**.
45. **v1:119** "The original A5 design … is **superseded and not built**" — it
    is not built. **HOLDS**.

## Bundle 1

46. **v1:136** the fifteen `app` base tables — all fifteen exist, across `M/003`,
    `M/004` and `M/005`; checked one by one, none absent. `app.schema_migrations`
    is the sixteenth and is the ledger, not a base table. **HOLDS**.
47. **v1:139** "`reason_code` **does not exist on this table**" (`ward_status`) —
    `M/004:58` "NOTE WHAT IS ABSENT: there is no `reason_code` column on this
    table", and the column appears only on `app.ward_status_event` at
    `M/004:160`. **HOLDS**.
48. **v1:141** "`app.gate(category, ops)`" — the shipped signature is
    `app.gate(ward_category, tri_state, tri_state, tri_state)`, and `M/006:28-35`
    names the deviation and its reason: a composite argument "changes this
    function's signature every time a column is added to that table, which is
    hostile to IMMUTABLE and to a TypeScript mirror", with
    `app.gate_for_facility()` restoring the ergonomic form for the trigger,
    semantics identical. Superseded by an implementation decision that recorded
    itself. **SUPERSEDED-IN-DOC**.
49. **v1:141** "immutable SQL function, the single derivation site … Returns a
    gate reason or NULL; `UNKNOWN` and `YES` both return NULL" — `M/006:67`
    `IMMUTABLE`, `LANGUAGE sql`, returning `app.gate_reason`, and `M/006:120`
    states the `UNKNOWN`/`YES` behaviour. **HOLDS**.
50. **v1:142** projection tables in `public` — `facility_public`, `ward_public`
    (carrying `accepting_effective`, `gated_by`, `state`, `source`,
    `updated_at`), `lga_rollup`; "Real tables, not views" — `M/007` creates all
    three as tables, and `snapshot-shape.json`'s `wardColumns` carries every
    named column plus `monitoring_state`, which is a superset of what v1 lists.
    **HOLDS**.
51. **v1:143** "Projection trigger fires on **both** `ward_status` and
    `facility_ops`" — there are **three** triggers on three tables
    (`M/008:64-71`), and `M/008:25-33` says the third is "REQUIRED, and not named
    in the kickoff's task list … quiet_mode and is_active live on this table …
    Without this trigger, flipping a facility to quiet would leave its rows
    sitting in the public mirrors indefinitely — the exact opposite of what quiet
    mode means." True when written; the design moved on, and the gap it closes is
    quiet mode itself. **STALE**.
52. **v1:144** "`gated_by` … and `zero_reason.NO_ANAESTHETIST` … must be
    different types with different UI strings" — `M/002:162-167`: `gate_reason`
    "MUST NOT share values with zero_reason … The values here are deliberately
    longer and differently worded so a copy-paste between the two switches fails
    to compile rather than silently leaking." **HOLDS**.
53. **v1:145** "Quiet mode enforced in the **projection**, not a policy: a quiet
    facility's rows are simply not written to the public mirrors. Its
    contribution goes to `lga_rollup`." — `M/008:34` states the deletion
    mechanism, `M/009` computes the rollup, and
    `tests/db/projection_quiet_mode.test.ts` asserts zero mirror rows for a quiet
    facility. **HOLDS**.
54. **v1:146** "a k-floor of 5 reporting facilities" — `M/009:7`,
    `CHECK (facility_count >= 5)` on the table. **HOLDS**.
55. **v1:146** "and no facility exceeding **40% of the denominator**" —
    "the denominator" was ambiguous and the ambiguity was load-bearing.
    `M/009:23` flags it — "Those are two different phrases and could" differ —
    and `:36-37` records the resolution: facility **count** "was considered and
    REJECTED deliberately, because with k >= 5 any single facility is at most
    1/5 = 20% of the count, so a 40% rule could" never fire. The shipped rule is
    40% of total **beds** (`M/009:131`, `:143-144`). A method note 7 case: the
    phrase carried a decision and the two readings differ materially, one of them
    being a dead control. **SUPERSEDED-IN-DOC**.
56. **v1:147** "Append-only enforcement … `REVOKE UPDATE, DELETE` from **all**
    roles including the writer, **plus** a `BEFORE UPDATE OR DELETE` trigger that
    raises" — `M/010:10-11` states both legs, `:93-95` revokes including
    `service_role`, and `:64-65` declares both triggers `ENABLE ALWAYS`, which is
    stronger than asked: `tgenabled 'O'` would not fire under
    `session_replication_role = 'replica'`. **HOLDS**.
57. **v1:148** "Read RPCs hard-capped: ≤200 rows, ≤30-day window, no deep offset
    paging, no CSV" — `M/011:225-226` "no p_offset, no p_facility_id, no
    p_format", `:263-264` clamps the window to 30 days silently rather than
    rejecting, `:275` `LIMIT least(coalesce(p_limit, 200), 200)`. **HOLDS**.
58. **v1:149** "Nigeria bounding-box `CHECK` constraints on lat/lng" —
    `M/003:116-117`, `lat BETWEEN 4.0 AND 14.0`, `lng BETWEEN 2.5 AND 15.0`, with
    the padding reasoned at `:115`. **HOLDS**.
59. **v1:150** the seven indexes and "**No PostGIS**" — all seven are in `M/012`
    at `:41,50,56,61,69,72,76`, and `M/012:8` states the PostGIS refusal. The one
    drift is that v1 writes `referral(facility_id, state, created_at desc)` where
    the table has two facility columns; the index resolves it to
    `receiving_facility_id`, which is the only reading the B6 ward-to-ward shape
    permits. **HOLDS**.
60. **v1:152** "Config drift: `pg_publication_tables` for `supabase_realtime`
    equals exactly the three mirrors; no published table has `relreplident='f'`"
    — `config_drift.test.ts` asserts the membership against
    `public-relations.json`'s `mirrors`, which is exactly the three, and the FULL
    check now covers all four public tables including `snapshot_current`, which
    is broader than asked. **HOLDS**.
61. **v1:154** "Truth-table test: 3 flag states × 8 categories × 2 claim values =
    **48** asserted rows" — the ward-category audit of 2026-09-09 split `ICU` and
    added `PAEDIATRIC`, giving ten categories (`M/002:145-156`), and
    `tests/db/gate_truth_table.test.ts:130-131` asserts "exactly 3 x 10 x 2 = 60
    rows". The correction was recorded at v1:386 and **never propagated to
    :154**, and v1:359 already says "the 60-row truth table", so the document
    disagrees with itself in two places. It has also propagated into the
    repository: `scripts/lint_sql_no_bare_not_duty_flag.sh:29` still says "the
    48-row truth table". **STALE**.
62. **v1:157** "**The requirement is CLCO's and stands; the value is not, and
    never was, a value CLCO saw**" — a correctly-marked DATED RECORD, and the
    rare case of a document refusing to let a correction rewrite an attribution.
    **HOLDS**.
63. **v1:159** "`ward_reply` is **kept** (capped, private, never public) …
    it carries an **explicit no-patient-information validation**" — the cap is
    real (`M/005:218-219`, `char_length(ward_reply) <= 1000`) and the privacy is
    real. The validation is **not**: grepping every migration for `patient`
    returns six comment lines and no constraint, no trigger and no function that
    inspects the content of `ward_reply`. The claimed enforcement point,
    `M/005:211` "Validation for patient information also runs at the RPC layer",
    is the live false claim the v2 sweep found at its #7, and there is no
    referral RPC for it to run in. LIVE RULE resting on nothing, and it is the
    guarantee v1:159 calls "this project's single most valuable compliance
    asset". Same defect as #97. **FAILS**.

## Bundle 2

64. **v1:174** "There is no second-device refusal: the alert had no consumer, and
    its mechanism fingerprinted the unauthorised device" — `M/003:371-385`
    records the removal with that reasoning. **HOLDS**.
65. **v1:176** "**No `REFERRER`** … A `ward_account_scope_matches_role` CHECK now
    has no arm permitting a facility-less account" — `M/002:272-273` records the
    absent enum value, `M/003:245` is the constraint and `:241-242` its reason.
    **HOLDS**.
66. **v1:178** "No `fingerprint` column and no mismatch alert … If it ever ships
    it is a per-facility salted hash" — `M/003:371,385` and
    `M/003:405`, plus `fingerprint` on the forbidden column list at
    `packages/fixtures/audit-log-columns.json:34`. **HOLDS**.
67. **v1:179** "`facility_contact` — **one invited human per facility** …
    deliberately **outside** the append-only set so the row stays erasable" —
    `M/003` creates it and `M/010` locks only `ward_status_event` and
    `audit_log`. **HOLDS**.
68. **v1:181** "`privacy_notice_accepted_at` does not exist" — `M/003:317`,
    "DELIBERATELY NOT NAMED privacy_notice_accepted_at. That name implies …". The
    claim is about the name and the name is absent; a differently-named column
    does exist, which is the open question v1:181 itself left open and is worth
    knowing before anyone reopens it. **HOLDS**.
69. **v1:182** "Notification contact store **physically separate** from any
    Paddie Health marketing infrastructure: no shared table, no shared list, no
    shared provider account" — infrastructural and contractual, outside the
    repository. **NOT CHECKABLE**.
70. **v1:190** "deactivation immediately blocks publish" — `M/011:105` raises
    `ACCOUNT_DEACTIVATED` (42501) from `app.assert_member`, and
    `tests/db/cross_tenant_writes.test.ts:108-120` asserts it. The magic-link
    single-use half of the same line is open founder-side by prior ruling (step
    9) and is not a repository claim. **HOLDS**.

## Bundle 3

71. **v1:204** "Status + event + audit + **escalation-outbox row** commit or roll
    back **together**" — the first three shipped: `M/014:284` inserts the event
    and `:292` the audit row inside `publish_ward_status`. **There is no outbox
    enqueue**: grepping `M/014` for `outbox` returns nothing, though
    `app.notification_outbox` exists from `M/005`. v1:318 restates the same
    obligation from the B5 end — "the outbox is written from B3's transaction, so
    B3's RPCs must enqueue rather than send — specified there". LIVE RULE, unmet,
    and it matters for sequencing: **014 is frozen**, so the enqueue has to land
    as a `CREATE OR REPLACE` in a later migration rather than an edit. **FAILS**.
72. **v1:205** "`publish_ward_status(category, offering, bed_count, accepting,
    reason, expected_version, client_mutation_id, composed_at)`" — the shipped
    signature takes `p_category text` (changed by `M/015`) rather than the enum,
    and the return gained `replayed` (`M/014:146`) so a replay is distinguishable
    from a fresh publish, which was condition G. Both changes are recorded
    decisions. **SUPERSEDED-IN-DOC**.
73. **v1:206** "**Optimistic concurrency, not locking.** `where version =
    $expected`; zero rows returns 409 with the current row attached. On 409 **do
    not auto-retry**" — `M/014:76` lists `VERSION_CONFLICT` among the `P0001`
    codes and the function returns current state on conflict; the 409 is the
    HTTP mapping of that code, per the :219 contract. **HOLDS**.
74. **v1:213** "Server rejects `now() - composed_at > interval '2 minutes'` with
    `409 STALE_MUTATION`" — `M/014:258-259` exactly, and `:255` adds a
    `FUTURE_MUTATION` guard at `now() + 30 seconds` that v1 did not ask for.
    **HOLDS**.
75. **v1:215** "idempotency on `client_mutation_id` … `check (bed_count between 0
    and 500)`" — the unique index at `M/014:123-124` and
    `ward_status_bed_count_sane` at `M/004:99`. **HOLDS**.
76. **v1:219** "the error contract (`42501` for role violations, `P0001` with
    stable machine-readable codes for business rules — clients map codes, never
    message text)" — `M/011:88-123` raises 42501 from `assert_member`, and
    `M/014:69-76` enumerates the `P0001` code set. **HOLDS**.
77. **v1:223** "the version column added in B1 is consumed only here and by B5's
    challenge path — both in this sprint" — consumed in `M/014` and nowhere else;
    B5 is unbuilt, so nothing contradicts it. **HOLDS**.

## Bundle 4

78. **v1:235** "Snapshot generator: **service-role**, server-side only" —
    **known failure, confirmed.** `M/016` contains no `GRANT EXECUTE` on
    `app.regenerate_snapshot()` at all, and `M/016:114-116` states the position:
    "EXECUTE: OWNER ONLY … service_role has no USAGE on schema app". `M/017:30`
    repeats it — "NO GRANT: service_role has no" — and schedules the job as
    `postgres`, which owns the function. The v2 sweep found the identical failure
    at its #41 from v2:217; this is where it originates. **FAILS**.
79. **v1:235** "reading the **three** mirrors" — it reads two. `M/016` has READ 1
    `public.facility_public` and READ 2 `public.ward_public`, and `M/016:41-45`
    excludes `public.lga_rollup` on purpose: "no refresh call and no payload key
    … a refresh here would compute something nothing reads". **FAILS**.
80. **v1:235** "`Cache-Control: public, s-maxage=30, stale-while-revalidate=300`"
    — carried as prose in `snapshot-shape.json:4` and `golden-path-steps.json:4`
    and nowhere else; there is no header configuration in the repository and the
    CDN is hosted. Same verdict as the v2 sweep's #28. **NOT CHECKABLE**.
81. **v1:236** "Deploy the public dashboard to Cloudflare Pages" — a hosted fact.
    **NOT CHECKABLE**.
82. **v1:239** "Freshness bands `<60min` green, `1–2h` yellow, `>2h` grey, with
    the **absolute timestamp always shown**" — `snapshot-shape.json`
    `freshnessBands` is `greenUnderMinutes 60`, `yellowUnderMinutes 120`, applied
    at `freshness.ts:68-70`, with the absolute timestamp asserted at
    `golden-path.test.ts:316`. Named constants rather than numbers in prose,
    deliberately. **HOLDS**.
83. **v1:240** "**Sort key is `(freshness_bucket asc, distance asc, facility_id
    asc)`.** Freshness may reorder; it may **never** filter." — `freshness.ts:74-81`
    gives the bucket and restates the sort key verbatim, `freshness.ts:23-26`
    states the never-filter rule, and `golden-path.test.ts:395` asserts the sort
    dropped no rows. **HOLDS**.
84. **v1:242** "**Hard staleness ceiling at 24 hours** … the count is
    **suppressed entirely** … retaining the facility and the phone number" —
    `suppressAfterHours: 24` in the fixture, `freshness.ts:65-66` returns
    `SUPPRESSED` with `showsCount: false`, and the fixture's own comment states
    that suppression "removes the COUNT, never the row". **HOLDS**.
85. **v1:258** "B1's anon `SELECT` grants on the three mirrors become
    defence-in-depth rather than the serving path … The 24h ceiling changes what
    B5's escalation sweep considers actionable … the two thresholds are
    independent and must not be shared as one constant" — the grants remain and
    the negative tests still assert them; the 24h constant lives in the snapshot
    fixture and no escalation constant exists yet to share it with. **HOLDS**.

## Bundle 5

86. **v1:293** the dual scheduler — already swept 2026-09-16 under
    R-2026-09-16-07, marker in place. **SUPERSEDED-IN-DOC**.
87. **v1:294** "**`/api/health` returns 500 if …**, polled every 15 minutes by
    the external scheduler, which emails on non-200 … it is the only sensor that
    survives Supabase being entirely paused" — **no marker of its own**, and it
    fails for the reason :293 was marked for: there is no host for an `/api`
    route (see #30), the external caller was never buildable, and Pro does not
    pause. Note `M/004:294` repeats the premise inside an applied migration.
    LIVE RULE. **FAILS**.
88. **v1:295** "**`/status` founder page**, token-gated, sub-second" — the same
    dead premise: an HTTP route with no host. The *contents* of the page remain a
    good specification of what needs to be observable and should survive the
    amendment; the delivery mechanism does not. **FAILS**.
89. **v1:296** "**Daily digest at 07:00 WAT, sent by the external prober, not by
    Supabase**, so it arrives when Supabase is dead" — the external prober does
    not exist and cannot as specified. The argument underneath — that a
    digest which arrives only on bad news trains you to read silence as health —
    is sound and should survive. **FAILS**.
90. **v1:284** "**SPF, DKIM and DMARC on `toni.health` before the first send**"
    — a LIVE RULE naming a dead domain, and a pre-send gate, so it is the one
    domain reference that cannot simply be superseded with a note: the sending
    reputation being built belongs to `openbed.ng`. Same for
    "`mail.toni.health`" in the same item. **FAILS**.
91. **v1:288** "Subject line must carry the facility and the count … `[Toni]
    Lagos Island GH — 9 wards stale overnight`" — the bracket tag follows the
    retired product name. The rule about the subject line carrying facility and
    count stands. **STALE**.
92. **v1:320** definition of done, "killing pg_cron still fires the sweep via the
    external path within 15 minutes" — the external path does not exist, so this
    criterion cannot be met as written and would have to be restated against
    `app.system_heartbeat`, which is what R-2026-09-16-07 preserved of the sensor
    argument. **FAILS**.
93. **v1:272** "**`monitoring_state`: `PENDING → ACTIVE → PAUSED`**" —
    `M/002:211`, `CREATE TYPE app.monitoring_state AS ENUM ('PENDING','ACTIVE','PAUSED')`,
    and the column is on `ward_status` and published in `wardColumns`. **HOLDS**.

## Bundle 6

94. **v1:330** "`referral` record: **ward-to-ward** … (`referrer_facility_id` +
    `referrer_category`, `receiving_facility_id` + `receiving_category`); no
    individual clinician is recorded on either side" — `M/005:181-189` exactly,
    plus a CHECK at `:226-227` refusing a referral from a ward to itself.
    **HOLDS**.
95. **v1:331** "1-tap outcome: `ACCEPTED` / `REFUSED` (structured
    `refusal_reason` enum, **no free text**) / `FALSE_NEGATIVE_REPORTED`" —
    `M/002:308-314` is `('PENDING','ACCEPTED','REFUSED','DISCREPANCY_REPORTED','WITHDRAWN')`.
    The accusatory value was renamed in the **enum**, not only the UI. **STALE**.
96. **v1:332** "`FALSE_NEGATIVE_REPORTED` is fine as an internal enum; the
    user-facing label must be non-accusatory" — the implementation went further
    than the specification and made the enum value itself non-accusatory, which
    is the stronger position given v1:333's "what a court later reads back".
    **SUPERSEDED-IN-DOC**.
97. **v1:336** "`ward_reply` field (capped, private, **with
    no-patient-information validation**)" — the same defect as #63, at its second
    citation: the cap exists, the validation does not. Enumerated separately
    because B6 is where the field is written and a reader arriving here does not
    pass :159. **FAILS**.

## Bundle 7

98. **v1:356** "Apache 2.0. `NOTICE` stating that anyone self-hosting becomes an
    **independent data controller** … and must not use the BedSpace name" —
    `LICENSE` is Apache 2.0 and `NOTICE` carries both, with the name list already
    updated to include `OpenBed` and `openbed.ng` (`NOTICE:40`). **HOLDS**.
99. **v1:357** "`SECURITY.md` with a private disclosure address, response SLA and
    coordinated-disclosure window" — `SECURITY.md` gives `security@openbed.ng`,
    a 3/10/30-working-day SLA table and a 90-day coordinated disclosure window.
    **HOLDS**.
100. **v1:358** "Documented key-rotation runbook" — `docs/runbook-key-rotation.md`.
     The secret-scanning half is a GitHub setting and is not a repository fact;
     the attestation is open founder-side by prior ruling. **HOLDS**.
101. **v1:359** the merge-blocking gate list — the RLS negative suite
     (`tests/db/rls_anon_*`), the RLS-disabled test
     (`rls_enabled_everywhere.test.ts`), the golden-path E2E, the truth table,
     the bundle grep (`lint_no_service_role_in_bundle.sh`), the `updated_at` grep
     guard (`lint_no_updated_at_filter.sh`), the ESLint duty-flag rule
     (`eslint.config.mjs:28-56`, planted in `eslint_duty_flag_negation.test.ts`)
     and the client-side allowlist lint (`lint_from_allowlist.sh` against
     `public-relations.json`) all exist and run in `ci.yml`. The 4am gate is the
     partial one; see #109. **HOLDS**.
102. **v1:360** the README's four statements — `README:24-28` carries no personal
     data, no production credentials and all-synthetic seed, and `:33-42` states
     the covenant honestly as binding an operator rather than the licence.
     **HOLDS**.
103. **v1:362** "**Contributions gated for now.** Public repo and licence from
     commit one; `CONTRIBUTING.md` … only once five facilities are live" — the
     licence is present and `CONTRIBUTING.md` is absent, which is the state this
     rule requires. **HOLDS**.
104. **v1:363** "First diagnostic step for the sweep runbook is 'is the Supabase
     project paused'" — already swept and amended 2026-09-16 under
     R-2026-09-16-07. The three named runbooks are still unbuilt, which is a task
     rather than a claim. **SUPERSEDED-IN-DOC**.
105. **v1:364** "Comment on `ward_status_event` stating the product reason, not
     just the rule" — `M/004:203-207`, "DO NOT BUILD A PUBLIC TIME SERIES ON THIS
     TABLE. Not a 7-day occupancy chart, not a facility comparison …". **HOLDS**.

## Release gates

106. **v1:380** "**Gate 1 — RLS negative suite.** An anonymous client … cannot:
     write to any status, read the audit log, read reason codes … or execute any
     RPC." — `rls_anon_reachability.test.ts`, `rls_anon_column_containment.test.ts`,
     `rls_anon_writes_rejected.test.ts` and `rls_rpc_execute_allowlist.test.ts`
     cover the four limbs and run in the `db-tests` job. **HOLDS**.
107. **v1:384** "**the tile reflects it within 60 seconds with no page
     refresh**" — restated on 2026-09-10 to "a client poll at the snapshot's own
     cadence reflects the new count", against `pollCadenceSeconds` rather than a
     wall-clock number, and `golden-path-steps.json:4` gives the full reasoning:
     `stale-while-revalidate=300` means the architecture cannot meet the original
     clause, "and the natural fix when it reds at 3am is to add Realtime back,
     which is the decision that was reversed for measured reasons." This is a
     **LIVE RULE — a release gate** — and it still carries the superseded
     wording. Same restatement as #28. **FAILS**.
108. **v1:386** "**Gate 3 — the 4am test.** … returns results for all **ten**
     categories **[CORRECTED 2026-09-09 — ward-category audit]**" — ten is right
     (`M/002:145-156`), and the correction note is a model of the form: it names
     what the old value was, what the audit found, and where to look. **HOLDS**.
109. **v1:386** "Plus the property test: for any generated dataset,
     `count(search(cat)) >= count(rows where offered and bed_count > 0)`" — this
     does not exist. Grepping `tests/` for the property returns nothing; what
     exists is the exact-cardinality assertion inside the golden path
     (`golden-path.test.ts:395`, referred to at `tests/e2e/_harness.ts:15`),
     which is the other clause of the same gate. LIVE RULE — it is a named
     release-gate criterion — and it is unbuilt, so Gate 3 is green on a subset
     of what it says it asserts. **FAILS**.

## Open decisions, Sprint 2, supporting docs

110. **v1:392** "Five. The first two block launch rather than build" — decision 2
     is settled at :396 and decision 3 was settled on 2026-09-13, so three
     remain and neither of the two named as launch-blocking is still open in the
     form stated. **STALE**.
111. **v1:394** decision 1, the legal entity — "if this runs in your personal
     name, the reliance exposure is personally unlimited", and the recommendation
     of a vehicle separate from Paddie Health. Founder-side and outside the
     repository. **NOT CHECKABLE**.
112. **v1:396** "**2. Cost — settled.** Supabase Pro at $25/month accepted, which
     buys backups, no pausing and higher ceilings." — the project has been on Pro
     since 2026-09-12, and this line is the one R-2026-09-16-07 used to kill the
     keep-alive premise at :293. **HOLDS**.
113. **v1:398** "**3. Product name and trademark.** … Decide whether the product
     is **Toni** … or stays **BedSpace** at a toni.health address" — decided on
     2026-09-13, and neither of the two options offered is what was chosen: the
     product is **OpenBed** at `openbed.ng`. `NOTICE:40` already reflects it.
     **STALE**.
114. **v1:400** "**4. Quiet mode** … Built as founder-flipped in v1 (a config
     action, no UI)" — `quiet_mode` is a column on `app.facility` with no admin
     surface anywhere, which is exactly founder-flipped. The k-floor commitment
     in the same item is #54 and #55. **HOLDS**.
115. **v1:402** "**5. Yoruba / Pidgin pass** … Built English-only, with copy kept
     in a **single strings module** so a pass is a translation job rather than a
     refactor." — there is no strings module: `apps/public-dashboard/src`
     contains only `main.ts`, and neither app has a strings file. The decision to
     build English-only holds; the mitigation that makes it cheap to reverse does
     not exist, which is the part that mattered. **FAILS**.
116. **v1:408** Sprint 2's retention schedule, "attributed audit 90 days,
     pseudonymous events 24 months" — **this contradicts v1:123 in the same
     document.** A5's amendment removed individual accounts, so the audit log
     carries no personal data, so "the audit log needs no retention period and no
     partitioning; append-only and permanent is correct" (:123) — and `M/010`
     built it that way. The Sprint 2 list still carries the pre-amendment
     retention design, and "attributed" and "pseudonymous" are both categories the
     amendment dissolved. A retention job built from this list would delete from
     an append-only table and fail against the `ENABLE ALWAYS` trigger, which is
     the good outcome; the bad one is someone relaxing the trigger to make it
     pass. **FAILS**.
117. **v1:414** "**None as separate files.** With no scaffolded codebase there
     are no real paths to write a staff-engineer plan or a QA spec against" —
     true on 2026-09-08. There is a repository now, `docs/` holds two runbooks
     and five handoffs, and of the two documents this item names as worth
     generating once a repo exists, `ARCHITECTURE.md` is still absent.
     **STALE**.

---

## Reconciliation

Run against this file after it was written, not typed alongside it. The parser
takes each numbered item's **last** bold verdict word — the rule the v2
enumeration states — and recounts:

```
items parsed: 117 | numbering 1..117
missing numbers: none
duplicate numbers: none
items with no verdict: none

SUPERSEDED-IN-DOC      7   items: 22, 48, 55, 72, 86, 96, 104
NOT CHECKABLE         11   items: 3, 12, 19, 20, 26, 27, 29, 69, 80, 81, 111
HOLDS                 66   items: 2, 6, 7, 8, 9, 10, 11, 14, 16, 17, 18, 21, 23,
                               24, 32, 34, 35, 37, 38, 39, 40, 42, 43, 44, 45,
                               46, 47, 49, 50, 52, 53, 54, 56, 57, 58, 59, 60,
                               62, 64, 65, 66, 67, 68, 70, 73, 74, 75, 76, 77,
                               82, 83, 84, 85, 93, 94, 98, 99, 100, 101, 102,
                               103, 105, 106, 108, 112, 114
FAILS                 21   items: 5, 13, 15, 28, 30, 31, 36, 63, 71, 78, 79, 87,
                               88, 89, 90, 92, 97, 107, 109, 115, 116
STALE                 12   items: 1, 4, 25, 33, 41, 51, 61, 91, 95, 110, 113, 117
TOTAL                117
```

**The first run disagreed with the typed table**, which had HOLDS 68 and FAILS 19
against a FAILS list of twenty-one entries. The lists were right and the counts
were wrong — the same defect the 017 kickoff carried twice and the reason
condition I exists. The table above is now derived from this output.

**Could this sweep have failed?** It did, twenty-one times, and the failures are
not cosmetic: two of them (#36, #78) invalidate a prescribed security remedy and
a stated execution identity, one (#71) names an unmet transaction obligation
against a frozen migration, two (#63, #97) find a compliance guarantee with no
enforcement behind it, and one (#109) finds a release-gate criterion that was
never built. Fourteen items changed verdict during the pass as evidence arrived.
Two checks could not be run and report no verdict rather than a guess.

**Where the failures cluster, which is the finding above the findings.** Of the
twenty-one, **seven** (#28, #30, #87, #88, #89, #92, #107) trace to a single
root: v1 assumed a server that was never built. A2 at :81 put "the API" on
Vercel, and B5's `/api/sweep`, `/api/health`, `/status` and the external prober,
plus two definitions of done and Gate 2's latency clause, all rest on it.
R-2026-09-16-07 found the absence from the `/api/sweep` end and marked :293;
**:81 is where it originates, and marking one leaf of a tree left six.** A
further **five** (#1, #31, #33, #91, #113) are the `toni.health` → `openbed.ng`
rename, which had reached `NOTICE` and `SECURITY.md` but not the document that
decides the sending domain.
