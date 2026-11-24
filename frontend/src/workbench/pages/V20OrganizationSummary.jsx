import { compactColumnLabel } from "../domain/allocation-detail";
import { wholeMetric } from "../domain/metric-precision";
import { useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
} from "@tanstack/react-table";
import { Button } from "../../components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
} from "../../components/ui/table";
import "../v20-organization-summary.css";

const value = (n, scale = 1) =>
  n == null
    ? "—"
    : (n / scale).toLocaleString("zh-CN", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
const percent = (n) => (n == null ? "—" : `${value(n)}%`);
const difference = (n) =>
  n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${value(Math.abs(n))} pp`;

export function HistoricalShareChart({ vol, c3, scale, investment }) {
  const series = [
    ["vol", "Vol", vol],
    ["c3", "C3", c3],
  ];
  if (investment !== undefined) series.unshift(["investment", "投资", investment]);
  return (
    <div
      className="v20-history-bars"
      role="img"
      aria-label={series
        .map(([key, label, share]) => `${key === "vol" ? "Delivery Vol" : label} ${percent(share)}`)
        .join("；")}
    >
      {series.map(([key, label, share]) => (
        <div
          className="v20-history-line"
          key={key}
          data-series={key}
          data-value={share ?? ""}
          title={`${label} ${percent(share)}`}
        >
          <span>{label}</span>
          <div>
            <i
              style={{
                width: `${share == null ? 0 : Math.max(0, Math.min(100, (share / scale) * 100))}%`,
              }}
            />
          </div>
          <span className="v20-share-value">{value(share)}</span>
        </div>
      ))}
    </div>
  );
}

export function V20OrganizationSummary({
  groups,
  totals,
  countScope = "all",
  groupBy,
  period,
  ytdCutoffMonth = 10,
  threshold,
  redThreshold,
  rowId,
  highlight,
  onOpen,
}) {
  const isSelectedScope = countScope === "selected";
  const planningAmount = (amount) => wholeMetric(amount);
  const formatCount = (group) =>
    `${wholeMetric(group.allocatedCount)} / ${wholeMetric(isSelectedScope ? group.selectedCount : group.totalCount)}`;
  const [sorting, setSorting] = useState([]);
  const columns = useMemo(
    () => [
      { id: "key", accessorFn: (g) => g.key },
      { id: "count", accessorFn: (g) => g.allocatedCount },
      { id: "amount", accessorFn: (g) => g.amount },
      { id: "average", accessorFn: (g) => g.average ?? undefined },
      { id: "investment-share", accessorFn: (g) => g.amountShare ?? undefined },
      { id: "vol-share", accessorFn: (g) => g.volShare ?? undefined },
      { id: "c3-share", accessorFn: (g) => g.c3Share ?? undefined },
      {
        id: "vs-vol",
        accessorFn: (g) =>
          g.amountShare != null && g.volShare != null
            ? g.amountShare - g.volShare
            : undefined,
      },
      {
        id: "vs-c3",
        accessorFn: (g) =>
          g.amountShare != null && g.c3Share != null
            ? g.amountShare - g.c3Share
            : undefined,
      },
      { id: "history-chart", accessorFn: (g) => g.amountShare ?? undefined },
    ],
    [],
  );
  const table = useReactTable({
    data: groups,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    defaultColumn: { sortUndefined: "last" },
  });
  const head = (field, title, className = "", rowSpan, note) => {
    const column = table.getColumn(field),
      direction = column.getIsSorted();
    return (
      <TableHead
        key={field}
        className={className}
        rowSpan={rowSpan}
        aria-sort={
          direction === "asc"
            ? "ascending"
            : direction === "desc"
              ? "descending"
              : "none"
        }
      >
        <Button
          variant="ghost"
          className="v20-sort-heading"
          aria-label={`按${title}排序`}
          onClick={column.getToggleSortingHandler()}
        >
          <span className="compact-column-label">{compactColumnLabel(title)}</span>
          <span aria-hidden="true">
            {direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}
          </span>
        </Button>
        {note && <small>{note}</small>}
      </TableHead>
    );
  };
  // All rows and series share a scale that includes current investment shares.
  const scale = Math.min(
    100,
    Math.max(
      10,
      Math.ceil(
        Math.max(
          0,
          ...groups.flatMap((g) => [g.amountShare || 0, g.volShare || 0, g.c3Share || 0]),
        ) / 10,
      ) * 10,
    ),
  );
  const investmentShares = isSelectedScope
    ? groups.filter((g) => g.selectedCount > 0 && g.amountShare != null).map((g) => g.amountShare)
    : [];
  const investmentRange = investmentShares.length
    ? Math.max(...investmentShares) - Math.min(...investmentShares)
    : null;
  const level = (gap) =>
    gap == null
      ? "none"
      : Math.abs(gap) > redThreshold
        ? "bad"
        : Math.abs(gap) > threshold
          ? "warn"
          : "good";
  const cell = (field, text, className = "") => (
    <TableCell className={`num ${className}`} data-column={field}>
      {text}
    </TableCell>
  );
  return (
    <>
      <div
        className="table-scroll v20-org-scroll"
        role="region"
        aria-label={`${groupBy.toUpperCase()}投资与历史产出对照`}
        tabIndex={0}
      >
        <Table sortingMode="manual"
          containerClassName="overflow-visible"
          className="v20-organization-summary"
          data-count-scope={countScope}
        >
          <TableHeader>
            <TableRow>
              {head("key", groupBy.toUpperCase(), "", 2)}
              <TableHead colSpan={4} scope="colgroup">本次投资</TableHead>
              <TableHead colSpan={3} scope="colgroup" className="v20-actual">
                历史 Actual · {period === "2025" ? "2025 全年" : "2026 YTD"}
              </TableHead>
              <TableHead colSpan={2} scope="colgroup">投资金额占比</TableHead>
            </TableRow>
            <TableRow>
              {[
                ["count", isSelectedScope ? "已分配 / 总名单" : "分配 / 全部"],
                ["amount", "投资金额（元）"],
                ["average", "客均（元） · 偏离均值（%）"],
                ["investment-share", "投资金额占比（%）"],
              ].map(([field, title]) => head(field, title, "num"))}
              {head("vol-share", "Delivery Vol 占比（%）", "num v20-actual")}
              {head("c3-share", "C3 占比（%）", "num v20-actual")}
              {head("history-chart", "占比对照图（%）", "v20-actual", undefined, `刻度 0–${scale}%`)}
              {head("vs-vol", "vs Delivery Vol（pp）", "num")}
              {head("vs-c3", "vs C3（pp）", "num")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map(({ original: g }) => {
              const gapVol =
                g.amountShare != null && g.volShare != null
                  ? g.amountShare - g.volShare
                  : null;
              const gapC3 =
                g.amountShare != null && g.c3Share != null
                  ? g.amountShare - g.c3Share
                  : null;
              const averageDeviation =
                g.average != null && totals.average > 0
                  ? (g.average / totals.average - 1) * 100
                  : null;
              return (
                <TableRow
                  key={g.key}
                  id={rowId(g.key)}
                  tabIndex={-1}
                  data-organization={g.key}
                  className={
                    highlight === `summary-${g.key}` ? "v19-highlight" : ""
                  }
                >
                  <TableHead>
                    <Button variant="link" onClick={() => onOpen(g.key)}>
                      {g.key}
                    </Button>
                  </TableHead>
                  {cell("count", formatCount(g))}
                  {cell("amount", <b>{planningAmount(g.amount)}</b>)}
                  {cell(
                    "average",
                    <>
                      {planningAmount(g.average)}
                      <small>
                        {averageDeviation == null
                          ? "—"
                          : `${averageDeviation >= 0 ? "+" : ""}${Math.round(averageDeviation)} vs 平均`}
                      </small>
                    </>,
                  )}
                  {cell("investment-share", <b>{value(g.amountShare)}</b>)}
                  {cell("vol-share", value(g.volShare), "v20-actual")}
                  {cell("c3-share", value(g.c3Share), "v20-actual")}
                  <TableCell className="v20-actual" data-column="history-chart">
                    <HistoricalShareChart
                      vol={g.volShare}
                      c3={g.c3Share}
                      scale={scale}
                      investment={g.amountShare ?? null}
                    />
                  </TableCell>
                  {cell(
                    "vs-vol",
                    <b data-level={level(gapVol)}>{difference(gapVol).replace(/ pp$/, "")}</b>,
                  )}
                  {cell(
                    "vs-c3",
                    <b data-level={level(gapC3)}>{difference(gapC3).replace(/ pp$/, "")}</b>,
                  )}
                </TableRow>
              );
            })}
            {!groups.length && (
              <TableRow>
                <TableCell colSpan={10} className="empty">
                  当前范围暂无经销商名单。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableHead>合计</TableHead>
              {cell("count", formatCount(totals))}
              {cell("amount", planningAmount(totals.amount))}
              {cell("average", planningAmount(totals.average))}
              {cell("investment-share", totals.amount > 0 ? "100.0" : "—")}
              {cell(
                "vol-share",
                totals.analyticalVol > 0 ? "100.0" : "—",
                "v20-actual",
              )}
              {cell(
                "c3-share",
                totals.analyticalC3 > 0 ? "100.0" : "—",
                "v20-actual",
              )}
              <TableCell className="v20-actual">
                {isSelectedScope && (
                  <small>投资金额占比极差 {investmentRange == null ? "—" : `${value(investmentRange)} pp`}</small>
                )}
              </TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <div className="v20-organization-legend">
        {(
          <span>
            <i className="v20-legend-dot investment" />
            投资金额占比
          </span>
        )}
        <span>
          <i className="v20-legend-dot vol" />
          Delivery Vol 占比
        </span>
        <span>
          <i className="v20-legend-dot c3" />
          C3 占比
        </span>
      </div>
      <p className="studio-table-note">
        {isSelectedScope ? "已分配" : "分配"} = 获得投资的经销商家数；
        {isSelectedScope
          ? "总名单 = 本项目在该组织勾选的经销商。"
          : "全部 = 当前授权 Sector 范围内该组织的全部经销商。"}
        历史产出按当前名单去重，包含零投资经销商；仅改金额不会改变历史 Actual 的数值。
        {"三条柱均显示实际占比，全表使用统一刻度，按投资、Vol、C3 的最大占比向上取整至 10% 调整上限。"}
      </p>
    </>
  );
}
