import { shouldSkipUnchangedRow, currentIngestedAt } from './seed-state';

describe('shouldSkipUnchangedRow', () => {
  const INGESTED = '2026-05-17T18:00:00.000Z';

  it('does not skip when lastIngestedAt is missing (never ingested)', () => {
    expect(shouldSkipUnchangedRow('2026-05-21T00:00:00Z', null)).toBe(false);
    expect(shouldSkipUnchangedRow('2026-05-21T00:00:00Z', undefined)).toBe(
      false
    );
  });

  it('does not skip when sourceUpdatedAt is missing', () => {
    expect(shouldSkipUnchangedRow(null, INGESTED)).toBe(false);
    expect(shouldSkipUnchangedRow(undefined, INGESTED)).toBe(false);
  });

  it('does not skip when lastIngestedAt is an invalid date', () => {
    expect(shouldSkipUnchangedRow('2026-05-21T00:00:00Z', 'not-a-date')).toBe(
      false
    );
  });

  it('does not skip when sourceUpdatedAt is an invalid date', () => {
    expect(shouldSkipUnchangedRow('not-a-date', INGESTED)).toBe(false);
  });

  it('re-ingests when the source is newer than our copy', () => {
    expect(shouldSkipUnchangedRow('2026-05-21T00:00:00Z', INGESTED)).toBe(
      false
    );
  });

  it('skips when the source is older than our copy', () => {
    expect(shouldSkipUnchangedRow('2026-05-10T00:00:00Z', INGESTED)).toBe(true);
  });

  it('skips when the source timestamp equals our copy', () => {
    expect(shouldSkipUnchangedRow(INGESTED, INGESTED)).toBe(true);
  });

  it('treats timestamps with differing zone notation by absolute instant', () => {
    // Same instant expressed two ways: equal => skip.
    expect(
      shouldSkipUnchangedRow('2026-05-17T18:00:00Z', '2026-05-17T18:00:00.000Z')
    ).toBe(true);
  });
});

describe('currentIngestedAt', () => {
  it('returns an ISO-8601 string for the provided date', () => {
    const date = new Date('2026-05-21T12:34:56.000Z');
    expect(currentIngestedAt(date)).toBe('2026-05-21T12:34:56.000Z');
  });

  it('round-trips to a parseable timestamp', () => {
    expect(Number.isNaN(Date.parse(currentIngestedAt()))).toBe(false);
  });
});
