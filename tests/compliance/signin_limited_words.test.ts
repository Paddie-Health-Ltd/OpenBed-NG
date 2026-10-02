import { describe, expect, test } from 'vitest';
import ADMIN from '../../packages/labels/admin-labels.json';
import WARD from '../../packages/labels/ward-labels.json';

/**
 * THE TWO APPS SAY THE SAME THING WHEN THE WORKER LIMITED A SIGN-IN REQUEST
 * (R-2026-10-02-FF FF-3 b, -182).
 *
 * WHAT IS BEING GUARDED. packages/auth/src/request.ts returns `limited` for the Worker's own per-address
 * limit, and BOTH apps word it: the ward console from packages/labels/ward-labels.json (`signin.LIMITED`) and
 * admin from packages/labels/admin-labels.json (`screens.REQUEST_LIMITED`). Two words tables for one fact is
 * a derivation pair (test-conventions section 7): left unchecked they drift, and a ward and an operator behind
 * the same hospital address would be told different things about the same limit. Each app keeps the words with
 * its OWN words, so they are not one JSON key; THIS test is the link, and it is code, not a comment claiming one.
 *
 * It holds EQUALITY, not the text: the sentence is the clinicians' to word (the A7 box), so a reworded sentence
 * is a legitimate change that edits BOTH files, and this test stays green. It also holds that the ward sentence
 * is not filed under `proxy`, which holds only words the Worker itself writes.
 *
 * NOT ASSERTED HERE, deliberately: that each app SHOWS the sentence. That is ward_console_render.test.ts and
 * admin_render.test.ts, each rendering a `limited` answer.
 *
 * GUARD CLASS: LIVE.
 */

interface Words {
  readonly ward: unknown;
  readonly admin: unknown;
  readonly wardProxyKeys: readonly string[];
}

/** Every way the two sentences are not one non-empty sentence. Empty means they are. */
export function limitedWordsViolations(w: Words): string[] {
  const out: string[] = [];
  if (typeof w.ward !== 'string' || w.ward.trim() === '') out.push('the ward console has no non-empty `signin.LIMITED` sentence');
  if (typeof w.admin !== 'string' || w.admin.trim() === '') out.push('admin has no non-empty `screens.REQUEST_LIMITED` sentence');
  if (out.length === 0 && w.ward !== w.admin) out.push(`the two apps word the Worker's limit differently: ward ${JSON.stringify(w.ward)}, admin ${JSON.stringify(w.admin)}`);
  if (w.wardProxyKeys.includes('LIMITED')) out.push('the ward sentence is filed under `proxy`, which holds only words the Worker writes');
  return out;
}

const REAL: Words = { ward: WARD.signin.LIMITED, admin: ADMIN.screens.REQUEST_LIMITED, wardProxyKeys: Object.keys(WARD.proxy) };

describe('the ward console and admin word the Worker-limited sign-in request identically', () => {
  test('real label tables are accepted — one sentence, equal in both, and not under `proxy`', () => {
    expect(limitedWordsViolations(REAL)).toEqual([]);
  });

  test('anti-vacuity — the sentence is really present in both tables, so equality is not two undefineds', () => {
    expect(typeof REAL.ward).toBe('string');
    expect(String(REAL.ward).length).toBeGreaterThan(20);
    expect(limitedWordsViolations({ ward: undefined, admin: undefined, wardProxyKeys: [] }).join('\n')).toContain('no non-empty');
  });

  test('plant — one app reworded and the other not is rejected', () => {
    const planted: Words = { ...REAL, admin: `${String(REAL.admin)} Please be patient.` };
    expect(planted.admin, 'the plant did not change the sentence').not.toBe(REAL.admin);
    expect(limitedWordsViolations(planted).join('\n')).toContain('word the Worker\'s limit differently');
  });

  test('plant — a table missing the sentence, and one holding an empty string, are each rejected', () => {
    expect(limitedWordsViolations({ ...REAL, ward: undefined }).join('\n')).toContain('the ward console has no non-empty');
    expect(limitedWordsViolations({ ...REAL, admin: '   ' }).join('\n')).toContain('admin has no non-empty');
  });

  test('plant — the ward sentence filed under `proxy` is rejected', () => {
    expect(limitedWordsViolations({ ...REAL, wardProxyKeys: [...REAL.wardProxyKeys, 'LIMITED'] }).join('\n')).toContain('filed under `proxy`');
  });
});
