import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';
import { deployableApps } from './_apps.js';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';
import { freshnessBand, freshnessBucket, snapshotAge } from '../../packages/snapshot/src/freshness.js';
import { markFetch, elapsedSince } from '../../packages/snapshot/src/anchor.js';

/**
 * FINDING F3 — freshness must never come from the device clock.
 *
 * A cheap Android three hours SLOW renders a four-hour-old row green; three
 * hours FAST renders a ten-minute-old row grey. Both directions occur, both on
 * exactly the low-end devices this targets, and neither errors.
 *
 * Every threshold is asserted against the NAMED CONSTANT in the fixture, never
 * against 60 or 120 or 24 written here. A test that repeats the number is a
 * second derivation site: change the fixture and the test still passes against
 * the old value.
 *
 * NOT ASSERTED HERE, deliberately: that no display module READS a wall clock.
 * That is the Stage 3 ESLint rule's job -- it parses the AST, so it cannot fire
 * on a commented-out example or a string literal, which a grep would. This file
 * asserts the computation is correct GIVEN honest inputs; that one asserts the
 * inputs cannot be dishonest. *Since 2026-09-26 (R-2026-09-26-130, PR F)* that rule
 * exists: `openbed/no-wall-clock` in eslint.config.mjs, pinned by
 * tests/compliance/eslint_wall_clock.test.ts.
 */
const B = SHAPE.freshnessBands;
const iso = (msFromEpoch: number): string => new Date(msFromEpoch).toISOString();
const NOW = Date.parse('2026-09-10T04:00:00.000Z');
const agoMinutes = (m: number): string => iso(NOW - m * 60_000);

describe('freshness bands', () => {
  test.each([
    ['0 minutes', 0, 'GREEN'],
    ['just under the green ceiling', B.greenUnderMinutes - 1, 'GREEN'],
    ['exactly the green ceiling', B.greenUnderMinutes, 'YELLOW'],
    ['just under the yellow ceiling', B.yellowUnderMinutes - 1, 'YELLOW'],
    ['exactly the yellow ceiling', B.yellowUnderMinutes, 'GREY'],
    ['the 4am case — every ward stale', 6 * 60, 'GREY'],
    ['just under the suppression ceiling', B.suppressAfterHours * 60 - 1, 'GREY'],
    ['exactly the suppression ceiling', B.suppressAfterHours * 60, 'SUPPRESSED'],
    ['three days old', 3 * 24 * 60, 'SUPPRESSED'],
  ])('%s -> %s', (_name, minutes, expected) => {
    expect(freshnessBand(agoMinutes(minutes as number), iso(NOW), 0).band).toBe(expected);
  });

  test('SUPPRESSED removes the COUNT and nothing else', () => {
    // The suppressAfterHours ceiling removes the number, never the row. The facility
    // and its phone number stay: a referrer still needs someone to call, and removing
    // the tile would be a freshness FILTER, which is banned outright.
    const stale = freshnessBand(agoMinutes(B.suppressAfterHours * 60 + 1), iso(NOW), 0);
    expect(stale.band).toBe('SUPPRESSED');
    expect(stale.showsCount, 'a suppressed tile still offered a bed count').toBe(false);

    const grey = freshnessBand(agoMinutes(6 * 60), iso(NOW), 0);
    expect(grey.showsCount, 'a grey tile must still show its count, with the time it was reported').toBe(true);
  });

  test('THE DEVICE CLOCK CANNOT CHANGE THE ANSWER — finding F3', () => {
    // The whole point. Both timestamps come from the server; a device three
    // hours out in either direction contributes NOTHING to this computation,
    // because no wall clock is read.
    // RESTATED 2026-09-23 (R-2026-09-23-67): this read agoMinutes(30), a literal that
    // assumed the old 60-minute green band -- the file's own rule against numbers in
    // prose, broken once. The fixture's constant now drives it.
    const truth = freshnessBand(agoMinutes(B.greenUnderMinutes - 1), iso(NOW), 0);
    expect(truth.band).toBe('GREEN');
    // Same server inputs, computed on a device whose clock is three hours out in
    // either direction: identical, because the device clock is not an input.
    for (const skewHours of [-3, 3]) {
      const skewed = freshnessBand(agoMinutes(B.greenUnderMinutes - 1), iso(NOW), 0);
      expect(skewed.band, `a device clock ${skewHours}h out changed the band`).toBe(truth.band);
    }
  });

  test('the monotonic elapsed term ages a row, and only forwards', () => {
    const atFetch = freshnessBand(agoMinutes(B.greenUnderMinutes - 1), iso(NOW), 0);
    expect(atFetch.band).toBe('GREEN');
    // Two minutes of monotonic elapsed time pushes it over the green ceiling --
    // the tile ages on screen without another fetch, which is what the term is for.
    const later = freshnessBand(agoMinutes(B.greenUnderMinutes - 1), iso(NOW), 2 * 60_000);
    expect(later.band, 'elapsed time since fetch did not age the row').toBe('YELLOW');
    // Negative elapsed is clamped: monotonic time cannot run backwards, and if a
    // runtime reports that it did, a row must not become fresher than the server said.
    expect(freshnessBand(agoMinutes(90), iso(NOW), -999_999).band).toBe('YELLOW');
  });

  test('a ward stamped AHEAD of server_now is age zero, not negative', () => {
    // A writer with a fast clock. A negative age would sort fresher than anything
    // real and put a wrong row at the top of the list.
    const ahead = freshnessBand(iso(NOW + 60 * 60_000), iso(NOW), 0);
    expect(ahead.band).toBe('GREEN');
    expect(ahead.ageMinutes).toBe(0);
  });

  test('unparseable input is SUPPRESSED, never GREEN', () => {
    // The safe direction for an unknown age is "we do not know". A green badge on
    // a row whose age could not be computed is the worst available answer.
    expect(freshnessBand('not-a-date', iso(NOW), 0).band).toBe('SUPPRESSED');
    expect(freshnessBand(agoMinutes(5), 'not-a-date', 0).band).toBe('SUPPRESSED');
  });

  test('buckets order fresher-first and are total', () => {
    const order = (['GREEN', 'YELLOW', 'GREY', 'SUPPRESSED'] as const).map(freshnessBucket);
    expect(order, 'the sort bucket does not order fresher-first').toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size, 'two bands share a bucket — the sort would be unstable between them').toBe(4);
  });
});

describe("the snapshot's own age (R-2026-09-23-67 A3)", () => {
  const GEN = iso(NOW);
  const servedAfter = (m: number): string => iso(NOW + m * 60_000);

  test('a snapshot served a minute after generation is not stale', () => {
    expect(snapshotAge(GEN, servedAfter(1), 0)).toMatchObject({ known: true, stale: false });
  });

  test('THE STALLED JOB — served at the banner threshold after generation, it is stale', () => {
    // The failing half of the one above: same generation time, a later serve.
    expect(snapshotAge(GEN, servedAfter(B.snapshotBannerAfterMinutes), 0)).toMatchObject({ known: true, stale: true });
  });

  test('a page left open ages: a fresh serve plus enough monotonic elapsed time is stale', () => {
    expect(snapshotAge(GEN, servedAfter(0), (B.snapshotBannerAfterMinutes + 1) * 60_000).stale).toBe(true);
  });

  test('no serve-time clock, or an unreadable one, is UNKNOWN and therefore stale — never fresh', () => {
    expect(snapshotAge(GEN, null, 0)).toMatchObject({ known: false, stale: true });
    expect(snapshotAge(GEN, 'not a time', 0)).toMatchObject({ known: false, stale: true });
    expect(snapshotAge('not a time', servedAfter(0), 0)).toMatchObject({ known: false, stale: true });
  });

  test('a serve clock BEHIND generation is clamped to zero, never a negative age', () => {
    expect(snapshotAge(GEN, iso(NOW - 60_000), 0)).toMatchObject({ known: true, stale: false, ageMinutes: 0 });
  });

  test('the setting carries its PROVISIONAL label until a clinician ruling removes it (A4, A7)', () => {
    expect((B as { status?: string }).status ?? '', 'the thresholds lost their PROVISIONAL label without a ruling').toMatch(/^PROVISIONAL/);
    expect(typeof B.snapshotBannerAfterMinutes).toBe('number');
  });
});

/**
 * Digits left in the setting's PROSE once citations are removed -- a ruling id, an
 * ISO date, a clause reference like A4, and a v1:239-style line citation. Empty means
 * the prose states no value. Throws when there is no prose to read, so an empty or
 * renamed object cannot pass as clean.
 */
export function numbersInProse(bands: Record<string, unknown>): string[] {
  const prose = Object.entries(bands).filter((e): e is [string, string] => typeof e[1] === 'string');
  if (prose.length === 0) throw new Error('the setting carries no prose fields, so this checked nothing');
  const found: string[] = [];
  for (const [key, text] of prose) {
    const stripped = text
      .replace(/R-\d{4}-\d{2}-\d{2}-\d+/g, '')
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
      .replace(/\bv\d+:\d+\b/g, '')
      .replace(/\b[A-Z]\d+\b/g, '');
    for (const m of stripped.matchAll(/\S*\d\S*/g)) found.push(`${key}: "${m[0]}"`);
  }
  return found;
}

const IN_FORCE_KEYS = ['greenUnderMinutes', 'yellowUnderMinutes', 'suppressAfterHours'] as const;

/** Keys on which the values in force are LOOSER (later) than v1's. Empty means none. */
export function looserThanV1(inForce: Record<string, number>, v1: Record<string, number>): string[] {
  return IN_FORCE_KEYS.filter((k) => !(inForce[k]! <= v1[k]!));
}

describe('the setting states each value once (R-2026-09-23-68 B2, B3)', () => {
  const bands = B as unknown as Record<string, unknown>;
  const v1 = (B as unknown as { v1SpecValues: Record<string, number> }).v1SpecValues;

  test('real setting is accepted — its prose states no threshold, and the prose is there to read', () => {
    expect(numbersInProse(bands)).toEqual([]);
    expect(Object.values(bands).filter((v) => typeof v === 'string').length, 'no prose fields were read').toBeGreaterThanOrEqual(3);
  });

  test('plant — a threshold written in the prose is rejected, whatever value it states', () => {
    // The exact sentence -68 B3 found: the object said 24h while holding 12.
    expect(numbersInProse({ ...bands, why_here: 'Suppression at 24h removes the COUNT, never the row.' })).toEqual(['why_here: "24h"']);
    expect(numbersInProse({ ...bands, comment: 'from 12 hours no number is shown' }), 'a TRUE number in prose is still a second copy').toHaveLength(1);
    expect(numbersInProse({ ...bands, status: 'PROVISIONAL (R-2026-09-23-68 C3, v1:242, 2026-09-23)' }), 'a citation was read as a threshold').toEqual([]);
  });

  test('anti-vacuity — a setting with no prose fails rather than passing clean', () => {
    expect(() => numbersInProse({ greenUnderMinutes: 1 })).toThrow(/checked nothing/);
  });

  test("v1's values are recorded beside the values in force, which are no looser on any key", () => {
    expect(v1).toMatchObject({ greenUnderMinutes: 60, yellowUnderMinutes: 120, suppressAfterHours: 24 });
    expect(looserThanV1(bands as Record<string, number>, v1)).toEqual([]);
  });

  test('plant — a value in force looser than v1 is rejected', () => {
    expect(looserThanV1({ ...(bands as Record<string, number>), suppressAfterHours: 36 }, v1)).toEqual(['suppressAfterHours']);
    expect(looserThanV1({ ...(bands as Record<string, number>), greenUnderMinutes: 61 }, v1)).toEqual(['greenUnderMinutes']);
  });

  test('no code reads v1SpecValues — it is a record for the clinicians, not a setting', () => {
    // Every app's source, derived since PR 3.4b-app B (BP-9), not two dashboard files.
    const appSources = deployableApps().flatMap((a) =>
      (readdirSync(join(REPO_ROOT, 'apps', a, 'src'), { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => `apps/${a}/src/${f}`),
    );
    expect(appSources.length, 'no app source found, so this leg read nothing').toBeGreaterThan(2);
    for (const file of ['packages/snapshot/src/freshness.ts', ...appSources]) {
      expect(readFileSync(join(REPO_ROOT, file), 'utf8'), `${file} reads the v1 values`).not.toContain('v1SpecValues');
    }
  });
});

describe('clock anchor', () => {
  test('elapsed time is monotonic and never negative', () => {
    const mark = markFetch();
    expect(elapsedSince(mark)).toBeGreaterThanOrEqual(0);
  });

  test('OPENBED-CLOCK-ANCHOR appears exactly once in the repository', () => {
    // The count is the review surface. A second annotation means a second place
    // claiming the right to sample time, and the whole design rests on there
    // being one.
    const grep = readFileSync(join(REPO_ROOT, 'packages/snapshot/src/anchor.ts'), 'utf8');
    expect((grep.match(/OPENBED-CLOCK-ANCHOR/g) ?? []).length, 'the anchor annotation count changed').toBe(1);
  });

  test('the freshness module reads NO clock — F3, asserted on its source', () => {
    // freshness.ts must be pure. Date.parse of a passed-in string is fine; a
    // no-argument Date, Date.now, or performance.now is not.
    const src = readFileSync(join(REPO_ROOT, 'packages/snapshot/src/freshness.ts'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    expect(src, 'freshness.ts reads a wall clock').not.toMatch(/Date\.now\(\)|new Date\(\s*\)|performance\.now\(\)/);
  });
});
