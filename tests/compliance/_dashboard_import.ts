import { vi } from 'vitest';

/**
 * THE ONE WAY A TEST IMPORTS THE PUBLIC DASHBOARD (R-2026-10-07 GI).
 *
 * apps/public-dashboard/src/main.ts ends with `renderFooter(); void render();`, so IMPORTING it
 * starts a network call, and a failed call schedules a retry timer. A test that imports it
 * therefore owns those side effects: the network call it makes, and the timers it leaves.
 *
 * FIRST VERSION, written to be red: this is the behaviour every importer had before the fix,
 * a bare import with the network stubbed and nothing flushed. tests/compliance/import_side_effects_owned.test.ts
 * shows that it leaves the retry timer to fire after teardown.
 */

type Dashboard = typeof import('../../apps/public-dashboard/src/main.js');

export interface OwnedDashboard {
  readonly mod: Dashboard;
  readonly dispose: () => void;
}

export async function importDashboardOwned(status = 500): Promise<OwnedDashboard> {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
  const mod = await import('../../apps/public-dashboard/src/main.js');
  return {
    mod,
    dispose: () => {
      vi.unstubAllGlobals();
    },
  };
}
