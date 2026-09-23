#!/usr/bin/env bash
# ============================================================
# scripts/deploy_worker.sh
# ============================================================
# DEPLOY THE api.openbed.ng WORKER, AND READ BACK WHAT IS LIVE (R-2026-09-23-70; the
# kickoff's PR 3.3 "Stamp and guard for the Worker"; AJ B's read-back at upload).
#
# THE SAME REFUSALS AS scripts/deploy_pages.sh, for the same defect: a Worker upload
# is whatever tree someone ran wrangler from, and merging proves review, not what is
# deployed. It refuses, each by name:
#   - a directory that is not a git work tree;
#   - a target it does not recognise -- NEVER defaulted. A Worker target is a
#     directory at the repository root carrying a wrangler.json; today that is
#     supabase-proxy and nothing else;
#   - a failed fetch of origin/main, which would make the ancestor check stale;
#   - a working tree with uncommitted changes;
#   - a HEAD that is not an ancestor of origin/main;
#   - a stamp that is missing, unreadable, dirty, or names another commit.
#
# AND ONE THING THE PAGES WRAPPER CANNOT DO, because a Worker serves its own stamp:
# after the upload it reads https://api.openbed.ng/__openbed/version until it names
# HEAD, for a BOUNDED window, and then STOPS. A read-back that answers with the
# PREVIOUS commit is the old Worker still serving, never a pass -- a deploy that
# "succeeded" and did not take effect is exactly what this step exists to catch.
#
# WHAT IT IS NOT (method note 12): a control. `npx wrangler deploy` by hand bypasses
# it. It removes the accident, not the deliberate act, and it cannot prove the live
# Worker's SOURCE equals this repository's -- that is the source-equality probe in
# docs/runbook-cloudflare-worker-proxy.md, read through the Cloudflare connector.
#
# Usage: bash scripts/deploy_worker.sh TARGET [ROOT]
#   TARGET is supabase-proxy. ROOT exists so the tests can aim this at a scratch
#   tree; do not remove it because it looks unused.
#   DEPLOY_WORKER_READBACK_ATTEMPTS (default 12) and DEPLOY_WORKER_READBACK_SLEEP
#   (default 5 seconds) bound the read-back window -- a minute by default.
# Exit: 0 deployed and read back; 1 refused, or the read-back did not confirm the
#       deploy; 2 a check could not run.
# ============================================================
set -euo pipefail

TARGET="${1:-}"
ROOT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
STAMP_URL="https://api.openbed.ng/__openbed/version"
ATTEMPTS="${DEPLOY_WORKER_READBACK_ATTEMPTS:-12}"
PAUSE="${DEPLOY_WORKER_READBACK_SLEEP:-5}"

if [ -z "$TARGET" ]; then
    echo "REFUSING: no target given -- usage: bash scripts/deploy_worker.sh supabase-proxy" >&2
    exit 2
fi

wst=0
git -C "$ROOT" rev-parse --is-inside-work-tree > /dev/null 2>&1 || wst=$?
case "$wst" in
    0) ;;
    *) echo "REFUSING: $ROOT is not a git work tree, so nothing about this build can be checked" >&2
       exit 2 ;;
esac

# THE TARGET REGISTRY IS THE FILE WRANGLER READS. A typo must never deploy something
# else, so an unknown target is refused rather than defaulted.
if [ ! -f "$ROOT/$TARGET/wrangler.json" ]; then
    echo "REFUSING: '$TARGET' is not a Worker target -- $TARGET/wrangler.json does not exist" >&2
    echo "  Worker targets are directories at the repository root that carry a wrangler.json." >&2
    exit 2
fi

fst=0
git -C "$ROOT" fetch --quiet origin main > /dev/null 2>&1 || fst=$?
if [ "$fst" -ne 0 ]; then
    echo "REFUSING: could not fetch origin/main (git exited $fst), so the ancestor check would be made against a stale ref" >&2
    exit 2
fi

DIRTY="$(git -C "$ROOT" status --porcelain)"
if [ -n "$DIRTY" ]; then
    echo "REFUSING: the working tree has uncommitted changes, so the deployed Worker would match no commit"
    printf '%s\n' "$DIRTY" | sed 's/^/  /'
    exit 1
fi

HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
ast=0
git -C "$ROOT" merge-base --is-ancestor "$HEAD_SHA" origin/main || ast=$?
case "$ast" in
    0) ;;
    1) echo "REFUSING: HEAD $HEAD_SHA is not an ancestor of origin/main, so this is code no pull request merged"
       exit 1 ;;
    *) echo "ERROR: the ancestor check did not run (git merge-base exited $ast)" >&2
       exit 2 ;;
esac

echo "deploy_worker.sh: HEAD $HEAD_SHA is on origin/main and the tree is clean."
echo "deploy_worker.sh: stamping $TARGET/version.json"
( cd "$ROOT" && npm run --silent stamp:worker )

# THE STAMP READBACK BEFORE UPLOAD -- the artefact, not the tree.
STAMP="$ROOT/$TARGET/version.json"
if [ ! -f "$STAMP" ]; then
    echo "REFUSING: the stamp step wrote nothing at $STAMP, so the Worker about to be uploaded cannot be identified"
    exit 1
fi
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
if [ "${READBACK##* }" != "false" ]; then
    echo "REFUSING: the stamp says the tree was dirty, so the Worker about to be uploaded is identified by no commit"
    exit 1
fi
if [ "${READBACK%% *}" != "$HEAD_SHA" ]; then
    echo "REFUSING: the stamp names commit ${READBACK%% *} but this deploy verified $HEAD_SHA -- the artefact is not the commit that was checked"
    exit 1
fi
echo "deploy_worker.sh: the stamp reads back as $HEAD_SHA, clean."

echo "deploy_worker.sh: uploading $TARGET with wrangler deploy"
( cd "$ROOT/$TARGET" && npx wrangler deploy )

# THE LIVE READ-BACK (AJ B). Bounded, and it never passes on anything but HEAD.
LAST="nothing"
i=1
while [ "$i" -le "$ATTEMPTS" ]; do
    cst=0
    BODY="$(curl -sS -m 12 "$STAMP_URL" 2>&1)" || cst=$?
    if [ "$cst" -eq 0 ]; then
        pst=0
        LIVE="$(node -e '
let s;
try { s = JSON.parse(process.argv[1]); } catch { process.exit(3); }
if (typeof s.commit !== "string") process.exit(3);
process.stdout.write(s.commit);
' "$BODY")" || pst=$?
        if [ "$pst" -eq 0 ]; then
            if [ "$LIVE" = "$HEAD_SHA" ]; then
                echo "deploy_worker.sh: DONE. $STAMP_URL names $HEAD_SHA (attempt $i of $ATTEMPTS)."
                echo "  Now run: bash scripts/readback_worker.sh https://api.openbed.ng -- probe 4 is Cowork's (docs/runbook-cloudflare-worker-proxy.md)."
                exit 0
            fi
            LAST="commit $LIVE"
        else
            LAST="a body that is not a stamp: ${BODY:0:80}"
        fi
    else
        LAST="no answer (curl exited $cst)"
    fi
    echo "deploy_worker.sh: attempt $i of $ATTEMPTS -- $STAMP_URL gave $LAST, not $HEAD_SHA"
    i=$((i + 1))
    if [ "$i" -le "$ATTEMPTS" ]; then sleep "$PAUSE"; fi
done

echo "STOP: after $ATTEMPTS attempts $STAMP_URL still gave $LAST, not $HEAD_SHA."
echo "  The upload ran, and it is NOT confirmed live. Do not report this deploy as done;"
echo "  read the stamp again by hand, and if it still names another commit, the old Worker is serving."
exit 1
