import { spawnSync } from 'node:child_process';
import { shellFences } from '../compliance/_fences.js';
import { sql } from './db.js';
import { dbUrl } from './local-keys.js';

/**
 * THE RUNBOOK'S COMMAND FENCES, LOCATED, RUN AND READ ONE WAY (R-2026-09-29-165, EO-1 a).
 *
 * Moved verbatim from tests/db/runbook_12_4_12_5_sql_live.test.ts, which imports them, so
 * that tests/db/runbook_sql_live.test.ts locates the same five blocks, runs every fence the
 * same way and fingerprints the same tables. commandFenceAt() is new: it returns the fence's
 * line as well as its body, which is how the second file names the five it leaves to the first.
 *
 * A helper module and not a test file, because importing a test file makes vitest run that
 * file's tests again inside the importer.
 *
 * A FENCE'S EXIT STATUS IS ITS unset's, so it says nothing: a refused psql line is followed
 * by the read-back and the unset, and the fence exits 0. An error is read from what the
 * fence PRINTS.
 */

const DOC = 'docs/runbook-supabase-project-creation.md';

/** One runbook block: the step it sits under, and what its fences must hold. */
export interface Block {
  name: string;
  /** The section heading the step sits under. */
  section: string;
  /** The step's own words, which open it. */
  anchor: string;
  /** The variables its connection fence reads, in order. */
  reads: readonly string[];
  /** How many psql lines its command fence runs. */
  psql: number;
}

export const BLOCKS = {
  '6a': { name: '12.4 step 6a', section: '### 12.4 Creating a facility', anchor: "6a. **A ward's login.**", reads: ['DATABASE_URL', 'WARD_USER_ID', 'CATEGORY'], psql: 1 },
  '6b': { name: '12.4 step 6b', section: '### 12.4 Creating a facility', anchor: "6b. **The facility's login**", reads: ['DATABASE_URL', 'REPORTER_USER_ID'], psql: 1 },
  '12.5-1': { name: '12.5 step 1', section: '### 12.5 Withdrawing an agreement', anchor: '**1. Set `withdrawn_on`.**', reads: ['FACILITY_ID', 'DATABASE_URL'], psql: 2 },
  '12.5-2': { name: '12.5 step 2', section: '### 12.5 Withdrawing an agreement', anchor: "**2. Deactivate the facility's ward accounts.**", reads: ['FACILITY_ID', 'DATABASE_URL'], psql: 2 },
  '12.5-3': { name: '12.5 step 3', section: '### 12.5 Withdrawing an agreement', anchor: '**3. Clear `listed_at`**', reads: ['FACILITY_ID', 'DATABASE_URL'], psql: 2 },
  // 029 (R-2026-09-30-201 GA): the founder SQL under 12.4's "Changing a facility's reporting model". It sits
  // under 12.4's heading because the procedure's own heading is a level-four heading, which does not end 12.4.
  '12.4-switch-2': {
    name: "12.4 changing a facility's reporting model, step 2",
    section: '### 12.4 Creating a facility',
    anchor: '**2. Deactivate the logins of the kind being replaced.**',
    reads: ['FACILITY_ID', 'LOGIN_KIND', 'DATABASE_URL'],
    psql: 2,
  },
} as const satisfies Record<string, Block>;
export type BlockId = keyof typeof BLOCKS;

/**
 * The command fence of one block, located in `text` by its section and anchor: the first
 * shell fence after the anchor is the connection line, which must read exactly the
 * block's variables; the next is the command fence, which must run exactly its psql
 * lines and end in their unset. Anything else throws, naming the block, so a block that
 * moved or changed shape fails here rather than testing nothing. `line` is the command
 * fence's opening line in `text`.
 */
export function commandFenceAt(text: string, id: BlockId): { line: number; body: string } {
  const b: Block = BLOCKS[id];
  const lines = text.split('\n');
  const section = lines.findIndex((l) => l.trim() === b.section);
  if (section < 0) throw new Error(`${b.name}: the runbook has no "${b.section}" heading`);
  const next = lines.findIndex((l, i) => i > section && /^#{1,3} /.test(l));
  const end = next < 0 ? lines.length : next;
  const anchor = lines.findIndex((l, i) => i > section && i < end && l.includes(b.anchor));
  if (anchor < 0) throw new Error(`${b.name}: "${b.anchor}" is not under "${b.section}"`);
  const { fences, errors } = shellFences([{ doc: DOC, text }]);
  if (errors.length > 0) throw new Error(`${b.name}: ${errors.join('; ')}`);
  const after = fences.filter((f) => f.line > anchor + 1 && f.line <= end);
  const [conn, cmd] = after;
  if (conn === undefined || cmd === undefined) throw new Error(`${b.name}: fewer than two shell fences follow "${b.anchor}"`);
  const read = conn.lines.map((l) => l.text).join('\n');
  const vars = [...read.matchAll(/\bread -rs? (\w+)/g)].map((m) => m[1]);
  if (JSON.stringify(vars) !== JSON.stringify(b.reads)) {
    throw new Error(`${b.name}: its connection fence (${DOC}:${conn.line}) reads ${JSON.stringify(vars)}, not ${JSON.stringify(b.reads)}`);
  }
  const body = cmd.lines.map((l) => l.text);
  const psql = body.filter((l) => /\bpsql\b/.test(l));
  if (psql.length !== b.psql) throw new Error(`${b.name}: its command fence (${DOC}:${cmd.line}) runs ${psql.length} psql line(s), not ${b.psql}`);
  const last = body.filter((l) => l.trim() !== '').at(-1) ?? '';
  if (!/^unset /.test(last)) throw new Error(`${b.name}: its command fence (${DOC}:${cmd.line}) does not end in its unset`);
  return { line: cmd.line, body: body.join('\n') };
}

/** The command fence's body alone: what the 12.4 and 12.5 test runs. */
export function commandFence(text: string, id: BlockId): string {
  return commandFenceAt(text, id).body;
}

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run a command fence verbatim under bash, with the values its connection line reads.
 *
 * `base` is the environment the fence's own values are laid over. It defaults to
 * process.env, which is what the 12.4 and 12.5 test has always run with;
 * tests/db/runbook_sql_live.test.ts passes an allowlist instead, so nothing the developer's
 * shell exports reaches a fence. `cwd` defaults to the process's own.
 */
export function runFence(fence: string, env: Record<string, string>, opts: { base?: NodeJS.ProcessEnv; cwd?: string } = {}): Run {
  const r = spawnSync('bash', ['-c', fence], { env: { ...(opts.base ?? process.env), DATABASE_URL: dbUrl(), ...env }, cwd: opts.cwd, encoding: 'utf8', timeout: 60_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export const shown = (r: Run): string => `exit ${String(r.status)}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`;

/** psql's aligned output, as the result tables it printed and the command tags between them. */
export interface Table {
  columns: string[];
  rows: string[][];
}
export function tables(out: string): { tables: Table[]; tags: string[] } {
  const lines = out.split('\n');
  const found: Table[] = [];
  const tags: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^-+(\+-+)*$/.test(lines[i + 1] ?? '') && l.trim() !== '') {
      const columns = l.split('|').map((c) => c.trim());
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < lines.length && !/^\(\d+ rows?\)$/.test(lines[j]!); j++) rows.push(lines[j]!.split('|').map((c) => c.trim()));
      found.push({ columns, rows });
      i = j;
    } else if (/^[A-Z]+( \d+)*$/.test(l.trim())) {
      tags.push(l.trim());
    }
  }
  return { tables: found, tags };
}

/** Every base table in app, and the three public mirrors, each as a digest of its rows. */
export async function fingerprint(): Promise<Record<string, string>> {
  const db = sql();
  const names = await db<{ t: string }[]>`
    select format('%I.%I', table_schema, table_name) as t from information_schema.tables
     where table_type = 'BASE TABLE'
       and (table_schema = 'app' or (table_schema = 'public' and table_name in ('facility_public', 'ward_public', 'lga_rollup')))
     order by 1`;
  if (names.length < 10) throw new Error(`the fingerprint found ${names.length} tables: it would compare almost nothing`);
  const out: Record<string, string> = {};
  for (const { t } of names) {
    const [r] = await db.unsafe<{ d: string }[]>(`select count(*) || ':' || coalesce(md5(string_agg(x::text, E'\\n' order by x::text)), '') as d from ${t} x`);
    out[t] = r!.d;
  }
  return out;
}
