import {
  lagosTime,
  decodeWard,
  decodeFacility,
  decodeFacilityExtra,
  elapsedSince,
  markFetch,
  POLL_CADENCE_SECONDS,
  SERVED_AT_HEADER,
  type EncodedRow,
  type DecodedRow,
  type FetchMark,
} from '@openbed/snapshot';
import { phrase } from '@openbed/labels';
import { HELLO_EMAIL } from '@openbed/origins/contacts';
import { ABOUT_URL, HOME_URL, HOW_IT_WORKS_URL, PRIVACY_NOTICE_URL } from '@openbed/origins/privacy';
import { rowStyle, snapshotBanner, wardLineParts, type ServeClock, type WardLineParts } from './age-view.js';
import { addressLine, areaLine, directionsUrl, formatPhoneDisplay, LOADING_TEXT } from './card.js';
import { mountControls, type Controls, type ControlsView } from './controls.js';
import { categoryLabel } from './labels.js';
import { cancelLocate, deviceOrigin, nearMe, type LocateFailure } from './locate.js';
import { lgaBySlug } from './lga-points.js';
import {
  applyFrozenOrder,
  buildCandidates,
  kmText,
  orderFacilities,
  orderHasAged,
  parseSearch,
  writeSearch,
  type Candidate,
  type FrozenOrder,
  type SortChoice,
} from './search.js';
// The design system's tokens and self-hosted fonts first, then this app's own rules
// (the design pass, D1). Vite emits all three as same-origin assets.
import '@openbed/design/tokens.css';
import '@openbed/design/fonts.css';
import './style.css';
import './discovery.css';

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
 *   - scripts/lint_no_updated_at_filter.sh: LIVE (R-2026-10-09 GO). Its subject, the public
 *     search path, is built: ./search.ts orders and filters the results this module draws, and the
 *     guard scans it and its neighbours. Freshness REORDERS (searchRank, in the chosen-ward view) and
 *     never filters: the only filter is the offering, so a hospital whose reports are old, suppressed
 *     or absent is still drawn with its name and its call link. THE GREP IS NOT THE CONTROL that
 *     proves that: it reads one line at a time and has no way to see a band filter. The control is
 *     the rendered-page test with every ward suppressed (tests/compliance/search_freshness.test.ts).
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
 *
 * THE PAGE NEVER GOES BLANK, AND AN OUTAGE RECOVERS BY ITSELF (R-2026-10-07 GJ).
 * Until GJ, `void render()` had no catch, so any throw on a first render left the main
 * area EMPTY -- and a blank bed board reads as "no beds" to someone in a hurry. And a
 * first-load outage never retried: polling started only after a successful load, so a
 * dispatcher who opened the page during a blip saw the outage until they happened to
 * reload. Now:
 *   - Every path out of render() ends in exactly one of three states: the real snapshot,
 *     the held snapshot, or the outage notice. A throw from the fetch, the parse, or
 *     renderReal is caught and falls back to one of those, and is logged by STAGE and
 *     error NAME only: an error's message can quote the payload (a JSON parse error names
 *     the text it choked on), and no data payload belongs in a console.
 *   - A snapshot is HELD only once it has been drawn. One that cannot be drawn is not held;
 *     the page keeps what it was showing, or the outage notice if it showed nothing.
 *   - Polling starts after the first load WHATEVER its outcome, on the same cadence. The
 *     first good answer replaces the outage notice with the real snapshot, and normal
 *     polling continues. There is ONE interval, started once per render(); the generation
 *     counter still drops a stale answer. Nothing here changes what an outage may say.
 */

interface SnapshotEnvelope {
  readonly v: number;
  readonly generated_at: string;
  readonly server_now: string;
  readonly facilities: readonly EncodedRow[];
  readonly wards: readonly EncodedRow[];
  /**
   * OPTIONAL, and absent from any snapshot generated before migration 031 (R-2026-09-30-214 GN): rows of
   * [facility_id, address]. The address is NOT a ninth column of a facility row, because the codec throws on
   * a facility row of the wrong width and a page already open on the previous bundle would show the outage.
   */
  readonly facility_extras?: unknown;
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
  /** facility_id -> street address, for the facilities that have one. Empty when the block is absent or unreadable. */
  readonly addresses: ReadonlyMap<string, string>;
  readonly generatedAt: string;
  readonly servedAt: string | null;
  readonly mark: FetchMark;
}

/** How often the page polls, and re-states every age. One source: the fixture. */
const POLL_MS = POLL_CADENCE_SECONDS * 1000;

/**
 * A page fault is logged by STAGE and error NAME (or HTTP status) only (R-2026-10-07 GJ). An error's
 * message can quote the payload -- a JSON parse error names the text it choked on -- and no data
 * payload belongs in a console.
 */
function logFault(stage: 'fetch' | 'render' | 'extras', e: unknown): void {
  console.error(`OpenBed: the public page hit a fault at the ${stage} stage and fell back`, {
    error: e instanceof Error ? e.name : typeof e,
  });
}

/**
 * The street addresses from the optional facility_extras block, or an empty map. NEVER THROWS: an address is
 * an enhancement of a card and can never take the beds down, so a block that is missing, not an array, or
 * holds a row the codec refuses yields NO addresses and a log line by stage and error name only (no row, no
 * address, no message: the codec's message names its columns and a payload must not reach a console).
 */
function readAddresses(extras: unknown): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (extras === undefined) return out;
  try {
    if (!Array.isArray(extras)) throw new TypeError('facility_extras is not an array');
    for (const row of extras as EncodedRow[]) {
      if (!Array.isArray(row)) throw new TypeError('a facility_extras row is not an array');
      const decoded = decodeFacilityExtra(row);
      const address = addressLine(decoded['address']);
      const id = decoded['facility_id'];
      if (typeof id === 'string' && address !== null) out.set(id, address);
    }
  } catch (e) {
    logFault('extras', e);
    return new Map<string, string>();
  }
  return out;
}

async function fetchSnapshot(): Promise<Snapshot | null> {
  let fault = 'no answer';
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
          addresses: readAddresses(payload.facility_extras),
          generatedAt: typeof payload.generated_at === 'string' ? payload.generated_at : '',
          servedAt,
          mark,
        };
      }
      fault = `HTTP ${res.status}`;
    } catch (e) {
      // fall through to retry, then to null
      fault = e instanceof Error ? e.name : typeof e;
    }
    if (attempt < FETCH_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 150));
    }
  }
  console.error('OpenBed: the snapshot could not be fetched', { fault });
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
 * Four things it must do, each for a reason rather than for tone: say plainly
 * that this is an outage; DENY being an availability report, because a blank bed
 * board reads as "no beds" to someone in a hurry; say that the page keeps checking
 * and will update by itself BUT THAT THE READER SHOULD NOT WAIT FOR IT (the page
 * recovers on its own since R-2026-10-07 GJ, and a dispatcher must not read that as
 * a reason to hold a patient); and give the number to call instead. It renders ONE
 * PARAGRAPH and no list -- there is no row here to be misread, which is the whole
 * point. The sentence is the one Cowork approved on 2026-10-07 (GJ), exactly.
 */
export function outageMessage(): string {
  return (
    "Live bed information can't be loaded right now. This is NOT a report that beds are unavailable — " +
    'we cannot see anything either way. This page keeps checking and will update by itself, but do not wait for it: ' +
    'call the facility directly, or 112 / 767 in an emergency.'
  );
}

/**
 * THE LOADING LINE (R-2026-09-30-214 GN): "Loading bed information…", shown only while the main area holds
 * nothing at all, so only before the first render. EVERY path out of render() replaces it: the snapshot,
 * the held snapshot, the outage notice or the empty-state line, each of which calls replaceChildren on the
 * same element, so it can never sit beside a ward row. A second render() over a page that already holds
 * data finds the area occupied and shows nothing, so a refresh never flashes "loading" over live counts.
 *
 * It claims nothing about beds: no count, no digit, no word that could be read as a status. It sits under
 * the never-blank guard, and its own failure is logged and ignored, since the paths that follow still draw.
 */
function showLoading(root: HTMLElement): void {
  try {
    if (root.childElementCount > 0) return;
    const line = document.createElement('p');
    line.className = 'loading-state';
    line.textContent = LOADING_TEXT;
    root.replaceChildren(line);
  } catch (e) {
    logFault('render', e);
  }
}

function renderOutage(root: HTMLElement): void {
  // An outage notice is not a list, so the order that was held belongs to a draw that is gone: the next good
  // draw sets it again (R-2026-10-09 GO, B, "after an outage the order is recomputed only if the previous draw
  // showed the outage notice"). A failed poll that leaves results on screen never comes through here.
  frozen = null;
  clearResultsLines();
  try {
    const notice = document.createElement('p');
    notice.className = 'outage-state';
    notice.textContent = outageMessage();
    root.replaceChildren(notice);
  } catch (e) {
    // Last resort (R-2026-10-07 GJ): the same words, as plain text. Never an empty main.
    logFault('render', e);
    root.textContent = outageMessage();
  }
}

// The one decision about whether a ward can be shown lives in search.ts, beside the eligibility that uses it;
// it is re-exported here because the tests and the renderers have always named it from this module.
export { callableIdentity, type CallableIdentity } from './search.js';

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

/**
 * The footer: the general-enquiries address (the design pass, D1) and the privacy
 * notice's link (R-2026-09-26-136 DL-1 d), and nothing else. Exported so
 * tests/compliance/privacy_links.test.ts can render it and read the DOM.
 */
export function renderFooter(): void {
  const footer = document.getElementById('site-footer');
  if (!footer) return;
  const mail = document.createElement('a');
  mail.href = `mailto:${HELLO_EMAIL}`;
  mail.textContent = HELLO_EMAIL;
  const about = document.createElement('a');
  about.href = ABOUT_URL;
  about.textContent = 'About';
  const how = document.createElement('a');
  how.href = HOW_IT_WORKS_URL;
  how.textContent = 'How it works';
  const privacy = document.createElement('a');
  privacy.href = PRIVACY_NOTICE_URL;
  privacy.textContent = 'Privacy notice';
  footer.replaceChildren(mail, about, how, privacy);
}

/**
 * THE SEARCH THE VISITOR HAS MADE, held in memory only (R-2026-10-09 GO). Nothing here is ever written to a
 * store; the address carries `ward` and `area` and nothing else (writeSearch), and a device position stays in
 * locate.ts. A poll never touches any of it: only a visitor's action does.
 */
let searchWard = 'any';
let searchArea: string | null = null;
let searchSort: SortChoice = 'default';

/** The controls, mounted once into the host outside #app; null where the page has no host for them. */
let controls: Controls | null = null;
/** The host the controls were mounted into, so a replaced host is mounted again with the state held. */
let controlsHost: HTMLElement | null = null;
/** True once the address has been read: only the first mount starts from it. */
let searchStarted = false;

/** The order, held between a visitor's actions (A3). null until the first good draw, and after any draw that was not a list. */
let frozen: FrozenOrder | null = null;

/** Where distances are measured from: an LGA's reference point, a held device position, or nowhere. */
type Start =
  | { readonly kind: 'area'; readonly lat: number; readonly lng: number; readonly label: string }
  | { readonly kind: 'device'; readonly lat: number; readonly lng: number };

function currentStart(): Start | null {
  if (searchArea !== null) {
    const point = lgaBySlug(searchArea);
    if (point !== undefined) return { kind: 'area', lat: point.lat, lng: point.lng, label: point.label };
  }
  const device = deviceOrigin();
  return device === null ? null : { kind: 'device', lat: device.lat, lng: device.lng };
}

/** "04:12", the Lagos wall time of the page's own serve clock; null where the page has no serve time. */
function serveClockTime(clock: ServeClock): string | null {
  if (clock.servedAt === null) return null;
  const at = Date.parse(clock.servedAt);
  if (Number.isNaN(at)) return null;
  const match = /\b\d{2}:\d{2}\b/.exec(lagosTime(new Date(at + clock.elapsedMs).toISOString()));
  return match === null ? null : match[0];
}

/** What the controls' coverage and aged-order lines say after a draw that was not a list. */
function clearResultsLines(): void {
  controls?.setCoverage(null);
  controls?.setAgedOrder(null);
}

function renderReal(root: HTMLElement, snapshot: Snapshot): void {
  const { facilities, wards, addresses } = snapshot;
  const clock: ServeClock = { servedAt: snapshot.servedAt, elapsedMs: elapsedSince(snapshot.mark) };
  const start = currentStart();
  const wardChosen = searchWard !== 'any';

  const empty = emptyStateMessage(facilities, wards);
  if (empty !== null) {
    frozen = null;
    clearResultsLines();
    const notice = document.createElement('p');
    notice.className = 'empty-state';
    notice.textContent = empty;
    root.replaceChildren(notice);
    return;
  }

  const found = buildCandidates(facilities, wards, clock, searchWard, start);
  for (const gone of found.dropped) {
    // No count, deliberately: see the header.
    console.error('OpenBed: a ward was not shown because its facility has no callable identity in the snapshot', {
      facility_id: gone.facility_id,
      category: gone.category,
    });
  }

  // Every ward dropped is not an empty city. It is information we cannot show.
  if (found.callableWardRows === 0) {
    frozen = null;
    clearResultsLines();
    renderOutage(root);
    return;
  }

  // Wards were all stated NOT_OFFERED: nothing a hospital offers is listed, which is not "no beds".
  if (found.listed === 0) {
    frozen = null;
    clearResultsLines();
    const notice = document.createElement('p');
    notice.className = 'empty-state';
    notice.textContent = emptyStateMessage(facilities, []);
    root.replaceChildren(notice);
    return;
  }

  controls?.setCoverage(phrase('coverage', { n: String(found.shown.length), m: String(found.listed) }));

  // A ward chosen that no listed hospital offers: the empty state, with the emergency numbers kept.
  if (found.shown.length === 0) {
    frozen = null;
    controls?.setAgedOrder(null);
    const notice = document.createElement('p');
    notice.className = 'empty-state';
    notice.textContent = `${phrase('empty_ward', { ward: categoryLabel(searchWard) })} ${phrase('emergency_line')}`;
    root.replaceChildren(notice);
    return;
  }

  // THE ORDER IS SET ONLY WHEN THE VISITOR ACTS (A3). A poll re-applies the frozen order; it never re-sorts.
  let ordered: readonly Candidate[];
  let held = frozen;
  if (held === null) {
    const ids = orderFacilities(found.shown, searchSort, wardChosen, start !== null);
    const byId = new Map(found.shown.map((c) => [c.id, c]));
    ordered = ids.flatMap((id) => {
      const c = byId.get(id);
      return c === undefined ? [] : [c];
    });
    held = { ids: [...ids], ranks: new Map(found.shown.map((c) => [c.id, c.rank])), setAt: serveClockTime(clock) };
    frozen = held;
  } else {
    ordered = applyFrozenOrder(held, found.shown);
  }
  controls?.setAgedOrder(held.setAt !== null && orderHasAged(held, ordered) ? phrase('aged_order', { time: held.setAt }) : null);

  // The page-level warning first: while it shows, no row reads as live (DB-1).
  const banner = snapshotBanner(snapshot.generatedAt, clock);

  const sections: HTMLElement[] = [];
  for (const candidate of ordered) {
    const { identity, facility: facilityRow } = candidate;
    const section = document.createElement('section');
    section.className = 'facility';

    const heading = document.createElement('h2');
    heading.textContent = identity.name;

    // THE LOCATION BLOCK (R-2026-09-30-214 GN): the street address when the facility has one, then
    // "<LGA>, <State>", then the distance when there is a starting point, then Directions. All text via
    // textContent, never markup. Each part is left out when it is missing, and none of them can cost the
    // card its call link. The distance sits OUTSIDE the ward rows: a suppressed row holds no digit.
    const place: HTMLElement[] = [];
    const address = addresses.get(candidate.id);
    if (address !== undefined) {
      const line = document.createElement('p');
      line.className = 'facility-address';
      line.textContent = address;
      place.push(line);
    }
    const area = areaLine(facilityRow['lga'], facilityRow['state']);
    if (area !== null) {
      const line = document.createElement('p');
      line.className = 'facility-area';
      line.textContent = area;
      place.push(line);
    }
    if (start !== null) {
      const line = document.createElement('p');
      line.className = 'facility-distance';
      line.textContent =
        candidate.distanceKm === null
          ? phrase('distance_unavailable')
          : start.kind === 'device'
            ? phrase('distance_device', { km: kmText(candidate.distanceKm) })
            : phrase('distance_area', { km: kmText(candidate.distanceKm), lga: start.label });
      place.push(line);
    }
    const url = directionsUrl(facilityRow['lat'], facilityRow['lng']);
    if (url !== null) {
      const directions = document.createElement('a');
      directions.className = 'directions';
      directions.href = url;
      directions.target = '_blank';
      directions.rel = 'noopener noreferrer';
      directions.textContent = 'Directions';
      place.push(directions);
    }

    const call = document.createElement('a');
    call.className = 'call';
    call.href = `tel:${identity.phone}`;
    // The same words as before the design pass; the number sits in a span so it can be
    // set in mono. The link's textContent is unchanged.
    const phone = document.createElement('span');
    phone.className = 'phone';
    // The number is shown in a readable form; the tel: link above keeps the E.164 form.
    phone.textContent = formatPhoneDisplay(identity.phone);
    call.append('Call to confirm beds: ', phone);

    const list = document.createElement('ul');
    for (const ward of candidate.wards) {
      const item = document.createElement('li');
      renderWardLine(item, wardLineParts(ward, clock), banner !== null);
      list.appendChild(item);
    }

    section.append(heading, ...place, call, list);
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

/** The controls' view of the search as it stands. */
function controlsView(): ControlsView {
  const start = currentStart();
  return {
    ward: searchWard,
    area: searchArea,
    origin: start === null ? null : start.kind === 'device' ? { kind: 'device' } : { kind: 'area', label: start.label },
    sort: start === null ? 'default' : searchSort,
  };
}

/** Show the search as it stands: the controls, and which of the two share notes is true. */
function syncControls(): void {
  if (controls === null) return;
  controls.sync(controlsView());
  controls.setShareNote(currentStart()?.kind === 'device' ? phrase('share_note_device') : phrase('share_note_area'));
}

/** The address carries the bed type and the chosen area, and nothing else (a device position writes ward only). */
function writeAddress(): void {
  try {
    history.replaceState(null, '', `${location.pathname}${writeSearch({ ward: searchWard, area: searchArea })}`);
  } catch {
    // An address that cannot be written leaves the search working; nothing depends on it.
  }
}

const failureWords: Record<LocateFailure, string> = {
  denied: phrase('location_denied'),
  unavailable: phrase('location_unavailable'),
  timeout: phrase('location_timeout'),
};

/** Draws the held snapshot again with the order recomputed; set by render(), which owns what is held. */
let redraw: (() => void) | null = null;

/** After a visitor's action: the order is recomputed, the address and controls follow, and the results are drawn again. */
function afterAction(): void {
  frozen = null;
  if (searchSort === 'nearest' && currentStart() === null) searchSort = 'default';
  writeAddress();
  syncControls();
  redraw?.();
}

/** Mount the controls into the host index.html provides, once per host. A page with no host runs on its defaults. */
function ensureControls(): void {
  const host = document.getElementById('search');
  if (host === null) {
    controls = null;
    controlsHost = null;
    return;
  }
  if (host === controlsHost && controls !== null) return;
  if (!searchStarted) {
    const start = parseSearch(location.search);
    searchWard = start.ward;
    searchArea = start.area;
    searchStarted = true;
  }
  controlsHost = host;
  // The address is written back from the state just read, so a key the page does not read (a position, anything) and a value
  // outside its tables are gone from it before the visitor does anything.
  writeAddress();
  controls = mountControls(
    host,
    {
      onWard: (ward) => {
        searchWard = ward;
        afterAction();
      },
      onArea: (slug) => {
        cancelLocate();
        controls?.setStatus('');
        searchArea = slug;
        afterAction();
      },
      onNearMe: () => {
        controls?.setStatus('');
        nearMe((result) => {
          if (!result.ok) {
            controls?.setStatus(failureWords[result.reason]);
            return;
          }
          searchArea = null;
          afterAction();
        });
      },
      onClear: () => {
        cancelLocate();
        controls?.setStatus('');
        searchArea = null;
        afterAction();
      },
      onSort: (sort) => {
        searchSort = sort;
        afterAction();
      },
      onCopy: () => {
        const link = `${HOME_URL}${writeSearch({ ward: searchWard, area: searchArea })}`;
        const clipboard = navigator.clipboard;
        if (clipboard === undefined) return;
        clipboard.writeText(link).then(
          () => controls?.setStatus(phrase('link_copied')),
          () => undefined,
        );
      },
    },
    controlsView(),
  );
  syncControls();
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
  // A fresh load: the controls are mounted, and the first good draw sets the order.
  ensureControls();
  frozen = null;

  /** The snapshot on screen. null while the outage notice is. A snapshot is held only once it has been drawn. */
  let held: Snapshot | null = null;
  let inFlight = false;

  /** Draws what the page holds, or the outage notice. Never throws, never leaves the main area empty. */
  const restore = (): void => {
    if (held !== null) {
      try {
        renderReal(root, held);
        return;
      } catch (e) {
        logFault('render', e);
        held = null;
      }
    }
    renderOutage(root);
  };

  /** Draws `next` and holds it. If it cannot be drawn, the page falls back to what it showed before. */
  const tryShow = (next: Snapshot): boolean => {
    try {
      renderReal(root, next);
      held = next;
      return true;
    } catch (e) {
      logFault('render', e);
      restore();
      return false;
    }
  };

  // A control change draws the held snapshot again, re-sorted. It does nothing before one is held: a visitor
  // acting during the loading line must not turn it into an outage notice.
  redraw = (): void => {
    if (mine === generation && held !== null) restore();
  };

  const tick = (): void => {
    // One poll at a time. A tick that finds one still in flight re-states the
    // ages of what is held rather than starting a second request.
    if (inFlight) {
      if (held !== null) restore();
      return;
    }
    inFlight = true;
    void fetchSnapshot()
      .then((next) => {
        inFlight = false;
        if (mine !== generation) return;
        if (next !== null) {
          tryShow(next);
          return;
        }
        // A failed poll keeps the held snapshot on screen; with none held, the outage notice stays.
        restore();
      })
      .catch((e: unknown) => {
        inFlight = false;
        logFault('render', e);
      });
  };

  showLoading(root);

  try {
    const first = await fetchSnapshot();
    if (mine !== generation) return;
    if (first === null) renderOutage(root);
    else tryShow(first);
    // Polling starts whatever the first load did: an outage recovers on the next good answer.
    polling = setInterval(tick, POLL_MS);
  } catch (e) {
    logFault('render', e);
    renderOutage(root);
  }
}

renderFooter();
void render();
