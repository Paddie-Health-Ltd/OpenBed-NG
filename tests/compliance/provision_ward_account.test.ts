import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER A GUARD -- scripts/provision_ward_account.mjs.
 *
 * THE SUBJECT. This script is the ONLY thing that makes the
 * auth.uid() -> app.ward_account linkage true: migration 003 declares
 * `id uuid PRIMARY KEY` with no foreign key to auth.users, so nothing at the
 * schema level enforces it. A defect here does not produce a broken account --
 * it produces an account whose id does not match its auth user, which fails at
 * my_facility_wards() with NOT_A_MEMBER and reads like a permissions bug.
 *
 * NOT ASSERTED HERE, deliberately, and both are named rather than implied:
 *
 *   1. The HAPPY PATH. Provisioning needs a live GoTrue and a live database, so
 *      it is exercised by tests/e2e/, which provisions its two ward accounts
 *      through this script and then asserts the seam holds over a real token.
 *      Asserting it here as well would duplicate that at a lower fidelity.
 *   2. That the address is a ROLE address rather than a person's mailbox. There
 *      is no technical check that distinguishes them and there will not be one;
 *      the mitigation is contractual.
 */
const TOOL = join(REPO_ROOT, 'scripts/provision_ward_account.mjs');
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

  test('leg — an unreachable GoTrue fails loudly rather than half-provisioning', () => {
    // Exit 1 with the address named. The failure that matters is a PARTIAL
    // provision -- an auth user with no ward_account row -- which is why the two
    // inserts are one transaction and why a transport failure must abort before
    // either happens.
    const res = run(
      ['--email', 'a@b.invalid', '--facility', FACILITY, '--category', 'MATERNITY'],
      { SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key', SUPABASE_API_URL: 'http://127.0.0.1:59999' },
    );
    expect(res.status, `an unreachable GoTrue did not fail:\n${res.out}`).toBe(1);
    expect(res.out).toContain('provisioning failed for');
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
