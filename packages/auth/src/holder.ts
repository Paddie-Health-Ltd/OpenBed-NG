import { MalformedTokenError, expired, sessionFromTokens, type Session } from './session.js';

/**
 * THE STATEFUL HALF: one session, held, refreshed once at a time, and dropped
 * the moment it cannot be renewed.
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
 * error message. Every path out of `accessToken()` is either a usable token or
 * a thrown SessionExpiredError -- there is no third return.
 *
 * NO RETRY LOOP ON A REFUSAL. A refusal is terminal and lands in exactly the
 * same state as expiry: signed out, "tap the link again". Retries are bounded
 * and apply ONLY to transport failures, where the server never gave an answer
 * at all. Those are different events and conflating them is how a dead session
 * turns into a spinner.
 */

/** Thrown for every unusable-session outcome. One terminal state, one message for the UI. */
export class SessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

/** The refresh call, injectable so the state machine is testable without a network. */
export type RefreshTransport = (refreshToken: string) => Promise<unknown>;

/** A token with less than this left is treated as spent. Flight time, not clock skew. */
export const REFRESH_SKEW_SECONDS = 60;

/** Per the SOP: every external call has a timeout, and 12 seconds is the ceiling. */
export const REFRESH_TIMEOUT_MS = 12_000;

/** Transport failures only. A refusal is never retried. */
const MAX_TRANSPORT_ATTEMPTS = 3;

interface HolderOptions {
  apiUrl: string;
  anonKey: string;
  session: Session;
  /** Injectable for tests. Milliseconds since the epoch. */
  now?: () => number;
  /** Injectable for tests. Defaults to a real POST against GoTrue. */
  refresh?: RefreshTransport;
  /** Injectable for tests, so a backoff does not make the suite slow. */
  sleep?: (ms: number) => Promise<void>;
}

export class SessionHolder {
  #session: Session | null;
  readonly #apiUrl: string;
  readonly #anonKey: string;
  readonly #now: () => number;
  readonly #refresh: RefreshTransport;
  readonly #sleep: (ms: number) => Promise<void>;
  #inFlight: Promise<Session> | null = null;
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
    this.#anonKey = opts.anonKey;
    this.#now = opts.now ?? (() => Date.now());
    this.#refresh = opts.refresh ?? ((token) => this.#postRefresh(token));
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
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
   * A usable access token, or a thrown SessionExpiredError. There is no third
   * outcome, deliberately: a caller that could receive `null` here would write
   * `if (token)` and skip the request silently.
   */
  async accessToken(): Promise<string> {
    const current = this.#session;
    if (current === null) {
      throw new SessionExpiredError('there is no session -- tap the link again');
    }
    if (this.#localClockUntrusted || !expired(current, this.#now(), REFRESH_SKEW_SECONDS)) {
      return current.accessToken;
    }
    const renewed = await this.#refreshOnce(current);
    return renewed.accessToken;
  }

  /**
   * An authenticated request against PostgREST, with the token resolved FIRST.
   *
   * Order matters. Resolving the token before the request means an unrenewable
   * session stops the write before it is sent, rather than after the server has
   * already rejected it -- and a 401 that arrives anyway drops the session and
   * throws rather than handing back a Response the caller might read as
   * success.
   */
  async authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.accessToken();
    const headers = new Headers(init.headers ?? {});
    headers.set('apikey', this.#anonKey);
    headers.set('Authorization', `Bearer ${token}`);

    const res = await fetch(`${this.#apiUrl}/rest/v1/${path.replace(/^\/+/, '')}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });

    if (res.status === 401) {
      // The server is the authority on expiry and it has just spoken. Whatever
      // the local clock thought, this session is over.
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
    for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
      let body: unknown;
      try {
        body = await this.#refresh(current.refreshToken);
      } catch (e) {
        // AN ANSWER IS NOT A TRANSPORT FAILURE, and this branch is where the two
        // were conflated when this class was first written: the transport throws
        // on a refusal too, so a 400 "Refresh token is not valid" would have
        // been retried three times with backoff -- precisely the dead-session-
        // becomes-a-spinner behaviour the header claims to avoid. A
        // MalformedTokenError means the server ANSWERED; it is terminal here.
        if (e instanceof MalformedTokenError) {
          throw new SessionExpiredError(
            `the auth server would not renew the session -- tap the link again: ${e.message}`,
          );
        }
        // THE SERVER NEVER ANSWERED. This is the only thing worth retrying, and
        // only a bounded number of times, with jitter so a ward full of
        // reconnecting handsets does not arrive in lockstep.
        lastTransportError = e;
        if (attempt < MAX_TRANSPORT_ATTEMPTS) {
          await this.#sleep(2 ** (attempt - 1) * 250 + Math.random() * 250);
          continue;
        }
        throw new SessionExpiredError(
          `could not reach the auth server to renew the session after ${MAX_TRANSPORT_ATTEMPTS} attempts -- tap the link again: ${String(lastTransportError)}`,
        );
      }

      try {
        return sessionFromTokens(body);
      } catch (e) {
        // THE SERVER ANSWERED AND REFUSED, or answered with something
        // unreadable. Terminal either way: retrying a refusal is how a dead
        // session becomes a spinner.
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
    const res = await fetch(`${this.#apiUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        apikey: this.#anonKey,
        Authorization: `Bearer ${this.#anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      // A MalformedTokenError specifically, because that type is what
      // #doRefresh reads to tell an ANSWER from a transport failure. A bare
      // Error here would be retried, which is the defect noted there.
      throw Object.assign(
        new MalformedTokenError(`the auth server refused the refresh with HTTP ${res.status}: ${text.slice(0, 200)}`),
        { status: res.status },
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new MalformedTokenError(`the auth server returned a non-JSON body for a refresh: ${text.slice(0, 200)}`);
    }
  }
}
