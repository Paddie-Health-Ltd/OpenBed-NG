#!/usr/bin/env node
// ============================================================
// scripts/readback_signin_link.mjs
// ============================================================
// THE REDIRECT READ-BACK (R-2026-09-24-73 BA-1; R-2026-09-24-88 BP-7). The founder
// gives it the sign-in link from the email, and it says whether the link will land
// where it must: PASS only if the link is this project's own Auth link and its
// redirect_to is EXACTLY https://admin.openbed.ng/ (--mode admin) or
// https://app.openbed.ng/ (--mode ward). Everything else is STOP.
//
// WHY A SCRIPT AND NOT AN EYE. If Auth does not match a redirect it falls back to the
// Site URL SILENTLY (R-2026-09-23-72 AZ-1), and an operator's link then lands on the
// ward console, which looked like a sign-in that worked. One correct link can reach a
// reader in two spellings, an email provider's click tracking can rewrite the whole
// link, and a comparison made by eye is what the -70 H4 fix removed (BA-1). So the
// value is decoded ONCE before it is compared, both forms are printed, a link to any
// host but the project's own Auth host is refused, and the fallback reads STOP, never
// PASS.
//
// THE LINK IS A LIVE CREDENTIAL. So:
//   - it is read from STANDARD INPUT ONLY: pbpaste | node scripts/readback_signin_link.mjs ...
//     A link given as an argument is refused, because it is already in the shell's
//     history, and the refusal says to request a new one;
//   - its token is NEVER printed. The link is printed with every parameter value
//     but redirect_to and type replaced by <redacted> -- an allow-list, so a token
//     under a name this script has never seen is hidden too -- and the fragment
//     redacted;
//   - it makes NO request and follows nothing. It imports no network or process
//     module; tests/compliance/readback_signin_link.test.ts holds the source to that.
//
// NOT ASSERTED HERE, deliberately: that the link still works. Following it would
// spend the credential, and the one person who may spend it is the operator. That a
// link PASSes says where it will land, not that it has not expired.
//
// Usage: pbpaste | node scripts/readback_signin_link.mjs --mode admin|ward --project-ref <ref>
// Exit: 0 PASS; 1 STOP on a link that was read and does not land where it must;
//       2 the input or the arguments are unusable, and no verdict was reached.
// ============================================================
import { readFileSync } from 'node:fs';

const TARGETS = { admin: 'https://admin.openbed.ng/', ward: 'https://app.openbed.ng/' };
const SITE_URL = 'https://app.openbed.ng';
const PRINTABLE = new Set(['redirect_to', 'type']);
const NAMED = new Set(['redirect_to', 'type', 'token', 'token_hash']);

const argv = process.argv.slice(2);
if (argv.some((a) => !a.startsWith('--') && /:\/\/|token|redirect_to/i.test(a))) {
  console.error('STOP: a sign-in link was given as an argument, which puts it in your shell history. Request a new link, and pass it on standard input.');
  process.exit(2);
}
const opts = {};
for (let i = 0; i < argv.length; i += 2) {
  const k = argv[i];
  const v = argv[i + 1];
  if ((k !== '--mode' && k !== '--project-ref') || v === undefined || Object.hasOwn(opts, k)) {
    opts.bad = true;
    break;
  }
  opts[k] = v;
}
if (opts.bad || !Object.hasOwn(TARGETS, opts['--mode'] ?? '') || !/^[a-z0-9]{20}$/.test(opts['--project-ref'] ?? '')) {
  console.error('usage: pbpaste | node scripts/readback_signin_link.mjs --mode admin|ward --project-ref <ref>');
  process.exit(2);
}
const mode = opts['--mode'];
const expected = TARGETS[mode];
const authHost = `${opts['--project-ref']}.supabase.co`;

if (process.stdin.isTTY) {
  console.error('STOP: nothing was piped in. Pass the link on standard input, as pbpaste | node scripts/readback_signin_link.mjs --mode <mode> --project-ref <ref>');
  process.exit(2);
}

const lines = readFileSync(0, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
if (lines.length !== 1) {
  console.error('STOP: expected exactly one line on standard input, the sign-in link, and no verdict was reached');
  process.exit(2);
}

let link;
try {
  link = new URL(lines[0]);
} catch {
  // Never echo the input: Node's own TypeError carries it, and it may be a credential.
  link = null;
}
if (link === null || link.protocol !== 'https:' || link.username !== '' || link.password !== '' || link.port !== '') {
  console.error('STOP: the input is not an https link, and no verdict was reached');
  process.exit(2);
}

// The link, printable once its host is known to be the project's: every value but
// redirect_to and type redacted, and any parameter NAME this script does not know
// replaced too.
const params = link.search.replace(/^\?/, '').split('&').filter((p) => p !== '').map((p) => {
  const eq = p.indexOf('=');
  let key = null;
  try {
    key = decodeURIComponent((eq < 0 ? p : p.slice(0, eq)).replace(/\+/g, ' '));
  } catch {
    key = null; // a malformed escape in a NAME: never printed, never matched
  }
  return { key, value: eq < 0 ? null : p.slice(eq + 1) };
});
const shown = params.map(({ key, value }) => {
  const name = key !== null && NAMED.has(key) ? key : '<param>';
  return key !== null && PRINTABLE.has(key) && value !== null ? `${name}=${value}` : `${name}=<redacted>`;
});

// A foreign host is named and nothing else of it printed: a click-tracking rewrite
// carries the whole original link, token included, encoded inside its own path.
if (link.hostname !== authHost) {
  console.error(`STOP: the link's host is not this project's Auth host. Expected ${authHost}, read ${link.hostname}`);
  process.exit(1);
}
console.log(`link (token redacted): ${link.origin}${link.pathname}${shown.length ? `?${shown.join('&')}` : ''}${link.hash ? '#<redacted>' : ''}`);
if (link.pathname !== '/auth/v1/verify') {
  console.error(`STOP: the link's path is not /auth/v1/verify. Read ${link.pathname}`);
  process.exit(1);
}

const sent = params.filter((p) => p.key === 'redirect_to').map((p) => p.value ?? '');
if (sent.length === 0) {
  console.error('STOP: the link carries no redirect_to, so Auth sends it to the Site URL -- the fallback R-2026-09-23-72 AZ-1 names');
  process.exit(1);
}
if (sent.length > 1) {
  console.error("STOP: the link carries more than one redirect_to, and which one Auth reads is not this script's to guess");
  process.exit(1);
}
const decoded = link.searchParams.get('redirect_to') ?? '';
console.log(`redirect_to, as sent : ${sent[0]}`);
console.log(`redirect_to, decoded : ${decoded}`);

if (/%[0-9a-f]{2}/i.test(decoded)) {
  console.error('STOP: redirect_to still holds a percent-escape after one decode. It is never decoded twice to find a match');
  process.exit(1);
}
if (decoded === SITE_URL) {
  console.error(`STOP: redirect_to is the Site URL, ${SITE_URL}: the fallback R-2026-09-23-72 AZ-1 names, never a working sign-in`);
  process.exit(1);
}
if (decoded !== expected) {
  const slash = `${decoded}/` === expected ? ', and differs from it only by the trailing slash' : '';
  console.error(`STOP: redirect_to is not exactly ${expected}${slash}`);
  process.exit(1);
}
console.log(`PASS: this project's Auth link, and redirect_to is exactly ${expected}`);
