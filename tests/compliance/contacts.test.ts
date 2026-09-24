import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';
import CONTACTS from '../../packages/origins/contacts.json';

/**
 * THE THREE PUBLISHED ADDRESSES, AND NO OTHER (R-2026-09-24-88 BP-10; R-2026-09-24-89
 * BQ-1; R-2026-09-24-93 BU-2 b).
 *
 * packages/origins/contacts.json holds security@, hello@ and support@openbed.ng, each
 * with its purpose. Every @openbed.ng address anywhere in the TRACKED tree, outside
 * Sprint Kickoffs/ and docs/handoff*, must be one of those three: the privacy notice,
 * SECURITY.md and every page cannot then disagree about where a request goes, and the
 * operator's own sign-in address -- a fourth, unpublished one (BQ-1) -- can never land
 * in the repository unnoticed. There is no privacy@, anywhere outside that exemption.
 *
 * THE TREE IS WALKED WITH `git ls-files -z`, NULL-SEPARATED. A plain
 * `git ls-files | xargs grep` silently skips Sprint Kickoffs/, because the directory's
 * name has a space in it: found by PR B's survey, and exactly the blind spot a guard
 * over "every tracked file" must not have. An address is an address only with a
 * local part, so the decision record's "@openbed.ng/origins" typo is not one.
 *
 * THE PLANT ADDRESSES ARE BUILT AT RUN TIME. A committed fourth address, or a
 * committed privacy@, would sit in the tracked tree and red this guard on its own
 * source (test-conventions section 2: plants are constructed, never committed).
 */

const DOMAIN = 'openbed.ng';
const ADDRESS = /[A-Za-z0-9._%+-]+@openbed\.ng\b/g;
// A privacy@ ADDRESS, at ANY domain, not the bare token: "there is no privacy@" is this
// rule stated in prose (here, and in contacts.json), and a guard that reds on the
// sentence describing it is refusing legitimate input -- test-conventions section 2's
// fifth way. Found on 2026-09-24 when it did exactly that to PR B's own commit.
const PRIVACY = new RegExp(`\\bprivacy${'@'}[a-z0-9-]+(?:\\.[a-z0-9-]+)+`, 'i');
const EXEMPT = (path: string): boolean => path.startsWith('Sprint Kickoffs/') || path.startsWith('docs/handoff');
const PUBLISHED = new Set([CONTACTS.security.address, CONTACTS.hello.address, CONTACTS.support.address]);

interface File { path: string; text: string }

function addressViolations(files: File[]): string[] {
  if (files.length === 0) return ['no tracked file was read, so no address was checked'];
  const out: string[] = [];
  for (const f of files.filter((x) => !EXEMPT(x.path))) {
    for (const m of f.text.matchAll(ADDRESS)) {
      if (!PUBLISHED.has(m[0].toLowerCase())) out.push(`${f.path}: ${m[0]} is not one of the three published addresses in packages/origins/contacts.json`);
    }
    if (PRIVACY.test(f.text)) out.push(`${f.path}: names a privacy@ address, and there is none`);
  }
  return out;
}

function trackedFiles(): File[] {
  const names = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter((n) => n !== '');
  return names
    .map((path) => ({ path, text: readFileSync(join(REPO_ROOT, path), 'utf8') }))
    .filter((f) => !f.text.includes('\0'));
}

describe('the published addresses', () => {
  test('contacts.json holds exactly the three published addresses, each at openbed.ng', () => {
    const keys = Object.keys(CONTACTS).filter((k) => k !== 'what_this_is').sort();
    expect(keys, 'a fourth contact, or a missing one').toEqual(['hello', 'security', 'support']);
    expect([...PUBLISHED].sort()).toEqual([`hello@${DOMAIN}`, `security@${DOMAIN}`, `support@${DOMAIN}`]);
  });

  test('real tree — every tracked @openbed.ng address outside the exemption is one of the three, and no privacy@', () => {
    const files = trackedFiles();
    expect(files.some((f) => f.path.startsWith('Sprint Kickoffs/')), 'the walk did not reach Sprint Kickoffs/ -- the space-in-a-path blind spot').toBe(true);
    expect(addressViolations(files)).toEqual([]);
  });

  test('positive control — the scan finds the addresses it must, in SECURITY.md and the runbook', () => {
    // A scan that found nothing would pass the leg above for the wrong reason.
    const found = trackedFiles().filter((f) => !EXEMPT(f.path)).flatMap((f) => [...f.text.matchAll(ADDRESS)].map((m) => `${f.path}:${m[0]}`));
    expect(found).toContain(`SECURITY.md:security@${DOMAIN}`);
    expect(found.filter((x) => x.startsWith('docs/runbook-supabase-project-creation.md:')).length).toBeGreaterThan(0);
  });

  test('SECURITY.md sends a report to the published security address', () => {
    expect(readFileSync(join(REPO_ROOT, 'SECURITY.md'), 'utf8')).toContain(`**${CONTACTS.security.address}**`);
  });

  test('plant — a fourth address in an app\'s source is rejected, naming the file', () => {
    const fourth = `ops${'@'}${DOMAIN}`;
    expect(addressViolations([{ path: 'apps/ward-console/src/main.ts', text: `const x = '${fourth}';` }])).toEqual([
      `apps/ward-console/src/main.ts: ${fourth} is not one of the three published addresses in packages/origins/contacts.json`,
    ]);
  });

  test('plant — privacy@ is rejected outside the exemption, in any case', () => {
    const privacy = `Privacy${'@'}${DOMAIN}`;
    expect(addressViolations([{ path: 'docs/privacy-notice.md', text: `write to ${privacy}` }]).join('\n')).toContain('names a privacy@ address, and there is none');
  });

  test('plant — a privacy@ address at another domain is rejected too', () => {
    const elsewhere = `privacy${'@'}openbed-ng.example.org`;
    expect(addressViolations([{ path: 'docs/privacy-notice.md', text: `write to ${elsewhere}.` }]).join('\n')).toContain('names a privacy@ address, and there is none');
  });

  test('accept — the rule stated in prose, "there is no privacy@", is not an address', () => {
    expect(addressViolations([{ path: 'packages/origins/contacts.json', text: `and there is no privacy${'@'}. The operator's` }])).toEqual([]);
  });

  test('plant — the exemption is exactly Sprint Kickoffs/ and docs/handoff*: a runbook is NOT exempt', () => {
    const fourth = `ops${'@'}${DOMAIN}`;
    expect(addressViolations([{ path: 'Sprint Kickoffs/x.md', text: fourth }, { path: 'docs/handoff-x.md', text: fourth }])).toEqual([]);
    expect(addressViolations([{ path: 'docs/runbook-x.md', text: fourth }])).toHaveLength(1);
  });

  test('accept — a package-name typo with no local part is not an address', () => {
    expect(addressViolations([{ path: 'docs/x.md', text: 'read from "@openbed.ng/origins"' }])).toEqual([]);
  });

  test('anti-vacuity — the checker over an empty corpus fails', () => {
    expect(addressViolations([])).toEqual(['no tracked file was read, so no address was checked']);
  });
});
