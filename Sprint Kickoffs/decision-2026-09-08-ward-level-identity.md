# Decision Memo — Ward-level identity, no individual accounts

_Boardroom: CTO, CPO, CLCO, COO. 2026-09-08._
_Supersedes Addendum 2 (retention) of `pasteback-2026-09-08-bundle1-closeout.md`._

## Verdict: GO, with two amendments

Ward-level identity holds. The founder's constraint — retain no personal data — is achievable, with one small named residue that stays out of the operational record.

**This memo is net removal. Nothing on the following list gets built.**

| Deleted | Why it stops existing |
|---|---|
| `app.actor_identity_map` | Nothing to map. No natural person in the system. |
| The severing design | Nothing to sever. |
| The retention period decision | No personal data in the audit log, so storage limitation does not bite on it. Append-only and permanent is fine. |
| Audit-log range partitioning | I recommended this to give you a lawful deletion path. That problem is gone. Partition only if SRE wants it for table size, which at a few hundred facilities is years away. |
| Four of the five lawyer questions | Controller characterisation, retention basis, erasure sufficiency and reason-code employment exposure all fall away with the personal data. |
| Individual account offboarding | The orphaned-account gap closes structurally. Nobody has an account to orphan. |
| `app.staff_contact` | Per-person contact data — exactly what this design removes. |
| `blood_status` column and its whole cascade | Unvalidated. See CPO below. |

---

## 🏗️ CTO — conditional support, two conditions

The candidate design survives, and the reason it survives cheaply is that **RLS does not change**. The SOP already requires every RPC to enforce membership server-side from `auth.uid()` rather than a caller-supplied `facility_id`. `auth.uid()` now resolves to a ward account instead of a person. The policies, the negative suite, and the security boundary you just built and verified all stand as-is. This is a change to what an identity *means*, not to how it is enforced.

**On the shared-credential objection — it is real, but it is the wrong objection to the actual design.** The anti-pattern is a shared *password*: memorable, portable, and retained by a leaver forever. What is proposed is a magic link to the ward's own mailbox or duty handset with a short session. That makes access follow **physical control of the ward device**, which is exactly the control the facility already exercises and we never could. A nurse who leaves and no longer holds the ward handset loses access by default, with no revocation step anyone has to remember. That is better than individual accounts in practice, because the individual-account version depends on someone at the facility filing an offboarding request, which will not happen reliably.

Two conditions, both blocking:

**(1) No IP address and no user-agent in the audit row.** This was not on the original list and it is the one that would quietly undo the whole design. An IP is personal data in its own right, so an audit log capturing it reintroduces exactly what we removed, through a column nobody flagged. This is the third instance this week of a control being walked around by a sibling field — after `blood_status_at` escaping the `updated_at` guard, and a distinct `blood_status` type escaping the `tri_state` guard. Treat it as a pattern, not three coincidences: **add a compliance guard asserting the audit table's column list contains no identity-bearing column**, keyed to a checked-in exact list so it reddens the moment one is added.

**(2) Session identifier must be opaque and short-lived.** The audit row may carry a session id for correlating a burst of edits. It must not be derivable back to a mailbox, and it must not outlive the session.

### Audit row shape

`id` (bigint identity PK), `facility_id`, `ward_category`, `action`, `old_value`, `new_value`, `version`, `occurred_at`, `session_id`.

**"Nothing else" governs identity-bearing and content columns, not structural ones.** An append-only log needs a stable row identity: `occurred_at` is not unique under burst writes, and without a key there is no way to cite a single audit entry in a discrepancy report — which is the log's primary purpose. The PK carries no information about a person. Name it explicitly in the compliance guard's exact column list so it is declared rather than smuggled in.

One caveat: a sequential id leaks total write volume across all facilities. It must never reach a public surface — it has no business in the snapshot, and the frozen column list on the public mirrors is what keeps it out.

`session_id` is deliberately non-unique per row — its purpose is correlating a burst — so it cannot serve as the key.

### `app.device`

Keep `token_hash` if it is doing real auth work. **Drop `fingerprint` in Sprint 1.**

`fingerprint` exists to raise a second-device alert, and that alert has no consumer: Sprint 1 has no admin surface to fire it into and no defined response. That is the same defect as `blood_status` — a mechanism with no owner and no action attached.

It also has a bite nobody has named. The alert works by fingerprinting the **unauthorised** device — and the unauthorised device is, by definition, the personal phone someone forwarded the ward link to. Capturing an online identifier of a personal device is precisely what this memo removes. The feature's mechanism runs against the design's premise.

If it ships later, the condition is: a salted hash with a per-facility salt, never the raw fingerprint, never correlatable across facilities — so what is held is "this ward has seen two distinct devices", a count rather than an identifier.

---

## 🔍 CPO — support, and a feature to cut

**Losing individual attribution costs the product nothing it actually needs.** Work through what it was for: investigating a bad publish (you would call the facility, never discipline a nurse); targeting support (ward-level is the right granularity — support goes to a ward, not a person); the accuracy score (per-facility by definition, already cut from Sprint 1). None of it needed a name.

**It is a selling point, not an objection.** A CMD who expects named logins is expecting them because that is what enterprise software does. Reframe it directly: *we do not record which of your nurses did what — we could not tell you if you asked.* An outside company keeping an attributable log of your staff's operational reports is a liability for the CMD too, and one his matron will raise before he does. This is easier to sell than named accounts, not harder.

**One thing to cut, and this is a correction of earlier advice in this session.** `blood_status` should not ship in Sprint 1. It fails the standing test: nothing in the kickoff says what it means, who maintains it, or how often. It has no acceptance criteria and no evidence of frequency. Sprint 1 has already cut a feature on exactly this basis — the hospital accuracy score — and this is the same call. The previous exchanges hardened an unvalidated feature instead of asking whether it ships.

Cut it, and the cascade goes with it: no `blood_availability` column, no `blood_status_at`, no trigger, no nullable-timestamp render case, no new fixture, and no re-keying of the freshness guard for a second timestamp column. **Keep** the enum drop — `DROP TYPE app.blood_status` still happens in the window, because an unused four-value type left in the schema is a phantom.

Not-now with the condition attached: blood ships when a clinician has defined the states, someone at facility level owns updating it, and the Theatre/Surgical gating question from clinical review has an answer.

---

## ⚖️ CLCO — support, and the honest residue

Four of the five questions in the earlier brief fall away. I am not going to claim zero, because claiming zero in a document is the same defect as claiming a control that does not exist.

**The irreducible residue: you must send a login link somewhere.** That address is held in Supabase `auth.users`, and at the email provider in delivery logs. If it is a genuine role address — `maternity.ward@facility`, or the ward duty handset — it is not personal data, because it identifies a ward rather than a person. If a facility gives you a nurse's personal Gmail, it is. You cannot verify which you have been given.

The mitigation is contractual and cheap: **the facility agreement states that addresses supplied must be role addresses, not individual ones, and that the facility is responsible for that.** That puts the obligation where the knowledge is. Add one line to onboarding.

Second residue: the **invited facility contact** — a CMD or matron, one human per facility, business-contact data on a contract basis. Standard, minimal, no retention drama. It lives in its own small table with no append-only trigger, deletable on request. This is where the single human per facility goes when `app.staff_contact` is dropped.

**The load-bearing rule: neither residue touches the audit log or the event stream.** That is what makes the operational record clean, and it is what CTO condition (1) enforces mechanically.

**On whether anything requires named accountability:** this is not a clinical record. It is not an EMR, it holds no patient data, and it is a voluntary operational feed. MDCN regulates practitioners, NHIA regulates insurance and claims, HEFAMAA regulates facility registration in Lagos. None of them attach a per-user attribution requirement to this. That is a reasoned position, not a certainty — but it is not blocking for facility #1, and it is the only legal item left standing.

**The one remaining lawyer question, non-blocking:** confirm that a ward role address held in an auth table, with no name and no individual link, is outside the NDPA's personal-data definition on these facts. Ask it when the facility agreement is drafted, not before.

---

## ⚙️ COO — support, with the offboarding SOP reduced to two lines

The offboarding gap that was folded into scope earlier this session — nobody had specified who deactivates a nurse's account when she leaves — closes without an SOP, because there is no account. What replaces it is a facility-side control: *when someone with access to the ward handset or mailbox leaves, the facility rotates it.* That is a line in the facility agreement, not a support workflow.

Realistic risk: facilities will not rotate. The short-session design already absorbs this — access dies with physical control of the device. Do not build a rotation reminder in v1.

---

## Conflicts surfaced

**CTO vs COO on revocation.** The CTO wants short sessions so no revocation step is needed; the COO wants an SOP the facility will follow. Resolved in the CTO's favour, because an SOP that depends on a Nigerian clinic filing a leaver notification is an SOP that does not run. Short sessions make the SOP unnecessary rather than redundant.

**CPO vs the earlier clinical review on blood.** Clinical review answered "should blood gate?" correctly and thoroughly. Nobody asked the prior question — should it ship at all. The CPO's cut does not contradict the clinical finding; it says the finding is not needed yet. If blood ships in Sprint 2, the display-only verdict and its three conditions are already settled and can be lifted straight out of the pasteback.

**No CLCO conflict.** There is nothing to override, because the design removes the exposure rather than accepting it.

---

## What changes in the window

Migrations 001–011, before first hosted push:

- [ ] Drop `app.actor_identity_map` and every reference to it.
- [ ] Drop `app.staff_contact`.
- [ ] Audit table: remove any `user_id`, `actor_id`, `ip_address`, `user_agent` column. Final shape as CTO above, PK included.
- [ ] Add the audit-column-list compliance guard, with plant, accept and anti-vacuity legs. The PK is named in its exact list.
- [ ] `app.device`: keep `token_hash` if load-bearing for auth, drop `fingerprint`.
- [ ] Membership binds facility + ward to an auth account, not to a person. Confirm the RLS negative suite passes unchanged — it should.
- [ ] `DROP TYPE app.blood_status`. No blood column.
- [ ] Reason codes attach to ward + facility. No individual attribution is possible by construction, so the earlier design constraint about management-visible surfaces is now enforced by the schema rather than by policy.
- [ ] Facility-contact table, separate, no append-only trigger.
- [ ] Enum audit across the remaining types, per the earlier instruction. Reason codes especially, since SMS templates are hard to change after registration.
- [ ] **No partitioning.** Reverse the earlier recommendation.

**Bundles 2–6 re-scope:** the only real one is the **referral outcome loop**. A referring clinician closing the loop with a one-tap outcome reintroduces an individual unless it is ward-scoped from the start. Scope it as ward-to-ward now, in the kickoff doc, before it is built — this is the single place the whole decision can be undone later by accident.

## Next 48 hours

1. Create the hosted Supabase project to pin `af-south-1`. Do not push.
2. Claude Code executes the window list above.
3. Add the two facility-agreement lines: role addresses only, facility rotates on leaver.
4. Amend the kickoff doc so the referral loop is ward-scoped.
5. Push, then verify the RLS negative suite and the five demonstrated gates still go red on demand against the hosted project.

## Kill criterion

If a facility in the pilot cannot supply a ward-level address or handset and insists on individual nurse logins, do not quietly add individual accounts. Stop and re-open this memo — that is the single condition that would make the design unworkable, and it should be tested at facility #1 rather than discovered at facility #20.
