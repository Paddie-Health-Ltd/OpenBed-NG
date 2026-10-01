#!/usr/bin/env node
/**
 * scripts/pr_evidence.mjs
 *
 * THE PR EVIDENCE BLOCK, BUILT FROM CI'S OWN ARTEFACTS (R-2026-09-29-171, EU-3).
 *
 * WHY FROM CI AND NOT FROM A LOCAL RUN. A block built from local files can be
 * written by whoever builds it: a local `.head` sidecar only moves the forgery one
 * step down. scripts/gate.sh already says a local run is not a control. CI's
 * artefacts are uploaded by the runner, whose job token has `contents: read` only,
 * over a database built fresh in that job. So every number here comes from the
 * artefacts of one named CI run, and every artefact is bound to the commit CI
 * tested by the `ci-provenance.txt` each uploading job writes into its artefact
 * (.github/workflows/ci.yml; the step is pinned by
 * tests/compliance/ci_required_checks_not_paths_filtered.test.ts).
 *
 * WHAT CI TESTS IS A MERGE, NOT THE PR HEAD. A pull_request run checks out
 * refs/pull/N/merge. Its HEAD is GITHUB_SHA, a merge M of the base B and the head
 * H, and neither M nor B appears in the API's run object or in a JUnit file. The
 * provenance file carries M's raw commit object; this script hashes it itself,
 * reads its two parents from it, and requires the second to be this checkout's
 * HEAD. The PR's own `merge_commit_sha` is never used: GitHub recomputes it when
 * main moves, without a re-run, so it can name a merge CI never tested.
 *
 * WHAT IT DOES, in this order. Any refusal is exit 2 and prints no block.
 *   1. HEAD is on GitHub (the commits endpoint answers for it).
 *   2. The run: the newest pull_request run of ci.yml for HEAD whose status is
 *      completed. None completed, or the newest completed was cancelled, is a
 *      refusal. A newer run still in progress is printed, not waited for. The run's
 *      own head_sha must be HEAD, and a conclusion but success marks the block RED.
 *   3. The artefacts junit-compliance, junit-db and junit-golden-path: exactly one
 *      of each; made by this run for HEAD; not expired; not created before this
 *      attempt started; the zip's sha256 equals its recorded digest; its entries are
 *      exactly the expected bare names, in any order.
 *   4. The provenance in each: the five keys in order; the object exactly
 *      object_size bytes; its sha1 is github_sha; exactly two parents, the second
 *      HEAD; run_id and run_attempt this run's; the job its own; the three agree.
 *   5. The base B is in this clone. Nothing is fetched.
 *   6. The seven required jobs, from this attempt, each present EXACTLY ONCE: any
 *      conclusion but success marks the block RED.
 *   7. The counts, only through scripts/attest_counts.mjs. Its exit 2 is this
 *      script's exit 2; its exit 1 marks the block RED. Golden path phase 1 is
 *      corpus, not attested (scripts/run_e2e.sh).
 *   8. The register by kind, parsed by scripts/deferred_register.mjs.
 * Then the block: one fenced block, pasted whole into the PR body.
 *
 * SEAMS. `--root <dir>` governs git and the decision record only. attest_counts,
 * the register parser and packages/fixtures/required-checks.json are always this
 * script's own checkout's. The GitHub API is reached only through `gh api` on
 * PATH, naming the repository literally; a test puts a stub gh first on PATH. No
 * code path here exists for a test.
 *
 * EVERY REFUSAL IS A LITERAL console.error AT ITS OWN SITE, so the leg register
 * can see it (test-conventions.md section 2(d)); no helper takes a message.
 *
 * Usage: node scripts/pr_evidence.mjs [--root <dir>]
 * Exit:  0 the block is ZERO-RED; 1 the block is RED; 2 no block (a refusal).
 *
 * NOT ASSERTED HERE, deliberately:
 *   - A PR can change its own evidence machinery: a pull_request run uses the PR's
 *     own ci.yml, attest_counts.mjs and tests. The block warns when the PR touches
 *     them; it cannot stop it.
 *   - The counts hold for merge M, not for main as it is now.
 *   - Retention: the evidence expires when the artefacts do (no retention-days is
 *     set, so the repository default applies).
 *   - Cowork cannot recheck the API calls; it still receives the block as a paste.
 *     The run id and digests let anyone with GitHub access recheck it.
 *   - Internal consistency is not correctness (scripts/attest_counts.mjs, its
 *     header's note on what reconciliation proves).
 *   - The register count comes from the tree, not from CI.
 *   - A re-run of the named run replaces its artefacts, after which the block
 *     cannot be rechecked.
 *
 * CLASSIFICATION (Clause 5): LIVE. Its subject, CI's artefacts for a PR head, exists
 * from the first run of the ci.yml that carries the provenance step.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OWN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ATTEST = join(OWN_ROOT, 'scripts', 'attest_counts.mjs');
const REQUIRED_CHECKS = join(OWN_ROOT, 'packages', 'fixtures', 'required-checks.json');
const REPO = 'repos/Paddie-Health-Ltd/OpenBed-NG';
const RECORD = join('Sprint Kickoffs', 'decision-2026-09-14-public-private-split.md');
const MAX_BUFFER = 256 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const PROVENANCE = 'ci-provenance.txt';
const PROVENANCE_KEYS = ['github_sha', 'run_id', 'run_attempt', 'job', 'object_size'];

/**
 * The three uploading jobs, their artefacts, and the entries each must hold: exactly these
 * names, in any order, each once (compared sorted, R-2026-09-30-179 FC-5). The ORDER of a
 * zip's entries is the runner's, and actions/upload-artifact promises none: comparing the
 * ordered list refused a correct run on 2026-10-01 for nothing the repository did.
 */
const ARTEFACTS = [
  { name: 'junit-compliance', job: 'compliance-tests', entries: ['junit-compliance.xml', PROVENANCE] },
  { name: 'junit-db', job: 'db-tests', entries: ['junit-db.xml', PROVENANCE] },
  { name: 'junit-golden-path', job: 'golden-path', entries: ['junit-e2e.xml', 'junit-ratchet.xml', PROVENANCE] },
];
const ATTESTED = [
  { label: 'compliance', artefact: 'junit-compliance', file: 'junit-compliance.xml' },
  { label: 'db', artefact: 'junit-db', file: 'junit-db.xml' },
  { label: 'ratchet', artefact: 'junit-golden-path', file: 'junit-ratchet.xml' },
];

/** Paths whose change in B...HEAD means this PR changes its own evidence machinery. */
const MACHINERY = [
  '.github/workflows/ci.yml',
  'scripts/attest_counts.mjs',
  'scripts/pr_evidence.mjs',
  'scripts/deferred_register.mjs',
  'scripts/run_e2e.sh',
  'packages/fixtures/required-checks.json',
  'vitest.config.ts',
  'package-lock.json',
];
const MACHINERY_PREFIXES = ['tests/'];

/** Thrown after a refusal has been printed at its own site; main() turns it into exit 2. */
const REFUSED = Symbol('refused');

// ---- arguments ----------------------------------------------------------------

let ROOT = OWN_ROOT;
{
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--root') {
      if (args[i + 1] === undefined || args[i + 1] === '') {
        console.error('ERROR: --root needs a directory after it');
        process.exit(2);
      }
      ROOT = resolve(args[i + 1]);
      i += 1;
    } else {
      console.error('usage: node scripts/pr_evidence.mjs [--root <dir>] -- it takes no other argument');
      process.exit(2);
    }
  }
}

// ---- the three external tools -----------------------------------------------------

/** `gh api <repo>/<path>`, raw. Query parameters stay in the path: -f or -F would make it a POST. */
function ghRaw(path) {
  const r = spawnSync('gh', ['api', `${REPO}/${path}`], { maxBuffer: MAX_BUFFER, timeout: TIMEOUT_MS, env: process.env });
  if (r.error && r.error.code === 'ENOBUFS') {
    console.error(`ERROR: gh answered more than 256 MiB for ${path} -- the answer was cut off, so nothing in it is evidence.`);
    throw REFUSED;
  }
  if (r.error) {
    console.error(`ERROR: gh did not run to completion (${r.error.code}) -- the evidence comes from the GitHub API, and without gh there is no block.`);
    throw REFUSED;
  }
  return r;
}

function ghJson(path, key) {
  const r = ghRaw(path);
  if (r.status !== 0) {
    console.error(`ERROR: the GitHub API call failed (gh exit ${r.status}) for ${path}: ${String(r.stderr).split('\n')[0]}`);
    throw REFUSED;
  }
  let body;
  try {
    body = JSON.parse(String(r.stdout));
  } catch {
    console.error(`ERROR: the GitHub API's reply to ${path} is not JSON`);
    throw REFUSED;
  }
  if (key !== undefined && (body === null || typeof body !== 'object' || !Array.isArray(body[key]))) {
    console.error(`ERROR: the GitHub API's answer for ${path} holds no ${key} list`);
    throw REFUSED;
  }
  return body;
}

function git(args, ok = [0]) {
  const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: TIMEOUT_MS });
  if (r.error || !ok.includes(r.status)) {
    console.error(`ERROR: git ${args.join(' ')} did not succeed under --root (${r.error ? r.error.code : `exit ${r.status}`})`);
    throw REFUSED;
  }
  return r;
}

function unzip(args) {
  const r = spawnSync('unzip', args, { maxBuffer: MAX_BUFFER, timeout: TIMEOUT_MS });
  if (r.error) {
    console.error(`ERROR: unzip did not run (${r.error.code}) -- an artefact's entries are listed and read with unzip`);
    throw REFUSED;
  }
  return r;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- the run ------------------------------------------------------------------------

async function main(work) {
  // This checkout's own register parser and jobs list, loaded here rather than at the
  // top so that a broken checkout is exit 2 like every other failure, never exit 1.
  const { KINDS, parseRegister } = await import('./deferred_register.mjs');
  const REQUIRED = JSON.parse(readFileSync(REQUIRED_CHECKS, 'utf8')).jobs;

  const head = git(['rev-parse', 'HEAD']).stdout.trim();

  const pushed = ghRaw(`commits/${head}`);
  if (pushed.status !== 0) {
    console.error(`ERROR: HEAD ${head} is not on GitHub -- push it before building its evidence`);
    throw REFUSED;
  }

  const runs = ghJson(`actions/workflows/ci.yml/runs?head_sha=${head}&event=pull_request&per_page=100`, 'workflow_runs')
    .workflow_runs.slice()
    .sort((a, b) => b.id - a.id);
  if (runs.length === 0) {
    console.error(`ERROR: no pull_request run of ci.yml exists for HEAD ${head}`);
    throw REFUSED;
  }
  const completed = runs.filter((r) => r.status === 'completed');
  if (completed.length === 0) {
    console.error(`ERROR: no run for HEAD has completed yet; the newest, ${runs[0].id}, is ${runs[0].status}`);
    throw REFUSED;
  }
  const run = completed[0];
  const newer = runs.filter((r) => r.id > run.id).map((r) => `${r.id} (${r.status})`);
  if (run.conclusion === 'cancelled') {
    console.error(`ERROR: the newest completed run, ${run.id}, was cancelled -- runs in progress after it: ${newer.join(', ') || 'none'}`);
    throw REFUSED;
  }
  // THE RUN ITSELF (R-2026-09-29-172, EV-1 c). The query names HEAD, but the answer is
  // checked rather than trusted, as each artefact's is. And a run that did not conclude
  // success marks the block RED even when every job it holds reads green: the jobs and
  // the run are two facts.
  if (run.head_sha !== head) {
    console.error(`ERROR: the run ${run.id} belongs to head ${run.head_sha}, not to this HEAD`);
    throw REFUSED;
  }
  const red = [];
  if (run.conclusion !== 'success') red.push(`run ${run.id} concluded ${run.conclusion}`);
  const attempt = run.run_attempt;

  // ---- the artefacts ----------------------------------------------------------------
  const listed = [];
  for (let page = 1; ; page += 1) {
    const got = ghJson(`actions/runs/${run.id}/artifacts?per_page=100&page=${page}`, 'artifacts').artifacts;
    listed.push(...got);
    if (got.length < 100) break;
  }

  const found = [];
  for (const spec of ARTEFACTS) {
    const same = listed.filter((a) => a.name === spec.name);
    if (same.length !== 1) {
      console.error(`ERROR: run ${run.id} holds ${same.length} artefacts named ${spec.name}; exactly one is required`);
      throw REFUSED;
    }
    const a = same[0];
    if (a.workflow_run?.id !== run.id) {
      console.error(`ERROR: artefact ${spec.name} names workflow run ${a.workflow_run?.id}, not the run ${run.id}`);
      throw REFUSED;
    }
    if (a.workflow_run?.head_sha !== head) {
      console.error(`ERROR: artefact ${spec.name} was made for head ${a.workflow_run?.head_sha}, not this HEAD`);
      throw REFUSED;
    }
    if (a.expired !== false) {
      console.error(`ERROR: artefact ${spec.name} has expired; the evidence it held is gone`);
      throw REFUSED;
    }
    if (!(Date.parse(a.created_at) >= Date.parse(run.run_started_at))) {
      console.error(`ERROR: artefact ${spec.name} was created at ${a.created_at}, before attempt ${attempt} started at ${run.run_started_at} -- it belongs to an earlier attempt`);
      throw REFUSED;
    }
    if (typeof a.digest !== 'string' || a.digest === '') {
      console.error(`ERROR: artefact ${spec.name} carries no digest, so its bytes have nothing to be checked against`);
      throw REFUSED;
    }

    const zip = ghRaw(`actions/artifacts/${a.id}/zip`);
    if (zip.status !== 0) {
      console.error(`ERROR: the zip for artefact ${spec.name} did not download (gh exit ${zip.status})`);
      throw REFUSED;
    }
    const got = `sha256:${sha256(zip.stdout)}`;
    if (got !== a.digest) {
      console.error(`ERROR: the zip for artefact ${spec.name} hashes to ${got}, not its recorded digest ${a.digest}`);
      throw REFUSED;
    }

    const dir = join(work, spec.name);
    mkdirSync(dir);
    const zipPath = join(dir, 'artefact.zip');
    writeFileSync(zipPath, zip.stdout);
    const list = unzip(['-Z1', zipPath]);
    if (list.status !== 0) {
      console.error(`ERROR: unzip -Z1 refused the zip for artefact ${spec.name} (exit ${list.status})`);
      throw REFUSED;
    }
    const entries = String(list.stdout).split('\n').filter((l) => l !== '');
    const pathy = entries.find((e) => e.includes('/') || e.includes('..'));
    if (pathy !== undefined) {
      console.error(`ERROR: artefact ${spec.name} holds a path entry, ${JSON.stringify(pathy)}; only bare names are accepted`);
      throw REFUSED;
    }
    if (JSON.stringify([...entries].sort()) !== JSON.stringify([...spec.entries].sort())) {
      console.error(`ERROR: artefact ${spec.name} holds the entries ${JSON.stringify(entries)}, not exactly ${JSON.stringify(spec.entries)}`);
      throw REFUSED;
    }
    const files = {};
    for (const name of spec.entries) {
      const out = unzip(['-p', zipPath, name]);
      if (out.status !== 0) {
        console.error(`ERROR: unzip -p did not extract ${name} from artefact ${spec.name} (exit ${out.status})`);
        throw REFUSED;
      }
      writeFileSync(join(dir, name), out.stdout);
      files[name] = join(dir, name);
    }
    found.push({ spec, artefact: a, files });
  }

  // ---- the provenance binds each artefact to M --------------------------------------
  const tested = [];
  for (const { spec, files } of found) {
    const buf = readFileSync(files[PROVENANCE]);
    const lines = [];
    let pos = 0;
    for (let k = 0; k < 6; k += 1) {
      const nl = buf.indexOf(0x0a, pos);
      if (nl === -1) break;
      lines.push(buf.subarray(pos, nl).toString('utf8'));
      pos = nl + 1;
    }
    const values = {};
    const shaped =
      lines.length === 6 &&
      lines[5] === '---' &&
      PROVENANCE_KEYS.every((key, k) => {
        const m = new RegExp(`^${key}=(.*)$`).exec(lines[k]);
        if (m) values[key] = m[1];
        return m !== null;
      }) &&
      /^[0-9a-f]{40}$/.test(values.github_sha) &&
      /^[0-9]+$/.test(values.object_size);
    if (!shaped) {
      console.error(`ERROR: ${PROVENANCE} in ${spec.name} does not open with github_sha, run_id, run_attempt, job and object_size in order, then ---`);
      throw REFUSED;
    }
    const size = Number(values.object_size);
    const object = buf.subarray(pos);
    if (object.length !== size) {
      console.error(`ERROR: ${PROVENANCE} in ${spec.name} holds ${object.length} object bytes after ---, not object_size=${size}`);
      throw REFUSED;
    }
    const sha1 = createHash('sha1').update(Buffer.concat([Buffer.from(`commit ${size}\0`), object])).digest('hex');
    if (sha1 !== values.github_sha) {
      console.error(`ERROR: the commit object in ${spec.name} hashes to ${sha1}, not github_sha=${values.github_sha}`);
      throw REFUSED;
    }
    const text = object.toString('utf8');
    const end = text.indexOf('\n\n');
    const header = (end === -1 ? text : text.slice(0, end)).split('\n');
    const parents = header.filter((l) => l.startsWith('parent ')).map((l) => l.slice('parent '.length));
    if (parents.length !== 2) {
      console.error(`ERROR: the tested commit ${values.github_sha} has ${parents.length} parents; a pull_request merge has exactly two`);
      throw REFUSED;
    }
    if (parents[1] !== head) {
      console.error(`ERROR: the tested merge's second parent is ${parents[1]}, not HEAD ${head}`);
      throw REFUSED;
    }
    if (values.run_id !== String(run.id)) {
      console.error(`ERROR: ${PROVENANCE} in ${spec.name} names run_id=${values.run_id}, not run ${run.id}`);
      throw REFUSED;
    }
    if (values.run_attempt !== String(attempt)) {
      console.error(`ERROR: ${PROVENANCE} in ${spec.name} names run_attempt=${values.run_attempt}, not the run's attempt ${attempt}`);
      throw REFUSED;
    }
    if (values.job !== spec.job) {
      console.error(`ERROR: ${PROVENANCE} in ${spec.name} names job=${values.job}, not ${spec.job}`);
      throw REFUSED;
    }
    tested.push({ m: values.github_sha, base: parents[0] });
  }
  if (new Set(tested.map((t) => t.m)).size !== 1) {
    console.error(`ERROR: the three provenance files name different tested commits: ${tested.map((t) => t.m).join(', ')}`);
    throw REFUSED;
  }
  const merge = tested[0].m;
  const base = tested[0].base;

  // ---- the base is local; nothing is fetched ----------------------------------------
  const baseHere = spawnSync('git', ['-C', ROOT, 'cat-file', '-e', `${base}^{commit}`], { timeout: TIMEOUT_MS });
  if (baseHere.status !== 0) {
    console.error(`ERROR: the base ${base} is not in this clone; run git fetch origin main, then run this again`);
    throw REFUSED;
  }

  // ---- the seven jobs, from this attempt ----------------------------------------------
  const jobs = ghJson(`actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100`, 'jobs').jobs;
  const jobLines = [];
  for (const name of REQUIRED) {
    // EXACTLY ONE PER NAME (R-2026-09-29-172, EV-1 a). `find` took the first match, so a
    // second db-tests concluding failure after a green one printed ZERO-RED, exit 0. The
    // artefacts are held to one each; the jobs are held to the same.
    const same = jobs.filter((x) => x.name === name);
    if (same.length === 0) {
      console.error(`ERROR: attempt ${attempt} of run ${run.id} has no job named ${name}`);
      throw REFUSED;
    }
    if (same.length > 1) {
      console.error(`ERROR: attempt ${attempt} of run ${run.id} has ${same.length} jobs named ${name}; each required job must appear exactly once`);
      throw REFUSED;
    }
    const j = same[0];
    if (j.run_attempt !== attempt) {
      console.error(`ERROR: job ${name} ran in attempt ${j.run_attempt}, not the provenance's attempt ${attempt}`);
      throw REFUSED;
    }
    jobLines.push(`  ${name.padEnd(18)} ${j.conclusion}`);
    if (j.conclusion !== 'success') red.push(`job ${name} concluded ${j.conclusion}`);
  }

  // ---- the counts, only through attest_counts ----------------------------------------
  const counts = [];
  for (const a of ATTESTED) {
    const dir = join(work, a.artefact);
    const r = spawnSync(process.execPath, [ATTEST, a.file], { cwd: dir, encoding: 'utf8', timeout: TIMEOUT_MS });
    const attested = (r.status === 0 || r.status === 1) && String(r.stdout).includes('Disposition:');
    if (!attested) {
      process.stderr.write(String(r.stderr ?? ''));
      console.error(`ERROR: attest_counts.mjs gave no attestation for ${a.file} from artefact ${a.artefact} (exit ${r.status}) -- so there is no block`);
      throw REFUSED;
    }
    if (r.status === 1) red.push(`${a.label}: attest_counts reads RED`);
    counts.push(`${a.label} (${a.file}, artefact ${a.artefact}):`, ...String(r.stdout).trimEnd().split('\n').map((l) => `  ${l}`));
  }

  // ---- the register, from the tree ----------------------------------------------------
  let record;
  try {
    record = readFileSync(join(ROOT, RECORD), 'utf8');
  } catch {
    console.error(`ERROR: the decision record is not readable at ${RECORD} under --root`);
    throw REFUSED;
  }
  const reg = parseRegister(record);
  if (reg.errors.length > 0) {
    for (const e of reg.errors) process.stderr.write(`  ${e}\n`);
    console.error(`ERROR: the deferred-items register did not parse (${reg.errors.length} error(s) above), so it has no count`);
    throw REFUSED;
  }
  const byKind = KINDS.map((k) => `${reg.rows.filter((r) => r.kind === k).length} ${k}`).join(', ');

  // ---- where main is now, and what this PR touches ------------------------------------
  const mainLines = [];
  const origin = spawnSync('git', ['-C', ROOT, 'rev-parse', '--verify', '-q', 'refs/remotes/origin/main'], { encoding: 'utf8', timeout: TIMEOUT_MS });
  if (origin.status === 0) {
    const om = origin.stdout.trim();
    const moved = git(['rev-list', '--count', `${base}..${om}`]).stdout.trim();
    mainLines.push(`  origin/main is ${om}; main has moved ${moved} commits since B`);
    if (git(['merge-base', '--is-ancestor', base, om], [0, 1]).status === 1) {
      mainLines.push(`  WARNING: B is not an ancestor of origin/main`);
    }
  } else {
    mainLines.push('  origin/main: not compared (no local origin/main)');
  }
  const log = git(['log', '--oneline', `${base}..HEAD`]).stdout.trimEnd();
  const nameStatus = git(['diff', '-M', '--name-status', `${base}...HEAD`]).stdout.trimEnd();
  const touched = new Set();
  for (const line of nameStatus.split('\n').filter((l) => l !== '')) {
    for (const p of line.split('\t').slice(1)) {
      if (MACHINERY.includes(p) || MACHINERY_PREFIXES.some((pre) => p.startsWith(pre))) touched.add(p);
    }
  }

  // ---- the block ----------------------------------------------------------------------
  const url = `github.com/Paddie-Health-Ltd/OpenBed-NG/actions/runs/${run.id}/attempts/${attempt}`;
  const out = [
    '```text',
    'PR EVIDENCE -- node scripts/pr_evidence.mjs, from CI\'s own artefacts',
    `Run        : ${run.id}, attempt ${attempt}, ${url}, concluded ${run.conclusion}`,
  ];
  if (newer.length > 0) out.push(`Newer runs : ${newer.join(', ')} -- in progress, not used`);
  out.push('Artefacts  :');
  for (const { spec, artefact } of found) {
    out.push(`  ${spec.name.padEnd(18)} id=${artefact.id} ${artefact.digest} expires_at=${artefact.expires_at}`);
  }
  out.push(`Jobs, attempt ${attempt}:`, ...jobLines);
  out.push(...counts);
  out.push('golden path phase 1 (junit-e2e.xml): corpus, not attested');
  out.push(`Tested as merge M = base B + head H`, `  M=${merge}`, `  B=${base}`, `  H=${head}`, ...mainLines);
  out.push(`git log --oneline B..HEAD:`, ...log.split('\n').filter((l) => l !== '').map((l) => `  ${l}`));
  out.push(`git diff -M --name-status B...HEAD:`, ...nameStatus.split('\n').filter((l) => l !== '').map((l) => `  ${l}`));
  out.push(`Register   : ${reg.rows.length} (${byKind}), from the tree`);
  if (touched.size > 0) {
    out.push('WARNING: this PR changes its own evidence machinery:', ...[...touched].sort().map((p) => `  ${p}`));
  }
  out.push(`Disposition: ${red.length === 0 ? 'ZERO-RED' : `RED -- ${red.join('; ')}`}`);
  out.push(
    'NOT ASSERTED:',
    '  - A PR can change its own evidence machinery.',
    '  - The counts hold for merge M, not for main as it is now.',
    '  - Retention: the evidence expires when the artefacts do.',
    '  - Cowork cannot recheck the API calls; it still receives the block as a paste.',
    '  - Internal consistency is not correctness (attest_counts.mjs:14-18).',
    '  - The register count comes from the tree, not from CI.',
    '  - Re-running the named run replaces its artefacts; after that this block cannot be rechecked. Push, or edit the body, for a new run; never re-run one whose block is pasted.',
    '```',
  );
  console.log(out.join('\n'));
  return red.length === 0 ? 0 : 1;
}

const work = mkdtempSync(join(tmpdir(), 'openbed-evidence-'));
let code = 2;
try {
  code = await main(work);
} catch (e) {
  // A refusal has already printed its own message. Anything else is not a verdict
  // either: it is exit 2, never the exit 1 that reads as RED.
  if (e !== REFUSED) process.stderr.write(`pr_evidence.mjs stopped with no block: ${e && e.stack ? e.stack : String(e)}\n`);
  code = 2;
} finally {
  rmSync(work, { recursive: true, force: true });
}
// THE EXIT STATUS IS SET, NOT FORCED (R-2026-09-29-172, EV-1 b). process.exit() after
// console.log drops whatever a pipe has not yet flushed: a 120 KB block through a slow
// reader arrived as exactly 65536 bytes, with no Disposition line and no closing fence,
// exit 0. Letting the process end drains stdout. fs.writeSync is no cure: once console has
// touched stdout the pipe is non-blocking, and writeSync makes a partial write without
// throwing (measured: 64838 of 200001 bytes, exit 0).
process.exitCode = code;
