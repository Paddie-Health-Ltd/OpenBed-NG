import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT, withScratch } from './_scratch.js';

/**
 * A MIGRATION PULL REQUEST ANSWERS THE RUNBOOK LINE (R-2026-09-21-50 E2; built by PR F,
 * R-2026-09-26-130 DF-2).
 *
 * .github/PULL_REQUEST_TEMPLATE.md asks every change touching database/migrations/ which
 * runbook expectations it changes, with "none" requiring a reason -- because migration 018
 * merged in #61 and restated nothing, leaving the runbook asserting as verified state the
 * two things 018 removed. "A template cannot force an answer" (-50 E2). This does: the
 * repo-lint job runs scripts/check_pr_migration_line.mjs on every pull_request event,
 * including `edited`, so fixing the body re-runs it.
 *
 * DF-2's TERMS, exactly:
 *   - TOUCHING: any added, modified, deleted or renamed path under database/migrations/,
 *     including .down.sql and applied-hosted.json. The diff runs with --no-renames, so a
 *     rename out of the directory still shows its old path;
 *   - BLANK: after stripping HTML comments, the line "Runbook expectations this migration
 *     changes:" is missing, has nothing after it (on the line, or before the next heading),
 *     or answers "none" without "because <reason>". A null or empty body on a touching pull
 *     request is blank.
 *
 * THE BODY REACHES THE SCRIPT ONLY THROUGH env (DF-2 c). `${{ github.event.pull_request.body }}`
 * inside a run: line is a script-injection hole; this file refuses it.
 *
 * THE SCRIPT RUNS git ITSELF, rather than reading a pipe: GitHub's default shell has no
 * pipefail, so a `git diff | node` whose git failed would hand the script an empty list,
 * and "no path changed" would pass as "not touching". A git that cannot run is an ERROR
 * (exit 2), never a verdict. Tests hand it a paths file instead (--changed).
 *
 * NOT ASSERTED HERE, deliberately: that the ANSWER IS TRUE. A pull request can name the
 * wrong sections, or give a "because" that does not hold. That is the reviewer's read; this
 * guard only stops the question going unanswered.
 */

const SCRIPT = 'check_pr_migration_line.mjs';
const LINE = 'Runbook expectations this migration changes:';
const TEMPLATE = readFileSync(join(REPO_ROOT, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf8');

interface Run { status: number; out: string }

function run(body: string | null, paths: string[], extraArgs: string[] = []): Run {
  return withScratch((root) => {
    const list = join(root, 'changed.txt');
    writeFileSync(list, paths.join('\n') + (paths.length ? '\n' : ''));
    const env: Record<string, string> = { ...process.env, PATH: process.env.PATH ?? '' } as Record<string, string>;
    delete env.PR_BODY;
    if (body !== null) env.PR_BODY = body;
    try {
      const out = execFileSync('node', [join(REPO_ROOT, 'scripts', SCRIPT), ...(extraArgs.length ? extraArgs : ['--changed', list])], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  });
}

/** The template as a contributor leaves it, with `answer` written after the line. */
const bodyWith = (answer: string): string => TEMPLATE.replace(`${LINE}\n`, `${LINE} ${answer}\n`);
const MIGRATION = ['database/migrations/024_something.sql', 'docs/runbook-supabase-project-creation.md'];

describe('scripts/check_pr_migration_line.mjs', () => {
  test('the template still carries the line, once, outside its comments — the check has something to read', () => {
    const bare = TEMPLATE.replace(/<!--[\s\S]*?-->/g, '');
    expect(bare.split('\n').filter((l) => l.trim().startsWith(LINE)).length, 'the template lost its runbook line').toBe(1);
  });

  test.each([
    ['a sections answer', bodyWith('section 5 (the dry-run expectation) and section 6')],
    ['"none, because <reason>"', bodyWith('none, because this migration only adds a comment')],
    ['an answer on the lines under the line', TEMPLATE.replace(`${LINE}\n`, `${LINE}\n\nnone, because 024 changes no hosted reading\n`)],
  ])('real — a touching pull request with %s is accepted', (_name, body) => {
    const r = run(body, MIGRATION);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('the runbook-expectations line is answered');
  });

  test('real — a pull request that touches no migration passes with a blank body, and says so', () => {
    const r = run('', ['apps/public-dashboard/src/main.ts', 'README.md']);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('touches nothing under database/migrations/');
  });

  test.each([
    ['the line left blank, as the template ships', TEMPLATE, 'the runbook-expectations line is blank'],
    ['a bare "none"', bodyWith('none'), 'answers "none" without "because <reason>"'],
    ['a bare "None." on the next line', TEMPLATE.replace(`${LINE}\n`, `${LINE}\n\nNone.\n`), 'answers "none" without "because <reason>"'],
    ['the line deleted', TEMPLATE.replace(`${LINE}\n`, ''), 'has no "Runbook expectations this migration changes:" line'],
    ['only the template\'s own comment mentioning it', '<!-- Runbook expectations this migration changes: none, because x -->\n', 'has no "Runbook expectations this migration changes:" line'],
    ['an empty body', '', 'has no "Runbook expectations this migration changes:" line'],
  ])('plant — a touching pull request with %s is refused', (_name, body, message) => {
    const r = run(body, MIGRATION);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(message);
  });

  test('plant — a null body (PR_BODY unset) on a touching pull request is refused', () => {
    const r = run(null, MIGRATION);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('has no "Runbook expectations this migration changes:" line');
  });

  test.each([
    ['a .down.sql', ['database/migrations/023_operator_register_location_and_phone.down.sql']],
    ['applied-hosted.json', ['database/migrations/applied-hosted.json']],
    ['a rename out of the directory (its old path)', ['database/migrations/022_one_operator_and_reactivation.sql', 'archive/022.sql']],
  ])('plant — %s counts as touching', (_name, paths) => {
    const r = run(TEMPLATE, paths);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('touches database/migrations/');
  });

  test('could not run — a missing paths file is an ERROR, never a verdict', () => {
    const r = run(bodyWith('none, because x'), [], ['--changed', '/nonexistent/changed.txt']);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('the changed-paths file was unreadable');
  });

  test('could not run — git that cannot diff is an ERROR, never "not touching"', () => {
    const r = withScratch((root) => {
      try {
        const out = execFileSync('node', [join(REPO_ROOT, 'scripts', SCRIPT), '--from-git'], { cwd: root, encoding: 'utf8', env: { ...process.env, PR_BODY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
        return { status: 0, out };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
      }
    });
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('git diff did not run');
  });

  test('usage — no mode is an ERROR', () => {
    const r = run('', [], ['--nonsense']);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('usage: check_pr_migration_line.mjs --from-git | --changed <file>');
  });
});

describe('ci.yml runs it on every pull_request event, with the body only through env', () => {
  const text = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const ci = yaml.load(text) as {
    on: { pull_request?: { types?: string[] } };
    jobs: Record<string, { steps: { name?: string; if?: string; run?: string; env?: Record<string, string>; uses?: string; with?: Record<string, unknown> }[] }>;
  };
  const steps = ci.jobs['repo-lint']?.steps ?? [];
  const step = steps.find((s) => (s.run ?? '').includes(SCRIPT));

  test('pull_request runs on opened, synchronize, reopened and edited, so fixing the body re-runs it (DF-2 c)', () => {
    expect([...(ci.on.pull_request?.types ?? [])].sort()).toEqual(['edited', 'opened', 'reopened', 'synchronize']);
  });

  test('the repo-lint step runs the script with --from-git, only on a pull_request, with the body in env', () => {
    expect(step, 'repo-lint has no step running the script').toBeDefined();
    expect(step?.run?.trim()).toBe(`node scripts/${SCRIPT} --from-git`);
    expect(step?.if).toBe("github.event_name == 'pull_request'");
    expect(step?.env?.PR_BODY).toBe('${{ github.event.pull_request.body }}');
  });

  test('no run: line anywhere interpolates the pull request body — plant: one that does is refused', () => {
    const bodyInRun = (runs: string[]): string[] => runs.filter((r) => /\$\{\{\s*github\.event\.pull_request\.(body|title)/.test(r));
    const runs = Object.values(ci.jobs).flatMap((j) => j.steps.map((s) => s.run ?? ''));
    expect(bodyInRun(runs)).toEqual([]);
    expect(bodyInRun(['echo "${{ github.event.pull_request.body }}" | node x'])).toHaveLength(1);
  });

  test('repo-lint checks out two commits, so HEAD^1 (the base) exists for the diff', () => {
    const checkout = steps.find((s) => (s.uses ?? '').startsWith('actions/checkout'));
    expect(checkout?.with?.['fetch-depth']).toBe(2);
  });
});
