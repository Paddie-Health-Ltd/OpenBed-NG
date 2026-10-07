import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { REPO_ROOT } from './_scratch.js';

/**
 * THE SHARP OVERRIDE, AND THE GUARD THAT SAYS WHEN IT IS NO LONGER NEEDED (R-2026-10-07 GL).
 *
 * WHY THE OVERRIDE EXISTS. Advisory GHSA-wq5f-xc86-pv6w (a librsvg flaw in `sharp` below 0.35.5) reads as three
 * high findings on the evidence block's Audit line: `sharp`, and `miniflare` and `wrangler` above it. The chain
 * is `wrangler` (the root devDependency, pinned exactly) to `miniflare`, which pins `sharp` EXACTLY at 0.35.4, so
 * no range update reaches it, and no wrangler release fixed it when GL was written (npm's own "fix" is a
 * downgrade to a build that predates the rate-limit bindings the Worker's config uses). The root package.json
 * therefore carries `"overrides": { "sharp": "0.35.5" }`, and the lockfile resolves sharp, 14 platform packages
 * and 12 libvips packages to the patched line. Nothing the deploy or build path runs loads sharp (GL's PR quotes
 * the probe); the override is there so the Audit line reads what is true and a future dev-server Images request
 * cannot reach the flawed decoder.
 *
 * WHAT THIS GUARD DOES. An override that outlives its reason is a pin nobody remembers, and it silently holds
 * back the next miniflare. So this file reads the root package.json and the lockfile and goes RED, with the
 * message GL fixed, the moment EVERY package in the lockfile that declares a `sharp` dependency declares 0.35.5
 * or later: the override is then redundant. It reads all the declarers, not only miniflare, so a second package
 * with an old pin cannot make the override look redundant while it is still doing work.
 *
 * THE THREE STATES, and what each reads:
 *   - override present, some declarer still below 0.35.5: clean (the override is working);
 *   - override present, no declarer below 0.35.5 (or none at all): RED, "the sharp override is now redundant";
 *   - override absent: RED, because a guard left behind with nothing to guard is inert (Clause 5), and a
 *     dropped override puts three high findings back. Retiring it on purpose is one change, below.
 * A version spec the reader cannot parse (anything but exact, ^ or ~) is a loud RED, never read as clean.
 *
 * TO REMOVE THE OVERRIDE, in ONE change: delete the "overrides" block from the root package.json, regenerate the
 * lockfile with npm install --package-lock-only --include=optional, read the Audit line (it must still read 0
 * high), and delete this file. Doing only the first two leaves the last state above RED, by design.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - that the advisory is the only reason to keep the override. A reason to keep it is a judgement, and this
 *     file only knows whether the pin it overrides is still below the fix;
 *   - that no code path loads sharp. That is a probe (a resolve hook logging any import of it across the deploy
 *     and build commands, with a deliberate import as the control), run and quoted in the pull request, not a
 *     test: a test that spawned wrangler here would need the native workerd binary and a stamp file;
 *   - the registry. Whether a newer miniflare exists is read by whoever updates wrangler, and this guard goes
 *     red when the lockfile shows it.
 */

type Json = Record<string, unknown>;

/** The first release with the librsvg fix. */
const FIXED: Triple = [0, 35, 5];

type Triple = readonly [number, number, number];

/** Exact, caret and tilde specs only. Anything else returns null, and null is a violation, not a pass. */
function parseSpec(spec: unknown): Triple | null {
  if (typeof spec !== 'string') return null;
  const m = /^[\^~]?(\d+)\.(\d+)\.(\d+)$/.exec(spec);
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
}

function atLeast(v: Triple, floor: Triple): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (v[i] !== floor[i]) return (v[i] as number) > (floor[i] as number);
  }
  return true;
}

const SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'] as const;

/** Every lockfile entry that declares a dependency named exactly `sharp`, with the spec it declares. */
function declarers(packages: Json): Array<{ key: string; spec: unknown }> {
  const out: Array<{ key: string; spec: unknown }> = [];
  for (const [key, entry] of Object.entries(packages)) {
    if (entry === null || typeof entry !== 'object') continue;
    for (const section of SECTIONS) {
      const deps = (entry as Json)[section];
      if (deps !== null && typeof deps === 'object' && Object.hasOwn(deps as Json, 'sharp')) {
        out.push({ key, spec: (deps as Json).sharp });
      }
    }
  }
  return out;
}

/** The violations; empty means clean. Fed parsed objects, so a plant is built in memory and never committed. */
export function sharpOverrideVerdict(pkg: Json, lock: Json): string[] {
  const packages = lock.packages;
  if (packages === null || typeof packages !== 'object' || Object.keys(packages as Json).length === 0) {
    return ['the lockfile has no "packages": nothing was read, so nothing can be called clean'];
  }
  const overrides = pkg.overrides;
  const ov = overrides !== null && typeof overrides === 'object' ? (overrides as Json).sharp : undefined;
  if (ov === undefined) {
    return ['the sharp override is gone but its guard remains: delete this file in the same change, or restore the override (R-2026-10-07 GL)'];
  }
  const pinned = parseSpec(ov);
  if (pinned === null || !atLeast(pinned, FIXED)) {
    return [`the sharp override is ${JSON.stringify(ov)}, which is not an exact, ^ or ~ version at or above 0.35.5, so it does not reach the fix`];
  }
  const found = declarers(packages as Json);
  const unreadable = found.filter((d) => parseSpec(d.spec) === null);
  if (unreadable.length > 0) {
    return unreadable.map((d) => `cannot read this sharp spec ${JSON.stringify(d.spec)} declared by ${d.key}: extend the parser before trusting this guard`);
  }
  const stillBelow = found.some((d) => !atLeast(parseSpec(d.spec) as Triple, FIXED));
  return stillBelow ? [] : ['the sharp override is now redundant: remove it (R-2026-10-07 GL)'];
}

const readJson = (name: string): Json => JSON.parse(readFileSync(join(REPO_ROOT, name), 'utf8')) as Json;

/** A minimal lockfile in which the override is working: miniflare pins sharp below the fix. */
function baseLock(): { packages: Record<string, Json> } {
  return {
    packages: {
      '': { name: 'x', version: '0.0.0' },
      'node_modules/miniflare': { version: '5.0.0', dependencies: { sharp: '0.35.4' } },
      'node_modules/sharp': { version: '0.35.5' },
    },
  };
}
const basePkg = (): Json => ({ overrides: { sharp: '0.35.5' } });

/** The declarers the real lockfile must show, by identity. A new package declaring sharp reddens this on purpose. */
const EXPECTED_DECLARERS = ['node_modules/miniflare'];

describe('the sharp override is needed exactly as long as something still pins sharp below the fix', () => {
  test('real package.json and lockfile are accepted — the override is present, working, and not yet redundant', () => {
    const pkg = readJson('package.json');
    const lock = readJson('package-lock.json');
    const packages = lock.packages as Record<string, Json>;
    const found = declarers(packages);
    expect(
      found.map((d) => d.key),
      'the set of packages declaring sharp changed: read what declares it now, and decide whether the override still does its work',
    ).toEqual(EXPECTED_DECLARERS);
    expect(found.map((d) => d.spec), 'miniflare no longer declares the pin the override exists to overcome').toEqual(['0.35.4']);
    expect((pkg.overrides as Json | undefined)?.sharp, 'the override is not the literal GL ruled').toBe('0.35.5');
    const resolved = parseSpec((packages['node_modules/sharp'] as Json | undefined)?.version);
    expect(resolved, 'the lockfile does not resolve sharp at all').not.toBeNull();
    expect(atLeast(resolved as Triple, FIXED), 'the lockfile still resolves sharp below 0.35.5: the override did not take').toBe(true);
    const verdict = sharpOverrideVerdict(pkg, lock);
    expect(verdict, `the guard rejected the real files: ${verdict.join(' | ')}`).toEqual([]);
  });

  test('plant — a baseline lockfile in which the override is working reads clean, so each plant below is the only difference', () => {
    expect(sharpOverrideVerdict(basePkg(), baseLock())).toEqual([]);
  });

  test('plant — miniflare declaring 0.35.5 makes the override redundant, with the ruled message', () => {
    const lock = baseLock();
    (lock.packages['node_modules/miniflare'] as { dependencies: Json }).dependencies.sharp = '0.35.5';
    expect(JSON.stringify(lock), 'the plant did not land').toContain('"sharp":"0.35.5"');
    expect(sharpOverrideVerdict(basePkg(), lock)).toEqual(['the sharp override is now redundant: remove it (R-2026-10-07 GL)']);
  });

  test('plant — a caret spec above the fix (^0.35.6) is read as at or above it, and the override is redundant', () => {
    const lock = baseLock();
    (lock.packages['node_modules/miniflare'] as { dependencies: Json }).dependencies.sharp = '^0.35.6';
    expect(JSON.stringify(lock), 'the plant did not land').toContain('^0.35.6');
    expect(sharpOverrideVerdict(basePkg(), lock)).toEqual(['the sharp override is now redundant: remove it (R-2026-10-07 GL)']);
  });

  test('plant — a second package that still pins sharp below the fix keeps the override needed, whatever miniflare says', () => {
    const lock = baseLock();
    (lock.packages['node_modules/miniflare'] as { dependencies: Json }).dependencies.sharp = '0.35.5';
    lock.packages['node_modules/another'] = { version: '1.0.0', optionalDependencies: { sharp: '0.35.4' } };
    expect(Object.keys(lock.packages), 'the second declarer did not land').toContain('node_modules/another');
    expect(sharpOverrideVerdict(basePkg(), lock), 'a second old pin was ignored: the override would be called redundant while it still works').toEqual([]);
  });

  test('plant — nothing declaring sharp at all makes the override redundant', () => {
    const lock = baseLock();
    delete (lock.packages['node_modules/miniflare'] as { dependencies?: Json }).dependencies;
    expect(declarers(lock.packages), 'the plant did not remove the declarer').toEqual([]);
    expect(sharpOverrideVerdict(basePkg(), lock)).toEqual(['the sharp override is now redundant: remove it (R-2026-10-07 GL)']);
  });

  test('plant — the override gone while this guard remains is rejected, naming the two ways out', () => {
    const verdict = sharpOverrideVerdict({}, baseLock());
    expect(verdict).toHaveLength(1);
    expect(verdict[0], 'the message does not name both ways out').toContain('delete this file in the same change, or restore the override');
  });

  test('plant — an override that does not reach the fix (0.35.4) is rejected', () => {
    const pkg = { overrides: { sharp: '0.35.4' } };
    const verdict = sharpOverrideVerdict(pkg, baseLock());
    expect(verdict).toHaveLength(1);
    expect(verdict[0]).toContain('does not reach the fix');
  });

  test('plant — a spec the reader cannot parse (>=0.35.0) is a loud rejection, never read as clean', () => {
    const lock = baseLock();
    (lock.packages['node_modules/miniflare'] as { dependencies: Json }).dependencies.sharp = '>=0.35.0';
    const verdict = sharpOverrideVerdict(basePkg(), lock);
    expect(verdict, 'an unparseable spec was waved through').toHaveLength(1);
    expect(verdict[0]).toContain('cannot read this sharp spec');
    expect(verdict[0]).toContain('node_modules/miniflare');
  });

  test('anti-vacuity — a lockfile with no packages fails by reading nothing, not by reading clean', () => {
    for (const lock of [{}, { packages: {} }, { packages: null }] as Json[]) {
      const verdict = sharpOverrideVerdict(basePkg(), lock);
      expect(verdict, `${JSON.stringify(lock)} was called clean`).toHaveLength(1);
      expect(verdict[0]).toContain('nothing was read');
    }
  });

  test('anti-vacuity — the reader sees the real lockfile: a large package set that includes wrangler and miniflare', () => {
    const packages = readJson('package-lock.json').packages as Record<string, Json>;
    expect(Object.keys(packages).length, 'the lockfile reader found almost nothing').toBeGreaterThan(100);
    expect(Object.keys(packages), 'wrangler is a root devDependency and must be in the lockfile').toContain('node_modules/wrangler');
    expect(Object.keys(packages), 'miniflare is what pins sharp and must be in the lockfile').toContain('node_modules/miniflare');
  });
});
