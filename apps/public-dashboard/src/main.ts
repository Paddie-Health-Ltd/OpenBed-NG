import { decodeWard, decodeFacility, type EncodedRow, type DecodedRow } from '@openbed/snapshot';

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
 * CLASSIFICATION under Clause 5 of .claude/rules/code-pipeline.md:
 *   - scripts/lint_no_service_role_in_bundle.sh's CLIENT corpus: unaffected by
 *     this file either way -- see that script's own header for its
 *     classification, not restated here. This fetch carries no credential of
 *     any kind (an unauthenticated GET), so it does not meet that guard's
 *     stated trigger ("a real authenticated client fetch") regardless.
 *   - scripts/lint_no_updated_at_filter.sh: still GUARD-AHEAD-OF-SUBJECT --
 *     see that script's own header, updated alongside this file. Its true
 *     subject, distance-based public search and filtering, is not built here;
 *     this change is fetch, decode and render only, and never reads
 *     updated_at at all.
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
 * Fetches and decodes the snapshot, or returns null on any failure so the
 * caller can fall back to the stub. A failure is: a non-2xx status (500/502/
 * 503/504 are all real states the Function itself produces, per
 * tests/db/beds_json_served.test.ts), a network exception, a timeout, a JSON
 * parse failure, or the codec throwing on a decode-arity mismatch. All of
 * these get one retry with jittered backoff, then give up.
 */
async function fetchSnapshot(): Promise<{ facilities: DecodedRow[]; wards: DecodedRow[] } | null> {
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch('/beds.json', { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.ok) {
        const payload = (await res.json()) as SnapshotEnvelope;
        return {
          facilities: payload.facilities.map(decodeFacility),
          wards: payload.wards.map(decodeWard),
        };
      }
    } catch {
      // fall through to retry, then to the stub
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

function renderReal(root: HTMLElement, facilities: DecodedRow[], wards: DecodedRow[]): void {
  const nameOf = new Map(facilities.map((f) => [f['facility_id'], f['name']]));

  const empty = emptyStateMessage(facilities, wards);
  if (empty !== null) {
    const notice = document.createElement('p');
    notice.className = 'empty-state';
    notice.textContent = empty;
    root.replaceChildren(notice);
    return;
  }

  const list = document.createElement('ul');
  for (const ward of wards) {
    const bedCount = ward['bed_count'];
    const beds = bedCount === null ? 'not yet reporting' : `${bedCount} beds`;
    const open = ward['accepting_effective'] === true;
    const reason = ward['gated_by'] as string | null;
    const facilityName = nameOf.get(ward['facility_id']) ?? '(unknown facility)';

    const item = document.createElement('li');
    item.textContent =
      `${facilityName} — ${ward['category']}: ${beds}${open ? '' : ' — not accepting'}${reason ? ` (${reason})` : ''}`;
    list.appendChild(item);
  }

  root.replaceChildren(list);
}

/**
 * Exported so a test can call it and then read the DOM, rather than re-importing
 * the module to make it run again: the module renders once on import, and a second
 * import is a module-cache question rather than a rendering one.
 */
export async function render(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;

  const snapshot = await fetchSnapshot();
  if (snapshot) {
    renderReal(root, snapshot.facilities, snapshot.wards);
  } else {
    renderOutage(root);
  }
}

void render();
