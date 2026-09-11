#!/usr/bin/env node
// ============================================================
// scripts/provision_ward_account.mjs
// ============================================================
// Provisions ONE ward account: invites a role address through the GoTrue admin
// API, then writes the app.ward_account row whose id EQUALS that auth user's id.
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
// NOT ASSERTED HERE, deliberately: that the address IS a role address rather
// than a nurse's personal mailbox. There is no technical check that
// distinguishes them and there will not be one -- amina.bello@lasuth.gov.ng is a
// personal address on a facility domain and passes any heuristic cleanly, with
// the false-negative rate highest on exactly the population that matters. The
// mitigation is contractual, and a boolean recording the Operator's belief would
// be worse than absent: it turns "the Operator makes no determination" into a
// self-generated document in which the Operator did.
//
// Usage:
//   node scripts/provision_ward_account.mjs --email <addr> --facility <uuid> \
//        --category <ward_category> [--role WARD_STAFF]
// Exit: 0 provisioned, 1 usage or a refusal, 2 the environment is not usable.
// ============================================================
import postgres from 'postgres';

const LOCAL_DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_API = 'http://127.0.0.1:54321';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (typeof k !== 'string' || !k.startsWith('--') || v === undefined) return null;
    out[k.slice(2)] = v;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args === null || !args.email || !args.facility || !args.category) {
  console.error('usage: node scripts/provision_ward_account.mjs --email <addr> --facility <uuid> --category <ward_category> [--role WARD_STAFF]');
  process.exit(1);
}

const role = args.role ?? 'WARD_STAFF';
const apiUrl = process.env.SUPABASE_API_URL ?? LOCAL_API;
const dbUrl = process.env.DATABASE_URL ?? LOCAL_DB;
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

// NOTE, and this is a leg that was DELETED rather than left in.
//
// There was a check here refusing a WARD_STAFF account with no ward category,
// citing the scope CHECK in migration 003. It could never fire: the usage check
// above already exits when --category is absent, so the condition was
// unreachable by construction. An unreachable leg is worse than an absent one
// because it READS AS COVERAGE -- someone auditing this script would count a
// scope guard that cannot run. The real enforcement is the
// ward_account_scope_matches_role CHECK in the database, which has deliberately
// no arm permitting a facility-less account below PLATFORM_ADMIN.

async function json(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`GoTrue returned a non-JSON body (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
}

/**
 * Invite through the admin API.
 *
 * THE SAME ROUTE tests/setup/auth.ts PROVED, not a second one. That harness was
 * written against the response shape observed on GoTrue v2.196.0, where the
 * minted field is `hashed_token` and `verification_type` comes back as "signup"
 * for an address GoTrue has never seen. Building a parallel route here would
 * mean the E2E proves one path and production uses another.
 */
async function inviteRoleAddress(email) {
  const res = await fetch(`${apiUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const body = await json(res);
  if (res.status !== 200) {
    throw new Error(`admin/generate_link refused the invite (HTTP ${res.status}): ${JSON.stringify(body)}`);
  }
  if (typeof body.id !== 'string') {
    throw new Error(`admin/generate_link returned no auth user id. Keys: ${Object.keys(body).sort().join(', ')}`);
  }
  return { userId: body.id, hashedToken: body.hashed_token, verificationType: body.verification_type };
}

const sql = postgres(dbUrl, { max: 1, onnotice: () => {} });

try {
  const invite = await inviteRoleAddress(args.email);

  // ONE TRANSACTION. The invite row and the account row are the same fact
  // recorded twice, and a half-provisioned account -- an auth user with no
  // ward_account -- fails at my_facility_wards() with NOT_A_MEMBER, which reads
  // like a permissions bug rather than an incomplete setup.
  await sql.begin(async (tx) => {
    await tx`
      insert into app.invite (facility_id, ward_category, role, accepted_at)
      values (${args.facility}::uuid, ${args.category}::app.ward_category, ${role}::app.app_role, now())
    `;
    await tx`
      insert into app.ward_account (id, facility_id, ward_category, role)
      values (${invite.userId}::uuid, ${args.facility}::uuid, ${args.category}::app.ward_category, ${role}::app.app_role)
      on conflict (id) do nothing
    `;
  });

  console.log(`provisioned ${role} ${args.email} -> ward_account ${invite.userId} (${args.category} @ ${args.facility})`);
  console.log(`  verification_type=${invite.verificationType}`);
} catch (e) {
  console.error(`ERROR: provisioning failed for ${args.email}: ${e.message}`);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
