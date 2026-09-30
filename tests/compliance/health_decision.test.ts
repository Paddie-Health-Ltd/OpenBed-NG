import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';
import {
  HEALTH_FAIL,
  HEALTH_OK,
  SNAPSHOT_JOB,
  decideHealth,
  type HealthReason,
  type ProbeInput,
} from '../../packages/snapshot/src/health.js';

/**
 * THE HEALTH DECISION (R-2026-09-29-173 EW-2 c, d, g): /api/health answers 200 or 503 from
 * one read of the database's scheduler status, and this file holds the pure decision to the
 * ruling, reason by reason.
 *
 * EVERY PLANT IS THE FRESH BASELINE WITH ONE FIELD CHANGED. The baseline is asserted 200
 * inside each case, so a plant that "fails" because the baseline itself is broken cannot
 * pass as a plant. Each case then asserts its EXACT reasons, not merely a status: an
 * always-503 decision passes every 503 case's status and fails every 200 case, and an
 * always-200 decision is the reverse, so the 503 cases are shown red against the first
 * and the 200 cases against the second (scripts/neuter.sh, run when this file was written).
 *
 * THE BOUNDARY IS THE BANNER'S. Every boundary below is computed from
 * snapshot-shape.json's freshnessBands.snapshotBannerAfterMinutes, the number the public
 * page's banner reads through snapshotAge (freshness.ts's BANDS is that same object). A
 * literal 180 here would keep passing after the banner moved, which is precisely the
 * disagreement between the alarm and the page this decision exists to prevent.
 *
 * THE PARSED LEG. `healthCallsSnapshotAge` reads packages/snapshot/src/health.ts as
 * TypeScript and asks whether it CALLS snapshotAge with a literal 0 for the elapsed term.
 * It does not grep: a comment or a string that says "snapshotAge(" is prose, not a call
 * (test-conventions.md §2 (a)), and PLANT legs prove that.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - the timeout's wall time. This decision is pure and takes no time; a timeout is an
 *     INPUT to it (`failed`, why `timeout`). That a probe which never answers becomes a 503
 *     inside one second is tests/compliance/health_served.test.ts, where a fetch can be made
 *     to hang.
 *   - that the migration's function returns this shape. tests/db/health_probe.test.ts feeds
 *     the real function's output to this decision.
 */

const BANNER_MINUTES: number = SHAPE.freshnessBands.snapshotBannerAfterMinutes;
const BANNER_S = BANNER_MINUTES * 60;

const SERVER_NOW = '2026-09-30T04:00:00.000+00:00';
const ago = (seconds: number): string => new Date(Date.parse(SERVER_NOW) - seconds * 1000).toISOString();

interface Job {
  name: string;
  active: boolean;
  last_status: string | null;
  last_start_time: string | null;
}
interface Body {
  server_now: string | undefined;
  generated_at: string | null;
  last_snapshot_at: string | null;
  jobs: Job[] | unknown;
}

const job = (name: string, over: Partial<Job> = {}): Job => ({
  name,
  active: true,
  last_status: 'succeeded',
  last_start_time: ago(60),
  ...over,
});

const OTHER_JOBS = ['openbed_refresh_lga_rollup', 'openbed_erase_lapsed_ward_logins', 'openbed_prune_ended_auth_sessions', 'openbed_check_withdrawn_facility_accounts'];

function baselineBody(): Body {
  return {
    server_now: SERVER_NOW,
    generated_at: ago(30),
    last_snapshot_at: ago(30),
    jobs: [job(SNAPSHOT_JOB), ...OTHER_JOBS.map((n) => job(n))],
  };
}
const answered = (body: unknown, status = 200): ProbeInput => ({ outcome: 'answered', status, body });
const baseline = (): ProbeInput => answered(baselineBody());

/** The baseline with `edit` applied to its body. */
function withBody(edit: (b: Body) => void): ProbeInput {
  const b = baselineBody();
  edit(b);
  return answered(b);
}
const snapshotJob = (b: Body): Job => (b.jobs as Job[]).find((j) => j.name === SNAPSHOT_JOB) as Job;

type Case = [label: string, probe: () => ProbeInput, status: 200 | 503, reasons: HealthReason[]];

const CASES_200: Case[] = [
  ['the fresh baseline', baseline, 200, []],
  [`one second under the banner (${BANNER_MINUTES} minutes) is still 200`, () => withBody((b) => { b.generated_at = ago(BANNER_S - 1); }), 200, []],
  ['the snapshot job\'s last finished run FAILED: one failure is not an alarm', () => withBody((b) => { snapshotJob(b).last_status = 'failed'; }), 200, []],
  ['the snapshot job\'s last run is "running"', () => withBody((b) => { snapshotJob(b).last_status = 'running'; }), 200, []],
  ['the snapshot job\'s last run is "starting"', () => withBody((b) => { snapshotJob(b).last_status = 'starting'; }), 200, []],
  ['the snapshot job has no run in the lookup window at all', () => withBody((b) => { snapshotJob(b).last_status = null; snapshotJob(b).last_start_time = null; }), 200, []],
  [
    'the rollup job inactive and a retention job\'s last run failed: those jobs are the operator\'s, not the public alarm\'s',
    () =>
      withBody((b) => {
        for (const j of b.jobs as Job[]) {
          if (j.name === 'openbed_refresh_lga_rollup') j.active = false;
          if (j.name === 'openbed_erase_lapsed_ward_logins') j.last_status = 'failed';
        }
      }),
    200,
    [],
  ],
];

const CASES_503: Case[] = [
  [`exactly at the banner (${BANNER_MINUTES} minutes) is 503`, () => withBody((b) => { b.generated_at = ago(BANNER_S); }), 503, ['snapshot_stale']],
  ['one second past the banner is 503', () => withBody((b) => { b.generated_at = ago(BANNER_S + 1); }), 503, ['snapshot_stale']],
  ['generated_at NULL (no snapshot at all) is 503', () => withBody((b) => { b.generated_at = null; }), 503, ['snapshot_stale']],
  ['generated_at that cannot be parsed is 503', () => withBody((b) => { b.generated_at = 'not a time'; }), 503, ['snapshot_stale']],
  ['the snapshot job row is absent', () => withBody((b) => { b.jobs = (b.jobs as Job[]).filter((j) => j.name !== SNAPSHOT_JOB); }), 503, ['job_absent']],
  ['no jobs at all', () => withBody((b) => { b.jobs = []; }), 503, ['job_absent']],
  ['the snapshot job is inactive', () => withBody((b) => { snapshotJob(b).active = false; }), 503, ['job_inactive']],
  [
    'stale AND inactive: both reasons, in a fixed order',
    () => withBody((b) => { b.generated_at = ago(BANNER_S + 1); snapshotJob(b).active = false; }),
    503,
    ['snapshot_stale', 'job_inactive'],
  ],
  ['the probe answered 401', () => answered({ message: 'Invalid API key' }, 401), 503, ['probe_failed']],
  ['the probe answered 404 (the function does not exist)', () => answered({ code: 'PGRST202' }, 404), 503, ['probe_failed']],
  ['the probe answered 500', () => answered(null, 500), 503, ['probe_failed']],
  // The status check must stand on its own: a refusal that happens to carry the full status
  // shape (a proxy in the middle, a cached body) is still no answer.
  ['the probe answered 401 carrying a body of exactly the right shape', () => answered(baselineBody(), 401), 503, ['probe_failed']],
  ['the probe answered 404 carrying a body of exactly the right shape', () => answered(baselineBody(), 404), 503, ['probe_failed']],
  ['the probe answered 204 carrying a body of exactly the right shape', () => answered(baselineBody(), 204), 503, ['probe_failed']],
  ['the probe answered 200 with an empty array', () => answered([]), 503, ['probe_failed']],
  ['the probe answered 200 with null', () => answered(null), 503, ['probe_failed']],
  ['the probe answered 200 with a string', () => answered('ok'), 503, ['probe_failed']],
  ['the probe answered 200 with JSON of the wrong shape', () => answered({ jobs: 'none' }), 503, ['probe_failed']],
  ['the probe answered 200 with no server_now: no clock, no age', () => withBody((b) => { b.server_now = undefined; }), 503, ['probe_failed']],
  ['the probe answered 200 with a jobs entry that is not an object', () => withBody((b) => { b.jobs = [...(b.jobs as Job[]), 'x']; }), 503, ['probe_failed']],
  ['the probe answered 200 with a job whose active is not a boolean', () => withBody((b) => { (snapshotJob(b) as unknown as { active: unknown }).active = 'true'; }), 503, ['probe_failed']],
  ['the answer was not JSON', () => ({ outcome: 'failed', why: 'non_json' }), 503, ['probe_failed']],
  ['the credential is missing', () => ({ outcome: 'failed', why: 'missing_key' }), 503, ['probe_failed']],
  ['the probe timed out', () => ({ outcome: 'failed', why: 'timeout' }), 503, ['probe_failed']],
  ['the origin could not be reached', () => ({ outcome: 'failed', why: 'network' }), 503, ['probe_failed']],
];

describe('the health decision', () => {
  test.each([...CASES_200, ...CASES_503])('plant — %s', (_label, probe, status, reasons) => {
    // The baseline is 200 or the plant below it proves nothing.
    expect(decideHealth(baseline()).status, 'the fresh baseline is not 200; every plant below is meaningless').toBe(200);
    const d = decideHealth(probe());
    expect({ status: d.status, reasons: d.reasons }).toEqual({ status, reasons });
    expect(d.ok).toBe(status === 200);
    expect(d.body.ok).toBe(status === 200);
    expect(d.body.reasons).toEqual(reasons);
  });

  test('the two lists exercise both outcomes, so an always-200 or always-503 decision fails one of them', () => {
    expect(CASES_200.length).toBeGreaterThan(0);
    expect(CASES_503.length).toBeGreaterThan(0);
    expect(new Set(CASES_503.flatMap((c) => c[3]))).toEqual(new Set(['snapshot_stale', 'job_absent', 'job_inactive', 'probe_failed']));
  });

  test('real baseline body carries the keyword, the age, the database\'s own clock and ONE job', () => {
    const d = decideHealth(baseline());
    expect(d.body.health).toBe(HEALTH_OK);
    expect(d.body.snapshot_age_s).toBe(30);
    expect(d.body.checked_at).toBe(SERVER_NOW);
    expect(d.body.job).toEqual({ name: SNAPSHOT_JOB, active: true, last_status: 'succeeded', last_start_time: ago(60) });
  });

  test('the body\'s keys are exactly the ruled ones, and no other job is named', () => {
    for (const probe of [baseline(), withBody((b) => { snapshotJob(b).active = false; }), answered(null, 401)]) {
      const text = JSON.stringify(decideHealth(probe).body);
      expect(Object.keys(JSON.parse(text)).sort()).toEqual(['checked_at', 'health', 'job', 'ok', 'reasons', 'snapshot_age_s']);
      for (const other of OTHER_JOBS) expect(text, `the public body names ${other}`).not.toContain(other);
    }
  });

  test('the keyword a monitor checks appears on a 200 and never on a 503', () => {
    for (const [, probe, status] of [...CASES_200, ...CASES_503]) {
      const text = JSON.stringify(decideHealth(probe()).body);
      if (status === 200) expect(text).toContain(HEALTH_OK);
      else {
        expect(text, 'a 503 body carries the OK keyword').not.toContain(HEALTH_OK);
        expect(text).toContain(HEALTH_FAIL);
      }
    }
    expect(HEALTH_OK).not.toContain(HEALTH_FAIL);
    expect(HEALTH_FAIL).not.toContain(HEALTH_OK);
  });

  test('a failed probe reports no age and no checked_at, because it measured nothing', () => {
    const d = decideHealth(answered(null, 404));
    expect(d.body.snapshot_age_s).toBeNull();
    expect(d.body.checked_at).toBeNull();
    expect(d.body.job).toBeNull();
  });

  test('the age is reported for a stale snapshot, on the database\'s clock', () => {
    const d = decideHealth(withBody((b) => { b.generated_at = ago(BANNER_S + 1); }));
    expect(d.body.snapshot_age_s).toBe(BANNER_S + 1);
  });
});

/**
 * THE PARSED LEG. Returns the violations; empty means health.ts CALLS snapshotAge with a
 * literal 0 for the elapsed term (the alarm has no client-side elapsed time, so anything
 * else would be a second clock).
 */
function healthCallsSnapshotAge(source: string): string[] {
  if (source.trim() === '') return ['the source is empty: there is nothing to have called snapshotAge'];
  const sf = ts.createSourceFile('health.ts', source, ts.ScriptTarget.Latest, true);
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'snapshotAge') calls.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (calls.length === 0) return ['snapshotAge is never CALLED (a comment or a string that names it is prose, not a call)'];
  const problems: string[] = [];
  for (const c of calls) {
    const third = c.arguments[2];
    if (c.arguments.length !== 3 || !third || !ts.isNumericLiteral(third) || third.text !== '0') {
      problems.push('snapshotAge is called, but not as snapshotAge(generated_at, server_now, 0)');
    }
  }
  const imported = sf.statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text === './freshness.js' &&
      s.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some((e) => e.name.text === 'snapshotAge'),
  );
  if (!imported) problems.push('snapshotAge is not imported from ./freshness.js, the function the public banner uses');
  return problems;
}

describe('the decision uses the banner\'s own age function', () => {
  const REAL = readFileSync(join(REPO_ROOT, 'packages', 'snapshot', 'src', 'health.ts'), 'utf8');

  test('real health.ts is accepted', () => {
    expect(healthCallsSnapshotAge(REAL), 'health.ts no longer calls snapshotAge(generated_at, server_now, 0)').toEqual([]);
  });

  test('plant — snapshotAge named only in a comment and a string is rejected', () => {
    const planted = `import { snapshotAge } from './freshness.js';\n// snapshotAge(a, b, 0)\nexport const s = 'snapshotAge(a, b, 0)';\n`;
    expect(healthCallsSnapshotAge(planted).join('; ')).toContain('never CALLED');
  });

  test('plant — a hand-rolled threshold instead of the banner\'s function is rejected', () => {
    const planted = `export const stale = (a: number, b: number): boolean => (b - a) / 60000 >= 3;\n`;
    expect(healthCallsSnapshotAge(planted).join('; ')).toContain('never CALLED');
  });

  test('plant — snapshotAge called with a client-side elapsed term is rejected', () => {
    const planted = `import { snapshotAge } from './freshness.js';\nexport const f = (g: string, n: string, e: number) => snapshotAge(g, n, e);\n`;
    expect(healthCallsSnapshotAge(planted).join('; ')).toContain('not as snapshotAge(generated_at, server_now, 0)');
  });

  test('plant — snapshotAge from somewhere other than freshness is rejected', () => {
    const planted = `import { snapshotAge } from './mine.js';\nexport const f = (g: string, n: string) => snapshotAge(g, n, 0);\n`;
    expect(healthCallsSnapshotAge(planted).join('; ')).toContain('not imported from ./freshness.js');
  });

  test('anti-vacuity — checker over an empty corpus fails', () => {
    expect(healthCallsSnapshotAge('')).not.toEqual([]);
    expect(healthCallsSnapshotAge('   \n')).not.toEqual([]);
    expect(REAL.length, 'health.ts was read as empty').toBeGreaterThan(0);
  });
});
