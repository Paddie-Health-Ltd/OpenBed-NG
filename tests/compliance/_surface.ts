/**
 * THE WORKER RUNBOOK'S "SURFACE" TABLE, RENDERED (R-2026-09-30-177 FA-1 e).
 *
 * docs/runbook-cloudflare-worker-proxy.md section 5 holds a markdown table of every
 * `forward` entry in supabase-proxy/allow-list.json, in file order: method, path, the
 * one query it pins, the limit bound to it (its wrangler.json binding and number) and
 * the reason. The table is not written by hand: this function renders it, and
 * tests/compliance/proxy_surface_table.test.ts compares it, byte for byte, with the text
 * between the runbook's two markers. There is no script that writes it into the runbook;
 * it was written once from this function's output, and the test is what keeps it equal.
 *
 * No test framework import, so the same function can be run by hand with node to print
 * the table: `node -e "import('./tests/compliance/_surface.ts').then(...)"`.
 */

export interface SurfaceEntry {
  readonly method: string;
  readonly path: string;
  readonly query?: string;
  readonly reason?: string;
  readonly preflight_for?: string;
  readonly limit?: string;
}

export interface SurfaceWrangler {
  readonly ratelimits?: readonly { name?: string; simple?: { limit?: number; period?: number } }[];
}

export const SURFACE_BEGIN = '<!-- surface:begin -->';
export const SURFACE_END = '<!-- surface:end -->';

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderSurface(forward: readonly SurfaceEntry[], wrangler: SurfaceWrangler): string {
  const numbers = new Map((wrangler.ratelimits ?? []).map((b) => [b.name ?? '', `${b.simple?.limit ?? '?'} per ${b.simple?.period ?? '?'} s`]));
  const rows = forward.map((e) => {
    const limit = e.limit === undefined ? '—' : `${e.limit} (${numbers.get(e.limit) ?? 'unbound'})`;
    const reason = e.reason ?? (e.preflight_for === undefined ? '' : `preflight for ${e.preflight_for}`);
    return `| ${e.method} | ${cell(e.path)} | ${e.query === undefined ? '—' : cell(e.query)} | ${limit} | ${cell(reason)} |`;
  });
  return ['| Method | Path | Pinned query | Limit | Reason |', '|---|---|---|---|---|', ...rows].join('\n');
}

/** The text between the two markers, without the newline after the first and before the second, or null. */
export function surfaceBetween(doc: string): string | null {
  const a = doc.indexOf(SURFACE_BEGIN);
  const b = doc.indexOf(SURFACE_END);
  if (a < 0 || b < 0 || b < a) return null;
  return doc.slice(a + SURFACE_BEGIN.length, b).replace(/^\n/, '').replace(/\n$/, '');
}
