/**
 * THE ONLY FILE THAT ASKS THE DEVICE WHERE IT IS (R-2026-10-09 GO, section 4).
 *
 * "Near me" is a button, and nothing here runs before its tap: no call on load, no call when an area is
 * chosen, no permission query. One position is requested per tap, with a ten second limit and no cached
 * answer. The position is held in this module and nowhere else; main.ts reads it through deviceOrigin()
 * only to hand it to the distance code, and it is never written to a URL, a link, a log or a store.
 *
 * THE REQUEST TOKEN. Every tap, every area choice and every Clear advances `token`. A callback that
 * arrives under an older token is DROPPED SILENTLY: no origin is set, no message is shown, nothing is
 * re-sorted. That is what makes a slow answer to an earlier tap harmless after the visitor has moved on.
 * A poll and a change of bed type never touch the token, because neither is a decision about where the
 * visitor is.
 *
 * A FAILURE carries only a reason from this file's three names. The browser's own error text and the
 * position object are never read beyond the numeric code and the two coordinates, and nothing here logs.
 *
 * NOT ASSERTED HERE, deliberately: what the browser or the operating system sends to its own location
 * provider to find the device. On some browsers the request reaches a network service run by the browser
 * vendor. OpenBed does not receive it, which is why the privacy notice says "may use its location
 * service"; no test in this repository can see it.
 */

export type LocateFailure = 'denied' | 'unavailable' | 'timeout';

export type LocateResult = { readonly ok: true } | { readonly ok: false; readonly reason: LocateFailure };

export interface DeviceOrigin {
  readonly lat: number;
  readonly lng: number;
}

const OPTIONS: PositionOptions = { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 };

let token = 0;
let device: DeviceOrigin | null = null;

/** The held device position, or null. */
export function deviceOrigin(): DeviceOrigin | null {
  return device;
}

/** Forget the device position and drop any answer still on its way. Called by an area choice and by Clear. */
export function cancelLocate(): void {
  token += 1;
  device = null;
}

const inRange = (n: unknown, limit: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= -limit && n <= limit;

/**
 * Ask for one position. `done` is called at most once, and not at all when a newer decision made this
 * request stale. A failed tap leaves any earlier origin as it was: the visitor still has it.
 */
export function nearMe(done: (result: LocateResult) => void): void {
  token += 1;
  const mine = token;
  const fail = (reason: LocateFailure): void => {
    if (mine !== token) return;
    done({ ok: false, reason });
  };
  const here = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
  if (here === undefined || here === null) {
    fail('unavailable');
    return;
  }
  try {
    here.getCurrentPosition(
      (position) => {
        if (mine !== token) return;
        const lat: unknown = position?.coords?.latitude;
        const lng: unknown = position?.coords?.longitude;
        if (!inRange(lat, 90) || !inRange(lng, 180)) {
          fail('unavailable');
          return;
        }
        device = { lat, lng };
        done({ ok: true });
      },
      (error) => {
        const code: unknown = error?.code;
        fail(code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable');
      },
      OPTIONS,
    );
  } catch {
    fail('unavailable');
  }
}
