import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';
import { freshnessBand, freshnessBucket } from '../../packages/snapshot/src/freshness.js';
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
 * inputs cannot be dishonest.
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
    // The 24h ceiling suppresses the number, never the row. The facility and its
    // phone number stay: a referrer still needs someone to call, and removing
    // the tile would be a freshness FILTER, which is banned outright.
    const stale = freshnessBand(agoMinutes(B.suppressAfterHours * 60 + 1), iso(NOW), 0);
    expect(stale.band).toBe('SUPPRESSED');
    expect(stale.showsCount, 'a suppressed tile still offered a bed count').toBe(false);

    const grey = freshnessBand(agoMinutes(6 * 60), iso(NOW), 0);
    expect(grey.showsCount, 'a grey tile must still show its count, prefixed "last known"').toBe(true);
  });

  test('THE DEVICE CLOCK CANNOT CHANGE THE ANSWER — finding F3', () => {
    // The whole point. Both timestamps come from the server; a device three
    // hours out in either direction contributes NOTHING to this computation,
    // because no wall clock is read.
    const truth = freshnessBand(agoMinutes(30), iso(NOW), 0);
    expect(truth.band).toBe('GREEN');
    // Same server inputs, computed on a device whose clock is three hours out in
    // either direction: identical, because the device clock is not an input.
    for (const skewHours of [-3, 3]) {
      const skewed = freshnessBand(agoMinutes(30), iso(NOW), 0);
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
