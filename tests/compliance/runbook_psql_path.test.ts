import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';
import { bashFences, isGoverned, loadRunbooks, PSQL_SCRIPTS } from './_fences.js';

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

/**
 * The total governed-fence count today. Asserted by identity -- see `anti-vacuity`.
 * 24 -> 27 on 2026-09-24 (PR 3.4b-app A.2): step 3's H2 section adds three blocks that
 * call psql -- the unconfirmed-account read-back, the probe-address count, and the
 * STOP branch's removal -- each carrying step P's PATH line.
 * 27 -> 32 on 2026-09-24 (PR 3.4b-app C): section 12 adds five blocks that call psql --
 * H6's operator count read-back, the three agreement-withdrawal steps and the contact
 * erasure. Its two provisioning-script blocks do not call psql (the script uses
 * postgres.js) and carry no PATH line.
 * 32 -> 33 on 2026-09-26 (R-2026-09-26-122 CX-1 b): 12.4 step 6, B1's check, reads
 * ward_status_history as the first ward account through psql, carrying step P's PATH line.
 * 33 -> 35 on 2026-09-27 (R-2026-09-26-136 DL-2 i): "024's apply" adds two blocks that
 * call psql -- fence A, the auth reading before the apply, and fence B, the auth reading
 * and the jobs after it -- each carrying step P's PATH line.
 * 35 -> 36 on 2026-09-27 (R-2026-09-27-137 DM-2 d): 12.5 step 5 reads the retention
 * jobs' runs on the 31st day after a withdrawal through psql, carrying step P's PATH line.
 * 36 -> 38 on 2026-09-27 (R-2026-09-27-144 DT l): "025 and 026's apply" adds two blocks
 * that call psql -- fence A, the two pre-check counts and the label count before the
 * apply, and fence B, the label, the trigger and the rename after it -- each carrying
 * step P's PATH line. 12.4 step 5's new precondition block (R-2026-09-27-145 DU-4 b)
 * does not call psql.
 * 38 -> 39 on 2026-09-28 (R-2026-09-27-144 DT, Bundle 2): 12.4 step 6b reads each ward's
 * history as the facility's login through psql, carrying step P's PATH line. The same change
 * split every block that reads a value into a connection line and a command block
 * (R-2026-09-28-150 DZ-3 b); a connection line calls no psql, so that split moved nothing.
 */
const GOVERNED_TODAY = 39;

/**
 * THE READER MOVED (R-2026-09-29-165, EO-1 a). RUNBOOKS, bashFences(), PSQL_SCRIPTS and
 * isGoverned() live in tests/compliance/_fences.ts, so tests/db/runbook_sql_live.test.ts reads
 * the same corpus without importing this file.
 */

/** The first line of a body that needs `psql`, 1-indexed within the body. */
function firstGovernedCall(body: string): number {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] ?? '';
    if (/(^|[\s|(])psql\s/.test(l) || PSQL_SCRIPTS.test(l)) return i + 1;
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

const DOCS = loadRunbooks(REPO_ROOT);
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
      // Re-aimed 2026-09-28 (R-2026-09-28-150 DZ-3 b): the read is now its own connection
      // line, pasted alone, and psql runs in the command block after it. The plant drops
      // step P's line from that command block, which is where the defect would live.
      '```bash\nexport PATH="/opt/homebrew/opt/libpq/bin:$PATH"\npsql "$DATABASE_URL" -c "select coalesce(string_agg(tablename',
      '```bash\npsql "$DATABASE_URL" -c "select coalesce(string_agg(tablename',
    );
    expect(planted, 'the plant did not reach block B').not.toBe(SUPABASE);

    const v = pathViolations([{ doc: DOCS[0]?.doc ?? '', text: planted }, DOCS[1] as { doc: string; text: string }]);
    expect(v.join('\n'), 'a governed block with no PATH line was accepted').toContain(
      "runs psql and does not carry step P's PATH line",
    );
  });

  test('plant — dropping the line from a fence that runs scripts/readback_public_output.sh is rejected', () => {
    // The script calls psql itself, so its fence is governed although no psql appears in it.
    const planted = SUPABASE.replace(
      // Re-aimed 2026-09-28 (DZ-3 b): the command block after the connection line.
      '```bash\nexport PATH="/opt/homebrew/opt/libpq/bin:$PATH"\nbash scripts/readback_public_output.sh https://openbed.ng\n',
      '```bash\nbash scripts/readback_public_output.sh https://openbed.ng\n',
    );
    expect(planted, 'the plant did not reach the before-reading fence').not.toBe(SUPABASE);

    const v = pathViolations([{ doc: DOCS[0]?.doc ?? '', text: planted }, DOCS[1] as { doc: string; text: string }]);
    expect(v.join('\n'), 'a fence running a psql-calling script with no PATH line was accepted').toContain(
      "runs psql and does not carry step P's PATH line",
    );
  });

  test('plant — dropping the line from the fence that runs scripts/readback_function_grants.sh is rejected', () => {
    const planted = SUPABASE.replace(
      // Re-aimed 2026-09-28 (DZ-3 b): the command block after the connection line.
      '```bash\nexport PATH="/opt/homebrew/opt/libpq/bin:$PATH"\nbash scripts/readback_function_grants.sh\n',
      '```bash\nbash scripts/readback_function_grants.sh\n',
    );
    expect(planted, 'the plant did not reach fence 6').not.toBe(SUPABASE);

    const v = pathViolations([{ doc: DOCS[0]?.doc ?? '', text: planted }, DOCS[1] as { doc: string; text: string }]);
    expect(v.join('\n'), 'a fence running a psql-calling script with no PATH line was accepted').toContain(
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
