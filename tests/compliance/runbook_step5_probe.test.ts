import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER A HAND CHECK -- runbook step 5's post-apply schema-cache probe.
 *
 * WHAT IT PROTECTS. After migration 015 drops and recreates ward_status_history,
 * the founder sends a PostgREST reload and probes the hosted RPC with the
 * publishable key. Two 42501 answers are possible, observed on the local stack
 * 2026-09-15: a fresh cache names the FUNCTION, a stale cache names SCHEMA APP.
 * The probe passes on the fresh string only, stops on the stale one, and fails
 * on anything else (ruling R-2026-09-15-03: a probe that passes once it stops
 * understanding the answer is vacuity in a different costume).
 *
 * WHY A TEST OVER PROSE. The probe is a `case` in a fenced block, and the easy
 * regression is an edit that loosens it -- a default arm that echoes PASS, a
 * pattern widened to `*42501*`, which both answers satisfy, or the two strings
 * swapped. Each of those still reads as a careful probe.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - That the hosted project answers with these strings. That is the founder's
 *     observation at apply time; it cannot be made from the repository, and
 *     this test must not be read as covering it (Clause 4).
 *   - That the local observation still holds. It was made by hand with a
 *     stale-cache plant; the strings are recorded with their date.
 */

const RUNBOOK = join(REPO_ROOT, 'docs/runbook-supabase-project-creation.md');
const FRESH = '"permission denied for function ward_status_history"';
const STALE = '"permission denied for schema app"';

/** The `case` arms of the fenced block in step 5 that probes ward_status_history. */
export function probeViolations(markdown: string): string[] {
  const step = /^## 5\. [\s\S]*?(?=^## 6\. )/m.exec(markdown)?.[0];
  if (!step) return ['runbook step 5 not found — the probe guard checked nothing'];
  const fences = [...step.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1] as string);
  const probe = fences.filter((f) => f.includes('rpc/ward_status_history'));
  if (probe.length !== 1) return [`expected exactly one step 5 fence probing rpc/ward_status_history, found ${probe.length}`];
  const arms = [...(probe[0] as string).matchAll(/^\s*(\S.*?)\)\s*echo "([A-Z]+):/gm)].map((m) => ({ pattern: m[1] as string, verdict: m[2] as string }));
  const out: string[] = [];
  const pass = arms.filter((a) => a.verdict === 'PASS');
  if (pass.length !== 1 || !pass[0]?.pattern.includes(FRESH) || pass[0].pattern.includes(STALE)) {
    out.push(`the PASS arm must match exactly the fresh-cache message ${FRESH}`);
  }
  if (!arms.some((a) => a.verdict === 'STOP' && a.pattern.includes(STALE))) {
    out.push(`no STOP arm matches the stale-cache message ${STALE}`);
  }
  const dflt = arms.filter((a) => a.pattern === '*');
  if (dflt.length !== 1 || dflt[0]?.verdict !== 'FAIL') {
    out.push('the default arm must echo FAIL — an answer matching neither string is a failure, never a pass');
  }
  for (const a of arms) {
    if (a.pattern !== '*' && !a.pattern.includes('permission denied for')) {
      out.push(`an arm matches something other than an observed message: ${a.pattern}`);
    }
  }
  return out;
}

const real = readFileSync(RUNBOOK, 'utf8');

describe('runbook step 5 post-apply probe', () => {
  test('real runbook step 5 probe is accepted', () => {
    expect(probeViolations(real), 'the step 5 probe no longer separates fresh, stale and neither').toEqual([]);
  });

  test('plant — a default arm that passes is rejected', () => {
    const planted = real.replace('*) echo "FAIL: the answer matches neither', '*) echo "PASS: the answer matches neither');
    expect(planted, 'the plant did not land').not.toBe(real);
    expect(probeViolations(planted).join('\n')).toContain('the default arm must echo FAIL');
  });

  test('plant — the fresh and stale strings swapped is rejected', () => {
    const planted = real
      .replace(`*'${FRESH}'*) echo "PASS`, `*'__S__'*) echo "PASS`)
      .replace(`*'${STALE}'*) echo "STOP`, `*'${FRESH}'*) echo "STOP`)
      .replace(`*'__S__'*) echo "PASS`, `*'${STALE}'*) echo "PASS`);
    expect(planted, 'the plant did not land').not.toBe(real);
    const v = probeViolations(planted).join('\n');
    expect(v).toContain('the PASS arm must match exactly the fresh-cache message');
    expect(v).toContain('no STOP arm matches the stale-cache message');
  });

  test('plant — a PASS pattern widened to the shared error code is rejected', () => {
    const planted = real.replace(`*'${FRESH}'*) echo "PASS`, `*42501*) echo "PASS`);
    expect(planted, 'the plant did not land').not.toBe(real);
    const v = probeViolations(planted).join('\n');
    expect(v).toContain('the PASS arm must match exactly the fresh-cache message');
    expect(v).toContain('an arm matches something other than an observed message');
  });

  test('anti-vacuity — a runbook with no step 5 probe fails', () => {
    expect(probeViolations('# nothing here\n').join('\n')).toContain('runbook step 5 not found');
    const noProbe = real.replace(/rpc\/ward_status_history/g, 'rpc/removed');
    expect(probeViolations(noProbe).join('\n')).toContain('expected exactly one step 5 fence probing rpc/ward_status_history, found 0');
  });
});
