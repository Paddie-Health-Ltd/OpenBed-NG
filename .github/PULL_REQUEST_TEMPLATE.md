<!--
  Delete whatever does not apply. The one line that is NOT optional is the
  runbook line below, and only when this change touches database/migrations/.
-->

## What this changes, and why

## Runbook expectations this migration changes

<!--
  REQUIRED when this pull request touches `database/migrations/`. Delete this
  whole section when it does not.

  Answer with the SECTIONS, or with "none, because <reason>". An empty answer,
  or a deleted section on a change that does add a migration, is the defect this
  line exists to catch.

  WHY IT IS HERE (R-2026-09-21-50). Step 5 of
  `docs/runbook-supabase-project-creation.md` has carried a restate-in-the-same-
  change rule since 2026-09-14. Migration 018 was merged in #61 and restated
  nothing -- leaving the runbook telling the founder that a correct dry run
  prints `0 migration(s) pending.` while a correct dry run printed 018, and
  leaving sections 6 and 10 asserting, as verified state, the exact two things
  018 removes. The rule was not enough on its own, because nothing asked.

  `tests/compliance/runbook_migration_expectation.test.ts` derives section 5's
  expectation mechanically. Sections 6 and 10 are HOSTED readings and cannot be
  derived from this repository at all -- this question is the only thing that
  reaches them.
-->

Runbook expectations this migration changes:

## Standard O — RED-DISPOSITION ATTESTATION

```
Invocation : 
DB         : fresh per-run (supabase db reset + run_migrations.sh + seed.sh this run)
collected= ran= passed= failed= errored= skipped=
Disposition: 
```

## Standard P — stopping rule and behavioural ledger

<!-- Required when the deliverable IS a control. -->

**Behavioural question asked:**

**Stopping rule:**

| control | question asked | tracked off-diff file re-derived against | planted-wrong value | reported diff |
|---|---|---|---|---|
