/**
 * THE ADMIN APP'S READING OF ITS TWO READS (R-2026-09-24-97; PR 3.4b-app C).
 *
 * operator_register (021:636-701, with 023's three keys) and operator_get_contact (021:586-625). A field of
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

/** 026's reporting model, from the active logins (R-2026-09-27-144 DT i). */
export type ReportingModel = 'FACILITY' | 'WARD' | 'NONE';
/** 026's facility-level login state. */
export type ReporterLogin = 'active' | 'setup incomplete' | 'none';
/** The reporting model a facility approved in its signed Schedule 1, as 029 stores it. */
export type ApprovedModel = 'FACILITY' | 'WARD';
/**
 * 029's four states, computed once in SQL by public.operator_register() (R-2026-09-30-201 GA;
 * ruling FX P2). They are READ here and never derived: the page holds no copy of the rule.
 */
export type ReportingApprovalState = 'NOT_YET_PROVISIONED' | 'APPROVAL_NOT_RECORDED' | 'MATCHES' | 'MISMATCH';

export interface Facility {
  readonly kind: 'facility';
  readonly facilityId: string;
  readonly name: string;
  readonly lga: string;
  readonly state: string;
  /** Since 023 (R-2026-09-24-98 BZ-2): what is SAVED, so the edit form shows it rather than asking. */
  readonly lat: number;
  readonly lng: number;
  readonly publicPhoneE164: string;
  readonly version: number;
  readonly listedAt: string | null;
  readonly isActive: boolean;
  readonly hasContact: boolean;
  readonly agreementState: AgreementState;
  readonly categories: readonly Ward[];
  /** Since 026 (R-2026-09-27-144 DT i, k): operator-only, never public. */
  readonly reportingModel: ReportingModel;
  readonly reporterLogin: ReporterLogin;
  readonly hefamaaRegNo: string | null;
  /**
   * Since 029 (R-2026-09-30-201 GA): the latest approval, and the state of the active logins
   * against it. approvedModel and approvedOn are null with no approval. The state is null only
   * for a facility with neither an approval nor a login, which is not a fifth state.
   */
  readonly approvedModel: ApprovedModel | null;
  readonly approvedOn: string | null;
  readonly reportingApprovalState: ReportingApprovalState | null;
}

/** A register row that could not be read. Shown in place, never dropped. */
export interface UnreadableFacility {
  readonly kind: 'unreadable';
  readonly facilityId: string | null;
}

/** A retention job whose latest finished run did not succeed (026's retention_alert). */
export interface RetentionAlert {
  readonly job: string;
  readonly endTime: string;
}

export interface Register {
  readonly serverNow: string;
  readonly facilities: readonly (Facility | UnreadableFacility)[];
  /** Empty when every retention job's latest run succeeded. Since 026. */
  readonly retentionAlert: readonly RetentionAlert[];
}

/** One pg_cron job in the scheduler's status (027's app.scheduler_status()). */
export interface SchedulerJob {
  readonly name: string;
  readonly active: boolean;
  readonly schedule: string;
  readonly lastStatus: string | null;
  readonly lastStartTime: string | null;
}

/** The scheduler's status, as public.operator_scheduler_status() returns it (028). */
export interface SchedulerStatus {
  readonly serverNow: string;
  readonly generatedAt: string | null;
  readonly lastSnapshotAt: string | null;
  readonly jobs: readonly SchedulerJob[];
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === 'string';
const strOrNull = (x: unknown): x is string | null => x === null || typeof x === 'string';
const bool = (x: unknown): x is boolean => typeof x === 'boolean';
const time = (x: unknown): x is string => typeof x === 'string' && !Number.isNaN(Date.parse(x));
const timeOrNull = (x: unknown): x is string | null => x === null || time(x);

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
  const { name, lga, state, lat, lng, public_phone_e164, version, listed_at, is_active, has_contact, agreement_state, categories, reporting_model, reporter_login, hefamaa_reg_no, approved_model, approved_on, reporting_approval_state } = x;
  if (!str(name) || !str(lga) || !str(state)) return unreadable;
  // 023's three keys. Absent -- a database at 021 -- the row is unreadable, never
  // defaulted: an edit form showing a guessed phone is the defect 023 exists to close.
  if (typeof lat !== 'number' || !Number.isFinite(lat) || typeof lng !== 'number' || !Number.isFinite(lng) || !str(public_phone_e164)) return unreadable;
  if (typeof version !== 'number' || !Number.isInteger(version)) return unreadable;
  if (!strOrNull(listed_at) || !bool(is_active) || !bool(has_contact)) return unreadable;
  if (agreement_state !== 'none' && agreement_state !== 'recorded' && agreement_state !== 'withdrawn') return unreadable;
  if (!Array.isArray(categories)) return unreadable;
  // 026's three keys, read like 023's: absent or of the wrong kind, the row is unreadable,
  // never defaulted. A guessed reporting model would tell the operator who reports.
  if (reporting_model !== 'FACILITY' && reporting_model !== 'WARD' && reporting_model !== 'NONE') return unreadable;
  if (reporter_login !== 'active' && reporter_login !== 'setup incomplete' && reporter_login !== 'none') return unreadable;
  if (!strOrNull(hefamaa_reg_no)) return unreadable;
  // 029's three keys, read like 026's: absent or of the wrong kind, the row is unreadable, never
  // defaulted. JSON null is a real answer for each (no approval; and, for the state, no approval
  // and no login), so the key ABSENT -- a database at 028 -- is undefined, is not null, and is
  // refused. A guessed state would tell the operator that the logins match what was approved.
  if (approved_model !== null && approved_model !== 'FACILITY' && approved_model !== 'WARD') return unreadable;
  if (approved_on !== null && !(str(approved_on) && /^\d{4}-\d{2}-\d{2}$/.test(approved_on))) return unreadable;
  if (
    reporting_approval_state !== null &&
    reporting_approval_state !== 'NOT_YET_PROVISIONED' &&
    reporting_approval_state !== 'APPROVAL_NOT_RECORDED' &&
    reporting_approval_state !== 'MATCHES' &&
    reporting_approval_state !== 'MISMATCH'
  ) return unreadable;
  // The keys must agree with each other, or a sentence would be printed with a hole in it: a state
  // that compares against an approval needs one, and the other two (and null) have none.
  const hasApproval = approved_model !== null;
  if ((approved_on === null) === hasApproval) return unreadable;
  const comparesApproval = reporting_approval_state === 'NOT_YET_PROVISIONED' || reporting_approval_state === 'MATCHES' || reporting_approval_state === 'MISMATCH';
  if (comparesApproval !== hasApproval) return unreadable;
  const wards = categories.map(wardFrom);
  if (wards.some((w) => w === null)) return unreadable;
  return {
    kind: 'facility',
    facilityId: id,
    name,
    lga,
    state,
    lat,
    lng,
    publicPhoneE164: public_phone_e164,
    version,
    listedAt: listed_at,
    isActive: is_active,
    hasContact: has_contact,
    agreementState: agreement_state,
    categories: wards as Ward[],
    reportingModel: reporting_model,
    reporterLogin: reporter_login,
    hefamaaRegNo: hefamaa_reg_no,
    approvedModel: approved_model,
    approvedOn: approved_on,
    reportingApprovalState: reporting_approval_state,
  };
}

/** 026's retention_alert: a list of {job, end_time}, or null when it could not be read. */
function retentionAlertFrom(x: unknown): RetentionAlert[] | null {
  if (!Array.isArray(x)) return null;
  const out: RetentionAlert[] = [];
  for (const a of x) {
    if (!isObj(a) || !str(a['job']) || !str(a['end_time']) || Number.isNaN(Date.parse(a['end_time']))) return null;
    out.push({ job: a['job'], endTime: a['end_time'] });
  }
  return out;
}

/**
 * The register, or null when the envelope itself could not be read. A retention_alert
 * that cannot be read makes the ENVELOPE unreadable, never an empty alert: an alert read
 * as "nothing failed" is the one reading that hides a failure (R-2026-09-27-144 DT i).
 */
export function parseRegister(x: unknown): Register | null {
  if (!isObj(x) || !str(x['server_now']) || Number.isNaN(Date.parse(x['server_now'])) || !Array.isArray(x['facilities'])) return null;
  const retentionAlert = retentionAlertFrom(x['retention_alert']);
  if (retentionAlert === null) return null;
  return { serverNow: x['server_now'], facilities: x['facilities'].map(facilityFrom), retentionAlert };
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

/**
 * The scheduler's status, or null when it is not exactly the shape 027 returns. Strict, as
 * parseRegister is: a job that cannot be read makes the whole answer unreadable, never a
 * shorter list, because a job left out is a job the page would report as absent.
 */
export function parseSchedulerStatus(x: unknown): SchedulerStatus | null {
  if (!isObj(x)) return null;
  const { server_now, generated_at, last_snapshot_at, jobs } = x;
  // A timestamp that is not one is unreadable (R-2026-09-30-176 EZ-2 c): the decision reads a
  // server_now it cannot parse as a failed probe, which this page would otherwise show as
  // nothing at all. A null is still a null: no snapshot yet, no heartbeat, no finished run.
  if (!time(server_now) || !timeOrNull(generated_at) || !timeOrNull(last_snapshot_at) || !Array.isArray(jobs)) return null;
  const out: SchedulerJob[] = [];
  for (const j of jobs as unknown[]) {
    if (!isObj(j)) return null;
    const { name, active, schedule, last_status, last_start_time } = j;
    if (!str(name) || !bool(active) || !str(schedule) || !strOrNull(last_status) || !timeOrNull(last_start_time)) return null;
    out.push({ name, active, schedule, lastStatus: last_status, lastStartTime: last_start_time });
  }
  return { serverNow: server_now, generatedAt: generated_at, lastSnapshotAt: last_snapshot_at, jobs: out };
}
