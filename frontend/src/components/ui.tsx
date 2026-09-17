import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button, Input } from "@fluentui/react-components";
import {
  ArrowDown,
  ArrowUp,
  ArrowsDownUp,
  CaretLeft,
  CaretRight,
  CheckCircle,
  FileDashed,
  Info,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import type { Insight } from "../domain/types";
import { DEPARTMENTS } from "../domain/types";
import { useWorkspace } from "../state/WorkspaceContext";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}
export function Panel({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}
export function MetricStrip({
  items,
}: {
  items: {
    label: string;
    value: ReactNode;
    hint?: ReactNode;
    tone?: "red" | "green" | "amber";
  }[];
}) {
  return (
    <div className="metric-strip">
      {items.map((item) => (
        <div className={`metric ${item.tone ?? ""}`} key={item.label}>
          <div className="metric-label">{item.label}</div>
          <div className="metric-value">{item.value}</div>
          {item.hint && <div className="metric-hint">{item.hint}</div>}
        </div>
      ))}
    </div>
  );
}
export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "success" | "warning" | "neutral" | "danger";
}) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <FileDashed size={36} weight="light" />
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function DataTable<T>({
  columns,
  data,
  emptyText = "暂无数据",
  caption,
}: {
  columns: ColumnDef<T, any>[];
  data: T[];
  emptyText?: string;
  caption?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });
  return (
    <>
      <div
        className="table-scroll"
        tabIndex={0}
        aria-label={caption ?? "数据表，可左右滚动"}
      >
        <table className="data-table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    aria-sort={
                      header.column.getIsSorted() === "asc"
                        ? "ascending"
                        : header.column.getIsSorted() === "desc"
                          ? "descending"
                          : undefined
                    }
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        className="sort-button"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {header.column.getIsSorted() === "asc" ? (
                          <ArrowUp size={12} />
                        ) : header.column.getIsSorted() === "desc" ? (
                          <ArrowDown size={12} />
                        ) : (
                          <ArrowsDownUp size={12} />
                        )}
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title={emptyText} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data.length > 10 && (
        <div className="table-pagination">
          <span>共 {data.length} 条</span>
          <div className="actions">
            <Button
              size="small"
              aria-label="上一页"
              icon={<CaretLeft />}
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            />
            <span>
              {table.getState().pagination.pageIndex + 1} /{" "}
              {table.getPageCount()}
            </span>
            <Button
              size="small"
              aria-label="下一页"
              icon={<CaretRight />}
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            />
          </div>
        </div>
      )}
    </>
  );
}
export function MoneyInput({
  value,
  onCommit,
  label,
  disabled,
}: {
  value: number;
  onCommit: (value: number) => boolean | void;
  label: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(String(value));
  }, [value]);
  function commit() {
    const next = Number(text);
    if (!text.trim() || !Number.isSafeInteger(next) || next < 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (next !== value && onCommit(next) === false) {
      setText(String(value));
      return;
    }
    setText(String(next));
  }
  return (
    <div className="money-field">
      <Input
        className="money-input"
        aria-label={label}
        aria-invalid={invalid}
        title={invalid ? "请输入非负整数金额" : label}
        inputMode="numeric"
        value={text}
        disabled={disabled}
        onChange={(_, data) => {
          setText(data.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setText(String(value));
            setInvalid(false);
          }
        }}
      />
      {invalid && <span className="input-error">请输入非负整数</span>}
    </div>
  );
}
export function DepartmentTabs() {
  const { department, setDepartment, state } = useWorkspace();
  return (
    <div className="department-tabs" role="group" aria-label="选择部门">
      {DEPARTMENTS.map((d) => (
        <button
          key={d}
          className={d === department ? "selected" : ""}
          aria-pressed={d === department}
          onClick={() => setDepartment(d)}
        >
          {d}
          <span>{state.budgets.filter((b) => b.department === d).length}</span>
        </button>
      ))}
    </div>
  );
}
export function InsightList({ items }: { items: Insight[] }) {
  return (
    <div className="insight-list">
      {items.length ? (
        items.map((item) => (
          <article className={`insight-item ${item.level}`} key={item.id}>
            <div className="insight-icon">
              {item.level === "risk" ? (
                <WarningCircle size={20} />
              ) : (
                <Info size={20} />
              )}
            </div>
            <div>
              <div className="insight-title">
                <h3>{item.title}</h3>
                <StatusBadge
                  tone={
                    item.level === "risk"
                      ? "danger"
                      : item.level === "watch"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {item.level === "risk"
                    ? "需处理"
                    : item.level === "watch"
                      ? "关注"
                      : "提示"}
                </StatusBadge>
              </div>
              <p>{item.text}</p>
              <small>
                {item.perspective} · {item.rule}
              </small>
            </div>
          </article>
        ))
      ) : (
        <div className="no-insight">
          <CheckCircle size={26} />
          <span>当前未触发规则提示</span>
        </div>
      )}
    </div>
  );
}
