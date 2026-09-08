#!/usr/bin/env bash
# ============================================================
# apps/public-dashboard/build.sh
# ============================================================
# Cloudflare Pages build command.
#
# Pages has no native path filter and rebuilds on every push to the connected
# branch. This exits early when nothing this app depends on has changed, which
# keeps build minutes for changes that could actually alter the output.
#
# CI does NOT use this script -- .github/workflows/ci.yml builds unconditionally,
# because a guard that runs only on some pushes is not a guard.
# ============================================================
set -euo pipefail

if [ -n "${CF_PAGES_COMMIT_SHA:-}" ] && [ -n "${CF_PAGES_BRANCH:-}" ]; then
    if git diff --quiet HEAD^ HEAD -- apps/public-dashboard packages 2>/dev/null; then
        echo "No changes under apps/public-dashboard or packages/. Skipping build."
        exit 0
    fi
fi

npm ci
npm run build -w @openbed/public-dashboard
