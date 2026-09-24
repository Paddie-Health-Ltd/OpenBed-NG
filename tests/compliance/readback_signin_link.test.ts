import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE REDIRECT READ-BACK -- scripts/readback_signin_link.mjs (R-2026-09-24-73 BA-1;
 * R-2026-09-24-88 BP-7).
 *
 * PASS means one thing: this project's own Auth link, whose redirect_to decodes, ONCE,
 * to exactly the target the mode names. The plants below are the kickoff's four -- a
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
const AUTH = `https://${REF}.supabase.co/auth/v1/verify`;
const ADMIN = 'https://admin.openbed.ng/';
const link = (redirect: string | null, extra = '') =>
  `${AUTH}?token=${TOKEN}&type=magiclink${redirect === null ? '' : `&redirect_to=${redirect}`}${extra}`;

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
    expect(r.out).toContain("PASS: this project's Auth link, and redirect_to is exactly https://admin.openbed.ng/");
    expect(r.out).toContain(`link (token redacted): ${AUTH}?token=<redacted>&type=magiclink&redirect_to=${ADMIN}`);
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

  test('an unknown parameter and the fragment are redacted by NAME as well as value', () => {
    const r = run(link(ADMIN, `&${TOKEN}=1&%E0=${TOKEN}#access_token=${TOKEN}`));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('&<param>=<redacted>&<param>=<redacted>#<redacted>');
  });
});

describe('readback_signin_link — every other link is STOP', () => {
  test.each([
    ['the Site URL fallback in admin mode (AZ-1)', link('https://app.openbed.ng'), 1, 'STOP: redirect_to is the Site URL, https://app.openbed.ng: the fallback R-2026-09-23-72 AZ-1 names, never a working sign-in'],
    ['no redirect_to at all, which Auth also sends to the Site URL', link(null), 1, 'STOP: the link carries no redirect_to, so Auth sends it to the Site URL -- the fallback R-2026-09-23-72 AZ-1 names'],
    ['a foreign host — a click-tracking rewrite', `https://click.example.com/c/${TOKEN}?u=${encodeURIComponent(link(ADMIN))}`, 1, "STOP: the link's host is not this project's Auth host. Expected abcdefghijklmnopqrst.supabase.co, read click.example.com"],
    ['a lookalike Auth host', link(ADMIN).replace(`${REF}.supabase.co`, `${REF}.supabase.co.example.com`), 1, "STOP: the link's host is not this project's Auth host"],
    ['another project', link(ADMIN).replace(REF, 'zyxwvutsrqponmlkjihg'), 1, "STOP: the link's host is not this project's Auth host"],
    ['a path that is not the verify endpoint', link(ADMIN).replace('/auth/v1/verify', '/auth/v1/other'), 1, "STOP: the link's path is not /auth/v1/verify. Read /auth/v1/other"],
    ['a double-encoded target', link(encodeURIComponent(encodeURIComponent(ADMIN))), 1, 'STOP: redirect_to still holds a percent-escape after one decode. It is never decoded twice to find a match'],
    ['a lookalike redirect target', link('https://admin.openbed.ng.example.com/'), 1, 'STOP: redirect_to is not exactly https://admin.openbed.ng/'],
    ['the admin target without its trailing slash', link('https://admin.openbed.ng'), 1, 'and differs from it only by the trailing slash'],
    ['the ward target in admin mode', link('https://app.openbed.ng/'), 1, 'STOP: redirect_to is not exactly https://admin.openbed.ng/'],
    ['two redirect_to parameters', link(ADMIN, '&redirect_to=https://evil.example/'), 1, "STOP: the link carries more than one redirect_to, and which one Auth reads is not this script's to guess"],
    ['empty standard input — the anti-vacuity leg', '', 2, 'STOP: expected exactly one line on standard input, the sign-in link, and no verdict was reached'],
    ['two lines', `${link(ADMIN)}\n${link(ADMIN)}`, 2, 'STOP: expected exactly one line on standard input'],
    ['something that is not a link, echoed nowhere', `not a link ${TOKEN}`, 2, 'STOP: the input is not an https link, and no verdict was reached'],
    ['an http link', link(ADMIN).replace('https://', 'http://'), 2, 'STOP: the input is not an https link'],
  ])('plant — %s', (_name, input, status, message) => {
    const r = run(input);
    expect(r.status, r.out).toBe(status);
    expect(r.out).toContain(message);
    expect(r.out, 'a STOP also printed PASS').not.toContain('PASS');
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
