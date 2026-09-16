import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, withScratch, copyMigrations } from './_scratch.js';

/**
 * PLANTS OVER scripts/freeze_applied_migrations.mjs -- the recorder that writes
 * the frozen boundary after a hosted apply (ruling R-2026-09-16-03).
 *
 * WHY IT HAS PLANTS AT ALL. The recorder's whole value is its REFUSALS. It is
 * run by hand, once per hosted apply, from runbook step 5, so nothing else
 * exercises it; a refusal that silently stopped firing would be discovered by
 * recording a boundary nobody observed. Its fourth argument is a repository
 * root, which is the seam these plants aim at a scratch tree.
 *
 * NOT ASSERTED HERE, deliberately: that the ledger count passed to it is the one
 * hosted actually reported. Nothing in this repository can see hosted's ledger
 * (Clause 4); the count is read by hand in runbook step 5, and this script's
 * only defence is refusing when that count disagrees with the files here.
 */

const SCRIPT = join(REPO_ROOT, 'scripts/freeze_applied_migrations.mjs');

interface Run {
  status: number;
  output: string;
}

function record(args: string[]): Run {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, output: stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const forwardCount = (root: string): number =>
  readdirSync(join(root, 'database', 'migrations')).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql')).length;

describe('freeze_applied_migrations recorder', () => {
  test('plant — no arguments is refused, because all three come from the apply', () => {
    const r = record([]);
    expect(r.status, `expected a refusal. Output:\n${r.output}`).toBe(2);
    expect(r.output).toContain('usage: node scripts/freeze_applied_migrations.mjs');
    expect(r.output).toContain('All three come from the hosted apply that was just run');
  });

  test('plant — a date that is not YYYY-MM-DD is refused', () => {
    const r = record(['16', 'yesterday', 'R-2026-09-16-02']);
    expect(r.status, `expected a refusal. Output:\n${r.output}`).toBe(2);
    expect(r.output).toContain('is not YYYY-MM-DD');
    expect(r.output).toContain('the date the ledger was read hosted');
  });

  test('plant — a ledger count that is not a positive integer is refused', () => {
    const r = record(['none', '2026-09-16', 'R-2026-09-16-02']);
    expect(r.status, `expected a refusal. Output:\n${r.output}`).toBe(2);
    expect(r.output).toContain('is not a positive integer');
  });

  test('plant — a count disagreeing with the repository is refused, not recorded', () => {
    withScratch((root) => {
      copyMigrations(root);
      const real = forwardCount(root);
      const before = readFileSync(join(root, 'database', 'migrations', 'applied-hosted.json'), 'utf8');

      const r = record([String(real + 1), '2026-09-16', 'R-2026-09-16-02', root]);
      expect(r.status, `expected a refusal. Output:\n${r.output}`).toBe(2);
      expect(r.output).toContain('ledger rows, this repository holds');
      expect(r.output).toContain('Recording that mismatch would assert something nobody observed');
      expect(r.output).toContain('hosted ran a file this checkout does not have');
      expect(
        readFileSync(join(root, 'database', 'migrations', 'applied-hosted.json'), 'utf8'),
        'the boundary was rewritten despite the refusal',
      ).toBe(before);
    });
  });

  test('anti-vacuity — an empty migration directory is refused, never recorded as an empty boundary', () => {
    withScratch((root) => {
      mkdirSync(join(root, 'database', 'migrations'), { recursive: true });
      const r = record(['1', '2026-09-16', 'R-2026-09-16-02', root]);
      expect(r.status, `expected a refusal. Output:\n${r.output}`).toBe(2);
      expect(r.output).toContain('refusing to record an empty boundary');
    });
  });

  test('real corpus is recorded, and the hashes are the files own', () => {
    withScratch((root) => {
      copyMigrations(root);
      const boundary = join(root, 'database', 'migrations', 'applied-hosted.json');
      rmSync(boundary);

      const r = record([String(forwardCount(root)), '2026-09-16', 'R-2026-09-16-02', root]);
      expect(r.status, `expected success. Output:\n${r.output}`).toBe(0);
      expect(r.output).toContain('frozen boundary recorded');

      const doc = JSON.parse(readFileSync(boundary, 'utf8')) as { frozen: { file: string }[]; ledger_rows: number };
      expect(doc.frozen.length).toBe(forwardCount(root));
      expect(doc.ledger_rows).toBe(forwardCount(root));
    });
  });
});
