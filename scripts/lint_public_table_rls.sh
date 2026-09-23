#!/usr/bin/env bash
# ============================================================
# scripts/lint_public_table_rls.sh
# ============================================================
# Every table created in schema `public`, or moved into it, must ENABLE and FORCE
# row level security in the SAME migration that puts it there (R-2026-09-22-56 C;
# widened to every form by R-2026-09-23-65 A2).
#
# WHY IN THE SAME FILE. A table created in one migration and secured in a later one
# is unprotected for every deployment between them, and on a hosted project that
# window is however long it takes the next migration to be applied. 018 merged on
# 2026-09-21 and was applied hosted on 2026-09-22.
#
# WHY THIS LINT EXISTS AT ALL, and it is the reason worth reading. The hosted
# project carries an event trigger, `ensure_rls`, which enables RLS for tables
# created in `public`. Local does not. So a migration that forgets these statements
# produces a hosted database that is SILENTLY STRICTER than the local one the whole
# suite runs against -- the tests would be passing over a database looser than
# production, and the omission would never surface as a failure anywhere.
#
# WHY ENABLE IS NOT ENOUGH. Without FORCE, the table OWNER bypasses its own
# policies -- and the projection trigger runs as a SECURITY DEFINER function owned
# by that same role. ENABLE alone reads as protection and is not.
#
# HOW IT READS A FILE: LEX FIRST, THEN CLASSIFY. Until 2026-09-23 this was a
# line-by-line grep over the plain form, and it could not see a statement split
# across lines, a quoted identifier, an UNLOGGED table, a table moved in with SET
# SCHEMA, or an unqualified CREATE TABLE ... AS (R-2026-09-23-65 A2). For an UP
# migration tests/db/rls_enabled_everywhere.test.ts caught those from the catalogue;
# for a DOWN migration nothing did. So:
#   1. An embedded perl LEXER normalises each file and returns no verdicts. It drops
#      `--` and (nested) `/* */` comments; reads '...' with '' and E'...' with
#      backslash escapes; unquotes a "quoted" identifier that is plain lowercase
#      (identical to Postgres) and replaces any other with __quoted__; replaces a
#      string that holds a table-creating or -moving form with __dynamic__; and lexes
#      each $tag$...$tag$ body as code of its own. It prints ONE STATEMENT PER LINE,
#      lowercased and single-spaced, prefixed T| (top level) or B| (inside a
#      dollar-quoted body). An unterminated string, identifier, comment or body is a
#      refusal, never a best effort. perl is used because it ships with macOS and
#      with the CI runner's image; nothing else in this repository needed it before.
#   2. The CLASSIFIER, below in bash, reads those lines. EVERY FORM THAT CAN CREATE
#      OR MOVE A TABLE INTO `public` IS EITHER PAIRED OR REFUSED BY NAME:
#        CREATE [UNLOGGED] TABLE [IF NOT EXISTS] <t> ...   public.x must pair;
#            any tail -- (, AS, PARTITION OF, OF.         other schema: not ours;
#                                                         unqualified: refused.
#        SELECT ... INTO [UNLOGGED] [TABLE] <t>           public.x must pair; an
#                                                         unqualified one at top
#                                                         level is refused.
#        ALTER [FOREIGN] TABLE ... <t> SET SCHEMA public  the moved table must pair.
#        CREATE FOREIGN TABLE in public or unqualified,
#        IMPORT FOREIGN SCHEMA ... INTO public,
#        CREATE EXTENSION (into public, or no schema named
#            -- pg_cron alone exempted, by name, below),
#        ALTER EXTENSION ... SET SCHEMA public            refused: this lint cannot
#                                                         establish RLS on what they
#                                                         create.
#        a target named by a quoted identifier that is not plain lowercase, and any
#        string holding one of these forms (dynamic SQL)  refused as unreadable.
#        CREATE {TEMP|TEMPORARY} TABLE                    skipped: Postgres puts it
#                                                         in pg_temp, and refuses a
#                                                         temporary relation in public
#                                                         ("cannot create temporary
#                                                         relation in non-temporary
#                                                         schema", observed locally
#                                                         2026-09-23).
#      PAIRING is an ALTER TABLE [IF EXISTS] [ONLY] public.<t> whose comma-separated
#      action list holds exactly `enable row level security` and, in the same or
#      another statement, `force row level security` -- so the combined form
#      pairs, and `no force row level security` never counts as FORCE. A DISABLE or
#      NO FORCE on the same table anywhere in the file is refused as undoing it.
#
# NOT ASSERTED HERE, deliberately (method note 12):
#   - THE LIVE CATALOGUE. tests/db/rls_enabled_everywhere.test.ts asserts
#     relrowsecurity AND relforcerowsecurity over every real table in `public`, and
#     pins the table set by identity. THE TWO ARE COMPLEMENTS, NOT DUPLICATES: that
#     test can only see what has been applied to a database, and sees it only after
#     the fact; this lint catches the statement in review, before it reaches any
#     database, and catches it in a down migration too.
#   - THAT THE POLICIES ARE CORRECT. RLS enabled with a permissive policy is a
#     different defect with its own tests. This says only that the switch is on.
#   - ANYTHING ABOUT SCHEMA `app`. Its 16 tables deliberately carry no RLS: no
#     client role holds any grant on them and `app` is not an exposed schema, so
#     enabling RLS there would protect against a caller that cannot arrive. A lint
#     that fired on them would be switched off within a week.
#   - WHEN A FUNCTION BODY RUNS. A CREATE TABLE inside a dollar-quoted body is read
#     exactly as a top-level one and must pair in the same file. That is the fail-
#     closed reading: the lint cannot know when, or whether, the body executes.
#   - AN UNQUALIFIED SELECT ... INTO INSIDE A BODY. In PL/pgSQL that is a variable
#     assignment, and the text cannot tell it from a table creation. A qualified
#     public target inside a body is still read as a creation.
#   - IDENTIFIERS SPELLED __quoted__, __dynamic__ OR __body__. They are the lexer's
#     markers, and a real object with one of those names would be misread.
#
# Usage: bash scripts/lint_public_table_rls.sh [ROOT]
#   ROOT defaults to the repository root. The argument exists so tests/compliance/
#   can point this script at a scratch tree containing a planted violation -- do not
#   remove it because it looks unused.
# Exit: 0 clean, 1 violation, 2 usage, empty corpus, or a check that did not run.
# ============================================================
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
MIG_DIR="$ROOT/database/migrations"
[ -d "$MIG_DIR" ] || { echo "ERROR: no migration directory at $MIG_DIR" >&2; exit 2; }

# PORTABILITY: `mapfile` is bash 4+, and macOS ships bash 3.2.
#
# DOWN MIGRATIONS ARE IN THE CORPUS, deliberately: a down migration that re-creates
# a public table without RLS opens exactly the same hole as a forward one.
FILES=()
while IFS= read -r _line; do FILES+=("$_line"); done < <(find "$MIG_DIR" -maxdepth 1 -type f -name "*.sql" | sort)
[ "${#FILES[@]}" -gt 0 ] || { echo "ERROR: no migrations found in $MIG_DIR" >&2; exit 2; }

# The lexer. Exit 0 with statements on stdout; exit 3 with `LEXFAIL|<reason>` on
# stdout for input it refuses; anything else means it did not run. It is emitted by a
# function rather than captured with $(cat <<...) directly, because bash 3.2 scans a
# heredoc nested inside $(...) for quotes and parentheses and mis-parses this one.
lexer_source() {
    cat <<'PERL'
use strict;
my $file = $ARGV[0];
open(my $fh, '<', $file) or exit 4;
my $src = do { local $/; <$fh> };
close $fh;
my @out;
sub refuse { print "LEXFAIL|$_[0]\n"; exit 3; }
sub dynamic_form {
  return $_[0] =~ /\bcreate\s+(?:(?:global|local)\s+)?(?:(?:temporary|temp|unlogged|foreign)\s+)?table\b|\bset\s+schema\b|\bselect\b[\s\S]*\binto\b|\bimport\s+foreign\s+schema\b|\bcreate\s+extension\b/i;
}
sub lex {
  my ($s, $ctx) = @_;
  my $cur = '';
  my $emit = sub {
    my $t = lc $cur;
    $t =~ s/\s+/ /g;
    $t =~ s/ ?, ?/, /g;
    $t =~ s/^ | $//g;
    push @out, "$ctx|$t" if $t ne '';
    $cur = '';
  };
  pos($s) = 0;
  my $n = length $s;
  while (pos($s) < $n) {
    if ($s =~ /\G--[^\n]*/gc) { $cur .= ' '; next; }
    if ($s =~ /\G\/\*/gc) {
      my $d = 1;
      while ($d > 0) {
        if    ($s =~ /\G\/\*/gc)        { $d++; }
        elsif ($s =~ /\G\*\//gc)        { $d--; }
        elsif ($s =~ /\G(?:[^\/*]+|.)/gcs) { }
        else  { refuse('an unterminated /* comment'); }
      }
      $cur .= ' ';
      next;
    }
    my $esc = 0;
    if ($s =~ /\G([A-Za-z_][A-Za-z0-9_]*)/gc) {
      my $w = $1;
      if (lc $w eq 'e' && substr($s, pos($s), 1) eq "'") { $esc = 1; }
      else { $cur .= $w; next; }
    }
    if ($esc || $s =~ /\G'/gc) {
      pos($s)++ if $esc;
      my $content = '';
      while (1) {
        if    ($s =~ /\G''/gc)                    { $content .= "'"; }
        elsif ($esc && $s =~ /\G\\(.)/gcs)        { $content .= $1; }
        elsif ($s =~ /\G'/gc)                     { last; }
        elsif ($s =~ /\G([^'\\]+|\\)/gcs)         { $content .= $1; }
        else  { refuse('an unterminated string literal'); }
      }
      $cur .= dynamic_form($content) ? ' __dynamic__ ' : " '' ";
      next;
    }
    if ($s =~ /\G"/gc) {
      my $id = '';
      while (1) {
        if    ($s =~ /\G""/gc)       { $id .= '"'; }
        elsif ($s =~ /\G"/gc)        { last; }
        elsif ($s =~ /\G([^"]+)/gc)  { $id .= $1; }
        else  { refuse('an unterminated quoted identifier'); }
      }
      $cur .= ($id =~ /^[a-z_][a-z0-9_]*$/) ? $id : '__quoted__';
      next;
    }
    if ($s =~ /\G\$([A-Za-z_][A-Za-z0-9_]*)?\$/gc) {
      my $tag = defined $1 ? $1 : '';
      my $close = index($s, "\$$tag\$", pos($s));
      refuse("an unterminated \$$tag\$ body") if $close < 0;
      my $body = substr($s, pos($s), $close - pos($s));
      pos($s) = $close + length("\$$tag\$");
      lex($body, 'B');
      $cur .= ' __body__ ';
      next;
    }
    if ($s =~ /\G;/gc) { $emit->(); next; }
    if ($s =~ /\G([^;'"\$A-Za-z_\/-]+|.)/gcs) { $cur .= $1; next; }
  }
  $emit->();
}
lex($src, 'T');
print "$_\n" for @out;
PERL
}
LEXER="$(lexer_source)"

# Every pattern match goes through here, so a match that could not run is loud.
# `[[ =~ ]]` returns 2 on a pattern it cannot compile; branching on it directly
# would turn that into "no match" -- the fail-open shape test-conventions section 8
# bans for grep.
matches() {
    local st=0
    [[ $1 =~ $2 ]] || st=$?
    case "$st" in
        0|1) return "$st" ;;
        *) echo "ERROR: a pattern match did not run (status $st) -- nothing was checked" >&2; exit 2 ;;
    esac
}

RE_CREATE='(^| )create ((global|local) )?((temporary|temp|unlogged|foreign) )?table (if not exists )?([^ (,]+)'
RE_SELECT_INTO='(^| )select( .*)? into ((unlogged|temporary|temp) )?(table )?([^ ,(]+)'
RE_SET_SCHEMA='(^| )alter (foreign )?table (if exists )?(only )?([^ ]+) set schema ([^ ]+)'
RE_IMPORT='(^| )import foreign schema .* into ([^ ]+)'
RE_CREATE_EXT='(^| )create extension (if not exists )?([^ ]+)'

# THE ONE EXTENSION EXEMPTED BY NAME, and only when no SCHEMA clause is given.
# pg_cron is not relocatable and does not land in search_path's first schema: it
# sits in pg_catalog and its tables live in schema `cron`. OBSERVED 2026-09-23 on
# the local stack, not taken from documentation: extnamespace pg_catalog,
# extrelocatable f, and its extension-owned relations cron.job, cron.job_run_details,
# cron.jobid_seq, cron.runid_seq. 017 installs it with no SCHEMA clause.
FIXED_SCHEMA_EXTENSIONS=" pg_cron "
RE_EXT_SCHEMA=' schema ([^ ]+)'
RE_ALTER_EXT='(^| )alter extension [^ ]+ set schema ([^ ]+)'

VIOLATIONS=0
PAIRED=""

for f in "${FILES[@]}"; do
    name="$(basename "$f")"
    st=0
    norm="$(perl -e "$LEXER" "$f")" || st=$?
    case "$st" in
        0) ;;
        3) echo "FAIL: $name cannot be lexed, so nothing in it was checked: ${norm##*LEXFAIL|}"
           VIOLATIONS=$((VIOLATIONS+1))
           continue ;;
        *) echo "ERROR: the SQL lexer did not run -- nothing in $name was checked (exit $st)" >&2; exit 2 ;;
    esac

    STMTS=()
    NEED=""
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        ctx="${line%%|*}"
        s="${line#*|}"
        STMTS+=("$s")

        case "$s" in
            *__dynamic__*)
                echo "FAIL: $name builds SQL in a string that creates or moves a table, which this lint cannot read: ${s:0:160}"
                VIOLATIONS=$((VIOLATIONS+1)) ;;
        esac

        rest="$s"
        while matches "$rest" "$RE_CREATE"; do
            mod="${BASH_REMATCH[5]}"
            target="${BASH_REMATCH[7]}"
            rest="${rest#*"${BASH_REMATCH[0]}"}"
            case "$mod" in
                temp|temporary) continue ;;
                foreign)
                    # Only one that can land in public: named there, unqualified, or
                    # unreadable. A foreign table in another schema is not ours.
                    case "$target" in
                        *__quoted__*|public.*) ;;
                        *.*) continue ;;
                    esac
                    echo "FAIL: $name creates a foreign table, whose row level security this lint cannot establish: $target"
                    VIOLATIONS=$((VIOLATIONS+1))
                    continue ;;
            esac
            case "$target" in
                *__quoted__*) echo "FAIL: $name names a table with a quoted identifier this lint does not read (not plain lowercase): ${s:0:160}"
                              VIOLATIONS=$((VIOLATIONS+1)) ;;
                public.*) NEED="$NEED ${target#public.}:c" ;;
                *.*) ;;
                *) echo "FAIL: a table is created without a schema qualifier, so it lands wherever search_path points: $name: $target"
                   VIOLATIONS=$((VIOLATIONS+1)) ;;
            esac
        done

        si="${s//insert into/insert_into}"
        si="${si//merge into/merge_into}"
        if matches "$si" "$RE_SELECT_INTO"; then
            mod="${BASH_REMATCH[4]}"
            target="${BASH_REMATCH[6]}"
            case "$mod" in
                temp|temporary) ;;
                *)
                    case "$target" in
                        *__quoted__*) echo "FAIL: $name names a table with a quoted identifier this lint does not read (not plain lowercase): ${s:0:160}"
                                      VIOLATIONS=$((VIOLATIONS+1)) ;;
                        public.*) NEED="$NEED ${target#public.}:s" ;;
                        *.*) ;;
                        *) if [ "$ctx" = T ]; then
                               echo "FAIL: $name: a top-level SELECT INTO creates a table without a schema qualifier: $target"
                               VIOLATIONS=$((VIOLATIONS+1))
                           fi ;;
                    esac ;;
            esac
        fi

        if matches "$s" "$RE_SET_SCHEMA"; then
            foreign="${BASH_REMATCH[2]}"
            src="${BASH_REMATCH[5]}"
            dest="${BASH_REMATCH[6]}"
            case "$dest" in
                public|__quoted__)
                    if [ -n "$foreign" ]; then
                        echo "FAIL: $name creates a foreign table, whose row level security this lint cannot establish: $src"
                        VIOLATIONS=$((VIOLATIONS+1))
                    else
                        case "$src$dest" in
                            *__quoted__*) echo "FAIL: $name names a table with a quoted identifier this lint does not read (not plain lowercase): ${s:0:160}"
                                          VIOLATIONS=$((VIOLATIONS+1)) ;;
                            *) NEED="$NEED ${src##*.}:m" ;;
                        esac
                    fi ;;
            esac
        fi

        if matches "$s" "$RE_IMPORT"; then
            case "${BASH_REMATCH[2]}" in
                public|__quoted__) echo "FAIL: $name imports a foreign schema into public, whose tables this lint cannot see"
                                   VIOLATIONS=$((VIOLATIONS+1)) ;;
            esac
        fi

        ext=""
        if matches "$s" "$RE_CREATE_EXT"; then
            extname="${BASH_REMATCH[3]}"
            if matches "$s" "$RE_EXT_SCHEMA"; then
                ext="${BASH_REMATCH[1]}"
            else
                case "$FIXED_SCHEMA_EXTENSIONS" in
                    *" $extname "*) ext="" ;;
                    *) ext="public" ;;
                esac
            fi
        elif matches "$s" "$RE_ALTER_EXT"; then
            ext="${BASH_REMATCH[2]}"
        fi
        case "$ext" in
            public|__quoted__) echo "FAIL: $name installs an extension into public or wherever search_path points, and this lint cannot see what tables it creates: ${s:0:160}"
                               VIOLATIONS=$((VIOLATIONS+1)) ;;
        esac
    done <<EOF
$norm
EOF

    SEEN=" "
    for entry in $NEED; do
        t="${entry%%:*}"
        case "$SEEN" in *" $t "*) continue ;; esac
        SEEN="$SEEN$t "
        case "${entry##*:}" in
            c) how="created" ;;
            s) how="created by SELECT INTO" ;;
            *) how="moved into public" ;;
        esac

        en=1
        fo=1
        undone=""
        for s in ${STMTS[@]+"${STMTS[@]}"}; do
            case "$s" in "alter table "*) ;; *) continue ;; esac
            r="${s#alter table }"
            r="${r#if exists }"
            r="${r#only }"
            [ "${r%% *}" = "public.$t" ] || continue
            acts="${r#* }"
            while :; do
                a="${acts%%, *}"
                case "$a" in
                    "enable row level security") en=0 ;;
                    "force row level security") fo=0 ;;
                    "disable row level security"|"no force row level security") undone="$a" ;;
                esac
                [ "$acts" != "$a" ] || break
                acts="${acts#*, }"
            done
        done

        if [ "$en" -ne 0 ]; then
            echo "FAIL: public.$t is $how in $name and never ENABLEs row level security"
            echo "  A public table with RLS off is readable by anon the moment PostgREST exposes the schema."
            VIOLATIONS=$((VIOLATIONS+1))
        fi
        if [ "$fo" -ne 0 ]; then
            echo "FAIL: public.$t ENABLEs row level security in $name but never FORCEs it"
            echo "  Without FORCE the table owner bypasses its own policies, and the projection trigger is a SECURITY DEFINER function owned by that role."
            VIOLATIONS=$((VIOLATIONS+1))
        fi
        if [ -n "$undone" ]; then
            echo "FAIL: $name DISABLEs or NO-FORCEs row level security on public.$t, undoing the pairing: $undone"
            VIOLATIONS=$((VIOLATIONS+1))
        fi
        if [ "$en" -eq 0 ] && [ "$fo" -eq 0 ] && [ -z "$undone" ]; then
            PAIRED="$PAIRED $t"
        fi
    done
done

[ "$VIOLATIONS" -eq 0 ] || { echo "lint_public_table_rls.sh: FAILED ($VIOLATIONS)"; exit 1; }

# THE PASS LINE NAMES THE TABLES IT PAIRED, never just a count. A detector whose
# regex stopped matching would report a clean corpus and an empty list, and those
# two outcomes must not look the same. tests/compliance/lint_public_table_rls.test.ts
# asserts the four real names appear here.
echo "lint_public_table_rls.sh: PASS (${#FILES[@]} migrations; public tables paired:$PAIRED)"
