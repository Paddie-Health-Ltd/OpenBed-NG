import { describe, expect, test } from 'vitest';
import { accessSync, chmodSync, constants, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runLint, withScratch, copyMigrations, place, REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER A GUARD -- scripts/lint_sql_no_bare_not_duty_flag.sh.
 *
 * The lint it checks is the SQL half of finding F2. Its TypeScript twin is the
 * ESLint rule; see tests/compliance/eslint_duty_flag_negation.test.ts.
 *
 * Three legs, per .claude/rules/test-conventions.md: PLANT each false-green and
 * assert rejection; assert the real corpus is ACCEPTED; assert an empty corpus
 * FAILS. A guard that rejects everything is a rubber stamp and one that accepts
 * everything is the defect it was written to close.
 *
 * TWO PASSES SINCE R-2026-09-28-162 (EL-1), and every plant below asserts WHICH
 * pass caught it. `NOT anaesthetist = 'NO'` is caught by both, so a bare exit 1
 * would credit pass B with a line only pass A saw. `passBlock()` reads the lines
 * under one pass's own FAIL header and nothing else.
 */
const LINT = 'lint_sql_no_bare_not_duty_flag.sh';
const BARE = 'bare NOT on a tri-state duty flag';
const NEGATED = 'negated equality on a tri-state duty flag';

/** The lines reported under one pass's FAIL header, up to the next header or the summary. */
function passBlock(stdout: string, header: string): string {
  const out: string[] = [];
  let inside = false;
  for (const line of stdout.split('\n')) {
    if (line.startsWith('FAIL:') || line.startsWith('lint_sql_no_bare_not_duty_flag.sh:')) {
      inside = line.includes(header);
      continue;
    }
    if (inside) out.push(line);
  }
  return out.join('\n');
}

/** Wraps planted lines in a valid migration shell, places it, and confirms the plant landed. */
function plantFile(root: string, name: string, body: string[]): void {
  const text = `-- ===\n-- ${name}\n-- Idempotency: n/a\n-- ===\n${body.join('\n')}\nVALUES ('${name}')\n`;
  place(root, `database/migrations/${name}`, text);
  const landed = readFileSync(join(root, 'database', 'migrations', name), 'utf8');
  for (const line of body) {
    expect(landed, `the plant did not land: ${line}`).toContain(line);
  }
}

// A DUTY-FLAG NAME, in the four shapes EL-1 b names.
const FLAGS: [string, string][] = [
  ['bare', 'anaesthetist'],
  ['qualified', 'ops.obstetrician'],
  ['p_-prefixed', 'p_paediatrician'],
  ['suffixed', 'anaesthetist_on_duty'],
];

// Casts: none, on the flag's side, on the literal's side. Spacing: spaced and unspaced.
const CASTS: [string, string][] = [['', ''], ['::text', ''], ['', '::app.tri_state']];
const SPACES = [' ', ''];

type Shape = (f: string, fc: string, lc: string, s: string) => string;
const SHAPES: [string, Shape][] = [
  ["flag <> 'NO'", (f, fc, lc, s) => `select 1 where ${f}${fc}${s}<>${s}'NO'${lc};`],
  ["flag != 'NO'", (f, fc, lc, s) => `select 1 where ${f}${fc}${s}!=${s}'NO'${lc};`],
  ["reversed 'NO' <> flag", (f, fc, lc, s) => `select 1 where 'NO'${lc}${s}<>${s}${f}${fc};`],
  ["reversed 'NO' != flag", (f, fc, lc, s) => `select 1 where 'NO'${lc}${s}!=${s}${f}${fc};`],
  ["NOT (flag = 'NO')", (f, fc, lc, s) => `select 1 where NOT${s}(${s}${f}${fc}${s}=${s}'NO'${lc}${s});`],
  ["NOT flag = 'NO' (the precedence form)", (f, fc, lc, s) => `select 1 where NOT ${f}${fc}${s}=${s}'NO'${lc};`],
  ["NOT ('NO' = flag), reversed", (f, fc, lc, s) => `select 1 where NOT${s}(${s}'NO'${lc}${s}=${s}${f}${fc}${s});`],
  ["NOT 'NO' = flag, reversed precedence form", (f, fc, lc, s) => `select 1 where NOT 'NO'${lc}${s}=${s}${f}${fc};`],
];

const CATCH_CASES = SHAPES.flatMap(([shape, fn]) =>
  FLAGS.map(([kind, flag]) => [shape, kind, CASTS.flatMap(([fc, lc]) => SPACES.map((s) => fn(flag, fc, lc, s)))] as const),
);

describe('lint_sql_no_bare_not_duty_flag', () => {
  test('real corpus is accepted', () => {
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, res.stdout).toBe(0);
    expect(res.stdout).toContain('PASS');
  });

  test.each([
    ['bare NOT on a bare identifier', 'select 1 where not anaesthetist;'],
    ['bare NOT on a qualified column', 'select 1 where not ops.paediatrician;'],
    ['bare NOT on NEW in a trigger', 'if not NEW.obstetrician then return null; end if;'],
    ['mixed case', 'SELECT 1 WHERE NoT ops.anaesthetist;'],
    ['bare NOT on a p_-prefixed parameter (EL-1 b)', 'select 1 where not p_anaesthetist;'],
    ['bare NOT on a suffixed boolean regression (EL-1 b)', 'select 1 where not anaesthetist_on_duty;'],
  ])('plant — %s is rejected', (_name, snippet) => {
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/900_plant.sql', `-- ===\n-- 900_plant.sql\n-- Idempotency: n/a\n-- ===\n${snippet}\nVALUES ('900_plant.sql')\n`);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, 'the guard rejected but did not name the rule').toContain(BARE);
      expect(passBlock(res.stdout, BARE), `pass A did not report the planted line:\n${res.stdout}`).toContain(snippet);
    });
  });

  test.each(CATCH_CASES)('plant — %s on a %s flag, every cast and spacing, is rejected by pass B', (_shape, _kind, lines) => {
    withScratch((root) => {
      copyMigrations(root);
      plantFile(root, '902_plant.sql', [...lines]);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, 'the guard rejected but did not name the rule').toContain(NEGATED);
      const block = passBlock(res.stdout, NEGATED);
      for (const line of lines) {
        expect(block, `pass B did not report: ${line}\n${res.stdout}`).toContain(line);
      }
    });
  });

  test('plant — a negated equality inside a $$ function body is rejected', () => {
    const line = "    SELECT o.anaesthetist <> 'NO' FROM app.facility_ops o;";
    withScratch((root) => {
      copyMigrations(root);
      plantFile(root, '903_plant.sql', [
        'CREATE OR REPLACE FUNCTION app.plant_probe() RETURNS boolean LANGUAGE sql AS $$',
        line,
        '$$;',
      ]);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
      expect(passBlock(res.stdout, NEGATED), `pass B did not report the $$ body:\n${res.stdout}`).toContain(line);
    });
  });

  test('plant — a negated equality in a .down.sql file is rejected', () => {
    const line = "select 1 where p_obstetrician != 'NO';";
    withScratch((root) => {
      copyMigrations(root);
      plantFile(root, '904_plant.down.sql', [line]);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout).toContain('904_plant.down.sql');
      expect(passBlock(res.stdout, NEGATED), `pass B did not report the .down line:\n${res.stdout}`).toContain(line);
    });
  });

  test('plant — a negated equality inside a /* */ block is rejected (blocks are NOT stripped, deliberately)', () => {
    // No migration from 001 to 026 holds a /* */ block, so the lint reads one as
    // code. A block comment that quotes the wrong form must be a `--` comment.
    const line = "/* never write anaesthetist <> 'NO' */";
    withScratch((root) => {
      copyMigrations(root);
      plantFile(root, '905_plant.sql', [line]);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
      expect(passBlock(res.stdout, NEGATED)).toContain(line);
    });
  });

  test("plant — NOT flag IS DISTINCT FROM 'NO' is flagged by pass A: the accepted false positive, and pass B leaves it alone", () => {
    // Correct and total -- NOT binds looser than IS DISTINCT FROM -- but pass A
    // reads `NOT p_anaesthetist` and fires. The header names this; this leg keeps
    // the header true.
    const line = "select 1 where NOT p_anaesthetist IS DISTINCT FROM 'NO';";
    withScratch((root) => {
      copyMigrations(root);
      plantFile(root, '906_plant.sql', [line]);
      const res = runLint(LINT, root);
      expect(res.status, `the named false positive was accepted:\n${res.stdout}`).toBe(1);
      expect(passBlock(res.stdout, BARE)).toContain('NOT p_anaesthetist IS DISTINCT FROM');
      expect(res.stdout, 'pass B fired on a correct form').not.toContain(NEGATED);
    });
  });

  test.each([
    ["IS NOT DISTINCT FROM 'NO'", "select 1 where anaesthetist IS NOT DISTINCT FROM 'NO';"],
    ["IS DISTINCT FROM 'NO'", "select 1 where p_obstetrician IS DISTINCT FROM 'NO'::app.tri_state;"],
    ["a positive = 'NO'", "select 1 where ops.paediatrician = 'NO';"],
    ["coalesce(flag, 'UNKNOWN') <> 'NO', which is total", "select 1 where coalesce(anaesthetist, 'UNKNOWN') <> 'NO';"],
    ["a non-duty col <> 'NO'", "select 1 where category <> 'NO';"],
    ["NOT EXISTS (... flag = 'NO')", "select 1 where NOT EXISTS (SELECT 1 FROM app.facility_ops o WHERE o.anaesthetist = 'NO');"],
    ["a COMMENT ON literal quoting <> ''NO''", "COMMENT ON COLUMN app.facility_ops.anaesthetist IS 'never write anaesthetist <> ''NO'' here';"],
    ['a -- comment quoting the wrong form', "-- never write anaesthetist <> 'NO' or NOT (obstetrician = 'NO')"],
  ])('control — %s is ACCEPTED', (_name, line) => {
    withScratch((root) => {
      copyMigrations(root);
      plantFile(root, '907_control.sql', [line]);
      const res = runLint(LINT, root);
      expect(res.status, `a correct form tripped the lint:\n${res.stdout}`).toBe(0);
    });
  });

  test("control — 026:141's WHERE NOT ( (role = 'WARD_STAFF' ..., the trap for a matcher that reads across lines, is ACCEPTED", () => {
    const real = readFileSync(join(REPO_ROOT, 'database', 'migrations', '026_facility_reporter_and_checks.sql'), 'utf8').split('\n');
    const line = real[140] as string;
    expect(line, '026:141 is no longer the line this control copies').toContain("WHERE NOT (   (role = 'WARD_STAFF'");
    withScratch((root) => {
      copyMigrations(root);
      plantFile(root, '908_control.sql', ['select 1 from app.ward_account', line, ...real.slice(141, 144)]);
      const res = runLint(LINT, root);
      expect(res.status, `026:141 tripped the lint:\n${res.stdout}`).toBe(0);
    });
  });

  test('plant — the same text inside a comment is ACCEPTED', () => {
    // The false-positive direction, and it is not a nicety. Migration 003 carries
    // a COMMENT ON COLUMN that quotes the wrong form so a reader knows what to
    // avoid. A lint that fires on its own documentation is a lint people delete,
    // and then nothing guards the real thing.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'database/migrations/901_plant.sql',
        `-- ===\n-- 901_plant.sql\n-- Idempotency: n/a\n-- Never write: not ops.anaesthetist\n-- ===\n` +
        `COMMENT ON TABLE app.facility IS 'do not use not anaesthetist here';\n` +
        `VALUES ('901_plant.sql')\n`);
      const res = runLint(LINT, root);
      expect(res.status, `a comment tripped the lint:\n${res.stdout}`).toBe(0);
    });
  });

  test('plant — an UNREADABLE migration FAILS rather than reporting clean', () => {
    // Until R-2026-09-28-162 this read PASS: `sed | grep` under pipefail reports
    // the LAST non-zero status, so grep's 1 (no match) hid sed's failure to read.
    withScratch((root) => {
      copyMigrations(root);
      plantFile(root, '909_plant.sql', ["select 1 where anaesthetist <> 'NO';"]);
      const target = join(root, 'database', 'migrations', '909_plant.sql');
      chmodSync(target, 0o000);
      try {
        // The precondition is the plant: a user who can read a mode-000 file (root)
        // cannot run this leg, and must see why rather than a green.
        expect(() => accessSync(target, constants.R_OK), 'this user can read a mode-000 file; the plant did not take').toThrow();
        const res = runLint(LINT, root);
        expect(res.status, `an unreadable migration did not fail loudly:\n${res.stdout}`).toBe(2);
        expect(res.stdout, 'the read refusal did not name itself').toContain('the duty-flag read exited');
        expect(res.stdout).not.toContain('PASS');
      } finally {
        chmodSync(target, 0o644);
      }
    });
  });

  test('anti-vacuity — an empty corpus FAILS rather than reporting clean', () => {
    withScratch((root) => {
      place(root, 'database/migrations/.keep', '');
      const res = runLint(LINT, root);
      expect(res.status, 'a lint that scanned nothing reported success').toBe(2);
      expect(res.stdout, 'the empty-corpus refusal did not name itself').toContain('no migrations found in');
    });
  });

  test('anti-vacuity — a missing migration directory FAILS', () => {
    withScratch((root) => {
      place(root, 'unrelated.txt', 'x');
      const res = runLint(LINT, root);
      expect(res.status, `a missing corpus did not fail loudly:\n${res.stdout}`).toBe(2);
      // Only the message separates this leg from the empty-corpus leg below it.
      expect(res.stdout, 'the missing-directory refusal did not name itself').toContain('no migration directory at');
    });
  });
});
