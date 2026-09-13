import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, withScratch } from './_scratch.js';
import { PLANT_SB_SECRET, PLANT_SERVICE_ROLE_JWT } from './_plants.js';

/**
 * GUARD OVER THE ONLY SANCTIONED WAY TO OBTAIN THE PUBLISHABLE KEY.
 *
 * THE SUBJECT HAD NEVER BEEN RUN. scripts/get_publishable_key.sh was cited by
 * the runbook from 2026-09-09 and the subject of a documented incident, and the
 * first time anyone executed it -- 2026-09-13, mid-runbook -- it failed at its
 * first pipe. Its filter had been written against a response body nobody had
 * seen. It was also the one script registered as `no-injectable-hook`: no seam,
 * so no plant, so no evidence. It now has a seam, OPENBED_SUPABASE_CLI, and this
 * file is what it is for.
 *
 * WHAT A FAILURE OF THIS SCRIPT COSTS, which is why every plant below asserts
 * STDOUT IS EMPTY and not merely that the exit is non-zero. The runbook's
 * boundary probes take their key from `KEY="$(bash scripts/get_publishable_key.sh)"`.
 * Anything this script prints on stdout becomes the key. A fragment, an error
 * string, or a secret key would each be handed to curl as though it were the
 * publishable key -- and a secret key there is the 2026-09-09 incident again.
 *
 * THE STUB IS CONSTRUCTED, NEVER COMMITTED, and it ignores its arguments. It
 * stands in for the CLI's behaviour, not its argument parsing, which is the
 * CLI's business and is exercised only by a real call.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - A POSITIVE CONTROL. test-conventions section 2 requires one, and it is
 *     withheld from this commit on purpose: the most ordinary valid input IS
 *     the real Management API response, and a hand-written one would be built
 *     from the filter and prove the filter against itself. It lands with the
 *     founder's redacted capture of a live response.
 *   - The value of the response's `type` field. It has never been observed;
 *     selection is by the key's own prefix for exactly that reason.
 *   - That `-o json` is the flag a future CLI accepts. Observed on CLI 2.117.0.
 *     A CLI that changes it produces table text again, which the first plant
 *     below catches -- loudly, in this script's own words.
 *
 * FIELD NAMES USED HERE are only `api_key`, which was captured from the live
 * response. No other field is assumed.
 */

const SCRIPT_NAME = 'get_publishable_key.sh';
const SCRIPT = join(REPO_ROOT, 'scripts', SCRIPT_NAME);

/**
 * A publishable-key-shaped value, assembled at runtime so no key-shaped literal
 * exists in the repository. Long enough to pass the script's shape check.
 */
const PLANT_PUBLISHABLE = `sb_${'publishable'}_${'P'.repeat(31)}`;

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs the real script against a stub CLI that prints `body` and exits `code`.
 * `path` overrides PATH, for the one plant that needs jq to be absent.
 */
function withStub(body: string, code: number, fn: (run: () => Run) => void, opts: { path?: string } = {}): void {
  withScratch((root) => {
    const bodyFile = join(root, 'body.txt');
    writeFileSync(bodyFile, body, 'utf8');
    const stub = join(root, 'supabase-stub');
    // cat, not echo: the body must reach stdout byte for byte, including the
    // case where it is empty and has no trailing newline.
    writeFileSync(stub, `#!/bin/bash\ncat ${JSON.stringify(bodyFile)}\nexit ${code}\n`, 'utf8');
    chmodSync(stub, 0o755);

    fn(() => {
      try {
        const stdout = execFileSync('/bin/bash', [SCRIPT], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, OPENBED_SUPABASE_CLI: stub, ...(opts.path === undefined ? {} : { PATH: opts.path }) },
        });
        return { status: 0, stdout, stderr: '' };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
      }
    });
  });
}

/** Every refusal must leave the caller holding nothing that could be mistaken for a key. */
function expectRefusedWithNothingPrinted(r: Run, what: string): void {
  expect(r.status, `${what} was accepted:\n${r.stderr}`).not.toBe(0);
  expect(r.stdout, `${what} put something on stdout, which a caller's KEY="$(...)" would treat as the key`).toBe('');
}

describe('get_publishable_key.sh — refuses everything that is not a usable key', () => {
  test('plant — the CLI default TABLE output is rejected in the script’s own words', () => {
    // The exact failure of 2026-09-13. The old script surfaced it as jq's
    // "parse error: Invalid numeric literal" from inside a command
    // substitution, while its header claimed failures were reported in its own
    // words.
    const table = ['  NAME      | TYPE        | KEY', '  default   | publishable | (redacted)', ''].join('\n');
    withStub(table, 0, (run) => {
      const r = run();
      expectRefusedWithNothingPrinted(r, 'table output');
      expect(r.status).toBe(1);
      expect(r.stderr, 'the refusal did not say the response was not JSON').toContain(
        'the CLI response is not JSON, so no key was read.',
      );
      expect(r.stderr, 'jq’s own parse error leaked through instead of the script’s message').not.toContain(
        'parse error',
      );
    });
  });

  test('plant — an EMPTY response from a CLI that exited 0 is rejected', () => {
    // A command that succeeds and says nothing. Without the shape check the
    // selection returns nothing and this would read as "no publishable key
    // exists" -- a confident wrong diagnosis.
    withStub('', 0, (run) => {
      const r = run();
      expectRefusedWithNothingPrinted(r, 'an empty response');
      expect(r.stderr).toContain('the CLI response is not a single top-level JSON array, so no key was read.');
    });
  });

  test('plant — the IMAGINED `{"keys": [...]}` wrapper is rejected, even holding a publishable key', () => {
    // The shape the old filter was written against. A publishable key is
    // placed INSIDE the wrapper deliberately: a script that went looking for it
    // would print it and pass, so this proves the wrapper is refused as a shape
    // rather than merely coming back empty.
    withStub(JSON.stringify({ keys: [{ api_key: PLANT_PUBLISHABLE }] }), 0, (run) => {
      const r = run();
      expectRefusedWithNothingPrinted(r, 'an object wrapper');
      expect(r.stderr).toContain('the CLI response is not a single top-level JSON array, so no key was read.');
      expect(r.stderr, 'the refusal echoed the response').not.toContain(PLANT_PUBLISHABLE);
    });
  });

  test('plant — a CLI that exits non-zero is rejected as unreachable', () => {
    withStub('', 1, (run) => {
      const r = run();
      expectRefusedWithNothingPrinted(r, 'a failing CLI');
      expect(r.status, 'could-not-reach must be distinguishable from no-usable-key').toBe(2);
      expect(r.stderr).toContain('could not reach the Supabase Management API.');
    });
  });

  test('plant — an array holding only a SECRET key and a legacy JWT prints neither', () => {
    // THE PROPERTY THAT MATTERS MOST. Selecting by the sb_publishable_ prefix
    // cannot return a secret or a service_role JWT by construction; this is the
    // plant that shows it. Both are present, neither may reach stdout or the
    // error text.
    const response = [{ api_key: PLANT_SB_SECRET }, { api_key: PLANT_SERVICE_ROLE_JWT }];
    withStub(JSON.stringify(response), 0, (run) => {
      const r = run();
      expectRefusedWithNothingPrinted(r, 'a response with no publishable key');
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('no publishable (sb_publishable_) key for project');
      expect(r.stderr, 'a SECRET key reached the error output').not.toContain(PLANT_SB_SECRET);
      expect(r.stderr, 'a service_role JWT reached the error output').not.toContain(PLANT_SERVICE_ROLE_JWT);
    });
  });

  test('plant — a publishable-prefixed value too short to be a key is not printed', () => {
    // A prefix match proves where a value came from, not that it is whole. A
    // truncated key printed to stdout would become KEY and fail every probe
    // with 401 -- the false negative the runbook's guard exists to prevent,
    // produced one layer earlier.
    withStub(JSON.stringify([{ api_key: 'sb_publishable_short' }]), 0, (run) => {
      const r = run();
      expectRefusedWithNothingPrinted(r, 'a truncated publishable key');
      expect(r.stderr).toContain('the publishable key in the response has an unexpected shape, so it was not printed.');
    });
  });

  test('plant — a machine without jq is refused before the CLI is ever called', () => {
    // PATH points at an empty scratch directory. The script is started by
    // absolute path and uses only bash builtins before the jq check, so the
    // one thing missing is jq.
    withScratch((emptyBin) => {
      mkdirSync(join(emptyBin, 'bin'), { recursive: true });
      withStub(JSON.stringify([{ api_key: PLANT_PUBLISHABLE }]), 0, (run) => {
        const r = run();
        expectRefusedWithNothingPrinted(r, 'a run without jq');
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('jq is required (brew install jq).');
      }, { path: join(emptyBin, 'bin') });
    });
  });

  /**
   * A FAKE jq, first on PATH, that fails from its Nth invocation onward.
   *
   * These two legs were nearly registered as unreachable -- "fires only if jq
   * itself fails to run" -- and that would have been a false entry: PATH is a
   * seam, and a jq that exits 3 reaches each branch directly. A leg registered
   * as unprovable when it can be planted reads as residue that does not exist.
   *
   * Builtins only (`read`, `echo`, `[`), so the fake does not depend on what
   * else PATH happens to hold. Invocation 1 is the shape check; invocation 2 is
   * the selection. `command -v jq` finds the fake without running it.
   */
  function withFakeJq(failFromCall: number, fn: (path: string) => void): void {
    withScratch((dir) => {
      const bin = join(dir, 'bin');
      mkdirSync(bin, { recursive: true });
      const counter = join(dir, 'jq-calls');
      writeFileSync(
        join(bin, 'jq'),
        [
          '#!/bin/bash',
          `f=${JSON.stringify(counter)}`,
          'n=0; [ -f "$f" ] && read -r n < "$f"',
          'n=$((n + 1)); echo "$n" > "$f"',
          `[ "$n" -ge ${failFromCall} ] && exit 3`,
          'exit 0',
          '',
        ].join('\n'),
        'utf8',
      );
      chmodSync(join(bin, 'jq'), 0o755);
      fn(`${bin}:/usr/bin:/bin`);
    });
  }

  test('plant — jq failing on the SHAPE check is reported as a check that did not run, never as a verdict', () => {
    // Whichever branch "could not run" lands on is what it silently becomes. Had
    // jq's exit 3 fallen into the not-JSON or not-an-array arm, a broken jq
    // would have been reported as a malformed response.
    withFakeJq(1, (path) => {
      withStub(JSON.stringify([{ api_key: PLANT_PUBLISHABLE }]), 0, (run) => {
        const r = run();
        expectRefusedWithNothingPrinted(r, 'a run whose jq failed on the shape check');
        expect(r.status, 'could-not-run must be distinguishable from no-usable-key').toBe(2);
        expect(r.stderr).toContain('checking the response shape -- the check did not run.');
      }, { path });
    });
  });

  test('plant — jq failing on the SELECTION is reported as a selection that did not run', () => {
    // The shape check passes -- invocation 1 succeeds -- so nothing earlier can
    // fire, and only the selection fails. Without its own status check the key
    // would be empty and this would read as "no publishable key exists": a
    // confident wrong diagnosis over a valid response holding a valid key.
    withFakeJq(2, (path) => {
      withStub(JSON.stringify([{ api_key: PLANT_PUBLISHABLE }]), 0, (run) => {
        const r = run();
        expectRefusedWithNothingPrinted(r, 'a run whose jq failed on the selection');
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('selecting the key -- the selection did not run.');
        expect(r.stderr, 'a failed selection was misreported as a missing key').not.toContain(
          'no publishable (sb_publishable_) key',
        );
      }, { path });
    });
  });
});
