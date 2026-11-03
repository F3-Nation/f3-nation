import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MDTable } from "@acme/ui/server-md-table";

afterEach(cleanup);

const columns = [{ accessorKey: "name" }];

describe("server MDTable data caching", () => {
  it("shows the loading skeleton (no rows) until data first arrives", () => {
    const { container } = render(
      <MDTable
        data={undefined}
        columns={columns}
        tableName="default"
        serverSidePagination
      />,
    );

    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByText("No results.")).toBeNull();
  });

  it("keeps the previous rows and count while data reloads, then shows the new rows", () => {
    const first = [
      { id: 1, name: "alpha" },
      { id: 2, name: "bravo" },
    ];
    const { rerender, container } = render(
      <MDTable
        data={first}
        columns={columns}
        tableName="default"
        serverSidePagination
        totalCount={2}
      />,
    );
    expect(screen.getByText("alpha")).toBeDefined();
    expect(screen.getByText("of 2 rows", { exact: false })).toBeDefined();
    expect(container.querySelector(".animate-spin")).toBeNull();

    // data -> undefined (refetching): previous rows and count stay on screen
    rerender(
      <MDTable
        data={undefined}
        columns={columns}
        tableName="default"
        serverSidePagination
      />,
    );
    expect(screen.getByText("alpha")).toBeDefined();
    expect(screen.getByText("bravo")).toBeDefined();
    expect(screen.getByText("of 2 rows", { exact: false })).toBeDefined();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(container.querySelector(".animate-pulse")).toBeNull();

    // fresh data replaces the cached rows and clears the reloading overlay
    rerender(
      <MDTable
        data={[{ id: 3, name: "charlie" }]}
        columns={columns}
        tableName="default"
        serverSidePagination
        totalCount={1}
      />,
    );
    expect(screen.queryByText("alpha")).toBeNull();
    expect(screen.getByText("charlie")).toBeDefined();
    expect(screen.getByText("of 1 rows", { exact: false })).toBeDefined();
    expect(container.querySelector(".animate-spin")).toBeNull();

    // the next reload falls back to the latest rows and count, not the first
    rerender(
      <MDTable
        data={undefined}
        columns={columns}
        tableName="default"
        serverSidePagination
      />,
    );
    expect(screen.queryByText("alpha")).toBeNull();
    expect(screen.getByText("charlie")).toBeDefined();
    expect(screen.getByText("of 1 rows", { exact: false })).toBeDefined();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("shows the empty state for an empty array", () => {
    render(
      <MDTable
        data={[]}
        columns={columns}
        tableName="default"
        serverSidePagination
      />,
    );
    expect(screen.getByText("No results.")).toBeDefined();
  });
});
