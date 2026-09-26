# Legal texts: the privacy notice, and the processors' agreements

**The privacy notice.** `docs/legal/privacy-notice-v1.0.md` is the single source of the
notice served at https://openbed.ng/privacy (R-2026-09-26-136 DL-1). The founder approved
the record it is written from, and Cowork issued it with its sha256,
`0921ca415238d5ed96f3d287bf4fe02669a7c0e5cebac25b3f303a22be524db1`, which
`tests/compliance/privacy_notice.test.ts` pins. A change to the notice is a new file with
a new version number, never an edit to this one.

## The data-processing agreements (register items 1–3; R-2026-09-26-136 DL-4)

Each vendor's current published text was fetched on **2026-09-26 at 23:24 UTC**
(00:24 WAT on 2026-09-27) with one GET, following the vendor's own redirects. It was
saved byte for byte **outside this repository**, in the founder's folder
~/OpenBed-records/legal/, because this repository is public and the texts are the
vendors'. The sha256 below is of the saved file. The page is saved as served, and the
hash therefore changes if the vendor changes anything on it, including navigation. A
later reading is a new row, not an edit to this one.

| Vendor | URL fetched (and where it ended) | Version or date the page states | Date read | sha256 of the saved file | How it binds, in the text's own words |
| --- | --- | --- | --- | --- | --- |
| Proton AG | https://proton.me/legal/dpa (no redirect) | "Last modified: February 10, 2026" | 2026-09-26 | `8b97d15051f15badab7b3a8ee67df02239b1072238cce1aee5b6ea6dbf573d7a` | Through its terms: "This Data Processing Agreement ("Agreement") forms part of the Contract for Services under Proton AG's Terms and Conditions". |
| Supabase (Supabase Pte. Ltd) | https://supabase.com/legal/dpa, redirected by Supabase to https://supabase.com/legal/customer-resources/data-processing-addendum | "Version 1 — August 1, 2026" | 2026-09-26 | `b69726bf80a33b19770316ddeeceb22c764fdcb117f36fadeaeb7b1859db8344` | Accepting the terms: the DPA "supplements and forms part of the Supabase Terms of Service", and the SCCs "are incorporated into this DPA in accordance with clause 12". The words "execution of this DPA shall have the same effect as signing" appear once, about the UK Approved Addendum. |
| Cloudflare, Inc. | https://www.cloudflare.com/cloudflare-customer-dpa/ (no redirect) | "Version 6.4, effective April 3, 2026"; the page also links a PDF of v6.4, which was not fetched | 2026-09-26 | `c03c2d1deee10fc99dd70b53662c72207596ed79f6df364262873730df945ff4` | By reference: the DPA "forms part of the Main Agreement", defined as "an Enterprise Subscription Agreement, Self-Serve Subscription Agreement or other written or electronic agreement". |
| GitHub, Inc. | — | — | — | — | **No DPA.** GitHub hosts this public repository as an **independent controller**, under its own terms. It processes no personal data on OpenBed's behalf, and OpenBed commits none (see SECURITY.md). |

**What this table does not establish.**
- **The Cloudflare row's other half.** The DPA text says it forms part of a
  Self-Serve Subscription Agreement. The Self-Serve Subscription Agreement's own text
  was not fetched, so the claim that those terms incorporate the DPA by reference is
  **NOT CONFIRMED** here.
- **That the founder's accounts accepted these versions.** That is the founder's
  processor and transfer pack, outside this repository.
- **The transfer basis for each vendor.** That is recorded in the same pack
  (NDPA s.41).
