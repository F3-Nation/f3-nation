// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { DirectorySpinner } from "./directory-spinner";
import { OrgDirectory } from "./org-directory";
import { OrgMapLoader } from "./org-map-loader";

// The real map needs Leaflet; stand in a marker that renders the switcher.
// The loader's own dynamic import resolves to the real directory.
vi.mock("next/dynamic", () => ({
  default: (
    loader: () => Promise<unknown>,
    options: { loading: () => React.ReactNode },
  ) => {
    // Exercise the loading placeholder each dynamic import declares.
    loadingPlaceholders.push(options.loading);
    if (String(loader).includes("org-map")) {
      return function MockMap({
        viewSwitcher,
        onSelectionChange,
      }: {
        viewSwitcher?: React.ReactNode;
        onSelectionChange?: (orgId: number | null) => void;
      }) {
        mapProps.onSelectionChange = onSelectionChange;
        return (
          <div>
            map view
            {viewSwitcher}
          </div>
        );
      };
    }
    return function Loaded() {
      return <OrgDirectory />;
    };
  },
}));

const loadingPlaceholders = vi.hoisted(() => [] as (() => React.ReactNode)[]);
const mapProps = vi.hoisted(() => ({
  onSelectionChange: undefined as undefined | ((orgId: number | null) => void),
}));

const tableProps = vi.hoisted(() => ({
  latest: null as null | {
    initialOrgIds?: readonly number[];
    onMapFocusChange?: (orgId: number | null) => void;
  },
}));
vi.mock("./org-table", () => ({
  OrgTable: (props: {
    viewSwitcher?: React.ReactNode;
    initialOrgIds?: readonly number[];
    onMapFocusChange?: (orgId: number | null) => void;
  }) => {
    tableProps.latest = props;
    return (
      <div>
        table view {JSON.stringify(props.initialOrgIds)}
        {props.viewSwitcher}
      </div>
    );
  },
}));

beforeEach(() => {
  window.history.replaceState(null, "", "./");
  tableProps.latest = null;
});
afterEach(cleanup);

describe("DirectorySpinner", () => {
  it("is the loading placeholder for both dynamic imports", () => {
    render(<OrgMapLoader />);
    expect(loadingPlaceholders.length).toBeGreaterThanOrEqual(2);
    cleanup();
    for (const loading of loadingPlaceholders) {
      const { container, unmount } = render(<>{loading()}</>);
      expect(container.querySelector(".animate-spin")).toBeTruthy();
      unmount();
    }
    const { container } = render(<DirectorySpinner />);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });
});

describe("OrgDirectory", () => {
  it("opens on the Map and switches between views", () => {
    render(<OrgMapLoader />);
    expect(screen.getByText("map view")).toBeTruthy();
    const mapButton = screen.getByRole("button", { name: "Map" });
    expect(mapButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByText(/table view/)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Table" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    // Clicking the active option does nothing.
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByText(/table view/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(screen.getByText("map view")).toBeTruthy();
  });

  it("carries the Map's org into the Table filters", () => {
    window.history.replaceState(null, "", "?level=regions&org=5&at=1,2,8");
    render(<OrgDirectory />);
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByText("table view [5]")).toBeTruthy();
    expect(window.location.search).toBe("?view=table&orgs=5");
  });

  it("carries the Map's chosen org, not a hovered one, into the Table", () => {
    window.history.replaceState(null, "", "?level=regions&org=5");
    render(<OrgDirectory />);
    // The visitor drills into org 9, then hovers region 12 (the map rewrites
    // the URL's org on hover without reporting it).
    mapProps.onSelectionChange!(9);
    window.history.replaceState(null, "", "?level=regions&org=12");
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByText("table view [9]")).toBeTruthy();
  });

  it("opens the Table empty from the Nation view", () => {
    render(<OrgDirectory />);
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByText("table view []")).toBeTruthy();
    expect(window.location.search).toBe("?view=table");
  });

  it("reopens the Table from the URL and sends its focus org to the Map", async () => {
    window.history.replaceState(null, "", "?view=table&orgs=2,3");
    render(<OrgDirectory />);
    expect(screen.getByText("table view [2,3]")).toBeTruthy();

    tableProps.latest!.onMapFocusChange!(3);
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(screen.getByText("map view")).toBeTruthy();
    await waitFor(() => expect(window.location.search).toBe("?org=3"));
  });

  it("forgets an earlier Table visit's focus when the Table hasn't published one", async () => {
    window.history.replaceState(null, "", "?view=table&orgs=2,3");
    render(<OrgDirectory />);
    tableProps.latest!.onMapFocusChange!(3);
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(window.location.search).toBe("?org=3"));

    // On the Map, pick org 8, then visit the Table and leave before it loads.
    mapProps.onSelectionChange!(8);
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    await waitFor(() => expect(window.location.search).toBe("?org=8"));
  });

  it("opens the Map at Nation when the Table has no single selection", () => {
    window.history.replaceState(null, "", "?view=table");
    render(<OrgDirectory />);
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(window.location.search).toBe("");
  });
});
