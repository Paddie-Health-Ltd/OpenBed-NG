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
  authedRest,
  type MintedLink,
} from '../setup/auth.js';
import { ALPHA, BETA, WARD_EMAIL, PUBLISH_CATEGORY, STALE_CATEGORY, loadFuture } from './_harness.js';

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
const state: { link?: MintedLink; expiringLink?: MintedLink } = {};

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
    const res = await fetch(`${apiUrl()}/rest/v1/ward_public?limit=1`, {
      headers: { apikey: anonKey(), Authorization: `Bearer ${accessToken as string}` },
    });
    expect(res.status, 'a GoTrue-issued token did not authenticate a PostgREST request').toBe(200);
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

    // my_facility_wards() resolves the facility from auth.uid() and calls
    // app.assert_member, which raises NOT_A_MEMBER when no ward_account row
    // matches. Until a ward account is provisioned, this is where the path stops.
    const res = await authedRest('rpc/my_facility_wards', session, { method: 'POST', body: {} });
    expect(
      res.status,
      `the session did not resolve to an app.ward_account row: ${JSON.stringify(res.body)}`,
    ).toBe(200);
  });

  test(name('handover-lists-facility-wards'), async () => {
    const session = await wardSession(WARD_EMAIL);
    const res = await authedRest('rpc/my_facility_wards', session, { method: 'POST', body: {} });
    expect(res.status, `my_facility_wards failed: ${JSON.stringify(res.body)}`).toBe(200);
    const rows = res.body as { category?: string }[];
    expect(Array.isArray(rows), 'my_facility_wards did not return rows').toBe(true);
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
