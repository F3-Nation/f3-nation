"use client";

import type {
  PaginationState,
  Row,
  SortingState,
  TableOptions,
  Updater,
  VisibilityState,
} from "@tanstack/react-table";
import type { Table as TableType } from "@tanstack/table-core";
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronDownIcon, Loader2 } from "lucide-react";

import type { PartialBy } from "@acme/shared/common/types";
import { safeParseInt } from "@acme/shared/common/functions";

import { cn } from ".";
import { Button } from "./button";
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

export interface PaginationOptions {
  pageSize?: number;
  pageSizeOptions?: number[];
}

export interface MDTableProps<T> {
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
  tableName?: string;
  rowsName?: string;
  downloadCSV?: (params: { table: TableType<T>; name: string }) => void;
  // https://fettblog.eu/typescript-react-generic-forward-refs/
  tableRef?: React.Ref<TableType<T>> | null;
  filterComponent?: React.ReactNode;
  containerClassName?: string;
  cellClassName?: string;
  paginationOptions?: PaginationOptions;
  pagination?: PaginationState;
  setPagination?: (val: Updater<PaginationState>) => void;
  defaultSortingState?: SortingState;
  rowClassName?: (row: Row<T>) => string | undefined;
  searchTerm?: string;
  setSearchTerm?: (searchTerm: string) => void;
  totalCount?: number;
  sorting?: SortingState;
  setSorting?: (updaterOrValue: Updater<SortingState>) => void;
  emptyMessage?: string;
}

export const MDTable = <T,>(params: MDTableProps<T>) => {
  const {
    paginationOptions,
    pagination: paginationParam,
    setPagination: setPaginationParam,
    searchTerm: searchTermParam,
    setSearchTerm: setSearchTermParam,
    onRowClick,
    tableRef,
    filterComponent,
    containerClassName,
    cellClassName,
    data,
    columns,
    tableName = "table",
    rowsName = "rows",
    downloadCSV,
    defaultSortingState,
    rowClassName,
    totalCount: totalCountParam,
    sorting: sortingParam,
    setSorting: setSortingParam,
    emptyMessage,
  } = params;
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

  // We can't have an undefined pagination state, (or app breaks) so we default to 0 pageIndex and 10 pageSize
  const { pagination: _pagination, setPagination: _setPagination } =
    usePagination(paginationOptions);

  const pagination = useMemo(
    () => paginationParam ?? _pagination,
    [paginationParam, _pagination],
  );

  const setPagination = useCallback(
    (val: Updater<PaginationState>) => {
      _setPagination?.(val);
      setPaginationParam?.(val);
    },
    [_setPagination, setPaginationParam],
  );

  const [_searchTerm, _setSearchTerm] = React.useState("");

  const [_sorting, _setSorting] = React.useState<SortingState>(
    defaultSortingState ?? [],
  );

  const sorting = useMemo(
    () => sortingParam ?? _sorting,
    [sortingParam, _sorting],
  );
  const setSorting = useCallback(
    (updaterOrValue: Updater<SortingState>) => {
      _setSorting(updaterOrValue);
      setSortingParam?.(updaterOrValue);
    },
    [_setSorting, setSortingParam],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({});

  const table = useReactTable<T>({
    data: cachedData.current ?? [],
    columns,
    manualPagination: !!setPaginationParam,
    manualSorting: !!setSortingParam,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    getPaginationRowModel: getPaginationRowModel(),
    onPaginationChange: setPagination,
    ...(cachedCount.current !== undefined && {
      rowCount: cachedCount.current,
    }),
    state: {
      // pagination cannot be undefined
      pagination,
      sorting,
      columnVisibility,
      globalFilter: searchTermParam ? undefined : _searchTerm,
    },
  });

  useImperativeHandle(tableRef, () => table);

  const pageCount = table.getRowCount()
    ? Math.ceil(table.getRowCount() / pagination.pageSize)
    : 1;

  useEffect(() => {
    table.resetPageIndex();
  }, [searchTermParam, table]);

  return (
    <div className={cn("relative", containerClassName)}>
      <div className="mt-4 flex flex-row items-center justify-between py-4">
        <div className="flex flex-1 items-center gap-4 pl-[1px]">
          <Input
            placeholder={`Search ${rowsName}...`}
            value={searchTermParam ?? _searchTerm}
            onChange={(event) => {
              setSearchTermParam?.(event.target.value);
              _setSearchTerm(event.target.value);
            }}
            className="max-w-60"
          />
          <div>
            {pagination ? (
              table.getRowCount() === 0 ? (
                <>Showing 0 {rowsName}</>
              ) : (
                <>
                  Showing {pagination.pageIndex * pagination.pageSize + 1}-
                  {Math.min(
                    (pagination.pageIndex + 1) * pagination.pageSize,
                    table.getRowCount(),
                  )}{" "}
                  of {table.getRowCount().toLocaleString()} {rowsName}
                </>
              )
            ) : (
              <>
                Showing {table.getRowModel().rows?.length ?? 0} of{" "}
                {table.getRowCount().toLocaleString()} {rowsName}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {downloadCSV ? (
            <button
              className="text-blue-600 underline"
              onClick={() => downloadCSV?.({ table, name: tableName })}
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
      </div>
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
              Array.from(Array(pagination.pageSize)).map((_, index) => (
                <TableRow
                  key={index}
                  className={cn(`hover:bg-muted`, {
                    "bg-muted/20": index % 2 === 0,
                  })}
                >
                  {table.getAllColumns().map((column) => (
                    <TableCell key={column.id} className="p-2">
                      <Skeleton className="h-4" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row, index) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    `hover:bg-muted`,
                    { "hover:cursor-pointer": !!onRowClick },
                    { "bg-muted/20": index % 2 === 0 },
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
                  className="h-24 text-left"
                >
                  {emptyMessage ?? "No results."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {pagination ? (
          <div className="flex items-center justify-between px-5 py-5">
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
                value={pagination.pageSize.toString()}
                onValueChange={(value) => {
                  const pageSize = safeParseInt(value);
                  if (pageSize !== undefined) {
                    table.setPageSize(pageSize);
                  }
                }}
              >
                <SelectTrigger className="mr-2 rounded-md bg-transparent px-1 focus:ring-0">
                  <SelectValue>
                    <strong>{pagination.pageSize}</strong>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="z-10" position="popper">
                  {(paginationOptions?.pageSizeOptions ?? [10, 20, 50])?.map(
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
        ) : null}
        {isReloading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-24 w-32 items-center justify-center rounded-lg bg-card">
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
