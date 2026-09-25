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

/** The tracked text with the placeholder filled in. Throws on anything it will not ship. */
function renderHeaders(text, target) {
  const count = text.split(PLACEHOLDER).length - 1;
  if (count > 1) throw new Error(`names ${PLACEHOLDER} ${count} times; it may be filled in exactly one place`);
  const out = count === 1 ? text.replace(PLACEHOLDER, apiOrigin(target)) : text;
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
