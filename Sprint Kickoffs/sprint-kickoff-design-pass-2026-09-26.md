# Sprint Kickoff — The design pass, and no deferral without a gate
Date: 2026-09-26 | Prepared by: Cowork sprint-push | Base: `main` at `c20e635`

## Division of responsibilities
Claude Code lands the record change and builds, tests and opens each PR below; it runs nothing hosted. Cowork checks every PR from the founder's Mac, including the screenshots, before the merge word. The founder deploys each app from merged `main`, runs its read-back and browser check, and approves the look in the browser. Commit this file unedited as `Sprint Kickoffs/sprint-kickoff-design-pass-2026-09-26.md` in PR D0.

## Why this sprint exists
All three live apps ship with almost no styling: the public dashboard's `style.css` is 13 lines, admin's is 10, and the ward console has none. `apps/ward-console/index.html` also has no viewport meta, so on a ward handset it renders at desktop width. The founder's design system and prototypes exist, and R-2026-09-24-75 BC-7 deferred the public-site and ward-console pass to "Cowork's brief". That brief was never written.

**Root cause (Cowork's):** BC-7's gate was an action with no observable event and no checklist box. The facility-one checklist at runbook 12.4 step 1 was compiled by phrase search for "before facility one" and its variants. BC-7 contained none of them, so the pass fell out of every list that drives work. D0 fixes the cause, and D1 to D3 fix the symptom.

## Sprint scope
- **In:** the record rule and its guard (D0); the shared design foundation plus the public dashboard (D1); the ward console (D2); admin (D3).
- **Out:** any change to wording. Every visible sentence stays byte-identical, because the public wording waits on the clinicians (box: -67 A7 / -68 C3). Also out: any new screen, the interstitial, the landing or how-it-works content, the "who's on it" list, update requests, sorting or filters, the category filter, a privacy-notice page (paperwork item 7 is not approved), the facility-admin surface, the invite list (BC-6), the prototype's `platform-admin-src` code (BC-4), `/beds.json`, the snapshot, the CSP headers, and any migration.
- **Sources:** the OpenBed design system tokens (quoted where needed below), the three Claude Design prototypes (layout reference only), and the brand sheet's mark.

## Bundles

### D0: the record rule, the deferred-items register and its guard (record and one test)
**Why bundled together:** the rule, the table it governs and the test that enforces it are one mechanism. Record-only plus one compliance test is a different risk profile from UI work, so it ships alone and first.

**Tasks:**
- [ ] Land the held CV as R-2026-09-25-120, as already agreed.
- [ ] Land this ruling as **CW** (next provisional letter after it: CX), numbered on landing. Its substance:
  - **CW-1: the design pass is a facility-one item.** Add box 14 to runbook 12.4 step 1: *"The design pass: the OpenBed design system applied to the public dashboard, the ward console and admin; each deployed from merged `main`, read back PASS, browser-checked at 360 px and desktop widths, and the look approved by the founder in the browser. (R-…-CW)"* It closes only when all three apps are deployed and the founder approves. A merge alone does not close it.
  - **CW-2: the launch paperwork is a facility-one item.** Add box 15: *"The founder's launch paperwork register reads Approved on every item. The register is outside this repository. (R-…-CW)"* The register already says this, but the repo checklist did not. That is the same gap as CW-1. Box 1 (CJ-2) stays as it is. Box 15 does not replace it.
  - **CW-3: root cause recorded as above,** as Cowork's miss. -75 BC-7's text is not edited. Supersede it by reference.
  - **CW-4: the rule.** Every deferral in this record names exactly one gate, of one of three kinds:
    - **BOX:** a line in the 12.4 step 1 checklist;
    - **TRIGGER:** an observable event, such as "the second PLATFORM_ADMIN" or "the first ward-path code containing a digit";
    - **VERSION:** out of v1, reconsidered at a named point.
    "Waits for X to do Y" is not a gate.
  - **CW-5: the register.** Add a section "Deferred items — this record is where the list lives" with a table `| Item | Ruling | Gate kind | Gate |`. Seed it with every open deferral in the record. Find them by searching for "OPEN ITEM", "open item", "trigger", "deferred", "out of v1", "follow-up", "later" and "before facility one", and reading each hit in context. Cowork's assignments for the items it knows:
    - the 12.4 boxes, 1 and 4 to 15 → BOX;
    - agreement history (-100 CB) → TRIGGER: the first returning facility or mistaken record (backstop: the first post-launch kickoff);
    - the digit-less code pattern (-98) → TRIGGER: the first ward-path code with a digit;
    - no audit row on a contact read → TRIGGER: a second PLATFORM_ADMIN;
    - the email allowance (§12.1) → TRIGGER: the second facility, or the first 429 a ward sees;
    - PITR off → TRIGGER: the first data-loss event;
    - wrangler 429 at `GET /accounts` → TRIGGER: a second occurrence;
    - per-ward detail vs the facility rollup → TRIGGER: 30 days after facility one is listed;
    - update requests, freshest/nearest sorting, the public "who's on it" list, the facility-admin override and duty-flag gating → VERSION: v2 scoping, which opens 30 days after facility one is listed.
    **Any deferral the sweep finds without a stated gate is listed in the PR report for Cowork to rule. Claude Code does not invent a gate.**
  - **CW-6: the guard.** `tests/compliance/deferred_items.test.ts` fails when:
    - (a) a row's Gate kind is not BOX, TRIGGER or VERSION;
    - (b) a Gate cell is empty or reads TBD, "?" or "pending";
    - (c) a BOX row's ruling does not appear in 12.4 step 1;
    - (d) an unticked 12.4 box has no BOX row.
    Show each red first with a plant.

**Specialist input incorporated:** engineering-manager (the root cause is a gate with no event, invisible to a phrase-search compile); qa-specialist (two-way consistency between the register and the checklist, so neither can drift).

**Safety/quality notes:** this changes no code path. The test reads two markdown files, so parse the tables strictly and fail on a malformed row rather than skipping it.

**Blast radius:**
- `runbook_step_references.test.ts` and the other runbook tests read 12.4. Re-run all runbook tests.
- The facility-one count becomes 15 boxes, 2 ticked. Restate every place that says "13 items" or "11 open" (runbook 12 row, §12.4 prose) in this PR.
- The provisional ledger gets rows for CV and CW.

**Definition of done:**
- CV and CW landed.
- Boxes 14 and 15 are in 12.4.
- The register is seeded, and every row has a gate or is reported.
- The new test is green, having been shown red for (a) to (d).
- All tests pass, and the PR is open. STOP for Cowork's check.

### D1: the design foundation and the public dashboard
**Why bundled together:** the foundation has no consumer until an app uses it, and the public dashboard is the surface people will see first. Shipping them together means the foundation is proven by a real page, not merged idle.

**Tasks — the foundation (`packages/design`):**
- [ ] `tokens.css`: the design system's `colors.css`, `typography.css`, `spacing.css`, `surfaces.css`, `motion.css` and `base.css`, copied verbatim from `~/Documents/Claude/Projects/BedSpace/Site/_ds/openbed-design-system-0bbddfb2-f166-4e0c-92b1-484a08440e3b/tokens/`. **Its `fonts.css` is NOT copied:** it `@import`s Google Fonts, which BC-6 forbids.
- [ ] `fonts.css`, self-hosted:
  - Public Sans 400/600/700 and IBM Plex Mono 400/500/600, latin subset, woff2 only;
  - from the `@fontsource/public-sans` and `@fontsource/ibm-plex-mono` packages, bundled by Vite as same-origin assets;
  - `font-display: swap`, so text shows at once on a slow handset.
  Record both licences (OFL-1.1) in `NOTICE`.
- [ ] `openbed-mark.svg`: the brand sheet's mark, verbatim, with `viewBox="0 0 32 32"`:
  - a path `M6,13 L6,10 A4,4 0 0 1 10,6 L22,6 A4,4 0 0 1 26,10 L26,22 A4,4 0 0 1 22,26 L10,26 A4,4 0 0 1 6,22 L6,19`, stroke `#1b3a5c`, width 2.2, round caps, no fill;
  - a circle at cx 6, cy 16, r 2.3, fill `#2f8f8a`.
  Use it as each app's favicon (`<link rel="icon" type="image/svg+xml">`) and in the header at 28 px.
- [ ] The lockup is live text, never outlined: "Open" in navy-700 and "Bed" in teal-600, Public Sans 700, `letter-spacing: -0.02em`, beside the 28 px mark.
- [ ] Guards in `bundle_guards.test.ts`, each shown red first:
  - no `fonts.googleapis.com` or `fonts.gstatic.com` in any app's source or `dist` (BC-6);
  - each of the three `index.html` files has `<meta name="viewport" content="width=device-width, initial-scale=1">`;
  - each app's built CSS contains `--ob-navy-700` and an `@font-face` whose `src` is same-origin (this is the guard that the design is actually applied, so this can't silently recur);
  - no `style=` attribute and no `.style.` assignment in any app's `src`: classes only, which the CSP (`style-src 'self'`) requires anyway.
  Assert D2's and D3's apps too, marked `todo` until their PRs land. Each of those PRs flips its own `todo`.

**Tasks — the public dashboard:**
- [ ] Page order, fixed:
  1. the emergency strip: `--ob-emergency-bg` with white, full width, 112 and 767 as tel links at least 44 px tall;
  2. the indicative banner;
  3. the header (lockup);
  4. the snapshot banner, when present;
  5. the facility tiles;
  6. a footer carrying the hello@ address read from `packages/origins/contacts.json` (BC-3), and nothing else. There is no Paddie Health mention: the design system forbids a vendor tie, and the controller is named in the privacy notice.
  Nothing is sticky or fixed. Use `max-width: 960px`, 16 px gutters (24 px wide) and a minimum body size of 15 px.
- [ ] **Tile:**
  - a white card with a 1 px `--border-default` border, 6 px radius and no shadow;
  - the facility name at `--text-heading`;
  - the call link as the only full-width primary action: 52 px tall, navy-700, white text, with the phone number wrapped in a mono span;
  - ward rows below it, separated by `--border-hairline`.
- [ ] **Ward row:** the category label, a count badge (`--text-count-lg`, mono) and the age text as a mono stamp. **The row's `textContent` must stay byte-identical to today's `wardLine(...).text`.** Wrap substrings in spans. Never re-derive, reorder or reword. Add a test that asserts identity for every tone and band across the synthetic fixtures.
- [ ] **Colour rule (Cowork's call, logged below):**
  - The count badge takes a status fill only when the band is GREEN:
    - accepting and a count above 0 → Available;
    - not accepting or 0 → Full.
  - Every other case uses the Not-reporting fill: YELLOW, GREY, SUPPRESSED, not-reporting, not-offered and unknown.
  - "Limited" is not used, because no threshold for it has been ruled.
  - The freshness stamp takes the band colour: green, amber or grey.
  - Colour is never the only signal: the words carry everything, as today.
- [ ] A static freshness dot, only on GREEN rows. No animation.
- [ ] The empty, outage and snapshot-stale states render as a Notice: `--surface-sunken`, a 3 px left accent in `--border-accent-width`, and words unchanged. The snapshot banner keeps `role="status"`.
- [ ] A focus ring on every interactive element (2 px teal, 2 px offset). `prefers-reduced-motion` is honoured through the tokens.
- [ ] Screenshots for Cowork, from the local build with synthetic fixtures only:
  - widths 360×740 and 1280×900;
  - states: empty, outage, snapshot-stale, and tiles covering every tone and band;
  - written to `.design-screens/D1/` in the working tree, which is untracked (add it to `.gitignore`), so Cowork reads them from the Mac.

**Specialist input incorporated:**
- clinical-safety-reviewer: a green badge on a stale count reads as "go". So status colour is asserted only while the claim is fresh, and "Limited" is withheld until a threshold is ruled.
- cpo-persona: beds first. No interstitial or landing content on this page (BC-7).
- cto-persona: fonts self-hosted through the bundle, so the CSP is unchanged (fonts fall under `default-src 'self'`) and no new origin appears in any read-back.

**Safety/quality notes:**
- No wording changes. The design system's "no 'we'" voice rule conflicts with the shipped empty and outage sentences. That goes to the clinicians' wording box (-67 A7 / -68 C3), not here.
- Poll re-renders replace children, so no styling may hold state across renders.

**Blast radius:**
- `dashboard_identity_and_call.test.ts` parses literal px from the `a.call` rule and plants by replacing `min-height: 44px`. So declare literal values (`min-height: 52px`), not `var(--hit-primary)`, which the parser reads as null. Also update the plant to replace the actual value, or it plants nothing and passes vacuously. Show the plant red.
- `dashboard_age`, `dashboard_empty_state`, `dashboard_poll` and `public_labels` read text. The identity test above protects them.
- `security_headers.test.ts`: `_headers` is not touched.
- The read-backs (`scripts/readback_pages.sh`, `readback_common.sh`) list every `<script>`. Adding fonts, CSS and the SVG adds no script, so confirm `rb_scripts` still reads exactly the one module script.
- The build stamp and `robots.txt` are unchanged.
- Check that Pages serves `.woff2` as `font/woff2` in the hosted read-back.

**Definition of done:**
- The guards are green, having been shown red.
- The textContent identity test passes.
- Screenshots are written.
- All tests pass, and the PR is open. STOP for Cowork's check.
- After the merge, the founder deploys the public dashboard. **This is the first hosted run of the 2026-09-25 read-back checks.** The founder runs the §5 browser check in a private window: the console is clean, the fonts load from `openbed.ng` in the Network tab, and there are no CSP violations.

### D2: the ward console
**Why bundled together:** one app, one audience (ward handsets), and one set of tests (`ward_console_render`, `auth_session`, `ward_support_contact`).

**Tasks:**
- [ ] Add the viewport meta. This is the root-cause fix for the desktop-width rendering, and D1's guard flips from `todo`.
- [ ] Add the foundation, favicon and lockup header.
- [ ] Sign-in: a single-column form, a 44 px input, and a 52 px primary button.
- [ ] Handover: each ward is a card, with its status words unchanged.
- [ ] Publish:
  - the count input is 64 px tall with mono `--text-count-lg`;
  - add − (U+2212) and + stepper buttons of 64 px beside it, which change the input value only, clamped 0 to 500, and **never publish**;
  - the zero-reason `<select>` stays a select, styled; chips are a v2 interaction change;
  - Publish is the full-width 52 px primary.
- [ ] Every `p.status` and refusal message renders as a Notice with its words unchanged, including every `wardMessageFor` sentence. Do not adopt the prototype's "within 30 seconds" (BC-7) or its session wording.
- [ ] Screenshots to `.design-screens/D2/`: signed out, link sent, handover, publish (empty, invalid, zero with reason), published, and each refusal.

**Specialist input incorporated:** qa-specialist. The steppers need tests: clamping at 0 and 500, that a tap never calls `publish_ward_status`, and that a double tap on Publish still sends one request, as today.

**Safety/quality notes:** a stepper is the one new behaviour in this sprint. It only edits a field the ward already edits, and publishing stays an explicit tap.

**Blast radius:** `ward_console_render.test.ts` reads `p.status` and `li > p`. Keep those elements and classes. The CSP connect-src is unchanged, and so is the deploy runbook §5.

**Definition of done:** the same as D1, for this app. The founder deploys, runs the read-back and does the browser check on a phone.

### D3: admin
**Why bundled together:** one app, one user (the operator), and its own tests (`admin_render`, `admin_calls_live`).

**Tasks:**
- [ ] Add the foundation, favicon, and the lockup with "Platform admin" beside it.
- [ ] The register renders as cards on narrow screens and a table at 960 px and wider. Show Listed / Not listed as words, never "Paused" (BC-6).
- [ ] The forms use 44 px controls. `.warning` renders as a Notice. The phone-change confirm stays as built.
- [ ] Nothing is stored client-side (BP-3). `admin_render.test.ts` already scans for this.
- [ ] Screenshots to `.design-screens/D3/`.

**Specialist input incorporated:** none needed. It is internal, single-user and restyle only, and BC-4 and BC-6 already fix its scope.

**Blast radius:** the admin render tests read words and structure. Keep both. The Access-protected read-back needs the service-token step as usual.

**Definition of done:** the same as D1, for this app. **Box 14 closes only after D3's deploy and the founder's approval of all three in the browser.**

## Open decisions needing your call
None blocking. Proceeding on these logged calls, which the founder can override at the screenshot review:
1. A count badge is coloured only while fresh, and "Limited" is unused until a threshold is ruled.
2. The ward console keeps the zero-reason select this sprint; chips are for v2.
3. There is no privacy-notice link until paperwork item 7 is approved. The notice and its link then land as one small PR.

## Supporting docs
- The design system (tokens, rules and voice) and the prototypes: on the founder's Mac at `~/Documents/Claude/Projects/BedSpace/Site`. They are layout reference only, and this kickoff quotes everything a PR needs.
