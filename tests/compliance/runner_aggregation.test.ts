import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { withScratch, place, REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER THE THREE AGGREGATING RUNNERS -- scripts/gate.sh,
 * scripts/lint_migrations_all.sh, scripts/commit.sh.
 *
 * THE RULING (R-2026-09-15-03, item 3). Each runner ran `set -uo pipefail`
 * without `-e`, because each reports failures rather than stopping at the
 * first. That counted only the failures it was written to count. A failed `cd`,
 * a typo, a missing file between two checks ran on silently -- and in commit.sh
 * "ran on" means toward `git commit`. They now run `set -euo pipefail` and
 * capture each check's status explicitly. Two properties, and both are planted
 * for every runner:
 *
 *   1. A COUNTED failure is reported by name, the remaining checks still run,
 *      and the runner exits 1. (For commit.sh: nothing is committed.)
 *   2. An UNINTENDED failure -- a line injected into a copy of the real script
 *      that fails between checks -- aborts: no later check runs, no summary
 *      prints, and the exit is non-zero. Without `-e` this leg is red, which is
 *      what the per-runner neuter proves.
 *
 * HOW. Each leg copies the REAL script into a scratch tree beside stub checks
 * that record they ran and exit as told. For gate.sh, `npm` and `npx` are stubs
 * on PATH. The injected line is placed by exact-anchor replacement, and the
 * leg first asserts the copy changed (test-conventions.md §8, confirm the plant
 * planted).
 *
 * NOT ASSERTED HERE, deliberately: that the real checks behind the stubs are
 * correct. Each has its own guard. This file asserts only how the runners
 * consume a status.
 */

interface Run {
  status: number;
  out: string;
  ran: string[];
}

function exec(cmd: string, args: string[], env: Record<string, string>, cwd?: string): { status: number; out: string } {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env }, cwd });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** A stub that appends its id to ran.log, then exits 3 if it is the one told to fail. */
function stub(id: string): string {
  return `#!/usr/bin/env bash\necho "${id}" >> "$STUB_LOG"\nif [ "\${STUB_FAIL:-}" = "${id}" ]; then exit 3; fi\nexit 0\n`;
}

function plantInto(file: string, anchor: string, injected: string): void {
  const src = readFileSync(file, 'utf8');
  const count = src.split(anchor).length - 1;
  if (count !== 1) throw new Error(`runner plant anchor found ${count} times in ${file}; the plant would not land where intended`);
  const out = src.replace(anchor, `${anchor}\n${injected}`);
  writeFileSync(file, out, 'utf8');
  if (readFileSync(file, 'utf8') === src) throw new Error(`runner plant did not change ${file}`);
}

const GATE_SCRIPTS = [
  'lint_no_secrets.sh',
  'lint_migrations_all.sh',
  'lint_no_service_role_in_bundle.sh',
  'lint_no_updated_at_filter.sh',
  'lint_from_allowlist.sh',
  'lint_grep_exit_codes.sh',
  'lint_audit_log_columns.sh',
];

function gate(fail: string, inject?: { anchor: string; line: string }): Run {
  return withScratch((root) => {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'bin'), { recursive: true });
    copyFileSync(join(REPO_ROOT, 'scripts/gate.sh'), join(root, 'scripts/gate.sh'));
    for (const s of GATE_SCRIPTS) place(root, `scripts/${s}`, stub(s));
    for (const tool of ['npm', 'npx']) {
      writeFileSync(join(root, 'bin', tool), `#!/usr/bin/env bash\necho "${tool} $*" >> "$STUB_LOG"\nif [ "\${STUB_FAIL:-}" = "${tool} $*" ]; then exit 3; fi\nexit 0\n`, 'utf8');
      chmodSync(join(root, 'bin', tool), 0o755);
    }
    if (inject) plantInto(join(root, 'scripts/gate.sh'), inject.anchor, inject.line);
    const log = join(root, 'ran.log');
    const r = exec('bash', [join(root, 'scripts/gate.sh')], { PATH: `${join(root, 'bin')}:${process.env['PATH'] ?? ''}`, STUB_LOG: log, STUB_FAIL: fail });
    return { ...r, ran: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] };
  });
}

function aggregator(fail: string, inject?: { anchor: string; line: string }): Run {
  return withScratch((root) => {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    copyFileSync(join(REPO_ROOT, 'scripts/lint_migrations_all.sh'), join(root, 'scripts/lint_migrations_all.sh'));
    const src = readFileSync(join(REPO_ROOT, 'scripts/lint_migrations_all.sh'), 'utf8');
    const lints = ((/LINTS=\(([\s\S]*?)\)/.exec(src)?.[1]) ?? '').split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.sh'));
    for (const l of lints) place(root, `scripts/${l}`, stub(l));
    if (inject) plantInto(join(root, 'scripts/lint_migrations_all.sh'), inject.anchor, inject.line);
    const log = join(root, 'ran.log');
    const r = exec('bash', [join(root, 'scripts/lint_migrations_all.sh'), root], { STUB_LOG: log, STUB_FAIL: fail });
    return { ...r, ran: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] };
  });
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function commit(inject?: { anchor: string; line: string }): Run & { commitsBefore: number; commitsAfter: number } {
  return withScratch((root) => {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    copyFileSync(join(REPO_ROOT, 'scripts/commit.sh'), join(root, 'scripts/commit.sh'));
    place(root, 'scripts/gate.sh', '#!/usr/bin/env bash\necho gate >> "$STUB_LOG"\nexit 0\n');
    if (inject) plantInto(join(root, 'scripts/commit.sh'), inject.anchor, inject.line);
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.email', 'plant@example.invalid');
    git(root, 'config', 'user.name', 'Plant');
    place(root, 'base.txt', 'base\n');
    git(root, 'add', 'base.txt');
    git(root, 'commit', '-q', '-m', 'base');
    place(root, 'changed.txt', 'changed\n');
    git(root, 'add', 'changed.txt');
    const before = Number(git(root, 'rev-list', '--count', 'HEAD').trim());
    const log = join(root, 'ran.log');
    const r = exec('bash', [join(root, 'scripts/commit.sh'), '-m', 'runner plant'], { STUB_LOG: log });
    const after = Number(git(root, 'rev-list', '--count', 'HEAD').trim());
    return { ...r, ran: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [], commitsBefore: before, commitsAfter: after };
  });
}

const BREAK = 'cd "$ROOT/no-such-directory-planted"';

describe('gate.sh — counted failures reported, unintended failures abort', () => {
  test('real gate.sh accepts all-green checks and runs every one', () => {
    const r = gate('');
    expect(r.status, `an all-green gate did not pass:\n${r.out}`).toBe(0);
    expect(r.out).toContain('gate.sh: PASS (all checks)');
    expect(r.ran, `not every check ran:\n${r.out}`).toContain('npm run test:e2e');
  });

  test('plant — a counted failure is named, later checks still run, and the gate exits 1', () => {
    const r = gate('npm run typecheck');
    expect(r.status, `a failing check did not fail the gate:\n${r.out}`).toBe(1);
    expect(r.out).toContain('check(s) did not pass: typecheck');
    expect(r.out).toContain('typecheck                          FAILED (exit 3)');
    expect(r.ran, `the gate stopped at the first failure instead of reporting all:\n${r.out}`).toContain('lint_audit_log_columns.sh');
  });

  test('plant — an unintended failure between checks aborts the gate before any later check', () => {
    const r = gate('', { anchor: 'run "build"              npm run build', line: BREAK });
    expect(r.status, `an unintended failure did not abort:\n${r.out}`).not.toBe(0);
    expect(r.out, `the gate ran on past an unintended failure and passed:\n${r.out}`).not.toContain('gate.sh: PASS');
    expect(r.ran, `a check ran after the unintended failure:\n${r.out}\nran: ${r.ran.join(', ')}`).not.toContain('npm run typecheck');
  });
});

describe('lint_migrations_all.sh — counted failures reported, unintended failures abort', () => {
  test('plant — a failing lint is named, the other lints still run, exit 1', () => {
    const r = aggregator('lint_no_drop_cascade.sh');
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('one or more migration lints reported a violation: lint_no_drop_cascade.sh');
    expect(r.ran, `the aggregator stopped at the first failure:\n${r.out}`).toContain('lint_sql_no_bare_not_duty_flag.sh');
  });

  test('plant — an unintended failure before the lints aborts without running or summarising any', () => {
    const r = aggregator('', { anchor: 'FAILED=()', line: BREAK });
    expect(r.status, `an unintended failure did not abort:\n${r.out}`).not.toBe(0);
    expect(r.out, `the aggregator reported success past an unintended failure:\n${r.out}`).not.toContain('migration lints passed');
    expect(r.ran, `a lint ran after the unintended failure: ${r.ran.join(', ')}`).toEqual([]);
  });
});

describe('commit.sh — an unintended failure never reaches git commit', () => {
  test('real commit.sh with a green gate still commits once', () => {
    const r = commit();
    expect(r.status, r.out).toBe(0);
    expect(r.commitsAfter, r.out).toBe(r.commitsBefore + 1);
  });

  test('plant — an unintended failure after a green gate commits NOTHING', () => {
    const r = commit({ anchor: 'COMMIT_ARGS=("$@")', line: BREAK });
    expect(r.ran, `the gate stub never ran, so this leg proves nothing:\n${r.out}`).toContain('gate');
    expect(r.commitsAfter, `AN UNINTENDED FAILURE RAN ON INTO git commit:\n${r.out}`).toBe(r.commitsBefore);
    expect(r.status, r.out).not.toBe(0);
  });
});
