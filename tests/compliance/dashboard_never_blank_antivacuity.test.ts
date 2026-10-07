import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readCases } from './_junit.js';
import { place, REPO_ROOT, withScratch } from './_scratch.js';

/**
 * ANTI-VACUITY FOR tests/compliance/dashboard_never_blank.test.ts (R-2026-10-07 GJ, item 4e).
 *
 * A leg that no regression can turn red proves nothing, so this file runs a COPY of the behaviour tests
 * against planted variants of the page and shows each leg turn red. The variants are built from the REAL
 * apps/public-dashboard/src/main.ts, by exact text replacement, each confirmed to have landed, so there is no
 * frozen copy of the page to drift. When main.ts moves and an anchor stops matching, the plant says so
 * loudly instead of quietly planting nothing.
 *
 * HOW. A scratch project gets the variant as main.ts (its relative imports rewritten to absolute paths, its
 * workspace packages reached through a symlink to this repository's node_modules), and a copy of the
 * behaviour file whose one DASHBOARD line points at it. A real child vitest runs the copy and writes JUnit,
 * which tests/compliance/_junit.ts reads, refusing a run that collected nothing.
 *
 * THE VARIANTS, and the legs each must turn red:
 *   - polling starts only after a SUCCESSFUL first load (the page before GJ)   a, b, d
 *   - no catch around renderReal, none in render()                             b
 *   - a failed poll drops the held snapshot for the outage notice              c
 *   - a second interval started on every recovery                              a, d
 * plus the CONTROL: the unmodified page passes every leg in the same scratch project, so a red above is the
 * variant's doing and not the harness's.
 *
 * LEG c asserts UNCHANGED behaviour (a failed poll keeps the held snapshot), so it cannot be red against the
 * old page, which already did this; its red is the third variant. GJ item 4e asks for each of a to d to go
 * red against main's main.ts. Run against that file, a, b and d go red and c stays green, and this is the
 * reason; the same run is in the pull request.
 *
 * NOT ASSERTED HERE, deliberately: that the variants are the ONLY ways to regress the page. They are the
 * four behaviours GJ rules, each planted once.
 */

const SRC_DIR = join(REPO_ROOT, 'apps', 'public-dashboard', 'src');
const SRC = readFileSync(join(SRC_DIR, 'main.ts'), 'utf8');
const BEHAVIOUR_PATH = join(REPO_ROOT, 'tests', 'compliance', 'dashboard_never_blank.test.ts');
const BEHAVIOUR = readFileSync(BEHAVIOUR_PATH, 'utf8');
const VITEST = join(REPO_ROOT, 'node_modules', '.bin', 'vitest');

/** Rewrites the relative specifiers in `from '..'`, `import '..'` to absolute paths, so the file runs from another directory. */
function absolutise(text: string, fromDir: string): string {
  return text.replace(/(\bfrom\s+|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g, (_m, kw: string, q: string, spec: string) => `${kw}${q}${resolve(fromDir, spec)}${q}`);
}

/** Replaces `from` with `to` exactly once, and says so if the plant did not land. */
function plant(text: string, from: string, to: string): string {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`ERROR: the plant's anchor was found ${n} times, not once, in main.ts: ${JSON.stringify(from.slice(0, 80))}`);
  const out = text.replace(from, () => to);
  if (out === text) throw new Error('ERROR: the plant changed nothing');
  return out;
}

const ANCHORS = {
  pollStart: '    polling = setInterval(tick, POLL_MS);',
  tryShowCatch: "    } catch (e) {\n      logFault('render', e);\n      restore();\n      return false;\n    }",
  renderCatch: "  } catch (e) {\n    logFault('render', e);\n    renderOutage(root);\n  }\n}",
  failedPoll: '        // A failed poll keeps the held snapshot on screen; with none held, the outage notice stays.\n        restore();',
  recovered: '        if (next !== null) {\n          tryShow(next);\n          return;\n        }',
};

const VARIANTS: Record<string, { edits: Array<[string, string]>; reds: string[] }> = {
  'polling starts only after a successful first load (the page before GJ)': {
    edits: [[ANCHORS.pollStart, '    if (held !== null) polling = setInterval(tick, POLL_MS);']],
    reds: ['a', 'b', 'd'],
  },
  'no catch around renderReal and none in render()': {
    edits: [
      [ANCHORS.tryShowCatch, '    } catch (e) {\n      throw e;\n    }'],
      [ANCHORS.renderCatch, '  } finally {\n    // planted: nothing is caught here\n  }\n}'],
    ],
    reds: ['b'],
  },
  'a failed poll drops the held snapshot for the outage notice': {
    edits: [[ANCHORS.failedPoll, '        held = null;\n        renderOutage(root);']],
    reds: ['c'],
  },
  'a second interval is started on every recovery': {
    edits: [[ANCHORS.recovered, '        if (next !== null) {\n          tryShow(next);\n          polling = setInterval(tick, POLL_MS);\n          return;\n        }']],
    reds: ['a', 'd'],
  },
};

/** The letters of the legs that failed in a child run of the behaviour copy against `mainText`. */
function failedLegs(mainText: string): { failed: string[]; collected: number; names: string[] } {
  return withScratch((root) => {
    place(root, 'main.ts', absolutise(mainText, SRC_DIR));
    const dashboardLine = /^const DASHBOARD = '[^']+';$/m;
    if (!dashboardLine.test(BEHAVIOUR)) throw new Error('ERROR: the behaviour file no longer has its single DASHBOARD line, so the variants cannot be pointed at');
    const copy = absolutise(BEHAVIOUR.replace(dashboardLine, `const DASHBOARD = ${JSON.stringify(join(root, 'main.ts'))};`), dirname(BEHAVIOUR_PATH));
    place(root, 'never_blank.test.ts', copy);
    place(root, 'vitest.config.mjs', "export default { test: { include: ['never_blank.test.ts'] } };\n");
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'));
    const out = join(root, 'junit.xml');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST')));
    let log = '';
    try {
      log = execFileSync(VITEST, ['run', '--root', root, '--config', join(root, 'vitest.config.mjs'), '--reporter=junit', `--outputFile=${out}`], {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      const x = e as { stdout?: string; stderr?: string };
      log = `${x.stdout ?? ''}${x.stderr ?? ''}`; // a red child run exits 1; the JUnit is what matters
    }
    expect(existsSync(out), `the child vitest wrote no JUnit file:\n${log}`).toBe(true);
    const cases = readCases(readFileSync(out, 'utf8'));
    // A JUnit name carries the describe path ("... > a — ..."), so the leg letter is matched after it.
    const leg = /(?:^|> )([a-d]) — /;
    const failed = cases.filter((c) => c.failed).map((c) => leg.exec(c.name)?.[1] ?? `?${c.name.slice(0, 30)}`);
    return { failed: failed.sort(), collected: cases.filter((c) => leg.test(c.name)).length, names: cases.map((c) => `${c.failed ? 'FAILED ' : ''}${c.name}`) };
  });
}

describe('the never-blank legs can fail', () => {
  test('control — the unmodified page passes every leg in the same scratch project', () => {
    const r = failedLegs(SRC);
    expect(r.collected, `the four legs were not all collected in the scratch project, so a pass proves nothing. Collected:\n${r.names.join('\n')}`).toBe(4);
    expect(r.failed, 'the unmodified page failed a leg in the scratch project: the harness, not a variant, is wrong').toEqual([]);
  });

  test.each(Object.entries(VARIANTS))('plant — %s turns its legs red', (_name, variant) => {
    let text = SRC;
    for (const [from, to] of variant.edits) text = plant(text, from, to);
    expect(text, 'the variant is the unmodified page').not.toBe(SRC);
    const r = failedLegs(text);
    expect(r.collected).toBe(4);
    for (const leg of variant.reds) {
      expect(r.failed, `leg ${leg} stayed green against the variant: it cannot catch this regression`).toContain(leg);
    }
  });

  test('anti-vacuity — a plant whose anchor is gone is refused loudly, not planted as nothing', () => {
    expect(() => plant(SRC, '    this line is not in main.ts at all', 'x')).toThrow('the plant\'s anchor was found 0 times');
  });
});
