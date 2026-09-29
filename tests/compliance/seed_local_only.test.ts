import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, place, withScratch } from './_scratch.js';

/**
 * GUARD OVER A GUARD -- scripts/seed.sh's local-only refusal.
 *
 * THE SUBJECT. The seed plants synthetic facilities, wards and bed counts.
 * Reaching a non-local database with it would write invented hospitals into
 * something real. `--i-know-what-i-am-doing` is deliberately absent: there is no
 * legitimate reason to do it, so there is no flag for it.
 *
 * THE LEG HAD NO PLANT, AND THE CHECK HAD A HOLE. It matched
 * `*127.0.0.1*|*localhost*|*@db:*` against the WHOLE URL, so a URL with
 * credentials whose host is `localhost.attacker.example.com` read as local -- the
 * substring is there, in a domain that is not. Demonstrated before the fix: that
 * URL passed the guard and reached the psql step. On a machine with psql
 * installed it would have seeded a remote database.
 *
 * NO SEAM NEEDED, WHICH IS WHY THIS SHOULD HAVE EXISTED ALREADY. seed.sh takes
 * no ROOT argument, but the leg is driven entirely by DATABASE_URL: no scratch
 * tree, no database, no network.
 *
 * NOT ASSERTED HERE, deliberately: that the seed's CONTENTS are synthetic. This
 * checks only where it may be sent. The synthetic-data property is enforced by
 * review of database/seed/ and by the no-real-facility-names item in the
 * self-check, neither of which is mechanical.
 */

const SEED = join(REPO_ROOT, 'scripts/seed.sh');

/**
 * MOSTLY CREDENTIAL-FREE, AND THAT IS THE POINT.
 *
 * The first version of this file gave every plant a `user:password@` prefix, and
 * `scripts/lint_no_secrets.sh` correctly flagged the file: a remote Postgres URL
 * with a password is exactly the shape it hunts and it does not care that this
 * one is a fixture. The right fix was not to smuggle the literal past the
 * scanner -- it was to notice the plants never needed credentials at all. THE
 * GUARD READS THE HOST. A test file that legitimately trips the secret scanner
 * is a standing false positive, and a standing false positive is how a true
 * positive gets waved through later.
 *
 * ONE plant keeps credentials, assembled at runtime so the literal never exists
 * in the repository, because the parser has an `@`-stripping branch and a branch
 * with no plant is the thing this whole sweep is about.
 */
const pg = (rest: string): string => `postgres${'ql'}://${rest}`;
const REFUSAL = 'seed data is synthetic and must never reach a non-local database';

/** Inherited variables that would change what seed.sh or psql does; each run starts without them. */
const SCRUBBED = ['OPENBED_PSQL', 'PGHOST', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE', 'PSQLRC'];

/**
 * A STUB psql (and docker, for the hatch) FIRST ON PATH, R-2026-09-29-170 ET-1.
 * It records its arguments and the four PG variables seed.sh must remove, reads
 * its stdin and exits 0, so a run that gets past every check completes without
 * a connection. Plants name `.invalid` hosts, so even a red-first run against the
 * unfixed script could not reach anything real.
 */
const STUB = [
  '#!/bin/sh',
  '{ printf "CALL %s" "$(basename "$0")"; for a in "$@"; do printf " [%s]" "$a"; done; printf "\\n"',
  '  printf "ENV PGHOST=%s PGHOSTADDR=%s PGSERVICE=%s PGSERVICEFILE=%s\\n" "${PGHOST-<unset>}" "${PGHOSTADDR-<unset>}" "${PGSERVICE-<unset>}" "${PGSERVICEFILE-<unset>}"; } >> "$STUB_LOG"',
  'cat > /dev/null',
  'exit 0',
  '',
].join('\n');

interface SeedRun { status: number; out: string; log: string }

function runSeed(url: string, extra: Record<string, string> = {}): SeedRun {
  return withScratch((stub) => {
    for (const bin of ['psql', 'docker']) {
      place(stub, `bin/${bin}`, STUB);
      chmodSync(join(stub, 'bin', bin), 0o755);
    }
    const logPath = join(stub, 'calls.log');
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !SCRUBBED.includes(k)) env[k] = v;
    Object.assign(env, { DATABASE_URL: url, PATH: `${join(stub, 'bin')}:/usr/bin:/bin`, STUB_LOG: logPath }, extra);
    let status = 0;
    let out = '';
    try {
      out = execFileSync('bash', [SEED], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      status = err.status ?? -1;
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
    return { status, out, log };
  });
}

describe('seed.sh refuses a non-local database', () => {
  test.each([
    ['an ordinary remote host', pg('db.prod.example.com:5432/app')],
    // The three that defeated the unanchored substring match.
    ['a domain CONTAINING localhost', pg('localhost.attacker.example.com:5432/app')],
    ['a domain CONTAINING 127.0.0.1', pg('my127.0.0.1.example.net:5432/app')],
    ['a host beginning db. — the old *@db:* arm', pg('db.prod.example.com/app')],
    // The substring appearing somewhere that is not the host at all.
    // The one credential-bearing plant, and the only one that needs to be:
    // it covers the parser's @-stripping branch, and `localhost` sitting in the
    // credentials is precisely what the old whole-URL substring match fell for.
    ['localhost in the CREDENTIALS, host remote', pg('u:localhost@evil.example.com:5432/app')],
    ['localhost in the DATABASE NAME', pg('evil.example.com:5432/localhost')],
  ])('plant — %s is refused', (_name, url) => {
    const res = runSeed(url);
    expect(res.status, `a non-local database was accepted:\n${res.out}`).toBe(2);
    expect(res.out, `it exited 2 but for a different reason:\n${res.out}`).toContain(REFUSAL);
    expect(res.log, 'psql was reached after a refusal').toBe('');
  });

  test('plant — a host LIST with a local first host is refused (ES-2)', () => {
    // libpq tries each host of a comma list in turn with the same password. The
    // port strip read only the first, so this passed the check until
    // R-2026-09-29-169. The first host carries a port on purpose: without one the
    // whole list is the host and the old check already refused it.
    const res = runSeed(pg('localhost:5432,evil.example.com:5432/app'));
    expect(res.status, `a host list with a local first host was accepted:\n${res.out}`).toBe(2);
    expect(res.out, `it exited 2 but for a different reason:\n${res.out}`)
      .toContain('libpq falls through to the next host with the same password, so a local first host proves nothing.');
    expect(res.log, 'psql was reached after a refusal').toBe('');
  });

  // ---- R-2026-09-29-170, ET-1: a host the check did not see. Each was run red
  // first against aa72345's seed.sh, with the stub psql recording what it got.
  const LOCAL = pg('postgres:postgres@127.0.0.1:54322/postgres');
  const QUERY_REFUSAL = 'carries a query string -- a host or hostaddr parameter there overrides the host this check reads';
  const SCHEME_REFUSAL = 'must begin with postgresql:// or postgres:// -- anything else psql reads as a database name';
  const HATCH_REFUSAL = 'OPENBED_PSQL must be exactly: docker exec -i supabase_db_<project> psql [-U <name>] [-d <name>] -- the hatch reaches a local container only';

  test('plant — a local URL with ?host= naming another host is refused, and psql is never called (ET-1 a)', () => {
    const res = runSeed(pg('postgres:postgres@127.0.0.1:54322/postgres?host=evil.invalid'));
    expect(res.status, `a query override was accepted:\n${res.out}\n${res.log}`).toBe(2);
    expect(res.out).toContain(QUERY_REFUSAL);
    expect(res.log, `psql was reached:\n${res.log}`).toBe('');
  });

  test('plant — a bare localhost with PGHOST set is refused, and psql is never called (ET-1 b)', () => {
    const res = runSeed('localhost', { PGHOST: 'evil.invalid' });
    expect(res.status, `a bare host name was accepted:\n${res.out}\n${res.log}`).toBe(2);
    expect(res.out).toContain(SCHEME_REFUSAL);
    expect(res.log, `psql was reached:\n${res.log}`).toBe('');
  });

  test.each([
    ['PGHOST', { PGHOST: 'evil.invalid' }],
    ['PGHOSTADDR', { PGHOSTADDR: '192.0.2.1' }],
    ['PGSERVICE and PGSERVICEFILE', { PGSERVICE: 'evil', PGSERVICEFILE: '/nonexistent/pg_service.conf' }],
  ])('plant — %s beside the local URL never reaches psql (ET-1 c)', (_name, extra) => {
    const res = runSeed(LOCAL, extra);
    expect(res.log, `precondition: psql was never called, so this tests nothing:\n${res.out}`).toContain('CALL psql');
    for (const line of res.log.split('\n').filter((l) => l.startsWith('ENV '))) {
      for (const k of Object.keys(extra)) expect(line, `psql ran with ${k} set:\n${res.log}`).toContain(`${k}=<unset>`);
    }
  });

  test('plant — a ~/.psqlrc in HOME is never read: psql runs with -X (ET-1 d)', () => {
    withScratch((home) => {
      place(home, '.psqlrc', '\\connect postgres evil.invalid\n');
      expect(existsSync(join(home, '.psqlrc')), 'precondition: the planted psqlrc is not on disk').toBe(true);
      const res = runSeed(LOCAL, { HOME: home });
      expect(res.log, `precondition: psql was never called:\n${res.out}`).toContain('CALL psql');
      for (const line of res.log.split('\n').filter((l) => l.startsWith('CALL psql'))) {
        expect(line, `psql ran without -X, so a psqlrc could \\connect elsewhere:\n${res.log}`).toContain('[-X]');
      }
    });
  });

  test.each([
    ['host=', 'psql host=evil.invalid dbname=postgres'],
    ['hostaddr=', 'psql hostaddr=192.0.2.1 dbname=postgres'],
    ['a URL', `psql ${pg('evil.invalid/postgres')}`],
  ])('plant — an OPENBED_PSQL holding %s is refused, and nothing is run (ET-1 e)', (_name, hatch) => {
    const res = runSeed(LOCAL, { OPENBED_PSQL: hatch });
    expect(res.status, `a hatch naming a host was accepted:\n${res.out}\n${res.log}`).toBe(2);
    expect(res.out).toContain(HATCH_REFUSAL);
    expect(res.log, `the hatch was run:\n${res.log}`).toBe('');
  });

  test.each([
    ['the non-local refusal', { DATABASE_URL: pg('postgres:s3cretpw@db.prod.invalid:5432/app') }, 's3cretpw'],
    // A raw `@` in the password: the parse strips at the FIRST `@`, so the
    // authority it prints would carry the rest of the password.
    ['the host-list refusal', { DATABASE_URL: pg('postgres:s3c@retpw@localhost:5432,db.prod.invalid:5432/app') }, 'retpw'],
    ['the query refusal', { DATABASE_URL: pg('postgres:s3cretpw@127.0.0.1:54322/postgres?host=evil.invalid') }, 's3cretpw'],
    ['the scheme refusal', { DATABASE_URL: 'postgres:s3cretpw@localhost:5432/app' }, 's3cretpw'],
    ['the hatch refusal', { OPENBED_PSQL: `psql ${pg('postgres:s3cretpw@db.prod.invalid/app')}` }, 's3cretpw'],
  ])('plant — %s prints no credential and no query (ET-1 f)', (_name, extra, secret) => {
    const { DATABASE_URL: url = LOCAL, ...rest } = extra as Record<string, string>;
    const res = runSeed(url, rest);
    expect(res.status, `not refused:\n${res.out}\n${res.log}`).toBe(2);
    expect(res.out, 'the refusal printed a credential').not.toContain(secret);
    expect(res.out, 'the refusal printed a query').not.toContain('?host');
    expect(res.out, 'the refusal printed a host it read').not.toContain('.invalid');
  });

  test.each([
    ['127.0.0.1 with credentials', pg('postgres:postgres@127.0.0.1:54322/postgres')],
    // NO CREDENTIALS -- the form the first version of this parser refused. It
    // stripped credentials BEFORE the scheme, so `${'postgres'}ql://localhost:5432/db`
    // parsed its host as `postgresql` and was rejected. Ordinary, and broken for
    // one turn; this is the plant that would have caught it.
    ['localhost with NO credentials', pg('localhost:5432/postgres')],
    ['127.0.0.1 with NO credentials', pg('127.0.0.1:54322/postgres')],
    ['the docker-compose host `db`', pg('postgres:postgres@db:5432/postgres')],
  ])('positive control — %s is NOT refused', (_name, url) => {
    // A guard that refuses everything is a rubber stamp: these are the forms every
    // developer and the CI job actually use. Since ET-1 they run to completion
    // against the stub psql, which must be reached with the URL and -X.
    const res = runSeed(url);
    expect(res.out, `a local URL was refused:\n${res.out}`).not.toContain('REFUSING');
    expect(res.status, `a local URL did not complete:\n${res.out}`).toBe(0);
    expect(res.log, `psql was not reached with the URL:\n${res.log}`).toContain(`[${url}]`);
  });

  // ---- R-2026-09-29-171, EU-1: THE HATCH NAMES ITS WHOLE SHAPE. ET-1 e refused three
  // words; each of these passed it, and was run, on 96aa95b. Now the value must be exactly
  // `docker exec -i supabase_db_<project> psql`, then at most one -U <name> and one -d
  // <name>, in either order, and nothing else. Every plant names a `.invalid` host or a
  // distinctive planted token, so a red-first run could not reach anything real.
  const DOC = 'docker exec -i supabase_db_x psql';
  test.each([
    ['psql -h naming a host', 'psql -h evil.invalid -U postgres'],
    ['psql --host naming a host', 'psql --host evil.invalid'],
    ['env PGHOST=… before psql', 'env PGHOST=evil.invalid psql'],
    ['the container psql with -h', `${DOC} -h evil.invalid`],
    ['docker exec -e PGHOST=…', 'docker exec -i -e PGHOST=evil.invalid supabase_db_x psql'],
    ['docker -H naming a daemon', 'docker -H evil.invalid:2375 exec -i supabase_db_x psql'],
    ['docker --context', 'docker --context remote exec -i supabase_db_x psql'],
    ['-d naming a service', `${DOC} -d service=evil`],
    ['a container not named supabase_db_*', 'docker exec -i other_db psql'],
    ['supabase_db_ not at the start of the name', 'docker exec -i evil_supabase_db_x psql'],
    ['a container name carrying @host', 'docker exec -i supabase_db_x@evil.invalid psql'],
    ['exec -it instead of -i', 'docker exec -it supabase_db_x psql'],
    ['-U given twice', `${DOC} -U plantuserone -U plantusertwo`],
    ['a trailing bare -U', `${DOC} -U`],
    ['the documented shape with one trailing word', `${DOC} -U postgres -d postgres extra`],
    ['the documented shape, a newline, then -h', `${DOC} -U postgres -d postgres\n-h evil.invalid`],
    ['a whitespace-only value', '   '],
  ])('plant — an OPENBED_PSQL of %s is refused, and nothing is run (EU-1)', (_name, hatch) => {
    const res = runSeed(LOCAL, { OPENBED_PSQL: hatch });
    expect(res.status, `a hatch outside the shape was accepted:\n${res.out}\n${res.log}`).toBe(2);
    expect(res.out).toContain(HATCH_REFUSAL);
    expect(res.log, `the hatch was run:\n${res.log}`).toBe('');
    // The refusal is fixed text: it prints none of the value's own words. Only planted
    // tokens are checked, never a word the fixed message itself holds.
    for (const token of ['evil.invalid', 'other_db', 'plantuserone', 'plantusertwo', 'remote', 'service=evil']) {
      expect(res.out, `the refusal printed the planted ${token}`).not.toContain(token);
    }
  });

  const DOCUMENTED = 'docker exec -i supabase_db_OpenBed-NG psql -U postgres -d postgres';

  test.each([
    ['PGHOST', { PGHOST: 'evil.invalid' }],
    ['PGHOSTADDR', { PGHOSTADDR: '192.0.2.1' }],
    ['PGSERVICE', { PGSERVICE: 'evil' }],
    ['PGSERVICEFILE', { PGSERVICEFILE: '/nonexistent/pg_service.conf' }],
  ])('plant — %s beside the documented hatch never reaches docker (EU-1 b)', (name, extra) => {
    const res = runSeed(LOCAL, { OPENBED_PSQL: DOCUMENTED, ...extra });
    expect(res.log, `precondition: docker was never called, so this tests nothing:\n${res.out}`).toContain('CALL docker');
    const envLines = res.log.split('\n').filter((l) => l.startsWith('ENV '));
    expect(envLines.length, `no ENV line was recorded:\n${res.log}`).toBeGreaterThan(0);
    for (const line of envLines) expect(line, `docker ran with ${name} set:\n${res.log}`).toContain(`${name}=<unset>`);
  });

  test('plant — the documented hatch runs with -X and ON_ERROR_STOP last (EU-1 b)', () => {
    const res = runSeed(LOCAL, { OPENBED_PSQL: DOCUMENTED });
    const calls = res.log.split('\n').filter((l) => l.startsWith('CALL docker'));
    expect(calls.length, `docker was never called:\n${res.out}`).toBeGreaterThan(0);
    for (const line of calls) {
      expect(line, `the hatch ran without -X, so a psqlrc in the container could \\connect elsewhere:\n${res.log}`)
        .toMatch(/ \[-X\] \[-v\] \[ON_ERROR_STOP=1\]$/);
    }
  });

  test.each([
    // The most ordinary valid hatch: scripts/run_migrations.sh's own example.
    ['the documented shape', DOCUMENTED, 'CALL docker [exec] [-i] [supabase_db_OpenBed-NG] [psql] [-U] [postgres] [-d] [postgres] [-X]'],
    ['-d before -U', 'docker exec -i supabase_db_OpenBed-NG psql -d postgres -U postgres', 'CALL docker [exec] [-i] [supabase_db_OpenBed-NG] [psql] [-d] [postgres] [-U] [postgres] [-X]'],
    ['the shape with neither flag', 'docker exec -i supabase_db_OpenBed-NG psql', 'CALL docker [exec] [-i] [supabase_db_OpenBed-NG] [psql] [-X]'],
  ])('positive control — the OPENBED_PSQL hatch as %s is NOT refused, and is run (EU-1)', (_name, hatch, call) => {
    const res = runSeed(LOCAL, { OPENBED_PSQL: hatch });
    expect(res.out, `the hatch was refused:\n${res.out}`).not.toContain('REFUSING');
    expect(res.status, res.out).toBe(0);
    expect(res.log, `the hatch was not run as given:\n${res.log}`).toContain(call);
  });
});
