"use client";

import * as React from "react";
import {
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
  type Table,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

export interface DataTableProps<T> {
  columns: ColumnDef<T, any>[];
  data: T[];

  /**
   * Server-side pagination: the parent owns page+pageSize and the row
   * count is fixed to `data.length === pageSize` (or the trailing
   * page). In this mode, the table's internal pagination is disabled
   * and we don't render the page-size selector.
   */
  manualPagination?: boolean;
  pageCount?: number;

  /** External sorting state (controlled). */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;

  /** External column-visibility state. */
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;

  /** When true, show a global filter input above the table. */
  enableGlobalFilter?: boolean;
  globalFilter?: string;
  onGlobalFilterChange?: OnChangeFn<string>;

  /** Render slot for a toolbar (e.g. column toggles, filters). */
  renderToolbar?: (table: Table<T>) => React.ReactNode;

  /** Override the loading state. */
  isLoading?: boolean;
  /** Override the empty state. */
  renderEmpty?: () => React.ReactNode;
  /** Override the error state. */
  isError?: boolean;
  renderError?: () => React.ReactNode;

  /** Optional click handler for a row. */
  onRowClick?: (row: T) => void;

  /** Page size for client-side pagination. Default 25. */
  pageSize?: number;
  pageSizeOptions?: number[];

  className?: string;
}

/**
 * Generic TanStack Table wrapper. Supports both client-side pagination
 * (over the full in-memory dataset — the default for this CRM) and
 * server-side pagination (when the parent owns page+pageSize).
 */
export function DataTable<T>({
  columns,
  data,
  manualPagination = false,
  pageCount,
  sorting: externalSorting,
  onSortingChange,
  columnVisibility: externalColumnVisibility,
  onColumnVisibilityChange,
  renderToolbar,
  isLoading,
  renderEmpty,
  isError,
  renderError,
  onRowClick,
  pageSize = 25,
  pageSizeOptions = [10, 25, 50, 100],
  className,
}: DataTableProps<T>) {
  const [internalSorting, setInternalSorting] = React.useState<SortingState>([]);
  const [internalColumnVisibility, setInternalColumnVisibility] =
    React.useState<VisibilityState>({});

  const sorting = externalSorting ?? internalSorting;
  const setSorting: OnChangeFn<SortingState> = onSortingChange ?? setInternalSorting;
  const columnVisibility = externalColumnVisibility ?? internalColumnVisibility;
  const setColumnVisibility: OnChangeFn<VisibilityState> =
    onColumnVisibilityChange ?? setInternalColumnVisibility;

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(manualPagination
      ? {
          manualPagination: true,
          pageCount: pageCount ?? -1,
        }
      : {
          getPaginationRowModel: getPaginationRowModel(),
          initialState: { pagination: { pageSize } },
        }),
  });

  return (
    <div className={cn("space-y-3", className)}>
      {renderToolbar?.(table)}

      <div className="rounded-md border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr
                  key={headerGroup.id}
                  className="border-b border-border bg-muted/30">
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sortDir = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        className="p-3 md:p-4 text-left font-medium text-muted-foreground select-none"
                        style={{ width: header.getSize?.() ?? undefined }}>
                        {header.isPlaceholder
                          ? null
                          : canSort ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 hover:text-foreground"
                              onClick={header.column.getToggleSortingHandler()}>
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                              {sortDir === "asc" && <span>▲</span>}
                              {sortDir === "desc" && <span>▼</span>}
                            </button>
                          ) : (
                            flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )
                          )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {isError
                ? (
                  <tr>
                    <td colSpan={columns.length} className="p-8 text-center">
                      {renderError?.() ?? (
                        <span className="text-destructive">
                          Failed to load data.
                        </span>
                      )}
                    </td>
                  </tr>
                )
                : isLoading
                ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="p-8 text-center text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )
                : table.getRowModel().rows.length === 0
                ? (
                  <tr>
                    <td colSpan={columns.length} className="p-8 text-center">
                      {renderEmpty?.() ?? (
                        <span className="text-muted-foreground">No records found.</span>
                      )}
                    </td>
                  </tr>
                )
                : table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    className={cn(
                      "border-b border-border last:border-0 transition-colors",
                      onRowClick && "cursor-pointer hover:bg-accent/50"
                    )}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="p-3 md:p-4 align-middle">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <DataTablePagination
        table={table}
        manualPagination={manualPagination}
        pageSizeOptions={pageSizeOptions}
      />
    </div>
  );
}

interface DataTablePaginationProps<T> {
  table: Table<T>;
  manualPagination: boolean;
  pageSizeOptions: number[];
}

function DataTablePagination<T>({
  table,
  manualPagination,
  pageSizeOptions,
}: DataTablePaginationProps<T>) {
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;
  const totalRows = manualPagination
    ? table.getFilteredRowModel().rows.length
    : table.getFilteredRowModel().rows.length;
  const pageCount = manualPagination
    ? table.getPageCount()
    : Math.max(1, Math.ceil(totalRows / pageSize));
  const first = pageIndex * pageSize + (totalRows > 0 ? 1 : 0);
  const last = Math.min(totalRows, (pageIndex + 1) * pageSize);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1">
      <p className="text-sm text-muted-foreground">
        {totalRows === 0
          ? "No rows"
          : `Showing ${first}–${last} of ${totalRows}`}
      </p>

      <div className="flex items-center gap-2">
        {!manualPagination && (
          <select
            value={pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm">
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt} / page
              </option>
            ))}
          </select>
        )}

        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => table.setPageIndex(0)}
          disabled={!table.getCanPreviousPage()}>
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">
          Page {pageIndex + 1} of {Math.max(1, pageCount)}
        </span>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => table.setPageIndex(pageCount - 1)}
          disabled={!table.getCanNextPage()}>
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
