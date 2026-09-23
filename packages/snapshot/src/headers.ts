/**
 * THE SERVE-TIME CLOCK'S HEADER NAME (R-2026-09-23-67 A3) -- one constant, read by the
 * Pages Function that sets it (serve.ts) and the page that reads it.
 *
 * WHY A HEADER AND NOT THE PAYLOAD'S OWN `server_now`. The generator writes
 * `generated_at` and `server_now` as the same instant: generation time. A cached or
 * stalled snapshot therefore carries a `server_now` exactly as old as its data, so an
 * age measured against it can never grow when the job stops -- the page would read
 * "fresh" for as long as the last snapshot was served. This header is minted by the
 * Function on EVERY response it returns, hit or miss, at the moment it returns it, and
 * is never stored: so it advances while `generated_at` stands still, and the
 * difference is the snapshot's real age.
 *
 * NOT the HTTP `Date` header: what Cloudflare's Cache API does to `Date` on a hit is
 * not observed in this repository, and a clock this page depends on must be one this
 * repository sets and tests.
 */
export const SERVED_AT_HEADER = 'x-openbed-served-at';
