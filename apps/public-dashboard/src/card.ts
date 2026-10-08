/**
 * THE PURE PARTS OF THE FACILITY CARD (R-2026-09-30-214 GN): what to say about a place, how to write a phone
 * number so a person can read it, and when a Directions link may exist. No DOM and no side effect, so it can
 * be unit-tested without importing main.ts, which renders on import.
 *
 * Nothing here fetches anything. The Directions link is an ordinary anchor to Google Maps; the browser
 * navigates when it is clicked, and the page's Content-Security-Policy (connect-src 'self') is untouched
 * because a navigation is not a connection the page makes.
 */

/** The loading line, exactly as Cowork approved it (R-2026-09-30-214 GN). It claims nothing about beds. */
export const LOADING_TEXT = 'Loading bed information…';

/**
 * "+234" followed by exactly ten digits is shown as "+234 800 000 0001". Anything else comes back
 * unchanged, byte for byte: a formatter that guessed at a number it does not understand would show a wrong
 * number on a phone someone is about to dial. The tel: link keeps the E.164 form; this is for display only.
 */
export function formatPhoneDisplay(e164: string): string {
  const m = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m === null ? e164 : `+234 ${m[1] as string} ${m[2] as string} ${m[3] as string}`;
}

const isCoordinate = (value: unknown, limit: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= -limit && value <= limit;

/** A number as Google Maps reads it: plain decimal, never exponent form. */
const plain = (n: number): string => {
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(7).replace(/\.?0+$/, '') : s;
};

/**
 * The Google Maps directions URL for a facility, or null. Built only from a latitude in [-90, 90] and a
 * longitude in [-180, 180] that are finite NUMBERS: a string, null, NaN or an out-of-range value builds no
 * link, rather than a link whose destination is "null,undefined" or the wrong hemisphere. The database
 * already confines stored coordinates to Nigeria; this is the link's own validity rule.
 */
export function directionsUrl(lat: unknown, lng: unknown): string | null {
  if (!isCoordinate(lat, 90) || !isCoordinate(lng, 180)) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${plain(lat)},${plain(lng)}`;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** "<LGA>, <State>", leaving out whichever is missing, or null when both are. */
export function areaLine(lga: unknown, state: unknown): string | null {
  const parts = [text(lga), text(state)].filter((p) => p !== '');
  return parts.length === 0 ? null : parts.join(', ');
}

/** A street address to show, or null. The server guarantees one line of 1 to 200 characters; this only declines blank or non-text. */
export function addressLine(value: unknown): string | null {
  const t = text(value);
  return t === '' ? null : t;
}
