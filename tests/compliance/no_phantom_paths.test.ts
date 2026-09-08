import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';

/**
 * CLAUSE 4 — NO PHANTOM ENFORCEMENT, enforced mechanically.
 *
 * Every repo-relative path cited in backticks anywhere in this repository must
 * exist. A rule, comment or document that names a script, test or job which is
 * not there reads EXACTLY like one that is, to every future reader -- which is a
 * false statement at the level of the constitution, and worse than an admitted
 * gap because it stops anyone looking.
 *
 * SCOPE, taken from Clause 4 itself. A cited path is in scope if it appears in
 * backticks, contains a `/`, and is not introduced as a negative or hypothetical
 * example. Bare basenames are out of scope. Glob segments are trimmed before
 * checking, because `apps/*` and `tests/db/**` name a shape, not a file.
 *
 * This guard is what discharges the clause. Without it, "no phantom enforcement"
 * would itself be a rule with no enforcement artefact -- which is the defect it
 * describes, applied to itself.
 */

/**
 * Paths cited deliberately BECAUSE THEY DO NOT EXIST.
 *
 * Each entry needs a reason, and the reason has to be that the citation is a
 * negative claim. This list is not a place to park a path someone forgot to
 * create -- that is precisely what the guard is for.
 */
const DELIBERATE_ABSENCES: Record<string, string> = {
  'supabase/migrations':
    'Cited in README.md, database/migrations/README.md and supabase/config.toml as ' +
    'DELIBERATELY EMPTY. The Supabase CLI would apply that directory with its own ' +
    'ledger and its own naming, and two runners over one schema corrupts it. Its ' +
    'absence is the design; every citation of it is a negative claim.',
};

const SOURCE_EXT = /\.(md|ts|tsx|sh|sql|yml|yaml|mjs|json|toml)$/;
const TOP_LEVEL = /^(apps|packages|scripts|tests|database|docs|supabase|\.github|\.ci|\.claude)\//;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', '.next', 'coverage'].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (SOURCE_EXT.test(name)) acc.push(full);
  }
  return acc;
}

interface Citation {
  path: string;
  citedIn: string;
}

function collectCitations(): Citation[] {
  const out: Citation[] = [];
  for (const file of sourceFiles(REPO_ROOT)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/`([A-Za-z0-9_.\/-]*\/[A-Za-z0-9_.\/-]+)`/g)) {
      const raw = m[1] ?? '';
      if (/^(https?:|\.\.?\/|\/)/.test(raw)) continue;
      if (!TOP_LEVEL.test(raw)) continue;
      // Trim glob tails: a path naming a shape is not a path naming a file.
      const clean = raw.replace(/\/\*.*$/, '').replace(/\/$/, '');
      if (clean.includes('*')) continue;
      out.push({ path: clean, citedIn: file.replace(`${REPO_ROOT}/`, '') });
    }
  }
  return out;
}

describe('Clause 4 — no phantom enforcement', () => {
  const citations = collectCitations();

  test('the audit found citations to check — it is not scanning an empty set', () => {
    // Anti-vacuity, and it has teeth here: if the regex or the top-level filter
    // ever stops matching, this guard would pass over nothing and report green
    // for every phantom in the repository.
    expect(citations.length, 'no repo-relative citations found at all').toBeGreaterThan(30);
  });

  test('every cited repo-relative path exists', () => {
    const missing = citations
      .filter((c) => !(c.path in DELIBERATE_ABSENCES))
      .filter((c) => !existsSync(join(REPO_ROOT, c.path)))
      .map((c) => `${c.path}  (cited in ${c.citedIn})`);

    expect([...new Set(missing)], 'cited enforcement artefacts that do not exist').toEqual([]);
  });

  test('every deliberate absence is genuinely absent', () => {
    // The other direction. If one of these is created later, the exemption
    // becomes a lie and must be removed rather than left as decoration.
    for (const [path, reason] of Object.entries(DELIBERATE_ABSENCES)) {
      expect(
        existsSync(join(REPO_ROOT, path)),
        `${path} now exists, so its exemption is stale. Reason on file: ${reason}`,
      ).toBe(false);
    }
  });

  test('plant — a citation of a non-existent script is caught', () => {
    // The guard-over-the-guard leg. Proves the check would actually fire, rather
    // than passing because every path happens to resolve today.
    const planted = [...citations, { path: 'scripts/lint_does_not_exist.sh', citedIn: 'planted' }];
    const missing = planted
      .filter((c) => !(c.path in DELIBERATE_ABSENCES))
      .filter((c) => !existsSync(join(REPO_ROOT, c.path)));
    expect(missing.map((c) => c.path)).toEqual(['scripts/lint_does_not_exist.sh']);
  });
});
