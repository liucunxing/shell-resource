import { MetricHelp } from "./MetricHelp";
import { useRef, useState } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select";
import { Checkbox } from "../../components/ui/checkbox";
import { Label } from "../../components/ui/label";
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
} from "../../components/ui/table";
import { HistoryControls } from "./V19PortfolioVisuals.jsx";
import { ResourceDetailDrawer } from "./ResourceDetailDrawer";
import { portfolioRows } from "../domain/portfolio-analytics.js";
import { aggregateHistoryPhasing, historyPhasing, historyInvestment, historyYield } from "../domain/dealer-history";
import {
  allocationColumnGroups,
  EXPENSE_COLUMN_ORDER,
} from "../domain/allocation-detail";

const number = (value, scale = 1) =>
  value == null
    ? "—"
    : (value / scale).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const pct = (value) => (value == null ? "—" : `${number(value)}%`);
const gap = (value) =>
  value == null ? "—" : `${value > 0 ? "+" : ""}${number(value)}pp`;
const ratio = (value, total) =>
  value != null && total > 0 ? (value / total) * 100 : null;
const complete = (values) =>
  values.length &&
  values.every((value) => typeof value === "number" && Number.isFinite(value))
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
const availableTotal = (values) => {
  const valid = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) : null;
};
export function dealerDetailRows(items, dealers, basis, period) {
  const rows = portfolioRows(items, dealers, basis, period),
    suffix = period === "2025" ? "2025" : "2026Ytd";
  const amount = rows.reduce((sum, row) => sum + row.amount, 0),
    vol = availableTotal(rows.map((row) => row.history[`vol${suffix}`])),
    c3 = availableTotal(rows.map((row) => row.history[`c3${suffix}`]));
  const investment = availableTotal(
      rows.map((row) => historyInvestment(row.history, period)),
    ),
    contract = availableTotal(rows.map((row) => row.history[`contract${suffix}`]));
  return rows.map((row) => {
    const h = row.history,
      amountShare = ratio(row.amount, amount),
      volShare = ratio(h[`vol${suffix}`], vol),
      c3Share = ratio(h[`c3${suffix}`], c3);
    return {
      ...row,
      investment: historyInvestment(h, period),
      yield: historyYield(h, period),
      investmentShare: ratio(historyInvestment(h, period), investment),
      contract: h[`contract${suffix}`] ?? null,
      contractShare: ratio(h[`contract${suffix}`], contract),
      vol: h[`vol${suffix}`] ?? null,
      c3: h[`c3${suffix}`] ?? null,
      phasing: historyPhasing(h, period) == null ? null : historyPhasing(h, period) * 100,
      amountShare,
      volShare,
      c3Share,
      gapVol:
        amountShare != null && volShare != null ? amountShare - volShare : null,
      gapC3:
        amountShare != null && c3Share != null ? amountShare - c3Share : null,
      resources: h[`resources${suffix}`] || {},
    };
  });
}
export function V19DealerDetails({
  items,
  dealers,
  ytdCutoffMonth = 10,
  sourceItems = null,
  budgetReasons = [],
  showColumnJumps = true,
}) {
  const [period, setPeriod] = useState("2025"),
    [basis, setBasis] = useState("c3"),
    [search, setSearch] = useState(""),
    [onlyFunded, setOnlyFunded] = useState(false),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(20),
    [sort, setSort] = useState({ key: "amount", direction: -1 }),
    [detail, setDetail] = useState(null);
  const wrap = useRef(null),
    rows = dealerDetailRows(items, dealers, basis, period);
  const expenses = EXPENSE_COLUMN_ORDER.filter((type) =>
    rows.some((row) => Object.hasOwn(row.resources, type)),
  );
  const groups = allocationColumnGroups(expenses),
    columns = groups.flatMap((group) => group.columns);
  const read = (row, key) =>
    key.startsWith("expense:")
      ? row.resources[key.slice(8)]
      : key === "support"
        ? row.initiativeSources.filter((source) => source.amount > 0).length
        : key === "note"
          ? row.notes.join("；")
          : row[key];
  const visible = rows
    .filter(
      (row) =>
        (!onlyFunded || row.amount > 0) &&
        `${row.code} ${row.name} ${row.sd} ${row.rsm}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      const av = read(a, sort.key),
        bv = read(b, sort.key);
      return av == null
        ? bv == null
          ? 0
          : 1
        : bv == null
          ? -1
          : (typeof av === "number" && typeof bv === "number"
              ? av - bv
              : String(av).localeCompare(String(bv), "zh-CN")) * sort.direction;
    });
  const effectivePageSize = pageSize || Math.max(1, visible.length),
    pages = Math.max(1, Math.ceil(visible.length / effectivePageSize)),
    currentPage = Math.min(page, pages);
  const jump = (key) => {
    const target = wrap.current?.querySelector(`[data-column="${key}"]`);
    if (target)
      wrap.current.scrollTo({
        left: Math.max(0, target.offsetLeft - 355),
        behavior: "smooth",
      });
  };
  const open = (row) =>
    setDetail({ type: "dealer", dealerKey: row.key, period, basis });
  const format = (value, key) =>
    [
      "amountShare",
      "investmentShare",
      "volShare",
      "c3Share",
      "contractShare",
      "phasing",
    ].includes(key)
      ? pct(value)
      : key === "gapVol" || key === "gapC3"
        ? gap(value)
        : key === "yield"
          ? value == null || value <= 0
            ? "—"
            : number(value)
          : key === "amount"
            ? number(value, 10000)
            : ["investment", "contract", "vol", "c3"].includes(key) ||
                key.startsWith("expense:")
              ? number(value, 1000)
              : value || "—";
  const cell = (row, key) =>
    key === "name" ? (
      <>
        <Button variant="link" onClick={() => open(row)}>
          {row.name}
        </Button>
        <small>
          {row.code} · {row.sector}
        </small>
      </>
    ) : key === "support" ? (
      <Button variant="link" onClick={() => open(row)}>
        {read(row, key)} 个 Initiative
      </Button>
    ) : (
      format(read(row, key), key)
    );
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0),
    totalVol = complete(rows.map((row) => row.vol)),
    totalC3 = complete(rows.map((row) => row.c3)),
    totalContract = complete(rows.map((row) => row.contract)),
    totalInvestment = complete(rows.map((row) => row.investment));
  const aligned =
    period === "2025" ||
    rows.every((row) => !row.history.ytdYieldUnavailableReason);
  const totalPhasing = aggregateHistoryPhasing(rows.map((row) => row.history), period).ratio;
  const totalFor = (key) =>
    ({
      amount: totalAmount,
      vol: totalVol,
      c3: totalC3,
      contract: totalContract,
      investment: totalInvestment,
      amountShare: totalAmount > 0 ? 100 : null,
      volShare: totalVol > 0 ? 100 : null,
      c3Share: totalC3 > 0 ? 100 : null,
      contractShare: totalContract > 0 ? 100 : null,
      investmentShare: totalInvestment > 0 ? 100 : null,
      phasing: totalPhasing == null ? null : totalPhasing * 100,
      yield:
        aligned && totalC3 > 0 && totalInvestment > 0
          ? totalC3 / totalInvestment
          : null,
    })[key] ??
    (key.startsWith("expense:")
      ? complete(rows.map((row) => read(row, key)))
      : null);
  return (
    <Card className="v19-board-section v19-dealer-details">
      <div className="v19-section-heading">
        <div>
          <h2>经销商明细 · 资源叠加与历史对照 <MetricHelp>跨 Initiative 按经销商与 Sector 业务身份汇总；搜索、排序和分页不改变投资及历史产出的占比分母。历史费用明细按用户授权范围显示。各历史占比按当前名单中该指标有效值合计计算，缺失项不视作零。经销商 target 以 KL 展示；Phasing 直接读取源表对应年份的结果，1 表示 100%；源值缺失时显示 —。多经销商汇总仅对同年源 target 大于 0 且源 Phasing 有值的经销商加权，结果仅代表有效数据范围；无有效数据时显示 —。点击经销商查看资源构成、投资来源与历史明细。</MetricHelp></h2>
        </div>
      </div>
      <div className="v19-board-body">
        <HistoryControls
          {...{ period, setPeriod, basis, setBasis, ytdCutoffMonth }}
        />
        <div className="studio-table-toolbar">
          {showColumnJumps && <div className="v19-dealer-jumps">
            <span>快速定位列组</span>
            {[
              ["amountShare", "占比与差值"],
              ["contract", "① 经销商 target"],
              ["vol", "② Actual / Phasing"],
              ["investment", "③ 投资 / Yield"],
            ].map(([key, title]) => (
              <Button
                key={key}
                variant="outline"
                size="sm"
                onClick={() => jump(key)}
              >
                {title}
              </Button>
            ))}
          </div>}
          <Input
            aria-label="搜索经销商或编码"
            placeholder="搜索经销商 / 编码 / SD / RSM"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
          <Label>
            <Checkbox
              checked={onlyFunded}
              onCheckedChange={(value) => {
                setOnlyFunded(value === true);
                setPage(1);
              }}
            />
            只看已获配
          </Label>
        </div>
        <div
          className="table-scroll v20-dealer-detail-scroll"
          ref={wrap}
          tabIndex={0}
          role="region"
          aria-label="经销商与历史对照，可横向滚动"
        >
          <Table sortingMode="manual"
            containerClassName="overflow-visible"
            className="v19-dealer-grouped v20-detail-table"
          >
            <TableHeader>
              <TableRow>
                {groups.map((group) => (
                  <TableHead
                    key={group.key}
                    colSpan={group.columns.length}
                    data-column-group={group.key}
                  >
                    {group.title}
                  </TableHead>
                ))}
              </TableRow>
              <TableRow>
                {columns.map(([key, title]) => (
                  <TableHead
                    key={key}
                    data-column={key}
                    aria-sort={
                      sort.key === key
                        ? sort.direction === 1
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <Button
                      variant="ghost"
                      className="v19-sort"
                      onClick={() => {
                        setSort({
                          key,
                          direction: sort.key === key ? -sort.direction : -1,
                        });
                        setPage(1);
                      }}
                    >
                      {title}{" "}
                      {sort.key === key
                        ? sort.direction === 1
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </Button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible
                .slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize)
                .map((row) => (
                  <TableRow key={row.key}>
                    {columns.map(([key]) => (
                      <TableCell
                        key={key}
                        data-column={key}
                        className={
                          ["name", "sd", "rsm", "note", "support"].includes(key)
                            ? ""
                            : "num"
                        }
                      >
                        {cell(row, key)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!visible.length && (
                <TableRow>
                  <TableCell colSpan={columns.length}>
                    <p className="empty">当前范围暂无匹配经销商。</p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                {columns.map(([key], index) => (
                  <TableCell
                    key={key}
                    data-column={key}
                    className={index ? "num" : ""}
                  >
                    {index === 0
                      ? "范围合计 / 加权值"
                      : ["sd", "rsm", "support", "note"].includes(key)
                        ? ""
                        : format(totalFor(key), key)}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
        <div className="v19-list-pagination">
          <span>
            筛选 {visible.length} / {rows.length} 家 · 本页 {Math.min(effectivePageSize, Math.max(0, visible.length - (currentPage - 1) * effectivePageSize))} 家
          </span>
          <div>
            <Label className="v20-page-size">每页
              <NativeSelect aria-label="每页显示记录数" value={String(pageSize)} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); wrap.current?.scrollTo({ top: 0 }); }}>
                {[10, 20, 50, 0].map((size) => <NativeSelectOption key={size} value={String(size)}>{size ? `${size} 条` : "全部"}</NativeSelectOption>)}
              </NativeSelect>
            </Label>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => { setPage(currentPage - 1); wrap.current?.scrollTo({ top: 0 }); }}
            >
              上一页
            </Button>
            <span>
              {currentPage} / {pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= pages}
              onClick={() => { setPage(currentPage + 1); wrap.current?.scrollTo({ top: 0 }); }}
            >
              下一页
            </Button>
          </div>
        </div>
        <p className="studio-table-note">
          历史参考：{period === "2025" ? "2025 全年" : "2026 YTD"}。Vol /
          C3及两项占比同时显示。各历史占比以当前名单中该指标有值的经销商合计为分母，缺失项不计入且保留“—”；搜索、排序和分页不改变分母。四类费用仅显示接口已授权返回的字段；缺失数据保留“—”。
        </p>
      </div>
      {detail && (
        <ResourceDetailDrawer
          {...{
            detail,
            items,
            dealers,
            sourceItems,
            ytdCutoffMonth,
            budgetReasons,
          }}
          onClose={() => setDetail(null)}
        />
      )}
    </Card>
  );
}
