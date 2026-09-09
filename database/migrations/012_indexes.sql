-- ============================================================
-- 012_indexes.sql
-- ============================================================
-- Sprint 1, Bundle 1. The seven indexes named in the kickoff, and nothing else.
--
-- Empirical state at base: 001-011 applied. All tables and both mirrors exist.
--
-- NO POSTGIS, DELIBERATELY. A few hundred facilities is one payload; the client
-- sorts by haversine locally. That is not only a simplicity choice -- it is what
-- keeps the user's coordinates on the device, because there is no server-side
-- distance query to send them to.
--
-- WHAT IS NOT INDEXED, AND WHY THAT IS THE POINT.
--   There is no index supporting a scan of app.ward_status_event by time across
--   facilities. The BRIN index below is deliberately the cheapest possible
--   structure that makes retention jobs viable, and it is useless for the
--   facility-level time series the kickoff forbids. Do not "improve" it into a
--   btree on (facility_id, created_at) to make a chart fast. The chart is not
--   supposed to be fast; it is not supposed to exist.
--
-- Idempotency: CREATE INDEX IF NOT EXISTS throughout.
--
-- Deployment ordering gate: none. CREATE INDEX (not CONCURRENTLY) takes a write
-- lock, which is correct here -- on an empty table it is instant, and CONCURRENTLY
-- cannot run inside the transaction a migration runs in.
--
-- Index ledger -- 7 indexes:
--   public.ward_public   (category) WHERE accepting_effective   -- partial
--   public.ward_public   (updated_at DESC)
--   public.facility_public (lga)
--   app.ward_status      (updated_at) WHERE offering='OFFERED'  -- partial, sweep
--   app.ward_status_event(created_at) BRIN
--   app.audit_log        (occurred_at) BRIN
--   app.referral         (receiving_facility_id, state, created_at DESC)
-- ============================================================


-- The public dashboard's primary query: "which wards in this category are
-- accepting". Partial, because a query for gated or non-accepting wards is not a
-- query this product serves.
CREATE INDEX IF NOT EXISTS ward_public_category_accepting_idx
    ON public.ward_public (category)
    WHERE accepting_effective;

-- Freshness ORDERING. Note the shape: this index supports an ORDER BY, and the
-- kickoff is emphatic that freshness may reorder but must NEVER filter. There is
-- deliberately no partial predicate on updated_at here -- a
-- `WHERE updated_at > now() - interval '2 hours'` index would be the 4am bug
-- baked into the schema, empty at exactly the hour the tool matters most.
CREATE INDEX IF NOT EXISTS ward_public_updated_at_idx
    ON public.ward_public (updated_at DESC);

-- The LGA fallback path, used when geolocation is denied, times out, or returns
-- a fix outside the Nigeria bounding box. That path is a first-class control, not
-- an error handler, so it gets a first-class index.
CREATE INDEX IF NOT EXISTS facility_public_lga_idx
    ON public.facility_public (lga);

-- The staleness sweep (Bundle 5). Partial on OFFERED because a NOT_OFFERED ward
-- cannot go stale -- there is nothing it failed to report.
CREATE INDEX IF NOT EXISTS ward_status_sweep_idx
    ON app.ward_status (updated_at)
    WHERE offering = 'OFFERED';

-- BRIN, not btree, on both append-only tables. Rows are appended in time order,
-- so the physical order matches created_at almost perfectly and BRIN costs
-- kilobytes where a btree costs megabytes. It serves retention scans (Sprint 2)
-- and is close to useless for point lookups -- which is exactly the trade wanted.
CREATE INDEX IF NOT EXISTS ward_status_event_created_at_brin
    ON app.ward_status_event USING brin (created_at);

CREATE INDEX IF NOT EXISTS audit_log_occurred_at_brin
    ON app.audit_log USING brin (occurred_at);

-- Outcome capture: "the pending and recent referrals at this facility".
CREATE INDEX IF NOT EXISTS referral_receiving_facility_state_created_idx
    ON app.referral (receiving_facility_id, state, created_at DESC);


INSERT INTO app.schema_migrations (filename, applied_at)
VALUES ('012_indexes.sql', now())
ON CONFLICT (filename) DO NOTHING;
