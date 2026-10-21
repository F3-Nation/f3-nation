import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventInstancesTable } from "~/app/event-instances/event-instances-table";

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }));

vi.mock("~/orpc/react", () => ({
  useQuery: useQueryMock,
  orpc: {
    eventInstance: {
      all: {
        queryOptions: (options: object) => ({
          ...options,
          queryKey: ["eventInstance.all"],
        }),
      },
    },
  },
}));

interface EventInstancesQuery {
  queryKey: unknown[];
  enabled?: boolean;
  input?: { startDate?: string; startDateTo?: string };
}

// The AO and region filters call useQuery too, so keep only the table's own query.
const eventInstancesQueries = () =>
  useQueryMock.mock.calls
    .map(([options]) => options as EventInstancesQuery)
    .filter((options) => options.queryKey[0] === "eventInstance.all");

describe("EventInstancesTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryMock.mockReturnValue({ data: undefined });
    // Only fake Date, so React still flushes effects normally.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 15, 21, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps today's date out of the server render", () => {
    const html = renderToString(<EventInstancesTable />);

    expect(html).toContain("Filter by start date");
    expect(html).not.toContain("2026-01-15");
    expect(eventInstancesQueries()).toEqual([
      expect.objectContaining({ enabled: false }),
    ]);
  });

  it("filters from the browser's today once mounted", () => {
    render(<EventInstancesTable />);

    expect(screen.getByText("2026-01-15 → …")).toBeTruthy();
    expect(
      eventInstancesQueries()
        .filter((query) => query.enabled !== false)
        .map((query) => query.input?.startDate),
    ).toEqual(["2026-01-15"]);
  });
});
