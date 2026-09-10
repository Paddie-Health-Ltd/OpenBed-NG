import { describe, expect, test } from 'vitest';
import { runLint, withScratch, copyMigrations, place, REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER A GUARD -- scripts/lint_no_drop_cascade.sh.
 *
 * WRITTEN 2026-09-10, AND IT SHOULD HAVE EXISTED SINCE BUNDLE 1. That lint had
 * NO TEST OF ANY KIND -- the second of two guards in this repository found in
 * that state. Its awk could be inverted, mis-anchored, or made to print nothing
 * and the only thing that would notice is the day it mattered.
 *
 * WHY THE SUBJECT MATTERS. Forward-migration `DROP TABLE ... CASCADE` silently
 * removes dependent objects nothing in the migration mentions -- a projection
 * trigger, a foreign key, a published table's publication membership. `.down.sql`
 * files are excluded because a legitimate reversal drops what it created.
 *
 * THE ESCAPE HATCH IS AS UNPROVEN AS THE GUARD, so it is planted in both its
 * forms. `OPENBED-CASCADE-OVERRIDE` is honoured on the same line OR the line
 * above; an awk change that broke the `prev` branch would make every annotated
 * drop start failing, and the first person to hit it would delete the guard
 * rather than debug it.
 *
 * NOT ASSERTED HERE, deliberately: that a CASCADE which SHOULD have been
 * annotated was annotated for a good reason. The override is a human judgement
 * and a lint claiming to check it would be theatre. What is checked is that the
 * annotation is required, honoured, and honoured in both positions.
 */
const LINT = 'lint_no_drop_cascade.sh';
const RULE = 'DROP TABLE ... CASCADE without an OPENBED-CASCADE-OVERRIDE';

const banner = (name: string, body: string): string =>
  `-- ===\n-- ${name}\n-- Idempotency: n/a\n-- ===\n${body}\nVALUES ('${name}')\n`;

describe('lint_no_drop_cascade', () => {
  test('real corpus is accepted', () => {
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, `the real migration corpus was rejected:\n${res.stdout}`).toBe(0);
    expect(res.stdout).toContain('PASS');
  });

  test.each([
    ['plain', 'DROP TABLE app.ward_status CASCADE;'],
    ['lower case', 'drop table app.ward_status cascade;'],
    ['IF EXISTS between the keywords', 'DROP TABLE IF EXISTS public.ward_public CASCADE;'],
    ['extra whitespace', 'DROP   TABLE    app.facility    CASCADE ;'],
  ])('plant — an unannotated CASCADE (%s) is rejected', (_name, snippet) => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_plant.sql', banner('900_plant.sql', snippet));
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, `the guard rejected but did not name the rule:\n${res.stdout}`).toContain(RULE);
    });
  });

  test('positive control — the override on the SAME line is honoured', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/901_plant.sql',
        banner('901_plant.sql', 'DROP TABLE app.ward_status CASCADE; -- OPENBED-CASCADE-OVERRIDE'));
      const res = runLint(LINT, root);
      expect(res.status, `a same-line override was rejected:\n${res.stdout}`).toBe(0);
    });
  });

  test('positive control — the override on the PREVIOUS line is honoured', () => {
    // The `prev` branch of the awk. Unplanted until now, and the half most
    // likely to break silently: nothing else in the repository exercises it.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/902_plant.sql',
        banner('902_plant.sql', '-- OPENBED-CASCADE-OVERRIDE: dropping a table this migration created\nDROP TABLE app.ward_status CASCADE;'));
      const res = runLint(LINT, root);
      expect(res.status, `a previous-line override was rejected:\n${res.stdout}`).toBe(0);
    });
  });

  test('positive control — a CASCADE in a .down.sql is not a violation', () => {
    // A legitimate reversal drops the tables it created. A lint that fired here
    // would make every down migration unwritable.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/903_plant.down.sql', 'DROP TABLE app.ward_status CASCADE;\n');
      const res = runLint(LINT, root);
      expect(res.status, `a down migration was treated as forward:\n${res.stdout}`).toBe(0);
    });
  });

  test('positive control — a DROP without CASCADE is accepted', () => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/904_plant.sql', banner('904_plant.sql', 'DROP TABLE app.ward_status;'));
      const res = runLint(LINT, root);
      expect(res.status, `a plain DROP was rejected:\n${res.stdout}`).toBe(0);
    });
  });

  test('anti-vacuity — an empty corpus FAILS rather than reporting clean', () => {
    withScratch((root) => {
      place(root, 'database/migrations/.keep', '');
      const res = runLint(LINT, root);
      expect(res.status, `a lint that scanned nothing reported success:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the empty-corpus refusal did not name itself').toContain('no forward migrations found in');
    });
  });

  test('anti-vacuity — a missing migration directory FAILS', () => {
    withScratch((root) => {
      place(root, 'unrelated.txt', 'x');
      const res = runLint(LINT, root);
      expect(res.status, `a missing corpus did not fail loudly:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the missing-directory refusal did not name itself').toContain('no migration directory at');
    });
  });
});
