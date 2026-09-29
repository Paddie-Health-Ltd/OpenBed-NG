import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { docsUnder, isGoverned, loadRunbooks, RUNBOOKS, shellFences, sqlFences, type Doc } from '../compliance/_fences.js';
import { REPO_ROOT } from '../compliance/_scratch.js';
import { assertScheduledJobsPaused, sql } from '../setup/db.js';
import { digest, moved } from '../setup/digest.js';
import { dbUrl } from '../setup/local-keys.js';
import { BLOCKS, commandFenceAt, fingerprint, runFence, shown, tables, type BlockId, type Run } from '../setup/runbook.js';

/**
 * THE RUNBOOK'S SQL, RUN LIVE (R-2026-09-29-165, EO-1).
 *
 * WHY IT EXISTS. tests/compliance/runbook_psql_path.test.ts counts the fences that need psql
 * and never runs one. tests/db/runbook_12_4_12_5_sql_live.test.ts runs five of them. Every
 * other statement the runbook hands the founder reached hosted with nothing having parsed,
 * planned or privilege-checked it. This file runs the rest.
 *
 * THE CORPUS AND ITS PARTITION. The corpus is every governed shell fence (isGoverned(): it needs
 * psql on PATH) and every ```sql fence in the RUNBOOKS that tests/compliance/_fences.ts names.
 * partition() puts each in exactly one set, and a leg below holds that no ```sql fence
 * anywhere under docs/ sits outside those runbooks:
 *   - LIVE: the five fences BLOCKS names. tests/db/runbook_12_4_12_5_sql_live.test.ts runs them
 *     against fixtures, with their own variables.
 *   - EXCLUDED: each with its reason, keyed by ANCHOR TEXT, never a line number. An anchor must
 *     sit on exactly one line of the corpus, and it keys the first corpus fence after that line.
 *     Each entry also checks the body's shape. Two bodies are the same (1265 and 1887), so the
 *     shape is a check on each fence and never its key.
 *   - RUN-HERE: everything else, run below. A fence added to a runbook lands here unaided.
 * A fence that only runs a script (the PATH line, one `bash scripts/<name>.sh`, the unset),
 * and that no entry names, is a STOP: what that script does to a database has not been ruled.
 *
 * HOW A FENCE RUNS. Only over a partition with no errors: an EXCLUDED anchor that stopped
 * matching would drop a real apply, or a call to hosted, into RUN-HERE, so every RUN-HERE leg
 * asserts the partition clean before it spawns anything, and a plant below proves it.
 * Verbatim under bash, from the repository root, against the LOCAL stack.
 * beforeAll refuses anything but host 127.0.0.1 or localhost on port 54322 before any fence
 * runs, because the fences delete by id. The environment is an ALLOWLIST, never process.env:
 * PATH, LANG, LC_MESSAGES=C, a scratch HOME and PSQLRC=/dev/null (so a developer's ~/.psqlrc
 * and ~/.pgpass do not apply), DATABASE_URL, PGOPTIONS with a lock and a statement timeout,
 * and the INERT values. OPENBED_PSQL and every other PG* variable are left out, because
 * scripts/run_migrations.sh prefers OPENBED_PSQL over DATABASE_URL.
 *
 * THE INERT VALUES. FACILITY_ID is a fixed uuid, asserted to be in no table that references
 * app.facility; PROBE is nobody@example.invalid, asserted absent from auth.users; APPLY_TS is
 * `now`. So every write in a RUN-HERE fence touches 0 rows. A 0-row UPDATE or DELETE is still
 * parsed, planned and privilege-checked, which is what this file proves. Before a fence runs,
 * the `$NAME`s the shell would expand are read (quoted heredoc bodies are skipped, because the
 * shell does not expand them), and any name but DATABASE_URL, PATH or an inert one is red and
 * the fence is not run.
 *
 * WHAT IS RED. A fence's exit status is its unset's, so it says nothing. Red is a line, on
 * stdout or stderr, holding ERROR, FATAL, WARNING, STOP, "command not found" or "No such
 * file", unless an EXPECTATION names it. Expectations are keyed by anchor like EXCLUDED, and
 * one that keys no fence, or keys a fence that is not RUN-HERE, is red:
 *   - 1664, the post-apply read: exactly one "permission denied for table snapshot_current",
 *     from its anon select, and no other ERROR;
 *   - 3267, the append-only probe: "RESULT: BOTH LEGS PROVED", and no FAIL, PARTIAL or NOT
 *     PROVED in its notices. Locally that line ends "ON THE HOSTED ROLE GRAPH", which is not
 *     true here: it proves the local role graph;
 *   - 3059, the sweep's failing half: the row anon / facility / SELECT. Its ROLLBACK leaving
 *     no grant is the bracket's to show;
 *   - 1953, the grants read-back: its PASS line;
 *   - 988, 1856, 1933 and 2715, the dry runs: "0 migration(s) pending." Any other count means
 *     the local stack is not migrated, and says so, rather than reading as a runbook defect;
 *   - 4717, the retention runs: CHOSEN AS AN EXPECTATION rather than a note. A red word is
 *     tolerated on stdout only inside the return_message column of one of the three
 *     retention jobs' rows, which is where a real job failure prints. stderr is read in full.
 *
 * NOTHING CHANGES. The bracket starts with the scheduled jobs asserted paused. A fingerprint
 * is taken before the first fence and after the last: tests/setup/runbook.ts's tables, plus
 * the count of auth.users, the rows of cron.job, and the digest's relations and column_acl
 * components from tests/setup/digest.ts. They must be equal, and moved() names what differs.
 * The WRITE PLANT, after the bracket, proves the fingerprint sees a real 4744 delete.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - Hosted behaviour and hosted data. This runs against the local stack only.
 *   - Grants on platform-owned schemas (auth, cron). Supabase owns them, and hosted can
 *     differ from local; a fence that passes here on auth.users has not been shown to pass there.
 *   - The effect a write would have on a real row. Every write here touches 0 rows, so this
 *     proves analysis and privilege, not outcome. The five LIVE fences are where outcome is
 *     asserted, against fixtures.
 *   - The EXCLUDED fences:
 *       1265 and 1887 apply migrations for real;
 *       1873 and 1903 read https://openbed.ng over the network;
 *       1311 is a NOTIFY: there is nothing to compile, and a live schema reload would race
 *         tests/db/rpc_over_http_live.test.ts;
 *       3240 is quoted history, the statements the step used to carry. Running it would make
 *         superseded text a live constraint (this corrects EM-2 c, which named it an expected
 *         refusal: Cowork's slip).
 *   - A fence that changes its own session's transaction mode or timeouts. PGOPTIONS sets the
 *     session's defaults; a fence that SETs its own is not held to them.
 *   - The bracket depends on the scheduled jobs being paused (tests/setup/global-setup.ts).
 *     With them running, heartbeat and rollup writes would move the fingerprint every minute.
 *   - Sequence values. A rolled-back insert still consumes an id (3267's probe does, observed
 *     at audit_log id 213 on the first run), and the fingerprint hashes rows, not sequences.
 *   - How zsh treats a paste. tests/compliance/runbook_read_pasted_alone.test.ts holds that.
 *
 * LIVE: the SQL it runs exists now. It runs in the db-tests job.
 */

const SUPABASE_DOC = 'docs/runbook-supabase-project-creation.md';
const PATH_LINE = 'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"';

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];
const LOCAL_PORT = '54322';

const INERT_FACILITY = '0e000000-0000-4000-8000-000000000165';
const INERT_PROBE = 'nobody@example.invalid';
const INERT_NAMES = ['FACILITY_ID', 'PROBE', 'APPLY_TS'];
const ALLOWED_NAMES = new Set(['DATABASE_URL', 'PATH', ...INERT_NAMES]);

const PLANT_FACILITY = '0e000000-0000-4000-8000-0000000165a1';

/** One corpus fence: a governed shell fence or a ```sql fence. */
export interface CorpusFence {
  doc: string;
  line: number;
  label: 'shell' | 'sql';
  body: string;
}

const keyOf = (f: { doc: string; line: number }): string => `${f.doc}:${f.line}`;

/** An entry keyed by anchor text, with a check on its fence's body. */
interface Anchored {
  anchor: string;
  /** What the body must look like, in words, for the failure message. */
  shapeIs: string;
  shape: (f: CorpusFence) => boolean;
}

interface Excluded extends Anchored {
  reason: string;
}

interface Expectation extends Anchored {
  /** A red line this fence is allowed to print. */
  tolerate?: (line: string, stream: 'stdout' | 'stderr') => boolean;
  /** Each must match somewhere in stdout or stderr. */
  required?: RegExp[];
  /** None may appear in stdout or stderr. */
  forbidden?: string[];
  /** Anything else the fence must print, as the ways it did not. */
  check?: (r: Run) => string[];
}

const lines = (body: string): string[] => body.split('\n').filter((l) => l.trim() !== '');
const exactly = (want: string[]) => (f: CorpusFence): boolean => f.label === 'shell' && JSON.stringify(lines(f.body)) === JSON.stringify(want);
const holds = (...needles: string[]) => (f: CorpusFence): boolean => f.label === 'shell' && needles.every((n) => f.body.includes(n));

/** A script-shaped fence: the PATH line, one `bash scripts/<name>.sh [args]`, and the unset. */
export function scriptShaped(f: CorpusFence): boolean {
  const l = lines(f.body);
  return f.label === 'shell' && l.length === 3 && l[0] === PATH_LINE && /^bash scripts\/[\w.-]+\.sh( .*)?$/.test(l[1] ?? '') && /^unset /.test(l[2] ?? '');
}

const APPLY = [PATH_LINE, 'bash scripts/run_migrations.sh', 'unset DATABASE_URL'];
const DRY_RUN = [PATH_LINE, 'bash scripts/run_migrations.sh --dry-run', 'unset DATABASE_URL'];

export const EXCLUDED: readonly Excluded[] = [
  { anchor: 'Only after reading those lines, the apply:', reason: 'a real migration apply', shapeIs: 'the PATH line, the apply, the unset', shape: exactly(APPLY) },
  { anchor: '**3. The apply.** Only after fences 1 and 2 have both read as they must.', reason: 'a real migration apply', shapeIs: 'the PATH line, the apply, the unset', shape: exactly(APPLY) },
  { anchor: '**2. The before-reading.**', reason: 'hosted, over the network', shapeIs: 'the public read-back of https://openbed.ng, with no fingerprint', shape: exactly([PATH_LINE, 'bash scripts/readback_public_output.sh https://openbed.ng', 'unset DATABASE_URL']) },
  { anchor: '**4. The after-reading.**', reason: 'hosted, over the network', shapeIs: 'the public read-back of https://openbed.ng, with the fingerprint', shape: holds("bash scripts/readback_public_output.sh https://openbed.ng 'PASTE-THE-FINGERPRINT-HERE'") },
  { anchor: 'The reload. The first line waits silently', reason: 'NOTIFY: nothing to compile, and a live schema reload would race rpc_over_http_live', shapeIs: 'the pgrst reload notify', shape: holds("notify pgrst, 'reload schema'") },
  { anchor: '### The SQL this step used to carry was a no-op, and that is observed', reason: 'quoted history: running it would make superseded text a live constraint', shapeIs: 'the ```sql fence of the old tamper statements', shape: (f) => f.label === 'sql' && f.body.includes("set action = 'tampered'") },
];

/** The dry run's count line; 2715 prints its ledger count first, which is not this line. */
const PENDING = /^(\d+) migration\(s\) pending\.$/;
function pendingZero(r: Run): string[] {
  const found = r.stdout.split('\n').map((l) => l.trim()).filter((l) => PENDING.test(l));
  if (found.length !== 1) return [`expected one "<n> migration(s) pending." line, read ${found.length}`];
  const n = Number(PENDING.exec(found[0] ?? '')?.[1]);
  return n === 0 ? [] : [`it reads "${found[0] ?? ''}": the local stack is not migrated: npm run db:migrate`];
}

const DENIED = 'ERROR:  permission denied for table snapshot_current';
const RETENTION_ROW = /^(openbed_check_withdrawn_facility_accounts|openbed_erase_lapsed_ward_logins|openbed_prune_ended_auth_sessions)\|[^|]*\|/;

export const EXPECTATIONS: readonly Expectation[] = [
  {
    anchor: '**The first line asks for the apply time**',
    shapeIs: "the post-apply read, ending in anon's select and its rollback",
    shape: holds('set local role anon;', 'from public.snapshot_current;'),
    tolerate: (line) => line.includes(DENIED),
    check: (r) => {
      const n = `${r.stdout}\n${r.stderr}`.split('\n').filter((l) => l.includes(DENIED)).length;
      return n === 1 ? [] : [`expected exactly one "${DENIED}", read ${n}`];
    },
  },
  {
    anchor: '### The probe — run verbatim, connected with `DATABASE_URL` (step P first)',
    shapeIs: 'the append-only probe',
    shape: holds('do $probe$', 'ok_u and ok_d'),
    required: [/RESULT: BOTH LEGS PROVED/],
    forbidden: ['FAIL', 'PARTIAL', 'NOT PROVED'],
  },
  {
    anchor: '**Half 1 — the failing half. It must return a row.**',
    shapeIs: 'the sweep with its planted GRANT inside BEGIN ... ROLLBACK',
    shape: holds('BEGIN;', 'GRANT SELECT ON app.facility TO anon;', 'ROLLBACK;'),
    check: (r) => {
      const found = tables(r.stdout).tables.some((t) => JSON.stringify(t.columns) === '["grantee","table_name","privilege_type"]' && t.rows.some((row) => JSON.stringify(row) === '["anon","facility","SELECT"]'));
      return found ? [] : ['the row anon / facility / SELECT did not come back'];
    },
  },
  {
    anchor: '**6. Who can execute what (R-2026-09-24-74 BB-2).**',
    shapeIs: 'the grants read-back',
    shape: exactly([PATH_LINE, 'bash scripts/readback_function_grants.sh', 'unset DATABASE_URL']),
    required: [/^PASS: /m],
  },
  { anchor: 'The dry run. **Stop condition: the `WOULD APPLY` lines name exactly the migration', shapeIs: 'the dry run', shape: exactly(DRY_RUN), check: pendingZero },
  { anchor: '**1. The dry run.** The same command as the dry run at the top of this step', shapeIs: 'the dry run', shape: exactly(DRY_RUN), check: pendingZero },
  { anchor: '**5. The second dry run (R-2026-09-24-74 BB-1).**', shapeIs: 'the dry run', shape: exactly(DRY_RUN), check: pendingZero },
  {
    anchor: '**The ledger count and the pending count move together',
    shapeIs: 'the ledger count, then the dry run',
    shape: holds('select count(*) from app.schema_migrations', 'bash scripts/run_migrations.sh --dry-run'),
    check: pendingZero,
  },
  {
    anchor: "**5. On the 31st day after `withdrawn_on`, after 02:37 UTC, read the retention jobs'",
    shapeIs: "the retention jobs' runs, with the failed runs' return_message",
    shape: holds('d.return_message'),
    tolerate: (line, stream) => stream === 'stdout' && RETENTION_ROW.test(line),
  },
];

/** The corpus: every governed shell fence and every ```sql fence in `docs`, in document order. */
export function corpus(docs: readonly Doc[]): { fences: CorpusFence[]; errors: string[] } {
  const shell = shellFences(docs);
  const sqlF = sqlFences(docs);
  const fences: CorpusFence[] = [
    ...shell.fences.map((f) => ({ doc: f.doc, line: f.line, label: 'shell' as const, body: f.lines.map((l) => l.text).join('\n') })).filter((f) => isGoverned(f.body)),
    ...sqlF.fences.map((f) => ({ doc: f.doc, line: f.line, label: 'sql' as const, body: f.lines.map((l) => l.text).join('\n') })),
  ];
  const order = new Map(docs.map((d, i) => [d.doc, i]));
  fences.sort((a, b) => (order.get(a.doc) ?? 0) - (order.get(b.doc) ?? 0) || a.line - b.line);
  return { fences, errors: [...shell.errors, ...sqlF.errors] };
}

/** The fence an anchor keys: the first corpus fence after the one line that holds it. */
export function resolveAnchor(docs: readonly Doc[], fences: readonly CorpusFence[], anchor: string): { fence?: CorpusFence; error?: string } {
  const hits = docs.flatMap((d) => d.text.split('\n').flatMap((l, i) => (l.includes(anchor) ? [{ doc: d.doc, line: i + 1 }] : [])));
  if (hits.length === 0) return { error: `anchor "${anchor}" matches no line in the corpus, so it keys no fence` };
  if (hits.length > 1) return { error: `anchor "${anchor}" is on ${hits.length} lines (${hits.map(keyOf).join(', ')}), so it keys no one fence` };
  const hit = hits[0] as { doc: string; line: number };
  const fence = fences.find((f) => f.doc === hit.doc && f.line > hit.line);
  if (fence === undefined) return { error: `anchor "${anchor}" (${keyOf(hit)}) has no corpus fence after it` };
  return { fence };
}

export interface Partition {
  discovered: CorpusFence[];
  live: { fence: CorpusFence; name: string }[];
  excluded: { fence: CorpusFence; entry: Excluded }[];
  runHere: CorpusFence[];
  /** The expectation each RUN-HERE fence carries, by key. */
  expectation: Map<string, Expectation>;
  errors: string[];
}

/** Every corpus fence in exactly one set, or the reasons it is not. A pure function of `docs`. */
export function partition(docs: readonly Doc[], excluded: readonly Excluded[] = EXCLUDED, expectations: readonly Expectation[] = EXPECTATIONS): Partition {
  const { fences: discovered, errors } = corpus(docs);
  const byKey = new Map(discovered.map((f) => [keyOf(f), f]));
  const claimed = new Map<string, string>();
  const claim = (f: CorpusFence, by: string): boolean => {
    const prior = claimed.get(keyOf(f));
    if (prior !== undefined) {
      errors.push(`${keyOf(f)} is keyed twice, by ${prior} and by ${by}; each fence has its own anchor`);
      return false;
    }
    claimed.set(keyOf(f), by);
    return true;
  };

  const live: Partition['live'] = [];
  const supabase = docs.find((d) => d.doc === SUPABASE_DOC);
  if (supabase !== undefined) {
    for (const id of Object.keys(BLOCKS) as BlockId[]) {
      try {
        const { line } = commandFenceAt(supabase.text, id);
        const f = byKey.get(`${SUPABASE_DOC}:${line}`);
        if (f === undefined) errors.push(`LIVE ${BLOCKS[id].name}: its command fence at ${SUPABASE_DOC}:${line} is not in the corpus`);
        else if (claim(f, `LIVE ${BLOCKS[id].name}`)) live.push({ fence: f, name: BLOCKS[id].name });
      } catch (e) {
        errors.push(`LIVE: ${(e as Error).message}`);
      }
    }
  }

  const ex: Partition['excluded'] = [];
  for (const entry of excluded) {
    const r = resolveAnchor(docs, discovered, entry.anchor);
    if (r.error !== undefined) errors.push(`EXCLUDED: ${r.error}`);
    if (r.fence === undefined) continue;
    if (!entry.shape(r.fence)) errors.push(`EXCLUDED "${entry.anchor}" keys ${keyOf(r.fence)}, whose body is not ${entry.shapeIs}`);
    else if (claim(r.fence, `EXCLUDED "${entry.anchor}"`)) ex.push({ fence: r.fence, entry });
  }

  const runHere = discovered.filter((f) => !claimed.has(keyOf(f)));
  const expectation = new Map<string, Expectation>();
  for (const e of expectations) {
    const r = resolveAnchor(docs, discovered, e.anchor);
    if (r.error !== undefined) errors.push(`EXPECTATION: ${r.error}`);
    if (r.fence === undefined) continue;
    const k = keyOf(r.fence);
    if (claimed.has(k)) errors.push(`EXPECTATION "${e.anchor}" keys ${k}, which is ${claimed.get(k) ?? ''}, not RUN-HERE`);
    else if (expectation.has(k)) errors.push(`${k} is keyed twice, by expectation "${expectation.get(k)?.anchor ?? ''}" and by "${e.anchor}"; each fence has its own anchor`);
    else if (!e.shape(r.fence)) errors.push(`EXPECTATION "${e.anchor}" keys ${k}, whose body is not ${e.shapeIs}`);
    else expectation.set(k, e);
  }

  for (const f of runHere) {
    if (scriptShaped(f) && !expectation.has(keyOf(f))) {
      errors.push(`STOP: ${keyOf(f)} only runs a script ("${lines(f.body)[1] ?? ''}"), and EO-1 b does not name it: what it does to a database has not been ruled`);
    }
  }

  if (live.length === 0) errors.push('the LIVE set is empty');
  if (ex.length === 0) errors.push('the EXCLUDED set is empty');
  if (runHere.length === 0) errors.push('the RUN-HERE set is empty');
  return { discovered, live, excluded: ex, runHere, expectation, errors };
}

/**
 * The names the shell would expand in `body`, as `$X` or `${X`. Single-quoted text outside
 * double quotes, comments, and the bodies of QUOTED heredocs are skipped, because the shell
 * does not expand them; an unquoted heredoc's body is read, because it does.
 */
export function expandedNames(body: string): string[] {
  const names = new Set<string>();
  let heredoc: { word: string; quoted: boolean } | null = null;
  for (const line of body.split('\n')) {
    if (heredoc !== null) {
      if (line.trim() === heredoc.word) heredoc = null;
      else if (!heredoc.quoted) for (const m of line.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1] as string);
      continue;
    }
    let sq = false;
    let dq = false;
    let pending: { word: string; quoted: boolean } | null = null;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (sq) { if (c === "'") sq = false; continue; }
      if (c === '\\') { i += 1; continue; }
      if (c === "'" && !dq) { sq = true; continue; }
      if (c === '"') { dq = !dq; continue; }
      if (c === '#' && !dq && (i === 0 || /\s/.test(line[i - 1] ?? ''))) break;
      if (c === '<' && !dq && line[i + 1] === '<') {
        const m = /^<<-?\s*(?:(['"])(\w+)\1|\\(\w+)|(\w+))/.exec(line.slice(i));
        if (m !== null) pending = { word: (m[2] ?? m[3] ?? m[4]) as string, quoted: m[4] === undefined };
      }
      if (c === '$') {
        const m = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)/.exec(line.slice(i));
        if (m !== null) names.add(m[1] as string);
      }
    }
    if (pending !== null) heredoc = pending;
  }
  return [...names].sort();
}

/** The expanded names that are not DATABASE_URL, PATH or an inert value. */
export function unknownNames(body: string): string[] {
  return expandedNames(body).filter((n) => !ALLOWED_NAMES.has(n));
}

const RED = /ERROR|FATAL|WARNING|STOP|command not found|No such file/;

/** Every way one run is red, each naming its fence. */
export function classify(where: string, r: Run, exp?: Expectation): string[] {
  const out: string[] = [];
  for (const [stream, text] of [['stdout', r.stdout], ['stderr', r.stderr]] as const) {
    for (const line of text.split('\n')) {
      if (!RED.test(line)) continue;
      if (exp?.tolerate?.(line, stream) === true) continue;
      out.push(`${where}: a red line on ${stream}: ${line}`);
    }
  }
  const both = `${r.stdout}\n${r.stderr}`;
  for (const need of exp?.required ?? []) {
    if (!need.test(both)) out.push(`${where}: its required line ${String(need)} is missing`);
  }
  for (const word of exp?.forbidden ?? []) {
    if (both.includes(word)) out.push(`${where}: it printed "${word}", which its expectation forbids`);
  }
  for (const m of exp?.check?.(r) ?? []) out.push(`${where}: ${m}`);
  if (r.status === null) out.push(`${where}: the fence did not finish: it was killed or timed out`);
  return out;
}

/** The environment a fence runs in: an allowlist, never process.env. */
export function fenceBase(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '',
    LC_MESSAGES: 'C',
    HOME: home,
    PSQLRC: '/dev/null',
    DATABASE_URL: dbUrl(),
    PGOPTIONS: '-c lock_timeout=5s -c statement_timeout=20s',
    FACILITY_ID: INERT_FACILITY,
    PROBE: INERT_PROBE,
    APPLY_TS: 'now',
  };
  if (process.env['LANG'] !== undefined) env['LANG'] = process.env['LANG'];
  return env;
}

/** A ```sql fence runs through psql on stdin, under bash like every other fence. */
const script = (f: CorpusFence): string => (f.label === 'sql' ? `psql "$DATABASE_URL" <<'OPENBED_SQL_FENCE'\n${f.body}\nOPENBED_SQL_FENCE` : f.body);

/** One fence, through the whole pipeline: the name scan, the run, the classifier. */
function runOne(f: CorpusFence, exp: Expectation | undefined, base: NodeJS.ProcessEnv): { violations: string[]; run?: Run } {
  const where = keyOf(f);
  const unknown = unknownNames(script(f));
  if (unknown.length > 0) {
    return { violations: unknown.map((n) => `${where}: it expands $${n}, which is not DATABASE_URL, PATH or an inert value, so it was not run`) };
  }
  const r = runFence(script(f), {}, { base, cwd: REPO_ROOT });
  return { violations: classify(where, r, exp), run: r };
}

/**
 * NO FENCE RUNS OVER A BROKEN PARTITION. An EXCLUDED anchor that stopped matching drops its
 * fence into RUN-HERE, and that fence is a real apply or a call to hosted. Found by the
 * behavioural pass: a reworded 3240 anchor ran the quoted tamper statements.
 */
function runGated(p: Partition, f: CorpusFence, base: NodeJS.ProcessEnv): { violations: string[]; run?: Run } {
  if (p.errors.length > 0) return { violations: [`${keyOf(f)}: the partition has errors, so no fence is run: ${p.errors.join('; ')}`] };
  return runOne(f, p.expectation.get(keyOf(f)), base);
}

/** The nearest heading above a fence, to name it in a test. */
function headingOf(docs: readonly Doc[], f: CorpusFence): string {
  const text = docs.find((d) => d.doc === f.doc)?.text.split('\n') ?? [];
  for (let i = f.line - 2; i >= 0; i -= 1) if (/^#{1,6} /.test(text[i] ?? '')) return (text[i] ?? '').replace(/^#+ /, '').slice(0, 60);
  return '(no heading)';
}

/** The bracket's fingerprint: the shared one, plus auth.users, cron.job and two digest components. */
async function bracket(): Promise<Record<string, string>> {
  const db = sql();
  const [u] = await db<{ n: string }[]>`select count(*)::text as n from auth.users`;
  const [j] = await db<{ s: string }[]>`select coalesce(string_agg(j::text, E'\n' order by j.jobid), 'none') as s from cron.job j`;
  const d = await digest();
  return {
    ...(await fingerprint()),
    'auth.users count': u?.n ?? 'unread',
    'cron.job rows': j?.s ?? 'unread',
    'digest relations': d['relations'] ?? 'unread',
    'digest column_acl': d['column_acl'] ?? 'unread',
  };
}

/** A copy of `text` with `from` replaced by `to` inside the fence opening at `line` only. */
function plantInFence(text: string, line: number, from: string, to: string): string {
  const out = text.split('\n');
  let n = 0;
  for (let i = line; i < out.length && out[i]?.trim() !== '```'; i += 1) {
    const l = out[i] ?? '';
    if (l.includes(from)) { out[i] = l.split(from).join(to); n += l.split(from).length - 1; }
  }
  if (n !== 1) throw new Error(`the plant "${from}" landed ${n} times in the fence at line ${line}, not once`);
  return out.join('\n');
}

const DOCS = loadRunbooks(REPO_ROOT);
const REAL = partition(DOCS);
const HOME = mkdtempSync(join(tmpdir(), 'openbed-runbook-sql-home-'));
const BASE = fenceBase(HOME);
const REAL_BODIES = new Map(REAL.discovered.map((f) => [keyOf(f), f.body]));

beforeAll(() => {
  // FIRST, before anything runs: the fences and plants delete by id, and must never meet hosted.
  const u = new URL(dbUrl());
  expect(LOCAL_HOSTS.includes(u.hostname) && u.port === LOCAL_PORT, `DATABASE_URL is not the local stack (host ${u.hostname}, port ${u.port}): nothing here runs anywhere else`).toBe(true);
});

afterAll(() => rmSync(HOME, { recursive: true, force: true }));

describe('the partition of the runbooks\' psql and sql fences', () => {
  test('real runbooks: every fence is in exactly one of LIVE, EXCLUDED and RUN-HERE', () => {
    expect(REAL.errors, REAL.errors.join('\n')).toEqual([]);
    const sets = [REAL.live.map((x) => keyOf(x.fence)), REAL.excluded.map((x) => keyOf(x.fence)), REAL.runHere.map(keyOf)];
    const all = sets.flat();
    expect(new Set(all).size, 'a fence is in two sets').toBe(all.length);
    expect([...all].sort(), 'the union of the sets is not the discovered corpus').toEqual(REAL.discovered.map(keyOf).sort());
    for (const s of sets) expect(s.length, 'a set is empty').toBeGreaterThan(0);
    console.info([
      `discovered ${REAL.discovered.length}`,
      `LIVE ${REAL.live.length}: ${REAL.live.map((x) => `${x.name} (${keyOf(x.fence)})`).join('; ')}`,
      `EXCLUDED ${REAL.excluded.length}: ${REAL.excluded.map((x) => `"${x.entry.anchor}" (${keyOf(x.fence)}: ${x.entry.reason})`).join('; ')}`,
      `RUN-HERE ${REAL.runHere.length}: ${REAL.runHere.map((f) => `${keyOf(f)} [${REAL.expectation.get(keyOf(f))?.anchor ?? headingOf(DOCS, f)}]`).join('; ')}`,
    ].join('\n'));
  });

  test('every ```sql fence under docs/ is in a runbook the corpus reads', () => {
    const outside = sqlFences(docsUnder(REPO_ROOT)).fences.filter((f) => !RUNBOOKS.includes(f.doc)).map(keyOf);
    expect(outside, 'a ```sql fence sits outside the runbooks, where nothing runs or excludes it').toEqual([]);
  });

  test('every expectation keys a RUN-HERE fence', () => {
    expect(REAL.expectation.size, 'an expectation keyed nothing').toBe(EXPECTATIONS.length);
  });

  test('the fence environment is the allowlist and nothing else', () => {
    expect(Object.keys(BASE).sort()).toEqual(
      ['APPLY_TS', 'DATABASE_URL', 'FACILITY_ID', 'HOME', 'LC_MESSAGES', 'PATH', 'PGOPTIONS', 'PROBE', 'PSQLRC', ...(process.env['LANG'] !== undefined ? ['LANG'] : [])].sort(),
    );
  });

  test('plant — an expectation whose anchor matches no fence is rejected', () => {
    const p = partition(DOCS, EXCLUDED, [...EXPECTATIONS, { anchor: 'an anchor no runbook line holds', shapeIs: 'anything', shape: () => true }]);
    expect(p.errors).toEqual(['EXPECTATION: anchor "an anchor no runbook line holds" matches no line in the corpus, so it keys no fence']);
  });

  test('plant — an EXCLUDED key that matches no fence is rejected', () => {
    const p = partition(DOCS, [...EXCLUDED, { anchor: 'an anchor no runbook line holds', reason: 'none', shapeIs: 'anything', shape: () => true }]);
    expect(p.errors).toEqual(['EXCLUDED: anchor "an anchor no runbook line holds" matches no line in the corpus, so it keys no fence']);
  });

  test('plant — a script-shaped fence no entry names is a STOP', () => {
    const text = `${DOCS[0]?.text ?? ''}\n\n### A planted step\n\n\`\`\`bash\n${PATH_LINE}\nbash scripts/run_migrations.sh --dry-run\nunset DATABASE_URL\n\`\`\`\n`;
    const p = partition([{ doc: SUPABASE_DOC, text }, ...DOCS.slice(1)]);
    expect(p.errors.length, p.errors.join('\n')).toBe(1);
    expect(p.errors[0]).toContain('only runs a script ("bash scripts/run_migrations.sh --dry-run"), and EO-1 b does not name it');
  });

  test('a governed fence appended to a runbook lands in RUN-HERE unaided', () => {
    const text = `${DOCS[0]?.text ?? ''}\n\n### A planted step\n\n\`\`\`bash\n${PATH_LINE}\npsql "$DATABASE_URL" -tAc "select 1"\nunset DATABASE_URL\n\`\`\`\n`;
    const p = partition([{ doc: SUPABASE_DOC, text }, ...DOCS.slice(1)]);
    expect(p.errors).toEqual([]);
    expect(p.runHere.length).toBe(REAL.runHere.length + 1);
    expect(p.runHere.at(-1)?.body).toContain('psql "$DATABASE_URL" -tAc "select 1"');
  });

  test('anti-vacuity — the partition over an empty corpus fails', () => {
    const p = partition([]);
    expect(p.errors).toContain('the RUN-HERE set is empty');
    expect(p.errors).toContain('the LIVE set is empty');
  });

  test('the name scan skips quoted heredocs and single quotes, and reads unquoted heredocs', () => {
    expect(expandedNames("psql \"$A\" <<'SQL'\nselect $B$;\nSQL\necho '$C' \"${D}\" # $E\ncat <<EOF\n$F\nEOF")).toEqual(['A', 'D', 'F']);
  });

  test('4717\'s expectation tolerates a red word only in a retention job\'s return_message on stdout', () => {
    const exp = EXPECTATIONS.find((e) => e.anchor.startsWith('**5. On the 31st day'));
    expect(exp, "4717's expectation is gone").toBeDefined();
    const r: Run = { status: 0, stdout: 'openbed_erase_lapsed_ward_logins|2026-09-01 02:37:00+00|ERROR: the job failed\nsomething|else|ERROR: not a retention row', stderr: 'ERROR: on stderr' };
    expect(classify('x', r, exp)).toEqual(['x: a red line on stdout: something|else|ERROR: not a retention row', 'x: a red line on stderr: ERROR: on stderr']);
  });
});

let before: Record<string, string> = {};
let spawned = 0;

describe('the runbook\'s SQL, run live against the local stack, changes nothing', () => {
  beforeAll(async () => {
    await assertScheduledJobsPaused('the runbook SQL bracket');
    before = await bracket();
  });

  test('the inert values: FACILITY_ID is in no table that references app.facility, and PROBE is not in auth.users', async () => {
    const db = sql();
    const refs = await db<{ t: string; c: string }[]>`
      select format('%I.%I', n.nspname, c.relname) as t, format('%I', a.attname) as c
        from pg_constraint k
        join pg_class c on c.oid = k.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        join lateral unnest(k.conkey) as u(attnum) on true
        join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.attnum
       where k.contype = 'f' and k.confrelid = 'app.facility'::regclass
       order by 1, 2`;
    const searched = [{ t: 'app.facility', c: 'id' }, ...refs];
    expect(refs.length, 'no foreign key references app.facility: the inert check would search nothing').toBeGreaterThan(0);
    const found: string[] = [];
    for (const { t, c } of searched) {
      const [r] = await db.unsafe<{ n: number }[]>(`select count(*)::int as n from ${t} where ${c} = $1::uuid`, [INERT_FACILITY]);
      found.push(`${t}.${c}=${r?.n ?? 'unread'}`);
    }
    const [p] = await db<{ n: number }[]>`select count(*)::int as n from auth.users where email = ${INERT_PROBE}`;
    found.push(`auth.users.email=${p?.n ?? 'unread'}`);
    console.info(`inert checks: ${found.join(', ')}`);
    expect(found.filter((x) => !x.endsWith('=0')), 'an inert value is not inert: a fence would write a real row').toEqual([]);
  });

  test.each(REAL.runHere.map((f) => [keyOf(f), REAL.expectation.get(keyOf(f))?.anchor ?? headingOf(DOCS, f), f] as const))(
    'RUN-HERE %s [%s] runs clean',
    (_key, _name, f) => {
      const names = expandedNames(script(f));
      const { violations, run } = runGated(REAL, f, BASE);
      if (run !== undefined) spawned += 1;
      console.info(`${keyOf(f)} expands ${JSON.stringify(names)}\n${run === undefined ? '(not run)' : shown(run)}`);
      expect(violations, run === undefined ? violations.join('\n') : shown(run)).toEqual([]);
    },
    90_000,
  );

  test('bracket — the fingerprint after the last fence equals the one before the first', async () => {
    const after = await bracket();
    console.info(`bracket: ${Object.keys(after).length} components; tables ${Object.keys(after).filter((k) => /^\w+\.\w+$/.test(k)).length}`);
    expect(Object.keys(before).length, 'the bracket was never opened').toBeGreaterThan(10);
    expect(moved(before, after), 'a RUN-HERE fence changed these components').toEqual([]);
    expect(after).toEqual(before);
    expect(spawned, 'not every RUN-HERE fence was run').toBe(REAL.runHere.length);
  });
});

/** The one fence an anchor keys in `docs`, and the partition it sits in. */
function planted(text: string): { p: Partition; changed: CorpusFence[] } {
  const p = partition([{ doc: SUPABASE_DOC, text }, ...DOCS.slice(1)]);
  return { p, changed: p.discovered.filter((f) => REAL_BODIES.get(keyOf(f)) !== f.body) };
}

function fenceAt(anchor: string): CorpusFence {
  const r = resolveAnchor(DOCS, REAL.discovered, anchor);
  if (r.fence === undefined) throw new Error(r.error);
  return r.fence;
}

describe('plants: each runs only its planted fence, from a copy of the runbook', () => {
  test('plant — 897 reading app.facilityx is rejected, naming that fence alone', () => {
    const f = fenceAt('**HOW TO CHECK THE CONDITION, rather than remembering it.**');
    const { p, changed } = planted(plantInFence(DOCS[0]?.text ?? '', f.line, 'from app.facility)', 'from app.facilityx)'));
    expect(p.errors).toEqual([]);
    expect(changed.map(keyOf), 'the plant did not land in exactly that fence').toEqual([keyOf(f)]);
    const { violations, run } = runOne(changed[0] as CorpusFence, p.expectation.get(keyOf(f)), BASE);
    expect(violations.length, run === undefined ? '' : shown(run)).toBeGreaterThan(0);
    expect(violations.every((v) => v.startsWith(`${keyOf(f)}: `)), violations.join('\n')).toBe(true);
    expect(violations.join('\n')).toContain('relation "app.facilityx" does not exist');
  });

  test("plant — 3267 with its required line edited out is rejected", () => {
    const f = fenceAt('### The probe — run verbatim, connected with `DATABASE_URL` (step P first)');
    const { p, changed } = planted(plantInFence(DOCS[0]?.text ?? '', f.line, "'RESULT: BOTH LEGS PROVED ON THE HOSTED ROLE GRAPH'", "'RESULT: DONE'"));
    expect(p.errors).toEqual([]);
    expect(changed.map(keyOf), 'the plant did not land in exactly that fence').toEqual([keyOf(f)]);
    const { violations, run } = runOne(changed[0] as CorpusFence, p.expectation.get(keyOf(f)), BASE);
    expect(violations, run === undefined ? '' : shown(run)).toEqual([`${keyOf(f)}: its required line /RESULT: BOTH LEGS PROVED/ is missing`]);
  });

  test('plant — a fence expanding an unknown $NEW_VAR is rejected by name, and not run', () => {
    const f = fenceAt('**HOW TO CHECK THE CONDITION, rather than remembering it.**');
    const { p, changed } = planted(plantInFence(DOCS[0]?.text ?? '', f.line, '"select (select count(*) from app.facility)', '"select \'$NEW_VAR\', (select count(*) from app.facility)'));
    expect(p.errors).toEqual([]);
    expect(changed.map(keyOf), 'the plant did not land in exactly that fence').toEqual([keyOf(f)]);
    const { violations, run } = runOne(changed[0] as CorpusFence, p.expectation.get(keyOf(f)), BASE);
    expect(run, 'a fence with an unknown name was run').toBeUndefined();
    expect(violations).toEqual([`${keyOf(f)}: it expands $NEW_VAR, which is not DATABASE_URL, PATH or an inert value, so it was not run`]);
  });

  test('plant — a fence a reworded EXCLUDED anchor drops into RUN-HERE is not run', () => {
    const anchor = '### The SQL this step used to carry was a no-op, and that is observed';
    const f = fenceAt(anchor);
    const text = DOCS[0]?.text ?? '';
    const reworded = text.replace(anchor, '### The SQL this step used to carry was a no-op, as observed');
    expect(reworded, 'the plant did not land').not.toBe(text);
    const { p } = planted(reworded);
    expect(p.runHere.map(keyOf), 'the plant did not drop 3240 into RUN-HERE').toContain(keyOf(f));
    const { violations, run } = runGated(p, p.runHere.find((x) => keyOf(x) === keyOf(f)) as CorpusFence, BASE);
    expect(run, 'a fence was run over a broken partition').toBeUndefined();
    expect(violations.join('\n')).toContain(`${keyOf(f)}: the partition has errors, so no fence is run: EXCLUDED: anchor "${anchor}" matches no line in the corpus`);
  });

  test('a ```sql fence appended to a runbook lands in RUN-HERE and runs through psql', () => {
    const { p } = planted(`${DOCS[0]?.text ?? ''}\n\n### A planted step\n\n\`\`\`sql\nselect 1 as planted_one;\n\`\`\`\n`);
    expect(p.errors).toEqual([]);
    const f = p.runHere.at(-1) as CorpusFence;
    expect(f.label).toBe('sql');
    const { violations, run } = runOne(f, undefined, BASE);
    expect(violations, run === undefined ? '' : shown(run)).toEqual([]);
    expect(run?.stdout).toContain('planted_one');
  });
});

describe('the write plant: the bracket sees a real delete', () => {
  test('plant — 4744 run against a fixture moves app.facility_contact, and the fixture leaves nothing behind', async () => {
    const db = sql();
    const first = await bracket();
    try {
      await db`insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164)
               values (${PLANT_FACILITY}::uuid, 'Runbook SQL Write Plant', 'Yaba', 'Lagos', 6.51, 3.38, '+2348000001651')`;
      await db`insert into app.facility_contact (facility_id, full_name, job_title, email)
               values (${PLANT_FACILITY}::uuid, 'Synthetic Contact', 'Medical Director', 'contact@example.invalid')`;
      const second = await bracket();
      const f = fenceAt("**1. Delete the facility's contact row.**");
      expect(f.body).toContain('delete from app.facility_contact');
      const r = runFence(f.body, {}, { base: { ...BASE, FACILITY_ID: PLANT_FACILITY }, cwd: REPO_ROOT });
      expect(r.stderr, shown(r)).toBe('');
      const third = await bracket();
      expect(moved(second, third), `the fingerprint did not see the delete\n${shown(r)}`).toContain('app.facility_contact');
    } finally {
      await db`delete from app.facility_contact where facility_id = ${PLANT_FACILITY}::uuid`;
      await db`delete from app.facility where id = ${PLANT_FACILITY}::uuid`;
    }
    const last = await bracket();
    expect(moved(first, last), 'the fixture left something behind').toEqual([]);
    expect(last).toEqual(first);
  });
});
