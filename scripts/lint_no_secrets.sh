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
#     OBSERVED 2026-09-29 (R-2026-09-29-169): GitHub raised a secret-scanning
#     ALERT, #1, for a generic "Postgres connection string" on pushed commit
#     a61fccc. It did NOT block the push; the alert came after it. Push protection
#     blocking a generic pattern has still never been observed here.
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

# .gate-logs/ IS EXCLUDED BY NAME (R-2026-09-28-152 EB-2 d). It holds scripts/gate.sh's
# per-check output, which quotes this repository's own planted credential shapes (the
# plant legs of this very scan print them), and it is gitignored, so it cannot reach the
# public repository this scan protects. A test log is never source. Until then it was
# outside the scan only because `.log` is not a name the find selects; that is an
# accident a future `.json` log would undo, so the exclusion is stated.
FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(
    find "$ROOT" -type f \
      \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o -name '*.json' \
         -o -name '*.sql' -o -name '*.sh' -o -name '*.yml' -o -name '*.yaml' -o -name '*.md' \
         -o -name '*.toml' -o -name '*.env*' \) \
      -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' \
      -not -path '*/.next/*' -not -path '*/.gate-logs/*' -not -name 'package-lock.json' 2>/dev/null | sort
)
[ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no files to scan under $ROOT" >&2; exit 2; }

# THE TWO POSTGRES PATTERNS AND WHAT THEY GIVE UP (R-2026-09-29-169, ES-1 and its
# amendment).
#   URL: the scheme in any case, and a user part that may be empty -- libpq takes
#   both, and until ES the pattern matched neither.
#   KEYWORD DSN: the pass-word keyword, a word boundary before it, optional spaces
#   round its `=`, then a non-empty value: bare, single-quoted or double-quoted.
#   A BARE value may not begin with `=` or `>`, so a code comparison (two or three
#   equals signs) or an arrow is not a detection; this repository holds one such
#   comparison. WHAT THAT GIVES UP: an UNQUOTED libpq value that itself begins
#   with `=` is not detected. A quoted one still is, and so is any URL.
#   KNOWN FALSE POSITIVE, kept: a code assignment of the pass-word key from a
#   variable (an environment read, say) reads as a keyword DSN with no host, so it
#   is a finding. None is in the tree. If one appears, reword the code; the pattern
#   is not narrowed without a ruling.
KW_PW_RE="(^|[^[:alnum:]_])password[[:space:]]*=[[:space:]]*('[^']+'|\"[^\"]+\"|[^[:space:]'\"&=>][^[:space:]'\"&]*)"

# Each entry: NAME|REGEX
PATTERNS=(
  'JWT|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
  'Supabase secret key|sb_secret_[A-Za-z0-9_-]{16,}'
  'Private key block|-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'AWS access key|AKIA[0-9A-Z]{16}'
  'Postgres URL with password|[Pp][Oo][Ss][Tt][Gg][Rr][Ee][Ss]([Qq][Ll])?://[^:@/[:space:]]*:[^@/[:space:]]+@'
  "Postgres keyword DSN with password|$KW_PW_RE"
  'Generic assigned secret|(api[_-]?key|secret[_-]?key|access[_-]?token)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_\-]{24,}'
)

# A CREDENTIAL POINTING AT THE LOCAL STACK IS NOT A SECRET. Every developer's
# `supabase start` uses the same published local password on 127.0.0.1:54322, it
# is in the README, and it authenticates against a container on the machine
# running it. A guard that reds on its own repository every run is a guard someone
# switches off within a week, so a match is judged LOCAL and dropped -- but only
# by reading EACH URL'S OWN HOST, never the line (R-2026-09-29-169, ES-1).
#
# Until ES this dropped a whole matched LINE if it held 127.0.0.1, localhost, @db:
# or 0.0.0.0 anywhere. A hosted URL beside a local one, a host of
# localhost.attacker.example.com, a local authority whose `?host=` names another
# machine, and a password containing "localhost" all read as local. That is the
# defect scripts/seed.sh fixed in its own host check (its "ANCHORED ON THE HOST"
# note) and this scan never got. The parse below is seed.sh's: scheme first,
# credentials stripped at the FIRST `@`, the authority up to the first `/`, `?`
# or `#`, the port removed, a bracketed host kept whole, the host matched whole.
#
# A URL token is LOCAL only if ALL hold:
#   - its host is exactly 127.0.0.1, localhost (any case), [::1], db or 0.0.0.0;
#   - its authority holds no `,` -- libpq falls through a host list to the next
#     host with the same password, so a local first host proves nothing;
#   - it carries no `?` at all, even an empty one -- a host or hostaddr parameter
#     overrides the authority;
#   - it holds no second `://` -- two URLs run together are never read as one.
# A line is a finding if ANY token on it is not local, or if the pattern matched
# and no token came out: fail closed.
#
# THE DELIBERATE WIDENING. [::1], LOCALHOST in capitals, and a bare `db` with no
# port were findings under the line filter (none of its four substrings) and are
# local here. Each is the local stack, and each is named in R-2026-09-29-169.
#
# `case` rather than grep for every judgement: it forks nothing and cannot fail to
# run, so a URL can never be judged local by a check that did not execute.
URL_TOKEN_RE="[Pp][Oo][Ss][Tt][Gg][Rr][Ee][Ss]([Qq][Ll])?://[^[:space:]'\"\`)>]*"
KW_HOST_RE="(^|[^[:alnum:]_])host(addr)?[[:space:]]*=[[:space:]]*('[^']*'|\"[^\"]*\"|[^[:space:]'\"&]*)"

host_is_local() {
    case "$1" in
        127.0.0.1|0.0.0.0|db|'[::1]'|[Ll][Oo][Cc][Aa][Ll][Hh][Oo][Ss][Tt]) return 0 ;;
    esac
    return 1
}

url_is_local() {
    local tok="$1" rest auth host
    case "$tok" in *\?*) return 1 ;; esac
    case "$tok" in *://*://*) return 1 ;; esac
    rest="${tok#*://}"
    rest="${rest#*@}"
    auth="${rest%%[/?#]*}"
    case "$auth" in *,*) return 1 ;; esac
    case "$auth" in
        '['*) host="${auth%%]*}]" ;;
        *) host="${auth%%:*}" ;;
    esac
    host_is_local "$host"
}

# $1 a line number; reads URL_TOKENS, the `N:token` output of one grep -noE.
url_line_is_local() {
    local n="$1" t found=0
    while IFS= read -r t; do
        case "$t" in "$n":*) ;; *) continue ;; esac
        found=1
        url_is_local "${t#*:}" || return 1
    done <<< "$URL_TOKENS"
    [ "$found" -eq 1 ]
}

# $1 a line number; reads KW_HOSTS, the `N:host=value` output of one grep -noE.
# Local only if the line names at least one host or hostaddr and every one is
# local. A value holding `,` fails the whole-host match. A pass-word with NO host
# on its line is a finding: libpq's default host is not a fact this scan can read.
kw_line_is_local() {
    local n="$1" h v seen=0
    while IFS= read -r h; do
        case "$h" in "$n":*) ;; *) continue ;; esac
        seen=1
        v="${h#*=}"
        v="${v#"${v%%[![:space:]]*}"}"
        case "$v" in
            \'*\') v="${v#\'}"; v="${v%\'}" ;;
            \"*\") v="${v#\"}"; v="${v%\"}" ;;
        esac
        host_is_local "$v" || return 1
    done <<< "$KW_HOSTS"
    [ "$seen" -eq 1 ]
}

VIOLATIONS=0

# ONE COMBINED GREP PER FILE FIRST, and the per-pattern loop only for a file it
# matches (2026-09-23). The loop below forks one grep per file PER PATTERN --
# 289 files x 6 patterns = 1,734 processes -- and a file matching NONE of the six
# is exactly the case where every one of those greps exits 1 with no output. So
# skipping it changes no verdict: the loop's own logic still runs, unchanged, on
# every file that matches anything. Measured before this: about 10 s alone, and
# 19.6 s then 32.8 s inside the full suite, against vitest's 30 s default, so
# tests/compliance/no_secrets.test.ts's accept leg went red on a timeout and not
# on a finding. The prefilter's exit 2 is as fatal as the loop's: a file it could
# not read is never treated as clean.
ALL_PATTERNS=()
for entry in "${PATTERNS[@]}"; do ALL_PATTERNS+=(-e "${entry#*|}"); done

for f in "${FILES[@]}"; do
    rel="${f#"$ROOT"/}"
    pst=0
    grep -qE "${ALL_PATTERNS[@]}" "$f" 2>/dev/null || pst=$?
    case "$pst" in
        0) ;;
        1) continue ;;
        *) echo "ERROR: grep exited $pst prefiltering $f against every pattern -- no file it cannot read is ever reported clean" >&2; exit 2 ;;
    esac
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

        # NARROWING TO THE DANGEROUS CASE: a password in a connection string whose
        # own host is not this machine. The rule and its history are in the block
        # above host_is_local(). Each read's status is captured: 0 and 1 are
        # verdicts, anything else means a line was about to be judged unread.
        if [ -n "$out" ] && [ "$name" = 'Postgres URL with password' ]; then
            tst=0
            URL_TOKENS=$(grep -noE -e "$URL_TOKEN_RE" "$f" 2>/dev/null) || tst=$?
            case "$tst" in
                0|1) ;;
                *) echo "ERROR: grep exited $tst on $f -- the URL token read did not run, so no matched line is judged local" >&2; exit 2 ;;
            esac
            kept=''
            while IFS= read -r _l; do
                [ -n "$_l" ] || continue
                url_line_is_local "${_l%%:*}" || kept+="$_l"$'\n'
            done <<< "$out"
            out="${kept%$'\n'}"
        fi
        if [ -n "$out" ] && [ "$name" = 'Postgres keyword DSN with password' ]; then
            hst=0
            KW_HOSTS=$(grep -noE -e "$KW_HOST_RE" "$f" 2>/dev/null) || hst=$?
            case "$hst" in
                0|1) ;;
                *) echo "ERROR: grep exited $hst on $f -- the host keyword read did not run, so no keyword line is judged local" >&2; exit 2 ;;
            esac
            kept=''
            while IFS= read -r _l; do
                [ -n "$_l" ] || continue
                kw_line_is_local "${_l%%:*}" || kept+="$_l"$'\n'
            done <<< "$out"
            out="${kept%$'\n'}"
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
