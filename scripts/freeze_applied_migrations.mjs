#!/usr/bin/env node
// ============================================================
// scripts/freeze_applied_migrations.mjs
// ============================================================
// Records the FROZEN BOUNDARY -- which forward migrations hosted has run --
// into database/migrations/applied-hosted.json.
//
// WHEN TO RUN IT: after a hosted apply, from runbook step 5, with the ledger
// count read from the hosted database in that same session. Never to make a
// failing tests/compliance/frozen_migrations.test.ts go green. That test fails
// when an APPLIED migration's bytes changed, and the fix for that is a new
// migration; rewriting this file would record a claim about hosted that nobody
// observed.
//
// It refuses rather than guesses: the ledger count you pass must equal the
// number of forward migrations in the repository. A mismatch means the repo and
// hosted are not at the same point, which is exactly what must not be recorded
// silently.
//
// Usage: node scripts/freeze_applied_migrations.mjs <ledger-rows> <YYYY-MM-DD> <ruling-id> [root]
//
// The optional fourth argument is a repository root, and it exists so a test can
// aim this script at a scratch tree -- the same seam every lint in scripts/ has
// as its $1. It looks unused when you read the file; removing it makes every
// refusal below unprovable, because a plant is by construction not this repo.
// ============================================================
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.argv[5] ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG_DIR = join(ROOT, 'database', 'migrations');
const OUT = join(MIG_DIR, 'applied-hosted.json');

const [ledgerArg, observed, ruling] = process.argv.slice(2);

if (!ledgerArg || !observed || !ruling) {
  console.error('ERROR: usage: node scripts/freeze_applied_migrations.mjs <ledger-rows> <YYYY-MM-DD> <ruling-id> [root]');
  console.error('       All three come from the hosted apply that was just run, not from this repository.');
  process.exit(2);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(observed)) {
  console.error(`ERROR: observed date "${observed}" is not YYYY-MM-DD. It is the date the ledger was read hosted.`);
  process.exit(2);
}
const ledgerRows = Number(ledgerArg);
if (!Number.isInteger(ledgerRows) || ledgerRows < 1) {
  console.error(`ERROR: ledger rows "${ledgerArg}" is not a positive integer.`);
  process.exit(2);
}

const forwards = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .sort();

if (forwards.length === 0) {
  console.error(`ERROR: no forward migrations found in ${MIG_DIR} -- refusing to record an empty boundary.`);
  process.exit(2);
}
if (forwards.length !== ledgerRows) {
  console.error(
    `ERROR: hosted reports ${ledgerRows} ledger rows, this repository holds ${forwards.length} forward migrations.`,
  );
  console.error('       Recording that mismatch would assert something nobody observed. Stop and report instead:');
  console.error('       either an unapplied migration is in the repo, or hosted ran a file this checkout does not have.');
  process.exit(2);
}

const existing = (() => {
  try {
    return JSON.parse(readFileSync(OUT, 'utf8'));
  } catch {
    return null;
  }
})();

const doc = {
  '//': existing?.['//'] ?? [],
  project_ref: existing?.project_ref ?? 'klrlpxysjsjpdkeqdhvl',
  observed,
  ruling,
  ledger_rows: ledgerRows,
  frozen: forwards.map((file) => ({
    file,
    sha256: createHash('sha256').update(readFileSync(join(MIG_DIR, file))).digest('hex'),
  })),
};

writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`frozen boundary recorded: ${forwards.length} migrations, observed ${observed} (${ruling})`);
console.log(`  first: ${forwards[0]}`);
console.log(`  last : ${forwards[forwards.length - 1]}`);
