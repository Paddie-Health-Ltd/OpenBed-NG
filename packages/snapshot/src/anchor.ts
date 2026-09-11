/**
 * THE CLOCK ANCHOR — the one place elapsed time is sampled.
 *
 * FINDING F3, and it is why this file is three functions long and heavily
 * commented. Freshness must never come from the device clock. A cheap Android
 * three hours slow renders a four-hour-old row GREEN; three hours fast renders a
 * ten-minute-old row GREY. Both directions occur, and they occur most often on
 * exactly the low-end devices this product targets. Neither errors, and the tile
 * is confidently wrong in a way no test on the server can see.
 *
 * SO THE ONLY TIME THIS MODULE READS IS MONOTONIC. `performance.now()` measures
 * elapsed milliseconds since page load. It is not a wall clock, it cannot be
 * wrong by three hours, and it does not move when the user or the network
 * changes the system time. Everything absolute comes from the SERVER: the
 * snapshot carries `server_now`, and each ward carries `updated_at`.
 *
 *   age = (server_now - updated_at) + (monotonic elapsed since the fetch)
 *
 * The first term is server-computed and cannot be skewed. The second is
 * device-local but monotonic. There is no third term, and adding one -- a
 * `Date.now()` anywhere in the display path -- reintroduces F3 in full.
 *
 * OPENBED-CLOCK-ANCHOR
 *
 * That annotation appears EXACTLY ONCE in the repository and that count is
 * itself reviewable. It is a declaration, not a proof: once a value is in a
 * variable nothing can distinguish a legitimate monotonic anchor from a
 * wall-clock read, so the ESLint rule arriving in Stage 3 bans the CALLS and
 * this marks the one place the ban is deliberately not in force.
 */

/** An opaque mark. Meaningless on its own; only differences of two marks matter. */
export type FetchMark = { readonly monotonicMs: number };

/**
 * Take a mark at the moment a snapshot is fetched.
 *
 * `performance.now()` where it exists, and `0` where it does not. NOT
 * `Date.now()` as a fallback: a fallback to a wall clock is the defect wearing a
 * safety belt, and it would be invisible precisely on the constrained runtimes
 * where it is most likely to be taken. With `0` the elapsed term is always 0,
 * which understates age — the tile shows the server's view, unadjusted, which is
 * the same thing it shows the instant after a fetch. That is a known, bounded,
 * honest degradation rather than an unbounded and silent one.
 */
export function markFetch(): FetchMark {
  const p = globalThis.performance;
  return { monotonicMs: typeof p?.now === 'function' ? p.now() : 0 };
}

/** Milliseconds elapsed since the mark. Monotonic, never negative. */
export function elapsedSince(mark: FetchMark): number {
  const p = globalThis.performance;
  if (typeof p?.now !== 'function') return 0;
  return Math.max(0, p.now() - mark.monotonicMs);
}
