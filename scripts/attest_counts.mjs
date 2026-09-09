#!/usr/bin/env node
/**
 * scripts/attest_counts.mjs
 *
 * STANDARD O -- the RED-DISPOSITION ATTESTATION, derived from a JUnit XML
 * artefact rather than read off a terminal.
 *
 * WHY DERIVED AND NEVER PARSED FROM THE SUMMARY LINE. A terminal summary that
 * scrolled past is not an artefact; reporters change their output; and "exit 0"
 * is compatible with a suite that collected nothing, skipped everything, or
 * never reached the database. The six counts come from the file the runner
 * wrote, or they do not come at all.
 *
 * A NOTE ON WHAT RECONCILIATION PROVES. `ran === passed + failed + errored` and
 * `collected === ran + skipped` establish INTERNAL CONSISTENCY and never
 * EXTRACTION CORRECTNESS: two different derivations can both satisfy those
 * identities while extracting the wrong thing. They are printed because an
 * inconsistency is worth seeing, not because consistency is evidence.
 *
 * Usage: node scripts/attest_counts.mjs <junit.xml>
 * Exit:  0 if the suite is ZERO-RED, 1 otherwise, 2 on usage/parse failure.
 */

import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/attest_counts.mjs <junit.xml>');
  process.exit(2);
}

let xml;
try {
  xml = readFileSync(file, 'utf8');
} catch (e) {
  console.error(`ERROR: cannot read ${file}: ${e.message}`);
  console.error('  A missing JUnit file is NOT a pass. The suite did not report.');
  process.exit(2);
}

/** Every <testcase ...> element, with its inner content up to the closing tag. */
const cases = [...xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)];

if (cases.length === 0) {
  console.error('ERROR: no <testcase> elements found.');
  console.error('  A suite that collected zero tests is not green — it is silent.');
  process.exit(2);
}

let failed = 0;
let errored = 0;
let skipped = 0;

for (const [, , selfClosing, body = ''] of cases) {
  if (selfClosing === '/>') continue; // a bare testcase is a pass
  if (/<failure\b/.test(body)) failed += 1;
  else if (/<error\b/.test(body)) errored += 1;
  else if (/<skipped\b/.test(body)) skipped += 1;
}

const collected = cases.length;
const ran = collected - skipped;
const passed = ran - failed - errored;

const zeroRed = failed + errored === 0 && ran > 0;

console.log('RED-DISPOSITION ATTESTATION (Standard O)');
console.log(`  Source     : ${file}`);
console.log(
  `  collected=${collected} ran=${ran} passed=${passed} failed=${failed} errored=${errored} skipped=${skipped}`,
);
console.log(`  Identities : ran === passed+failed+errored -> ${ran === passed + failed + errored}`);
console.log(`               collected === ran+skipped     -> ${collected === ran + skipped}`);
console.log(`  Disposition: ${zeroRed ? 'ZERO-RED' : 'RED — see failures above'}`);

if (skipped > 0) {
  console.log(
    `  NOTE       : ${skipped} test(s) skipped. Green-by-skip is not a pass; each skip needs a named reason.`,
  );
}

process.exit(zeroRed ? 0 : 1);
