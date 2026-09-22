import { useEffect, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import A from "../domain/explore.js";
import { PageHead } from "./OverviewPages.jsx";
const fmt = (n) => n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
export function RawPage() {
  const { state, identity, data, rawRequest, notify } = useWorkbench();
  const [tab, setTab] = useState(""),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  useEffect(() => {
    if (rawRequest) {
      setTab(rawRequest.tab || "");
      setSearch(rawRequest.search || "");
      setPage(1);
    }
  }, [rawRequest]);
  const model = A.rawData(state, identity, data, tab || undefined),
    rows = A.filterRows(model, search),
    pages = Math.max(1, Math.ceil(rows.length / 15)),
    current = Math.min(page, pages);
  const exportCsv = () => {
    try {
      const url = URL.createObjectURL(
        new Blob([A.csv(model, search)], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `资源规划_${model.tab}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("已导出当前筛选的数据。");
    } catch {
      notify("导出失败，请重试。", true);
    }
  };
  return (
    <>
      <PageHead
        title="原始数据"
        description="查询与导出当前角色权限内的数据。"
      />
      <section className="panel raw-panel">
        <div className="panel-head">
          <div>
            <h2>{model.title}</h2>
            <p>
              {model.scopeLabel} · {model.basisLabel}
            </p>
          </div>
          <button className="button" onClick={exportCsv}>
            导出当前筛选 CSV
          </button>
        </div>
        <div className="toolbar">
          {model.tabs.map((t) => (
            <button
              key={t.id}
              className={`button ${t.id === model.tab ? "primary" : ""}`}
              aria-pressed={t.id === model.tab}
              onClick={() => {
                setTab(t.id);
                setPage(1);
              }}
            >
              {t.label}
            </button>
          ))}
          <label>
            搜索{" "}
            <input
              type="search"
              value={search}
              placeholder="搜索当前权限内的数据"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {model.columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice((current - 1) * 15, current * 15).map((r, n) => (
                <tr key={`${model.tab}-${current}-${n}`}>
                  {model.columns.map((c) => (
                    <td key={c.key}>
                      {typeof r[c.key] === "number" ? fmt(r[c.key]) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={model.columns.length}>暂无匹配数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="toolbar raw-pagination">
          <span>
            共 {rows.length} 行 · 第 {current} / {pages} 页
          </span>
          <button
            className="button"
            disabled={current === 1}
            onClick={() => setPage(current - 1)}
          >
            上一页
          </button>
          <button
            className="button"
            disabled={current === pages}
            onClick={() => setPage(current + 1)}
          >
            下一页
          </button>
        </div>
        <div className="raw-notes">
          {model.notes.map((n) => (
            <p key={n} className="muted">
              {n}
            </p>
          ))}
        </div>
      </section>
    </>
  );
}
export function TrackingPage() {
  const { identity, navigate } = useWorkbench();
  const home =
    identity.role === "owner"
      ? "home"
      : identity.role === "lead"
        ? "department"
        : identity.role === "admin"
          ? "admin"
          : "management";
  return (
    <>
      <PageHead
        title="执行追踪"
        description="后续规划 · 一期聚焦年度资源分配与持续更新。"
      />
      <section className="panel">
        <div className="empty" style={{ padding: "65px 24px" }}>
          <span className="badge blue">功能预留</span>
          <h2 style={{ margin: "15px 0 8px" }}>2027 执行 Tracking 尚未定义</h2>
          <p>
            未来可基于年度资源方案继续跟踪。指标、数据来源和业务流程需另行确认，当前不展示虚构的实际支出、利用率或季度分析。
          </p>
          <button className="button" onClick={() => navigate(home)}>
            返回当前工作区
          </button>
        </div>
      </section>
    </>
  );
}
export function AboutPage() {
  const { data } = useWorkbench();
  const definitions = [
    ["数据来源", data.metadata.sourceFile],
    ["2027 计划", "75 项 Initiative / 600 条分配 / 总预算 6,402,000"],
    ["金额单位", "源文件未标注；原值保留，不默认解释为元、千元或万元。"],
    ["经销商", "60 个编码。没有源名称，不补造名称。"],
    ["2024 / 2025", "全年历史 Vol 与 C3；2025 资源按四类明细重新核对加总。"],
    ["2026", "1—8 月累计为演示假设；不直接计算全年同比、不年化。"],
    [
      "2025 C3 Yield",
      "2025 C3 ÷ 2025 总资源，分母为 0 则留空。整体 Yield 向所有角色共享只读；跨部门资源明细仍按部门隔离。",
    ],
    ["2025 单升资源", "2025 总资源 ÷ 2025 Vol，分母为 0 则留空。"],
    [
      "历史去重",
      "经销商历史仅保存一份，不复制到多个 Initiative / Sector 后加总。",
    ],
    [
      "未提供的数据",
      "2027 预计 Vol / C3、实际执行支出、经销商名称均保持未提供。",
    ],
  ];
  return (
    <>
      <PageHead
        title="数据口径与演示说明"
        description="区分源数据、演示配置和后续待接入能力。"
      />
      <div className="columns">
        <div className="main-column">
          <section className="panel">
            <div className="panel-header">
              <h2>源数据与计算口径</h2>
            </div>
            <div className="panel-body">
              <dl className="definition-grid">
                {definitions.map(([name, value]) => (
                  <Definition key={name} name={name} value={value} />
                ))}
              </dl>
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>一期目标架构</h2>
              <span className="badge">未接通</span>
            </div>
            <div className="panel-body">
              <div className="flow-diagram">
                <span>工作台前端</span>
                <b>→</b>
                <span>应用后端</span>
                <b>→</b>
                <span>PostgreSQL</span>
              </div>
              <p className="small-text muted">
                Databricks 每月人工触发参考数据推送；应用后端从 PG
                提取授权事实调用允许的 LLM，并保存 Insight 与依据版本。
              </p>
            </div>
          </section>
        </div>
        <aside className="aside-stack">
          <section className="panel">
            <div className="panel-header">
              <h2>演示能力边界</h2>
            </div>
            <div className="panel-body">
              {[
                [
                  "本地可交互",
                  "拆分、Excel 往返、反复同步、最新版本汇总与本人/部门 Insight。",
                ],
                [
                  "模拟配置",
                  "MKT / ICE / CAPEX，Owner 编号、意见、批次发布与 AI 分析。",
                ],
                [
                  "未连接服务",
                  "SSO、PG、真实后端鉴权、多人协作、真实 LLM、AI4BI iframe。",
                ],
              ].map(([name, value]) => (
                <div className="list-item" key={name}>
                  <b>{name}</b>
                  <p className="small-text muted">{value}</p>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>快速演示顺序</h2>
            </div>
            <div className="panel-body">
              <ol className="small-text muted">
                <li>Marketer 配置本人 Initiative</li>
                <li>添加其他预算安排并配平</li>
                <li>查看本人汇总或单项 Insight</li>
                <li>同步最新分配</li>
                <li>管理层筛选、排序查看最新版本</li>
                <li>Marketer 再次调整并同步，最新更新时间随之刷新</li>
              </ol>
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
function Definition({ name, value }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </>
  );
}
