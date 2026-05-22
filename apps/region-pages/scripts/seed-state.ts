// Ingest freshness is decided by *source change*, not wall-clock age. A row is
// skipped only when our copy is already at least as new as the warehouse row
// (`source.updated <= last_ingested_at`). This means admin edits in the F3 map
// are picked up on the very next ingest run instead of being suppressed for up
// to a week. Any ambiguity (missing/invalid timestamps) fails safe toward
// re-ingesting so we never silently keep stale data.

/**
 * Decide whether an unchanged row can be skipped during ingest.
 *
 * Returns `true` (skip) only when we have already ingested this row since it
 * last changed in the warehouse. Returns `false` (re-ingest) whenever that
 * cannot be proven:
 *  - missing `lastIngestedAt`        -> never seen, re-ingest
 *  - missing/invalid `sourceUpdatedAt` -> can't compare, re-ingest
 *  - invalid `lastIngestedAt`        -> can't compare, re-ingest
 *  - source newer than our copy      -> changed, re-ingest
 *  - source equal to our copy        -> unchanged, skip
 */
export function shouldSkipUnchangedRow(
  sourceUpdatedAt?: string | null,
  lastIngestedAt?: string | null
): boolean {
  if (!lastIngestedAt) return false;
  if (!sourceUpdatedAt) return false;

  const lastIngested = Date.parse(lastIngestedAt);
  if (Number.isNaN(lastIngested)) return false;

  const sourceUpdated = Date.parse(sourceUpdatedAt);
  if (Number.isNaN(sourceUpdated)) return false;

  return sourceUpdated <= lastIngested;
}

export function currentIngestedAt(date = new Date()) {
  return date.toISOString();
}
