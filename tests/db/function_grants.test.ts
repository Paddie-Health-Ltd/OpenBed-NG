import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { TransactionSql } from 'postgres';
import { withRole } from '../setup/db.js';
import { dbUrl } from '../setup/local-keys.js';
import GRANTS from '../../packages/fixtures/function-grants.json';

/**
 * THE FUNCTION-EXECUTE SURFACE, HELD TO ITS ONE SOURCE (R-2026-09-24-74 BB-2).
 *
 * packages/fixtures/function-grants.json says, for every function in app,
 * graphql_public and public, which of anon, authenticated and service_role can
 * EXECUTE it. The D3 closed-list test derives its list from that file, and
 * scripts/readback_function_grants.sh holds hosted to it after an apply. This file
 * holds the LOCAL catalogue to it, and proves the read-back's query and comparison
 * against a real schema:
 *   - ACCEPT: the script's own Q_GRANTS literal, run here, reads exactly the
 *     fixture, and the real script, run with real psql against this database, reads
 *     PASS;
 *   - PLANT: a grant added to anon, a grant revoked from authenticated, and a grant
 *     on a provisioning gate, each made inside a rolled-back transaction. The rows
 *     the real query reads there are handed to the real script through a one-file
 *     psql stub, and each must read STOP naming the function.
 *
 * The plants go through a stub because the script opens its own connection, which
 * cannot see a transaction that is never committed. Committing a grant to a shared
 * database would race every other test that reads the catalogue.
 *
 * NOT ASSERTED HERE, deliberately: hosted's answer. Only fence 6 of 020's apply shows
 * that.
 */

const SCRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'readback_function_grants.sh');
const Q_GRANTS = (() => {
  const m = /^Q_GRANTS="(.*)"$/m.exec(readFileSync(SCRIPT, 'utf8'));
  if (m === null) throw new Error('scripts/readback_function_grants.sh carries no Q_GRANTS= line');
  expect(m[1], 'Q_GRANTS holds a character bash expands inside double quotes').not.toMatch(/[$`"\\]/);
  return m[1]!;
})();

type Fixture = { schemas: string[]; functions: Record<string, { execute: string[]; why: string }> };
const FX = GRANTS as Fixture;

async function rows(tx: TransactionSql): Promise<string[]> {
  await tx.unsafe('set local search_path to pg_catalog');
  const out = await tx.unsafe<Record<string, string>[]>(Q_GRANTS);
  return out.map((r) => String(Object.values(r)[0]));
}

/** The real script, with a psql that answers the given rows. */
function scriptOver(answer: string[]): { status: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'grants-'));
  writeFileSync(join(dir, 'rows'), answer.join('\n') + '\n');
  writeFileSync(join(dir, 'psql'), `#!/usr/bin/env bash\ncat "${join(dir, 'rows')}"\n`);
  chmodSync(join(dir, 'psql'), 0o755);
  try {
    const out = execFileSync('bash', [SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DATABASE_URL: 'postgresql://stub@db.invalid/postgres', PATH: `${dir}:${process.env['PATH'] ?? ''}` } });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('the function-EXECUTE surface, against packages/fixtures/function-grants.json', () => {
  test("real catalogue is accepted — the script's own query reads exactly the fixture, entry for entry", async () => {
    const read = await withRole('postgres', null, rows);
    const fromFixture = Object.entries(FX.functions)
      .map(([id, g]) => `${id}|${g.execute.join(',')}`)
      .sort();
    expect(read.slice().sort()).toEqual(fromFixture);
  });

  test("the query's schemas are the fixture's, and the fixture holds both provisioning gates executable by no role", () => {
    const listed = /where n\.nspname in \(([^)]*)\)/.exec(Q_GRANTS)?.[1] ?? '';
    expect([...listed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual(FX.schemas.slice().sort());
    expect(FX.functions['app.provision_begin(uuid, text, text)']?.execute).toEqual([]);
    expect(FX.functions['app.provision_complete(uuid, uuid)']?.execute).toEqual([]);
  });

  test('real script is accepted — run with real psql against this database, it reads PASS', () => {
    let out = '';
    let status = 0;
    try {
      out = execFileSync('bash', [SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DATABASE_URL: dbUrl() } });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      status = err.status ?? -1;
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    expect(status, out).toBe(0);
    expect(out).toContain('PASS: every function in app, graphql_public and public is executable by exactly the roles packages/fixtures/function-grants.json names.');
    expect(out).toContain('  ok     app.provision_begin(uuid, text, text) EXECUTE: none');
  });

  test.each<[string, string, string]>([
    ['a grant to anon on a ward RPC', 'grant execute on function public.my_facility_wards() to anon', "  WRONG  public.my_facility_wards() EXECUTE: read 'anon,authenticated', must be 'authenticated'"],
    ['a grant revoked from authenticated', 'revoke execute on function public.publish_ward_status(text, text, integer, boolean, text, integer, text, timestamptz) from authenticated', "  WRONG  public.publish_ward_status(text, text, integer, boolean, text, integer, text, timestamp with time zone) EXECUTE: read 'none', must be 'authenticated'"],
    ['a grant to anon on a provisioning gate', 'grant execute on function app.provision_begin(uuid, text, text) to anon', "  WRONG  app.provision_begin(uuid, text, text) EXECUTE: read 'anon', must be 'none'"],
    // A new function in public reads EXECUTE for all three roles with no GRANT written:
    // Supabase's default privileges, observed here -- the default 020's REVOKEs remove.
    ['a function the fixture does not name', "create function public.zz_planted() returns int language sql as 'select 1'", "  WRONG  public.zz_planted() EXECUTE: read 'anon,authenticated,service_role', must be '(not in the fixture)'"],
  ])('plant — %s reads STOP naming it', async (_name, plant, wrong) => {
    const read = await withRole('postgres', null, async (tx) => {
      await tx.unsafe(plant);
      return rows(tx);
    });
    const r = scriptOver(read);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(wrong);
    expect(r.out).toContain('STOP: a line above reads WRONG.');
  });
});
