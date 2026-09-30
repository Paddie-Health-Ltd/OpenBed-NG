export {
  encodeWard,
  decodeWard,
  encodeFacility,
  decodeFacility,
  wardColumns,
  facilityColumns,
  POLL_CADENCE_SECONDS,
  type EncodedRow,
  type DecodedRow,
  type RowCodec,
} from './codec.js';
export { freshnessBand, freshnessBucket, snapshotAge, type Freshness, type FreshnessBand, type SnapshotAge } from './freshness.js';
export { markFetch, elapsedSince, type FetchMark } from './anchor.js';
export { SERVED_AT_HEADER } from './headers.js';
export { lagosTime } from './time.js';
// The health DECISION and its key lists: pure, no network and no credential. health_serve.ts
// is never exported here: it carries the direct origin and the auth headers, and admin
// must not import it (tests/compliance/direct_origin_holders.test.ts).
export {
  decideHealth,
  SNAPSHOT_JOB,
  TOP_KEYS,
  JOB_KEYS,
  type HealthReason,
  type HealthDecision,
  type ProbeInput,
} from './health.js';
