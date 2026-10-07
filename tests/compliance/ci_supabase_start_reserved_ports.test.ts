import { describe, expect, test } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as yaml from 'js-yaml';
import { REPO_ROOT } from './_scratch.js';

/**
 * EVERY `supabase start` IN CI IS PRECEDED BY A PORT RESERVATION AND FOLLOWED BY A DIAGNOSTIC
 * (R-2026-09-30-206 GF; the ruling is the port-54324 root-cause fix).
 *
 * WHY THE CONTROL EXISTS. `supabase start` failed on port 54324 in about 1 job in 100 (2 of 195
 * observed), on fresh runners, with no holder named in the log. The accepted cause is INFERRED, not
 * observed: ports 54321-54329 lie inside Linux's default ephemeral range, so a transient outbound
 * socket can hold one at the instant the container binds. The fix is to take 54320-54329 out of the
 * ephemeral range before the start, read the setting back, and, if the start still fails, print
 * who holds those ports and which containers exist. No retry, no teardown-and-retry, no
 * --ignore-health-check: each would hide the cause.
 *
 * WHAT IS HELD, parsed with js-yaml from .github/workflows/ci.yml and keyed off job names:
 *   - the jobs that run `supabase start` are exactly db-tests and golden-path, by identity, each
 *     with exactly one start, and the start step is the bare command, with no retry wrapped round it;
 *   - the step IMMEDIATELY BEFORE each start writes net.ipv4.ip_local_reserved_ports=54320-54329
 *     with sudo, prints the setting back, captures it, and exits 1 if the range is not in it;
 *   - the step IMMEDIATELY AFTER each start runs `if: failure()`, prints the sockets on
 *     54320-54329 with their processes (ss -ltnap) and the containers (docker ps -a), and holds no
 *     retry, stop, sleep, ignore-health-check or `|| true`;
 *   - every uncommented port at or above 54000 in supabase/config.toml lies inside the reserved
 *     range, so the literal in the workflow cannot drift away from the ports the stack binds;
 *   - THE RESERVATION STEP IS RUN, not only read: its script executes under bash with a stub sudo and
 *     sysctl, and must exit 0 when the read-back holds the range and non-zero when it does not.
 *
 * GUARD CLASS (code-pipeline Clause 5): LIVE. Both starts exist now and the checker runs over the
 * real workflow.
 *
 * NOT ASSERTED HERE, deliberately: that a GitHub-hosted runner's kernel ACCEPTS the sysctl write, or
 * that the setting survives to the moment supabase binds. Neither can be known from inside the
 * repository: the reservation step fails loudly if the write is refused, and the run's own log
 * shows the read-back, which is the only evidence. The stub-run leg proves the step's logic, not the
 * runner.
 *
 * NOT ASSERTED HERE, deliberately: that the reservation REMOVES the collision. The cause is
 * inferred. The PR that added this control states the falsification: a recurrence of the 54324 bind
 * failure with the reservation in force, its read-back visible in that run's log, reopens the ruling.
 * A green here says the steps are in place and shaped as ruled, and nothing about the failure rate.
 *
 * Template: the provenance section of tests/compliance/ci_required_checks_not_paths_filtered.test.ts.
 */

interface Step {
  name?: string;
  if?: string;
  run?: string;
  uses?: string;
  'continue-on-error'?: boolean;
}
interface Job {
  steps?: Step[];
}
interface Workflow {
  jobs: Record<string, Job>;
}

const CI_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const CONFIG_PATH = join(REPO_ROOT, 'supabase', 'config.toml');
const raw = readFileSync(CI_PATH, 'utf8');
const ci = yaml.load(raw) as Workflow;
const configToml = readFileSync(CONFIG_PATH, 'utf8');

const RANGE = '54320-54329';
const RANGE_LOW = 54320;
const RANGE_HIGH = 54329;
const KEY = 'net.ipv4.ip_local_reserved_ports';
const WRITE = `sudo sysctl -w ${KEY}=${RANGE}`;
/** Checked-in on purpose (test-conventions section 3): the set decays loudly when a job is added or renamed. */
const START_JOBS = ['db-tests', 'golden-path'];
const START_RUN = 'npx supabase start';
const FORBIDDEN_AFTER = [/\bsupabase\s+(stop|start)\b/, /--ignore-health-check/, /\bretry\b/i, /\bsleep\b/, /\|\|\s*true\b/];

const isStart = (s: Step): boolean => /\bsupabase\s+start\b/.test(s.run ?? '');

export function startViolations(wf: Workflow): string[] {
  const out: string[] = [];
  const found: string[] = [];
  for (const [name, job] of Object.entries(wf.jobs ?? {})) {
    const steps = job.steps ?? [];
    const starts = steps.map((s, i) => ({ s, i })).filter(({ s }) => isStart(s));
    if (starts.length === 0) continue;
    found.push(name);
    if (starts.length !== 1) out.push(`${name}: ${starts.length} steps run supabase start; exactly one is required`);
    for (const { s: start, i } of starts) {
      if ((start.run ?? '').trim() !== START_RUN) out.push(`${name}: the start step is not the bare "${START_RUN}": ${JSON.stringify(start.run)}`);
      if (start['continue-on-error'] === true) out.push(`${name}: the start step has continue-on-error`);

      const before = steps[i - 1];
      const run = before?.run ?? '';
      if (before === undefined) out.push(`${name}: no step precedes supabase start`);
      else {
        if (!run.includes(WRITE)) out.push(`${name}: the step before supabase start does not run "${WRITE}"`);
        if (!run.includes(`sysctl ${KEY}`)) out.push(`${name}: the reservation step does not print the setting back`);
        if (!run.includes(`$(sysctl -n ${KEY})`)) out.push(`${name}: the reservation step does not capture the setting it read back`);
        if (!run.includes(`,${RANGE},`)) out.push(`${name}: the reservation step does not test the read-back for ${RANGE}`);
        if (!/\bexit 1\b/.test(run)) out.push(`${name}: the reservation step does not fail when the read-back lacks the range`);
        if (before['continue-on-error'] === true) out.push(`${name}: the reservation step has continue-on-error`);
        if (before.if !== undefined) out.push(`${name}: the reservation step is conditional (if: ${before.if}); it must always run`);
      }

      const after = steps[i + 1];
      const arun = after?.run ?? '';
      if (after === undefined) out.push(`${name}: no step follows supabase start`);
      else {
        if ((after.if ?? '').trim() !== 'failure()') out.push(`${name}: the diagnostic step after supabase start does not run if: failure() (reads ${JSON.stringify(after.if)})`);
        if (!arun.includes('ss -ltnap')) out.push(`${name}: the diagnostic step does not run ss -ltnap`);
        if (!arun.includes('docker ps -a')) out.push(`${name}: the diagnostic step does not run docker ps -a`);
        for (const bad of FORBIDDEN_AFTER) {
          if (bad.test(arun)) out.push(`${name}: the diagnostic step holds ${bad}, which retries, tears down or hides the failure`);
        }
        if (after['continue-on-error'] === true) out.push(`${name}: the diagnostic step has continue-on-error`);
      }
    }
  }
  if (JSON.stringify([...found].sort()) !== JSON.stringify([...START_JOBS].sort())) {
    out.push(`the jobs that run supabase start are [${found.join(', ')}], not exactly [${START_JOBS.join(', ')}]`);
  }
  return out;
}

/** Ports at or above 54000 named by an uncommented `port`-like key in config.toml that fall OUTSIDE the reserved range. */
export function configPortViolations(toml: string): string[] {
  const out: string[] = [];
  let seen = 0;
  for (const line of toml.split('\n')) {
    const m = /^\s*(\w*port)\s*=\s*(\d+)\s*(?:#.*)?$/.exec(line);
    if (m === null) continue;
    const port = Number(m[2]);
    if (port < 54000) continue;
    seen += 1;
    if (port < RANGE_LOW || port > RANGE_HIGH) out.push(`config.toml ${m[1]} = ${port} is outside the reserved range ${RANGE}`);
  }
  if (seen === 0) out.push('config.toml names no port at or above 54000: the range check looked at nothing');
  return out;
}

/** Runs one step's script under bash with a stub sudo and sysctl whose read-back is `reserved`. */
function runStep(run: string, reserved: string): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'reserve-step-'));
  try {
    writeFileSync(join(dir, 'sudo'), '#!/usr/bin/env bash\nexec "$@"\n');
    writeFileSync(
      join(dir, 'sysctl'),
      '#!/usr/bin/env bash\ncase "$1" in\n  -w) echo "$2" ;;\n  -n) printf \'%s\\n\' "$FAKE_RESERVED" ;;\n  *) echo "$1 = $FAKE_RESERVED" ;;\nesac\n',
    );
    chmodSync(join(dir, 'sudo'), 0o755);
    chmodSync(join(dir, 'sysctl'), 0o755);
    const r = spawnSync('bash', ['-e', '-c', run], {
      env: { PATH: `${dir}:${process.env['PATH'] ?? ''}`, FAKE_RESERVED: reserved },
      encoding: 'utf8',
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const reservationRun = (wf: Workflow, job: string): string => {
  const steps = wf.jobs[job]?.steps ?? [];
  const i = steps.findIndex(isStart);
  return steps[i - 1]?.run ?? '';
};

describe('ci.yml: every supabase start is reserved before and diagnosed after (GF)', () => {
  /**
   * A PLANT PROVES NOTHING AGAINST A WORKFLOW THAT IS ALREADY DIRTY: it would be "rejected" for the
   * defects the real file has. Every plant below starts from a workflow this refuses to build
   * unless the real one is clean. Found by the red-first run, where ten plants passed against the
   * unmodified workflow for exactly that reason.
   */
  const requireCleanBase = (): void => {
    expect(startViolations(ci), 'precondition: the real workflow is not clean, so a plant proves nothing').toEqual([]);
  };
  /** The real workflow with one textual change; the plant is confirmed to have landed. */
  function planted(from: string, to: string, count: number): Workflow {
    requireCleanBase();
    const parts = raw.split(from);
    expect(parts.length - 1, `the plant's anchor was found ${parts.length - 1} times, not ${count}: ${from}`).toBe(count);
    return yaml.load(parts.join(to)) as Workflow;
  }
  /** The real workflow, parsed fresh, for a structural plant. */
  const fresh = (): Workflow => {
    requireCleanBase();
    return yaml.load(raw) as Workflow;
  };
  const startAt = (wf: Workflow, job: string): number => (wf.jobs[job]?.steps ?? []).findIndex(isStart);

  test('real ci.yml is accepted: every supabase start is reserved before and diagnosed after', () => {
    const v = startViolations(ci);
    expect(v, `the reservation or the diagnostic is missing or misshapen:\n  ${v.join('\n  ')}`).toEqual([]);
  });

  test('real config.toml is accepted: every port it binds at or above 54000 is inside the reserved range', () => {
    const v = configPortViolations(configToml);
    expect(v, `a port the stack binds is outside the reservation:\n  ${v.join('\n  ')}`).toEqual([]);
  });

  test('the real reservation step is run: it accepts a read-back that holds the range, and rejects one that does not', () => {
    for (const job of START_JOBS) {
      const run = reservationRun(ci, job);
      expect(run, `${job}: no reservation step precedes the start`).not.toBe('');
      for (const good of ['54320-54329', '22,54320-54329', '54320-54329,60000-60010']) {
        const r = runStep(run, good);
        expect(r.status, `${job}: the step refused a read-back of "${good}":\n${r.out}`).toBe(0);
        expect(r.out, `${job}: the step did not print the setting back for "${good}"`).toContain(`${KEY} = ${good}`);
      }
      for (const bad of ['', '54321-54329', '54320-54328', '54320-543299', '154320-54329', '32768-60999']) {
        const r = runStep(run, bad);
        expect(r.status, `${job}: the step accepted a read-back of "${bad}" and would have started Supabase unreserved:\n${r.out}`).toBe(1);
        expect(r.out, `${job}: the refusal does not say what was read`).toContain(`reads '${bad}'`);
      }
    }
  });

  test('plant — a reservation step with its read-back check removed accepts a read-back lacking the range; the real one does not', () => {
    requireCleanBase();
    const real = reservationRun(ci, 'db-tests');
    const weak = real.split('\n').filter((l) => !/case|\*,|exit 1|esac/.test(l)).join('\n');
    expect(weak, 'precondition: the plant removed nothing').not.toBe(real);
    expect(weak.includes('exit 1'), 'precondition: the plant left the failing branch in').toBe(false);
    const weakRun = runStep(weak, '54321-54329');
    expect(weakRun.status, `the weakened step already refuses: the plant did not take effect:\n${weakRun.out}`).toBe(0);
    expect(runStep(real, '54321-54329').status, 'the real step accepted what the weakened one accepts').toBe(1);
  });

  test('plant — the reservation step missing from one job is rejected, naming that job', () => {
    const wf = fresh();
    const steps = wf.jobs['db-tests']?.steps ?? [];
    const at = startAt(wf, 'db-tests');
    wf.jobs['db-tests'] = { steps: steps.filter((_, i) => i !== at - 1) };
    expect(steps.length - (wf.jobs['db-tests'].steps ?? []).length, 'precondition: the plant removed no step').toBe(1);
    const v = startViolations(wf).join('\n');
    expect(v).toContain(`db-tests: the step before supabase start does not run "${WRITE}"`);
    expect(v, 'the plant is attributed to a job it did not touch').not.toContain('golden-path');
  });

  test('plant — the reservation step placed AFTER the start is rejected', () => {
    const wf = fresh();
    const steps = [...(wf.jobs['golden-path']?.steps ?? [])];
    const at = steps.findIndex(isStart);
    const [reserve] = steps.splice(at - 1, 1);
    steps.splice(at, 0, reserve as Step);
    wf.jobs['golden-path'] = { steps };
    expect(startAt(wf, 'golden-path'), 'precondition: the plant did not move the reservation behind the start').toBeLessThan(
      steps.indexOf(reserve as Step),
    );
    expect(startViolations(wf).join('\n')).toContain(`golden-path: the step before supabase start does not run "${WRITE}"`);
  });

  test('plant — a wrong range in the write is rejected in both jobs', () => {
    const v = startViolations(planted(WRITE, `sudo sysctl -w ${KEY}=54321-54329`, 2)).join('\n');
    expect(v).toContain(`db-tests: the step before supabase start does not run "${WRITE}"`);
    expect(v).toContain(`golden-path: the step before supabase start does not run "${WRITE}"`);
  });

  test('plant — the step that never fails (no exit 1) is rejected', () => {
    const wf = fresh();
    const step = (wf.jobs['db-tests']?.steps ?? [])[startAt(wf, 'db-tests') - 1] as Step;
    const before = step.run;
    step.run = (step.run ?? '').replace(/exit 1/g, 'true');
    expect(step.run, 'precondition: the plant changed nothing').not.toBe(before);
    expect(startViolations(wf)).toEqual(['db-tests: the reservation step does not fail when the read-back lacks the range']);
  });

  test('plant — the diagnostic step missing after one start is rejected', () => {
    const wf = fresh();
    const steps = wf.jobs['db-tests']?.steps ?? [];
    const at = startAt(wf, 'db-tests');
    wf.jobs['db-tests'] = { steps: steps.filter((_, i) => i !== at + 1) };
    expect(steps.length - (wf.jobs['db-tests'].steps ?? []).length, 'precondition: the plant removed no step').toBe(1);
    const v = startViolations(wf).join('\n');
    expect(v).toContain('db-tests: the diagnostic step after supabase start does not run if: failure()');
  });

  test('plant — a diagnostic without if: failure() is rejected', () => {
    const wf = fresh();
    const step = (wf.jobs['golden-path']?.steps ?? [])[startAt(wf, 'golden-path') + 1] as Step;
    expect(step.if, 'precondition: the diagnostic had no condition to remove').toBe('failure()');
    delete step.if;
    expect(startViolations(wf)).toEqual(['golden-path: the diagnostic step after supabase start does not run if: failure() (reads undefined)']);
  });

  test('plant — a diagnostic that is present but not adjacent is rejected', () => {
    const wf = fresh();
    const steps = [...(wf.jobs['db-tests']?.steps ?? [])];
    steps.splice(startAt(wf, 'db-tests') + 1, 0, { name: 'something in between', run: 'echo between' });
    wf.jobs['db-tests'] = { steps };
    expect(startViolations(wf).join('\n')).toContain('db-tests: the diagnostic step after supabase start does not run if: failure()');
  });

  test.each([
    ['a teardown', 'supabase stop'],
    ['a retry word', 'echo retry'],
    ['a sleep', 'sleep 5'],
    ['an ignore-health-check', 'echo --ignore-health-check'],
    ['a swallowed failure', 'docker ps -a || true'],
  ])('plant — a diagnostic holding %s is rejected', (_label, extra) => {
    const wf = fresh();
    const step = (wf.jobs['db-tests']?.steps ?? [])[startAt(wf, 'db-tests') + 1] as Step;
    const before = step.run;
    step.run = `${step.run ?? ''}\n${extra}\n`;
    expect(step.run, 'precondition: the plant changed nothing').not.toBe(before);
    expect(startViolations(wf).join('\n')).toContain('which retries, tears down or hides the failure');
  });

  test('plant — a start wrapped in a retry is rejected', () => {
    const wf = fresh();
    const step = (wf.jobs['golden-path']?.steps ?? [])[startAt(wf, 'golden-path')] as Step;
    step.run = 'npx supabase start || npx supabase start';
    expect(startViolations(wf).join('\n')).toContain('golden-path: the start step is not the bare "npx supabase start"');
  });

  test('plant — a third job that starts supabase without the steps is rejected', () => {
    const wf = fresh();
    wf.jobs['extra-job'] = { steps: [{ run: 'npx supabase start' }] };
    const v = startViolations(wf).join('\n');
    expect(v).toContain('extra-job: no step precedes supabase start');
    expect(v).toContain('the jobs that run supabase start are [db-tests, golden-path, extra-job], not exactly [db-tests, golden-path]');
  });

  test('plant — a config.toml port outside the reserved range is rejected', () => {
    const anchor = /^port = 54321$/m;
    expect(anchor.test(configToml), 'precondition: the api port line was not found as expected').toBe(true);
    const planted54331 = configToml.replace(anchor, 'port = 54331');
    expect(planted54331, 'precondition: the plant changed nothing').not.toBe(configToml);
    expect(configPortViolations(planted54331)).toEqual([`config.toml port = 54331 is outside the reserved range ${RANGE}`]);
  });

  test('a commented-out port and a port below 54000 are not read as violations (the ordinary valid input)', () => {
    expect(configPortViolations('[api]\nport = 54321\n# smtp_port = 54399\ninspector_port = 8083\n')).toEqual([]);
  });

  test('anti-vacuity — a workflow with no supabase start fails', () => {
    const v = startViolations({ jobs: { 'repo-lint': { steps: [{ run: 'npm ci' }] } } });
    expect(v, 'the checker passed a workflow holding none of its jobs').toEqual([
      'the jobs that run supabase start are [], not exactly [db-tests, golden-path]',
    ]);
    expect(startViolations({ jobs: {} }).length, 'the checker passed an empty workflow').toBe(1);
  });

  test('anti-vacuity — a config.toml with no port fails, and the real corpus holds both starts', () => {
    expect(configPortViolations('')).toEqual(['config.toml names no port at or above 54000: the range check looked at nothing']);
    const starts = Object.entries(ci.jobs).filter(([, j]) => (j.steps ?? []).some(isStart)).map(([n]) => n);
    expect(starts.sort(), 'the real workflow does not hold exactly the two named starts').toEqual([...START_JOBS].sort());
  });
});
