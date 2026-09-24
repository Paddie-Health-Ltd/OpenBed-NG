// @vitest-environment jsdom
/// <reference lib="dom" />
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import CONTACTS from '../../packages/origins/contacts.json';
import { WARD_SUPPORT_EMAIL } from '../../packages/origins/src/support.js';
import { REPO_ROOT } from './_scratch.js';
import { deployableApps, outputDirOf } from './_apps.js';

/**
 * A WARD SENT FOR HELP IS TOLD WHERE TO GO (R-2026-09-23-67 B1, B2).
 *
 * Every ward-console message that sends a ward to OpenBed for help names the ward
 * support address, read from ONE tracked setting: the `support` entry of
 * packages/origins/contacts.json (ward-support.json until PR 3.4b-app B).
 * Until this ruling they said "phone the OpenBed operator" and no number existed to
 * call. A message that points a ward at the operator with nothing to reach them by is
 * the defect, and it is refused here in the messages the console exports AND in its
 * source, so a new string cannot bring it back.
 *
 * THE VALUE IS PINNED, not merely shaped: support@openbed.ng is the founder's address
 * (the founder's receipt reading and Cowork's DNS reading, both recorded in
 * R-2026-09-23-67). It may never be security@ (disclosure) or hello@ (general), where
 * a ward in trouble would not be read in time.
 *
 * NOT ASSERTED HERE, deliberately: that the mailbox is READ, and how fast. Only the
 * founder's staffing can make that true; a phone or WhatsApp line with honest hours is
 * the open item B3.
 */

const HELP = /\b(operator|administrator|support|help)\b/i;

/** Messages that send a ward for help without naming the tracked address. Empty means none. */
export function unaddressedHelp(messages: readonly string[], address: string): string[] {
  return messages.filter((m) => HELP.test(m) && !m.includes(address));
}

/** Source strings that tell a ward to phone or contact the operator, comments stripped. */
export function bareOperatorInstructions(source: string): string[] {
  const code = source.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
  return [...code.matchAll(/\b(phone|call|contact|ring)\s+the\s+(OpenBed\s+)?operator\b/gi)].map((m) => m[0]);
}

async function consoleMessages(): Promise<string[]> {
  document.body.innerHTML = '<div id="app"></div>';
  const m = await import('../../apps/ward-console/src/main.js');
  return [m.UNRECOGNISED, m.ROW_REFUSED, m.LOAD_REFUSED, m.BAD_LINK, m.SIGNIN_ANSWERED, m.SIGNIN_UNREACHABLE, m.NO_WARD_SESSION, ...Object.values(m.WARD_MESSAGES)];
}

describe('the ward support address', () => {
  test('the tracked setting holds the founder\'s address, and it is not security@ or hello@', () => {
    expect(CONTACTS.support.address).toBe('support@openbed.ng');
    expect(WARD_SUPPORT_EMAIL, 'the module does not read the tracked file').toBe(CONTACTS.support.address);
    expect(WARD_SUPPORT_EMAIL).not.toMatch(/^(security|hello)@/);
  });

  test('real console messages are accepted — every one that sends a ward for help names the address', async () => {
    const messages = await consoleMessages();
    expect(messages.length, 'no messages found, so this checked nothing').toBeGreaterThan(10);
    expect(messages.filter((m) => HELP.test(m)).length, 'no message sends a ward for help, so this checked nothing').toBeGreaterThan(5);
    expect(unaddressedHelp(messages, WARD_SUPPORT_EMAIL)).toEqual([]);
  });

  test('plant — a bare "phone the OpenBed operator" message is rejected', () => {
    expect(unaddressedHelp(['If it keeps happening, phone the OpenBed operator.'], WARD_SUPPORT_EMAIL)).toHaveLength(1);
    expect(unaddressedHelp([`If it keeps happening, email ${WARD_SUPPORT_EMAIL}.`], WARD_SUPPORT_EMAIL), 'the ordinary correct message was refused').toEqual([]);
  });

  test("the console's source tells no ward to phone the operator, and the plant is caught", () => {
    const src = readFileSync(join(REPO_ROOT, 'apps/ward-console/src/main.ts'), 'utf8');
    expect(src).toContain('WARD_SUPPORT_EMAIL');
    expect(bareOperatorInstructions(src)).toEqual([]);
    expect(bareOperatorInstructions("const X = 'This ward is not set up yet. Phone the OpenBed operator.';")).toEqual(['Phone the OpenBed operator']);
    expect(bareOperatorInstructions(' * they said "phone the OpenBed operator" once'), 'a comment recording history was flagged').toEqual([]);
  });

  test('the ward console bundle carries the address, and EVERY OTHER app\'s bundle does not', () => {
    const js = (app: string): string => {
      const dir = join(REPO_ROOT, 'apps', app, outputDirOf(app), 'assets');
      expect(existsSync(dir), `run \`npm run build\` before the compliance suite — apps/${app} has no built output`).toBe(true);
      return readdirSync(dir).filter((n) => n.endsWith('.js')).map((n) => readFileSync(join(dir, n), 'utf8')).join('\n');
    };
    expect(js('ward-console'), 'the ward console shipped without its support address').toContain(WARD_SUPPORT_EMAIL);
    // Derived since PR 3.4b-app B (BP-9): every deployable app but the ward console,
    // so an app added later is held to it by existing.
    const others = deployableApps().filter((a) => a !== 'ward-console');
    expect(others.length, 'no other app was discovered, so this leg checked nothing').toBeGreaterThan(0);
    for (const app of others) expect(js(app), `the ward support address reached apps/${app}`).not.toContain(WARD_SUPPORT_EMAIL);
  });
});
