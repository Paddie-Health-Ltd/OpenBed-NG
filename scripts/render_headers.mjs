#!/usr/bin/env node
/**
 * scripts/render_headers.mjs
 *
 * RENDER AN APP'S TRACKED `_headers` INTO THE ONE THAT SHIPS (R-2026-09-24-94 BV-2;
 * PR 3.4b-app B).
 *
 * An app's CSP names the API origin its browser code may call. The tracked file names
 * a placeholder, @API_ORIGINS@, and this script fills it with THE BUILD TARGET'S origin
 * only -- `api.production` or `api.local` from packages/origins/origins.json -- named
 * by `--target production|local`. BV-2 requires the CSP to be DERIVED from that
 * entry, never retyped, so there is no second copy of either origin to drift.
 *
 * THE TARGET IS REQUIRED, AND THERE IS NO DEFAULT (R-2026-09-25-117 CS-2). Until then
 * this script filled BOTH origins into every build, because apiOrigin() chooses
 * between them at run time by hostname (packages/origins/src/index.ts). So the
 * deployed admin and ward-console CSPs named http://127.0.0.1:54321. A silent default
 * is what produced that, so a missing or unknown target is exit 2. Runtime selection
 * by hostname is unchanged: this is the header, not the bundle. Each app's `npm run
 * build` renders production, and `npm run build:local`, which a local
 * `wrangler pages dev` serves, renders local.
 *
 * Until 2026-09-25 the paragraph above read: "The ward console's CSP names the API
 * origins its browser code may call: the production one and the local one, because
 * apiOrigin() chooses between them at run time by hostname. … this script replaces it
 * with `api.production` and `api.local` read from that file."
 *
 * ONE RENDERER, THREE CALLERS. Each app's `npm run build` renders its built
 * `_headers` in place (--write). tests/compliance/security_headers.test.ts holds the
 * built file equal to this script's output for the tracked one. And the read-backs'
 * rb_tracked_header (scripts/readback_common.sh) compares a served header against
 * this script's output, so production is held to the same derivation, not to a copy.
 *
 * IT REFUSES RATHER THAN SHIPPING A PLACEHOLDER. A CSP holding `@API_ORIGINS@`
 * unrendered is still a valid header: the browser ignores the unknown source, keeps
 * 'self', and sign-in breaks SILENTLY. So a placeholder named twice, an unknown or
 * misspelt placeholder, or an `api` entry that is not an origin is exit 2 here,
 * which fails the build.
 *
 * A file with no placeholder renders to itself: the public dashboard fetches only its
 * own origin and names no API. Whether an app MUST name the placeholder is the test's
 * question (it knows which apps call apiOrigin()), not this script's.
 *
 * A SECOND PLACEHOLDER, FOR THE FALLBACK (R-2026-10-02-FF FF-4 g, -182; R-2026-09-19-23 D5). The ward
 * console's browser code falls back to the Supabase origin directly when the Worker is down, so
 * its connect-src must name that origin too. Its tracked file names @FALLBACK_ORIGIN@ after the
 * API placeholder, and this script fills it with `supabaseDirect[target]` from the same origins.json.
 * It reads and validates that entry ONLY when the placeholder is present, and after it has validated
 * `api`, so a file with no such placeholder (admin's, the dashboard's) is rendered exactly as
 * before and a scratch origins.json with no `supabaseDirect` is still enough for them. When the value
 * EQUALS the target's api origin (the local target, where the two are the same address) the
 * placeholder is removed WITH its leading space, so the local CSP is byte-identical to what it was
 * before the fallback existed. Admin names no such placeholder and its CSP never carries the direct
 * origin: a placeholder in admin's file is the test's refusal, not this script's.
 *
 * Usage: node scripts/render_headers.mjs [--write] --target production|local FILE
 *   (a command; nothing imports it) prints the rendered FILE, or with --write rewrites
 *   FILE in place.
 * Exit: 0 rendered; 2 usage, a missing or unknown target, an unreadable file, or a
 * refusal above.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGINS_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'origins', 'origins.json');
const PLACEHOLDER = '@API_ORIGINS@';
const FALLBACK_PLACEHOLDER = '@FALLBACK_ORIGIN@';
const ORIGIN = /^https?:\/\/[A-Za-z0-9.[\]:-]+$/;

const TARGETS = ['production', 'local'];

/** The target's API origin, read from origins.json. Both entries are checked to be bare origins. */
function apiOrigin(target) {
  const api = JSON.parse(readFileSync(ORIGINS_FILE, 'utf8')).api ?? {};
  for (const key of TARGETS) {
    if (typeof api[key] !== 'string' || !ORIGIN.test(api[key])) {
      throw new Error(`origins.json api.${key} is not a bare origin, so it cannot go into a CSP: ${JSON.stringify(api[key] ?? null)}`);
    }
  }
  return api[target];
}

/** The target's direct (fallback) origin, read from origins.json. Read ONLY when the file names its placeholder. */
function directOrigin(target) {
  const value = (JSON.parse(readFileSync(ORIGINS_FILE, 'utf8')).supabaseDirect ?? {})[target];
  if (typeof value !== 'string' || !ORIGIN.test(value)) {
    throw new Error(`origins.json supabaseDirect.${target} is not a bare origin, so the fallback origin cannot go into a CSP: ${JSON.stringify(value ?? null)}`);
  }
  return value;
}

/** The tracked text with the placeholders filled in. Throws on anything it will not ship. */
function renderHeaders(text, target) {
  const count = text.split(PLACEHOLDER).length - 1;
  if (count > 1) throw new Error(`names ${PLACEHOLDER} ${count} times; it may be filled in exactly one place`);
  const fallbackCount = text.split(FALLBACK_PLACEHOLDER).length - 1;
  if (fallbackCount > 1) throw new Error(`names ${FALLBACK_PLACEHOLDER} ${fallbackCount} times; the fallback origin may be filled in exactly one place`);
  let out = count === 1 ? text.replace(PLACEHOLDER, apiOrigin(target)) : text;
  if (fallbackCount === 1) {
    // apiOrigin() first, so a bad `api` entry is the refusal reported, then the entry this placeholder needs.
    const api = apiOrigin(target);
    const direct = directOrigin(target);
    if (direct === api) {
      // The same address (the local target): drop the placeholder WITH its leading space.
      const withSpace = ` ${FALLBACK_PLACEHOLDER}`;
      out = out.includes(withSpace) ? out.replace(withSpace, '') : out.replace(FALLBACK_PLACEHOLDER, '');
    } else {
      out = out.replace(FALLBACK_PLACEHOLDER, direct);
    }
  }
  const left = /@[A-Z_]+@/.exec(out);
  if (left) throw new Error(`still holds an unrendered placeholder after rendering: ${left[0]}`);
  return out;
}

// ALWAYS A COMMAND, NEVER A MODULE. An `if (argv[1] === this file)` guard, the usual
// way to make a script importable too, compares a path as given with one resolved:
// run through a symlinked directory (macOS's /var is /private/var) the two differ, the
// body never runs, and the script exits 0 having rendered nothing -- a render step
// that passes by doing nothing. Every caller runs this as a command, so there is no
// guard to get wrong.
const args = process.argv.slice(2);
let write = false;
let target;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--write') write = true;
  else if (args[i] === '--target') target = args[++i] ?? '';
  else files.push(args[i]);
}
if (files.length !== 1 || !files[0] || files[0].startsWith('--')) {
  console.error('usage: node scripts/render_headers.mjs [--write] --target production|local FILE -- name the build target and the _headers file to render');
  process.exit(2);
}
const file = files[0];
if (target === undefined) {
  console.error('ERROR: no --target was given, so the API origin to name is unknown -- name production or local; there is no default, because a silent default shipped a local origin to production');
  process.exit(2);
}
if (!TARGETS.includes(target)) {
  console.error(`ERROR: unknown --target '${target}' -- the build target is production or local`);
  process.exit(2);
}
try {
  const out = renderHeaders(readFileSync(file, 'utf8'), target);
  if (write) writeFileSync(file, out, 'utf8');
  else process.stdout.write(out);
} catch (e) {
  console.error(`ERROR: could not render the headers file ${file}: ${String(e.message)}`);
  process.exit(2);
}
