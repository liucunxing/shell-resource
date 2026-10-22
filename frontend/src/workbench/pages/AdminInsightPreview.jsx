import { useEffect, useRef, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import * as api from "../api.js";
import { InsightCapabilityResult } from "./InsightCapabilityResult";

const roleNames = { owner: "Owner", lead: "部门负责人", management: "管理层", admin: "管理员" };
const presets = [
  { id: "comprehensive", label: "综合体检" },
  { id: "quadrant", label: "历史 Yield × 计划投入四象限" },
  { id: "structure", label: "分配结构分析" },
];

export function AdminInsightPreview({ PromptEditor }) {
  const { roles: users = [], identity, notify } = useWorkbench();
  const [email, setEmail] = useState("");
  const [context, setContext] = useState(null);
  const [scope, setScope] = useState("");
  const [preset, setPreset] = useState("comprehensive");
  const [prompt, setPrompt] = useState(null);
  const [promptError, setPromptError] = useState("");
  const [promptReload, setPromptReload] = useState(0);
  const [record, setRecord] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const epoch = useRef(0);
  const generating = useRef(false);
  useEffect(() => {
    let active = true;
    setPromptError("");
    api.getInsights("global").then(value => {
      if (active) setPrompt(value.prompt);
    }).catch(error => { if (active) setPromptError(error.message); });
    return () => { active = false; };
  }, [identity.email, promptReload]);
  useEffect(() => {
    let active = true;
    epoch.current += 1;
    setContext(null); setRecord(null); setScope(""); setError("");
    setLoading(Boolean(email));
    if (email) api.getInsightPreviewContext(email).then(value => {
      if (!active) return;
      setContext(value); setScope(value.scopes[0]?.id || ""); setLoading(false);
    }).catch(error => {
      if (active) { setError(error.message); setLoading(false); }
    });
    return () => { active = false; epoch.current += 1; };
  }, [email, identity.email]);
  useEffect(() => {
    if (!busy) return;
    const start = performance.now(); setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((performance.now() - start) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  const scopeLabel = context?.scopes.find(item => item.id === scope)?.label || "";
  const stale = record && (record.stale || record.promptVersion !== prompt?.version);
  async function generate() {
    if (generating.current || !email || !scope) return;
    const current = epoch.current;
    generating.current = true; setBusy(true); setError("");
    try {
      const value = await api.generateInsightPreview(email, scope, preset);
      if (current !== epoch.current) return;
      setRecord(value.record || value);
      notify("试用分析已生成，不会覆盖用户的 Insight。");
    } catch (error) {
      if (current === epoch.current) setError(`${error.message}${error.requestId ? `（问题编号：${error.requestId}）` : ""}`);
    } finally {
      if (current === epoch.current) { generating.current = false; setBusy(false); }
    }
  }
  return <div className="insight-panel">
    <p className="small-text muted">选择一个用户，按他的可见数据试用全局提示词。试用结果不会保存到该用户的 Insight。</p>
    <label className="form-field insight-scope-select">模拟用户视角
      <select aria-label="模拟用户视角" value={email} disabled={busy} onChange={event => {
        epoch.current += 1; setRecord(null); setContext(null); setEmail(event.target.value);
      }}>
        <option value="">请选择用户</option>
        {users.filter(user => roleNames[user.role]).map(user => <option key={user.email} value={user.email}>
          {user.label || user.email} · {roleNames[user.role]} · {user.email}
        </option>)}
      </select>
    </label>
    {loading && <p role="status">正在读取该用户的分析范围…</p>}
    {context && <>
      <label className="form-field insight-scope-select">分析范围
        <select aria-label="试用分析范围" value={scope} disabled={busy} onChange={event => {
          epoch.current += 1; setRecord(null); setError(""); setScope(event.target.value);
        }}>
          {context.scopes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <p className="small-text muted">{context.identity.label} · {context.basisLabel}</p>
    </>}
    <label className="form-field insight-preset">分析方案
      <select aria-label="试用分析方案" value={preset} disabled={busy} onChange={event => {
        epoch.current += 1; setRecord(null); setError(""); setPreset(event.target.value);
      }}>
        {presets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label>
    {prompt && <PromptEditor key={prompt.version} prompt={prompt} disabled={busy} onSaved={value => {
      setPrompt(value); notify("全局提示词已保存，可重新试用查看效果。");
    }} />}
    {promptError && <p className="note-box" role="alert">{promptError}
      <button className="button small" onClick={() => setPromptReload(value => value + 1)}>重新加载提示词</button>
    </p>}
    <div className="insight-toolbar">
      <span className="badge">用户视角试用{prompt ? ` · 全局提示词 v${prompt.version}` : ""}</span>
      <button className="button primary small" disabled={!context || !scope || !prompt || loading || busy} onClick={generate}>
        {busy ? `正在试用 · ${elapsed}秒` : "试用分析"}
      </button>
    </div>
    {error && <p className="note-box" role="alert">{error}</p>}
    {record && <>
      <p className="small-text muted">试用结果 · {record.simulation?.label || context?.identity.label} · {scopeLabel} · 全局提示词 v{record.promptVersion}</p>
      {stale && <p className="note-box">提示词或数据已更新，请重新试用。</p>}
      <InsightCapabilityResult result={record.result} evidence={record.evidence} scopeLabel={scopeLabel} />
    </>}
  </div>;
}
