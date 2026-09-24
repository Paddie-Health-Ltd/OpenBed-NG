import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, test, vi } from 'vitest';
import LIST from '../../supabase-proxy/allow-list.json';
import { admits, makeHandler, PROXY_HEADER, STAMP_PATH, type AllowList } from '../../supabase-proxy/handler.js';
import { PROXY_HEADER as CLIENT_PROXY_HEADER, requestSignInLink } from '../../packages/auth/src/request.js';
import { REPO_ROOT } from './_scratch.js';

/**
 * api.openbed.ng FORWARDS EXACTLY WHAT THE APPS CALL, AND NOTHING ELSE
 * (R-2026-09-23-70; PR 3.3; kickoff "Allow-list, read from the code").
 *
 * THE LIST IS DERIVED, NEVER TRUSTED. supabase-proxy/allow-list.json must equal:
 *   - every Supabase call site in the apps and packages, found with the TypeScript
 *     parser (method note 17: a parser, not a regex) -- a URL template naming
 *     /auth/v1/ or /rest/v1/, and every `authedFetch('<literal>')`, which is the
 *     /rest/v1/ prefix holder.ts adds. Browser AND server-side (AJ E), so the corpus
 *     is apps/<app>/src, apps/<app>/functions and packages/<pkg>/src;
 *   - every probe sent through https://api.openbed.ng, each listed with its reason or
 *     named as a probe that must be REFUSED (R-2026-09-23-65 B2). Probes live in TWO
 *     declared places: a runbook's fenced block (docs/*.md), and an `api_probe METHOD
 *     PATH` line in a read-back script (scripts/readback_*.sh). The founder's
 *     read-backs moved from pasted fences into those scripts after the -70 H4 note,
 *     and a probe corpus left reading only docs/ would have seen none of them;
 *   - minus the calls that never pass through the Worker, each named with its ruling
 *     (`direct_origin_exceptions`): the /beds.json Function's direct read (-58 A5), and
 *     GET /auth/v1/verify, where the emailed link is consumed (C2).
 * An unlisted call, an entry nothing calls, a probe path missing from the list, a
 * preflight for nothing, a query the code does not send, and a stamp path that could
 * collide with a forwarded one each turn this red.
 *
 * WHAT A TOO-NARROW LIST BREAKS, so the reds below have their cost attached:
 * without /auth/v1/otp the ward's link request fails (and, but for the request.ts leg
 * below, silently: the Worker's 404 would read as GoTrue's answer); without the token
 * entry sessions end early; without either RPC the ward cannot load or publish.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - that the DEPLOYED Worker runs this list. That is the stamp read-back in
 *     scripts/deploy_worker.sh and the source-equality probe in the Worker runbook.
 *   - a call built from a URL this parser cannot read as a template (a variable
 *     concatenated at runtime). The only such prefix today, authedFetch, is resolved at
 *     its call sites, and a non-literal argument to it is refused rather than guessed.
 *   - the hosted gateway's CORS answer. Observed by Cowork on 2026-09-23 (-70), not
 *     re-observed here.
 */

const LIST_TYPED = LIST as unknown as AllowList & {
  direct_origin_exceptions: { method: string; path: string; file: string | null; reason: string }[];
  refusal_probes: { method: string; path: string; reason: string }[];
};

interface CallSite {
  readonly file: string;
  readonly line: number;
  readonly method: string;
  readonly path: string;
  /** The literal query the code sends, or null when there is none or it is built at runtime. */
  readonly query: string | null;
}

/** The declared corpus: apps/<app>/{src,functions} and packages/<pkg>/src, TypeScript, no tests. */
export function corpusFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) {
        if (!['node_modules', 'dist', '.functions-build', '.wrangler'].includes(n)) walk(p);
      } else if (n.endsWith('.ts') && !n.endsWith('.test.ts') && !n.endsWith('.d.ts')) out.push(p);
    }
  };
  for (const top of ['apps', 'packages']) {
    const base = join(root, top);
    if (!existsSync(base)) continue;
    for (const a of readdirSync(base)) for (const sub of ['src', 'functions']) walk(join(base, a, sub));
  }
  return out.sort();
}

const SERVICE = /\/(auth|rest)\/v1\//;

function methodOf(init: ts.Expression | undefined): string {
  if (init === undefined || !ts.isObjectLiteralExpression(init)) return 'GET';
  for (const p of init.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === 'method' && ts.isStringLiteralLike(p.initializer)) return p.initializer.text;
  }
  return 'GET';
}

/** Every Supabase call site in the given sources. `unresolved` names what could not be derived. */
export function callSites(sources: Record<string, string>, root: string): { sites: CallSite[]; unresolved: string[] } {
  const sites: CallSite[] = [];
  const unresolved: string[] = [];
  for (const [file, text] of Object.entries(sources)) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rel = relative(root, file);
    const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    const visit = (n: ts.Node): void => {
      if (ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
        let literal = ts.isNoSubstitutionTemplateLiteral(n) ? n.text : n.head.text;
        if (ts.isTemplateExpression(n)) for (const s of n.templateSpans) literal += '${' + s.expression.getText(sf) + '}' + s.literal.text;
        const at = literal.search(SERVICE);
        if (at >= 0) {
          const [path = '', query] = literal.slice(at).split('?', 2);
          if (!path.includes('${')) {
            // The request method: the fetch that consumes this URL, in the enclosing function.
            let method = 'GET';
            let host: ts.Node | undefined = n.parent;
            while (host !== undefined && !ts.isFunctionLike(host)) host = host.parent;
            const scan = (x: ts.Node): void => {
              if (ts.isCallExpression(x) && x.arguments.length >= 2 && /fetch/i.test(x.expression.getText(sf))) {
                const a0 = x.arguments[0];
                if (a0 === n || (a0 !== undefined && ts.isIdentifier(a0) && ts.isVariableDeclaration(n.parent) && n.parent.name.getText(sf) === a0.text)) {
                  method = methodOf(x.arguments[1]);
                }
              }
              ts.forEachChild(x, scan);
            };
            if (host !== undefined) scan(host);
            sites.push({ file: rel, line: lineOf(n), method, path, query: query === undefined || query.includes('${') ? null : query });
          }
        }
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'authedFetch') {
        const a0 = n.arguments[0];
        if (a0 !== undefined && ts.isStringLiteralLike(a0)) {
          const [p = '', q] = a0.text.replace(/^\/+/, '').split('?', 2);
          sites.push({ file: rel, line: lineOf(n), method: methodOf(n.arguments[1]), path: `/rest/v1/${p}`, query: q ?? null });
        } else {
          unresolved.push(`${rel}:${lineOf(n)} authedFetch with a non-literal path -- the call cannot be derived, so it cannot be listed`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { sites, unresolved };
}

interface Probe {
  readonly file: string;
  readonly line: number;
  readonly method: string;
  readonly path: string;
}

/** Every request a runbook sends through api.openbed.ng, from fenced blocks only. */
export function runbookProbes(docs: Record<string, string>): Probe[] {
  const out: Probe[] = [];
  for (const [file, text] of Object.entries(docs)) {
    let inFence = false;
    text.split('\n').forEach((line, i) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return;
      }
      if (!inFence) return;
      for (const m of line.matchAll(/https:\/\/api\.openbed\.ng(\/[A-Za-z0-9_/.-]*)/g)) {
        const method = /\s-I\b/.test(line) ? 'HEAD' : (/-X\s+([A-Z]+)/.exec(line)?.[1] ?? 'GET');
        out.push({ file, line: i + 1, method, path: m[1] ?? '' });
      }
    });
  }
  return out;
}

/**
 * Every request a read-back script sends to api.openbed.ng: its `api_probe METHOD PATH`
 * lines, the one form scripts/readback_common.sh allows for that host. A request to
 * the host written any other way is refused by name rather than missed, since a
 * probe this parser cannot see is a probe the list is never held against.
 */
export function scriptProbes(scripts: Record<string, string>): { probes: Probe[]; unreadable: string[] } {
  const probes: Probe[] = [];
  const unreadable: string[] = [];
  for (const [file, text] of Object.entries(scripts)) {
    text.split('\n').forEach((line, i) => {
      if (/^\s*#/.test(line)) return;
      const m = /^\s*api_probe\s+([A-Z]+)\s+(\/[A-Za-z0-9_/.-]*)(\s|$)/.exec(line);
      if (m !== null) {
        probes.push({ file, line: i + 1, method: m[1] ?? '', path: m[2] ?? '' });
        return;
      }
      if (/api_probe\s/.test(line) && !/^\s*api_probe\(\)/.test(line)) {
        unreadable.push(`UNREADABLE PROBE: ${file}:${i + 1} calls api_probe without a literal METHOD and /path`);
      }
      if (/https:\/\/api\.openbed\.ng\//.test(line)) {
        unreadable.push(`UNREADABLE PROBE: ${file}:${i + 1} names https://api.openbed.ng/... outside api_probe`);
      }
    });
  }
  return { probes, unreadable };
}

const SUPABASE_SERVICE_PREFIXES = ['/auth/v1', '/rest/v1', '/storage/v1', '/realtime/v1', '/functions/v1', '/graphql/v1', '/pg'];

/** Everything wrong between the list, the code and the runbooks. Empty means they agree. */
export function coverageViolations(
  list: typeof LIST_TYPED,
  derived: { sites: CallSite[]; unresolved: string[] },
  probes: Probe[],
  stampPath: string = STAMP_PATH,
): string[] {
  const out = [...derived.unresolved];
  const key = (m: string, p: string): string => `${m} ${p}`;
  const used = new Set<string>();

  const isDirect = (s: CallSite): boolean =>
    list.direct_origin_exceptions.some((d) => d.file === s.file && d.method === s.method && d.path === s.path);
  for (const d of list.direct_origin_exceptions) {
    if (d.file !== null && !derived.sites.some((s) => s.file === d.file && s.method === d.method && s.path === d.path)) {
      out.push(`STALE EXCEPTION: ${key(d.method, d.path)} in ${d.file} is named as a direct-origin call and no such call exists`);
    }
  }

  for (const s of derived.sites) {
    if (isDirect(s)) continue;
    const entry = list.forward.find((e) => e.method === s.method && e.path === s.path);
    if (entry === undefined) {
      out.push(`UNLISTED: ${key(s.method, s.path)} is called at ${s.file}:${s.line} and api.openbed.ng would refuse it`);
      continue;
    }
    used.add(key(entry.method, entry.path));
    if ((entry.query ?? null) !== s.query) {
      out.push(`QUERY: ${key(s.method, s.path)} is called with ${s.query === null ? 'no fixed query' : `?${s.query}`} at ${s.file}:${s.line}, and the list forwards ${entry.query === undefined ? 'any query' : `only ?${entry.query}`}`);
    }
    if (s.method !== 'GET' && !list.forward.some((e) => e.method === 'OPTIONS' && e.path === s.path)) {
      out.push(`NO PREFLIGHT: ${key(s.method, s.path)} is called from a browser page and its OPTIONS preflight is not forwarded`);
    }
  }

  for (const p of probes) {
    if (p.path === stampPath) continue;
    if (list.refusal_probes.some((r) => r.method === p.method && r.path === p.path)) {
      if (admits(list, p.method, p.path, '') !== undefined) out.push(`REFUSAL PROBE FORWARDED: ${key(p.method, p.path)} in ${p.file}:${p.line} must read the Worker's 404, and the list forwards it`);
      continue;
    }
    const entry = admits(list, p.method, p.path, '');
    if (entry === undefined) {
      out.push(`UNLISTED PROBE: ${key(p.method, p.path)} in ${p.file}:${p.line} -- once deployed, the Worker refuses it and the probe reads STOP`);
      continue;
    }
    used.add(key(entry.method, entry.path));
    if (!derived.sites.some((s) => s.method === entry.method && s.path === entry.path) && !/^runbook probe: /.test(entry.reason ?? '')) {
      out.push(`PROBE WITHOUT REASON: ${key(entry.method, entry.path)} is listed only for a probe, and its reason does not say so`);
    }
  }

  for (const e of list.forward) {
    if (e.method === 'OPTIONS') {
      if (e.preflight_for === undefined || !list.forward.some((f) => key(f.method, f.path) === e.preflight_for)) {
        out.push(`PREFLIGHT FOR NOTHING: OPTIONS ${e.path} names no forwarded request it is the preflight of`);
      }
      continue;
    }
    if (!used.has(key(e.method, e.path))) out.push(`UNUSED ENTRY: ${key(e.method, e.path)} -- nothing in the code or the runbooks calls it`);
  }

  // A refusal probe nothing sends proves nothing: the off-list 404 would go unread.
  for (const r of list.refusal_probes) {
    if (!probes.some((p) => p.method === r.method && p.path === r.path)) {
      out.push(`REFUSAL PROBE UNSENT: ${key(r.method, r.path)} is listed as a probe the Worker must refuse, and nothing sends it`);
    }
  }

  // C2: the sign-in link's own path must be decided, forwarded or named direct.
  if (!list.forward.some((e) => e.method === 'GET' && e.path === '/auth/v1/verify') &&
      !list.direct_origin_exceptions.some((d) => d.method === 'GET' && d.path === '/auth/v1/verify')) {
    out.push('VERIFY UNDECIDED: GET /auth/v1/verify, where every emailed sign-in link is consumed, is neither forwarded nor named as a direct-origin exception');
  }

  const seg = (p: string): string => `/${p.split('/')[1] ?? ''}`;
  for (const pre of SUPABASE_SERVICE_PREFIXES) if (seg(stampPath) === seg(pre)) out.push(`STAMP COLLISION: ${stampPath} shares its first segment with Supabase's ${pre}`);
  for (const e of list.forward) if (seg(stampPath) === seg(e.path)) out.push(`STAMP COLLISION: ${stampPath} shares its first segment with ${key(e.method, e.path)}`);

  return out;
}

function realSources(): Record<string, string> {
  return Object.fromEntries(corpusFiles(REPO_ROOT).map((f) => [f, readFileSync(f, 'utf8')]));
}

function realDocs(): Record<string, string> {
  const dir = join(REPO_ROOT, 'docs');
  return Object.fromEntries(readdirSync(dir).filter((n) => n.endsWith('.md')).map((n) => [`docs/${n}`, readFileSync(join(dir, n), 'utf8')]));
}

/** The declared script corpus: every scripts/readback_*.sh, discovered, keyed by repo path. */
function realScripts(): Record<string, string> {
  const dir = join(REPO_ROOT, 'scripts');
  return Object.fromEntries(
    readdirSync(dir)
      .filter((n) => /^readback_.*\.sh$/.test(n))
      .map((n) => [`scripts/${n}`, readFileSync(join(dir, n), 'utf8')]),
  );
}

const check = (
  list = LIST_TYPED,
  extraSources: Record<string, string> = {},
  docs = realDocs(),
  stamp = STAMP_PATH,
  scripts = realScripts(),
): string[] => {
  const fromScripts = scriptProbes(scripts);
  return [
    ...fromScripts.unreadable,
    ...coverageViolations(list, callSites({ ...realSources(), ...extraSources }, REPO_ROOT), [...runbookProbes(docs), ...fromScripts.probes], stamp),
  ];
};

const PLANT_FILE = join(REPO_ROOT, 'apps', 'ward-console', 'src', 'planted.ts');

describe('the allow-list against the code and the runbooks', () => {
  test('the corpus is the declared one, and every call it derives is the one expected', () => {
    const files = corpusFiles(REPO_ROOT).map((f) => relative(REPO_ROOT, f));
    expect(files, 'the corpus lost a file this guard depends on').toEqual(
      expect.arrayContaining([
        'apps/ward-console/src/main.ts',
        'apps/admin/src/main.ts',
        'apps/public-dashboard/functions/beds.json.ts',
        'packages/auth/src/request.ts',
        'packages/auth/src/holder.ts',
        'packages/snapshot/src/serve.ts',
      ]),
    );
    const { sites, unresolved } = callSites(realSources(), REPO_ROOT);
    expect(unresolved).toEqual([]);
    expect(sites.map((s) => `${s.method} ${s.path}${s.query === null ? '' : `?${s.query}`} @ ${s.file}`).sort()).toEqual([
      'GET /rest/v1/snapshot_current?select=v,payload&order=v.desc&limit=1 @ packages/snapshot/src/serve.ts',
      'POST /auth/v1/otp @ packages/auth/src/request.ts',
      'POST /auth/v1/token?grant_type=refresh_token @ packages/auth/src/holder.ts',
      'POST /rest/v1/rpc/my_facility_wards @ apps/ward-console/src/main.ts',
      'POST /rest/v1/rpc/operator_add_category @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/operator_create_facility @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/operator_edit_facility @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/operator_get_contact @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/operator_record_agreement @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/operator_record_contact @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/operator_register @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/operator_set_facility_listed @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/publish_ward_status @ apps/ward-console/src/main.ts',
    ]);
    expect(runbookProbes(realDocs()).length + scriptProbes(realScripts()).probes.length, 'no probe was found, so the probe rule checked nothing').toBeGreaterThan(0);
  });

  test('the probe corpus is the declared one — the read-back scripts, and every api.openbed.ng probe they send', () => {
    // Discovered, then held against the declared set by identity (test-conventions 2(d)).
    // scripts/readback_public_output.sh (R-2026-09-24-73 BA-2) reads openbed.ng/beds.json
    // and the database, and sends nothing to api.openbed.ng, so it adds no probe below.
    // Nor does scripts/readback_function_grants.sh (R-2026-09-24-74 BB-2), which reads
    // only the database.
    expect(Object.keys(realScripts()).sort()).toEqual([
      'scripts/readback_admin.sh',
      'scripts/readback_common.sh',
      'scripts/readback_function_grants.sh',
      'scripts/readback_pages.sh',
      'scripts/readback_public_output.sh',
      'scripts/readback_ward_console.sh',
      'scripts/readback_worker.sh',
    ]);
    const { probes, unreadable } = scriptProbes(realScripts());
    expect(unreadable).toEqual([]);
    expect(probes.map((p) => `${p.method} ${p.path} @ ${p.file}`).sort()).toEqual([
      'GET /__openbed/version @ scripts/readback_worker.sh',
      'GET /auth/v1/settings @ scripts/readback_admin.sh',
      'GET /auth/v1/settings @ scripts/readback_admin.sh',
      'GET /auth/v1/settings @ scripts/readback_ward_console.sh',
      'GET /auth/v1/settings @ scripts/readback_ward_console.sh',
      'GET /auth/v1/settings @ scripts/readback_worker.sh',
      'GET /rest/v1/ @ scripts/readback_worker.sh',
      'HEAD /__openbed/version @ scripts/readback_worker.sh',
      'HEAD /auth/v1/settings @ scripts/readback_worker.sh',
      'POST /rest/v1/rpc/my_facility_wards @ scripts/readback_worker.sh',
      'POST /rest/v1/rpc/operator_register @ scripts/readback_admin.sh',
    ]);
  });

  test('real allow-list is accepted — it equals what the code and the runbooks call', () => {
    expect(check()).toEqual([]);
  });

  test('plant — a call the list does not carry is rejected', () => {
    const v = check(LIST_TYPED, { [PLANT_FILE]: "export const x = (h: any) => h.authedFetch('rpc/planted_new_rpc', { method: 'POST' });\n" });
    expect(v.join('\n')).toContain('UNLISTED: POST /rest/v1/rpc/planted_new_rpc is called at apps/ward-console/src/planted.ts:1');
  });

  test('plant — an entry nothing calls is rejected', () => {
    const planted = { ...LIST_TYPED, forward: [...LIST_TYPED.forward, { method: 'POST', path: '/rest/v1/rpc/nobody_calls_this', reason: 'planted' }] };
    expect(check(planted)).toEqual(['UNUSED ENTRY: POST /rest/v1/rpc/nobody_calls_this -- nothing in the code or the runbooks calls it']);
  });

  test('plant — an authedFetch with a computed path is refused rather than guessed', () => {
    const v = check(LIST_TYPED, { [PLANT_FILE]: "export const x = (h: any, p: string) => h.authedFetch(p, { method: 'POST' });\n" });
    expect(v.join('\n')).toContain('authedFetch with a non-literal path');
  });

  test('plant — a new direct-origin read that is not named as an exception is rejected', () => {
    const planted = { ...LIST_TYPED, direct_origin_exceptions: LIST_TYPED.direct_origin_exceptions.filter((d) => d.file === null) };
    expect(check(planted).join('\n')).toContain('UNLISTED: GET /rest/v1/snapshot_current is called at packages/snapshot/src/serve.ts');
  });

  test('plant — the H4 probe path missing from the list is rejected (R-2026-09-23-65 B1, B2)', () => {
    const planted = { ...LIST_TYPED, forward: LIST_TYPED.forward.filter((e) => e.path !== '/auth/v1/settings') };
    expect(check(planted).join('\n')).toContain('UNLISTED PROBE: GET /auth/v1/settings in scripts/readback_ward_console.sh');
  });

  test('plant — an unlisted probe is rejected in EACH declared location, a runbook fence and a read-back script', () => {
    const docs = { ...realDocs(), 'docs/planted.md': '```bash\ncurl -sS https://api.openbed.ng/rest/v1/rpc/planted_in_a_fence\n```\n' };
    expect(check(LIST_TYPED, {}, docs).join('\n')).toContain('UNLISTED PROBE: GET /rest/v1/rpc/planted_in_a_fence in docs/planted.md');
    const scripts = { ...realScripts(), 'scripts/readback_planted.sh': 'api_probe GET /rest/v1/rpc/planted_in_a_script\n' };
    expect(check(LIST_TYPED, {}, realDocs(), STAMP_PATH, scripts).join('\n')).toContain('UNLISTED PROBE: GET /rest/v1/rpc/planted_in_a_script in scripts/readback_planted.sh');
  });

  test('plant — a read-back script reaching api.openbed.ng other than through api_probe is refused, not missed', () => {
    const scripts = { ...realScripts(), 'scripts/readback_planted.sh': 'curl -sS https://api.openbed.ng/rest/v1/rpc/hidden\napi_probe GET "$P"\n' };
    const v = check(LIST_TYPED, {}, realDocs(), STAMP_PATH, scripts);
    expect(v).toContain('UNREADABLE PROBE: scripts/readback_planted.sh:1 names https://api.openbed.ng/... outside api_probe');
    expect(v).toContain('UNREADABLE PROBE: scripts/readback_planted.sh:2 calls api_probe without a literal METHOD and /path');
  });

  test('plant — a refusal probe that nothing sends is rejected', () => {
    const worker = realScripts()['scripts/readback_worker.sh'] ?? '';
    const planted = worker.replace(/^api_probe GET \/rest\/v1\/$/m, '# probe 3 removed');
    // CONFIRM THE PLANT LANDED on the line the corpus reads (test-conventions, 2026-09-21).
    expect(planted, 'the plant did not remove probe 3').not.toBe(worker);
    const v = check(LIST_TYPED, {}, realDocs(), STAMP_PATH, { ...realScripts(), 'scripts/readback_worker.sh': planted });
    expect(v).toEqual(['REFUSAL PROBE UNSENT: GET /rest/v1/ is listed as a probe the Worker must refuse, and nothing sends it']);
  });

  test('plant — a preflight missing for a browser call is rejected', () => {
    const planted = { ...LIST_TYPED, forward: LIST_TYPED.forward.filter((e) => !(e.method === 'OPTIONS' && e.path === '/auth/v1/otp')) };
    expect(check(planted)).toEqual(['NO PREFLIGHT: POST /auth/v1/otp is called from a browser page and its OPTIONS preflight is not forwarded']);
  });

  test('plant — the token entry without its one query is rejected, and a different grant is refused (C4)', () => {
    const planted = {
      ...LIST_TYPED,
      forward: LIST_TYPED.forward.map((e) => (e.path === '/auth/v1/token' && e.method === 'POST' ? { method: e.method, path: e.path, reason: e.reason ?? '' } : e)),
    };
    expect(check(planted).join('\n')).toContain('QUERY: POST /auth/v1/token is called with ?grant_type=refresh_token');
    expect(admits(LIST_TYPED, 'POST', '/auth/v1/token', '?grant_type=password'), 'a password grant was forwarded').toBeUndefined();
    expect(admits(LIST_TYPED, 'POST', '/auth/v1/token', '?grant_type=refresh_token'), 'the refresh grant the code sends was refused').toBeDefined();
  });

  test('plant — /auth/v1/verify removed from the exceptions while not forwarded is rejected (C2)', () => {
    const planted = { ...LIST_TYPED, direct_origin_exceptions: LIST_TYPED.direct_origin_exceptions.filter((d) => d.path !== '/auth/v1/verify') };
    expect(check(planted).join('\n')).toContain('VERIFY UNDECIDED: GET /auth/v1/verify');
  });

  test('plant — a stamp path that could collide with a forwarded path is rejected', () => {
    expect(check(LIST_TYPED, {}, realDocs(), '/auth/v1/version').join('\n')).toContain("STAMP COLLISION: /auth/v1/version shares its first segment with Supabase's /auth/v1");
    expect(check(LIST_TYPED, {}, realDocs(), '/rest/version').join('\n')).toContain("shares its first segment with Supabase's /rest/v1");
  });

  test('sign-up is not forwarded — the design is invite-only (kickoff, PR 3.3)', () => {
    expect(admits(LIST_TYPED, 'POST', '/auth/v1/signup', '')).toBeUndefined();
  });

  test('anti-vacuity — an empty corpus derives nothing, and the check says so', () => {
    const v = coverageViolations(LIST_TYPED, { sites: [], unresolved: [] }, []);
    expect(v.filter((x) => x.startsWith('UNUSED ENTRY')).length, 'an empty corpus passed as agreeing').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The Worker's decision, called as the Worker calls it.
// ---------------------------------------------------------------------------

const ORIGIN = 'https://example-ref.supabase.co';
const STAMP = { commit: 'a'.repeat(40), dirty: false, built_at: '2026-09-23T00:00:00.000Z' };

function worker(): { handle: (r: Request) => Promise<Response>; upstream: ReturnType<typeof vi.fn> } {
  const upstream = vi.fn(async (r: Request) => new Response(JSON.stringify({ seen: r.url, host: r.headers.get('host') }), { status: 200, headers: { 'content-type': 'application/json' } }));
  return { handle: makeHandler({ origin: ORIGIN, list: LIST_TYPED, stamp: STAMP, fetchImpl: upstream }), upstream };
}

describe('the Worker, called as the Worker calls it', () => {
  test('a listed call is forwarded to the origin, Host rewritten, and the answer says so', async () => {
    const { handle, upstream } = worker();
    const res = await handle(new Request('https://api.openbed.ng/rest/v1/rpc/publish_ward_status', { method: 'POST', body: '{"x":1}', headers: { apikey: 'k' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get(PROXY_HEADER)).toBe('forwarded');
    expect(upstream).toHaveBeenCalledTimes(1);
    const sent = upstream.mock.calls[0]?.[0] as Request;
    expect(sent.url).toBe(`${ORIGIN}/rest/v1/rpc/publish_ward_status`);
    expect(sent.headers.get('apikey'), 'the caller credential was not passed on').toBe('k');
    expect(await sent.text()).toBe('{"x":1}');
  });

  test('plant — an off-list path is refused HERE: 404, marked, readable cross-origin, and Supabase is never contacted', async () => {
    const { handle, upstream } = worker();
    for (const [method, path] of [['GET', '/rest/v1/'], ['POST', '/auth/v1/signup'], ['GET', '/auth/v1/health'], ['POST', '/auth/v1/token?grant_type=password'], ['OPTIONS', '/storage/v1/object']] as const) {
      const res = await handle(new Request(`https://api.openbed.ng${path}`, { method }));
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.headers.get(PROXY_HEADER), `${method} ${path}`).toBe('refused');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-expose-headers')).toBe(PROXY_HEADER);
      expect(await res.text()).toBe('{"message":"not forwarded by the OpenBed proxy"}');
    }
    expect(upstream, 'a refused request reached the origin').not.toHaveBeenCalled();
  });

  test('the stamp is answered by the Worker itself, on GET and HEAD, and never forwarded', async () => {
    const { handle, upstream } = worker();
    const get = await handle(new Request(`https://api.openbed.ng${STAMP_PATH}`));
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual(STAMP);
    expect(get.headers.get(PROXY_HEADER)).toBe('stamp');
    const head = await handle(new Request(`https://api.openbed.ng${STAMP_PATH}`, { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(upstream).not.toHaveBeenCalled();
  });

  test('HEAD is served on a GET entry, and a preflight is forwarded only for a listed browser path', async () => {
    const { handle, upstream } = worker();
    expect((await handle(new Request('https://api.openbed.ng/auth/v1/settings', { method: 'HEAD' }))).headers.get(PROXY_HEADER)).toBe('forwarded');
    expect((await handle(new Request('https://api.openbed.ng/auth/v1/otp', { method: 'OPTIONS' }))).headers.get(PROXY_HEADER)).toBe('forwarded');
    expect((await handle(new Request('https://api.openbed.ng/auth/v1/signup', { method: 'OPTIONS' }))).headers.get(PROXY_HEADER)).toBe('refused');
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// The ward console reads a refusal as "not sent", never as "sent".
// ---------------------------------------------------------------------------

describe('a Worker refusal is not an answer from GoTrue (R-2026-09-23-70 B, C3)', () => {
  const ask = (res: Response) =>
    requestSignInLink({ apiUrl: 'https://api.openbed.ng', anonKey: 'k', email: 'ward@example.invalid', redirectTo: 'https://app.openbed.ng/', fetch: vi.fn(async () => res) as unknown as typeof fetch, sleep: async () => undefined });

  test('the header the Worker sets and the header the client reads are the same string', () => {
    expect(CLIENT_PROXY_HEADER).toBe(PROXY_HEADER);
  });

  test('plant — the Worker refusing /otp reads as unreachable, never as "a link is on its way"', async () => {
    expect(await ask((await worker().handle(new Request('https://api.openbed.ng/auth/v1/nothing-listed', { method: 'POST' }))))).toMatchObject({ kind: 'unreachable' });
  });

  test("positive control — GoTrue's own 422 and 429, forwarded, still read as answered", async () => {
    for (const status of [200, 422, 429]) {
      expect(await ask(new Response('{}', { status, headers: { [PROXY_HEADER]: 'forwarded' } }))).toEqual({ kind: 'answered', status });
    }
    expect(await ask(new Response('{}', { status: 404 })), 'a 404 with no proxy header is still an answer').toEqual({ kind: 'answered', status: 404 });
  });
});
