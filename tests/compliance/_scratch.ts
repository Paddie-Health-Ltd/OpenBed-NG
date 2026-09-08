import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

/**
 * Shared machinery for the PLANT-then-assert contract in
 * .claude/rules/test-conventions.md.
 *
 * Plants are CONSTRUCTED IN A SCRATCH TREE, never committed. Every lint in
 * scripts/ accepts an optional root directory as `$1` for exactly this reason --
 * that argument looks unused when you read the script, and removing it breaks
 * every guard-of-a-guard in this directory.
 */

export const REPO_ROOT = join(import.meta.dirname, '..', '..');

export interface LintResult {
  status: number;
  stdout: string;
}

/** Runs a lint script against `root`, capturing its exit status rather than throwing. */
export function runLint(script: string, root: string): LintResult {
  try {
    const stdout = execFileSync('bash', [join(REPO_ROOT, 'scripts', script), root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, stdout: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** Creates a scratch directory, hands it to `fn`, and always removes it. */
export function withScratch<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'openbed-plant-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Writes a file inside the scratch tree, creating parent directories. */
export function place(root: string, relPath: string, content: string): void {
  const target = join(root, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

/** Copies the real migration corpus into the scratch tree, so plants sit among valid files. */
export function copyMigrations(root: string): void {
  const src = join(REPO_ROOT, 'database', 'migrations');
  const dst = join(root, 'database', 'migrations');
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    copyFileSync(join(src, name), join(dst, name));
  }
}
