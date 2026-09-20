#!/usr/bin/env bash
# ============================================================
# scripts/deploy_pages.sh
# ============================================================
# DEPLOY THE PUBLIC DASHBOARD, AND REFUSE THE ACCIDENT (R-2026-09-20-30 A4).
#
# THE DEFECT THIS EXISTS FOR. The Pages project is direct-upload, so a deployment
# is whatever working tree someone ran wrangler from. Merging proves review;
# uploading proves deployment; nothing binds them. Production has already served
# five commits that existed in no remote branch and had passed no gate.
#
# WHAT IT REFUSES, each by name:
#   - a working tree with uncommitted changes -- the artifact would not be
#     identified by any commit;
#   - a HEAD that is not an ancestor of origin/main -- code that no pull request
#     merged;
#   - a directory that is not a git work tree -- then nothing can be checked at all.
#
# WHAT IT IS NOT, and this is the whole of its honesty (method note 12):
#   - IT IS NOT A CONTROL. It is LOCAL and DEFEATABLE: `npx wrangler pages deploy`
#     run by hand bypasses it completely, and so does editing this file. Nothing on
#     the Cloudflare side requires it. It removes the ACCIDENT case -- the case that
#     has already happened -- and not the deliberate one.
#   - It cannot verify what Cloudflare then serves. It uploads; the runbook's
#     edge-headers step and /version.json are what establish what is live.
#   - `origin/main` is read as this clone last fetched it. A stale ref makes the
#     ancestor check weaker, never falsely strict, so the script fetches first and
#     says loudly if it could not.
#
# WHY NOT A PRE-PUSH HOOK OR CI: a hook is per-clone and equally defeatable, and CI
# cannot deploy without holding a Cloudflare token, which this project deliberately
# does not issue to the implementer (R-2026-09-17-11 B4). Git integration is the
# candidate root fix and is recorded as a decision awaiting facts, not taken here.
#
# Usage: bash scripts/deploy_pages.sh [--branch NAME] [ROOT]
#   --branch defaults to main, and must match the Pages project's PRODUCTION branch
#   or the deployment reads the Preview environment variables and finds them unset.
#   ROOT exists so the guard-over-a-guard tests can aim this at a scratch tree.
# Exit: 0 deployed, 1 refused, 2 the check could not run.
# ============================================================
set -euo pipefail

BRANCH="main"
if [ "${1:-}" = "--branch" ]; then
    BRANCH="${2:-}"
    if [ -z "$BRANCH" ]; then
        echo "ERROR: --branch was given with no value" >&2
        exit 2
    fi
    shift 2
fi
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

st=0
git -C "$ROOT" rev-parse --is-inside-work-tree > /dev/null 2>&1 || st=$?
case "$st" in
    0) ;;
    *) echo "REFUSING: $ROOT is not a git work tree, so nothing about this build can be checked" >&2
       exit 2 ;;
esac

# Fetch so the ancestor check is made against the remote as it is now. A failure
# here is loud rather than silent: deploying against a stale origin/main is exactly
# the kind of quietly-weaker check this script exists to remove.
fst=0
git -C "$ROOT" fetch --quiet origin main > /dev/null 2>&1 || fst=$?
if [ "$fst" -ne 0 ]; then
    echo "REFUSING: could not fetch origin/main (git exited $fst), so the ancestor check would be made against a stale ref" >&2
    exit 2
fi

DIRTY="$(git -C "$ROOT" status --porcelain)"
if [ -n "$DIRTY" ]; then
    echo "REFUSING: the working tree has uncommitted changes, so the deployed artifact would match no commit"
    printf '%s\n' "$DIRTY" | sed 's/^/  /'
    echo "  Commit them, or stash them, then deploy again."
    exit 1
fi

HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
ast=0
git -C "$ROOT" merge-base --is-ancestor "$HEAD_SHA" origin/main || ast=$?
case "$ast" in
    0) ;;
    1) echo "REFUSING: HEAD $HEAD_SHA is not an ancestor of origin/main, so this is code no pull request merged"
       echo "  Deployment and review are only bound if what you upload is on main. Merge it first."
       exit 1 ;;
    *) echo "ERROR: the ancestor check did not run (git merge-base exited $ast)" >&2
       exit 2 ;;
esac

echo "deploy_pages.sh: HEAD $HEAD_SHA is on origin/main and the tree is clean."
echo "deploy_pages.sh: building (this stamps apps/public-dashboard/public/version.json)"
( cd "$ROOT" && npm run build )

echo "deploy_pages.sh: uploading to Cloudflare Pages on branch '$BRANCH'"
( cd "$ROOT/apps/public-dashboard" && npx wrangler pages deploy --branch "$BRANCH" )

echo
echo "deploy_pages.sh: DONE. The deployment report needs all four, and the fourth is now a READING:"
echo "  1. which artifact  — the project and the deployment id or URL wrangler printed above"
echo "  2. from which commit — $HEAD_SHA"
echo "  3. by which command — bash scripts/deploy_pages.sh --branch $BRANCH"
echo "  4. that the commit is on main — fetch /version.json from the deployed site and read it back"
