import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import golden from '../../packages/fixtures/snapshot-golden.json';
import { decodeFacilityExtra, encodeFacility, encodeFacilityExtra, encodeWard } from '../../packages/snapshot/src/index.js';
import { payloadProblems } from '../../packages/snapshot/src/serve.js';
import { extractPackagesAsAt } from '../setup/as_at.js';

/**
 * NO PAGE DEPLOYED AT OR AFTER 6866161 MAY FAIL TO DECODE A SNAPSHOT GENERATED AFTER 031
 * (R-2026-09-30-214 GN, the hard constraint). GUARD CLASS: LIVE: the new codec and the new generator
 * output it reads both exist now.
 *
 * WHY THE PREDECESSOR IS READ FROM GIT AND NOT COPIED. A copy of the old codec, checked in beside
 * this test, is a second derivation site: it would drift the first time somebody tidied it, and
 * the test would go on proving compatibility with a codec that no deployed page runs. So the
 * whole of `packages/` at the commit is extracted with `git archive` into a scratch directory
 * and imported from there. Every byte of the old decoder, the old fixture and the old Function
 * is the byte that was deployed.
 *
 * WHAT IS PROVED, in the order the constraint is stated:
 *   1. the codec AS AT 6866161 decodes a post-031 payload to the SAME facilities and the SAME
 *      wards as the payload without the new key. A page open on the old bundle keeps working
 *      when 031 is applied underneath it;
 *   2. the NEW code decodes a PRE-031 payload (no `facility_extras` key), because the page
 *      deploys first and meets the old generator for a while;
 *   3. the NEW Function's check accepts both, and still refuses an envelope key it does not know
 *      and a facility row of the wrong width;
 *   4. the OLD Function's check REFUSES the post-031 payload (it compares the envelope as an
 *      exact set). That is the reason the public dashboard is deployed BEFORE 031 is applied on
 *      hosted, and it is asserted here so the ordering rests on an executed check and not on a
 *      sentence.
 *
 * PLANT: a payload whose facility rows carry a ninth value, which is exactly what appending a
 * column would have shipped. The old decoder must throw on it, or this file proves nothing.
 *
 * NOT ASSERTED HERE, deliberately: that the hosted deploys happen in that order. That is a
 * human step in docs/runbook-supabase-project-creation.md; no test can see a Cloudflare deploy.
 *
 * THE COMMIT MUST BE IN THE CHECKOUT. A shallow clone does not have it. This file FAILS, naming
 * the ref and the setting, and never skips (test-conventions section 6): .github/workflows/ci.yml
 * sets fetch-depth: 0 on the jobs that run it. The one place the ref is written is REF below.
 */

const REF = '6866161';

type Row = readonly unknown[];
interface Envelope {
  v: number;
  generated_at: string;
  server_now: string;
  facilities: Row[];
  wards: Row[];
  facility_extras?: Row[];
}
interface OldCodec {
  decodeFacility: (r: Row) => Record<string, unknown>;
  decodeWard: (r: Row) => Record<string, unknown>;
  facilityColumns: () => readonly string[];
}
interface OldServe {
  payloadProblems: (p: unknown) => string[];
}

const FACILITY_ID = golden.golden.facilities[0]?.[0] as string;
const ADDRESS = '12 Example Street, Ikeja';

/** The payload the generator writes since 031, built with the NEW encoders so the two cannot drift. */
function postPayload(): Envelope {
  const g = golden.golden;
  return {
    v: g.v,
    generated_at: g.generated_at,
    server_now: g.server_now,
    facilities: g.facilities,
    wards: g.wards,
    facility_extras: [encodeFacilityExtra({ facility_id: FACILITY_ID, address: ADDRESS })],
  };
}
/** The same payload as the generator wrote it BEFORE 031: no extras key at all. */
function prePayload(): Envelope {
  const copy = postPayload();
  delete copy.facility_extras;
  return copy;
}

let scratch = '';
let oldCodec: OldCodec;
let oldServe: OldServe;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'openbed-as-at-'));
  extractPackagesAsAt(REF, scratch);
  oldCodec = (await import(/* @vite-ignore */ join(scratch, 'packages', 'snapshot', 'src', 'codec.ts'))) as OldCodec;
  oldServe = (await import(/* @vite-ignore */ join(scratch, 'packages', 'snapshot', 'src', 'serve.ts'))) as OldServe;
});
afterAll(() => {
  if (scratch !== '') rmSync(scratch, { recursive: true, force: true });
});

const decodeAll = (c: OldCodec, p: Envelope): { facilities: unknown[]; wards: unknown[] } => ({
  facilities: p.facilities.map((r) => c.decodeFacility(r)),
  wards: p.wards.map((r) => c.decodeWard(r)),
});

describe('a page at 6866161 against a snapshot generated after 031', () => {
  test('preconditions — the old facility row is 8 values wide, the post-031 payload carries extras, and the golden is not empty', () => {
    expect(oldCodec.facilityColumns()).toHaveLength(8);
    expect(postPayload().facility_extras, 'the post-031 payload has no extras, so the comparison below is vacuous').toHaveLength(1);
    expect(postPayload().facilities.length).toBeGreaterThan(0);
    expect(postPayload().wards.length).toBeGreaterThan(0);
  });

  test('the codec AS AT 6866161 decodes the post-031 payload to the same facilities and wards as before 031', () => {
    const before = decodeAll(oldCodec, prePayload());
    const after = decodeAll(oldCodec, postPayload());
    expect(after, 'the old decoder reads a post-031 snapshot differently').toEqual(before);
    expect(after.facilities[0], 'the old decoder lost the facility it should have read').toMatchObject({ facility_id: FACILITY_ID, name: 'E2E General Hospital' });
  });

  test('plant — a facility row with a NINTH value (what appending a column would ship) is thrown on by the old decoder', () => {
    const wide = [...(golden.golden.facilities[0] as Row), ADDRESS];
    expect(wide, 'the plant did not widen the row').toHaveLength(9);
    expect(() => oldCodec.decodeFacility(wide)).toThrow(/expected 8 values, received 9/);
  });

  test('the Function AS AT 6866161 REFUSES the post-031 payload and accepts the pre-031 one: the dashboard deploys BEFORE 031 is applied', () => {
    expect(oldServe.payloadProblems(prePayload()), 'the old Function refuses a payload it always accepted').toEqual([]);
    const problems = oldServe.payloadProblems(postPayload());
    expect(problems.length, 'the old Function accepts the new envelope key, so the deploy ordering is not needed').toBeGreaterThan(0);
    expect(problems.join('\n')).toContain('envelope');
  });
});

describe('the page and Function at HEAD against both generations of snapshot', () => {
  test('the new Function accepts the pre-031 payload AND the post-031 payload', () => {
    expect(payloadProblems(prePayload())).toEqual([]);
    expect(payloadProblems(postPayload())).toEqual([]);
  });

  test('the new Function still refuses an envelope key it does not know', () => {
    const planted = { ...postPayload(), facility_secrets: [] };
    expect(payloadProblems(planted).join('\n')).toContain('envelope');
  });

  test('the new Function still refuses a facility row of the wrong width, and a malformed extras row', () => {
    const wide = { ...postPayload(), facilities: [[...(golden.golden.facilities[0] as Row), ADDRESS]] };
    expect(payloadProblems(wide).join('\n')).toContain('facilities[0]');
    const bad = { ...postPayload(), facility_extras: [[FACILITY_ID]] };
    expect(payloadProblems(bad).join('\n')).toContain('facility_extras[0]');
  });

  test('the extras row round-trips through the new codec', () => {
    expect(decodeFacilityExtra(encodeFacilityExtra({ facility_id: FACILITY_ID, address: ADDRESS }))).toEqual({ facility_id: FACILITY_ID, address: ADDRESS });
  });

  test('the new encoders still write a wire-identical ward and facility row (the shape did not move)', () => {
    const f = golden.golden.facilities[0] as Row;
    const w = golden.golden.wards[0] as Row;
    expect(encodeFacility(oldCodec.decodeFacility(f))).toEqual(f);
    expect(encodeWard(oldCodec.decodeWard(w))).toEqual(w);
  });
});

describe('anti-vacuity', () => {
  test('anti-vacuity — reading a commit that is not in the checkout fails LOUDLY, naming the ref and fetch-depth', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openbed-as-at-missing-'));
    try {
      expect(() => extractPackagesAsAt('0000000000000000000000000000000000000000', dir)).toThrow(/0000000000000000000000000000000000000000[\s\S]*fetch-depth: 0/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('anti-vacuity — the scratch tree holds the old codec, so the imports above read something', () => {
    expect(typeof oldCodec.decodeFacility).toBe('function');
    expect(typeof oldServe.payloadProblems).toBe('function');
  });
});
