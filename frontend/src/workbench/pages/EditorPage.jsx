import { useEffect, useRef, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import X from "../domain/excel.js";
import { allocateByHistory } from "../domain/history-allocation";
import {
  allocationHistoryField,
  historyDisplayValue,
  historyInvestment,
  historyYield,
  initiativeDealers,
  isActiveDealer,
} from "../domain/dealer-history";
import { previewExcelInWorker } from "../file-import.js";
const fmt = (n) =>
  Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const histFmt = (value) =>
  historyDisplayValue(value) === null ? "—" : fmt(historyDisplayValue(value));
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(2) : "0.00");
const time = (v) => (v ? new Date(v).toLocaleString("zh-CN") : "尚未提交");
export function uniqueDealersByCode(dealers) {
  const unique = new Map();
  dealers.forEach((dealer) => {
    const code = String(dealer.id);
    if (!unique.has(code)) unique.set(code, { ...dealer, id: code });
    else {
      const current = unique.get(code);
      current.sector = [
        ...new Set(
          [...(current.sector || "").split(" / "), dealer.sector].filter(
            Boolean,
          ),
        ),
      ].join(" / ");
    }
  });
  return [...unique.values()];
}

export function filterDealers(dealers, codeSearch, nameSearch) {
  const codeQuery = codeSearch.trim().toLocaleLowerCase();
  const nameQuery = nameSearch.trim().toLocaleLowerCase();
  return dealers.filter(
    (dealer) =>
      (!codeQuery ||
        String(dealer.code || dealer.id)
          .toLocaleLowerCase()
          .includes(codeQuery)) &&
      (!nameQuery ||
        String(dealer.name || "")
          .toLocaleLowerCase()
          .includes(nameQuery)),
  );
}

export function toggleDealerSelection(selectedDealers, dealerId) {
  return selectedDealers.includes(dealerId)
    ? selectedDealers.filter((id) => id !== dealerId)
    : [...selectedDealers, dealerId];
}

export function balanceSelectedDealers(rows, selectedIds, pendingAmount) {
  const selected = rows
    .filter((row) => selectedIds.includes(row.dealerId))
    .sort(
      (left, right) =>
        right.amount - left.amount ||
        left.dealerId.localeCompare(right.dealerId),
    );
  if (!selected.length || !Number.isInteger(pendingAmount)) return null;
  const base = Math.trunc(pendingAmount / selected.length);
  const remainder = pendingAmount - base * selected.length;
  const increments = new Map(
    selected.map((row, index) => [
      row.dealerId,
      base + (index < Math.abs(remainder) ? Math.sign(remainder) : 0),
    ]),
  );
  const balanced = rows.map((row) => ({
    ...row,
    amount: row.amount + (increments.get(row.dealerId) || 0),
  }));
  if (balanced.some((row) => row.amount < 0)) return null;
  return balanced;
}

export function MissingHistoryNotice({ metricLabel, unavailable, hasHistory }) {
  if (!unavailable.length) return null;
  return (
    <div role="status" className="notice">
      <p>以下经销商无有效的 {metricLabel} 数据，本次分配默认为 0：</p>
      <ul>
        {unavailable.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      {!hasHistory && <p>全部经销商均无量，可分配预算保留为未分配差额。</p>}
    </div>
  );
}

export function canSynchronizeLatest({
  savedForSync,
  hasUnsavedChanges,
  errorCount,
  operation,
}) {
  return (
    savedForSync && !hasUnsavedChanges && errorCount === 0 && operation === null
  );
}

function AmountInput({ value, label, save, disabled = false }) {
  const [raw, setRaw] = useState(null);
  const [failed, setFailed] = useState(false);
  const valid =
    raw === null ||
    (/^\d+(\.\d{0,2})?$/.test(raw) && E.validMoney(Number(raw)));
  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      aria-label={label}
      aria-invalid={!valid || failed}
      data-unsaved-invalid={!valid || failed ? "true" : undefined}
      className={!valid || failed ? "inline-error" : ""}
      value={raw ?? value}
      onChange={(e) => {
        const next = e.target.value;
        setRaw(next);
        if (/^\d+(\.\d{0,2})?$/.test(next) && E.validMoney(Number(next)))
          setFailed(save(Number(next)) === false);
      }}
      onBlur={() => {
        if (valid && !failed) setRaw(null);
      }}
    />
  );
}
function EditorDialog({ title, children, action, close }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const d = ref.current;
    d.showModal();
    return () => {
      d.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      style={{
        width: "min(860px, calc(100vw - 32px))",
        maxHeight: "85dvh",
        overflow: "auto",
        padding: 24,
        border: "1px solid #d9e1e8",
        borderRadius: 12,
      }}
    >
      <div className="panel-header">
        <h2>{title}</h2>
        <button className="button subtle" onClick={close} aria-label="关闭弹窗">
          关闭
        </button>
      </div>
      {children}
      <div
        className="actions"
        style={{ marginTop: 20, justifyContent: "flex-end" }}
      >
        <button className="button" onClick={close}>
          取消 / 返回
        </button>
        {action}
      </div>
    </dialog>
  );
}
export function EditorPage() {
  const context = useWorkbench();
  return (
    <EditorContent
      key={context.initiativeId + ":" + JSON.stringify(context.identity)}
      {...context}
    />
  );
}
function EditorContent({
  state,
  data,
  identity,
  view,
  initiativeId,
  navigate,
  mutate,
  saveDraft,
  publish,
  apiMode,
  previewMode,
  dirtyIds,
  savedForSyncIds,
  editorOperations,
  directoryStatus,
  loadDistributorDirectory,
  notify,
}) {
  const [modal, setModal] = useState(null),
    [newDealers, setNewDealers] = useState([]),
    [dealerCodeSearch, setDealerCodeSearch] = useState(""),
    [dealerNameSearch, setDealerNameSearch] = useState(""),
    [historyMetric, setHistoryMetric] = useState("c3"),
    [historyPeriod, setHistoryPeriod] = useState("2025"),
    [activeStep, setActiveStep] = useState(1),
    [balanceIds, setBalanceIds] = useState([]),
    [scopeSelected, setScopeSelected] = useState([]),
    [scopeSearch, setScopeSearch] = useState(""),
    [scopeSd, setScopeSd] = useState("all"),
    [scopeRsm, setScopeRsm] = useState("all"),
    [scopeStatus, setScopeStatus] = useState("all"),
    [scopePage, setScopePage] = useState(1),
    [acknowledged, setAcknowledged] = useState(false),
    [changeReason, setChangeReason] = useState(""),
    [busy, setBusy] = useState(false);
  const fileRef = useRef(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (apiMode) void loadDistributorDirectory();
  }, [apiMode, loadDistributorDirectory]);
  const i = view.initiatives.find((item) => item.id === initiativeId);
  const hasUnsavedChanges = i ? dirtyIds.has(i.id) : false;
  if (!i) return <div className="empty">当前角色无权查看该明细。</div>;
  const operation = editorOperations[i.id] || null;
  const savedForSync = savedForSyncIds.has(i.id);
  const editable = !previewMode && E.canEdit(state, i.id, identity),
    totals = E.totals([i]),
    errors = E.completionErrors(i, data, state.budgetReasons);
  const synchronizedRevision =
    i.publishedRevision != null && i.publishedRevision === i.revision;
  const canSynchronize =
    acknowledged &&
    canSynchronizeLatest({
      savedForSync,
      hasUnsavedChanges,
      errorCount: errors.length,
      operation,
    });
  const guard = () => {
    if (document.querySelector('[data-unsaved-invalid="true"]')) {
      notify(
        "有尚未保存的无效输入，请填写非负金额（最多两位小数）后继续。",
        true,
      );
      return false;
    }
    return true;
  };
  const update = (patch) =>
    mutate((s) => E.updateInitiative(s, i.id, patch, identity, data));
  const doGuard = (fn) => {
    if (guard()) fn();
  };
  const handleSaveDraft = async () => {
    if (operation !== null || !guard()) return;
    await saveDraft(i.id);
  };
  const handlePublish = async () => {
    if (operation !== null || !canSynchronize || !guard()) return;
    await publish(i.id);
  };
  const directoryDealers = apiMode
    ? data.distributorDirectory || []
    : data.dealers;
  const dealers = initiativeDealers(
    data.dealers || [],
    directoryDealers,
    i.sector,
  );
  const available = dealers.filter(
    (d) => isActiveDealer(d) && !i.rows.some((r) => r.dealerId === d.id),
  );
  const dealerById = new Map(dealers.map((d) => [String(d.id), d]));
  const dealerName = (dealerId) =>
    dealerById.get(String(dealerId))?.name || "—";
  const dealerMeta = (dealerId) => dealerById.get(String(dealerId)) || {};
  const dealerCode = (dealerId) =>
    dealerMeta(dealerId).code ||
    i.rows.find((row) => row.dealerId === dealerId)?.dealerCode ||
    dealerId;
  const searchedDealers = filterDealers(
    available,
    dealerCodeSearch,
    dealerNameSearch,
  );
  const scopeDealers = available.filter((dealer) => {
    const term = scopeSearch.trim().toLowerCase();
    return (
      (!term ||
        `${dealer.code || dealer.id} ${dealer.name || ""}`
          .toLowerCase()
          .includes(term)) &&
      (scopeSd === "all" || dealer.sd === scopeSd) &&
      (scopeRsm === "all" || dealer.rsm === scopeRsm) &&
      (scopeStatus === "all" || dealer.status === scopeStatus)
    );
  });
  const scopeOptions = (key) =>
    [...new Set(available.map((dealer) => dealer[key]).filter(Boolean))].sort();
  const addScopeDealers = () => {
    if (!scopeSelected.length) return;
    if (
      update({
        rows: [
          ...i.rows,
          ...scopeSelected.map((dealerId) => ({
            dealerId,
            amount: 0,
            note: "",
          })),
        ],
      })
    )
      setScopeSelected([]);
  };
  const changeRow = (n, amount) =>
    update({
      rows: i.rows.map((r, index) => (index === n ? { ...r, amount } : r)),
    });
  const changeOther = (n, field, value) =>
    update({
      otherBudgets: i.otherBudgets.map((r, index) =>
        index === n ? { ...r, [field]: value } : r,
      ),
    });
  const close = () => setModal(null);
  const download = async (directoryOnly = false) => {
    const previewEpoch = getPreviewEpoch();
    if (!directoryOnly && !guard()) return;
    setBusy(true);
    try {
      const directory = apiMode
        ? await loadDistributorDirectory()
        : data.dealers;
      if (!Array.isArray(directory))
        throw Error("经销商目录加载失败，暂不能下载，请稍后重试。");
      const exportData = { ...data, distributorDirectory: directory };
      const bytes = directoryOnly
        ? await X.exportDealerDirectory(exportData)
        : await X.exportWorkbook(state, i.id, identity, exportData);
      await validatePortalSession();
      assertPreviewResponseCurrent(previewEpoch);
      if (!alive.current) return;
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = directoryOnly
        ? "经销商列表.xlsx"
        : `${i.department}_${i.name}_${i.id}_分配模板.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (alive.current && previewEpoch === getPreviewEpoch())
        notify(e.message, true);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const importFile = async (file) => {
    if (!file || !guard()) return;
    setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024)
        throw Error("模板请控制在 10 MB 以内。");
      const buffer = await file.arrayBuffer();
      const preview = apiMode
        ? await previewExcelInWorker(
            "allocation",
            buffer,
            state,
            i.id,
            identity,
            data,
          )
        : await X.previewImport(buffer, state, i.id, identity, data);
      if (alive.current) setModal({ type: "import", preview, name: file.name });
    } catch (e) {
      notify(e.message, true);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const historyFill = (metric) =>
    doGuard(() => {
      try {
        const available = E.cents(i.budget - totals.otherBudget);
        if (available < 0)
          throw Error("其他预算安排超过总预算，无法辅助填充。");
        const field = allocationHistoryField(metric, historyPeriod);
        const label = `${historyPeriod === "2026Ytd" ? "2026 YTD" : "2025 全年"} ${metric === "vol" ? "Delivery Vol" : metric === "investment" ? "历史投资" : "C3"}`;
        const allocation = allocateByHistory(
          i.rows,
          dealers,
          available,
          field,
          i.sector,
          directoryDealers,
        );
        setModal({
          type: "fill",
          revision: i.revision,
          metricLabel: label,
          ...allocation,
        });
      } catch (e) {
        notify(e.message, true);
      }
    });
  const history = state.publications?.[i.id] || [];
  const parts = [
    ["经销商分配", totals.allocated, "#3c9b8b"],
    ...state.budgetReasons.map((r) => [
      r.label,
      (i.otherBudgets || [])
        .filter((b) => b.reasonId === r.id)
        .reduce((s, b) => s + b.amount, 0),
      "#9ac7bb",
    ]),
    ["未安排", Math.max(0, totals.gap), "#dde4ed"],
  ];
  const historyVolKey = historyPeriod === "2026Ytd" ? "vol2026Ytd" : "vol2025";
  const historyC3Key = historyPeriod === "2026Ytd" ? "c32026Ytd" : "c32025";
  const scopeHistoryTotals = i.rows.reduce(
    (sum, row) => {
      const historyRow = dealerMeta(row.dealerId).history || {};
      sum.vol += Number(historyRow[historyVolKey]) || 0;
      sum.c3 += Number(historyRow[historyC3Key]) || 0;
      return sum;
    },
    { vol: 0, c3: 0 },
  );
  return (
    <>
      {operation && (
        <>
          <div className="editor-operation-overlay" aria-hidden="true" />
          <div
            className="editor-operation-status"
            role="status"
            aria-live="assertive"
          >
            <span className="admin-loading-spinner" aria-hidden="true" />
            <strong>
              {operation === "save" ? "正在保存草稿…" : "正在提交方案…"}
            </strong>
            <span>当前工作页暂不可操作，可切换左侧目录</span>
          </div>
        </>
      )}
      <div inert={operation !== null} aria-busy={operation !== null}>
        <div className="page-heading">
          <div>
            <span className="resource-eyebrow">
              OWNER / INITIATIVE WORKBENCH
            </span>
            <h1>{i.name}</h1>
            <p>
              {i.id} · {i.sector} / {i.department} · {i.resourceType} · Owner{" "}
              {i.ownerId}
            </p>
          </div>
          <button
            className="button"
            onClick={() =>
              doGuard(() =>
                navigate(identity.role === "owner" ? "home" : "department"),
              )
            }
          >
            返回列表
          </button>
        </div>
        <div className="editor-meta">
          <strong>202701 · 业务目标校准</strong>
          <span className="resource-status done">开放提交</span>
          <span>本版预算、名单与草稿独立</span>
          <span>
            {time(i.publishedAt)}
            {i.publishedAt &&
              (i.publishedRevision !== i.revision
                ? " · 有新调整，待重新提交"
                : " · 已提交当前修订")}
          </span>
        </div>
        <nav className="resource-editor-steps" aria-label="Initiative 配置步骤">
          {[
            [1, "预算与预留"],
            [2, "经销商范围"],
            [3, "试算、微调与提交"],
          ].map(([step, label]) => (
            <button
              key={step}
              className={activeStep === step ? "active" : ""}
              aria-current={activeStep === step ? "step" : undefined}
              onClick={() => setActiveStep(step)}
            >
              <span>{step}</span>
              <b>{label}</b>
            </button>
          ))}
        </nav>
        {!editable && (
          <div className="note-box">
            只读查看 · 由该 Initiative 的 Marketer 维护分配。
          </div>
        )}
        {activeStep === 1 && (
          <div className="resource-stage-intro">
            <div>
              <strong>Step 1 · 确认预算与主动预留</strong>
              <p>预留不会被试算或配平自动消耗；非零预留必须填写具体原因。</p>
            </div>
          </div>
        )}
        {activeStep === 1 && (
          <div className="budget-summary">
            {[
              ["总预算 · 只读", totals.budget],
              ["预留", totals.reserve],
              ["已分配到经销商", totals.allocated],
              ["待分配", Math.max(0, totals.gap)],
            ].map(([label, value], n) => (
              <div
                key={label}
                className={n === 3 ? "gap " + (value ? "unbalanced" : "") : ""}
              >
                <label>{label}</label>
                <strong>{fmt(value)}</strong>
              </div>
            ))}
          </div>
        )}
        {activeStep === 1 && (
          <section className="budget-composition" aria-label="预算分配占比">
            <div className="composition-heading">
              <span>
                预算分配 <small>金额 · 占本项预算</small>
              </span>
              <strong>
                已安排 {pct(totals.allocated + totals.otherBudget, i.budget)}%
              </strong>
            </div>
            <div className="composition-track">
              {parts.map(([label, amount, color]) => (
                <span
                  className="composition-segment"
                  key={label}
                  style={{
                    width:
                      (amount /
                        Math.max(
                          i.budget,
                          totals.allocated + totals.otherBudget,
                          1,
                        )) *
                        100 +
                      "%",
                    background: color,
                  }}
                  title={`${label} ${fmt(amount)}`}
                />
              ))}
            </div>
            <div className="composition-legend">
              {parts.map(([label, amount, color]) => (
                <span key={label}>
                  <i style={{ background: color }} />
                  {label} <b>{fmt(amount)}</b>
                  <small>{pct(amount, i.budget)}%</small>
                </span>
              ))}
            </div>
            {totals.gap < 0 && (
              <div className="note-box warn">
                已超出预算 {fmt(-totals.gap)}，请减少分配金额，配平后才能提交。
              </div>
            )}
          </section>
        )}
        {activeStep === 1 && (
          <section className="panel studio-budget-ack">
            <label>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />{" "}
              我已核对本版预算、预留金额与用途；预留不会被试算或配平自动消耗。
            </label>
            <label>
              本次调整原因
              <textarea
                rows="2"
                value={changeReason}
                onChange={(event) => setChangeReason(event.target.value)}
                placeholder="说明本次名单、预算或拆分调整的原因"
              />
            </label>
          </section>
        )}
        {activeStep === 2 && (
          <div className="resource-stage-intro">
            <div>
              <strong>Step 2 · 定义本版适用经销商</strong>
              <p>经销商直接来自历史列表，仅 active 经销商可加入本项目。</p>
            </div>
          </div>
        )}
        {activeStep === 3 && (
          <div className="resource-stage-intro">
            <div>
              <strong>Step 3 · 试算、微调与提交</strong>
              <p>
                并排比较 Delivery Vol、C3
                与历史投资三种试算，再微调、配平并提交。
              </p>
            </div>
          </div>
        )}
        <div className="editor-layout">
          {activeStep === 2 && (
            <>
              <section className="panel studio-scope-panel">
                <div className="panel-header">
                  <div>
                    <h2>
                      经销商主数据 <small>{available.length} 家可选</small>
                    </h2>
                    <p className="small-text muted">
                      直接来自历史列表；SD、RSM、状态及历史指标只读。
                    </p>
                  </div>
                  {editable && (
                    <button
                      className="button primary"
                      disabled={!scopeSelected.length}
                      onClick={addScopeDealers}
                    >
                      加入已选（{scopeSelected.length}）
                    </button>
                  )}
                </div>
                <div className="studio-scope-summary">
                  {scopeOptions("sd").map((sd) => (
                    <span key={sd}>
                      <b>{sd}</b>
                      {available.filter((dealer) => dealer.sd === sd).length} 家
                    </span>
                  ))}
                </div>
                <div className="studio-table-toolbar">
                  <input
                    type="search"
                    placeholder="搜索经销商名称 / 编码"
                    value={scopeSearch}
                    onChange={(event) => {
                      setScopeSearch(event.target.value);
                      setScopePage(1);
                    }}
                  />
                  <select
                    value={scopeSd}
                    onChange={(event) => {
                      setScopeSd(event.target.value);
                      setScopePage(1);
                    }}
                  >
                    <option value="all">全部 SD</option>
                    {scopeOptions("sd").map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                  <select
                    value={scopeRsm}
                    onChange={(event) => {
                      setScopeRsm(event.target.value);
                      setScopePage(1);
                    }}
                  >
                    <option value="all">全部 RSM</option>
                    {scopeOptions("rsm").map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                  <select
                    value={scopeStatus}
                    onChange={(event) => {
                      setScopeStatus(event.target.value);
                      setScopePage(1);
                    }}
                  >
                    <option value="all">全部状态</option>
                    {scopeOptions("status").map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                  {editable && (
                    <button
                      className="button small"
                      disabled={!scopeDealers.length}
                      onClick={() => {
                        setScopeSelected(
                          scopeDealers.map((dealer) => dealer.id),
                        );
                      }}
                    >
                      加入筛选结果
                    </button>
                  )}
                </div>
                <div className="table-scroll studio-wide-table">
                  <table>
                    <thead>
                      <tr>
                        {editable && <th aria-label="选择" />}
                        <th>经销商</th>
                        <th>SD / RSM</th>
                        <th>状态</th>
                        <th className="num">2025 Delivery Vol（KL）</th>
                        <th className="num">2025 C3（K$）</th>
                        <th className="num">Phasing</th>
                        <th className="num">Yield</th>
                        <th className="num">2026 YTD Delivery Vol（KL）</th>
                        <th className="num">2026 YTD C3（K$）</th>
                        <th className="num">YoY Vol 25 vs 24</th>
                        <th className="num">YoY C3 25 vs 24</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scopeDealers
                        .slice((scopePage - 1) * 20, scopePage * 20)
                        .map((dealer) => {
                          const h = dealer.history || {};
                          return (
                            <tr key={`${dealer.sector || ""}:${dealer.id}`}>
                              {editable && (
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={scopeSelected.includes(dealer.id)}
                                    aria-label={`选择 ${dealer.id}`}
                                    onChange={() => {
                                      setScopeSelected((current) =>
                                        toggleDealerSelection(
                                          current,
                                          dealer.id,
                                        ),
                                      );
                                    }}
                                  />
                                </td>
                              )}
                              <td>
                                <strong>{dealer.name || "—"}</strong>
                                <small>{dealer.code || dealer.id}</small>
                              </td>
                              <td>
                                {dealer.sd || "—"}
                                <small>{dealer.rsm || "—"}</small>
                              </td>
                              <td>
                                <span
                                  className={`resource-status ${dealer.status || ""}`}
                                >
                                  {dealer.status || "—"}
                                </span>
                              </td>
                              <td className="num">{histFmt(h.vol2025)}</td>
                              <td className="num">{histFmt(h.c32025)}</td>
                              <td className="num">
                                <span title="历史数据未提供合同量，无法计算 Phasing">
                                  —
                                </span>
                              </td>
                              <td className="num">
                                {h.yield == null
                                  ? "—"
                                  : `${Number(h.yield).toFixed(2)}x`}
                              </td>
                              <td className="num">{histFmt(h.vol2026Ytd)}</td>
                              <td className="num">{histFmt(h.c32026Ytd)}</td>
                              <td className="num">
                                {h.yoyVol2425 == null
                                  ? "—"
                                  : `${fmt(h.yoyVol2425)}%`}
                              </td>
                              <td className="num">
                                {h.yoyC32425 == null
                                  ? "—"
                                  : `${fmt(h.yoyC32425)}%`}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <div className="table-footer">
                  <span>显示 {scopeDealers.length} 家 · 每页 20 行</span>
                  <div className="actions">
                    <button
                      className="button small"
                      disabled={scopePage === 1}
                      onClick={() => setScopePage((page) => page - 1)}
                    >
                      上一页
                    </button>
                    <span>
                      {scopePage} /{" "}
                      {Math.max(1, Math.ceil(scopeDealers.length / 20))}
                    </span>
                    <button
                      className="button small"
                      disabled={
                        scopePage >= Math.ceil(scopeDealers.length / 20)
                      }
                      onClick={() => setScopePage((page) => page + 1)}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              </section>
              <section className="panel resource-roster-panel">
                <div className="panel-header">
                  <div>
                    <h2>
                      最终名单 <small>{i.rows.length} 家</small>
                    </h2>
                    <p className="small-text muted">
                      Excel 名单列：编码、名称、SD、RSM、状态。
                    </p>
                  </div>
                  {editable && (
                    <div className="actions">
                      <button
                        className="button small"
                        onClick={() => download(true)}
                      >
                        下载名单
                      </button>
                      <button
                        className="button primary"
                        onClick={() => {
                          setNewDealers([]);
                          setDealerCodeSearch("");
                          setDealerNameSearch("");
                          setModal({ type: "add" });
                        }}
                      >
                        添加一批
                      </button>
                    </div>
                  )}
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>经销商编码</th>
                        <th>名称</th>
                        <th>SD</th>
                        <th>RSM</th>
                        <th>状态</th>
                        <th className="num">已分配（元）</th>
                        {editable && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {i.rows.map((row) => {
                        const dealer = dealerMeta(row.dealerId);
                        return (
                          <tr key={row.dealerId}>
                            <td>{row.dealerId}</td>
                            <td>{dealer.name || "—"}</td>
                            <td>{dealer.sd || "—"}</td>
                            <td>{dealer.rsm || "—"}</td>
                            <td>
                              <span
                                className={`resource-status ${dealer.status || ""}`}
                              >
                                {dealer.status || "—"}
                              </span>
                            </td>
                            <td className="num">{fmt(row.amount)}</td>
                            {editable && (
                              <td>
                                <button
                                  className="button subtle small"
                                  onClick={() =>
                                    setModal({
                                      type: "remove",
                                      dealerId: row.dealerId,
                                      amount: row.amount,
                                    })
                                  }
                                >
                                  移除
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!i.rows.length && (
                  <div className="empty">尚未选择经销商。</div>
                )}
              </section>
            </>
          )}
          {activeStep === 3 && (
            <section className="panel studio-trial-panel">
              <div className="panel-header">
                <div>
                  <h2>三种试算并排比较</h2>
                  <p className="small-text muted">
                    采用试算会覆盖当前金额，保留名单与主动预留；确认前显示预览。
                  </p>
                </div>
                <label>
                  试算历史期间
                  <select
                    value={historyPeriod}
                    onChange={(event) => setHistoryPeriod(event.target.value)}
                  >
                    <option value="2025">2025 全年</option>
                    <option value="2026Ytd">2026 YTD（1–10月）</option>
                  </select>
                </label>
              </div>
              <div className="studio-trial-grid">
                {[
                  ["Delivery Vol", "vol", "按历史规模拆分"],
                  ["C3", "c3", "按历史贡献拆分"],
                  ["历史投资", "investment", "按四类历史投资合计拆分"],
                ].map(([label, metric, note]) => (
                  <article key={metric}>
                    <span>试算</span>
                    <h3>{label}</h3>
                    <p>{note}</p>
                    <strong>
                      {i.rows.length} 家 ·{" "}
                      {fmt(Math.max(0, i.budget - totals.otherBudget))} 元
                    </strong>
                    <button
                      className="button primary small"
                      disabled={
                        !editable ||
                        !i.rows.length ||
                        (metric === "investment" &&
                          !i.rows.some(
                            (row) =>
                              historyInvestment(
                                dealerMeta(row.dealerId).history,
                                historyPeriod,
                              ) > 0,
                          ))
                      }
                      title={
                        metric === "investment"
                          ? "仅四类资源历史均可见且有完整数值时参与试算"
                          : undefined
                      }
                      onClick={() => {
                        setHistoryMetric(metric);
                        historyFill(metric);
                      }}
                    >
                      采用此试算
                    </button>
                  </article>
                ))}
              </div>
              <div className="actions">
                <button
                  className="button small"
                  onClick={() => setModal({ type: "history" })}
                >
                  复制上一版已提交
                </button>
                <button className="button small" disabled>
                  撤销上一步
                </button>
              </div>
            </section>
          )}
          {activeStep === 3 && (
            <section className="panel">
              <div className="panel-header">
                <h2>
                  分配明细与历史对照 <small>{i.rows.length} 行</small>
                </h2>
                {editable && (
                  <div className="actions">
                    <button
                      className="button small"
                      disabled={busy}
                      onClick={() => download()}
                    >
                      下载模板
                    </button>
                    <button
                      className="button small"
                      disabled={busy}
                      onClick={() => doGuard(() => fileRef.current.click())}
                    >
                      {busy ? "正在处理…" : "导入 Excel"}
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".xlsx"
                      hidden
                      aria-label="上传分配 Excel"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        importFile(file);
                      }}
                    />
                    <label className="history-fill-control">
                      <span>历史期间</span>
                      <select
                        value={historyPeriod}
                        onChange={(event) =>
                          setHistoryPeriod(event.target.value)
                        }
                        aria-label="试算历史期间"
                      >
                        <option value="2025">2025 全年</option>
                        <option value="2026Ytd">2026 YTD</option>
                      </select>
                    </label>
                    <label className="history-fill-control">
                      <span>拆分依据</span>
                      <select
                        value={historyMetric}
                        onChange={(event) =>
                          setHistoryMetric(event.target.value)
                        }
                        aria-label="按比例分配依据"
                      >
                        <option value="c3">C3</option>
                        <option value="vol">Delivery Vol</option>
                        <option value="investment">历史投资</option>
                      </select>
                    </label>
                    <button
                      className="button small"
                      onClick={() => historyFill(historyMetric)}
                    >
                      按比例分配
                    </button>
                    <button
                      className="button small"
                      disabled={!balanceIds.length || totals.gap === 0}
                      onClick={() => {
                        const rows = balanceSelectedDealers(
                          i.rows,
                          balanceIds,
                          totals.gap,
                        );
                        if (!Number.isInteger(totals.gap))
                          return notify(
                            "指定经销商配平要求待分配为整数元。",
                            true,
                          );
                        if (!rows)
                          return notify(
                            "请选择经销商，且配平后任何一家金额不能为负。",
                            true,
                          );
                        setModal({
                          type: "balance",
                          rows,
                          pending: totals.gap,
                        });
                      }}
                    >
                      指定经销商配平
                    </button>
                  </div>
                )}
              </div>
              {editable && (
                <p className="work-caption">
                  经销商列表已包含在下载模板的「经销商列表」工作表中，业务线为第一列。
                </p>
              )}
              <div className="table-scroll">
                <table className="allocation-table allocation-table-simple">
                  <thead>
                    <tr>
                      {editable && <th aria-label="选择配平经销商" />}
                      <th>经销商编码</th>
                      <th>经销商名称</th>
                      <th>SD / RSM</th>
                      <th>状态</th>
                      <th className="num">
                        分配金额（元）<small>2027 计划</small>
                      </th>
                      <th className="num">投资占比</th>
                      <th className="num">Delivery Vol占比</th>
                      <th className="num">C3占比</th>
                      <th className="num">投资−Delivery Vol</th>
                      <th className="num">投资−C3</th>
                      <th className="num">合同量（KL）</th>
                      <th className="num">Delivery Vol（KL）</th>
                      <th className="num">Actual C3（K$）</th>
                      <th className="num">Phasing</th>
                      <th className="num">历史投资（K$）</th>
                      <th className="num">Yield</th>
                      <th>调整说明</th>
                      {editable && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {i.rows.map((r, n) => {
                      const dealer = dealerMeta(r.dealerId),
                        history = dealer.history || {};
                      const vol = Number(history[historyVolKey]) || 0,
                        c3 = Number(history[historyC3Key]) || 0;
                      const investment = historyInvestment(
                        history,
                        historyPeriod,
                      );
                      const yieldValue = historyYield(history, historyPeriod);
                      const investmentShare = totals.allocated
                        ? (r.amount / totals.allocated) * 100
                        : 0;
                      const volShare = scopeHistoryTotals.vol
                        ? (vol / scopeHistoryTotals.vol) * 100
                        : 0;
                      const c3Share = scopeHistoryTotals.c3
                        ? (c3 / scopeHistoryTotals.c3) * 100
                        : 0;
                      return (
                        <tr key={r.dealerId}>
                          {editable && (
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`选择 ${r.dealerId} 参与配平`}
                                checked={balanceIds.includes(r.dealerId)}
                                onChange={() =>
                                  setBalanceIds((current) =>
                                    toggleDealerSelection(current, r.dealerId),
                                  )
                                }
                              />
                            </td>
                          )}
                          <td>{dealerCode(r.dealerId)}</td>
                          <td>{dealerName(r.dealerId)}</td>
                          <td>
                            {dealer.sd || "—"}
                            <small>{dealer.rsm || "—"}</small>
                          </td>
                          <td>
                            <span
                              className={`resource-status ${dealer.status || ""}`}
                            >
                              {dealer.status || "—"}
                            </span>
                          </td>
                          <td className="num">
                            {editable ? (
                              <AmountInput
                                value={r.amount}
                                label={r.dealerId + " 分配金额"}
                                save={(v) => changeRow(n, v)}
                              />
                            ) : (
                              fmt(r.amount)
                            )}
                          </td>
                          <td className="num">{fmt(investmentShare)}%</td>
                          <td className="num">{fmt(volShare)}%</td>
                          <td className="num">{fmt(c3Share)}%</td>
                          <td className="num">
                            {investmentShare - volShare >= 0 ? "+" : ""}
                            {fmt(investmentShare - volShare)}pp
                          </td>
                          <td className="num">
                            {investmentShare - c3Share >= 0 ? "+" : ""}
                            {fmt(investmentShare - c3Share)}pp
                          </td>
                          <td className="num">
                            <span title="历史数据未提供合同量">—</span>
                          </td>
                          <td className="num">
                            {histFmt(history[historyVolKey])}
                          </td>
                          <td className="num">
                            {histFmt(history[historyC3Key])}
                          </td>
                          <td className="num">
                            <span title="历史数据未提供合同量，无法计算 Phasing">
                              —
                            </span>
                          </td>
                          <td className="num">{histFmt(investment)}</td>
                          <td className="num">
                            {yieldValue !== null
                              ? `${yieldValue.toFixed(2)}x`
                              : "—"}
                          </td>
                          <td>
                            {editable ? (
                              <input
                                value={r.note || ""}
                                aria-label={`${r.dealerId} 调整说明`}
                                onChange={(event) =>
                                  update({
                                    rows: i.rows.map((row, index) =>
                                      index === n
                                        ? { ...row, note: event.target.value }
                                        : row,
                                    ),
                                  })
                                }
                              />
                            ) : (
                              r.note || "—"
                            )}
                          </td>
                          {editable && (
                            <td>
                              <button
                                className="button subtle small"
                                aria-label={"移除经销商 " + r.dealerId}
                                onClick={() =>
                                  doGuard(() =>
                                    setModal({
                                      type: "remove",
                                      dealerId: r.dealerId,
                                      amount: r.amount,
                                    }),
                                  )
                                }
                              >
                                移除
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="table-footer">
                <span>
                  {editable
                    ? apiMode
                      ? "输入金额或比例 · 编辑后请保存草稿"
                      : "输入金额或比例 · 修改即时保存"
                    : "经销商分配明细 · 只读"}
                </span>
                {editable && (
                  <div className="actions">
                    <button
                      className="button link"
                      disabled={busy}
                      onClick={() => download(true)}
                    >
                      下载经销商
                    </button>
                    <button
                      className="button link"
                      onClick={() =>
                        doGuard(() => {
                          setNewDealers([]);
                          setDealerCodeSearch("");
                          setDealerNameSearch("");
                          setModal({ type: "add" });
                        })
                      }
                    >
                      + 添加经销商
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
          {activeStep === 1 && (
            <section className="panel other-budget-panel">
              <div className="panel-header">
                <div>
                  <h2>
                    其他预算安排 <small>{i.otherBudgets.length} 行</small>
                  </h2>
                  <p className="small-text muted">
                    按原因逐项登记，可添加多行；金额纳入本项预算平衡。
                  </p>
                </div>
                {editable && (
                  <div className="actions">
                    <button
                      className="button small"
                      disabled={totals.gap === 0}
                      title="仅调整专用找平行，不改动手工安排"
                      onClick={() =>
                        doGuard(() =>
                          mutate(
                            (s) =>
                              E.balanceOtherBudget(s, i.id, identity, data),
                            "已找平，请核对具体原因。",
                          ),
                        )
                      }
                    >
                      一键找平
                    </button>
                    <button
                      className="button small"
                      onClick={() =>
                        doGuard(() => {
                          const reason = state.budgetReasons.find(
                            (r) => r.enabled,
                          );
                          if (!reason)
                            return notify("请先由管理员启用预算原因。", true);
                          update({
                            otherBudgets: [
                              ...i.otherBudgets,
                              {
                                id: "OB-" + crypto.randomUUID(),
                                reasonId: reason.id,
                                amount: 0,
                                note: "",
                              },
                            ],
                          });
                        })
                      }
                    >
                      + 添加安排
                    </button>
                  </div>
                )}
              </div>
              <div className="table-scroll">
                <table className="other-budget-table">
                  <thead>
                    <tr>
                      <th>原因类型</th>
                      <th className="num">金额</th>
                      <th>具体原因</th>
                      {editable && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {i.otherBudgets.map((r, n) => (
                      <tr key={r.id}>
                        <td>
                          {editable ? (
                            <select
                              aria-label={`第 ${n + 1} 项安排原因类型`}
                              value={r.reasonId}
                              onChange={(e) =>
                                changeOther(n, "reasonId", e.target.value)
                              }
                            >
                              {state.budgetReasons
                                .filter(
                                  (reason) =>
                                    reason.enabled || reason.id === r.reasonId,
                                )
                                .map((reason) => (
                                  <option
                                    key={reason.id}
                                    value={reason.id}
                                    disabled={!reason.enabled}
                                  >
                                    {reason.label}
                                    {!reason.enabled && "（已停用）"}
                                  </option>
                                ))}
                            </select>
                          ) : (
                            state.budgetReasons.find(
                              (reason) => reason.id === r.reasonId,
                            )?.label || r.reasonId
                          )}
                        </td>
                        <td className="num">
                          {editable ? (
                            <AmountInput
                              label={`第 ${n + 1} 项安排金额`}
                              value={r.amount}
                              save={(v) => changeOther(n, "amount", v)}
                            />
                          ) : (
                            fmt(r.amount)
                          )}
                        </td>
                        <td>
                          {editable ? (
                            <input
                              aria-label={`第 ${n + 1} 项安排具体原因`}
                              placeholder="填写具体原因或用途"
                              value={r.note}
                              onChange={(e) =>
                                changeOther(n, "note", e.target.value)
                              }
                            />
                          ) : (
                            r.note || "—"
                          )}
                        </td>
                        {editable && (
                          <td>
                            <button
                              className="button subtle small"
                              aria-label={`移除第 ${n + 1} 项预算安排`}
                              onClick={() =>
                                doGuard(() =>
                                  update({
                                    otherBudgets: i.otherBudgets.filter(
                                      (_, index) => index !== n,
                                    ),
                                  }),
                                )
                              }
                            >
                              移除
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {!i.otherBudgets.length && (
                      <tr>
                        <td colSpan={4}>
                          <div className="empty">
                            暂无其他预算安排，可按需要添加。
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {errors.length ? (
            <div className="note-box warn">
              {errors.map((e) => (
                <div key={e}>{e.replace("标记完成", "提交当前方案")}</div>
              ))}
            </div>
          ) : (
            <div className="note-box success">
              分配与预算平衡，可以提交；提交后仍可修改并形成新修订。
            </div>
          )}
          <div className="save-bar">
            <div className="save-label">
              <strong>
                {apiMode
                  ? hasUnsavedChanges
                    ? "本页修改尚未保存"
                    : savedForSync
                      ? "草稿已保存，可以提交"
                      : synchronizedRevision
                        ? "当前修订已提交"
                        : "请先保存草稿后再提交"
                  : "有效修改自动保存到本机"}
              </strong>{" "}
              · {time(i.savedAt)}
              <br />
              最新提交：{time(i.publishedAt)}
            </div>
            {editable && (
              <div className="actions">
                <button
                  className="button"
                  disabled={operation !== null}
                  onClick={handleSaveDraft}
                >
                  {operation === "save" ? "正在保存…" : "保存草稿"}
                </button>
                <button
                  className="button primary"
                  disabled={!canSynchronize}
                  title={
                    !savedForSync || hasUnsavedChanges
                      ? "请先保存草稿，再提交当前方案"
                      : errors.length > 0
                        ? "请先修正当前分配问题"
                        : undefined
                  }
                  onClick={handlePublish}
                >
                  {operation === "publish" ? "正在提交…" : "提交当前方案"}
                </button>
              </div>
            )}
          </div>
        </div>
        {modal && (
          <EditorDialog
            title={
              {
                add: "添加经销商",
                remove: "移除经销商分配",
                fill: "按历史占比辅助填充",
                balance: "指定经销商配平",
                import: "Excel 导入预览",
                history: "单项同步历史",
              }[modal.type]
            }
            close={close}
            action={
              modal.type === "add" ? (
                <button
                  className="button primary"
                  disabled={!newDealers.length}
                  onClick={() => {
                    if (
                      update({
                        rows: [
                          ...i.rows,
                          ...newDealers.map((dealerId) => ({
                            dealerId,
                            amount: 0,
                            note: "",
                          })),
                        ],
                      })
                    )
                      close();
                  }}
                >
                  确认添加
                </button>
              ) : modal.type === "remove" ? (
                <button
                  className="button danger"
                  onClick={() => {
                    if (
                      update({
                        rows: i.rows.filter(
                          (r) => r.dealerId !== modal.dealerId,
                        ),
                      })
                    )
                      close();
                  }}
                >
                  确认移除
                </button>
              ) : modal.type === "fill" ? (
                <button
                  className="button primary"
                  onClick={() => {
                    if (i.revision !== modal.revision)
                      return notify("工作稿已变化，请重新预览。", true);
                    if (update({ rows: modal.rows })) close();
                  }}
                >
                  应用本次填充
                </button>
              ) : modal.type === "balance" ? (
                <button
                  className="button primary"
                  onClick={() => {
                    if (update({ rows: modal.rows })) {
                      setBalanceIds([]);
                      close();
                    }
                  }}
                >
                  确认配平
                </button>
              ) : modal.type === "import" ? (
                <button
                  className="button primary"
                  disabled={modal.preview.errors.length > 0}
                  onClick={async () => {
                    const values = {
                      rows: modal.preview.rows,
                      otherBudgets: modal.preview.otherBudgets,
                    };
                    if (await saveDraft(i.id, values, modal.preview.revision))
                      close();
                  }}
                >
                  确认写入
                </button>
              ) : null
            }
          >
            {modal.type === "add" && (
              <>
                <div className="dealer-search-grid">
                  <label className="form-field">
                    经销商编码
                    <input
                      type="search"
                      autoFocus
                      value={dealerCodeSearch}
                      placeholder="模糊搜索经销商编码"
                      onChange={(e) => setDealerCodeSearch(e.target.value)}
                    />
                  </label>
                  <label className="form-field">
                    经销商名称
                    <input
                      type="search"
                      value={dealerNameSearch}
                      placeholder="模糊搜索经销商名称"
                      onChange={(e) => setDealerNameSearch(e.target.value)}
                    />
                  </label>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th aria-label="选择经销商" />
                        <th>业务线</th>
                        <th>经销商编码</th>
                        <th>经销商名称</th>
                        <th>SD</th>
                        <th>RSM</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchedDealers.map((dealer) => (
                        <tr key={dealer.id}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`选择经销商 ${dealer.id} ${dealer.name || ""}`}
                              checked={newDealers.includes(dealer.id)}
                              onChange={() =>
                                setNewDealers((current) =>
                                  toggleDealerSelection(current, dealer.id),
                                )
                              }
                            />
                          </td>
                          <td>{dealer.sector || "—"}</td>
                          <td>{dealer.code || dealer.id}</td>
                          <td>{dealer.name || "—"}</td>
                          <td>{dealer.sd || "—"}</td>
                          <td>{dealer.rsm || "—"}</td>
                          <td>
                            <span
                              className={`resource-status ${dealer.status || ""}`}
                            >
                              {dealer.status || "—"}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {!searchedDealers.length && (
                        <tr>
                          <td colSpan={7}>
                            {directoryStatus === "loading" ? (
                              "正在加载历史表经销商目录…"
                            ) : directoryStatus === "error" ? (
                              <>
                                经销商目录加载失败，请稍后重试。
                                <button
                                  className="button subtle small"
                                  onClick={() =>
                                    loadDistributorDirectory({ force: true })
                                  }
                                >
                                  重新加载
                                </button>
                              </>
                            ) : available.length ? (
                              "没有匹配的经销商"
                            ) : (
                              "已无可添加经销商"
                            )}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {modal.type === "remove" && (
              <p>
                移除 {modal.dealerId} 的 {fmt(modal.amount)}{" "}
                分配后，金额将成为未解释差额，不会自动移到其他行。
              </p>
            )}
            {modal.type === "fill" && (
              <>
                <p>
                  以当前经销商范围的 {modal.metricLabel}
                  占比拆分预算，保留其他预算安排。此操作不代表投资推荐。
                </p>
                <MissingHistoryNotice
                  metricLabel={modal.metricLabel}
                  unavailable={modal.unavailable}
                  hasHistory={modal.hasHistory}
                />
                {!modal.rows.length && (
                  <p role="status">
                    尚未添加经销商，可分配预算保留为未分配差额。
                  </p>
                )}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>经销商</th>
                        <th>当前金额</th>
                        <th>预览金额</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modal.rows.map((r, n) => (
                        <tr key={r.dealerId}>
                          <td>{dealerCode(r.dealerId)}</td>
                          <td>{fmt(i.rows[n].amount)}</td>
                          <td>{fmt(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {modal.type === "balance" && (
              <>
                <p>
                  待分配 {fmt(modal.pending)} 元将在已勾选的 {balanceIds.length}{" "}
                  家经销商之间均摊；余数按当前金额降序、编码升序逐家分配。
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>经销商</th>
                        <th className="num">当前金额</th>
                        <th className="num">配平后</th>
                        <th className="num">变化</th>
                      </tr>
                    </thead>
                    <tbody>
                      {i.rows
                        .filter((row) => balanceIds.includes(row.dealerId))
                        .map((row) => {
                          const after = modal.rows.find(
                            (value) => value.dealerId === row.dealerId,
                          );
                          return (
                            <tr key={row.dealerId}>
                              <td>{dealerCode(row.dealerId)}</td>
                              <td className="num">{fmt(row.amount)}</td>
                              <td className="num">{fmt(after.amount)}</td>
                              <td className="num">
                                {after.amount - row.amount >= 0 ? "+" : ""}
                                {fmt(after.amount - row.amount)}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <div className="note-box success">
                  确认后待分配为 0；主动预留不参与本次配平。
                </div>
              </>
            )}
            {modal.type === "import" && (
              <>
                <p>
                  {modal.name} ·{" "}
                  {modal.preview.errors.length
                    ? "存在错误，不能写入"
                    : "校验通过，确认后完整替换分配明细及其他预算安排"}
                </p>
                {modal.preview.errors.length > 0 && (
                  <ul className="import-errors">
                    {modal.preview.errors.map((error, n) => (
                      <li key={n}>{error}</li>
                    ))}
                  </ul>
                )}
                <div className="note-box">
                  导入前安排 {fmt(modal.preview.summary.before)} · 导入后安排{" "}
                  {fmt(modal.preview.summary.after)} · 导入后差额{" "}
                  {fmt(modal.preview.summary.gap)}
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>经销商</th>
                        <th>导入前</th>
                        <th>导入后</th>
                        <th>变化</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modal.preview.changes
                        .filter((c) => !c.otherBudgets)
                        .map((c) => (
                          <tr key={c.dealerId}>
                            <td>{c.dealerId}</td>
                            <td>{c.before ? fmt(c.before.amount) : "—"}</td>
                            <td>{c.after ? fmt(c.after.amount) : "—"}</td>
                            <td>
                              {!c.before ? "新增" : !c.after ? "删除" : "修改"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <h3>
                  其他预算安排 · {modal.preview.otherBudgets?.length || 0} 行
                </h3>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>原因类型</th>
                        <th>金额</th>
                        <th>具体原因</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modal.preview.otherBudgets?.map((r, n) => (
                        <tr key={n}>
                          <td>
                            {state.budgetReasons.find(
                              (reason) => reason.id === r.reasonId,
                            )?.label || r.reasonId}
                          </td>
                          <td>{fmt(r.amount)}</td>
                          <td>{r.note || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="note-box">
                  确认时再次校验身份、修订号与原因配置；未同步前不影响管理层数据。
                </p>
              </>
            )}
            {modal.type === "history" && (
              <>
                {history.length ? (
                  [...history].reverse().map((record) => (
                    <details key={record.id}>
                      <summary>
                        第 {record.number} 次同步 · {time(record.publishedAt)} ·
                        修订 {record.publishedRevision}
                      </summary>
                      <p>
                        预算 {fmt(record.initiative.budget)} · 经销商分配{" "}
                        {fmt(E.totals([record.initiative]).allocated)} ·
                        参考批次 {record.reference.batchId}
                      </p>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>经销商</th>
                              <th>同步金额</th>
                            </tr>
                          </thead>
                          <tbody>
                            {record.initiative.rows.map((r) => (
                              <tr key={r.dealerId}>
                                <td>{dealerCode(r.dealerId)}</td>
                                <td>{fmt(r.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {record.initiative.otherBudgets?.map((r) => (
                        <p key={r.id}>
                          {state.budgetReasons.find(
                            (reason) => reason.id === r.reasonId,
                          )?.label || r.reasonId}{" "}
                          · {fmt(r.amount)} · {r.note}
                        </p>
                      ))}
                    </details>
                  ))
                ) : (
                  <div className="empty">
                    尚未同步，完成分配后可同步给管理层。
                  </div>
                )}
              </>
            )}
          </EditorDialog>
        )}
      </div>
    </>
  );
}
import { validatePortalSession } from "../../portal/session";
import { assertPreviewResponseCurrent, getPreviewEpoch } from "../userPreview";
