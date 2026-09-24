/**
 * THE ADMIN APP'S READING OF ITS TWO READS (R-2026-09-24-97; PR 3.4b-app C).
 *
 * operator_register (021:636-701) and operator_get_contact (021:586-625). A field of
 * the wrong type is REFUSED, never defaulted: a register row that could not be read is
 * shown as unreadable, in its place, and never dropped -- a dropped row is a hidden
 * row, and the register must never hide one (AJ D8). The same rule the ward console's
 * wardRowFrom follows (R-2026-09-23-66).
 */

export interface Ward {
  readonly category: string;
  readonly offering: string;
  readonly monitoringState: string;
  readonly bedCount: number | null;
  readonly accepting: boolean | null;
  readonly updatedAt: string | null;
  readonly hasAccount: boolean;
  readonly provisioningIncomplete: boolean;
}

export type AgreementState = 'none' | 'recorded' | 'withdrawn';

export interface Facility {
  readonly kind: 'facility';
  readonly facilityId: string;
  readonly name: string;
  readonly lga: string;
  readonly state: string;
  readonly version: number;
  readonly listedAt: string | null;
  readonly isActive: boolean;
  readonly hasContact: boolean;
  readonly agreementState: AgreementState;
  readonly categories: readonly Ward[];
}

/** A register row that could not be read. Shown in place, never dropped. */
export interface UnreadableFacility {
  readonly kind: 'unreadable';
  readonly facilityId: string | null;
}

export interface Register {
  readonly serverNow: string;
  readonly facilities: readonly (Facility | UnreadableFacility)[];
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === 'string';
const strOrNull = (x: unknown): x is string | null => x === null || typeof x === 'string';
const bool = (x: unknown): x is boolean => typeof x === 'boolean';

function wardFrom(x: unknown): Ward | null {
  if (!isObj(x)) return null;
  const { category, offering, monitoring_state, bed_count, accepting, updated_at, has_account, provisioning_incomplete } = x;
  if (!str(category) || !str(offering) || !str(monitoring_state)) return null;
  if (!(bed_count === null || (typeof bed_count === 'number' && Number.isInteger(bed_count)))) return null;
  if (!(accepting === null || bool(accepting)) || !strOrNull(updated_at)) return null;
  if (!bool(has_account) || !bool(provisioning_incomplete)) return null;
  return {
    category,
    offering,
    monitoringState: monitoring_state,
    bedCount: bed_count,
    accepting,
    updatedAt: updated_at,
    hasAccount: has_account,
    provisioningIncomplete: provisioning_incomplete,
  };
}

function facilityFrom(x: unknown): Facility | UnreadableFacility {
  const id = isObj(x) && str(x['facility_id']) ? x['facility_id'] : null;
  const unreadable: UnreadableFacility = { kind: 'unreadable', facilityId: id };
  if (!isObj(x) || id === null) return unreadable;
  const { name, lga, state, version, listed_at, is_active, has_contact, agreement_state, categories } = x;
  if (!str(name) || !str(lga) || !str(state)) return unreadable;
  if (typeof version !== 'number' || !Number.isInteger(version)) return unreadable;
  if (!strOrNull(listed_at) || !bool(is_active) || !bool(has_contact)) return unreadable;
  if (agreement_state !== 'none' && agreement_state !== 'recorded' && agreement_state !== 'withdrawn') return unreadable;
  if (!Array.isArray(categories)) return unreadable;
  const wards = categories.map(wardFrom);
  if (wards.some((w) => w === null)) return unreadable;
  return {
    kind: 'facility',
    facilityId: id,
    name,
    lga,
    state,
    version,
    listedAt: listed_at,
    isActive: is_active,
    hasContact: has_contact,
    agreementState: agreement_state,
    categories: wards as Ward[],
  };
}

/** The register, or null when the envelope itself could not be read. */
export function parseRegister(x: unknown): Register | null {
  if (!isObj(x) || !str(x['server_now']) || Number.isNaN(Date.parse(x['server_now'])) || !Array.isArray(x['facilities'])) return null;
  return { serverNow: x['server_now'], facilities: x['facilities'].map(facilityFrom) };
}

export interface Contact {
  readonly fullName: string;
  readonly jobTitle: string;
  readonly email: string | null;
  readonly mobileE164: string | null;
  readonly smsOptIn: boolean;
  readonly unreachableSince: string | null;
  readonly version: number;
}

export interface Agreement {
  readonly acceptedOn: string;
  readonly version: string;
  readonly signatoryRole: string | null;
  readonly withdrawnOn: string | null;
}

export interface ContactView {
  readonly contact: Contact | null;
  readonly agreement: Agreement | null;
}

/** operator_get_contact's {contact, agreement}, or null when it could not be read. */
export function parseContact(x: unknown): ContactView | null {
  if (!isObj(x) || !('contact' in x) || !('agreement' in x)) return null;
  const c = x['contact'];
  const a = x['agreement'];
  let contact: Contact | null = null;
  if (c !== null) {
    if (!isObj(c)) return null;
    const { full_name, job_title, email, mobile_e164, sms_opt_in, unreachable_since, version } = c;
    if (!str(full_name) || !str(job_title) || !strOrNull(email) || !strOrNull(mobile_e164)) return null;
    if (!bool(sms_opt_in) || !strOrNull(unreachable_since) || typeof version !== 'number') return null;
    contact = { fullName: full_name, jobTitle: job_title, email, mobileE164: mobile_e164, smsOptIn: sms_opt_in, unreachableSince: unreachable_since, version };
  }
  let agreement: Agreement | null = null;
  if (a !== null) {
    if (!isObj(a)) return null;
    const { accepted_on, version, signatory_role, withdrawn_on } = a;
    if (!str(accepted_on) || !str(version) || !strOrNull(signatory_role) || !strOrNull(withdrawn_on)) return null;
    agreement = { acceptedOn: accepted_on, version, signatoryRole: signatory_role, withdrawnOn: withdrawn_on };
  }
  return { contact, agreement };
}
