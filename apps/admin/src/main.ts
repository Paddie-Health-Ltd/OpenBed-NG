import { SessionExpiredError, SessionHolder, requestSignInLink, sessionFromUrlFragment } from '@openbed/auth';
import { apiOrigin } from '@openbed/origins';
import { publishableKeyFor } from '@openbed/origins/keys';
import { categoryLabel } from '@openbed/labels';
import { ADMIN_FIXED, ADMIN_SCREENS as W, WARD_CATEGORIES } from '@openbed/labels/admin';
import { elapsedSince, freshnessBand, lagosTime, markFetch, type FetchMark, type FreshnessBand } from '@openbed/snapshot';
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
  registerBody,
  setListedBody,
  type FacilityFields,
} from './bodies.js';
import { parseContact, parseRegister, type ContactView, type Facility, type Register, type Ward } from './parse.js';
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
 * WHAT THIS PAGE CANNOT SHOW, AND SAYS: no operator read returns a facility's latitude,
 * longitude or public phone (operator_register, 021:636-701, carries neither). So the
 * edit form asks for all three afresh rather than showing them. Adding them to the
 * register is SQL and outside PR C.
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

function show(heading: string, detail: string): void {
  appRoot()?.replaceChildren(el('h1', heading), el('p', detail));
}

// ------------------------------------------------------------------ calls

/**
 * THE EIGHT CALLS, EACH A LITERAL PATH (-58 A5). The Worker's allow-list is derived from
 * the code's call sites by tests/compliance/proxy_allow_list.test.ts, which reads a
 * `.authedFetch('<literal>')` and refuses a computed path as unresolved. So each call
 * names its path here, in full, rather than building `rpc/${name}` -- which would be
 * one call site the derivation cannot read, standing for eight. The method is written
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
} satisfies Record<keyof typeof RPC, Call>;

async function post(holder: SessionHolder, call: keyof typeof CALL, body: unknown): Promise<CallResult> {
  let res: Response;
  try {
    res = await CALL[call](holder, JSON.stringify(body));
  } catch (e) {
    if (e instanceof SessionExpiredError) throw e;
    // Transport only: no answer came. Logged by which call, never by request values.
    console.error('OpenBed admin: no answer from the server', RPC[call]);
    return { kind: 'unreachable' };
  }
  if (res.ok) return { kind: 'ok', data: await res.json() };
  return { kind: 'refused', refusal: adminMessageFor(res.status, res.headers, await res.text()) };
}

/** A read: one retry, after 300-600 ms, when no answer came. Never on an answer. */
async function read(holder: SessionHolder, call: 'register' | 'getContact', body: unknown): Promise<CallResult> {
  const first = await post(holder, call, body);
  if (first.kind !== 'unreachable') return first;
  await new Promise((r) => setTimeout(r, 300 + Math.random() * 300));
  return post(holder, call, body);
}

/** A write: sent once. Its caller decides what a missing answer means, per call. */
const write = post;

/** A view load started from a button: an ended session signs out, anything else says so. */
function guarded(p: Promise<unknown>): void {
  void p.catch((e: unknown) => {
    if (e instanceof SessionExpiredError) signedOut(W.SIGNED_OUT);
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

function loginWord(w: Ward): string {
  if (w.hasAccount) return W.LOGIN_ACTIVE;
  if (w.provisioningIncomplete) return W.LOGIN_INCOMPLETE;
  return W.LOGIN_NONE;
}

function wardLine(w: Ward, reg: Register, mark: FetchMark): HTMLLIElement {
  const li = el('li', undefined, 'ward');
  const band = wardBand(w, reg, mark);
  let claim: string;
  if (w.offering === 'NOT_OFFERED') claim = 'not offered';
  else if (w.monitoringState === 'PENDING' || w.updatedAt === null) claim = W.NOT_YET_REPORTING;
  else claim = `${w.bedCount === null ? 'no count' : `${String(w.bedCount)} beds`}, last reported at ${lagosTime(w.updatedAt)} (${BAND_WORD[band as FreshnessBand]})`;
  li.textContent = `${categoryLabel(w.category)}: ${claim} — ${loginWord(w)}`;
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

function renderRegister(holder: SessionHolder, reg: Register, mark: FetchMark, notice?: string): void {
  const root = appRoot();
  if (root === null) return;
  const reload = el('button', W.RELOAD);
  reload.type = 'button';
  reload.addEventListener('click', () => guarded(loadRegister(holder)));
  const create = el('button', 'New facility');
  create.type = 'button';
  create.addEventListener('click', () => openCreate(holder));
  const status = el('p', notice ?? '', 'status');
  const list = el('ul', undefined, 'register');

  // In the order the server returned (021: ORDER BY name, id). Never re-sorted, never
  // filtered: a stale facility is where it would be if it were fresh.
  for (const f of reg.facilities) {
    const card = el('li', undefined, 'facility');
    if (f.kind === 'unreadable') {
      card.append(el('p', "This facility's record could not be read. Reload the page."));
      list.append(card);
      continue;
    }
    card.dataset['facilityId'] = f.facilityId;
    card.append(el('h2', f.name), el('p', `${f.lga}, ${f.state}`), el('p', f.listedAt === null ? W.NOT_LISTED : W.LISTED, 'listed'));
    if (!f.isActive) card.append(el('p', W.SWITCHED_OFF, 'warning'));
    if (f.listedAt !== null && !f.hasContact) card.append(el('p', W.NO_CONTACT_WARNING, 'warning'));
    if (f.agreementState === 'withdrawn') card.append(el('p', W.WITHDRAWN_WARNING, 'warning'));
    card.append(checklist(f));
    const bands = f.categories.map((w) => wardBand(w, reg, mark)).filter((b): b is FreshnessBand => b !== null);
    if (bands.length > 0) {
      const worst = bands.reduce((a, b) => (BAND_ORDER.indexOf(b) > BAND_ORDER.indexOf(a) ? b : a));
      card.append(el('p', `Worst ward: ${BAND_WORD[worst]}`, 'worst'));
    }
    const wards = el('ul', undefined, 'wards');
    for (const w of f.categories) wards.append(wardLine(w, reg, mark));
    const open = el('button', 'Open');
    open.type = 'button';
    open.addEventListener('click', () => guarded(openFacility(holder, f.facilityId)));
    card.append(wards, open);
    list.append(card);
  }

  root.replaceChildren(el('h1', W.REGISTER_HEADING), reload, create, status);
  if (reg.facilities.length === 0) root.append(el('p', W.REGISTER_EMPTY));
  root.append(list);
}

/** Reads the register and renders it. Returns it, or null when it could not be shown. */
async function loadRegister(holder: SessionHolder, notice?: string): Promise<Register | null> {
  const mark = markFetch();
  const r = await read(holder, 'register', registerBody());
  if (r.kind === 'unreachable') {
    show(W.REGISTER_HEADING, ADMIN_FIXED.UNREACHABLE);
    return null;
  }
  if (r.kind === 'refused') {
    if (!stopFor(r.refusal)) show(W.REGISTER_HEADING, r.refusal.sentence);
    return null;
  }
  const reg = parseRegister(r.data);
  if (reg === null) {
    show(W.REGISTER_HEADING, ADMIN_FIXED.UNRECOGNISED);
    return null;
  }
  renderRegister(holder, reg, mark, notice);
  return reg;
}

// ------------------------------------------------------------------ forms

function field(label: string, name: string, value = '', type = 'text'): { wrap: HTMLLabelElement; input: HTMLInputElement } {
  const wrap = el('label', `${label} `);
  const input = el('input');
  input.name = name;
  input.type = type;
  input.value = value;
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
  const wrap = el('label', `${label} `);
  const input = el('select');
  input.name = name;
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

/** A form whose submit button is disabled while its request is in flight. */
function form(name: string, submitText: string, parts: HTMLElement[], onSubmit: (status: HTMLParagraphElement) => Promise<void>): HTMLFormElement {
  const f = el('form', undefined, name);
  const button = el('button', submitText);
  button.type = 'submit';
  const status = el('p', '', 'status');
  f.addEventListener('submit', (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = '';
    void onSubmit(status)
      .catch((e: unknown) => {
        if (e instanceof SessionExpiredError) signedOut(W.SIGNED_OUT);
        else {
          console.error('OpenBed admin: a form failed');
          status.textContent = ADMIN_FIXED.UNRECOGNISED;
        }
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  f.append(...parts, button, status);
  return f;
}

function facilityFieldsFrom(parts: {
  name: HTMLInputElement;
  lga: HTMLInputElement;
  state: HTMLInputElement;
  lat: HTMLInputElement;
  lng: HTMLInputElement;
  phone: () => string | null;
}): FacilityFields | string {
  const lat = Number(parts.lat.value.trim());
  const lng = Number(parts.lng.value.trim());
  if (parts.lat.value.trim() === '' || !Number.isFinite(lat)) return 'Enter the latitude as a number, such as 6.5244.';
  if (parts.lng.value.trim() === '' || !Number.isFinite(lng)) return 'Enter the longitude as a number, such as 3.3792.';
  const phone = parts.phone();
  if (phone === null) return 'The public phone is not in international form (+234...). Check the preview.';
  // Sent exactly as typed, apostrophes, hyphens and diacritics included.
  return { name: parts.name.value, lga: parts.lga.value, state: parts.state.value, lat, lng, publicPhoneE164: phone };
}

function facilityInputs(values?: { name: string; lga: string; state: string }) {
  const name = field('Facility name', 'name', values?.name ?? '');
  const lga = field('LGA', 'lga', values?.lga ?? '');
  const state = field('State', 'state', values?.state ?? '');
  const lat = field('Latitude', 'lat');
  lat.input.inputMode = 'decimal';
  const lng = field('Longitude', 'lng');
  lng.input.inputMode = 'decimal';
  const phone = phoneField('Public phone', 'phone');
  return { name, lga, state, lat, lng, phone };
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
    const fields = facilityFieldsFrom({ name: i.name.input, lga: i.lga.input, state: i.state.input, lat: i.lat.input, lng: i.lng.input, phone: i.phone.value });
    if (typeof fields === 'string') {
      status.textContent = fields;
      return;
    }
    const r = await write(holder, 'createFacility', createFacilityBody(id, fields));
    if (r.kind === 'unreachable') {
      // The facility may or may not exist now. Pressing Create again sends the SAME id,
      // so the second answer says which -- a created=false is shown as created.
      status.textContent = `${ADMIN_FIXED.UNREACHABLE} Press Create again: it will not make a second facility.`;
      return;
    }
    if (r.kind === 'refused') {
      if (!stopFor(r.refusal)) status.textContent = r.refusal.sentence;
      return;
    }
    await loadRegister(holder, ADMIN_FIXED.CREATED);
  });
  root.replaceChildren(el('h1', 'New facility'), back, f);
}

// ------------------------------------------------------------------ detail

/**
 * One facility, with its contact. The contact lives in this function's scope and in
 * the DOM this view builds; going back replaces the whole view, so it is gone.
 */
async function openFacility(holder: SessionHolder, facilityId: string, notice?: string): Promise<void> {
  const reg = await read(holder, 'register', registerBody());
  const mark = markFetch();
  if (reg.kind !== 'ok') {
    if (reg.kind === 'refused' && stopFor(reg.refusal)) return;
    show(W.REGISTER_HEADING, reg.kind === 'refused' ? reg.refusal.sentence : ADMIN_FIXED.UNREACHABLE);
    return;
  }
  const parsed = parseRegister(reg.data);
  const fac = parsed?.facilities.find((x): x is Facility => x.kind === 'facility' && x.facilityId === facilityId);
  if (parsed === null || fac === undefined) {
    show(W.REGISTER_HEADING, ADMIN_FIXED.UNRECOGNISED);
    return;
  }
  const c = await read(holder, 'getContact', getContactBody(facilityId));
  if (c.kind === 'refused' && stopFor(c.refusal)) return;
  const view: ContactView | null = c.kind === 'ok' ? parseContact(c.data) : null;
  renderDetail(holder, parsed, mark, fac, view, c.kind === 'ok' ? (view === null ? ADMIN_FIXED.UNRECOGNISED : null) : c.kind === 'refused' ? c.refusal.sentence : ADMIN_FIXED.UNREACHABLE, notice);
}

function renderDetail(
  holder: SessionHolder,
  reg: Register,
  mark: FetchMark,
  f: Facility,
  view: ContactView | null,
  contactProblem: string | null,
  notice?: string,
): void {
  const root = appRoot();
  if (root === null) return;
  const back = el('button', 'Back');
  back.type = 'button';
  back.addEventListener('click', () => guarded(loadRegister(holder)));
  const status = el('p', notice ?? '', 'status');
  const reopen = (message?: string): Promise<void> => openFacility(holder, f.facilityId, message);

  /** What a refused or unanswered write does, the same for every form. */
  const after = async (r: CallResult, formStatus: HTMLParagraphElement, onDropped: string | null): Promise<boolean> => {
    if (r.kind === 'ok') return true;
    if (r.kind === 'unreachable') {
      if (onDropped !== null) await reopen(onDropped);
      else formStatus.textContent = ADMIN_FIXED.UNREACHABLE;
      return false;
    }
    if (stopFor(r.refusal)) return false;
    if (r.refusal.key === 'VERSION_CONFLICT') await reopen(r.refusal.sentence);
    else formStatus.textContent = r.refusal.sentence;
    return false;
  };

  // The facility, and its edit form.
  const facility = el('section', undefined, 'facility-detail');
  facility.append(el('h2', f.name), el('p', `${f.lga}, ${f.state}`), el('p', f.listedAt === null ? W.NOT_LISTED : `${W.LISTED} (${lagosTime(f.listedAt)})`), checklist(f));
  const e = facilityInputs({ name: f.name, lga: f.lga, state: f.state });
  const editNote = el('p', 'Latitude, longitude and public phone are not shown to this page. Enter all three as they should be now: what you enter replaces what is saved.', 'note');
  facility.append(
    form('edit-facility', 'Save facility', [editNote, e.name.wrap, e.lga.wrap, e.state.wrap, e.lat.wrap, e.lng.wrap, e.phone.wrap], async (s) => {
      const fields = facilityFieldsFrom({ name: e.name.input, lga: e.lga.input, state: e.state.input, lat: e.lat.input, lng: e.lng.input, phone: e.phone.value });
      if (typeof fields === 'string') {
        s.textContent = fields;
        return;
      }
      // Sent ONCE. A dropped answer reloads and says so; it is never re-sent (BY-2 e).
      const r = await write(holder, 'editFacility', editFacilityBody(f.facilityId, f.version, fields));
      if (await after(r, s, ADMIN_FIXED.EDIT_DROPPED)) await reopen('Saved.');
    }),
  );

  // The wards, and the add-category form.
  const wards = el('section', undefined, 'wards-detail');
  const wl = el('ul', undefined, 'wards');
  for (const w of f.categories) wl.append(wardLine(w, reg, mark));
  const cat = select('Ward category', 'category', WARD_CATEGORIES.map((k) => [k, categoryLabel(k)] as const));
  const off = select('Offering', 'offering', [['OFFERED', 'Offered'], ['NOT_OFFERED', 'Not offered']]);
  wards.append(
    el('h2', 'Wards'),
    wl,
    form('add-category', 'Add ward category', [cat.wrap, off.wrap], async (s) => {
      if (cat.input.value === '' || off.input.value === '') {
        s.textContent = 'Choose a ward category and whether it is offered.';
        return;
      }
      const r = await write(holder, 'addCategory', addCategoryBody(f.facilityId, cat.input.value, off.input.value as 'OFFERED' | 'NOT_OFFERED'));
      if (await after(r, s, null)) await reopen('Ward category added.');
    }),
  );

  // The contact: fetched when this view opened, held only here.
  const contact = el('section', undefined, 'contact-detail');
  contact.append(el('h2', 'Contact'));
  if (contactProblem !== null) contact.append(el('p', contactProblem));
  else {
    const current = view?.contact ?? null;
    contact.append(el('p', current === null ? W.NO_CONTACT_WARNING : `${current.fullName}, ${current.jobTitle}`));
    const name = field('Full name', 'full_name', current?.fullName ?? '');
    const title = field('Job title', 'job_title', current?.jobTitle ?? '');
    const email = field('Email', 'email', current?.email ?? '', 'email');
    const mobile = phoneField('Mobile', 'mobile', current?.mobileE164 ?? '');
    const sms = field('SMS opt-in', 'sms_opt_in', '', 'checkbox');
    sms.input.checked = current?.smsOptIn ?? false;
    sms.wrap.append(el('span', W.SMS_OPT_IN_NOTE, 'note'));
    contact.append(
      form('record-contact', 'Save contact', [name.wrap, title.wrap, email.wrap, mobile.wrap, sms.wrap], async (s) => {
        const typedMobile = mobile.input.value.trim();
        const mobileE164 = typedMobile === '' ? null : mobile.value();
        if (typedMobile !== '' && mobileE164 === null) {
          s.textContent = 'That mobile number is not in international form (+234...). Check the preview.';
          return;
        }
        const body = recordContactBody(
          f.facilityId,
          { fullName: name.input.value, jobTitle: title.input.value, email: email.input.value.trim() === '' ? null : email.input.value, mobileE164, smsOptIn: sms.input.checked },
          current?.version ?? null,
        );
        const r = await write(holder, 'recordContact', body);
        if (await after(r, s, null)) await reopen('Contact saved.');
      }),
    );
  }

  // The agreement: recorded once, never edited or withdrawn here (BD-2 2, BN-4).
  const agreement = el('section', undefined, 'agreement-detail');
  agreement.append(el('h2', 'Agreement'));
  const a = view?.agreement ?? null;
  if (a !== null) {
    agreement.append(el('p', `Version ${a.version}, accepted ${a.acceptedOn}${a.signatoryRole === null ? '' : ` by the ${a.signatoryRole}`}${a.withdrawnOn === null ? '' : `; withdrawn ${a.withdrawnOn}`}`));
  } else if (contactProblem === null) {
    const on = field('Accepted on', 'accepted_on', '', 'date');
    const version = field('Agreement version', 'version');
    const role = field("Signatory's role", 'signatory_role');
    agreement.append(
      form('record-agreement', 'Record agreement', [on.wrap, version.wrap, role.wrap], async (s) => {
        const r = await write(holder, 'recordAgreement', recordAgreementBody(f.facilityId, on.input.value, version.input.value, role.input.value.trim() === '' ? null : role.input.value));
        if (await after(r, s, null)) await reopen('Agreement recorded.');
      }),
    );
  }

  // Listing: in the app. Unlisting and withdrawal are founder steps, never here (BC-6).
  const listing = el('section', undefined, 'listing');
  listing.append(el('h2', 'Listing'));
  if (f.listedAt !== null) listing.append(el('p', `${W.LISTED} since ${lagosTime(f.listedAt)}.`));
  else if (!canList(f)) listing.append(el('p', W.CANNOT_LIST_UNTIL));
  else {
    listing.append(
      form('list-facility', 'List this facility', [], async (s) => {
        const r = await write(holder, 'setListed', setListedBody(f.facilityId, f.version));
        if (await after(r, s, null)) await reopen('Listed.');
      }),
    );
  }

  root.replaceChildren(el('h1', f.name), back, status, facility, wards, contact, agreement, listing);
}

// ------------------------------------------------------------------ sign-in

function requestForm(): HTMLFormElement {
  const email = field(W.REQUEST_LABEL, 'email', '', 'email');
  email.input.required = true;
  email.input.autocomplete = 'email';
  const f = el('form', undefined, 'signin-request');
  const button = el('button', W.REQUEST_BUTTON);
  button.type = 'submit';
  const status = el('p', '', 'status');
  f.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      button.disabled = true;
      status.textContent = '';
      try {
        const outcome = await requestSignInLink({ apiUrl: API_URL, anonKey: PUBLISHABLE_KEY, email: email.input.value, redirectTo: `${window.location.origin}/` });
        // The status to the log; one sentence on the page, whatever it was, because
        // each status would say whether the address exists.
        if (outcome.kind === 'answered') {
          if (outcome.status !== 200) console.error('OpenBed admin: the sign-in request was answered', outcome.status);
          status.textContent = W.REQUEST_ANSWERED;
        } else {
          console.error('OpenBed admin: the sign-in request got no answer');
          status.textContent = W.REQUEST_UNREACHABLE;
        }
      } finally {
        button.disabled = false;
      }
    })();
  });
  f.append(email.wrap, button, status);
  return f;
}

function signedOut(detail: string = W.ACCESS_ORDER): void {
  show(W.SIGNED_OUT, detail);
  appRoot()?.append(el('p', W.ACCESS_ORDER), requestForm());
}

/** Exported so a test can call it and read the DOM, as the ward console's is. */
export async function render(): Promise<void> {
  let session;
  try {
    session = sessionFromUrlFragment(window.location.hash);
  } catch {
    console.error('OpenBed admin: the sign-in link was refused');
    show(W.BAD_LINK_HEADING, W.BAD_LINK);
    appRoot()?.append(requestForm());
    return;
  }
  if (session === null) {
    show(W.TITLE, W.ACCESS_ORDER);
    appRoot()?.append(requestForm());
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
    console.error('OpenBed admin: the register did not load');
    show(W.REGISTER_HEADING, ADMIN_FIXED.UNRECOGNISED);
  }
}

void render();
