"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { Button } from "./button";
import {
  cellSortValue,
  compareTableValues,
  tableElements,
  tableHeaderLayout,
  tableText,
  type SortValue,
} from "./table-sorting";
import "./table.css";
import { tableColumnAlignment } from "./table-alignment";

function Table({
  className,
  containerClassName,
  children,
  sortingMode = "auto",
  pageIndex = 0,
  pageSize,
  onSort,
  ...props
}: React.ComponentProps<"table"> & {
  containerClassName?: string;
  sortingMode?: "auto" | "manual";
  pageIndex?: number;
  pageSize?: number;
  onSort?: () => void;
}) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const sections = tableElements(children);
  const header = sections.find((section) => section.type === TableHeader);
  const body = sections.find((section) => section.type === TableBody);
  const headerRows = tableElements(header?.props.children);
  const layout = tableHeaderLayout(headerRows);
  const bodyRows = tableElements(body?.props.children);
  const isFixed = (row: (typeof bodyRows)[number]) =>
    row.props["data-sort-fixed"] ||
    tableElements(row.props.children).some(
      (cell) => Number(cell.props.colSpan || 1) > 1,
    );
  const data = bodyRows
    .filter((row) => !isFixed(row))
    .map((element) => ({
      element,
      cells: tableElements(element.props.children),
    }));
  const leaves = layout.flat().filter(({ leaf }) => leaf);
  const alignments = new Map(leaves.map(({ cell, column }) => [
    column, tableColumnAlignment(cell, data.map((row) => row.cells[column]).filter(Boolean)),
  ]));
  const columns = leaves.map(({ column }) => ({
    id: String(column),
    accessorFn: (row: (typeof data)[number]) =>
      cellSortValue(row.cells[column]),
    sortUndefined: "last" as const,
    sortingFn: (a: any, b: any, id: string) =>
      compareTableValues(a.getValue(id), b.getValue(id)),
  }));
  const model = useReactTable({
    data,
    columns,
    state: { sorting },
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: (next) => {
      setSorting(next);
      onSort?.();
    },
    enableSortingRemoval: true,
  });
  const rendered =
    sortingMode === "manual"
      ? children
      : sections.map((section) => {
          if (section === header)
            return React.cloneElement(
              section,
              {},
              headerRows.map((row, ri) =>
                React.cloneElement(
                  row,
                  {},
                  layout[ri].map(({ cell, column, leaf }) => {
                    const label = tableText(cell.props.children);
                    if (
                      !leaf ||
                      !label ||
                      cell.props.sortable === false ||
                      /^(操作|选择|拆分依据)$/.test(label)
                    )
                      return cell;
                    const sortColumn = model.getColumn(String(column))!;
                    const direction = sortColumn.getIsSorted();
                    return React.cloneElement(
                      cell,
                      {
                        scope: "col",
                        "aria-sort":
                          direction === "asc"
                            ? "ascending"
                            : direction === "desc"
                              ? "descending"
                              : "none",
                      },
                      <Button
                        type="button"
                        variant="ghost"
                        className="table-sort-button"
                        aria-label={`按${label}排序`}
                        onClick={sortColumn.getToggleSortingHandler()}
                      >
                        {cell.props.children}
                        <span aria-hidden="true">
                          {direction === "asc"
                            ? "↑"
                            : direction === "desc"
                              ? "↓"
                              : "↕"}
                        </span>
                      </Button>,
                    );
                  }),
                ),
              ),
            );
          if (section === body) {
            const sorted = model
              .getRowModel()
              .rows.map((row) => row.original.element);
            const visible =
              pageSize == null
                ? sorted
                : sorted.slice(
                    pageIndex * pageSize,
                    (pageIndex + 1) * pageSize,
                  );
            let index = 0;
            // Summary/empty/add-row controls stay in their original positions.
            const rows =
              pageSize == null
                ? bodyRows.map((row) => (isFixed(row) ? row : visible[index++]))
                : [...visible, ...bodyRows.filter(isFixed)];
            return React.cloneElement(section, {}, rows);
          }
          return section;
        });
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto", containerClassName)}
      data-table-scroll={
        containerClassName?.split(" ").includes("overflow-visible")
          ? "parent"
          : "self"
      }
      tabIndex={0}
      role="region"
      aria-label={props["aria-label"] || "数据表格，可滚动查看"}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      >
        {tableElements(rendered).map((section) => {
          if (![TableHeader, TableBody, TableFooter].includes(section.type as any)) return section;
          const rows = tableElements(section.props.children);
          const coordinates = tableHeaderLayout(rows);
          return React.cloneElement(section, {}, rows.map((row, index) =>
            React.cloneElement(row, {}, coordinates[index].map(({ cell, column }) =>
              React.cloneElement(cell, {
                "data-align": cell.props["data-align"] || (Number(cell.props.colSpan || 1) > 1
                  ? section.type === TableHeader ? "center" : "left"
                  : alignments.get(column) || "left"),
              }),
            )),
          ));
        })}
      </table>
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({
  className,
  sortable: _sortable,
  sortValue: _sortValue,
  ...props
}: React.ComponentProps<"th"> & { sortable?: boolean; sortValue?: SortValue }) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({
  className,
  sortValue: _sortValue,
  ...props
}: React.ComponentProps<"td"> & { sortValue?: SortValue }) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
