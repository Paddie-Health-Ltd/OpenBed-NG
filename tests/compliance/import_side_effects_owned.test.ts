// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { importDashboardOwned } from './_dashboard_import.js';

/**
 * THE REPRODUCTION OF #125's RED, MADE TO FAIL ON DEMAND (R-2026-10-07 GI, addendum 1 A).
 *
 * WHAT WENT WRONG. On 2026-10-07 CI run 37602732458 reported one unhandled
 * `ReferenceError: document is not defined`, from renderOutage in the public dashboard, while
 * tests/compliance/privacy_links.test.ts ran. The dashboard's main.ts ends with
 * `renderFooter(); void render();`, so the first dynamic import in a test starts an un-awaited
 * render(). With fetch stubbed to 500, fetchSnapshot waits 150 + Math.random() * 150 ms before its
 * one retry, gets another 500, and renderOutage then calls document.createElement. If the test
 * environment has been torn down by then, `document` is gone.
 *
 * THE RECIPE, with no luck in it. Fake timers; fetch returns 500; import the dashboard; delete
 * globalThis.document, as the environment's teardown does; advance the clock by 300 ms (the retry's
 * longest wait is under 300 ms); and listen for the error the way Node reports it.
 *
 * TWO KINDS OF LEG, and the difference is the point:
 *   - the PLANT leg shows the hazard REPRODUCES on demand. It reproduces through code this repository
 *     does not change (the dashboard is not touched), so it passes for good: it is the proof that
 *     the ACCEPT leg is not a leg that could never fail;
 *   - the ACCEPT leg is the fix's own property: a test that imports the dashboard through the shared
 *     helper in tests/compliance/_dashboard_import.ts leaves nothing scheduled, so nothing fires after
 *     teardown. It is RED against the helper's first version (a bare import) and GREEN against the owned one.
 *
 * RE-AIMED BY R-2026-10-07 GJ. GJ makes the public page catch ANY throw on its way out of render() and
 * fall back to the real snapshot, the held one, or the outage notice. So the same recipe no longer ends in
 * an unhandled ReferenceError: renderOutage's last resort catches it, logs it by stage and error NAME, and
 * keeps the page. The PLANT leg therefore asserts the fault still HAPPENS on demand and is now CONTAINED:
 * exactly one logged ReferenceError and no unhandled error. The ACCEPT leg is unchanged in meaning: an owned
 * import leaves no fault at all, logged or not. What this costs, stated here and in the pull request: a
 * teardown race of this kind no longer reddens CI by itself as an unhandled error. The class guard is the
 * control that still does, because it fails any file that ends with a timer pending, whether or not the page
 * would have coped with it firing.
 *
 * NOT ASSERTED HERE, deliberately: that every test file in the project owns its imports. That is the
 * class guard's job (tests/setup/compliance-guard.ts), over every file, not this file's.
 */

const BODY = '<main id="app"></main><footer id="site-footer"></footer>';
const FOUR = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const;

/** Collect what Node reports as unhandled while `run` executes. An attached listener also stops vitest reporting it. */
async function captureUnhandled(run: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onRejection = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onRejection);
  try {
    await run();
    // Node reports a rejection on the turn after the microtasks that rejected it drain.
    await new Promise<void>((r) => setImmediate(r));
    await new Promise<void>((r) => setImmediate(r));
  } finally {
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onRejection);
  }
  return seen;
}

/** What the environment's teardown does to the global: removes it. Returns the restore. */
function tearDownDocument(): () => void {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  if (saved === undefined || saved.configurable !== true) {
    throw new Error('globalThis.document is missing or not configurable: this file cannot simulate the teardown');
  }
  delete (globalThis as { document?: Document }).document;
  return () => {
    Object.defineProperty(globalThis, 'document', saved);
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('importing the dashboard in a test: the retry after teardown', () => {
  test('plant — the unowned import (stubbed 500, teardown, retry fires) still faults with ReferenceError: document is not defined, every time, and the page now contains it', async () => {
    for (let i = 0; i < 10; i += 1) {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.resetModules();
      document.body.innerHTML = BODY;
      vi.useFakeTimers({ toFake: [...FOUR] });
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
      await import('../../apps/public-dashboard/src/main.js');
      // Attempt 1 has been answered 500 and the retry's wait is now scheduled.
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount(), `run ${i}: the plant did not schedule the retry`).toBe(1);

      const restore = tearDownDocument();
      let documentWas = 'present';
      let errors: unknown[];
      try {
        errors = await captureUnhandled(async () => {
          documentWas = typeof document;
          await vi.advanceTimersByTimeAsync(300);
        });
      } finally {
        restore();
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
      }
      const faults = logged.mock.calls.map((c) => JSON.stringify(c[1] ?? null));
      logged.mockRestore();
      expect(documentWas, `run ${i}: the plant did not remove document`).toBe('undefined');
      expect(errors, `run ${i}: since GJ the page catches this, so nothing may be unhandled`).toHaveLength(0);
      expect(faults.filter((f) => f === '{"error":"ReferenceError"}'), `run ${i}: the ReferenceError did not happen and get logged`).toHaveLength(1);
    }
  });

  test('real pattern — an owned import leaves no error after teardown, however long the environment outlives it', async () => {
    vi.resetModules();
    document.body.innerHTML = BODY;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const owned = await importDashboardOwned(500);
    owned.dispose();
    const loggedBefore = logged.mock.calls.length;

    const restore = tearDownDocument();
    let errors: unknown[];
    try {
      // Real time, longer than the retry's longest wait: whatever the import left scheduled would fire inside this.
      errors = await captureUnhandled(async () => {
        await new Promise<void>((r) => setTimeout(r, 600));
      });
    } finally {
      restore();
    }
    const after = logged.mock.calls.slice(loggedBefore).map((c) => JSON.stringify(c[1] ?? null));
    logged.mockRestore();
    expect(errors.map(String), 'the import left something scheduled that fired after teardown').toEqual([]);
    expect(after, 'the import left something scheduled that faulted after teardown, even though the page contained it').toEqual([]);
  });

  test('anti-vacuity — the listener sees an unhandled rejection raised on purpose, and the helper restores real timers', async () => {
    const control = await captureUnhandled(async () => {
      void Promise.reject(new Error('control'));
    });
    expect(control.map(String), 'the listener is dead: "no error" above would prove nothing').toEqual(['Error: control']);

    const owned = await importDashboardOwned(500);
    owned.dispose();
    expect(vi.isFakeTimers(), 'the helper left fake timers installed').toBe(false);
  });
});
