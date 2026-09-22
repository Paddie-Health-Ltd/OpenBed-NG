import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';

/**
 * EVERY RUNBOOK BLOCK THAT NEEDS `psql` CARRIES STEP P'S PATH LINE ITSELF
 * (R-2026-09-22-52).
 *
 * THE DEFECT THIS CLOSES, observed rather than imagined. On 2026-09-22, applying
 * migration 018 to hosted, the founder pasted step 5's pre-apply block into a fresh
 * shell and got `zsh: command not found: psql` -- twice, before any database was
 * read. Nothing reached the database and nothing was at risk. What is worth fixing
 * is that the failure came from the shell rather than from this project:
 * `scripts/run_migrations.sh` carries a named stop condition for exactly this case
 * ("psql not on PATH. Install postgresql-client, or set OPENBED_PSQL."), and the
 * block that failed is one of the many that call `psql` DIRECTLY, bypassing it.
 *
 * THE RULE IS THE ONE THE RUNBOOK ALREADY APPLIES TO CREDENTIALS -- each block
 * reads what it needs itself rather than inheriting it from an earlier step --
 * extended to the other thing a pasted block inherits from its shell. Step P keeps
 * the version check and the explanation; the blocks carry the one line.
 *
 * THE EXPECTED LINE IS DERIVED FROM STEP P, NEVER WRITTEN HERE. Hard-coding
 * `/opt/homebrew/opt/libpq/bin` in this file would make it a SECOND home for a
 * machine-specific value, and the two would drift the first time anyone moved to an
 * Intel Mac or a Linux host. Step P is the one place that decides it; this guard
 * reads that decision and holds every other block to it. So editing step P's path
 * reds every block still carrying the old one, which is the failure mode this
 * repository wants: loud, and at the moment of the edit.
 *
 * THE CORPUS IS INDENT-TOLERANT, AND THAT IS NOT A DETAIL. The first version of
 * this measurement matched ```` ```bash ```` anchored at column zero and reported
 * 32 fences / 15 governed. **Five fences in the Supabase runbook are indented** --
 * they sit inside numbered lists -- and one of them, section 8's post-probe
 * re-check, invokes `psql`. Corrected: 37 fences, 16 governed. A filter narrower
 * than the claim it serves, caught while measuring rather than after shipping
 * (`.claude/rules/test-conventions.md` section 2(d)). A leg below removes the line
 * from that indented fence specifically, so the tolerance cannot regress quietly.
 *
 * NOT ASSERTED HERE, deliberately: that the PATH line WORKS on the machine the
 * runbook is run from. That is step P's `psql --version` stop condition, and it is
 * a hand check by necessity -- a test claiming it would be the phantom enforcement
 * Clause 4 forbids. This asserts the documents agree with each other, which is the
 * part a repository can know.
 *
 * NOT ASSERTED HERE either: that a block which needs `DATABASE_URL` reads it. That
 * is a different rule with a different rationale (a credential must also be UNSET
 * afterwards, which PATH must not be), and mixing them would make one file answer
 * to two questions.
 */

const RUNBOOKS = [
  join('docs', 'runbook-supabase-project-creation.md'),
  join('docs', 'runbook-cloudflare-pages-beds-json.md'),
];

/** The total governed-fence count today. Asserted by identity -- see `anti-vacuity`. */
const GOVERNED_TODAY = 16;

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

/** A fence is GOVERNED when running it needs `psql` on PATH. */
export function isGoverned(body: string): boolean {
  return /(^|[\s|(])psql\s/m.test(body) || /run_migrations\.sh/.test(body);
}

/** The first line of a body that needs `psql`, 1-indexed within the body. */
function firstGovernedCall(body: string): number {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? '';
    if (/(^|[\s|(])psql\s/.test(l) || /run_migrations\.sh/.test(l)) return i + 1;
  }
  return -1;
}

/**
 * STEP P'S OWN PATH LINE, read from the document. Null when step P no longer has
 * one, which is a violation rather than a reason to fall back to a default --
 * a fallback here would be the dead-key fallback in `scripts/get_publishable_key.sh`
 * wearing a different hat (test-conventions section 8).
 */
export function expectedPathLine(supabaseRunbook: string): string | null {
  for (const f of bashFences('', supabaseRunbook)) {
    const line = f.body.split('\n').find((l) => /^export PATH=.*libpq/.test(l.trim()));
    if (line !== undefined) return line.trim();
  }
  return null;
}

/** One line per disagreement; empty when every governed fence carries the line first. */
export function pathViolations(docs: { doc: string; text: string }[]): string[] {
  const out: string[] = [];
  const supabase = docs.find((d) => d.doc.includes('runbook-supabase-project-creation'));
  if (supabase === undefined) {
    return ['the Supabase runbook is not in the corpus, so no expected PATH line could be derived'];
  }
  const expected = expectedPathLine(supabase.text);
  if (expected === null) {
    return [
      'step P states no `export PATH=...libpq...` line, so there is nothing for the other blocks to carry. ' +
        'This guard derives its expectation from step P and refuses to invent one.',
    ];
  }

  const fences = docs.flatMap((d) => bashFences(d.doc, d.text));
  if (fences.length === 0) out.push('no ```bash fences were found in any runbook — the guard scanned nothing');

  for (const f of fences) {
    if (!isGoverned(f.body)) continue;
    const lines = f.body.split('\n');
    const at = lines.findIndex((l) => l.trim() === expected);
    if (at === -1) {
      out.push(
        `${f.doc}:${f.line} runs psql and does not carry step P's PATH line, so pasting it into a fresh ` +
          `shell fails with "command not found" instead of a named error. Expected first line: ${expected}`,
      );
      continue;
    }
    const call = firstGovernedCall(f.body);
    if (call !== -1 && at + 1 > call) {
      out.push(
        `${f.doc}:${f.line} carries step P's PATH line at line ${at + 1} of the block but calls psql at ` +
          `line ${call} — the line has to come FIRST or it does nothing for the call it is there to protect`,
      );
    }
  }
  return out.sort();
}

function loadRunbooks(): { doc: string; text: string }[] {
  return RUNBOOKS.map((doc) => ({ doc, text: readFileSync(join(REPO_ROOT, doc), 'utf8') }));
}

const DOCS = loadRunbooks();
const SUPABASE = DOCS[0]?.text ?? '';

describe('runbook psql PATH line', () => {
  test('the corpus is non-empty and its size is asserted by identity', () => {
    // ANTI-VACUITY, and the identity half is what the indented-fence miss earned.
    // "More than zero" would have passed the matcher that could not see five of
    // the fences in this document, so the number is pinned and moves deliberately.
    const fences = DOCS.flatMap((d) => bashFences(d.doc, d.text));
    expect(fences.length, 'no bash fences parsed — the guard would pass over nothing').toBeGreaterThan(40);
    expect(
      fences.filter((f) => isGoverned(f.body)).length,
      'the governed-fence count moved. If a block was added or removed deliberately, change this number ' +
        'in the same commit; if it fell without anyone touching a runbook, the fence matcher stopped seeing some',
    ).toBe(GOVERNED_TODAY);
  });

  test("real runbooks — every governed block carries step P's PATH line, first", () => {
    const v = pathViolations(DOCS);
    expect(v, `blocks that need psql and do not carry the line:\n  ${v.join('\n  ')}`).toEqual([]);
  });

  test('the expected line is DERIVED from step P, not written into this file', () => {
    // If this ever hard-codes the path, the guard stops being the thing that keeps
    // step P and the blocks in step and becomes a second place to edit.
    const planted = SUPABASE.replace(
      'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"',
      'export PATH="/usr/local/opt/libpq/bin:$PATH"',
    );
    expect(planted, 'the plant did not change step P').not.toBe(SUPABASE);
    expect(expectedPathLine(planted), 'the expectation did not move with step P').toBe(
      'export PATH="/usr/local/opt/libpq/bin:$PATH"',
    );
  });

  test('plant — dropping the line from block B is rejected', () => {
    // THE DEFECT ITSELF, at the block that produced it.
    const planted = SUPABASE.replace(
      'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"\nread -rs DATABASE_URL && export DATABASE_URL\npsql "$DATABASE_URL" -c "select coalesce(string_agg(tablename',
      'read -rs DATABASE_URL && export DATABASE_URL\npsql "$DATABASE_URL" -c "select coalesce(string_agg(tablename',
    );
    expect(planted, 'the plant did not reach block B').not.toBe(SUPABASE);

    const v = pathViolations([{ doc: DOCS[0]?.doc ?? '', text: planted }, DOCS[1] as { doc: string; text: string }]);
    expect(v.join('\n'), 'a governed block with no PATH line was accepted').toContain(
      "runs psql and does not carry step P's PATH line",
    );
  });

  test('plant — dropping the line from the INDENTED fence is rejected', () => {
    // The indent-tolerance leg. A matcher anchored at column zero passes this
    // plant, because it never sees the fence at all -- which is exactly what the
    // first version of the measurement behind this file did.
    const planted = SUPABASE.replace(
      '   export PATH="/opt/homebrew/opt/libpq/bin:$PATH"\n   psql "$DATABASE_URL" -tAc "select count(*) from app.facility"',
      '   psql "$DATABASE_URL" -tAc "select count(*) from app.facility"',
    );
    expect(planted, 'the plant did not reach the indented fence in section 8').not.toBe(SUPABASE);

    const v = pathViolations([{ doc: DOCS[0]?.doc ?? '', text: planted }, DOCS[1] as { doc: string; text: string }]);
    expect(v.join('\n'), 'an indented governed fence is outside the corpus').toContain(
      'does not carry step P',
    );
  });

  test('plant — the line present but AFTER the first psql call is rejected', () => {
    // Present-and-not-reaching, which is Clause 5 rather than Clause 4. A block
    // that sets PATH after the call it protects reads as careful and fails
    // identically to one that never set it.
    const doc = 'docs/x.md';
    const text = [
      '```bash',
      'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"',
      'psql --version',
      '```',
      '',
      '```bash',
      'psql "$DATABASE_URL" -c "select 1"',
      'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"',
      '```',
    ].join('\n');
    const v = pathViolations([{ doc: 'docs/runbook-supabase-project-creation.md', text }, { doc, text: '' }]);
    expect(v.join('\n'), 'a PATH line after the call it protects was accepted').toContain(
      'the line has to come FIRST',
    );
  });

  test('positive control — a block with no psql is not required to carry the line', () => {
    // test-conventions' fifth way a leg goes wrong. If this guard demanded the
    // line of every fence, the next person to add an ordinary curl block would hit
    // a refusal on correct input and delete the check.
    const text = [
      '```bash',
      'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"',
      'psql --version',
      '```',
      '',
      '```bash',
      'curl -sS https://openbed.ng/beds.json | head -c 120',
      '```',
      '',
      '```bash',
      'npm run build',
      '```',
    ].join('\n');
    expect(
      pathViolations([{ doc: 'docs/runbook-supabase-project-creation.md', text }]),
      'an ordinary block that never calls psql was refused',
    ).toEqual([]);
  });

  test('anti-vacuity — a corpus with no step P fails rather than passing', () => {
    // The shape that would make this guard useless: step P is reworded, the
    // derivation returns nothing, and every governed block passes against an
    // expectation of "". It must be loud instead.
    const v = pathViolations([{ doc: 'docs/runbook-supabase-project-creation.md', text: '# a runbook with no step P' }]);
    expect(v.join('\n'), 'a runbook with no PATH line to derive from produced no violations').toContain(
      'step P states no',
    );
  });
});
