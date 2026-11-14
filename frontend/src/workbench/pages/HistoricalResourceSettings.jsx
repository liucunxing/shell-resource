import { useEffect, useState } from "react";

const resources = ["MRD", "SP&A", "ICE Rebate", "Capex"];
const roleLabels = { owner: "Owner", lead: "部门负责人", management: "最高管理层", admin: "管理员" };
const defaultRoles = { owner: [], lead: [], management: resources, admin: resources };
const emptyMapping = {};
const scopedDepartments = ["PCMO", "CRTO", "B2B", "OEM"].flatMap(sector =>
  ["MKT", "ICE", "CAPEX"].map(department => `${sector}|${department}`));

export function HistoricalResourceSettings({ mapping = emptyMapping, departments = [], roleMapping, saveConfig, readOnly = false }) {
  const [draft, setDraft] = useState(mapping);
  const [roles, setRoles] = useState(roleMapping || defaultRoles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setDraft(mapping), [mapping]);
  useEffect(() => setRoles(roleMapping || defaultRoles), [roleMapping]);
  const names = [...new Set([...Object.keys(draft), ...departments, ...scopedDepartments])].sort();
  const toggle = (setter, name, resource, enabled) => setter(current => ({ ...current,
    [name]: enabled ? [...(current[name] || []), resource] : (current[name] || []).filter(item => item !== resource),
  }));
  return <section className="panel">
    <div className="panel-header"><h2>历史费用列权限</h2></div>
    <p className="small-text">优先级：用户覆盖 → 所属部门默认 → 角色默认。所属部门独立于业务授权；缺少有效归属时不显示费用明细。历史投资总额与 Yield 保留为公共指标。SP&A 为历史合计，暂不拆部门。</p>
    <h3>角色默认</h3>
    <div className="table-scroll"><table><thead><tr><th>角色</th>{resources.map(resource => <th key={resource}>{resource}</th>)}</tr></thead>
      <tbody>{Object.entries(roleLabels).map(([role, label]) => <tr key={role}><th>{label}</th>
        {resources.map(resource => <td key={resource}><input type="checkbox" aria-label={`${label} 默认可查看 ${resource}`}
          disabled={busy || readOnly} checked={(roles[role] || []).includes(resource)}
          onChange={event => toggle(setRoles, role, resource, event.target.checked)} /></td>)}
      </tr>)}</tbody></table></div>
    <h3>所属部门默认</h3>
    <p className="small-text">Sector / Department 配置优先于原部门通用配置。取消单独配置后沿用通用部门配置或角色默认。</p>
    <div className="table-scroll"><table><thead><tr><th>所属部门</th><th>单独配置</th>{resources.map(resource => <th key={resource}>{resource}</th>)}</tr></thead>
      <tbody>{names.map(department => <tr key={department}><th>{department.replace("|", " / ")}</th>
        <td><input type="checkbox" aria-label={`${department} 单独配置`} disabled={busy || readOnly}
          checked={Object.hasOwn(draft, department)} onChange={event => setDraft(current => {
            const next = { ...current };
            if (event.target.checked) next[department] = [];
            else delete next[department];
            return next;
          })} /></td>
        {resources.map(resource => <td key={resource}><input type="checkbox" aria-label={`${department} 可查看 ${resource}`}
          disabled={busy || readOnly || !Object.hasOwn(draft, department)} checked={(draft[department] || []).includes(resource)}
          onChange={event => toggle(setDraft, department, resource, event.target.checked)} /></td>)}
      </tr>)}</tbody></table></div>
    {error && <p role="alert" className="note-box error">{error}</p>}
    <button className="button primary small" disabled={busy || readOnly} onClick={async () => {
      setBusy(true); setError("");
      try { await saveConfig({ departmentResources: draft, roleResources: roles }); }
      catch (failure) { setError(failure.message || "权限保存失败，请重试"); }
      finally { setBusy(false); }
    }}>{busy ? "保存中…" : "保存费用列权限"}</button>
  </section>;
}
