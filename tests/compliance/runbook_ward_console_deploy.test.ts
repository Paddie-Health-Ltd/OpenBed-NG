import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER THE WARD CONSOLE'S LIVE-KEY PROBE — step 3 of
 * docs/runbook-ward-console-deploy.md (R-2026-09-23-64).
 *
 * WHY IT NEEDS A GUARD. No test in this repository can tell a live key from a dead
 * one: a revoked key is still well-formed, and every guard over the tracked key stays
 * green. This probe is therefore the ONLY check, and it is prose in a runbook, which
 * is exactly what drifts silently. The properties that make it a check rather than a
 * ritual are asserted here, each with a plant.
 *
 * THE ONE THIS FILE EXISTS FOR MOST: THE ENDPOINT. Observed 2026-09-23, at the
 * PostgREST root a live key and a dead key BOTH return 401 — "Secret API key
 * required" versus "Invalid API key". A probe edited back to /rest/v1/ with a status
 * check would certify a dead key as live, and read as a harmless simplification.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that the probe PASSES against the real deployment. Only running it at the edge
 *     can show that; it was verified by interactive paste against a locally served
 *     build, live and with its key replaced by a dead one, and the PR quotes both.
 *   - that Supabase keeps answering with these exact bodies. The runbook names them
 *     as observed on a date, and a change there reds the probe at the edge — loudly,
 *     as a STOP — rather than here.
 */

const RUNBOOK = join(REPO_ROOT, 'docs', 'runbook-ward-console-deploy.md');
const ROTATION = join(REPO_ROOT, 'docs', 'runbook-key-rotation.md');

/** Step 3's text and its single bash fence. */
function stepThree(markdown: string): { text: string; fence: string } | null {
  const m = /^## 3\. [\s\S]*/m.exec(markdown);
  if (m === null) return null;
  const fences = [...m[0].matchAll(/```bash\n([\s\S]*?)```/g)].map((f) => f[1] ?? '');
  return fences.length === 1 ? { text: m[0], fence: fences[0] ?? '' } : null;
}

/** Every reason step 3 is not a check that can fail. Empty means it is one. */
export function probeViolations(markdown: string): string[] {
  const step = stepThree(markdown);
  if (step === null) return ['step 3 was not found, or it does not carry exactly one bash fence'];
  const { fence } = step;
  const out: string[] = [];
  if (!/\$DEPLOY_URL/.test(fence) || !/sb_publishable_/.test(fence)) {
    out.push('the key is not read out of the DEPLOYED bundle');
  }
  if (/publishable-keys\.json/.test(fence)) out.push('the key is read from the repository, which proves something about a checkout');
  if (!fence.includes('/auth/v1/settings')) out.push('the probe does not use /auth/v1/settings');
  if (fence.includes('/rest/v1/')) out.push('the probe uses /rest/v1/, where a live key and a dead key both return 401');
  if (!/"\$LIVE_CODE" = 200/.test(fence)) out.push('the live half does not require status 200');
  if (!fence.includes(`'{"external":'`)) out.push('the live half does not require a body beginning {"external":');
  if (!/"\$DEAD_CODE" = 401/.test(fence)) out.push('the failing half does not require status 401');
  if (!fence.includes(`'"message":"Invalid API key"'`)) out.push('the failing half does not require the "Invalid API key" body');
  if (!/apikey: sb_publishable_[A-Z_]*WRONG/.test(fence)) out.push('there is no deliberately wrong key — the failing half is missing');
  if (!/"\$KEYS_FOUND" = 1/.test(fence)) out.push('the probe does not require exactly one key in the deployed bundle');
  if (/(^|[\s;&|])exit(\s|$)/m.test(fence)) out.push('the fence calls exit, which closes the interactive shell it is pasted into');
  if (/(^|[\s;])(path|status)=/m.test(fence)) out.push('the fence assigns path or status, which zsh ties to $PATH or holds read-only');
  if (!/PASS:/.test(fence) || !/STOP:/.test(fence)) out.push('the fence prints no single verdict');
  return out;
}

const TEXT = readFileSync(RUNBOOK, 'utf8');

describe('the ward console’s live-key probe', () => {
  test('real runbook is accepted', () => {
    expect(probeViolations(TEXT), 'step 3 of the ward-console deploy runbook is not a check that can fail').toEqual([]);
  });

  test('anti-vacuity — a document with no step 3 is REJECTED rather than passing for want of anything to check', () => {
    expect(probeViolations('# nothing here\n')).toEqual(['step 3 was not found, or it does not carry exactly one bash fence']);
  });

  test.each([
    ['the endpoint moved back to the PostgREST root', (t: string) => t.replace('https://api.openbed.ng/auth/v1/settings', 'https://api.openbed.ng/rest/v1/'), 'where a live key and a dead key both return 401'],
    ['the failing half removed', (t: string) => t.replace(/^DEAD_OUT=.*$/m, 'DEAD_OUT="$LIVE_OUT"'), 'the failing half is missing'],
    ['the key read from the repository instead', (t: string) => t.replace(/^DEPLOYED_KEY=.*$/m, 'DEPLOYED_KEY="$(grep -o \'sb_publishable_[A-Za-z0-9_-]*\' packages/origins/publishable-keys.json)"'), 'proves something about a checkout'],
    ['the status check dropped from the live half', (t: string) => t.replace('[ "$LIVE_CODE" = 200 ] || OK=0\n', ''), 'does not require status 200'],
    ['an exit added', (t: string) => t.replace('OK=1\n', 'OK=1\n[ -n "$DEPLOY_URL" ] || exit 1\n'), 'closes the interactive shell'],
    ['the one-key requirement dropped', (t: string) => t.replace('[ "$KEYS_FOUND" = 1 ] || OK=0\n', ''), 'exactly one key'],
  ])('plant — %s is rejected', (_label, mutate, expected) => {
    const planted = mutate(TEXT);
    // CONFIRM THE PLANT LANDED on the fence under test, not just somewhere in the
    // file (test-conventions, 2026-09-21): a no-op plant reads as a guard with a hole.
    expect(stepThree(planted)?.fence, 'the plant did not change step 3’s fence').not.toBe(stepThree(TEXT)?.fence);
    expect(probeViolations(planted).join('\n'), `a probe with ${_label} was accepted`).toContain(expected);
  });

  test('the rotation step POINTS AT this probe and carries no copy of its own', () => {
    // R-2026-09-23-64 A2: one probe, so there is nothing to drift apart.
    const rotation = readFileSync(ROTATION, 'utf8');
    const step = /^## Rotating the publishable key[\s\S]*?(?=^## )/m.exec(rotation)?.[0] ?? '';
    expect(step.length, 'the publishable-key rotation step was not found').toBeGreaterThan(200);
    expect(step, 'the rotation step does not point at the ward-console read-back').toContain('docs/runbook-ward-console-deploy.md');
    expect(step, 'the rotation step carries its own copy of the probe').not.toContain('/auth/v1/settings');
  });
});
