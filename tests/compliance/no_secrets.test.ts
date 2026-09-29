import { execFileSync } from 'node:child_process';
import { accessSync, chmodSync, constants, existsSync, readFileSync, writeFileSync } from 'node:fs';
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
// One name since R-2026-09-22-59: the origin is tracked configuration, not an
// environment variable. Edited for honesty rather than for green -- nothing
// asserts this constant's contents, which is exactly why it could have rotted.
const DEMO_DEV_VARS = `SUPABASE_SERVICE_ROLE_KEY=${LOCAL_SERVICE_ROLE_KEY}\n`;

/**
 * EACH URL JUDGED BY ITS OWN HOST (R-2026-09-29-169, ES and its amendment).
 *
 * The local-host exemption used to drop a whole matched LINE if it held 127.0.0.1,
 * localhost, @db: or 0.0.0.0 anywhere. Every RED plant below exited 0 against that
 * script (the bypass), and the keyword, empty-user and uppercase plants matched no
 * pattern at all; each was run there first and is quoted in -169.
 *
 * Every string is ASSEMBLED AT RUN TIME, as _plants.ts's are: the scheme is split
 * and the pass-word keyword is split, so this file holds no credential-shaped text
 * for the scan it tests to find.
 */
const pg = (rest: string): string => `postgres${'ql'}://${rest}`;
const PG_UP = (rest: string): string => `POSTGRES${'QL'}://${rest}`;
const PW = `pass${'word'}`;
const HOSTED = 'admin:hunter2@db.prod.example.com:5432/app';
const LOCAL = 'postgres:postgres@127.0.0.1:54322/postgres';
const URL_PAT = 'Postgres URL with password';
const KW_PAT = 'Postgres keyword DSN with password';

/** The red plants: [name, line, pattern that must be named]. */
const ES_RED: ReadonlyArray<readonly [string, string, string]> = [
  ['a) a hosted URL on a line that also mentions localhost', `const u = "${pg(HOSTED)}"; // not localhost`, URL_PAT],
  ['b) a host of localhost.attacker.example.com', `const u = "${pg('admin:hunter2@localhost.attacker.example.com:5432/app')}";`, URL_PAT],
  ['c) a local authority with ?host= naming another host', `const u = "${pg(`${LOCAL}?host=db.prod.example.com`)}";`, URL_PAT],
  ['c) a local authority with ?hostaddr= naming another host', `const u = "${pg(`${LOCAL}?hostaddr=203.0.113.7`)}";`, URL_PAT],
  ['d) a password containing localhost, on a hosted host', `const u = "${pg('admin:localhost@db.prod.example.com:5432/app')}";`, URL_PAT],
  ['e) 0.0.0.0 inside a query value of a hosted URL', `const u = "${pg(`${HOSTED}?application_name=0.0.0.0`)}";`, URL_PAT],
  ['f) a local URL, then a hosted URL, on the same line', `const us = ["${pg(LOCAL)}", "${pg(HOSTED)}"];`, URL_PAT],
  ['a multi-host authority, local host first', `const u = "${pg('admin:hunter2@localhost:5432,db.prod.example.com:5432/app')}";`, URL_PAT],
  ['an empty ?', `const u = "${pg(`${LOCAL}?`)}";`, URL_PAT],
  ['a host of 127.0.0.1.nip.io', `const u = "${pg('admin:hunter2@127.0.0.1.nip.io:5432/app')}";`, URL_PAT],
  ['an empty user part', `const u = "${pg(':hunter2@db.prod.example.com:5432/app')}";`, URL_PAT],
  ['an uppercase scheme', `const u = "${PG_UP(HOSTED)}";`, URL_PAT],
  ['a keyword DSN on a hosted host', `const dsn = "host=db.prod.example.com port=5432 dbname=app user=admin ${PW}=hunter2";`, KW_PAT],
  ['a keyword DSN with a password and no host', `const dsn = "dbname=app user=admin ${PW}=hunter2";`, KW_PAT],
  ['a keyword DSN with spaces around =', `const dsn = "host = db.prod.example.com user = admin ${PW} = hunter2";`, KW_PAT],
  ['a keyword DSN with single-quoted values', `const dsn = "host='db.prod.example.com' user='admin' ${PW}='hunter 2'";`, KW_PAT],
  // Beyond ES-3's list: the keyword form's own host list.
  ['a keyword DSN whose host list starts local', `const dsn = "host=127.0.0.1,db.prod.example.com user=admin ${PW}=hunter2";`, KW_PAT],
  // The amendment: a single `=` assigning a quoted literal is still a finding.
  ['an assignment of a quoted literal to the pass-word key', `u.${PW} = 'hunter2';`, KW_PAT],
];

/** The ordinary controls: [name, line]. Each must exit 0. */
const ES_GREEN: ReadonlyArray<readonly [string, string]> = [
  ['the local URL', `DATABASE_URL=${pg(LOCAL)}`],
  ['localhost', `DATABASE_URL=${pg('postgres:postgres@localhost:54322/postgres')}`],
  ['LOCALHOST', `DATABASE_URL=${pg('postgres:postgres@LOCALHOST:54322/postgres')}`],
  ['[::1]', `DATABASE_URL=${pg('postgres:postgres@[::1]:54322/postgres')}`],
  ['db, bare, with no port', `DATABASE_URL=${pg('postgres:postgres@db/postgres')}`],
  ['0.0.0.0', `DATABASE_URL=${pg('postgres:postgres@0.0.0.0:54322/postgres')}`],
  ['a keyword DSN on host 127.0.0.1', `const dsn = "host=127.0.0.1 port=54322 user=postgres ${PW}=postgres";`],
  ['a local URL on the same line as prose naming a hosted host', `DATABASE_URL=${pg(LOCAL)} # the hosted one is db.prod.example.com`],
  // The amendment's three: comparisons and an arrow are not keyword DSNs.
  ['a triple-equals comparison of the pass-word key to empty', `if (u.${PW} === '') return;`],
  ['a double-equals comparison of the pass-word key to null', `if (u.${PW} == null) return;`],
  ['an arrow whose bare parameter is the pass-word key', `const f = ${PW} => ${PW}.trim();`],
];

describe('secret scan — each URL judged by its own host (ES)', () => {
  test.each(ES_RED)('plant — %s is caught', (_name, line, pattern) => {
    withScratch((root) => {
      place(root, 'src/leak.ts', `${line}\n`);
      track(root);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${line}\n${res.stdout}`).toBe(1);
      expect(res.stdout, `the finding did not name ${pattern}:\n${res.stdout}`).toContain(`pattern: ${pattern}`);
    });
  });

  test.each(ES_GREEN)('positive control — %s is not a finding', (_name, line) => {
    withScratch((root) => {
      place(root, 'src/ok.ts', `${line}\n`);
      track(root);
      const res = runLint(LINT, root);
      expect(res.status, `an ordinary line was refused:\n${line}\n${res.stdout}`).toBe(0);
    });
  });

  /**
   * THE READS THAT JUDGE A LINE, FAILED ON PURPOSE. A stub `grep` goes first on PATH
   * and passes every call through to the real grep except one: the URL token read
   * or the host keyword read, told apart by their arguments. The same seam as
   * lint_public_table_rls's stub perl. Each leg first asserts the stub was hit, so a
   * green cannot come from a stub that never ran.
   */
  const REAL_GREP = execFileSync('bash', ['-c', 'command -v grep'], { encoding: 'utf8' }).trim();
  const STUB = [
    '#!/usr/bin/env bash',
    'if [ "${1:-}" = -noE ]; then',
    '  case "$*" in *"host(addr)"*) kind=kw ;; *) kind=url ;; esac',
    '  if [ "$kind" = "$STUB_TARGET" ]; then echo hit > "$STUB_MARK"; exit "$STUB_EXIT"; fi',
    'fi',
    `exec ${REAL_GREP} "$@"`,
    '',
  ].join('\n');

  function runStubbed(root: string, stubDir: string, target: 'url' | 'kw', exit: number): { status: number; out: string; hit: boolean } {
    const mark = join(stubDir, 'hit');
    let status = 0;
    let out = '';
    try {
      out = execFileSync('bash', [join(REPO_ROOT, 'scripts', LINT), root], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ''}`, STUB_TARGET: target, STUB_EXIT: String(exit), STUB_MARK: mark },
      });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      status = err.status ?? -1;
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    return { status, out, hit: existsSync(mark) };
  }

  function withStub(fn: (stubDir: string) => void): void {
    withScratch((stubDir) => {
      place(stubDir, 'grep', STUB);
      chmodSync(join(stubDir, 'grep'), 0o755);
      fn(stubDir);
    });
  }

  test('plant — a URL token read that returns nothing fails CLOSED: the matched line is a finding', () => {
    withStub((stubDir) => withScratch((root) => {
      place(root, 'scripts/run.sh', `DATABASE_URL=${pg(LOCAL)}\n`);
      track(root);
      const control = runLint(LINT, root);
      expect(control.status, `precondition: the local URL is not green without the stub:\n${control.stdout}`).toBe(0);
      const res = runStubbed(root, stubDir, 'url', 1);
      expect(res.hit, `the stub was never called for the URL token read:\n${res.out}`).toBe(true);
      expect(res.status, `a line with no token read as local:\n${res.out}`).toBe(1);
      expect(res.out).toContain(`pattern: ${URL_PAT}`);
    }));
  });

  test('could not run — a URL token read that exits 2 is an ERROR, never a verdict', () => {
    withStub((stubDir) => withScratch((root) => {
      place(root, 'scripts/run.sh', `DATABASE_URL=${pg(LOCAL)}\n`);
      track(root);
      const res = runStubbed(root, stubDir, 'url', 2);
      expect(res.hit, `the stub was never called for the URL token read:\n${res.out}`).toBe(true);
      expect(res.status, `a token read that did not run produced a verdict:\n${res.out}`).toBe(2);
      expect(res.out).toContain('the URL token read did not run, so no matched line is judged local');
      expect(res.out).not.toContain('lint_no_secrets.sh: PASS');
    }));
  });

  test('could not run — a host keyword read that exits 2 is an ERROR, never a verdict', () => {
    withStub((stubDir) => withScratch((root) => {
      place(root, 'src/dsn.ts', `const dsn = "host=127.0.0.1 user=postgres ${PW}=postgres";\n`);
      track(root);
      const res = runStubbed(root, stubDir, 'kw', 2);
      expect(res.hit, `the stub was never called for the host keyword read:\n${res.out}`).toBe(true);
      expect(res.status, `a host read that did not run produced a verdict:\n${res.out}`).toBe(2);
      expect(res.out).toContain('the host keyword read did not run, so no keyword line is judged local');
      expect(res.out).not.toContain('lint_no_secrets.sh: PASS');
    }));
  });
});

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
      expect(res.stdout, 'the summary line that names the verdict was not printed').toContain('lint_no_secrets.sh: FAILED (');
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

  test('the allowlist is EXACTLY these two files and these patterns — parsed, not assumed', () => {
    // R-2026-09-22-61 B2: the exemption is by NAMED FILE AND NAMED KEY, and it is not
    // a general widening. Pinned by identity so a third entry, or a widened pattern
    // set on an existing one, is a visible act with someone's name on it.
    const src = readFileSync(join(REPO_ROOT, 'scripts', LINT), 'utf8');
    const block = /ALLOWED=\(([\s\S]*?)\n\)/.exec(src);
    expect(block, 'the ALLOWED array was restructured — this guard stopped watching it').not.toBeNull();
    const entries = (block?.[1] ?? '')
      .split('\n')
      .map((l) => l.trim().replace(/^'|'$/g, ''))
      .filter((l) => l !== '' && !l.startsWith('#'));
    expect(entries.sort(), 'the secret-scan exemption list changed').toEqual(
      [
        'packages/origins/publishable-keys.json|JWT',
        'tests/setup/local-keys.ts|JWT,Supabase secret key,Postgres URL with password',
      ].sort(),
    );
  });

  test.each([
    ['tests/setup/local-keys.ts'],
    ['packages/origins/publishable-keys.json'],
  ])('%s is exempt for the JWT pattern', (path) => {
    withScratch((root) => {
      place(root, path, `export const K = '${PLANT_JWT}';`);
      track(root);
      const res = runLint(LINT, root);
      expect(res.status, `the allowlisted path was flagged:\n${res.stdout}`).toBe(0);
    });
  });

  test('could not run — a file the prefilter cannot read is an ERROR, never reported clean', () => {
    withScratch((root) => {
      place(root, 'src/unreadable.ts', 'export const nothing = 1;\n');
      track(root);
      const target = join(root, 'src', 'unreadable.ts');
      chmodSync(target, 0o000);
      try {
        // CONFIRM THE PLANT LANDED: as root the mode is ignored and this leg would
        // test nothing, so an unreadable file is a precondition, not an assumption.
        expect(() => accessSync(target, constants.R_OK), 'this user can read a mode-000 file; the plant did not take').toThrow();
        const res = runLint(LINT, root);
        expect(res.status, `an unreadable file did not stop the scan:\n${res.stdout}`).toBe(2);
        expect(res.stdout).toContain('against every pattern -- no file it cannot read is ever reported clean');
        expect(res.stdout).not.toContain('lint_no_secrets.sh: PASS');
      } finally {
        chmodSync(target, 0o644);
      }
    });
  });

  test('plant — the exemption does not leak to a neighbouring file', () => {
    withScratch((root) => {
      place(root, 'tests/setup/other-keys.ts', `export const K = '${PLANT_JWT}';`);
      track(root);
      const res = runLint(LINT, root);
      expect(res.status, `the exemption leaked to another file:\n${res.stdout}`).toBe(1);
    });
  });

  test('plant — the publishable-keys file is NOT exempt for a SECRET shape', () => {
    // THE HALF THAT MAKES THE EXEMPTION NARROW RATHER THAN A HOLE. That file is
    // imported by browser code, so it may hold the anon JWT and must never hold a
    // secret. local-keys.ts is the only entry permitted the service-role shapes,
    // because it is the only one no bundle imports.
    withScratch((root) => {
      place(root, 'packages/origins/publishable-keys.json', `{ "production": "${PLANT_SB_SECRET}" }`);
      track(root);
      const res = runLint(LINT, root);
      expect(res.status, `a secret key in the client-key file was exempted:\n${res.stdout}`).toBe(1);
      expect(res.stdout, 'the refusal did not name the pattern that fired').toContain('Supabase secret key');
    });
  });

  test('.gate-logs/ is not read: a secret shape in a kept gate log is not a finding, and the same file elsewhere is (EB-2 d)', () => {
    // A kept gate log quotes this scan's own plants, and it is gitignored, so it cannot
    // reach the repository. The control proves the scan would have fired on the file.
    withScratch((root) => {
      place(root, 'src/ok.ts', 'export const ok = 1;\n');
      place(root, '.gate-logs/05-secret-scan.json', `{ "quoted": "${PLANT_SB_SECRET}" }`);
      track(root);
      const res = runLint(LINT, root);
      expect(res.status, `a kept gate log was read as source:\n${res.stdout}`).toBe(0);
    });
    withScratch((root) => {
      place(root, 'src/ok.ts', 'export const ok = 1;\n');
      place(root, 'gate-logs-control/05-secret-scan.json', `{ "quoted": "${PLANT_SB_SECRET}" }`);
      track(root);
      const res = runLint(LINT, root);
      expect(res.status, `the control file was not flagged, so the leg above proves nothing:\n${res.stdout}`).toBe(1);
      expect(res.stdout).toContain('Supabase secret key');
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
