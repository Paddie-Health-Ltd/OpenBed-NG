import shape from '../../fixtures/snapshot-shape.json';

/**
 * THE SNAPSHOT CODEC -- ONE IMPLEMENTATION, NOT TWO.
 *
 * The generator imports the encoder and the dashboard imports the decoder, and
 * NEITHER CONTAINS A COLUMN LIST. Both sides importing the fixture and each
 * writing their own mapping would be two derivation sites one layer down: they
 * could be edited apart, and they would drift while both stayed green. The
 * column order lives in `packages/fixtures/snapshot-shape.json` and the mapping
 * functions are built from it here, at module load, once.
 *
 * WHY THE WIRE FORMAT IS ARRAYS. A few hundred facilities ship as one document to
 * every anonymous reader; repeating ten key names per ward row is most of the
 * payload. That is the whole benefit, and it costs something real, named here
 * because it is not obvious from the code:
 *
 *   ARRAYS DESTROY IDENTIFIER NAMES, AND ONE OF THIS REPOSITORY'S GUARDS READS
 *   NAMES. The F2 duty-flag ESLint rule matches /anaesthetist|obstetrician|
 *   paediatrician/i against identifiers. `!f[3]` is invisible to it. The
 *   mitigation is upstream and structural rather than in this file: the snapshot
 *   never carries duty flags at all -- see decisions.the_snapshot_never_carries_duty_flags
 *   in the fixture. DECODE AS EARLY AS POSSIBLE and pass named objects onward, so
 *   that positional access exists only here.
 *
 * NOT ASSERTED HERE, deliberately: that the column list matches the database.
 * This module knows only what the fixture says. The fixture is tied to migration
 * 007 by `tests/compliance/snapshot_shape_matches_migration.test.ts`, statically,
 * and that guard is the reason the claim in the fixture's own comment is a claim
 * with a probe rather than a comment claiming a link.
 */

const WARD_COLUMNS: readonly string[] = shape.wardColumns;
const FACILITY_COLUMNS: readonly string[] = shape.facilityColumns;

/** The client polls at the snapshot's own cadence. One source: the fixture. */
export const POLL_CADENCE_SECONDS: number = shape.pollCadenceSeconds;

export type EncodedRow = readonly unknown[];
export type DecodedRow = Record<string, unknown>;

export interface RowCodec {
  readonly columns: readonly string[];
  encode(row: DecodedRow): unknown[];
  decode(row: EncodedRow): DecodedRow;
}

/**
 * Loud on a malformed contract, at import time rather than at first use.
 *
 * A codec built from an empty or duplicated column list does not throw -- it
 * quietly encodes every row to `[]`, or silently drops a column into its
 * duplicate. Both produce a payload that parses, renders, and is wrong.
 */
function buildCodec(columns: readonly string[], label: string): RowCodec {
  if (columns.length === 0) {
    throw new Error(`snapshot-shape.json: ${label} is empty — a codec over no columns encodes every row to nothing`);
  }
  const duplicates = columns.filter((c, i) => columns.indexOf(c) !== i);
  if (duplicates.length > 0) {
    throw new Error(`snapshot-shape.json: ${label} repeats ${[...new Set(duplicates)].join(', ')} — decode would silently collapse them`);
  }

  return {
    columns,
    encode(row: DecodedRow): unknown[] {
      const missing = columns.filter((c) => !(c in row));
      if (missing.length > 0) {
        throw new Error(`${label}: row is missing ${missing.join(', ')} — encoding it would shift every later column by one`);
      }
      return columns.map((c) => row[c]);
    },
    decode(row: EncodedRow): DecodedRow {
      if (row.length !== columns.length) {
        throw new Error(`${label}: expected ${columns.length} values, received ${row.length} — a positional payload of the wrong arity decodes into the wrong columns`);
      }
      const out: DecodedRow = {};
      for (let i = 0; i < columns.length; i += 1) {
        const key = columns[i];
        if (key !== undefined) out[key] = row[i];
      }
      return out;
    },
  };
}

const wardCodec = buildCodec(WARD_COLUMNS, 'wardColumns');
const facilityCodec = buildCodec(FACILITY_COLUMNS, 'facilityColumns');

export const encodeWard = (row: DecodedRow): unknown[] => wardCodec.encode(row);
export const decodeWard = (row: EncodedRow): DecodedRow => wardCodec.decode(row);
export const encodeFacility = (row: DecodedRow): unknown[] => facilityCodec.encode(row);
export const decodeFacility = (row: EncodedRow): DecodedRow => facilityCodec.decode(row);

export const wardColumns = (): readonly string[] => WARD_COLUMNS;
export const facilityColumns = (): readonly string[] => FACILITY_COLUMNS;
