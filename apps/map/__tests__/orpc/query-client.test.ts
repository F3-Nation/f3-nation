import type { DehydratedState, QueryClient } from "@tanstack/react-query";
import { dehydrate, hydrate } from "@tanstack/react-query";
import { ORPCError } from "@orpc/client";
import { describe, expect, it, vi } from "vitest";

import {
  createQueryClient,
  MAP_DATASET_STALE_TIME_MS,
} from "../../src/orpc/query-client";

describe("createQueryClient", () => {
  const queries = () => createQueryClient().getDefaultOptions().queries!;

  it("keeps the 30s default staleTime; the map datasets opt into longer", () => {
    expect(queries().staleTime).toBe(30_000);
    expect(MAP_DATASET_STALE_TIME_MS).toBe(5 * 60_000);
  });

  type ThrowOnError = (
    e: unknown,
    query: { state: { data: unknown } },
  ) => boolean;
  const noData = { state: { data: undefined } };

  it("doesn't throw abort errors, but throws everything else", () => {
    const throwOnError = queries().throwOnError as ThrowOnError;
    const abort = Object.assign(new Error("x"), { name: "AbortError" });
    expect(throwOnError(abort, noData)).toBe(false);
    expect(
      throwOnError(new Error("signal is aborted without reason"), noData),
    ).toBe(false);
    expect(throwOnError(new Error("boom"), noData)).toBe(true);
  });

  // The API being down is shown by <ApiOutageBanner />; throwing here would
  // replace the whole map with the global error screen (the crash in the issue).
  it("doesn't throw when the API is unavailable, even with no data", () => {
    const throwOnError = queries().throwOnError as ThrowOnError;
    expect(
      throwOnError(
        new ORPCError("SERVICE_UNAVAILABLE", { status: 503 }),
        noData,
      ),
    ).toBe(false);
    expect(throwOnError(new TypeError("fetch failed"), noData)).toBe(false);
    // An API that answered with a client error is still a real error.
    expect(
      throwOnError(new ORPCError("FORBIDDEN", { status: 403 }), noData),
    ).toBe(true);
  });

  it("fails at once on an outage but retries other errors up to 3 times", () => {
    const retry = queries().retry as (count: number, e: unknown) => boolean;
    const down = new ORPCError("SERVICE_UNAVAILABLE", { status: 503 });
    expect(retry(0, down)).toBe(false);
    expect(retry(0, new Error("boom"))).toBe(true);
    expect(retry(2, new Error("boom"))).toBe(true);
    expect(retry(3, new Error("boom"))).toBe(false);
  });

  // A failed background refresh (e.g. of the SSG-hydrated map datasets) must
  // not replace data the page is already showing with the error boundary.
  it("doesn't throw when the query already has data", () => {
    const throwOnError = queries().throwOnError as ThrowOnError;
    expect(throwOnError(new Error("boom"), { state: { data: [] } })).toBe(
      false,
    );
  });

  it("round-trips non-JSON values (Dates) through dehydrate/hydrate", async () => {
    const server = createQueryClient();
    const when = new Date("2026-10-10T12:00:00Z");
    await server.query({ queryKey: ["k"], queryFn: () => ({ when }) });

    const client = createQueryClient();
    // Through JSON, as the SSR payload travels.
    const wire = JSON.parse(
      JSON.stringify(dehydrate(server)),
    ) as DehydratedState;
    hydrate(client, wire);

    const data = client.getQueryData<{ when: Date }>(["k"]);
    expect(data?.when).toBeInstanceOf(Date);
    expect(data?.when.toISOString()).toBe(when.toISOString());
  });

  it("logs a failed query once, with its key", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const client: QueryClient = createQueryClient();
    await client
      .query({
        queryKey: ["fails"],
        queryFn: () => Promise.reject(new Error("nope")),
        retry: false,
      })
      .catch(() => undefined);
    expect(error).toHaveBeenCalledWith(
      "map.query_failed",
      { queryKey: ["fails"] },
      expect.any(Error),
    );
    error.mockRestore();
  });
});
