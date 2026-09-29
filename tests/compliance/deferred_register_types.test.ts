import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import * as register from '../../scripts/deferred_register.mjs';
import { REPO_ROOT } from './_scratch.js';

/**
 * GUARD: scripts/deferred_register.d.mts DECLARES WHAT scripts/deferred_register.mjs EXPORTS
 * (R-2026-09-29-172, EV-2 a).
 *
 * THE GAP. TypeScript trusts a `.d.mts`. Nothing compiled it against the module it describes,
 * so a declaration could drift -- an export renamed, KINDS reordered, a field dropped from
 * Row -- while `npm run typecheck` stayed green and every importer went on believing the
 * declaration. The charter's FINDING for that file was exactly this: nothing executes it.
 *
 * WHAT IS HELD, by parsing the declaration with TypeScript's own parser and comparing it with
 * the module as it runs:
 *   - the declared VALUE exports (export declare const / function) equal Object.keys of the
 *     import, in both directions;
 *   - the declared KINDS tuple equals the runtime KINDS, in order;
 *   - Row's members, with their `string` or `number` types, equal the keys and typeof of a
 *     row the runtime parser actually returns.
 *
 * NOT ASSERTED HERE, deliberately: parseRegister's parameter and return types, beyond that
 * it is exported. They are compared by no parser here: a return type is a claim about every
 * row the function could produce, and one sample row proves its members, not its shape. The
 * `Row` check above is the part of that claim a parse can hold.
 */

const DTS = join(REPO_ROOT, 'scripts', 'deferred_register.d.mts');

interface Declared {
  errors: string[];
  values: string[];
  kinds: string[] | null;
  row: Map<string, string> | null;
}

/** What the declaration file says, read with TypeScript's parser. */
function declared(text: string): Declared {
  const sf = ts.createSourceFile('deferred_register.d.mts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  const out: Declared = { errors: [], values: [], kinds: null, row: null };
  if (diags === undefined || diags.length > 0) out.errors.push('the declaration file did not parse');
  const isExported = (n: ts.Node): boolean => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st) && isExported(st)) {
      for (const d of st.declarationList.declarations) {
        const name = d.name.getText(sf);
        out.values.push(name);
        if (name === 'KINDS' && d.type && ts.isTypeOperatorNode(d.type) && ts.isTupleTypeNode(d.type.type)) {
          out.kinds = d.type.type.elements.map((e) => (ts.isLiteralTypeNode(e) && ts.isStringLiteral(e.literal) ? e.literal.text : e.getText(sf)));
        }
      }
    } else if (ts.isFunctionDeclaration(st) && isExported(st) && st.name) {
      out.values.push(st.name.text);
    } else if (ts.isInterfaceDeclaration(st) && isExported(st) && st.name.text === 'Row') {
      out.row = new Map();
      for (const m of st.members) {
        if (!ts.isPropertySignature(m) || !m.type) continue;
        const t = m.type.kind === ts.SyntaxKind.StringKeyword ? 'string' : m.type.kind === ts.SyntaxKind.NumberKeyword ? 'number' : m.type.getText(sf);
        out.row.set(m.name.getText(sf), t);
      }
    }
  }
  return out;
}

/** A row the runtime parser really returns. */
function runtimeRow(): Record<string, unknown> {
  const record = [register.SECTION, '', register.HEADER, '|---|---|---|---|', '| an item | R-2026-09-26-121 CW-2 | BOX | a gate |', ''].join('\n');
  const parsed = register.parseRegister(record);
  expect(parsed.errors, 'precondition: the sample record did not parse, so Row is compared with nothing').toEqual([]);
  return parsed.rows[0] as unknown as Record<string, unknown>;
}

/** Every way the declaration text disagrees with the module as it runs. */
export function typeViolations(text: string): string[] {
  const d = declared(text);
  const out = [...d.errors];
  const actual = Object.keys(register);
  if (actual.length === 0) return ['the module exports nothing at runtime, so there is nothing to declare'];
  for (const k of actual) if (!d.values.includes(k)) out.push(`${k} is exported at runtime and is not declared`);
  for (const k of d.values) if (!actual.includes(k)) out.push(`${k} is declared and is not exported at runtime`);

  if (d.kinds === null) out.push('KINDS is not declared as a readonly tuple of string literals');
  else if (JSON.stringify(d.kinds) !== JSON.stringify(register.KINDS)) {
    out.push(`KINDS is declared as ${JSON.stringify(d.kinds)} and is ${JSON.stringify(register.KINDS)} at runtime`);
  }

  if (d.row === null) out.push('Row is not declared as an exported interface');
  else {
    const row = runtimeRow();
    for (const [k, v] of Object.entries(row)) {
      const t = d.row.get(k);
      if (t === undefined) out.push(`Row has no member ${k}, and a parsed row has one`);
      else if (t !== typeof v) out.push(`Row.${k} is declared ${t} and is ${typeof v} at runtime`);
    }
    for (const k of d.row.keys()) if (!(k in row)) out.push(`Row declares ${k}, and a parsed row has no such member`);
  }
  return out;
}

const REAL = readFileSync(DTS, 'utf8');

/** The real declaration with one textual change; the plant is confirmed to have landed. */
function planted(from: string, to: string): string[] {
  const text = REAL.replace(from, to);
  expect(text, `the plant did not land: ${from}`).not.toBe(REAL);
  return typeViolations(text);
}

describe('deferred_register.d.mts declares what deferred_register.mjs exports', () => {
  test('real deferred_register.d.mts is accepted', () => {
    expect(typeViolations(REAL), 'the declaration disagrees with the module it describes').toEqual([]);
  });

  test('plant — a missing export is rejected', () => {
    expect(planted('export declare const HEADER: string;\n', '')).toContain('HEADER is exported at runtime and is not declared');
  });

  test('plant — an extra export is rejected', () => {
    expect(planted('export declare const HEADER: string;\n', 'export declare const HEADER: string;\nexport declare const EXTRA: string;\n')).toContain(
      'EXTRA is declared and is not exported at runtime',
    );
  });

  test('plant — KINDS reordered is rejected', () => {
    const v = planted("readonly ['BOX', 'TRIGGER', 'VERSION']", "readonly ['TRIGGER', 'BOX', 'VERSION']");
    expect(v).toContain('KINDS is declared as ["TRIGGER","BOX","VERSION"] and is ["BOX","TRIGGER","VERSION"] at runtime');
  });

  test('plant — Row without line is rejected', () => {
    expect(planted('  line: number;\n', '')).toContain('Row has no member line, and a parsed row has one');
  });

  test('plant — Row.line declared as a string is rejected', () => {
    expect(planted('  line: number;\n', '  line: string;\n')).toContain('Row.line is declared string and is number at runtime');
  });

  test('anti-vacuity — an empty declaration file fails', () => {
    const v = typeViolations('');
    expect(v.length, 'an empty declaration was accepted').toBeGreaterThan(0);
    expect(v).toContain('KINDS is not declared as a readonly tuple of string literals');
    expect(v).toContain('Row is not declared as an exported interface');
  });
});
