import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, place, withScratch } from './_scratch.js';

/**
 * GUARD OVER A GUARD -- scripts/run_migrations.sh's empty-corpus refusal
 * (R-2026-09-29-172, EV-1 f).
 *
 * THE SUBJECT. The runner applies every forward migration under `database/migrations/`
 * and ledgers it. Handed a directory with none, it must STOP, naming the directory, and
 * touch no database: "applied 0 migrations" reads as a clean run, and would be reported as
 * one against a repository root that simply pointed at the wrong place.
 *
 * WHY THIS FILE EXISTS. The leg "no forward migrations found in" was credited only by the
 * ten-character literal 'migrations' in an unrelated test, a word that names the leg's
 * subject and proves nothing about it. It is planted here through the script's own root
 * argument, `bash scripts/run_migrations.sh <root>`, which exists so a test can aim the
 * runner at a scratch tree. The script is not copied: a copy is not the production object.
 *
 * WHAT A PLANT PROVES, and how it is kept honest. The stub psql records every call, and
 * every plant asserts it was never called: a refusal that fired AFTER the database was
 * reached would be a different, weaker guard. The positive control gets past the same check
 * and reaches the stub, so a script that refused every root could not pass this file.
 *
 * NOT ASSERTED HERE, deliberately: that the runner applies a migration atomically or ledgers
 * it. tests/db/migration_runner_atomicity.test.ts owns that against a real database.
 */

const SCRIPT = 'run_migrations.sh';
const REFUSAL = 'no forward migrations found in';

/** No credentials on purpose: this file must never hold a password-bearing URL. */
const DB_URL = 'postgresql://127.0.0.1:54322/postgres';

interface Run {
  status: number | null;
  out: string;
  psqlCalls: string[];
}

/** Runs the real script over `root`, with a stub psql first on PATH that records and answers nothing. */
function runRunner(scratch: string, root: string): Run {
  const bin = join(scratch, 'bin');
  const log = join(scratch, 'psql.log');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'psql'), '#!/bin/sh\necho "CALL psql $*" >> "$STUB_LOG"\nexit 0\n', 'utf8');
  chmodSync(join(bin, 'psql'), 0o755);
  const r = spawnSync('bash', [join(REPO_ROOT, 'scripts', SCRIPT), root], {
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: scratch, DATABASE_URL: DB_URL, STUB_LOG: log },
  });
  return {
    status: r.status,
    out: `${r.stdout}${r.stderr}`,
    psqlCalls: existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l !== '') : [],
  };
}

describe('run_migrations.sh refuses a root with no forward migration', () => {
  test('plant — an empty database/migrations is refused, exit 2, and psql is never called', () => {
    withScratch((scratch) => {
      const root = join(scratch, 'repo');
      mkdirSync(join(root, 'database', 'migrations'), { recursive: true });
      const res = runRunner(scratch, root);
      expect(res.status, `an empty migration directory was accepted:\n${res.out}`).toBe(2);
      expect(res.out, `it exited 2 but for a different reason:\n${res.out}`).toContain(REFUSAL);
      expect(res.out, 'the refusal does not name the directory it looked in').toContain(join(root, 'database', 'migrations'));
      expect(res.psqlCalls, `the database was reached after the refusal:\n${res.psqlCalls.join('\n')}`).toEqual([]);
    });
  });

  test('plant — a directory holding only a .down.sql is refused: a rollback is never a forward migration', () => {
    withScratch((scratch) => {
      const root = join(scratch, 'repo');
      place(root, 'database/migrations/007_planted.down.sql', 'select 1;\n');
      const res = runRunner(scratch, root);
      expect(res.status, `a rollback file was counted as a forward migration:\n${res.out}`).toBe(2);
      expect(res.out).toContain(REFUSAL);
      expect(res.psqlCalls, `the database was reached:\n${res.psqlCalls.join('\n')}`).toEqual([]);
    });
  });

  test('positive control — a directory with one forward migration gets past the check and reaches psql', () => {
    withScratch((scratch) => {
      const root = join(scratch, 'repo');
      place(root, 'database/migrations/001_planted.sql', 'select 1;\n');
      const res = runRunner(scratch, root);
      expect(res.out, `an ordinary root was refused as empty:\n${res.out}`).not.toContain(REFUSAL);
      expect(res.psqlCalls.length, `psql was never reached, so the check above may not have been what stopped it:\n${res.out}`).toBeGreaterThan(0);
    });
  });
});
