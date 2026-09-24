// ============================================================
// scripts/provision_target.mjs
// ============================================================
// THE HOST CHECK for scripts/provision_ward_account.mjs (R-2026-09-24-88 BP-6 5; the
// design report's section 3). A run meant for local must not be able to reach hosted,
// and a run meant for hosted must write only to the project it names.
//
// THE RULE:
//   - the Auth URL and the database URL are classified separately, each as LOCAL,
//     as a HOSTED project ref, or as unrecognised;
//   - both LOCAL, with no --project-ref: accepted;
//   - both HOSTED naming the SAME ref, with --project-ref naming that ref: accepted;
//   - everything else is refused, and the reason names both classifications: a mix
//     of local and hosted in either direction, two refs, a hosted pair with no flag,
//     a flag naming another ref, a flag on a local run, an unrecognised host.
//
// PARSED WITH new URL(), NEVER BY STRING SURGERY. scripts/seed.sh's hand-rolled strip
// is the recorded instance (test-conventions section 2, "the fifth"): stripping
// credentials in the wrong order parsed an ordinary local URL's host as `postgresql`.
// A password holding `@` or `:` must be percent-encoded in a URL anyway, and WHATWG
// parsing then finds the host where Postgres will.
//
// NOTHING HERE PRINTS A URL. A reason names hostnames and refs only, because the
// database URL carries the database password.
//
// A VARIABLE SET TO THE EMPTY STRING IS REFUSED, never read as unset: the caller
// passes `process.env.X ?? default`, and `??` keeps ''. An empty value is a confused
// environment, and the safe answer to confusion is a refusal, not a default.
//
// NOT ASSERTED HERE, deliberately:
//   - that the key belongs to the project. An sb_secret_ key carries no ref, so
//     nothing local can check it. A wrong key fails at Auth with 401 AFTER
//     app.provision_begin has opened an invite: failure point F2 in the design
//     report, loud, and retry-safe.
//   - THE -45 GATE (runbook step 4b). This check says WHERE a run writes, never
//     WHETHER the gate is clear. That stays a named human step.
//
// Exports classifyTarget() only. Exercised by tests/compliance/provision_ward_account.test.ts
// (the classifier's legs) and tests/db/provision_script.test.ts (the script refusing
// before any database write).
// ============================================================

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const REF = /^[a-z0-9]{20}$/;
const HOSTED_API = /^([a-z0-9]{20})\.supabase\.co$/;
const HOSTED_DB = /^db\.([a-z0-9]{20})\.supabase\.co$/;
const POOLER_HOST = /\.pooler\.supabase\.com$/;
const POOLER_USER = /^postgres\.([a-z0-9]{20})$/;

/** @returns {{ kind: 'local' } | { kind: 'hosted', ref: string } | { kind: 'refused', why: string }} */
function classifyApi(raw) {
  if (raw === '') return { kind: 'refused', why: 'SUPABASE_API_URL is set but empty' };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { kind: 'refused', why: 'SUPABASE_API_URL is not a URL' };
  }
  if (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname)) return { kind: 'local' };
  const m = HOSTED_API.exec(u.hostname);
  if (m !== null && u.protocol === 'https:' && u.port === '' && u.username === '' && u.password === '') return { kind: 'hosted', ref: m[1] };
  return { kind: 'refused', why: `SUPABASE_API_URL names ${u.protocol}//${u.hostname}, which is neither the local stack over http nor https://<ref>.supabase.co` };
}

/** @returns {{ kind: 'local' } | { kind: 'hosted', ref: string } | { kind: 'refused', why: string }} */
function classifyDb(raw) {
  if (raw === '') return { kind: 'refused', why: 'DATABASE_URL is set but empty' };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { kind: 'refused', why: 'DATABASE_URL is not a URL' };
  }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') return { kind: 'refused', why: `DATABASE_URL has the scheme ${u.protocol}, not postgresql:` };
  if (LOCAL_HOSTS.has(u.hostname)) return { kind: 'local' };
  const direct = HOSTED_DB.exec(u.hostname);
  if (direct !== null) return { kind: 'hosted', ref: direct[1] };
  if (POOLER_HOST.test(u.hostname)) {
    const user = POOLER_USER.exec(decodeURIComponent(u.username));
    if (user !== null) return { kind: 'hosted', ref: user[1] };
    return { kind: 'refused', why: `DATABASE_URL names the pooler ${u.hostname} with a user that names no project` };
  }
  return { kind: 'refused', why: `DATABASE_URL names ${u.hostname}, which is neither the local stack nor a Supabase database host` };
}

const said = (c) => (c.kind === 'local' ? 'the local stack' : `project ${c.ref}`);

/**
 * @param {{ apiUrl: string, dbUrl: string, projectRef: string | undefined }} input
 * @returns {{ ok: true, target: 'local' | string } | { ok: false, reason: string }}
 */
export function classifyTarget({ apiUrl, dbUrl, projectRef }) {
  const api = classifyApi(apiUrl);
  const db = classifyDb(dbUrl);
  if (api.kind === 'refused') return { ok: false, reason: api.why };
  if (db.kind === 'refused') return { ok: false, reason: db.why };
  if (projectRef !== undefined && !REF.test(projectRef)) {
    return { ok: false, reason: '--project-ref is not a project ref (twenty lowercase letters and digits)' };
  }

  if (api.kind === 'local' && db.kind === 'local') {
    if (projectRef !== undefined) return { ok: false, reason: `--project-ref ${projectRef} was given, but SUPABASE_API_URL and DATABASE_URL both name the local stack` };
    return { ok: true, target: 'local' };
  }
  if (api.kind === 'hosted' && db.kind === 'hosted') {
    if (api.ref !== db.ref) return { ok: false, reason: `SUPABASE_API_URL names ${said(api)} and DATABASE_URL names ${said(db)}` };
    if (projectRef === undefined) return { ok: false, reason: `both URLs name ${said(api)}, and a non-local run needs --project-ref ${api.ref} to say so` };
    if (projectRef !== api.ref) return { ok: false, reason: `--project-ref ${projectRef} was given, but both URLs name ${said(api)}` };
    return { ok: true, target: api.ref };
  }
  return { ok: false, reason: `SUPABASE_API_URL names ${said(api)} and DATABASE_URL names ${said(db)}` };
}
