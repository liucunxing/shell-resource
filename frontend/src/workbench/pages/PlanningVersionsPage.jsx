import { useState } from "react";
import * as api from "../api.js";
import { useWorkbench } from "../WorkbenchContext.jsx";
import { versionStatus } from "./PlanningVersionBar.jsx";
import { WorkflowDialog } from "./WorkflowDialog.jsx";

export function PlanningVersionsPage() {
  const { state, refresh, selectPlanningVersion, navigate, notify, previewMode, apiMode } = useWorkbench();
  const versions = state.planningVersions || [];
  const [dialog, setDialog] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [form, setForm] = useState({ id: "", name: "", source_version_id: state.currentVersionId || "", deadline: "" });
  const open = (value) => { setError(""); setDialog(value); };
  const persist = async () => {
    setBusy(true); setError("");
    try {
      if (dialog.kind === "create") {
        await api.createPlanningVersion({ id: form.id.trim(), name: form.name.trim(),
          ...(form.source_version_id ? { source_version_id: form.source_version_id } : {}),
          ...(form.deadline ? { deadline: new Date(form.deadline).toISOString() } : {}) });
        api.setPlanningVersion(form.id.trim());
      } else {
        await api.updatePlanningVersion(dialog.version.id, { expected_revision: dialog.version.revision,
          ...(dialog.kind === "publish" ? { published: true, open: true } : { open: dialog.kind === "open" }),
          ...(dialog.kind === "open" ? { deadline: form.deadline ? new Date(form.deadline).toISOString() : null } : {}),
        });
      }
      setDialog(null); await refresh({ preservePage: true }); notify("规划版本已保存。");
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <section className="panel studio-admin-panel">
    <div className="panel-header"><div><h2>规划版本</h2><p>复制来源版本最后已提交的方案为草稿；不继承提交、确认及退回状态，预算变化不自动缩放金额。</p></div>
      <button className="button primary" disabled={previewMode || !apiMode} onClick={() => open({ kind: "create" })}>＋ 创建规划版本</button></div>
    <div className="table-scroll"><table><thead><tr><th>版本 / 来源</th><th>名称</th><th>规划年度</th><th>状态</th><th>截止时间</th><th>操作</th></tr></thead>
      <tbody>{versions.map((version) => <tr key={version.id}><td><strong>{version.id}</strong><small>来源 {version.sourceVersionId || "历史预算"}</small></td><td>{version.name}</td><td>{version.planningYear}</td>
        <td><span className={`resource-status ${version.open && version.published ? "done" : "editing"}`}>{versionStatus(version)}</span></td>
        <td>{version.deadline ? new Date(version.deadline).toLocaleString("zh-CN") : "未设置"}</td>
        <td><div className="actions"><button className="button small" onClick={async () => { if (await selectPlanningVersion(version.id)) navigate("admin-initiatives"); }}>配置项目</button>
          {!version.published ? <button className="button primary small" disabled={previewMode} onClick={() => open({ kind: "publish", version })}>发布并开放</button> :
            <button className="button small" disabled={previewMode} onClick={() => { setForm((old) => ({ ...old, deadline: "" })); open({ kind: version.open ? "close" : "open", version }); }}>{version.open ? "关闭提交" : "重新开放"}</button>}</div></td>
      </tr>)}{!versions.length && <tr><td colSpan="6"><div className="empty">尚未创建规划版本。首次创建将从历史年度预算与最后提交快照建立独立版本。</div></td></tr>}</tbody></table></div>
    {dialog && <WorkflowDialog title={dialog.kind === "create" ? "创建规划版本" : `${dialog.kind === "publish" ? "发布并开放" : dialog.kind === "close" ? "关闭提交" : "重新开放"} · ${dialog.version.name}`}
      busy={busy} onClose={() => setDialog(null)} onConfirm={persist} disabled={dialog.kind === "create" && (!/^20\d{2}(0[1-9]|1[0-2])$/.test(form.id) || !form.name.trim())}>
      {dialog.kind === "create" ? <div className="v19-form-grid">
        <label>版本编码（YYYYMM）<input value={form.id} maxLength="6" onChange={(event) => setForm({ ...form, id: event.target.value.replace(/\D/g, "") })} placeholder="例如 202701" /></label>
        <label>版本名称<input value={form.name} maxLength="100" onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label>复制来源<select value={form.source_version_id} onChange={(event) => setForm({ ...form, source_version_id: event.target.value })}><option value="">历史年度预算</option>{versions.map((version) => <option key={version.id} value={version.id}>{version.id} · {version.name}</option>)}</select></label>
      </div> : <p>{dialog.kind === "close" ? "关闭后所有 Owner 停止编辑和提交。已提交、已确认方案保留。" : "开放当前版本后，其他版本关闭编辑。Owner 提交状态保持不变；需修改的项目应由部门负责人退回。"}</p>}
      {["create", "open"].includes(dialog.kind) && <label>提交截止时间（可选）<input type="datetime-local" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} /></label>}
      {error && <p className="note-box warn" role="alert">{error}</p>}
    </WorkflowDialog>}
  </section>;
}
