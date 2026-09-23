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

/**
 * THE NEXT UNFROZEN MIGRATION NUMBER, DERIVED FROM THE BOUNDARY IN THE TREE IT IS
 * GIVEN (R-2026-09-22-53).
 *
 * WHY THIS EXISTS. The leg below used to hard-code a number, and the runbook's
 * recording step told whoever recorded a hosted apply to move it by hand. **The
 * mechanism that instruction cited had stopped reaching on 2026-09-17** -- see the
 * header note below -- so the move was unenforced hygiene. Deriving it removes the
 * step rather than guarding it.
 *
 * IT READS THE SCRATCH ROOT, NOT `REPO_ROOT`. `copyMigrations` copies the boundary
 * file into the scratch tree, so a plant that edits the boundary moves the
 * derivation with it. Reading the repository here would make the helper deaf to the
 * very input the plants vary.
 *
 * IT REFUSES RATHER THAN DEFAULTING. An unreadable or empty boundary throws with a
 * message naming the file. A fallback -- "assume 1", "assume the repo's highest" --
 * is the dead-key fallback of `scripts/get_publishable_key.sh` in another hat
 * (test-conventions section 8): it would return a plausible number for a tree that
 * records nothing, and the leg would then pass over an input it never understood.
 */
export function nextUnfrozenNumber(root: string): number {
  const raw = readFileSync(join(root, BOUNDARY), 'utf8');
  const parsed = JSON.parse(raw) as { frozen?: { file?: string }[] };
  const numbers = (parsed.frozen ?? [])
    .map((f) => Number(/^(\d{3})_/.exec(f.file ?? '')?.[1] ?? NaN))
    .filter((n) => Number.isInteger(n));
  if (numbers.length === 0) {
    throw new Error(
      `${BOUNDARY} records no numbered frozen migration, so the next unfrozen number cannot be derived. ` +
        'Refusing to guess one: a guessed number would make the leg below assert against a tree it did not read.',
    );
  }
  return Math.max(...numbers) + 1;
}

/** The filenames the boundary in THIS tree records as frozen. */
export function frozenFilesIn(root: string): string[] {
  const parsed = JSON.parse(readFileSync(join(root, BOUNDARY), 'utf8')) as { frozen?: { file?: string }[] };
  return (parsed.frozen ?? []).map((f) => f.file ?? '').filter((f) => f.length > 0);
}

/**
 * THE CHECK THE PLACEHOLDER HAS TO PASS: its number belongs to no frozen migration.
 * Returns the finding, or null when the number is genuinely unfrozen.
 *
 * WHY A COLLISION TEST AND NOT ARITHMETIC. The first version of this asserted that
 * the derived number exceeded the frozen COUNT -- and since the derivation returns
 * `max(frozen) + 1`, that holds for every well-formed boundary. **A tautology in the
 * shape of a guard**, and the plant below is what found it: nothing it did could
 * make the assertion fail. A collision test can fail, and fails on exactly the input
 * the old hand-carried step existed to avoid.
 */
export function placeholderCollision(root: string, n: number): string | null {
  const hit = frozenFilesIn(root).find((f) => f.startsWith(`${pad(n)}_`));
  if (hit === undefined) return null;
  return (
    `placeholder number ${pad(n)} collides with ${hit}, which ${BOUNDARY} records as FROZEN. ` +
    'A placeholder at an applied number names applied history, and the contiguous-prefix check ' +
    'cannot be relied on to notice — whether it does depends on how the real migration is spelled.'
  );
}

/** `7` -> `"007"`. The migration corpus is three digits and the sort depends on it. */
const pad = (n: number): string => String(n).padStart(3, '0');

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

      // DERIVED FROM THE BOUNDARY, NOT CARRIED (R-2026-09-22-53). This number was
      // hard-coded at 017 until 017's hosted apply, then 018, then 019 -- moved by
      // hand each time, on an instruction in the runbook's recording step that no
      // longer exists because this line replaced it.
      const next = nextUnfrozenNumber(root);

      // AND THE PLACEHOLDER IS CHECKED AGAINST THE FROZEN SET, which is the half
      // that makes this leg mean anything. THE CONTIGUOUS-PREFIX CHECKER BELOW
      // CANNOT CATCH A PLACEHOLDER AT A FROZEN NUMBER on its own: it compares the
      // first N sorted forwards with the frozen list, so a placeholder shifts that
      // prefix only when it sorts BEFORE the real migration at its own number.
      //
      // MEASURED 2026-09-22 against the boundary at 18: 016_placeholder.sql and
      // 017_placeholder.sql RED, because "p" < "s" in 016_snapshot.sql and
      // 017_snapshot_schedule.sql; 018_placeholder.sql PASSES, because "c" < "p" in
      // 018_close_mirror_read_and_push_surfaces.sql. **Whether the old hand-carried
      // number reddened was an alphabetical accident of what the real migration at
      // that number happened to be called.** That is why moving it by hand was
      // unenforced hygiene, and it is what `placeholderCollision` does not depend on.
      // RE-MEASURED 2026-09-23 against the boundary at 19: 019_placeholder.sql is
      // RED from the prefix checker alone ("p" < "s" in 019_snapshot_...), and the
      // derived placeholder is 020, which collides with nothing.
      expect(
        placeholderCollision(root, next),
        'the derived placeholder number belongs to a frozen migration',
      ).toBeNull();

      place(root, `database/migrations/${pad(next)}_placeholder.sql`, '-- not applied hosted, so not frozen\nselect 1;\n');
      place(root, `database/migrations/${pad(next)}_placeholder.down.sql`, '-- reversal\nselect 1;\n');

      const v = frozenViolations(root);
      expect(v, `an unapplied ${pad(next)} must be free to change. Checker said:\n${report(v)}`).toEqual([]);
    });
  });

  test('plant — a placeholder at a FROZEN number is rejected', () => {
    // THE DEMONSTRATED FAILING HALF (R-2026-09-22-53). Pointed at a frozen number,
    // the leg above goes red BY NAME.
    //
    // WHY THE CHECK IS A COLLISION TEST AND NOT ARITHMETIC, because the first
    // version of it was arithmetic and this plant is what caught that. It asserted
    // `next > frozenCount`, and since `next` IS `max(frozen) + 1` that is true for
    // every well-formed boundary -- **a tautology wearing the shape of a guard**,
    // written into the change that exists to remove an unenforced step. The plant
    // could not make it fail, which is the plant doing its job.
    withScratch((root) => {
      copyMigrations(root);
      const honest = nextUnfrozenNumber(root);
      const frozenNumber = honest - 1;

      // CONFIRM THE PLANT NAMES A REALLY FROZEN NUMBER, rather than one that merely
      // looks like it (test-conventions, 2026-09-21: the plant must reach the path,
      // not just the bytes).
      expect(
        frozenFilesIn(root).some((f) => f.startsWith(`${pad(frozenNumber)}_`)),
        `${pad(frozenNumber)} is not a frozen number in this tree, so this plant proves nothing`,
      ).toBe(true);

      const finding = placeholderCollision(root, frozenNumber);
      expect(finding, 'a placeholder at a frozen number was accepted').not.toBeNull();
      expect(finding ?? '', 'the refusal does not name the colliding migration').toContain(
        `${pad(frozenNumber)}_`,
      );
      expect(finding ?? '', 'the refusal does not name the boundary file').toContain(BOUNDARY);

      // AND THE CONTRAST THAT IS THE WHOLE FINDING: a placeholder the contiguous-
      // prefix checker CANNOT see, which placeholderCollision still refuses.
      //
      // RE-MEASURED 2026-09-23 against the boundary at 19 (R-2026-09-23-69), as the
      // note here asked rather than deleted -- and the measurement changed what the
      // note means. A placeholder at any frozen number BELOW the last shifts every
      // frozen file after it, so the prefix checker always sees it. The blind spot is
      // only ever at the LAST frozen number, and only when that file's name sorts
      // before "placeholder": true at 18 (018_close_...), false at 19
      // (019_snapshot_..., "p" < "s"). On today's boundary there is no blind spot.
      // It is CONSTRUCTED here instead, with the boundary cut back to 18 in the scratch
      // tree, so the reason placeholderCollision exists stays demonstrated rather than
      // depending on how the newest migration happens to be named.
      const boundaryPath = join(root, BOUNDARY);
      const boundary = JSON.parse(readFileSync(boundaryPath, 'utf8')) as { frozen: { file: string }[]; ledger_rows: number };
      const cut = boundary.frozen.findIndex((f) => f.file.startsWith('018_'));
      expect(cut, '018 is not in the boundary, so the blind spot cannot be constructed').toBeGreaterThanOrEqual(0);
      writeFileSync(boundaryPath, JSON.stringify({ ...boundary, frozen: boundary.frozen.slice(0, cut + 1), ledger_rows: cut + 1 }, null, 2));
      expect(frozenFilesIn(root).length, 'the cut to 18 did not land').toBe(cut + 1);
      expect(placeholderCollision(root, 18), 'the blind-spot placeholder was accepted by the collision check').not.toBeNull();
      place(root, 'database/migrations/018_placeholder.sql', '-- planted\nselect 1;\n');
      expect(
        frozenViolations(root),
        'the contiguous-prefix checker caught 018_placeholder.sql by itself at a boundary of 18 — re-measure the note above',
      ).toEqual([]);
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
