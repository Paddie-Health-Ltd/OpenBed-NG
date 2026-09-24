import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER THE WARD CONSOLE'S LIVE-KEY PROBE — step 3 of
 * docs/runbook-ward-console-deploy.md (R-2026-09-23-64), which since the
 * R-2026-09-23-70 H4 note is run by scripts/readback_ward_console.sh rather than
 * pasted from a fence.
 *
 * WHY IT NEEDS A GUARD. No test in this repository can tell a live key from a dead
 * one: a revoked key is still well-formed, and every guard over the tracked key stays
 * green. This probe is therefore the ONLY check, and its properties are what make it a
 * check rather than a ritual. Each is asserted here over the SCRIPT'S TEXT, with a
 * plant. What the script DOES with each answer, planted answer by planted answer, is
 * tests/compliance/readback_scripts.test.ts.
 *
 * THE ONE THIS FILE EXISTS FOR MOST: THE ENDPOINT. Observed 2026-09-23, at the
 * PostgREST root a live key and a dead key BOTH return 401 — "Secret API key
 * required" versus "Invalid API key". A probe edited back to /rest/v1/ with a status
 * check would certify a dead key as live, and read as a harmless simplification.
 *
 * WHAT MOVED, AND WHAT REPLACED IT (Standard O: a removed assertion is paired with a
 * stronger one). Until the H4 note this file also refused an `exit`, and an assignment
 * to `path` or `status`, inside the fence, because the fence was PASTED into an
 * interactive shell. The probe is now a script run under bash, so those rules are moot,
 * and the script legitimately exits. What replaces them is the property the paste
 * rules were protecting: that nobody pastes the probe at all. So:
 *   - the runbook's read-back fence must be exactly the one-line invocation of the
 *     script;
 *   - no fence in any of the four deploy runbooks may `read` from the terminal, the
 *     exact failure H4 hit, except the reads named in PASTED_READS_STILL_OPEN below.
 *
 * PASTED_READS_STILL_OPEN IS A CLOSED LIST, NOT A LOOPHOLE. The Pages runbook's
 * section 5 (the custom-domain edge headers, whose `read -r BEDS_URL` sections 5 and 6
 * reuse) and section 8 (the performed SUPABASE_URL deletion, whose gate reads two
 * values) are one-time procedures, not per-deploy read-backs. Moving them into scripts
 * was outside the H4 note's minimum, and they are named in PR 3.4's design report as
 * still pasted. The list is compared by identity, so a new `read` anywhere in these
 * runbooks, including a restored one, turns this red, and removing one of these fences
 * turns it red until its entry is removed too.
 *
 * NOT ASSERTED HERE, deliberately (method note 12):
 *   - that the probe PASSES against the real deployment. Only running it at the edge
 *     can show that. Cowork ran the pre-script fence verbatim at 20:26 UTC on
 *     2026-09-23 against 6abd577d, and it read PASS (the -70 H4 note);
 *   - that Supabase keeps answering with these exact bodies. The script names them as
 *     observed on a date, and a change there reads WRONG at the edge — loudly, as a
 *     STOP — rather than here.
 */

const SCRIPT = join(REPO_ROOT, 'scripts', 'readback_ward_console.sh');
const ROTATION = join(REPO_ROOT, 'docs', 'runbook-key-rotation.md');
const PASTED_READS_STILL_OPEN: Record<string, string[]> = {
  'runbook-cloudflare-pages-beds-json.md': ['BEDS_STATUS', 'BEDS_URL', 'DEPLOYED_COMMIT'],
  'runbook-cloudflare-worker-proxy.md': [],
  'runbook-ward-console-deploy.md': [],
  'runbook-admin-deploy.md': [],
};
// The admin app's runbook joined in PR 3.4b-app C (R-2026-09-24-97): its read-back is a
// script too, and no fence in it may read from the terminal.
const DEPLOY_RUNBOOKS = ['runbook-ward-console-deploy.md', 'runbook-cloudflare-pages-beds-json.md', 'runbook-cloudflare-worker-proxy.md', 'runbook-admin-deploy.md'];

/** The script's code, comments removed, so a property named only in the header never counts. */
function code(script: string): string {
  return script
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

/** Every reason the script's step 3 is not a check that can fail. Empty means it is one. */
export function probeViolations(script: string): string[] {
  const c = code(script);
  if (c.trim() === '') return ['the read-back script is empty'];
  const out: string[] = [];
  if (!/site_probe GET "\/\$BUNDLE"/.test(c) || !/rb_matches 'sb_publishable_/.test(c)) {
    out.push('the key is not read out of the DEPLOYED bundle');
  }
  if (/publishable-keys\.json/.test(c)) out.push('the key is read from the repository, which proves something about a checkout');
  if (!/api_probe GET \/auth\/v1\/settings -H "apikey: \$DEPLOYED_KEY"/.test(c)) out.push('the live half does not send the deployed key to /auth/v1/settings');
  if (c.includes('/rest/v1/')) out.push('the probe uses /rest/v1/, where a live key and a dead key both return 401');
  if (!/rb_expect "step 3 live half status" "\$LIVE_CODE" 200/.test(c)) out.push('the live half does not require status 200');
  if (!c.includes(`"$(rb_body 60)" '{"external":'`)) out.push('the live half does not require a body beginning {"external":');
  if (!/rb_expect "step 3 dead half status" "\$DEAD_CODE" 401/.test(c)) out.push('the failing half does not require status 401');
  if (!c.includes(`'"message":"Invalid API key"'`)) out.push('the failing half does not require the "Invalid API key" body');
  if (!/api_probe GET \/auth\/v1\/settings -H "apikey: sb_publishable_[A-Z_]*WRONG[A-Z_]*"/.test(c)) out.push('there is no deliberately wrong key — the failing half is missing');
  if (!/rb_expect "step 3 publishable keys in the deployed bundle" "\$RB_COUNT" 1/.test(c)) out.push('the probe does not require exactly one key in the deployed bundle');
  if (!/^rb_verdict /m.test(c)) out.push('the script prints no single verdict');
  return out;
}

/** Every reason the runbooks could send someone back to pasting. Empty means none. */
export function pasteViolations(runbooks: Record<string, string>): string[] {
  const out: string[] = [];
  const ward = runbooks['runbook-ward-console-deploy.md'] ?? '';
  const stepTwo = /^## 2\. [\s\S]*?(?=^## )/m.exec(ward)?.[0] ?? '';
  const fences = [...stepTwo.matchAll(/```bash\n([\s\S]*?)```/g)].map((f) => f[1] ?? '');
  if (fences.length !== 1 || !/^bash scripts\/readback_ward_console\.sh https:\/\/\S+\n$/.test(fences[0] ?? '')) {
    out.push('step 2 of the ward-console runbook is not exactly the one-line read-back invocation');
  }
  for (const [name, text] of Object.entries(runbooks)) {
    const reads = new Set<string>();
    for (const f of text.matchAll(/```bash\n([\s\S]*?)```/g)) {
      for (const r of (f[1] ?? '').matchAll(/(?:^|[\s;&|])read\s+(?:-r\s+)?([A-Za-z_][A-Za-z0-9_]*)/gm)) reads.add(r[1] ?? '');
    }
    const open = new Set(PASTED_READS_STILL_OPEN[name] ?? []);
    for (const r of [...reads].sort()) {
      if (!open.has(r)) out.push(`${name}: a fence reads ${r} from the terminal, the paste that failed on H4`);
    }
    for (const r of [...open].sort()) {
      if (!reads.has(r)) out.push(`${name}: ${r} is listed as a pasted read still open, and no fence reads it -- remove the entry`);
    }
  }
  return out;
}

const SCRIPT_TEXT = readFileSync(SCRIPT, 'utf8');
const RUNBOOKS = Object.fromEntries(DEPLOY_RUNBOOKS.map((n) => [n, readFileSync(join(REPO_ROOT, 'docs', n), 'utf8')]));

describe('the ward console’s live-key probe', () => {
  test('real read-back script is accepted', () => {
    expect(probeViolations(SCRIPT_TEXT), 'scripts/readback_ward_console.sh is not a check that can fail').toEqual([]);
  });

  test('anti-vacuity — an empty script is REJECTED rather than passing for want of anything to check', () => {
    expect(probeViolations('#!/usr/bin/env bash\n# only a header\n')).toEqual(['the read-back script is empty']);
  });

  test('anti-vacuity — a property named only in a COMMENT does not count', () => {
    const commented = SCRIPT_TEXT.replace(/^(rb_expect "step 3 live half status".*)$/m, '# $1');
    expect(commented).not.toBe(SCRIPT_TEXT);
    expect(probeViolations(commented).join('\n')).toContain('does not require status 200');
  });

  test.each([
    ['the endpoint moved back to the PostgREST root', (t: string) => t.replace('api_probe GET /auth/v1/settings -H "apikey: $DEPLOYED_KEY"', 'api_probe GET /rest/v1/ -H "apikey: $DEPLOYED_KEY"'), 'where a live key and a dead key both return 401'],
    ['the failing half removed', (t: string) => t.replace(/^api_probe GET \/auth\/v1\/settings -H "apikey: sb_publishable_DELIBERATELY.*$/m, 'api_probe GET /auth/v1/settings -H "apikey: $DEPLOYED_KEY"'), 'the failing half is missing'],
    ['the key read from the repository instead', (t: string) => t.replace(/^DEPLOYED_KEY=.*$/m, 'DEPLOYED_KEY="$(node -e \'process.stdout.write(require("./packages/origins/publishable-keys.json").production)\')"'), 'proves something about a checkout'],
    ['the status check dropped from the live half', (t: string) => t.replace(/^rb_expect "step 3 live half status".*\n/m, ''), 'does not require status 200'],
    ['the one-key requirement dropped', (t: string) => t.replace(/^rb_expect "step 3 publishable keys in the deployed bundle".*\n/m, ''), 'exactly one key'],
    ['the verdict dropped', (t: string) => t.replace(/^rb_verdict "the stamp names.*\n/m, ''), 'no single verdict'],
  ])('plant — %s is rejected', (_label, mutate, expected) => {
    const planted = mutate(SCRIPT_TEXT);
    // CONFIRM THE PLANT LANDED on the text under test (test-conventions, 2026-09-21):
    // a no-op plant reads as a guard with a hole.
    expect(planted, 'the plant did not change the script').not.toBe(SCRIPT_TEXT);
    expect(probeViolations(planted).join('\n'), `a probe with ${_label} was accepted`).toContain(expected);
  });

  test('real deploy runbooks are accepted — the read-back is one line, and no fence reads a URL', () => {
    expect(pasteViolations(RUNBOOKS)).toEqual([]);
  });

  test.each([
    ['runbook-ward-console-deploy.md', 'the pasted `read -r DEPLOY_URL` fence restored in the ward-console runbook'],
    ['runbook-cloudflare-pages-beds-json.md', 'the pasted `read -r DEPLOY_URL` fence restored in the Pages runbook'],
    ['runbook-cloudflare-worker-proxy.md', 'a pasted `read -r API_URL` fence added to the Worker runbook'],
  ])('plant — in %s, %s is rejected', (name, label) => {
    const variable = name === 'runbook-cloudflare-worker-proxy.md' ? 'API_URL' : 'DEPLOY_URL';
    const planted = { ...RUNBOOKS, [name]: `${RUNBOOKS[name] ?? ''}\n\`\`\`bash\nread -r ${variable}\ncurl -sS "$${variable}/version.json"\n\`\`\`\n` };
    expect(pasteViolations(planted), `${label} was accepted`).toEqual([`${name}: a fence reads ${variable} from the terminal, the paste that failed on H4`]);
  });

  test('plant — a still-open read removed from its runbook without removing its entry is rejected', () => {
    const pages = RUNBOOKS['runbook-cloudflare-pages-beds-json.md'] ?? '';
    const planted = pages.replace('read -r BEDS_URL\n', 'BEDS_URL=https://openbed.ng/beds.json\n');
    expect(planted, 'the plant did not change the Pages runbook').not.toBe(pages);
    expect(pasteViolations({ ...RUNBOOKS, 'runbook-cloudflare-pages-beds-json.md': planted })).toEqual([
      'runbook-cloudflare-pages-beds-json.md: BEDS_URL is listed as a pasted read still open, and no fence reads it -- remove the entry',
    ]);
  });

  test('plant — step 2 turned back into a multi-line paste is rejected', () => {
    const ward = RUNBOOKS['runbook-ward-console-deploy.md'] ?? '';
    const planted = ward.replace('bash scripts/readback_ward_console.sh https://HASH.openbed-ward-console.pages.dev\n', 'DEPLOY_URL=https://HASH.openbed-ward-console.pages.dev\ncurl -sS -m 12 "$DEPLOY_URL/version.json"\n');
    expect(planted, 'the plant did not change step 2').not.toBe(ward);
    expect(pasteViolations({ ...RUNBOOKS, 'runbook-ward-console-deploy.md': planted })).toEqual([
      'step 2 of the ward-console runbook is not exactly the one-line read-back invocation',
    ]);
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
