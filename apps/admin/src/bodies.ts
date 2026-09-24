/**
 * THE ADMIN APP'S REQUEST BODIES, AS PURE FUNCTIONS (R-2026-09-24-97; PR 3.4b-app C).
 *
 * One builder per operator RPC. The page sends exactly these, and so do
 * tests/db/admin_calls_live.test.ts (against real PostgREST) and the golden path's
 * operator steps (tests/e2e/golden-path.test.ts). A body shape therefore has ONE
 * derivation site: a renamed parameter reds the live test and the E2E, rather than
 * leaving the page sending a shape nothing else exercises (test-conventions section 7).
 *
 * No DOM, no fetch, no clock: this module must load in Node for the db and E2E tests.
 * Parameter names and types are 020's and 021's (packages/fixtures/function-grants.json
 * lists the eight signatures).
 */

/** The eight functions the app calls (R-2026-09-24-88 BP-2), by the name PostgREST routes on. */
export const RPC = {
  register: 'operator_register',
  getContact: 'operator_get_contact',
  createFacility: 'operator_create_facility',
  editFacility: 'operator_edit_facility',
  addCategory: 'operator_add_category',
  recordContact: 'operator_record_contact',
  recordAgreement: 'operator_record_agreement',
  setListed: 'operator_set_facility_listed',
} as const;

export interface FacilityFields {
  readonly name: string;
  readonly lga: string;
  readonly state: string;
  readonly lat: number;
  readonly lng: number;
  readonly publicPhoneE164: string;
}

export interface ContactFields {
  readonly fullName: string;
  readonly jobTitle: string;
  /** Empty string or null for none. The server trims and nulls blanks (021:411-415). */
  readonly email: string | null;
  readonly mobileE164: string | null;
  readonly smsOptIn: boolean;
}

export const registerBody = (): Record<string, never> => ({});

export const getContactBody = (facilityId: string): { p_facility_id: string } => ({ p_facility_id: facilityId });

/**
 * `id` is generated ONCE, when the create form opens, and reused for every submit from
 * that form (020's J2): a repeat with the same fields answers created=false, which the
 * page shows as created, not as an error.
 */
export const createFacilityBody = (id: string, f: FacilityFields) => ({
  p_id: id,
  p_name: f.name,
  p_lga: f.lga,
  p_state: f.state,
  p_lat: f.lat,
  p_lng: f.lng,
  p_public_phone_e164: f.publicPhoneE164,
});

/** NOT safe to repeat (020:466-526): the page never re-sends it (R-2026-09-24-97 BY-2 e). */
export const editFacilityBody = (facilityId: string, expectedVersion: number, f: FacilityFields) => ({
  p_facility_id: facilityId,
  p_expected_version: expectedVersion,
  p_name: f.name,
  p_lga: f.lga,
  p_state: f.state,
  p_lat: f.lat,
  p_lng: f.lng,
  p_public_phone_e164: f.publicPhoneE164,
});

/** No default offering: "a clinical claim, stated or refused. Never defaulted." (020:624). */
export const addCategoryBody = (facilityId: string, category: string, offering: 'OFFERED' | 'NOT_OFFERED') => ({
  p_facility_id: facilityId,
  p_category: category,
  p_offering: offering,
});

/**
 * `expectedVersion` is the CONTACT's own version (operator_get_contact's contact.version),
 * not the facility's, and null for a first write (021:450).
 */
export const recordContactBody = (facilityId: string, c: ContactFields, expectedVersion: number | null) => ({
  p_facility_id: facilityId,
  p_full_name: c.fullName,
  p_job_title: c.jobTitle,
  p_email: c.email,
  p_mobile_e164: c.mobileE164,
  p_sms_opt_in: c.smsOptIn,
  p_expected_version: expectedVersion,
});

export const recordAgreementBody = (facilityId: string, acceptedOn: string, version: string, signatoryRole: string | null) => ({
  p_facility_id: facilityId,
  p_accepted_on: acceptedOn,
  p_version: version,
  p_signatory_role: signatoryRole,
});

export const setListedBody = (facilityId: string, expectedVersion: number) => ({
  p_facility_id: facilityId,
  p_expected_version: expectedVersion,
});

/**
 * A Nigerian phone number as typed, in international (E.164) form, or null when it is
 * not one this page can read. Shown to the operator as a preview BEFORE submit; the
 * database CHECK (003:121, 003:338) stays the backstop.
 *
 *   0800 000 0303     -> +2348000000303   (national form: the leading 0 becomes +234)
 *   2348000000303     -> +2348000000303   (country code without the +)
 *   +234 800 000 0303 -> +2348000000303   (already international; spacing removed)
 *
 * Spaces, hyphens, dots and brackets are removed first. Nothing else is guessed: a
 * number in none of those forms is null, and the page says so rather than sending it.
 */
export function normaliseNgPhone(raw: string): string | null {
  const s = raw.replace(/[\s\-.()]/g, '');
  let out: string | null = null;
  if (/^\+\d+$/.test(s)) out = s;
  else if (/^234\d+$/.test(s)) out = `+${s}`;
  else if (/^0\d+$/.test(s)) out = `+234${s.slice(1)}`;
  return out !== null && /^\+[1-9][0-9]{7,14}$/.test(out) ? out : null;
}
