#!/usr/bin/env node
// ============================================================
// scripts/readback_facility_flags.mjs
// ============================================================
// THE FACILITY FLAG CHECK OF readback_pages.sh (R-2026-10-09 GO, GO-1 b-e).
//
// Usage: node scripts/readback_facility_flags.mjs BODY-FILE SHAPE-FILE
//   BODY-FILE   the /beds.json body read-back 6 already fetched, which readback_pages.sh runs this
//               on straight after that probe and only when that probe's status and body prefix read ok.
//   SHAPE-FILE  packages/fixtures/snapshot-shape.json of the checkout under test.
//
// WHAT IT PRINTS. One line per LISTED facility the page could not show a ward of, `<facility id>` then a
// tab then the reason, and nothing else on stdout:
//   - "no ward rows"            the facility has no ward row in the snapshot at all;
//   - "every ward NOT_OFFERED"  it has ward rows and every one states offering NOT_OFFERED.
// The facility id only: never a name, an address or a phone number. A ward whose offering cannot be
// read (a code that is neither OFFERED nor NOT_OFFERED) is NOT "NOT_OFFERED", so it raises no flag: the
// public page shows an unreadable ward as "Status unknown", and a hospital that has one is still listed.
// Zero lines is a clean run.
//
// WHERE THE COLUMN POSITIONS COME FROM. wardColumns and facilityColumns of the SHAPE-FILE, found by NAME.
// This file carries no column list of its own: a second list would be a second derivation site, the very
// thing the snapshot codec's one fixture exists to prevent. Swap two names in a copy of the fixture and
// this file reads the wrong columns, which is the plant tests/compliance/readback_scripts.test.ts feeds it.
//
// THE ENVELOPE IT REQUIRES is the snapshot's own, as packages/fixtures/snapshot-shape.json records it: a numeric `v`, and `facilities` and
// `wards` as arrays (the fixture's `envelope` lists those among its keys). A body without them is not a snapshot and is an ERROR, not a clean run.
//
// EXIT. 0 the check ran (zero or more lines). 2 the check could not run, with the reason on stdout:
// the fixture is missing, unreadable or not the shape this file reads, the body is not JSON, is not a
// snapshot (an envelope without a numeric `v`, or without facilities and wards as arrays), holds a row
// that is not the fixture's width, or lists no facility at all. There is no exit 1: a flag is a data
// warning, never a verdict, and an exit status that could be read as one would be a false STOP.
//
// ZERO FACILITIES IS AN ERROR, NEVER A CLEAN RUN. A body that passed read-back 6 and lists nobody has
// nothing to flag, and a check over nothing reports the same silence as a check over a healthy city.
//
// CLASSIFICATION (Clause 5): a hand-run read-back of the snapshot that host served at that moment, not CI. The
// helper executes over constructed input in tests/compliance/readback_scripts.test.ts on every run, and over
// a real snapshot only when the founder runs readback_pages.sh against a deployment. Its true claim is
// "this runs when the founder runs that read-back and reads the snapshot the host served then", and no more.
//
// NOT ASSERTED HERE, deliberately: that a flagged facility is a mistake. A hospital that lists no ward it
// offers may be an onboarding in progress. The flag asks a person to look; it decides nothing.
// ============================================================
import { readFileSync } from 'node:fs';

/** A facility id the check may print: text of a plausible id's characters and length, never anything a terminal would interpret. */
const printable = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);

/**
 * The flag lines for a body, or a thrown Error whose message is the reason the check could not run. Every failure
 * site is a `throw new Error` with its own static message, so each one is a leg the leg register enumerates and
 * tests/compliance/readback_scripts.test.ts reaches by asserting that message.
 */
function flagLines(bodyPath, shapePath) {
  if (bodyPath === undefined || shapePath === undefined) throw new Error('usage: readback_facility_flags.mjs BODY-FILE SHAPE-FILE');

  let shape;
  try {
    shape = JSON.parse(readFileSync(shapePath, 'utf8'));
  } catch {
    throw new Error('the snapshot shape fixture could not be read as JSON, so the column positions are unknown');
  }
  const wardColumns = shape?.wardColumns;
  const facilityColumns = shape?.facilityColumns;
  if (!Array.isArray(wardColumns) || !Array.isArray(facilityColumns)) {
    throw new Error('the snapshot shape fixture has no wardColumns and facilityColumns lists');
  }
  const wardId = wardColumns.indexOf('facility_id');
  const offering = wardColumns.indexOf('offering');
  const facilityId = facilityColumns.indexOf('facility_id');
  if (wardId < 0 || offering < 0 || facilityId < 0) {
    throw new Error('the snapshot shape fixture names no facility_id or offering column, so the positions cannot be read');
  }

  let body;
  try {
    body = JSON.parse(readFileSync(bodyPath, 'utf8'));
  } catch {
    throw new Error('the snapshot body is not JSON, so the facility check has nothing to read');
  }
  if (body === null || typeof body !== 'object' || typeof body.v !== 'number' || !Number.isFinite(body.v)) {
    throw new Error('the snapshot body has no numeric v, so it is not the snapshot shape this check reads');
  }
  if (!Array.isArray(body.facilities) || !Array.isArray(body.wards)) {
    throw new Error('the snapshot body has no facilities and wards arrays, so it is not the snapshot shape this check reads');
  }
  if (body.facilities.length === 0) {
    throw new Error('the snapshot body lists no facility, so the facility check has nothing to read and a clean run would be a false one');
  }

  const wardRows = new Map();
  for (const row of body.wards) {
    if (!Array.isArray(row) || row.length !== wardColumns.length) {
      throw new Error('a ward row is not as wide as the fixture says, so it is not the snapshot shape the fixture describes');
    }
    const id = row[wardId];
    if (!printable(id)) throw new Error('a ward row carries a facility id that is not a plain id, so it is not the snapshot shape this check reads');
    const rows = wardRows.get(id) ?? [];
    rows.push(row[offering]);
    wardRows.set(id, rows);
  }

  const seen = new Set();
  const out = [];
  for (const row of body.facilities) {
    if (!Array.isArray(row) || row.length !== facilityColumns.length) {
      throw new Error('a facility row is not as wide as the fixture says, so it is not the snapshot shape the fixture describes');
    }
    const id = row[facilityId];
    if (!printable(id)) throw new Error('a facility row carries an id that is not a plain id, so it is not the snapshot shape this check reads');
    if (seen.has(id)) continue;
    seen.add(id);
    const offerings = wardRows.get(id);
    if (offerings === undefined) out.push(`${id}\tno ward rows`);
    else if (offerings.every((o) => o === 'NOT_OFFERED')) out.push(`${id}\tevery ward NOT_OFFERED`);
  }
  return out;
}

try {
  const [bodyPath, shapePath] = process.argv.slice(2);
  process.stdout.write(flagLines(bodyPath, shapePath).map((line) => `${line}\n`).join(''));
} catch (e) {
  // The reason on stdout, exit 2: the check did not run, so there is no result to read.
  process.stdout.write(`${e instanceof Error ? e.message : 'the facility check failed'}\n`);
  process.exit(2);
}
