import { useEffect, useRef, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import X from "../domain/excel.js";
const fmt = (n) =>
  Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(2) : "0.00");
const time = (v) => (v ? new Date(v).toLocaleString("zh-CN") : "尚未同步");
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
  dirtyIds,
  notify,
  openAuxiliary,
}) {
  const [modal, setModal] = useState(null),
    [newDealer, setNewDealer] = useState(""),
    [busy, setBusy] = useState(false);
  const fileRef = useRef(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const i = view.initiatives.find((item) => item.id === initiativeId);
  if (!i) return <div className="empty">当前角色无权查看该明细。</div>;
  const editable = E.canEdit(state, i.id, identity),
    totals = E.totals([i]),
    errors = E.completionErrors(i, data, state.budgetReasons);
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
  const available = data.dealers.filter(
    (d) => !i.rows.some((r) => r.dealerId === d.id),
  );
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
  const download = async () => {
    if (!guard()) return;
    setBusy(true);
    try {
      const bytes = await X.exportWorkbook(state, i.id, identity);
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${i.department}_${i.name}_${i.id}_分配模板.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
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
      const preview = await X.previewImport(
        await file.arrayBuffer(),
        state,
        i.id,
        identity,
        data,
      );
      if (alive.current) setModal({ type: "import", preview, name: file.name });
    } catch (e) {
      notify(e.message, true);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const historyFill = () =>
    doGuard(() => {
      try {
        const available = E.cents(i.budget - totals.otherBudget);
        if (available < 0)
          throw Error("其他预算安排超过总预算，无法辅助填充。");
        const weights = i.rows.map(
          (r) =>
            data.dealers.find((d) => d.id === r.dealerId)?.history.vol2025 || 0,
        );
        const sum = weights.reduce((s, w) => s + w, 0);
        if (!weights.length || !sum)
          throw Error("当前范围没有有效的 2025 Vol 占比，不能自动填充。");
        const exact = weights.map((w) => (available * w) / sum),
          cents = exact.map(Math.floor);
        let left = available - cents.reduce((s, n) => s + n, 0);
        const order = exact
          .map((v, index) => ({ index, fraction: v - cents[index] }))
          .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
        for (let n = 0; n < left; n++) cents[order[n % order.length].index]++;
        setModal({
          type: "fill",
          revision: i.revision,
          rows: i.rows.map((r, n) => ({ ...r, amount: cents[n] / 100 })),
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
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{i.name}</h1>
          <p>调整金额后可重复同步，管理层始终查看最新同步版本。</p>
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
        <span>{i.id.replace("initiative-", "I-")}</span>
        <span>Sector {i.sector}</span>
        <span>{i.resourceType}</span>
        <span>{i.ownerId}</span>
        <span>
          {time(i.publishedAt)}
          {i.publishedAt &&
            (i.publishedRevision !== i.revision
              ? " · 本地有新调整，待同步"
              : " · 已同步最新分配")}
        </span>
        {identity.role === "owner" && (
          <button
            className="button small"
            onClick={() =>
              doGuard(() => openAuxiliary("insight", "initiative:" + i.id))
            }
          >
            本项 Insight
          </button>
        )}
        <button
          className="button small"
          onClick={() => doGuard(() => setModal({ type: "history" }))}
        >
          同步历史（{history.length}）
        </button>
      </div>
      {!editable && (
        <div className="note-box">
          只读查看 · 由该 Initiative 的 Marketer 维护分配。
        </div>
      )}
      <div className="budget-summary">
        {[
          ["总预算 · 只读", totals.budget],
          ["经销商分配", totals.allocated],
          [
            state.budgetReasons.find((reason) => reason.id === "reserve")
              ?.label || "新增经销商预留",
            totals.reserve,
          ],
          ["其他未到经销商预算", totals.nonDealer],
          ["未解释差额", totals.gap],
        ].map(([label, value], n) => (
          <div
            key={label}
            className={n === 4 ? "gap " + (value ? "unbalanced" : "") : ""}
          >
            <label>{label}</label>
            <strong>{fmt(value)}</strong>
          </div>
        ))}
      </div>
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
            已超出预算 {fmt(-totals.gap)}，请减少分配金额，配平后才能同步。
          </div>
        )}
      </section>
      <div className="editor-layout">
        <section className="panel">
          <div className="panel-header">
            <h2>
              经销商分配 <small>{i.rows.length} 行</small>
            </h2>
            {editable && (
              <div className="actions">
                <button
                  className="button small"
                  disabled={busy}
                  onClick={download}
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
                <button className="button small" onClick={historyFill}>
                  按历史占比填充
                </button>
              </div>
            )}
          </div>
          <div className="table-scroll">
            <table className="allocation-table allocation-table-simple">
              <thead>
                <tr>
                  <th>经销商编码</th>
                  <th className="num">
                    分配金额<small>2027 计划</small>
                  </th>
                  <th className="num">
                    比例 %<small>占本项预算</small>
                  </th>
                  {editable && <th />}
                </tr>
              </thead>
              <tbody>
                {i.rows.map((r, n) => (
                  <tr key={r.dealerId}>
                    <td>
                      <button
                        className="button link"
                        onClick={() => openAuxiliary("reference", r.dealerId)}
                      >
                        {r.dealerId}
                      </button>
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
                    <td className="num">
                      {editable ? (
                        <AmountInput
                          value={pct(r.amount, i.budget)}
                          disabled={!i.budget}
                          label={r.dealerId + " 分配比例"}
                          save={(v) =>
                            changeRow(n, Math.round(i.budget * v) / 100)
                          }
                        />
                      ) : (
                        pct(r.amount, i.budget)
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
                ))}
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
              <button
                className="button link"
                onClick={() =>
                  doGuard(() => {
                    setNewDealer(available[0]?.id || "");
                    setModal({ type: "add" });
                  })
                }
              >
                + 添加经销商
              </button>
            )}
          </div>
        </section>
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
                        (s) => E.balanceOtherBudget(s, i.id, identity, data),
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
                      const reason = state.budgetReasons.find((r) => r.enabled);
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
        {errors.length ? (
          <div className="note-box warn">
            {errors.map((e) => (
              <div key={e}>{e.replace("标记完成", "同步最新分配")}</div>
            ))}
          </div>
        ) : (
          <div className="note-box success">
            分配与预算平衡，可同步给管理层；同步后仍可修改。
          </div>
        )}
        <div className="save-bar">
          <div className="save-label">
            <strong>
              {apiMode
                ? dirtyIds.has(i.id)
                  ? "本页修改尚未保存"
                  : "草稿已保存"
                : "有效修改自动保存到本机"}
            </strong>{" "}
            · {time(i.savedAt)}
            <br />
            最新同步：{time(i.publishedAt)}
          </div>
          {editable && (
            <div className="actions">
              <button
                className="button"
                onClick={() => doGuard(() => saveDraft(i.id))}
              >
                保存草稿
              </button>
              <button
                className="button primary"
                disabled={errors.length > 0}
                onClick={() => doGuard(() => publish(i.id))}
              >
                同步最新分配
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
              import: "Excel 导入预览",
              history: "单项同步历史",
            }[modal.type]
          }
          close={close}
          action={
            modal.type === "add" ? (
              <button
                className="button primary"
                disabled={!newDealer}
                onClick={() => {
                  if (
                    update({
                      rows: [
                        ...i.rows,
                        { dealerId: newDealer, amount: 0, note: "" },
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
                      rows: i.rows.filter((r) => r.dealerId !== modal.dealerId),
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
            <label className="form-field">
              经销商
              <select
                value={newDealer}
                onChange={(e) => setNewDealer(e.target.value)}
              >
                {available.length ? (
                  available.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.id}
                    </option>
                  ))
                ) : (
                  <option value="">已无可添加经销商</option>
                )}
              </select>
            </label>
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
                以当前经销商范围的 2025 全年 Vol
                占比拆分预算，保留其他预算安排。此操作不代表投资推荐。
              </p>
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
                        <td>{r.dealerId}</td>
                        <td>{fmt(i.rows[n].amount)}</td>
                        <td>{fmt(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                      {fmt(E.totals([record.initiative]).allocated)} · 参考批次{" "}
                      {record.reference.batchId}
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
                              <td>{r.dealerId}</td>
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
    </>
  );
}
