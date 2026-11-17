import { DealerDetailButton, useDealerDetailAccess } from "../DealerDetailAccess";
import { InitiativeLabel, useLegendColors } from "../LegendColors";
import { HistoryPeriodTabs } from "./HistoryPeriodTabs";
import { AnalysisConclusion, AnalysisValue } from "./AnalysisConclusion";
import { MetricHelp } from "./MetricHelp";
import {
  COHORT_DIMENSIONS,
  cohortContributionParts,
  cohortSectorColor,
  defaultCohortDimension,
  type CohortDimension,
  type CohortFilteredDimension,
  type CohortContribution,
} from "../domain/cohort-dimensions";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableFooter,
} from "@/components/ui/table";
import {
  historyInvestment,
  aggregateHistoryPhasing,
  historyYield,
  finiteHistoryValue,
  type HistoryDealer,
  type HistoryPeriod,
  type DealerHistory,
} from "../domain/dealer-history";
import {
  portfolioRows,
  concentration,
  groupSummary,
  analyticalOutput,
} from "../domain/portfolio-analytics.js";
import {
  ResourceMixDonut,
  DetailConcentrationCurve,
  InitiativeContributionBar,
  CohortContributionBar,
} from "./ResourceDetailCharts";
import "../resource-detail.css";

type Allocation = {
  dealerId: string;
  amount: number;
  note?: string;
  sd?: string;
  rsm?: string;
};
export type DetailInitiative = {
  id: string;
  initiativeKey?: string;
  name: string;
  sector?: string;
  department?: string;
  resourceType?: string;
  ownerId?: string;
  ownerName?: string;
  budget?: number;
  rows?: Allocation[];
  selected?: string[];
  otherBudgets?: {
    id?: string;
    reasonId?: string;
    note?: string;
    amount: number;
  }[];
  changeReason?: string;
  allocationMethod?: string;
  method?: string;
  allocationVisible?: boolean;
  workflow?: { submitted?: boolean; confirmed?: boolean };
};
export type ResourceDetail = {
  type:
    | "dealer"
    | "initiative"
    | "resource"
    | "organization"
    | "rationale"
    | "cohort";
  dealerKey?: string;
  dealerId?: string;
  sector?: string;
  initiativeId?: string;
  resourceType?: string;
  groupBy?: "sd" | "rsm";
  groupKey?: string;
  period?: HistoryPeriod;
  basis?: "vol" | "c3";
  title?: string;
  scopeDealerKeys?: string[];
  scopeInitiativeIds?: string[];
  directoryOnly?: boolean;
  topPercent?: number;
  cohortDimensions?: boolean;
  cohortFilteredDimensions?: CohortFilteredDimension[];
};
type Props = {
  detail: ResourceDetail;
  items: DetailInitiative[];
  dealers: HistoryDealer[];
  sourceItems?: DetailInitiative[] | null;
  ytdCutoffMonth?: number | null;
  budgetReasons?: { id: string; label: string }[];
  onClose: () => void;
};
const expenses = ["ICE Rebate", "MRD", "SP&A", "Capex"];
const n = (value: unknown, scale = 1) =>
  finiteHistoryValue(value) == null
    ? "—"
    : (Number(value) / scale).toLocaleString("zh-CN", {
        maximumFractionDigits: 2,
      });
const percent = (value: number | null) =>
  value == null ? "—" : `${n(value)}%`;
const share = (value: number | null, total: number | null) =>
  value != null && total != null && total > 0 ? (value / total) * 100 : null;
const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);
const completeSum = (values: unknown[]) =>
  values.length && values.every((value) => finiteHistoryValue(value) != null)
    ? sum(values.map(Number))
    : null;

/** Only caller-supplied, allocation-visible items can enter any nested detail. */
export function detailScope(
  detail: ResourceDetail,
  items: DetailInitiative[],
  dealers: HistoryDealer[],
  period: HistoryPeriod,
  basis: "vol" | "c3",
) {
  let scopedItems = items.filter((item) => item.allocationVisible !== false);
  if (detail.scopeInitiativeIds)
    scopedItems = scopedItems.filter((item) =>
      detail.scopeInitiativeIds!.includes(String(item.id)),
    );
  if (detail.type === "initiative" || detail.type === "rationale")
    scopedItems = scopedItems.filter(
      (item) => String(item.id) === String(detail.initiativeId),
    );
  if (detail.type === "resource")
    scopedItems = scopedItems.filter(
      (item) => item.resourceType === detail.resourceType,
    );
  let rows = portfolioRows(scopedItems, dealers, basis, period);
  if (detail.type === "cohort" && detail.topPercent != null)
    rows = concentration(rows, detail.topPercent)?.top || [];
  else if (detail.scopeDealerKeys)
    rows = rows.filter((row) => detail.scopeDealerKeys!.includes(row.key));
  if (detail.type === "organization")
    rows = rows.filter(
      (row) => row[detail.groupBy || "sd"] === detail.groupKey,
    );
  if (detail.type === "dealer")
    rows = rows.filter((row) =>
      detail.dealerKey
        ? row.key === detail.dealerKey
        : String(row.id) === String(detail.dealerId) &&
          (!detail.sector || row.sector === detail.sector),
    );
  if (detail.type === "dealer" && detail.directoryOnly && !rows.length) {
    const matches = dealers.filter(
      (dealer) =>
        String(dealer.id) === String(detail.dealerId) &&
        dealer.sector === detail.sector,
    );
    if (matches.length === 1) {
      const dealer = matches[0];
      rows = portfolioRows(
        [
          {
            id: "directory-preview",
            name: "未纳入当前名单",
            sector: dealer.sector,
            rows: [{ dealerId: String(dealer.id), amount: 0 }],
          },
        ],
        matches,
        basis,
        period,
      ).map((row) => ({
        ...row,
        initiativeSources: [],
        outsideSelection: true,
      }));
    }
  }
  // A code without a sector is ambiguous; never merge different business identities into one dealer.
  if (detail.type === "dealer" && rows.length > 1) rows = [];
  return { items: scopedItems, rows };
}

export function nestedDetailRequest(
  current: ResourceDetail,
  next: ResourceDetail,
  scope: ReturnType<typeof detailScope>,
  period: HistoryPeriod,
  basis: "vol" | "c3",
): ResourceDetail {
  return {
    ...next,
    period,
    basis,
    scopeInitiativeIds: scope.items.map((item) => String(item.id)),
    scopeDealerKeys: ["organization", "cohort", "resource", "dealer"].includes(
      current.type,
    )
      ? scope.rows.map((row) => row.key)
      : current.scopeDealerKeys,
  };
}

export function historicalDetailTotals(
  rows: { history: DealerHistory }[],
  period: HistoryPeriod,
) {
  const suffix = period === "2025" ? "2025" : "2026Ytd";
  const vol = completeSum(rows.map((row) => row.history[`vol${suffix}`]));
  const c3 = completeSum(rows.map((row) => row.history[`c3${suffix}`]));
  const investment = completeSum(
    rows.map((row) => historyInvestment(row.history, period)),
  );
  const contract = completeSum(
    rows.map((row) => row.history[`contract${suffix}`]),
  );
  const aligned =
    period === "2025" ||
    rows.every((row) => !row.history.ytdYieldUnavailableReason);
  return {
    vol,
    c3,
    investment,
    contract,
    phasing: aggregateHistoryPhasing(
      rows.map((row) => row.history),
      period,
    ).ratio,
    yield:
      aligned && c3 != null && c3 > 0 && investment != null && investment > 0
        ? c3 / investment
        : null,
    aligned,
  };
}

export function reserveReasonLabel(
  reasons: { id: string; label: string }[],
  id?: string,
) {
  return (
    reasons.find((item) => item.id === id)?.label ||
    (id ? `未识别的原因码：${id}` : "原因缺失")
  );
}

export function ResourceDetailDrawer(props: Props) {
  const allowed = useDealerDetailAccess();
  if (props.detail.type === "dealer" && !allowed) return null;
  return <ResourceDetailContent {...props} />;
}

function ResourceDetailContent({
  detail,
  items,
  dealers,
  sourceItems,
  ytdCutoffMonth = 10,
  budgetReasons = [],
  onClose,
}: Props) {
  const {
    initiativeColor: detailInitiativeColor,
    resourceColor,
    departmentColor,
  } = useLegendColors();
  const [trail, setTrail] = useState<ResourceDetail[]>([detail]);
  const [period, setPeriod] = useState<HistoryPeriod>(detail.period || "2025");
  const [basis, setBasis] = useState<"vol" | "c3">(detail.basis || "c3");
  const [query, setQuery] = useState("");
  const [organizationBy, setOrganizationBy] = useState<"sd" | "rsm">("sd");
  const [cohortDimension, setCohortDimension] = useState<CohortDimension>(() =>
    defaultCohortDimension(detail.cohortFilteredDimensions),
  );
  const [width, setWidth] = useState(() => Math.round(window.innerWidth * 0.7));
  const previous = useRef(
    typeof document === "undefined"
      ? null
      : (document.activeElement as HTMLElement | null),
  );
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setTrail([detail]);
    setPeriod(detail.period || "2025");
    setBasis(detail.basis || "c3");
    setQuery("");
    setCohortDimension(defaultCohortDimension(detail.cohortFilteredDimensions));
  }, [detail]);
  const current = trail[trail.length - 1];
  const scope = useMemo(
    () => detailScope(current, items, dealers, period, basis),
    [current, items, dealers, period, basis],
  );
  const allRows = useMemo(
    () => portfolioRows(scope.items, dealers, basis, period),
    [scope.items, dealers, basis, period],
  );
  const rows = scope.rows,
    historical = historicalDetailTotals(rows, period),
    suffix = period === "2025" ? "2025" : "2026Ytd";
  const currentAmount = sum(rows.map((row) => row.amount)),
    allInvestment = completeSum(
      allRows.map((row) => historyInvestment(row.history, period)),
    );
  const single = rows[0],
    initiative = scope.items[0];
  const title =
    current.title ||
    (current.type === "dealer"
      ? single?.name
      : current.type === "initiative"
        ? initiative?.name
        : current.type === "rationale"
          ? `${initiative?.name || "Initiative"} · 拆分依据`
          : current.type === "resource"
            ? `${current.resourceType} · 资源构成`
            : `${(current.groupBy || "sd").toUpperCase()} · ${current.groupKey}`) ||
    "详情不可用";
  const canOpenDealer = useDealerDetailAccess();
  const open = (next: ResourceDetail) => {
    if (next.type === "dealer" && !canOpenDealer) return;
    setTrail((old) => [
      ...old,
      nestedDetailRequest(current, next, scope, period, basis),
    ]);
    setQuery("");
    content.current?.scrollTo({ top: 0 });
  };
  const back = () => {
    setTrail((old) => old.slice(0, -1));
    setQuery("");
  };
  const visible = rows.filter((row) =>
    `${row.code} ${row.name} ${row.sd} ${row.rsm}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  if (current.type !== "cohort" || current.topPercent == null)
    visible.sort((a, b) => b.amount - a.amount);
  const showCohortDimensions =
    current.type === "cohort" && current.cohortDimensions;
  const dimensionLabel = COHORT_DIMENSIONS.find(
    (dimension) => dimension.key === cohortDimension,
  )!.label;
  const dimensionColor = (part: CohortContribution) =>
    cohortDimension === "initiative"
      ? detailInitiativeColor(part)
      : cohortDimension === "resourceType"
        ? resourceColor(part.name)
        : cohortDimension === "department"
          ? departmentColor(part.name)
          : cohortSectorColor(part.name);
  const dimensionParts = (
    sources: { id: string; key?: string; name: string; amount: number }[],
  ) =>
    cohortContributionParts(sources, scope.items, cohortDimension).map(
      (part) => ({ ...part, color: dimensionColor(part) }),
    );
  const cohortLegend = dimensionParts(
    rows.flatMap((row) => row.initiativeSources),
  ).filter((part) => part.amount > 0);
  const allowedExpenses = expenses.filter((type) =>
    rows.some((row) =>
      Object.hasOwn(row.history[`resources${suffix}`] || {}, type),
    ),
  );
  const breakdown = expenses.map((type) => ({
    type,
    amount: sum(
      scope.items
        .filter((item) => item.resourceType === type)
        .flatMap((item) =>
          (item.rows || [])
            .filter((row) =>
              rows.some(
                (dealer) =>
                  dealer.id === String(row.dealerId) &&
                  dealer.sector === item.sector,
              ),
            )
            .map((row) => row.amount),
        ),
    ),
  }));
  const matchingItems = scope.items.filter((item) =>
    (item.rows || []).some((row) =>
      rows.some(
        (dealer) =>
          dealer.id === String(row.dealerId) && dealer.sector === item.sector,
      ),
    ),
  );
  const sourceAmount = (item: DetailInitiative) =>
    sum(
      (item.rows || [])
        .filter((row) =>
          rows.some(
            (dealer) =>
              dealer.id === String(row.dealerId) &&
              dealer.sector === item.sector,
          ),
        )
        .map((row) => row.amount),
    );
  const readExpense = (type: string) =>
    completeSum(rows.map((row) => row.history[`resources${suffix}`]?.[type]));
  const negativeExpenses = allowedExpenses.some(
    (type) => (readExpense(type) || 0) < 0,
  );
  const historyMixAvailable =
    allowedExpenses.length === expenses.length &&
    !negativeExpenses &&
    expenses.every((type) => readExpense(type) != null);
  const maxDealerAmount = Math.max(0, ...rows.map((row) => row.amount));
  const organizations = groupSummary(rows, dealers, organizationBy, period);
  const totalVol = completeSum(
    organizations.map((group) => group.analyticalVol),
  );
  const totalC3 = completeSum(organizations.map((group) => group.analyticalC3));
  const concentrationBase = allRows.filter(
    (row) => row.hasHistory !== false && finiteHistoryValue(row.metric) != null,
  );
  const cohortComparable = rows.filter(
    (row) => row.hasHistory !== false && finiteHistoryValue(row.metric) != null,
  );
  const cohortAmountShare = share(
    sum(cohortComparable.map((row) => row.amount)),
    sum(concentrationBase.map((row) => row.amount)),
  );
  const cohortMetricShare = share(
    sum(cohortComparable.map((row) => analyticalOutput(row.metric))),
    sum(concentrationBase.map((row) => analyticalOutput(row.metric))),
  );
  const cohortVolTotal = sum(
    concentrationBase.map((row) =>
      analyticalOutput(row.history[`vol${suffix}`]),
    ),
  );
  const cohortC3Total = sum(
    concentrationBase.map((row) =>
      analyticalOutput(row.history[`c3${suffix}`]),
    ),
  );
  const cohortInvestmentTotal = sum(concentrationBase.map((row) => row.amount));
  const cohortInitiativeCount = new Set(
    rows.flatMap((row) =>
      row.initiativeSources
        .filter((source: { amount: number }) => source.amount > 0)
        .map((source: { id: string }) => source.id),
    ),
  ).size;
  const reason = (id?: string) => reserveReasonLabel(budgetReasons, id);
  const resize = (value: number) => {
    const next = Math.max(580, Math.min(1480, window.innerWidth - 24, value));
    setWidth(next);
    try {
      localStorage.setItem("ResourceStudioDetailWidth", String(next));
    } catch {
      /* Preview storage may be unavailable. */
    }
  };
  const metrics = (
    <div className="resource-detail-metrics">
      {[
        [
          current.type === "cohort"
            ? "Top 名单本次投资（万元）"
            : "本次投资（万元）",
          n(currentAmount, 10000),
        ],
        [
          current.type === "cohort"
            ? "Top 名单历史投资（K$）"
            : "历史投资（K$）",
          n(historical.investment, 1000),
        ],
        [
          current.type === "cohort" ? "Top 名单历史 Yield" : "Yield",
          n(historical.yield),
        ],
        [
          current.type === "cohort" ? "Top 名单历史投资占比" : "历史投资占比",
          single?.outsideSelection
            ? "未勾选"
            : percent(share(historical.investment, allInvestment)),
        ],
      ].map(([label, value]) => (
        <Card key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          {current.type === "cohort" && label.includes("历史") && (
            <small>
              {period === "2025" ? "2025 全年" : "2026 YTD"}
              {label.includes("占比") && (
                <MetricHelp>
                  分子为此 Top
                  名单的历史投资，分母为当前调用范围内全部勾选经销商的同期历史投资；历史投资按经销商
                  Sector 身份去重，缺失时保留
                  —。此分母与集中度使用的可比较历史名单不同。
                </MetricHelp>
              )}
              {label.includes("Yield") && (
                <MetricHelp>
                  此 Top 名单历史 C3 合计 ÷ 同期完整历史投资合计；两项均为
                  USD，正数且期间一致时才计算。
                </MetricHelp>
              )}
            </small>
          )}
        </Card>
      ))}
    </div>
  );
  const historyTable = (
    <section className="resource-detail-section">
      <h3>历史表现 · {period === "2025" ? "2025 全年" : "2026 YTD"}</h3>
      <div className="resource-history-grid">
        {[
          ["经销商 target（KL）", n(historical.contract, 1000)],
          ["Delivery Vol（KL）", n(historical.vol, 1000)],
          ["Actual C3（K$）", n(historical.c3, 1000)],
          [
            "Phasing",
            percent(
              historical.phasing == null ? null : historical.phasing * 100,
            ),
          ],
          ["历史投资总额（K$）", n(historical.investment, 1000)],
          ["Yield（C3 ÷ 历史投资）", n(historical.yield)],
          ...allowedExpenses.map((type) => [
            `${type}（K$）`,
            n(readExpense(type), 1000),
          ]),
        ].map(([label, value]) => (
          <div className="resource-history-cell" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p className="resource-detail-note">
        历史投资总额、Yield、历史投资占比公开；费用明细只使用接口已授权返回的大类。负费用正常计入净额。Phasing
        直接读取源表对应年份的结果，1 表示 100%；单家直接展示源值，多家按同年源 target 加权。仅纳入同年源 target 大于 0 且源 Phasing 有值的经销商，结果仅代表有效数据范围；无有效数据时汇总显示 —。
        {!historical.aligned
          ? "Actual 与历史费用覆盖不一致或未知，暂不计算 Yield。"
          : ""}
      </p>
    </section>
  );
  const sources = (
    <section className="resource-detail-section">
      <h3>投资来源与逐家说明</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Initiative</TableHead>
            <TableHead>资源大类 / Owner</TableHead>
            <TableHead className="num">投资（万元）</TableHead>
            <TableHead>说明</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {matchingItems.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <Button
                  variant="link"
                  onClick={() =>
                    open({ type: "initiative", initiativeId: item.id })
                  }
                >
                  {item.name}
                </Button>
              </TableCell>
              <TableCell>
                <Button
                  variant="link"
                  onClick={() =>
                    open({ type: "resource", resourceType: item.resourceType })
                  }
                >
                  {item.resourceType}
                </Button>{" "}
                / {item.ownerName || item.ownerId || "—"}
              </TableCell>
              <TableCell className="num" sortValue={sourceAmount(item)}>
                {n(sourceAmount(item), 10000)}
              </TableCell>
              <TableCell>
                {(item.rows || [])
                  .filter((row) =>
                    rows.some(
                      (dealer) =>
                        dealer.id === String(row.dealerId) &&
                        dealer.sector === item.sector,
                    ),
                  )
                  .map((row) => row.note)
                  .filter(Boolean)
                  .join("；") ||
                  item.changeReason ||
                  "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="resource-detail-note">
        仅当前调用页面传入的组合；不加载其他 Owner 或未确认的方案。
      </p>
    </section>
  );
  const dealerHistoryCell = (
    row: (typeof rows)[number],
    metric: "vol" | "c3",
  ) => (
    <TableCell className="num" sortValue={row.history[`${metric}${suffix}`]}>
      {n(row.history[`${metric}${suffix}`], 1000)}
      {current.type === "cohort" && (
        <small>
          占{" "}
          {percent(
            finiteHistoryValue(row.history[`${metric}${suffix}`]) == null
              ? null
              : share(
                  analyticalOutput(row.history[`${metric}${suffix}`]),
                  metric === "vol" ? cohortVolTotal : cohortC3Total,
                ),
          )}
        </small>
      )}
    </TableCell>
  );
  const dealerTable = (
    <section className="resource-detail-section">
      {current.type === "cohort" && (
        <AnalysisConclusion
          title="集中度分析结论"
          className="resource-detail-cohort-summary"
        >
          <p>
            {current.topPercent != null ? (
              <>
                按本次投资排序的前 <b>{current.topPercent}%</b> 经销商
              </>
            ) : (
              "当前 Top 经销商名单"
            )}
            （<AnalysisValue tone="neutral">{rows.length} 家</AnalysisValue>
            ）获得{" "}
            <AnalysisValue tone="investment">
              {percent(cohortAmountShare)}
            </AnalysisValue>{" "}
            的投资金额，贡献{" "}
            <AnalysisValue tone="output">
              {percent(cohortMetricShare)}
            </AnalysisValue>{" "}
            的{basis === "vol" ? "Delivery Vol" : "C3"}。
          </p>
          <p className="resource-detail-note">
            历史参考：{period === "2025" ? "2025 全年" : "2026 YTD"}
            ；投资及产出占比的分母均为当前曲线范围内有可比较历史的{" "}
            {concentrationBase.length} 家经销商。
            {showCohortDimensions &&
              "切换下方维度仅改变投资构成分组，不改变名单与合计。"}
          </p>
        </AnalysisConclusion>
      )}
      {showCohortDimensions && (
        <div className="resource-cohort-dimensions">
          <Tabs
            value={cohortDimension}
            onValueChange={(value) =>
              setCohortDimension(value as CohortDimension)
            }
          >
            <TabsList aria-label="集中度投资构成维度">
              {COHORT_DIMENSIONS.map((dimension) => {
                const filtered =
                  dimension.key !== "initiative" &&
                  current.cohortFilteredDimensions?.includes(dimension.key);
                return (
                  <TabsTrigger
                    key={dimension.key}
                    value={dimension.key}
                    disabled={filtered}
                    title={filtered ? "上方已按此维度筛选" : undefined}
                  >
                    {dimension.label}
                    {filtered ? " · 已筛选" : ""}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
          <div
            className="resource-detail-legend"
            aria-label={`${dimensionLabel} 图例`}
          >
            {cohortLegend.map((part) => (
              <span key={part.id}>
                <i style={{ background: part.color }} />
                {cohortDimension === "initiative" ||
                cohortDimension === "resourceType" ? (
                  <Button
                    variant="link"
                    onClick={() =>
                      open(
                        cohortDimension === "initiative"
                          ? { type: "initiative", initiativeId: part.id }
                          : { type: "resource", resourceType: part.id },
                      )
                    }
                  >
                    {cohortDimension === "initiative" ? (
                      <InitiativeLabel item={part} />
                    ) : (
                      part.name
                    )}
                  </Button>
                ) : (
                  <b>{part.name}</b>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="resource-detail-heading">
        <h3>
          {showCohortDimensions
            ? `经销商与 ${dimensionLabel} 分配明细`
            : "经销商与投资明细"}
          （{rows.length} 家）
        </h3>
        <Input
          aria-label="搜索抽屉经销商"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="经销商 / 编码 / SD / RSM"
        />
      </div>
      <div
        className="resource-detail-table"
        data-cohort-dimensions={showCohortDimensions ? "true" : undefined}
      >
        <Table>
          <TableHeader>
            <TableRow>
              {showCohortDimensions && (
                <TableHead className="num">排名</TableHead>
              )}
              <TableHead>经销商</TableHead>
              {!showCohortDimensions && (
                <TableHead>Sector / SD / RSM</TableHead>
              )}
              <TableHead className="num">
                {showCohortDimensions
                  ? `投资金额及${dimensionLabel}构成（万元）`
                  : "投资（万元）"}
              </TableHead>
              {!showCohortDimensions && (
                <TableHead className="num">Delivery Vol（KL）</TableHead>
              )}
              <TableHead className="num">
                {showCohortDimensions ? "历史 C3（K$）" : "C3（K$）"}
              </TableHead>
              {showCohortDimensions && basis === "vol" && (
                <TableHead className="num">Delivery Vol（KL）</TableHead>
              )}
              {!showCohortDimensions && (
                <>
                  <TableHead className="num">Yield</TableHead>
                  <TableHead>调整说明</TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.key}>
                {showCohortDimensions && (
                  <TableCell className="num" sortValue={rows.indexOf(row) + 1}>
                    {rows.indexOf(row) + 1}
                  </TableCell>
                )}
                <TableCell>
                  <DealerDetailButton
                    variant="link"
                    onClick={() => open({ type: "dealer", dealerKey: row.key })}
                  >
                    {row.name}
                  </DealerDetailButton>
                  <small>{row.code}</small>
                  {showCohortDimensions && (
                    <small>
                      {row.sector} · {row.sd} · {row.rsm}
                    </small>
                  )}
                </TableCell>
                {!showCohortDimensions && (
                  <TableCell>
                    {row.sector} / {row.sd} / {row.rsm}
                  </TableCell>
                )}
                <TableCell className="num" sortValue={row.amount}>
                  {n(row.amount, 10000)}
                  {showCohortDimensions && (
                    <small>
                      投资占比{" "}
                      {percent(share(row.amount, cohortInvestmentTotal))}
                    </small>
                  )}
                  {showCohortDimensions ? (
                    <CohortContributionBar
                      parts={dimensionParts(row.initiativeSources)}
                      maxAmount={maxDealerAmount}
                      dimensionLabel={dimensionLabel}
                    />
                  ) : (
                    current.type === "cohort" && (
                      <InitiativeContributionBar
                        sources={row.initiativeSources}
                        maxAmount={maxDealerAmount}
                      />
                    )
                  )}
                </TableCell>
                {!showCohortDimensions && dealerHistoryCell(row, "vol")}
                {dealerHistoryCell(row, "c3")}
                {showCohortDimensions &&
                  basis === "vol" &&
                  dealerHistoryCell(row, "vol")}
                {!showCohortDimensions && (
                  <>
                    <TableCell
                      className="num"
                      sortValue={historyYield(row.history, period)}
                    >
                      {n(historyYield(row.history, period))}
                    </TableCell>
                    <TableCell>{row.notes.join("；") || "—"}</TableCell>
                  </>
                )}
              </TableRow>
            ))}
            {!visible.length && (
              <TableRow>
                <TableCell
                  colSpan={showCohortDimensions ? (basis === "vol" ? 5 : 4) : 7}
                >
                  当前范围没有匹配经销商。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          {showCohortDimensions && (
            <TableFooter>
              <TableRow>
                <TableCell>合计</TableCell>
                <TableCell>
                  Top {current.topPercent}% · {rows.length} 家
                  <small>{cohortInitiativeCount} 个 Initiative</small>
                </TableCell>
                <TableCell className="num">
                  {n(currentAmount, 10000)}
                  <small>投资占比 {percent(cohortAmountShare)}</small>
                </TableCell>
                <TableCell className="num">
                  {n(historical.c3, 1000)}
                  <small>
                    占{" "}
                    {percent(
                      share(
                        sum(
                          cohortComparable.map((row) =>
                            analyticalOutput(row.history[`c3${suffix}`]),
                          ),
                        ),
                        cohortC3Total,
                      ),
                    )}
                  </small>
                </TableCell>
                {basis === "vol" && (
                  <TableCell className="num">
                    {n(historical.vol, 1000)}
                    <small>
                      占{" "}
                      {percent(
                        share(
                          sum(
                            cohortComparable.map((row) =>
                              analyticalOutput(row.history[`vol${suffix}`]),
                            ),
                          ),
                          cohortVolTotal,
                        ),
                      )}
                    </small>
                  </TableCell>
                )}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      <p className="resource-detail-note">
        {showCohortDimensions
          ? "仅展示当前 Top 名单；投资条按同一最大投资金额刻度展示，悬停或键盘聚焦色块可看金额及该家构成占比。"
          : current.type === "cohort"
            ? "仅展示当前 Top 名单；"
            : "包含已勾选但未获配的经销商；"}
        搜索只筛选显示，不改变分析分母。
      </p>
      {current.type === "cohort" && !showCohortDimensions && (
        <div className="resource-detail-legend" aria-label="Initiative 图例">
          {matchingItems.map((item) => (
            <span key={item.id}>
              <i style={{ background: detailInitiativeColor(item) }} />
              <Button
                variant="link"
                onClick={() =>
                  open({ type: "initiative", initiativeId: item.id })
                }
              >
                {item.name}
              </Button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
  const initiativeBudget = () => {
    const allocation = sum((initiative?.rows || []).map((row) => row.amount)),
      reserve = sum((initiative?.otherBudgets || []).map((row) => row.amount));
    const previous = sourceItems?.find(
      (item) =>
        String(item.initiativeKey || item.id) ===
        String(initiative?.initiativeKey || initiative?.id),
    );
    const baseline =
      previous?.allocationVisible === false
        ? null
        : previous
          ? sum((previous.rows || []).map((row) => row.amount))
          : null;
    return (
      <>
        <div className="resource-detail-metrics">
          {[
            ["本版预算（万元）", n(initiative?.budget, 10000)],
            ["已分配（万元）", n(allocation, 10000)],
            ["预留（万元）", n(reserve, 10000)],
            [
              "待分配（万元）",
              initiative?.budget == null
                ? "—"
                : n(initiative.budget - allocation - reserve, 10000),
            ],
          ].map(([label, value]) => (
            <Card key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </Card>
          ))}
        </div>
        {baseline != null && (
          <p className="resource-detail-note">
            较上版已提交投资：{allocation - baseline > 0 ? "+" : ""}
            {n(allocation - baseline, 10000)} 万元
          </p>
        )}
        <section className="resource-detail-section">
          <h3>预留原因</h3>
          {initiative?.otherBudgets?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>原因</TableHead>
                  <TableHead className="num">金额（万元）</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initiative.otherBudgets.map((row, index) => (
                  <TableRow key={row.id || index}>
                    <TableCell>{reason(row.reasonId)}</TableCell>
                    <TableCell className="num" sortValue={row.amount}>
                      {n(row.amount, 10000)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p>没有预留安排。</p>
          )}
        </section>
      </>
    );
  };
  return (
    <Sheet
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <SheetContent
        className="resource-detail-drawer"
        style={{ "--detail-width": `${width}px` } as CSSProperties}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (previous.current?.isConnected) previous.current.focus();
        }}
      >
        <div
          className="resource-detail-resizer"
          role="separator"
          aria-label="调整详情宽度"
          aria-orientation="vertical"
          aria-valuenow={width}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              resize(width + (event.key === "ArrowLeft" ? 40 : -40));
            }
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              resize(window.innerWidth - event.clientX);
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        />
        <header className="resource-detail-header">
          {trail.length > 1 && (
            <Button variant="outline" size="sm" onClick={back}>
              ← 返回上一层
            </Button>
          )}
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {current.type === "dealer" && single
              ? `${single.code} · ${single.sector} · ${single.sd} / ${single.rsm}`
              : current.type === "initiative"
                ? `${initiative?.sector || "—"} / ${initiative?.department || "—"} · ${initiative?.resourceType || "—"} · ${initiative?.ownerName || initiative?.ownerId || "—"}`
                : "当前业务范围 · 只读详情"}
          </SheetDescription>
        </header>
        <div className="resource-detail-content" ref={content}>
          <div className="resource-detail-controls">
            <span>历史参考</span>
            <HistoryPeriodTabs
              value={period}
              onValueChange={setPeriod}
              ytdCutoffMonth={ytdCutoffMonth}
            />
            <Tabs
              value={basis}
              onValueChange={(value) => setBasis(value as "vol" | "c3")}
            >
              <TabsList aria-label="抽屉产出口径">
                <TabsTrigger value="vol">Vol</TabsTrigger>
                <TabsTrigger value="c3">C3</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          {!rows.length && current.type === "dealer" ? (
            <p role="status">
              该经销商不在当前范围内，或编码缺少唯一的 Sector 归属。
            </p>
          ) : (
            <>
              {current.type === "initiative" ? initiativeBudget() : metrics}
              {current.type === "dealer" && (
                <section className="resource-detail-section">
                  <h3>本次投资的资源大类构成</h3>
                  <div
                    className="resource-detail-resource-mix"
                    aria-label="当前规划资源构成"
                  >
                    <div className="resource-detail-donuts">
                      <ResourceMixDonut
                        parts={breakdown}
                        title="当前规划"
                        center={n(currentAmount, 10000)}
                        unit="万元"
                      />
                      {historyMixAvailable && (
                        <ResourceMixDonut
                          parts={expenses.map((type) => ({
                            type,
                            amount: readExpense(type)!,
                          }))}
                          title="历史投资"
                          center={n(historical.investment, 1000)}
                          unit="K$"
                        />
                      )}
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>资源大类</TableHead>
                          <TableHead className="num">当前（万元）</TableHead>
                          <TableHead className="num">当前占比</TableHead>
                          <TableHead className="num">历史占比</TableHead>
                          <TableHead className="num">差值</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {breakdown.map((row) => {
                          const now = share(row.amount, currentAmount),
                            past = allowedExpenses.includes(row.type)
                              ? share(
                                  readExpense(row.type),
                                  historical.investment,
                                )
                              : null;
                          return (
                            <TableRow key={row.type}>
                              <TableCell>
                                <Button
                                  variant="link"
                                  onClick={() =>
                                    open({
                                      type: "resource",
                                      resourceType: row.type,
                                    })
                                  }
                                >
                                  <i
                                    className="resource-detail-swatch"
                                    style={{
                                      background: resourceColor(row.type),
                                    }}
                                  />
                                  {row.type}
                                </Button>
                              </TableCell>
                              <TableCell className="num" sortValue={row.amount}>
                                {n(row.amount, 10000)}
                              </TableCell>
                              <TableCell className="num" sortValue={now}>
                                {percent(now)}
                              </TableCell>
                              <TableCell className="num" sortValue={past}>
                                {percent(past)}
                              </TableCell>
                              <TableCell className="num">
                                {now != null && past != null
                                  ? `${now - past > 0 ? "+" : ""}${n(now - past)}pp`
                                  : "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="resource-detail-note">
                    本次规划是人民币，历史费用是美元；不直接计算两者金额差。
                    {negativeExpenses
                      ? "历史费用含负数，保留净额明细，不绘制正向构成占比。"
                      : ""}
                  </p>
                </section>
              )}
              {(current.type === "initiative" ||
                current.type === "resource" ||
                current.type === "rationale") && (
                <section className="resource-detail-section">
                  <h3>
                    {current.type === "resource"
                      ? "资源大类整体集中度"
                      : "拆分依据与调整说明"}
                  </h3>
                  {current.type !== "resource" && (
                    <>
                      <p>
                        {initiative?.allocationMethod ||
                          initiative?.method ||
                          "未记录试算起点"}
                      </p>
                      <p>{initiative?.changeReason || "未填写本版调整说明"}</p>
                    </>
                  )}
                  <DetailConcentrationCurve rows={rows} basis={basis} />
                  <div className="resource-detail-metrics">
                    {[20, 50, 80].map((top) => {
                      const result = concentration(rows, top);
                      return (
                        <Card key={top}>
                          <span>
                            Top {top}% · 投资 vs{" "}
                            {basis === "vol" ? "Delivery Vol" : "C3"}
                          </span>
                          <strong>
                            {result
                              ? `${n(result.amountShare)}% / ${n(result.metricShare)}%`
                              : "—"}
                          </strong>
                        </Card>
                      );
                    })}
                  </div>
                </section>
              )}
              {current.type === "dealer" ? sources : dealerTable}
              {(current.type === "initiative" ||
                current.type === "rationale") && (
                <Accordion type="single" collapsible>
                  <AccordionItem value="organization">
                    <AccordionTrigger>
                      按 SD/RSM 结构 · 投入 vs Delivery Vol vs C3
                    </AccordionTrigger>
                    <AccordionContent>
                      <Tabs
                        value={organizationBy}
                        onValueChange={(value) =>
                          setOrganizationBy(value as "sd" | "rsm")
                        }
                      >
                        <TabsList>
                          <TabsTrigger value="sd">按 SD</TabsTrigger>
                          <TabsTrigger value="rsm">按 RSM</TabsTrigger>
                        </TabsList>
                      </Tabs>
                      <section className="resource-detail-section">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>
                                {organizationBy.toUpperCase()}
                              </TableHead>
                              <TableHead className="num">分配 / 名单</TableHead>
                              <TableHead className="num">
                                投资（万元）
                              </TableHead>
                              <TableHead>占比对照 · 0–100%</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {organizations.map((group) => (
                              <TableRow key={group.key}>
                                <TableCell>
                                  <Button
                                    variant="link"
                                    onClick={() =>
                                      open({
                                        type: "organization",
                                        groupBy: organizationBy,
                                        groupKey: group.key,
                                      })
                                    }
                                  >
                                    {group.key}
                                  </Button>
                                </TableCell>
                                <TableCell
                                  className="num"
                                  sortValue={group.allocatedCount}
                                >
                                  {group.allocatedCount} / {group.selectedCount}
                                </TableCell>
                                <TableCell
                                  className="num"
                                  sortValue={group.amount}
                                >
                                  {n(group.amount, 10000)}
                                </TableCell>
                                <TableCell sortValue={group.amountShare}>
                                  <div className="resource-detail-organization-bars">
                                    {[
                                      ["投资", group.amountShare, "#FBCE07"],
                                      [
                                        "Delivery Vol",
                                        share(group.analyticalVol, totalVol),
                                        "#89CFDC",
                                      ],
                                      [
                                        "C3",
                                        share(group.analyticalC3, totalC3),
                                        "#595959",
                                      ],
                                    ].map(([label, value, color]) => (
                                      <div key={String(label)}>
                                        <span>{label}</span>
                                        <i>
                                          <b
                                            style={{
                                              width: `${Number(value) || 0}%`,
                                              background: String(color),
                                            }}
                                          />
                                        </i>
                                        <em>
                                          {percent(value as number | null)}
                                        </em>
                                      </div>
                                    ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </section>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
              {(current.type === "resource" ||
                current.type === "organization" ||
                (current.type === "cohort" && !showCohortDimensions)) &&
                sources}
              <Accordion type="single" collapsible defaultValue="history">
                <AccordionItem value="history">
                  <AccordionTrigger>
                    历史 Actual、投资与已授权费用明细
                  </AccordionTrigger>
                  <AccordionContent>{historyTable}</AccordionContent>
                </AccordionItem>
              </Accordion>
            </>
          )}
        </div>
        <footer className="resource-detail-footer">
          <p>期间切换只改变历史参考，不修改当前方案或分配金额。</p>
          <Button variant="outline" onClick={onClose}>
            关闭详情
          </Button>
        </footer>
      </SheetContent>
    </Sheet>
  );
}
export const PortfolioDetailDialog = ResourceDetailDrawer;
