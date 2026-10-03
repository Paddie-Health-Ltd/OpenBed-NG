import { OriginsUnreachableError, RenewalUnavailableError, SessionExpiredError, SessionHolder, requestSignInLink, sessionFromUrlFragment } from '@openbed/auth';
import { apiOrigin, supabaseDirectOrigin } from '@openbed/origins';
import { publishableKeyFor } from '@openbed/origins/keys';
import { PRIVACY_NOTICE_URL } from '@openbed/origins/privacy';
import { bedCountText, categoryLabel, precedence, reasonLabel } from '@openbed/labels';
import { NO_WARD, NO_WARD_HEADING, OFFERING_CHOICES, SIGNIN_LIMITED, ZERO_REASONS } from '@openbed/labels/ward';
import {
  ASK_FOR_HELP,
  CALL_OPERATOR,
  GET_HELP,
  TAP_AGAIN,
  UNRECOGNISED,
  UNREACHABLE_PUBLISH,
  WARD_MESSAGES,
  submitPublish,
  wardMessageFor,
  type PublishForm,
  type WardRow,
} from './publish.js';
// The design system's tokens and self-hosted fonts first, then this app's own rules
// (the design pass, D2). Vite emits all three as same-origin assets.
import '@openbed/design/tokens.css';
import '@openbed/design/fonts.css';
import './style.css';

/**
 * THE WARD CONSOLE. Sign in with a magic link, see the wards at this account's
 * facility, and publish a bed count for one of them.
 *
 * WHY THERE IS NO SUPABASE CLIENT HERE. `tests/setup/auth.ts` proved the whole
 * magic-link route with plain `fetch` before any app existed. Had this file
 * reached for @supabase/supabase-js, the system would have had TWO derivation
 * sites for how it authenticates -- one the harness proves and a different one
 * the app ships -- at the auth seam, which is the drift §7 of
 * .claude/rules/test-conventions.md closes everywhere else. So both sides now
 * import packages/auth/src/session.ts, and there is one.
 *
 * THAT IS THE REASON. The bundle guard reddening on the library's JSDoc was
 * NOT: deciding architecture to quiet a guard is the tail wagging the dog, and
 * `scripts/lint_no_service_role_in_bundle.sh` was fixed on its own merits in the
 * same branch, so it would pass supabase-js today.
 *
 * WHAT WAS GIVEN UP, since it is real. The library buys session persistence and
 * background token refresh. Persistence is deliberately not wanted -- the
 * ward-identity decision of 2026-09-08 makes access follow PHYSICAL CONTROL OF
 * THE WARD HANDSET, which is what replaced the offboarding SOP -- and refresh
 * is taken on demand with a single in-flight promise, because one handset and
 * one screen removes the cross-tab race the library's machinery exists for.
 *
 * WHY A PUBLISH FORM ONLY WHERE THE SERVER SAYS can_publish (R-2026-09-27-144 DT,
 * Bundle 2; it resolves -139 DO-3). my_reporting_wards() (026) returns every ward
 * category at the account's facility, for handover visibility, and its can_publish
 * column says which of them THIS login may publish for: a ward login, its own
 * category; a facility login, every ward; any other role, none. The server decides
 * it from the same account row publish_ward_status reads, so the console no longer
 * guesses. A row with can_publish shows its own inline form, sourced entirely from
 * that row's loaded data (category, version), never typed. Every other row shows its
 * status read-only, with one muted line, "This ward reports from its own login."
 * The server is still the only authority on a publish: a refusal surfaces as a fixed
 * sentence like any other.
 *
 * WHAT THIS REPLACED. Until Bundle 2 every row carried a form, and the header here
 * explained why: the console could not tell which row was the login's own. So a ward
 * login saw Publish on wards that WARD_SCOPE_DENIED would refuse. can_publish is the
 * server's answer to that question, and it is what the form now follows.
 *
 * NO BULK CONTROL, deliberately (DT Bundle 2): no "publish all" and no "nothing
 * changed" shortcut. Each ward is published on its own, with its own count, so a
 * stale claim cannot be refreshed in one tap. A facility login with many wards makes
 * one tap per ward, and that is the point. tests/compliance/ward_console_no_bulk_publish.test.ts
 * asserts that no such control exists.
 *
 * A ROW WITHOUT can_publish IS TREATED AS false. It shows read-only, never a form.
 * No ward or facility login exists on hosted (R-2026-09-28-149 DY-2), so no live user
 * sees the window between 026's hosted apply and this console's redeploy, in which the
 * deployed console (built before 026) calls a function 026 dropped.
 *
 * RENDERED AND ASSERTED SINCE R-2026-09-23-66: tests/compliance/ward_console_render.test.ts
 * imports this module under jsdom and reads the page -- the refused rows, the fixed
 * messages at every site that used to print server text, and the publish form's
 * body. Until then nothing rendered this console at all.
 *
 * CLASSIFICATION (Clause 5): the sign-in and handover path is LIVE -- it runs
 * against the local stack and golden-path steps 0-5 pass against it. The
 * publish RPC is LIVE, proved by tests/db/publish_ward_status.test.ts and the
 * golden path's publish steps. THE PUBLISH SCREEN IS NOW LIVE TOO: submitPublish
 * below calls it over holder.authedFetch, the same authenticated-fetch pattern
 * the handover read already used.
 */

/**
 * WHERE THIS CONSOLE'S DATABASE ADDRESS COMES FROM (R-2026-09-22-57 item 1).
 *
 * It was `import.meta.env['VITE_SUPABASE_URL']`, read from an untracked .env.local.
 * That was Finding D exactly: the address this app used in production was a fact
 * that lived on one laptop, and no build, test or reader of this repository could
 * say what it was. It is now TRACKED CONFIGURATION, chosen at RUNTIME from the host
 * the console is being served on -- so a build carries every environment's origin
 * and none of them depends on who ran the build or what they had set.
 *
 * THE KEY IS TRACKED TOO, SINCE R-2026-09-22-61, AND THIS PARAGRAPH USED TO SAY THE
 * OPPOSITE. It argued the key must stay an environment variable because a credential
 * has a lifecycle the repository does not, and that tracking it would make this
 * repository the place a STALE key lives -- a dead key authenticating nothing while
 * every probe reads as though the boundary held. **That objection was answered, not
 * overruled:** `docs/runbook-key-rotation.md` now moves this one tracked line in the
 * same change as a rotation, which is what keeps a tracked key from going stale.
 * What tracking buys is that THE STAMPED COMMIT FULLY DETERMINES THE BUNDLE.
 *
 * SO THIS FILE READS NO ENVIRONMENT AT ALL, and that is the whole point rather than
 * a tidy side effect (R-2026-09-22-60). Vite inlines the WHOLE `import.meta.env`
 * record for a bracket access, so the single read that used to be here dragged every
 * VITE_ name from an untracked .env.local into the shipped bundle -- including one
 * that nothing read any more. With no read at all, Vite's define never fires and the
 * output cannot vary with a file or with a shell.
 */
const API_URL = apiOrigin(window.location.hostname);
const PUBLISHABLE_KEY = publishableKeyFor(window.location.hostname);

/**
 * THE DIRECT ORIGIN, AS THE FALLBACK (R-2026-10-02-FF FF-4 a, -182; R-2026-09-19-23 D5). When the Worker
 * at API_URL is down, or refuses a path it should forward, the holder and the sign-in request send the
 * same call to this origin instead (packages/auth/src/fallback.ts holds the rules and the bounds). In
 * production it is origins.json's `supabaseDirect.production`; locally it equals API_URL, so the
 * fallback is the primary and every call is sent once. The ward console is the THIRD and last holder
 * of the direct origin, by name (tests/compliance/direct_origin_holders.test.ts); its CSP names the
 * origin in connect-src and admin's does not.
 */
const FALLBACK_URL = supabaseDirectOrigin(window.location.hostname);

// Moved to ./publish.ts so the acceptance test can call submitPublish without a DOM (FF-4 f); re-exported
// here so every test that reads these names keeps its import path.
export { UNRECOGNISED, UNREACHABLE_PUBLISH, WARD_MESSAGES, wardMessageFor, type PublishForm, type WardRow };

/** Looked up per render, not once at load, so a page that rebuilds #app is still written into. */
function appRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#app');
}

/**
 * A NOTICE'S TONE, FROM THE DESIGN SYSTEM'S OWN Notice (R-2026-09-26-133 DI-2): info for
 * what went through ("Published.", the replay line, the link-sent sentence), caution for
 * every refusal or failure. There is no green tone: nothing in the console reads as live
 * (-126 DB-1). The words carry the meaning; the tone never does on its own.
 */
type Tone = 'info' | 'caution';

/** Writes a status line and its tone. Empty text clears both, and style.css hides the line. */
function say(p: HTMLElement, text: string, tone: Tone): void {
  p.textContent = text;
  p.classList.remove('notice-info', 'notice-caution');
  if (text !== '') p.classList.add(`notice-${tone}`);
}

/**
 * A heading and one line. Every screen shown this way refuses something (a bad link, a load
 * that failed, no ward, a session that ended), so its line is a caution Notice (D2; DI-2),
 * words unchanged -- except the signed-out screen's instruction, which is the page's own
 * lead text and refuses nothing.
 */
function show(heading: string, detail: string, kind: 'caution' | 'lead' = 'caution'): void {
  const root = appRoot();
  if (root === null) return;
  const h = document.createElement('h1');
  h.textContent = heading;
  const p = document.createElement('p');
  p.className = kind === 'lead' ? 'lead' : 'notice notice-caution';
  p.textContent = detail;
  root.replaceChildren(h, p);
}

/**
 * THE LINE A READ-ONLY ROW CARRIES (R-2026-09-27-144 DT, Bundle 2): the ward is not this
 * login's to publish for. For a ward login that is every other ward at its facility, each
 * reporting from its own login. It is muted text, not a Notice: it refuses nothing.
 */
export const REPORTS_OWN = 'This ward reports from its own login.';



export const ROW_REFUSED = `This ward's record could not be read, so it cannot be updated from here. Reload the page. ${CALL_OPERATOR}`;
export const LOAD_REFUSED = `The ward list could not be read. Reload the page. ${CALL_OPERATOR}`;
/**
 * A SESSION WITH NO WARD (R-2026-09-24-88 BP-8; the found-on-landing item of
 * R-2026-09-23-72). my_reporting_wards answers a PLATFORM_ADMIN with 200 and zero
 * rows (observed of my_facility_wards, whose body 026 kept under the new name), a
 * WARD_STAFF account always has its ward, and a facility reporter's facility has at
 * least one (026 refuses it NO_CATEGORY otherwise), so zero rows is an operator
 * whose sign-in fell back to this console (the Site URL fallback, AZ-1) or broken
 * data. It is a stop, never an empty handover list that looks like a sign-in that
 * worked. The words are in packages/labels; the support sentence is appended here
 * because the other way to reach it is a real ward's broken account (BR-2).
 */
export const NO_WARD_SESSION = `${NO_WARD} ${ASK_FOR_HELP}`;
export const BAD_LINK = 'That sign-in link cannot be used. It may have been used already, or it has expired. Ask for a new one below.';

/**
 * THE ONE THING A SIGN-IN REQUEST CAN BE TOLD, whatever GoTrue answered (see
 * packages/auth/src/request.ts for why a 200, a 422 and a 429 must all read the same:
 * each of them is otherwise evidence about whether the address exists). It is
 * conditional on purpose -- it cannot know whether a link was sent, and says so.
 */
export const SIGNIN_ANSWERED =
  'If this address belongs to a ward, a sign-in link is on its way to it. Open it on this handset. ' +
  `If nothing arrives within 5 minutes, ask again once; if it still does not arrive, ${GET_HELP}`;
/** The only other outcome: no answer came back at all, which says nothing about the address. */
export const SIGNIN_UNREACHABLE = 'The request could not be sent. Check this handset is online, then try again.';
/**
 * THE WORKER LIMITED THE REQUEST (R-2026-10-02-FF FF-3): too many sign-in links were asked for from this
 * network. Its words are in packages/labels (`signin.LIMITED`), and the admin app keeps the same sentence.
 * It is a caution Notice, and it says nothing about the address, so it leaks nothing.
 */
export const SIGNIN_LIMITED_WORDS: string = SIGNIN_LIMITED;

/**
 * "NOT NOW" SENTENCES (R-2026-10-02-FF FF-4 c, -182). A renewal that is only "not now" KEEPS the session
 * (packages/auth/src/holder.ts), so these never say the session ended, and each says it is kept. None names
 * the Worker, Cloudflare or Supabase: a ward cannot act on those names. They are NOT in WARD_MESSAGES, which
 * tests/compliance/ward_console_render.test.ts holds exact to the codes the migrations raise; these are
 * raised by no migration. The clinicians' wording list (the A7 box) carries them.
 */
/**
 * RESTATED 2026-10-03 (R-2026-10-02-FG FG-4 a, -183), each with the text FF-4 c wrote kept. A sentence about
 * what happened on the wire is written for EVERY path that reaches it, and two of FF's were false on a path
 * that does:
 *  - RENEWAL_UNAVAILABLE_PUBLISH said "this update was not sent". Since FG-3 a kept token's 401 reaches it
 *    AFTER a send that wrote nothing, so it now says "not published". Was: "Your sign-in could not be
 *    renewed just now, so this update was not sent. Your sign-in is kept. Wait one minute, then tap Publish
 *    again."
 *  - UNREACHABLE_PUBLISH (now in ./publish.ts) said "was not sent" and "could not reach OpenBed": false when
 *    the Worker forwarded the publish and lost the answer, or the answer's body failed to read.
 *  - UNREACHABLE_LOAD said "was not loaded: this handset could not reach OpenBed", false in the body-read
 *    case. Was: "The handover list was not loaded: this handset could not reach OpenBed. Check it is online,
 *    then tap Try again. Your sign-in is kept."
 * RENEWAL_UNAVAILABLE_LOAD is unchanged: no list is shown on any path that reaches it.
 */
export const RENEWAL_UNAVAILABLE_PUBLISH =
  'Your sign-in could not be renewed just now, so this update was not published. Your sign-in is kept. Wait one minute, then tap Publish again.';
export const RENEWAL_UNAVAILABLE_LOAD =
  'Your sign-in could not be renewed just now, so the handover list was not loaded. Your sign-in is kept. Wait one minute, then tap Try again.';
export const UNREACHABLE_LOAD =
  'The handover list did not load: the connection to OpenBed failed. Check this handset is online, then tap Try again. Your sign-in is kept.';

/**
 * The eight reasons a ward may give for zero offered beds -- app.zero_reason (002),
 * with words a ward reads. Since R-2026-09-23-70 E the words live in
 * packages/labels/ward-labels.json with every other word this console shows, so the
 * console holds no word table of its own; re-exported here for the tests that read it.
 */
export { ZERO_REASONS };

export interface RowRefusal {
  readonly refused: true;
  /** The category, only when it is a well-formed enum label -- never arbitrary server text. */
  readonly category: string | null;
  readonly why: string;
}

/**
 * A ROW THE SERVER SENT, OR A REFUSAL -- NEVER A GUESS (R-2026-09-21-44 E, B2).
 *
 * This used to default a missing `offering` to 'NOT_OFFERED' -- a clinical claim
 * the server never made -- and a missing `version` to 0, which becomes
 * p_expected_version and turns optimistic concurrency into a guess. A missing
 * `accepting` read as false and a missing category as '(unnamed ward)'. Every one
 * of those is now a refusal: the row renders as unreadable, with no publish form.
 */
export function wardRowFrom(r: unknown): WardRow | RowRefusal {
  const row = (typeof r === 'object' && r !== null ? r : {}) as Record<string, unknown>;
  const category = typeof row['category'] === 'string' && /^[A-Z_]+$/.test(row['category']) ? row['category'] : null;
  const refuse = (why: string): RowRefusal => ({ refused: true, category, why });
  if (category === null) return refuse('category is missing or not a ward category');
  const offering = row['offering'];
  if (offering !== 'OFFERED' && offering !== 'NOT_OFFERED') return refuse('offering is neither OFFERED nor NOT_OFFERED');
  const version = row['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return refuse('version is not a positive integer');
  const beds = row['bed_count'];
  if (!(beds === null || (typeof beds === 'number' && Number.isInteger(beds) && beds >= 0))) return refuse('bed_count is neither null nor a whole number');
  const accepting = row['accepting'];
  if (typeof accepting !== 'boolean') return refuse('accepting is not true or false');
  const gatedBy = row['gated_by'];
  if (!(gatedBy === null || gatedBy === undefined || typeof gatedBy === 'string')) return refuse('gated_by is not text');
  // The three states the console read none of until R-2026-09-23-70 E, and which
  // decide how the line reads. Missing is refused like every other field; a code the
  // label table does not know renders "Status unknown", never the code.
  const code = (v: unknown): string | null => (typeof v === 'string' && /^[A-Z_]+$/.test(v) ? v : null);
  const monitoringState = code(row['monitoring_state']);
  if (monitoringState === null) return refuse('monitoring_state is missing or not a code');
  const source = code(row['source']);
  if (source === null) return refuse('source is missing or not a code');
  const state = code(row['state']);
  if (state === null) return refuse('state is missing or not a code');
  // can_publish (026): absent reads as false (DT Bundle 2), so an older server's row is
  // read-only, never publishable. Present and not true or false is refused, like every
  // other field: a flag that decides whether a form exists is never guessed.
  const canPublish = row['can_publish'];
  if (!(canPublish === undefined || typeof canPublish === 'boolean')) return refuse('can_publish is not true or false');
  return { category, offering, bedCount: beds, accepting, version, gatedBy: gatedBy ?? null, monitoringState, source, state, canPublish: canPublish === true };
}

function isRefusal(w: WardRow | RowRefusal): w is RowRefusal {
  return 'refused' in w;
}

/** A fresh id per NEW publish attempt. Reused verbatim on a retry of the SAME
 * attempt (see publishFormFor) so a retried request replays rather than
 * duplicates; a new one is only minted after a submission succeeds. */
function newMutationId(): string {
  return crypto.randomUUID();
}

/** The range 004's CHECK accepts for a bed count, which the steppers never leave. */
export const COUNT_MIN = 0;
export const COUNT_MAX = 500;

/**
 * THE STEPPERS' ONE RULE (the design pass, D2): the count field's next value after a tap
 * on − (delta -1) or + (delta +1), clamped to COUNT_MIN..COUNT_MAX. A blank or unreadable
 * field steps from 0, and a fraction steps from its whole part. It returns the text to put
 * in the field and does nothing else: a stepper edits a field the ward already edits, and
 * NEVER publishes. Publishing stays the ward's own tap on Publish.
 */
export function stepCount(value: string, delta: 1 | -1): string {
  const n = Number(value);
  const base = value.trim() === '' || !Number.isFinite(n) ? 0 : Math.trunc(n);
  return String(Math.min(COUNT_MAX, Math.max(COUNT_MIN, base + delta)));
}

/**
 * One ward's publish form. A PUBLISH UPDATES ITS OWN CARD ONLY (R-2026-09-26-133 DI-1): on
 * success this form keeps its DOM node and its fields, tells onPublished the new row (which
 * rewrites the card's summary and nothing else), and only then says "Published." here.
 * Until DI the handover was rebuilt on every publish, which erased that line the moment it
 * was written, and every other card's unsent edits and Notices with it.
 *
 * `current` is the row this form now stands for. The next publish sends ITS version as
 * p_expected_version, never the row the form was built from, which after one publish is
 * stale and would be refused as a version conflict.
 */
function publishFormFor(holder: SessionHolder, ward: WardRow, onPublished: (updated: WardRow) => void): HTMLFormElement {
  let current = ward;
  const form = document.createElement('form');
  form.className = 'publish';
  // THE FORM DOES ITS OWN VALIDATION (R-2026-09-26-134 DJ-1). With the browser's, a tap on
  // Publish with a blank count or a zero with no reason showed the browser's own bubble, in
  // the browser's words, and the console's sentences below never ran. The fields keep
  // required, min, max and step, so assistive tech still reports them. The sign-in form
  // keeps the browser's validation: the console has no sentence for a malformed address.
  form.noValidate = true;

  const offeringSelect = document.createElement('select');
  offeringSelect.name = 'offering';
  offeringSelect.className = 'select';
  for (const [value, label] of OFFERING_CHOICES) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === ward.offering) option.selected = true;
    offeringSelect.appendChild(option);
  }

  const bedCountInput = document.createElement('input');
  bedCountInput.name = 'bed_count';
  bedCountInput.type = 'number';
  bedCountInput.min = '0';
  bedCountInput.max = '500';
  bedCountInput.step = '1';
  bedCountInput.value = ward.bedCount === null ? '' : String(ward.bedCount);
  bedCountInput.className = 'count';
  // Control labels (R-2026-09-26-133 DI-3), not messages; they are on the clinicians'
  // wording list (runbook 12.4 step 1, the A7 box) to confirm or change.
  bedCountInput.setAttribute('aria-label', 'Beds');

  // − (U+2212) and +, beside the count (D2). type="button", never the default "submit",
  // so a tap cannot send the form; each only rewrites the field and re-runs sync(), which
  // shows the reason choice when the count reaches 0.
  const stepper = (glyph: string, delta: 1 | -1, label: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stepper';
    b.textContent = glyph;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => {
      bedCountInput.value = stepCount(bedCountInput.value, delta);
      // A programmatic value change fires no input event, so the stale outcome is
      // cleared here too (DI-1 c), and a failed send's mutation id is replaced (FG-4 b).
      edited();
      sync();
    });
    return b;
  };
  const countRow = document.createElement('div');
  countRow.className = 'count-row';
  countRow.append(stepper('−', -1, 'Fewer beds'), bedCountInput, stepper('+', 1, 'More beds'));

  const acceptingInput = document.createElement('input');
  acceptingInput.name = 'accepting';
  acceptingInput.type = 'checkbox';
  acceptingInput.checked = ward.accepting;
  const acceptingLabel = document.createElement('label');
  acceptingLabel.className = 'check';
  acceptingLabel.append(acceptingInput, document.createTextNode('Accepting'));

  // THE REASON IS A CHOICE, NOT TEXT. The server casts it to app.zero_reason, so a
  // free-text box refused everything a ward would naturally type (R-2026-09-23-66).
  // It stays a <select>, styled (the kickoff's logged call 2: chips are a v2 change).
  const reasonSelect = document.createElement('select');
  reasonSelect.name = 'reason';
  reasonSelect.className = 'select';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Why are there no beds?';
  reasonSelect.appendChild(blank);
  for (const [value, label] of ZERO_REASONS) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    reasonSelect.appendChild(option);
  }

  // A WARD THAT IS NOT OFFERED HAS NO COUNT. The count input used to be required
  // and always sent, so every NOT_OFFERED publish hit 004's CHECK
  // ward_status_not_offered_has_no_count and no ward could ever publish it
  // (R-2026-09-23-66). The count and "Accepting" now hide, and the form sends a null
  // count and accepting=false: a service the ward does not offer is not one it is
  // accepting patients for.
  function sync(): void {
    const offered = offeringSelect.value === 'OFFERED';
    countRow.hidden = !offered;
    bedCountInput.hidden = !offered;
    bedCountInput.required = offered;
    acceptingLabel.hidden = !offered;
    const needsReason = offered && bedCountInput.value === '0';
    reasonSelect.hidden = !needsReason;
    reasonSelect.required = needsReason;
  }
  offeringSelect.addEventListener('change', sync);
  bedCountInput.addEventListener('input', sync);
  sync();

  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.className = 'primary';
  submitButton.textContent = 'Publish';

  // A Notice (D2), empty until there is something to say; style.css hides it while empty.
  // role="status" so the outcome is announced (DI-2 d).
  const status = document.createElement('p');
  status.className = 'status notice';
  status.setAttribute('role', 'status');

  // AN OUTCOME NEVER OUTLIVES THE NEXT EDIT (DI-1 c): a "Published." beside a number the
  // ward has since changed reads as though that number went out. Listened for on each
  // field, not the form, so it does not depend on the event bubbling.
  const clearOutcome = (): void => say(status, '', 'info');

  let mutationId = newMutationId();
  // AN EDIT AFTER A FAILED SEND GETS A NEW MUTATION ID (R-2026-10-02-FG FG-4 b, -183). The id used to be kept
  // on every failure, and the form stayed editable, so a ward who changed the count after a failure and tapped
  // again sent the NEW body under the OLD id: 026's step 6 replays and returns the FIRST send's values, the
  // console said "Already published (replay)", and the edit was silently never written. `lastSendFailed` is
  // true from the moment a tap reaches submitPublish until it succeeds or an edit mints. A re-tap with NO edit
  // keeps the id and still replays. If the first send HAD landed, the new id meets VERSION_CONFLICT (the
  // expected version is unchanged), which is a fixed sentence, so the record is honest either way. `edited()`
  // is called at EVERY site that changes a field, never from clearOutcome, which also runs at submit.
  let lastSendFailed = false;
  const edited = (): void => {
    clearOutcome();
    if (lastSendFailed) {
      mutationId = newMutationId();
      lastSendFailed = false;
    }
  };
  offeringSelect.addEventListener('change', edited);
  bedCountInput.addEventListener('input', edited);
  acceptingInput.addEventListener('change', edited);
  reasonSelect.addEventListener('change', edited);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      clearOutcome();
      const offering = offeringSelect.value === 'NOT_OFFERED' ? 'NOT_OFFERED' : 'OFFERED';
      let bedCount: number | null = null;
      if (offering === 'OFFERED') {
        const n = Number(bedCountInput.value);
        if (bedCountInput.value.trim() === '' || !Number.isInteger(n) || n < 0 || n > 500) {
          say(status, 'Enter the number of free beds, from 0 to 500.', 'caution');
          bedCountInput.focus();
          return;
        }
        bedCount = n;
      }
      const reason = offering === 'OFFERED' && bedCount === 0 && reasonSelect.value !== '' ? reasonSelect.value : null;
      if (offering === 'OFFERED' && bedCount === 0 && reason === null) {
        say(status, WARD_MESSAGES['ZERO_REQUIRES_REASON'] as string, 'caution');
        reasonSelect.focus();
        return;
      }

      submitButton.disabled = true;
      lastSendFailed = true;
      try {
        const outcome = await submitPublish(
          holder,
          current,
          { offering, bedCount, accepting: offering === 'OFFERED' ? acceptingInput.checked : false, reason },
          mutationId,
        );
        if (!outcome.ok) {
          say(status, outcome.message, 'caution');
          return;
        }
        // A fresh attempt gets a new mutation id after a SUCCESS; a retry of THIS attempt reuses
        // `mutationId`, and an edit after a failure mints one (`edited()`, FG-4 b).
        // RESTATED 2026-10-03 (FG-4 b). The old text, kept: "A fresh attempt gets a new mutation id; a retry
        // of THIS attempt would have reused `mutationId` above, never regenerating it on a failure branch."
        mutationId = newMutationId();
        lastSendFailed = false;
        const updated: WardRow = {
          category: current.category,
          offering: outcome.result.claim_offering,
          bedCount: outcome.result.claim_bed_count,
          accepting: outcome.result.claim_accepting,
          version: outcome.result.version,
          gatedBy: outcome.result.public_gated_by,
          // What publish_ward_status's UPDATE does to the three states it does not
          // return (014:265-276): source becomes WARD, PENDING becomes ACTIVE and any
          // other monitoring state is kept, and `state` is never written.
          monitoringState: current.monitoringState === 'PENDING' ? 'ACTIVE' : current.monitoringState,
          source: 'WARD',
          state: current.state,
          // Only a publishable row has a form, and a publish does not change who may publish.
          canPublish: current.canPublish,
        };
        current = updated;
        onPublished(updated);
        // Said AFTER the card is updated, so nothing the update does can erase it (DI-1 a).
        say(status, outcome.result.replayed ? 'Already published (replay).' : 'Published.', 'info');
      } catch (e) {
        if (e instanceof SessionExpiredError) {
          show('Signed out', TAP_AGAIN);
          return;
        }
        // THE SESSION IS KEPT in both of these, and so is the form's mutation id, so a re-tap with no edit
        // replays rather than duplicates. RESTATED 2026-10-03 (FG-4 b): the id is now regenerated after a
        // success AND by an edit that follows a failed send (`edited()`); it used to be "only ever
        // regenerated after a success, above", which let an edited body ride a stale id.
        if (e instanceof RenewalUnavailableError) {
          say(status, RENEWAL_UNAVAILABLE_PUBLISH, 'caution');
          return;
        }
        if (e instanceof OriginsUnreachableError) {
          say(status, UNREACHABLE_PUBLISH, 'caution');
          return;
        }
        console.error('OpenBed ward console: the publish did not complete', e);
        say(status, UNRECOGNISED, 'caution');
      } finally {
        submitButton.disabled = false;
      }
    })();
  });

  form.append(offeringSelect, countRow, acceptingLabel, reasonSelect, submitButton, status);
  return form;
}

/**
 * ONE WARD'S LINE, IN WORDS, WITH THE PUBLIC PAGE'S PRECEDENCE (R-2026-09-23-70 E).
 * This printed the database's codes until then -- "ICU_ADULT: NOT_OFFERED, not yet
 * reporting" -- and showed a PENDING ward's default offering as if someone had stated
 * it. The words and the order in which states win are precedence() in
 * packages/labels, the same function the public page uses, so the two cannot
 * disagree.
 */
export function summaryLine(ward: WardRow): string {
  const category = categoryLabel(ward.category);
  const p = precedence({ monitoring_state: ward.monitoringState, offering: ward.offering, source: ward.source, state: ward.state });
  if (p.kind !== 'claim') return `${category}: ${p.words}`;
  // `bedCount === null` means never reported, and is rendered as such rather than as
  // zero. Publishing "0 beds" for a ward nobody has updated states a claim the
  // facility never made.
  const beds = ward.bedCount === null ? 'not yet reporting' : bedCountText(ward.bedCount);
  return `${category}: ${beds}${ward.accepting ? '' : ' — not accepting'}${ward.gatedBy ? ` (${reasonLabel(ward.gatedBy)})` : ''}${p.qualifiers}`;
}

function renderHandover(holder: SessionHolder, email: string | null, wards: (WardRow | RowRefusal)[]): void {
  const root = appRoot();
  if (root === null) return;
  const h = document.createElement('h1');
  h.textContent = 'Handover';
  const who = document.createElement('p');
  who.className = 'who';
  who.textContent = email === null ? 'Signed in.' : `Signed in as ${email}.`;

  // Each ward is a card (D2). The summary stays `li > p` and its words are summaryLine's,
  // unchanged; it takes no status colour, because the line carries no age and a coloured
  // claim with no freshness is the "go" signal D1 withholds (R-2026-09-26-126 DB-1).
  const list = document.createElement('ul');
  list.className = 'wards';
  for (const ward of wards) {
    const li = document.createElement('li');
    li.className = 'ward';
    const summary = document.createElement('p');
    summary.className = 'summary';

    if (isRefusal(ward)) {
      // No form: a row that cannot be read cannot be published for, and must not
      // look like one that can.
      console.error('OpenBed ward console: a ward row was refused', ward);
      summary.className = 'refused notice notice-caution';
      summary.textContent = `${ward.category === null ? 'A ward' : categoryLabel(ward.category)}: ${ROW_REFUSED}`;
      li.append(summary);
      list.append(li);
      continue;
    }

    summary.textContent = summaryLine(ward);

    // Not this login's ward (can_publish false, or absent): its status, read-only, and one
    // muted line. No form, so nothing on this card can send a publish.
    if (!ward.canPublish) {
      const own = document.createElement('p');
      own.className = 'reports-own';
      own.textContent = REPORTS_OWN;
      li.append(summary, own);
      list.append(li);
      continue;
    }

    // A publish rewrites THIS card's summary and nothing else (DI-1 a, e): the handover is
    // rendered once, at load, and every other card keeps its node, its fields and its Notice.
    const form = publishFormFor(holder, ward, (updated) => {
      const index = wards.findIndex((w) => !isRefusal(w) && w.category === ward.category);
      if (index !== -1) wards[index] = updated;
      summary.textContent = summaryLine(updated);
    });

    li.append(summary, form);
    list.append(li);
  }

  root.replaceChildren(h, who, list);
}

/**
 * The ward's own request for a new link: an address, one button, one status line.
 * Shown on the signed-out screen and under a refused link.
 */
function signInRequestForm(): HTMLFormElement {
  const form = document.createElement('form');
  form.className = 'signin-request';
  // A single column (D2): the label's words, a 44 px field under them, a 52 px button.
  const label = document.createElement('label');
  label.className = 'field';
  // "Sign-in email address" since R-2026-09-27-144 DT Bundle 2: a facility login signs in
  // here too, and its address is not a ward's. Every other sentence is unchanged.
  label.textContent = 'Sign-in email address ';
  const email = document.createElement('input');
  email.type = 'email';
  email.name = 'email';
  email.required = true;
  email.autocomplete = 'email';
  label.append(email);
  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'primary';
  button.textContent = 'Send a new sign-in link';
  const status = document.createElement('p');
  status.className = 'status notice';
  status.setAttribute('role', 'status');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      button.disabled = true;
      say(status, '', 'info');
      try {
        const outcome = await requestSignInLink({
          apiUrl: API_URL,
          fallbackApiUrl: FALLBACK_URL,
          anonKey: PUBLISHABLE_KEY,
          email: email.value,
          redirectTo: `${window.location.origin}/`,
        });
        // The status goes to the log for whoever debugs it; the page says one thing. EXHAUSTIVE (FF-3 c): a
        // fourth outcome added to requestSignInLink fails to compile here, where a bare `else` would have
        // shown it the "no answer" sentence.
        switch (outcome.kind) {
          case 'answered':
            if (outcome.status !== 200) console.error('OpenBed ward console: the sign-in request was answered', outcome.status);
            say(status, SIGNIN_ANSWERED, 'info');
            break;
          case 'limited':
            say(status, SIGNIN_LIMITED_WORDS, 'caution');
            break;
          case 'unreachable':
            console.error('OpenBed ward console: the sign-in request got no answer', outcome.error);
            say(status, SIGNIN_UNREACHABLE, 'caution');
            break;
          default:
            return unhandledOutcome(outcome);
        }
      } finally {
        button.disabled = false;
      }
    })();
  });

  form.append(label, button, status);
  return form;
}

/** The `never` end of an exhaustive switch: a new outcome that reaches here is a compile error first, a thrown error second. */
function unhandledOutcome(outcome: never): never {
  throw new Error(`an unhandled sign-in outcome: ${JSON.stringify(outcome)}`);
}

/**
 * The privacy notice's link, under the sign-in form (R-2026-09-26-136 DL-1 d): small,
 * muted, a real link with a 44 px target, and no new colour. Its URL is the one tracked
 * constant; tests/compliance/privacy_links.test.ts asserts it on every sign-in state.
 */
function privacyLink(): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'privacy';
  const a = document.createElement('a');
  a.href = PRIVACY_NOTICE_URL;
  a.textContent = 'Privacy notice';
  p.append(a);
  return p;
}

/** A screen that also offers the ward a new link, with the privacy notice under it. */
function showWithRequest(heading: string, detail: string, kind: 'caution' | 'lead' = 'caution'): void {
  show(heading, detail, kind);
  appRoot()?.append(signInRequestForm(), privacyLink());
}

/**
 * Exported so a test can call it and then read the DOM, rather than re-importing
 * the module to make it run again -- the public dashboard's pattern.
 */
export async function render(): Promise<void> {
  // THE 'NOT CONFIGURED' SCREEN IS GONE, and its absence is the improvement rather
  // than a loss. It existed because Vite replaces an unset import.meta.env read with
  // `undefined`, so a console built without the variable would have sent
  // `Bearer undefined` and reported an auth failure that had nothing to do with
  // auth. Both values are now compiled in from tracked files, so a build CANNOT
  // lack them -- the stop condition has no state left to detect.

  let session;
  try {
    session = sessionFromUrlFragment(window.location.hash);
  } catch (e) {
    // The link itself was refused -- already used, or expired. GoTrue's own words
    // for why go to the log, never to the screen (D1's third site).
    console.error('OpenBed ward console: the sign-in link was refused', e);
    showWithRequest('That link did not work', BAD_LINK);
    return;
  }

  if (session === null) {
    showWithRequest('Ward console', 'Open the sign-in link sent to your sign-in address on this handset, or ask for a new one below.', 'lead');
    return;
  }

  // THE TOKENS LEAVE THE ADDRESS BAR IMMEDIATELY. A fragment is never sent to a
  // server, but it is visible on screen, survives a screenshot, and is carried
  // by anything the ward pastes the URL into.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);

  const holder = new SessionHolder({ apiUrl: API_URL, fallbackApiUrl: FALLBACK_URL, anonKey: PUBLISHABLE_KEY, session });
  await loadHandover(holder);
}

/**
 * THE HANDOVER LOAD, re-runnable with the SAME holder (R-2026-10-02-FF FF-4 c). "Try again" calls this and
 * NEVER reloads the page: the session is held in memory only (the 2026-09-08 ward-identity decision), so a
 * reload would end it, and a signed-out ward needs a new emailed link.
 */
async function loadHandover(holder: SessionHolder): Promise<void> {
  try {
    const res = await holder.authedFetch('rpc/my_reporting_wards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    // READ THE BODY AS TEXT, in a try (FG-4 c): a read that throws is the connection failing after the answer
    // began, so it gets UNREACHABLE_LOAD and Try again. A body that reads but is not JSON stays UNRECOGNISED.
    let text: string;
    try {
      text = await res.text();
    } catch {
      showLoadFailed(holder, UNREACHABLE_LOAD);
      return;
    }
    if (!res.ok) {
      show('Could not load the handover list', wardMessageFor(res.status, text));
      return;
    }
    let rows: unknown;
    try {
      rows = JSON.parse(text);
    } catch {
      console.error('OpenBed ward console: the ward list was not JSON');
      show('Could not load the handover list', UNRECOGNISED);
      return;
    }
    if (!Array.isArray(rows)) {
      console.error('OpenBed ward console: the ward list was not a list', rows);
      show('Could not load the handover list', LOAD_REFUSED);
      return;
    }
    if (rows.length === 0) {
      show(NO_WARD_HEADING, NO_WARD_SESSION);
      return;
    }
    renderHandover(holder, holder.session?.claims.email ?? null, rows.map(wardRowFrom));
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      show('Signed out', TAP_AGAIN);
      return;
    }
    if (e instanceof RenewalUnavailableError) {
      showLoadFailed(holder, RENEWAL_UNAVAILABLE_LOAD);
      return;
    }
    if (e instanceof OriginsUnreachableError) {
      showLoadFailed(holder, UNREACHABLE_LOAD);
      return;
    }
    console.error('OpenBed ward console: the handover list did not load', e);
    show('Could not load the handover list', UNRECOGNISED);
  }
}

/** The load failed and the session is kept: the sentence, and a "Try again" that re-runs the load with the same holder. */
function showLoadFailed(holder: SessionHolder, detail: string): void {
  show('Could not load the handover list', detail);
  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'primary';
  again.textContent = 'Try again';
  again.addEventListener('click', () => {
    again.disabled = true;
    void loadHandover(holder);
  });
  appRoot()?.append(again);
}

void render();
