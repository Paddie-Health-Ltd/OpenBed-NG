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

interface Step {
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: { name?: string; path?: string };
  'continue-on-error'?: boolean;
}
interface Job {
  'timeout-minutes'?: number;
  'continue-on-error'?: boolean;
  if?: string;
  steps?: Step[];
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
 * The jobs that must be required checks in branch protection, from
 * packages/fixtures/required-checks.json (R-2026-09-29-171, EU-3 b: one list, which
 * scripts/pr_evidence.mjs also reads). A checked-in literal, deliberately: it decays
 * LOUDLY, because the set comparison below reds the moment a job is added or renamed.
 * That is a feature, not a magic number -- adding a job to CI should require someone to
 * decide whether it gates merges.
 */
const EXPECTED_JOBS = (JSON.parse(readFileSync(join(REPO_ROOT, 'packages', 'fixtures', 'required-checks.json'), 'utf8')) as { jobs: string[] }).jobs;

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

  test('EVERY job labels its timeout PROVISIONAL or MEASURED, and MEASURED cites the observation', () => {
    // Clause 5: a present-tense claim carries its probe. This workflow has never
    // run, so no timeout here is an observed maximum. Writing one would be a
    // false fact; labelling them is the honest form.
    //
    // TIGHTENED 2026-09-10. This was `raw.match(/PROVISIONAL/g).length >= jobCount`
    // -- a whole-file substring count, which is complete on the PRESENCE axis and
    // blind on IDENTITY, the same defect this file's own header calls out about
    // `grep -c 'timeout-minutes'`. The header's own occurrence of the word sat
    // inside the count, so one job could drop its label entirely and the
    // assertion still passed with a spare. Now located per job block.
    const lines = raw.split('\n');
    const starts = new Map<string, number>();
    for (const name of Object.keys(ci.jobs)) {
      const at = lines.findIndex((l) => l === `  ${name}:`);
      expect(at, `could not locate job ${name} in the raw workflow text`).toBeGreaterThan(-1);
      starts.set(name, at);
    }

    const unlabelled: string[] = [];
    for (const [name, start] of starts) {
      // A job block runs to the next line indented by exactly two spaces.
      let end = lines.length;
      for (let i = start + 1; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (/^ {2}\S/.test(line)) {
          end = i;
          break;
        }
      }
      const block = lines.slice(start, end).join('\n');
      // Two honest states, and the label must say which. PROVISIONAL = no run has
      // happened. MEASURED = one has, and the comment must CARRY the observation:
      // a date and an observed duration. `MEASURED` on its own would be the same
      // unbacked present-tense claim the label exists to prevent -- Clause 5, and
      // "a date is not a probe" cuts both ways, so the duration is required too.
      const provisional = block.includes('PROVISIONAL');
      const measured = /MEASURED \d{4}-\d{2}-\d{2}:[^\n]*\b\d+(m\d+)?s\b[^\n]*observed/.test(block);
      if (!provisional && !measured) unlabelled.push(name);
    }
    expect(
      unlabelled,
      'these jobs assert a timeout ceiling with neither a PROVISIONAL caveat nor a cited observation',
    ).toEqual([]);
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

/**
 * THE PROVENANCE STEP (R-2026-09-29-171, EU-2). Each job that uploads a JUnit artefact
 * writes `ci-provenance.txt` beside it: the run's own identifiers, then the raw commit
 * object CI tested. scripts/pr_evidence.mjs binds each artefact to that commit by
 * hashing the object itself, so the step's exact shape is what makes the evidence
 * block's merge line true, and a step that drifts produces an artefact the script must
 * refuse, or worse, one it accepts for the wrong reason.
 *
 * WHAT IS HELD, for each of the three jobs, parsed with js-yaml and keyed off job names:
 *   - exactly one step whose `run` writes `> ci-provenance.txt`;
 *   - it runs `if: always()`, so a red test step still leaves its provenance;
 *   - it sits before the upload, which must name ci-provenance.txt in its `path`;
 *   - its `run` holds `git cat-file -s HEAD`, `git cat-file commit HEAD` and each of
 *     $GITHUB_SHA, $GITHUB_RUN_ID, $GITHUB_RUN_ATTEMPT and $GITHUB_JOB;
 *   - no step's `run` in those jobs holds `${{`. The runner's default variables need no
 *     expression, and an expression in `run:` is the injection form pr_migration_line
 *     refuses for the PR body.
 *
 * NOT ASSERTED HERE, deliberately: that the step's output is right on a real runner.
 * That is observed, not parsed -- by scripts/pr_evidence.mjs on S-c's own head, whose
 * refusals are planted in tests/compliance/pr_evidence.test.ts.
 */
const PROVENANCE_JOBS = ['compliance-tests', 'db-tests', 'golden-path'];
const PROVENANCE_NEEDS = ['git cat-file -s HEAD', 'git cat-file commit HEAD', '$GITHUB_SHA', '$GITHUB_RUN_ID', '$GITHUB_RUN_ATTEMPT', '$GITHUB_JOB'];

export function provenanceViolations(wf: Workflow): string[] {
  const out: string[] = [];
  for (const name of PROVENANCE_JOBS) {
    const steps = wf.jobs?.[name]?.steps ?? [];
    const writers = steps.map((s, i) => ({ s, i })).filter(({ s }) => (s.run ?? '').includes('> ci-provenance.txt'));
    if (writers.length !== 1) {
      out.push(`${name}: ${writers.length} steps write > ci-provenance.txt; exactly one is required`);
      continue;
    }
    const { s: step, i: at } = writers[0] as { s: Step; i: number };
    if (step.if !== 'always()') out.push(`${name}: the provenance step does not run if: always()`);
    const uploadAt = steps.findIndex((s) => (s.uses ?? '').startsWith('actions/upload-artifact@'));
    if (uploadAt === -1) out.push(`${name}: no upload-artifact step`);
    else {
      if (!(at < uploadAt)) out.push(`${name}: the provenance step does not sit before the upload`);
      const paths = String(steps[uploadAt]?.with?.path ?? '').split('\n').map((p) => p.trim());
      if (!paths.includes('ci-provenance.txt')) out.push(`${name}: the upload's path does not name ci-provenance.txt`);
    }
    for (const need of PROVENANCE_NEEDS) {
      if (!(step.run ?? '').includes(need)) out.push(`${name}: the provenance step's run does not hold ${need}`);
    }
    for (const s of steps) {
      if ((s.run ?? '').includes('${{')) out.push(`${name}: a step's run holds an expression (\${{): ${JSON.stringify(s.name ?? s.run)}`);
    }
  }
  return out;
}

describe('ci.yml: the provenance step in each uploading job (EU-2)', () => {
  // ONE LINE, and that is load-bearing. EU-2 a's text wraps for reading; written across
  // lines in `run: |`, bash ends printf at the newline and runs "$GITHUB_SHA" as a command.
  const STEP_RUN =
    "{ printf 'github_sha=%s\\nrun_id=%s\\nrun_attempt=%s\\njob=%s\\nobject_size=%s\\n---\\n' " +
    '"$GITHUB_SHA" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" "$GITHUB_JOB" "$(git cat-file -s HEAD)"; ' +
    'git cat-file commit HEAD; } > ci-provenance.txt';
  /** The real workflow with one textual change; the plant is confirmed to have landed. */
  function planted(from: string, to: string, count = 1): Workflow {
    const parts = raw.split(from);
    expect(parts.length - 1, `the plant's anchor was found ${parts.length - 1} times, not ${count}: ${from}`).toBe(count);
    return yaml.load(parts.join(to)) as Workflow;
  }

  test('real ci.yml is accepted: every uploading job writes its provenance before the upload', () => {
    expect(provenanceViolations(ci), 'the provenance step is missing or misshapen').toEqual([]);
  });

  test('the three jobs each carry the step exactly as EU-2 a words it', () => {
    for (const name of PROVENANCE_JOBS) {
      const step = (ci.jobs[name]?.steps ?? []).find((s) => (s.run ?? '').includes('> ci-provenance.txt'));
      expect(step?.run?.trim(), `${name}'s provenance step is not EU-2 a's`).toBe(STEP_RUN);
    }
  });

  test('plant — the step missing from every job is rejected', () => {
    const v = provenanceViolations(planted(STEP_RUN, 'echo no provenance', 3));
    for (const name of PROVENANCE_JOBS) expect(v).toContain(`${name}: 0 steps write > ci-provenance.txt; exactly one is required`);
  });

  test('plant — one job missing it is rejected, naming that job alone', () => {
    const wf = yaml.load(raw) as Workflow;
    const steps = wf.jobs['db-tests']?.steps ?? [];
    wf.jobs['db-tests'] = { ...wf.jobs['db-tests'], steps: steps.filter((s) => !(s.run ?? '').includes('> ci-provenance.txt')) };
    expect(steps.length - (wf.jobs['db-tests'].steps ?? []).length, 'precondition: the plant removed no step').toBe(1);
    expect(provenanceViolations(wf)).toEqual(['db-tests: 0 steps write > ci-provenance.txt; exactly one is required']);
  });

  test('plant — the step after the upload is rejected', () => {
    const wf = yaml.load(raw) as Workflow;
    const steps = [...(wf.jobs['golden-path']?.steps ?? [])];
    const at = steps.findIndex((s) => (s.run ?? '').includes('> ci-provenance.txt'));
    const [step] = steps.splice(at, 1);
    steps.push(step as Step);
    wf.jobs['golden-path'] = { ...wf.jobs['golden-path'], steps };
    expect(provenanceViolations(wf)).toEqual(['golden-path: the provenance step does not sit before the upload']);
  });

  test('plant — if: always() removed is rejected', () => {
    const wf = yaml.load(raw) as Workflow;
    const step = (wf.jobs['compliance-tests']?.steps ?? []).find((s) => (s.run ?? '').includes('> ci-provenance.txt')) as Step;
    delete step.if;
    expect(provenanceViolations(wf)).toEqual(['compliance-tests: the provenance step does not run if: always()']);
  });

  test('plant — ${{ github.sha }} in its run is rejected', () => {
    const v = provenanceViolations(planted('"$GITHUB_SHA" "$GITHUB_RUN_ID"', '"${{ github.sha }}" "$GITHUB_RUN_ID"', 3));
    for (const name of PROVENANCE_JOBS) {
      expect(v).toContain(`${name}: the provenance step's run does not hold $GITHUB_SHA`);
      expect(v.join('\n')).toContain(`${name}: a step's run holds an expression`);
    }
  });

  test('plant — a step that only touches the file is rejected', () => {
    const v = provenanceViolations(planted(STEP_RUN, ': > ci-provenance.txt', 3));
    for (const name of PROVENANCE_JOBS) {
      for (const need of PROVENANCE_NEEDS) expect(v).toContain(`${name}: the provenance step's run does not hold ${need}`);
    }
  });

  test('plant — the upload path without the file is rejected', () => {
    const v = provenanceViolations(planted('          path: |\n            junit-db.xml\n            ci-provenance.txt\n', '          path: junit-db.xml\n'));
    expect(v).toEqual(["db-tests: the upload's path does not name ci-provenance.txt"]);
  });

  test('anti-vacuity — a workflow with none of the three jobs fails', () => {
    const v = provenanceViolations({ jobs: {} });
    expect(v.length, 'the checker passed a workflow holding none of its jobs').toBe(3);
  });
});
