import { useEffect, useId, useState } from "react";
import { compareVersionGroups, groupSummary, initiativeSdFacts, portfolioRows } from "../domain/portfolio-analytics.js";
import { submittedVersionItems } from "../domain/version-baseline.js";
import * as api from "../api.js";

const amount = (value, scale = 1) => value == null ? "—" : (Number(value) / scale).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const percentage = (value) => value == null ? "—" : `${amount(value)}%`;
export function SdComparisonCells({ comparison, sourceVersionId }) {
  return <><td className="num">{amount(comparison?.previousAmount)}</td><td className="num">{amount(comparison?.delta)}</td><td className="num">{sourceVersionId ? comparison?.changeLabel || "不可比较" : "无来源版本"}</td></>;
}
export function sdGroupsWithComparison(items, sourceItems, dealers, groupBy, basis, period) {
  const sectors = new Set(items.map((item) => item.sector));
  const scopeDealers = dealers.filter((dealer) => sectors.has(dealer.sector));
  const groups = groupSummary(portfolioRows(items, dealers, basis, period), scopeDealers, groupBy, period);
  const comparisons = compareVersionGroups(items, sourceItems, dealers, groupBy, { sameInitiatives: true });
  const byKey = new Map(groups.map((group) => [group.key, group]));
  for (const comparison of comparisons) {
    if (!byKey.has(comparison.key)) byKey.set(comparison.key, { key: comparison.key, amount: 0, selectedCount: 0, allocatedCount: 0, totalCount: scopeDealers.filter((dealer) => dealer[groupBy] === comparison.key).length });
    byKey.get(comparison.key).comparison = comparison;
  }
  return [...byKey.values()];
}
export function SdAnalysis({ items, dealers, showOwner = false, threshold = 3, metadata = {}, sourceVersionId = "", comparisonIdentity = "" }) {
  const id = useId().replaceAll(":", "");
  const [period, setPeriod] = useState("2025"), [basis, setBasis] = useState("c3"), [groupBy, setGroupBy] = useState("sd");
  const [highlight, setHighlight] = useState("");
  const [source, setSource] = useState(null), [sourceDealers, setSourceDealers] = useState([]), [sourceError, setSourceError] = useState(""), [sourceLoading, setSourceLoading] = useState(false);
  useEffect(() => {
    let active = true; setSource(null); setSourceDealers([]); setSourceError(""); setSourceLoading(false);
    if (!sourceVersionId) return;
    setSourceLoading(true);
    api.workspace(sourceVersionId).then((workspace) => { if (active) { setSource(submittedVersionItems(workspace)); setSourceDealers(workspace.data?.dealers || []); } })
      .catch((failure) => { if (active) setSourceError(failure.message); })
      .finally(() => { if (active) setSourceLoading(false); });
    return () => { active = false; };
  }, [sourceVersionId, comparisonIdentity]);
  const comparisonDealers = [...new Map([...sourceDealers, ...dealers].map((dealer) => [`${dealer.sector}:${dealer.id}`, dealer])).values()];
  const sectors = new Set(items.map((item) => item.sector));
  const scopeDealers = dealers.filter((dealer) => sectors.has(dealer.sector));
  const groups = sdGroupsWithComparison(items, source, comparisonDealers, groupBy, basis, period);
  const facts = groupBy === "sd" ? initiativeSdFacts(items, dealers, basis, period, threshold) : [];
  const sdKeys = groups.map((group) => group.key);
  const locate = (key) => {
    setHighlight(key);
    const element = document.getElementById(`${id}-${encodeURIComponent(key)}`);
    element?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    element?.focus({ preventScroll: true });
  };
  const matrix = items.map((item) => ({ item, groups: groupSummary(portfolioRows([item], dealers, basis, period), scopeDealers, "sd", period) }));
  return <section id="studio-structure" className="panel studio-section v19-sd-analysis">
    <header><span>④</span><div><h2>按 SD / RSM 看</h2><p>名单内占比使用当前范围勾选名单的去重并集，包含勾选但未获配者。覆盖率为名单家数占组织全量家数。</p></div></header>
    <div className="studio-inline-controls"><label>组织维度<select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}><option value="sd">SD</option><option value="rsm">RSM</option></select></label>
      <label>历史期间<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="2025">2025 全年</option><option value="2026Ytd">2026 YTD</option></select></label>
      <label>产出口径<select value={basis} onChange={(event) => setBasis(event.target.value)}><option value="c3">C3</option><option value="vol">Delivery Vol</option></select></label>
      <details className="v19-method"><summary>ⓘ 数据口径</summary><p>{metadata.source || "历史数据来源"} · Actual 最新月：{metadata.actual?.latestMonth || "未提供"} · 历史费用最新月：{metadata.investment?.latestMonth || "未提供"}。合同量、PPP 缺少来源时显示缺失；月份未知时不计算 YTD Yield。</p></details>
    </div>
    <p className="studio-table-note">来源版本：{sourceVersionId || "无来源版本"}{sourceLoading ? " · 正在读取最后已提交快照…" : ""}。波动率 =（本版投资 − 来源版最后已提交投资）÷ 来源版投资；同一 Initiative 集合比较，退出 SD / RSM 保留 0 与 −100%。</p>
    {sourceError && <p className="note-box warn" role="alert">来源快照读取失败：{sourceError}；波动率暂不可比较。</p>}
    <div className="v19-facts">{groups.filter((group) => group.gap != null && Math.abs(group.gap) > threshold).map((group) => <button key={group.key} onClick={() => locate(`summary-${group.key}`)}>
      <b>叠加方案 · {group.key}</b><span>投资 {percentage(group.amountShare)} · {basis === "c3" ? "C3" : "Vol"} {percentage(group.metricShare)}</span><strong>{group.gap > 0 ? "偏多" : "偏少"} {amount(Math.abs(group.gap))} pp</strong>
    </button>)}{facts.map((fact) => <button key={`${fact.initiativeId}-${fact.key}`} onClick={() => locate(`matrix-${fact.initiativeId}-${fact.key}`)}>
      <b>{fact.initiativeName} · {fact.key}</b>{showOwner && <small>{fact.owner}</small>}<span>投资 {percentage(fact.amountShare)} · {basis === "c3" ? "C3" : "Vol"} {percentage(fact.metricShare)}</span><strong>{fact.gap > 0 ? "偏多" : "偏少"} {amount(Math.abs(fact.gap))} pp</strong>
    </button>)}</div>
    <div className="table-scroll"><table className="v19-four-groups"><thead><tr><th rowSpan="2">{groupBy.toUpperCase()}</th><th colSpan="9">本次投资</th><th colSpan="4">历史 Actual</th><th colSpan="2">PPP 目标</th><th colSpan="2">历史投资</th></tr><tr>
      <th>名单 / 全部</th><th>名单覆盖率</th><th>金额（元）</th><th>来源版投资（元）</th><th>变化金额（元）</th><th>波动率</th><th>投资占比</th><th>{basis === "c3" ? "C3" : "Vol"} 占比</th><th>偏离 pp</th><th>合同量（KL）</th><th>Delivery Vol（KL）</th><th>C3（K$）</th><th>Phasing</th><th>目标 Vol</th><th>目标 C3</th><th>历史投资（K$）</th><th>Yield</th>
    </tr></thead><tbody>{groups.map((group) => <tr key={group.key} id={`${id}-${encodeURIComponent(`summary-${group.key}`)}`} tabIndex="-1" className={highlight === `summary-${group.key}` ? "v19-highlight" : ""}>
      <th>{group.key}</th><td>{group.selectedCount} / {group.totalCount}</td><td>{percentage(group.totalCount ? group.selectedCount / group.totalCount * 100 : null)}</td><td className="num">{amount(group.amount)}</td><SdComparisonCells comparison={group.comparison} sourceVersionId={sourceVersionId} /><td className="num">{percentage(group.amountShare)}</td><td className="num">{percentage(group.metricShare)}</td><td className="num">{amount(group.gap)}</td>
      <td className="num">{amount(group.contractVolume, 1000)}</td><td className="num">{amount(group.historicalVol, 1000)}</td><td className="num">{amount(group.historicalC3, 1000)}</td><td className="num">{percentage(group.phasing == null ? null : group.phasing * 100)}</td><td>待配置</td><td>待配置</td><td className="num">{amount(group.historicalInvestment, 1000)}</td><td className="num">{group.historicalYield == null ? "—" : `${amount(group.historicalYield)}x`}</td>
    </tr>)}{!groups.length && <tr><td colSpan="18"><div className="empty">当前范围尚无经销商名单。</div></td></tr>}</tbody></table></div>
    {groupBy === "sd" && !!items.length && <><h3>Initiative × SD</h3><div className="table-scroll"><table><thead><tr><th>Initiative</th>{showOwner && <th>Owner</th>}{sdKeys.map((key) => <th key={key}>{key}</th>)}</tr></thead><tbody>{matrix.map(({ item, groups: itemGroups }) => <tr key={item.id}><th>{item.name}</th>{showOwner && <td>{item.ownerLabel || item.ownerId}</td>}{sdKeys.map((key) => {
      const group = itemGroups.find((entry) => entry.key === key), target = `matrix-${item.id}-${key}`;
      return <td key={key} id={`${id}-${encodeURIComponent(target)}`} tabIndex="-1" className={highlight === target ? "v19-highlight" : ""}>{group ? <><strong>{amount(group.amount)} 元</strong><small>投资 {percentage(group.amountShare)} / {basis === "c3" ? "C3" : "Vol"} {percentage(group.metricShare)}</small><span>{group.gap == null ? "不可比较" : `${group.gap >= 0 ? "+" : ""}${amount(group.gap)} pp`}</span></> : "—"}</td>;
    })}</tr>)}</tbody></table></div></>}
  </section>;
}
