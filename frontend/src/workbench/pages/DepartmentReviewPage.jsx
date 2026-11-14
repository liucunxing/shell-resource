import { useEffect, useMemo, useState } from "react";
import * as api from "../api.js";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import { PageHead } from "./OverviewPages.jsx";
import { PlanningVersionBar } from "./PlanningVersionBar.jsx";
import { WorkflowDialog } from "./WorkflowDialog.jsx";

const money = (value) => Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const stamp = (value) => value ? new Date(value).toLocaleString("zh-CN") : "—";
export function reviewStatus(item) {
  return item.workflow?.requiresResubmission ? "退回待重提" : item.workflow?.submitted ? "已提交" : "未提交";
}

export function DepartmentReviewPage() {
  const { state, identity, refresh, notify, previewMode, apiMode } = useWorkbench();
  const scopes = useMemo(() => [...new Map((state.initiatives || []).map((item) =>
    [`${item.sector}|${item.department}`, { sector: item.sector, department: item.department }])).entries()], [state.initiatives]);
  const [scope, setScope] = useState("");
  const scopeKey = scopes.some(([key]) => key === scope) ? scope : scopes[0]?.[0] || "";
  const selectedScope = scopes.find(([key]) => key === scopeKey)?.[1];
  const [result, setResult] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState(null), [reason, setReason] = useState(""), [busy, setBusy] = useState(false);
  const [sort, setSort] = useState({ key: "name", direction: 1 });
  const current = state.planningVersion;
  const load = async () => {
    if (!current || !selectedScope) return;
    setLoading(true); setError("");
    try { setResult(await api.departmentReview(current.id, selectedScope.sector, selectedScope.department)); }
    catch (failure) { setError(failure.message); setResult(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { let live = true; setResult(null); setError("");
    if (!apiMode || !current || !selectedScope) return;
    setLoading(true);
    api.departmentReview(current.id, selectedScope.sector, selectedScope.department)
      .then((value) => { if (live) setResult(value); })
      .catch((failure) => { if (live) setError(failure.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [apiMode, current?.id, current?.revision, scopeKey]);
  if (!["lead", "admin"].includes(identity.role)) return <div className="empty">仅部门负责人可确认部门方案。</div>;
  const items = [...(result?.items || [])].sort((a, b) => {
    const value = (item) => sort.key === "status" ? reviewStatus(item) : item[sort.key] || "";
    return String(value(a)).localeCompare(String(value(b)), "zh-CN", { numeric: true }) * sort.direction;
  });
  const sortBy = (key) => setSort((old) => ({ key, direction: old.key === key ? -old.direction : 1 }));
  const start = (action, target = {}) => { setReason(""); setError(""); setDialog({ action, ...target }); };
  const act = async () => {
    setBusy(true); setError("");
    try {
      await api.reviewDepartment(current.id, dialog.action, {
        ...selectedScope, expected_revision: result.version.revision,
        ...(dialog.action !== "confirm" ? { reason: reason.trim() } : {}),
        ...(dialog.initiative ? { initiative_id: Number(dialog.initiative.id) } : {}),
        ...(dialog.owner ? { owner_email: dialog.owner } : {}),
      });
      setDialog(null);
      await refresh({ preservePage: true });
      await load();
      notify(dialog.action === "confirm" ? "部门方案已统一确认。" : dialog.action === "withdraw" ? "已撤回部门确认，Owner 提交仍保留。" : "所选范围已退回，等待 Owner 重新提交。");
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  return <>
    <PageHead eyebrow="DEPARTMENT / CONFIRMATION" title="确认部门方案" description="全部启用项目提交齐全后统一确认；确认后最高管理层才能查看分配。" />
    <PlanningVersionBar />
    {!current ? <div className="empty">请由管理员创建并发布规划版本。</div> : <>
      {scopes.length > 1 && <label className="v19-scope-label">确认范围<select value={scopeKey} onChange={(event) => setScope(event.target.value)}>{scopes.map(([key, item]) => <option key={key} value={key}>{item.sector} · {item.department}</option>)}</select></label>}
      {error && !dialog && <div className="note-box warn" role="alert">{error}<button className="button small" onClick={load}>重试</button></div>}
      <section className="panel studio-admin-panel">
        <div className="panel-header"><div><h2>{selectedScope ? `${selectedScope.sector} · ${selectedScope.department}` : "当前部门"}</h2>
          <p>{loading ? "正在加载提交状态…" : `${result?.submitted || 0} / ${result?.total || 0} 项已提交 · ${result?.confirmed ? "部门已确认" : "部门未确认"}`}</p></div>
          <div className="actions">
            {result?.confirmed ? <button className="button" disabled={previewMode || busy} onClick={() => start("withdraw")}>撤回部门确认</button> : <>
              <button className="button" disabled={previewMode || busy || !result?.submitted} onClick={() => start("return")}>退回全部 Owner</button>
              <button className="button primary" disabled={previewMode || busy || !result?.canConfirm} onClick={() => start("confirm")}>统一确认部门方案</button>
            </>}
          </div>
        </div>
        {!result?.canConfirm && !result?.confirmed && <p className="studio-table-note">有未提交或退回待重提项目时，不能统一确认。版本关闭或截止后需管理员重新开放。</p>}
        <div className="table-scroll"><table><thead><tr>
          {[["name", "Initiative"], ["ownerId", "Owner"], ["status", "Owner 提交状态"]].map(([key, label]) => <th key={key} aria-sort={sort.key === key ? sort.direction === 1 ? "ascending" : "descending" : "none"}><button className="v19-sort" onClick={() => sortBy(key)}>{label}{sort.key === key ? sort.direction === 1 ? " ↑" : " ↓" : " ↕"}</button></th>)}
          <th>部门确认</th><th>提交修订 / 时间</th><th className="num">分配 / 预留</th><th>退回原因</th><th>操作</th>
        </tr></thead><tbody>{items.map((item) => <tr key={item.id}>
          <td><strong>{item.name}</strong><small>{item.initiativeKey || item.id}</small></td><td>{item.ownerLabel || item.ownerId}</td>
          <td><span className={`resource-status ${item.workflow?.submitted ? "done" : "editing"}`}>{reviewStatus(item)}</span></td>
          <td>{item.workflow?.confirmed ? "已确认" : "未确认"}</td>
          <td>{item.workflow?.submittedRevision != null ? `r${item.workflow.submittedRevision}` : "—"}<small>{stamp(item.workflow?.submittedAt || item.publishedAt)}</small></td>
          <td className="num">{money(E.totals([item]).allocated)} / {money(E.totals([item]).otherBudget)}</td><td>{item.workflow?.returnReason || "—"}</td>
          <td><div className="actions"><button className="button small" disabled={previewMode || result.confirmed || !item.workflow?.submitted} onClick={() => start("return", { initiative: item })}>退回项目</button>
            <button className="button small" disabled={previewMode || result.confirmed || !item.workflow?.submitted} onClick={() => start("return", { owner: item.ownerId })}>退回该 Owner</button></div></td>
        </tr>)}{!loading && !items.length && <tr><td colSpan="8"><div className="empty">当前范围没有启用项目。</div></td></tr>}</tbody></table></div>
      </section>
    </>}
    {dialog && <WorkflowDialog title={dialog.action === "confirm" ? "统一确认部门方案" : dialog.action === "withdraw" ? "撤回部门确认" : "退回方案"}
      busy={busy} onClose={() => setDialog(null)} onConfirm={act} disabled={dialog.action !== "confirm" && !reason.trim()}>
      <p>{dialog.action === "confirm" ? `将确认完整部门范围的 ${result.total} 个项目，单个项目筛选不会改变确认范围。` : dialog.action === "withdraw" ? "仅撤回部门确认与管理层可见性，保留全部 Owner 提交。未退回项目可直接再次统一确认。" : dialog.initiative ? `仅退回 ${dialog.initiative.name}；同一 Owner 的其他项目保持提交。` : dialog.owner ? `退回 ${dialog.owner} 在当前部门范围的项目；其他 Owner 保持提交。` : "退回当前部门范围全部已提交项目。"}</p>
      {dialog.action !== "confirm" && <label>原因（必填）<textarea rows="3" maxLength="160" value={reason} onChange={(event) => setReason(event.target.value)} /></label>}
      {error && <p role="alert" className="note-box warn">{error}</p>}
    </WorkflowDialog>}
  </>;
}
