# Sprint Kickoff — BedSpace / EBCS v1

Date: 2026-09-08 | Prepared by: Cowork sprint-push
Reviewed by: cto-persona, clco-persona, staff-engineer, platform-sre
Domain: `toni.health` | Escalation channel at launch: **email** (SMS behind the same adapter, deferred)

---

## Division of responsibilities

Claude Code implements, tests and ships the code in each bundle below. Cowork has done the scoping, bundling and specialist review — the decisions in this doc are settled inputs, not open questions. Where a specialist overturned an earlier decision it is marked **[REVERSED]** with the reasoning, so it can be argued with deliberately rather than drifted away from. The only genuinely open items are in *Open decisions needing your call*; do not guess at those.

**Read this section before writing any code.** Three findings are design-level and cannot be patched later. Two of them reverse decisions made earlier in the scoping session.

---

## The three findings that must land before any UI code

The CTO and staff-engineer reviews were run independently and converged on all three. That convergence is the reason they are treated as settled.

### F1. `accepting` must never be stored as a derived value

A ward's `accepting` flag is the **ward's own claim** and must be stored untouched, forever. The safety gate — anaesthetist off duty closes Theatre and Surgical, paediatrician closes NICU/SCBU, obstetrician closes Maternity — is **derived at read time**, in exactly one place, and written only into the public projection.

Why not a trigger: the anaesthetist goes off duty at 22:00 and the trigger clobbers the ward's claim. At 06:00 they are back and there is nothing to restore, because the claim was destroyed. It is also precisely the silent overwrite this design forbids admins from doing — a robot doing it faster and with no attribution. A generated column cannot read another table. Application-layer-only is not a safety rule, it is a rendering preference, and it will drift the moment a second reader exists.

The gate **reduces only**. A `YES` flag can never promote a ward that said it is not accepting.

### F2. The duty flags are a three-state enum, not a nullable boolean

`NOT NULL DEFAULT 'UNKNOWN'`. Only an explicit `NO` gates anything.

This is the highest-consequence bug available in this build and it looks like clean code. The natural instinct is `anaesthetist_on_duty BOOLEAN` and `if (!facility.anaesthetist_on_duty) closed = true`. On day one no facility has touched the flag, so that single line renders **every hospital in Lagos as closed**. In SQL the same expression is worse: `not anaesthetist_on_duty` on a NULL evaluates to NULL, which is not TRUE, so the row silently drops out of any filtered query while the JavaScript version reports it as truthy. The two layers disagree and neither errors.

Make the wrong shape unrepresentable in the database, and use `is false` / `is not false` in SQL — never bare `not`.

### F3. Freshness cannot be derived from the device clock — **[REVERSED]**

Earlier decision: staleness is a pure client-side derivation from `updated_at`, no job needed. The derivation is still client-side; the *time source* was wrong. A cheap Android with a three-hour-slow clock renders a four-hour-old row green. Three hours fast renders a ten-minute-old row grey. Both directions occur, and they occur most often on exactly the low-end devices this targets.

Server is the only time authority. Every fetch returns `server_now`; the client computes `skew = server_now - Date.now()` and anchors it against `performance.now()` (monotonic, survives a mid-session clock jump). Freshness is computed from the anchor, re-anchored on every fetch. **If skew has never been anchored by a successful fetch, the badge degrades to "age unknown" — never green.** Clamp negative ages to zero. Render absolute timestamps with an explicit `Africa/Lagos` timezone, not device locale.

Corollary: `updated_at` is set by a `BEFORE UPDATE` trigger using `now()`, and clients may never supply it. A ward phone with a fast clock writing a future timestamp stays green for hours after it stops being true, undetectably from the read path.

---

## Sprint scope

**In:** the visibility layer. Facilities publish per-category capacity; a referring clinician finds it, calls, and records what happened. Security boundary, escalation reliability, and the release gates that keep it honest.

**Out, explicitly** — v1 is *not* EBCS as described in the MSS 2.0 script, and the doc should say so wherever it is shown: no pre-arrival routing, no state coordination unit, no surge protocols, no transport integration, no ranking by clinical suitability, no triage, no ETA, no patient-specific input. Those last five are not merely out of scope; per the CLCO review, any one of them plausibly brings BedSpace inside medical-device regulation. Treat them as a permanent product constraint, not a backlog.

**Cut from sprint 1 by your own rule** (components not on the golden path): the hospital accuracy score. Capture the raw referral outcome data that makes it computable later; build no scoring, no weekly digest, no surfacing. It was already suppressed during pilot, so nothing is lost, and the CLCO review requires a contractual no-ranking commitment to facilities that this would sit uncomfortably against.

**Honest sizing:** bundles 1–7 below are roughly two sprints of work, not one. B1–B5 plus the thin slice of B6 are the golden path and belong together — the system does nothing useful until all of them exist. B7 runs alongside from commit one. The governance wrapper around discrepancy reports, the retention jobs, and accuracy scoring are named as Sprint 2 at the end. Do not compress B1–B5 to fit a week; B1 in particular is the entire security boundary of a public app whose database credential ships in the browser bundle.

---

## Architecture decisions that changed

### A1. Public reads are served from a static snapshot, not Realtime or PostgREST — **[REVERSED]**

The CTO and platform-SRE reviews reached this independently, for different reasons that happen to compound.

`GET /beds.json` is regenerated every 60 seconds and served from a CDN with `s-maxage=60, stale-while-revalidate=600`. It carries `server_now`, the facility list with lat/lng, and the ward projection as arrays-of-arrays (roughly a third the bytes of objects, which matters on 2G). The client does haversine locally, so **the user's coordinates never leave the device**.

What this buys, all at once:

- **Anon attack surface** collapses from "a query language over a dozen tables, with a published credential and a public repo explaining the schema" to one static file.
- **The Supabase free tier caps that would otherwise kill this at the worst moment:** 200 concurrent Realtime connections is about one WhatsApp forward, and connections past the cap are *refused* — the dashboard breaks for new arrivals while working fine for whoever got there first. Uncached egress of 5GB is roughly 250k dashboard views. A single news mention exceeds both in a day. Under the snapshot model a viral spike costs one origin read per minute regardless of whether ten people or half a million are watching.
- **It removes the most dangerous failure mode in the original design.** A dropped WebSocket looks open to JavaScript until a write fails, and Supabase Realtime has no gap-fill — events missed while disconnected are gone permanently. A tile could sit green and structurally incapable of being correct, looking *more* trustworthy than the truth. A 60-second snapshot poll cannot exceed one interval of undetected staleness.

**Realtime is retained for authenticated ward and admin devices only** — where a challenge ping must land now, and where the connection count is bounded by staff headcount rather than by public traffic.

**This changes the golden-path wording.** "Tile flips live via Realtime with no refresh" becomes "tile flips within 60 seconds with no refresh." Same user-visible behaviour against a freshness SLA measured in hours; a materially cheaper and safer system. If you want true sub-second public updates, say so and it comes back with the cost and connection ceiling attached.

One consequence to build deliberately: the "asked 40s ago, awaiting reply" state on a stale tile appears **immediately for the clinician who fired the request** (local optimistic state — safe, because it is not a capacity claim) and for everyone else in the next snapshot. Do not open a Realtime channel for anonymous clients just to carry this.

### A2. Public dashboard deploys to Cloudflare Pages, not Vercel

Vercel Hobby is non-commercial-use only. A donation-funded public service is a grey area and a Hobby suspension arrives with little notice — on the component most likely to go viral. Cloudflare Pages is free with no commercial restriction and unlimited static bandwidth. Authenticated app routes and the API stay on Vercel.

### A2b. Domain is `toni.health`, and it is doing compliance work as well as brand work

Public dashboard at `toni.health`, authenticated app at `app.toni.health`, transactional mail from `toni.health` (or a `mail.` subdomain — see the deliverability note in B5).

This is not only cosmetic. The CLCO review flagged the lead-generation accusation as a real strategic exposure: a free tool that looks like a Paddie Health property invites the reading that it is a sales funnel, and that accusation is credible on its face and damages the founder's credibility across all three entities. A visually and technically separate domain — separate site, separate sending reputation, separate notification infrastructure — makes the non-commercial covenant **structural rather than contractual**. It also satisfies the B2 requirement that the staff notification store share no infrastructure with any Paddie Health marketing system, since they no longer share a sending domain either.

One interaction to note: this partially answers open decision 3. "BedSpace" is arguably descriptive and therefore hard to register; "Toni" is not. If the product name follows the domain, the trademark problem largely dissolves. That is a naming decision, not an engineering one — flagged, not assumed.

### A3. RLS is not the boundary. Physical separation is.

**RLS is row-level. Every requirement here is a column requirement or an aggregation requirement, and RLS can express neither.** `reason_code` hidden while `bed_count` on the same row is public; staff mobile hidden while the facility's public line is public; quiet mode showing a coarsened version rather than filtering rows.

So: private base tables live in an `app` schema that is **not** in Supabase's exposed-schemas list, unreachable by PostgREST at any policy setting. `public` contains only publishable projection tables plus the RPC surface. RLS becomes the second line, not the only line. A design where the whole model is a `USING` clause on the table the ward writes to will leak the first time someone adds a column.

Three specifics that are easy to miss and each individually fatal:

- `SECURITY DEFINER` functions default to `EXECUTE` for `PUBLIC`, **which includes anon**. Every RPC needs `REVOKE EXECUTE ... FROM PUBLIC` then `GRANT ... TO authenticated`. This is the most commonly missed hole in Supabase projects and it bypasses every policy written.
- Every definer function needs `SET search_path = ''` with fully-qualified names, or a caller-controlled search_path is privilege escalation.
- Realtime `DELETE` events are **not** RLS-filtered, and `REPLICA IDENTITY FULL` ships the whole old row in the payload. Never delete from a published table (tombstone instead), and never set `REPLICA IDENTITY FULL` on anything in `app`.

### A4. Supabase region pinned to `af-south-1` (Cape Town) before any data exists

Keeps data on the continent, materially easier to defend under NDPA s.41 transfer rules, better Lagos latency. Region is fixed at project creation and painful to move. Treat as a launch blocker.

### A5. Attribution decays; the safety record does not

**[AMENDED 2026-09-08 — ward-level identity decision]** The original A5 design — an opaque `actor_id` plus a separate identity map, severed after a 90-day attribution window — is **superseded and not built**.

There are no individual accounts. An auth account represents a ward, or a facility for admin, never a natural person, so the audit log carries no personal data at all: there is nothing to map and nothing to sever. `actor_identity_map` does not exist. The actor is `(facility_id, ward_category)`.

This is net removal, and it removes the exposure rather than managing it. Storage limitation does not bite on a record with no personal data in it, so the audit log needs no retention period and no partitioning; append-only and permanent is correct. The two irreducible residues are the login address held by Supabase in `auth.users`, and one invited human per facility in `app.facility_contact` — business-contact data on a contract basis, deliberately outside the append-only set so it stays erasable. Neither touches the audit log or the event stream.

---

## Bundles

### Bundle 1: Foundation and the security boundary

**Why bundled together:** the schema, the gate derivation, the projection tables and the RLS/grant matrix are one artifact — each is meaningless and unsafe without the others, and every later bundle builds on their shape. The RLS negative-test suite ships in the same bundle because a boundary without a failing test is an assumption.

**Tasks:**

- [ ] Create Supabase project in `af-south-1`. Confirm exposed schemas = `public` (+ `graphql_public`) and **not** `app`.
- [ ] `app` schema with base tables: `facility`, `facility_ops`, `ward_status`, `ward_status_event`, `audit_log`, `ward_account`, `facility_contact`, `device`, `invite`, `challenge`, `referral`, `alert`, `notification_outbox`, `ward_alert_state`, `system_heartbeat`. `revoke all on schema app from anon, authenticated` plus default privileges revoked.
- [ ] Enums: `ward_category`, `tri_state` (`UNKNOWN`/`YES`/`NO`), `ward_offering`, `zero_reason`, `status_state`, `status_source`, `app_role`, `referral_state`, `refusal_reason`, `monitoring_state`.
- [ ] All duty flags `tri_state NOT NULL DEFAULT 'UNKNOWN'` (**F2**). All timestamps `timestamptz`, DB TZ UTC — a single `timestamp without time zone` in this schema is a defect.
- [ ] `ward_status` stores `accepting` as the ward's claim only, plus `version integer not null default 1`. `reason_code` **does not exist on this table** — it lives only in `ward_status_event`, so even a catastrophic policy error leaks a bed count, not a reason (**F1**).
- [ ] Three distinct states, never collapsed: `NOT_OFFERED`, offered-with-count-0, and offered-but-never-updated. `offering` enum + nullable `bed_count` + `monitoring_state`.
- [ ] `app.gate(category, ops)` — immutable SQL function, the single derivation site. `is false` only. Returns a gate reason or NULL; `UNKNOWN` and `YES` both return NULL.
- [ ] Projection tables in `public`: `facility_public`, `ward_public` (carrying `accepting_effective`, `gated_by`, `state`, `source`, `updated_at`), `lga_rollup`. Real tables, not views — Realtime cannot publish a view, and a table's column list can be asserted in CI.
- [ ] Projection trigger fires on **both** `ward_status` and `facility_ops`, recomputing affected mirror rows in the same transaction. A flag flipping back to `YES`/`UNKNOWN` un-gates the ward's original claim with zero human action.
- [ ] `gated_by` (public, derived from a public flag) and `zero_reason.NO_ANAESTHETIST` (private, ward-entered) must be different types with different UI strings. They collide by name and someone will render the private one because the switch matched.
- [ ] Quiet mode enforced in the **projection**, not a policy: a quiet facility's rows are simply not written to the public mirrors. Its contribution goes to `lga_rollup`.
- [ ] `lga_rollup` covers **quiet facilities only**, with a k-floor of 5 reporting facilities and no facility exceeding 40% of the denominator. A rollup mixing quiet and visible facilities lets an attacker subtract the visible ones and recover the quiet one exactly — quiet mode would be theatre.
- [ ] Append-only enforcement on `ward_status_event` and `audit_log`: `REVOKE UPDATE, DELETE` from **all** roles including the writer, **plus** a `BEFORE UPDATE OR DELETE` trigger that raises. Grants alone do not stop a service-role script.
- [ ] Read RPCs hard-capped: ≤200 rows, ≤30-day window, no deep offset paging, no CSV. A legitimate caller must not be able to assemble a time series.
- [ ] Nigeria bounding-box `CHECK` constraints on lat/lng — catches transposed or DMS-parsed coordinates that would put a facility in Cameroon.
- [ ] Indexes: `ward_public(category) where accepting_effective`, `ward_public(updated_at desc)`, `facility_public(lga)`, `ward_status(updated_at) where offering='OFFERED'` for the sweep, BRIN on both append-only tables' `created_at`, `referral(facility_id, state, created_at desc)`. **No PostGIS** — a few hundred facilities is one payload, sorted client-side.
- [ ] Seed script, synthetic only, covering: a quiet facility, a facility with `anaesthetist='NO'`, a facility with all flags `UNKNOWN`, a ward at zero with a reason, a `NOT_OFFERED` ward, and a never-updated ward.
- [ ] **RLS negative-test suite** (release gate 1). Reachability: anon cannot address any `app` table. Column containment: enumerate `information_schema.columns` for every anon-readable relation and assert the set contains none of `{reason_code, mobile_e164, admin_note, refusal_note, ward_reply, token_hash, fingerprint}`; assert `ward_public`'s column list equals a frozen expected list exactly. Writes: anon insert/update/delete on all three mirrors fails. RPC: enumerate every `public` function with `EXECUTE` for `PUBLIC`/anon and assert against an empty allowlist; assert every definer function has `search_path=` in `proconfig`. Quiet mode: zero rows for the quiet facility, every rollup row at k≥5. Cross-tenant: ward staff at A cannot write to B. Append-only: service-role update/delete raises. Config drift: `pg_publication_tables` for `supabase_realtime` equals exactly the three mirrors; no published table has `relreplident='f'`; no anon policy outside the allowlist; grep the built bundle for `service_role`.
- [ ] **First assertion in the file, named so the failure message explains itself:** a facility with all flags `UNKNOWN` and `accepting=true` yields `accepting_effective=true, gated_by=NULL`. This is the "a never-set flag must not close the whole city" regression test.
- [ ] Truth-table test: 3 flag states × 8 categories × 2 claim values = 48 asserted rows, run against the SQL derivation **and** any client mirror of the rule, identical expected output.
- [ ] Gate semantics: `anaesthetist='NO'` closes Theatre and Surgical while `ward_status.accepting` remains true; flipping to `UNKNOWN` restores it with no write to `ward_status`; `anaesthetist='YES'` never promotes a ward that said no.

**Specialist input incorporated:** CTO supplied the two-schema separation, the gate function, the projection-table design and the negative-test list. CLCO required the `af-south-1` pin, the decaying-attribution split, the k-floor as a number, and the removal of `refusal_note` free text. Staff-engineer supplied the tri-state truth table, the version column, and the three-distinct-states requirement.

**Safety/quality notes:** the `refusal_note` free-text field from the first schema draft is **removed** — enums only. Free text is where "the 24yo primip from Ikorodu we called about at 3am" ends up, which breaks the no-patient-data invariant that is this project's single most valuable compliance asset. `ward_reply` is **kept** (capped, private, never public) because the CLCO review requires a right of reply as the qualified-privilege defence on discrepancy reports; it carries an explicit no-patient-information validation and the same retention as attributed log entries.

**Blast radius:** F1 and F2 change the shape of `ward_status` and `facility_ops` before any consumer exists, so nothing shipped is affected. The projection-table design replaces the assumed direct-read model in the original spec — every downstream bundle reads mirrors or RPCs and none reads a base table, which B4's and B7's tests assert. The `reason_code` relocation to the event table means the ward console must read it via RPC rather than from the live row; B3 accounts for this.

**Definition of done:** every negative test passes; the truth-table test passes against both derivation sites; a hand-run `select *` with the anon key against every `app` table errors; the seed loads and the mirrors are correct for all six seeded shapes.

---

### Bundle 2: Identity, invitation and attribution

**Why bundled together:** the entire governance model — audit log, admin challenge, escalation, discrepancy reports — rests on knowing *which person* published a number. If attribution is weak, none of it means anything, so it is built and proven before any write path depends on it.

**Tasks:**

- [ ] Invite-only onboarding. No public self-registration route exists.
- [ ] Magic link **single-use, short TTL**, to the ward's own mailbox or duty handset, exchanged immediately for a short session. **[AMENDED 2026-09-08 — ward-level identity decision]** Access follows **physical control of the ward device** — the control the facility already exercises and we never could. There is no second-device refusal: the alert had no consumer, and its mechanism fingerprinted the unauthorised device, which is by definition the personal phone the link was forwarded to.
- [ ] ~~**Shift-handover re-identify**~~ — **removed.** **[AMENDED 2026-09-08 — ward-level identity decision]** There is no person to re-identify. A shared *password* would be the anti-pattern; a short session on the ward's own handset is not one, because a leaver who no longer holds the handset loses access by default.
- [ ] Roles: `WARD_STAFF`, `FACILITY_ADMIN`, `PLATFORM_ADMIN`. **[AMENDED 2026-09-08 — ward-level identity decision]** **No `REFERRER`** — it permitted an account with no facility and no ward, which is an individual account wearing a role name. A `ward_account_scope_matches_role` CHECK now has no arm permitting a facility-less account. Anonymous public read needs no account.
- [ ] `app.assert_member(facility_id, required_role)` reading `auth.uid()`, called at the top of every RPC. **Never** trust a `facility_id` argument alone.
- [ ] Device binding records a token **hash** against a ward account. **[AMENDED 2026-09-08 — ward-level identity decision]** No `fingerprint` column and no mismatch alert: a header-derived fingerprint is a `user_agent` by another name, and the audit row bans `user_agent` outright. If it ever ships it is a per-facility salted hash, so what is held is a count of distinct devices rather than an identifier of one.
- [ ] `facility_contact` — **one invited human per facility** (CMD or matron), business-contact data on a contract basis. **[AMENDED 2026-09-08 — ward-level identity decision]** Replaces `staff_contact`, which held per-person mobiles and is exactly what this decision removes. Reachable only by the service role from the notification route, and deliberately **outside** the append-only set so the row stays erasable on request. Prefer a facility role address over a named individual's.
- [ ] Facility-admin **deactivate-account** action. **[AMENDED 2026-09-08 — ward-level identity decision]** The offboarding gap closes **structurally**: nobody has an account to orphan, so there is no nightly inactive-account job and no rotation reminder. What replaces it is a facility-agreement line — when someone with access to the ward handset or mailbox leaves, the facility rotates it — and the short session absorbs the case where they do not.
- [ ] ~~Staff privacy notice at activation~~ — **void.** **[AMENDED 2026-09-08 — ward-level identity decision]** Its required content was that the facility administrator can see *her* updates and when *she* made them. That is no longer true of anything: writes are attributed to a ward. There is no personal data to give notice about, so `privacy_notice_accepted_at` does not exist. **Open, and deliberately not decided here:** if an onboarding acceptance record is still wanted, its natural home is `app.facility_contact` — but adding that column is a decision this memo did not make.
- [ ] Notification contact store **physically separate** from any Paddie Health marketing infrastructure: no shared table, no shared list, no shared provider account. This is what makes the non-commercial covenant credible rather than aspirational.

**Specialist input incorporated:** staff-engineer identified the forwardable-link and shared-handset attribution failure as load-bearing under the whole governance story. CLCO supplied the lawful basis (legitimate interests, not consent — an employee cannot freely consent to her employer), the optionality of the phone number as data minimisation, the offboarding gap, and the infrastructure-separation requirement.

**Safety/quality notes:** the offboarding gap is a pre-existing hole in the original spec, fixed here rather than ticketed — an orphaned account at a hospital is a security failure and a data-protection failure simultaneously.

**Blast radius:** attribution shape is consumed by B3 (write attribution), B5 (who gets escalated to) and B6 (who filed a report). All three are in this sprint and specified against this model. The optional-phone-number decision means B5's dispatcher must handle a recipient with no SMS channel — covered in B5.

**Definition of done:** **[AMENDED 2026-09-08 — ward-level identity decision]** a forwarded magic link cannot publish; deactivation immediately blocks publish.

Three of the original five criteria are **void**, not deferred, because ward-level identity removed what they measured. *A second device is refused and logged* — the alert had no consumer, and its mechanism fingerprinted the unauthorised device, which is by definition the personal phone the link was forwarded to; capturing an identifier of a personal device is the thing the design removes. *A shift handover changes the attributed actor* — there is no attributed actor. *The activation notice is recorded with a timestamp* — the notice said the facility administrator can see a named nurse's updates, which is no longer true of anything.

What replaces them is not a workflow: access follows physical control of the ward handset, so someone who leaves and no longer holds it loses access by default, with no revocation step for anyone to remember.

---

### Bundle 3: Ward write path

**Why bundled together:** one screen, one transaction boundary. The counter, the zero modal, the concurrency model, the admin challenge and the audit write are a single atomic unit of behaviour and cannot be verified apart.

**Tasks:**

- [ ] One `SECURITY DEFINER` RPC per user action. Status + event + audit + escalation-outbox row commit or roll back **together**. The client never issues more than one call per action — three PostgREST calls with a dropped MTN connection between the first and second produces a published bed count with no audit record.
- [ ] `publish_ward_status(category, offering, bed_count, accepting, reason, expected_version, client_mutation_id, composed_at)`.
- [ ] **Optimistic concurrency, not locking.** `where version = $expected`; zero rows returns 409 with the current row attached. On 409 **do not auto-retry with the fresh version** — that is last-write-wins with extra steps. Show the conflict: *"Amina set this to 4 twelve seconds ago"* or *"An admin has challenged this — please re-confirm."* Friction is correct here.
- [ ] Counter taps are **local state only**. The +/- control encodes an intent ("one bed taken") but must transmit an absolute value with an expected version, or two nurses on two devices silently overwrite each other.
- [ ] Zero path: mandatory `reason_code` from one-tap chips, whole flow under three seconds, no free text. Raises `ZERO_REQUIRES_REASON` without one.
- [ ] Admin challenge: sets `state='UNDER_REVIEW'`, **never touches** `bed_count` or `accepting`, enqueues a ward ping. Challenge bumps `version`, so an in-flight nurse write cannot silently clear the review flag.
- [ ] Admin publish: `source='ADMIN'`, mandatory `admin_note`, prior value preserved in the event log, and the public tile renders "set by admin, not ward-confirmed".
- [ ] **No Background Sync registration for bed writes, ever.** That API is the resurrection mechanism. Writes are foreground-only with a hard 8–10s timeout and a visible pending state. A queued bed count is strictly worse than a failed one: the payload is an absolute assertion about *now*, and replaying it at T+15min manufactures a green badge for data that was already stale when queued — while the optimistic UI has told the nurse it published, so nobody re-checks.
- [ ] Bounded safe exception: same-request retry for ≤90s **while the screen is open and the user can see it**, then discard with an explicit message.
- [ ] Server rejects `now() - composed_at > interval '2 minutes'` with `409 STALE_MUTATION`. Build this even if no queue is ever built — it makes any rogue replay (resurrected service worker, retried fetch, back button) harmless by construction.
- [ ] Optimistic UI renders a pending value as visibly unconfirmed (dashed, "sending…"), never as published, with no success toast before the 200. On failure it reverts to the **server's** last known value and says: *"Not sent — no network. Your ward still shows 4 beds to the public. Retry?"* That second sentence is the whole design; the nurse needs to know the public state, not that her tap failed.
- [ ] Single in-flight write per ward; publish disabled while pending; out-of-order responses applied only if newer than the rendered version; idempotency on `client_mutation_id`. `touch-action: manipulation`, `pointerup` not `click`, large hit targets, confirm step above a delta threshold, `check (bed_count between 0 and 500)`.
- [ ] Gate notification: when a duty flag closes a category, the ward is told — *"your Theatre is showing closed because anaesthetist is marked off duty; confirm or correct."* Gating silently is how wards conclude the tool lies about them and stop updating.
- [ ] **Parked-at-1 detection:** flag wards sitting at exactly 1 for over N hours for admin challenge.

**Specialist input incorporated:** staff-engineer supplied the concurrency model, the queue prohibition, the `composed_at` server gate, the double-submission controls and the parked-at-1 finding. CTO supplied the single-RPC-per-action transaction boundary and the error contract (`42501` for role violations, `P0001` with stable machine-readable codes for business rules — clients map codes, never message text).

**Safety/quality notes — a design-induced defect fixed here, not ticketed.** Setting 0 costs a modal, a reason code and an alert to your boss. Setting 1 costs nothing. Staff will find this within a fortnight, and chronic "1 bed" that is actually 0, wearing a green badge, is the most misleading state this system can produce. It will not appear in any test written against the spec, because the spec is what causes it. Two-part fix: make honesty cheap (one-tap chips, sub-three-second flow) and detect the residue (parked-at-1 flag).

**Blast radius:** the version column added in B1 is consumed only here and by B5's challenge path — both in this sprint. The `reason_code` relocation means the ward console reads reasons via `my_facility_wards` rather than the live row; confirmed the public mirror never carries it, which B1's column-containment test asserts. The `composed_at` rejection window interacts with B4's snapshot cadence only in that a rejected write never reaches the mirror — no stale-mirror path exists.

**Definition of done:** two simulated concurrent nurses produce a visible conflict rather than a silent overwrite; an admin challenge survives an in-flight nurse write; a write composed 3 minutes earlier is rejected; a failed write leaves the UI showing the server's value with the public-state message; zeroing without a reason is impossible.

---

### Bundle 4: Public read path

**Why bundled together:** the snapshot generator, the client derivation and the tile are one contract. Splitting them guarantees the freshness rule gets implemented twice and drifts.

**Tasks:**

- [ ] Snapshot generator: service-role, server-side only, reading the three mirrors, emitting `server_now`, a version counter, and arrays-of-arrays. `Cache-Control: public, s-maxage=30, stale-while-revalidate=300`.
- [ ] Deploy the public dashboard to Cloudflare Pages (**A2**).
- [ ] Client haversine sort. Coordinates never leave the device — not in a query string, not in a payload.
- [ ] Skew-corrected freshness per **F3**, with the never-anchored case degrading to "age unknown", never green.
- [ ] Freshness bands `<60min` green, `1–2h` yellow, `>2h` grey, with the **absolute timestamp always shown** — "Updated 04:12, 8 Sep", not only "5h ago". Relative times are ambiguous and screenshot badly, and screenshots are what circulate.
- [ ] **Sort key is `(freshness_bucket asc, distance asc, facility_id asc)`.** Freshness may reorder; it may **never** filter. The stable third key prevents the list reshuffling on every update and losing the user's scroll position mid-decision.
- [ ] Grey tiles prefix the count with **"last known"**.
- [ ] **Hard staleness ceiling at 24 hours — [REVERSED, partially].** Beyond 24h the count is **suppressed entirely** and the tile reads "Status unknown — call to confirm", retaining the facility and the phone number. Grey-badging a 5-hour-old count at 4am is correct and stays. Showing a 3-day-old "4 beds" is indefensible in any forum — it is noise wearing a signal's clothes. The CLCO and staff-engineer reviews converged on this independently and the CLCO named it the one change to insist on before launch.
- [ ] **Call is the only full-width primary action** on every tile. The bed count is visually subordinate to the phone number. Numbers stored E.164 (`+234…`) — a locally formatted `0803…` in a `tel:` link fails from a roaming or dual-SIM handset.
- [ ] Geolocation must **never block first render.** Render immediately, re-sort when a fix arrives. `{timeout: 5000, maximumAge: 60000, enableHighAccuracy: false}` — high accuracy indoors on a low-end Android burns 20 seconds and battery for a worse answer. Reject any fix with `accuracy > 10000m`, outside the Nigeria bounding box, or exactly (0,0).
- [ ] Fallback order, and the list is never empty and never gated on permission: valid fix → distance; else user-selected LGA persisted and exposed as an **always-visible primary control, not an error-path fallback**; else IP-derived state as a labelled editable guess, never silent; else alphabetical within last-used LGA. Accuracy over 1000m shows "~5 km", never a false-precision "2.3 km". Label distances "straight-line" — haversine does not know about the Third Mainland Bridge.
- [ ] Update-request: optimistic local state for the requester, reflected for others in the next snapshot. Rate-limited per device, per IP, per facility per hour, with a global cap per ward; deduped so later requesters join one open request; TTL so "asked 40s ago" expires to "no reply after 10 minutes" rather than counting up forever, worded so it never implies a reply is coming. Anchored to server time.
- [ ] **First-run interstitial**, once per device, explicit tap-through: what this is, what it is not, call before you travel. Logs local acceptance — which also converts the terms from browse-wrap to click-wrap, materially strengthening enforceability given there is no consideration.
- [ ] **Persistent non-dismissible banner** on the results view carrying "indicative — call before you travel". Not a footer.
- [ ] **Permanent emergency strip** on every page with 767 / 112 and LASAMBUS. In an emergency nobody reads; the app must always have a safe fallback path.
- [ ] `noindex`, no sitemap, no public API, no bulk export, no facility-level time series in any view. Rate-limit the public surface — named wards' duty numbers are an obvious prank-call and harassment vector.
- [ ] **Service worker: data routes are `NetworkOnly`.** No `StaleWhileRevalidate` on `/rest/v1/*`, any RPC, or the snapshot — this is the default Workbox recipe everyone copies and it will paint yesterday's bed counts under a full green badge. Cache only hashed JS/CSS, fonts, icons, shell. Never cache the magic-link route or persist the device token in Cache Storage. Offline fallback renders **no tiles** — text only: "BedSpace can't reach the network. Any numbers you saw may be wrong. Call the facility." Ship a `/version` check with forced reload on mismatch.
- [ ] **Server-side log of what was actually displayed** per facility-ward per time window, retained 24 months. If there is ever a coronial inquiry or a claim, this is the difference between proving what the screen said and reconstructing it from a mutable table. Costs almost nothing.

**Specialist input incorporated:** CTO and platform-SRE jointly produced the snapshot architecture and its cost rationale. Staff-engineer supplied the six 4am break modes, the sort-collapse finding, the geolocation fallback ordering and the service-worker cache prohibitions. CLCO supplied the 24h ceiling, the interstitial, the emergency strip, the call-primacy rule and the display-state log.

**Safety/quality notes — the 4am gate (release gate 3).** The likeliest ways this breaks, in descending order: `where updated_at > now() - interval '2 hours'` in the query; a client-side `if (isFresh(x))` before render; `order by updated_at desc limit 20` truncating the stale tail, which at 4am is the entire result set; an `if (fresh.length === 0) show "no beds available"` branch; a "hide stale" toggle defaulting on; a cron that expires untouched rows to `accepting=false`; an hourly materialized view that drops old rows. Subtler and more likely to survive review: **the sort collapses** — `order by updated_at desc` puts a fresh facility 90km away above a stale one 2km away, and at 4am degenerates to "whoever last touched the app", which correlates with nothing clinically useful.

**Blast radius:** the snapshot replaces direct anon PostgREST reads, so B1's anon `SELECT` grants on the three mirrors become defence-in-depth rather than the serving path — the negative tests still assert them, since the grants remain and a future contributor may add a direct read. The 24h ceiling changes what B5's escalation sweep considers actionable: a ward past 24h is still escalated (silence is the trigger), but its number is no longer published — the two thresholds are independent and must not be shared as one constant.

**Definition of done:** all three release gates green (below); the interstitial, banner and emergency strip present; a denied geolocation permission still yields an ordered non-empty list; the offline page shows no tiles.

---

### Bundle 5: Escalation and notification reliability

**Why bundled together:** the sweep, the outbox, the suppression state machine and the dispatcher are one control loop. Any piece alone either fails silently or spams a matron into muting the channel permanently, which kills the anti-gaming mechanism the whole verification model rests on.

**Tasks:**

- [ ] **Transactional outbox.** The escalation row is enqueued in the same transaction as the write; a separate dispatcher (`FOR UPDATE SKIP LOCKED`) delivers with exponential backoff, dead-letters after N attempts, and surfaces the dead-letter queue on an admin screen. Never fire-and-forget from the write path — an SMS provider timeout must not roll back a bed count, and a lost notification must not be invisible.
- [ ] **Idempotency key: `unique (ward_id, cause, episode_start)`** where `episode_start` is the ward's `updated_at` at the moment staleness began and does not change until the ward actually updates. The sweep is then a single `INSERT ... SELECT ... ON CONFLICT DO NOTHING`. Running it twice, concurrently, from two triggers is free — which is what makes the dual scheduler below cost nothing to reason about.
- [ ] **`monitoring_state`: `PENDING → ACTIVE → PAUSED`.** A ward is PENDING until its first successful update from a logged-in device; the public tile reads "not yet reporting" and **no silence alert ever fires**. Staleness is only meaningful for a ward that has demonstrated someone can and will update it. This makes the first night generate zero alerts by construction rather than by special case. Then a **72-hour grace period** on newly ACTIVE wards: in-app warnings only, no SMS.
- [ ] **Quiet hours, default 22:00–06:00 WAT, per facility.** SILENCE alerts accumulate and fire as one 06:00 digest. ZERO events and admin challenges still go through at night, because a human deliberately caused those.
- [ ] **Threshold varies by time of day: 2h daytime, 6h overnight.** Without this the 06:00 digest still lists every ward in the system every single morning — the same uselessness, one hour later.
- [ ] Thresholds evaluated in `Africa/Lagos`, not UTC. A one-hour offset bug moves the quiet-hours boundary and produces a 05:00 storm, and it is the likeliest cause the first time one appears.
- [ ] **Escalating cooldown** within an episode: immediate → +2h → +6h → +24h, capped. A ward stale three days produces 5 alerts, not 288. Cooldown is per `(ward_id, cause)`, so a ZERO during an ongoing SILENCE episode still gets through.
- [ ] **Batching** — one message per recipient per 5-minute window. Forty wards stale at 03:00 becomes one SMS: *"9 wards stale at Lagos Island GH: A&E, NICU, Male Med, +6 more"*. Hard cap 6 outbound per recipient per hour, then an hourly digest.
- [ ] **Global and per-facility kill switch**, one config row, operable from a phone at 2am.
- [ ] **Never silently drop.** Every suppressed alert is written with `state=SUPPRESSED` and a reason. The suppressed count per ward is both the gaming detector and the only later evidence that suppression is not hiding real failures.
- [ ] **Ack ends the episode.** One tap on a tokenised link in the SMS, no login required.
- [ ] **Notification adapter with pluggable channels and a per-facility channel preference.** Ship with `email` and `in_app`. `sms` and `whatsapp` are implemented as adapter stubs with tests, wired but disabled by config, so enabling SMS later is a config flip and a credential — not a refactor. **Nothing outside the adapter may know which channel was used.**
- [ ] **Email is the primary escalation channel at launch — [CHANGED].** SMS moves behind the same adapter and arrives when sender-ID registration lands across all four networks. Rationale and the consequence this carries are in the safety notes below; the design does not merely swap a transport.
- [ ] Provider: a transactional email API with per-message delivery webhooks (Resend, Postmark or SES). **Confirm the current free-tier daily and monthly caps before committing** — a daily cap is the one that bites on a bad night, and batching is what keeps volume inside it. Do not use a personal SMTP account.
- [ ] **SPF, DKIM and DMARC on `toni.health` before the first send, verified with a real test to Gmail, Yahoo and Outlook mailboxes.** Nigerian facility admins are heavily Gmail and Yahoo. An unauthenticated brand-new domain lands in spam, and that is precisely the same silent-drop failure the SMS carrier-bind problem would have caused — different carrier, identical symptom, identical invisibility. Consider a dedicated `mail.toni.health` sending subdomain so a deliverability problem on transactional mail cannot damage the root domain's reputation.
- [ ] Warm up gently: real volume is low, which helps. Keep the first week's sends to the pilot facilities only.
- [ ] **Prefer facility role addresses over individual ones** — `matron.nicu@hospital` rather than a named person's inbox. It survives staff turnover, and a role address is not personal data at all, which is a genuine improvement on the SMS design's personal-mobile requirement. Individual addresses are accepted but flagged for the retention schedule.
- [ ] **In-app and push are escalation *suppressors*, not replacements.** Alert enters the outbox → in-app and push fire immediately → if the admin acks inside the 5-minute batch window the email is never sent. Same architecture as the SMS design; the economics simply matter less until SMS is live.
- [ ] Plain-text-first email with the tokenised one-tap ack link as the only call to action. No images, no tracking pixels, minimal HTML — better deliverability, and it removes a category of consent question. Subject line must carry the facility and the count so it is actionable from a notification preview without opening: `[Toni] Lagos Island GH — 9 wards stale overnight`.
- [ ] Wire bounce, complaint and delivery webhooks to update outbox rows. **Hard-bounce is a dead address: mark the recipient unreachable, surface it on `/status`, and stop sending — never retry.** Same rule as a 410 on a push subscription.
- [ ] Ward-side: do not attempt to make push reliable. The primary channel is the app being open — Realtime plus a persistent on-screen state plus audible/vibrate while foregrounded, and the public tile showing the pending request. Make ward *non-response* visible instead, which is what the escalation path is for.
- [ ] Delete push subscriptions immediately on 404/410; never retry them. Service worker `fetch('/api/notif/ack')` inside the `push` handler — ten lines, and the difference between an unobservable channel and an observable one.
- [ ] **Weekly "reply OK" check — moved up from Sprint 2, and it is now load-bearing.** Any facility with no alert and no ack in 7 days gets *"System check — all quiet at [facility]. Reply OK."* One message per facility per week. With SMS this was a nice-to-have on top of carrier delivery receipts; with email it is **the only real evidence that mail is reaching an inbox rather than a spam folder**, because no provider webhook can tell you the difference. It converts every admin into a delivery sensor and it is how you learn an address has gone stale.
- [ ] **Dual scheduler into one idempotent function:** pg_cron every 10 minutes, plus an external caller (cron-job.org, 1-minute granularity, free, emails on failure) hitting `/api/sweep` every 15 minutes behind a shared secret. Rationale: Supabase pauses free projects after 7 days of low activity, **pg_cron's own activity does not count toward preventing the pause**, and when paused the sweep stops silently — pg_cron cannot report its own death because it *is* the thing that is off. The external caller is a sensor that does not share the failure mode it measures, and its traffic doubles as the keep-alive. It also survives a restore or a branch migration leaving `cron.job` empty, which errors nowhere. Do **not** use GitHub Actions: scheduled workflows run 10–30 minutes late, are dropped under load, and are auto-disabled after 60 days without a commit.
- [ ] **`/api/health` returns 500 if `now() - system_heartbeat.last_sweep_at > 45 minutes` or the database is unreachable**, polled every 15 minutes by the external scheduler, which emails on non-200. The sweep writes `last_sweep_at` on every run. One external prober, one non-200, one email — and it is the only sensor that survives Supabase being entirely paused. Second condition on the same check: zero notifications reached DELIVERED or ACKED in 24h while at least one was QUEUED, which catches a healthy sweep with a dead delivery layer.
- [ ] **`/status` founder page**, token-gated, sub-second: `last_sweep_at` and age; alerts created/sent/delivered/acked over 24h and 7d; **median time-to-ack over 7 days** (the only number that actually says whether this works); wards by `monitoring_state`; ACTIVE-but-never-updated count; dead subscriptions pruned; email sent/delivered/bounced/complained; **unreachable recipients** and **facilities with no ack in 14 days** — the two rows that reveal a spam-folder problem; top 5 wards by suppressed-alert count; facilities with zero updates in 7 days; synthetic probe status per mailbox provider. Add SMS spend and remaining provider credit here when SMS goes live: running out of credit is a silent total outage of a primary channel.
- [ ] **Daily digest at 07:00 WAT, sent by the external prober, not by Supabase**, so it arrives when Supabase is dead. **It must arrive every single day, including when everything is fine** — an alert-only email trains you to read silence as health, which is the exact failure being prevented. A missing 07:00 email is itself the alert, and the one that gets noticed.
- [ ] **Synthetic delivery probe, daily.** A real alert against a hidden test ward at a hidden test facility, routed to one mailbox per provider the pilot admins actually use — Gmail, Yahoo, Outlook — each acking back via the tokenised link. Any provider failing to ack within 30 minutes leads the daily digest with `PROBE FAILED: YAHOO`. Free. The ack has to be tapped by a human or forwarded by a rule, which is weaker than an SMS delivery receipt — hence the weekly reply-OK check above as the second, independent sensor. When SMS goes live, extend the same probe to four SIMs (MTN, Airtel, Glo, 9mobile) at roughly ₦420/month.

**Specialist input incorporated:** platform-SRE produced this bundle almost entirely, and overturned the flat 24/7 threshold. COO-adjacent human-workflow concerns (who actually responds, and how a matron avoids muting) are folded into the quiet-hours and batching design rather than reviewed separately.

**Safety/quality notes — a locked decision preserved by changing its implementation.** "Silence escalates identically to zero" is the anti-gaming control and it stays. But a flat 2-hour threshold applied 24/7 fires on essentially every ward at 01:00 daily, because nobody updates a bed board overnight — and every matron mutes the channel inside a week, which destroys the control entirely. The PENDING state, quiet hours, the overnight threshold, the escalating cooldown and the batching all exist to keep the principle while making it survivable.

**What starting on email actually costs, and why the design still holds — [CHANGED].** Email unblocks launch this week: no CAC entity, no sender-ID registration, no DND bind, no per-network staggered rollout, no per-message cost. Take it. But be clear about what changes, because it is not just a transport swap.

With SMS, an escalation is *"wake the matron now."* With email it is *"the matron sees this when she next opens her inbox"* — realistically the next working morning, and a matron on a ward at 3am is not reading email. So **the escalation's latency profile drops from minutes to hours.**

That is survivable, and it is survivable for a specific reason: this escalation was never an emergency page. It is an **accountability record** — the control that makes a lazy decline or a silent ward visible to someone with an incentive to query it. Accountability tolerates next-morning latency. Two consequences follow, both of which simplify the build:

- **The 06:00 digest becomes the primary artifact** rather than a quiet-hours concession, with individual alerts secondary. The quiet-hours design was already right; email makes it obviously right, because there is no one to wake.
- **Nothing time-critical may be built on this channel.** The referrer's update-request and the admin challenge still reach the ward through the app being open and the public tile showing the pending state — not through email. Do not let any future feature assume an escalation arrives promptly.

When SMS lands, flip the config and the latency profile returns. Nothing else changes.

**And the way this system is most likely to be quietly broken for a week — the failure survived the channel change, it just moved.** Not the sweep dying: that has loud symptoms, because the public dashboard dies with it and someone complains. It is the sweep running perfectly, alerts created, the provider returning a 200 and a "delivered" webhook — and **every message landing in the spam folder.** Every admin stops seeing alerts, nobody reports it because a missing alert has no complainant, and every light in the stack is green. This is the identical shape to the SMS sender-ID-bind failure, which is the point: it is a property of delegating delivery to a carrier you cannot observe, not a property of SMS.

Email makes it slightly worse in one way and better in another. Worse: a "delivered" webhook means *accepted by the receiving server*, which includes accepted-into-spam — so the provider's own success signal is actively misleading, where a missing SMS DLR at least hinted at trouble. Better: it is free to probe, so probe it daily and back it with the weekly human reply-OK. **A sensor that has never fired is not a sensor.** SPF/DKIM/DMARC before the first send is the prevention; the two probes are the detection.

**Blast radius:** the outbox is written from B3's transaction, so B3's RPCs must enqueue rather than send — specified there. The B2 decision making the phone number optional now costs nothing, since email is the launch channel and a role address is preferred over a personal mobile — but the dispatcher must still handle a recipient with **no** reachable channel by falling back to in-app plus the daily digest and flagging the facility on `/status`, never by silently dropping. The 2h/6h escalation thresholds remain independent constants from B4's 24h display ceiling. The channel change touches nothing in B1–B4 or B6 because no caller outside the adapter knows the channel — which is the test of whether the adapter boundary was drawn correctly.

**Definition of done:** a seeded ward going stale produces exactly one alert, then the cooldown schedule; 40 simultaneous stale wards produce one batched email per recipient; a PENDING ward produces none; quiet hours defer to a 06:00 digest; killing pg_cron still fires the sweep via the external path within 15 minutes; pausing the database produces a non-200 and a founder email; a hard bounce marks the recipient unreachable and shows on `/status`; the daily probe acks from all three mailbox providers; `toni.health` passes an SPF/DKIM/DMARC check and a real send lands in the Gmail inbox, not spam; **and the SMS adapter stub passes its tests while disabled**, so enabling it later is a credential and a config row.

---

### Bundle 6: Outcome capture (golden-path tail)

**Why bundled together:** small, and it closes the loop the golden path requires. Deliberately thin — the governance wrapper around it is Sprint 2, because the raw capture is what the E2E test needs and the wrapper is process, not path.

**Tasks:**

- [ ] `referral` record: **ward-to-ward.** **[AMENDED 2026-09-08 — ward-level identity decision]** A referring WARD logs a pending transfer against a receiving facility and category. Both sides are ward-scoped (`referrer_facility_id` + `referrer_category`, `receiving_facility_id` + `receiving_category`); no individual clinician is recorded on either side. This is the single place the ward-level identity decision could be undone by accident, so it is shaped correctly before anything is built on it.
- [ ] 1-tap outcome: `ACCEPTED` / `REFUSED` (structured `refusal_reason` enum, **no free text**) / `FALSE_NEGATIVE_REPORTED`.
- [ ] **Rename in the UI.** `FALSE_NEGATIVE_REPORTED` is fine as an internal enum; the user-facing label must be non-accusatory — *"Availability didn't match on arrival"* or *"Report a data discrepancy."* Never "report a facility". Framing determines what people write, and what a court later reads back.
- [ ] Structured fields only: facility, ward, time the portal was viewed, time of arrival, outcome. The record is a **discrepancy between recorded and observed state**, not misconduct. Put that in the schema comment as well as the UI.
- [ ] Only invited WARD ACCOUNTS at participating facilities may file. Rate-limited. The referring ward is resolved from `auth.uid()`, never from a parameter.
- [ ] **Named v1 scope boundary** **[AMENDED 2026-09-08 — ward-level identity decision]** — a clinician at a facility outside the pilot cannot file an outcome at all. There is no `REFERRER` role and no facility-less account — that shape was an individual account wearing a role name. The cost is small and deliberate: an outcome filed by an unknown clinician at an unverified facility is data this system cannot learn from, and the accuracy score that would have consumed it is already cut from Sprint 1.
- [ ] `ward_reply` field (capped, private, with no-patient-information validation) so the right of reply exists from day one.
- [ ] Outcome written to the audit log.
- [ ] Nothing published, nothing exported, no comparison view, no facility-level figure in any funder material. Enforce as a code-level constraint on the export path, not a convention.

**Specialist input incorporated:** CLCO supplied the rename, the structured-fields-only rule, the discrepancy framing and the publication prohibition — the qualified-privilege defence against defamation depends on not publishing beyond the interested parties, so it must be an architectural constraint rather than a default setting.

**Safety/quality notes:** the realistic damage here is not a writ. It is one medical director receiving a report he considers false, calling four other owners in the founder's network, and an invite-only network collapsing in a week. Trust is the asset.

**Blast radius:** consumes B2's referrer role and B1's `referral` table. The removal of `refusal_note` free text (B1) is what keeps this bundle inside the no-patient-data invariant. No accuracy scoring reads this data in Sprint 1, so no consumer is affected by deferring the wrapper.

**Definition of done:** the golden-path E2E logs an ACCEPTED outcome that appears in the audit log; a discrepancy report notifies nobody publicly and appears in no export.

---

### Bundle 7: Repo, CI and release gates

**Why bundled together:** small, and it runs alongside from commit one rather than at the end — the negative tests are worthless if they are not blocking merges by the time B2 lands.

**Tasks:**

- [ ] Apache 2.0. `NOTICE` stating that anyone self-hosting becomes an **independent data controller**, solely responsible for their own compliance and the accuracy of anything they publish, and must not use the BedSpace name or imply association.
- [ ] `SECURITY.md` with a private disclosure address, response SLA and coordinated-disclosure window. The code is public; findings will arrive, and they must not arrive as public issues.
- [ ] GitHub **secret scanning with push protection** — server-side, blocks the push. Pre-commit hooks enforce nothing on a contributor's machine; keep TruffleHog locally as a convenience, not a control. Documented key-rotation runbook.
- [ ] CI gates, all merge-blocking: the RLS negative suite; **a test that fails if RLS is disabled on any table**; the golden-path E2E; the 4am test; the 48-row truth table; a bundle grep for `service_role` and `SUPABASE_SERVICE`; **a grep guard failing the build if `updated_at` appears in any `where` / `.filter()` / `.lt()` / `.gt()` on the public search path** (crude, and the one that will actually catch the 4am regression a future contributor introduces); an ESLint `no-restricted-syntax` rule banning `!` and `=== false` on any identifier matching `/anaesthetist|obstetrician|paediatrician/`; a client-side lint banning `.select('*')` and any `from()` argument outside the three mirrors.
- [ ] README: repository contains no personal data, no facility data, no production credentials; all seed data synthetic. **Never commit the facility list or real duty phone numbers.** State the non-commercial covenant honestly — Apache 2.0 permits commercial use by anyone; the covenant binds Paddie by contract, not the world by licence.
- [ ] Contributor terms: Apache 2.0 s.5 inbound licence plus DCO sign-off. No CLA.
- [ ] **Contributions gated for now.** Public repo and licence from commit one; `CONTRIBUTING.md` and seeded good-first-issues only once five facilities are live and the golden path is stable. Seeding issues before then means reviewing PRs against components about to be rewritten.
- [ ] Three runbooks: `runbook-no-alerts-arriving.md`, `runbook-sweep-stopped.md`, `runbook-alert-storm.md`. Each with the symptom a user would report, the first diagnostic step, the fix, the escalation if it fails, and what fixed looks like. First diagnostic step for the sweep runbook is "is the Supabase project paused" — by far the most likely cause and ten seconds to rule out. For the no-alerts runbook the first step is `/status`: `last_sweep_at` stale means the sweep is dead (go to runbook B); fresh means read the outbox state distribution — rows stuck `QUEUED` is a dead dispatcher, rows `delivered` with no acks for days is **the spam-folder case**, which is diagnosed by sending a manual test to the three probe mailboxes and checking DMARC reports, not by reading provider logs that will all say success.
- [ ] Comment on `ward_status_event` stating the product reason, not just the rule: *history is private because facilities that fear being graded stop telling the truth, and a dishonest bed count kills someone.* An assistant that reads that comment will not build the chart.

**Specialist input incorporated:** CTO's guardrails against the three predicted assistant failure modes; CLCO's repo requirements; platform-SRE's runbooks.

**Safety/quality notes — the three mistakes an AI assistant is most likely to make here, and why the guardrails are shaped as they are.** First, collapsing the tri-state into a nullable boolean and falsy-checking it (F2) — highest consequence, looks like clean code, so the wrong shape is made unrepresentable in the schema and the lint rule catches the client. Second, escalating privilege when blocked by the security boundary: either widening an RLS policy to fix a 401, or reaching for the service-role key and landing it in a client-imported module or a `NEXT_PUBLIC_` variable "temporarily" — in a public repo that is a total compromise of a credential that cannot be rotated quietly. Base tables are therefore physically unreachable so widening a policy on them accomplishes nothing, and the allowlist tests plus the bundle grep are merge-blocking. Third, building the public time series that was explicitly forbidden, because a table called `ward_status_event` makes a 7-day occupancy chart the most natural thing in the world to offer — hence the hard caps inside the read RPC, the append-only triggers, and the comment explaining *why*.

**Blast radius:** n/a — no fixes folded into this bundle.

**Definition of done:** all gates merge-blocking and demonstrated failing when the thing they guard is broken (a deliberately-disabled RLS policy, a `updated_at` filter added to the search path, a service key added to a client module — each must go red).

---

## Release gates

Non-negotiable. A component that does not participate in the golden path is not in this sprint.

**Gate 1 — RLS negative suite.** An anonymous client with the published anon key can read current ward status and cannot: write to any status, read the audit log, read reason codes, read staff mobiles, enumerate staff, read history, see a quiet facility's detail, or execute any RPC. Failing fails the build.

**Gate 2 — Golden path E2E** (Playwright, seeded data, one command, green):

> Ward staff opens a single-use magic link → identifies at handover → sets count and `accepting` per category → publishes → the public snapshot regenerates and the tile shows fresh, distance-sorted, with the absolute timestamp → a referrer taps a stale ward → sees the duty phone number and fires an update request → the ward device shows the pending request → the ward updates → **the tile reflects it within 60 seconds with no page refresh** → the referrer logs ACCEPTED → the outcome appears in the audit log.

**Gate 3 — the 4am test.** With every seeded ward aged past 2 hours, a category filter returns results for all eight categories, badged grey, every row carrying a non-null E.164 number, in the exact expected order, with cardinality equal to the unfiltered nonzero count. Plus the property test: for any generated dataset, `count(search(cat)) >= count(rows where offered and bed_count > 0)`. Freshness must never reduce cardinality.

---

## Open decisions needing your call

Five. The first two block launch rather than build, so B1–B7 can proceed in parallel with resolving them — but neither can be resolved by an engineer.

**1. Legal entity — no longer blocks launch, still blocks SMS and still carries personal exposure.** Starting on email removes this from the critical path for shipping, which was the right call. Two things remain true. First, the platform-SRE finding: **SMS sender-ID registration requires CAC company registration, a use-case description and sample templates**, takes 2–4 weeks across MTN, Airtel, Glo and 9mobile, and lands *per-network, staggered* — you will be live on MTN and dark on Glo for a week and it will look exactly like a bug. You said the network applications start immediately; the entity is the document those applications need, so it gates the date SMS goes live. Second, and independent of SMS: the CLCO review's point that "Paddie owns it" is not a counterparty, not an NDPC registrant and not a liability shield — **if this runs in your personal name, the reliance exposure is personally unlimited.** Its recommendation is a vehicle separate from Paddie Health, which `toni.health` now supports structurally: a company limited by guarantee answers the lead-generation accusation best but CAC approval is slow; a separate Ltd with a binding non-commercial covenant is the faster route. One more: get the SMS template text past the CLCO **before** registering it, since registered templates are hard to change and *"NICU: 0 beds, reason: staff shortage"* passing through a third-party aggregator is a disclosure decision.

**2. Cost — settled.** Supabase Pro at $25/month accepted, which buys backups, no pausing and higher ceilings. Launch cost is therefore ~$25/month: Cloudflare Pages $0, transactional email $0 on a free tier at this volume, SMS added later at roughly $10/month. The snapshot architecture is what stops a viral spike adding to any of it.

**3. Product name and trademark.** `toni.health` partly resolves this. "BedSpace" is arguably descriptive and therefore a hard mark to register; "Toni" is not, and Apache 2.0 s.6 withholds trademark rights, so the mark is the only durable control against a stale fork at a lookalike domain killing someone under your name. Decide whether the product is **Toni** (register that, drop BedSpace to an internal codename) or stays **BedSpace** at a toni.health address, which is the weaker position on both branding and enforceability. Then get a registrability opinion and file. Cheap now, expensive later.

**4. Quiet mode — self-serve or founder-flipped?** Carried forward unresolved. Built as founder-flipped in v1 (a config action, no UI), because self-serve needs an admin surface nothing else in this sprint needs. Say the word if a facility should be able to flip it themselves, which is the stronger trust position. Related and worth deciding at the same time: the k-floor of 5 with no facility over 40% of the denominator means an LGA with fewer than five quiet facilities publishes nothing for them. That is a commitment to make explicitly at onboarding — the CLCO review reads it as a genuine trust asset worth naming in the invite conversation.

**5. Yoruba / Pidgin pass on the public view.** Carried forward unresolved. Built English-only, with copy kept in a single strings module so a pass is a translation job rather than a refactor.

---

## Sprint 2, named so it is not lost

Not detailed here, and deliberately not started: **SMS as the primary escalation channel** once the entity exists and sender IDs are bound on all four networks (the adapter stub and its tests ship in Sprint 1, so this is a credential and a config row, plus extending the daily probe to four SIMs); the discrepancy governance wrapper (facility notified within 4 hours, 7-day reply window, no internal view of a report without its reply status attached, 24-hour reporter withdrawal, disputed reports excluded from every aggregate, 12-month retention then anonymise both sides, notice-and-takedown with a named contact and logged decisions); the retention jobs with logged runs (attributed audit 90 days, pseudonymous events 24 months, discrepancy reports 12 months, staff accounts assignment-end +30 days, push subscriptions purged at 60 days idle, display-state log 24 months, aggregates indefinite); accuracy scoring; quiet-mode self-serve; i18n. The weekly "reply OK" check has **moved into Sprint 1** (B5) — with email rather than SMS it is the only independent evidence that mail is reaching an inbox, so it is no longer optional.

---

## Supporting docs

None as separate files. With no scaffolded codebase there are no real paths to write a staff-engineer plan or a QA spec against, so all four specialist reviews are folded inline above where they change scope. Once there is a repo, the standalone versions worth generating are: a QA test-plan document expanding gates 2 and 3 into full Playwright specs, and an `ARCHITECTURE.md` covering the two-schema split, the gate derivation and the snapshot pipeline — the latter is required for the repo anyway.
