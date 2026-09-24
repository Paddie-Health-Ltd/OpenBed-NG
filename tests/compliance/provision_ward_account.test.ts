import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER A GUARD -- scripts/provision_ward_account.mjs, and its host check,
 * scripts/provision_target.mjs.
 *
 * THE SUBJECT. This script is the ONLY thing that makes the
 * auth.uid() -> app.ward_account linkage true: migration 003 declares
 * `id uuid PRIMARY KEY` with no foreign key to auth.users, so nothing at the
 * schema level enforces it. A defect here does not produce a broken account --
 * it produces an account whose id does not match its auth user, which fails at
 * my_facility_wards() with NOT_A_MEMBER and reads like a permissions bug.
 *
 * WHAT THIS FILE HOLDS, and it needs no service:
 *   - the usage and credential legs;
 *   - THE GATE LEG (R-2026-09-24-88 BP-6 1 and 4): the script calls
 *     app.provision_begin and app.provision_complete and writes no app.* table
 *     itself, so the gates keep one implementation, in SQL. Until PR 3.4b-app A
 *     the script inserted the invite and the account directly and ran no gate;
 *     the plant below is that shape;
 *   - THE HOST CHECK's classifier (BP-6 5), with the two mismatch plants the
 *     kickoff names -- the two URLs naming different projects, and a hosted pair
 *     with no --project-ref -- and the most ordinary valid inputs accepted.
 *
 * WHAT MOVED OUT, and why (2026-09-24, PR 3.4b-app A). The leg "an unreachable GoTrue
 * fails loudly rather than half-provisioning" ran here with no database, because
 * the script used to call GoTrue first. It now calls app.provision_begin first, so
 * that leg needs Postgres, and it lives in tests/db/provision_script.test.ts,
 * strengthened: three attempts counted, the invite left open, and "setup incomplete"
 * named.
 *
 * NOT ASSERTED HERE, deliberately, and both are named rather than implied:
 *
 *   1. The HAPPY PATH and every failure point. They need a database; they are in
 *      tests/db/provision_script.test.ts, which counts Auth requests at a stub, and
 *      the happy path runs again through tests/e2e/ against a real GoTrue.
 *   2. That the address is a ROLE address rather than a person's mailbox. There
 *      is no technical check that distinguishes them and there will not be one;
 *      the mitigation is contractual.
 */
const TOOL = join(REPO_ROOT, 'scripts/provision_ward_account.mjs');
const TARGET = join(REPO_ROOT, 'scripts/provision_target.mjs');
const FACILITY = 'e2e00000-0000-4000-8000-000000000001';

function run(args: string[], env: Record<string, string> = {}): { status: number; out: string } {
  try {
    return {
      status: 0,
      out: execFileSync('node', [TOOL, ...args], { encoding: 'utf8', env: { ...process.env, ...env } }),
    };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('provision_ward_account', () => {
  test.each([
    ['no arguments at all', []],
    ['no --category', ['--email', 'a@b.invalid', '--facility', FACILITY]],
    ['no --facility', ['--email', 'a@b.invalid', '--category', 'MATERNITY']],
    ['no --email', ['--facility', FACILITY, '--category', 'MATERNITY']],
    ['a dangling flag with no value', ['--email']],
    ['the operator form given a facility', ['--email', 'a@b.invalid', '--role', 'PLATFORM_ADMIN', '--facility', FACILITY]],
    ['the operator form given a category', ['--email', 'a@b.invalid', '--role', 'PLATFORM_ADMIN', '--category', 'MATERNITY']],
    ['a flag the script does not know', ['--email', 'a@b.invalid', '--role', 'PLATFORM_ADMIN', '--project', 'x']],
    ['a flag given twice', ['--email', 'a@b.invalid', '--email', 'c@d.invalid', '--role', 'PLATFORM_ADMIN']],
  ])('leg — %s is a usage failure', (_name, args) => {
    const res = run(args as string[]);
    expect(res.status, `an incomplete invocation was accepted:\n${res.out}`).toBe(1);
    expect(res.out).toContain('usage: node scripts/provision_ward_account.mjs');
  });

  test('leg — a missing service-role key is a STOP CONDITION, not a guess', () => {
    // The shape this project has been bitten by: get_publishable_key.sh preferred
    // a new key and fell back to a legacy one, and once legacy keys were disabled
    // it could only ever return a DEAD key -- printed to stdout, indistinguishable
    // from a good one, failing later at authentication in the safe-looking
    // direction. A missing credential must refuse loudly, never default.
    const res = run(
      ['--email', 'a@b.invalid', '--facility', FACILITY, '--category', 'MATERNITY'],
      { SUPABASE_SERVICE_ROLE_KEY: '' },
    );
    expect(res.status, `a missing credential did not stop the run:\n${res.out}`).toBe(2);
    expect(res.out).toContain('refusing to guess a credential');
  });

  test('leg — a host-check refusal exits 2 before any connection, and prints no password', () => {
    // No database and no GoTrue are running for this project, so reaching either
    // would be a different failure (exit 1). Exit 2 with the host-check sentence is
    // the pass signal, not "non-zero".
    // The password sits on the LOCAL database URL: a password in a URL for any other
    // host is a committed-secret finding for scripts/lint_no_secrets.sh, synthetic or not.
    const res = run(['--email', 'a@b.invalid', '--role', 'PLATFORM_ADMIN'], {
      SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key',
      SUPABASE_API_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      DATABASE_URL: 'postgresql://postgres:s3cret@127.0.0.1:59998/postgres',
    });
    expect(res.status, res.out).toBe(2);
    expect(res.out).toContain('REFUSING: the host check did not pass, and nothing was read or written');
    expect(res.out, 'the refusal printed the database password').not.toContain('s3cret');
  });

  test('the script does not fall back to a default credential anywhere', () => {
    // Source-text check, and it is the compensating control for the two legs
    // below that have no plant: a fallback is correct on the day it is written
    // and becomes a lie the day the thing it falls back to dies, silently,
    // because a fallback's whole purpose is not to complain.
    const src = execFileSync('cat', [TOOL], { encoding: 'utf8' });
    const serviceKeyLine = src.split('\n').filter((l) => l.includes('process.env.SUPABASE_SERVICE_ROLE_KEY') && !l.trim().startsWith('//'));
    expect(serviceKeyLine.length, 'the service-role key is read in more than one place').toBe(1);
    expect(serviceKeyLine[0], 'the service-role key has a default — it must be a stop condition').not.toMatch(/\?\?|\|\|/);
  });
});

/**
 * The script's executable text, comment lines blanked: its header describes the
 * insert the old script made, and an instrument must not accept prose as evidence
 * (test-conventions section 2 (a)).
 */
function code(src: string): string {
  return src
    .split('\n')
    .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l))
    .join('\n');
}

/** Violations of BP-6 1 and 4: the gates must both be called, and no app.* table written directly. */
function gateViolations(src: string): string[] {
  const text = code(src);
  const out: string[] = [];
  if (!/\bapp\.provision_begin\(/.test(text)) out.push('the script never calls app.provision_begin');
  if (!/\bapp\.provision_complete\(/.test(text)) out.push('the script never calls app.provision_complete');
  for (const m of text.matchAll(/\b(insert\s+into|update|delete\s+from)\s+app\.[a-z_]+/gi)) out.push(`the script writes an app table itself: ${m[0]}`);
  return out;
}

describe('the gates have one implementation, in SQL (BP-6 1, 4)', () => {
  const REAL = readFileSync(TOOL, 'utf8');

  test('real script is accepted — it calls both gates and writes no app.* table', () => {
    expect(gateViolations(REAL)).toEqual([]);
  });

  test("plant — the pre-3.4b-app shape, inserting the invite and the account itself, is rejected", () => {
    const planted = REAL.replace(
      'const sql = postgres(',
      "await sql`insert into app.invite (facility_id, ward_category, role, accepted_at) values (${f}, ${c}, ${r}, now())`;\nconst sql = postgres(",
    );
    expect(planted, 'the plant did not land').not.toBe(REAL);
    expect(gateViolations(planted)).toEqual(['the script writes an app table itself: insert into app.invite']);
  });

  test('plant — a script that skips app.provision_begin is rejected', () => {
    const planted = REAL.replace('from app.provision_begin(', 'from app.not_the_gate(');
    expect(planted, 'the plant did not land').not.toBe(REAL);
    expect(gateViolations(planted)).toEqual(['the script never calls app.provision_begin']);
  });

  test('plant — a write hidden in a comment line is NOT evidence either way: the header describing the old insert does not red the real script', () => {
    expect(REAL, 'the header no longer mentions the old direct insert, so this control controls nothing').toMatch(/inserted an accepted\s*\n?\s*\/\/\s*app\.invite/);
    expect(gateViolations(`// insert into app.invite\n${code(REAL)}`)).toEqual([]);
  });

  test('anti-vacuity — the checker over an empty corpus fails', () => {
    expect(gateViolations('')).toEqual(['the script never calls app.provision_begin', 'the script never calls app.provision_complete']);
  });
});

type Classified = { ok: true; target: string } | { ok: false; reason: string };
type Classify = (i: { apiUrl: string; dbUrl: string; projectRef: string | undefined }) => Classified;
const classify = async (): Promise<Classify> =>
  ((await import(pathToFileURL(TARGET).href)) as { classifyTarget: Classify }).classifyTarget;

const REF = 'abcdefghijklmnopqrst';
const OTHER = 'zyxwvutsrqponmlkjihg';
const LOCAL_API = 'http://127.0.0.1:54321';
const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const HOSTED_API = `https://${REF}.supabase.co`;
// Hosted-shaped fixtures carry NO password: scripts/lint_no_secrets.sh refuses a password
// in a URL for any host but this machine, synthetic or not. The two properties a password
// is needed for -- that one holding @ and : cannot move the parsed host, and that a
// refusal never prints it -- are asserted on the local database URL instead.
const HOSTED_DB = `postgresql://postgres@db.${REF}.supabase.co:5432/postgres`;
const POOLER_DB = `postgresql://postgres.${REF}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`;
const LOCAL_DB_WITH_PASSWORD = 'postgresql://postgres:p%40ss%3Aword@127.0.0.1:54322/postgres';

describe('the host check (BP-6 5) — scripts/provision_target.mjs', () => {
  test.each([
    ['the local defaults, the most ordinary run of all', LOCAL_API, LOCAL_DB, undefined, 'local'],
    ['a test stub on a scratch port beside the local database', 'http://127.0.0.1:61234', LOCAL_DB, undefined, 'local'],
    ['localhost and [::1]', 'http://localhost:54321', 'postgresql://postgres:postgres@[::1]:54322/postgres', undefined, 'local'],
    ['a local database URL whose password holds @ and :, which must not move the parsed host', LOCAL_API, LOCAL_DB_WITH_PASSWORD, undefined, 'local'],
    ['a hosted pair, direct', HOSTED_API, HOSTED_DB, REF, REF],
    ['a hosted pair through the pooler', HOSTED_API, POOLER_DB, REF, REF],
  ])('real input accepted — %s', async (_name, apiUrl, dbUrl, projectRef, target) => {
    const r = (await classify())({ apiUrl, dbUrl, projectRef });
    expect(r, JSON.stringify(r)).toEqual({ ok: true, target });
  });

  test.each([
    ['PLANT 1 — the two URLs name different projects', HOSTED_API, `postgresql://postgres@db.${OTHER}.supabase.co:5432/postgres`, REF, `SUPABASE_API_URL names project ${REF} and DATABASE_URL names project ${OTHER}`],
    ['PLANT 2 — a hosted pair with no --project-ref', HOSTED_API, HOSTED_DB, undefined, `a non-local run needs --project-ref ${REF}`],
    ['a --project-ref naming another project', HOSTED_API, HOSTED_DB, OTHER, `--project-ref ${OTHER} was given, but both URLs name project ${REF}`],
    ['a --project-ref on a local run', LOCAL_API, LOCAL_DB, REF, 'both name the local stack'],
    ['the local Auth API with a hosted database', LOCAL_API, HOSTED_DB, REF, `SUPABASE_API_URL names the local stack and DATABASE_URL names project ${REF}`],
    ['a hosted Auth API with the local database, whose password is never printed', HOSTED_API, LOCAL_DB_WITH_PASSWORD, REF, `SUPABASE_API_URL names project ${REF} and DATABASE_URL names the local stack`],
    ['the Worker, api.openbed.ng, which hides the ref', 'https://api.openbed.ng', HOSTED_DB, REF, 'SUPABASE_API_URL names https://api.openbed.ng'],
    ['a supabase.co Auth host over http', `http://${REF}.supabase.co`, HOSTED_DB, REF, `SUPABASE_API_URL names http://${REF}.supabase.co`],
    ['DATABASE_URL set to the empty string', LOCAL_API, '', undefined, 'DATABASE_URL is set but empty'],
    ['SUPABASE_API_URL set to the empty string', '', LOCAL_DB, undefined, 'SUPABASE_API_URL is set but empty'],
    ['a database value that is not a URL', LOCAL_API, 'db.example', undefined, 'DATABASE_URL is not a URL'],
    ['the pooler with a user that names no project', HOSTED_API, POOLER_DB.replace(`postgres.${REF}`, 'postgres'), REF, 'with a user that names no project'],
    ['a --project-ref that is not a ref', HOSTED_API, HOSTED_DB, 'PROD', '--project-ref is not a project ref'],
  ])('plant — %s is refused', async (_name, apiUrl, dbUrl, projectRef, reason) => {
    const r = (await classify())({ apiUrl, dbUrl, projectRef });
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.ok ? '' : r.reason).toContain(reason);
    expect(JSON.stringify(r), 'a refusal printed a database password').not.toMatch(/p%40ss|p@ss/);
  });

  test('anti-vacuity — the classifier over empty inputs refuses, and never defaults to local', async () => {
    const r = (await classify())({ apiUrl: '', dbUrl: '', projectRef: undefined });
    expect(r).toEqual({ ok: false, reason: 'SUPABASE_API_URL is set but empty' });
  });
});
