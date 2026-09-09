import { describe, expect, test } from 'vitest';
import { sql } from '../setup/db.js';
import FIXTURE from '../../packages/fixtures/audit-log-columns.json';

/**
 * THE AUTHORITATIVE LEG of CTO condition (1): app.audit_log's live column list,
 * read from information_schema, equals the shared fixture exactly.
 *
 * Its sibling, tests/compliance/audit_log_no_identity_columns.test.ts, parses the
 * migration text statically. This one reads the catalogue, so it catches a column
 * introduced by any route the parser cannot see.
 *
 * ON THE ONE-BLOCK RULE. .claude/rules/test-conventions.md section 7 says two
 * derivation sites fire inside ONE test.each body, never two blocks. These two
 * cannot: they live in different vitest projects and one of them has no database.
 * The deviation is deliberate and it satisfies section 7's actual RATIONALE --
 * "two blocks can be edited apart and drift while both stay green" -- because
 * both import packages/fixtures/audit-log-columns.json rather than restating it.
 * Drift requires editing that one file, which reddens both. The link is CODE, not
 * a comment claiming a link; see section 8 of the rules file.
 */
describe('audit log column list', () => {
  test('the live column list equals the fixture exactly, in order', async () => {
    const rows = await sql()<{ column_name: string }[]>`
      select column_name
        from information_schema.columns
       where table_schema = 'app' and table_name = 'audit_log'
       order by ordinal_position
    `;
    expect(rows.length, 'app.audit_log not found — the assertion would be vacuous').toBeGreaterThan(0);
    expect(rows.map((r) => r.column_name)).toEqual(FIXTURE.columns);
  });

  test('no forbidden identity-bearing column exists on the audit log', async () => {
    const rows = await sql()<{ column_name: string }[]>`
      select column_name
        from information_schema.columns
       where table_schema = 'app' and table_name = 'audit_log'
         and column_name = any(${[...FIXTURE.forbidden]})
    `;
    expect(rows.map((r) => r.column_name), 'identity-bearing columns on app.audit_log').toEqual([]);
  });

  test('the event stream carries no identity-bearing column either', async () => {
    // The decision bans personal data from the audit log AND the event stream.
    // ward_status_event is not covered by the fixture's exact list, so the
    // forbidden-name check is what covers it.
    const rows = await sql()<{ column_name: string }[]>`
      select column_name
        from information_schema.columns
       where table_schema = 'app' and table_name = 'ward_status_event'
         and column_name = any(${[...FIXTURE.forbidden]})
    `;
    expect(rows.map((r) => r.column_name), 'identity-bearing columns on app.ward_status_event').toEqual([]);
  });
});
