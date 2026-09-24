import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE RUNBOOK'S DRY-RUN EXPECTATION AGREES WITH THE MIGRATIONS DIRECTORY
 * (R-2026-09-21-50).
 *
 * THE DEFECT THIS CLOSES, and it is the root cause rather than the instance.
 * `docs/runbook-supabase-project-creation.md` step 5 has carried this rule since
 * 2026-09-14: "When a migration is added, this list is restated in the same change
 * that adds it, never in a follow-up: in between, the document would be wrong."
 * The rule was honoured three times and then **#61 added migration 018 and did not
 * restate it.** For the interval between that merge and this change, the runbook
 * told the founder that a correct dry run prints no `WOULD APPLY` line and
 * `0 migration(s) pending.`, while a correct dry run printed 018 and `1`.
 *
 * A stop condition that fails on a correct run is worse than no stop condition:
 * step 5 says so itself, at "a stop condition that reads wrong on a correct run
 * teaches whoever runs it to ignore stop conditions". Nothing checked it, so the
 * rule was only ever as good as whoever remembered it.
 *
 * HOW MANY SITES STATE THIS EXPECTATION: THREE, and the first version of this
 * guard read two. The change that introduced it said "all four sites restated" and
 * was wrong twice over -- there are five statements of the hosted state in step 5,
 * three of them are the pending expectation itself (the prose bullet, the fenced
 * expected-output block, and the STOP bullet), and the STOP bullet was restated by
 * nobody. **The claim "all four" was the same defect as #61's, one level up: a
 * count asserted rather than derived.** All three are parsed below and asserted to
 * agree with each other as well as with the directory.
 *
 * WHAT IS DERIVABLE HERE AND WHAT IS NOT. This guard compares three artefacts that
 * all live in the repository:
 *   - the forward migrations in `database/migrations/`;
 *   - `database/migrations/applied-hosted.json`, the record of what hosted holds;
 *   - step 5's stated expectation.
 * It says nothing about the hosted project itself. **Step 6's and step 10's
 * expectations are hosted READINGS and cannot be derived from here at all** — they
 * are governed by the prose rule in step 5 and by the pull-request template, which
 * is the weaker form this repository can actually execute (Clause 4 route 2). Do
 * not read this guard as covering them.
 *
 * WHAT CHANGED WHEN 018 WAS APPLIED, AND IT WEAKENS THIS GUARD -- said out loud
 * rather than discovered later (R-2026-09-22-52). With hosted at 018 and the
 * repository at 018, **nothing is pending**, so `expectedWouldApply` and
 * `fencedWouldApply` correctly return `[]`. **An empty return because nothing is
 * pending is byte-identical to an empty return because the regex stopped
 * matching** -- the exact shape test-conventions section 2 is about, arriving on
 * its own rather than through a mistake.
 *
 * Two things keep it honest, and they are legs rather than comments:
 *   - the three COUNTS must parse to `0`, never `null`. A count of zero is proof
 *     the parser reached the text; an empty file list is not.
 *   - a leg plants a migration name INTO THE REAL RUNBOOK TEXT and asserts both
 *     filename parsers find it. Without it, both could be dead and every
 *     assertion here would still be green.
 *
 * AND A HAZARD THIS SECTION'S OWN HISTORY FORM CREATES. Step 5 now carries the
 * 2026-09-22 dry run as a DATED fence, immediately below the current one, and that
 * dated fence contains `WOULD APPLY : 018_...` and `1 migration(s) pending.` --
 * the exact strings a slipped regex would read as current. A leg below edits that
 * historical fence and asserts the parsed values do not move.
 *
 * NOT ASSERTED HERE, deliberately: that `applied-hosted.json` is TRUE of hosted.
 * It is a checked-in record, updated by `scripts/freeze_applied_migrations.mjs`
 * after an apply. If it drifts from the real project, everything below is
 * self-consistent and wrong together. That is what step 5's own dry run is for,
 * and it is why the dry run is a stop condition rather than a formality.
 */

const RUNBOOK = join('docs', 'runbook-supabase-project-creation.md');
const MIG_DIR = join('database', 'migrations');

/**
 * END-OF-INPUT IS `$(?![\s\S])`, NOT `\Z`.
 *
 * `\Z` is a Perl and Python escape. **In JavaScript it matches a literal "Z"**,
 * so `(?=^- \*\*|\Z)` is "followed by another top-level bullet, or by the letter
 * Z". Both regexes below carried it and both passed, because in the real runbook
 * every bullet they match IS followed by another top-level bullet -- the
 * alternative branch was never taken. The positive-control leg, whose fixture ends
 * at the stop bullet, is what exposed it: the lookahead failed, the parse returned
 * nothing, and the checker correctly reported a missing count.
 *
 * **A guard that works only because its corpus never takes the second branch is
 * the shape this repository keeps finding.** The fixture took it on the first try.
 */
const CURRENT_BULLET = /^- \*\*The hosted project today\*\*([\s\S]*?)(?=^- \*\*Restated|$(?![\s\S]))/m;

/**
 * The migration filenames step 5's PROSE says a correct dry run will list.
 *
 * TAKEN FROM THE SEGMENT AFTER "naming", NOT FROM THE WHOLE BULLET. The bullet
 * also backticks the last APPLIED migration -- "every file up to and including
 * `017_…` must read already applied" -- and a whole-bullet scan reads that as a
 * pending file. Found by this guard's own first run against the restated text,
 * which is the leg below that asserts the parse is non-empty doing its job.
 */
export function expectedWouldApply(runbook: string): string[] {
  const bullet = CURRENT_BULLET.exec(runbook);
  if (bullet === null) return [];
  const naming = /naming\s+([\s\S]*?);/.exec(bullet[1] ?? '');
  if (naming === null) return [];
  return [...(naming[1] ?? '').matchAll(/`(\d{3}_[a-z0-9_]+\.sql)`/g)].map((m) => m[1] as string);
}

/**
 * The same expectation as the runner would PRINT it, from the fenced block in
 * "Expected output, including the one line that looks like a failure and is not".
 *
 * THIS IS THE SECOND OF THE FOUR SITES, and the reason the guard reads it too:
 * step 5 states its expectation in more than one place, and the finding that
 * produced this file was a restatement that reached one of them. A guard checking
 * the prose alone would have let a stale fence through.
 */
export function fencedWouldApply(runbook: string): string[] {
  const block = /\*\*On the hosted project today\*\*[\s\S]*?```([\s\S]*?)```/.exec(runbook);
  if (block === null) return [];
  return [...(block[1] ?? '').matchAll(/WOULD APPLY\s*:\s*(\d{3}_[a-z0-9_]+\.sql)/g)].map(
    (m) => m[1] as string,
  );
}

/** The pending count step 5 states in prose, as a number. Null when it states none. */
export function expectedPendingCount(runbook: string): number | null {
  const bullet = CURRENT_BULLET.exec(runbook);
  if (bullet === null) return null;
  const m = /`(\d+) migration\(s\) pending\.`/.exec(bullet[1] ?? '');
  return m === null ? null : Number(m[1]);
}

/** The pending count the fenced expected-output block prints. Null when absent. */
export function fencedPendingCount(runbook: string): number | null {
  const block = /\*\*On the hosted project today\*\*[\s\S]*?```([\s\S]*?)```/.exec(runbook);
  if (block === null) return null;
  const m = /(\d+) migration\(s\) pending\./.exec(block[1] ?? '');
  return m === null ? null : Number(m[1]);
}

/**
 * The pending count the STOP BULLET states — the THIRD site, and the one missed.
 *
 * WHY IT IS HERE. The change that restated this list claimed "all four sites
 * restated" and there were five; the one it missed was the stop condition itself,
 * which went on saying "any count other than zero: stop and report" while the
 * bullet four lines above named 018 and `1 migration(s) pending.` **A founder
 * running a correct dry run would have hit a stop condition** — the exact hazard
 * this whole section is about, reproduced by the change written to fix it.
 *
 * THE SPAN STOPS AT THE FIRST INDENTED SUB-BULLET, AND THAT IS A CORRECTION
 * (R-2026-09-22-52). Until 2026-09-22 this read to the next TOP-LEVEL bullet and
 * took the first backticked count anywhere inside, with a header comment asserting
 * that the indented restatement notes beneath "carry no backticked count of their
 * own". **That was a property of the corpus on the day it was written, not of the
 * parser** -- exactly the `\Z` shape recorded above, one field over. The very next
 * restatement quoted the superseded count in backticks, as every other restatement
 * note in this document does, and the parser silently read the HISTORY as the live
 * stop condition: a plant that emptied the bullet came back with the old value
 * instead of `null`, so the leg asserting the plant landed is what caught it.
 *
 * So the bullet is now its own text only. A restatement note may quote whatever it
 * needs to.
 */
export function stopBulletPendingCount(runbook: string): number | null {
  const bullet = /^- \*\*Any `WOULD APPLY` line([\s\S]*?)(?=^- \*\*|^ +- |$(?![\s\S]))/m.exec(runbook);
  if (bullet === null) return null;
  const m = /`(\d+) migration\(s\) pending\.`/.exec(bullet[1] ?? '');
  return m === null ? null : Number(m[1]);
}

/**
 * THE FOURTH SITE: the ledger-count sentence after the apply fence -- "On hosted
 * today that is `N`, with `M migration(s) pending.` from the dry run".
 *
 * WHY IT IS HERE (R-2026-09-23-67). The change that added 019 restated the three
 * sites above and not this one, so for one merge the section told the founder a
 * correct dry run on hosted prints nothing pending while it printed 019. The same
 * miss as #61's and as the stop bullet's, one site further on: the guard read three
 * statements of the expectation and the section carries four. Whitespace is
 * collapsed first, because the sentence wraps.
 */
export function ledgerSiteCounts(runbook: string): { ledger: number; pending: number } | null {
  const flat = runbook.replace(/\s+/g, ' ');
  const m = /On hosted today that is `(\d+)`, with `(\d+) migration\(s\) pending\.` from the dry run/.exec(flat);
  return m === null ? null : { ledger: Number(m[1]), pending: Number(m[2]) };
}

/**
 * THE VIRGIN-DATABASE BLOCK -- the FIFTH statement of a migration count in step 5,
 * and the one the fourth site's addition still missed (R-2026-09-23-69 found it
 * reading 18/17 after 019). Its counts are derived from the directory: a virgin dry
 * run lists every forward file, and the apply counts one fewer because 001 is
 * ledgered by the runner's bootstrap. Null when the block or either number is absent.
 */
export function virginCounts(runbook: string): { pending: number; applied: number } | null {
  const block = /\*\*On a virgin database\*\*[\s\S]*?```([\s\S]*?)```/.exec(runbook);
  if (block === null) return null;
  const pending = /(\d+) migration\(s\) pending\./.exec(block[1] ?? '');
  const applied = /Migrations complete \((\d+) applied this run\)/.exec(block[1] ?? '');
  return pending === null || applied === null ? null : { pending: Number(pending[1]), applied: Number(applied[1]) };
}

/**
 * [start, end) of each statement a guarded parser actually reads. Absent ones are
 * left out.
 *
 * THE TWO BULLETS ARE NARROWED TO THEIR OWN LIST ITEM, and that is a finding, not
 * tidiness. CURRENT_BULLET runs from "The hosted project today" to the next
 * "Restated" bullet, so a bullet planted between them sits inside its match -- and
 * the prose parser reads only the FIRST count there. Taking the whole match as
 * "guarded" let an unchecked count pass; this scan's own plant is what found it.
 */
function guardedRegions(runbook: string): [number, number][] {
  const units = dateUnits(runbook);
  const itemAt = (at: number): [number, number] | null => {
    const u = units.find((x) => at >= x.start && at < x.end);
    return u === undefined ? null : [u.start, u.end];
  };
  const out: [number, number][] = [];
  for (const re of [CURRENT_BULLET, /^- \*\*Any `WOULD APPLY` line/m]) {
    const m = re.exec(runbook);
    const item = m === null ? null : itemAt(m.index);
    if (item !== null) out.push(item);
  }
  for (const re of [
    /\*\*On the hosted project today\*\*[\s\S]*?```[\s\S]*?```/,
    /On\s+hosted\s+today\s+that\s+is\s+`\d+`,\s+with\s+`\d+\s+migration\(s\)\s+pending\.`\s+from\s+the\s+dry\s+run/,
    /\*\*On a virgin database\*\*[\s\S]*?```[\s\S]*?```/,
  ]) {
    const m = re.exec(runbook);
    if (m !== null) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

/**
 * WHAT DATES A COUNT AS HISTORY: one of the runbook's own two dated-history forms,
 * "Restated YYYY-MM-DD" or "On YYYY-MM-DD" -- never any ISO date anywhere in the unit
 * (R-2026-09-24-81 BI-2, done in R-2026-09-24-85). Until then any date exempted a
 * unit, and a ruling number carries a date: "(R-2026-09-24-74 BB-1)" is a citation,
 * not a dating, and it let 020's fence 5 state a count undated. Tightening this caught
 * seventeen statements in thirteen units; each was restated to carry "On <date>" or
 * "Restated <date>", and none was exempted to go green.
 *
 * THE MARKER DATES WHAT FOLLOWS IT, not its whole unit (R-2026-09-24-86 BN-3). A
 * count in a list item or paragraph is history only if a marker comes BEFORE it in
 * that unit, so a live count followed by its own restatement note -- this runbook's
 * house style -- is still read as live. A fence is dated only by the plain paragraph
 * that introduces it, never by a list item above it. See unguardedPendingStatements.
 *
 * NOT CHECKED, deliberately: that the date is a real past date. "On 2026-99-99" is
 * accepted as a marker. Not worth code: the marker's job is to say "this is history",
 * and a reviewer reading the date is the check.
 */
const HISTORY_MARKER = /\b(?:Restated|On) \d{4}-\d{2}-\d{2}\b/;

/**
 * The runbook cut into the units a date can vouch for: each LIST ITEM (a bullet and
 * its continuation lines, a sub-bullet on its own), each plain paragraph, and each
 * fence -- a fence is dated by the paragraph that introduces it ("**On 2026-09-22,
 * when 018 was pending,**"), never by its own lines.
 *
 * WHY LIST ITEMS AND NOT PARAGRAPHS. Step 5's expectation list has no blank lines
 * between its bullets, so as one paragraph it is dated by any restatement in it, and
 * an UNDATED bullet planted into that list would inherit a neighbour's date and pass.
 */
function dateUnits(runbook: string): { start: number; end: number; dated: boolean; fence: boolean }[] {
  const units: { start: number; end: number; dated: boolean; fence: boolean }[] = [];
  const lines = runbook.split('\n');
  let offset = 0;
  let cur: { start: number; end: number; text: string } | null = null;
  let fence: { start: number; intro: boolean } | null = null;
  let lastIntroDated = false;
  const close = (): void => {
    if (cur === null) return;
    const dated = HISTORY_MARKER.test(cur.text);
    units.push({ start: cur.start, end: cur.end, dated, fence: false });
    // Only a PLAIN PARAGRAPH introduces a fence (BN-3). A list item that happens to
    // precede a fence -- "- On 2026-09-16, ledger 16 rows." -- does not date it.
    lastIntroDated = dated && !/^\s*(- |\d+\. )/.test(cur.text);
    cur = null;
  };
  for (const line of lines) {
    const end = offset + line.length + 1;
    if (/^\s*```/.test(line)) {
      if (fence === null) {
        close();
        fence = { start: offset, intro: lastIntroDated };
      } else {
        units.push({ start: fence.start, end, dated: fence.intro, fence: true });
        fence = null;
      }
    } else if (fence === null) {
      if (line.trim() === '') close();
      else if (/^\s*(- |\d+\. )/.test(line) || cur === null) {
        close();
        cur = { start: offset, end, text: line };
      } else {
        cur.end = end;
        cur.text += `\n${line}`;
      }
    }
    offset = end;
  }
  close();
  return units;
}

/**
 * EVERY `N migration(s) pending.` in the runbook that is neither read by a guarded
 * parser nor inside a dated historical unit (R-2026-09-23-70 D). Empty means each
 * statement of a count is either checked against the directory or is history.
 *
 * WHY A SCAN AND NOT A FIFTH NAMED SITE: this is the third miss of one class -- #61
 * (the prose alone), the "all four" claim (the stop bullet), and the virgin block --
 * and each fix enumerated one more site. Enumeration is what keeps missing; a scan
 * over the whole document cannot.
 *
 * NOT ASSERTED HERE, deliberately: that a count inside a DATED unit is right. It is
 * history -- what a run printed on that day -- and nothing in the repository can
 * re-derive it. A date is what exempts it, so an undated statement is the violation.
 */
export function unguardedPendingStatements(runbook: string): string[] {
  const regions = guardedRegions(runbook);
  const units = dateUnits(runbook);
  const out: string[] = [];
  for (const m of runbook.matchAll(/(\d+) migration\(s\) pending\./g)) {
    const at = m.index;
    if (regions.some(([a, b]) => at >= a && at < b)) continue;
    const unit = units.find((u) => at >= u.start && at < u.end);
    // A fence is dated by its introducing paragraph. Anything else is dated only by a
    // marker BEFORE the count in its own unit: the marker dates what follows it (BN-3).
    const dated = unit === undefined ? false : unit.fence ? unit.dated : HISTORY_MARKER.test(runbook.slice(unit.start, at));
    if (dated) continue;
    const line = runbook.slice(0, at).split('\n').length;
    out.push(`line ${line}: \`${m[0]}\` is stated outside every guarded site and outside any dated historical block`);
  }
  return out;
}

/** Forward migrations present in the repository. */
function forwardMigrations(root: string): string[] {
  return readdirSync(join(root, MIG_DIR))
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();
}

/** Migrations `applied-hosted.json` records as applied and frozen. */
function frozenMigrations(root: string): string[] {
  const raw = readFileSync(join(root, MIG_DIR, 'applied-hosted.json'), 'utf8');
  const parsed = JSON.parse(raw) as { frozen?: { file?: string }[] };
  return (parsed.frozen ?? []).map((f) => f.file ?? '').filter((f) => f.length > 0).sort();
}

/**
 * The checker. Returns one line per disagreement, empty when the runbook and the
 * directory agree.
 */
export function expectationViolations(
  runbook: string,
  forwards: string[],
  frozen: string[],
): string[] {
  const out: string[] = [];
  const frozenSet = new Set(frozen);
  const unfrozen = forwards.filter((f) => !frozenSet.has(f));
  const named = expectedWouldApply(runbook);
  const namedSet = new Set(named);

  for (const f of unfrozen) {
    if (!namedSet.has(f)) {
      out.push(`${f} is in the repository and not applied to hosted, and step 5 does not name it as a WOULD APPLY line`);
    }
  }
  for (const f of named) {
    if (frozenSet.has(f)) {
      out.push(`step 5 names ${f} as pending, but applied-hosted.json records it as already applied`);
    }
    if (!forwards.includes(f)) {
      out.push(`step 5 names ${f} as pending, but no such forward migration exists`);
    }
  }

  const count = expectedPendingCount(runbook);
  if (count === null) {
    out.push('step 5 states no `N migration(s) pending.` count at all');
  } else if (count !== unfrozen.length) {
    out.push(`step 5 states ${count} migration(s) pending, but ${unfrozen.length} forward migration(s) are unapplied`);
  }

  // THE SECOND SITE. Step 5 states its expectation twice -- once in prose and once
  // as the output the runner prints -- and #61's miss is the proof that a change
  // can reach one and not the other. They must agree with each other AND with the
  // directory, so a half-restatement is louder than no restatement.
  const fenced = fencedWouldApply(runbook);
  if (fenced.join(',') !== named.join(',')) {
    out.push(
      `step 5's prose expects [${named.join(', ')}] but its expected-output block prints ` +
        `[${fenced.join(', ')}] — one of the two was restated and the other was not`,
    );
  }
  const fencedCount = fencedPendingCount(runbook);
  if (fencedCount === null) {
    out.push("step 5's expected-output block prints no `N migration(s) pending.` line");
  } else if (fencedCount !== count) {
    out.push(
      `step 5's prose states ${count} pending and its expected-output block prints ${fencedCount}`,
    );
  }

  // THE THIRD SITE: the stop condition. A stop condition that disagrees with the
  // expectation it guards is worse than no stop condition, because it fires on a
  // correct run -- and this is the site the previous restatement missed.
  const stopCount = stopBulletPendingCount(runbook);
  if (stopCount === null) {
    out.push("step 5's stop bullet states no `N migration(s) pending.` count at all");
  } else if (stopCount !== count) {
    out.push(
      `step 5's prose states ${count} pending but its STOP bullet stops on anything other than ${stopCount}`,
    );
  }

  // THE FOURTH SITE, which the first three restatements of 019 missed.
  const ledgerSite = ledgerSiteCounts(runbook);
  if (ledgerSite === null) {
    out.push("step 5's ledger sentence states no `N` rows with `M migration(s) pending.` at all");
  } else {
    if (ledgerSite.ledger !== frozen.length) {
      out.push(`step 5's ledger sentence says hosted holds ${ledgerSite.ledger} rows, but applied-hosted.json records ${frozen.length}`);
    }
    if (ledgerSite.pending !== count) {
      out.push(`step 5's prose states ${count} pending but its ledger sentence says ${ledgerSite.pending}`);
    }
  }

  // THE FIFTH SITE, derived from the directory (R-2026-09-23-69 / -70 D).
  const virgin = virginCounts(runbook);
  if (virgin === null) {
    out.push("step 5's virgin-database block states no pending count and no applied count");
  } else {
    if (virgin.pending !== forwards.length) {
      out.push(`step 5's virgin-database block says ${virgin.pending} pending, but a virgin dry run lists all ${forwards.length} forward migrations`);
    }
    if (virgin.applied !== forwards.length - 1) {
      out.push(`step 5's virgin-database block says ${virgin.applied} applied, but the runner applies ${forwards.length - 1} after its bootstrap ledgers 001`);
    }
  }

  // AND EVERY OTHER STATEMENT OF A COUNT: guarded above, or dated history (-70 D).
  out.push(...unguardedPendingStatements(runbook));

  return out.sort();
}

const RUNBOOK_TEXT = readFileSync(join(REPO_ROOT, RUNBOOK), 'utf8');

describe('runbook migration expectation', () => {
  test('the corpus is non-empty — the guard is not reading a stub', () => {
    expect(forwardMigrations(REPO_ROOT).length, 'no forward migrations found').toBeGreaterThan(10);
    expect(frozenMigrations(REPO_ROOT).length, 'applied-hosted.json records nothing').toBeGreaterThan(10);
    expect(RUNBOOK_TEXT.length, 'the runbook did not load').toBeGreaterThan(1000);
  });

  test('real runbook — step 5 agrees with the migrations directory', () => {
    const violations = expectationViolations(
      RUNBOOK_TEXT,
      forwardMigrations(REPO_ROOT),
      frozenMigrations(REPO_ROOT),
    );
    expect(
      violations,
      `step 5's dry-run expectation does not match the repository. A founder running it ` +
        `would hit a stop condition on a correct project:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  test('the expectation is actually parsed — all four sites read TWO, and both file parsers name 022 and 023', () => {
    // WITHOUT THIS, every assertion above passes when a regex stops matching.
    // RESTATED 2026-09-24 (R-2026-09-24-90 BR-1 d), in the change that adds 022: from
    // 021's apply until then nothing was pending and this leg read ZERO and []. With 022
    // pending the file lists are non-empty again, which is the stronger proof the
    // parsers reached the text -- a dead regex returns [], never a name.
    // RESTATED 2026-09-24 (R-2026-09-24-98 BZ-2 c), in the change that adds 023: 022 is
    // still unapplied on hosted (applied-hosted.json records 21), so TWO are pending and
    // both parsers must return both names, in apply order.
    // test-conventions section 2(a): evidence is an executed assertion.
    expect(expectedPendingCount(RUNBOOK_TEXT), 'the prose pending-count parser matched nothing').toBe(2);
    expect(fencedPendingCount(RUNBOOK_TEXT), 'the fenced pending-count parser matched nothing').toBe(2);
    expect(stopBulletPendingCount(RUNBOOK_TEXT), 'the stop-bullet parser matched nothing').toBe(2);
    expect(ledgerSiteCounts(RUNBOOK_TEXT), 'the ledger sentence was not found — its parser matched nothing').toEqual({ ledger: 21, pending: 2 });

    expect(expectedWouldApply(RUNBOOK_TEXT), 'step 5 does not name the pending migrations').toEqual(['022_one_operator_and_reactivation.sql', '023_operator_register_location_and_phone.sql']);
    expect(fencedWouldApply(RUNBOOK_TEXT), "step 5's fence does not print the pending migrations").toEqual(['022_one_operator_and_reactivation.sql', '023_operator_register_location_and_phone.sql']);
  });

  test('plant — the ledger sentence left at its pre-023 count is rejected', () => {
    // The fourth site's miss, as the change that adds 023 could make it: the three
    // other sites restated to two pending, this one still saying one.
    // Restated for 023 (R-2026-09-24-98 BZ-2 c); for 022 it planted 0 against 1.
    const planted = RUNBOOK_TEXT.replace('with `2 migration(s) pending.` from the\ndry run', 'with `1 migration(s) pending.` from the\ndry run');
    expect(planted, 'the plant did not change the ledger sentence').not.toBe(RUNBOOK_TEXT);
    expect(ledgerSiteCounts(planted)?.pending, 'the plant did not reach the parsed sentence').toBe(1);
    expect(expectationViolations(planted, forwardMigrations(REPO_ROOT), frozenMigrations(REPO_ROOT)).join('\n')).toContain(
      "step 5's prose states 2 pending but its ledger sentence says 1",
    );
  });

  test('plant — a ledger sentence naming the wrong hosted row count is rejected', () => {
    const planted = RUNBOOK_TEXT.replace('On hosted today that is `21`, with', 'On hosted today that is `20`, with');
    expect(planted, 'the plant did not change the ledger sentence').not.toBe(RUNBOOK_TEXT);
    expect(expectationViolations(planted, forwardMigrations(REPO_ROOT), frozenMigrations(REPO_ROOT)).join('\n')).toContain(
      "step 5's ledger sentence says hosted holds 20 rows, but applied-hosted.json records 21",
    );
  });

  test('the filename parsers still discriminate — a name planted into the real text is found', () => {
    // THE LEG THE EMPTY EXPECTATION MAKES NECESSARY. Both filename parsers return
    // [] on the real corpus now, which is correct AND is what a dead regex returns.
    // This plants a pending migration into the real runbook, in both sites, and
    // asserts each parser extracts it — so [] above means "nothing pending" rather
    // than "nothing read".
    // Restated for 023 (R-2026-09-24-98 BZ-2 c): 022 and 023 are pending, so the plant
    // REPLACES the second named file in both sites, and a parser that returned the old
    // name regardless would red. For 022 it replaced the only one.
    const planted = RUNBOOK_TEXT.replace(
      'and then\n  `023_operator_register_location_and_phone.sql`; and the dry',
      'and then\n  `024_planted.sql`; and the dry',
    ).replace(
      '  WOULD APPLY     : 023_operator_register_location_and_phone.sql\n2 migration(s) pending.\n```\n\n*Restated 2026-09-24 (R-2026-09-24-98 BZ-2 c)',
      '  WOULD APPLY     : 024_planted.sql\n2 migration(s) pending.\n```\n\n*Restated 2026-09-24 (R-2026-09-24-98 BZ-2 c)',
    );
    expect(planted, 'the plant changed neither site').not.toBe(RUNBOOK_TEXT);
    expect(expectedWouldApply(planted), 'the prose filename parser is dead').toEqual(['022_one_operator_and_reactivation.sql', '024_planted.sql']);
    expect(fencedWouldApply(planted), 'the fenced filename parser is dead').toEqual(['022_one_operator_and_reactivation.sql', '024_planted.sql']);
  });

  test('the DATED historical fences are not read as the current one', () => {
    // A HAZARD STEP 5'S OWN HISTORY FORM CREATES. The 2026-09-24 dry run (021
    // pending) is kept as a dated fence directly below the current one, and it holds
    // exactly the strings a slipped regex would mistake for today's: a WOULD APPLY
    // line and a count of one. Editing it must move nothing. Re-aimed at the NEWEST
    // dated fence by R-2026-09-23-69, by R-2026-09-24-77 (020's run), and by
    // R-2026-09-24-85 (021's run), because it is the one nearest the current block.
    // Restated for 023 (R-2026-09-24-98 BZ-2 c): the current block names 022 and 023,
    // so what must survive the plant is those two names and a count of two.
    const planted = RUNBOOK_TEXT.replace(
      '  WOULD APPLY     : 021_facility_agreement_and_contact_write.sql   <- dry run\n1 migration(s) pending.',
      '  WOULD APPLY     : 999_not_real.sql   <- dry run\n7 migration(s) pending.',
    );
    expect(planted, 'the plant did not reach the dated 2026-09-24 fence').not.toBe(RUNBOOK_TEXT);

    expect(fencedWouldApply(planted), 'a dated historical fence is being read as the current expectation').toEqual(['022_one_operator_and_reactivation.sql', '023_operator_register_location_and_phone.sql']);
    expect(fencedPendingCount(planted), 'a dated historical count is being read as the current one').toBe(2);
    expect(expectationViolations(planted, forwardMigrations(REPO_ROOT), frozenMigrations(REPO_ROOT))).toEqual([]);
  });

  test('plant — restating the prose and NOT the expected-output block is rejected', () => {
    // #61's miss, one level finer: the half-restatement. This is the likeliest
    // future mistake now that the prose is guarded, because the two sites sit
    // three hundred lines apart.
    // Restated for 023 (R-2026-09-24-98 BZ-2 c): the half-restatement is now the fence
    // left at its pre-023 state -- 022 alone, one pending -- while the prose names both.
    const planted = RUNBOOK_TEXT.replace(
      '```\n  WOULD APPLY     : 022_one_operator_and_reactivation.sql   <- dry run\n  WOULD APPLY     : 023_operator_register_location_and_phone.sql\n2 migration(s) pending.\n```\n\n*Restated 2026-09-24 (R-2026-09-24-98 BZ-2 c)',
      '```\n  WOULD APPLY     : 022_one_operator_and_reactivation.sql   <- dry run\n1 migration(s) pending.\n```\n\n*Restated 2026-09-24 (R-2026-09-24-98 BZ-2 c)',
    );
    expect(planted, 'the plant did not change the fenced block').not.toBe(RUNBOOK_TEXT);
    expect(fencedWouldApply(planted), 'the plant did not reach the parsed fence').toEqual(['022_one_operator_and_reactivation.sql']);

    const violations = expectationViolations(
      planted,
      forwardMigrations(REPO_ROOT),
      frozenMigrations(REPO_ROOT),
    );
    expect(violations.join('\n'), 'a half-restatement was accepted').toContain(
      'one of the two was restated and the other was not',
    );
  });

  test('plant — an unnamed unapplied migration is rejected', () => {
    // THE DEFECT ITSELF: a migration reaches the repository and step 5 is not
    // restated. This is what #61 did.
    const violations = expectationViolations(
      RUNBOOK_TEXT,
      [...forwardMigrations(REPO_ROOT), '019_something_new.sql'],
      frozenMigrations(REPO_ROOT),
    );
    expect(violations.join('\n'), 'an unnamed unapplied migration was accepted').toContain(
      '019_something_new.sql is in the repository and not applied to hosted',
    );
  });

  test('plant — naming a migration that is already applied is rejected', () => {
    // The other direction, and the one that happens AFTER an apply: the runbook
    // still expects the file the founder has just applied, so the next dry run
    // reads FAILED on a correct project.
    const planted = RUNBOOK_TEXT.replace(
      'naming\n  `022_one_operator_and_reactivation.sql` and then',
      'naming\n  `020_operator_functions_and_listing.sql` and then',
    );
    expect(planted, 'the plant did not change the parsed bullet').not.toBe(RUNBOOK_TEXT);
    expect(expectedWouldApply(planted), 'the plant did not reach the parsed line').toEqual([
      '020_operator_functions_and_listing.sql',
      '023_operator_register_location_and_phone.sql',
    ]);

    const violations = expectationViolations(
      planted,
      forwardMigrations(REPO_ROOT),
      frozenMigrations(REPO_ROOT),
    );
    expect(violations.join('\n'), 'naming an already-applied migration was accepted').toContain(
      'applied-hosted.json records it as already applied',
    );
  });

  test('plant — a stale pending COUNT is rejected even when the files are right', () => {
    // The count and the file list are two claims. #61 would have been caught by
    // either; a change that updates one and not the other is the likelier future
    // mistake, because they sit four lines apart.
    const planted = RUNBOOK_TEXT.replace(
      'run must end\n  `2 migration(s) pending.`',
      'run must end\n  `3 migration(s) pending.`',
    );
    expect(expectedPendingCount(planted), 'the plant did not reach the parsed count').toBe(3);

    const violations = expectationViolations(
      planted,
      forwardMigrations(REPO_ROOT),
      frozenMigrations(REPO_ROOT),
    );
    expect(violations.join('\n'), 'a stale count was accepted').toContain(
      'step 5 states 3 migration(s) pending, but 2 forward migration(s) are unapplied',
    );
  });

  test('plant — the STOP bullet left at the old count is rejected', () => {
    // THE DEFECT THIS SITE WAS ADDED FOR, reconstructed: the stop condition says
    // stop on anything other than zero while the expectation names one pending
    // migration. Both statements are in the same list, four lines apart, and the
    // document shipped that way.
    const planted = RUNBOOK_TEXT.replace(
      'than `2 migration(s) pending.`: stop and report.**',
      'than zero: stop and report.**',
    );
    expect(planted, 'the plant did not change the stop bullet').not.toBe(RUNBOOK_TEXT);
    expect(
      stopBulletPendingCount(planted),
      'the plant did not reach the parsed stop bullet',
    ).toBeNull();

    const violations = expectationViolations(
      planted,
      forwardMigrations(REPO_ROOT),
      frozenMigrations(REPO_ROOT),
    );
    expect(violations.join('\n'), 'a stop condition that fires on a correct run was accepted').toContain(
      'stop bullet states no `N migration(s) pending.` count at all',
    );
  });

  test('plant — a STOP bullet disagreeing with the prose is rejected', () => {
    // The subtler half: a stop bullet that HAS a count and states the wrong one.
    // The leg above catches a bullet with no count; this catches one that looks
    // restated and is not.
    const planted = RUNBOOK_TEXT.replace(
      'than `2 migration(s) pending.`: stop and report.**',
      'than `3 migration(s) pending.`: stop and report.**',
    );
    expect(stopBulletPendingCount(planted), 'the plant did not reach the parsed count').toBe(3);

    const violations = expectationViolations(
      planted,
      forwardMigrations(REPO_ROOT),
      frozenMigrations(REPO_ROOT),
    );
    expect(violations.join('\n'), 'a disagreeing stop condition was accepted').toContain(
      'its STOP bullet stops on anything other than 3',
    );
  });

  test('every pending count in the runbook is found and classified — the scan reads the whole document', () => {
    const all = [...RUNBOOK_TEXT.matchAll(/(\d+) migration\(s\) pending\./g)];
    expect(all.length, 'the scan found no pending counts at all, so it checked nothing').toBeGreaterThan(20);
    expect(unguardedPendingStatements(RUNBOOK_TEXT)).toEqual([]);
    expect(virginCounts(RUNBOOK_TEXT), 'the virgin-database block was not parsed').toEqual({
      pending: forwardMigrations(REPO_ROOT).length,
      applied: forwardMigrations(REPO_ROOT).length - 1,
    });
  });

  test('plant — an UNDATED restatement of a count is rejected, even inside the dated expectation list', () => {
    // The class this scan closes (R-2026-09-23-70 D): a new statement of the count
    // that no parser was told about. Planted as a bullet INTO step 5's list, whose
    // neighbours are dated -- a paragraph-level date would have let it through.
    const planted = RUNBOOK_TEXT.replace(
      '- **Restated 2026-09-23 (R-2026-09-23-69), in the change that records 019\'s hosted',
      '- **Also:** a correct run then ends `3 migration(s) pending.`\n- **Restated 2026-09-23 (R-2026-09-23-69), in the change that records 019\'s hosted',
    );
    expect(planted, 'the plant did not land').not.toBe(RUNBOOK_TEXT);
    const found = unguardedPendingStatements(planted);
    expect(found, 'an undated restatement of the count was accepted').toHaveLength(1);
    expect(found[0]).toContain('`3 migration(s) pending.`');
  });

  test('plant — the virgin-database block left at its pre-023 counts is rejected', () => {
    // The miss that made this a class, re-aimed at the change that adds 023: the
    // block left at 22 / 21. Restated for 023 (R-2026-09-24-98 BZ-2 c); for 022 it
    // planted 21 / 20.
    const planted = RUNBOOK_TEXT.replace('23 migration(s) pending.          <- dry run', '22 migration(s) pending.          <- dry run')
      .replace('Migrations complete (22 applied this run).   <- apply', 'Migrations complete (21 applied this run).   <- apply');
    expect(virginCounts(planted), 'the plant did not reach the virgin block').toEqual({ pending: 22, applied: 21 });
    const v = expectationViolations(planted, forwardMigrations(REPO_ROOT), frozenMigrations(REPO_ROOT)).join('\n');
    expect(v).toContain('says 22 pending, but a virgin dry run lists all 23 forward migrations');
    expect(v).toContain('says 21 applied, but the runner applies 22');
  });

  test('a DATED historical statement is accepted, and the same line undated is not', () => {
    // The positive control for the exemption, and its failing half in one leg: the
    // date is the whole of what makes a stated count history.
    expect(unguardedPendingStatements('- [x] On 2026-09-16 the dry run printed `3 migration(s) pending.`')).toEqual([]);
    expect(unguardedPendingStatements('- [x] The dry run printed `3 migration(s) pending.`')).toHaveLength(1);
    expect(unguardedPendingStatements('**On 2026-09-22, when 018 was pending,** it printed:\n\n```\n1 migration(s) pending.\n```')).toEqual([]);
    expect(unguardedPendingStatements('**Earlier,** it printed:\n\n```\n1 migration(s) pending.\n```'), 'a fence was dated by nothing').toHaveLength(1);
  });

  test('plant — an undated count that CITES A RULING is rejected: a ruling number carries a date and is not a history marker (BI-2)', () => {
    // R-2026-09-24-81 BI-2, done in R-2026-09-24-85: until then ANY ISO date in a unit
    // exempted it, so "(R-2026-09-24-74 BB-1)" -- a citation, not a dating -- made an
    // undated statement of the count read as history. 020's fence 5 passed that way.
    expect(
      unguardedPendingStatements('- [x] The dry run printed `3 migration(s) pending.` (R-2026-09-24-74 BB-1).'),
      'a ruling citation was accepted as dating the count',
    ).toHaveLength(1);
    expect(
      unguardedPendingStatements('- [x] 017 applied, 2026-09-17: the dry run printed `1 migration(s) pending.`'),
      'a bare date with no Restated/On marker was accepted as dating the count',
    ).toHaveLength(1);
    expect(unguardedPendingStatements('- [x] Restated 2026-09-24 (R-2026-09-24-85): it read `1 migration(s) pending.`'), 'the Restated form is a marker').toEqual([]);
  });

  test('plant — a marker dates only what FOLLOWS it: a count before the marker, or under a list item, is not history (BN-3)', () => {
    // R-2026-09-24-86 BN-3, Cowork's QA pass. Keyed on a marker ANYWHERE in the unit,
    // BI-2's rule exempted three undated forms. (a) is this runbook's own house style
    // -- a live count followed by its restatement note -- so it is the likeliest miss.
    const a = unguardedPendingStatements(
      '- The deploy check must end `4 migration(s) pending.` *Restated 2026-09-24: until then it read `3 migration(s) pending.`*',
    );
    expect(a, '(a) the live count before a Restated note was read as history').toHaveLength(1);
    expect(a[0], "(a) flagged the restatement's history, not the live count").toContain('`4 migration(s) pending.`');
    expect(
      unguardedPendingStatements('- The dry run must end `4 migration(s) pending.` (per the note On 2026-09-24 in step 7).'),
      '(b) a marker AFTER the count was read as dating it',
    ).toHaveLength(1);
    expect(
      unguardedPendingStatements('- On 2026-09-16, ledger 16 rows.\n\n```\n4 migration(s) pending.\n```'),
      "(c) a fence inherited a LIST ITEM's date",
    ).toHaveLength(1);
    // The positive controls: a plain paragraph still dates the fence it introduces, and a
    // checkbox whose marker comes first is still history.
    expect(unguardedPendingStatements('**On 2026-09-24, when 021 was pending,** it printed:\n\n```\n1 migration(s) pending.\n```')).toEqual([]);
    expect(unguardedPendingStatements('- [x] On 2026-09-24, 021 applied: the second dry run printed `0 migration(s) pending.`')).toEqual([]);
  });

  test('anti-vacuity — a runbook with no expectation bullet FAILS rather than passing', () => {
    // The shape that would make this guard useless: someone rewords the bullet,
    // the regex stops matching, and every assertion above passes over an empty
    // parse. It must be loud instead.
    const violations = expectationViolations(
      'a runbook with no step 5 at all',
      forwardMigrations(REPO_ROOT),
      frozenMigrations(REPO_ROOT),
    );
    expect(violations.length, 'an unparseable runbook produced no violations').toBeGreaterThan(0);
    expect(violations.join('\n')).toContain('states no `N migration(s) pending.` count at all');
  });

  test('positive control — a runbook that agrees is accepted', () => {
    // test-conventions' fifth way a leg goes wrong. The checker must accept the
    // ordinary correct case, or whoever hits a false refusal deletes it.
    const agreeing = [
      '- **The hosted project today** holds them all. There must be exactly one',
      '  `WOULD APPLY` line, naming `002_enums.sql`; and the dry run must end',
      '  `1 migration(s) pending.`',
      '- **Restated once upon a time.** Until then it expected something else.',
      '',
      '**On the hosted project today** the dry run prints:',
      '',
      '```',
      'WOULD APPLY     : 002_enums.sql',
      '1 migration(s) pending.',
      '```',
      '',
      '- **Any `WOULD APPLY` line OTHER than the one named above, or any count other',
      '  than `1 migration(s) pending.`: stop and report.**',
      '',
      // The fourth site (R-2026-09-23-67): one frozen file, so one ledger row.
      'THAT PROJECT. **On hosted today that is `1`, with `1 migration(s) pending.` from',
      'the dry run**.',
      '',
      // The fifth site (R-2026-09-23-70 D): two forward files, so two pending and one applied.
      '**On a virgin database** the two commands report different numbers:',
      '',
      '```',
      '2 migration(s) pending.          <- dry run',
      'Migrations complete (1 applied this run).   <- apply',
      '```',
      '',
      '- [x] On 2020-01-01, the dry run printed `9 migration(s) pending.`',
    ].join('\n');
    expect(
      expectationViolations(agreeing, ['001_a.sql', '002_enums.sql'], ['001_a.sql']),
      'a runbook that agrees with the directory was rejected',
    ).toEqual([]);
  });
});
