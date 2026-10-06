import { describe, expect, test } from 'vitest';
import STEPS from '../../packages/fixtures/golden-path-steps.json';
import SHAPE from '../../packages/fixtures/snapshot-shape.json';
import { sql, scheduledJobPauseViolations } from '../setup/db.js';
import { anonKey, apiUrl } from '../setup/local-keys.js';
import {
  mintMagicLink,
  verifyToken,
  forceLinkExpiry,
  wardSession,
  signInWard,
  authedRest,
  type MintedLink,
  type WardSession,
} from '../setup/auth.js';
import {
  ALPHA,
  BETA,
  WARD_EMAIL,
  PUBLISH_CATEGORY,
  STALE_CATEGORY,
  E2E_OPERATOR_EMAIL,
  ALPHA_CONTACT,
  ALPHA_AGREEMENT,
  ALPHA_CATEGORIES,
  loadFuture,
  provisionE2eWardAccounts,
  provisionE2eReporter,
  GAMMA,
  GAMMA_CATEGORIES,
  GAMMA_CONTACT,
  GAMMA_AGREEMENT,
  REPORTER_EMAIL,
  restoreAlphaWardBaseline,
  assertAlphaPublic,
} from './_harness.js';
import {
  RPC,
  addCategoryBody,
  createFacilityBody,
  getContactBody,
  recordAgreementBody,
  recordContactBody,
  recordRegistrationBody,
  recordReportingApprovalBody,
  registerBody,
  setListedBody,
} from '../../apps/admin/src/bodies.js';

/**
 * RELEASE GATE 2, EXECUTED. One test per entry in
 * packages/fixtures/golden-path-steps.json, in fixture order.
 *
 * THIS FILE IS NOT THE GATE. tests/e2e/ratchet.test.ts is, and it reads this
 * file's junit output. This suite is CORPUS GENERATION -- it stands to the ratchet
 * exactly as the built bundle stands to bundle-guards -- and it is EXPECTED to be
 * partially red, because every step past the frontier is a real assertion against
 * code that has not been written yet.
 *
 * NO .skip AND NO .todo IN THIS DIRECTORY, EVER. Standard O's cardinal sin is
 * reaching green by skipping, and here it is worse than usual: a skipped step
 * reads as PASSING to ratchet assertion (1) and dodges assertion (2) entirely, so
 * the frontier could be walked forward over steps nobody ever ran.
 *
 * BANNED BY NAME, because both would make this suite a rubber stamp: obtaining a
 * ward session through admin/createUser plus a minted session, and hand-signing a
 * JWT. Both bypass POST /auth/v1/verify itself and then claim to have proved
 * magic-link auth. The only sanctioned route is in tests/setup/auth.ts and it
 * bypasses the email TRANSPORT and nothing else.
 *
 * NOT ASSERTED HERE, deliberately: real browser paint, for every step except the
 * two the fixture marks needs_browser. jsdom with fake timers proves the poll
 * fires; it does not prove a phone renders it.
 *
 * Test names are `<step-id> — <description>`, so the step id is the first token in
 * the junit and the ratchet can key results to the fixture by identity rather
 * than by position.
 */

interface TilesModule {
  renderTiles: (at: { lat: number; lng: number }) => Promise<{ facilityId: string }[]>;
  pollOnce: () => Promise<void>;
}

const byId = new Map(STEPS.steps.map((s) => [s.id, s]));

function name(id: string): string {
  const step = byId.get(id);
  if (!step) throw new Error(`no fixture entry for step id "${id}"`);
  return `${step.id} — ${step.description}`;
}

/** Shared across steps within the single-threaded run. */
const state: { link?: MintedLink; expiringLink?: MintedLink; operator?: WardSession; reporter?: WardSession } = {};

/**
 * THE OPERATOR'S SESSION: the E2E operator global setup bootstrapped through the
 * provisioning script, signed in by the same mint-and-verify route every ward session
 * here takes. Held in this file's state, not wardSession's cache, so the ward steps'
 * one cached session is not displaced.
 */
async function operatorCall(fn: string, body: unknown) {
  state.operator ??= await signInWard(E2E_OPERATOR_EMAIL);
  return authedRest(`rpc/${fn}`, state.operator, { method: 'POST', body: body as Record<string, unknown> });
}

/** GAMMA's register row (R-2026-09-27-144 DT), read as the admin app reads it. */
async function gammaInRegister(): Promise<Record<string, unknown>> {
  const r = await operatorCall(RPC.register, registerBody());
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const row = (r.body as { facilities: Record<string, unknown>[] }).facilities.find((f) => f['facility_id'] === GAMMA.id);
  expect(row, 'GAMMA is not in the operator register').toBeDefined();
  return row as Record<string, unknown>;
}

/**
 * THE FACILITY-LEVEL REPORTER'S SESSION, minted and verified by the same route as every
 * other session here, and held apart from wardSession's one cached session.
 */
async function reporterCall(fn: string, body: Record<string, unknown>) {
  state.reporter ??= await signInWard(REPORTER_EMAIL);
  return authedRest(`rpc/${fn}`, state.reporter, { method: 'POST', body });
}

/** ALPHA's register row, read as the admin app reads it. */
async function alphaInRegister(): Promise<Record<string, unknown>> {
  const r = await operatorCall(RPC.register, registerBody());
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const row = (r.body as { facilities: Record<string, unknown>[] }).facilities.find((f) => f['facility_id'] === ALPHA.id);
  expect(row, 'ALPHA is not in the operator register').toBeDefined();
  return row as Record<string, unknown>;
}

/**
 * One id per run, suffixed onto every client_mutation_id. Since 014 a mutation id
 * already recorded for a ward is a REPLAY -- it returns the current state and
 * writes nothing -- and the E2E ward's history is append-only, so it survives
 * between local runs. A fixed id would make the second run's publish a replay of
 * the first run's, and version would never move.
 */
const RUN = Date.now().toString(36);

/** publish_ward_status's result row (014): the ward's claim and the public view, never one field for both. */
interface PublishContract {
  version?: number;
  replayed?: boolean;
  claim_bed_count?: number | null;
  claim_accepting?: boolean;
  public_listed?: boolean;
  public_bed_count?: number | null;
  public_accepting_effective?: boolean | null;
  public_gated_by?: string | null;
}

describe('golden path — release gate 2', () => {
  // ------------------------------------------------ the operator step (BP-12)
  // Through the same functions the admin app calls, with the bodies it sends. A facility
  // is deactivated between runs, never deleted, so each step asserts against the state
  // read just before its call: on a fresh database (CI's) every write is real; on one
  // that has run before, each is the identical repeat the app's retry model relies on.
  test(name('operator-creates-facility'), async () => {
    const [before] = await sql()<{ n: number }[]>`select count(*)::int as n from app.facility where id = ${ALPHA.id}::uuid`;
    const fields = { name: ALPHA.name, lga: ALPHA.lga, state: 'Lagos', lat: ALPHA.lat, lng: ALPHA.lng, publicPhoneE164: ALPHA.phone };
    const first = await operatorCall(RPC.createFacility, createFacilityBody(ALPHA.id, fields));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect((first.body as { created: boolean }[])[0]?.created, 'created must be true exactly when ALPHA did not exist').toBe(before?.n === 0);
    const again = await operatorCall(RPC.createFacility, createFacilityBody(ALPHA.id, fields));
    expect((again.body as { created: boolean }[])[0]?.created, 'the same id and fields made a second facility').toBe(false);
    const [after] = await sql()<{ n: number }[]>`select count(*)::int as n from app.facility where id = ${ALPHA.id}::uuid`;
    expect(after?.n).toBe(1);
  });

  test(name('operator-records-contact-and-agreement'), async () => {
    const [had] = await sql()<{ n: number }[]>`select count(*)::int as n from app.facility_agreement where facility_id = ${ALPHA.id}::uuid`;
    const contact = await operatorCall(RPC.recordContact, recordContactBody(ALPHA.id, ALPHA_CONTACT, null));
    expect(contact.status, JSON.stringify(contact.body)).toBe(200);
    const agreement = await operatorCall(
      RPC.recordAgreement,
      recordAgreementBody(ALPHA.id, ALPHA_AGREEMENT.acceptedOn, ALPHA_AGREEMENT.version, ALPHA_AGREEMENT.signatoryRole),
    );
    expect(agreement.status, JSON.stringify(agreement.body)).toBe(200);
    expect((agreement.body as { recorded: boolean }[])[0]?.recorded, 'recorded must be true exactly when no agreement existed').toBe(had?.n === 0);
    const read = await operatorCall(RPC.getContact, getContactBody(ALPHA.id));
    const view = read.body as { contact: { full_name: string } | null; agreement: { version: string; withdrawn_on: string | null } | null };
    expect(view.contact?.full_name).toBe(ALPHA_CONTACT.fullName);
    expect(view.agreement?.version).toBe(ALPHA_AGREEMENT.version);
    expect(view.agreement?.withdrawn_on).toBeNull();
    // 029 (R-2026-09-30-201 GA): app.provision_begin also reads the facility's approved reporting model, so it is
    // recorded from the signed Schedule 1 BEFORE any login is provisioned. ALPHA reports per ward. It is recorded
    // inside this step and not as a new one, so the step list and the ratchet's frontier do not move. A re-run
    // on the same database finds the logins already there, so the state may already read MATCHES; it never
    // reads MISMATCH, which would mean the approval and the logins disagree.
    const approval = await operatorCall(RPC.recordReportingApproval, recordReportingApprovalBody(ALPHA.id, 'WARD', ALPHA_AGREEMENT.acceptedOn, 'Medical Director'));
    expect(approval.status, `operator_record_reporting_approval failed: ${JSON.stringify(approval.body)}`).toBe(200);
    const approved = await alphaInRegister();
    expect([approved['approved_model'], approved['approved_on']]).toEqual(['WARD', ALPHA_AGREEMENT.acceptedOn]);
    expect(['NOT_YET_PROVISIONED', 'MATCHES'], `ALPHA reads ${String(approved['reporting_approval_state'])} right after its approval`).toContain(approved['reporting_approval_state']);
  });

  test(name('operator-adds-category'), async () => {
    for (const category of ALPHA_CATEGORIES) {
      const [had] = await sql()<{ n: number }[]>`
        select count(*)::int as n from app.ward_status where facility_id = ${ALPHA.id}::uuid and category = ${category}::app.ward_category`;
      const r = await operatorCall(RPC.addCategory, addCategoryBody(ALPHA.id, category, 'OFFERED'));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect((r.body as { created: boolean }[])[0]?.created, `${category}: created must be true exactly when it did not exist`).toBe(had?.n === 0);
    }
    const row = await alphaInRegister();
    expect((row['categories'] as { category: string }[]).map((c) => c.category).sort()).toEqual([...ALPHA_CATEGORIES].sort());
  });

  test(name('operator-lists-facility'), async () => {
    const before = await alphaInRegister();
    const r = await operatorCall(RPC.setListed, setListedBody(ALPHA.id, before['version'] as number));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = await alphaInRegister();
    expect(after['listed_at'], 'ALPHA is not listed').not.toBeNull();
    expect(after['has_contact']).toBe(true);
    expect(after['agreement_state']).toBe('recorded');
    expect(after['is_active']).toBe(true);
  });

  test(name('operator-provisions-ward'), async () => {
    // The production script, through app.provision_begin's gates, on the facility the
    // operator just made: a refusal here is a gate the steps above did not satisfy.
    provisionE2eWardAccounts();
    const row = await alphaInRegister();
    const logins = Object.fromEntries((row['categories'] as { category: string; has_account: boolean }[]).map((c) => [c.category, c.has_account]));
    expect(logins[PUBLISH_CATEGORY], 'the publishing ward has no active login').toBe(true);
    expect(row['reporting_approval_state'], "the register does not read ALPHA's ward logins as matching the model it approved").toBe('MATCHES');
    // The ward steps' baseline, including the stale ward no operator function can make.
    await restoreAlphaWardBaseline();
    await assertAlphaPublic();
  });

  // ---------------------------------------------------------------- stage 0
  test(name('magic-link-minted'), async () => {
    const link = await mintMagicLink(WARD_EMAIL);
    state.link = link;
    // Printed verbatim so the assertions below are demonstrably written against
    // what this GoTrue returned rather than against documentation.
    console.log(`[e2e] admin/generate_link response fields: ${Object.keys(link.raw).sort().join(', ')}`);
    console.log(`[e2e] verification_type=${link.verificationType}`);
    expect(link.hashedToken.length, 'no hashed_token in the mint response').toBeGreaterThan(16);
    expect(link.userId, 'no auth.users id in the mint response').toMatch(/^[0-9a-f-]{36}$/);
    expect(link.verificationType, 'verification_type is absent, so /verify has nothing to echo').not.toEqual('');
  });

  test(name('magic-link-verified-issues-session'), async () => {
    const link = state.link;
    expect(link, 'the mint step did not run').toBeDefined();
    const outcome = await verifyToken(link as MintedLink);
    expect(outcome.status, `/verify refused a fresh link: ${JSON.stringify(outcome.body)}`).toBe(200);

    const accessToken = outcome.body['access_token'];
    expect(typeof accessToken, `no access_token. Keys: ${Object.keys(outcome.body).sort().join(', ')}`).toBe('string');

    // The token has to WORK, not merely exist. A session that cannot authenticate
    // a request proves nothing about the seam this step is here for.
    //
    // RE-POINTED BY MIGRATION 018 (R-2026-09-19-24 B4, inside that change rather
    // than after it). This read `ward_public?limit=1`, which 018 revokes from
    // both client roles. The replacement is also the stronger probe: anon held
    // SELECT on ward_public before 018, so the old assertion was satisfied by a
    // request carrying no bearer token at all. EXECUTE on my_reporting_wards is
    // granted to `authenticated` and revoked from `anon` by name, so reaching its
    // body at all is the authentication this step claims to be testing.
    const res = await fetch(`${apiUrl()}/rest/v1/rpc/my_reporting_wards`, {
      method: 'POST',
      headers: {
        apikey: anonKey(),
        Authorization: `Bearer ${accessToken as string}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    expect(
      res.status,
      `a GoTrue-issued token did not authenticate a PostgREST request: ${await res.text()}`,
    ).toBe(200);
  });

  test(name('magic-link-replay-refused'), async () => {
    const link = state.link;
    expect(link, 'the mint step did not run').toBeDefined();
    const outcome = await verifyToken(link as MintedLink);
    // The exact signal, never a negation. "not 200" is satisfied by the endpoint
    // being unreachable, which is the probe's own precondition being absent.
    expect(outcome.status, `a consumed link was accepted a second time: ${JSON.stringify(outcome.body)}`).toBe(403);
    expect(outcome.body['error_code'], `unexpected refusal reason: ${JSON.stringify(outcome.body)}`).toBe('otp_expired');
  });

  test(name('magic-link-expired-refused'), async () => {
    const email = 'e2e-expiry-probe@e2e.invalid';
    const link = await mintMagicLink(email);
    state.expiringLink = link;

    // Expiry is forced by ageing auth.users.confirmation_sent_at -- established by
    // controlled probe, with a positive control, in tests/setup/auth.ts. That
    // helper throws unless exactly one row was updated, so a plant that did not
    // plant cannot be mistaken for GoTrue failing to expire the link.
    await forceLinkExpiry(email);

    const outcome = await verifyToken(link);
    expect(outcome.status, `an expired link was accepted: ${JSON.stringify(outcome.body)}`).toBe(403);
    expect(outcome.body['error_code'], `unexpected refusal reason: ${JSON.stringify(outcome.body)}`).toBe('otp_expired');
  });

  // ---------------------------------------------------------------- stage 1
  test(name('session-resolves-to-ward-account'), async () => {
    const session = await wardSession(WARD_EMAIL);
    expect(session.claims.sub, 'the token carries no sub').toBe(session.userId);

    // my_reporting_wards() resolves the facility from auth.uid() and calls
    // app.assert_member, which raises NOT_A_MEMBER when no ward_account row
    // matches. Until a ward account is provisioned, this is where the path stops.
    const res = await authedRest('rpc/my_reporting_wards', session, { method: 'POST', body: {} });
    expect(
      res.status,
      `the session did not resolve to an app.ward_account row: ${JSON.stringify(res.body)}`,
    ).toBe(200);
  });

  test(name('handover-lists-facility-wards'), async () => {
    const session = await wardSession(WARD_EMAIL);
    const res = await authedRest('rpc/my_reporting_wards', session, { method: 'POST', body: {} });
    expect(res.status, `my_reporting_wards failed: ${JSON.stringify(res.body)}`).toBe(200);
    const rows = res.body as { category?: string }[];
    expect(Array.isArray(rows), 'my_reporting_wards did not return rows').toBe(true);
    expect(rows.map((r) => r.category), 'the handover screen does not list the published category').toContain(
      PUBLISH_CATEGORY,
    );
  });

  test(name('publish-count'), async () => {
    const session = await wardSession(WARD_EMAIL);
    const res = await authedRest('rpc/publish_ward_status', session, {
      method: 'POST',
      body: {
        p_category: PUBLISH_CATEGORY,
        p_offering: 'OFFERED',
        p_bed_count: 4,
        p_accepting: true,
        p_reason: null,
        p_expected_version: 1,
        p_client_mutation_id: `e2e-publish-1-${RUN}`,
        p_composed_at: new Date().toISOString(),
      },
    });
    expect(res.status, `publish_ward_status failed: ${JSON.stringify(res.body)}`).toBe(200);
    const rows = res.body as PublishContract[];
    const row = rows[0];
    expect(row, 'publish returned no row').toBeDefined();
    expect(row?.version, 'publish did not return an incremented version').toBe(2);
    expect(row?.replayed, 'a fresh publish was reported as a replay').toBe(false);
    // TWO FACTS, NEVER ONE FIELD FOR BOTH (founder ruling, 2026-09-14): what the
    // ward claimed, and what the public sees -- the latter read back from the
    // same projection the dashboard reads.
    expect(row?.claim_bed_count, 'publish did not return the claim as recorded').toBe(4);
    expect(row?.claim_accepting, 'publish did not return the accepting claim').toBe(true);
    expect(row?.public_listed, 'an active, non-quiet facility was not listed').toBe(true);
    expect(row?.public_bed_count, 'the public count differs from an ungated claim').toBe(4);
    expect(row?.public_accepting_effective, 'publish did not return the effective gate').toBe(true);
    expect(row?.public_gated_by ?? null, 'an ungated ward reported a gate reason').toBeNull();
  });

  test(name('ward-republishes'), async () => {
    const session = await wardSession(WARD_EMAIL);
    const res = await authedRest('rpc/publish_ward_status', session, {
      method: 'POST',
      body: {
        p_category: PUBLISH_CATEGORY,
        p_offering: 'OFFERED',
        p_bed_count: 6,
        p_accepting: true,
        p_reason: null,
        p_expected_version: 2,
        p_client_mutation_id: `e2e-publish-2-${RUN}`,
        p_composed_at: new Date().toISOString(),
      },
    });
    expect(res.status, `the second publish failed: ${JSON.stringify(res.body)}`).toBe(200);
    const row = (res.body as PublishContract[])[0];
    expect(row?.version, 'the second publish did not increment version').toBe(3);
    expect(row?.replayed, 'a fresh publish was reported as a replay').toBe(false);
    expect(row?.claim_bed_count, 'the second publish did not take').toBe(6);
    expect(row?.public_bed_count, 'the second publish did not reach the public projection').toBe(6);
  });

  // ------------------------- the facility-level login (R-2026-09-27-144 DT, Bundle 1)
  test(name('operator-onboards-reporter-facility'), async () => {
    const fields = { name: GAMMA.name, lga: GAMMA.lga, state: 'Lagos', lat: GAMMA.lat, lng: GAMMA.lng, publicPhoneE164: GAMMA.phone };
    const created = await operatorCall(RPC.createFacility, createFacilityBody(GAMMA.id, fields));
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const contact = await operatorCall(RPC.recordContact, recordContactBody(GAMMA.id, GAMMA_CONTACT, null));
    expect(contact.status, JSON.stringify(contact.body)).toBe(200);
    const agreement = await operatorCall(
      RPC.recordAgreement,
      recordAgreementBody(GAMMA.id, GAMMA_AGREEMENT.acceptedOn, GAMMA_AGREEMENT.version, GAMMA_AGREEMENT.signatoryRole),
    );
    expect(agreement.status, JSON.stringify(agreement.body)).toBe(200);
    // 029: GAMMA reports through one facility login, approved from its signed Schedule 1 before the login is made.
    const approval = await operatorCall(RPC.recordReportingApproval, recordReportingApprovalBody(GAMMA.id, 'FACILITY', GAMMA_AGREEMENT.acceptedOn, 'Medical Director'));
    expect(approval.status, `operator_record_reporting_approval failed: ${JSON.stringify(approval.body)}`).toBe(200);
    for (const category of GAMMA_CATEGORIES) {
      const r = await operatorCall(RPC.addCategory, addCategoryBody(GAMMA.id, category, 'OFFERED'));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const row = await gammaInRegister();
    expect((row['categories'] as { category: string }[]).map((c) => c.category).sort()).toEqual([...GAMMA_CATEGORIES].sort());
    expect(row['listed_at'], 'GAMMA must stay unlisted, so nothing public changes').toBeNull();
    expect(row['reporting_model'], 'GAMMA has a reporting login before one was provisioned').toBe('NONE');
    expect([row['approved_model'], row['reporting_approval_state']], 'GAMMA is not approved and waiting for its login').toEqual(['FACILITY', 'NOT_YET_PROVISIONED']);
  });

  test(name('operator-records-hefamaa'), async () => {
    // The admin app's Registration section's call, through its own body builder
    // (R-2026-09-27-144 DT Bundle 3's definition of done). GAMMA is unlisted, and the
    // number is operator-only: it is read back from the operator's register and nowhere else.
    const before = await gammaInRegister();
    const version = before['version'] as number;
    const r = await operatorCall(RPC.recordRegistration, recordRegistrationBody(GAMMA.id, version, `HEF/E2E/${RUN}`));
    expect(r.status, `operator_record_registration failed: ${JSON.stringify(r.body)}`).toBe(200);
    const after = await gammaInRegister();
    expect(after['hefamaa_reg_no'], 'the HEFAMAA number did not read back in the register').toBe(`HEF/E2E/${RUN}`);
    expect(after['version'], 'the registration did not bump the facility version').toBe(version + 1);
  });

  test(name('operator-provisions-reporter'), async () => {
    const out = provisionE2eReporter();
    console.log(`[e2e] provision_ward_account.mjs (FACILITY_REPORTER): ${out.trim().split('\n').at(-1) ?? ''}`);
    const row = await gammaInRegister();
    expect(row['reporting_model'], 'the register does not read GAMMA as reporting through one login').toBe('FACILITY');
    expect(row['reporter_login']).toBe('active');
    expect(row['reporting_approval_state'], "the register does not read GAMMA's facility login as matching the model it approved").toBe('MATCHES');
    const cats = row['categories'] as { category: string; has_account: boolean; provisioning_incomplete: boolean }[];
    expect(cats.map((c) => [c.category, c.has_account, c.provisioning_incomplete]).sort()).toEqual(
      [...GAMMA_CATEGORIES].sort().map((c) => [c, true, false]),
    );
  });

  test(name('reporter-reads-can-publish'), async () => {
    const res = await reporterCall('my_reporting_wards', {});
    expect(res.status, `my_reporting_wards failed for the reporter: ${JSON.stringify(res.body)}`).toBe(200);
    const rows = (res.body as { category: string; can_publish: boolean }[]).map((r) => [r.category, r.can_publish]).sort();
    expect(rows).toEqual([...GAMMA_CATEGORIES].sort().map((c) => [c, true]));
  });

  test(name('reporter-publishes-two-categories'), async () => {
    const listed = await reporterCall('my_reporting_wards', {});
    const versions = new Map((listed.body as { category: string; version: number }[]).map((r) => [r.category, r.version]));
    for (const [i, category] of GAMMA_CATEGORIES.entries()) {
      const before = versions.get(category);
      expect(before, `${category} is not in the reporter's list`).toBeDefined();
      const res = await reporterCall('publish_ward_status', {
        p_category: category,
        p_offering: 'OFFERED',
        p_bed_count: i + 2,
        p_accepting: true,
        p_reason: null,
        p_expected_version: before as number,
        p_client_mutation_id: `e2e-reporter-${category}-${RUN}`,
        p_composed_at: new Date().toISOString(),
      });
      expect(res.status, `the reporter's publish of ${category} failed: ${JSON.stringify(res.body)}`).toBe(200);
      const row = (res.body as PublishContract[])[0];
      expect(row?.version, `${category}: version did not move`).toBe((before as number) + 1);
      expect(row?.replayed).toBe(false);
      expect(row?.claim_bed_count, `${category}: the claim did not take`).toBe(i + 2);
      expect(row?.public_listed, 'GAMMA is unlisted, and a publish reported it public').toBe(false);
    }
    const events = await sql()<{ category: string; source: string }[]>`
      select distinct on (category) category::text as category, source::text as source from app.ward_status_event
       where facility_id = ${GAMMA.id}::uuid and client_mutation_id like ${`e2e-reporter-%-${RUN}`}
       order by category, id desc`;
    expect(events).toEqual([...GAMMA_CATEGORIES].sort().map((c) => ({ category: c, source: 'WARD' })));
  });

  test(name('reporter-publishes-through-console'), async () => {
    // THE CONSOLE ITSELF, NOT ITS RPCs (DT Bundle 2's definition of done). The ward console
    // is loaded into a jsdom window at a LOCAL address, so apiOrigin() picks the local API
    // and every request it makes goes to the real local stack over the real network. The
    // reporter's own session, minted and verified as every session here is, is handed to it
    // the way a sign-in link hands it: in the URL fragment. Nothing is stubbed.
    state.reporter ??= await signInWard(REPORTER_EMAIL);
    const s = state.reporter;
    const { JSDOM } = await import('jsdom');
    const fragment = `#access_token=${s.accessToken}&refresh_token=${s.refreshToken}&expires_at=${s.expiresAt}&token_type=bearer`;
    const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: `http://127.0.0.1/${fragment}` });
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { window: g['window'], document: g['document'] };
    g['window'] = dom.window;
    g['document'] = dom.window.document;
    const doc = dom.window.document;
    const until = async (cond: () => boolean, what: string): Promise<void> => {
      const end = Date.now() + 10_000;
      while (!cond()) {
        if (Date.now() > end) throw new Error(`the console never ${what}; the page read: ${doc.body.textContent ?? ''}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    try {
      // The module renders on import, as it does in a browser.
      await import('../../apps/ward-console/src/main.js');
      await until(() => (doc.body.textContent ?? '').includes('Handover'), 'showed the handover');
      const forms = Array.from(doc.querySelectorAll<HTMLFormElement>('li.ward form.publish'));
      expect(forms.length, "the console did not give every one of GAMMA's wards its own form").toBe(GAMMA_CATEGORIES.length);
      expect(doc.body.textContent, 'a ward read as someone else\'s to publish, under the facility login').not.toContain('This ward reports from its own login.');

      // Which ward the first card is does not matter, and the step does not assume the
      // console's order: it reads every GAMMA ward before and after, and exactly one moves.
      const wards = async () =>
        sql()<{ category: string; bed_count: number | null; version: number }[]>`
          select category::text as category, bed_count, version from app.ward_status where facility_id = ${GAMMA.id}::uuid order by category::text`;
      const before = await wards();
      const form = forms[0] as HTMLFormElement;
      const count = form.querySelector<HTMLInputElement>('input[name="bed_count"]');
      expect(count, 'the form has no count field').not.toBeNull();
      (count as HTMLInputElement).value = '9';
      (count as HTMLInputElement).dispatchEvent(new dom.window.Event('input'));
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      await until(() => (form.querySelector('p.status')?.textContent ?? '') !== '', 'answered the publish');
      expect(form.querySelector('p.status')?.textContent, 'the console did not say the publish went through').toBe('Published.');

      const after = await wards();
      const moved = after.filter((a) => before.find((b) => b.category === a.category)?.version !== a.version);
      expect(moved.map((m) => m.category), 'one publish through the console did not move exactly one ward').toHaveLength(1);
      const [changed] = moved;
      expect(changed?.bed_count, 'the count published through the console did not reach app.ward_status').toBe(9);
      expect(changed?.version, 'the console publish did not move the version by one').toBe((before.find((b) => b.category === changed?.category)?.version ?? -1) + 1);
      const [event] = await sql()<{ source: string }[]>`
        select source::text as source from app.ward_status_event
         where facility_id = ${GAMMA.id}::uuid and category::text = ${changed?.category ?? ''} order by id desc limit 1`;
      expect(event?.source, "the console's publish was not recorded as the facility's own claim").toBe('WARD');
    } finally {
      g['window'] = saved.window;
      g['document'] = saved.document;
      dom.window.close();
    }
  });

  test(name('snapshot-regenerates'), async () => {
    const db = sql();
    // THIS STEP'S SUBJECT IS ITS OWN CALL to app.regenerate_snapshot() below, and
    // since migration 017 that needs stating (R-2026-09-16-11). 017 schedules the
    // same function as the pg_cron job openbed_regenerate_snapshot. What a live job
    // could and could not do to this step, OBSERVED 2026-09-16 with this call
    // removed and the job running every SECOND, sixty times its real cadence:
    //   - the `v` check below still went red in 4 of 4 runs. Its two reads sit
    //     milliseconds either side of the call, and a job commit landing inside
    //     that gap is what it would take to pass without the call. That check is
    //     what makes the step about its own call, and it held;
    //   - the heartbeat-freshness and republished-count checks WOULD be satisfied
    //     by a job regeneration. They are safe only because they sit behind `v`.
    // So the pause is not what keeps this step honest today; it keeps the step's
    // evidence attributable, and it closes the rare window the `v` check leaves.
    // The e2e setup pauses both jobs (tests/e2e/global-setup.ts,
    // database/local/pause_scheduled_jobs.sql), and the step checks that pause
    // itself rather than trusting a setup it cannot see. The checker's plants are
    // in tests/db/scheduled_jobs_paused.test.ts.
    expect(
      await scheduledJobPauseViolations(db),
      'a live pg_cron job could have produced this regeneration; the step would not be testing its own call',
    ).toEqual([]);
    const before = await db<{ v: number }[]>`select v from public.snapshot_current order by v desc limit 1`;
    await db`select app.regenerate_snapshot()`;
    const after = await db<{ v: number }[]>`select v from public.snapshot_current order by v desc limit 1`;

    expect(after[0], 'no snapshot row after regeneration').toBeDefined();
    // v is bigint (016, ruled), which postgres.js returns as a STRING; observed
    // 2026-09-15 as "actual value must be number or bigint, received string".
    // Coerced here, same comparison.
    expect(
      Number(after[0]?.v ?? 0),
      'v did not increment — a version that does not move is the one signal that distinguishes a dead generator from a quiet one',
    ).toBeGreaterThan(Number(before[0]?.v ?? -1));

    // The heartbeat must move in the SAME transaction, so a regeneration can
    // never be claimed that did not commit.
    const [beat] = await db<{ fresh: boolean }[]>`
      select (now() - last_snapshot_at) < interval '1 minute' as fresh from app.system_heartbeat
    `;
    expect(beat?.fresh, 'the snapshot heartbeat did not move with the snapshot').toBe(true);

    // The step's description claims the snapshot carries the REPUBLISHED count,
    // so the step verifies it (R-2026-09-15-04: a step claiming more than it
    // checks is the #11 family). tile-shows-count below reads the same payload
    // through the client codec; this reads it here, where it was generated.
    const [snap] = await db<{ v: number; payload: { v: number; wards: unknown[][] } }[]>`
      select v, payload from public.snapshot_current order by v desc limit 1
    `;
    expect(Number(snap?.payload.v), 'the payload does not name its own version').toBe(Number(snap?.v));
    const { decodeWard } = await import('../../packages/snapshot/src/codec.js');
    const republished = (snap?.payload.wards ?? [])
      .map((r) => decodeWard(r))
      .find((w) => w['facility_id'] === ALPHA.id && w['category'] === PUBLISH_CATEGORY);
    expect(republished, 'the republished ward is absent from the regenerated snapshot').toBeDefined();
    expect(republished?.['bed_count'], 'the regenerated snapshot does not carry the republished count').toBe(6);
  });

  test(name('tile-shows-count'), async () => {
    const db = sql();
    const [snap] = await db<{ payload: { wards: unknown[][] } }[]>`
      select payload from public.snapshot_current order by v desc limit 1
    `;
    expect(snap, 'no snapshot to decode').toBeDefined();

    const { decodeWard } = await import('../../packages/snapshot/src/codec.js');
    const wards = (snap?.payload.wards ?? []).map((r) => decodeWard(r));
    const mine = wards.find(
      (w) => w['facility_id'] === ALPHA.id && w['category'] === PUBLISH_CATEGORY,
    );
    expect(mine, 'the published ward is absent from the snapshot').toBeDefined();
    // The REPUBLISHED value, not the first publish. ward-republishes runs before
    // the projection is read, deliberately.
    expect(mine?.['bed_count'], 'the snapshot carries a stale count').toBe(6);
  });

  test(name('tile-shows-absolute-timestamp'), async () => {
    const db = sql();
    const [snap] = await db<{ payload: { server_now: string; wards: unknown[][] } }[]>`
      select payload from public.snapshot_current order by v desc limit 1
    `;
    const serverNow = snap?.payload.server_now;
    expect(typeof serverNow, 'the snapshot carries no server_now — the client would have to read a wall clock').toBe(
      'string',
    );

    const { decodeWard } = await import('../../packages/snapshot/src/codec.js');
    const wards = (snap?.payload.wards ?? []).map((r) => decodeWard(r));
    const mine = wards.find((w) => w['facility_id'] === ALPHA.id && w['category'] === PUBLISH_CATEGORY);
    const updatedAt = mine?.['updated_at'];
    expect(typeof updatedAt, 'the ward carries no absolute updated_at').toBe('string');

    // Rendered with an explicit zone, never the device's. A handset three hours
    // fast must not be able to change what the tile says.
    const rendered = new Date(updatedAt as string).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });
    expect(rendered.length, 'the absolute timestamp did not render in Africa/Lagos').toBeGreaterThan(0);
  });

  test(name('stale-ward-payload-carries-duty-phone'), async () => {
    const db = sql();
    const [snap] = await db<{ payload: { facilities: unknown[][]; wards: unknown[][] } }[]>`
      select payload from public.snapshot_current order by v desc limit 1
    `;
    const { decodeWard, decodeFacility } = await import('../../packages/snapshot/src/codec.js');

    const wards = (snap?.payload.wards ?? []).map((r) => decodeWard(r));
    const stale = wards.find((w) => w['facility_id'] === ALPHA.id && w['category'] === STALE_CATEGORY);
    expect(stale, 'the deliberately stale ward is absent from the snapshot').toBeDefined();

    const facilities = (snap?.payload.facilities ?? []).map((r) => decodeFacility(r));
    const owner = facilities.find((f) => f['facility_id'] === ALPHA.id);
    expect(owner, 'the stale ward has no facility in the payload').toBeDefined();
    expect(
      owner?.['public_phone_e164'],
      'a referrer reaching a stale ward has no number to call',
    ).toMatch(/^\+[1-9][0-9]{7,14}$/);
  });

  // ---------------------------------------------------------------- stage 3
  test(name('update-request-fired'), async () => {
    const res = await fetch(`${apiUrl()}/rest/v1/rpc/request_ward_update`, {
      method: 'POST',
      headers: { apikey: anonKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_facility_id: ALPHA.id, p_category: STALE_CATEGORY }),
    });
    expect(res.status, 'a member of the public could not request an update for a stale ward').toBe(200);

    // The shape decision that travels with the table: no IP address is persisted.
    const db = sql();
    const cols = await db<{ column_name: string }[]>`
      select column_name from information_schema.columns
       where table_schema = 'app' and table_name = 'update_request'
    `;
    const names = cols.map((c) => c.column_name);
    expect(names.length, 'app.update_request does not exist').toBeGreaterThan(0);
    expect(
      names.filter((n) => /(^|_)(ip|ip_address|client_ip|ip_hash|user_agent)$/.test(n)),
      'app.update_request holds an IP address or user agent',
    ).toEqual([]);
  });

  test(name('ward-sees-pending-request'), async () => {
    const session = await wardSession(WARD_EMAIL);
    const res = await authedRest('rpc/my_pending_update_requests', session, { method: 'POST', body: {} });
    expect(res.status, `the ward could not read its pending requests: ${JSON.stringify(res.body)}`).toBe(200);
    const rows = res.body as { category?: string }[];
    expect(rows.map((r) => r.category), 'the ward device does not show the pending request').toContain(STALE_CATEGORY);
  });

  test(name('snapshot-sorted-freshness-then-distance'), async () => {
    const db = sql();
    const [snap] = await db<{ payload: { facilities: unknown[][] } }[]>`
      select payload from public.snapshot_current order by v desc limit 1
    `;
    const { decodeFacility } = await import('../../packages/snapshot/src/codec.js');
    const facilities = (snap?.payload.facilities ?? []).map((r) => decodeFacility(r));

    const ids = facilities.map((f) => f['facility_id']);
    expect(ids, 'both E2E facilities must be present or there is no sort to assert').toEqual(
      expect.arrayContaining([ALPHA.id, BETA.id]),
    );

    const { orderFacilities } = await loadFuture<{
      orderFacilities: (rows: Record<string, unknown>[], at: { lat: number; lng: number }) => Record<string, unknown>[];
    }>('../../packages/snapshot/src/sort.ts', 3);
    // A referrer standing at Alpha. Alpha must come first on distance; the
    // assertion is on ORDER, never on which rows survive -- freshness may
    // reorder results and may never filter them.
    const ordered = orderFacilities(facilities, { lat: ALPHA.lat, lng: ALPHA.lng });
    expect(ordered.map((f: Record<string, unknown>) => f['facility_id']).slice(0, 2), 'the distance sort did not order by proximity').toEqual([
      ALPHA.id,
      BETA.id,
    ]);
    expect(ordered.length, 'the sort dropped rows — freshness must never reduce cardinality').toBe(facilities.length);
  });

  test(name('poll-at-cadence-reflects-update'), async () => {
    const { pollForSnapshot } = await loadFuture<{
      pollForSnapshot: (seconds: number, onPayload: (p: { v: number }) => void) => () => void;
    }>('../../packages/snapshot/src/poll.ts', 3);
    const cadence = SHAPE.pollCadenceSeconds;
    expect(cadence, 'the snapshot fixture carries no poll cadence').toBeGreaterThan(0);

    // Fake timers: the assertion is that a poll at the CONSTANT picks up a new
    // payload, not that any particular wall-clock duration elapsed.
    const seen: number[] = [];
    const stop = pollForSnapshot(cadence, (payload: { v: number }) => seen.push(payload.v));
    try {
      await new Promise((r) => setTimeout(r, 50));
      expect(seen.length, 'the poll never fired at the snapshot cadence').toBeGreaterThan(0);
    } finally {
      stop();
    }
  });

  test(name('tile-render-distance-sorted'), async () => {
    const { renderTiles } = await loadFuture<TilesModule>('../../apps/public-dashboard/src/tiles.ts', 3);
    const painted = await renderTiles({ lat: ALPHA.lat, lng: ALPHA.lng });
    expect(painted.map((t) => t.facilityId).slice(0, 2)).toEqual([ALPHA.id, BETA.id]);
  });

  test(name('tile-poll-reflects-without-refresh'), async () => {
    const { renderTiles, pollOnce } = await loadFuture<TilesModule>('../../apps/public-dashboard/src/tiles.ts', 3);
    const before = await renderTiles({ lat: ALPHA.lat, lng: ALPHA.lng });
    await pollOnce();
    const after = await renderTiles({ lat: ALPHA.lat, lng: ALPHA.lng });
    expect(after, 'the rendered count did not change without a navigation').not.toEqual(before);
  });

  // ---------------------------------------------------------------- stage 5
  test(name('outcome-accepted-logged'), async () => {
    const session = await wardSession(WARD_EMAIL);
    const res = await authedRest('rpc/log_referral_outcome', session, {
      method: 'POST',
      body: {
        p_receiving_facility_id: BETA.id,
        p_receiving_category: PUBLISH_CATEGORY,
        p_outcome: 'ACCEPTED',
      },
    });
    expect(res.status, `logging an outcome failed: ${JSON.stringify(res.body)}`).toBe(200);
  });

  test(name('outcome-in-audit-log'), async () => {
    const db = sql();
    const [row] = await db<{ n: number }[]>`
      select count(*)::int as n from app.audit_log
       where facility_id = ${ALPHA.id}::uuid and action::text like '%REFERRAL%'
    `;
    expect(row?.n ?? 0, 'the outcome did not reach app.audit_log').toBeGreaterThan(0);
  });
});
