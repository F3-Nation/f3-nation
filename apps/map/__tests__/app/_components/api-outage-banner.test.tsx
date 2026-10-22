import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ORPCError } from "@orpc/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_RETRY_BASE_MS } from "@acme/shared/app/api-availability";

import { ApiOutageBanner } from "~/app/_components/api-outage-banner";

const outage = () => new ORPCError("SERVICE_UNAVAILABLE", { status: 503 });

function Consumer(props: { queryFn: () => Promise<string> }) {
  useQuery({ queryKey: ["regions"], queryFn: props.queryFn, retry: false });
  return null;
}

function setup(queryFn: () => Promise<string>) {
  const queryClient = new QueryClient();
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
