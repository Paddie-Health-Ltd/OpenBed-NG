import { describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { withScratch, place, REPO_ROOT } from './_scratch.js';

/**
 * GUARD OVER THE NEUTER HARNESS -- scripts/neuter.sh and scripts/neuter_plant.mjs.
 *
 * WHY THESE ARE CONTROLS. A neuter is how this repository proves a test can
 * fail: plant the defect, watch the test go red, restore. The harness that did
 * this for migrations 014 and 015 lived in a scratchpad and produced two false
 * results in one day -- a run that selected zero tests and said nothing, and a
 * final exit status that printed empty. Founder ruling R-2026-09-15-03 item 4:
 * tracked, with legs, before the shell pin lands.
 *
 * HOW THE PLANTS REACH THE HARNESS. neuter.sh takes a ROOT; each leg builds a
 * scratch project -- a target module, a test over it, and node_modules linked
 * to this repository's so the pinned vitest runs -- and points the real harness
 * at it. The artefact under test is the real script; only the tree is built.
 *
 * EVERY LEG ASSERTS THE TARGET FILE IS BYTE-IDENTICAL AFTERWARDS. A harness that
 * reported correctly and left a tracked file planted would be worse than no
 * harness, and exit status alone cannot see it.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - That a spec's neuters are the RIGHT neuters. The harness proves a named
 *     change reddens named tests; choosing the change is the author's claim.
 *   - A live APPLY against the database. The db neuters of 014/015 exercise
 *     that path; here APPLY and PROBE are ordinary shell commands in the
 *     scratch tree, which is the same code path with no database.
 */
const HARNESS = join(REPO_ROOT, 'scripts/neuter.sh');
/** The plant half, invoked by the harness in every leg and directly below. */
const PLANT_TOOL = join(REPO_ROOT, 'scripts/neuter_plant.mjs');
const TARGET = 'src/target.mjs';
const TARGET_SRC = 'export function gate(n) {\n  if (n < 0) return "REFUSED";\n  return "OK";\n}\n';
const COVERING_TEST =
  "import { test, expect } from 'vitest';\nimport { gate } from '../src/target.mjs';\n" +
  "test('negative input is refused', () => { expect(gate(-1)).toBe('REFUSED'); });\n" +
  "test('positive input passes', () => { expect(gate(1)).toBe('OK'); });\n";

interface Run {
  status: number;
  out: string;
  targetAfter: string;
}

function harness(neuters: unknown[], opts: { names?: string[]; raw?: string; noVitest?: boolean } = {}): Run {
  return withScratch((root) => {
    if (!opts.noVitest) symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'));
    place(root, TARGET, TARGET_SRC);
    place(root, 'tests/target.test.mjs', COVERING_TEST);
    place(root, 'spec.json', opts.raw ?? JSON.stringify({ neuters }));
    let status = 0;
    let out = '';
    try {
      out = execFileSync('bash', [HARNESS, join(root, 'spec.json'), root, ...(opts.names ?? [])], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120_000,
      });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      status = err.status ?? -1;
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    return { status, out, targetAfter: readFileSync(join(root, TARGET), 'utf8') };
  });
}

const refuseNothing = { old: 'if (n < 0) return "REFUSED";', new: '', count: 1 };

describe('neuter.sh — the harness that proves a test can fail', () => {
  test('real neuter.sh reports an ordinary neuter RED, restores, and exits 0', () => {
    const r = harness([{ name: 'G1', file: TARGET, replace: [refuseNothing], tests: ['tests/target.test.mjs'] }]);
    expect(r.status, `an ordinary neuter was not certified:\n${r.out}`).toBe(0);
    expect(r.out).toContain('== G1: Tests 1 failed | 1 passed (2)');
    expect(r.out).toContain('x negative input is refused');
    expect(r.out).toContain('NEUTERS RED; every restore verified.');
    expect(r.targetAfter, `the target was left planted:\n${r.out}`).toBe(TARGET_SRC);
  });

  test('plant — a neuter no test notices is reported as SURVIVED with exit 1', () => {
    const r = harness([
      { name: 'G2', file: TARGET, replace: [{ old: 'return "OK";', new: 'return "OK"; // untouched behaviour', count: 1 }], tests: ['tests/target.test.mjs'] },
    ]);
    expect(r.status, `a surviving neuter was not a finding:\n${r.out}`).toBe(1);
    expect(r.out).toContain('NEUTER SURVIVED');
    expect(r.out).toContain('neuter(s) survived: G2');
    expect(r.targetAfter).toBe(TARGET_SRC);
  });

  test('plant — zero tests selected aborts with exit 2, never a verdict', () => {
    // The N13 shape: two paths as one argument, vitest found nothing, and the
    // scratchpad harness said nothing.
    const r = harness([{ name: 'G3', file: TARGET, replace: [refuseNothing], tests: ['tests/no_such_file.test.mjs'] }]);
    expect(r.status, `a run over zero tests produced a verdict:\n${r.out}`).toBe(2);
    expect(r.out).toContain('zero tests selected for neuter');
    expect(r.out).toContain('the run tested nothing');
    expect(r.targetAfter, `an abort left the target planted:\n${r.out}`).toBe(TARGET_SRC);
  });

  test('plant — a plant whose anchor is absent aborts with exit 2', () => {
    const r = harness([{ name: 'G4', file: TARGET, replace: [{ old: 'if (n <= 0)', new: '', count: 1 }], tests: ['tests/target.test.mjs'] }]);
    expect(r.status, `an unlanded plant was run:\n${r.out}`).toBe(2);
    expect(r.out).toContain('PLANT DID NOT LAND');
    expect(r.out).toContain('An unlanded plant leaves the file unchanged');
    expect(r.targetAfter).toBe(TARGET_SRC);
  });

  test('plant — a replacement that leaves the file byte-identical aborts with exit 2', () => {
    const r = harness([{ name: 'G5', file: TARGET, replace: [{ old: 'return "OK";', new: 'return "OK";', count: 1 }], tests: ['tests/target.test.mjs'] }]);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('byte-identical');
    expect(r.targetAfter).toBe(TARGET_SRC);
  });

  test('plant — a PROBE that does not move on the plant aborts with exit 2', () => {
    const r = harness([
      { name: 'G6', file: TARGET, replace: [refuseNothing], tests: ['tests/target.test.mjs'], probe: 'echo constant' },
    ]);
    expect(r.status, `a plant that never reached its target was measured:\n${r.out}`).toBe(2);
    expect(r.out).toContain('did not reach its target -- the PROBE is unchanged after APPLY');
    expect(r.targetAfter).toBe(TARGET_SRC);
  });

  test('plant — a PROBE that does not return on restore aborts with exit 2', () => {
    // The probe reads a counter that APPLY bumps every time it runs: once for
    // the plant, once for the restore. So it moves on the plant (as it must)
    // and never comes back -- the shape of a restore that did not take.
    const r = harness([
      {
        name: 'G7',
        file: TARGET,
        replace: [refuseNothing],
        tests: ['tests/target.test.mjs'],
        apply: 'echo x >> "$NEUTER_ROOT/counter"',
        probe: 'cat "$NEUTER_ROOT/counter" 2>/dev/null | wc -l',
      },
    ]);
    expect(r.status, `a restore that did not take was certified:\n${r.out}`).toBe(2);
    expect(r.out).toContain('the PROBE did not return to its original value');
    expect(r.targetAfter).toBe(TARGET_SRC);
  });

  test('plant — an APPLY that fails aborts with exit 2', () => {
    const r = harness([{ name: 'G8', file: TARGET, replace: [refuseNothing], tests: ['tests/target.test.mjs'], apply: 'exit 7' }]);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('the APPLY hook command failed (exit 7) for neuter G8 -- nothing was measured');
    expect(r.targetAfter, `a failed APPLY left the target planted:\n${r.out}`).toBe(TARGET_SRC);
  });

  test('plant — a PROBE command that fails aborts with exit 2', () => {
    const r = harness([{ name: 'G13', file: TARGET, replace: [refuseNothing], tests: ['tests/target.test.mjs'], probe: 'exit 4' }]);
    expect(r.status, `a probe that could not run produced a verdict:\n${r.out}`).toBe(2);
    expect(r.out).toContain('the PROBE command failed (exit 4) for neuter G13');
    expect(r.targetAfter).toBe(TARGET_SRC);
  });

  test('plant — a target that differs from its original after restore aborts with exit 2', () => {
    // APPLY runs after the plant and again after the restore. One that writes
    // into the target leaves it different from the backup the second time --
    // the shape of a restore that did not return the file.
    const r = harness([
      { name: 'G14', file: TARGET, replace: [refuseNothing], tests: ['tests/target.test.mjs'], apply: 'echo "// appended" >> "$NEUTER_FILE"' },
    ]);
    expect(r.status, `a file that did not come back was certified:\n${r.out}`).toBe(2);
    expect(r.out).toContain('differs from its original after restore');
    expect(r.targetAfter, `the trap did not put the original back:\n${r.out}`).toBe(TARGET_SRC);
  });

  test('plant — a ROOT with no vitest aborts with exit 2', () => {
    const r = harness([{ name: 'G15', file: TARGET, replace: [refuseNothing], tests: ['tests/target.test.mjs'] }], { noVitest: true });
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('the harness cannot run tests there');
    expect(r.targetAfter).toBe(TARGET_SRC);
  });

  test('plant — a neuter targeting a missing file aborts with exit 2', () => {
    const r = harness([{ name: 'G9', file: 'src/missing.mjs', replace: [refuseNothing], tests: ['tests/target.test.mjs'] }]);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('which does not exist under');
  });

  test('plant — a malformed neuter, a duplicate name and an unknown name are refused', () => {
    const malformed = harness([{ name: 'G10', file: TARGET, replace: [], tests: ['tests/target.test.mjs'] }]);
    expect(malformed.status, malformed.out).toBe(2);
    expect(malformed.out).toContain('is malformed: "G10"');
    expect(malformed.out).toContain('at least one {old, new, count>0} replacement and at least one test file');

    const dup = harness([
      { name: 'G11', file: TARGET, replace: [refuseNothing], tests: ['tests/target.test.mjs'] },
      { name: 'G11', file: TARGET, replace: [refuseNothing], tests: ['tests/target.test.mjs'] },
    ]);
    expect(dup.status, dup.out).toBe(2);
    expect(dup.out).toContain('An ambiguous neuter is not a neuter.');

    const unknown = harness([{ name: 'G12', file: TARGET, replace: [refuseNothing], tests: ['tests/target.test.mjs'] }], { names: ['G99'] });
    expect(unknown.status, unknown.out).toBe(2);
    expect(unknown.out).toContain('the neuter spec has no neuter named');
  });

  test('plant — an unreadable spec is refused', () => {
    const r = harness([], { raw: '{ not json' });
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('cannot read the neuter spec as JSON');
  });

  test('plant — neuter_plant.mjs refuses bad usage, apply without a root, and an unreadable target', () => {
    const node = (args: string[]): { status: number; out: string } => {
      try {
        return { status: 0, out: execFileSync('node', [PLANT_TOOL, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
      } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
      }
    };
    const usage = node(['plant-everything']);
    expect(usage.status, usage.out).toBe(2);
    expect(usage.out).toContain('usage: node scripts/neuter_plant.mjs names|describe|apply <spec.json> [name] [root]');

    withScratch((root) => {
      place(root, 'spec.json', JSON.stringify({ neuters: [{ name: 'G16', file: 'src/absent.mjs', replace: [refuseNothing], tests: ['t.test.mjs'] }] }));
      const noRoot = node(['apply', join(root, 'spec.json'), 'G16']);
      expect(noRoot.status, noRoot.out).toBe(2);
      expect(noRoot.out).toContain('apply needs the root it plants under');

      const unreadable = node(['apply', join(root, 'spec.json'), 'G16', root]);
      expect(unreadable.status, unreadable.out).toBe(2);
      expect(unreadable.out).toContain('the plant target cannot be read, so nothing was planted');
    });
  });

  test('plant — no spec argument is a usage failure', () => {
    let status = 0;
    let out = '';
    try {
      out = execFileSync('bash', [HARNESS], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      status = err.status ?? -1;
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    expect(status, out).toBe(2);
    expect(out).toContain('no neuter spec given');
  });

  test('anti-vacuity — a spec with no neuters fails rather than certifying nothing', () => {
    const r = harness([]);
    expect(r.status, `an empty spec produced a verdict:\n${r.out}`).toBe(2);
    expect(r.out).toContain('the neuter spec holds no neuters.');
    expect(r.out).toContain('A harness run over no neuters certifies nothing.');
  });
});
