import { afterAll, afterEach, beforeEach, vi } from 'vitest';

/**
 * THE COMPLIANCE PROJECT'S CLASS GUARD (R-2026-10-07 GI, with its addenda).
 *
 * WHY IT EXISTS. On 2026-10-07 CI run 37602732458 reported one unhandled
 * `ReferenceError: document is not defined`. A test had imported a module that fetches and
 * schedules a retry timer when it is IMPORTED (apps/public-dashboard/src/main.ts), stubbed the
 * network, and moved on; the retry fired after the test environment was torn down. Nothing in the
 * project said a test must own the side effects of what it imports, so one file was found by luck.
 * This file says it, for every file in the `compliance` project: when a file ends, nothing it
 * started may still be scheduled, and nothing it called may have reached a real network.
 *
 * WHAT IT HOLDS, per test file:
 *   1. UNMOCKED FETCH. `globalThis.fetch` is replaced with a function that REJECTS, names the URL and
 *      the caller, and RECORDS the call. A rejection alone proves nothing: the dashboard's own
 *      `try/catch` swallows it. So the recorded call fails the test that was running (afterEach), or
 *      the file if it happened between tests (afterAll).
 *   2. PENDING TIMERS, REAL. `setTimeout` and `setInterval` are wrapped (pass-through) and each is
 *      tracked until it fires or is cleared. A real timer still pending when the file ends fails the
 *      file, naming where it was created. vi.getTimerCount() CANNOT see these: it counts the fake
 *      clock's timers only. (Observed on first use, vitest 5.0.0: when fake timers are NOT installed it
 *      does not return 0, it THROWS "timers APIs are not mocked", which failed all 100 files until this
 *      file asked vi.isFakeTimers() first.) The timer that caused the red was a real one.
 *   3. PENDING TIMERS, FAKE. When fake timers are installed, vi.getTimerCount() above zero at the end
 *      fails the file.
 *   4. FETCHES IN FLIGHT. A fetch installed with vi.stubGlobal('fetch', fn) is wrapped, and a call
 *      that has not settled when the file ends fails the file.
 *
 * ORDER. These hooks are registered first, so under `sequence.hooks: 'stack'` (vitest's default) they
 * run LAST, after each test file's own afterEach and afterAll. A file that cleans up after itself
 * has done so before this looks.
 *
 * THE TWO TRAPS, each found by reading rather than by hitting it:
 *   - `fetch` is installed by ASSIGNMENT, never by vi.stubGlobal: many files call
 *     vi.unstubAllGlobals(), which would silently remove a guard installed that way. A later
 *     vi.stubGlobal('fetch', x) saves THIS function as the original and restores it.
 *   - A thrown error from an unmocked fetch is swallowed by the code under test, which is why
 *     the call is recorded and reported from a hook.
 *
 * SCOPE: the `compliance` project only (vitest.config.ts). The `db` project's tests use real fetch
 * against PostgREST, and the e2e project runs the real stack by design.
 *
 * NOT ASSERTED HERE, deliberately: timers or promises created by Node itself (AbortSignal.timeout,
 * timers/promises, setImmediate, process.nextTick) are not wrapped; nor is a fetch installed by any means other than
 * vi.stubGlobal (none exists in this project today). A timer that has ALREADY FIRED before the file ends
 * is not pending, so a file can leak one and pass by luck; the guard turns leaks into failures when
 * they are pending, and the owned-import helper is what makes them not leak.
 * tests/compliance/compliance_guard.test.ts plants each of the four and shows a file that owns its
 * side effects passing.
 */

interface Origin {
  readonly what: string;
  readonly stack: string;
}

const here = 'compliance-guard';

/** The caller's frames, without this file's own. */
function originOf(what: string): Origin {
  const raw = new Error().stack ?? '';
  const frames = raw
    .split('\n')
    .slice(1)
    .filter((l) => !l.includes(here))
    .slice(0, 4)
    .map((l) => l.trim());
  return { what, stack: frames.join('\n      ') };
}

const g = globalThis as unknown as {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  fetch: typeof fetch;
};

const realSetTimeout = g.setTimeout;
const realClearTimeout = g.clearTimeout;
const realSetInterval = g.setInterval;
const realClearInterval = g.clearInterval;

const pendingTimers = new Map<unknown, Origin>();

function forget(handle: unknown): void {
  if (pendingTimers.delete(handle)) return;
  // A timer cleared by its numeric id rather than by its handle.
  if (typeof handle === 'number' || typeof handle === 'string') {
    for (const key of pendingTimers.keys()) {
      if (typeof key === 'object' && key !== null && Number(key) === Number(handle)) {
        pendingTimers.delete(key);
        return;
      }
    }
  }
}

g.setTimeout = ((callback: (...a: unknown[]) => void, delay?: number, ...rest: unknown[]) => {
  const origin = originOf(`setTimeout(${String(delay)} ms)`);
  const handle = realSetTimeout((...a: unknown[]) => {
    pendingTimers.delete(handle);
    return callback(...a);
  }, delay, ...rest);
  pendingTimers.set(handle, origin);
  return handle;
}) as typeof setTimeout;

g.clearTimeout = ((handle?: Parameters<typeof clearTimeout>[0]) => {
  forget(handle);
  return realClearTimeout(handle);
}) as typeof clearTimeout;

g.setInterval = ((callback: (...a: unknown[]) => void, delay?: number, ...rest: unknown[]) => {
  const origin = originOf(`setInterval(${String(delay)} ms)`);
  const handle = realSetInterval(callback, delay, ...rest);
  pendingTimers.set(handle, origin);
  return handle;
}) as typeof setInterval;

g.clearInterval = ((handle?: Parameters<typeof clearInterval>[0]) => {
  forget(handle);
  return realClearInterval(handle);
}) as typeof clearInterval;

const unmockedCalls: Origin[] = [];
let reportedUnmocked = 0;
const inFlight = new Map<number, Origin>();
let nextId = 0;

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof input === 'object' && input !== null && 'url' in input) return String((input as { url: unknown }).url);
  return String(input);
}

const guardFetch = ((input: unknown) => {
  const url = urlOf(input);
  unmockedCalls.push(originOf(`fetch(${url})`));
  return Promise.reject(
    new TypeError(
      `UNMOCKED FETCH: ${url}. A compliance test must stub fetch before anything calls it ` +
        '(tests/setup/compliance-guard.ts).',
    ),
  );
}) as unknown as typeof fetch;
g.fetch = guardFetch;

/** A stubbed fetch, wrapped so a call that has not settled is counted. */
function tracked(stub: (...a: unknown[]) => unknown): (...a: unknown[]) => unknown {
  return function trackedFetch(this: unknown, ...args: unknown[]): unknown {
    const id = (nextId += 1);
    inFlight.set(id, originOf(`fetch(${urlOf(args[0])})`));
    let result: unknown;
    try {
      result = stub.apply(this, args);
    } catch (e) {
      inFlight.delete(id);
      throw e;
    }
    return Promise.resolve(result).finally(() => {
      inFlight.delete(id);
    });
  };
}

const originalStubGlobal = vi.stubGlobal.bind(vi);
vi.stubGlobal = ((name: string | symbol | number, value: unknown) =>
  originalStubGlobal(name as string, name === 'fetch' && typeof value === 'function' ? tracked(value as (...a: unknown[]) => unknown) : value)) as typeof vi.stubGlobal;

const describeAll = (label: string, items: Iterable<Origin>): string[] =>
  Array.from(items, (o) => `  - ${label}: ${o.what}\n      ${o.stack}`);

let unmockedAtStart = 0;

beforeEach(() => {
  unmockedAtStart = unmockedCalls.length;
});

afterEach(() => {
  const fresh = unmockedCalls.slice(unmockedAtStart);
  if (fresh.length === 0) return;
  reportedUnmocked = unmockedCalls.length;
  throw new Error(
    `${fresh.length} UNMOCKED FETCH call(s) reached the real network layer during this test. The code under test ` +
      `may have swallowed the rejection, so this is reported here:\n${describeAll('called', fresh).join('\n')}`,
  );
});

afterAll(() => {
  const problems: string[] = [];
  const unreported = unmockedCalls.slice(reportedUnmocked);
  if (unreported.length > 0) {
    problems.push(`${unreported.length} UNMOCKED FETCH call(s) happened between tests or after the last one:`, ...describeAll('called', unreported));
  }
  if (pendingTimers.size > 0) {
    problems.push(`${pendingTimers.size} real timer(s) still pending when the file ended (a test must own the timers it starts):`, ...describeAll('created', pendingTimers.values()));
  }
  // getTimerCount() throws when fake timers are not installed, so ask first.
  const fake = vi.isFakeTimers() ? vi.getTimerCount() : 0;
  if (fake > 0) {
    problems.push(`${fake} fake timer(s) still pending when the file ended (vi.getTimerCount()).`);
  }
  if (inFlight.size > 0) {
    problems.push(`${inFlight.size} stubbed fetch call(s) still in flight when the file ended:`, ...describeAll('called', inFlight.values()));
  }
  if (problems.length > 0) {
    throw new Error(`COMPLIANCE GUARD: this file did not own its side effects.\n${problems.join('\n')}`);
  }
});
