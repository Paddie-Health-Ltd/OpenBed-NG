import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { extractPackagesAsAt } from '../setup/as_at.js';
import { withRole } from '../setup/db.js';

/**
 * THE PAYLOAD THE REAL GENERATOR WRITES, DECODED BY THE CODEC AS AT 6866161 (R-2026-09-30-214 GN).
 *
 * GUARD CLASS: LIVE. app.regenerate_snapshot() as migration 031 restates it exists and runs here.
 *
 * tests/compliance/snapshot_compat_as_at_6866161.test.ts proves the constraint over a payload it
 * CONSTRUCTS with the new encoders. This file proves it over the payload the DATABASE writes,
 * because a constructed payload and a generated one can disagree (the SQL builds its rows by hand,
 * and tests/compliance/snapshot_shape_matches_migration.test.ts ties the fixture to the migration
 * only statically). A facility row from the generator that is not 8 values wide, or an envelope
 * that a page at that commit cannot read, is what this file fails on.
 *
 * The old codec is read from git (tests/setup/as_at.ts), never copied.
 *
 * NOT ASSERTED HERE, deliberately: the Pages Function's refusal of the new envelope key. That is
 * asserted over a constructed payload in the compliance twin of this file, where the old Function
 * is imported; here the contract is that the PAGE keeps decoding.
 */

const REF = '6866161';
const FAC = '0a000000-0000-4000-8000-0000000000f2';
const ADDRESS = '12 Example Street, Ikeja';

interface OldCodec {
  decodeFacility: (r: readonly unknown[]) => Record<string, unknown>;
  decodeWard: (r: readonly unknown[]) => Record<string, unknown>;
}

let scratch = '';
let oldCodec: OldCodec;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'openbed-as-at-db-'));
  extractPackagesAsAt(REF, scratch);
  oldCodec = (await import(/* @vite-ignore */ join(scratch, 'packages', 'snapshot', 'src', 'codec.ts'))) as OldCodec;
});
afterAll(() => {
  if (scratch !== '') rmSync(scratch, { recursive: true, force: true });
});

describe('a page at 6866161 against the snapshot the database writes after 031', () => {
  test('every facility and ward row of a freshly generated snapshot decodes with the OLD codec, with an addressed facility present', async () => {
    await withRole(
      'postgres',
      null,
      async (tx) => {
        await tx.unsafe(`update app.facility set address = '${ADDRESS}' where id = '${FAC}'`);
        await tx.unsafe('select app.regenerate_snapshot()');
        const [row] = await tx.unsafe<{ payload: { facilities: unknown[][]; wards: unknown[][]; facility_extras: unknown[][] } }[]>(
          'select payload from public.snapshot_current order by v desc limit 1',
        );
        const p = row?.payload;
        expect(p, 'no snapshot was written').toBeDefined();
        expect(p?.facilities.length, 'the snapshot holds no facility, so the decode below is vacuous').toBeGreaterThan(0);
        expect(p?.facility_extras, 'the addressed facility is missing from the extras, so the fixture did not land').toEqual([[FAC, ADDRESS]]);
        const facilities = (p?.facilities ?? []).map((r) => oldCodec.decodeFacility(r));
        const wards = (p?.wards ?? []).map((r) => oldCodec.decodeWard(r));
        expect(facilities.find((f) => f['facility_id'] === FAC), 'the old codec lost the addressed facility').toMatchObject({ name: 'Addressed Facility' });
        expect(wards.length).toBeGreaterThan(0);
      },
      async (tx) => {
        await tx.unsafe(`
          insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
          values ('${FAC}', 'Addressed Facility', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000302', now())`);
        await tx.unsafe(`insert into app.facility_agreement (facility_id, accepted_on, version) values ('${FAC}', '2026-09-01', 'v1.0')`);
        await tx.unsafe(`insert into app.ward_status (facility_id, category, offering) values ('${FAC}', 'ICU_ADULT', 'OFFERED')`);
      },
    );
  });
});
