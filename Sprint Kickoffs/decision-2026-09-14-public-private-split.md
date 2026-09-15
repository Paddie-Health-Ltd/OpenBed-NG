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
  - **The ruling asked for 003 to be edited. The standing rule forbids editing applied migrations 001–013**, so the correction is recorded here and in 016's header instead.

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

## Method notes — how rulings reach the implementer

_Standing rules, 2026-09-15. This record is their home._

1. **Every ruling block carries an id, `R-YYYY-MM-DD-nn`, on its first line.** The implementer states the id received before acting. A block with no id, or a stale one, is stopped and confirmed, never acted on.
   - **Why:** on 2026-09-15 a block from before #23 was pasted again. A wrong or stale paste is otherwise indistinguishable from a repeat, a silent transport failure of the same class as the zsh findings.
2. **Every load-bearing claim in a ruling is tagged observed or inferred.** Inferred means check before relying. This is `.claude/rules/test-conventions.md` §8 applied to the rulings themselves.
   - **Why:** the EXECUTE-default claim above. The error was of the class the ruling was enforcing.
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
  the runbook.

**Does not change:**
- v1:250 and v2:273 (O1);
- the snapshot and caching design (R2);
- any schema, projection, code or test;
- the hold on migration 014.
  - _Released later on 2026-09-14; see the note at the top of this record._
