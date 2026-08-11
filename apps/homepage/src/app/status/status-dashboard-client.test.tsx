// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import { StatusDashboardClient } from "./status-dashboard-client";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

// Render a minimal stub so tests don't depend on StatusCard's internals.
vi.mock("@/app/status/status-card", () => ({
  StatusCard: ({ result }: { result: { target: { label: string } } }) =>
    React.createElement(
      "div",
      { "data-testid": "status-card" },
      result.target.label,
    ),
}));

function makeApiResponse(
  overrides: Partial<{ ttlSeconds: number; results: unknown[] }> = {},
): Response {
  return new Response(
    JSON.stringify({
      generatedAt: "2026-07-14T12:00:00.000Z",
      ttlSeconds: overrides.ttlSeconds ?? 60,
      results: overrides.results ?? [],
    }),
    { status: 200 },
  );
}

describe("StatusDashboardClient", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test.local");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("shows loading indicator before first fetch completes", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(<StatusDashboardClient />);
    expect(screen.getByText("Fetching latest status...")).toBeInTheDocument();
  });

  it("renders a card per result and removes loading text on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeApiResponse({
          results: [
            {
              ok: true,
              source: "contract",
              target: {
                id: "me",
                label: "F3 Me",
                url: "https://me.test",
                source: "contract",
              },
              status: "ok",
              data: {
                service: "f3-me",
                version: "1.0.0",
                contractVersion: "1.0.0",
                status: "ok",
                timestamp: "2026-07-14T12:00:00.000Z",
                durationMs: 10,
                checks: [{ id: "db", status: "ok", severity: "critical" }],
              },
            },
          ],
        }),
      ),
    );
    render(<StatusDashboardClient />);
    await waitFor(() =>
      expect(
        screen.queryByText("Fetching latest status..."),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("status-card")).toHaveTextContent("F3 Me");
  });

  it("shows error banner when upstream returns an HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Bad Gateway", { status: 502 })),
    );
    render(<StatusDashboardClient />);
    await waitFor(() =>
      expect(
        screen.getByText(/Unable to load status data/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/502/)).toBeInTheDocument();
  });

  it("shows error banner when the response shape guard fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
        ),
    );
    render(<StatusDashboardClient />);
    await waitFor(() =>
      expect(
        screen.getByText(/Unexpected response shape/i),
      ).toBeInTheDocument(),
    );
  });

  it("clears error banner after a subsequent successful poll", async () => {
    vi.useFakeTimers();

    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        calls++;
        return calls === 1
          ? Promise.resolve(new Response("oops", { status: 503 }))
          : Promise.resolve(makeApiResponse());
      }),
    );

    render(<StatusDashboardClient />);

    // Flush the initial (failing) fetch — it resolves as a microtask.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/Unable to load status data/i)).toBeInTheDocument();

    // Advance past the fallback polling interval (FALLBACK_TTL_SECONDS = 60s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });

    expect(
      screen.queryByText(/Unable to load status data/i),
    ).not.toBeInTheDocument();

    vi.useRealTimers();
  });
});
