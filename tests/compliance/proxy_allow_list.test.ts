import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, test, vi } from 'vitest';
import LIST from '../../supabase-proxy/allow-list.json';
import WRANGLER from '../../supabase-proxy/wrangler.json';
import ORIGINS from '../../packages/origins/origins.json';
import { admits, LIMITER_TIMEOUT_MS, limitKey, makeHandler, NO_ADDRESS_KEY, PROXY_HEADER, STAMP_PATH, VERIFY_LIMITED_TEXT, type AllowList, type ProxyEnv } from '../../supabase-proxy/handler.js';
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
 *   - every link in the two tracked email templates (docs/auth-email-templates/*.html),
 *     the THIRD corpus (R-2026-09-30-177 FA-2 c): the emailed sign-in link lives in an
 *     email, not in code, so no parser over the apps can see it, and since W3 it opens
 *     on api.openbed.ng, so the Worker must forward it;
 *   - minus the calls that never pass through the Worker, each named with its ruling
 *     (`direct_origin_exceptions`): the /beds.json Function's direct read (-58 A5) and the
 *     /api/health Function's direct probe (R-2026-09-29-173 EW-2 a). GET /auth/v1/verify
 *     was the third until W3 (C2, then -55 C option T1); it is forwarded now.
 * An unlisted call, an entry nothing calls, a probe path missing from the list, a
 * preflight for nothing, a query the code does not send, and a stamp path that could
 * collide with a forwarded one each turn this red.
 *
 * THE SERVICES THE WORKER MAY REACH (R-2026-09-30-177 FA-1 a): Auth's four paths
 * (otp, token, verify, settings) and PostgREST's rpc, and nothing else. Realtime,
 * Storage, Functions, GraphQL, pg-meta, Auth's admin API and PostgREST outside rpc are
 * reachable through api.openbed.ng by no entry, and a forward entry under any of them
 * turns this red (SERVICE), whoever adds it and whatever the reason says.
 *
 * GUARD CLASS (Clause 5): every rule here is LIVE. The calls, the probes, the two
 * templates and the entries they are held against all exist at this commit.
 *
 * WHAT A TOO-NARROW LIST BREAKS, so the reds below have their cost attached:
 * without /auth/v1/otp the ward's link request fails (and, but for the request.ts leg
 * below, silently: the Worker's 404 would read as GoTrue's answer); without the token
 * entry sessions end early; without either RPC the ward cannot load or publish.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - that the mail a ward receives carries the template pasted into the dashboard. The
 *     dashboard's template is a hosted setting; the founder pastes the tracked file and
 *     the sign-in link read-back (scripts/readback_signin_link.mjs) reads one real
 *     link. Assertable only through a Supabase management credential, declined on
 *     credential-surface grounds, verified as a runbook step instead.
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

// ---------------------------------------------------------------------------
// The third corpus: the two tracked email templates (R-2026-09-30-177 FA-2 c).
// ---------------------------------------------------------------------------

const TEMPLATE_DIR = 'docs/auth-email-templates';
/** The declared corpus, with the `type` each file's link must carry. */
const TEMPLATE_TYPES: Readonly<Record<string, string>> = {
  [`${TEMPLATE_DIR}/magic-link.html`]: 'magiclink',
  [`${TEMPLATE_DIR}/confirm-signup.html`]: 'signup',
};
const ANY_ACTION = /\{\{[^}]*\}\}/g;
/**
 * THE HOST A TEMPLATE'S LINK MUST BE ON IS THE TRACKED API ORIGIN, read from
 * packages/origins/origins.json (`api.production`), never retyped here: the behavioural pass
 * over this guard (Standard P) found it had the host as a literal, a second copy of a fact
 * the repository already records, which could drift from it with both staying green.
 */
const API_HOST = new URL((ORIGINS as { api: { production: string } }).api.production).host;

export interface TemplateSite {
  readonly file: string;
  readonly method: 'GET';
  readonly path: string;
}

/**
 * The links in the email templates, read as sites the Worker must forward, and every
 * rule about the templates themselves. `sites` is NEVER merged into the code-derived
 * list: a template link carries a query, which the QUERY rule would read as a call
 * the code makes with a query the entry does not pin.
 *
 * The corpus rule flags a file that is not declared, and a declared file missing from a
 * non-empty corpus; an EMPTY corpus is not flagged here, so a plant can empty it, and
 * 'the template corpus is the declared one' below holds the real directory to the two
 * declared files by identity.
 */
export function templateSites(templates: Record<string, string>, apiHost: string = API_HOST): { sites: TemplateSite[]; violations: string[] } {
  const sites: TemplateSite[] = [];
  const violations: string[] = [];
  const declared = Object.keys(TEMPLATE_TYPES);
  for (const file of Object.keys(templates)) {
    if (!declared.includes(file)) violations.push(`TEMPLATE CORPUS: ${file} is not a declared template (${TEMPLATE_DIR} holds exactly ${declared.map((d) => d.slice(TEMPLATE_DIR.length + 1)).join(' and ')})`);
  }
  if (Object.keys(templates).length > 0) {
    for (const d of declared) if (!(d in templates)) violations.push(`TEMPLATE CORPUS: ${d} is declared and missing`);
  }
  for (const [file, text] of Object.entries(templates)) {
    const type = TEMPLATE_TYPES[file];
    if (type === undefined) continue;
    const stripped = text.replace(/<!--[\s\S]*?-->/g, '');
    const total = (stripped.match(ANY_ACTION) ?? []).length;
    if ((text.match(ANY_ACTION) ?? []).length > total) {
      violations.push(`TEMPLATE ACTIONS: ${file} holds a template action inside a comment, and the dashboard expands one wherever it is pasted`);
    }
    // Every `<a` tag and every `href` attribute, however it is quoted (FB-3 a): counting only the double-quoted
    // form let a second link in single quotes, or with no quotes, or with no href at all, through. `<a[\s>]` does
    // not match `<abbr>`.
    const tags = (stripped.match(/<a[\s>]/gi) ?? []).length;
    const hrefs = [...stripped.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
    if (tags !== 1 || hrefs.length !== 1) violations.push(`TEMPLATE LINKS: ${file} holds ${Math.max(tags, hrefs.length)} links, and exactly one is allowed`);
    const href = hrefs[0];
    if (href === undefined) continue;
    const inLink = (href.match(ANY_ACTION) ?? []).length;
    if (total !== 2 || inLink !== 2) {
      violations.push(`TEMPLATE ACTIONS: ${file} holds ${total} template actions (${inLink} inside its link); exactly two, both inside the one link, are allowed`);
    }
    const normalised = href.replace(ANY_ACTION, (m) => `{{${m.slice(2, -2).trim()}}}`);
    const q = normalised.indexOf('?');
    const base = q < 0 ? normalised : normalised.slice(0, q);
    const query = q < 0 ? '' : normalised.slice(q + 1);
    let url: URL | null = null;
    try {
      url = new URL(base);
    } catch {
      url = null;
    }
    if (url === null || url.protocol !== 'https:' || url.host !== apiHost) {
      violations.push(`TEMPLATE LINKS: ${file}'s link is not on https://${apiHost} (read ${url === null ? 'something that is not an absolute URL' : url.origin})`);
    }
    const got = query.split('&').filter((x) => x !== '').sort();
    const want = ['redirect_to={{.RedirectTo}}', 'token={{.TokenHash}}', `type=${type}`].sort();
    if (got.join('&') !== want.join('&')) {
      violations.push(`TEMPLATE PARAMS: ${file} link carries [${got.join(' & ')}], expected exactly [${want.join(' & ')}]`);
    }
    if (url !== null) sites.push({ file, method: 'GET', path: url.pathname });
  }
  return { sites, violations };
}

/** The directories' services the Worker may reach: Auth's four paths, and PostgREST's rpc. */
const SERVICE_PATHS = ['/auth/v1/otp', '/auth/v1/token', '/auth/v1/verify', '/auth/v1/settings'];

export function serviceViolations(list: AllowList): string[] {
  if (list.forward.length === 0) return ['SERVICE: the forward list is empty, so nothing was checked'];
  const out: string[] = [];
  for (const e of list.forward) {
    const ok = SERVICE_PATHS.includes(e.path) || (e.path.startsWith('/rest/v1/rpc/') && !e.path.includes('..') && !e.path.includes('//'));
    if (!ok) out.push(`SERVICE: ${e.method} ${e.path} is outside the services the Worker may reach (Auth's otp, token, verify, settings; PostgREST's rpc)`);
  }
  return out;
}

const SUPABASE_SERVICE_PREFIXES = ['/auth/v1', '/rest/v1', '/storage/v1', '/realtime/v1', '/functions/v1', '/graphql/v1', '/pg'];

/** Everything wrong between the list, the code and the runbooks. Empty means they agree. */
export function coverageViolations(
  list: typeof LIST_TYPED,
  derived: { sites: CallSite[]; unresolved: string[] },
  probes: Probe[],
  stampPath: string = STAMP_PATH,
  templateLinks: TemplateSite[] = [],
): string[] {
  const out = [...serviceViolations(list), ...derived.unresolved];
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
    if (
      !derived.sites.some((s) => s.method === entry.method && s.path === entry.path) &&
      !templateLinks.some((t) => t.method === entry.method && t.path === entry.path) &&
      !/^runbook probe: /.test(entry.reason ?? '')
    ) {
      out.push(`PROBE WITHOUT REASON: ${key(entry.method, entry.path)} is listed only for a probe, and its reason does not say so`);
    }
  }

  // A template link is a call the code cannot show: it must land on a GET entry, and it uses that entry.
  for (const t of templateLinks) {
    const entry = list.forward.find((e) => e.method === t.method && e.path === t.path);
    if (entry === undefined) {
      out.push(`TEMPLATE PATH: ${t.file} links ${t.path}, which is not a GET entry in forward, so every link in the mail would be refused`);
    } else {
      used.add(key(entry.method, entry.path));
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

  // C2: the sign-in link's own path must be decided, forwarded or named direct -- and not both.
  const verifyForwarded = list.forward.some((e) => e.method === 'GET' && e.path === '/auth/v1/verify');
  const verifyDirect = list.direct_origin_exceptions.some((d) => d.method === 'GET' && d.path === '/auth/v1/verify');
  if (!verifyForwarded && !verifyDirect) {
    out.push('VERIFY UNDECIDED: GET /auth/v1/verify, where every emailed sign-in link is consumed, is neither forwarded nor named as a direct-origin exception');
  }
  if (verifyForwarded && verifyDirect) {
    out.push('VERIFY IN BOTH: GET /auth/v1/verify is forwarded and also named a direct-origin exception, and the two cannot both be where the link is consumed');
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

/** The declared template corpus: every file in docs/auth-email-templates, keyed by repo path. */
function realTemplates(): Record<string, string> {
  const dir = join(REPO_ROOT, TEMPLATE_DIR);
  if (!existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).map((n) => [`${TEMPLATE_DIR}/${n}`, readFileSync(join(dir, n), 'utf8')]));
}

const check = (
  list = LIST_TYPED,
  extraSources: Record<string, string> = {},
  docs = realDocs(),
  stamp = STAMP_PATH,
  scripts = realScripts(),
  templates = realTemplates(),
): string[] => {
  const fromScripts = scriptProbes(scripts);
  const fromTemplates = templateSites(templates);
  return [
    ...fromScripts.unreadable,
    ...fromTemplates.violations,
    ...coverageViolations(list, callSites({ ...realSources(), ...extraSources }, REPO_ROOT), [...runbookProbes(docs), ...fromScripts.probes], stamp, fromTemplates.sites),
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
        'packages/snapshot/src/health_serve.ts',
        'apps/public-dashboard/functions/api/health.ts',
      ]),
    );
    const { sites, unresolved } = callSites(realSources(), REPO_ROOT);
    expect(unresolved).toEqual([]);
    expect(sites.map((s) => `${s.method} ${s.path}${s.query === null ? '' : `?${s.query}`} @ ${s.file}`).sort()).toEqual([
      'GET /rest/v1/snapshot_current?select=v,payload&order=v.desc&limit=1 @ packages/snapshot/src/serve.ts',
      'POST /auth/v1/otp @ packages/auth/src/request.ts',
      'POST /auth/v1/token?grant_type=refresh_token @ packages/auth/src/holder.ts',
      // R-2026-09-29-173 EW-2 a: the /api/health Function's probe, direct by name like the /beds.json read.
      'POST /rest/v1/rpc/health_probe @ packages/snapshot/src/health_serve.ts',
      'POST /rest/v1/rpc/my_reporting_wards @ apps/ward-console/src/main.ts',
      'POST /rest/v1/rpc/operator_add_category @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/operator_create_facility @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/operator_edit_facility @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/operator_get_contact @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/operator_record_agreement @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/operator_record_contact @ apps/admin/src/main.ts',
      // R-2026-09-27-144 DT Bundle 3: the Registration section's write, until then a runbook probe's alone.
      'POST /rest/v1/rpc/operator_record_registration @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/operator_register @ apps/admin/src/main.ts',
      'POST /rest/v1/rpc/operator_scheduler_status @ apps/admin/src/main.ts',
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
    // only the database. scripts/readback_worker_limits.sh (R-2026-09-30-177 FA-3 i) does
    // send, and is never part of the routine read-back: it spends the caller's own limit.
    expect(Object.keys(realScripts()).sort()).toEqual([
      'scripts/readback_admin.sh',
      'scripts/readback_common.sh',
      'scripts/readback_function_grants.sh',
      'scripts/readback_pages.sh',
      'scripts/readback_public_output.sh',
      'scripts/readback_ward_console.sh',
      'scripts/readback_worker.sh',
      'scripts/readback_worker_limits.sh',
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
      // 5b: the one hosted test of the Upgrade refusal on a LISTED path (FA-1 b).
      'GET /auth/v1/settings @ scripts/readback_worker.sh',
      // 7: the redirect; and the limits proof's loop, run once at W3's hosted step b.
      'GET /auth/v1/verify @ scripts/readback_worker.sh',
      'GET /auth/v1/verify @ scripts/readback_worker_limits.sh',
      // 5 and 6: the services the Worker never reaches.
      'GET /realtime/v1/websocket @ scripts/readback_worker.sh',
      'GET /rest/v1/ @ scripts/readback_worker.sh',
      'GET /storage/v1/object/public/probe @ scripts/readback_worker.sh',
      'HEAD /__openbed/version @ scripts/readback_worker.sh',
      'HEAD /auth/v1/settings @ scripts/readback_worker.sh',
      'POST /rest/v1/rpc/my_reporting_wards @ scripts/readback_worker.sh',
      'POST /rest/v1/rpc/operator_record_registration @ scripts/readback_worker.sh',
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

  test('plant — /auth/v1/verify in neither list is rejected, and nothing else is (C2)', () => {
    // Since W3 verify is FORWARDED, so the old plant (remove it from the exceptions) plants
    // nothing: it was never there. Remove it from `forward`, and take away everything else
    // that would also fire -- the template corpus and the two scripts that send it -- so the
    // result is exactly the one message this rule owns.
    const planted = { ...LIST_TYPED, forward: LIST_TYPED.forward.filter((e) => !(e.method === 'GET' && e.path === '/auth/v1/verify')) };
    expect(planted.forward.length, 'the plant did not remove the verify entry').toBe(LIST_TYPED.forward.length - 1);
    const worker = realScripts()['scripts/readback_worker.sh'] ?? '';
    const noProbe7 = worker.replace(/^api_probe GET \/auth\/v1\/verify .*$/m, '# probe 7 removed');
    expect(noProbe7, 'the plant did not remove probe 7').not.toBe(worker);
    const { 'scripts/readback_worker_limits.sh': limits, ...rest } = realScripts();
    expect(limits, 'the limits script was not in the corpus to remove').toBeDefined();
    const v = check(planted, {}, realDocs(), STAMP_PATH, { ...rest, 'scripts/readback_worker.sh': noProbe7 }, {});
    expect(v).toEqual(['VERIFY UNDECIDED: GET /auth/v1/verify, where every emailed sign-in link is consumed, is neither forwarded nor named as a direct-origin exception']);
  });

  test('plant — /auth/v1/verify both forwarded and a direct-origin exception is rejected', () => {
    const planted = {
      ...LIST_TYPED,
      direct_origin_exceptions: [...LIST_TYPED.direct_origin_exceptions, { method: 'GET', path: '/auth/v1/verify', file: null, reason: 'planted' }],
    };
    expect(check(planted)).toEqual(['VERIFY IN BOTH: GET /auth/v1/verify is forwarded and also named a direct-origin exception, and the two cannot both be where the link is consumed']);
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
// The services the Worker may reach (R-2026-09-30-177 FA-1 a).
// ---------------------------------------------------------------------------

describe('the services the Worker may reach are Auth four paths and PostgREST rpc, nothing else', () => {
  const withEntry = (e: { method: string; path: string }) => ({ ...LIST_TYPED, forward: [...LIST_TYPED.forward, { ...e, reason: 'planted' }] });

  test('real allow-list is accepted — every forward entry is on a permitted service', () => {
    expect(serviceViolations(LIST_TYPED)).toEqual([]);
  });

  test.each([
    ['GET', '/realtime/v1/websocket'],
    ['POST', '/storage/v1/object/planted'],
    ['POST', '/functions/v1/planted'],
    ['POST', '/graphql/v1'],
    ['GET', '/pg/tables'],
    ['POST', '/auth/v1/admin/users'],
    ['GET', '/rest/v1/facility'],
    ['OPTIONS', '/storage/v1/object'],
  ])('plant — a forward entry %s %s is rejected, by its own message', (method, path) => {
    const planted = withEntry({ method, path });
    expect(planted.forward.length, 'the plant did not add an entry').toBe(LIST_TYPED.forward.length + 1);
    expect(check(planted)).toContain(`SERVICE: ${method} ${path} is outside the services the Worker may reach (Auth's otp, token, verify, settings; PostgREST's rpc)`);
  });

  test('plant — an rpc path that climbs out of rpc is rejected', () => {
    expect(serviceViolations(withEntry({ method: 'POST', path: '/rest/v1/rpc/../facility' }))).toHaveLength(1);
  });

  test('anti-vacuity — an empty forward list is not a list that passed', () => {
    expect(serviceViolations({ forward: [] })).toEqual(['SERVICE: the forward list is empty, so nothing was checked']);
  });
});

// ---------------------------------------------------------------------------
// The third corpus: the email templates (R-2026-09-30-177 FA-2 c).
// ---------------------------------------------------------------------------

describe('the email templates are the third corpus the Worker is held against', () => {
  const MAGIC = `${TEMPLATE_DIR}/magic-link.html`;
  const SIGNUP = `${TEMPLATE_DIR}/confirm-signup.html`;
  const real = (): Record<string, string> => realTemplates();
  const body = (x: string): string => x.replace(/<!--[\s\S]*?-->/g, '');
  // A first-occurrence replace lands in the header comment, which quotes the default body: so a plant
  // names whether it means the BODY (the default) or the comment, and the precondition checks it landed there.
  const planted = (file: string, from: string | RegExp, to: string, where: 'body' | 'comment' = 'body'): Record<string, string> => {
    const t = real();
    const before = t[file] ?? '';
    const after = before.replace(from, to);
    expect(after, `the plant did not change ${file}`).not.toBe(before);
    if (where === 'body') expect(body(after), `the plant landed in the header comment, not the body of ${file}`).not.toBe(body(before));
    return { ...t, [file]: after };
  };
  const LINK = /<a href="https:\/\/api\.openbed\.ng[^"]*"/;
  const link = (href: string): string => `<a href="${href}"`;
  const OK_MAGIC = 'https://api.openbed.ng/auth/v1/verify?token={{ .TokenHash }}&type=magiclink&redirect_to={{ .RedirectTo }}';

  test('the template corpus is the declared one — exactly the two files, by identity', () => {
    expect(Object.keys(real()).sort()).toEqual([SIGNUP, MAGIC]);
    expect(templateSites(real()).sites.map((x) => `${x.method} ${x.path} @ ${x.file}`).sort()).toEqual([
      `GET /auth/v1/verify @ ${SIGNUP}`,
      `GET /auth/v1/verify @ ${MAGIC}`,
    ]);
  });

  test('real templates are accepted — every rule over the two real files reads clean', () => {
    expect(templateSites(real()).violations).toEqual([]);
    expect(check()).toEqual([]);
  });

  test("the host a link must be on is read from packages/origins/origins.json, and a different tracked origin rejects both real templates", () => {
    expect(API_HOST, 'origins.json names no api host').toBe('api.openbed.ng');
    const v = templateSites(real(), 'api.elsewhere.example').violations;
    expect(v).toEqual([
      `TEMPLATE LINKS: ${SIGNUP}'s link is not on https://api.elsewhere.example (read https://api.openbed.ng)`,
      `TEMPLATE LINKS: ${MAGIC}'s link is not on https://api.elsewhere.example (read https://api.openbed.ng)`,
    ]);
  });

  test('plant — the templates removed leaves verify with no reason, and the entry is refused (FA-2 c)', () => {
    // The predicted red, before the templates existed: PROBE WITHOUT REASON for verify.
    const withoutReason = { ...LIST_TYPED, forward: LIST_TYPED.forward.map((e) => (e.path === '/auth/v1/verify' ? { ...e, reason: 'the emailed sign-in link' } : e)) };
    expect(check(withoutReason, {}, realDocs(), STAMP_PATH, realScripts(), {})).toContain('PROBE WITHOUT REASON: GET /auth/v1/verify is listed only for a probe, and its reason does not say so');
    // With the templates present the same reason is accepted: the template link is the call.
    expect(check(withoutReason)).toEqual([]);
  });

  test('plant — verify removed from forward while a template links to it is rejected', () => {
    const noVerify = { ...LIST_TYPED, forward: LIST_TYPED.forward.filter((e) => !(e.method === 'GET' && e.path === '/auth/v1/verify')) };
    const v = check(noVerify);
    expect(v).toContain(`TEMPLATE PATH: ${MAGIC} links /auth/v1/verify, which is not a GET entry in forward, so every link in the mail would be refused`);
    expect(v).toContain(`TEMPLATE PATH: ${SIGNUP} links /auth/v1/verify, which is not a GET entry in forward, so every link in the mail would be refused`);
  });

  test.each([
    ['the confirmation-URL variable', '{{ .ConfirmationURL }}', 'is not on https://api.openbed.ng (read something that is not an absolute URL)'],
    ['the Supabase host', 'https://klrlpxysjsjpdkeqdhvl.supabase.co/auth/v1/verify?token={{ .TokenHash }}&type=magiclink&redirect_to={{ .RedirectTo }}', 'is not on https://api.openbed.ng (read https://klrlpxysjsjpdkeqdhvl.supabase.co)'],
    ['the site-URL variable', '{{ .SiteURL }}/auth/v1/verify?token={{ .TokenHash }}&type=magiclink&redirect_to={{ .RedirectTo }}', 'is not on https://api.openbed.ng (read something that is not an absolute URL)'],
    ['plain http', OK_MAGIC.replace('https://', 'http://'), 'is not on https://api.openbed.ng (read http://api.openbed.ng)'],
    ['a lookalike host', OK_MAGIC.replace('api.openbed.ng', 'api.openbed.ng.example.com'), 'is not on https://api.openbed.ng (read https://api.openbed.ng.example.com)'],
  ])('plant — an href of %s is rejected by the link rule', (_label, href, tail) => {
    const v = templateSites(planted(MAGIC, LINK, link(href))).violations;
    expect(v.some((x) => x.startsWith(`TEMPLATE LINKS: ${MAGIC}'s link ${tail}`)), v.join('\n')).toBe(true);
  });

  test.each([
    ['token_hash=', OK_MAGIC.replace('token=', 'token_hash='), 'token_hash={{.TokenHash}}'],
    ['the plain six-digit token variable', OK_MAGIC.replace('{{ .TokenHash }}', '{{ .Token }}'), 'token={{.Token}}'],
    ['a fourth parameter', `${OK_MAGIC}&extra=1`, 'extra=1'],
    ['no redirect_to', 'https://api.openbed.ng/auth/v1/verify?token={{ .TokenHash }}&type=magiclink', 'token={{.TokenHash}} & type=magiclink'],
  ])('plant — a link with %s is rejected by the parameter rule', (_label, href, fragment) => {
    const v = templateSites(planted(MAGIC, LINK, link(href))).violations;
    expect(v.some((x) => x.startsWith(`TEMPLATE PARAMS: ${MAGIC} link carries [`) && x.includes(fragment)), v.join('\n')).toBe(true);
  });

  test('plant — the wrong type for each file is rejected', () => {
    expect(templateSites(planted(MAGIC, '&type=magiclink', '&type=signup')).violations).toContain(
      `TEMPLATE PARAMS: ${MAGIC} link carries [redirect_to={{.RedirectTo}} & token={{.TokenHash}} & type=signup], expected exactly [redirect_to={{.RedirectTo}} & token={{.TokenHash}} & type=magiclink]`,
    );
    expect(templateSites(planted(SIGNUP, '&type=signup', '&type=magiclink')).violations).toContain(
      `TEMPLATE PARAMS: ${SIGNUP} link carries [redirect_to={{.RedirectTo}} & token={{.TokenHash}} & type=magiclink], expected exactly [redirect_to={{.RedirectTo}} & token={{.TokenHash}} & type=signup]`,
    );
  });

  test('plant — a second link is rejected', () => {
    expect(templateSites(planted(MAGIC, /(<a href="https:\/\/api\.openbed\.ng[^\n]*<\/a><\/p>\n)/, '$1<p><a href="https://api.openbed.ng/auth/v1/verify">again</a></p>\n')).violations).toContain(`TEMPLATE LINKS: ${MAGIC} holds 2 links, and exactly one is allowed`);
  });

  test.each([
    ['in single quotes', `<p><a href='https://api.openbed.ng/auth/v1/verify'>again</a></p>\n`],
    ['with no quotes', `<p><a href=https://api.openbed.ng/auth/v1/verify>again</a></p>\n`],
    ['with no href at all', `<p><a name="again">again</a></p>\n`],
  ])('plant — a second link %s is rejected (FB-3 a)', (_label, extra) => {
    const t = planted(MAGIC, /(<a href="https:\/\/api\.openbed\.ng[^\n]*<\/a><\/p>\n)/, `$1${extra}`);
    expect(templateSites(t).violations).toContain(`TEMPLATE LINKS: ${MAGIC} holds 2 links, and exactly one is allowed`);
  });

  // FC-2: every plant above also adds a second `<a`, so the TAG count alone catches each. These have exactly ONE `<a` and a
  // second href on another element, so only the HREF count can; and a bare second `<a>` that the tag regex must still see.
  test.each([
    ['an <area> with a single-quoted href on another host', `<p><area href='https://evil.example/x'></p>\n`],
    ['a <link> with an unquoted href on another host', `<p><link href=https://evil.example/x></p>\n`],
    ['a bare second <a> with no attributes', `<p><a>again</a></p>\n`],
  ])('plant — %s is rejected by the link count (FC-2)', (_label, extra) => {
    const t = planted(MAGIC, /(<a href="https:\/\/api\.openbed\.ng[^\n]*<\/a><\/p>\n)/, `$1${extra}`);
    expect(templateSites(t).violations).toContain(`TEMPLATE LINKS: ${MAGIC} holds 2 links, and exactly one is allowed`);
  });

  test('positive control — an `<abbr>` tag is not a link', () => {
    const t = planted(MAGIC, /(<a href="https:\/\/api\.openbed\.ng[^\n]*<\/a><\/p>\n)/, '$1<p><abbr title="x">y</abbr></p>\n');
    expect(templateSites(t).violations).toEqual([]);
  });

  test('plant — a third template action is rejected, and so is one in the header comment', () => {
    expect(templateSites(planted(MAGIC, /&redirect_to=\{\{ \.RedirectTo \}\}">Sign in</, '&redirect_to={{ .RedirectTo }}">Sign in {{ .Email }}<')).violations).toContain(
      `TEMPLATE ACTIONS: ${MAGIC} holds 3 template actions (2 inside its link); exactly two, both inside the one link, are allowed`,
    );
    expect(templateSites(planted(MAGIC, 'WHAT THIS FILE IS.', 'WHAT THIS FILE IS {{ .ConfirmationURL }}.', 'comment')).violations).toContain(
      `TEMPLATE ACTIONS: ${MAGIC} holds a template action inside a comment, and the dashboard expands one wherever it is pasted`,
    );
  });

  test('plant — a template linking to an api path that is not forwarded is rejected', () => {
    const t = planted(MAGIC, 'https://api.openbed.ng/auth/v1/verify?', 'https://api.openbed.ng/auth/v1/admin/users?');
    const v = check(LIST_TYPED, {}, realDocs(), STAMP_PATH, realScripts(), t);
    expect(v).toContain(`TEMPLATE PATH: ${MAGIC} links /auth/v1/admin/users, which is not a GET entry in forward, so every link in the mail would be refused`);
  });

  test('plant — a third file in the directory is rejected', () => {
    const v = templateSites({ ...real(), [`${TEMPLATE_DIR}/third.html`]: '<p>x</p>' }).violations;
    expect(v).toContain(`TEMPLATE CORPUS: ${TEMPLATE_DIR}/third.html is not a declared template (${TEMPLATE_DIR} holds exactly magic-link.html and confirm-signup.html)`);
  });

  test('plant — one declared file missing from a non-empty corpus is rejected', () => {
    const { [SIGNUP]: _gone, ...onlyMagic } = real();
    expect(_gone, 'the plant had nothing to remove').toBeDefined();
    expect(templateSites(onlyMagic).violations).toEqual([`TEMPLATE CORPUS: ${SIGNUP} is declared and missing`]);
  });

  test('anti-vacuity — an empty directory reads as no sites, and the corpus identity test above is what fails it', () => {
    expect(templateSites({}).sites).toEqual([]);
    expect(Object.keys(real()).length, 'the real template directory is empty, so every template rule checked nothing').toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The Worker's decision, called as the Worker calls it.
// ---------------------------------------------------------------------------

const ORIGIN = 'https://example-ref.supabase.co';
const STAMP = { commit: 'a'.repeat(40), dirty: false, built_at: '2026-09-23T00:00:00.000Z' };

/** The limits Cloudflare enforces, from the ONE place that holds them: wrangler.json (FA-3 b). Never a literal here. */
const LIMITS: Readonly<Record<string, number>> = Object.fromEntries(
  (WRANGLER as unknown as { ratelimits: { name: string; simple: { limit: number } }[] }).ratelimits.map((b) => [b.name, b.simple.limit]),
);

/**
 * A fake of Workers Rate Limiting: counts per (binding, key) and says no past the limit
 * wrangler.json declares for that binding. It has no clock: every call is in one window.
 * `calls` records every key each binding was asked about, so a test can say a request was
 * NOT counted, which a verdict alone cannot.
 */
function fakeLimits(names: string[] = Object.keys(LIMITS)): { env: ProxyEnv; calls: Record<string, string[]> } {
  const calls: Record<string, string[]> = {};
  const env: Record<string, unknown> = {};
  for (const name of names) {
    const seen = new Map<string, number>();
    calls[name] = [];
    env[name] = {
      limit: async ({ key }: { key: string }) => {
        calls[name]?.push(key);
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        return { success: n <= (LIMITS[name] ?? 0) };
      },
    };
  }
  return { env, calls };
}

function worker(env?: ProxyEnv): { handle: (r: Request) => Promise<Response>; upstream: ReturnType<typeof vi.fn> } {
  const upstream = vi.fn(async (r: Request) => new Response(JSON.stringify({ seen: r.url, host: r.headers.get('host') }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const handle = makeHandler({ origin: ORIGIN, list: LIST_TYPED, stamp: STAMP, fetchImpl: upstream });
  return { handle: (r: Request) => handle(r, env), upstream };
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
    // W3: the stamp is the deploy stamp plus which rate-limit bindings this deployment holds.
    expect(await get.json()).toEqual({ ...STAMP, limits_bound: { otp: false, verify: false, refresh: false } });
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

describe('the Worker refuses an upgrade, and counts and limits per client (R-2026-09-30-177 FA-1 b, FA-3)', () => {
  const IP = 'cf-connecting-ip';
  const get = (path: string, headers: Record<string, string> = {}, method = 'GET') => new Request(`https://api.openbed.ng${path}`, { method, headers });
  const VERIFY = '/auth/v1/verify?token=t&type=magiclink&redirect_to=https%3A%2F%2Fadmin.openbed.ng%2F';
  const REFRESH = '/auth/v1/token?grant_type=refresh_token';
  /** Each limited arm: [label, method, path, the binding that counts it]. */
  const ARMS: [string, string, string, string][] = [
    ['GET verify', 'GET', VERIFY, 'LIMIT_VERIFY'],
    ['HEAD verify', 'HEAD', VERIFY, 'LIMIT_VERIFY'],
    ['POST otp', 'POST', '/auth/v1/otp', 'LIMIT_OTP'],
    ['POST refresh', 'POST', REFRESH, 'LIMIT_REFRESH'],
  ];
  const send = (h: (r: Request) => Promise<Response>, method: string, path: string, headers: Record<string, string> = {}) =>
    h(new Request(`https://api.openbed.ng${path}`, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) }));

  test('plant — an Upgrade header on a LISTED GET is refused here, and the origin is never called', async () => {
    const { handle, upstream } = worker();
    const res = await handle(get('/auth/v1/settings', { upgrade: 'websocket', connection: 'Upgrade', apikey: 'k' }));
    expect(res.status).toBe(404);
    expect(res.headers.get(PROXY_HEADER)).toBe('refused');
    expect(await res.text()).toBe('{"message":"not forwarded by the OpenBed proxy"}');
    expect(upstream, 'an upgrade request reached the origin').not.toHaveBeenCalled();
  });

  test.each([
    ['Upgrade: h2c on GET /auth/v1/settings', 'GET', '/auth/v1/settings', { upgrade: 'h2c', connection: 'Upgrade, HTTP2-Settings', apikey: 'k' }],
    ['an Upgrade on HEAD /auth/v1/verify', 'HEAD', '/auth/v1/verify?token=t&type=magiclink&redirect_to=https%3A%2F%2Fadmin.openbed.ng%2F', { upgrade: 'websocket' }],
    ['a mixed-case UPGRADE header on GET /auth/v1/settings', 'GET', '/auth/v1/settings', { UpGrAdE: 'websocket', apikey: 'k' }],
  ])('plant — %s is refused here, and the origin is never called (FB-3 c)', async (_label, method, path, headers) => {
    const { handle, upstream } = worker(fakeLimits().env);
    const res = await handle(new Request(`https://api.openbed.ng${path}`, { method, headers }));
    expect(res.status).toBe(404);
    expect(res.headers.get(PROXY_HEADER)).toBe('refused');
    expect(upstream, 'an upgrade request reached the origin').not.toHaveBeenCalled();
  });

  test('positive control — the same request without Upgrade is forwarded', async () => {
    const { handle, upstream } = worker();
    const res = await handle(get('/auth/v1/settings', { apikey: 'k' }));
    expect(res.headers.get(PROXY_HEADER)).toBe('forwarded');
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  test('plant — an Upgrade header on a verify link is refused too, whatever the path', async () => {
    const { handle, upstream } = worker(fakeLimits().env);
    expect((await handle(get(VERIFY, { upgrade: 'websocket' }))).headers.get(PROXY_HEADER)).toBe('refused');
    expect(upstream).not.toHaveBeenCalled();
  });

  test.each(ARMS)('%s: the limit-th is forwarded, the (limit+1)th is limited, and the origin saw exactly limit', async (_label, method, path, binding) => {
    const limit = LIMITS[binding] ?? 0;
    expect(limit, `wrangler.json holds no limit for ${binding}`).toBeGreaterThan(0);
    const { env } = fakeLimits();
    const { handle, upstream } = worker(env);
    for (let i = 1; i <= limit; i++) {
      const res = await send(handle, method, path, { [IP]: '198.51.100.7' });
      expect(res.headers.get(PROXY_HEADER), `request ${i} of ${limit}`).toBe('forwarded');
    }
    const over = await send(handle, method, path, { [IP]: '198.51.100.7' });
    expect(over.status).toBe(429);
    expect(over.headers.get(PROXY_HEADER)).toBe('limited');
    expect(upstream, 'a limited request reached the origin, or the limit-th did not').toHaveBeenCalledTimes(limit);
  });

  test('each limited answer is exactly: status, headers and body, with the origin not called', async () => {
    const { env } = fakeLimits();
    for (const [label, method, path, binding] of ARMS) {
      const { handle, upstream } = worker(env);
      // A fresh key per arm: the fake env is shared, so counts must not carry over.
      const key = `203.0.113.${label.length}${method.length}`;
      for (let i = 0; i < (LIMITS[binding] ?? 0); i++) await send(handle, method, path, { [IP]: key });
      const calls = upstream.mock.calls.length;
      const res = await send(handle, method, path, { [IP]: key });
      expect(upstream.mock.calls.length, `${label}: the origin was called for a limited request`).toBe(calls);
      expect(res.status, label).toBe(429);
      expect(res.headers.get(PROXY_HEADER), label).toBe('limited');
      expect(res.headers.get('retry-after'), label).toBe('60');
      expect(res.headers.get('cache-control'), label).toBe('no-store');
      expect(res.headers.get('access-control-allow-origin'), label).toBe('*');
      expect(res.headers.get('access-control-expose-headers'), label).toBe(PROXY_HEADER);
      if (path.startsWith('/auth/v1/verify')) {
        expect(res.headers.get('content-type'), label).toBe('text/plain; charset=utf-8');
        expect(await res.text(), label).toBe(method === 'HEAD' ? '' : VERIFY_LIMITED_TEXT);
      } else {
        expect(res.headers.get('content-type'), label).toBe('application/json');
        expect(await res.text(), label).toBe('{"message":"rate limited by the OpenBed proxy"}');
      }
    }
  });

  test('two keys each get their own count', async () => {
    const { env } = fakeLimits();
    const { handle } = worker(env);
    const limit = LIMITS['LIMIT_OTP'] ?? 0;
    for (let i = 0; i < limit; i++) await send(handle, 'POST', '/auth/v1/otp', { [IP]: '198.51.100.1' });
    expect((await send(handle, 'POST', '/auth/v1/otp', { [IP]: '198.51.100.1' })).status).toBe(429);
    expect((await send(handle, 'POST', '/auth/v1/otp', { [IP]: '198.51.100.2' })).headers.get(PROXY_HEADER), 'a second address was limited by the first').toBe('forwarded');
  });

  test('IPv6: two addresses in one /64 share a count, and two in different /64s do not — compressed forms, so a naive split cannot pass', async () => {
    expect(limitKey('2001:db8::1')).toBe(limitKey('2001:db8::ffff:1'));
    expect(limitKey('2001:db8::1')).not.toBe(limitKey('2001:db8:0:1::1'));
    expect(limitKey('2001:0db8:0000:0000:0000:0000:0000:0001'), 'the expanded form must equal the compressed one').toBe(limitKey('2001:db8::1'));
    expect(limitKey('not an address:::')).toBe('not an address:::');
    const { env } = fakeLimits();
    const { handle } = worker(env);
    const limit = LIMITS['LIMIT_OTP'] ?? 0;
    for (let i = 0; i < limit; i++) await send(handle, 'POST', '/auth/v1/otp', { [IP]: '2001:db8::1' });
    expect((await send(handle, 'POST', '/auth/v1/otp', { [IP]: '2001:db8::ffff:1' })).status, 'one /64 did not share a count').toBe(429);
    expect((await send(handle, 'POST', '/auth/v1/otp', { [IP]: '2001:db8:0:1::1' })).headers.get(PROXY_HEADER), 'a different /64 shared the count').toBe('forwarded');
  });

  test('IPv4-MAPPED addresses are keyed on the embedded IPv4 address, exactly as the plain dotted address is (FB-3 g)', async () => {
    // Documentation-range addresses only. Before FB every mapped address collapsed into ONE /64 key.
    expect(limitKey('::ffff:192.0.2.1')).toBe(limitKey('192.0.2.1'));
    expect(limitKey('::ffff:c000:201'), 'the hex form').toBe(limitKey('192.0.2.1'));
    expect(limitKey('::ffff:198.51.100.7')).not.toBe(limitKey('::ffff:203.0.113.9'));
    const { env } = fakeLimits();
    const { handle } = worker(env);
    const limit = LIMITS['LIMIT_OTP'] ?? 0;
    for (let i = 0; i < limit; i++) await send(handle, 'POST', '/auth/v1/otp', { [IP]: '::ffff:192.0.2.1' });
    expect((await send(handle, 'POST', '/auth/v1/otp', { [IP]: '192.0.2.1' })).status, 'a mapped address did not share with its plain dotted form').toBe(429);
    expect((await send(handle, 'POST', '/auth/v1/otp', { [IP]: '::ffff:198.51.100.7' })).headers.get(PROXY_HEADER), 'two different mapped addresses shared a count').toBe('forwarded');
    expect((await send(handle, 'POST', '/auth/v1/otp', { [IP]: '::ffff:203.0.113.9' })).headers.get(PROXY_HEADER), 'two different mapped addresses shared a count').toBe('forwarded');
  });

  test('an absent cf-connecting-ip with x-forwarded-for present still uses the constant key — a client cannot choose its key by omission (H8)', async () => {
    const { env, calls } = fakeLimits();
    const { handle } = worker(env);
    const limit = LIMITS['LIMIT_OTP'] ?? 0;
    for (let i = 0; i < limit; i++) await send(handle, 'POST', '/auth/v1/otp', { 'x-forwarded-for': `198.51.100.${i + 1}` });
    expect((await send(handle, 'POST', '/auth/v1/otp', { 'x-forwarded-for': '203.0.113.250' })).status).toBe(429);
    expect(new Set(calls['LIMIT_OTP'])).toEqual(new Set([NO_ADDRESS_KEY]));
  });

  test('the same cf-connecting-ip with different x-forwarded-for shares a count — a client cannot choose its key', async () => {
    const { env } = fakeLimits();
    const { handle } = worker(env);
    const limit = LIMITS['LIMIT_OTP'] ?? 0;
    for (let i = 0; i < limit; i++) await send(handle, 'POST', '/auth/v1/otp', { [IP]: '198.51.100.9', 'x-forwarded-for': `203.0.113.${i + 1}` });
    expect((await send(handle, 'POST', '/auth/v1/otp', { [IP]: '198.51.100.9', 'x-forwarded-for': '203.0.113.99' })).status).toBe(429);
  });

  test('the three limiters are separate: otp traffic does not limit refresh or verify', async () => {
    const { env } = fakeLimits();
    const { handle } = worker(env);
    for (let i = 0; i < (LIMITS['LIMIT_OTP'] ?? 0) + 3; i++) await send(handle, 'POST', '/auth/v1/otp', { [IP]: '198.51.100.5' });
    expect((await send(handle, 'POST', REFRESH, { [IP]: '198.51.100.5' })).headers.get(PROXY_HEADER)).toBe('forwarded');
    expect((await send(handle, 'GET', VERIFY, { [IP]: '198.51.100.5' })).headers.get(PROXY_HEADER)).toBe('forwarded');
  });

  test('never limited: OPTIONS otp, GET settings, a listed rpc and the stamp — and nothing was counted for them', async () => {
    const { env, calls } = fakeLimits();
    const { handle } = worker(env);
    const n = Math.max(...Object.values(LIMITS)) + 5;
    for (let i = 0; i < n; i++) {
      expect((await send(handle, 'OPTIONS', '/auth/v1/otp', { [IP]: '198.51.100.6' })).headers.get(PROXY_HEADER)).toBe('forwarded');
      expect((await send(handle, 'GET', '/auth/v1/settings', { [IP]: '198.51.100.6' })).headers.get(PROXY_HEADER)).toBe('forwarded');
      expect((await send(handle, 'POST', '/rest/v1/rpc/publish_ward_status', { [IP]: '198.51.100.6' })).headers.get(PROXY_HEADER)).toBe('forwarded');
      expect((await send(handle, 'GET', STAMP_PATH, { [IP]: '198.51.100.6' })).headers.get(PROXY_HEADER)).toBe('stamp');
    }
    expect(Object.values(calls).flat(), 'a request with no limit was counted').toEqual([]);
  });

  test('a refused path and an Upgrade request consume no count, and a refused request is never limited either', async () => {
    const { env, calls } = fakeLimits();
    const { handle, upstream } = worker(env);
    // One more than the largest limit, read from wrangler.json: if refused requests were counted, this is
    // enough of them to exhaust any binding and turn a refusal into a 429.
    const n = Math.max(...Object.values(LIMITS)) + 1;
    for (let i = 0; i < n; i++) {
      for (const [method, path] of [['POST', '/auth/v1/signup'], ['POST', '/auth/v1/token?grant_type=password']] as const) {
        const res = await send(handle, method, path, { [IP]: '198.51.100.8' });
        expect(res.headers.get(PROXY_HEADER), `${method} ${path} #${i}`).toBe('refused');
        expect(res.status, `${method} ${path} #${i} must stay a 404, never a 429`).toBe(404);
      }
      expect((await send(handle, 'GET', VERIFY, { [IP]: '198.51.100.8', upgrade: 'websocket' })).headers.get(PROXY_HEADER)).toBe('refused');
    }
    expect(Object.values(calls).flat(), 'a refused request was counted').toEqual([]);
    expect(upstream, 'a refused request reached the origin').not.toHaveBeenCalled();
  });

  test('FAIL OPEN — an absent binding forwards, and a limiter that throws or rejects forwards', async () => {
    const absent = worker({});
    expect((await send(absent.handle, 'POST', '/auth/v1/otp', { [IP]: '198.51.100.3' })).headers.get(PROXY_HEADER)).toBe('forwarded');
    for (const boom of [
      { limit: () => { throw new Error('limiter down'); } },
      { limit: async () => { throw new Error('limiter rejected'); } },
      { limit: async () => ({}) },
      {},
    ]) {
      const { handle, upstream } = worker({ LIMIT_OTP: boom });
      for (let i = 0; i < (LIMITS['LIMIT_OTP'] ?? 0) + 3; i++) {
        expect((await send(handle, 'POST', '/auth/v1/otp', { [IP]: '198.51.100.3' })).headers.get(PROXY_HEADER)).toBe('forwarded');
      }
      expect(upstream).toHaveBeenCalledTimes((LIMITS['LIMIT_OTP'] ?? 0) + 3);
    }
  });

  test('the limiter timeout is 250 ms — pinned, because every other test advances the clock by the imported constant and passes at any value (FC-1 a)', () => {
    expect(LIMITER_TIMEOUT_MS).toBe(250);
  });

  test('FAIL OPEN, BOUNDARY — a limiter that answers {success:false} at the timeout minus 1 ms IS honoured: 429 limited, and the origin is not called (FC-1 b)', async () => {
    // At a timeout of 0 this limiter would lose the race and be forwarded: the limits silently off while
    // `limits_bound` reads true.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const slow = { limit: () => new Promise<{ success: boolean }>((resolve) => setTimeout(() => resolve({ success: false }), LIMITER_TIMEOUT_MS - 1)) };
      const { handle, upstream } = worker({ LIMIT_OTP: slow });
      const pending = send(handle, 'POST', '/auth/v1/otp', { [IP]: '198.51.100.3' });
      await vi.advanceTimersByTimeAsync(LIMITER_TIMEOUT_MS - 1);
      const res = await pending;
      expect(res.status, 'a limiter that answered in time was overruled by the timer').toBe(429);
      expect(res.headers.get(PROXY_HEADER)).toBe('limited');
      expect(upstream, 'a limited request reached the origin').not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test('FAIL OPEN — a limiter that NEVER answers is still pending at the timeout minus 1 ms, forwards at the timeout, and the timer is cleared when it answers first (FB-3 i; FC-1 c)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const hung = { limit: () => new Promise<never>(() => undefined) };
      const { handle, upstream } = worker({ LIMIT_OTP: hung });
      let settled = false;
      const pending = send(handle, 'POST', '/auth/v1/otp', { [IP]: '198.51.100.3' }).then((r) => {
        settled = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(LIMITER_TIMEOUT_MS - 1);
      expect(settled, 'the request was answered BEFORE the timeout: a timer shorter than the one pinned').toBe(false);
      expect(upstream).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const res = await pending;
      expect(res.headers.get(PROXY_HEADER), 'a limiter that never answered held the request, or limited it').toBe('forwarded');
      expect(upstream).toHaveBeenCalledTimes(1);
      // And when the limiter DOES answer, no timer is left behind.
      const { handle: h2 } = worker(fakeLimits().env);
      expect((await send(h2, 'POST', '/auth/v1/otp', { [IP]: '198.51.100.4' })).headers.get(PROXY_HEADER)).toBe('forwarded');
      expect(vi.getTimerCount(), 'the limiter timer was not cleared when limit() settled first').toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a missing cf-connecting-ip still limits, on one constant key — never unlimited', async () => {
    const { env, calls } = fakeLimits();
    const { handle } = worker(env);
    const limit = LIMITS['LIMIT_OTP'] ?? 0;
    for (let i = 0; i < limit; i++) await send(handle, 'POST', '/auth/v1/otp');
    expect((await send(handle, 'POST', '/auth/v1/otp')).status).toBe(429);
    expect(new Set(calls['LIMIT_OTP'])).toEqual(new Set([NO_ADDRESS_KEY]));
  });

  test('the stamp says which limits are bound, per binding, from env', async () => {
    const stamp = async (env?: ProxyEnv) => (await worker(env).handle(get(STAMP_PATH))).json();
    expect(await stamp(fakeLimits().env)).toEqual({ ...STAMP, limits_bound: { otp: true, verify: true, refresh: true } });
    expect(await stamp(fakeLimits(['LIMIT_OTP', 'LIMIT_REFRESH']).env)).toEqual({ ...STAMP, limits_bound: { otp: true, verify: false, refresh: true } });
    expect(await stamp(fakeLimits(['LIMIT_VERIFY']).env)).toEqual({ ...STAMP, limits_bound: { otp: false, verify: true, refresh: false } });
    expect(await stamp({ LIMIT_OTP: {} })).toEqual({ ...STAMP, limits_bound: { otp: false, verify: false, refresh: false } });
  });
});

// ---------------------------------------------------------------------------
// env REACHES THE HANDLER, behaviourally (R-2026-09-30-178 FB-3 h).
// ---------------------------------------------------------------------------

describe('the Worker entry points hand env to the handler — called, not parsed', () => {
  /**
   * index.js imports the gitignored ./version.json, so it cannot be imported in a clean clone, and this test
   * never writes supabase-proxy/version.json. It copies index.js's REAL text, handler.ts and allow-list.json into
   * a scratch directory beside a test version.json, and imports the copy. dev.js carries no stamp file and is
   * copied the same way. `mutate` is the plant: it edits the copy's text before it is imported.
   */
  async function entry(name: 'index.js' | 'dev.js', mutate?: (text: string) => string): Promise<{ fetch: (r: Request, env?: ProxyEnv) => Promise<Response> }> {
    const dir = mkdtempSync(join(tmpdir(), 'openbed-entry-'));
    try {
      mkdirSync(dir, { recursive: true });
      const real = readFileSync(join(REPO_ROOT, 'supabase-proxy', name), 'utf8');
      const text = mutate === undefined ? real : mutate(real);
      if (mutate !== undefined) expect(text, `the plant did not change ${name}`).not.toBe(real);
      writeFileSync(join(dir, name), text);
      for (const f of ['handler.ts', 'allow-list.json']) writeFileSync(join(dir, f), readFileSync(join(REPO_ROOT, 'supabase-proxy', f)));
      writeFileSync(join(dir, 'version.json'), JSON.stringify(STAMP));
      const mod = (await import(/* @vite-ignore */ pathToFileURL(join(dir, name)).href)) as { default: { fetch: (r: Request, env?: ProxyEnv) => Promise<Response> } };
      return mod.default;
    } finally {
      // The module is already loaded: the files are not read again, so the directory can go.
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const bound = async (e: { fetch: (r: Request, env?: ProxyEnv) => Promise<Response> }) =>
    ((await (await e.fetch(new Request(`https://api.openbed.ng${STAMP_PATH}`), fakeLimits().env)).json()) as { limits_bound: Record<string, boolean> }).limits_bound;

  test.each(['index.js', 'dev.js'] as const)('real %s hands env to the handler: the stamp reads all three bindings bound', async (name) => {
    expect(await bound(await entry(name))).toEqual({ otp: true, verify: true, refresh: true });
  });

  test.each(['index.js', 'dev.js'] as const)('plant — %s whose handle call passes {} reads all three bindings unbound', async (name) => {
    const e = await entry(name, (t) => t.replace('return handle(request, env);', 'return handle(request, {});'));
    expect(await bound(e)).toEqual({ otp: false, verify: false, refresh: false });
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

  test('pin — the Worker\'s own `limited` 429 on /otp reads as answered, as GoTrue\'s 429 does (FA-3 g)', async () => {
    // Today's reading, pinned and NOT changed in W3: a per-IP limit says nothing about the address,
    // so whether /otp gets its own message is a clinical-path question for W4 (D5).
    const res = new Response('{"message":"rate limited by the OpenBed proxy"}', { status: 429, headers: { [PROXY_HEADER]: 'limited', 'retry-after': '60' } });
    expect(await ask(res)).toEqual({ kind: 'answered', status: 429 });
  });

  test("positive control — GoTrue's own 422 and 429, forwarded, still read as answered", async () => {
    for (const status of [200, 422, 429]) {
      expect(await ask(new Response('{}', { status, headers: { [PROXY_HEADER]: 'forwarded' } }))).toEqual({ kind: 'answered', status });
    }
    expect(await ask(new Response('{}', { status: 404 })), 'a 404 with no proxy header is still an answer').toEqual({ kind: 'answered', status: 404 });
  });
});
