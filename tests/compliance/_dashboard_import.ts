import { vi } from 'vitest';

/**
 * THE ONE WAY A TEST IMPORTS THE PUBLIC DASHBOARD (R-2026-10-07 GI).
 *
 * apps/public-dashboard/src/main.ts ends with `renderFooter(); void render();`, so IMPORTING it
 * starts a network call, and a failed call schedules a retry timer (fetchSnapshot waits
 * 150 + Math.random() * 150 ms before its second attempt). A test that imports it therefore OWNS
 * those side effects: the network call it makes, and every timer it leaves behind. A test that does
 * not leaves the retry to fire whenever the event loop next turns, which can be after the test
 * environment has been torn down, where `document` no longer exists (the ReferenceError of CI run
 * 37602732458, tests/compliance/import_side_effects_owned.test.ts reproduces it on demand).
 *
 * WHAT THIS DOES, in order:
 *   1. installs fake timers for the four timer functions, BEFORE the import, so every timer the
 *      import's render schedules is a fake one;
 *   2. stubs fetch with a response of the given status and an empty JSON body (a non-2xx status, or an
 *      empty payload that the decoder rejects, both send fetchSnapshot to its retry and then to the
 *      outage notice);
 *   3. imports the module, which starts its render;
 *   4. lets the first attempt settle, runs the retry it scheduled whatever its jitter
 *      (runOnlyPendingTimersAsync, not a guessed number of milliseconds), and lets the outage render finish.
 * `dispose()` drops any timer still pending, restores real timers, and unstubs fetch.
 *
 * The 30 s polling interval a SUCCESSFUL render starts is module-private and cannot be cleared by a
 * test, so a test that renders a real snapshot installs fake timers itself, before it imports, and
 * `dispose()` (through useRealTimers) is what drops that interval.
 *
 * Only the first import in a file runs the module's top-level render; later imports hit the module
 * cache. The flush is harmless then.
 */

type Dashboard = typeof import('../../apps/public-dashboard/src/main.js');

export interface OwnedDashboard {
  readonly mod: Dashboard;
  readonly dispose: () => void;
}

const FOUR = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const;

export async function importDashboardOwned(status = 500): Promise<OwnedDashboard> {
  vi.useFakeTimers({ toFake: [...FOUR] });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
  const mod = await import('../../apps/public-dashboard/src/main.js');
  await vi.advanceTimersByTimeAsync(0);
  await vi.runOnlyPendingTimersAsync();
  await vi.advanceTimersByTimeAsync(0);
  return {
    mod,
    dispose: () => {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    },
  };
}
