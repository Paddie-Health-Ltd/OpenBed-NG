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
 * THE FILE MUST AGREE WITH ITSELF, OR THERE IS NO ATTESTATION (2026-09-14).
 * Until that date this script counted `<testcase` matches and nothing else. A
 * report cut off mid-write therefore attested a SMALLER ZERO-RED, and a failure
 * in the lost tail vanished. Both were planted and both passed, exit 0. vitest
 * (5.0.0, pinned) declares its own totals on the root element, so the file
 * carries what it should hold. The refusals, in the order they fire:
 *   1. no closing </testsuites> -- the report was not finished;
 *   2. no tests/failures/errors declared on the root -- nothing to check
 *      against, and a check that could not run reports no verdict;
 *   3. zero testcases (the original anti-vacuity refusal);
 *   4. declared tests    != <testcase> elements;
 *   5. declared failures != testcases holding a <failure>. A testcase, not the
 *      element: vitest writes one <failure> per error, so a suite whose
 *      beforeAll and afterAll both throw is ONE failing entry carrying TWO;
 *   6. declared errors   != testcases holding an <error> (unhandled errors).
 * Every refusal exits 2 -- "no attestation" -- which the ratchet keeps distinct
 * from 1, "red".
 *
 * NOT ASSERTED HERE, deliberately:
 *   - That any run produced the counts at all. A number composed without a run
 *     has no file for this script to check, and 2026-09-14's audit found one
 *     (PR #11). The control for that is behavioural -- counts only from this
 *     script's real output, only for the commit being pushed -- and it cannot
 *     be enforced by a tool that only ever sees a file.
 *   - Skipped totals. vitest declares `skipped` per testsuite but not on the
 *     root, so there is no root declaration to disagree with.
 *
 * Usage: node scripts/attest_counts.mjs <junit.xml>
 * Exit:  0 if the suite is ZERO-RED, 1 otherwise, 2 on usage/parse failure or
 *        a file that does not agree with itself.
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

if (!xml.trimEnd().endsWith('</testsuites>')) {
  console.error('ERROR: the JUnit file does not end with </testsuites>.');
  console.error('  A report cut off mid-write is not a smaller pass. The counts it yields are not the counts of the run.');
  process.exit(2);
}

const root = xml.match(/<testsuites\b([^>]*)>/);
const declared = (name) => {
  const m = root ? root[1].match(new RegExp(`\\s${name}="(\\d+)"`)) : null;
  return m ? Number(m[1]) : null;
};
const declTests = declared('tests');
const declFailures = declared('failures');
const declErrors = declared('errors');
if (declTests === null || declFailures === null || declErrors === null) {
  console.error('ERROR: the JUnit root <testsuites> declares no tests/failures/errors totals.');
  console.error('  Without a declaration there is nothing to check the counts against, and a check that could not run reports no verdict.');
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

if (declTests !== collected) {
  console.error(`ERROR: the root declares tests=${declTests} but the file holds ${collected} <testcase> elements.`);
  console.error('  A file whose testcases do not add up to its own declared total is not a complete record of the run.');
  process.exit(2);
}
if (declFailures !== failed) {
  console.error(`ERROR: the root declares failures=${declFailures} but ${failed} testcases hold a <failure>.`);
  console.error('  A failure the declaration counts and the file does not hold was lost, or never written.');
  process.exit(2);
}
if (declErrors !== errored) {
  console.error(`ERROR: the root declares errors=${declErrors} but ${errored} testcases hold an <error>.`);
  console.error('  An unhandled error the declaration counts and the file does not hold was lost, or never written.');
  process.exit(2);
}

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
console.log(`  Declared   : tests=${declTests} failures=${declFailures} errors=${declErrors} -> agree with the file`);
console.log(`  Disposition: ${zeroRed ? 'ZERO-RED' : 'RED — see failures above'}`);

if (skipped > 0) {
  console.log(
    `  NOTE       : ${skipped} test(s) skipped. Green-by-skip is not a pass; each skip needs a named reason.`,
  );
}

process.exit(zeroRed ? 0 : 1);
