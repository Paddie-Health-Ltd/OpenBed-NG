#!/usr/bin/env bash
# ============================================================
# scripts/commit.sh
# ============================================================
# THE ONLY ENTRY POINT FOR A COMMIT IN THIS REPOSITORY.
#
# WHY IT EXISTS. Twice on 2026-09-10 a commit landed on a red suite. Both times
# the guard reached and the verdict was correct; both times the process
# consuming the verdict did not act on it. The first fix was "I will check exit
# status rather than grep output". The second was "I will chain the gate to the
# commit". Both are HABITS, and the standard this repository is built on is that
# remembered fixes do not hold -- it is the same argument made against a
# pre-commit hook, against a comment claiming a cross-file link, and against
# every guard whose verdict something else must remember to consume.
#
# Two occurrences is a class. So the two-step sequence is removed rather than
# performed more carefully: there is one command, and the gate is the commit's
# PRECONDITION rather than a step someone runs before it. There is no ordering
# to get wrong because there is no second step to order.
#
# WHAT THIS IS NOT, and it is the same disclaimer scripts/gate.sh carries.
# IT IS NOT A CONTROL. Nothing makes anyone use it, and a bare `git commit`
# bypasses it completely. The controls remain GitHub secret-scanning push
# protection -- the PREVENTION control, enforced server-side at push time -- and
# the seven required checks on `main`. This file removes an ordering error. It
# does not close the hole that the ordering error lived in, and saying otherwise
# would be a Clause 5 claim that does not reach.
#
# ON --fast, AND WHY THE LOOPHOLE IS DELIBERATE. A documentation-only commit
# must not require a running Supabase stack. A tool that refuses ordinary input
# is disabled by the next person who hits it at 2am -- test-conventions.md
# section 2, the fourth way a leg goes wrong -- and a disabled tool enforces
# nothing at all. So --fast exists, and it is NEVER SILENT: it stamps a
# `Gate: fast (e2e not run)` trailer into the commit message, where it is
# permanent and greppable with `git log --grep`. A partial gate that leaves no
# trace is the defect; a partial gate that announces itself in the record is a
# documented choice.
#
# Usage: bash scripts/commit.sh [--fast] <git commit arguments...>
#   e.g. bash scripts/commit.sh -m "Subject" -m "Body"
#        bash scripts/commit.sh --fast -F /tmp/msg.txt
#        bash scripts/commit.sh --amend --no-edit
# Exit: 0 committed, 1 the gate failed (nothing committed), 2 usage.
# ============================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAST=0
if [ "${1:-}" = "--fast" ]; then
    FAST=1
    shift
fi

if [ "$#" -eq 0 ]; then
    echo "ERROR: no git commit arguments given -- nothing to commit" >&2
    echo "  Usage: bash scripts/commit.sh [--fast] <git commit arguments...>" >&2
    exit 2
fi

# Fail fast, BEFORE the gate. The full gate takes minutes; discovering an empty
# index afterwards wastes them and teaches the operator to run the gate
# separately "to save time", which is the two-step sequence coming back.
#
# --amend is the exception: amending a commit with an unchanged index is the
# normal way to fix a message, so an empty index is legitimate there.
AMENDING=0
for arg in "$@"; do
    case "$arg" in
        --amend) AMENDING=1 ;;
    esac
done

if [ "$AMENDING" -eq 0 ]; then
    idx=0
    git diff --cached --quiet || idx=$?
    case "$idx" in
        0)  echo "ERROR: nothing is staged -- the gate was not run and nothing was committed" >&2
            echo "  Stage the change first:  git add <paths>" >&2
            exit 2 ;;
        1)  ;;
        *)  echo "ERROR: git diff --cached exited $idx -- the staged-change check did not run" >&2
            exit 2 ;;
    esac
fi

echo "commit.sh: running the gate first. A commit is what happens AFTER it passes."
echo

# NO ARRAY HERE, AND THAT IS NOT STYLE. Under `set -u`, expanding an EMPTY array
# as "${arr[@]}" is an unbound-variable error on bash 3.2 -- which is the bash
# macOS ships, and therefore the bash this script runs under on the only machine
# that develops this repository. The first version used an array and died on the
# non---fast path, found by the plant in tests/compliance/commit_gate.test.ts
# before it ever reached a commit. Two branches have no such trap.
gst=0
if [ "$FAST" -eq 1 ]; then
    bash "$ROOT/scripts/gate.sh" --fast || gst=$?
else
    bash "$ROOT/scripts/gate.sh" || gst=$?
fi

if [ "$gst" -ne 0 ]; then
    echo
    echo "REFUSING: the gate did not pass -- NOTHING WAS COMMITTED."
    echo "  Fix the failing check. Do not run 'git commit' to get past this;"
    echo "  that is the exact sequence this script exists to make impossible."
    exit 1
fi

COMMIT_ARGS=("$@")
if [ "$FAST" -eq 1 ]; then
    echo
    echo "commit.sh: --fast was used. Stamping the trailer so the partial gate is on the record."
    COMMIT_ARGS+=(--trailer "Gate: fast (e2e not run)")
fi

echo
git commit "${COMMIT_ARGS[@]}"
