# PR B design report: one source for per-app lists; contacts, fonts, headers; the leg-register fix

To: Cowork. From: Claude Code, 2026-09-24. **Design only. Nothing is built and nothing hosted was run.**

Base: `main` = `abd6ee51a085e57d68e926776c4733a67315b675`.

Scope:
- R-2026-09-24-88 BP-9 and BP-10;
- R-2026-09-24-89 BQ-1, the widened contacts test;
- R-PROVISIONAL-2026-09-24-BT BT-4, the `_legs.ts` fix.

B touches no provisioning path and no SQL (BP-1). It lands BT as -92 if it lands before A.2.

**Evidence kind.** Every site and line below was read at `abd6ee5` by me or by read-only survey agents, and every contested line was re-read by me. **The measurements in §4 come from running the register's own code**, `tests/compliance/_legs.ts`, with no copy of its logic, against the real tree under a candidate rule. The measuring file was deleted after use, and `git status` read clean.

---

## 1. Per-app lists (BP-9): enumerated, not taken from the kickoff's list

**Apps that exist.** `apps/public-dashboard` and `apps/ward-console`. Each has a tracked `wrangler.toml`. `tests/compliance/_apps.ts` derives four things, and six test files use them:
- `deployableApps()`;
- `appsWithFunctions()`;
- `pagesProjectOf()`;
- `outputDirOf()`.

**Final count: 12 sites** that list, or hard-code, the set of apps. That is 5 multi-app lists, 5 single-app stand-ins for every app, and 2 borderline cases. Beside them sit 3 per-deploy-target lists. **Against -71 H's "seven", it is twelve** (fifteen counting the deploy-target lists).

The kickoff's own list also counted twelve, but four of its items were wrong or mislabelled, and six sites were missing:

| Kickoff item | Verdict |
|---|---|
| `build_stamp.test.ts:125-129` | **already derived**: `test.each(APPS)` builds `` `apps/${app}/public/version.json` `` |
| `proxy_allow_list.test.ts:333-339` | **a list of call sites**, not of apps (the real range is :330-336) |
| `proxy_allow_list.test.ts:346-353` | **a list of read-back scripts** |
| `runbook_ward_console_deploy.test.ts:55-60` | **a list of runbooks**, one per deploy target including the Worker |

### What each site becomes

A **fence** means an assertion that the site's set equals `deployableApps()`, or `appsWithFunctions()`, and reds on an app it does not reach. A **deliberate literal** keeps its literal, says why in place, and keeps a plant.

| # | Site | Kind | Becomes |
|---|---|---|---|
| 1 | `package.json:23` typecheck (the root `tsconfig.json:22-27` excludes `apps`) | multi | **fence**: a test derives the set of `apps/*/tsconfig.json` and `apps/*/functions/tsconfig.json` from the filesystem, and asserts the typecheck script names each one |
| 2 | `.gitignore:55-56`, one exact path per app | multi | **deliberate literal**: a directory rule would drop `robots.txt`. It is already fenced by `build_stamp.test.ts:125-129`'s `git check-ignore` per derived app |
| 3 | `build_stamp.test.ts:87` `toEqual(['public-dashboard','ward-console'])` | multi | **deliberate literal**, as its own header says; the loud tripwire when the set changes |
| 4 | `tracked_client_keys.test.ts:192-199` keyed table | multi | **deliberate literal**, already fenced at :273 (its keys equal `deployableApps()`) |
| 5 | `ward_support_contact.test.ts:82-83` (and :78's hard-coded `dist`) | multi | **derive**: "every deployable app except the ward console must not carry the support address", with `outputDirOf` |
| 6 | `package.json:25` `build:functions` (the dashboard only) | single | **fence**: `appsWithFunctions()` must each be named by `build:functions` |
| 7 | `scripts/stamp_build.mjs:58` default path (the dashboard) | single | **remove the default**: no tracked caller uses it (both apps pass `./public/version.json`). A missing argument becomes a refusal, a new registered leg with a plant |
| 8 | `eslint_duty_flag_negation.test.ts:50-51` (dashboard source only) | single | **derive** the corpus from `deployableApps()` |
| 9 | `freshness_bands.test.ts:202` (dashboard files only) | single | **derive**: every app's `src/**/*.ts` |
| 10 | `deploy_guards.test.ts:153`, plus :297, :318, :321, :336 (and `dist` at :160, :321) | single | **deliberate literal**: argument-parsing plants need one representative app, and the accept legs are already derived (:175). `dist` becomes `outputDirOf` |
| 11 | `tracked_client_keys.test.ts:351` (the dashboard's `.functions-build`), borderline | single | **derive** with `appsWithFunctions()` |
| 12 | `tracked_origins.test.ts:212-213` (only dashboard pages.dev examples), borderline | single | **derive** each app's `<project>.pages.dev` from `pagesProjectOf()` |

**The three deploy-target lists** stay per-target, because PR C adds admin's entries:
- `runbook_ward_console_deploy.test.ts:55-60`;
- `proxy_allow_list.test.ts:346-353`;
- `readback_scripts.test.ts:40-47`, `:192-196` and `:208-213`.

Each gains one fence: a checked-in per-app table `{ app: { runbook, readback } }` whose keys must equal `deployableApps()`, the same shape as `tracked_client_keys`' :273. **So PR C's admin app reds until its runbook and read-back exist.**

Also, `tracked_client_keys.test.ts:340` hard-codes `dist` and becomes `outputDirOf`.

**The scratch-app plant** is one test file, `tests/compliance/per_app_reach.test.ts`:
- It builds a scratch tree holding the real `package.json`, `.gitignore` and `apps/*/wrangler.toml`, plus `apps/zz-scratch/wrangler.toml` (and a `functions/` directory, for the functions fences).
- It runs **every fence** above against that tree, and each must red, naming `zz-scratch`.
- Each deliberate literal's own plant reds as well.
- **Anti-vacuity:** a scratch tree with no apps reds every fence.

The sites fenced in place (1, 6 and the three deploy-target tables) are called through a function that takes a root, the seam every lint here already takes as `$1`.

---

## 2. Contacts (BP-10, BQ-1)

**Today.** Outside `Sprint Kickoffs/` and `docs/handoff*`, only the three published addresses appear:
- `SECURITY.md:11` has `security@openbed.ng`. It is untested today, and PR B tests it.
- `docs/runbook-supabase-project-creation.md:2560`, `:2602` and `:2761` use `security@` as §9's magic-link test account. That is permitted, since it is one of the three.
- `packages/origins/ward-support.json:3` holds `support@`, and `:5` names `security@` and `hello@` as what may never go there.
- `tests/compliance/ward_support_contact.test.ts:20` and `:51` hold `support@`.

`privacy@` appears only in `Sprint Kickoffs/` (the decision record and the 3.4b kickoff).

**Proposal: one file, `packages/origins/contacts.json`, which REPLACES `ward-support.json`.**
- It holds exactly the three published addresses, each with its purpose:
  - `security@`, vulnerability disclosure, `SECURITY.md`;
  - `hello@`, general enquiries;
  - `support@`, the one address a ward writes to.
- It keeps `ward-support.json`'s ruling and "what may never go here" text, on the support entry.
- `packages/origins/src/support.ts` reads `WARD_SUPPORT_EMAIL` from it, and its export does not change, so the ward console's import closure does not either. The ward console's bundle still carries only the support address, as `ward_support_contact`'s :76-84 legs assert. `tracked_client_keys`' import-closure table is unchanged.

**Tests** (`tests/compliance/contacts.test.ts`):
- **Every address in the tracked tree is one of the three (BQ-1's widening).**
  - It walks `git ls-files -z`, **null-separated**, because a plain `git ls-files | xargs grep` silently skips `Sprint Kickoffs/`, whose name contains a space (found by the survey).
  - It matches `[A-Za-z0-9._%+-]+@openbed\.ng\b`. **That requires a local part**, so the decision record's `"@openbed.ng/origins"` typo is not read as an address.
  - The exemption is exactly `Sprint Kickoffs/` and `docs/handoff*`.
  - **Plant:** a fourth address in an app's source is rejected, naming the file.
- **No `privacy@`** anywhere outside that same exemption. The decision record and the kickoff both sit inside it, so BP-10's "outside the decision record" is met as BQ-1 scopes it. **Plant** included.
- `SECURITY.md` names the contacts file's `security@`, with a plant.
- The file holds exactly three entries, with a plant for a fourth.
- **The operator's address never needs an exemption,** because it is never written (BQ-1).

---

## 3. Fonts and headers (BP-10)

### Fonts

**Today:** no app declares a font. No tracked source, and neither local `dist/`, contains `fonts.googleapis`, `fonts.gstatic` or `@font-face`, so the guard starts green.

**Proposal:** `scripts/lint_no_third_party_fonts.sh`. It is a bundle guard in the shape of `lint_no_service_role_in_bundle.sh`, and runs in the `bundle-guards` CI job:
- **The corpus is `apps/*/dist/**`,** and it **includes `.css`**. The service-role corpus is `js/mjs/cjs/html/json`, and a font host would sit in CSS: test-conventions §2(d), a description broader than a filter.
- The declared matrix is `{js, mjs, cjs, html, css}` × each deployable app, asserted by identity.
- **Plants:** one per extension × location. The per-app reach plant follows `bundle_guards.test.ts:96-125` (a dirty app is caught while every other app is clean).
- **Anti-vacuity:** an empty corpus exits 2.
- Its `FAILED` summary line is quoted by its test, since §4's rule requires it.

### Headers

**Today:** no app ships `_headers`, and no Content-Security-Policy, Referrer-Policy, nosniff or frame-ancestors value exists in any tracked source.

**Proposal:** a tracked `apps/<app>/public/_headers`, which Vite copies into `dist/` like `robots.txt`, with a `/*` block:

- **Public dashboard:** `Content-Security-Policy: default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`.
  - **`connect-src 'self'` is all it needs:** its only browser fetch is same-origin `/beds.json` (`apps/public-dashboard/src/main.ts:139`), and the Function's supabase.co call is server-side.
  - **`index.html:13-19` has an inline `<style>`,** which `style-src 'self'` would block. **Proposal:** move it into a `.css` file imported by `main.ts`, not a `'sha256-…'` or `'unsafe-inline'` exception.
- **Ward console:** the same, with `connect-src 'self' https://api.openbed.ng`. That is `origins.json` `api.production`, its only browser API origin: `/auth/v1/otp`, `/auth/v1/token` and `/rest/v1/*` all go through `apiOrigin()`.
  - The direct `*.supabase.co` origin is **not** added. The emailed link is opened there as a top-level navigation, which `connect-src` does not govern, and the browser never fetches it.
- **Both apps:** `Referrer-Policy: no-referrer`, because the ward console's sign-in fragment carries tokens (`main.ts:583`), and `X-Content-Type-Options: nosniff`.

**Tests** (`tests/compliance/security_headers.test.ts`):
- **For each `deployableApps()`:** the source `_headers` exists and parses, in Pages' format (a path line, then indented `Name: value`), and the built `dist/_headers` equals it.
- **Its `connect-src` is exactly `'self'`, plus the app's tracked API origin when its browser code calls `apiOrigin`.** The value is read from `origins.json`, never retyped. It reuses `tracked_origins`' notion of which apps consume an origin.
- **Plants:**
  - a scratch app with no `_headers`;
  - a CSP without `frame-ancestors 'none'`;
  - a `connect-src` widened by one origin;
  - `Referrer-Policy: origin`;
  - `nosniff` missing.

**NOT asserted by any test, and named in the file** (method note 12):
- **That the CSP works in a browser.** A CSP that is too tight breaks a page silently.
- **That Pages applies `_headers` to Function responses.** This is **[unverified]**. My understanding is that Pages does not apply `_headers` to Function-generated responses. If that holds, `/beds.json` keeps only the headers `packages/snapshot/src/serve.ts` sets. I propose adding `X-Content-Type-Options: nosniff` there, beside its existing `content-type`, `cache-control` and `x-robots-tag`, only if the local read-back below shows it is missing.

**Read-backs:**
- `scripts/readback_pages.sh` and `scripts/readback_ward_console.sh` gain probes on `/` for the three headers, using the existing `rb_header` reader in `scripts/readback_common.sh:117-131`. Today only `/beds.json`'s content-type, cache-control and x-robots-tag are read.
- **Each app is loaded under its headers locally** with `wrangler pages dev <dist>`, a **local** server that makes no deploy, and both read-backs are re-run against it.
- **Any preview deploy is the founder's step,** because every real `wrangler` deploy runs as the founder.

---

## 4. The leg-register fix (BT-4)

**The hole.** `isReached` (`tests/compliance/_legs.ts:417-422`) credits a leg when **any** literal in a test that names the script, of at least 10 characters (`MIN_ID`), is a **substring of the leg's message**. So the test's own path counts as evidence, and so does a flag like `'--project-ref'`, or a fragment several legs share.

**Proposed rule.** A literal `a` credits leg `L` only if one of these holds:
1. `a` contains `L`'s whole identity; or
2. all of these hold for `a`, as a fragment of `L`'s identity:
   - `a` is at least 10 characters;
   - `a` is not path-shaped (`^(?:[\w.-]+/)*[\w.-]+\.(sh|mjs|ts|js|json|sql|toml|md)$`);
   - **no other leg of the same script has an identity containing `a`**.

A fragment that could equally prove two legs proves neither.

**Measured on `main` with the register's real parser and evidence:**
- 276 script legs;
- **250 reached today, 244 under the proposed rule**;
- six flip, all from reached to not reached, and none the other way.

| Leg | Credited today only by | Made genuinely reached by |
|---|---|---|
| `lint_audit_log_columns.sh: FAILED (` | the literal `lint_audit_log_columns.sh` | `tests/compliance/audit_log_no_identity_columns.test.ts`: a plant that quotes its `FAILED (` summary line |
| `lint_from_allowlist.sh: FAILED (` | `lint_from_allowlist.sh` | `tests/compliance/bundle_guards.test.ts`: a plant that quotes it (`scripts/lint_from_allowlist.sh:159`) |
| `lint_no_secrets.sh: FAILED (` | `lint_no_secrets.sh` | `tests/compliance/no_secrets.test.ts`: an existing plant gains the quote |
| `lint_no_updated_at_filter.sh: FAILED (` | `lint_no_updated_at_filter.sh` | `tests/compliance/bundle_guards.test.ts`: a plant that quotes it (`scripts/lint_no_updated_at_filter.sh:67`) |
| `lint_public_table_rls.sh: FAILED (` | `lint_public_table_rls.sh` | `tests/compliance/lint_public_table_rls.test.ts`: a plant that quotes it |
| **`neuter_plant.mjs`: `PLANT DID NOT LAND — neuter`** (a sixth, not in BT-4) | `PLANT DID NOT LAND`, **shared with the leg at `scripts/neuter_plant.mjs:141`** | `tests/compliance/neuter.test.ts:107` quotes the identifying `PLANT DID NOT LAND — neuter`, not the shared prefix |

In every row the plant quotes the line itself, never an exemption (BT-4).

**Not yet measured:** the ten instrument legs (`parseInstrumentLegs`), which `leg_coverage.test.ts` credits from its own file. The build measures them under the new rule before the rule lands, and reports any flip.

**Instrument tests** (`tests/compliance/leg_coverage.test.ts`):
- **plant:** a test that only names the script path credits nothing;
- **plant:** a fragment shared by two legs credits neither;
- **accept:** a fragment unique to one leg credits it;
- **accept:** the whole identity credits it.

`current` in `packages/fixtures/leg-coverage.json` is restated from the measurement, with the baseline untouched (test-conventions §2(c)).

---

## 5. Blast radius (BP-14 B)

- **Every test that held a literal app list** (§1). The CI `npm run build` gains the dashboard's CSS move and each app's `_headers` copy.
- **The ward console's and the dashboard's deploy read-backs,** now with header probes. They are re-run locally against `wrangler pages dev` before the report, and the founder runs them against a preview.
- **`ward_support_contact`** changes only in its import (`contacts.json`) and its §1 derivation. Its assertions stay.
- **Unchanged:**
  - `function-grants.json` and the D3 list;
  - `applied-hosted.json`;
  - SQL and the provisioning path;
  - public output. `/beds.json`'s body is untouched, and only its headers may gain `nosniff`.

## 6. Open for Cowork

1. **§1:** twelve sites plus three deploy-target lists, against -71 H's "seven". Confirm each fence-or-literal call in the table.
2. **§2:** `contacts.json` replaces `ward-support.json`, rather than extending it.
3. **§3:**
   - the dashboard's inline `<style>` moves to a CSS file rather than taking a hash;
   - whether `/beds.json` gains `nosniff` in `serve.ts`, pending the local read-back.
4. **§4:** the rule as stated, including the sixth leg it unmasks.
