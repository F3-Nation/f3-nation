import { act, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

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

const enabledStartDates = () =>
  eventInstancesQueries()
    .filter((query) => query.enabled !== false)
    .map((query) => query.input?.startDate);

const latestEnabledStartDate = () => enabledStartDates().at(-1);

const openStartDateFilter = (label: string) => {
  fireEvent.click(screen.getByText(label));
};

// Radix's popper measures its trigger, and jsdom has no ResizeObserver.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- jsdom has no ResizeObserver
  globalThis.ResizeObserver ??= class {
    observe() {
      // no-op
    }
    unobserve() {
      // no-op
    }
    disconnect() {
      // no-op
    }
  };
});

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

  it("hydrates when the server is already on tomorrow", async () => {
    vi.setSystemTime(new Date(2026, 0, 16, 3, 0));
    const container = document.createElement("div");
    container.innerHTML = renderToString(<EventInstancesTable />);
    document.body.appendChild(container);

    vi.setSystemTime(new Date(2026, 0, 15, 21, 0));
    const onRecoverableError = vi.fn();
    const root = await act(() =>
      hydrateRoot(container, <EventInstancesTable />, { onRecoverableError }),
    );
    onTestFinished(() => {
      act(() => root.unmount());
      container.remove();
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(screen.getByText("2026-01-15 → …")).toBeTruthy();
    // The table re-renders after hydration, but no render may run the query
    // without a start date.
    expect(new Set(enabledStartDates())).toEqual(new Set(["2026-01-15"]));
  });

  it("filters from the browser's today once mounted", () => {
    render(<EventInstancesTable />);

    expect(screen.getByText("2026-01-15 → …")).toBeTruthy();
    expect(enabledStartDates()).toEqual(["2026-01-15"]);
  });

  it("keeps the first date when the table stays open past midnight", () => {
    render(<EventInstancesTable />);

    vi.setSystemTime(new Date(2026, 0, 16, 0, 5));
    fireEvent.change(screen.getByPlaceholderText(/^Search/), {
      target: { value: "bootcamp" },
    });

    expect(screen.getByText("2026-01-15 → …")).toBeTruthy();
    expect(new Set(enabledStartDates())).toEqual(new Set(["2026-01-15"]));
  });

  it("uses the range the user picks", () => {
    render(<EventInstancesTable />);
    openStartDateFilter("2026-01-15 → …");

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-02-01" },
    });

    expect(screen.getByText("2026-02-01 → …")).toBeTruthy();
    expect(latestEnabledStartDate()).toBe("2026-02-01");
  });

  it("keeps the range cleared instead of going back to today", () => {
    render(<EventInstancesTable />);
    openStartDateFilter("2026-01-15 → …");

    fireEvent.click(screen.getByRole("button", { name: "Clear dates" }));

    expect(screen.getByText("Filter by start date")).toBeTruthy();
    const latestQuery = eventInstancesQueries().at(-1);
    expect(latestQuery?.enabled).toBe(true);
    expect(latestQuery?.input?.startDate).toBeUndefined();
  });

  it("goes back to today when the filters are reset", () => {
    render(<EventInstancesTable />);
    openStartDateFilter("2026-01-15 → …");
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-02-01" },
    });

    fireEvent.click(screen.getByTitle("Reset Filters"));

    expect(screen.getByText("2026-01-15 → …")).toBeTruthy();
    expect(latestEnabledStartDate()).toBe("2026-01-15");
  });
});
