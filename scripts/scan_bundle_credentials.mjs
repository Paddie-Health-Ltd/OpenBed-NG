#!/usr/bin/env node
/**
 * scripts/scan_bundle_credentials.mjs
 * ============================================================
 * The matching half of scripts/lint_no_service_role_in_bundle.sh. That script
 * owns corpus discovery, anti-vacuity and the verdict; this one owns the
 * question "does this file carry a service-role credential".
 *
 * WHY THE GUARD WAS SPLIT. It matched WORDS over RAW BUNDLE TEXT. On 2026-09-10
 * importing @supabase/supabase-js produced 24 hits and NOT ONE WAS A
 * CREDENTIAL: 23 were JSDoc, most of them "Never expose your `service_role` key
 * in the browser" -- the guard firing on the warning against the thing it
 * guards -- and the 24th was `key.startsWith("sb_secret_")`, a prefix
 * predicate. A guard that reds on any library documenting the hazard it guards
 * is a guard someone switches off, and most good libraries document it.
 *
 * THE CATEGORY ERROR WAS `sb_secret_` IN THE WORD LIST. `service_role`,
 * `SUPABASE_SERVICE` and `SERVICE_ROLE_KEY` are IDENTIFIER NAMES -- what you see
 * when an env var is wired into a client module and the name inlines at build
 * time. `sb_secret_` is a credential PREFIX. A bare prefix with no key material
 * after it is not a credential, and treating it as a word is what made a
 * one-line predicate indistinguishable from a leaked key.
 *
 * THREE TIERS, AND THE CORPUS EACH RUNS OVER IS THE DESIGN.
 *
 *   TIER 1 -- WORDS, over code with COMMENT RANGES BLANKED.
 *     service_role | SUPABASE_SERVICE | SERVICE_ROLE_KEY
 *     Catches the realistic failure: someone wires
 *     process.env.SUPABASE_SERVICE_ROLE_KEY into a bundled module
 *     "temporarily", the name inlines, and the value arrives from the build
 *     environment. A shape matcher sees nothing there, which is why the word
 *     match is kept rather than replaced.
 *
 *   TIER 2 -- SHAPES, over RAW TEXT INCLUDING COMMENTS.
 *     sb_secret_ followed by at least 20 characters of key material, and any
 *     JWT whose payload decodes to "role":"service_role".
 *     A literal key smuggled into a comment is still a literal key in a public
 *     bundle, so this tier does not get the comment treatment. The JWT leg is
 *     precise rather than shape-only: the publishable/anon key is also a JWT
 *     and is published in the bundle BY DESIGN, so firing on JWT shape alone
 *     would red on the one credential that belongs there.
 *
 *   TIER 3 -- ASSEMBLY, over code with comments blanked.
 *     sb_secret_ adjacent to a concatenation or a template interpolation.
 *     This is belt. Vite inlines import.meta.env at build time and rollup folds
 *     constant concatenation, so a key that is known at build time arrives in
 *     the bundle as a FULL LITERAL that tier 2 catches. Tier 3 covers what
 *     survives folding.
 *
 * COMMENT STRIPPING IS A REAL PARSE, NEVER A REGEX. A regex stripper mangles
 * `//` inside a string literal -- every URL in the bundle -- and deleting real
 * code is the failure mode where a guard stops seeing what it guards. acorn
 * gives true comment ranges; each is blanked to spaces so line numbers survive.
 * A file that will not parse is EXIT 2 AND LOUD. It is never re-scanned raw and
 * never skipped: a check that could not run must not report a verdict.
 *
 * WHAT THIS DOES NOT PROVE, per Clause 5 of .claude/rules/code-pipeline.md.
 *   - It does not prove a dependency cannot READ the service key from the
 *     environment at runtime. Nothing in a bundle's text can.
 *   - It is not a control against a supply-chain attack that assembles a key
 *     through variable indirection inside vendor code. No bundle grep is.
 *   - It says nothing about server-side code, which is scoped out on purpose:
 *     the snapshot generator is legitimately service-role, and a source-scoped
 *     grep would red on it until someone widened the guard.
 *
 * THERE IS NO ALLOWLIST, AND THAT IS A DECISION. The one vendor hit that
 * motivated this rewrite is cleared by putting sb_secret_ in the tier it
 * belonged in, not by allowing it. If a genuine vendor hit ever needs an
 * allowance, it is ONE ENTRY PINNED TO THE DEPENDENCY'S EXACT INSTALLED
 * VERSION, and it must red when that version changes -- an allowance that
 * survives a version bump is an exemption. A standing allowlist file is not
 * shipped ahead of that need: an empty one is a ready-made suppression path for
 * the next person who hits a red in a hurry.
 *
 * Usage: node scripts/scan_bundle_credentials.mjs <file> [<file>...]
 * Exit: 0 clean, 1 credential found, 2 the scan did not run.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as acorn from 'acorn';

const TIER1 = /service_role|SUPABASE_SERVICE|SERVICE_ROLE_KEY/g;
const TIER2_SB = /sb_secret_[A-Za-z0-9_-]{20,}/g;
const TIER2_JWT = /eyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{16,})\.[A-Za-z0-9_-]{16,}/g;
const TIER3 = /sb_secret_(?:['"`]\s*\+|\$\{|['"`]\s*\.\s*concat)/g;

/** Extensions acorn is asked to parse. Everything else is matched raw. */
const JS_EXT = /\.(js|mjs|cjs)$/;

/**
 * Blanks every comment to spaces, preserving offsets and line numbers.
 * Throws if the file will not parse either as a module or as a script.
 */
function codeOnly(src, file) {
  let lastErr;
  for (const sourceType of ['module', 'script']) {
    const comments = [];
    try {
      acorn.parse(src, { ecmaVersion: 'latest', sourceType, allowHashBang: true, onComment: comments });
    } catch (e) {
      lastErr = e;
      continue;
    }
    const out = src.split('');
    for (const c of comments) {
      for (let i = c.start; i < c.end; i += 1) if (out[i] !== '\n') out[i] = ' ';
    }
    return out.join('');
  }
  // DISTINCT WORDING FROM THE READ FAILURE BELOW, AND NOT FOR STYLE. Both
  // branches originally ended "-- the bundle scan did not run", so the leg
  // parser took the shared tail as the identity of BOTH and one plant credited
  // two different failures. A leg proved by another leg's plant is the masking
  // this register exists to find.
  throw new Error(
    `could not parse ${file} as JavaScript -- comment stripping needs a real parse, so the bundle scan did not run. ` +
      `Neither module nor script parsed it. Last error: ${String(lastErr && lastErr.message)}`,
  );
}

function lineOf(src, index) {
  let n = 1;
  for (let i = 0; i < index; i += 1) if (src[i] === '\n') n += 1;
  return n;
}

/** A JWT literal counts only when its payload actually claims the service role. */
function serviceRoleJwtHits(src) {
  const hits = [];
  TIER2_JWT.lastIndex = 0;
  let m;
  while ((m = TIER2_JWT.exec(src)) !== null) {
    try {
      const claims = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
      if (claims && claims.role === 'service_role') hits.push({ index: m.index, text: m[0] });
    } catch {
      // Not a decodable JWT payload. The anon key IS a decodable JWT and is
      // published in the bundle by design, so firing on shape alone would red
      // on the one credential that belongs here.
    }
  }
  return hits;
}

function collect(re, text) {
  const hits = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) hits.push({ index: m.index, text: m[0] });
  return hits;
}

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error('ERROR: no files given to scan -- the bundle scan did not run');
  console.error('  Usage: node scripts/scan_bundle_credentials.mjs <file> [<file>...]');
  process.exit(2);
}

let violations = 0;

for (const file of files) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`ERROR: could not read ${file} -- the bundle file is unreadable, so nothing was scanned: ${String(e.message)}`);
    process.exit(2);
  }

  let code;
  if (JS_EXT.test(file)) {
    try {
      code = codeOnly(src, file);
    } catch (e) {
      console.error(`ERROR: ${String(e.message)}`);
      process.exit(2);
    }
  } else {
    // HTML and JSON are matched RAW. An HTML comment ships to the browser, so
    // there is nothing to strip on safety grounds, and no parser is introduced
    // for a corpus whose credentials would be plain text either way.
    code = src;
  }

  const found = [
    ...collect(TIER1, code).map((h) => ({ ...h, tier: 'word (identifier name, in code)' })),
    ...collect(TIER2_SB, src).map((h) => ({ ...h, tier: 'shape (secret key with material)' })),
    ...serviceRoleJwtHits(src).map((h) => ({ ...h, tier: 'shape (JWT claiming role=service_role)' })),
    ...collect(TIER3, code).map((h) => ({ ...h, tier: 'assembly (key built from the prefix)' })),
  ];

  if (found.length > 0) {
    console.error(`FAIL: service-role credential reachable from a built client bundle: ${basename(file)}`);
    console.error(`  ${file}`);
    for (const h of found.slice(0, 12)) {
      console.error(`  line ${lineOf(src, h.index)}  [${h.tier}]  ${h.text.slice(0, 80)}`);
    }
    if (found.length > 12) console.error(`  ... and ${found.length - 12} more in this file`);
    violations += 1;
  }
}

process.exit(violations > 0 ? 1 : 0);
