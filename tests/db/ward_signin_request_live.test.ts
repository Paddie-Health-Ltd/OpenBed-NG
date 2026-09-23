import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionHolder, requestSignInLink, sessionFromUrlFragment } from '@openbed/auth';
import { apiUrl, anonKey, serviceRoleKey } from '../setup/local-keys.js';
import { sql } from '../setup/db.js';

/**
 * A WARD ASKS FOR ITS OWN LINK, AND THE LINK WORKS -- END TO END (R-2026-09-23-66; the
 * kickoff's AJ F2).
 *
 * REQUEST, RECEIVE, CONSUME, HANDOVER LOADS, against the local stack's real GoTrue and
 * its mail catcher. The request is made by `requestSignInLink` from packages/auth --
 * the SAME function the console's form calls, not a copy of it -- so this leg is the
 * form's request, minus the page. The page's own words are
 * tests/compliance/ward_console_render.test.ts's.
 *
 * THE MAIL CATCHER IS ON FOR THIS FILE. supabase/config.toml ran without it until
 * 2026-09-23, deliberately (tests/setup/auth.ts mints links with the admin API and
 * never needed mail). A ward requesting its own link is only honestly tested by the
 * whole route, and the founder chose to pay the container for it.
 *
 * AND THE ENUMERATION PROPERTY, at the server: an address GoTrue does not know gets no
 * user and no mail. `create_user: false` is what makes the form a request and not an
 * open sign-up.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - HOSTED behaviour. R-2026-09-19-23 D4 forbids exercising the hosted project's
 *     auth limits, and its mail goes through a sender this repository does not
 *     control. Everything below is the local stack.
 *   - that GoTrue's own API hides whether an address exists. IT DOES NOT: a known
 *     address answers 200 and an unknown one 422, observed 2026-09-23. The form hides
 *     it; the API cannot be made to. Recorded in R-2026-09-23-66 as a finding.
 */

const MAILPIT = (() => {
  const toml = readFileSync(join(import.meta.dirname, '..', '..', 'supabase', 'config.toml'), 'utf8');
  const section = /^\[local_smtp\]([\s\S]*?)^\[/m.exec(toml)?.[1] ?? '';
  if (!/^enabled = true$/m.test(section)) throw new Error('[local_smtp] is not enabled in supabase/config.toml -- this test reads the requested link from it');
  const port = /^port = (\d+)$/m.exec(section)?.[1];
  if (port === undefined) throw new Error('[local_smtp] names no port in supabase/config.toml');
  return `http://127.0.0.1:${port}`;
})();

const RUN = Date.now();
const KNOWN = `signin-request-${RUN}@ward.invalid`;
const UNKNOWN = `signin-nobody-${RUN}@ward.invalid`;
const FACILITY = 'a0000000-0000-4000-8000-000000000001';
const CATEGORY = 'A_AND_E';
const REDIRECT = 'http://127.0.0.1:4173/';

let userId = '';

async function mailTo(address: string): Promise<{ ID: string }[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`the mail catcher at ${MAILPIT} answered ${res.status}`);
  return ((await res.json()) as { messages?: { ID: string }[] }).messages ?? [];
}

async function waitForMail(address: string): Promise<string> {
  for (let i = 0; i < 60; i += 1) {
    const [first] = await mailTo(address);
    if (first) {
      const res = await fetch(`${MAILPIT}/api/v1/message/${first.ID}`, { signal: AbortSignal.timeout(12_000) });
      const msg = (await res.json()) as { Text?: string };
      return msg.Text ?? '';
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no mail reached ${address} at ${MAILPIT} within 15 seconds`);
}

beforeAll(async () => {
  const res = await fetch(`${apiUrl()}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceRoleKey(), Authorization: `Bearer ${serviceRoleKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: KNOWN, email_confirm: true }),
  });
  const body = (await res.json()) as { id?: string };
  if (!res.ok || typeof body.id !== 'string') throw new Error(`could not create the ward's auth user (HTTP ${res.status}): ${JSON.stringify(body)}`);
  userId = body.id;
  await sql().begin(async (tx) => {
    await tx`insert into app.invite (facility_id, ward_category, role, accepted_at)
             values (${FACILITY}::uuid, ${CATEGORY}::app.ward_category, 'WARD_STAFF'::app.app_role, now())`;
    await tx`insert into app.ward_account (id, facility_id, ward_category, role)
             values (${userId}::uuid, ${FACILITY}::uuid, ${CATEGORY}::app.ward_category, 'WARD_STAFF'::app.app_role)`;
  });
});

afterAll(async () => {
  if (userId !== '') {
    await sql()`delete from app.ward_account where id = ${userId}::uuid`;
    await sql()`delete from auth.users where id = ${userId}::uuid`;
  }
  await sql()`delete from auth.users where email = ${UNKNOWN}`;
});

describe('a ward requests a new sign-in link — local stack, end to end', () => {
  test('request, receive, consume, and the handover loads', async () => {
    const outcome = await requestSignInLink({ apiUrl: apiUrl(), anonKey: anonKey(), email: KNOWN, redirectTo: REDIRECT });
    expect(outcome, 'GoTrue did not accept the request for a known ward').toEqual({ kind: 'answered', status: 200 });

    const mail = await waitForMail(KNOWN);
    const link = /(https?:\/\/\S+\/auth\/v1\/verify\?[^\s)]+)/.exec(mail)?.[1];
    expect(link, `no verify link in the mail:\n${mail}`).toBeDefined();

    const verified = await fetch(link as string, { redirect: 'manual', signal: AbortSignal.timeout(12_000) });
    const location = verified.headers.get('location') ?? '';
    expect(verified.status, 'the link did not redirect').toBeGreaterThanOrEqual(300);
    expect(location.startsWith(REDIRECT), `the link returned to ${location}, not to the console`).toBe(true);

    const session = sessionFromUrlFragment(new URL(location).hash);
    expect(session, 'the link carried no session').not.toBeNull();
    expect(session?.claims.sub).toBe(userId);

    const holder = new SessionHolder({ apiUrl: apiUrl(), anonKey: anonKey(), session: session as NonNullable<typeof session> });
    const res = await holder.authedFetch('rpc/my_facility_wards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status, `the handover did not load: ${await res.clone().text()}`).toBe(200);
    const rows = (await res.json()) as { category: string }[];
    expect(rows.map((r) => r.category), "the handover does not list this ward's own category").toContain(CATEGORY);

    // And it is single-use: the same link, again, is refused in the fragment.
    const again = await fetch(link as string, { redirect: 'manual', signal: AbortSignal.timeout(12_000) });
    expect(() => sessionFromUrlFragment(new URL(again.headers.get('location') ?? REDIRECT).hash), 'a used link signed in twice').toThrow(
      'the sign-in link was refused by the auth server',
    );
  });

  test('an unknown address is answered, and gets NO user and NO mail', async () => {
    const [before] = await sql()<{ n: number }[]>`select count(*)::int as n from auth.users where email = ${UNKNOWN}`;
    const outcome = await requestSignInLink({ apiUrl: apiUrl(), anonKey: anonKey(), email: UNKNOWN, redirectTo: REDIRECT });
    expect(outcome.kind, 'the request got no answer at all').toBe('answered');
    const [after] = await sql()<{ n: number }[]>`select count(*)::int as n from auth.users where email = ${UNKNOWN}`;
    expect([before?.n, after?.n], 'an unknown address CREATED a user — the form is an open sign-up').toEqual([0, 0]);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await mailTo(UNKNOWN), 'mail was sent to an address GoTrue does not know').toEqual([]);
  });

  test('positive control — the catcher search finds mail it holds, so an empty search above means none was sent', async () => {
    expect((await mailTo(KNOWN)).length, 'the search found nothing for an address that was mailed').toBeGreaterThan(0);
  });
});
