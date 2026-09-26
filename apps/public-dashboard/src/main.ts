import {
  decodeWard,
  decodeFacility,
  elapsedSince,
  markFetch,
  POLL_CADENCE_SECONDS,
  SERVED_AT_HEADER,
  type EncodedRow,
  type DecodedRow,
  type FetchMark,
} from '@openbed/snapshot';
import { HELLO_EMAIL } from '@openbed/origins/contacts';
import { rowStyle, snapshotBanner, wardLineParts, type ServeClock, type WardLineParts } from './age-view.js';
// The design system's tokens and self-hosted fonts first, then this app's own rules
// (the design pass, D1). Vite emits all three as same-origin assets.
import '@openbed/design/tokens.css';
import '@openbed/design/fonts.css';
import './style.css';

/**
 * The public dashboard.
 *
 * Fetches /beds.json (the Bundle 1 Pages Function -- see
 * apps/public-dashboard/functions/beds.json.ts) and renders the real
 * snapshot. When that fetch fails it renders an OUTAGE STATE: one sentence,
 * and nothing a reader could mistake for a bed count.
 *
 * NOTHING RENDERS HERE THAT DID NOT COME FROM THE SERVER, and the rule is
 * written down because this module broke it. Until 2026-09-21 the failure path
 * rendered a hard-coded list of two invented wards, with invented bed counts,
 * under the words "showing example data". Both rendered as OPEN AND ACCEPTING,
 * because their duty flags were all UNKNOWN and an unknown flag gates nothing:
 * the invented state was the most inviting one available. That reached real
 * visitors on openbed.ng whenever the snapshot could not be fetched, decoded or
 * parsed -- the moment a reader is most likely to act on what they see.
 *
 * R-2026-09-20-29 E3 forbids rendering absence as "a bare zero". This is the
 * same rule in the other direction, and the harder one to see: AN OUTAGE MUST
 * NEVER BE RENDERED AS AN AVAILABILITY REPORT (R-2026-09-21-44).
 *
 * THE EXAMPLE DATA IS DELETED, NOT FLAG-GUARDED. A DEV flag leaves the rows in
 * the bundle, one runtime condition away from a visitor, on a handset nobody is
 * watching. There is no example data in this module to guard.
 *
 * WHY NOTHING HERE COMPUTES A GATE. The served snapshot deliberately never
 * carries duty flags -- see decisions.the_snapshot_never_carries_duty_flags in
 * packages/fixtures/snapshot-shape.json. The server has already computed
 * accepting_effective and gated_by per ward; this module reads them straight
 * off the decoded row. The gate package was imported ONLY to derive the deleted
 * rows' reason, so the import went with them -- and with it this app's last use
 * of that package.
 *
 * A COUNT IS SHOWN ONLY BESIDE A FACILITY SOMEONE CAN CALL (R-2026-09-23-66 B, C).
 * Until 2026-09-23 a ward whose facility was missing from the payload rendered as
 * "(unknown facility) — ICU_ADULT: 6 beds": six beds somewhere nobody could ring.
 * The founder ruled it DROPPED, not explained -- a crew cannot act on an
 * unidentified ward, and 019 makes the case unreachable at source. So:
 *   - callableIdentity() is the ONE place that decides whether a ward has a
 *     facility to show it under: the facility is in the payload, its name is not
 *     blank, and it carries a number to call. The last condition is this module's
 *     reading of C1 -- the call link cannot render without it -- and 007 makes the
 *     column NOT NULL, so it is expected never to fire.
 *   - a dropped ward renders NOTHING, and is logged with its facility id and
 *     category only. Never its count: a log line is not a place a number should
 *     survive the decision not to show it.
 *   - DROPPING MUST NEVER READ AS "NO BEDS". If every ward is dropped, the page
 *     renders the outage state -- live information cannot be shown -- not the
 *     empty-city message and not an empty list.
 *   - each facility carries ONE tap-to-call link, beside its name, with the
 *     number visible: "Call to confirm beds". One per facility, not per ward. The
 *     tile, and anything that suggests a call reserves a bed, are Bundle 4's.
 *
 * CLASSIFICATION under Clause 5 of .claude/rules/code-pipeline.md:
 *   - scripts/lint_no_service_role_in_bundle.sh's CLIENT corpus: unaffected by
 *     this file either way -- see that script's own header for its
 *     classification, not restated here. This fetch carries no credential of
 *     any kind (an unauthenticated GET), so it does not meet that guard's
 *     stated trigger ("a real authenticated client fetch") regardless.
 *   - scripts/lint_no_updated_at_filter.sh: still GUARD-AHEAD-OF-SUBJECT --
 *     see that script's own header. Its true subject, distance-based public
 *     search and filtering, is not built here. SINCE R-2026-09-23-67 THIS
 *     MODULE READS EACH WARD'S AGE, for display only, through ./age-view.ts:
 *     every ward is still rendered, in the order served. An age is shown,
 *     never used to choose which rows appear.
 *
 * EVERY COUNT CARRIES ITS AGE (R-2026-09-23-67 A). The fetch keeps the
 * snapshot's generated_at, the x-openbed-served-at header the Pages Function
 * stamps on each response, and a monotonic mark; ./age-view.ts turns those
 * into words.
 *
 * THE PAGE POLLS (R-2026-09-23-68 A; release gate 2 as restated 2026-09-10: "a
 * client poll at the snapshot's own cadence reflects the new count"). Every
 * POLL_CADENCE_SECONDS it fetches /beds.json again. Until -68 it only re-rendered
 * the payload it already had, so a tab left open raised the stale banner after
 * three minutes on data that was fresh at the server.
 *   - A successful poll REPLACES the held snapshot, and with it the serve-time
 *     anchor the ages are measured from.
 *   - A failed poll KEEPS the held snapshot on screen and re-renders it, so its
 *     ages keep growing and the banner arrives when it should. It never blanks the
 *     page and never shows the outage state while good data is held. Only a first
 *     load with nothing held renders the outage.
 */

interface SnapshotEnvelope {
  readonly v: number;
  readonly generated_at: string;
  readonly server_now: string;
  readonly facilities: readonly EncodedRow[];
  readonly wards: readonly EncodedRow[];
}

// Matches packages/snapshot/src/serve.ts's own UPSTREAM_TIMEOUT_MS /
// UPSTREAM_ATTEMPTS -- NOT imported from there, since serve.ts must never
// reach client code (it holds SUPABASE_SERVICE_ROLE_KEY handling).
const FETCH_TIMEOUT_MS = 8000;
const FETCH_ATTEMPTS = 2;

/**
 * Fetches and decodes the snapshot, or returns null on any failure: the caller
 * renders the outage on a first load, and keeps what it holds on a poll. A
 * failure is: a non-2xx status (500/502/503/504 are all real states the
 * Function itself produces, per
 * tests/db/beds_json_served.test.ts), a network exception, a timeout, a JSON
 * parse failure, or the codec throwing on a decode-arity mismatch. All of
 * these get one retry with jittered backoff, then give up.
 */
interface Snapshot {
  readonly facilities: DecodedRow[];
  readonly wards: DecodedRow[];
  readonly generatedAt: string;
  readonly servedAt: string | null;
  readonly mark: FetchMark;
}

/** How often the page polls, and re-states every age. One source: the fixture. */
const POLL_MS = POLL_CADENCE_SECONDS * 1000;

async function fetchSnapshot(): Promise<Snapshot | null> {
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      // no-store, on every fetch: a copy from the browser's HTTP cache carries the
      // x-openbed-served-at of the response it was stored from, and every age here
      // is measured from that header. A stored copy would therefore make old data
      // read younger than it is -- the one direction this page must never err in.
      const res = await fetch('/beds.json', { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.ok) {
        const mark = markFetch();
        const servedAt = res.headers.get(SERVED_AT_HEADER);
        const payload = (await res.json()) as SnapshotEnvelope;
        return {
          facilities: payload.facilities.map(decodeFacility),
          wards: payload.wards.map(decodeWard),
          generatedAt: typeof payload.generated_at === 'string' ? payload.generated_at : '',
          servedAt,
          mark,
        };
      }
    } catch {
      // fall through to retry, then to null
    }
    if (attempt < FETCH_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 150));
    }
  }
  return null;
}

/**
 * THE EMPTY STATE IS NOT A ZERO. "No facility has joined yet" and "no beds are
 * available" are DIFFERENT FACTS, and a page that renders both as an empty list
 * presents absence of data as data -- to a reader who may be routing an ambulance
 * (R-2026-09-20-29 E).
 *
 * The payload already carries the distinction: `facilities` is empty when nobody has
 * joined, and non-empty with no wards when facilities are onboarded but none is
 * reporting. It is THIS function that used to discard it, by appending nothing to a
 * list and swapping it in.
 *
 * Returns the sentence to show instead of a list, or null when there are wards to
 * render. Exported so its three branches are readable; the test asserts the RENDERED
 * TEXT, not this return value, because a page can pass this and still say nothing.
 */
export function emptyStateMessage(facilities: DecodedRow[], wards: DecodedRow[]): string | null {
  if (wards.length > 0) return null;
  if (facilities.length === 0) {
    return 'No facility has joined OpenBed yet, so there is nothing to show. This is NOT a report that beds are unavailable — no hospital has told us anything either way. Call the facility directly, or 112 / 767 in an emergency.';
  }
  return 'Facilities have joined, but none has reported a ward yet. This is NOT a report that beds are unavailable — nothing has been told to us either way. Call the facility directly, or 112 / 767 in an emergency.';
}

/**
 * THE OUTAGE STATE. Same register as emptyStateMessage above, and exported for
 * the same reason -- but the test asserts the RENDERED TEXT, never this return
 * value, because a page can return the right string and render nothing.
 *
 * Three things it must do, each for a reason rather than for tone: say plainly
 * that this is an outage; DENY being an availability report, because a blank bed
 * board reads as "no beds" to someone in a hurry; and give the number to call
 * instead. It renders ONE PARAGRAPH and no list -- there is no row here to be
 * misread, which is the whole point.
 */
export function outageMessage(): string {
  return (
    "Live bed information can't be loaded right now. This is NOT a report that beds are unavailable — " +
    'we cannot see anything either way. Call the facility directly, or 112 / 767 in an emergency.'
  );
}

function renderOutage(root: HTMLElement): void {
  const notice = document.createElement('p');
  notice.className = 'outage-state';
  notice.textContent = outageMessage();
  root.replaceChildren(notice);
}

/** What a count needs beside it before it may render: a name, and a number to call. */
export interface CallableIdentity {
  readonly name: string;
  readonly phone: string;
}

/**
 * THE ONE DECISION about whether a ward can be shown. Null when its facility is
 * absent from the payload, its name is blank or only whitespace, or it carries no
 * number to call. Every renderer asks this; none decides it for itself.
 */
export function callableIdentity(facility: DecodedRow | undefined): CallableIdentity | null {
  if (facility === undefined) return null;
  const name = facility['name'];
  const phone = facility['public_phone_e164'];
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (typeof phone !== 'string' || phone.trim() === '') return null;
  return { name: name.trim(), phone: phone.trim() };
}

/**
 * ONE WARD ROW, IN PIECES (the design pass, D1). Its textContent is EXACTLY
 * wardLine(ward, clock).text: every piece is appended in order, a piece with a role
 * inside a span, the rest as plain text, and nothing is added between them
 * (tests/compliance/dashboard_ward_row_identity.test.ts). The li keeps exactly one
 * class, `age-<tone>`; the styling hooks sit on the spans. No class name carries a
 * digit, because a suppressed row's markup must hold none (dashboard_age.test.ts).
 */
function renderWardLine(item: HTMLLIElement, parts: WardLineParts, pageStale: boolean): void {
  item.className = `age-${parts.tone}`;
  const style = rowStyle(parts, pageStale);
  for (const segment of parts.segments) {
    if (segment.role === undefined) {
      item.append(segment.text);
      continue;
    }
    const span = document.createElement('span');
    if (segment.role === 'category') span.className = 'ward-category';
    else if (segment.role === 'badge') span.className = `badge status-${style.badge}`;
    else if (segment.role === 'words') span.className = 'ward-words';
    else span.className = `stamp stamp-${style.stamp}`;
    span.textContent = segment.text;
    item.append(span);
  }
}

/** The footer: the general-enquiries address, and nothing else (the design pass, D1). */
function renderFooter(): void {
  const footer = document.getElementById('site-footer');
  if (!footer) return;
  const mail = document.createElement('a');
  mail.href = `mailto:${HELLO_EMAIL}`;
  mail.textContent = HELLO_EMAIL;
  footer.replaceChildren(mail);
}

function renderReal(root: HTMLElement, snapshot: Snapshot): void {
  const { facilities, wards } = snapshot;
  const clock: ServeClock = { servedAt: snapshot.servedAt, elapsedMs: elapsedSince(snapshot.mark) };
  const empty = emptyStateMessage(facilities, wards);
  if (empty !== null) {
    const notice = document.createElement('p');
    notice.className = 'empty-state';
    notice.textContent = empty;
    root.replaceChildren(notice);
    return;
  }

  const byId = new Map(facilities.map((f) => [f['facility_id'], f]));
  const shown = new Map<unknown, { identity: CallableIdentity; wards: DecodedRow[] }>();
  for (const ward of wards) {
    const id = ward['facility_id'];
    const identity = callableIdentity(byId.get(id));
    if (identity === null) {
      // No count, deliberately: see the header.
      console.error('OpenBed: a ward was not shown because its facility has no callable identity in the snapshot', {
        facility_id: id,
        category: ward['category'],
      });
      continue;
    }
    const group = shown.get(id) ?? { identity, wards: [] };
    group.wards.push(ward);
    shown.set(id, group);
  }

  // Every ward dropped is not an empty city. It is information we cannot show.
  if (shown.size === 0) {
    renderOutage(root);
    return;
  }

  // The page-level warning first: while it shows, no row reads as live (DB-1).
  const banner = snapshotBanner(snapshot.generatedAt, clock);

  const sections: HTMLElement[] = [];
  for (const { identity, wards: facilityWards } of shown.values()) {
    const section = document.createElement('section');
    section.className = 'facility';

    const heading = document.createElement('h2');
    heading.textContent = identity.name;

    const call = document.createElement('a');
    call.className = 'call';
    call.href = `tel:${identity.phone}`;
    // The same words as before the design pass; the number sits in a span so it can be
    // set in mono. The link's textContent is unchanged.
    const phone = document.createElement('span');
    phone.className = 'phone';
    phone.textContent = identity.phone;
    call.append('Call to confirm beds: ', phone);

    const list = document.createElement('ul');
    for (const ward of facilityWards) {
      const item = document.createElement('li');
      renderWardLine(item, wardLineParts(ward, clock), banner !== null);
      list.appendChild(item);
    }

    section.append(heading, call, list);
    sections.push(section);
  }

  if (banner !== null) {
    const notice = document.createElement('p');
    notice.className = 'snapshot-banner';
    notice.setAttribute('role', 'status');
    notice.textContent = banner;
    root.replaceChildren(notice, ...sections);
  } else {
    root.replaceChildren(...sections);
  }
}

let polling: ReturnType<typeof setInterval> | null = null;
/** Bumped by every render(), so a poll answered after a newer render() is dropped. */
let generation = 0;

/**
 * Exported so a test can call it and then read the DOM, rather than re-importing
 * the module to make it run again: the module renders once on import, and a second
 * import is a module-cache question rather than a rendering one.
 */
export async function render(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;

  if (polling !== null) clearInterval(polling);
  polling = null;
  generation += 1;
  const mine = generation;

  const first = await fetchSnapshot();
  if (mine !== generation) return;
  if (first === null) {
    renderOutage(root);
    return;
  }

  let held: Snapshot = first;
  let inFlight = false;
  renderReal(root, held);
  polling = setInterval(() => {
    // One poll at a time. A tick that finds one still in flight re-states the
    // ages of what is held rather than starting a second request.
    if (inFlight) {
      renderReal(root, held);
      return;
    }
    inFlight = true;
    void fetchSnapshot().then((next) => {
      inFlight = false;
      if (mine !== generation) return;
      if (next !== null) held = next;
      renderReal(root, held);
    });
  }, POLL_MS);
}

renderFooter();
void render();
