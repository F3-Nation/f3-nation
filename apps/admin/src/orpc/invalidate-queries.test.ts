import type { Query } from "@tanstack/react-query";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { invalidateQueries } from "./invalidate-queries";

function fakeQuery(path: unknown): Query {
  return { queryKey: [path] } as unknown as Query;
}

describe("invalidateQueries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("matches a string key against any segment of the router path", async () => {
    const spy = vi.spyOn(QueryClient.prototype, "invalidateQueries");

    await invalidateQueries("location");

    expect(spy).toHaveBeenCalledTimes(1);
    const options = spy.mock.calls[0]?.[0];
    const predicate = options?.predicate;
    expect(predicate).toBeInstanceOf(Function);

    // single-segment router path
    expect(predicate?.(fakeQuery(["location"]))).toBe(true);
    // nested router path — segment appears anywhere in the array
    expect(
      predicate?.(fakeQuery(["map", "location", "eventsAndLocations"])),
    ).toBe(true);
    // unrelated router path
    expect(predicate?.(fakeQuery(["request", "all"]))).toBe(false);
    // non-array queryKey[0] should not match
    expect(predicate?.(fakeQuery("location"))).toBe(false);
  });

  it("forwards non-string options directly to the underlying client", async () => {
    const spy = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    const options = { queryKey: ["request", "all"] };

    await invalidateQueries(options);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(options);
  });

  it("invalidates everything when called with no arguments", async () => {
    const spy = vi.spyOn(QueryClient.prototype, "invalidateQueries");

    await invalidateQueries();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(undefined);
  });
});
