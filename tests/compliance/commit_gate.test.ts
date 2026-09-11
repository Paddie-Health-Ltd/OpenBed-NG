import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, withScratch } from './_scratch.js';

/**
 * GUARD OVER A PROCESS -- scripts/commit.sh must not commit on a red gate.
 *
 * THE SUBJECT IS NOT A LINT. Every other file in this directory guards a rule
 * about the code. This one guards the step that PUTS code in the repository,
 * because that step failed twice on 2026-09-10: the gate ran, reported FAILED,
 * and the commit landed anyway. Both remedies were habits, and the second one
 * was adopted after the first had already been shown not to hold.
 *
 * HOW THE PLANT REACHES THE GATE LEG WITHOUT INSTALLING A BYPASS. commit.sh
 * takes no root argument, unlike every lint in scripts/ -- deliberately, since
 * an argument that lets a caller substitute the gate is a hole in the one
 * guarantee the script makes. So the plant does not parameterise the script: it
 * builds a whole scratch REPOSITORY, copies the real commit.sh bytes into its
 * scripts/ directory, and puts a stub gate.sh beside it. commit.sh resolves its
 * root from its own location, so the copy governs the scratch tree and the
 * original still governs this one. The artefact under test is the real file;
 * only the tree it is aimed at is constructed.
 *
 * THE ASSERTION IS THE COMMIT COUNT, NOT THE MESSAGE. A script that printed
 * "REFUSING" and committed anyway would satisfy a message assertion perfectly,
 * and that is precisely the defect: the verdict was correct and was not acted
 * on. So every leg here reads `git rev-list --count HEAD` before and after.
 *
 * AND THE STUB PROVES IT RAN. The stub gate writes a marker file. Without that,
 * an ACCEPT leg passes identically whether commit.sh consulted the gate or
 * skipped it entirely -- a check reporting success for a reason unrelated to
 * what it guards, which is the category this repository keeps finding.
 *
 * NOT ASSERTED HERE, deliberately: that commit.sh is USED. Nothing can assert
 * that. A bare `git commit` bypasses it completely, and calling this a control
 * would be a Clause 5 claim that does not reach. What is asserted is that when
 * it IS used, the gate is the commit's precondition and not a suggestion.
 */

const COMMIT_SH = join(REPO_ROOT, 'scripts/commit.sh');
const MARKER = 'gate-ran.marker';

interface Run {
  status: number;
  out: string;
  commitsBefore: number;
  commitsAfter: number;
  gateRan: boolean;
  head: string;
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function countCommits(root: string): number {
  return Number(git(root, 'rev-list', '--count', 'HEAD').trim());
}

/**
 * Builds a scratch repository governed by the REAL commit.sh and a stub gate
 * that exits with `gateExit`. `stage` false leaves the index empty.
 */
function withRepo(
  gateExit: number,
  args: string[],
  opts: { stage?: boolean } = {},
): Run {
  return withScratch((root) => {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    copyFileSync(COMMIT_SH, join(root, 'scripts/commit.sh'));

    // The stub records that it ran. `exit <n>` with no `set -e` games: the
    // whole point is that commit.sh reads the status rather than the output.
    writeFileSync(
      join(root, 'scripts/gate.sh'),
      `#!/usr/bin/env bash\ntouch "$(cd "$(dirname "$0")/.." && pwd)/${MARKER}"\necho "stub gate: exiting ${gateExit}"\nexit ${gateExit}\n`,
      'utf8',
    );

    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.email', 'plant@example.invalid');
    git(root, 'config', 'user.name', 'Plant');
    writeFileSync(join(root, 'base.txt'), 'base\n', 'utf8');
    git(root, 'add', 'base.txt');
    git(root, 'commit', '-q', '-m', 'base');

    if (opts.stage !== false) {
      writeFileSync(join(root, 'changed.txt'), 'changed\n', 'utf8');
      git(root, 'add', 'changed.txt');
    }

    const commitsBefore = countCommits(root);
    let status = 0;
    let out = '';
    try {
      out = execFileSync('bash', [join(root, 'scripts/commit.sh'), ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      status = err.status ?? -1;
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }

    let gateRan = true;
    try {
      readFileSync(join(root, MARKER));
    } catch {
      gateRan = false;
    }

    return { status, out, commitsBefore, commitsAfter: countCommits(root), gateRan, head: git(root, 'log', '-1', '--format=%B') };
  });
}

describe('commit.sh — the gate is the commit’s precondition', () => {
  test('plant — a red gate commits NOTHING, whatever it printed', () => {
    const r = withRepo(1, ['-m', 'should not land']);
    expect(r.gateRan, `the stub gate never ran, so this leg proves nothing:\n${r.out}`).toBe(true);
    expect(r.commitsAfter, `A RED GATE PRODUCED A COMMIT. This is the exact defect.\n${r.out}`).toBe(r.commitsBefore);
    expect(r.status, `exit status on a red gate:\n${r.out}`).toBe(1);
    expect(r.out).toContain('the gate did not pass -- NOTHING WAS COMMITTED');
  });

  test('real commit.sh accepts a green gate and commits exactly once', () => {
    const r = withRepo(0, ['-m', 'lands']);
    expect(r.gateRan, `the gate was not consulted, so the pass means nothing:\n${r.out}`).toBe(true);
    expect(r.status, `a green gate must commit:\n${r.out}`).toBe(0);
    expect(r.commitsAfter, `expected exactly one new commit:\n${r.out}`).toBe(r.commitsBefore + 1);
    expect(r.head).toContain('lands');
  });

  test('plant — no git arguments is refused before the gate is even run', () => {
    const r = withRepo(0, []);
    expect(r.status, `usage failure:\n${r.out}`).toBe(2);
    expect(r.out).toContain('no git commit arguments given');
    expect(r.gateRan, 'the gate ran despite unusable arguments — minutes wasted for nothing').toBe(false);
    expect(r.commitsAfter).toBe(r.commitsBefore);
  });

  test('plant — an empty index is refused before the gate is even run', () => {
    const r = withRepo(0, ['-m', 'nothing to say'], { stage: false });
    expect(r.status, `empty-index failure:\n${r.out}`).toBe(2);
    expect(r.out).toContain('nothing is staged');
    // Not cosmetic. Discovering an empty index AFTER a multi-minute gate is what
    // teaches an operator to run the gate separately "to save time", which is
    // the two-step sequence coming back.
    expect(r.gateRan, 'the full gate ran against an empty index').toBe(false);
    expect(r.commitsAfter).toBe(r.commitsBefore);
  });

  test('--amend with an empty index is legitimate input and reaches the gate', () => {
    // POSITIVE CONTROL, test-conventions section 2, the fourth way a leg goes
    // wrong: a tool that refuses an ordinary action is disabled by the next
    // person who hits it. Amending a message with nothing newly staged is the
    // most ordinary amend there is.
    const r = withRepo(0, ['--amend', '-m', 'reworded'], { stage: false });
    expect(r.gateRan, `--amend was refused before the gate:\n${r.out}`).toBe(true);
    expect(r.status, `--amend on an unchanged index must be allowed:\n${r.out}`).toBe(0);
    expect(r.commitsAfter, 'an amend must not add a commit').toBe(r.commitsBefore);
    expect(r.head).toContain('reworded');
  });

  test('--fast stamps the partial gate into the permanent record', () => {
    const r = withRepo(0, ['--fast', '-m', 'docs only']);
    expect(r.status, `--fast on a green gate:\n${r.out}`).toBe(0);
    expect(r.commitsAfter).toBe(r.commitsBefore + 1);
    // The loophole is deliberate and must never be silent: greppable with
    // `git log --grep`, forever.
    expect(r.head, `--fast left no trace in the commit message:\n${r.head}`).toContain('Gate: fast (e2e not run)');
  });

  test('the full gate leaves no trailer — the stamp means something', () => {
    // ANTI-VACUITY for the leg above. A trailer stamped unconditionally would
    // satisfy that assertion while carrying no information at all.
    const r = withRepo(0, ['-m', 'full gate']);
    expect(r.head, 'a full-gate commit was stamped as fast').not.toContain('Gate: fast');
  });
});
