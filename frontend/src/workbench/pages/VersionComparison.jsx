import { useEffect, useMemo, useState } from "react";
import * as api from "../api.js";
import { useWorkbench } from "../WorkbenchContext.jsx";
import { compareVersionGroups } from "../domain/portfolio-analytics.js";
import { submittedVersionItems } from "../domain/version-baseline.js";

const money = (value) => value == null ? "不可比较" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
export function VersionComparison({ executive }) {
  const { state, data, identity } = useWorkbench();
  const versions = (state.planningVersions || []).filter((version) => version.published);
  const [left, setLeft] = useState(state.planningVersion?.sourceVersionId || "");
  const [right, setRight] = useState(state.currentVersionId || "");
  const [dimension, setDimension] = useState("initiative"), [result, setResult] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let active = true; setResult(null); setError(""); setLoading(false);
    if (!left || !right || left === right) return;
    setLoading(true);
    Promise.all([api.workspace(left), api.workspace(right)]).then(([previous, current]) => {
      if (active) setResult({ previous: submittedVersionItems(previous), current: current.state?.initiatives || [], dealers: [...new Map([...(previous.data?.dealers || []), ...(current.data?.dealers || [])].map((dealer) => [`${dealer.sector}:${dealer.id}`, dealer])).values()] });
    }).catch((failure) => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [left, right, identity.email]);
  const rows = useMemo(() => result ? compareVersionGroups(result.current, result.previous, result.dealers.length ? result.dealers : data.dealers, dimension, { requireConfirmed: executive }) : [], [result, data.dealers, dimension, executive]);
  return <section id="studio-version-change" className="panel studio-section studio-version-compare">
    <header><span>{executive ? "⑤" : "⑥"}</span><div><h2>版本变化</h2><p>按两个版本各自的归属汇总；未确认分配显示不可比较，保留退出经销商和退出组织。</p></div></header>
    <div className="studio-inline-controls">
      <label>来源版本<select value={left} onChange={(event) => setLeft(event.target.value)}><option value="">选择来源版本</option>{versions.map((version) => <option key={version.id} value={version.id}>{version.id} · {version.name}</option>)}</select></label>
      <span>→</span><label>本版<select value={right} onChange={(event) => setRight(event.target.value)}><option value="">选择本版</option>{versions.map((version) => <option key={version.id} value={version.id}>{version.id} · {version.name}</option>)}</select></label>
    </div>
    <div className="v19-tabs" role="tablist" aria-label="版本比较维度">{[["initiative", "Initiative"], ["resourceType", "资源大类"], ["department", "部门"], ["sector", "Sector"]].map(([id, title]) => <button key={id} role="tab" aria-selected={dimension === id} className={dimension === id ? "active" : ""} onClick={() => setDimension(id)}>{title}</button>)}</div>
    {error ? <p role="alert" className="note-box warn">{error}</p> : loading ? <div className="empty">正在读取版本快照…</div> : !result ? <div className="empty">请选择两个不同的已发布版本。</div> : <>
      <div className="studio-table-toolbar"><label>查找<input value={query} type="search" onChange={(event) => setQuery(event.target.value)} placeholder="项目 / Owner / 维度名称" /></label></div>
      <div className="table-scroll v19-comparison-scroll"><table><thead><tr><th>{dimension === "initiative" ? "Initiative / Owner" : "汇总维度"}</th><th className="num">来源预算</th><th className="num">本版预算</th><th className="num">预算变化</th><th className="num">来源版本投资</th><th className="num">本版投资</th><th className="num">变化金额</th><th className="num">波动率</th></tr></thead><tbody>
        {rows.filter((row) => `${row.name || row.key} ${row.owner || ""}`.toLowerCase().includes(query.toLowerCase())).map((row) => <tr key={row.key}><td><strong>{row.name || row.key}</strong>{row.owner && <small>{row.owner}</small>}</td><td className="num">{money(row.previousBudget)}</td><td className="num">{money(row.currentBudget)}</td><td className="num">{money(row.budgetDelta)}</td><td className="num">{row.comparable ? money(row.previousAmount) : "不可比较"}</td><td className="num">{row.comparable ? money(row.currentAmount) : "不可比较"}</td><td className="num">{row.comparable ? money(row.delta) : "不可比较"}</td><td className="num">{row.changeLabel || (row.changeRate == null ? "—" : `${Number(row.changeRate).toFixed(1)}%`)}</td></tr>)}
        {!rows.length && <tr><td colSpan="8"><div className="empty">当前授权范围没有可比较项目。</div></td></tr>}
      </tbody></table></div>
    </>}
  </section>;
}
