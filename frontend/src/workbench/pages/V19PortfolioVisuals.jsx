import { dealerDetailRows } from "../domain/dealer-detail-rows.js";
import { allocationColumnGroups, EXPENSE_COLUMN_ORDER } from "../domain/allocation-detail";
import { Input } from "../../components/ui/input";
import { DealerDetailButton } from "../DealerDetailAccess";
import { useLegendColors, resolveInitiativeColor, resolveResourceColor } from "../LegendColors";
export { InitiativeChip } from "../InitiativeChip";
import { BudgetDonut } from "./BudgetDonut";
import { HistoryPeriodTabs } from "./HistoryPeriodTabs";
import { MetricHelp } from "./MetricHelp";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableFooter,
} from "../../components/ui/table";
import { WorkflowDialog } from "./WorkflowDialog.jsx";
import { ResourceDetailDrawer } from "./ResourceDetailDrawer";
import E from "../domain/engine.js";
import {
  concentration,
  rankedConcentrationRows,
  analyticalOutput,
  dealerDeviations,
  portfolioRows,
} from "../domain/portfolio-analytics.js";

const n = (value, digits = 1) =>
  Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const wan = (value) => `${n(value / 10000)} 万元`,
  pct = (value) => (value == null ? "—" : `${n(value)}%`),
  pp = (value) =>
    value == null ? "—" : `${value > 0 ? "+" : ""}${n(value)}pp`;
export const initiativeColor = resolveInitiativeColor;
export const resourceColor = resolveResourceColor;
export const orderedResourceTypes = (values) => {
  const order = ["ICE Rebate", "MRD", "SP&A", "Capex"];
  const rank = (value) => {
    const index = order.indexOf(value);
    return index < 0 ? order.length : index;
  };
  return [...new Set(values.filter(Boolean))].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      String(left).localeCompare(String(right), "zh-CN"),
  );
};
const paid = (item) =>
  (item.rows || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
const reserve = (item) =>
  (item.otherBudgets || []).reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0,
  );
export const HistoryControls = ({
  period,
  setPeriod,
  basis,
  setBasis,
  ytdCutoffMonth = 10,
}) => (
  <div className="v19-local-history">
    <span>历史参考</span>
    <HistoryPeriodTabs value={period} onValueChange={setPeriod} ytdCutoffMonth={ytdCutoffMonth} />
    <Tabs value={basis} onValueChange={setBasis}>
      <TabsList>
        <TabsTrigger value="vol">Vol</TabsTrigger>
        <TabsTrigger value="c3">C3</TabsTrigger>
      </TabsList>
    </Tabs>
  </div>
);
const Heading = ({ title, description, children }) => (
  <div className="v19-section-heading">
    <div>
      <h2>{title} {description && <MetricHelp>{description}</MetricHelp>}</h2>
    </div>
    {children}
  </div>
);
const Dot = ({ color }) => (
  <i className="v19-color-dot" style={{ background: color }} />
);

export function V19BudgetOverview({ items, dealers = [], mode, state }) {
  const { initiativeColor, resourceColor } = useLegendColors();
  const included = (item) =>
    mode === "department"
      ? (item.workflow?.submitted ?? Boolean(paid(item) || reserve(item)))
      : mode === "exec"
        ? (item.workflow?.confirmed ?? Boolean(paid(item) || reserve(item)))
        : Boolean(paid(item) || reserve(item));
  const total = E.totals(items),
    pending = Math.max(0, total.gap),
    notStarted = items.filter((item) => !included(item)),
    started = items.filter(included);
  const [detail, setDetail] = useState(null);
  const [drill, setDrill] = useState(null);
  const categories = orderedResourceTypes(items.map((i) => i.resourceType));
  const categoryTotals = categories.map((type) => {
    const group = items.filter((item) => item.resourceType === type);
    const total = E.totals(group);
    return {
      type,
      group,
      total,
      confirmed: group.filter(included),
      dealers: new Set(
        group.flatMap((item) =>
          (item.rows || [])
            .filter((row) => row.amount > 0)
            .map((row) => `${item.sector}:${row.dealerId}`),
        ),
      ).size,
    };
  });
  const parts = [
    ["已分配到经销商", total.allocated, "#FBCE07", ""],
    ["预留", total.otherBudget, "#7F7F7F", "有原因、暂不分配"],
    [
      mode === "exec"
        ? "待确认预算"
        : mode === "department"
          ? "未提交"
          : "未开始拆分",
      pending,
      "#D9D9D9",
      `${notStarted.length} 个 Initiative`,
    ],
  ];
  const reason = (item) =>
    (item.otherBudgets || [])
      .map(
        (row) =>
          state.budgetReasons?.find((x) => x.id === row.reasonId)?.label ||
          row.note ||
          row.reasonId,
      )
      .join("、") || "—";
  return (
    <Card className="v19-board-section">
      <Heading
        title={
          mode === "exec"
            ? "总盘 · 资源大类的预算与投资去向"
            : "总盘 · 预算有多少，分下去多少"
        }
        description="预算去了哪里，还有多少待安排"
      >
        <Badge variant="secondary">
          {started.length} / {items.length} 个 Initiative{" "}
          {mode === "department"
            ? "已提交"
            : mode === "exec"
              ? "已确认"
              : "已开始"}
        </Badge>
      </Heading>
      <div className="v19-board-body">
        <div className="v19-overview-grid">
          <div className="v19-subpanel">
            <h3>预算去向</h3>
            <div className="v19-donut-layout">
              <BudgetDonut parts={parts.map(([label, value, color]) => ({label, value, color}))}
                center={n(total.budget / 10000)} caption="万元 · 预算总额" />
              <div className="v19-budget-legend">
                {parts.map(([label, value, color, note]) => (
                  <div key={label}>
                    <span>
                      <Dot color={color} />
                      {label}
                      {note && <small>{note}</small>}
                    </span>
                    <strong>{wan(value)}</strong>
                    <span>
                      {pct(total.budget ? (value / total.budget) * 100 : 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {mode === "exec" ? (
            <div className="v19-subpanel">
              <h3>资源大类预算构成</h3>
              <div className="v19-donut-layout">
                <BudgetDonut parts={categoryTotals.map(({type, total: groupTotal}) => ({label: type, value: groupTotal.budget, color: resourceColor(type), onClick: () => setDrill({type: "resource", resourceType: type})}))}
                  center={String(categories.length)} caption="个资源大类" />
                <div className="v19-budget-legend">
                  {categoryTotals.map(({ type, total: groupTotal }) => (
                    <div key={type}>
                      <span>
                        <Dot color={resourceColor(type)} />
                        <Button
                          variant="link"
                          onClick={() =>
                            setDrill({ type: "resource", resourceType: type })
                          }
                        >
                          {type}
                        </Button>
                      </span>
                      <strong>{wan(groupTotal.budget)}</strong>
                      <span>
                        {pct(
                          total.budget
                            ? (groupTotal.budget / total.budget) * 100
                            : 0,
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {" "}
              <div className="v19-subpanel">
                <div className="v19-subpanel-heading">
                  <h3>
                    {mode === "exec"
                      ? "未确认"
                      : mode === "department"
                        ? "未提交"
                        : "未开始拆分"}
                    的 Initiative（{notStarted.length}）
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDetail("pending")}
                  >
                    查看全部 →
                  </Button>
                </div>
                {notStarted.length ? (
                  <Table pageSize={6} containerClassName="overflow-visible">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Initiative</TableHead>
                        <TableHead>资源大类 · Owner</TableHead>
                        <TableHead className="num">预算（万元）</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {notStarted.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell>
                            <Button
                              variant="link"
                              onClick={() =>
                                setDrill({
                                  type: "initiative",
                                  initiativeId: i.id,
                                })
                              }
                            >
                              {i.name}
                            </Button>
                          </TableCell>
                          <TableCell>
                            {i.resourceType} · {i.ownerName || i.ownerId}
                          </TableCell>
                          <TableCell className="num" sortValue={i.budget / 10000}>
                            {n(i.budget / 10000)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="v19-muted-empty">无</p>
                )}
              </div>
            </>
          )}
        </div>
        <div className="v19-subpanel">
          <div className="v19-subpanel-heading">
            <h3>
              {mode === "exec"
                ? "资源大类预算与已确认分配"
                : mode === "department"
                  ? "已提交 Initiative 的预留明细"
                  : "已拆分的 Initiative、资源大类"}
            </h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDetail("started")}
            >
              查看全部 →
            </Button>
          </div>
          {mode === "exec" ? (
            <Table containerClassName="overflow-visible">
              <TableHeader>
                <TableRow>
                  {[
                    "资源大类",
                    "预算（万元）",
                    "已分配（万元）",
                    "预留（万元）",
                    "未确认（万元）",
                    "分配进度",
                    "获配经销商",
                    "已确认",
                  ].map((label) => (
                    <TableHead key={label}>{label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoryTotals.map(
                  ({ type, group, total: t, confirmed, dealers }) => (
                    <TableRow key={type}>
                      <TableCell>
                        <Dot color={resourceColor(type)} />
                        <Button
                          variant="link"
                          onClick={() =>
                            setDrill({ type: "resource", resourceType: type })
                          }
                        >
                          {type}
                        </Button>
                      </TableCell>
                      <TableCell className="num" sortValue={t.budget / 10000}>
                        {n(t.budget / 10000)}
                      </TableCell>
                      <TableCell className="num" sortValue={t.allocated / 10000}>
                        {n(t.allocated / 10000)}
                      </TableCell>
                      <TableCell className="num" sortValue={t.otherBudget / 10000}>
                        {n(t.otherBudget / 10000)}
                      </TableCell>
                      <TableCell className="num" sortValue={Math.max(0, t.gap) / 10000}>
                        {n(Math.max(0, t.gap) / 10000)}
                      </TableCell>
                      <TableCell sortValue={t.budget ? t.allocated / t.budget : null}>
                        <AllocationBar total={t} />
                        <small>
                          {pct(t.budget ? (t.allocated / t.budget) * 100 : 0)}
                        </small>
                      </TableCell>
                      <TableCell>{dealers} 家</TableCell>
                      <TableCell sortValue={confirmed.length}>
                        {confirmed.length} / {group.length}
                      </TableCell>
                    </TableRow>
                  ),
                )}
              </TableBody>
            </Table>
          ) : (
            <Table containerClassName="overflow-visible">
              <TableHeader>
                <TableRow>
                  <TableHead>Initiative</TableHead>
                  <TableHead>资源大类 · Owner</TableHead>
                  <TableHead>预留原因</TableHead>
                  <TableHead className="num">预留金额</TableHead>
                  <TableHead className="num">占预留</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {started.map((item, index) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Dot color={initiativeColor(item, index)} />
                      <Button
                        variant="link"
                        onClick={() =>
                          setDrill({
                            type: "initiative",
                            initiativeId: item.id,
                          })
                        }
                      >
                        {item.name}
                      </Button>
                    </TableCell>
                    <TableCell>
                      {item.resourceType} · {item.ownerName || item.ownerId}
                    </TableCell>
                    <TableCell>{reason(item)}</TableCell>
                    <TableCell className="num" sortValue={reserve(item)}>{wan(reserve(item))}</TableCell>
                    <TableCell className="num" sortValue={total.otherBudget
                          ? (reserve(item) / total.otherBudget) * 100
                          : 0}>
                      {pct(
                        total.otherBudget
                          ? (reserve(item) / total.otherBudget) * 100
                          : 0,
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {!started.length && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      {mode === "department"
                        ? "暂无已提交的 Initiative"
                        : "暂无已拆分的 Initiative"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>合计</TableCell>
                  <TableCell className="num" sortValue={total.otherBudget}>
                    {wan(total.otherBudget)}
                  </TableCell>
                  <TableCell className="num">
                    {total.otherBudget ? "100.0%" : "—"}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </div>
      </div>
      {detail && (
        <WorkflowDialog
          wide
          title={
            detail === "pending"
              ? "待安排的 Initiative"
              : mode === "department"
                ? "已提交 Initiative 的预留明细"
                : "已拆分的 Initiative"
          }
          onClose={() => setDetail(null)}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Initiative</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>预算</TableHead>
                <TableHead>已分配</TableHead>
                <TableHead>预留</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(detail === "pending" ? notStarted : started).map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Button
                      variant="link"
                      onClick={() =>
                        setDrill({ type: "initiative", initiativeId: i.id })
                      }
                    >
                      {i.name}
                    </Button>
                  </TableCell>
                  <TableCell>{i.ownerName || i.ownerId}</TableCell>
                  <TableCell sortValue={i.budget}>{wan(i.budget)}</TableCell>
                  <TableCell sortValue={paid(i)}>{wan(paid(i))}</TableCell>
                  <TableCell sortValue={reserve(i)}>{wan(reserve(i))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </WorkflowDialog>
      )}
      {drill && (
        <ResourceDetailDrawer
          detail={drill}
          items={items}
          dealers={dealers}
          budgetReasons={state.budgetReasons}
          ytdCutoffMonth={state.ytdCutoffMonth}
          onClose={() => setDrill(null)}
        />
      )}
    </Card>
  );
}

function AllocationBar({ total }) {
  return (
    <div
      className="v19-allocation-bar"
      role="img"
      aria-label={`已分配${wan(total.allocated)}，预留${wan(total.otherBudget)}，待分配${wan(Math.max(0, total.gap))}`}
    >
      {[
        [total.allocated, "#FBCE07"],
        [total.otherBudget, "#7F7F7F"],
        [Math.max(0, total.gap), "#FFE680"],
      ].map(([value, color], index) => (
        <span
          key={index}
          style={{
            width: `${total.budget ? (value / total.budget) * 100 : 0}%`,
            background: color,
          }}
        />
      ))}
    </div>
  );
}

export function CumulativeChart({ rows, top, basis, onSelect }) {
  const eligible = rankedConcentrationRows(rows),
    a = eligible.reduce((s, r) => s + r.amount, 0),
    m = eligible.reduce((s, r) => s + analyticalOutput(r.metric), 0);
  if (a <= 0 || m <= 0) return <p className="empty">暂无可比较的历史产出。</p>;
  let ac = 0,
    mc = 0;
  const points = [
    { x: 0, a: 0, m: 0 },
    ...eligible.map((r, i) => ({
      x: ((i + 1) / eligible.length) * 100,
      a: a ? ((ac += r.amount) / a) * 100 : 0,
      m: m ? ((mc += analyticalOutput(r.metric)) / m) * 100 : 0,
    })),
  ];
  const xy = (x, y) => `${48 + x * 5.2},${226 - y * 1.9}`,
    path = (key) => points.map((p) => xy(p.x, p[key])).join(" ");
  return (
    <svg
      className="v19-concentration-chart"
      viewBox="0 0 600 310"
      role="img"
      aria-label="投资金额与历史产出累计占比曲线"
      onClick={(event) => { if (event.target.closest('[role="button"]')) return; const rect=event.currentTarget.getBoundingClientRect(); const x=((event.clientX-rect.left)/rect.width*600-48)/5.2; onSelect([20,50,80].reduce((best,n)=>Math.abs(n-x)<Math.abs(best-x)?n:best,20)); }}
    >
      <g transform="translate(0 30)">
      {[0, 25, 50, 75, 100].map((y) => (
        <g key={y}>
          <line
            x1="48"
            x2="568"
            y1={226 - y * 1.9}
            y2={226 - y * 1.9}
            stroke="#dce3e8"
          />
          <text x="35" y={230 - y * 1.9} textAnchor="end">
            {y}%
          </text>
        </g>
      ))}
      <line
        x1="48"
        x2="568"
        y1="226"
        y2="36"
        stroke="#b3bec7"
        strokeDasharray="5 5"
      />
      <polygon
        points={`${path("a")} ${points
          .slice()
          .reverse()
          .map((p) => xy(p.x, p.m))
          .join(" ")}`}
        fill="#FBCE0729"
      />
      <polyline
        points={path("a")}
        fill="none"
        stroke="#E0A800"
        strokeWidth="3"
      />
      <polyline
        points={path("m")}
        fill="none"
        stroke="#595959"
        strokeWidth="3"
      />
      {[0, 20, 50, 80, 100].map((x) => (
        <text key={x} x={48 + x * 5.2} y="247" textAnchor="middle">
          {x}%
        </text>
      ))}
      {[20, 50, 80].map((x) => {
        const pointIndex = Math.max(1, Math.round((eligible.length * x) / 100));
        const q = points[pointIndex];
        const overlapping = [20, 50, 80].filter(
          (percent) =>
            Math.max(1, Math.round((eligible.length * percent) / 100)) ===
            pointIndex,
        );
        const hitOffset =
          (overlapping.indexOf(x) - overlapping.length / 2) * 20;
        return (
          q && (
            <g
              key={x}
              role="button"
              tabIndex="0"
              aria-label={`查看Top ${x}%经销商`}
              onClick={(event) => { event.stopPropagation(); onSelect(x); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(x);
                }
              }}
            >
              <rect
                x={48 + q.x * 5.2 + hitOffset}
                y={216 - Math.max(q.a, q.m) * 1.9}
                width="20"
                height={Math.abs(q.a - q.m) * 1.9 + 20}
                fill="transparent"
                pointerEvents="all"
              />
              <line x1={48 + q.x * 5.2} x2={48 + q.x * 5.2} y1="36" y2="226" stroke="#9aaebb" strokeDasharray="3 3" pointerEvents="none" />
              <text className="v19-top-label" x={48 + q.x * 5.2} y={32 - overlapping.indexOf(x) * 15} textAnchor="middle">Top {x}%</text>
              {x === top && <><text className="v19-chart-value investment" x={Math.min(450, 58 + q.x * 5.2)} y={Math.max(48, 218 - q.a * 1.9)}>投资 {pct(q.a)}</text><text className="v19-chart-value output" x={Math.min(450, 58 + q.x * 5.2)} y={Math.min(220, 242 - q.m * 1.9)}>{basis === "vol" ? "Vol" : "C3"} {pct(q.m)}</text></>}
              <circle
                cx={48 + q.x * 5.2}
                cy={226 - q.a * 1.9}
                r="6"
                fill="#E0A800"
                stroke="white"
                strokeWidth="2"
                pointerEvents="none"
              />
              <circle
                cx={48 + q.x * 5.2}
                cy={226 - q.m * 1.9}
                r="5"
                fill="#595959"
                stroke="white"
                strokeWidth="2"
                pointerEvents="none"
              />
            </g>
          )
        );
      })}
      <text x="310" y="272" textAnchor="middle">
        经销商（按投入从高到低）累计占比 →
      </text>
      </g>
    </svg>
  );
}

export function V19Health({
  items,
  dealers,
  mode,
  thresholds = {},
  ytdCutoffMonth = 10,
  budgetReasons = [],
}) {
  const { initiativeColor, resourceColor } = useLegendColors();
  const [period, setPeriod] = useState("2025"),
    [basis, setBasis] = useState("c3"),
    [top, setTop] = useState(20),
    [detail, setDetail] = useState(null);
  const rows = portfolioRows(items, dealers, basis, period),
    result = concentration(rows, top),
    label = basis === "c3" ? "C3" : "Delivery Vol";
  const groups = (
    mode === "exec"
      ? orderedResourceTypes(items.map((i) => i.resourceType)).map((type) => ({
          id: type,
          name: type,
          resourceType: type,
          items: items.filter((i) => i.resourceType === type),
        }))
      : items.map((i) => ({ ...i, items: [i] }))
  )
    .map((group) => ({
      ...group,
      stats: concentration(
        portfolioRows(group.items, dealers, basis, period),
        top,
      ),
    }))
    .sort((a, b) => (b.stats?.gap || 0) - (a.stats?.gap || 0));
  const openTop = (value) => {
    setTop(value);
    const result = concentration(rows, value);
    if (result)
      setDetail({
        type: "cohort",
        scopeDealerKeys: result.top.map((row) => row.key),
        title: `Top ${value}% 集中度明细`,
        period,
        basis,
      });
  };
  return (
    <>
      <Card className="v19-board-section">
        <Heading
          title={
            mode === "exec"
              ? "集中度 · 各资源大类的投资是否集中在少数经销商"
              : "健康检查 · 投资分布与产出是否匹配"
          }
          description="对照历史产出，查看需要解释的投资分布"
        />
        <div className="v19-board-body">
          <HistoryControls
            {...{ period, setPeriod, basis, setBasis, ytdCutoffMonth }}
          />
          <div className="v19-subpanel">
            <div className="v19-subpanel-heading">
              <h3><span className="v20-section-number">1</span> 集中度 · 投资是否集中在少数经销商 <MetricHelp>经销商按投资金额从高到低排序，对比前20%、50%、80%获得的投资与贡献的历史产出。仅有有效历史产出的经销商参与比较；差值以百分点表示。</MetricHelp></h3>
              <Tabs
                value={String(top)}
                onValueChange={(v) => setTop(Number(v))}
              >
                <TabsList>
                  {[20, 50, 80].map((x) => (
                    <TabsTrigger key={x} value={String(x)}>
                      Top {x}%
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            {result ? (
              <>
                <p className="v19-concentration-statement">
                  {mode === "owner" ? "本人整体" : "当前范围"}：投资金额最多的{" "}
                  {top}% 经销商（{result.n} 家）获得{" "}
                  <b className="v19-investment-emphasis">{pct(result.amountShare)}</b> 的投资金额，贡献{" "}
                  <b className="v19-output-emphasis">{pct(result.metricShare)}</b> 的{label}
                </p>
                <Badge
                  variant={
                    result.gap > (thresholds.concentrationRed ?? 10)
                      ? "destructive"
                      : "secondary"
                  }
                >
                  投入比产出集中 {pp(result.gap)} ·{" "}
                  {result.gap > (thresholds.concentrationRed ?? 10)
                    ? "优先关注"
                    : result.gap > (thresholds.concentrationYellow ?? 5)
                      ? "建议复核"
                      : "与产出基本匹配"}
                </Badge>
                <small className="v19-denominator">
                  分母：名单内有历史的 {result.count} 家
                </small>
              </>
            ) : (
              <p className="empty">暂无可比较的历史产出。</p>
            )}
            <div className="v19-concentration-grid">
              <div>
                <CumulativeChart
                  rows={rows}
                  top={top}
                  basis={basis}
                  onSelect={openTop}
                />
                <div className="v19-chart-legend">
                  <span>
                    <Dot color="#E0A800" />
                    投资金额累计占比
                  </span>
                  <span>
                    <Dot color="#595959" />
                    {label} 的累计占比
                  </span>
                  <span>┄ 平均分配</span>
                </div>
                <p className="v19-chart-footnote">
                  两条线之间的阴影越大 = 投资比产出更集中
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>投资金额最多的</TableHead>
                      <TableHead>家数</TableHead>
                      <TableHead>获得投资</TableHead>
                      <TableHead>贡献 {label}</TableHead>
                      <TableHead>差值</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[20, 50, 80].map((x) => {
                      const r = concentration(rows, x);
                      return (
                        <TableRow key={x}>
                          <TableCell>
                            <Button variant="link" onClick={() => openTop(x)}>
                              Top {x}%
                            </Button>
                          </TableCell>
                          <TableCell>{r?.n ?? "—"}</TableCell>
                          <TableCell sortValue={r?.amountShare}>{pct(r?.amountShare)}</TableCell>
                          <TableCell sortValue={r?.metricShare}>{pct(r?.metricShare)}</TableCell>
                          <TableCell sortValue={r?.gap}>{pp(r?.gap)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div>
                <h3>
                  {mode === "exec"
                    ? "哪个资源大类最集中"
                    : "哪个 Initiative 最集中"}
                  {groups.filter((group) => group.stats?.gap > (thresholds.concentrationRed ?? 10)).length > 0 && <Badge variant="destructive" className="v19-concentration-flag">● {groups.filter((group) => group.stats?.gap > (thresholds.concentrationRed ?? 10)).length} 个 &gt;{thresholds.concentrationRed ?? 10}pp</Badge>}
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {mode === "exec" ? "资源大类" : "Initiative"}
                      </TableHead>
                      {mode === "department" && <TableHead>资源大类</TableHead>}
                      <TableHead>名单</TableHead>
                      <TableHead>
                        Top {top}%：● 投资金额 vs ○ {label}
                      </TableHead>
                      <TableHead>差值</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((group, index) => (
                      <TableRow key={group.id}>
                        <TableCell>
                          <Dot
                            color={
                              mode === "exec"
                                ? resourceColor(group.resourceType)
                                : initiativeColor(group, index)
                            }
                          />
                          <Button
                            variant="link"
                            onClick={() =>
                              setDetail(
                                mode === "exec"
                                  ? {
                                      type: "resource",
                                      resourceType: group.resourceType,
                                      period,
                                      basis,
                                    }
                                  : {
                                      type: "initiative",
                                      initiativeId: group.id,
                                      period,
                                      basis,
                                    },
                              )
                            }
                          >
                            {group.name}
                          </Button>
                          <small>
                            {mode === "owner" ? group.resourceType : ""}
                          </small>
                        </TableCell>
                        {mode === "department" && (
                          <TableCell>{group.resourceType}</TableCell>
                        )}
                        <TableCell>
                          {group.stats?.count ?? 0} 家
                          <small>Top {group.stats?.n ?? 0} 家</small>
                        </TableCell>
                        <TableCell sortValue={group.stats?.amountShare}>
                          <div className="v19-dumbbell">
                            <i
                              style={{
                                left: `${Math.min(group.stats?.amountShare || 0, group.stats?.metricShare || 0)}%`,
                                width: `${Math.abs((group.stats?.amountShare || 0) - (group.stats?.metricShare || 0))}%`,
                              }}
                            />
                            <b
                              style={{
                                left: `${group.stats?.amountShare || 0}%`,
                              }}
                            />
                            <em
                              style={{
                                left: `${group.stats?.metricShare || 0}%`,
                              }}
                            />
                          </div>
                          <small>
                            {pct(group.stats?.amountShare)} vs{" "}
                            {pct(group.stats?.metricShare)}
                          </small>
                        </TableCell>
                        <TableCell
                          className={
                            (group.stats?.gap || 0) >
                            (thresholds.concentrationRed ?? 10)
                              ? "negative"
                              : ""
                          }
                         sortValue={group.stats?.gap}>
                          {pp(group.stats?.gap)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
          {mode !== "exec" && <V19Stack items={items} dealers={dealers} thresholds={thresholds} ytdCutoffMonth={ytdCutoffMonth} budgetReasons={budgetReasons} embedded />}
        </div>
        {detail && (
          <ResourceDetailDrawer
            detail={detail}
            items={items}
            dealers={dealers}
            ytdCutoffMonth={ytdCutoffMonth}
            budgetReasons={budgetReasons}
            onClose={() => setDetail(null)}
          />
        )}
      </Card>
    </>
  );
}

export function V19Stack({
  items,
  dealers,
  thresholds = {},
  ytdCutoffMonth = 10,
  embedded = false,
  budgetReasons = [],
}) {
  const { resourceColor } = useLegendColors();
  const [period, setPeriod] = useState("2025"),
    [basis, setBasis] = useState("c3"),
    [direction, setDirection] = useState("over"),
    [all, setAll] = useState(false),
    [selected, setSelected] = useState(null),
    [sort, setSort] = useState(null),
    [search, setSearch] = useState("");
  const rows = dealerDetailRows(items, dealers, basis, period),
    deviations = dealerDeviations(rows),
    over = deviations.filter((r) => r.gap > (thresholds.dealerYellow ?? 3)),
    label = basis === "c3" ? "C3" : "Delivery Vol";
  const expenses = EXPENSE_COLUMN_ORDER.filter(type => rows.some(row => Object.hasOwn(row.resources, type)));
  const columns = allocationColumnGroups(expenses)
    .filter(group => group.key !== "support")
    .flatMap(group => group.columns)
    .flatMap(column => column[0] === "amount" ? [column, ["mix", "资源大类构成"]] : [column])
    .map(([key, label]) => [key, key === "gapC3" ? "投资金额 − C3" : key === "gapVol" ? "投资金额 − Delivery Vol" : label]);
  const basisGap = basis === "c3" ? "gapC3" : "gapVol";
  const ranked = rows.filter(row => row[basisGap] != null)
    .sort((a, b) => (direction === "over" ? b[basisGap] - a[basisGap] : a[basisGap] - b[basisGap]) || a.key.localeCompare(b.key));
  const ordered = all ? [...ranked, ...rows.filter(row => row[basisGap] == null)] : ranked;
  const read = (row, field) => field.startsWith("expense:") ? row.resources[field.slice(8)]
    : field === "mix" ? typesForSort(row) : row[field];
  function typesForSort(row) { return row.initiativeSources.map(source => items.find(item => String(item.id) === source.id)?.resourceType || "").sort().join("、"); }
  const sorted = sort ? [...ordered].sort((a,b) => {
    const x = read(a, sort.field), y = read(b, sort.field);
    if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
    return (typeof x === "number" && typeof y === "number" ? x-y : String(x).localeCompare(String(y), "zh-CN")) * (sort.asc ? 1 : -1) || String(a.key).localeCompare(String(b.key));
  }) : ordered;
  const matching = sorted.filter(row => `${row.name} ${row.code} ${row.sector} ${row.sd} ${row.rsm}`.toLowerCase().includes(search.trim().toLowerCase()));
  const list = matching.slice(0, all ? undefined : 10),
    max = Math.max(3, ...rows.flatMap(row => [row.gapC3, row.gapVol]).filter(value => value != null).map(Math.abs));
  const format = (value, field) => {
    if (value == null || (field === "yield" && value <= 0)) return "—";
    if (["amountShare", "volShare", "c3Share", "contractShare", "phasing", "investmentShare"].includes(field)) return pct(value);
    if (field === "amount") return n(value / 10000, 2);
    if (["contract", "vol", "c3", "investment"].includes(field) || field.startsWith("expense:")) return n(value / 1000, 2);
    return typeof value === "number" ? n(value, 2) : value || "—";
  };
  const types = orderedResourceTypes(items.map((i) => i.resourceType)),
    distribution = (set, type) =>
      set.reduce(
        (sum, row) =>
          sum +
          row.initiativeSources
            .filter(
              (s) =>
                items.find((i) => String(i.id) === s.id)?.resourceType === type,
            )
            .reduce((a, s) => a + s.amount, 0),
        0,
      ),
    total = rows.reduce((s, r) => s + r.amount, 0),
    overTotal = over.reduce((s, r) => s + r.amount, 0);
  const Wrapper = embedded ? "section" : Card;
  return (
    <Wrapper className={embedded ? "v19-subpanel v20-stack-module" : "v19-board-section"}>
      {embedded ? <div className="v19-subpanel-heading"><h3><span className="v20-section-number">2</span> 叠加后 · 哪些经销商投资占比高于贡献 <MetricHelp>比较经销商投资占比与所选历史产出占比，按阈值识别偏离。</MetricHelp></h3><Badge variant="secondary" className="v20-over-badge">{over.length} 家超配 &gt;{thresholds.dealerYellow ?? 3}pp</Badge></div> : <Heading
        title="叠加后 · 哪些经销商投资占比高于贡献"
        description={`投资金额占比与历史 ${label} 占比对照`}
      >
        <Badge variant="secondary" className="v20-over-badge">
          {over.length} 家超配 &gt;{thresholds.dealerYellow ?? 3}pp
        </Badge>
      </Heading>}
      <div className={embedded ? "v20-stack-module-body" : "v19-board-body"}>
        <HistoryControls
          {...{ period, setPeriod, basis, setBasis, ytdCutoffMonth }}
        />
        <div className="v20-stack-overview">
          <div className="v20-stack-conclusion">
            <h3>叠加分析结论（可比较名单） <MetricHelp>仅比较有当前期间历史产出的经销商；投资占比与产出占比按可比较名单分别计算，缺少历史的经销商不纳入差值判断。</MetricHelp></h3>
            <p>叠加后 <strong>{over.length} 家</strong>经销商的投资占比比其 {label} 占比高出 {thresholds.dealerYellow ?? 3}pp 以上；合计获得 <b>{pct(over.reduce((sum,r)=>sum+r.amountShare,0))}</b> 的可比较投资，贡献 <b>{pct(over.reduce((sum,r)=>sum+r.metricShare,0))}</b> 的 {label}。</p>
            <p>另有 {deviations.filter(r => r.gap < -(thresholds.dealerYellow ?? 3)).length} 家投资占比低于贡献 {thresholds.dealerYellow ?? 3}pp 以上。</p>
            <small>无有效历史：{rows.length - deviations.length} 家，不参与比较。资源构成图按对应名单的投资金额计算。</small>
          </div>
          <div className="v20-stack-distributions" aria-label="投资资源大类构成对比">
            {[ [over, overTotal, over.length, "超配部分"], [rows, total, rows.length, "全部名单"] ].map(([set, sum, count, title]) => {
              let cursor = 0;
              const segments = types.map(type => { const start=cursor; cursor += sum > 0 ? distribution(set,type)/sum*100 : 0; return `${resourceColor(type)} ${start}% ${cursor}%`; });
              return <div className="v20-stack-donut-wrap" key={title}><div className="v20-stack-donut" style={{background: sum > 0 ? `conic-gradient(${segments.join(",")})` : "#dce5eb"}} role="img" aria-label={`${title} ${count} 家，按投资金额展示资源大类构成`}><div><strong>{count} 家</strong><small>{title}</small></div></div></div>;
            })}
            <div className="v20-stack-legend">{types.map(type=><div key={type}><Dot color={resourceColor(type)} /><Button variant="link" onClick={()=>setSelected({type:"resource",resourceType:type,period,basis})}>{type}</Button><span>{pct(overTotal ? distribution(over,type)/overTotal*100 : null)} vs {pct(total ? distribution(rows,type)/total*100 : null)}</span></div>)}<small>超配部分 vs 全部名单</small></div>
          </div>
        </div>
        <div className="v19-subpanel-heading">
          <Tabs value={direction} onValueChange={(v) => { setDirection(v); setSort(null); }}>
            <TabsList>
              <TabsTrigger value="over">投资占比高于贡献 Top 10</TabsTrigger>
              <TabsTrigger value="under">投资占比低于贡献 Top 10</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={() => setAll((x) => !x)}>
            {all ? "收起" : `查看全部 ${rows.length} 家 →`}
          </Button>
        </div>
        <div className="v20-stack-table-tools">
          <Input aria-label="搜索叠加经销商" value={search} onChange={event => { setSearch(event.target.value); setAll(true); }} placeholder="经销商 / 编码 / Sector / SD / RSM" />
          <small>表格投资占比按完整名单、历史占比按各指标有效名单计算，与上方仅含可比较名单的结论口径不同；搜索和排序不改变分母，无有效历史的差值显示 —。共 {rows.length} 家，当前显示 {list.length} 家。</small>
        </div>
        <Table sortingMode="manual" className="v20-stack-table" containerClassName={all ? "v20-stack-scroll v20-stack-scroll-all" : "v20-stack-scroll"}>
          <TableHeader><TableRow>
            {columns.map(([field,label]) => <TableHead key={field} data-column={field} aria-sort={sort?.field === field ? (sort.asc ? "ascending" : "descending") : "none"}><Button variant="ghost" className="v20-stack-sort" onClick={() => setSort(prev => ({field,asc:prev?.field === field ? !prev.asc : true}))}>{label} <span aria-hidden="true">{sort?.field === field ? (sort.asc ? "↑" : "↓") : "↕"}</span></Button></TableHead>)}
          </TableRow></TableHeader>
          <TableBody>
            {list.map(row => (
              <TableRow key={row.key}>
                {columns.map(([field]) => {
                  const value = read(row, field);
                  return <TableCell key={field} data-column={field} className={!["name", "sd", "rsm", "mix"].includes(field) ? "num" : undefined} sortValue={value}>
                    {field === "name" ? <><DealerDetailButton variant="link" onClick={() => setSelected({type:"dealer", dealerKey:row.key, period, basis})}>{row.name}</DealerDetailButton><small>{row.code} · {row.sector}</small></>
                    : field === "mix" ? <div className="v19-stack-bar">{types.map(type => <span key={type} title={`${type} ${wan(distribution([row], type))}`} style={{background:resourceColor(type),width:`${row.amount ? distribution([row], type) / row.amount * 100 : 0}%`}} />)}</div>
                    : field === "gapC3" || field === "gapVol" ? value == null ? "—" : <div className="v19-diverging"><i style={{left:`${value < 0 ? 50 + value / max * 45 : 50}%`,width:`${Math.abs(value) / max * 45}%`,background:value > 0 ? "#EB8705" : "#89CFDC"}} /><span>{pp(value)}</span></div>
                    : format(value, field)}
                  </TableCell>;
                })}
              </TableRow>
            ))}
            {!list.length && <TableRow><TableCell colSpan={columns.length} className="empty">{all ? "没有符合条件的经销商" : "当前期间没有可比较的经销商，可查看全部名单"}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {selected && (
        <ResourceDetailDrawer
          detail={selected}
          items={items}
          dealers={dealers}
          ytdCutoffMonth={ytdCutoffMonth}
          budgetReasons={budgetReasons}
          onClose={() => setSelected(null)}
        />
      )}
    </Wrapper>
  );
}

export function V19Destination({
  items,
  dealers = [],
  mode,
  ytdCutoffMonth = 10,
  budgetReasons = [],
}) {
  const { initiativeColor, resourceColor } = useLegendColors();
  const [detail, setDetail] = useState(null);
  const total = E.totals(items),
    funded = new Set(
      items.flatMap((item) =>
        (item.rows || [])
          .filter((row) => row.amount > 0)
          .map((row) => `${item.sector}:${row.dealerId}`),
      ),
    ).size;
  return (
    <Card className="v19-board-section">
      <Heading
        title="投资分配去向"
        description="按 Initiative 查看预算、预留和拆分进度"
      />
      <div className="v19-board-body">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Initiative</TableHead>
              <TableHead>资源大类</TableHead>
              <TableHead className="num">预算（万元）</TableHead>
              <TableHead className="num">已分配</TableHead>
              <TableHead className="num">预留</TableHead>
              <TableHead className="num">待分配</TableHead>
              <TableHead>结构</TableHead>
              <TableHead>获配经销商</TableHead>
              <TableHead>拆分依据</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...items]
              .sort((a, b) => b.budget - a.budget)
              .map((i, index) => {
                const t = E.totals([i]);
                return (
                  <TableRow key={i.id}>
                    <TableCell>
                      <Dot color={initiativeColor(i, index)} />
                      <Button
                        variant="link"
                        onClick={() =>
                          setDetail({ type: "initiative", initiativeId: i.id })
                        }
                      >
                        {i.name}
                      </Button>
                      {mode === "owner" && (
                        <small>{i.ownerName || i.ownerId}</small>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="link"
                        onClick={() =>
                          setDetail({
                            type: "resource",
                            resourceType: i.resourceType,
                          })
                        }
                      >
                        {i.resourceType}
                      </Button>
                    </TableCell>
                    <TableCell className="num" sortValue={i.budget / 10000}>{n(i.budget / 10000)}</TableCell>
                    <TableCell className="num" sortValue={t.allocated / 10000}>
                      {n(t.allocated / 10000)}
                    </TableCell>
                    <TableCell className="num" sortValue={t.otherBudget / 10000}>
                      {n(t.otherBudget / 10000)}
                    </TableCell>
                    <TableCell className="num">
                      {t.gap ? n(Math.max(0, t.gap) / 10000) : "—"}
                    </TableCell>
                    <TableCell sortValue={t.budget ? t.allocated / t.budget : null}>
                      <AllocationBar total={t} />
                    </TableCell>
                    <TableCell>
                      {(i.rows || []).filter((r) => r.amount > 0).length} 家
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" className="v20-rationale-chip" onClick={() => setDetail({ type: "rationale", initiativeId: i.id })}>
                        查看拆分依据 →
                      </Button>
                    </TableCell>
                    <TableCell>
                      {i.workflow?.submitted ? "已提交" : "草稿"}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableHead colSpan={2}>合计</TableHead>
              <TableCell className="num" sortValue={total.budget / 10000}>{n(total.budget / 10000)}</TableCell>
              <TableCell className="num" sortValue={total.allocated / 10000}>
                {n(total.allocated / 10000)}
              </TableCell>
              <TableCell className="num" sortValue={total.otherBudget / 10000}>
                {n(total.otherBudget / 10000)}
              </TableCell>
              <TableCell className="num" sortValue={Math.max(0, total.gap) / 10000}>
                {n(Math.max(0, total.gap) / 10000)}
              </TableCell>
              <TableCell>
                <AllocationBar total={total} />
              </TableCell>
              <TableCell>{funded} 家</TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableFooter>
        </Table>
        <div className="v19-chart-legend">
          <span>
            <Dot color="#FBCE07" />
            已分配
          </span>
          <span>
            <Dot color="#7F7F7F" />
            预留
          </span>
          <span>
            <Dot color="#FFE680" />
            待分配
          </span>
        </div>
      </div>
      {detail && (
        <ResourceDetailDrawer
          detail={detail}
          items={items}
          dealers={dealers}
          ytdCutoffMonth={ytdCutoffMonth}
          budgetReasons={budgetReasons}
          onClose={() => setDetail(null)}
        />
      )}
    </Card>
  );
}
