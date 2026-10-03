import { OriginsUnreachableError, PROXY_HEADER, fetchWithFallback, CALL_WORST_CASE_MS, SEND_TIMEOUT_MS, type FallbackOptions } from './fallback.js';
import { MalformedTokenError, expired, secondsUntilExpiry, sessionFromTokens, type Session } from './session.js';

/**
 * THE STATEFUL HALF: one session, held, refreshed once at a time, and dropped
 * only when the server REFUSES it -- not when it merely cannot be asked just now.
 *
 * RESTATED 2026-10-02 (R-2026-10-02-FF FF-2 f, -182). The first line of this header said "dropped the
 * moment it cannot be renewed". That was true while every non-2xx and every transport failure signed
 * the handset out, and a signed-out ward needs a new emailed link from a pool the whole project
 * shares (30 an hour). It is no longer true, and the classification below is why: an answer that
 * says "not now" (a 429, a 409, a 5xx, the Worker's own `refused`, no answer at all) KEEPS the
 * session; only an answer that says "no" (the refresh token itself was refused) ends it. The
 * original line, kept: "one session, held, refreshed once at a time, and dropped the moment it
 * cannot be renewed." (2026-09-08)
 *
 * WHAT REPLACING @supabase/supabase-js ACTUALLY COST. The library buys session
 * storage and token refresh. What makes the replacement small is the ward
 * console's shape rather than cleverness: ONE HANDSET, ONE SCREEN. There is no
 * background timer and no cross-tab lock -- which is where supabase-js's real
 * complexity lives -- because a refresh is taken on demand, immediately before
 * the request that needs it, with a single in-flight promise so a burst of
 * concurrent calls produces one refresh rather than a stampede.
 *
 * AND SHORT SESSIONS ARE THE DESIGN, NOT A LIMITATION. The ward-identity
 * decision of 2026-09-08 replaced an offboarding SOP with the property that
 * ACCESS FOLLOWS PHYSICAL CONTROL OF THE WARD HANDSET. Session longevity is
 * therefore deliberately not a goal, which removes most of the argument for a
 * refresh machine -- but not all of it: a nurse must not lose a half-typed bed
 * count because an hour passed.
 *
 * THE ONE RULE THAT MATTERS MORE THAN THE REST. An expired or unrenewable
 * session BLOCKS A WRITE. It never lets one appear to succeed. A bed count is
 * an assertion about NOW; a write that silently did not land leaves the ward
 * believing the system knows something it does not, which is worse than an
 * error message.
 *
 * RESTATED 2026-10-02 (FF-2). The paragraph's second half read "Every path out of `accessToken()` is
 * either a usable token or a thrown SessionExpiredError -- there is no third return." The invariant
 * stands: every path out of `accessToken()` is a usable token or a thrown error, and an unusable
 * session blocks a write. What changed is WHICH error. There are now two, and a caller must handle
 * both (tests/compliance/auth_catch_sites.test.ts holds every catch site to that):
 *   - SessionExpiredError: the session is over, it has been dropped, "tap the link again";
 *   - RenewalUnavailableError: the session is KEPT; the renewal could not be done just now. Nothing
 *     was written. The next call tries again.
 *     RESTATED 2026-10-03 (R-2026-10-02-FG FG-4 a, -183). This said "Nothing was sent", which was true
 *     until FG-3: a kept token's 401 now reaches this error AFTER a send. The send was refused before
 *     anything ran, so nothing was written, and "written" is the claim that holds on every path. The old
 *     text, kept: "Nothing was sent." (2026-10-02)
 * And a usable token can now be the OLD one: if a renewal says "not now" and the current access token
 * still has more than 30 s left by the local clock, measured when accessToken() returns, it is
 * returned. 30 s covers one authedFetch of two 12 s sends.
 *
 * NO RETRY LOOP, AND NO SPINNER. There is NO automatic retry of a "not now": the next call tries
 * again, which keeps the 2026-09-08 rule. After a 429 no refresh is attempted for 60 s, matching the
 * Worker's `retry-after: 60` (a header a browser cannot read: it is not CORS-exposed), so a
 * reconnecting hospital does not re-send into a limit it has just hit.
 *
 * The original paragraph, kept: "NO RETRY LOOP ON A REFUSAL. A refusal is terminal and lands in
 * exactly the same state as expiry: signed out, 'tap the link again'. Retries are bounded and apply
 * ONLY to transport failures, where the server never gave an answer at all. Those are different
 * events and conflating them is how a dead session turns into a spinner." (2026-09-08) A REFUSAL
 * (the refresh token was refused) still is terminal and still lands in the state of expiry. What
 * the classification stops doing is reading a 429 or a 503 as one.
 *
 * A 401 ON A KEPT TOKEN KEEPS THE SESSION (R-2026-10-02-FG FG-3, -183; ruled there because FF did not).
 * Before W4 a token inside the 60 s skew was never sent. Since FF-2 a token with 30 to 60 s left by the
 * local clock IS sent, and a handset whose clock is 30 s or more behind gets a 401 for it, although the
 * refresh token was never refused. Signing out then is the outcome FF-2 exists to prevent. So the "kept"
 * mark travels WITH THE REQUEST (`#resolveToken()` returns it beside the token, and only that request's
 * 401 check reads it; a holder field read after the answer would sign out on an old request's 401 when a
 * concurrent refresh had meanwhile succeeded). A 401 on a kept token throws RenewalUnavailableError, the
 * session is not touched, and THAT TOKEN IS SPENT: `#keptToken` will not return it again, so inside a 429
 * cooldown the next call sends nothing, and after the cooldown the next call tries the refresh (which, if
 * the refresh token has by then been refused, signs out, as FF-2 rules). A 401 on any token that was not
 * kept is unchanged: the session is over, whichever origin answered.
 * While `#localClockUntrusted` is set the holder returns the token early and never reaches `#keptToken`,
 * so this rule cannot apply there, and needs no plant.
 * NOT ASSERTED, and INFERRED: that a 401 wrote nothing. PostgREST verifies the JWT before the request
 * reaches the database, so a refused token runs no function; no plant in this repository can show that,
 * and the sentence the ward reads says "not published" for exactly this reason.
 *
 * THE TWO ORIGINS. With a `fallbackApiUrl` every send goes through fetchWithFallback (fallback.ts,
 * whose header states the rules and the bounds). The holder adds STICKINESS: when the Worker went
 * first and failed, for the next five minutes the direct origin goes first and the Worker is the
 * fallback, so a hung Worker does not cost every action 12 s. The window is read through the
 * injectable clock, a clock that moves backwards ends it and never extends it, and a failure of the
 * direct origin inside the window does not restart it.
 * RESTATED 2026-10-03 (FG-8): and a Worker failure that is recorded while the window is ALREADY OPEN
 * does not extend it either. A call that started Worker-first before the window opened, and failed
 * after it opened, used to record the failure again and push the end out by up to one send; the window
 * now ends five minutes after the FIRST failure. The old text ended "...does not restart it." (2026-10-02)
 *
 * Guarded by tests/compliance/auth_session.test.ts (the state machine) and
 * tests/compliance/auth_fallback.test.ts (the origins and the bounds). Both are LIVE.
 */

/** The session is over and has been dropped. One terminal state, one message for the UI. */
export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/**
 * The renewal could not be done just now, and the session is KEPT (R-2026-10-02-FF FF-2). `status` is
 * the HTTP status of the answer that said "not now", or null when nothing answered.
 */
export class RenewalUnavailableError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'RenewalUnavailableError';
    this.status = status;
  }
}

/** The refresh call, injectable so the state machine is testable without a network. */
export type RefreshTransport = (refreshToken: string) => Promise<unknown>;

/** A token with less than this left is treated as spent. Flight time, not clock skew. */
export const REFRESH_SKEW_SECONDS = 60;

/** Per the SOP: every external call has a timeout, and 12 seconds is the ceiling. */
export const REFRESH_TIMEOUT_MS = SEND_TIMEOUT_MS;

/** Transport failures only. An answer is never retried. */
export const REFRESH_ATTEMPTS = 3;

/**
 * The wait before attempt `n + 1`: 2**(n-1) * 250 ms plus `r` (0 to 1) of 250 ms of jitter. THE ONE
 * SOURCE (FG-2): the sleep below calls it with Math.random(), and the maximum is the same function at 1,
 * so the bound a test reads can never be a copy of the formula the sleep uses.
 */
export const refreshBackoffMs = (n: number, r: number): number => 2 ** (n - 1) * 250 + r * 250;

/** The longest wait before attempt `n + 1`. */
export const REFRESH_BACKOFF_MAX_MS = (n: number): number => refreshBackoffMs(n, 1);

/** A refresh, worst case: every attempt a pair of sends to its timeout, plus every backoff. 73.25 s. */
export const REFRESH_WORST_CASE_MS =
  REFRESH_ATTEMPTS * CALL_WORST_CASE_MS +
  Array.from({ length: REFRESH_ATTEMPTS - 1 }, (_, i) => REFRESH_BACKOFF_MAX_MS(i + 1)).reduce((a, b) => a + b, 0);

/**
 * How old a publish tap's `composed_at` can be when it reaches the server: the body is built before
 * authedFetch, so it ages through a refresh and then one call. 97.25 s, held under migration 026's
 * STALE_MUTATION window by tests/compliance/auth_fallback.test.ts.
 */
export const COMPOSED_AT_AGE_BOUND_MS = REFRESH_WORST_CASE_MS + CALL_WORST_CASE_MS;

/** After a Worker failure the direct origin goes first for this long. */
export const STICKY_WINDOW_MS = 5 * 60_000;

/** A renewal that says "not now" keeps the old token only if more than this is left. */
export const KEEP_TOKEN_SECONDS = 30;

/** After a 429 no refresh is sent for this long. Matches the Worker's `retry-after: 60`. */
export const REFRESH_COOLDOWN_MS = 60_000;

interface HolderOptions {
  apiUrl: string;
  /**
   * The origin to fall back to (R-2026-10-02-FF FF-1), or none. Equal to `apiUrl` means none. The
   * package takes it as an argument and never imports it: tests/compliance/direct_origin_holders.test.ts
   * holds the importers of the direct origin to a named list.
   */
  fallbackApiUrl?: string;
  anonKey: string;
  session: Session;
  /** Injectable for tests. Milliseconds since the epoch. */
  now?: () => number;
  /** Injectable for tests. Defaults to a real POST against GoTrue. */
  refresh?: RefreshTransport;
  /** Injectable for tests, so a backoff does not make the suite slow. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests. Defaults to the global fetch, looked up at call time. */
  fetch?: typeof fetch;
}

/** What #postRefresh attaches to the error for an ANSWER, so the classification reads numbers, never text. */
interface AnswerDetail {
  readonly status?: number;
  readonly refused?: boolean;
}

export class SessionHolder {
  #session: Session | null;
  readonly #apiUrl: string;
  readonly #fallbackApiUrl: string | null;
  readonly #anonKey: string;
  readonly #now: () => number;
  readonly #refresh: RefreshTransport;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #fetch: typeof fetch | undefined;
  #inFlight: Promise<Session> | null = null;
  /** When the Worker, going first, last failed. Null when the sticky window is closed. */
  #primaryFailedAt: number | null = null;
  /** When a 429 on refresh was last answered. Null when no cooldown applies. */
  #cooldownFrom: number | null = null;
  /** The kept access token the server refused with a 401 (FG-3): never returned as a kept token again. */
  #spentKeptToken: string | null = null;
  /**
   * Set when a refresh SUCCEEDS and the local clock still claims the brand-new
   * token is expiring. That can only mean the device clock is wrong, and
   * pre-emptive refreshing would then loop against `token_refresh = 150 per 5
   * minutes per IP` until the ward is locked out. From that point the local
   * check is abandoned and the SERVER's 401 is the only expiry signal -- which
   * is the authority anyway. Finding F3's shape, caught at the one place in the
   * auth path where a wall clock is read.
   */
  #localClockUntrusted = false;

  constructor(opts: HolderOptions) {
    this.#session = opts.session;
    this.#apiUrl = opts.apiUrl.replace(/\/+$/, '');
    const fallback = opts.fallbackApiUrl?.replace(/\/+$/, '') ?? null;
    this.#fallbackApiUrl = fallback === null || fallback === this.#apiUrl ? null : fallback;
    this.#anonKey = opts.anonKey;
    this.#now = opts.now ?? (() => Date.now());
    this.#refresh = opts.refresh ?? ((token) => this.#postRefresh(token));
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#fetch = opts.fetch;
  }

  /** Null once signed out. The UI reads this to decide between the console and "tap the link again". */
  get session(): Session | null {
    return this.#session;
  }

  get signedOut(): boolean {
    return this.#session === null;
  }

  /** True when the local clock has been shown to disagree with the server. Reviewable, not hidden. */
  get localClockUntrusted(): boolean {
    return this.#localClockUntrusted;
  }

  /** Drops the session. Idempotent. */
  signOut(): void {
    this.#session = null;
    this.#inFlight = null;
  }

  /**
   * A usable access token, or a thrown error: SessionExpiredError when the session is over,
   * RenewalUnavailableError when it is kept but could not be renewed just now. There is no
   * `null` outcome, deliberately: a caller that could receive `null` here would write
   * `if (token)` and skip the request silently.
   */
  async accessToken(): Promise<string> {
    return (await this.#resolveToken()).token;
  }

  /**
   * The token for ONE request and whether it is a KEPT one (FG-3). The flag belongs to the request it was
   * resolved for: authedFetch reads it for that request's 401 and nothing else does.
   */
  async #resolveToken(): Promise<{ readonly token: string; readonly kept: boolean }> {
    const current = this.#session;
    if (current === null) {
      throw new SessionExpiredError('there is no session -- tap the link again');
    }
    if (this.#localClockUntrusted || !expired(current, this.#now(), REFRESH_SKEW_SECONDS)) {
      return { token: current.accessToken, kept: false };
    }
    // A 429 was answered a moment ago: send nothing, and let the rules for "kept" decide.
    if (this.#cooldownOpen()) return this.#keptToken('a refresh was answered with a 429 less than a minute ago');
    try {
      const renewed = await this.#refreshOnce(current);
      return { token: renewed.accessToken, kept: false };
    } catch (e) {
      if (e instanceof RenewalUnavailableError) return this.#keptToken(e.message);
      throw e;
    }
  }

  /**
   * The old token if it still has more than KEEP_TOKEN_SECONDS left by the local clock, measured
   * now, and the server has not already refused it with a 401; otherwise RenewalUnavailableError.
   * Never signs out. A session dropped meanwhile (a 401 on another call) is the session being over,
   * not "kept".
   */
  #keptToken(why: string): { readonly token: string; readonly kept: true } {
    const kept = this.#session;
    if (kept === null) throw new SessionExpiredError('there is no session -- tap the link again');
    if (kept.accessToken !== this.#spentKeptToken && secondsUntilExpiry(kept, this.#now()) > KEEP_TOKEN_SECONDS) {
      return { token: kept.accessToken, kept: true };
    }
    throw new RenewalUnavailableError(`could not renew the session just now; it is kept: ${why}`);
  }

  #cooldownOpen(): boolean {
    const from = this.#cooldownFrom;
    if (from === null) return false;
    const age = this.#now() - from;
    // A clock that moved BACKWARDS ends the cooldown. It never extends it.
    if (age < 0 || age >= REFRESH_COOLDOWN_MS) {
      this.#cooldownFrom = null;
      return false;
    }
    return true;
  }

  #stickyOpen(): boolean {
    const at = this.#primaryFailedAt;
    if (at === null) return false;
    const age = this.#now() - at;
    if (age < 0 || age >= STICKY_WINDOW_MS) {
      this.#primaryFailedAt = null;
      return false;
    }
    return true;
  }

  /** The origins for ONE send, in order, and the callback that opens the window when the Worker went first and failed. */
  #sendOptions(): FallbackOptions {
    const fallback = this.#fallbackApiUrl;
    if (fallback === null) return { origins: [this.#apiUrl], ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }) };
    const workerFirst = !this.#stickyOpen();
    return {
      origins: workerFirst ? [this.#apiUrl, fallback] : [fallback, this.#apiUrl],
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
      onPrimaryFailed: () => {
        // Only a failure of the WORKER, going first, opens the window. The direct origin failing inside
        // the window does not restart it, and (FG-8) neither does a Worker failure recorded while the window
        // is already open: a call that started Worker-first before it opened and failed after must not push
        // the end out. Checked at the moment of failure, not at the start of the call.
        if (workerFirst && !this.#stickyOpen()) this.#primaryFailedAt = this.#now();
      },
    };
  }

  /**
   * An authenticated request against PostgREST, with the token resolved FIRST.
   *
   * Order matters. Resolving the token before the request means an unrenewable
   * session stops the write before it is sent, rather than after the server has
   * already rejected it -- and a 401 that arrives anyway never hands back a Response the
   * caller might read as success: it throws. The 401 handling applies to whichever origin answered.
   * RESTATED 2026-10-03 (FG-3): "a 401 that arrives anyway drops the session and throws" was true of
   * every token. It is true of a token that was not kept. A 401 on a KEPT token throws
   * RenewalUnavailableError and keeps the session (see the header). The old text, kept: "a 401 that arrives
   * anyway drops the session and throws rather than handing back a Response the caller might read as
   * success." (2026-09-08)
   */
  async authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const { token, kept } = await this.#resolveToken();
    const headers = new Headers(init.headers ?? {});
    headers.set('apikey', this.#anonKey);
    headers.set('Authorization', `Bearer ${token}`);

    const res = await fetchWithFallback(`/rest/v1/${path.replace(/^\/+/, '')}`, { ...init, headers }, this.#sendOptions());

    if (res.status === 401) {
      // A KEPT token's 401 is not the session ending: the refresh token was never refused (FG-3). This
      // request's own flag decides, never a holder field, so a refresh that succeeded meanwhile (the
      // session now holds a NEW token) is left alone. The token is spent, and nothing was written.
      if (kept) {
        this.#spentKeptToken = token;
        throw new RenewalUnavailableError('the server refused the kept access token with 401; the session is kept', 401);
      }
      // The server is the authority on expiry and it has just spoken. Whatever
      // the local clock thought, a token that was not kept is over, and so is this session.
      // RESTATED 2026-10-03 (FG-3): this comment said "Whatever the local clock thought, this session is
      // over." It is over for a token that was not kept; a kept token's 401 is handled above.
      this.signOut();
      throw new SessionExpiredError('the server refused the session with 401 -- tap the link again');
    }
    return res;
  }

  /** SINGLE FLIGHT. Concurrent callers share one refresh; they never start a second. */
  async #refreshOnce(current: Session): Promise<Session> {
    const existing = this.#inFlight;
    if (existing !== null) return existing;

    const attempt = this.#doRefresh(current)
      .then((next) => {
        this.#session = next;
        if (expired(next, this.#now(), REFRESH_SKEW_SECONDS)) {
          // A token the server minted seconds ago cannot really be expiring.
          this.#localClockUntrusted = true;
        }
        return next;
      })
      .catch((e: unknown) => {
        if (e instanceof RenewalUnavailableError) {
          // "NOT NOW": the session is KEPT. Only a 429 sets a cooldown; nothing else does.
          if (e.status === 429) this.#cooldownFrom = this.#now();
          throw e;
        }
        this.signOut();
        throw e;
      })
      .finally(() => {
        this.#inFlight = null;
      });

    this.#inFlight = attempt;
    return attempt;
  }

  async #doRefresh(current: Session): Promise<Session> {
    let lastTransportError: unknown = null;
    for (let attempt = 1; attempt <= REFRESH_ATTEMPTS; attempt += 1) {
      let body: unknown;
      try {
        body = await this.#refresh(current.refreshToken);
      } catch (e) {
        // AN ANSWER IS NOT A TRANSPORT FAILURE, and this branch is where the two
        // were conflated when this class was first written: the transport throws
        // on a refusal too, so a 400 "Refresh token is not valid" would have
        // been retried three times with backoff -- precisely the dead-session-
        // becomes-a-spinner behaviour the header claims to avoid. A
        // MalformedTokenError means the server ANSWERED; it is never retried.
        if (e instanceof MalformedTokenError) {
          // THE CLASSIFICATION (R-2026-10-02-FF FF-2 a), reading NUMBERS and never message text.
          // NOT NOW keeps the session: the refresh token has not been refused. Everything else
          // that answered is REFUSED and ends it, including a MalformedTokenError that carries no
          // status (the injected-transport tests in auth_session.test.ts rely on that).
          const { status, refused } = e as MalformedTokenError & AnswerDetail;
          if (status !== undefined && (refused === true || status === 429 || status === 409 || status >= 500)) {
            throw new RenewalUnavailableError(`the auth server said not now (HTTP ${status}): ${e.message}`, status);
          }
          throw new SessionExpiredError(
            `the auth server would not renew the session -- tap the link again: ${e.message}`,
          );
        }
        // THE SERVER NEVER ANSWERED (nor, with a second origin, did the second). This is the only
        // thing worth retrying, and only a bounded number of times, with jitter so a ward full of
        // reconnecting handsets does not arrive in lockstep.
        lastTransportError = e;
        if (attempt < REFRESH_ATTEMPTS) {
          await this.#sleep(refreshBackoffMs(attempt, Math.random()));
          continue;
        }
        // Not an answer, so not a refusal: the session is KEPT (FF-2). OriginsUnreachableError is
        // one such cause; a bare transport failure is the other.
        throw new RenewalUnavailableError(
          `could not reach the auth server to renew the session after ${REFRESH_ATTEMPTS} attempts: ${
            lastTransportError instanceof OriginsUnreachableError ? lastTransportError.message : String(lastTransportError)
          }`,
          null,
        );
      }

      try {
        return sessionFromTokens(body);
      } catch (e) {
        // THE SERVER ANSWERED with something that is not a session. Terminal: refused or unreadable.
        if (e instanceof MalformedTokenError) {
          throw new SessionExpiredError(`the auth server would not renew the session -- tap the link again: ${e.message}`);
        }
        throw e;
      }
    }
    /* c8 ignore next */
    throw new SessionExpiredError('the refresh loop ended without a result -- tap the link again');
  }

  /**
   * The real transport.
   *
   * ASSERT THE EXACT SIGNAL, NEVER A NEGATION. A non-2xx is not read as "some
   * failure"; the body is kept and reported, because GoTrue answers an invalid
   * refresh token with HTTP 400 and `{"error_code":"validation_failed",
   * "msg":"Refresh token is not valid"}` -- probed on v2.196.0, 2026-09-11, NOT
   * the 401 one would guess. A probe whose pass condition is "not 200" would
   * have been satisfied by a network error too.
   */
  async #postRefresh(refreshToken: string): Promise<unknown> {
    const res = await fetchWithFallback(
      `/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: {
          apikey: this.#anonKey,
          Authorization: `Bearer ${this.#anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      },
      this.#sendOptions(),
    );
    const text = await res.text();
    if (!res.ok) {
      // A MalformedTokenError specifically, because that type is what
      // #doRefresh reads to tell an ANSWER from a transport failure. A bare
      // Error here would be retried, which is the defect noted there. The STATUS and whether the
      // Worker marked the answer `refused` travel with it, so #doRefresh classifies by number.
      throw Object.assign(
        new MalformedTokenError(`the auth server refused the refresh with HTTP ${res.status}: ${text.slice(0, 200)}`),
        { status: res.status, refused: res.headers.get(PROXY_HEADER) === 'refused' },
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new MalformedTokenError(`the auth server returned a non-JSON body for a refresh: ${text.slice(0, 200)}`);
    }
  }
}
