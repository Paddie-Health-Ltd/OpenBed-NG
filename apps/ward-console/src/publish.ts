import type { SessionHolder } from '@openbed/auth';
import { WARD_SUPPORT_EMAIL } from '@openbed/origins/support';

/**
 * THE WARD CONSOLE'S PUBLISH, WITHOUT THE PAGE (R-2026-10-02-FF FF-4 f, -182).
 *
 * apps/ward-console/src/main.ts reads `window` at module load and renders on import, so nothing
 * outside a DOM could call submitPublish. The acceptance test for D5 (a publish still lands exactly
 * once when the Worker is taken away) must run the console's OWN submitPublish against the real
 * Worker handler and the local stack, in the `db` project, with no DOM. So this file holds
 * submitPublish and exactly what it needs -- the fixed sentences, the row and form shapes, and the
 * mapping from a server refusal to a sentence -- and imports nothing that touches `window` or
 * `document`. main.ts imports from here and re-exports the names its tests read, so the moved names
 * keep their old import path. Nothing about their behaviour changed in the move.
 *
 * WHAT STAYS IN main.ts: the page, the form, the handover list, and every sentence that belongs to a
 * screen rather than to a publish (the new renewal and unreachable sentences among them).
 * RESTATED 2026-10-03 (R-2026-10-02-FG FG-4 c, -183): UNREACHABLE_PUBLISH now lives HERE, not in main.ts,
 * because submitPublish itself returns it when a response body fails to read, and publish.ts cannot import
 * main.ts (main.ts touches `window` at load, and the db acceptance test imports this file). main.ts
 * re-exports it. The old text, kept: "(the new renewal and unreachable sentences among them)" (2026-10-02).
 *
 * THE ONE ALLOWED WALL-CLOCK READ MOVED WITH submitPublish. `p_composed_at` below is the device's
 * `composed_at` for 014's symmetric STALE/FUTURE_MUTATION window, ruled by R-2026-09-26-130 DF-1 b. It
 * is built ONCE per tap, so a re-send by the fallback (packages/auth/src/fallback.ts) carries the same
 * body byte for byte, `p_client_mutation_id` and `p_composed_at` included, and replays rather than
 * duplicates. tests/compliance/eslint_wall_clock.test.ts pins this exemption by file and reason.
 *
 * submitPublish lets SessionExpiredError, RenewalUnavailableError and OriginsUnreachableError
 * PROPAGATE: they are the caller's to word, and main.ts's catch does.
 * RESTATED 2026-10-03 (FG-4 c): and it RETURNS UNREACHABLE_PUBLISH when the answer's body fails to read. A
 * socket that dies after the headers arrived is not a rejection inside fetchWithFallback, so there is no
 * fallback and reading the body throws; the write may have committed, so the sentence says "may not have
 * been sent". A body that reads but is not JSON stays UNRECOGNISED. The old text, kept: "submitPublish lets
 * ... PROPAGATE: they are the caller's to word" named three errors and no returned read failure.
 */

/**
 * The message a session that has ENDED produces: the server refused it, or it could not be renewed
 * because the refresh token itself was refused.
 *
 * RESTATED 2026-10-02 (R-2026-10-02-FF FF-2 f, -182). This comment used to read "The one message an
 * expired or unrenewable session produces. There is no other." That stopped being true the day a
 * renewal that is only "not now" began to KEEP the session: a RenewalUnavailableError has its own
 * sentences (RENEWAL_UNAVAILABLE_PUBLISH and RENEWAL_UNAVAILABLE_LOAD in main.ts), because telling a
 * ward their session "has ended" when it has not would send them to ask for a link from a pool the
 * whole project shares (30 an hour). This one is for SessionExpiredError alone.
 */
export const TAP_AGAIN = 'Your session has ended. Tap the sign-in link on this handset again to sign back in.';

/**
 * WHAT A WARD IS TOLD, FOR EVERY ANSWER THE SERVER CAN GIVE (R-2026-09-23-66, the
 * kickoff's D1). Raw server text NEVER reaches the screen: it named internals, and
 * on the bad-link screen it carried GoTrue's own error text. Each rejection the
 * three functions this console calls can raise -- app.assert_member() and
 * public.my_reporting_wards() and public.publish_ward_status(), each as 026 last
 * wrote it (011's and 014's, renamed or widened by R-2026-09-27-144/-145) -- has a
 * fixed sentence here, and tests/compliance/ward_console_render.test.ts asserts
 * this table covers exactly the codes parsed from those functions. 23514 is the
 * CHECK violation a count outside 0-500 would raise (004). Anything else gets
 * UNRECOGNISED. The raw text goes to the console log for whoever debugs it.
 *
 * WHERE A WARD IS SENT FOR HELP (R-2026-09-23-67 B1). These said "phone the OpenBed
 * operator" and named no number, because none existed (R-2026-09-23-66). They now
 * name the ward support address from packages/origins/contacts.json, and point
 * first at the facility's own OpenBed administrator -- conditionally, because nothing
 * this console can read says whether the facility has one.
 * tests/compliance/ward_support_contact.test.ts refuses any message that sends a ward
 * to the operator without the address.
 */
export const GET_HELP = `ask your facility's OpenBed administrator if you have one, or email ${WARD_SUPPORT_EMAIL}.`;
export const CALL_OPERATOR = `If it keeps happening, ${GET_HELP}`;
export const ASK_FOR_HELP = `To fix this, ${GET_HELP}`;
export const UNRECOGNISED = `Something went wrong. Reload the page and try again. ${CALL_OPERATOR}`;

/**
 * THE CONNECTION FAILED AROUND A PUBLISH (R-2026-10-02-FF FF-4 c; restated by R-2026-10-02-FG FG-4 a, -183).
 * It is said when no origin answered, and when an answer's body failed to read. In both the write MAY have
 * committed (a Worker that forwarded the publish and lost the answer; a body cut off after the headers), so
 * "not sent" would be false; and a re-tap replays under the same mutation id, so it "will not be counted
 * twice". The text FF-4 c wrote, kept: "This update was not sent: this handset could not reach OpenBed.
 * Check it is online, then tap Publish again. Your sign-in is kept." (2026-10-02)
 */
export const UNREACHABLE_PUBLISH =
  'This update may not have been sent: the connection to OpenBed failed. Check this handset is online, then tap Publish again. It will not be counted twice. Your sign-in is kept.';

export const WARD_MESSAGES: Readonly<Record<string, string>> = {
  NOT_AUTHENTICATED: TAP_AGAIN,
  NOT_A_MEMBER: `This sign-in is not linked to a ward. ${ASK_FOR_HELP}`,
  ACCOUNT_DEACTIVATED: `This sign-in has been switched off. ${ASK_FOR_HELP}`,
  CROSS_FACILITY_DENIED: `This sign-in cannot act for that facility. ${ASK_FOR_HELP}`,
  INSUFFICIENT_ROLE: `This sign-in cannot publish bed counts. ${ASK_FOR_HELP}`,
  WARD_SCOPE_DENIED: 'This handset can only publish for its own ward, not this one.',
  INVALID_ARGUMENT: `The update could not be read. Reload the page and try again. ${CALL_OPERATOR}`,
  SESSION_ID_IS_ACCOUNT_ID: 'This sign-in cannot be used for an update. Sign in again with a new link.',
  MISSING_MUTATION_CONTEXT: `The update was incomplete. Reload the page and try again. ${CALL_OPERATOR}`,
  NO_SUCH_WARD: `This ward is not set up yet. ${ASK_FOR_HELP}`,
  FUTURE_MUTATION: "This handset's clock is ahead. Check its date and time, then try again.",
  STALE_MUTATION: 'The update took too long to send. Try again.',
  ZERO_REQUIRES_REASON: 'Publishing zero beds as offered needs a reason.',
  VERSION_CONFLICT: 'Someone else already updated this ward. Reload the handover list before trying again.',
  '23514': 'That update cannot be accepted: a count must be between 0 and 500, and a ward that is not offered has no count.',
};

/**
 * The fixed sentence for a server's refusal. Reads the leading code of PostgREST's
 * `message` (a RAISE's first token) or its SQLSTATE `code`, never anything else,
 * and logs the raw body so it is not lost.
 */
export function wardMessageFor(status: number, body: string): string {
  console.error('OpenBed ward console: the server refused a request', { status, body });
  let parsed: { message?: unknown; code?: unknown } = {};
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    return UNRECOGNISED;
  }
  const token = typeof parsed.message === 'string' ? (/^([A-Z_]+)\b/.exec(parsed.message)?.[1] ?? '') : '';
  if (token !== '' && Object.hasOwn(WARD_MESSAGES, token)) return WARD_MESSAGES[token] as string;
  const code = typeof parsed.code === 'string' ? parsed.code : '';
  if (code === '23514') return WARD_MESSAGES['23514'] as string;
  return UNRECOGNISED;
}

export interface WardRow {
  readonly category: string;
  readonly offering: 'OFFERED' | 'NOT_OFFERED';
  readonly bedCount: number | null;
  readonly accepting: boolean;
  readonly version: number;
  readonly gatedBy: string | null;
  /** app.monitoring_state, app.status_source and app.status_state, as codes; shown in words. */
  readonly monitoringState: string;
  readonly source: string;
  readonly state: string;
  /** The server's answer to "may THIS login publish for this ward?" (026). Missing reads as false. */
  readonly canPublish: boolean;
}

export interface PublishResult {
  readonly version: number;
  readonly replayed: boolean;
  readonly claim_offering: 'OFFERED' | 'NOT_OFFERED';
  readonly claim_bed_count: number | null;
  readonly claim_accepting: boolean;
  readonly public_gated_by: string | null;
}

export type PublishOutcome = { readonly ok: true; readonly result: PublishResult } | { readonly ok: false; readonly message: string };

/** What the form sends. A ward that is NOT offered sends no count and does not claim to be accepting. */
export interface PublishForm {
  readonly offering: 'OFFERED' | 'NOT_OFFERED';
  readonly bedCount: number | null;
  readonly accepting: boolean;
  readonly reason: string | null;
}

export async function submitPublish(holder: SessionHolder, ward: WardRow, form: PublishForm, mutationId: string): Promise<PublishOutcome> {
  const res = await holder.authedFetch('rpc/publish_ward_status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_category: ward.category,
      p_offering: form.offering,
      p_bed_count: form.bedCount,
      p_accepting: form.accepting,
      p_reason: form.reason,
      p_expected_version: ward.version,
      p_client_mutation_id: mutationId,
      // eslint-disable-next-line openbed/no-wall-clock -- OPENBED-CLOCK-READ: R-2026-09-26-130 DF-1 b, the device's composed_at for 014's symmetric STALE/FUTURE_MUTATION window (the v2 kickoff's Stage 2)
      p_composed_at: new Date().toISOString(),
    }),
  });

  // READ THE BODY AS TEXT, in a try (FG-4 c): a read that throws is the connection failing after the answer
  // began, not a malformed answer, and the write may have committed. JSON that does not parse is a different
  // thing and stays UNRECOGNISED.
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { ok: false, message: UNREACHABLE_PUBLISH };
  }
  if (!res.ok) {
    return { ok: false, message: wardMessageFor(res.status, text) };
  }

  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    return { ok: false, message: UNRECOGNISED };
  }
  const result = Array.isArray(rows) ? (rows as PublishResult[])[0] : undefined;
  if (result === undefined) {
    return { ok: false, message: UNRECOGNISED };
  }
  return { ok: true, result };
}
