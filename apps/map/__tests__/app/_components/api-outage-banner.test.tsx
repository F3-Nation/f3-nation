import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ORPCError } from "@orpc/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RETRY_BASE_MS as API_RETRY_BASE_MS } from "@acme/ui/api-unavailable";

import { ApiOutageBanner } from "~/app/_components/api-outage-banner";

const outage = () => new ORPCError("SERVICE_UNAVAILABLE", { status: 503 });

function Consumer(props: { queryFn: () => Promise<string> }) {
  useQuery({ queryKey: ["regions"], queryFn: props.queryFn, retry: false });
  return null;
}

function setup(queryFn: () => Promise<string>, cached?: string) {
  const queryClient = new QueryClient();
  if (cached !== undefined) queryClient.setQueryData(["regions"], cached);
  render(
    <QueryClientProvider client={queryClient}>
      <Consumer queryFn={queryFn} />
      <ApiOutageBanner />
    </QueryClientProvider>,
  );
  return queryClient;
}

const banner = () => screen.queryByRole("alert");

describe("ApiOutageBanner", () => {
  let visibility: DocumentVisibilityState;

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
    // Pin the jitter so the timer fires at exactly the base delay.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stays hidden while the API is up", async () => {
    setup(() => Promise.resolve("ok"));
    await vi.advanceTimersByTimeAsync(0);

    expect(banner()).toBeNull();
  });

  it("stays hidden for an error that is not an outage", async () => {
    setup(() => Promise.reject(new ORPCError("FORBIDDEN", { status: 403 })));
    await vi.advanceTimersByTimeAsync(0);

    expect(banner()).toBeNull();
  });

  it("stays hidden when a query was cancelled by the caller", async () => {
    setup(() =>
      Promise.reject(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(banner()).toBeNull();
  });

  it("appears when the API did not respond in time", async () => {
    setup(() =>
      Promise.reject(new DOMException("API did not respond", "TimeoutError")),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(banner()?.textContent).toMatch(/trouble loading data/i);
  });

  it("appears when a query fails because the API is down", async () => {
    setup(() => Promise.reject(outage()));
    await vi.advanceTimersByTimeAsync(0);

    expect(banner()?.textContent).toMatch(/trouble loading data/i);
  });

  it("retries on its own and goes away once the API is back", async () => {
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(outage())
      .mockResolvedValue("ok");
    setup(queryFn);
    await vi.advanceTimersByTimeAsync(0);
    expect(banner()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(API_RETRY_BASE_MS - 1);
    expect(queryFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(banner()).toBeNull();
  });

  it("stays up while a retry is still in flight", async () => {
    let succeed: (value: string) => void = () => undefined;
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(outage())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            succeed = resolve;
          }),
      );
    setup(queryFn);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(API_RETRY_BASE_MS);
    expect(queryFn).toHaveBeenCalledTimes(2);
    // The query has no data, so the retry put it back to `pending`.
    expect(banner()).not.toBeNull();

    succeed("ok");
    await vi.advanceTimersByTimeAsync(0);
    expect(banner()).toBeNull();
  });

  it("joins a retry already in flight instead of restarting it", async () => {
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(outage())
      .mockImplementation(() => new Promise(() => undefined));
    // With cached data, a failed refresh keeps the query in `error` while it
    // refetches, so it still matches the retry filter.
    setup(queryFn, "cached");
    await vi.advanceTimersByTimeAsync(0);
    expect(banner()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(API_RETRY_BASE_MS);
    expect(queryFn).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await vi.advanceTimersByTimeAsync(API_RETRY_BASE_MS);

    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("keeps retrying while the outage lasts", async () => {
    const queryFn = vi.fn<() => Promise<string>>().mockRejectedValue(outage());
    setup(queryFn);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(API_RETRY_BASE_MS * 2);

    expect(queryFn).toHaveBeenCalledTimes(3);
    expect(banner()).not.toBeNull();
  });

  it("skips the retry while the tab is hidden", async () => {
    const queryFn = vi.fn<() => Promise<string>>().mockRejectedValue(outage());
    setup(queryFn);
    await vi.advanceTimersByTimeAsync(0);

    visibility = "hidden";
    await vi.advanceTimersByTimeAsync(API_RETRY_BASE_MS * 3);
    expect(queryFn).toHaveBeenCalledTimes(1);

    visibility = "visible";
    await vi.advanceTimersByTimeAsync(API_RETRY_BASE_MS);
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("retries immediately on Try again", async () => {
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(outage())
      .mockResolvedValue("ok");
    setup(queryFn);
    await vi.advanceTimersByTimeAsync(0);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await vi.advanceTimersByTimeAsync(0);

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(banner()).toBeNull();
  });
});
