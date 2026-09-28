import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MDTable, usePagination } from "@acme/ui/md-table";

afterEach(cleanup);

function ServerPaginatedTable() {
  const { pagination, setPagination } = usePagination();
  const rows = Array.from({ length: pagination.pageSize }, (_, i) => ({
    name: `row ${pagination.pageIndex * pagination.pageSize + i + 1}`,
  }));
  return (
    <MDTable
      data={rows}
      columns={[{ accessorKey: "name" }]}
      totalCount={25}
      pagination={pagination}
      setPagination={setPagination}
    />
  );
}

it("keeps the requested page across re-renders of server-paginated data", () => {
  render(<ServerPaginatedTable />);
  expect(screen.getByText("1 of 3")).toBeDefined();

  fireEvent.click(screen.getByRole("button", { name: ">" }));

  expect(screen.getByText("2 of 3")).toBeDefined();
  expect(screen.getByText("row 11")).toBeDefined();
});
