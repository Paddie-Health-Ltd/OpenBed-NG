import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER A HAND CHECK -- the Pages runbook's cache step, which is the probe
 * that discharges the EVIDENCE gate's fourth observation on migration 018.
 *
 * WHAT IT PROTECTS, and why this guard exists at all. Until 2026-09-21 that step's
 * stop condition was `cf-cache-status: HIT`. **That condition could not be met by a
 * working system or a broken one**, because `cf-cache-status` reports the ZONE CDN's
 * decision about its own cache and the Function's Cache API is a different,
 * documented-as-independent mechanism. For a `.json` path with no Cache Rule the
 * zone's decision is `DYNAMIC` on every request. MEASURED on openbed.ng 2026-09-21:
 * DYNAMIC twice, with the Function's cache in an unknown state (R-2026-09-21-42).
 *
 * The step now reads `x-openbed-edge-cache`, which serveBedsCached sets from what it
 * actually did on that request. This guard pins the three properties that make the
 * step a probe rather than a ritual:
 *   1. the PASS is the marker, at an exact value;
 *   2. `cf-cache-status` is printed but is never a stop condition;
 *   3. the step carries a demonstrated FAILING half -- the >35s request that must
 *      read `miss` -- so the probe is shown to discriminate in the run that uses it.
 *
 * AND ONE THING A PROSE GUARD COULD NOT DO: it EXECUTES the step's own grep pattern
 * against two synthetic header blocks and asserts the two cannot be confused. A
 * block carrying `cf-cache-status: HIT` and no marker must NOT satisfy the new stop
 * condition, and a block carrying the marker must satisfy it even though
 * `cf-cache-status` reads `DYNAMIC`. That is the false-green the rewrite closes,
 * asserted rather than described.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - That Cloudflare sets `cf-cache-status: DYNAMIC` for this URL, or that the
 *     Cache API behaves as its reference says. Neither is assertable from inside
 *     this repository -- there is no Cloudflare access (R-2026-09-17-11 B4). The
 *     runbook records them with their evidence kind; this guard checks the STEP,
 *     never the platform (Clause 4).
 *   - That the founder runs the step. A runbook step is a named human step.
 */

const RUNBOOK = join(REPO_ROOT, 'docs/runbook-cloudflare-pages-beds-json.md');
const MARKER = 'x-openbed-edge-cache';

/** Step 6 of the Pages runbook, heading to the next heading. */
function cacheStep(markdown: string): string | undefined {
  return /^## 6\. [\s\S]*?(?=^## 7\. )/m.exec(markdown)?.[0];
}

/** The `grep -E` patterns the step actually tells the founder to run. */
function grepPatterns(step: string): string[] {
  return [...step.matchAll(/grep -i -E '([^']+)'/g)].map((m) => m[1] as string);
}

/** The bullet-form stop conditions, e.g. "- `x-openbed-edge-cache: hit`". */
function stopBullets(step: string): string[] {
  return [...step.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1] as string);
}

export function cacheProbeViolations(markdown: string): string[] {
  const step = cacheStep(markdown);
  if (!step) return ['runbook step 6 not found — the cache-probe guard checked nothing'];
  const out: string[] = [];

  const patterns = grepPatterns(step);
  if (patterns.length === 0) return ['step 6 contains no `grep -i -E` pattern — the guard checked nothing'];
  for (const p of patterns) {
    for (const required of [MARKER, '^HTTP', '^content-type']) {
      if (!p.includes(required)) out.push(`a step 6 grep pattern does not select ${required}: ${p}`);
    }
  }

  const bullets = stopBullets(step);
  if (!bullets.some((b) => b === `${MARKER}: hit`)) {
    out.push(`no stop condition names the exact value \`${MARKER}: hit\``);
  }
  if (bullets.some((b) => b.toLowerCase().startsWith('cf-cache-status'))) {
    out.push('`cf-cache-status` is a stop condition again — it reports the zone cache, not this Function');
  }

  // The failing half. A probe with only a passing half is what step 8 shipped.
  if (!/sleep 4\d/.test(step) || !new RegExp(`${MARKER}: miss`).test(step)) {
    out.push('step 6 no longer carries its demonstrated failing half (the >35s request that must read `miss`)');
  }
  return out;
}

/**
 * Apply a step's own grep pattern to a header block, the way the founder's shell
 * would: line by line, case-insensitively.
 */
export function selectLines(pattern: string, block: string): string[] {
  const re = new RegExp(pattern, 'i');
  return block.split('\n').filter((l) => re.test(l));
}

const real = readFileSync(RUNBOOK, 'utf8');

const ZONE_HIT_NO_MARKER = [
  'HTTP/2 200',
  'content-type: application/json; charset=utf-8',
  'cf-cache-status: HIT',
].join('\n');

const FUNCTION_HIT_ZONE_DYNAMIC = [
  'HTTP/2 200',
  'content-type: application/json; charset=utf-8',
  'cf-cache-status: DYNAMIC',
  `${MARKER}: hit`,
].join('\n');

describe('runbook cache step — the probe that discharges the EVIDENCE gate', () => {
  test('real runbook step 6 is accepted', () => {
    expect(
      cacheProbeViolations(real),
      'step 6 no longer reads the Function cache marker, or lost its failing half',
    ).toEqual([]);
  });

  test('the step selects the marker, and a zone HIT without the marker does NOT satisfy it', () => {
    const step = cacheStep(real) as string;
    const pattern = grepPatterns(step)[0] as string;

    const zone = selectLines(pattern, ZONE_HIT_NO_MARKER);
    expect(zone.join('\n'), 'the step prints the zone header, so it must still be selected').toContain('cf-cache-status');
    expect(
      zone.some((l) => l.toLowerCase().startsWith(MARKER)),
      'a cf-cache-status HIT with no marker satisfied the marker stop condition — the old false green is back',
    ).toBe(false);

    const fn = selectLines(pattern, FUNCTION_HIT_ZONE_DYNAMIC);
    expect(
      fn.some((l) => l.toLowerCase() === `${MARKER}: hit`),
      `the step's own grep did not select \`${MARKER}: hit\`, so the founder would never see the pass`,
    ).toBe(true);
    expect(
      fn.some((l) => l.toLowerCase().includes('dynamic')),
      'the zone verdict must still be printed alongside, so DYNAMIC is on the record',
    ).toBe(true);
  });

  test('plant — the stop condition reverted to `cf-cache-status: HIT` is rejected', () => {
    const planted = real.replace(`- \`${MARKER}: hit\``, '- `cf-cache-status: HIT`');
    expect(planted, 'the plant did not land').not.toBe(real);
    const v = cacheProbeViolations(planted).join('\n');
    expect(v).toContain(`no stop condition names the exact value \`${MARKER}: hit\``);
    expect(v).toContain('`cf-cache-status` is a stop condition again');
  });

  test('plant — the marker dropped from the grep is rejected', () => {
    const planted = real.replaceAll(`|^${MARKER}`, '');
    expect(planted, 'the plant did not land').not.toBe(real);
    expect(cacheProbeViolations(planted).join('\n')).toContain(`does not select ${MARKER}`);
  });

  test('plant — a grep narrowed to the marker alone is rejected, because status and type carry the step', () => {
    const step = cacheStep(real) as string;
    const pattern = grepPatterns(step)[0] as string;
    const planted = real.replaceAll(pattern, `^${MARKER}`);
    expect(planted, 'the plant did not land').not.toBe(real);
    const v = cacheProbeViolations(planted).join('\n');
    expect(v).toContain('does not select ^HTTP');
    expect(v).toContain('does not select ^content-type');
  });

  test('plant — the failing half removed is rejected', () => {
    const planted = real.replace(/sleep 40/g, 'sleep 0');
    expect(planted, 'the plant did not land').not.toBe(real);
    expect(cacheProbeViolations(planted).join('\n')).toContain('failing half');
  });

  test('anti-vacuity — a runbook with no step 6 fails', () => {
    expect(cacheProbeViolations('# nothing here\n').join('\n')).toContain('runbook step 6 not found');
    expect(cacheProbeViolations('').join('\n')).toContain('runbook step 6 not found');
  });
});
