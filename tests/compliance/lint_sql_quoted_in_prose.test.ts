import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { accessSync, chmodSync, constants, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runLint, withScratch, place, REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER A GUARD -- scripts/lint_sql_quoted_in_prose.sh (R-2026-09-28-162, EL-2 a).
 *
 * The defect it closes: SQL quoted in prose with its quotes stripped. The
 * corrections section of database/migrations/README.md once prescribed
 * `IS NOT DISTINCT FROM NO`; unquoted, NO is an identifier and the line does not
 * run. Nothing validated SQL quoted in prose (the scripts/ survey's item 2).
 *
 * Three legs per .claude/rules/test-conventions.md section 2, with the plants run
 * in a scratch git repository BUILT BY THE TEST: files are `git add`ed so
 * `git ls-files` sees them, and nothing is ever committed, here or in the real
 * repository.
 *
 * ANTI-VACUITY IS PER LOCATION. The script reads three disjoint locations, and a
 * location that stopped resolving is silent from the green unless each is
 * counted on its own (section 2 d).
 */
const LINT = 'lint_sql_quoted_in_prose.sh';
const HIT = 'unquoted tri-state literal in quoted SQL';
const RECORD = 'Sprint Kickoffs/decision-2026-09-14-public-private-split.md';

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A scratch repository holding one clean file in each of the three locations. */
function scratchRepo(root: string, extra: Record<string, string> = {}, omit: string[] = []): void {
  git(root, 'init', '-q');
  const files: Record<string, string> = {
    'README.md': "Compare with `flag IS NOT DISTINCT FROM 'NO'`.\n",
    '.claude/rules/r.md': 'A rule with no SQL in it.\n',
    'database/migrations/001_a.sql': "-- a comment with no comparison\nselect 1 where x = 'NO';\n",
    ...extra,
  };
  for (const [path, text] of Object.entries(files)) {
    if (omit.includes(path)) continue;
    place(root, path, text);
    const landed = readFileSync(join(root, path), 'utf8');
    expect(landed, `the plant did not land at ${path}`).toBe(text);
    git(root, 'add', '--', path);
  }
}

describe('lint_sql_quoted_in_prose', () => {
  test('real corpus is accepted', () => {
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, `the real tree was rejected:\n${res.stdout}`).toBe(0);
    expect(res.stdout).toContain('PASS');
  });

  test.each([
    ['a tracked .md file', 'docs/note.md', 'Run `select 1 where anaesthetist IS NOT DISTINCT FROM NO`.\n'],
    ['a rules file', '.claude/rules/x.md', 'Compare with `flag <> NO` and nothing else.\n'],
    ['a migration -- comment', 'database/migrations/002_b.sql', "-- the gate reads p_obstetrician = UNKNOWN here\nselect 1;\n"],
    ['!= with YES', 'docs/b.md', 'Write `accepting != YES`.\n'],
    ['IS DISTINCT FROM in lower case', 'docs/c.md', 'Write `flag is distinct from NO`.\n'],
    ['= at end of line', 'docs/d.md', 'where anaesthetist = NO\n'],
  ])('plant — an unquoted literal in %s is rejected', (_where, path, text) => {
    withScratch((root) => {
      scratchRepo(root, { [path]: text });
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, 'the guard rejected but did not name the rule').toContain(HIT);
      expect(res.stdout, 'the guard did not name the file').toContain(path);
      expect(res.stdout, 'the guard ran FAILED without its summary').toContain('lint_sql_quoted_in_prose.sh: FAILED');
    });
  });

  test.each([
    ['= now()', 'where updated_at = now()\n'],
    ['=> NO', 'call f(p => NO)\n'],
    ["= 'NO'", "where anaesthetist = 'NO'\n"],
    ["IS NOT DISTINCT FROM 'NO'::app.tri_state", "where p_anaesthetist IS NOT DISTINCT FROM 'NO'::app.tri_state\n"],
    ['NO_ANAESTHETIST_ON_DUTY', '`gated_by = NO_ANAESTHETIST_ON_DUTY`\n'],
    ['a lower-case literal, which is prose', 'the answer = no, not today\n'],
  ])('control — %s is ACCEPTED', (_name, text) => {
    withScratch((root) => {
      scratchRepo(root, { 'docs/control.md': text });
      const res = runLint(LINT, root);
      expect(res.status, `a correct form tripped the lint:\n${res.stdout}`).toBe(0);
    });
  });

  test('control — an unquoted literal in migration CODE (not a comment) is not this guard\'s corpus', () => {
    withScratch((root) => {
      scratchRepo(root, { 'database/migrations/003_c.sql': 'select 1 where x = NO;\n' });
      const res = runLint(LINT, root);
      expect(res.status, `migration code was read as prose:\n${res.stdout}`).toBe(0);
    });
  });

  test('plant — the decision record is OUT OF SCOPE by path, and the same text is caught once renamed', () => {
    const text = 'The broken form read `IS NOT DISTINCT FROM NO`.\n';
    withScratch((root) => {
      scratchRepo(root, { [RECORD]: text });
      const excluded = runLint(LINT, root);
      expect(excluded.status, `the excluded record was scanned:\n${excluded.stdout}`).toBe(0);

      git(root, 'mv', '--', RECORD, 'Sprint Kickoffs/renamed.md');
      const renamed = runLint(LINT, root);
      expect(renamed.status, `the renamed record was not scanned:\n${renamed.stdout}`).toBe(1);
      expect(renamed.stdout).toContain(HIT);
      expect(renamed.stdout).toContain('Sprint Kickoffs/renamed.md');
    });
  });

  test('the exclusion in the filter is the one the header names, and it is a tracked file', () => {
    // Section 2 d: the filter is written next to the claim, and this reads both.
    const src = readFileSync(join(REPO_ROOT, 'scripts', LINT), 'utf8');
    const filter = /^EXCLUDED='([^']+)'$/m.exec(src);
    expect(filter, 'no EXCLUDED= line in the script').not.toBeNull();
    const header = src.split('\n').filter((l) => l.startsWith('#')).join('\n');
    const notAsserted = header.slice(header.indexOf('NOT ASSERTED HERE'));
    expect(header, 'the header has no NOT ASSERTED HERE block').toContain('NOT ASSERTED HERE');
    expect(notAsserted.replace(/\n#\s*/g, ' '), 'the header does not name the path the filter excludes').toContain(filter?.[1] as string);
    const tracked = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '--', filter?.[1] as string], { encoding: 'utf8' }).trim();
    expect(tracked, 'the excluded path is not a tracked file; the exclusion is stale').toBe(filter?.[1]);
  });

  test('anti-vacuity — no tracked .md file outside the rules FAILS', () => {
    withScratch((root) => {
      scratchRepo(root, {}, ['README.md']);
      const res = runLint(LINT, root);
      expect(res.status, `an empty location reported clean:\n${res.stdout}`).toBe(2);
      expect(res.stdout).toContain('no tracked .md files outside .claude/rules');
    });
  });

  test('anti-vacuity — no tracked rules file FAILS', () => {
    withScratch((root) => {
      scratchRepo(root, {}, ['.claude/rules/r.md']);
      const res = runLint(LINT, root);
      expect(res.status, `an empty location reported clean:\n${res.stdout}`).toBe(2);
      expect(res.stdout).toContain('no tracked files under .claude/rules');
    });
  });

  test('anti-vacuity — no migration FAILS', () => {
    withScratch((root) => {
      scratchRepo(root, {}, ['database/migrations/001_a.sql']);
      place(root, 'database/migrations/.keep', '');
      const res = runLint(LINT, root);
      expect(res.status, `an empty location reported clean:\n${res.stdout}`).toBe(2);
      expect(res.stdout).toContain('no migrations found in');
    });
  });

  test('anti-vacuity — a missing migration directory FAILS', () => {
    withScratch((root) => {
      scratchRepo(root, {}, ['database/migrations/001_a.sql']);
      const res = runLint(LINT, root);
      expect(res.status, `a missing location reported clean:\n${res.stdout}`).toBe(2);
      expect(res.stdout).toContain('no migration directory at');
    });
  });

  test.each([
    ['a tracked .md file', 'README.md', 'the prose scan exited'],
    ['a migration', 'database/migrations/001_a.sql', 'the comment read of a migration exited'],
  ])('plant — an UNREADABLE %s FAILS rather than reporting clean', (_what, path, message) => {
    withScratch((root) => {
      scratchRepo(root);
      const target = join(root, path);
      chmodSync(target, 0o000);
      try {
        // The precondition is the plant: a user who can read a mode-000 file (root)
        // cannot run this leg, and must see why rather than a green.
        expect(() => accessSync(target, constants.R_OK), 'this user can read a mode-000 file; the plant did not take').toThrow();
        const res = runLint(LINT, root);
        expect(res.status, `an unreadable file did not fail loudly:\n${res.stdout}`).toBe(2);
        expect(res.stdout).toContain(message);
        expect(res.stdout).not.toContain('PASS');
      } finally {
        chmodSync(target, 0o644);
      }
    });
  });

  test('anti-vacuity — a root that is not a git repository FAILS', () => {
    withScratch((root) => {
      place(root, 'README.md', 'x = NO\n');
      const res = runLint(LINT, root);
      expect(res.status, `a root git could not list reported clean:\n${res.stdout}`).toBe(2);
      expect(res.stdout).toContain('could not list tracked files');
    });
  });
});
