#!/usr/bin/env bash
# ============================================================
# scripts/lint_no_secrets.sh
# ============================================================
# Repository secret scan. DETECTION, not prevention.
#
# THE DIVISION OF LABOUR MATTERS AND IS EASY TO MISSTATE:
#   - GitHub secret scanning with PUSH PROTECTION is the PREVENTION control. It
#     is a repository setting, enforced server-side by GitHub at push time.
#   - THIS SCRIPT is a DETECTION control. It runs in CI, after a push has already
#     been accepted. A CI job cannot block a push.
# Do not describe this script as if it prevented anything. See SECURITY.md.
#
# WHY NOT gitleaks. It is a good tool and this is not an argument against it --
# but pinning a downloaded binary means pinning a version and a checksum, and a
# version that turns out not to exist is a red build on day one for a reason
# unrelated to any secret. This script has no network dependency, no pinned
# third-party version, and patterns chosen for the credentials THIS project
# actually handles. Adding gitleaks later is complementary, not a replacement.
#
# THE ALLOWED EXCEPTIONS ARE TWO FILES, EACH NAMED WITH THE KINDS IT MAY HOLD
# (R-2026-09-22-61 B2). This is NOT a general widening: the list is by named file
# and named pattern, and tests/compliance/no_secrets.test.ts pins it by identity so
# a third entry is a visible act with someone's name on it.
#
#   tests/setup/local-keys.ts       JWT, Supabase secret key, Postgres URL
#     The well-known local Supabase demo keys. Every `supabase start` on every
#     machine mints exactly those, from a published JWT secret, and they
#     authenticate against 127.0.0.1 and nothing else. Having the real anon key
#     checked in is what lets the RLS negative suite make a genuine anonymous HTTP
#     request rather than a hand-forged one that proves less. It is the only entry
#     permitted the SERVICE-ROLE shapes, because it is the only one no browser
#     bundle imports.
#
#   packages/origins/publishable-keys.json     JWT ONLY
#     The publishable client key, tracked under R-2026-09-22-61 A1 on the basis
#     that it SHIPS IN EVERY CLIENT BUNDLE BY DESIGN -- the repository holding it
#     exposes nothing new, and tracking it is what makes the stamped commit fully
#     determine the built bundle. Its JWT is the same local demo anon key, which
#     lives there rather than in local-keys.ts because the ward console needs it
#     too and one value may have only one site.
#     **'Supabase secret key' is deliberately NOT allowed for it.** A file browser
#     code imports must never be permitted a secret shape, so an `sb_secret_` value
#     pasted there is refused by this scan as well as by its own guard.
#
# THE SURFACE THIS COVERS, AND WHAT IT DOES NOT (method note 12).
#   COVERS: files in the tree that can reach the PUBLIC REPOSITORY, two ways.
#   (1) CONTENT: files selected by name pattern (the find below) are read for
#       credential shapes. It scans the working tree -- tracked AND untracked --
#       so it sees a secret before a commit as well as after.
#   (2) LOCATION: no credential FILE may be tracked, whatever it contains (the
#       DENY list below). No file contents are read.
#   DOES NOT COVER: what reaches a BROWSER. That is a different surface and a
#   different control: scripts/lint_no_service_role_in_bundle.sh, over built
#   bundles.
#
# WHY LOCATION, NOT CONTENT, FOR CREDENTIAL FILES (R-2026-09-18-17). `.dev.vars`
# is where `wrangler pages dev` reads a Pages Function's environment, including
# the service-role key, and the content scan never opened it: observed
# 2026-09-18, a `.dev.vars` holding an sb_secret_ key scanned PASS, "1 files
# scanned". The invariant for such a file is "this file must never be tracked",
# which is not "this file must not contain a secret". Content scanning is the
# wrong instrument for a location property, and it is wrong in BOTH directions:
# it misses a secret it does not recognise, and it fires on the demo key that
# legitimately belongs in a developer's working tree.
#   That second direction was observed, not predicted. The first fix added
# `.dev.vars*` to the content patterns, and the real repository then FAILED on a
# developer's local `.dev.vars` holding the well-known local demo key. It was
# REVERTED rather than papered over with exceptions: a guard that fails a
# legitimate local setup gets switched off, and a switched-off guard is worse
# than none, because its header still claims the coverage. The untracked-file
# plant in tests/compliance/no_secrets.test.ts encodes that lesson as a leg.
#
# THREE CONTROLS ON A CREDENTIAL FILE, THREE DIFFERENT FAILURE MODES.
#   - The `.gitignore` lines: prevent an accidental `git add -A`. They do not
#     survive their own deletion, and they do not stop `git add -f`.
#   - THIS tracked-files check: catches `git add -f` and a deleted ignore line.
#     In CI it runs AFTER the push, so it REPORTS an exposure; it does not
#     prevent one. Run locally it also catches a file that is only staged,
#     because `git ls-files` reads the index.
#   - GitHub secret scanning with PUSH PROTECTION: blocks at the remote, before
#     exposure -- the only one of the three that blocks rather than reports.
#     ENABLED: read from the repository API on 2026-09-19 with
#       gh api repos/Paddie-Health-Ltd/OpenBed-NG --jq .security_and_analysis
#     (secret_scanning_push_protection: enabled), agreeing with the entry of
#     2026-09-10 in docs/runbook-supabase-project-creation.md section 0.
#     ENABLED IS NOT COVERAGE: it has never been observed blocking anything on
#     this repository, and whether its patterns cover this project's two Supabase
#     key formats is OWED to the founder as a documentation check in that same
#     runbook section (R-2026-09-19-19 B3).
# For a PUBLIC repository this check is a BACKSTOP, NOT A BOUNDARY: a pushed
# credential cannot be rotated quietly (v1 kickoff, line 368), so by the time
# CI reports it the exposure has happened.
#
# NOT ASSERTED HERE, deliberately: that every credential file the repository
# ignores has a DENY entry. Which `.gitignore` lines name credential files is a
# judgement, not a parse. What IS asserted, by the test, is the other direction:
# every DENY and ALLOW entry below is a line of the root `.gitignore`, so the
# location invariant and the ignore rule cannot drift apart silently.
#
# Usage: bash scripts/lint_no_secrets.sh [ROOT]   (ROOT must be a git work tree)
# Exit: 0 clean, 1 finding, 2 usage, empty corpus, or a check that could not run.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

# Each entry is PATH|PATTERN[,PATTERN...] -- see the header for the basis of each.
ALLOWED=(
    'tests/setup/local-keys.ts|JWT,Supabase secret key,Postgres URL with password'
    'packages/origins/publishable-keys.json|JWT'
)

FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(
    find "$ROOT" -type f \
      \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.json' \
         -o -name '*.sql' -o -name '*.sh' -o -name '*.yml' -o -name '*.yaml' -o -name '*.md' \
         -o -name '*.toml' -o -name '*.env*' \) \
      -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' \
      -not -path '*/.next/*' -not -name 'package-lock.json' 2>/dev/null | sort
)
[ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no files to scan under $ROOT" >&2; exit 2; }

# Each entry: NAME|REGEX
PATTERNS=(
  'JWT|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
  'Supabase secret key|sb_secret_[A-Za-z0-9_-]{16,}'
  'Private key block|-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'AWS access key|AKIA[0-9A-Z]{16}'
  'Postgres URL with password|postgres(ql)?://[^:@/[:space:]]+:[^@/[:space:]]+@'
  'Generic assigned secret|(api[_-]?key|secret[_-]?key|access[_-]?token)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_\-]{24,}'
)

VIOLATIONS=0
for f in "${FILES[@]}"; do
    rel="${f#"$ROOT"/}"
    for entry in "${PATTERNS[@]}"; do
        name="${entry%%|*}"
        regex="${entry#*|}"
        # `-e` IS LOAD-BEARING, not style. The private-key pattern begins with
        # `-----`, and without `-e` grep parses it as a bundle of command-line
        # options, silently matches nothing, and reports the file clean. This
        # guard shipped with that bug and a plant in
        # tests/compliance/no_secrets.test.ts is what surfaced it: every PEM
        # private key would have passed the scan.
        # `|| true` here swallowed grep's exit 2 as well as its 1, so a file the
        # scanner could not read reported CLEAN. On the secret scan, that is the
        # worst possible direction to fail in.
        st=0
        out=$(grep -nE -e "$regex" "$f" 2>/dev/null) || st=$?
        case "$st" in
            0|1) ;;
            *) echo "ERROR: grep exited $st scanning $f -- the secret scan did not run" >&2; exit 2 ;;
        esac

        # A credential pointing at the local stack is not a secret. Every
        # developer's `supabase start` uses postgres:postgres@127.0.0.1:54322, it
        # is in the README, and it authenticates against a container on the
        # machine running it.
        #
        # NARROWING THIS IS WHAT MAKES THE PATTERN USEFUL. Left as-is it fires on
        # scripts/run_migrations.sh and scripts/seed.sh -- documentation and
        # defaults -- and a guard that reds on its own repository every run is a
        # guard someone switches off within a week. What remains after the filter
        # is exactly the dangerous case: a password in a connection string
        # pointing at a host that is not this machine.
        if [ "$name" = 'Postgres URL with password' ]; then
            # `|| true` here was the worst of the set and the hand sweep missed it:
            # grep's exit 2 would empty $out, which reads as NO FINDINGS. A resource
            # failure at this line silently drops every secret already matched.
            fst=0
            filtered=$(printf '%s\n' "$out" | grep -vE '127\.0\.0\.1|localhost|@db:|0\.0\.0\.0') || fst=$?
            case "$fst" in
                0|1) out="$filtered" ;;
                *) echo "ERROR: the local-host narrowing filter exited $fst -- it did not run, so findings cannot be dropped" >&2; exit 2 ;;
            esac
        fi

        [ -z "$out" ] && continue

        # The allowlisted files, each only for the patterns named beside it. A `case`
        # rather than a grep: it forks nothing and cannot fail to run, so an
        # exemption can never be granted by a check that did not execute.
        _exempt=0
        for _entry in "${ALLOWED[@]}"; do
            _path="${_entry%%|*}"
            [ "$rel" = "$_path" ] || continue
            case ",${_entry#*|}," in
                *",$name,"*) _exempt=1 ;;
            esac
        done
        [ "$_exempt" = 1 ] && continue

        echo "FAIL: committed secret matched in $rel — pattern: $name"
        echo "$out" | cut -c1-120 | sed 's/^/  /'
        VIOLATIONS=$((VIOLATIONS+1))
    done
done

# ---- LOCATION: no credential file may be tracked, whatever it contains ----
# Each entry: BASENAME GLOB|one-line reason. Matched against the basename, so a
# credential file is denied at ANY depth. The next credential file is one line
# here, not a new ruling (R-2026-09-18-17 A2).
DENY=(
  '.env|dotenv secrets; wrangler also reads it for local dev'
  '.env.*|per-environment and .local dotenv variants (.env.production, .env.local)'
  '.dev.vars|a Pages Function local environment, including the service-role key'
  '.dev.vars.*|wrangler per-environment form, loaded before .dev.vars (.dev.vars.production)'
)
# Conventionally tracked templates that name variables and never hold values.
# Checked FIRST. Exactly the `!` negations in the root .gitignore, no more.
ALLOW=(
  '.env.example'
  '.dev.vars.example'
)

# `git ls-files` has the same three-outcome problem grep has: whichever branch
# "could not run" lands on is what it silently becomes. Its status is captured by
# hand and anything nonzero is fatal and loud -- including "not a git
# repository", because a tracked-files check that cannot see tracking must not
# report clean. -z output goes to a file so the status is not lost to a pipe.
TRACKED_LIST="$(mktemp)"
trap 'rm -f "$TRACKED_LIST"' EXIT
gst=0
git -C "$ROOT" ls-files -z > "$TRACKED_LIST" 2>/dev/null || gst=$?
if [ "$gst" -ne 0 ]; then
    echo "ERROR: git ls-files exited $gst under $ROOT -- the tracked-files check did not run" >&2
    exit 2
fi

TRACKED=0
while IFS= read -r -d '' path; do
    TRACKED=$((TRACKED+1))
    base="${path##*/}"
    allowed=0
    for a in "${ALLOW[@]}"; do
        if [ "$base" = "$a" ]; then allowed=1; fi
    done
    if [ "$allowed" -eq 1 ]; then continue; fi
    for entry in "${DENY[@]}"; do
        glob="${entry%%|*}"
        reason="${entry#*|}"
        # Unquoted on purpose: $glob is a pattern. `case` forks nothing and has
        # no third outcome.
        case "$base" in
            $glob)
                echo "FAIL: credential file is tracked: $path -- $reason"
                echo "  Untrack it (git rm --cached) and treat anything it held as exposed."
                VIOLATIONS=$((VIOLATIONS+1))
                break ;;
        esac
    done
done < "$TRACKED_LIST"

# ANTI-VACUITY for the location half. A repository with nothing tracked is a
# scratch tree or a broken checkout, and a check over nothing is not a pass.
if [ "$TRACKED" -eq 0 ]; then
    echo "ERROR: no tracked files under $ROOT -- a tracked-files check over nothing is not a pass" >&2
    exit 2
fi

if [ "$VIOLATIONS" -gt 0 ]; then
    echo
    echo "lint_no_secrets.sh: FAILED ($VIOLATIONS finding(s))"
    echo "  A committed secret is a compromised secret. Rotate it, then remove it"
    echo "  from history — deleting the line is not enough. See docs/runbook-key-rotation.md."
    exit 1
fi
echo "lint_no_secrets.sh: PASS (${#FILES[@]} files scanned, $TRACKED tracked files checked, 0 findings)"
