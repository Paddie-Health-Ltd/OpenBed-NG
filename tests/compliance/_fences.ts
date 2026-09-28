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
 */

export const DOCS = 'docs';
export const SHELL_LABELS = ['bash', 'sh', 'shell', 'zsh'] as const;
const OPEN = new RegExp(`^(\\s*)\`\`\`(${SHELL_LABELS.join('|')})\\s*$`);

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

/** Every shell fence, in document order, and every fence that never closed. */
export function shellFences(docs: readonly Doc[]): { fences: ShellFence[]; errors: string[] } {
  const fences: ShellFence[] = [];
  const errors: string[] = [];
  for (const { doc, text } of docs) {
    let open: { indent: string; line: number; lines: ShellLine[] } | null = null;
    text.split('\n').forEach((raw, i) => {
      if (open === null) {
        const m = OPEN.exec(raw);
        if (m !== null) open = { indent: m[1] ?? '', line: i + 1, lines: [] };
        return;
      }
      if (raw.trimEnd() === `${open.indent}\`\`\``) {
        fences.push({ doc, line: open.line, lines: open.lines });
        open = null;
        return;
      }
      open.lines.push({ doc, line: i + 1, text: raw.startsWith(open.indent) ? raw.slice(open.indent.length) : raw });
    });
    if (open !== null) {
      const at: number = (open as { line: number }).line;
      errors.push(`${doc}:${at}: a shell fence that never closes: every line after it would be read as shell, or a reader would stop reading`);
    }
  }
  return { fences, errors };
}
