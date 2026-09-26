import ts from 'typescript';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { deployableApps, outputDirOf } from './_apps.js';

/**
 * THE DESIGN IS APPLIED, AND STAYS APPLIED (the design-pass kickoff, D1). Pure checks and
 * their file readers, for the guards in tests/compliance/bundle_guards.test.ts. Pure, so
 * each plant there feeds constructed text instead of editing an app.
 *
 * Why these exist: all three apps shipped with almost no styling, and the ward console
 * with no viewport meta, and nothing went red. The deferral that let it happen had no
 * gate (R-2026-09-26-121 CW-3). These guards are what stop it recurring silently:
 *   - the viewport meta is present, compared by its parsed attributes;
 *   - the BUILT CSS carries the design tokens (--ob-navy-700) and an @font-face whose
 *     every src is a same-origin woff2 that exists in the build -- the proof the design
 *     is applied, not merely imported somewhere;
 *   - no inline style in an app's source: no style= attribute, no .style. access, no
 *     setAttribute('style', ...). The CSP (style-src 'self') refuses the first and the
 *     third in a browser, silently; it does not refuse CSSOM .style., so for that one
 *     this is the only control;
 *   - no Google font host in any app's source or the design package. The built-output
 *     half is scripts/lint_no_third_party_fonts.sh, which scans dist only.
 */

export const TOKEN = '--ob-navy-700';
export const VIEWPORT_CONTENT = 'width=device-width, initial-scale=1';
/** Built from pieces so this file never carries the hosts it refuses. */
export const FONT_HOSTS = [['fonts', 'googleapis', 'com'].join('.'), ['fonts', 'gstatic', 'com'].join('.')];

/** Every <meta> tag's attributes, comments removed first. */
function metaTags(html: string): Record<string, string>[] {
  const bare = html.replace(/<!--[\s\S]*?-->/g, '');
  const out: Record<string, string>[] = [];
  for (const m of bare.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs: Record<string, string> = {};
    for (const a of (m[1] ?? '').matchAll(/([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      attrs[(a[1] ?? '').toLowerCase()] = a[3] ?? a[4] ?? '';
    }
    out.push(attrs);
  }
  return out;
}

/** True when the page carries <meta name="viewport" content="width=device-width, initial-scale=1">. */
export function hasViewport(html: string): boolean {
  return metaTags(html).some(
    (t) => t['name'] === 'viewport' && (t['content'] ?? '').replace(/\s*,\s*/g, ', ').trim() === VIEWPORT_CONTENT,
  );
}

/** Every file under a directory, recursively. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

export interface BuiltCss {
  /** The app's build output directory, absolute. */
  readonly dist: string;
  readonly files: readonly { path: string; text: string }[];
}

/**
 * An app's built CSS. THROWS -- never returns empty -- when the build output is missing,
 * because a guard over an unbuilt app reporting "clean" or "still pending" is a verdict
 * from a check that did not run (test-conventions section 8).
 */
export function builtCss(app: string, root: string): BuiltCss {
  const dist = join(root, 'apps', app, outputDirOf(app, root));
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error(`ERROR: apps/${app} has no built output (${relative(root, dist)}/index.html is missing). Run 'npm run build' first: a design guard over an unbuilt app is not a verdict.`);
  }
  const files = walk(dist)
    .filter((f) => f.endsWith('.css'))
    .sort()
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  return { dist, files };
}

/** An app's index.html. THROWS when it is missing, for the same reason. */
export function indexHtml(app: string, root: string): string {
  const file = join(root, 'apps', app, 'index.html');
  if (!existsSync(file)) throw new Error(`ERROR: apps/${app}/index.html is missing: the viewport guard cannot run.`);
  return readFileSync(file, 'utf8');
}

/**
 * The value of an @font-face block's `src` declaration: up to the first ; OUTSIDE
 * parentheses, because a data: URL carries ; inside its url() and a split on ; would
 * cut it short and let the scheme check read a fragment.
 */
function srcValue(block: string): string {
  const m = /(?:^|[;{\s])src\s*:/.exec(block);
  if (m === null) return '';
  let depth = 0;
  let out = '';
  for (const ch of block.slice(m.index + m[0].length)) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) break;
    out += ch;
  }
  return out;
}

/**
 * Why an app's built CSS does not show the design applied, or [] when it does. A url()
 * is same-origin when it has no scheme and does not start with //; it must end .woff2
 * and must exist in the build, resolved from dist for a /-rooted path and from the CSS
 * file's own directory otherwise.
 */
export function appliedViolations(css: BuiltCss): string[] {
  const out: string[] = [];
  if (css.files.length === 0) return ['the build holds no CSS file at all'];
  if (!css.files.some((f) => f.text.includes(TOKEN))) out.push(`no built CSS file carries the design token ${TOKEN}`);
  let faces = 0;
  for (const f of css.files) {
    for (const face of f.text.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      faces += 1;
      const src = srcValue(face[1] ?? '');
      const urls = Array.from(src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)).map((u) => u[2] ?? '');
      if (urls.length === 0) out.push(`an @font-face in ${relative(css.dist, f.path)} has no src url()`);
      for (const u of urls) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//')) {
          out.push(`an @font-face src is not same-origin: ${u}`);
          continue;
        }
        if (!/\.woff2(?:[?#].*)?$/.test(u)) out.push(`an @font-face src is not a woff2: ${u}`);
        const path = u.replace(/[?#].*$/, '');
        const onDisk = path.startsWith('/') ? join(css.dist, path) : join(dirname(f.path), path);
        if (!existsSync(onDisk)) out.push(`an @font-face src names a file the build does not hold: ${u}`);
      }
    }
  }
  if (faces === 0) out.push('no built CSS file holds an @font-face: the typefaces are not self-hosted');
  return out;
}

/** Why a source file carries an inline style, or []. TypeScript is parsed, never grepped. */
export function inlineStyleViolations(file: string, text: string): string[] {
  const out: string[] = [];
  const attr = /<[a-zA-Z][^<>]*\sstyle\s*=/;
  if (file.endsWith('.html')) {
    if (attr.test(text.replace(/<!--[\s\S]*?-->/g, ''))) out.push(`${file}: a style= attribute`);
    return out;
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'style') {
      out.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: a .style access`);
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'style') {
      out.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: a ['style'] access`);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'setAttribute') {
      const first = node.arguments[0];
      if (first !== undefined && ts.isStringLiteralLike(first) && first.text.toLowerCase() === 'style') {
        out.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: setAttribute('style', ...)`);
      }
    }
    if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && attr.test(node.text)) {
      out.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: markup with a style= attribute`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** Why a file names a Google font host, or []. Plain text, comments included: strict. */
export function fontHostViolations(file: string, text: string): string[] {
  return FONT_HOSTS.filter((h) => text.includes(h)).map((h) => `${file}: names ${h}`);
}

/** An app's source corpus: index.html and every .ts and .css file under src/. */
export function appSource(app: string, root: string): string[] {
  const src = join(root, 'apps', app, 'src');
  const files = [join(root, 'apps', app, 'index.html')];
  if (existsSync(src)) files.push(...walk(src).filter((f) => /\.(ts|css)$/.test(f)));
  return files.sort();
}

/** The design package's corpus: every file it ships. */
export function designSource(root: string): string[] {
  const dir = join(root, 'packages', 'design');
  if (!existsSync(dir)) return [];
  return walk(dir).filter((f) => !f.includes(`${join('node_modules', '')}`)).sort();
}

export { deployableApps };
