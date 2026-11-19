// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { LeaderEntry, Org } from "../_lib/types";
import { fetchLeadership } from "../_lib/api";
import { downloadCsv } from "../_lib/leadership-csv";
import { OrgTable } from "./org-table";

vi.mock("../_lib/api", () => ({
  fetchLeadership: vi.fn(),
}));
vi.mock(import("../_lib/leadership-csv"), async (importOriginal) => ({
  ...(await importOriginal()),
  downloadCsv: vi.fn(),
}));
vi.mock("../_lib/use-ao-search", () => ({
  useAoSearch: () => ({ results: [], loading: false, error: false }),
}));

const org = (
  id: number,
  name: string,
  orgType: Org["orgType"],
  parentId: number | null,
): Org => ({ id, name, orgType, parentId });

// The API lists every active org, with or without locations.
const ORGS: Org[] = [
  org(1, "Nation", "nation", null),
  org(2, "Southeast", "sector", 1),
  org(3, "North Carolina", "territory", 2),
  org(4, "Florida", "territory", 2),
  org(5, "Western NC", "area", 3),
  org(6, "Miami", "area", 4),
  org(7, "Boone", "region", 5),
  org(8, "Coral Gables", "region", 6),
];

const LEADERS: LeaderEntry[] = [
  {
    orgId: 7,
    kind: "position",
    id: 1,
    title: "Nant'an",
    userId: 11,
    f3Name: "Switchback",
    avatarUrl: null,
    homeRegionName: "Boone",
  },
  {
    orgId: 8,
    kind: "position",
    id: 1,
    title: "Nant'an",
    userId: 12,
    f3Name: "Gator",
    avatarUrl: "https://example.com/g.png",
    homeRegionName: null,
  },
  {
    orgId: 2,
    kind: "role",
    id: 3,
    title: "admin",
    userId: 13,
    f3Name: null,
    avatarUrl: null,
    homeRegionName: null,
  },
];

afterEach(() => {
  cleanup();
  vi.mocked(fetchLeadership).mockReset();
  vi.mocked(downloadCsv).mockReset();
});

function bodyRows() {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1);
}

/** Body rows for people, leaving out empty-org placeholders. */
function leaderRows() {
  return bodyRows().filter((r) => !r.hasAttribute("data-empty-org"));
}

/** The table loaded; `initialOrgIds` pre-checks filters (none: sectors only). */
async function renderLoaded(initialOrgIds: number[] = []) {
  vi.mocked(fetchLeadership).mockResolvedValue({
    orgs: ORGS,
    leaders: LEADERS,
  });
  render(
    <OrgTable
      viewSwitcher={<span>switcher</span>}
      initialOrgIds={initialOrgIds}
    />,
  );
  await screen.findByRole("table");
}

const SOUTHEAST = 2;

describe("OrgTable", () => {
  it("lists only sector positions, without children, when no filter is set", async () => {
    await renderLoaded();
    expect(screen.getByText("1 position or role")).toBeTruthy();
    const [sectorRow, ...rest] = bodyRows();
    expect(rest).toHaveLength(0);
    expect(within(sectorRow!).getAllByRole("cell")[0]!.textContent).toBe(
      "Southeast (Sector)",
    );
    expect(sectorRow!.textContent).toContain("admin");
  });

  it("lists every leader with avatar, title, kind, level, and org", async () => {
    await renderLoaded([SOUTHEAST]);
    expect(screen.getByText("switcher")).toBeTruthy();
    expect(screen.getByText(/^3 positions and roles/)).toBeTruthy();
    const [sectorRow, booneRow, gablesRow] = leaderRows();
    expect(sectorRow!.textContent).toContain("Unknown");
    expect(sectorRow!.textContent).toContain("role");
    expect(sectorRow!.textContent).toContain("Southeast (Sector)");
    const headers = within(screen.getByRole("table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["Org↕", "PAX↕", "Position/Role↕"]);
    expect(within(booneRow!).getAllByRole("cell")[0]!.textContent).toBe(
      "Boone (Region)",
    );
    expect(within(booneRow!).getByRole("rowheader").textContent).toBe(
      "SSwitchback (Boone)",
    );
    // No home region: no parentheses.
    expect(within(gablesRow!).getByRole("rowheader").textContent).toBe("Gator");
    expect(booneRow!.textContent).toContain("S"); // initials avatar
    expect(gablesRow!.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/g.png",
    );
  });

  const filterButton = (label: string) =>
    screen.getByRole("button", { name: new RegExp(`^${label} `) });

  function openFilter(label: string) {
    fireEvent.click(filterButton(label));
    return screen.getByRole("dialog", { name: `${label} filter` });
  }

  it("narrows options and rows when territories are checked", async () => {
    await renderLoaded();
    let dialog = openFilter("Territory");
    fireEvent.click(within(dialog).getByLabelText("North Carolina"));
    expect(filterButton("Sector").textContent).toContain("Southeast");
    expect(filterButton("Territory").textContent).toContain("North Carolina");
    expect(leaderRows()).toHaveLength(1);
    expect(screen.getByText(/^1 position or role · /)).toBeTruthy();

    // Search within the filter, then check a second territory.
    fireEvent.change(within(dialog).getByRole("searchbox"), {
      target: { value: "flo" },
    });
    expect(within(dialog).queryByLabelText("North Carolina")).toBeNull();
    fireEvent.click(within(dialog).getByLabelText("Florida"));
    expect(filterButton("Territory").textContent).toContain("2 selected");
    expect(leaderRows()).toHaveLength(2);

    fireEvent.change(within(dialog).getByRole("searchbox"), {
      target: { value: "zzz" },
    });
    expect(within(dialog).getByText("No matches")).toBeTruthy();

    // Escape closes and returns focus to the filter's button; the Region
    // filter now offers regions in both.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(filterButton("Territory"));

    // Tabbing out of the popup closes it; moving within it does not.
    dialog = openFilter("Territory");
    const [firstBox, secondBox] = within(dialog).getAllByRole("checkbox");
    fireEvent.blur(firstBox!, { relatedTarget: secondBox });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.blur(secondBox!, { relatedTarget: filterButton("Area") });
    expect(screen.queryByRole("dialog")).toBeNull();
    dialog = openFilter("Region");
    expect(
      within(dialog)
        .getAllByRole("checkbox")
        .map((c) => c.parentElement!.textContent),
    ).toEqual(["Boone", "Coral Gables"]);

    // Clicking outside closes; Clear on Territory resets it and Region.
    fireEvent.click(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    dialog = openFilter("Territory");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear" }));
    expect(filterButton("Territory").textContent).toContain("All");
    expect(leaderRows()).toHaveLength(3); // the whole Southeast sector
    fireEvent.click(filterButton("Territory"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sorts by a column header: asc, desc, then default", async () => {
    await renderLoaded([SOUTHEAST]);
    const paxHeader = () => screen.getByRole("columnheader", { name: /PAX/ });
    const names = () =>
      leaderRows().map((r) => within(r).getByRole("rowheader").textContent);
    fireEvent.click(within(paxHeader()).getByRole("button"));
    expect(paxHeader().getAttribute("aria-sort")).toBe("ascending");
    expect(paxHeader().textContent).toBe("PAX▲");
    // Missing names sort first; Gator has a photo, so no initials.
    expect(names()).toEqual(["?Unknown", "Gator", "SSwitchback (Boone)"]);
    fireEvent.click(within(paxHeader()).getByRole("button"));
    expect(paxHeader().getAttribute("aria-sort")).toBe("descending");
    expect(names()).toEqual(["SSwitchback (Boone)", "Gator", "?Unknown"]);
    fireEvent.click(within(paxHeader()).getByRole("button"));
    expect(paxHeader().getAttribute("aria-sort")).toBe("none");
    expect(names()).toEqual(["?Unknown", "SSwitchback (Boone)", "Gator"]);
  });

  it("downloads the filtered rows in the current sort as CSV", async () => {
    await renderLoaded();
    fireEvent.click(within(openFilter("Region")).getByLabelText("Boone"));
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [csv, filename] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(csv.split("\r\n")).toEqual([
      "Org,Level,PAX,Home Region,Position/Role,Type",
      "Boone,Region,Switchback,Boone,Nant'an,Position",
      "",
    ]);
    expect(filename).toMatch(/^f3-positions-and-roles-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("restores filters from initial ids and keeps the URL and Map focus current", async () => {
    window.history.replaceState(null, "", "?view=table&orgs=5");
    vi.mocked(fetchLeadership).mockResolvedValue({
      orgs: ORGS,
      leaders: LEADERS,
    });
    const onMapFocusChange = vi.fn();
    render(
      <OrgTable initialOrgIds={[5]} onMapFocusChange={onMapFocusChange} />,
    );
    await screen.findByRole("table");
    // Western NC plus its ancestors are checked; only Boone's row is in scope.
    expect(filterButton("Area").textContent).toContain("Western NC");
    expect(filterButton("Territory").textContent).toContain("North Carolina");
    expect(leaderRows()).toHaveLength(1);
    // The URL is written in an effect just after the table first renders.
    await waitFor(() =>
      expect(window.location.search).toBe("?view=table&orgs=2,3,5"),
    );
    expect(onMapFocusChange).toHaveBeenLastCalledWith(5);

    // A second territory: the Map would open on the single sector.
    fireEvent.click(within(openFilter("Territory")).getByLabelText("Florida"));
    expect(window.location.search).toBe("?view=table&orgs=2,3,4,5");
    expect(onMapFocusChange).toHaveBeenLastCalledWith(5);
    fireEvent.click(
      within(openFilter("Area")).getByRole("button", { name: "Clear" }),
    );
    expect(window.location.search).toBe("?view=table&orgs=2,3,4");
    expect(onMapFocusChange).toHaveBeenLastCalledWith(2);
  });

  it("clears every filter at once, shown only while one is set", async () => {
    await renderLoaded();
    const clearAll = () =>
      screen.queryByRole("button", { name: "Clear filters" });
    expect(clearAll()).toBeNull();

    fireEvent.click(within(openFilter("Region")).getByLabelText("Boone"));
    fireEvent.click(document.body);
    expect(bodyRows()).toHaveLength(1);
    fireEvent.click(clearAll()!);

    expect(clearAll()).toBeNull();
    for (const label of ["Sector", "Territory", "Area", "Region"]) {
      expect(filterButton(label).textContent).toContain("All");
    }
    // Back to sector positions only.
    expect(bodyRows()).toHaveLength(1);
    expect(window.location.search).toBe("?view=table");
  });

  it("lists in-scope orgs with nobody listed in a placeholder style", async () => {
    await renderLoaded();
    fireEvent.click(
      within(openFilter("Territory")).getByLabelText("North Carolina"),
    );
    // North Carolina and Western NC have no positions; Boone has one.
    expect(
      screen.getByText("1 position or role · 2 orgs with no positions filled"),
    ).toBeTruthy();
    const rows = bodyRows();
    expect(rows.map((r) => r.hasAttribute("data-empty-org"))).toEqual([
      true,
      true,
      false,
    ]);
    const [ncRow] = rows;
    expect(within(ncRow!).getAllByRole("cell")[0]!.textContent).toBe(
      "North Carolina (Territory)",
    );
    expect(within(ncRow!).getByRole("rowheader").textContent).toBe(
      "NO PAX LISTED",
    );
    expect(ncRow!.textContent).toContain("NO POSITIONS FILLED");

    // Sorting by PAX keeps them after the filled rows.
    fireEvent.click(
      within(screen.getByRole("columnheader", { name: /PAX/ })).getByRole(
        "button",
      ),
    );
    expect(bodyRows().map((r) => r.hasAttribute("data-empty-org"))).toEqual([
      false,
      true,
      true,
    ]);

    // They are included in the CSV.
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    const [csv] = vi.mocked(downloadCsv).mock.calls[0]!;
    expect(csv).toContain(
      "Western NC,Area,NO PAX LISTED,,NO POSITIONS FILLED,",
    );
  });

  it("shows orgs as an accordion on portrait phones", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      media: query,
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    try {
      vi.mocked(fetchLeadership).mockResolvedValue({
        orgs: ORGS,
        leaders: LEADERS,
      });
      render(<OrgTable initialOrgIds={[3]} />);
      const list = await screen.findByRole("list", {
        name: "Positions and roles by org",
      });
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.queryByRole("button", { name: "Download CSV" })).toBeNull();
      const headers = () =>
        within(list)
          .getAllByRole("button")
          .map((b) => `${b.textContent} ${b.getAttribute("aria-expanded")}`);
      // North Carolina and Western NC are empty: Boone, the first org with
      // anyone listed, starts open.
      expect(headers()).toEqual([
        "▶North Carolina (Territory) false",
        "▶Western NC (Area) false",
        "▼Boone (Region) true",
      ]);
      expect(within(list).getByText("Switchback")).toBeTruthy();
      expect(within(list).getByText("Nant'an")).toBeTruthy();

      // Toggle: open an empty org, close Boone.
      fireEvent.click(within(list).getByRole("button", { name: /Western NC/ }));
      fireEvent.click(within(list).getByRole("button", { name: /Boone/ }));
      expect(headers()).toEqual([
        "▶North Carolina (Territory) false",
        "▼Western NC (Area) true",
        "▶Boone (Region) false",
      ]);
      expect(within(list).getByText("NO PAX LISTED")).toBeTruthy();
      expect(within(list).queryByText("Switchback")).toBeNull();

      // Changing the filters resets the sections: Florida's tree, with Coral
      // Gables the first org with anyone listed, opens on Coral Gables only.
      const dialog = openFilter("Territory");
      fireEvent.click(within(dialog).getByLabelText("Florida"));
      fireEvent.click(within(dialog).getByLabelText("North Carolina"));
      fireEvent.keyDown(document, { key: "Escape" });
      const after = screen.getByRole("list", {
        name: "Positions and roles by org",
      });
      expect(
        within(after)
          .getAllByRole("button")
          .map((b) => `${b.textContent} ${b.getAttribute("aria-expanded")}`),
      ).toEqual([
        "▶Florida (Territory) false",
        "▶Miami (Area) false",
        "▼Coral Gables (Region) true",
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows an empty message when nothing matches", async () => {
    vi.mocked(fetchLeadership).mockResolvedValue({ orgs: [], leaders: [] });
    render(<OrgTable />);
    expect(
      await screen.findByText("No positions or roles match these filters."),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Download CSV" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("sets the filters from a search pick", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Coral" },
    });
    fireEvent.click(
      within(screen.getByRole("listbox")).getByRole("option", {
        name: /Coral Gables/,
      }),
    );
    expect(filterButton("Territory").textContent).toContain("Florida");
    expect(bodyRows()).toHaveLength(1);
  });

  it("reports a load failure", async () => {
    vi.mocked(fetchLeadership).mockRejectedValue(new Error("API 500"));
    render(<OrgTable />);
    await waitFor(() =>
      expect(screen.getByText("Failed to load: API 500")).toBeTruthy(),
    );
  });
});
