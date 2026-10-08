import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE PUBLIC DASHBOARD'S CONTENT-SECURITY-POLICY IS UNCHANGED BY THE FACILITY CARD (R-2026-09-30-214 GN:
 * "Nothing is fetched from Google; assert the CSP is unchanged"). GUARD CLASS: LIVE: the tracked headers
 * file exists now, and so does the commit it is compared with.
 *
 * The Directions link is an anchor to https://www.google.com/maps/dir/. Clicking it is a NAVIGATION by the
 * browser, not a connection the page makes, so `connect-src 'self'` and every other directive stand
 * exactly as they were. This reads the CSP line of apps/public-dashboard/public/_headers AS AT 6866161 from
 * git and compares it, byte for byte, with the line in the working tree. Equality with a commit is stronger
 * than security_headers.test.ts's directive rules, which a widened policy could still satisfy (a host added
 * to img-src, say, passes "img-src 'self' data:" only if it is rejected, and this makes the question moot).
 * The same is done for the Referrer-Policy line, because `no-referrer` is what keeps the Directions click
 * from telling Google which page it came from.
 *
 * NOT ASSERTED HERE, deliberately: the header Cloudflare actually serves. That is
 * scripts/readback_pages.sh, run by the founder against a deployment (hosted order step (a)); no test in
 * this repository can see a deployment. A CSP in the tracked file is a statement of intent until that
 * read-back, which is Clause 5's distinction.
 */

const REF = '6866161';
const HEADERS = 'apps/public-dashboard/public/_headers';

function atRef(path: string): string {
  try {
    return execFileSync('git', ['-C', REPO_ROOT, 'show', `${REF}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(
      `cannot read ${path} at ${REF} from git, so the headers cannot be compared with it. ` +
        `If this is CI, the job's checkout is too shallow: it needs fetch-depth: 0. git said: ${String(e)}`,
    );
  }
}

/** The one header line starting with `name:`, trimmed, or null if there is none or more than one. */
export function headerLine(text: string, name: string): string | null {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return lines.length === 1 ? (lines[0] as string) : null;
}

/** Every way the working tree's headers differ from the commit's on the two lines the card must not touch. */
export function headerDrift(now: string, then: string): string[] {
  const out: string[] = [];
  for (const name of ['Content-Security-Policy', 'Referrer-Policy']) {
    const a = headerLine(now, name);
    const b = headerLine(then, name);
    if (b === null) out.push(`${name}: the commit has no single ${name} line, so there is nothing to compare with`);
    else if (a === null) out.push(`${name}: the working tree has no single ${name} line`);
    else if (a !== b) out.push(`${name} changed:\n  was ${b}\n  now ${a}`);
  }
  return out;
}

describe('the public dashboard CSP is unchanged since 6866161', () => {
  const then = atRef(HEADERS);
  const now = readFileSync(join(REPO_ROOT, HEADERS), 'utf8');

  test('real headers are accepted — the CSP and Referrer-Policy lines are byte for byte the commit\'s', () => {
    expect(headerDrift(now, then)).toEqual([]);
  });

  test('anti-vacuity — the commit\'s CSP line exists, names connect-src \'self\', and names no Google host', () => {
    const csp = headerLine(then, 'Content-Security-Policy');
    expect(csp, 'the commit has no single CSP line').not.toBeNull();
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toMatch(/google/i);
  });

  test('anti-vacuity — an empty headers file has nothing to compare, and says so', () => {
    expect(headerDrift('', then).join('\n')).toContain('the working tree has no single Content-Security-Policy line');
    expect(headerDrift(now, '').join('\n')).toContain('the commit has no single Content-Security-Policy line');
  });

  test('plant — a CSP with Google added to connect-src is rejected', () => {
    const planted = now.replace("connect-src 'self'", "connect-src 'self' https://www.google.com");
    expect(planted, 'the plant did not change the file').not.toBe(now);
    expect(headerDrift(planted, then).join('\n')).toContain('Content-Security-Policy changed');
  });

  test('plant — a CSP with img-src widened for map tiles is rejected', () => {
    const planted = now.replace("img-src 'self' data:", "img-src 'self' data: https://maps.gstatic.com");
    expect(planted).not.toBe(now);
    expect(headerDrift(planted, then).join('\n')).toContain('Content-Security-Policy changed');
  });

  test('plant — a Referrer-Policy weakened from no-referrer is rejected', () => {
    const planted = now.replace('Referrer-Policy: no-referrer', 'Referrer-Policy: origin');
    expect(planted).not.toBe(now);
    expect(headerDrift(planted, then).join('\n')).toContain('Referrer-Policy changed');
  });
});
