import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { sql } from '../setup/db.js';
import { BLOCKS, commandFence, fingerprint, runFence, shown, tables, type BlockId, type Run } from '../setup/runbook.js';

/**
 * THE RUNBOOK'S OWN SQL FOR 12.4 STEPS 6a AND 6b AND 12.5 STEPS 1 TO 3, RUN AGAINST THE
 * LOCAL STACK (R-2026-09-28-151 EA-2 c).
 *
 * WHY IT EXISTS. Nothing ran the runbook's SQL. tests/compliance/runbook_psql_path.test.ts
 * counts the blocks that call psql and never executes one, so a statement the database
 * refuses would reach the founder on hosted, at facility one, with every check green.
 *
 * WHAT RUNS IS THE FENCE, NEVER A COPY. Each block's command fence is found in
 * docs/runbook-supabase-project-creation.md by its step's own words and run verbatim under
 * bash, with the values its connection fence reads supplied as the environment it would
 * have exported. The fence's first line puts the keg-only libpq on PATH on a Mac; CI
 * installs psql. A psql that cannot be found prints "command not found" and fails every leg.
 *
 * A FENCE'S EXIT STATUS IS ITS unset's, so it says nothing: a refused psql line is followed
 * by the read-back and the unset, and the fence exits 0. An error is read from what the
 * fence PRINTS on stderr, as the founder reads it on screen. Observed while writing this:
 * EA-2 b's form printed its ERROR and the fence still exited 0.
 *
 * WHAT IS ASSERTED, on each block's own PASS lines:
 *   - 12.4 step 6a, as a ward login: claims_set t, a history_rows count, and ROLLBACK;
 *   - 12.4 step 6b, as a facility login at a facility with two wards: claims_set t, ONE
 *     ROW PER WARD, each with its count, and ROLLBACK;
 *   - 6a and 6b change nothing: every base table in app and the three public mirrors
 *     read the same before and after, row for row;
 *   - 12.5 step 1: UPDATE 1, then t; step 2: the count 0; step 3: t. Then each is read
 *     back from the database, and the withdrawn facility is gone from the public mirror.
 *
 * THE COUNTS ARE 0, deliberately. A published status writes app.ward_status_event, which
 * holds its facility by a RESTRICT key and is never deleted, so a fixture with an event
 * could not be removed. The runbook's own PASS line says 0 is a pass.
 *
 * EA-2 a's DEFECT IS NOT ONE, and a plant below keeps it that way. EA-2 a said 6b's
 * `ward_status_history(r.category::text)` fails because the function takes the enum
 * (011:229). It does not: 015 dropped that signature and recreated the function with a
 * text parameter, and the enum form is the one the database refuses. The plant below runs
 * EA-2 b's proposed form and must read "function public.ward_status_history(app.ward_category)
 * does not exist".
 *
 * FIXTURES are committed, because each block runs in its own psql connection. They use
 * fixed ids, and are deleted before they are written and again after the file.
 *
 * NOT ASSERTED HERE, deliberately:
 *   - HTTP reach. These run as the account inside the database, not through PostgREST.
 *     tests/db/rpc_over_http_live.test.ts proves the transport locally.
 *   - Hosted state. What hosted answers is the founder's run.
 *   - How zsh treats the paste. That was read under a real pseudo-terminal (-150), and
 *     tests/compliance/runbook_read_pasted_alone.test.ts holds the blocks' shape.
 *
 * LIVE: the SQL it runs exists now.
 */

const RUNBOOK = join(import.meta.dirname, '..', '..', 'docs', 'runbook-supabase-project-creation.md');

const FAC_REPORTER = '0e000000-0000-4000-8000-0000000012a1';
const FAC_WARD = '0e000000-0000-4000-8000-0000000012a2';
const FAC_WITHDRAW = '0e000000-0000-4000-8000-0000000012a3';
const FACILITIES = [FAC_REPORTER, FAC_WARD, FAC_WITHDRAW];
const U_REPORTER = '0e000000-0000-4000-8000-0000000012b1';
const U_WARD = '0e000000-0000-4000-8000-0000000012b2';
const U_WITHDRAW = '0e000000-0000-4000-8000-0000000012b3';

/**
 * THE LOCATOR, THE RUNNER, THE TABLE READER AND THE FINGERPRINT LIVE IN tests/setup/runbook.ts
 * (R-2026-09-29-165, EO-1 a), so tests/db/runbook_sql_live.test.ts runs fences the same way.
 */

/** 6a's PASS: claims_set t, one history_rows count, the last line ROLLBACK. */
function sixAViolations(r: Run): string[] {
  const v: string[] = [];
  if (r.stderr.trim() !== '') v.push(`6a printed an error: ${r.stderr.trim()}`);
  const t = tables(r.stdout);
  if (JSON.stringify(t.tables[0]) !== JSON.stringify({ columns: ['claims_set'], rows: [['t']] })) v.push('6a: claims_set does not read t');
  const h = t.tables[1];
  if (h === undefined || JSON.stringify(h.columns) !== '["history_rows"]' || h.rows.length !== 1 || !/^\d+$/.test(h.rows[0]?.[0] ?? '')) v.push('6a: no history_rows count came back');
  if (t.tags.at(-1) !== 'ROLLBACK') v.push(`6a: the last line is not ROLLBACK (${String(t.tags.at(-1))})`);
  return v;
}

/** 6b's PASS: claims_set t, then one row for EVERY ward the facility has, each with a count, and ROLLBACK. `wards` is in 6b's own order, the enum's. */
function sixBViolations(r: Run, wards: readonly string[]): string[] {
  const v: string[] = [];
  if (r.stderr.trim() !== '') v.push(`6b printed an error: ${r.stderr.trim()}`);
  const t = tables(r.stdout);
  if (JSON.stringify(t.tables[0]) !== JSON.stringify({ columns: ['claims_set'], rows: [['t']] })) v.push('6b: claims_set does not read t');
  const h = t.tables[1];
  if (h === undefined || JSON.stringify(h.columns) !== '["category","history_rows"]') {
    v.push('6b: no category/history_rows table came back');
  } else {
    const got = h.rows.map((row) => row[0]);
    if (JSON.stringify(got) !== JSON.stringify(wards)) v.push(`6b: one row per ward expected, ${JSON.stringify(wards)}; read ${JSON.stringify(got)}`);
    if (!h.rows.every((row) => /^\d+$/.test(row[1] ?? ''))) v.push('6b: a ward came back without a history_rows count');
  }
  if (t.tags.at(-1) !== 'ROLLBACK') v.push(`6b: the last line is not ROLLBACK (${String(t.tags.at(-1))})`);
  return v;
}

async function removeFixtures(): Promise<void> {
  const db = sql();
  await db`delete from app.ward_account where facility_id = any(${FACILITIES}::uuid[])`;
  await db`delete from app.invite where facility_id = any(${FACILITIES}::uuid[])`;
  await db`delete from app.facility_agreement where facility_id = any(${FACILITIES}::uuid[])`;
  await db`delete from app.facility where id = any(${FACILITIES}::uuid[])`;
}

const TEXT = readFileSync(RUNBOOK, 'utf8');
const REPORTER_WARDS = ['MATERNITY', 'THEATRE'];

/** The reporter facility's wards in the order 6b sorts them: by the enum, which is not the alphabet. */
async function wardsInEnumOrder(): Promise<string[]> {
  const rows = await sql()<{ c: string }[]>`select category::text as c from app.ward_status where facility_id = ${FAC_REPORTER}::uuid order by category`;
  return rows.map((r) => r.c);
}

beforeAll(async () => {
  await removeFixtures();
  const db = sql();
  const rows: [string, string, string, boolean][] = [
    [FAC_REPORTER, 'Runbook SQL Facility Reporter', '+2348000001201', false],
    [FAC_WARD, 'Runbook SQL Facility Ward', '+2348000001202', false],
    [FAC_WITHDRAW, 'Runbook SQL Facility Withdrawn', '+2348000001203', true],
  ];
  for (const [id, name, phone, listed] of rows) {
    await db`
      insert into app.facility (id, name, lga, state, lat, lng, public_phone_e164, listed_at)
      values (${id}::uuid, ${name}, 'Yaba', 'Lagos', 6.51, 3.38, ${phone}, ${listed ? new Date() : null})`;
    await db`insert into app.facility_contact (facility_id, full_name, job_title, email)
             values (${id}::uuid, 'Synthetic Contact', 'Medical Director', 'contact@example.invalid')`;
    await db`insert into app.facility_agreement (facility_id, accepted_on, version) values (${id}::uuid, '2026-09-01', 'synthetic-v1')`;
  }
  for (const c of REPORTER_WARDS) {
    await db`insert into app.ward_status (facility_id, category, offering) values (${FAC_REPORTER}::uuid, ${c}, 'OFFERED')`;
  }
  await db`insert into app.ward_status (facility_id, category, offering) values (${FAC_WARD}::uuid, 'ICU_ADULT', 'OFFERED')`;
  await db`insert into app.ward_status (facility_id, category, offering) values (${FAC_WITHDRAW}::uuid, 'ICU_ADULT', 'OFFERED')`;
  await db`insert into app.ward_account (id, facility_id, ward_category, role) values (${U_REPORTER}::uuid, ${FAC_REPORTER}::uuid, null, 'FACILITY_REPORTER')`;
  await db`insert into app.ward_account (id, facility_id, ward_category, role) values (${U_WARD}::uuid, ${FAC_WARD}::uuid, 'ICU_ADULT', 'WARD_STAFF')`;
  await db`insert into app.ward_account (id, facility_id, ward_category, role) values (${U_WITHDRAW}::uuid, ${FAC_WITHDRAW}::uuid, 'ICU_ADULT', 'WARD_STAFF')`;
  const [pub] = await db<{ n: number }[]>`select count(*)::int as n from public.facility_public where facility_id = ${FAC_WITHDRAW}::uuid`;
  expect(pub?.n, 'the facility 12.5 withdraws is not on the public mirror to begin with, so its removal would prove nothing').toBe(1);
});

afterAll(removeFixtures);

describe('the blocks are found where the runbook puts them', () => {
  test.each(Object.keys(BLOCKS) as BlockId[])('real runbook: %s is found, reads its values and runs its psql lines', (id) => {
    expect(() => commandFence(TEXT, id)).not.toThrow();
  });

  test('plant — a block whose anchor moved is refused by name, never skipped', () => {
    const planted = TEXT.replace("6b. **The facility's login**", "6b. **The facility login**");
    expect(planted, 'the plant did not land').not.toBe(TEXT);
    expect(() => commandFence(planted, '6b')).toThrow(`12.4 step 6b: "6b. **The facility's login**" is not under "### 12.4 Creating a facility"`);
  });

  test('plant — a connection fence reading another variable is refused', () => {
    const planted = TEXT.replace('read -rs DATABASE_URL && export DATABASE_URL; read -r REPORTER_USER_ID', 'read -rs DATABASE_URL && export DATABASE_URL; read -r USER_ID');
    expect(planted, 'the plant did not land').not.toBe(TEXT);
    expect(() => commandFence(planted, '6b')).toThrow('12.4 step 6b: its connection fence');
  });

  test('anti-vacuity — the locator over an empty runbook fails', () => {
    expect(() => commandFence('', '6a')).toThrow('12.4 step 6a: the runbook has no "### 12.4 Creating a facility" heading');
  });
});

describe('12.4 step 6: the first reporting login reads its own history, and changes nothing', () => {
  test('real 6a: a ward login reads claims_set t, a count and ROLLBACK, and changes nothing', async () => {
    const before = await fingerprint();
    const r = runFence(commandFence(TEXT, '6a'), { WARD_USER_ID: U_WARD, CATEGORY: 'ICU_ADULT' });
    expect(sixAViolations(r), shown(r)).toEqual([]);
    expect(await fingerprint(), `6a changed a table\n${shown(r)}`).toEqual(before);
  });

  test('real 6b: a facility login at a facility with two wards reads one row per ward and ROLLBACK, and changes nothing', async () => {
    const before = await fingerprint();
    const wards = await wardsInEnumOrder();
    expect([...wards].sort(), 'the fixture facility does not hold exactly its two wards').toEqual(REPORTER_WARDS);
    const r = runFence(commandFence(TEXT, '6b'), { REPORTER_USER_ID: U_REPORTER });
    expect(sixBViolations(r, wards), shown(r)).toEqual([]);
    expect(await fingerprint(), `6b changed a table\n${shown(r)}`).toEqual(before);
  });

  test('plant — EA-2 b\'s form, the enum passed with no cast, is refused by the database', async () => {
    const fence = commandFence(TEXT, '6b');
    const planted = fence.replace('public.ward_status_history(r.category::text)', 'public.ward_status_history(r.category)');
    expect(planted, 'the plant did not land').not.toBe(fence);
    const r = runFence(planted, { REPORTER_USER_ID: U_REPORTER });
    const v = sixBViolations(r, await wardsInEnumOrder());
    expect(v.some((x) => x.startsWith('6b printed an error: ERROR:  function public.ward_status_history(app.ward_category) does not exist')), `${JSON.stringify(v)}\n${shown(r)}`).toBe(true);
    expect(v, shown(r)).toContain('6b: no category/history_rows table came back');
  });

  test('plant — a 6b that drops a ward is refused as not one row per ward', async () => {
    const fence = commandFence(TEXT, '6b');
    const planted = fence.replace('from public.my_reporting_wards() r order by', "from public.my_reporting_wards() r where r.category::text <> 'THEATRE' order by");
    expect(planted, 'the plant did not land').not.toBe(fence);
    const wards = await wardsInEnumOrder();
    const r = runFence(planted, { REPORTER_USER_ID: U_REPORTER });
    expect(sixBViolations(r, wards), shown(r)).toEqual([`6b: one row per ward expected, ${JSON.stringify(wards)}; read ["MATERNITY"]`]);
  });

  test('plant — a 6a that writes and commits is caught by the fingerprint', async () => {
    const fence = commandFence(TEXT, '6a');
    const planted = fence.replace(' rollback;"', ` reset role; update app.ward_status set offering = offering where facility_id = '${FAC_WARD}'; commit;"`);
    expect(planted, 'the plant did not land').not.toBe(fence);
    const before = await fingerprint();
    const r = runFence(planted, { WARD_USER_ID: U_WARD, CATEGORY: 'ICU_ADULT' });
    expect(r.stderr, shown(r)).toBe('');
    const after = await fingerprint();
    expect(after['app.ward_status'], `the fingerprint did not see a committed write\n${shown(r)}`).not.toBe(before['app.ward_status']);
    expect(sixAViolations(r), shown(r)).toContain('6a: the last line is not ROLLBACK (COMMIT)');
  });
});

describe('12.5 steps 1 to 3: withdrawing an agreement, against a throwaway facility', () => {
  test('real 12.5 step 1 reads UPDATE 1 then t, and the facility leaves the public mirror', async () => {
    const r = runFence(commandFence(TEXT, '12.5-1'), { FACILITY_ID: FAC_WITHDRAW });
    expect(r.stderr, shown(r)).toBe('');
    expect(r.stdout.trim().split('\n'), shown(r)).toEqual(['UPDATE 1', 't']);
    const db = sql();
    const [a] = await db<{ w: boolean }[]>`select withdrawn_on is not null as w from app.facility_agreement where facility_id = ${FAC_WITHDRAW}::uuid`;
    expect(a?.w, shown(r)).toBe(true);
    const [pub] = await db<{ n: number }[]>`select count(*)::int as n from public.facility_public where facility_id = ${FAC_WITHDRAW}::uuid`;
    expect(pub?.n, 'the withdrawn facility is still on the public mirror').toBe(0);
  });

  test('real 12.5 step 2 reads UPDATE 1 then the count 0, and no account at the facility is active', async () => {
    const r = runFence(commandFence(TEXT, '12.5-2'), { FACILITY_ID: FAC_WITHDRAW });
    expect(r.stderr, shown(r)).toBe('');
    expect(r.stdout.trim().split('\n'), shown(r)).toEqual(['UPDATE 1', '0']);
    const [n] = await sql()<{ n: number }[]>`select count(*)::int as n from app.ward_account where facility_id = ${FAC_WITHDRAW}::uuid and is_active`;
    expect(n?.n, shown(r)).toBe(0);
  });

  test('real 12.5 step 3 reads UPDATE 1 then t, and listed_at is null', async () => {
    const r = runFence(commandFence(TEXT, '12.5-3'), { FACILITY_ID: FAC_WITHDRAW });
    expect(r.stderr, shown(r)).toBe('');
    expect(r.stdout.trim().split('\n'), shown(r)).toEqual(['UPDATE 1', 't']);
    const [f] = await sql()<{ n: boolean }[]>`select listed_at is null as n from app.facility where id = ${FAC_WITHDRAW}::uuid`;
    expect(f?.n, shown(r)).toBe(true);
  });
});
