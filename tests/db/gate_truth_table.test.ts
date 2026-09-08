import { describe, expect, test } from 'vitest';
import { sql } from '../setup/db.js';
import {
  gate,
  acceptingEffective,
  type GateReason,
  type TriState,
  type WardCategory,
} from '../../packages/gate/src/gate.js';
import TRUTH_TABLE from '../../packages/fixtures/truth-table.json';

/**
 * THE 48-ROW TRUTH TABLE -- finding F2's contract.
 *
 * The duty-cover gate is implemented TWICE: once in SQL (app.gate(), migration
 * 006) and once in TypeScript (packages/gate/src/gate.ts). That is a deliberate
 * duplication -- the server derives the gate for the public projection, and the
 * client explains the result without a round trip -- and therefore a standing
 * drift risk.
 *
 * The drift is closed STRUCTURALLY, not by discipline. There is ONE fixture and
 * ONE `test.each` block, and both call sites fire inside it. Two blocks over the
 * same fixture could be edited apart, skipped apart, or reordered, and could
 * drift while both stayed green. One block makes running one side without the
 * other impossible to express.
 *
 * tests/compliance/truth_table_single_source.test.ts asserts that this structure
 * still holds and that no second copy of the table exists anywhere.
 *
 * NOT ASSERTED HERE, deliberately: that the fixture's expected values are
 * themselves correct. No test can establish that -- the fixture IS the
 * specification, transcribed from the kickoff's prose ("anaesthetist off duty
 * closes Theatre and Surgical, paediatrician closes NICU/SCBU, obstetrician
 * closes Maternity"). What these tests establish is that two independent
 * implementations both satisfy it, which is the property that decays over time.
 * The fixture's correctness is a review obligation, discharged once, at the
 * commit that introduced it.
 */

interface TruthRow {
  category: WardCategory;
  anaesthetist: TriState;
  obstetrician: TriState;
  paediatrician: TriState;
  accepting: boolean;
  expected_gated_by: GateReason | null;
  expected_accepting_effective: boolean;
}

const ROWS = TRUTH_TABLE as TruthRow[];

const CATEGORIES: WardCategory[] = [
  'A_AND_E', 'ICU', 'THEATRE', 'SURGICAL', 'MATERNITY', 'NICU', 'SCBU', 'GENERAL_MEDICAL',
];
const STATES: TriState[] = ['UNKNOWN', 'YES', 'NO'];

/** Calls the SQL derivation site. */
async function sqlGate(
  category: WardCategory,
  anaesthetist: TriState,
  obstetrician: TriState,
  paediatrician: TriState,
): Promise<GateReason | null> {
  const rows = await sql()<{ g: GateReason | null }[]>`
    select app.gate(
      ${category}::app.ward_category,
      ${anaesthetist}::app.tri_state,
      ${obstetrician}::app.tri_state,
      ${paediatrician}::app.tri_state
    ) as g
  `;
  return rows[0]?.g ?? null;
}

describe('gate truth table', () => {
  /**
   * THE FIRST ASSERTION IN THE FILE, AND ITS NAME IS THE CONTRACT.
   *
   * Named so the CI failure explains itself to someone who has never read the
   * schema. On day one no facility has touched a duty flag, so every flag in the
   * system is 'UNKNOWN'. If UNKNOWN were ever treated as falsy -- the natural
   * shape, `if (!anaesthetistOnDuty)` -- this single assertion is what goes red,
   * instead of every hospital in Lagos rendering as closed.
   *
   * Do not reword this test name. It is cited by name in the kickoff document,
   * in .claude/rules/test-conventions.md, and in the Bundle 1 definition of done.
   */
  test('a never-set flag must not close the whole city — all flags UNKNOWN + accepting=true yields accepting_effective=true, gated_by=null', async () => {
    for (const category of CATEGORIES) {
      const sqlReason = await sqlGate(category, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN');
      const tsReason = gate(category, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN');

      expect(sqlReason, `SQL gated ${category} on an all-UNKNOWN facility`).toBeNull();
      expect(tsReason, `TypeScript gated ${category} on an all-UNKNOWN facility`).toBeNull();
      expect(
        acceptingEffective(true, tsReason),
        `${category} claimed accepting=true and was not published as accepting`,
      ).toBe(true);
    }
  });

  /**
   * THE 48 ROWS. One block; both derivation sites; identical expected output.
   *
   * Every assertion below names which SIDE disagreed, because "the gate is
   * wrong" and "the gate is wrong on one side only" are different defects and
   * only the second one is a drift.
   */
  test.each(ROWS)(
    '$category | anaesthetist=$anaesthetist obstetrician=$obstetrician paediatrician=$paediatrician | accepting=$accepting',
    async (row) => {
      const sqlReason = await sqlGate(
        row.category, row.anaesthetist, row.obstetrician, row.paediatrician,
      );
      const tsReason = gate(
        row.category, row.anaesthetist, row.obstetrician, row.paediatrician,
      );

      expect(sqlReason, 'SQL app.gate() disagreed with the fixture').toBe(row.expected_gated_by);
      expect(tsReason, 'TypeScript gate() disagreed with the fixture').toBe(row.expected_gated_by);

      expect(
        acceptingEffective(row.accepting, tsReason),
        'accepting_effective disagreed with the fixture',
      ).toBe(row.expected_accepting_effective);
    },
  );

  test('the fixture is exactly the specified 3 x 8 x 2 = 48 rows', () => {
    expect(ROWS).toHaveLength(48);
    const keys = new Set(
      ROWS.map((r) => `${r.category}|${r.anaesthetist}|${r.obstetrician}|${r.paediatrician}|${r.accepting}`),
    );
    expect(keys.size, 'the fixture contains duplicate rows').toBe(48);
  });

  /**
   * THE EXHAUSTIVE SWEEP -- 3^3 x 8 x 2 = 432 cases.
   *
   * WHY THIS EXISTS ON TOP OF THE 48. The kickoff specifies "3 flag states x 8
   * categories x 2 claim values = 48", and that arithmetic only closes if two of
   * the three flags are held constant -- which the kickoff does not say. Held at
   * UNKNOWN, as the fixture does, the CROSS-GATE cases are never exercised: the
   * 48 rows never once ask whether paediatrician='NO' wrongly closes Theatre.
   * That is a plausible bug (one mistyped branch in a CASE) and the contract
   * cannot see it.
   *
   * So the 48 ship exactly as specified, because they are the contract and the
   * definition of done cites them literally, and this covers the hole they
   * cannot. It costs one loop.
   */
  test('exhaustive sweep — 432 combinations agree across both derivation sites', async () => {
    const disagreements: string[] = [];

    for (const category of CATEGORIES) {
      for (const anaesthetist of STATES) {
        for (const obstetrician of STATES) {
          for (const paediatrician of STATES) {
            const sqlReason = await sqlGate(category, anaesthetist, obstetrician, paediatrician);
            const tsReason = gate(category, anaesthetist, obstetrician, paediatrician);

            if (sqlReason !== tsReason) {
              disagreements.push(
                `${category} a=${anaesthetist} o=${obstetrician} p=${paediatrician}: ` +
                  `SQL=${String(sqlReason)} TS=${String(tsReason)}`,
              );
            }

            // THE GATE REDUCES ONLY. Checked for both claim values at every
            // combination: the only route to a published `true` is the ward
            // having claimed `true`. No arrangement of duty flags may promote a
            // ward that said it was not accepting.
            expect(
              acceptingEffective(false, tsReason),
              `${category} was promoted despite the ward claiming accepting=false`,
            ).toBe(false);
          }
        }
      }
    }

    expect(disagreements, 'SQL and TypeScript derivations disagree').toEqual([]);
  });

  /**
   * A NULL duty flag must not gate.
   *
   * The columns are NOT NULL, so this cannot arise from a direct read -- but it
   * arises immediately from the LEFT JOIN in app.gate_for_facility() when a
   * facility has no facility_ops row. The two implementations must agree there
   * too, and they agree for different-looking reasons: SQL uses
   * `IS NOT DISTINCT FROM 'NO'` (total, false for NULL) and TypeScript uses
   * `=== 'NO'` (also false for null). A bare `= 'NO'` in SQL would return NULL,
   * skip the CASE arm, and coincidentally give the same answer here -- while
   * behaving differently inside a WHERE clause, which is the actual trap.
   */
  test('missing-context — a NULL duty flag is not a NO on either side', async () => {
    const rows = await sql()<{ g: GateReason | null }[]>`
      select app.gate('THEATRE'::app.ward_category, NULL, NULL, NULL) as g
    `;
    expect(rows[0]?.g ?? null).toBeNull();
    expect(gate('THEATRE', null as unknown as TriState, null as unknown as TriState, null as unknown as TriState)).toBeNull();
  });
});
