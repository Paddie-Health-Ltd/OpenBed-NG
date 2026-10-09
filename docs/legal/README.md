# Legal texts: the privacy notice, and the processors' agreements

**The privacy notice.** `docs/legal/privacy-notice-v1.2.md` is the single source of the
notice the dashboard builds for https://openbed.ng/privacy. A change to the notice is a new file with a
new version number, never an edit to an existing one, and
`tests/compliance/privacy_notice.test.ts` pins each version's sha256, every one of which is held in
`tests/compliance/_notice_pins.ts` and asserted to appear in this file.

- **Version 1.2:** `docs/legal/privacy-notice-v1.2.md`, issued by Cowork as a hand-over file with its sha256 (R-2026-10-09 GO, GO-3 a), sha256 `f8c6e3ef14b7ee3742abfff9571adf667f78f55021fbffde315b27e32905feac`. It differs from 1.1 in exactly three lines: the version line, the location bullet under "What OpenBed does not do" (the founder's wording, approved 2026-10-09; *evidence kind: relayed by Cowork in R-2026-10-09 GO, not observable from this repository*) and the Changes sentence. Not yet deployed: https://openbed.ng/privacy serves 1.1 until the founder's one public-dashboard deploy carrying this notice and "Near me" together reads back Version 1.2 (hosted step 2 of that letter). The date version 1.2 is first published is recorded here at that hosted read-back, and not before.
- **Version 1.1:** `docs/legal/privacy-notice-v1.1.md`, approved by the founder 2026-09-28, R-2026-09-28-155. Handed over by Cowork as a file (R-2026-09-28-156 EF-1), sha256 `9e38c81335715db959651b07096b48d200e48c8199361f3571a0020de5baec76`. Deployed and read back in hosted run 3 on 2026-09-28, recorded as R-2026-09-28-158 (EH-2) and ticked in runbook 12.4 step 1: readback_pages.sh read PASS with Version 1.1 on both hosts, and the founder's browser showed it. *Evidence kind: relayed. That is Cowork's reading of the founder's pasted output, kept in the decision record outside this repository; nothing here can verify it.* It stays in the repository unchanged.
- **Version 1.0, the prior version, kept unchanged:** `docs/legal/privacy-notice-v1.0.md` (R-2026-09-26-136 DL-1). The founder approved the record it is written from, and Cowork issued it with its sha256, `0921ca415238d5ed96f3d287bf4fe02669a7c0e5cebac25b3f303a22be524db1`.

*Restated 2026-09-28 (R-2026-09-28-155 EE-1).* Until then this paragraph named
`privacy-notice-v1.0.md` as the single source, which it was until version 1.1.

*Restated 2026-10-09 (R-2026-10-09 GO, GO-3 d).* Until then the Version 1.1 line read "Not yet deployed:
https://openbed.ng/privacy serves 1.0 until hosted run 3 deploys and reads back 1.1", which stopped being true
on 2026-09-28 when hosted run 3 did exactly that. It is restated above in the past tense from the record. The
paragraph at the top named version 1.1 as the single source, which it was until version 1.2.

## The data-processing agreements (register items 1–3; R-2026-09-26-136 DL-4)

Each vendor's current published text was fetched with one GET, following the vendor's
own redirects: the three DPAs on **2026-09-26 at 23:24 UTC** (00:24 WAT on 2026-09-27),
and Cloudflare's Self-Serve Subscription Agreement on **2026-09-27 at 07:09 UTC**
(R-2026-09-27-137 DM-3 a). Each was
saved byte for byte **outside this repository**, in the founder's records folder,
because this repository is public and the texts are the
vendors'. The sha256 below is of the saved file. The page is saved as served, and the
hash therefore changes if the vendor changes anything on it, including navigation. A
later reading is a new row, not an edit to this one.

| Vendor | URL fetched (and where it ended) | Version or date the page states | Date read | sha256 of the saved file | How it binds, in the text's own words |
| --- | --- | --- | --- | --- | --- |
| Proton AG | https://proton.me/legal/dpa (no redirect) | "Last modified: February 10, 2026" | 2026-09-26 | `8b97d15051f15badab7b3a8ee67df02239b1072238cce1aee5b6ea6dbf573d7a` | Through its terms: "This Data Processing Agreement ("Agreement") forms part of the Contract for Services under Proton AG's Terms and Conditions". |
| Supabase (Supabase Pte. Ltd) | https://supabase.com/legal/dpa, redirected by Supabase to https://supabase.com/legal/customer-resources/data-processing-addendum | "Version 1 — August 1, 2026" | 2026-09-26 | `b69726bf80a33b19770316ddeeceb22c764fdcb117f36fadeaeb7b1859db8344` | Through its terms: the DPA "supplements and forms part of the Supabase Terms of Service". **The EU SCCs**, clause 12.1: "The Standard Contractual Clauses shall, as further set out in Schedule 2, apply to the transfer of any Covered Data from Customer to Supabase, and form part of this DPA, to the extent that: (a) the GDPR or Swiss Data Protection Laws apply to the Customer when making that transfer; or (b) the Applicable Data Protection Laws that apply to the Customer when making that transfer (the "Exporter Data Protection Laws") prohibit the transfer of Covered Data to Supabase under this DPA in the absence of a transfer mechanism implementing adequate safeguards …". **"Same effect as signing"** appears once, in Schedule 2 paragraph 2.3, and applies to **the UK Approved Addendum only**: "execution of this DPA shall have the same effect as signing the Approved Addendum". |
| Cloudflare, Inc. | https://www.cloudflare.com/cloudflare-customer-dpa/ (no redirect) | "Version 6.4, effective April 3, 2026"; the page also links a PDF of v6.4, which was not fetched | 2026-09-26 | `c03c2d1deee10fc99dd70b53662c72207596ed79f6df364262873730df945ff4` | By reference, from both sides. The DPA "forms part of the Main Agreement", defined as "an Enterprise Subscription Agreement, Self-Serve Subscription Agreement or other written or electronic agreement". The Self-Serve Subscription Agreement (next row) incorporates it. |
| Cloudflare, Inc.: the Self-Serve Subscription Agreement | https://www.cloudflare.com/terms/ (no redirect; the page is titled "Self-Serve Subscription Agreement \| Cloudflare") | "Last Updated September 12, 2025" | 2026-09-27 (07:09 UTC) | `27401c884349ad32674da8c934f70c3a331bf056efdda7db39a4cab950c5879a` | **FOUND**, section 6.1 (Data Processing): "…then Cloudflare is a data processor or sub-processor, as applicable, and Cloudflare will handle such Personal Data in compliance with Cloudflare's Data Processing Addendum ("Data Processing Addendum"), which is hereby incorporated by reference into this Agreement." The clause's condition, quoted: "If Customer Content includes the personal data of European data subjects as those terms are defined by EU and UK Data Protection Laws and all data defined as 'personal information' under the California Consumer Privacy Act". |
| GitHub, Inc. | — | — | — | — | **No DPA.** GitHub hosts this public repository as an **independent controller**, under its own terms. It processes no personal data on OpenBed's behalf, and OpenBed commits none (see SECURITY.md). |

**Corrected by R-2026-09-27-137 DM-3 b.** The Supabase row's first wording
paraphrased the DPA as "accepting the terms has the effect of signing its SCCs". That
paraphrase was the drafting session's, carried by Cowork, and the row now quotes what
the text says. The Cloudflare row said the Self-Serve side was NOT CONFIRMED. It is
now fetched and FOUND (DM-3 a).

**What this table does not establish.**
- **Whether section 6.1's condition reaches OpenBed's data.** The condition names
  European data subjects and California "personal information", and the incorporation
  is stated for that case. Whether the DPA governs Nigerian data subjects' data under
  the Self-Serve terms is a legal reading, recorded here as the text's words, not
  decided.
- **The founder's written decision on that reading, 2026-09-27 (R-2026-09-27-138 DN-1),**
  recorded as the founder's and not established by this table: the DPA applies by its
  own scope to personal data subject to the NDPA, because its definition of Applicable
  Data Protection Laws is inclusive ("including") and it forms part of the Main
  Agreement, which includes the Self-Serve agreement; section 6.1 is read as an express
  incorporation for EU/UK and CCPA data, not a limit on the DPA's own scope.
- **That the founder's accounts accepted these versions.** That is the founder's
  processor and transfer pack, outside this repository.
- **The transfer basis for each vendor.** That is recorded in the same pack
  (NDPA s.41).
