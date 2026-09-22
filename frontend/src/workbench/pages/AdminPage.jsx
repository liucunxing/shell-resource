import { useEffect, useRef, useState } from "react";
import { useWorkbench } from "../WorkbenchContext.jsx";
import E from "../domain/engine.js";
import AX from "../domain/admin-excel.js";

const money = (value) =>
  Number.isFinite(value)
    ? value.toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "无效值";
const time = (value) => (value ? new Date(value).toLocaleString("zh-CN") : "—");
const tabs = [
  ["budgets", "预算与归属"],
  ["reasons", "预算原因配置"],
  ["reference", "参考数据批次"],
  ["permissions", "人员与权限"],
  ["guide", "分析指南"],
  ["audit", "变更记录"],
];
const actionNames = {
  set_budget: "预算调整",
  import_admin_configuration: "预算与归属导入",
  change_reference: "参考批次发布",
  set_guide: "分析指南更新",
  generate_insight: "生成模拟分析",
  set_owner: "Owner 映射调整",
  set_analysis_prompt: "分析提示词更新",
  set_budget_reasons: "预算原因更新",
  save_initiative: "保存工作稿",
  publish_initiative: "同步最新分配",
};

function AdminDialog({
  title,
  children,
  onClose,
  onConfirm,
  confirmLabel = "保存",
  disabled = false,
}) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal wide"
      aria-labelledby="admin-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      style={{ border: 0, padding: 0, maxHeight: "88dvh", overflow: "auto" }}
    >
      <div className="modal-head">
        <h2 id="admin-dialog-title">{title}</h2>
        <button
          className="button"
          type="button"
          onClick={onClose}
          aria-label="关闭弹窗"
        >
          ×
        </button>
      </div>
      <div className="modal-body">{children}</div>
      <div className="modal-foot">
        <button className="button" type="button" onClick={onClose}>
          {onConfirm ? "取消" : "关闭"}
        </button>
        {onConfirm && (
          <button
            type="button"
            className="button primary"
            disabled={disabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        )}
      </div>
    </dialog>
  );
}

export function AdminPage() {
  const { state, view, identity, mutate, notify } = useWorkbench();
  const [tab, setTab] = useState("budgets");
  const [modal, setModal] = useState(null);
  const [value, setValue] = useState("");
  const [guide, setGuide] = useState(state.guide.text);
  const [busy, setBusy] = useState(false);
  const upload = useRef(null);
  const sequence = useRef(0);
  const latest = useRef({ state, identity, tab });
  latest.current = { state, identity, tab };
  useEffect(
    () => () => {
      sequence.current += 1;
    },
    [],
  );
  useEffect(() => {
    setGuide(state.guide.text);
  }, [state.guide.text]);
  useEffect(() => {
    sequence.current += 1;
    setModal(null);
    setBusy(false);
  }, [identity]);
  const items = (typeof view === "function" ? view() : view).initiatives;
  const close = () => {
    sequence.current += 1;
    setModal(null);
    setBusy(false);
  };
  const change = (fn, message) => {
    if (mutate(fn, message)) close();
  };
  const edit = (kind, item, initial) => {
    setValue(String(initial));
    setModal({ kind, item });
  };
  const switchTab = (next) => {
    close();
    setTab(next);
  };

  async function exportConfig() {
    try {
      const bytes = await AX.exportWorkbook(state, identity);
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "管理员配置_预算与归属_2027.xlsx";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("已导出当前配置，可修改预算与 Owner 列后导入。");
    } catch (error) {
      notify(error.message, true);
    }
  }
  async function importConfig(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    const request = ++sequence.current;
    const before = state,
      actor = identity;
    setBusy(true);
    setModal(null);
    try {
      if (file.size > 10 * 1024 * 1024)
        throw Error("配置文件请控制在 10 MB 以内。");
      const result = await AX.previewImport(
        await file.arrayBuffer(),
        before,
        actor,
      );
      if (request !== sequence.current) return;
      if (
        latest.current.state !== before ||
        latest.current.identity !== actor ||
        latest.current.tab !== "budgets"
      ) {
        notify("读取期间配置或身份已变化，请重新导入。", true);
        return;
      }
      setModal({ kind: "import", result, filename: file.name });
    } catch (error) {
      if (request === sequence.current) notify(error.message, true);
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  function saveEdit() {
    if (modal.kind === "budget")
      change((draft) => {
        if (value.trim() === "") throw Error("预算不能为空。");
        E.setBudget(draft, modal.item.id, Number(value), identity);
      }, "预算已变更，原分配保持不变，需由 Marketer 复核并重新同步。");
    if (modal.kind === "owner")
      change(
        (draft) => E.setOwner(draft, modal.item.id, value, identity),
        "Owner 映射已更新，原分配保留。",
      );
    if (modal.kind === "reason")
      change((draft) => {
        const reasons = draft.budgetReasons.map((row) => ({ ...row }));
        if (modal.item)
          reasons.find((row) => row.id === modal.item.id).label = value.trim();
        else
          reasons.push({
            id: `reason-${crypto.randomUUID()}`,
            label: value.trim(),
            enabled: true,
          });
        E.setBudgetReasons(draft, reasons, identity);
      }, "预算原因已更新，已有记录保留。");
  }
  if (identity.role !== "admin")
    return <div className="empty">仅管理员可访问管理后台。</div>;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>管理后台</h1>
          <p>维护预算、参考数据和分析依据。业务工作稿按操作即时保存。</p>
        </div>
      </div>
      <div className="tabs" aria-label="管理后台栏目">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : ""}
            aria-pressed={tab === id}
            onClick={() => switchTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "budgets" && (
        <section className="panel">
          <div className="panel-header admin-config-header">
            <div>
              <h2>预算与 Owner 映射</h2>
              <p className="small-text muted">
                {items.length} 项 · 总预算 {money(E.totals(items).budget)}
              </p>
            </div>
            <div className="actions">
              <button className="button small" onClick={exportConfig}>
                导出配置
              </button>
              <button
                className="button primary small"
                disabled={busy}
                onClick={() => upload.current.click()}
              >
                {busy ? "正在读取…" : "导入 Excel"}
              </button>
              <input
                ref={upload}
                className="upload-input"
                type="file"
                accept=".xlsx"
                aria-label="上传管理员配置 Excel"
                onChange={importConfig}
              />
            </div>
          </div>
          <div className="admin-config-hint">
            导出当前配置后修改预算或
            Owner，导入时预览差异。可只保留需更新的项目，未列出的项目保持不变。
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Initiative</th>
                  <th>Sector</th>
                  <th>资源类型</th>
                  <th>部门 / Owner</th>
                  <th className="num">预算</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.name}
                      <div className="table-sub">{item.id}</div>
                    </td>
                    <td>{item.sector}</td>
                    <td>{item.resourceType}</td>
                    <td>
                      {item.department} / {item.ownerId}
                    </td>
                    <td className="num">{money(item.budget)}</td>
                    <td>
                      <div className="actions">
                        <button
                          className="button small"
                          onClick={() => edit("budget", item, item.budget)}
                        >
                          调整预算
                        </button>
                        <button
                          className="button small"
                          onClick={() => edit("owner", item, item.ownerId)}
                        >
                          分配 Owner
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            预算与归属可持续调整；不会自动重分配。共享结果在 Marketer
            再次同步后更新。
          </div>
        </section>
      )}
      {tab === "reasons" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>其他预算原因</h2>
              <p className="small-text muted">
                用于 Marketer 添加预算安排时的下拉选项；停用后保留已有记录。
              </p>
            </div>
            <button
              className="button primary small"
              onClick={() => edit("reason", null, "")}
            >
              + 添加原因
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>原因名称</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {state.budgetReasons.map((reason) => (
                  <tr key={reason.id}>
                    <td>{reason.label}</td>
                    <td>
                      <span className={`badge ${reason.enabled ? "teal" : ""}`}>
                        {reason.enabled ? "启用" : "停用"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="button small"
                        onClick={() => edit("reason", reason, reason.label)}
                      >
                        改名
                      </button>{" "}
                      <button
                        className="button small"
                        onClick={() =>
                          mutate(
                            (draft) =>
                              E.setBudgetReasons(
                                draft,
                                draft.budgetReasons.map((row) =>
                                  row.id === reason.id
                                    ? { ...row, enabled: !row.enabled }
                                    : row,
                                ),
                                identity,
                              ),
                            "预算原因状态已更新，已有记录保留。",
                          )
                        }
                      >
                        {reason.enabled ? "停用" : "启用"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {tab === "reference" && (
        <>
          <section className="panel">
            <div className="panel-header">
              <h2>历史参考数据批次</h2>
              <span className="badge">本地模拟</span>
            </div>
            <div className="panel-body">
              <dl className="definition-grid">
                <dt>数据截至期</dt>
                <dd>
                  {state.reference.asOf}{" "}
                  <span className="muted">（2026 为 1—8 月累计演示假设）</span>
                </dd>
                <dt>导入时间</dt>
                <dd>{time(state.reference.importedAt)}</dd>
                <dt>当前批次号</dt>
                <dd>{state.reference.batchId}</dd>
                <dt>记录数</dt>
                <dd>60 个经销商 · 75 个 Initiative · 600 条初始分配</dd>
                <dt>发布校验</dt>
                <dd>唯一键、主数据匹配、资源加总和计划金额已通过源数据核对</dd>
              </dl>
              <div className="flow-diagram">
                <span>Databricks 月度人工推送</span>
                <b>→</b>
                <span>暂存与校验</span>
                <b>→</b>
                <span>发布到 PostgreSQL</span>
              </div>
              <div className="note-box">
                当前仅模拟发布状态与版本变化，沿用同一份历史数值，不补造下个月业绩。真实导入、事务发布与连接尚未接入。
              </div>
              <div className="actions">
                <button
                  className="button primary"
                  onClick={() => setModal({ kind: "reference" })}
                >
                  校验并模拟发布新批次
                </button>
                <button
                  className="button"
                  onClick={() => setModal({ kind: "reference-fail" })}
                >
                  模拟校验失败
                </button>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>预期表现数据</h2>
              <span className="badge">未提供</span>
            </div>
            <div className="panel-body">
              <p className="small-text muted">
                源文件没有 2027 预计 Vol、C3，也没有实际执行数据。当前仅有 2027
                预算及分配，不生成预测或 Tracking。
              </p>
            </div>
          </section>
        </>
      )}
      {tab === "permissions" && (
        <section className="panel">
          <div className="panel-header">
            <h2>演示人员与权限映射</h2>
            <span className="badge">模拟配置</span>
          </div>
          <div className="panel-body">
            <div className="note-box">
              部门并非 Excel
              原始字段。本原型用资源类型映射部门，并为每个部门配置两位
              Owner。此处展示权限合同，生产端须由后端执行。
            </div>
            <div className="table-scroll">
              <table className="contract-table">
                <thead>
                  <tr>
                    <th>角色</th>
                    <th>分配操作</th>
                    <th>历史资源范围</th>
                    <th>协作权限</th>
                  </tr>
                </thead>
                <tbody>
                  {E.DEPARTMENTS.map((department) => (
                    <tr key={department}>
                      <td>{department} Marketer 1 / 2</td>
                      <td>
                        仅本人 Initiative
                        <br />
                        可看部门汇总，不可打开同事明细
                      </td>
                      <td>
                        {department === "MKT"
                          ? "MRD、SP&A"
                          : department === "ICE"
                            ? "ICE Rebate"
                            : "Capex"}
                        <br />
                        Vol / C3 按演示共享授权
                      </td>
                      <td>保存、导入、反复同步、本人 Insight</td>
                    </tr>
                  ))}
                  <tr>
                    <td>部门负责人</td>
                    <td>本部门明细只读</td>
                    <td>本部门授权资源</td>
                    <td>本部门只读汇总、部门 Insight</td>
                  </tr>
                  <tr>
                    <td>管理层</td>
                    <td>各部门同步快照只读</td>
                    <td>全局同步结果及授权整体参考</td>
                    <td>最新同步结果只读、筛选排序、线下沟通</td>
                  </tr>
                  <tr>
                    <td>管理员</td>
                    <td>维护预算、Owner；不代改分配</td>
                    <td>维护参考数据与权限配置</td>
                    <td>变更记录、分析指南维护</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
      {tab === "guide" && (
        <section className="panel">
          <div className="panel-header">
            <h2>业务分析指南</h2>
            <span className="badge blue">v{state.guide.version}</span>
          </div>
          <div className="panel-body">
            <label className="form-field">
              指南内容
              <textarea
                rows={7}
                value={guide}
                onChange={(event) => setGuide(event.target.value)}
              />
              <small>
                固定输出：发现 / 证据 / 对象 /
                复核方向。指南变更使旧分析标为待更新。
              </small>
            </label>
            <button
              className="button primary"
              onClick={() =>
                mutate(
                  (draft) => E.setGuide(draft, guide, identity),
                  "指南新版本已保存，已有 Insight 需复核更新。",
                )
              }
            >
              保存为新指南版本
            </button>
            <div className="note-box">
              本原型只演示指南保存、版本与失效关系。模拟分析为确定性模板，不宣称模型已经理解或执行自定义指南。
            </div>
          </div>
        </section>
      )}
      {tab === "audit" && (
        <section className="panel">
          <div className="panel-header">
            <h2>操作与版本记录</h2>
            <span className="small-text muted">当前浏览器演示记录</span>
          </div>
          <div className="table-scroll">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>角色</th>
                  <th>动作</th>
                  <th>对象</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {state.audit
                  .slice()
                  .reverse()
                  .map((entry, index) => (
                    <tr key={entry.id || index}>
                      <td>{time(entry.createdAt)}</td>
                      <td>
                        {entry.actor.ownerId ||
                          entry.actor.department ||
                          entry.actor.role}
                      </td>
                      <td>{actionNames[entry.action] || entry.action}</td>
                      <td>{entry.object}</td>
                      <td>{entry.detail || "—"}</td>
                    </tr>
                  ))}
                {!state.audit.length && (
                  <tr>
                    <td colSpan={5}>尚无操作记录。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {modal && ["budget", "owner", "reason"].includes(modal.kind) && (
        <AdminDialog
          title={
            {
              budget: "管理员调整预算",
              owner: "维护 Initiative Owner",
              reason: modal.item ? "修改预算原因" : "添加预算原因",
            }[modal.kind]
          }
          onClose={close}
          onConfirm={saveEdit}
        >
          {modal.item && modal.kind !== "reason" && (
            <p>
              {modal.item.name} · {modal.item.sector} · {modal.item.department}
            </p>
          )}
          {modal.kind === "budget" && (
            <>
              <label className="form-field">
                新的 Initiative 总预算
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              </label>
              <div className="note-box warn">
                仅变更预算上限，不自动改分配。需要 Marketer
                重新平衡并同步，旧分析将待更新。
              </div>
            </>
          )}
          {modal.kind === "owner" && (
            <>
              <label className="form-field">
                部门内 Owner
                <select
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                >
                  {[1, 2].map((n) => (
                    <option key={n} value={`${modal.item.department}-${n}`}>
                      {modal.item.department}-{n}
                    </option>
                  ))}
                </select>
              </label>
              <div className="note-box">
                不改变部门与资源类型归属；变更后由新的 Owner 复核并同步。
              </div>
            </>
          )}
          {modal.kind === "reason" && (
            <label className="form-field">
              原因名称
              <input
                maxLength={80}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="如：新增经销商预留"
              />
            </label>
          )}
        </AdminDialog>
      )}
      {modal?.kind === "reference" && (
        <AdminDialog
          title="参考批次发布预览"
          onClose={close}
          confirmLabel="确认模拟发布"
          onConfirm={() =>
            change(
              (draft) => E.changeReference(draft, identity),
              "新模拟批次已发布；已同步版本仍保留原依据。",
            )
          }
        >
          <div className="note-box success">
            源数据唯一键、经销商匹配、资源加总核对通过。
          </div>
          <p>
            本次演示复用当前 60
            个经销商的历史值，只更新批次号和导入时间；数据截至期保持{" "}
            {state.reference.asOf}。
          </p>
          <div className="note-box">
            发布不修改预算、分配或已同步快照。后续草稿分析使用新批次，旧分析标为待更新。
          </div>
        </AdminDialog>
      )}
      {modal?.kind === "reference-fail" && (
        <AdminDialog title="模拟批次校验失败" onClose={close}>
          <div className="note-box error">
            模拟错误：暂存批次出现重复经销商主键。未发布任何数据。
          </div>
          <p>
            继续使用当前批次 <b>{state.reference.batchId}</b>，截至{" "}
            {state.reference.asOf}。这只是失败状态演示，源数据并无此错误。
          </p>
        </AdminDialog>
      )}
      {modal?.kind === "import" && (
        <AdminDialog
          title="管理员配置导入预览"
          onClose={close}
          disabled={
            !!modal.result.errors.length || !modal.result.changes.length
          }
          confirmLabel={
            modal.result.errors.length
              ? "请修正文件后重试"
              : `确认更新 ${modal.result.changes.length} 项`
          }
          onConfirm={() =>
            change(
              (draft) => AX.confirmImport(modal.result, draft, identity),
              `已更新 ${modal.result.changes.length} 项预算/归属，原分配保留，需由 Owner 复核并重新同步。`,
            )
          }
        >
          <p className="small-text muted">
            {modal.filename} · {modal.result.rows} 行 ·{" "}
            {modal.result.changes.length} 项变化 · {modal.result.unchanged}{" "}
            项不变
          </p>
          {modal.result.errors.length ? (
            <div className="note-box error">
              <strong>校验未通过，整份文件不会写入</strong>
              <ul className="import-errors">
                {modal.result.errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="note-box warn">
              {modal.result.changes.length
                ? "确认后只更新下列项目的预算或归属；原经销商分配保留，受影响项目需复核并重新同步。"
                : "导入配置与当前一致，无需写入。"}
            </div>
          )}
          <div className="admin-import-summary">
            <span>
              当前总预算 <b>{money(modal.result.summary.before)}</b>
            </span>
            <span>
              导入后总预算{" "}
              <b>
                {modal.result.errors.length
                  ? "—"
                  : money(modal.result.summary.after)}
              </b>
            </span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Initiative / 部门</th>
                  <th>预算变化</th>
                  <th>Owner 变化</th>
                </tr>
              </thead>
              <tbody>
                {modal.result.changes.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <b>{row.name}</b>
                      <div className="table-sub">
                        {row.id} · {row.department}
                      </div>
                    </td>
                    <td>
                      {money(row.before.budget)} →{" "}
                      <b>{money(row.after.budget)}</b>
                    </td>
                    <td>
                      {row.before.ownerId} →{" "}
                      <b>{row.after.ownerId || "未填写"}</b>
                    </td>
                  </tr>
                ))}
                {!modal.result.changes.length && (
                  <tr>
                    <td colSpan={3}>
                      <div className="empty">没有配置差异</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="small-text muted">
            未列出的项目保持不变。确认时再次检查管理员身份、项目修订及原因配置。
          </p>
        </AdminDialog>
      )}
    </>
  );
}
