/**
 * THE HEALTH DECISION -- pure. No fetch, no cache, no clock (R-2026-09-29-173 EW-2 c).
 *
 * /api/health exists so that something OUTSIDE both Supabase and Cloudflare can tell the
 * founder that the snapshot job has stopped. The public page already degrades honestly
 * (greyed rows and a banner from 3 minutes); nothing reached a person. This module
 * decides, from one read of the database's own scheduler status, whether to answer 200
 * or 503. Everything that touches the network lives in health_serve.ts.
 *
 * ONE CLOCK, AND IT IS THE DATABASE'S. The age is `snapshotAge(generated_at, server_now,
 * 0)`, the function the public banner uses, over two timestamps that BOTH came from
 * Postgres in the same call. This module and its caller read no wall clock, so the
 * eslint no-wall-clock exemptions stay at two, and the alarm cannot disagree with the
 * banner about how old the snapshot is or where "too old" begins: the threshold is the
 * banner's (BANDS.snapshotBannerAfterMinutes, through snapshotAge), not a second number.
 *
 * THE REASONS, and what is deliberately not one:
 *   snapshot_stale -- the age is at or past the banner threshold, or generated_at is
 *                     null (no snapshot at all is not fresh), or it cannot be parsed.
 *   job_absent     -- no pg_cron job named openbed_regenerate_snapshot.
 *   job_inactive   -- that job exists and is switched off.
 *   probe_failed   -- the probe did not produce a usable answer: an error, a timeout, a
 *                     refusal (401, 404 or any status but 200), an empty array, null,
 *                     something that is not JSON, a missing credential, or JSON of the
 *                     wrong shape. When the probe failed nothing else is evaluated,
 *                     because nothing else is known.
 * A FAILED LAST RUN IS NOT A REASON. One transient failure would alarm while the public
 * page shows no banner. Repeated failure stops new snapshots, the age passes the
 * threshold, and snapshot_stale catches it. The last finished status is in the body for
 * whoever looks.
 *
 * THE BODY carries ages and ONE job name, nothing else. The other four jobs are the
 * operator's, not the public's. The keyword an uptime monitor checks is the string in
 * `health`: the SPA answers an unknown path with 200 and HTML, so a status check alone
 * reads green forever, and the keyword is what a fallback cannot fake.
 *
 * NOT ASSERTED HERE, deliberately: that the database's job actually ran, only that the
 * newest snapshot row is young and the job is present and active. A job that is active
 * and failing every run reads 503 through the age, after the banner threshold.
 */
import { snapshotAge } from './freshness.js';

export const SNAPSHOT_JOB = 'openbed_regenerate_snapshot';

/** What the monitor's keyword check reads. Neither string contains the other. */
export const HEALTH_OK = 'openbed-ok';
export const HEALTH_FAIL = 'openbed-fail';

export type HealthReason = 'snapshot_stale' | 'job_absent' | 'job_inactive' | 'probe_failed';

/**
 * What the caller observed of the probe. Two shapes, so that "the probe answered" and
 * "the probe could not answer" cannot be confused at a call site:
 *   answered -- the HTTP status, and the parsed JSON body (any JSON value).
 *   failed   -- it never produced a status and a body, and why.
 */
export type ProbeInput =
  | { readonly outcome: 'answered'; readonly status: number; readonly body: unknown }
  | { readonly outcome: 'failed'; readonly why: 'missing_key' | 'timeout' | 'network' | 'non_json' };

export interface HealthJob {
  readonly name: string;
  readonly active: boolean;
  readonly last_status: string | null;
  readonly last_start_time: string | null;
}

export interface HealthBody {
  readonly ok: boolean;
  readonly health: typeof HEALTH_OK | typeof HEALTH_FAIL;
  readonly reasons: readonly HealthReason[];
  /** Whole seconds, on the database's clock; null when there is no measurable age. */
  readonly snapshot_age_s: number | null;
  /** The database's own `server_now`; null when the probe failed. */
  readonly checked_at: string | null;
  /** The snapshot job only; null when it is absent or the probe failed. */
  readonly job: HealthJob | null;
}

export interface HealthDecision {
  readonly ok: boolean;
  readonly status: 200 | 503;
  readonly reasons: readonly HealthReason[];
  readonly body: HealthBody;
}

interface Status {
  readonly server_now: string;
  readonly generated_at: string | null;
  readonly jobs: readonly HealthJob[];
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * The probe's JSON, checked before any of it is trusted. Returns null for anything
 * that is not exactly the shape scheduler_status() returns, including a missing or
 * unparseable server_now: without the database's clock there is no age, and an
 * unmeasurable age must not read as either fresh or stale, it reads as a failed probe.
 */
function readStatus(body: unknown): Status | null {
  if (!isRecord(body)) return null;
  const { server_now: serverNow, generated_at: generatedAt, jobs } = body;
  if (typeof serverNow !== 'string' || Number.isNaN(Date.parse(serverNow))) return null;
  if (generatedAt !== null && typeof generatedAt !== 'string') return null;
  if (!Array.isArray(jobs)) return null;
  const out: HealthJob[] = [];
  for (const j of jobs as unknown[]) {
    if (!isRecord(j) || typeof j.name !== 'string' || typeof j.active !== 'boolean') return null;
    const status = j.last_status ?? null;
    const started = j.last_start_time ?? null;
    if ((status !== null && typeof status !== 'string') || (started !== null && typeof started !== 'string')) return null;
    out.push({ name: j.name, active: j.active, last_status: status, last_start_time: started });
  }
  return { server_now: serverNow, generated_at: generatedAt as string | null, jobs: out };
}

function decision(
  reasons: readonly HealthReason[],
  parts: { snapshot_age_s: number | null; checked_at: string | null; job: HealthJob | null },
): HealthDecision {
  const ok = reasons.length === 0;
  return {
    ok,
    status: ok ? 200 : 503,
    reasons,
    body: { ok, health: ok ? HEALTH_OK : HEALTH_FAIL, reasons, ...parts },
  };
}

const PROBE_FAILED = (): HealthDecision =>
  decision(['probe_failed'], { snapshot_age_s: null, checked_at: null, job: null });

export function decideHealth(probe: ProbeInput): HealthDecision {
  if (probe.outcome === 'failed') return PROBE_FAILED();
  // Only a 200 is an answer. 401 and 404 are the refusals this endpoint is most likely to
  // meet (a rotated key, an unapplied migration); any other status is no answer either.
  if (probe.status !== 200) return PROBE_FAILED();
  const status = readStatus(probe.body);
  if (status === null) return PROBE_FAILED();

  const reasons: HealthReason[] = [];

  let ageSeconds: number | null = null;
  if (status.generated_at === null) {
    reasons.push('snapshot_stale');
  } else {
    const age = snapshotAge(status.generated_at, status.server_now, 0);
    if (age.stale) reasons.push('snapshot_stale');
    if (age.known) ageSeconds = Math.round(age.ageMinutes * 60);
  }

  const job = status.jobs.find((j) => j.name === SNAPSHOT_JOB) ?? null;
  if (job === null) reasons.push('job_absent');
  else if (!job.active) reasons.push('job_inactive');

  return decision(reasons, { snapshot_age_s: ageSeconds, checked_at: status.server_now, job });
}
