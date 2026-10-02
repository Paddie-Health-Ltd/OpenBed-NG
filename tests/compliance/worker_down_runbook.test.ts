import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { CALL_WORST_CASE_MS, MAX_SENDS_PER_CALL, SEND_TIMEOUT_MS } from '../../packages/auth/src/fallback.js';
import { COMPOSED_AT_AGE_BOUND_MS, REFRESH_ATTEMPTS, REFRESH_WORST_CASE_MS, STICKY_WINDOW_MS } from '../../packages/auth/src/holder.js';
import { SIGNIN_ATTEMPTS, SIGNIN_WORST_CASE_MS } from '../../packages/auth/src/request.js';
import { REPO_ROOT } from './_scratch.js';

/**
 * RUNBOOK SECTION 6, "WORKER DOWN", HELD TO THE CODE ONLY WHERE IT CAN BE (R-2026-10-02-FF FF-6 f, -182).
 *
 * WHAT IS HELD. Section 6 of docs/runbook-cloudflare-worker-proxy.md states the client's bounds in prose: a call is two
 * sends of 12 s (24 s), a refresh is three attempts of that pair (73.25 s), a sign-in request is two attempts of a pair
 * (48 s), a publish tap's composed_at ages at most 97.25 s, and the direct origin goes first for five minutes after a
 * failure. Each of those figures has ONE source, the constants exported by packages/auth/src, and this test reads the
 * prose and the constants and holds them equal, so a changed constant that leaves the runbook saying the old figure is
 * red. The 30-minute figure in step 3 has no constant to be derived from, so what is held is that it is STATED IN ONE
 * PLACE: once in section 6, and nowhere else in the runbook, so a second copy cannot drift from the first.
 *
 * THE PROSE IS MATCHED BY ITS PHRASES, deliberately: rewording a sentence that carries a figure makes this red, and the
 * person rewording it edits the pattern here in the same change. That is a feature (test-conventions section 3): it
 * decays loudly.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - that the 30-minute figure is the RIGHT one. It is a decision (FF-6 d 3), taken once, and a test that "checked" it
 *     would only restate the prose back at itself. This block is the writing-down of that, instead of a test that appears
 *     to check it (Clause 4);
 *   - that the table's per-outage behaviour is true on hosted. No hosted step takes the Worker away (DY-2), and the local
 *     behaviour is tests/db/ward_console_fallback_acceptance.test.ts's;
 *   - the numbered steps' commands. They are runbook fences, verified by pasting them (runbook fences exist to be pasted);
 *   - that migration 026's window IS two minutes. Section 6 says a publish tap's composed_at "ages at most 97.25 s, under
 *     migration 026's two-minute STALE_MUTATION window", and this file holds the 97.25 to the constants and nothing to the
 *     migration: that fact is read from the migration by tests/compliance/auth_fallback.test.ts, which goes red if the
 *     window shrinks below the bound. Planting the migration's interval here changes nothing, by design (the behavioural pass, row V8).
 *
 * GUARD CLASS: LIVE.
 */

const RUNBOOK = join(REPO_ROOT, 'docs', 'runbook-cloudflare-worker-proxy.md');
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/** Section 6's text: from its heading to the next `## ` heading. Empty when there is none. */
export function sectionSix(doc: string): string {
  const start = doc.search(/^## 6\. Worker down/m);
  if (start < 0) return '';
  const rest = doc.slice(start + 1);
  const next = rest.search(/^## /m);
  return next < 0 ? rest : rest.slice(0, next);
}

const OUTAGES = [
  'A Worker that throws or is undeployed',
  'A lost route or DNS',
  "The Free plan's daily pool spent",
  'Allow-list drift',
  'A Cloudflare-wide outage',
];

/** Every way section 6 disagrees with the code, or with the one-place rule. Empty means it does not. */
export function worker_down_violations(doc: string): string[] {
  // Whitespace is folded, so a re-wrapped paragraph (a line break inside "at most two sends") does not move a pattern.
  const six = sectionSix(doc).replace(/\s+/g, ' ');
  if (six === '') return ['section 6 "Worker down" is missing, so nothing was checked'];
  const out: string[] = [];
  const must = (what: string, pattern: RegExp, want: number, scale = 1): void => {
    const m = pattern.exec(six);
    if (m === null) {
      out.push(`section 6 no longer states ${what} in the phrase this test reads`);
      return;
    }
    const raw = m[1] ?? '';
    const got = (WORDS[raw] ?? Number(raw)) * scale;
    if (got !== want) out.push(`section 6 says ${what} is ${raw}, the code says ${want / scale}`);
  };
  must('the send timeout in seconds', /at most two sends of (\d+) s/, SEND_TIMEOUT_MS, 1000);
  must('the worst case of one call in seconds', /two sends of \d+ s, so (\d+) s/, CALL_WORST_CASE_MS, 1000);
  must('the sends per call', /at most (two|three|four|five|six|one) sends of/, MAX_SENDS_PER_CALL);
  must('a refresh worst case in seconds', /a refresh is \w+ attempts of that pair with its backoff, ([\d.]+) s/, REFRESH_WORST_CASE_MS, 1000);
  must('a refresh attempts', /a refresh is (\w+) attempts of that pair/, REFRESH_ATTEMPTS);
  must('a sign-in request worst case in seconds', /a sign-in request is \w+ attempts of a pair, (\d+) s/, SIGNIN_WORST_CASE_MS, 1000);
  must('a sign-in request attempts', /a sign-in request is (\w+) attempts of a pair/, SIGNIN_ATTEMPTS);
  must("a publish tap's composed_at age in seconds", /ages at most ([\d.]+) s/, COMPOSED_AT_AGE_BOUND_MS, 1000);
  must('the sticky window in minutes', /for (\w+) minutes, and a renewal/, STICKY_WINDOW_MS, 60_000);

  // The 30-minute figure: stated once in section 6 and nowhere else in the runbook.
  const inSix = six.match(/within 30 minutes of the alert/g)?.length ?? 0;
  const inDoc = doc.replace(/\s+/g, ' ').match(/within 30 minutes of the alert/g)?.length ?? 0;
  if (inSix !== 1) out.push(`the 30-minute figure is stated ${inSix} times in section 6, not exactly once`);
  if (inDoc !== inSix) out.push(`the 30-minute figure is also stated outside section 6 (${inDoc - inSix} more), so there are two places for it to drift`);

  for (const outage of OUTAGES) if (!six.includes(`**${outage}`)) out.push(`the table has no row for "${outage}"`);
  return out;
}

const REAL = readFileSync(RUNBOOK, 'utf8');
const replaceOnce = (doc: string, from: string, to: string): string => {
  expect(doc.split(from).length - 1, `the plant's anchor "${from}" must appear exactly once, or the plant did not land`).toBe(1);
  return doc.replace(from, to);
};

describe('runbook section 6 is held to the code where it can be', () => {
  test('real runbook is accepted — every bound equals its constant, the 30-minute figure is stated once, and the five outages have rows', () => {
    const v = worker_down_violations(REAL);
    expect(v, v.join('\n')).toEqual([]);
  });

  test('anti-vacuity — a document with no section 6, and an empty one, each fail', () => {
    expect(worker_down_violations('').join('\n')).toContain('section 6 "Worker down" is missing');
    expect(worker_down_violations('# a runbook\n\n## 5. Surface\n\nnothing\n').join('\n')).toContain('is missing');
    expect(sectionSix(REAL).length, 'the section reader returned nothing from the real runbook').toBeGreaterThan(500);
  });

  test.each([
    ['one call bound changed (24 s becomes 25 s)', 'so 24 s;', 'so 25 s;', 'the code says 24'],
    ['the refresh bound changed (73.25 s becomes 36 s: the old figure)', 'with its backoff, 73.25 s', 'with its backoff, 36 s', 'the code says 73.25'],
    ['the sign-in bound changed (48 s becomes 24 s)', 'a pair, 48 s;', 'a pair, 24 s;', 'the code says 48'],
    ["the publish tap's age bound changed (97.25 s becomes 120 s)", 'ages at most 97.25 s', 'ages at most 120 s', 'the code says 97.25'],
    ['the sticky window changed (five minutes becomes ten)', 'for five minutes, and a renewal', 'for ten minutes, and a renewal', 'the code says 5'],
  ])('plant — %s is rejected', (_name, from, to, message) => {
    const planted = replaceOnce(REAL, from, to);
    expect(planted).not.toBe(REAL);
    expect(worker_down_violations(planted).join('\n')).toContain(message);
  });

  test('plant — the 30-minute figure stated a second time elsewhere in the runbook is rejected', () => {
    const planted = `${REAL}\n\nIf the Worker is not reading back PASS within 30 minutes of the alert, roll back.\n`;
    expect(worker_down_violations(planted).join('\n')).toContain('also stated outside section 6');
  });

  test('plant — a table that loses an outage row is rejected', () => {
    const planted = replaceOnce(REAL, '**A lost route or DNS**', '**Something else**');
    expect(worker_down_violations(planted).join('\n')).toContain('the table has no row for "A lost route or DNS"');
  });

  test('control — rewording a sentence that carries no figure stays accepted', () => {
    const planted = replaceOnce(REAL, 'Nothing in it has been run on hosted.', 'None of it has been run on hosted.');
    expect(worker_down_violations(planted)).toEqual([]);
  });
});
