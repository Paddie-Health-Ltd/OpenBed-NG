import * as acorn from 'acorn';
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
    // about. Comments are stripped and every string literal in the remaining
    // code counts. RESIDUAL RISK, stated rather than hidden: a leg message used
    // as plant INPUT rather than as an assertion would over-credit. Nothing here
    // does that today -- plant inputs are SQL and TypeScript snippets, not guard
    // messages -- and the neutering discipline is what actually proves a leg;
    // this decides only what the register records.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((l) => l.replace(/^\s*\/\/.*$/, ''))
      .join('\n');

    const asserted: string[] = [];
    for (const m of code.matchAll(/(['"`])((?:[^\\]|\\.)*?)\1/g)) asserted.push(m[2] as string);
    for (const script of scripts) out.set(script, [...(out.get(script) ?? []), ...asserted]);
  }
  return out;
}

/** A leg is REACHED when a test THAT RUNS ITS GUARD asserts a substring of its own message. */
export function isReached(leg: Leg, byScript: Map<string, string[]>): boolean {
  const asserted = byScript.get(leg.script) ?? [];
  return asserted.some(
    (a) => a.includes(leg.id) || (leg.id.includes(a.trim()) && a.trim().length >= MIN_ID),
  );
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
  const legs: Leg[] = [];
  readFileSync(file, 'utf8').split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('//') || line.startsWith('*')) return;
    for (const m of line.matchAll(/out\.push\(\s*`([^`]+)`/g)) {
      const id = longestStatic((m[1] as string).replace(/\$\{[^}]*\}/g, '$X'));
      if (id !== null) legs.push({ script: label, line: i + 1, id });
    }
    // A `throw` is a leg too, and THIS FILE now has one. The instrument corpus
    // was one file and one shape -- `out.push(...)` in the register test -- so a
    // refusal raised anywhere else in the instrument was invisible to the
    // register that enforces registration. An instrument exempt from its own
    // standard is what this whole register exists to stop.
    //
    // NOTE THE RESIDUAL SCOPE, rather than leaving it to be discovered: this
    // half is LINE-SCOPED, because acorn parses JavaScript and these instrument
    // files are TypeScript. A `throw new Error(` whose message sits on the next
    // line is still invisible here. Keep instrument throws on one line until
    // there is a TypeScript parse to hang this on.
    for (const m of line.matchAll(/throw new Error\(\s*(['"`])((?:[^\\]|\\.)*?)\1/g)) {
      const id = longestStatic((m[2] as string).replace(/\$\{[^}]*\}/g, '$X'));
      if (id !== null) legs.push({ script: label, line: i + 1, id });
    }
  });
  return legs;
}
