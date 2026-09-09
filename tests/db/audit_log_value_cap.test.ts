import { describe, expect, test } from 'vitest';
import { withRole } from '../setup/db.js';

/**
 * THE AUDIT VALUE CAP REJECTS. IT NEVER TRUNCATES.
 *
 * `old_value` and `new_value` are capped at 256 characters of serialised jsonb --
 * a SAFETY control, not a storage one. 256 holds
 * {"bed_count":4,"accepting":true} and does not hold a narrative, and a narrative
 * is where a patient enters a system that has none.
 *
 * WHY THIS FILE EXISTS WHEN THE SCHEMA IS ALREADY CORRECT. A CHECK violation
 * raises 23514 and Postgres never truncates on a CHECK, so the reject-loudly
 * property holds today without anything being added. What this file establishes
 * is that the constraints are actually PRESENT AND FIRING -- a cap that was
 * dropped in a later migration would leave every other test green.
 *
 * The real risk is not in the schema at all. It is in the Bundle 3 writer, which
 * will one day meet a value that does not fit and be tempted to make it fit. A
 * silently truncated audit value is a data-integrity failure that would NEVER GO
 * RED: the record looks complete and is wrong, and nothing downstream can tell.
 * The rule lives in migration 005's column comment and in the Self-Check
 * Protocol; this is its proof at the schema layer.
 *
 * NOT ASSERTED HERE, deliberately: that the writer does not truncate. No writer
 * exists yet. When it does, its own test must assert that an oversized value
 * propagates the error rather than being trimmed to fit.
 */

/**
 * Builds a JSON object whose **normalised jsonb** text is exactly `chars` long.
 *
 * THE ENVELOPE IS 9 CHARACTERS, NOT 8, AND THAT MATTERS BEYOND THIS TEST.
 * The CHECK is `length(new_value::text) <= 256` on a JSONB column, so it measures
 * the value AFTER Postgres normalises it -- and jsonb inserts a space after the
 * key's colon. `{"v":"x"}` on the way in is stored and rendered as `{"v": "x"}`.
 *
 * So a caller counting characters in its own JSON string is measuring something
 * slightly shorter than the constraint measures, and a payload that looks like it
 * fits can be rejected. Verified empirically rather than assumed:
 *   payload 246 -> normalised 255
 *   payload 247 -> normalised 256
 * The Bundle 3 writer must size against the normalised form, not its own string.
 */
function jsonWithNormalisedLength(chars: number): string {
  const ENVELOPE = 9; // {"v": ""}
  return JSON.stringify({ v: 'x'.repeat(Math.max(0, chars - ENVELOPE)) });
}

describe('audit log value cap', () => {
  test.each(['old_value', 'new_value'])(
    '%s over 256 characters is REJECTED with 23514, not truncated',
    async (column) => {
      const oversized = jsonWithNormalisedLength(300);

      await expect(
        withRole('postgres', null, async (tx) => {
          await tx.unsafe(`
            insert into app.audit_log (action, ${column})
            values ('test.cap', '${oversized}'::jsonb)
          `);
        }),
      ).rejects.toThrow(/audit_log_(old|new)_value_capped|check constraint/i);
    },
  );

  test.each(['old_value', 'new_value'])(
    'positive control — %s at exactly the 256-character boundary is accepted',
    async (column) => {
      // A guard that rejected everything would satisfy the tests above perfectly
      // while making the column unusable. The boundary is where that shows.
      const atLimit = jsonWithNormalisedLength(256);

      const stored = await withRole('postgres', null, async (tx) => {
        const rows = await tx.unsafe<{ n: number }[]>(`
          with ins as (
            insert into app.audit_log (action, ${column})
            values ('test.cap', '${atLimit}'::jsonb)
            returning ${column}
          )
          select length(${column}::text)::int as n from ins
        `);
        return rows[0]?.n ?? -1;
      });

      // Stored at full length. If this ever came back < 256, something truncated.
      expect(stored, 'the value was stored at a reduced length — something truncated').toBe(256);
    },
  );

  test('both cap constraints exist and are CHECK constraints', async () => {
    // Anti-vacuity. If a later migration dropped the caps, every assertion above
    // would still pass for oversized input only by accident of another error.
    const rows = await withRole('postgres', null, async (tx) =>
      tx.unsafe<{ conname: string }[]>(`
        select conname from pg_constraint
         where conrelid = 'app.audit_log'::regclass and contype = 'c'
           and conname like '%value_capped'
         order by conname
      `),
    );
    expect(rows.map((r) => r.conname)).toEqual([
      'audit_log_new_value_capped',
      'audit_log_old_value_capped',
    ]);
  });
});
