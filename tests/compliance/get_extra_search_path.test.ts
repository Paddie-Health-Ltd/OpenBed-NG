import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, withScratch } from './_scratch.js';
import DOCUMENTED from '../../packages/fixtures/supabase-postgrest-config-response.documented.json';

/**
 * GUARD OVER THE ONLY SANCTIONED WAY TO READ db_extra_search_path.
 *
 * WHAT A FAILURE OF THIS SCRIPT COSTS. The setting is served only by the
 * Management API endpoint GET /v1/projects/<ref>/postgrest, which returns the
 * whole PostgREST configuration -- jwt_secret included, per Supabase's OpenAPI
 * schema PostgrestConfigWithJWTSecretResponse. Anything this script prints
 * lands in a terminal and, from there, in a transcript. A JWT secret there is
 * the 2026-09-09 incident at a different endpoint. So the assertion this file
 * exists for is not "the value comes back" but:
 *
 *   NO FIELD OTHER THAN db_extra_search_path CAN EVER REACH STDOUT OR STDERR.
 *
 * Every other documented field carries its own CANARY, and every test that
 * feeds a response checks both streams for all of them. Before trusting a
 * result, the plant is confirmed planted: the canaries must be in the stub's
 * input.
 *
 * THE STUB IS CONSTRUCTED, NEVER COMMITTED. It stands in for curl, records its
 * argv and its stdin, and prints a body. Recording stdin is what lets the token
 * be asserted OUT of argv and INTO stdin, rather than assumed.
 *
 * THE SHAPE IS DOCUMENTED, NOT CAPTURED -- unlike
 * packages/fixtures/supabase-api-keys-response.redacted.json, which is a
 * founder's redacted capture. packages/fixtures/supabase-postgrest-config-response.documented.json
 * carries the six properties of the OpenAPI schema as read on 2026-09-13, with
 * placeholder values.
 *
 * WHAT A LIVE RUN HAS SINCE CONFIRMED, AND WHAT IT HAS NOT. The founder's first
 * run against the hosted project on 2026-09-13 succeeded: one response, from one
 * project, was exactly one JSON object whose db_extra_search_path was a string
 * of the accepted shape. So the part of this fixture the script READS is now
 * confirmed against a live response. The other five fields, jwt_secret among
 * them, were never read or printed, by design, and remain documentation-derived
 * -- which is why the fixture is still named .documented.json. The script's
 * header records the same split.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - That the live endpoint matches the documented schema. No test can reach
 *     the hosted project without a management token in CI, in a public
 *     repository, for a credential class the SOP says cannot be rotated
 *     quietly. If the live shape differs, the script refuses in its own words
 *     and prints nothing -- the plants below prove that direction.
 *   - That the shape check could stop a secret the SERVER placed inside
 *     db_extra_search_path. It cannot; the script's header says so. The
 *     guarantee is structural selection, and that is what is tested.
 *   - curl's own behaviour for --fail and --header @-. The flags' PRESENCE is
 *     asserted; their effect rests on curl's documentation and on one
 *     observation (curl 8.7.1, 2026-09-13, header read from stdin sent once).
 */

const SCRIPT_NAME = 'get_extra_search_path.sh';
const SCRIPT = join(REPO_ROOT, 'scripts', SCRIPT_NAME);
const REF = 'klrlpxysjsjpdkeqdhvl';

/** Assembled from fragments: no token- or secret-shaped literal exists in the repository. */
const TOKEN = ['FAKE', 'MGMT', 'TOKEN', 'CANARY', 'Q'.repeat(20)].join('_');

/** The most ordinary valid value: Supabase's default extra search path. */
const ORDINARY = 'public, extensions';

/** One unique canary per documented field other than db_extra_search_path. */
const CANARY = {
  db_schema: ['public', 'CANARYSCHEMA'].join('_'),
  max_rows: 918273,
  db_pool: 918274,
  db_pool_acquisition_timeout: 918275,
  jwt_secret: ['FAKE', 'JWT', 'SECRET', 'CANARY', 'x'.repeat(24)].join(''),
};
const CANARY_TEXT = Object.values(CANARY).map(String);

/** The documented shape, field order preserved, each non-target field holding its canary. Loud on an unknown field. */
function documentedShape(value: unknown = ORDINARY): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DOCUMENTED)) {
    if (k === 'db_extra_search_path') out[k] = value;
    else if (k in CANARY) out[k] = CANARY[k as keyof typeof CANARY];
    else throw new Error(`the fixture holds a field this test has no canary for: ${k}`);
  }
  return out;
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
  /** What the stub curl was called with. Empty where the stub was never reached. */
  argv: string[];
  /** What the stub curl read on stdin. Empty where the stub was never reached. */
  stdin: string;
}

/**
 * Runs the real script against a stub curl that prints `body` and exits `code`.
 * `token: null` removes SUPABASE_ACCESS_TOKEN; `path` overrides PATH.
 */
function withStub(
  body: string,
  code: number,
  fn: (run: () => Run) => void,
  opts: { path?: string; token?: string | null } = {},
): void {
  withScratch((root) => {
    const bodyFile = join(root, 'body.txt');
    const argvFile = join(root, 'argv.txt');
    const stdinFile = join(root, 'stdin.txt');
    writeFileSync(bodyFile, body, 'utf8');
    const stub = join(root, 'curl-stub');
    writeFileSync(
      stub,
      [
        '#!/bin/bash',
        `printf '%s\\n' "$@" > ${JSON.stringify(argvFile)}`,
        `cat > ${JSON.stringify(stdinFile)}`,
        `cat ${JSON.stringify(bodyFile)}`,
        `exit ${code}`,
        '',
      ].join('\n'),
      'utf8',
    );
    chmodSync(stub, 0o755);

    const readArgv = (): string[] => {
      if (!existsSync(argvFile)) return [];
      const text = readFileSync(argvFile, 'utf8');
      return text === '' ? [] : text.replace(/\n$/, '').split('\n');
    };
    const readStdin = (): string => (existsSync(stdinFile) ? readFileSync(stdinFile, 'utf8') : '');

    const env: Record<string, string | undefined> = { ...process.env, OPENBED_CURL: stub };
    const token = opts.token === undefined ? TOKEN : opts.token;
    if (token === null) delete env['SUPABASE_ACCESS_TOKEN'];
    else env['SUPABASE_ACCESS_TOKEN'] = token;
    if (opts.path !== undefined) env['PATH'] = opts.path;

    fn(() => {
      try {
        const stdout = execFileSync('/bin/bash', [SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env });
        return { status: 0, stdout, stderr: '', argv: readArgv(), stdin: readStdin() };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { status: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '', argv: readArgv(), stdin: readStdin() };
      }
    });
  });
}

/** No canary and no token, in either stream. */
function expectNothingLeaked(r: Run, what: string): void {
  for (const c of CANARY_TEXT) {
    expect(r.stdout, `${what}: another field's value reached stdout`).not.toContain(c);
    expect(r.stderr, `${what}: another field's value reached stderr`).not.toContain(c);
  }
  expect(r.stdout, `${what}: the token reached stdout`).not.toContain(TOKEN);
  expect(r.stderr, `${what}: the token reached stderr`).not.toContain(TOKEN);
}

/** Every refusal leaves the caller holding nothing, and leaks nothing. */
function expectRefused(r: Run, what: string, status: number): void {
  expect(r.status, `${what} was accepted, or refused with the wrong code:\n${r.stderr}`).toBe(status);
  expect(r.stdout, `${what} put something on stdout, which a caller's ESP="$(...)" would treat as the value`).toBe('');
  expectNothingLeaked(r, what);
}

describe('get_extra_search_path.sh — refuses everything that is not a usable value', () => {
  test('plant — an HTML error page carrying a secret is rejected as not JSON, echoing nothing', () => {
    const page = `<html><body>error ${CANARY.jwt_secret}</body></html>`;
    expect(page, 'the canary is not in the input -- this test would prove nothing').toContain(CANARY.jwt_secret);
    withStub(page, 0, (run) => {
      const r = run();
      expectRefused(r, 'an HTML page', 1);
      expect(r.stderr).toContain('the response is not JSON, so nothing was read from it.');
    });
  });

  test('plant — an EMPTY response from a curl that exited 0 is rejected', () => {
    withStub('', 0, (run) => {
      const r = run();
      expectRefused(r, 'an empty response', 1);
      expect(r.stderr).toContain('the response is not a single top-level JSON object, so nothing was read from it.');
    });
  });

  test('plant — the documented object wrapped in an ARRAY is rejected, printing no field', () => {
    withStub(JSON.stringify([documentedShape()]), 0, (run) => {
      const r = run();
      expectRefused(r, 'an array wrapper', 1);
      expect(r.stderr).toContain('the response is not a single top-level JSON object, so nothing was read from it.');
    });
  });

  test('plant — two JSON documents are rejected rather than one being picked', () => {
    withStub(`${JSON.stringify(documentedShape())}\n${JSON.stringify(documentedShape())}`, 0, (run) => {
      const r = run();
      expectRefused(r, 'two documents', 1);
      expect(r.stderr).toContain('the response is not a single top-level JSON object, so nothing was read from it.');
    });
  });

  test('plant — curl exiting non-zero is rejected as unreachable', () => {
    withStub('', 22, (run) => {
      const r = run();
      expectRefused(r, 'a failing curl', 2);
      expect(r.stderr).toContain('could not read the PostgREST config from the Supabase Management API.');
    });
  });

  test('plant — a missing token is refused before curl is ever called', () => {
    withStub(JSON.stringify(documentedShape()), 0, (run) => {
      const r = run();
      expectRefused(r, 'a run without a token', 2);
      expect(r.stderr).toContain('SUPABASE_ACCESS_TOKEN is not set, so the Management API was not called.');
      expect(r.argv, 'curl was called without a token').toEqual([]);
    }, { token: null });
  });

  test('plant — a machine without jq is refused before curl is ever called', () => {
    withScratch((emptyBin) => {
      mkdirSync(join(emptyBin, 'bin'), { recursive: true });
      withStub(JSON.stringify(documentedShape()), 0, (run) => {
        const r = run();
        expectRefused(r, 'a run without jq', 2);
        expect(r.stderr).toContain('jq is required (brew install jq).');
        expect(r.argv, 'curl was called before the jq check').toEqual([]);
      }, { path: join(emptyBin, 'bin') });
    });
  });

  test('plant — db_extra_search_path MISSING is rejected, printing no other field', () => {
    const shape = documentedShape();
    delete shape['db_extra_search_path'];
    withStub(JSON.stringify(shape), 0, (run) => {
      const r = run();
      expectRefused(r, 'a response without the field', 1);
      expect(r.stderr).toContain('the response has no string db_extra_search_path, so nothing was read from it.');
    });
  });

  test('plant — db_extra_search_path null is rejected', () => {
    withStub(JSON.stringify(documentedShape(null)), 0, (run) => {
      const r = run();
      expectRefused(r, 'a null field', 1);
      expect(r.stderr).toContain('the response has no string db_extra_search_path, so nothing was read from it.');
    });
  });

  test('plant — db_extra_search_path as an OBJECT WRAPPING jwt_secret is rejected, printing no secret', () => {
    // The container case is why the type check exists: `jq -r` on an object
    // would print it whole, secret and all, and the value would never be empty.
    const body = JSON.stringify(documentedShape({ jwt_secret: CANARY.jwt_secret }));
    expect(body.split(CANARY.jwt_secret).length - 1, 'the secret is not inside the field -- this plant did not plant').toBe(2);
    withStub(body, 0, (run) => {
      const r = run();
      expectRefused(r, 'an object in the field', 1);
      expect(r.stderr).toContain('the response has no string db_extra_search_path, so nothing was read from it.');
    });
  });

  test('plant — db_extra_search_path as a NUMBER is rejected', () => {
    withStub(JSON.stringify(documentedShape(42)), 0, (run) => {
      const r = run();
      expectRefused(r, 'a numeric field', 1);
      expect(r.stderr).toContain('the response has no string db_extra_search_path, so nothing was read from it.');
    });
  });

  test('plant — an EMPTY db_extra_search_path is refused in its own words, never as silent output', () => {
    withStub(JSON.stringify(documentedShape('')), 0, (run) => {
      const r = run();
      expectRefused(r, 'an empty value', 1);
      expect(r.stderr).toContain('db_extra_search_path is present and EMPTY, so nothing was printed.');
    });
  });

  test.each([
    ['a dotted JWT-like value', ['eyJ', 'FAKE'.repeat(4), '.', 'eyJ', 'FAKE'.repeat(4), '.', 'FAKE'.repeat(4)].join('')],
    ['a JSON fragment', '{"a":1}'],
    ['a value with a newline', 'public,\nextensions'],
    ['a statement', 'public; drop schema app'],
    ['an over-long value', `${'a'.repeat(60)}, `.repeat(20).replace(/, $/, '')],
  ])('plant — %s in db_extra_search_path is not printed', (_what, value) => {
    withStub(JSON.stringify(documentedShape(value)), 0, (run) => {
      const r = run();
      expectRefused(r, _what, 1);
      expect(r.stderr).toContain('db_extra_search_path has an unexpected shape, so it was not printed.');
      expect(r.stderr, 'the refused value was echoed').not.toContain(value);
    });
  });

  /** A FAKE jq, first on PATH, failing from its Nth call: 1 shape, 2 type, 3 selection. */
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

  test('plant — jq failing on the SHAPE check is reported as a check that did not run', () => {
    withFakeJq(1, (path) => {
      withStub(JSON.stringify(documentedShape()), 0, (run) => {
        const r = run();
        expectRefused(r, 'jq failing on the shape check', 2);
        expect(r.stderr).toContain('checking the response shape -- the check did not run.');
      }, { path });
    });
  });

  test('plant — jq failing on the TYPE check is reported as a check that did not run', () => {
    withFakeJq(2, (path) => {
      withStub(JSON.stringify(documentedShape()), 0, (run) => {
        const r = run();
        expectRefused(r, 'jq failing on the type check', 2);
        expect(r.stderr).toContain('checking the field type -- the check did not run.');
        expect(r.stderr, 'a failed check was misreported as a missing field').not.toContain('has no string');
      }, { path });
    });
  });

  test('plant — jq failing on the SELECTION is reported as a selection that did not run', () => {
    withFakeJq(3, (path) => {
      withStub(JSON.stringify(documentedShape()), 0, (run) => {
        const r = run();
        expectRefused(r, 'jq failing on the selection', 2);
        expect(r.stderr).toContain('selecting db_extra_search_path -- the selection did not run.');
        expect(r.stderr, 'a failed selection was misreported as an empty value').not.toContain('present and EMPTY');
      }, { path });
    });
  });
});

describe('get_extra_search_path.sh — against the documented response shape', () => {
  test('anti-vacuity — the fixture keeps every documented property, jwt_secret included', () => {
    // A fixture trimmed to the target field has no other field to leak, and the
    // canary tests below would then prove nothing.
    expect(Object.keys(DOCUMENTED), 'the fixture is no longer the documented property list, in order').toEqual([
      'db_schema',
      'max_rows',
      'db_extra_search_path',
      'db_pool',
      'db_pool_acquisition_timeout',
      'jwt_secret',
    ]);
    for (const [k, v] of Object.entries(DOCUMENTED)) {
      const placeholder = (typeof v === 'string' && v.startsWith('<') && v.endsWith('>')) || v === 0;
      expect(placeholder, `${k} commits a real-looking value; the fixture must hold placeholders only`).toBe(true);
    }
  });

  test.each([
    ['Supabase’s default', ORDINARY, `${ORDINARY}\n`],
    ['a quoted $user entry', '"$user", public, extensions', '"$user", public, extensions\n'],
    ['a single schema', 'extensions', 'extensions\n'],
  ])('real PostgREST config shape is accepted — %s prints exactly the value', (_what, value, expected) => {
    // THE POSITIVE CONTROL test-conventions section 2 requires: the most
    // ordinary valid input, first.
    withStub(JSON.stringify(documentedShape(value)), 0, (run) => {
      const r = run();
      expect(r.status, `an ordinary config was refused:\n${r.stderr}`).toBe(0);
      expect(r.stdout, 'stdout is not exactly the value and a newline').toBe(expected);
    });
  });

  test('NO FIELD OTHER THAN db_extra_search_path REACHES STDOUT OR STDERR', () => {
    // THE ASSERTION THIS SCRIPT EXISTS FOR. Confirm the plant planted: every
    // canary, jwt_secret first among them, is genuinely in the stub's input.
    const body = JSON.stringify(documentedShape());
    for (const c of CANARY_TEXT) {
      expect(body, `canary ${c} is not in the input -- this test would prove nothing`).toContain(c);
    }
    withStub(body, 0, (run) => {
      const r = run();
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout, 'stdout is not exactly the one value').toBe(`${ORDINARY}\n`);
      expectNothingLeaked(r, 'the documented shape');
    });
  });

  test('plant — jwt_secret placed FIRST does not change what is printed', () => {
    // Order is made hostile on purpose: a selector loosened to "the first
    // string field" would pass on the documented order and leak on this one.
    const shape = documentedShape();
    const hostile = { jwt_secret: shape['jwt_secret'], ...shape };
    expect(Object.keys(hostile)[0], 'jwt_secret is not first').toBe('jwt_secret');
    withStub(JSON.stringify(hostile), 0, (run) => {
      const r = run();
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout, 'reordering the object changed what was printed').toBe(`${ORDINARY}\n`);
      expectNothingLeaked(r, 'the hostile order');
    });
  });

  test('curl is called for this project’s /postgrest with --fail and --max-time, and the token never enters argv', () => {
    withStub(JSON.stringify(documentedShape()), 0, (run) => {
      const r = run();
      expect(r.status, r.stderr).toBe(0);
      expect(r.argv, `not this project's endpoint: ${JSON.stringify(r.argv)}`).toContain(
        `https://api.supabase.com/v1/projects/${REF}/postgrest`,
      );
      expect(r.argv, 'no --fail: an HTTP error body could be read as a config').toContain('--fail');

      const m = r.argv.indexOf('--max-time');
      expect(m, `no --max-time: ${JSON.stringify(r.argv)}`).toBeGreaterThanOrEqual(0);
      expect(Number(r.argv[m + 1]), 'the timeout exceeds the SOP’s 12 seconds').toBeLessThanOrEqual(12);

      const h = r.argv.indexOf('--header');
      expect(h, `no --header: ${JSON.stringify(r.argv)}`).toBeGreaterThanOrEqual(0);
      expect(r.argv[h + 1], 'the header is not read from stdin').toBe('@-');

      // THE TOKEN: nowhere in argv, where `ps` can read it; on stdin instead.
      for (const a of r.argv) expect(a, 'the token is in curl’s argv').not.toContain(TOKEN);
      expect(r.stdin, 'the Authorization header did not arrive on stdin').toBe(`Authorization: Bearer ${TOKEN}\n`);
    });
  });
});
