import { describe, expect, test } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';
import { makeZip, type ZipEntry } from './_zip.js';

/**
 * GUARD OVER A GUARD -- scripts/pr_evidence.mjs, the PR evidence block built from
 * CI's own artefacts (R-2026-09-29-171, EU-3 l and m).
 *
 * THE SUBJECT. The script names one CI run and prints what that run's artefacts
 * say, after binding each artefact to the merge commit CI tested. Every refusal in
 * it is a place where a block could otherwise be printed for evidence that does not
 * hold: a run that did not finish, an artefact from another run or attempt, a zip
 * whose bytes are not the ones GitHub recorded, a provenance file naming another
 * commit, a job that did not pass.
 *
 * HOW. Each test builds a scratch repository (the --root seam) and a stub `gh`
 * first on PATH (the API seam), then runs the real script. The fixture is REAL at
 * every layer: the merge commit is a real object (git hash-object -t commit -w)
 * with a multi-line gpgsig header and no final newline, as GitHub writes them; the
 * provenance files are what ci.yml's step writes; the zips are real archives; the
 * digests are their real sha256. A plant changes ONE field and the builder
 * recomputes every hash and digest downstream of it, so only the check under test
 * can fire -- a plant that also broke a hash upstream would be caught by the wrong
 * check and prove nothing about the right one.
 *
 * ISOLATION. The script runs with an environment built from nothing: PATH is the
 * stub directory (holding the stub gh and links to node and git) then /usr/bin and
 * /bin; GH_CONFIG_DIR is an empty directory; no GH_TOKEN, GITHUB_TOKEN, GH_HOST,
 * GH_REPO or GH_ENTERPRISE_TOKEN is passed. The stub logs every call and exits 99
 * on any endpoint it was not given, or any argument but `api <path>`, so a test
 * cannot reach GitHub and a call the fixture did not expect is a failure. Every
 * plant asserts the call log up to its refusal.
 *
 * NOT ASSERTED HERE, deliberately: that the real GitHub API answers in the shapes
 * the stub gives. Those shapes are the documented ones, and the script's first live
 * run on S-c's head (R-2026-09-29-171, EU-3 n) is the observation that they hold.
 */

const SCRIPT = 'pr_evidence.mjs';
const SCRIPT_PATH = join(REPO_ROOT, 'scripts', SCRIPT);
const REPO = 'repos/Paddie-Health-Ltd/OpenBed-NG';
const RECORD = join('Sprint Kickoffs', 'decision-2026-09-14-public-private-split.md');
const REQUIRED: string[] = (JSON.parse(readFileSync(join(REPO_ROOT, 'packages/fixtures/required-checks.json'), 'utf8')) as { jobs: string[] }).jobs;

const RUN = 4242;
const ATTEMPT = 1;
const STARTED = '2026-09-29T16:00:00Z';
const CREATED = '2026-09-29T16:05:00Z';
const EXPIRES = '2026-12-28T16:05:00Z';

type ArtName = 'junit-compliance' | 'junit-db' | 'junit-golden-path';
const SPECS: { name: ArtName; id: number; job: string; files: string[] }[] = [
  { name: 'junit-compliance', id: 901, job: 'compliance-tests', files: ['junit-compliance.xml'] },
  { name: 'junit-db', id: 902, job: 'db-tests', files: ['junit-db.xml'] },
  { name: 'junit-golden-path', id: 903, job: 'golden-path', files: ['junit-e2e.xml', 'junit-ratchet.xml'] },
];

const GREEN_XML =
  '<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites name="vitest tests" tests="2" failures="0" errors="0" time="0.1">\n' +
  '  <testsuite name="a.test.ts" tests="2" failures="0" errors="0" skipped="0" time="0.1">\n' +
  '    <testcase classname="a.test.ts" name="one" time="0.01">\n    </testcase>\n' +
  '    <testcase classname="a.test.ts" name="two" time="0.01">\n    </testcase>\n' +
  '  </testsuite>\n</testsuites>\n';
const RED_XML = GREEN_XML.replace('failures="0" errors="0" time', 'failures="1" errors="0" time')
  .replace('name="two" time="0.01">\n', 'name="two" time="0.01">\n      <failure message="planted red"></failure>\n');
const TRUNCATED_XML = GREEN_XML.slice(0, GREEN_XML.indexOf('  </testsuite>'));

const RECORD_TEXT = [
  '# Decision record (scratch)',
  '',
  '## Deferred items — this record is where the list lives',
  '',
  '| Item | Ruling | Gate kind | Gate |',
  '|---|---|---|---|',
  '| A box item | R-2026-09-26-121 CW-2 | BOX | Its box |',
  '| A trigger item | R-2026-09-26-121 CW-2 | TRIGGER | The next thing |',
  '| Another trigger | R-2026-09-26-121 CW-2 | TRIGGER | The thing after |',
  '| A version item | R-2026-09-26-121 CW-2 | VERSION | Out of v1 |',
  '',
  '## Method notes',
  '',
].join('\n');

/** The refusals, by leg identity (the longest static run in each message). */
const MSG = {
  rootValue: '--root needs a directory after it',
  usage: 'usage: node scripts/pr_evidence.mjs [--root <dir>] -- it takes no other argument',
  enobufs: 'the answer was cut off, so nothing in it is evidence.',
  ghMissing: ') -- the evidence comes from the GitHub API, and without gh there is no block.',
  ghFailed: 'the GitHub API call failed (gh exit',
  notJson: "the GitHub API's reply to",
  noList: "the GitHub API's answer for",
  gitFailed: 'did not succeed under --root (',
  unzipMissing: ") -- an artefact's entries are listed and read with unzip",
  notPushed: 'is not on GitHub -- push it before building its evidence',
  noRun: 'no pull_request run of ci.yml exists for HEAD',
  unfinished: 'no run for HEAD has completed yet; the newest,',
  cancelled: ', was cancelled -- runs in progress after it',
  count: '; exactly one is required',
  runId: 'names workflow run',
  headSha: 'was made for head',
  expired: 'has expired; the evidence it held is gone',
  earlier: 'it belongs to an earlier attempt',
  noDigest: 'carries no digest, so its bytes have nothing to be checked against',
  download: 'did not download (gh exit',
  digest: ', not its recorded digest',
  listZip: 'unzip -Z1 refused the zip for artefact',
  pathEntry: '; only bare names are accepted',
  entries: 'holds the entries',
  extract: 'unzip -p did not extract',
  provShape: 'does not open with github_sha, run_id, run_attempt, job and object_size in order, then',
  size: 'object bytes after ---, not object_size=',
  sha1: 'the commit object in',
  parents: 'parents; a pull_request merge has exactly two',
  parent2: "the tested merge's second parent is",
  provRun: 'names run_id=',
  provAttempt: ", not the run's attempt",
  provJob: 'names job=',
  disagree: 'the three provenance files name different tested commits',
  noBase: 'is not in this clone; run git fetch origin main, then run this again',
  noJob: 'has no job named',
  dupJob: 'each required job must appear exactly once',
  runHead: 'not to this HEAD',
  jobAttempt: ", not the provenance's attempt",
  attest: 'attest_counts.mjs gave no attestation for',
  noRecord: 'the decision record is not readable at',
  register: 'the deferred-items register did not parse (',
} as const;

const NOT_ASSERTED_LINES = [
  '  - A PR can change its own evidence machinery.',
  '  - The counts hold for merge M, not for main as it is now.',
  '  - Retention: the evidence expires when the artefacts do.',
  '  - Cowork cannot recheck the API calls; it still receives the block as a paste.',
  '  - Internal consistency is not correctness (attest_counts.mjs:14-18).',
  '  - The register count comes from the tree, not from CI.',
  '  - Re-running the named run replaces its artefacts; after that this block cannot be rechecked. Push, or edit the body, for a new run; never re-run one whose block is pasted.',
];

// ---- the fixture -----------------------------------------------------------------

interface Prov {
  github_sha?: string;
  run_id?: string;
  run_attempt?: string;
  job?: string;
  object_size?: (real: number) => string;
  /** Parents of the merge object, given B and H. */
  parents?: (b: string, h: string) => string[];
  /** A different committer time makes a different, equally valid, merge. */
  time?: number;
  /** Bytes appended to the object AFTER its size and sha1 are taken. */
  append?: string;
  /** The five key lines replaced wholesale. */
  header?: (lines: string[]) => string[];
}

interface Plant {
  /** The file H's commit adds. */
  headPath?: string;
  /** A plant needing a repo without refs/remotes/origin/main. */
  noOriginMain?: boolean;
  /** The decision record's text; null writes no record at all. */
  record?: string | null;
  prov?: Partial<Record<ArtName, Prov>>;
  junit?: Record<string, string>;
  entries?: Partial<Record<ArtName, (e: ZipEntry[]) => ZipEntry[]>>;
  /** Raw zip bytes replaced after they are built (the digest is taken after this). */
  zipBytes?: Partial<Record<ArtName, (z: Buffer) => Buffer>>;
  artifacts?: (a: Art[]) => Art[];
  runs?: (r: RunObj[]) => RunObj[];
  jobs?: (j: JobObj[]) => JobObj[];
  /** Routes replaced or added after the builder has made them. */
  routes?: (r: Map<string, Route>, ids: { head: string }) => void;
  /** Empty commits between B and H, made with git fast-import, so B..HEAD's log is long. */
  extraCommits?: number;
  /** Read the script's stdout through `| (sleep 1; cat)`, as a slow reader on a pipe would. */
  slowPipe?: boolean;
  /** 'no-unzip': PATH holds only git, node and the stub. 'no-gh': no gh anywhere on PATH. */
  path?: 'no-unzip' | 'no-gh';
  args?: string[];
}

interface Art {
  id: number;
  name: string;
  digest?: string | null;
  expired: boolean;
  created_at: string;
  expires_at: string;
  workflow_run: { id: number; head_sha: string };
}
interface RunObj { id: number; status: string; conclusion: string | null; run_attempt: number; run_started_at: string; head_sha: string }
interface JobObj { name: string; conclusion: string; status: string; run_attempt: number }
interface Route { body: Buffer | string; status?: number; err?: string; zero?: number }

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
  calls: string[];
  head: string;
  base: string;
  merge: string;
  digests: string[];
  object: Buffer;
}

const gitEnv = (home: string): NodeJS.ProcessEnv => ({
  PATH: '/usr/bin:/bin',
  HOME: home,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Plant',
  GIT_AUTHOR_EMAIL: 'plant@example.invalid',
  GIT_COMMITTER_NAME: 'Plant',
  GIT_COMMITTER_EMAIL: 'plant@example.invalid',
  GIT_AUTHOR_DATE: '2026-09-29T12:00:00Z',
  GIT_COMMITTER_DATE: '2026-09-29T12:00:00Z',
});

const key = (path: string): string => path.replace(/[^A-Za-z0-9]/g, '_');
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

/** The merge object, as GitHub writes it: signed, and ending without a newline. */
function mergeObject(tree: string, parents: string[], time: number): string {
  const sig = ['-----BEGIN PGP ' + 'SIGNATURE-----', '', 'wsFcBAABCAAQBQJo2plantAAoJEPLANTPLANTPLAN', '=pLnT', '-----END PGP ' + 'SIGNATURE-----'];
  return [
    `tree ${tree}`,
    ...parents.map((p) => `parent ${p}`),
    `author Plant <plant@example.invalid> ${time} +0000`,
    `committer GitHub <noreply@example.invalid> ${time} +0000`,
    `gpgsig ${sig[0]}`,
    ...sig.slice(1).map((l) => ` ${l}`),
    '',
    'Merge the head into the base',
  ].join('\n');
}

const STUB = [
  '#!/bin/sh',
  'printf "%s\\n" "$2" >> "$STUB_LOG"',
  'if [ "$#" -ne 2 ] || [ "$1" != api ]; then echo "stub gh: unexpected arguments: $*" >&2; exit 99; fi',
  'k=$(printf "%s" "$2" | /usr/bin/tr -c "A-Za-z0-9" "_")',
  'f="$STUB_ROUTES/$k"',
  'if [ -f "$f.zero" ]; then /usr/bin/head -c "$(/bin/cat "$f.zero")" /dev/zero; exit 0; fi',
  'if [ ! -f "$f.body" ]; then echo "stub gh: no route for $2" >&2; exit 99; fi',
  '/bin/cat "$f.body"',
  'st=0',
  'if [ -f "$f.status" ]; then st=$(/bin/cat "$f.status"); fi',
  'if [ -f "$f.err" ]; then /bin/cat "$f.err" >&2; fi',
  'exit "$st"',
  '',
].join('\n');

function run(plant: Plant = {}): Result {
  const tmp = mkdtempSync(join(tmpdir(), 'openbed-prev-'));
  try {
    const root = join(tmp, 'repo');
    const home = join(tmp, 'home');
    const bin = join(tmp, 'bin');
    const routes = join(tmp, 'routes');
    const ghConfig = join(tmp, 'gh-config');
    for (const d of [root, home, bin, routes, ghConfig]) mkdirSync(d, { recursive: true });
    const g = (...args: string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: gitEnv(home) }).trim();

    // ---- the repository: B on main, H one commit on top ------------------------------
    g('init', '-q', '-b', 'main');
    mkdirSync(join(root, dirname(RECORD)), { recursive: true });
    if (plant.record !== null) writeFileSync(join(root, RECORD), plant.record ?? RECORD_TEXT);
    writeFileSync(join(root, 'README.md'), 'scratch\n');
    g('add', '-A');
    g('commit', '-q', '-m', 'base');
    const base = g('rev-parse', 'HEAD');
    if (plant.extraCommits) {
      const stream = Array.from({ length: plant.extraCommits }, (_, i) => {
        const subject = `padding commit ${String(i).padStart(4, '0')} keeps the block above sixty-four KiB`;
        return `commit refs/heads/main\ncommitter Plant <plant@example.invalid> ${1759161600 + i} +0000\ndata ${Buffer.byteLength(subject)}\n${subject}\n${i === 0 ? `from ${base}\n` : ''}\n`;
      }).join('');
      execFileSync('git', ['-C', root, 'fast-import', '--quiet'], { input: stream, env: gitEnv(home) });
      g('reset', '-q', '--hard', 'main');
    }
    const headPath = plant.headPath ?? 'docs/change.md';
    mkdirSync(join(root, dirname(headPath)), { recursive: true });
    writeFileSync(join(root, headPath), 'the head change\n');
    g('add', '-A');
    g('commit', '-q', '-m', 'head');
    const head = g('rev-parse', 'HEAD');
    const tree = g('rev-parse', 'HEAD^{tree}');
    if (!plant.noOriginMain) g('update-ref', 'refs/remotes/origin/main', base);

    // ---- the merge object, the provenance files, the junit, the zips -----------------
    const zips = new Map<ArtName, Buffer>();
    let merge = '';
    let greenObject = Buffer.alloc(0);
    for (const spec of SPECS) {
      const p: Prov = plant.prov?.[spec.name] ?? {};
      const text = mergeObject(tree, (p.parents ?? ((b, h) => [b, h]))(base, head), p.time ?? 1759161600);
      const object = Buffer.from(text, 'utf8');
      const m = execFileSync('git', ['-C', root, 'hash-object', '-t', 'commit', '-w', '--stdin'], { input: object, encoding: 'utf8', env: gitEnv(home) }).trim();
      if (spec.name === 'junit-compliance') {
        merge = m;
        greenObject = object;
      }
      const body = p.append === undefined ? object : Buffer.concat([object, Buffer.from(p.append)]);
      let lines = [
        `github_sha=${p.github_sha ?? m}`,
        `run_id=${p.run_id ?? String(RUN)}`,
        `run_attempt=${p.run_attempt ?? String(ATTEMPT)}`,
        `job=${p.job ?? spec.job}`,
        `object_size=${(p.object_size ?? String)(object.length)}`,
      ];
      if (p.header) lines = p.header(lines);
      const prov = Buffer.concat([Buffer.from(`${lines.join('\n')}\n---\n`), body]);
      let entries: ZipEntry[] = [
        ...spec.files.map((f) => ({ name: f, data: Buffer.from(plant.junit?.[f] ?? GREEN_XML) })),
        { name: 'ci-provenance.txt', data: prov },
      ];
      const em = plant.entries?.[spec.name];
      if (em) entries = em(entries);
      let zip = makeZip(entries);
      const zm = plant.zipBytes?.[spec.name];
      if (zm) zip = zm(zip);
      zips.set(spec.name, zip);
    }

    // ---- the API answers -------------------------------------------------------------
    let artifacts: Art[] = SPECS.map((s) => ({
      id: s.id,
      name: s.name,
      digest: `sha256:${sha256(zips.get(s.name) as Buffer)}`,
      expired: false,
      created_at: CREATED,
      expires_at: EXPIRES,
      workflow_run: { id: RUN, head_sha: head },
    }));
    if (plant.artifacts) artifacts = plant.artifacts(artifacts);
    let runs: RunObj[] = [{ id: RUN, status: 'completed', conclusion: 'success', run_attempt: ATTEMPT, run_started_at: STARTED, head_sha: head }];
    if (plant.runs) runs = plant.runs(runs);
    let jobs: JobObj[] = REQUIRED.map((name) => ({ name, conclusion: 'success', status: 'completed', run_attempt: ATTEMPT }));
    if (plant.jobs) jobs = plant.jobs(jobs);

    const table = new Map<string, Route>();
    table.set(`commits/${head}`, { body: JSON.stringify({ sha: head }) });
    table.set(`actions/workflows/ci.yml/runs?head_sha=${head}&event=pull_request&per_page=100`, { body: JSON.stringify({ total_count: runs.length, workflow_runs: runs }) });
    table.set(`actions/runs/${RUN}/artifacts?per_page=100&page=1`, { body: JSON.stringify({ total_count: artifacts.length, artifacts }) });
    for (const s of SPECS) table.set(`actions/artifacts/${s.id}/zip`, { body: zips.get(s.name) as Buffer });
    table.set(`actions/runs/${RUN}/attempts/${ATTEMPT}/jobs?per_page=100`, { body: JSON.stringify({ total_count: jobs.length, jobs }) });
    plant.routes?.(table, { head });
    for (const [path, r] of table) {
      const k = key(`${REPO}/${path}`);
      writeFileSync(join(routes, `${k}.body`), r.body);
      if (r.status !== undefined) writeFileSync(join(routes, `${k}.status`), String(r.status));
      if (r.err !== undefined) writeFileSync(join(routes, `${k}.err`), r.err);
      if (r.zero !== undefined) writeFileSync(join(routes, `${k}.zero`), String(r.zero));
    }

    // ---- the tools on PATH -----------------------------------------------------------
    if (plant.path !== 'no-gh') {
      writeFileSync(join(bin, 'gh'), STUB);
      chmodSync(join(bin, 'gh'), 0o755);
    }
    symlinkSync(process.execPath, join(bin, 'node'));
    const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } }).trim();
    symlinkSync(realGit, join(bin, 'git'));
    const PATH = plant.path === 'no-unzip' || plant.path === 'no-gh' ? bin : `${bin}:/usr/bin:/bin`;
    const log = join(tmp, 'calls.log');
    const env: NodeJS.ProcessEnv = { PATH, HOME: home, TMPDIR: tmp, GH_CONFIG_DIR: ghConfig, STUB_LOG: log, STUB_ROUTES: routes };
    for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_HOST', 'GH_REPO', 'GH_ENTERPRISE_TOKEN']) delete env[k];

    // A slow reader: bash pipes the script's stdout to `(sleep 1; cat)`. PIPESTATUS[0] is the
    // script's own exit status, which the pipeline's would otherwise hide behind cat's.
    const r = plant.slowPipe
      ? spawnSync('/bin/bash', ['-c', '"$OPENBED_T_NODE" "$OPENBED_T_SCRIPT" --root "$OPENBED_T_ROOT" | (sleep 1; cat); exit ${PIPESTATUS[0]}'], {
          encoding: 'utf8',
          env: { ...env, OPENBED_T_NODE: process.execPath, OPENBED_T_SCRIPT: SCRIPT_PATH, OPENBED_T_ROOT: root },
          cwd: tmp,
          maxBuffer: 64 * 1024 * 1024,
        })
      : spawnSync(process.execPath, [SCRIPT_PATH, ...(plant.args ?? ['--root', root])], { encoding: 'utf8', env, cwd: tmp });
    let calls: string[] = [];
    try {
      calls = readFileSync(log, 'utf8').split('\n').filter((l) => l !== '').map((l) => l.slice(REPO.length + 1));
    } catch {
      calls = [];
    }
    return {
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      calls,
      head,
      base,
      merge,
      digests: artifacts.map((a) => String(a.digest)),
      object: greenObject,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The green fixture's calls, in order; a refusal's log is a prefix of this. */
function greenCalls(head: string): string[] {
  return [
    `commits/${head}`,
    `actions/workflows/ci.yml/runs?head_sha=${head}&event=pull_request&per_page=100`,
    `actions/runs/${RUN}/artifacts?per_page=100&page=1`,
    'actions/artifacts/901/zip',
    'actions/artifacts/902/zip',
    'actions/artifacts/903/zip',
    `actions/runs/${RUN}/attempts/${ATTEMPT}/jobs?per_page=100`,
  ];
}

const out = (r: Result): string => `exit ${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}\n--- calls\n${r.calls.join('\n')}`;

/** A refusal: exit 2, its own message, no block, and the calls up to it. */
function refused(r: Result, message: string, calls: number): void {
  expect(r.status, `not refused with exit 2:\n${out(r)}`).toBe(2);
  expect(r.stderr, `refused, but not by this check:\n${out(r)}`).toContain(message);
  expect(r.stdout, `a refusal printed a block:\n${out(r)}`).not.toContain('```');
  expect(r.calls, `the calls up to the refusal:\n${out(r)}`).toEqual(greenCalls(r.head).slice(0, calls));
}

const artefact = (name: ArtName, f: (a: Art) => Art) => (arts: Art[]): Art[] => arts.map((a) => (a.name === name ? f(a) : a));

describe('pr_evidence.mjs: the green fixture, and the controls', () => {
  test('positive control — the full green fixture prints the block, exit 0', () => {
    const r = run();
    expect(r.status, out(r)).toBe(0);
    expect(r.calls, out(r)).toEqual(greenCalls(r.head));
    expect(r.stdout).toContain(`Run        : ${RUN}, attempt ${ATTEMPT}, github.com/Paddie-Health-Ltd/OpenBed-NG/actions/runs/${RUN}/attempts/${ATTEMPT}`);
    for (const d of r.digests) expect(r.stdout, `a digest is missing from the block:\n${r.stdout}`).toContain(d);
    for (const name of REQUIRED) expect(r.stdout).toContain(`  ${name.padEnd(18)} success`);
    expect(r.stdout.match(/RED-DISPOSITION ATTESTATION/g)?.length, r.stdout).toBe(3);
    expect(r.stdout).toContain('golden path phase 1 (junit-e2e.xml): corpus, not attested');
    expect(r.stdout).toContain(`  M=${r.merge}`);
    expect(r.stdout).toContain(`  B=${r.base}`);
    expect(r.stdout).toContain(`  H=${r.head}`);
    expect(r.stdout).toContain(`origin/main is ${r.base}; main has moved 0 commits since B`);
    expect(r.stdout).toContain('Register   : 4 (1 BOX, 2 TRIGGER, 1 VERSION), from the tree');
    expect(r.stdout).toContain('Disposition: ZERO-RED');
    for (const l of NOT_ASSERTED_LINES) expect(r.stdout).toContain(l);
    expect(r.stdout, 'the block printed the commit object').not.toContain('gpgsig');
    expect(r.stdout, 'the block printed an email').not.toContain('@example.invalid');
    expect(r.stdout).not.toContain('WARNING');
  });

  test('positive control — a signed merge object with no final newline is accepted', () => {
    const r = run();
    expect(r.object.toString('utf8'), 'precondition: the fixture object is not signed').toContain('\ngpgsig -----BEGIN PGP ');
    expect(r.object[r.object.length - 1], 'precondition: the fixture object ends in a newline').not.toBe(0x0a);
    expect(r.status, out(r)).toBe(0);
  });

  test('positive control — a red junit-e2e.xml is corpus, not attested: exit 0', () => {
    const r = run({ junit: { 'junit-e2e.xml': RED_XML } });
    expect(r.status, out(r)).toBe(0);
    expect(r.stdout).toContain('golden path phase 1 (junit-e2e.xml): corpus, not attested');
    expect(r.stdout).toContain('Disposition: ZERO-RED');
  });

  test('positive control — a newer run in progress beside a completed one: the completed one is used, the newer printed', () => {
    const r = run({ runs: (rs) => [...rs, { ...(rs[0] as RunObj), id: RUN + 1, status: 'in_progress', conclusion: null }] });
    expect(r.status, out(r)).toBe(0);
    expect(r.stdout).toContain(`Newer runs : ${RUN + 1} (in_progress) -- in progress, not used`);
  });

  test('positive control — no local origin/main: not compared, and the block still prints', () => {
    const r = run({ noOriginMain: true });
    expect(r.status, out(r)).toBe(0);
    expect(r.stdout).toContain('origin/main: not compared (no local origin/main)');
  });

  // THE SCRIPT PATHS ARE JOINED, NOT QUOTED WHOLE, and that is deliberate. The leg
  // register maps a test file to every script whose `scripts/<name>` it quotes as one
  // literal (tests/compliance/_legs.ts assertedByScript), and then credits that script's
  // legs from the file's other literals. Quoted whole, run_e2e.sh's path here made the
  // e2e JUnit file's name credit run_e2e.sh's registered phase-1 leg, which this file
  // never runs. The mapper reads raw text, comments included, so this comment does not
  // quote the path either. Found by leg_coverage.test.ts on the first measure; reported
  // in R-2026-09-29-171.
  const inScripts = (name: string): string => ['scripts', name].join('/');
  test.each([
    '.github/workflows/ci.yml',
    inScripts('attest_counts.mjs'),
    inScripts('pr_evidence.mjs'),
    inScripts('deferred_register.mjs'),
    inScripts('run_e2e.sh'),
    'packages/fixtures/required-checks.json',
    'vitest.config.ts',
    'package-lock.json',
    'tests/compliance/x.test.ts',
  ])('the warning — a PR touching %s says it changes its own evidence machinery', (path) => {
    const r = run({ headPath: path });
    expect(r.status, out(r)).toBe(0);
    expect(r.stdout).toContain(`WARNING: this PR changes its own evidence machinery:\n  ${path}`);
  });

  test('the warning — near miss: docs/tests/x warns nothing', () => {
    const r = run({ headPath: 'docs/tests/x' });
    expect(r.status, out(r)).toBe(0);
    expect(r.stdout).toContain('docs/tests/x');
    expect(r.stdout).not.toContain('WARNING: this PR changes its own evidence machinery');
  });
});

describe('pr_evidence.mjs: a long block reaches a slow reader whole (EV-1 b)', () => {
  test('plant — a block over 64 KiB read through a slow pipe arrives whole, with its Disposition and its closing fence, exit 0', () => {
    // process.exit() after console.log drops whatever a pipe has not yet flushed. Measured on
    // 27751c5: a 120 KB block through this reader arrived as exactly 65536 bytes, exit 0.
    const r = run({ extraCommits: 2000, slowPipe: true });
    expect(r.status, out(r).slice(0, 2000)).toBe(0);
    expect(Buffer.byteLength(r.stdout), 'precondition: the block is not over 64 KiB, so this tests nothing').toBeGreaterThan(65536);
    expect(r.stdout.trimEnd().endsWith('```'), `the block has no closing fence: it was cut off at ${Buffer.byteLength(r.stdout)} bytes`).toBe(true);
    expect(r.stdout, 'the block has no Disposition line').toContain('Disposition: ZERO-RED');
    expect(r.stdout.match(/^ {2}[0-9a-f]{7,} padding commit \d{4} /gm)?.length, 'a commit line was lost').toBe(2000);
  });
});

describe('pr_evidence.mjs: exit 1, the block marked RED', () => {
  test.each([
    ['junit-compliance.xml', 'compliance: attest_counts reads RED'],
    ['junit-ratchet.xml', 'ratchet: attest_counts reads RED'],
  ])('plant — a red %s prints the block marked RED, exit 1', (file, why) => {
    const r = run({ junit: { [file]: RED_XML } });
    expect(r.status, out(r)).toBe(1);
    expect(r.stdout).toContain(`Disposition: RED -- ${why}`);
    expect(r.calls).toEqual(greenCalls(r.head));
  });

  test('plant — a job concluding failure prints the block marked RED, exit 1', () => {
    const r = run({ jobs: (js) => js.map((j) => (j.name === 'db-tests' ? { ...j, conclusion: 'failure' } : j)) });
    expect(r.status, out(r)).toBe(1);
    expect(r.stdout).toContain(`  ${'db-tests'.padEnd(18)} failure`);
    expect(r.stdout).toContain('Disposition: RED -- job db-tests concluded failure');
  });

  test('plant — a run concluding failure with seven green jobs prints the block marked RED, exit 1 (EV-1 c)', () => {
    const r = run({ runs: (rs) => rs.map((x) => ({ ...x, conclusion: 'failure' })) });
    expect(r.status, out(r)).toBe(1);
    expect(r.stdout).toContain(`Disposition: RED -- run ${RUN} concluded failure`);
    expect(r.calls).toEqual(greenCalls(r.head));
  });

  test('plant — exit 2 outranks exit 1: a failed job and a truncated junit is exit 2, no block', () => {
    const r = run({
      jobs: (js) => js.map((j) => (j.name === 'db-tests' ? { ...j, conclusion: 'failure' } : j)),
      junit: { 'junit-db.xml': TRUNCATED_XML },
    });
    refused(r, MSG.attest, 7);
  });
});

describe('pr_evidence.mjs: exit 2, no block', () => {
  test('plant — an argument it does not take is refused before anything runs', () => {
    const r = run({ args: ['--rot', '.'] });
    refused(r, MSG.usage, 0);
  });

  test('plant — --root with no directory is refused before anything runs', () => {
    const r = run({ args: ['--root'] });
    refused(r, MSG.rootValue, 0);
  });

  test('plant — a --root that is not a git repository is refused', () => {
    const r = run({ args: ['--root', '/nonexistent-openbed-root'] });
    refused(r, MSG.gitFailed, 0);
  });

  test('plant — HEAD not on origin: the commits endpoint answers 404', () => {
    const r = run({ routes: (t, { head }) => t.set(`commits/${head}`, { body: '{"message":"Not Found"}', status: 1, err: 'gh: Not Found (HTTP 404)\n' }) });
    refused(r, MSG.notPushed, 1);
  });

  test('plant — no gh on PATH', () => {
    const r = run({ path: 'no-gh' });
    refused(r, MSG.ghMissing, 0);
    expect(r.stderr).toContain('(ENOENT)');
  });

  test('plant — gh answering more than 256 MiB', () => {
    const r = run({ routes: (t, { head }) => t.set(`commits/${head}`, { body: '', zero: 256 * 1024 * 1024 + 1 }) });
    refused(r, MSG.enobufs, 1);
  });

  test('plant — a failed API call (the runs list answers 502)', () => {
    const r = run({ routes: (t, { head }) => t.set(`actions/workflows/ci.yml/runs?head_sha=${head}&event=pull_request&per_page=100`, { body: '', status: 1, err: 'gh: Bad Gateway (HTTP 502)\n' }) });
    refused(r, MSG.ghFailed, 2);
  });

  test('plant — an answer that is not JSON', () => {
    const r = run({ routes: (t, { head }) => t.set(`actions/workflows/ci.yml/runs?head_sha=${head}&event=pull_request&per_page=100`, { body: '<html>' }) });
    refused(r, MSG.notJson, 2);
  });

  test('plant — an answer with no workflow_runs list', () => {
    const r = run({ routes: (t, { head }) => t.set(`actions/workflows/ci.yml/runs?head_sha=${head}&event=pull_request&per_page=100`, { body: '{"total_count":0}' }) });
    refused(r, MSG.noList, 2);
  });

  test('plant — no run', () => {
    const r = run({ runs: () => [] });
    refused(r, MSG.noRun, 2);
  });

  test('plant — an unfinished run: none completed', () => {
    const r = run({ runs: (rs) => rs.map((x) => ({ ...x, status: 'in_progress', conclusion: null })) });
    refused(r, MSG.unfinished, 2);
    expect(r.stderr).toContain(`the newest, ${RUN}, is in_progress`);
  });

  test('plant — a cancelled run, naming the newer run in progress', () => {
    const r = run({ runs: (rs) => [{ ...(rs[0] as RunObj), conclusion: 'cancelled' }, { ...(rs[0] as RunObj), id: RUN + 1, status: 'queued', conclusion: null }] });
    refused(r, MSG.cancelled, 2);
    expect(r.stderr).toContain(`${RUN + 1} (queued)`);
  });

  test('plant — a missing artefact', () => {
    // Artefacts are checked in order, so junit-compliance's zip has been fetched first.
    const r = run({ artifacts: (as) => as.filter((a) => a.name !== 'junit-db') });
    refused(r, MSG.count, 4);
    expect(r.stderr).toContain('holds 0 artefacts named junit-db');
  });

  test('plant — two artefacts of one name', () => {
    const r = run({ artifacts: (as) => [...as, { ...(as[0] as Art), id: 999 }] });
    refused(r, MSG.count, 3);
    expect(r.stderr).toContain('holds 2 artefacts named junit-compliance');
  });

  test('plant — workflow_run.id is not the run', () => {
    const r = run({ artifacts: artefact('junit-db', (a) => ({ ...a, workflow_run: { ...a.workflow_run, id: RUN - 1 } })) });
    refused(r, MSG.runId, 4);
  });

  test('plant — workflow_run.head_sha is not HEAD', () => {
    const r = run({ artifacts: artefact('junit-db', (a) => ({ ...a, workflow_run: { ...a.workflow_run, head_sha: 'f'.repeat(40) } })) });
    refused(r, MSG.headSha, 4);
  });

  test('plant — an expired artefact', () => {
    const r = run({ artifacts: artefact('junit-db', (a) => ({ ...a, expired: true })) });
    refused(r, MSG.expired, 4);
  });

  test('plant — an artefact from an earlier attempt: created_at before run_started_at', () => {
    const r = run({ artifacts: artefact('junit-golden-path', (a) => ({ ...a, created_at: '2026-09-29T15:59:59Z' })) });
    refused(r, MSG.earlier, 5);
  });

  test('plant — a null digest', () => {
    const r = run({ artifacts: artefact('junit-db', (a) => ({ ...a, digest: null })) });
    refused(r, MSG.noDigest, 4);
  });

  test('plant — an absent digest', () => {
    const r = run({ artifacts: artefact('junit-db', (a) => {
      const copy = { ...a };
      delete copy.digest;
      return copy;
    }) });
    refused(r, MSG.noDigest, 4);
  });

  test('plant — a zip that does not download', () => {
    const r = run({ routes: (t) => t.set('actions/artifacts/902/zip', { body: '', status: 1, err: 'gh: Gone (HTTP 410)\n' }) });
    refused(r, MSG.download, 5);
  });

  test('plant — a digest mismatch', () => {
    const r = run({ artifacts: artefact('junit-db', (a) => ({ ...a, digest: `sha256:${'0'.repeat(64)}` })) });
    refused(r, MSG.digest, 5);
  });

  test('plant — unzip missing (PATH holding only git, node and the stub)', () => {
    const r = run({ path: 'no-unzip' });
    refused(r, MSG.unzipMissing, 4);
  });

  test('plant — a zip unzip -Z1 refuses', () => {
    const r = run({ zipBytes: { 'junit-db': () => Buffer.from('this is not a zip archive') } });
    refused(r, MSG.listZip, 5);
  });

  test('plant — an entry sub/junit-db.xml', () => {
    const r = run({ entries: { 'junit-db': (es) => es.map((e) => (e.name === 'junit-db.xml' ? { ...e, name: 'sub/junit-db.xml' } : e)) } });
    refused(r, MSG.pathEntry, 5);
  });

  test('plant — an entry ../x', () => {
    const r = run({ entries: { 'junit-db': (es) => [...es, { name: '../x', data: Buffer.from('x') }] } });
    refused(r, MSG.pathEntry, 5);
  });

  test('plant — a zip missing ci-provenance.txt', () => {
    const r = run({ entries: { 'junit-db': (es) => es.filter((e) => e.name !== 'ci-provenance.txt') } });
    refused(r, MSG.entries, 5);
  });

  // R-2026-09-30-179 FC-5: the entries are compared SORTED, so the runner's order is irrelevant. This refused a correct
  // run on 2026-10-01, when junit-golden-path's zip listed junit-ratchet.xml, ci-provenance.txt, junit-e2e.xml.
  test('positive control — the real entries in REVERSE order are accepted, on every artefact (FC-5)', () => {
    const reversed = (es: ZipEntry[]): ZipEntry[] => [...es].reverse();
    const r = run({ entries: { 'junit-compliance': reversed, 'junit-db': reversed, 'junit-golden-path': reversed } });
    expect(r.status, out(r)).toBe(0);
    expect(r.stdout).toContain('Disposition: ZERO-RED');
  });

  test('positive control — a three-entry artefact in the runner\'s observed order is accepted (FC-5)', () => {
    const observed = (es: ZipEntry[]): ZipEntry[] => ['junit-ratchet.xml', 'ci-provenance.txt', 'junit-e2e.xml'].map((n) => es.find((e) => e.name === n) as ZipEntry);
    const r = run({ entries: { 'junit-golden-path': observed } });
    expect(r.status, out(r)).toBe(0);
  });

  test('plant — an entry duplicated IN ADDITION is refused: the lengths differ though the set of names is equal (FC-5)', () => {
    const r = run({ entries: { 'junit-db': (es) => [...es, es.find((e) => e.name === 'ci-provenance.txt') as ZipEntry] } });
    refused(r, MSG.entries, 5);
  });

  test('plant — a zip with an extra entry', () => {
    const r = run({ entries: { 'junit-db': (es) => [...es, { name: 'extra.txt', data: Buffer.from('x') }] } });
    refused(r, MSG.entries, 5);
  });

  test('plant — an entry that lists but will not extract (a bad CRC)', () => {
    const r = run({ entries: { 'junit-db': (es) => es.map((e) => (e.name === 'junit-db.xml' ? { ...e, badCrc: true } : e)) } });
    refused(r, MSG.extract, 5);
  });

  test('plant — a provenance file whose keys are out of order', () => {
    const r = run({ prov: { 'junit-db': { header: (l) => [l[1], l[0], ...l.slice(2)] as string[] } } });
    refused(r, MSG.provShape, 6);
  });

  test('plant — the object with one byte appended', () => {
    const r = run({ prov: { 'junit-db': { append: 'x' } } });
    refused(r, MSG.size, 6);
  });

  test('plant — object_size wrong', () => {
    const r = run({ prov: { 'junit-db': { object_size: (n) => String(n - 1) } } });
    refused(r, MSG.size, 6);
  });

  test('plant — an object that does not hash to github_sha', () => {
    const r = run({ prov: { 'junit-db': { github_sha: 'e'.repeat(40) } } });
    refused(r, MSG.sha1, 6);
  });

  test('plant — a merge with one parent', () => {
    const r = run({ prov: { 'junit-compliance': { parents: (_b, h) => [h] } } });
    refused(r, MSG.parents, 6);
    expect(r.stderr).toContain('has 1 parents');
  });

  test('plant — a merge with three parents', () => {
    const r = run({ prov: { 'junit-compliance': { parents: (b, h) => [b, h, b] } } });
    refused(r, MSG.parents, 6);
    expect(r.stderr).toContain('has 3 parents');
  });

  test('plant — parent 2 is not HEAD', () => {
    const r = run({ prov: { 'junit-compliance': { parents: (b) => [b, b] } } });
    refused(r, MSG.parent2, 6);
  });

  test('plant — the provenance run_id is not the run', () => {
    const r = run({ prov: { 'junit-db': { run_id: String(RUN - 1) } } });
    refused(r, MSG.provRun, 6);
  });

  test('plant — the provenance run_attempt is not the run attempt', () => {
    const r = run({ prov: { 'junit-db': { run_attempt: '2' } } });
    refused(r, MSG.provAttempt, 6);
  });

  test('plant — two files swapping job=', () => {
    const r = run({ prov: { 'junit-compliance': { job: 'db-tests' }, 'junit-db': { job: 'compliance-tests' } } });
    refused(r, MSG.provJob, 6);
    expect(r.stderr).toContain('ci-provenance.txt in junit-compliance names job=db-tests, not compliance-tests');
  });

  test('plant — the three files disagreeing on M', () => {
    const r = run({ prov: { 'junit-golden-path': { time: 1759161601 } } });
    refused(r, MSG.disagree, 6);
  });

  test('plant — B absent from the clone', () => {
    const r = run({ prov: Object.fromEntries(SPECS.map((s) => [s.name, { parents: (_b: string, h: string) => ['a'.repeat(40), h] }])) });
    refused(r, MSG.noBase, 6);
    expect(r.stderr).toContain('git fetch origin main');
  });

  test('plant — one of the seven jobs missing', () => {
    const r = run({ jobs: (js) => js.filter((j) => j.name !== 'secret-scan') });
    refused(r, MSG.noJob, 7);
    expect(r.stderr).toContain('has no job named secret-scan');
  });

  test('plant — a duplicate job name, the second failing after a green one, is refused, never read as green (EV-1 a)', () => {
    const r = run({ jobs: (js) => [...js, { ...(js.find((j) => j.name === 'db-tests') as JobObj), conclusion: 'failure' }] });
    refused(r, MSG.dupJob, 7);
    expect(r.stderr).toContain('has 2 jobs named db-tests');
  });

  test('plant — a run whose head_sha is not HEAD is refused (EV-1 c)', () => {
    const r = run({ runs: (rs) => rs.map((x) => ({ ...x, head_sha: 'f'.repeat(40) })) });
    refused(r, MSG.runHead, 2);
    expect(r.stderr).toContain(`the run ${RUN} belongs to head ${'f'.repeat(40)}`);
  });

  test('plant — a job from another attempt', () => {
    const r = run({ jobs: (js) => js.map((j) => (j.name === 'golden-path' ? { ...j, run_attempt: 2 } : j)) });
    refused(r, MSG.jobAttempt, 7);
  });

  test('plant — a truncated JUnit, attest_counts exit 2 passed through', () => {
    const r = run({ junit: { 'junit-compliance.xml': TRUNCATED_XML } });
    refused(r, MSG.attest, 7);
    // attest_counts' own refusal reaches the reader.
    expect(r.stderr).toContain('the JUnit file does not end with </testsuites>');
  });

  test('plant — no decision record under --root', () => {
    const r = run({ record: null });
    refused(r, MSG.noRecord, 7);
  });

  test('plant — a register parse error', () => {
    const r = run({ record: RECORD_TEXT.replace('| A box item | R-2026-09-26-121 CW-2 | BOX | Its box |', '| A box item | R-2026-09-26-121 CW-2 | BOX |') });
    refused(r, MSG.register, 7);
    expect(r.stderr).toContain('4 cells expected and 3 found');
  });
});
