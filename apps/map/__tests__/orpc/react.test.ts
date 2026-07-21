import { beforeEach, describe, expect, it } from "vitest";

import { getQueryClient, invalidateQueries } from "~/orpc/react";

describe("invalidateQueries", () => {
  beforeEach(() => {
    getQueryClient().clear();
  });

  it("matches a nested router path by segment name", async () => {
    const queryClient = getQueryClient();
    const mapLocationKey = [
      ["map", "location", "eventsAndLocations"],
      { input: undefined },
    ];
    const topLevelLocationKey = [["location", "canDeleteEvent"], { input: {} }];
    const eventKey = [["event", "all"], { input: undefined }];

    queryClient.setQueryData(mapLocationKey, []);
    queryClient.setQueryData(topLevelLocationKey, []);
    queryClient.setQueryData(eventKey, []);

    await invalidateQueries("location");

    expect(queryClient.getQueryState(mapLocationKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(topLevelLocationKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(eventKey)?.isInvalidated).toBe(false);
  });

  it("does not match unrelated router segments", async () => {
    const queryClient = getQueryClient();
    const key = [["map", "location", "workoutCount"], { input: undefined }];
    queryClient.setQueryData(key, {});

    await invalidateQueries("event");

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  });
});
