import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE AUTH HOOKS STAY OFF (R-2026-09-21-41 B; made a guarded invariant by PR F,
 * R-2026-09-26-122 CX-3).
 *
 * Roles are table lookups in app.ward_account, enforced in definer functions
 * (app.assert_member), and "the custom access token hook stays off" (R-2026-09-21-41 A).
 * A hook that minted claims into the JWT would become a second source of who-may-do-what,
 * outside the database's own checks. Until PR F that was a CONVENTION:
 * tests/db/config_drift.test.ts guards other keys and not the hook blocks, so nothing
 * reddened if someone enabled one. The trigger for guarding it -- the next change to
 * supabase/config.toml's auth section -- fired at f85d088 and 69e357a with nothing recorded.
 *
 * THE RULE: in supabase/config.toml, every LIVE (uncommented) `[auth.hook.<name>]` table
 * must say `enabled = false`. A live hook table with `enabled = true`, or with no
 * `enabled` key at all, fails. The stock scaffold's hook blocks are commented out, and a
 * commented block is not a table: the reader below recognises only an uncommented header.
 *
 * WHY HERE AND NOT IN config_drift: that file runs in the db project, with the stack up.
 * This needs only the file, so it runs in compliance, earlier and everywhere.
 *
 * NOT ASSERTED HERE, deliberately: the HOSTED project's hook settings. Hooks on hosted are a
 * dashboard setting, and no key readable from this repository reaches them. That is a
 * founder's read on hosted, not a claim this file can make.
 */

const CONFIG = join(REPO_ROOT, 'supabase', 'config.toml');

/** Every LIVE table in a TOML file, with its raw key = value lines. Comments are never headers. */
export function tables(toml: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const header = /^\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
    if (header !== null) {
      current = new Map();
      out.set((header[1] ?? '').trim(), current);
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (kv !== null && current !== null) current.set(kv[1] ?? '', kv[2] ?? '');
  }
  return out;
}

export function hookViolations(toml: string): string[] {
  const out: string[] = [];
  for (const [name, keys] of tables(toml)) {
    if (!name.startsWith('auth.hook.')) continue;
    const enabled = keys.get('enabled');
    if (enabled === undefined) out.push(`[${name}] is live and says nothing about enabled: a live hook table must say enabled = false`);
    else if (enabled !== 'false') out.push(`[${name}] is live with enabled = ${enabled}: the auth hooks stay off (R-2026-09-21-41)`);
  }
  return out;
}

const REAL = readFileSync(CONFIG, 'utf8');

describe('the auth hooks stay off in supabase/config.toml', () => {
  test('real supabase/config.toml is accepted — no live hook table is enabled', () => {
    const out = hookViolations(REAL);
    expect(out, out.join('\n')).toEqual([]);
  });

  test('anti-vacuity — the reader sees the real [auth] table, and sees the commented hook scaffold as a comment', () => {
    const t = tables(REAL);
    expect(t.has('auth'), 'the reader found no [auth] table: the guard would pass over nothing').toBe(true);
    expect(t.get('auth')?.get('enable_signup'), 'the reader does not read keys').toBe('false');
    expect(REAL, 'the stock hook scaffold is gone: the plants below would no longer mirror the file').toContain('# [auth.hook.custom_access_token]');
    expect([...t.keys()].filter((k) => k.startsWith('auth.hook.'))).toEqual([]);
  });

  test.each([
    ['custom_access_token uncommented and enabled', '# [auth.hook.custom_access_token]\n# enabled = true', '[auth.hook.custom_access_token]\nenabled = true', 'is live with enabled = true'],
    ['before_user_created uncommented and enabled', '# [auth.hook.before_user_created]\n# enabled = true', '[auth.hook.before_user_created]\nenabled = true', 'is live with enabled = true'],
    ['a live hook table with no enabled key', '# [auth.hook.custom_access_token]\n# enabled = true', '[auth.hook.custom_access_token]\n# enabled = true', 'says nothing about enabled'],
  ])('plant — %s is rejected', (_name, from, to, message) => {
    const planted = REAL.replace(from, to);
    expect(planted, 'the plant did not change the file').not.toBe(REAL);
    expect(hookViolations(planted).join('\n')).toContain(message);
  });

  test('a live hook table that says enabled = false is accepted, and a header with a trailing comment is still read', () => {
    expect(hookViolations('[auth]\nenabled = true\n[auth.hook.custom_access_token] # off by rule\nenabled = false\n')).toEqual([]);
    expect(hookViolations('[auth.hook.custom_access_token] # on\nenabled = true # no\n').join('\n')).toContain('is live with enabled = true');
  });
});
