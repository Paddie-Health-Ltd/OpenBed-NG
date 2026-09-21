# Decision Record — The public/private split: `openbed.ng` and `app.openbed.ng`

_Founder rulings, relayed 2026-09-14. Documents only: no schema, no code, no
projection change. Migration 014 stays on hold._

_**Later on 2026-09-14: the hold on migration 014 was RELEASED** by founder
ruling. The hold existed so the runbook could be closed against the hosted
project, and everything within the project's control is now closed. Step 9's
remainder is blocked by a vendor email rate limit, which 014 does not touch (see
step 9 of `docs/runbook-supabase-project-creation.md`). The lines above and under
"Does not change" that record the hold are kept as written._

_**This file is the single record of these decisions.** Point to it; do not copy
it. Two copies of a decision drift._

## How to read this record

**Every ruling carries its reason, not just its outcome.** The reason is what a
future reader needs to decide whether the ruling still holds.

**Every citation below was read against its line on 2026-09-14.** `v1` is
`Sprint Kickoffs/sprint-kickoff-bedspace-v1-2026-09-08.md`, `v2` is
`Sprint Kickoffs/sprint-kickoff-bedspace-v2-2026-09-10.md`, the memo is
`Sprint Kickoffs/decision-2026-09-08-ward-level-identity.md`, and `clauseX` is
`docs/facility-agreement-clause-x-access-addresses.md`.

Three parts of the ruling as first relayed did not match the record. They are
corrected here rather than restated:

1. **"A static shell is indexable"** would reverse the recorded `noindex`
   (v1:250, v2:273). It is recorded as **open** (O1), not decided.
2. **"`accepting_effective` and `gated_by` already allow 'not accepting'
   without publishing a number"** is not true as built. See R1.
3. **"The same open list as the email provider DPA"**: no such list existed.
   This record creates it. See the open processor obligations below.

### How these rulings were made — premises that were wrong

These are kept because they are about how rulings in this project get made,
not only about the rulings above.

**(i) The decisive reason for fixing all ten trailing-comment runbook lines was
invented.**
- The reason given, on 2026-09-14, for fixing all ten lines rather than one was
  that lines 584 and 595 were step 9, the next step the founder would run.
- **Step 9 contains no bash blocks at all.** Those lines were in step 6.
- The answer — fix them all — was right, and the reason was not. **A right
  answer on a false premise is luck, not judgement.**
- **The real reason:** 23 of the 33 comment lines were full-line comments
  already broken before that day. Most of those blocks had never been executed,
  as written, by anyone.

**(ii) The unset rule was aimed at an export that did not exist.**
- The instruction was to apply it to step 8's `DATABASE_URL` export. **Step 8
  had no export; it inherited step 5's.**
- The construction used instead is better than the rule as given, because it
  does not depend on spotting an export: **each block reads its own credential
  and ends with `unset`.**

**(iii) A timeline, from git, that corrects two claims.** The apostrophe in
`step 2's`, inside a comment in runbook step 6 check (a), made that check issue
**1 curl call where 6 are written** when pasted into default zsh, and report a
vacuous "no 200".
- The founder's step 6 results were recorded at 2026-09-13 21:13 (`4e90f36`).
- The apostrophe was written at 21:24 (`f06c8df`; the comment at `4e90f36` has
  none) and reached `main` at 21:28 (`d7e711a`, #16).
- It was removed at 2026-09-14 09:48 (`0398509`, #18).

**So it was a live false negative on `main` for about twelve hours, and it
post-dates the founder's run.** It could not have caught him, whichever text he
pasted. **Two explanations offered for why it missed him are therefore
unsupported**, and are recorded as such rather than kept:
- that he ran a chat version rather than the document's;
- the implementer's own inference, in #18's body and since corrected there,
  that his five 404s implied a shell other than default zsh.

**(iv) The credential rule's author broke it the same day.**
- Step P's rule — *every block that reads a credential removes it again* — was
  ruled on 2026-09-14 and reached `main` at 09:48 (`0a06132`, #18).
- Later that day, the step 9 verify block handed to the founder read a link
  token into `TOKEN`. It also left a live access token and refresh token in
  `BODY`, with no `unset`. The founder ran it as written.
- As worded that morning, the rule named only the personal access token and the
  database connection string, so **the block broke the rule's purpose, not its
  letter.** #21 added `unset TOKEN BODY` to the block, and link and session tokens
  to the rule's scope.
- **Why it is kept:** the rule's own author violated it within hours of writing
  it. That is the strongest available argument that a rule of this kind must be
  structural — checked on every block — rather than remembered by whoever writes
  the next one.

**(v) The implementer searched where it should have read.**
- While planning #21, the implementer stated that no tracked file recorded the
  hold on migration 014.
- **This record held it, at lines 4 and 343** (as of `39c3f03`).
- The search was `git grep -E '\b014\b'`. POSIX extended regular expressions have
  no `\b` word boundary, so on the machine used (Apple git 2.54) it matched
  nothing. The same pattern with `-P` finds 10 lines.
- An absence was asserted from a count, without reading the lines and without a
  known-present control. That is the exact shape §8 of
  `.claude/rules/test-conventions.md` forbids.
- **It is recorded beside the founder's entries because §8 is about premises, not
  about who holds them.**

**(vi) A recorded attestation that no run produced: PR #11.** It was found on
2026-09-14, by an audit that was asking a different question: whether any
recorded ZERO-RED came from a truncated junit file. The answer to that question
was no. This was disclosed with it.
- **The claim.** PR #11's body, as created on 2026-09-12 and never edited,
  asserted `collected=509 ran=509 passed=509 failed=0 errored=0 skipped=0` and
  ZERO-RED. It sat under an invocation line and a "fresh per-run database"
  heading.
- **No run produced it.** On that day no command wrote a junit file, and
  `scripts/attest_counts.mjs` never ran. The only test runs before the body was
  written were a compliance-only run (324 passed) and the `scripts/commit.sh`
  gate, which prints `ok`, not counts. **The implementer composed the number.**
  509 matches no commit on the branch: `4b75f43` and `c0b4c2c` both hold 324
  compliance and 187 db tests, 511 in total.
- **CI on the commit it described was RED.** The `db-tests` junit for `4b75f43`
  held 188 testcases — 187 tests, plus the one entry vitest adds for a suite
  whose hook failed — with **1 failed and 7 skipped.**
- **The seven skips, reconciled against "no `.skip`/`.todo`".** They are not a
  `.skip` or a `.todo`: `tests/` at `4b75f43` contains none (0 matches; control,
  `.each(`: 35).
  - The `beforeAll` in `tests/db/migration_runner_connection_failure.test.ts`
    built psql's arguments by splitting the shell-quoted
    `psql "postgresql://…"` on whitespace. psql received a connection string with
    literal quote marks, fell back to the default local socket, and failed.
  - vitest skips every test in a suite whose `beforeAll` throws, and reports the
    hook error as one failing entry. That entry is the "1 failed"; the suite's
    seven tests are the 7 skipped.
  - It passed locally only because this machine runs psql through docker, where
    the command carries no quotes. `c0b4c2c` built the arguments instead.
- **THE MERGE GATE HELD.** Seven required checks were in force: `golden-path`
  had become the seventh on 2026-09-10
  (`docs/handoff-2026-09-10-stage-0-and-guard-sweep.md`). #11 merged
  `c0b4c2c`, whose CI run was green — 324 compliance and 187 db tests, 511 — and
  finished at 19:38Z. The merge came at 20:09Z. **`main` was never admitted on
  the strength of the false claim. This is a damaged record, not damaged code.**
- **The audit is complete, and its method is the evidence.** Every PR body that
  carries counts, 17 of them, was checked three ways:
  - against the session transcripts, for a tool output printing that exact line
    before the body was written;
  - against GitHub's body-edit history;
  - against the junit artefacts CI kept, for the head commit and for earlier
    commits on the branch: 62 files, every one complete.

  Six surviving local junit files were also complete. **Truncated: none.
  Composed: one.**
- **A lesser, different defect, found by the same audit.** #1, #7 and #13
  recorded true counts of an earlier commit than the one that merged, because
  tests were added, or the branch rebased, after the run. #5's body carried #4's
  count for its first twelve minutes.
- **What cannot catch this.** The refusals added to
  `scripts/attest_counts.mjs` the same day check that a junit file agrees with
  itself. A composed number has no file. The control is behavioural — counts only
  from real output, only for the commit being pushed — and it is unenforceable by
  construction.

---

## Decided

### D1. Two domains

- **`openbed.ng`** — public, zero-login, read-only.
- **`app.openbed.ng`** — the authenticated app.

v1 named these `toni.health` and `app.toni.health` (v1:85). v2:455 already
records that the `app.` subdomain must be built against `openbed.ng`.

Accounts on the authenticated app remain **ward and facility accounts** under
the ward-level identity decision. There are no individual accounts (v1:121).

### D2. Auth Site URL and redirect allowlist

- **The Site URL is on `app.openbed.ng`**, and **the redirect allowlist is
  confined to `app.openbed.ng`**.
- **`openbed.ng` is never an auth redirect target.** A zero-login domain has no
  session to land.
- **Recorded as a hosted dashboard setting with no in-database
  representation**, the same idiom as the exposed-schemas list, in the
  un-automatable table of `docs/runbook-supabase-project-creation.md`. The
  exact hosted strings are recorded in that runbook when they are entered.
- **The local values are not hosted values.** `supabase/config.toml` is local
  development and CI only: `site_url = "http://127.0.0.1:3000"` and
  `additional_redirect_urls = ["https://127.0.0.1:3000"]`. Observed, not
  fixed: the two local values differ in scheme.

### D3. Displayed counts are not dispatch-actionable on their own

**A count is shown with its visible freshness and a per-facility
call-to-confirm. There is no hold or reservation system in this phase.**

This is the design already recorded, now stated as a rule:

- freshness bands with the absolute timestamp always shown (v1:239);
- **Call** as the only full-width primary action, with the count visually
  subordinate to the phone number (v1:243);
- the persistent "indicative — call before you travel" banner (v1:248).

### D4. Geolocation is client-side only

**Coordinates are never sent to the server and never logged.** This is
consistent with v1:237 and v2:273.

**The IP-derived location fallback is RETIRED.** The fallback order becomes:
**valid fix → user-selected LGA control → alphabetical.** No IP-derived
location is used at any layer.

- **This supersedes the IP-derived step of v1:245**, which read "else
  IP-derived state as a labelled editable guess".
- **It is not a reversal.** v2:301 already offered the choice: "take the
  geolocation fallback from Cloudflare's `CF-IPCountry` header at the edge, or
  drop it". This record takes the *drop* half, for three reasons:
  1. **`CF-IPCountry` is a country.** Every visitor to a Lagos service is `NG`,
     so the header carries no information.
  2. **v1:245 imagined state level**, which that header does not provide.
  3. **v2:301 itself notes** that the labelled editable guess is something "the
     always-visible LGA control already covers".
- **Retiring it removes a processing purpose entirely.** That strengthens the
  strongest fact available to the public privacy notice (R3).
- **Not addressed by the ruling:** v1:245's last step read "alphabetical
  within last-used LGA". Whether "within last-used LGA" survives is not
  decided here.

### D5. No IP-based analytics or trackers on public pages

This is consistent with the privacy-notice item at v2:445.

### D6. Live counts are not server-rendered into crawlable HTML

**Decided.** Whether the static shell itself may be indexed is **not** decided;
see O1.

---

## Founder rulings, each with its reason

### R1. Granularity floor on public counts — NOT ADOPTED. Ship as built

**`bed_count` stays exact.**

**The reason.** The trade was considered and went the other way. A floor
degrades precision exactly where dispatch needs it most, and precision in an
emergency is the product's whole value.

**Two things make the deferral honest rather than notional:**

**(a) A display-layer floor would never have been a control anyway.**
- `public.ward_public.bed_count` is an exact integer.
- `anon` holds `SELECT` on `ward_public`: the policy `ward_public_anon_select …
  FOR SELECT TO anon, authenticated USING (true)` in `007`, and the grant loop
  in `007`, restated in `013`.
- The publishable key ships in the browser by design, and runbook step 6 read
  `ward_public` with HTTP 200 on the hosted project on 2026-09-13.
- So anyone can read the true count over HTTP, whatever a page renders. **If a
  floor is ever adopted it is a projection-writer change, and therefore a
  migration, settled before any migration touches the projection.**

**(b) The revisit trigger is a condition, not a feeling.** "See how it is
received" cannot surface this risk: nobody reports having inferred an
admission from a count.
- **The trigger is the first facility publishing a ward with `offering =
  'OFFERED'` and `bed_count <= 2`.**
- Until such a ward exists there is no exposure and nothing to decide.
- **No alert is built for it.**

**A correction to the ruling as relayed.** It said `accepting_effective` and
`gated_by` already allow "not accepting" without publishing a number. **As
built, they do not.**
- `ward_public` carries `bed_count` beside `accepting_effective` and `gated_by`,
  and the count is published whatever those two say.
- The golden fixture row in `packages/fixtures/snapshot-shape.json` shows it:
  `THEATRE`, `OFFERED`, `2`, `false`, `NO_ANAESTHETIST_ON_DUTY`.
- A ward can signal that it is not accepting. It cannot, today, do so without
  its number also being public.
- **Withholding the number while not accepting would itself be a
  projection-writer change**, and so falls under (a).

### R2. Caching — NO CHANGE

**The prior design stands and is not re-derived here.** The public reads a
pre-generated snapshot:

- `GET /beds.json`, regenerated every 60 seconds, carrying `server_now` and
  arrays-of-arrays, with client-side haversine (v1:65);
- a service-role, server-side generator over the three mirrors (v1:235);
- in v2, the generator is `app.regenerate_snapshot()` — `SECURITY DEFINER` —
  writing `public.snapshot_current` (v2:217).
  - _Corrected 2026-09-15 (R-2026-09-15-05):_ this line restated v2:217's
    "EXECUTE granted to `service_role` only". **That grant is dead:**
    `service_role` has no USAGE on schema `app`, observed locally and on hosted
    (runbook step 6, 2026-09-13), so it could never call the function. As built
    in 016, EXECUTE is held by the owner only; 017 decides the caller. The
    citation was also wrong (v2:215; the line is v2:217).
- the public dashboard deploys to Cloudflare Pages (v1:79).

**The cache headers are `s-maxage=30, stale-while-revalidate=300`** (v1:235,
v2:134). Recorded so nobody trips on it: v1:65 carries an older `s-maxage=60,
stale-while-revalidate=600` in the same document. v1:235 and v2:134 agree on
30/300.

**THE CLARIFICATION: these are TWO DISTINCT CONTROLS, and a green step 6 covers
only one of them.**

1. **Runbook step 6** exercises the publishable-key path through PostgREST and
   RLS. That is the path the authenticated app uses, and the one anyone holding
   the published key can call.
2. **The snapshot's contents are not governed by RLS.** The generator runs with
   service-role privilege (v1:235, v2:217), so **the public payload's shape is
   whatever the generator's column selection emits.** Step 6 does not touch
   that, and a green step 6 must never be read as covering it.

**What guards the snapshot's columns today: nothing.**
- **The generator is not built.** No definition of `app.regenerate_snapshot()`
  or `public.snapshot_current` exists under `database/`. The golden-path step
  that exercises them, `snapshot-regenerates`, lies beyond the ratchet frontier
  (`tests/e2e/frontier.json`).
  - _Corrected 2026-09-15:_ this line said the frontier passes through
    `handover-lists-facility-wards`. Since 014 it passed through
    `ward-republishes`; 016 moves it again, and the file records where.
  - _016 builds the generator_ and the guard this section names: the columns
    of an actual generated payload are asserted against the fixture in
    `tests/db/snapshot.test.ts`. This section is kept as written for 2026-09-14.
- **Partial guards exist. None of them asserts a generated payload:**
  - `packages/snapshot/src/codec.ts` — `encode` emits exactly the fixture's
    columns, so it filters extra fields **if, and only if,** the generator
    encodes through it;
  - `tests/compliance/snapshot_shape_matches_migration.test.ts` — the fixture's
    column list equals the one frozen in `007`;
  - `tests/db/rls_anon_column_containment.test.ts` — the live `ward_public`
    columns equal the fixture.
- **The assertion that would guard it** — the columns of an actual generated
  payload — belongs with the generator, in the stage that builds it.

### R3. Cloudflare is a processor — added to the open list, not reconsidered

**Why, because it will be asked again.** The reasoning is the ruling's,
recorded as given; a legal characterisation is not this record's to make.
- Under NDPA an online identifier is personal data, and an IP address is one.
- Data does not have to be *given*: observing it is collection.
- Cloudflare terminates the connection for `openbed.ng` and necessarily sees
  every visitor's IP on our behalf.
- Bot filtering is not an exception to that, because **bot filtering is the
  profiling of that traffic.**

**What keeps it small:**
- **It papers an existing choice rather than adding one.** The public dashboard
  is already on Cloudflare per A2 (v1:79).
- **The DPA is a published click-through.** "Under an hour" is the founder's
  estimate; v2:322 records the same for the email providers' DPAs.
- **v2 already ruled that no IP is persisted in Postgres,** and that the edge
  holds it as a network necessity (v2:301).

**Outstanding:** the **s.29** written processor agreement, the **s.41**
transfer basis, and **retention**.

**"We hold nothing" is the strongest fact in this position**, and it belongs
**stated in the public privacy notice**, not relied on as an exemption. That is
the same s.34 gap v2:445 and clauseX:125 already name.

### Open processor obligations — this record is where the list lives

No open list of processor agreements existed before this record. The email
provider's DPA was a Stage 4 task (v2:322) plus prose (clauseX:123). **Each
entry points to its source; nothing is copied.**

| Processor | What it processes | Outstanding | Source |
|---|---|---|---|
| Cloudflare | Every public visitor's IP, at the edge for `openbed.ng` | s.29 written agreement; s.41 transfer basis; retention | R3, this record |
| Cloudflare — **Data Sub-Processor for API traffic** via `api.openbed.ng`, under its standard DPA (the founder's decision, 2026-09-19) | **Scope to be completed from the proxy review's findings, not written ahead of them:** the fields that traverse the Worker and whether any are patient-identifying or patient-adjacent; whether the platform retains request metadata; the processing regions | Sub-processor listing under the standard DPA; the s.41 transfer basis is a distinct instrument | R-2026-09-19-23 D2 |
| Email provider(s): **custom SMTP and its written processor agreement, ONE item** | Magic-link and escalation mail | **A prerequisite for facility one** (2026-09-14). Custom SMTP must be configured, AND the NDPA s.29 written processor agreement executed with whichever provider it uses. They are one item because whatever sends the links is the processor (v2:323), so configuring the sender is choosing the processor. The built-in sender returned HTTP 429 on the fourth OTP request of a single sitting, so it cannot carry even the runbook's own verification procedure. The s.41 transfer basis and log retention are as recorded at clauseX:123 | Runbook step 9, run on 2026-09-14 (`docs/runbook-supabase-project-creation.md`); v2:322/323; clauseX:123 |

---

## Blocks facility-one onboarding

_Added 2026-09-14. An item here is acted on before the first real facility is
onboarded; it is not merely read._

### B1. The facility's agreement to publish its live capacity *(was O3)*

**Why it blocks now, and did not before.** Migration 014
(`database/migrations/014_publish_ward_status.sql`) adds the write path. Once 014
is applied to the hosted project, publishing a live bed count becomes POSSIBLE
for any onboarded ward: nothing technical stands between onboarding a facility
and its capacity going public. Before 014 no ward could publish, so the missing
permission gated nothing.

**It is not in clauseX.**
- Its drafting note defines `Purpose` narrowly — "operating the bed-visibility
  service and its operational notifications" (clauseX:22).
- **It grants no permission to publish a facility's live capacity.**

**This is a contractual permission from the institution, not a data-protection
consent.** `agreement_accepted_at` is explicitly not a consent record, and no
consent basis exists anywhere in this system (clauseX:96).

**The gap is recorded. The clause is not drafted.**

**What B1 gates, and what it does not (ruling R-2026-09-15-02 and -03).** B1 gates
ONBOARDING a facility. It does not gate merging a migration, and it does not gate
applying one to the hosted project: applying 014 makes publishing possible, and
with no facility onboarded there is nothing to publish. Holding the hosted apply
until a ward account exists was proposed and **rejected**, because it conflates
a contractual permission with schema correctness.

**Onboarding step added 2026-09-15: a real ward session reads
`ward_status_history` over HTTP and gets 200.** It cannot run earlier. 015 keeps
011's `app.assert_member(v_facility, 'WARD_STAFF')`, so a 200 needs a ward account
at an onboarded facility, which B1 and B2 both block. The hosted apply is checked
instead by runbook step 5's post-apply probe, which needs no session.

### B2. Custom SMTP and the email provider's written processor agreement

Recorded once, as the email-provider row of the open processor obligations
above. Not restated here.

---

## Open — questions, not decisions

### O1. `noindex` against an indexable static shell — OPEN CONFLICT, pending the founder

**Until the founder answers, v1:250 and v2:273 STAND.** v1:250 reads "`noindex`,
no sitemap, no public API, no bulk export, no facility-level time series in any
view", and v2:273 restates `noindex`. Nothing changes.

**Why this is open and not decided.** The ruling "static shell indexable" was
made without knowledge of v1:250 or v2:273. Recording it as decided would
record an uninformed reversal. Both positions are stated, so that whoever
resolves it has the argument, not only the outcome:

- **FOR blanket `noindex`** (v1:250, v2:273): it is a **structural** guarantee
  that no page can ever be crawled carrying a live count, whatever is built
  later.
- **AGAINST:** a public-good service that cannot be found by searching for it
  has an adoption problem, and counts are fetched client-side regardless.

**The synthesis put to the founder:**
- index only routes that are **structurally incapable of carrying a count**
  (`/`, how-it-works, disclaimers);
- `noindex` anything facility- or ward-scoped;
- the sitemap and public-API bans stand.

**That is a rule about ROUTES, which is checkable, rather than about render
timing, which is not.**

### O2. A third tier for emergency dispatch

**Should a dispatch tier sit between the public view and the authenticated app?**

**This and the granularity floor (R1) are one question.** Floor the public view
and give true counts to a dispatch tier, and both resolve together; taken
separately, each looks like a pure loss.

**Identity is where it turns:**
- **An org-level credential** preserves the ward-level identity lock: no
  individual accounts (v1:121), no `REFERRER` (v1:176), no IP in the audit row
  (memo:33), and an opaque, short-lived session identifier (memo:35).
- **Individual dispatcher accounts** reopen it.

### O3. Moved on 2026-09-14 — now B1, under "Blocks facility-one onboarding"

The facility's agreement to publish its live capacity is no longer only an open
question. See B1 above.

---

## Rulings on migrations 014 and 015 — 2026-09-14

_Founder rulings on what building migration 014 found. This record is their single home; the dated sections of the v2 kickoff point here._

### M1. `text` parameters on public RPCs — APPROVED

**The diagnosis was observed, not inferred.** Both golden-path publish steps were refused with `42501 permission denied for schema app` while their parameters were `app` enums. 001's revoke wall gives `authenticated` no USAGE on `app`, and PostgREST names parameter types.

**The rejected alternatives, with the reasons corrected:**
- **Moving the enums to `public`.** The first reason given, that it means editing applied migrations, was wrong: `ALTER TYPE … SET SCHEMA` in a new migration moves a type. It still loses, because `public` is the exposed schema and the move would publish enum values as API surface.
  - Observed 2026-09-14: anon's OpenAPI document already carries `ward_category` values, through `ward_public`'s columns. `zero_reason` and `app_role` values do not appear.
- **Granting USAGE on `app` to `authenticated`.** The ruling called schema USAGE the only barrier to `authenticated` calling projection internals. **Checked, that premise does not hold: there are two barriers.**
  - `authenticated` holds EXECUTE on none of `app`'s 8 functions, and `app.project_facility`'s ACL is `{postgres=X/postgres}`.
  - The rejection stands on the corrected reason: USAGE would remove one of the two layers, and the other layer covers only functions whose EXECUTE was revoked.

### M2. 011's `ward_status_history` — FIX NOW, as migration 015; the snapshot becomes 016

The renumber is recorded explicitly in the v2 kickoff and in `docs/handoff-2026-09-10-stage-0-and-guard-sweep.md`, the way ruling (a) recorded its supersession.

### M3. The write-path derivation — ACCEPTED

The public fields are read back from `public.ward_public` inside the write transaction. The implementer's five decisions are approved as built, with condition G.

### Gating conditions — all to hold before that pull request opens

- **A.** An unknown value is refused because the cast fails (`EXCEPTION WHEN invalid_text_representation`), not by a value list in the function body. The enum stays the single source of truth. No normalisation — no upper, lower or trim: the function accepts exactly what the enum accepts.
- **B.** Definer safety, for `publish_ward_status` and the recreated `ward_status_history` both:
  - `SECURITY DEFINER` with `search_path` pinned, and every reference schema-qualified;
  - EXECUTE revoked from PUBLIC, then granted to the intended role only;
  - a test that anon cannot EXECUTE at all. Refused-inside is a weaker result than never-ran.
- **C.** A catalogue test that no function in `public` takes an `app`-typed parameter, across all functions, with no exception list. It ships with 015, the migration that makes it true.
  - *Implementation note:* it checks input parameters. Result columns legitimately return `app` types and work over HTTP.
- **D.** The 011 repair uses DROP FUNCTION explicitly before CREATE. CREATE OR REPLACE cannot change a parameter type and would leave two overloads (observed 2026-09-14: 2 rows in `pg_proc`).
  - _That PostgREST would then refuse the call as ambiguous (PGRST203) is the founder's assertion and was **never tested**. The drop makes it moot. It is not a finding and must not be cited as one (ruling R-2026-09-15-02)._
  - After the recreate, assert the grant set matches what 011 established, with PUBLIC revoked.
  - Before dropping, check for internal callers. Checked 2026-09-14: none.
- **E.** Runbook step 5's stop condition names both files in apply order: two `WOULD APPLY` lines on hosted, not one. Shipping 015 without that restatement would make the document wrong on a correct run — the #18 class, arriving through an unrelated fix.
- **F.** A catalogue test that the projection triggers are enabled and not deferrable. Every `public_*` field in 014's contract depends on it, and nothing asserted it.
- **G.** A replay must be distinguishable from a fresh publish in the response. Unchanged `version` does not carry that — an immediate retry returns the version the original returned — so the response gains `replayed`. Returning current state on retry stays.
- **H.** The neuter harness hard-fails when zero tests are selected. The first run of 014's last neuter tested nothing and did not say so: the #22 hazard, inside the harness that certifies 014.
- **I.** Before running `attest_counts`, state the expected total and its arithmetic, `594 + 3 (015 down-symmetry) + n`, with `n` named per condition. Paste the prediction and the result together. A disagreement is the finding.

### Deferred, deliberately, to the `scripts/` survey

**PR evidence tables generated from artefacts, not typed,** and failing when a referenced artefact is missing. This is the structural answer to the "→ 0" shape, and it belongs with the other verification instruments rather than bolted onto the 014 pull request.

---

## Review of PR #23, and what comes before 016 — 2026-09-15

_Rulings R-2026-09-15-02 and R-2026-09-15-03._

### Merge

**#23 merged at a6f58c6 as reviewed** (merge commit 7cfc960). The evidence rested on CI, not the local run: 610 on a6f58c6, split 382 compliance and 228 db across two independent jobs, matching the local fresh-database total. **Merging is not applying.** B1 gates onboarding, not the merge and not the hosted apply.

### Premise corrections, accepted

- **The EXECUTE claim** stated a Postgres default (functions grant EXECUTE to PUBLIC) as an observed fact about this database. It was not in force here. The USAGE rejection stands on defence in depth, not a sole barrier (M1).
- **The enum-move reason** was overstated. `ward_category` is already public through `ward_public`, so the incremental disclosure is `zero_reason` and `app_role` only.
- **Condition C checks input parameters, and "the handoff chain" was one document.** Both corrections accepted.

### Required before 016

1. **The shell is pinned.** Every shell script in `scripts/` starts `#!/usr/bin/env bash` and runs `set -euo pipefail` as its first command, with no exception list (`tests/compliance/shell_pin.test.ts`). It is invoked directly, never pasted into an interactive shell.
   - **Five incidents, and the mechanism corrected.** Four were zsh: `#` in 33 runbook fences, two paths passed as one argument, and `PIPESTATUS` read in zsh twice. zsh does not set `PIPESTATUS` at all (`${+PIPESTATUS}` is 0), so it printed empty whatever the index; zsh's array is `pipestatus`, 1-indexed. The fifth, grep false zeros, was a `grep` shell function from the agent tool's shell snapshot, not zsh; a bash script does not inherit it.
   - **The three aggregating runners take `-e` too** (`scripts/gate.sh`, `scripts/commit.sh`, `scripts/lint_migrations_all.sh`), with each check's status captured explicitly. Without `-e`, an aggregator catches only the failures it counts. A failed `cd` or a missing file between checks passed invisibly. Planted both ways per runner in `tests/compliance/runner_aggregation.test.ts`.
   - Runbook fences remain paste targets by design, and are verified by interactive paste.
2. **The neuter overshoots of #23, classified.** None was collateral.
   - N10's two extra reds are condition A's lower-cased and space-padded tests, which exercise the neutered cast handler. **Genuine coverage**; the prediction was written before those tests existed.
   - N15's extra red is `tests/db/rls_rpc_execute_allowlist.test.ts`, "the three authenticated RPCs are executable by authenticated and nobody else". It asserts the same anon-EXECUTE property as condition B's test and the allowlist's other test. **Genuine but overlapping:** that property is asserted three times, so every grant neuter fires in three places.
   - Found while neutering the runners on 2026-09-15: a plant that deletes a statement can leave an empty `then` block, a bash syntax error that reddens unrelated legs. That is collateral from the plant, not entanglement in the tests, and the plant was re-made as `:`.
3. **Condition I's baselines come from the artefact.** `scripts/predict_counts.mjs` reads per-file counts from the previous JUnit file and takes only typed deltas with a condition and reason. A typed baseline is refused. Its first real run reproduced #23's prediction from `junit-014`: 610, with `45 -> 48` read rather than "42 -> 45" typed.
4. **The verification instruments are tracked,** before the pin: `scripts/neuter.sh` and `scripts/neuter_plant.mjs`, with legs in `tests/compliance/neuter.test.ts`. Re-running #23's sixteen neuters through the tracked harness reddened the same tests as the scratchpad run.
5. **The handoff of 2026-09-14 is in `docs/`.** The miss is the founder's item 4: the review was pinned to a SHA, and a docs commit would have moved #23's head off it.
6. **Runbook step 5 gains a post-apply probe with no session.** The observations, their mechanism, and the rule that an answer matching neither string fails, are in step 5 of `docs/runbook-supabase-project-creation.md`. The session-200 check moved to onboarding (B1).

### 016 — unblocked for a scope proposal, with a constraint

- **The snapshot derives from `ward_public`, never from the base tables.** `snapshot_current` is the public read path, cached at the edge. A snapshot assembled from base tables would be a second route to ungated counts: the (b) defect one layer out, served to anonymous traffic through a CDN. A structural reason it cannot read `ward_public` is raised before building.
  - _SUPERSEDED by R-2026-09-15-04, below: the constraint was stated at the wrong level._
- **Condition F extends** to whatever refreshes `snapshot_current`.
- **R1(a) holds nothing up.** O2 settled the floor, and 014's floor test showed that adopting one later is a value change, not a signature change.

**Sequence after 016's ruling:** tick reconciliation, then the `scripts/` survey.

## Migration 016 — the snapshot, 2026-09-15

_Rulings R-2026-09-15-04 and R-2026-09-15-05. #24 merged at c618b8f first._

### The constraint, corrected — two clauses

**The founder's correction of their own wording.** "Derives from `ward_public`, never the base tables" was stated at the wrong level. `public.lga_rollup` is a published surface with its own control (the k-floor and the 0.40 dominance rule), so reading it would not be an ungated route.

**The real defect in v2:280** is that `app.refresh_lga_rollup()` would make the generator a WRITER of a published surface inside the public read path, holding base-table locks in the snapshot transaction. 008:176-177 already states the principle: `app.project_facility` is "the single writer of public.facility_public and public.ward_public".

**The constraint is now:**
- the generator READS only published surfaces;
- the generator WRITES only `public.snapshot_current` and the heartbeat.

Both clauses are asserted against the live function body in `tests/db/snapshot.test.ts`, with plants for a rollup refresh, a write to another published surface and a base-table read.

### The five decisions

1. **The rollup is OUT of 016.** No refresh call and no payload key; it gets its own ruling at Stage 3.
   - Beyond the writer clause: v2:225 defers the payload key to Stage 3, and the fixture envelope has no rollup key, so the refresh would compute something nothing reads.
   - v2's finding 1 — `refresh_lga_rollup()` has no production caller — is real and stays **OPEN**. Its reason does not imply v2:280's instruction; any scheduled caller solves it.
     - _Superseded 2026-09-16 (R-2026-09-16-08): closed by 017's second pg_cron job, a separate transaction outside the generator. See the R-2026-09-16-07 to -10 block below._
2. **The scheduler is split.** 016 is the table, the generator and the heartbeat column. 017 is the pg_cron extension, the schedule, and condition F's analogue asserting the job exists, is active and is on schedule.
   - The reasons: different blast radius, independent down-paths, and F can only assert a mechanism that exists.
   - v2:319 ("the dual scheduler already exists") is a failed kickoff claim. **Required before 017:** sweep v2 for every "already exists" / "already stood up" assertion and mark each verified or superseded. Five have failed so far: "014 is one index", the frontier line, v2:319, v2:320 (heartbeat yes, `/api/health` nowhere) and v2:217's `service_role` grant.
3. **The reader is `service_role` ONLY.**
   - v1:258 already ruled the mirrors are defence in depth, not the serving path; the serving path is the static file at the edge.
   - An anon-readable `snapshot_current` would be a second serving path around the CDN, with no `s-maxage`, disagreeing with the edge on freshness.
   - As built: RLS enabled and FORCEd, zero policies, every client role revoked by name, `GRANT SELECT TO service_role`.
4. **Retention appends, is bounded, and is pruned in the generator's own transaction.**
   - A separate pruning job would be a second orphan needing a caller.
   - The window is `app.snapshot_retention()`, 24 hours, the ruled default absent a measured detection latency.
   - The reason that carries it: the heartbeat says the generator is stale now; history says when it stopped and for how long.
5. **`v` is a bigint from the identity sequence,** never `max(v)+1`.
   - A content hash is identical across two runs on a quiet night, so "`v` has not moved" could not tell a dead generator from a quiet one.
   - **A gap in `v` is not a missing snapshot.**

### The RLS hazard, and the control actually adopted

- **The founder's hazard (R-2026-09-15-04, inferred) was checked.** Local `postgres` is `rolsuper f`, `rolbypassrls t`, and so is `service_role` (observed); it is not superuser, as that ruling guessed. A non-bypass role reading a FORCE-RLS table silently reads zero rows (observed). Hosted role attributes were unobserved here; they were observed on 2026-09-15 and are identical to local (see "Hosted role rows — R-2026-09-15-08" below).
- **The ruled durable control was null under its own hazard, and that was the founder's error (R-2026-09-15-05).** A count-equality check reads the mirrors as the same role under the same RLS, so under the hazard both the payload and the count are zero, and the check passes exactly when the system is broken. It stays, re-aimed at rows dropped between read and encode, with its own plant.
- **Adopted: `SET row_security = off` as a function attribute.** With it, Postgres raises "query would be affected by row-level security policy" at the read instead of applying a policy. This is enforced by the engine at the point of the defect, and asks the actual question rather than a proxy such as `rolbypassrls`. Planted in `tests/db/snapshot.test.ts` with a non-bypass owner.
- **Narrower than first stated, observed while building.** Without the attribute, today's table would not publish an empty snapshot. `snapshot_current` has zero policies, so a non-bypass owner's INSERT is refused too, naming `snapshot_current` rather than the mirror that was read wrongly. An empty snapshot is published only if a policy ever lets the generator's role write; that is reproduced as a counter-control.
- **The pairing:** `row_security = off` catches the generator losing its bypass; `tests/db/rls_enabled_everywhere.test.ts` catches RLS being dropped from a mirror.

### EXECUTE is owner only

REVOKE from PUBLIC, anon, authenticated and `service_role`; no grant in 016. A grant through a schema wall the grantee cannot see is the shape M1 rejected at 014.

**Flagged forward to 017:** a `service_role` grant is no route for an external caller. The real options are pg_cron running as `postgres`, a direct connection as the owner, or a public wrapper with EXECUTE for `service_role` — which reopens decision 3 and must be faced deliberately.

### Also in the 016 change

- Golden-path `snapshot-regenerates` now verifies the republished count its description claims.
- 003:98-101 and 003:129-132 name `app.lga_rollup`; the table is `public.lga_rollup`.
  - **The ruling asked for 003 to be edited. The standing rule forbids editing a migration once it is FROZEN — recorded in hosted's `app.schema_migrations`** — so the correction is recorded here and in 016's header instead.
    - **The criterion is the rule; the range is an observation.** Which files are frozen is recorded in one place, `database/migrations/applied-hosted.json`, and is not restated in prose (R-2026-09-16-03).
    - _Dated note: the window was 001–013 when this was written, and the apply of 2026-09-16 made it 001–016. 003 was frozen then and is frozen now, so this correction stands as recorded._

### After the merge — R-2026-09-15-06 and R-2026-09-15-07

_#25 merged at ca79b5d (merge commit f3afcfc). 016 was then amended in a follow-up change, before any durable database ran it._

**(1) Property: the snapshot reader must not be able to read zero rows silently.** The founder ruled the property; the mechanism was the implementer's.
- **Observed 2026-09-15, locally, rolled back:**
  - a reader holding SELECT on `snapshot_current` but not BYPASSRLS reads `rows=0` silently, as a plain grantee and as a non-bypass member of `service_role`;
  - with a policy `FOR SELECT TO service_role USING (true)`, that member reads `rows=1`;
  - anon, with the policy present, is still refused with `permission denied for table snapshot_current`.
- **Mechanism: the policy.** Prevention beats detection where prevention is available: the read stops depending on a role attribute, rather than merely failing loudly when the attribute is gone. The generator took `row_security = off` because it has no alternative — a policy for it on the mirrors would widen the mirrors.
- **Rejected: `ALTER ROLE service_role SET row_security = off`,** for three reasons:
  - it converts a silent wrong answer into a loud outage;
  - its blast radius is every `service_role` read of every RLS table;
  - it mutates a Supabase-managed role no migration can assert and a platform upgrade can reset — a proxy control.
- **Decision 3 is unchanged in substance.** The reader is still `service_role` only, and the GRANT is what makes that true: anon is excluded by the missing grant, checked before RLS is consulted, so a policy scoped TO `service_role` opens no second serving path.
- **The test asserts the one policy exactly** (name, SELECT, TO `service_role`, qual `true`), with a non-bypass-member leg, a counter-control where the dropped policy reads zero, and the anon leg.

**C2 — BOUNDED ACCEPTANCE: the ledger cannot distinguish the two versions of 016.**
- `app.schema_migrations` records a file by name with `ON CONFLICT (filename) DO NOTHING`, so a database that ran the pre-amendment 016 records nothing when the amended file arrives.
- It is accepted because no durable database has run either version: 016 has run only on disposable local and CI databases, and the hosted apply was held.
  - _The hold was lifted on 2026-09-15 by R-2026-09-15-08. The boundary below is unchanged: the hosted apply runs from the amended file on `main`._
- **The boundary:** the hosted apply happens from the amended file only, and no database that matters ever runs the pre-amendment version.
- **If that ceases to be true before the hosted apply, this acceptance is void and returns to the founder.**

**C3.** 016's reader section is rewritten, not annotated: grant decides who can read, RLS decides what a reader sees, and why the `service_role` policy does not reopen decision 3.

**(3) The count-equality check guards an edit, not a runtime event.**
- **The founder's correction holds.** The read CTE and the encoded array consume one statement's snapshot, and `jsonb_build_array` is never NULL, so they cannot disagree at runtime; the header claimed more than that.
- **Two parts of the ruling's reasoning did not hold, checked 2026-09-15:**
  - **"It guards MATERIALIZED staying put".** EXPLAIN shows a CTE referenced twice is materialised without the keyword, and `NOT MATERIALIZED` still reads under one statement snapshot, so the keyword is not load-bearing.
  - **"surfaceViolations catches the source edit more directly".** An encode-side `WHERE` on `src` names no new table, so the surface check passes it; the rows-dropped plant is exactly that edit.
- **What the check actually guards,** now stated in 016's header and the test name: a source edit that filters or drops rows in the encode step.

**(2) The hosted role check.**
- **The rows were returned on 2026-09-15** and are recorded below under "Hosted role rows — R-2026-09-15-08". What follows is kept as written before they arrived.
- **Both rows are to be recorded when the founder returns them:** `postgres` and `service_role`, `rolsuper` and `rolbypassrls`.
- **Premise correction, repeated in -06 and -07, still not holding.** "The hosted projection working is evidence postgres comes back t" rests on something that has not happened. No facility is onboarded (B1), `scripts/seed.sh` refuses non-local databases, and runbook step 6 recorded only `HTTP 200` for the mirror reads. The projection has never written a row on hosted, so neither row has evidence.
- **What each row changes:**
  - **hosted `postgres` without bypass:** 016's generator raises on every run, loud by design and pointless to schedule; 008's `project_facility` upsert would be refused loudly, and its DELETE would remove zero rows silently.
  - **hosted `service_role` without bypass:** since the amendment, the snapshot read still works through the policy. It is no longer silent either way.
- **008's `project_facility` DELETE** depends on owner bypass, is not reached by a `service_role` policy, and stays its own item on this branch. A policy for the owner would widen the mirrors' policy set and is not ruled.
- **Held until the rows return:** the hosted apply of 016 and 017's schedule.

**(4) Closed items.**
- **`app.system_heartbeat` has no RLS in any migration** (observed `relrowsecurity` f; all 16 `app` tables are RLS-disabled, the `app` wall being grants and schema USAGE). So `row_security = off` bites only on the generator's two mirror reads. The prior handoff's open item is closed.
- **Realtime:** `tests/db/config_drift.test.ts` asserts the publication holds exactly the three mirrors, so `snapshot_current`'s absence is asserted, not merely commented.
- **The 2026-09-15 handoff** is in `docs/`.
- **Noticed while meeting C1:** the idempotency digest in `tests/db/migration_idempotency.test.ts` did not cover policies. It now does, with a plant. It still does not cover grants or RLS flags, which is recorded for the `scripts/` survey.

### Hosted role rows — R-2026-09-15-08

_#26 merged at 9e77e9c (merge commit 984ff1b)._

**The rows, observed 2026-09-15 by Cowork, read-only, on Supabase project `klrlpxysjsjpdkeqdhvl`:**

| role | `rolsuper` | `rolbypassrls` |
|---|---|---|
| `postgres` | f | t |
| `service_role` | f | t |

- **The ref is OpenBed's,** confirmed against this repository's own records before recording: runbook step 1 (`ref : klrlpxysjsjpdkeqdhvl`), the region discharge at v1:105, and the ward-level identity memo.
- **Both rows are identical to local** (observed 2026-09-15, Supabase CLI 2.117.0, PostgreSQL 17.6).

**H1 — the hosted hold is lifted.** The generator's owner holds BYPASSRLS, so `row_security = off` will not raise on hosted, and 016 is not dead on arrival. The hosted apply of 014–016 and work on 017's schedule are both unblocked.
- **The apply is the founder's to run,** from the amended 016 on `main`, so C2's boundary holds.
- **Three migrations arrive together:** hosted holds 001–013, so step 5's dry run shows three `WOULD APPLY` lines.
  - _Superseded 2026-09-16 (R-2026-09-16-02): the apply ran, printed exactly those three lines, and hosted now holds 001–016._

**H2 — R-2026-09-15-06 item (2) is closed, on observed attributes.** `postgres` holds BYPASSRLS on hosted, so 008's `project_facility` DELETEs on the FORCE-RLS mirrors do not silently remove nothing.
- **One half rests on inference, stated rather than hidden.** A SECURITY DEFINER function runs as its OWNER, and the hosted owner of `project_facility` and `app.regenerate_snapshot()` has not been observed.
- It is expected to be `postgres`, the role that applies migrations, and runbook step 5 now carries a post-apply owner read that makes it observed.

**H3 — `.claude/rules/test-conventions.md` §4 is closed.**
- **The original claim was wrong in both directions.** It said "Supabase's `postgres` role is superuser locally and is not hosted". Local `postgres` is not superuser, and hosted `postgres` is not either.
- **On this axis, append-only enforcement does not differ** between local and hosted.
- **The §4 entry moves from unverified to observed,** and keeps its discipline sentence.
- **Runbook step 8 carried the same claim** as its reason for existing, and is corrected in the same change.
- **So did five other places, found by grep and corrected in the same change:**
  - the headers and two test names of `tests/db/append_only_enforcement.test.ts` ("even as superuser");
  - the header of `tests/db/publish_ward_status.test.ts`;
  - a comment in 014 (comment only; 014 is unapplied on hosted);
  - `.claude/rules/code-pipeline.md` Clause 4's list of hand checks;
  - the comment in `tests/e2e/_harness.ts` about who may set `session_replication_role`.
- **`database/migrations/010_append_only_enforcement.sql` carries it too** (header lines 26-28). 010 is applied and is not edited; this record is its correction.

**The reader policy stays — as defence in depth, not as a fix for a live fault.**
- **The hazard it prevents was never live on hosted:** `service_role` holds BYPASSRLS there.
- **The reasoning was never that the attribute was false.** It was that the snapshot read should not depend on an attribute Supabase manages, which a platform upgrade or a project restore can change.
- **Nothing in R-2026-09-15-07 is reversed.**

**Checked and dropped, recorded so it is not re-raised.**
- **The concern:** the generator's prune DELETE would silently remove nothing under a non-bypass role, which looked like a second silent path beside the reader policy.
- **Why it is not one:** `app.regenerate_snapshot()` is SECURITY DEFINER, so the effective role is always the owner, and `row_security = off` raises at the first mirror read long before the DELETE.
- **Covered by the existing pairing;** no new control.

**For 017.**
- **Role attributes do not block the public-wrapper option:** `service_role` holds BYPASSRLS on hosted.
- **The wrapper still reopens decision 3** on the public-surface question. That is the reason to choose or reject it, not the role attributes.

**Method note 5 — the second mechanism claim this loop caught.** R-2026-09-15-06 item (3) said the count check "guards MATERIALIZED staying put".
- **EXPLAIN showed otherwise:** a CTE referenced twice is materialised regardless, and `NOT MATERIALIZED` still reads under one statement snapshot.
- **The founder accepted the correction** (R-2026-09-15-08). It follows the count-equality control.

### R-2026-09-15-09 — PR #27, the pre-017 sweep

_#27 was approved and merged at 2439938 (merge commit 3a45e67). The follow-ups F1–F3 were commissioned in the same ruling and delivered in #28._

**The sweep.**
- **96 claims were enumerated with line citations,** in `Sprint Kickoffs/sweep-2026-09-15-v2-enumeration.md`. Each is an assertion in the v2 kickoff that something exists, is in place, was stood up, runs or is asserted.
- **The verdict split, as corrected by R-2026-09-15-10:**

  | Verdict | Count |
  |---|---|
  | VERIFIED | 70 |
  | SUPERSEDED, failed | 5 |
  | SUPERSEDED, stale | 9 |
  | superseded in the document already | 5 |
  | not checkable from the repository | 7 |

- **The unit** is one enumerated claim. An item carrying several assertions takes one verdict.

**What the sweep found beyond what was already known, classified by verdict.**
- **The five known going in** were:
  - three failed claims: `regenerate_snapshot`'s `service_role` grant and "three mirrors", the dual scheduler, and `/api/health`;
  - two claims already superseded in the document: "014 is the idempotency index" and "014 adds one index".
- **New failed claims (two):**
  - the referral guard's "legs 1–4 execute today", with none of its four files present;
  - the touch-trigger count: five triggers, not four.
- **New stale claims:** finding 2, overtaken by 014's unique index, and seven others. They are listed in the kickoff's sweep section.
- **Outside the 96, found in passing:** 005:211's comment that patient-information validation "also runs at the RPC layer". No such validation exists. 005 is applied, so the sweep section records the correction.
- _The ruling text of R-2026-09-15-10 called these "four new failures". Two are failed, one is stale, and one is not an enumerated claim. They are recorded here by class._

**The superuser claim was swept, not patched.**
- **Found by grep and corrected:** six places, listed under "Hosted role rows — R-2026-09-15-08" above.
  - One is runbook step 8.
  - One is a comment in 014. It is comment only, and 014 is unapplied on hosted.
- **Recorded, not edited:** `database/migrations/010_append_only_enforcement.sql`'s header. 010 is applied.

**F1–F3, each discharged by #28 as amended by R-2026-09-15-10:**
- **F1:** the instance-count items. Ruled under R-10 A1 as six families and nine instances; the unit is stated at the kickoff's paragraph and under its verdict table.
- **F2:** `tests/e2e/_harness.ts`'s CI claim, from inferred to observed. R-10 P1 rewrote it to the ratchet mechanism.
- **F3:** the supautils dependency, as a LOCAL AND CI ONLY row in the runbook's un-automatable table. R-10 P2 rewrote "superuser-only" as superuser by default, and named GRANT SET ON PARAMETER as the route not in use.
- **Method notes 6 and 7** were added below.

### R-2026-09-15-10 — PR #28 review

_Approved in substance at e133ff6, with three amendments and two precision points, then one verification pass before a merge pinned to the amended head._

**A1 — ruled (a): finding 6's two headers are in the family.**
- **The clause:** "the same family" follows the one family the paragraph names, a mechanism present and not reaching.
- **Families (six):** grep guard, sed plant, phantom links, fingerprint alert, finding 6's headers, `refresh_lga_rollup()`.
- **Instances (nine):** 1 + 1 + 3 + 1 + 2 + 1.
- **The two stated counts:** finding 1's "sixth" is the sixth family, and "Five" counts the list before the finding-6 clause.
- **Verdict:** not a failure; the unit was unstated. #28's first version, "matches neither", is recorded as corrected. The finding-6 clause is unchanged.

**A2 — the unit stated under the table, and a recount.**
- **Premise correction:** the table counts by enumerated claim, not by assertion. Recounted mechanically from the enumeration, one verdict per item.
  - The ruling's own proofs fit that unit: finding 6 is two items (#10, #11), and the CDN pair is two items (#28, #44).
  - It is not an assertion count: #41 is one item carrying two failed assertions, and VERIFIED items #25, #53, #82 and #95 each carry several.
  - A strict assertion recount would re-split all 96 by a rule no reader could re-derive.
- **So failed was 6 before A1, not 7;** after A1 it is 5.
- **Result:** 70 / 5 / 9 / 5 / 7, total 96 unchanged.
- **Found while recounting:** the sweep section said the citations "are kept". They were kept only in a session-local transcript, so the enumeration file was added.

**A3.** The R-2026-09-15-09 block above was missing, and is written.

**P1.** `tests/e2e/_harness.ts` and the runbook row now name the ratchet mechanism:
- the e2e project's globalSetup calls `seedE2eCorpus()`;
- the golden-path job gates on the ratchet's 10 tests, not the 20-step golden path;
- its anti-vacuity leg and its at-or-before-the-frontier leg cannot be green without the seed;
- both were green on 2439938.

**P2.** "Superuser-only in stock Postgres" became superuser by default.
- `supabase/config.toml` pins PG17, and since PG15 `GRANT SET ON PARAMETER` can delegate the setting.
- That route is not the one in use: `has_parameter_privilege('postgres', 'session_replication_role', 'SET')` is f, observed 2026-09-15.

**The handoff** `docs/handoff-2026-09-15-rulings-06-to-09-and-hosted-rows.md` moved into `docs/` with #28, not with 017, and carries a location note.

**Unchanged:** F2 and F3 discharge on their conditions; method notes 6 and 7 are accepted as written.

### R-2026-09-16-01/02 — the hosted apply of 014-016

_Run by the founder on hosted `klrlpxysjsjpdkeqdhvl`, 2026-09-16, from `main` at 2eed3ef. R-2026-09-16-02 supersedes the -01 paste block: same work, plus the reader-policy read and one corrected expected string. Everything below is **observed**, founder-run; Claude Code read the outputs, not the project._

**The run.**
- **Dry run:** 13 already applied; exactly three `WOULD APPLY` lines in apply order -- `014_publish_ward_status.sql`, `015_ward_status_history_text_category.sql`, `016_snapshot.sql`; `3 migration(s) pending.`
- **Apply:** `Migrations complete (3 applied this run).`
- **Ledger:** 16 rows; the second dry run `0 migration(s) pending.`
- **Reload:** `NOTIFY`. **Probe:** PASS on `permission denied for function ward_status_history`, the fresh-cache string.
- **Owners:** `project_facility owner=postgres`, `regenerate_snapshot owner=postgres`.
- **Reader policy:** exactly one row -- `snapshot_current_service_role_select | SELECT | permissive=PERMISSIVE | roles={service_role} | qual=true | with_check=(null)` -- and `relrowsecurity`/`relforcerowsecurity` = `true true`.

**H2 is CLOSED IN FULL.** Both SECURITY DEFINER writers are owned by `postgres`, which holds `rolbypassrls t` on hosted (R-2026-09-15-08).
- **The inferred half is gone.** A SECURITY DEFINER function runs as its owner, and that owner is now observed.
- So nothing in 008's `project_facility` DELETE behaviour, or 016's generator INSERT and mirror reads, rests on an unobserved attribute.

**The reader policy is LIVE HOSTED, observed, with its exact shape.** R-2026-09-15-07 chose prevention over detection; that choice is now a control on hosted rather than an inference from a local run.
- **Why the observation was needed, and why the apply could not supply it.** 016 creates the policy inside a `pg_policies`-guarded `DO` block, and psql echoes `DO` whether the block created the policy or found one. The apply's own output cannot witness it.
- **And why nothing else would have caught it.** `service_role` holds BYPASSRLS hosted, so a missing policy reads identically until the platform change the policy exists to survive.

**C2's BOUNDARY HELD, AND WAS OBSERVED.** The acceptance was that no durable database ever runs the pre-amendment 016.
- **The evidence is the apply's own echo:** 016 printed **three** top-level `DO` blocks.
- **That distinguishes the two versions.** At ca79b5d, 016 as first merged, there were **two** `DO` blocks and no `CREATE POLICY`; from 9e77e9c there are **three** and one. So hosted received the amended file, and the boundary is observed rather than asserted.

**HOSTED NOW HOLDS 001-016.** Corrected in the same pass, each dated rather than rewritten: this record's R-08 line, the v2 kickoff's :70 marker, the 2026-09-15 handoff's location note, `docs/runbook-key-rotation.md`, and the runbook's step 5 and step 7.
- **Step 5's dry-run expectation is restated** for a project at 016: no `WOULD APPLY` line and `0 migration(s) pending.` The three-line expectation would now read wrong on a correct run, which is the defect that section exists to warn about.

**The runbook gap, closed in the same change.** Step 5 checked the schema cache and the function owners, and nothing read the policy. It now carries a third post-apply subsection, with the two-query read-only block, the exact PASS lines, the failure rule, and its own box.
- **`true true`, not `t t`.** `relrowsecurity` is `boolean`, and concatenating a boolean into text renders `true`/`false`; `t`/`f` is psql's column display form only. The -01 draft said `t t`. Recorded because a stop condition that reads wrong on a correct run trains readers to ignore stop conditions.
- **Never create or alter the policy by hand.** Hosted would then hold a policy no migration produced, out of step with 016 and with `tests/db/snapshot.test.ts`.

**The reader-policy check adds no test, and that is deliberate.** The policy's exact shape is already asserted by `tests/db/snapshot.test.ts` on every run; hosted itself cannot be asserted from the repository, so it is a hand check with a box (Clause 4). _R-2026-09-16-02 said this change carried no test change at all. That was superseded within the same change by R-2026-09-16-03, which requires the frozen-migration guard below._

**Not in scope, and untouched:** anything that changes hosted state, running the generator hosted, and 017's caller route, which stays the founder's and undecided.

### R-2026-09-16-03 — the frozen window: a criterion, a discriminator, and a guard

_Ruled while recording the apply above, on the branch carrying it. It supersedes R-2026-09-16-02's "docs only" and "no test change expected" framings._

**The rule is a CRITERION, not a range. A migration is frozen once it is recorded in hosted's `app.schema_migrations`.**
- **Restated in both live rules:** this record at the 003 correction, and the v2 kickoff's second standing rule. v2's failure-mode sentence is kept verbatim -- a Stage 1 fix quietly editing `004` on a branch that outlives the apply, after which the ledger and the schema disagree and nothing errors.
- **The range is an observation with a date, and it lives in ONE place** both rules cite: `database/migrations/applied-hosted.json`. It was 001–013 until 2026-09-16 and is 001–016 now.
- **Why:** a hardcoded range went stale at this apply and would go stale at every future one, in however many places it had been restated by then. It is step 5's own "express it as files, not a count", and `.claude/rules/test-conventions.md` §8's shared-fixture-link principle applied to prose.

**LIVE RULES versus DATED RECORDS — the discriminator, recorded as method note 8 below.**
- **Amended:** the two live rules only.
- **Not amended, deliberately:** `docs/handoff-2026-09-10-stage-0-and-guard-sweep.md`, and the R-2026-09-15-08 line in this record saying hosted holds 001–013. Each describes a moment; each is superseded by a dated note, never rewritten. The precedents are the moved handoffs and 010's header.

**R-2026-09-16-02's own sweep instruction was wrong, and is corrected rather than executed.**
- It said to grep every present-tense "hosted holds 001–013" and fix each in the same pass. Executed literally, that edits `database/migrations/014_publish_ward_status.sql:12` -- "Empirical state at base: 001-013 applied".
- **014 is frozen.** It was applied hosted on 2026-09-16, so the sweep instruction and the freeze rule contradicted each other, and **the rule wins**.
- **014 is not edited.** Its line is now itself frozen, and this record is its correction -- the same idiom as 010's header. It is a worked example of the rule's reach: the sweep that records an apply can be the very thing that edits applied history.

**The rule was enforced by nothing. It is now enforced by a guard, in the same change.**
- **`database/migrations/applied-hosted.json`** records the project ref, the observed date, the ruling, the ledger count, and a sha256 per frozen forward file. `.down.sql` files are never applied hosted, so they are not frozen.
- **`tests/compliance/frozen_migrations.test.ts`** asserts each frozen file's current hash, that the frozen list is a **contiguous prefix** of the migration sequence, and that its length equals the recorded ledger count.
  - **The last two are the implementer's addition to the specified design.** The reflex to survive is not only "regenerate the hash" but "delete the row for the file I just edited". Contiguity plus the count makes that visible: greening a real edit then also means restating what hosted ran, which someone has to write down.
  - **Its failure message names the defect and the right move** -- a new migration -- and never points at the recorder.
- **Legs:** a plant editing a frozen file's bytes, a plant deleting an entry from the boundary, a plant deleting a frozen file, an ACCEPT over the real tree, a NEGATIVE CONTROL showing an unapplied `017` is untouched by the guard, and two anti-vacuity legs (an empty frozen list, a missing boundary file).
- **`scripts/freeze_applied_migrations.mjs`** records the boundary from the ledger count read in the same session, and **refuses** when that count and the repository's forward migrations disagree rather than recording a mismatch nobody observed.
- **Runbook step 5 gains the step that runs it,** so the file cannot drift from the ledger silently.

**Also closed here:** the runbook's "the client used for that run is not recorded here". The founder confirmed `psql` **18.6** for the 2026-09-16 apply, so step 7 carries it as an observation of that run rather than a version carried forward from 2026-09-13.

### R-2026-09-16-04 — PR #29 verified and merged

_#29 merged at 0d3de1c, pinned (merge commit f8ffc8f). VERIFIED with no amendments, and no further review round._

**What the founder verified independently, rather than taking as reported.** The distinction matters: the PR's own attestation is the implementer's claim about the implementer's work.
- **All 16 recorded SHA-256 digests recomputed from disk:** no mismatches. `ledger_rows=16` agrees with `frozen.length=16` and with the ledger observed hosted.
- **The `database/migrations/` diff is exactly one line:** `A applied-hosted.json`. **No applied migration was edited** — the rule this PR restates, checked against the PR that restates it.
- **`forwardFiles` excludes `.down.sql` and non-`.sql`,** so the boundary file cannot perturb its own instrument. An instrument that counted itself would be the failure this repository keeps finding one level up.
- **The dated records are untouched:** both 2026-09-10 handoffs, and this record's R-08 line.
- **The moved handoff's body is still byte-identical** to the copy in `cowork-handoff/`; only its location note grew.
- **No assertion line removed** under `tests/`.

**The two assertions the implementer added beyond the ruling, and the reason, which is the load-bearing part.** `tests/compliance/frozen_migrations.test.ts` asserts, besides each frozen file's hash, that the frozen list is a **contiguous prefix** of the migration sequence and that its length equals the recorded `ledger_rows`.
- **The obvious move is not regenerating a hash. It is deleting the row for the file you just edited.** A hash-only guard is defeated by that, silently, without anyone having to write down anything false.
- **With these two, that move fails loudly,** and greening a genuine edit also means restating what hosted ran — a claim with a date and a ledger count behind it, which someone has to assert rather than quietly refresh.
- The design was specified by the ruling as a hash set; these were the implementer's addition, and the ruling invited exactly that judgement.

**A premise the founder corrected as their own.** R-2026-09-16-03 said the five modified files were uncommitted **on main**. They were not: the branch was cut before the edits, and main was clean at 2eed3ef throughout.

**017 is not started.** Its caller route is the founder's and undecided, and building the schedule against an undecided route is the deferral this sequence exists to avoid.
- _Superseded 2026-09-16: the route was ruled (R-2026-09-16-07) and 017 was built. See the next block._

**Watch item, carried into this block by the next change to touch the repository (R-2026-09-16-06), which was 017's.** The first exercise of `scripts/freeze_applied_migrations.mjs` in anger is 017's own hosted apply, through the runbook step that regenerates `database/migrations/applied-hosted.json`. Every refusal has a plant, but the path has never been walked end to end, and the boundary regeneration is the step to watch when 017 lands. **A watch item, not a defect.**

### R-2026-09-16-07 to -10 — migration 017, the snapshot schedule

_Ruled by Cowork in `Sprint Kickoffs/sprint-kickoff-017-schedule-2026-09-16.md`, amended three times on 2026-09-16 as the Bundle 0 probe answers came back. Every "observed" below was run by Claude Code against the local stack (Supabase CLI image, PostgreSQL 17.6, pg_cron 1.6.4), in rolled-back transactions where it touched data. Nothing here was observed on hosted._

**R-2026-09-16-07 — the route: pg_cron running as `postgres`, single head.**
- **The caller route and the scheduler shape were one decision, not two.** There is no server: `apps/public-dashboard` and `apps/ward-console` are static builds, and no `api` directory exists, so v1:293's `/api/sweep` and v1:294's `/api/health` never had a host. The external half of the "dual scheduler" could only have targeted PostgREST, and that is the public wrapper, which is decision 3.
- **v1 contradicts itself about pausing.** v1:293 justifies the external caller as a keep-alive because free projects pause. v1:396 settles Supabase Pro, "no pausing", and the project has been on Pro since 2026-09-12. v1:363 still makes "is the project paused" the first diagnostic step. The sensor argument survives (pg_cron cannot report its own death), but a sensor needs a reader of `app.system_heartbeat.last_snapshot_at`, not an HTTP endpoint; that is the alerting sprint's.
- **Cadence.** One minute (`* * * * *`), the nearest cron expression to v1:65's sixty seconds. v1:293's "every 10 minutes" is the alert sweep's cadence, not the snapshot's.
- **No grant.** The job runs as the role that scheduled it (`cron.job.username = postgres`, observed), and `postgres` owns both functions. `service_role` has no USAGE on `app`, so a grant to it was never a route. Rejected: a direct owner connection (a host and a stored credential that do not exist), and a public wrapper with EXECUTE for `service_role` (reopens decision 3).

**R-2026-09-16-08 — schedule the rollup too, and repair it first. Closes v2's finding 1.**
- A second job, `openbed_refresh_lga_rollup`, every five minutes. 016 declined to be the caller because calling the refresh FROM THE GENERATOR would make the generator a writer of a published surface inside the public read path. A separate job is its own transaction, outside that path.
- **The repair, and the reason that actually holds, which is the probe's, not the kickoff's first wording.** The kickoff first said a non-bypass owner "deletes nothing, inserts nothing, and nothing errors". Observed instead, with `app.refresh_lga_rollup()` handed to an owner without BYPASSRLS:
  - where any cell publishes, the INSERT is refused loudly;
  - where the recompute should make a cell **vanish** below the k-floor, the DELETE affects nothing, the function returns 0 silently, and **the cell stays published at its exact bed count** (Alimosho ICU_ADULT, 15 beds, after one of its five quiet facilities was deactivated). That is the disclosure the k-floor exists to prevent.
  - With `SET row_security = off` the same case raises at the DELETE: `query would be affected by row-level security policy for table "lga_rollup"`. Under `postgres` the refresh is unchanged.
- 009 is frozen, so the repair is a `CREATE OR REPLACE` in 017: 009's function text byte-for-byte plus the one attribute line.
- **Also observed, because 017 creates the first concurrent caller.** 009's header says concurrent refreshes are "safe under the table's primary key". Two overlapping refreshes: the second fails `duplicate key value violates unique constraint "lga_rollup_pkey"`, and the published rows are the first's and correct. Safe in that nothing is corrupted; the loser errors.

**R-2026-09-16-09 — corrections, and the duplicate check.**
- Withdrawn by Cowork as its own errors, each with a dated note in the kickoff: "one minute is the pg_cron floor" (1.6.4 accepts `'30 seconds'`, observed); "the five answers" against a list of six (restated as the list, not a count); and "deletes nothing, inserts nothing, and nothing errors" (above).
- **"`migration_idempotency` will catch a duplicate job" is withdrawn.** Its digest covers `app` and `public`; a second `cron.job` row is data in `cron`. Condition F re-applies 017 and asserts exactly one row per job name, with a duplicate plant.
- **Why a duplicate needs a second role.** `cron.job` carries `UNIQUE (jobname, username)`, and `postgres` cannot insert into `cron.job` directly (permission denied, observed). A same-name job exists only under another role, which is what the plant schedules.

**R-2026-09-16-10 — keeping the suite clear of the jobs: BOTH mechanisms. Supersedes R-09's single-mechanism framing.**
- **The flake is real and was measured.** With `openbed_regenerate_snapshot` live, 2 of 83 consecutive runs of `tests/db/migration_idempotency.test.ts` went red, each spanning a job run: the job writes `app.system_heartbeat`, which that test hashes before and after re-applying the migrations.
- **R-09 offered a rolled-back re-application inside condition F as the preferred answer and pausing as the fallback. They are not alternatives.** A rolled-back transaction inside F does nothing about a job writing during another test. So:
  - **suite isolation:** `tests/setup/global-setup.ts` pauses both jobs with `cron.alter_job(active := false)` and throws unless both then read inactive;
  - **condition F:** `tests/db/snapshot_schedule_state.test.ts` unschedules both jobs inside a rolled-back transaction, applies 017's file twice, and asserts the rows that produced. It never reads the ambient rows' `active` flag.
- **Two probe answers decided the shape (Bundle 0 Q8 and Q7).**
  - **Q8: re-scheduling does NOT reset `active`.** A job paused with `cron.alter_job` stayed paused when `cron.schedule` ran again for its name, even with a changed schedule string. So the pause survives `migration_idempotency` re-applying 017 mid-suite, and F must unschedule before re-applying or it would assert the pause, not the migration. Re-scheduling DOES overwrite `schedule` and `command`.
  - **Q7: `cron.schedule`, `cron.unschedule` and `cron.alter_job` are transactional.** Each left no trace after a rollback.
- **The pause is load-bearing, shown both ways.** With the live snapshot job set to `'1 seconds'` before every run: the pause call removed, 4 of 4 runs of `migration_idempotency` red; the pause restored, 4 of 4 green.
- **What the local suite does not prove: that the jobs are active on hosted.** The runbook's post-apply step for 017 reads both rows and a `succeeded` run for each.

**OWED — on the hosted apply of 017, move the frozen_migrations placeholder to 018** (R-2026-09-16-11).
- **Trigger:** the change that records 017's hosted apply in `database/migrations/applied-hosted.json` (runbook step 5, `freeze_applied_migrations.mjs 17 …`).
- **Destination:** `tests/compliance/frozen_migrations.test.ts`, which writes a placeholder named `017_snapshot_schedule.sql` into a scratch copy and expects no finding. Once 017 is frozen that placeholder is an edit to a frozen file, and the test reds.
- **Carried in the same change as the trigger, not a follow-up.** Also held in the resume memory with this trigger and destination.

**Findings outside these rulings, reported and not built.**
- _Superseded 2026-09-16 (R-2026-09-16-11): the first two were required rather than reported, and are built. See the next block. The third went to Cowork with line numbers._
- The e2e project has its own globalSetup and does not get the pause. `tests/e2e/golden-path.test.ts`'s "heartbeat fresh within one minute" check can pass because the live job wrote the heartbeat rather than the step's own call.
- In CI the jobs are live between `scripts/run_migrations.sh` and the db globalSetup, a window that includes `scripts/seed.sh`'s own `refresh_lga_rollup()` call. A rollup tick landing there fails loudly on the primary key (observed shape above), never silently.
- In the kickoff: Bundle 0 Q3 still says `migration_idempotency` "will catch it either way", unannotated; Bundle 2's blast radius says "n/a — new test file", but R-10 changes `tests/setup/global-setup.ts`; and Bundle 2's definition of done says "all three plants" against a list that grew.

### R-2026-09-16-11 — 017 approved in substance; the pause widened to the whole run

_Ruled by Cowork on afbd51c. Verified independently by the founder: parent af36ba1; the migrations diff is the two 017 files plus the README, no frozen file edited; 701 + 19 + 3 = 723; the sweep recount 69/5/10/5/7 = 96. Every "observed" below was run by Claude Code on the local stack._

**The ruling's premise, checked, and it did not hold as stated.** R-11 said golden-path step 9 (`snapshot-regenerates`) "is currently vacuous" and "can be green with the generator broken".
- **Observed:** with the step's own `select app.regenerate_snapshot()` removed, no pause, and the snapshot job running every SECOND (sixty times its real cadence, and it ran three times inside one 2.4-second e2e run), step 9 went **red in 4 of 4 runs** on "v did not increment". Its two reads of `v` sit milliseconds either side of the call, and a job commit would have to land inside that gap.
- **What does hold:** the step's heartbeat-freshness and republished-count checks WOULD be satisfied by a job regeneration. They are safe only because they sit behind `v`. A generator that raises, or that silently writes nothing, fails the job's run as well, so the job cannot mask a broken generator either.
- **The instruction survives on the reason that holds:** attributable evidence, and closing the rare window the `v` check leaves. That reason is now in the step's own comment.

**The seeding collision, checked, and not reproduced.** With the rollup job every second and the pause removed from `scripts/seed.sh`, seeding succeeded in **3 of 3** fresh resets, and no job run failed. The collision's mechanism is real: two overlapping refreshes make the second fail on `lga_rollup_pkey` (observed with a held transaction, above). But a millisecond refresh rarely overlaps one. The pause closes a possible window rather than a demonstrated flake, and is recorded as such.

**The seam, derived.** The ruling named the scope, migration to end of run, and left the seam open.
- **`scripts/seed.sh` applies the pause, after its host check and before any seed file.** It is the one script that structurally cannot reach hosted (`tests/compliance/seed_local_only.test.ts`), and it runs straight after `scripts/run_migrations.sh` on every local and CI database: `npm run db:reset`, CI `db-tests`, CI `golden-path`.
- **Rejected: `scripts/run_migrations.sh`.** It is also the hosted runner, and on hosted the jobs must stay active.
- **One implementation:** `database/local/pause_scheduled_jobs.sql`. Two top-level statements, so psql commits the pause before waiting out any in-flight run. The file raises `OPENBED_JOBS_NOT_PAUSED` on no pg_cron, a missing job, or a run still in flight at its deadline.
- **The db and e2e setups apply the same file again** through `tests/setup/db.ts`, then check the result with `scheduledJobPauseViolations()`. Step 9 calls the same checker before relying on the pause.
- **The settle is observed, not assumed.** After a committed pause, no run of a one-second job started in the next four seconds, in 5 of 5 trials, while its earlier runs were recorded. Two seconds is waited.

**The leg, with plants:** `tests/db/scheduled_jobs_paused.test.ts`, 11 tests.
- The checker: real, reactivated and unscheduled plants for each job, and anti-vacuity.
- The file: real, plus plants for no pg_cron (`DROP EXTENSION` rolled back), a missing job, and a run in flight at the deadline (a planted `running` row). A positive control shows a stale `running` row does not hold the pause.
- Five neuters of the file and the checker each turned exactly their leg red.

**Also corrected by R-11, as Cowork's:** the kickoff's Bundle 2 line registering new legs in `packages/fixtures/leg-coverage.json`. That register covers guard scripts in `scripts/` only, and correctly does not move. The line is struck in the moved copy.

### R-2026-09-16-12 — the kickoff corrected; R-11's two false premises recorded as Cowork's

_Ruled by Cowork after 839241a, which it accepted as built with no changes._

**R-11's premises, withdrawn by Cowork as its own errors.** The pause's reason is not restated from R-11 anywhere, because that reason did not survive.
- **"Step 9 can be green with the generator broken": false.** The disproof needed no run. The job calls the same function, so a broken generator breaks the job's runs too, and `v` moves from neither source. The millisecond gap between the step's two reads of `v` is why the claim never held, and the 4-of-4 with the step's own call removed is the observation. Cowork's own summary: R-11 asserted a failure mode from reading the source in the same breath as insisting a fix is accepted by executing it.
- **"The seeding collision is a flake": not reproduced.** 3 of 3 clean with a one-second rollup job. The accurate record is "a rare window, not a flake", and that wording replaces R-11's.
- **The pause stands on the justification that held:** the step's evidence stays attributable to its own call, and the rare collision window is closed.

**The kickoff's three contradictions, fixed by Cowork with dated R-11 notes** in `Sprint Kickoffs/sprint-kickoff-017-schedule-2026-09-16.md`:
- Q3's "`migration_idempotency` will catch it either way" is replaced by why nothing existing catches a duplicate (it asserts schema, and a second `cron.job` row is data), which is why the check is Bundle 2's.
- Bundle 2's "Blast radius: n/a" is replaced by its real reach, including `migration_idempotency`'s new dependency on the pause holding, named as the thing to re-check if the pause ever moves.
- Bundle 2's "all three plants" is replaced by the list. It was the second count in that document to disagree with its own list.

**Checked when the corrected kickoff was recopied (observed):**
- **Premise that did not hold.** The Q3 correction note says the claim and R-09's withdrawal "sat eleven lines apart". Before the fix they were at l.74 and l.234 of the `cowork-handoff/` original (l.82 and l.242 of the copy committed at afbd51c). That is **160 lines**, not eleven. The note is Cowork's dated correction and is left as written. The withdrawal line still cites the claim as "line 71", a stale line reference.
- **Complete as far as it goes.** The corrected blast radius does not name `database/local/pause_scheduled_jobs.sql`, `tests/setup/db.ts` or `tests/db/scheduled_jobs_paused.test.ts`. Incomplete rather than false; reported, not edited.
- **The moved copy** is the corrected original plus its location note and the R-11 strike of the leg-coverage line, which the original does not carry.

**Next, in order:** Cowork reviews the PR head; it merges; the hosted apply is the founder's (check pg_cron, apply, check the jobs, record the frozen boundary at 17). That apply discharges the OWED move of the frozen_migrations placeholder to 018.

### R-2026-09-16-13 — PR #31 approved; the kickoff's last three defects fixed by Cowork

_Ruled on 190f881. Verified independently by Cowork: three commits chaining from af36ba1, `main` still af36ba1; across the whole range `database/migrations/` gains only the two 017 files and the README row, so no frozen migration is edited in any commit; the three modified guards read individually (the runner literal 16 → 17, still not derived from the directory; two header-comment updates), with no assertion weakened. Merge pinned to the head carrying this block, with no further review round._

**Cowork's, all three, fixed in the kickoff as R-2026-09-16-13 (supersedes what R-12 left standing):**
- **"Eleven lines apart" becomes 160 (l.74 and l.234 before the fix).** A figure written without counting, inside a note whose subject was an unchecked claim. It is the third stated count in this document's lineage to disagree with what it describes, after "the five answers" and "all three plants".
- **"Line 71's claim" is now cited by name,** as Bundle 0's third question. A standing note at the end of Bundle 2's blast radius says why: a line number inside a document that edits itself goes stale as soon as anything above it moves, which is exactly what correcting this document did. Cite the section by name.
- **The blast radius now names `database/local/pause_scheduled_jobs.sql`, `tests/setup/db.ts` and `tests/db/scheduled_jobs_paused.test.ts`.** The first correction was not wrong; it was incomplete, which is the failure a blast radius exists to prevent, and the note says so.

The moved copy is the 386-line original plus its location note and R-11's strike of the leg-coverage line; `diff` shows the strike as the only change to the body.

### R-2026-09-17-01 — the hosted apply of 017, and the OWED placeholder move discharged

_Run by the founder on hosted `klrlpxysjsjpdkeqdhvl`, 2026-09-17, from `main` at 3d25b76. Everything below is **observed**, founder-run; Claude Code read the outputs, not the project._

**What the apply showed, in runbook step 5's order.**
- Client `psql` 18.6. **pg_cron before the apply:** `default=1.6.4 installed=none`, `preloaded=true`. Hosted pg_cron 1.6.4 is the version the local Bundle 0 probes ran against, so their observed semantics carry to hosted: re-scheduling keeps `active`, the calls are transactional, and a duplicate needs a second role.
- **Dry run:** one `WOULD APPLY`, `017_snapshot_schedule.sql`, and `1 migration(s) pending.`
- **Apply:** `Migrations complete (1 applied this run).` The echo mapped one-for-one to 017's statements in order, with the two `cron.schedule` calls returning jobids 1 and 2 -- the first cron jobs on this project.
- **Ledger 17**; second dry run `0 migration(s) pending.`
- **Reload NOTIFY; probe PASS** on the fresh-cache string.
- **Owners, three lines:** `project_facility`, `refresh_lga_rollup` and `regenerate_snapshot`, all `owner=postgres`. The rollup's owner question closes as its repair goes live.
- **Reader policy:** unchanged and exact.
- **Jobs:** both rows exactly as 017 schedules them, `active=true`, `username=postgres`; and `refresh_lga_rollup` `proconfig` = `search_path="",row_security=off` -- the repair observed on hosted, not inferred from the file.
- **Runs:** `openbed_refresh_lga_rollup succeeded 3`, `openbed_regenerate_snapshot succeeded 13`, no `failed` line. The 13:3 ratio fits one-minute and five-minute cadences over about thirteen minutes.

**The boundary conditions held.** 016's C2 boundary (the hosted apply runs from the amended 016 only) was observed on 2026-09-16 and is unchanged. 017 was applied from `main` at 3d25b76, the file merged in #31.

**What the echo does and does not show, stated because the ruling asked for it as evidence.** The two `cron.schedule` calls returning jobids 1 and 2, with the echo matching 017's statements in order, show that the two-job 017 ran and that no cron job existed before it. They cannot tell one version of 017 from another. There was no other version: 017 has not changed since it was written in afbd51c, and every committed version scheduled both jobs. _The ruling's word "amended" has no referent for 017 -- it was 016 that was amended._ The observations that pin hosted to the merged file are the jobs read (schedule, command, role) and the repaired `proconfig`, both exactly as the file sets them.

**The connection-string failure, and the control that paid for itself.** The first dry run failed with `psql: database "postgres " does not exist`: a trailing space in the pasted connection string, invisible because `read -rs` hides the paste by design. Re-pasting fixed it. What held is the reason it is recorded: `scripts/run_migrations.sh` refused to report ANY migration count over the failed connection and exited 3. A count over a dead connection is indistinguishable from one against a virgin database, and that count is step 5's stop condition. The refusal was added on 2026-09-12 (commit 4b75f43), after the script printed `13 migration(s) pending.` against a host that did not resolve. This apply was its first firing on a real hosted apply, per this ruling. Runbook step 5 now carries both the paste note and this record.

**The OWED obligation, discharged in this change (R-2026-09-16-11).** Both halves land together, because one without the other leaves the record half-true:
- `database/migrations/applied-hosted.json` regenerated by `scripts/freeze_applied_migrations.mjs 17 2026-09-17 R-2026-09-17-01`: 17 migrations, `001_app_schema_and_migration_ledger.sql` first, `017_snapshot_schedule.sql` last. The recorded SHA-256 of 017 matches the file on disk.
- The placeholder in `tests/compliance/frozen_migrations.test.ts` moved from 017 to 018. **Observed before the move:** with the boundary at 17 and the placeholder still named 017, exactly that test went red with `frozen migration 017_snapshot_schedule.sql CHANGED`, and the other six passed. After the move, 7 of 7.

**Queued, and none of it starts here:** the full v1 sweep, tick reconciliation, the scripts/ survey.

### R-2026-09-17-03 and -04 — the v1 sweep landed, and two mechanism checks run

_Cowork swept the v1 kickoff (117 items, `Sprint Kickoffs/sweep-2026-09-17-v1-enumeration.md`) and handed over two checks it could not run. Claude Code committed the enumeration unchanged, ran both checks against the local stack, and marked the kickoff. Everything tagged **observed** below was run by Claude Code on 2026-09-17 against local PostgreSQL 17.6 and Realtime v2.130.0; nothing here is a hosted observation._

**The reconciliation, and a premise that did not hold.** R-03 §1 said to re-run the enumeration's parser. **No such parser exists anywhere in the repository** — the enumeration pastes its output only. A fresh derivation from the rule the file states (each item's last bold verdict word) reproduced all six counts exactly: 117 = 66 / 21 / 12 / 7 / 11. The enumeration now carries that derivation as a runnable block, so the next reader re-runs it instead of trusting a paste.

**#12 — `is false` against a `tri_state` column [observed].** All three of `is false`, `is not false` and a bare `not` raise a type error ("argument of IS FALSE must be type boolean, not type app.tri_state"). The control in the same run, `IS NOT DISTINCT FROM 'NO'` and `= 'NO'`, returned the seeded row. So F2's SQL prescription, Bundle 1's `app.gate()` task and the lint's own list of "correct forms" each prescribed SQL that cannot compile. Verdict **FAILS**, and the correction reached four editable copies plus a note for frozen 002.

**#27 — Realtime and the anon key [observed].** Two subscribers joined `postgres_changes` on `public.ward_public` in one run, one holding only the anon JWT and a service-role control. One write to a visible facility's duty flag delivered **six UPDATE events, with full records, to each**. The control receiving is what makes this a statement about the policy rather than the harness. So "Realtime is retained for authenticated ward and admin devices only" is false as a property of the database: any holder of the published key can subscribe to the public mirrors. Nothing in the repository subscribes, so no client violates it today. Verdict **FAILS**, marked with the gap stated; the publication and policies are untouched, because what replaces the rule is a design ruling.

**R-04 A4's premise, checked before acting, and it does not hold as stated [observed].** A4 inferred that `= 'NO'` in a WHERE clause is "the silent-drop hazard returning by the front door". Over `YES`, `UNKNOWN`, `NO` and NULL:

| form | rows returned |
|---|---|
| `= 'NO'` | NO |
| `IS NOT DISTINCT FROM 'NO'` | NO |
| `<> 'NO'` | YES, UNKNOWN |
| `NOT (flag = 'NO')` | YES, UNKNOWN |
| `IS DISTINCT FROM 'NO'` | YES, UNKNOWN, NULL |

In positive position the two forms agree, in a WHERE clause and in a CASE arm alike, because NULL and false both skip; `app.gate()` returns NULL for a NULL flag. **They diverge only under negation.** So the property A4 ruled is satisfied by naming `IS NOT DISTINCT FROM 'NO'` as the form with `IS DISTINCT FROM 'NO'` as its complement, and allowing `= 'NO'` in positive position only — which is what the lint header and the SOP now say.

**The same finding one layer down: `M/006:75-83` gives a false reason for a correct form.** It says the two forms "diverge exactly when an argument arrives NULL" and the CASE branch is "silently not taken". In the CASE shape 006 actually uses they agree. `IS NOT DISTINCT FROM` is right because it stays total when negated. This is method note 7 again — an explanation carrying a decision, never probed — inside the single derivation site. 006 is frozen; the correction is in `database/migrations/README.md`.

**A3's root, stated.** The lint's header justified itself by the silent drop of a nullable boolean, which is the shape F2 rejected. Against the enum that shape does not compile. The guard is kept for the two reasons that do hold — the column type is a decision a later migration could undo, and the JavaScript half is still silent — and the header now says so. **The negated forms `<> 'NO'` and `NOT (flag = 'NO')` are caught by nothing** (planted, and the lint passes them, while a planted bare `NOT` fails as it should). That is now a NOT ASSERTED line rather than an assumption.

**Corrections to frozen migrations** are collected in `database/migrations/README.md` under *Corrections to frozen migrations*: 002:74, 004:294, 005:211 and 006:75-83. No applied migration was edited.

**#118 added.** Bundle 1's `app.gate()` task, "`is false` only", is a third claim at a citation the enumeration covers twice (#48, #49). Numbered 118 so nothing renumbers; the unit is unchanged. The recount, from the committed parser, is **118 = 66 HOLDS / 24 FAILS / 12 STALE / 7 SUPERSEDED-IN-DOC / 9 NOT CHECKABLE**.

**Obligations carried, and the code left alone.**
- **#71.** `publish_ward_status` writes the status, the event and the audit row in one transaction and enqueues nothing to `app.notification_outbox`. v1 requires the enqueue from B3's transaction at two places. 014 is frozen, so it lands as a `CREATE OR REPLACE` in a later migration, in the B5 sprint that does not yet exist, alongside the dispatcher that consumes the rows.
- **Recorded here, fixed by a later change:** #63/#97 (`ward_reply` has a cap and no content validation), #109 (Gate 3's property test does not exist), #115 (no strings module).

**Open design rulings this sweep produced, none of which an implementer can take.**
1. **The external-caller half of B5 (#30, with #87, #88, #89, #92).** A2's hosting split put "the API" on Vercel and nothing was ever built there. R-2026-09-16-07 marked the `/api/sweep` leaf and left the root, which is how six more items reached this sweep on the same premise. Until this is ruled, every B5 item naming an HTTP route is unbuildable as written.
2. **Realtime on the public mirrors (#27).** Either the rule changes, or the publication does.
3. **Whether an understated-but-bounded age may render green (#15).** The never-green guarantee as v1 words it does not hold; what shipped is a different and arguably better property.

**Scope held:** one pull request, no new migrations, no new tests, no API, no strings module, and no edit to 002, 004, 005, 006 or 014. The change to `.claude/rules/code-pipeline.md` is called out in the pull request as a rules change.

### R-2026-09-17-05 — #33 merged, three design rulings, and what the push side of the boundary turns out to allow

_#33 merged at its reviewed head `cc51d5d`, untouched; nothing was attached to a SHA-pinned approval. Everything below is the follow-up. Probe results tagged **observed** were run by Claude Code on 2026-09-17 against the local stack (Realtime v2.130.0, PostgreSQL 17.6), each with a service-role control subscribing in the same run. None is a hosted observation._

**Design ruling 1 — B5's external caller: CLOUDFLARE PAGES FUNCTIONS.** Founder's call, 2026-09-17. Cloudflare is already the deploy target and already an open s.29 / s.41 item, so this extends an agreement in progress rather than opening a second processor thread; the free tier covers this volume; launch cost stays ~$25/month (the kickoff's open decision 2, Supabase Pro, settled). It restores a host for `/api/*`, which is what six items failed for want of.
- The markers on #28, #30, #87, #88, #89, #92 and #107 now read *ruled 2026-09-17, build not yet scoped*. **No verdict changed**: those sentences were false at `db528f8`, and a later decision does not make them true.
- #28 and #107 carried no "open" clause — they were amended against the 2026-09-10 Gate 2 restatement, not against the host — so each gained one sentence saying the restatement stands regardless, because it turns on `stale-while-revalidate` rather than on where anything is hosted. **[SUPERSEDED BY NOTE 2026-09-21 (R-2026-09-21-43), left as written per method note 8. That sentence made the amendments host-proof by pinning them to `stale-while-revalidate` — **and SWR is the premise that has since failed**. The amendments survive, on the ~120-second end-to-end bound, which turns on neither the host nor SWR. Immunising a claim against one objection by tying it to a second, unverified premise moves the risk rather than removing it.]**
- **Not built here.** A host, `/api/health`, `/status`, the digest and the sweep caller are a sprint with a kickoff. R-2026-09-16-07's constraint binds whatever gets built: the sensor reads `app.system_heartbeat` and must not share pg_cron's failure mode.

**Design ruling 2 — when a tile may render GREEN (#15).** The property, mechanism left to the implementer (method note 5): *a tile renders GREEN only on an age whose elapsed term is known to be advancing. Where it cannot be, the badge degrades rather than greens.*

- **The finding is narrower than the ruling assumes, and for a stronger reason than D1's [observed].** `markFetch()` and `elapsedSince()` have **no production caller**. The only importer of either is `tests/compliance/freshness_bands.test.ts`; no app fetches, polls or renders a snapshot, and `apps/public-dashboard/src/main.ts` is the Bundle 1 stub that says so. Control: `@openbed/gate` *is* imported by that app, so the search reaches. **So there is no fetch to fail, no poll to stop and no tile to green.** This is a specification obligation on Bundle 4, not a live defect.
- **D1 — a runtime without `performance.now()` is not a real target [inferred, and not checkable from this repository].** It has been universally available in browsers since roughly Chrome 24 and Android WebView 4.4 (2013), which covers the low-end Android population this product aims at. There is no telemetry and, by design, no analytics, so the repository cannot settle it; what would settle it is field data the product does not collect. Accordingly the `markFetch()` → `0` branch guards a runtime the target population does not have, and **the finding narrows to the failed-fetch path**, as the ruling allows.
- **D2 — what a tile does when a fetch FAILS is unspecified, because there is no fetch.** Bundle 4 must state it, and the property above decides it: after a failed refresh the elapsed term keeps advancing from the last good mark, so age keeps growing and a tile ages out of GREEN by itself. A band must never be recomputed from a mark treated as fresh, and a refresh that has been failing for longer than `pollCadenceSeconds` must degrade rather than hold its last band. The danger is not a wrong number; it is a tile that is green and structurally incapable of being correct, which is the failure A1 reversed the Realtime design to remove.
- **Clause 5 classification, recorded:** `packages/snapshot/src/anchor.ts` and `packages/snapshot/src/freshness.ts` are **GUARD-AHEAD-OF-SUBJECT** — correct, tested, and reaching no production caller. They become LIVE as part of Bundle 4, not as a later tidy-up.

**Design ruling 3 — Realtime on the public mirrors (#27): NOT RULED.** The publication and the policies are untouched. The UPDATE payload carries nothing anon cannot already `SELECT`, so that half is not a disclosure. Both probes the ruling asked for were run, and both confirmed what was feared.

- **E1 — the DELETE case. CONFIRMED [observed].** Flipping one seeded facility to `quiet_mode = true` — the projection's delete path — delivered **7 DELETE events to the anon subscriber**: six on `public.ward_public`, one on `public.facility_public`. The control received the same seven. Under REPLICA IDENTITY DEFAULT the old row is the primary key, and `ward_public`'s key is `(facility_id, category)`, so each event reads:

  ```
  ward_public     DELETE record=null old_record={"category":"ICU_ADULT","facility_id":"a0000000-…-000000000001"}
  facility_public DELETE record=null old_record={"facility_id":"a0000000-…-000000000001"}
  ```

  **RETRACTED AS FIRST WRITTEN, and restated (R-2026-09-17-07).** This paragraph originally concluded: *"So an anon subscriber learns which facility went quiet, at the moment it went quiet, and which ward categories it had. The k-floor exists to stop exactly that being recovered by subtraction from the rollup; a DELETE stream needs no subtraction. Quiet mode is unobservable only to someone who is not listening."* Two things are wrong with it, and neither is a wording difference.

  - **Migration 008 anticipated this payload and defended it**, in the block headed *QUIET MODE IS A DELETE FROM THE MIRROR, AND THAT NEEDS DEFENDING*. It names both primary keys, says they are "public information by construction, since the facility was visible in the mirror a moment ago", and concludes the payload "leaks nothing beyond 'this facility stopped being listed', **which is exactly the observable fact quiet mode creates and cannot hide**". The finding was reported without reading the defence already in the file, and that defence is the answer to it.
  - **The k-floor's purpose was attached to a different claim.** The kickoff's `lga_rollup` task gives the k-floor one job: stopping a quiet facility's **numbers** being recovered by subtracting the visible facilities from the rollup. It says nothing about concealing **which** facility is quiet, and it was never a control over that.

  **The corrected E1, and the record carries only this:** over a client already polling the mirrors, the DELETE stream's marginal disclosure is **timing resolution** — sub-second and pushed, against one poll interval and pulled. **Not the fact of delisting**, which is public either way, by 008's argument and because the facility simply stops appearing in the next read.

  **This does not touch #27's verdict.** #27 rests on an anon subscriber receiving events at all, which A1's "Realtime is retained for authenticated ward and admin devices only" denies. E1 and E2 are consequences of that verdict, not its evidence, and collapsing the two is how the first write-up took its severity from its framing rather than from its observations.
- **E2 — the accumulation case. CONFIRMED [observed].** Two successive writes to one ward delivered two full rows to the anon subscriber: `bed_count=7 @ 18:22:55.966943+00` then `bed_count=3 @ 18:23:00.05206+00`, each with `facility_id`, `category` and `updated_at`. A subscriber that simply keeps them has a facility-level series at whatever resolution the publisher writes. The kickoff's read-RPC task caps the pull path — ≤200 rows, ≤30 days, no offset paging, no CSV — and requires that a legitimate caller "must not be able to assemble a time series".

  **The severity of this is NOT RECORDED HERE, and that is deliberate (R-2026-09-17-07).** The observation above stands; what it *adds* does not, until it is measured against what the designed public path already gives away. Anon holds `SELECT` on the three mirrors, `public.snapshot_current` is service_role-only, and no CDN path is built — so **polling the mirrors is the current public read path**, and a poller reconstructs some of this series by itself. The delta is the finding, and the measurement is carried in the next ruling block. E1 was overstated for exactly this reason: it was written up without its baseline.
- **E3 — THE ROOT, and it outlives both answers.** Every negative test asserts what anon can **PULL**: reachability (`rls_anon_reachability`), column containment (`rls_anon_column_containment`), writes rejected (`rls_anon_writes_rejected`), the RPC allowlist (`rls_rpc_execute_allowlist`), the read caps (`read_rpc_caps`). **Nothing asserts what anon can be PUSHED.** Confirmed by reading: the only Realtime assertions in the suite are publication membership in `tests/db/config_drift.test.ts` and the replica-identity lint — both about configuration, neither about delivery. The boundary is specified in one direction and silent in the other, and everything E1 and E2 found lives in that silence. A1's "anon attack surface collapses to one static file" is true of the serving path and not of the publication left beside it.
- **Nothing is remediated here.** Whether the answer is unpublishing the mirrors, moving Realtime to a private channel, tombstoning instead of deleting, or accepting the exposure is a design ruling. _R-2026-09-17-07: the commitment it bears on is **history is private**, not quiet mode — 008 is right that delisting is observable and unhideable, so that promise can be made honestly._

**`scripts/` survey item 1, recorded.** The duty-flag lint catches `NOT flag`, which cannot compile against the enum, and misses `<> 'NO'` and `NOT (flag = 'NO')`, which compile and silently drop a NULL flag expression — now banned by `.claude/rules/code-pipeline.md` and enforced by nothing. **The guard catches the impossible and misses the possible.** NULL reaches a duty-flag expression by one route, verified in migration 006: `app.gate_for_facility()` LEFT JOINs `app.facility_ops`, and 006's own comment says a facility with no ops row "yields three NULLs, which app.gate() treats as ungated". Dropping that facility's row from a filtered query is the never-set-flag-closes-the-city regression in new clothes. Survey item 1, with plants both ways per §2 of the test conventions; not in this change, which touches no tests.

**Scope held:** documents only. No migration, test, script, workflow or app file changed; the publication and policies untouched; #33 unmodified.

### R-2026-09-17-07 — E1 retracted, E2 measured against its baseline, and what the measurement changes

_#34 was amended before merging: the E1 retraction and the E2 hold are in the R-05 block above, where the overstatement was written. This block carries what came after. Everything tagged **observed** was run by Claude Code on 2026-09-17 against the local stack; the seeded state was restored afterwards._

**Why E1 failed, stated once, because it is the reusable part.** It was written up without its baseline. The defence was already in migration 008, in the file the probe was aimed at, and the control it invoked — the k-floor — belongs to a different claim. Nothing about the observation was wrong; everything about its severity was.

**C — E2 measured. One write sequence, four arms, each reading the same ward [observed].**

The baseline is not hypothetical: anon holds `SELECT` on the three mirrors, `public.snapshot_current` has a single `SELECT TO service_role` policy and grants SELECT to `service_role` alone, and no CDN path is built. **Polling `public.ward_public` over PostgREST with the published key is the current public read path.**

| arm | writes 2s apart | writes 200ms apart | cost |
|---|---|---|---|
| Realtime, anon | 4 / 4 states | **6 / 6 states** | 0 requests |
| Realtime, service_role (control) | 4 / 4 | 6 / 6 | — |
| PostgREST poll, anon, 1s (determined watcher) | 4 / 4 | **2 of the 6 written states** | 10–16 requests |
| PostgREST poll, anon, 30s (the designed cadence) | 1 / 4 | **0 of the 6** | 1 request |

**So the delta is conditional, and the condition is the write rate.**
- Against a **determined watcher polling faster than the writes arrive**, push adds **nothing**: at 2s spacing the 1s poller reconstructed every state. A facility-level series is already obtainable by anyone willing to spend requests.
- Against writes **closer together than the poll interval**, push is **complete and polling is lossy**: six states written 200ms apart, six captured by the subscriber, two by the 1s poller, none by a client at the designed cadence. The subscriber sees intermediate values — a ward that goes 0 and back — that no polling client can reconstruct, at any cadence it can afford.
- The cost asymmetry is the second half: the subscriber pays **zero requests** and is pushed everything; the poller pays a request per interval forever and still loses states.

**C2 — what rate-limits the public surface today: nothing, and the design's own answer cannot cover the push path.**
- `supabase/config.toml` configures rate limits under `[auth.rate_limit]` only — emails, SMS, sign-ins, token refreshes, anonymous users. **There is no rate limit on the data API anywhere in this repository**, so the 16-request poller above was never throttled.
- The kickoff requires the public surface to be rate-limited, because named wards' duty numbers are a harassment vector. `packages/fixtures/golden-path-steps.json` records where that control was meant to live: *"the public rate limit is enforced at the edge"*.
- **A Realtime subscription does not traverse the edge.** It is a websocket to Supabase, so an edge rate limit could never have covered the push path, however well it is built. This is E3 again in a second control: the design's answer to a pull problem does not reach the push path, and nobody noticed because the push path was never in scope.
- **Separately a finding:** the rate limit is a live rule of the kickoff with no enforcement artefact anywhere, and its stated home is a deployment that does not exist. Hosted platform limits are not checkable from this repository.

**D and E3 survive unchanged, and D is strengthened.** The boundary is specified for pull and silent on push; and migration 013 publishes the mirrors on a rationale A1 had already reversed — v1's projection task required real tables rather than views because "Realtime cannot publish a view", written when Realtime *was* the public serving path. A1 moved public reads to a CDN snapshot and the publication stayed. **If the marginal exposure were only resolution, the publication would buy nothing for anyone, because nothing subscribes** — which is the argument for removing it rather than an argument for keeping it. Note that the real-tables decision keeps an independent reason of its own (a table's column list can be asserted in CI), so what died is the publication, not the table choice.

**E — sequencing, and it rests on E2 alone.** Migration 018 stays ahead of the `scripts/` survey **because of the measured push/pull gap and C2's missing rate limit, not because of E1**, which is retracted. The gap is real but narrower than R-06 assumed: it binds when writes are frequent relative to a poller's cadence, and a determined watcher already reconstructs a coarse series today. **Whether that still warrants the critical path is Cowork's to re-rule**, and this record does not preserve R-06's ordering by deference: if a coarse series is already obtainable and the delta is resolution plus cost, 018 may reasonably sit behind the survey. What it does not warrant is doing nothing, because the publication has no consumer at all.

**E1 — the founder-side blocker, rewritten.** R-06 blocked the facility agreement's **quiet-mode** promise. That was wrong, and 008 is why: delisting is observable and unhideable, so the quiet-mode commitment can be made honestly, and the k-floor still does its own job of protecting a quiet facility's numbers. **The commitment actually at risk is that history is private** — migration 004's comment grounds it in facilities that fear being graded ceasing to tell the truth. Until 018 lands, or a measurement shows the push path adds nothing a watcher could not already assemble, **do not promise per-ward history is private**. That is a blocker on the agreement's wording, not on the repository.

**G — one more count, and the same one.** Migration 008's quiet-mode block says a facility's categories "are the same eight every facility has". Ten since the 2026-09-09 ward-category audit. 008 is frozen, so it takes a note in `database/migrations/README.md` beside 002, 004, 005 and 006. **That count has now been found wrong in five files across two documents**, which is what makes it a category rather than a typo.

**Found in passing, and fixed in the same change: the corrections section itself prescribed SQL that would not run.** `database/migrations/README.md`'s 002 and 006 entries read `IS NOT DISTINCT FROM NO`, `= NO` and `<> NO` — the quotes around the `'NO'` literal were stripped when that section was written through a shell-escaped script in the v1 sweep, and unquoted `NO` is an identifier, not a value. **A section whose whole purpose is correcting a form that does not compile was itself prescribing a form that does not compile.** Corrected here; the only occurrences in the repository were those four, and the apostrophes and literals in the lint header, the SOP and the kickoff survived intact. The reusable lesson is narrow and practical: **prose written through a shell-escaped one-liner can lose characters silently**, and SQL in a document is content that a reader will copy, so it is read back after writing.

**Also found while reading 013.** Its header restates "Realtime is retained for AUTHENTICATED ward and admin devices only" — the claim #27 disproves — and defends the DELETE payload by pointing at 008. The first half is false as a property of the database; the second is correct. 013 is frozen, so both are noted rather than edited.

### R-2026-09-17-08 — the accumulation boundary, and one sprint rather than two

_#35 merged at `cb260ee`. Everything tagged **observed** was run by Claude Code on 2026-09-17 against the local stack, on a fresh database at the merged head; the seeded state was restored afterwards. Nothing here is a hosted observation._

**B — E2 stands as measured, and the condition travels with the result.** One write sequence, four arms, same ward:

| arm | writes 2s apart | writes 200ms apart | cost |
|---|---|---|---|
| Realtime, anon | 4 / 4 states | 6 / 6 | 0 requests |
| Realtime, service_role (control) | 4 / 4 | 6 / 6 | — |
| PostgREST poll, anon, 1s | 4 / 4 | 2 of 6 | 10–16 requests |
| PostgREST poll, anon, 30s (the designed cadence) | 1 / 4 | 0 of 6 | 1 request |

Push adds **nothing** against a poller faster than the write rate; it is **complete** where writes fall inside the poll interval, and the designed cadence loses almost everything. Neither half of that sentence is safe to quote without the other.

**B1 — the unknown is named, not replaced by a worst case.** How often a real ward writes twice inside a poll interval is **unmeasured, and unmeasurable before facility one**. The design actively suppresses it: the counter-taps task keeps taps as local state and transmits one absolute value, and the double-submission task allows a single in-flight write per ward. **So E2's delta is bounded by a write cadence nobody has observed**, and that is the whole honest statement of it.

> This is the third honest-unknown this chain has reached rather than filling with a worst case: whether a runtime without `performance.now()` exists in the target population, whether hosted Realtime behaves as local does, and now the real write cadence. Each is recorded as unknown with the reason it cannot be settled here. A chain that produces three of these is working; a chain that produces none is guessing.

**C — THE FINDING ABOVE E2 AND E3. The design prevents history from being READ, and does not prevent it from being ACCUMULATED.**

`app.ward_status_event` is private, and the history RPC is capped at ≤200 rows over ≤30 days with no offset paging and no CSV. **But every read of current state is legitimate, and a series is just many of them.** The caps govern the RPCs; they were never a control over repetition.

**Measured, so the size of it is not a guess [observed]:**
- A bare anon `GET /rest/v1/ward_public?select=*` returns **every row in one request** — 11 of 11 seeded, `Content-Range: 0-10/11`, HTTP 200 — carrying `bed_count`, `updated_at`, `monitoring_state`, `gated_by`, `accepting_effective`, `state`, `source`, `offering` and `category`. `facility_public` and `lga_rollup` answer the same way.
- **Offset paging works on the table**: `?offset=8&limit=5` returns HTTP 200 and rows. So `max_rows = 1000` in `supabase/config.toml` — left at the cloud default deliberately, so tests are not optimistic — is a **page size, not a cap**.
- Nothing rate-limits any of it (R-07's C2).

**So the pull path already concedes the series**, and Realtime is the faster instance of the same defect rather than a separate one. **The only control that can cover accumulation is rate limiting**, and it carries three defects at once: it is specified in the kickoff for an unrelated safety reason — named wards' duty numbers as a harassment vector — it is unbuilt, and its stated site cannot reach the push path at all. **E2 and E3 are both instances of C.**

**D — sequencing, re-ruled: ONE SPRINT, both paths.** Not "018 first".
- **The database half** is migration 018, on R-06's root: 013 publishes the mirrors on a rationale A1 had already reversed, and nothing subscribes.
- **The edge half** is the rate limit, which needs a host — the **Cloudflare Pages Functions** ruled in R-05, **the same host the six `/api` items wait on**.
- **Shipping either half alone reproduces exactly what C2 exposed:** a control believed to cover a surface it cannot reach. Unpublishing the mirrors without a rate limit leaves the pull path conceding the series; a rate limit at the edge without 018 leaves a websocket that never traverses the edge.
- **D1.** It still precedes the `scripts/` survey, now on C rather than on E2 alone.
- **D2.** The survey keeps the unguarded `<> 'NO'` as item 1 and **gains item 2: nothing validates SQL fragments quoted in prose.** The duty-flag lint strips string literals and comments before matching — correctly, so it does not fire on its own documentation — which makes **documentation structurally invisible to it**. That is how a corrections section came to prescribe `IS NOT DISTINCT FROM NO`. The survey's charter is *is the stated reason it works the actual reason*, and here it arrives inside the survey's own subject matter.

**E — the founder-side line, narrowed again and now resting on C.** Quiet mode **can** be promised honestly: 008 is right that delisting is observable and unhideable, and R-07 retracted the claim against it. **The history-is-private commitment cannot be promised until the accumulation boundary is closed** — and the reason is not the RPC, which is capped. It is that **unlimited reads of current state assemble the series the RPC refuses.** `M/004`'s `ward_status_event` comment grounds that commitment where it belongs: facilities that fear being graded stop telling the truth, and a dishonest bed count kills someone. A blocker on the agreement's wording, not on the repository.

**On the numbering of F's note.** R-08 proposes it as method note 11. **#35 had already taken 11** ("cite by section name, not line number"), so it lands as **note 12**. Recorded rather than silently renumbered, because a ruling that names a number is easier to follow back if the collision is written down.

### R-2026-09-17-09 — #36 approved, and the anon grants found to be the same story

_Recorded 2026-09-17 by the implementer, and **the limit of this record is stated first**: R-09's full text was delivered to Cowork, not to Claude Code. What follows is what the ruling chain and the A1 kickoff attribute to it, not a transcription. Anything R-09 said beyond this is not recorded here and should be landed from its own text if it exists._

- **A — #36 approved** (the accumulation-boundary record). It merged on 2026-09-17 at `2801289`, and `main` became `262ad61`.
- **D — the 018 anon `SELECT` revoke is the founder's call**, not Claude Code's. It is the single item in the A1 kickoff's *Open decisions needing your call*, and Bundle 2's revoke half is gated on it. The publication half is not gated.
- **The finding R-09 added to R-06's:** R-06 named migration 013's publication as a decision whose rationale A1 had reversed. **R-09 found that v1's anon `SELECT` grants on the three mirrors are the same story** — a decision taken before A1 and never revisited — and that scoping a sprint around the two symptoms separately would have missed the root a second time. That is why bundles 1 and 2 of the A1 sprint are one fix in one order.

### R-2026-09-17-10 — the A1 accumulation-boundary sprint is scoped

The kickoff is `Sprint Kickoffs/sprint-kickoff-a1-accumulation-boundary-2026-09-17.md`, landed by this change and amended by R-11 and R-12 before its first commit.

- **Bundle order is a constraint, not a preference.** Bundle 1 before Bundle 2: the interval between closing the direct read path and opening the served one is an interval with **no public read path at all**. Bundle 3 needs Bundle 1 and is otherwise independent.
- **One PR per bundle**, and the kickoff lands with the first PR that touches the repository.
- **The two things most likely to go wrong**, named so they are checked rather than discovered: the service-role key reaching a client-exposed variable, and `packages/fixtures/public-relations.json`'s `mirrors` key serving two consumers whose meanings diverge under 018.

### R-2026-09-17-11 — #36 merges first, and Bundle 1's definition of done splits at the founder line

- **A — #36 merged before anything else**, and **A1 — the kickoff's stated base corrected** from `feefcf3` to `262ad61`. A base SHA is a citation, and it went stale inside a single ruling. Method note 11's family: the rule about self-editing documents applies to the repository's own head as much as to a line number.
- **B1 — recorded as a defect of the scoping, because it is one.** The kickoff's Bundle 1 definition of done listed **five criteria only the founder can perform** and marked none of them OWED. That is enumeration item **#92's shape** — a definition of done resting on something the party expected to meet it does not have — **committed inside the sprint that closes #92.** It is the fifth premise of Cowork's corrected in this session and **the first that is a process defect rather than a factual one**. Fixed in the kickoff itself rather than noted for whoever hit it.
- **B2 — what Bundle 1's PR carries**, and **this item is recorded in its corrected form rather than as it was first reasoned**: the Function, its wrangler config, `wrangler pages dev` proofs against the local stack, both credential guards extended to the Pages Functions output with plants both ways, and the served document's column lists asserted against `snapshot-shape.json`. **As first written, B2 also placed the rate limit "in code rather than in a dashboard". That was wrong and is corrected below at R-12 before its first recording** — the Rate Limiting binding is a Workers feature, absent from the Pages Functions binding list. Recording it wrong and amending afterwards would put a false mechanism into the record for the sake of a faithful transcript.
- **B3 — the PR carries a founder runbook** for the hosted steps, each OWED, in `docs/runbook-supabase-project-creation.md` step 5's shape: it states the symptom of each step going wrong, not only the happy path.
- **B4 — no Cloudflare deploy token is issued to the implementer.** A new credential surface in the sprint whose subject is credential discipline is not a trade worth making for speed. **Declined deliberately, and recorded so it is not revisited by drift.**
- **C — R-10's ordering item corrected. Bundle 2's gate is the founder's deployment report, not Bundle 1's merge.** Merging code does not open a served path, and the ordering constraint was always about the served path existing. Bundle 1 may merge with its hosted half OWED.

### R-2026-09-17-12 — Bundle 1's rate limit is not code, and why that is not a workaround

**A — the mechanism, checked against the platform actually shipping.** The Cloudflare **Rate Limiting binding is not available to Pages Functions**. The Pages Functions wrangler-configuration page enumerates eleven supported bindings — D1, Durable Objects, environment variables, Hyperdrive, KV, Queues producers, R2, Vectorize, Service bindings, Analytics Engine, Workers AI — and rate limiting is **absent**; the binding's own page does not mention Pages at all, and records besides that its counters are **per Cloudflare location** and its `period` must be 10 or 60. Cited to the platform's own documentation rather than the parent product's. **The evidence is absence from an enumerated list**, which is acceptable here because the failure mode is a deploy-time error rather than a silent no-op — an unsupported binding does not quietly do nothing.

**B — no code change in Bundle 1.** The Function, the service-role credential, the guard extension across both trees, the served-document column assertions and the edge cache-header observation are all unchanged. `/beds.json` is already a discrete path, which is all a zone rule needs to target. **Nothing is added to the wrangler config.**

**C — the limit becomes a sixth OWED step** in the Bundle 1 founder runbook. Per method note 13, a definition-of-done criterion its addressee cannot perform is **OWED with its owner named**, never listed as done-when. **Bundle 1 merges with it OWED.**

**D — the recorded scope, per method note 12, and all four statements travel together.** The rule covers **HTTP requests to `/beds.json` on the `openbed.ng` zone**. It does **not** see the Supabase Realtime websocket at all — that connection never transits this zone, being a different origin entirely. Its counters are **per Cloudflare location, not global**. And it does **not bound accumulation**: paging within the limit still yields a series over time. **The boundary is Bundle 2's revoke; this is a throttle.**

**E — plan availability is unverified.** If the founder's Cloudflare plan does not permit the rule, **it is reported unmet and left unmet.** No Durable Object limiter, no move to Workers, to recover it. The control is not load-bearing.

**F — rejected, with the reasons recorded so they are not re-litigated by drift:**
- **A Durable Object limiter** — adds a stateful binding and likely a paid plan, expanding surface in the sprint whose subject is minimising it, to strengthen a control that is not holding the boundary.
- **Deploying as a Worker instead of Pages** — reverses A2's Pages deployment mid-sprint, which is an architecture decision rather than an implementation one; and the binding is per-location anyway, so it does not deliver the global limit its name implies.

**G — the same check runs before Bundle 3 is scoped**, not when it starts: whether Pages Functions support scheduled handlers or cron triggers, against the Pages documentation. If they do not, the external sensor is a separate Worker, and **that is a scope change to report** rather than to work around — the kickoff's own instruction on that task.

### R-2026-09-18-13 — handoff documents are authored into `docs/`

**Location, and nothing else.** Handoff documents are written into `docs/` at authoring time. There is no out-of-repository staging directory: `~/cowork-handoff/` is retired as a destination, and the files still there are historical copies of `docs/` content already committed, not a source of truth. **Scope is handoff documents only**; sprint kickoffs and decision memos keep their home in `Sprint Kickoffs/`.

**Why:** five handoffs were authored outside the repository and every one had to be carried in afterwards, two of them late enough to be recorded as owed. This removes the staging area instead of paying the debt once per session. It is method note 15 applied to where documents are born rather than to when they are committed.

_This ruling is cited for location only — not for the sequencing or the incidents recorded under R-14._

### R-2026-09-18-14 — #37 carries the record items; Bundle 1 stays clean

_A first version of this block arrived with no ruling id on its first line, and was **refused under method note 1** rather than acted on. It was reissued as R-13 and R-14. One line, because the protocol working is worth recording._

**A — the two handoff documents land in #37, not in Bundle 1.** Bundle 1 ships the first server-side credential in the project's history, so its diff is the serving leg and nothing else, and review of it is undiluted. Both files were placed in the working tree by Cowork and **verified byte-identical before committing** — `git hash-object` gives `02dc4879028092bee328fc0d7fdbbd77dbc62b0b` for `docs/handoff-2026-09-17-017-shipped-and-hosted-at-017.md` and `8fa728b95263fa79051b0f2851a501716a27afb3` for `docs/handoff-2026-09-17-v1-sweep-and-the-accumulation-boundary.md`, matching the values Cowork stated. **This closes R-2026-09-17-12 item 7.**
- **One superseding note, because the second handoff is a dated record and is landed unedited (method note 8).** Its *What's next* item for Bundle 1 describes the rate limit as living "in `wrangler` config". **R-2026-09-17-12 superseded that**: the Rate Limiting binding is not available to Pages Functions, and the limit is a founder-configured zone WAF rule, OWED. The same handoff lists method note 13 as "proposed, not yet recorded"; it was recorded in #37. Both documents also describe themselves as sitting in `cowork-handoff/`; they now sit in `docs/`, per R-13.

**B — the implementer's item-7 report was correct in scope and overstated past it.** "Not in the tree or on the remote" was true. "Does not exist on this machine" was a claim about a scope the implementer could not see: the files were in `~/cowork-handoff/`, outside the repository and its working horizon. Method note 14's family. Declining to invent them was right; the wording reached further than the search did.

**C — two implementer errors on 2026-09-17, recorded as distinct, because the difference decides which needs a mechanical guard.**
1. **A fabricated full SHA.** To merge #36, the implementer composed a 40-character SHA from the short `2801289` rather than reading it. `gh pr merge --match-head-commit` **refused it**. **Contained by design**: a guard that existed, fired and held.
2. **The head branch of an open PR deleted.** The implementer then deleted the local and remote branch while #36 was still open, which **closed the PR**. It was recovered — the branch restored from the local commit, the PR reopened, CI re-run on the same head, and the merge done with the SHA read back from the API — **but only because the commit still existed locally.** In a fresh clone, or after a prune, it would have been unreachable behind a closed PR. **Nothing caught it. Contained by luck.**

The second is not a consequence of the first; it is its own failure, and it is the one with no guard. That is why the git-operation rules below are written into the pipeline rather than left in a note.

**D — method note 16**, below.

**E — three rules added to `.claude/rules/code-pipeline.md`**, under *Git and PR operations*: identifiers are read and never composed; no branch is deleted until the PR reports merged **from the API**; branch deletion is never part of a merge step. **Why in the rules file rather than only in a memory:** until now "read it, never compose it" lived in the implementer's own memory, and method note 15 — recorded in this same PR — says a rule outside version control is not landed. A memory is a transcript with better ergonomics.

**F — #37 merges** with the head SHA read back from the API, and its branch is deleted only after `MERGED` is read back, as a separate action.

**G — then Bundle 1**, off the new `main`, governed by the amended A1 kickoff. Where this ruling's summary of Bundle 1 differs from the kickoff, the kickoff wins; the one place they differ is recorded in Bundle 1's PR.

### R-2026-09-18-15 — the leg register's evidence collector, fixed at the root in its own PR

**The finding, stated the way Cowork verified it on the tree.** `assertedByScript` in `tests/compliance/_legs.ts` stripped `/* … */` with a regex over RAW text, before whole-line `//` comments were removed, so a `/*` inside a `//` comment was live. The trigger is a line comment in `tests/compliance/bundle_guards.test.ts`'s `.next/static` plant — "TWO paths: `*/dist/*` and `*/.next/static/*`" — whose unclosed `/*` reached forward to the next `*/` in the file. **On `main` there was none after it, so it swallowed nothing and the register was CORRECT: the defect was LATENT AND ARMED, not active, and no historical register result needs re-auditing.** The first JSDoc block Bundle 1 added below that line supplied a closer, and three existing assertions vanished from the register — observed as under-credit. Over-credit was never merely theoretical: pairing is sensitive to what the strip removes, in both directions (Cowork measured 219 regex pairings over `main` with the strip and 187 without; directional, not register counts).

**The fix, and one premise corrected in doing it.**
- **Mechanism: TypeScript's parser, not its scanner.** R-15 proposed `ts.createScanner` as cheaper and sufficient. **It is not sufficient** — observed 2026-09-18: on a regex literal from `tests/compliance/leg_coverage.test.ts`, the scanner produced a bogus string token beginning *inside* the regex, the very pairing desync the fix exists to remove, while `ts.createSourceFile` yielded only the genuine literal. A scanner cannot tell a regex from a division slash without parse context. Method note 5 leaves the mechanism to the implementer; the evidence is in the PR.
- **`parseInstrumentLegs` moved onto the same parser, in the same file.** It was line-scoped, with a residual note reading "keep instrument throws on one line until there is a TypeScript parse to hang this on". The collector's fix introduced that parse, so the note's own exit condition was met in this change. Recorded as a scope extension inside `_legs.ts`, flagged in the PR.
- **acorn untouched**, as ruled. `blankComments` still parses `.mjs` guards with it; the TypeScript parser supersedes no acorn use, because `parseInstrumentLegs` never used acorn.
- **The new dependence, stated:** the collector's behaviour now tracks the pinned `typescript` devDependency's parser, pinned by plants rather than by assumption.

**Acceptance, in the ruled order.**
- **(i) No change on `main`.** Run over a clean checkout of `main`, the fixed collector and parser reproduced `main`'s register output exactly, leg for leg — 191 legs, 169 reached, diff empty.
- **(ii) The defect is gone on Bundle 1's content.** Over `main` + the fix + Bundle 1's parked changes, the three swallowed assertions are reached again, and every other difference is Bundle 1's own legs or this PR's three refusals.

**Plants, both directions, as enumerated:** (a) an opener inside a line comment with a later closer swallows nothing; (b) a closer inside a string terminates nothing; (c) an assertion-shaped string inside a block comment, a whole-line comment, a *trailing* comment and a JSDoc block is **not** credited — the trailing case is one the old collector credited even when its strip worked; (d) live code is credited, template spans included. Three neuters turned them red: the old algorithm restored (6 red), comments credited (all four over-credit rows red), and multi-line instrument throws ignored (the register itself red).

**Found and named, not fixed, because R-15 scopes this PR to `_legs.ts` and its plants:**
- the **script-mapping** half of `assertedByScript` — which scripts a test file exercises — is still regex over raw text, including comments, so a backticked script path in a comment maps a file to a guard. An over-credit channel of the same shape;
- `tests/compliance/leg_coverage.test.ts` reads its **own** assertions with a regex over its own source. The same family.
- **In Bundle 1, found by acceptance (ii):** the scanner's FAIL site became a ternary choosing between two messages, and the leg parser sees neither, so the client-bundle FAIL leg silently dropped out of the register. Bundle 1 fixes it with two plain failure sites.

**Also recorded:** R-15's sequence began "merge #37 first". #37 had already merged under R-14 F (`92c79e5`, `MERGED` read back from the API before its branch was deleted), so that step was already satisfied.

### R-2026-09-18-16 — #38 amended; the .dev.vars gap closed on main; R-12's runbook ordering corrected

**Two of Cowork's premises failed, recorded as Cowork's.**
- **The scanner.** R-15 specified `ts.createScanner` over `createSourceFile` on cost grounds. The implementer's counterexample -- a scanner cannot distinguish a regex-literal `/` from a division `/` -- is correct and decisive. **Method note 17's third instance, and its strongest**, and the note's wording now says *parser*.
- **Repository state asserted, not read back.** R-15's sequence named #37 as still to merge; it had merged at `92c79e5`. The same family as method note 16, one level over from identifiers: a statement about the repository's state is read from the repository before it is ruled on. One line, no new note.

**A — #38, amended before merge.**
- **A1 — `.dev.vars` is ignored on `main`, in #38, as a deliberate exception to R-15's scope line.** An untracked file holding a service key is one `git add -A` from a public repository; naming files at staging protects one commit and not the next session; and v1's Bundle 7 safety notes name reaching for the service-role key as one of the three predicted assistant failure modes. A one-line ignore does not confuse attribution of the register's result, which is what the scope rule protects. **Checked before adding, as ruled: no `.dev.vars` has ever been committed on any of the repository's 59 refs, in any stash, or anywhere in the reflog** -- with a control, since the same search found `.dev.vars.example` and `wrangler.toml` in the parked Bundle 1 stash's untracked-files commit.
- **A2 — `parseInstrumentLegs` on the parser: accepted.** Its own note said to move once a TypeScript parse existed; leaving a known-defective sibling on the old mechanism in the same file would be ticketing what can be fixed now.
- **A3 — the decision record stays in #38.** R-15's scope line should have read "plus the decision record"; the contradiction was in the drafting. Note 15 governs.
- **A4 — merge** with the head SHA read back from the API; the branch is deleted only after `MERGED` is read back.

**B — the two regex survivors get a named home, not a backlog.** `assertedByScript` still maps test files to scripts with a regex over raw text, and `tests/compliance/leg_coverage.test.ts` reads its own assertions with a regex -- the second the more serious, because the instrument that audits leg coverage audits itself with the defective mechanism. **They are fixed together in ONE follow-up PR, opened immediately after Bundle 1 merges.** Not folded into the `scripts/` survey, which is larger and would swallow them.

**C — for Bundle 1, which executes these; recorded here so they are landed before they are built.**
- **C1** -- the scanner's FAIL-site ternary, which hid the client-bundle leg from the leg parser, becomes two plain `console.error` calls. Acceptance (ii) of #38 is what caught it: an instrument fix finding a defect in the change that triggered it is the loop working.
- **C2 -- R-2026-09-17-12 is amended: the two OWED runbook steps share a prerequisite.** The Cache API works only on a custom domain, and the WAF rate-limiting rule is zone-level, so both need `openbed.ng` live on the Pages project. The custom-domain cutover is recorded as the step that GATES both, OWED and ordered first.
- **C3 -- Bundle 1's definition of done splits on that line** (method note 13). Demonstrable before the domain, by the implementer: the Function serves the current snapshot; the served document's columns match the frozen fixture and carry no forbidden column; the planted service-role key reddens the extended guard in both trees; the extension still reddens on the existing `dist` plant. OWED to the founder after the cutover: the edge cache observation and the rate limit. **The cache criterion is never marked met from a `*.pages.dev` preview.**
- **C4** -- the runbook records the hosted findings as the implementer's, cited to where they were read: `sb_secret_` keys on `apikey` only, the legacy local key needing `Bearer`, side by side; and that a fresh `db:reset` leaves the snapshot table empty.
- **C5** -- the credential guard's surface, per note 12: it scans BUILT BUNDLES, what reaches a browser. The `.dev.vars` exposure is about what reaches a PUBLIC REPOSITORY, a different surface. The guard's header says which it covers and which it does not, and whether a tracked-files check belongs in it or elsewhere. **The ignore line in A1 is not the whole answer.**

### R-2026-09-18-17 — a LOCATION check for credential files; the scope of three controls; method note 18

**Accepted: the tracked-files check, in its own PR (branch `lint-tracked-secrets`), after #39.** Not folded into #39, because #39 was green with 778 predicted against 778 passed, and a guard change re-opens that prediction. The residual risk over one cycle was low: the ignore line was on `main` and history had been verified clean.

**The rationale, recorded as ruled: the invariant is LOCATION, not CONTENT.** "This file must never be tracked" is not "this file must not contain a secret". Content scanning is the wrong instrument for a location property, and it can only be wrong in both directions: it misses a secret it does not recognise, and it fires on a demo key that legitimately belongs in a developer's working tree.
- **The reverted first attempt is part of this ruling.** Adding `.dev.vars*` to `scripts/lint_no_secrets.sh`'s content patterns failed the real repository on a developer's local `.dev.vars`, which holds the well-known local demo key. A guard that fails a legitimate local setup gets switched off, and a switched-off guard is worse than none, because its header still claims the coverage. It was reverted, not papered over with exceptions.

**What landed.**
- **A1/A2: a DENY list, not a filename.** `.env`, `.env.*`, `.dev.vars` and `.dev.vars.*`, each with a one-line reason and matched by basename at any depth, against `git ls-files`. No file contents are read. An explicit ALLOW covers `.env.example` and `.dev.vars.example`, exactly the `.gitignore` negations. A test asserts every DENY entry is a `.gitignore` line and every ALLOW a `!` line. The reverse direction is named NOT ASSERTED: which ignore lines are credential files is a judgement.
- **A scope change, reported.** Seeding the list from "whatever `.env` forms the repo already ignores" turned up a form the ignore missed: the pinned wrangler 4.134.0 loads `.dev.vars.<environment>` before `.dev.vars`, and `git check-ignore` did not match `.dev.vars.production`. `.dev.vars.*` is now both ignored and denied, so the ignore and the check agree.
- **A3: plants both ways.**
  - Red: a force-added `.dev.vars`, a `.dev.vars` tracked after its ignore line was deleted, and every DENY entry at the root and nested.
  - Green: the SAME BYTES untracked, holding the demo key. This is the plant that encodes the reverted attempt as a leg rather than a commit message. A tracked `.env.example` and `.dev.vars.example` also stay green.
  - Anti-vacuity: a non-repository, a corrupt index and an empty index each exit 2 as a check that did not run.
- **A4: the header states three controls and three failure modes.**
  - The ignore line: `git add -A` only.
  - This check: after the push, so it reports and does not prevent.
  - Push protection: blocks at the remote.

  For a public repository the CI check is a backstop, not a boundary (v1:368).

**A5's premise FAILED, recorded as Cowork's.** A5 proposed enabling GitHub push protection as a new founder step. **It has been enabled since 2026-09-10.** The repository API read it `enabled` on 2026-09-19, and `docs/runbook-supabase-project-creation.md` section 0 already recorded it done. Corrected by R-2026-09-19-19 B. The first instance of method note 19 attributed to a ruling's account-state claim.

**B1: the #39 wording tightened before merge.** The kickoff, the Pages runbook and the PR now say the local Miniflare run is evidence that the cache code path EXECUTES, and NOT evidence for the cache criterion, which stays OWED and UNMET until observed on the custom domain. #39 merged at `374475d`, and its remote branch was deleted after `MERGED` was read back.

### R-2026-09-19-19 — foreign working-tree edits left untouched; A5 corrected; method note 19

**A: foreign edits are left untouched.** On 2026-09-19 the implementer found in its working tree an uncommitted addendum to this record and an untracked supabase-proxy directory, neither made by the implementer and neither covered by a ruling. R-17's work ran in a separate git worktree; neither was staged, and both were hashed before and after. **Rationale, as ruled:** this record is the single home for every ruling, and committing unreviewed text into it is worse than leaving it uncommitted. Stashing moves another party's work without their knowledge and restores it onto a base that has since moved. The addendum's text is reported to Cowork verbatim and UNVERIFIED, in the implementer's report and not in this public repository or its PR. **None of it is recorded here**, for the same reason: publishing another party's unreviewed text is not the implementer's call.

**B: A5 corrected. Push protection is ENABLED, and ENABLED IS NOT COVERAGE.**
- The header of `scripts/lint_no_secrets.sh` cites the API probe and the runbook's 2026-09-10 entry, and says in the same breath that it has never been observed blocking anything.
- **The OWED founder step becomes a documentation check, not a push test.** From GitHub's supported-patterns list, record separately whether push protection covers the `sb_secret_` / `sb_publishable_` short-string keys and the legacy service-role JWT. They may differ.
- **Cowork withdrew the fabricated-key push test** it gave the founder on 2026-09-19. A block would prove coverage, but a non-block proves nothing, because partner patterns commonly check entropy or a checksum, and the string then sits in a public history.

**Identifiers, read and not composed (note 16).** R-19 cites "R-2026-09-19-18 step 3" and "R-18 A5". The ruling the implementer received is **R-2026-09-18-17**, and its A5 is the push-protection item. The custom-domain status ("process started, only the NS on the registrar pending") arrived as a status line under R-17, not as a numbered ruling step. **No ruling numbered -18 has reached the repository.** This is recorded, not inferred around. The cutover's state remains UNVERIFIED here.

### R-2026-09-19-18 — VOID: issued outside the record

**This number was issued by Cowork in a founder-facing turn on 2026-09-19 that never reached this record or the implementer.** Cowork picked it without reading the record's last (method notes 16 and 19, both in one line), and R-2026-09-19-19 then cited it ("R-2026-09-19-18 step 3", "R-18 A5"). **It is not reused.** Giving it content reconstructed by the recorder would compose a ruling's text. Where its known content went:
- **The custom-domain cutover as the gate:** R-2026-09-18-16 C2, and the Pages runbook's cutover step, which gates the edge-headers, cache-hit and rate-limit steps.
- **Push protection recorded enabled, coverage unverified:** R-2026-09-18-17, R-2026-09-19-19 B, `docs/runbook-supabase-project-creation.md` section 0, and the header of `scripts/lint_no_secrets.sh`.
- **The Free-plan rate-limit parameters: MISSING.** They are recorded nowhere, and the implementer never received them. The rate-limit step still reads "a threshold that a client polling every 30 seconds can never reach", with no values. **Owed by Cowork as a provisional ruling.** The recorder does not write values it was never given.

### R-2026-09-19-20 — the recorder assigns ruling numbers; the record's state read back; the proxy's review questions

_Issued as R-PROVISIONAL-2026-09-19-A. Number assigned on landing from the record's last as read on merged `main` (`17a5780`): R-2026-09-19-19._

**The structural fix: Cowork no longer assigns ruling numbers.** It issues `R-PROVISIONAL-<date>-<letter>`, and the implementer assigns the real number from the record's actual last on landing, records it, and reports it back. **The recorder assigns, because the recorder is the party that knows.** Method note 1 is amended to match. The defect is Cowork's: see the -18 entry above.

**A — the record, read before anything else.**
- **A1.** The highest ruling recorded was R-2026-09-19-19, on #40's head, and `main` stopped at R-2026-09-18-16. **No ruling numbered -18 existed under either date.** The only hit for it was R-19's own sentence saying it never arrived. A control search found R-2026-09-18-17 five times in the record (method note 18). Since 2026-09-17 the sequence runs continuously across dates.
- **A2.** Of the 2026-09-19 material, the cutover-as-gate and the push-protection material are recorded, as listed in the -18 entry. The Free-plan rate-limit parameters are not, and are owed.

**B — reading live state is not a violation.**
- **B1.** Method note 19 requires reading state. R-19's prohibition was on ACTING on the uncommitted addendum, or verifying its claims inside #40, not on knowing things. The implementer's `dig` before R-19 arrived is recorded without fault. Reading is always permitted; acting is what gets scoped.
- **B2 — a finding, unresolved.** The uncommitted addendum in the implementer's working tree states that `api.openbed.ng` is deployed, while a `dig` on 2026-09-19 returned **no record** for that name. Both are reported as read; neither is resolved. **The founder's to settle.**
- **B3 — INFERENCE FROM ONE LOOKUP, not a verified state.** The same lookup showed `openbed.ng`'s name servers at Cloudflare and the apex resolving to `192.0.2.1`, which is TEST-NET-1, a documentation placeholder. That suggests the zone exists at Cloudflare but the apex is not pointed at the Pages project. The cutover being outstanding is therefore **plausible, not confirmed.**

**C — the proxy needs its own review, and is held.** An untracked supabase-proxy directory, a Cloudflare Worker, sits in the implementer's working tree alongside the addendum. Nobody has confirmed whose change it is. **Not touched, and kept out of every PR until the founder confirms.** Recorded here are the questions its review must answer, unanswered:
- **C1 — a full passthrough.** It forwards EVERY path to the Supabase origin (auth, storage and functions as well as PostgREST) behind a hostname on this project's zone, passing whatever credential the caller supplies. It grants no new authorization, but both the surface and the attribution change.
- **C2 — a precondition on 018's revoke half.** 018 revokes `SELECT` on the three mirrors from `anon` and `authenticated`, and a second route to those tables must now be traced. **The revoke half is not written until that trace is done and reported**, or the revoke may break the ward console. Recorded in the A1 kickoff's Bundle 2 blast radius.
  - **Premise checked, from the code, as a read and not a trace.** The ward console sends the publishable key as `apikey`, but a signed-in request runs as `authenticated`, which 018 also revokes, so the concern stands. As built, it addresses `rpc/my_facility_wards` and `/auth/v1`, and no mirror directly. Whether that RPC reaches a mirror, under which role, is part of the trace.
  - "The ward console now routes through this proxy" is the addendum's claim. The base URL is a build-time variable, and nothing tracked sets it. **UNVERIFIED.**
- **C3 — R-2026-09-17-12's scope statement is now incomplete, in the project's favour and by accident.** Nothing rate-limited the data API because its traffic reached Supabase's origin directly, outside this zone. Traffic through the proxy is on the zone, where a WAF rule CAN see it. Still a throttle, not a boundary. **The Pages runbook's rate-limit scope ("covers `/beds.json`"; cannot see the push path) is to be restated once the proxy's status is settled.** It is deliberately not edited before then.
- **C4 — a production surface deployed outside the record, with no guard, no runbook entry and no test.** Whatever is decided about keeping it, that gap stands recorded here.

**D — accepted as reported.**
- **D1:** the `.dev.vars.*` scope change.
- **D2:** "reported to Cowork", not "in the PR". A public PR publishing a third party's unreviewed note is a disclosure decision, not a formatting one.
- **D3:** the local branch kept checked out under the foreign edits.
- **D4:** #40 as built. **Merged at `17a5780`**, with the head SHA read from the API, and the branch deleted after `MERGED` was read back.

**E — sequence.** Next is the two-regex-readers PR (R-2026-09-18-16 B). **Bundle 2 waits on the founder's deployment report AND on C2's trace.**

### R-2026-09-19-21 — whatever turn it arose in; the Free-plan rate-limit parameters; the console survives 018; the console's origin has no record

_Issued as R-PROVISIONAL-2026-09-19-B. Number assigned on landing from the record's last as read on merged `main` (`af58b5c`): R-2026-09-19-20._

**A clarification to R-2026-09-19-20, not a new note: anything Cowork intends for the record goes in a provisional block, WHATEVER TURN IT AROSE IN.** Void -18's three pieces are the evidence. Two reached the record by other routes. The one that did not, the Free-plan parameters, is precisely the one that existed only in an answer to the founder. **A reply to the founder is not a channel to the recorder.** Method note 1 carries this as a line.

**A — #41 merged** at `af58b5c`, with the head SHA read from the API and the branch deleted after `MERGED` was read back. **Recording -18 as VOID rather than reconstructing it is affirmed.** Inferring its content would have meant the implementer writing Cowork's ruling and Cowork then inheriting it as its own.

**B — the Free-plan rate-limit parameters, landed in the Pages runbook's rate-limit step.** Each line is labelled for what kind of claim it is. **The implementer checked each DOCUMENTED line against Cloudflare's pages before recording it** (method note 19). Read on 2026-09-19: rate-limiting rules (overview and availability table), request rate calculation, and rule parameters.
- **B1 — DOCUMENTED, as issued and confirmed:**
  - the counting characteristic is IP only;
  - period 10 s;
  - mitigation timeout 10 s;
  - counters are per data centre, not global (data centres sharing one location share counters);
  - excess requests can reach the origin before enforcement, because counters update with a delay.
- **DOCUMENTED, found in checking and not in the issued text:** Free allows ONE rate-limiting rule, and its rule expression may use Path and Verified Bot. "URI Path equals `/beds.json`" is expressible. **A second rule, for example for the proxy's hostname (R-20 C3), is not available on Free.**
- **B1's action line, NOT CONFIRMED.** Cowork issued "action: Block; no Log-only or Managed Challenge action is available" as DOCUMENTED.
  - No page read lists actions by plan.
  - The parameters page states "Customers on Free, Pro, and Business plans cannot select a duration when using a challenge action", which implies challenge actions ARE available on Free.
  - It is recorded as Cowork's claim, NOT CONFIRMED. The founder reads the actions the dashboard actually offers when creating the rule.
- **B2 — CHOSEN by Cowork: 60 requests per 10 seconds per IP on `/beds.json`.** The reasoning holds as checked: `snapshot-shape.json`'s `pollCadenceSeconds` is 30 and the document is cached at `s-maxage=30`, so one legitimate client makes at most one request per 10-second window. **Arithmetic recorded beside it, so it can be argued with:** 60 per window lets about 180 simultaneous 30-second pollers share one address before it blocks.
- **B3 — the reason the headroom is not generosity, and a NEW reason, not a restatement of R-2026-09-17-12.** Nigerian mobile networks use carrier-grade NAT heavily, and a hospital or a carrier can put hundreds of legitimate users behind one address. An IP-keyed threshold tight enough to stop a determined scraper would block a whole network of real users in Lagos. **The threshold must be generous enough to survive CGNAT, which means it CANNOT be tight enough to be a boundary.** The rate limit is a throttle on one route; the boundary is Bundle 2's revoke.
- **B4 — operational, in the runbook step.** After deploying, watch Security Events. **If legitimate traffic trips the rule, RAISE THE THRESHOLD, DO NOT REMOVE THE RULE.** Removing it is the tempting move at 2am. The instruction stands on its own. Its stated premise, that Free offers no log-only observation period, rests on the NOT CONFIRMED action line.

**C — R-2026-09-19-20 C2's premise, corrected.**
- **C1 and C2 accepted as reported.** A signed-in ward-console request runs as `authenticated`, which 018 also revokes. As built, the console calls `rpc/my_facility_wards` and `/auth/v1`, and no mirror directly.
- **C3 — Cowork's overstatement, corrected.** Cowork wrote that the ward console "now routes through this proxy". That was inferred from the uncommitted addendum's text and stated as fact. It is UNVERIFIED: the base URL is a build-time setting, and nothing in the repository sets it. **Method note 19's fourth instance, all four Cowork's.**
- **C4 — the trace's decisive question, answered: SECURITY DEFINER.** Read from source and from the live catalogue, 2026-09-19.
  - `public.my_facility_wards()` is created once, in `database/migrations/011_read_rpcs_capped.sql`: `SECURITY DEFINER`, `SET search_path = ''`, with `EXECUTE` granted to `authenticated` only.
  - On the local stack, `pg_proc.prosecdef` is `t`, owner `postgres`. Control: `app.assert_member`, also `t`.
  - **What it reads:** `app.ward_account`, `app.ward_status` and `app.ward_status_event`. Through `app.assert_member` it reads `app.ward_account`. Through `app.gate_for_facility` it reads `app.facility_ops`: that function is SECURITY INVOKER, but called from inside a definer function it runs with the definer's privileges.
  - **Against 018's revoke list (`public.facility_public`, `public.ward_public`, `public.lga_rollup`): none.** A pattern search over the three function definitions found no `public.` relation except `public.my_facility_wards` itself, which also shows the search could hit.
  - **The ward console as built survives the revoke:** only `EXECUTE` on the function matters, and 018 does not touch it.
- **The rest of the traced client code:**
  - the public dashboard performs no fetch;
  - the `/beds.json` Function reads `public.snapshot_current` as service_role, which 018 does not revoke.
- **The proxy** forwards whatever its caller sends, so it adds no endpoint the console uses. It is a second route for OTHER callers, whose direct mirror reads are exactly what 018 is meant to cut.
- **Re-run the trace if the console gains a read.**

**D — a finding in its own right: nothing in the repository sets the console's API origin.**
- `VITE_SUPABASE_URL` is READ in `apps/ward-console/src/main.ts` and set nowhere tracked. `apps/ward-console` has no deployment configuration and no runbook.
- So the repository cannot tell anyone what the production console talks to. That is a configuration surface with no record, no guard and no test, and **it is the mechanism by which a proxy could be placed in front of production without a single file changing.** It survives whatever is decided about the proxy.
- **Not fixed here.** Where the fix belongs: a ward-console deployment change, meaning a tracked, non-secret record of the production API origin, a runbook step for the console's deployment, and a build-output assertion that the built console's API host equals the recorded one.
- **One constraint on it, found in checking:** Vite's conventional home for public build values, `.env.production`, is DENIED by the `.env.*` entry of `scripts/lint_no_secrets.sh` (R-2026-09-18-17). The fix must choose a mechanism compatible with that. **Adding an ALLOW in passing is not the fix; which mechanism it uses is for a ruling.**

**E — unchanged.**
- The proxy stays untouched and in no PR until the founder confirms whose change it is.
- Next is the two-regex-readers PR.
- **Bundle 2 waits on the founder's deployment report.** The C4 trace is now reported, and the revoke half remains gated on the founder's open decision.

### R-2026-09-19-22 — note 20; external-platform claims verified before they enter the record; one rule on `/beds.json`; A2's consequence corrected

_Issued as R-PROVISIONAL-2026-09-19-C. Number assigned on landing from the record's last as read on merged `main` (`fb5f662`): R-2026-09-19-21._

**A — #42 merged, and C4 closed.** #42 merged at `fb5f662`, with the head SHA read from the API and the branch deleted after `MERGED` was read back. `public.my_facility_wards()` is SECURITY DEFINER and reads none of the three mirrors (R-2026-09-19-21 C4).
- **A2's stated consequence, "018's revoke breaks nothing that exists", was checked and FAILS as worded.**
  - **The database side holds.** Every function that references a mirror is SECURITY DEFINER: `public.publish_ward_status`, `app.regenerate_snapshot`, `app.project_facility` and `app.refresh_lga_rollup`. No view depends on a mirror; the control is that the three are read as tables. No application code reads a mirror.
  - **Three EXISTING TESTS use `public.ward_public` as the proof that an `authenticated` token works over HTTP**, and 018 revokes `SELECT` from `authenticated`, so they would go red: `tests/e2e/golden-path.test.ts` line 108, a golden-path step under the required `golden-path` check, and `tests/db/auth_refresh_live.test.ts` lines 148 and 239. Line 161 of the latter expects a 401 on a tampered token, which fails before privileges are consulted, so it is unaffected.
- **The accurate consequence:** 018 breaks no application code and no database object. Inside 018's change, it must re-point three test probes to a relation an `authenticated` ward session still reads. Not a blocker; Bundle 2's gate is unchanged.
- **A false fact in the A1 kickoff's Bundle 2 blast radius, corrected there.** It said the golden path "reads `public.snapshot_current` through the db harness as service_role, not over HTTP, so it is unaffected by the anon revoke — confirmed at `feefcf3`". At `feefcf3` the file already carried line 108's HTTP read of `ward_public` as `authenticated`, present since `25238e6` (2026-09-10). The claim was true of the `snapshot_current` reads and blind to that one.
- **Bundle 2 now waits only on the founder's deployment report and the founder's decision on the revoke.**

**B — Cowork's platform claim failed again, and the fix is structural.**
- **B1 — "action is Block; no Log-only or Managed Challenge on Free" is WITHDRAWN by Cowork.** Its source was a use-case tutorial's recommended setting ("On Free plans, select Block"), not an availability matrix: Cowork labelled a recommendation as a constraint. The runbook keeps it NOT CONFIRMED, with the instruction to the founder to record which actions the dashboard offers.
- **B2 — method note 20**, below.
- **B3 — a standing rule, recorded as an amendment to method note 2: Cowork's claims about external platform behaviour are PROVISIONAL BY DEFAULT.** Each carries its evidence kind and source page, and Claude Code verifies it before it enters the record. The same shape as R-2026-09-19-20's numbering fix: the party that can check decides. It is recorded because "be more careful" had failed repeatedly.
  - **The asymmetry, recorded honestly and with one refinement.** Across 2026-09-17 to -19, Cowork's property, ordering and scoping rulings held. The failures are mechanism claims, counts, citations and system state.
  - **The refinement:** one ordering did fail. R-2026-09-17-12 treated the cache and rate-limit steps as independent of the custom domain, and R-2026-09-18-16 C2 amended it. It failed because it rested on a mechanism premise: the Cache API and the WAF rule both need the domain. So orderings and scopings held **except where they rested on a mechanism or state premise**.
  - **Cowork's count, "six this session", is Cowork's.** The instances this record names for 2026-09-18 and -19:
    - the R-15 scanner prescription;
    - R-15's sequencing of an already-merged #37;
    - R-17 A5's push protection;
    - the composed -18;
    - the relayed cutover state;
    - R-20 C2's routing;
    - B1's action line;
    - and, in this ruling, A2's consequence and C1's premise below.

**C — one rule per zone, and it goes on `/beds.json`.**
- **C1 — accepted: Free permits one rate-limiting rule per zone** (DOCUMENTED-availability, Cloudflare's availability table, read 2026-09-19).
  - **The premise as issued is slightly off.** Cowork wrote that this "VOIDS R-20 C3's separate rule for the proxy hostname". R-20 C3 prescribed no separate rule: it said a WAF rule "CAN see" traffic through the proxy.
  - What one rule per zone voids is that availability. On Free, seeing the proxy's traffic would cost `/beds.json` its rule.
- **C2 — a FIFTH scope line, landed in the Pages runbook's rate-limit step: a 10-second window cannot address accumulation at all.** A client polling at 30 seconds, the cadence `snapshot-shape.json`'s `pollCadenceSeconds` itself advertises, makes at most one request per window, so it never trips the rule at any threshold of one or more. The rule stops burst scraping of a document that is already public and already cached at the edge; against accumulation it does nothing. **The clearest statement available of why the boundary is Bundle 2's revoke.**
- **C3 — the rule goes on `/beds.json`: with one rule, the cheaper false positive wins it.** On `/beds.json` a false positive briefly denies a member of the public a bed-availability page. On the proxy hostname it would deny a ward nurse a status update during an emergency, the failure this product exists to prevent. Both are likely under CGNAT.
  - **Premise checked: that harm is PROSPECTIVE.** The console's publish screen does not exist yet (its own header says so), and its routing through the proxy is UNVERIFIED. The choice stands on the cheaper-failure argument, which will bind once both are true.
- **C4 — for the founder, not now.** If the proxy is kept, whether a paid plan permits more rules and more actions is a cost decision for the founder.
  - **Rules per zone are already DOCUMENTED-availability** (the same table): Free 1, Pro 2, Business 5, Enterprise 100.
  - **Actions per plan remain NOT CONFIRMED**, to be checked in the proxy review.

**D — Finding D: no `.env.production` carve-out.**
- **D1 — REJECTED: adding `.env.production` to the ALLOW list** of `scripts/lint_no_secrets.sh`. It reopens what R-2026-09-18-17 closed, and trades a security invariant for a framework convention.
- **D2 — the root is not a missing file.** The production API address is not a recorded, asserted fact, and a `.env` file would not make it one: it would be tracked text that nothing checks.
- **D3 — the fix:**
  - the public build configuration goes in an ordinary tracked config file whose name is not `.env*`, keyed by environment and read at build time;
  - **a test asserts that the built bundle contains that value.** That is the part that closes Finding D: the repository then states what production talks to and proves it.
- **D4:** it carries only `VITE_`-prefixed public values. That the bundle credential scanner covers the console's built output is to be confirmed explicitly, with a plant, in that change, not assumed.
- **D5 — its own change, not in the regex-readers PR. Its home is named:** a ward-console configuration PR after the proxy review, because the production value it records is what that review decides.

**E — the proxy review is unblocked.**
- **E1:** the founder has confirmed that the supabase-proxy directory and the working-tree addendum are the founder's, set up for the `api.openbed.ng` custom-domain proxy and ready for review. R-2026-09-19-20 C1–C4 are live.
- **E2:** it gets its own pass, not inside the regex-readers PR. The implementer's proposed shape, for Cowork to scope:
  - a read-only review document in `docs/`, with no code change until ruled;
  - every claim tagged with its evidence kind;
  - probes use only the publishable key and GET.
- **The review's questions, in order:**
  0. **E3 first:** is `api.openbed.ng` live? That is the recorded contradiction.
  1. **The surface.** Which paths and methods reach which Supabase services, websocket upgrade for Realtime, what `redirect: "manual"` exposes in `Location`, and CORS.
  2. **Attribution.** Which client address Supabase sees through a Worker. If it sees Cloudflare's egress addresses, auth rate limits keyed by IP (magic-link sends) collapse onto shared addresses: a lockout-or-bypass question.
  3. **C2 re-checked** against the console's real build origin, which ties to Finding D.
  4. **The rate-limit scope restated**, with the one-rule choice.
  5. **C4's cost question.**
  6. **Keep or remove.** If kept, it enters the repository with its configuration, a guard and a runbook entry.
- **E3:** the addendum says `api.openbed.ng` is deployed; `dig` returned no record. Still unresolved, still the founder's, and the first thing the review resolves.

**F — next:**
- F1: #42 is merged.
- F2: the two-regex-readers PR.
- F3: the proxy review, scoped.
- F4: Bundle 2, on the founder's deployment report and revoke decision. The console trace is done, and three test probes move inside 018.

### R-2026-09-19-23 — the verification rule widened to every Cowork claim; the proxy review scoped

_Issued as R-PROVISIONAL-2026-09-19-D. Number assigned on landing from the record's last as read on merged `main` (`e3651ec`): R-2026-09-19-22._

**A — #43 merged** at `e3651ec`, with the head SHA read from the API and the branch deleted after `MERGED` was read back.

**B — A2 corrected, and Cowork's seventh.**
- **B1 — the corrected statement, accepted.** The app and database side survives 018's revoke. The test suite needs three re-points, `tests/e2e/golden-path.test.ts` line 108 and `tests/db/auth_refresh_live.test.ts` lines 148 and 239, **carried inside 018's own change**, to `rpc/my_facility_wards` or an equivalent. Not a blocker.
- **B2 — Cowork's FALSE VERIFICATION, recorded as such.** The A1 kickoff's Bundle 2 section stated that the golden path was unaffected, "confirmed at `feefcf3`". Line 108 was present at that commit and had been since 2026-09-10. **This is materially worse than a wrong claim:** it is a wrong claim presented as a completed check, with a SHA attached, which suppresses the very re-checking that would have caught it.
  - **Attribution checked, as the widened rule below requires.** The line was already in the untracked kickoff when the implementer first read that file (2026-09-17). It appears in none of the implementer's writes before then, across the five session transcripts on the implementer's machine; the same search does find the implementer's own commit text, which is the control.
  - **The implementer's share:** it committed the line UNVERIFIED in `3993567`, which landed the kickoff for the first time. The rule widened below would now require that check before landing.
- **B3 — no new method note. Method note 2's amendment is WIDENED** from Cowork's claims about external platforms to **ALL of Cowork's factual claims, whatever their subject**. It gains one clause: *a claim of the form "confirmed at <ref>" names the check actually performed and what it returned, or it is not written; absent that, it is marked NOT CONFIRMED.*
  - **Reasoning, recorded:** this is the neighbourhood of the twentieth method note, and a twenty-first note nobody reads is not a control. Widening a rule already in force is.
  - **Swept on landing:** the only other "confirmed at <sha>" in the repository, in `Sprint Kickoffs/sprint-kickoff-017-schedule-2026-09-16.md`, names each test it checked and what each filter returned. It already complies.

**C — R-22's corrections, accepted.**
- **C1:** R-2026-09-19-20 C3 never proposed a separate proxy rule; it observed that a rule COULD see proxy traffic. Cowork misread its own prior ruling. On Free that observation still costs `/beds.json` the zone's only rule, so the conclusion stands and the premise is corrected.
- **C2:** the proxy-side harm, blocking a ward nurse's status update, is PROSPECTIVE; Cowork asserted a present harm. The `/beds.json` placement stands on the remaining ground: a cached, already-public document is the cheaper thing to spend a single rule on, and the proxy's harm profile is not yet known.
- **C3:** rules per zone by plan (Free 1, Pro 2, Business 5, Enterprise 100) are accepted as read from Cloudflare's availability table, which closes R-22 C4's question. Actions per plan remain NOT CONFIRMED.

**D — the proxy review, SCOPED.** The implementer's proposed shape is accepted:
- a read-only review document in `docs/`;
- no code change until Cowork rules;
- every claim carrying its evidence kind;
- probes limited to the publishable key and GET.

It runs in this order:
- **D0 — the decision criterion, stated at the top of the document BEFORE the review runs**, so keep-or-remove is not settled on impressions afterwards.
  - **The proxy must name what it buys that the direct Supabase origin does not.** A more pleasant hostname is cosmetic, and does not justify an unguarded full passthrough to auth, storage and functions.
  - **Candidates that WOULD earn it, to be confirmed or refuted, not assumed:** decoupling client builds from the Supabase project ref, so the project can be rotated or migrated without rebuilding clients; and bringing clinical traffic onto a zone where WAF rules and observability can see it.
  - **If neither holds, "remove" is the default answer**, and the review says so.
- **D1 — is `api.openbed.ng` live?** First, because it settles the recorded contradiction between the addendum and the `dig`.
- **D2 — the NDPA posture is DECIDED BY THE FOUNDER, and is not an open question.** Recorded:
  - mechanically, the Worker is a stateless pass-through router;
  - the compliance posture shifts regardless;
  - Cloudflare is formally listed in the NDPA inventory as a Data Sub-Processor for API traffic, under its standard DPA. **Added now**, in the processor-obligations table above, **with its scope description to be completed from the review's findings rather than written ahead of them.**

  The review therefore does not ask whether the posture changed. It supplies the facts the entry needs:
  - what data traverses the Worker, in which fields, and whether any of it is patient-identifying or patient-adjacent;
  - **whether the Worker, or Cloudflare's own logging and analytics around it, retains request metadata.** "Stateless" is a property of the Worker's code, not necessarily of the platform hosting it, so this is a separate check and not an inference from the source;
  - which Cloudflare regions process the traffic.

  For the founder, not the implementer: the DPA and the s.41 transfer basis are distinct instruments, and sub-processor listing addresses the first.
- **D3 — the surface:** paths, methods, the services reached, websocket upgrades, what `redirect: "manual"` exposes in `Location`, and CORS.
- **D4 — attribution: which client address Supabase sees.** The sharpest item in the review.
  - **Constraint:** reason about Supabase's per-IP auth limits from its documentation and from response headers. **DO NOT EXERCISE THEM.** The natural test sends real email and trips real limits on the live project, which makes the probe itself the harm it investigates.
- **D5 — availability, platform-sre's question, not a security one.** The proxy inserts a second dependency into the path a ward console uses, for a product whose entire purpose is that this path works during an emergency. Record:
  - what breaks if the Worker, its route or its DNS is misconfigured or unavailable;
  - how anyone would notice;
  - whether the client fails over to the direct origin or simply fails;
  - what the runbook says to do.

  **A reliability regression on the clinical path is a worse outcome than anything in D4.**
- **D6 — in order:** the console route re-checked against the real build address (tied to Finding D); the rate-limit scope restated; the plan-cost question.
- **D7 — keep or remove, answered against D0.**
  - **If KEPT:** it enters the repository with its configuration, a guard, a runbook entry, a record entry, and the availability answer from D5.
  - **If REMOVED:** record what the removal costs, and what replaces the stable-hostname property if anything depended on it.
- **D8 — Finding D's fix waits on this review**, because the production address its configuration records depends on D7.

**E — next.**
- E1: #43 is merged.
- E2: the two-regex-readers PR (R-2026-09-18-16 B).
- E3: the proxy review, per D.
- E4: Bundle 2 waits on the founder's deployment report and the founder's revoke decision. B1's three test re-points are carried inside 018's change.

### R-2026-09-19-24 — the founder REVOKES: R-2026-09-17-09 D is answered

_Issued as R-PROVISIONAL-2026-09-19-F. Number assigned on landing from the record's last as read on merged `main` (`55dbcec`): R-2026-09-19-23._

**A — carried items.** #44 merged at `55dbcec`, with the head SHA read from the API and the branch deleted after `MERGED` was read back. **A2 and A3 were already recorded in R-2026-09-19-23** — the attribution split and the implementer's share, the adopted extension that the implementer checks text it LANDS for Cowork and not only text it writes, and the "confirmed at <ref>" sweep with its one compliant instance — so they are not restated here. **No ruling lettered E ever reached the implementer, and none is recorded**; searched across merged `main` and #44's head, which also finds the lettered rulings that did arrive.

**B1 — THE FOUNDER'S DECISION, taken 2026-09-19: REVOKE.** `SELECT` on `public.facility_public`, `public.ward_public` and `public.lga_rollup` is revoked from `anon` AND `authenticated` in migration 018. This answers **R-2026-09-17-09 D**, the single item in the A1 kickoff's *Open decisions needing your call*. **It was taken AFTER the C4 trace returned, not before** (R-2026-09-19-21 C4).

**B2 — the reasoning, recorded so a later reader sees why and not only what.**
- **016's own principle, applied consistently.** The READER header of `database/migrations/016_snapshot.sql` refuses an anon-readable `snapshot_current` because it would be "a second serving path around the CDN, with no `s-maxage`, disagreeing with the edge on freshness". **Direct anon reads of the mirrors are exactly that.** (The kickoff cites this as `M/016:90-93`; the quoted text sits at lines 91–93 of that file today. Cited here by section name, per method note 11.)
- **The standing objection, and why it is answered NOW.** v1:258 kept the grants deliberately as defence in depth — "a future contributor may add a direct read" — so the grants were a tripwire as much as a permission, and revoking removes the surface the column-containment control watched. **Bundle 1 relocated that control onto the served document, where it is now shipped and green.** The objection was real when written; its mitigation exists rather than being promised.
- **The technical cost was MEASURED at zero, not assumed.** `public.my_facility_wards()` is SECURITY DEFINER and reads none of the three mirrors; every function touching a mirror is SECURITY DEFINER; no view depends on one; no client code reads one (R-2026-09-19-21 C4, R-2026-09-19-22 A).
- **Reversible:** 018 ships with its `.down.sql`.
- **Without it the rate limit is the whole pull defence**, and a 10-second window cannot stop a 30-second poller at any threshold (R-2026-09-19-22 C2).

**B3 — what this unblocks, precisely.** The revoke half of migration 018 may now be WRITTEN: the DECISION gate is lifted, and the A1 kickoff's "do not write the revoke half until it is answered" is discharged.
- **Bundle 2's START remains gated on the founder's deployment report** (R-2026-09-17-11 C). Merging code does not open a served path, and that ordering is unchanged by this decision.
- **The implementer's reading, stated because the two sentences pull apart:** 018 is NOT written in this change. What lands now is the decision, the specification and the runbook step; the sequence keeps Bundle 2 after the regex-readers PR, the proxy review and the deployment report. If Cowork means 018 to be written before the report, that is an amendment to R-2026-09-17-11 C and is asked for explicitly.

**B4 — what 018 carries**, in one migration with its `.down.sql`, since 001–017 are frozen and this is new rather than an edit:
- removal of the three mirrors from the `supabase_realtime` publication;
- the revoke of `SELECT` from `anon` AND `authenticated` on all three;
- **the three test re-points inside this change, not after it**: `tests/e2e/golden-path.test.ts` line 108, and `tests/db/auth_refresh_live.test.ts` lines 148 and 239;
- the `packages/fixtures/public-relations.json` `mirrors` split, where the client `.from()` allowlist and the expected publication membership stop sharing one key;
- `tests/db/config_drift.test.ts`'s publication assertion RESTATED, with a comment recording why membership changed and when — never deleted around;
- `tests/db/rls_anon_column_containment.test.ts`'s stated subject corrected to the catalogue behind the generator, with its docstring saying so;
- `tests/db/rls_anon_reachability.test.ts` and `tests/db/rls_anon_writes_rejected.test.ts` made STRONGER rather than vacuous: anon now reaches nothing, so the denial is asserted explicitly;
- `[SWEEP]`-style markers on v1:142 and v1:258, cited by section name.

**B5 — THE BOUNDARY CLOSES ON THE HOSTED APPLY, NOT ON MERGE.** Hosted holds 001–017. Applying 018 there is a FOUNDER-SIDE OWED step (method note 13) and joins the ordered list in `docs/runbook-supabase-project-creation.md`. **Until that apply is recorded, the history-is-private commitment is not available, whatever the PR's state.** The runbook's apply step says so itself, not only this record.

**C — next, unchanged:** the two-regex-readers PR; the proxy review as scoped in R-2026-09-19-23 D; Finding D's fix once the review decides the production address; Bundle 2 once the founder's deployment report lands.

### R-2026-09-20-25 and R-2026-09-20-26 — the handback session's rulings, numbered on landing

_Issued as R-PROVISIONAL-2026-09-20-H and -J, in that order. Numbers assigned from the record's last as read on merged `main` (`ac14d61`): R-2026-09-19-24._

**THE TEXTS ARRIVED LATE, and how that was handled is recorded rather than smoothed over.** Both were issued to the handback session of 2026-09-20, which correctly declined to number them — the record's last lived in the `record-r24` worktree and not in that tree, so a number taken from there would have been a composed identifier (method note 16). When these numbers were first assigned, **the texts had not reached the main session**, so this entry recorded only what the repository itself attested, with that limit stated first, as R-2026-09-17-09 did. **R-2026-09-20-29 supplied both texts**, and they are recorded below in Cowork's own terms. The attested record that follows them was written without them and is unchanged.

**R-2026-09-20-25 (was provisional H) — UNPUSHED WORK AND THE STALE RUNBOOK.**
- The five commits of production-deployed code go to a **new branch whose name describes its contents**. **Push only: no pull request, no merge.**
- **Do not reuse `bundle1-beds-json`**: it already resolves to merged, closed PR #39 in `gh pr list --head` and in GitHub search. An identifier resolving to two things is the defect method note 16 exists to prevent.
- The handback notes record the branch name, its head SHA **read and not composed**, and **explicitly that these commits are a backup of UNREVIEWED work that has passed no gate**. A branch sitting on the remote otherwise reads as reviewed.
- **Leaving it unpushed was rejected:** production sourced only from one clone is not a posture to hand across a session boundary.
- **The stale runbook is fixed in that session, not handed over.** A procedure document instructing a reader to do something that silently does nothing produces confident wrong action — the green-light-examining-nothing shape at the human layer. The specific consequence: this runbook feeds the founder's deployment report, which gates migration 018, so a procedure that appears to succeed while deploying nothing can produce a report saying "deployed" when nothing was.
- **Every corrected fact carries its evidence kind and source:** READ from which documentation page, or OBSERVED from which command and what it returned. Cite by section name, not line number.
- **Reported to the main session, and larger than either fix:** if the Pages project is direct-upload, merging a pull request deploys nothing, and production code exists outside the repository. **What is running is not what was reviewed.** The deployment mechanism must be named, and the deployment report must say which artifact was deployed, from which commit, by which command.

**R-2026-09-20-26 (was provisional J) — FIX BASE AND EVIDENCE FRAMING.**
- Cut a **fresh branch from `origin/main`** for the runbook fix and the handoff note. Push, no pull request.
- **The reason is not conflict avoidance:** a stale-base edit to a file that R-2026-09-19-21 and -22 have since amended **can REVERT those rulings while merging cleanly**. A conflict announces itself; a silent revert does not.
- **Rebasing the backup branch is rejected** — it rewrites the five SHAs, so the recorded head stops identifying the deployed code, which was the entire purpose of recording it. Do not rebase or force-push it; the notes say it is frozen and must not be tidied by a later session.
- **Notes-only is rejected:** it leaves a known-false deploy procedure live on `main` while the report gating 018 is produced against it.
- **The `--branch` claim is INFERRED, not observed:** Cloudflare's "Wrangler infers the branch" wording is conditioned on git integration, this project is direct-upload, and no deploy without `--branch` was observed. All three are said.
- **Structural: make the INSTRUCTION unconditional** — always pass `--branch` explicitly. That is correct whether or not the inference holds, so the procedure's correctness does not rest on a contested premise. The uncertainty goes in a note beside the step, never inside it.
- **"Observe it first" is rejected, and not on cost:** the test deploys to the live project to learn where it lands, and that project's deploy history is itself evidence in the open question of what is running versus what was reviewed. **The probe would muddy the record it would inform.**
- **An addition to the standing rule** (recorded in method note 2): a claim marked NOT CONFIRMED or INFERRED **names what would close it**, or the marking is a disclaimer rather than an open item. Here: one deploy with `--branch` omitted against a **non-production** Pages project, or Cloudflare documenting the non-git case.

**What the repository attested, recorded before the texts arrived and unchanged by them:**

**The finding they carry, REPORTED by the founder on 2026-09-20 and not verifiable from inside this repository** — nothing here can read a Cloudflare project's settings. The Pages project `openbed-public-dashboard` is **direct-upload, not git-connected**: the dashboard offers no *Retry deployment* button, and the project was created with `wrangler pages project create`. Three things follow if it holds:
- **merging a pull request deploys nothing** — the running site changes only when a working tree is uploaded;
- **deployment and review are fully decoupled**: nothing forces the deployed artifact to be a commit that passed a gate, or a commit on `main` at all;
- **it has already happened.** Production was serving five commits that existed in no remote branch until the handback session pushed them as a backup.

**Why this reaches the record rather than a runbook alone.** `docs/runbook-cloudflare-pages-beds-json.md` said to deploy by pushing to `main`, **which for a direct-upload project deploys nothing while appearing to succeed**. That runbook feeds the founder's deployment report, and that report is the gate on migration 018 (R-2026-09-17-11 C). A procedure that deploys nothing while appearing to succeed can produce a report saying "deployed" when nothing was — and the record already carries one unresolved instance of that shape, the `api.openbed.ng` addendum against a `dig` that returned no record.

**What landed on branch `runbook-pages-direct-upload`** (`ec90c5f`, then `0dfc77c`; both on the remote):
- the handoff note docs/handoff-2026-09-20-pages-direct-upload.md (cited without backticks: it is not in the tree at this SHA, per Clause 4), and the runbook's deploy step corrected, each fact carrying its evidence kind in the style R-2026-09-19-21 established: the direct-upload claim as REPORTED; the explicit `wrangler pages deploy --branch <production branch>` as OBSERVED; that Production variables bind when a deployment is created, so a saved variable needs a fresh deploy, as OBSERVED; what happens when `--branch` is omitted as NOT CONFIRMED, with what would close it and an instruction written to be correct either way;
- the body stop condition corrected: it demanded `"wards":[[`, **which cannot match a system with no facilities onboarded**, so it would have read FAILED on a correct deployment;
- the reporting section now requires the deployment be named — which artifact, from which commit, by which command.

**CONSEQUENCE NOTICED ON LANDING, and it is live: `main`'s copy of the runbook still carries the FALSE deploy step.** The correction sits on `runbook-pages-direct-upload`, which has no pull request — K B recorded that its review belongs to the main session. So the founder reading the runbook from `main` today is told to deploy by pushing, which deploys nothing while appearing to succeed, **and that runbook feeds the report gating 018**. Reviewing and merging that branch is the next documentation item, ahead of the regex-readers change.

**The backup branch is frozen.** `proxy-and-ward-console-publish`, head `ec0f5783aabcea8ed8aa6c9201669f18c73357cb`, read back from `git rev-parse` and from the API independently. **Its five commits have passed no gate**: no attestation, no self-check, no pull request. It is not rebased, force-pushed or tidied, because rewriting those SHAs would make `ec0f578` stop identifying the deployed code, and that identification is the only reason it was recorded. Its review belongs to the main session.

**The deployment, as observed 2026-09-20:** deployment `40c61fb4`, uploaded from `ec0f578` by `cd apps/public-dashboard && npx wrangler pages deploy --branch main`. 200, `application/json` (so the Function routed rather than falling through to the SPA), the Function's own `Cache-Control`, and an empty-city body. **No cache criterion may be recorded from any of it**: `cf-cache-status` is meaningless on `*.pages.dev`, and that step stays OWED until the custom-domain cutover.

### R-2026-09-20-27 — the empty city, and the handback session's method wins

_Issued as R-PROVISIONAL-2026-09-20-K._

**A — the two rulings above are numbered and landed.**

**A2 — two method wins from the handback session, recorded because both are reusable.**
- **It caught that `${PIPESTATUS[0]}` returns empty under zsh**, so its first "all green" reading was an artifact of a broken capture rather than a result. It re-ran under bash with direct status capture **and a deliberate false control**. That is method note 18 applied to the instrument rather than to the subject, self-caught.
- **It committed the handoff note BEFORE the runbook that cites it**, so the citation never dangled at an intermediate commit — in the very file whose defect was a false claim.

**B — the stranded push: the premise FAILED on checking, and there is nothing to do.** K recorded `runbook-pages-direct-upload` as holding two unpushed commits behind a machine-wide DNS failure. **Checked on landing: the remote holds that branch at `0dfc77c`, equal to local `HEAD`.** The push landed; B3's founder action is already discharged. The judgement that it was low-urgency stands on its own reasoning: what was at risk was documentation, and the unreviewed production code had already been pushed.

**C — THE EMPTY CITY. The public path is live and no facility is onboarded.**
- **The hazard, and it is product-safety rather than launch-polish.** *"No facilities have joined yet"* and *"no beds are available"* are **different facts**. Any public surface that renders zero without distinguishing them presents absence of data as data — the green-light-examining-nothing shape at the product layer, in the one place where the reader may be routing an ambulance.
- **Established by reading, 2026-09-20 (K C3):**
  - **`openbed.ng` serves nothing.** The apex and `/beds.json` on it both time out. The cutover has not happened.
  - **`/beds.json` IS consumed.** The deployed dashboard fetches it and renders real rows; the Bundle 4 scoping no longer describes what runs.
  - **The live `*.pages.dev` alias serves** `{"v":…,"wards":[],"facilities":[],…}`, 200, `application/json`, `v` climbing once a minute — the generator faithfully publishing an empty city.
  - **What a visitor sees today:** the permanent emergency strip, the indicative-only banner, and **an empty list**. `renderReal` builds a `<ul>`, appends nothing, and replaces the root with it. **Nothing on the page distinguishes "no facility has joined" from "no beds are available".**
  - **The payload already carries the distinction** — `facilities: []` against a populated list — and **the renderer collapses it.** So the rule below binds renderers hardest, and the payload's obligation is that the distinction stays derivable.
- **THE RULE, recorded now and holding either way (K C4).** **Before any public surface renders bed data, it distinguishes "no facilities onboarded" from "no beds available", in the payload and in anything that renders it. A consumer must not be able to read the empty state as a clinical signal.** It is a blocking criterion for the review of the deployed dashboard code.
- **C5 — discoverability, checked rather than assumed.** `noindex, nofollow` IS in the deployed HTML. **There is no `robots.txt`:** the path returns the SPA's HTML with 200, so a crawler asking for one is told nothing. The meta tag cannot cover `/beds.json`, which is a JSON document and carries no meta tag. The `*.pages.dev` alias is publicly resolvable. **The founder's `noindex` item is therefore urgent and gates public discoverability until facility one is live**, rather than being housekeeping.

**D — homes for the other open items.**
- **D1 — the stray `openbedng` Worker** (created 2026-09-18, still carrying the Hello World body) is the same class as the proxy: infrastructure on the account, outside the record. **It joins the proxy review's scope as an inventory item** — what exists on this Cloudflare account, why, and keep-or-remove against the same criterion. Worth confirming it holds no route on the `openbed.ng` zone before the cutover, where it could intercept.
- **D2 — the hosted exposed-schemas hand-check** bears on what an anonymous holder of the published key can address, so it belongs **alongside Bundle 2** rather than floating. Named in the kickoff's Bundle 2 section, performed by the founder: the repository cannot assert a hosted dashboard setting (`.claude/rules/test-conventions.md` section 4). It also disposes of Supabase's advisor report of RLS disabled on 16 `app.*` tables, which is very likely a false positive because the advisory assumes `app` is PostgREST-exposed.
- **D3 — the pull request for the backup branch is the main session's**, and it is the change that turns unreviewed production code into reviewed code. **Its scoping rests on the deployment-versus-review finding above, which still needs a ruling.**

**E — the deployment report must name WHICH artifact, from WHICH commit, by WHICH command.** Under direct upload it cannot be inferred from a merge. Already written into the runbook's reporting section by the handback session.

### R-2026-09-20-28 — why #45 sat open; the EVIDENCE gate on 018; a ledger for lost blocks

_Issued as R-PROVISIONAL-2026-09-20-L, carrying the substance of R-PROVISIONAL-2026-09-20-G, which never reached the record._

**A — #45 was approved in G, and G never arrived.** The consequence was an approved pull request left open. It merged at `ac14d61`, with the head SHA read from the API and the branch deleted after `MERGED` was read back. **The numbers for H, J, K and L were read from the merged record rather than written into the ruling**, because naming them in advance would have composed an identifier and repeated the error that produced R-2026-09-19-20.

**B — 018 IS NOT WRITTEN YET, AND THE REASON IS THE SECOND GATE.**
- **Two gates, and the earlier wording ("the revoke half may now be written") was ambiguous between them.**
  - **DECISION gate: LIFTED.** The founder answered on 2026-09-19 (R-2026-09-19-24).
  - **EVIDENCE gate: NOT lifted, and it is the load-bearing one.**
- **Why.** **018 removes the direct read path ON THE PREMISE THAT THE SERVED PATH WORKS**, and that premise is NOT CONFIRMED: the cache criterion is OWED, the custom-domain cutover has not happened, and the one DNS reading taken showed the apex on a TEST-NET-1 placeholder. **A merged migration justified by an unverified premise sits one push from being applied by someone who assumes it is ready.** R-2026-09-17-11 C is unchanged; this states the second reason it always rested on.
- **The implementer's conservative reading under R-2026-09-19-24 B3 is confirmed correct.**
- **B3 — the `public-relations.json` split, offered and ACCEPTED.** Its `mirrors` key serves the client `.from()` allowlist and the expected publication membership, and **those two meanings coincide by accident today**; 018 is what makes them diverge. Splitting them now — two keys, identical content, each consumer on its own — is a no-op refactor that removes the coincidence before the change that exposes it, the same pattern as #38. It has no dependency on the deployment report, the proxy review or Finding D, and it lands as its own small change after the regex-readers pull request.

**C — the lost-block pattern gets a LEDGER, not a note.** Three provisional blocks have now failed to reach the record: void -18, lettered E, lettered G. Each loss was discovered several blocks later, and twice the content survived only because a later block re-carried it. The ledger below makes a gap a lookup rather than an investigation.

**D — the empty city is urgent, not prospective**, and what the alias serves a visitor today is recorded under R-2026-09-20-27 C so the founder can decide on `noindex` and interim wording with the facts in front of them.

### R-2026-09-20-29 — the H and J texts supplied; the cutover HELD; the renderer rule binds at the surface; crawler controls

_Issued as R-PROVISIONAL-2026-09-20-M. Number assigned from the record's last as read on merged `main` (`f3d5bbd`): R-2026-09-20-28._

**A — #46 merged** at `f3d5bbd`, with the head SHA read from the API and the branch deleted after `MERGED` was read back. **The H and J texts are supplied and are filled in above**, under -25 and -26; Cowork confirms that recording what the repository attested, with the limit stated first, was the right handling while they were missing.

**C — Cowork's premise failed again, and no new note is minted.** "Nothing is stranded" is accepted: `runbook-pages-direct-upload` was on the remote at `0dfc77c`, equal to local `HEAD`, and the push landed before the outage was reported. **Cowork relayed the handback session's report as state without reading it — method note 19.** Consequently **R-2026-09-20-27 B3's founder action is STRUCK as already done.**

**D — ordering, and Cowork rescinds one of its own founder instructions.**
- **D1 — the runbook branch outranks the regex-readers change, accepted.** A known-false deploy procedure live on `main`, feeding the report that gates 018, is not queued behind a refactor.
- **D2 — the backup branch's pull request comes next**, and it is where the deployment-versus-review finding gets its own ruling.
- **D3 — THE CUSTOM-DOMAIN CUTOVER IS HELD.** It was listed as the founder's first step on 2026-09-19. **Pointing `openbed.ng` at the Pages project would publish the empty-city page to a real domain**, and the apex timing out is the only thing currently limiting exposure. The reversal and its reason are recorded in the Pages runbook's cutover step itself, not only here. It waits for the renderer fix and the crawler controls to land and be deployed.

**E — the renderer: the rule binds where the human reads.**
- **E1, established by reading:** the payload carries the distinction between *no facility has joined* and *no beds are available*; `renderReal` discards it, appending nothing to a list and swapping it in. A visitor sees the emergency strip, the indicative-only banner, and an empty list.
- **E2 — the rule, restated so it binds correctly: the distinction is preserved at EVERY layer, and the assertion is made AT THE RENDERED SURFACE, not at the payload.** A test that asserts the payload's honesty passes while the page lies. It is the same move as Bundle 1 relocating the containment control onto the served document: assert at the surface the reader actually receives.
- **E3 — a BLOCKING criterion** for reviewing that code. The empty state must say, in words a dispatcher can act on, that no facility has yet joined — **never a bare zero**.
- **E4 — the scoping drift, recorded and corrected in the kickoff.** Bundle 4 was scoped on the premise that nothing consumes `/beds.json` yet. **The deployed dashboard fetches it.** That is a second instance of deployed-diverging-from-reviewed, the same family as -25's finding.

**F — `robots.txt` and `X-Robots-Tag`: a new control, and it touches the accumulation boundary.**
- **F1 — no directive is not a permissive directive.** `/robots.txt` returns the SPA's HTML with a 200: a crawler receives a page it cannot parse as rules and proceeds. The `noindex` meta tag covers the HTML document only and **cannot cover a JSON response**.
- **F2 — the consequence reaches the accumulation boundary, and has not been named before.** `/beds.json` is fetchable and archivable by anything that walks the site. **An archive service polling it politely over months builds exactly the time series this sprint exists to prevent.** The rate limit never sees a slow crawler, the 018 revoke does not touch `/beds.json`, and it costs the archiver nothing.
- **F3 — two controls, both cheap and neither present:** serve a real `robots.txt`, and set `X-Robots-Tag: noindex, nofollow` as an **HTTP header** on the `/beds.json` response, which is the only mechanism that reaches a non-HTML document.
- **F4 — the honest scope note:** this governs **well-behaved crawlers**. It is not a boundary against a determined collector, and it is not a substitute for anything in Bundle 2.
- **F5:** it lands with the renderer fix, before the cutover.

**G — the queue, with one ORDERING CORRECTION reported rather than worked around.** M placed the renderer fix (G3) before the backup branch's pull request (G4). **`main`'s dashboard is still the stub — it contains no `/beds.json` fetch and no `renderReal`, so there is no renderer on `main` to fix.** The defect exists only on the deployed backup branch, and under direct upload neither the fix nor the merge reaches a visitor until someone deploys. **The two are therefore one unit of work**: a single change that merges the frozen backup branch into a branch off `main` — preserving `ec0f578` as an ancestor, never rebasing it — and then adds the empty-state wording, `robots.txt`, `X-Robots-Tag` and their tests. It is the change that turns unreviewed production code into reviewed, corrected code, and it carries -25's finding for its ruling.
- **A scope item inside it, reported now:** asserting at the rendered surface needs a DOM, and this repository has none — no `jsdom`, no `happy-dom`, no Playwright, and no UI test. The proposal is one registry-checked `jsdom` devDependency and a per-file environment docblock inside the **existing** `e2e` project, so **no CI job and no new required check** are added; the required-check list is branch protection the founder owns.
- **Then:** the founder deploys from the merged `main` and reports which artifact, from which commit, by which command — and only then does D3's hold lift. Then the regex-readers change, the `public-relations.json` split, the proxy review including the stray `openbedng` Worker, Finding D, and Bundle 2 with 018.

### R-2026-09-20-30 — deployment becomes READABLE; the runner stops omitting; the review becomes an inventory

_Issued as R-PROVISIONAL-2026-09-20-P (the letter O was skipped, confusable with zero). Number assigned from the record's last as read on merged `main` (`9932955`): R-2026-09-20-29._

**A — THE D1 RULING: deployment becomes readable, not attested.**
- **The root, named.** Merging proves review, uploading proves deployment, **and nothing binds the two**. The implementer's proposed fourth clause — that the deployed commit is an ancestor of `main` — bound them **by attestation**. Every other identifier in this build has moved from attested to read (method note 16); deployment was the last one running on someone's word.
- **A2 — the report's four clauses are the minimum:** which artifact, from which commit, by which command, and that the commit is on `main`.
- **A3 — the commit is stamped into the artifact and exposed.** `scripts/stamp_build.mjs` writes `/version.json` at build time, so "what is deployed" is FETCHED and the report's fourth clause is a reading.
  - **`/version.json` beside the document rather than a field inside it**, and the reason is recorded: `/beds.json`'s envelope is frozen, asserted by set-equality against `packages/fixtures/snapshot-shape.json`, and generated in the database by `app.regenerate_snapshot()`. A build detail is not worth changing a frozen shape, its fixture and a generator.
  - **A commit SHA is published deliberately:** this repository is public, read from the repository API on 2026-09-20, so the SHA discloses nothing `git log` does not. In a private repository this would be a short build id mapped to the commit here. Stated rather than assumed, as A3 required.
  - **It refuses rather than guessing.** Where git cannot answer, it exits non-zero instead of writing `"unknown"`: the report READS this file, so a stamp that cannot identify the build is worse than none. `dirty: true` is recorded rather than refused — a build on a dirty tree is legitimate, but its commit does not identify it, and the reader must see that.
- **A4 — `scripts/deploy_pages.sh` refuses the accident:** a dirty tree, a `HEAD` that is not an ancestor of `origin/main`, an unfetchable origin (a stale ref makes the check quietly weaker), an empty `--branch`, and a directory that is not a work tree. **Its header states that it is LOCAL AND DEFEATABLE** — running wrangler by hand bypasses it — so it removes the accident case, which is the case that has already happened, and not the deliberate one. It cannot see what Cloudflare then serves.
- **A5 — GIT INTEGRATION IS THE CANDIDATE ROOT FIX, and is NOT taken now.** What it would cost, recorded so it becomes a decision when someone has the facts: a build configuration that Pages itself runs; a change in who holds the deploy credential, against R-2026-09-17-11 B4's deliberate refusal to issue one to the implementer; and a change to the deployment mechanism this runbook now records. **A3 and A4 are sufficient meanwhile and are not wasted if it is later adopted** — a stamped artifact and a refusal of unmerged code are wanted either way.
- **A6:** these landed in their own change, after #49 and before any deploy.

**B — #49 merged** at `9932955`, SHA read from the API, branch deleted after `MERGED` was read back. **The review is accepted as a review record rather than a file list:** the publish screen's three self-check properties confirmed present, no credential surface added, guard reclassifications accurate and citing the commits that made the old ones stale, and `supabase-proxy/` landed marked with the founder's addendum kept verbatim and marked UNVERIFIED. 804/804 against a prediction of 804, four neuters red with restores verified.

**C — `run_e2e.sh` executed two NAMED files, and now discovers its corpus.**
- **The finding:** a new file in `tests/e2e/` would never have run, while the required `golden-path` check reported success. **A test that does not run reports exactly what a test that ran and passed reports**, and the thing deciding which ran was the harness itself. Same class as the leg-register defect #38 fixed.
- **The fix:** phase 1 runs every `tests/e2e/*.test.ts` except the ratchet, and the two load-bearing files are asserted to EXIST, so deleting one fails loudly by name rather than running smaller and greener. The separate empty-corpus branch was removed rather than registered: with the golden path asserted present, a corpus of zero is impossible, and an unreachable branch is its own defect.
- **Plants both ways** in `tests/compliance/deploy_guards.test.ts`: a new file IS executed; a missing golden path is refused by name; the ratchet is never fed as its own phase-1 input.
- **C4 — the placement decision is recorded with the trap that forced it.** The rendered-surface test went into `compliance` precisely BECAUSE of this: `compliance` runs wholesale under a required check. That answers R-2026-09-19-23's question about required checks — **no branch-protection change is needed** — and `.claude/rules/test-conventions.md` section 1 now carries both the decision and the trap, so the next person does not rediscover it.

**D — the two raised findings, given homes.**
- **D1 — raw server text echoed to a ward user** on an unrecognised status. **Not a blocker for #49**, because blocking that merge would not change what is in production. **It IS a blocker for facility-one onboarding**, which is when a real ward user could first see it. **Fix shape:** map known statuses to human text; on an unrecognised one show a generic message plus a reference code, and log the raw text server-side. A clinical user mid-emergency should never be reading a database error, and server text can carry internals.
- **D2 — `openbed-ward-console`**, a second Pages project declared in `apps/ward-console/wrangler.toml`, deployment status unknown. That is the **third** piece of unaccounted infrastructure, with the stray `openbedng` Worker and `supabase-proxy/`.
- **D3 — THE REVIEW IS RENAMED: the proxy review becomes the INFRASTRUCTURE INVENTORY AND REVIEW.** It covers everything deployed on the Cloudflare account — each item named, its purpose stated, **its deployment status established by reading**, and keep-or-remove against the criterion stated first (R-2026-09-19-23 D0). The proxy is one item in it. **Earlier blocks in this record that say "proxy review" mean this**, and they are not rewritten: a record is not edited to match a later name (method note 11's discipline). The new name is used from here on.

**E — the merge-order mishap was Cowork's, and the rule is recorded.**
- Cowork specified "#47 first, then #48" without accounting for branch protection requiring up-to-date branches with two pull requests in flight. #48 merged, #47 was left BEHIND, and the record briefly cited a runbook hold that was not yet on `main`.
- **The recovery is accepted:** merge `main` into #47 rather than rebase, re-attest on the merged head (796/796, gate PASS), then merge.
- **The rule, now in `.claude/rules/code-pipeline.md` beside the other merge rules:** when two pull requests must land in a stated order, the second is not opened until the first has merged — or, if both are open, the later one is merged up and **re-attested** before the first lands.

### R-2026-09-20-31 — a dirty stamp means a control was circumvented; the mapper shaped the code; the report reads back from the surface

_Issued as R-PROVISIONAL-2026-09-20-Q. Number assigned from the record's last as read on merged `main` (`2b527f6`): R-2026-09-20-30._

**A — #50 merged** at `2b527f6`, with the head SHA read from the API and the branch deleted after `MERGED` was read back. Three of its decisions are accepted with their reasoning recorded, because the reasoning is what a later reader needs:
- **`/version.json` beside the served document, not a field inside it.** The envelope is frozen, asserted by set-equality and generated in the database, so a build detail would have cost a shape change, a fixture and a generator. Recorded as restraint rather than as a limitation.
- **Refusing beats writing `"unknown"`.** The report READS that file, so a placeholder would be **a composed value in the one place clause 4 is supposed to be a quotation** — method note 16's defect reintroduced at the end of the chain that removed it.
- **`run_e2e.sh`'s empty-corpus branch was removed rather than registered as a leg.** With the golden path asserted present the corpus cannot be empty, and **a leg that can never fire is a test that cannot fail** — the same family as everything else corrected this week.

**A4 — WHAT `dirty: true` MEANS IN A DEPLOYED STAMP, sharpened here and in the runbook.** The wrapper refuses a dirty tree. So a deployed `/version.json` carrying `"dirty": true` is not evidence that a tree was untidy: **it is evidence that the wrapper was BYPASSED**, and that the artifact matches no commit. It reports a circumvented control, which is more than "deploy it again".

**B — THE MAPPER SHAPED THE CODE IT MEASURES, and that widens the regex-readers change.**
- **The finding, observed rather than predicted:** `assertedByScript`'s literal matcher required R-2026-09-20-30's new tests to be **written a particular way to be seen** — script paths spelled as single literals, leg identities asserted with `toContain` rather than a regex.
- **Why that is more than a nuisance. An instrument that constrains the FORM of what it measures is not reporting coverage; it is enforcing a spelling convention and presenting the result as coverage.** The file's own header warns of exactly this ("an instrument that only recognises one spelling dictates how tests are written"), and it is now observed against that file.
- **A third instance of method note 17's root** — a tool reasoning about a language it does not parse — alongside the comment-stripper and the SQL-in-prose item. Here the tool did not merely mis-measure: it bent the code to its own limits.
- **R-2026-09-18-16 B's change therefore gains a SECOND TASK.** After the mapper is fixed on TypeScript's parser: **re-check every test written under the old one**, say for each whether its shape was load-bearing or merely a concession to the matcher, and normalise the concessions. **Fixing an instrument while leaving behind code shaped by its defect closes half the problem.**

**C — THE DEPLOYMENT REPORT READS BACK FROM THE SURFACE.**
- **Why:** this deploy is what closes the empty-city hazard, and the only current evidence that the empty state reads correctly is **a CI assertion over what the CODE produces**. That proves the code and not the artifact — the same discipline as observing cache headers from the edge rather than from the origin, and method note 18's shape.
- **The three read-backs, fetched from the deployed site:** the rendered empty state in the words a visitor sees; `X-Robots-Tag` on the `/beds.json` response; and `/robots.txt` returning ROBOTS CONTENT rather than the SPA fallback — a live possibility, since that path returns the SPA's HTML with a 200 today, so it is fetched rather than inferred from the file being in `dist`.
- **A SCOPE CHANGE, reported rather than worked around (C4's own instruction).** Q asked for the header on **both** responses. Read from `packages/snapshot/src/serve.ts`: every failure does go through `failure()` and does carry the header, but the failure paths are 500 (a variable unset), 502 (the origin refused the key, or the shape is wrong) and 503 (no snapshot row). **None can be produced in production without breaking production.**
  - **The safe method, offered and not assumed:** a PREVIEW deployment — any `--branch` other than the production branch — reads the Preview environment, where those variables are unset, so `/beds.json` returns the 500 with its headers on a throwaway URL that never touches the production alias. **Its cost:** it adds a deployment to the project's history, and that history is evidence in the what-is-running question, so it would have to be named in the report.
  - **Until Cowork rules:** the failure-response header stays asserted in `tests/db/beds_json_served.test.ts` and is **named as NOT OBSERVED AT THE EDGE**.
- **All three read-backs happen on the `*.pages.dev` alias**, because the cutover is held. **Reading a header there does NOT discharge the edge-headers step**, which is gated on the custom domain and is part of what Bundle 2 waits for. Stated because the two look alike in a report.

### R-2026-09-20-32 — the preview probe declined on reasoning; what a failure body actually contains; a failure path that skips the failure builder

_Issued as R-PROVISIONAL-2026-09-20-R. Number assigned from the record's last as read on merged `main` (`00888ab`): R-2026-09-20-31._

**A — #51 merged** at `00888ab`, head SHA read from the API, `MERGED` read back before `record-q` was deleted.

**A2 — the alias-versus-custom-domain separation recorded as correct.** Reading a header from `*.pages.dev` and reading it from `openbed.ng` produce report lines that look identical and are not the same evidence: the Cache API has no effect off a custom domain, so one of the two checks cannot even exercise the mechanism the other does. Separating them before anyone conflates them is method note 12's discipline — **name what you are NOT asserting** — applied without being asked.

**B1 — THE PREVIEW-DEPLOYMENT PROBE IS DECLINED, AND THE REASONING IS THE RULING.** R-2026-09-20-31 C offered it and named its cost. Cowork declined it **not on cost**:

> The reason to observe a header on a failure path is that the path leaks something or loses a control. Here the control is noindex on a document that, when failing, carries no bed data.

**That premise was checked against the code rather than accepted** (method note 2, as widened by R-2026-09-19-23). It holds: every failure path in `packages/snapshot/src/serve.ts` goes through the one `failure()` builder, whose body is `{"error": "<reason>"}` and nothing else. **A crawler that indexes a failing `/beds.json` archives a sentence, not a bed count.** The header's whole purpose — stopping the archived time series this design forbids — is not engaged by a response that carries no data to archive.

**B2 — recorded NOT OBSERVED AT THE EDGE, with its closing condition named.** A standing silence is not a decision; a silence with a trigger is. The condition: **a preview deployment against a NON-PRODUCTION project with the Preview environment variables unset, taken if the failure path ever comes to carry data.** Written into `docs/runbook-cloudflare-pages-beds-json.md` beside the read-backs, so the next reader of that step finds the ruling rather than an open question.

**B3 — THE BETTER QUESTION, ANSWERED BY READING: what does a failure body actually contain?**

- **The headline: no failure body echoes a VALUE.** Not the credential, not the upstream response body, not a caught exception's message. Every reason string is composed of literals plus, at most, an HTTP status, an attempt count and a timeout in milliseconds.
- **Two catch-alls are generic BY DESIGN, and that is load-bearing rather than lazy.** `serveBeds` ends `return failure(502, 'the snapshot read failed')` instead of echoing `e.message` — and **that path is where `res.json()`'s `SyntaxError` lands**, whose message routinely quotes the offending text. An echo there would republish whatever the origin actually said. The same holds for the network branch, which returns `could not reach the origin` and drops a thrown message that can carry a host and a port.
- **What IS echoed is STRUCTURE, in exactly one place.** The 502 shape-mismatch reason interpolates `JSON.stringify(Object.keys(payload))` — the upstream document's **key names** — and, per row, an index and an arity from the codec. Key names, never values. Recorded as acceptable and as **the one place to watch**, because the thing being described there is attacker-influenced only if the origin is already compromised, at which point this is the smaller problem.
- **Already probed, and it is worth naming what existed before this ruling:** the 500 names the variable and never its value, and one test asserts no error body carries the credential. **That probe exercises ONE path** — a 401 from the origin. It holds everywhere because the key is interpolated nowhere, but **one plant proves the instrument, never its coverage** (Standard P's own words, applied to a probe written weeks earlier).
- **FOUR GAPS, all of them missing assertions over behaviour that is ALREADY CORRECT.** Named and closed in this change, because *correct today and unasserted* is precisely how a thing stops being correct:
  1. **The arity plant plants a leak and never looks for it.** The existing test inserts the literal `'LEAKED'` into a ward row and asserts the body names `wardColumns`. It never asserts the body does **not** contain `'LEAKED'`. The plant was constructed for exactly this question and stopped one line short of asking it.
  2. **A malformed upstream body has no probe** — nothing asserted that the generic catch-all does not quote the text it failed to parse.
  3. **A thrown network error has no probe** — nothing asserted that its message is dropped.
  4. **`SUPABASE_URL` was never asserted absent** from a failure body. It is the one configuration value in scope that carries the project ref, and the credential probe covers only the key.

**B3-bis — A SCOPE CHANGE FOUND WHILE ANSWERING, REPORTED RATHER THAN FIXED.** `serveBedsCached` awaits `cache.match` and `cache.put` **outside any `try`**. An exception raised there is an **unhandled Function exception**: it does not pass through `failure()`, so it carries none of this module's headers — no `X-Robots-Tag`, no `no-store` — and the module's claim that *every* failure is uncacheable and tagged does not cover it.

- **What Cloudflare returns for an unhandled Pages Function exception is NOT established here**, and is deliberately not asserted (method note 19: read state, never assert it). The finding is about **our own code's coverage of its own claim**, which is readable from the repository.
- **The candidate fix is one `try` around the cache operations**, treating a cache failure as a cache miss — a cache is an optimisation and its failure should never be the visitor's failure. **It is not taken here**, because it changes shipped code while the founder's deployment of `00888ab` is imminent, and a deploy of a commit that is superseded the same hour is exactly the drift the deployment report exists to remove. Ruling requested.

**C — the queue stands unchanged**, and C2 is recorded: the founder has the deploy and read-back steps directly and needs nothing further from the implementer now that #51 has merged.

> **SUPERSEDED IN PART by R-2026-09-20-33 B3, by note rather than by rewriting (method note 8).** Two sentences in this block — B1's *"every failure path in `packages/snapshot/src/serve.ts` goes through the one `failure()` builder"* and C's *"every failure does go through `failure()`"* — are **exhaustive claims this block's own B3-bis then contradicts**, three paragraphs later. They should have read *every failure RESPONSE*, which is what was checked. B3-bis's finding stands; the two sentences above it do not, and they are left in place as written so the contradiction remains visible to a reader of the dated record.

### R-2026-09-20-33 — the cache hole ruled: merge, deploy, then fix; and an exhaustive claim caught inside the block that disproved it

_Issued as R-PROVISIONAL-2026-09-20-S. Number assigned from the record's last as read on merged `main` (`9751431`): R-2026-09-20-32._

**A1 — #52 merged** at `9751431`, head SHA read from the API, `MERGED` read back before `record-r` was deleted.

**B1 — THE DEFECT, NAMED FOR WHAT IT IS: a control whose STATED SCOPE EXCEEDS ITS COVERAGE.** `serveBedsCached`'s cache calls sit outside any `try`, so an exception there bypasses `failure()` and every header it attaches. Method note 12's shape — *a description broader than a filter* — **in code written this week**, by the session that has been finding that shape everywhere else.

**B2 — THE SEQUENCE IS MERGE, DEPLOY, THEN FIX, and the reasoning is recorded because the next such call will be made from the reasoning rather than from the verdict.** It is a severity comparison, not a preference:
- **The live hazard is patient-facing.** The empty-city page is deployed on the `pages.dev` alias now and can read to a visitor as *"no beds available"* when the truth is *"no facility has joined"*.
- **The cache hole is not.** It yields an untagged error response on a rare exception path, carrying no bed data — the same reason B1 of R-2026-09-20-32 declined the preview probe, applied consistently rather than only when it suited the conclusion.
- **Holding the deploy would trade a live hazard for a theoretical one**, and the deploy is repeatable at the cost of one command.

Cowork recorded that holding the fix was the right call and that **flagging rather than quietly amending shipped code with a deploy imminent was the right instinct**. Recorded here as the standing disposition: *when a fix would move the artifact under an imminent deployment, report it and let the sequence be ruled.*

**B3 — THE GAP IS RECORDED AGAINST THE ARTIFACT, and TWO PREMISES FAILED ON CHECKING. Both are reported rather than worked around.**

- **SCOPE CHANGE 1 — the caveat carries NO COMMIT SHA, deliberately.** S named *"the artifact deployed from `00888ab`"*. But C1 merges #52 **before** C2's deploy, so `main` moves past `00888ab` and the founder will deploy this block's own merge commit or a later one. Writing that SHA into the caveat would be **a composed fact about an event that has not happened** — method note 16's defect, inside the document that exists to prevent it. The caveat therefore binds **every artifact built before the cache fix lands, including whatever commit the forthcoming deployment report names.** Wider than asked for, and it cannot go stale.
- **SCOPE CHANGE 2 — the false sentence is NOT in the module header. It is in the runbook and in R-2026-09-20-32's own block, and the implementer wrote all three.** S said *"the module header itself is corrected in the fix"*. Read before acting:
  - `serve.ts`'s *"A failure is never cached"* and *"Only a 200 is ever stored"* are **still true**: an unhandled exception produces no response to store, so neither sentence is falsified by this defect.
  - Its *WHAT IS REFUSED RATHER THAN SERVED* list is **incomplete rather than false** — the exception is a fifth outcome, neither served nor refused. It gains that outcome **in the fix**, where the outcome stops existing.
  - The **exhaustive** claim lives in `docs/runbook-cloudflare-pages-beds-json.md` (*"Every failure path carries the header in code"*) and twice in R-2026-09-20-32 above. **The runbook is a LIVE RULE and is amended here; the dated record is SUPERSEDED BY A NOTE and never rewritten** (method note 8), which is why the note sits above rather than in place of the sentences.
  - **What that costs to notice:** the contradiction was *three paragraphs apart in one block*, written in one sitting. A claim and its counter-example passed the gate, CI and a review together, because nothing reads prose for consistency with itself. Recorded as the honest limit of every control in this repository.

**B4 — THE FIX, AND THE TRAP IN IT: one `try` wrapping THE CACHE CALLS ONLY.** Not the origin fetch, not the response construction. **A broad `catch` would convert real failures into cache misses and suppress exactly what `failure()` exists to tag — a worse version of the defect it closes.** `serveBedsCached` has three awaits, two of them cache calls; the third is `serveBeds`, which must stay outside. **The code comment says so**, so the next reader does not widen it as a tidy-up.

**B5 — THE DEGRADATION, and it is INVISIBLE TO THE CLIENT BY DESIGN.** A cache read that throws is a miss and goes to origin; a cache write that throws serves the response anyway. Neither loses correctness — only the cache hit. The exception is logged server-side and **never surfaced to the client**. Stated in the scope statement as deliberate, because an invisible degradation that is *not* declared reads to a later maintainer exactly like one nobody noticed.

**B6 — PLANTS BOTH WAYS, and the second is the one that matters.** With the cache throwing, the handler returns a normal tagged response. **With the ORIGIN failing behind a throwing cache, it still returns a tagged, uncacheable failure** — that is the leg that proves B4's trap was avoided, and without it the fix and the broad `catch` would look identical in green. Restores verified byte-identical.

**B7 — it ships as its own small PR immediately after the deployment report lands**, folded into nothing larger.

**C — the queue:** #52 merged; the founder deploys and reports the four clauses and three read-backs; the cutover hold lifts on that report; then B4's fix; then the two-regex-readers PR carrying its second task, the `public-relations.json` split, the infrastructure inventory and review, Finding D, the publish-screen echo gated on facility one, and Bundle 2 with 018.

### R-2026-09-20-34 — rulings batch instead of each taking a pull request; and the limit of prose self-consistency

_Issued as R-PROVISIONAL-2026-09-20-T. Number assigned from the record's last as read on merged `main` (`50c638e`): R-2026-09-20-33._

**A1 — RECORDED LATE, AND THE LATENESS IS THIS BLOCK'S OWN SUBJECT.** T and U were issued on 2026-09-20 and land here, inside the cache-fix pull request, rather than in a record-only one. That is A4 below applied to itself at the first opportunity. In the interval they lived in a transcript and in the session's carried notes — which method note 15 calls a defect, in the same words. **The cost was accepted deliberately when A4 was made, and it is named here rather than smoothed over.** Their text is recorded from the pending summary the session carried forward; the original transcript is not an artefact of this repository, which is the whole of what A4 trades away.

**A2 and A3 — ACCEPTED.** A3 names what is worth carrying from that day: **the prose-self-consistency limit recorded in R-2026-09-20-33 B3 is the most important thing recorded on 2026-09-20.** An exhaustive claim and its own counter-example sat three paragraphs apart in one block, written in one sitting, and passed the gate, CI and a review together. **Nothing in this repository reads prose for consistency with itself**, and no control proposed so far would.

**A4 — RULINGS BATCH. NO MORE ONE RECORD PULL REQUEST PER RULING.** They accumulate and land **weekly, or alongside the code change they govern — whichever comes first.** First weekly deadline **2026-09-27**, so "weekly" is anchored to a date rather than to a feeling.

- **The count that produced it, recounted rather than repeated:** **16 pull requests since #37** — not 17, which would count #37 itself — **of which 10 are record-only. 62%.** "Roughly two thirds" is exact, and the recount is itself an instance of method note 17: the number in the instruction was checked before the instruction was acted on.
- *"The record is a control, not a deliverable."* A process that spends two thirds of its pull requests describing itself is running on itself.
- **The rule carries its own cost rather than hiding it:** in the interval a ruling is a transcript, which is method note 15's defect. So the batch is **bounded by a date**, and the pending text is held where a new session finds it first.

**A5 — NO NEW SCOPE UNTIL FACILITY ONE IS ONBOARDED.** A finding is recorded as an **open item with a named trigger**, never converted into work. **An item with a trigger is not work until its trigger fires, and a quiet queue is not a trigger.**

**C — the queue:** unchanged by this block; it is carried by -36 C below.

### R-2026-09-20-35 — a ruling against ceremony that performed it; and the path named end to end

_Issued as R-PROVISIONAL-2026-09-20-U. Number assigned from the record's last as read on merged `main` (`50c638e`): R-2026-09-20-33._

**A1 — THE CONTRADICTION WAS COWORK'S OWN, and it is recorded rather than quietly dropped: a ruling against ceremony that reprinted the full queue inside itself.** Same shape as R-2026-09-20-33 B3, one document later — a claim and its counter-example inside one block. That it recurred immediately, in the document ruling on the first instance, is the evidence for A3 of -34: this is a limit of prose, not a lapse by one author.

**A2 and A3 — THE PATH, END TO END: the cache fix, then Bundle 2, whose FIRST TASK is the `packages/fixtures/public-relations.json` split.** Nothing between them.

- **The split was never an intermediate item.** This record already files it as 018 de-risking — `mirrors` serves two consumers whose meanings diverge under 018. Only its queue position was wrong, and only that is corrected here.

**A4 and A5 — NO NEW SCOPE UNTIL FACILITY ONE, AND IT BINDS COWORK TOO.** Several late-session additions were a hold being extended when it was one command from closing. The rule in -34 A5 is not addressed to the implementer alone.

**C — the queue:** carried by -36 C below.

### R-2026-09-20-36 — the deployment report accepted, three gates discharged, and a route that answers differently by method

_Issued as R-PROVISIONAL-2026-09-20-V. Number assigned from the record's last as read on merged `main` (`50c638e`): R-2026-09-20-33._

**A1 — THE DEPLOYMENT REPORT IS COMPLETE AND ACCEPTED.** Four clauses: the artifact `openbed-public-dashboard` at `https://d9b7669e.openbed-public-dashboard.pages.dev`; the commit `50c638efe0daca5cad1ffd82d10fccb2eacf4d89`; the command `bash scripts/deploy_pages.sh --branch main`; and the fourth clause as **a reading rather than an assertion** — `/version.json` fetched from the deployed site reports that commit with `dirty: false`. **A quotation, not an attestation, which was the whole point of R-2026-09-20-30.**

- **Re-measured independently before this block was written**, per method note 2 as widened by R-2026-09-19-23 — Cowork's claims about this repository are verified, not relayed. All three read-backs hold: the empty state names the distinction in words a dispatcher can act on; `GET /beds.json` returns `application/json; charset=utf-8` with `cache-control: public, s-maxage=30, stale-while-revalidate=300` and `x-robots-tag: noindex, nofollow`; `/robots.txt` returns robots content rather than the SPA fallback. `main` was read from `git rev-parse` and matches the deployed stamp.

**A2 — THE CUTOVER HOLD LIFTS** (R-2026-09-20-27 D3 discharged).

**A3 — BUNDLE 2'S GATE IS DISCHARGED.** R-2026-09-17-11 C named this report as its gate and it has landed. Bundle 2 is unblocked, with the `packages/fixtures/public-relations.json` split as its first task per -35 A3.

**A4 — A FINDING, FOLDED RATHER THAN OPENED AS NEW SCOPE.** A `HEAD` request to `/beds.json` falls past the Function to the SPA fallback: `text/html`, `cache-control: public, max-age=0, must-revalidate`, and only the site-wide `x-robots-tag: noindex` rather than the Function's `noindex, nofollow`. **The route answers differently by method.** Low severity — some crawlers and monitors issue HEAD. It rides with the cache fix rather than becoming its own item, under -34 A5.

- **The mis-measurement is named:** the read-back instruction used `curl -I`, which sends a HEAD, and therefore measured the fallback. The corrected GET is what A1 records. **-37 B1 below corrects this clause's account of where that `-I` came from.**

**A5 — AN OPEN ITEM WITH A TRIGGER:** `robots.txt` currently disallows everything, which is correct while nothing should be discoverable. **Trigger: facility one**, with the `noindex` decision already recorded there. Not work until then.

**A6 — THE PATH FROM HERE, unchanged:** the cache fix, then Bundle 2. Everything else is an open item with a trigger, and **the infrastructure inventory still runs BEFORE facility one onboards** — a gate on onboarding, not a deferral.

**C — the queue:** the cache fix (this change, carrying -37); then Bundle 2 with the `packages/fixtures/public-relations.json` split and 018; the two-regex-readers pull request with its second task and the infrastructure inventory and review, both after facility one; Finding D with the next change to the build config; the publish-screen raw-error echo at facility one.

### R-2026-09-21-37 — Cowork's own mechanism claim failed verification; the HEAD fix is the GET-normalised cache key

_Issued as R-PROVISIONAL-2026-09-21-W. Number assigned from the record's last as read on merged `main` (`50c638e`): R-2026-09-20-33._

**A1 — COWORK'S MECHANISM CLAIM FAILED VERIFICATION, AND THE STANDING RULE IS WHAT CAUGHT IT.** -36 A4 described the HEAD fix as *"same file, two lines"*, which assumes the Cache API accepts a HEAD request. **Cloudflare's Cache API reference states that `cache.put` throws for any request whose method is not GET.** Recorded under method note 2 as widened by R-2026-09-19-23: Cowork's platform claims are provisional and are verified before they land. **The rule caught it before the code did** — and note what the failure was worth: a bare alias would have thrown on every HEAD, into the very `catch` this same change adds for the rare case.

**A2 — THE HEAD FIX IS THE GET-NORMALISED CACHE KEY.** `serveBedsCached` in `packages/snapshot/src/serve.ts` keys the cache on an explicit GET `Request`, matches with `{ ignoreMethod: true }`, and `apps/public-dashboard/functions/beds.json.ts` exports `onRequestHead`. HEAD and GET share one entry and nothing throws. **The two halves are one mechanism in two files**, and each carries a comment saying so.

**A3 — THE TWO REJECTED OPTIONS, with reasons, because the next such call will be made from the reasoning.** The literal alias is rejected not only for the permanently degraded path but because **it would make the new `catch` fire on every HEAD: an exception log that fires routinely is how the genuinely unusual ones get ignored.** A tagged 405 is rejected because it breaks the HEAD clients that were the reason for the fix.

**A4 — A HEAD RESPONSE CARRIES HEADERS ONLY, AND THIS CODE STRIPS THE BODY ITSELF** rather than relying on the runtime to do it. *"Expected to"* is not an assertion, and stripping is exactly the sort of behaviour that is true on one platform and quietly not on another. Asserted in `tests/db/beds_json_served.test.ts`.

**A5 — PLANTS BOTH WAYS.** After a GET populates the cache a HEAD is served from that entry with the Function's headers; a HEAD on a cold cache neither throws nor creates a HEAD-keyed entry. **`ignoreMethod` is a reading of the reference, not a measurement, so the plant is what proves the normalisation rather than the citation alone** — and the fake cache is built to model the two documented rules, since a fake that accepted anything would make those plants vacuous.

**A6 — THE RUNBOOK: line 403's `curl -sSI` becomes a GET-based header read, and a new read-back asserts GET and HEAD agree** on `content-type` and `x-robots-tag` in `docs/runbook-cloudflare-pages-beds-json.md`.

**A7 — THIS IS NOT NEW SCOPE UNDER -34 A5, and the reason is recorded.** The defect was invisible because no probe could see it, **so the probe is the root fix and the code change is the symptom fix.** A fix shipped without its probe can regress as silently as it arrived. It is the guard for an item already in scope, in the same change.

**B — THREE THINGS THE IMPLEMENTATION THEN FOUND. All are reported rather than worked around.**

- **B1 — SCOPE CORRECTION TO -36 A4: the `curl -sSI` is CHECKED INTO THIS REPOSITORY, not only in a Cowork message.** `docs/runbook-cloudflare-pages-beds-json.md` prescribed it at line 403 for the `X-Robots-Tag` read-back. So **the repository's own read-back step measured the SPA fallback**, and a reader ticking that box would have certified a header the Function never sent. This is the recurring category — *a check reporting success for a reason unrelated to what it guards* — and it is the sixth instance, after the phantom cross-file links, the `-o /dev/null` rotation probe, the dead-`ANON_KEY` curls, the key fallback, and the grep exit-2 family.
- **B2 — A CLAUSE 4 PHANTOM, FOUND IN THE FILE BEING EDITED AND CORRECTED HERE.** `packages/snapshot/src/serve.ts` claimed this directory was *"inside the ESLint Date ban (finding F3)"*. **There is no such rule.** `eslint.config.mjs` carries only the F2 duty-flag block; the one F3 control that is a Date ban lives in `tests/compliance/freshness_bands.test.ts` and is a regex over `packages/snapshot/src/freshness.ts` ALONE — that file also reads `packages/snapshot/src/anchor.ts`, but for an annotation count, which is not a clock check — so nothing reaches `serve.ts`; and the rule is specified-and-unbuilt in `Sprint Kickoffs/sprint-kickoff-bedspace-v2-2026-09-10.md`. A `Date.now()` added to `serve.ts` today passes lint, CI and every compliance test. **Corrected by Clause 4's discharge route 2** — rewritten in the weaker form the repository can actually execute. **Building the guard is an open item with a trigger: the next change touching the build or lint config**, alongside Finding D.
- **B3 — R-2026-09-20-33 B6's PREMISE IS QUALIFIED BY MEASUREMENT.** B6 said that without the second plant *"the fix and the broad catch would look identical in green"*. Three widened shapes were planted against the new block on 2026-09-21. A single broad `try` whose `catch` returns an untagged response **reds that leg and four others**; a `try` widened to include the origin read, which skips the cache write, **is caught — but by the miss/store leg, not by the load-bearing one**; and a widened `catch` that merely **re-runs `serveBeds` is not caught at all, and cannot be.** The reason is that **`serveBeds` is TOTAL**: it catches its own exceptions and always returns a `Response`, so it can never throw into a widened `catch`. B6 holds for the shape it names; the third shape is invisible to behaviour and would need a structural assertion over the source, which is named as NOT ASSERTED rather than faked.
  - **How this was found is the part worth keeping.** The first plant was malformed — the inserted origin read sat after an early `return`, on a path the planted throw skipped — so the file changed while the exercised path did not, and the leg passed. A file-level `cmp` confirmed the plant "landed" and was not enough. **`.claude/rules/test-conventions.md`'s rule is that a plant must be confirmed to have mutated the artefact; this adds that it must be confirmed to have mutated THE PATH UNDER TEST.** Without that check the conclusion would have been *the guard has a hole*, and an afternoon would have gone into hardening a control that was already correct.

**B4 — A SIXTH FINDING, FROM THE BEHAVIOURAL PASS ITSELF, AND IT IS AN OPEN ITEM RATHER THAN WORK.** `packages/snapshot/src/serve.ts` warns that `CACHE_CONTROL`'s `s-maxage=30` and `packages/fixtures/snapshot-shape.json`'s `pollCadenceSeconds` are both written against 30, and that changing one without the other makes the poll cadence and the cache disagree about how stale a document may be. **Nothing enforces that coupling.** Planting `pollCadenceSeconds: 45` against the real tree on 2026-09-21 reddened NOTHING — the full compliance project passed 518/518 with the fixture and the header disagreeing.

- **It is not a Clause 4 phantom**, and the distinction is kept: the comment cites no enforcement artefact and warns rather than claims. It is an **unguarded coupling**, which is a weaker defect than a false statement and is still worth a row.
- **Recorded under method note 22 as an open item with a named trigger: the next change that touches either value.** Not converted into work, per -34 A5.
- **Note where it was found.** Not by reading the module, which is what a behavioural pass usually is, but by planting a wrong value into a tracked off-diff file and watching nothing happen — Standard P's ledger doing the job the ledger exists for, on its first row.

**C — the queue:** as -36 C, with this change now carrying -34, -35, -36 and this block.

> **DEPLOYED 2026-09-21, by note rather than by rewriting (method note 8).** The
> founder deployed the merge commit `4803d20a3e6c74ae434a464e65575a50f44bdb63`
> through `bash scripts/deploy_pages.sh --branch main` to the artifact
> `https://50a0ea4d.openbed-public-dashboard.pages.dev`, and reported all five
> clauses. **Independently re-measured against that artifact before this note was
> written** (method note 2, as widened by R-2026-09-19-23): `/version.json` reads
> that commit with `dirty: false`; GET and HEAD on `/beds.json` BOTH return
> `HTTP/2 200`, `application/json; charset=utf-8`,
> `public, s-maxage=30, stale-while-revalidate=300` and `noindex, nofollow`;
> `/robots.txt` returns `text/plain` robots content. **The pre-fix control no longer
> reproduces** — on the earlier artifact `d9b7669e` a HEAD still returns
> `text/html`, which is what makes the agreement above mean something.
>
> The empty state reads, verbatim as rendered: *"No facility has joined OpenBed yet,
> so there is nothing to show. This is NOT a report that beds are unavailable — no
> hospital has told us anything either way. Call the facility directly, or 112 / 767
> in an emergency."* It states both required facts and is not an empty list, a bare
> zero or a blank panel.
>
> **SCOPE, because this is the distinction the report itself insists on: this is
> `*.pages.dev` evidence ONLY.** It discharges neither the custom-domain
> edge-headers step nor the EVIDENCE gate on 018 (R-2026-09-21-40 B). **`main`
> moving past `4803d20` does not reopen this** — the report names its own commit.


### R-2026-09-21-38 — #54 merged and read back; the post-merge checks discharged; three open items given triggers

_Issued as R-PROVISIONAL-2026-09-21-X. Number assigned from the record's last as read on merged `main` (`4803d20`): R-2026-09-21-37._

**A1 — #54 MERGED** at `4803d20a3e6c74ae434a464e65575a50f44bdb63`. The head SHA was read from the API into a variable and passed verbatim to `--match-head-commit`; `MERGED` was read back from the API before anything else; **the branch deletion was a separate action taken after that read**, and `state` was re-read as `MERGED` *after* the deletion, because deleting an open pull request's head branch closes it and nothing catches that.

**A2 — the new `main` is `4803d20a3e6c74ae434a464e65575a50f44bdb63`**, agreeing with `origin/main` and with the API's `mergeCommit.oid`.

**B — THE THREE POST-MERGE CHECKS, each against the MERGED TREE rather than the branch, and each with its evidence kind.** The branch is not the merged tree, and treating one as evidence for the other is the substitution this record keeps catching.

- **B1 MEASURED.** `docs/handoff-2026-09-21-deployed-and-reported.md` is tracked on `main`, added by `9086364`.
- **B2 MEASURED.** None of the five zero-byte strays is tracked or present. **Positive control:** `package.json` resolves by the same method, so the check reaches the repository root — an absence finding without that control is not evidence here (method note 18).
- **B3 MEASURED.** The corrected read-backs depend on no variable from a later or domain-gated step: `BEDS_URL` is confined to the custom-domain edge-headers step, `DEPLOY_URL` to the read-backs, each `read -r` immediately before its use. Both blocks were extracted **from the merged file** and pasted into `zsh -f -i`.

  - **A defect in the verification harness, not in the artefact, recorded because it is the same family as everything else here.** The first paste run filtered the shell's output through `grep -v '^%'`, and the interactive prompt prefixes the first line of output — so `--- GET ---` and an `HTTP` status line were silently removed from what was read back. **The instrument was hiding part of the very output it existed to show.** Re-run unfiltered, both blocks are correct and complete. An instrument that quietly drops evidence is indistinguishable from an artefact that never produced it.

**C — W IS NOT DISCHARGED BY THIS MERGE, and is recorded as ruled-and-not-yet-deployed.** R-2026-09-21-37 is discharged by the founder's deploy of **this merge commit** through `scripts/deploy_pages.sh` and by the quoted read-backs: `/version.json` naming `4803d20a3e6c74ae434a464e65575a50f44bdb63` with `dirty: false`, and GET and HEAD on `/beds.json` returning the SAME `content-type` and the SAME `x-robots-tag`. **Until that output is in hand, the fix is merged and not proven at the edge.**

- **The pre-deploy reading is the positive control, and it was taken:** against the still-deployed pre-fix artifact, GET returns `application/json; charset=utf-8` with `noindex, nofollow` and HEAD returns `text/html; charset=utf-8` with the site-wide `noindex`. **The probe reports the defect before the fix is deployed**, which is what makes a later agreement mean something.

**D — THREE OPEN ITEMS WITH TRIGGERS** (method note 22 — not work until the trigger fires):

1. **Build the F3 ESLint Date guard.** Trigger: the next change touching the build or lint config. The false citation is already corrected in `packages/snapshot/src/serve.ts`; the guard itself is specified and unbuilt.
2. **The unguarded `s-maxage` ↔ `pollCadenceSeconds` coupling.** Trigger: the next change touching either value. **The fix is an ASSERTION tying them together, not a comment** — a comment is exactly what is there now, and it is what failed: planting `pollCadenceSeconds: 45` reddened nothing across 518 compliance tests.
3. **`npx supabase start` hitting the Docker Hub pull rate limit in stack jobs.** Trigger: the next stack-job failure of that shape. **Fixed in that same pull request** — authenticated pulls or cached images — with the root cause shown from the failing log. **Never cleared by a re-run alone.**

   - **A GRADE CORRECTED, and it is the implementer's own.** The `db-tests` red on #54 was reported as Standard O branch (ii), a **proven** harness-or-infrastructure defect. **It was not proven.** The proximate mechanism was named from the log — the bind failure on port 54322 and the Docker Hub pull limit — but branch (ii) requires all three of a fresh-database reproduction, a named mechanism, and **an independently verifiable repro**, and the third was absent. A clean re-run on the same SHA establishes that the failure is intermittent, not what causes it. **INFERRED is the grade.** The distinction matters because branch (ii) closes an item and INFERRED leaves it open with a trigger, which is the difference between a defect handled and a defect deferred.

**C — the queue:** this change (the `packages/fixtures/public-relations.json` split, carrying this block and -39); then migration 018 and the rest of Bundle 2; the founder's deploy of `4803d20` discharging -37; the infrastructure inventory before facility one onboards; the two regex readers and the publish-screen echo after it; Finding D with the next build-config change.

### R-2026-09-21-39 — the public-relations.json split: two keys, and the coupling deliberately NOT re-asserted

_Issued as R-PROVISIONAL-2026-09-21-Y. Number assigned from the record's last as read on merged `main` (`4803d20`): R-2026-09-21-37._

**A — THE TWO KEYS ARE `clientAddressableRelations` AND `realtimePublicationMembers`.** The first is the set of relation names client code may address in `.from()`, read by `scripts/lint_from_allowlist.sh`. The second is the expected membership of the `supabase_realtime` publication, read by `tests/db/config_drift.test.ts`. **`mirrors` is retired as a key name; no key keeps it.**

**B — THE REASON IS RECORDED WITH THE NAMES, because the next reader will reuse the reason.** Each name states what its list contains, so the two cannot be merged again by accident. **Neither says "allowlist", deliberately: the lint is a STATIC CHECK, not an access grant.** The access boundary is RLS plus 018's REVOKE, and a key named "allowlist" invites a reader to believe the lint is holding a door shut that it has never touched.

**B2 — WHY THIS IS THE FIRST TASK OF BUNDLE 2 rather than part of 018.** The two meanings coincide **by accident**: migration 013 added three tables to the publication and granted `SELECT` on the same three, in one migration. 018 destroys the coincidence on both axes at once. Splitting the key **before** the change that exposes it means 018 edits two lists that already mean what they say. Doing it inside 018 would mean deciding, under pressure, which consumer the one key was serving.

**C — SCOPE: IDENTICAL CONTENT, A NO-OP REFACTOR.** Both lists hold `facility_public`, `ward_public`, `lga_rollup`. **The lint's correct post-018 content is NOT decided here** — the kickoff calls it *"a decision, not a deletion"*, and it belongs to 018.

- **Ten key sites across four files**, all updated in this change: the fixture; `scripts/lint_from_allowlist.sh` (the `Array.isArray` guard and the spread); `tests/db/config_drift.test.ts`; and the six scratch-fixture sites in `tests/compliance/bundle_guards.test.ts`, the guard over the lint — **skipping that last file would leave a guard asserting a schema that no longer exists.**
- **The proof is an identifier search over three key forms**, reported with its command and result, and **with a positive control**, because this repository's interactive `grep` is a ugrep wrapper that can silently return zero for patterns holding `$`, `{` or `?`.
- **One hit is excluded BY READING, not by narrowing the pattern:** `database/migrations/016_snapshot.sql:37` matches `mirrors:` and is the English word before a colon — *"two mirrors: app.project_facility is…"*. Narrowing the regex until it disappeared would have been the same defect as the search that finds nothing because it looked nowhere.

**D — WHAT IS DELIBERATELY NOT ASSERTED, AND IT IS THE POINT OF THE CHANGE.** **NOTHING asserts that the two keys agree.** An assertion that they hold the same names is exactly the coincidence this split removes, and it would go red the moment 018 is correct. Each consumer reads only its own key.

**E — THREE PROSE SITES REWRITTEN, because they describe the keys and would otherwise be false statements sitting on top of the code that disproves them.**

- The fixture's own `comment`, which said the one key was *"Shared by"* both consumers. `packages/fixtures/public-relations.json` is **one of the three files named in `.claude/rules/test-conventions.md`** for claiming a cross-file link that no assertion made, so its new comment states only what is enforced, and names what is not.
- The lint's header, which said `tests/db/config_drift.test.ts` imports **the same key** and asserts it equals the publication membership. It did, and that is precisely what stops being true here.
- `config_drift`'s docstring, which said the lint's allowlist and the database's published surface *"cannot drift apart, because doing so requires editing the one file both of them read."* **After this change they can, and under 018 they will.** A docstring promising a coupling that the code beneath it has just removed is worse than no docstring.

**F — PROSE ELSEWHERE IS LEFT ALONE.** Where the record, the kickoff or a sweep says "mirrors", it stays: those sentences describe the public mirror tables, which still exist and are still called that. **Only key names changed.**

**C — the queue:** as -38 C.


### R-2026-09-21-40 — the EVIDENCE gate restated as four observations; a probe that belonged to the category it was written to catch

_Issued as R-PROVISIONAL-2026-09-21-Z, with its addendum and an amendment to part B. Number assigned from the record's last as read on merged `main` (`cf8bcd9`): R-2026-09-21-39._

**A1 — COWORK'S PART B WAS WITHDRAWN BY COWORK, AND THE ERROR IS RECORDED AS IT WAS STATED.** Z B first sequenced 018 directly after the split, on the handoff's statement that Bundle 2's gate was discharged. **That covered the deployment report only.** The EVIDENCE gate of R-2026-09-20-28 B is a different gate, it is unmet, and it **stands as worded** — it is not reinterpreted, and R-2026-09-20-36 A3 does not discharge it.

**A2 — BOTH TEXTS WERE READ BY THE IMPLEMENTER BEFORE THIS WAS RECORDED**, rather than paraphrased from memory, because the whole failure above was a gate paraphrased from a handoff. R-2026-09-20-28 B names **three** conditions, not the two the kickoff's summary carries: *"the cache criterion is OWED, the custom-domain cutover has not happened, **and the one DNS reading taken showed the apex on a TEST-NET-1 placeholder**."*

**B — THE EVIDENCE GATE, AS FOUR OBSERVATIONS. All four are on `openbed.ng`; none can be taken on a `*.pages.dev` host.**

1. **The apex resolves to Cloudflare** — not to a `192.0.2.x` TEST-NET-1 placeholder.
2. **The custom-domain cutover is done:** `https://openbed.ng/beds.json` reaches the Function.
3. **The edge headers on that URL:** `HTTP/2 200`, `content-type: application/json; charset=utf-8`, `cache-control: public, s-maxage=30, stale-while-revalidate=300`, and a body that does **not** begin `{"error":`.
4. **A cache hit on that URL:** two requests inside 30 seconds, the **second** reading `cf-cache-status: HIT`, **together with `HTTP/2 200` and the JSON content-type**.

**018 is not written until those are quoted back.** The 2026-09-21 deployment report is `*.pages.dev` evidence and discharges none of them.

**B2 — WHY THE PROBE FIX HAD TO COME FIRST, and this is the substance rather than the ordering.** Observation 4 is taken with runbook step 6, and **step 6 was the most defective probe in the file**. It grepped `cf-cache-status` alone. A lone `HIT` is satisfied by the SPA fallback (a missing Function is answered by `index.html` as a static asset, which the ordinary CDN caches and marks `HIT`), by a cached 404, and by a failure response. **The gate would have been discharged by a probe that cannot see what it claims to check.**

**C — A PROBE WRITTEN TO CATCH A CATEGORY BELONGED TO THAT CATEGORY. The finding is accepted as MEASURED and the numbers are the implementer's own.**

- `curl -X HEAD` **failed 8 of 8 runs** against a correct server, with `curl: (18) transfer closed with 135 bytes remaining to read`; `curl -I` passed 8 of 8. `-X` overrides the method string but leaves curl expecting the body that `content-length` promises and a correct HEAD never sends.
- **The direction of the failure is the finding.** `-X HEAD` returned **exit 0 against the PRE-FIX artifact**, because the SPA fallback sent a real body for curl to consume. **The probe worked only while the defect it guards existed, and broke the moment the fix was correct.**
- **It shipped inside the change whose commit message named this exact shape**, three paragraphs from the narration of the `-I` bug it was replacing.

**C2 — AND THE CRITERION WAS WRONG, not only the flag.** Step 8 said the stop condition was that GET and HEAD **agree**. Measured 2026-09-21: `/nonexistent-path`, which has no Function at all, returns `text/html` for **both** methods. **A parity test passes on a route that lost its Function entirely**, because a fallback is perfectly consistent across methods. Two `500`s agree on every header `failure()` sets. The step also grepped `^cache-control` while naming **no expected value**, so `no-store` — the failure header — passed. **The stop condition is now the exact absolute values under both headings**, which is this record's own standing rule: name the pass by its values, never by a negation or a relation.

**D — THE SWEEP OF THE REST OF THE FILE, ordered by how likely each is to report success while the thing it guards is broken.** All are fixed in this change, because all are in the same file.

1. **Step 6, cache hit** — see B2. Now requires `HTTP 200` and the JSON content-type alongside `HIT`, and **states what `cf-cache-status` can never distinguish: the Function's own Cache API from the zone's ordinary CDN cache.**
2. **Read-back 6 — the implementer's own, written the same day.** Its stated PASS was `application/json; charset=utf-8` plus `noindex, nofollow`, and **`failure()` emits exactly those two headers**, so a 500, 502 or 503 satisfied it verbatim. The status line was printed and the prose never said what it must read. Now requires `HTTP 200` and a body read rejecting `{"error":`.
3. **Reporting clause 4** — it named the property *"the commit will not be an ancestor of `main`"* and **supplied no operation that decides it**; `merge-base` appeared nowhere in the document. It had no command at all, so a missing `/version.json` answered by the SPA's `index.html` with a 200 passed, exactly as `/robots.txt` did before 2026-09-20 — same directory, same fallback. Its only stated signal was a **negation** (`"dirty": true` means bypassed). Now: a command, an ancestor check that names all three exit outcomes, HTML rejected, and PASS stated positively.
4. **Step 7, the rate limit** — a 429 does not say **which** rule fired; the scope claim *"nothing else"* has **no negative control**; and *"then restore the real threshold"* has **no read-back**, so a forgotten low threshold is a live outage nothing in the document would catch. Named as a human step, not given a fabricated command.
5. **Step 5, edge headers — the strongest probe in the file**, and it is worth saying why: three exact values, an explicit ban on negations, and a body read. Its one gap was that **empty output had no stated meaning**, and grep's exit 1 and exit 2 are indistinguishable on screen. Now named.

**E — THREE STALE STATEMENTS IN THE SAME FILE, fixed because they misdirect the next action.**

- **Step 4 still read `HELD — DO NOT PERFORM THIS STEP YET`** although R-2026-09-20-36 A2 lifted that hold. **It forbade the founder's very next action.** The hold text is kept and marked lifted, with what lifted it, because a reader who finds only "go ahead" cannot tell whether the hazard was closed or forgotten.
- The read-back blockquote still justified using `*.pages.dev` *"because the custom-domain cutover is HELD"*.
- **A KNOWN GAP that had closed and could not say so.** The `serveBedsCached` cache-`try` caveat bound *"every artifact built before the cache fix lands"* and **deliberately named no commit** — correct then, and precisely what made its expiry invisible. The fix landed in #54 and is in the deployed `4803d20`. **A caveat with no expiry condition needs a closing note or it outlives its subject.** Superseded by note, never rewritten.

**F — CONTRADICTIONS BETWEEN Z AND THE KICKOFF, LISTED AND NOT SILENTLY RESOLVED, as the amendment requires.**

- **The kickoff's 018 bullet states two different conditions in one breath:** *"the cache criterion is OWED and the custom-domain cutover has not happened"* **and** *"018 is not written until the founder's deployment report lands."* **Those came apart** — the report landed; the other two did not. The amendment rules the EVIDENCE gate stands, so the bullet is **left as written** and this block records which half governs.
- **The kickoff's `public-relations.json` task is unchecked and done**, shipped at `54c66a8` under R-2026-09-21-39. **Left unticked**, per the 2026-09-14 tick-reconciliation ruling: *tick nothing, run nothing*.

**G — THE PRODUCT BIBLE IS NOT IN THIS REPOSITORY.** The draft, at docs/product-bible.md without backticks because **it does not exist here and a backticked path would be a Clause 4 phantom** — the guard `tests/compliance/no_phantom_paths.test.ts` caught exactly that in the first draft of this very clause — was an untracked Cowork draft and was removed, because **any untracked file makes `scripts/deploy_pages.sh` refuse** — `git status --porcelain` non-empty. It is committed only when the founder approves it, under its own ruling. Read as context, never as authority. Nothing to do.

**H — Z's other parts are recorded as SCOPE, not as work.** T is amended narrowly to admit Bundle 3 (the operator path to facility one) once the infrastructure review has run; the review now gates Bundle 3, not only facility one. Bundle 3's own kickoff is Cowork's, written after that review. **Nothing in C, D, E or F of Z is started here.** Z D1 was verified against the code before being recorded — see the next block's clause.

**C — the queue:** this change; then the founder's cutover and the corrected steps 5 and 6 on `openbed.ng`, quoted; then the EVIDENCE gate recorded lifted on that output; then 018; then the founder's hosted apply of 018; then the infrastructure review; then Bundle 3; then facility one; then Bundle 4.

### R-2026-09-21-41 — Z D1 verified against the code rather than recorded on its face

_Issued as part of R-PROVISIONAL-2026-09-21-Z (part D1). Recorded separately because it is a verification result, not a direction._

**A — THE CLAIM HOLDS IN FULL.** *"Roles stay table lookups in `app.ward_account`, enforced in definer functions (`assert_member`). The custom access token hook stays off."*

- `app.assert_member` (`database/migrations/011_read_rpcs_capped.sql`) is `SECURITY DEFINER` with `SET search_path = ''`, reads `app.ward_account`, and derives identity from `auth.uid()`. **`p_facility_id` is only ever an equality check against the row's own `facility_id`, never the source of scope** — the function's own comment says *"It is what the caller WANTS to act on; `auth.uid()` is who they ARE."*
- `is_active` is enforced, and **the ruling's reason is already written into the migration**: *"Deactivation blocks immediately. A facility admin's deactivate action must take effect on the next request, not at the next token expiry."*
- The custom access token hook is **entirely commented out** in `supabase/config.toml` — stock CLI scaffold, never activated. No `pg-functions://` hook exists in any migration.
- The revocation window the reason invokes is real and measured: `jwt_expiry = 3600`, and `tests/setup/auth.ts` records a **25-hour** worst case (timebox plus jwt_expiry) observed rather than reasoned.
- **Nothing carries an app role in a token today.** The only `role` claim anywhere is the Postgres role.

**B — TWO QUALIFIERS RECORDED RATHER THAN SMOOTHED, because each narrows what the evidence proves.**

- **The immediate-deactivation tests inject a forged claims blob**, not a GoTrue-issued token. They prove the SQL function refuses on the **next statement**; they do not measure token behaviour, and the counterfactual in one test's name ("not at token expiry") is a design claim rather than a measured one.
- **`tests/db/config_drift.test.ts` guards four config keys and NOT the hook block.** "The hook stays off" is therefore a **convention, not a ratcheted invariant** — nothing reddens if someone enables it. Recorded as an open item with a named trigger (method note 22): **the next change that touches `supabase/config.toml`'s auth section.**

**C — the queue:** as -40 C.

---

### R-2026-09-21-42 — the cache step had no observable that could take two values; the Function's own cache is now measurable

_Issued with no provisional letter: it arrived as the founder's EVIDENCE-gate read-back of 2026-09-21 plus Cowork's seven constraints on the fix. Recorded under its own number because it changes code, a probe and three recorded facts._

**A — THE FOUNDER'S READ-BACK, AND WHAT IT SETTLES.** After the custom-domain cutover, on `openbed.ng`:

| # | Observation | Verdict |
|---|---|---|
| 1 | The apex resolves to Cloudflare, not a `192.0.2.x` placeholder | **PASSES.** `nslookup openbed.ng 1.1.1.1` → `172.67.213.114`, `104.21.37.208`. Record-level: the apex is now `CNAME openbed.ng → openbed-public-dashboard.pages.dev`, proxied; the `A 192.0.2.1` row no longer exists. The third condition of -28 B is discharged. |
| 2 | `https://openbed.ng/beds.json` reaches the Function | **PASSES.** |
| 3 | Edge headers and a non-error body | **PASSES.** `HTTP/2 200`, `application/json; charset=utf-8`, `public, s-maxage=30, stale-while-revalidate=300`, body `{"v":6212,"wards":[],…}`. |
| 4 | A cache hit inside 30 seconds | **NOT MET, and the probe is why.** `cf-cache-status: DYNAMIC` on both requests. |

**The EVIDENCE gate stays shut, on observation 4 alone.** 018 is not written.

**A2 — `DYNAMIC` IS NOT A DEFECT, AND IT IS NOT EVIDENCE OF ONE.** This is the substance, and it is graded:

- **DOCUMENTED** — Cloudflare's Cache API reference: *"The Cache API is a programmatic interface for reading from and writing to Cloudflare's cache from inside a Worker. To cache responses from your Worker so that Cloudflare returns them without executing your Worker, use Workers Caching instead. **The two mechanisms are independent.**"*
- **DOCUMENTED** — Cloudflare cache responses: *"**DYNAMIC** — Cloudflare determined at request time that the asset is not eligible for cache, so the request went to the origin web server **without a cache lookup**"*, which happens when *"the requested asset is not one of the default cached file extensions (for example, HTML or JSON) and no rule instructs Cloudflare to cache it."*
- **INFERRED from those two, and it is the answer to Cowork's question 2:** `cf-cache-status` reports the **zone CDN's** decision. For a `.json` path with no Cache Rule that decision is `DYNAMIC` on **every** request. The Function then runs and consults its own, independent cache. **The header returns the same value whether `serveBedsCached` hit or missed, so it can never be a stop condition.** Step 6 was a probe that could not pass — the same class as step 8's `curl -X HEAD`, found the same way.
- **NOT CONFIRMED, in either direction: whether the Cache API is storing and serving on `openbed.ng`** (Cowork's question 1). No observation taken so far discriminates. The founder's measurement is consistent with the cache working *and* with it not working. Closed by B.
- **MEASURED BY THE IMPLEMENTER, 2026-09-21, and it is sharper than the inference above.** Against `openbed.ng` on the pre-marker deployment, pasted into `zsh -f -i`, output unfiltered: `/beds.json` returns `HTTP/2 200`, `application/json; charset=utf-8`, `cf-cache-status: DYNAMIC` — **twice**, reproducing the founder's reading independently. And the control: **`/nonexistent-path`, a route with NO FUNCTION AT ALL, returns `cf-cache-status: DYNAMIC` as well.** So on this zone the header does not distinguish a working Function from a missing one, never mind a cache hit from a miss. Only `content-type` exposed the fallback — `text/html` against `application/json`.
- **MEASURED, same sitting, closing the second false fact in C:** `https://openbed-public-dashboard.pages.dev/beds.json` returns **no `cf-cache-status` line at all**, because a `*.pages.dev` host is not a customer zone and nothing stamps one. That absence was once recorded as evidence of "an inert Cache API". It was never evidence about the Function's cache in either direction.
- **The founder's refusal to add a zone Cache Rule is CORRECT and stands.** A Cache Rule would make the **other** cache answer, so the step would pass while proving nothing about this code. That is the false-green family, not a workaround for it.

**A3 — WHAT THE CACHE CRITERION PROTECTS AGAINST** (Cowork's question 3), read back rather than paraphrased. The A1 kickoff's definition of done: *"a second request inside `s-maxage` is served by the cache"*; its reason, from *platform-sre*: *"the whole cost argument in A1 rests on the edge actually caching"*. `packages/snapshot/src/serve.ts` states the failure it prevents: *"Without this, every request would run the Function and read Supabase, which is the opposite of A1's cost argument."*

**The property is ORIGIN OFFLOAD** — a second request inside `s-maxage` answered **without a Supabase read**. It is load-bearing for 018 precisely because 018 removes the direct read path and makes this the only public read path.

`x-openbed-edge-cache: hit` is set on the branch that returns the cache entry **without calling `serveBeds`**, so it measures that property directly. `cf-cache-status` never measured it. **The gate is not reinterpreted:** observation 4 stays on `openbed.ng`, two requests inside 30 seconds. Only the observable changes — from one that cannot distinguish the two states to one that can.

**B — THE FIX: `x-openbed-edge-cache`, a closed set of five values, on every response.** `hit`, `miss`, `nostore`, `read-error`, `unavailable`, evaluated in a fixed precedence so the state is a total function of what happened.

- **It is set on what is RETURNED and never on what is STORED**, in the same function that strips a HEAD's body and for the same reason. A marker inside the cached object would serve `miss` on a hit, or `hit` on a miss, forever. `tests/db/beds_json_served.test.ts` asserts the stored entry carries no marker at all; planting the write on the cached copy reds that leg and only that leg.
- **`miss` does not claim the write succeeded.** On the `waitUntil` path nothing awaits the put, so the outcome is not knowable when the response is built. Asserting it would be a Clause 5 defect inside the fix for one. The log line reports a write that failed.
- **Both halves demonstrated before the founder runs anything** (note 23): nine legs, and three plants run against the module — the marker written into the stored copy, the state hardcoded to `hit`, and the marker dropped on HEAD — reddening 1, 7 and 1 legs respectively, with `serve.ts` restored byte-identical after each.
- Every request now logs its state **with its cause**, so a `miss` at the edge is explainable without a code change.

**C — THREE FALSE FACTS FOUND WHILE ANSWERING, REPORTED RATHER THAN WORKED AROUND** (method note 20's rule, applied to our own text).

1. **`serve.ts` and `beds.json.ts` both said the Cache API works ONLY on a custom domain, citing Cloudflare. The cited paragraph says the opposite for Pages Functions:** *"Workers deployed to custom domains have access to functional `cache` operations. **So do Pages functions, whether attached to custom domains or `*.pages.dev` domains.**"* A `*.workers.dev` fact about Workers was applied to a Pages Function. The premise is load-bearing in the runbook's overview, its step 4 and its step 6, and in the A1 kickoff at its definition-of-done split, via R-2026-09-18-16 C2/C3 and R-2026-09-18-17 B1. **The instruction survives — step 6 runs on `openbed.ng` because the gate is worded that way — but its stated reason does not**, and the reason is what the next decision reuses.
2. **A recorded inference of the implementer's own was wrong.** Step 6 recorded, of `50a0ea4d`, that no `cf-cache-status` line at all was *"consistent with an inert Cache API"*. It is equally consistent with the Cache API working: a `*.pages.dev` host is not a customer zone, so no zone-cache header is stamped there at all. Superseded by a dated note, never rewritten (note 8).
3. **`serve.ts` recorded `stale-while-revalidate` as NOT VERIFIED. It is documented, and the answer is no:** *"The `stale-while-revalidate` and `stale-if-error` directives are not supported when using the `cache.put` or `cache.match` methods."* The header is still correct to send, for browsers and any downstream cache; it buys nothing at the Function's cache.

**C2 — AND ONE ABOUT -40 ITSELF.** Step 6 already said, in the text -40 landed, *"`cf-cache-status: HIT` does not say which cache answered."* **The limitation was named and the header was left as the stop condition anyway.** Naming a limitation is not acting on it, and the distance between the two is one founder session.

**D — THE PREMISE IN COWORK'S OWN CONSTRAINTS, CHECKED BEFORE ACTING ON IT** (note 20). Constraint 2 expects `*.pages.dev` to yield *"`unavailable` or whatever the inert Cache API honestly yields"*. That rests on C1, which fails. **Predicted, DOCUMENTED: `*.pages.dev` yields `hit`/`miss` like any other host**; `unavailable` is reachable only where `caches.default` is absent — the node test process, and Cloudflare's dashboard editor and Playground — and is **not expected at the edge**. The founder's run converts this to MEASURED at no extra cost: a `--branch main` deployment is reachable on `openbed-public-dashboard.pages.dev` and on `openbed.ng` with the same environment, so step 6 is run on both. A **preview** deploy would not serve: `scripts/deploy_pages.sh` records that a non-production branch reads Preview environment variables and finds them unset, so the Function would answer 500 and the marker `nostore`.

**E — THE READ-BACK THAT LIFTS THE GATE.** After this merges, the founder deploys the merge commit with `bash scripts/deploy_pages.sh --branch main`, quotes `/version.json`, then runs corrected steps 5 and 6 on `https://openbed.ng/beds.json`. **Observation 4 is met when the second block, inside 30 seconds, reads `HTTP/2 200`, `content-type: application/json; charset=utf-8` and `x-openbed-edge-cache: hit`** — and the request after 40 seconds reads `x-openbed-edge-cache: miss`, which is what shows the probe can fail. `cf-cache-status: DYNAMIC` is quoted alongside and is neither a pass nor a fail.

**E2 — ONE CORROBORATION, BECAUSE THE MARKER IS THE CODE REPORTING ON ITSELF.** A marker that lies would look exactly like one that does not. Once, alongside the founder's run: the Supabase API log for that window shows **one** PostgREST read of `snapshot_current` across the two requests, not two. That observes origin offload **from the origin side**, which is the property itself rather than a self-report. Not part of the gate, and not repeated.

**G — A FINDING THE BEHAVIOURAL LEDGER PRODUCED, RECORDED AS AN OPEN ITEM WITH A TRIGGER (method note 22), NOT FIXED HERE.**

Standard P's ledger requires each control to be re-derived against a tracked file outside the change's own diff. Re-deriving the served-document legs against `packages/fixtures/snapshot-shape.json` produced **no diff**, and it should have.

**The column-NAME legs in `tests/db/beds_json_served.test.ts` are tautological.** They read:

> `expect(Object.keys(decodeWard(row))).toEqual(SHAPE.wardColumns)`

and `decodeWard` builds its keys **from `shape.wardColumns`** (`packages/snapshot/src/codec.ts` lines 33-34, 87-88). Both sides of the comparison are the same fixture, so it is `f(SHAPE) === SHAPE`. **MEASURED 2026-09-21:** renaming `monitoring_state` to `monitoring_stateXX` in the fixture left that file at **43/43 passing**. What the legs DO prove is arity — a served row of the wrong length still fails the codec — and that is not nothing; it is simply not what they are read as proving.

**This is NOT a live hole, and the distinction matters.** The same plant reddens `tests/compliance/snapshot_shape_matches_migration.test.ts` loudly — *"migration 007 and snapshot-shape.json disagree"* — so the fixture cannot drift from the migration unnoticed. The property the A1 kickoff's definition of done names is guarded; it is guarded **one layer over from where the definition of done points**, and if that compliance guard were ever narrowed nothing else would catch it. Clause 5's shape: a mechanism present, reaching something other than what it is read as reaching.

**Not fixed here** under T/U: this change did not touch those legs, and the fix is an assertion — the served document's keys compared against a list NOT derived from the fixture — not a comment. **Trigger: the next change touching `packages/snapshot/src/codec.ts` or the served-document column legs.**

**F — the queue:** this change; then the founder's deploy and the corrected steps 5 and 6 on `openbed.ng`, quoted; then the EVIDENCE gate recorded lifted on that output; then 018; then the founder's hosted apply of 018; then the infrastructure review; then Bundle 3; then facility one; then Bundle 4. **Unchanged from -40 C except that the deploy is now load-bearing**, because the marker is new code.


---

### R-2026-09-21-43 — every corrected reason followed to the instruction it justified; the SWR consequence sweep; the colo precondition

_No provisional letter. Arrived as Cowork's confirmation of -42 §C with one condition, plus two consequence checks._

**A — THE CONDITION, DISCHARGED: each corrected reason followed to what it justified.** -42 §C corrected three reasons and left every instruction and the gate wording intact. Cowork accepted that and required the follow-through, so no instruction is silently kept and none silently deleted.

| Corrected reason | Instruction it justified | Reason after the correction |
|---|---|---|
| "the Cache API works only on a custom domain" | runbook step 6 runs on `openbed.ng` | **The EVIDENCE gate (R-2026-09-20-28 B) is worded on `openbed.ng`.** Valid — but governance, not mechanism |
| same | step 4 GATES step 7, the rate limit | **Untouched and still technical:** a zone WAF rule is zone-level |
| same | step 4 GATES step 6 | **⚠️ ONLY the gate's wording remains — see C1** |
| same | the A1 DoD: "never marked met from a `*.pages.dev` preview" | The gate's wording |
| same | R-2026-09-18-16 **C2**, "the two OWED steps share a prerequisite" | **The shared prerequisite is gone.** Both are still gated on the cutover, but now for **two different reasons**, not one. The conclusion survives; the framing does not |
| same | R-2026-09-18-17 **B1**, the Miniflare run is not evidence for the criterion | **Unaffected.** A local simulation is not Cloudflare's edge whatever the host question |
| "no `cf-cache-status` on `*.pages.dev` ⇒ an inert Cache API" | "no cache criterion may be recorded from that host" | **Broadened rather than lost:** `cf-cache-status` measures the wrong cache on **every** host, `openbed.ng` included |
| "`stale-while-revalidate` is NOT VERIFIED" | "the header is still sent, for browsers and downstream caches" | **Valid, and safe** — the payload carries `server_now` and `updated_at`, so a stale copy states its own age |

**B — THE SWR CONSEQUENCE SWEEP. 49 sites; most restate the header string and are left alone. Nine assert a behaviour or rest a decision on one.**

**B1 — THE ONE THAT MATTERS: A RELEASE GATE WAS WEAKENED ON THIS PREMISE.** `packages/fixtures/golden-path-steps.json` recorded, as the **sole stated reason** for restating a gate the founder had signed off:

> *"Public reads now come from a static snapshot at s-maxage=30, stale-while-revalidate=300, **which may legitimately serve a five-minute-old payload**, so the original clause encodes a requirement the chosen architecture cannot meet"*

Gate 2's *"the tile reflects it within 60 seconds with no page refresh"* became *"a client poll at the snapshot's own cadence reflects the new count"*. The same sentence is carried in `packages/fixtures/snapshot-shape.json`, and in the v1 and v2 kickoffs at four places.

**The premise is false. The conclusion stands.** DERIVED, not measured: generator cadence 60s (migration 017) + cache TTL 30s + client poll 30s ≈ **120 seconds**, not 300-plus. Still more than 60, so the restatement holds — **on roughly half the bound it claimed, and for a different reason.** Every site is corrected in place; the live rules are amended, the dated records get notes (method note 8).

**B2 — AND THE IMMUNISATION CLAUSE WAS BACKWARDS.** This record said sweep items #28 and #107 *"stand regardless, because it turns on `stale-while-revalidate` rather than on where anything is hosted"* — deliberately making them host-proof by pinning them to SWR, **which is the premise that then failed.** Immunising a claim against one objection by tying it to a second, unverified premise moves the risk; it does not remove it. Left as written with a dated note.

**B3 — the rest of the sweep.**

- **v2's dead-generator paragraph** — *"`stale-while-revalidate=300` keeps the CDN serving a plausible file for five minutes after the origin dies"* — the strongest behavioural SWR claim in the repository, and false. The camouflage window is the **30-second TTL**, then a `no-store` 5xx. **Its conclusion — that the sensor must be `version` not incrementing, not the dashboard and not `generated_at` — SURVIVES AND STRENGTHENS**, because it now rests on less.
- **`docs/handoff-2026-09-15-016-scope-and-rulings.md`** justified 017's `SET row_security = off` partly by "an empty snapshot the edge would serve for 300 seconds". Decision unaffected; **severity overstated about tenfold**. Dated note.
- **The A1 kickoff rejected an R2/KV alternative** partly because "the edge already collapses to roughly one origin read per `s-maxage`". It is **per data centre** — MEASURED 2026-09-21, six colos in 24 hours. `serve.ts` already said so; the kickoff did not. **The rejection still stands.**
- **`README.md` — public-facing — claimed the snapshot is "served from a CDN" costing "one origin read per minute regardless of how many people are watching".** Wrong three ways: not the zone CDN, per data centre, and per 30 seconds. Corrected.
- **Three sweep verdicts move from NOT CHECKABLE to CHECKED AND FALSE.** They were parked as vendor facts; naming the mechanism made them repo-checkable.
- **The irony, recorded because it settles the direction:** v1 and v2 both **ban** Workbox's client-side `StaleWhileRevalidate` — *"it will paint yesterday's bed counts under a full green badge."* The repository forbids at the client exactly what it assumed the edge was doing for it. **Losing edge SWR is the safer direction**, which is why none of this is urgent.

**C — OPEN ITEMS WITH TRIGGERS (method note 22). None is work now.**

**C1 — step 4 gating step 6 now rests on the gate's wording alone.** The technical reason is gone. If the EVIDENCE gate is ever reworded or discharged, **nothing requires the cache observation to be taken on the custom domain at all** — Pages Functions have a functional Cache API on `*.pages.dev`. Flagged rather than kept or dropped, exactly as Cowork required. **Trigger: any rewording or discharge of the EVIDENCE gate.**

**C2 — the FAILURE MODE changed, and it is worse.** Every corrected bound got *smaller*, so nothing safe becomes unsafe — but with SWR believed working, a dead origin meant five minutes of stale-but-real data. In fact, **30 seconds after the origin dies** the Function returns a `no-store` 5xx and `apps/public-dashboard/src/main.ts` renders *"Live data is temporarily unavailable — showing example data."* **Example data on a bed-availability board is the empty-city hazard family.** Pre-existing, but reachable ten times sooner than believed. **Trigger: Bundle 4, alongside the publish-screen raw-error item.** **[DISCHARGED 2026-09-21 by R-2026-09-21-44, which deleted the example data outright rather than waiting for Bundle 4. Left as written per method note 8. Two things this block got wrong, both in the safe direction: the window is not 30 seconds in a cold data centre, it is immediate; and the example rows rendered as OPEN AND ACCEPTING, which this block did not say.]**

**C3 — Gate 2 could be revisited.** The bound is ~120s, not ~300s. Still not 60s, so nothing changes today, and it is the founder's call either way. **Trigger: Bundle 4's freshness work.**

**D — THE COLO PRECONDITION ON STEP 6, and it was one run away from producing a false finding.** The Cache API is per data centre. MEASURED 2026-09-21 from the Supabase edge log: snapshot reads reached this project from **six** colos in 24 hours — LOS 13, CDG 12, PER 6, LIS 2, MRS 1, DUB 1 — with pairs seconds apart landing in **different** ones. A pair split across colos reads `miss` twice **with a perfectly working cache.**

`cf-ray` ends in the colo code, and it agrees with the log's own `request.cf.colo` — MEASURED both sides: `cf-ray: a3ea1b758c5bd081-CDG` against `request.cf.colo = CDG`. So step 6 now prints `cf-ray` and **requires both blocks to show the same code before the marker is read at all.** Different codes is a RE-RUN, not a result. `tests/compliance/runbook_cache_probe.test.ts` enforces both the header and the instruction to compare it — a printed header nobody is told to compare would be decoration.

**E — the queue:** unchanged from -42 F. This change; then the founder's deploy and the corrected steps 5 and 6 on `openbed.ng`, quoted; then the EVIDENCE gate recorded lifted on that output; then 018.


---

### R-2026-09-21-44 — invented bed counts were reaching real visitors; the example data is deleted, not guarded

_Issued as R-PROVISIONAL-2026-09-21-AA. A patient-safety exception to T, taken ahead of 018 and ahead of the step-6 run._

**A — THE FOUNDER'S DECISION, AND ONE OF ITS TWO CITED AUTHORITIES DOES NOT HOLD.**

AA cites R-2026-09-20-29 E and "the product bible's first principle".

- **-29 E HOLDS, and says more than the paraphrase.** E2 verbatim: *"the distinction is preserved at EVERY layer, and the assertion is made AT THE RENDERED SURFACE, not at the payload. A test that asserts the payload's honesty passes while the page lies."* E3: never *"a bare zero"*. **Precision worth keeping:** E is literally about *empty vs absent*. This is a third thing — an outage rendered as data. **E2 covers the CONTROL GAP exactly; the product rule here is an EXTENSION of E3** from "never a bare zero" to "never an invented number". Recorded as an extension, not as something E says.
- **The product bible is NOT AVAILABLE AS AUTHORITY, and this record already ruled so.** It is not in this repository — one `git grep -i "product bible"` hit, this record's own line; `find -iname '*product*bible*'` matches nothing, against a `docs/` listing as the known-present control. R-2026-09-21-40 G: *"THE PRODUCT BIBLE IS NOT IN THIS REPOSITORY … Read as context, never as authority."* **The instruction survives on -29 E alone**, which is sufficient. Reported rather than worked around (method note 20).

**B — WHAT WAS REACHING VISITORS, established rather than asserted.** `apps/public-dashboard/src/main.ts` rendered a hard-coded list whenever `/beds.json` could not be fetched, decoded or parsed:

```
Live data is temporarily unavailable — showing example data.
A_AND_E: 4 beds
THEATRE: 2 beds
```

DERIVED from source and **corroborated by `packages/fixtures/truth-table.json`**: with all three duty flags `UNKNOWN`, both categories carry `expected_gated_by: null` and `expected_accepting_effective: true`. **Both invented wards therefore rendered as OPEN AND ACCEPTING — the invented state was the most inviting one available.** MEASURED in the shipped bundle; no `import.meta.env.DEV` guard, and `vite.config.ts` sets `minify: false`, so nothing was eliminating it.

**Deleted, not flag-guarded** (AA B1): a flag leaves the rows in the bundle one runtime condition away from a visitor. The failure path now renders one paragraph and no list — an outage, a denial that it is an availability report, and 112 / 767. **`@openbed/gate` went with it**: it was imported only to derive the deleted rows' reason, and `apps/public-dashboard/package.json` no longer depends on a package the app does not use.

**C — A SECOND FINDING ON THE PUBLIC PATH, WHICH THE SWEEP FOUND AND NOBODY WAS LOOKING FOR.** `packages/fixtures/snapshot-shape.json` carried a `golden` payload — an invented facility name, an LGA, a state, **a latitude and longitude in central Lagos, an E.164 phone number**, two ward categories and two bed counts. `packages/snapshot/src/codec.ts` imports that file, the public dashboard bundles `codec.ts`, **and a JSON import is inlined WHOLE**. So every key was served to every visitor of `openbed.ng`.

**MEASURED by the implementer, in the built artifact, before and after:** `E2E General Hospital`, `+2348000000001` and `6.5244` each appeared once in `apps/public-dashboard/dist/assets/*.js`, and zero times in the ward-console bundle. Nothing rendered it — **and nothing needed to.** It was readable by anyone opening the page source, and it sat in exactly the positional shape `decodeFacility`/`decodeWard` accept, one line from being decodable.

**Root fix, not a scrub:** `golden` and its prose key moved to `packages/fixtures/snapshot-golden.json`, whose header states that shipping code must not import it. Its only consumer is `tests/compliance/snapshot_shape_matches_migration.test.ts`. **After the change all four tokens read 0 in the artifact**, with the empty-state and outage wording as the known-present controls so the check is not vacuous.

**D — THE OTHER TWO SWEEP FINDINGS ARE EXCLUDED FROM THIS PR ONLY BECAUSE THEY ARE UNREACHABLE TODAY, AND THAT WAS MEASURED, NOT ASSUMED** (AA's condition). Read from the hosted project on 2026-09-21: `app.facility` **0**, `app.ward_status` **0**, `public.facility_public` **0**, `public.ward_public` **0**, `app.ward_account` **0**; the newest snapshot (`v=6352`) carries `wards: 0` and `facilities: 0`.

- **A3 is unreachable:** with zero ward rows in the payload, `renderReal` returns at the empty-state branch and never reaches the facility lookup.
- **B2 is unreachable, and on the stronger condition:** `app.ward_account` is **0**, so **no session can exist**. That settles it without needing the ward console's deployment status, which remains unknown and sits in the infrastructure-review item.

**E — BOTH ARE MUST-FIX BEFORE FACILITY ONE. Not Bundle 4, not post-facility-one.** They join R-2026-09-20-30 D1 (the publish-screen raw-error echo) as onboarding blockers.

- **A3 — `'(unknown facility)'` beside a REAL bed count** (`apps/public-dashboard/src/main.ts`). **Severity: a count with no callable identity rendered as if actionable.** A row reading `(unknown facility) — ICU_ADULT: 6 beds` tells someone routing an ambulance that six beds exist somewhere they cannot ring. **Not decided here.** The options, with their consequences, for whoever takes it: suppress the row with an operator-visible signal — loses a real count and needs somewhere for the operator to see the gap; or render the gap in words pointing to 112 / 767 — keeps the reader informed but occupies a row. Cowork's lean is recorded: **a count with no callable identity must not render as if actionable.**
- **B2 — `wardRowFrom`'s defaults** (`apps/ward-console/src/main.ts`). **Severity: a defaulted clinical claim and a guessed concurrency token.** `offering: r.offering ?? 'NOT_OFFERED'` asserts to a ward that it does not offer a ward the server said nothing about; `version: r.version ?? 0` flows straight into `p_expected_version`, turning optimistic concurrency into a guess. **Ruled shape: refuse the malformed row — never default a clinical claim or a concurrency token.** Bundled with D1: same screen, same refusal-handling design.

**F — ONE MORE SWEEP FINDING, REPORTED AND NOT NEW SCOPE.** `packages/snapshot/src/freshness.ts` implements the GREEN/YELLOW/GREY/SUPPRESSED bands and `packages/snapshot/src/index.ts` does not export it; `main.ts` never imports it, and `renderReal` renders `bed_count` with no age check. **A three-day-old count renders identically to a 30-second-old one** — the exact string the shape fixture calls out as the thing not to do. This is Bundle 4's subject matter, already scoped there, and is recorded here because the sweep found it rather than because it is new.

**G — THE SEQUENCE (AA C):** this change; founder merge; **one** deploy of that merge commit through `scripts/deploy_pages.sh --branch main`, quoting `/version.json`; the outage state read back where it can be reproduced; **then** step 6 on that same deployment. **018 stays behind the EVIDENCE gate throughout.**

**H — R-2026-09-21-43 C2 is discharged by this change**, and its block is left as written with a note (method note 8).


## The provisional ledger

_Added by R-2026-09-20-28 C2. **Every provisional letter received gets a row when it lands.** A letter with no row either never arrived or has not landed yet, and Cowork can be told which._

| Provisional | Assigned | Date | Note |
|---|---|---|---|
| — | **-18, VOID** | 2026-09-19 | Numbered by Cowork outside the record and never delivered. Not reused; see its entry. |
| A | R-2026-09-19-20 | 2026-09-19 | The recorder assigns numbers from then on. |
| B | R-2026-09-19-21 | 2026-09-19 | |
| C | R-2026-09-19-22 | 2026-09-19 | |
| D | R-2026-09-19-23 | 2026-09-19 | |
| E | — | 2026-09-19 | **Never arrived.** Its substance was carried by F. |
| F | R-2026-09-19-24 | 2026-09-19 | |
| G | — | 2026-09-20 | **Never arrived.** It approved #45; its substance was carried by L. |
| H | R-2026-09-20-25 | 2026-09-20 | Issued to the handback session. **Text never reached the main session**; owed by Cowork. |
| J | R-2026-09-20-26 | 2026-09-20 | Same. The letter I is skipped deliberately, being too easily read as a pronoun. |
| K | R-2026-09-20-27 | 2026-09-20 | |
| L | R-2026-09-20-28 | 2026-09-20 | |
| M | R-2026-09-20-29 | 2026-09-20 | Supplied the H and J texts, which are filled in under -25 and -26. |
| N | — | 2026-09-20 | Its substance is recorded inside -30 (the #49 review, the one-unit ordering, the marking of `supabase-proxy/`, and `jsdom`'s conditions), which was the change that executed it. |
| P | R-2026-09-20-30 | 2026-09-20 | The letter O was skipped: confusable with zero in a ruling id. |
| Q | R-2026-09-20-31 | 2026-09-20 | |
| R | R-2026-09-20-32 | 2026-09-20 | Declined the preview probe and replaced it with a question answerable by reading. |
| S | R-2026-09-20-33 | 2026-09-20 | Ruled the cache hole: merge, deploy, then fix. Two premises failed on checking; both reported. |
| T | R-2026-09-20-34 | 2026-09-20 | The batching rule itself, and the no-new-scope rule. Landed late, inside the change it governs — which is the rule applied to itself. |
| U | R-2026-09-20-35 | 2026-09-20 | A ruling against ceremony that reprinted the queue inside itself; the path named end to end. |
| V | R-2026-09-20-36 | 2026-09-20 | The deployment report accepted and three gates discharged. Its account of the `curl -I` is corrected by -37 B1. |
| W | R-2026-09-21-37 | 2026-09-21 | Cowork's own mechanism claim failed verification. First letter of the 09-21 run. |
| X | R-2026-09-21-38 | 2026-09-21 | #54 merged and read back; the post-merge checks discharged; three open items given triggers. Corrected the implementer's own Standard O grade from proven to INFERRED. |
| Y | R-2026-09-21-39 | 2026-09-21 | Named the two keys of the public-relations.json split and recorded the reason with them. |
| Z | R-2026-09-21-40 | 2026-09-21 | Part B withdrawn and reissued by Cowork; the EVIDENCE gate restated as four observations on `openbed.ng`. Carries the runbook probe sweep. |
| Z (D1) | R-2026-09-21-41 | 2026-09-21 | The same block's design constraint, recorded separately because it is a verification result rather than a direction. |
| — (none issued) | R-2026-09-21-42 | 2026-09-21 | **No provisional letter.** Arrived as the founder's EVIDENCE-gate read-back plus Cowork's seven constraints on the fix. Recorded so the ledger does not imply the 09-21 run ended at Z. |
| — (none issued) | R-2026-09-21-43 | 2026-09-21 | **No provisional letter.** Cowork's confirmation of -42 §C with one condition, plus two consequence checks. The condition — follow every corrected reason to what it justified — is discharged in A. |
| AA | R-2026-09-21-44 | 2026-09-21 | The founder's patient-safety exception to T. First ruling this run to carry a provisional letter since Z. |

## Method notes — how rulings reach the implementer

_Standing rules, 2026-09-15. This record is their home._

1. **Every ruling block carries an id on its first line.** The implementer states the id received before acting. A block with no id, or a stale one, is stopped and confirmed, never acted on.
   - **Why:** on 2026-09-15 a block from before #23 was pasted again. A wrong or stale paste is otherwise indistinguishable from a repeat, a silent transport failure of the same class as the zsh findings.
   - **Amended by R-2026-09-19-20: the recorder assigns the number.**
     - Cowork issues `R-PROVISIONAL-<date>-<letter>`. That id is valid and actionable.
     - The implementer assigns the real `R-YYYY-MM-DD-nn` on landing, as the record's actual last plus one, read from the merged record. It records the provisional label beside the number and reports the assigned number back.
     - A block with NO id of either form is still stopped and confirmed.
     - **Why:** Cowork numbered a ruling -18 without reading the record, and that ruling never reached it. The party that writes the record is the party that knows its last number (notes 16 and 19). Rulings numbered before this amendment keep their numbers. -18 is VOID and is not reused.
     - **Clarified by R-2026-09-19-21: whatever turn it arose in.** Anything Cowork intends for the record goes in a provisional block, including material first given in an answer to the founder. A reply to the founder is not a channel to the recorder.
2. **Every load-bearing claim in a ruling is tagged observed or inferred.** Inferred means check before relying. This is `.claude/rules/test-conventions.md` §8 applied to the rulings themselves.
   - **Why:** the EXECUTE-default claim above. The error was of the class the ruling was enforcing.
   - **Amended by R-2026-09-19-22, and WIDENED by R-2026-09-19-23: ALL of Cowork's factual claims, whatever their subject, are PROVISIONAL BY DEFAULT.** That covers external platforms, this repository, its history and its state alike. (R-22 scoped it to external platform behaviour; R-23 widened it after a false claim about this repository's own test file.)
     - Each carries its evidence kind: DOCUMENTED-availability, DOCUMENTED-guidance, MEASURED, INFERRED or NOT CONFIRMED. It also carries its source: a page, a file and line, or a command.
     - **Claude Code verifies each before it enters the record**, because the party that can check decides.
     - **A claim of the form "confirmed at <ref>" names the check actually performed and what it returned, or it is not written. Absent that, it is marked NOT CONFIRMED.** A SHA attached to an unperformed check suppresses the re-check that would catch it (R-2026-09-19-23 B2).
     - **A claim marked NOT CONFIRMED or INFERRED NAMES WHAT WOULD CLOSE IT** (R-2026-09-20-29, carrying R-2026-09-20-26). Otherwise the marking is a disclaimer rather than an open item: it reads as diligence while nobody can act on it. Worked example in `docs/runbook-cloudflare-pages-beds-json.md`'s deploy step — one deploy with `--branch` omitted against a non-production project, or Cloudflare documenting the non-git case.
     - **Why:** Cowork's property, ordering and scoping rulings have held, except where they rested on a mechanism or state premise. Its failures are mechanism claims, counts, citations and system state, and "be more careful" had not stopped them.
3. **An instruction naming a command, a SHA, a PR or a runnable check is PROPOSED, NOT VERIFIED.** Its feasibility is checked before executing, and a conflict comes back rather than being worked around.
   - **Why:** two of R-2026-09-15-02's four operational instructions did not survive contact. The design rulings did.
     - Item 4 attached a docs chore to a PR whose approval was pinned to a SHA.
     - Item 5 asked for a hosted session-200 check that `assert_member`, B1 and B2 make impossible before onboarding.
     - Both errors were the founder's, and are recorded as such.
4. **PGRST203 stays recorded as an untested assertion** (condition D). The drop makes it moot. It is never cited later as a finding.
5. **Cowork rules the property; Claude Code proposes the mechanism** (R-2026-09-15-05). A mechanism named in a ruling is an illustration of the property, not an instruction, and the implementer says so when the two come apart.
   - **Why:** every ruling that held stated a property that must be true, and every one that failed specified how. (b) held because it ruled the contract and left the derivation open. The three that failed each reached past the property into the mechanism:
     - the count-equality control;
     - the hosted session-200 probe;
     - attaching the handoff to #23.
   - **Later instance, 2026-09-15:** "the count check guards MATERIALIZED staying put" (R-2026-09-15-06 item (3)). EXPLAIN showed the keyword is not load-bearing; the correction was accepted in R-2026-09-15-08. It is the second mechanism claim caught in the 016 review loop, after count-equality.
6. **A sweep targets the tense, not a phrase** (R-2026-09-15-09). The pre-017 sweep of the v2 kickoff first tried a grep for "already". It matched mostly prose, and missed the claims that had failed, because they were worded as plain present-tense facts ("`014` adds one index", "EXECUTE … granted to `service_role`").
   - The sweep that worked read the whole document for every present-tense assertion that something exists, is in place, was stood up, runs or is asserted.
   - Any later sweep of a planning document starts from the same target.
7. **An explanation carrying a decision is a premise too** (proposed by the founder in R-2026-09-15-09; judged coherent by the implementer, restated to cover both directions).
   - **This is not Clause 5.** Clause 5 is a mechanism present and not reaching: something that does not fire. **Nor is it `.claude/rules/test-conventions.md` §8,** which is a reason given WITH AN INSTRUCTION. This family is a causal explanation of observed behaviour — why something works, or why it fails — that a decision was resting on, and that nobody probed.
   - **Four instances this fortnight.** Three worked, and the stated reason was wrong:
     - the "postgres is superuser locally" claim, in six places and load-bearing for a hosted hand check;
     - the count-equality control, green for a reason other than the one given;
     - `session_replication_role`, which `postgres` sets through `supautils`, not as a superuser.
   - **The fourth is the mirror case:** zsh `PIPESTATUS` FAILED, and the stated reason for the failure ("zsh arrays are 1-indexed") was wrong — zsh does not set `PIPESTATUS` at all. The shape holds in both directions, so the note is worded for both.
   - **How to apply:** when an explanation of why something works or fails is about to carry a decision, probe the explanation, not only the outcome.
   - **For the `scripts/` survey,** this is a sharper target than "does this run": is the stated reason it works, or fails, the actual reason.
8. **A live rule is amended; a dated record is superseded** (R-2026-09-16-03). Before changing a sentence that has gone false, decide which it is.
   - **A LIVE RULE binds future behaviour and must be correct now.** The two freeze rules are the example: left naming 001–013, they would have licensed editing 014.
   - **A DATED RECORD describes a moment.** A handoff, a ruling block, an applied migration's header. It is superseded by a note -- at the top of its block, or in a later block -- and never rewritten. Editing one destroys the evidence of what was believed when a decision was taken.
   - **This is the companion to note 6.** The pre-017 sweep targeted present-tense claims, and **the tense alone does not say whether a claim is a rule or a record.** Both read identically; only their function separates them.
   - **Why it earned a note:** R-2026-09-16-02 instructed a present-tense sweep that, executed literally, would have edited an applied migration -- the rule and the instruction pointing in opposite directions.
9. **A tool you ran is not a tool that exists** (R-2026-09-17-05). Proposed by the founder; **the wording below is narrowed by the implementer, and the narrowing is the point.** As drafted it read as though an ad-hoc check were itself the defect. It is not: an ad-hoc check is legitimate evidence. **What this note binds is the CITATION, not the running.**
   - **Run it, tag it observed, and give the command.** That is a report, and it is how most of the findings in this record were made.
   - **It becomes a defect the moment it is cited as something another party can re-run, or as an artefact of the repository.** Before an instruction names a check, say where the check lives. If the answer is "in my shell", the instruction is to BUILD it, not to re-run it.
   - **Why:** R-2026-09-17-03 item 1 said "re-run that parser". No parser existed -- it had been run ad hoc and its output pasted. The implementer could not comply, derived the counts independently, reported the mismatch and committed the derivation, which is what the instruction should have asked for.
   - **It is Clause 4's phantom enforcement, one level up.** A cited script that does not exist reads exactly like one that does. And it is enumeration item #109 -- Gate 3 asserting a property test nobody built -- committed inside the document that records it.
   - **How it differs from note 3.** Note 3 is about an instruction naming a runnable check: its feasibility is checked before executing. This note is about describing a check you performed as an artefact of the repository. Note 3 asks *can this be run here?*; note 9 asks *does this exist at all?*
10. **Severity is marginal over the existing public baseline** (R-2026-09-17-07). A finding's severity is what it adds over what is already obtainable through the designed public path, never what it sounds like alone. **State the baseline, then claim only the delta.**
    - **One narrowing, offered by the implementer and the reason the note is worth having:** the baseline must be a **designed** public path, not another unfixed defect. Otherwise two holes excuse each other, and the second one is dismissed by pointing at the first. "Already obtainable because the snapshot publishes it" is a baseline; "already obtainable because another guard is broken" is a second finding.
    - **A corollary, from the measurement that produced this note:** a delta is often conditional, and the condition is part of the finding. The push/pull gap on `ward_public` is zero against a watcher polling faster than writes arrive, and total against writes closer together than any affordable poll interval. A severity claim that names no condition is usually the unconditioned version of a conditional one.
    - **Why it earned a note:** R-2026-09-17-06 wrote E1 up as defeating quiet mode without reading the defence already in migration 008, and re-sequenced a migration onto the critical path on that framing. The observation was sound; the severity came from the write-up.
11. **Cite by section name, not line number, inside any document that edits itself** (R-2026-09-17-07; standing advice before that, now binding). A marker added at the top of a file moves every citation below it, and the citation stays plausible while pointing at the wrong line.
    - **Three drifts in one session, every one caused by markers this same chain added:** `M/006:57` (the sentence is at :75), `v1:396` and `v1:400` (both moved by two lines).
    - **Where it binds:** the v1 and v2 kickoffs, this record, and any future sweep — documents that take inline markers. **Where it does not:** a frozen migration, whose lines cannot move, and the enumeration, whose header pins its citations to `db528f8` and which is a dated record besides.
    - **How to apply:** name the section, the task, or the sentence — "F2's SQL prescription", "A2's hosting split", "008's quiet-mode block". A reader finds those after any edit; a line number survives only until the next marker.
12. **A control names its enforcement point, and the point is checked** (R-2026-09-17-08; proposed as note 11, renumbered because #35 had taken it). When a control is written down, name **where** it is enforced — then check two things about that site, because each failure alone is fatal and both are invisible while the control is only ever read:
    - **Does the site exist?** "The public rate limit is enforced at the edge" named a deployment that does not exist.
    - **Can it see the whole surface?** A Realtime subscription is a websocket to Supabase and never traverses the edge, so that site could not have covered the push path however well it were built.
    - **Narrowing, offered by the implementer:** where a site cannot cover the whole surface, **name the part it cannot reach** rather than dropping the control. A rate limit at the edge is still right for the pull path; what was wrong was believing it covered everything. The gap belongs in the sentence, not in the reader's head.
    - **Against the clauses.** Clause 4 is a cited artefact that does not exist. This is a named site that **exists and cannot see the surface** — Clause 5 pointed at controls rather than at mechanisms. **Note 10 sizes an exposure; note 12 sizes a control**, and the two together are what stops a finding being written up against a control nobody checked.
13. **A definition of done names who performs each criterion** (R-2026-09-17-11 D). Where a criterion cannot be performed by the party the document addresses, it is **OWED with its owner named**, never listed as done-when.
    - **Narrowing, offered by the implementer:** the note binds where the performer is **outside the document's addressee**, and the fix is **naming the owner, not removing the criterion.** An unrunnable criterion that matters stays, as OWED — the failure being corrected is a silent transfer of work, not the existence of work someone else must do.
    - **Why it earned a note:** R-2026-09-17-10's Bundle 1 listed five founder-only criteria as Claude Code's definition of done. It would also have caught **v1's Bundle 5 definition of done**, which requires killing pg_cron and pausing the database, and **v1's Bundle 1 definition of done**, which requires a hand-run `select *` with the anon key against every `app` table — both criteria nobody in the loop was assigned.
    - **Companion to note 12.** Note 12 asks whether a control can reach its surface; note 13 asks whether a criterion can reach its performer.
14. **A feature documented for a platform's parent is not thereby available on the variant deployed** (R-2026-09-17-12). Note 12's "the enforcement point exists" is checked against **the platform actually shipping**, citing that platform's own documentation.
    - **Two instances on one day:** the Rate Limiting binding, which the Workers documentation presents as generally available and the Pages Functions binding list does not contain; and Bundle 3's cron triggers, flagged in the kickoff as proposed-not-verified for the same reason.
    - **How to apply:** find the variant's own enumerated list. Absence from an enumerated list is acceptable evidence **when the failure mode is loud** — an unsupported binding is a deploy-time error. Where the failure mode would be silent, absence is not enough and it is checked by running it.
15. **A ruling, decision or scope document is not landed until it is committed** (R-2026-09-17-12). **A session transcript and an untracked working-tree file are the same defect**: both are a record that exists for whoever was present and for nobody else.
    - **Three instances on 2026-09-17:** rulings R-09, R-10 and R-11, which reached the repository only when this change landed them; the A1 kickoff, which sat untracked in the working tree while a sprint was scoped against it; and two handoff documents that were owed. **All three are now landed** — the rulings and the kickoff in #37, and the two handoff documents in #37 as amended under R-2026-09-18-14. R-2026-09-18-13 then removes the out-of-repository staging area the handoffs came from, so the next one is born in `docs/` rather than carried there.
    - **It is R-2026-09-15-10 A2 generalised** — the pre-017 sweep's citations were "kept" in a session transcript until #28 committed them — and it is the reason the enumeration is a file rather than a paste.
16. **Read an identifier, never compose one** (R-2026-09-18-14). A commit SHA, a PR number, a migration number, a key id or a count is **read from the system that issues it and pasted verbatim** — never composed, extended, padded, or inferred from a short form. It is the attestation rule applied to every identifier: a number that looks verified and was typed is worse than an admitted gap.
    - **Instance, 2026-09-17:** a full SHA composed from the short `2801289` to merge #36. **`--match-head-commit` refused it, and that is the point of recording it: the guard worked.** This note documents a contained failure, not a loss.
    - **How to apply:** carry identifiers through a variable filled by the issuing system — `git rev-parse`, `gh pr view --json headRefOid`, `attest_counts.mjs` — never through a retyped string.
    - **What this note does not cover, and R-2026-09-18-14 C says why it matters:** the branch deletion that followed was a different error and nothing caught it. That one is closed by a rule in `.claude/rules/code-pipeline.md`, because a note about reading carefully is not a guard against deleting too early.
17. **A tool that reasons about a language it does not parse will eventually be wrong in a way that silently changes what it reports** (R-2026-09-18-15; wording amended by R-2026-09-18-16). **Use the language's own PARSER.** Not a scanner, not a tokenizer, not a regex: each of those decides structure without the context that structure depends on. _As first recorded this read "the language's own parser -- or, where only a scanner is on offer, prove the scanner is enough". R-16 struck the scanner clause, because the third instance below shows what that clause licenses._
    - **Instance (i), 2026-09-18:** the leg register's evidence collector stripped TypeScript comments with a regex over raw text, and a `/*` inside a `//` comment was armed for weeks before a JSDoc block elsewhere in the file fired it. Its replacement was first proposed as TypeScript's *scanner*; the scanner was then observed mis-reading a regex literal containing quotes -- **the proposed fix carried the same defect one level down**, and only the parser resolved it. That second half is the reason for the clause about scanners.
    - **Instance (ii), carried into the `scripts/` survey so the survey inherits the note rather than rediscovering it:** nothing validates SQL fragments quoted in prose. The duty-flag lint strips string literals and comments before matching, so documentation is structurally invisible to it, which is how the frozen-migration corrections section came to prescribe `IS NOT DISTINCT FROM NO` -- a form that does not compile, in a section whose purpose is correcting a form that does not compile. Survey item 2.
    - **Instance (iii), and the strongest of the three -- the correction itself (R-2026-09-18-16).** R-2026-09-18-15 prescribed `ts.createScanner` over `ts.createSourceFile` on cost grounds, as the fix for instance (i). A scanner has no parse context, so it cannot tell a regex-literal `/` from a division `/`; on a regex from `tests/compliance/leg_coverage.test.ts` it produced a string token beginning inside the regex. **The root survived one round of correction because the correction reached for a tool that does not fully parse the language.** Caught by running the prescribed mechanism before trusting it, not by reading it.
    - **How to apply:** before a tool decides what is code, a comment, a string or a statement in some language, ask which parser made that decision. If the answer is a regex or a scanner, the tool is guessing, and its guess changes silently whenever the input's shape does.
    - **What it does not say:** that every regex over source is forbidden. A regex matching a fixed token in a known position -- a filename, a key -- is fine. The note binds when the tool must know the language's *structure* to be right.

18. **A negative result is evidence only once the method has been shown to produce a positive one** (R-2026-09-18-17). A search that returns nothing, a scan that reports clean, a test that passes: each needs a control demonstrating that the same method, on the same surface, can return a hit. **This is the plant convention generalised from guards to searches.**
    - **Instance, 2026-09-18:** the `.dev.vars` history search across 59 refs, the stashes and the reflog found nothing. It was evidence only because a control search, run unprompted, found `.dev.vars.example` and `wrangler.toml` in a stash's untracked-files commit, proving that the search reached stash content.
    - **Instance, standing:** plants both ways on every guard. The untracked-`.dev.vars` leg in `tests/compliance/no_secrets.test.ts` is its newest form: a green that is evidence only because the same bytes, tracked, go red.
    - **Instance, 2026-09-19:** "push protection is enabled" is a configuration fact with no positive observed, so it is recorded as ENABLED and not as coverage.
    - **How to apply:** before reporting absence, name the known-present thing the same method found.
19. **Read state, never assert it** (R-2026-09-19-19). The state of a system that can be read is read before it is relied on: a PR's merged status, a repository or account setting, a deployment, a branch head, a runbook entry recording a step already done. **Where it cannot be read in the moment, the claim is marked UNVERIFIED rather than stated.** The sibling of note 16: that note binds identifiers, and this one binds state.
    - **All four instances so far are Cowork's, within two days:**
      - 2026-09-18: R-2026-09-18-15 sequenced #37 as still to merge, when it was already at `92c79e5`;
      - 2026-09-19: R-2026-09-18-17 A5 proposed enabling push protection, which had been enabled since 2026-09-10, as the runbook said;
      - 2026-09-19: the custom-domain cutover's state was relayed without being read, and it stays UNVERIFIED in this record;
      - 2026-09-19: R-2026-09-19-20 C2 stated that the ward console "now routes through" the proxy. That was inferred from an uncommitted addendum's text, and nothing in the repository sets the console's base URL (R-2026-09-19-21 C3).
    - **How to apply:** a ruling that depends on state quotes the read that established it, or says UNVERIFIED.
20. **A citation is bound to the kind of page it came from** (R-2026-09-19-22). A tutorial's recommended value states what to CHOOSE, not what is AVAILABLE. Only an availability matrix establishes what a plan permits. **Where the two are conflated, the claim is marked NOT CONFIRMED rather than DOCUMENTED.** The sibling of note 14: that note binds a citation to the platform variant, and this one binds it to the page's purpose.
    - **Instance, 2026-09-19:** "action is Block; no Log-only or Managed Challenge on Free" came from a use-case tutorial ("On Free plans, select Block") and was issued as DOCUMENTED. Checked against Cloudflare's availability table and rule-parameters page, it was not there. The parameters page implies challenge actions exist on Free. Withdrawn by Cowork.
    - **How to apply:** before recording a platform limit, name the page type it came from. If it is a guide, a tutorial or an example, the claim is DOCUMENTED-guidance at most.
21. **Rulings BATCH; they do not each take a pull request** (R-2026-09-20-34 A4). They accumulate and land **weekly, or alongside the code change they govern — whichever comes first.** First weekly deadline 2026-09-27.
    - **Why:** 16 pull requests since #37, 10 of them record-only — 62%. *"The record is a control, not a deliverable."* A process that spends two thirds of its pull requests describing itself is running on itself.
    - **The cost, carried rather than hidden:** in the interval a ruling lives only in a transcript, which note 15 calls a defect. The batch is therefore bounded by a date, and the pending text is held where a new session finds it before it starts work.
    - **Why this is minted despite R-2026-09-19-23 B3's standing preference** against a twenty-first note nobody reads: this section IS how rulings reach the implementer, and A4 changes that mechanism directly. It is not a new rule about the work; it is a new rule about this list.
22. **A finding becomes an OPEN ITEM WITH A NAMED TRIGGER, never work** (R-2026-09-20-34 A5, R-2026-09-20-35 A4-A5). Until facility one is onboarded, nothing new enters scope.
    - **An item with a trigger is not work until its trigger fires, and a quiet queue is not a trigger.** A queue with nothing urgent in it is the condition under which scope creeps, not a licence to start.
    - **It binds Cowork as well as the implementer.** Several late-session additions were a hold being extended when it was one command from closing.
    - **How to apply:** write the trigger next to the finding. A finding with no named trigger is either work now or is not recorded at all — those are the only two honest states.
23. **A probe written to catch a category can itself belong to that category. Every probe gets a demonstrated failing case** (R-2026-09-21-40 C). A verification step is only evidence once it has been shown to give **opposite verdicts on a defective artefact and a correct one**. Where the failing half cannot be produced, **the step says so** rather than implying it was checked.
    - **Instance, 2026-09-21, and it is the sharpest one this record has:** runbook step 8 used `curl -X HEAD`, which **returned exit 0 against the PRE-FIX artifact** — the SPA fallback sent a body for curl to consume — and **failed 8 of 8 against the correct one**. *The probe worked only while the defect it guards existed.* It shipped inside the change whose commit message named this very shape.
    - **Instance, same day:** the step's stop condition was that GET and HEAD **agree**. A path with no Function returns `text/html` for both, so **parity passes on a route that lost its Function entirely**. A relation is not a value; the fix was to name the absolute values.
    - **Instance, same day:** a read-back whose stated PASS was two header values that `failure()` emits verbatim, so every 500, 502 and 503 satisfied it.
    - **How to apply:** before recording a probe as evidence, run it against something known-broken and paste what it said. **A green from a probe with no demonstrated failing case is the same artefact as a green from a probe that examined nothing.** This is note 18 (*a negative result is evidence only once the method has produced a positive one*) turned on the instrument instead of the corpus.
24. **An observable that returns the same value in both states is not a probe, however exact the value is** (R-2026-09-21-42 A2). Note 23 asks whether a probe has been *seen* to fail. This one asks something prior and cheaper: **can the thing it reads even take two values here?** Where it cannot, no amount of running it will produce the failing half, and the step is not merely unproven — it is unprovable, and will sit in a runbook being ticked.
    - **The instance that produced it:** runbook step 6 required `cf-cache-status: HIT`. `cf-cache-status` reports the **zone CDN's** decision, and Cloudflare documents the zone cache and the Function's Cache API as **independent mechanisms**. For a `.json` path with no Cache Rule the zone's decision is `DYNAMIC` on every request, hit or miss. MEASURED on `openbed.ng` 2026-09-21: DYNAMIC twice, with the Function's cache in an unknown state. **The stop condition could not have been met by a working system or a broken one.**
    - **It is not the same finding as note 23's.** Step 8's `curl -X HEAD` gave opposite verdicts — just the wrong way round. Step 6's header gave the *same* verdict always. A probe can fail by discriminating backwards or by not discriminating at all, and the second is quieter, because nothing ever looks anomalous.
    - **The tell is a reading taken from the wrong layer.** The step named a cache; the header described a different cache one layer out. Wherever a probe reads a value that some *other* component emits, ask what that component would say in each of the two states before asking what it says now.
    - **-40 had already written the limitation down** — *"`cf-cache-status: HIT` does not say which cache answered"* — and left it as the stop condition anyway. **Naming a limitation is not acting on it.** When a step's own prose admits it cannot distinguish the thing it is for, that is the finding, not a caveat.
    - **How to apply:** for each stop condition, write the value it takes when the system is BROKEN. If that is the same string, or if you cannot say, the observable is wrong and no rewording of the step fixes it — something has to start emitting the difference. Here that was a response header the Function sets from what it actually did, pinned by `tests/compliance/runbook_cache_probe.test.ts`, which executes the step's own grep against both blocks and asserts they cannot be confused.

25. **A control for a hazard class must cover every path that can render in that class** (R-2026-09-21-44). Note 24 asks whether an observable can take two values. This one asks something else: **the control was correct, ran on every PR, and pointed at one of the two renderers.**
    - **The instance.** R-2026-09-20-29 E2 relocated the empty-city assertion to the RENDERED SURFACE — the right move, and `tests/compliance/dashboard_empty_state.test.ts` implemented it faithfully. It rendered `renderReal` and asserted the text a visitor reads. **It never rendered `renderStub`.** So the path that fabricated bed counts, on the same page, in the same module, behind one `if`, was the one path in the hazard's own control file that no test ever executed. It shipped to a live public domain and was found by a sweep, not by the suite.
    - **Why a green suite said nothing.** Every leg passed, and each was about the renderer it named. A reader checking "is the empty-city hazard covered?" sees a file called `dashboard_empty_state` with four green legs and stops. **Coverage of a class is not the union of the legs anyone happened to write.**
    - **How to apply:** when a control is written for a HAZARD rather than for a function, enumerate the paths that can produce that hazard and name each one in the control's header — covered, or NOT ASSERTED and why (test-conventions section 4). For a renderer: every branch that can call `replaceChildren`. **The question is not "does the control pass", it is "which paths has it never run".**

---

## What this record changes, and what it does not

**Changes:**
- the IP-derived step of v1:245 is retired (D4);
- an open processor-obligations list now exists (R3);
- one row is added to the runbook's un-automatable table (D2);
- later on 2026-09-14, O3 moved to a new section, *Blocks facility-one
  onboarding*, as B1, because migration 014 makes publishing possible once
  applied hosted;
- later on 2026-09-14, the rulings on migrations 014 and 015 (M1–M3) and the
  gating conditions A–I are recorded here;
- on 2026-09-15, the review of #23, the six items required before 016, 016's
  derivation constraint, and the method notes on how rulings reach the
  implementer;
- later on 2026-09-15, 016's rulings: the constraint corrected to two clauses,
  the five decisions, the RLS control actually adopted, owner-only EXECUTE, the
  dead `service_role` grant in R2, the stale frontier line, and method note 5;
- later on 2026-09-15, the follow-ups (R-2026-09-15-06 and -07): the reader
  policy, C2's bounded acceptance, the count-check correction, and closed items;
- later on 2026-09-15, the hosted role rows (R-2026-09-15-08): H1 the hold
  lifted, H2 item (2) closed with its owner half pending the post-apply read, H3
  §4 closed, the policy restated as defence in depth, the prune DELETE checked
  and dropped, and method note 5's second instance;
- later on 2026-09-15, R-2026-09-15-09's follow-ups: method notes 6 (a sweep
  targets the tense, not a phrase) and 7 (an explanation carrying a decision is
  a premise too), with the instance-count row, the harness comment and the
  supautils dependency corrected in the v2 kickoff, `tests/e2e/_harness.ts` and
  the runbook;
- later on 2026-09-15, R-2026-09-15-09's ruling block, and R-2026-09-15-10's
  amendments: A1 (finding 6 in the family; the instance counts VERIFIED), A2 (the
  unit stated, the recount to 70 / 5 / 9 / 5 / 7, the enumeration committed), P1 (the
  ratchet mechanism) and P2 (superuser by default; GRANT SET ON PARAMETER named),
  and the 2026-09-15 rulings handoff moved into `docs/`;
- on 2026-09-16, the hosted apply of 014–016 (R-2026-09-16-01/02): H2 closed in
  full, the reader policy observed live hosted, C2's boundary observed by the
  three-`DO`-block echo, hosted recorded at 001–016 with every present-tense
  statement corrected, and the runbook's new reader-policy check;
- on 2026-09-16, the frozen window (R-2026-09-16-03): the freeze rule restated as
  a criterion with one recorded boundary, the live-rule/dated-record discriminator
  as method note 8, R-02's sweep instruction corrected rather than executed, and
  the frozen-migration guard with its recorder and runbook step;
- on 2026-09-16, #29 verified and merged (R-2026-09-16-04): what was verified
  independently, why the guard carries a contiguous-prefix and ledger-count check
  beyond the hash set, and the R-03 premise the founder corrected as their own;
- on 2026-09-16, migration 017 (R-2026-09-16-07 to -10): the route, the rollup
  job closing v2's finding 1 with its repair and the probe that justifies it, the
  withdrawn kickoff claims, suite isolation and condition F as two mechanisms,
  the R-04 watch item carried in, and a supersede note on decision 1's "stays OPEN";
- on 2026-09-16, R-2026-09-16-11 and -12: the pause widened from migration to end
  of run through `scripts/seed.sh`, its leg and plants, the frozen_migrations
  placeholder recorded as OWED, R-11's two premises checked and recorded as
  failed, and the kickoff's three contradictions corrected by Cowork;
- on 2026-09-16, R-2026-09-16-13: #31 approved, and the kickoff's miscounted note,
  line-number citation and incomplete blast radius fixed by Cowork;
- on 2026-09-17, the hosted apply of 017 (R-2026-09-17-01): hosted at 001-017 with
  both jobs live and succeeding, the frozen boundary at 17 with the placeholder
  moved to 018, and the runner's dead-connection refusal recorded as a control
  that fired on a real hosted apply;
- on 2026-09-17, the v1 sweep (R-2026-09-17-03 and -04): the enumeration committed
  and the v1 kickoff marked, two mechanism checks run (`is false` does not compile
  against `app.tri_state`; an anon subscriber receives `ward_public` change
  events), the duty-flag lint's stated reason and correct-forms list corrected
  along with the SOP self-check, four corrections to frozen migrations recorded in
  `database/migrations/README.md`, and three design rulings left open;
- on 2026-09-21, R-2026-09-21-41 (issued inside R-PROVISIONAL-2026-09-21-Z, part
  D1): the design constraint that roles stay table lookups enforced in definer
  functions and the custom access token hook stays off, **verified against the code
  before being recorded** — `assert_member` is SECURITY DEFINER and derives identity
  from `auth.uid()`, the hook is entirely commented out, and the 25-hour revocation
  window the reason invokes is measured rather than reasoned; with two qualifiers
  kept rather than smoothed, that the deactivation tests use a forged claims blob and
  that nothing reddens if the hook is switched on;
- on 2026-09-21, R-2026-09-21-40 (issued as R-PROVISIONAL-2026-09-21-Z, with its
  addendum and an amendment to part B): Cowork withdrew its own part B, which had
  sequenced 018 on a gate paraphrased from a handoff; the EVIDENCE gate of -28 B
  restated as **four observations, all on `openbed.ng`**, none of which a
  `*.pages.dev` report can discharge; and a sweep of the Pages runbook after its
  GET/HEAD probe was found to **belong to the category it was written to catch** —
  `-X HEAD` passing only against the broken artifact, a parity stop condition that a
  whole-route fallback satisfies, and a read-back whose stated PASS every failure
  response met verbatim; with three stale statements fixed in the same file,
  including a step that still forbade the founder's next action;
- on 2026-09-21, R-2026-09-21-39 (issued as R-PROVISIONAL-2026-09-21-Y): the
  `packages/fixtures/public-relations.json` split — `mirrors` retired and replaced
  by `clientAddressableRelations` and `realtimePublicationMembers`, identical in
  content and different in meaning, so that 018 edits two lists that already say
  what they are; the reason recorded with the names, including why neither is
  called an allowlist; and **nothing asserting that the two agree**, because that
  assertion is the coincidence the split exists to remove;
- on 2026-09-21, R-2026-09-21-38 (issued as R-PROVISIONAL-2026-09-21-X): #54
  merged at `4803d20`, with the head SHA read from the API, `MERGED` read back
  before and after the branch deletion, and the deletion kept a separate action;
  the three post-merge checks discharged against the merged tree with their
  evidence kinds and a positive control; W recorded as ruled-and-not-yet-deployed,
  because the merge is not the deploy; three open items given triggers; and the
  implementer's own Standard O grade on the #54 `db-tests` red corrected from
  **proven** branch (ii) to **INFERRED**, a clean re-run being evidence of
  intermittency and not of cause;
- on 2026-09-21, R-2026-09-21-37 (issued as R-PROVISIONAL-2026-09-21-W): Cowork's
  own mechanism claim for the HEAD fix failed verification against Cloudflare's
  Cache API reference — `cache.put` throws for a non-GET request, so the proposed
  two-line alias would have thrown on every HEAD, into the same `catch` the change
  adds for the rare case; the fix is the GET-normalised cache key, with the body
  stripped by this code rather than left to the runtime; and three findings from
  the implementation — the `curl -sSI` was checked into the runbook rather than
  only relayed, `serve.ts` cited an ESLint Date ban that does not exist, and
  -33 B6's premise is qualified because `serveBeds` is total and cannot throw
  into a widened catch;
- on 2026-09-20, R-2026-09-20-36 (issued as R-PROVISIONAL-2026-09-20-V): the
  deployment report accepted with its fourth clause as a reading rather than an
  assertion, re-measured independently before being recorded; the cutover hold
  lifted, Bundle 2's gate discharged, and a route found to answer differently by
  method, folded into the cache fix rather than opened as new scope;
- on 2026-09-20, R-2026-09-20-35 (issued as R-PROVISIONAL-2026-09-20-U): a ruling
  against ceremony that reprinted the full queue inside itself — the same shape as
  -33 B3, one document later, which is the evidence that prose self-inconsistency
  is a limit rather than a lapse; and the path named end to end, cache fix then
  Bundle 2, whose first task is the `packages/fixtures/public-relations.json`
  split;
- on 2026-09-20, R-2026-09-20-34 (issued as R-PROVISIONAL-2026-09-20-T): rulings
  batch rather than each taking a pull request, bounded by a weekly deadline of
  2026-09-27 and carrying its own cost openly — 16 pull requests since #37, 10 of
  them record-only, recounted rather than repeated; no new scope until facility
  one, every finding becoming an open item with a named trigger; and the
  prose-self-consistency limit named as the most important thing recorded that
  day;
- on 2026-09-20, R-2026-09-20-33 (issued as R-PROVISIONAL-2026-09-20-S): the cache
  hole ruled as a control whose stated scope exceeds its coverage, and sequenced
  merge-deploy-fix on a severity comparison — the live empty-city page is
  patient-facing and an untagged error response carrying no bed data is not; the gap
  recorded against the deployed artifact **without a commit SHA**, because the deploy
  had not happened; and the exhaustive claim found to be in the runbook and in -32's
  own block rather than in the module header, three paragraphs from the finding that
  disproves it;
- on 2026-09-20, R-2026-09-20-32 (issued as R-PROVISIONAL-2026-09-20-R): the
  preview-deployment probe declined on reasoning rather than cost — a failing
  `/beds.json` carries no bed data, so indexing it costs little — and recorded NOT
  OBSERVED AT THE EDGE with the condition that would reopen it; the failure bodies
  read instead, finding that none echoes a value, that two catch-alls are generic
  where a `SyntaxError` would otherwise republish the upstream text, and four
  unasserted gaps, closed here; and one scope change reported rather than fixed —
  `serveBedsCached`'s cache calls sit outside any `try`, so an exception there
  bypasses the failure builder and its headers;
- on 2026-09-20, R-2026-09-20-31 (issued as R-PROVISIONAL-2026-09-20-Q): a deployed
  `dirty: true` recorded as evidence that the deploy wrapper was BYPASSED; the leg
  register's mapper recorded as having shaped the tests it measures, which widens the
  regex-readers change to re-check code written under it; and the deployment report
  given three read-backs from the deployed surface, with the failure-response header
  reported as unobservable in production without breaking it;
- on 2026-09-20, R-2026-09-20-30 (issued as R-PROVISIONAL-2026-09-20-P): the
  deployment report's fourth clause turned from an attestation into a READING, by
  stamping the commit into the artifact as `/version.json` and adding a deploy
  wrapper that refuses a dirty tree or unmerged code; git integration recorded as the
  candidate root fix with its costs; `run_e2e.sh` made to discover its corpus after
  it was found to run two named files while a required check reported success; the
  proxy review renamed the infrastructure inventory and review, now covering three
  unaccounted items; the publish screen's raw-error echo gated on facility-one
  onboarding; and a merge-order rule after two pull requests in flight left one
  behind;
- on 2026-09-20, R-2026-09-20-29 (issued as R-PROVISIONAL-2026-09-20-M): the H and J
  texts supplied and filled in; the custom-domain cutover HELD, recorded in the
  runbook's own step, because the cutover would publish the empty-city page to a real
  domain; the empty-state rule restated to bind AT THE RENDERED SURFACE and made a
  blocking review criterion; Bundle 4's scoping drift corrected; `robots.txt` and
  `X-Robots-Tag` recorded as controls that reach the accumulation boundary, since a
  polite crawler archiving `/beds.json` builds the series this sprint prevents; and a
  NOT CONFIRMED claim must now name what would close it;
- on 2026-09-20, R-2026-09-20-25 through -28 (issued as R-PROVISIONAL-2026-09-20-H,
  -J, -K and -L): the Pages project recorded as direct-upload, so merging deploys
  nothing and deployment is decoupled from review; the backup branch holding the
  deployed code recorded as frozen and ungated; **the empty city** — the public path
  live with no facility onboarded, and the rule that a public surface must
  distinguish "no facilities onboarded" from "no beds available"; the `noindex` item
  made urgent, with no `robots.txt` found; 018 held behind the EVIDENCE gate as well
  as the decision gate; the `public-relations.json` split accepted; and a provisional
  ledger so a lost block is a lookup;
- on 2026-09-19, R-2026-09-19-24 (issued as R-PROVISIONAL-2026-09-19-F): the
  founder's REVOKE decision recorded against R-2026-09-17-09 D, taken after the C4
  trace returned, with its five strands of reasoning and the v1:258 objection kept;
  what migration 018 carries, including the three test re-points inside its own
  change; and the boundary recorded as closing on the HOSTED APPLY rather than on
  merge, in the runbook's apply step as well as here;
- on 2026-09-19, R-2026-09-19-23 (issued as R-PROVISIONAL-2026-09-19-D): the
  verification rule in method note 2 widened to all of Cowork's factual claims, with
  the "confirmed at <ref>" clause; the kickoff's `feefcf3` line recorded as Cowork's
  false verification, with the implementer's share (landed unverified); Cloudflare
  listed as a sub-processor for API traffic, scope to follow from the review; the
  proxy review scoped (D0-D8), criterion first and "remove" by default;
- on 2026-09-19, R-2026-09-19-22 (issued as R-PROVISIONAL-2026-09-19-C): method
  note 20 and the evidence-kind rule for external-platform claims (note 2 amended);
  B1's action line withdrawn by Cowork; the single Free rule placed on `/beds.json`,
  with a fifth scope line: a 10-second window cannot address accumulation; A2's
  consequence corrected, because three tests probe `ward_public` as `authenticated`;
  a false golden-path fact in the Bundle 2 blast radius corrected; the `.env.production`
  carve-out rejected and Finding D's fix given a home; the proxy review unblocked, with
  its shape proposed;
- on 2026-09-19, R-2026-09-19-21 (issued as R-PROVISIONAL-2026-09-19-B): the
  Free-plan rate-limit parameters landed in the Pages runbook, each labelled
  DOCUMENTED, CHOSEN or NOT CONFIRMED, with the CGNAT reason and the instruction to
  raise the threshold rather than remove the rule; `my_facility_wards` read as
  SECURITY DEFINER, reading no mirror, so the console as built survives 018's
  revoke; the console's unrecorded API origin recorded as a finding; method note
  19's fourth instance;
- on 2026-09-19, R-2026-09-19-20 (issued as R-PROVISIONAL-2026-09-19-A): ruling
  numbers assigned by the recorder, not Cowork, with method note 1 amended; -18
  recorded VOID; the Free-plan rate-limit parameters recorded as missing and owed;
  the api.openbed.ng contradiction and the TEST-NET-1 apex recorded as a finding and
  an inference; the proxy's review questions recorded unanswered; and a trace of
  every route to the mirrors made a precondition on 018's revoke half;
- on 2026-09-19, R-2026-09-18-17 and R-2026-09-19-19: a LOCATION check for
  credential files added to `scripts/lint_no_secrets.sh`, with the reverted
  content-scan attempt recorded as part of the ruling and encoded as a leg;
  `.dev.vars.*` ignored and denied after the pinned wrangler was found to load it;
  the three controls on a credential file stated with their failure modes; A5's
  premise recorded as failed, because push protection has been enabled since
  2026-09-10, and the OWED step made a documentation check; #39's cache wording
  tightened before its merge; foreign working-tree edits left untouched; method
  notes 18 and 19;
- on 2026-09-18, R-2026-09-18-16: `.dev.vars` ignored on main after a history check;
  method note 17 amended to say parser, with the scanner prescription as its third
  instance; the two remaining regex readers given a named follow-up PR; R-12's two
  OWED runbook steps ordered behind the custom-domain cutover; and Bundle 1's
  definition of done split on that line;
- on 2026-09-18, R-2026-09-18-15: the leg register's evidence collector moved from a
  regex comment-stripper to TypeScript's parser (the scanner, as first proposed, was
  observed mis-reading regex literals), with the instrument-leg parser moved onto the
  same parse under its own residual note; the defect recorded as latent and armed, not
  active, with main's register reproduced exactly; plants in both directions; and
  method note 17;
- on 2026-09-18, R-2026-09-18-13 and -14: handoff documents authored into `docs/`
  and the staging area retired; the two owed handoffs landed byte-identical, with a
  superseding note for the second's rate-limit line; the item-7 report's overstated
  scope recorded; the fabricated SHA and the open-PR branch deletion recorded as two
  distinct errors, one contained by a guard and one by luck; method note 16; and
  three git-operation rules added to `.claude/rules/code-pipeline.md`;
- on 2026-09-17, R-2026-09-17-09 to -12: the A1 accumulation-boundary sprint
  scoped and its kickoff committed; #36 merged and the kickoff's base SHA corrected;
  Bundle 1's definition of done split by performer with six founder steps OWED;
  Bundle 2's gate corrected to the deployment report; the rate limit moved out of
  code because the Rate Limiting binding is not available to Pages Functions; the
  deploy token declined; and method notes 13, 14 and 15;
- on 2026-09-17, R-2026-09-17-08: the accumulation boundary named as the root above
  E2 and E3 — the design prevents history being READ and not being ACCUMULATED, with
  a bare anon table read returning every row in one request and offset paging working;
  the sequencing re-ruled to ONE sprint covering both the database and edge halves;
  the founder-side line narrowed to history-is-private; survey item 2 added; and
  method note 12;
- on 2026-09-17, R-2026-09-17-07: E1 retracted as overstated (008 already defends that
  payload; the k-floor protects a quiet facility's numbers, not its identity), E2's
  delta measured against polling the mirrors and recorded as conditional on write
  rate, the missing data-API rate limit recorded as its own finding, the founder-side
  blocker rewritten from quiet mode to history-is-private, method notes 10 and 11,
  and notes for frozen 008 and 013;
- on 2026-09-17, R-2026-09-17-05: #33 merged untouched at its reviewed head; B5's
  external caller ruled (Cloudflare Pages Functions) and its seven markers moved
  from open to ruled; the GREEN-tile property ruled and recorded as a Bundle 4
  obligation; Realtime on the public mirrors left unruled, with the DELETE and
  accumulation probes run and their root recorded — the negative suite asserts what
  anon can pull and nothing asserts what anon can be pushed; method note 9; and
  `scripts/` survey item 1 recorded.

**Does not change:**
- v1:250 and v2:273 (O1);
- the snapshot and caching design (R2);
- any schema, projection, code or test;
- the hold on migration 014.
  - _Released later on 2026-09-14; see the note at the top of this record._

