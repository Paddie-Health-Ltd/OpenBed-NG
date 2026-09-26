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
  **AMENDED by R-2026-09-23-71 D:** the redirect list is exactly
  `https://app.openbed.ng` and `https://admin.openbed.ng`.
  **AMENDED again by R-2026-09-23-72 AZ-1:** the redirect entries carry the
  trailing slash the apps send, `https://app.openbed.ng/` and
  `https://admin.openbed.ng/`; the Site URL stays `https://app.openbed.ng`.
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
| Cloudflare — **Data Sub-Processor for API traffic** via `api.openbed.ng`, under its standard DPA (the founder's decision, 2026-09-19) | **Scope to be completed from the proxy review's findings, not written ahead of them:** the fields that traverse the Worker and whether any are patient-identifying or patient-adjacent; whether the platform retains request metadata; the processing regions. **A second purpose, now ENDED (R-2026-09-25-119 CU-4 a):** Cloudflare **Web Analytics (RUM)** was enabled zone-wide on `openbed.ng`, and it collected page-view data from `openbed.ng` visitors. There, unlike on admin and the ward console, no CSP blocked its beacon (the public page shipped no CSP until 2026-09-25). **It was switched off by the founder on 2026-09-25. Its start date is NOT KNOWN** from anything in this repository. It is cookieless. With no facility listed, the visitors were almost certainly our own testing. **The dashboard offers no deletion of the collected data.** This feeds the founder's processor pack | Sub-processor listing under the standard DPA; the s.41 transfer basis is a distinct instrument | R-2026-09-19-23 D2; R-2026-09-25-119 CU-4 a |
| Email provider: **Proton (Proton AG, Switzerland)**, sender `support@openbed.ng`. **Custom SMTP and its written processor agreement, ONE item** | Magic-link and escalation mail | **Restated 2026-09-25 (R-2026-09-25-108):** custom SMTP is configured, through Proton (H3). **Still open:** the s.29 written processor agreement, the s.41 transfer basis and log retention, all PENDING the founder's approval. They are tracked in the founder's paperwork register, items 1 and 4, which is outside this repository. **The gate (CJ-2):** the agreement gates facility one, so no hospital or ward address is sent a link until it is approved. It does not gate H6: at H6 the only address Proton sends to is the operator's sign-in address, Paddie Health's own role address in a mailbox Proton already hosts. **Until 2026-09-25 this cell read:** **A prerequisite for facility one** (2026-09-14). Custom SMTP must be configured, AND the NDPA s.29 written processor agreement executed with whichever provider it uses. They are one item because whatever sends the links is the processor (v2:323), so configuring the sender is choosing the processor. The built-in sender returned HTTP 429 on the fourth OTP request of a single sitting, so it cannot carry even the runbook's own verification procedure. The s.41 transfer basis and log retention are as recorded at clauseX:123 | Runbook step 9, run on 2026-09-14 (`docs/runbook-supabase-project-creation.md`); v2:322/323; clauseX:123 |
| Supabase (the database, Auth and PostgREST, project `klrlpxysjsjpdkeqdhvl`, region `eu-west-1`) | Every row the system holds, including the one named person per facility in `app.facility_contact`, and the login addresses in `auth.users` | s.29 written processor agreement; s.41 transfer basis; retention | Added 2026-09-24 (R-2026-09-24-76 BD-4, on BC-7's check): until this row Supabase was named as a processor nowhere in the record or in any tracked file |

### Hosted objects this repository does not create — this record is where the list lives

_Started 2026-09-24 (R-2026-09-24-77 BE-2). Each entry was found on hosted, is created by no migration, and is kept, not dropped. An entry names what it does, where it was first recorded, and the control that stands in its place._

| Object | What it does | Recorded | The control that stands |
|---|---|---|---|
| Event trigger `ensure_rls` (`ddl_command_end`; CREATE TABLE, CREATE TABLE AS, SELECT INTO) and its function `public.rls_auto_enable()` (owner `postgres`, SECURITY DEFINER, returns `event_trigger`) | Supabase's automatic RLS: runs `ENABLE` (not `FORCE`) ROW LEVEL SECURITY on each new table in schema `public`, and nothing else | R-2026-09-22-55 D3 (as hosted-only drift) and -56 A7 (scope, grants inert); its grants ruled into `packages/fixtures/function-grants.json`'s `hosted_only` section by -77 BE-1 | `scripts/lint_public_table_rls.sh`: every public table is ENABLED **and FORCED** in the migration that creates it (-56 C), so the local suite never runs against a database looser than hosted |

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

**E — BOTH ARE MUST-FIX BEFORE FACILITY ONE. Not Bundle 4, not post-facility-one.** They join R-2026-09-20-30 D1 (the publish-screen raw-error echo) as onboarding blockers. **[AMENDED 2026-09-21 by R-2026-09-21-45, left as written per method note 8: "before facility one" is an occasion somebody decides has happened. The trigger is now THE FIRST `app.facility` OR `app.ward_account` ROW on the hosted project, whatever the reason for creating it, and it is stated on the provisioning path rather than only here.]**

- **A3 — `'(unknown facility)'` beside a REAL bed count** (`apps/public-dashboard/src/main.ts`). **Severity: a count with no callable identity rendered as if actionable.** A row reading `(unknown facility) — ICU_ADULT: 6 beds` tells someone routing an ambulance that six beds exist somewhere they cannot ring. **Not decided here.** The options, with their consequences, for whoever takes it: suppress the row with an operator-visible signal — loses a real count and needs somewhere for the operator to see the gap; or render the gap in words pointing to 112 / 767 — keeps the reader informed but occupies a row. Cowork's lean is recorded: **a count with no callable identity must not render as if actionable.**
- **B2 — `wardRowFrom`'s defaults** (`apps/ward-console/src/main.ts`). **Severity: a defaulted clinical claim and a guessed concurrency token.** `offering: r.offering ?? 'NOT_OFFERED'` asserts to a ward that it does not offer a ward the server said nothing about; `version: r.version ?? 0` flows straight into `p_expected_version`, turning optimistic concurrency into a guess. **Ruled shape: refuse the malformed row — never default a clinical claim or a concurrency token.** Bundled with D1: same screen, same refusal-handling design.

**F — ONE MORE SWEEP FINDING, REPORTED AND NOT NEW SCOPE.** `packages/snapshot/src/freshness.ts` implements the GREEN/YELLOW/GREY/SUPPRESSED bands and `packages/snapshot/src/index.ts` does not export it; `main.ts` never imports it, and `renderReal` renders `bed_count` with no age check. **A three-day-old count renders identically to a 30-second-old one** — the exact string the shape fixture calls out as the thing not to do. This is Bundle 4's subject matter, already scoped there, and is recorded here because the sweep found it rather than because it is new.

**G — THE SEQUENCE (AA C):** this change; founder merge; **one** deploy of that merge commit through `scripts/deploy_pages.sh --branch main`, quoting `/version.json`; the outage state read back where it can be reproduced; **then** step 6 on that same deployment. **018 stays behind the EVIDENCE gate throughout.**

**H — R-2026-09-21-43 C2 is discharged by this change**, and its block is left as written with a note (method note 8).


---

### R-2026-09-21-45 — the go-live trigger becomes a row, and moves to the path that creates it

_No provisional letter; a direct founder instruction following AA._

**A — THE AMENDMENT.** `-44 E` gated three items on "before facility one". That is an occasion somebody decides has happened. It becomes a fact anyone can read:

> **Before the FIRST `app.facility` row or the FIRST `app.ward_account` row is created on the HOSTED project, whatever the reason for creating it** — a test, a staging trial, a signed agreement or none.

**Why the row and not the occasion, in the founder's own reasoning:** onboarding can be staged, and an account created "just to try it" puts all three defects live before anyone intends it. **Read on the hosted project at landing, 2026-09-21 16:58 UTC: `app.facility` 0, `app.ward_account` 0, `app.facility_contact` 0, `app.invite` 0.**

The three are unchanged — A3 (`'(unknown facility)'` beside a real bed count), B2 (`wardRowFrom` defaulting a clinical claim and a concurrency token), and R-2026-09-20-30 D1 (the publish screen's raw server text), which bundles with B2 as the same screen.

**A2 — the trigger deliberately fires EARLIER than the defects become reachable.** A3 needs a row to reach the *snapshot*, not merely to exist. Gating on the first row is the safe direction and costs nothing while the tables are empty. Stated so it is not later read as imprecision.

**B — PLACEMENT, AND A PREMISE THAT FAILED ON CHECKING** (method note 20). The instruction was to put it "at the top of the provisioning path (`scripts/provision_ward_account.mjs` and the facility-creation step in the runbook)".

**There is no facility-creation step in any runbook.** The three runbooks are the Supabase project creation one, the Pages one and the key-rotation one; none has an onboarding or facility-creation step, `provision_ward_account` appears in **no** file under `docs/`, and no written procedure exists for creating the first facility row. **Facility-one onboarding has been called "founder-side" in six handoffs and has never been written down.** The instruction survives; the placement adjusts:

1. **`scripts/provision_ward_account.mjs`** — the ward-account half, and the strong one: its own header says *"nothing else in the repository creates it … the only sanctioned way to create a ward account."* The STOP block is now the first thing in that file after the banner, and the `Exit:` line says explicitly that **exit 0 does not mean the condition was satisfied**.
2. **The hosted runbook, new section 4b** — the facility half, placed beside section 4, *"Backups and PITR — confirm BEFORE any real data exists"*, which is that runbook's existing before-real-data gate. It states the condition and gives a `psql` check with stop condition `0|0`; it does **not** become an onboarding procedure.
3. **Runbook step 8** — found while placing the above, and it is the reason this is not merely tidy. **That step contains the only hosted `insert into app.facility` written down anywhere**, inside a `begin;` … `rollback;`. If that `rollback;` ever becomes `commit;`, or the session dies between the two, **the probe itself creates the first facility row.** The step now says so and carries a post-run re-check with stop condition `0`.

**C — THE CONSTRAINT THAT SHAPES ANY MECHANICAL VERSION, MEASURED.** *"On the hosted project"* is load-bearing, not decoration. `database/seed/001_synthetic_seed.sql` inserts into `app.facility` at three sites and the local database read **8** facility rows while this was written. **A guard keyed on "a facility row exists" fires on every `npm run db:reset`** and is disabled by the next person who hits it — test-conventions' fifth way a leg becomes unprovable, *a guard that refuses legitimate input is disabled by the next person who hits it*.

**D — A FOURTH ITEM GATES THE SAME MOMENT, SPECIFIED AND NOT BUILT.** The invite gate — *"No invite may be issued for a facility whose `app.facility_contact.agreement_accepted_at IS NULL`"* — is specified in the facility-agreement document and unchecked in the v2 kickoff. **Verified with a known-present control:** the column is built (migration 003) and **nothing reads it**; there is no invite-issuing function at all, only the `app.invite` table. **So it is an absence, not a defect**, and it is named in the STOP block because consolidating everything that gates this one moment is the point of the amendment.

**E — THE MECHANICAL GUARD: PROPOSED, DELIBERATELY NOT BUILT.** An open item, with its shape stated so it can be ruled on rather than rediscovered.

- **What:** `provision_ward_account.mjs` refuses when its target is the hosted project **and** a checked-in blockers list is non-empty, so lifting the gate is a reviewed code change rather than a decision taken in a hurry.
- **Hosted-only**, modelled on `scripts/seed.sh`'s host `case` inverted — the pattern is already here, already tested, and `case` forks nothing so it has no third outcome. **Do not invent a second way to answer the same question.** Note the script currently has **no host check at all**: pointing it at hosted is one environment variable.
- **Precedent for the list itself:** `.ci/ci-gate-exceptions.yml`, whose *emptiness* is asserted by a compliance test and whose header says adding an entry must be *"a visible, reviewable act"*. Same shape, opposite polarity.
- **It needs a root argument first.** The script takes only `--flag value` pairs and has no `$1` root, so a refusal reading a checked-in file could not be aimed at a scratch tree — `scripts/freeze_applied_migrations.mjs` is the `.mjs` precedent for an optional trailing root.
- **Honest limits, to be stated in its own header the way `scripts/deploy_pages.sh` does:** LOCAL AND DEFEATABLE, and **it does not cover the Supabase SQL editor or dashboard**, which is how a facility row is most likely to be created by hand. It removes the accident case, not the deliberate one.
- **The stronger option with its cost:** a `BEFORE INSERT` trigger on both tables would cover every path including the dashboard — but it is a migration, 001–017 are frozen, 018 is pending behind the EVIDENCE gate, and it must later be removed. **Not recommended now.**
- **Co-locate it with the invite gate whenever either is built.** Two competing gates on one provisioning path is how one of them gets bypassed.

**F — COWORK'S CITATION ERROR, RECORDED AS COWORK'S OWN**, on the founder's acceptance. AA cited "the product bible's first principle". **The product bible is not in this repository and R-2026-09-21-40 G had already ruled it *"Read as context, never as authority."*** AA stands on R-2026-09-20-29 E alone, **with the product rule recorded as an EXTENSION of E3** — from "never a bare zero" to "never an invented number" — **and not as something E says.**

**G — TWO OPEN ITEMS THIS RULING CREATES, both with triggers.**
- **The mechanical guard above.** Trigger: whenever the invite gate is built, or the first time someone proposes running the provisioning script against hosted.
- **Facility one has no written procedure.** Six handoffs call it "founder-side"; nothing says what it consists of. Trigger: before the first facility row — the same condition this ruling names, which is why it is recorded here rather than filed separately.

**H — `-44 E`'s "BEFORE FACILITY ONE" wording is superseded by note**, left as written (method note 8).

**I — the queue:** unchanged. The founder deploys the merge commit **once**, then runs read-back 5b and step 6 on that one deployment; the EVIDENCE gate is recorded lifted on that output; then 018.

---

### R-2026-09-21-46 — the pull requests batch again; the drift is recorded as the implementer's

_No provisional letter; a direct founder instruction issued on merging #60._

**A — THE FREEZE, IN THE FOUNDER'S FOUR CLAUSES.**

1. **No new pull request** until the founder has deployed and quoted read-back 5b and step 6.
2. **The next pull request is 018**, once the EVIDENCE gate lifts on that step-6 output.
3. **Everything record-only batches into the 018 pull request** — rulings, open items, method notes, runbook wording, findings from the read-backs. **None of it gets a pull request of its own.** The only exception is a safety defect reachable by a real visitor today, **and it must be named as that exception when it is proposed**.
4. **Cowork stops phrasing asks as "own PR"** unless it is that exception.

**B — THIS IS T A4, AND IT IS BEING RESTATED BECAUSE IT WAS NOT FOLLOWED.** Method note 21 has said since 2026-09-20 that rulings batch. **Seven pull requests merged on 2026-09-21** — #54 `4803d20`, #55 `cf8bcd9`, #56 `b137dd1`, #57 `66829eb`, #58 `86c9125`, #59 `12e670b`, #60 `76fe917` — of which **one**, #59, changed anything a visitor could see. The rest were record and guard work that could have ridden together.

**C — THE CAUSE IS RECORDED AS THE IMPLEMENTER'S, not the founder's.** The phrase *"its own PR"* appeared in the implementer's proposals, and the founder then ruled on the shape handed to them. **A ruling that arrives as a question about one pull request is answered as one pull request.** This is note 5 read in the other direction: the implementer proposes the mechanism, so a mechanism that multiplies pull requests is the implementer's to stop proposing.

**D — THE COST, STATED SO THE RULE HAS A REASON AND NOT ONLY AN AUTHORITY.** Each pull request carries a full Standard O fresh-database attestation and a Standard P behavioural ledger. That is right for a change and is pure overhead for a paragraph. **And the stream hides the signal:** #59 deleted fabricated bed counts from a live public domain, and it arrived sixth of seven, indistinguishable in the list from a runbook wording fix.

**E — the queue:** the founder's deploy and the two read-backs; then the EVIDENCE gate recorded lifted on that output; then 018, carrying this ruling and everything else pending.

---

### R-2026-09-21-47 — the EVIDENCE gate is LIFTED on the founder's quoted output; AA is closed in production

_No provisional letter; the founder's read-back of 2026-09-21 evening, against deployment `76fe917`._

**A — ALL FOUR OBSERVATIONS PASS.** The gate of R-2026-09-20-28 B, restated as four observations by Z part B (R-2026-09-21-40) and given its corrected observable by R-2026-09-21-42 E:

| # | Observation | Verdict |
|---|---|---|
| 1 | The apex resolves to Cloudflare, not a TEST-NET-1 placeholder | **PASS** — CNAME to `openbed-public-dashboard.pages.dev`, proxied; the `A 192.0.2.1` row is gone |
| 2 | `https://openbed.ng/beds.json` reaches the Function | **PASS** |
| 3 | The edge headers on that URL | **PASS** |
| 4 | A cache hit on that URL, second request inside 30s | **PASS** — `x-openbed-edge-cache: hit`, `HTTP/2 200`, `application/json; charset=utf-8`, both `cf-ray` codes `-CDG` |

**The failing half was demonstrated in the same sitting:** the request after `sleep 40` reads `x-openbed-edge-cache: miss`, same URL, same artifact, opposite verdict (method note 23). `cf-cache-status: DYNAMIC` was quoted alongside and is neither a pass nor a fail — it is the zone CDN's verdict on a route the zone does not cache.

**018 IS UNBLOCKED.** It is written in the same pull request that carries this ruling.

**B — THE DEPLOYMENT, READ BACK.** `bash scripts/deploy_pages.sh --branch main`, deployment `99e56bc0`, `/version.json` reporting commit `76fe917933df113626dffacac585ed0e3f7bf3b4`, `dirty: false`, built `2026-09-21T17:31:36.867Z`. **MEASURED independently by the implementer** by fetching `openbed.ng/version.json` directly, not taken from the report.

**C — AA IS CLOSED IN PRODUCTION, AND THAT IS A DIFFERENT CLAIM FROM #59 MERGING.** Under direct upload a merge changes nothing a visitor receives; `openbed.ng` served the pre-#57 bundle until this deploy. **MEASURED on the live artifact:** the served bundle is `/assets/index-Dm-dJTYN.js`, 15 204 bytes. Every string and number literal in `packages/fixtures/snapshot-golden.json` was extracted and searched for in it; the only survivors are six structural key names the codec needs — `facilities`, `wards`, `WARD`, `generated_at`, `server_now`, `comment`. **No invented facility name, no coordinates, no `+234` number, no `A_AND_E`, no `stubWards`, no `renderStub`.** Both the outage sentence and the distinct empty-state sentence are present.

**D — READ-BACK 5b PASSES**, with the rendered text quoted by the founder: the outage notice, no bed count, no ward category, no facility name, no list item. With the block removed the empty state renders and is DIFFERENT TEXT — *"No facility has joined OpenBed yet"* against *"Live bed information can't be loaded right now"* — which is the distinction R-2026-09-20-29 E2 exists to enforce.

**E — ORIGIN OFFLOAD IS MEASURED; PER-REQUEST ATTRIBUTION IS NOT. The difference is stated because the second is what a reader will assume from the first.**

Cowork's corroboration was five origin reads in 17:30–17:50Z, all colo CDG, smallest gap 80s against a 30s TTL — consistent with offload, with request-to-log-line mapping NOT CONFIRMED because no request timestamps were captured.

The implementer then ran a **timestamped triple** to close exactly that gap: `A` MISS at 17:48:57.3Z, `B` HIT at 17:48:58.3Z, `C` HIT at 17:48:59.3Z, all CDG. `edge_logs` for that window holds **one** origin read, at 17:48:58.439Z. **Three edge requests inside three seconds produced one origin read.**

- **What that establishes independently of the marker:** the COUNT. Three requests, one read; two were served without the origin being touched. No interpretation of `x-openbed-edge-cache` is needed to say so.
- **What it does NOT establish:** which request caused the read. It sits 1.1s after `A` and 0.14s after `B`, so the clock alone cannot separate them, and choosing `A` relies on `B`'s own `hit` marker. **Attribution stays NOT CONFIRMED**, exactly as Cowork had it.

**A measurement of the instrument, taken by accident and worth keeping:** the 17:48:58.439Z line was ABSENT from `edge_logs` when queried at 17:51Z and PRESENT at 17:53Z. **Supabase `edge_logs` ingestion lags by minutes**, so a missing line is not evidence of a missing read, and any future probe reading that table must allow for it or it will manufacture a finding.

**F — the queue:** 018 (this pull request); then the founder's hosted apply of 018, **where the boundary actually closes**; then the change that records that apply; then the infrastructure review; then Bundle 3.

---

### R-2026-09-21-48 — 018's two deferred decisions, answered; the reversal is exact and is guarded by prose

_No provisional letter; founder decisions taken in the 018 planning turn._

**A — `clientAddressableRelations` BECOMES EMPTY.** The kickoff's Bundle 2 blast radius and R-2026-09-21-39 C both deferred this to 018, calling it *"a decision, not a deletion"*. The founder's decision: **`[]`**. After 018 no relation is client-addressable; the public read path is `/beds.json` and the operator path is the RPCs.

- **The lint does not become vacuous, and this is asserted rather than asserted-in-prose.** `scripts/lint_from_allowlist.sh` refuses when the UNION of `clientAddressableRelations` and `rpcs` is empty; the three RPC names keep it non-empty. **MEASURED:** `lint_from_allowlist.sh: PASS (5 files, 3 allowed relations)`.
- **A new leg was added because 018 made the state reachable:** a positive control that the post-018 fixture shape is ACCEPTED, paired with a plant that `.from('ward_public')` is now REJECTED. That plant is the one leg whose verdict the migration flips.
- **A citation error, caught by the behavioural pass and recorded as the implementer's.** While writing that leg the implementer added a sentence to the lint's header claiming the empty-union refusal *"was asserted by nothing"*, and added a duplicate leg for it. **It was already asserted** — `tests/compliance/bundle_guards.test.ts`, *"anti-vacuity — an allowlist that parses cleanly to NOTHING refuses to pass"*. The absence had been concluded after reading only the FIRST anti-vacuity leg. The duplicate was removed. **This is the confirm-absence-by-reading rule failing on its own terms**, and it is recorded because the original citation was correct and was "corrected" into a falsehood.

**A2 — AN OPEN ITEM WITH A TRIGGER (method note 22).** Extend the lint to `.rpc(` call sites, which its own header names as NOT ASSERTED. **Trigger: the first `.from(` or `.rpc(` call site added under `apps/`.** **MEASURED today: there are none** — the guard is GUARD-AHEAD-OF-SUBJECT on both halves.

**B — `018_close_mirror_read_and_push_surfaces.down.sql` IS A FULL SYMMETRIC REVERSAL** to the exact 017 state: the three mirrors back into `supabase_realtime`, and `SELECT` back to exactly `anon` and `authenticated`. Nothing broader.

**B1 — WHY THIS DOES NOT CONTRADICT 013, whose down file withholds its reversal.** 013's forward migration ran a SWEEP and removed an **unenumerated default set**, so reversing it would have to GRANT `anon` access to the `app` schema that 013 never took away — a reversal that overshoots. **018 revokes an ENUMERATED set** — `SELECT`, three named relations, two named roles — so restoring precisely that cannot overshoot. The rule underneath both is one rule: *a reversal restores what its forward removed, and may not restore more.* 013 could not satisfy it and said so; 018 can. The distinction is written into the down file's header, because two files that appear to disagree about the same hazard teach the next reader to trust neither.

**B2 — THE CONSEQUENCE IS STATED WHERE IT WILL BE MET, TWICE.** Applying the reversal on hosted re-opens `anon`/`authenticated` read of the mirrors, history included. **While it is applied, no facility agreement may carry a history-is-private commitment.** That sentence is in the down file's own header and again as a STOP block beside the hosted-apply step in `docs/runbook-supabase-project-creation.md`.

**B3 — THE USE RULE, AND ITS HONEST LIMIT (Clause 4).** The reversal is never applied to the hosted project without a founder ruling naming the reason. **Nothing enforces this and nothing in this repository can:** a reversal is applied by a person with a database URL, and no check sits between them and `psql`. It is recorded in the weaker form the repository can execute — a named human step, in the two places that person will be reading.

**B4 — THE ROUND TRIP IS TESTED WITH EXACT SETS IN BOTH DIRECTIONS**, in `tests/db/migration_018_round_trip.test.ts`: publication membership and the `anon`/`authenticated`/`service_role` grant sets equal 017 exactly after `down`, and 018 exactly after the second `up`, with the ledger row asserted in both directions. `service_role` is in the snapshot deliberately, because neither direction mentions it and it must be byte-identical throughout.

**B5 — A PLANT WAS WRITTEN, DID NOT DISCRIMINATE, AND THE REASON IS RECORDED RATHER THAN THE LEG BEING QUIETLY DROPPED.** Three overshoot shapes were tried against the exact-set assertions:

- **`GRANT ALL` where the forward revoked `SELECT`** — caught.
- **The reversal handing back a FOURTH relation, `public.snapshot_current`** — caught. That table is `service_role`-only and holds the entire encoded payload, and it sits one comma from the three mirrors.
- **`TO anon, authenticated, service_role`, the three-role form Supabase's own defaults use** — **NOT caught, and it is not a defect.** `service_role` already holds `ALL` on the mirrors, so granting it `SELECT` is a true no-op and the database is not one privilege wider. **The plant was wrong, not the guard** — the same finding this repository has now recorded four times — and the shape is named in the test file so nobody rediscovers it as a hole.

**C — THE PRE-CONDITION THE FOUNDER SET WAS DISCHARGED BEFORE THE MIGRATION WAS WRITTEN.** *Confirm no production read path depends on `anon` or `authenticated` SELECT on the mirrors; name every reader and its role; if any does, stop and report.* Every reader, enumerated from the source:

| Reader | Reads | Runs as |
|---|---|---|
| `app.regenerate_snapshot()` (016) | `facility_public`, `ward_public` | SECURITY DEFINER |
| `app.publish_ward_status()` (014) | `ward_public` | SECURITY DEFINER |
| `app.refresh_lga_rollup()` (017) | writes `lga_rollup` | SECURITY DEFINER, `row_security = off` |
| `app.project_facility()` (008) | writes all three | SECURITY DEFINER |
| The Pages Function (`packages/snapshot/src/serve.ts`) | `public.snapshot_current` only | `service_role` |
| `public.my_facility_wards()` (011) | `app.*` base tables only | SECURITY DEFINER, EXECUTE to `authenticated` |
| Client code under `apps/` | nothing | **no `.from(` or `.rpc(` call site exists** |

**Nothing to stop and report.** The only call sites reading a mirror as `authenticated` over HTTP are three TESTS, and they are re-pointed inside this change (R-2026-09-19-24 B4).

**C2 — RE-POINTING THOSE THREE PRODUCED A FINDING ABOUT THE PROBES THEMSELVES.** All three proved *"a GoTrue-issued token authenticates a PostgREST request"* by reading `ward_public` and asserting 200. **Before 018, `anon` also held `SELECT` on `ward_public`** — so a request carrying only the `apikey` and no bearer token returned 200 too. **The assertion could not tell an authenticated session from no session at all;** it ruled out only a malformed token, which PostgREST refuses with 401. Re-pointed to `rpc/my_facility_wards`, whose EXECUTE is granted to `authenticated` and revoked from `anon` by name, the probes are **strictly stronger than what they replace**. Two of them name the exact signal `NOT_A_MEMBER` rather than a status, because `my_facility_wards` raises the neighbouring `NOT_AUTHENTICATED` with the same SQLSTATE and the same HTTP 403 — so the status alone would not discriminate, and the message is the assertion.

**D — WHAT 018 DELIBERATELY DOES NOT DO**, so the boundary is not overclaimed: the three `*_anon_select` RLS policies from 007 are left in place. A policy only runs for a role that has already passed the privilege check, so they are unreachable, not wrong; dropping them would be a second change wearing this one's clothes, and `tests/db/rls_anon_writes_rejected.test.ts` asserts all four public policies by name.

**E — AN OPEN ITEM FOUND WHILE RUNNING THE GATE, NOT CREATED BY THIS CHANGE (method note 22).** `npm run lint` reports **67 errors, all of them inside `apps/public-dashboard/.wrangler/tmp/…/functionsWorker-*.js`** — a wrangler build artifact. It is gitignored (`.gitignore:42`) and is in no diff, but ESLint's own ignore list does not exclude `.wrangler/`, so **anyone who builds before linting sees 67 errors in code nobody wrote.** CI does not see it because `repo-lint` and the build run in different jobs with different workspaces, which is why it has survived.

**It is noise, and noise in a gate is how a real error gets scrolled past.** Not fixed here: it touches the lint config, which is the trigger of an existing open item (the F3 ESLint Date guard), and both should move together. **Trigger: the next change that touches the ESLint configuration.**

**E2 — the honest form of the self-check line.** The pipeline's self-check asks for *no new lint errors*. The accurate statement for this change is: **no new lint errors in any tracked file; 67 pre-existing errors in a gitignored build artifact, unchanged by this diff and reproducible on `main` by building first.** Writing "no new lint errors" without that clause would be true and would read as "the lint is clean", which it is not.

**F — the queue:** unchanged from `-47 F`.

---

### R-2026-09-21-49 — the ESLint ignore gap, assigned to a named change rather than a trigger

_Issued as R-PROVISIONAL-2026-09-21-AB. Number assigned on landing from the record's last as read on merged `main` (`3b232b6`): R-2026-09-21-48._

**A — THE FINDING, AND EVERY PREMISE IN IT VERIFIED ON `3b232b6` BEFORE THIS WAS WRITTEN** (method note 17).

`npm run lint` reports **67 errors, all inside the wrangler build output under apps/public-dashboard/.wrangler/tmp/** (cited without backticks deliberately: it is gitignored, and Clause 4's scope rule is that a gitignored path must not be written as though it were a repo path). Reproduced on merged `main` after `npm run build`: `✖ 67 problems (67 errors, 0 warnings)`. CI has never seen it because `.github/workflows/ci.yml`'s `repo-lint` job runs `npm ci`, `npm run typecheck` and `npx eslint .` and **performs no build**, so the artefact does not exist in that job's workspace.

**A2 — THE MECHANISM IS NARROWER AND MORE EMBARRASSING THAN "ESLINT DOES NOT READ `.gitignore`".** It is one missing sibling entry.

- `.gitignore` lines 42–43 list `.wrangler/` and `.functions-build/` adjacently, under one comment ending *"Both generated, never committed."*
- `eslint.config.mjs`'s `ignores` array lists `'**/.functions-build/**'` and **not** `'**/.wrangler/**'`, under a comment explaining that generated output is ignored because *"linting it lints esbuild, not this repository."*

**The reason for ignoring `.wrangler` is already written in the config, for its sibling.** One of the two was carried across and the other was not. That is what makes A3's *derive, do not hand-write* instruction the right shape rather than an over-engineering of a one-line fix.

**B — THE RULING.** Fixed **at the root, in the change that records the hosted apply of 018** — the one that runs `node scripts/freeze_applied_migrations.mjs 18 <date> <ruling>` and moves the `frozen_migrations` placeholder to 019. **Not a separate pull request.**

1. **Add the wrangler build output path(s) to ESLint's ignore configuration, derived from `.gitignore` and the wrangler config rather than hand-written.**
2. **Add a check that runs the build and then the lint in the same job, or an equivalent guard**, so a build-then-lint regression cannot hide between jobs again.
3. **Demonstrate the failing half** (method note 23): with the ignore entry removed, the new check goes red; with it restored, the lint reports 0 errors after a build.
4. **The successor to #61's self-check clause is ticked only when 3 is shown**, not when the lint happens to be quiet.

**C — TWO MECHANISM NOTES, PROPOSED NOT PRESCRIBED (method note 5), because B1 names a mechanism whose cost is not visible from the instruction.**

- **"Derive from `.gitignore`" has a standard implementation and it is a NEW DEPENDENCY.** ESLint's flat config does not read `.gitignore`; the supported route is `includeIgnoreFile` from `@eslint/compat`, which is not in `package.json` (`eslint 10.10.0` and `typescript-eslint 8.70.0` are the only ESLint packages present). Adding it invokes Pre-Merge Gate 4 — registry existence, download history, typosquat check — for a one-line ignore. **The alternative that derives without a dependency** is a compliance test asserting that every directory `.gitignore` marks as generated build output also appears in the config's `ignores`, which puts the derivation in a GUARD rather than in the config and needs no new package. **Recommended, not decided.**
- **B2's "same job" has a cheaper equivalent that is also stronger.** Making `repo-lint` build first adds the whole build to a 28-second job. A compliance test over `ci.yml` and `eslint.config.mjs` asserting the agreement above is instant, runs in a job that already exists, and catches the gap even on a machine where nobody builds. Either satisfies B2 as worded; the second is what the repository's other cross-file agreements already look like.

**D — WHY THIS WAS NOT IN #61, and the freeze is recorded as having worked.** It is not a visitor-reachable safety defect, so R-2026-09-21-46 clause 3's only exception did not apply and it stayed out. **The freeze was applied correctly by both parties**, which is worth recording because the previous seven-pull-request run is what the freeze was written about.

**E — `-48 E`'s TRIGGER IS SUPERSEDED BY THIS RULING, and the block is left as written (method note 8).** It also carries the same backticked citation of the gitignored wrangler path that A above corrects in itself; left as written for the same reason, and named here so the slip is recorded rather than only fixed going forward. **The phantom-path guard does not catch it** — the path holds an ellipsis and a glob, so the extractor does not recognise it as a citation at all. A rule enforced by a guard that cannot see the shape in question is enforced by reading. `-48 E` recorded this as an open item triggered by *"the next change that touches the ESLint configuration"* — an event nobody had scheduled. It is now assigned to a NAMED change that is already owed. **An open item with a trigger nobody will reach is an item that will not be done**, and this is the founder converting one into work with an owner.

**F — ALSO BATCHED INTO THAT CHANGE: the four handoff discrepancies from #61 are corrected in the NEXT handoff document.** The committed `docs/handoff-2026-09-21-gate-lifted-018-in-flight.md` is **left unedited** — it is a dated record of what was believed on 2026-09-21, and method note 8 makes a dated record superseded rather than amended. The corrections:

1. **The demonstrated-failing-half rule is method note 23**, with note 24 as its cheaper prior question. **Notes 21 and 22 are batching and open items** and have nothing to do with probes.
2. The `edge_logs` figures *"5 reads … minimum gap 80 s"* were true when taken and are stale for their own stated window; it now holds at least 7 reads with a minimum gap of 34s, because the implementer's probes landed inside it afterwards. **The inference survives** — 34s still exceeds the 30s TTL.
3. `-46` was named for the freeze before the number was assigned; it is correct only because the rulings were ordered to make it so.
4. *"No PR number seen yet"* was stale the moment #61 opened.

**G — the queue:** unchanged. **The founder's hosted apply of 018 comes first and nothing starts before it** — not this, not the apply record. The boundary closes there, not at #61's merge.

---

### R-2026-09-21-50 — the runbook was not restated for 018; the rule is widened and one quarter of it is mechanised

_Issued as R-PROVISIONAL-2026-09-21-AC. Number assigned on landing from the record's last as read on this branch: R-2026-09-21-49._

**A — THE FINDING, AND IT IS THE RULE FAILING ON ITSELF.** Step 5 of the hosted runbook has carried this since 2026-09-14: *"When a migration is added, this list is restated in the same change that adds it, never in a follow-up: in between, the document would be wrong."* It was honoured three times — at 014-016, at 017's add, at 017's apply. **#61 added migration 018 and restated nothing.**

**Every premise the founder stated was verified on `3b232b6` before any of this was written** (method note 17), and all of them hold:

| claim | verdict |
|---|---|
| §5 still expects `001-017`, no `WOULD APPLY`, `0 migration(s) pending.` | **holds** |
| §6 asserts the three mirror READS return 200 | **holds** — preamble, probe, results table and a ticked checkbox |
| §10 asserts the publication holds exactly the three mirrors | **holds** — and its `exactly_three` SQL returns `f` on a correct post-018 project |
| no 018-specific read-back exists | **holds** |

**A2 — THE WORST ITEM IS §10's STOP CONDITION, because it fails on success.** After the apply, `array_agg(...) = array['facility_public','lga_rollup','ward_public']` reads `f` on a project where everything is right. §5 names that exact hazard two hundred lines earlier — *a stop condition that reads wrong on a correct run teaches whoever runs it to ignore stop conditions* — and the document did it to itself.

**A3 — §5 STATES ITS EXPECTATION IN FOUR PLACES, not one.** **[CORRECTED 2026-09-21 by R-2026-09-21-51: it is FIVE, and the fifth — the stop bullet — is the one this ruling left contradicting the other four. The sentence is kept as written, per method note 8, because the error is the finding.]** The prose bullet, the fenced expected-output block, the ledger expectation, and step 7's *"Hosted now holds 001 through 017."* **A restatement reaching one of four is how this finding was produced**, so the guard in D reads two of them and asserts they agree with each other as well as with the directory.

**B — TWO PREMISES CAME BACK DIFFERENT, and both are reported rather than worked around.**

- **The Pages runbook's `public.ward_public` line is UNAFFECTED.** The founder asked for it to be checked first. It sits inside a dated row-count observation from 2026-09-20; 018 changes who may READ the table, not whether it has rows. Checked, unaffected, and the reason is recorded rather than the line being edited to look considered.
- **There is no pull-request template.** `.github/` holds only `workflows`. The instruction says the template "gains a line"; it had to be **created**. The instruction survives; the mechanism it named did not exist.

**C — WHAT THE POST-018 REFUSAL ACTUALLY IS, MEASURED rather than assumed**, as the ruling required. Against a local database with 018 applied, a mirror read returns **`HTTP 401`** with body `{"code":"42501", … "message":"permission denied for table ward_public"}`.

**C1 — THE READ AND THE WRITE BECOME INDISTINGUISHABLE.** That is byte-for-byte what §6's WRITE probe has returned since 007. The write probes are kept as the ruling directs, and **their job has changed**: post-018 a write probe is a regression check against a future `INSERT` grant, not independent evidence about today. Recorded in §6, because a probe whose value quietly changed is one people keep running for the old reason.

**C2 — A LOCAL-VS-HOSTED ASYMMETRY THAT THE "DERIVE IT LOCALLY" INSTRUCTION COULD NOT HAVE SURFACED, and it is the reason §6's body rule matters.** MEASURED on both sides, 2026-09-21:

| | real key, table revoked | GARBAGE key | no key at all |
|---|---|---|---|
| local stack | 401, body `42501` | 401, body `42501` | 401, body `42501` |
| hosted | 401, body `42501` | 401, `{"message":"Invalid API key"}` | 401, `{"message":"No API key found in request"}` |

**Locally the body code does not discriminate a dead key from a revoked table. On hosted it does.** §6 runs on hosted, so its existing pass-on-the-body rule is sound where it is used — and anyone reproducing this locally is not reproducing the discrimination. **This is the `$ANON_KEY` family a fourth time**: a probe that passes because authentication failed rather than because the boundary held. Recorded in §6 as a test-conventions §4 asymmetry.

**D — THE ROOT-CAUSE GUARD.** `tests/compliance/runbook_migration_expectation.test.ts` derives §5's expectation from `database/migrations/` and `applied-hosted.json` and reds when they disagree: an unapplied migration §5 does not name, a named migration already frozen, a stale pending count, and **a half-restatement where the prose and the fenced block disagree**. Nine legs. **Demonstrated against the real artefact:** reverting both §5 sites to the text #61 left behind reds the real-runbook leg with *"018_close_mirror_read_and_push_surfaces.sql is in the repository and not applied to hosted, and step 5 does not name it as a WOULD APPLY line."*

**D1 — ONE QUARTER OF THE RULE IS MECHANICAL AND THREE QUARTERS ARE NOT, and the guard's header says so.** §5's expectation is derivable from the repository. **§6's and §10's are hosted READINGS and cannot be derived from here at all** (Clause 4). A guard claiming to cover them would be the phantom enforcement the clause exists to prevent.

**E — THE RULE IS WIDENED, on the founder's instruction, past §6 and §10.** It now governs **every section of either runbook that states an expected hosted state a migration can change**, stated once near §5 with a table of the sections it governs and a pointer in each. Prose, a named human step, no cited artefact — Clause 4 route 2. Each governed section records the 018 miss in §5's existing restatement-history form.

**E2 — THE MECHANICAL HALF THAT REACHES ALL FOUR is the pull-request template**, created here, asking every change touching `database/migrations/` which runbook expectations it changes, with "none" requiring a reason. **A template cannot force an answer** — it is prefilled text, and saying otherwise would be a Clause 5 claim that does not reach. **OPEN ITEM, with a trigger (method note 22):** a CI job reading `github.event.pull_request.body` and failing when that line is blank on a migration-touching PR. **Trigger: the next change to `.github/workflows/ci.yml`.** Recommended; not built here.

**F — THE SWEEP, because the founder widened it past §6 and §10.** Both runbooks, every expectation 018 makes stale, each restated or recorded as unaffected with its reason. The full list is in the pull request. Two items found that 018 did not cause and that were corrected in passing: *"All thirteen migrations were applied"*, four lines above a sentence saying hosted holds 001 through 017 — **already wrong at 014, and nobody was counting** — and the Pages runbook's *"018 is not written until those are quoted back"*, false since the merge.

**G — `-49`'s FIX LANDS HERE**, per the founder's instruction, on the mechanism they specified. Derived from **all** `.gitignore` directory entries rather than the two that were wrong. **MEASURED: four of the eight were uncovered, not one** — `.wrangler/`, `coverage/`, and the two Supabase CLI state directories supabase/.branches/ and supabase/.temp/ (**cited without backticks deliberately, and this time the guard is what said so**: Clause 4's scope rule is that a gitignored path must not read as a repo path, and `tests/compliance/no_phantom_paths.test.ts` flagged both). **It failed in CI and passed locally, which is the signature test-conventions names** — both directories exist on a machine that has run `supabase start` and in no fresh checkout, so the guard's `exists()` check answered differently in the two places. Diagnosed rather than presumed: the local green was reproduced on the identical commit, and the cause is the corpus, not the commit.) All four added; the exemption map ships empty and **its emptiness is asserted**, so adding one is a visible, reviewable act (the `.ci/ci-gate-exceptions.yml` shape). No `@eslint/compat`, no build step in `repo-lint`. Failing half demonstrated both ways: removing the wrangler entry reds the guard, and `npx eslint .` after a build now reports **0 errors** against 67 before.

**H — THIS PULL REQUEST IS AN EXCEPTION TO `-46`, NAMED AS ONE.** It is **not** a visitor-reachable safety defect. It is admitted because **the hosted apply cannot proceed by the runbook without it**: the document's own stop conditions would fire on a correct run, and the founder would be reading a stop condition that means nothing. The freeze's exception clause is for safety defects, so this one is granted by the founder explicitly rather than claimed under that clause.

**I — the queue:** merge this on the founder's word; then the founder runs the pre-apply block, the apply, and the 018 read-back, and pastes all three; then a separate small change runs `freeze_applied_migrations.mjs 18` with the apply date and moves the `frozen_migrations` placeholder to 019. **Nothing in this change records the apply.**

---

### R-2026-09-21-51 — the restatement repeated the defect it was fixing; five review findings, all upheld

_Issued as R-PROVISIONAL-2026-09-21-AD, the founder's review of #62 at `33ad8ce`. Number assigned on landing from the record's last as read on this branch: R-2026-09-21-50._

**A — ALL FIVE UPHELD, verified on `33ad8ce` before any of them was acted on** (method note 17). Two are blocking.

| # | finding | verdict |
|---|---|---|
| 1 | §5's stop bullet was not restated and contradicts the first bullet | **CONFIRMED, blocking** |
| 2 | block B cannot run as pasted — `$KEY` and `$SUPABASE_URL` are never set | **CONFIRMED, blocking** |
| 3 | E item 3 can false-stop: `status <> 'succeeded'` counts non-terminal runs as failures | **CONFIRMED** |
| 4 | E is in the wrong place and splits the frozen-boundary checkboxes | **CONFIRMED, worse than stated** |
| 5 | E item 2 claims a failing half nobody runs | **CONFIRMED** |

**A2 — THE SHAPE OF FINDING 1 IS THE POINT, AND IT IS MINE.** `-50` claimed *"§5 states its expectation in FOUR places"* and restated four. **There are five, and the fifth is the stop condition itself** — which went on reading *"any count other than zero: stop and report"* four lines below a bullet naming `1 migration(s) pending.` **A founder running a correct dry run would have stopped.** That is the precise hazard `-50` was written about, reproduced inside the change written to fix it, and it is a count asserted rather than derived — **#61's error one level up**. The guard now parses all three statements of the expectation and asserts they agree with each other as well as with the migrations directory.

**B — FINDING 2 IS WORSE THAN THE REVIEW STATED, and the extra consequence is recorded because it disarms a control.** Block B reads `$SUPABASE_URL`, which is assigned **once in the whole document, 316 lines later in §6**, and `$KEY`, which `unset KEY BODY` destroys at :855. **And E item 1's failing half is sourced from block B.** So a block that cannot run silently takes one of E's four items with it: item 1 would have had no demonstrated failing half either.

B now carries §6's guard verbatim — the `case sb_publishable_?*` arm and `SUPABASE_URL=` — and unsets both afterwards, satisfying the document's own rule that *each block that needs a credential reads it itself rather than inheriting it from an earlier step*.

**B2 — THE SWEEP THE FOUNDER ORDERED: 23 fenced blocks across §5, §6 and §10, and exactly ONE could not run as pasted.** The cross-block reads in §6 (the schema probe, the mirror loop, both check-(a) probes) take `KEY`/`SUPABASE_URL`/`REF` from a guard block sixteen and five lines above, bound by prose that names it. **That is deliberate and is left alone**; naming the difference between deliberate and broken is the point of having swept. Full table in the pull request.

**C — FINDING 3, AND THE STATUS VALUES ARE CITED RATHER THAN REMEMBERED.** pg_cron writes **six** status values — `starting`, `running`, `sending`, `connecting`, `succeeded`, `failed` — from `GetCronStatus()` in `src/job_metadata.c` at tag **v1.6.4**, which is the version this project runs (`pg_extension.extversion`, read on hosted). **Four of the six are non-terminal.** At a one-minute cadence a run in flight at read time is ordinary, and `<> 'succeeded'` would have stopped the founder on a healthy system.

The query now takes the apply time as an input **read in the same block** — finding 2's lesson applied immediately — counts only runs with `start_time` after it, counts failures as `status = 'failed'` only, and reports the other four in an `in_flight` column so a live run is visible and is not a verdict. **MEASURED that the filter discriminates**, on hosted: all-history 1334 and 6670 succeeded; last three minutes 1 and 3; an hour in the future 0 and 0. The existing lost-race carve-out for `openbed_refresh_lga_rollup` is carried across in substance.

**D — FINDING 5 IS FIXED BY DEMONSTRATION, NOT BY DELETION.** E item 2's block now ends with `begin; set local role anon; select … from public.snapshot_current; rollback;`. **The connecting role is `postgres`; `pg_has_role('postgres','anon','MEMBER')` is `t` locally AND on hosted**, checked before the block was written, as the ruling required. Locally it produces `ERROR: permission denied for table snapshot_current` and the `rollback` still runs — which is why the probe is last in the transaction.

**E — A DEFECT FOUND WHILE FIXING FINDING 1, IN MY OWN GUARD, AND IT IS THE MOST INSTRUCTIVE THING HERE.** The parsers in `tests/compliance/runbook_migration_expectation.test.ts` ended `(?=^- \*\*|\Z)`. **`\Z` is a Perl and Python escape; in JavaScript it matches a literal "Z".** So the lookahead read *"followed by another top-level bullet, or by the letter Z"*.

**Both regexes passed anyway**, because in the real runbook every bullet they match is followed by another top-level bullet — the second branch was never taken. It was exposed by the positive-control leg, whose fixture ends at the stop bullet: the lookahead failed, the parse returned nothing, and the checker correctly reported a missing count. **A guard that works only because its corpus never takes its second branch** is the shape this repository keeps finding, and here the ordinary-input control found it on the first try. Fixed to `$(?![\s\S])` and written into the file's header.

**F — the queue:** unchanged from `-50 I`. Merge on the founder's word; then the founder runs block B, the apply, and block E, and pastes all three; then a separate small change records the apply. **Nothing here records it.**

---

### R-2026-09-22-52 — 018 is applied; the accumulation boundary CLOSED on hosted at 2026-09-22 05:40:40 UTC

_A direct founder instruction with no provisional letter, issued on the founder's own hosted apply of migration 018 and quoting the full terminal output of it. Number assigned on landing from the record's last as read on this branch: R-2026-09-21-51._

**A — WHAT HAPPENED, AND IT IS THE POINT OF SPRINT A1.** The founder applied `018_close_mirror_read_and_push_surfaces.sql` to `klrlpxysjsjpdkeqdhvl` on **2026-09-22 at 05:40:40 UTC**, having taken step 5's block B first and block E after. **The accumulation boundary closed at that timestamp** — not at #61's merge, which added the migration, and not at #62's, which made the runbook able to describe it.

**From that moment the history-is-private commitment is available to a facility agreement**, subject to exactly one condition: the use rule on `018_close_mirror_read_and_push_surfaces.down.sql`. That reversal is applied to hosted only under a founder ruling naming the reason, and **while it is applied the commitment is false and no agreement may carry it.** Nothing enforces that and nothing can — the rule is in the down file's own header and in step 5, so it is met from either direction.

**A2 — THE READINGS, all the founder's, all pasted, none paraphrased into this record.**

| | before, block B | after, block E / sections 6 and 10 |
|---|---|---|
| mirror reads, publishable key | `HTTP 200` × 3 | `HTTP 401`, body `"code":"42501"`, × 3 — and the writes the same |
| `supabase_realtime` | `facility_public, lga_rollup, ward_public` | `(0 rows)`; `publication_exists t`, `publication_empty t` |
| `anon`/`authenticated` SELECT on the mirrors | held | `can_select f` on all six rows |
| ledger / pending | `17` / `1 migration(s) pending.` | `18` / `0 migration(s) pending.` |

**Each half is the other's demonstrated failing half** (method note 23), taken on one project minutes apart. That is what block B was added for in #62, and this is the first apply where it existed to be taken.

**A3 — THE ITEM THAT WOULD HAVE CAUGHT A REAL MISTAKE DID ITS JOB.** 018 was written on the reasoning that every writer of the mirrors is a `SECURITY DEFINER` function and so is untouched by a revoke on `anon` and `authenticated`. **That was an argument until a job ran.** After the apply: `openbed_refresh_lga_rollup` 3 succeeded / 0 failed / 0 in flight, `openbed_regenerate_snapshot` 16 succeeded / 0 failed / 0 in flight, and `snapshot_current` holding 1440 rows. The premise is confirmed live. **And `/beds.json` returned `HTTP/2 200` with `76fe917` unchanged** — 018 is invisible from outside, which was the claim.

**B — THE FROZEN BOUNDARY.** `node scripts/freeze_applied_migrations.mjs 18 2026-09-22 R-2026-09-22-52`, run with the ledger count read hosted in that session. 18 migrations, `001_app_schema_and_migration_ledger.sql` first, `018_close_mirror_read_and_push_surfaces.sql` last. The placeholder in `tests/compliance/frozen_migrations.test.ts` moved from 018 to 019 in the same change.

**B2 — AND THE INSTRUCTION TO MOVE IT CITED A MECHANISM THAT STOPPED REACHING ON THE DAY IT WAS LAST CARRIED OUT.** Step 5 said: *"A placeholder named after the migration just recorded is an edit to a frozen file, and the test reds (observed 2026-09-17, when 017 was recorded)."* **True on 2026-09-17, false from the moment it was acted on.** The 2026-09-17 red was `frozen migration 017_snapshot_schedule.sql CHANGED`, and it fired because the placeholder was then literally named after a real frozen migration and overwrote the scratch copy of it. **The fix that day renamed it to the distinct `NNN_placeholder.sql` form — and that same fix removed the mechanism the sentence cites.**

MEASURED 2026-09-22, three runs against the boundary at 18, because an absence is confirmed by reading and not by assuming:

| placeholder name | result |
|---|---|
| `018_placeholder.sql` (the stale one) | **7 of 7 pass** — no red at all |
| `018_aaa_placeholder.sql` | reds on the contiguous-prefix leg; it sorts BEFORE the real 018 file |
| `018_close_mirror_read_and_push_surfaces.sql` | reds with `CHANGED`, reproducing 2026-09-17 exactly |

**So the move is now hygiene — it keeps a test's name and docstring honest — and nothing would have caught it being skipped.** Clause 5: a mechanism present and not reaching. Corrected in step 5 rather than deleted, with the measurement beside it. **OPEN ITEM:** the root fix is for that leg to DERIVE its placeholder number from `database/migrations/applied-hosted.json`, which retires the manual move altogether. **Trigger: the founder's word, or the next apply, whichever comes first.** Not done here — the founder's instruction was to move it, and replacing an instruction with a better one is the founder's call, not the implementer's.

**C — THE RESTATE RULE APPLIED TO THIS CHANGE, which is the first time it has been applied by the change the rule actually asks for** rather than by a change catching up afterwards. Nine sites across both runbooks, each restated in its own section's history form:

| section | what changed |
|---|---|
| §5 prose bullet | 001–017 + one `WOULD APPLY` → 001–018, none, `0 migration(s) pending.` |
| §5 STOP bullet | stop on any count ≠ 1 → stop on ANY `WOULD APPLY` line, or any count ≠ 0 |
| §5 fenced expected output | the pre-apply fence → the post-apply fence, with 2026-09-22's kept below as a dated run |
| §5 ledger expectation | 17/1 → 18/0, with the 2026-09-22 observation added |
| §5 "next apply is 018" | OWED → **CLOSED at 05:40:40 UTC**, with the commitment's availability stated |
| §5 freeze invocation | count 18 → 19, and the 18 invocation recorded |
| §6 | an expectation derived LOCALLY → a hosted reading, with the results table |
| §7 | "Hosted holds 001 through 017. 018 is merged and NOT applied" → 001 through 018 |
| §10 | an expectation → a hosted reading, `(0 rows)` |

**Plus three in `docs/runbook-cloudflare-pages-beds-json.md`:** the status paragraph, the rate-limit rule's scope item 4 (*"the boundary is not in force and this line still describes an unmet condition"* — it is now met), and scope item 2's websocket claim, which was true of the repository and is now true of the database. **Swept for others; there are none.**

**C2 — THE GUARD GETS WEAKER AT ZERO PENDING, AND IS TOLD SO RATHER THAN LEFT TO DRIFT.** With hosted and the repository both at 018, `expectedWouldApply` and `fencedWouldApply` correctly return `[]` — **and an empty return because nothing is pending is byte-identical to an empty return because the regex died.** The three COUNTS must now parse to `0` and never `null` (a zero is proof of a parse; an empty list is not), and a new leg plants a migration name into the real runbook text and asserts both filename parsers find it. A second new leg guards a hazard this change's own history form creates: the 2026-09-22 dry run is kept as a DATED fence directly below the current one and holds exactly the strings a slipped regex would read as live.

**C3 — AND THE GUARD'S OWN STOP-BULLET PARSER WAS WRONG IN THE SAME FAMILY AS `-51 E`'s `\Z`.** It read to the next TOP-LEVEL bullet and took the first backticked count anywhere inside, with a header comment asserting that the indented restatement notes beneath *"carry no backticked count of their own"*. **That was a property of the corpus on the day it was written, not of the parser.** The very next restatement — this one — quoted the superseded count in backticks, as every other restatement note in the document does, and the parser silently read the HISTORY as the live stop condition: a plant that emptied the bullet came back with `1` instead of `null`. **The leg asserting the plant landed is what caught it**, on the first run. The span now stops at the first indented sub-bullet.

**D — THE FOUNDER-PATH FINDING: step P was omitted from Cowork's walkthrough of this apply.** The founder hit `zsh: command not found: psql` **twice** before any database was read. **Nothing reached the database** — psql never ran — so this is friction, not a safety event, and it is recorded as friction.

**D2 — THE PREMISES THE FOUNDER STATED WITH IT, CHECKED BEFORE ACTING** (method note 17):

- *"the key block already carries its own guard"* — **HOLDS.** Block B carries §6's `case sb_publishable_?*` arm verbatim, since `-51 B`.
- *"B is now the first step that uses psql"* — **PARTLY.** First in the EXECUTED order of the 018 sequence, because the "next apply is 018" block puts B ahead of §5's dry run. **Not in document order**: §4b's condition check and §5's pg_cron block both come earlier.
- *"I expect more than 15"* — **16 governed blocks**, of which step P already carried the line, so **15 gained it**.

**D3 — THE FINDING IS WIDER THAN BLOCK B, AND THAT IS WHY THE FIX IS.** `scripts/run_migrations.sh` carries a named stop condition for a missing `psql` — `ERROR: psql not on PATH. Install postgresql-client, or set OPENBED_PSQL.`, exit 2. **None of the direct `psql` blocks had one.** The block that failed rawly is precisely the one that bypasses the runner. A pointer on block B would have fixed one of sixteen.

**D4 — THE FOUNDER'S RULING, and it is better than what was proposed.** Not a prose pointer: **each governed block carries step P's `export PATH` line as its own first line**, which is the rule this document already applies to credentials — *each block reads what it needs itself rather than inheriting it from an earlier step* — extended to the other thing a pasted block inherits from its shell. Step P keeps the version check and the reason. `tests/compliance/runbook_psql_path.test.ts` (8 legs) **derives the expected line FROM step P** rather than restating it, so a machine change edits one place and reds every block still carrying the old one.

**D5 — AND THE MEASUREMENT CORRECTED ITSELF BEFORE IT WAS RECORDED, which is the part worth keeping.** The first count matched ````^```bash```` anchored at column zero: 32 fences, 15 governed. **Five fences in the hosted runbook are INDENTED**, sitting inside numbered lists, and one of them — §8's post-probe re-check — invokes `psql`. Corrected to an indent-tolerant matcher: **37 fences, 16 governed** (45 and 16 across both documents). *A description broader than its filter*, test-conventions §2(d), caught while measuring rather than after the guard shipped. A leg now removes the line from that indented fence specifically, and the governed count is asserted by identity so a matcher that stops seeing them reds instead of passing over a smaller corpus.

**E — `-49 F` IS DISCHARGED HERE.** The four #61 handoff discrepancies are corrected in `docs/handoff-2026-09-22-018-applied-hosted.md`, the next handoff document. `docs/handoff-2026-09-21-gate-lifted-018-in-flight.md` is left unedited: it is a dated record of what was believed on 2026-09-21 (method note 8).

**F — the queue.** Merge on the founder's word. **Nothing is owed founder-side** — the apply is done and recorded. The next migration is 019, whenever there is one, and step 5 now expects `0 migration(s) pending.` until there is.

---

### R-2026-09-22-53 — the placeholder derives; a hand-carried step removed rather than guarded

_Issued as R-PROVISIONAL-2026-09-22-AE. Number assigned on landing from the record's last as read on this branch: R-2026-09-22-52. **Record-only under R-46: committed and pushed to a holding branch, no pull request; it rebases onto the Bundle 3 change when that opens.**_

**A — THE RULING, AND ITS PREMISES CHECKED FIRST** (method note 17). Two of three hold.

| premise | verdict |
|---|---|
| the instruction cites a collision removed by the 2026-09-17 rename | **HOLDS** — measured in #63, recorded at `-52 B2` |
| a stale `018_placeholder.sql` passes 7 of 7 | **HOLDS** |
| *"point the derivation at a frozen number, and the leg must go red by name"* | **DID NOT HOLD against the checker as it stood** — see B |

**B — THE DEMONSTRATION COULD NOT BE MET AS SPECIFIED, and the reason is the finding.** Whether a placeholder at a frozen number reds is **an alphabetical accident of the real migration's name at that number**, because the contiguous-prefix check only notices a placeholder that sorts BEFORE it. MEASURED 2026-09-22 against the boundary at 18:

| pointed at | placeholder | result |
|---|---|---|
| 16 | `016_placeholder.sql` | **RED** — `p` < `s` in `016_snapshot.sql` |
| 17 | `017_placeholder.sql` | **RED** — `p` < `s` in `017_snapshot_schedule.sql` |
| **18, today's boundary** | `018_placeholder.sql` | **PASSES** — `c` < `p` in `018_close_mirror_…` |

Aiming the plant at 17 would have satisfied the ruling's letter **by luck** and left its subject unguarded. So the leg gained a check of its own — `placeholderCollision` — which asks whether the number belongs to any frozen file and does not depend on spelling. That is what makes the failing half real.

**B2 — AND THE FIRST VERSION OF THAT CHECK WAS A TAUTOLOGY, found by its own plant.** It asserted the derived number exceeded the frozen COUNT. The derivation returns `max(frozen) + 1`, so for any well-formed boundary that is true by construction: **a guard that cannot fail, written into the change whose whole subject is a step that could not fail.** Nothing the plant did could red it, which is the plant doing precisely its job. Replaced by the collision test, and the episode is recorded here rather than quietly fixed, because *"assert on parsed identity, never on a count"* (test-conventions §3) is the same lesson one level up.

**C — FINDING 2, AND IT IS MINE.** The docstring #63 put on that leg read *"at each point a placeholder of that name became an edit to a frozen file and this leg went red."* **True for 017, false for 018** — written into the fix by the same pull request that measured it false, three files away from the correction. `-51 A2`'s shape a third time. Corrected.

**D — WHAT SHIPPED.**
- `tests/compliance/frozen_migrations.test.ts`: `nextUnfrozenNumber(root)` derives the number from the boundary **in the tree it is given** — not `REPO_ROOT`, so a plant that edits the boundary moves the derivation — and **refuses rather than defaulting** when it cannot read one.
- `placeholderCollision(root, n)` is the check; the unfrozen-migration leg calls it before placing anything.
- A new leg, `plant — a placeholder at a FROZEN number is rejected`, carries the failing half, confirms the plant names a genuinely frozen number first, and **asserts the contrast**: the same placeholder placed on disk produces NO finding from the prefix checker. If that assertion ever reds, the alphabetical note has stopped being true and is re-measured rather than deleted.
- The runbook's *"In the same change, move the placeholder"* instruction is **removed**, with a history note saying what it said, that the leg derives now, and why the mechanism it cited had stopped reaching.

**D2 — DEMONSTRATED BOTH WAYS, quoted in the report.** Pointing the derivation at a frozen number (`max` instead of `max + 1`) reds the leg by name: *"the derived placeholder number belongs to a frozen migration: placeholder number 018 collides with 018_close_mirror_read_and_push_surfaces.sql, which database/migrations/applied-hosted.json records as FROZEN."* Neutering `placeholderCollision` to return null reds the plant: *"a placeholder at a frozen number was accepted."* Restored, 8 of 8.

**E — THE BUNDLE 3 RECONCILIATION the founder ordered, REPORT ONLY; nothing is resolved here.**

**E1 — RULING Z IS AUTHORITATIVE over the A1 kickoff.** `-40 H` re-points the name: *"T is amended narrowly to admit Bundle 3 (**the operator path to facility one**) once the infrastructure review has run; the review now gates Bundle 3, not only facility one. **Bundle 3's own kickoff is Cowork's, written after that review.**"* Z is later than the kickoff, it is in the record, and `-42 F` and `-48 F` repeat its queue unchanged. **The A1 kickoff's §Bundle 3, "The sensors — `/api/health` and `/status`", is superseded as the definition and is not marked as such.**

**E2 — BUT THE SCOPE ATTRIBUTED TO Z IS NOT IN Z.** `docs/handoff-2026-09-21-gate-lifted-018-in-flight.md:42` states Bundle 3's scope as four items *"fixed by Z"*. **The recorded ruling Z enumerates none of them**; `-40 H` says only *"Z's other parts are recorded as SCOPE, not as work"* and *"Nothing in C, D, E or F of Z is started here"* — the provisional letter's parts, whose text never reached the record. **So the scope binding the next bundle lives in a handoff, attributed to a ruling that does not carry it.** That is the exact shape `-40 A1` was written about: a gate paraphrased from a handoff. Three of the four items are independently traceable in the record; **`admin.openbed.ng` is not — it appears nowhere else in this repository.**

**E3 — `/api/health` AND `/status` ARE UNSCHEDULED, and no ruling made them so.** They do not exist in code (`apps/public-dashboard/functions/` holds `beds.json.ts` and nothing else). They are named in the A1 kickoff, in the v1 enumeration and in three handoffs, and in **none** of the four scope items. They were displaced when the name "Bundle 3" was re-pointed, and nothing records where they went. The kickoff states the cost itself: *"seven enumeration items have been unbuildable for want of this host and they close together or not at all."* **Those seven now have no carrier.**

**E4 — OPEN, FOR THE FOUNDER.** Which scope binds Bundle 3, and where the sensors go. Not decided here. **Trigger: the Bundle 3 kickoff, which is written after the infrastructure review.**

**F — NOT VERIFIED BY ME.** The Cowork handoff document for 2026-09-22 — named docs/handoff-2026-09-22-boundary-closed-on-hosted.md, **cited without backticks deliberately, because it does not exist here and a backticked path would be the Clause 4 phantom `tests/compliance/no_phantom_paths.test.ts` caught in the first draft of this very clause** — is cited for the infrastructure review gating Bundle 3. **It is not in this repository and its contents were not pasted**, so its item 2 is unread. **The conclusion it is cited for holds independently**, at `-40 H`.

**G — the queue:** unchanged. The infrastructure review; then Bundle 3, which carries this branch and the Cowork handoff document; then facility one; then Bundle 4. **Bundle 3 is not started.**
---

### R-2026-09-22-54 — Bundle 3's scope ruled; the sensors given a carrier; a stray commit remedied

_Issued as R-PROVISIONAL-2026-09-22-AF. Number assigned on landing from the record's last as read on this branch: R-2026-09-22-53. **Record-only under R-46: committed and pushed to the same holding branch as AE, no pull request; both ride the Bundle 3 carrier.** Resolves `-53 E4`._

**A — BUNDLE 3'S SCOPE, RULED BY THE FOUNDER 2026-09-22.** It is the operator path to facility one (`-40 H`):

1. **Tracked origins for every app** (Finding D).
2. **A deploy guard and build stamp for every app.**
3. **`admin.openbed.ng` v1:** operator sign-in; create and edit facilities and categories; ward logins provisioned **server-side** for each category; a facility list showing each category's freshness, **shown to operators only and never used as a filter**.
4. **The publish-screen fixes.**

**A2 — AND THIS RULING IS NOW THE SOURCE, which is the half that matters.** Until today that scope was sourced **only** from `docs/handoff-2026-09-21-gate-lifted-018-in-flight.md:42`, which attributed it to ruling Z; `-53 E2` established that **the recorded Z enumerates none of it**. A scope living in a handoff and credited to a ruling that does not carry it is the shape `-40 A1` was written about — a gate paraphrased from a handoff. **From now on the source is this block.** The handoff is **not edited**: handoffs stay as committed (method note 8), and the line is superseded as a SOURCE rather than corrected in place.

**B — THE SENSORS GET THEIR OWN BUNDLE, "the sensor bundle", sequenced AFTER Bundle 3 and BEFORE facility one.**

Scope: the A1 kickoff's `### Bundle 3: The sensors` section, lines 341-397, **carried over as written** — `/api/health`; `/status`, token-gated; the external sensor that does not share pg_cron's failure mode; and the seven enumeration items **#28, #30, #87, #88, #89, #92, #107**.

**The founder's reason, recorded as given:** *once a facility is live, a dead scheduler means stale beds shown to ambulances. That failure must raise an alarm before any facility depends on it.*

**This closes the orphaning `-53 E3` reported.** The sensors were never descoped by any ruling; they were displaced when the name "Bundle 3" was re-pointed by `-40 H`, and the seven items the kickoff says *"close together or not at all"* had no carrier. They have one.

**Queue, replacing every earlier statement of it:** the infrastructure review; **Bundle 3**; **the sensor bundle**; facility one; Bundle 4.

**C — THE TWO ORPHANED DEADLINES, RE-POINTED BY NOTE. Neither source is rewritten.**

- **`R-2026-09-17-12 G`** made the Pages scheduled-handler / cron-trigger check due *"before Bundle 3 is scoped"*. It was written when Bundle 3 meant the sensors. **It is now due before THE SENSOR BUNDLE is scoped.** `-12` stands as written.
- **Method note 14** cites *"Bundle 3's cron triggers"* as a worked instance of proposed-not-verified. **That phrase means the A1 kickoff's Bundle 3, i.e. the sensor bundle.** The note stands as written.

**D — THE STRAY FILE IN `38440e7`, AND THE THREE FINDINGS IN IT. Recorded without softening.**

**D1 — MINE. The AE commit added a file, and its report said it had not.** `38440e7` carries four paths; three were intended and one was not:

```
A  Claude outputs/handoff-2026-09-22-boundary-closed-on-hosted.md   <- UNINTENDED
M  Sprint Kickoffs/decision-2026-09-14-public-private-split.md
M  docs/runbook-supabase-project-creation.md
M  tests/compliance/frozen_migrations.test.ts
```

The report given to the founder said *"the AE commit touched this record only by appending its own ruling, ledger row and changelog entry"*. **126 lines of a document I had never read went in with it**, unmentioned in the commit message. **The cause was `git add -A`**, used twice — once to create `c386802` and again in the `--amend` that produced `38440e7`. `-A` stages the working tree, and **the working tree is not the set of paths a report describes.**

**D2 — MINE, AND WORSE, because it is a false fact inside the record.** `-53 F` states the handoff *"is not in this repository and its contents were not pasted"*. **The same commit that recorded that sentence committed the document.** The path `-53 F` names — `docs/…` — was genuinely absent, so the sentence is narrowly true and its plain meaning is false. **See E below.**

**D3 — COWORK'S.** The file was written into the working tree at **12:16:44** by a Cowork session, at `Claude outputs/`, after its own line 3 says *"This file is not in the repo. … **Don't leave it untracked in the repo:** any untracked file makes `scripts/deploy_pages.sh` refuse to deploy."* **It wrote into the repository the file it had just said it was keeping out**, and the warning it gave is the mechanism its own action would have tripped. Recorded as Cowork's error, as the founder directed.

**D4 — WHAT THE CHECKS ACTUALLY SAID, because the clean one is the interesting one.** `git status --porcelain --untracked-files=all` was **empty** — not because the file was absent but because it was committed. `git check-ignore -v` exited 1: matched by no ignore rule. `core.excludesfile` is unset. **`scripts/deploy_pages.sh` would NOT have refused** (line 72 reads `git status --porcelain`, which was clean). **A clean status concealed the defect rather than reporting it**, which is this repository's recurring shape — a check reporting success for a reason unrelated to what it guards — arriving in the reporting rather than in a guard.

**D5 — THE REMEDY, the founder's choice.** `git mv` into `docs/`, content **byte for byte unedited** (sha256 `50a6e0a4…` before and after, staged as `R100`), the empty directory removed. **No amend and no force-push: `38440e72…` stays valid**, and history keeps one commit that carried the file, named here.

**D6 — THE FIX FOR THE CAUSE, not the instance.** Staging is by **named paths only** from here, and `git diff --cached --name-status` is read and compared against the paths the report will claim **before** each commit. **A mechanical check is feasible and narrow:** a guard asserting the set of tracked TOP-LEVEL entries by identity, in the `tests/db/config_drift.test.ts` idiom, would have reddened on `Claude outputs/`. Its limits belong in its header — it catches a new top-level directory and **not** a stray file inside an existing one, and an allowlist at finer grain would refuse every legitimate new file, which is test-conventions' fifth way a leg goes wrong. **Reported, not built**, on the founder's instruction.

**E — `-53 F` IS CORRECTED HERE AND NOT REWRITTEN** (method note 8). Read `-53 F` with this note attached: **the document WAS in the repository when that clause was written** — at `Claude outputs/handoff-2026-09-22-boundary-closed-on-hosted.md`, committed by the same commit — and it is now at `docs/handoff-2026-09-22-boundary-closed-on-hosted.md`. What remains true of `-53 F` is the part that mattered to it: **its contents were not read, so its item 2 was unverified**, and the conclusion it was cited for holds independently at `-40 H`.

**F — THE CARRIER SCOPE, UPDATED.** The Bundle 3 pull request carries: the **AE and AF rebase**; and the **supersession mark** on the A1 kickoff's `### Bundle 3: The sensors`, pointing at this ruling and naming the sensor bundle as where that section now lives. **The handoff is no longer owed to it** — it is in `docs/` on this branch already.

**Listed in that pull request's body and deliberately NOT fixed in the file:** the handoff's line 3, *"This file is not in the repo"*, and its line 50, *"Its scope is fixed by ruling Z"* — the claim `-53 E2` found false, repeated.

**G — the queue:** the infrastructure review; Bundle 3; the sensor bundle; facility one; Bundle 4. **Bundle 3 is not started. The sensor bundle is not started.**
---

### R-2026-09-22-55 — `api.openbed.ng` is KEPT and the proxy hardened rather than removed; the magic-link host left open; three reads recorded, one of their reasons refuted

_Issued as R-PROVISIONAL-2026-09-22-AG. Number assigned on landing from the record's last as read on this branch: R-2026-09-22-54. **Record-only under R-46: committed and pushed to the same holding branch as AE and AF, no pull request; all three ride the Bundle 3 carrier.** Answers `R-2026-09-19-23 D0` and `D7`._

**A — `api.openbed.ng` IS KEPT, and it is the only database address every app uses. The founder accepted the CTO verdict 2026-09-22.**

`D0` set the criterion before the review ran: **the proxy must name what it buys that the direct Supabase origin does not**, with REMOVE as the default if nothing earns it. Three properties are named, as the founder gave them:

1. **Resilience against ISP-level blocking of `*.supabase.co`.** A blocked vendor apex takes every client with it; a zone the operator controls does not. _The founder cites the 2025 Jio block of `supabase.co` as the precedent. **That is an external event this repository cannot read, and it is recorded as cited rather than as established** (method note 19)._
2. **Portability.** Changing the Supabase project is **one Worker edit**, not an edit and a rebuild of every app. This is the candidate `D0` itself named — *decoupling client builds from the Supabase project ref* — and it is now confirmed rather than assumed.
3. **A place to put Cloudflare rate limits in front of auth.** The direct origin gives the operator nowhere to stand.

**A nicer hostname was never the reason.** Stated explicitly, because `D0` named exactly that as the cosmetic answer it would refuse, and a KEEP that did not dispose of it would read as the refused answer arriving by another route.

**A2 — WHAT THE KEEP BUYS IS NOT LIVE TODAY, and saying otherwise would be a Clause 5 defect.**

All three properties above require the apps to **actually reach Supabase through this hostname**. Two recorded facts say they may not:

- **Finding D (`R-2026-09-19-21 D`):** the ward console's origin is a build-time variable that **nothing tracked sets**, so no file in this repository can say what production talks to. `supabase-proxy/README.md` already carries that sentence.
- **`D1` is still open:** the founder's addendum says the name is deployed and a `dig` on 2026-09-19 returned **NO RECORD**. The contradiction is recorded and unresolved.

So this ruling decides the proxy **on the merits of the design**, and the properties in A arrive with Bundle 3 item 1 — tracked origins for every app — not with this block. Writing *"the proxy protects the apps from an ISP block"* in the present tense today would be a claim that is present, plausible, and **does not reach** the thing it names.

**B — BUNDLE 3 SCOPE ADDITION, under `-54 A` item 2 ("a deploy guard and build stamp for every app"). Four items.**

1. **The Worker forwards only the path prefixes the ward console and the admin app actually call, and the list is read FROM THE CODE, not from memory.** Every other path returns **404 from the Worker, without reaching Supabase**. This is what turns A3's "a place to put rate limits" from a property of the hostname into a property of the thing deployed: today `index.js` forwards **every path and method**, to auth, storage and functions alike, which is the surface `D0` said a cosmetic reason could not justify.
2. **A deploy guard and a build stamp for the proxy, in the same shape as the Pages apps.** Not a second mechanism: the same one, extended to the third deployed artefact.
3. **Probes, each with a demonstrated failing half** (method note 23): no key → **401**; key → **200** on `/auth/v1/health`; a path outside the allow-list → **404 served by the Worker**; and the deployed source equals the repo source. _Each is stated as the exact signal that means pass — never "not 200" and never "4xx", which are satisfied by the probe's own precondition being absent._
4. **`supabase-proxy/README.md` is updated:** its RECORD-NOT-DECISION banner is **superseded by A**, and the old text is **kept and marked superseded, not deleted**.

**No artefact this item plans is cited here as a repo path.** None of them exists yet, and a backticked path to an unbuilt script or test is the Clause 4 phantom `tests/compliance/no_phantom_paths.test.ts` exists to red on. They are named in prose until the change that builds them.

**C — OPEN, TRIGGER "before facility one": where do Supabase Auth magic-link emails point?**

If the verify link's host is `*.supabase.co`, **A1's blocking protection is incomplete** — the console would survive a block and sign-in would not, which for this product is the same outage. The end state in that case is Supabase's **custom-domain add-on on `api.openbed.ng`**, and the Worker is **retired**.

**That switch needs its own founder ruling on cost, and nothing about it is decided here.** Recorded as an open item with a named trigger (method note 22), not as work. **It is not a reason to defer B:** B is what the proxy needs whether it is the end state or the interim one.

**D — ALSO RECORDED, REPORT-ONLY. The founder's reads of 2026-09-22.**

- **D1 — the stray `openbedng` Worker is a default "Hello World" script, created 2026-09-18, with no routes and no domains. The founder will delete it in the dashboard.** This corroborates `R-2026-09-20-27 D1`, which already recorded it as created 2026-09-18 and still carrying the Hello World body, and the 2026-09-21 handoff's reading of no custom domains and no routes. **Deleting it closes `-27 D1`'s inventory item**, and it also discharges that clause's stated worry — that it might hold a route on the `openbed.ng` zone where it could intercept before the cutover.

  **The reason given with that instruction does not hold, and is refuted here rather than passed over.** The read was that *nothing in the repo refers to it*. **Six tracked citations name it**: this record at lines 1658, 1710 and 1737, `docs/handoff-2026-09-20-pages-direct-upload.md`, `docs/handoff-2026-09-21-deployed-and-reported.md`, `docs/handoff-2026-09-21-gate-lifted-018-in-flight.md` and `docs/handoff-2026-09-22-boundary-closed-on-hosted.md`. **The instruction survives** — a routeless Hello World Worker is deleted either way — **and the reason is replaced**: it goes because it is unaccounted infrastructure on the account, which is `-27 D1`'s own framing. **None of the six is edited.** They are true about the day they were written, and a record is not rewritten to match a later state (method notes 8 and 11).
- **D2 — `security@openbed.ng` is the runbook §9 magic-link test account, created 2026-09-14. It has no `ward_account`. It is NOT an orphan, and it is kept.** **Verified, not relayed:** `docs/runbook-supabase-project-creation.md` §9, *"Magic-link single-use — an INHERITED assumption, so probe it"*, carries the account under *"The commands, as run on 2026-09-14"*, and `SECURITY.md` names the same address as the private disclosure address. **This corrects the phrase "orphan auth user"** carried in `docs/handoff-2026-09-21-gate-lifted-018-in-flight.md` and `docs/handoff-2026-09-22-boundary-closed-on-hosted.md`. **Corrected by this note; neither handoff is rewritten.** The absence of a `ward_account` row was the whole basis of the orphan reading, and it is exactly what a §9 probe account is expected to look like — the tell was present and read the wrong way.
- **D3 — `public.rls_auto_enable()` is the function behind the Supabase event trigger `ensure_rls` (`ddl_command_end`), SECURITY DEFINER, owned by `postgres`. It is declared in no migration. It is listed as HOSTED-ONLY DRIFT.** **No action is taken on it here**; Cowork's review of it follows. Two things are recorded alongside it rather than folded into it: the two handoffs that name it also record **PUBLIC EXECUTE**, an attribute **this read did not carry and which is not re-observed here**; and every attribute above is a **hosted** reading, which `.claude/rules/test-conventions.md` section 4 is explicit is not assertable from inside this repository.

**E — WHAT THIS RULING DOES NOT DISCHARGE. A KEEP is not a closed review.**

`D7` says that if the proxy is kept it enters the repository *"with its configuration, a guard, a runbook entry, a record entry, and the availability answer from D5"*. This block is the **record entry**; B carries the **guard** and the configuration. **Still owed:**

- **the runbook entry**, which no item above creates;
- **`D5`, the availability answer** — what breaks if the Worker, its route or its DNS is misconfigured or unavailable; how anyone would notice; whether the client fails over to the direct origin or simply fails; what the runbook says to do. `D5` is on the clinical path and `-23` calls a reliability regression there *"a worse outcome than anything in D4"*. **A2 sharpens it rather than softening it:** the decision to make this hostname the only database address for every app is the decision to put a second dependency in front of every ward console, so `D5` is now load-bearing for the KEEP and not a parallel question.
- **`D2`'s NDPA sub-processor scope cell**, in the processor-obligations table above, which `-23 D2` said is to be completed **from the review's findings and not written ahead of them**. Keeping the proxy does not supply those findings.
- **`D1`, `D3`, `D4` and `D6`** are unanswered.

**F — the queue:** the infrastructure review; Bundle 3; the sensor bundle; facility one; Bundle 4. **Bundle 3 is not started. Nothing was deployed by this ruling.**
---

### R-2026-09-22-56 — the infrastructure review CLOSES; the Bundle 3 gate lifts; four of the review's own questions close with it unanswered and are named

_Issued as R-PROVISIONAL-2026-09-22-AH. Number assigned on landing from the record's last as read on this branch: R-2026-09-22-55. **Record-only under R-46: committed and pushed to the same holding branch as AE, AF and AG, no pull request; all four ride the Bundle 3 carrier.**_

**A — THE INFRASTRUCTURE REVIEW IS CLOSED.** The founder ran it on 2026-09-22 and supplied the reads. Its scope is the seven bullets at `docs/handoff-2026-09-22-boundary-closed-on-hosted.md:40-47`; **every one is answered below**, and the mapping is written out so a reader can see that rather than take it on trust.

**A1 — `supabase-proxy` / `api.openbed.ng`** (bullet 1, and bullet 7's GET check): **KEEP**, hardened in Bundle 3 — `R-2026-09-22-55`. Probes: **no key → 401**; with a key, **`/auth/v1/health` → 200**.

**The no-key half was re-read here rather than relayed** (method note 2 as widened by `-23`). `GET https://api.openbed.ng/rest/v1/` → **401**, and `GET https://api.openbed.ng/auth/v1/health` → **401** with the body `{"message":"No API key found in request","hint":"No 'apikey' request header or url param was found."}`. **The body is the thing worth recording, not the status.** It is PostgREST's refusal, not Cloudflare's — so the read proves the Worker **reached the Supabase origin and forwarded**, where a bare 401 from the edge would have been satisfied by the Worker being broken in a way that happens to deny. That is note 23's "name the exact signal that means pass, never a negation" applied to this probe. **The keyed half is the founder's and was NOT re-run**: no publishable key was in hand, and `-23 D4` forbids exercising the hosted auth limits.

**A2 — the stray `openbedng` Worker** (bullet 2): a default **"Hello World"**, created 2026-09-18, no routes. **DELETED by the founder, 2026-09-22.** **This closes `R-2026-09-20-27 D1`**, and it discharges that clause's stated worry directly — that the Worker might hold a route on the `openbed.ng` zone where it could intercept before the cutover. It cannot now hold one.

**A3 — `openbed-ward-console`** (bullet 3): it has **no custom domain** (the founder, from the dashboard), and it **cannot be deployed through the wrapper**. Neither is new work: both are already `-54 A` item 2, the deploy guard and build stamp for every app.

**A3b — one half of that bullet is NOT REPORTED, and is named rather than absorbed.** The 2026-09-21 handoff, which `docs/handoff-2026-09-22-boundary-closed-on-hosted.md:39` says the scope "carries over unchanged" from, asks for `openbed-ward-console`'s Pages status **and commit**. The status is answered above. **Which commit is deployed is not**, and it is the same question Finding D and Bundle 3 item 1 exist to answer. It rides Bundle 3; it is not closed here.

**A4 — DNS** (bullets 4 and 5, DNS half):
- **`mail.` and `ftp.` are gone** — no record.
- **`app.` and `admin.` have no record, which is expected.** Bundle 3 creates them.
- **`www.openbed.ng` was HTTP 522** — a proxied CNAME, not a Pages custom domain. The founder **added it as a custom domain on the public dashboard: now HTTP 200.**
- **The apex control was HTTP 200 throughout**, which is what makes the `www` reading a finding about `www` rather than about the zone.
- **A single `v=spf1` TXT on the apex.** The duplicate is no longer present.

**All of A4 was re-read here and holds:** `mail.`, `ftp.`, `app.` and `admin.` return no record; `www.openbed.ng` and `openbed.ng` both return **HTTP 200**; the apex carries exactly one `v=spf1` record.

**A4b — this discharges an open item the instruction did not claim.** `docs/handoff-2026-09-22-boundary-closed-on-hosted.md:121` carries *"SPF: two `v=spf1` records on the apex. Confirm the `+a +mx +include:re…` one is unused, delete it, and recheck DKIM in Proton."* **The first half is done**: the surviving record is Proton's, `v=spf1 include:_spf.protonmail.ch ~all`. **The second half is corroborated from DNS and NOT from Proton** — MX resolves to Proton, all three `protonmail*._domainkey` CNAMEs resolve, and `_dmarc` reads `v=DMARC1; p=quarantine`. Proton's own dashboard was not read, **so the item is recorded as discharged on the delete and corroborated on the recheck, not ticked on both.**

**A5 — SSL/TLS** (bullet 5, SSL half): mode moved **Full → Full (strict)**, the founder, 2026-09-22. **Apex HTTP 200 after the change**, which is the half that matters: Full (strict) is the mode that starts failing closed if the origin certificate is not what it should be, so a 200 afterwards is the demonstration and not a formality.

**A6 — `security@openbed.ng`** (bullet 6): the runbook §9 test account, **no `ward_account`**. **Kept.** Already recorded at `-55 D2`, where the "orphan auth user" reading the handoffs carry was corrected against `docs/runbook-supabase-project-creation.md` §9.

**A7 — `public.rls_auto_enable()` and the event trigger `ensure_rls`** (bullet 5 of the list, the undeclared hosted pair). Recorded as the founder gave it, reasoning included:
- **Its definition, read on hosted, enables RLS ONLY for tables created in schema `public`.** The scope is the finding; "an event trigger that enables RLS" without it would be a much larger claim.
- **Hosted state:** the **4** `public` tables have RLS **on and forced**, **1 policy each, all from migrations**; the **16** `app` tables have RLS **off**, the same as local.
- **THERE IS NO HOSTED/LOCAL RLS DRIFT TODAY.**
- **`EXECUTE` granted to `PUBLIC` is INERT**: an `event_trigger` function cannot be called directly. **This retires the "PUBLIC EXECUTE" alarm** the two handoffs raised and `-55 D3` repeated as recorded-but-not-re-observed. It was a true reading of the grant and a wrong reading of its consequence.
- **Recorded as undeclared hosted platform configuration. It is NOT dropped.**

**A8 — a method finding, not in the review's scope but produced by it.** **The founder's Mac cannot run `dig`: port 53 is unreachable from it, even to `1.1.1.1`, so every lookup times out.** DNS was read by Cowork over **DNS-over-HTTPS** instead. **See `E1` and `E2`** — the remediation this finding asks for has no target in the runbook, and the claim is narrower than its wording.

**A9 — WHAT CLOSES WITH THE REVIEW STILL UNANSWERED. Named, because a closure that absorbs its own open questions is the defect this record keeps finding one layer up.**

Closing the review is the founder's to declare and is not in question. What it does **not** do is discharge `R-2026-09-19-23`'s remaining lettered items, which `-55 E` had already recorded as owed:

- **`D2` — the NDPA sub-processor scope cell** in the processor-obligations table above. `-23 D2` said it is completed **from the review's findings and not written ahead of them**. The findings now exist, so it is completable — **and it is not completed here.**
- **`D3` — the surface**: methods, the services reached, websocket upgrades, what `redirect: "manual"` exposes in `Location`, and CORS. A1's two probes are a liveness proof, not a surface inventory.
- **`D4` — attribution**, which client address Supabase sees. `-23` calls it the sharpest item in the review.
- **`D5` — availability**, which `-23` calls *"a worse outcome than anything in D4"* because it sits on the clinical path, and which **`-55 A2` made load-bearing**: making this hostname the only database address for every app is the decision to put a second dependency in front of every ward console.

**Answered: `D1`** by A1 — the name is live — **and `D7`** by `-55`. **Split: `D6`** — the console route is Bundle 3 item 1, the rate-limit scope is `-55 B` item 1, the plan-cost question is `-55 C`.

**The four above become open items with the trigger "before facility one"** (method note 22), not work, and not silently closed.

**B — THE `R-2026-09-21-40 H` GATE IS LIFTED.** `-40 H` made the infrastructure review a gate on **Bundle 3**, not only on facility one, and said **Bundle 3's own kickoff is Cowork's, written after that review**. The review has run. **Bundle 3 may be kicked off, and its kickoff is Cowork's.** Nothing in Bundle 3 is started by this ruling.

**C — BUNDLE 3 SCOPE ADDITION: the residual risk from A7, as the founder scoped it.**

A compliance guard that **every `CREATE TABLE` in schema `public`, across `database/migrations`, is followed in the same file by both `ENABLE` and `FORCE ROW LEVEL SECURITY`.** Demonstrated failing half (method note 23): **a planted public table without them turns the guard red.**

**The reason, recorded as given, because it is the whole point:** on hosted, `ensure_rls` would **silently enable RLS that local lacks**. The tests would then run against **a database looser than production**, and the omission would never surface. A7 says there is no drift today; this guard is what keeps that true, and it is aimed at the one direction A7's reading cannot cover — the next migration, not the current corpus.

**Four constraints go in with it, because in this repository a guard that is not registered is a guard that does not run:**
- it joins `scripts/lint_migrations_all.sh`'s `LINTS` array, or records a `RUN_ELSEWHERE` exemption naming where it does run — `tests/compliance/lint_migrations_all_complete.test.ts` enforces this;
- its failure sites get entries in `packages/fixtures/leg-coverage.json`;
- its test file needs a delta entry in the predict/attest pair;
- and it carries a **NOT ASSERTED HERE** header line pointing at `tests/db/rls_enabled_everywhere.test.ts`, the live-catalogue check that is its **complement, not its duplicate** — the lint catches the statement in review, before it is ever applied, and the catalogue check only sees it afterwards.

**One constraint that decides whether it can land at all: migrations 001-018 are FROZEN.** The guard must pass over the corpus exactly as it stands, because no file in it may be edited to satisfy a new rule.

**D — THE ANSWER TO THE FOUNDER'S QUESTION C. The proof exists, and it is quoted rather than asserted.**

The question: RLS is off on all 16 `app` tables, which is safe **only** while `anon` and `authenticated` cannot reach the `app` schema at all. Three claims, three answers:

1. **No `USAGE` on schema `app`.** `tests/db/rls_anon_reachability.test.ts`, test *"anon holds no USAGE on the app schema at the grant level"*, asserts `has_schema_privilege(…, 'app', 'USAGE')` is **false for both `anon` and `authenticated`** — the test's name says only `anon`, its body covers both. Hosted equivalent: `docs/runbook-supabase-project-creation.md` step 6's catalogue half, recorded 2026-09-13, `anon` **f**, `authenticated` **f**, `service_role` **f**.
2. **No privileges on `app`'s tables.** `tests/db/rls_enabled_everywhere.test.ts`, test *"no client role holds any grant on any table in app"*, enumerates `information_schema.table_privileges` for `anon`, `authenticated` **and `PUBLIC`**, **all** privilege types, and expects the empty list. Its anti-vacuity partner in the same file pins the 16 table names by identity, so it cannot pass by scanning an empty schema.
3. **`app` is not in the exposed schemas.** `tests/db/config_drift.test.ts`, test *"the app schema is NOT in the PostgREST exposed-schemas list"*, over `supabase/config.toml`; and the behavioural half in `tests/db/rls_anon_reachability.test.ts`, *"the app schema is not exposed — asking for it is refused with PGRST106"*.

**And the three gaps, because a quoted green that hides its own edges is exactly the shape this record keeps catching:**
- **the USAGE test has no positive control.** Its sibling mirror-grant test in the same file has one; this one does not. **A misspelled privilege string would read as the boundary holding** — note 18's failure mode sitting inside the boundary suite.
- **the hosted grant check is `anon` x `SELECT` only**, 16 tables, recorded 2026-09-13, against the local test's 16 tables x 3 grantees x every privilege type. Step 8's hosted probe says so itself: *"What this does NOT prove: the grant leg on hosted."*
- **the hosted exposed-schemas list has no in-database representation** and is a runbook hand-reading **by design** — `.claude/rules/test-conventions.md` section 4, and `tests/db/config_drift.test.ts`'s own header.

**Verdict: proved locally; partial on hosted.** Whether any of the three gaps joins Bundle 3 is Cowork's, as the question asked.

**E — PREMISE CHECKS. Two of the instruction's failed, and one of mine did.**

- **E1 — A8's remediation has no target, and this is the answer to what was asked.** The instruction says *"Any runbook step that uses `dig` must say this, or offer a DoH alternative. Report which steps use dig."* **No runbook step uses `dig`. None does.** `docs/runbook-supabase-project-creation.md` contains the string nowhere at all. Repo-wide, **measured before this ruling was written and stated as of that moment rather than as a live total** — this block and the README note it supersedes both add more — there were **nine** occurrences, **every one prose** referring back to the same 2026-09-19 lookup: `supabase-proxy/README.md`; `docs/handoff-2026-09-20-pages-direct-upload.md`; `docs/handoff-2026-09-21-deployed-and-reported.md`; and six in this record. **There is no executable `dig` anywhere in `scripts/`, `tests/`, CI or any runbook.**

  **Where the assumption DOES bite, named instead of the runbook, and not edited** (the instruction says report, not fix): **this record's own line 2093**, which records `nslookup openbed.ng 1.1.1.1` as a passing check — a lookup **pinned to an explicit external resolver**, which is the exact form A8 describes failing; and `docs/handoff-2026-09-21-gate-lifted-018-in-flight.md:61`, *"the Mac now also uses 1.1.1.1"*.
- **E2 — "every dig times out" is narrower than its wording, measured.** On the machine this ruling was written on: `dig` against the **system resolver works**; `dig … @1.1.1.1` **times out**; `dig … @8.8.8.8` **works**. That is a different machine from the founder's and **neither confirms nor refutes their read of theirs**. What it changes is the rule worth writing down: not *`dig` is unusable*, but **a lookup pinned to an explicit external resolver can fail closed on a network that blocks port 53 to that resolver** — which is precisely why E1's `nslookup … 1.1.1.1` is the live instance and the runbook is not.
- **E3 — `-55`'s statement that `D1` is still open is SUPERSEDED by A1.** Read it with this note attached. `-55` is not rewritten (method note 8).
- **E4 — A8 does NOT retroactively explain the 2026-09-19 contradiction, and it would have been tidy to let it.** Two recorded facts refuse it. `-20 B1` records that lookup as **the implementer's**, on a different machine from the founder's Mac. `-20 B3` records that **the same lookup returned results** — `openbed.ng`'s nameservers at Cloudflare and an apex `A` of `192.0.2.1`. **A lookup that returned records was not timing out.** The contradiction is settled by the name being live now, which is A1, and not by a broken resolver.
- **E5 — MINE, and it belongs here for the same reason the others do.** Writing A4b I first read the `protonmail*._domainkey` selectors as **absent**, and was one step from recording a DKIM finding that does not exist. The cause: I asked for the **default record type** instead of `CNAME`, so a CNAME that resolves to no address returned empty — **a query that could not have returned the thing I concluded was missing.** A known-present control caught it. **This is note 18 and the standing confirm-absence-by-reading rule catching their own author**, on the same day E1 used the identical discipline on someone else's claim.

**F — the queue:** **Bundle 3** — its kickoff is Cowork's, and it is next; the sensor bundle; facility one; Bundle 4. **Bundle 3 is not started. Nothing was deployed.**

**A10 — CONFIRMATION NOTE, appended 2026-09-22 AFTER the block above was written. No new ruling; this is `-56` gaining the evidence two of its clauses were recorded without.**

**A10a — `A5` IS CONFIRMED.** The founder confirmed **in the Cloudflare dashboard, 2026-09-22, that SSL/TLS is Full (strict)**, with **apex HTTP 200 and `www` HTTP 200 after the change**. Both were re-read here after the confirmation arrived: `https://openbed.ng/` **200**, `https://www.openbed.ng/` **200**.

**A10b — `A2` IS CONFIRMED, and now holds three ways.** Cowork verified independently that **the Cloudflare account lists one Worker, `supabase-proxy`; `openbedng` is absent.** Read a third time here, from the account itself: the Workers list returns **count 1**, the single Worker `supabase-proxy`, created 2026-09-19. **`openbedng` is absent.** A2's deletion claim is no longer resting on the dashboard reading of whoever performed it.

**A10c — AND THE DEFECT THE NOTE EXISTS TO RECORD. `A5` WAS WRITTEN BEFORE THE FOUNDER HAD CONFIRMED IT — a fact recorded ahead of its evidence.** Recorded as **Cowork's error**, as directed.

**What this record can establish about it, and what it cannot.** Who originated the SSL claim is **not readable from here**: it arrived in the instruction that produced `A5`, already attributed to *"the founder, 2026-09-22"*. So the attribution above is recorded **as given**, not as established — which is the same discipline `A4b` used on Proton's dashboard, applied to this clause.

**What IS establishable is mine, and it is the half worth keeping.** `A5` as written carries **no evidence kind at all**. In the same block, `A1` says explicitly which half was re-read here and which stays the founder's, and `A4b` says explicitly that Proton's dashboard was not read. **`A5` did neither — and `A5` is the clause that turned out to be ahead of its evidence.** The discipline was present in the block and was not applied to every clause of it, and **an unmarked relayed claim is indistinguishable from a confirmed one to every later reader.** That is Clause 5's failure mode and method note 19's rule — *read state, or mark it UNVERIFIED rather than stating it* — arriving in the recording rather than in a guard, which `-54 D4` names as this repository's recurring shape.

**The cause, not the instance.** `A3` and `A7` are dashboard and hosted readings recorded the same way, **with no evidence kind marked**, and nothing here has confirmed them. They are **not** thereby doubted — `A7`'s reasoning is internally checkable and `A3` restates gaps already in Bundle 3 — but they are **relayed, and this note says so** rather than leaving `A5` corrected and its two siblings carrying the same silence. **The rule for the next block of this kind: every clause resting on a reading someone else took names that, in the clause, at the time it is written.**

### R-2026-09-22-57 — Bundle 3 becomes four pull requests; the grant gaps split; the build-stamp check is redesigned rather than rebuilt around

_Issued as R-PROVISIONAL-2026-09-22-AJ, inside the Bundle 3 kickoff the founder pasted on 2026-09-22. Number assigned on landing from the record's last as read on this branch: R-2026-09-22-56. **Record-only under R-46 for the ruling itself; it lands in PR 3.1 with the kickoff it arrived in.** That kickoff is committed unedited at `Sprint Kickoffs/sprint-kickoff-bundle3-operator-path-2026-09-22.md` — **it is the source, and this block records the ruling rather than restating it.**_

**EVIDENCE KINDS IN THIS BLOCK** (`-56 A10c`'s rule, applied at the time of writing rather than after). Clauses **A**–**F** are Cowork's calls and the founder's two scope answers, recorded **as given**. Clause **G** is mine: every premise those clauses rest on, read in this repository on this branch before any of it was acted on, with the verdicts. Nothing below is marked verified because it is plausible.

**A — TWO OF `-56 D`'s THREE GRANT GAPS ENTER BUNDLE 3; THE THIRD DOES NOT.**

- **A1.** The USAGE test in `tests/db/rls_anon_reachability.test.ts` gains a positive control: the identical `has_schema_privilege` call returning **true** for a role that does hold USAGE on `app`, with that role read from the catalogue rather than assumed. The test's name stops saying only `anon` when its body checks two roles.
- **A2.** The hosted grant check widens from `anon` × `SELECT` to `anon`, `authenticated` and `PUBLIC` × **every** privilege type × **every** table in `app`, matching the local test's anti-vacuity pin on the 16 table names, **with a failing half run in the same sitting**. It is a runbook step because nothing in the repository can reach the hosted catalogue, and it runs **once, when Bundle 3 lands**, because PR 3.4 adds the first authenticated-executable functions since 014.
- **A3.** The hosted exposed-schemas list **stays a hand reading**, by design, per test-conventions §4. Not in scope, and not a gap to be closed by a test that would only appear to check it.

**B — THE BUILD-STAMP CHECK IS REDESIGNED, NOT REBUILT AROUND.** The defect is **where the assertion lives**, not how the check runs. The property that matters — *the artefact being uploaded names the commit being deployed* — is true only at upload time. So the readback moves into the deploy wrapper, which refuses to upload unless the stamped commit equals the verified HEAD and `dirty` is false; the compliance test stops reading a shared build directory and runs the stamp script into a scratch output instead, keeping its refusal plants; and **one stamp mechanism covers every artefact**, not one per app.

**C — THE PULL-REQUEST SHAPE: FOUR, IN ORDER.** `R-2026-09-21-46` batches *record-only* work, and its D clause gives the reason — the overhead is waste **for a paragraph**. These are four changes with different risk and different reviewers: a migration adding operator write functions must not share a review with a wrapper refactor, and the clinical-screen fix must not wait behind the admin app. **All record-only material rides PR 3.1**, as `-46` requires.

**D — ADMIN ARCHITECTURE PROPERTIES**, against which the implementer proposes the mechanism. Identity comes from `auth.uid()` **in the database**, never from an argument and never from a Function (D1); operator write functions are `SECURITY DEFINER` in `public`, `EXECUTE` to `authenticated` only, operator check first (D2); the authenticated-executable set becomes a **closed, named list** asserted on identity rather than count (D3); ward-login provisioning is a Pages Function holding the service key that **does not decide who the caller is** — it forwards the bearer to an authenticated operator function which answers from `auth.uid()` (D4); the `-45` invite gate is built here, enforced in the database and not the UI (D5); `app.facility_contact` is **not** edited in admin v1, being the one named human in the system (D6); categories are **add-only**, since `ward_status_event` references `ward_status` `ON DELETE RESTRICT` and there is no retired state (D7); the operator's freshness list **never uses freshness to filter, sort out, hide or suppress** a row, and computes bands from the single existing derivation site (D8); the operator's sign-in address is a **role address**, never a personal mailbox, which nothing technical can check and so goes in the runbook (D9); every operator write leaves an `app.audit_log` row in the same transaction (D10).

**E — SERVER-SIDE ORIGINS FOLLOW `-55 A`**, so the allow-list is read from browser *and* server-side calls. **AMENDED THE SAME DAY by `R-2026-09-22-58 A`**, which carves out the public dashboard's snapshot Function on the founder's decision. Read E and `-58 A` together; E alone now overstates its own scope.

**F — THE FOUNDER'S TWO SCOPE ANSWERS, 2026-09-22**, which bring two items into Bundle 3 under note 22. **F1: `-56 A3`'s `(unknown facility)` beside a real count is IN, in PR 3.2** — Bundle 3 ships the tool that creates the first row the `-45` gate governs, so every item on that gate belongs in the same bundle. **F2: the ward's own request for a new sign-in link is IN, in PR 3.2, as a form in the ward console** — sessions are time-boxed at 24 hours and links are single-use, so nothing let a ward sign in again the next day; the ward-side form was chosen over an operator "resend" because the ward-identity model rests on physical control of the handset, not on the operator.

**G — THE PREMISES, READ HERE BEFORE ANY OF THIS WAS ACTED ON** (note 20; and `-56 A10c`'s rule that a clause resting on someone else's reading says so). Every premise below was read on this branch at `a8b28fe`.

**G1 — THE ONES THAT HOLD, with what makes them true:**
- **A1's gap is real.** The USAGE test asserts `false` for `anon` **and** `authenticated` and nothing in the file shows that same call can return `true`. A sibling test in the same file, *"the probe can return TRUE — a role that holds SELECT is reported as holding it"*, is the shape A1 asks for, so the fix has a template one screen away from the defect.
- **A2's gap is real.** `tests/db/rls_enabled_everywhere.test.ts` closes the local side over all three grantees and every privilege type; the hosted half recorded on 2026-09-13 covers one role and one privilege.
- **B's defect is real.** `tests/compliance/build_stamp.test.ts` asserts the built stamp names the checkout's HEAD; the stamp on disk at the time of reading named `d715b40` with `dirty: true`, which is the state the clause describes.
- **D3 is real.** The three-RPC test filters to three names **before** asking who may execute, so a fourth authenticated-executable function is invisible to it. The anon side *is* closed; the authenticated side is not.
- **D7 holds at the schema.** `ward_status_one_row_per_ward UNIQUE (facility_id, category)` in 004, and `ward_status_event.ward_status_id … ON DELETE RESTRICT`.
- **`-56 C`'s lint can land.** All four `public` tables in the frozen corpus already pair their `CREATE TABLE` with both `ENABLE` and `FORCE` — 007 at lines 187–195, 016 at lines 159–160 — so the guard passes over 001–018 **unedited**, which is the one constraint that decided whether it could ship at all.

**G2 — ONE INSTRUCTION WHOSE PREMISE WAS ALREADY SATISFIED.** PR 3.1's first task reads *"Rebase AE–AH and A10 onto `main`."* **There is nothing to rebase.** `git merge-base main HEAD` returns `main` itself: the holding branch is already based on `0cfab92`. The instruction survives as *continue on the holding branch and open PR 3.1 from it*; **the rebase it names is not work that exists.** Recorded because note 20 requires the mismatch be said even where the instruction survives.

**G3 — ONE DEFECT IN THE KICKOFF, LISTED AND NOT FIXED**, because the instruction is to commit it unedited. It cites the built stamp path — apps/public-dashboard/dist/version.json, written here **without** backticks for the reason the rest of this clause gives — **in backticks**. That path is gitignored, and Clause 4's scope note requires gitignored paths be cited *without* backticks so they do not read as repo paths. **No guard catches it:** `tests/compliance/no_phantom_paths.test.ts` tests filesystem existence, and CI builds before the compliance suite, so the path exists whenever the guard looks. A citation that is wrong in kind and green in every run is exactly the shape Clause 4 exists for, and it is recorded rather than repaired.

**G5 — AND ONE MORE, FOUND WHILE BUILDING A1 RATHER THAN WHILE READING IT, added 2026-09-22.** `-56 D` justifies the USAGE positive control on the ground that *"a misspelled privilege string would read as the boundary holding"*. **Measured against the local stack (PostgreSQL 17.6) before the control was written, it would not.** `has_schema_privilege` **raises** on an unrecognised privilege type — `unrecognized privilege type: "USAGEE"` — and equally on a schema or a role that does not exist. Leading and trailing whitespace and lower case are all tolerated and return the correct answer. **The specific defect that ruling named is caught loudly by Postgres itself, with or without a control.**

**The control is still built, on a narrower reason that does hold**, and the test says so in its own header rather than repeating the ruling's: it establishes that the call is **capable of returning true at all**, so the two `false` assertions are not satisfied by a probe that can only ever answer false. That is a property of the instrument, not a prediction about one way of breaking it — which is the difference between a control and a guess about a failure mode.

**And the honest limit is named in the test as NOT ASSERTED, because it is the case a reader would assume is covered.** Substituting a different VALID privilege — `CREATE` for `USAGE` — leaves the control **true** (`postgres` holds `CREATE` on `app`) and both subjects **false**, so nothing reds and the suite would be asserting the wrong privilege. Measured, not assumed. Closing it needs a probe asserting the privilege graph by identity, which is a different control and is not built here.

**CLOSED BY `R-2026-09-22-62` (AL), 2026-09-23, not carried as an open item.** The USAGE test now probes one named privilege constant against a control subject that holds USAGE and **not** CREATE on `app`, so swapping the constant to CREATE turns the control false and the test red; and a catalogue read of the schema's ACL covers every privilege type for `anon`, `authenticated` and `PUBLIC` at once. The limit named in the paragraph above is therefore no longer a limit.

**Why this is worth a clause.** `-56 D` is the ruling that named three gaps in the boundary suite, and it is exactly the kind of finding that gets reused: the next person to reach for a positive control will reuse the REASON, not the instruction. A right instruction resting on a false premise stops being lucky the moment the premise becomes load-bearing.

**G4 — AND ONE CLAIM FROM MY OWN TOOLING, REFUTED BEFORE IT REACHED THIS RECORD.** A planning pass reported that the kickoff cites its own future paths under a `claude/` prefix that `no_phantom_paths.test.ts`'s scope regex does not cover — a finding which, had it been taken on its face, would have meant editing a document ruled to land unedited. **It is false.** There is no `claude/` citation anywhere in the kickoff, and the file on disk is byte-identical to the pasted text. Recorded because the standing rule about checking a stated reason binds whatever produced it, and because the cost of not checking would have been an edit to the one artefact that was not to be edited.

### R-2026-09-22-58 — the snapshot Function keeps its direct origin; both handoffs land in PR 3.1; the tracked-entry guard comes forward because the stray recurred

_Issued as R-PROVISIONAL-2026-09-22-AK, by the founder on 2026-09-22, answering the two questions PR 3.1 could not settle from the kickoff. Number assigned on landing from the record's last as read on this branch: R-2026-09-22-57. **Record-only under R-46; lands in PR 3.1.** Next provisional letter: AL._

**EVIDENCE KINDS.** Clauses **A**, **B** and **C** are the founder's, recorded **as given**. Clause **D** is mine: what checking C's premise found. The H1 reading A1 depends on is **the founder's and has not been taken yet** — it is named as owed below, not assumed.

**A — THE PUBLIC DASHBOARD'S SNAPSHOT FUNCTION KEEPS ITS DIRECT ORIGIN: a narrow exception to `-55 A`.**

- **A1 — the property.** PR 3.1 changes **nothing** about which origin `/beds.json`'s Function calls. Its origin moves into the tracked build configuration **under its own key**, set to exactly the founder's H1 reading, recorded in the clause as the founder's reading. **A test asserts the Function's origin comes from that tracked key and not from the Pages environment**, so Finding D closes for Functions too. Only the secret stays in the Pages environment. The implementer proposes the mechanism.
- **A2 — the reason.** `-55 A`'s three reasons — ISP blocks of `*.supabase.co`, portability, somewhere to put rate limits — **are about browser traffic**. A server-side call from Cloudflare is not exposed to an ISP block, is portable as one tracked line, and is already cached to one origin read per interval. Putting the Worker on the `/beds.json` path would add a failure point while `-23 D5` (availability) is open.
- **A3 — the scope of the exception** is the public dashboard's snapshot Function **only**. Every browser call still goes through `api.openbed.ng`. **The admin provisioning Function of `-57 D4` is not decided here**; the implementer states its choice and reason in PR 3.4's design report.
- **A4 — `-57 E` is amended by this clause.** "Every server-side call" now reads *every server-side call except the public dashboard's snapshot Function*. **The kickoff is committed as pasted; the record carries the amendment** — the document is not edited to match a later state.
- **A5 — the consequence for PR 3.3.** The allow-list is derived **only from calls that go through `api.openbed.ng`**. The coverage test attributes each call site to the origin it uses, and a path called only through the direct origin is **not** listed. Plant: a direct-origin-only path added to the list turns the coverage test red.
- **A6 — the exception ends when `-23 D5` closes.** Moving the Function onto the Worker is then its own change with its own ruling. **That is the recorded trigger.**

**B — BOTH HANDOFFS LAND IN PR 3.1.**

- **B1.** docs/handoff-2026-09-22-infra-review-closed.md — **written without backticks, because it does not exist yet and a backticked path would be a Clause 4 phantom**, the same reason `-56`-era drafts were cited that way — written from the founder's paste, unedited. **There was never a copy on the device; the kickoff's wording was right.**
- **B2.** docs/handoff-2026-09-22-bundle3-kicked-off.md, without backticks for the same reason, is added in PR 3.1 as well, from the founder's paste, unedited, per its own text that it lands with the next substantive change. It joins the record carrier's list.
- **B3.** The stray copy that appeared in the untracked working-tree directory is diffed against the pasted copy and the result quoted, empty or not. **The pasted copy is authoritative either way.** The directory is then removed from the working tree — it is untracked, so there is nothing to `git rm` — and `git status --porcelain` is quoted showing nothing outside the claimed paths.
- **B4 — for the PR body:** a Cowork-written file appeared in that directory **a second time**, which is Cowork error (a) recurring. It was caught by named-path staging, **not by any mechanical check**, and the reading that the file was there was **the implementer's**.

**C — THE TOP-LEVEL TRACKED-ENTRY GUARD COMES INTO PR 3.1 NOW.**

- **C1 — the reason.** The same stray path recurred. **Named-path staging is a habit, not a check**, and the first occurrence did reach a commit. The trigger's spirit is met; it is resolved in this pass rather than left waiting for a third.
- **C2 — the property.** The set of top-level tracked entries is a **closed, named list, checked by identity rather than count** (test-conventions §3). Failing half: a planted staged stray at the top level turns it red, quoted, then green once removed. The implementer proposes the mechanism. Guard-only, no runtime effect, so it fits PR 3.1's character.
- **C3.** "Top-level tracked-entry guard" is removed from the open items when it lands.

- **C3a — DISCHARGED 2026-09-22, and where.** The guard is `tests/compliance/top_level_tracked_entries.test.ts`: it reads the top-level components of `git ls-files` — **the INDEX, not `HEAD`**, so a stray is caught before the commit that would carry it rather than one commit too late, which is how the first instance happened — and compares them against a checked-in list of the 25 entries by identity. **The failing half was run against the real repository**, not only a scratch one: staging `Claude outputs/x.md` reds it with the stray named in the diff, and unstaging restores green.

  **The open item lives in the kickoff, which is committed UNEDITED**, so it is closed here rather than struck there. The kickoff's carried-items paragraph still reads *"still an open item (trigger: next stray path found in a commit)"*; **that sentence is superseded by this clause and by `C1`**, and a reader who arrives at it from the kickoff should land here.

  **Two limits are named in the guard's own header rather than left to be assumed.** It sees the index, so an **untracked** stray is invisible to it — that case is covered bluntly by `scripts/deploy_pages.sh`, which refuses any non-empty `git status --porcelain`. And it says nothing about what is committed INSIDE a recorded directory; a stray under `docs/` would not red it.

**D — C1's PREMISE, CHECKED HERE, AND IT IS SHARPER THAN STATED.** C1 says the first occurrence *"did reach a commit (38440e7)"*. **It holds.** `38440e7` added the boundary-closed handoff under that untracked top-level directory — a path outside the twelve tracked directories — and it was remedied two commits later, in `999dd50`, whose subject records it. So the recurrence C1 reasons from is the **second** instance of a defect that has now been committed once and staged once, and **neither was caught by anything except a person looking.** That is the case for C2 rather than against it.

**E — WHAT IS OWED BEFORE THE CLAUSES ABOVE CAN BE DISCHARGED**, named rather than assumed:
- **the two handoff pastes** (B1, B2), without which that commit cannot be written and B3's diff has nothing authoritative to run against;
- **the H1 reading** — the `SUPABASE_URL` value on the `openbed-public-dashboard` Pages project, a URL and not a secret — without which A1's tracked key has no production value. **A placeholder is not an option here:** the whole property A1 asserts is that the tracked value equals what the Function calls today, and a guessed value would satisfy every test in the repository while being false at the edge.

### R-2026-09-22-59 — H1 could not be performed; the Function's origin is set from Supabase's own project URL, and the Pages secret becomes dead config

_Issued as R-PROVISIONAL-2026-09-22-AN, by the founder on 2026-09-22, after attempting the H1 reading `-58 A1` depends on. Number assigned on landing from the record's last as read on this branch: R-2026-09-22-58. **Record-only under R-46; lands in PR 3.1.** Next provisional letter: AP — O stays skipped._

**EVIDENCE KINDS.** `A` is the founder's reading, recorded as given. `B1`'s value arrived as **Cowork's** reading through the Supabase connector and **was re-read here before it was written into any file** — see `D`. `C` is the founder's instruction. `D` is mine.

**A — WHAT WAS FOUND.** `SUPABASE_URL` on `openbed-public-dashboard` is an **encrypted secret**, and its value **cannot be read back in the Cloudflare dashboard**. **H1 as written in the kickoff was not performable**, and it is recorded as **Cowork's defect: H1 assumed a readable variable.** The step is not restated more carefully; the thing it asked for does not exist.

**B — `-58 A1` IS AMENDED.**

- **B1.** The tracked key for the snapshot Function's origin is **`https://klrlpxysjsjpdkeqdhvl.supabase.co`**, on Cowork's reading of the project URL through the Supabase connector, 2026-09-22.
- **B2 — AND THE CLAIM THAT REPLACES IT IS WEAKER, DELIBERATELY.** `-58 A1` said *"PR 3.1 changes nothing about which origin `/beds.json`'s Function calls."* **That sentence cannot be made true or false, because the prior value was never read.** What replaces it: **the END STATE is that the Function calls the direct Supabase origin, as `-58` decided.** Whether that is a *change* from today is **unknown**. If the secret held `https://api.openbed.ng`, this pull request takes the Worker **off** the `/beds.json` path — which is `-58`'s intent, arrived at without anyone being able to confirm it was needed. **It goes in the PR body in those words**, rather than as a claim about what the Function used to do.
- **B3.** `-58 A1`'s test still holds: the Function takes its origin from the tracked key and **never** from the Pages environment. **No code path may fall back to `env.SUPABASE_URL`.**

**C — THE LEFTOVER SECRET.**

- **C1.** Every reader of `SUPABASE_URL` across the apps, the Functions and the wrangler configuration is reported. **If nothing reads it after this pull request, it is dead config.**
- **C2 — OWED to the founder after the PR 3.1 deploy, in this order:** `/beds.json` returns **200 with a valid payload** and `/version.json` quotes the deployed commit; **only then** is `SUPABASE_URL` deleted from the Pages project. Written as a runbook step **with the `/beds.json` read as its precondition**.
- **C3.** PR 3.1 no longer waits on anything from the founder.

**D — B1's VALUE WAS RE-READ HERE BEFORE IT WAS WRITTEN INTO ANYTHING, and it holds.** `-56 A10c` requires a clause resting on someone else's reading to say so; the stronger move, where the reading is cheap and the value is about to be compiled into every artefact this project ships, is to take it again. `get_project_url` for `klrlpxysjsjpdkeqdhvl` returns **`https://klrlpxysjsjpdkeqdhvl.supabase.co`**, read here on 2026-09-22.

**And it agrees with a value this repository already tracks.** `supabase-proxy/index.js` carries `SUPABASE_PROJECT_ID = "klrlpxysjsjpdkeqdhvl"` and builds the same origin from it. **That agreement is the finding worth recording, because it also names a hazard `B1` does not:** the origin now has **two derivation sites in tracked code** — the proxy's project id and the new tracked configuration — and §7 of `.claude/rules/test-conventions.md` governs exactly that. They are bound by an assertion in one block rather than left to agree by coincidence. The proxy is **not** made to import the package: it sits outside the npm workspaces and is deployed by `wrangler deploy`, so binding it by import would be a far larger change than this one wants.

**E — AND ONE HAZARD FOUND WHILE DESIGNING AGAINST `B3`, recorded because it is the kind that ships green.** Moving the origin off the environment and onto the request's hostname changes what two existing database tests address. `tests/db/beds_json_served.test.ts` has two legs that call the cached path with **no stubbed fetch**, against a helper whose request URL is a non-local host. Today their target is the local stack, because the origin came from the environment those tests construct. Under host-based selection their target becomes **the live hosted project, authenticated with the local demo service-role key**. Nothing in the suite would have said so: both legs assert a 200 and a header. **The helper is made local, and asserted local, in its own commit BEFORE the origin moves** — the ordering is the point, because the window in which this is wrong is a window in which the tests still pass.

### R-2026-09-22-60 — a production build must read no untracked source; the whole-env inlining is removed at its cause

_Issued as R-PROVISIONAL-2026-09-22-AP, by the founder on 2026-09-22, on a finding of mine reported with `R-2026-09-22-59`'s last commit. Number assigned on landing from the record's last as read on this branch: R-2026-09-22-59. **Record-only under R-46; lands in PR 3.1.**_

**A — THE FINDING, WHICH IS MINE AND WAS RECORDED BEFORE IT WAS RULED ON.** Vite inlines the **whole** `import.meta.env` record, not only the keys a module reads. So a stale `VITE_SUPABASE_URL` in the untracked apps/ward-console/.env.local ships inside the built bundle — `api.openbed.ng` appears there four times, two of them from that file rather than from tracked configuration. **The marker legs added in `-57`/`-58` prove `origins.json` is USED; they never proved untracked values are KEPT OUT.** The value happens to agree today. A developer's local file can still change what production talks to, and **that is Finding D's hazard surviving the change that was supposed to close it.**

**B — THE PROPERTY, for every Pages app** — the public dashboard, the ward console, and the admin app when PR 3.4 adds it. **A production build's output contains no value sourced from any untracked file; what the bundle talks to comes from tracked files only.** Its failing half is a planted `.env.local` and, separately, a planted `.env.production.local` carrying a sentinel, shown red against the configuration as it stands and green after. The cause in the code is removed as well as guarded, and named. The mechanism is the implementer's to propose, and **a wrapper refusing to build while a developer's file exists is acceptable if that is the cleaner guarantee.** The founder's own `.env` files are NOT deleted; if the fix makes them unused they are listed, and the founder removes them.

**C — THE PR 3.1 REPORT** carries `AL`'s C1–C9 together with B's plants, and the pull request opens only when those are quoted. No merge without the founder's word; Cowork reads the files before that word.

**D — THE CAUSE, ESTABLISHED RATHER THAN GUESSED, and one of my own premises refuted in the process.** B asked for the code reference that makes Vite inline the whole record, if there is one. **There is: bracket notation.** `apps/ward-console/src/main.ts` reads `import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY']`, and Vite defines two different keys — a per-variable `import.meta.env.<NAME>`, which collapses to one string, and a bare `import.meta.env`, which is the entire serialized record. **A bracket access matches only the second.** Read in the pinned Vite 8.2.2's own installed source, not inferred from documentation.

**I had assumed bracket notation was forced by a compiler option, and it was not.** `noPropertyAccessFromIndexSignature` is set in no tsconfig in this repository, and dot access typechecks today unchanged — verified by running this project's exact compiler options against both forms. It was habit, not constraint. **Recorded because the wrong reason would have survived the right fix:** anyone later re-reading `import.meta.env` would have reached for brackets again, believing the type system required it.

**E — AND ONE THING `B`'s WORDING WOULD NOT HAVE ACHIEVED ON ITS OWN.** Disabling `.env` file loading closes the file half and **not** the shell half: Vite copies every `VITE_`-prefixed entry of `process.env` into the record afterwards, and it **outranks every file**. So "no untracked FILE" is reachable by configuration while "the output is the same whatever is set in the shell" is not, and the two must be named separately. `R-2026-09-22-61 B3` is where that second half is required.

### R-2026-09-22-61 — the publishable key is TRACKED; what it supersedes is mine, not the record's

_Issued as R-PROVISIONAL-2026-09-22-AQ, by the founder on 2026-09-22, answering the question `-60` left open — where a production build gets the key once it may read no untracked file. Number assigned on landing from the record's last as read on this branch: R-2026-09-22-60. **Record-only under R-46; lands in PR 3.1.** Next provisional letter: AR._

**A — THE DECISION.**

- **A1 — the basis.** The key **ships in every client bundle by design**, so the repository holding it exposes nothing new. Tracking it means **the stamped commit fully determines the built bundle**, and it removes a hand-carried step from every deploy.
- **A2 — WHAT IT SUPERSEDES, AND THE ATTRIBUTION IS CORRECTED HERE.** The ruling instructs that any line in `-57`/`-58` saying the key must not live in the repository is superseded, and asks for that line to be named — noting that Cowork had not read those blocks' landed text and that the attribution was mine. **The attribution is mine, and the location is narrower than the instruction assumed: THERE IS NO SUCH LINE IN EITHER BLOCK.** Both were read here, in full, before this clause was written. What is superseded is **code and a template I wrote in the same session**: the ward console's `.env.example` in its entirety — written here without backticks because it no longer exists, and a backticked path to an absent file is the Clause 4 phantom — and the paragraph in `apps/ward-console/src/main.ts` beginning *"THE KEY IS DELIBERATELY STILL AN ENVIRONMENT VARIABLE"*.

**The paragraph is rewritten; the template is DELETED, and the asymmetry is deliberate.** A comment that records why a decision was reversed is worth keeping. A template whose whole content was one variable name is not, once no variable exists: it would stand in the repository instructing a reader to create a file that nothing reads, which is an instruction that cannot be carried out — the phantom in its most ordinary form. **Corrected here after the fact**: this clause first said both were rewritten, which was written before the deletion and was wrong by the time it landed, and `tests/compliance/no_phantom_paths.test.ts` caught the citation.

  **The objection that paragraph raised is answered rather than ignored**, which is why A3 exists: it argued that a tracked key makes the repository the place a **stale** key lives, and a dead key fails at authentication in a way that reads exactly like the boundary holding. A3 is what stops that.
- **A3 — the rotation runbook is restated**, so a rotation updates this **one tracked line in the same change**, and the restated step is quoted in the report.

**B — THE GUARDS, each with a failing half shown red then green.**

- **B1.** The tracked value is a **publishable or legacy anon** key and never a secret or service-role key, recognised **by kind and never by length**: an `sb_secret_` prefix refused and `sb_publishable_` accepted, and a JWT **decoded** so its payload `role` is asserted to be `anon` rather than `service_role`. Plant: a service-role-shaped value in the tracked slot turns it red.
- **B2.** `scripts/lint_no_secrets.sh` is **not widened in general**. Its exemption is **by named file and named key**, with A1 written into the script as the stated basis. The list is pinned by identity, so a third entry is a visible act.
- **B3 — `-60 B` extended to the process environment:** a production build's output is the same **whatever is set in the shell**. Plant: export a `VITE_` sentinel before building and assert it is absent from the output. A wrapper refusing while any `VITE_*` is set is acceptable if Vite cannot be made to ignore it cleanly; **the mechanism chosen must be stated with its reason.**
- **B4.** Disabling `.env`-file loading on production builds **stays**, and `-60 B`'s two file plants stand alongside it.

**C — THE REPORT** carries `AL`'s C1–C9 (C9 as amended by `AM` B6), `-60 B`'s plants and B1–B3 above. The pull request opens when those are quoted.

**D — THE TWO LETTERS THAT NEVER ARRIVED, and the ledger's own rule applied.** `AL` and `AM` were issued by Cowork **before** `AN` and were never pasted into this session. The ledger states that *a letter with no row either never arrived or has not landed yet, and Cowork can be told which* — and Cowork was told: no text for either has ever reached the implementer, and nothing in this repository mentions them. **They are therefore numbered from the record's last when their text lands, which will be AFTER `-60` and `-61` rather than before**, and their ledger rows record that they were issued earlier than the numbers they carry. **`C` cannot be discharged until `AL`'s text exists**, which is the one thing still holding the pull request shut.

### R-2026-09-22-62 — the USAGE control's remaining gap is closed here, and the PR 3.1 report must quote rather than state

_Issued as R-PROVISIONAL-2026-09-22-AL, by Cowork on 2026-09-22, **before `AN`**, and not pasted into this session until 2026-09-23 — `-61 D` records that it had not arrived. Number assigned on landing from the record's last as read on this branch: R-2026-09-22-61. **It therefore carries a number later than rulings issued after it**, and its ledger row says so. **Record-only under R-46; lands in PR 3.1.**_

**EVIDENCE KINDS.** A, B and C are Cowork's, recorded as given. D is mine.

**A — `-57 G5`'s GAP IS CLOSED IN THIS PULL REQUEST, not carried as an open item.**

- **A1.** The USAGE test must turn **red** if the privilege it checks is changed to any other valid schema privilege — `CREATE` being the case measured in `-57 G5`. A control that stays true under that swap does not prove the test is about USAGE. The mechanism is the implementer's; one shape that meets it is a control subject that holds USAGE and **not** CREATE on `app`. The swap is shown as the failing half, quoted, then green restored.
- **A2.** If a catalogue read of the schema's ACL — every privilege type at once, for `anon`, `authenticated` and `PUBLIC` — closes the property more directly, use it. **Keep `has_schema_privilege` where it adds the membership-inheritance case the ACL read cannot see.**
- **A3.** `-57 G5` records this as closed by this ruling.

**B — COWORK'S ERRORS, for the pull-request body; listed, not fixed in the record text.**

- **B1.** The claim that a misspelled privilege string *"would read as the boundary holding"* came from Cowork and was never tested. Measured here (`-57 G5`): `has_schema_privilege` **raises** on it. The same class as Cowork error (c): check that a stated failure mode actually happens before citing it.
- **B2.** The kickoff's Clause 4 scope defect — a gitignored path in backticks (`-57 G3`) — is Cowork's, and the path is named in the pull-request body.

**C — THE PR 3.1 REPORT QUOTES, IT DOES NOT STATE.** C1 branch, HEAD, push state and `git log --oneline main..HEAD`. C2 `git diff -M --name-status main...HEAD` against the claimed paths, plus the per-commit staged-path comparisons. C3 whether `scripts/commit.sh` is new; if new, its basis in the record. C4 every plant red then green — the RLS lint without ENABLE and separately without FORCE, the top-level set's planted stray, the credential scan once per app, the wrapper refusing an unknown app, a stale stamp refused by name at upload, and the USAGE swap. C5 `build_stamp` green across a commit made after a build, as a sequence with output. C6 the wrapper deploying both apps against the stub, every pre-existing `deploy_guards.test.ts` leg named, each stamped app's `version.json` ignored with its untracked leg. C7 the Cloudflare runbook's deploy command restated. C8 Standard O on a freshly provisioned database with its prediction. **C9 as amended by `-63 B6`:** `git status --porcelain` with the untracked Cowork directory gone.

**D — C3's PREMISE, READ BEFORE THE CLAUSE WAS WRITTEN.** `scripts/commit.sh` is **not new**: it entered in `c843745` on 2026-09-11 and is already on `main`. The "if new, its basis" branch does not apply, and the report says so rather than inventing a basis for something that needed none.

**E — WHAT BUILDING A FOUND, both by planting rather than by reading, and neither predicted.**

**E1 — `-57 G5`'s gap was real, but for a narrower reason than it gave.** `G5` said a CREATE swap would go undetected *"because `postgres` holds CREATE on `app`"*. **The control at that time was not `postgres`.** It was the first role alphabetically holding USAGE — `pg_read_all_data`, which sorts before `postgres` and holds USAGE but **not** CREATE. Measured, against the old test itself (`702f061`) rather than a spot query:

- a swap of the **probe calls alone** would have reddened it — the control answers false for CREATE;
- a swap that **also rewrites the control's selection criterion** (all four `'app', 'USAGE'` sites) makes selection pick a role that does hold CREATE, and **the old test stayed green, 10 of 10.** That was the gap.

**The new test reds under both shapes**: the constant alone turns the control false; the constant plus the selection leaves no subject that holds USAGE without CREATE, and the test says so by name. **The lesson is `-57 G5`'s own, applied to itself:** it measured a failure mode with a psql spot-check against a role it assumed was the control, and the conclusion survived only because a second shape happened to produce it.

**E2 — THE ACL READ WAS BLIND TO PUBLIC ON ITS FIRST VERSION**, which is the one grantee A2 asked it for. It labelled grantees with `coalesce(nullif(pg_get_userbyid(grantee), ''), 'PUBLIC')`, on the assumption that the lookup returns an empty string for OID 0. **It returns `'unknown (OID=0)'`.** So PUBLIC was never labelled, the filter could never match it, and **a real `GRANT USAGE ON SCHEMA app TO PUBLIC` passed the guard, twelve of twelve green.** It is now mapped by OID; the in-test plant grants to PUBLIC as well as `anon` and reads through the **same SQL text** as the leg, so a defect in the read reds its own plant. Re-planted: PUBLIC reds it, and so does a CREATE granted to `authenticated` — a non-USAGE privilege the per-role probe would never have asked about.

**E3 — B2's DEFECT, COMMITTED TWICE BY THE IMPLEMENTER, AND THE GUARD'S BLIND SPOT BEHIND IT, added 2026-09-23 after PR 3.1's first CI run.** `compliance-tests` went red on #64 while passing on this machine at the same commit. `tests/compliance/no_phantom_paths.test.ts` reported the ward console's .env.local — cited here without backticks for the reason that follows — as a phantom, **cited in backticks by me** in `-60 A` and in a test header. It is gitignored: present on the founder's machine, absent in CI. **The same defect as B2's, which I had listed against the kickoff while committing it myself.**

**The cause is in the guard, not only in the two lines.** It tested existence with `existsSync`, so a gitignored file on the developer's disk passed here and failed in CI: **its verdict depended on whose machine ran it.** Three instances made it a class. Both citations are unquoted, and the guard now refuses a backticked citation of any gitignored, untracked path **whatever the local disk holds**, which is what Clause 4's scope note already required in prose. Shown red on this machine with the file present — the condition under which the old check passed — then green. **The kickoff's own instance is exempted by file, not by path**, because that document is committed byte-identical; the same path cited anywhere else is still refused, and removing the exemption reds it.

### R-2026-09-22-63 — Cowork handoffs no longer enter the repository

_Issued as R-PROVISIONAL-2026-09-22-AM, by the founder on 2026-09-22, **before `AN`**, and not pasted until 2026-09-23. Number assigned on landing from the record's last as read on this branch: R-2026-09-22-62. Its ledger row records the out-of-order landing. **Record-only under R-46; lands in PR 3.1.**_

**A — THE RULE (the founder's decision).**

- **A1.** Cowork handoff documents are Cowork-to-Cowork continuity documents. They live in the Cowork project only and are **not** committed to `docs/`. The repository's record is this decision record and the committed kickoffs; a handoff is a second-hand summary of them.
- **A2 — the reason.** Committing them produced the same stray path twice, needed a founder paste and a byte-identity check per pull request, and put Cowork's session-state claims into the record, where they then needed correcting.
- **A3.** Handoffs already under `docs/` stay as history and are not edited or removed. The implementer's own handoffs are not covered by this ruling.

**B — WHAT CHANGES IN PR 3.1.**

- **B1.** `-58 B1` and `B2` are **withdrawn**: neither Cowork handoff enters `docs/`, and nothing is pasted for that purpose.
- **B2.** `-58 B3` is **replaced**: the untracked Cowork directory is removed from the working tree with **no diff owed**, since the authoritative copy is in the Cowork project. `git status --porcelain` is quoted before and after.
- **B3.** The committed kickoff still says PR 3.1 carries the infra-review-closed handoff. **The kickoff stays byte-identical; this clause is what supersedes that line**, and the pull-request body says so.
- **B4.** `-58 C`, the top-level closed set, **stands** — it guards against any stray path, not only handoffs.
- **B5.** Before relying on A1, the two Cowork handoffs' facts were checked against the record — see D.
- **B6.** `-62 C9` now reads: `git status --porcelain` with the untracked Cowork directory gone; no diff is owed.

**C — WHAT IS WITHDRAWN, SO IT IS FINDABLE.** `-58 B1`, `B2` and `B3`, and the kickoff's carried-items clause naming the infra-review handoff. `-61 D`'s statement that `AL` and `AM` had not arrived is **discharged** by their landing here, not contradicted by it.

**D — B5, DONE, AND IT FOUND TWO FACTS WITH NO HOME.**

**`handoff-2026-09-22-bundle3-kicked-off`** was read on disk before removal. Every fact a later reader would need already has a home: the ward's missing new-link path in `-57 F2`; `enable_signup` and H2 in the committed kickoff; the top-level guard's discharge in `-58 C3a`. What has no home is Cowork's own process notes — a near-miss about `facility_ops` and a relabelling of hosted steps — which never reached this repository and are expected to have none.

**`handoff-2026-09-22-infra-review-closed`** was pasted for comparison only and is not committed. **The paste arrived TRUNCATED**, ending mid-sentence in its "Fundamental" section; **this check covers what arrived and nothing after that point.** Its facts were compared against `-53` to `-56`, and each absence below was **confirmed by reading `-56 A3` and `A3b` in full, with a known-present phrase found as a control** — not inferred from a failed search.

**Two facts had no home, and they are given one here, each as what it is: a founder reading relayed through a Cowork handoff, NOT re-read by the implementer.**

- **D1 — "`openbed-ward-console` is built against `https://api.openbed.ng`."** `-56 A3` records only that the project has no custom domain and cannot be deployed through the wrapper; **`A3b` says outright that which commit is deployed was not reported.** So this is the **only statement anywhere of what the CURRENTLY DEPLOYED ward console talks to** — the question Finding D existed to answer. **It matters beyond bookkeeping:** the tracked origin of `-57`/`-59` governs builds made from now on; it says nothing about a deployment made before it. The first deploy through the wrapper (H4), read back per `-64`, replaces this relayed claim with a reading.
- **D2 — "Hosted counts: 0 `ward_account`s; 1 auth user."** The record has the `ward_account` count and has `security@openbed.ng` as the §9 test account, but **no total of auth users**. That total is **H2's baseline**: if hosted sign-up is enabled, it is the number that shows nobody has self-registered, and a later reading above one is the signal to look.

Everything else in what arrived has a home: the Worker's deployed source matching the repository (`-55`/`-56`), `openbedng` deleted (`-56 A2`, `A10b`), DNS (`A4`), SSL (`A5`, `A10a`), the test account (`A6`), `ensure_rls` and its inert PUBLIC EXECUTE (`A7`), the magic-link host and its custom-domain end state (`-55 C`), Cowork's on-device verification of `999dd50` (`-54`), and the widened grant check, which the handoff says was "not yet in a ruling" and is now `-57 A2`.

### R-2026-09-23-64 — the live-key probe runs on every ward-console deploy, not only on rotation

_Issued as R-PROVISIONAL-2026-09-23-AR, by Cowork on 2026-09-23, on a finding of mine in `-61`'s rotation step. Number assigned on landing from the record's last as read on this branch: R-2026-09-22-63. First ruling dated 2026-09-23. **Record-only under R-46; lands in PR 3.1.** Next provisional letter: AS._

**A — THE RULE.**

- **A1.** The finding stands: **no test in this repository can tell a live key from a dead one.** So the edge probe is the only check, and it belongs in the ward console's **deploy read-back** — H4's first deploy included — not only in the rotation step.
- **A2 — the property.** After a ward-console deploy, **the key in the deployed bundle is accepted at the edge.** Failing half, in the same sitting: the same request with a deliberately wrong key is refused. Both pass signals are written exactly, and the rotation step points at this read-back rather than carrying its own copy.
- **A3.** If the probe as written already met A2, say so and quote it; do not duplicate it.

**B — A3 ANSWERED: IT DID NOT.** The rotation step said *"the signal is the ward console signing in"* — which names no exact signal and has no failing half. The read-back is written fresh, and the rotation step now points at it.

**C — THE SIGNALS WERE OBSERVED BEFORE THEY WERE WRITTEN, and the observation changed the endpoint.** Read against `https://api.openbed.ng` on 2026-09-23, with the tracked key, a deliberately wrong key, and none:

| Endpoint | tracked key | wrong key | no key |
|---|---|---|---|
| `/rest/v1/` | **401** `"Secret API key required"` | **401** `"Invalid API key"` | 401 `"No API key found in request"` |
| `/auth/v1/settings` | **200**, body begins `{"external":` | **401** `"Invalid API key"` | 401 `"No API key found in request"` |

**At the PostgREST root a live key and a dead key both return 401.** A status-only probe there would certify a dead key as live — the body is the only thing that tells them apart. `/auth/v1/settings` separates them by status **and** body, so it is the probe. It is a settings read, **not a sign-in**: it sends no email and does not exercise the per-IP auth limits `R-2026-09-19-23 D4` forbids touching.

**D — one trap met while taking that reading, recorded because it looks like a network failure.** The first attempt used a loop variable named `path`, which in zsh is tied to `$PATH`; assigning it emptied the search path, and every `curl` reported *command not found*. **No request was sent.** The runbook fence avoids the name.

### R-2026-09-23-65 — Cowork's file review of PR 3.1: three fixes in one commit, one probe path recorded for PR 3.3

_Issued as R-PROVISIONAL-2026-09-23-AS, by Cowork on 2026-09-23, on its own reading of the files at `fbb0655`. Number assigned on landing from the record's last as read on this branch: R-2026-09-23-64. **Record-only under R-46; lands in PR 3.1, in the one fix commit it asks for.** Next provisional letter: AT._

**BASIS — Cowork's reading, not taken here.** Cowork cloned the public repository at `fbb0655` and read the files. It confirmed independently: the 51 paths in `main...HEAD`; no stray top-level entry; the production value in `packages/origins/publishable-keys.json` equal to Supabase's live default publishable key (the legacy anon JWT is disabled there); `origins.json`'s `supabaseDirect` equal to the project URL and to the deployed proxy's project id; `BedsEnv` carrying only the service-role key; the wrapper refusing an unknown app and reading the stamp back; the USAGE test meeting `-62 A1`; production `/beds.json` answering 200 on 2026-09-23. **Not independently read by Cowork: the seven CI results**, which remain the implementer's reading.

**A — FIX IN PR 3.1, ONE COMMIT, BEFORE THE FOUNDER'S MERGE WORD.**

- **A1.** Both `vite.config.ts` files say the no-`import.meta.env`-read property is asserted in `tracked_origins.test.ts`. It is asserted in `tests/compliance/tracked_client_keys.test.ts`. Correct both; say whether a guard could catch a comment naming a test file that does not hold the claimed assertion; do not build it here.
- **A2.** `scripts/lint_public_table_rls.sh` reads only the plain form. It does not see `CREATE UNLOGGED TABLE`, quoted identifiers, `ALTER TABLE … SET SCHEMA public`, or an unqualified `CREATE TABLE x AS`. For up migrations the catalogue test catches them; for down migrations nothing does. **The property: every form that can create or move a table into `public` is either paired and checked, or refused by name as unreadable.** Plant each form, red then green, quoted; pass over 001–018 unedited.
- **A3.** In `docs/runbook-cloudflare-pages-beds-json.md`, "step 8" names both section 8 and read-back 8; read-back 6's *"step 8 is what stops it recurring silently"* means read-back 8. Make every such reference unambiguous, and remove the duplicated `"dirty": true` paragraph. The restate rule applies to any guard that pins the text.
- **A4.** Report the commit's staged-path comparison, the A2 plants, the full gate, and CI on the new head.

**B — RECORDED FOR PR 3.3, NOT BUILT HERE.**

- **B1.** Step 3 of `docs/runbook-ward-console-deploy.md` probes `https://api.openbed.ng/auth/v1/settings`. Today the Worker forwards every path (Cowork read the deployed source). PR 3.3's allow-list is derived from code, and no code calls `/auth/v1/settings`, **so once 3.3 deploys the probe gets the Worker's 404 and every ward-console deploy reads STOP.**
- **B2 — the property for PR 3.3.** Every path a runbook probe calls through `api.openbed.ng` is either on the allow-list with its stated reason — the probe — or the probe moves. The coverage test sees runbook probe paths as well as code call sites, and a probe path missing from the list turns it red. **The implementer proposes the mechanism.**

**C — ONE QUESTION.** The AP B2 / AQ B3 sentinel plants were demonstrated once; the standing guards are structural, and the source scan covers `apps/`, not the packages an app imports. Does the bundle-level leg alone catch a future `import.meta.env` read in `packages/*`? If not, extend the scan in this commit.

**D — THE PREMISES, READ BEFORE ACTING (method note 20).**

- **A1 holds.** Line 20 of both configs; the assertion is `tracked_client_keys.test.ts`'s `'%s reads import.meta.env NOWHERE in its source'`, and `tracked_origins.test.ts` holds no such test.
- **A2 holds, and the gap was wider than listed.** The lint was a line-by-line grep. It also missed a `CREATE TABLE` split across lines, `SELECT … INTO public.x`, a top-level unqualified `SELECT INTO`, `CREATE FOREIGN TABLE`, `IMPORT FOREIGN SCHEMA … INTO public`, `CREATE`/`ALTER EXTENSION` into `public`, a `CREATE TABLE` inside `EXECUTE '…'`, and a `DISABLE` after the pairing. It also **refused a legitimate form**: `ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY` in one `ALTER TABLE`, valid SQL that sets both flags (observed locally before it was relied on). **Of 19 forms planted, 18 passed the `fbb0655` lint**; the nineteenth, `NO FORCE`, it already caught. The lint now lexes each file with an embedded perl lexer and classifies every form; all 19 are red as planted and green once corrected.
- **A2's "unedited" held, and it cost one named exemption.** The first run of the widened lint refused `017`'s `CREATE EXTENSION IF NOT EXISTS pg_cron`, which names no schema: **the guard refusing legitimate input**, and a line my corpus survey had missed. The local catalogue says pg_cron sits in `pg_catalog`, is not relocatable, and puts its four relations in schema `cron`. It is exempted **by name**, and only when no schema clause is given. Every other extension with no schema clause is refused.
- **A3 holds, and every number collided, not only 8.** Sections run 1–8 and read-backs 1–8 plus 5b, and the runbook called both "step N". Sections are now "section N", read-backs "read-back N", and a list item inside section 8 is "item 3 above". **"Steps 5, 5b and 6" in the status paragraph was resolved against `-47 D`**, which names 5b a read-back. A new guard, `tests/compliance/runbook_step_references.test.ts`, refuses any bare "step N" in that runbook, along with any paragraph that appears twice. **On its first run it found a reference the hand sweep had missed**, wrapped across a line break (*"(step⏎1's failure)"*), which a line-based search cannot see.
- **C — the bundle leg does NOT catch it, OBSERVED.** Four reads were planted in `packages/origins/src/index.ts` on the ward console's live path, built, and run against the bundle leg: `import.meta.env['X']` inlined the whole record and went red; **`.VITE_X`, `.MODE` and `.DEV` compiled to `""`, `"production"` and `false` and passed.** My own prediction was that `.VITE_X` would be caught, and it was wrong. The source scan now follows each app's import graph file by file into `packages/`, and the same `.MODE` plant reds it. **One more claim of mine fell while building it:** I had written that the public dashboard's Vite build reaches `packages/origins` through `serve.ts`'s relative import. It does not: `@openbed/snapshot`'s index re-exports only `codec.ts`, and `serve.ts` is reached by the Pages Function alone, which wrangler builds. The expected table records what was read.

**E — A1's QUESTION, ANSWERED; NOTHING BUILT.** The *existence* half of a test citation is already Clause 4's guard, `tests/compliance/no_phantom_paths.test.ts`. The *"holds the claimed assertion"* half is buildable **only with a convention**: cite the test by title — `asserted in <file> ("<test name>")` — and a guard checks the title is a `test(` or `test.each(` name in that file. Without the convention it needs a judgement about what a sentence means, and a guard claiming to make that judgement would be the phantom Clause 4 forbids. **One verb-led pattern finds at least 14 such citations in 11 tracked files outside the record and the handoffs, and that is a lower bound**: A1's own citation is not among them, because a comment marker splits it across lines. Adopting the convention is a separate change.

### R-2026-09-23-66 — A3 decided: the orphan fixed at source and dropped on the page; one number to call per facility; a ward asks for its own link

_Issued as R-PROVISIONAL-2026-09-23-AT, by Cowork on 2026-09-23: founder decisions on Cowork's recommendation, after a staff-engineer and a product/clinical review. Number assigned on landing from the record's last as read on this branch: R-2026-09-23-65. **Record-only under R-46; lands in PR 3.2.** Next provisional letter: AU._

**BASIS — Cowork's reading of `origin/main` `7c916f4`, confirmed by a staff-engineer review against the files; not taken here.** `app.project_facility` (008) writes `facility_public` before `ward_public` and deletes wards before the facility, in one transaction; `ward_public` has no FK to `facility_public` (007); `app.regenerate_snapshot` reads the two mirrors in TWO statements (016) with no isolation level set, every minute under pg_cron (017); `service_role` holds write privileges on both mirrors, so "single writer" is a convention; `app.facility.name` has no non-blank check (003). **Every one of those was re-read here before it was acted on, and each holds.**

**A — ROOT CAUSE, FIXED AT SOURCE (a new migration, the next free number).** A1: the generator reads both mirrors in ONE statement; keep the `SNAPSHOT_ROWS_DROPPED` checks; prove it red on the old generator and green on the new, deterministically if possible. A2: FK `ward_public(facility_id) → facility_public(facility_id)`, NOT DEFERRABLE, no cascade, behind a pre-check that fails loudly naming any orphan; plant a ward row for an absent facility. A3: `CHECK btrim(name) <> ''` on `app.facility`, NOT VALID then VALIDATE; plant a blank and a whitespace-only name. A4: do NOT add a generator assertion that refuses the snapshot on an orphan — a failed run shows only in `cron.job_run_details`, old snapshots are kept until a success, `serve.ts` serves the newest row with no age check and the page shows no age, so the public would see frozen counts with no hint; record the reason next to A1. A5: the frozen boundary and the `-45` gate apply as for 018; the hosted apply is the founder's.

**B — THE PAGE.** B1: a ward whose facility is missing, or whose name is blank or whitespace, is NOT rendered — no sentence, no count; `console.error` without the count; one function decides for every renderer. B2 (SAFETY): if every ward is dropped, render the outage/degraded state, asserted on the rendered page (`-29 E2`). B3: the proposed explanatory sentence is withdrawn — a crew cannot act on an unidentified ward, and the case should be unreachable once A1–A2 land.

**C — THE PHONE, NOW, MINIMAL.** C1: one tap-to-call link per facility beside its name, `tel:` from `public_phone_e164`, the number visible, labelled "Call to confirm beds", tap target at least 44px; 112 / 767 stay where they are. C2: not now — the tile, call tracking, WhatsApp/SMS, wording suggesting a call reserves a bed, any phone for a dropped ward. C3: rendered-page tests; a mismatched href turns them red. **C4 — OPEN, FOUNDER-SIDE, FOR FACILITY ONE:** onboarding confirms the number is answered 24/7 by someone who can confirm bed status, with a test call. E.164 validity proves only the format.

**D — FIND, DON'T BUILD: HOW OLD A COUNT IS.** Where does the record decide what the PUBLIC sees about age before facility one?

**E — COWORK'S CORRECTION.** Its merge instruction for #64 listed `b7a8490` as a record citation; it is not one. The implementer's reading stands.

**F — WHAT LANDED, and the premises that did not hold as stated.**

- **A1 — demonstrated deterministically, not argued.** `tests/db/snapshot_single_read.test.ts` takes each generator body FROM ITS MIGRATION FILE, plants `pg_advisory_xact_lock(K)` at a seam, and has a second connection commit a newly visible facility and ward while the first waits there — confirmed from `pg_locks`, not by sleeping. **016's body with the lock between its two reads produces a ward whose facility is absent from the payload (RED); 019's body with the lock before its one read, and after it, produces none (GREEN).** The RED leg runs with the FK in place, which is the proof that the single read, not the constraint, closes the race. A structural leg asserts the live generator reads both mirrors in one statement, and that the checker sees 016's two.
- **016's header was NOT wrong, and a first reading here said it was.** Its "the two cannot disagree" is about each mirror's read against its own encoded array, within one statement, and it holds. 016 never claimed the two MIRRORS agree with each other; the torn read was unaddressed, not misdescribed. Recorded because the plan written before the change said otherwise.
- **A3's text would not have met A3's own plant.** OBSERVED on the local stack (PostgreSQL 17.6, `en_US.UTF-8`): `btrim(name)` with no second argument strips ONLY spaces, so a tab-only, newline-only or no-break-space-only name passes `btrim(name) <> ''`. The CHECK is `name ~ '[^[:space:]]'`, which refused all five blank plants there. **Whether `[:space:]` matches U+00A0 on the hosted project depends on its ctype, not observed.**
- **The migration is `019_snapshot_single_read_and_mirror_integrity.sql`, and so PR 3.4's migration becomes 020.** The Bundle 3 kickoff calls the operator functions "migration 019" (its PR 3.4 section); the kickoff is left as committed and **this line supersedes that number**. Its instruction to read how the AE placeholder leg behaves when a real `019_*` exists was carried out here instead: `frozen_migrations.test.ts` stayed green with 019 present, observed.
- **The pre-checks are planted too.** `tests/db/migration_019_round_trip.test.ts` reverses 019, commits an orphaned ward row, and the forward apply refuses with `MIRROR_ORPHANS` naming it; the same for a blank name and `FACILITY_NAME_BLANK`. Reversal restores 016's body exactly (copied from 016, compared byte for byte), and a tampered reversal is refused.
- **Runbook step 5 restated at all three sites in the change that adds 019** — one pending migration, named — with the eight legs of its guard restated to that state, none loosened.
- **B's identity function also requires a number to call.** B1 names a missing facility and a blank name; the page's `callableIdentity()` also refuses a facility with no `public_phone_e164`, because C1's link cannot render without it. **That third condition is the implementer's reading of C1, not the ruling's text.** 007 makes the column NOT NULL, so it is expected never to fire.
- **The page carries the app's first CSS**: one rule sizing the call link. The 44px is asserted from `index.html`'s text; nothing here measures a rendered page.

**G — THE REST OF PR 3.2, on the founder's two answers this session.**

- **The kickoff's blast-radius line was wrong.** It says `tests/e2e/golden-path.test.ts` "drives this screen". No golden-path step renders the ward console; its publish steps call the RPCs directly. The console had **no rendered test at all** until `tests/compliance/ward_console_render.test.ts`.
- **D1 had a third site the kickoff did not name**: the bad-link screen printed GoTrue's own error text from the URL fragment. All three sites now show fixed sentences, and the message table is asserted to cover exactly the codes `app.assert_member`, `public.my_facility_wards` and `public.publish_ward_status` can raise.
- **"Phone the OpenBed operator" names no number, because none exists in this repository.** An operator contact number is an open item before facility one.
- **Two publish-form defects, fixed on the founder's answer.** The count input was required and always sent, so **every NOT_OFFERED publish violated 004's `ward_status_not_offered_has_no_count` — no ward could publish NOT_OFFERED at all**; it now sends a null count and `accepting=false` (a service the ward does not offer is not one it is accepting patients for — the implementer's choice, the server accepts either). And the zero-beds reason was free text cast to `app.zero_reason`, refused unless it was an exact enum label; it is now a choice of the eight values.
- **The mail catcher is on, on the founder's answer**, superseding the case against it in `tests/setup/auth.ts` and the v2 kickoff: one more container on every cold start, and the local `email_sent` raised from 2 to 100. `tests/db/ward_signin_request_live.test.ts` runs request, receive, consume and the handover load against the local stack.
- **ENUMERATION — A FINDING, NOT CLOSED BY THIS PR.** OBSERVED locally: GoTrue answers a known address `200` and, on an immediate repeat, `429 over_email_send_rate_limit`; an unknown address `422 otp_disabled` every time. **Every status is evidence about whether the address exists — the 429 included, since only a real address is ever rate-limited.** The form says one conditional sentence for every answer and a different one only when no answer came back. **But anyone can POST to `/auth/v1/otp` directly and read those statuses**, and nothing in this repository can change that. Hosted behaviour is not observed (`-23 D4`). For Cowork to put to the founder.
- **For PR 3.3's allow-list (`-65 B2`):** the console now calls `/auth/v1/otp` through the API origin, and the link it mails is consumed at `/auth/v1/verify`.
- **Founder-side, hosted:** the console's production origin must be on the hosted auth redirect allow-list, or links return to `site_url`. Not read here.

**H — D ANSWERED: NOTHING DECIDES WHAT THE PUBLIC PAGE SHOWS ABOUT A COUNT'S AGE BEFORE FACILITY ONE.** Found, not built:

- **Every public-age item is scoped to Bundle 4.** `Sprint Kickoffs/sprint-kickoff-bedspace-v1-2026-09-08.md` lines 238–242 (skew-corrected freshness; bands with "the **absolute timestamp always shown**"; "last known" on grey; the 24-hour ceiling, "Status unknown — call to confirm"), and its release gates 2 and 3 at lines 384 and 388, which the same kickoff calls non-negotiable.
- **`-44 F` (this record, line 2250) looked at exactly this gap and left it there:** *"A three-day-old count renders identically to a 30-second-old one … This is Bundle 4's subject matter, already scoped there"* — while the same ruling made A3 and B2 must-fix before facility one.
- **`-54 B` (line 2700) orders the queue:** *"the infrastructure review; Bundle 3; the sensor bundle; facility one; Bundle 4."* **Bundle 4 comes after facility one.** The `-45` gate lists no freshness item.
- **The tension, stated for Cowork to put to the founder:** decision D3 (line 192) reads *"A count is shown with its visible freshness and a per-facility call-to-confirm"* with no timing clause, and v1 records the 24-hour ceiling as the one change to insist on before launch. As things stand, between facility one and Bundle 4 the public page would show counts with no age. The sensor bundle covers the operator's side (snapshot and heartbeat age); nothing covers the public's.

### R-2026-09-23-67 — count age ships before facility one; wards write to support@openbed.ng; enumeration an accepted risk

_Issued as R-PROVISIONAL-2026-09-23-AU, by Cowork on 2026-09-23 with the founder's merge word for #65: founder decisions on count age and ward contact. The support address followed in a second block the same day. Number assigned on landing from the record's last as read on this branch: R-2026-09-23-66. **Record-only under R-46; lands in PR 3.2b.** Next provisional letter: AV._

**THE MERGE THAT CAME WITH IT.** #65 merged at `1d084a4`, a merge commit, head `7778bac` read from the API with seven checks green. **The record cites none of the six SHAs in that PR's range**, found by scanning it; all six read `--is-ancestor` exit 0 against `origin/main` anyway.

**A — COUNT AGE SHIPS BEFORE FACILITY ONE (founder decision), in a new PR 3.2b before 3.3.** Basis, Cowork's clinical-safety review: a count shown without its age is false confidence; a crew acting on yesterday's "6 beds" loses the window to divert (graded S1). D3 (line 192) already promises "visible freshness"; nothing scheduled it before facility one (`-66 H`).
- A1: per ward, its age from `updated_at`, in words ("updated 4 min ago"); an absolute time past about two hours.
- A2: aged counts stay visible with their number, de-emphasised, with "last reported <age> — call to confirm"; past the ceiling "no recent report — call", the old number allowed as small text; PENDING/PAUSED wards "not currently reporting", no count.
- A3: a page-level banner when the snapshot itself is older than a threshold, measured against a serve-time clock that is not the cached payload's own `server_now`, plus elapsed time since load, never the device clock; the implementer proposes the mechanism and says why it cannot read fresh while the snapshot is stale.
- A4: the thresholds in ONE tracked setting labelled PROVISIONAL — clinician confirmation pending — with Cowork's proposed defaults: fresh ≤ 30 min; ageing 30 min–2 h; stale > 2 h; no recent report > 12 h; snapshot banner > 3 min.
- A5: must NOT hide, filter or re-sort by age; show a stale or PENDING ward as 0 beds or not accepting; carry freshness by colour alone; show "just now" while the snapshot is stale.
- A6: rendered-page tests for each band, the banner and the clock source, each with a failing half.
- **A7 — OPEN, FOUNDER-SIDE, BEFORE FACILITY ONE:** the founder's clinicians confirm or replace A4's thresholds, ideally with ambulance-service input; only that ruling removes the PROVISIONAL label.

**B — WARD CONTACT: EMAIL FOR NOW (founder decision).** B1: every "phone the OpenBed operator" message names a support address from ONE tracked setting; where a facility admin exists, the message says to contact them first; a guard with a planted bare "phone the operator". B2: the address is the founder's to create. **B3 — OPEN, BEFORE FACILITY ONE:** a staffed phone or WhatsApp line for wards, with honest hours, in the facility agreement and onboarding pack (Cowork's operations review recommends a Nigerian WhatsApp Business number).

**B2 SATISFIED — THE ADDRESS IS `support@openbed.ng`.** Two readings, recorded as given:
- **The founder's reading, 2026-09-23:** created in Proton on the openbed.ng account, and a test email from an outside address was received.
- **Cowork's reading, 2026-09-23, over DNS-over-HTTPS:** openbed.ng MX is `mail.protonmail.ch` (10) and `mailsec.protonmail.ch` (20); SPF includes `_spf.protonmail.ch`; the DKIM CNAMEs `protonmail`, `protonmail2` and `protonmail3._domainkey` resolve to Proton; DMARC `p=quarantine`.

It is the ward-facing support contact ONLY. `hello@openbed.ng` (general enquiries) and `security@openbed.ng` (disclosure) are never used where a ward is told to get help.

**CLOSED: the founder-side "recheck DKIM in Proton" item** (the 2026-09-21 and 2026-09-22 handoffs), on Cowork's DNS reading above. **Proton's own dashboard status was not read.** `-56 A4b` had already recorded the SPF half done and the DKIM half corroborated from DNS; this closes it on that same kind of evidence, and says so.

**C — ACCEPTED RISK, RECORDED:** GoTrue's answers reveal whether an address has an account (`-66 G`). Low harm, because ward logins are role addresses, not personal ones. PR 3.3 makes `/auth/v1/otp` answer uniformly through `api.openbed.ng` if feasible; the direct `*.supabase.co` route closes only with `-55 C` (custom domain), already due before facility one. Revisit if personal addresses are ever used as logins.

**D — FIND, DON'T BUILD: human-readable public labels.** See F.

**E — THE PREMISES, READ BEFORE ACTING (method note 20).**
- **A1's relative age conflicts with recorded text, and AU supersedes it.** `packages/fixtures/golden-path-steps.json` (step `tile-shows-absolute-timestamp`) and v1:239 say the tile shows an absolute timestamp, "never a relative age", because a relative age was a wall-clock subtraction on the handset. The reason does not hold here — this relative age is server-anchored and reads no device clock — so the page shows a relative age under two hours and an absolute Lagos time beyond, as A1 asks. The golden-path step asserts only the payload and is unaffected.
- **A3's serve-time clock did not exist.** No header carried serve time; what Cloudflare's Cache API does to `Date` on a hit is not observed in this repository; the payload's `server_now` equals `generated_at` — generation time. The mechanism is below.
- **B1's "where a facility admin exists" cannot be known by the console**: no RPC it calls returns roles or contacts. The message says it conditionally — "ask your facility's OpenBed administrator if you have one, or email support@openbed.ng".
- **A fourth statement of 019's pending count was missed, by me.** Runbook step 5's ledger sentence went on saying hosted reads `18` with `0 migration(s) pending.` after `78d7b31` restated the other three sites; the guard read three. Restated in `1f3e3d0` and the guard now parses it — found while preparing the founder's hosted-apply steps.

**F — WHAT LANDED IN PR 3.2b.**
- **A3, the mechanism, and why it cannot read fresh while the snapshot is stale.** The Pages Function stamps `x-openbed-served-at` on every response it RETURNS — hit, miss or HEAD — from its own clock, in the function that already rebuilds each outgoing response; never on what it stores, for the reason the edge-cache marker is never stored. The page measures the snapshot as `served_at − generated_at + monotonic elapsed`, and each ward as `served_at − updated_at + elapsed`. `served_at` advances on every serve; `generated_at` stops when the job stalls; so the difference grows with the stall, and the elapsed term grows while the page is open. The device clock is in none of it. **An unknown serve clock is a banner, never fresh.** Two clocks meet — Postgres's and the Function's — and both are server clocks. **Named limit:** a shared cache honouring `s-maxage=30, stale-while-revalidate=300` could replay a served-at up to about five and a half minutes old, understating the age by at most that much; the zone does not cache this path, and the Function's own Cache-API hits get a fresh stamp.
- **A4:** `packages/fixtures/snapshot-shape.json`'s `freshnessBands` is the one setting — 30 min, 2 h, 12 h, a 3-minute banner — with a `status` beginning `PROVISIONAL`, which a test requires until a ruling removes it. **An age exactly on a boundary falls into the OLDER band**, the conservative direction, carried over from the existing bands. The absolute-time switch is the stale band itself, not a second number that could disagree. `freshness.ts` and `anchor.ts` are LIVE (`R-2026-09-17-05` had them GUARD-AHEAD-OF-SUBJECT until Bundle 4).
- **A5, one reading stated:** age never CHANGES a claim — a stale ward is not turned into 0 beds or "not accepting" because it is stale; whatever it last said is shown with its age.
- **A6:** `tests/compliance/dashboard_age.test.ts`, 15 legs, 11 red against the page before; planted to take its serve time from the device clock, the stale-snapshot-on-a-fresh-device leg and the source guard red. `tests/db/beds_json_served.test.ts` requires the stamp on miss, hit and HEAD and never on the stored copy — red without it, and red with it set before `cache.put`.
- **B1:** `packages/origins/ward-support.json` → `@openbed/origins/support`; `tests/compliance/ward_support_contact.test.ts` pins the value, refuses a help message without it and a bare "phone the operator" in source — red against the previous console on nine messages.
- **D — FOUND: NOTHING SCOPES HUMAN-READABLE PUBLIC LABELS.** v1:144 required `gated_by` and `zero_reason.NO_ANAESTHETIST` to be "different types with different UI strings"; it was met by enum separation only (`002_enums.sql` lines 163–169) and swept HOLDS on that basis — no display string was ever defined. v1:404's "single strings module" for a Yoruba / Pidgin pass is recorded FAILED (#115, "no strings module"). So the public page prints `ICU_ADULT` and `NO_ANAESTHETIST_ON_DUTY` because nothing decided it should print anything else. For Cowork to put to the founder. The Pages runbook's read-back 5b treats a category code on the outage page as a failure, and any label change must keep that check meaningful.

### R-2026-09-23-68 — the page polls; past the ceiling no number shows; plain words for every code; "not offered" only once stated

_Issued as R-PROVISIONAL-2026-09-23-AV, by Cowork on 2026-09-23 after reading #66 at `7f4e966`: #66 not approved, AV added to it as new commits, Cowork re-reads the new head before the founder's merge word. Number assigned on landing from the record's last as read on this branch: R-2026-09-23-67. **Record-only under R-46; lands in PR 3.2b.** Next provisional letter: AW._

**AS ISSUED.**
- **A — the page polls** (release gate 2 as restated 2026-09-10, the founder's call; scheduled here because -67 makes an unpolled tab raise the stale banner after three minutes on fresh data). A1: re-fetch `/beds.json` every `POLL_CADENCE_SECONDS`, re-anchoring the age view on each good response. A2: every fetch bypasses the browser's HTTP cache, with the reason in the code. A3: a failed poll keeps the last good data and lets its ages grow; only a first load with no data shows the outage. A4: fake-timer tests, each with a failing half.
- **B — past the ceiling the count is removed entirely**, superseding -67 A2's small text. B1: from `suppressAfterHours` the row keeps the facility, the ward and the call link, reads "Status unknown — call to confirm", and shows no number in any size; a planted number turns a test red. B2: keep -67's provisional values, which are stricter, and record the v1 values beside them. B3: fix `why_here`'s "Suppression at 24h". **B4, Cowork's error, recorded as Cowork wrote it:** -67 A2 and A4 were written without reading the existing values — the same class as Cowork error (d), read the record before asserting; my restatement note caught the numbers, and the suppression rule was missed by both of us.
- **C — plain public labels (founder decision, 2026-09-23).** C1: one tracked table mapping every ward category and every `gated_by` value to plain English; the page never prints a raw code. C2: a guard deriving the enums from the migrations, planted with an unlabelled value; an unknown code at runtime renders a neutral fallback and is logged. C3: the wording is PROVISIONAL beside the thresholds; the clinicians confirm both (-67 A7 extended).
- **The founder's condition on NOT_OFFERED, added the same day** in answer to my finding below: "not offered at this facility" renders only once someone has stated it, never from the default; a PENDING ward reads "not currently reporting" whatever its offering; if the schema cannot tell stated from defaulted, say so and do not guess.

**THE PREMISES, READ BEFORE ACTING (method note 20).**
- **Held:** the page fetched once and its interval only re-rendered (`main.ts` 300–314 at `7f4e966`), with no cache mode set on the fetch; `POLL_CADENCE_SECONDS` is `codec.ts:37`, from the fixture's `pollCadenceSeconds`; gate 2's restated clause is v1:384; `why_here` said 24h while holding 12.
- **"Release Gate 3's 60 min / 2 h / 24 h" — the values are real and the location is not.** The bands are v1:239 and the ceiling v1:242, both in Bundle 4's checklist, whose safety notes v1:256 heads "the 4am gate (release gate 3)". Gate 3's own text (v1:388) names only "aged past 2 hours … badged grey". B1's wording is v1:242's verbatim. The instruction stands; the fixture records the location as read.
- **B4 is right about me too.** -67's fixture comment cited v1 for the numbers and I still kept a "last known" count as small print, against v1:242.
- **Building the poll does not move the golden-path frontier.** The first failing step is `update-request-fired`; `poll-at-cadence-reflects-update` stays owned by stage 3, and the ratchet is unchanged.

**FOUND WHILE BUILDING C, and reported before it was built: the page collapsed a stated NOT_OFFERED into "not yet reporting".** It never read `offering`. `public.ward_public` carries every ward row (008), so a ward whose staff had published NOT_OFFERED rendered as "not yet reporting — not accepting — updated N min ago": a ward the facility says it does not have, shown as one that exists and has not reported — two of v1:140's three states, collapsed. A new row is `NOT_OFFERED` and `PENDING` by default (004); that one read "not currently reporting", which the founder's condition keeps.

**CAN THE SCHEMA TELL STATED FROM DEFAULTED NOT_OFFERED? Not by itself, and this is said rather than guessed.** No column records whether anyone chose the offering. **The state machine tells them apart today:** 002 keeps a ward PENDING until its first successful update; the only write in the migrations that moves `monitoring_state` off PENDING is `publish_ward_status`'s UPDATE (014), and that same UPDATE always writes `offering`. So a ward that has left PENDING carries the offering its last publish stated, and a PENDING ward's may be the default — which the founder's precedence never reads as a statement. **Nothing in the schema enforces that premise**, so a guard now holds it: `tests/compliance/public_labels.test.ts` requires the set of writers of ACTIVE in the migrations to be exactly `publish_ward_status`, stating the offering (planted: a second function, and a top-level data migration, each leaving offering alone), and `tests/db/public_labels_enum.test.ts` observes both halves on the catalogue. **For Cowork to take to the founder, because it binds PR 3.4:** provisioning sets `offering` explicitly per category, and any admin path that moves a ward out of PENDING states the offering in the same write — or the guard goes red and the page's "not offered" stops being a statement.

**ALSO FOUND, recorded and not built:**
- `state` UNDER_REVIEW and `source` ADMIN reach the page and are never read. 002 says an ADMIN count "must render 'set by admin, not ward-confirmed'". Nothing writes either today; both arrive with PR 3.4's admin surface. The label table names them `not_yet_displayed` with that reason, and PR 3.4 builds their rendering before any admin write can reach this page.
- The ward console prints raw codes too ("ICU_ADULT: NOT_OFFERED, not yet reporting"). Outside AV's scope, which is the public page.
- Pages runbook read-back 5b named category CODES as the outage page's failure signal; the page now shows words, so it names both.

**WHAT LANDED IN PR 3.2b.**
- **A**, `d6bc60f`: one interval at `POLL_CADENCE_SECONDS`; a good poll replaces the held snapshot and its serve-time anchor; `cache: 'no-store'` on every fetch, because a stored copy carries an older `x-openbed-served-at` and would make old data read younger; a failed poll re-renders what is held; an in-flight poll is not overlapped. `tests/compliance/dashboard_poll.test.ts`: five legs red against the page before, and two planted pages (no cache mode; the outage on a failed poll) each red. -67's open-tab leg is restated to what ages an open tab now — a stalled generator, polled.
- **B**, `98a3ff2`: "Status unknown — call to confirm", no count, time or reason; the facility and call link stay. `freshnessBands` keeps 30 min / 2 h / 12 h / a 3-minute banner, PROVISIONAL, and records v1's as `v1SpecValues`, read by no code; a test holds the values in force no looser than v1's. **The object's prose now states no number at all** — values live only in fields — and a test refuses one, planted with the exact sentence B3 found.
- **C**, `4dbb065`: `apps/public-dashboard/src/public-labels.json` and `labels.ts`; the precedence is unknown state → "Status unknown", PENDING or PAUSED → "not currently reporting", NOT_OFFERED → "not offered at this facility", then the count and its age. The guards derive the enums and the columns `/beds.json` carries from the migrations and, separately, from `information_schema` and `pg_enum`; the plants are an added value, a stale label, an omitted enum, a renamed value, and a label removed from the table. The outage check in `tests/compliance/dashboard_empty_state.test.ts` now refuses a ward's words as well as its code.

**STILL OPEN BEFORE FACILITY ONE, founder-side:** the clinicians confirm the thresholds AND the public wording (-67 A7, extended by C3); each facility's public number answered 24/7 (-66 C4); a staffed ward line (-67 B3; `support@openbed.ng` is the interim contact); `-55 C`, H2, H3, the sensor bundle, and the NDPA processor agreement for SMTP.

**HELD FOR THE CHANGE AFTER #66 MERGES, not in this PR:** Cowork's records of dashboard deploy #1, Pages runbook section 8 performed, the stray files in the founder's checkout, and 019 applied on hosted, with the frozen boundary at 19 — they touch runbook step 5, which this PR also restates. **Asked in that block and answered here: "INSERT 0 1" then "INSERT 0 0" is the expected pair.** 019 inserts its own ledger row inside its transaction (`019:260-262`, `ON CONFLICT DO NOTHING`); `scripts/run_migrations.sh` then inserts the same filename with `ON CONFLICT (filename) DO NOTHING`, which is a no-op. All 19 up-migrations carry exactly one self-insert, counted per file, so every apply prints that pair.

### R-2026-09-23-69 — #66 merged; 019 on hosted and the boundary frozen at 19; the dashboard deployed and `SUPABASE_URL` deleted from Production; two obligations bind PR 3.4

_Issued as R-PROVISIONAL-2026-09-23-AW: Cowork's comprehensive update of 2026-09-23 ~15:00 Lagos (its sections 2 and 3, held until #66 merged because they touch runbook step 5), and the founder's merge word for #66 after Cowork re-read `abcea44` (its items 3, 4 and 7). Number assigned on landing from the record's last as read on this branch: R-2026-09-23-68. **Record-only under R-46: no pull request of its own.** These are the first commits on `pr-3.3-proxy-hardening` and ride PR 3.3, as -52's freeze at 18 rode PR 3.1. Next provisional letter: AX._

**THE MERGE.** #66 merged at `fca9856` with a merge commit. The head was `abcea44`, read from the API with all seven checks green. **The record cites five of the ten SHAs in that PR's range** (`1f3e3d0`, `7f4e966`, `d6bc60f`, `98a3ff2`, `4dbb065`), found by scanning it, and all five read `--is-ancestor` exit 0 against `origin/main`.

**2a — PUBLIC DASHBOARD DEPLOY #1, 2026-09-23.**
- **The founder's terminal output:** `bash scripts/deploy_pages.sh --branch main public-dashboard` verified HEAD on `origin/main` and a clean tree, and read the stamp back as `1d084a4`, clean. Deployment `https://1151e291.openbed-public-dashboard.pages.dev`, commit `1d084a4beaf1bc258a307d48c7eae86d005398e9`.
- **Cowork's reading, ~13:22 UTC, on the deployment URL and `https://openbed.ng`:**
  - `/version.json` reads commit `1d084a4…`, `"dirty": false`, `built_at 2026-09-23T13:19:35.064Z`, and the ancestor check of `origin/main` exits 0;
  - `/beds.json` answers GET and HEAD with `HTTP/2 200`, `application/json; charset=utf-8`, `noindex, nofollow` and `public, s-maxage=30, stale-while-revalidate=300`, body `{"v":9045,…`;
  - the control `/nonexistent-path` answers 200 `text/html`.
- Production moved `76fe917` → `1d084a4`.

**2b — PAGES RUNBOOK SECTION 8 PERFORMED: `SUPABASE_URL` deleted.**
- **The gate passed on Cowork's reading:** `openbed.ng/beds.json` 200, and `1d084a4` carries `packages/origins/origins.json`.
- **The founder's action, by the founder's own reading:** `SUPABASE_URL` deleted from `openbed-public-dashboard`, **Production only**, with `SUPABASE_SERVICE_ROLE_KEY` unchanged. **Preview was not read.**
- **Redeploy #2, the founder's output:** through the wrapper, `https://ac07baaa.openbed-public-dashboard.pages.dev`, from `1d084a4`, clean.
- **Cowork's re-read, ~13:27 UTC, on the deployment created AFTER the deletion and on `openbed.ng`:** `/version.json` `built_at 2026-09-23T13:25:20.773Z`; `/beds.json` `HTTP/2 200`, JSON, `noindex, nofollow`, `{"v":9050,…`.
- **`R-2026-09-22-59 B3` holds on production, resting on that reading:** nothing reads `SUPABASE_URL`.
- **The Pages runbook, restated here:** section 2 no longer says the variable is "still SET" on an existing project; it says deleted from Production on 2026-09-23 and Preview not read. Section 8 gains a "performed" line, and its procedure stays for any other project and for Preview.

**2c — THE STRAY FILES, an incident note.**
- **What happened:** after deploy #2 the founder pasted terminal output back into zsh, and lines beginning `>` created the empty untracked files `node`, `npm`, `wrangler` and `openbed-ng@0.0.0` in the founder's checkout. The founder removed exactly those four with `git clean` after a dry run (the founder's reading). No tracked file was touched.
- **My checkout never had them** (read, with `package.json` as the known-present control), so it is a different copy.
- **What would have caught them:** `tests/compliance/top_level_tracked_entries.test.ts` would refuse them if staged, since it reads the index and none is in its set. `scripts/deploy_pages.sh` refuses any untracked file, which is the likely cause if a wrapper run ever refuses on untracked files.

**3 — MIGRATION 019 APPLIED ON HOSTED, 2026-09-23** (the founder ran runbook step 5).
- **The founder's terminal output** (Session pooler, step P's PATH line first):
  - the dry run shows 001–018 `already applied`, `WOULD APPLY : 019_snapshot_single_read_and_mirror_integrity.sql` and `1 migration(s) pending.`;
  - the apply skipped 001–018, then `Applying 019…`, then `DO`, `DO`, `DO`, `ALTER TABLE`, `CREATE FUNCTION`, `COMMENT`, `REVOKE`, `DO`, `INSERT 0 1`, `INSERT 0 0` and `Migrations complete (1 applied this run).`;
  - the ledger reads `19`;
  - the second dry run shows 001–019 `already applied` and `0 migration(s) pending.`;
  - there was no `MIRROR_ORPHANS` and no `FACILITY_NAME_BLANK`.
- **Cowork's independent reading**, through the Supabase connector with read-only SELECTs, ~13:58 UTC:
  - `app.schema_migrations` has 19 rows, the last being 019;
  - in `pg_constraint`, `ward_public_facility_id_fkey` is present (f, validated, not deferrable) and so is `facility_name_not_blank` (c, validated);
  - `app.regenerate_snapshot`'s body is the single-statement read;
  - cron job 1 `openbed_regenerate_snapshot` (`* * * * *`) succeeded every minute 13:52–13:58 across the apply, and job 2 `openbed_refresh_lga_rollup` (`*/5`) succeeded at 13:55;
  - `app.facility` and `public.ward_public` both have 0 rows;
  - `https://openbed.ng/beds.json` returned `{"v":9081,…,"generated_at":"2026-09-23T13:58:00.063794+00:00"}`.
- **The client version is not in the founder's output**, so step 7's client row for 019 says "not reported" rather than carrying 18.6 forward.
- The `INSERT 0 1` / `INSERT 0 0` pair was answered in `-68`.

**THE FROZEN BOUNDARY AT 19**, in this change.
- **The script:** `node scripts/freeze_applied_migrations.mjs 19 2026-09-23 R-2026-09-23-69` printed `frozen boundary recorded: 19 migrations, observed 2026-09-23 (R-2026-09-23-69)`, first `001_app_schema_and_migration_ledger.sql`, last `019_snapshot_single_read_and_mirror_integrity.sql`. The recorded sha256 matches the file, and the next placeholder is derived as 020.
- **Runbook step 5** is restated at the four guarded sites to hosted `19`, no `WOULD APPLY` and `0 migration(s) pending.`, with the 019 dry run kept as a dated fence. Step 7's hosted line is restated too.
- **A fifth statement, found by reading, and mine to own:** the virgin-database block said `18 migration(s) pending.` and `17 applied` after 019 was added in `-66`. The guard does not parse it, because it is not a hosted expectation. It now says 19 and 18.
- **A guard whose premise moved.** `frozen_migrations`' contrast leg showed a placeholder the prefix checker cannot see. Re-measured at 19, as its own note asked, the blind spot exists only at the LAST frozen number, and only when that file sorts before "placeholder". That was true at 18 and is false at 19. It is now constructed on a boundary cut back to 18 in the scratch tree, so the reason `placeholderCollision` exists stays demonstrated.

**4 — TWO OBLIGATIONS BINDING ON PR 3.4's DESIGN REPORT, which Cowork signs off before it is built** (Cowork's reading of `-68`'s findings):
- **(a)** provisioning sets `ward_offering` explicitly for every category it creates, and any admin path that moves a ward out of PENDING states the offering. This is the premise under "not offered at this facility" (`-68`). `tests/compliance/public_labels.test.ts` holds `publish_ward_status` as the only writer of ACTIVE, and goes red on a second writer until this is designed in.
- **(b)** before any admin write can reach the public page, the page renders `status_source = ADMIN` as "set by admin, not ward-confirmed" and shows `status_state = UNDER_REVIEW` beside the count (002 section 6). Both are listed `not_yet_displayed` in `apps/public-dashboard/src/public-labels.json` today, with PR 3.4 as the reason.

**7 — OPEN, AND UNASSIGNED BY THE RECORD: the ward console prints raw codes** (e.g. "ICU_ADULT: NOT_OFFERED, not yet reporting"). The founder's word says to list it for PR 3.4 or Bundle 4, "whichever the record assigns". **The record assigns it to neither**, found by reading: `-68` records it as outside AV's scope, and v1:404's strings module (#115) is "fixed by a later change" with no bundle named. For Cowork to assign. Not built.

**PR 3.3 GOES PROPOSAL-FIRST (Cowork's verdict, 2026-09-23).** The design goes to Cowork before any of it is built. It covers:
- the allow-list derivation and CORS preflight;
- `-65 B2`'s probe path;
- `-67 C`'s uniform `/otp`;
- the Worker's stamp path;
- its deploy wrapper;
- the blast radius.

**One premise in that verdict is corrected, and the conflict it names still stands.**
- **The verdict's reading:** AJ F2 requires rate limits to reach the ward as "a fixed 'wait and try again' message".
- **The kickoff's text:** AJ F2 (kickoff line 131) says both rate limits "surface as a fixed ward message".
- **What merged in #65:** the console deliberately folds a 429 into the same conditional message as a 200 (`SIGNIN_ANSWERED`), because locally only a known address ever reaches a 429 (`packages/auth/src/request.ts`). A 429 the console can tell apart is itself evidence that the address exists.
- The proposal answers this directly.

### R-2026-09-23-70 — PR 3.3 signed off with four amendments; `/otp` stays unrewritten; every pending count is scanned; the ward console's raw codes go to PR 3.4

_Issued as R-PROVISIONAL-2026-09-23-AX, by Cowork on 2026-09-23 as its verdict on the PR 3.3 design proposal sent with `-69`. Number assigned on landing from the record's last as read on this branch: R-2026-09-23-69. **Record-only under R-46; lands in PR 3.3.** Next provisional letter: AY._

**VERIFIED BY COWORK, ~15:45 UTC. Cowork's readings, recorded as given.**
- `fca9856` is the merge of #66 (parents `1d084a4`, `abcea44`), and `1f3e3d0` `7f4e966` `d6bc60f` `98a3ff2` `4dbb065` `abcea44` are all ancestors.
- `pr-3.3-proxy-hardening` was at `51b5d1b`: two AW commits, six files. `applied-hosted.json` has `ledger_rows` 19 and ruling `R-2026-09-23-69`, and 019's sha256 `9e79b233…` matches the file. The `frozen_migrations` re-measure is accepted.
- **H4 step 1 is discharged:** `app.openbed.ng` is NXDOMAIN over DoH (Status 3).
- **Live baseline:** `openbed.ng/version.json` reports commit `1d084a4`, with no `x-openbed-served-at`, which is expected because #66 is not deployed. **`api.openbed.ng` is a full passthrough today:** `GET /__openbed/version` returns Supabase's own 404, `{"error":"requested path is invalid"}`.
- **Hosted CORS preflight through `api.openbed.ng`, for all four browser paths:** 200, `access-control-allow-origin *`, allow-headers `apikey,authorization,content-type`, `max-age 3600`. My proposal said "not observed"; this is the observation.
- **Hosted no-key answer** on `POST /rest/v1/rpc/my_facility_wards` and `GET /auth/v1/settings`: 401, body `{"message":"No API key found in request",…}`, with headers `sb-error-code: UNAUTHORIZED_MISSING_API_KEY` and `sb-project-ref: klrlpxysjsjpdkeqdhvl`. **This comes from Supabase's gateway, not from PostgREST.** The local stack answered with PostgREST's `42501` body instead, one more instance of "local is not hosted".

**COWORK'S ERROR, recorded as Cowork wrote it:** "my previous verdict said AJ F2 requires a 'wait and try again' message and called a flattened 429 unacceptable. The kickoff says 'a fixed ward message', and SIGNIN_ANSWERED already covers the rate-limited ward ('If nothing arrives within 5 minutes, ask again once...'). Your correction stands."

**THE DECISIONS.**
- **A — `-67 C`: option C, no rewrite, on the founder's choice.**
  - Why: `-67 C` accepted the risk as low (role addresses) and asked for uniformity only "if feasible".
  - Option A does not achieve uniformity.
  - Option B does, but only by keeping per-address state at the Worker. That is new processing of personal data, and a new dependency on the ward's only sign-in path, which raises `-23 D5`. None of it closes anything while `*.supabase.co` answers directly.
  - **Trigger to revisit B: `-55 C` landing.** No Durable Objects work in PR 3.3.
- **B — signed off as proposed:**
  - the parser-derived allow-list and its plants;
  - the runbook-probe rule;
  - `x-openbed-proxy: forwarded` / `refused`;
  - `/__openbed/version` and its collision test;
  - `deploy_worker.sh`, with an unknown target refused;
  - the blast-radius list;
  - `/auth/v1/signup` not forwarded;
  - `request.ts` treating a Worker refusal as unreachable;
  - `/auth/v1/settings` in place of `/auth/v1/health` in the kickoff's probes.
- **C — four amendments, before build:**
  1. **The no-key probe's pass signal** is `401` AND `sb-project-ref: klrlpxysjsjpdkeqdhvl` AND `x-openbed-proxy: forwarded`. It is never a body shape, because hosted's body is the gateway's. The same header rule applies to every probe that must prove forwarding.
  2. **`/auth/v1/verify` (`-66 G`):** the emailed link is consumed there, and the parser cannot see it. It gets an explicit exception, "consumed on the direct `*.supabase.co` origin until -55 C", and a test that fails if the exception is removed while verify is not listed. **Trigger: if `-55 C`'s custom domain is routed through the Worker, `GET /auth/v1/verify` must be listed, or every sign-in link breaks.**
  3. **A refusal in a real browser.** The Node demonstration ignored CORS. The refusal carries `access-control-allow-origin *` and `access-control-expose-headers: x-openbed-proxy`. A Playwright run against `wrangler dev` shows a refused `/otp` rendering `SIGNIN_UNREACHABLE`, and failing with the fix removed. It asserts on the POST, never on OPTIONS, because preflights are cached for up to an hour.
  4. **`/auth/v1/token` is forwarded only with `grant_type=refresh_token`**, the only grant the code sends. The parser derives the query literal, and a planted `grant_type=password` is refused.

  And the wrapper's read-back retries for a bounded window and then STOPs. It never passes on a previous version.
- **D — the fifth unguarded count is a class, not a site:** #61, the "all four" claim, and now the virgin-database block. It lands on this branch, red first, as `ac46270`.
  - **The scan.** Every `N migration(s) pending.` in the Supabase runbook must be read by a guarded parser, or sit in a dated list item, paragraph or fence intro. The virgin block is a fifth guarded site, derived from the directory.
  - **What the scan's own plant found:** the prose parser's match ran to the next "Restated" bullet, so a bullet planted between them sat inside the region it read, and its count went unread. The guarded region is now each bullet's own list item.
  - **Also added:** 019's lines in two dated lists that `-69` missed.
- **E — the ward console's raw codes are assigned to PR 3.4**, which first puts a ward in front of the console. This replaces "unassigned" in `-69`. The 3.4 design report proposes a single labels source shared with the public page, so the two cannot disagree.
- **F — the founder's steps (i) and (ii) stand.** One wording fix in (i): "leave Disable cache unticked". H4 step 1 is discharged above.

**-23 D5 (availability) stays open, and PR 3.3 raises its stakes.** The PR body says so.

**AFTER THE MERGE, 2026-09-23** (a dated note under this ruling; record-only, rides PR 3.4).

- **#67 merged at `2e62579`** with a merge commit, on the founder's word, after Cowork re-read head `9ae554a`. CI on `main` at `2e62579` succeeded (run 35900411029). Of the six SHAs in `fca9856..9ae554a`, the record cites two (`ac46270`, `51b5d1b`), and both read `--is-ancestor` exit 0.
- **Cowork's re-read, ~17:35 UTC, recorded as Cowork's readings:**
  - 61/61 tests pass locally across the four touched guard files;
  - `handler.ts` was driven through 14 cases with a stub origin. A dot-segment path normalises to the listed path before forwarding. It refuses: a trailing slash, an extra or missing token query, `GET /auth/v1/verify`, `GET /rest/v1/`, signup by POST and OPTIONS, `DELETE` on a listed path, and `GET snapshot_current`;
  - the heredoc incident reached nothing live: `api.openbed.ng/__openbed/version` still returned Supabase's own 404 (the old passthrough), `openbed.ng` still served `1d084a4`, and hosted `app.schema_migrations` read 19 rows.
- **C3 IS OPEN, AND NOT A MERGE BLOCKER (Cowork's reading).** The real-browser check (a refused `/otp` renders `SIGNIN_UNREACHABLE`, and does not once the fix or the expose header is removed) was demonstrated in a scratch Playwright run. **It is not asserted in CI**: Playwright is not a dependency of this repository, and adding it and a browser job is a decision for Cowork and the founder. **What CI does hold** is the two unit legs in `tests/compliance/proxy_allow_list.test.ts`: the refusal carries `access-control-allow-origin` and `access-control-expose-headers`, and `requestSignInLink` reads `x-openbed-proxy: refused` as unreachable.
- **THE DEPLOY CHECKOUT.** `~/Desktop/OpenBed-NG` is both the implementer's working tree and the founder's checkout, and the founder's `git checkout main` for the #66 deploy was refused there over work in progress (Cowork's reading of the founder's account; nothing was lost). Deploys now run from a separate worktree, `~/Desktop/OpenBed-NG-deploy`, detached at `origin/main`, created at `2e62579` with `npm ci`.
  - **Both wrappers accepted it,** checks only. The upload was made impossible three ways at once: a stub `npx` first on PATH, an empty `HOME` so no wrangler login was reachable, and no Cloudflare token.
  - **`deploy_pages.sh`** passed clean-and-on-main, built, and read its stamp back as `2e62579…`, clean. Its upload was recorded by the stub, not run.
  - **`deploy_worker.sh`** passed the same and stamped `2e62579…`, clean. Its upload and read-back were both stubs, so it ended in its designed STOP.
  - **The one-line refresh** is written into all three deploy runbooks. Cowork asked for "both"; there are three (the Pages dashboard, the ward console, the Worker), and all three deploy from a checkout.

**FOUNDER STEP (a) READ BACK, 2026-09-23: PUBLIC DASHBOARD DEPLOY #3 AT `2e62579` PASSES** (Cowork's reading; a dated note under this ruling; record-only, rides PR 3.4).

- **The founder's run:** `bash scripts/deploy_pages.sh --branch main public-dashboard` from the deploy checkout at `2e62579f31d4b43bd3e36d7d3cf93c178b14c3a5`.
  - The first upload attempt failed with "The request to Cloudflare's API timed out". **Whether that attempt created a deployment was not read.**
  - The retry succeeded: `https://cc2b76f9.openbed-public-dashboard.pages.dev`, "DONE".
- **Read-back 4:** commit `2e62579f31d4b43bd3e36d7d3cf93c178b14c3a5`, `"dirty": false`, `built_at 2026-09-23T18:46:32.411Z`, ancestor check exit 0.
- **Read-back 5, the empty state (the founder's copy):** "No facility has joined OpenBed yet, so there is nothing to show. This is NOT a report that beds are unavailable — no hospital has told us anything either way. Call the facility directly, or 112 / 767 in an emergency."
- **Read-back 5b, the outage** (`beds.json` blocked in DevTools): "Live bed information can't be loaded right now. This is NOT a report that beds are unavailable — we cannot see anything either way. Call the facility directly, or 112 / 767 in an emergency." No count, ward, facility or list item appeared. Two requests were blocked and nothing else was: the first load and its one retry, which is what `apps/public-dashboard/src/main.ts` prescribes ("one retry with jittered backoff").
- **Read-back 6:** `HTTP/2 200`, `application/json; charset=utf-8`, `noindex, nofollow`, body beginning `{"v":9371,"wards":[],"facilities":[]…`.
- **Read-back 8:** GET and HEAD identical and exact: `HTTP/2 200`, `application/json; charset=utf-8`, `public, s-maxage=30, stale-while-revalidate=300`, `noindex, nofollow`.
- **The serve-time stamp:** `18:48:50.582Z`, then `18:48:56.068Z`.
- **Polling (the founder's screenshot):** `openbed.ng` with the cache enabled and no reload for 2 minutes showed five `beds.json` fetches about 30 s apart, all 200, none from disk or memory cache. That is the first load plus four polls.
- **Cowork from outside, 19:40 UTC:**
  - `openbed.ng/version.json` reads commit `2e62579`;
  - the bundle `assets/index-C_0rUhXk.js` contains `no-store` once;
  - `x-openbed-served-at` advances (`19:40:04.445Z`, `19:40:08.168Z`).
- **Production moved `1d084a4` → `2e62579`, so -68 A (polling) is live** on that reading.
- **AN OPEN ITEM WITH A TRIGGER (method note 22), not work and not a stop:** `/favicon.ico` is answered by the SPA fallback with `200 text/html`. This is the same mechanism as -69 2a's `/nonexistent-path` control. **Trigger: the next PR that changes `apps/public-dashboard/`.**
- **Next:** the founder runs H5, step (b).

**FOUNDER STEP (b), H5, READ BACK, 2026-09-23: THE `api.openbed.ng` WORKER AT `2e62579` PASSES** (Cowork's reading; a dated note under this ruling; record-only, rides PR 3.4).

- **The founder's run:** `bash scripts/deploy_worker.sh supabase-proxy` from the deploy checkout at `2e62579f31d4b43bd3e36d7d3cf93c178b14c3a5`. Wrangler Current Version ID `19274dcf-f593-47ee-9059-d130f97bca1f`, custom domain `api.openbed.ng`. The wrapper printed "DONE. https://api.openbed.ng/__openbed/version names 2e62579… (attempt 1 of 12)."
- **Probe 1:** `HTTP/2 401`, `sb-project-ref: klrlpxysjsjpdkeqdhvl`, `x-openbed-proxy: forwarded`.
- **Probe 2:** GET `HTTP/2 200`, forwarded. HEAD `HTTP/2 405`, forwarded — see the runbook defect below.
- **Probe 3:** `HTTP/2 404`, `x-openbed-proxy: refused`, `{"message":"not forwarded by the OpenBed proxy"}`.
- **The stamp:** commit `2e62579f31d4b43bd3e36d7d3cf93c178b14c3a5`, `"dirty": false`, `built_at 2026-09-23T20:08:30.740Z`. HEAD answers `200` with `x-openbed-proxy: stamp`.
- **Probe 4, Cowork through the Cloudflare connector:**
  - the deployed bundle is `handler.ts`, `allow-list.json`, `version.json` and `index.js`, the repository's logic byte for byte;
  - it contains `not forwarded by the OpenBed proxy`, `/__openbed/version` and the query `grant_type=refresh_token`;
  - it forwards exactly POST `otp`, `token`, `my_facility_wards` and `publish_ward_status`, GET `settings`, and the four OPTIONS preflights;
  - its origin is `klrlpxysjsjpdkeqdhvl.supabase.co`.
- **Cowork from outside, 20:10 UTC:**
  - the four browser-path preflights from Origin `https://app.openbed.ng` answer 200 with `access-control-allow-origin: *`, forwarded;
  - refused with 404, `x-openbed-proxy: refused` and `access-control-expose-headers`: `token?grant_type=password`, POST `signup`, GET `health`, GET `snapshot_current`, DELETE `publish_ward_status`, OPTIONS `signup`;
  - POST `token?grant_type=refresh_token` with a bogus token answers 401, `sb-project-ref: klrlpxysjsjpdkeqdhvl`, forwarded.
  - So C4's single forwarded query (the password grant refused, the refresh grant forwarded) and C3's refusal headers hold on hosted, on that reading.
- **The Worker is no longer a passthrough.** Every ward call now depends on it as well as on Supabase, which raises -23 D5's stakes, as the Worker runbook already says.
- **A RUNBOOK DEFECT, fixed on this branch.** Probe 2's HEAD leg said `HTTP/2 200`, a value stated without being observed on hosted. **The implementer wrote it in PR 3.3 and repeated it in the step (b) hand-over.** Hosted answers `405`, forwarded; Cowork also observed HEAD with no key: `401`, forwarded.
  - "Supabase does not serve HEAD on this path" is **inferred** from the 405 carrying `forwarded`. The status and the header are what was observed.
  - The property the probe guards, that the tracked key is forwarded and accepted, is shown by the GET half and is unchanged.
  - `docs/runbook-cloudflare-worker-proxy.md` section 2, probe 2, now states the observed signal. No test carried the wrong value: `tests/compliance/proxy_allow_list.test.ts` asserts only that HEAD on a GET entry is forwarded, never its status.
  - It is the same class as the earlier defects: an expected value written down before anyone observed it. Name the observed signal, not a presumed one.
- **Next:** the founder runs H4, step (c).

**FOUNDER STEP (c), H4, READ BACK, 2026-09-23: THE WARD CONSOLE'S FIRST DEPLOY AT `2e62579` PASSES** (Cowork's reading; a dated note under this ruling; record-only, rides PR 3.4). **All three founder steps are now read back.**

- **The founder's run:** the custom domain `app.openbed.ng` was added to `openbed-ward-console` in Pages first. Then `bash scripts/deploy_pages.sh --branch main ward-console` ran from the deploy checkout at `2e62579f31d4b43bd3e36d7d3cf93c178b14c3a5`, printed "DONE", and gave the deployment `https://6abd577d.openbed-ward-console.pages.dev`.
- **A FALSE STOP, from the paste and not the deployment.** In the founder's paste of the key probe, `read -r DEPLOY_URL` consumed the next pasted line instead of the URL. Every curl then ran against an empty host ("No host part in the URL"): the bundle came back empty, the key count read 0, and the live half read 401 "No API key". zsh then garbled the retries.
- **Cowork's re-run, 20:26 UTC:** Cowork ran the runbook's step 2 and step 3 blocks verbatim from outside, with `DEPLOY_URL` set to the deployment URL.
  - Step 2: `version.json` commit `2e62579f31d4b43bd3e36d7d3cf93c178b14c3a5`, `"dirty": false`, `built_at 2026-09-23T20:19:26.613Z`.
  - Step 3: bundle `assets/index-B7kFspkD.js`; "publishable keys in the deployed bundle: 1"; live half `200 {"external":{"`; dead half `401 {"message":"Invalid API key",…`; PASS.
  - The live half went through the Worker, which forwards `GET /auth/v1/settings`.
- **Step 5, Cowork:** `app.openbed.ng` resolves over DoH to `104.21.37.208` and `172.67.213.114`. `https://app.openbed.ng/version.json` reads commit `2e62579` with `"dirty": false` and the same `built_at`, so the custom domain serves this production deployment.
- **Step 6, the deletion of apps/ward-console/.env.local (gitignored, so cited without backticks) from the founder's main checkout: THE FOUNDER'S OUTPUT WAS NOT RECEIVED.** Cowork's message said it was pasted below; nothing followed.
  - **The implementer's own reading, at 20:40 UTC, of `~/Desktop/OpenBed-NG`, which is the founder's main checkout:** ls -la on that file gives `No such file or directory`. The known-present control is `ls apps/ward-console/`, which lists `index.html`, `package.json`, `src` and `wrangler.toml`.
  - This shows the file is absent. It does not show who removed it or when, and it is not the founder's output.
  - **Cowork's reading of the founder's output** — the first `ls` listed the file, the second said "No such file or directory" — is recorded in `-71`.
- **What H4 does not do: no ward can receive a sign-in link yet.** There is no `ward_account` on hosted, and H3 is open (the Auth Site URL and redirect URLs for `https://app.openbed.ng`, and custom SMTP with the NDPA processor agreement). The console loads and shows its signed-out screen.
- **THE PASTE FAILURES ARE A CLASS: three on 2026-09-23.**
  1. The PR 3.3 body went through an unquoted heredoc, and its backticks ran as commands.
  2. `read -r` consumed a pasted line here.
  3. zsh garbled long pastes.

  **The answer is to stop pasting multi-line read-backs:** each becomes a script under `scripts/` that takes the URL as its argument and refuses an empty or non-https one before probing anything. That change rides PR 3.4 on this branch.
- **Next:** PR 3.4's design report, for Cowork's sign-off before anything is built.

### R-2026-09-23-71 — `record-after-67` becomes its own pull request; "unlisted" is `listed_at`, never quiet mode; no secret key on Cloudflare in v1; PR 3.4 splits into 3.4a and 3.4b

_Issued as R-PROVISIONAL-2026-09-23-AY, by Cowork on 2026-09-23 (~21:45Z), as its review of `c4e97dc` and of the PR 3.4 design report, with staff-engineer and CTO passes. Number assigned on landing from the record's last as read on this branch: R-2026-09-23-70. Lands on `record-after-67`, which this ruling makes its own pull request (A). Next provisional letter: AZ._

**COWORK'S READINGS, 2026-09-23 ~21:45Z, recorded as Cowork's:**
- `origin/record-after-67` was at `c4e97dc`, parent `4e18448`, with the 15 files reported. The `supabase-proxy/allow-list.json` diff is comment and reason text only: no entry was added or removed.
- All three read-back scripts, run with no URL and with an `http://` URL: STOP, exit 2, nothing sent.
- Run live from a copy of the branch's scripts, against the main checkout at `2e62579`:
  - `readback_worker.sh https://api.openbed.ng`: PASS (probe 2 HEAD 405 and forwarded; stamp `2e62579`, `dirty: false`);
  - `readback_pages.sh https://cc2b76f9.openbed-public-dashboard.pages.dev`: PASS;
  - `readback_ward_console.sh https://6abd577d.openbed-ward-console.pages.dev`: PASS (1 bundle, 1 key, live 200, dead 401).
- **Step 6 of H4.** Cowork read the founder's terminal output in its previous session: the first `ls` listed apps/ward-console/.env.local, and the second said "No such file or directory". The verbatim text was not carried over. **This is Cowork's reading of the founder's output**, recorded beside the implementer's own 20:40Z check in the -70 H4 note. The two are independent; neither is the founder's pasted output.

**A — `record-after-67` BECOMES ITS OWN PULL REQUEST NOW, so CI runs on it.** The runbooks on `main` still carry probe 2's HEAD at 200 and the pasted `read -r` blocks that produced H4's false STOP, and any deploy from `main` before 3.4a merges would repeat both. It is docs, scripts and tests only, and has no reason to share a review with a migration. The founder gives the merge word as usual.
- **Whether -46 binds, read rather than assumed.** `-46`'s clauses A1 and A2 named 018 and are spent. Clause A3 bars **record-only** work from a pull request of its own. This branch carries three scripts, their tests and three retargeted guards, so A3 does not bar it. It is **not** the visitor-reachable safety exception and is not claimed as one. The record-only notes on the branch ride it as the next pull request, as A3 requires.

**B — BLOCKING: "a new facility starts unlisted" must not use `quiet_mode`.** `quiet_mode` is not "unlisted". A quiet facility writes no public mirror row but **does** feed `public.lga_rollup` (`WHERE f.quiet_mode AND f.is_active AND ws.offering = 'OFFERED'`). Starting new facilities quiet would:
- put an onboarding facility into a public aggregate as soon as a category is stated OFFERED, contributing a count of 0 from wards that have never reported;
- count that non-reporting facility toward the k=5 floor, so a cell clears k with fewer real reporters, weakening the anonymity of the facilities that did report;
- make listing the same act as leaving quiet mode, so a facility that chose quiet mode and one still onboarding would share one state.

**Decision 3 is YES to starting unlisted, through a separate state: `app.facility.listed_at timestamptz`, NULL meaning unlisted** — the same honest-absence pattern as `agreement_accepted_at`. An unlisted facility is excluded from **every** public membership predicate; every site that reads `quiet_mode` or `is_active` for public output is enumerated and stated. `operator_set_facility_listed` sets it, with stated preconditions, at minimum a recorded agreement. `quiet_mode` stays founder-flipped and orthogonal.
- **B1 — backfill.** 020 sets `listed_at` on every existing facility row, so applying 020 changes no public output anywhere. Test: a database with a projected facility, 020 applied, public rows unchanged. The down migration drops the column.
- **B2 — propagation.** State the worst-case time an unlisted facility stays visible on `openbed.ng`, and whether v1 allows unlisting at all.
- **Tests:** an unlisted facility with an OFFERED ward yields no row in `facility_public`, `ward_public` or `lga_rollup`, with `quiet_mode` both true and false. Plant: drop the predicate from each site in turn, and each plant turns the test red.

**C — DECISION 1, REVISED: the secret key does not go to Cloudflare in v1.** The design put `sb_secret_` in a Pages Function behind a public hostname: a second home for the one key that bypasses every grant and RLS check, to serve a flow run a handful of times before facility one. The founder's stated need for admin v1 is operator visibility.
- The 3.4b admin app does reads and the `operator_*` writes under the operator's own session (publishable key plus the operator's JWT). **No Function holds the secret key.** `-58 A3/A4` and the tracked-origins test are **not** amended.
- Provisioning stays in `scripts/provision_ward_account.mjs`, which gains the host check and the `PLATFORM_ADMIN` bootstrap, and goes through the same database gates: the agreement gate, the idempotent invite and the scope-conflict refusal. **There is ONE implementation of those gates, in SQL**, with no second copy in JS.
- "Provisioning incomplete" is derived from `app.invite` (an open invite with no `ward_account`), never by reading `auth.users`, so no operator function returns an email.
- The ward console still maps `NOT_A_MEMBER` to a ward-facing message.
- The two unverified items — whether `generate_link` creates a user with sign-ups off, and whether `sb_secret_` is accepted as `apikey` alone — are tested in 3.4b, against the script.
- **Recorded for the future (CTO):** if provisioning later moves into the app, the default home is a Supabase Edge Function, where Supabase injects the key and no second vendor holds a copy, not a Cloudflare Function. That move is a separate design with its own sign-off.

**D — DECISION 2: the redirect list is exactly `https://app.openbed.ng` and `https://admin.openbed.ng`**, as exact entries with no wildcards. **This amends 2026-09-14 D2**, whose "confined to `app.openbed.ng`" it widens by one named host; D2 is left as written with a pointer to this clause. The H3 runbook text gives the founder both, with the exact strings.
- **AMENDED by R-2026-09-23-72 AZ-1:** the entries are `https://app.openbed.ng/` and `https://admin.openbed.ng/`, the exact strings the apps send, still with no wildcards. This clause is left as written.

**E — DECISION 4: the split is approved.** **3.4a** is 020, the `operator_*` functions, `listed_at` (B), the D3 closed list, the labels, -69 b and the ward console's words. **3.4b** is the admin app, the script changes (C) and the facility-creation runbook step. Each PR's report is sent before merge.

**F — DECISION 5: agreed.** STOP lines are not legs, for now.

**G — THE `PLATFORM_ADMIN` BYPASS BECOMES REACHABLE.** 3.4 bootstraps the first `PLATFORM_ADMIN` on hosted, which makes `assert_member`'s early return for that role (011:109-111) reachable for the first time. The 3.4a report lists every function executable by `authenticated` and what a `PLATFORM_ADMIN` session gets from each, **as a test driven by a real `PLATFORM_ADMIN` session**, beside the D3 closed-list test.

**H — THE SEVEN HARD-CODED APP LISTS** are derived in 3.4b from one source, with a test that fails if an app directory exists that the derivation does not reach. A list that genuinely cannot be derived says why and keeps a plant.

**I — THE INVITE GATE (D5) ALSO REFUSES WHEN THE FACILITY HAS NO `facility_contact` ROW**, as well as when `agreement_accepted_at` is null. Both are tested.

**J — STAFF-ENGINEER FINDINGS**, each fixed in 3.4a unless stated, with a test:
- **J1 — the stale-edit check.** `app.facility` has only `updated_at` (microseconds), which a JS `Date` round trip truncates to milliseconds, so an equality check refuses every edit and a truncated comparison lets real races through. An integer row version, incremented by trigger, is returned by the list and passed back on edit. Test: two edits from the same loaded version, the second refused and named.
- **J2 — double submit.** `operator_create_facility` takes a client-generated id as its idempotency key: an identical retry returns the existing row, and the same id with different fields is refused. `operator_add_category` returns the existing ward on a repeat and never surfaces 23505.
- **J3 — one account per ward.** Nothing enforces it today. The cardinality is one ("an account is a ward, never a person"): a partial unique index on `ward_account (facility_id, ward_category) WHERE role = 'WARD_STAFF' AND is_active`, and replacing a ward's address means deactivating the old account first.
- **J4 — re-run on a complete account.** Begin returns "already complete", and the script exits **without** calling `generate_link`, which on an existing user mints a new token and can invalidate a link the ward already requested. Test: re-running provisioning on a complete account makes zero Auth admin calls.

**Signed off as written:** `assert_operator` not built on `assert_member`; create-facility with its duty-flags row in one transaction; the offering stated explicitly, with no default and no admin path out of PENDING; the list never filtered by freshness, with bands from `freshnessBand`; the labels moved to a shared labels package (packages/labels, which 3.4a creates, so it is not cited as a path yet), with `labels.ts` as a re-export; -69 b's wording PROVISIONAL and classed as a guard ahead of its subject; the down migration and a 019-style round trip; runbook step 5 restated for 20.

**PREMISES READ ON LANDING, and where they did not hold as stated:**
- **G's line numbers.** `publish_ward_status`'s explicit `WARD_STAFF` check is at **014:189-193**, not 014:55; it refuses a `PLATFORM_ADMIN` with 42501 `INSUFFICIENT_ROLE`. **The two reads do NOT refuse a `PLATFORM_ADMIN`.** `my_facility_wards` (011:169-191) and `ward_status_history` (live at 015:97-116; the 011:258 body was dropped by 015) both pass `assert_member`, which returns early for that role, and then filter on the account's facility, which is NULL, so each returns **zero rows and no error**. The 3.4a test asserts that answer, rather than a refusal.
- **C's "the operator RPCs".** Under C, **no operator RPC provisions in v1**: the app cannot create an Auth user without the key. So the one SQL implementation of the gates lives in `app.*` functions that only the script calls (as the owner, over the direct database URL); there is no `public` provisioning function.
- **D's strings carry no trailing slash, and both apps send `redirect_to=<origin>/`.** Supabase Auth admits a redirect on the Site URL's own hostname whatever the path, so `app.` is admitted. `admin.` is a different host, so its allow-list entry is what gets matched, and **whether `https://admin.openbed.ng` admits `https://admin.openbed.ng/` is unverified**. The local sign-in test cannot decide it, because its Site URL and redirect share `127.0.0.1`. The H3 runbook text carries a read-back that decides it on hosted. **Superseded by R-2026-09-23-72 AZ-1**, which stops relying on the matching rule and enters the slashed strings; this bullet is left as written.

### R-2026-09-23-72 — #68 merged; the redirect entries are the exact strings the apps send; 3.4a's premise corrections accepted

_Issued as R-PROVISIONAL-2026-09-23-AZ, by Cowork, as its review of #68 and of 3.4a at `03f7cc3`, with the founder's merge word for #68. Its readings are dated 2026-09-23; it landed on 2026-09-24. Number assigned on landing from the record's last as read on merged `main` at `ae14701`: R-2026-09-23-71. **Record-only under R-46; lands in PR 3.4a**, after `main` was merged into it. Next provisional letter: BA._

**COWORK'S READINGS, 2026-09-23, recorded as Cowork's, each re-read on landing:**
- #68: head `590cb5c`, base `2e62579`, mergeable CLEAN; all seven check runs at `590cb5c` completed with success. **Re-read on landing:** `gh pr view 68` gave that head and CLEAN before the merge, and the check-runs API at `590cb5c` listed the seven, each completed with success.
- `590cb5c`'s prefilter builds its `-e` list from the same `PATTERNS` entries and uses the same `-E` as the per-pattern loop, so a file it skips is one every per-pattern grep would have exited 1 on; exit 2 is fatal in both. **Re-read on landing:** `scripts/lint_no_secrets.sh` builds `ALL_PATTERNS` from `PATTERNS` and runs `grep -qE`, and the loop runs `grep -nE -e`; each maps any exit other than 0 or 1 to `exit 2`.
- 020, read directly: `listed_at` added with `DEFAULT now()` and then `DROP DEFAULT`; `operator_create_facility` inserts `listed_at` NULL explicitly; `listed_at IS NOT NULL` in `project_facility` and `refresh_lga_rollup`; `version` bumped by its own `BEFORE UPDATE` trigger; `invite_one_open_per_scope` NULLS NOT DISTINCT; `ward_account_one_active_per_ward` partial on `role = 'WARD_STAFF' AND is_active`; the listing preconditions refused by name, and a repeat on a listed facility returning without a write; `provision_begin` and `provision_complete` revoked from PUBLIC, anon, authenticated and service_role. **Re-read on landing,** in `database/migrations/020_operator_functions_and_listing.sql`: each holds as stated.

**MERGE WORD — #68.** Merged as a merge commit on the founder's word, with `--match-head-commit` taken from the API read: `ae14701`, MERGED read back from the API before `record-after-67` was deleted. `main` was then merged into 3.4a, not rebased.

**AZ-1 — THE REDIRECT ENTRIES ARE THE STRINGS THE APPS SEND.** Do not rely on Supabase's matching rules. Exact, no wildcards:
- Site URL: `https://app.openbed.ng`
- Redirect URLs: `https://app.openbed.ng/` and `https://admin.openbed.ng/`

This amends -71 D and 2026-09-14 D2; both are left as written with a pointer here. The hosted read-back stays and asserts where the admin link actually lands. **If a redirect is not matched, Auth falls back to the Site URL silently**, so an operator's link would land on `app.openbed.ng`. That fallback must read as STOP, never as a working sign-in. The H3 runbook text now says so.

**AZ-2 — THE PREMISE CORRECTIONS IN -71 ARE ACCEPTED AS CORRECTIONS:**
- G: the `WARD_STAFF` check is at 014:189-193, not 014:55. `my_facility_wards` and `ward_status_history` give a `PLATFORM_ADMIN` 200 with zero rows, not a refusal. The tests assert what the code does. Zero rows discloses nothing.
- C: in v1 the gates are `app.*` functions that only the script calls. No operator RPC provisions.

**AZ-3 — 3.4b PROCEEDS AS LISTED.** For J4, the script calls `provision_begin` first and exits before any Auth admin call when begin reports the ward's account already complete. The test asserts zero Auth admin requests on that path.

**FOUND ON LANDING, an open item for 3.4b.** The fallback AZ-1 names does not read as STOP today. An operator whose link falls back lands on the ward console, which calls `my_facility_wards`, gets 200 with zero rows (AZ-2), and renders an empty handover list: a sign-in that looks as if it worked. 3.4b gives that zero-ward session a stop message, and turns the H3 read-back into a script, together with the admin app that the read-back needs.

### R-2026-09-24-73 — #69 merged; 020's hosted apply prepared as founder steps, with a read-back that the public output did not change; the redirect read is script-only

_Issued as R-PROVISIONAL-2026-09-24-BA, by Cowork on 2026-09-24, as its review of the -72 landing and of #69, with the founder's merge word for #69. Number assigned on landing from the record's last as read on merged `main` at `0406b4f`: R-2026-09-23-72. Lands on `hosted-apply-020`, which carries the read-back script and its tests, so it is a pull request in its own right under R-46. Next provisional letter: BB._

**COWORK'S READINGS, 2026-09-24, recorded as Cowork's, each re-read on landing:**
- #68 closed and merged, merge commit `ae14701` (parents `2e62579`, `590cb5c`), head `590cb5c`; `record-after-67` answers 404. **Re-read on landing:** `git rev-parse ae14701^1 ae14701^2` gives those parents; the branches API answers `404 Branch not found`.
- #69 open, head `86ff698`, base `ae14701`, mergeable CLEAN, all seven check runs success. **Re-read on landing,** before the merge: `gh pr view 69` gave that head and CLEAN, and the pulls API gave base `ae14701`.
- `cb9be47` carries no code change from `03f7cc3`, and `86ff698` touches only the decision record and `docs/runbook-supabase-project-creation.md`. **Re-read on landing:** `git diff --stat 03f7cc3 cb9be47` is empty; `git show --stat 86ff698` lists those two files.

**MERGE WORD — #69.** Merged as a merge commit on the founder's word, with `--match-head-commit` taken from the API read: **`0406b4f`** (parents `ae14701`, `86ff698`). MERGED was read back from the API before `pr-3.4a-operator-functions` was deleted, as a separate step.

**BA-1 — THE redirect_to READ IS DONE ONLY WITH 3.4b's SCRIPT.** The script decodes `redirect_to` before comparing and prints both forms. Until it exists, the H3 runbook text says the read is script-only, and that no operator link is requested.
- **Its stated reason does not hold for these strings; the instruction stands on others.** BA-1 says the emailed link carries `redirect_to` percent-encoded. GoTrue encodes it only when it holds `&`, `=` or `#` (`encodeRedirectURL`, `internal/mailer/templatemailer/templatemailer.go:515-525` in supabase/auth, read at `2399fe5`, 2026-08-10; hosted's own GoTrue version is not pinned to that commit). `https://admin.openbed.ng/` holds none of them. The one hosted link on record was plain: `redirect_to=http://localhost:3000`, runbook step 9, 2026-09-14.
- **Why the script is still right.** One correct link can reach a reader in two spellings. An email provider's click tracking can rewrite the whole link. And a comparison made by eye is the thing the -70 H4 fix removed. So 3.4b's script also refuses a link that does not point at the project's own Auth host.

**BA-2 — 020's HOSTED APPLY, AS FOUNDER STEPS, SENT TO COWORK BEFORE ANYTHING RUNS.** The new subsection of runbook step 5, "020's apply — the public output must not change", has five fences:
1. the dry run, against the step 5 list, which names exactly `020_operator_functions_and_listing.sql`;
2. the before-reading;
3. the apply;
4. the after-reading, with the before-reading's fingerprint;
5. the ledger count, which must read 20.

`scripts/readback_public_output.sh` reads `/beds.json`'s `facilities` and `wards`, and each of `facility_public`, `ward_public` and `lga_rollup` as a count and a digest. `lga_rollup` is read without `updated_at`, which its refresh rewrites. The script gives PASS, or a STOP naming each part that moved. Nothing hosted is run until Cowork has read the steps, and this pull request has merged on the founder's word, because the steps call the script from `main`. The -45 gate is unaffected.
- **THE LIMIT, stated in the script's own output.** Hosted is empty: read-back 6 read `{"v":9371,"wards":[],"facilities":[]` on 2026-09-23. So the after-reading can show only that the apply created no public row, not that it changed none; there is nothing to change. It then reads `PASS (VACUOUS FOR B1)`, never a plain PASS. B1's evidence stays `tests/db/migration_020_round_trip.test.ts`.
- **What the read-back's own queries were proved against.** `tests/db/readback_public_output_sql.test.ts` runs the script's three query literals against the real schema. A no-op UPDATE of a listed facility fires the projection, and the `facility_public` digest sees it. A changed ward row is seen. A new rollup row and a changed total are seen, and an `updated_at`-only rollup change is not. Weakening the facility query to four columns, or the rollup query to `select *`, reds the matching leg.

**BA-3 — THEN 3.4b, AS QUEUED:**
- the admin app;
- the script calling `provision_begin` first, with J4's zero Auth admin requests on a complete ward;
- the ward console's stop message for a session with no ward;
- the redirect read-back script (BA-1);
- per-app lists derived from one source (H);
- the facility-creation runbook step;
- the two hosted Auth checks.

### R-2026-09-24-74 — #70 tightened: the second dry run, a function-grants read-back held to one source, the comparison's scope, and a restore drill before facility one

_Issued as R-PROVISIONAL-2026-09-24-BB, by Cowork on 2026-09-24, as its review of #70 at `9a3dc21` with a platform-SRE pass. Number assigned on landing from the record's last as read on this branch: R-2026-09-24-73, which rides the same pull request unmerged. Lands on `hosted-apply-020` (#70). Next provisional letter: BC._

**COWORK'S READINGS, 2026-09-24, recorded as Cowork's, each re-read on landing:**
- #69 merged at `0406b4f` (parents `ae14701`, `86ff698`), and `origin/main` is `0406b4f`. **Re-read:** as landed in -73, from `git rev-parse` and `gh pr view 69`.
- #70 open, head `9a3dc21`, base `0406b4f`, CLEAN, all seven check runs success. **Re-read:** the check-runs API at `9a3dc21` listed the seven as completed success before this change began.
- `scripts/readback_public_output.sh`, read in full: its refusals, fingerprint shape check, `Q_` literals, reduction to `facilities` and `wards`, VACUOUS verdict and exit-2 ERRORs. **Re-read:** each is in the script as described.
- `scripts/run_migrations.sh` applies each file with `--single-transaction` and `ON_ERROR_STOP=1`, so a failed 020 leaves hosted at 19 with nothing half-applied. **Re-read:** its header (lines 22-30) and `PSQL_TX` (line 130). 020 writes its own ledger row inside the file, so the row commits or rolls back with it.

**BB-1 — FENCE 5 IS THE SECOND DRY RUN, NOT A ROW COUNT.** A count of 20 says how many ledger rows exist, not which ones, and not that nothing is still pending. Its stop condition: twenty `already applied` lines naming 001 through 020, no `WOULD APPLY`, and `0 migration(s) pending.`; anything else, stop and report. **The quoted sentence ("the second dry run is part of an apply, not an optional extra") is in step 5's "Expected output" subsection, not in the 020 section; the instruction holds either way.**

**BB-2 — FENCE 6: WHO CAN EXECUTE WHAT, READ ON HOSTED.** `scripts/readback_function_grants.sh` reads, for every function in `app`, `graphql_public` and `public`, which of anon, authenticated and service_role can EXECUTE it, and holds the answer to `packages/fixtures/function-grants.json` exactly, in both directions.
- **The one source did not exist; this change makes it.** D3's closed list was a literal in `tests/db/authenticated_executable_closed_list.test.ts`. It now derives from the fixture, with a leg pinning the nine names it held. `graphql_public` is in scope because D3 covers `graphql_public.graphql`.
- **MEASURED on the local stack at 020:** 24 functions. The 15 in `app`, both `provision_*` gates included, are executable by none of the three. `graphql_public.graphql` is executable by all three. The 8 in `public` are executable by authenticated only. service_role holds EXECUTE on none of this repository's functions. A function created in `public` with no GRANT reads EXECUTE for all three roles: Supabase's default privileges, observed, which is the default 020's REVOKEs exist to remove.
- `tests/db/function_grants.test.ts` runs the script's own query literal against the real schema: it reads exactly the fixture, and the real script with real psql reads PASS. Four plants, each in a rolled-back transaction, have their rows handed to the real script, and each reads STOP naming the function: a grant to anon, a revoke from authenticated, a grant on `app.provision_begin`, and an unnamed function.
- **THE RISK, recorded rather than designed away.** The comparison is exact. A function hosted has in these schemas and local lacks, such as one Supabase added, reads STOP, and it would do so after 020 is already applied. That STOP changes nothing, because the script only reads, but it needs a ruling before anything else runs.

**BB-3 — THE BEFORE/AFTER COMPARISON'S SCOPE.** It holds only while no ward can publish, that is, before the -45 gate clears. After that, a status change between the two readings reads as STOP. A later apply needs a different reading, designed then. Written into the script's header and the runbook subsection.

**BB-4 — OPEN ITEM, NOT FOR THIS APPLY: NO BACKUP HAS EVER BEEN RESTORED.** Before facility one, restore one once (to a scratch project, or as a PITR drill) and record what was observed. Added as a checkbox in runbook step 4 and named in step 4b as gating the same moment. A named human step; nothing checks it.

**FOUND ON LANDING, an open item: step 4b's list describes code that no longer exists.** Its three "defects" are:
- the `(unknown facility)` row, dropped on the page by -66;
- `wardRowFrom`'s defaults, now refused, since 3.4a;
- raw server text on the publish screen, now mapped to fixed sentences by `wardMessageFor`.

Its "not built" invite gate is `app.provision_begin` in 020, on hosted once 020 is applied. The gate itself, no facility and no ward_account row until it clears, is unaffected. **The list needs restating, with each row re-verified; that is not done here.**

### R-2026-09-24-75 — #70 merged; fence 6's exact match accepted; step 4b to be restated with evidence; the design review of the founder's prototypes

_Issued as R-PROVISIONAL-2026-09-24-BC, by Cowork on 2026-09-24, as its re-check of #70 at `c66bae1` and its design review of the founder's Claude Design prototypes, with CLCO input. Pasting it was the founder's merge word for #70. Number assigned on landing from the record's last as read on this branch: R-2026-09-24-74. Record-only; lands in the change that records 020's apply, with -76 and -77. Next provisional letter: BD._

**COWORK'S READINGS, re-read on landing:** #70 open at `c66bae1`, base `0406b4f`, CLEAN, seven check runs success. Re-read before its merge: the head from `gh pr view 70`, and the check runs from the API. **#70 merged at `4a6a9e9`** (parents `0406b4f`, `c66bae1`), MERGED read back from the API, and `hosted-apply-020` deleted afterwards (404).

**BC-1 — FENCE 6 EXACT-MATCH RISK: accepted as designed.** A fence 6 STOP means the output goes to Cowork and nothing else runs until Cowork rules. 020 stays applied, since its down migration is never the answer to a read-only STOP. **Exercised the same day:** see -77.

**BC-2 — STEP 4b RESTATED, in this change.** Each row was read against the code at `4a6a9e9`, with file:line and the test that holds it:
- the orphan row: `callableIdentity`, `apps/public-dashboard/src/main.ts:221-228`;
- `wardRowFrom` refusing: `apps/ward-console/src/main.ts:219-245`;
- `wardMessageFor`: `apps/ward-console/src/main.ts:167-180`;
- the invite gate: 020's `app.provision_begin`, lines 801-807.

All four are CLOSED. The backup restore (BB-4) stays OPEN, so the gate has not cleared. The copy of that block in `scripts/provision_ward_account.mjs`'s header is restated with it.

**BC-3 — CONTACTS AND CONTROLLER (founder, final).**
- The addresses are security@, hello@ and support@openbed.ng, and **there is no privacy@**.
- Paddie Health Ltd is the controller.
- One tracked contacts file is read by every page, SECURITY.md and the privacy notice, or tested against them.

Carried to 3.4b-app.

**BC-4 — the prototype's `platform-admin-src` is not copied in.** It may be used for layout, wording, Lagos absolute times, the worst-ward facility band, and the PGRST202 message only. Its sample data is not synthetic, and fixtures stay synthetic.

**BC-5 — 3.4b SPLITS INTO 3.4b-db (021) AND 3.4b-app.** 021's design went to Cowork before the build and was signed off as restructured by -76.

**BC-6 — 3.4b-app's scope, correcting the prototype:**
- no facility-admin surface, and no invite list;
- per ward: login active / setup incomplete / none;
- Listed / Not listed, with no Paused, and unlisting as a founder step of about 2 minutes;
- "Not yet reporting" per ward only;
- fonts self-hosted, plus a bundle guard against `fonts.googleapis.com` and `fonts.gstatic.com`.

**BC-7 — the public site and ward console pass waits for Cowork's brief.** Fixed now:
- beds first;
- a privacy notice drafted as a document for review;
- never "within 30 seconds" (about 2 minutes);
- session limits only once read back.

Out of v1: update requests, freshest and nearest sorting, the "who's on it" list, the facility-admin override, and duty-flag gating. **Supabase as a processor:** absent from the record, and added under -76 BD-4.

**BC-8 — no tile ruling exists** (recorded under -76 BD-3).

### R-2026-09-24-76 — 021 signed off with the agreement moved off the contact row; five questions ruled

_Issued as R-PROVISIONAL-2026-09-24-BD, by Cowork on 2026-09-24, as its sign-off of 021's design report, with one structural change from the CLCO. Number assigned on landing: R-2026-09-24-75 plus one. Record-only; lands here. Next provisional letter: BE._

**COWORK'S READINGS, re-read on landing:** #70 merged at `4a6a9e9`, `hosted-apply-020` answers 404, and step 5 on `main` carries fences 1-6 as reported. Each was read back from the API and the file.

**BD-1 — THE AGREEMENT MOVES OFF THE CONTACT ROW.** `app.facility_contact` is a named person's data, erasable on request (003). The agreement is the basis for processing the facility's ward data, and it must survive any one person's erasure. So 021 adds:
- `app.facility_agreement`, holding the date, a version label, a signatory ROLE and `withdrawn_on`;
- two writes, `operator_record_contact` and `operator_record_agreement`;
- the gates restated to need both;
- the list as an envelope carrying `server_now`;
- `operator_get_contact`, carrying both.

**BD-2 — the five questions:**
1. **No audit row on reading a contact in v1. OPEN ITEM, trigger: a second PLATFORM_ADMIN account.**
2. No withdrawal through any function; withdrawal is a founder runbook step, written in 3.4b-app.
3. A changed email or mobile clears `unreachable_since`.
4. The version is a short label, by CHECK.
5. Erasing a contact never touches the agreement, and the register warns "no contact on record".

**BD-3 — BC-8 recorded:** no tile ruling exists. The page keeps its per-ward rows, and per-category versus rollup stays open until dispatcher validation.

**BD-4 — Supabase added to the open processor table**, above.

**021 IS BUILT, ON ITS OWN BRANCH, AND NOT YET OPENED AS A PULL REQUEST (-77 BE-4).** Four findings from the build go to Cowork now, before that pull request:
- **BD-1 b's move and its pre-check cannot both act.** The pre-check refuses exactly when there is something to move, and a move would need a version never recorded. So 021's pre-check is the whole of it, and its down migration refuses while any agreement row exists. Neither direction invents or loses an agreement.
- **BD-1 c's `p_expected_version` on `operator_record_agreement` guards nothing.** The table has no row version, and the function never overwrites a row. It is built without the parameter, for Cowork to overrule.
- **020's list becomes a new function, `public.operator_register()`, and `operator_list_facilities()` is dropped.** Changing a function's return type in place makes 020 fail on re-apply ("cannot change return type of existing function", read from `tests/db/migration_idempotency.test.ts`). That breaks the invariant that every forward migration re-applies cleanly over the later ones. The property BD-1 e asks for (server time with every result) is kept; the name changes. For Cowork to rule on before 021's pull request.
- `recorded_session` is NULL only for a founder-SQL row. A withdrawn agreement is refused by its own name, `AGREEMENT_WITHDRAWN`.

### R-2026-09-24-77 — 020 applied on hosted; fence 6's first real STOP, on Supabase's own event-trigger function, ruled

_Issued as R-PROVISIONAL-2026-09-24-BE, by Cowork on 2026-09-24, as its read-back of the founder's six fences. Number assigned on landing: R-2026-09-24-76 plus one. Lands in this change, which also carries its code (BE-1). Next provisional letter: BF._

**THE FOUNDER'S READINGS, recorded as the founder's** (terminal output, from a deploy checkout at `4a6a9e9`):
- **Fence 1:** 19 `already applied`, one `WOULD APPLY` naming `020_operator_functions_and_listing.sql`, and `1 migration(s) pending.`
- **Fence 2:** `beds.json` 0/0 and every table 0 rows, `RECORDED`.
- **Fence 3:** 020 applied, `Migrations complete (1 applied this run).`
- **Fence 4:** every part ok, `PASS (VACUOUS FOR B1)`.
- **Fence 5:** twenty `already applied` (001-020), no `WOULD APPLY`, and `0 migration(s) pending.`
- **Fence 6:** 24 functions ok, both `provision_*` reading `none`, and ONE `WRONG`: `public.rls_auto_enable()`, read `anon,authenticated,service_role`, which must be `(not in the fixture)`. STOP.

**COWORK'S READINGS OF `public.rls_auto_enable()`, recorded as Cowork's and not re-observed** (no hosted read is made from this side):
- owner `postgres`, SECURITY DEFINER, returns `event_trigger`, `search_path=pg_catalog`;
- the function of event trigger `ensure_rls`, which enables RLS on new tables in `public`;
- a POST to it through PostgREST answers 400 (`0A000`), and through `api.openbed.ng` answers 404.

**They agree with what the record already held:** -55 D3 and -56 A7, including "PUBLIC EXECUTE is INERT: an event_trigger function cannot be called directly".

**BE-1 — RULED: Supabase-owned, harmless, 020 stays applied.**
- `packages/fixtures/function-grants.json` gains a `hosted_only` section, and this function is its one entry.
- `scripts/readback_function_grants.sh` accepts it only if the roles, the owner, the return type and SECURITY DEFINER ALL match.
- It reads absent without failing where it does not exist (locally).
- A function in neither section still STOPs, and one in both is an ERROR.
- `tests/db/function_grants.test.ts` asserts no `hosted_only` entry exists locally, and plants a real event-trigger function to show the match is accepted, and a void return type or a non-definer read STOP.
- The D3 list reads `functions` only.
- **After this merges, the founder re-runs fence 6 alone, and it must read PASS before 020 counts as recorded complete.**

**BE-2 — the premise does not hold as stated; the instruction survives.** The pair was not undeclared in the record: -55 D3 listed it as hosted-only drift, and -56 A7 recorded it as undeclared hosted platform configuration, kept, with `scripts/lint_public_table_rls.sh` built in its place (-56 C). **What did not exist was a single list.** It exists now, under the processor table ("Hosted objects this repository does not create"), with this pair as its first entry. Nothing is dropped or altered on hosted.

**THE STOP WAS FORESEEABLE, AND I DID NOT FORESEE IT.** -56 A7 had recorded PUBLIC EXECUTE on this function. When I built the fixture from the LOCAL catalogue (BB-2), I reported the risk of a hosted-only function in general terms, and did not look in the record for a known instance. The fence did its job; the fixture could have carried the entry from the start.

**BE-3 — this change carries:**
- the readings above;
- the frozen boundary at 20 (`ledger_rows: 20`, from fence 5's twenty `already applied` lines);
- step 5 restated to 0 pending, and step 7 to 001-020;
- BC-2's step 4b;
- the Supabase row;
- BE-1, BE-2, and the BC, BD and BE landings.

**BE-4 — ORDER:** 021's pull request opens only after this change merges and fence 6 re-reads PASS. Merging `main` into 021 then restates its step 5 to 1 pending (021), and moves 4b's invite-gate row onto `app.facility_agreement`.

### R-2026-09-24-78 — #71 merged; 021's three findings ruled; fence 6 is not run between 021's merge and its apply

_Issued as R-PROVISIONAL-2026-09-24-BF, by Cowork on 2026-09-24, as its check of #71 at `ef33fa6` and its rulings on 021's build findings. Pasting it was the founder's merge word for #71. Number assigned on landing: R-2026-09-24-77 plus one, read on this branch after `main` (with -77) was merged in. Record-only; lands on `pr-3.4b-db-021`, with 021. Next provisional letter: BG._

**COWORK'S READINGS, re-read on landing:** #71 open at `ef33fa6`, base `4a6a9e9`, CLEAN, seven check runs success, all read from the API before the merge. Also re-read from the files: the fixture's 24 `functions` entries and its one `hosted_only` entry; the read-back's handling of each section; the comment-only change to `scripts/provision_ward_account.mjs`; and the Supabase processor row. **#71 merged at `f1d3a1f`** (parents `4a6a9e9`, `ef33fa6`), MERGED read back from the API, and `record-020-apply` deleted afterwards (404).

**THEN:** the founder refreshes the deploy checkout and re-runs fence 6 ONLY. It must read PASS, with `public.rls_auto_enable()` reading `ok` under `(hosted-only)`. **Not yet run when this lands.**

**BF-1 — 021'S THREE FINDINGS:**
- **a) The move is dropped and the pre-check kept.** 021 refuses to apply over any contact row carrying `agreement_accepted_at`, naming the count, and then drops the column. The down migration restores the column empty. Already as built, and 021's header now cites this.
- **b) `operator_record_agreement` has no `p_expected_version`.** It never overwrites: an identical repeat returns, and a different agreement is `AGREEMENT_ALREADY_RECORDED`. Already as built.
- **c) One read path, `operator_register()`. The mechanism differs from BF-1 c as written, and the property is kept.**
  - BF-1 c asks that 021 keep `operator_list_facilities()` with EXECUTE revoked from authenticated, and a fixture entry `execute []` reading "kept so 020 re-applies unchanged". **021 as built DROPS it instead.**
  - **A kept function would be broken.** Its 020 body reads `facility_contact.agreement_accepted_at` (020:698), which 021 drops, so every call would error. That is a function left in the schema that cannot run.
  - **020 still re-applies unchanged with the drop.** A re-apply of 020 recreates the function, a re-apply of 021 drops it again, and `tests/db/migration_idempotency.test.ts` passes on exactly that sequence.
  - The down migration restores it with 020's body and grant.
  - So there is one read path and no fixture entry, because there is no function. The D3 list holds `operator_register` and not the old name. 3.4b-app calls `operator_register` only, and only it enters the Worker allow-list.
  - **For Cowork to overrule before 021's pull request.** _Superseded 2026-09-24 by R-2026-09-24-79 BG-1: BF-1 c's keep-and-revoke is replaced by the drop, which is accepted for the reason above._

**BF-2 — FENCE 6 AROUND 021.** Between 021's merge and its hosted apply, fence 6 is not run: from the merge, the fixture names 021's functions, which hosted does not yet have. 021's apply uses 020's six fences, with fence 6 after the apply. Runbook step 5's new "021's apply" subsection states both. It lists 021's expectation for each fence, and names `operator_list_facilities` as a function that must be gone after the apply.

**BF-3 — THE REWORK, done on `pr-3.4b-db-021`:**
- `main` (with #71) is merged in.
- Step 5 is restated to 1 pending (021), and the guard's pinned legs to ONE naming 021.
- Step 4b's row 4 cites 021's restated `provision_begin` (021:282-291, with `AGREEMENT_WITHDRAWN`), and the interim notes are dropped.
- The grants fixture keeps `hosted_only`, adds 021's entries, and has no `operator_list_facilities`.

**021's pull request opens only after fence 6 reads PASS on hosted (BE-4), and its report goes to Cowork.**

### R-2026-09-24-79 — BF-1 c's departure accepted: 021 drops operator_list_facilities()

_Issued as R-PROVISIONAL-2026-09-24-BG, by Cowork on 2026-09-24. Number assigned on landing: R-2026-09-24-78 plus one. Record-only; lands on `pr-3.4b-db-021`, with 021. Next provisional letter: BH._

**VERIFIED BY COWORK** (GitHub API and repository, 2026-09-24; Cowork's reading, re-read on landing):
- #71 is closed and merged, with merge commit `f1d3a1f` (parents `4a6a9e9` and `ef33fa6`). `origin/main` is `f1d3a1f`, and `record-020-apply` returns 404.
- `pr-3.4b-db-021` is at `f0fd237`.
- 021 and its down migration are present. Line 585 is `DROP FUNCTION IF EXISTS public.operator_list_facilities() RESTRICT`.
- The branch's grants fixture has no `operator_list_facilities` entry. It carries `operator_get_contact`, `operator_record_agreement`, `operator_record_contact` and `operator_register`, and keeps `public.rls_auto_enable()` in `hosted_only`.

**BG-1 — THE DROP IS ACCEPTED.** 021 drops `operator_list_facilities()` rather than revoking it. **BF-1 c is superseded by this.** The reason:
- Its 020 body reads `facility_contact.agreement_accepted_at`, which 021 removes, so a kept copy would fail on every call. **A dead function is not a safe one.**
- 020 still re-applies unchanged: it recreates the function, and 021 drops it again. `tests/db/migration_idempotency.test.ts` covers that sequence.
- The down migration restores it with its grant.

021's header now cites this entry in place of BF-1 c.

**BG-2 — THE PULL REQUEST WAITS FOR PASS.** 021's PR is not opened until Cowork relays fence 6 PASS. That condition is met by R-2026-09-24-80.

### R-2026-09-24-80 — fence 6 reads PASS on hosted; 020's apply is complete; 021's pull request opens

_Issued as R-PROVISIONAL-2026-09-24-BH, by Cowork on 2026-09-24. Number assigned on landing: R-2026-09-24-79 plus one. Record-only; lands on `pr-3.4b-db-021`, with 021 (BH-1). Next provisional letter: BI._

**THE FOUNDER'S READING.** Evidence kind: the founder's terminal output, relayed by Cowork. I did not run it and did not see it.
- It ran on 2026-09-24 from the deploy checkout at `~/Desktop/OpenBed-NG-deploy`.
- The checkout was refreshed with a fetch, a detach and `npm ci`, leaving HEAD at `f1d3a1f`.
- `bash scripts/readback_function_grants.sh` printed 25 lines, all `ok`. The 24 fixture functions read as expected, including:
  - `provision_begin` and `provision_complete`, whose EXECUTE is none;
  - `operator_list_facilities()`, whose EXECUTE is authenticated, because hosted is at 020.
- The `hosted_only` entry read: `ok public.rls_auto_enable() (hosted-only): anon,authenticated,service_role owner=postgres returns=event_trigger definer=true`.
- The last line read: `PASS: every function in app, graphql_public and public is executable by exactly the roles packages/fixtures/function-grants.json names.`

**BH-1 — RECORDED.**
- **020's apply is complete.** All six fences are read, and fence 6 now reads PASS.
- **BE-1 is closed by this PASS.** R-2026-09-24-77 left the hosted-only function to be proved by a re-run of fence 6, and this is that re-run.
- Runbook step 5 records the re-run:
  - the "020's apply" subsection says it has run;
  - the 020 checkbox carries the reading.
- No boundary moves. It stays at 20.

**BH-2 — 021'S PULL REQUEST OPENS NOW.** BE-4 and BG-2 are satisfied. Its report goes to Cowork: the head SHA, the seven check runs from the API, the fresh-database attestation, the Standard P ledger, and step 5's "021's apply" fences exactly as written. Cowork checks them before the founder gives the merge word. **Nothing is run on hosted until the founder runs 021's fences after the merge.**

### R-2026-09-24-81 — the register reports an agreement as none, recorded or withdrawn; the dated-unit guard is queued

_Issued as R-PROVISIONAL-2026-09-24-BI, by Cowork on 2026-09-24, as its check of #72 at `46b522f`. Number assigned on landing: R-2026-09-24-80 plus one. Record-only apart from BI-1's change, which lands on `pr-3.4b-db-021` with 021. Next provisional letter: BJ._

**VERIFIED BY COWORK** (GitHub API and repository, 2026-09-24; Cowork's reading, re-read on landing):
- #72: open at `46b522f`, base `f1d3a1f`, mergeable CLEAN, with all seven check runs success.
- 021, read directly, in its table:
  - `app.facility_agreement` carries the version-label CHECK, `signatory_role` of 1 to 64 characters, and `withdrawn_on >= accepted_on`.
  - RLS is enabled and forced, and every grant is revoked.
- 021's migration steps:
  - The pre-check comes before the column is dropped.
  - Both gates require a contact and an agreement, and refuse `AGREEMENT_WITHDRAWN`.
  - `operator_list_facilities` is dropped.
- 021's functions:
  - The four operator functions call `app.assert_operator()` first.
  - The Lagos date is used for the future-date refusal.
  - `record_agreement` is an insert or an identical repeat, and never an overwrite.
  - `server_now` is built outside the aggregate.
- `supabase-proxy/allow-list.json` is unchanged.

**BI-1 — DONE on #72: `agreement_recorded` is replaced by `agreement_state`, one of `'none'`, `'recorded'` or `'withdrawn'`.**
- **The defect.** The yes/no read a withdrawn agreement as "none" (`withdrawn_on IS NULL`). The operator would then try to record one and be refused `AGREEMENT_ALREADY_RECORDED`: a dead end that also hid the withdrawal.
- **The mechanism.** A CASE over the one `app.facility_agreement` row (the primary key), falling back to `'none'`. "Withdrawn" is `withdrawn_on IS NOT NULL`, the same test both gates refuse `AGREEMENT_WITHDRAWN` on, so the register and the gates cannot disagree.
- **This amends BD-1's register yes/no** (item f as issued) for the agreement only. `has_contact` stays a yes/no, and `operator_get_contact` is unchanged.
- **Tests:**
  - `tests/db/operator_contact_and_agreement.test.ts` has one leg per state. It also has a listed facility whose agreement is then withdrawn: it reads `'withdrawn'`, stays listed, and a new record is still refused by name.
  - Each leg asserts that no `agreement_recorded` key is returned.
  - The erasure leg now reads `'recorded'`.
  - `tests/db/operator_functions.test.ts` reads `'none'`.
- **The ledger's register row** now maps 020's `agreement_recorded` to `agreement_state`.
- **Two premises did not hold as stated:**
  - **Neither the platform-admin HTTP test nor the runbook named the field.** The HTTP test checked only the envelope's shape. It now also asserts, over a non-empty register, that every facility carries `agreement_state` with one of the three values and no `agreement_recorded`. The runbook needed nothing.
  - **"The founder's SQL step" for withdrawal does not exist yet.** It is BD-2 2's, written in 3.4b-app. The legs run the UPDATE that step will run, as owner.

**AN OBSERVATION FOR COWORK, not changed here.** Withdrawal leaves `listed_at` set. A facility whose agreement is withdrawn stays on the public page until someone unlists it, and nothing unlists it. The listed-then-withdrawn leg pins today's behaviour. **The BD-2 2 withdrawal step should say whether it unlists**, and when that step is written it will need a ruling on this.

**BI-2 — QUEUED for the change that records 021's apply,** which edits step 5 anyway:
- `runbook_migration_expectation`'s date exemption is to key on an explicit dated-history marker, such as "Restated YYYY-MM-DD" or "On YYYY-MM-DD", and never on any ISO date anywhere in the unit.
- It gets a plant: an undated count statement citing a ruling number reads red.
- Every existing statement the tightened guard catches is reported and restated. None is exempted to go green.

### R-2026-09-24-82 — a withdrawn agreement takes a facility off the public output by itself

_Issued as R-PROVISIONAL-2026-09-24-BJ, by Cowork on 2026-09-24, as its check of #72 at `b276f44`. Number assigned on landing: R-2026-09-24-81 plus one. BJ-1 a-d change 021 on `pr-3.4b-db-021`; BJ-1 e is a ruling for 3.4b-app. Next provisional letter: BK._

**VERIFIED BY COWORK** (GitHub API and repository, 2026-09-24; Cowork's reading, re-read on landing):
- #72 was open at `b276f44`, base `f1d3a1f`, mergeable CLEAN, with all seven check runs success.
- `agreement_state` read `'recorded'` or `'withdrawn'` from the one agreement row, else `'none'`, and no `agreement_recorded` key remained.

**BJ-1 — STRUCTURAL.** This follows from -81's observation that withdrawing an agreement left the facility public until someone unlisted it. **A withdrawn data-sharing agreement ends the basis for publishing that facility's data, so removal must not depend on a second manual statement being remembered.**

**a) Both public membership predicates gain "no withdrawn agreement".** The sites were enumerated from the live local catalogue at `b276f44` on 2026-09-24. The scope was every function in `app`, `public` and `graphql_public` whose source reads `listed_at` or names a mirror; there are 0 views and 0 materialized views.
- **`app.project_facility(uuid)`** is the only writer of `facility_public` and `ward_public`.
- **`app.refresh_lga_rollup()`** is the only writer of `lga_rollup`.
- **Each is restated in 021 section 6 as 020's body verbatim, plus one line** after `listed_at IS NOT NULL`: `AND NOT EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = f.id AND a.withdrawn_on IS NOT NULL)`.
- **The rest inherit or are not public.** `app.regenerate_snapshot()` and `publish_ward_status` read the mirrors only, so they inherit the first site. `operator_create_facility`, `operator_register` and `operator_set_facility_listed` read `listed_at` for the operator, not the public.
- **The predicate is "no withdrawn agreement", not "has an agreement".** A facility with no agreement row, such as the seed's, is unaffected. _Superseded 2026-09-24 by R-2026-09-24-83 BK-1: the predicate is now positive, an agreement that is not withdrawn. A facility with no agreement row is NOT public. **The invariant is: public implies an active agreement.**_

**b) The trigger.** `trg_facility_agreement_project` fires AFTER INSERT OR UPDATE OR DELETE on `app.facility_agreement`, FOR EACH ROW, and calls **008's `app.trg_project()`**, which already resolves `facility_id` for every table except `facility`. There is no second projection path and no new function, so the grants fixture is unchanged.
- Setting `withdrawn_on` empties the facility's mirror rows **in the same transaction**.
- The rollup stops counting the facility at its next refresh (every five minutes).
- `tests/db/projection_trigger_state.test.ts` and `tests/db/projection_ward_public.test.ts` now hold four projection triggers.

**c) The tests,** in the new `tests/db/agreement_withdrawal_public.test.ts`, modelled on the listing test:
- **Mirrors:** a listed facility with a published ward reads 1 and 1. The founder's withdrawal UPDATE alone leaves 0 and 0, read in the same transaction.
- **Rollup:** the facility under test is the fifth of five quiet facilities in one LGA, so the cell exists before the withdrawal and not after.
- **No agreement:** a facility with no agreement row stays public.
- **Plants:**
  - Each site's predicate is removed in turn, from 021's text, and each leaks.
  - The trigger is dropped, and the mirrors do not move.
- **The -81 leg,** a listed facility withdrawn afterwards, now also reads **listed but not public**: 1 and 1 before, 0 and 0 after.

**d) B1 holds.** `tests/db/migration_021_round_trip.test.ts` holds both bodies by value: 021's equal 020's with only the predicate inserted. The down migration restores 020's byte for byte.
- Across down-then-up, the mirrors are unchanged.
- The rollup is recomputed under each body in a rolled-back transaction, and the cells are equal. The seed's Alimosho cell makes this non-vacuous.
- On apply there is no agreement row, so the trigger has nothing to fire on and the predicate excludes nothing.

**Line citations moved, and one was wrong.** 021's header grew, and a citation of a line is a fact about one SHA.
- **The invite gate is now 021:313-322.** Runbook step 4b row 4 is restated to that span.
- **The cite it replaces, 021:282-291 (from 52dacfd), was wrong when written.** That span ended at `NO_FACILITY_CONTACT` and never reached the agreement checks it named, which were at 292-298. That was my error, and Cowork's -79 relied on it.
- -79's "line 585" and the other cites earlier in this record are left as history, true at the SHA they name.

**e) THE WITHDRAWAL STEP, a ruling for 3.4b-app** (BD-2 2; written there, to this):
1. Set `withdrawn_on`. The public output drops by itself; the page follows in about 2 minutes (020's B2).
2. Deactivate the facility's ward accounts.
3. Clear `listed_at`, so the register reads "not listed". Publishing again needs a deliberate new agreement and a re-listing. _Pointer, 2026-09-24: in v1 this has no path; see R-2026-09-24-100's open item._
4. Read back `/beds.json`.

**BI-2 stays queued** for the change that records 021's apply.

**The Standard P ledger has 12 rows, and 0 failures.**
- **Row 5 is restated:** a contact write re-projects nothing, and an agreement write re-projects through 008's `trg_project`. Its plant nulls that function's `facility_id` branch.
- **Row 12 is new:** 021's two membership bodies are 020's plus the predicate. Its plant alters 020's `project_facility`.

### R-2026-09-24-83 — public requires an active agreement, and fails closed

_Issued as R-PROVISIONAL-2026-09-24-BK, by Cowork on 2026-09-24, as its check of #72 at `61dfae6`. Number assigned on landing: R-2026-09-24-82 plus one. BK-1 a-c change 021 on `pr-3.4b-db-021`; d and e are record. Next provisional letter: BL._

**VERIFIED BY COWORK** (GitHub API, repository and hosted catalogue, 2026-09-24; Cowork's reading, re-read on landing where the repository holds it):
- #72 was open at `61dfae6`, base `f1d3a1f`, CLEAN, with seven check runs success.
- 021 at `61dfae6` held:
  - BJ's predicate at 701 and 811;
  - the agreement trigger at 868-871, calling 008's `app.trg_project()`;
  - the `snapshot_schedule_state` change, which is test-only.
- **Hosted, read-only through the Supabase connector** (Cowork's reading; I have no hosted access):
  - `postgres` reads `rolsuper false`, `rolbypassrls true`.
  - `project_facility`, `refresh_lga_rollup`, `regenerate_snapshot` and `trg_project` are SECURITY DEFINER, owned by `postgres`.
  - Both cron jobs run as `postgres`.
  - `app.facility`, `app.ward_status` and `app.facility_contact` have RLS disabled.

**BK-1 — THE PREDICATE FAILED OPEN, AND ADMITTED A FACILITY WITH NO AGREEMENT. IT IS NOW POSITIVE.**

**a) Both sites now read `AND EXISTS (SELECT 1 FROM app.facility_agreement a WHERE a.facility_id = f.id AND a.withdrawn_on IS NULL)`,** in 021 section 6.
- Public means listed, active, not quiet, AND an active agreement.
- Any failure to read the table hides data rather than exposing it.
- The down still restores 020's bodies byte for byte.

**b) A second pre-check, `LISTED_WITHOUT_AGREEMENT`,** refuses to apply while any listed facility has no agreement row, naming the count. Before the table exists every listed facility counts; on a re-apply, those with no row count.
- **Synthetic agreement rows were added.** The seed gets one per listed facility (`synthetic-v1`, signatory `CMD`, a role and never a name). The e2e corpus gets them too, and so does every db fixture that lists a facility and expects public output:
  - `facility_listing`, `gate_semantics`, `lga_rollup_kfloor`;
  - `projection_quiet_mode`, `projection_ward_public`;
  - `public_labels_enum`, `publish_ward_status`, `snapshot_single_read`.
- **Only fixture lines changed, no assertion.** `snapshot_single_read`'s committed cleanup now deletes the agreement before the facility, because the foreign key is RESTRICT by design.

**c) The tests,** in `tests/db/agreement_withdrawal_public.test.ts`:
- **(i)** A listed facility with no agreement row is not public, in the mirrors or the rollup.
- **(ii) Fails closed, asserted as the DECISION.** Under a stand-in owner without BYPASSRLS, which has every grant it needs:
  - 021's projection completes and writes nothing;
  - 021's rollup, with `row_security` reset, returns 0 and writes no cell;
  - **counter-plants** with BJ's `NOT EXISTS` body, same owner: both attempt the write.
- **(iii)** The withdrawal legs pass unchanged.
- **(iv)** Removing the `EXISTS` from each site leaks, and dropping the trigger leaves the mirrors unmoved.
- `snapshot_schedule_state` passes with **no expectation changed.**

**A PREMISE THAT HOLDS ONLY IN PART.** "Every withdrawn facility reads as publishable" is true of BJ's predicate: the counter-plants show it deciding to publish. **It does not reach public output on today's schema, though.** The mirrors (`facility_public`, `ward_public`, `lga_rollup`) have RLS forced with no policy for their writer, so the non-bypass owner's attempt raises `new row violates row-level security policy`. The instruction stands on its other grounds:
- publishing requires an agreement;
- the positive predicate does not depend on the mirrors' RLS;
- a future policy on a mirror would have opened the path.

**B1 IS NOW STRUCTURAL.**
- On a first apply the agreement table does not exist, so the pre-check admits 021 only where no facility is listed. An unlisted facility is public nowhere, so the public output is empty before and after. Hosted holds 0 facilities.
- `tests/db/migration_021_round_trip.test.ts` shows:
  - that empty shape;
  - that the down writes no public row over the seed's published state;
  - that a re-apply over it changes no public row;
  - the refusal, naming the count derived from the database.

**THE ROUND-TRIP MECHANISM CHANGED, and why.** BD-1 made 021's down refuse while any agreement exists. BK-1 b gives the seed agreements. Together:
- the down now refuses on the shared database;
- after any down, the forward refuses.

So `migration_020_round_trip` and `migration_021_round_trip` no longer apply files committed through psql. Each leg applies the file texts inside one rolled-back transaction, as `snapshot_schedule_state` does with 017, and nothing is committed. Before a down, the leg takes, in that transaction, the founder's decision the refusal exists to force: the agreements go, with the agreement trigger disabled so the mirrors keep the state being compared.
- **020's assertions are unchanged.**
- **One assertion of 021's is removed and replaced:** the committed "down then up changes NO public row". "Up" over the seed is refused by design. It is replaced by the three legs above and the first-apply leg.

**d) -82's wording is superseded** where it said a facility with no agreement stays public. The invariant is **public implies an active agreement.**

**e) NOTE, no change.** `app.facility_agreement` is the one `app` table with RLS enabled and forced:
- locally, by the migrations;
- on hosted, by Cowork's reading, where the other `app` tables have RLS disabled.

It stays. With a positive predicate it can only fail closed.

**Runbook step 5, "021's apply" fence 3** names the second pre-check. Hosted has neither condition.

**The Standard P ledger has 13 rows, and 0 failures.**
- **Row 12's line is the EXISTS form.**
- **Row 13 is new:** the column 020 adds as the listing state is the one the pre-check counts in both branches, and the one both of 020's membership bodies require. Its plant renames 020's column, and it is REPORTED.

### R-2026-09-24-84 — #72 merged; the round-trip mechanism accepted

_Issued as R-PROVISIONAL-2026-09-24-BL, by Cowork on 2026-09-24, as its check of #72 at `b568eab`. Pasting it was the founder's merge word for #72. Number assigned on landing: R-2026-09-24-83 plus one. Record-only; lands with the change that records 021's apply (R-46). Next provisional letter: BM._

**VERIFIED BY COWORK** (GitHub API and repository, 2026-09-24):
- #72 was open at `b568eab`, base `f1d3a1f`, CLEAN, with seven check runs success.
- 021:734 and 021:844 carry the positive predicate. The pre-checks are at 021:116 and 021:139. The synthetic agreements are in the seed and fixtures only.

**THE MERGE.**
- The head was read from the API as `b568eab` before merging with `--match-head-commit`.
- #72 merged as a merge commit, **`f6889d4b631b1715de4134c6db734c8a90cf320c`** (parents `f1d3a1f` and `b568eab`), and read back as MERGED at 2026-09-24T12:23:41Z.
- `pr-3.4b-db-021` was deleted after that, as a separate step; the API answers "Branch not found".

**BL-1 — THE ROUND-TRIP MECHANISM IS ACCEPTED.**
- **The reason:** applying 020 and 021 inside a rolled-back transaction in `migration_020_round_trip` and `migration_021_round_trip` is faithful to production, because `scripts/run_migrations.sh` applies each file with `--single-transaction`.
- **The replacements for the retired "down then up over the seed" leg are accepted:**
  - the first apply (nothing listed, nothing public);
  - the down writes no public row;
  - a re-apply changes no public row;
  - the `LISTED_WITHOUT_AGREEMENT` refusal, with its count read from the database.

**BL-2 — BK'S PARTIAL PREMISE, as -83 states it.** BJ's predicate decided to publish under a non-bypass owner, and the mirrors' forced RLS refused the write. BK-1 stands on its own grounds: publishing requires an agreement, and the predicate no longer relies on a second control.

### R-2026-09-24-85 — 021 applied on hosted; the boundary at 21; the dated-history marker tightened

_Issued as R-PROVISIONAL-2026-09-24-BM, by Cowork on 2026-09-24, as its read-back of 021's hosted apply. Number assigned on landing: R-2026-09-24-84 plus one. Next provisional letter: BN._

**THE FOUNDER'S READINGS.** Evidence kind: the founder's terminal output, run from `~/Desktop/OpenBed-NG-deploy`, relayed by Cowork. I did not run it and did not see it.
- **Fence 0:** HEAD `f6889d4` after fetch, detach and `npm ci`.
- **Fence 1:** 20 `already applied` (001-020), `WOULD APPLY 021_facility_agreement_and_contact_write.sql`, `1 migration(s) pending.`
- **Fence 2:** `beds.json` `0/0:543f06c0b0c4`, and `facility_public`, `ward_public` and `lga_rollup` each `0:d41d8cd98f00`. `RECORDED`.
- **Fence 3:** 001-020 skipped and 021 applied. The echo, in order:
  - DO, DO, CREATE TABLE, COMMENT, ALTER TABLE ×2, REVOKE, DO, ALTER TABLE ×2, COMMENT, CREATE FUNCTION, REVOKE;
  - NOTICE (trigger "trg_facility_contact_version" does not exist, skipping), DROP TRIGGER, CREATE TRIGGER;
  - CREATE FUNCTION ×5, DROP FUNCTION, CREATE FUNCTION ×3;
  - NOTICE (trigger "trg_facility_agreement_project" does not exist, skipping), DROP TRIGGER, CREATE TRIGGER;
  - DO, INSERT 0 1, INSERT 0 0, `Migrations complete (1 applied this run).`
- **Fence 4:** all four parts ok against the fence 2 fingerprint, `PASS (VACUOUS FOR B1)`. The founder also ran the no-fingerprint form once before it; that form is read-only.
- **Fence 5:** 21 `already applied` (001-021), no `WOULD APPLY`, `0 migration(s) pending.`
- **Fence 6:** 29 lines, all ok, and the `PASS:` line. Among them:
  - `app.bump_row_version()` none;
  - the four 021 functions each authenticated;
  - `operator_list_facilities` absent;
  - `public.rls_auto_enable()` ok (hosted-only).

**BM-1 — RECORDED, in this change:**
- **The frozen boundary is at 21:** `node scripts/freeze_applied_migrations.mjs 21 2026-09-24 R-2026-09-24-85`. `ledger_rows: 21` comes from fence 5's twenty-one `already applied` lines. 021's sha256 in `applied-hosted.json` equals the tracked file's at `f6889d4`, the commit the founder applied from.
- **Runbook step 5 is restated to 0 pending at every site the guard reads,** and the guard's pinned legs to the zero state, as after 018's, 019's and 020's applies. 021's one-pending run is kept as a dated fence. "021's apply" is marked run, with a checkbox carrying the readings, and there is a frozen-boundary checkbox for 21.
- **Step 7:** 001-021. **Step 4b row 4:** "applied on hosted 2026-09-24".
- **BI-2, done.** `tests/compliance/runbook_migration_expectation.test.ts`'s `dateUnits` now keys "dated" on `HISTORY_MARKER`, the runbook's own two forms "Restated YYYY-MM-DD" and "On YYYY-MM-DD", never on any ISO date in the unit.
  - A new plant: an undated count citing a ruling number, and one with a bare date, each read red. Both were first shown red under the old rule.
  - **The tightened marker caught seventeen statements in thirteen units** (corrected from "twelve" by R-2026-09-24-86 BN-1). Each was restated to carry "On <date>" or "Restated <date>", and none was exempted:
    - the 2026-09-12 refusal note and the 2026-09-14 "exactly 13" note;
    - the 2026-09-22 pre-apply reading checkbox;
    - **020's fence 5 prose**, the case -81 named;
    - the four "observed on hosted" ledger notes (2026-09-16, -17, -22, -23);
    - the five applied checkboxes for 014-016, 017, 018, 019 and 020.
  - One fixture line in the guard's own positive control, "Once, on 2020-01-01", also became "On 2020-01-01".
- **The 3.4b-app carry:** under PR 3.4 in `Sprint Kickoffs/sprint-kickoff-bundle3-operator-path-2026-09-22.md`:
  - the withdrawal step (-82 e);
  - public requires an active agreement (-83);
  - one read path;
  - the facility-creation task's `agreement_accepted_at` line, marked superseded by 021.

**BM-3 — STOP after this merges.** 3.4b-app waits for the next Cowork session's kickoff and is not started from earlier notes. Nothing hosted.

### R-2026-09-24-86 — four corrections on #73: the unit count, the read path, dating the count, and who withdraws

_Issued as R-PROVISIONAL-2026-09-24-BN, by Cowork on 2026-09-24, as its check of #73 at `4c779a6` with the staff-engineer and QA passes. Not a merge word. Number assigned on landing: R-2026-09-24-85 plus one. Lands on `record-021-apply`, in #73. Next provisional letter: BO._

**VERIFIED BY COWORK** (GitHub API and repository at `4c779a6`, 2026-09-24):
- #73 was OPEN at `4c779a6`, base `f6889d4`, mergeable and clean: 1 commit, 5 files, seven check runs success.
- The recorded hash for 021 equals the tracked file's.
- The fixture holds 28 functions plus 1 hosted-only.
- 021:218 and 021:901 are the two guarded trigger drops, and 021:635 drops `operator_list_facilities`.
- `runbook_migration_expectation` and `frozen_migrations` pass, 28 of 28.
- Under the old ISO_DATE rule the BI-2 examples read 0 unguarded; under HISTORY_MARKER they read 1 each.
- HISTORY_MARKER finds 17 unguarded statements in `main`'s runbook and 0 in #73's.

**BN-1 — THE UNIT COUNT IS 13, NOT 12. Derived, not taken from the ruling.**
- **How:** I replicated the guard's `dateUnits` and `guardedRegions` read-only in node, ran them over `main`'s runbook with #73's HISTORY_MARKER, and counted the distinct unit starts of the 17 unguarded statements. That gave **13**:
  - units starting at lines 723, 733, 1220 and 1493;
  - the four observed notes, starting at 1749, 1752, 1755 and 1760;
  - the five applied checkboxes, 1798 to 1802, where 1799 to 1802 hold two statements each.
- -85 listed thirteen and said twelve. The number is corrected in the HISTORY_MARKER comment, -85's BI-2 bullet and the BM ledger row. The comment's "restated to carry "On <date>"" now reads "…"On <date>" or "Restated <date>"".

**BN-2 — THE 3.4b-APP CARRY OVERSTATED BF-1 c.** "Only `operator_register` enters the Worker allow-list" turned a rule about the listing READ into a rule about the whole allow-list, which would have excluded the operator writes 3.4b-app needs. It is restated in two bullets:
- **One listing read:** `operator_register` replaces the dropped `operator_list_facilities`, whose name never enters the allow-list. The `agreement_state` sentence is kept.
- **The Worker allow-list stays derived from the admin app's actual call sites** (-58 A5), and which operator functions it calls is decided at 3.4b-app's kickoff.
- -78's text is left alone; it is correct in context.

**BN-3 — THE MARKER DATES THE COUNT THAT FOLLOWS IT, NOT THE WHOLE UNIT.** #73's rule exempted a whole unit when a marker appeared anywhere in it. Cowork's QA found three forms that passed undated:
- (a) a live count followed by its own restatement note, which is this runbook's house style;
- (b) a marker after the count;
- (c) a fence under a dated list item.

The fix, in `tests/compliance/runbook_migration_expectation.test.ts`:
- **In `unguardedPendingStatements`,** a count in a unit that is not a fence is history only if HISTORY_MARKER matches in `runbook.slice(unit.start, at)`, i.e. before the count.
- **In `dateUnits`,** only a plain paragraph dates the fence that follows it. A unit starting "- " or "N. " never does.
- **A new plant leg holds (a), (b) and (c) verbatim.** For (a), the flagged count is the live `4`, not the restatement's `3`.
  - **Before the fix:** each read `[]`, i.e. passed undated. I showed this by running the leg with its three plant assertions switched to `expect.soft` under `4c779a6`'s rule, so that all three failures print, then reverted.
  - **After the fix:** the leg is green.
- **The positive controls stay dated:** "**On 2026-09-24, when 021 was pending,** it printed:" plus a fence, and a "- [x] On <date>, …" checkbox.
- **The whole-document scan reads 0 on #73's runbook under the fix.** No runbook wording changes.
- The comment says the marker dates what follows it, and names an impossible or future date ("On 2026-99-99") as not checked.

**BN-4 — THE WITHDRAWAL STEP SAYS WHO SETS `withdrawn_on`.** Step 1 of the carried withdrawal step now reads: by a founder SQL step, never an operator function (BD-2 2, and 021's column comment at 021:161-163). Without that, 3.4b-app could fill the gap with an `operator_withdraw` function the record forbids.

**BN-5 — NOTHING ELSE CHANGES.** No migration, no change to `applied-hosted.json`, nothing hosted. After the new head is reported, STOP. Cowork checks it, then the founder gives the merge word. BM-3 still holds after the merge.

### R-2026-09-24-87 — #73 merged; Cowork's check at `fc175c4`

_Issued as R-PROVISIONAL-2026-09-24-BO, by Cowork on 2026-09-24. It was #73's merge word, and it carries Cowork's check of #73 at `fc175c4`. Number assigned on landing: R-2026-09-24-86 plus one. Record-only; it lands with the next change that touches the record, which is 3.4b-app's PR A. Next provisional letter: BP._

**VERIFIED BY COWORK** (GitHub API and repository, 2026-09-24). Evidence kind: Cowork's readings, relayed. I carried them in the session's pending notes and did not re-read the API for this entry.
- #73 at `fc175c4` was clean, with seven check runs success.
- `4c779a6..fc175c4` touched only the record, the kickoff and the guard test.
- `runbook_migration_expectation` plus `frozen_migrations` read 29 of 29 pass.
- Cowork's QA re-run of BN-3's flags (a) to (g) read 1 each, and the positive controls read 0.
- The whole-document scan reads 0 on `fc175c4`'s runbook and 17 on the old `main`'s.

**THE MERGE.** #73 merged as **`faf984a6a1dfda94be6ab02af8ba4084d667f33d`** (parents `f6889d4` and `fc175c4`). `record-021-apply` was deleted after MERGED was read back from the API, as a separate step.

**BO-2 — STOP UNTIL THE 3.4b-APP KICKOFF.** Nothing was started from earlier notes, and nothing ran on hosted. The kickoff arrived as BP (-88).

### R-2026-09-24-88 — the 3.4b-app kickoff: three pull requests, the calls for each

_Issued as R-PROVISIONAL-2026-09-24-BP, by Cowork on 2026-09-24, inside `Sprint Kickoffs/sprint-kickoff-bundle3-3.4b-app-2026-09-24.md`. That file is committed unedited in the same change (method note 15). Before acting, I read its sha256 as `cdde3c78c76a05986655debf242d72a23c577bcb23f98f79123556a21ab09f56` and its size as 31132 bytes, and re-read both after the copy. Number assigned on landing: R-2026-09-24-87 plus one. Next provisional letter: BQ._

**The ruling's text is the kickoff's section "R-PROVISIONAL-2026-09-24-BP", BP-1 to BP-14. It is not restated here,** so the two cannot drift. In one line each:
- BP-1: three PRs, merged A, B, C.
- BP-2: the admin app calls all eight `operator_*` functions.
- BP-3: the admin app shows database facts only.
- BP-4: every write is safe to repeat.
- BP-5: the contact is never logged.
- BP-6: the script goes through the gates.
- BP-7: the redirect read-back script.
- BP-8: the zero-ward stop.
- BP-9: one source for per-app lists.
- BP-10: contacts, fonts and headers.
- BP-11: the admin deploy.
- BP-12: the golden path's operator step.
- BP-13: the founder's runbook steps.
- BP-14: the blast radius per PR.

**Checked against the code before acting** (standing rule):
- **The kickoff's finding holds.** `scripts/provision_ward_account.mjs` at `faf984a` called neither `app.provision_begin` nor `app.provision_complete`.
- **A second false fact, not in the kickoff:** step 4b row 4 cited `021:313-322` for the three gate refusals. Those lines are the `p_role` parse. The raises are at 021:341, 344 and 347.

### R-2026-09-24-89 — the founder's two answers to the kickoff's open decisions

_Issued as R-PROVISIONAL-2026-09-24-BQ, by Cowork on 2026-09-24, relaying the founder. Record-only. It does not change PR A's design report, and it binds PR B and PR C. Number assigned on landing: R-2026-09-24-88 plus one. Next provisional letter: BR._

**BQ-1 — THE OPERATOR'S SIGN-IN ADDRESS IS A FOURTH, UNPUBLISHED, SIGN-IN-ONLY ROLE ADDRESS** at openbed.ng, chosen by the founder (AJ D9 satisfied).
- **It is NOT written into the repository:** no page, doc, runbook, fixture, test, script default or commit message.
- The runbook's operator-bootstrap step (BP-13) calls it "the operator's sign-in address", and the script takes it as input at run time.
- -75 BC-3's "security@, hello@, support@" is restated as the three PUBLISHED addresses. The tracked contacts file (BP-10) holds exactly those three. BC-3 is left as written, with a pointer here.
- **PR B:** the contacts test widens to "every @openbed.ng address anywhere in the tracked tree, outside Sprint Kickoffs/ and docs/handoff*, is one of the contacts file's three". Plant: a fourth address in an app's source reds it. This keeps the operator address out of the repository without naming it.

**BQ-2 — CLOUDFLARE ACCESS IS IN FRONT OF admin.openbed.ng** (founder, 2026-09-24). **Founder-reported, not yet read back.**

> **SUPERSEDED IN PART by R-2026-09-25-112 CN, by note rather than by rewriting (method note 8).** The heading's claim did not hold on 2026-09-24. The founder reports that Zero Trust held no Access application until 2026-09-25, and Cowork's outside read before setup found `admin.openbed.ng` answering 522 with no Access redirect. Access has stood in front of the admin hosts since 2026-09-25, read back from outside by Cowork at H6 step 1 (R-2026-09-25-113). The rest of BQ-2 (what Access does and does not do, the probes, the token and the sign-in order) stands. (c)'s `[unverified]` sign-in order was observed at H6 step 7: the fragment survives the bounce, in both orders.
- The login method is an identity provider with two-factor (GitHub or Google). The one-time-PIN method is off, because a PIN to the operator's own inbox would be the same factor twice. The policy admits the founder's identity only.
- **What Access does NOT do,** stated in the admin deploy runbook: it does not protect the operator RPCs, which are reached with a JWT through api.openbed.ng or the direct origin. The operator's mailbox stays the factor that guards the data.
- **Consequences for PR C:**
  - (a) **The \*.pages.dev hosts.** The admin Pages project's production \*.pages.dev alias and its preview deployments must be behind Access too, or the page is reachable around it. `readback_admin.sh` probes BOTH admin.openbed.ng and the project's pages.dev host.
  - (b) **The probes, and their failing half.**
    - Without an Access service token, each host must answer with Access's redirect or refusal, never with the app. STOP if /version.json or the app shell is served without a token.
    - With the token, the app's /version.json must name the deployed HEAD.
    - The token comes in as CF-Access-Client-Id and CF-Access-Client-Secret, from the environment at run time only: never tracked, never an argument, never printed.
    - A missing token is ERROR (exit 2), never PASS.
  - (c) **The sign-in order.** [unverified]
    - The magic link returns to https://admin.openbed.ng/ with the session in the URL fragment, which no server sees. If Access intercepts that load and bounces through its login, the fragment may be lost and the sign-in fail silently.
    - PR C shows the actual behaviour on a preview behind Access, in both orders: Access session already held, and not held. The runbook states the order that works, which is expected to be: pass Access first, then request the link.
    - If the fragment survives in both orders, PR C says so, with the observation.
- **Founder-side, at H6:** add the admin project's pages.dev hostname(s) to the Access application, and issue the service token when PR C's runbook asks for it.

### R-2026-09-24-90 — Cowork's ruling on PR A's design report: migration 022 in PR A

_Issued as R-PROVISIONAL-2026-09-24-BR, by Cowork on 2026-09-24. Cowork read the first version of PR A's design report in summary, because the file was in a folder Cowork cannot reach. Record-only; it lands in PR A after -89. Number assigned on landing: R-2026-09-24-89 plus one. Next provisional letter: BS._

**VERIFIED BY COWORK** at `faf984a`:
- **021:301-383 (`provision_begin`).** The PLATFORM_ADMIN branch nulls facility and category, gates nothing, and has no "complete" answer. After the first invite is accepted, a re-run opens a new invite, because the one-open-invite rule covers only `accepted_at IS NULL`. So a different address becomes a second operator.
- **020:844-901 (`provision_complete`).** An existing `ward_account` of the same scope returns `'complete'` whatever its `is_active`. An inactive account is reported complete, and cannot sign in.
- **The three gate refusals are at 021:341, 344 and 347.** -82's text and BJ's ledger row say "021:313-322", which is the role parsing. Both are left as written; this ruling is the correction, and PR A's step 4b row 4 cites 341-347. (BS-2 then moves that citation to 022's lines, once 022 lands.)

**BR-1 — MIGRATION 022, IN PR A.** The fallback, a script read-back plus a runbook stop, is refused: it is a second implementation of a gate outside SQL (-71 C; BP-6 4). 022 does exactly this and nothing else:
- **(a) At most one active PLATFORM_ADMIN, by the database.**
  - It is a partial unique index on `ward_account WHERE role = 'PLATFORM_ADMIN' AND is_active`, the same shape as J3's per-ward index.
  - 022 has a pre-check that refuses to apply while more than one active PLATFORM_ADMIN exists, naming the count. Hosted has none.
  - A second operator is BD-2 1's trigger: it needs a ruling and a migration that drops this index, never a script run.
- **(b) `provision_begin`, PLATFORM_ADMIN.** When an active PLATFORM_ADMIN exists, it returns `'complete'` with a NULL invite and opens nothing. The script then makes zero Auth calls (J4's rule for the operator) and prints that an operator account already exists and nothing was done. It never prints "provisioned".
- **(c) `provision_complete`, a deactivated account of the same scope: it REACTIVATES.**
  - It sets `is_active` true and `deactivated_at` NULL, keeping 003's consistency CHECK.
  - It writes its own audit action, `ward_account.reactivate`, distinct from `ward_account.provision`, and the script prints "reactivated".
  - This is safe only because `provision_begin`'s gates ran first. A ward whose agreement is withdrawn still gets `AGREEMENT_WITHDRAWN` at begin, and never reaches complete.
  - If another account is already active for that ward, or another operator is already active, the one-active index refuses. That refusal is named, never a raw 23505: `WARD_ALREADY_HAS_AN_ACCOUNT` for a ward, and a new `OPERATOR_ALREADY_EXISTS` for an operator. The two are told apart by constraint name, never by guessing the role.
- **(d) Required of the migration itself:**
  - a symmetric down migration that refuses while its own index would be needed (state what that means, or why it doesn't apply);
  - a round trip in the rolled-back-transaction idiom (BL-1);
  - idempotent re-apply over 021 and over itself (`migration_idempotency`);
  - no change to `packages/fixtures/function-grants.json`, and no public function (state that fence 6 is unaffected, and why);
  - step 5 restated for one pending migration, 022, at every site the guard reads;
  - `applied-hosted.json` untouched.
- **(e) Tests:**
  - a second PLATFORM_ADMIN refused by name;
  - a re-run bootstrap with zero Auth calls;
  - a deactivated ward re-provisioned and reactivated through the gates, with the audit row;
  - a withdrawn facility's deactivated ward refused at begin, with zero Auth calls;
  - two concurrent `complete()` calls on one invite, where one wins and the other is named.
- **(f) Hosted.** 022's apply is a founder step after PR A merges, using the six fences with 022's expectations. It must be applied before H6's operator bootstrap. The -45 gate is unaffected: 022 creates no facility and no ward_account row.

**BR-2 — THE ZERO-WARD STOP KEEPS THE SUPPORT ADDRESS.** Accepted, for the reason given: the only other way to reach zero rows is broken data on a real ward's account, and that person needs support.

**BR-3 — `enable_signup = false`:** accepted as summarised. Cowork rules on the exact rule text when it reads the report. The hosted toggle (H2) stays unchanged until PR A's local result is quoted.

**BR-4 — ALSO ACCEPTED, as summarised:**
- the E2E harness seeds the contact directly, beside the agreement it already seeds, and the operator route arrives with PR C's golden-path step;
- the host check is a module comparing the Auth URL and the database URL by project, with both mismatch plants;
- the failure-point table;
- the read-back script takes stdin only, and never prints the token;
- **`sb_secret_`:** if the local CLI issues none, say so and do not infer the answer from the legacy key. It then becomes a hosted read at H6 with a failing half, written into the bootstrap step.

**BR-5 — NOW:** amend the design report for BR-1 to BR-4, copy it to the handoff folder, print its sha256 and byte count, and STOP until Cowork gives the build word.
- **Done.** The amended report read sha256 `0a34d9dfa77b9258c5fec655f8496b99ebacc7cf2517af74d5cf069a9c929186` and 24074 bytes. It is committed unedited in this change as `Sprint Kickoffs/pr-a-design-report-2026-09-24.md` (BS-1 c).

**Checked before acting** (standing rule). Every premise BR states held on reading:
- -82's text at this file's line 3932, and BJ's ledger row, both cite 313-322;
- the partial index is at 020:332-334;
- `provision_complete` never reads `is_active` (020:863-876);
- 003's CHECK is at 003:234-236;
- audit actions are a verb **regex** (005:146), not a list, so `ward_account.reactivate` needs no schema change.

### R-2026-09-24-91 — Cowork's review of PR A's design report, and the build word

_Issued as R-PROVISIONAL-2026-09-24-BS, by Cowork on 2026-09-24. **Pasting it was the build word for PR A.** Record-only; lands in PR A after -90. Number assigned on landing: R-2026-09-24-90 plus one. Next provisional letter: BT._

**READ BY COWORK:** the report at sha256 `0a34d9dfa77b9258c5fec655f8496b99ebacc7cf2517af74d5cf069a9c929186`, 24074 bytes, read in full. §0-§9 are accepted as designed, amended only by BS-1 and BS-2. The staff-engineer and QA passes were applied.

**BS-1 — THE THREE OPEN ITEMS.**
- **(a) The down migration's refusal: CONFIRMED as read.**
  - It refuses (`OPERATOR_INDEX_IN_USE`, with the count) while an active PLATFORM_ADMIN exists, because the down also restores 021's `provision_begin`, which opens a fresh invite on a re-run. Nothing else in the down needs a refusal.
  - The build-time check in the report's §2a is required. If a db test leaves a committed PLATFORM_ADMIN active when the round-trip or idempotency legs run, the fix is that test's cleanup, which is the root cause. The down's refusal is never loosened, and tests are never ordered to avoid it.
- **(b) The ENABLE_SIGNUP RULE (the report's §8) is accepted, with two further PASS conditions.** Both are run on the local stack with both settings false:
  - **(4) The ward's own sign-in still works.** For the address just provisioned, a request shaped exactly like `packages/auth`'s `requestSignInLink` (POST /auth/v1/otp, `create_user` false, `redirect_to` the console origin plus "/") answers. The link it produces verifies to a session whose `my_facility_wards` call returns that ward. This proves sign-ups off does not lock provisioned wards out.
  - **(5) THE FAILING HALF, which shows the setting does its job.** POST /auth/v1/otp with `create_user` true, for an address GoTrue has never seen, creates NO `auth.users` row. Quote the status and the row count.
  - If either fails, the rule's "any other result" branch applies: no `config.toml` change, the result quoted, and a stop for a ruling. H2 stays unchanged in every case, and becomes a founder step only after a pass.
- **(c) Commit the report UNEDITED beside the kickoff** in `Sprint Kickoffs/`, and re-read its sha256 and byte count after the copy. They must equal the values above. BS records the amendments; the report is not edited to absorb them.

**BS-2 — ALSO RULED.**
- The zero-ward sentence is accepted as proposed (the report's §6), with the support sentence kept (BR-2).
- If `tracked_origins` scans that source, the admin host is read from "@openbed.ng/origins", never written around the guard.
  - **Checked before acting:** there is no package of that name. The origins package is `@openbed/origins` (`packages/origins/package.json`), which is what the report's §6 named. The instruction is applied to that package, and the ruling's text is left as issued.
- Step 4b row 4 cites the gate lines in 022's `provision_begin` once 022 lands, not 021's. Its text says "CLOSED by PR A", with the test names.
- PR A's body lists 022's hosted apply (six fences, with 022's expectations) as a founder step after the merge, required before H6's operator bootstrap. The -45 gate is unaffected.

**BS-3 — BUILD PR A NOW,** on a branch from `main` at `faf984a`, as designed and amended.
- **Before the merge word, report:**
  - the new head SHA and its seven check runs, read from the API;
  - the full suite and its attestation;
  - the E2E and the frontier;
  - the Standard P ledger, with its stopping rule declared first;
  - the behavioural-pass ledger, one row per control in the report's §9;
  - the zero-Auth matrix;
  - the two Auth results and the ENABLE_SIGNUP outcome, quoted from output;
  - the unchanged-files confirmations: `function-grants.json`, the D3 list, `applied-hosted.json` and public output.
- **Nothing hosted.** Stop after the report. PR B may be designed while PR A is in review, as a design report only, not built.

### R-2026-09-24-92 — #74 merged; sign-ups off becomes A.2; the leg-register hole goes to B

_Issued as R-PROVISIONAL-2026-09-24-BT, by Cowork on 2026-09-24, as its check of #74 at `c199b07`. **Pasting it was the founder's merge word for #74.** Record-only; it lands with the next change that touches the record, A.2 (this change). Number assigned on landing: R-2026-09-24-91 plus one. Next provisional letter: BU._

**VERIFIED BY COWORK** (2026-09-24):
- #74 was read from the GitHub API on the founder's machine: OPEN at `c199b07ef0ad6b21b77784c8ac282ba691f52d08`, base `faf984a`, mergeable and clean, 1 commit, 28 files, with seven check runs completed/success.
- The kickoff and the design report in the tree read as agreed.
- The script and migration 022 match BR-1 and BS-1.
- Named test files pass locally. `no_phantom_paths` failed identically on `main` in Cowork's sandbox, which Cowork reads as environmental there.

**THE MERGE (BT-1).**
- The head was read from the API as `c199b07`, and #74 merged as a merge commit with `--match-head-commit`.
- MERGED was read back: **`abd6ee51a085e57d68e926776c4733a67315b675`**, with parents `faf984a` and `c199b07`.
- `pr-3.4b-app-a` was deleted as a separate step afterwards; the API answers "Branch not found".

**BT-2 — SIGN-UPS OFF IS A.2, A SMALL PR AFTER A, DESIGN REPORT FIRST.**
- **The cause:** `generate_link` leaves a new user unconfirmed. With `[auth] enable_signup = false`, an unconfirmed user's `/otp` is refused (422 `signup_disabled`). `[auth.email] enable_signup = false` disables email sign-in outright (422 `email_provider_disabled`).
- **The properties:**
  - (a) provisioning leaves the Auth user CONFIRMED, through the admin API, and J4 and zero-Auth hold;
  - (b) only `[auth] enable_signup = false`, with a `config_drift` leg pinning both keys;
  - (c) PASS is BS-1 b's rule (1)-(5), plus the old-flow account named;
  - (d) H2 changes only after A.2 merges on a PASS, as a founder step with a read-back.
- **Until then, sign-ups stay on.** That is an accepted interim risk: an address can create an Auth user, but with no `ward_account` it gets `NOT_A_MEMBER`.

**BT-3 — `sb_secret_` ACCEPTED.** The script keeps both headers. PR C's H6 bootstrap step tests that exact shape against hosted `generate_link`, with a failing half. A 401 or 403 is a STOP, never a retry by hand with another shape.

**BT-4 — THE `_legs.ts` MATCHING HOLE IS FIXED IN PR B.**
- A leg is credited only by a fragment identifying that leg's own message.
- The five `<script>.sh: FAILED (` legs it unmasks are each made genuinely reached, never exempted.
- **Plant:** a test that only mentions the script path no longer credits the leg.

**BT-5 — AFTER THE MERGE, STOP.**
- The founder runs 022's hosted apply, with Cowork reading each fence back, before H6.
- The A.2 and B design reports were written, with no build: `Sprint Kickoffs/pr-a2-design-report-2026-09-24.md` (committed in this change) and B's (committed in B).

### R-2026-09-24-93 — the A.2 and B design reports accepted; the build word for both

_Issued as R-PROVISIONAL-2026-09-24-BU, by Cowork on 2026-09-24. **Pasting it was the build word for PR A.2 and PR B.** Record-only; lands after -92, in A.2. Number assigned on landing: R-2026-09-24-92 plus one. Next provisional letter: BV._

**READ BY COWORK, in full:**
- the A.2 report: sha256 `9cd4bf1102b4f4ecd03cbba880a5e809c7470fe474bb91a63ab0672dfe453d45`, 10813 bytes;
- the B report: sha256 `cca65b2d180c94fa5be7954bde8be25ace3a828d18319c81fe3a4714c2eca3fa`, 16809 bytes.

Both are accepted as designed, amended only by BU-1 and BU-2. The staff-engineer, QA and platform-SRE passes were applied. Each report is committed unedited beside the kickoff in its own PR, with its hash re-read after the copy.

**BU-1 — A.2.**
- **(a) The lookup, CONFIRMED.**
  - `POST admin/users` with `email_confirm` true.
  - On 422 `email_exists`: `GET admin/users?filter=`, with the exact case-insensitive match done in the script.
  - `PUT email_confirm` only when `email_confirmed_at` is null.
  - **Never `generate_link`** on the provisioning path.
  - A zero or multiple match is a named STOP. A full page (50) with no exact match says so, rather than concluding "no user".
- **(b) The order, CONFIRMED:** A, A.2, B, C.
  - A.2 and B may both be built now. A.2 merges first, and B merges `main` in before its report.
  - H6's operator bootstrap needs A.2 merged **and** 022 applied on hosted. PR C states and checks both first.
- **(c) H2's text goes in A.2's runbook** (§6 steps 1-4). In step 4, if the `create_user:true` request creates a user at all, the switch did not take: STOP. The founder removes that user, by the admin API or SQL as the step names, and records the removal with the reading. "Nothing is created" is conditional on the switch having worked.
- **(d) PASS** is §6 (1)-(5), plus the harness control with the pre-A.2 config: (4) must pass and (5) must fail.
- **(e) For PR C:** the H3 and H6 text tells the operator to wait out the email frequency window after any admin link. H3 reads the hosted Auth rate-limit and frequency settings once, recorded as read.

**BU-2 — B.**
- **(a)** Twelve sites plus three deploy-target lists, against -71 H's "seven", each fence or literal as tabled. The scratch-app test reds every fence and every literal's plant, and an empty tree reds every fence. The corrected count, and the four kickoff mislabels, go in B's report of record. -71 H and BP-9 are left as written.
- **(b)** `contacts.json` REPLACES `ward-support.json`. Every tracked reference is moved before the build, and `no_phantom_paths` stays green.
- **(c)** The dashboard's inline `<style>` moves to a CSS file: no hash, no `'unsafe-inline'`.
- **(d)** `/beds.json` gains `X-Content-Type-Options: nosniff` UNCONDITIONALLY, in `packages/snapshot/src/serve.ts`, with a test and a plant. `readback_pages.sh` asserts it. The production reading is the founder's next dashboard deploy.
  > **NOTE 2026-09-26 (R-2026-09-25-119 CU-3), by note rather than by rewriting (method note 8).** That next dashboard deploy did not come until **2026-09-25**, at `dd59c7f`. Until then `openbed.ng` served `2e62579`, built before PR B, so the live public page carried **none** of PR B's page headers: no CSP, and Referrer-Policy `strict-origin-when-cross-origin`. The production reading is recorded in -119 CU-3.
- **(e)** A CSP that is too tight breaks a page silently. So each app is loaded in a real browser locally under its headers, and the console's sign-in is walked end to end locally under the CSP, before the report.
- **(f)** The `_legs.ts` rule is CONFIRMED, including the sixth leg (`neuter_plant.mjs`, "PLANT DID NOT LAND — neuter"). The ten instrument legs are measured under the rule before it lands. A flip is made genuinely reached, never exempted.

**BU-3 — BUILD A.2 AND B NOW,** each on its own branch from `main` at `abd6ee5`.
- **Each PR's report comes before its merge word,** carrying:
  - the head SHA and its seven check runs, from the API;
  - Standard O;
  - the E2E and the frontier;
  - Standard P, with its stopping rule first;
  - the behavioural ledger;
  - for A.2, the PASS and the control;
  - for B, the leg measurement before and after, and the per-app table as built.
- **Nothing hosted, and H2 is not changed.**

### R-2026-09-24-94 — #75 merged; B's ward CSP origins derived, not retyped; the hosted order

_Issued as R-PROVISIONAL-2026-09-24-BV, by Cowork on 2026-09-24, as its check of #75 at `69e357a`. **Pasting it was the founder's merge word for #75.** Record-only; it lands with B (this change). Number assigned on landing: R-2026-09-24-93 plus one. Next provisional letter: BW._

**VERIFIED BY COWORK** (2026-09-24):
- #75 was read from the GitHub API on the founder's machine: OPEN at `69e357a6e47b0db03792a23ed7c5291185affc86`, base `abd6ee5`, mergeable and clean, 1 commit, 10 files, with seven check runs completed/success.
- `Sprint Kickoffs/pr-a2-design-report-2026-09-24.md` reads as agreed (10813 bytes).
- The script, `supabase/config.toml` and the H2 runbook section match BU-1.
- Three named test files pass locally, 72 of 72.

**THE MERGE (BV-1).**
- The head was read from the API as `69e357a`, and #75 merged as a merge commit with `--match-head-commit`.
- MERGED was read back: **`78f1e0099156fab5f8ea2daade8414680caff1ca`**, with parents `abd6ee5` and `69e357a`.
- `pr-3.4b-app-a2` was deleted as a separate step afterwards, remote and local. `git ls-remote --heads` reads it as gone.

**BV-2 — B, AS PLANNED; THE WARD CSP'S API ORIGINS DERIVED FROM `origins.json`.**
- B merged `main` in (`32d67d2`) and is re-attested on its own head.
- **What BV-2 found, observed on B as first built (`f7407bd`):** the ward console's `connect-src` named both API origins as TEXT in `apps/ward-console/public/_headers`. `tests/compliance/security_headers.test.ts` held that text to `origins.json`'s `api` entry, so a drift would have gone red. But the origins were checked there, not derived: retyped.
- **Now derived:**
  - the tracked file names `@API_ORIGINS@`;
  - `scripts/render_headers.mjs` fills it with `api.production` and `api.local` from `packages/origins/origins.json`, the pair `apiOrigin()` selects between. It runs in each app's `npm run build`, and in the read-backs' `rb_tracked_header`;
  - a placeholder named twice, misspelt or left unrendered, or an `api` value that is not a bare origin, fails the build.
- **The pinned set:** `connect-src` is `'self'`, the production API origin and the local API origin, and nothing else. `security_headers.test.ts` pins exactly that set on the rendering, and holds the built file equal to the rendering of the tracked one.

**BV-3 — HOSTED, FOUNDER-SIDE, AFTER THE MERGE,** with Cowork reading each fence back.
- First, 022's apply (six fences).
- Then H2, sign-ups off (A.2's runbook section), only after 022's fences read as they must.
- Claude Code runs nothing hosted.

### R-2026-09-24-95 — the leg rule: a longer message no longer proves a shorter one

_Issued as R-PROVISIONAL-2026-09-24-BW, by Cowork on 2026-09-24, as its check of #76 at `cc46fda`. Not a merge word. Record-only; it lands in #76 (this change). Number assigned on landing: R-2026-09-24-94 plus one. Next provisional letter: BX._

**VERIFIED BY COWORK** (2026-09-24):
- #75 merged at `78f1e00`.
- #76 was read from the GitHub API: OPEN at `cc46fdab4ba1c2d9bc270e77b0b51e9545947579`, base `78f1e00`, clean, 3 commits, 49 files, seven check runs success.
- The B report reads as agreed. The `_headers` files, `contacts.json` and the `/beds.json` nosniff are as ruled.

**BW-1 — THE DEFECT.** `isReached`'s whole-identity clause credited a leg whenever a literal contained its identity, including when that literal was a NEIGHBOUR's longer message containing it. That is one literal proving two legs: the defect BT-4 closed for fragments. Cowork measured 295 script legs and 4 nested pairs in the same script: `readback_common.sh`'s no-verdict tail inside its stamp and body-search failures, and `readback_function_grants.sh`'s inside its no-functions and comparison failures.

**THE FIX, AS BUILT** (`tests/compliance/_legs.ts`):
- A literal that holds the identity of a longer leg, whose identity contains the shorter leg's, credits the longer leg and never the shorter.
- **"Longer leg" is drawn from EVERY script, not only the same one.** Measured before it landed, the hole also ran ACROSS scripts: `readback_function_grants.sh`'s unreadable-fixture leg was being credited by `readback_public_output.sh`'s messages, because one test file exercises both. There are 17 nested pairs in all, 4 within one script and 13 across scripts.

**BW-1 b — THE MEASUREMENT.** 305 legs. 279 reached under the `cc46fda` rule, and 279 under the fixed rule, with the fix drawn from one script or from all of them. **No flips.** Each shorter leg already had a test triggering its own message:
- the curl failure (`readback_scripts.test.ts`, "curl exited 6 on GET …/version.json");
- the unreadable fixture ("…/packages/fixtures/function-grants.json").

**BW-1 c.** Instrument legs in `leg_coverage.test.ts`:
- **plant:** the longer message credits the longer leg, not the shorter;
- **cross-script plant:** another script's longer message credits neither;
- **accept:** the shorter leg's own path credits it, and not the longer.

Two neuters confirm them: the old clause, and a same-script-only fix.

**BW-1 d.** `nestedIdentities()` lists the pairs by identity (never by line). `leg_coverage.test.ts` pins all 17 by name. Nesting is legal, but a new one reds the pin, and whoever adds it confirms its shorter leg is reached by its own path.

**BW-2 — NOTHING ELSE CHANGES.** Re-attested on the new head. Report, then STOP.

### R-2026-09-24-96 — #76 merged; the build of B checked; PR C's design report asked for

_Issued as R-PROVISIONAL-2026-09-24-BX, by Cowork on 2026-09-24, as its check of #76 at `c054698`. **Pasting it was the founder's merge word for #76.** Record-only; it lands with PR C (this change). Number assigned on landing: R-2026-09-24-95 plus one. Next provisional letter: BY._

**VERIFIED BY COWORK** (2026-09-24):
- #76 was read from the GitHub API: OPEN at `c054698f36b742dcb5ba9ba4e06bfcbc1be4f2d2`, base `78f1e00`, clean, 4 commits, 49 files, seven check runs success.
- `cc46fda..c054698` touches only the record, `leg-coverage.json`, `_legs.ts` and `leg_coverage.test.ts`.
- `leg_coverage.test.ts` passed locally, 38 of 38.

**BX-1 — BW-1 a's widening to every script is ACCEPTED.** The cross-script finding is the same defect, and a same-script fix would have left it open. The 17 nested pairs, pinned by identity, meet BW-1 d.

**THE MERGE (BX-2).**
- The head was read from the API as `c054698`, and #76 merged as a merge commit with `--match-head-commit`.
- MERGED was read back: **`3df27ca5406a5b1ec89287a2a4225a7b34e5a322`**, with parents `78f1e00` and `c054698`.
- `pr-3.4b-app-b` was deleted as a separate step afterwards, remote and local. `git ls-remote --heads` reads it as gone.

**BX-3 — PR C's design report, report only.** Written as `~/cowork-handoff/pr-c-design-report-2026-09-24.md`, sha256 `1f28046bb3892359943a3626634cbd10a6ad828c1a8b5601f4bfb6c875733b2a`, 49442 bytes. It is committed unedited in this change as `Sprint Kickoffs/pr-c-design-report-2026-09-24.md`, with its hash re-read after the copy. Its §0 names nine premises that did not hold, among them:
- the runbook had no facility-creation step to supersede;
- BT-3's `generate_link` probe would recreate what A.2 removed;
- the widened grant sweep has not run on hosted;
- `operator_edit_facility` is not safe to repeat.

### R-2026-09-24-97 — PR C's design report accepted; H6's order fixed; the build word for PR C

_Issued as R-PROVISIONAL-2026-09-24-BY, by Cowork on 2026-09-24. **Pasting it was the build word for PR C.** Record-only; lands after -96, in PR C (this change). Number assigned on landing: R-2026-09-24-96 plus one. Next provisional letter: BZ._

**VERIFIED BY COWORK:**
- #76 merged at `3df27ca`, and its tree equals `c054698`.
- The design report was read in full at sha256 `1f28046b…3b2a`, 49442 bytes, with zero @openbed.ng addresses.
- §0-§10 are accepted as designed, amended only below. The staff-engineer, QA, CLCO and platform-SRE passes were applied.

**BY-1 — H6'S ORDER IS WRONG AS WRITTEN, AND IS FIXED.** With `create_user` false, a link request for an address with no account sends nothing. The report's sign-in observation came before the operator bootstrap, so it could have observed nothing. After its six preconditions, H6 is:
1. the admin Pages project and `admin.openbed.ng`, with the pages.dev hostnames added to the Access application and the service token issued;
2. deploy through the wrapper, then `readback_admin.sh`, failing half first;
3. BT-3 as reshaped (BY-2 b). A STOP here stops everything below;
4. the widened grant sweep, failing half first, with its result recorded under its heading;
5. the operator bootstrap, with its count read-back reading 1;
6. the link read-back with `readback_signin_link.mjs`;
7. the sign-in-order observation, in both orders;
8. the register loads, empty.

"No facility or ward login on hosted until the -45 gate reads clear" stays last.

**BY-2 — THE SEVEN OPEN ITEMS:**
- **(a) The preview deploy, `readback_admin.sh` PASS and the sign-in-order observation move to H6.** C merges on local evidence:
  - a real-browser walk of `apps/admin` under its rendered CSP, from sign-in to an empty register, with zero CSP violations and a too-tight control;
  - `readback_admin.sh` against local `wrangler pages dev` for every step that does not need Access, with the Access and service-token steps held by plants.

  Admin is NOT live until H6 steps 2, 6 and 7 have read as they must.
- **(b) The BT-3 probe** is `GET /auth/v1/admin/users?per_page=1` in two halves. It prints the HTTP status only, never the body. A 401 or 403 on the real key is a STOP.
- **(c) `lagosTime` moves into `@openbed/snapshot`,** and the dashboard imports it. Its rendered times are compared before and after. The `TZ=Asia/Hong_Kong` test runs in a child process.
- **(d) FIX IT IN C:** `lint_no_service_role_in_bundle.sh` derives its corpus from each app's `wrangler.toml` `pages_build_output_dir`, as B did for fonts, with a plant for an app that builds to `build/`.
- **(e) Edit is never retried automatically.** An idempotency key on `operator_edit_facility` needs its own ruling if ever wanted.
- **(f) The E2E operator** is made by the script and removed at reset and teardown. The local collision plant is shown once and quoted.
- **(g) Admin's `connect-src`** is the same rendered pair, and `security_headers` pins it for all three apps.

**BY-3 — BUILD PR C NOW,** on a branch from `main` at `3df27ca`. The report comes before the merge word. Nothing hosted. H5 and H6 are founder steps after the merge.

### R-2026-09-24-98 — the retype form refused; migration 023 shows what is saved; the edit form prefilled, and a phone change confirmed

_Issued as R-PROVISIONAL-2026-09-24-BZ, by Cowork on 2026-09-24, as its ruling on #77's edit-form finding. Not a merge word. Record-only; it lands in #77 (this change). Number assigned on landing: R-2026-09-24-97 plus one. Next provisional letter: CA._

**READ BY COWORK at `0f0b0b7`:** base `3df27ca`, 2 commits, no file under `database/migrations`. The committed design report reads sha256 `1f28046b…733b2a`. `apps/admin/src/main.ts` told the operator to re-enter latitude, longitude and public phone on every edit, because `operator_register` (021) returned name, lga and state but not those three.

**BZ-1 — THE RETYPE FORM IS NOT ACCEPTED.** `public_phone_e164` is the number the public page shows for an emergency call. A form that makes the operator retype it to fix an unrelated field can silently change it to a wrong number, and a mistyped lat/lng silently moves the facility. The root cause is that the page cannot see what is saved, so the fix is to show it, in C, before the merge.

**BZ-2 — MIGRATION 023, IN PR C, as built** (`database/migrations/023_operator_register_location_and_phone.sql`):
- **The function.** `public.operator_register()` gains `lat`, `lng` and `public_phone_e164` on each facility, after `state`. Its body is generated from 021's text with those three lines inserted. The signature, the jsonb return type, the ORDER BY and every other key are untouched, and `tests/db/migration_023_round_trip.test.ts` asserts the exact replace.
- **No new personal data.** All three are already public output (008:109-110; the snapshot's facility columns).
- **Grants and fence 6.** The grant block re-runs 021's loop for the one signature. `function-grants.json` is unchanged, so fence 6 reads the same.
- **The down** restores 021's body verbatim. The round trip covers:
  - the down landing exactly on 021's body and grants;
  - an idempotent re-apply over 022 and over itself;
  - no public row written either way;
  - the behaviour against each facility's own columns;
  - a plant on the down.
- **Step 5, read and not assumed.** `applied-hosted.json` records 21 and no entry says 022 has been applied, so **022 and 023 are both pending**, and step 5 and its guard are restated to `2 migration(s) pending.` The virgin counts are now 23 and 22.
- **The runbook** gains "023's apply": the six fences, run after 022's and before H6. H6's preconditions gain "023 applied on hosted".
- **Unchanged:** `applied-hosted.json`, and the 022 round trip's own assertions. That file now reverses what sits above it first, as the 020 and 021 files do.

**BZ-3 — THE EDIT FORM, as built:**
- all six fields are prefilled from the register row loaded with the facility's version, and the retype note is gone;
- a changes line shows each changed field as `<saved> → <new>`;
- **a public-phone change is never sent on Save.** A confirm shows `Public phone: <saved> → <new>`. Confirm sends it once, and Cancel sends nothing;
- a lat/lng change is shown the same way, without a confirm;
- §3.3 still holds: edit is never retried, and VERSION_CONFLICT reloads.

Tests in `tests/compliance/admin_render.test.ts`:
- the confirm appears only on a phone change;
- cancel sends zero POSTs, and confirm sends one;
- a row without 023's keys is unreadable, never defaulted.

**BZ-4 — ALSO ACCEPTED, as reported:**
- synthetic `+234800` numbers throughout the tests;
- the by-file `no_phantom_paths` exemption, recorded as the report's defect;
- the local `/auth/v1/settings` key halves marked NOT RUN;
- the service-role lint derivation (BY-2 d);
- the derived scratch app list.

**OPEN ITEM, with its trigger:** the ward console's code pattern (`[A-Z_]` in `raisedCodes` and `wardMessageFor`) cannot read a code containing a digit. No ward-path code has one today. **Trigger: the first ward-path code containing a digit.** It is not fixed in C, which does not touch the ward console.

**BZ-5 — THEN REPORT;** nothing hosted; STOP for Cowork's check and the founder's merge word.

### R-2026-09-24-99 — #77 merged; 3.4b-app's code is complete; the hosted order

_Issued as R-PROVISIONAL-2026-09-24-CA, by Cowork on 2026-09-24, as its check of #77 at `8e57a2a`. **Pasting it was the founder's merge word for #77.** Record-only; it lands with the next change that touches the record, which is this one (with -100). Number assigned on landing: R-2026-09-24-98 plus one. Next provisional letter: CB._

**VERIFIED BY COWORK** (2026-09-24):
- #77 was read from the GitHub API on the founder's machine: OPEN at `8e57a2a59babe47e802a9799cb2545dd1ebb1e7f`, base `3df27ca`, mergeable, clean, 3 commits, 52 files. Seven check runs were completed/success on `8e57a2a`.
- `0f0b0b7..8e57a2a` adds only BZ's change: 023's pair, its README row, the admin edit form, and its tests and runbook.
- 023's `operator_register` body, diffed by Cowork against 021's, has exactly three added lines (`'lat'`, `'lng'`, `'public_phone_e164'`) and nothing else. 023's down body is byte-identical to 021's.
- `function-grants.json` and `applied-hosted.json` have no diff in #77.
- In `apps/admin/src/main.ts`, a phone change shows "Public phone: <saved> → <new>" with Confirm and Cancel, and is never sent on Save.

**THE MERGE (CA-1).**
- The head was read from the API as `8e57a2a`, and #77 merged as a merge commit with `--match-head-commit`.
- MERGED was read back: **`4e28cdbc54eaaff0ba51401cb2c859a97bac3f9b`**, with parents `3df27ca` and `8e57a2a`.
- `pr-3.4b-app-c` was deleted afterwards, as a separate step, both remote and local. `git ls-remote --heads` reads it as gone.

**CA-2 — AFTER THE MERGE, STOP.** 3.4b-app's code is complete. Everything that remains is founder-side, on hosted, in this order, and Cowork reads back each step:
1. 022's apply (six fences);
2. H2, sign-ups off;
3. H3;
4. 023's apply (six fences);
5. H5, the Worker redeploy;
6. H6, in BY-1's order.

Admin is NOT live until H6 steps 2, 6 and 7 read as they must. No facility or ward login on hosted until the -45 gate clears (the backup restore drill, BB-4). Claude Code runs nothing hosted.

### R-2026-09-24-100 — withdrawal is final in v1; the one false operator sentence corrected; agreement history an open item

_Issued as R-PROVISIONAL-2026-09-24-CB, by Cowork on 2026-09-24, from main at `4e28cdb`. It lands in one small pull request with -99 (this change). Number assigned on landing: R-2026-09-24-99 plus one. Next provisional letter: CC._

**READ BY COWORK at `4e28cdb`:**
- `app.facility_agreement.facility_id` is the PRIMARY KEY (021:150), so there is one agreement row per facility.
- `operator_record_agreement` never overwrites (`AGREEMENT_ALREADY_RECORDED`), and `operator_set_facility_listed` refuses `AGREEMENT_WITHDRAWN`.
- **So in v1 a withdrawn facility can neither record a new agreement nor be listed again.** -82 BJ-1 e's "Publishing again needs a deliberate new agreement" has no path.
- Cowork searched `packages/labels/`, `docs/` and `docs/facility-agreement-clause-x-access-addresses.md`: no facility-facing text promises re-agreement. The promise is operator-side only.

**Re-read on landing, at `4e28cdb`.** Every premise holds:
- `021:150` is `facility_id uuid PRIMARY KEY`;
- `:582` raises `AGREEMENT_ALREADY_RECORDED`;
- `:282` raises `AGREEMENT_WITHDRAWN` in `operator_set_facility_listed`. A second refusal, at `:347`, is `provision_begin`'s.

Two things the ruling did not say:
- **The label was the false promise itself.** Before this change, `AGREEMENT_ALREADY_RECORDED` read "An agreement is already recorded for this facility. A new one needs the founder's withdrawal steps first." That sends the operator into a withdrawal that leads nowhere.
- **"No path" means no operator function and no runbook step. It is not a database impossibility.** No trigger stops a founder `UPDATE` from clearing `withdrawn_on`; 021 has only the CHECK `withdrawn_on >= accepted_on`. Finality in v1 is the absence of any path, not a constraint, which is why CB-2's founder-SQL correction is possible at all.

**CB-1 — AS BUILT.**
- **a) `packages/labels/admin-labels.json`, `AGREEMENT_ALREADY_RECORDED`,** now reads: "An agreement is already recorded for this facility, and it is never replaced. A facility whose agreement was withdrawn cannot be listed again in this release of OpenBed."
  - Improved from Cowork's proposal in one place. It says "in this release of OpenBed" rather than "in this version", because the same form asks for an agreement *version* (v1, 2026-09), and "this version" would read as that.
- **b) The refusal-coverage leg** ("the code table covers EXACTLY…", `tests/compliance/admin_render.test.ts`) is red with the key removed and green with the new sentence. It keys on the code, so the new text passes it unchanged.
- **c) The runbook, §12.5:**
  - A new first paragraph: "Withdrawal is final in this version: the facility cannot record a new agreement or be listed again". It cites this entry by its landed number rather than the provisional one.
  - Step 3's "Publishing again needs a deliberate new agreement and a new listing" is taken out of the live step. It is kept, quoted, in a *Restated 2026-09-24* paragraph below step 3's read-back, marked superseded, with 021's three lines as the reason.
  - The paragraph sits after the fence, not before it: a dated paragraph directly above a fence would date that fence as history in `runbook_migration_expectation`'s units.
  - Prose only. No fence was added or changed.
- **d) Not edited:** 021:575's comment "A new version is a founder step (BD-1 c)", in an applied migration; and every `Sprint Kickoffs/` file except the pointer in -82.
- **e) The search**, re-run over `packages/labels`, `docs` and `apps/*/src` for withdraw, new agreement, re-list, rejoin, re-agree, "again" and "new version":
  - **Operator-side, corrected:** the label and the runbook's step 3, above.
  - **Operator-side, accurate, unchanged:**
    - admin labels `AGREEMENT_WITHDRAWN` (codes and screens);
    - the `facility_agreement_withdrawn_after_accepted` constraint;
    - `WITHDRAWN_WARNING`;
    - `apps/admin/src/main.ts`'s two comments, "never edited or withdrawn here" and "Unlisting and withdrawal are founder steps".
  - **Facility-facing or agreement text:** none. There are no hits in `ward-labels.json`, `public-labels.json` or the clause-x document.
  - **Outside the search's scope, carrying the same promise, not edited:** `Sprint Kickoffs/sprint-kickoff-bundle3-operator-path-2026-09-22.md:185`, a committed kickoff; this entry supersedes it.

**CB-2 — OPEN ITEM, not a fix.** "Agreement history — re-agreement after withdrawal, and a runbook step for correcting a mistakenly recorded agreement — needs its own design and ruling."
- **Trigger:** the first withdrawn facility that asks to return, or the first mistaken agreement record, or earlier on the founder's word.
- **Backstop:** reviewed at the first post-launch sprint kickoff.
- **Until then** a mistaken record (not a withdrawal) is corrected by founder SQL, with Claude Code writing the statement at the time.
- -82 BJ-1 e is left as written, with only a pointer to this item.

**CB-3 — NOTHING ELSE.** No SQL, no migrations, nothing hosted. Report, then STOP for Cowork's check and the founder's merge word.

### R-2026-09-25-101 — #78 merged

_Issued as R-PROVISIONAL-2026-09-25-CC, by Cowork on 2026-09-25, as its check of #78 at `3a8f897`. **Pasting it was the founder's merge word for #78.** Record-only; it lands with the change that records 022's and 023's hosted apply (this one). Number assigned on landing: R-2026-09-24-100 plus one. Next provisional letter: CD._

**VERIFIED BY COWORK** (2026-09-25, GitHub API and git, on the founder's machine):
- #78 was OPEN at `3a8f897594e3f50745ce46873104288b95edd7b9`, base `4e28cdbc54eaaff0ba51401cb2c859a97bac3f9b`, mergeable and clean, with 1 commit and 3 files. `origin/main` was still `4e28cdb`.
- All seven check runs on `3a8f897` were completed/success: compliance-tests, db-tests, bundle-guards, secret-scan, migration-lint, repo-lint and golden-path.
- `4e28cdb..3a8f897` changed only:
  - the `AGREEMENT_ALREADY_RECORDED` label (one line);
  - §12.5 of the runbook, in prose, with no fence added or changed;
  - this record: -99, -100, the -82 BJ-1 e pointer, and ledger rows CA and CB.
- The three departures reported with #78 were accepted:
  - "this release of OpenBed" in the label;
  - the runbook citing -100 rather than the provisional letter;
  - the superseded sentence placed below step 3's read-back, to keep that fence live.
- -100's note that "no path" is not a database impossibility was accepted as written.

**THE MERGE (CC-1).**
- The head was read from the API as `3a8f897`, and #78 merged as a merge commit with `--match-head-commit`.
- MERGED was read back: **`06fe479f9858332e770ff6bbfed6b0a338919135`**, with parents `4e28cdb` and `3a8f897`.
- `record-ca-cb` was deleted as a separate step afterwards, both remote and local. `git ls-remote --heads` and `git branch --list` read it as gone.

**CC-2 — after the merge, STOP.** Nothing hosted.

### R-2026-09-25-102 — #78's merge read back

_Issued as R-PROVISIONAL-2026-09-25-CD, by Cowork on 2026-09-25. Record-only; it lands after CC, in this change. Number assigned on landing: R-2026-09-25-101 plus one. Next provisional letter: CE._

**VERIFIED BY COWORK** (2026-09-25, GitHub API and git, on the founder's machine):
- #78 reads state closed, merged true, `merge_commit_sha` `06fe479f9858332e770ff6bbfed6b0a338919135`, head `3a8f897594e3f50745ce46873104288b95edd7b9`.
- `06fe479`'s parents are `4e28cdb` and `3a8f897`.
- `origin/main` is `06fe479`, and the local checkout is at `06fe479` with a clean working tree.
- `git diff 3a8f897 06fe479` is empty: the merge added nothing beyond what Cowork checked in CC.
- `record-ca-cb` is gone, remote and local.

**CD-1 — nothing to do then.** CC and CD land with the next record change, each with its ledger row.

### R-2026-09-25-103 — 022 and 023 are applied together, in one run

_Issued as R-PROVISIONAL-2026-09-25-CE, by Cowork on 2026-09-25, from `06fe479`. Record-only when issued; it lands with the change that records the hosted apply (this one). Number assigned on landing: R-2026-09-25-102 plus one. Next provisional letter: CF._

**READ BY COWORK at `06fe479`:**
- `scripts/run_migrations.sh` takes only `--dry-run` and a root. It applies EVERY pending file, in order, each with `--single-transaction` and `ON_ERROR_STOP`, so it cannot apply 022 alone.
- Hosted held 001-021 (`applied-hosted.json`), so 022 and 023 were both pending.
- Step 5's top list and "Expected output" already expected two WOULD APPLY lines (022, then 023) and `2 migration(s) pending.` But three fences expected one file:
  - "022's apply" fence 1 expected 022 alone;
  - its fence 5 expected twenty-two already applied;
  - "023's apply" fence 1 expected 023 alone.
- **As written, the founder's first fence would have stopped a correct project.**

**Re-read by the implementer at `06fe479` before acting.** Every premise holds, at these lines:
- the runner's usage (line 61) and its transaction flags (lines 115-130);
- step 5's three two-pending sites;
- the three one-file fences.

Each migration writes its own ledger row inside its own transaction, so if 023 had failed after 022, a re-run would have applied 023 alone.

**THE CONTRADICTION WAS MINE.** The change that added 023 (-98, BZ-2 c) restated step 5's list to two pending, and left "022's apply" fence 1 expecting exactly one file. No guard reads the per-apply fences. `tests/compliance/runbook_migration_expectation.test.ts` parses step 5's four sites, and its whole-document scan looks only for an undated `N migration(s) pending.`, which the one-file fences never state: they name files and say "nothing is pending" in words.

**CE-1 — the apply as run:** one run of the six fences of "020's apply", from a clean checkout at `06fe479`:
1. **Dry run:** twenty-one `already applied` lines; exactly two WOULD APPLY lines, 022 then 023; `2 migration(s) pending.`
2. **Before-reading:** as for 020, keeping the FINGERPRINT line.
3. **Apply:** 022's `PLATFORM_ADMIN_DUPLICATES` pre-check must pass (hosted holds no ward_account row), and 023 has no pre-check. If 022 applied and 023 failed: STOP and report. A re-run is the runner's recovery, but never on the founder's own authority.
4. **After-reading:** `PASS (VACUOUS FOR B1)`.
5. **Second dry run:** twenty-three `already applied` lines and nothing pending.
6. **Function grants:** unchanged.

Each fence is read back by Cowork before the next.

**CE-2 — the hosted order, restated:**
1. 022 and 023 together;
2. H2;
3. H3;
4. H5;
5. H6, in BY-1's order.

Moving 023 ahead of H2 and H3 is safe: it only adds `lat`, `lng` and `public_phone_e164`, already public for a listed facility, to an operator-only read. Neither step depends on its absence, and neither migration writes a row, so the -45 gate is unaffected.

**CE-3** — the restatements this change makes (see -105).

### R-2026-09-25-104 — the runbook is corrected after the apply, not before

_Issued as R-PROVISIONAL-2026-09-25-CF, by Cowork on 2026-09-25. Record-only; it lands in this change. Number assigned on landing: R-2026-09-25-103 plus one. Next provisional letter: CG._

**Accepted from the report on CE:**
- CE's premises, with the line numbers given;
- the attribution above;
- §12's "PR C merged" step, to be removed when the order is restated.

**CF-1 — no pre-apply pull request.** The runbook's 022 and 023 apply sections stayed as they were until this change. The founder ran from CE-1's text, and Cowork read each fence back before the next. **Method note 8's "correct now" was met by CE-1 as the live instruction for that run**; the runbook's copy is restated here.

**CF-2 — the backstop.** Had any other change been due to merge before the apply was recorded, CE-3's restatements would have gone into that change first. None did.

**CF-3 — nothing hosted** was run by Claude Code.

### R-2026-09-25-105 — 022 and 023 applied on hosted; the frozen boundary at 23; the runbook corrected

_Issued as R-PROVISIONAL-2026-09-25-CG, by Cowork on 2026-09-25. This is the change that records the apply, branched from `06fe479`. Number assigned on landing: R-2026-09-25-104 plus one. Next provisional letter: CH._

**READ BACK BY COWORK** (2026-09-25; the founder's terminal, from the checkout at `06fe479`, run per CE-1):
1. **Dry run:**
   - 21 `already applied` lines (001-021);
   - WOULD APPLY `022_one_operator_and_reactivation.sql`, then `023_operator_register_location_and_phone.sql`;
   - `2 migration(s) pending.`
2. **Before-reading:**
   - `beds.json` `0/0:543f06c0b0c4`;
   - `facility_public`, `ward_public` and `lga_rollup` each `0:d41d8cd98f00`;
   - the FINGERPRINT line, and `RECORDED`.
3. **Apply:**
   - 022 printed `DO`, `CREATE INDEX`, `CREATE FUNCTION`, `CREATE FUNCTION`, `DO`, `INSERT 0 1`, `INSERT 0 0`;
   - 023 printed `CREATE FUNCTION`, `DO`, `INSERT 0 1`, `INSERT 0 0`;
   - then `Migrations complete (2 applied this run).`
4. **After-reading:** all four parts ok, `NOTE: every count, before and after, is 0.`, and `PASS (VACUOUS FOR B1)`.
5. **Second dry run:** 23 `already applied` lines (001-023), no WOULD APPLY line, and `0 migration(s) pending.`
6. **Function grants,** against `packages/fixtures/function-grants.json` at `06fe479`: 29 lines, all ok.
   - `app.provision_begin(uuid, text, text)` and `app.provision_complete(uuid, uuid)` read `EXECUTE: none`.
   - `public.operator_register()` reads `EXECUTE: authenticated`.
   - `public.rls_auto_enable()` reads ok under `(hosted-only)`.
   - The last line is `PASS`.

The -45 gate is unaffected: no facility and no ward_account row exists.

**Cowork's line matches for fence 3, re-read on landing.** Every line number holds, and one label does not:
- **022:** pre-check `DO` at :58, the index at :73, `provision_begin` at :81, `provision_complete` at :176, its own ledger row at :300.
- **022:278 is not a post-check.** It is the grant block, headed "Owner only, as 020 left them", which re-states owner-only EXECUTE for the two functions.
- **023:** its function at :44, its grant block at :117, and its own ledger row at :136.
- In each file, the last `INSERT 0 0` is the runner's `ON CONFLICT` no-op.

The runbook's checkbox carries the corrected label.

**CG-1 — AS BUILT:**
- **`database/migrations/applied-hosted.json`:** the boundary is at 23, written by `node scripts/freeze_applied_migrations.mjs 23 2026-09-25 R-2026-09-25-105`, in its existing form.
  - `ledger_rows` comes from fence 5's twenty-three `already applied` lines.
  - 022's and 023's sha256 (`9938ae2d…6961e`, `24e9f13c…20f0e`) are the tracked files' at `06fe479`, and `git diff 06fe479` of both files is empty.
- **Step 5.** Its top list, the expected-output block, the STOP bullet and the ledger sentence are restated to 23 already applied, no WOULD APPLY line and `0 migration(s) pending.`
  - Each keeps its earlier text as a dated restatement.
  - The 2026-09-25 two-pending run is kept as a dated fence.
  - The newest "observed on hosted" line, the apply checkbox (all six fences) and the frozen-boundary checkbox are added.
- **"022's apply" and "023's apply"** are marked run on 2026-09-25, together in one run per CE.
  - 022's fences 1 and 5, 023's fence 1 with its "If 022 is still pending, stop", and 022's "recorded with `22`" line are each kept as written and marked superseded by CE-1, never deleted (method note 8).
  - 022's header carries the attribution.
- **Step 7** reads 001-023.
- **Step 4b row 4** no longer says "until 022 is applied".
- **H6's preconditions 2, 5 and 7** read met, with their dates.
- **§12's hosted order** is restated to CE-2, with "PR C merged" removed and the old order kept as a restatement.
- **`tests/compliance/runbook_migration_expectation.test.ts`: its pinned legs are restated to the zero state.** This is a test change, not only record and runbook: the guard pins step 5's literals, so recording any apply moves them (as -85 did).
  - Every removed `expect` is paired with a stronger or equal replacement against the new text (listed in the pull request).
  - A neuter put 06fe479's runbook back against the new boundary. It read red: step 5 names 022 and 023 as pending but `applied-hosted.json` records them applied, and the ledger sentence says 21 against 23.

**CG-2** — no SQL, no migration, nothing hosted run by Claude Code.

### R-2026-09-25-106 — H2 done on hosted: sign-ups off

_Issued as R-PROVISIONAL-2026-09-25-CH, by Cowork on 2026-09-25. Added to the change that records 022's and 023's apply (this one), not a new pull request. Number assigned on landing: R-2026-09-25-105 plus one. Next provisional letter: CI._

**READ BACK BY COWORK** (2026-09-25; the founder's terminal, from the checkout at `06fe479`, runbook §3 "Sign-ups off (H2 …)"):
1. **Unconfirmed active accounts:** `0`.
2. **The switch:** Dashboard -> Authentication -> Sign In / Providers -> "Allow new users to sign up" off, saved. The Email provider toggle was not touched.
3. **Settings:** `get_publishable_key.sh` printed `key obtained`, and the settings read-back printed `PASS: sign-ups are off and email sign-in is on`.
4. **The failing half:** probe `h2-probe-1790293376@example.invalid`.
   - `POST /auth/v1/otp` with `create_user` true answered `HTTP 422`.
   - `auth.users` held `0` rows for that address.
   - PASS. No user was created, so no removal step ran.

**Re-read on landing against the runbook's H2 section.** Each reading is the one that step names as passing:
- step 1's stop condition, `0`;
- step 3's `PASS:` line;
- step 4's `HTTP 422` with a count of `0`.

The probe address is on the reserved `example.invalid` domain, as step 4 prescribes. It is not the operator's sign-in address (BQ-1).

**CH-1 — AS BUILT:**
- §3's H2 section is marked run on 2026-09-25, and its checkbox is ticked with the four readings, the date and Cowork's reading.
- H6 precondition 3 reads met on 2026-09-25, citing this entry.
- §12's hosted order marks step 2 (H2) done, as step 1 is marked. CH did not list this; it keeps the order true.

**CH-2** — no SQL, nothing hosted run by Claude Code.

**How CH landed.** CH arrived while #79 was being built. Its commit (`8872709`) was made on #79's branch but never pushed, and CI then re-routed it (-107, CI-2). It was kept on a local branch, `ch-h2-pending`, through #79's merge. It was carried onto this change by cherry-pick, and the resulting tree is byte-identical to `8872709`'s. That branch is deleted only after this change merges.

### R-2026-09-25-107 — #79 merged; CH re-routed

_Issued as R-PROVISIONAL-2026-09-25-CI, by Cowork on 2026-09-25, as its check of #79 at `2c75150`. **Pasting it was the founder's merge word for #79.** Record-only; it lands in this change. Number assigned on landing: R-2026-09-25-106 plus one. Next provisional letter: CJ._

**VERIFIED BY COWORK** (2026-09-25, GitHub API and git, on the founder's machine):
- #79 was OPEN at `2c75150ca8065308d1a02d7674e3eab6439c35cc`, base `06fe479f9858332e770ff6bbfed6b0a338919135`, mergeable and clean, with 1 commit and 4 files. Seven check runs on `2c75150` were completed/success.
- `applied-hosted.json` reads observed 2026-09-25, ruling R-2026-09-25-105, `ledger_rows` 23. Cowork recomputed 022's and 023's sha256 from `06fe479`'s bytes, and they are identical. No migration file changed.
- The test diff restates the step-5 literals from two pending to zero, and every plant still bites. Accepted.
- All three departures were accepted, including the corrected label for 022:278.

**THE MERGE (CI-1).**
- The head was read from the API as `2c75150`, and #79 merged as a merge commit with `--match-head-commit`.
- MERGED was read back: **`b056ad1cf5e864ebab3bff3f95e0fdf023ff8d22`**, with parents `06fe479` and `2c75150`.
- `record-022-023-apply` was deleted as a separate step afterwards, remote and local, and read back as gone.

**CI-2 — CH re-routed:** CH was not added to #79. It lands here, with H3's record.

**CI-3 — after the merge, STOP.** Nothing hosted.

### R-2026-09-25-108 — H3 done on hosted, in part: the Site URL, the redirects and Proton SMTP; the processor gate ruled

_Issued as R-PROVISIONAL-2026-09-25-CJ, by Cowork on 2026-09-25. It lands with -106 (CH) and -107 (CI) in one change, branched from `b056ad1`. Number assigned on landing: R-2026-09-25-107 plus one. Next provisional letter: CK._

**READ BACK BY COWORK** (2026-09-25; the founder's report and dashboard screenshots):
1. **Auth URL configuration,** entered by the founder:
   - Site URL `https://app.openbed.ng`;
   - redirect URLs `https://app.openbed.ng/` and `https://admin.openbed.ng/`, exact, with no wildcards.

   The `redirect_to` read-back stays at H6 step 6, by script.
2. **Custom SMTP, via Proton:**
   - host `smtp.protonmail.ch`, port 587;
   - sender and username `support@openbed.ng`, sender name OpenBed;
   - a Proton SMTP token named `supabase-auth` as the password, recorded nowhere;
   - "Minimum interval between emails: ___ seconds (founder fills in before pasting)."
3. **§12.1's reading,** Authentication -> Rate Limits:
   - emails 30/h (project);
   - SMS 30/h (greyed, unused);
   - token refreshes 150 per 5 min per IP;
   - token verifications 30 per 5 min per IP;
   - anonymous sign-ins 30/h per IP (greyed, unused);
   - sign-ups and sign-ins 30 per 5 min per IP;
   - Web3 30 per 5 min per IP (greyed, unused).

**Two premises did not hold on landing. Each is recorded rather than worked around:**
- **The minimum interval arrived as a blank.** CJ-1 asks for §12.1's checkbox to be ticked with it, and for the waiting rule's "[unverified]" to be replaced by it. **Neither is done: a number is never inferred.**
  - §12.1's checkbox stays unticked, carrying the parts that were read.
  - "[unverified]" stands.
  - H6 precondition 4 reads met IN PART and **NOT met**, because it names 12.1's reading.
  - The number, once read, is one line in each of those three places.
- **CJ-2 names the address Proton sends to at H6. That address is not written here.** At H6 the only mail sent is the operator's sign-in link, so the address CJ-2 names is the operator's sign-in address. BQ-1 (R-2026-09-24-89) keeps that address out of the repository: "no page, doc, runbook, fixture, test, script default or commit message".
  - The address appears in no tracked file today.
  - The gate is recorded by its substance: "the operator's sign-in address, Paddie Health's own role address in a mailbox Proton already hosts."
  - The ruling's reasoning is unchanged by the omission.

**CJ-1 — AS BUILT:**
- **§9, "Entering the Site URL and redirect URLs (H3 …)":**
  - marked entered on 2026-09-25, with the exact strings;
  - the `redirect_to` reading still open, at H6;
  - the old "Not done yet" paragraph kept as a restatement.
- **The Site URL row** of the un-automatable table records the entered strings and the date. The runbook asked for them there as well.
- **§12.1:** the rate limits and the SMTP settings are recorded under its checkbox, as read. The interval is marked NOT YET READ, and the box is unticked.
- **§12.3, precondition 4:** met in part and NOT met, as above, with CJ-2's gate beside it.
- **§12's hosted order:** step 3 (H3) reads entered, with the interval still to be read.
- **The email-provider row** of the open processor obligations names Proton (Proton AG, Switzerland) and the sender `support@openbed.ng`.
  - The s.29 agreement, the s.41 transfer basis and log retention are PENDING the founder's approval, tracked in the founder's paperwork register, items 1 and 4. That register is outside this repository, and no path to it is cited.
  - The row's earlier text is kept inside it. The list is live, so the row is amended (method note 8), not superseded.

**CJ-2 — THE PROCESSOR GATE, RULED.** The Proton processor agreement gates facility one: no hospital or ward address is sent a link until it is approved. It does not gate H6, because at H6 Proton sends only to Paddie Health's own role address, in a mailbox Proton already hosts. Recorded in the email-provider row, in §9's H3 entry and at §12.3's precondition 4.

**CJ-3** — no SQL, nothing hosted run by Claude Code. `ch-h2-pending` is deleted only after this change merges.

### R-2026-09-25-109 — #80 merged; the interval read

_Issued as R-PROVISIONAL-2026-09-25-CK, by Cowork on 2026-09-25, as its check of #80 at `1a22685`. **Pasting it was the founder's merge word for #80.** Record-only; it lands with H5's record (this change). Number assigned on landing: R-2026-09-25-108 plus one. Next provisional letter: CL._

**VERIFIED BY COWORK** (2026-09-25, GitHub API and git, on the founder's machine):
- **#79:** closed and merged; merge commit `b056ad1`, parents `06fe479` and `2c75150`; `origin/main` at `b056ad1`; `record-022-023-apply` gone on the remote.
- **#80:** OPEN at `1a226851c892034f387f59788979e677d578eba7`, base `b056ad1cf5e864ebab3bff3f95e0fdf023ff8d22`; mergeable, clean; 2 commits, 2 files; seven check runs completed/success.
- `a43ba58`'s tree is identical to `8872709`'s.
- The runbook diff records H2 as run, H3 as entered, §12.1 as read in part, precondition 4 as NOT met, and CJ-2's gate, as ruled.
- **CJ-2's address:** Cowork's block had named the operator's sign-in address, which BQ-1 bans from the repository. The implementer's wording ("the operator's sign-in address, Paddie Health's own role address in a mailbox Proton already hosts") is accepted, and Cowork will not name the address in a ruling again.

**THE MERGE (CK-1).**
- The head was read from the API as `1a22685`, and #80 merged as a merge commit with `--match-head-commit`.
- MERGED was read back: **`5786626a100c3f05e9aa42eb3bc0907b04b43959`**, with parents `b056ad1` and `1a22685`.
- As a separate step, `record-h2-h3` was deleted, remote and local, and `ch-h2-pending` locally. All read back as gone.
- **One correction to CK-1's premise.** "Its commit is in #80" is true of the content, not of the commit. `8872709` itself is not in #80; its cherry-picked copy `a43ba58` is. Before the forced local delete, `a43ba58` was confirmed an ancestor of `main`, and its tree was confirmed identical to `ch-h2-pending`'s.

**CK-2 — the interval:** Supabase's "Minimum interval per user", 60 seconds, read by the founder on 2026-09-25. It was held out of #80 and lands here (-110).

### R-2026-09-25-110 — H5 done on hosted; the interval recorded; H6 may start

_Issued as R-PROVISIONAL-2026-09-25-CL, by Cowork on 2026-09-25. It lands with -109 in one change, branched from `5786626`. Number assigned on landing: R-2026-09-25-109 plus one. Next provisional letter: CM._

**READ BACK BY COWORK** (2026-09-25; the founder's terminal from the deploy checkout at `b056ad1cf5e864ebab3bff3f95e0fdf023ff8d22`, and the Cloudflare connector):
1. **The deploy checkout:** refreshed to HEAD `b056ad1`, with `npm ci` clean.
2. **`deploy_worker.sh supabase-proxy`:** "HEAD … is on origin/main and the tree is clean"; stamp `b056ad1`, clean; wrangler 4.134.0; "DONE … names b056ad1… (attempt 1 of 12)".
   - It was run twice from the same checkout, a double paste: versions `89920e04-149c-49a1-99a7-1587ced00d59`, then `895ae17d-d603-4f21-94b0-439cacf5c497`, which is live.
   - Both runs were from the same commit.
3. **`readback_worker.sh https://api.openbed.ng`:**
   - probe 1: `401`, `sb-project-ref` `klrlpxysjsjpdkeqdhvl`, forwarded;
   - probe 2: GET `200` forwarded, HEAD `405` forwarded;
   - probe 3: `404`, refused, body `{"message":"not forwarded by the OpenBed proxy"}`;
   - the stamp: commit `b056ad1`, dirty false, HEAD `200` with `x-openbed-proxy: stamp`.
   - PASS.
4. **Probe 4,** by Cowork through the Cloudflare connector (`workers_get_worker_code`, `supabase-proxy`):
   - the bundled `allow_list_default` equals `supabase-proxy/allow-list.json` at `b056ad1`, entry for entry;
   - `forward` is 12 POST, 1 GET and 12 OPTIONS preflights;
   - `direct_origin_exceptions` are `snapshot_current` and `/auth/v1/verify`, and `refusal_probes` is `GET /rest/v1/`;
   - the markers are present, and `version_default` names `b056ad1`, dirty false.
   - PASS.
5. **The minimum interval,** "Minimum interval per user" in Supabase's SMTP settings: 60 seconds (the founder's reading, 2026-09-25).

**Re-read on landing, at `5786626`:**
- `allow-list.json`'s `forward` counts 12 POST, 1 GET and 12 OPTIONS. The names and the exceptions are as Cowork read them.
- `supabase-proxy/` is identical at `4e28cdb` (PR C's merge), `b056ad1` (the deployed commit) and `5786626`. So the H5 checkbox's "at the merged commit" holds, although the deploy ran from a later commit.

**Two premises needed a note:**
- **Probe 4's text in `docs/runbook-cloudflare-worker-proxy.md` §3 had been stale since PR C,** which is mine. It said "exactly the four `POST` paths and one `GET` path". PR C (#77) added sixteen entries and did not restate it. It is restated to derive the expected set from the file at the deployed commit, with the old sentence kept.
- **"[unverified]" was not in the waiting rule.** It was in §12.1's "Read once" paragraph ("The hosted value is [unverified]"). That sentence is restated to 60 seconds, and the waiting rule names the window, "60 seconds on hosted", so both carry the value.

**CL-1 — AS BUILT:**
- **§12.2:** the H5 checkbox is ticked with items 1–4, the live version id and Cowork's reading. The double paste is named.
- **§12.1:** the box is ticked, and the reading is complete: the rate limits, the SMTP settings and the 60-second interval. "[unverified]" and the "NOT YET READ" line are restated, and their old text is kept.
- **§12.3:** preconditions 4 and 6 are met on 2026-09-25, and precondition 4's "NOT met" text is kept as a restatement.
- **§12's hosted order:** H3's interval is read, and H5 is done.
- **The Worker runbook's probe 4:** as above.

**CL-2 — H6 MAY START BEFORE THIS MERGES.** Every H6 precondition was met on hosted on 2026-09-25 and read by Cowork: A.2, 022, H2, H3 including the interval, C, H5 and 023. The founder may begin H6 while this change is open, and the runbook catches up when it lands. Recorded in §12.3.

**CL-3** — no SQL, nothing hosted run by Claude Code.

### R-2026-09-25-111 — H6 step 1 lacked the Service Auth policy (held; landed as amended by -112)

_Issued as R-PROVISIONAL-2026-09-25-CM, by Cowork on 2026-09-25, after #81 had been reported. It was held for the next record change, not added to #81, and it lands here as amended by -112 CN. **The evidence kind:** Cowork's block was not kept in the repository. The text below is the implementer's held summary of it, and CN restates its steps. Number assigned on landing: R-2026-09-25-110 plus one. Next provisional letter: CN._

**CM-1 — the gap.** H6 step 1 said "issue the Access service token" and never added an Access policy admitting it: Action **Service Auth**, Include that token only. Without that policy the token passes nothing, `readback_admin.sh`'s token half is refused, and H6 step 2 reads STOP on a correct deploy.

**CM-2 — as held:**
- restate §12.3 step 1 and `docs/runbook-admin-deploy.md` §0, keeping the old text as dated restatements;
- the steps: (a) `npx wrangler pages project create openbed-admin --production-branch main`; (b) the custom domain `admin.openbed.ng`; (c) Access gains the hosts `openbed-admin.pages.dev` and `*.openbed-admin.pages.dev`; (d) the token `openbed-admin-readback`, in the password manager only, plus the Service Auth policy, with the IdP policy unchanged;
- record step 1's readings (the wrangler output, the hostnames and the policies, with no secret) when they arrive.

**Superseded in its step list by -112 CN.** CM's (c) and (d) assumed an Access application already in front of `admin.openbed.ng`, which did not exist. CN reorders the step into a) to e), creating the application rather than adding hosts to it. CM-1's finding stands, and it is CN's step (d).

### R-2026-09-25-112 — #81 merged; H6 step 1 restated: no Access application existed before 2026-09-25

_Issued as R-PROVISIONAL-2026-09-25-CN, by Cowork on 2026-09-25. **Pasting it was the founder's merge word for #81.** It lands with -111 and -113 in one change, branched from `389cd10`. Number assigned on landing: R-2026-09-25-111 plus one. Next provisional letter: CO._

**VERIFIED BY COWORK** (2026-09-25, GitHub API):
- #81 was OPEN at `e7c7c69101806ddaec7ded244368f052b3df9a30`, base `5786626a100c3f05e9aa42eb3bc0907b04b43959`, and clean; 1 commit, 3 files; seven check runs success.
- The operator's sign-in address appears 0 times in #81's diff.
- Re-read after H6: still open at `e7c7c69`, clean, and `origin/main` still `5786626`.

**Re-read by the implementer before the merge** (`gh pr view 81`, the check-runs API, `git ls-remote`): OPEN, head `e7c7c69101806ddaec7ded244368f052b3df9a30`, base `5786626a…`, MERGEABLE and CLEAN, 1 commit, 3 files; compliance-tests, golden-path, bundle-guards, secret-scan, db-tests, migration-lint and repo-lint all completed/success; `main` at `5786626a…`. Every premise held.

**CN-1 — THE MERGE.**
- The head was read from the API as `e7c7c69101806ddaec7ded244368f052b3df9a30`, and #81 merged as a merge commit with `--match-head-commit` on that value.
- MERGED was read back: **`389cd10606add5ed1ee900a2abdf9049d8636b12`**, with parents `5786626a100c3f05e9aa42eb3bc0907b04b43959` and `e7c7c69101806ddaec7ded244368f052b3df9a30` (`git rev-list --parents`).
- As a separate step, after MERGED was read, `record-h5` was deleted on the remote and locally. Both were read back as gone.

**CN-2:** this change is branched from the new `main`, `389cd10`.

**CM AS AMENDED — H6 STEP 1 RESTATED.**
- **The premise that failed:** the record said Access was in front of `admin.openbed.ng` from 2026-09-24 (-89 BQ-2, founder-reported and not read back), and `docs/runbook-admin-deploy.md` said so in the present tense.
- **It was not.** The founder reports that Zero Trust held no application until 2026-09-25.
- **Cowork's outside read before setup:** `admin.openbed.ng` resolved (proxied) and answered 522, with no Access redirect; `openbed-admin.pages.dev` answered 522. Nothing was served.
- **The order, now §12.3 step 1 and the admin runbook's §0** (method note 8, the old text kept):
  - a) `npx wrangler pages project create openbed-admin --production-branch main`, from the deploy checkout;
  - b) the Zero Trust login method GitHub (the founder's account, two-factor on), tested;
  - c) CREATE the self-hosted Access application "OpenBed admin" for `admin.openbed.ng`, `openbed-admin.pages.dev` and `*.openbed-admin.pages.dev`, with GitHub the only login method, one-time PIN off, and the policy "Founder": Allow, Include the founder's identity email only (never written in the repository);
  - d) the service token `openbed-admin-readback` (Client ID and Secret in the founder's password manager only), and a second policy, Service Auth, Include that token only;
  - e) `admin.openbed.ng` as the Pages project's custom domain, deleting any placeholder `admin` DNS record first.
- **Restated as built:**
  - runbook §12.3 step 1;
  - the admin runbook's opening sentence about Access, and §0;
  - a SUPERSEDED-IN-PART note on BQ-2 above, which is not rewritten.
- **Deliberately not edited.** Three code comments say Access sits in front of the admin hosts: `apps/admin/public/_headers`, `apps/admin/wrangler.toml` and `scripts/readback_admin.sh`'s header. They are true from 2026-09-25. Editing `apps/admin/public/_headers` would also fire -113 CO-3's CSP trigger, and this change carries no app code.

### R-2026-09-25-113 — H6 done on hosted: admin.openbed.ng is LIVE

_Issued as R-PROVISIONAL-2026-09-25-CO, by Cowork on 2026-09-25. It lands with -111 and -112 in one change. Number assigned on landing: R-2026-09-25-112 plus one. Next provisional letter: CP._

**H6 AS RUN, 2026-09-25.** All steps ran from `~/Desktop/OpenBed-NG-deploy` at `5786626a100c3f05e9aa42eb3bc0907b04b43959`, and Cowork read back each one. Preconditions 1–7 were all met on hosted, as recorded in -105 to -110. The full readings are in the runbook's §12.3 checkbox; in short:
1. **Step 1:**
   - wrangler: "Successfully created the 'openbed-admin' project."
   - Founder-reported: the application, its three hostnames, GitHub only, and the policies "Founder" and Service Auth. The existing `admin` DNS record was kept; step 2's `admin.openbed.ng commit` reading proves it serves this project.
   - Cowork's outside read: four hosts each answered 302 to `openbedng.cloudflareaccess.com`, and the login page offers GitHub only.
2. **Step 2:**
   - The deploy: stamp `5786626`, clean; deployment `https://c8fc4bf8.openbed-admin.pages.dev`.
   - The first read-back ran against the literal HASH placeholder and read STOP. That was correct, and not about the deploy.
   - Re-run against the deployment: **PASS**. Every step 1 host read 302; the commit `5786626` on both hosts, dirty false; the headers as rendered; 1 bundle and 1 key; live 200, dead 401, operator call 401 `forwarded`.
3. **Step 3:** `real key: HTTP 200`, `wrong key: HTTP 401`. **PASS.** The paste showed `--max-time 12-o /dev/null`, and no body appeared.
4. **Step 4, the WIDENED grant sweep,** project `klrlpxysjsjpdkeqdhvl`, both halves in one sitting (Cowork added the `read -rs` / `unset` lines):
   - Half 1: one row, `anon | facility | SELECT`, then ROLLBACK.
   - Half 2: (0 rows), and `app_tables_enumerated` 17.
   - **PASS.** Recorded under §6's heading.
5. **Step 5:** provisioned PLATFORM_ADMIN [the operator's sign-in address] -> account `4459e348-098a-4e2f-89e4-fec261c1e58e` (the operator); "auth user: created, confirmed"; no REFUSED; count read-back 1. **PASS.**
6. **Step 6:**
   - The first attempt was "not an https link": the clipboard held the command.
   - Re-copied: `redirect_to` as sent and decoded, both `https://admin.openbed.ng/`. **PASS.**
   - This was the first real email through Proton, and it closes §9's H3 `redirect_to` reading.
7. **Step 7:**
   - Order 1, with an Access session: signed in, and the register loaded.
   - Order 2, a fresh private window: a GitHub server error at the Access login; on retry, signed in, and the register loaded.
   - **The fragment survives the Access bounce.**
8. **Step 8:** "Facilities", "Reload", "New facility", "No facility exists yet." **PASS.**

**CO-1 — RECORDED:**
- §12.3's H6 checkbox is ticked with the readings. **Admin is LIVE on 2026-09-25.**
- "The admin app is NOT live" is restated in `docs/runbook-admin-deploy.md` with its old text, and so is the tail of `readback_admin.sh`'s LOCAL line ("admin is not live until H6 …").
- §12's header no longer reads NOT YET RUN for 12.1–12.3.
- §12's hosted order: H6 done. Facility creation (12.4) is BLOCKED by both gates, named in 12.4's head: (a) the -45 gate (step 4b row 5, the restore drill, never run) and (b) CJ-2 (the processor agreement, not approved).
- §9's H3 entry and the Site URL row record the observed `redirect_to`.
- The admin runbook's §4 `[unverified]` paragraph is replaced with step 7's result, and the old text is kept.

**CO-2 — RUNBOOK FIXES** (method note 8 throughout):
- **`rb_require_url` in `scripts/readback_common.sh`** refuses a URL whose first label is literally `HASH` with ERROR and exit 2, before any request. It is shared by every read-back, and inert for the two that take fixed origins.
  - The plant is in `tests/compliance/readback_scripts.test.ts`, over the pages, ward console and admin read-backs. It asserts ERROR, no STOP, no PASS and no request.
  - It was run red against the unchanged script first (4 of 4 failed: the scripts went on to probe the placeholder host), then green.
  - One new leg, reached: `legs_total` 313, reached 287, measured.
- **§12.3 step 3:** `-o /dev/null` comes first in both curls.
- **§6's WIDENED sweep:** both halves read and unset `DATABASE_URL`.
- **§12.3 step 6:** how to copy the link's address from Proton, and that "not an https link" means the copy.

**One premise did not hold, and the fix survives it.** CO-2 asked the WIDENED sweep to "carry step P's PATH line". Both halves already did, as their first line, which is what `tests/compliance/runbook_psql_path.test.ts` requires. Only the `read -rs` / `unset` lines were missing, and the PATH line stays first.

**A reading note, not a correction.** H6 step 7's order 2, as written, opens the link in a second fresh private window. CO reports one fresh private window. It is recorded exactly as reported, and nothing is inferred about a second window.

**CO-3 — OPEN ITEMS, NOT FIXES** (method note 22):
- **The production admin CSP carries `http://127.0.0.1:54321` in `connect-src`,** rendered from `packages/origins/origins.json`, whose `api` entry lists a local origin beside the production one (re-read on landing). The fix: render `connect-src` per build target, with a test that a production `_headers` names no `127.0.0.1` or `localhost`. **Trigger: the next change that touches `apps/*/public/_headers` or `scripts/render_headers.mjs`, and before facility one.** Recorded in the admin runbook's §4.
- **`provision_ward_account.mjs` prints the full address on its output line,** so a pasted output carries it (BQ-1). The fix: print a masked form (the first character and the domain). **Trigger: the first ward-account provisioning, and before facility one.** Recorded at 12.4 step 5.
- **The paperwork gate:** the email provider's processor agreement, transfer basis and retention (CJ-2) are tracked in the founder's paperwork register, outside the repository. Facility one waits on it.

**CO-4:** the checks are reported in this change's pull request. No SQL and no migration; nothing hosted was run by Claude Code.

### R-2026-09-25-114 — #82 checked and merged; the restore drill planned

_Issued as R-PROVISIONAL-2026-09-25-CP, by Cowork on 2026-09-25, as its check of #82 at `43ce55a`. **Pasting it was the founder's merge word for #82.** Record-only; it was held, and it lands with -115 in one change, branched from `9f91d91`. Number assigned on landing: R-2026-09-25-113 plus one. Next provisional letter: CQ._

**VERIFIED BY COWORK** (2026-09-25, GitHub API and git, on the founder's machine):
- **#81:** closed and merged; merge commit `389cd10606add5ed1ee900a2abdf9049d8636b12`, parents `5786626` and `e7c7c69`.
- **#82:** OPEN at `43ce55a563023681154c55463a94ea0c5c7a48d6`, base `389cd10`; clean; 1 commit, 7 files; seven check runs success. The operator's sign-in address occurs 0 times in the diff.
- **The script diff, read in full:** `readback_common.sh` refuses `https://HASH…` with ERROR, exit 2, before any request. `readback_admin.sh`'s local-run line is restated, and the old text is kept as a comment.
- **All four of the implementer's departures accepted:**
  - the PATH line was already present;
  - the ERROR wording applies to HASH only, and the other refusals are unchanged;
  - step 7's order 2 is recorded as reported, in one fresh private window;
  - the three comments asserting Access are left unedited, and are now true.

**CP-1 — THE MERGE.**
- The head was read from the API as `43ce55a563023681154c55463a94ea0c5c7a48d6`, and #82 merged as a merge commit with `--match-head-commit` on that value.
- MERGED was read back: **`9f91d91a5b0185430e65c0baaec9f20e3e1f9bf1`**, with parents `389cd10606add5ed1ee900a2abdf9049d8636b12` and `43ce55a563023681154c55463a94ea0c5c7a48d6`.
- As a separate step, after MERGED was read, `record-h6` was deleted on the remote and locally. Both were read back as gone.
- Cowork later read: the merge tree equals `43ce55a`'s; the branch is a 404 on the API; `origin/main` is `9f91d91`.

**CP-2:** nothing hosted. The next hosted step was named as the backup restore drill.

**The drill's planning notes** (Cowork, 2026-09-25, a HOLD block without an id; carried here because they were the drill's design):
- **Supabase platform claims (Cowork's reading; not checked by the implementer):**
  - "Restore to a new project" is on paid plans with physical backups;
  - it copies the schema, data, roles and auth users, but not storage, edge functions, auth settings, API keys or realtime settings;
  - the source is unaffected;
  - pg_cron and pg_net run on the clone with no pause.
- **Repository claims, checked by the implementer, and each holds:**
  - no migration uses pg_net (a grep of `database/migrations`, with a `cron.schedule` control that matched);
  - the only cron jobs are 017's two, at `017_snapshot_schedule.sql:227-228`, both inside the database;
  - 23 forward migrations, so a backup from before 022 and 023 would read 21.
- **The design:** never restore in place; compare against the known history at the backup's timestamp; delete the clone after the reading.

### R-2026-09-25-115 — backups proven: the restore drill passed and the -45 gate is clear; the stray login removed

_Issued as R-PROVISIONAL-2026-09-25-CQ, by Cowork on 2026-09-25. It lands with -114 in one change. Number assigned on landing: R-2026-09-25-114 plus one. Next provisional letter: CR (a correction to this change; see -116)._

**CQ-1 — STEP 4, BACKUPS AND PITR** (the founder's dashboard screenshots for project `klrlpxysjsjpdkeqdhvl`, read by Cowork; not step 4's curl):
- **Box 1: MET.** Daily **physical** backups are listed at about 06:55 UTC: 25 Sep 06:54:11, 24 Sep 06:57:25, 23 Sep 06:57:50, 22 Sep 06:55:45, 21 Sep 06:54:35, 20 Sep 06:57:41, 19 Sep 06:55:44, 18 Sep 06:57:09, and earlier.
- **Box 2: PITR is OFF.** The founder declines the add-on, on cost (2026-09-25).
  - The recovery point is the last daily backup, so up to about 24 hours of writes can be lost. In v1 that is operator data, recoverable from the signed originals, and ward status, which wards republish.
  - Revisit at the first data-loss event, or when re-entering a day's operator writes stops being practical, on the founder's word.
- **Box 3: MET.** The 25 Sep 06:54:11 UTC backup was restored via "Restore to a new project" into `openbed-restore-drill` (eu-west-1). Click-to-ready took about 10 minutes (the founder's estimate).
  - The same query was read on both. Live: 23 | 2026-09-24 23:29:53.3062+00 | 0 | 1 | 2 | 2026-09-25 07:55:58.035448+00. Clone: 23 | 2026-09-24 23:29:53.3062+00 | 0 | 0 | 1 | 2026-09-14 16:14:43.813421+00.
  - **PASS:** the clone equals live as at 06:54:11 UTC, and the operator, created after the backup, is correctly absent.
  - The clone was deleted (founder-confirmed).
- **Recorded as safety notes in step 4:** never restore in place; a clone runs pg_cron, but the only jobs are in-database and no migration uses pg_net; the clone is deleted after reading.

**CQ-2 — STEP 4b: THE GATE IS CLEAR, AND ITS WORDING IS RESTATED.**
- Row 5 is CLOSED on 2026-09-25, and all five rows read CLOSED. **The -45 gate is clear.**
- **The trigger and the check now count ward accounts only** (`role <> 'PLATFORM_ADMIN'`), with the old text kept. The operator's row (`4459e348-098a-4e2f-89e4-fec261c1e58e`, 07:55:58 UTC, H6 step 5) came before the gate cleared, as BY-1 intended.
- **The 2026-09-25 reading:** facility 0, ward_account 1 (the operator), ward accounts other than the operator 0.
- §12.4 is blocked by the one remaining hosted gate, CJ-2, **and** by every open item in this record with the trigger "before facility one", listed at the runbook's 12.4 step 1. *As issued, this line read "§12.4 is blocked by CJ-2 alone"; corrected by -116 CR-1.*

**CQ-3 — THE STRAY AUTH IDENTITY, REMOVED.**
- **The identity:** the disclosure address's test login from §9's run (created 2026-09-14 16:14:43 UTC, last signed in 16:27:26 UTC), with no `app.ward_account` row. It is recorded by that description only.
- **Removed by the founder on 2026-09-25**, in the dashboard (Authentication -> Users -> Delete user). Read back: `auth.users` with no `app.ward_account` row returns 0 rows.
- **Why:** it served no purpose, and it was the only Auth user at a published address. OTP requests for it could spend the project-wide 30 emails an hour.
- **§9 now says so,** and it says that future hosted probes use an `example.invalid` address or remove their identity in the same sitting.

**CQ-4 — OPEN ITEMS:**
- **The project-wide 30 emails an hour** can be spent by OTP requests for any known address. The fix is to revisit the limit, or to throttle per address at the Worker. **Trigger: the second facility, or the first 429 a ward sees.** Recorded in §12.1.
- **Carried from -113 CO-3,** both before facility one: the production CSP without `http://127.0.0.1:54321`, and a masked address in `provision_ward_account.mjs`. Cowork will send them as their own ruling (CS; renumbered from "CR" by -116) for one small code PR.

**AS BUILT, with the implementer's premise notes:**
- **Derived, not read:** "ward accounts other than the operator: 0". Live `ward_account` read 1 at the drill, and H6 step 5's count of active PLATFORM_ADMIN rows read 1.
- **`<>` is safe here:** `app.ward_account.role` is `app.app_role NOT NULL` (003), so the restated count cannot drop a row with a NULL role.
- **The restated check was demonstrated on a fresh local database, in a transaction that was rolled back:**
  - the seed alone read `8|0` under both queries;
  - with a PLATFORM_ADMIN row, the old query read `8|1` and the restated one `8|0`;
  - with a WARD_STAFF row as well, the restated one read `8|1`.
  - **It has not been run on hosted.**
- **Three statements the ruling did not name went false when the gate cleared. Each is restated, comment and runbook text only, with its old text kept:**
  - the `scripts/provision_ward_account.mjs` header, which step 4b says carries the same block ("the gate has not cleared");
  - the gloss "which means before step 4b's gate clears", in runbook §5's 020 note and in `scripts/readback_public_output.sh`. The comparison is valid while no ward account exists, which still holds;
  - the runbook's order-table row 12, "NOT YET RUN", stale since #82. That was the implementer's miss.
- **The disclosure address already appears** in §9's observed output from 2026-09-14. That is a dated observation of a published contact address, and it is unchanged. Nothing new names it.

**CQ-5:** the checks are reported in this change's pull request. No SQL and no migration; nothing hosted was run by Claude Code.

### R-2026-09-25-116 — #83 corrected: facility one waits on more than CJ-2; step 4b's check no longer stops facility two

_Issued as R-PROVISIONAL-2026-09-25-CR, by Cowork on 2026-09-25, as its check of #83 at `4c6e06e28be24265452ddaa7805da5d3937a3147`. **Not the merge word.** It lands in #83 as a second commit on the same branch, with no force-push and no rebase. Number assigned on landing: R-2026-09-25-115 plus one. Next provisional letter: **CS**, the small code PR that -115 CQ-4 called "CR"._

**VERIFIED BY COWORK** (2026-09-25, GitHub API):
- #83 OPEN at `4c6e06e`, base `9f91d91` (= main); clean; 1 commit, 4 files, +248/−35; seven check runs success.
- No email address on any added line. The operator's user id already stands on main.
- The diff was read in full, and all four of the implementer's departures are ACCEPTED: the three extra restatements; "ward accounts other than the operator: 0" marked derived; the local-only demonstration of the restated check; and §9's dated line left as written.

**CR-1 — "FACILITY ONE WAITS ON CJ-2 ALONE" WAS FALSE.** The error was Cowork's, in CQ-2's last line, and #83 carried it into several places. CJ-2 is the one remaining HOSTED gate, but this record also holds open items with the trigger "before facility one".
- **a) Corrected, each to "the one remaining hosted gate is CJ-2, AND every open item with the trigger 'before facility one'":**
  - the runbook order-table row 12;
  - step 4b's "THE GATE IS CLEAR" paragraph;
  - §12's order item 6;
  - 12.3 step 8's note;
  - 12.4's head and step 1;
  - the `scripts/provision_ward_account.mjs` header;
  - -115 CQ-2's last line, landed corrected with its as-issued text;
  - ledger row CQ.
  
  A sweep of #83's added lines for "alone", "waits on", "still stands" and "one gate" found no other site.
- **b) The checklist "Open before facility one"** is now at runbook 12.4 step 1, with one blank box per item and none closed. It was compiled by searching this record for "before facility one" and its variants ("for facility one", "facility one", "first facility", "onboarding blocker", "before go-live", "before launch"), about 64 hits, each read in context.
  - **Listed as OPEN (13):**
    - -108 CJ-2 (the hosted gate);
    - -113 CO-3's production CSP;
    - -113 CO-3's masked address;
    - -67 A7 extended by -68 C3 (the thresholds and the public wording);
    - -66 C4 (each public number answered 24/7; its own wording is "FOR FACILITY ONE");
    - -67 B3 (a staffed ward line, which carries -66's "operator contact number");
    - -55 C (the magic-link host);
    - -54 B (the sensor bundle);
    - -23 D2, D3, D4 and D5 (R-2026-09-19-23; this line read "-19-23" until corrected by -117 CS-5), which -56 A9 made "before facility one" items (D2's scope cell still reads "to be completed" in the processor-obligations table, and no later ruling closes D3, D4 or D5);
    - -36 A5 with -27 C5 (discoverability at facility one).
  - **Not in Cowork's list, found by the search:** D2 to D5, and -36 A5 / -27 C5. Each is listed as OPEN because no ruling closing it was found.
  - **Left off, with the evidence:**
    - -36 A6's infrastructure inventory: -56 ("the infrastructure review CLOSES");
    - -44 E and -45's defects and invite gate: step 4b rows 1–4 CLOSED (-75 BC-2, -88);
    - -45 G's missing procedure: runbook §12.4 (PR C, -88 BP-13);
    - -67 A's count age: shipped in PR 3.2b (-68);
    - -74 BB-4's restore: -115;
    - -68's H2 and H3: -106, -108 and -110;
    - -66 G's operator contact number: superseded by -67 B (B1 and B2 satisfied by the ward-facing support address; B3 listed);
    - the low-count trigger near line 269: it fires only after a facility publishes;
    - -115 CQ-4: its trigger is the second facility;
    - line 1167 and -71 C: prose mentions, not items;
    - -34/-35 A5 and method note 22: a scope rule;
    - -70 C3: no facility-one trigger.

**CR-2 — STEP 4b'S CHECK WOULD HAVE STOPPED FACILITY TWO.** Its stop condition read "`0|0` … anything else … report that rather than continuing", and 12.4 step 1 required it.
- **Restated** (method note 8): before facility one it reads `0|0`; after that it records the counts, and a non-zero reading stops nothing, because every row is CLOSED.
- **12.4 step 1:** read the check and record it; for facility one it reads `0|0`.
- **Traced, every other invocation, all reading correctly:**
  - §5's 020 note ("none may be created on hosted until step 4b reads clear"): a dated conditional, now satisfied;
  - §5's gloss and the `scripts/readback_public_output.sh` header: keyed to "no ward account" since -115;
  - `readback_public_output.sh`'s `0|0/0)` is an unrelated `case` pattern;
  - `scripts/provision_target.mjs`: "never WHETHER step 4b is clear";
  - the `provision_ward_account.mjs` header, after CR-1;
  - row 12's "needs step 4b CLOSED on every row": true;
  - 12.3 step 8's conditional: true;
  - 4b's 2026-09-21 "passing reading `0|0`": dated;
  - the 021, 022 and 023 migration comments: frozen and dated, not edited.

**CR-3 — RECORD-KEEPING.**
- -115's "Next provisional letter: CR" now reads "CR (a correction to this change; see -116)".
- CQ-4's "(CR)" now reads "(CS; renumbered from "CR" by -116)".
- Comments and runbook text only. No SQL, no migration, nothing hosted. The checks are reported in #83.

### R-2026-09-25-117 — #83 merged; a production CSP with no local origin, and a provisioning script that never prints a full address

_Issued as R-PROVISIONAL-2026-09-25-CS, by Cowork on 2026-09-25, as its check of #83 at `0378f6bbd3b0c3b9c1eba0937e671b4099ac717d`. **Pasting it was the founder's merge word for #83.** It lands in the code pull request it describes, branched from #83's merge commit. Number assigned on landing: R-2026-09-25-116 plus one. Next provisional letter: CT._

**VERIFIED BY COWORK** (2026-09-25, GitHub API):
- #83 OPEN at `0378f6b`, whose one parent is `4c6e06e` (a plain push); base `9f91d91`; clean; 2 commits, 4 files; seven check runs success; no address on any line `0378f6b` adds.
- CR-1 a) was applied at every named site. The checklist holds 13 boxes, none ticked, and CR-2's reading and 12.4 step 1 agree.
- ACCEPTED: the five items found beyond Cowork's list, and every item left off, on the evidence given.
- Two slips were fixed here (CS-5).

**CS-1 — THE MERGE.**
- The head was read from the API as `0378f6bbd3b0c3b9c1eba0937e671b4099ac717d`, and #83 merged as a merge commit with `--match-head-commit` on that value.
- MERGED was read back: **`574e423a1f190cd5e1e4bf26d89dd9937e019fb2`**, with parents `9f91d91a5b0185430e65c0baaec9f20e3e1f9bf1` and `0378f6bbd3b0c3b9c1eba0937e671b4099ac717d`.
- As a separate step, after MERGED was read, `record-backups-drill` was deleted on the remote and locally, and both were read back as gone.
- This change is branched from `574e423`.
- **One operational note.** `git pull --ff-only` refused ("Cannot fast-forward to multiple branches"). `main` was checked, and then fast-forwarded with `git merge --ff-only origin/main`. Nothing was lost.

**CS-2 — THE PRODUCTION CSP NAMES NO LOCAL ORIGIN (checklist box 2).**
- **`scripts/render_headers.mjs`** takes a required `--target production|local` and fills only that target's API origin. A missing or unknown target is exit 2 with its own message; there is no default. `origins.json` keeps both origins, and runtime selection by hostname is unchanged.
- **Each app's `npm run build`** renders `--target production`. Admin and the ward console gain `npm run build:local` (`--target local`).
- **The callers found, and each one's target:**
  - `apps/admin`, `apps/ward-console` and `apps/public-dashboard` `npm run build`, which is what is deployed (also CI and the gate): **production**.
  - `npx wrangler pages dev apps/admin/dist` and `readback_admin.sh --local` (the admin runbook's §3), and the local real-browser walk before a `_headers` change (both deploy runbooks): **local**, via `build:local`. This is the only caller that serves a built bundle, with `_headers` applied, against the local stack.
    - **Observed:** a `build:local` admin served by `wrangler pages dev` answered `connect-src 'self' http://127.0.0.1:54321`.
    - `readback_admin.sh --local` read that CSP line `ok`. Its one WRONG was `dirty: true` from an uncommitted tree, which is correct.
  - `vite preview` (each app's `preview` script): **none needed.** **Observed:** it served the ward console with no `Content-Security-Policy` header at all, while the `dist/_headers` it serves from holds one. It does not read Cloudflare's `_headers`.
  - `tests/e2e` and `scripts/run_e2e.sh`: none. No dist, wrangler or preview use was found.
  - `scripts/readback_common.sh` `rb_tracked_header`: **production** for every hosted read-back; **local** only under `readback_admin.sh --local`.
- **A premise that holds only in part (CS-2 c):** "rb_tracked_header renders production, since it reads hosted" holds for every hosted path. `--local` reads a local server serving a local build, so the function takes the target as an argument, and `--local` passes `local`.
- **Red first (method note 23):** "the built `_headers` names no local host in any header value" was run against the build as it stood, and failed for admin and the ward console on `127.0.0.1`; the public dashboard passed, as a control. After the fix and a rebuild, all three pass. The built CSPs now read `connect-src 'self' https://api.openbed.ng` (admin and ward console) and `connect-src 'self'` (dashboard).
- **Tests** (`tests/compliance/security_headers.test.ts`):
  - production and local renderings of every app;
  - the production rendering names no host from `origins.json`'s `localHosts`, which is read, not retyped;
  - the local rendering names exactly `api.local`;
  - a missing target and an unknown target are refused;
  - the built `_headers` equals the production rendering and names no local host.
- **Tests** (`tests/compliance/readback_scripts.test.ts`): renders per target, plus a plant showing the pre-CS ward-console deploy, whose CSP names both origins, reading WRONG on the CSP line. That is the redeploy's failing half.
- **Comments restated,** old text kept: the renderer's header, both apps' `_headers`, `readback_common.sh`, `security_headers.test.ts`, and both deploy runbooks.
- **Each deploy runbook gains §5, "Redeploy after the CSP change",** with its read-back and its expected failing half. **Box 2 is NOT ticked by this merge.** It closes when both apps are redeployed from the merged `main` and each read-back reads PASS.
- **NOT DONE: the real-browser walk under the new headers** (R-2026-09-24-93 BU-2 e). No browser was reachable from this session, and the built-in browser cannot open a local server the implementer starts. It is a founder step: `npm run build:local`, then `wrangler pages dev`, load the app in a browser, check the console, walk the sign-in against the local stack. The production header is then read on hosted by §5's read-back.

**CS-3 — THE PROVISIONING SCRIPT NEVER PRINTS A FULL ADDRESS (checklist box 3).**
- `scripts/provision_ward_account.mjs` gains `mask()` (the first character, "…", and "@" plus the domain) and `scrub()`, which replaces every case-insensitive occurrence of the full address with the mask.
- They apply to the provisioned, reactivated and catch-all failure lines, and to every line that prints `e.message`, where a GoTrue body or a database error can echo the address.
- The other output lines print only refusal codes, the host-check reason or the usage line, and none of those carries the address. The static message text is unchanged, so the script's legs do not move.
- **Tests** (`tests/db/provision_script.test.ts`):
  - **every** run is held by `run()` to output that never contains the full address, case-insensitively, beside the existing token guard. That covers the provisioned, reactivated, already-complete, refusal and failure paths.
  - The provisioned, reactivated and database-failure lines assert the masked form.
  - A new plant: a GoTrue refusal body that echoes the address, in upper case, prints only the mask.
- **Red first:** the `run()` guard failed against the unchanged script on the `provisioned` line ("the script printed the full address").
- **Box 3 closes on this pull request's merge.** It is not ticked here.

**CS-4 — THE CHECKLIST:** box 2 names its closing condition (the two redeploys, read PASS), and box 3 names its own (this merge). Nothing is ticked.

**CS-5 — THE TWO SLIPS:** -116's "-19-23" now reads "-23 (R-2026-09-19-23 …)", with a note; 12.4 step 1's variants gain "before go-live" and "before launch".

**Legs:** the renderer's usage leg is renamed, and two are new (no target, an unknown target), all three reached; the retired usage leg is removed. `legs_total` 313 -> 315, reached 287 -> 289, registered unchanged at 26, measured.

**CS-6:** the checks are reported in this change's pull request. No SQL and no migration; nothing hosted was run by Claude Code.

### R-2026-09-25-118 — #84 checked and merged; the redeploy's browser check

_Issued as R-PROVISIONAL-2026-09-25-CT, by Cowork on 2026-09-25, as its check of #84 at `03a103e74e29d693e0b1e4475c6ebc3afbdfdd6a`. **Pasting it was the founder's merge word for #84.** Record-only; held, and landed with -119 in one change branched from #84's merge commit. Number assigned on landing: R-2026-09-25-117 plus one. Next provisional letter: CU._

**VERIFIED BY COWORK** (2026-09-25, GitHub API):
- #83 MERGED at `574e423`, and its branch is a 404.
- #84 OPEN at `03a103e`, whose one parent is `574e423`; clean; 1 commit, 19 files; seven check runs success; no address on any added line.
- The diff was read in full.
- **ACCEPTED:**
  - CS-2 c holding only in part (`--local` reads a local build, so the function takes the target);
  - the caller survey, with `vite preview` observed serving no `_headers`;
  - the `run()`-wide address guard, which is stronger than asked.

**CT-1 — THE MERGE.**
- The head was read from the API as `03a103e74e29d693e0b1e4475c6ebc3afbdfdd6a`, and #84 merged as a merge commit with `--match-head-commit` on that value.
- MERGED was read back: **`dd59c7fac5de26137150f9c940dfed4074c4abda`**, with parents `574e423a1f190cd5e1e4bf26d89dd9937e019fb2` and `03a103e74e29d693e0b1e4475c6ebc3afbdfdd6a`.
- As a separate step, after MERGED was read, `csp-and-masked-address` was deleted on the remote and locally, and both were read back as gone.
- Local `main` was fast-forwarded with `git merge --ff-only origin/main`.

**CT-2 — THE LOCAL BROWSER WALK IS WAIVED FOR CS ONLY; A HOSTED BROWSER CHECK REPLACES IT** (R-2026-09-24-93 BU-2 e).
- **The reason:** BU-2 e guards against a CSP too tight to sign in, which curl cannot see. CS's local walk would have exercised only `build:local`, which never ships. The shipped header is read in a real browser on hosted, straight after each redeploy.
- **(a)** Each deploy runbook's §5 gains step 4: a fresh private window with the console open.
  - Admin: sign in as the operator.
  - Ward console: request a link for an `example.invalid` address.
  - PASS: no CSP violation, and the API answered.
  - A violation is a STOP: roll back the Pages deployment, then read back.
- **(b)** BU-2 e stands for later `_headers` changes. This waiver is for CS only.
- **A premise that did not hold, and the instruction survives it.** CT-2 a said the ward console "shows its refusal message". It has none. A 200, a 422 and a 429 all show the same sentence, `SIGNIN_ANSWERED` (`apps/ward-console/src/main.ts`), by design, so a refusal cannot reveal whether an address exists. The step's PASS is that sentence; a CSP block shows `SIGNIN_UNREACHABLE`. Cowork accepted the correction in -119 CU-2.

**CT-3:** checklist box 3 closes on this merge, and box 2 on both §5 read-backs and both browser checks. Both are ticked in -119.

### R-2026-09-25-119 — the redeploys recorded; boxes 2 and 3 closed; two zone settings found and removed; the read-backs see what a browser sees

_Issued as R-PROVISIONAL-2026-09-25-CU, by Cowork on 2026-09-25 (the founder's terminal and browser, read back by Cowork; Cowork's own curl from the founder's machine). It lands with -118 in one change, from `dd59c7f`. Number assigned on landing: R-2026-09-25-118 plus one. Next provisional letter: CV._

**CU-1 — ADMIN REDEPLOYED** (admin runbook §5, where the full readings are recorded).
- **The deploy checkout:** HEAD `dd59c7f`, clean.
- **Two attempts failed before upload.** wrangler's `GET /accounts` got a 429 with an HTML body (Ray IDs `a40a4ed129b3724f-LOS` and `a40a67277aa5724f-LOS`).
  - `/cdn-cgi/trace` read `loc=NG`, `colo=LOS`, `warp=off`. Later, an unauthenticated `GET /client/v4/accounts` read 403, matching Cowork's control from another network.
  - Read as a transient edge block on the founder's network. **Open item:** trigger, a second occurrence; the fix to evaluate is `CLOUDFLARE_ACCOUNT_ID` in the deploy environment.
- **The third attempt deployed** `https://4fc4ffd3.openbed-admin.pages.dev`.
- **Read-back PASS:** every line ok, the CSP `connect-src 'self' https://api.openbed.ng`.
- **Browser check:** signed in on the register.
  - The console at first showed ONE `script-src` violation, Cloudflare's beacon (CU-4 a).
  - After CU-4's fix, no red lines.

**CU-2 — WARD CONSOLE REDEPLOYED** (ward-console runbook §5).
- **Deployed** `https://20de9ab4.openbed-ward-console.pages.dev`.
- **Read-back PASS.** Cowork, with a browser User-Agent, read `app.openbed.ng` at `dd59c7f` with the same CSP.
- **Browser check:** the uniform sentence was shown, ending with the ward-facing support address, and the console was clean. The implementer's correction to CT-2 a was ACCEPTED.

**CU-3 — PUBLIC DASHBOARD REDEPLOYED** (the founder's decision; recorded in the dashboard runbook's reporting section).
- **FOUND:** `openbed.ng` was still at `2e62579`, which predates PR 3.4b-app B (`f7407bd`). So **the live public page served no CSP**, with Referrer-Policy `strict-origin-when-cross-origin`, and was 11 files behind `main`.
- **Deployed** `https://d78e602d.openbed-public-dashboard.pages.dev`.
- **`readback_pages.sh`: PASS.**
- **In a browser:** read-backs 5 and 5b, and the polling check (7 rows about 30 s apart, all from the network).
  - One `net::ERR_CONNECTION_CLOSED` recovered on the next poll. Read as the founder's connection.
- **Every place in the record or runbooks that states or implies the public dashboard ships its `_headers`, as found by the implementer's sweep:**
  - **-93 BU-2 (d):** "The production reading is the founder's next dashboard deploy". That deploy came only on 2026-09-25, so **a dated note is added** there.
  - **The -94 BV-2 entry** ("each app's `npm run build`"), **-97 BY-2 g** ("`security_headers` pins it for all three apps"), the admin runbook §4 ("holds all three apps to it"), and **-117's** "the built CSPs now read … (dashboard)": each describes the tracked file, the test or the BUILD, and each is **true as written**. Reviewed; not restated.
  - **The dashboard runbook:** it never stated that `_headers` ships. The finding is added in its 2026-09-25 run record.
  - No other site was found. The sweep searched for `_headers`, "security headers", "ships its headers", "each/every/all three app(s) … header", "production reading", `nosniff` and `BU-2 (d)` across the record and every runbook, and read each hit in context.

**CU-4 — TWO CLOUDFLARE ZONE SETTINGS FOR `openbed.ng` WERE CHANGING WHAT WE SERVE, INVISIBLY TO EVERY READ-BACK. BOTH ARE NOW OFF.**
- **(a) Web Analytics (RUM), zone-wide.**
  - It injected a beacon `<script>` into HTML only for a browser-like request, so every read-back's "bundles the page loads: 1" read ok.
  - It was blocked by `script-src 'self'` on admin and the ward console. It was **not** blocked on `openbed.ng`, which had no CSP, so **it collected page-view data for `openbed.ng` visitors** until the founder switched it off on 2026-09-25.
  - It is cookieless, and there is no deletion in the dashboard. Recorded in the processor-obligations table's Cloudflare row, with the start date marked NOT KNOWN.
  - Cowork then read no `cloudflareinsights` on any of the four hosts.
- **(b) Cloudflare managed robots.txt, zone-wide.**
  - Its Content Signals block (`User-agent: *`, `Allow: /`) was prepended to our file on `openbed.ng` only, so under RFC 9309 crawlers MAY crawl. That defeats R-2026-09-20-29 F on the host that matters.
  - It was switched off on 2026-09-25. Afterwards the served file's md5 was `d074e55701d37df045e01b26c6db830a` on `openbed.ng`, on the deployment URL, and in `git show dd59c7f:apps/public-dashboard/public/robots.txt`: identical.
  - The discoverability box stays OPEN, with this finding under it.

**CU-5 — THE READ-BACKS SEE WHAT A BROWSER SEES** (code).
- **(a)** `scripts/readback_common.sh` defines the browser User-Agent and `Accept: text/html` once, and `page_probe` sends them on every page and `robots.txt` fetch in the admin, ward-console and dashboard read-backs.
  - `rb_scripts` lists EVERY `<script>` element. Any `src` that is not same-origin with the host, and any inline script, reads WRONG, naming it. It handles double-quoted, single-quoted and unquoted `src`.
  - "Bundles the page loads" keeps its meaning.
- **(b)** The page checks (headers and scripts) run on the deployment URL AND on the custom domain: `admin.openbed.ng` with the token, `app.openbed.ng` and `openbed.ng`.
- **(c)** `readback_pages.sh` automates read-back 7: `/robots.txt` on the deployment URL and on `openbed.ng` must equal `apps/public-dashboard/public/robots.txt` byte for byte (`rb_same_bytes`, with `cmp`'s exit codes separated by hand). The runbook's read-back 7 is restated, with the old text kept.
- **(d)** Tests in `tests/compliance/readback_scripts.test.ts`, **each shown red first against the scripts as they stood:**
  - a beacon `<script>` served ONLY under a browser User-Agent (all three read-backs);
  - an inline `<script>`;
  - a custom domain whose CSP differs from the deployment's (all three);
  - a `/robots.txt` with Cloudflare's managed block prepended;
  - a `/robots.txt` that differs only on `openbed.ng`.
  - Also red first: an accept leg per read-back asserting every page fetch presented as a browser and the custom domain was read.
  - All 12 failed as expected (each plant's STOP was a PASS), then passed after the change.
- **(e)** The curl stub answers a browser-presenting request from a `… browser` fixture key in preference to the plain one.
  - **Demonstrated:** with the User-Agent removed from `page_probe`, all three beacon plants FAIL (the page looks clean), and the file was restored byte-identical afterwards.
- **Could-not-run legs, each planted:** node failing while listing the page's scripts (a stub failing only the marked call); `cmp` exiting 2; a checkout with no tracked `robots.txt`. Each is an ERROR, never a verdict.
- **Legs:** two new, both reached; two new nested identity pairs, pinned. `legs_total` 315 -> 317, reached 289 -> 291, registered 26, measured.

**CU-6 — THE CHECKLIST** (12.4 step 1):
- **box 2 TICKED** (CU-1 and CU-2 read-backs PASS; both browser checks clean after CU-4 a);
- **box 3 TICKED** on #84's merge `dd59c7fac5de26137150f9c940dfed4074c4abda`;
- CU-4 b's finding added under the discoverability box, which stays open. Nothing else ticked.

**CU-7 — THE RUNBOOKS:**
- both §5s gain step 4 with the exact sentences, and their 2026-09-25 readings;
- the read-back tables gain the script and custom-domain lines;
- each deploy runbook says why the page checks now run on the custom domain with a browser User-Agent;
- the dashboard runbook records the deploy, read-backs 5 and 5b and the polling check.

No SQL and no migration; nothing hosted was run by Claude Code.

### R-2026-09-26-120 — #85 checked and merged

_Issued as R-PROVISIONAL-2026-09-26-CV, by Cowork on 2026-09-26, as its check of #85 at `cdb86b14b0426cd1cb30eff5ce765800b21aa272`. **Pasting it was the founder's merge word for #85.** Record-only. It was held, and it lands with -121 in one change branched from #85's merge commit. Number assigned on landing: R-2026-09-25-119 plus one. The date is the date of issue (-121 CW-7). Next provisional letter: CW._

**VERIFIED BY COWORK** (2026-09-26, GitHub API, on the founder's machine):
- #85 OPEN at `cdb86b1`, base `dd59c7f` (= main); clean; 1 commit, 12 files, +609/−27. The seven check runs are success on `cdb86b1`. No address on any added line.
- The diff was read in full:
  - `page_probe` and the browser User-Agent, defined once in `readback_common.sh`;
  - `rb_scripts`, which lists every `<script>` (an inline one, or one from another origin, is WRONG);
  - `rb_same_bytes`, with `cmp`'s exit codes separated;
  - custom-domain page checks in all three read-backs (admin with the token, skipped under `--local`);
  - read-back 7 automated on both hosts;
  - the checklist: boxes 2 and 3 ticked with evidence, and the discoverability box open with the CU-4 b finding;
  - the Cloudflare row of the processor-obligations table, which gains the Web Analytics note with the start date NOT KNOWN.
- **ACCEPTED:**
  - the CU-3 sweep (one dated note at -93 BU-2 (d); four sites reviewed and true as written);
  - the replaced PASS-sentence assertion (it asserts more);
  - the recorded `\n` / `\b` slip, which failed loud and was fixed.
- **NOTED, not a defect:** the new custom-domain and script checks have not yet run against hosted.
  - Hosted serves `dd59c7f`, and the read-backs compare stamps with the checkout's HEAD, so their first hosted run is the next deploy.
  - Until then, the reading is Cowork's browser-User-Agent curl of 2026-09-25 (no beacon on four hosts; `robots.txt` md5 `d074e557…` on both).

**CV-1 — THE MERGE.**
- The head was read from the API as `cdb86b14b0426cd1cb30eff5ce765800b21aa272`, and #85 merged as a merge commit with `--match-head-commit` on that value.
- MERGED was read back: **`c20e635169ac55e9efb2884c409407db2da132a2`**, with parents `dd59c7fac5de26137150f9c940dfed4074c4abda` and `cdb86b14b0426cd1cb30eff5ce765800b21aa272`.
- As a separate step, after MERGED was read, `redeploy-record-and-browser-readbacks` was deleted on the remote and locally, and both were read back as gone.
- Local `main` was fast-forwarded with `git merge --ff-only origin/main`.
- **Read again on 2026-09-26, before this change branched:**
  - `gh pr view 85` reads `MERGED`, merge commit `c20e635…`, head `cdb86b1…`;
  - `git rev-list --parents -n1 c20e635` gives the two parents above;
  - `git ls-remote --heads origin redeploy-record-and-browser-readbacks` is empty, and no local branch has that name.

No code, no SQL, nothing hosted.

### R-2026-09-26-121 — the design pass and the launch paperwork become facility-one boxes; every deferral names one gate; the register and its guard

_Issued as R-PROVISIONAL-2026-09-26-CW, by Cowork on 2026-09-26, inside `Sprint Kickoffs/sprint-kickoff-design-pass-2026-09-26.md` (bundle D0). The id is named in D0's task list, not on the kickoff's first line. Pasting the kickoff was the founder's word to start D0. The file is committed unedited in this change (method note 15). It was written by extracting the pasted bytes from the session transcript, not by retyping them. Its sha256 is `ef9f29beb49c93894f58bed7412f5abe127cfb2f0302fde3108e332e2a991ee1` and its size 17577 bytes, both measured before and after writing. Number assigned on landing: R-2026-09-26-120 plus one. Next provisional letter: **CX**._

**The ruling's text is the kickoff's D0 section, CW-1 to CW-6. It is not restated here,** so the two cannot drift. CW-7 is the founder's, given on 2026-09-26 in answer to the implementer's question. In one line each, with what landing it did:
- **CW-1: the design pass is a facility-one item.** It is box 14 at runbook 12.4 step 1, in the kickoff's words. It closes only when all three apps are deployed from merged `main`, read back PASS, browser-checked at 360 px and desktop widths, and the founder approves the look. A merge alone does not close it.
- **CW-2: the launch paperwork is a facility-one item.** Box 15: the founder's launch paperwork register reads Approved on every item. The register is outside this repository. Box 1 (CJ-2) is unchanged, and box 15 does not replace it.
- **CW-3: the root cause, as Cowork's miss.** BC-7's gate was an action with no observable event and no checklist box. The checklist at 12.4 step 1 was compiled by searching for "before facility one" and its variants, and BC-7 contained none of them. So the pass fell out of every list that drives work. **-75 BC-7's "waits for Cowork's brief" is superseded by CW-1, by reference only.** BC-7's text is not edited.
- **CW-4: the rule.** Every deferral names exactly one gate: BOX, TRIGGER or VERSION. "Waits for X to do Y" is not a gate. Method note 22 is amended to say so.
- **CW-5: the register.** The section "Deferred items — this record is where the list lives" now stands between the provisional ledger and the method notes. It has 45 rows: 13 BOX, 27 TRIGGER and 5 VERSION.
  - *Note 2026-09-26 (R-2026-09-26-122):* after -122 the register holds 59 rows: 15 BOX, 33 TRIGGER and 11 VERSION. The 45 above were the count when this entry landed.
- **CW-6: the guard.** `tests/compliance/deferred_items.test.ts`.
- **CW-7 — a dating slip, Cowork's.** The kickoff (and the 2026-09-26 handoff it drew on) said CV lands as "R-2026-09-25-120". CV was issued on 2026-09-26, as #85's merge word (#85 merged at c20e635, 2026-09-26T07:26:30+01:00), so it is R-2026-09-26-120. The kickoff's "-09-25" is superseded by this line and is not edited. Read "CU plus one" as the number 120 only; it does not fix the date.

**THE SWEEP (CW-5).**
- **What was searched.** This record, for "OPEN ITEM", "open item", "trigger", "deferred", "out of v1", "follow-up" and "later", as ruled. Also "defer", "follow up", "v2", "before facility one" and its variants, "for facility one", "first facility", "before go-live" and "before launch". About 300 hits, each read in its ruling block.
- **What was discarded, by reason:**
  - database, event and cron triggers;
  - "later" as prose;
  - citations of the v2 kickoff (the record never uses "v2" as a release label);
  - ledger rows and change-log lines repeating a ruling;
  - method notes;
  - restatements of an item already counted.
- **Closed or superseded items, each traced to the ruling that closes it,** were not entered. Examples: the infrastructure inventory (-56), the restore drill (-115), the ESLint ignore gap (-50), step 4b's rows (-75 BC-2), and boxes 2 and 3 (-119).
- **Every "trigger fired" claim was checked with `git log` before it was written** (method note 19). This is what was found:
  - **-21-38 D1:** `8fd2ad7` changed `eslint.config.mjs`, and the config holds no Date rule.
  - **-21-41 B:** `f85d088` and `69e357a` changed `supabase/config.toml`'s auth settings.
  - **-21-50 E2:** `f7407bd` changed `.github/workflows/ci.yml`.
  - **The favicon item:** `f7407bd`, `cc46fda`, `2ab9f41` and `03a103e` changed `apps/public-dashboard/`, and `public/` still holds no favicon.
  - **-21-43 C1:** the EVIDENCE gate was lifted by -47.
  - **-21-45 E:** the script ran against hosted at H6 step 5 (-113).
  - **Not seen to fire:**
    - -21-38 D2. Since 2026-09-21 no commit changes the value of `s-maxage` or `pollCadenceSeconds`. Only prose moved, and `c4e97dc` copied the existing header string into a read-back script.
    - -21-42 G. `codec.ts` is untouched, and no commit since touches the column-name lines of the served-document test.
    - -21-48 A2. There is no `.from(` or `.rpc(` call under `apps/*/src`.
- Each fired trigger is a TRIGGER row marked **FIRED**, for Cowork to rule. None is converted into work (method note 22).

**FOR COWORK TO RULE, found by the sweep. No gate is invented for any of these** (CW-5):
1. **A "before facility one" item is not on the checklist.** It is section "Blocks facility-one onboarding" B1: the facility's agreement to publish its live capacity. "The gap is recorded. The clause is not drafted." No later ruling drafts it. 021 built the agreement's database record, not the clause. B1 also carries an onboarding step: a real ward session reads `ward_status_history` and gets 200. §12.4 does not have that step either.
   - **Cause:** -116's search variants never included the hyphenated "facility-one", which is the spelling of B1's section heading.
   - **Proposed:** a box 16. It is not added here.
2. **Deferrals with no stated gate** (no row can hold them, because (b) refuses "pending"):
   - O2's dispatch tier;
   - D4's "within last-used LGA", which "is not decided here";
   - #63/#97, #109 and #115, "fixed by a later change";
   - the digest gaps and survey items "deferred to the `scripts/` survey", which was never scheduled;
   - #71's outbox enqueue, "in the B5 sprint that does not yet exist";
   - -20-30 A5's Git integration, "a decision when someone has the facts";
   - -23-65 E's test-title convention, "a separate change";
   - -23-66 C2's phone features, "not now";
   - -23-70 C3's real-browser refusal check, "a decision for Cowork and the founder";
   - -23-71 C's provisioning Edge Function, a conditional design;
   - -24-97 BY-2 (e)'s idempotency key, "its own ruling if ever wanted";
   - -19-19 B's push-protection coverage, which is OWED with no gate.
3. **The six FIRED triggers above,** plus -21-43 C3, marked FIRED?. Gate 2's revisit waited for "Bundle 4's freshness work", and freshness shipped outside Bundle 4 in PR 3.2b.
4. **Where CW-5's assignments differ from the record's own words.** Cowork's gate is used in each row, and the record's words are noted here:
   - PITR (-115 CQ-1, not CQ-4). The record gives three limbs: "the first data-loss event, or when re-entering a day's operator writes stops being practical, on the founder's word".
   - Per-ward rows versus the rollup (-76 BD-3). The record reads "until dispatcher validation", and "30 days" appears nowhere.
   - Agreement history (-100 CB-2). The record adds "or earlier on the founder's word".
   - The out-of-v1 list (-75 BC-7). It had no reconsideration point before CW-5.
   - The contact-read audit (-76 BD-2 1). Since 022 the database refuses a second operator (-90 BR-1 a), so the trigger needs a ruling and a migration before it can fire.
5. **Not asserted by CW-6, and offered:** a BOX row whose box is TICKED leaving the register. Today a closed item's row can outlive its box without going red.

**PREMISES CHECKED** (the standing rule on stated reasons). Each instruction survives:
- **"Restate every place that says '13 items' or '11 open' (runbook 12 row, §12.4 prose)": neither place states a count.**
  - Row 12 and 12.4 name "every open item … (the checklist at 12.4 step 1)" with no number.
  - The only "13" statements are in -116 CR-1 b, -117's VERIFIED line and ledger row CR. Those are dated records, left as written (method note 8).
  - So there was nothing to restate. The checklist now holds 15 boxes, 2 ticked. 12.4's "**None is closed here.**" gains a dated note instead.
- **"`runbook_step_references.test.ts` and the other runbook tests read 12.4": no test read 12.4 before this change.** `runbook_step_references.test.ts` reads `docs/runbook-cloudflare-pages-beds-json.md` only. Every runbook test was re-run anyway.
- **"The facility-one count becomes 15 boxes, 2 ticked": holds.**

**THE GUARD, RED FIRST (method note 23).**
- **In the test file:** a plant per failure mode on the most ordinary valid register and checklist, and each plant is confirmed to have changed its input. The plants are:
  - (a): "Trigger", "BOX/TRIGGER" and "OPEN";
  - (b): an empty gate, "TBD", "?", "pending" and "**Pending**";
  - (c): a ruling no box carries; a bounded near-miss (-01 inside -013); a BOX row citing R1;
  - (d): a new unticked box; a BOX row changed to TRIGGER;
  - malformed rows with 3 and 5 cells, and one with no closing "|";
  - a missing separator.
  - The anti-vacuity plants are an empty register, a missing section, a wrong header, a step 1 with no boxes, and a missing 12.4 heading or step 2.
- **On the real files**, each plant was run through the accept leg and then restored byte-identical (sha256 checked). Each read red:
  - (a): the digit-less-code row's kind as "Box";
  - (b): the wrangler row's gate as "TBD";
  - (c): the sensor bundle's BOX row citing "-54 E". This also redded (d) for its box;
  - (d): box 14's row removed.

**ALSO IN THIS CHANGE:** `packages/design`, which the kickoff cites and D1 builds, is registered as a planned artefact in `tests/compliance/no_phantom_paths.test.ts`. That entry retires itself: its anti-rot leg reds when D1 creates the directory.

No SQL and no migration; nothing hosted was run by Claude Code.

### R-2026-09-26-122 — #86 held once: B1 becomes box 16, every deferral gains a gate, the fired triggers are ruled, and the guard gains (e)

_Issued as R-PROVISIONAL-2026-09-26-CX, by Cowork on 2026-09-26, as its check of #86 at `78bdc614968e136e4debf2a394252e42b2bf476e`. **Not the merge word.** It lands in #86 as a second commit on the same branch, with no force-push and no rebase. The founder's answer on CX-1 (b)'s mechanism, relayed by Cowork on the same day, lands with it. Number assigned on landing: R-2026-09-26-121 plus one. Next provisional letter: **CY**._

**VERIFIED BY COWORK** (2026-09-26, GitHub API, on the founder's machine):
- #86 OPEN at `78bdc61`, base `c20e635` (= main); clean; 5 files, +759/−3. Seven check runs success on `78bdc61`. No address on any added line.
- The committed kickoff's sha256 (`ef9f29be…91ee1`) and 17577 bytes equal Cowork's own copy.
- The diff was read in full.
- **ACCEPTED:**
  - the sweep's method;
  - the FIRED marking;
  - both premise corrections (there was no count to restate, and no test read 12.4);
  - the `no_phantom_paths` entry that retires itself in D1.

**CX-1 — B1 BECOMES BOX 16.** Cowork agrees with the finding and its cause.
- **(a) Box 16** is added at 12.4 step 1 in Cowork's words, with a register row of kind BOX.
  - Its citation reads "(B1, recorded 2026-09-14; made a box by R-2026-09-26-122 CX-1)". The ruling as issued had "R-2026-09-14 B1", which is not an id in this record's form: B1 is a section item recorded on 2026-09-14, not a numbered ruling. Written as an R- id, it would read like one that does not exist.
  - "Paperwork register item 8" is Cowork's statement about a register outside this repository, and the box says so.
- **(b) B1's onboarding check is two numbered 12.4 steps, not a box.** Its register row is TRIGGER, "the first ward account at facility one", and names both steps.
  - **The mechanism as issued could not run.** On hosted, "a real ward session reads `ward_status_history` over HTTP and gets 200" fails on three counts:
    - `api.openbed.ng`'s Worker does not forward `/rest/v1/rpc/ward_status_history`, so the call gets the Worker's own 404;
    - no app calls the function;
    - a ward's session is held only in the console's memory, so the founder never holds a ward's token.
  - **The founder's answer, via Cowork: SQL as the real ward.** Quoted in substance:
    - one transaction that ends in `rollback`: `set local role authenticated`, the JWT claims set to the new ward's account id (never its address), then a read from `public.ward_status_history`;
    - PASS is rows or an empty set with no 42501. FAIL is 42501 or any other error;
    - the id comes from the provisioning script's output, or from `app.ward_account` by facility and category, never from `auth.users` by address;
    - the check states in its own text that it does not prove HTTP reach;
    - **B1's 2026-09-15 wording is superseded by reference**, and the allow-list is NOT widened for a check;
    - **a second check** runs the real path end to end once facility one is listed.
  - **Landed as 12.4 step 6 (B1's check) and step 9 (the real path).** The old steps 6 and 7 become 7 and 8, and nothing cited them by number.
  - **Step 6's fence, demonstrated before it was written** (method note 23), on the local stack in a scratch run that removed its own row afterwards:
    - a ward account at its own facility read `claims_set t`, `history_rows 0` and `ROLLBACK`, exit 0;
    - an id with no account read `ERROR:  NOT_A_MEMBER`, which is 42501 (011:97), exit 1.
  - **The fence as written was then pasted into `zsh -f -i`,** with the `interactivecomments` counter-control: the same reading both ways, the sentinel reached, and every variable unset.
  - **Step 6 is a new psql fence,** so `tests/compliance/runbook_psql_path.test.ts`'s pinned count moves from 32 to 33, with a dated line in its header.
- **(c) The re-sweep, for the spellings the first pass missed.** Each hit was read in context.
  - Counts: "facility-one" 17; "facility #1" 0; "facility 1" 0; "first real facility" 1; "go-live" 6; "golive" 0; "launch" 13.
  - **B1 (section "Blocks facility-one onboarding" and its head's "before the first real facility"):** now box 16.
  - **-30 D1, the raw-echo "blocker for facility-one onboarding":** closed by -75 BC-2 (step 4b rows 1–4).
  - **-44 E, "must-fix before facility one … not post-facility-one":** closed by BC-2.
  - **-66's "the one change to insist on before launch", the count age:** shipped before facility one by -67 (PR 3.2b).
  - **-27's "product-safety rather than launch-polish":** the empty-city hazard, whose control shipped under -29 E2.
  - **Prose, with nothing deferred:**
    - -17-05's "launch cost";
    - -45's heading, "the go-live trigger becomes a row", which became step 4b and was closed by BC-2;
    - -100 CB-2's "first post-launch sprint kickoff", already the backstop of a TRIGGER row;
    - -116 CR-1 b and -117 CS-5's lists of variants;
    - -116's "no facility-one trigger";
    - -121's own text;
    - the ledger rows and the change log.
  - **No new "before facility one" item was found.**

**CX-2 — GATES FOR THE DEFERRALS THAT HAD NONE.** Each is now a register row with Cowork's gate:
- **TRIGGER:**
  - #63/#97;
  - #109;
  - the `scripts/` survey items;
  - -23-65 E;
  - -23-70 C3;
  - -23-71 C;
  - -24-97 BY-2 (e);
  - -19-19 B.
- **VERSION (v2 scoping):**
  - O2;
  - D4;
  - #115;
  - #71;
  - -20-30 A5;
  - -23-66 C2.
- **Premises checked:**
  - `app.referral.ward_reply` exists (005), and no app or package code touches referrals.
  - `packages/gate/`, `packages/snapshot/src/freshness.ts`, `scripts/lint_no_secrets.sh` and the `secret-scan` job all exist.
  - #115 is the strings module for the Yoruba/Pidgin pass (the v1 kickoff's item 5).
- **One row where the ruling gave a group.** "The `scripts/` survey items" are four in this record:
  - the PR evidence tables;
  - the digest's grants and RLS flags;
  - item 1, `<> 'NO'`;
  - item 2, SQL quoted in prose.

  Cowork's parenthetical named only the digest, so the one row names all four under the ruled gate.

**CX-3 — THE FIRED TRIGGERS, RULED.**
- **-21-38 D1, -21-41 B and -21-50 E2 are WORK,** in one small PR, **"F"**, after D1 and before D2, with each guard shown red first. -21-41 B becomes a guarded invariant over `supabase/config.toml`. Each row reads "FIRED; work in PR F" until F lands and removes it.
- **-21-43 C1 is CLOSED by this ruling.** The EVIDENCE gate was lifted by -47, and step 6 ran on its stated evidence. The row is removed.
- **-21-43 C3 is SUBSUMED by the clinicians' box (-67 A7),** whose threshold confirmation includes it. Its row becomes BOX, Ruling `R-2026-09-23-67 A7`.
- **-21-45 E is CLOSED by this ruling.** Its substance is carried by -71 C's host check and the SQL gates in 020–022, which are named here as the controls. The row is removed.
- **The favicon is resolved in D1, D2 and D3.** Each app ships the SVG icon AND a real `/favicon.ico` (or a `_redirects` or `_headers` rule, so that `/favicon.ico` is never the SPA's HTML), and the read-back asserts `/favicon.ico` is not `text/html`. This adds to the kickoff's D1–D3 scope, which is not edited. The row reads "FIRED; resolved in D1–D3".

**CX-4 — WHERE THE RECORD'S WORDS WIN OVER CW-5's:**
- **PITR:** -115 CQ-1's three limbs, verbatim. *The row already cited CQ-1, not CQ-4. Only its gate text changed.*
- **Agreement history:** gains "or earlier on the founder's word".
- **The contact-read audit:** "the first ruling or migration that permits a second PLATFORM_ADMIN; the audit row lands in that same change". The old trigger could never fire, because 022 refuses a second operator.
- **Per-ward rows vs the rollup:** CW-5's "30 days after facility one is listed" STANDS. "Until dispatcher validation" was a waits-for with no event.
- **The out-of-v1 list:** CW-5 stands.

**CX-5 — THE FIFTH ASSERTION.** `tests/compliance/deferred_items.test.ts` gains (e): a BOX row whose every box is TICKED fails, because a closed item leaves the register in the ruling that closes it. A ruling carried by one ticked box and one unticked box is still open, and is accepted. This supersedes -121's "Offered, not built", item 5.
- **Red first:** the plant (a fixture box ticked) failed against the guard before (e) existed, then read (e) and not (d).
- **On the real files:** box 1 ticked read `(e) … BOX row cites R-2026-09-25-108 CJ-2, and every box carrying it is ticked`, and the runbook was restored byte-identical (sha256 checked).
- **Also red first, on box 16 itself:** before its register row existed, the real files read (d) for it.
- The register's head now lists (e), with its old text kept.

**THE COUNTS.** They are recomputed from the table after the edit, not composed. The register holds **59 rows: 15 BOX, 33 TRIGGER, 11 VERSION**. The checklist holds **16 boxes, 2 ticked**; 12.4 gains a dated line saying so. The note of 2026-09-26 carried no count before. -121's CW-5 line gains a dated note and is not edited.

No SQL and no migration. Nothing hosted was run by Claude Code; step 6's fence ran only against the local stack.

### R-2026-09-26-123 — #86 re-checked and merged

_Issued as R-PROVISIONAL-2026-09-26-CY, by Cowork on 2026-09-26, as its re-check of #86 at `d02ae7e68976d15e8af206c95d8752b7d18aeaba`. **Pasting it was the founder's merge word for #86.** Record-only. It was held, and it lands in D1's pull request. Number assigned on landing: R-2026-09-26-122 plus one. Next provisional letter: CZ._

**VERIFIED BY COWORK** (2026-09-26, GitHub API, on the founder's machine):
- #86 OPEN at `d02ae7e`, base `c20e635` (= main); clean; 2 commits.
- The compare `78bdc61...d02ae7e` is 1 ahead and 0 behind, so there was no force-push.
- The second commit touches 4 files, +218/−20, and was read in full. Seven check runs success on `d02ae7e`. No address on any added line.

**ACCEPTED, all of CX as landed:**
- box 16's citation as "(B1, recorded 2026-09-14; …)";
- steps 6 and 9, the renumbering of 6–7 to 7–8, and the "does NOT prove HTTP reach" paragraph;
- step 6's fence, demonstrated both ways and paste-tested before it was written;
- the re-sweep's counts and dispositions;
- CX-2's 14 rows, with the `scripts/` survey as one row of four;
- CX-3, CX-4 and CX-5, including (e)'s mixed-box refinement;
- `runbook_psql_path`'s pin moving from 32 to 33;
- the counts, recomputed from the table: 59 rows (15 BOX, 33 TRIGGER, 11 VERSION), and 16 boxes, 2 ticked.

**CY-1 — THE MERGE.**
- The head was read from the API as `d02ae7e68976d15e8af206c95d8752b7d18aeaba`, and #86 merged as a merge commit with `--match-head-commit` on that value.
- MERGED was read back: **`495ad0aba02d155ab0781ceaf089cd401ca5912f`**, with parents `c20e635169ac55e9efb2884c409407db2da132a2` and `d02ae7e68976d15e8af206c95d8752b7d18aeaba`.
- As a separate step, after MERGED was read, `design-pass-d0` was deleted on the remote. The local `git branch -d` refused at first, because local `main` had not yet been fast-forwarded. After `git merge --ff-only origin/main` and a `merge-base --is-ancestor` check, it succeeded. No force-delete was used, and both sides read back as gone.

**CY-2 — WHAT FOLLOWS:** D1 starts from the new `main`, per the kickoff, plus CX-3's favicon. The order is D1, then F, then D2, then D3. Nothing hosted for #86.

### R-2026-09-26-124 — D1 may start; the design foundation and the public dashboard, as built

_Issued as R-PROVISIONAL-2026-09-26-CZ, by Cowork on 2026-09-26, as its read-back of #86's merge. It lands in D1's pull request, which it starts. Number assigned on landing: R-2026-09-26-123 plus one. Next provisional letter: DA._

**VERIFIED BY COWORK:**
- #86 is merged, with merge commit `495ad0a` and parents `c20e635` and `d02ae7e`;
- `design-pass-d0` reads 404, `main` is at `495ad0a`, and no PR is open.

**ACCEPTED:** the local `-d` refusing before the fast-forward and succeeding after it.

**CZ-1:** D1 starts from `main` at `495ad0a`, per the kickoff's bundle D1, plus CX-3's favicon for this app, with the test plan first.

**CZ-2 — THE REMINDERS, AND WHAT LANDING DID WITH EACH:**
- **Every visible sentence stays byte-identical.** `tests/compliance/dashboard_ward_row_identity.test.ts` renders the real page over one fixture holding every tone and band. It asserts that each row's `textContent` equals `wardLine(...).text` exactly. The existing exact-text dashboard tests pass unchanged. The only new visible text is what the kickoff requires: the "OpenBed" lockup and the footer's hello@ address.
- **Fonts are self-hosted, and there is no Google origin.** They come from `@fontsource/public-sans` and `@fontsource/ibm-plex-mono` 5.3.0, both checked on the registry before they were added (OFL-1.1, the fontsource organisation, about 116k and 1.6M downloads a week; the lockfile's integrity matches the registry). The guards were shown red first. The ward console and admin legs are PENDING legs, not `todo` (-125 DA).
- **The `packages/design` entry is deleted** from `PLANNED_ARTEFACTS`, in the change that creates the directory.
- **`a.call` declares literal px** (`min-height: 52px`), and its plant now replaces `52px`.
  - **A premise did not hold.** The kickoff's blast radius said a stale plant "plants nothing and passes vacuously". It does not: that test asserts that its plant reached the rule. Run against the new CSS with the old plant, it read RED: "the plant did not reach the rule: expected 52 to be 40". The instruction survives.
- **No browser runner was added.** The screenshots use the Mac's installed Google Chrome, driven over the DevTools protocol by Node's built-in WebSocket. So -23-70 C3's trigger does not fire, and its register row is unchanged.
- **The screenshots are in `.design-screens/D1/`,** gitignored and with an ESLint ignore to match.
  - States: tiles covering every tone and band, unknown age, snapshot-stale, empty, and outage.
  - Sizes: each at 360×740 and 1280×900, plus a full-page capture at each width.
  - The harness that took them is beside them. It serves the real build with the tracked CSP applied, from synthetic fixtures only.

**THE BUILD (what D1 landed):**
- **`packages/design` (`@openbed/design`):**
  - **`tokens.css`:** the design system's six token files, copied byte for byte in the order of its `styles.css`, each under a header naming it and its sha256. The sha256 of each source file, read from `~/Documents/Claude/Projects/BedSpace/Site/_ds/openbed-design-system-0bbddfb2-f166-4e0c-92b1-484a08440e3b/tokens/` on 2026-09-26:
    - `colors.css` `f4eace8408c7e822547090ec45900f603f8087a12c04c1866d14128cc267a6c8`;
    - `typography.css` `066c39948bcc139779ce6e20197f1b1e893df9b41daca908c02c96c7455f0430`;
    - `spacing.css` `2cf2ffddbaf9dafb2d55d0c9e844bdaf78bd374ad94e673cf28f19875467e65e`;
    - `surfaces.css` `a31ddef7c358099de54aef5207490e042e6ce0b612b41229ca644ddcb56dbeaa`;
    - `motion.css` `e4979114e041e614bf05461f1a633f0ab6e3f2fa8786d984992f68c4f2a6cad4`;
    - `base.css` `af85fa2eb2be8a89d0def18247aa9292df3333a873cbfb7139fe10b20ebbd533`.

    Its `fonts.css`, which `@import`s Google Fonts, is not copied.
  - **`fonts.css`:** six faces (Public Sans 400/600/700, IBM Plex Mono 400/500/600), woff2 only, the latin subset, `font-display: swap`.
  - **`openbed-mark.svg`:** the kickoff's geometry. **A premise did not hold:** the kickoff says "the brand sheet's mark, verbatim", but no copy of the mark exists on disk. The design system's `assets/` folder is absent, and the path appears only in the kickoff. The kickoff's quoted geometry is therefore the source, and `tests/compliance/design_package.test.ts` pins it byte for byte.
  - **`NOTICE`** gains both OFL-1.1 attributions.
- **The public dashboard:**
  - **The page order,** as ruled: the emergency strip (`--ob-emergency-bg`, `tel:` links 44 px), the indicative banner, the header (the mark at 28 px and the live-text lockup), the snapshot banner, the tiles, and the footer (the hello@ address only, read from `packages/origins/contacts.json` through a new `packages/origins/src/contacts.ts`).
  - **The call link** is 52 px, full width, navy, with the number in mono.
  - **Ward rows** hold the category, a count badge and the age stamp in mono.
  - **The colour rule, exactly as ruled:** a status fill only while the band is GREEN. Available means accepting with a count above 0; Full means not accepting, or 0. Everything else takes the not-reporting fill, and "Limited" is never used. The stamp takes the band's colour, and there is a static dot on GREEN only.
  - **Empty, outage and snapshot-stale** render as Notices, and the snapshot banner keeps `role="status"`. There is a focus ring on every interactive element.
  - **`public/favicon.ico`** is a real ICO, generated from the mark with macOS `sips` (SVG to PNG to ICO, 32 px).
  - **`assetsInlineLimit: 0`,** so that no asset is inlined as a `data:` URI, which the CSP would refuse for a font.
- **Token names that did not exist, and their nearest real names:**
  - there is no "amber" freshness token, so the YELLOW stamp uses `--ob-fresh-yellow`;
  - there is no "not-reporting" status token, so that fill is `--ob-status-unknown*`.
- **How the rows are split into pieces.** `wardLine` returned only `{text, tone}`. D1 adds `wardLineParts`, which returns the segments, band and status, and `wardLine` is now those segments joined. The li keeps exactly `age-<tone>` (`dashboard_age.test.ts` reads it). The styling hooks sit on spans whose class names carry no digit, because a suppressed row's markup must hold none.
- **Caught by an existing guard while building:** `contacts.ts` first default-imported `contacts.json`. Vite bundles a JSON default import whole, so the ward-support address reached the dashboard's bundle. `tests/compliance/ward_support_contact.test.ts` read red ("the ward support address reached apps/public-dashboard"). It is now a named import of `hello` only. The built bundle carries `hello@` once and `support@` not at all.
- **The dashboard's import closure now reaches `origins`, through `./contacts` only.** `packages/fixtures/per-app.json` records this, and its comment is restated with the old text kept. `tests/compliance/tracked_origins.test.ts` still holds the dashboard's bundle to no API origin, and it passes.

**THE GUARDS, EACH SHOWN RED FIRST:**
- **In `bundle_guards.test.ts`, "the design is applied, and stays applied"** (helpers in `tests/compliance/_design.ts`):
  - **The checks:**
    - the viewport meta, parsed by attributes;
    - the built CSS carries `--ob-navy-700` and an `@font-face` whose every src is a same-origin woff2 that exists in the build;
    - no inline style in any app's source (`style=`, `.style`, `setAttribute('style')`), with TypeScript parsed rather than grepped;
    - no Google font host in any app's source or in `packages/design`.
  - **Each app is classified real or PENDING,** and the classification is compared by identity with the derived app set.
  - **Red on the real files,** each restored byte-identical:
    - the dashboard's viewport removed;
    - the dashboard built without the design imports ("no built CSS file holds an @font-face");
    - `.style.color` set in the dashboard's `main.ts`.
  - **A parser gap the plants found:** a `data:` URL carries `;` inside its `url()`, and the first parser cut the `src` value there. It now reads to the first `;` outside parentheses.
- **`tests/compliance/dashboard_ward_row_identity.test.ts`:**
  - red on the real renderer with one space added between the spans;
  - red with a YELLOW claim coloured available: "a status fill on a claim that is not fresh -- a green badge on a stale count reads as \"go\"".
- **`tests/compliance/design_package.test.ts`:** the token sections re-hashed against their headers, the six font faces, the mark, the exports map, the favicon's ICO bytes and their copy in the build, and NOTICE.
- **`scripts/readback_pages.sh`:**
  - `/favicon.ico` on both hosts must equal the tracked icon byte for byte, and must not be `text/html` (CX-3);
  - the page's stylesheet and one woff2 it names must be served as exactly `font/woff2`.

  The six new plants in `readback_scripts.test.ts` were red against the script as it stood on `main`. The Pages runbook says what the script now checks, and what the browser check after the first D1 deploy looks for.

Nothing hosted was run by Claude Code. **The first hosted run of the favicon and font checks is the founder's deploy after this merges.**

### R-2026-09-26-125 — the ward-console and admin guard legs are PENDING legs, not todo

_Issued as R-PROVISIONAL-2026-09-26-DA, by Cowork on 2026-09-26, in answer to the implementer's question (a vitest `test.todo` is written to junit as skipped, and the SOP calls a net-new `.todo` in a guard the cardinal sin). It lands in D1's pull request. Number assigned on landing: R-2026-09-26-124 plus one. Next provisional letter: **DB**._

- **DA-1: neither `test.todo` nor `test.fails`.** Each ward-console and admin leg is a plain test asserting the app's CURRENT, specific state, titled "PENDING D2:" or "PENDING D3:". Its failure message reads: "this app now meets the guard — replace this leg with the real guard in this PR".
  - **Why not `test.fails`:** it passes whenever the test throws for ANY reason, so it can pass vacuously.
  - **Landed:**
    - `PENDING D2: apps/ward-console/index.html has no viewport meta`;
    - `PENDING D2: apps/ward-console's built CSS carries neither --ob-navy-700 nor an @font-face`;
    - `PENDING D3: apps/admin's built CSS carries neither --ob-navy-700 nor an @font-face`.
  - Admin already has the viewport meta, so its viewport leg is real now.
- **DA-2: each pending leg can still fail for the reason it names.** Shown on plants and on the real files:
  - the ward console given a viewport meta read "this app now meets the guard — replace this leg with the real guard in this PR (D2; R-2026-09-26-125 DA)";
  - admin's CSS given the token read the same, for D3.

  A missing `index.html` or build output throws, which is an ERROR, never a pass. The attestation stays at skipped=0.
- **DA-3:** the register gains two TRIGGER rows: the ward console's design guards, gated on D2's PR, and admin's, gated on D3's. After -125 the register holds 61 rows: 15 BOX, 35 TRIGGER and 11 VERSION, recomputed from the table. The favicon row stays until D3, and records that D1 is done.
- **DA-4:** the kickoff's "marked todo" is superseded by reference, not edited.

### R-2026-09-26-126 — #87 held once: a stale page asserts nothing as live; a qualified or countless claim is not coloured; the count is subordinate to the phone

_Issued as R-PROVISIONAL-2026-09-26-DB, by Cowork on 2026-09-26, as its check of #87 at `1b4e299a4d9b52e404f47dcfa0f9e13d25ddb2bb` and of the screenshots on the founder's Mac. **Not the merge word.** It lands in #87 as a second commit on the same branch, with no force-push and no rebase. The founder's answer on DB-3's size order, relayed by Cowork the same day, lands with it. Number assigned on landing: R-2026-09-26-125 plus one. Next provisional letter: **DC**._

**VERIFIED BY COWORK** (2026-09-26, GitHub API and the screenshots):
- #87 OPEN at `1b4e299`, base `495ad0a` (= main); clean; 1 commit, 29 files, +1635/−47. Seven check runs success. No address beyond the three published ones.
- Screenshots read:
  - tiles at 360 full and at 1280;
  - empty at 360;
  - snapshot-stale at 360;
  - outage at 1280;
  - unknown-age at 360.

**ACCEPTED:**
- the token copy with its hashes;
- @fontsource 5.3.0, OFL, NOTICE;
- the page order;
- the Notices for empty, outage and unknown, and the grey unknown-age rendering;
- the identity test, the PENDING legs, and the favicon and woff2 read-back legs;
- the contacts leak caught by the gate and fixed at its import;
- -124's four premise corrections.

**DB-1 — A STALE PAGE ASSERTS NOTHING AS LIVE (safety).**
- **The rule.** While `snapshotBanner(...)` is not null, whether the page is stale or "can't confirm": every badge takes the not-reporting fill, no freshness dot renders, and every stamp is neutral, whatever the row's own band. No word changes.
- **Why.** The "snapshot-stale" screenshot showed green badges, dots and stamps under a banner saying counts may be out of date. That is the contradiction the design system forbids (its readme, line 154: "The only living element is the freshness dot, and it only exists when" a snapshot is current).
- **Landed as follows:**
  - `renderReal` now computes the banner **before** the rows;
  - one exported rule, `rowStyle(parts, pageStale)` in `apps/public-dashboard/src/age-view.ts`, decides each badge's fill and stamp colour;
  - the dot is CSS on `.stamp-green` only, so a neutral stamp has no dot.
- **Tests:** two legs render the stale page (generated ten minutes before it was served, every row fresh by its own band) and the can't-confirm page (no serve time). Each asserts no status fill, no `.stamp-green` and every stamp `stamp-grey`, with the words unchanged.
- **Red first, on `1b4e299`'s renderer:**
  - six "a status fill under the stale banner" lines;
  - and "a fresh stamp (and its dot) under the stale banner" on every fresh row.

**DB-2 — A QUALIFIED CLAIM IS NOT COLOURED.**
- **The rule.** Available or Full now also requires `precedence(...).qualifiers` to be empty. The qualifiers come only from ADMIN ("set by admin, not ward-confirmed") and UNDER_REVIEW ("under review") in `packages/labels/src/index.ts`, so "any other" is covered by the empty-string test.
- **Tests:** rows for ADMIN only, UNDER_REVIEW only (at 0 beds, which would otherwise be Full) and both.
- **Red first:** "expected one badge with status-unknown, found badge status-available" (twice) and "… found badge status-full".

**DB-3 — THE COUNT IS SUBORDINATE TO THE PHONE NUMBER** (v1:243: "The bed count is visually subordinate to the phone number"). The kickoff's `--text-count-lg` for the badge was Cowork's error, and it is superseded by reference; the kickoff is not edited.
- **A slip, Cowork's, superseded by the founder's answer and not edited.** DB-3 said the phone "stays the largest text in the tile after the facility name". That contradicted its own 20px against the 18px `--text-heading` of the facility name.
- **The founder's answer, via Cowork:** the name goes to `--text-title` (600 24px), the phone stays mono 600 at 20px, and the badge is `--text-count-md` (500 18px). **Name 24 > phone 20 > badge 18**, at both widths. The record's rule holds either way.
- **Landed.** The three rules declare literal px (`font-size: 24px`, `20px`, `18px`), because the guard compares them and cannot read a `var()`.
  - **The guard:** `sizeOrder` and `sizeOrderViolations` in `tests/compliance/dashboard_identity_and_call.test.ts` assert name > phone > badge.
  - **Plants, one per inequality:** the count raised to 28px, the phone lowered to 16px, and the name lowered to 18px.
  - **Anti-vacuity:** a size given through `var()` reads null and fails.
  - **Red first on `1b4e299`'s CSS:** "a rule declares no literal font-size in px: name null, phone null, badge null".
- **A long facility name wraps cleanly** (`overflow-wrap: anywhere`). "Synthetic Lagos State University Teaching Hospital" is in the screenshots, as the founder asked.

**DB-4 — THE NO-COUNT ROW.**
- A row that claims no count gets a neutral stamp and no dot, whatever its band. `WardLineParts` gains `hasCount`, and `rowStyle` reads it.
- The non-claim rows (not reporting, not offered, unknown, suppressed) already had no stamp.
- **Red first:** "row "fresh, never reported a count": expected one stamp-grey, found stamp stamp-green".
- **Recorded, not ruled:** DB-2 removes the fill from a qualified fresh claim, but not its dot, because DB-2 names the fill only. A qualified fresh row therefore keeps its green stamp and dot. It is in the screenshots for Cowork to see.

**DB-5 — LAYOUT.**
- **(a)** Below 600px the stamp is `display: block` on its own line under the claim, so a short stamp never breaks mid-phrase. The textContent is unchanged, and the identity test proves it.
  - **A limit that remains:** the longest GREY stamp ("last reported at 26 Sept, 11:12 (Lagos time) — call to confirm", about 64 mono characters, about 460px at 12px) is wider than the roughly 296px inside a 360px tile. It still wraps within its own line, at word boundaries. Removing that would mean shorter words or horizontal overflow.
- **(b)** The header's contents sit in `.site-header-inner`, in the same 960px centred column as the content, with the same gutter inside it. The bar stays full width. No text change.
  - **The first attempt was 24px off at desktop width.** It gave the box its width but not `main`'s inner gutter. I found this reading my own 1280 screenshot, before any review, and fixed it in a third commit.
  - **Measured by the harness, not judged by eye:** the lockup's left edge equals the first content block's, at 16px at 360 and 184px at 1280, in every state.

**DB-6 — A WORDING NOTE FOR THE CLINICIANS' BOX,** with no word changed. "<ward>: not yet reporting — updated N min ago" reads as a contradiction.
- **A premise that holds only in part.** The ruling said to add the note as "one line under that box's register row". A line there would end the table, and **`parseRegister` stopped at the first line that is not a row, so every register row below it would have been silently dropped from the guard.** That is a gap in the guard itself.
- **The note** therefore sits inside the A7 row's Item cell.
- **The parser is tightened:** any row after the table has ended is now a violation, "a table row after the table ended". Its plant, a note line under the first row, was shown red with the new check disabled, then green with it.

**THE REGISTER:** 61 rows, unchanged in number (DB-6 is a note inside a row, not a row).

**SCREENSHOTS** were re-taken from the new head's clean build, with the same harness and the real CSP, for every state at 360 and 1280 and full page. The fixture gains an ADMIN-only row, an UNDER_REVIEW-only row, and a third facility with the long name.

No SQL and no migration; nothing hosted was run by Claude Code.

### R-2026-09-26-127 — #87 once more: a qualified claim is not shown as live; amber stays

_Issued as R-PROVISIONAL-2026-09-26-DC, by Cowork on 2026-09-26, as its re-check of #87 at `13e9e88fc80677950e3cd05ef0461c02457bcec2` and of the screenshots on the founder's Mac. **Not the merge word.** It lands in #87 as a fourth commit on the same branch, with no force-push. The founder's answer on the stamp colours, relayed by Cowork the same day, lands with it. Number assigned on landing: R-2026-09-26-126 plus one. Next provisional letter: **DD**._

**VERIFIED BY COWORK** (2026-09-26, GitHub API and the screenshots):
- #87 OPEN at `13e9e88`, base `495ad0a` (= main); clean; 3 commits.
- The compare `1b4e299...13e9e88` is 2 ahead and 0 behind, so there was no force-push.
- Seven check runs success. No address beyond the three published ones.
- Screenshots read: tiles at 360 full and at 1280, and snapshot-stale at 360 full.

**ACCEPTED:**
- DB-1 to DB-5 as landed, including the header measured at 16px and 184px;
- DB-6's note inside the A7 row;
- **the register parser now refusing a table cut short by a non-table line.** Cowork recorded this as a real fail-open in CW-6's guard, found and fixed at its cause, and as the implementer's finding;
- the long-name fixture;
- long stamps wrapping at word breaks on their own line at 360, as is.

**DC-1 — A QUALIFIED CLAIM IS NOT SHOWN AS LIVE.**
- **The rule, as corrected by the founder via Cowork:** "The status fill, the dot and a GREEN stamp appear only on a GREEN-band, unqualified row with a count, on a page with no stale banner. Amber marks the YELLOW band wherever the page is not stale. Everything else is neutral."
- **A slip, Cowork's.** As issued, DC-1 restated the rule with "a coloured stamp". Read literally, that would also have greyed every amber YELLOW stamp, which neither the kickoff's D1 ("green, amber or grey") nor DC-1's own first sentence said. The implementer asked, and the founder answered **amber stays**. A qualified YELLOW row keeps amber too, because amber warns and never signals "live". The line above supersedes the wording; it is not edited.
- **Landed.** `WardLineParts` gains `qualified`. `rowStyle` gives a qualified GREEN claim a grey stamp, and so no dot. A YELLOW claim stays amber, qualified or not. DB-1 is unchanged: under the stale banner every stamp is grey, amber included, and the stale-page leg already asserts it.
- **Tests:**
  - the three qualified GREEN rows now expect a grey stamp;
  - a new row, "ageing (YELLOW), set by admin", expects amber and the not-reporting fill;
  - a plant, a qualified fresh claim stamped green, is rejected.
- **Red first, on `13e9e88`'s renderer:** "expected one stamp-grey, found stamp stamp-green" for "fresh, set by admin and under review", "fresh, set by admin" and "fresh, under review". The qualified YELLOW row already read amber.

**DC-2 — THE LEDGER.**
- DB's row is already here (-126), and DC's lands as -127.
- **A premise that did not hold:** DC-2 names "DD's ledger row". DD has not been issued, so it has no row to land. By the ledger's own rule, a letter with no row has not arrived. If DD is issued before #87 merges, its row lands then.
- The tiles screenshots were re-taken at both widths from the new head's clean build; the harness re-takes every state.

No SQL and no migration; nothing hosted was run by Claude Code.

### R-2026-09-26-128 — #87 re-checked and merged

_Issued as R-PROVISIONAL-2026-09-26-DD, by Cowork on 2026-09-26, as its re-check of #87 at `b76d711c549efde3fccdbfb97550f8175bd9405e`. **Pasting it was the founder's merge word for #87.** Record-only. It was held, and it lands with PR F. Number assigned on landing: R-2026-09-26-127 plus one. Next provisional letter: DE._

**VERIFIED BY COWORK** (2026-09-26, GitHub API and the screenshots):
- #87 OPEN at `b76d711`, base `495ad0a` (= main); clean; 4 commits.
- The compare `13e9e88...b76d711` is 1 ahead and 0 behind, so there was no force-push.
- Seven check runs success. No new address.
- The code change was read in full: `qualified` is derived from `precedence(...).qualifiers` and is false on the no-count and SUPPRESSED paths; `rowStyle` greys a qualified GREEN stamp and leaves YELLOW amber; `pageStale` still wins.
- `tiles-1280xfull` was read: green, the dot and a green stamp appear only on the unqualified fresh counts.

**ACCEPTED:** DC-1 as corrected, and -127's two premise notes.

**DD-1 — THE MERGE.**
- The head was read from the API as `b76d711c549efde3fccdbfb97550f8175bd9405e`, and #87 merged as a merge commit with `--match-head-commit` on that value.
- MERGED was read back: **`5be63d4bf6d3a12f647e295bbcef1924f883a334`**, with parents `495ad0aba02d155ab0781ceaf089cd401ca5912f` and `b76d711c549efde3fccdbfb97550f8175bd9405e`.
- As a separate step, after MERGED was read, local `main` was fast-forwarded with `git merge --ff-only origin/main`. `design-pass-d1` was then deleted on the remote and locally, and both read back as gone.

**DD-2:** box 14 stays OPEN. It closes only after D2 and D3 are deployed and the founder approves all three in the browser.

**DD-3:** nothing hosted by Claude Code. The founder deploys the public dashboard and runs its read-back and browser check (-129). Then PR F, then D2, then D3.

### R-2026-09-26-129 — the public dashboard deployed at 5be63d4 and read back PASS; PR F starts

_Issued as R-PROVISIONAL-2026-09-26-DE, by Cowork on 2026-09-26, from the founder's pasted terminal output, read in full. It lands in PR F. Number assigned on landing: R-2026-09-26-128 plus one. Next provisional letter: DF._

**VERIFIED BY COWORK:**
- **The checkout:** deployed from `~/Desktop/OpenBed-NG-deploy`, detached at `origin/main` `5be63d4`. `npm ci`: 0 vulnerabilities. The tree was clean, and the stamp read back `5be63d4`, clean.
- **The deployment:** `https://f56ae2af.openbed-public-dashboard.pages.dev`, 12 files. No 429 at `GET /accounts`, so the wrangler-429 trigger ("a second occurrence") has NOT fired.
- **`readback_pages.sh`: PASS**, covering:
  - read-backs 4 (commit `5be63d4`, dirty false, ancestor 0), 6, 7 and 8;
  - the page's headers and scripts on both hosts;
  - the favicon on both hosts, byte for byte, `image/vnd.microsoft.icon`;
  - a self-hosted font (6 woff2, the first `public-sans-latin-400`, 200, `font/woff2`);
  - the serve-time stamp.
- **The founder's browser check:** all checks passed.

**DE-1 — THE DEPLOY IS RECORDED** in `docs/runbook-cloudflare-pages-beds-json.md`'s run records, as "Run on 2026-09-26".
- **CLOSED:** the open item that the new read-back checks had not yet run against hosted (noted at -120 CV, and in that runbook's D1 paragraph, which is restated).
- **The public dashboard's part of box 14 is DONE,** and runbook 12.4 box 14 gains a dated progress line. **Box 14 itself stays OPEN** until D2 and D3 are deployed and the founder approves all three.

**DE-2 — PR F starts** from `main` at `5be63d4`, per R-2026-09-26-122 CX-3:
- three guards, each shown red first on a plant AND on the real files where that applies;
- each lands with its register row removed.

**DE-3:** DD (-128) and DE (-129) land in F with their ledger rows. The full suite and the commit gate run, then STOP at the open PR. Nothing hosted.

### R-2026-09-26-130 — PR F's terms: F3 at full scope with two named exemptions; E2's "touching" and "blank" defined

_Issued as R-PROVISIONAL-2026-09-26-DF, by Cowork on 2026-09-26, in answer to the implementer's question on the F3 scope and the E2 terms. It lands in PR F. Number assigned on landing: R-2026-09-26-129 plus one. Next provisional letter: **DG**._

**DF-1 — THE F3 ESLINT DATE GUARD (-21-38 D1): FULL SCOPE, TWO NAMED EXEMPTIONS.**
- **The rule.** The spec (the v2 kickoff, "The F3 guard, specified to implement") bans `Date.now()`, a no-argument `new Date()`, `Date.UTC` and `performance.timeOrigin` in `apps/**/*.ts`, `apps/**/*.tsx` and `packages/snapshot/src/**/*.ts`. It was written on 2026-09-10, before two deliberate clock reads that sit inside that scope:
  - the Function's `x-openbed-served-at` stamp in `packages/snapshot/src/serve.ts`;
  - the ward console's `p_composed_at` in `apps/ward-console/src/main.ts`.
- **Landed as `openbed/no-wall-clock`,** a local plugin rule in `eslint.config.mjs`, at severity error, scoped exactly as the spec writes it.
  - **Why its own rule id.** Flat config replaces a rule's options per block. A second `no-restricted-syntax` block would have silently dropped F2's duty-flag selectors, and a line exemption naming `no-restricted-syntax` would switch F2 off on that line too.
  - **The two exemptions** are `eslint-disable-next-line openbed/no-wall-clock -- OPENBED-CLOCK-READ: <ruling>`.
- **A premise that did not hold.** DF-1 b said to cite "the ruling that set that window" for the ward console. No `R-` ruling set it: the symmetric STALE/FUTURE_MUTATION window was a task in the v2 kickoff's Stage 2 (its "A symmetric `composed_at` window"), built in migration 014. So the exemption cites **R-2026-09-26-130 DF-1 b**, the ruling that makes it an exemption, and names the window's real source in its reason.
- **`tests/compliance/eslint_wall_clock.test.ts`:**
  - **Plants, one per ban**, and the coercion form (`+new Date()`).
  - **Positive controls:** `new Date(iso).toLocaleString('en-NG')`, `Date.parse` and `performance.now`.
  - **Accept:** the real scope lints with no hit, and the linted files include `packages/snapshot/src/freshness.ts`.
  - **Anti-vacuity:** a scratch tree with a control file lints one file and hits, then without it lints none.
  - **DF-1 c, the pinning.** The exempted set must equal exactly the two, matched by FILE and REASON STRING and never by line. It is refused for:
    - a third exemption;
    - one without the marker or a ruling id;
    - a disable naming another rule too, or naming none;
    - a file-wide or block `eslint-disable`;
    - an `eslint-disable-line`.

    The comments come from a real TypeScript parse. A first draft used a bare scanner, which lost the ward console's comment behind a mis-tokenised stretch of `main.ts` (method note 17, observed).
  - **DF-1 d, that CI lints these files:**
    - repo-lint runs `npx eslint .`;
    - no scoped file is ignored;
    - the resolved config carries the rule as an error for each scoped file, and not for an unscoped one.
- **Red first (DF-1 e), on the branch:**
  - the rule on the real tree before the disables reported exactly the two call sites, `apps/ward-console/src/main.ts:299` and `packages/snapshot/src/serve.ts:468`;
  - a third exemption planted in `apps/public-dashboard/src/main.ts` read "an exemption that is not one of the two DF-1 b rules", and the file was restored byte-identical.
- **Comments made true,** with their old text kept: `serve.ts` ("THERE IS NO SUCH RULE"), `anchor.ts` ("the ESLint rule arriving in Stage 3") and `freshness_bands.test.ts` ("the Stage 3 ESLint rule's job").
- **NOT ASSERTED, and reported:**
  - an alias (`const D = Date; D.now()`, or `p.timeOrigin` after `const p = globalThis.performance`) evades an AST rule;
  - `Date()` called without `new` also reads the clock, and the spec does not name it. DF-1 a keeps the bans exactly as written, so it is left for Cowork to rule.

**DF-2 — THE E2 MIGRATION-TEMPLATE LINE (-21-50 E2): ANY PATH; A BARE "none" FAILS.**
- **(a) Touching:** any added, modified, deleted or renamed path under `database/migrations/`, including `.down.sql` and `applied-hosted.json`.
- **(b) Blank:** after stripping HTML comments, the line "Runbook expectations this migration changes:" is missing, has nothing after it, or is "none" without "because <reason>". A null or empty body on a touching PR is blank.
- **(c) Triggers:** `pull_request` types `[opened, synchronize, reopened, edited]`. The body reaches the script only through env.
- **Landed:**
  - **`scripts/check_pr_migration_line.mjs`**, run as a step in repo-lint with `if: github.event_name == 'pull_request'` and `env: PR_BODY`. It is a step, not a new job, so the job set stays at seven, no job-level `if` is added, and there is no branch-protection change. repo-lint's checkout fetches two commits.
  - **Why the script runs git itself** (`--from-git`, `git diff --name-only --no-renames HEAD^1 HEAD`) rather than reading a pipe: GitHub's default shell has no pipefail, so a failed `git diff | node` would hand it an empty list, and that would read as "not touching". A git that cannot run is an ERROR, exit 2.
  - **`tests/compliance/pr_migration_line.test.ts`:**
    - the plants from DF-2 b, and the `.down.sql`, `applied-hosted.json` and rename-out cases;
    - accepted: sections, "none, because", and a non-touching PR with a blank body;
    - the could-not-run and usage ERRORs;
    - `ci.yml` pinned: the types, the step, `--from-git`, `fetch-depth: 2`, and no `${{ github.event.pull_request.body }}` in any `run:`.
- **Red first (DF-2 d):** all but two of the test's legs failed before the script existed. Run directly against a touching change: the template's blank line read `FAIL: blank line …` (exit 1), a bare "none" read `FAIL: bare none …` (exit 1), and "none, because 024 changes no hosted reading" read `ok: … answered` (exit 0).
- **Legs:** six new legs, all reached. `legs_total` 317 → 323, reached 291 → 297, registered 26. Two message drafts were rewritten so each leg has its own identity: two could-not-run messages had shared one tail, and "could not read" would have nested two lint scripts' legs.

**AND THE THIRD F ITEM (-21-41 B), as scoped by CX-3: THE AUTH HOOKS STAY OFF,** now a guarded invariant.
- `tests/compliance/auth_hooks_off.test.ts` reads `supabase/config.toml` with a reader that sees only uncommented table headers. Every live `[auth.hook.<name>]` must say `enabled = false`.
- **Plants:** `custom_access_token` enabled, `before_user_created` enabled, and a live hook table with no `enabled` key.
- **Red on the real file:** with the `custom_access_token` block uncommented, it read "[auth.hook.custom_access_token] is live with enabled = true"; the file was restored byte-identical.
- It lives in compliance, not `config_drift` (db), because it needs only the file. `config_drift`'s header "four keys" is restated to six, with the old text kept.

**THE REGISTER:** the three "FIRED; work in PR F" rows (-21-38 D1, -21-41 B and -21-50 E2) are removed in this change. **58 rows remain,** recomputed from the table.

No SQL and no migration; nothing hosted was run by Claude Code.

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
| — (none issued) | R-2026-09-21-45 | 2026-09-21 | A direct founder instruction following AA: the go-live trigger becomes a row, and moves onto the path that creates it. |
| — (none issued) | R-2026-09-21-46 | 2026-09-21 | **No provisional letter.** The founder's PR freeze, issued on merging #60: T A4 restated after seven pull requests in one day. The drift's cause is recorded as the implementer's. |
| — (none issued) | R-2026-09-21-47 | 2026-09-21 | **No provisional letter.** The founder's EVIDENCE-gate read-back on deployment `76fe917`. All four observations pass; 018 unblocked; AA closed in production rather than only on `main`. |
| — (none issued) | R-2026-09-21-48 | 2026-09-21 | **No provisional letter.** The two decisions 018 was carrying unanswered — the empty allowlist and the exact reversal — plus the pre-condition the founder set before the migration could be written. |
| AB | R-2026-09-21-49 | 2026-09-21 | The ESLint ignore gap on wrangler build output, moved from an open item with an unreachable trigger to a named change. First letter after AA; I and O stay skipped. |
| AC | R-2026-09-21-50 | 2026-09-21 | The runbook was not restated for 018 — the restate rule failing on the change that added the migration. Widened past section 5, one quarter of it mechanised, and named as an exception to the -46 freeze. |
| AD | R-2026-09-21-51 | 2026-09-21 | The founder's review of #62: five defects, two blocking, all mine. The restatement had repeated the defect it was fixing — a fifth expectation site, the stop condition, left contradicting the other four. |
| — (none issued) | R-2026-09-22-52 | 2026-09-22 | **No provisional letter.** The founder's own hosted apply of 018, quoted in full, with the instruction to write the apply record. The accumulation boundary closed at 05:40:40 UTC. First ruling dated 2026-09-22. |
| AE | R-2026-09-22-53 | 2026-09-22 | The placeholder derives instead of being carried, on a finding from R-2026-09-22-52. **First ruling recorded on a pushed holding branch with no pull request** — record-only under R-46, rebasing onto Bundle 3. Its demonstration could not be met as specified, and the first check written for it was a tautology its own plant caught. |
| AF | R-2026-09-22-54 | 2026-09-22 | Bundle 3's scope ruled by the founder and moved from a handoff line into the record; the sensors given their own bundle, sequenced before facility one; two deadlines pinned to the old meaning of "Bundle 3" re-pointed by note. Carries the remedy for a file my own `git add -A` swept into AE's commit. |
| AG | R-2026-09-22-55 | 2026-09-22 | `api.openbed.ng` is KEPT — the proxy review's keep-or-remove answered against its own stated criterion, on portability, ISP-block resilience and a place for rate limits, with the caveat that none of the three reaches production until Bundle 3 points a tracked origin at it. Adds the allow-list, guard, stamp and four probes to Bundle 3; leaves the magic-link email host open with a trigger. One report-only read's reason refuted: six tracked files cite the `openbedng` Worker. |
| AH | R-2026-09-22-56 | 2026-09-22 | The infrastructure review CLOSES on the founder's reads, every one of its seven scope bullets answered, and the `-40 H` gate on Bundle 3 lifts. Records that four of the review's own questions — the NDPA scope cell, the surface, attribution and availability — close with it unanswered and become open items rather than being absorbed. Adds the public-table RLS lint to Bundle 3. Two of the instruction's premises failed: no runbook step uses `dig` at all, and the resolver finding does not explain the 2026-09-19 contradiction. One of mine failed too, and is recorded. |
| AJ | R-2026-09-22-57 | 2026-09-22 | Bundle 3 becomes **four pull requests in order** rather than one, on the ground that a migration adding operator write functions must not share a review with a wrapper refactor. Splits `-56 D`'s three grant gaps two-in one-out; redesigns the build-stamp check by moving the assertion to upload time, where its property is actually true, rather than building around a test that reds after every commit; and sets ten architecture properties for admin v1, identity from `auth.uid()` in the database first among them. Arrived inside the founder's pasted kickoff, which lands unedited alongside it. Two of its premises did not survive checking: the rebase it instructs was already done, and it carries one Clause 4 scope defect — listed, not fixed, because the document was ruled to land unedited. A planning pass's claim that the kickoff cited phantom `claude/` paths was itself false and was refuted before it could cause an edit. |
| AK | R-2026-09-22-58 | 2026-09-22 | The founder answers PR 3.1's two open questions. The public dashboard's snapshot Function **keeps its direct origin** — a narrow, triggered exception to `-55 A`, on the ground that `-55 A`'s three reasons are about browser traffic and putting the Worker on the `/beds.json` path would add a failure point while `-23 D5` is open — while its origin still becomes tracked, so Finding D closes for Functions too. Both handoffs land in PR 3.1 from the founder's paste. And the top-level tracked-entry guard is pulled forward out of its trigger because the stray recurred: checking that premise here found the first instance reached a commit and the second reached the index, **neither caught by anything but a person looking**. |
| AN | R-2026-09-22-59 | 2026-09-22 | **H1 could not be performed**: `SUPABASE_URL` on the Pages project is an encrypted secret and cannot be read back, so the step `-58 A1` depended on asked for something that does not exist — recorded as Cowork's defect rather than restated more carefully. The tracked origin is set from Supabase's own project URL instead, re-read here before it was written into anything, and found to agree with the project id `supabase-proxy/index.js` already tracks — which is itself the finding, because it makes the origin a **two-derivation-site** value that §7 governs. `-58 A1`'s "PR 3.1 changes nothing about which origin the Function calls" is replaced by a **weaker and truthful** claim: the end state is the direct origin, and whether that is a *change* is **unknown**, because the prior value was never readable. The leftover secret becomes dead config, deleted only after a 200 from `/beds.json` on a deployment built from the tracked value. Carries one hazard found while designing against B3: two database legs would have begun addressing the live project with a demo key, asserting 200 throughout. |
| AP | R-2026-09-22-60 | 2026-09-22 | **A production build must read no untracked source.** Ruled on a finding of mine: Vite inlines the WHOLE `import.meta.env` record, so a stale `VITE_SUPABASE_URL` in an untracked `.env.local` ships inside the bundle — the marker legs of `-57`/`-58` proved `origins.json` is USED and never that untracked values are KEPT OUT, which is Finding D's hazard surviving its own fix. Requires the cause in the code be removed as well as guarded. The cause was established rather than guessed: **bracket notation**, which misses Vite's per-key define and hits the bare one. One of my premises fell with it — bracket notation was not forced by any compiler option, and dot access typechecks today. |
| AQ | R-2026-09-22-61 | 2026-09-22 | **The publishable key becomes TRACKED**, on the ground that it ships in every client bundle by design, so the stamped commit fully determines the built bundle and no hand-carried step is left in a deploy. Asks which line of `-57`/`-58` it supersedes — and the answer, read here before the clause was written, is **none**: the claim was mine, in a template and a code comment I wrote the same session, and it is narrower than the instruction assumed. The objection that comment raised — that a tracked key makes the repository the place a STALE key lives — is answered by restating the rotation runbook rather than dropped. Also extends `-60` to the PROCESS ENVIRONMENT, which disabling `.env` files does not reach, because Vite's process-env copy outranks every file. |
| AL | R-2026-09-22-62 | 2026-09-23 | **Issued before AN, landed after AQ** — never pasted until 2026-09-23, which `-61 D` recorded. Closes `-57 G5` in this pull request: the USAGE test must red when the probed privilege is swapped. Lists two Cowork errors for the PR body, and specifies nine things the report must QUOTE rather than state. One of its premises did not apply: `scripts/commit.sh` is not new, having been on `main` since 2026-09-11. |
| AM | R-2026-09-22-63 | 2026-09-23 | **Issued before AN, landed after AL.** Cowork handoffs no longer enter the repository; `-58 B1`–`B3` withdrawn; the untracked Cowork directory removed with no diff owed. Its B5 check found **two facts with no home** in the record — what the currently deployed ward console is built against, and the hosted auth-user total — and gives them one, marked as relayed readings. The infra-review handoff was pasted truncated, and the check says so. |
| AR | R-2026-09-23-64 | 2026-09-23 | The live-key probe moves into every ward-console deploy read-back, with a failing half, because no test here can tell a live key from a dead one. **Its signals were observed before they were written, and the observation moved the probe off `/rest/v1/`**: there a live key and a dead key both return 401. First ruling dated 2026-09-23. |
| AS | R-2026-09-23-65 | 2026-09-23 | Cowork's own file review of PR 3.1 at `fbb0655`: one wrong test citation, a RLS lint that read only the plain form, and a runbook whose "step N" named two things. Each premise held, and two were wider than stated: **18 of 19 planted forms passed the old lint**, and every number 1–8 collided in the runbook. The C1 question was answered by planting, not argued: the bundle leg missed three of four package env reads, so the source scan now follows the import graph. Records the PR 3.3 hazard that the ward-console probe path is on no code-derived allow-list. |
| AT | R-2026-09-23-66 | 2026-09-23 | **A3 decided and built: the orphan fixed at source (one read statement, an FK, a blank-name CHECK) and dropped on the page, never explained; one number to call per facility.** Three of its premises needed more than it said: `btrim` alone lets a tab-only name through (observed), the ward console had no rendered test at all, and D1 had a third raw-text site. Its D question found that nothing decides what the public sees about a count's age before facility one. PR 3.4's migration becomes 020. Also carries the ward's own sign-in request, and the finding that GoTrue's answers reveal whether an address exists. |
| AU | R-2026-09-23-67 | 2026-09-23 | **Count age ships before facility one, in PR 3.2b; wards write to support@openbed.ng.** Its A3 clock did not exist and is built: the Pages Function stamps each response with its serve time, which advances while a stalled snapshot does not. Its A1 relative age supersedes the golden-path fixture's and v1's "absolute only" text, whose reason (a wall-clock subtraction) does not apply. The address arrived in a second block with the founder's and Cowork's readings, both recorded; the DKIM recheck closes on the DNS reading. Enumeration is an accepted risk. Its D find: nothing scopes human-readable public labels. |
| AV | R-2026-09-23-68 | 2026-09-23 | **#66 not approved: the page polls, the count goes entirely past the ceiling, and the public page shows words for every code.** Two premises needed more than stated: the "Release Gate 3" values are v1's Bundle 4 checklist (v1:239, v1:242), not gate 3's own text; and the page had never read `offering`, so a ward whose staff said it is not offered read as "not yet reporting". The schema cannot tell a stated NOT_OFFERED from the default; the state machine can, only while `publish_ward_status` is the one way out of PENDING, and a guard now holds that — a PR 3.4 obligation. Cowork records its own error, B4. |
| AW | R-2026-09-23-69 | 2026-09-23 | **#66 merged; 019 applied on hosted and the boundary frozen at 19; dashboard deploy #1 and `SUPABASE_URL` deleted from Production, each reading attributed.** The restatement found a fifth statement of the migration count that 019's own change had missed, and a guard whose premise moved at 19: its blind spot is now constructed rather than found. It binds PR 3.4's design report to state offerings explicitly and to render ADMIN and UNDER_REVIEW before any admin write reaches the public page. It records the ward console's raw codes as unassigned, because the record assigns them to neither 3.4 nor Bundle 4. PR 3.3 goes proposal-first. |
| AX | R-2026-09-23-70 | 2026-09-23 | **PR 3.3's design signed off with four amendments.** `/otp` is not rewritten: option B works only by holding per-address state at the Worker, on the ward's only sign-in path, and closes nothing while `*.supabase.co` answers directly; it is revisited when -55 C lands. A probe proves forwarding by headers, never by body, because hosted's no-key body is the gateway's and not PostgREST's. `/auth/v1/verify` is a named direct-origin exception. `token` is forwarded only for the refresh grant. Every pending count in the Supabase runbook is now scanned, and the scan's first plant found a region that was read too wide. Cowork records its own error on AJ F2. The ward console's raw codes go to PR 3.4. |
| AY | R-2026-09-23-71 | 2026-09-23 | **`record-after-67` becomes its own pull request, and PR 3.4 splits.** "Unlisted" is a new `listed_at`, never quiet mode, because a quiet facility still feeds the public rollup and would count toward its k-floor while it reports nothing. The secret key goes to no Cloudflare Function in v1: provisioning stays in the script, over one SQL implementation of the gates. The redirect list gains `admin.openbed.ng`, amending D2. A row version, idempotent create and add, one active account per ward, and no Auth call on a complete account. Two of its premises did not hold as stated: the reads return a `PLATFORM_ADMIN` zero rows rather than refusing it, and no operator RPC provisions in v1. |
| AZ | R-2026-09-23-72 | 2026-09-24 | **#68 merged; the redirect entries become the exact slashed strings the apps send**, amending -71 D, so nothing rests on Supabase's matching rules. A silent fallback to the Site URL must read as STOP. -71's premise corrections are accepted, and J4's zero Auth calls bind the 3.4b script. Found on landing: the ward console renders a fallen-back operator's zero-row session as an empty list, for 3.4b. |
| BA | R-2026-09-24-73 | 2026-09-24 | **#69 merged; 020's hosted apply prepared as founder steps.** A new read-back compares the public output before and after the apply, and says VACUOUS FOR B1 when there was nothing public to change, as on hosted today. The `redirect_to` read becomes script-only. Its stated reason, that the value is percent-encoded, does not hold for these strings (GoTrue encodes only on `&`, `=` or `#`), and the instruction stands on other grounds. |
| BB | R-2026-09-24-74 | 2026-09-24 | **#70 tightened before anything hosted runs.** Fence 5 becomes the second dry run. Fence 6 reads who can EXECUTE every function on hosted and holds it to one new fixture, which the D3 closed list now derives from too. The before/after comparison is valid only until wards can publish. A backup restore is named as gating facility one. Found on landing: step 4b's defect list describes code that no longer exists. |
| BC | R-2026-09-24-75 | 2026-09-24 | **#70 merged; fence 6's exact match accepted; step 4b to be restated with evidence; the design review.** The three contact addresses and the controller are fixed, and there is no privacy@. The prototype's admin code is not copied in. 3.4b splits into 021 and the app. The public site is beds first, with a privacy notice to draft, and never "within 30 seconds". No tile ruling exists. |
| BD | R-2026-09-24-76 | 2026-09-24 | **021 signed off, with the agreement moved off the contact person's row** so that no erasure reaches it; five questions ruled; Supabase added as a processor. Found in the build: the move and its pre-check cannot both act; the agreement write needs no version check; the list becomes `operator_register()`, because a return type cannot change in place. |
| BE | R-2026-09-24-77 | 2026-09-24 | **020 applied on hosted: fences 1-5 as they must be, and fence 6's first real STOP**, on Supabase's `rls_auto_enable()`. That function was ruled hosted-only and inert, and is held to every recorded property. The record already held it (-55 D3, -56 A7), and a single list of hosted objects now exists. The stop was foreseeable from the record. |
| BF | R-2026-09-24-78 | 2026-09-24 | **#71 merged; 021's three build findings ruled** (the move dropped and the pre-check kept; no version check on the agreement write; one read path). BF-1 c's revoke-and-keep is carried out as a drop instead, because the kept function would read a dropped column. It is reported for Cowork to overrule. Fence 6 is not run between 021's merge and its apply. |
| BG | R-2026-09-24-79 | 2026-09-24 | **BF-1 c's departure accepted:** 021 drops `operator_list_facilities()`, because a kept copy would read a dropped column, and a dead function is not a safe one. BF-1 c is superseded. 021's PR waits for fence 6 PASS. |
| BH | R-2026-09-24-80 | 2026-09-24 | **Fence 6 reads PASS on hosted** (founder's output, relayed by Cowork): 25 lines ok, with `rls_auto_enable()` ok as hosted-only. 020's apply is complete, and BE-1 is closed. 021's PR opens, and its report goes to Cowork before the merge word. |
| BI | R-2026-09-24-81 | 2026-09-24 | **#72 checked. The register's `agreement_recorded` becomes `agreement_state` (none, recorded or withdrawn)**, because the yes/no read a withdrawal as "none" and led to a dead end. Found: neither the HTTP test nor the runbook named the field, and no withdrawal step exists yet. A withdrawn facility stays listed, flagged for BD-2 2. The dated-unit guard fix is queued for the record-021-apply change. |
| BJ | R-2026-09-24-82 | 2026-09-24 | **A withdrawn agreement takes a facility off the public output by itself.** Both membership predicates (`project_facility`, `refresh_lga_rollup`) gain "no withdrawn agreement", and a trigger on `facility_agreement` re-projects through 008's `trg_project`. B1 holds. The withdrawal step for 3.4b-app is ruled: withdraw, deactivate the ward accounts, unlist, then read back `/beds.json`. Found: 021:282-291 was wrong when written; the gate is at 021:313-322. |
| BK | R-2026-09-24-83 | 2026-09-24 | **Public requires an active agreement, and fails closed.** Both predicates are now `EXISTS (agreement, withdrawn_on IS NULL)`. A pre-check refuses to apply over a listed facility with no agreement, and the seed and fixtures gain synthetic agreements. Found: the fail-open was real in the predicate but blocked today by the mirrors' own RLS. The round trips now run in rolled-back transactions, because BD's down refusal and BK's seed agreements together forbid a committed one. B1 is structural. |
| BL | R-2026-09-24-84 | 2026-09-24 | **#72 merged at `f6889d4`**, and the branch deleted after MERGED was read back. The round trips running inside rolled-back transactions are accepted, because `run_migrations.sh` applies each file `--single-transaction`. BK's partial premise is recorded. |
| BM | R-2026-09-24-85 | 2026-09-24 | **021 applied on hosted: all six fences as they must be** (founder's output, relayed by Cowork). The boundary is at 21, and step 5 is at 0 pending. BI-2 is done: a unit counts as dated history only with "Restated" or "On" plus a date, and 17 statements in 13 units were restated to carry one. The withdrawal step is carried into 3.4b-app's notes. Stop until the next kickoff. |
| BN | R-2026-09-24-86 | 2026-09-24 | **Four corrections on #73.** The BI-2 unit count is 13, not 12 (derived by running `dateUnits`). The 3.4b-app read-path bullet now covers the listing read only, and the allow-list stays derived from call sites. A marker now dates only the count that follows it, and a list item never dates a fence, with QA's three forms as plants. The withdrawal step is set by a founder SQL step, never a function. Not a merge word. |
| BO | R-2026-09-24-87 | 2026-09-24 | **#73 merged at `faf984a`;** Cowork's check at `fc175c4` recorded as Cowork's readings. Stop until the 3.4b-app kickoff. |
| BP | R-2026-09-24-88 | 2026-09-24 | **The 3.4b-app kickoff:** three PRs, A, B, C; its text is the kickoff file, committed unedited. Its finding held: the script bypassed the gates. A second false fact found: row 4's `021:313-322` citation. |
| BQ | R-2026-09-24-89 | 2026-09-24 | **The founder's answers:** the operator's address is a fourth, unpublished role address, never in the repository; Cloudflare Access in front of admin (founder-reported, not read back). Binds PR B and PR C. |
| BR | R-2026-09-24-90 | 2026-09-24 | **Migration 022 in PR A:** one active operator by index, begin's operator `complete` arm, reactivation in complete, refusals named by constraint. The fallback refused as a second gate outside SQL. |
| BS | R-2026-09-24-91 | 2026-09-24 | **The build word for PR A.** The down's refusal confirmed; ENABLE_SIGNUP gains a ward sign-in condition and a failing half; the report committed unedited. Its "@openbed.ng/origins" is `@openbed/origins`, noted in the entry. |
| BT | R-2026-09-24-92 | 2026-09-24 | **#74 merged at `abd6ee5`.** Sign-ups off becomes A.2 (a confirmed user through the admin API; `[auth]` only). `sb_secret_` accepted as sent. The `_legs.ts` hole goes to B. |
| BU | R-2026-09-24-93 | 2026-09-24 | **The build word for A.2 and B.** The lookup and the order confirmed; H2's text goes in A.2 with a STOP if the switch did not take. `contacts.json` replaces `ward-support.json`; `/beds.json` gets nosniff unconditionally; each app is walked in a real browser under its CSP. |
| BV | R-2026-09-24-94 | 2026-09-24 | **#75 merged at `78f1e00`.** B's ward CSP API origins are rendered from `origins.json` at build time, never typed into `_headers`; `connect-src` pinned to `'self'` plus that pair. Hosted: 022's apply, then H2, founder-side. |
| BW | R-2026-09-24-95 | 2026-09-24 | **The leg rule: a longer message no longer proves a shorter one,** from any script. 305 / 279 / 26 before and after, no flips; 17 nested pairs pinned by name. |
| BX | R-2026-09-24-96 | 2026-09-24 | **#76 merged at `3df27ca`.** BW-1's any-script widening accepted. PR C's design report written, report only. |
| BY | R-2026-09-24-97 | 2026-09-24 | **The build word for PR C.** H6 reordered so the bootstrap comes before any sign-in observation; the seven open items ruled: preview and Access moved to H6, the BT-3 probe prints the status only, `lagosTime` shared, the service-role lint's corpus from `wrangler.toml`, edit never retried, the E2E operator cleaned, `connect-src` pinned. |
| BZ | R-2026-09-24-98 | 2026-09-24 | **The retype form refused.** Migration 023 adds `lat`, `lng` and `public_phone_e164` to `operator_register`; the edit form prefills all six and a phone change needs a confirm. 022 and 023 both pending (read, not assumed). Open item: the ward console's digit-less code pattern, trigger the first ward-path code with a digit. |
| CA | R-2026-09-24-99 | 2026-09-24 | **#77 merged at `4e28cdb`.** 3.4b-app's code is complete. The hosted order: 022's apply, H2, H3, 023's apply, H5, H6, all founder-side. |
| CB | R-2026-09-24-100 | 2026-09-24 | **Withdrawal is final in v1.** The `AGREEMENT_ALREADY_RECORDED` sentence corrected (it promised a path); §12.5 marks the one-way door, and step 3's re-agreement sentence is superseded. Open item: agreement history, triggered by the first returning facility or mistaken record, backstopped at the first post-launch kickoff. |
| CC | R-2026-09-25-101 | 2026-09-25 | **#78 merged at `06fe479`** (parents `4e28cdb`, `3a8f897`). The three departures in #78 accepted; the branch deleted and read back. |
| CD | R-2026-09-25-102 | 2026-09-25 | **#78's merge read back.** Merged true; `git diff 3a8f897 06fe479` empty; the branch gone. Nothing to do. |
| CE | R-2026-09-25-103 | 2026-09-25 | **022 and 023 applied together, in one run.** The runner cannot apply one file alone. CE-1's six-fence expectations; the hosted order restated to 022+023, H2, H3, H5, H6. The one-file fences were the implementer's miss in BZ. |
| CF | R-2026-09-25-104 | 2026-09-25 | **The runbook is corrected after the apply, not before.** CE-1 was the live instruction for the run; backstop: any earlier merge would have carried CE-3 first. |
| CG | R-2026-09-25-105 | 2026-09-25 | **022 and 023 applied on hosted, recorded.** All six fences read as they must; the frozen boundary at 23; step 5 at 0 pending; the one-file fences superseded; §12's order restated; the expectation guard's pins restated to the zero state. |
| CH | R-2026-09-25-106 | 2026-09-25 | **H2 done on hosted: sign-ups off.** 0 unconfirmed active accounts; the switch saved, the Email provider untouched; settings PASS; the probe answered 422 and created no user. H6 precondition 3 met. |
| CI | R-2026-09-25-107 | 2026-09-25 | **#79 merged at `b056ad1`** (parents `06fe479`, `2c75150`). CH re-routed out of #79, to land with H3's record. |
| CJ | R-2026-09-25-108 | 2026-09-25 | **H3 entered on hosted:** the Site URL and redirects exact, Proton SMTP, the rate limits read. The processor agreement gates facility one, not H6. **The minimum interval arrived blank, so §12.1 is unticked and precondition 4 NOT met;** CJ-2's address is not written (BQ-1). |
| CK | R-2026-09-25-109 | 2026-09-25 | **#80 merged at `5786626`** (parents `b056ad1`, `1a22685`); `ch-h2-pending` and the #80 branch deleted. The BQ-1 wording accepted. The interval is read as 60 seconds, held out of #80. |
| CL | R-2026-09-25-110 | 2026-09-25 | **H5 done on hosted:** the Worker at `b056ad1`, live version `895ae17d…`, read-back PASS, and probe 4's bundle equal to `allow-list.json` entry for entry. §12.1 complete at 60 seconds; preconditions 4 and 6 met; H6 may start before this merges. Probe 4's stale "four POST" text restated. |
| CM | R-2026-09-25-111 | 2026-09-25 | **H6 step 1 lacked the Service Auth policy:** an issued Access token passes nothing without it, and step 2 would STOP on a correct deploy. Held out of #81; landed as amended by CN, whose step order supersedes CM's. |
| CN | R-2026-09-25-112 | 2026-09-25 | **#81 merged at `389cd10`** (parents `5786626`, `e7c7c69`); `record-h5` deleted. **No Access application existed before 2026-09-25** (BQ-2 superseded in part): H6 step 1 restated to a) to e), creating the application, with the Service Auth policy. |
| CO | R-2026-09-25-113 | 2026-09-25 | **H6 done on hosted: admin.openbed.ng is LIVE.** Steps 1 to 8 PASS: the read-back at `5786626`, the widened sweep on hosted for the first time, the operator bootstrapped (count 1), `redirect_to` exact, and the fragment survives Access in both orders. HASH refused by the read-backs; step 3, §6 and step 6 fixed. Facility one blocked by the -45 gate AND CJ-2. Three open items with triggers. |
| CP | R-2026-09-25-114 | 2026-09-25 | **#82 merged at `9f91d91`** (parents `389cd10`, `43ce55a`); `record-h6` deleted. All four of #82's departures accepted. Carries the restore drill's design notes (Cowork's HOLD block); the repository claims in them checked and holding. |
| CQ | R-2026-09-25-115 | 2026-09-25 | **Backups proven; the -45 gate is clear.** Daily physical backups; PITR off, the add-on declined; the 25 Sep 06:54:11 UTC backup restored to a new project, equal to live, the clone deleted. Step 4b's trigger and check count ward accounts only (not the operator). Facility one waits on CJ-2 (the one hosted gate) and on every "before facility one" item (corrected by -116). The 2026-09-14 test login removed. Open item: the project-wide email limit. |
| CR | R-2026-09-25-116 | 2026-09-25 | **#83 corrected, in #83:** facility one waits on CJ-2 (the one hosted gate) AND 13 open "before facility one" items, now a checklist at runbook 12.4 step 1 (four of -23's items and the discoverability item found beyond Cowork's list). Step 4b's check restated so a non-zero reading stops nothing after facility one. The code PR renumbered CS. |
| CS | R-2026-09-25-117 | 2026-09-25 | **#83 merged at `574e423`** (parents `9f91d91`, `0378f6b`). **The CO-3 code PR:** the renderer takes a required `--target`, so the deployed admin and ward-console CSPs name no local origin (box 2 closes only on both redeploys reading PASS); the provisioning script masks the address on every line (box 3 closes on this merge). Both shown red first. The real-browser walk is NOT DONE, and is a founder step. -116's two slips fixed. |
| CT | R-2026-09-25-118 | 2026-09-25 | **#84 merged at `dd59c7f`** (parents `574e423`, `03a103e`). BU-2 e's local browser walk waived for CS only; a hosted browser check after each redeploy replaces it. The ward console has no distinct refusal message: its PASS is the uniform `SIGNIN_ANSWERED` sentence. |
| CU | R-2026-09-25-119 | 2026-09-25 | **Admin, the ward console and the public dashboard redeployed at `dd59c7f`, all PASS; boxes 2 and 3 ticked.** The dashboard had served no CSP until then. Two Cloudflare zone settings (Web Analytics' browser-only beacon, which collected `openbed.ng` page views; a managed robots.txt that allowed crawling) found and switched off. The read-backs now fetch as a browser, list every script, read the custom domain, and compare robots.txt byte for byte. |
| CV | R-2026-09-26-120 | 2026-09-26 | **#85 merged at `c20e635`** (parents `dd59c7f`, `cdb86b1`); `redeploy-record-and-browser-readbacks` deleted and read back as gone. Cowork accepted the CU-3 sweep, the replaced PASS assertion and the recorded slip. It noted that the new custom-domain and script checks first run against hosted at the next deploy. Held, and landed with CW. |
| CW | R-2026-09-26-121 | 2026-09-26 | **The design-pass kickoff's D0, committed unedited.** The design pass (box 14) and the launch paperwork (box 15) become facility-one boxes. -75 BC-7's gate had no observable event, so the pass fell out of every list: Cowork's miss. Every deferral names one gate (BOX, TRIGGER or VERSION), the record holds the register, and `tests/compliance/deferred_items.test.ts` holds it to the checklist. CW-7: CV's date is 2026-09-26, not the kickoff's -09-25. |
| CX | R-2026-09-26-122 | 2026-09-26 | **#86 held once, amended in #86.** B1 becomes box 16, and its onboarding check becomes 12.4 steps 6 and 9: SQL as the real ward in a rolled-back transaction (the founder's mechanism, because the HTTP check could not run on hosted), and the first publish read back end to end. Every ungated deferral gains a gate. -21-38 D1, -21-41 B and -21-50 E2 become PR F; -21-43 C1 and -21-45 E are closed; C3 moves into box 4; the favicon goes into D1–D3. The guard gains (e). 59 rows; 16 boxes, 2 ticked. |
| CY | R-2026-09-26-123 | 2026-09-26 | **#86 merged at `495ad0a`** (parents `c20e635`, `d02ae7e`); `design-pass-d0` deleted on both sides and read back as gone. All of CX accepted as landed. Held, and landed in D1's pull request. |
| CZ | R-2026-09-26-124 | 2026-09-26 | **D1 started, and built:** `packages/design` (the tokens byte for byte, with each source's sha256; fonts self-hosted through @fontsource; the mark), and the public dashboard restyled with every sentence byte-identical, a favicon, and the colour rule. The guards were shown red first. No browser runner was added; the screenshots came from the installed Chrome. |
| DA | R-2026-09-26-125 | 2026-09-26 | **The ward-console and admin design legs are PENDING legs:** plain tests asserting the app's current state, each red with a flip message once the app meets the guard. Not `test.todo` (it counts as skipped) and not `test.fails` (it passes on any throw). Two register rows gate them on D2's and D3's PRs. |
| DB | R-2026-09-26-126 | 2026-09-26 | **#87 held once, amended in #87.** Under the stale banner nothing reads as live. A qualified or countless claim is not coloured. Name 24 > phone 20 > count 18, as literal px with a guard (the founder's order; DB-3's own slip recorded). The stamp takes its own line on a phone, and the header sits in the content column. A wording note is in the A7 row. The register parser now refuses a row after the table ends, a gap DB-6 would have hit. |
| DC | R-2026-09-26-127 | 2026-09-26 | **#87 amended once more.** A qualified claim is never shown as live: no dot, and a grey stamp in place of green. Amber stays on the YELLOW band, qualified or not (the founder's correction of DC-1's "coloured stamp", Cowork's slip). DD has not been issued, so it has no row. |
| DD | R-2026-09-26-128 | 2026-09-26 | **#87 merged at `5be63d4`** (parents `495ad0a`, `b76d711`); `design-pass-d1` deleted on both sides and read back as gone. Box 14 stays open. Held, and landed with PR F. |
| DE | R-2026-09-26-129 | 2026-09-26 | **The public dashboard deployed at `5be63d4`,** read back PASS, including the favicon and font checks' first hosted run, and browser-checked. Recorded in the Pages runbook. The dashboard's part of box 14 is done; the box stays open. PR F starts. |
| DF | R-2026-09-26-130 | 2026-09-26 | **PR F's terms.** F3 at full scope as `openbed/no-wall-clock`, with two exemptions pinned by file and reason. E2: any path under `database/migrations/`, and a bare "none" fails, checked by a repo-lint step with the body in env. With the auth-hook invariant, the three F rows leave the register. |

## Deferred items — this record is where the list lives

_Added by R-2026-09-26-121 CW-5. **Every open deferral in this record has a row here, and
every row names exactly one gate** (method note 22, as amended by CW-4):_
- **BOX:** a line in the checklist at runbook 12.4 step 1, "Open before facility one".
  The row's Ruling is the ruling that the box cites.
- **TRIGGER:** an observable event.
- **VERSION:** out of v1, reconsidered at a named point.

_"Waits for X to do Y" is not a gate. A deferral with no gate gets no row here; it is
reported for Cowork to rule, and CW's own entry lists the ones this sweep found. A row
leaves this table when the ruling that closes its item lands. A trigger marked **FIRED**
has happened with no record of it, and is Cowork's to rule; it is not work until then
(method note 22)._

_`tests/compliance/deferred_items.test.ts` refuses five things:_
- _a Gate kind that is not BOX, TRIGGER or VERSION;_
- _an empty Gate, or one reading TBD, ? or pending;_
- _a BOX row whose ruling no box carries;_
- _an unticked box with no BOX row;_
- _a BOX row whose every box is ticked, because a closed item leaves this table in the
  ruling that closes it (added by R-2026-09-26-122 CX-5; until then this list read
  "refuses four things")._

_It parses this table strictly, and a malformed row fails the test rather than being
skipped._

_Seeded 2026-09-26 by searching this record for "OPEN ITEM", "open item", "trigger",
"deferred", "defer", "out of v1", "follow-up", "follow up", "later", "v2", "before
facility one" and its variants, and reading each hit in its ruling. Each row's gate is
the record's own, except where CW-5 assigned one._

| Item | Ruling | Gate kind | Gate |
|---|---|---|---|
| The email provider's processor agreement: s.29 agreement, s.41 transfer basis, retention | R-2026-09-25-108 CJ-2 | BOX | Its box at runbook 12.4 step 1, ticked by a ruling that closes it |
| The clinicians confirm the freshness thresholds and the public wording (with -68 C3). Wording note, R-2026-09-26-126 DB-6: "not yet reporting — updated N min ago" reads as a contradiction | R-2026-09-23-67 A7 | BOX | Its box at runbook 12.4 step 1, ticked by a ruling that closes it |
| Each facility's public number answered 24/7, with a test call | R-2026-09-23-66 C4 | BOX | Its box at runbook 12.4 step 1, ticked by a ruling that closes it |
| A staffed phone or WhatsApp line for wards, with honest hours | R-2026-09-23-67 B3 | BOX | Its box at runbook 12.4 step 1, ticked by a ruling that closes it |
| Where the magic-link emails point (the custom-domain decision) | R-2026-09-22-55 C | BOX | Its box at runbook 12.4 step 1, ticked by a ruling that closes it |
| The sensor bundle | R-2026-09-22-54 B | BOX | Its box at runbook 12.4 step 1, ticked by a ruling that closes it |
| The NDPA sub-processor scope cell for Cloudflare (made a facility-one item by -56 A9) | R-2026-09-19-23 D2 | BOX | Its box at runbook 12.4 step 1, ticked by a ruling that closes it |
| The proxy's surface (by -56 A9) | R-2026-09-19-23 D3 | BOX | Its box at runbook 12.4 step 1, ticked by a ruling that closes it |
| Attribution: which client address Supabase sees (by -56 A9) | R-2026-09-19-23 D4 | BOX | Its box at runbook 12.4 step 1, ticked by a ruling that closes it |
| Availability of the proxy on the clinical path (by -56 A9) | R-2026-09-19-23 D5 | BOX | Its box at runbook 12.4 step 1, ticked by a ruling that closes it |
| Discoverability at facility one: `robots.txt` and the `noindex` decision (O1; with -27 C5) | R-2026-09-20-36 A5 | BOX | Its box at runbook 12.4 step 1, ticked by a ruling that closes it |
| The design pass: the design system on all three apps, deployed, read back and approved (supersedes -75 BC-7's "waits for Cowork's brief") | R-2026-09-26-121 CW-1 | BOX | Its box at runbook 12.4 step 1, ticked only after all three deploys and the founder's approval |
| The founder's launch paperwork register reads Approved on every item | R-2026-09-26-121 CW-2 | BOX | Its box at runbook 12.4 step 1, ticked by a ruling that closes it |
| The facility agreement grants the facility's permission to publish its live capacity (B1, recorded 2026-09-14) | R-2026-09-26-122 CX-1 | BOX | Its box at runbook 12.4 step 1, ticked by a ruling that closes it |
| Agreement history: re-agreement after withdrawal, and correcting a mistaken agreement record | R-2026-09-24-100 CB-2 | TRIGGER | The first withdrawn facility that asks to return, or the first mistaken agreement record, or earlier on the founder's word (backstop: the first post-launch sprint kickoff; R-2026-09-26-122 CX-4) |
| The ward console's code pattern cannot read a code containing a digit | R-2026-09-24-98 BZ | TRIGGER | The first ward-path code containing a digit |
| No audit row on reading a contact | R-2026-09-24-76 BD-2 1 | TRIGGER | The first ruling or migration that permits a second PLATFORM_ADMIN; the audit row lands in that same change (R-2026-09-26-122 CX-4: the old trigger could never fire, because 022 refuses a second operator) |
| The project-wide allowance of 30 emails an hour (runbook §12.1) | R-2026-09-25-115 CQ-4 | TRIGGER | The second facility, or the first 429 a ward sees |
| PITR is off | R-2026-09-25-115 CQ-1 | TRIGGER | The first data-loss event, or when re-entering a day's operator writes stops being practical, on the founder's word (-115 CQ-1 verbatim; R-2026-09-26-122 CX-4) |
| wrangler's 429 at `GET /accounts` (the fix to evaluate: `CLOUDFLARE_ACCOUNT_ID` in the deploy environment) | R-2026-09-25-119 CU-1 | TRIGGER | A second occurrence |
| Per-ward rows versus a facility rollup on the public page | R-2026-09-24-76 BD-3 | TRIGGER | 30 days after facility one is listed (CW-5; the record read "until dispatcher validation") |
| The granularity floor on a small published count | R1 (b) | TRIGGER | The first facility publishing a ward with offering OFFERED and a bed count of 2 or less |
| The two regex readers, and their second task (-31 B) | R-2026-09-18-16 B | TRIGGER | Facility one is onboarded ("after facility one", -36 C's queue) |
| Whether Pages Functions support scheduled handlers or cron triggers (re-pointed by -54 C) | R-2026-09-17-12 G | TRIGGER | The sensor bundle is scoped |
| The failure path's headers observed at the edge, by a preview deployment against a non-production project | R-2026-09-20-32 B2 | TRIGGER | The failure path comes to carry data |
| An assertion tying `s-maxage` to `pollCadenceSeconds` | R-2026-09-21-38 D2 | TRIGGER | The next change touching either value |
| `npx supabase start` hitting the Docker Hub pull limit in stack jobs | R-2026-09-21-38 D3 | TRIGGER | The next stack-job failure of that shape |
| The tautological column-name legs in the served-document test | R-2026-09-21-42 G | TRIGGER | The next change touching `packages/snapshot/src/codec.ts` or those legs |
| Gate 2's 60-second clause could be revisited | R-2026-09-23-67 A7 | BOX | Subsumed by the clinicians' box: its threshold confirmation includes this clause (R-2026-09-26-122 CX-3). Its box at runbook 12.4 step 1, ticked by a ruling that closes it |
| The from-allowlist lint extended to `.rpc(` call sites | R-2026-09-21-48 A2 | TRIGGER | The first `.from(` or `.rpc(` call site added under `apps/` |
| The snapshot Function keeps its direct origin | R-2026-09-22-58 A6 | TRIGGER | -23 D5 closes (its box at runbook 12.4 step 1 is ticked) |
| GoTrue's answers reveal whether an address has an account (an accepted risk) | R-2026-09-23-67 C | TRIGGER | Personal addresses are ever used as logins |
| A uniform `/otp` answer at the Worker (option B) | R-2026-09-23-70 A | TRIGGER | -55 C lands |
| `GET /auth/v1/verify` listed on the Worker | R-2026-09-23-70 C2 | TRIGGER | -55 C's custom domain is routed through the Worker |
| `/favicon.ico` is answered by the SPA fallback | R-2026-09-23-70, founder step (a) note | TRIGGER | FIRED; resolved in D1–D3 (R-2026-09-26-122 CX-3): each app ships the SVG icon and a real `/favicon.ico`, and the read-back asserts `/favicon.ico` is not `text/html`. D1 done for the public dashboard (R-2026-09-26-124): a real `favicon.ico`, and `scripts/readback_pages.sh` checks it on both hosts; the ward console and admin remain, in D2 and D3 |
| The before/after public-output comparison needs a new design once wards can publish | R-2026-09-24-74 BB-3 | TRIGGER | The first hosted migration apply after the -45 gate cleared (-115) |
| Update requests | R-2026-09-24-75 BC-7 | VERSION | Out of v1. Reconsidered at v2 scoping, which opens 30 days after facility one is listed (CW-5) |
| Freshest and nearest sorting | R-2026-09-24-75 BC-7 | VERSION | Out of v1. Reconsidered at v2 scoping, which opens 30 days after facility one is listed (CW-5) |
| The public "who's on it" list | R-2026-09-24-75 BC-7 | VERSION | Out of v1. Reconsidered at v2 scoping, which opens 30 days after facility one is listed (CW-5) |
| The facility-admin override | R-2026-09-24-75 BC-7 | VERSION | Out of v1. Reconsidered at v2 scoping, which opens 30 days after facility one is listed (CW-5) |
| Duty-flag gating | R-2026-09-24-75 BC-7 | VERSION | Out of v1. Reconsidered at v2 scoping, which opens 30 days after facility one is listed (CW-5) |
| The ward console's design guards: viewport, tokens, self-hosted fonts (the PENDING D2 legs in `tests/compliance/bundle_guards.test.ts`) | R-2026-09-26-125 DA-3 | TRIGGER | D2's PR: the PENDING D2 legs go red when the app meets the guard, and D2 replaces them with the real guard |
| Admin's design guards: tokens, self-hosted fonts (the PENDING D3 leg in `tests/compliance/bundle_guards.test.ts`) | R-2026-09-26-125 DA-3 | TRIGGER | D3's PR: the PENDING D3 leg goes red when the app meets the guard, and D3 replaces it with the real guard |
| B1's onboarding checks: the first ward account reads its own history as itself (12.4 step 6), and the first publish reads back from `/beds.json` (12.4 step 9) | R-2026-09-26-122 CX-1 (b) | TRIGGER | The first ward account at facility one |
| `ward_reply` has a cap and no content validation (#63/#97) | R-2026-09-17-03 and -04 | TRIGGER | The first change that writes `app.referral.ward_reply` (referrals are unwired in v1; R-2026-09-26-122 CX-2) |
| Gate 3's property test does not exist (#109) | R-2026-09-17-03 and -04 | TRIGGER | The next change under `packages/gate/` or `packages/snapshot/src/freshness.ts` (R-2026-09-26-122 CX-2) |
| The `scripts/` survey items: PR evidence tables generated from artefacts; the idempotency digest's grants and RLS flags; item 1, the duty-flag lint missing `<> 'NO'`; item 2, nothing validates SQL quoted in prose | Deferred to the `scripts/` survey; R-2026-09-15-06 and -07; R-2026-09-17-05; R-2026-09-17-08 D2 | TRIGGER | The next migration file added (024) (R-2026-09-26-122 CX-2) |
| The test-title citation convention | R-2026-09-23-65 E | TRIGGER | The first cited test title found not to exist in its file (R-2026-09-26-122 CX-2) |
| A real-browser refusal check in CI | R-2026-09-23-70 C3 | TRIGGER | The first PR that adds a browser runner (Playwright or similar) as a dependency. If D1's screenshots add one, it fires in D1 and the check lands in D2 (R-2026-09-26-122 CX-2) |
| Provisioning as a Supabase Edge Function | R-2026-09-23-71 C | TRIGGER | The first proposal to move ward-account setup into an app (R-2026-09-26-122 CX-2) |
| An idempotency key on `operator_edit_facility` | R-2026-09-24-97 BY-2 (e) | TRIGGER | The first duplicated or lost operator edit observed (R-2026-09-26-122 CX-2) |
| Push protection's coverage of this repository's key formats (OWED) | R-2026-09-19-19 B | TRIGGER | The next change to `scripts/lint_no_secrets.sh` or the `secret-scan` job; the documentation check is done in that change (R-2026-09-26-122 CX-2) |
| A third tier for emergency dispatch | O2 (Open — questions) | VERSION | Out of v1. Reconsidered at v2 scoping (R-2026-09-26-122 CX-2) |
| "Alphabetical within last-used LGA" | D4 (Decided) | VERSION | Out of v1: location and sorting are out of v1. Reconsidered at v2 scoping (R-2026-09-26-122 CX-2) |
| The strings module, for the Yoruba/Pidgin pass (#115) | R-2026-09-17-03 and -04 | VERSION | Out of v1. Reconsidered at v2 scoping (R-2026-09-26-122 CX-2) |
| `publish_ward_status` enqueues to `app.notification_outbox` (#71) | R-2026-09-17-03 and -04 | VERSION | Out of v1: escalation notifications are not in v1. Reconsidered at v2 scoping (R-2026-09-26-122 CX-2) |
| Pages Git integration as the root fix for deploys | R-2026-09-20-30 A5 | VERSION | Out of v1. Reconsidered at v2 scoping (R-2026-09-26-122 CX-2) |
| Phone features: the tile, call tracking, WhatsApp/SMS | R-2026-09-23-66 C2 | VERSION | Out of v1. Reconsidered at v2 scoping (R-2026-09-26-122 CX-2) |

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
    - **Amended by R-2026-09-26-121 CW-4: every deferral names exactly one gate, of one of three kinds.**
      - **BOX:** a line in the checklist at runbook 12.4 step 1.
      - **TRIGGER:** an observable event, such as "the second PLATFORM_ADMIN" or "the first ward-path code containing a digit".
      - **VERSION:** out of v1, reconsidered at a named point.
      - **"Waits for X to do Y" is not a gate.** -75 BC-7's "waits for Cowork's brief" was one, and the design pass fell out of every list that drives work.
      - Every gated deferral is a row in "Deferred items — this record is where the list lives", above. A deferral found with no gate is reported for Cowork to rule. The implementer does not invent one.
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
- on 2026-09-23, R-2026-09-23-70 (issued as R-PROVISIONAL-2026-09-23-AX): **PR 3.3's
  design signed off** with four amendments (probes by header, `/auth/v1/verify` a named
  exception, a real-browser refusal test, the refresh grant only); `/otp` left
  unrewritten until -55 C; **every pending count in the Supabase runbook scanned**
  rather than enumerated; and the ward console's raw codes assigned to PR 3.4;
- on 2026-09-23, R-2026-09-23-69 (issued as R-PROVISIONAL-2026-09-23-AW): **#66
  merged**; **019 applied on hosted** by the founder, read independently by Cowork,
  and **the frozen boundary moved to 19** with runbook step 5 restated; **the public
  dashboard deployed at `1d084a4` and `SUPABASE_URL` deleted from Production**, Preview
  unread; two obligations bind PR 3.4's design report; the ward console's raw codes
  recorded as unassigned; and PR 3.3 goes proposal-first;
- on 2026-09-23, R-2026-09-23-68 (issued as R-PROVISIONAL-2026-09-23-AV): **the public
  page polls at the snapshot cadence**, bypassing the browser cache and holding good
  data through a failed poll; **past the ceiling no number shows at all**, with v1's
  values recorded beside the provisional ones and the setting's prose stating none;
  **every code shows as plain words** from one table, held complete against the
  migrations and the catalogue; and **"not offered at this facility" only for an
  offering someone stated**, which rests on publish_ward_status being the one way out
  of PENDING, now guarded, and binds PR 3.4;
- on 2026-09-23, R-2026-09-23-67 (issued as R-PROVISIONAL-2026-09-23-AU): **every public
  count says how old it is, and a stale page says so**, measured against a serve-time
  stamp the Pages Function sets on each response -- so a stalled snapshot ages on the
  page rather than reading fresh for as long as it is served -- with the thresholds in
  one setting labelled PROVISIONAL until the founder's clinicians rule; **a ward sent
  for help is told to write to support@openbed.ng**, from one tracked setting, recorded
  with the founder's receipt reading and Cowork's DNS reading; the DKIM recheck is
  closed on that DNS reading, Proton's dashboard unread; GoTrue's enumeration is an
  accepted risk; and nothing scopes human-readable public labels;
- on 2026-09-23, R-2026-09-23-66 (issued as R-PROVISIONAL-2026-09-23-AT): **A3 decided
  and built in PR 3.2** -- the generator reads both mirrors in one statement, proved by
  a forced race that is red on 016's body and green on 019's; a ward row cannot name an
  absent facility and a facility cannot be named with nothing; the page drops an
  unidentified ward and falls back to the outage state if every ward is dropped; each
  facility gets one number to call. PR 3.2 also refuses malformed ward rows, shows no
  raw server text anywhere, fixes two publish-form defects that made NOT_OFFERED
  unpublishable and any zero-beds reason refusable, and lets a ward ask for its own
  link. It records that GoTrue's own answers reveal whether an address exists, and
  that nothing decides what the public sees about a count's age before facility one;
- on 2026-09-23, R-2026-09-23-65 (issued as R-PROVISIONAL-2026-09-23-AS): **Cowork's file
  review of PR 3.1**, three fixes in one commit. The RLS lint now lexes each migration
  and pairs or refuses by name every form that can create or move a table into `public`
  — 18 of 19 planted forms had passed it — with pg_cron exempted by name on an observed
  catalogue reading. The Pages runbook names a section "section N" and a read-back
  "read-back N", under a guard that found one reference the hand sweep missed. The
  env-read scan follows each app's import graph into `packages/`, because the bundle
  leg was shown to miss three of four planted reads. It also records, for PR 3.3, that
  the ward-console probe path would 404 behind a code-derived allow-list;
- on 2026-09-23, R-2026-09-23-64 (issued as R-PROVISIONAL-2026-09-23-AR): **the live-key
  probe runs on every ward-console deploy**, because no test in the repository can tell
  a live key from a dead one and the edge is therefore the only check; its signals were
  **observed before they were written**, and the observation moved the probe off the
  PostgREST root, where a live key and a dead key both answer 401 and only the body
  separates them, onto `/auth/v1/settings`, which separates them by status and body and
  is a settings read rather than a sign-in, so it stays inside `-23 D4`;
- on 2026-09-23, R-2026-09-22-63 (issued as R-PROVISIONAL-2026-09-22-AM, before AN):
  **Cowork handoffs no longer enter the repository**, `-58 B1`–`B3` are withdrawn and the
  committed kickoff's line naming a handoff is superseded without editing the kickoff;
  its check of both handoffs against the record found **two facts with no home** — the
  only statement anywhere of what the currently deployed ward console is built against,
  and the hosted auth-user total that is H2's baseline — which are given one, marked as
  relayed readings rather than readings taken here; and it records that one handoff was
  pasted truncated, so the check covers what arrived and no more;
- on 2026-09-23, R-2026-09-22-62 (issued as R-PROVISIONAL-2026-09-22-AL, before AN):
  **`-57 G5`'s gap is closed rather than carried** — the USAGE test must red when the
  privilege it probes is swapped, which a control holding both USAGE and CREATE could
  never show; it lists Cowork's untested "misspelled privilege" claim and the kickoff's
  backticked gitignored path as Cowork's errors, and specifies the nine things the PR 3.1
  report must quote rather than state, one of whose premises did not apply because
  `scripts/commit.sh` had been on `main` since 2026-09-11;
- on 2026-09-22, R-2026-09-22-61 (issued as R-PROVISIONAL-2026-09-22-AQ): **the
  publishable key becomes TRACKED**, because it ships in every client bundle by
  design and tracking it makes the stamped commit fully determine the built bundle;
  it asks which line of `-57`/`-58` it supersedes, and **the answer is none** — both
  blocks were read here in full and neither says it, the claim being mine in a
  template and a code comment written the same session, so the supersession is
  recorded against my text rather than against the record's; the objection that
  comment raised, that a tracked key makes the repository the place a **stale** key
  lives and a dead key fails in the direction that reads like the boundary holding,
  is answered by restating the rotation runbook so a rotation moves one tracked line
  in the same change, rather than being dropped as inconvenient; the tracked value is
  guarded by KIND and never by length — an `sb_secret_` prefix refused, a JWT decoded
  and its `role` required to be `anon` — and the secret scan is not widened in
  general but exempted by named file and named key; **and `-60` is extended to the
  process environment**, which disabling `.env` files does not reach at all, since
  Vite copies every prefixed `process.env` entry in afterwards and it outranks every
  file; it also records that **AL and AM never arrived**, applying the ledger's own
  rule that Cowork can be told which, so they will be numbered from the record's last
  when their text lands — after `-60` and `-61`, not before;
- on 2026-09-22, R-2026-09-22-60 (issued as R-PROVISIONAL-2026-09-22-AP): **a
  production build's output must contain no value sourced from any untracked file**,
  ruled on a finding of mine reported with `-59`'s last commit: Vite inlines the
  **whole** `import.meta.env` record rather than the keys a module reads, so a stale
  `VITE_SUPABASE_URL` in an untracked `.env.local` ships inside the built bundle —
  **the marker legs added by `-57` and `-58` prove `origins.json` is USED and never
  proved untracked values are KEPT OUT**, which is Finding D's hazard surviving the
  change written to close it; it requires the cause in the code be removed as well as
  guarded, and the cause was then **established rather than guessed** by reading the
  pinned Vite's installed source: bracket notation on `import.meta.env` misses the
  per-key define and hits the bare one, whose value is the entire serialized record;
  **one of my own premises fell in the process** — I had assumed bracket notation was
  forced by a compiler option, and it is not, `noPropertyAccessFromIndexSignature`
  being set nowhere here and dot access typechecking today unchanged, which is worth
  recording because the wrong reason would have outlived the right fix;
- on 2026-09-22, R-2026-09-22-59 (issued as R-PROVISIONAL-2026-09-22-AN): **the H1
  reading could not be taken at all.** `SUPABASE_URL` on the Pages project is an
  encrypted secret whose value the dashboard will not show, so the step `-58 A1`
  rested on asked for something that does not exist — **recorded as Cowork's defect,
  and not reissued in a more careful form**, because the defect is the assumption of
  a readable variable rather than the wording. The tracked key is set from Supabase's
  own project URL, **re-read here before it was written into anything** rather than
  relayed, and found to agree with the project id `supabase-proxy/index.js` already
  carries — **which is the finding, not the confirmation**: the origin now has two
  derivation sites in tracked code, and they are bound by an assertion in one block
  rather than left to agree by coincidence, the proxy deliberately not being made to
  import the package since it lives outside the workspaces. `-58 A1`'s claim that the
  change alters nothing about which origin the Function calls is **replaced by a
  weaker one that can be true**: the end state is the direct origin, and whether that
  is a change is **unknown**, because nobody could read what it was — if the secret
  held `api.openbed.ng`, this pull request takes the Worker off the `/beds.json` path,
  which is `-58`'s intent reached without confirmation that it was needed. The
  leftover secret becomes **dead config**, deleted only after a 200 from `/beds.json`
  on a deployment created from the tracked value, and re-observed after the deletion
  because a variable binds when a deployment is created. And one hazard is recorded
  from designing against B3: moving the origin onto the request's hostname would have
  turned two database legs into calls against **the live project with the local demo
  service-role key**, both asserting 200 throughout — closed by making the test
  helper local, and asserting it, in a commit that lands **before** the origin moves;
- on 2026-09-22, R-2026-09-22-58 (issued as R-PROVISIONAL-2026-09-22-AK): the founder
  answers PR 3.1's two open questions. **The public dashboard's snapshot Function keeps
  its direct origin** — a narrow exception to `-55 A`, on the ground that that ruling's
  three reasons (ISP blocks, portability, a place for rate limits) are about **browser**
  traffic, while a server-side call from Cloudflare is exposed to none of them and
  putting the Worker on the `/beds.json` path would add a failure point while `-23 D5`
  is open — **and its origin still becomes tracked**, under its own key set to the
  founder's H1 reading, with a test that the Function takes it from there and not from
  the Pages environment, so Finding D closes for Functions too and only the secret stays
  on the platform; the exception is scoped to that one Function, leaves the admin
  provisioning Function to PR 3.4's design report, amends the kickoff **in the record
  rather than in the document**, and carries a trigger that ends it when `-23 D5` closes;
  both handoffs land in PR 3.1 from the founder's paste; and **the top-level
  tracked-entry guard is pulled forward out of its trigger because the stray recurred** —
  checking that premise here found the first instance reached a commit and the second
  reached the index, neither caught by anything but a person looking, which is the case
  for the guard rather than against it;
- on 2026-09-22, R-2026-09-22-57 (issued as R-PROVISIONAL-2026-09-22-AJ, inside the
  Bundle 3 kickoff the founder pasted): **Bundle 3 becomes four pull requests in order**
  rather than one, because a migration adding operator write functions must not share a
  review with a wrapper refactor and a clinical-screen fix must not wait behind an admin
  app, with all record-only material riding the first; `-56 D`'s three grant gaps split
  two-in one-out, the hosted exposed-schemas list staying a hand reading **by design**
  rather than being closed by a test that would only appear to check it; **the
  build-stamp check is redesigned rather than rebuilt around**, on the finding that the
  defect is where the assertion lives — the property *the artefact uploaded names the
  commit deployed* is true only at upload time, so the readback moves into the deploy
  wrapper and the compliance test stops reading a shared build directory; ten
  architecture properties are set for admin v1, identity from `auth.uid()` **in the
  database** first among them, with provisioning forwarding a bearer rather than deciding
  who the caller is, the `-45` invite gate enforced in the database and not the UI, no
  personal-data entry in v1, and a freshness list that shows stale rows rather than
  filtering them; the founder brings the `(unknown facility)` renderer fix and a ward-side
  new-link request into PR 3.2, choosing the ward form over an operator resend because the
  identity model rests on physical control of the handset; **two of its premises did not
  survive checking** — the rebase it instructs was already done, and it carries one
  Clause 4 scope defect, a gitignored path cited in backticks that no guard can catch,
  listed and not fixed because the document was ruled to land unedited; **and a claim
  from my own planning tooling was refuted before it could cause harm**, having reported
  phantom `claude/` citations in the kickoff that do not exist, which acted on would have
  meant editing the one artefact that was not to be edited;
- on 2026-09-22, R-2026-09-22-56 (issued as R-PROVISIONAL-2026-09-22-AH): the
  **infrastructure review closes** on the founder's reads, with all seven of its
  scope bullets answered — the proxy kept, the stray Hello World Worker deleted, the
  ward-console Pages gaps folded into Bundle 3, `mail.` and `ftp.` gone and `www`
  turned from a 522 into a Pages custom domain returning 200, SSL moved to Full
  (strict), the §9 test account kept, and the undeclared hosted `ensure_rls` trigger
  established as **no drift today** with its PUBLIC EXECUTE shown to be inert because
  an event-trigger function cannot be called directly; **the `-40 H` gate on Bundle 3
  lifts** and its kickoff is Cowork's; **four of the review's own questions close with
  it unanswered** — the NDPA sub-processor scope, the surface, attribution and
  availability — and are recorded as open items with a trigger rather than absorbed
  into the closure; a lint requiring every `CREATE TABLE` in `public` to carry ENABLE
  and FORCE RLS in the same file joins Bundle 3, because on hosted the event trigger
  would otherwise enable silently what local lacks and the suite would run against a
  database looser than production; the question whether anything proves `anon` and
  `authenticated` cannot reach schema `app` is answered by quoting three existing
  tests **and naming their three edges** — a missing positive control, a hosted grant
  check covering one role and one privilege, and an exposed-schemas setting with no
  in-database representation; and three premises are refuted, two from the instruction
  and one my own — **no runbook step uses `dig` anywhere**, the resolver finding does
  not explain the 2026-09-19 contradiction because that lookup returned records and
  was run on another machine, and a DKIM absence I nearly recorded was a query that
  could not have returned what I concluded was missing;
- on 2026-09-22, R-2026-09-22-55 (issued as R-PROVISIONAL-2026-09-22-AG): the proxy
  review's keep-or-remove question is answered **KEEP**, against the criterion that
  ruling stated before it ran — portability of the client builds away from the
  Supabase project ref, resilience against an ISP-level block of the vendor apex, and
  somewhere to put rate limits in front of auth, with a nicer hostname explicitly
  refused as a reason; the same block records that **none of the three reaches
  production yet**, because nothing tracked sets the apps' origin and the name's
  liveness is still the recorded contradiction, so the decision is on the design and
  the property arrives with Bundle 3; the hardening the proxy has always lacked — a
  path allow-list read from the code with everything else answered 404 by the Worker,
  a deploy guard and build stamp, and four probes each with a demonstrated failing
  half — is added to Bundle 3 under `-54 A` item 2; where Supabase's magic-link emails
  point is left OPEN with the trigger "before facility one", because a `*.supabase.co`
  verify host would make the blocking protection incomplete and the answer costs
  money; and three founder reads are recorded, one of whose reasons is refuted — the
  stray Hello World Worker is deleted as unaccounted infrastructure rather than as
  something nothing cites, since six tracked files cite it;
- on 2026-09-22, R-2026-09-22-54 (issued as R-PROVISIONAL-2026-09-22-AF): Bundle 3's
  scope is ruled by the founder and **moved out of a handoff line into the record**,
  where it had been attributed to a ruling that did not carry it; the sensors, which
  no ruling had ever descoped and which lost their carrier when the name "Bundle 3"
  was re-pointed, are given their own bundle sequenced **before facility one**,
  because a dead scheduler after onboarding means stale beds shown to ambulances;
  the Pages cron-trigger check and method note 14, both pinned to the old meaning of
  the name, are re-pointed by note rather than by rewriting their sources; and a
  Cowork handoff document that my own `git add -A` swept into the AE commit
  unnoticed and unread is moved into `docs/` byte for byte, with the three findings
  recorded unsoftened — a commit whose report said it touched only the record, a
  clause in that same commit stating the document was not in the repository while
  the commit carried it, and a Cowork session writing into the tree the file its own
  text said it was keeping out;
- on 2026-09-22, R-2026-09-22-53 (issued as R-PROVISIONAL-2026-09-22-AE): the
  frozen-migrations placeholder derives its number from the recorded boundary
  instead of being moved by hand, so a hand-carried step whose stated mechanism had
  stopped reaching on the day it was last carried out is removed rather than
  guarded; the founder's demonstration could not be met as specified, because
  whether a stale placeholder reddened was an alphabetical accident of the real
  migration's name, so the leg gained a collision check that does not depend on
  spelling; **the first version of that check was a tautology — asserting that the
  highest frozen number plus one exceeds the count — and its own plant is what
  found it**; a false docstring written into the previous change's fix is
  corrected; and the two definitions of "Bundle 3" are reconciled, with the scope
  that binds it recorded as living in a handoff rather than in the ruling it is
  attributed to;
- on 2026-09-22, R-2026-09-22-52: **the hosted apply of 018, and with it the
  close of the accumulation boundary at 05:40:40 UTC** — the three public mirrors
  revoked from `anon` and `authenticated` and removed from the Realtime
  publication on the database a facility's data actually sits in, each reading
  paired with the opposite one taken minutes earlier on the same project, and the
  SECURITY DEFINER premise 018 was written on confirmed live by both cron jobs
  succeeding after the revoke; the frozen boundary recorded at 18; nine runbook
  sections restated by the change the restate rule actually asks for rather than by
  one catching up afterwards; the founder's path recorded as having failed twice on
  a missing `psql`, with every block that needs it now carrying step P's line
  itself and a guard deriving that line from step P; and two corrections to this
  project's own controls — an instruction that cited a mechanism which stopped
  reaching on the day it was last carried out, and a parser that read a
  restatement's quoted history as the live stop condition;
- on 2026-09-21, R-2026-09-21-51 (issued as R-PROVISIONAL-2026-09-21-AD): the
  founder's review of #62 found five defects and all five were upheld — the stop
  condition left contradicting the expectation it guards, a pre-apply block that
  could not run as pasted and silently disarmed another item's failing half, a
  cron check that would have stopped the founder on a healthy system because four
  of pg_cron's six statuses are non-terminal, a read-back in the wrong place, and
  a failing half claimed rather than demonstrated; and, found while fixing the
  first, a `\Z` in the guard's own parsers that JavaScript reads as a literal
  letter and that passed only because the corpus never took that branch;
- on 2026-09-21, R-2026-09-21-50 (issued as R-PROVISIONAL-2026-09-21-AC): the
  hosted runbook was not restated when #61 added migration 018, so its own stop
  conditions would have fired on a correct project — section 10's set-equality
  query returning `f` when everything was right; the restate-in-the-same-change
  rule is widened from section 5's list to every section of either runbook that
  states a hosted expectation a migration can change, with the quarter that is
  derivable from the repository mechanised and the three quarters that are hosted
  readings named as unbuildable; a pre-apply reading and an 018 read-back added so
  each half of the other is a demonstrated failing half; and the measurement that
  a dead key and a revoked table are indistinguishable locally and distinguishable
  on hosted, recorded where the probe that depends on it lives;
- on 2026-09-21, R-2026-09-21-49 (issued as R-PROVISIONAL-2026-09-21-AB): the
  ESLint ignore gap on wrangler build output — `.gitignore` marks `.wrangler/` and
  `.functions-build/` as generated in one breath and the ESLint config ignores only
  the second, so 67 errors sit in code nobody wrote and CI cannot see them because
  `repo-lint` never builds; assigned to the change that records the hosted apply of
  018 rather than left as an open item whose trigger nobody had scheduled, with the
  derivation and the same-job check each given a cheaper alternative that needs no
  new dependency;
- on 2026-09-21, R-2026-09-21-48: 018's two deferred decisions answered —
  `clientAddressableRelations` becomes empty, and the reversal is exact rather than
  withheld as 013's was — with the pre-condition discharged by enumerating every
  reader of the mirrors and its role, and with two findings recorded against the
  implementer's own work: a correct citation "corrected" into a falsehood after a
  partial read, and a plant that did not discriminate because the grant it planted
  was a no-op;
- on 2026-09-21, R-2026-09-21-47: the EVIDENCE gate on 018 LIFTED on the founder's
  quoted read-back against deployment `76fe917`, all four observations passing with
  the failing half demonstrated in the same sitting; AA recorded closed in
  PRODUCTION as distinct from merged, measured on the live bundle; origin offload
  measured as three edge requests to one origin read, with per-request attribution
  left NOT CONFIRMED and `edge_logs` ingestion lag measured at minutes;
- on 2026-09-21, R-2026-09-21-46: the pull-request freeze — T A4 restated after
  seven pull requests in one day, of which one changed anything a visitor could
  see, with the cause recorded as the implementer's own framing rather than the
  founder's rulings;
- on 2026-09-21, R-2026-09-21-45: the go-live trigger becomes a row rather than an
  occasion — before the FIRST hosted `app.facility` or `app.ward_account` row —
  placed on the provisioning script and in the hosted runbook as section 4b, with
  the facility-creation premise found false on checking and recorded as an open
  item, and the mechanical guard proposed rather than built;
- on 2026-09-21, R-2026-09-21-44 (issued as R-PROVISIONAL-2026-09-21-AA): invented
  bed counts were reaching real visitors on the live public domain, and the example
  data is deleted rather than guarded; the `golden` fixture moved out of the module
  the browser bundle inlines; scope held to what can reach a person today, with the
  rest becoming hard pre-facility-one gates;
- on 2026-09-21, R-2026-09-21-43: every corrected reason followed to the instruction
  it justified, with any instruction left without a reason flagged rather than
  silently kept or deleted; the stale-while-revalidate consequence sweep across the
  named sites; and the same-data-centre `cf-ray` precondition added to step 6 after
  six colos were observed in one day;
- on 2026-09-21, R-2026-09-21-42: the cache step had no observable that could take
  two values — `cf-cache-status` reads DYNAMIC on a route with no Function at all —
  so the Function now marks every response with `x-openbed-edge-cache` and the gate
  is lifted on the property rather than reinterpreted;
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

