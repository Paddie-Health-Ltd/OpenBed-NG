/**
 * THE `curl` STAND-IN FOR scripts/edge_guard.sh (R-2026-09-30-217 GP).
 *
 * Three test files run the guard: tests/compliance/edge_guard.test.ts (the function itself) and the two
 * wrapper harnesses, tests/compliance/deploy_guards.test.ts and tests/compliance/deploy_worker.test.ts.
 * They share ONE stand-in, imported and not restated, so the three cannot disagree about what a trace looks
 * like (test-conventions section 8, the shared-fixture link: the link is code).
 *
 * WHY A STAND-IN AND NOT A SEAM IN THE SCRIPT. The guard has no override: no environment variable names
 * another URL or switches it off, because such a seam is how a guard is disabled at 2am. The only way a test
 * decides what the "trace" says is a `curl` first on PATH, as the Worker harness already does for its
 * read-back. The stand-in answers ONLY a request for a trace URL and refuses any other request loudly (exit 99).
 *
 * WHAT A TEST CONTROLS, through the environment of the run:
 *   - STUB_TRACE_BODY unset  -> an ordinary trace from London (colo=LHR, loc=GB), the most ordinary valid input;
 *   - STUB_TRACE_BODY="..."  -> exactly that text, the empty string included;
 *   - STUB_TRACE_EXIT=<n>    -> curl fails with that exit status and prints a resolver error on stderr.
 * Every request is appended to $STUB_LOG, so a leg can assert the guard ASKED, and in what order.
 */

/** A real-shaped trace: many lines, of which the guard reads two. The address is a documentation address. */
export const OK_TRACE =
  'fl=100f1\nh=www.cloudflare.com\nip=203.0.113.7\nts=1760000000.123\nvisit_scheme=https\nuag=curl/8.7.1\n' +
  'colo=LHR\nsliver=none\nhttp=http/2\nloc=GB\ntls=TLSv1.3\nsni=plaintext\nwarp=off\ngateway=off\nrbi=off\nkex=X25519\n';

/**
 * The bash fragment that answers a trace request. It expects `$STUB_LOG` and to be placed AFTER the stub's
 * `-q` check and BEFORE anything that counts requests, so a trace request is never counted as a read-back.
 */
export const TRACE_ANSWER = `case "$*" in
  *cdn-cgi/trace*)
    if [ -n "\${STUB_TRACE_EXIT:-}" ]; then
      echo "curl: (6) Could not resolve host: www.cloudflare.com" >&2
      exit "$STUB_TRACE_EXIT"
    fi
    if [ -z "\${STUB_TRACE_BODY+x}" ]; then
      printf 'fl=100f1\\nvisit_scheme=https\\ncolo=LHR\\nloc=GB\\n'
    else
      printf '%s' "$STUB_TRACE_BODY"
    fi
    exit 0 ;;
esac
`;

/** The whole stand-in for a harness that makes no other request (the Pages wrapper). */
export const TRACE_ONLY_CURL = `#!/usr/bin/env bash
echo "curl $*" >> "$STUB_LOG"
# Every request starts with -q so curl ignores the caller's ~/.curlrc (R-2026-09-30-181 FE-5).
[ "$1" = "-q" ] || { echo "curl stub: the first argument must be -q, so that ~/.curlrc is not read" >&2; exit 98; }
${TRACE_ANSWER}echo "curl stub: a request other than the edge trace: $*" >&2
exit 99
`;
