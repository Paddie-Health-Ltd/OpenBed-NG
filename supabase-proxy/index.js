/**
 * api.openbed.ng -- a Host-rewriting reverse proxy in front of the Supabase
 * project origin. See the 2026-09-19 addendum in
 * Sprint Kickoffs/decision-2026-09-14-public-private-split.md for why this
 * domain exists and what it backs; this file is the whole implementation, and
 * that document is the narrative -- point to it, do not restate it here.
 *
 * WHAT THIS IS NOT. No auth, no rate limiting, no request modification beyond
 * the Host header. It is not a security boundary: every request it forwards is
 * authorized exactly as it would be calling the Supabase origin directly, with
 * whatever credentials the caller already presented.
 */
export default {
  async fetch(request) {
    const SUPABASE_PROJECT_ID = "klrlpxysjsjpdkeqdhvl";
    const SUPABASE_ORIGIN = `https://${SUPABASE_PROJECT_ID}.supabase.co`;

    const url = new URL(request.url);
    const targetUrl = new URL(url.pathname + url.search, SUPABASE_ORIGIN);

    const headers = new Headers(request.headers);
    headers.set("Host", `${SUPABASE_PROJECT_ID}.supabase.co`);

    const modifiedRequest = new Request(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: "manual",
    });

    return fetch(modifiedRequest);
  },
};
