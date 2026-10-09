import { useEffect, useRef, useState } from "react";
import * as api from "../api.js";
import { useWorkbench } from "../WorkbenchContext.jsx";

const PAGE_SIZE = 20;
const DEPARTMENTS = ["MKT", "ICE", "CAPEX"];
const SECTORS = ["PCMO", "CRTO", "B2B", "OEM"];
const EMPTY_FILTERS = { email: "", name: "", role: "", department: "", sector: "" };
const EMPTY_USER = {
  email: "", display_name: "", role: "owner", department: "MKT", sector: [], enabled: true,
};
const ROLE_LABELS = {
  owner: "Owner", lead: "部门负责人", management: "管理层", admin: "管理员",
};
export const userDepartmentOptions = (current) =>
  [...new Set([...DEPARTMENTS, current].filter(Boolean))];
export const departmentAfterRoleChange = (role, current) =>
  ["owner", "lead"].includes(role) && !current ? DEPARTMENTS[0] : current;
export const sectorAfterRoleChange = (role, current) => {
  if (!["owner", "lead"].includes(role)) return [];
  return role === "owner" ? current.slice(0, 1) : current;
};
export const toggleSectorSelection = (role, current, sector) => {
  if (current.includes(sector)) return current.filter((value) => value !== sector);
  return role === "owner" ? [sector] : [...current, sector];
};

function UserDialog({ title, children, onClose, onConfirm, confirmLabel, saving }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal user-dialog"
      aria-labelledby="user-dialog-title"
      onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}
    >
      <div className="modal-head">
        <h2 id="user-dialog-title">{title}</h2>
        <button type="button" className="button" onClick={onClose} disabled={saving} aria-label="关闭弹窗">×</button>
      </div>
      <div className="modal-body">{children}</div>
      <div className="modal-foot">
        <button type="button" className="button" onClick={onClose} disabled={saving}>
          {onConfirm ? "取消" : "关闭"}
        </button>
        {onConfirm && (
          <button type="button" className="button primary" onClick={onConfirm} disabled={saving}>
            {saving ? "处理中…" : confirmLabel}
          </button>
        )}
      </div>
    </dialog>
  );
}

export function AdminUsersPanel() {
  const { identity, notify, refresh } = useWorkbench();
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState(EMPTY_USER);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    api.listAdminUsers(filters, PAGE_SIZE, offset)
      .then((data) => { if (active) setResult(data); })
      .catch((error) => { if (active) setLoadError(error.message || "人员列表加载失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, offset, revision, identity?.email]);

  const close = () => { if (!saving) { setDialog(null); setFormError(""); } };
  const open = (kind, user = null) => {
    setFormError("");
    if (user?.has_initiatives) {
      setDialog({ kind: "blocked", user });
      return;
    }
    setForm(user ? {
      email: user.email,
      display_name: user.display_name,
      role: user.role,
      department: user.department || "",
      sector: user.sector || [],
      enabled: user.enabled,
    } : { ...EMPTY_USER });
    setDialog({ kind, user });
  };

  async function persist() {
    if (!dialog || saving) return;
    if (dialog.kind !== "delete") {
      const email = form.email.trim().toLowerCase();
      const displayName = form.display_name.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setFormError("请输入有效的邮箱地址。");
        return;
      }
      if (!displayName) { setFormError("姓名不能为空。"); return; }
      if (["owner", "lead"].includes(form.role) && !form.department.trim()) {
        setFormError("Owner 和部门负责人必须填写部门。");
        return;
      }
      if (form.role === "owner" && form.sector.length !== 1) {
        setFormError("Owner 必须选择一条业务线。");
        return;
      }
      if (form.role === "lead" && !(form.sector.length >= 1 && form.sector.length <= 4)) {
        setFormError("部门负责人必须选择一至四条业务线。");
        return;
      }
    }
    setSaving(true);
    setFormError("");
    try {
      if (dialog.kind === "delete") {
        await api.deleteAdminUser(dialog.user.id);
      } else {
        const payload = {
          email: form.email.trim().toLowerCase(),
          display_name: form.display_name.trim(),
          role: form.role,
          department: ["owner", "lead"].includes(form.role)
            ? form.department.trim().toUpperCase() : null,
          sector: ["owner", "lead"].includes(form.role) ? form.sector : [],
          enabled: form.enabled,
        };
        if (dialog.kind === "create") await api.createAdminUser(payload);
        else await api.updateAdminUser(dialog.user.id, payload);
      }
      const action = { create: "新增", edit: "修改", delete: "删除" }[dialog.kind];
      setDialog(null);
      notify(`人员${action}成功。`);
      if (dialog.kind === "delete" && result.items.length === 1 && offset > 0)
        setOffset(Math.max(0, offset - PAGE_SIZE));
      else setRevision((value) => value + 1);
      await refresh();
    } catch (error) {
      if (error.status === 409 && error.message?.includes("Initiative")) {
        setDialog({ kind: "blocked", user: dialog.user });
      } else {
        setFormError(error.message || "操作失败，请重试。");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="user-list-heading">
        <p className="small-text muted">维护邮箱、姓名、角色、部门和业务线；已有 Initiative 的用户不可修改或删除。</p>
        <button type="button" className="button primary" onClick={() => open("create")}>新增人员</button>
      </div>
      <form
        className="user-filters"
        onSubmit={(event) => { event.preventDefault(); setOffset(0); setFilters({ ...draftFilters }); }}
      >
        <label className="form-field">邮箱
          <input value={draftFilters.email} maxLength={255} placeholder="模糊搜索邮箱"
            onChange={(event) => setDraftFilters({ ...draftFilters, email: event.target.value })} />
        </label>
        <label className="form-field">姓名
          <input value={draftFilters.name} maxLength={255} placeholder="模糊搜索姓名"
            onChange={(event) => setDraftFilters({ ...draftFilters, name: event.target.value })} />
        </label>
        <label className="form-field">角色
          <select value={draftFilters.role}
            onChange={(event) => setDraftFilters({ ...draftFilters, role: event.target.value })}>
            <option value="">全部角色</option>
            {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="form-field">部门
          <input list="admin-user-filter-departments" value={draftFilters.department}
            maxLength={32} placeholder="全部部门"
            onChange={(event) => setDraftFilters({ ...draftFilters, department: event.target.value })} />
          <datalist id="admin-user-filter-departments">
            {DEPARTMENTS.map((value) => <option key={value} value={value} />)}
          </datalist>
        </label>
        <label className="form-field">业务线
          <select value={draftFilters.sector}
            onChange={(event) => setDraftFilters({ ...draftFilters, sector: event.target.value })}>
            <option value="">全部业务线</option>
            {SECTORS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <div className="user-filter-actions">
          <button type="submit" className="button primary">搜索</button>
          <button type="button" className="button" onClick={() => {
            setDraftFilters({ ...EMPTY_FILTERS }); setFilters({ ...EMPTY_FILTERS }); setOffset(0);
          }}>重置</button>
        </div>
      </form>
      {loadError && <div className="note-box error" role="alert">
        {loadError} <button type="button" className="button" onClick={() => setRevision((v) => v + 1)}>重试</button>
      </div>}
      <div className={`user-list-wrap${loading ? " is-loading" : ""}`} aria-busy={loading}>
        <div className="table-scroll">
          <table className="contract-table">
            <thead><tr>
              <th>邮箱</th><th>姓名</th><th>角色</th><th>部门</th><th>业务线</th><th>状态</th><th>预算关联</th><th>操作</th>
            </tr></thead>
            <tbody>
              {result.items.map((user) => <tr key={user.id}>
                <td>{user.email}</td>
                <td>{user.display_name}</td>
                <td>{ROLE_LABELS[user.role] || user.role}</td>
                <td>{user.department || "—"}</td>
                <td>{user.sector?.length ? user.sector.join("、") : "—"}</td>
                <td><span className={`badge ${user.enabled ? "teal" : "amber"}`}>
                  {user.enabled ? "启用" : "停用"}</span></td>
                <td>{user.has_initiatives ? <span className="badge amber">已有 Initiative</span> : "无"}</td>
                <td><div className="actions">
                  <button type="button" className="button small" onClick={() => open("edit", user)}>修改</button>
                  <button type="button" className="button small" onClick={() => open("delete", user)}>删除</button>
                </div></td>
              </tr>)}
              {!loading && !result.items.length && <tr><td colSpan={8}>暂无匹配人员。</td></tr>}
            </tbody>
          </table>
        </div>
        {loading && <div className="user-list-loading" role="status">正在加载人员…</div>}
      </div>
      <div className="user-list-footer">
        <span>共 {result.total} 人 · 第 {Math.floor(offset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(result.total / PAGE_SIZE))} 页</span>
        <div className="actions">
          <button type="button" className="button small" disabled={loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</button>
          <button type="button" className="button small" disabled={loading || offset + PAGE_SIZE >= result.total}
            onClick={() => setOffset(offset + PAGE_SIZE)}>下一页</button>
        </div>
      </div>
      {dialog && <UserDialog
        title={{ create: "新增人员", edit: "修改人员", delete: "确认删除人员", blocked: "无法修改或删除" }[dialog.kind]}
        onClose={close}
        onConfirm={["create", "edit", "delete"].includes(dialog.kind) ? persist : undefined}
        confirmLabel={dialog.kind === "delete" ? "确认删除" : "保存"}
        saving={saving}
      >
        {dialog.kind === "blocked" && <div className="note-box warn" role="alert">
          {dialog.user.email} 当前已有 Initiative 预算事项，不可修改或删除。
        </div>}
        {dialog.kind === "delete" && <p>确定删除 <strong>{dialog.user.email}</strong>？删除后该邮箱将无法登录工作台。</p>}
        {["create", "edit"].includes(dialog.kind) && <>
          <label className="form-field">邮箱
            <input type="email" maxLength={255} value={form.email} autoFocus
              onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </label>
          <label className="form-field">姓名
            <input maxLength={255} value={form.display_name}
              onChange={(event) => setForm({ ...form, display_name: event.target.value })} />
          </label>
          <label className="form-field">角色
            <select value={form.role} onChange={(event) => setForm({
              ...form, role: event.target.value,
              department: departmentAfterRoleChange(event.target.value, form.department),
              sector: sectorAfterRoleChange(event.target.value, form.sector),
            })}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {["owner", "lead"].includes(form.role) && <label className="form-field">部门
            <select value={form.department}
              onChange={(event) => setForm({ ...form, department: event.target.value })}>
              {userDepartmentOptions(form.department).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>}
          {["owner", "lead"].includes(form.role) && <div className="form-field">业务线
            <div className="sector-choice-group" role="group" aria-label="选择业务线">
              {SECTORS.map((value) => <button
                key={value}
                type="button"
                className={`sector-choice${form.sector.includes(value) ? " is-selected" : ""}`}
                aria-pressed={form.sector.includes(value)}
                onClick={() => setForm({
                  ...form,
                  sector: toggleSectorSelection(form.role, form.sector, value),
                })}
              >{value}</button>)}
            </div>
            <small>{form.role === "owner" ? "Owner 仅可选择一条业务线。" : "部门负责人可选择一至四条业务线。"}</small>
          </div>}
          <label className="user-enabled-field">
            <input type="checkbox" checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />启用该用户
          </label>
        </>}
        {formError && <div className="note-box error" role="alert">{formError}</div>}
      </UserDialog>}
    </>
  );
}
