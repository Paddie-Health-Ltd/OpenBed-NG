import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './_scratch.js';

/**
 * DOWN-MIGRATION SYMMETRY, asserted statically.
 *
 * Lives in the `compliance` project rather than `db` -- a deviation from the
 * plan, and the reason is that it needs no database. Putting it here means it
 * still blocks a merge when the database job is unavailable, and it runs in
 * milliseconds.
 *
 * The property is not "every down migration is correct" -- no static check can
 * establish that. It is that every forward migration HAS a reversal, that the
 * reversal mentions what the forward created, and that the ledger row is
 * accounted for. Those are the failures that happen in practice, because a down
 * migration is written last and tested least.
 */

const MIG_DIR = join(REPO_ROOT, 'database', 'migrations');

const forwards = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .sort();

describe('down migration symmetry', () => {
  test('the corpus is non-empty — the guard is not vacuous', () => {
    expect(forwards.length).toBeGreaterThan(10);
  });

  test('migration numbers are unique and contiguous from 001', () => {
    const numbers = forwards.map((f) => Number.parseInt(f.slice(0, 3), 10));
    expect(new Set(numbers).size, 'duplicate migration numbers').toBe(numbers.length);
    expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
  });

  test.each(forwards)('%s has a paired .down.sql', (f) => {
    const down = join(MIG_DIR, f.replace(/\.sql$/, '.down.sql'));
    expect(() => readFileSync(down, 'utf8')).not.toThrow();
  });

  test.each(forwards)('%s — every table it CREATEs is DROPped by its reversal', (f) => {
    const fwd = readFileSync(join(MIG_DIR, f), 'utf8');
    const down = readFileSync(join(MIG_DIR, f.replace(/\.sql$/, '.down.sql')), 'utf8');

    const created = [...fwd.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+\.[a-z_]+)/gi)]
      .map((m) => (m[1] ?? '').toLowerCase());

    const missing = created.filter((t) => {
      const bare = t.split('.')[1] ?? t;
      return !new RegExp(`DROP TABLE[^;]*\\b${bare}\\b`, 'i').test(down);
    });

    expect(missing, `${f} creates tables its reversal does not drop`).toEqual([]);
  });

  test.each(forwards)('%s — ledger row is written forward and accounted for in reverse', (f) => {
    const fwd = readFileSync(join(MIG_DIR, f), 'utf8');
    const down = readFileSync(join(MIG_DIR, f.replace(/\.sql$/, '.down.sql')), 'utf8');

    expect(fwd, `${f} does not register itself`).toContain(`VALUES ('${f}'`);

    // 001 IS A NAMED EXCEPTION, and it is a real one rather than a carve-out for
    // convenience: 001 CREATES app.schema_migrations, so its reversal DROPS the
    // ledger table itself. Deleting a row from a table it is about to drop would
    // be noise, and requiring it would be requiring a wrong thing.
    if (f.startsWith('001_')) {
      expect(down, '001 reversal must drop the ledger table it created').toMatch(/DROP TABLE IF EXISTS app\.schema_migrations/);
      return;
    }
    expect(down, `${f} reversal does not remove its ledger row`).toContain(`DELETE FROM app.schema_migrations WHERE filename = '${f}'`);
  });

  test('no forward migration uses DROP TABLE ... CASCADE unannotated', () => {
    // Overlaps scripts/lint_no_drop_cascade.sh on purpose. The lint runs in the
    // migration-lint job; this runs in compliance-tests. Two independent jobs
    // means a single job being accidentally removed from branch protection does
    // not silently remove the control.
    const offenders: string[] = [];
    for (const f of forwards) {
      const content = readFileSync(join(MIG_DIR, f), 'utf8');
      for (const [i, line] of content.split('\n').entries()) {
        if (/DROP\s+TABLE\s+.*CASCADE/i.test(line) && !/OPENBED-CASCADE-OVERRIDE/.test(line)) {
          offenders.push(`${f}:${i + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
