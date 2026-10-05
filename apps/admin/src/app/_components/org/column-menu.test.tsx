import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MDTable } from "@acme/ui/md-table";

afterEach(cleanup);

describe("shared table Columns menu", () => {
  it("shows display names while preserving IDs and fallback labels", () => {
    render(
      <MDTable
        data={[]}
        columns={[
          { id: "territoryName", meta: { name: "Territory" } },
          { id: "sectorName", meta: { name: "Sector" } },
          { id: "aoCount", meta: { name: "AO Count" } },
          { id: "lastAnnualReview", meta: { name: "Last Annual Review" } },
          { id: "parentOrgName", meta: { name: "Region" } },
          { id: "fallback" },
        ]}
      />,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Columns" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    for (const name of [
      "Territory",
      "Sector",
      "AO Count",
      "Last Annual Review",
      "Region",
      "fallback",
    ]) {
      expect(screen.getByRole("menuitemcheckbox", { name })).toBeDefined();
    }
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "territoryName" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Territory" }),
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Columns" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Territory" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });
});
