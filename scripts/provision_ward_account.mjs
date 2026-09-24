#!/usr/bin/env node
// ============================================================
// scripts/provision_ward_account.mjs
// ============================================================
// Provisions ONE account -- a ward's, or the operator's -- THROUGH THE GATES:
// app.provision_begin, then GoTrue's admin generate_link only if begin says `open`,
// then app.provision_complete. The account row's id EQUALS the auth user's id.
//
// RESTATED 2026-09-24 (R-2026-09-24-88 BP-6, R-2026-09-24-90 BR-1; PR 3.4b-app A).
// Until then this script called generate_link FIRST and inserted an accepted
// app.invite and an app.ward_account directly, so none of the invite gates ran on
// the one path that creates logins, and a re-run on a complete ward minted a new
// token. It now writes no app.* table at all (BP-6 4): the gates have one
// implementation, in SQL (020, 021, 022).
//
// STOP -- READ THIS BEFORE YOU RUN THIS SCRIPT AGAINST THE HOSTED PROJECT.
//
// NOTHING MAY CREATE THE FIRST app.ward_account ROW -- OR THE FIRST app.facility
// ROW -- ON THE HOSTED PROJECT UNTIL RUNBOOK STEP 4b READS CLEAR
// (R-2026-09-21-45). Whatever the reason for creating it: a test, a staging trial,
// a signed agreement or no agreement at all. The trigger is THE ROW, not the
// occasion, because onboarding can be staged and an account created "just to try
// it" makes every open item live before anyone intends it.
//
// RESTATED 2026-09-24 (R-2026-09-24-75 BC-2), with runbook step 4b, which holds the
// evidence for each item. The three defects this block used to list are CLOSED in
// the code: the "(unknown facility)" row is dropped (callableIdentity,
// apps/public-dashboard/src/main.ts); wardRowFrom refuses a malformed row rather than
// defaulting it (apps/ward-console/src/main.ts); and a server refusal reaches a ward
// only as a fixed sentence (wardMessageFor, same file). The invite gate it named as
// not built is app.provision_begin (migration 020, applied on hosted 2026-09-24);
// 021 restates it to read app.facility_agreement, off the contact person's row
// (R-2026-09-24-76 BD-1). From PR 3.4b-app A this script goes through it.
// ONE ITEM IS STILL OPEN: no backup of the hosted project has ever been restored
// (R-2026-09-24-74 BB-4). So the gate has not cleared.
//
// THIS IS A NAMED HUMAN STEP. NOTHING IN THIS SCRIPT ENFORCES IT -- there is no
// check below that reads the list above, and a reader must not infer one
// (Clause 4 of .claude/rules/code-pipeline.md). A mechanical guard is PROPOSED
// and deliberately not built: see R-2026-09-21-45.
// RESTATED 2026-09-24 (BP-6 5): this block used to add that the script had NO host
// check at all. It now has one (scripts/provision_target.mjs), and it is NOT this
// guard: the host check says WHERE a run writes -- the Auth URL and the database URL
// must name the same project, and a non-local run must name that project with
// --project-ref -- never WHETHER step 4b is clear.
//
// ============================================================
//
// THIS IS THE auth.uid() -> app.ward_account SEAM, and nothing else in the
// repository creates it. database/migrations/003 declares
// `id uuid PRIMARY KEY` with NO foreign key to auth.users -- deliberately, since
// `auth` is Supabase's schema and a cross-schema FK would couple the migration
// ledger to a vendor table. The consequence is that NOTHING AT THE SCHEMA LEVEL
// ENFORCES THE LINKAGE. This script is the only thing that makes it true, which
// is why it is the only sanctioned way to create a ward account.
//
// A SCRIPT, NOT AN RPC, and the reason is a security boundary rather than
// convenience. Sprint 1 ships no self-serve admin surface anywhere, so an
// `accept_invite` RPC would be a client-reachable WRITE surface with no caller.
//   SUPERSEDED 2026-09-24 (R-2026-09-24-88 BP-6 7; method note 8, marked and not
//   deleted): the premise "Sprint 1 ships no self-serve admin surface" becomes
//   untrue with PR 3.4b-app C, the admin app. The conclusion stands on a different
//   reason: the admin app cannot create an Auth user without the secret key, which
//   no browser holds (-71 C), so provisioning stays here, over the SQL gates, and
//   no public function provisions in v1.
// Holding that surface at exactly one function is what keeps the RPC execute
// allowlist cheap to keep honest -- every function on it is a thing someone must
// justify, and a list with one entry is reviewable at a glance.
//
// WHY IT INVITES RATHER THAN CREATING A USER OUTRIGHT. The invite goes to a WARD
// ROLE ADDRESS -- maternity@<facility> -- never to a person. app.invite carries
// facility_id, ward_category, role and the two timestamps, and deliberately NO
// ADDRESS COLUMN: the address lives once, in auth.users, so there is exactly one
// place to erase. See docs/facility-agreement-clause-x-access-addresses.md for
// what the Operator does and does not warrant about that address.
//
// THE OPERATOR (--role PLATFORM_ADMIN): no facility and no category, and the same
// three calls. The operator's sign-in address is never written into this
// repository (R-2026-09-24-89 BQ-1): it is given here, at run time, and nowhere
// else. With 022, at most one operator is active: a re-run once one exists is
// `complete` with no Auth call, and a second address is refused by name.
//
// NOT ASSERTED HERE, deliberately: that the address IS a role address rather
// than a nurse's personal mailbox. There is no technical check that
// distinguishes them and there will not be one -- amina.bello@lasuth.gov.ng is a
// personal address on a facility domain and passes any heuristic cleanly, with
// the false-negative rate highest on exactly the population that matters. The
// mitigation is contractual, and a boolean recording the Operator's belief would
// be worse than absent: it turns "the Operator makes no determination" into a
// self-generated document in which the Operator did.
//
// RETRY-SAFE FROM EVERY POINT OF FAILURE (BP-6 3). begin and complete are two
// statements, never one transaction: an Auth call sits between them, and a
// transaction held across it would roll a write back when the call failed, or hold
// locks for the length of its timeouts. If generate_link or complete fails, the
// invite stays OPEN and the run says "setup incomplete"; a re-run of the same
// command finds the same invite (begin), gets the same auth user (generate_link
// returns the existing user for a known address) and completes. That failure never
// reads as a permissions bug. The second generate_link mints a new token, which is
// safe: no account exists yet, so no ward can be using a link.
//
// generate_link: 12 s per attempt, at most 3 attempts, and only on a network error,
// a 5xx or a 429, with backoff and full jitter. A 4xx is never retried. Its token
// and link are NEVER printed. Headers: `apikey` and `Authorization: Bearer`, the one
// shape local GoTrue accepted for BOTH key kinds on 2026-09-24 -- the legacy JWT is
// refused without Bearer (HTTP 401 no_authorization); an sb_secret_ key is accepted
// either way (PR 3.4b-app A's body quotes the four readings).
//
// Usage:
//   node scripts/provision_ward_account.mjs --email <address> --facility <uuid> \
//        --category <ward_category> [--role WARD_STAFF] [--project-ref <ref>]
//   node scripts/provision_ward_account.mjs --role PLATFORM_ADMIN \
//        --email <the operator's sign-in address> [--project-ref <ref>]
// Environment: SUPABASE_SERVICE_ROLE_KEY (required; never defaulted),
//   SUPABASE_API_URL and DATABASE_URL (default: the local stack). A non-local pair
//   needs --project-ref naming the project both URLs name.
// Exit: 0 provisioned, reactivated or already complete; 1 usage, a refusal, or
//       setup incomplete; 2 the environment is not usable (key, host check).
//       Exit 0 does NOT mean the STOP condition at the top of this file was
//       satisfied. Nothing here checks it.
// ============================================================
import postgres from 'postgres';
import { classifyTarget } from './provision_target.mjs';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_API = 'http://127.0.0.1:54321';
const FLAGS = new Set(['email', 'facility', 'category', 'role', 'project-ref']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (typeof k !== 'string' || !k.startsWith('--') || v === undefined) return null;
    if (!FLAGS.has(k.slice(2)) || Object.hasOwn(out, k.slice(2))) return null;
    out[k.slice(2)] = v;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const role = args?.role ?? 'WARD_STAFF';
const scopeOk =
  role === 'PLATFORM_ADMIN'
    ? args?.facility === undefined && args?.category === undefined
    : role !== 'WARD_STAFF' || (Boolean(args?.facility) && Boolean(args?.category));
if (args === null || !args.email || !scopeOk) {
  // A literal, not a constant: the leg register reads failure messages from
  // console.error's own argument (tests/compliance/_legs.ts).
  console.error('usage: node scripts/provision_ward_account.mjs --email <address> (--facility <uuid> --category <ward_category> [--role WARD_STAFF] | --role PLATFORM_ADMIN) [--project-ref <ref>]');
  process.exit(1);
}

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  // A STOP CONDITION, NOT A FALLBACK. This project has been bitten by a fallback
  // that outlived the thing it fell back to: get_publishable_key.sh preferred a
  // new key and fell back to a legacy one, and when legacy keys were disabled it
  // could only ever return a DEAD key -- printed to stdout, indistinguishable
  // from a good one, failing later at authentication in the safe-looking
  // direction. A missing credential is a refusal with a message, never a guess.
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY is not set — refusing to guess a credential');
  process.exit(2);
}

const apiUrl = process.env.SUPABASE_API_URL ?? LOCAL_API;
const dbUrl = process.env.DATABASE_URL ?? LOCAL_DB;
const target = classifyTarget({ apiUrl, dbUrl, projectRef: args['project-ref'] });
if (!target.ok) {
  console.error(`REFUSING: the host check did not pass, and nothing was read or written: ${target.reason}`);
  process.exit(2);
}

// The sentence a founder reads for each refusal the gates can raise. The code is
// always printed too: it is what the runbook and the record name.
const SENTENCES = {
  NO_FACILITY_CONTACT: 'record the facility contact first',
  AGREEMENT_NOT_RECORDED: "record the facility's data-sharing agreement first",
  AGREEMENT_WITHDRAWN: "the facility's agreement is withdrawn; no login is provisioned for it",
  NO_SUCH_FACILITY: 'no facility has that id',
  NO_SUCH_WARD: 'add that category to the facility first',
  ROLE_NOT_PROVISIONED_IN_V1: 'that role is not provisioned in v1',
  INVALID_ARGUMENT: 'an argument was not accepted',
  NO_SUCH_INVITE: 'the invite this run opened no longer exists; re-run the same command',
  ACCOUNT_SCOPE_CONFLICT: 'this address already holds an account with another scope; use a different role address',
  WARD_ALREADY_HAS_AN_ACCOUNT: "this ward already has an active account; replacing its address means deactivating that account first (a founder SQL step)",
  OPERATOR_ALREADY_EXISTS: 'an active operator account already exists; a second one needs its own ruling (BD-2 1)',
  INVITE_ALREADY_ACCEPTED: 'another run completed this invite first; re-run the same command to read the result',
};

/** A gate's refusal: PL/pgSQL `RAISE EXCEPTION '<CODE>'` arrives as SQLSTATE P0001 with the code as its message. */
const refusalCode = (e) => (e && e.code === 'P0001' && /^[A-Z][A-Z0-9_]*$/.test(e.message) ? e.message : null);
const said = (code) => `${code}${Object.hasOwn(SENTENCES, code) ? ` — ${SENTENCES[code]}` : ''}`;

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GoTrue returned a non-JSON body (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
}

const pause = (attempt) => new Promise((r) => setTimeout(r, Math.random() * 500 * 2 ** (attempt - 1)));

/**
 * The auth user for this address, through the admin API.
 *
 * THE SAME ROUTE tests/setup/auth.ts PROVED, not a second one. That harness was
 * written against the response shape observed on GoTrue v2.196.0, where the
 * minted field is `hashed_token` and `verification_type` comes back as "signup"
 * for an address GoTrue has never seen. For a known address it returns the SAME
 * user id, which is what makes a re-run after a failed complete finish the job.
 */
async function authUserFor(email) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`${apiUrl}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'magiclink', email }),
        signal: AbortSignal.timeout(12_000),
      });
    } catch (e) {
      if (attempt >= 3) throw new Error(`admin/generate_link could not be reached after ${attempt} attempts: ${e.message}`);
      await pause(attempt);
      continue;
    }
    if ((res.status >= 500 || res.status === 429) && attempt < 3) {
      await res.text();
      await pause(attempt);
      continue;
    }
    const body = await json(res);
    if (res.status !== 200) {
      throw new Error(`admin/generate_link refused the invite (HTTP ${res.status}): ${JSON.stringify(body)}`);
    }
    if (typeof body.id !== 'string') {
      throw new Error(`admin/generate_link returned no auth user id. Keys: ${Object.keys(body).sort().join(', ')}`);
    }
    return { userId: body.id, verificationType: body.verification_type };
  }
}

const sql = postgres(dbUrl, { max: 1, onnotice: () => {}, connect_timeout: 10, connection: { application_name: 'provision_ward_account' } });
const scope = role === 'PLATFORM_ADMIN' ? 'the operator' : `${args.category} @ ${args.facility}`;
let code = 0;

try {
  let opened;
  try {
    [opened] = await sql`select * from app.provision_begin(${args.facility ?? null}::uuid, ${args.category ?? null}::text, ${role}::text)`;
  } catch (e) {
    const refused = refusalCode(e);
    if (refused === null) throw e;
    console.error(`REFUSED by app.provision_begin: ${said(refused)}. No invite was opened and no Auth call was made.`);
    code = 1;
  }

  if (opened?.status === 'complete') {
    // J4, and BR-1 b for the operator: nothing opened, and no Auth admin request.
    console.log(role === 'PLATFORM_ADMIN'
      ? 'an operator account already exists: nothing was done, and no Auth call was made'
      : `already complete: ${scope} has its account; nothing opened, no Auth call made`);
  } else if (opened?.status === 'open') {
    const invite = opened.invite_id;
    let user;
    let done;
    try {
      user = await authUserFor(args.email);
      [done] = await sql`select * from app.provision_complete(${invite}::uuid, ${user.userId}::uuid)`;
    } catch (e) {
      const refused = refusalCode(e);
      if (refused !== null) {
        console.error(`REFUSED by app.provision_complete: ${said(refused)}. Invite ${invite} is still open.`);
      } else {
        console.error(`ERROR: setup incomplete: invite ${invite} is open and no account exists yet — re-run the same command. Cause: ${e.message}`);
      }
      code = 1;
    }
    if (done?.status === 'complete') {
      console.log(`provisioned ${role} ${args.email} -> account ${user.userId} (${scope})`);
      console.log(`  verification_type=${user.verificationType}`);
    } else if (done?.status === 'reactivated') {
      console.log(`reactivated ${role} ${args.email} -> account ${user.userId} (${scope})`);
    } else if (done !== undefined) {
      console.error(`ERROR: unrecognised status from provision_complete: ${JSON.stringify(done.status)}`);
      code = 1;
    }
  } else if (code === 0) {
    console.error(`ERROR: unrecognised status from provision_begin: ${JSON.stringify(opened?.status)}`);
    code = 1;
  }
} catch (e) {
  console.error(`ERROR: provisioning failed for ${args.email}: ${e.message}`);
  code = 1;
} finally {
  await sql.end({ timeout: 5 });
}
process.exit(code);
