import * as acorn from 'acorn';
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * LEG ENUMERATION, PARSED FROM SOURCE.
 *
 * A LEG is one site in a guard script that can drive a non-zero exit and says so
 * with its own message. Its IDENTITY is the longest STATIC run in that message --
 * the substring a test can assert with `toContain`.
 *
 * WHY PARSED AND NOT DECLARED. The obvious alternative is a hand-maintained
 * `LEG LEDGER` comment in each script's header. That ledger would drift from the
 * code it describes, which is the exact defect the register exists to prevent,
 * one level in. Parsing is test-conventions section 3 applied to the guards
 * themselves: parse the artefact, assert against named things.
 *
 * A COROLLARY THAT IS A REQUIREMENT, NOT A LIMITATION. A leg whose message is
 * entirely interpolated -- `echo "FAIL: $(basename "$f"): $out"` -- has NO
 * assertable identity, and a reader at 2am gets a filename and a grep dump with
 * no statement of which rule fired. Four legs were in that state on 2026-09-10.
 * They were given static text as part of the sweep. `legsWithoutIdentity()`
 * below is what keeps them that way.
 */

export interface Leg {
  script: string;
  line: number;
  id: string;
}

/**
 * Static runs of a double-quoted shell string, skipping BALANCED `${...}` and
 * `$(...)`. A regex split cannot do this: `${f#"$ROOT"/}` and `$(basename "$f")`
 * both nest a quote inside the expansion, and a naive splitter ends the string
 * early and silently truncates the leg's identity.
 */
export function staticRuns(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '$' && (s[i + 1] === '{' || s[i + 1] === '(')) {
      const open = s[i + 1] as string;
      const close = open === '{' ? '}' : ')';
      let depth = 0;
      let j = i + 1;
      for (; j < s.length; j += 1) {
        if (s[j] === open) depth += 1;
        else if (s[j] === close) {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      out.push(cur);
      cur = '';
      i = j;
      continue;
    }
    if (s[i] === '$' && /[A-Za-z_?#]/.test(s[i + 1] ?? '')) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j] ?? '')) j += 1;
      out.push(cur);
      cur = '';
      i = j - 1;
      continue;
    }
    cur += s[i];
  }
  out.push(cur);
  return out.map((r) => r.replace(/^[\s:\-—'"]+|[\s:\-—'"]+$/g, '')).filter(Boolean);
}

const MIN_ID = 10;

export function longestStatic(message: string): string | null {
  const runs = staticRuns(message)
    // Strip the output marker. A test asserts the DESCRIPTIVE part -- nobody
    // writes `toContain('FAIL: ...')` -- so leaving the marker in the identity
    // would make every real assertion look like a miss.
    .map((r) => r.replace(/^(FAIL|ERROR|REFUSING):\s*/, '').trim())
    .filter((r) => r.length >= MIN_ID);
  return runs.sort((a, b) => b.length - a.length)[0] ?? null;
}

/**
 * Double-quoted strings on a line, scanned rather than regexed.
 *
 * A regex cannot do this: `$(basename "$f")` and `${f#"$ROOT"/}` nest a quote
 * INSIDE the expansion, so a regex terminates the string early and silently
 * truncates the leg's identity to `FAIL: $(basename "`. That truncation is what
 * made four real legs look identity-less on the first pass.
 */
function quotedStrings(line: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== '"') continue;
    let depth = 0;
    let j = i + 1;
    let buf = '';
    for (; j < line.length; j += 1) {
      const c = line[j] as string;
      if (c === '\\') {
        buf += c + (line[j + 1] ?? '');
        j += 1;
        continue;
      }
      if (c === '$' && (line[j + 1] === '(' || line[j + 1] === '{')) depth += 1;
      else if ((c === ')' || c === '}') && depth > 0) depth -= 1;
      else if (c === '"' && depth === 0) break;
      buf += c;
    }
    out.push(buf);
    i = j;
  }
  return out;
}

/**
 * EMITTERS ARE NOT LEGS. Some scripts funnel several legs through one `echo`,
 * with the identity carried in a variable set at the real site -- `$why` in
 * lint_grep_exit_codes.sh, `fail "$1"` in lint_migration_header.sh. The identity
 * sites are captured separately (the `why="..."` assignments, the `fail "..."`
 * call sites), so counting the funnel too would both double-count and report a
 * spurious identity-less leg.
 */
function isEmitter(line: string): boolean {
  return /\$why\b/.test(line) || /^fail\s*\(\)/.test(line) || /"FAIL: \$1"/.test(line);
}

/** Every string literal on a line that announces a failure. */
function failureMessages(line: string): string[] {
  if (isEmitter(line)) {
    // Still capture the identity-bearing assignments if they share the line.
    return [...line.matchAll(/\bwhy="([^"]+)"/g)].map((m) => m[1] as string);
  }
  const out: string[] = [];
  for (const m of line.matchAll(/\bwhy="([^"]+)"/g)) out.push(m[1] as string);
  for (const q of quotedStrings(line)) {
    // The OUTPUT forms only. A bare `FAILED` also matches the `FAILED[@]` array
    // name in lint_migrations_all.sh's `if` CONDITION, which is not a message.
    if (/FAIL:|ERROR:|REFUSING:|: FAILED/.test(q)) out.push(q);
  }
  for (const m of line.matchAll(/\bfail\s+"([^"]+)"/g)) out.push(m[1] as string);
  return out;
}

/**
 * NODE FAILURE SITES. A .mjs script announces failure with `console.error` and
 * `throw new Error`, not `echo "FAIL:"`, so the shell matcher sees nothing in
 * one and reports it as having no legs at all.
 *
 * Extended 2026-09-10, BEFORE writing scripts/provision_ward_account.mjs rather
 * than after. The corpus was `scripts/*.sh`, so a new script would have shipped
 * with unenumerated legs -- the exact gap this register exists to close,
 * arriving through a file extension. scripts/attest_counts.mjs comes in with it.
 */
function nodeFailureMessages(text: string): { msg: string; index: number }[] {
  const out: { msg: string; index: number }[] = [];
  for (const m of text.matchAll(/console\.error\(\s*(['"`])((?:[^\\]|\\.)*?)\1/g)) out.push({ msg: m[2] as string, index: m.index });
  for (const m of text.matchAll(/throw new Error\(\s*(['"`])((?:[^\\]|\\.)*?)\1/g)) out.push({ msg: m[2] as string, index: m.index });
  return out;
}

/**
 * Blanks every comment to spaces, preserving offsets so line numbers survive.
 *
 * WHY A REAL PARSE AND NOT A REGEX. Our own scripts contain `http://127.0.0.1`
 * inside string literals, and a regex that strips `//` to end of line would
 * delete the rest of those lines -- including any failure message on them. A
 * guard that stops seeing what it guards is the failure mode this whole
 * register exists to surface.
 *
 * A FILE THAT WILL NOT PARSE IS FATAL. Falling back to the raw text would mean
 * counting documentation as a leg; skipping the file would mean a script with
 * legs reporting none. Both are verdicts from a measurement that did not run.
 */
function blankComments(src: string, file: string): string {
  const comments: acorn.Comment[] = [];
  try {
    acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, onComment: comments });
  } catch (e) {
    throw new Error(`leg parser could not parse this script, so its legs were never enumerated: ${file}: ${String((e as Error).message)}`);
  }
  const out = src.split('');
  for (const c of comments) for (let i = c.start; i < c.end; i += 1) if (out[i] !== '\n') out[i] = ' ';
  return out.join('');
}

function lineAt(src: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i += 1) if (src[i] === '\n') n += 1;
  return n;
}

export function parseLegs(scriptsDir: string): Leg[] {
  const legs: Leg[] = [];
  for (const script of readdirSync(scriptsDir).filter((n) => n.endsWith('.mjs')).sort()) {
    // WHOLE FILE, NOT LINE BY LINE. The line-scoped version could not see a
    // failure site whose call and whose message sat on different lines, which
    // is how any `throw new Error(` with a long message is actually written.
    // scripts/scan_bundle_credentials.mjs shipped exactly one such leg and the
    // register reported the script as having none -- an instrument silently
    // not covering a shape it claims to cover, which is section 2(d) of
    // .claude/rules/test-conventions.md happening inside the instrument.
    const src = readFileSync(join(scriptsDir, script), 'utf8');
    const code = blankComments(src, script);
    for (const { msg, index } of nodeFailureMessages(code)) {
      const id = longestStatic(msg.replace(/\$\{[^}]*\}/g, '$X'));
      if (id !== null) legs.push({ script, line: lineAt(src, index), id });
    }
  }
  for (const script of readdirSync(scriptsDir).filter((n) => n.endsWith('.sh')).sort()) {
    readFileSync(join(scriptsDir, script), 'utf8').split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (line.startsWith('#')) return;
      // A PASS line is not a leg. It announces success and cannot drive a failure.
      if (/:\s*PASS\b/.test(line)) return;
      for (const msg of failureMessages(line)) {
        const id = longestStatic(msg);
        if (id !== null) legs.push({ script, line: i + 1, id });
      }
    });
  }
  return dedupe(legs);
}

/** One leg per (script, id): a message repeated across arms is still one leg. */
function dedupe(legs: Leg[]): Leg[] {
  const seen = new Set<string>();
  return legs.filter((l) => {
    const k = `${l.script}::${l.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Failure sites whose message carries NO static run long enough to assert on.
 * Must be empty: a leg that cannot be named cannot be proved, and cannot be
 * read at 2am either.
 */
export function legsWithoutIdentity(scriptsDir: string): { script: string; line: number; message: string }[] {
  const out: { script: string; line: number; message: string }[] = [];
  for (const script of readdirSync(scriptsDir).filter((n) => n.endsWith('.sh')).sort()) {
    readFileSync(join(scriptsDir, script), 'utf8').split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (line.startsWith('#')) return;
      if (/:\s*PASS\b/.test(line)) return;
      for (const msg of failureMessages(line)) {
        if (longestStatic(msg) === null) out.push({ script, line: i + 1, message: msg });
      }
    });
  }
  return out;
}

/** Legs sharing an id within one script — an ambiguous identity is not an identity. */
export function duplicateIds(legs: Leg[]): string[] {
  const counts = new Map<string, number>();
  for (const l of legs) {
    const k = `${l.script}::${l.id}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

/**
 * The substrings compliance tests ASSERT, **grouped by the guard they exercise**.
 *
 * NOT the raw file text. Every one of these guards documents its own failure
 * messages in its test's header comment, so a plain substring search reports a
 * leg as proved because someone described it in prose. That is a comment
 * claiming a link, inside the instrument built to measure exactly that -- and it
 * alone moved the first reported figure from 3 to 1.
 *
 * AND NOT GLOBALLY EITHER. Five scripts share the message
 * `no migration directory at` verbatim. Crediting an assertion to every script
 * with the same wording means one test proves a leg in four guards it never
 * ran -- which is the leg-masking defect in a new costume. An assertion counts
 * only toward the guard whose script the test actually invokes, taken from the
 * file's `LINT` constant or its `runLint('<script>' ...)` call sites.
 */
export function assertedByScript(testsDir: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const name of readdirSync(testsDir).filter((n) => n.endsWith('.test.ts'))) {
    const raw = readFileSync(join(testsDir, name), 'utf8');

    const scripts = new Set<string>();
    for (const m of raw.matchAll(/\b[A-Z][A-Z0-9_]*\s*=\s*['"]([\w.]+\.(?:sh|mjs))['"]/g)) scripts.add(m[1] as string);
    for (const m of raw.matchAll(/runLint\(\s*['"]([\w.]+\.sh)['"]/g)) scripts.add(m[1] as string);
    // .mjs as well as .sh -- the guards are not all shell any more, and a mapper
    // that only knows one extension reports a real test as covering nothing.
    for (const m of raw.matchAll(/['"`]scripts\/([\w.]+\.(?:sh|mjs))['"`]/g)) scripts.add(m[1] as string);
    if (scripts.size === 0) continue;

    // CODE, NOT PROSE -- and the line is drawn there deliberately.
    //
    // This began as "only a toContain() argument counts", which is the right
    // INSTINCT (see section 2 clause (a): an instrument must not accept prose as
    // evidence) but the wrong IMPLEMENTATION. It recognised one spelling of an
    // assertion, so a message asserted through a named constant, or through a
    // test.each parameter, counted for nothing -- and it had to be widened four
    // separate times, once for each way a test happened to be written.
    //
    // AN INSTRUMENT THAT ONLY RECOGNISES ONE SPELLING DICTATES HOW TESTS ARE
    // WRITTEN, which is a failure mode of its own: the next person writes the
    // assertion the way the tool wants rather than the way the test reads best.
    //
    // So the boundary is comment-vs-code, which is what clause (a) is actually
    // about: every string literal IN CODE counts, and nothing in a comment does.
    // WHICH IS CODE AND WHICH IS COMMENT IS DECIDED BY TYPESCRIPT'S OWN PARSER --
    // see stringLiteralsInCode below for why, and for what that does and does not
    // guarantee.
    const asserted = stringLiteralsInCode(raw, name);
    for (const script of scripts) out.set(script, [...(out.get(script) ?? []), ...asserted]);
  }
  return out;
}

/**
 * EVERY STRING LITERAL IN CODE, AS TYPESCRIPT'S PARSER SEES IT. (R-2026-09-18-15.)
 *
 * WHAT THIS REPLACED, AND WHY A REGEX COULD NOT BE REFINED INTO SHAPE. The
 * collector used to strip `/* ... *\/` with a regex over RAW text, then strip
 * whole-line `//` comments, then pair quotes with another regex. The block strip
 * ran first, so a `/*` inside a `//` comment was live: tests/compliance/
 * bundle_guards.test.ts has a line comment reading "TWO paths: *\/dist/* and
 * *\/.next/static/*", and the unclosed `/*` at `static/*` reached forward to the
 * next `*\/` in the file. On main there was none after it, so it swallowed
 * nothing and the register was CORRECT -- the defect was LATENT AND ARMED, not
 * active. The first JSDoc block added below that line (A1 sprint, Bundle 1,
 * 2026-09-18) supplied a `*\/`, and three existing assertions vanished from the
 * register. It failed loud that time, as under-credit. It could equally have
 * over-credited: quote pairing depends on what the strip removed, and Cowork
 * measured 219 regex pairings over main with the strip and 187 without it.
 *
 * WHY THE PARSER AND NOT THE SCANNER. R-2026-09-18-15 proposed ts.createScanner
 * as cheaper and sufficient. It is not sufficient: a scanner cannot tell a regex
 * literal from a division slash without parse context, and this repository's
 * tests are full of regex literals containing quotes. Observed 2026-09-18 on a
 * line from tests/compliance/leg_coverage.test.ts -- the scanner produced a
 * bogus string token beginning INSIDE the regex, which is exactly the pairing
 * desync this function exists to remove. ts.createSourceFile resolves it the way
 * the compiler does. Method note 17: a tool that reasons about a language it does
 * not parse will eventually be wrong in a way that silently changes what it
 * reports.
 *
 * WHAT IS COLLECTED: the cooked text of every StringLiteral and
 * NoSubstitutionTemplateLiteral, and every static span of a TemplateExpression
 * (head, middles, tail) -- the parts a `toContain` can match. Comments, regex
 * literals and interpolated expressions are not strings and are never collected.
 *
 * WHAT THIS NOW GUARANTEES, AND WHAT IT STILL DOES NOT (the residual-risk note,
 * rewritten in the same pass as the fix, because the old one said "nothing here
 * does that today" about the one over-credit it had reasoned about and missed
 * this one):
 *   - GUARANTEED: nothing inside a comment is ever credited, however the comment
 *     is written, and no quote inside a comment, a regex or another string can
 *     desync what counts as a literal.
 *   - NOT GUARANTEED: that a collected string is an ASSERTION. A leg message used
 *     as plant INPUT, or quoted in a test NAME, is a string in code and is
 *     credited. That is a known over-credit channel, deliberately left open: the
 *     boundary this collector draws is comment-vs-code, and the neutering
 *     discipline -- not this register -- is what proves a leg can fail.
 *   - NOT COVERED HERE: which scripts a test file is mapped to. That mapping is
 *     still regex over raw text, including comments, in assertedByScript above;
 *     it is outside R-2026-09-18-15's scope and is named in that PR.
 *
 * A NEW DEPENDENCE, STATED: this collector's behaviour now tracks the pinned
 * `typescript` devDependency's parser. It is pinned by plants in
 * tests/compliance/leg_coverage.test.ts, not by an assumption -- a parser upgrade
 * that changed what counts as a literal would redden them.
 *
 * A FILE THAT WILL NOT PARSE IS FATAL, as in blankComments: skipping it would
 * credit nothing silently, and a partial parse would credit whatever survived.
 */
export function stringLiteralsInCode(
  source: string,
  file: string,
  // THE SEAM for the refusal below. A test injects a parser that returns a source
  // file carrying no parseDiagnostics, which is the only way to reach it without
  // monkey-patching the typescript module.
  parse: (file: string, source: string) => ts.SourceFile = (f, s) =>
    ts.createSourceFile(f, s, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS),
): string[] {
  const sf = parse(file, source);
  // parseDiagnostics is not in the public .d.ts, but it is where createSourceFile
  // records syntax errors. Its ABSENCE would mean this check cannot run, which is
  // itself fatal rather than a pass.
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diags === undefined) {
    throw new Error(
      `leg evidence collector cannot verify a parse: the typescript parser exposed no parseDiagnostics for ${file}`,
    );
  }
  if (diags.length > 0) {
    const first = ts.flattenDiagnosticMessageText(diags[0]?.messageText ?? '', ' ');
    throw new Error(`leg evidence collector could not parse this test file, so its assertions were never collected: ${file}: ${first}`);
  }
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      out.push(node.head.text);
      for (const span of node.templateSpans) out.push(span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * A leg is REACHED only by a literal, in a test THAT RUNS ITS GUARD, that identifies
 * THAT LEG'S OWN MESSAGE (R-2026-09-24-92 BT-4; the rule R-2026-09-24-93 BU-2 f
 * confirmed). The literal must either:
 *   1. contain the leg's whole identity; or
 *   2. be a fragment of it that is at least MIN_ID characters, is not a path or a
 *      script's name, and is contained in NO OTHER leg's identity in the same script.
 *
 * UNTIL 2026-09-24 ANY literal of MIN_ID or more that the message contained counted.
 * A test must NAME its script to be counted at all, so the script's own name credited
 * every leg whose message quotes it: five `<script>.sh: FAILED (` summary lines read as
 * reached with no test quoting them, and scripts/readback_signin_link.mjs's stdin-is-a-
 * terminal STOP read as reached before any plant existed -- by its test's script path,
 * then by the flag literal '--project-ref'. A fragment two legs share proves neither:
 * scripts/neuter_plant.mjs's two `PLANT DID NOT LAND` legs were both "reached" by one
 * assertion of that shared prefix. Measured with this module over the real tree before
 * the rule landed: 276 script legs, 250 reached before, 244 after, six flips, all
 * reached -> not; the ten instrument legs, 10 reached before and after.
 *
 * `legs` is every leg of every script, so rule 2 can see the leg's neighbours.
 */
export function isReached(leg: Leg, byScript: Map<string, string[]>, legs: Leg[]): boolean {
  const asserted = byScript.get(leg.script) ?? [];
  const neighbours = legs.filter((l) => l.script === leg.script && l.id !== leg.id);
  return asserted.some((raw) => {
    const a = raw.trim();
    if (a.includes(leg.id)) return true;
    if (a.length < MIN_ID || !leg.id.includes(a) || PATH_SHAPED.test(a)) return false;
    return !neighbours.some((n) => n.id.includes(a));
  });
}

/** A path or a script's name: never evidence for a leg (BT-4). */
const PATH_SHAPED = /^(?:[\w.-]+\/)*[\w.-]+\.(?:sh|mjs|ts|js|json|sql|toml|md)$/;

/**
 * EVERY DIRECTORY A PLANT COULD LIVE IN, DISCOVERED RATHER THAN LISTED.
 *
 * The evidence side of this register read `tests/compliance` and nothing else,
 * so a leg proved by a plant in `tests/db` counted as unproved -- and a guard
 * that can only be exercised against a live database could therefore NEVER be
 * recorded as proved, however thoroughly it was planted. `tests/e2e` was in the
 * same position, with the ratchet's negative controls sitting outside the
 * measurement entirely.
 *
 * THE FIX IS NOT `compliance + db`. That is the same defect one directory
 * wider, waiting for the next test directory to be added. Section 2(d) of
 * .claude/rules/test-conventions.md says an instrument must assert its corpus
 * covers every location it CLAIMS to cover, and the honest way to satisfy that
 * is to stop claiming a list and start measuring one: any directory under
 * `tests/` holding at least one `*.test.ts` is a place a plant can live, so it
 * is evidence.
 *
 * `tests/setup` is excluded by that rule rather than by name -- it holds
 * harnesses and no test files, so it contributes no assertions and never
 * appears here. Nothing has to remember to exclude it.
 *
 * TAKES A ROOT so a plant can point it at a scratch tree, which is what keeps
 * the discovery non-vacuous: a hardcoded list would return nothing for a
 * constructed directory and the plant reds. Same seam every lint in scripts/
 * carries as `$1`.
 */
export function evidenceDirs(testsRoot: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(testsRoot)) {
    const dir = join(testsRoot, name);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue; // not a directory
    }
    if (entries.some((f) => f.endsWith('.test.ts'))) out.push(dir);
  }
  return out.sort();
}

/**
 * THE INSTRUMENT'S OWN LEGS.
 *
 * The reachedness computation had three defects in one sitting, every one found
 * by this repository's guards rather than by me. So the figure it reports is only
 * as proved as ITS legs are -- and when this was written it had six, of which
 * four had a plant. "13 of 78 proved" was itself a 4-of-6 claim: the parser
 * defect, applied to the parser's own tests.
 *
 * An instrument exempt from its own standard is the thing this whole register
 * exists to stop, so its violation branches are enumerated the same way a shell
 * guard's are -- from source -- and held to the same reaching-plant rule.
 */
export function parseInstrumentLegs(file: string, label: string): Leg[] {
  // A `throw` is a leg too, and so is every `out.push(`...`)` in the register
  // test's violation function. The instrument corpus was once one file and one
  // shape, so a refusal raised anywhere else in the instrument was invisible to
  // the register that enforces registration. An instrument exempt from its own
  // standard is what this whole register exists to stop.
  //
  // PARSED WITH TYPESCRIPT, NOT READ LINE BY LINE (R-2026-09-18-15). This was
  // line-scoped, with a residual note reading "Keep instrument throws on one line
  // until there is a TypeScript parse to hang this on." The evidence collector's
  // fix introduced that parse in this file, so the note's own exit condition was
  // met in the same change. Line scope had two costs: a `throw new Error(` whose
  // message sat on the next line was invisible, and -- the same defect as the
  // collector's -- a leg-shaped string inside a STRING or a comment continuation
  // line not starting with `//` or `*` would have been read as a leg. The parser
  // sees only real `throw new Error(...)` and `out.push(...)` calls.
  //
  // IDENTITY IS UNCHANGED: the message's static parts with each interpolation
  // replaced by `$X`, then longestStatic -- exactly what the line-scoped version
  // computed for a single-line call. Verified against main's register output,
  // leg for leg, when this changed.
  const source = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const diags = (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diags === undefined || diags.length > 0) {
    throw new Error(`leg parser could not parse this instrument file, so its legs were never enumerated: ${label}`);
  }

  /** The message's text with every interpolation as `$X`; null if it is not a string at all. */
  const messageText = (node: ts.Expression): string | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => `$X${s.literal.text}`).join('');
    return null;
  };

  const legs: Leg[] = [];
  const visit = (node: ts.Node): void => {
    let text: string | null = null;
    if (ts.isThrowStatement(node) && ts.isNewExpression(node.expression)) {
      const ne = node.expression;
      if (ts.isIdentifier(ne.expression) && ne.expression.text === 'Error' && ne.arguments && ne.arguments[0]) {
        text = messageText(ne.arguments[0]);
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'out' &&
      node.expression.name.text === 'push' &&
      node.arguments[0] &&
      (ts.isTemplateExpression(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
    ) {
      text = messageText(node.arguments[0]);
    }
    if (text !== null) {
      const id = longestStatic(text);
      if (id !== null) legs.push({ script: label, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, id });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return legs;
}
