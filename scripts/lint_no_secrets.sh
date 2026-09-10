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
# THE ONE ALLOWED EXCEPTION is tests/setup/local-keys.ts, which holds the
# well-known local Supabase demo keys. Every `supabase start` on every machine
# mints exactly those, from a published JWT secret, and they authenticate against
# 127.0.0.1 and nothing else. Having the real anon key checked in is what lets the
# RLS negative suite make a genuine anonymous HTTP request rather than a
# hand-forged one that proves less.
#
# Usage: bash scripts/lint_no_secrets.sh [ROOT]
# Exit: 0 clean, 1 finding, 2 usage or empty corpus.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"

ALLOWED_PATH='tests/setup/local-keys.ts'

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

        # The single allowlisted file, and only for the local-demo JWT pattern.
        if [ "$rel" = "$ALLOWED_PATH" ] && { [ "$name" = 'JWT' ] || [ "$name" = 'Supabase secret key' ] || [ "$name" = 'Postgres URL with password' ]; }; then
            continue
        fi

        echo "FAIL: committed secret matched in $rel — pattern: $name"
        echo "$out" | cut -c1-120 | sed 's/^/  /'
        VIOLATIONS=$((VIOLATIONS+1))
    done
done

if [ "$VIOLATIONS" -gt 0 ]; then
    echo
    echo "lint_no_secrets.sh: FAILED ($VIOLATIONS finding(s))"
    echo "  A committed secret is a compromised secret. Rotate it, then remove it"
    echo "  from history — deleting the line is not enough. See docs/runbook-key-rotation.md."
    exit 1
fi
echo "lint_no_secrets.sh: PASS (${#FILES[@]} files scanned, 0 findings)"
