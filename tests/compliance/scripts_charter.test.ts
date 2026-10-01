import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';

/**
 * GUARD: THE SCRIPTS CHARTER HAS ONE TRUE ROW PER FILE UNDER scripts/
 * (R-2026-09-29-171, EU-4).
 *
 * THE CHARTER. docs/scripts-charter.md gives every file directly under scripts/ its
 * stated reason, the tests that plant it, whether they plant it both ways, whether the
 * stated reason itself was probed or only the outcome, its legs from the leg register,
 * and a verdict. It is the scripts/ survey's last item, and its FINDING rows are ruled
 * on in S-c's merge letter, not fixed where they are found.
 *
 * WHAT IS HELD, one plant per failure mode:
 *   - the rows equal the files under scripts/, in both directions, with no duplicate --
 *     so no script lands without a row, and no row outlives its script;
 *   - each test the charter names exists;
 *   - each legs cell reads `<reached> / <registered>`, counted by state from
 *     packages/fixtures/leg-coverage.json's guards[<file>] (leg_coverage.test.ts holds
 *     that file equal to the parsed legs), or `0 / 0` for a file with none;
 *   - each stated reason is 15 words or fewer;
 *   - the verdict follows the rule: FINDING when the tests cell is none, both-ways is
 *     no, or the reason was probed for outcome only; otherwise NOT ASSERTED for a
 *     hosted script (the HOSTED list below) and OK for every other. FINDING outranks
 *     NOT ASSERTED.
 *   - a library row names its callers ("via ..."), because it is credited through them.
 *
 * A LEG CHANGE NOW ALSO EDITS THE CHARTER. A leg added, removed or moved between
 * reached and registered changes the legs cell, and this test reds until the row says
 * so.
 *
 * NOT ASSERTED HERE, deliberately: that a "probed" cell is TRUE, or a "yes" in both
 * ways. Each is a reading of a test against a script's header -- whether the plant
 * makes the stated reason the only difference -- made by the reviewer (EV) and the
 * merge letter, not by a parser. A parser here would check that the word is present,
 * which is the defect it would claim to close.
 */

const CHARTER = join(REPO_ROOT, 'docs', 'scripts-charter.md');
const SCRIPTS = join(REPO_ROOT, 'scripts');
const LEGS = join(REPO_ROOT, 'packages', 'fixtures', 'leg-coverage.json');

export const HEADER = '| Script | Stated reason | Planting test(s) | Both ways? | Probed or outcome only | Legs reached / registered | Verdict |';

/** Scripts whose live verdict is against a hosted service, so it is never run here. */
export const HOSTED = [
  'deploy_pages.sh',
  'deploy_worker.sh',
  'get_extra_search_path.sh',
  'get_publishable_key.sh',
  'provision_ward_account.mjs',
  'readback_admin.sh',
  'readback_common.sh',
  'readback_function_grants.sh',
  'readback_pages.sh',
  'readback_public_output.sh',
  'readback_ward_console.sh',
  'readback_worker.sh',
  'readback_worker_limits.sh',
];

/** Files with no entry point of their own, credited through their callers. */
export const LIBRARIES = ['deferred_register.d.mts', 'deferred_register.mjs', 'provision_target.mjs', 'readback_common.sh'];

type Guards = Record<string, Record<string, { state: string }>>;

export interface CharterInput {
  md: string;
  scripts: string[];
  guards: Guards;
  exists: (repoRelative: string) => boolean;
}

export function charterViolations({ md, scripts, guards, exists }: CharterInput): string[] {
  const out: string[] = [];
  if (scripts.length === 0) return ['no files found under scripts/ — the charter was checked against nothing'];
  const lines = md.split('\n');
  const at = lines.indexOf(HEADER);
  if (at === -1) return [`no table headed "${HEADER}" in the charter`];
  if (!/^\|(?:\s*:?-{3,}:?\s*\|){7}$/.test(lines[at + 1] ?? '')) return ['the charter header has no seven-column separator under it'];

  const seen = new Map<string, number>();
  for (let i = at + 2; i < lines.length && (lines[i] ?? '').startsWith('|'); i += 1) {
    const raw = lines[i] as string;
    const cells = raw.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length !== 7) {
      out.push(`line ${i + 1}: a charter row needs 7 cells and has ${cells.length}`);
      continue;
    }
    const [script, reason, tests, both, probed, legs, verdict] = cells as [string, string, string, string, string, string, string];
    seen.set(script, (seen.get(script) ?? 0) + 1);

    const words = reason.split(/\s+/).filter((w) => w !== '');
    if (words.length === 0 || words.length > 15) out.push(`${script}: the stated reason is ${words.length} words; 1 to 15 are allowed`);

    const named = [...tests.matchAll(/`(tests\/[^`]+)`/g)].map((m) => m[1] as string);
    if (tests !== 'none' && named.length === 0) out.push(`${script}: the tests cell names no test and is not "none"`);
    for (const t of named) if (!exists(t)) out.push(`${script}: the named test ${t} does not exist`);
    if (LIBRARIES.includes(script)) {
      const via = /^via ([^:]+):/.exec(tests);
      if (!via) out.push(`${script}: a library row must name its callers ("via <caller>, ...: ")`);
    }

    if (both !== 'yes' && both !== 'no') out.push(`${script}: both-ways reads "${both}", not yes or no`);
    if (probed !== 'probed' && probed !== 'outcome only') out.push(`${script}: the probe cell reads "${probed}", not probed or outcome only`);

    const entry = Object.values(guards[script] ?? {});
    const want = `${entry.filter((e) => e.state === 'reached').length} / ${entry.filter((e) => e.state === 'registered').length}`;
    if (legs !== want) out.push(`${script}: the legs cell reads "${legs}", and the leg register gives "${want}"`);

    const finding = tests === 'none' || both === 'no' || probed === 'outcome only';
    const expected = finding ? 'FINDING' : HOSTED.includes(script) ? 'NOT ASSERTED' : 'OK';
    if (verdict !== expected) out.push(`${script}: the verdict is "${verdict}", and the rule gives "${expected}"`);
  }

  for (const [s, n] of seen) if (n > 1) out.push(`${s}: ${n} rows; one is required`);
  for (const s of scripts) if (!seen.has(s)) out.push(`${s}: a file under scripts/ with no charter row`);
  for (const s of seen.keys()) if (!scripts.includes(s)) out.push(`${s}: a charter row with no file under scripts/`);
  return out;
}

const realInput = (): CharterInput => ({
  md: readFileSync(CHARTER, 'utf8'),
  scripts: readdirSync(SCRIPTS).filter((n) => statSync(join(SCRIPTS, n)).isFile()).sort(),
  guards: (JSON.parse(readFileSync(LEGS, 'utf8')) as { guards: Guards }).guards,
  exists: (p) => existsSync(join(REPO_ROOT, p)),
});

/** The real charter with one textual change; the plant is confirmed to have landed. */
function planted(from: string | RegExp, to: string): string[] {
  const input = realInput();
  const md = input.md.replace(from, to);
  expect(md, `the plant did not land: ${String(from)}`).not.toBe(input.md);
  return charterViolations({ ...input, md });
}

/** The charter row for a script, exactly as written. */
function rowOf(script: string): string {
  const row = realInput().md.split('\n').find((l) => l.startsWith(`| ${script} |`));
  expect(row, `no row for ${script}`).toBeDefined();
  return row as string;
}

/** A row with one cell replaced; cells are 1-indexed after the script name. */
function withCell(row: string, index: number, value: string): string {
  const cells = row.split('|');
  cells[index + 1] = ` ${value} `;
  return cells.join('|');
}

describe('scripts charter — one true row per file under scripts/', () => {
  test('real docs/scripts-charter.md is accepted', () => {
    expect(charterViolations(realInput()), 'the charter is out of step with scripts/ or the leg register').toEqual([]);
  });

  test('the charter covers every file under scripts/, the library and declaration files included', () => {
    const { scripts } = realInput();
    expect(scripts, 'the register module is outside the charter corpus').toContain('deferred_register.d.mts');
    expect(scripts.length, 'the corpus shrank to almost nothing').toBeGreaterThan(40);
  });

  test('plant — a script with no row is rejected', () => {
    const input = realInput();
    const v = charterViolations({ ...input, scripts: [...input.scripts, 'lint_new.sh'] });
    expect(v).toContain('lint_new.sh: a file under scripts/ with no charter row');
  });

  test('plant — a row with no script is rejected', () => {
    const input = realInput();
    const v = charterViolations({ ...input, scripts: input.scripts.filter((s) => s !== 'seed.sh') });
    expect(v).toContain('seed.sh: a charter row with no file under scripts/');
  });

  test('plant — a duplicate row is rejected', () => {
    const row = rowOf('gate.sh');
    const v = planted(row, `${row}\n${row}`);
    expect(v).toContain('gate.sh: 2 rows; one is required');
  });

  test('plant — a legs cell off by one is rejected', () => {
    const row = rowOf('seed.sh');
    const legs = (row.split('|')[6] ?? '').trim();
    const [r, g] = legs.split(' / ').map(Number) as [number, number];
    const v = planted(row, withCell(row, 5, `${r + 1} / ${g}`));
    expect(v.join('\n')).toContain(`seed.sh: the legs cell reads "${r + 1} / ${g}", and the leg register gives "${legs}"`);
  });

  test('plant — a named test that does not exist is rejected', () => {
    const row = rowOf('seed.sh');
    // The missing path is assembled at run time: backticked whole in this file, it would be a
    // citation of a path that does not exist, which no_phantom_paths.test.ts rightly refuses.
    const missing = ['tests', 'compliance', 'seed_nowhere.test.ts'].join('/');
    const v = planted(row, row.replace('`tests/compliance/seed_local_only.test.ts`', `\`${missing}\``));
    expect(v).toContain('seed.sh: the named test tests/compliance/seed_nowhere.test.ts does not exist');
  });

  test('plant — a 16-word reason is rejected', () => {
    const row = rowOf('gate.sh');
    const v = planted(row, withCell(row, 1, 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen'));
    expect(v).toContain('gate.sh: the stated reason is 16 words; 1 to 15 are allowed');
  });

  test('plant — a none row not marked FINDING is rejected', () => {
    const row = rowOf('gate.sh');
    const v = planted(row, withCell(withCell(row, 2, 'none'), 6, 'OK'));
    expect(v).toContain('gate.sh: the verdict is "OK", and the rule gives "FINDING"');
  });

  test('plant — a both-ways-no row not marked FINDING is rejected', () => {
    const row = rowOf('seed.sh');
    const v = planted(row, withCell(withCell(row, 3, 'no'), 6, 'OK'));
    expect(v).toContain('seed.sh: the verdict is "OK", and the rule gives "FINDING"');
  });

  test('plant — an outcome-only row not marked FINDING is rejected', () => {
    const row = rowOf('seed.sh');
    const v = planted(row, withCell(withCell(row, 4, 'outcome only'), 6, 'OK'));
    expect(v).toContain('seed.sh: the verdict is "OK", and the rule gives "FINDING"');
  });

  test('plant — NOT ASSERTED on a script that is not hosted is rejected', () => {
    const row = rowOf('seed.sh');
    const v = planted(row, withCell(row, 6, 'NOT ASSERTED'));
    expect(v).toContain('seed.sh: the verdict is "NOT ASSERTED", and the rule gives "OK"');
  });

  test('plant — a library row naming no caller is rejected', () => {
    const row = rowOf('readback_common.sh');
    const v = planted(row, row.replace(/\| via [^:]+: /, '| '));
    expect(v).toContain('readback_common.sh: a library row must name its callers ("via <caller>, ...: ")');
  });

  test('plant — no table is rejected', () => {
    const v = planted(HEADER, '| Script | Reason |');
    expect(v).toEqual([`no table headed "${HEADER}" in the charter`]);
  });

  test('plant — a header with no separator is rejected', () => {
    const v = planted(`${HEADER}\n|---|---|---|---|---|---|---|`, `${HEADER}\n| x |`);
    expect(v).toEqual(['the charter header has no seven-column separator under it']);
  });

  test('anti-vacuity — a charter checked against no files fails', () => {
    const v = charterViolations({ ...realInput(), scripts: [] });
    expect(v).toEqual(['no files found under scripts/ — the charter was checked against nothing']);
  });
});
