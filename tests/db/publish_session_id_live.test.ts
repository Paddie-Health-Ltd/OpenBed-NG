import { afterAll, describe, expect, test } from 'vitest';
import { signInWard } from '../setup/auth.js';
import { sql, withRole } from '../setup/db.js';

/**
 * CTO CONDITION (2), AGAINST CLAIMS GoTrue MINTED.
 *
 * The ward-identity memo requires the audit row's session identifier to be
 * opaque and short-lived, never derivable back to a mailbox. 005 records that no
 * CHECK can enforce it -- a CHECK may not call auth.uid() -- and that the rule
 * belongs to the writer RPC. publish_ward_status (014) stamps
 * `auth.jwt() ->> 'session_id'` and refuses a session id equal to the account.
 *
 * WHY THIS FILE AND NOT tests/db/publish_ward_status.test.ts. Claims written by
 * hand contain whatever the test author puts in them, so a "session_id differs
 * from sub" assertion over hand-set claims asserts the fixture back at itself.
 * Here the claims are the payload of access tokens GoTrue issued for two separate
 * sign-ins of the same account, and nobody in this repository chose them.
 *
 * WHAT IS NOT EXERCISED: PostgREST's own JWT verification. The GoTrue-minted
 * claims are handed to the database the way PostgREST hands them over
 * (request.jwt.claims), inside a rolled-back transaction, so the publish never
 * commits append-only rows into the shared corpus. The golden path exercises the
 * full HTTP transport.
 *
 * TWO MINTS FOR THE WHOLE FILE. [auth.rate_limit] sign_in_sign_ups is per IP.
 */

const EMAIL = `publish-session-probe-${Date.now()}@ward.invalid`;
const FAC = '99999999-0000-4000-8000-000000000001';

afterAll(async () => {
  await sql()`delete from auth.users where email = ${EMAIL}`;
});

function payloadOf(accessToken: string): Record<string, unknown> {
  const part = accessToken.split('.')[1];
  if (!part) throw new Error('access token is not a JWT');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('publish_ward_status — session_id against GoTrue-minted claims', () => {
  test('the audit session_id is GoTrue\'s session id — it differs from auth.uid() and changes across two sessions of the same account', async () => {
    const first = payloadOf((await signInWard(EMAIL)).accessToken);
    const second = payloadOf((await signInWard(EMAIL)).accessToken);

    expect(second['sub'], 'the two sign-ins were not the same account').toBe(first['sub']);
    expect(typeof first['session_id'], 'GoTrue minted no session_id').toBe('string');
    expect(second['session_id'], 'two sign-ins produced the same session id').not.toBe(first['session_id']);

    const sub = first['sub'] as string;
    const stamped = await withRole(
      'authenticated',
      first,
      async (tx) => {
        // Untyped literals, never ::app casts: authenticated has no USAGE on
        // schema app, so a client cannot name those types.
        const call = (beds: number, expected: number, mutation: string): string =>
          `select version from public.publish_ward_status('ICU_ADULT', 'OFFERED', ${beds}, true, null, ${expected}, '${mutation}', now())`;
        await tx.unsafe(call(3, 1, 'session-one'));
        // The second session of the same account, as PostgREST would present it.
        await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(second)] as never[]);
        await tx.unsafe(call(4, 2, 'session-two'));
        await tx.unsafe('RESET ROLE');
        const rows = await tx.unsafe<{ session_id: string }[]>(
          `select session_id::text as session_id from app.audit_log
            where facility_id = '${FAC}' and ward_category = 'ICU_ADULT' order by id`,
        );
        return rows.map((r) => r.session_id);
      },
      async (tx) => {
        await tx.unsafe(`
          insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164)
          values ('${FAC}', 'Session Probe', 'Ikeja', 'Lagos', 6.6, 3.35, '+2348000000092')
        `);
        await tx.unsafe(`
          insert into app.ward_status (facility_id, category, offering, bed_count, accepting, monitoring_state)
          values ('${FAC}', 'ICU_ADULT', 'OFFERED', 3, true, 'ACTIVE')
        `);
        await tx.unsafe(`
          insert into app.ward_account (id, facility_id, ward_category, role)
          values ('${sub}', '${FAC}', 'ICU_ADULT', 'WARD_STAFF')
        `);
      },
    );

    expect(stamped, 'the audit rows did not carry the two GoTrue session ids, in order').toEqual([
      first['session_id'],
      second['session_id'],
    ]);
    expect(stamped, 'an audit row carried the account id').not.toContain(sub);
  });
});
