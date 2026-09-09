import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE CI WORKFLOW'S OWN INVARIANTS.
 *
 * Every assertion here guards something with no runtime symptom. A required check
 * that stops running still reports green; a job that gains
 * `continue-on-error: true` still reports green; a timeout of 1 minute cancels
 * every run and reports `cancelled`, which is not `failure` and is easy to
 * mistake for infrastructure noise.
 *
 * THE FIRST TEST IS THE LOAD-BEARING ONE. GitHub counts a SKIPPED required check
 * as PASSING. So a required check gated on a paths filter reports success on
 * exactly the pull requests it did not examine. This repository therefore
 * paths-filters nothing, and this test is what keeps it that way -- it is the
 * easiest property here to regress, because adding `if:` to a job looks like an
 * optimisation and produces no visible change.
 *
 * Parsed with js-yaml and keyed off JOB NAMES throughout. A `grep -c
 * 'timeout-minutes'` would be complete on the presence axis and blind on two
 * others: VALUE (every timeout could be 1) and IDENTITY (the timeouts could be on
 * the wrong jobs after a rename).
 */

interface Job {
  'timeout-minutes'?: number;
  'continue-on-error'?: boolean;
  if?: string;
  steps?: { run?: string; uses?: string; 'continue-on-error'?: boolean }[];
}
interface Workflow {
  on?: unknown;
  concurrency?: { group?: string; 'cancel-in-progress'?: unknown };
  jobs: Record<string, Job>;
}

const CI_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const raw = readFileSync(CI_PATH, 'utf8');
const ci = yaml.load(raw) as Workflow;

/**
 * The jobs that must be required checks in branch protection. A checked-in
 * literal, deliberately: it decays LOUDLY, because the set comparison below reds
 * the moment a job is added or renamed. That is a feature, not a magic number --
 * adding a job to CI should require someone to decide whether it gates merges.
 */
const EXPECTED_JOBS = [
  'bundle-guards',
  'compliance-tests',
  'db-tests',
  'migration-lint',
  'repo-lint',
  'secret-scan',
];

describe('ci.yml invariants', () => {
  test('the workflow parses to a non-empty job map', () => {
    expect(ci?.jobs, 'ci.yml did not parse into jobs').toBeTruthy();
    expect(Object.keys(ci.jobs).length).toBeGreaterThan(0);
  });

  test('the job set is exactly the expected set', () => {
    expect(Object.keys(ci.jobs).sort()).toEqual(EXPECTED_JOBS);
  });

  test('NO job is conditioned on an `if:` — a skipped required check reads as passing', () => {
    const conditioned = Object.entries(ci.jobs)
      .filter(([, job]) => typeof job.if === 'string')
      .map(([name]) => name);
    expect(
      conditioned,
      'these required checks are conditional, so they report success on the PRs they skip',
    ).toEqual([]);
  });

  test('no job or step carries continue-on-error', () => {
    const offenders: string[] = [];
    for (const [name, job] of Object.entries(ci.jobs)) {
      if (job['continue-on-error']) offenders.push(name);
      for (const [i, step] of (job.steps ?? []).entries()) {
        if (step['continue-on-error']) offenders.push(`${name}#${i}`);
      }
    }
    expect(offenders, 'an advisory security gate is not a gate').toEqual([]);
  });

  test('every job declares a timeout-minutes with a sane value', () => {
    for (const [name, job] of Object.entries(ci.jobs)) {
      const t = job['timeout-minutes'];
      expect(t, `${name} has no timeout-minutes`).toBeTypeOf('number');
      // VALUE axis. A ceiling of 1 cancels every run, and a cancelled job reports
      // `cancelled` rather than `failure` -- which reads as infrastructure noise
      // rather than as a broken gate.
      expect(t, `${name}'s timeout is implausibly short`).toBeGreaterThanOrEqual(5);
      expect(t, `${name}'s timeout is implausibly long`).toBeLessThanOrEqual(60);
    }
  });

  test('timeouts are labelled PROVISIONAL until a cold run has been measured', () => {
    // Clause 5: a present-tense claim carries its probe. This workflow has never
    // run, so no timeout here is an observed maximum. Writing one would be a
    // false fact; labelling them is the honest form.
    const provisional = (raw.match(/PROVISIONAL/g) ?? []).length;
    expect(provisional, 'timeouts claim measurements that do not exist yet').toBeGreaterThanOrEqual(
      Object.keys(ci.jobs).length,
    );
  });

  test('main runs are not cancellable', () => {
    // A cancelled run on main leaves main in an UNKNOWN state, and "unknown" is
    // indistinguishable from "green" to whoever merges next.
    expect(String(ci.concurrency?.['cancel-in-progress'])).toContain("github.ref != 'refs/heads/main'");
  });

  test('workflow_dispatch exists as a recovery lever', () => {
    // A required check that cannot be re-run by hand turns one transient
    // infrastructure failure into a blocked branch.
    expect(JSON.stringify(ci.on)).toContain('workflow_dispatch');
  });

  test('db-tests applies migrations with the house runner, not the CLI', () => {
    // `supabase db reset` would leave an EMPTY schema here, because the CLI's own
    // migration runner is disabled in supabase/config.toml. A job that reset and
    // then tested would assert against nothing.
    const steps = ci.jobs['db-tests']?.steps ?? [];
    const runs = steps.map((s) => s.run ?? '').join('\n');
    expect(runs).toContain('scripts/run_migrations.sh');
    expect(runs).not.toMatch(/supabase db reset/);
  });

  test('bundle-guards builds before it greps', () => {
    // The greps refuse an empty corpus (exit 2), so a missing build fails the job
    // rather than passing it vacuously -- but the ordering is asserted anyway,
    // because relying on a second control to catch a missing first one is how
    // both end up wrong.
    const runs = (ci.jobs['bundle-guards']?.steps ?? []).map((s) => s.run ?? '');
    const buildAt = runs.findIndex((r) => r.includes('npm run build'));
    const grepAt = runs.findIndex((r) => r.includes('lint_no_service_role_in_bundle'));
    expect(buildAt).toBeGreaterThan(-1);
    expect(grepAt).toBeGreaterThan(buildAt);
  });
});

describe('ci gate exceptions', () => {
  const EX_PATH = join(REPO_ROOT, '.ci', 'ci-gate-exceptions.yml');
  const ex = yaml.load(readFileSync(EX_PATH, 'utf8')) as { exceptions: unknown[] };

  test('the exception list exists and is empty', () => {
    expect(Array.isArray(ex.exceptions)).toBe(true);
    expect(
      ex.exceptions,
      'a CI gate has been exempted — every job in ci.yml guards the security boundary or F1/F2/F3',
    ).toEqual([]);
  });

  test('the schema is documented in the file itself', () => {
    const content = readFileSync(EX_PATH, 'utf8');
    for (const field of ['workflow', 'job', 'posture', 'mechanism', 'rationale', 'ticket', 'introduced_by', 'last_assessed_sha']) {
      expect(content, `the ${field} field is undocumented`).toContain(field);
    }
  });
});
