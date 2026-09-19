import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runLint, withScratch, place, REPO_ROOT } from './_scratch.js';
import {
  PLANT_JWT, PLANT_SB_SECRET, PLANT_PRIVATE_KEY, PLANT_AWS_KEY,
  PLANT_REMOTE_PG_URL, LOCAL_PG_URL,
} from './_plants.js';
import { LOCAL_SERVICE_ROLE_KEY } from '../setup/local-keys.js';

/**
 * GUARD OVER A GUARD -- scripts/lint_no_secrets.sh.
 *
 * DETECTION, not prevention. GitHub secret scanning with push protection is the
 * prevention control and is a repository setting; this runs in CI, after the push
 * has already been accepted. SECURITY.md states the division; do not let it be
 * restated the other way round.
 *
 * The positive controls carry unusual weight here. This guard runs over the whole
 * repository including its own documentation, and a scan that fires on the string
 * "service_role" appearing in a comment about service_role is a scan somebody
 * turns off within a week.
 *
 * TWO HALVES, since R-2026-09-18-17: CONTENT (files read for credential shapes)
 * and LOCATION (no credential file may be tracked, whatever it holds). The script
 * reads `git ls-files`, so every scratch tree that is meant to reach a verdict is
 * a git repository with its files tracked -- see track() below.
 */
const LINT = 'lint_no_secrets.sh';
const SCRIPT_SRC = readFileSync(join(REPO_ROOT, 'scripts', LINT), 'utf8');

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Makes a scratch tree a git repository and tracks whatever `git add -A` admits. */
function track(root: string): void {
  git(root, 'init', '-q');
  git(root, 'add', '-A');
}

function trackedPaths(root: string): string[] {
  return git(root, 'ls-files').split('\n').filter(Boolean);
}

/** The entries of a bash array literal `NAME=( ... )`, first `|` field only. */
function scriptArray(name: string): string[] {
  const body = new RegExp(`\\n${name}=\\(\\n([\\s\\S]*?)\\n\\)`).exec(SCRIPT_SRC)?.[1];
  if (body === undefined) throw new Error(`${name}=( ... ) not found in scripts/${LINT}; the test cannot read the list it checks`);
  return body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith("'"))
    .map((l) => (l.slice(1, l.lastIndexOf("'")).split('|')[0] as string));
}

const DENY = scriptArray('DENY');
const ALLOW = scriptArray('ALLOW');

/** One real basename per DENY glob. Keyed by glob so a new entry reddens the identity leg. */
const DENY_SAMPLE: Record<string, string> = {
  '.env': '.env',
  '.env.*': '.env.local',
  '.dev.vars': '.dev.vars',
  '.dev.vars.*': '.dev.vars.production',
};

/** What a developer's `.dev.vars` legitimately holds: the well-known local demo service-role key. */
const DEMO_DEV_VARS = `SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SERVICE_ROLE_KEY=${LOCAL_SERVICE_ROLE_KEY}\n`;

describe('secret scan', () => {
  test('the real repository is clean', () => {
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, res.stdout).toBe(0);
    expect(res.stdout, 'the PASS line does not show the tracked-files half ran').toContain('tracked files checked');
  });

  test.each([
    ['a JWT outside the allowlisted file', `const t = "${PLANT_JWT}";`],
    ['a Supabase secret key', `const k = "${PLANT_SB_SECRET}";`],
    ['a private key block', PLANT_PRIVATE_KEY],
    ['an AWS access key id', `const k = "${PLANT_AWS_KEY}";`],
    ['a REMOTE postgres URL with a password', `const u = "${PLANT_REMOTE_PG_URL}";`],
  ])('plant — %s is caught', (_name, code) => {
    withScratch((root) => {
      place(root, 'src/leak.ts', code);
      track(root);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, 'the scanner did not name the rule it enforces').toContain('committed secret matched in');
    });
  });

  test('positive control — a LOCAL postgres URL is not a finding', () => {
    // Every developer's `supabase start` uses postgres:postgres@127.0.0.1:54322,
    // it is documented in the README, and it authenticates against a container on
    // the machine running it. Firing on it would red the repository on every run.
    withScratch((root) => {
      place(root, 'scripts/run.sh', `DATABASE_URL=${LOCAL_PG_URL}`);
      track(root);
      const res = runLint(LINT, root);
      expect(res.status, res.stdout).toBe(0);
    });
  });

  test('positive control — prose mentioning service_role is not a finding', () => {
    withScratch((root) => {
      place(root, 'docs/notes.md', 'The service_role key must never reach a client bundle.');
      track(root);
      const res = runLint(LINT, root);
      expect(res.status, res.stdout).toBe(0);
    });
  });

  test('the allowlisted local-keys file is exempt BY PATH and only there', () => {
    withScratch((root) => {
      place(root, 'tests/setup/local-keys.ts', `export const K = '${PLANT_JWT}';`);
      track(root);
      const res = runLint(LINT, root);
      expect(res.status, `the allowlisted path was flagged:\n${res.stdout}`).toBe(0);
    });
    withScratch((root) => {
      place(root, 'tests/setup/other-keys.ts', `export const K = '${PLANT_JWT}';`);
      track(root);
      const res = runLint(LINT, root);
      expect(res.status, `the exemption leaked to another file:\n${res.stdout}`).toBe(1);
    });
  });

  test('anti-vacuity — an empty tree FAILS rather than reporting clean', () => {
    withScratch((root) => {
      const res = runLint(LINT, root);
      expect(res.status, `an empty corpus did not fail loudly:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the empty-corpus refusal did not name itself').toContain('no files to scan under');
    });
  });
});

/**
 * LOCATION, NOT CONTENT (R-2026-09-18-17). A credential FILE must never be
 * tracked, whatever it holds. Plants both ways: the tracked file reddens, and the
 * SAME BYTES untracked stay green -- the second is the lesson of the reverted
 * content-scan attempt, which failed every developer's legitimate `.dev.vars`.
 * Each leg first asserts the plant landed: the file's tracked state is read back
 * from git before the verdict is.
 */
describe('tracked credential files', () => {
  test('the DENY and ALLOW lists are exactly the declared set', () => {
    expect(new Set(DENY), `DENY parsed as ${JSON.stringify(DENY)}`).toEqual(new Set(Object.keys(DENY_SAMPLE)));
    expect(new Set(ALLOW), `ALLOW parsed as ${JSON.stringify(ALLOW)}`).toEqual(new Set(['.env.example', '.dev.vars.example']));
  });

  test('every DENY entry is ignored and every ALLOW entry negated in the root .gitignore', () => {
    const lines = new Set(readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8').split('\n').map((l) => l.trim()));
    for (const g of DENY) expect(lines.has(g), `.gitignore has no line '${g}', so the ignore rule and the tracked-files check disagree`).toBe(true);
    for (const a of ALLOW) expect(lines.has(`!${a}`), `.gitignore has no line '!${a}'`).toBe(true);
  });

  test('plant — a .dev.vars force-added past its ignore line (git add -f) is rejected', () => {
    withScratch((root) => {
      place(root, '.gitignore', '.dev.vars\n');
      place(root, 'src/ok.ts', 'export const ok = 1;\n');
      place(root, '.dev.vars', DEMO_DEV_VARS);
      track(root);
      expect(trackedPaths(root), 'precondition: the ignore line did not keep .dev.vars out').not.toContain('.dev.vars');
      git(root, 'add', '-f', '.dev.vars');
      expect(trackedPaths(root), 'precondition: git add -f did not track the plant').toContain('.dev.vars');
      const res = runLint(LINT, root);
      expect(res.status, `a force-added .dev.vars was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, 'the finding did not name the location rule').toContain('credential file is tracked');
      expect(res.stdout, 'the CONTENT scan fired; this leg is about location').not.toContain('committed secret matched in');
    });
  });

  test('plant — a .dev.vars tracked after its ignore line was deleted is rejected', () => {
    withScratch((root) => {
      place(root, 'src/ok.ts', 'export const ok = 1;\n');
      place(root, '.dev.vars', DEMO_DEV_VARS);
      track(root);
      expect(trackedPaths(root), 'precondition: with no ignore line, git add -A did not track .dev.vars').toContain('.dev.vars');
      const res = runLint(LINT, root);
      expect(res.status, `a .dev.vars with no ignore line was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout).toContain('credential file is tracked');
    });
  });

  const DENY_CASES = DENY.flatMap((g) => ['', 'apps/x/'].map((dir) => [g, `${dir}${DENY_SAMPLE[g] ?? `<no sample for ${g}>`}`] as const));
  test.each(DENY_CASES)('plant — DENY %s: a tracked %s is rejected whatever it holds', (_glob, rel) => {
    withScratch((root) => {
      place(root, 'src/ok.ts', 'export const ok = 1;\n');
      place(root, rel, 'NOT_A_SECRET=plain\n');
      track(root);
      expect(trackedPaths(root), `precondition: ${rel} was not tracked`).toContain(rel);
      const res = runLint(LINT, root);
      expect(res.status, `a tracked ${rel} was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout).toContain('credential file is tracked');
      expect(res.stdout, 'the finding did not name the path').toContain(rel);
    });
  });

  test('accept — an UNTRACKED .dev.vars holding the demo key stays green (the reverted attempt, as a leg)', () => {
    withScratch((root) => {
      place(root, '.gitignore', '.dev.vars\n');
      place(root, 'src/ok.ts', 'export const ok = 1;\n');
      place(root, '.dev.vars', DEMO_DEV_VARS);
      track(root);
      expect(existsSync(join(root, '.dev.vars')), 'precondition: the plant is not on disk').toBe(true);
      expect(readFileSync(join(root, '.dev.vars'), 'utf8'), 'precondition: not the same bytes as the force-add plant').toBe(DEMO_DEV_VARS);
      expect(trackedPaths(root), 'precondition: .dev.vars is tracked, so this is not the untracked case').not.toContain('.dev.vars');
      const res = runLint(LINT, root);
      expect(res.status, `a developer's legitimate untracked .dev.vars was refused:\n${res.stdout}`).toBe(0);
      expect(res.stdout).toContain('tracked files checked');
    });
  });

  test.each(ALLOW)('accept — a tracked %s template stays green', (name) => {
    withScratch((root) => {
      // An ordinary file too: `.dev.vars.example` matches no CONTENT pattern, and
      // a tree the content scan finds empty is refused before the location half.
      place(root, 'src/ok.ts', 'export const ok = 1;\n');
      place(root, name, 'SUPABASE_SERVICE_ROLE_KEY=\n');
      place(root, `apps/x/${name}`, 'SUPABASE_SERVICE_ROLE_KEY=\n');
      track(root);
      expect(trackedPaths(root), `precondition: ${name} was not tracked`).toEqual(expect.arrayContaining([name, `apps/x/${name}`]));
      const res = runLint(LINT, root);
      expect(res.status, `the conventional template ${name} was refused:\n${res.stdout}`).toBe(0);
    });
  });

  test('anti-vacuity — a tree that is not a git repository FAILS rather than reporting clean', () => {
    withScratch((root) => {
      place(root, 'src/ok.ts', 'export const ok = 1;\n');
      const res = runLint(LINT, root);
      expect(res.status, `a non-repository was not refused loudly:\n${res.stdout}`).toBe(2);
      expect(res.stdout).toContain('the tracked-files check did not run');
    });
  });

  test('anti-vacuity — a corrupt git index FAILS as a check that did not run', () => {
    withScratch((root) => {
      place(root, 'src/ok.ts', 'export const ok = 1;\n');
      track(root);
      writeFileSync(join(root, '.git', 'index'), 'not an index\n', 'utf8');
      let gitFailed = false;
      try { git(root, 'ls-files'); } catch { gitFailed = true; }
      expect(gitFailed, 'precondition: git still reads the corrupted index, so the plant did not land').toBe(true);
      const res = runLint(LINT, root);
      expect(res.status, `a git failure was not refused loudly:\n${res.stdout}`).toBe(2);
      expect(res.stdout).toContain('the tracked-files check did not run');
    });
  });

  test('anti-vacuity — a repository with nothing tracked FAILS rather than reporting clean', () => {
    withScratch((root) => {
      place(root, 'src/ok.ts', 'export const ok = 1;\n');
      git(root, 'init', '-q');
      expect(trackedPaths(root), 'precondition: something is tracked').toEqual([]);
      const res = runLint(LINT, root);
      expect(res.status, `an empty index was not refused loudly:\n${res.stdout}`).toBe(2);
      expect(res.stdout).toContain('a tracked-files check over nothing is not a pass');
    });
  });
});
