// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Org } from "./types";
import type { LeaderRow } from "./leadership-table";
import {
  downloadCsv,
  leadershipCsv,
  leadershipCsvFilename,
} from "./leadership-csv";

const boone: Org = {
  id: 7,
  name: "Boone, NC",
  orgType: "region",
  parentId: 5,
};

function row(overrides: Partial<LeaderRow>): LeaderRow {
  return {
    key: "k",
    org: boone,
    orgId: boone.id,
    kind: "position",
    id: 1,
    title: "Nant'an",
    userId: 1,
    f3Name: "Switchback",
    avatarUrl: null,
    homeRegionName: "Boone",
    ...overrides,
  };
}

describe("leadershipCsv", () => {
  it("writes a header and one line per row in the given order", () => {
    const csv = leadershipCsv([
      row({}),
      row({ kind: "role", title: "admin", f3Name: null, homeRegionName: null }),
    ]);
    expect(csv.split("\r\n")).toEqual([
      "Org,Level,PAX,Home Region,Position/Role,Type",
      '"Boone, NC",Region,Switchback,Boone,Nant\'an,Position',
      '"Boone, NC",Region,Unknown,,admin,Role',
      "",
    ]);
  });

  it("quotes quotes and line breaks and neutralizes formulas", () => {
    const csv = leadershipCsv([
      row({
        f3Name: 'The "Q"',
        title: "=HYPERLINK(1)",
        homeRegionName: "a\nb",
      }),
    ]);
    expect(csv.split("\r\n")[1]).toBe(
      '"Boone, NC",Region,"The ""Q""","a\nb",\'=HYPERLINK(1),Position',
    );
  });

  it("writes placeholders for an org with nobody listed", () => {
    const csv = leadershipCsv([{ key: "e", org: boone, empty: true }]);
    expect(csv.split("\r\n")[1]).toBe(
      '"Boone, NC",Region,NO PAX LISTED,,NO POSITIONS FILLED,',
    );
  });

  it("returns only the header for no rows", () => {
    expect(leadershipCsv([])).toBe(
      "Org,Level,PAX,Home Region,Position/Role,Type\r\n",
    );
  });
});

describe("leadershipCsvFilename", () => {
  it("names the file with the local date", () => {
    expect(leadershipCsvFilename(new Date(2026, 10, 9, 23, 30))).toBe(
      "f3-positions-and-roles-2026-11-09.csv",
    );
  });
});

describe("downloadCsv", () => {
  afterEach(() => vi.restoreAllMocks());

  it("saves the CSV with a UTF-8 BOM through a temporary link", async () => {
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => {
      blob = b;
      return "blob:csv";
    });
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("out.csv");
        expect(this.href).toBe("blob:csv");
        expect(this.isConnected).toBe(true);
      });

    downloadCsv("a,b\r\n", "out.csv");

    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:csv");
    expect(blob?.type).toBe("text/csv;charset=utf-8");
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe("a,b\r\n");
  });
});
