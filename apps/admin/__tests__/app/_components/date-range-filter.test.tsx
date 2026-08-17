import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  DateRangeFilter,
  EMPTY_DATE_RANGE,
  todayForwardDateRange,
} from "~/app/_components/date-range-filter";

// Radix's popper measures its trigger, and jsdom has no ResizeObserver.
beforeAll(() => {
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

const renderFilter = (
  props: Partial<Parameters<typeof DateRangeFilter>[0]> = {},
) => {
  const onChange = vi.fn();
  render(
    <DateRangeFilter value={EMPTY_DATE_RANGE} onChange={onChange} {...props} />,
  );
  return { onChange };
};

/** Renders the filter and opens the popover so both inputs are mounted. */
const openFilter = (
  props: Partial<Parameters<typeof DateRangeFilter>[0]> = {},
) => {
  const handles = renderFilter(props);
  fireEvent.click(screen.getByRole("combobox"));
  return handles;
};

describe("DateRangeFilter", () => {
  it("shows the default label when neither bound is set", () => {
    renderFilter();

    expect(screen.getByRole("combobox").textContent).toContain(
      "Filter by date",
    );
  });

  it("shows a custom label when provided", () => {
    renderFilter({ label: "Filter by instance date" });

    expect(screen.getByRole("combobox").textContent).toContain(
      "Filter by instance date",
    );
  });

  it.each([
    {
      value: { from: "2026-01-01", to: "2026-01-31" },
      text: "2026-01-01 → 2026-01-31",
    },
    { value: { from: "2026-01-01", to: "" }, text: "2026-01-01 → …" },
    { value: { from: "", to: "2026-01-31" }, text: "… → 2026-01-31" },
  ])("renders $text once a bound is set", ({ value, text }) => {
    renderFilter({ value });

    expect(screen.getByRole("combobox").textContent).toContain(text);
  });

  it("leaves min/max unset while the opposite bound is empty", () => {
    openFilter();

    expect(screen.getByLabelText("From").getAttribute("max")).toBeNull();
    expect(screen.getByLabelText("To").getAttribute("min")).toBeNull();
  });

  it("bounds each input by the other so the range cannot cross", () => {
    openFilter({ value: { from: "2026-01-01", to: "2026-01-31" } });

    expect(screen.getByLabelText("From").getAttribute("max")).toBe(
      "2026-01-31",
    );
    expect(screen.getByLabelText("To").getAttribute("min")).toBe("2026-01-01");
  });

  it("merges a changed `from` into the existing range", () => {
    const { onChange } = openFilter({ value: { from: "", to: "2026-01-31" } });

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-01-01" },
    });

    expect(onChange).toHaveBeenCalledWith({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });

  it("merges a changed `to` into the existing range", () => {
    const { onChange } = openFilter({ value: { from: "2026-01-01", to: "" } });

    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "2026-01-31" },
    });

    expect(onChange).toHaveBeenCalledWith({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });

  it("disables clearing while the range is empty", () => {
    openFilter();

    expect(screen.getByRole("button", { name: "Clear dates" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("clears both bounds", () => {
    const { onChange } = openFilter({
      value: { from: "2026-01-01", to: "2026-01-31" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear dates" }));

    expect(onChange).toHaveBeenCalledWith(EMPTY_DATE_RANGE);
  });
});

describe("todayForwardDateRange", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts on today and leaves the end open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15, 9, 30));

    expect(todayForwardDateRange()).toEqual({ from: "2026-01-15", to: "" });
  });

  it("re-reads the clock on every call", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15, 23, 59));
    const before = todayForwardDateRange();

    vi.setSystemTime(new Date(2026, 0, 16, 0, 1));

    expect(todayForwardDateRange().from).not.toBe(before.from);
  });
});
