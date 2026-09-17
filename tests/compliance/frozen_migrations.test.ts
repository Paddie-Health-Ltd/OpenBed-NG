import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, withScratch, copyMigrations, place } from './_scratch.js';

/**
 * THE FROZEN MIGRATION GUARD (ruling R-2026-09-16-03).
 *
 * WHAT IT PROTECTS. A migration recorded in hosted's app.schema_migrations has
 * already run there. Hosted keeps the bytes it ran; editing the file here makes
 * the repository disagree with the database and NOTHING ERRORS -- the ledger
 * still holds the filename, the schema still holds the old shape, and the next
 * reader believes the file. The v2 kickoff names the concrete shape: a Stage 1
 * fix quietly editing 004 on a branch that outlives the apply.
 *
 * WHY A HASH SET AND NOT A RANGE. The rule is a criterion -- frozen once
 * ledgered -- and the range is an observation with a date. The observation lives
 * in exactly one place, database/migrations/applied-hosted.json, which both live
 * rules cite. A range restated in prose goes stale at every apply.
 *
 * WHY CONTIGUITY AND THE LEDGER COUNT ARE ASSERTED TOO. The reflex this guard
 * has to survive is not only "regenerate the hash": it is "delete the row for
 * the file I just edited". Requiring the frozen list to be a contiguous prefix
 * of the migration sequence, of exactly ledger_rows entries, makes that edit
 * visible -- greening it then also means restating what hosted ran, which is a
 * claim someone has to write down rather than a silent refresh.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - That hosted's ledger actually holds these files. That is a hand check in
 *     docs/runbook-supabase-project-creation.md step 5, run against the hosted
 *     project with a credential CI does not carry (Clause 4). This guard asserts
 *     the repository against the RECORDED observation, never against hosted.
 *   - The .down.sql files. They are never applied hosted, so they are not frozen.
 */

const BOUNDARY = 'database/migrations/applied-hosted.json';

interface FrozenEntry {
  file: string;
  sha256: string;
}

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

const forwardFiles = (migDir: string): string[] =>
  readdirSync(migDir)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

/** Exported so the plants can aim it at a scratch tree, per _scratch.ts's root convention. */
export function frozenViolations(root: string): string[] {
  const migDir = join(root, 'database', 'migrations');
  const boundaryPath = join(root, BOUNDARY);
  if (!existsSync(boundaryPath)) {
    return [`no frozen boundary at ${BOUNDARY} — the guard checked nothing, which reports the same green as a clean tree`];
  }

  let doc: { frozen?: FrozenEntry[]; ledger_rows?: number };
  try {
    doc = JSON.parse(readFileSync(boundaryPath, 'utf8')) as typeof doc;
  } catch (e) {
    return [`${BOUNDARY} is not readable JSON: ${(e as Error).message}`];
  }

  const frozen = doc.frozen ?? [];
  const out: string[] = [];
  if (frozen.length === 0) {
    return [`${BOUNDARY} lists no frozen migrations — an empty corpus cannot catch an edit to applied history`];
  }
  if (doc.ledger_rows !== frozen.length) {
    out.push(
      `${BOUNDARY} lists ${frozen.length} frozen files but records ledger_rows=${String(doc.ledger_rows)}. ` +
        'These must agree: the ledger count is the observation that says how many files hosted has run.',
    );
  }

  const forwards = forwardFiles(migDir);
  const prefix = forwards.slice(0, frozen.length);
  const listed = frozen.map((f) => f.file);
  if (listed.join(',') !== prefix.join(',')) {
    out.push(
      `the frozen list is not the first ${frozen.length} migrations in order.\n` +
        `  listed  : ${listed.join(', ')}\n` +
        `  expected: ${prefix.join(', ')}\n` +
        '  A file dropped from this list is an edit to applied history wearing a different face.',
    );
  }

  for (const entry of frozen) {
    const path = join(migDir, entry.file);
    if (!existsSync(path)) {
      out.push(
        `frozen migration ${entry.file} is MISSING from ${migDir}. Hosted has run it; deleting or renaming it ` +
          'here makes the repository unable to reproduce the database it claims to describe.',
      );
      continue;
    }
    const actual = sha256(readFileSync(path));
    if (actual !== entry.sha256) {
      out.push(
        `frozen migration ${entry.file} CHANGED.\n` +
          `  recorded: ${entry.sha256}\n` +
          `  current : ${actual}\n` +
          '  It is recorded in hosted app.schema_migrations, so hosted keeps the bytes it ran and this edit\n' +
          '  makes schema and ledger disagree silently.\n' +
          '  THE FIX IS A NEW MIGRATION carrying the change. Do not regenerate this fixture to go green:\n' +
          `  ${BOUNDARY} is updated only by a hosted apply (runbook step 5), which is what its observed date\n` +
          '  and ledger_rows assert.',
      );
    }
  }
  return out;
}

const report = (v: string[]): string => (v.length === 0 ? '(no findings)' : v.join('\n'));

describe('frozen migrations — applied history is not edited', () => {
  test('real repository is accepted', () => {
    const v = frozenViolations(REPO_ROOT);
    expect(v, `the real tree should satisfy the frozen boundary. Checker said:\n${report(v)}`).toEqual([]);
  });

  test('plant — a frozen migration edited is rejected', () => {
    withScratch((root) => {
      copyMigrations(root);
      const target = join(root, 'database', 'migrations', '004_app_ward_status_tables.sql');
      const before = readFileSync(target);
      writeFileSync(target, Buffer.concat([before, Buffer.from('\n-- planted edit\n')]));
      // CONFIRM THE PLANT LANDED before reading the verdict (test-conventions section 8):
      // a no-op plant and a guard with a hole report identically.
      expect(sha256(readFileSync(target)), 'the plant did not change the file').not.toBe(sha256(before));

      const v = frozenViolations(root);
      expect(report(v)).toContain('004_app_ward_status_tables.sql CHANGED');
      expect(report(v)).toContain('THE FIX IS A NEW MIGRATION');
    });
  });

  test('plant — an entry deleted from the boundary is rejected', () => {
    withScratch((root) => {
      copyMigrations(root);
      const boundaryPath = join(root, BOUNDARY);
      const doc = JSON.parse(readFileSync(boundaryPath, 'utf8')) as { frozen: FrozenEntry[]; ledger_rows: number };
      const dropped = doc.frozen.splice(3, 1)[0] as FrozenEntry;
      writeFileSync(boundaryPath, JSON.stringify(doc, null, 2));
      expect(doc.frozen.some((f) => f.file === dropped.file), 'the plant did not drop the entry').toBe(false);

      const v = frozenViolations(root);
      expect(report(v)).toContain('is not the first');
      expect(report(v)).toContain('records ledger_rows=');
    });
  });

  test('plant — a frozen migration deleted from disk is rejected, and says so distinctly', () => {
    withScratch((root) => {
      copyMigrations(root);
      const target = join(root, 'database', 'migrations', '004_app_ward_status_tables.sql');
      rmSync(target);
      expect(existsSync(target), 'the plant did not remove the file').toBe(false);

      expect(report(frozenViolations(root))).toContain('004_app_ward_status_tables.sql is MISSING');
    });
  });

  test('an UNFROZEN migration is untouched by this guard — it freezes applied history, not the directory', () => {
    withScratch((root) => {
      copyMigrations(root);
      // The placeholder is the NEXT number after the recorded boundary. It was 017
      // until 017's hosted apply was recorded (R-2026-09-17-01), at which point a
      // placeholder of that name became an edit to a frozen file. Move it again in
      // the change that records 018's apply.
      place(root, 'database/migrations/018_placeholder.sql', '-- not applied hosted, so not frozen\nselect 1;\n');
      place(root, 'database/migrations/018_placeholder.down.sql', '-- reversal\nselect 1;\n');

      const v = frozenViolations(root);
      expect(v, `an unapplied 018 must be free to change. Checker said:\n${report(v)}`).toEqual([]);
    });
  });

  test('anti-vacuity — an empty frozen list fails', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, BOUNDARY, JSON.stringify({ ledger_rows: 0, frozen: [] }, null, 2));
      expect(report(frozenViolations(root))).toContain('lists no frozen migrations');
    });
  });

  test('anti-vacuity — a missing boundary file fails', () => {
    withScratch((root) => {
      copyMigrations(root);
      rmSync(join(root, BOUNDARY));
      expect(report(frozenViolations(root))).toContain('the guard checked nothing');
    });
  });
});
