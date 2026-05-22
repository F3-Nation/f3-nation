# Post-Mortem: ETIMEDOUT Errors in Daily Ingest

**Date:** 2026-04-06
**Severity:** High
**Duration:** Multiple days (intermittent failures)
**Author:** Patrick Taylor

---

## Summary

The daily data ingest process experienced persistent ETIMEDOUT errors when connecting to the F3 Data Warehouse (hosted on Google Cloud Platform). This caused the ingest pipeline to fail, preventing region and workout data from syncing to the production database.

## Root Cause

Both database connection pools (Supabase and F3 Data Warehouse) were initialized using the default `pg` Pool configuration with no explicit connection limits, timeouts, or statement timeouts.

The default `pg` Pool settings allow up to 10 concurrent connections with no idle timeout, no connection timeout, and no statement timeout. During the seed-workouts phase, 8 concurrent upsert operations (the default `UPSERT_CONCURRENCY`) would attempt to acquire connections from both pools simultaneously. Under load, this exhausted the GCP warehouse's connection capacity, causing new connection attempts to hang indefinitely until the operating system killed them with ETIMEDOUT.

Key contributing factors:

- **No explicit pool sizing**: Default `pg` Pool allows ~10 connections, but with 8 concurrent workers each needing connections from both pools, effective demand was up to 16 concurrent connections across two pools
- **No connection timeout**: Failed connection attempts hung indefinitely rather than failing fast
- **No idle timeout**: Stale connections were never released back to the pool
- **No statement timeout**: Long-running queries could hold connections indefinitely
- **GCP warehouse constraints**: The warehouse is hosted on GCP with unknown connection limits that we cannot modify

## Mitigation

### Immediate Fixes (this PR)

1. **Extracted pool configuration into a testable module** (`drizzle/pool-config.ts`)

   - Warehouse pool: max 5 connections, 10s idle/connect timeout, 30s statement timeout
   - Supabase pool: max 10 connections, 10s idle/connect timeout, 60s statement timeout

2. **Applied explicit pool configuration** to both database connections

   - `drizzle/f3-data-warehouse/db.ts` — warehouse pool with conservative limits
   - `drizzle/db.ts` — Supabase pool with moderate limits

3. **Reduced default upsert concurrency** from 8 to 4 (`scripts/seed-workouts.ts`)

   - Ensures concurrent operations stay well within pool limits
   - Still configurable via `WORKOUT_SEED_UPSERT_CONCURRENCY` env var

4. **Added tests** for pool configuration constraints and concurrency defaults

### Additional Fixes (cherry-picked)

5. **Prune workouts when parent AO is deactivated** — Previously, workouts were orphaned when their parent AO was deactivated, causing stale data to accumulate
6. **Fixed SQL filter syntax** — Corrected missing comma in multi-condition filter
7. **Wrapped ingest handler preamble in try/catch** — Database errors during the idempotency check and initial run tracking now send Slack notifications instead of failing silently

## Prevention

- [ ] Pool configuration is now explicitly defined and tested — any regression will be caught by the test suite
- [ ] Concurrency defaults are validated by tests
- [ ] Connection and statement timeouts ensure fail-fast behavior rather than indefinite hangs
- [ ] Slack notification coverage expanded to catch preamble errors that previously failed silently
- [ ] Consider adding connection pool metrics/logging in a future iteration to monitor pool utilization over time
