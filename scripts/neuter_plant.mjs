#!/usr/bin/env node
/**
 * scripts/neuter_plant.mjs
 *
 * THE PLANT HALF OF scripts/neuter.sh. Reads one neuter from a spec file and
 * either describes it (for the shell runner to consume) or applies it to its
 * target file in place.
 *
 * WHY THIS IS TRACKED (founder ruling R-2026-09-15-03, item 4). The neuter
 * harness that certified migrations 014 and 015 lived in a session scratchpad.
 * Its first run of neuter N13 tested nothing and said so nowhere, and its final
 * exit code printed empty. An untracked instrument cannot be pinned, reviewed,
 * versioned or neutered, so both halves now live here with legs.
 *
 * WHY A PLANT THAT DOES NOT LAND IS FATAL, not a skipped neuter. A replacement
 * whose anchor is absent leaves the file unchanged; the suite then passes; and
 * "the neuter survived" is reported against a control that was never touched.
 * test-conventions.md §8, "confirm the plant actually planted", is this refusal.
 * The anchor count is exact for the same reason: an anchor found twice where one
 * was expected plants a second site nobody predicted.
 *
 * EVERY REFUSAL IS A LITERAL console.error AT ITS OWN SITE, so the leg register
 * can see it. The first version funnelled them through a helper and the register
 * found no legs in this file at all (test-conventions.md §2(d)).
 *
 * Spec (JSON):
 *   { "neuters": [ {
 *       "name": "N1",
 *       "file": "database/migrations/014_publish_ward_status.sql",
 *       "replace": [ { "old": "...", "new": "...", "count": 1 } ],
 *       "tests": [ "tests/db/publish_ward_status.test.ts" ],
 *       "project": "db",                         (optional)
 *       "apply": "psql \"$NEUTER_DB_URL\" -v ON_ERROR_STOP=1 -f \"$NEUTER_FILE\"",  (optional)
 *       "probe": "psql \"$NEUTER_DB_URL\" -Atc \"select md5(prosrc) ...\""          (optional)
 *   } ] }
 *
 * Usage:
 *   node scripts/neuter_plant.mjs names    <spec.json>
 *   node scripts/neuter_plant.mjs describe <spec.json> <name>
 *   node scripts/neuter_plant.mjs apply    <spec.json> <name> <root>
 * `describe` prints KEY<TAB>VALUE lines: FILE, PROJECT, APPLY, PROBE, then one
 * TEST line per test file.
 * Exit: 0 ok; 2 on usage, an unreadable or malformed spec, an unknown neuter,
 *       or a plant that did not land.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [cmd, specPath, name, root] = process.argv.slice(2);

if (!['names', 'describe', 'apply'].includes(cmd ?? '') || !specPath) {
  console.error('usage: node scripts/neuter_plant.mjs names|describe|apply <spec.json> [name] [root]');
  process.exit(2);
}

let spec;
try {
  spec = JSON.parse(readFileSync(specPath, 'utf8'));
} catch (e) {
  console.error(`ERROR: cannot read the neuter spec as JSON: ${specPath}: ${e.message}`);
  process.exit(2);
}
if (!spec || !Array.isArray(spec.neuters) || spec.neuters.length === 0) {
  console.error('ERROR: the neuter spec holds no neuters.');
  console.error('  A harness run over no neuters certifies nothing.');
  process.exit(2);
}

const seen = new Set();
for (const [i, n] of spec.neuters.entries()) {
  const ok =
    n &&
    typeof n.name === 'string' &&
    /^[A-Za-z0-9_-]+$/.test(n.name) &&
    typeof n.file === 'string' &&
    Array.isArray(n.replace) &&
    n.replace.length > 0 &&
    n.replace.every((r) => typeof r.old === 'string' && r.old.length > 0 && typeof r.new === 'string' && Number.isInteger(r.count) && r.count > 0) &&
    Array.isArray(n.tests) &&
    n.tests.length > 0 &&
    n.tests.every((t) => typeof t === 'string' && t.length > 0 && !/[\t\n]/.test(t));
  if (!ok) {
    console.error(`ERROR: neuter ${i} is malformed: ${JSON.stringify(n?.name)}`);
    console.error('  Each needs a name, a file, at least one {old, new, count>0} replacement and at least one test file.');
    process.exit(2);
  }
  if (seen.has(n.name)) {
    console.error(`ERROR: the neuter spec names ${n.name} twice. An ambiguous neuter is not a neuter.`);
    process.exit(2);
  }
  seen.add(n.name);
}

if (cmd === 'names') {
  for (const n of spec.neuters) console.log(n.name);
  process.exit(0);
}

const neuter = spec.neuters.find((n) => n.name === name);
if (!neuter) {
  console.error(`ERROR: the neuter spec has no neuter named ${JSON.stringify(name)}.`);
  process.exit(2);
}

const oneLine = (s) => String(s ?? '').replace(/[\t\n]/g, ' ');

if (cmd === 'describe') {
  console.log(`FILE\t${neuter.file}`);
  console.log(`PROJECT\t${oneLine(neuter.project)}`);
  console.log(`APPLY\t${oneLine(neuter.apply)}`);
  console.log(`PROBE\t${oneLine(neuter.probe)}`);
  for (const t of neuter.tests) console.log(`TEST\t${t}`);
  process.exit(0);
}

if (!root) {
  console.error('usage: node scripts/neuter_plant.mjs apply <spec.json> <name> <root> -- apply needs the root it plants under');
  process.exit(2);
}
const target = join(root, neuter.file);
let src;
try {
  src = readFileSync(target, 'utf8');
} catch (e) {
  console.error(`ERROR: the plant target cannot be read, so nothing was planted: ${neuter.file}: ${e.message}`);
  process.exit(2);
}

let out = src;
for (const [i, r] of neuter.replace.entries()) {
  const found = out.split(r.old).length - 1;
  if (found !== r.count) {
    console.error(`ERROR: PLANT DID NOT LAND — neuter ${neuter.name}, replacement ${i}: anchor found ${found} time(s), expected ${r.count}.`);
    console.error('  An unlanded plant leaves the file unchanged, and a green suite would then be reported against a control nobody touched.');
    process.exit(2);
  }
  out = out.split(r.old).join(r.new);
}
if (out === src) {
  console.error(`ERROR: PLANT DID NOT LAND — the replacements left the target byte-identical: ${neuter.name} ${neuter.file}`);
  process.exit(2);
}
writeFileSync(target, out, 'utf8');
console.log(`planted ${neuter.name} into ${neuter.file}`);
process.exit(0);
