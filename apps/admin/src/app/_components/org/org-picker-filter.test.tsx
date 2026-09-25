import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrgPickerFilter } from "./org-picker-filter";

// cmdk measures and scrolls with browser APIs jsdom does not implement.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);
Element.prototype.scrollIntoView = vi.fn();

const alpha = { id: 1, name: "Alpha" };
const beta = { id: 2, name: "Beta" };

afterEach(cleanup);

describe("OrgPickerFilter", () => {
  it.each([
    {
      orgType: "sector" as const,
      none: "Filter by sector",
      one: "1 sector selected",
      many: "2 sectors selected",
    },
    {
      orgType: "area" as const,
      none: "Filter by area",
      one: "1 area selected",
      many: "2 areas selected",
    },
    {
      orgType: "territory" as const,
      none: "Filter by territory",
      one: "1 territory selected",
      many: "2 territories selected",
    },
  ])(
    "labels the $orgType filter by selection count",
    ({ orgType, none, one, many }) => {
      const { rerender } = render(
        <OrgPickerFilter
          orgType={orgType}
          orgs={[alpha, beta]}
          selected={[]}
          onSelect={vi.fn()}
        />,
      );
      expect(screen.getByRole("combobox").textContent).toBe(none);

      rerender(
        <OrgPickerFilter
          orgType={orgType}
          orgs={[alpha, beta]}
          selected={[alpha]}
          onSelect={vi.fn()}
        />,
      );
      expect(screen.getByRole("combobox").textContent).toBe(one);

      rerender(
        <OrgPickerFilter
          orgType={orgType}
          orgs={[alpha, beta]}
          selected={[alpha, beta]}
          onSelect={vi.fn()}
        />,
      );
      expect(screen.getByRole("combobox").textContent).toBe(many);
    },
  );

  it("lists the organizations and reports the one chosen", () => {
    const onSelect = vi.fn();
    render(
      <OrgPickerFilter
        orgType="territory"
        orgs={[alpha, beta]}
        selected={[]}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByPlaceholderText("Search territories...")).toBeTruthy();
    fireEvent.click(screen.getByText("Beta"));

    expect(onSelect).toHaveBeenCalledWith(beta);
  });

  it("shows an empty state named for the type when there are no organizations", () => {
    render(
      <OrgPickerFilter
        orgType="territory"
        orgs={[]}
        selected={[]}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("combobox"));

    expect(screen.getByText("No territories found.")).toBeTruthy();
  });

  it("renders without options while they are still loading", () => {
    render(
      <OrgPickerFilter
        orgType="area"
        orgs={undefined}
        selected={[]}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox").textContent).toBe("Filter by area");
  });
});
