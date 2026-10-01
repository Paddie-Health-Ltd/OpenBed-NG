import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import LIST from '../../supabase-proxy/allow-list.json';
import WRANGLER from '../../supabase-proxy/wrangler.json';
import { REPO_ROOT } from './_scratch.js';
import { renderSurface, surfaceBetween, SURFACE_BEGIN, SURFACE_END, type SurfaceEntry, type SurfaceWrangler } from './_surface.js';

/**
 * THE WORKER RUNBOOK'S SURFACE TABLE EQUALS THE ALLOW-LIST (R-2026-09-30-177 FA-1 e).
 *
 * docs/runbook-cloudflare-worker-proxy.md section 5 shows every `forward` entry, in
 * file order, with the limit bound to it and its reason, between two markers. The test
 * renders the table from supabase-proxy/allow-list.json and supabase-proxy/wrangler.json
 * (tests/compliance/_surface.ts) and compares it byte for byte with the text between
 * the markers. A file entry missing from the table, a row not in the file, an edited
 * reason, query or limit, and missing markers each turn it red. The five paragraphs
 * that follow the table are held only by their lead-ins being present: a paragraph is
 * prose, and what it says about the Worker is held by the tests of the Worker.
 *
 * GUARD CLASS (Clause 5): LIVE. The table, the list and the wrangler.json it reads all
 * exist at this commit.
 *
 * NOT ASSERTED HERE, deliberately: that the five paragraphs after the table are TRUE.
 * They name tests (proxy_allow_list.test.ts and the read-back probes), which hold them.
 */

const RUNBOOK = join(REPO_ROOT, 'docs', 'runbook-cloudflare-worker-proxy.md');
const FORWARD = (LIST as unknown as { forward: SurfaceEntry[] }).forward;
const WR = WRANGLER as unknown as SurfaceWrangler;
/** A binding's limit as the table's limit column prints it, from wrangler.json: no number is typed twice. */
const limitCell = (name: string): string => {
  const b = (WR.ratelimits ?? []).find((x) => x.name === name);
  return `${name} (${String(b?.simple?.limit)} per ${String(b?.simple?.period)} s)`;
};
const LEAD_INS = ['**Methods.**', '**Services reached.**', '**Websocket upgrades.**', '**Location under manual redirect.**', '**CORS.**'];

export function surfaceViolations(doc: string, forward: readonly SurfaceEntry[], wrangler: SurfaceWrangler): string[] {
  const between = surfaceBetween(doc);
  if (between === null) return [`SURFACE MARKERS: the runbook has no ${SURFACE_BEGIN} ... ${SURFACE_END} pair, so nothing was compared`];
  const want = renderSurface(forward, wrangler).split('\n');
  const got = between.split('\n');
  const out: string[] = [];
  const n = Math.max(want.length, got.length);
  for (let i = 0; i < n; i++) {
    if (want[i] !== got[i]) {
      out.push(`SURFACE DRIFT: line ${i + 1} of the table reads ${JSON.stringify(got[i] ?? '(missing)')}, rendered from the allow-list it must read ${JSON.stringify(want[i] ?? '(none)')}`);
      break;
    }
  }
  // The markers must sit in prose: inside a fence, a probe parser reads the table as a command block.
  const fences = doc.slice(0, doc.indexOf(SURFACE_BEGIN)).split('\n').filter((l) => /^\s*```/.test(l)).length;
  if (fences % 2 === 1) out.push('SURFACE FENCED: the surface markers are inside a fenced block, and the table must be outside any fence');
  const after = doc.slice(doc.indexOf(SURFACE_END));
  for (const lead of LEAD_INS) if (!after.includes(lead)) out.push(`SURFACE PROPERTY: the paragraph that begins ${lead} is missing after the table`);
  return out;
}

describe('the runbook surface table equals the allow-list (FA-1 e)', () => {
  const real = readFileSync(RUNBOOK, 'utf8');
  /** A plant edits the real runbook; the precondition proves it changed. */
  const planted = (from: string | RegExp, to: string): string => {
    const after = real.replace(from, to);
    expect(after, 'the plant did not change the runbook').not.toBe(real);
    return after;
  };

  test('real runbook is accepted — the table is the one rendered from the real list and wrangler.json', () => {
    expect(surfaceViolations(real, FORWARD, WR)).toEqual([]);
  });

  test('the table shows every forward entry once, in file order, and the three limited ones carry their binding', () => {
    const rows = (surfaceBetween(real) ?? '').split('\n').slice(2);
    expect(rows.length, 'a row per forward entry').toBe(FORWARD.length);
    expect(rows.filter((r) => /LIMIT_[A-Z]+ \(/.test(r)).map((r) => r.split('|').slice(1, 5).map((c) => c.trim()).join(' / '))).toEqual([
      `POST / /auth/v1/otp / — / ${limitCell('LIMIT_OTP')}`,
      `POST / /auth/v1/token / grant_type=refresh_token / ${limitCell('LIMIT_REFRESH')}`,
      `GET / /auth/v1/verify / — / ${limitCell('LIMIT_VERIFY')}`,
    ]);
  });

  test('plant — a file entry missing from the table is rejected', () => {
    const v = surfaceViolations(planted(/\n\| POST \| \/rest\/v1\/rpc\/publish_ward_status \|[^\n]*/, ''), FORWARD, WR);
    expect(v.join('\n')).toContain('SURFACE DRIFT: line ');
  });

  test('plant — a row the file does not hold is rejected', () => {
    const v = surfaceViolations(planted('<!-- surface:end -->', '| GET | /realtime/v1/websocket | — | — | planted |\n<!-- surface:end -->'), FORWARD, WR);
    expect(v.join('\n')).toContain('SURFACE DRIFT: line ');
    expect(v.join('\n')).toContain('(none)');
  });

  test('plant — an edited reason, an edited query and an edited limit are each rejected', () => {
    // Aimed at the TABLE ROW: the first occurrence of a phrase can be in the prose above the markers,
    // and a plant there leaves the table alone, so the guard is right to stay green.
    expect(surfaceViolations(planted(/(\| POST \| \/rest\/v1\/rpc\/publish_ward_status \|[^\n]*)a ward publishes/, '$1a ward publishes twice'), FORWARD, WR).join('\n')).toContain('SURFACE DRIFT: line ');
    expect(surfaceViolations(planted(/(\| POST \| \/auth\/v1\/token \| )grant_type=refresh_token/, '$1grant_type=password'), FORWARD, WR).join('\n')).toContain('SURFACE DRIFT: line ');
    const otp = limitCell('LIMIT_OTP');
    const escaped = otp.replace(/[()]/g, '\\$&');
    expect(surfaceViolations(planted(new RegExp(`(\\| POST \\| \\/auth\\/v1\\/otp \\| — \\| )${escaped}`), `$1${otp.replace(/\d+ per/, '200 per')}`), FORWARD, WR).join('\n')).toContain('SURFACE DRIFT: line ');
  });

  test('plant — the same table against a wrangler.json whose number moved is rejected: the limit column is read from it', () => {
    const moved: SurfaceWrangler = { ratelimits: (WR.ratelimits ?? []).map((b) => (b.name === 'LIMIT_OTP' ? { ...b, simple: { ...b.simple, limit: (b.simple?.limit ?? 0) + 1 } } : b)) };
    expect(surfaceViolations(real, FORWARD, moved).join('\n')).toContain('SURFACE DRIFT: line ');
  });

  test('plant — missing markers are rejected', () => {
    expect(surfaceViolations(planted(SURFACE_BEGIN, ''), FORWARD, WR)).toEqual([`SURFACE MARKERS: the runbook has no ${SURFACE_BEGIN} ... ${SURFACE_END} pair, so nothing was compared`]);
  });

  test('the markers are outside any fence, and a plant that wraps them in one is rejected (FB-3 k)', () => {
    expect(surfaceViolations(real, FORWARD, WR).filter((x) => x.startsWith('SURFACE FENCED'))).toEqual([]);
    const wrapped = planted(SURFACE_BEGIN, '```\n' + SURFACE_BEGIN).replace(SURFACE_END, SURFACE_END + '\n```');
    expect(wrapped, 'the plant did not wrap the markers').not.toBe(real);
    expect(surfaceViolations(wrapped, FORWARD, WR)).toContain('SURFACE FENCED: the surface markers are inside a fenced block, and the table must be outside any fence');
  });

  test('plant — a property paragraph removed is rejected', () => {
    expect(surfaceViolations(planted('**CORS.**', '**Cors.**'), FORWARD, WR)).toEqual(['SURFACE PROPERTY: the paragraph that begins **CORS.** is missing after the table']);
  });

  test('anti-vacuity — an empty forward list does not agree with the real table', () => {
    expect(surfaceViolations(real, [], WR).join('\n'), 'an empty list passed as agreeing').toContain('SURFACE DRIFT: line 3');
  });
});
