import { gate, acceptingEffectiveForWard, type WardCategory, type TriState } from '@openbed/gate';

/**
 * Bundle 1 stub for the public dashboard.
 *
 * WHY THIS EXISTS NOW rather than in Bundle 4, where the real dashboard is built.
 *
 * Three merge-blocking guards operate on the BUILT client bundle:
 *   - scripts/lint_no_service_role_in_bundle.sh
 *   - scripts/lint_no_updated_at_filter.sh
 *   - the ESLint no-restricted-syntax duty-flag rule in eslint.config.mjs
 *
 * With no app to build, the CI job that runs them is `skipped` -- and GitHub
 * counts a skipped required check as PASSING. The guards would report green from
 * commit one while examining nothing, which is worse than not having them,
 * because everyone would believe they were covered.
 *
 * So this file is deliberately small and deliberately real: it imports the gate,
 * calls it, and renders the result. That gives the ESLint rule a genuine duty-flag
 * call site to protect and gives the greps a genuine bundle to scan.
 *
 * CLASSIFICATION under Clause 5 of .claude/rules/code-pipeline.md: the two dist
 * greps are GUARD-AHEAD-OF-SUBJECT. They execute and are non-vacuous, but the
 * code they are aimed at -- a real snapshot fetch and a real freshness
 * computation -- arrives in Bundle 4. They become LIVE as part of that bundle,
 * not as a later tidy-up.
 */

interface StubWard {
  readonly category: WardCategory;
  readonly bedCount: number | null;
  readonly accepting: boolean;
}

/**
 * Duty cover as the snapshot will carry it.
 *
 * THREE STATES. Note there is no boolean anywhere in this file: `'UNKNOWN'` is
 * the day-one value for every facility, and any code that treats it as falsy
 * renders every hospital in Lagos as closed.
 */
const stubFlags: { anaesthetist: TriState; obstetrician: TriState; paediatrician: TriState } = {
  anaesthetist: 'UNKNOWN',
  obstetrician: 'UNKNOWN',
  paediatrician: 'UNKNOWN',
};

const stubWards: StubWard[] = [
  { category: 'A_AND_E', bedCount: 4, accepting: true },
  { category: 'THEATRE', bedCount: 2, accepting: true },
];

function render(): void {
  const root = document.getElementById('app');
  if (!root) return;

  const list = document.createElement('ul');

  for (const ward of stubWards) {
    const reason = gate(
      ward.category,
      stubFlags.anaesthetist,
      stubFlags.obstetrician,
      stubFlags.paediatrician,
    );
    const open = acceptingEffectiveForWard('OFFERED', ward.accepting, reason);

    const item = document.createElement('li');
    // `bedCount === null` means never reported, and is rendered as such rather
    // than as zero. Publishing "0 beds" for a ward nobody has updated states a
    // claim the facility never made.
    const beds = ward.bedCount === null ? 'not yet reporting' : `${ward.bedCount} beds`;
    item.textContent = `${ward.category}: ${beds}${open ? '' : ' — not accepting'}${reason ? ` (${reason})` : ''}`;
    list.appendChild(item);
  }

  root.replaceChildren(list);
}

render();

// ---------------------------------------------------------------------------
// DELIBERATE PROBE — REVERTED IN THE NEXT COMMIT.
// A finding F2 violation: `!` on a duty flag. The ESLint no-restricted-syntax
// rule must reject this, reddening `repo-lint`, so that we can observe whether a
// red REQUIRED check actually blocks a merge. Until now that property has only
// been demonstrated locally; Clause 5 says a machinery claim carries its probe.
// ---------------------------------------------------------------------------
export const probeClosed = !stubFlags.anaesthetist;
