import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * THE SHELL FENCES UNDER docs/, READ ONE WAY (shared by the runbook guards that read what a
 * founder pastes: tests/compliance/runbook_no_history_expansion.test.ts and
 * tests/compliance/runbook_read_pasted_alone.test.ts).
 *
 * A helper module and not a test file, because importing a test file makes vitest run that
 * file's tests again inside the importer. The rule it keeps, from
 * tests/compliance/runbook_psql_path.test.ts's reader: indent-tolerant, and a fence closes
 * only at a marker with its opening indent, so a fence inside a list item closes where it
 * actually closes. A fence that never closes is reported, never a silent end.
 *
 * THE SHELL LABELS ARE bash, sh, shell AND zsh. Every shell fence under docs/ is labelled
 * bash today; a fence with another shell label would be pasted the same way, so a guard over
 * bash alone would pass it silently (test-conventions section 2(d)).
 *
 * THE ```sql READER (R-2026-09-29-165, EO-1 a) walks the same way with the one label sql, for
 * tests/db/runbook_sql_live.test.ts: a sql fence is not pasted into a shell, so it is not a
 * shell fence, and the shell readers never see it.
 *
 * THE RUNBOOK psql READER, moved here from tests/compliance/runbook_psql_path.test.ts in the
 * same change so that tests/db/runbook_sql_live.test.ts reads the same corpus without
 * importing a test file: RUNBOOKS, loadRunbooks(), bashFences(), PSQL_SCRIPTS and isGoverned().
 */

export const DOCS = 'docs';
export const SHELL_LABELS = ['bash', 'sh', 'shell', 'zsh'] as const;
const OPEN = new RegExp(`^(\\s*)\`\`\`(${SHELL_LABELS.join('|')})\\s*$`);
const OPEN_SQL = /^(\s*)```(sql)\s*$/;

export interface Doc {
  doc: string;
  text: string;
}

/** Every .md under `<root>/docs`, at any depth, sorted, with its path relative to root. */
export function docsUnder(root: string): Doc[] {
  const out: Doc[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.md')) out.push({ doc: relative(root, p), text: readFileSync(p, 'utf8') });
    }
  };
  walk(join(root, DOCS));
  return out;
}

export interface ShellLine {
  doc: string;
  line: number;
  text: string;
}

export interface ShellFence {
  doc: string;
  /** 1-indexed line of the opening fence marker. */
  line: number;
  /** The fence's lines, each with its 1-indexed line in the document, dedented by the opening indent. */
  lines: ShellLine[];
}

/** Every fence whose opening marker `open` matches, in document order, and every one that never closed. */
function labelledFences(docs: readonly Doc[], open: RegExp, kind: string): { fences: ShellFence[]; errors: string[] } {
  const fences: ShellFence[] = [];
  const errors: string[] = [];
  for (const { doc, text } of docs) {
    let cur: { indent: string; line: number; lines: ShellLine[] } | null = null;
    text.split('\n').forEach((raw, i) => {
      if (cur === null) {
        const m = open.exec(raw);
        if (m !== null) cur = { indent: m[1] ?? '', line: i + 1, lines: [] };
        return;
      }
      if (raw.trimEnd() === `${cur.indent}\`\`\``) {
        fences.push({ doc, line: cur.line, lines: cur.lines });
        cur = null;
        return;
      }
      cur.lines.push({ doc, line: i + 1, text: raw.startsWith(cur.indent) ? raw.slice(cur.indent.length) : raw });
    });
    if (cur !== null) {
      const at: number = (cur as { line: number }).line;
      errors.push(`${doc}:${at}: a ${kind} fence that never closes: every line after it would be read as ${kind === 'shell' ? 'shell' : 'SQL'}, or a reader would stop reading`);
    }
  }
  return { fences, errors };
}

/** Every shell fence, in document order, and every fence that never closed. */
export function shellFences(docs: readonly Doc[]): { fences: ShellFence[]; errors: string[] } {
  return labelledFences(docs, OPEN, 'shell');
}

/** Every ```sql fence, in document order, and every one that never closed. */
export function sqlFences(docs: readonly Doc[]): { fences: ShellFence[]; errors: string[] } {
  return labelledFences(docs, OPEN_SQL, 'sql');
}

/**
 * THE RUNBOOKS WHOSE psql BLOCKS ARE GOVERNED, by tests/compliance/runbook_psql_path.test.ts
 * and run by tests/db/runbook_sql_live.test.ts.
 */
export const RUNBOOKS: readonly string[] = [
  join('docs', 'runbook-supabase-project-creation.md'),
  join('docs', 'runbook-cloudflare-pages-beds-json.md'),
  // PR 3.4b-app C (R-2026-09-24-88 BP-11): the admin deploy runbook's psql blocks carry
  // step P's line too. It holds none today; it is in the corpus so the next one is held.
  join('docs', 'runbook-admin-deploy.md'),
  // W2 (R-2026-09-30-175 EY-4): the sensor runbook. Its psql blocks are the probe read, the
  // jobs read, the drill's pause and restore, and the restore read-back.
  join('docs', 'runbook-sensor.md'),
];

/** The named docs under `root`, read, in the order given. */
export function loadRunbooks(root: string, docs: readonly string[] = RUNBOOKS): Doc[] {
  return docs.map((doc) => ({ doc, text: readFileSync(join(root, doc), 'utf8') }));
}

export interface Fence {
  /** Which runbook it came from. */
  doc: string;
  /** 1-indexed line of the opening ```bash. */
  line: number;
  /** The fence's body, dedented by its own opening indent. */
  body: string;
}

/**
 * Every ```bash fence in a document, at any indentation.
 *
 * The closing marker must match the OPENING indent, so a nested fence inside a
 * list item closes where it actually closes rather than at the first ``` found.
 */
export function bashFences(doc: string, text: string): Fence[] {
  const lines = text.split('\n');
  const out: Fence[] = [];
  let open: { indent: string; line: number } | null = null;
  let buf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = /^(\s*)```bash\s*$/.exec(line);
    if (open === null) {
      if (m !== null) { open = { indent: m[1] ?? '', line: i + 1 }; buf = []; }
      continue;
    }
    if (line === `${open.indent}\`\`\`` || line.trimEnd() === `${open.indent}\`\`\``) {
      out.push({ doc, line: open.line, body: buf.map((l) => l.slice(open?.indent.length ?? 0)).join('\n') });
      open = null;
      continue;
    }
    buf.push(line);
  }
  return out;
}

/**
 * The scripts that call `psql` themselves, so a fence running one needs the PATH line
 * as much as a fence calling psql directly. scripts/readback_public_output.sh joined
 * on 2026-09-24 (R-2026-09-24-73 BA-2): its two fences in step 5 carried the line, and
 * the guard did not know they had to. Widened by name, with a plant.
 * scripts/readback_function_grants.sh joined the same way on 2026-09-24 (R-2026-09-24-74
 * BB-2), for fence 6.
 */
export const PSQL_SCRIPTS = /(run_migrations|readback_public_output|readback_function_grants)\.sh/;

/** A fence is GOVERNED when running it needs `psql` on PATH. */
export function isGoverned(body: string): boolean {
  return /(^|[\s|(])psql\s/m.test(body) || PSQL_SCRIPTS.test(body);
}
