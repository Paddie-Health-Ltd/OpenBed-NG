import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

/**
 * NO CALLER OF THE OLD ARITY REMAINS (R-2026-09-30-214 GN, addendum 1: "a test proves no caller of the old
 * arity remains"). GUARD CLASS: LIVE: the callers it scans (the admin app's bodies, the database tests,
 * the golden path, the fixtures, the runbooks) exist now, and the replaced functions are 031's.
 *
 * 031 REPLACED public.operator_create_facility (7 arguments) and public.operator_edit_facility (8) with an
 * 8- and a 9-argument function, both with p_address required. A caller still on the old shape does not
 * get a quiet success, it gets "function does not exist"; this guard finds such a caller BEFORE it runs.
 * Two shapes are read, because a caller is written two ways:
 *   1. a positional call or signature, `operator_create_facility(a, b, ...)`: the top-level arguments are
 *      counted, quotes and nested brackets respected, and the count must be the new arity;
 *   2. a named body, `{ p_id: ..., p_public_phone_e164: ..., }` (the shape PostgREST takes): every object
 *      literal that carries the `p_public_phone_e164:` key, which only these two functions take, must
 *      carry `p_address` in the SAME braces.
 *
 * THE CORPUS is every tracked text file (`git ls-files`) outside database/migrations/, where migrations
 * 001 to 030 are frozen history by sha256 and 031 and its down name BOTH shapes on purpose. A line that
 * names the old shape deliberately (a test proving it is refused, a round trip naming the state it
 * restores) carries the marker OLD_ARITY_ON_PURPOSE on the same line or the line above it, and the files
 * that may carry it are a literal list below, so a marker cannot be added to hide a real caller without
 * editing this file in the same change.
 *
 * NOT ASSERTED HERE, deliberately: a caller that BUILDS the argument list at run time (a spread of a
 * variable, a loop). This is a lexical scan and cannot see through one. The types do: FacilityFields
 * requires `address`, and tests/db/admin_calls_live.test.ts calls the live functions through the page's own
 * body builders.
 */

const ARITY: Record<string, number> = { operator_create_facility: 8, operator_edit_facility: 9 };
const MARKER = 'OLD_ARITY_ON_PURPOSE';
const SELF = 'tests/compliance/no_old_operator_arity.test.ts';

/** The files that may carry the marker, by identity. A new one is an edit to this list. */
const MAY_CARRY_MARKER = [
  'tests/compliance/no_old_operator_arity.test.ts',
  'tests/db/admin_calls_live.test.ts',
  'tests/db/facility_address.test.ts',
  'tests/db/migration_031_round_trip.test.ts',
];

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

/** The number of top-level arguments of the call whose '(' is at `open`, or null if it never closes. */
function argCount(text: string, open: number): number | null {
  let depth = 0;
  let quote: string | null = null;
  let args = 0;
  let sawContent = false;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i] as string;
    if (quote !== null) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      sawContent = true;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth += 1;
      if (depth > 1) sawContent = true;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) return sawContent ? args + 1 : 0;
      continue;
    }
    if (c === ',' && depth === 1) {
      args += 1;
      continue;
    }
    if (!/\s/.test(c)) sawContent = true;
  }
  return null;
}

/** The text between the unmatched '{' before `at` and its matching '}', or null. */
function enclosingBraces(text: string, at: number): string | null {
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i -= 1) {
    const c = text[i] as string;
    if (c === '}') depth += 1;
    else if (c === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i] as string;
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;
const marked = (text: string, index: number): boolean => {
  const lines = text.split('\n');
  const n = lineOf(text, index) - 1;
  return (lines[n] ?? '').includes(MARKER) || (lines[n - 1] ?? '').includes(MARKER);
};

export interface Scan {
  readonly violations: string[];
  readonly callSites: Record<string, number>;
  readonly bodyLiterals: number;
}

export function scan(files: readonly SourceFile[]): Scan {
  const violations: string[] = [];
  const callSites: Record<string, number> = { operator_create_facility: 0, operator_edit_facility: 0 };
  let bodyLiterals = 0;
  for (const f of files) {
    if (f.text.includes(MARKER) && !MAY_CARRY_MARKER.includes(f.path)) {
      violations.push(`${f.path}: carries ${MARKER} but is not on the list of files that may`);
    }
    for (const m of f.text.matchAll(/\b(operator_create_facility|operator_edit_facility)\s*\(/g)) {
      const name = m[1] as string;
      const open = (m.index ?? 0) + m[0].length - 1;
      const n = argCount(f.text, open);
      callSites[name] = (callSites[name] ?? 0) + 1;
      if (n === null || n === ARITY[name]) continue;
      if (marked(f.text, m.index ?? 0)) continue;
      violations.push(`${f.path}:${lineOf(f.text, m.index ?? 0)}: ${name} is called or declared with ${n} arguments, the function takes ${ARITY[name]}`);
    }
    for (const m of f.text.matchAll(/\bp_public_phone_e164\s*:/g)) {
      const body = enclosingBraces(f.text, m.index ?? 0);
      bodyLiterals += 1;
      if (body === null || body.includes('p_address')) continue;
      if (marked(f.text, m.index ?? 0)) continue;
      violations.push(`${f.path}:${lineOf(f.text, m.index ?? 0)}: a body carries p_public_phone_e164 with no p_address, the old shape`);
    }
  }
  return { violations, callSites, bodyLiterals };
}

/** Every tracked text file outside the frozen and deliberate migration directory. */
function corpus(): SourceFile[] {
  const listed = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((p) => p !== '');
  return listed
    // This file is excluded BY PATH, and only this file: its header and its plants name the old shape by
    // construction (a plant that did not contain one would plant nothing), and it carries no real caller.
    .filter((p) => !p.startsWith('database/migrations/') && !p.startsWith('node_modules/') && p !== SELF)
    .filter((p) => /\.(ts|mjs|sh|sql|md|json|toml|yml|yaml)$/.test(p))
    .map((p) => ({ path: p, text: readFileSync(join(REPO_ROOT, p), 'utf8') }));
}

describe('no caller of the replaced operator functions is still on the old arity', () => {
  test('real corpus is accepted — every call, signature and body names the new shape', () => {
    const r = scan(corpus());
    expect(r.violations).toEqual([]);
  });

  test('anti-vacuity — the real corpus holds call sites of BOTH functions and body literals, so the scan read something', () => {
    const r = scan(corpus());
    expect(r.callSites['operator_create_facility'], 'no call or signature of operator_create_facility was found').toBeGreaterThan(0);
    expect(r.callSites['operator_edit_facility'], 'no call or signature of operator_edit_facility was found').toBeGreaterThan(0);
    expect(r.bodyLiterals, 'no named body was found').toBeGreaterThan(0);
  });

  test('anti-vacuity — an empty corpus finds nothing, and the check on it above would have failed', () => {
    const r = scan([]);
    expect(r.callSites).toEqual({ operator_create_facility: 0, operator_edit_facility: 0 });
    expect(r.bodyLiterals).toBe(0);
  });

  test("plant — a positional call to the 7-argument create is rejected, naming the file, the line and the counts", () => {
    const text = "select * from public.operator_create_facility('id', 'n', 'l', 's', 6.5, 3.4, '+2348000000000')";
    const r = scan([{ path: 'x/old.sql', text }]);
    expect(r.violations).toEqual(['x/old.sql:1: operator_create_facility is called or declared with 7 arguments, the function takes 8']);
  });

  test('plant — a call to the 8-argument edit is rejected, including one split across lines with a nested call and a quoted comma', () => {
    const text = [
      'const q = `',
      "  select * from public.operator_edit_facility('${id}',",
      "    ${v}, ${f(a, b)}, 'Smith, Jones', 'Lagos', 6.6, 3.35,",
      "    '+2348000000301')`;",
    ].join('\n');
    const r = scan([{ path: 'x/old.ts', text }]);
    expect(r.violations.join('\n')).toContain('operator_edit_facility is called or declared with 8 arguments, the function takes 9');
  });

  test('plant — an old signature list (types only) is rejected the same way', () => {
    const r = scan([{ path: 'x/grants.json', text: '"public.operator_edit_facility(text, integer, text, text, text, double precision, double precision, text)"' }]);
    expect(r.violations.join('\n')).toContain('8 arguments, the function takes 9');
  });

  test('plant — a named body with p_public_phone_e164 and NO p_address is rejected; the same body with it is accepted', () => {
    const old = "const body = { p_id: id, p_name: 'x', p_public_phone_e164: '+2348000000000' };";
    const ok = "const body = { p_id: id, p_name: 'x', p_public_phone_e164: '+2348000000000', p_address: '1 A Street' };";
    expect(scan([{ path: 'x/body.ts', text: old }]).violations.join('\n')).toContain('no p_address');
    expect(scan([{ path: 'x/body.ts', text: ok }]).violations).toEqual([]);
  });

  test('accept — the new arity is accepted for both functions', () => {
    const text = [
      "select * from public.operator_create_facility('i', 'n', 'l', 's', 6.5, 3.4, '+2348000000000', '1 A Street');",
      "select * from public.operator_edit_facility('f', 1, 'n', 'l', 's', 6.5, 3.4, '+2348000000000', '1 A Street');",
    ].join('\n');
    expect(scan([{ path: 'x/new.sql', text }]).violations).toEqual([]);
  });

  test('a marked line is accepted in a file that may carry the marker, and the marker anywhere else is itself a violation', () => {
    const text = `-- ${MARKER}: proves the old shape is refused\nselect * from public.operator_create_facility('i', 'n', 'l', 's', 6.5, 3.4, '+2348000000000');`;
    expect(scan([{ path: 'tests/db/facility_address.test.ts', text }]).violations).toEqual([]);
    expect(scan([{ path: 'apps/admin/src/main.ts', text }]).violations.join('\n')).toContain('is not on the list of files that may');
  });
});
