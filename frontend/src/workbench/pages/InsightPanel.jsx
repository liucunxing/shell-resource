import { useEffect, useRef, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import * as api from "../api.js";
import { AdminInsightPreview } from "./AdminInsightPreview.jsx";
import {
  InsightCapabilityResult,
  InvestmentReview,
  formatInsightCopy,
} from "./InsightCapabilityResult";
const defaultPresets = [
  { id: "comprehensive", label: "综合体检" },
  { id: "quadrant", label: "历史 Yield × 计划投入四象限" },
  { id: "structure", label: "分配结构分析" },
];
const titles = [
  "低 Yield 投入复核",
  "高 Yield 投入复核",
  "投入集中度",
  "同一经销商的多项目投入",
  "投入与业绩趋势匹配",
  "预算完整性",
];
export function updateInsightGeneration(current, action) {
  if (action.type === "start") return { ...current, failure: "" };
  if (action.type === "failed")
    return {
      ...current,
      failure:
        (action.message || "Insight 生成失败，请重试。") +
        (action.requestId ? `（问题编号：${action.requestId}）` : ""),
    };
  return {
    ...current,
    record: action.record,
    failure: "",
    basis: action.basis,
  };
}
export function InsightPanel({ scope }) {
  const { identity, apiMode } = useWorkbench();
  if (apiMode && identity.role === "admin")
    return <AdminInsightPreview key={identity.email} PromptEditor={BusinessPromptEditor} />;
  return <StandardInsightPanel scope={scope} />;
}
function StandardInsightPanel({ scope }) {
  const { state, data, identity, view, mutate, apiMode, notify } =
    useWorkbench();
  const requestEpoch = useRef(0);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const started = performance.now();
    setElapsed(0);
    const timer = window.setInterval(
      () => setElapsed(Math.floor((performance.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [busy]);
  const [selection, setSelection] = useState(null);
  const [preset, setPreset] = useState("comprehensive");
  const [remote, setRemote] = useState({
    record: null,
    prompt: null,
    failure: "",
    loading: false,
    basis: null,
  });
  const own = identity.role === "owner",
    readOnly = !apiMode && identity.role === "management",
    synced = ["management", "admin"].includes(identity.role);
  const incoming =
    scope ||
    (own
      ? "owner:" + identity.ownerId
      : E.departments(identity)[0] || "global");
  const effective = synced
    ? "global"
    : selection?.source === incoming && selection?.identity === identity.key
      ? selection.value
      : incoming;
  let record, failure;
  try {
    record = readOnly
      ? E.previewInsight(state, "global", identity, { data })
      : identity.role === "admin"
        ? null
        : E.getInsight(state, effective, identity);
  } catch (error) {
    failure = error.message;
  }
  const identityKey = identity.email || identity.key;
  const basis = JSON.stringify([
    state.initiatives,
    state.publications,
    state.reference,
    state.guide,
  ]);
  useEffect(() => {
    if (!apiMode || !identity) return;
    let active = true;
    requestEpoch.current += 1;
    busyRef.current = false;
    setBusy(false);
    setRemote({ record: null, prompt: null, loading: true, failure: "" });
    api
      .getInsights(readOnly ? "global" : effective, preset)
      .then((value) => {
        if (active)
          setRemote({
            record: value.record || null,
            presets: value.presets || defaultPresets,
            prompt: value.prompt || null,
            failure: "",
            loading: false,
            basis,
          });
      })
      .catch((error) => {
        if (active)
          setRemote((value) => ({
            ...value,
            failure: error.message || "Insight 加载失败，请重试。",
            loading: false,
          }));
      });
    return () => {
      active = false;
      requestEpoch.current += 1;
    };
  }, [apiMode, identityKey, effective, readOnly, preset]);
  if (apiMode) {
    record = remote.record && {
      ...remote.record,
      stale: remote.record.stale || remote.basis !== basis,
    };
    failure = remote.failure;
  }
  const scopeLabel = effective.startsWith("initiative:")
    ? view.initiatives.find((i) => "initiative:" + i.id === effective)?.name ||
      "本人 Initiative"
    : effective.startsWith("owner:")
      ? "本人全部 Initiative"
      : effective === "global"
        ? "各项最新同步结果"
        : effective + " 部门工作稿";
  return (
    <div className="insight-panel">
      {identity.role === "lead" && E.departments(identity).length > 1 && (
        <label className="form-field insight-scope-select">
          分析部门
          <select
            aria-label="分析部门"
            value={effective}
            onChange={(event) =>
              setSelection({
                source: incoming,
                identity: identity.key,
                value: event.target.value,
              })
            }
          >
            {E.departments(identity).map((dep) => (
              <option key={dep} value={dep}>
                {dep}
              </option>
            ))}
          </select>
        </label>
      )}
      {own && (
        <label className="form-field insight-scope-select">
          分析范围
          <select
            value={effective}
            onChange={(e) =>
              setSelection({
                source: incoming,
                identity: identity.key,
                value: e.target.value,
              })
            }
          >
            <option value={"owner:" + identity.ownerId}>
              我的全部 Initiative
            </option>
            {view.initiatives.map((i) => (
              <option key={i.id} value={"initiative:" + i.id}>
                {i.name} · {i.resourceType} / {i.sector}
              </option>
            ))}
          </select>
        </label>
      )}
      {apiMode && (
        <label className="form-field insight-preset">
          分析方案
          <select
            value={preset}
            disabled={busy}
            onChange={(event) => {
              requestEpoch.current += 1;
              setRemote((current) => ({
                ...current,
                record: null,
                loading: true,
              }));
              setPreset(event.target.value);
            }}
          >
            {(remote.presets || defaultPresets).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {synced && <p className="small-text muted">范围：全部已同步项目；每项取最新同步版本，不包含未同步草稿。</p>}
      {apiMode && remote.prompt?.editable && <BusinessPromptEditor
        key={`${identityKey}-${remote.prompt.version}`} prompt={remote.prompt}
        disabled={busy} onSaved={(prompt) => {
          setRemote((current) => ({ ...current, prompt, record: current.record ? { ...current.record, stale: true } : null }));
          notify("关注点已保存，下次生成生效。");
        }}
      />}
      <div className="insight-toolbar">
        <div>
          <span className="badge">
            {apiMode
              ? synced
                ? "百炼 Insight · 最新同步数据"
                : "百炼 Insight"
              : "模拟分析"}
          </span>
          {record && (
            <span className={"badge " + (record.stale ? "amber" : "teal")}>
              {record.stale ? "待更新" : readOnly ? "只读预览" : "当前版本"}
            </span>
          )}
        </div>
        {!readOnly && (apiMode || identity.role !== "admin") && (
          <button
            className="button primary small"
            disabled={busy || remote.loading}
            onClick={async () => {
              if (!apiMode)
                return mutate(
                  (s) => E.generateInsight(s, effective, identity, { data }),
                  "模拟 Insight 已更新。",
                );
              if (busyRef.current) return;
              busyRef.current = true;
              setBusy(true);
              setRemote((current) =>
                updateInsightGeneration(current, { type: "start" }),
              );
              const epoch = requestEpoch.current;
              try {
                const value = await api.generateInsights(effective, preset);
                if (epoch !== requestEpoch.current) return;
                setRemote((current) =>
                  updateInsightGeneration(current, {
                    type: "succeeded",
                    record: value.record || value,
                    basis,
                  }),
                );
                notify("Insight 已更新。");
              } catch (error) {
                if (epoch === requestEpoch.current)
                  setRemote((current) =>
                    updateInsightGeneration(current, {
                      type: "failed",
                      message: error.message,
                      requestId: error.requestId,
                    }),
                  );
              } finally {
                if (epoch === requestEpoch.current) {
                  busyRef.current = false;
                  setBusy(false);
                }
              }
            }}
          >
            {busy
              ? "正在处理…"
              : failure
                ? "重试分析"
                : record
                  ? "更新分析"
                  : "生成分析"}
          </button>
        )}
      </div>
      <p className="work-caption">
        {scopeLabel}
        {record?.basisLabel && " · " + record.basisLabel}
      </p>
      {failure && (
        <div className="note-box warn" role="alert">
          {failure}
          {record && <p>下方保留上次成功结果，本次分析未更新。</p>}
        </div>
      )}
      {apiMode && remote.loading && (
        <div className="empty" role="status">
          正在加载 Insight…
        </div>
      )}
      {busy && (
        <div className="note-box" role="status">
          正在分析 · 已等待 {elapsed} 秒。
          {record ? "下方保留上次结果。" : "完成后将在这里显示结果。"}
          {elapsed >= 15 && " 本次处理较慢，可以继续查看工作台。"}
        </div>
      )}
      {record?.stale && (
        <div className="note-box warn">
          分配或分析依据已变化，请更新后查看最新结论。
        </div>
      )}
      {!record?.result &&
        record?.evidence?.datasets
          ?.filter(
            (dataset) =>
              dataset.id === "investment-review" &&
              dataset.scope_id === record.evidence.scope?.id,
          )
          .map((dataset) => (
            <InvestmentReview
              key={`${record.evidence.data_version}:${dataset.scope_id}`}
              dataset={dataset}
              scopeLabel={scopeLabel}
            />
          ))}
      {record ? (
        record.result && record.evidence ? (
          <InsightCapabilityResult
            result={record.result}
            evidence={record.evidence}
            scopeLabel={scopeLabel}
          />
        ) : (
          (record.items || []).map((item, n) => (
            <article className="insight-item" key={n}>
              <div className="row-title">
                <span className="item-number">
                  {String(n + 1).padStart(2, "0")}
                </span>
                <span className="insight-status">
                  {item.status === "limited"
                    ? "待补充信息"
                    : item.status === "review"
                      ? "建议关注"
                      : "已核对事实"}
                </span>
              </div>
              <h3>{titles[n]}</h3>
              <p className="insight-copy">
                {formatInsightCopy(item.text || item.evidence + " " + item.review)}
              </p>
            </article>
          ))
        )
      ) : (
        <>
          <div className="empty">
            <strong>
              围绕六个问题查看资源分配
            </strong>
            <p>
              {own
                ? "仅使用本人配置的 Initiative 与授权历史参考。"
                : readOnly
                  ? "根据最新同步数据展示只读分析。"
                  : "选择分析方案，查看事实依据和复核建议。"}
            </p>
          </div>
          {(apiMode || identity.role !== "admin") && (
            <ol className="insight-outline">
              {titles.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          )}
        </>
      )}
      {record && (
        <details className="insight-basis-details">
          <summary>分析依据</summary>
          <p>
            范围：{scopeLabel}
            <br />
            参考批次：{record.reference?.batchId || "—"}
            <br />
            指南 v{record.guideVersion} · 业务提示词 v{record.promptVersion || 0}
            <br />
            {readOnly
              ? "根据最新同步结果即时展示"
              : new Date(record.createdAt).toLocaleString("zh-CN")}
          </p>
          <p>{record.basisLabel} · {record.disclaimer}</p>
          {synced && record.dataVersions?.map((item) => <p key={item.initiativeId}>
            项目 {item.initiativeId} · 同步修订 {item.revision ?? "—"} · {item.publishedAt ? new Date(item.publishedAt).toLocaleString("zh-CN") : "—"}
          </p>)}
          {record.metadata && (
            <p>
              方案：
              {(remote.presets || defaultPresets).find(
                (item) =>
                  item.id === (record.presetId || record.result?.preset_id),
              )?.label || "综合体检"}
              <br />
              方案版本：{record.metadata.preset_version || "—"}
            </p>
          )}
          {record.guideText && (
            <details>
              <summary>生成时使用的指南</summary>
              <p style={{ whiteSpace: "pre-wrap" }}>{record.guideText}</p>
            </details>
          )}
        </details>
      )}
    </div>
  );
}

export function BusinessPromptEditor({ prompt, disabled, onSaved }) {
  const [text, setText] = useState(prompt.version ? prompt.text : "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  return <details className="insight-basis-details">
    <summary>调整分析关注点 · v{prompt.version}</summary>
    <p>用于本年度各范围的后续分析。保存后下次生成生效，已有摘要保留原版本；金额计算和事实核对规则保持不变。</p>
    <label className="form-field">业务关注点与表达要求
      <textarea rows={5} maxLength={12000} value={text} disabled={disabled || saving}
        onChange={(event) => setText(event.target.value)} />
    </label>
    <button className="button small" disabled={disabled || saving || !text.trim()}
      onClick={async () => {
        setSaving(true); setMessage("");
        try {
          const updated = await api.saveInsightPrompt("global", text, prompt.version);
          onSaved(updated);
        } catch (error) { setMessage(error.message); }
        finally { setSaving(false); }
      }}>{saving ? "保存中…" : "保存，下次生成生效"}</button>
    {message && <p role="alert">{message}</p>}
    {prompt.versions?.length > 0 && <details><summary>历史版本（{prompt.versions.length}）</summary>
      {[...prompt.versions].reverse().map((version) => <div key={version.version}>
        <strong>v{version.version}</strong><p style={{ whiteSpace: "pre-wrap" }}>{version.text}</p>
      </div>)}
    </details>}
  </details>;
}
