# Decision Record — The public/private split: `openbed.ng` and `app.openbed.ng`

_Founder rulings, relayed 2026-09-14. Documents only: no schema, no code, no
projection change. Migration 014 stays on hold._

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
- in v2, the generator is `app.regenerate_snapshot()` — `SECURITY DEFINER`,
  EXECUTE granted to `service_role` only — writing `public.snapshot_current`
  (v2:215);
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
   service-role privilege (v1:235, v2:215), so **the public payload's shape is
   whatever the generator's column selection emits.** Step 6 does not touch
   that, and a green step 6 must never be read as covering it.

**What guards the snapshot's columns today: nothing.**
- **The generator is not built.** No definition of `app.regenerate_snapshot()`
  or `public.snapshot_current` exists under `database/`. The golden-path step
  that exercises them, `snapshot-regenerates`, lies beyond the ratchet frontier,
  which passes through `handover-lists-facility-wards` (`tests/e2e/frontier.json`).
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
| Email provider(s) | Magic-link and escalation mail | As recorded at the source | v2:322; clauseX:123 |

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

### O3. The facility's agreement to publish its live capacity

**It is not in clauseX.**
- Its drafting note defines `Purpose` narrowly — "operating the bed-visibility
  service and its operational notifications" (clauseX:22).
- **It grants no permission to publish a facility's live capacity.**

**This is a contractual permission from the institution, not a data-protection
consent.** `agreement_accepted_at` is explicitly not a consent record, and no
consent basis exists anywhere in this system (clauseX:96).

**The gap is recorded. The clause is not drafted.**

---

## What this record changes, and what it does not

**Changes:**
- the IP-derived step of v1:245 is retired (D4);
- an open processor-obligations list now exists (R3);
- one row is added to the runbook's un-automatable table (D2).

**Does not change:**
- v1:250 and v2:273 (O1);
- the snapshot and caching design (R2);
- any schema, projection, code or test;
- the hold on migration 014.
