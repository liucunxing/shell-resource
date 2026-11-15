import { useMemo, useState } from "react";
import { configuredYtdLabel } from "../domain/dealer-history";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
} from "@tanstack/react-table";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
} from "../../components/ui/table";

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
const moneyChange = (n) =>
  n == null
    ? "—"
    : `${n > 0 ? "+" : n < 0 ? "−" : ""}${value(Math.abs(n), 10000)}`;

export function HistoricalShareChart({ vol, c3, scale }) {
  return (
    <div
      className="v20-history-bars"
      role="img"
      aria-label={`Delivery Vol ${percent(vol)}；C3 ${percent(c3)}`}
    >
      {[
        ["vol", "Vol", vol],
        ["c3", "C3", c3],
      ].map(([key, label, share]) => (
        <div
          className="v20-history-line"
          key={key}
          data-series={key}
          data-value={share ?? ""}
        >
          <span>{label}</span>
          <div>
            <i
              style={{
                width: `${share == null ? 0 : Math.max(0, Math.min(100, (share / scale) * 100))}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function V20OrganizationSummary({
  groups,
  totals,
  groupBy,
  period,
  ytdCutoffMonth = 10,
  basis,
  threshold,
  redThreshold,
  sourceVersionId,
  rowId,
  highlight,
  onOpen,
}) {
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
      { id: "delta", accessorFn: (g) => g.comparison?.delta ?? undefined },
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
  const head = (field, title, className = "", rowSpan) => {
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
          {title}
          <span aria-hidden="true">
            {direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}
          </span>
        </Button>
      </TableHead>
    );
  };
  // The historical scale must never depend on allocation amounts.
  const scale = Math.min(
    100,
    Math.max(
      10,
      Math.ceil(
        Math.max(
          0,
          ...groups.flatMap((g) => [g.volShare || 0, g.c3Share || 0]),
        ) / 10,
      ) * 10,
    ),
  );
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
        <Table
          containerClassName="overflow-visible"
          className="v20-organization-summary"
        >
          <TableHeader>
            <TableRow>
              {head("key", groupBy.toUpperCase(), "", 2)}
              <TableHead colSpan={4}>本次投资</TableHead>
              <TableHead colSpan={3} className="v20-actual">
                历史 Actual · {period === "2025" ? "2025 全年" : configuredYtdLabel(ytdCutoffMonth)}
              </TableHead>
              <TableHead colSpan={3}>投资金额占比</TableHead>
              <TableHead className="v20-previous">较上版</TableHead>
            </TableRow>
            <TableRow>
              {[
                ["count", "分配 / 全部"],
                ["amount", "投资金额（万元）"],
                ["average", "家均（万元）"],
                ["investment-share", "投资金额占比"],
              ].map(([field, title]) => head(field, title, "num"))}
              {head("vol-share", "Delivery Vol 占比", "num v20-actual")}
              {head("c3-share", "C3 占比", "num v20-actual")}
              <TableHead className="v20-actual">
                占比对照图<small>刻度 0–{scale}%</small>
              </TableHead>
              {head("vs-vol", "vs Delivery Vol", "num")}
              {head("vs-c3", "vs C3", "num")}
              <TableHead>判断</TableHead>
              {head("delta", "增减金额（万元）", "num v20-previous")}
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
              const gap = basis === "vol" ? gapVol : gapC3;
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
                  {cell("count", `${g.allocatedCount} / ${g.totalCount}`)}
                  {cell("amount", <b>{value(g.amount, 10000)}</b>)}
                  {cell(
                    "average",
                    <>
                      {value(g.average, 10000)}
                      <small>
                        {averageDeviation == null
                          ? "—"
                          : `${averageDeviation >= 0 ? "+" : ""}${Math.round(averageDeviation)}% vs 平均`}
                      </small>
                    </>,
                  )}
                  {cell("investment-share", <b>{percent(g.amountShare)}</b>)}
                  {cell("vol-share", percent(g.volShare), "v20-actual")}
                  {cell("c3-share", percent(g.c3Share), "v20-actual")}
                  <TableCell className="v20-actual" data-column="history-chart">
                    <HistoricalShareChart
                      vol={g.volShare}
                      c3={g.c3Share}
                      scale={scale}
                    />
                  </TableCell>
                  {cell(
                    "vs-vol",
                    <b data-level={level(gapVol)}>{difference(gapVol)}</b>,
                  )}
                  {cell(
                    "vs-c3",
                    <b data-level={level(gapC3)}>{difference(gapC3)}</b>,
                  )}
                  <TableCell data-column="judgment">
                    <Badge
                      data-level={level(gap)}
                      variant={
                        level(gap) === "bad" ? "destructive" : "secondary"
                      }
                    >
                      {gap == null
                        ? g.rows?.length
                          ? "暂无可比产出"
                          : "本版未覆盖"
                        : Math.abs(gap) <= threshold
                          ? "匹配"
                          : gap > 0
                            ? "投资偏多"
                            : "投资偏少"}
                    </Badge>
                  </TableCell>
                  {cell(
                    "delta",
                    moneyChange(g.comparison?.delta),
                    "v20-previous",
                  )}
                </TableRow>
              );
            })}
            {!groups.length && (
              <TableRow>
                <TableCell colSpan={12} className="empty">
                  当前范围暂无经销商名单。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableHead>合计</TableHead>
              {cell("count", `${totals.allocatedCount} / ${totals.totalCount}`)}
              {cell("amount", value(totals.amount, 10000))}
              {cell("average", value(totals.average, 10000))}
              {cell("investment-share", totals.amount > 0 ? "100.0%" : "—")}
              {cell(
                "vol-share",
                totals.analyticalVol > 0 ? "100.0%" : "—",
                "v20-actual",
              )}
              {cell(
                "c3-share",
                totals.analyticalC3 > 0 ? "100.0%" : "—",
                "v20-actual",
              )}
              <TableCell className="v20-actual" />
              <TableCell colSpan={3} />
              {cell(
                "delta",
                moneyChange(totals.comparison.delta),
                "v20-previous",
              )}
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <div className="v19-chart-legend">
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
        分配 = 获得投资的经销商家数；全部 = 当前授权 Sector
        范围内该组织的全部经销商。历史产出按当前名单去重，包含零投资经销商；仅改金额不会改变历史
        Actual
        的数据、图形和刻度。调整名单或历史期间才改变历史范围。较上版按同一
        Initiative 集合比较，保留移除组织的上版投入；
        {sourceVersionId
          ? `来源版本 ${sourceVersionId}`
          : "没有来源版本时显示 —"}
        。
      </p>
    </>
  );
}
