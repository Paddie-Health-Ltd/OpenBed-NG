# Test Conventions (OpenBed-NG)

**Version 1.0 — 2026-09-08. Sunset review 2026-12-07 (+90 days).**

This file exists because these conventions were **ported by hand** from a
different project on a different stack (Python/pytest against a clinical
Postgres, in PH-Doc-Assistant-v1). Nothing is shared between the two
repositories — not a fixture, not a helper, not a line of code. Only the
*pattern* crossed over.

A pattern that lives only in the head of whoever ported it decays on the first
contribution by anyone else. So it is written down here as a rule, and the
compliance suite enforces the parts that can be enforced mechanically.

---

## 1. Test projects

Two vitest projects, and the split is about what they need, not what they cover.

| Project | Needs | Location | Runs in CI as |
|---|---|---|---|
| `db` | Postgres **and** PostgREST, via `supabase start` | `tests/db/` | `db-tests` |
| `compliance` | nothing but the filesystem | `tests/compliance/` | `compliance-tests` |

**Neither job is ever paths-filtered.** GitHub counts a skipped required check as
passing, so a required check with an `if:` on a paths filter is not a gate on
the pull requests it skips — it is a gate that reports success on exactly the
changes it did not examine. `tests/compliance/ci_required_checks_not_paths_filtered.test.ts`
enforces this mechanically, because it is the easiest thing in the repository to
regress and the hardest to notice.

---

## 2. The plant-then-assert contract

**Every compliance guard ships three legs. A guard with fewer is not merged.**

1. **PLANT.** Construct the false-green the guard exists to catch, feed it to the
   checker, and assert the checker **rejects** it. One plant per distinct failure
   mode, not one per guard.
2. **ACCEPT.** Assert the checker **accepts** the real artefact as it stands.
3. **ANTI-VACUITY.** Assert the checker **fails** when its input corpus is empty.

The reason all three are required:

> A guard that rejects everything is a rubber stamp. A guard that accepts
> everything is the defect it was written to close. And a guard that silently
> scanned zero files reports the same green as a guard that scanned the whole
> repository and found nothing.

The third leg is the one people leave out, and it is the one that catches a
`find` whose path stopped resolving after a directory rename.

**Plants must be constructed, never committed.** Write the planted artefact into
a temporary directory and point the checker at it. This is why every lint script
in `scripts/` takes an optional root directory as `$1` — that argument exists so
a test can aim the script at a scratch tree. Do not remove it because it looks
unused; it is the seam the whole contract hangs on.

---

## 3. Assert on parsed identity, never on a count of matching lines

`grep -c 'timeout-minutes' ci.yml == 7` is complete on the **presence** axis and
blind on two others:

- **Value.** Seven occurrences of `timeout-minutes: 1` satisfy it, and would
  cancel every job.
- **Identity.** Seven timeouts on the *wrong seven jobs* satisfy it after a
  rename.

So parse the artefact — YAML with `js-yaml`, SQL with a real scan, TypeScript
with the source text keyed to identifiers — and assert against **named** things.
Where a checked-in literal table of expected names is used, that is deliberate:
it decays loudly, because `set(parsed) === set(table)` reddens the moment
something is added or renamed. That is a feature, not a magic number.

---

## 4. Name what you are not asserting, and why

Every guard file carries a header comment. Where there is a control the file
deliberately does **not** implement, say so, in a block that begins:

```
NOT ASSERTED HERE, deliberately: <the control> — <why it is unbuildable here>.
```

Naming an unbuildable control as unbuildable is the discipline. Shipping it as a
test that appears to check it is theatre, and it is the specific defect Clause 4
of `.claude/rules/code-pipeline.md` exists to prevent.

Three live examples in this repository, all of which must stay named rather than
faked:

- The Supabase project's **region pin** (`af-south-1`) cannot be asserted from
  inside the repository at all.
- The **hosted** exposed-schemas list is a dashboard setting. The local
  `supabase/config.toml` is asserted; the hosted one is a runbook step.
- **Append-only enforcement behaves differently hosted than locally**, because
  Supabase's `postgres` role is superuser locally and is not hosted. The test can
  pass locally and the production behaviour still differ. That asymmetry belongs
  in the test's own header.

---

## 5. Test-name grammar

Test names are the failure message. Someone reads them at 2am with no context.

**Database and RLS tests** use this grammar, from the sibling project's
`test_*_rls.py` files:

| Shape | Example |
|---|---|
| `<actor> <action> succeeds` | `ward staff at their own facility publishes successfully` |
| `<actor> <action> rejected` | `anon insert into ward_public is rejected` |
| `cross-tenant <action> rejected` | `cross-tenant write from facility A to facility B is rejected` |
| `missing-context <action> rejected` | `missing-auth publish is rejected with 42501` |
| `<subject> symmetry static` | `down migration symmetry static — every forward has a reversal` |
| `<subject> regression` | `ward_public column list regression — frozen list unchanged` |

**Compliance guards** name the leg explicitly, so a partial port is visible in
the test list alone:

| Leg | Shape |
|---|---|
| PLANT | `plant — <the false-green> is rejected` |
| ACCEPT | `real <artefact> is accepted` |
| ANTI-VACUITY | `anti-vacuity — checker over an empty corpus fails` |

**One name is fixed and must not be reworded.** The first assertion in
`tests/db/gate_truth_table.test.ts` is:

> `a never-set flag must not close the whole city — all flags UNKNOWN + accepting=true yields accepting_effective=true, gated_by=null`

It is written to explain itself in a CI log to someone who has never read the
schema. That is the entire point of it.

---

## 6. Loud failure

**No silent `try/catch` that degrades into a skip.** Not on a seed failure, not
on a connection failure, not on a missing fixture.

A test that skips because it could not reach the database reports the same green
as a test that ran and passed. If a `db` test cannot connect, it must **fail**
and say what it could not reach. The whole point of the RLS negative suite is
that it is the only evidence the boundary holds; a suite that quietly declines to
run is worse than no suite, because it produces a green check.

The corollary for Standard O: `skipped` is one of the six counts precisely so
that green-by-skip is visible in the attestation rather than invisible in a
terminal summary.

---

## 7. Two derivation sites are asserted in one block, never two

Where a rule is implemented twice — once in SQL and once in TypeScript — the
fixture is a single JSON file and **both call sites fire inside one `test.each`
body**. Not two blocks over the same fixture; one block.

Two blocks can be edited apart, skipped apart, and can drift while both stay
green. One block makes running one side without the other structurally
impossible. `tests/compliance/truth_table_single_source.test.ts` asserts that
this structure holds and that no second literal copy of the table exists.

This applies to `app.gate()` / `packages/gate/src/gate.ts`, and to the
`lga_rollup` k-floor rule / `packages/gate/src/rollup.ts`.

**Assert the divergent cases, not only the agreeing ones.** The rollup's
`sum = 0` cell is the worked example: Postgres *throws* on division by zero
while JavaScript returns `NaN`, and `NaN <= 0.40` is `false`. So an unguarded
ratio makes SQL error and TypeScript silently suppress — the two layers
disagreeing, in opposite directions, with neither reporting a problem. That is
the same shape as the tri-state bug, and it is why the branch order is fixed in
the migration rather than left to the query author.

---

## 8. Free-text field for future porters

If you port another convention from PH-Doc-Assistant-v1, or invent one here, add
it to this file in the same pass — not to a commit message, not to a PR comment,
and not to your own memory of how it is done. If it is worth following twice it
is worth a paragraph here.

### Invented here: the shared-fixture link, when one block is impossible (2026-09-08)

Section 7 requires two derivation sites to fire inside ONE `test.each` body. Some
pairs cannot: they live in different vitest projects, and one of them has no
database. `app.audit_log`'s column list is the worked example — it is asserted
statically over the migration text in `compliance`, and over `information_schema`
in `db`.

**The rule for that case: both sides IMPORT one checked-in fixture, and neither
restates it.** That satisfies section 7's actual rationale — *two blocks can be
edited apart and drift while both stay green* — because drift then requires
editing the single file both of them read, which reddens both at once.

**The link must be CODE, not a comment claiming a link.** This is not a
hypothetical failure. Three places in this repository asserted, in the present
tense, that some other file kept a fixture and the catalogue in sync:
`packages/fixtures/public-relations.json`'s own comment,
`scripts/lint_from_allowlist.sh`, and the exposed-schemas note in
`tests/db/rls_anon_column_containment.test.ts`. **None of the three assertions
existed.** `tests/db/config_drift.test.ts` held a second literal copy of the names
and never imported the fixture. That is a Clause 5 defect — a mechanism present
and not reaching — and it was sitting inside the very pattern meant to prevent
drift. All three are now real imports.

If you add a fixture-backed guard, grep for the assertion you are about to claim
before you claim it.

Conventions deliberately **not** ported, so nobody re-derives them by accident:

- The `requires_real_db` fixture gating: here, a `db` test that cannot reach the
  database fails rather than skipping (§6). The sibling skips locally and runs in
  CI; this repository's `db:reset` makes a local run cheap enough that skipping
  is not worth the ambiguity it buys.
- Coverage thresholds. The sibling carries `--cov-fail-under`. Coverage on a
  repository that is almost entirely SQL and guards would measure the wrong
  thing, and a number nobody believes is worse than no number.
- The `sop-patches/` two-party rationale machinery. One implementer; nothing here
  could discharge it.
