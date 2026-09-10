# Facility Agreement — Clause X: Access Addresses

Date: 2026-09-10 | Prepared by: Cowork, clco-persona
Status: **pre-draft.** Not legal advice. A Nigerian-qualified lawyer must answer the questions in §4 before this goes in front of a CMD.

---

## 1. Why this exists

Ward-level identity means an auth account represents a ward, or a facility for admin, never a natural person. That decision is what makes the operational record clean and what caused four of the five original lawyer questions to fall away.

**It was never zero.** A magic link has to be sent somewhere, and that address lives in Supabase `auth.users` and in the email provider's delivery logs. A genuine role address — `maternity.ward@facility`, or the ward duty handset — identifies a ward and is not personal data. A nurse's personal Gmail is.

**We cannot tell which we have been given.** There is no technical check that distinguishes them, and there will not be one. So the mitigation is contractual: it puts the obligation where the knowledge is. Until this clause is written and accepted, *"we hold no personal data"* is aspirational rather than true — and it is the premise the ward-identity decision, the retention answer and the four dropped lawyer questions all rest on.

This clause also carries the COO's leaver-rotation line (X.5), so the ward-identity memo's two facility-agreement obligations are both here. **Do not split them.**

---

## 2. The clause

Drafting note: `Purpose`, `Operator`, `Facility` and `Service` are assumed defined elsewhere in the agreement. **`Purpose` must be defined narrowly** — operating the bed-visibility service and its operational notifications — because X.7 hangs off it.

> ### Clause X — Access Addresses
>
> **X.1 Definitions.** In this Clause:
>
> **"Access Address"** means any email address or mobile number the Facility supplies to the Operator, or causes to be supplied, for the purpose of receiving sign-in links, ward notifications, or operational alerts under this Agreement.
>
> **"Role Address"** means an Access Address that is assigned to a ward, department, duty station, or office of the Facility rather than to an individual; that is not the personal email address or personal mobile number of any individual; and that remains with the Facility, unchanged, when the individual who uses it changes role or leaves the Facility.
>
> **X.2 Role Addresses only.** The Facility shall supply only Role Addresses as Access Addresses. The Facility shall not supply the personal email address or personal mobile number of any individual, whether an employee of the Facility or otherwise.
>
> **X.3 Warranty.** The Facility represents and warrants, on each occasion on which it supplies, changes, or confirms an Access Address, that: (a) the address is a Role Address; (b) the address, and any device or mailbox to which it resolves, is under the Facility's control; and (c) the Facility is entitled to supply it to the Operator for the Purpose.
>
> **X.4 No verification by the Operator.** The Facility acknowledges that an address cannot be determined to be a Role Address from its form or from any other information available to the Operator; that the Operator does not attempt to make that determination and operates no control that would detect a breach of Clause X.2; and that the Operator relies solely and reasonably on the warranty at Clause X.3. No record held by the Operator of an Access Address constitutes a representation by the Operator as to the character of that address.
>
> **X.5 Custody and rotation.** The Facility shall control access to each Access Address, and to any device on which an Access Address is received, to the same standard as it controls physical access to the ward or office to which that address is assigned. Where a person who has had access to an Access Address, or to such a device, ceases to hold the role by reason of which they had that access, the Facility shall without undue delay change the credentials for that address or that device.
>
> **X.6 Individual address supplied in breach.** If, notwithstanding Clause X.2, an Access Address is or becomes the personal email address or personal mobile number of an identified or identifiable individual, then:
>
> (a) the Facility is the data controller in respect of that individual's personal data, and warrants that it has and maintains a lawful basis under the Nigeria Data Protection Act 2023 for supplying that address to the Operator, and that it has provided that individual with the information required by section 34 of that Act, including that the address has been supplied to the Operator and will be used to transmit sign-in links and operational notifications for the Purpose and will be recorded in the Operator's authentication system and in the delivery records of the Operator's email provider;
>
> (b) the Facility shall notify the Operator in writing without undue delay upon becoming aware, and shall supply a replacement Role Address; and
>
> (c) the Operator may, upon becoming aware and without liability, suspend or disable access for that Access Address and require a replacement Role Address before restoring access. Any such suspension is not a failure by the Operator to provide the Service.
>
> **X.7 Operator's use of Access Addresses.** The Operator shall use each Access Address solely for the Purpose. The Operator shall not use any Access Address for marketing of any kind; shall not disclose, transfer, or make it available to any affiliate, related entity, or third party except a processor engaged to transmit messages for the Purpose; and shall not include it in any mailing list, product, dataset, or export other than the Service. This Clause X.7 survives termination.
>
> **X.8 Acceptance record.** The Operator shall record the date on which the Facility accepted this Agreement and the version of this Agreement accepted. That record is evidence of the Facility's acceptance of the obligations in this Clause X as at that date.
>
> **X.9 Survival.** Clauses X.3, X.4, X.6 and X.7 survive termination or expiry of this Agreement in respect of any Access Address supplied during its term.

### On an indemnity — deliberately absent

An indemnity from a Lagos public tertiary hospital against NDPA claims is not something a CMD signs without a legal officer and a delay you cannot absorb at facility #1. The warranty at X.3 plus the acknowledgement at X.4 is what actually does the work in a regulatory inquiry: it establishes that the Operator's reliance was reasonable and that the knowledge sat with the party who had it. **An indemnity adds recovery, not defence**, and recovery against a state hospital is theoretical. Raise it for private facilities in Sprint 2 if you want it; do not let it hold up facility #1.

### How to say X.4 in the room

X.4 will be read as the Operator disclaiming responsibility. The honest framing is the opposite, and it is a strong one:

> *We deliberately built a system that cannot tell you which of your nurses did what. This clause is what lets us keep it that way.*

That is already the CPO's framing in the ward-identity memo. Lift it verbatim into the onboarding conversation.

---

## 3. What gets built behind it — and what deliberately does not

### Build: the onboarding gate

No invite may be issued for a facility whose `app.facility_contact.agreement_accepted_at IS NULL`. Cross-table, so it is a guard clause at the top of the invite path beside `app.assert_member`, plus a test with one plant.

This is not a claim about an address. It is a claim about a fact the Operator actually knows and controls: **whether this facility accepted the document containing Clause X before it was handed a login.** Without it, Clause X is a paragraph in a PDF that reaches some facilities and not others in an order nobody records — which is the sixth instance of *a mechanism present and not reaching*, the pattern this project is already tracking.

### Build: one column, `agreement_version`

`agreement_accepted_at` records *when*. The operative question in an inquiry two years from now is **whether the clause existed in the document they accepted** — and a bare timestamp cannot answer that once the agreement has been revised even once. A version string records a fact the Operator generates, controls and can produce. It is evidence, not a representation about someone else's address.

### Do NOT build: an `is_role_address` boolean

Worse than absent, for two reasons stronger than "it's unverified".

`app.invite` deliberately holds **no address** — its own comment says the address lives once, in `auth.users`. A flag *about* an address, on a table that holds none, is an assertion about an object that is not there.

And its evidential effect runs backwards. X.4 is a clause saying the Operator makes no determination. A column in which the Operator records `true` is a self-generated document in which the Operator did make one. **In a dispute that column is the counterparty's exhibit, not yours.** It converts a clean reliance position into a contested one, for zero operational benefit.

### Do NOT build: a domain heuristic

A `gmail.com` / `yahoo.com` warning at invite time fails on the same precedent that cut `fingerprint` from Sprint 1 — no consumer, no defined response — with one additional defect. `amina.bello@lasuth.gov.ng` is a personal address on a facility domain and passes cleanly, so the check's false-negative rate is highest on exactly the population that matters, while its passing green teaches everyone the question has been answered.

### The acceptance record — where it lives and what it actually evidences

**`app.facility_contact` is right**, and it is where Bundle 2 said its natural home would be. The basis and the signatory coincide: that row is the one invited human at the facility, held on a **contract** basis, and the facility agreement is a contract accepted by that human on the facility's behalf. On `app.facility` it would be separated from the person who gave it; on `app.invite` it would be tied to a lifecycle it does not share.

**Keep the name `agreement_accepted_at`, never `privacy_notice_accepted_at`.** `003`'s comment already makes this argument and it is right: `privacy_notice` implies data-subject consent, there is no consent basis anywhere in this system, and an employee cannot freely consent to her employer in any case. A future reader who sees `privacy_notice_accepted_at` will reason from the wrong lawful basis, and that mistake propagates.

**It evidences** that on date D the named contact at facility F accepted a document, and — once `agreement_version` exists — that the document was version V, which contained Clause X.

**It does not evidence** that any address supplied by F is in fact a Role Address; that any individual whose personal address was supplied was ever told anything; that F's own staff know about X.5; or that the contact had authority to bind F.

That gap is the design, not a defect. X.4 says the Operator does not verify, and the record is deliberately evidence of *acceptance of an obligation*, not evidence of *compliance with it*. **Put that distinction in the column comment in those words**, so nobody later mistakes the second for the first.

---

## 4. Lawyer handoff

Eight questions. Two are ripe now; the rest before facility #20.

1. **X.3 / X.4 — reliance.** Does a supplier's warranty plus an express acknowledgement that the recipient operates no verifying control establish reasonable reliance sufficient to keep the Operator outside controllership for an individual address supplied in breach, on NDPA s.65's definitions and current NDPC guidance? Or does the Operator remain a joint controller as a matter of fact, because it determines the purpose for which the address is used, whatever the contract says?
2. **The standing question, now ripe.** Does a ward role address held in `auth.users` and in a processor's delivery logs, carrying no name and no link to any individual, fall outside the s.65 definition of personal data on these facts? The ward-identity memo deferred this to *"when the facility agreement is drafted"*. It is being drafted.
3. **X.6(a).** Is it enforceable to allocate controllership to the Facility by contract for personal data the Operator in fact holds and processes? Does X.6(a) survive as an allocation of liability between the parties even if it does not bind the NDPC, and should it be redrafted as an indemnity-and-allocation rather than a characterisation?
4. **Execution and authority.** What binds a Lagos State public tertiary hospital to Clause X — CMD signature, HEFAMAA involvement, a Ministry of Health delegation, a board resolution? Does click-through acceptance recorded as `agreement_accepted_at` suffice for a public facility, or is wet-ink required? **The answer determines whether the acceptance record evidences anything at all.**
5. **`app.referral` and the patient.** On the shipped shape — ward pair plus `portal_viewed_at` plus `arrived_at`, plus a capped free-text `ward_reply` — is the Operator processing personal data, and if so sensitive personal data under s.30, concerning a data subject it has no relationship with and cannot notify? If yes: what lawful basis, what does s.34 require where direct notification is impossible, and does a DPIA become mandatory under s.28 before that bundle ships?
6. **NDPC registration.** On projected pilot volumes — Lagos, ~20 facilities, unbounded public dashboard traffic — is the Operator a data controller of major importance requiring registration, and by what date? Confirm the threshold and fee against guidance in force, not a remembered figure.
7. **X.7 and the non-commercial covenant.** Is a contractual prohibition on marketing use and affiliate disclosure sufficient to keep the Paddie Health relationship out of scope, or does the corporate relationship between the entities require disclosure to the Facility in the agreement itself?
8. **Retention.** The display-state log is retained 24 months for coronial and claims defence. Confirm that against the Nigerian limitation period for a claim arising from reliance on displayed data, and confirm no shorter NDPA storage-limitation argument bites given the log's contents.

---

## 5. Two related obligations that are not this clause

**The email provider is an unpapered processor.** NDPA s.29 requires a written processor agreement; Resend, Postmark and SES all publish click-through DPAs and executing one takes under an hour. And note that **Residue A physically lives in the magic-link sender's delivery logs** — if Supabase's built-in SMTP sends the links and a separate provider sends the escalations, that is two processors, and the runbook currently names neither. Set log retention on both to the shortest offered. s.41 also needs a stated basis for the cross-border transfer.

**The public dashboard has no privacy notice.** The first-run interstitial is a terms acceptance and is well designed as one; it is not a privacy notice. NDPA s.34 requires information at the point of collection, and the dashboard does process — an IP at the edge, geolocation permission state, update-request events, the 24-month display-state log. Every strong fact here is in your favour and none is stated where anyone can see it: **coordinates never leave the device**, there is no account, no tracking pixel, no analytics. Half a day of writing, and it is the first artefact a hospital's legal officer or an NDPC officer asks for.
