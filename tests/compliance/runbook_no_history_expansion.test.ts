import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { DOCS, docsUnder, shellFences, type Doc, type ShellLine } from './_fences.js';
import { REPO_ROOT, place, withScratch } from './_scratch.js';

/**
 * NO SHELL BLOCK IN docs/ HOLDS A "!" (R-2026-09-28-148 DX-2).
 *
 * THE DEFECT, observed on hosted run 1 of "025 and 026's apply" (2026-09-28, the
 * founder's terminal, relayed by Cowork). Fence A's second reading held `email !~ '…'`
 * inside a double-quoted `psql -tAc` string. The founder's shell is zsh, with history
 * expansion on, and a pasted `!` is rewritten BEFORE the line runs: `!~` became a word
 * from the shell's history, and psql raised a syntax error. Nothing was written, because
 * the reading only reads. What the block said was not what ran.
 *
 * WHAT ZSH DOES, read in `zsh -f -i` on 2026-09-28 (Claude Code, local):
 *   - `echo "a !~ b"` printed `zsh: event not found: ~`. Double quotes do not protect.
 *   - `echo 'c !~ d'` printed `c !~ d`. Single quotes do.
 *   - `# note !~ f` printed `zsh: event not found: ~` with `interactivecomments` off,
 *     which is zsh's default. A `#` line is not a comment there, so a `!` in it is
 *     expanded like any other. With `interactivecomments` on, it was not.
 *
 * THE RULE: no line of a shell fence (```bash, ```sh, ```shell or ```zsh, at any
 * indentation) in any .md under docs/, at any depth, contains `!`. Nothing is exempt
 * by position:
 *   - NOT A COMMENT LINE. DX-2 as issued exempted "a comment". The reading above shows a
 *     pasted `#` line is expanded in a default zsh. The runbook already forbids `#` in a
 *     bash block for the same reason ("Every bash block in this runbook holds commands
 *     only"). An exemption would exempt a line the runbook forbids, and it could hide a
 *     live `!`.
 *   - NOT SINGLE QUOTES. They do protect, but "inside single quotes" is a parse of shell
 *     quoting, and a guard that parses quoting fails open on the first quote it gets
 *     wrong. The rule stays one character. A block that genuinely needs `!` goes in ALLOW
 *     below, with its reason. ALLOW is empty today.
 *
 * WHY EVERY SHELL LABEL AND NOT ONLY bash. DX-2 names ```bash blocks, and today every
 * shell fence under docs/ is labelled bash. A fence labelled sh or zsh would be pasted
 * the same way, and a guard over `bash` alone would pass it silently
 * (test-conventions section 2(d)). Each label has its own plant below.
 *
 * THE FENCE READER is tests/compliance/_fences.ts, shared since R-2026-09-28-150 DZ-3 with
 * tests/compliance/runbook_read_pasted_alone.test.ts. It keeps
 * tests/compliance/runbook_psql_path.test.ts's rule: indent-tolerant, and a fence closes
 * only at a marker with its opening indent. A fence that never closes is a violation, not
 * a silent end. This file had its own copy until then; it moved unchanged, and every leg
 * below reads the same corpus through it.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - fences with no label, or with any other label (24 unlabelled and 4 sql or text
 *     today, none holding `!`). They are shown output or SQL, not pasted into a shell.
 *     A label is the document's own statement of which blocks are for pasting, and
 *     reading every fence would make a quoted output line a violation.
 *   - shell fences outside docs/. DX-2 scopes docs/, and the runbooks live there. A
 *     README fence is a note, not a step someone pastes during a hosted run.
 *   - that the founder's shell HAS history expansion on. It is zsh's default, and the
 *     founder's run on 2026-09-28 shows it on (the founder's output, read and relayed by
 *     Cowork). No file in this repository can read a shell's options, and the rule holds
 *     either way.
 */

/** A line that genuinely needs `!`, by its document and its exact trimmed text, and why. */
export interface Allowed {
  doc: string;
  text: string;
  reason: string;
}

/** Empty today (DX-2: "there is none today"). An entry needs a reason, and must match a line. */
export const ALLOW: readonly Allowed[] = [];

/** Every line inside a shell fence, 1-indexed in its document, and every fence that never closed. */
export function shellLines(docs: readonly Doc[]): { lines: ShellLine[]; fences: number; errors: string[] } {
  const { fences, errors } = shellFences(docs);
  return { lines: fences.flatMap((f) => f.lines), fences: fences.length, errors };
}

/** Everything wrong with a corpus under an allow-list, parse failures first. */
export function bangViolations(docs: readonly Doc[], allow: readonly Allowed[]): string[] {
  const { lines, fences, errors } = shellLines(docs);
  const out = [...errors];
  if (fences === 0) out.push('no shell fence found under docs/: a guard over nothing is not a pass');
  for (const a of allow) {
    if (a.reason.trim() === '') out.push(`allow-list entry for ${a.doc} "${a.text}" has no reason`);
  }
  const used = new Set<Allowed>();
  for (const l of lines) {
    if (!l.text.includes('!')) continue;
    const hit = allow.find((a) => a.doc === l.doc && a.text === l.text.trim());
    if (hit !== undefined) {
      used.add(hit);
      continue;
    }
    out.push(`${l.doc}:${l.line}: "!" in a shell block: zsh's history expansion rewrites it when the line is pasted (R-2026-09-28-148 DX): ${l.text.trim().slice(0, 120)}`);
  }
  for (const a of allow) {
    if (!used.has(a)) out.push(`allow-list entry for ${a.doc} "${a.text}" matches no shell line holding "!": remove it`);
  }
  return out;
}

const REAL = docsUnder(REPO_ROOT);
const RUNBOOK = join(DOCS, 'runbook-supabase-project-creation.md');
const FENCE_A_READING = "and not (email ~ '^[^@[:space:]]+@[^@[:space:]]+$')";
const OBSERVED_FORM = "and email !~ '^[^@[:space:]]+@[^@[:space:]]+$'";

/** The real corpus with one document's text replaced, and proof that the replacement landed. */
function plantInReal(doc: string, from: string, to: string): Doc[] {
  const target = REAL.find((d) => d.doc === doc);
  expect(target, `${doc} is not in the corpus`).toBeDefined();
  // A function replacer, never a string: `to` may end `$'`, which a replacement STRING
  // reads as "the text after the match" -- the first version of this plant inserted the
  // rest of the runbook, and its line lookup found nothing.
  const planted = (target as Doc).text.replace(from, () => to);
  expect(planted, `the plant did not change ${doc}: "${from}" not found`).not.toBe((target as Doc).text);
  return REAL.map((d) => (d.doc === doc ? { doc, text: planted } : d));
}

const fence = (label: string, body: string, indent = ''): string =>
  `Prose, with a ! outside any fence.\n\n${indent}\`\`\`${label}\n${body
    .split('\n')
    .map((l) => indent + l)
    .join('\n')}\n${indent}\`\`\`\n`;

describe('no shell block in docs/ holds a "!" (zsh history expansion)', () => {
  test('real docs/ is accepted — no shell line holds "!", and ALLOW is empty', () => {
    const out = bangViolations(REAL, ALLOW);
    expect(out, out.join('\n')).toEqual([]);
    expect(ALLOW).toEqual([]);
  });

  test('anti-vacuity — the reader finds the shell fences in every runbook that has them, and an empty docs/ fails', () => {
    const { fences, lines } = shellLines(REAL);
    const withFences = [...new Set(lines.map((l) => l.doc))].sort();
    expect(fences, `fences read: ${fences}`).toBeGreaterThan(0);
    expect(withFences).toEqual([
      join(DOCS, 'runbook-admin-deploy.md'),
      join(DOCS, 'runbook-cloudflare-pages-beds-json.md'),
      join(DOCS, 'runbook-cloudflare-worker-proxy.md'),
      join(DOCS, 'runbook-key-rotation.md'),
      // R-2026-09-30-175 EY-4: the sensor runbook holds shell fences, and none holds a "!".
      join(DOCS, 'runbook-sensor.md'),
      join(DOCS, 'runbook-supabase-project-creation.md'),
      join(DOCS, 'runbook-ward-console-deploy.md'),
    ]);
    const out = withScratch((root) => {
      place(root, join(DOCS, 'README.md'), 'No fences here.\n');
      return bangViolations(docsUnder(root), []);
    });
    expect(out.join('\n')).toContain('no shell fence found under docs/: a guard over nothing is not a pass');
  });

  test('the known-present control — fence A\'s second reading, a line in a shell fence, is the not (email ~ …) form with no "!"', () => {
    // Read from the SHELL LINES, not the whole document: the runbook's prose names `!~`
    // on purpose, to say why it is not used.
    const reading = shellLines(REAL.filter((d) => d.doc === RUNBOOK)).lines.filter((l) => l.text.includes('from app.facility_contact where email is not null'));
    expect(reading.map((l) => l.text), 'fence A\'s second reading is not in a shell fence exactly once').toHaveLength(1);
    expect(reading[0]?.text).toContain(FENCE_A_READING);
    expect(reading[0]?.text).not.toContain('!');
  });

  test('plant — the observed line, fence A\'s second reading with !~ inside double quotes, is rejected with its line', () => {
    const planted = plantInReal(RUNBOOK, FENCE_A_READING, OBSERVED_FORM);
    const out = bangViolations(planted, ALLOW);
    const line = (planted.find((d) => d.doc === RUNBOOK) as Doc).text.split('\n').findIndex((l) => l.includes(OBSERVED_FORM)) + 1;
    expect(out, out.join('\n')).toHaveLength(1);
    expect(out[0]).toContain(`${RUNBOOK}:${line}: "!" in a shell block: zsh's history expansion rewrites it`);
  });

  test.each([
    ['a "!" on a "#" line (a default zsh expands it)', 'bash', '# check !~ here'],
    ['a "!" inside single quotes', 'bash', "psql -tAc 'select 1 where not true != false'"],
    ['a bare "!" negation', 'bash', 'if ! true; then echo no; fi'],
    ['a "!" in a fence labelled sh', 'sh', 'echo "a !~ b"'],
    ['a "!" in a fence labelled shell', 'shell', 'echo "a !~ b"'],
    ['a "!" in a fence labelled zsh', 'zsh', 'echo "a !~ b"'],
  ])('plant — %s is rejected', (_name, label, body) => {
    const out = withScratch((root) => {
      place(root, join(DOCS, 'runbook-x.md'), fence(label, `export PATH="/x:$PATH"\n${body}`));
      return bangViolations(docsUnder(root), []);
    });
    expect(out.join('\n')).toContain(`${join(DOCS, 'runbook-x.md')}:5: "!" in a shell block`);
  });

  test('plant — a "!" in an indented fence inside a list item, and in a nested docs/ directory, is rejected', () => {
    const out = withScratch((root) => {
      place(root, join(DOCS, 'legal', 'nested.md'), `1. A step:\n\n${fence('bash', 'echo "a !~ b"', '   ')}`);
      return bangViolations(docsUnder(root), []);
    });
    expect(out.join('\n')).toContain(`${join(DOCS, 'legal', 'nested.md')}:6: "!" in a shell block`);
  });

  test('plant — a shell fence that never closes is rejected', () => {
    const out = withScratch((root) => {
      place(root, join(DOCS, 'runbook-x.md'), 'Step.\n\n```bash\necho one\n');
      return bangViolations(docsUnder(root), []);
    });
    expect(out.join('\n')).toContain(`${join(DOCS, 'runbook-x.md')}:3: a shell fence that never closes`);
  });

  test('the most ordinary valid input is accepted — a PATH line and a psql reading, a "!" in prose, and one in a sql fence', () => {
    const out = withScratch((root) => {
      place(
        root,
        join(DOCS, 'runbook-x.md'),
        `${fence('bash', `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"\npsql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "select count(*) from t where not (x ~ 'y')"`)}\n\`\`\`sql\nselect 1 where 1 != 2;\n\`\`\`\n`,
      );
      return bangViolations(docsUnder(root), []);
    });
    expect(out, out.join('\n')).toEqual([]);
  });

  test('the allow-list — an entry with a reason admits its line; an entry with no reason, and one that matches nothing, are rejected', () => {
    const doc = join(DOCS, 'runbook-x.md');
    const run = (allow: Allowed[]): string[] =>
      withScratch((root) => {
        place(root, join(DOCS, 'runbook-x.md'), fence('bash', "echo 'needs !'"));
        return bangViolations(docsUnder(root), allow);
      });
    expect(run([{ doc, text: "echo 'needs !'", reason: 'single-quoted, so zsh does not expand it' }])).toEqual([]);
    expect(run([{ doc, text: "echo 'needs !'", reason: ' ' }]).join('\n')).toContain(`allow-list entry for ${doc} "echo 'needs !'" has no reason`);
    expect(run([
      { doc, text: "echo 'needs !'", reason: 'single-quoted' },
      { doc, text: 'echo gone !', reason: 'stale' },
    ]).join('\n')).toContain(`allow-list entry for ${doc} "echo gone !" matches no shell line holding "!": remove it`);
  });
});
