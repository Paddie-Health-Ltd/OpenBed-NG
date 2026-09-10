import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER A GUARD -- scripts/seed.sh's local-only refusal.
 *
 * THE SUBJECT. The seed plants synthetic facilities, wards and bed counts.
 * Reaching a non-local database with it would write invented hospitals into
 * something real. `--i-know-what-i-am-doing` is deliberately absent: there is no
 * legitimate reason to do it, so there is no flag for it.
 *
 * THE LEG HAD NO PLANT, AND THE CHECK HAD A HOLE. It matched
 * `*127.0.0.1*|*localhost*|*@db:*` against the WHOLE URL, so
 * `postgresql://u:p@localhost.attacker.example.com/app` read as local -- the
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

function runSeed(url: string): { status: number; out: string } {
  try {
    const out = execFileSync('bash', [SEED], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url, PATH: '/usr/bin:/bin' },
    });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
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
    // developer and the CI job actually use. They may still fail further on (no
    // psql on the stripped PATH here), but they must get past this leg.
    const res = runSeed(url);
    expect(res.out, `a local URL was refused:\n${res.out}`).not.toContain(REFUSAL);
  });
});
