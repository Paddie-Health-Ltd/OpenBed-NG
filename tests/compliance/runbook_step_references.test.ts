import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER HOW docs/runbook-cloudflare-pages-beds-json.md NAMES ITS OWN PARTS
 * (R-2026-09-23-65 A3).
 *
 * THE DEFECT. That runbook has numbered SECTIONS (`## 1.` to `## 8.`) and numbered
 * READ-BACKS under *Reporting back* (1 to 8, and 5b), and it called both "step N".
 * Every number from 1 to 8 named two different things. Read-back 6 said "step 8 is
 * what stops it recurring silently", meaning read-back 8 (GET and HEAD), on a page
 * where section 8 is "Delete SUPABASE_URL". An operator following the reference
 * lands on the one part of the runbook that destroys something.
 *
 * THE RULE, as the runbook now writes it: a section is "section N", a read-back is
 * "read-back N", and an item inside a numbered list is "item N". The word "step"
 * with a number survives ONLY where the same sentence names ANOTHER runbook, whose
 * own parts are steps ("step 5 of the Supabase runbook").
 *
 * AND ONE PARAGRAPH, ONCE. The "`"dirty": true` means the deploy wrapper was
 * BYPASSED" bullet sat in read-back 4 twice, on main, before this change. A
 * duplicated paragraph is the residue of an edit applied twice, and the second copy
 * is the one nobody updates. Any block of prose of 120 characters or more that
 * appears twice is refused. Fenced code is excluded: a command legitimately recurs.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that each "section N" or "read-back N" points at the RIGHT part. That is a
 *     judgement about what a sentence means, and it was made by reading each one
 *     against the record (R-2026-09-21-47 D is what says "5b" is a read-back). A
 *     check that the number merely EXISTS would pass the misdirection that started
 *     this, since both parts exist.
 *   - any other runbook. Each names its parts "step" consistently, with no second
 *     numbered list to collide with.
 */
const RUNBOOK = join(REPO_ROOT, 'docs', 'runbook-cloudflare-pages-beds-json.md');
const TEXT = readFileSync(RUNBOOK, 'utf8');

/** Every "step N" that is not scoped to another named runbook. */
export function bareStepReferences(markdown: string): string[] {
  const flat = markdown.replace(/\s+/g, ' ');
  const out: string[] = [];
  for (const m of flat.matchAll(/\bsteps? \d+[a-z]?(?:(?:, | and )\d+[a-z]?)*/gi)) {
    const before = flat.slice(Math.max(0, (m.index ?? 0) - 60), m.index);
    const after = flat.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 60);
    const scopedAfter = /^ of (?:the Supabase runbook|`docs\/runbook-(?!cloudflare-pages-beds-json)[a-z0-9-]+\.md`)/.test(after);
    const scopedBefore = /`docs\/runbook-(?!cloudflare-pages-beds-json)[a-z0-9-]+\.md` $/.test(before);
    if (!scopedAfter && !scopedBefore) out.push(`…${before}[${m[0]}]${after}…`);
  }
  return out;
}

/** Every block of prose (paragraph or list item, outside fences) that appears more than once. */
export function duplicatedBlocks(markdown: string): string[] {
  const prose = markdown.replace(/```[\s\S]*?```/g, '\n');
  const blocks: string[] = [];
  let cur: string[] = [];
  const flush = (): void => {
    const b = cur.join(' ').replace(/\s+/g, ' ').trim();
    if (b.length >= 120) blocks.push(b);
    cur = [];
  };
  for (const line of prose.split('\n')) {
    if (line.trim() === '') flush();
    else {
      if (/^\s*(?:[-*]|\d+[a-z]?\.)\s/.test(line)) flush();
      cur.push(line);
    }
  }
  flush();
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const b of blocks) (seen.has(b) ? dups : seen).add(b);
  return [...dups].map((b) => b.slice(0, 120));
}

describe('the Pages runbook names each of its parts one way', () => {
  test('real runbook is accepted — no bare "step N", no paragraph twice', () => {
    expect(bareStepReferences(TEXT), 'a bare "step N" is ambiguous between a section and a read-back').toEqual([]);
    expect(duplicatedBlocks(TEXT), 'a paragraph appears twice').toEqual([]);
  });

  test('anti-vacuity — the runbook still has both kinds of reference to check', () => {
    // A runbook that had lost its numbering, or a reader that no longer found it,
    // would pass the leg above for want of anything to check.
    expect(TEXT.match(/\bsection \d/gi)?.length ?? 0, 'no "section N" reference found').toBeGreaterThan(5);
    expect(TEXT.match(/\bread-back \d/gi)?.length ?? 0, 'no "read-back N" reference found').toBeGreaterThan(3);
    expect(TEXT, 'the cross-runbook form the rule permits is gone, so its exemption is untested').toMatch(/step 5 of the Supabase runbook/);
    expect(duplicatedBlocks(''), 'an empty document produced a finding').toEqual([]);
    expect(bareStepReferences(''), 'an empty document produced a finding').toEqual([]);
  });

  test('plant — the reference that started this, "step 8" in read-back 6, is rejected', () => {
    const planted = TEXT.replace('read-back 8 is what stops it recurring silently', 'step 8 is what stops it recurring silently');
    expect(planted, 'the plant did not mutate the document').not.toBe(TEXT);
    expect(bareStepReferences(planted).join('\n')).toContain('[step 8] is what stops it recurring silently');
  });

  test('plant — a bare "steps 5 and 6" is rejected, and so is a "step N" naming THIS runbook', () => {
    expect(bareStepReferences('Run steps 5 and 6 first.')).toHaveLength(1);
    expect(bareStepReferences('See step 5 of `docs/runbook-cloudflare-pages-beds-json.md`.')).toHaveLength(1);
  });

  test('positive control — a "step N" scoped to another runbook is accepted', () => {
    // THE MOST ORDINARY VALID INPUT: this runbook cites the Supabase runbook's steps
    // in both word orders, and a guard that refused them would be switched off.
    expect(bareStepReferences('that is step 5 of the Supabase runbook, and')).toEqual([]);
    expect(bareStepReferences('as in `docs/runbook-supabase-project-creation.md` step 5.')).toEqual([]);
    expect(bareStepReferences('Step 5 of\n`docs/runbook-supabase-project-creation.md` carries')).toEqual([]);
  });

  test('plant — the duplicated "dirty": true bullet, restored, is rejected', () => {
    const bullet = /   - \*\*`"dirty": true` means the deploy wrapper was BYPASSED\*\*[\s\S]*?through the wrapper\.\n/.exec(TEXT)?.[0];
    expect(bullet, 'the bullet the plant duplicates is gone from the runbook').toBeDefined();
    const planted = TEXT.replace(bullet ?? '', `${bullet ?? ''}${bullet ?? ''}`);
    expect(planted, 'the plant did not mutate the document').not.toBe(TEXT);
    expect(duplicatedBlocks(planted).join('\n')).toContain('`"dirty": true` means the deploy wrapper was BYPASSED');
  });

  test('positive control — a command repeated in two fences is not a duplicate', () => {
    const fence = '```bash\ncurl -sS -D - "$BEDS_URL" -o /dev/null --max-time 12 --retry 2 --retry-delay 1 --retry-max-time 20 | head\n```\n';
    expect(duplicatedBlocks(`${fence}\ntext\n\n${fence}`)).toEqual([]);
  });
});
