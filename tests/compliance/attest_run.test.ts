import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { place, REPO_ROOT, withScratch } from './_scratch.js';

/**
 * scripts/attest_run.sh, PLANTED (R-2026-10-07 GI, addenda 1 E and 2).
 *
 * The script runs a reset or a build, then one vitest project to a JUnit file, then attest_counts, keeps ALL
 * of the output in one log, and on any abort prints the collector's own error lines and the log's path. It
 * exists because an attestation run of mine collected zero tests and the cause was lost: my wrapper filtered
 * the output. So what is asserted here is about OUTPUT, and every assertion about the abort is made on the
 * SUMMARY the script prints after its RED line, never on the whole stream: the collector's output is streamed
 * live as well, so an assertion over the whole stream would pass on a script that printed no summary at all.
 *
 * HOW. The REAL script and the REAL attest_counts.mjs are copied into a scratch tree. `npm` and `npx` are stubs on
 * PATH that record that they ran, print what they are told to, write the JUnit they are told to, and exit as
 * told. Nothing here starts a database or runs a real vitest.
 *
 * THE LEGS, each a pure assertion function over a run, applied to the real script (no violations) and, for the
 * anti-vacuity leg, to a copy of it with one behaviour removed (violations, and the removal is asserted to have
 * landed first, test-conventions section 8):
 *   (a) ZERO COLLECTED: the collector writes an empty-but-closed JUnit, prints its own error line and exits 1.
 *       RED; the summary holds that line verbatim and the log's path; the log holds the line.
 *   (b) AN UNHANDLED ERROR, EVERY TEST PASSING: a JUnit with errored=1 and every test passed. RED, with the
 *       collector exiting 1 and, separately, exiting 0.
 *   (c) CLEAN: GREEN, exit 0, and the log exists, is not empty, and holds the collector's output.
 *   plus: the reset failing (the collection never runs, and the summary shows the reset's own line); a STALE
 *   green JUnit left from an earlier run with the collector dying before it writes (RED, never the stale file).
 *   (d) ANTI-VACUITY: neuter the error-line print, the log-path print, the attest step, and the logging; each
 *       turns exactly the legs that depend on it red.
 *
 * NOT ASSERTED HERE, deliberately: that a real vitest and a real database behave as the stubs do. The shapes the
 * stubs write (an empty but closed JUnit, an errored=1 file) are the ones scripts/attest_counts.mjs is planted
 * against in tests/compliance/attest_counts.test.ts with a real child vitest.
 */

const ATTEST_RUN = 'attest_run.sh';
const ATTEST_COUNTS = 'attest_counts.mjs';

interface Run {
  status: number;
  out: string;
  ran: string[];
  logPath: string;
  log: string | null;
  summary: string;
}

const junit = (cases: string, tests: number, failures: number, errors: number): string =>
  `<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites name="vitest tests" tests="${tests}" failures="${failures}" errors="${errors}" time="0.1">\n${cases}</testsuites>\n`;
const pass = (n: string): string => `<testsuite name="s${n}" tests="1" failures="0" errors="0"><testcase classname="c" name="t${n}" time="0.01"/></testsuite>\n`;

/** What the stub collector writes, by scenario. */
const JUNITS: Record<string, string> = {
  zero: junit('', 0, 0, 0),
  clean: junit(pass('1') + pass('2') + pass('3'), 3, 0, 0),
  unhandled:
    junit(
      pass('1') + pass('2') + pass('3') +
        '<testsuite name="vitest unhandled errors" tests="1" failures="0" errors="1"><testcase classname="vitest unhandled errors" name="ReferenceError: document is not defined"><error message="document is not defined">stack</error></testcase></testsuite>\n',
      4,
      0,
      1,
    ),
};

const STUB_NPM = `#!/usr/bin/env bash
echo "npm $*" >> "$STUB_LOG"
case "$*" in
  "run db:reset")
    echo "STUB RESET OUTPUT"
    if [ -n "\${STUB_RESET_LINE:-}" ]; then echo "$STUB_RESET_LINE"; fi
    if [ "\${STUB_RESET_RC:-0}" != "0" ] && [ -z "\${STUB_RESET_LINE:-}" ]; then echo "STUB RESET ERROR: supabase db reset could not restart containers" >&2; fi
    exit "\${STUB_RESET_RC:-0}" ;;
  "run build")
    echo "STUB BUILD OUTPUT"
    if [ "\${STUB_BUILD_RC:-0}" != "0" ]; then echo "STUB BUILD ERROR: tsc could not compile" >&2; fi
    exit "\${STUB_BUILD_RC:-0}" ;;
esac
exit 0
`;
const STUB_NPX = `#!/usr/bin/env bash
echo "npx $*" >> "$STUB_LOG"
out=""
for a in "$@"; do case "$a" in --outputFile=*) out="\${a#--outputFile=}" ;; esac; done
echo "STUB COLLECTOR OUTPUT"
if [ -n "\${STUB_COLLECTOR_LINE:-}" ]; then echo "$STUB_COLLECTOR_LINE" >&2; fi
if [ -n "\${STUB_JUNIT_FILE:-}" ] && [ -n "$out" ]; then cp "$STUB_JUNIT_FILE" "$out"; fi
exit "\${STUB_COLLECTOR_RC:-0}"
`;

function build(root: string, scriptText?: string): string {
  const scripts = join(root, 'scripts');
  mkdirSync(scripts, { recursive: true });
  const target = join(scripts, ATTEST_RUN);
  if (scriptText === undefined) copyFileSync(join(REPO_ROOT, 'scripts', ATTEST_RUN), target);
  else writeFileSync(target, scriptText, 'utf8');
  copyFileSync(join(REPO_ROOT, 'scripts', ATTEST_COUNTS), join(scripts, ATTEST_COUNTS));
  for (const [name, body] of [['npm', STUB_NPM], ['npx', STUB_NPX]] as const) {
    place(root, join('bin', name), body);
    chmodSync(join(root, 'bin', name), 0o755);
  }
  return target;
}

interface Scenario {
  project?: 'db' | 'compliance';
  junit?: keyof typeof JUNITS | null;
  collectorRc?: number;
  collectorLine?: string;
  resetRc?: number;
  resetLine?: string;
  buildRc?: number;
  staleJunit?: boolean;
  databaseUrl?: string | null;
}

function runScript(root: string, s: Scenario, scriptText?: string): Run {
  build(root, scriptText);
  const project = s.project ?? 'db';
  const junitName = `junit-${project}.xml`;
  if (s.junit !== null && s.junit !== undefined) place(root, 'stub-junit.xml', JUNITS[s.junit] ?? '');
  if (s.staleJunit === true) place(root, junitName, JUNITS['clean'] ?? '');
  const env: Record<string, string> = {
    PATH: `${join(root, 'bin')}:${process.env['PATH'] ?? ''}`,
    HOME: process.env['HOME'] ?? '',
    STUB_LOG: join(root, 'ran.log'),
    STUB_COLLECTOR_RC: String(s.collectorRc ?? 0),
    STUB_RESET_RC: String(s.resetRc ?? 0),
    STUB_BUILD_RC: String(s.buildRc ?? 0),
  };
  if (s.junit !== null && s.junit !== undefined) env['STUB_JUNIT_FILE'] = join(root, 'stub-junit.xml');
  if (s.collectorLine !== undefined) env['STUB_COLLECTOR_LINE'] = s.collectorLine;
  if (s.resetLine !== undefined) env['STUB_RESET_LINE'] = s.resetLine;
  if (s.databaseUrl !== null) env['DATABASE_URL'] = s.databaseUrl ?? 'stub://local';
  const r = spawnSync('bash', [join(root, 'scripts', ATTEST_RUN), project], { cwd: root, env, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const logPath = join('.gate-logs', `attest-${project}.log`);
  const abs = join(root, logPath);
  const at = out.indexOf('ATTESTATION: RED');
  return {
    status: r.status ?? -1,
    out,
    ran: existsSync(join(root, 'ran.log')) ? readFileSync(join(root, 'ran.log'), 'utf8').split('\n').filter((l) => l !== '') : [],
    logPath,
    log: existsSync(abs) ? readFileSync(abs, 'utf8') : null,
    summary: at === -1 ? '' : out.slice(at),
  };
}

/** The legs, as pure assertions: each returns what is wrong with a run, and [] when nothing is. */
const COLLECTOR_LINE = 'Error: Cannot reach the database at postgresql://stub (STUB COLLECTOR REASON 4471)';

export function zeroCollectedViolations(r: Run): string[] {
  const v: string[] = [];
  if (r.status !== 1) v.push(`exit ${r.status}, not RED (1)`);
  if (!r.summary.includes('ATTESTATION: RED')) v.push('no RED line');
  if (r.out.includes('ATTESTATION: GREEN')) v.push('a zero-collected run printed GREEN');
  if (!r.summary.includes(COLLECTOR_LINE)) v.push("the summary after the RED line does not hold the collector's error line verbatim");
  if (!r.summary.includes(r.logPath)) v.push("the summary does not print the log's path");
  if (r.log === null || !r.log.includes(COLLECTOR_LINE)) v.push("the log does not hold the collector's line");
  if (!r.out.includes('ERROR: the collector (vitest) exited 1')) v.push('the abort does not say the collector exited 1');
  return v;
}

export function unhandledViolations(r: Run): string[] {
  const v: string[] = [];
  if (r.status !== 1) v.push(`exit ${r.status}, not RED (1)`);
  if (!r.summary.includes('ATTESTATION: RED')) v.push('no RED line');
  if (r.out.includes('ATTESTATION: GREEN')) v.push('an unhandled error with every test passing printed GREEN');
  if (!r.out.includes('errored=1')) v.push('the errored=1 count is not shown');
  return v;
}

export function cleanViolations(r: Run): string[] {
  const v: string[] = [];
  if (r.status !== 0) v.push(`exit ${r.status}, not GREEN (0)`);
  if (!r.out.includes('ATTESTATION: GREEN')) v.push('no GREEN line');
  if (!r.out.includes('ZERO-RED')) v.push("attest_counts' ZERO-RED is not shown");
  if (r.log === null) v.push('the log file does not exist');
  else {
    if (r.log.length === 0) v.push('the log file is empty');
    if (!r.log.includes('STUB COLLECTOR OUTPUT')) v.push("the log does not hold the collector's output");
  }
  return v;
}

describe('scripts/attest_run.sh', () => {
  test('leg a — zero tests collected: RED, the collector\'s own error line verbatim in the summary, the log path, the line in the log', () => {
    withScratch((root) => {
      const r = runScript(root, { junit: 'zero', collectorRc: 1, collectorLine: COLLECTOR_LINE });
      expect(zeroCollectedViolations(r), `the zero-collected abort is wrong:\n${r.out}`).toEqual([]);
      expect(r.out, 'attest_counts did not read the empty JUnit as no attestation').toContain('no <testcase> elements found.');
    });
  });

  test('leg b — an unhandled error with every test passing is RED, whether the collector exits 1 or 0', () => {
    for (const collectorRc of [1, 0]) {
      withScratch((root) => {
        const r = runScript(root, { junit: 'unhandled', collectorRc });
        expect(unhandledViolations(r), `collector exit ${collectorRc}:\n${r.out}`).toEqual([]);
        expect(r.out, `collector exit ${collectorRc}: attest_counts did not count the unhandled error`).toContain('collected=4 ran=4 passed=3 failed=0 errored=1 skipped=0');
        if (collectorRc === 0) expect(r.out, 'the attest abort did not name its phase').toContain('ERROR: attest_counts exited 1 -- the run is RED or could not be attested');
      });
    }
  });

  test('leg c — a clean run is GREEN, exit 0, and the log exists, is not empty and holds the collector\'s output', () => {
    withScratch((root) => {
      const r = runScript(root, { junit: 'clean' });
      expect(cleanViolations(r), `the clean run is wrong:\n${r.out}`).toEqual([]);
      expect(r.ran.some((l) => l.startsWith('npm run db:reset')), 'the reset did not run before the collection').toBe(true);
      expect(statSync(join(root, r.logPath)).size, 'the log is empty').toBeGreaterThan(0);
    });
  });

  test('leg — the compliance project builds first, runs the compliance collector and attests its own JUnit file', () => {
    withScratch((root) => {
      const r = runScript(root, { project: 'compliance', junit: 'clean' }, undefined);
      expect(cleanViolations(r), r.out).toEqual([]);
      expect(r.ran[0], 'the compliance run did not build first').toBe('npm run build');
      expect(r.ran.join('\n')).toContain('--project compliance');
      expect(r.ran.join('\n')).toContain('--outputFile=junit-compliance.xml');
    });
  });

  test('leg — the reset failing aborts RED before any collection, with the reset\'s own line in the summary', () => {
    withScratch((root) => {
      const r = runScript(root, { junit: 'clean', resetRc: 3 });
      expect(r.status).toBe(1);
      expect(r.summary, 'the summary does not name the reset').toContain('ERROR: db:reset failed (exit 3) -- the db project was not run');
      expect(r.summary, "the reset's own error line is not in the summary").toContain('STUB RESET ERROR: supabase db reset could not restart containers');
      expect(r.summary).toContain(r.logPath);
      expect(r.ran.some((l) => l.startsWith('npx')), 'the collector ran after a failed reset').toBe(false);
    });
  });

  test("leg — the reset's own line is shown even when it names no \"Error:\": the real Supabase CLI failure, observed 2026-10-07, is a JSON line", () => {
    // OBSERVED, not invented: the run that failed on 2026-10-07 printed exactly this, and the first version of
    // the summary's keyword filter did not match it, so the section headed "the collector's own error lines" was
    // EMPTY for the one failure this script was written for. Only the log tail showed it.
    const REAL_CLI_LINE = '{"_tag":"Error","error":{"code":"LegacyDbSetupError","message":"error running container: exit 1"}}';
    withScratch((root) => {
      const r = runScript(root, { junit: 'clean', resetRc: 1, resetLine: REAL_CLI_LINE });
      expect(r.status).toBe(1);
      const errorLines = r.summary.slice(r.summary.indexOf("the collector's own error lines"), r.summary.indexOf('the last 40 lines of the log'));
      expect(errorLines, "the error-lines section is empty for the real CLI failure").toContain(REAL_CLI_LINE);
    });
  });

  test('leg — a failed build aborts the compliance run RED before any collection', () => {
    withScratch((root) => {
      const r = runScript(root, { project: 'compliance', junit: 'clean', buildRc: 2 });
      expect(r.status).toBe(1);
      expect(r.summary).toContain('ERROR: npm run build failed (exit 2) -- the compliance project was not run');
      expect(r.summary).toContain('STUB BUILD ERROR: tsc could not compile');
      expect(r.ran.some((l) => l.startsWith('npx'))).toBe(false);
    });
  });

  test('leg — a STALE green JUnit left from an earlier run is never attested: the collector dies before it writes, and the run is RED', () => {
    withScratch((root) => {
      const r = runScript(root, { junit: null, staleJunit: true, collectorRc: 1, collectorLine: COLLECTOR_LINE });
      expect(r.status).toBe(1);
      expect(r.out, 'the stale green file was attested').not.toContain('ZERO-RED');
      expect(r.out, 'attest_counts did not find the file removed').toContain('cannot read');
      expect(r.summary).toContain(COLLECTOR_LINE);
      expect(existsSync(join(root, 'junit-db.xml')), 'the stale JUnit survived the run').toBe(false);
    });
  });

  test('leg — no argument, or an unknown project, is a usage error (exit 2), and nothing runs', () => {
    withScratch((root) => {
      build(root);
      for (const args of [[], ['everything']]) {
        const r = spawnSync('bash', [join(root, 'scripts', ATTEST_RUN), ...args], { cwd: root, env: { PATH: `${join(root, 'bin')}:${process.env['PATH'] ?? ''}`, STUB_LOG: join(root, 'ran.log'), DATABASE_URL: 'stub://local' }, encoding: 'utf8' });
        expect(r.status, `args ${JSON.stringify(args)}`).toBe(2);
        expect(`${r.stdout}${r.stderr}`).toContain('ERROR: usage: bash scripts/attest_run.sh db|compliance');
      }
      expect(existsSync(join(root, 'ran.log')), 'a command ran on a usage error').toBe(false);
    });
  });

  test('leg — the db project without DATABASE_URL is refused (exit 2) before the reset runs', () => {
    withScratch((root) => {
      const r = runScript(root, { junit: 'clean', databaseUrl: null });
      expect(r.status).toBe(2);
      expect(r.out).toContain('ERROR: DATABASE_URL is not set -- npm run db:reset needs the local stack\'s URL exported');
      expect(r.ran, 'the reset ran without a DATABASE_URL').toEqual([]);
    });
  });

  describe('anti-vacuity — each assertion above fails when the behaviour it checks is removed', () => {
    const real = readFileSync(join(REPO_ROOT, 'scripts', ATTEST_RUN), 'utf8');
    /** A copy of the real script with one text replaced exactly once; the replacement is asserted to have landed. */
    function neutered(from: string, to: string): string {
      const n = real.split(from).length - 1;
      expect(n, `the neuter's anchor was found ${n} times, not once: ${from}`).toBe(1);
      const out = real.replace(from, () => to);
      expect(out, 'the neuter changed nothing').not.toBe(real);
      return out;
    }

    test('the abort prints no error lines and no log tail: leg a goes red on the verbatim line', () => {
      const text = neutered(
        "    awk '/[Ee]rror|ERROR|FAIL|No test files found/{print; n++; if (n >= 40) exit}' \"$LOG\"\n    echo \"--- the last 40 lines of the log:\"\n    tail -n 40 \"$LOG\"\n",
        '',
      );
      withScratch((root) => {
        const v = zeroCollectedViolations(runScript(root, { junit: 'zero', collectorRc: 1, collectorLine: COLLECTOR_LINE }, text));
        expect(v.join('\n')).toContain("the summary after the RED line does not hold the collector's error line verbatim");
      });
    });

    test('the abort prints no log path: leg a goes red on the path', () => {
      const text = neutered('    echo "Full log: $LOG"\n    exit 1\n', '    exit 1\n');
      withScratch((root) => {
        const v = zeroCollectedViolations(runScript(root, { junit: 'zero', collectorRc: 1, collectorLine: COLLECTOR_LINE }, text));
        expect(v.join('\n')).toContain("the summary does not print the log's path");
      });
    });

    test('the attest result is ignored: an unhandled error with the collector exiting 0 reads GREEN, and leg b goes red', () => {
      const text = neutered('ATTEST_RC=$RUN_RC', 'ATTEST_RC=0');
      withScratch((root) => {
        const v = unhandledViolations(runScript(root, { junit: 'unhandled', collectorRc: 0 }, text));
        expect(v.join('\n')).toContain('an unhandled error with every test passing printed GREEN');
      });
    });

    test('the log is not written: leg c goes red on the log', () => {
      const text = neutered('"$@" 2>&1 | tee -a "$LOG" || RUN_RC=$?', '"$@" 2>&1 || RUN_RC=$?');
      withScratch((root) => {
        const v = cleanViolations(runScript(root, { junit: 'clean' }, text));
        expect(v.join('\n')).toMatch(/the log (file is empty|does not hold)/);
      });
    });

    test('the previous JUnit file is not removed: the stale green file is attested', () => {
      const text = neutered('rm -f -- "$JUNIT"\n', '');
      withScratch((root) => {
        const r = runScript(root, { junit: null, staleJunit: true, collectorRc: 1, collectorLine: COLLECTOR_LINE }, text);
        expect(r.out, 'the neuter did not let the stale file be attested').toContain('ZERO-RED');
      });
    });

    test('the real script is accepted by all three assertions (the control for everything above)', () => {
      withScratch((root) => {
        expect(zeroCollectedViolations(runScript(root, { junit: 'zero', collectorRc: 1, collectorLine: COLLECTOR_LINE }))).toEqual([]);
      });
      withScratch((root) => {
        expect(unhandledViolations(runScript(root, { junit: 'unhandled', collectorRc: 0 }))).toEqual([]);
      });
      withScratch((root) => {
        expect(cleanViolations(runScript(root, { junit: 'clean' }))).toEqual([]);
      });
    });
  });
});
