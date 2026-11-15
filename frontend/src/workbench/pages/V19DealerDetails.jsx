import { useRef, useState } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "../../components/ui/table";
import { HistoryControls } from "./V19PortfolioVisuals.jsx";
import { WorkflowDialog } from "./WorkflowDialog.jsx";
import { portfolioRows } from "../domain/portfolio-analytics.js";
import {
  HISTORY_RESOURCES,
  historyInvestment,
  historyYield,
} from "../domain/dealer-history";

const number = (value, scale = 1) =>
  value == null
    ? "—"
    : (value / scale).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const pct = (value) => (value == null ? "—" : `${number(value)}%`);
const gap = (value) =>
  value == null ? "—" : `${value > 0 ? "+" : ""}${number(value)}pp`;
const ratio = (value, total) =>
  value != null && total > 0 ? (value / total) * 100 : null;

export function dealerDetailRows(items, dealers, basis, period) {
  const rows = portfolioRows(items, dealers, basis, period),
    suffix = period === "2025" ? "2025" : "2026Ytd";
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const completeTotal = (read) =>
    rows.length && rows.every((row) => read(row) != null)
      ? rows.reduce((sum, row) => sum + read(row), 0)
      : null;
  const metricTotal = completeTotal((row) => row.metric),
    investmentTotal = completeTotal((row) =>
      historyInvestment(row.history, period),
    ),
    contractTotal = completeTotal((row) => row.history[`contract${suffix}`]);
  return rows.map((row) => {
    const h = row.history,
      investment = historyInvestment(h, period),
      contract = h[`contract${suffix}`] ?? null,
      vol = h[`vol${suffix}`] ?? null;
    const amountShare = ratio(row.amount, totalAmount),
      metricShare = ratio(row.metric, metricTotal);
    return {
      ...row,
      investment,
      yield: historyYield(h, period),
      investmentShare: ratio(investment, investmentTotal),
      contract,
      contractShare: ratio(contract, contractTotal),
      phasing: ratio(vol, contract),
      amountShare,
      metricShare,
      gap:
        amountShare != null && metricShare != null
          ? amountShare - metricShare
          : null,
      resources: h[`resources${suffix}`] || {},
    };
  });
}

export function V19DealerDetails({ items, dealers, ytdCutoffMonth = 10 }) {
  const [period, setPeriod] = useState("2025"),
    [basis, setBasis] = useState("c3"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [sort, setSort] = useState({ key: "amount", direction: -1 }),
    [detail, setDetail] = useState(null);
  const wrap = useRef(null),
    rows = dealerDetailRows(items, dealers, basis, period),
    label = basis === "c3" ? "C3" : "Delivery Vol";
  const expenses = HISTORY_RESOURCES.filter((type) =>
    rows.some((row) => Object.hasOwn(row.resources, type)),
  );
  const groups = [
    [
      "本次投资",
      [
        ["name", "经销商 / 编码"],
        ["amount", "累计投资（万）"],
      ],
    ],
    [
      "历史投资 · " + (period === "2025" ? "2025 全年" : "2026 YTD"),
      [
        ["investment", "历史投资总额（千元人民币）"],
        ["yield", "Yield"],
        ["investmentShare", "历史资源占比"],
      ],
    ],
    [
      "组织属性",
      [
        ["sd", "SD"],
        ["rsm", "RSM"],
      ],
    ],
    [
      "投入与历史产出",
      [
        ["amountShare", "投资占比"],
        ["metricShare", `${label} 占比`],
        ["gap", `投资 − ${label}`],
      ],
    ],
    [
      "合同与 Actual",
      [
        ["contract", "合同量（KL）"],
        ["contractShare", "合同量占比"],
        [
          "metric",
          `${basis === "c3" ? "Actual C3" : label}（${basis === "vol" ? "KL" : "K$"}）`,
        ],
        ["phasing", "Phasing"],
      ],
    ],
    [
      "支持与说明",
      [
        ["support", "获配项目数"],
        ["notes", "调整说明"],
      ],
    ],
    ...(expenses.length
      ? [
          [
            "历史费用明细 · 已授权",
            expenses.map((type) => [`expense:${type}`, `${type}（千元人民币）`]),
          ],
        ]
      : []),
  ];
  const read = (row, key) =>
    key.startsWith("expense:")
      ? row.resources[key.slice(8)]
      : key === "support"
        ? row.initiativeSources.filter((source) => source.amount > 0).length
        : key === "notes"
          ? row.notes.join("；")
          : row[key];
  const visible = rows
    .filter((row) =>
      `${row.code} ${row.name}`.toLowerCase().includes(search.toLowerCase()),
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
  const pages = Math.max(1, Math.ceil(visible.length / 50)),
    currentPage = Math.min(page, pages);
  const jump = (key) =>
    wrap.current?.querySelector(`[data-column="${key}"]`)?.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: "smooth",
    });
  const cell = (row, key) => {
    if (key === "name")
      return (
        <>
          <Button variant="link" onClick={() => setDetail(row)}>
            {row.name}
          </Button>
          <small>{row.code}</small>
        </>
      );
    if (key === "amount") return <b>{number(row.amount, 10000)}</b>;
    if (
      [
        "amountShare",
        "investmentShare",
        "metricShare",
        "contractShare",
        "phasing",
      ].includes(key)
    )
      return pct(read(row, key));
    if (key === "gap") return gap(row.gap);
    if (key === "yield")
      return row.yield == null || row.yield <= 0 ? "—" : number(row.yield);
    if (
      ["investment", "contract", "metric"].includes(key) ||
      key.startsWith("expense:")
    )
      return number(read(row, key), 1000);
    if (key === "support")
      return (
        <Button variant="link" onClick={() => setDetail(row)}>
          {read(row, key)} 个 Initiative
        </Button>
      );
    return read(row, key) || "—";
  };
  return (
    <Card className="v19-board-section v19-dealer-details">
      <div className="v19-section-heading">
        <div>
          <h2>经销商明细 · 资源叠加与历史对照</h2>
          <p>
            按当前名单去重汇总；点击经销商查看各 Initiative 的投资来源与说明。
          </p>
        </div>
      </div>
      <div className="v19-board-body">
        <HistoryControls
          {...{ period, setPeriod, basis, setBasis, ytdCutoffMonth }}
        />
        <div className="studio-table-toolbar">
          <div className="v19-dealer-jumps">
            <span>快速定位列组</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => jump("investment")}
            >
              历史投资 / Yield
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => jump("amountShare")}
            >
              占比与差值
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => jump("contract")}
            >
              合同 / Actual
            </Button>
            {expenses.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => jump(`expense:${expenses[0]}`)}
              >
                历史费用明细
              </Button>
            )}
          </div>
          <Input
            aria-label="搜索经销商或编码"
            type="search"
            placeholder="搜索经销商 / 编码"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="table-scroll" ref={wrap}>
          <Table
            containerClassName="overflow-visible"
            className="v19-dealer-grouped"
          >
            <TableHeader>
              <TableRow>
                {groups.map(([title, columns]) => (
                  <TableHead key={title} colSpan={columns.length}>
                    {title}
                  </TableHead>
                ))}
              </TableRow>
              <TableRow>
                {groups
                  .flatMap(([, columns]) => columns)
                  .map(([key, title]) => (
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
                .slice((currentPage - 1) * 50, currentPage * 50)
                .map((row) => (
                  <TableRow key={row.key}>
                    {groups
                      .flatMap(([, columns]) => columns)
                      .map(([key]) => (
                        <TableCell
                          key={key}
                          data-column={key}
                          className={
                            ["name", "sd", "rsm", "notes", "support"].includes(
                              key,
                            )
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
                  <TableCell
                    colSpan={groups.reduce(
                      (count, [, columns]) => count + columns.length,
                      0,
                    )}
                  >
                    <p className="empty">当前范围暂无匹配经销商。</p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="v19-list-pagination">
          <span>共 {visible.length} 家 · 每页 50 行</span>
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
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
              onClick={() => setPage(currentPage + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
        <p className="studio-table-note">
          历史参考：{period === "2025" ? "2025 全年" : "2026 YTD"} · {label}
          。历史资源占比以当前名单历史投资为分母；搜索、排序和分页不改变分母。历史费用明细按当前账号授权显示，缺失数据保留“—”。
        </p>
      </div>
      {detail && (
        <WorkflowDialog
          title={`${detail.name} · 投资来源与说明`}
          onClose={() => setDetail(null)}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Initiative</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>投资金额（万）</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.initiativeSources.map((source) => (
                <TableRow key={source.id}>
                  <TableCell>{source.name}</TableCell>
                  <TableCell>{source.owner}</TableCell>
                  <TableCell>{number(source.amount, 10000)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p>{detail.notes.join("；") || "暂无 Owner 说明"}</p>
        </WorkflowDialog>
      )}
    </Card>
  );
}
