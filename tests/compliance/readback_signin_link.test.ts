import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';
import ORIGINS from '../../packages/origins/origins.json';

/**
 * THE REDIRECT READ-BACK -- scripts/readback_signin_link.mjs (R-2026-09-24-73 BA-1;
 * R-2026-09-24-88 BP-7; moved to api.openbed.ng by R-2026-09-30-177 FA-2 d).
 *
 * PASS means one thing: a link on api.openbed.ng, at /auth/v1/verify, with one
 * non-empty `token`, one `type` equal to magiclink, and a redirect_to that decodes,
 * ONCE, to exactly the target the mode names. The old <ref>.supabase.co host is a STOP
 * of its own, "the templates are not switched". The plants below are the kickoff's four -- a
 * Site URL fallback, a foreign host, a percent-encoded redirect_to, and a token that
 * must not appear in the output -- and every other way a link can fail to land.
 *
 * EVERY RUN IS A TOKEN LEG. Each link carries a planted token (in `token`, in an
 * unnamed parameter and in the fragment), and run() asserts it is absent from stdout
 * and stderr on every path, PASS or STOP: the link is a live credential.
 *
 * THE PERCENT-ENCODED TARGET IS AN ACCEPT, and that is the point of it. GoTrue encodes
 * redirect_to only when it holds &, = or # (BA-1), but a link can reach a reader in
 * either spelling. So the encoded correct target must PASS, printing two DIFFERENT
 * forms -- proof the decode happens -- while a DOUBLE-encoded one must STOP, because
 * decoding until something matches would accept a disguised value.
 *
 * A TERMINAL ON STANDARD INPUT IS REFUSED, and that leg is reached for real: python3's
 * standard-library pty module opens a pseudo-terminal and hands the child its slave
 * end as stdin only, so stdout and stderr stay pipes this test reads. No package is
 * added; python3 is on the macOS and Ubuntu machines this suite runs on. The obvious
 * form, pty.spawn(), was tried first and hung on macOS, because its copy loop does
 * not see the child's exit there.
 */
const TOOL = join(REPO_ROOT, 'scripts/readback_signin_link.mjs');
const REF = 'abcdefghijklmnopqrst';
const TOKEN = 'PLANTEDTOKEN77e1c0d93b';
const API = 'https://api.openbed.ng/auth/v1/verify';
const ADMIN = 'https://admin.openbed.ng/';
const link = (redirect: string | null, extra = '') =>
  `${API}?token=${TOKEN}&type=magiclink${redirect === null ? '' : `&redirect_to=${redirect}`}${extra}`;
/** A link with exactly the query given, for the rows about token and type. */
const withQuery = (q: string) => `${API}?${q}&redirect_to=${ADMIN}`;
const PROXY_HOST_STOP = "STOP: the link's host is not the OpenBed proxy's. Expected api.openbed.ng, read";

function run(input: string, args = ['--mode', 'admin', '--project-ref', REF]): { status: number; out: string } {
  let r: { status: number; out: string };
  try {
    r = { status: 0, out: execFileSync('node', [TOOL, ...args], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    r = { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
  expect(r.out, `the read-back printed the link's token:\n${r.out}`).not.toContain(TOKEN);
  return r;
}

describe('readback_signin_link — real links accepted', () => {
  test('the link exactly as GoTrue emits it reads PASS, printed with its token redacted', () => {
    const r = run(link(ADMIN));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('PASS: the link goes through api.openbed.ng, and redirect_to is exactly https://admin.openbed.ng/');
    expect(r.out).toContain(`link (token redacted): ${API}?token=<redacted>&type=magiclink&redirect_to=${ADMIN}`);
  });

  test('a lower-case percent-encoded redirect_to reads PASS, and the two printed forms differ', () => {
    const r = run(link(encodeURIComponent(ADMIN).toLowerCase()));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('redirect_to, as sent : https%3a%2f%2fadmin.openbed.ng%2f');
    expect(r.out).toContain('redirect_to, decoded : https://admin.openbed.ng/');
  });

  test('a percent-encoded correct target reads PASS, printing TWO DIFFERENT forms — the decode happens', () => {
    const r = run(link(encodeURIComponent(ADMIN)));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('redirect_to, as sent : https%3A%2F%2Fadmin.openbed.ng%2F');
    expect(r.out).toContain('redirect_to, decoded : https://admin.openbed.ng/');
  });

  test('ward mode passes the ward console target', () => {
    const r = run(link('https://app.openbed.ng/'), ['--mode', 'ward', '--project-ref', REF]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('redirect_to is exactly https://app.openbed.ng/');
  });

  test('the fragment alone is redacted and does not change the verdict — a link with no other parameter still reads PASS', () => {
    const r = run(link(ADMIN, `#access_token=${TOKEN}`));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(`redirect_to=${ADMIN}#<redacted>`);
  });
});

describe('readback_signin_link — every other link is STOP', () => {
  test.each([
    ['the Site URL fallback in admin mode (AZ-1)', link('https://app.openbed.ng'), 1, 'STOP: redirect_to is the Site URL, https://app.openbed.ng: the fallback R-2026-09-23-72 AZ-1 names, never a working sign-in'],
    ['no redirect_to at all, which Auth also sends to the Site URL', link(null), 1, 'STOP: the link carries no redirect_to, so Auth sends it to the Site URL -- the fallback R-2026-09-23-72 AZ-1 names'],
    ['a foreign host — a click-tracking rewrite', `https://click.example.com/c/${TOKEN}?u=${encodeURIComponent(link(ADMIN))}`, 1, `${PROXY_HOST_STOP} click.example.com`],
    // The OLD host: the founder has not pasted the templates yet, or has rolled them back.
    ['the old Supabase host — the templates are not switched', link(ADMIN).replace('api.openbed.ng', `${REF}.supabase.co`), 1, `STOP: the link still points at the Supabase host ${REF}.supabase.co: the templates are not switched`],
    ["another project's Supabase host", link(ADMIN).replace('api.openbed.ng', 'zyxwvutsrqponmlkjihg.supabase.co'), 1, `${PROXY_HOST_STOP} zyxwvutsrqponmlkjihg.supabase.co`],
    ['a lookalike of the old host', link(ADMIN).replace('api.openbed.ng', `${REF}.supabase.co.example.com`), 1, `${PROXY_HOST_STOP} ${REF}.supabase.co.example.com`],
    ['a lookalike of the proxy host', link(ADMIN).replace('api.openbed.ng', 'api.openbed.ng.example.com'), 1, `${PROXY_HOST_STOP} api.openbed.ng.example.com`],
    ['a SUBDOMAIN of the proxy host (FB-3 f)', link(ADMIN).replace('api.openbed.ng', 'evil.api.openbed.ng'), 1, `${PROXY_HOST_STOP} evil.api.openbed.ng`],
    ['only token_hash, which GET verify does not read', withQuery(`token_hash=${TOKEN}&type=magiclink`), 1, 'STOP: the link does not carry exactly one non-empty token, which is the one parameter GET verify reads the token hash from'],
    ['an empty token', withQuery('token=&type=magiclink'), 1, 'STOP: the link does not carry exactly one non-empty token'],
    ['two tokens', withQuery(`token=${TOKEN}&token=${TOKEN}&type=magiclink`), 1, 'STOP: the link does not carry exactly one non-empty token'],
    ['no type', withQuery(`token=${TOKEN}`), 1, "STOP: the link does not carry exactly one type, and which one Auth reads is not this script's to guess"],
    ['two types', withQuery(`token=${TOKEN}&type=magiclink&type=magiclink`), 1, 'STOP: the link does not carry exactly one type'],
    ['type=signup, the Confirm signup template where the Magic Link one is expected', withQuery(`token=${TOKEN}&type=signup`), 1, "STOP: the link's type is not magiclink. Read signup"],
    ['a path that is not the verify endpoint', link(ADMIN).replace('/auth/v1/verify', '/auth/v1/other'), 1, "STOP: the link's path is not /auth/v1/verify. Read /auth/v1/other"],
    ['a double-encoded target', link(encodeURIComponent(encodeURIComponent(ADMIN))), 1, 'STOP: redirect_to still holds a percent-escape after one decode. It is never decoded twice to find a match'],
    ['a lookalike redirect target', link('https://admin.openbed.ng.example.com/'), 1, 'STOP: redirect_to is not exactly https://admin.openbed.ng/'],
    ['the admin target without its trailing slash', link('https://admin.openbed.ng'), 1, 'and differs from it only by the trailing slash'],
    ['the ward target in admin mode', link('https://app.openbed.ng/'), 1, 'STOP: redirect_to is not exactly https://admin.openbed.ng/'],
    ['two redirect_to parameters', link(ADMIN, '&redirect_to=https://evil.example/'), 1, "STOP: the link carries more than one redirect_to, and which one Auth reads is not this script's to guess"],
    ['empty standard input — the anti-vacuity leg', '', 2, 'STOP: expected exactly one line on standard input, the sign-in link, and no verdict was reached'],
    ['two lines', `${link(ADMIN)}\n${link(ADMIN)}`, 2, 'STOP: expected exactly one line on standard input'],
    ['something that is not a link, echoed nowhere', `not a link ${TOKEN}`, 2, 'STOP: the input is not an https link, and no verdict was reached'],
    // KEPT BEHAVIOUR, not new: the script already refused any non-https link before W3 (exit 2, no verdict), so this
    // row is green on the previous script too. It is here so the api host is held to the same refusal.
    ['an http link on the api host', link(ADMIN).replace('https://', 'http://'), 2, 'STOP: the input is not an https link'],
  ])('plant — %s', (_name, input, status, message) => {
    const r = run(input);
    expect(r.status, r.out).toBe(status);
    expect(r.out).toContain(message);
    expect(r.out, 'a STOP also printed PASS').not.toContain('PASS');
  });

  // R-2026-09-30-178 FB-3 f: the template carries exactly token, type and redirect_to, so a link carrying anything
  // else is not the one it builds. Until FB this was a PASS that only redacted the extra name and value.
  test('an unknown parameter and a token_hash beside a token are STOP, and each is still redacted by NAME as well as value', () => {
    const unknown = run(link(ADMIN, `&${TOKEN}=1&%E0=${TOKEN}#access_token=${TOKEN}`));
    expect(unknown.status, unknown.out).toBe(1);
    expect(unknown.out).toContain('&<param>=<redacted>&<param>=<redacted>#<redacted>');
    expect(unknown.out).toContain('STOP: the link carries 2 parameter(s) other than token, type and redirect_to, and the template carries no others');
    const both = run(link(ADMIN, `&token_hash=${TOKEN}`));
    expect(both.status, both.out).toBe(1);
    expect(both.out).toContain('&token_hash=<redacted>');
    expect(both.out).toContain('STOP: the link carries 1 parameter(s) other than token, type and redirect_to, and the template carries no others');
    for (const r of [unknown, both]) expect(r.out, 'an over-parameterised link also printed PASS').not.toContain('PASS');
  });

  test("plant — the old host's STOP names the host and prints nothing else of the link, redirect_to included", () => {
    const r = run(link(ADMIN).replace('api.openbed.ng', `${REF}.supabase.co`));
    expect(r.status, r.out).toBe(1);
    expect(r.out).not.toContain('link (token redacted)');
    expect(r.out).not.toContain('redirect_to');
  });

  test("plant — a foreign host's path is never printed: it can carry the whole original link", () => {
    const r = run(`https://click.example.com/c/${encodeURIComponent(link(ADMIN))}`);
    expect(r.status).toBe(1);
    expect(r.out).not.toContain('/c/');
  });

  test('plant — the link given as an ARGUMENT is refused, and the refusal says to request a new one', () => {
    const r = run('', ['--mode', 'admin', '--project-ref', REF, link(ADMIN)]);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('STOP: a sign-in link was given as an argument, which puts it in your shell history. Request a new link, and pass it on standard input.');
  });

  test('plant — a terminal on standard input, with nothing piped in, is refused before anything is read', () => {
    const py = [
      'import os, pty, subprocess, sys',
      'm, s = pty.openpty()',
      'p = subprocess.run(sys.argv[1:], stdin=s, capture_output=True, timeout=20)',
      'os.close(s); os.close(m)',
      'sys.stdout.write(p.stdout.decode()); sys.stdout.write(p.stderr.decode()); sys.exit(p.returncode)',
    ].join('\n');
    let r: { status: number; out: string };
    try {
      r = { status: 0, out: execFileSync('python3', ['-c', py, 'node', TOOL, '--mode', 'admin', '--project-ref', REF], { encoding: 'utf8' }) };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      r = { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('STOP: nothing was piped in. Pass the link on standard input, as pbpaste | node scripts/readback_signin_link.mjs --mode <mode> --project-ref <ref>');
  });

  test.each([
    ['no arguments', []],
    ['no mode', ['--project-ref', REF]],
    ['a mode that is not admin or ward', ['--mode', 'operator', '--project-ref', REF]],
    ['a project ref that is not a ref', ['--mode', 'admin', '--project-ref', 'PROD']],
    ['an unknown flag', ['--mode', 'admin', '--project-ref', REF, '--follow', 'yes']],
  ])('usage — %s is refused with no verdict', (_name, args) => {
    const r = run(link(ADMIN), args);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('usage: pbpaste | node scripts/readback_signin_link.mjs --mode admin|ward --project-ref <ref>');
  });
});

/** The script's code, comment lines blanked: its header says what it must not import. */
function code(src: string): string {
  return src.split('\n').map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l)).join('\n');
}
function networkViolations(src: string): string[] {
  const text = code(src);
  const out: string[] = [];
  if (!/readFileSync\(0,/.test(text)) out.push('the script does not read standard input, so this is not the read-back');
  for (const m of text.matchAll(/\bfetch\s*\(|\bimport\s*\(|\brequire\s*\(|from\s+['"](?:node:)?(?:http|https|http2|net|tls|dns|dgram|child_process|worker_threads)['"]/g)) {
    out.push(`the read-back can reach the network or another process: ${m[0]}`);
  }
  return out;
}

/**
 * The host the read-back requires is the tracked API origin (packages/origins/origins.json,
 * `api.production`). The script cannot import it (it is a standalone node file), so it holds
 * a constant, and THIS is what holds the constant to the record: the behavioural pass over
 * W3's controls (Standard P) found the host written in two places with nothing holding them.
 */
export function proxyHostDrift(script: string, originsApiProduction: string): string[] {
  const here = /^const PROXY_HOST = '([^']+)';$/m.exec(script)?.[1];
  if (here === undefined) return ['PROXY HOST UNREADABLE: the script names no PROXY_HOST, so nothing was compared'];
  const there = new URL(originsApiProduction).host;
  return here === there ? [] : [`PROXY HOST DRIFT: the script requires ${here} and packages/origins/origins.json names ${there}`];
}

describe('readback_signin_link requires the tracked API origin as the link host', () => {
  const API_PRODUCTION = (ORIGINS as { api: { production: string } }).api.production;
  const REAL = readFileSync(TOOL, 'utf8');

  test('real script is accepted — PROXY_HOST equals the tracked api origin', () => {
    expect(proxyHostDrift(REAL, API_PRODUCTION)).toEqual([]);
  });

  test('plant — a PROXY_HOST that has drifted from origins.json is rejected', () => {
    const planted = REAL.replace("const PROXY_HOST = 'api.openbed.ng';", "const PROXY_HOST = 'api.openbed.example';");
    expect(planted, 'the plant did not change PROXY_HOST').not.toBe(REAL);
    expect(proxyHostDrift(planted, API_PRODUCTION)).toEqual(['PROXY HOST DRIFT: the script requires api.openbed.example and packages/origins/origins.json names api.openbed.ng']);
    expect(proxyHostDrift(REAL, 'https://api.elsewhere.example')).toEqual(['PROXY HOST DRIFT: the script requires api.openbed.ng and packages/origins/origins.json names api.elsewhere.example']);
  });

  test('anti-vacuity — a script with no PROXY_HOST fails rather than passing', () => {
    expect(proxyHostDrift('', API_PRODUCTION)).toEqual(['PROXY HOST UNREADABLE: the script names no PROXY_HOST, so nothing was compared']);
  });
});

describe('readback_signin_link makes no request and follows nothing', () => {
  const REAL = readFileSync(TOOL, 'utf8');

  test('real script is accepted', () => {
    expect(networkViolations(REAL)).toEqual([]);
  });

  test.each([
    ['a fetch of the link', 'const lines = readFileSync(0', "await fetch(lines[0]);\nconst lines = readFileSync(0"],
    ['an https import', "import { readFileSync } from 'node:fs';", "import { readFileSync } from 'node:fs';\nimport { get } from 'node:https';"],
    ['a child process', "import { readFileSync } from 'node:fs';", "import { readFileSync } from 'node:fs';\nimport { execFile } from 'node:child_process';"],
  ])('plant — %s is rejected', (_name, needle, replacement) => {
    expect(REAL, 'the plant target is gone').toContain(needle);
    expect(networkViolations(REAL.replace(needle, replacement)).length).toBeGreaterThan(0);
  });

  test('anti-vacuity — the checker over an empty corpus fails', () => {
    expect(networkViolations('')).toEqual(['the script does not read standard input, so this is not the read-back']);
  });
});
