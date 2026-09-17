import {
  ArrowRight,
  ChartBar,
  Check,
  Database,
  Flag,
  GitBranch,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import { Button } from "@fluentui/react-components";
import { useWorkspace } from "../state/WorkspaceContext";
import { DEPARTMENTS } from "../domain/types";
import type { Page } from "../domain/types";
import {
  totals,
  formatMoney,
  formatPercent,
  getInsights,
} from "../domain/engine";
import {
  PageHeader,
  Panel,
  MetricStrip,
  StatusBadge,
  EmptyState,
  InsightList,
} from "../components/ui";

export function HomePage() {
  const { state, navigate, setDepartment } = useWorkspace();
  const summary = totals(state);
  const ds = DEPARTMENTS.filter((d) =>
    state.budgets.some((b) => b.department === d),
  );
  const confirmed = ds.filter((d) => state.confirmed[d]).length;
  const readyData = state.budgets.length > 0 && state.history.length > 0;
  const allAllocated =
    state.budgets.length > 0 && state.budgets.every((b) => b.completed);
  const stages: {
    label: string;
    sub: string;
    page: Page;
    done: boolean;
    icon: typeof Database;
  }[] = [
    {
      label: "数据准备",
      sub: "预算 · 历史 · 预计",
      page: "database",
      done: readyData,
      icon: Database,
    },
    {
      label: "初始预算拆分",
      sub: `${summary.completed} / ${summary.count} 个项目已确认`,
      page: "allocation",
      done: allAllocated,
      icon: GitBranch,
    },
    {
      label: "部门调整与洞察",
      sub: `${confirmed} / ${ds.length} 个部门已确认`,
      page: "adjust",
      done: ds.length > 0 && confirmed === ds.length,
      icon: SlidersHorizontal,
    },
    {
      label: "确认与提交",
      sub: state.versions.length
        ? `${state.versions.length} 个正式版本`
        : "生成预算基线",
      page: "submit",
      done: state.versions.length > 0,
      icon: Flag,
    },
    {
      label: "季度 Tracking",
      sub: "预算与实际对照",
      page: "tracking",
      done: state.versions.length > 0 && state.tracking.length > 0,
      icon: ChartBar,
    },
  ];
  const next = stages.find((s) => !s.done) ?? stages[4];
  const insight = getInsights(state);
  const deptNames = { MKT: "市场投入", ICE: "渠道激励", Capex: "资本投入" };
  return (
    <div className="page-stack">
      <PageHeader
        title="流程总览"
        description="从年度预算到季度执行，让每一笔资源投入有据可循。"
        actions={
          <Button
            appearance="primary"
            icon={<ArrowRight />}
            iconPosition="after"
            onClick={() => navigate(next.page)}
          >
            继续{next.label}
          </Button>
        }
      />
      <MetricStrip
        items={[
          {
            label: "2027 年度总预算",
            value: (
              <>
                <span className="currency">¥</span>
                {formatMoney(summary.budget)}
              </>
            ),
            hint: `${summary.count} 个 Initiative · ${ds.length} 个部门`,
          },
          {
            label: "已分配至经销商",
            value: (
              <>
                <span className="currency">¥</span>
                {formatMoney(summary.allocated)}
              </>
            ),
            hint: `占总预算 ${formatPercent(summary.budget ? summary.allocated / summary.budget : null)}`,
          },
          {
            label: "待分配预算",
            value: (
              <>
                <span className="currency">¥</span>
                {formatMoney(summary.pool)}
              </>
            ),
            hint: "按项目独立保留",
            tone: "amber",
          },
          {
            label: "部门确认进度",
            value: (
              <>
                {confirmed}
                <span className="metric-denominator"> / {ds.length}</span>
              </>
            ),
            hint: state.versions[0]
              ? `最新基线 ${state.versions[0].name}`
              : "全部确认后可正式提交",
            tone: "green",
          },
        ]}
      />
      <Panel
        title="规划进度"
        description="按业务流程逐步完成，随时返回调整。"
        actions={
          <StatusBadge tone={state.versions.length ? "success" : "warning"}>
            {state.versions.length ? "已有正式版本" : "规划进行中"}
          </StatusBadge>
        }
      >
        <div className="journey">
          {stages.map((stage, i) => (
            <button
              onClick={() => navigate(stage.page)}
              key={stage.page}
              className={`journey-step ${stage.done ? "done" : ""} ${stage === next ? "current" : ""}`}
            >
              <div className="journey-top">
                <span className="journey-icon">
                  {stage.done ? (
                    <Check size={19} weight="bold" />
                  ) : (
                    <stage.icon size={21} />
                  )}
                </span>
                {i < stages.length - 1 && <span className="journey-line" />}
              </div>
              <b>{stage.label}</b>
              <small>{stage.sub}</small>
              {stage === next && (
                <span className="journey-next">
                  当前步骤 <ArrowRight size={12} />
                </span>
              )}
            </button>
          ))}
        </div>
      </Panel>
      <div className="overview-grid">
        <Panel
          title="部门预算概览"
          description="年度预算、分配结构与部门状态"
          actions={
            <Button
              appearance="subtle"
              size="small"
              icon={<ArrowRight />}
              iconPosition="after"
              onClick={() => navigate("allocation")}
            >
              进入工作区
            </Button>
          }
        >
          {state.budgets.length ? (
            <>
              <div className="budget-legend">
                <span>
                  <i className="legend-allocated" />
                  已分配
                </span>
                <span>
                  <i className="legend-pool" />
                  待分配
                </span>
                <span className="muted">金额单位：元</span>
              </div>
              {DEPARTMENTS.map((d) => {
                const t = totals(state, d);
                return (
                  <button
                    className="dept-budget"
                    key={d}
                    onClick={() => {
                      setDepartment(d);
                      navigate("allocation");
                    }}
                  >
                    <div className="dept-budget-heading">
                      <div className={`dept-monogram ${d.toLowerCase()}`}>
                        {d === "Capex" ? "C" : d[0]}
                      </div>
                      <div className="dept-label">
                        <b>{d}</b>
                        <span>
                          {deptNames[d]} · {t.count} 个项目
                        </span>
                      </div>
                      <StatusBadge
                        tone={
                          state.confirmed[d]
                            ? "success"
                            : t.completed === t.count && t.count
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {state.confirmed[d]
                          ? "已确认"
                          : t.completed === t.count && t.count
                            ? "待部门确认"
                            : "拆分中"}
                      </StatusBadge>
                      <span className="dept-amount">
                        ¥ {formatMoney(t.budget)}
                      </span>
                      <ArrowRight size={18} />
                    </div>
                    <div
                      className="budget-bar"
                      role="img"
                      aria-label={`${d} 已分配 ${formatMoney(t.allocated)}，待分配 ${formatMoney(t.pool)}`}
                    >
                      <span
                        style={{
                          width: `${t.budget ? Math.min(100, (t.allocated / t.budget) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <div className="budget-bar-label">
                      <span>已分配 ¥ {formatMoney(t.allocated)}</span>
                      <span>待分配 ¥ {formatMoney(t.pool)}</span>
                    </div>
                  </button>
                );
              })}
              <div className="table-note">
                待分配预算计入年度总盘，正式提交后也会保留。
              </div>
            </>
          ) : (
            <EmptyState
              title="从准备预算开始"
              description="导入客户模板或在线新增预算项目。"
              action={
                <Button onClick={() => navigate("database")}>准备数据</Button>
              }
            />
          )}
        </Panel>
        <Panel
          title="需要关注"
          description="根据当前分配实时更新"
          actions={
            <StatusBadge
              tone={
                insight.some((i) => i.level === "risk") ? "danger" : "warning"
              }
            >
              {insight.length} 条提示
            </StatusBadge>
          }
        >
          <InsightList items={insight.slice(0, 3)} />
          <div className="insight-footnote">
            45% 集中度、30% 调整幅度、20% 待分配比例为演示阈值，业务口径待确认。
          </div>
          <Button
            appearance="subtle"
            className="full-button"
            icon={<ArrowRight />}
            iconPosition="after"
            onClick={() => navigate("adjust")}
          >
            查看部门洞察
          </Button>
        </Panel>
      </div>
      <div className="overview-bottom">
        <Panel
          title="数据就绪情况"
          actions={
            <Button
              appearance="subtle"
              size="small"
              onClick={() => navigate("database")}
            >
              管理数据
            </Button>
          }
        >
          <div className="readiness-list">
            {[
              {
                label: "预算总盘",
                count: state.budgets.length,
                unit: "个项目",
              },
              {
                label: "历史表现",
                count: state.history.length,
                unit: "条记录",
              },
              {
                label: "明年预计",
                count: state.forecast.length,
                unit: "条记录",
              },
            ].map((item) => (
              <div key={item.label}>
                <Database size={18} />
                <span>{item.label}</span>
                <b>
                  {item.count} <small>{item.unit}</small>
                </b>
                <StatusBadge tone={item.count ? "success" : "neutral"}>
                  {item.count ? "已准备" : "待导入"}
                </StatusBadge>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="最近操作">
          <div className="activity-list">
            {state.audit.length ? (
              state.audit.slice(0, 3).map((a) => (
                <div key={a.id}>
                  <span className="activity-point" />
                  <span>{a.text}</span>
                  <time>
                    {new Date(a.time).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              ))
            ) : (
              <p className="muted">开始调整后，操作记录会显示在这里。</p>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
