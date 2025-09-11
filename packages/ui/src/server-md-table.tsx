"use client";

import type {
  PaginationState,
  Row,
  RowSelectionState,
  SortingState,
  TableOptions,
  Updater,
  VisibilityState,
} from "@tanstack/react-table";
import type { Table as TableType } from "@tanstack/table-core";
import React, { useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronDownIcon, Loader2, RefreshCcw } from "lucide-react";

import type { PartialBy } from "@acme/shared/common/types";
import { ZustandStore } from "@acme/shared/common/classes";
import { safeParseInt } from "@acme/shared/common/functions";

import { cn } from ".";
import { Button } from "./button";
import { IndeterminateCheckbox } from "./checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Input } from "./input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import { Skeleton } from "./skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

export const TableName = ["default", "posts", "users"] as const;

export type TableName = (typeof TableName)[number];
export const TableConfig: Record<
  TableName,
  {
    persist: boolean;
  }
> = {
  default: { persist: false },
  posts: { persist: true },
  users: { persist: true },
};

export interface PaginationOptions {
  pageSize?: number;
  pageSizeOptions?: number[];
}

export interface TableState {
  columnVisibility: Record<string, boolean>;
  sorting: SortingState;
  pagination: PaginationState;
  searchTerm: string;
  rowSelection: RowSelectionState;
  hasInitialized: boolean;
}

const getInitialTableState = () => {
  const tableStates = Object.values(TableName).reduce(
    (acc, v) => {
      acc[v] = {
        columnVisibility: {},
        sorting: [],
        pagination: { pageIndex: 0, pageSize: 10 }, // This can't be undefined
        searchTerm: "",
        rowSelection: {},
        hasInitialized: false,
      };
      return acc;
    },
    {} as Record<TableName, TableState>,
  );
  return {
    ...tableStates,
    hasHydrated: false,
  };
};

const tableStore = new ZustandStore<
  Record<TableName, TableState> & { hasHydrated: boolean }
>({
  initialState: getInitialTableState(),
  persistOptions: {
    name: `md-table`,
    version: 2,
    getStorage: () => localStorage,
    persistedKeys: TableName.filter((v) => TableConfig[v].persist), // leave off hasHydrated
    onRehydrateStorage: (state) => {
      if (state) {
        state.hasHydrated = true;
      }
      console.log("onRehydrateStorage md-table", state);
    },
  },
});

export const getTableState = (tableName: TableName) => {
  return tableStore.get(tableName);
};
export const setTableState = (
  tableName: TableName,
  key: keyof TableState,
  state: Partial<TableState>,
) => {
  const tableState = getTableState(tableName);
  tableStore.setState({ [tableName]: { ...tableState, [key]: state } });
};

export const useTableState = (tableName: TableName) => {
  return tableStore.useBoundStore((state) => state[tableName]);
};

const setTableStoreValue = <T extends keyof TableState>(
  tableName: TableName,
  key: T,
  value: TableState[T],
) => {
  const tableState = getTableState(tableName);
  tableStore.setState({ [tableName]: { ...tableState, [key]: value } });
};

export interface MDTableProps<T extends { id: string | number }> {
  onRowClick?: (row: Row<T>) => void;
  rowHref?: (row: Row<T>) => string;
  /**
   * The data to display in the table.
   * If the data is undefined, we show a loading state.
   * If the data is an empty array, we show a no results state.
   * If the data is an array, we show the data in the table.
   *
   */
  data: TableOptions<T>["data"] | undefined;
  columns: TableOptions<T>["columns"];
  tableOptions?: Partial<TableOptions<T>>;
  tableName: TableName | null;
  rowsName?: string;
  downloadCSV?: (params: { table: TableType<T>; name: string }) => void;
  // https://fettblog.eu/typescript-react-generic-forward-refs/
  tableRef?: React.Ref<TableType<T>> | null;
  filterComponent?: React.ReactNode;
  cellClassName?: string;
  paginationOptions?: PaginationOptions;
  serverSidePagination: boolean;
  defaultSortingState?: SortingState;
  defaultColumnVisibility?: VisibilityState;
  rowClassName?: (row: Row<T>) => string | undefined;
  totalCount?: number;
  hideTopRow?: boolean;
  enableRowSelection?: boolean;
}

export const MDTable = <T extends { id: string | number }>(
  params: MDTableProps<T>,
) => {
  const {
    paginationOptions,
    serverSidePagination,
    onRowClick,
    tableRef,
    filterComponent,
    cellClassName,
    data,
    columns,
    tableName: _tableName,
    rowsName = "rows",
    downloadCSV,
    defaultSortingState,
    defaultColumnVisibility,
    rowClassName,
    totalCount: totalCountParam,
    hideTopRow,
    enableRowSelection,
    // rowSelection,
    // onRowSelectionChange,
  } = params;
  const tableName = _tableName ?? "default";
  const hasHydrated = tableStore.use.hasHydrated();

  const tableState = tableStore.useBoundStore((state) => state[tableName]);

  if (hasHydrated && tableState.hasInitialized === false) {
    tableStore.setState({
      [tableName]: {
        ...tableState,
        columnVisibility:
          defaultColumnVisibility ?? tableState.columnVisibility,
        sorting: defaultSortingState ?? tableState.sorting,
        hasInitialized: true,
      },
    });
  }

  const setValue =
    <T extends keyof TableState>(key: T) =>
    (updaterOrValue: Updater<TableState[T]>) => {
      const value =
        typeof updaterOrValue === "function"
          ? updaterOrValue(tableState[key])
          : updaterOrValue;
      setTableStoreValue(tableName, key, value);
    };

  // Data state management: if data is undefined, we show a loading state
  const cachedData = useRef(data);
  if (data !== undefined) {
    cachedData.current = data;
  }
  const isReloading = data === undefined && cachedData.current !== undefined;
  const isInitialLoading = cachedData.current === undefined; // If the data is undefined, we show a loading state (skeleton)

  const cachedCount = useRef<number | undefined>(undefined);
  if (totalCountParam !== undefined) {
    cachedCount.current = totalCountParam;
  }

  const table = useReactTable<T>({
    data: cachedData.current ?? [],
    columns,
    ...(serverSidePagination
      ? { manualPagination: true, manualSorting: true }
      : {}),
    ...(enableRowSelection ? { enableRowSelection: true } : {}),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setValue("columnVisibility"),
    getPaginationRowModel: getPaginationRowModel(),
    onPaginationChange: setValue("pagination"),
    onSortingChange: setValue("sorting"),
    ...(cachedCount.current !== undefined && {
      rowCount: cachedCount.current,
    }),
    onRowSelectionChange: setValue("rowSelection"),
    state: {
      pagination: tableState.pagination,
      sorting: tableState.sorting,
      columnVisibility: tableState.columnVisibility,
      globalFilter: tableState.searchTerm,
      ...(enableRowSelection ? { rowSelection: tableState.rowSelection } : {}),
    },
  });
  table.setOptions((prev) => ({
    ...prev,
    getRowId: (row) => row.id.toString(),
    autoResetSelectedRows: false,
  }));

  useImperativeHandle(tableRef, () => table);

  const pageCount = table.getRowCount()
    ? Math.ceil(table.getRowCount() / tableState.pagination.pageSize)
    : 0;

  return (
    <div className="relative">
      {!hideTopRow && (
        <div className="mt-4 flex flex-row items-center justify-between py-4">
          <div className="flex flex-1 items-center gap-4 pl-[1px]">
            <Input
              placeholder={`Search ${rowsName}...`}
              value={tableState.searchTerm}
              onChange={(event) => {
                setValue("searchTerm")(event.target.value);
                // When the search term changes we should reset the page index to 0
                setValue("pagination")({
                  pageIndex: 0,
                  pageSize: getTableState(tableName).pagination.pageSize,
                });
              }}
              className="max-w-60"
            />
            <div>
              Showing{" "}
              {tableState.pagination.pageIndex *
                tableState.pagination.pageSize +
                1}
              -
              {Math.min(
                (tableState.pagination.pageIndex + 1) *
                  tableState.pagination.pageSize,
                table.getRowCount(),
              )}{" "}
              of {table.getRowCount().toLocaleString()} {rowsName}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {downloadCSV ? (
              <button
                type="button"
                className="text-blue-600 underline"
                onClick={() => downloadCSV({ table, name: tableName })}
              >
                Download CSV
              </button>
            ) : null}
            {filterComponent ? filterComponent : null}
          </div>
          <div className="ml-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="ml-auto">
                  Columns <ChevronDownIcon className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {table
                  .getAllColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => {
                    return (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        className="capitalize"
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) =>
                          column.toggleVisibility(!!value)
                        }
                      >
                        {column.id}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <Button
            variant="outline"
            className="ml-2"
            onClick={() => {
              setValue("searchTerm")("");
              setValue("sorting")([]);
              setValue("pagination")({ pageIndex: 0, pageSize: 10 });
              setValue("rowSelection")({});
              setValue("columnVisibility")({});
            }}
          >
            <RefreshCcw className="size-4" />
          </Button>
        </div>
      )}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isInitialLoading ? (
              Array.from(Array(tableState.pagination.pageSize)).map(
                (_, index) => (
                  <TableRow
                    key={index}
                    className={cn(`hover:bg-muted-foreground/20`, {
                      "bg-muted-foreground/20": index % 2 === 0,
                    })}
                  >
                    {table.getAllColumns().map((column) => (
                      <TableCell key={column.id} className="p-2">
                        <Skeleton className="h-4" />
                      </TableCell>
                    ))}
                  </TableRow>
                ),
              )
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row, index) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    `hover:bg-muted-foreground/20`,
                    { "hover:cursor-pointer": !!onRowClick },
                    { "bg-muted": index % 2 === 0 },
                    rowClassName?.(row),
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cn(cellClassName)}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getAllColumns().length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between px-5 py-5">
          {enableRowSelection && (
            <div className="flex flex-col items-start gap-[2px]">
              <div className="flex flex-row items-center justify-between">
                <div className="p-1">
                  <IndeterminateCheckbox
                    {...{
                      checked: table.getIsAllPageRowsSelected(),
                      indeterminate: table.getIsSomePageRowsSelected(),
                      onChange: table.getToggleAllPageRowsSelectedHandler(),
                    }}
                  />
                </div>
                <div>Page Rows ({table.getRowModel().rows.length})</div>
              </div>
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                {Object.keys(tableState.rowSelection).length} of{" "}
                {table.getRowCount()} Total Rows Selected
              </div>
            </div>
          )}
          <div className="flex flex-row items-center gap-2">
            <Button
              variant="ghost"
              className="w-8 rounded border p-1"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              {"<<"}
            </Button>
            <Button
              variant="ghost"
              className="w-8 rounded border p-1"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              {"<"}
            </Button>
            <span className="flex items-center gap-1">
              <div>Page</div>
              <strong>
                {table.getState().pagination.pageIndex + 1} of {pageCount}
              </strong>
            </span>
            <Button
              variant="ghost"
              className="w-8 rounded border p-1"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              {">"}
            </Button>
            <Button
              variant="ghost"
              className="w-8 rounded border p-1"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              {">>"}
            </Button>
          </div>
          {/* ability to select the size of the page */}
          <div className="flex flex-row items-center gap-2">
            <div className="pointer-events-none flex-shrink-0">Page size</div>
            <Select
              value={tableState.pagination.pageSize.toString()}
              onValueChange={(value) => {
                const pageSize = safeParseInt(value);
                if (pageSize !== undefined) {
                  table.setPageSize(pageSize);
                }
              }}
            >
              <SelectTrigger className="mr-2 rounded-md bg-transparent px-1 focus:ring-0">
                <SelectValue>
                  <strong>{tableState.pagination.pageSize}</strong>
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="z-10" position="popper">
                {(paginationOptions?.pageSizeOptions ?? [10, 20, 50]).map(
                  (size) => (
                    <SelectItem
                      key={size}
                      className="flex cursor-pointer justify-center rounded-md px-4 py-1 text-lg font-semibold hover:bg-emerald-100"
                      value={size.toString()}
                    >
                      {size}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </div>
        {isReloading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-24 w-32 items-center justify-center rounded-lg bg-white/80">
              <Loader2 className="size-8 animate-spin" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export type MdTableOptions<T> = Pick<TableOptions<T>, "data" | "columns"> &
  Partial<TableOptions<T>> & {
    tableName: string;
    rowsName: string;
    downloadCSV?: (params: { table: TableType<T>; name: string }) => void;
  };

// Type helper
export const createTableOptions = <T,>(
  params: PartialBy<MdTableOptions<T>, "tableName" | "rowsName">,
): MdTableOptions<T> => {
  return {
    data: params.data,
    columns: params.columns,
    tableName: params.tableName ?? "table",
    rowsName: params.rowsName ?? "rows",
    downloadCSV: params.downloadCSV,
  };
};

export const usePagination = (params?: {
  pageSize?: number;
  pageSizeOptions?: number[];
}) => {
  const pageSizeOptions = params?.pageSizeOptions ?? [10, 20, 50, 100];
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: params?.pageSize ?? 10,
  });

  const pagination = useMemo(
    () => ({
      pageIndex,
      pageSize,
    }),
    [pageIndex, pageSize],
  );

  return { pagination, setPagination, pageSizeOptions };
};
