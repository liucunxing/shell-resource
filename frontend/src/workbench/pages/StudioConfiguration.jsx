import { useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";

export function StudioConfiguration({ thresholds = false }) {
  const { state, saveConfig, previewMode } = useWorkbench();
  const [reasons, setReasons] = useState(() => structuredClone(state.budgetReasons || []));
  const [values, setValues] = useState(state.healthThresholds || { concentrationYellow: 5, concentrationRed: 10, dealerYellow: 3, dealerRed: 6 });
  const [busy, setBusy] = useState(false), [label, setLabel] = useState("");
  const save = async () => { setBusy(true); try { await saveConfig(thresholds ? { healthThresholds: values } : { budgetReasons: reasons }); } finally { setBusy(false); } };
  if (thresholds) return <section className="panel studio-admin-panel">
    <div className="panel-header"><div><h2>健康检查阈值</h2><p>差值仅提示复核，不替代业务判断。单位为百分点（pp）。</p></div></div>
    <table><thead><tr><th>指标</th><th>黄色阈值</th><th>红色阈值</th></tr></thead><tbody>
      {[["concentration", "集中度偏离"], ["dealer", "经销商超配 / 低配"]].map(([key, title]) => <tr key={key}><th>{title}</th>{["Yellow", "Red"].map((severity) => <td key={severity}><input aria-label={`${title}${severity === "Yellow" ? "黄色" : "红色"}阈值`} type="number" min="0" max="100" step="0.1" value={values[key + severity]} onChange={(event) => setValues({ ...values, [key + severity]: Number(event.target.value) })} /></td>)}</tr>)}
    </tbody></table><div className="actions studio-admin-save"><button className="button primary" disabled={busy || previewMode} onClick={save}>{busy ? "保存中…" : "保存阈值"}</button></div>
  </section>;
  const metadata = state.reference || {};
  return <>
    <section className="panel studio-admin-panel"><div className="panel-header"><div><h2>预留原因</h2><p>Owner 从启用原因中选择。已使用原因不能改名或删除，可以停用；历史记录保留。</p></div></div>
      <table><thead><tr><th>编码</th><th>原因名称</th><th>启用</th><th>操作</th></tr></thead><tbody>{reasons.map((reason, index) => <tr key={reason.id}><td>{reason.id}</td><td><input aria-label={`预留原因 ${index + 1}`} value={reason.label} onChange={(event) => setReasons(reasons.map((item) => item.id === reason.id ? { ...item, label: event.target.value } : item))} /></td><td><input aria-label={`启用 ${reason.label}`} type="checkbox" checked={reason.enabled} onChange={(event) => setReasons(reasons.map((item) => item.id === reason.id ? { ...item, enabled: event.target.checked } : item))} /></td><td><button className="button small" disabled={busy || previewMode} onClick={() => setReasons(reasons.filter((item) => item.id !== reason.id))}>删除未使用原因</button></td></tr>)}</tbody></table>
      <div className="studio-inline-controls"><label>新增原因<input value={label} maxLength="120" onChange={(event) => setLabel(event.target.value)} /></label><button className="button" disabled={!label.trim() || previewMode} onClick={() => { setReasons([...reasons, { id: `reason-${crypto.randomUUID()}`, label: label.trim(), enabled: true }]); setLabel(""); }}>添加原因</button>
        <button className="button primary" disabled={busy || previewMode} onClick={save}>{busy ? "保存中…" : "保存原因配置"}</button></div>
    </section>
    <section className="panel studio-admin-panel"><div className="panel-header"><div><h2>组织与历史数据</h2><p>业务线、资源大类采用现有业务字典；所属部门与授权范围在用户页维护。历史期间随数据源快照更新。</p></div></div>
      <div className="studio-enum-grid"><article className="studio-enum-card"><h3>业务线 / 资源大类</h3><p>PCMO · CRTO · B2B · OEM</p><p>MRD · SP&amp;A · ICE Rebate · Capex</p></article>
        <article className="studio-enum-card"><h3>历史数据来源</h3><p>{metadata.source || "等待来源信息"}</p><p>Actual 最新月份：{metadata.actual?.latestMonth || "来源未提供"}</p><p>历史费用最新月份：{metadata.investment?.latestMonth || "来源未提供"}</p><p>月份不齐或无法核对时，不计算跨月 Yield。</p></article></div>
    </section>
  </>;
}
