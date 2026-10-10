import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { withScratch, REPO_ROOT } from './_scratch.js';
import { OK_TRACE, TRACE_ONLY_CURL } from './_edge_stub.js';

/**
 * GUARD OVER scripts/edge_guard.sh (R-2026-09-30-217 GP, GP-3): the check both deploy wrappers run, after
 * their own refusals and before the first build, stamp or upload, on the Cloudflare edge the deploy would reach.
 *
 * HOW. Each leg sources the real script in a bash and calls `edge_guard test-wrapper`, with a `curl` first on
 * PATH that answers the trace request from the run's environment (tests/compliance/_edge_stub.ts, shared with
 * the two wrapper harnesses). The next line the bash runs is `echo REACHED-AFTER-THE-GUARD`: a refusal must
 * not print it, and the accept leg must, which is what shows the guard can be passed and that a refusal stops
 * the run rather than returning to its caller.
 *
 * THE WRAPPERS' OWN WIRING is held in tests/compliance/deploy_guards.test.ts and
 * tests/compliance/deploy_worker.test.ts: that each calls this, where, and that nothing is built or uploaded
 * after a refusal. This file holds the table of traces.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - that the colo this trace request reaches is the colo that answers wrangler's API calls. INFERRED from
 *     the founder's VPN success on 2026-10-10 (relayed by Cowork), never observed. The trace is on
 *     www.cloudflare.com and wrangler's calls go to api.cloudflare.com; nothing in this repository can ask
 *     Cloudflare which edge answered which.
 *   - the real trace. Every run here reads a stand-in; the real one is read only when the founder deploys.
 *   - whether the trigger is the client's country or the colo: the founder's four attempts cannot separate
 *     them, so the guard refuses on either and the plants below hold both.
 */

const EDGE_GUARD = 'edge_guard.sh';
const TRACE_CALL = 'curl -q -sS -m 12 https://www.cloudflare.com/cdn-cgi/trace';
const REFUSAL_SENTENCE =
  "Cloudflare's Lagos edge refuses deploys from Nigerian networks (R-2026-09-30-217 GP). Connect a VPN exiting outside Nigeria, check colo is not LOS, and run this again.";

interface Run {
  status: number;
  out: string;
  /** The stand-in's log: one line per request it was asked. */
  calls: string[];
}

function run(root: string, env: Record<string, string> = {}): Run {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'curl'), TRACE_ONLY_CURL, 'utf8');
  chmodSync(join(bin, 'curl'), 0o755);
  const log = join(root, 'stub.log');
  writeFileSync(log, '');
  const script = join(REPO_ROOT, 'scripts', EDGE_GUARD);
  let status = 0;
  let out = '';
  try {
    out = execFileSync('bash', ['-c', 'source "$1"; edge_guard test-wrapper; echo REACHED-AFTER-THE-GUARD', '_', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}`, STUB_LOG: log, ...env },
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    status = err.status ?? -1;
    out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  return { status, out, calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
}

/** What every refusal must do, whatever its reason: exit 1, say why, say the one sentence, stop the run, and have asked. */
function expectRefused(r: Run, reason: string): void {
  expect(r.status, `the edge was not refused with exit 1:\n${r.out}`).toBe(1);
  expect(r.out, 'the refusal did not give its own reason').toContain(reason);
  expect(r.out, 'the refusal did not print the one sentence').toContain(REFUSAL_SENTENCE);
  expect(r.out, 'the run went on after the refusal').not.toContain('REACHED-AFTER-THE-GUARD');
  expect(r.calls, 'the guard never asked for a trace, so nothing was judged').toEqual([TRACE_CALL]);
}

const LAGOS_OR_NIGERIA = 'REFUSING: the edge trace reads colo=';
const NOT_A_TRACE = 'is not a trace carrying one colo and one loc, so the edge this deploy would reach cannot be read';
const COULD_NOT_FETCH = 'could not be fetched (curl exited ';

describe('edge_guard.sh — a Lagos or Nigerian edge is refused before anything is built', () => {
  test('anti-vacuity — the guard asks for the trace at exactly the Cloudflare URL, once, with curl -q first', () => {
    withScratch((root) => {
      const r = run(root);
      expect(r.status, r.out).toBe(0);
      // The identity of the request, not its presence: a guard that read another host would pass every leg below.
      expect(r.calls).toEqual([TRACE_CALL]);
    });
  });

  test.each([
    ['colo LOS with loc GB: the Lagos edge alone', 'fl=1\ncolo=LOS\nloc=GB\n', 'LOS', 'GB'],
    ['loc NG with colo LHR: a Nigerian client alone', 'fl=1\ncolo=LHR\nloc=NG\n', 'LHR', 'NG'],
    ['colo LOS with loc NG: both', 'colo=LOS\nloc=NG\n', 'LOS', 'NG'],
    ['colo written in lower case', 'colo=los\nloc=gb\n', 'los', 'gb'],
    ['loc written in lower case', 'colo=lhr\nloc=ng\n', 'lhr', 'ng'],
    ['the real-shaped trace with colo changed to LOS', OK_TRACE.replace('colo=LHR', 'colo=LOS'), 'LOS', 'GB'],
    ['the real-shaped trace with loc changed to NG', OK_TRACE.replace('loc=GB', 'loc=NG'), 'LHR', 'NG'],
  ])('plant — %s is refused with exit 1, naming what was read', (_label, body, colo, loc) => {
    withScratch((root) => {
      // PRECONDITION: the plant took. The body differs from the ordinary one in exactly what the label says.
      expect(body, 'the plant is the ordinary trace').not.toBe(OK_TRACE);
      const r = run(root, { STUB_TRACE_BODY: body });
      expectRefused(r, `${LAGOS_OR_NIGERIA}${colo} loc=${loc}, which is Lagos or Nigeria`);
      expect(r.out, 'the edge was not printed').toContain(`test-wrapper: edge trace reads colo=${colo} loc=${loc}`);
    });
  });

  test.each([
    ['an HTML 429 page, as the Lagos edge answers an API call', '<!DOCTYPE html><html><head><title>429 Too Many Requests</title></head><body>Too Many Requests</body></html>\n'],
    ['an empty body', ''],
    ['a colo line and no loc line', 'colo=LHR\n'],
    ['a loc line and no colo line', 'loc=GB\n'],
    ['an empty colo value', 'colo=\nloc=GB\n'],
    ['an empty loc value', 'colo=LHR\nloc=\n'],
    ['two colo lines, even when they agree', 'colo=LHR\ncolo=LHR\nloc=GB\n'],
    ['two loc lines', 'colo=LHR\nloc=GB\nloc=GB\n'],
    ['a value with a character outside letters and digits', 'colo=LHR;x\nloc=GB\n'],
    ['a value of nine characters', 'colo=ABCDEFGHI\nloc=GB\n'],
    ['the key spelled with spaces round the equals sign', 'colo = LHR\nloc = GB\n'],
    ['other keys that merely start with the same letters', 'colocation=LHR\nlocation=GB\n'],
  ])('plant — %s is refused as not a trace, and nothing from it is echoed', (_label, body) => {
    withScratch((root) => {
      const r = run(root, { STUB_TRACE_BODY: body });
      expectRefused(r, NOT_A_TRACE);
      expect(r.out, 'the edge was not printed as unread').toContain('test-wrapper: edge trace reads colo=unread loc=unread');
      expect(r.out, 'text from the network body was echoed into the refusal').not.toContain('Too Many Requests');
    });
  });

  test.each([
    ['could not resolve the host', '6'],
    ['timed out', '28'],
  ])('plant — a trace that %s (curl exit %s) is refused, never read as agreement', (_label, code) => {
    withScratch((root) => {
      const r = run(root, { STUB_TRACE_EXIT: code });
      expectRefused(r, `${COULD_NOT_FETCH}${code}), so the edge this deploy would reach cannot be read`);
      expect(r.out, 'the edge was not printed as unread').toContain('test-wrapper: edge trace reads colo=unread loc=unread');
      expect(r.out, 'curl\'s own message was not shown').toContain('curl said: curl: (6) Could not resolve host');
    });
  });

  test.each([
    ['London', 'colo=LHR\nloc=GB\n', 'LHR', 'GB'],
    ['Amsterdam', 'colo=AMS\nloc=NL\n', 'AMS', 'NL'],
    ['the real-shaped trace with many other lines', OK_TRACE, 'LHR', 'GB'],
    ['CRLF line endings', 'colo=LHR\r\nloc=GB\r\n', 'LHR', 'GB'],
    ['a Tor exit, whose loc is a letter and a digit', 'colo=FRA\nloc=T1\n', 'FRA', 'T1'],
    ['lines whose keys only START like the two read', 'colocation=LOS\nlocation=NG\ncolo=LHR\nloc=GB\n', 'LHR', 'GB'],
  ])('real trace from %s is accepted, printed, and the run goes on', (_label, body, colo, loc) => {
    withScratch((root) => {
      const r = run(root, { STUB_TRACE_BODY: body });
      expect(r.status, `an ordinary edge was refused:\n${r.out}`).toBe(0);
      expect(r.out, 'the edge was not printed on an accepted run').toContain(`test-wrapper: edge trace reads colo=${colo} loc=${loc}`);
      expect(r.out, 'the run did not go on after the guard').toContain('REACHED-AFTER-THE-GUARD');
      expect(r.out, 'an accepted run printed a refusal').not.toContain('REFUSING');
      expect(r.calls, 'the accepted run never asked for a trace').toEqual([TRACE_CALL]);
    });
  });

  test.each([
    ['EDGE_TRACE_URL', 'https://example.invalid/cdn-cgi/trace'],
    ['EDGE_GUARD_SKIP', '1'],
    ['EDGE_GUARD_OFF', '1'],
    ['SKIP_EDGE_GUARD', '1'],
  ])('plant — the environment variable %s does not redirect or switch off the guard', (name, value) => {
    // THERE IS NO OVERRIDE (the script's header says so). With the guard pointed or switched off by the
    // environment, a Lagos trace would be accepted; it must still be refused, and the request must still be
    // the Cloudflare one.
    withScratch((root) => {
      const r = run(root, { [name]: value, STUB_TRACE_BODY: 'colo=LOS\nloc=GB\n' });
      expectRefused(r, `${LAGOS_OR_NIGERIA}LOS loc=GB, which is Lagos or Nigeria`);
    });
  });
});
