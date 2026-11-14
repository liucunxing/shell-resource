import { useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import { PageHead } from "./OverviewPages.jsx";
import { PlanningVersionBar as VersionBar } from "./PlanningVersionBar.jsx";
import { PlanningVersionsPage } from "./PlanningVersionsPage.jsx";
import { StudioConfiguration } from "./StudioConfiguration.jsx";
import { AdminUsersPanel } from "./AdminUsersPanel.jsx";
import { HistoricalResourceSettings } from "./HistoricalResourceSettings.jsx";
import { WorkflowDialog } from "./WorkflowDialog.jsx";

const num = (value, digits = 1) =>
  Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const time = (value) => (value ? new Date(value).toLocaleString("zh-CN") : "—");
const ADMIN_META = {
  "admin-versions": [
    "ADMINISTRATION / VERSIONS",
    "版本与发布",
    "创建、发布规划版本；控制开放 / 关闭提交",
  ],
  "admin-initiatives": [
    "ADMINISTRATION / INITIATIVES",
    "本版项目配置",
    "每个版本独立维护 Initiative 清单、预算、资源大类与 Owner",
  ],
  "admin-users": [
    "ADMINISTRATION / ACCESS",
    "用户与权限",
    "维护登录账号、角色和 Sector / Department 数据范围",
  ],
  "admin-enums": [
    "ADMINISTRATION / ENUMS",
    "组织与枚举",
    "维护 Sector、Department、资源大类和历史数据期间",
  ],
  "admin-thresholds": [
    "ADMINISTRATION / HEALTH RULES",
    "健康检查阈值",
    "配置集中度和经销商超配 / 低配的提醒阈值",
  ],
  "admin-audit": [
    "ADMINISTRATION / AUDIT",
    "操作审计",
    "查看版本、配置、草稿和提交的关键操作记录",
  ],
};

function InitiativesPage({
  items,
  identity,
  roles,
  apiMode,
  mutate,
  manageAdminBudget,
  notify,
  state,
  previewMode,
}) {
  const [query, setQuery] = useState(""),
    [editing, setEditing] = useState(null),
    [busy, setBusy] = useState(false), [error, setError] = useState("");
  const filtered = items.filter((item) =>
    `${item.id} ${item.name} ${item.ownerId}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const open = (item = null) => { setError(""); setEditing(
      item
        ? { ...item, budgetWan: item.budget / 10000, reason: "" }
        : {
            id: "",
            name: "",
            sector: "PCMO",
            department: "MKT",
            resourceType: "MRD",
            ownerId: "",
            budgetWan: 0,
            enabled: true,
            reason: "",
          },
    ); };
  const save = async () => {
    const payload = {
      id: editing.id,
      name: editing.name.trim(),
      sector: editing.sector,
      department: editing.department,
      resourceType: editing.resourceType,
      ownerId: editing.ownerId,
      budget: Math.round(Number(editing.budgetWan) * 10000),
      enabled: editing.enabled !== false,
      reason: editing.reason.trim(),
    };
    if (!payload.name || !payload.ownerId || !Number.isFinite(payload.budget) || payload.budget < 0 || (state.planningVersion && !payload.reason))
      return notify("请完整填写名称、Owner、变更原因与非负预算。", true);
    setBusy(true);
    try {
      if (apiMode)
        await manageAdminBudget(
          items.some((item) => item.id === editing.id) ? "edit" : "create",
          editing,
          payload,
        );
      else
        mutate((draft) => {
          const exists = draft.initiatives.some(
            (item) => item.id === editing.id,
          );
          if (exists)
            E.editAdminBudget(draft, editing.id, payload, identity, roles);
          else E.applyAdminConfiguration(draft, [], identity, roles, [payload]);
        }, "本版项目配置已更新。");
      setEditing(null);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <VersionBar />
      <section className="panel studio-admin-panel">
        <div className="panel-header">
          <div>
            <h2>{state.planningVersion?.name || "历史工作区"} · 项目清单与预算</h2>
            <p>
              {items.length} 项 · 总预算 {num(E.totals(items).budget / 10000)}{" "}
              万
            </p>
          </div>
          <button className="button primary" disabled={previewMode} onClick={() => open()}>
            ＋ 本版新增 Initiative
          </button>
        </div>
        <div className="studio-table-toolbar">
          <input
            type="search"
            placeholder="搜索编码 / Initiative / Owner"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span>
            显示 {filtered.length} / {items.length} 项
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>编码 / Initiative</th>
                <th>Sector / 部门</th>
                <th>Resource Type</th>
                <th>Owner</th>
                <th className="num">预算（万）</th>
                <th>本版状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    <small>{item.id}</small>
                  </td>
                  <td>
                    {item.sector}
                    <small>{item.department}</small>
                  </td>
                  <td>{item.resourceType}</td>
                  <td>{item.ownerId}</td>
                  <td className="num">{num(item.budget / 10000)}</td>
                  <td>
                    <span className={`resource-status ${item.enabled === false ? "editing" : "done"}`}>{item.enabled === false ? "停用" : "启用"}</span>
                  </td>
                  <td>
                    <button className="button small" disabled={previewMode} onClick={() => open(item)}>
                      编辑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && (
        <WorkflowDialog title={editing.id ? "编辑 Initiative" : "本版新增 Initiative"} busy={busy} onClose={() => setEditing(null)} onConfirm={save} confirmLabel="保存项目">
          <p>预算与归属变更保留原名单和金额，撤回对应提交与部门确认；版本需重新发布。</p>
          <div className="v19-form-grid">
          {[
            ["Initiative 名称", "name"],
            ["Sector", "sector"],
            ["Department", "department"],
            ["Resource Type", "resourceType"],
            ["Owner", "ownerId"],
            ["预算（万）", "budgetWan"],
          ].map(([label, key]) => (
            <label key={key}>
              {label}
              <input
                type={key === "budgetWan" ? "number" : "text"}
                value={editing[key]}
                disabled={
                  key === "id" && items.some((item) => item.id === editing.id)
                }
                onChange={(event) =>
                  setEditing({ ...editing, [key]: event.target.value })
                }
              />
            </label>
          ))}
          </div>
          <label className="v19-scope-label"><input type="checkbox" checked={editing.enabled !== false} onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })} />本版启用</label>
          <label>变更原因（必填）<textarea value={editing.reason} onChange={(event) => setEditing({ ...editing, reason: event.target.value })} /></label>
          {error && <p className="note-box warn" role="alert">{error}</p>}
        </WorkflowDialog>
      )}
    </>
  );
}

export function AuditPage({ audit }) {
  const [query, setQuery] = useState("");
  const filtered = audit.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="panel studio-admin-panel">
      <div className="studio-table-toolbar">
        <span>共 {filtered.length} 条操作记录</span>
        <input type="search" placeholder="搜索操作人 / 对象 / 动作" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>操作人</th>
              <th>动作</th>
              <th>对象</th>
              <th>摘要</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, index) => (
              <tr key={row.id || index}>
                <td>{time(row.at || row.createdAt)}</td>
                <td>{typeof row.actor === "object" ? row.actor?.label || row.operator || "—" : row.actor || row.user || row.operator || "—"}</td>
                <td>{row.action || row.type || "—"}</td>
                <td>{row.object || row.target || row.scope || row.initiativeId || "—"}</td>
                <td>{row.detail || row.note || row.message || row.summary || "—"}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan="5">
                  <div className="empty">暂无操作审计记录。</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function AdminStudioPage() {
  const context = useWorkbench();
  const {
    page,
    view,
    state,
    identity,
    roles,
    apiMode,
    mutate,
    manageAdminBudget,
    notify,
  } = context;
  if (identity.role !== "admin")
    return <div className="empty">仅系统管理员可访问。</div>;
  const items = view.initiatives || [],
    meta = ADMIN_META[page] || ADMIN_META["admin-versions"];
  return (
    <>
      <PageHead eyebrow={meta[0]} title={meta[1]} description={meta[2]} />
      {page === "admin-versions" && (
        <PlanningVersionsPage />
      )}
      {page === "admin-initiatives" && (
        <InitiativesPage
          items={items}
          state={state}
          previewMode={context.previewMode}
          identity={identity}
          roles={roles}
          apiMode={apiMode}
          mutate={mutate}
          manageAdminBudget={manageAdminBudget}
          notify={notify}
        />
      )}
      {page === "admin-users" && (
        <><section className="panel studio-admin-panel"><AdminUsersPanel /></section>
          <HistoricalResourceSettings mapping={state.departmentResources || {}} roleMapping={state.roleResources} departments={[...new Set(items.map((item) => item.department))]} saveConfig={context.saveConfig} readOnly={context.previewMode} /></>
      )}
      {page === "admin-enums" && <StudioConfiguration />}
      {page === "admin-thresholds" && <StudioConfiguration thresholds />}
      {page === "admin-audit" && <AuditPage audit={state.audit || []} />}
    </>
  );
}
