import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';
import { bedCountText } from '../../packages/labels/src/index.js';

/**
 * A BED COUNT BECOMES WORDS IN ONE PLACE (R-2026-09-27-140 DP-5 a; R-2026-09-27-144 DT,
 * Bundle 4).
 *
 * "N beds" was built by hand at three sites -- the public page, the ward console and the
 * admin app -- and each read "1 beds" for a one-bed ward. packages/labels/src/index.ts's
 * bedCountText() is now the one place, and this guard refuses a count joined to "bed" or
 * "beds" anywhere else, so a fourth site cannot bring the defect back.
 *
 * WHAT IS REFUSED, on code lines (a line that opens with `//`, `/*` or `*` is a comment
 * and is not read; this repository's comments quote "6 beds" as prose):
 *   - a template placeholder followed by the word: `${…} beds`, `${…} bed`;
 *   - a concatenation onto the word: `+ ' beds'`, `+ " bed"`.
 * The helper's own body is exempt BY LOCATION -- the lines of `function bedCountText` in
 * packages/labels/src/index.ts -- never by file, so a stray template elsewhere in that
 * file is refused like any other.
 *
 * THE CORPUS is every .ts and .tsx file under apps/<app>/src and packages/<package>/src,
 * at any depth. The apps found are asserted against the three DT names, so an app added
 * or renamed reds here rather than going unread.
 *
 * NOT ASSERTED HERE, deliberately: a count spelled out some other way, such as an array
 * joined with ' beds'. The three sites that existed were templates; a guard over every
 * way a string can be built would refuse ordinary code and be switched off.
 */

interface Source {
  path: string;
  text: string;
}

const APPS = ['admin', 'public-dashboard', 'ward-console'];
const HELPER_FILE = 'packages/labels/src/index.ts';

function tsUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsUnder(p));
    else if (e.isFile() && /\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function corpus(root: string): Source[] {
  const files: string[] = [];
  for (const top of ['apps', 'packages']) {
    for (const d of readdirSync(join(root, top)).sort()) {
      const src = join(root, top, d, 'src');
      try {
        if (!statSync(src).isDirectory()) continue;
      } catch {
        continue;
      }
      files.push(...tsUnder(src));
    }
  }
  return files.sort().map((f) => ({ path: relative(root, f), text: readFileSync(f, 'utf8') }));
}

const TEMPLATE = /\$\{[^}]*\}\s*beds?\b/;
const CONCAT = /\+\s*['"`]\s*beds?\b/;

/** The 1-indexed lines of bedCountText's body in the helper file, or an empty range. */
function helperLines(text: string): [number, number] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('export function bedCountText('));
  if (start < 0) return [0, -1];
  const end = lines.findIndex((l, i) => i > start && l === '}');
  return [start + 1, end + 1];
}

/** Every line that joins a count to "bed" or "beds" outside the helper, as path:line: text. */
function violations(sources: readonly Source[]): string[] {
  if (sources.length === 0) throw new Error('the bed-count wording guard read no source files: it would pass having checked nothing');
  const out: string[] = [];
  for (const { path, text } of sources) {
    const [from, to] = path === HELPER_FILE ? helperLines(text) : [0, -1];
    text.split('\n').forEach((line, i) => {
      const n = i + 1;
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
      if (n >= from && n <= to) return;
      if (TEMPLATE.test(line) || CONCAT.test(line)) out.push(`${path}:${n}: a count joined to "beds" outside bedCountText(): ${line.trim()}`);
    });
  }
  return out;
}

const REAL = corpus(REPO_ROOT);
const appFile = (app: string): Source => {
  const s = REAL.find((x) => x.path === `apps/${app}/src/main.ts`);
  if (s === undefined) throw new Error(`apps/${app}/src/main.ts is not in the corpus`);
  return s;
};

describe('bedCountText — one bed is "1 bed"', () => {
  test.each([[0, '0 beds'], [1, '1 bed'], [2, '2 beds'], [37, '37 beds']])('%s reads "%s"', (n, words) => {
    expect(bedCountText(n)).toBe(words);
  });
});

describe('a count is joined to "beds" only inside bedCountText()', () => {
  test('real apps and packages are accepted', () => {
    expect(violations(REAL)).toEqual([]);
  });

  test('the corpus reads every app DT names, and the helper file', () => {
    const apps = [...new Set(REAL.filter((s) => s.path.startsWith('apps/')).map((s) => s.path.split('/')[1]))].sort();
    expect(apps).toEqual(APPS);
    expect(REAL.map((s) => s.path)).toContain(HELPER_FILE);
  });

  test.each(APPS)('plant — a `${…} beds` template in apps/%s is refused', (app) => {
    const s = appFile(app);
    const planted = { path: s.path, text: `${s.text}\nconst planted = \`\${String(n)} beds\`;\n` };
    const v = violations([planted]);
    expect(v, v.join('\n')).toHaveLength(1);
    expect(v[0]).toContain(`${s.path}:`);
  });

  test('plant — a concatenation onto " bed" is refused', () => {
    const s = appFile('admin');
    const v = violations([{ path: s.path, text: `${s.text}\nconst planted = String(n) + ' bed';\n` }]);
    expect(v, v.join('\n')).toHaveLength(1);
  });

  test('plant — a template in the helper FILE but outside the helper is refused: the exemption is by location', () => {
    const s = REAL.find((x) => x.path === HELPER_FILE)!;
    const v = violations([{ path: s.path, text: `${s.text}\nexport const planted = (n: number): string => \`\${n} beds\`;\n` }]);
    expect(v, v.join('\n')).toHaveLength(1);
  });

  test('plant — the pre-fix admin line is refused', () => {
    const line = "  else claim = `${w.bedCount === null ? 'no count' : `${String(w.bedCount)} beds`}, last reported at x`;";
    expect(violations([{ path: 'apps/admin/src/main.ts', text: line }])).toHaveLength(1);
  });

  test('anti-vacuity — the guard over an empty corpus fails', () => {
    expect(() => violations([])).toThrow('the bed-count wording guard read no source files');
  });
});
