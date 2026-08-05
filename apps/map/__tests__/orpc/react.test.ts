import { beforeEach, describe, expect, it } from "vitest";

import { getQueryClient, invalidateQueries, orpc } from "~/orpc/react";

describe("invalidateQueries", () => {
  beforeEach(() => {
    getQueryClient().clear();
  });

  // getQueryClient() only returns a stable singleton in a browser-like
  // environment (jsdom, per vitest.config.ts) — under environment: "node" it
  // would hand out a fresh client per call, and every test below would
  // silently stop testing anything.
  it("returns the same client instance across calls", () => {
    expect(getQueryClient()).toBe(getQueryClient());
  });

  it("matches a nested router path by segment name", async () => {
    const queryClient = getQueryClient();
    const mapLocationKey = orpc.map.location.eventsAndLocations.queryKey({
      input: undefined,
    });
    const topLevelLocationKey = orpc.location.all.queryKey({ input: {} });
    const eventKey = orpc.event.all.queryKey({ input: undefined });

    queryClient.setQueryData(mapLocationKey, []);
    queryClient.setQueryData(topLevelLocationKey, {
      locations: [],
      totalCount: 0,
    });
    queryClient.setQueryData(eventKey, { events: [], totalCount: 0 });

    await invalidateQueries("location");

    expect(queryClient.getQueryState(mapLocationKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(topLevelLocationKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(eventKey)?.isInvalidated).toBe(false);
  });

  it("does not match a segment that is only a substring of another segment", async () => {
    const queryClient = getQueryClient();
    // "eventsAndLocations" contains "event" as a substring — a substring-based
    // match (e.g. path.some((s) => s.includes(keyOrOptions))) would wrongly
    // invalidate this; exact segment equality must not.
    const key = orpc.map.location.eventsAndLocations.queryKey({
      input: undefined,
    });
    // Positive control: proves the client/singleton actually invalidates
    // matching queries, so the negative assertion below can't pass merely
    // because invalidation is broken or a no-op.
    const controlKey = orpc.event.all.queryKey({ input: undefined });
    queryClient.setQueryData(key, []);
    queryClient.setQueryData(controlKey, { events: [], totalCount: 0 });

    await invalidateQueries("event");

    expect(queryClient.getQueryState(controlKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("passes query options through to invalidate only the matching query", async () => {
    const queryClient = getQueryClient();
    const canDeleteEventKey = orpc.request.canDeleteEvent.queryKey({
      input: { eventId: 1 },
    });
    const eventKey = orpc.event.all.queryKey({ input: undefined });

    queryClient.setQueryData(canDeleteEventKey, { canDelete: true });
    queryClient.setQueryData(eventKey, { events: [], totalCount: 0 });

    await invalidateQueries({ queryKey: canDeleteEventKey, exact: false });

    expect(queryClient.getQueryState(canDeleteEventKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(eventKey)?.isInvalidated).toBe(false);
  });

  it("invalidates the entire cache when called with no argument", async () => {
    const queryClient = getQueryClient();
    const mapLocationKey = orpc.map.location.eventsAndLocations.queryKey({
      input: undefined,
    });
    const eventKey = orpc.event.all.queryKey({ input: undefined });

    queryClient.setQueryData(mapLocationKey, []);
    queryClient.setQueryData(eventKey, { events: [], totalCount: 0 });

    await invalidateQueries();

    expect(queryClient.getQueryState(mapLocationKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(eventKey)?.isInvalidated).toBe(true);
  });
});
