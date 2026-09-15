#!/usr/bin/env node
/**
 * scripts/predict_counts.mjs
 *
 * CONDITION I, GENERATED FROM ARTEFACTS. Before a suite is attested, its expected
 * total is predicted: the previous run's per-file counts plus the tests this
 * change adds. This script reads the per-file BASELINES from the previous run's
 * JUnit file and takes only the DELTAS, each with a named condition and reason,
 * from a typed file.
 *
 * WHY NOTHING ELSE IS TYPED (founder ruling R-2026-09-15-02, item 3). The 015
 * prediction was written by hand. It labelled one file's baseline "42 -> 45"
 * when the artefact said 45 -> 48; the +3 delta was right, so the total agreed,
 * and the mislabel was found only by reading. That is a composed number inside
 * the control built to catch composed numbers. A baseline read from the file
 * cannot be mislabelled, so a typed one is REFUSED rather than cross-checked:
 * accepting it would make the typed number something a reader trusts.
 *
 * THE BASELINE MUST AGREE WITH ITSELF, the same refusals scripts/attest_counts.mjs
 * applies, for the same reason: a prediction built on a truncated file predicts
 * a smaller suite, and the attestation then "agrees" with a run that lost tests.
 *
 * EVERY REFUSAL IS A LITERAL console.error AT ITS OWN SITE. A shared helper
 * taking an array of messages was the first version, and the leg register
 * (tests/compliance/_legs.ts) saw none of its legs: it reads failure sites, and
 * a helper hides them. test-conventions.md §2(d), reproduced while building an
 * instrument, so it is written down here rather than fixed quietly.
 *
 * Deltas file (JSON):
 *   { "deltas": [ { "file": "tests/db/x.test.ts", "delta": 3,
 *                   "condition": "F", "reason": "real; two plants", "new": true } ] }
 *   - `new` is true only for a file absent from the baseline, and required then.
 *   - Several deltas may name one file; they sum.
 *   - Any other key is refused -- in particular `baseline`.
 *
 * Usage: node scripts/predict_counts.mjs <baseline-junit.xml> <deltas.json>
 * Exit:  0 prediction printed; 2 on usage, an unreadable or self-inconsistent
 *        baseline, or a delta the baseline does not support. There is no exit 1:
 *        a prediction is not a verdict, and the disagreement that matters is
 *        found by comparing it with scripts/attest_counts.mjs's output.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - That the deltas are RIGHT. They are the author's claim about their own
 *     change; the attestation that follows is what tests them, and a
 *     disagreement is the finding.
 *   - That the baseline JUnit belongs to the base commit. The script sees a
 *     file, not its provenance. The PR body names which run produced it.
 */

import { readFileSync } from 'node:fs';

const [baselinePath, deltasPath] = process.argv.slice(2);
if (!baselinePath || !deltasPath) {
  console.error('usage: node scripts/predict_counts.mjs <baseline-junit.xml> <deltas.json>');
  process.exit(2);
}

let xml;
try {
  xml = readFileSync(baselinePath, 'utf8');
} catch (e) {
  console.error(`ERROR: cannot read the baseline JUnit file ${baselinePath}: ${e.message}`);
  process.exit(2);
}

if (!xml.trimEnd().endsWith('</testsuites>')) {
  console.error('ERROR: the baseline JUnit file does not end with </testsuites>.');
  console.error('  A baseline cut off mid-write predicts a smaller suite, and the attestation would then agree with a run that lost tests.');
  process.exit(2);
}

/** Per-suite counts: declared `tests` and the testcases actually held. */
const baseline = new Map();
for (const m of xml.matchAll(/<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g)) {
  const attrs = m[1];
  const name = attrs.match(/\sname="([^"]*)"/)?.[1];
  const declared = attrs.match(/\stests="(\d+)"/)?.[1];
  if (name === undefined || declared === undefined) {
    console.error(`ERROR: a baseline <testsuite> carries no name or no declared tests total: <testsuite${attrs.slice(0, 120)}>`);
    process.exit(2);
  }
  const held = (m[2].match(/<testcase\b/g) ?? []).length;
  if (Number(declared) !== held) {
    console.error(`ERROR: baseline suite ${name} declares tests=${declared} but holds ${held} <testcase> elements.`);
    console.error('  A suite that does not agree with its own declared total is not a baseline.');
    process.exit(2);
  }
  baseline.set(name, (baseline.get(name) ?? 0) + held);
}

const baseTotal = [...baseline.values()].reduce((a, b) => a + b, 0);
if (baseTotal === 0) {
  console.error('ERROR: the baseline JUnit file holds no testcases.');
  console.error('  A prediction from an empty baseline predicts nothing.');
  process.exit(2);
}
const rootDeclared = Number(xml.match(/<testsuites\b[^>]*\stests="(\d+)"/)?.[1] ?? NaN);
if (rootDeclared !== baseTotal) {
  console.error(`ERROR: the baseline root declares tests=${rootDeclared} but its suites hold ${baseTotal} testcases.`);
  process.exit(2);
}

let spec;
try {
  spec = JSON.parse(readFileSync(deltasPath, 'utf8'));
} catch (e) {
  console.error(`ERROR: cannot read the deltas file as JSON: ${deltasPath}: ${e.message}`);
  process.exit(2);
}
if (!spec || !Array.isArray(spec.deltas) || spec.deltas.length === 0) {
  console.error('ERROR: the deltas file holds no deltas.');
  console.error('  A change that adds no tests states that with a delta of 0 and its reason, not with an empty file.');
  process.exit(2);
}

const ALLOWED = new Set(['file', 'delta', 'condition', 'reason', 'new']);
const expected = new Map(baseline);
const rows = [];
for (const [i, d] of spec.deltas.entries()) {
  const extra = Object.keys(d).filter((k) => !ALLOWED.has(k));
  if (extra.includes('baseline')) {
    console.error(`ERROR: delta ${i} (${d.file}) carries a typed baseline.`);
    console.error('  Baselines are read from the JUnit artefact, never typed; a typed baseline is the mislabel this script exists to remove.');
    process.exit(2);
  }
  if (extra.length > 0) {
    console.error(`ERROR: delta ${i} carries keys this script does not accept: ${extra.join(', ')} (file ${d.file})`);
    process.exit(2);
  }
  if (typeof d.file !== 'string' || !Number.isInteger(d.delta)) {
    console.error(`ERROR: delta ${i} needs a string file and an integer delta; got file=${JSON.stringify(d.file)} delta=${JSON.stringify(d.delta)}`);
    process.exit(2);
  }
  if (typeof d.condition !== 'string' || !d.condition.trim() || typeof d.reason !== 'string' || !d.reason.trim()) {
    console.error(`ERROR: delta ${i} (${d.file}) names no condition or no reason. A delta without its reason cannot be checked against the change.`);
    process.exit(2);
  }
  const inBaseline = baseline.has(d.file);
  if (!inBaseline && d.new !== true) {
    console.error(`ERROR: delta ${i} names ${d.file}, which is not in the baseline and is not marked new.`);
    console.error('  Either the path is wrong or the file is new; say which.');
    process.exit(2);
  }
  if (inBaseline && d.new === true) {
    console.error(`ERROR: delta ${i} marks ${d.file} as new, but the baseline already holds it with ${baseline.get(d.file)} tests.`);
    process.exit(2);
  }
  const before = expected.get(d.file) ?? 0;
  const after = before + d.delta;
  if (after < 0) {
    console.error(`ERROR: delta ${i} takes ${d.file} below zero tests (${before} + ${d.delta}).`);
    process.exit(2);
  }
  expected.set(d.file, after);
  rows.push(d);
}

const expTotal = [...expected.values()].reduce((a, b) => a + b, 0);
const sign = (n) => (n < 0 ? `${n}` : `+${n}`);

console.log('CONDITION I — PREDICTION, generated from artefacts (scripts/predict_counts.mjs)');
console.log(`  Baseline  : ${baselinePath}`);
console.log(`              total=${baseTotal}, declared tests=${rootDeclared} -> agree; ${baseline.size} files`);
console.log('  Deltas    :');
for (const d of rows) console.log(`    ${sign(d.delta).padStart(4)}  ${d.condition.padEnd(6)} ${d.file}  — ${d.reason}`);
console.log('  Per file  :');
for (const file of [...new Set(rows.map((d) => d.file))].sort()) {
  const b = baseline.has(file) ? String(baseline.get(file)) : 'new';
  console.log(`    ${file}  ${b} -> ${expected.get(file)}`);
}
console.log(`  EXPECTED  : ${baseTotal} ${rows.map((d) => sign(d.delta)).join(' ')} = ${expTotal}`);
process.exit(0);
