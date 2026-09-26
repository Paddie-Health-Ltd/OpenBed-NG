import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE WORKER KEEPS NO REQUEST LOGS (R-2026-09-26-136 DL-3; the record of processing, G4).
 *
 * Every call to the database crosses the Worker supabase-proxy at api.openbed.ng: sign-in
 * requests carrying a ward's or the operator's address, access tokens carrying email and
 * user id, and every visitor's IP address and headers. Workers Logs, when enabled, would
 * keep a copy of each request at Cloudflare. The privacy notice says OpenBed keeps no
 * copy of a visitor's request details, so the Worker's configuration turns logging off:
 * supabase-proxy/wrangler.json carries "observability": { "enabled": false }.
 *
 * Asserted on the PARSED file, by value and type: the key present, and the boolean
 * false. A string "false" is truthy to anything that reads it loosely, and a missing key
 * leaves the account default in charge, which is not a decision this repository made.
 *
 * NOT ASSERTED HERE, deliberately: that the DEPLOYED Worker runs with this setting.
 * wrangler applies it on the next deploy; the founder redeploys with
 * scripts/deploy_worker.sh and reads back with scripts/readback_worker.sh
 * (docs/runbook-cloudflare-worker-proxy.md). The dashboard's own view of the Worker's
 * logs is not readable from this repository.
 */

const FILE = join(REPO_ROOT, 'supabase-proxy', 'wrangler.json');

/** Why a Worker config does not turn logging off, or []. */
function observabilityViolations(text: string | null): string[] {
  if (text === null) return ['supabase-proxy/wrangler.json does not exist: there is no Worker configuration to read'];
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch (e) {
    return [`supabase-proxy/wrangler.json is not JSON: ${(e as Error).message}`];
  }
  const obs = (config as { observability?: unknown }).observability;
  if (obs === undefined) return ['supabase-proxy/wrangler.json has no "observability" key: the account default decides whether requests are logged'];
  const enabled = (obs as { enabled?: unknown } | null)?.enabled;
  if (enabled !== false) return [`supabase-proxy/wrangler.json "observability.enabled" is ${JSON.stringify(enabled)}: it must be the boolean false`];
  return [];
}

describe('the Worker keeps no request logs (R-2026-09-26-136 DL-3)', () => {
  test('real supabase-proxy/wrangler.json is accepted — observability.enabled is false', () => {
    const out = observabilityViolations(existsSync(FILE) ? readFileSync(FILE, 'utf8') : null);
    expect(out, out.join('\n')).toEqual([]);
  });

  test.each([
    ['no observability key', '{"name":"supabase-proxy","main":"index.js"}', 'has no "observability" key'],
    ['logging switched on', '{"name":"supabase-proxy","observability":{"enabled":true}}', 'is true'],
    ['the string "false"', '{"name":"supabase-proxy","observability":{"enabled":"false"}}', 'is "false"'],
    ['an observability block with no enabled key', '{"name":"supabase-proxy","observability":{"head_sampling_rate":1}}', 'is undefined'],
    ['a file that is not JSON', '{"name": ', 'is not JSON'],
  ])('plant — %s is rejected', (_name, text, message) => {
    expect(observabilityViolations(text).join('\n')).toContain(message);
  });

  test('anti-vacuity — checker over an empty corpus fails', () => {
    expect(observabilityViolations(null).join('\n')).toContain('does not exist');
    expect(observabilityViolations('').join('\n')).toContain('is not JSON');
  });
});
