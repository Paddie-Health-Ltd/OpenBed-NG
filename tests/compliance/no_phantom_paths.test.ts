import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
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
 *
 * TWO EXEMPTIONS, AND THEY ARE DIFFERENT CLAIMS. DELIBERATE_ABSENCES is for a
 * path cited BECAUSE it does not exist -- a negative claim, permanent.
 * PLANNED_ARTEFACTS is for a path a planning document specifies and a named
 * stage will build -- temporary, and it must retire when the work lands.
 * Collapsing the two would let "never" and "not yet" share a bypass list.
 *
 * A THIRD CHECK, ADDED 2026-09-23 AFTER CI CAUGHT WHAT THIS MACHINE COULD NOT.
 * "Exists" was tested with existsSync, so a GITIGNORED path that happens to be on
 * the developer's disk -- a .env.local, a built dist -- passed here and failed in
 * CI, where it is absent. The guard's verdict depended on whose machine ran it.
 * Clause 4's scope note already says gitignored paths are cited WITHOUT backticks;
 * this makes that mechanical: a backticked citation of a path that is ignored and
 * untracked is refused WHATEVER THE LOCAL DISK HOLDS. Three instances before it
 * was built -- the Bundle 3 kickoff's backticked dist/version.json (Cowork's,
 * R-2026-09-22-62 B2) and two of the implementer's own .env.local citations, the
 * second pair found only when PR 3.1's compliance-tests job went red.
 */

/**
 * Backticked citations of a gitignored path that are exempt BY FILE, not by path.
 *
 * Keyed `citedIn::path`, so the same path cited from any OTHER file is still
 * refused. One entry, and it exists only because the document it sits in is
 * committed byte-identical by ruling and may not be edited to repair it.
 */
const IGNORED_CITATION_EXEMPTIONS: Record<string, string> = {
  'Sprint Kickoffs/sprint-kickoff-bundle3-operator-path-2026-09-22.md::apps/public-dashboard/dist/version.json':
    'Cowork\'s Clause 4 scope defect in the Bundle 3 kickoff, listed and NOT fixed by ' +
    'R-2026-09-22-57 G3 and R-2026-09-22-62 B2, because that kickoff is committed ' +
    'byte-identical to what was pasted. It passes the existence check only because CI ' +
    'builds before the compliance suite, which is exactly the machine-dependence this ' +
    'check exists to refuse; the exemption is the record of that, not a repair.',
};

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
  'tests/compliance/ci_gate_exceptions.test.ts':
    'FINDING 5. The v2 sprint kickoff cites this name as a NEGATIVE EXAMPLE -- it is ' +
    'quoting the stale citation in .ci/ci-gate-exceptions.yml that it is telling you ' +
    'to fix. The assertions actually live in ci_required_checks_not_paths_filtered.test.ts. ' +
    'This file is not planned and will never be built, so it does not belong in ' +
    'PLANNED_ARTEFACTS: an entry there would be a false claim that never retires.',
  'apps/public-dashboard/src/public-labels.json':
    'MOVED to packages/labels/public-labels.json by PR 3.4a (R-2026-09-23-70 E), so the ' +
    'ward console reads the same words. The decision record cites the old path in its ' +
    '-68 and -69 entries as history, which the record keeps as written (method note 8), ' +
    'so every remaining citation names a path whose absence is now the design.',
};

/**
 * Paths a PLANNING DOCUMENT specifies and a named stage will build.
 *
 * A specification that cannot name the artefact it is specifying is not a
 * specification. But an exemption with no expiry is a bypass list that only
 * grows, and Clause 4 then stops covering exactly the paths that matter most --
 * so two anti-rot legs below make each entry self-retiring: a registered path
 * that NOW EXISTS reds, and a registered path NOBODY CITES reds.
 *
 * An entry excuses a citation in a planning document ONLY. The same path cited
 * from a script, a rule file, a test or a workflow reds regardless -- those are
 * executable artefacts, and a reader of one has no reason to expect a plan.
 */
const PLANNED_ARTEFACTS: Record<string, { stage: number }> = {
  'docs/runbook-snapshot-stopped.md': { stage: 1 },
  'packages/fixtures/referral-columns.json': { stage: 5 },
  'scripts/lint_referral_ward_to_ward.sh': { stage: 5 },
  'tests/compliance/referral_ward_to_ward.test.ts': { stage: 5 },
  'tests/db/referral_column_list.test.ts': { stage: 5 },
  // Bundle 3, PR 3.4b-app C (R-2026-09-24-88 BP-11): the admin app and its deploy
  // read-back, cited by the 3.4b-app kickoff, which is committed unedited in PR A.
  'apps/admin': { stage: 3 },
  'apps/admin/wrangler.toml': { stage: 3 },
  'scripts/readback_admin.sh': { stage: 3 },
};

/**
 * A planning document may cite what it plans. Nothing else may.
 *
 * WIDENED 2026-09-10 to include handoffs. A handoff is BY DEFINITION the document
 * that names what has not been built -- the residue, the next bundle, the guard
 * someone still has to write -- so the next one written would have redded this
 * guard on its first commit. The alternative, committing to unbackticked paths in
 * handoffs, makes the most-read document type harder to read and relies on the
 * memory of whoever writes it, which is the thing the register exists to replace.
 *
 * THE PREFIX IS docs/handoff- (unbackticked here on purpose: it is a prefix, not
 * a file, and this guard would rightly read a backticked one as a claim that it
 * exists), NOT docs/ as a whole. Runbooks, decision memos and the
 * facility agreement stay fully covered: those are operational documents and a
 * reader of one has no reason to expect a plan. A plant below proves a phantom in
 * a non-handoff docs file still reds, so this widening cannot quietly become an
 * exemption for the whole directory.
 */
const PLANNING_DOC = /^(Sprint Kickoffs\/|docs\/handoff-)/;

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

/**
 * THE DECISION, AS A PURE FUNCTION.
 *
 * Extracted so the plant legs can feed it constructed input instead of writing
 * phantoms into the working tree -- the same seam tests/compliance/eslint_duty_flag_negation.test.ts
 * uses. A plant that has to touch real files can silently no-op; one that calls
 * the decision directly cannot.
 */
export function phantomViolations(
  citations: Citation[],
  planned: Record<string, { stage: number }>,
  exists: (path: string) => boolean,
): string[] {
  const sites = new Map<string, string[]>();
  for (const c of citations) {
    const seen = sites.get(c.path) ?? [];
    seen.push(c.citedIn);
    sites.set(c.path, seen);
  }

  const out: string[] = [];
  for (const [path, citedIn] of sites) {
    if (path in DELIBERATE_ABSENCES) continue;
    if (exists(path)) continue;

    if (!(path in planned)) {
      out.push(`${path}  (cited in ${[...new Set(citedIn)].join(', ')})`);
      continue;
    }

    // Registered -- but the exemption reaches planning documents only.
    const executable = [...new Set(citedIn)].filter((f) => !PLANNING_DOC.test(f));
    if (executable.length > 0) {
      out.push(
        `${path}  (registered as planned, but cited from an executable artefact: ${executable.join(', ')})`,
      );
    }
  }
  return out.sort();
}

/**
 * THE ANTI-ROT CHECK, ALSO PURE.
 *
 * An exemption list is only honest if entries leave it. Both directions:
 * a registered path that now exists must be removed by the commit that created
 * it, and a registered path nobody cites is dead weight widening the surface.
 */
export function staleRegisterEntries(
  planned: Record<string, { stage: number }>,
  exists: (path: string) => boolean,
  citedPaths: Set<string>,
): string[] {
  const out: string[] = [];
  for (const path of Object.keys(planned)) {
    if (exists(path)) {
      out.push(`${path}  — now EXISTS; delete the register entry in the commit that created it`);
    } else if (!citedPaths.has(path)) {
      out.push(`${path}  — registered but cited nowhere; a stale exemption is dead weight`);
    }
  }
  return out.sort();
}

const realExists = (p: string): boolean => existsSync(join(REPO_ROOT, p));

/**
 * Every citation whose path is gitignored and untracked, i.e. whose presence
 * depends on the machine. Pure, so the plants feed it constructed input.
 */
export function ignoredCitationViolations(
  citations: readonly Citation[],
  isIgnoredUntracked: (path: string) => boolean,
  exempt: Record<string, string>,
): string[] {
  const out: string[] = [];
  for (const c of citations) {
    if (!isIgnoredUntracked(c.path)) continue;
    if (`${c.citedIn}::${c.path}` in exempt) continue;
    out.push(`${c.path}  (cited in ${c.citedIn}) is gitignored: it exists on some machines and not others, so it must be cited WITHOUT backticks`);
  }
  return [...new Set(out)];
}

/** Batch `git check-ignore` plus the tracked set, read once. */
function realIgnoredUntracked(paths: readonly string[]): (p: string) => boolean {
  const tracked = new Set(execFileSync('git', ['-C', REPO_ROOT, 'ls-files'], { encoding: 'utf8' }).split('\n'));
  let ignoredOut = '';
  try {
    ignoredOut = execFileSync('git', ['-C', REPO_ROOT, 'check-ignore', '--stdin', '--no-index'], {
      input: [...new Set(paths)].join('\n') + '\n',
      encoding: 'utf8',
    });
  } catch (e) {
    // check-ignore exits 1 when NOTHING is ignored -- a verdict, not a failure. Any
    // other status means it did not run, and that must not read as "none ignored".
    const err = e as { status?: number; stdout?: string };
    if (err.status !== 1) throw new Error(`git check-ignore did not run (exit ${String(err.status)}) — the ignored-citation check cannot report a verdict`);
    ignoredOut = err.stdout ?? '';
  }
  const ignored = new Set(ignoredOut.split('\n').filter(Boolean));
  return (p) => ignored.has(p) && !tracked.has(p);
}

describe('Clause 4 — no phantom enforcement', () => {
  const citations = collectCitations();
  const citedPaths = new Set(citations.map((c) => c.path));

  test('the audit found citations to check — it is not scanning an empty set', () => {
    // Anti-vacuity, and it has teeth here: if the regex or the top-level filter
    // ever stops matching, this guard would pass over nothing and report green
    // for every phantom in the repository.
    expect(citations.length, 'no repo-relative citations found at all').toBeGreaterThan(30);
  });

  test('the planned-artefact register is not empty', () => {
    // The other half of anti-vacuity. An empty register with the exemption logic
    // still wired in reads as "nothing is exempt" and as "the register stopped
    // being loaded" identically.
    expect(Object.keys(PLANNED_ARTEFACTS).length, 'register parsed to nothing').toBeGreaterThan(0);
  });

  test('every cited repo-relative path exists, or is registered against a planning document', () => {
    expect(
      phantomViolations(citations, PLANNED_ARTEFACTS, realExists),
      'cited enforcement artefacts that do not exist',
    ).toEqual([]);
  });

  test('no citation in backticks names a gitignored path — whatever this machine\u2019s disk holds', () => {
    const isIgnored = realIgnoredUntracked(citations.map((c) => c.path));
    expect(
      ignoredCitationViolations(citations, isIgnored, IGNORED_CITATION_EXEMPTIONS),
      'a backticked citation depends on an untracked file being present',
    ).toEqual([]);
  });

  test('anti-rot — every ignored-citation exemption still matches a real citation, of a path still ignored', () => {
    const isIgnored = realIgnoredUntracked(Object.keys(IGNORED_CITATION_EXEMPTIONS).map((k) => k.split('::')[1] ?? ''));
    for (const key of Object.keys(IGNORED_CITATION_EXEMPTIONS)) {
      const [citedIn, path] = key.split('::') as [string, string];
      expect(citations.some((c) => c.citedIn === citedIn && c.path === path), `exemption ${key} matches no citation — delete it`).toBe(true);
      expect(isIgnored(path), `exemption ${key} names a path that is no longer gitignored — delete it`).toBe(true);
    }
  });

  test('plant — a backticked gitignored path is rejected even though it EXISTS on this disk', () => {
    // THE DEFECT CI CAUGHT: the file is present here, so the existence check passed.
    const cites = [{ path: 'apps/ward-console/.env.local', citedIn: 'tests/compliance/some.test.ts' }];
    expect(ignoredCitationViolations(cites, (p) => p.endsWith('.env.local'), {}).join('\n')).toContain('must be cited WITHOUT backticks');
  });

  test('plant — the exemption is BY FILE: the same path cited from another file is still rejected', () => {
    const cites = [{ path: 'apps/public-dashboard/dist/version.json', citedIn: 'docs/runbook-x.md' }];
    expect(ignoredCitationViolations(cites, () => true, IGNORED_CITATION_EXEMPTIONS).length).toBe(1);
  });

  test('positive control — a tracked path is accepted', () => {
    const cites = [{ path: 'scripts/deploy_pages.sh', citedIn: 'docs/runbook-x.md' }];
    expect(ignoredCitationViolations(cites, realIgnoredUntracked(['scripts/deploy_pages.sh']), {})).toEqual([]);
  });

  test('every deliberate absence is genuinely absent', () => {
    // The other direction. If one of these is created later, the exemption
    // becomes a lie and must be removed rather than left as decoration.
    for (const [path, reason] of Object.entries(DELIBERATE_ABSENCES)) {
      expect(
        realExists(path),
        `${path} now exists, so its exemption is stale. Reason on file: ${reason}`,
      ).toBe(false);
    }
  });

  test('anti-rot — no register entry has gone stale', () => {
    expect(
      staleRegisterEntries(PLANNED_ARTEFACTS, realExists, citedPaths),
      'the planned-artefact register has entries that should have retired',
    ).toEqual([]);
  });

  const PLAN_DOC = 'Sprint Kickoffs/sprint-kickoff-example.md';
  const SCRIPT = 'scripts/lint_something.sh';
  const ABSENT = 'scripts/lint_does_not_exist.sh';
  const never = (): boolean => false;

  test('plant — an UNREGISTERED phantom in a planning document is rejected', () => {
    const out = phantomViolations([{ path: ABSENT, citedIn: PLAN_DOC }], {}, never);
    expect(out.length, `the phantom was accepted. Guard output: ${JSON.stringify(out)}`).toBe(1);
  });

  test('plant — a phantom cited from a SCRIPT is rejected even when registered', () => {
    const out = phantomViolations(
      [{ path: ABSENT, citedIn: SCRIPT }],
      { [ABSENT]: { stage: 1 } },
      never,
    );
    expect(out.length, `an executable artefact got the planning exemption. Output: ${JSON.stringify(out)}`).toBe(1);
  });

  test('plant — a registered phantom cited from BOTH a planning document and a script is rejected', () => {
    // The "every citing file" condition. A single-site plant does not reach it:
    // the exemption must fail on the WORST citing site, not the best one.
    const out = phantomViolations(
      [
        { path: ABSENT, citedIn: PLAN_DOC },
        { path: ABSENT, citedIn: SCRIPT },
      ],
      { [ABSENT]: { stage: 1 } },
      never,
    );
    expect(out.length, `one planning-document citation excused a script citation. Output: ${JSON.stringify(out)}`).toBe(1);
  });

  test('plant — a registered path that EXISTS is rejected by the anti-rot leg', () => {
    const out = staleRegisterEntries({ [ABSENT]: { stage: 1 } }, () => true, new Set([ABSENT]));
    expect(out.length, `a landed artefact kept its exemption. Output: ${JSON.stringify(out)}`).toBe(1);
  });

  test('plant — a registered path nobody cites is rejected by the anti-rot leg', () => {
    const out = staleRegisterEntries({ [ABSENT]: { stage: 1 } }, never, new Set());
    expect(out.length, `an uncited exemption survived. Output: ${JSON.stringify(out)}`).toBe(1);
  });

  test('plant — a phantom in a NON-handoff docs file is rejected even when registered', () => {
    // The widening to docs/handoff- must not become an exemption for docs/ as a
    // whole. A runbook is an operational document: a reader following one has no
    // reason to expect that a path in it describes something unbuilt.
    const out = phantomViolations(
      [{ path: ABSENT, citedIn: 'docs/runbook-supabase-project-creation.md' }],
      { [ABSENT]: { stage: 1 } },
      never,
    );
    expect(out.length, `a runbook got the planning exemption. Output: ${JSON.stringify(out)}`).toBe(1);
  });

  test('positive control — a phantom cited only in a handoff is accepted', () => {
    const out = phantomViolations(
      [{ path: ABSENT, citedIn: 'docs/handoff-2026-09-10.md' }],
      { [ABSENT]: { stage: 1 } },
      never,
    );
    expect(out, 'a handoff could not cite the artefact it exists to name').toEqual([]);
  });

  test('positive control — a registered phantom cited only in a planning document is accepted', () => {
    // A guard that rejects everything is a rubber stamp. This is the shape the
    // register exists to permit, and it must remain writable.
    const out = phantomViolations(
      [{ path: ABSENT, citedIn: PLAN_DOC }],
      { [ABSENT]: { stage: 1 } },
      never,
    );
    expect(out, 'the register did not excuse the case it exists for').toEqual([]);
  });
});
