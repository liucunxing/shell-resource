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
  orderedResourceTypes,
} from "./V19PortfolioVisuals.jsx";
import "../v19-portfolio.css";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
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
import { useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import { PlanningVersionBar as VersionBar } from "./PlanningVersionBar.jsx";
import { VersionComparison } from "./VersionComparison.jsx";
import { SdAnalysis } from "./SdAnalysis.jsx";
import { V19ExecutiveHealth } from "./V19ExecutiveHealth.jsx";
import { V19DealerDetails } from "./V19DealerDetails.jsx";
import { hasReserveAcknowledgement } from "../domain/reserve-review.js";

const num = (value, digits = 0) =>
  Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const wan = (value) => `${num(Number(value || 0) / 10000, 1)} 万`;
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
              {num(total.budget / 10000, 1)}
              <small>万</small>
            </>,
          ],
          [
            "已分配到经销商",
            <>
              {num(total.allocated / 10000, 1)}
              <small>万</small>
            </>,
          ],
          [
            "未分配合计",
            <>
              {num((total.otherBudget + Math.max(0, total.gap)) / 10000, 1)}
              <small>万</small>
            </>,
          ],
          [
            "未分配构成",
            <>
              {num(total.otherBudget / 10000, 1)} <small>预留</small> /{" "}
              {num(Math.max(0, total.gap) / 10000, 1)} <small>待分配</small>
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
            return (
              <Card
                key={item.id}
                className="v19-initiative-card"
                style={{ "--initiative-color": initiativeColor(item, index) }}
              >
                <div className="v19-initiative-heading">
                  <h2>{item.name}</h2>
                  <Badge variant="secondary">
                    {item.workflow?.confirmed
                      ? "已确认"
                      : item.workflow?.submitted
                        ? "已提交 · 待确认"
                        : item.workflow?.requiresResubmission
                          ? "待重新提交"
                          : totals.allocated || totals.otherBudget
                            ? "草稿"
                            : "未开始"}
                  </Badge>
                </div>
                <p>
                  {item.sector} / <DepartmentLabel name={item.department} /> · {item.resourceType}
                </p>
                <div className="v19-initiative-amount">
                  {num(item.budget / 10000, 1)} <small>万元</small>
                </div>
                <dl>
                  <div>
                    <dt>已分配</dt>
                    <dd>{wan(totals.allocated)}</dd>
                  </div>
                  <div>
                    <dt>预留 / 待分配</dt>
                    <dd>
                      {num(totals.otherBudget / 10000, 1)} /{" "}
                      {num(Math.max(0, totals.gap) / 10000, 1)} 万
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
        <span>{items.length} 条 · 每页9条</span>
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
    <>
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
        <p className="muted">批量提交仅包含已保存配平、已核对本版预算与预留的项目；核对在当前浏览器会话有效。</p>
        <div className="table-scroll">
          <Table containerClassName="overflow-visible">
            <TableHeader>
              <TableRow>
                <TableHead>Initiative</TableHead>
                <TableHead className="num">本版预算（万）</TableHead>
                <TableHead className="num">已分配</TableHead>
                <TableHead className="num">预留</TableHead>
                <TableHead className="num">待分配</TableHead>
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
                      <small className="block muted">
                        {item.initiativeKey || item.id}
                      </small>
                    </TableCell>
                    <TableCell className="num" sortValue={item.budget / 10000}>
                      {num(item.budget / 10000, 1)}
                    </TableCell>
                    <TableCell className="num" sortValue={totals.allocated / 10000}>
                      {num(totals.allocated / 10000, 1)}
                    </TableCell>
                    <TableCell className="num" sortValue={totals.otherBudget / 10000}>
                      {num(totals.otherBudget / 10000, 1)}
                    </TableCell>
                    <TableCell className="num" sortValue={Math.max(0, totals.gap) / 10000}>
                      {num(Math.max(0, totals.gap) / 10000, 1)}
                    </TableCell>
                    <TableCell sortValue={item.status}>
                      <Status status={item.status} />{" "}
                      {item.workflow?.editable !== false && !hasReserveAcknowledgement(identity, state.planningVersion?.id, item) && <small className="block muted">待核对预算与预留</small>}
                      {item.publishedRevision
                        ? `r${item.publishedRevision}`
                        : ""}
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
    </>
  );
}

function latestPublished(state) {
  return Object.values(state.publications || {})
    .map((rows) => rows.at(-1)?.initiative)
    .filter(Boolean);
}
function BoardFilters({ items, filters, setFilters, executive }) {
  const options = (key) =>
    key === "resourceType"
      ? orderedResourceTypes(items.map((item) => item[key]))
      : [...new Set(items.map((item) => item[key]).filter(Boolean))].sort();
  const keys = executive
    ? [
        ["sector", "Sector"],
        ["department", "部门"],
        ["resourceType", "资源大类"],
      ]
    : [["name", "Initiative"]];
  return (
    <div className="v19-executive-filters" role="group" aria-label="管理层筛选">
      {keys.map(([key, label]) => (
        <Label key={key}>
          <span className="sr-only">{label}</span>
          <NativeSelect
            aria-label={label}
            value={filters[key]}
            onChange={(event) =>
              setFilters({ ...filters, [key]: event.target.value })
            }
          >
            <NativeSelectOption value="all">全部{label}</NativeSelectOption>
            {options(key).map((value) => (
              <NativeSelectOption key={value}>{value}</NativeSelectOption>
            ))}
          </NativeSelect>
        </Label>
      ))}
    </div>
  );
}

function PortfolioDashboard({ mode }) {
  const { view, state, data, identity } = useWorkbench();
  const accessible = new Set((view.initiatives || []).map((item) => item.id));
  const published = latestPublished(state).filter(
    (item) => mode === "exec" || accessible.has(item.id),
  );
  const source = state.planningVersion
    ? (view.initiatives || []).map((item) =>
        mode === "department" && !item.workflow?.submitted
          ? { ...item, rows: [], otherBudgets: [] }
          : item,
      )
    : mode === "owner"
      ? view.initiatives || []
      : published;
  const [filters, setFilters] = useState({
    sector: "all",
    department: "all",
    resourceType: "all",
    name: "all",
    id: "all",
  });
  const scoped = source.filter((item) =>
    Object.entries(filters).every(
      ([key, value]) => value === "all" || String(item[key]) === value,
    ),
  );
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
  const executive = mode === "exec";
  const tabs = executive
    ? [
        ["overview", "总览"],
        ["health", "集中度"],
        ["stack", "叠加到经销商"],
        ["dealers", "经销商明细"],
        ["versions", "版本变化"],
      ]
    : [
        ["overview", "总览"],
        ["health", "健康检查"],
        ["destination", "投资去向"],
        ["sd", "按 SD/RSM 看"],
        ["dealers", "经销商明细"],
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
      <div className="v19-portfolio-heading">
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
              ? ""
              : `${[...new Set(source.map((i) => i.sector))].join(" / ")} · ${[...new Set(source.map((i) => i.department))].join(" / ")}`
          }
        >
          {executive && (
            <BoardFilters
              items={source}
              filters={filters}
              setFilters={setFilters}
              executive
            />
          )}
          {mode === "department" && (
            <Label className="v19-department-filter">
              <span className="sr-only">Initiative</span>
              <NativeSelect
                value={filters.id}
                onChange={(event) =>
                  setFilters({ ...filters, id: event.target.value })
                }
              >
                <NativeSelectOption value="all">
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
            metadata={state.reference}
            threshold={state.healthThresholds?.concentrationYellow ?? 5}
            redThreshold={state.healthThresholds?.concentrationRed ?? 10}
            sourceVersionId={state.planningVersion?.sourceVersionId}
            comparisonIdentity={identity?.email}
          />
        </TabsContent>
        <TabsContent value="dealers">
          <V19DealerDetails
            showColumnJumps={mode !== "department"}
            budgetReasons={state.budgetReasons}
            ytdCutoffMonth={state.ytdCutoffMonth}
            items={analysisItems}
            dealers={data.dealers}
            executive={executive}
          />
        </TabsContent>
        <TabsContent value="versions">
          <VersionComparison executive={executive} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export function DepartmentPage() {
  const { identity } = useWorkbench();
  return (
    <PortfolioDashboard
      mode={identity.role === "owner" ? "owner" : "department"}
    />
  );
}
export function ManagementPage() {
  return <PortfolioDashboard mode="exec" />;
}
