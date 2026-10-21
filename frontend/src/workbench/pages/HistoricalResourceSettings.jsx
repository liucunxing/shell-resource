import { useState } from "react";

const resources = ["MRD", "SP&A", "ICE Rebate", "Capex"];
export function HistoricalResourceSettings({ mapping, departments, saveConfig }) {
  const [draft, setDraft] = useState(mapping);
  const [busy, setBusy] = useState(false);
  const names = [...new Set([...Object.keys(draft), ...departments])].sort();
  return <section className="panel">
    <div className="panel-header"><h2>历史资源列权限</h2></div>
    <p className="small-text">Owner 和负责人按授权部门查看资源列，多部门取并集。同一资源可用于多个部门；SP&A 展示全部历史合计，暂不拆部门。所有角色均不展示“总资源”列。</p>
    <div className="table-scroll"><table><thead><tr><th>部门</th>{resources.map((resource) => <th key={resource}>{resource}</th>)}</tr></thead>
      <tbody>{names.map((department) => <tr key={department}><th>{department}</th>
        {resources.map((resource) => <td key={resource}><input type="checkbox"
          aria-label={`${department} 可查看 ${resource}`} disabled={busy}
          checked={(draft[department] || []).includes(resource)}
          onChange={(event) => setDraft((current) => ({ ...current,
            [department]: event.target.checked ? [...(current[department] || []), resource]
              : (current[department] || []).filter((item) => item !== resource),
          }))} /></td>)}
      </tr>)}</tbody>
    </table></div>
    <button className="button primary small" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await saveConfig({ departmentResources: draft }); }
      finally { setBusy(false); }
    }}>{busy ? "保存中…" : "保存资源列权限"}</button>
  </section>;
}
