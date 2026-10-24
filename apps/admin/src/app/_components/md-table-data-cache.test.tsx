import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MDTable } from "@acme/ui/md-table";

afterEach(cleanup);

const columns = [{ accessorKey: "name" }];

describe("MDTable data caching", () => {
  it("shows the loading skeleton (no rows) until data first arrives", () => {
    const { container } = render(
      <MDTable data={undefined} columns={columns} />,
    );

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("No results.")).toBeNull();
  });

  it("keeps the previous rows while data reloads, then shows the new rows", () => {
    const first = [{ name: "alpha" }, { name: "bravo" }];
    const { rerender, container } = render(
      <MDTable data={first} columns={columns} totalCount={2} />,
    );
    expect(screen.getByText("alpha")).toBeDefined();
    expect(screen.getByText("of 2 rows", { exact: false })).toBeDefined();

    // data -> undefined (refetching): previous rows and count stay on screen
    rerender(<MDTable data={undefined} columns={columns} />);
    expect(screen.getByText("alpha")).toBeDefined();
    expect(screen.getByText("bravo")).toBeDefined();
    expect(screen.getByText("of 2 rows", { exact: false })).toBeDefined();
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    // fresh data replaces the cached rows and clears the reloading overlay
    rerender(
      <MDTable data={[{ name: "charlie" }]} columns={columns} totalCount={1} />,
    );
    expect(screen.queryByText("alpha")).toBeNull();
    expect(screen.getByText("charlie")).toBeDefined();
    expect(screen.getByText("of 1 rows", { exact: false })).toBeDefined();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("shows the empty state for an empty array", () => {
    render(<MDTable data={[]} columns={columns} emptyMessage="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeDefined();
  });
});
