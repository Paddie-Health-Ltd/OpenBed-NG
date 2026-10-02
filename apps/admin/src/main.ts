import { RenewalUnavailableError, SessionExpiredError, SessionHolder, requestSignInLink, sessionFromUrlFragment } from '@openbed/auth';
import { apiOrigin } from '@openbed/origins';
import { publishableKeyFor } from '@openbed/origins/keys';
import { PRIVACY_NOTICE_URL } from '@openbed/origins/privacy';
import { bedCountText, categoryLabel } from '@openbed/labels';
import { ADMIN_CODES, ADMIN_FIXED, ADMIN_SCREENS as W, WARD_CATEGORIES } from '@openbed/labels/admin';
import { FUTURE_TOLERANCE_MS, SNAPSHOT_JOB, decideHealth, elapsedSince, freshnessBand, lagosTime, markFetch, snapshotAge, type FetchMark, type FreshnessBand } from '@openbed/snapshot';
import '@openbed/design/tokens.css';
import '@openbed/design/fonts.css';
import './style.css';
import {
  RPC,
  addCategoryBody,
  createFacilityBody,
  editFacilityBody,
  getContactBody,
  normaliseNgPhone,
  recordAgreementBody,
  recordContactBody,
  recordRegistrationBody,
  registerBody,
  schedulerStatusBody,
  setListedBody,
  type FacilityFields,
} from './bodies.js';
import { parseContact, parseRegister, parseSchedulerStatus, type ContactView, type Facility, type Register, type ReportingModel, type SchedulerStatus, type Ward } from './parse.js';
import { adminMessageFor, type Refusal } from './messages.js';

/**
 * THE ADMIN APP (admin.openbed.ng). The operator signs in with a magic link, sees
 * every facility and what it still needs, and makes the operator_* writes under the
 * operator's own session (R-2026-09-23-71 C; R-2026-09-24-88 BP-2..BP-5, BP-11; the
 * PR 3.4b-app C design report, accepted by R-2026-09-24-97).
 *
 * THE SHAPE IS THE WARD CONSOLE'S, AND SO ARE ITS REASONS. No Supabase client: the
 * sign-in and the session come from packages/auth, which the E2E harness proves, so
 * there is one derivation site for how the system authenticates. No persistence: the
 * session lives in a SessionHolder in this page and nowhere else, and closing the tab
 * ends it. The database origin and the publishable key are tracked configuration,
 * chosen at run time by hostname (packages/origins), so this file reads no environment.
 *
 * NOTHING IS STORED CLIENT-SIDE (BP-3). No localStorage, sessionStorage, IndexedDB or
 * cookie; tests/compliance/admin_render.test.ts scans this app's source for them. The
 * register is re-read after every write, and every checklist line is derived from the
 * row the server returned.
 *
 * THE CONTACT IS A NAMED PERSON'S DATA (BP-5). It is read with operator_get_contact
 * only when one facility's detail is opened, held in that view alone, and gone from the
 * page when the view closes. It is never logged: messages.ts logs a status and a code,
 * never a body.
 *
 * WRITES ARE NEVER RETRIED BY THIS PAGE, AND NEVER QUEUED (BP-4; R-2026-09-24-97 BY-2 e).
 *   - Create is safe to repeat by design: its id is made once, when the form opens, and
 *     every submit from that form sends it (020's J2). After a dropped answer the
 *     operator presses again, and a created=false answer is shown as created.
 *   - Edit is NOT safe to repeat: 020 bumps the version on every update, so a replay
 *     answers VERSION_CONFLICT. After a dropped answer the page reloads the facility and
 *     says so; it never sends the edit again.
 *   - A VERSION_CONFLICT reloads and says the facility changed. The operator's values are
 *     never re-sent on top.
 * Reads (the register, the contact) retry once when no answer came, as the sign-in
 * request does.
 *
 * TIMES ARE LAGOS TIMES, AND FRESHNESS COMES FROM THE SERVER'S CLOCK. `server_now` from
 * the register, plus monotonic time since the fetch (packages/snapshot's anchor), never
 * the device clock: the operator is often in Hong Kong. A band never filters, sorts or
 * hides a row (AJ D8).
 *
 * THE EDIT FORM SHOWS WHAT IS SAVED (R-2026-09-24-98 BZ-1, BZ-3). Since 023 the register
 * carries each facility's latitude, longitude and public phone, so all six fields are
 * prefilled and nothing is retyped to fix an unrelated field. Each changed field is shown
 * as `<saved> → <new>` while the operator edits. A change to the PUBLIC PHONE -- the
 * number the public page shows for an emergency call -- is never sent on the Save press:
 * it needs an explicit confirm, and Cancel sends nothing. A latitude or longitude change
 * is shown the same way, without a confirm; the database CHECK is the backstop.
 *
 * THE DESIGN PASS, D3 (R-2026-09-27-139 DO-4, DO-5). Every status line is a Notice with
 * role="status", in the design system's two tones: info for what went through, caution
 * for every refusal or failure; the words are unchanged. The operator forms do their own
 * validation (noValidate), in their own sentences, with focus on the field that needs
 * fixing; the sign-in form keeps the browser's, as the ward console's does (-134 DJ).
 *
 * THE FACILITY-LEVEL LOGIN, THE HEFAMAA NUMBER AND THE RETENTION ALERT (R-2026-09-27-144 DT,
 * Bundle 3). Each facility shows its reporting model, from 026's reporting_model, and under
 * a facility login each ward reads "Reported by the facility login" in place of its own
 * login state. The HEFAMAA registration number is the Registration section's one optional
 * field, sent by operator_record_registration and shown nowhere but here. A non-empty
 * retention_alert is a caution Notice at the top of the register, one per job, and it is
 * fed by that field alone.
 *
 * AN UPDATE CHANGES ONLY WHAT IT UPDATED (DO-4 d; the ward console's -133 DI-1). A write
 * in one section of a facility's view re-reads the facility and patches the lines that
 * show saved state; it never rebuilds a form that holds another write's unsent input or
 * Notice. A form with unsent input keeps the saved row it was filled from, so its Save is
 * still checked against what the operator saw: the edit sends THAT version, never one a
 * later read brought in. A section is rebuilt only when what it offers changes (an
 * agreement recorded, a facility become listable or listed).
 */

const API_URL = apiOrigin(window.location.hostname);
const PUBLISHABLE_KEY = publishableKeyFor(window.location.hostname);

type CallResult = { readonly kind: 'ok'; readonly data: unknown } | { readonly kind: 'refused'; readonly refusal: Refusal } | { readonly kind: 'unreachable' };

function appRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#app');
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className !== undefined) e.className = className;
  return e;
}

/**
 * A NOTICE'S TONE, FROM THE DESIGN SYSTEM'S OWN Notice (D3, as the ward console's -133
 * DI-2): info for what went through (a facility created, saved or listed, a ward category
 * added, a contact saved, an agreement recorded, the link-sent sentence), caution for
 * every refusal or failure. There is no green tone. The words carry the meaning; the tone
 * never does on its own.
 */
type Tone = 'info' | 'caution';

/** Writes a status line and its tone. Empty text clears both, and style.css hides the line. */
function say(p: HTMLElement, text: string, tone: Tone): void {
  p.textContent = text;
  p.classList.remove('notice-info', 'notice-caution');
  if (text !== '') p.classList.add(`notice-${tone}`);
}

/** A status line: a Notice, announced by assistive tech, empty until there is something to say. */
function statusLine(text = '', tone: Tone = 'info'): HTMLParagraphElement {
  const p = el('p', undefined, 'status notice');
  p.setAttribute('role', 'status');
  say(p, text, tone);
  return p;
}

/**
 * A heading and one line. Every screen shown this way refuses something (a bad link, a
 * load that failed, a stop, a session that ended), so its line is a caution Notice, words
 * unchanged -- except the signed-out landing's instruction, the page's own lead text.
 */
function show(heading: string, detail: string, kind: 'caution' | 'lead' = 'caution'): void {
  appRoot()?.replaceChildren(el('h1', heading), el('p', detail, kind === 'lead' ? 'lead' : 'notice notice-caution'));
}

// ------------------------------------------------------------------ calls

/**
 * THE TEN CALLS, EACH A LITERAL PATH (-58 A5; the ninth since R-2026-09-27-144 DT Bundle 3, the tenth since R-2026-09-30-175 EY-3). The Worker's allow-list is derived from
 * the code's call sites by tests/compliance/proxy_allow_list.test.ts, which reads a
 * `.authedFetch('<literal>')` and refuses a computed path as unresolved. So each call
 * names its path here, in full, rather than building `rpc/${name}` -- which would be
 * one call site the derivation cannot read, standing for ten. The method is written
 * at each call too, because that is where the derivation reads it.
 */
type Call = (holder: SessionHolder, body: string) => Promise<Response>;
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const CALL = {
  register: (h, body) => h.authedFetch('rpc/operator_register', { method: 'POST', headers: JSON_HEADERS, body }),
  getContact: (h, body) => h.authedFetch('rpc/operator_get_contact', { method: 'POST', headers: JSON_HEADERS, body }),
  createFacility: (h, body) => h.authedFetch('rpc/operator_create_facility', { method: 'POST', headers: JSON_HEADERS, body }),
  editFacility: (h, body) => h.authedFetch('rpc/operator_edit_facility', { method: 'POST', headers: JSON_HEADERS, body }),
  addCategory: (h, body) => h.authedFetch('rpc/operator_add_category', { method: 'POST', headers: JSON_HEADERS, body }),
  recordContact: (h, body) => h.authedFetch('rpc/operator_record_contact', { method: 'POST', headers: JSON_HEADERS, body }),
  recordAgreement: (h, body) => h.authedFetch('rpc/operator_record_agreement', { method: 'POST', headers: JSON_HEADERS, body }),
  setListed: (h, body) => h.authedFetch('rpc/operator_set_facility_listed', { method: 'POST', headers: JSON_HEADERS, body }),
  recordRegistration: (h, body) => h.authedFetch('rpc/operator_record_registration', { method: 'POST', headers: JSON_HEADERS, body }),
  schedulerStatus: (h, body) => h.authedFetch('rpc/operator_scheduler_status', { method: 'POST', headers: JSON_HEADERS, body }),
} satisfies Record<keyof typeof RPC, Call>;

/**
 * `tolerant` is for READS only (R-2026-09-30-176 EZ-1). A read whose body cannot be read -- a 200 that
 * is not JSON, or one cut off mid-read, or a refusal cut off the same way -- answers `ok` with no data
 * (or a refusal with no text), which every reader already treats as "not the shape": the register's own
 * UNRECOGNISED, or the System status section's own failure line. Without it the rejection reached the
 * page's outer catch and replaced the whole page, register and section together, with no Reload.
 * A WRITE is sent with `tolerant` false and sees exactly what it always saw: a body it cannot read
 * still rejects, because a write must never be reported as read when its answer is unknown.
 * SessionExpiredError is thrown before any body is read, so it still ends the page either way.
 */
async function post(holder: SessionHolder, call: keyof typeof CALL, body: unknown, tolerant = false): Promise<CallResult> {
  let res: Response;
  try {
    res = await CALL[call](holder, JSON.stringify(body));
  } catch (e) {
    if (e instanceof SessionExpiredError) throw e;
    // A RENEWAL THAT IS ONLY "NOT NOW" (R-2026-10-02-FF FF-2 e) is rethrown, never turned into `unreachable`:
    // read() retries an `unreachable` after 300-600 ms, which would be the automatic retry the holder forbids.
    // The session is kept; the caller shows the sentence and the operator tries again.
    if (e instanceof RenewalUnavailableError) throw e;
    // Transport only: no answer came. Logged by which call, never by request values.
    console.error('OpenBed admin: no answer from the server', RPC[call]);
    return { kind: 'unreachable' };
  }
  if (tolerant) {
    if (res.ok) {
      const data: unknown = await res.json().catch(() => null);
      return { kind: 'ok', data };
    }
    const text = await res.text().catch(() => '');
    return { kind: 'refused', refusal: adminMessageFor(res.status, res.headers, text) };
  }
  if (res.ok) return { kind: 'ok', data: await res.json() };
  return { kind: 'refused', refusal: adminMessageFor(res.status, res.headers, await res.text()) };
}

/** A read: one retry, after 300-600 ms, when no answer came. Never on an answer. */
async function read(holder: SessionHolder, call: 'register' | 'getContact' | 'schedulerStatus', body: unknown): Promise<CallResult> {
  const first = await post(holder, call, body, true);
  if (first.kind !== 'unreachable') return first;
  await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
  return post(holder, call, body, true);
}

/** A write: sent once. Its caller decides what a missing answer means, per call. */
const write = post;

/** A view load started from a button: an ended session signs out, anything else says so. */
function guarded(p: Promise<unknown>): void {
  void p.catch((e: unknown) => {
    if (e instanceof SessionExpiredError) signedOut(W.SIGNED_OUT);
    else if (e instanceof RenewalUnavailableError) show(W.REGISTER_HEADING, W.RENEWAL_UNAVAILABLE);
    else {
      console.error('OpenBed admin: a view failed to load');
      show(W.REGISTER_HEADING, ADMIN_FIXED.UNRECOGNISED);
    }
  });
}

/**
 * A refusal that ends the session's use of this page. True when it was handled here:
 * a ward's session gets the stop screen, never a blank register (BP-11).
 */
function stopFor(refusal: Refusal): boolean {
  if (refusal.key === 'NOT_AN_OPERATOR' || refusal.key === 'ACCOUNT_DEACTIVATED') {
    show(W.STOP_HEADING, refusal.sentence);
    // A next step (DP-5 b 2): back to the sign-in, as a fresh page is. The session was
    // only ever in this page's memory; leaving the screen leaves it behind.
    const out = el('button', W.SIGN_OUT);
    out.type = 'button';
    out.addEventListener('click', () => landing());
    appRoot()?.append(out);
    return true;
  }
  if (refusal.key === 'NOT_AUTHENTICATED' || refusal.key === 'SESSION_ID_IS_ACCOUNT_ID') {
    signedOut(refusal.sentence);
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ register

const BAND_WORD: Record<FreshnessBand, string> = { GREEN: 'fresh', YELLOW: 'ageing', GREY: 'stale', SUPPRESSED: 'status unknown' };
const BAND_ORDER: FreshnessBand[] = ['GREEN', 'YELLOW', 'GREY', 'SUPPRESSED'];

function wardBand(w: Ward, reg: Register, mark: FetchMark): FreshnessBand | null {
  if (w.offering !== 'OFFERED' || w.monitoringState === 'PENDING' || w.updatedAt === null) return null;
  return freshnessBand(w.updatedAt, reg.serverNow, elapsedSince(mark)).band;
}

/** The facility's reporting model, in words (DT Bundle 3). */
const MODEL_WORD: Record<ReportingModel, string> = {
  FACILITY: W.REPORTING_MODEL_FACILITY,
  WARD: W.REPORTING_MODEL_WARD,
  NONE: W.REPORTING_MODEL_NONE,
};

function loginWord(w: Ward, model: ReportingModel): string {
  // Under a facility login a ward has no login of its own: the facility's reports for it.
  if (model === 'FACILITY') return W.REPORTED_BY_FACILITY;
  if (w.hasAccount) return W.LOGIN_ACTIVE;
  if (w.provisioningIncomplete) return W.LOGIN_INCOMPLETE;
  return W.LOGIN_NONE;
}

function wardLine(w: Ward, model: ReportingModel, reg: Register, mark: FetchMark): HTMLLIElement {
  const li = el('li', undefined, 'ward');
  const band = wardBand(w, reg, mark);
  let claim: string;
  if (w.offering === 'NOT_OFFERED') claim = 'not offered';
  else if (w.monitoringState === 'PENDING' || w.updatedAt === null) claim = W.NOT_YET_REPORTING;
  else claim = `${w.bedCount === null ? 'no count' : bedCountText(w.bedCount)}, last reported at ${lagosTime(w.updatedAt)} (${BAND_WORD[band as FreshnessBand]})`;
  li.textContent = `${categoryLabel(w.category)}: ${claim} — ${loginWord(w, model)}`;
  if (band !== null) li.dataset['band'] = band;
  return li;
}

function checklist(f: Facility): HTMLUListElement {
  const ul = el('ul', undefined, 'checklist');
  const agreement = { none: W.AGREEMENT_NONE, recorded: W.AGREEMENT_RECORDED, withdrawn: W.AGREEMENT_WITHDRAWN }[f.agreementState];
  ul.append(
    el('li', `${W.CHECK_CONTACT}: ${f.hasContact ? 'yes' : 'no'}`),
    el('li', `${W.CHECK_AGREEMENT}: ${agreement}`),
    el('li', `${W.CHECK_CATEGORY}: ${f.categories.length > 0 ? 'yes' : 'no'}`),
    el('li', `${W.CHECK_LISTED}: ${f.listedAt === null ? 'no' : 'yes'}`),
  );
  return ul;
}

function canList(f: Facility): boolean {
  return f.isActive && f.hasContact && f.agreementState === 'recorded' && f.categories.length > 0;
}

// ------------------------------------------------------------------ system status

/**
 * THE SYSTEM STATUS (R-2026-09-30-175 EY-3): what the scheduler is doing, for the operator.
 * Loaded beside the register, in the same clock (the `mark` taken before both reads), and
 * NEVER a filter on it: a facility is where it would be whatever this reads.
 *
 * THE CAUTION LINES COME FROM decideHealth, the function /api/health answers with, so the
 * page and the alert cannot disagree about whether the snapshot is stale: a generated_at in
 * the future is snapshot_stale in both. snapshotAge gives the DISPLAYED age only. A job that
 * is switched off, or whose last finished run did not succeed, is this page's own line; the
 * alert deliberately does not raise a failed run (health.ts), the operator is told here.
 *
 * A FAILED LOAD is a caution line INSIDE this section, and never show(): that replaces the
 * whole app, and a status that cannot be read must not hide the register (nor the reverse:
 * a register that cannot be read leaves this section on the page).
 */
type StatusLoad = { readonly kind: 'ok'; readonly status: SchedulerStatus } | { readonly kind: 'failed'; readonly sentence: string };

async function loadStatus(holder: SessionHolder): Promise<StatusLoad> {
  const r = await read(holder, 'schedulerStatus', schedulerStatusBody());
  if (r.kind === 'unreachable') return { kind: 'failed', sentence: ADMIN_FIXED.UNREACHABLE };
  if (r.kind === 'refused') return { kind: 'failed', sentence: r.refusal.sentence };
  const status = parseSchedulerStatus(r.data);
  return status === null ? { kind: 'failed', sentence: ADMIN_FIXED.UNRECOGNISED } : { kind: 'ok', status };
}

/** An age in words, from minutes: the resolution an operator acts on. */
function ageWords(minutes: number): string {
  if (minutes < 1) return W.AGE_UNDER_MINUTE;
  if (minutes < 2) return W.AGE_ONE_MINUTE;
  if (minutes < 120) return `${Math.floor(minutes)} ${W.AGE_MINUTES}`;
  return `${Math.floor(minutes / 60)} ${W.AGE_HOURS}`;
}

function statusSection(load: StatusLoad, mark: FetchMark): HTMLElement {
  const section = el('section', undefined, 'system-status');
  section.append(el('h2', W.SYSTEM_STATUS_HEADING));
  // The section's own status line, as every screen has one: empty until there is something
  // to say, and here that is only a status that could not be read.
  const line = statusLine('', 'caution');
  section.append(line);
  if (load.kind === 'failed') {
    say(line, load.sentence, 'caution');
    return section;
  }
  const s = load.status;
  const caution = (text: string): HTMLParagraphElement => el('p', text, 'notice notice-caution system-caution');
  const decision = decideHealth({
    outcome: 'answered',
    status: 200,
    body: { server_now: s.serverNow, generated_at: s.generatedAt, jobs: s.jobs.map((j) => ({ name: j.name, active: j.active, last_status: j.lastStatus, last_start_time: j.lastStartTime })) },
  });
  for (const reason of decision.reasons) {
    if (reason === 'snapshot_stale') section.append(caution(W.STALE_NOTICE));
    else if (reason === 'job_absent') section.append(caution(`${W.JOB_MISSING_LEAD} ${SNAPSHOT_JOB}. ${W.SCHEDULER_ACTION}`));
    else if (reason === 'job_inactive') section.append(caution(`${W.JOB_INACTIVE_LEAD} ${SNAPSHOT_JOB}. ${W.SCHEDULER_ACTION}`));
  }
  for (const j of s.jobs) {
    // The snapshot job's switched-off line is the decision's job_inactive, above.
    if (!j.active && j.name !== SNAPSHOT_JOB) section.append(caution(`${W.JOB_INACTIVE_LEAD} ${j.name}. ${W.SCHEDULER_ACTION}`));
    if (j.lastStatus !== null && j.lastStatus !== 'succeeded') section.append(caution(`${W.JOB_FAILED_LEAD} ${j.name}. ${W.SCHEDULER_ACTION}`));
  }

  const elapsed = elapsedSince(mark);
  const ageLine = (label: string, iso: string): HTMLParagraphElement => {
    const age = snapshotAge(iso, s.serverNow, elapsed);
    return el('p', `${label}: ${age.known ? ageWords(age.ageMinutes) : W.AGE_NOT_KNOWN}`, 'system-age');
  };
  // A generated_at in the future has no age worth showing: the decision reports it as null.
  if (s.generatedAt === null) section.append(el('p', W.SNAPSHOT_NONE, 'system-age'));
  else if (decision.body.snapshot_age_s === null) section.append(el('p', `${W.SNAPSHOT_LABEL}: ${W.AGE_NOT_KNOWN}`, 'system-age'));
  else section.append(ageLine(W.SNAPSHOT_LABEL, s.generatedAt));
  // THE HEARTBEAT IS ITS OWN LINE (R-2026-09-30-176 EZ-2): read from its own timestamp, "age not
  // known" when there is none, and "age not known" for one more than the decision's tolerance
  // AHEAD of the database's clock, as a generated_at in the future is. The constant is the
  // decision's, exported from the snapshot package, never a second 5_000.
  const beat = s.lastSnapshotAt;
  if (beat === null) section.append(el('p', `${W.HEARTBEAT_LABEL}: ${W.AGE_NOT_KNOWN}`, 'system-age'));
  else if (Date.parse(beat) - Date.parse(s.serverNow) > FUTURE_TOLERANCE_MS) section.append(el('p', `${W.HEARTBEAT_LABEL}: ${W.AGE_NOT_KNOWN}`, 'system-age'));
  else section.append(ageLine(W.HEARTBEAT_LABEL, beat));

  const jobs = el('ul', undefined, 'system-jobs');
  for (const j of s.jobs) {
    const run = j.lastStatus === null || j.lastStartTime === null ? W.JOB_NO_RUN : `${W.JOB_LAST_RUN} ${j.lastStatus}, ${lagosTime(j.lastStartTime)}`;
    jobs.append(el('li', `${j.name}: ${j.active ? W.JOB_RUNNING : W.JOB_SWITCHED_OFF} — ${run}`));
  }
  section.append(jobs);
  return section;
}

function renderRegister(holder: SessionHolder, reg: Register, mark: FetchMark, system: HTMLElement, notice?: string): void {
  const root = appRoot();
  if (root === null) return;
  const reload = el('button', W.RELOAD);
  reload.type = 'button';
  reload.addEventListener('click', () => guarded(loadRegister(holder)));
  const create = el('button', 'New facility');
  create.type = 'button';
  create.addEventListener('click', () => openCreate(holder));
  // The one message this screen is given is a facility created (openCreate).
  const status = statusLine(notice ?? '', 'info');
  const list = el('ul', undefined, 'register');

  // In the order the server returned (021: ORDER BY name, id). Never re-sorted, never
  // filtered: a stale facility is where it would be if it were fresh.
  for (const f of reg.facilities) {
    const card = el('li', undefined, 'facility');
    if (f.kind === 'unreadable') {
      card.append(el('p', "This facility's record could not be read. Reload the page.", 'notice notice-caution'));
      list.append(card);
      continue;
    }
    card.dataset['facilityId'] = f.facilityId;
    // FIVE CELLS, IN THE ORDER THE CARD HAS ALWAYS READ (D3): a card on a narrow screen,
    // a row of a table at 960 px and wider (style.css). The same elements and words; the
    // cells only group them for the table's columns.
    const who = el('div', undefined, 'cell cell-facility');
    who.append(el('h2', f.name), el('p', `${f.lga}, ${f.state}`));
    const standing = el('div', undefined, 'cell cell-listed');
    standing.append(el('p', f.listedAt === null ? W.NOT_LISTED : W.LISTED, 'listed'));
    if (!f.isActive) standing.append(el('p', W.SWITCHED_OFF, 'warning notice notice-caution'));
    if (f.listedAt !== null && !f.hasContact) standing.append(el('p', W.NO_CONTACT_WARNING, 'warning notice notice-caution'));
    if (f.agreementState === 'withdrawn') standing.append(el('p', W.WITHDRAWN_WARNING, 'warning notice notice-caution'));
    const needs = el('div', undefined, 'cell cell-checklist');
    needs.append(checklist(f));
    const wardsCell = el('div', undefined, 'cell cell-wards');
    const bands = f.categories.map((w) => wardBand(w, reg, mark)).filter((b): b is FreshnessBand => b !== null);
    if (bands.length > 0) {
      const worst = bands.reduce((a, b) => (BAND_ORDER.indexOf(b) > BAND_ORDER.indexOf(a) ? b : a));
      wardsCell.append(el('p', `Worst ward: ${BAND_WORD[worst]}`, 'worst'));
    }
    wardsCell.append(el('p', MODEL_WORD[f.reportingModel], 'reporting-model'));
    const wards = el('ul', undefined, 'wards');
    for (const w of f.categories) wards.append(wardLine(w, f.reportingModel, reg, mark));
    wardsCell.append(wards);
    const open = el('button', 'Open');
    open.type = 'button';
    open.addEventListener('click', () => guarded(openFacility(holder, f.facilityId)));
    const action = el('div', undefined, 'cell cell-open');
    action.append(open);
    card.append(who, standing, needs, wardsCell, action);
    list.append(card);
  }

  const actions = el('div', undefined, 'actions');
  actions.append(reload, create);
  // THE RETENTION ALERT (DT Bundle 3; resolves -137 DM-2 e's surfacing): at the top, one
  // caution Notice per job whose latest finished run did not succeed. Fed by that field
  // only; an empty list shows nothing.
  const alerts = reg.retentionAlert.map((a) =>
    el('p', `${W.RETENTION_ALERT_LEAD} ${a.job}, ${lagosTime(a.endTime)}. ${W.RETENTION_ALERT_ACTION}`, 'notice notice-caution retention-alert'),
  );
  root.replaceChildren(el('h1', W.REGISTER_HEADING), ...alerts, actions, status, system);
  if (reg.facilities.length === 0) root.append(el('p', W.REGISTER_EMPTY, 'lead'));
  root.append(list);
}

/**
 * Reads the register and the system status TOGETHER, on one clock, and renders both. Each
 * fails on its own: a status that could not be read is a line inside its section, and a
 * register that could not be read leaves the section under its sentence. Reload reloads both.
 * Returns the register, or null when it could not be shown.
 */
async function loadRegister(holder: SessionHolder, notice?: string): Promise<Register | null> {
  const mark = markFetch();
  const [r, load] = await Promise.all([read(holder, 'register', registerBody()), loadStatus(holder)]);
  const system = statusSection(load, mark);
  if (r.kind === 'unreachable') {
    show(W.REGISTER_HEADING, ADMIN_FIXED.UNREACHABLE);
    // The register's own Reload (DP-5 b 1), so the sentence's "reload" has a control.
    const again = el('button', W.RELOAD);
    again.type = 'button';
    again.addEventListener('click', () => guarded(loadRegister(holder, notice)));
    appRoot()?.append(again, system);
    return null;
  }
  if (r.kind === 'refused') {
    if (!stopFor(r.refusal)) {
      show(W.REGISTER_HEADING, r.refusal.sentence);
      appRoot()?.append(system);
    }
    return null;
  }
  const reg = parseRegister(r.data);
  if (reg === null) {
    show(W.REGISTER_HEADING, ADMIN_FIXED.UNRECOGNISED);
    appRoot()?.append(system);
    return null;
  }
  renderRegister(holder, reg, mark, system, notice);
  return reg;
}

// ------------------------------------------------------------------ forms

function field(label: string, name: string, value = '', type = 'text'): { wrap: HTMLLabelElement; input: HTMLInputElement } {
  const wrap = el('label', `${label} `, type === 'checkbox' ? 'check' : 'field');
  const input = el('input');
  input.name = name;
  input.type = type;
  input.value = value;
  // Nothing an operator types here is the operator's own detail, so the browser offers
  // none (DP-5 b 6). The sign-in address sets its own token, email, after this.
  input.autocomplete = 'off';
  wrap.append(input);
  return { wrap, input };
}

/** A phone input with its E.164 preview, shown BEFORE submit. */
function phoneField(label: string, name: string, value = ''): { wrap: HTMLLabelElement; input: HTMLInputElement; value: () => string | null } {
  const f = field(label, name, value, 'tel');
  const preview = el('span', '', 'preview');
  const update = (): void => {
    const n = f.input.value.trim() === '' ? null : normaliseNgPhone(f.input.value);
    preview.textContent = f.input.value.trim() === '' ? '' : `${W.PHONE_PREVIEW} ${n ?? '(not a number this page can read)'}`;
  };
  f.input.addEventListener('input', update);
  update();
  f.wrap.append(preview);
  return { ...f, value: () => (f.input.value.trim() === '' ? null : normaliseNgPhone(f.input.value)) };
}

function select(label: string, name: string, options: readonly (readonly [string, string])[]): { wrap: HTMLLabelElement; input: HTMLSelectElement } {
  const wrap = el('label', `${label} `, 'field');
  const input = el('select', undefined, 'select');
  input.name = name;
  // The attribute, not the property: a <select>'s autocomplete is not reflected everywhere
  // (jsdom leaves the property unreflected), and the attribute is what the browser reads.
  input.setAttribute('autocomplete', 'off');
  // No default: an empty first choice the operator must replace.
  const none = el('option', 'Choose');
  none.value = '';
  input.append(none);
  for (const [value, text] of options) {
    const o = el('option', text);
    o.value = value;
    input.append(o);
  }
  wrap.append(input);
  return { wrap, input };
}

/**
 * A form whose submit button is disabled while its request is in flight. IT DOES ITS OWN
 * VALIDATION (R-2026-09-27-139 DO-4 c, DO-5 a): with the browser's, a malformed email or
 * date showed the browser's own bubble, in the browser's words. Every check the browser
 * made is made by the form itself (see refuse), so nothing it caught is now let through.
 */
function form(name: string, submitText: string, parts: HTMLElement[], onSubmit: (status: HTMLParagraphElement) => Promise<void>): HTMLFormElement {
  const f = el('form', undefined, `${name} operator-form`);
  f.noValidate = true;
  const button = el('button', submitText, 'primary');
  button.type = 'submit';
  const status = statusLine();
  f.addEventListener('submit', (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    say(status, '', 'info');
    void onSubmit(status)
      .catch((e: unknown) => {
        if (e instanceof SessionExpiredError) signedOut(W.SIGNED_OUT);
        else if (e instanceof RenewalUnavailableError) say(status, W.RENEWAL_UNAVAILABLE, 'caution');
        else {
          console.error('OpenBed admin: a form failed');
          say(status, ADMIN_FIXED.UNRECOGNISED, 'caution');
        }
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  f.append(...parts, button, status);
  return f;
}

/** A value this page cannot send: its own sentence, as a caution Notice, and focus on the field to fix. */
function refuse(status: HTMLParagraphElement, sentence: string, input: HTMLInputElement | HTMLSelectElement): void {
  say(status, sentence, 'caution');
  input.focus();
}

/** The check the browser made on an email field, made here in this page's own words (DO-4 c). */
const EMAIL_UNREADABLE = 'That email address is not in a form this page can read. Check it for a missing @ or a space.';

function facilityFieldsFrom(parts: {
  name: HTMLInputElement;
  lga: HTMLInputElement;
  state: HTMLInputElement;
  lat: HTMLInputElement;
  lng: HTMLInputElement;
  phone: () => string | null;
  phoneInput: HTMLInputElement;
}): FacilityFields | { readonly sentence: string; readonly input: HTMLInputElement } {
  const lat = Number(parts.lat.value.trim());
  const lng = Number(parts.lng.value.trim());
  if (parts.lat.value.trim() === '' || !Number.isFinite(lat)) return { sentence: 'Enter the latitude as a number, such as 6.5244.', input: parts.lat };
  if (parts.lng.value.trim() === '' || !Number.isFinite(lng)) return { sentence: 'Enter the longitude as a number, such as 3.3792.', input: parts.lng };
  const phone = parts.phone();
  if (phone === null) return { sentence: 'The public phone is not in international form (+234...). Check the preview.', input: parts.phoneInput };
  // Sent exactly as typed, apostrophes, hyphens and diacritics included.
  return { name: parts.name.value, lga: parts.lga.value, state: parts.state.value, lat, lng, publicPhoneE164: phone };
}

function facilityInputs(values?: { name: string; lga: string; state: string; lat: number; lng: number; publicPhoneE164: string }) {
  const name = field('Facility name', 'name', values?.name ?? '');
  const lga = field('LGA', 'lga', values?.lga ?? '');
  const state = field('State', 'state', values?.state ?? '');
  const lat = field('Latitude', 'lat', values === undefined ? '' : String(values.lat));
  lat.input.inputMode = 'decimal';
  const lng = field('Longitude', 'lng', values === undefined ? '' : String(values.lng));
  lng.input.inputMode = 'decimal';
  const phone = phoneField('Public phone', 'phone', values?.publicPhoneE164 ?? '');
  return { name, lga, state, lat, lng, phone };
}

/** Each field that differs from what is saved, as `<Label>: <saved> → <new>`. */
function changesFrom(saved: Facility, typed: { name: string; lga: string; state: string; lat: string; lng: string; phone: string | null }): string[] {
  const out: string[] = [];
  const line = (label: string, a: string, b: string): void => {
    if (a !== b) out.push(`${label}: ${a} → ${b}`);
  };
  line('Name', saved.name, typed.name);
  line('LGA', saved.lga, typed.lga);
  line('State', saved.state, typed.state);
  line('Latitude', String(saved.lat), typed.lat.trim());
  line('Longitude', String(saved.lng), typed.lng.trim());
  line('Public phone', saved.publicPhoneE164, typed.phone ?? '(not a number this page can read)');
  return out;
}

/** The create form. Its id is made HERE, once, and every submit from it sends the same one (J2). */
function openCreate(holder: SessionHolder): void {
  const root = appRoot();
  if (root === null) return;
  const id = crypto.randomUUID();
  const i = facilityInputs();
  const back = el('button', 'Back');
  back.type = 'button';
  back.addEventListener('click', () => guarded(loadRegister(holder)));
  const f = form('create-facility', 'Create', [i.name.wrap, i.lga.wrap, i.state.wrap, i.lat.wrap, i.lng.wrap, i.phone.wrap], async (status) => {
    const fields = facilityFieldsFrom({ name: i.name.input, lga: i.lga.input, state: i.state.input, lat: i.lat.input, lng: i.lng.input, phone: i.phone.value, phoneInput: i.phone.input });
    if ('sentence' in fields) {
      refuse(status, fields.sentence, fields.input);
      return;
    }
    const r = await write(holder, 'createFacility', createFacilityBody(id, fields));
    if (r.kind === 'unreachable') {
      // The facility may or may not exist now. Pressing Create again sends the SAME id,
      // so the second answer says which -- a created=false is shown as created.
      say(status, `${ADMIN_FIXED.UNREACHABLE} Press Create again: it will not make a second facility.`, 'caution');
      return;
    }
    if (r.kind === 'refused') {
      if (!stopFor(r.refusal)) say(status, r.refusal.sentence, 'caution');
      return;
    }
    await loadRegister(holder, ADMIN_FIXED.CREATED);
  });
  root.replaceChildren(el('h1', 'New facility'), back, f);
}

// ------------------------------------------------------------------ detail

/** What one facility's view is drawn from: one register read and one contact read. */
interface Detail {
  readonly reg: Register;
  readonly mark: FetchMark;
  readonly f: Facility;
  readonly view: ContactView | null;
  /** The sentence shown in place of the contact when it could not be read; null when it was. */
  readonly contactProblem: string | null;
}

/**
 * Reads one facility and its contact. The contact lives in the view built from this, and
 * in the DOM that view builds; going back replaces the whole view, so it is gone. Null
 * when a screen saying why has been shown instead.
 */
async function readDetail(holder: SessionHolder, facilityId: string): Promise<Detail | null> {
  const reg = await read(holder, 'register', registerBody());
  const mark = markFetch();
  if (reg.kind !== 'ok') {
    if (reg.kind === 'refused' && stopFor(reg.refusal)) return null;
    show(W.REGISTER_HEADING, reg.kind === 'refused' ? reg.refusal.sentence : ADMIN_FIXED.UNREACHABLE);
    return null;
  }
  const parsed = parseRegister(reg.data);
  const f = parsed?.facilities.find((x): x is Facility => x.kind === 'facility' && x.facilityId === facilityId);
  if (parsed === null || f === undefined) {
    show(W.REGISTER_HEADING, ADMIN_FIXED.UNRECOGNISED);
    return null;
  }
  const c = await read(holder, 'getContact', getContactBody(facilityId));
  if (c.kind === 'refused' && stopFor(c.refusal)) return null;
  const view: ContactView | null = c.kind === 'ok' ? parseContact(c.data) : null;
  // A READ that failed says so, never UNRECOGNISED's "Nothing was changed", which is a
  // write's sentence (DP-5 b 4).
  const contactProblem =
    c.kind === 'ok'
      ? view === null
        ? W.CONTACT_UNREADABLE
        : null
      : c.kind === 'refused'
        ? c.refusal.key === 'UNRECOGNISED'
          ? W.CONTACT_UNREADABLE
          : c.refusal.sentence
        : ADMIN_FIXED.UNREACHABLE;
  return { reg: parsed, mark, f, view, contactProblem };
}

async function openFacility(holder: SessionHolder, facilityId: string): Promise<void> {
  const d = await readDetail(holder, facilityId);
  if (d !== null) renderDetail(holder, d);
}

/** How a write's answer left the view: it went through, the view was re-read and says why, or its form says why. */
type After = 'ok' | 'reloaded' | 'refused';

/** A section that is rebuilt only when what it offers changes, never when only its data does. */
function modal(className: string, heading: string, modeOf: () => string, build: () => HTMLElement[]): { node: HTMLElement; patch: () => void } {
  const node = el('section', undefined, className);
  let mode = modeOf();
  node.append(el('h2', heading), ...build());
  return {
    node,
    patch: () => {
      const next = modeOf();
      if (next === mode) return;
      mode = next;
      node.replaceChildren(el('h2', heading), ...build());
    },
  };
}

/**
 * One facility, built ONCE (DO-4 d). A write re-reads the facility with refresh(), which
 * runs every section's patch: the lines that show saved state are rewritten, and a form
 * is never rebuilt while another write's unsent input or Notice sits in it.
 */
function renderDetail(holder: SessionHolder, first: Detail): void {
  const root = appRoot();
  if (root === null) return;
  let d = first;
  const heading = el('h1', d.f.name);
  const back = el('button', 'Back');
  back.type = 'button';
  back.addEventListener('click', () => guarded(loadRegister(holder)));
  const status = statusLine();
  const patches: (() => void)[] = [];

  /** Re-reads the facility and patches what changed; the outcome goes to the page's status line. */
  const refresh = async (message: string, tone: Tone): Promise<void> => {
    const next = await readDetail(holder, d.f.facilityId);
    if (next === null) return;
    d = next;
    heading.textContent = d.f.name;
    for (const patch of patches) patch();
    say(status, message, tone);
  };

  /** What a refused or unanswered write does, the same for every form. */
  const after = async (r: CallResult, formStatus: HTMLParagraphElement, onDropped: string | null): Promise<After> => {
    if (r.kind === 'ok') return 'ok';
    if (r.kind === 'unreachable') {
      if (onDropped === null) {
        say(formStatus, ADMIN_FIXED.UNREACHABLE, 'caution');
        return 'refused';
      }
      await refresh(onDropped, 'caution');
      return 'reloaded';
    }
    if (stopFor(r.refusal)) return 'refused';
    if (r.refusal.key === 'VERSION_CONFLICT') {
      await refresh(r.refusal.sentence, 'caution');
      return 'reloaded';
    }
    say(formStatus, r.refusal.sentence, 'caution');
    return 'refused';
  };

  // The facility: its saved state, patched in place, and its edit form.
  const facility = el('section', undefined, 'facility-detail');
  const name = el('h2', d.f.name);
  const place = el('p', `${d.f.lga}, ${d.f.state}`);
  // "Listed 27 Sept, 12:49 (Lagos time)", no brackets around a bracket (DP-5 b 5).
  const listedLine = (): string => (d.f.listedAt === null ? W.NOT_LISTED : `${W.LISTED} ${lagosTime(d.f.listedAt)}`);
  const listed = el('p', listedLine());
  let list = checklist(d.f);
  facility.append(name, place, listed, list);
  patches.push(() => {
    name.textContent = d.f.name;
    place.textContent = `${d.f.lga}, ${d.f.state}`;
    listed.textContent = listedLine();
    const fresh = checklist(d.f);
    list.replaceWith(fresh);
    list = fresh;
  });

  // THE EDIT FORM'S BASE is the saved row its fields were filled from, and its Save sends
  // THAT row's version (023, BZ-3 a; 020 J1). It moves to a newer row only when the form
  // holds nothing unsent, or after the form's own Save or a conflict.
  let base = d.f;
  const e = facilityInputs({ name: base.name, lga: base.lga, state: base.state, lat: base.lat, lng: base.lng, publicPhoneE164: base.publicPhoneE164 });
  const typed = () => ({ name: e.name.input.value, lga: e.lga.input.value, state: e.state.input.value, lat: e.lat.input.value, lng: e.lng.input.value, phone: e.phone.value() });
  const changes = el('ul', undefined, 'changes');
  const showChanges = (): void => {
    changes.replaceChildren(...changesFrom(base, typed()).map((l) => el('li', l)));
  };
  for (const input of [e.name.input, e.lga.input, e.state.input, e.lat.input, e.lng.input, e.phone.input]) input.addEventListener('input', showChanges);
  const confirmPanel = el('div', undefined, 'phone-confirm');
  confirmPanel.hidden = true;
  const closeConfirm = (): void => {
    confirmPanel.hidden = true;
    confirmPanel.replaceChildren();
  };
  const rebase = (): void => {
    base = d.f;
    e.name.input.value = base.name;
    e.lga.input.value = base.lga;
    e.state.input.value = base.state;
    e.lat.input.value = String(base.lat);
    e.lng.input.value = String(base.lng);
    e.phone.input.value = base.publicPhoneE164;
    e.phone.input.dispatchEvent(new Event('input'));
    closeConfirm();
    showChanges();
  };
  patches.push(() => {
    if (changesFrom(base, typed()).length === 0 && confirmPanel.hidden) rebase();
  });

  /** The edit, sent ONCE. A dropped answer reloads and says so; it is never re-sent (BY-2 e). */
  const send = async (fields: FacilityFields, s: HTMLParagraphElement): Promise<void> => {
    const r = await write(holder, 'editFacility', editFacilityBody(base.facilityId, base.version, fields));
    const outcome = await after(r, s, ADMIN_FIXED.EDIT_DROPPED);
    if (outcome === 'ok') await refresh('Saved.', 'info');
    if (outcome === 'refused') closeConfirm();
    else rebase();
  };

  const editForm = form('edit-facility', 'Save facility', [e.name.wrap, e.lga.wrap, e.state.wrap, e.lat.wrap, e.lng.wrap, e.phone.wrap, el('p', W.CHANGES, 'note'), changes], async (s) => {
    const fields = facilityFieldsFrom({ name: e.name.input, lga: e.lga.input, state: e.state.input, lat: e.lat.input, lng: e.lng.input, phone: e.phone.value, phoneInput: e.phone.input });
    if ('sentence' in fields) {
      refuse(s, fields.sentence, fields.input);
      return;
    }
    if (fields.publicPhoneE164 === base.publicPhoneE164) {
      await send(fields, s);
      return;
    }
    // A PHONE CHANGE IS NEVER SENT ON THE SAVE PRESS (BZ-3 b): the emergency number the
    // public page shows. It waits for an explicit confirm; Cancel sends nothing.
    const confirm = el('button', W.CONFIRM_PHONE, 'primary');
    confirm.type = 'button';
    const cancel = el('button', W.CANCEL);
    cancel.type = 'button';
    confirmPanel.replaceChildren(el('p', `Public phone: ${base.publicPhoneE164} → ${fields.publicPhoneE164}`), el('p', W.PHONE_CHANGE_CONFIRM), confirm, cancel);
    confirmPanel.hidden = false;
    cancel.addEventListener('click', closeConfirm);
    confirm.addEventListener('click', () => {
      confirm.disabled = true;
      cancel.disabled = true;
      guarded(send(fields, s));
    });
  });
  facility.append(editForm, confirmPanel);

  // The wards, and the add-category form.
  const wards = el('section', undefined, 'wards-detail');
  const model = el('p', MODEL_WORD[d.f.reportingModel], 'reporting-model');
  const wl = el('ul', undefined, 'wards');
  const drawWards = (): void => {
    model.textContent = MODEL_WORD[d.f.reportingModel];
    wl.replaceChildren(...d.f.categories.map((w) => wardLine(w, d.f.reportingModel, d.reg, d.mark)));
  };
  drawWards();
  patches.push(drawWards);
  const cat = select('Ward category', 'category', WARD_CATEGORIES.map((k) => [k, categoryLabel(k)] as const));
  const off = select('Offering', 'offering', [['OFFERED', 'Offered'], ['NOT_OFFERED', 'Not offered']]);
  wards.append(
    el('h2', 'Wards'),
    model,
    wl,
    form('add-category', 'Add ward category', [cat.wrap, off.wrap], async (s) => {
      if (cat.input.value === '' || off.input.value === '') {
        refuse(s, 'Choose a ward category and whether it is offered.', cat.input.value === '' ? cat.input : off.input);
        return;
      }
      const r = await write(holder, 'addCategory', addCategoryBody(d.f.facilityId, cat.input.value, off.input.value as 'OFFERED' | 'NOT_OFFERED'));
      if ((await after(r, s, null)) !== 'ok') return;
      cat.input.value = '';
      off.input.value = '';
      await refresh('Ward category added.', 'info');
    }),
  );

  // The contact: fetched when this view opened, held only here. Its form is rebuilt only
  // when the contact becomes readable or stops being so; contactPatch is the live form's.
  let contactPatch: () => void = () => undefined;
  const contact = modal('contact-detail', 'Contact', () => (d.contactProblem === null ? 'form' : `problem:${d.contactProblem}`), () => {
    if (d.contactProblem !== null) return [el('p', d.contactProblem, 'notice notice-caution')];
    let saved = d.view?.contact ?? null;
    const summary = (): string => (saved === null ? W.NO_CONTACT_WARNING : `${saved.fullName}, ${saved.jobTitle}`);
    const line = el('p', summary(), saved === null ? 'notice notice-caution' : undefined);
    const fullName = field('Full name', 'full_name', saved?.fullName ?? '');
    const title = field('Job title', 'job_title', saved?.jobTitle ?? '');
    const email = field('Email', 'email', saved?.email ?? '', 'email');
    const mobile = phoneField('Mobile', 'mobile', saved?.mobileE164 ?? '');
    const sms = field('SMS opt-in', 'sms_opt_in', '', 'checkbox');
    sms.input.checked = saved?.smsOptIn ?? false;
    sms.wrap.append(el('span', W.SMS_OPT_IN_NOTE, 'note'));
    // Unsent input keeps the contact the form was filled from, and its version (BN-2).
    let dirty = false;
    for (const input of [fullName.input, title.input, email.input, mobile.input, sms.input]) input.addEventListener('input', () => (dirty = true));
    sms.input.addEventListener('change', () => (dirty = true));
    const rebase = (): void => {
      saved = d.view?.contact ?? null;
      line.textContent = summary();
      line.className = saved === null ? 'notice notice-caution' : '';
      fullName.input.value = saved?.fullName ?? '';
      title.input.value = saved?.jobTitle ?? '';
      email.input.value = saved?.email ?? '';
      mobile.input.value = saved?.mobileE164 ?? '';
      mobile.input.dispatchEvent(new Event('input'));
      sms.input.checked = saved?.smsOptIn ?? false;
      dirty = false;
    };
    contactPatch = () => {
      if (!dirty) rebase();
    };
    const recordForm = form('record-contact', 'Save contact', [fullName.wrap, title.wrap, email.wrap, mobile.wrap, sms.wrap], async (s) => {
      if (email.input.value.trim() !== '' && email.input.validity.typeMismatch) {
        refuse(s, EMAIL_UNREADABLE, email.input);
        return;
      }
      const typedMobile = mobile.input.value.trim();
      const mobileE164 = typedMobile === '' ? null : mobile.value();
      if (typedMobile !== '' && mobileE164 === null) {
        refuse(s, 'That mobile number is not in international form (+234...). Check the preview.', mobile.input);
        return;
      }
      const body = recordContactBody(
        d.f.facilityId,
        { fullName: fullName.input.value, jobTitle: title.input.value, email: email.input.value.trim() === '' ? null : email.input.value, mobileE164, smsOptIn: sms.input.checked },
        saved?.version ?? null,
      );
      const r = await write(holder, 'recordContact', body);
      const outcome = await after(r, s, null);
      if (outcome === 'ok') await refresh('Contact saved.', 'info');
      if (outcome !== 'refused') rebase();
    });
    return [line, recordForm];
  });
  patches.push(() => {
    contact.patch();
    contactPatch();
  });

  // The agreement: recorded once, never edited or withdrawn here (BD-2 2, BN-4).
  const agreementLine = (): string | null => {
    const a = d.view?.agreement ?? null;
    return a === null ? null : `Version ${a.version}, accepted ${a.acceptedOn}${a.signatoryRole === null ? '' : ` by the ${a.signatoryRole}`}${a.withdrawnOn === null ? '' : `; withdrawn ${a.withdrawnOn}`}`;
  };
  const agreement = modal('agreement-detail', 'Agreement', () => agreementLine() ?? (d.contactProblem === null ? 'form' : 'none'), () => {
    const line = agreementLine();
    if (line !== null) return [el('p', line)];
    // Not a bare heading (DP-5 b 3): say why there is no form, and what to do.
    if (d.contactProblem !== null) return [el('p', W.AGREEMENT_NEEDS_CONTACT, 'notice notice-caution')];
    const on = field('Accepted on', 'accepted_on', '', 'date');
    const version = field('Agreement version', 'version');
    const role = field("Signatory's role", 'signatory_role');
    return [
      form('record-agreement', 'Record agreement', [on.wrap, version.wrap, role.wrap], async (s) => {
        // A date the field itself cannot read is refused here, in the server's own words
        // for a missing date, rather than sent as blank.
        if (on.input.validity.badInput) {
          refuse(s, ADMIN_CODES['INVALID_ARGUMENT:p_accepted_on'] ?? ADMIN_FIXED.UNRECOGNISED, on.input);
          return;
        }
        const r = await write(holder, 'recordAgreement', recordAgreementBody(d.f.facilityId, on.input.value, version.input.value, role.input.value.trim() === '' ? null : role.input.value));
        if ((await after(r, s, null)) === 'ok') await refresh('Agreement recorded.', 'info');
      }),
    ];
  });
  patches.push(agreement.patch);

  // THE REGISTRATION (DT Bundle 3, k): the HEFAMAA number, optional, operator-only. Its form
  // keeps the saved row it was filled from while it holds unsent input, and sends THAT
  // row's version (DO-4 d); an untouched form follows every re-read. Empty clears it.
  const registration = el('section', undefined, 'registration-detail');
  const hefamaa = field(W.HEFAMAA_LABEL, 'hefamaa_reg_no', d.f.hefamaaRegNo ?? '');
  let regBase = d.f;
  let regDirty = false;
  hefamaa.input.addEventListener('input', () => (regDirty = true));
  const regRebase = (): void => {
    regBase = d.f;
    hefamaa.input.value = regBase.hefamaaRegNo ?? '';
    regDirty = false;
  };
  patches.push(() => {
    if (!regDirty) regRebase();
  });
  registration.append(
    el('h2', W.REGISTRATION_HEADING),
    form('record-registration', W.SAVE_REGISTRATION, [hefamaa.wrap], async (s) => {
      const typed = hefamaa.input.value;
      const value = typed === '' ? null : typed;
      // The column's own rule (026's facility_hefamaa_reg_no_form): 1 to 64 characters, no
      // space at either end. Counted in characters, as char_length counts them.
      if (value !== null && ([...value].length > 64 || !/^\S(?:[\s\S]*\S)?$/.test(value))) {
        refuse(s, ADMIN_CODES['INVALID_ARGUMENT:p_hefamaa_reg_no'] ?? ADMIN_FIXED.UNRECOGNISED, hefamaa.input);
        return;
      }
      const r = await write(holder, 'recordRegistration', recordRegistrationBody(regBase.facilityId, regBase.version, value));
      const outcome = await after(r, s, null);
      if (outcome === 'ok') await refresh(W.REGISTRATION_SAVED, 'info');
      if (outcome !== 'refused') regRebase();
    }),
  );

  // Listing: in the app. Unlisting and withdrawal are founder steps, never here (BC-6).
  // The List press sends the facility's LATEST version: the form holds nothing typed, and
  // the checklist beside it is the row that version stands for.
  const listing = modal('listing', 'Listing', () => (d.f.listedAt !== null ? `listed:${d.f.listedAt}` : canList(d.f) ? 'can' : 'cannot'), () => {
    if (d.f.listedAt !== null) return [el('p', `${W.LISTED} since ${lagosTime(d.f.listedAt)}.`)];
    if (!canList(d.f)) return [el('p', W.CANNOT_LIST_UNTIL)];
    return [
      form('list-facility', 'List this facility', [], async (s) => {
        const r = await write(holder, 'setListed', setListedBody(d.f.facilityId, d.f.version));
        if ((await after(r, s, null)) === 'ok') await refresh('Listed.', 'info');
      }),
    ];
  });
  patches.push(listing.patch);

  root.replaceChildren(heading, back, status, facility, registration, wards, contact.node, agreement.node, listing.node);
}

// ------------------------------------------------------------------ sign-in

/** The `never` end of an exhaustive switch: a new outcome that reaches here is a compile error first, a thrown error second. */
function unhandledOutcome(outcome: never): never {
  throw new Error(`an unhandled sign-in outcome: ${JSON.stringify(outcome)}`);
}

function requestForm(): HTMLFormElement {
  const email = field(W.REQUEST_LABEL, 'email', '', 'email');
  email.input.required = true;
  email.input.autocomplete = 'email';
  // THE SIGN-IN FORM KEEPS THE BROWSER'S VALIDATION (R-2026-09-27-139 DO-5; -134 DJ), as
  // the ward console's does: this page has no sentence for a malformed address. It is the
  // one form here without noValidate.
  const f = el('form', undefined, 'signin-request');
  const button = el('button', W.REQUEST_BUTTON, 'primary');
  button.type = 'submit';
  const status = statusLine();
  f.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      button.disabled = true;
      say(status, '', 'info');
      try {
        const outcome = await requestSignInLink({ apiUrl: API_URL, anonKey: PUBLISHABLE_KEY, email: email.input.value, redirectTo: `${window.location.origin}/` });
        // The status to the log; one sentence on the page, whatever it was, because
        // each status would say whether the address exists -- except the Worker's OWN limit
        // (`limited`, FF-3), which says nothing about the address. EXHAUSTIVE: a fourth outcome
        // fails to compile here, where the bare `else` this replaced would have shown it the
        // "no answer" sentence.
        switch (outcome.kind) {
          case 'answered':
            if (outcome.status !== 200) console.error('OpenBed admin: the sign-in request was answered', outcome.status);
            say(status, W.REQUEST_ANSWERED, 'info');
            break;
          case 'limited':
            say(status, W.REQUEST_LIMITED, 'caution');
            break;
          case 'unreachable':
            console.error('OpenBed admin: the sign-in request got no answer');
            say(status, W.REQUEST_UNREACHABLE, 'caution');
            break;
          default:
            return unhandledOutcome(outcome);
        }
      } finally {
        button.disabled = false;
      }
    })();
  });
  f.append(email.wrap, button, status);
  return f;
}

/**
 * The privacy notice's link, under the sign-in form (R-2026-09-26-136 DL-1 d). Its URL is
 * the one tracked constant; tests/compliance/privacy_links.test.ts asserts it on every
 * sign-in screen. D3 restyled it (body-sm, muted, a 44 px target) and kept it.
 */
function privacyLink(): HTMLParagraphElement {
  const p = el('p', undefined, 'privacy');
  const a = el('a', W.PRIVACY_LINK);
  a.href = PRIVACY_NOTICE_URL;
  p.append(a);
  return p;
}

/** The signed-out landing a fresh page shows: the instruction, the request form, the notice link. */
function landing(): void {
  show(W.TITLE, W.ACCESS_ORDER, 'lead');
  appRoot()?.append(requestForm(), privacyLink());
}

function signedOut(detail: string = W.ACCESS_ORDER): void {
  show(W.SIGNED_OUT, detail);
  appRoot()?.append(el('p', W.ACCESS_ORDER, 'lead'), requestForm(), privacyLink());
}

/** Exported so a test can call it and read the DOM, as the ward console's is. */
export async function render(): Promise<void> {
  let session;
  try {
    session = sessionFromUrlFragment(window.location.hash);
  } catch {
    console.error('OpenBed admin: the sign-in link was refused');
    show(W.BAD_LINK_HEADING, W.BAD_LINK);
    appRoot()?.append(requestForm(), privacyLink());
    return;
  }
  if (session === null) {
    landing();
    return;
  }
  // The tokens leave the address bar at once.
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  const holder = new SessionHolder({ apiUrl: API_URL, anonKey: PUBLISHABLE_KEY, session });
  try {
    await loadRegister(holder);
  } catch (e) {
    if (e instanceof SessionExpiredError) {
      signedOut(W.SIGNED_OUT);
      return;
    }
    if (e instanceof RenewalUnavailableError) {
      show(W.REGISTER_HEADING, W.RENEWAL_UNAVAILABLE);
      return;
    }
    console.error('OpenBed admin: the register did not load');
    show(W.REGISTER_HEADING, ADMIN_FIXED.UNRECOGNISED);
  }
}

void render();
