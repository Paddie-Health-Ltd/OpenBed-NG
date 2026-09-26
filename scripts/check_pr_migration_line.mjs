#!/usr/bin/env node
// ============================================================
// scripts/check_pr_migration_line.mjs
// ============================================================
// A MIGRATION PULL REQUEST ANSWERS THE RUNBOOK LINE (R-2026-09-21-50 E2; built by PR F,
// R-2026-09-26-130 DF-2).
//
// .github/PULL_REQUEST_TEMPLATE.md asks every change touching database/migrations/:
// "Runbook expectations this migration changes:", answered with the sections, or with
// "none, because <reason>". A template cannot force an answer. This does: CI's repo-lint
// job runs it on every pull_request event (opened, synchronize, reopened, edited), with the
// pull request body in the PR_BODY environment variable and never on a command line.
//
// TOUCHING (DF-2 a): any added, modified, deleted or renamed path under
// database/migrations/. The diff runs with --no-renames, so a rename out of the directory
// still shows its old path there.
// BLANK (DF-2 b): after stripping HTML comments -- the template's own comment mentions the
// line -- the line is missing, has nothing after it (on the line, or before the next
// heading), or answers "none" without "because". An unset or empty PR_BODY is blank.
//
// It runs git ITSELF (--from-git) rather than reading a pipe: GitHub's default shell has no
// pipefail, so a failed `git diff | node` would hand this an empty list and "no path
// changed" would read as "not touching". A git that cannot run is an ERROR.
// --changed <file> reads the paths from a file instead, which is how the tests drive it
// (tests/compliance/pr_migration_line.test.ts).
//
// Usage: PR_BODY=... node scripts/check_pr_migration_line.mjs --from-git | --changed <file>
// Exit: 0 answered, or nothing under database/migrations/ changed; 1 the line is missing,
// blank or a bare "none"; 2 usage, or the changed paths could not be read.
// ============================================================
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LINE = 'Runbook expectations this migration changes:';
const DIR = 'database/migrations/';

const args = process.argv.slice(2);
let listing;
if (args.length === 1 && args[0] === '--from-git') {
  try {
    // HEAD is the merge of the pull request into its base, and HEAD^1 is the base: the
    // checkout fetches two commits for exactly this.
    listing = execFileSync('git', ['diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    console.error(`ERROR: git diff did not run, so this check has no verdict: ${String(e.message).split('\n')[0]}`);
    process.exit(2);
  }
} else if (args.length === 2 && args[0] === '--changed') {
  try {
    listing = readFileSync(args[1], 'utf8');
  } catch (e) {
    console.error(`ERROR: the changed-paths file was unreadable, so this check has no verdict: ${args[1]} (${e.code ?? e.message})`);
    process.exit(2);
  }
} else {
  console.error('ERROR: usage: check_pr_migration_line.mjs --from-git | --changed <file>');
  process.exit(2);
}

const paths = listing.split('\n').map((p) => p.trim()).filter(Boolean);
const touching = paths.filter((p) => p.startsWith(DIR));
if (touching.length === 0) {
  console.log(`ok: this pull request touches nothing under ${DIR} (${paths.length} path(s) changed), so the runbook line is not required.`);
  process.exit(0);
}

const body = (process.env.PR_BODY ?? '').replace(/<!--[\s\S]*?-->/g, '');
const lines = body.split(/\r?\n/);
const at = lines.findIndex((l) => l.trim().startsWith(LINE));
const where = `(it changes ${touching.join(', ')})`;
if (at === -1) {
  console.error(`FAIL: missing line -- this pull request touches database/migrations/ and its body has no "Runbook expectations this migration changes:" line; answer it with the sections, or "none, because <reason>" ${where}`);
  process.exit(1);
}
let answer = lines[at].trim().slice(LINE.length).trim();
if (answer === '') {
  const rest = [];
  for (const l of lines.slice(at + 1)) {
    if (/^\s*#/.test(l)) break;
    if (l.trim() !== '') rest.push(l.trim());
  }
  answer = rest.join(' ');
}
if (answer === '') {
  console.error(`FAIL: blank line -- this pull request touches database/migrations/ and the runbook-expectations line is blank; answer it with the sections, or "none, because <reason>" ${where}`);
  process.exit(1);
}
if (/^none\b/i.test(answer) && !/\bbecause\b/i.test(answer)) {
  console.error(`FAIL: bare none -- this pull request touches database/migrations/ and answers "none" without "because <reason>", which is the answer this line exists to refuse ${where}`);
  process.exit(1);
}
console.log(`ok: this pull request touches database/migrations/ and the runbook-expectations line is answered: ${answer.slice(0, 160)}`);
