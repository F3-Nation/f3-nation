import { describe, expect, it } from "vitest";

import { rejectStravaMetadata, stripStravaMetadata } from "./user-metadata";
import { shapeUserPii } from "./user";

describe("profile credential boundary", () => {
  const meta = {
    strava_access_token: "synthetic-access",
    strava_refresh_token: "synthetic-refresh",
    strava_athlete_id: 123,
    strava_expires_at: 456,
    strava_future_secret: "synthetic-future",
    my_f3_why: "exercise",
    home_region_nudge_opt_out: true,
  };

  it("removes all reserved keys without changing the original", () => {
    expect(stripStravaMetadata(meta)).toEqual({
      my_f3_why: "exercise",
      home_region_nudge_opt_out: true,
    });
    expect(meta.strava_access_token).toBe("synthetic-access");
    expect(stripStravaMetadata(null)).toBeNull();
    expect(stripStravaMetadata(undefined)).toBeUndefined();
  });

  it.each(
    [
      '{"strava_access_token":"synthetic-access"}',
      [{ strava_access_token: "synthetic-access" }],
      42,
      true,
    ].map((value) => ({ value })),
  )("fails closed on non-object metadata %j", ({ value }) => {
    expect(stripStravaMetadata(value)).toBeNull();
  });

  it.each([true, false])(
    "removes credentials with PII access %s",
    (includePii) => {
      const result = shapeUserPii(
        { meta, email: "synthetic@example.test" },
        includePii,
      );
      expect(result.meta).toEqual({
        my_f3_why: "exercise",
        home_region_nudge_opt_out: true,
      });
      expect("email" in result).toBe(includePii);
    },
  );

  it.each(Object.keys(meta).filter((key) => key.startsWith("strava_")))(
    "rejects writes to %s, even deletion attempts",
    (key) => {
      expect(() => rejectStravaMetadata({ [key]: null })).toThrow(
        expect.objectContaining({ code: "BAD_REQUEST" }),
      );
    },
  );

  it("allows ordinary metadata and omitted or null metadata", () => {
    expect(() => rejectStravaMetadata({ my_f3_why: "exercise" })).not.toThrow();
    expect(() => rejectStravaMetadata(null)).not.toThrow();
    expect(() => rejectStravaMetadata(undefined)).not.toThrow();
  });
});
