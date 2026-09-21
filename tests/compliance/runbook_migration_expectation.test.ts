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
 * Takes the FIRST backticked count in the bullet, which is the bullet's own; the
 * indented restatement note beneath it quotes the superseded wording in prose and
 * carries no backticked count of its own.
 */
export function stopBulletPendingCount(runbook: string): number | null {
  const bullet = /^- \*\*Any `WOULD APPLY` line([\s\S]*?)(?=^- \*\*|$(?![\s\S]))/m.exec(runbook);
  if (bullet === null) return null;
  const m = /`(\d+) migration\(s\) pending\.`/.exec(bullet[1] ?? '');
  return m === null ? null : Number(m[1]);
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

  test('the expectation is actually parsed — it names 018 and a count', () => {
    // WITHOUT THIS, every assertion above passes when the regex stops matching:
    // `expectedWouldApply` returns [] and `unfrozen` would have to be empty too.
    // test-conventions section 2(a) — evidence is an executed assertion, and the
    // thing being asserted here is that the parser found something.
    expect(expectedWouldApply(RUNBOOK_TEXT), 'the WOULD APPLY parser matched nothing').toEqual([
      '018_close_mirror_read_and_push_surfaces.sql',
    ]);
    expect(expectedPendingCount(RUNBOOK_TEXT), 'the pending-count parser matched nothing').toBe(1);
    expect(fencedWouldApply(RUNBOOK_TEXT), 'the fenced WOULD APPLY parser matched nothing').toEqual([
      '018_close_mirror_read_and_push_surfaces.sql',
    ]);
    expect(fencedPendingCount(RUNBOOK_TEXT), 'the fenced pending-count parser matched nothing').toBe(1);
  });

  test('plant — restating the prose and NOT the expected-output block is rejected', () => {
    // #61's miss, one level finer: the half-restatement. This is the likeliest
    // future mistake now that the prose is guarded, because the two sites sit
    // three hundred lines apart.
    const planted = RUNBOOK_TEXT.replace(
      'WOULD APPLY     : 018_close_mirror_read_and_push_surfaces.sql\n1 migration(s) pending.',
      'WOULD APPLY     : 017_snapshot_schedule.sql\n1 migration(s) pending.',
    );
    expect(planted, 'the plant did not change the fenced block').not.toBe(RUNBOOK_TEXT);
    expect(fencedWouldApply(planted), 'the plant did not reach the parsed fence').toEqual([
      '017_snapshot_schedule.sql',
    ]);

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
      '`018_close_mirror_read_and_push_surfaces.sql`; and the dry run must end',
      '`017_snapshot_schedule.sql`; and the dry run must end',
    );
    expect(planted, 'the plant did not change the parsed bullet').not.toBe(RUNBOOK_TEXT);
    expect(expectedWouldApply(planted), 'the plant did not reach the parsed line').toEqual([
      '017_snapshot_schedule.sql',
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
    const planted = RUNBOOK_TEXT.replace('`1 migration(s) pending.`', '`0 migration(s) pending.`');
    expect(expectedPendingCount(planted), 'the plant did not reach the parsed count').toBe(0);

    const violations = expectationViolations(
      planted,
      forwardMigrations(REPO_ROOT),
      frozenMigrations(REPO_ROOT),
    );
    expect(violations.join('\n'), 'a stale count was accepted').toContain(
      'step 5 states 0 migration(s) pending, but 1 forward migration(s) are unapplied',
    );
  });

  test('plant — the STOP bullet left at the old count is rejected', () => {
    // THE DEFECT THIS SITE WAS ADDED FOR, reconstructed: the stop condition says
    // stop on anything other than zero while the expectation names one pending
    // migration. Both statements are in the same list, four lines apart, and the
    // document shipped that way.
    const planted = RUNBOOK_TEXT.replace(
      'than `1 migration(s) pending.`: stop and report.**',
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
      'than `1 migration(s) pending.`: stop and report.**',
      'than `2 migration(s) pending.`: stop and report.**',
    );
    expect(stopBulletPendingCount(planted), 'the plant did not reach the parsed count').toBe(2);

    const violations = expectationViolations(
      planted,
      forwardMigrations(REPO_ROOT),
      frozenMigrations(REPO_ROOT),
    );
    expect(violations.join('\n'), 'a disagreeing stop condition was accepted').toContain(
      'its STOP bullet stops on anything other than 2',
    );
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
    ].join('\n');
    expect(
      expectationViolations(agreeing, ['001_a.sql', '002_enums.sql'], ['001_a.sql']),
      'a runbook that agrees with the directory was rejected',
    ).toEqual([]);
  });
});
