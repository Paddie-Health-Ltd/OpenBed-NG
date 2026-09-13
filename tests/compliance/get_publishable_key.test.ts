import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, withScratch } from './_scratch.js';
import { PLANT_SB_SECRET, PLANT_SERVICE_ROLE_JWT } from './_plants.js';
import CAPTURE from '../../packages/fixtures/supabase-api-keys-response.redacted.json';

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
 * THE STUB IS CONSTRUCTED, NEVER COMMITTED. It stands in for the CLI's
 * behaviour, and it RECORDS the arguments it was called with, so the call the
 * script makes is asserted rather than assumed.
 *
 * `-o json` IS TWO DIFFERENT CLAIMS, and they are stated separately.
 *   - Its PRESENCE is asserted here: the stub records argv, and a test requires
 *     `-o` followed by `json`. Until 2026-09-13 the stub ignored its arguments,
 *     so a refactor that removed or renamed the flag reddened nothing at all.
 *   - Its EFFECT -- that CLI 2.117.0 emits JSON when given it -- rests on ONE
 *     live observation, the founder's call on 2026-09-13, and on nothing in this
 *     repository. If a future CLI stops honouring it, the output reverts to a
 *     table, and the first plant below catches that in this script's own words.
 *
 * THE REAL SHAPE, from the founder's redacted capture of 2026-09-13, is
 * packages/fixtures/supabase-api-keys-response.redacted.json: a top-level array
 * of four entries -- legacy anon, legacy service_role, a publishable key and a
 * secret key -- carrying id, name, description, type, prefix, api_key and hash.
 * Three facts in it shape the tests:
 *   - type == "publishable" is CONFIRMED. The script still selects by the key's
 *     own prefix, which cannot return a secret by construction.
 *   - `name` is NOT a discriminator: two entries are named "default".
 *   - `description` is null on both non-legacy entries.
 *
 * WHY THE KEY VALUES ARE SYNTHESISED AT TEST TIME, NOT STORED IN THE FIXTURE.
 * The capture's own redaction replaced every api_key with a literal token, which
 * destroyed the shape the prefix selector reads. And a shape-preserving value
 * cannot be committed: a publishable value long enough to pass the script's
 * shape check trips scripts/lint_no_secrets.sh's generic-secret pattern once it
 * sits beside an api_key field, and a realistic sb_secret_ or JWT trips that
 * scanner's dedicated patterns. So the fixture carries the real shape with
 * placeholder tokens, and the tests assemble unmistakably fake values from
 * fragments, as tests/compliance/_plants.ts does. The scanner's one-file
 * allowlist is not widened for this.
 *
 * THE DECOYS ARE THE POINT. A fixture holding only the publishable entry has
 * nothing wrong to select, so a broken filter passes it. The legacy service_role
 * entry and the type "secret" entry are what prove the selector rejects the very
 * things it must never return -- and the fixture's own shape is asserted below,
 * so trimming them reds instead of quietly weakening every test built on it.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - The fixture's id, prefix and hash VALUES. They were redacted and not
 *     provided -- including whether they are null on the legacy entries -- and
 *     the script reads none of them.
 *   - That `-o json` keeps its effect on a future CLI. See above.
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
  /** What the stub CLI was called with, one entry per argument. Empty where the stub was never reached. */
  argv: string[];
}

/**
 * Runs the real script against a stub CLI that prints `body` and exits `code`.
 * `path` overrides PATH, for the plants that need jq absent or replaced.
 *
 * The stub RECORDS its argv, one argument per line, so the call the script makes
 * is asserted rather than assumed. `printf` is a bash builtin, so the recording
 * needs nothing from PATH.
 */
function withStub(body: string, code: number, fn: (run: () => Run) => void, opts: { path?: string } = {}): void {
  withScratch((root) => {
    const bodyFile = join(root, 'body.txt');
    const argvFile = join(root, 'argv.txt');
    writeFileSync(bodyFile, body, 'utf8');
    const stub = join(root, 'supabase-stub');
    // cat, not echo: the body must reach stdout byte for byte, including the
    // case where it is empty and has no trailing newline.
    writeFileSync(
      stub,
      `#!/bin/bash\nprintf '%s\\n' "$@" > ${JSON.stringify(argvFile)}\ncat ${JSON.stringify(bodyFile)}\nexit ${code}\n`,
      'utf8',
    );
    chmodSync(stub, 0o755);

    const readArgv = (): string[] => {
      if (!existsSync(argvFile)) return [];
      const text = readFileSync(argvFile, 'utf8');
      // Only the final newline is dropped. Filtering out every empty line would
      // hide an empty-string argument, which is exactly the kind of thing this
      // recording exists to reveal.
      return text === '' ? [] : text.replace(/\n$/, '').split('\n');
    };

    fn(() => {
      try {
        const stdout = execFileSync('/bin/bash', [SCRIPT], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, OPENBED_SUPABASE_CLI: stub, ...(opts.path === undefined ? {} : { PATH: opts.path }) },
        });
        return { status: 0, stdout, stderr: '', argv: readArgv() };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '', argv: readArgv() };
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

/**
 * THE REAL RESPONSE SHAPE, with unmistakably fake key values synthesised per
 * entry. See the header for why the values are not stored in the fixture.
 */
type CapturedEntry = (typeof CAPTURE)[number];

/** Assembled from fragments, so no key-shaped literal exists in the repository. */
const FAKE = {
  legacyAnon: ['eyJ', 'FAKE'.repeat(4), '.', 'eyJ', 'ANON', 'FAKE'.repeat(3), '.', 'FAKE'.repeat(4)].join(''),
  legacyServiceRole: ['eyJ', 'FAKE'.repeat(4), '.', 'eyJ', 'SERVICEROLE', 'FAKE'.repeat(3), '.', 'FAKE'.repeat(4)].join(''),
  publishable: `sb_${'publishable'}_${'FAKE'.repeat(8)}`,
  secret: `sb_${'secret'}_${'FAKE'.repeat(8)}`,
};

/** One fixture entry with its api_key replaced by the fake value for its kind. Loud on an unknown kind. */
function synthesise(entry: CapturedEntry): Record<string, unknown> {
  let apiKey: string;
  if (entry.type === 'publishable') {
    apiKey = FAKE.publishable;
  } else if (entry.type === 'secret') {
    apiKey = FAKE.secret;
  } else if (entry.type === 'legacy' && entry.name === 'service_role') {
    apiKey = FAKE.legacyServiceRole;
  } else if (entry.type === 'legacy' && entry.name === 'anon') {
    apiKey = FAKE.legacyAnon;
  } else {
    throw new Error(`the fixture holds an entry this test cannot synthesise: ${entry.name}/${entry.type}`);
  }
  return { ...entry, api_key: apiKey };
}

const realShape = (): Record<string, unknown>[] => CAPTURE.map(synthesise);

describe('get_publishable_key.sh — against the real Management API response shape', () => {
  test('anti-vacuity — the fixture keeps all four captured entries, decoys included', () => {
    // A fixture trimmed to the publishable entry would pass a broken filter, and
    // every test below would then prove nothing. So the capture's shape is itself
    // an assertion.
    expect(CAPTURE.length, 'the fixture is no longer the four-entry capture').toBe(4);
    expect(
      CAPTURE.map((e) => e.type).sort(),
      'the decoys were removed -- nothing wrong is left for the selector to reject',
    ).toEqual(['legacy', 'legacy', 'publishable', 'secret']);
    for (const e of CAPTURE) {
      expect(Object.keys(e), `${e.name}/${e.type} does not carry the captured fields, in the captured order`).toEqual([
        'id',
        'name',
        'description',
        'type',
        'prefix',
        'api_key',
        'hash',
      ]);
      expect(
        e.api_key.startsWith('sb_') || e.api_key.startsWith('eyJ'),
        `${e.name}/${e.type} commits a key-shaped value; the fixture must hold placeholders only`,
      ).toBe(false);
    }
    expect(CAPTURE.filter((e) => e.name === 'default').length, 'name must stay ambiguous, as captured').toBe(2);
    expect(
      CAPTURE.filter((e) => e.description === null).map((e) => e.type).sort(),
      'the null descriptions must stay on the non-legacy entries, as captured',
    ).toEqual(['publishable', 'secret']);
  });

  test('real Management API response shape is accepted — prints exactly the publishable key', () => {
    // THE POSITIVE CONTROL test-conventions section 2 requires, built on the
    // captured shape rather than on one written from the filter.
    withStub(JSON.stringify(realShape()), 0, (run) => {
      const r = run();
      expect(r.status, `the real response shape was refused:\n${r.stderr}`).toBe(0);
      expect(r.stdout, 'stdout is not exactly the publishable key and a newline').toBe(`${FAKE.publishable}\n`);
    });
  });

  test('plant — a sb_secret_ key sitting beside the publishable key is never returned', () => {
    // THE ASSERTION THIS SCRIPT EXISTS FOR. Before trusting the result, confirm
    // the plant planted: both dangerous decoys are genuinely in the stub's input.
    const body = JSON.stringify(realShape());
    expect(body, 'the secret decoy is not in the input -- this test would prove nothing').toContain(FAKE.secret);
    expect(body, 'the legacy service_role decoy is not in the input').toContain(FAKE.legacyServiceRole);

    withStub(body, 0, (run) => {
      const r = run();
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim(), 'the publishable key was not the one returned').toBe(FAKE.publishable);
      expect(r.stdout, 'a SECRET key reached stdout').not.toContain(FAKE.secret);
      expect(r.stdout, 'the legacy service_role key reached stdout').not.toContain(FAKE.legacyServiceRole);
      expect(r.stderr, 'a SECRET key reached the error output').not.toContain(FAKE.secret);
    });
  });

  test('plant — the secret entry placed first does not displace the publishable key', () => {
    // The capture happens to list the publishable entry before the secret one.
    // A selector loosened to "the first sb_ key" would pass on that order and
    // fail on this one, so the order is made hostile on purpose.
    const shape = realShape();
    const secret = shape.find((e) => e['type'] === 'secret');
    expect(secret, 'the synthesised shape has no secret entry').toBeDefined();
    const hostile = [secret, ...shape.filter((e) => e['type'] !== 'secret')];
    expect(hostile[0]?.['type'], 'the secret entry is not first').toBe('secret');

    withStub(JSON.stringify(hostile), 0, (run) => {
      const r = run();
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout, 'reordering the array changed which key was returned').toBe(`${FAKE.publishable}\n`);
    });
  });

  test('plant — the real shape without a publishable entry is refused, printing no decoy', () => {
    const noPublishable = realShape().filter((e) => e['type'] !== 'publishable');
    withStub(JSON.stringify(noPublishable), 0, (run) => {
      const r = run();
      expectRefusedWithNothingPrinted(r, 'the real shape without a publishable key');
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('no publishable (sb_publishable_) key for project');
      for (const decoy of [FAKE.secret, FAKE.legacyServiceRole, FAKE.legacyAnon]) {
        expect(r.stderr, 'a decoy key reached the error output').not.toContain(decoy);
      }
    });
  });

  test('the CLI is called for api-keys with -o json and the project ref, and never with --reveal', () => {
    // PRESENCE, not effect -- see the header. What this catches is the likeliest
    // regression by a wide margin: the flag removed or renamed in a refactor,
    // which until this test reddened nothing at all.
    withStub(JSON.stringify(realShape()), 0, (run) => {
      const r = run();
      expect(r.status, r.stderr).toBe(0);
      expect(r.argv.slice(0, 2), `not the api-keys subcommand: ${JSON.stringify(r.argv)}`).toEqual(['projects', 'api-keys']);

      const o = r.argv.indexOf('-o');
      expect(o, `the CLI was not given -o: ${JSON.stringify(r.argv)}`).toBeGreaterThanOrEqual(0);
      expect(r.argv[o + 1], `-o is not followed by json: ${JSON.stringify(r.argv)}`).toBe('json');

      const p = r.argv.indexOf('--project-ref');
      expect(p, `the CLI was not given --project-ref: ${JSON.stringify(r.argv)}`).toBeGreaterThanOrEqual(0);
      expect(r.argv[p + 1], 'the default project ref was not passed').toBe('klrlpxysjsjpdkeqdhvl');

      // The script's header says NEVER --reveal: it prints secret keys in full.
      // A present-tense claim like that carries its probe.
      expect(r.argv, 'the CLI was asked to --reveal secret keys').not.toContain('--reveal');
    });
  });
});
