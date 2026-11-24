import { wholeMetric } from "../domain/metric-precision";
import { scopeHasRsm } from "../domain/organization-display";
import { useLegendColors, DepartmentLabel } from "../LegendColors";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../components/ui/tabs";
import {
  V19BudgetOverview,
  V19Health,
  V19Stack,
  V19Destination,
} from "./V19PortfolioVisuals.jsx";
import "../v19-portfolio.css";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { TooltipProvider } from "../../components/ui/tooltip";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "../../components/ui/table";
import { Label } from "../../components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "../../components/ui/native-select";
import { useEffect, useMemo, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import { PlanningVersionBar as VersionBar } from "./PlanningVersionBar.jsx";
import { PlanningSummaryAmount } from "./PlanningSummaryAmount";
import { VersionComparison } from "./VersionComparison.jsx";
import { SdAnalysis } from "./SdAnalysis.jsx";
import { V19ExecutiveHealth } from "./V19ExecutiveHealth.jsx";
import { V19DealerDetails } from "./V19DealerDetails.jsx";
import { hasReserveAcknowledgement } from "../domain/reserve-review.js";
import { filterManagementItems, retainAvailableManagementFilters } from "../domain/management-filters.js";
import { ManagementFilters, managementFilterFields } from "./ManagementFilters.jsx";

const num = (value, digits = 0) =>
  Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const pct = (value, digits = 1) =>
  value == null ? "—" : `${num(value, digits)}%`;
export function PageHead({ eyebrow, title, description, children }) {
  return (
    <header className="studio-page-head">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="actions">{children}</div>}
    </header>
  );
}

function Status({ status }) {
  const submitted = status === "completed";
  return (
    <Badge
      variant="secondary"
      className={`resource-status ${submitted ? "done" : "editing"}`}
    >
      {submitted ? "已提交" : "草稿"}
    </Badge>
  );
}

export function HomePage() {
  const { initiativeColor } = useLegendColors();
  const { view, navigate, identity } = useWorkbench();
  const items = view.initiatives || [],
    total = E.totals(items);
  const [page, setPage] = useState(1),
    pages = Math.max(1, Math.ceil(items.length / 9));
  const currentPage = Math.min(page, pages);
  return (
    <div className="v19-home">
      <PageHead eyebrow="MY INITIATIVES" title="预算分到哪里，还有多少没分？" />
      <VersionBar
        scope={`${[...new Set(items.map((i) => i.sector))].join(" / ") || identity.sector || "—"} · ${[...new Set(items.map((i) => i.department))].join(" / ") || "—"}`}
      >
        <Button onClick={() => navigate("portfolio")}>
          查看我的投入组合 →
        </Button>
      </VersionBar>
      <div className="v19-home-metrics">
        {[
          [
            "预算总额",
            <>
              {num(total.budget)}
              <small>元</small>
            </>,
          ],
          [
            "已分配到经销商",
            <>
              {num(total.allocated)}
              <small>元</small>
            </>,
          ],
          [
            "未分配合计",
            <>
              {num(total.otherBudget + Math.max(0, total.gap))}
              <small>元</small>
            </>,
          ],
          [
            "未分配构成",
            <>
              <span>{num(total.otherBudget)}<small>元预留</small></span>{" / "}
              <span>{num(Math.max(0, total.gap))}<small>元待分配</small></span>
            </>,
          ],
        ].map(([label, value], index) => (
          <Card
            key={label}
            className={`v19-home-metric ${index === 0 ? "accent" : ""}`}
          >
            <span>{label}</span>
            <strong>{value}</strong>
          </Card>
        ))}
      </div>
      <h2 className="v19-home-list-title">我的 Initiative</h2>
      <div className="v19-initiative-grid">
        {items
          .slice((currentPage - 1) * 9, currentPage * 9)
          .map((item, index) => {
            const totals = E.totals([item]);
            const [statusLabel, statusColor] = item.workflow?.confirmed
              ? ["已确认", "confirmed"]
              : item.workflow?.submitted
                ? ["已提交 · 待确认", "pending"]
                : item.workflow?.requiresResubmission
                  ? ["待重新提交", "resubmit"]
                  : totals.allocated || totals.otherBudget
                    ? ["草稿", "draft"]
                    : ["未开始", "not-started"];
            return (
              <Card
                key={item.id}
                className="v19-initiative-card"
                style={{ "--initiative-color": initiativeColor(item, index) }}
              >
                <div className="v19-initiative-heading">
                  <h2>{item.name}</h2>
                  <Badge variant="secondary" className={`initiative-status-${statusColor}`}>
                    {statusLabel}
                  </Badge>
                </div>
                <p>
                  {item.sector} / <DepartmentLabel name={item.department} /> · {item.resourceType}
                </p>
                <div className="v19-initiative-amount">
                  {num(item.budget)} <small>元</small>
                </div>
                <dl>
                  <div>
                    <dt>已分配</dt>
                    <dd>{num(totals.allocated)} 元</dd>
                  </div>
                  <div>
                    <dt>预留 / 待分配</dt>
                    <dd>
                      {num(totals.otherBudget)} /{" "}
                      {num(Math.max(0, totals.gap))} 元
                    </dd>
                  </div>
                </dl>
                <Button onClick={() => navigate("editor", item.id)}>
                  进入拆分 →
                </Button>
              </Card>
            );
          })}
      </div>
      {!items.length && <div className="empty">当前范围没有 Initiative。</div>}
      <div className="v19-list-pagination">
        <span>{wholeMetric(items.length)} 条 · 每页9条</span>
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === 1}
            onClick={() => setPage((x) => x - 1)}
          >
            上一页
          </Button>
          <span>
            {currentPage} / {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === pages}
            onClick={() => setPage((x) => x + 1)}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SubmissionPage() {
  const {
    view,
    state,
    identity,
    navigate,
    publish,
    savedForSyncIds,
    editorOperations,
  } = useWorkbench();
  const [reviewError, setReviewError] = useState("");
  const items = view.initiatives || [];
  const ready = items.filter(
    (item) =>
      savedForSyncIds.has(item.id) &&
      item.workflow?.editable !== false &&
      hasReserveAcknowledgement(identity, state.planningVersion?.id, item),
  );
  return (
    <TooltipProvider delayDuration={150}>
      <PageHead eyebrow="DRAFT & SUBMISSION" title="当前版本的草稿与提交" />
      <VersionBar fixed />
      <Card className="panel studio-submission-panel">
        <div className="panel-header">
          <div>
            <h2>
              {state.planningVersion?.id || "当前工作区"} ·{" "}
              {identity?.displayName || identity?.label || "当前 Owner"}
            </h2>
          </div>
          <Button
            variant="default"
            type="button"

            disabled={!ready.length}
            onClick={async () => {
              setReviewError("");
              for (const item of ready) {
                if (!hasReserveAcknowledgement(identity, state.planningVersion?.id, item)) {
                  setReviewError(`${item.name} 的预算与预留尚未核对，请回到拆分工作台第一步完成核对。`);
                  break;
                }
                await publish(item.id, item.changeReason || "");
              }
            }}
          >
            提交本版所有已配平项目
          </Button>
        </div>
        {reviewError && <p role="alert">{reviewError}</p>}
        <p className="muted">批量提交仅包含已保存配平、已核对本版预算与预留的项目；核对状态随草稿保存。</p>
        <div className="table-scroll">
          <Table containerClassName="overflow-visible">
            <TableHeader>
              <TableRow>
                <TableHead>Initiative</TableHead>
                <TableHead className="num">本版预算（元）</TableHead>
                <TableHead className="num">已分配（元）</TableHead>
                <TableHead className="num">预留（元）</TableHead>
                <TableHead className="num">待分配（元）</TableHead>
                <TableHead>提交状态</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const totals = E.totals([item]);
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <strong>{item.name}</strong>
                    </TableCell>
                    <TableCell className="num" sortValue={totals.budget}>
                      <PlanningSummaryAmount value={totals.budget} />
                    </TableCell>
                    <TableCell className="num" sortValue={totals.allocated}>
                      <PlanningSummaryAmount value={totals.allocated} />
                    </TableCell>
                    <TableCell className="num" sortValue={totals.otherBudget}>
                      <PlanningSummaryAmount value={totals.otherBudget} />
                    </TableCell>
                    <TableCell className="num" sortValue={Math.max(0, totals.gap)}>
                      <PlanningSummaryAmount value={Math.max(0, totals.gap)} />
                    </TableCell>
                    <TableCell sortValue={item.status}>
                      <Status status={item.status} />{" "}
                      {item.workflow?.editable !== false && !hasReserveAcknowledgement(identity, state.planningVersion?.id, item) && <small className="block muted">待核对预算与预留</small>}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"

                        disabled={Boolean(editorOperations[item.id])}
                        onClick={() => navigate("editor", item.id)}
                      >
                        编辑
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <p className="small-text muted">
          提交覆盖仅限当前版本可提交项目，保留修订审计。已取消项目不显示为待提交，历史版本不被删除。
        </p>
      </Card>
    </TooltipProvider>
  );
}

function latestPublished(state) {
  return Object.values(state.publications || {})
    .map((rows) => rows.at(-1)?.initiative)
    .filter(Boolean);
}
function PortfolioDashboard({ mode }) {
  const { view, state, data, identity } = useWorkbench();
  const executive = mode === "exec";
  const source = useMemo(() => {
    const initiatives = view.initiatives || [];
    if (mode === "owner") return initiatives;
    if (state.planningVersion) {
      return executive ? initiatives : initiatives.map((item) =>
        !item.workflow?.submitted ? { ...item, rows: [], otherBudgets: [] } : item,
      );
    }
    const accessible = new Set(initiatives.map((item) => item.id));
    return latestPublished(state).filter((item) => executive || accessible.has(item.id));
  }, [executive, mode, state.planningVersion, state.publications, view.initiatives]);
  const fields = useMemo(
    () => executive ? managementFilterFields(source) : [],
    [executive, source],
  );
  const [selections, setSelections] = useState({});
  const [departmentInitiative, setDepartmentInitiative] = useState("");
  const filters = useMemo(
    () => retainAvailableManagementFilters(selections, fields),
    [selections, fields],
  );
  useEffect(() => {
    setSelections((current) => retainAvailableManagementFilters(current, fields));
  }, [fields]);
  const scoped = executive
    ? filterManagementItems(source, filters)
    : departmentInitiative
      ? source.filter((item) => String(item.id) === departmentInitiative)
      : source;
  const analysisItems =
    mode === "department"
      ? scoped.filter(
          (item) =>
            item.workflow?.submitted ?? item.allocationVisible !== false,
        )
      : mode === "exec"
        ? scoped.filter(
            (item) =>
              item.workflow?.confirmed ?? item.allocationVisible !== false,
          )
        : scoped;
  const tabs = executive
    ? [
        ["overview", "总览"],
        ["health", "集中度"],
        ["stack", "叠加到经销商"],
        ["versions", "版本变化"],
      ]
    : [
        ["overview", "总览"],
        ["health", "健康检查"],
        ["destination", "投资去向"],
        ["sd", scopeHasRsm(scoped) ? "按 SD/RSM 看" : "按 SD 看"],
        ...(mode === "owner" ? [["dealers", "经销商明细"]] : [["stack", "叠加到经销商"]]),
        ...(mode === "department" ? [["versions", "版本变化"]] : []),
      ];
  const [tab, setTab] = useState("overview");
  const title = executive
    ? "全局投资看板"
    : mode === "owner"
      ? "我的投入组合"
      : "部门投入组合";
  return (
    <div className="v19-portfolio">
      <div className={executive ? "v19-portfolio-heading v19-management-heading" : "v19-portfolio-heading"}>
        <PageHead
          eyebrow={
            executive
              ? "EXECUTIVE VIEW"
              : mode === "owner"
                ? "MY PORTFOLIO"
                : "DEPARTMENT PORTFOLIO"
          }
          title={title}
          description={
            executive
              ? "只读，基于部门已确认方案"
              : mode === "owner"
                ? "本人工作草稿 · 包含未提交的修改"
                : "本部门已提交方案 · 按 Initiative 汇总投资与产出"
          }
        />
        <VersionBar
          fixed={mode === "owner"}
          scope={
            executive
              ? undefined
              : `${[...new Set(source.map((i) => i.sector))].join(" / ")} · ${[...new Set(source.map((i) => i.department))].join(" / ")}`
          }
        >
          {executive && (
            <ManagementFilters
              fields={fields}
              filters={filters}
              setFilters={setSelections}
            />
          )}
          {mode === "department" && (
            <Label className="v19-department-filter">
              <span className="sr-only">Initiative</span>
              <NativeSelect
                value={departmentInitiative}
                onChange={(event) => setDepartmentInitiative(event.target.value)}
              >
                <NativeSelectOption value="">
                  全部 Initiative
                </NativeSelectOption>
                {source.map((item) => (
                  <NativeSelectOption key={item.id} value={String(item.id)}>
                    {item.name} · {item.ownerName || item.ownerId}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Label>
          )}
        </VersionBar>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="v19-portfolio-tabs">
        <TabsList className="v19-portfolio-tabbar" aria-label="投入组合模块">
          {tabs.map(([key, label]) => (
            <TabsTrigger key={key} value={key}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <V19BudgetOverview
            items={scoped}
            dealers={data.dealers}
            mode={mode}
            state={state}
          />
        </TabsContent>
        <TabsContent value="health">
          {executive ? (
            <V19ExecutiveHealth
              filters={filters}
            budgetReasons={state.budgetReasons}
              ytdCutoffMonth={state.ytdCutoffMonth}
              items={scoped}
              dealers={data.dealers}
              thresholds={state.healthThresholds}
            />
          ) : (
            <V19Health
            budgetReasons={state.budgetReasons}
              ytdCutoffMonth={state.ytdCutoffMonth}
              items={analysisItems}
              dealers={data.dealers}
              mode={mode}
              thresholds={state.healthThresholds}
            />
          )}
        </TabsContent>
        <TabsContent value="stack">
          <V19Stack
            budgetReasons={state.budgetReasons}
            ytdCutoffMonth={state.ytdCutoffMonth}
            items={analysisItems}
            dealers={data.dealers}
            thresholds={state.healthThresholds}
          />
        </TabsContent>
        <TabsContent value="destination">
          <V19Destination
            items={scoped}
            dealers={data.dealers}
            mode={mode}
            ytdCutoffMonth={state.ytdCutoffMonth}
            budgetReasons={state.budgetReasons}
          />
        </TabsContent>
        <TabsContent value="sd">
          <SdAnalysis
            budgetReasons={state.budgetReasons}
            items={scoped}
            ytdCutoffMonth={state.ytdCutoffMonth}
            dealers={data.dealers}
            showOwner={mode === "department"}
            threshold={state.healthThresholds?.concentrationYellow ?? 5}
            redThreshold={state.healthThresholds?.concentrationRed ?? 10}
            sourceVersionId={state.planningVersion?.sourceVersionId}
            sourceRevision={state.planningVersions?.find(version => version.id === state.planningVersion?.sourceVersionId)?.revision}
            comparisonIdentity={identity?.email}
          />
        </TabsContent>
        {mode === "owner" && <TabsContent value="dealers">
          <V19DealerDetails
            showColumnJumps={mode !== "department"}
            budgetReasons={state.budgetReasons}
            ytdCutoffMonth={state.ytdCutoffMonth}
            items={analysisItems}
            dealers={data.dealers}
            executive={executive}
          />
        </TabsContent>}
        <TabsContent value="versions">
          <VersionComparison executive={executive} filters={executive ? filters : undefined} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function DepartmentPage() {
  const { identity, page } = useWorkbench();
  return (
    <PortfolioDashboard
      mode={identity.role === "owner" || page === "portfolio" ? "owner" : "department"}
    />
  );
}
export function ManagementPage() {
  return <PortfolioDashboard mode="exec" />;
}
