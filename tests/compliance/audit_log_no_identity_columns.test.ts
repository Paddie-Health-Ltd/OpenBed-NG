import { describe, expect, test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runLint, withScratch, copyMigrations, place, REPO_ROOT } from './_scratch.js';
import FIXTURE from '../../packages/fixtures/audit-log-columns.json';

/**
 * GUARD OVER A GUARD -- scripts/lint_audit_log_columns.sh.
 *
 * CTO condition (1) of the ward-level identity decision: the audit log must
 * contain no identity-bearing column. An `ip_address` is personal data in its own
 * right, so an audit row capturing one reintroduces exactly what the design
 * removed -- through a column nobody flagged.
 *
 * WHY THIS GUARD EXISTS AS A PATTERN AND NOT A ONE-OFF. Three controls were
 * walked around by a sibling field in a single week: a `blood_status_at` column
 * would have escaped a guard keyed to the literal `updated_at`; a distinct
 * `blood_status` type would have escaped the `tri_state` guard; an `ip_address`
 * column would escape everything. The answer is an EXACT column list on every
 * surface that must not silently gain a column -- `ward_public`,
 * `facility_public`, and this.
 *
 * CLASSIFICATION (Clause 5): GUARD-AHEAD-OF-SUBJECT. It executes and is
 * non-vacuous over the real migrations today, but the audit WRITER it ultimately
 * protects arrives in Bundle 3. Reclassify to LIVE as part of that bundle.
 *
 * NOT ASSERTED HERE, deliberately: the CONTENTS of old_value / new_value. A
 * column-list guard is structurally blind to a jsonb payload, so
 * `new_value->>'ip'` passes this file. The controls for that are the 256-char
 * CHECK constraints in migration 005 and the Bundle 3 writer, which builds the
 * object server-side from enums. A reader who assumed condition (1) covered it
 * would be wrong, so it is said plainly rather than left to be discovered.
 */

const LINT = 'lint_audit_log_columns.sh';
const MIGRATION = 'database/migrations/005_app_audit_referral_outbox_tables.sql';

/** Copies the real corpus, then rewrites one line of the audit_log block. */
function plantInAuditBlock(root: string, find: string, replace: string): void {
  copyMigrations(root);
  place(root, 'packages/fixtures/audit-log-columns.json', readFileSync(join(REPO_ROOT, 'packages/fixtures/audit-log-columns.json'), 'utf8'));
  const target = join(root, MIGRATION);
  const src = readFileSync(target, 'utf8');
  if (!src.includes(find)) throw new Error(`plant anchor not found: ${find}`);
  writeFileSync(target, src.replace(find, replace), 'utf8');
}

describe('audit log has no identity-bearing column', () => {
  test('real migration corpus is accepted', () => {
    const res = runLint(LINT, REPO_ROOT);
    expect(res.status, res.stdout).toBe(0);
    expect(res.stdout).toContain('PASS');
  });

  test('the fixture holds the nine expected columns', () => {
    // Anti-vacuity on the fixture itself: a guard reading an empty list would
    // accept anything while looking exactly like this one.
    expect(FIXTURE.columns).toEqual([
      'id', 'facility_id', 'ward_category', 'action',
      'old_value', 'new_value', 'version', 'occurred_at', 'session_id',
    ]);
    expect(FIXTURE.forbidden.length).toBeGreaterThan(10);
  });

  test.each([
    ['ip_address', '    session_id    uuid,', '    session_id    uuid,\n    ip_address    text,'],
    ['user_agent', '    session_id    uuid,', '    session_id    uuid,\n    user_agent    text,'],
    ['a reintroduced actor_id', '    session_id    uuid,', '    session_id    uuid,\n    actor_id      uuid,'],
    ['a reintroduced detail jsonb', '    session_id    uuid,', '    session_id    uuid,\n    detail        jsonb,'],
  ])('plant — %s on the audit table is rejected', (_name, find, replace) => {
    withScratch((root) => {
      plantInAuditBlock(root, find, replace);
      const res = runLint(LINT, root);
      expect(res.status, `plant was accepted:\n${res.stdout}`).toBe(1);
    });
  });

  test('plant — a SECOND CREATE TABLE app.audit_log block is refused, not silently merged', () => {
    // ACTUAL is assigned in the extraction loop rather than appended, so with two
    // blocks the last one silently wins and a forbidden column in the FIRST would
    // pass unexamined. Appending would be the wrong fix -- a corpus with two
    // `CREATE TABLE app.audit_log` statements is already broken, because the
    // second cannot apply. So it is a loud error.
    //
    // The planted second block is DELIBERATELY CLEAN, matching the fixture
    // exactly. If the guard merged the two it would find no column discrepancy
    // and report success; only the block count can catch this.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'packages/fixtures/audit-log-columns.json', readFileSync(join(REPO_ROOT, 'packages/fixtures/audit-log-columns.json'), 'utf8'));
      place(root, 'database/migrations/014_plant.sql',
        `-- ===\n-- 014_plant.sql\n-- Idempotency: n/a\n-- ===\nCREATE TABLE IF NOT EXISTS app.audit_log (\n` +
        FIXTURE.columns.map((c) => `    ${c} text`).join(',\n') +
        `\n);\nVALUES ('014_plant.sql')\n`);
      const res = runLint(LINT, root);
      expect(res.status, `a second audit_log definition was accepted:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the guard did not name the duplicate-block problem').toContain('the column list would be taken from whichever came last');
    });
  });

  test('anti-vacuity — a missing migration directory FAILS, and names itself', () => {
    // This guard had no plant for its `[ -d "$MIG_DIR" ]` leg at all. Deleting
    // that leg leaves the fixture check exiting 2 for a different reason, so the
    // status cannot tell them apart; only the message can.
    withScratch((root) => {
      place(root, 'unrelated.txt', 'x');
      const res = runLint(LINT, root);
      expect(res.status, `a missing corpus did not fail loudly:\n${res.stdout}`).toBe(2);
      expect(res.stdout, 'the missing-directory refusal did not name itself').toContain('no migration directory at');
    });
  });

  test('plant — Leg 2 in ISOLATION: a forbidden name that set-equality ACCEPTS', () => {
    // THE LEG THAT WAS MISSING, and the reason matters more than the leg.
    //
    // The four plants above all assert `toBe(1)` only, and each adds a column
    // that is ALSO absent from the fixture -- so Leg 1 (set equality) raises
    // first and the exit status is 1 whether or not Leg 2 works at all. Stub
    // `list_has_line` to `return 1` and every one of them stays green. The
    // forbidden-name check was therefore untested in the direction it exists for.
    //
    // Here the forbidden name is added to BOTH the migration and the fixture, so
    // equality PASSES and only Leg 2 can produce the failure. Asserted on the
    // message, not merely on the status, because the status alone cannot say
    // which leg fired.
    withScratch((root) => {
      copyMigrations(root);
      const widened = {
        ...FIXTURE,
        columns: [...FIXTURE.columns, 'ip_address'],
      };
      place(root, 'packages/fixtures/audit-log-columns.json', JSON.stringify(widened, null, 2));
      const target = join(root, MIGRATION);
      const src = readFileSync(target, 'utf8');
      writeFileSync(target, src.replace('    session_id    uuid,', '    session_id    uuid,\n    ip_address    text,'), 'utf8');

      const res = runLint(LINT, root);
      expect(res.status, `a forbidden column survived once equality was satisfied:\n${res.stdout}`).toBe(1);
      expect(res.stdout, `Leg 2 did not fire -- the failure came from somewhere else:\n${res.stdout}`)
        .toContain("forbidden identity-bearing column 'ip_address'");
    });
  });

  test('plant — a column nobody forbade is rejected', () => {
    // THE PLANT THAT PROVES SET EQUALITY IS DOING THE WORK. `updated_by_email` is
    // on no forbidden list; only equality catches it. Without this leg the guard
    // would be a named-list check wearing an equality label.
    withScratch((root) => {
      plantInAuditBlock(root, '    session_id    uuid,', '    session_id    uuid,\n    updated_by_email text,');
      const res = runLint(LINT, root);
      expect(res.status, `an unforbidden column was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout).toContain('updated_by_email');
    });
  });

  test('plant — REMOVING ward_category is rejected', () => {
    // Equality catches shrink as well as growth. Without this leg the guard is a
    // containment check, and a column could be quietly dropped.
    withScratch((root) => {
      plantInAuditBlock(root, '    ward_category app.ward_category,', '');
      const res = runLint(LINT, root);
      expect(res.status, `a removed column was accepted:\n${res.stdout}`).toBe(1);
      expect(res.stdout).toContain('ward_category');
    });
  });

  test('plant — ALTER TABLE ... ADD COLUMN in a later migration is rejected', () => {
    // The future-014 vector. A parser aimed only at the CREATE TABLE block would
    // miss a column added by a subsequent migration.
    withScratch((root) => {
      copyMigrations(root);
      place(root, 'packages/fixtures/audit-log-columns.json', readFileSync(join(REPO_ROOT, 'packages/fixtures/audit-log-columns.json'), 'utf8'));
      place(root, 'database/migrations/014_plant.sql',
        `-- ===\n-- 014_plant.sql\n-- Idempotency: n/a\n-- ===\nALTER TABLE app.audit_log ADD COLUMN ip_address text;\nVALUES ('014_plant.sql')\n`);
      const res = runLint(LINT, root);
      expect(res.status, `an ALTER ... ADD COLUMN was accepted:\n${res.stdout}`).toBe(1);
    });
  });

  test('positive control — reordering the same columns is accepted', () => {
    // It is a SET check. A harmless reformat must not red, or people learn to
    // disable the guard rather than read it.
    withScratch((root) => {
      plantInAuditBlock(
        root,
        '    version       integer,\n\n    occurred_at   timestamptz NOT NULL DEFAULT now(),',
        '    occurred_at   timestamptz NOT NULL DEFAULT now(),\n\n    version       integer,',
      );
      const res = runLint(LINT, root);
      expect(res.status, `a pure reorder was rejected:\n${res.stdout}`).toBe(0);
    });
  });

  test('anti-vacuity — a corpus with no audit_log CREATE TABLE fails', () => {
    withScratch((root) => {
      place(root, 'packages/fixtures/audit-log-columns.json', readFileSync(join(REPO_ROOT, 'packages/fixtures/audit-log-columns.json'), 'utf8'));
      place(root, 'database/migrations/001_x.sql', 'select 1;');
      const res = runLint(LINT, root);
      expect(res.status, 'a corpus with no audit table reported clean').toBe(2);
    });
  });

  test('anti-vacuity — a missing fixture fails rather than allowing everything', () => {
    withScratch((root) => {
      copyMigrations(root);
      const res = runLint(LINT, root);
      expect(res.status, 'a missing fixture reported clean').toBe(2);
    });
  });
});
