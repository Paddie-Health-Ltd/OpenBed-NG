#!/usr/bin/env bash
# ============================================================
# scripts/deploy_pages.sh
# ============================================================
# DEPLOY A PAGES APP, AND REFUSE THE ACCIDENT (R-2026-09-20-30 A4; widened to every
# deployable app by R-2026-09-22-57 B).
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
#   - a directory that is not a git work tree -- then nothing can be checked at all;
#   - an app name it does not recognise -- NEVER defaulted, because a typo that
#     deployed a different site would be the accident wearing the guard's uniform.
#
# WHICH APPS IT DEPLOYS, AND WHY IT IS NOT A LIST HERE. A deployable app is a
# directory under apps/ carrying a wrangler.toml, and its Pages project name and
# build output directory are read out of that file -- the same file Cloudflare
# itself reads. A list in this script would be a second statement of a fact that
# already has a home, and the two would drift.
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
# Usage: bash scripts/deploy_pages.sh [--branch NAME] APP [ROOT]
#   APP is a directory under apps/ holding a wrangler.toml, e.g. public-dashboard.
#   --branch defaults to main, and must match the Pages project's PRODUCTION branch
#   or the deployment reads the Preview environment variables and finds them unset.
#   ROOT exists so the guard-over-a-guard tests can aim this at a scratch tree.
#     Do not remove it because it looks unused; it is the seam every plant hangs on.
# Exit: 0 deployed, 1 refused, 2 the check could not run.
# ============================================================
set -euo pipefail

# A LOOP RATHER THAN A FIRST-POSITION CHECK. Until 2026-09-22 --branch was only
# recognised as $1, so `deploy_pages.sh public-dashboard --branch main` would have
# taken --branch as the ROOT argument and deployed to the default branch without
# saying so. An option that is silently ignored in one argument order is the same
# class of defect as a check that does not run.
BRANCH="main"
APP=""
ROOT=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --branch)
            BRANCH="${2:-}"
            if [ -z "$BRANCH" ]; then
                echo "ERROR: --branch was given with no value" >&2
                exit 2
            fi
            shift 2 ;;
        --*)
            echo "ERROR: unknown option $1 -- this wrapper takes [--branch NAME] APP [ROOT]" >&2
            exit 2 ;;
        *)
            if [ -z "$APP" ]; then
                APP="$1"
            elif [ -z "$ROOT" ]; then
                ROOT="$1"
            else
                echo "ERROR: too many arguments -- this wrapper takes [--branch NAME] APP [ROOT]" >&2
                exit 2
            fi
            shift ;;
    esac
done
if [ -z "$APP" ]; then
    echo "ERROR: no app named -- this wrapper takes [--branch NAME] APP [ROOT]" >&2
    exit 2
fi
ROOT="${ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

st=0
git -C "$ROOT" rev-parse --is-inside-work-tree > /dev/null 2>&1 || st=$?
case "$st" in
    0) ;;
    *) echo "REFUSING: $ROOT is not a git work tree, so nothing about this build can be checked" >&2
       exit 2 ;;
esac

# THE APP REGISTRY, READ FROM THE ARTEFACT CLOUDFLARE READS. After the work-tree
# check, so an unreadable ROOT is reported as an unreadable ROOT rather than as a
# missing app. sed, not grep: scripts/lint_grep_exit_codes.sh bans a grep in a
# branch position, and a lookup that could not run must never read as "not found".
APP_DIR="$ROOT/apps/$APP"
if [ ! -f "$APP_DIR/wrangler.toml" ]; then
    echo "REFUSING: '$APP' is not a deployable app -- apps/$APP/wrangler.toml does not exist" >&2
    echo "  Deployable apps are the directories under apps/ that carry a wrangler.toml." >&2
    exit 2
fi
PROJECT="$(sed -n 's/^[[:space:]]*name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$APP_DIR/wrangler.toml" | head -1)"
OUTDIR="$(sed -n 's|^[[:space:]]*pages_build_output_dir[[:space:]]*=[[:space:]]*"\./\{0,1\}\([^"]*\)".*|\1|p' "$APP_DIR/wrangler.toml" | head -1)"
if [ -z "$PROJECT" ]; then
    echo "REFUSING: apps/$APP/wrangler.toml names no Pages project, so there is nothing to upload to" >&2
    exit 2
fi
if [ -z "$OUTDIR" ]; then
    echo "REFUSING: apps/$APP/wrangler.toml names no pages_build_output_dir, so the build stamp cannot be found" >&2
    exit 2
fi

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
echo "deploy_pages.sh: building $APP (this stamps apps/$APP/public/version.json)"
( cd "$ROOT" && npm run build )

# THE STAMP READBACK (R-2026-09-22-57 B). Everything above this line checked the
# WORKING TREE; this checks the ARTEFACT. They are different claims, and only this
# one is about the bytes that are going to be uploaded: a stale build directory
# passes every check above and uploads something else entirely.
#
# It is here rather than in tests/compliance/build_stamp.test.ts because the
# property -- the artefact being uploaded names the commit being deployed -- is only
# true AT UPLOAD TIME. Asserted in a test suite it was false after every commit.
STAMP="$APP_DIR/$OUTDIR/version.json"
if [ ! -f "$STAMP" ]; then
    echo "REFUSING: the build wrote no stamp at $STAMP, so what would be uploaded cannot be identified"
    echo "  Every deployable app stamps at build time (scripts/stamp_build.mjs). An app whose build step lost its stamp must not upload."
    exit 1
fi

# node, not jq: jq is a get_publishable_key.sh dependency and is not required to
# deploy. The three outcomes are separated by hand -- a stamp that could not be READ
# must never read as a stamp that disagrees, nor as one that agrees.
rst=0
READBACK="$(node -e '
const fs = require("fs");
let s;
try { s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(3); }
if (typeof s.commit !== "string" || typeof s.dirty !== "boolean") process.exit(3);
process.stdout.write(s.commit + " " + s.dirty);
' "$STAMP")" || rst=$?
case "$rst" in
    0) ;;
    *) echo "ERROR: the stamp at $STAMP is not readable JSON carrying a commit and a dirty flag, so the readback did not run" >&2
       exit 2 ;;
esac
STAMPED_COMMIT="${READBACK%% *}"
STAMPED_DIRTY="${READBACK##* }"

if [ "$STAMPED_DIRTY" != "false" ]; then
    echo "REFUSING: the stamp says the tree was dirty, so the artifact about to be uploaded is identified by no commit"
    echo "  The tree was clean when this script checked it, so something wrote into it during the build."
    exit 1
fi
if [ "$STAMPED_COMMIT" != "$HEAD_SHA" ]; then
    echo "REFUSING: the stamp names commit $STAMPED_COMMIT but this deploy verified $HEAD_SHA -- the built artifact is not the commit that was checked"
    echo "  A stale build directory is the accident: every check above passed on HEAD, and the upload would carry something else."
    exit 1
fi
echo "deploy_pages.sh: the stamp reads back as $STAMPED_COMMIT, clean -- the artifact is the commit that was checked."

echo "deploy_pages.sh: uploading $APP to Cloudflare Pages project '$PROJECT' on branch '$BRANCH'"
( cd "$APP_DIR" && npx wrangler pages deploy --branch "$BRANCH" )

echo
echo "deploy_pages.sh: DONE. The deployment report needs all four, and the fourth is now a READING:"
echo "  1. which artifact  — project $PROJECT, and the deployment id or URL wrangler printed above"
echo "  2. from which commit — $HEAD_SHA"
echo "  3. by which command — bash scripts/deploy_pages.sh --branch $BRANCH $APP"
echo "  4. that the commit is on main — fetch /version.json from the deployed site and read it back"
