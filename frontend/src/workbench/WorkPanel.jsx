import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowSquareOut,
  ArrowUpRight,
  BookOpen,
  ChatCircleDots,
  ChatText,
  FileText,
  List,
  PaperPlaneTilt,
  PlusCircle,
  SidebarSimple,
  Sparkle,
  User,
} from "@phosphor-icons/react";
import { useWorkbench } from "./WorkbenchContext.jsx";
import E from "./domain/engine.js";
import A from "./domain/explore.js";
import { InsightPanel } from "./pages/InsightPanel.jsx";
import { parseYiwenUrl } from "../config/yiwen";
const config = parseYiwenUrl(import.meta.env.VITE_YIWEN_IFRAME_URL);
const fmt = (value) =>
  Number.isFinite(value)
    ? value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
    : "—";
const when = (value) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
const tabs = [
  ["reference", BookOpen, "参考"],
  ["feedback", ChatText, "反馈"],
  ["insight", Sparkle, "Insight"],
  ["chat", ChatCircleDots, "问数"],
];

export function WorkPanel({ overlay }) {
  const {
    identity,
    auxiliary,
    setAuxiliary,
    openAuxiliary,
    closeAuxiliary,
    mobileNav,
    page,
    initiativeId,
    view,
  } = useWorkbench();
  const panel = useRef(null);
  const closeButton = useRef(null);
  const [chatVisited, setChatVisited] = useState(false);
  useEffect(() => {
    if (auxiliary.open && auxiliary.tab === "chat") setChatVisited(true);
  }, [auxiliary.open, auxiliary.tab]);
  useEffect(() => {
    if (!auxiliary.open) return;
    if (overlay) closeButton.current?.focus();
    const onKey = (event) => {
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeAuxiliary();
      }
      if (overlay && event.key === "Tab") {
        const items = [
          ...panel.current.querySelectorAll(
            'button,select,input,textarea,a[href],iframe,[tabindex="0"]',
          ),
        ].filter(
          (item) =>
            item.getClientRects().length &&
            !item.disabled &&
            !item.closest("[hidden]"),
        );
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [auxiliary.open, overlay]);
  const defaultScope =
    identity.role === "owner"
      ? page === "editor" &&
        view.initiatives.some((item) => item.id === initiativeId)
        ? `initiative:${initiativeId}`
        : `owner:${identity.ownerId}`
      : identity.department || "global";
  const scope = auxiliary.scope || defaultScope;
  return (
    <>
      {auxiliary.open && overlay && (
        <button
          className="work-scrim"
          aria-label="收起工作栏"
          onClick={closeAuxiliary}
        />
      )}
      <aside
        ref={panel}
        className="workbench"
        aria-label="辅助工作栏"
        role={overlay ? "dialog" : "complementary"}
        aria-modal={overlay || undefined}
        inert={mobileNav}
      >
        <div className="work-rail">
          <div className="work-tabs" role="tablist" aria-label="工作栏工具">
            {tabs.map(([id, Icon, label]) => (
              <button
                key={id}
                className={`work-tab ${auxiliary.open && auxiliary.tab === id ? "active" : ""}`}
                role="tab"
                aria-label={label}
                aria-selected={auxiliary.open && auxiliary.tab === id}
                aria-controls={`work-${id}`}
                data-work-tab={id}
                title={label}
                onClick={() =>
                  auxiliary.open && auxiliary.tab === id
                    ? closeAuxiliary()
                    : openAuxiliary(id)
                }
              >
                <Icon className="icon" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          {auxiliary.open && (
            <div className="work-window-actions">
              <button
                ref={closeButton}
                className="icon-button work-close"
                aria-label="收起工作栏"
                onClick={closeAuxiliary}
              >
                <SidebarSimple />
              </button>
            </div>
          )}
        </div>
        <div hidden={!auxiliary.open} className="work-title">
          <h2>
            {auxiliary.tab === "chat"
              ? "小One问数Agent"
              : auxiliary.tab === "insight"
                ? "六点 Insight"
                : auxiliary.tab === "feedback"
                  ? "协作反馈"
                  : "历史参考"}
          </h2>
          <span className="small-text muted">
            {identity.department || "全局"}
          </span>
        </div>
        <div
          id="work-reference"
          className="work-content"
          role="tabpanel"
          aria-label="历史参考"
          hidden={!auxiliary.open || auxiliary.tab !== "reference"}
        >
          <ReferencePanel />
        </div>
        <div
          id="work-feedback"
          className="work-content"
          role="tabpanel"
          aria-label="协作反馈"
          hidden={!auxiliary.open || auxiliary.tab !== "feedback"}
        >
          <FeedbackPanel />
        </div>
        <div
          id="work-insight"
          className="work-content"
          role="tabpanel"
          aria-label="六点Insight"
          hidden={!auxiliary.open || auxiliary.tab !== "insight"}
        >
          {identity.role === "admin" && (
            <label className="form-field">
              提示词范围
              <select
                value={scope}
                onChange={(event) =>
                  setAuxiliary((value) => ({
                    ...value,
                    scope: event.target.value,
                  }))
                }
              >
                {["global", ...E.DEPARTMENTS].map((value) => (
                  <option key={value} value={value}>
                    {value === "global" ? "全局" : `${value} 部门`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <InsightPanel key={scope} scope={scope} />
        </div>
        <div
          id="work-chat"
          className="work-content is-chat"
          role="tabpanel"
          aria-label="小One问数Agent"
          hidden={!auxiliary.open || auxiliary.tab !== "chat"}
        >
          {config.url ? (
            <EmbeddedAsk
              loaded={
                chatVisited || (auxiliary.open && auxiliary.tab === "chat")
              }
            />
          ) : config.error ? (
            <div className="work-empty">
              <h3>问数接入地址配置有误</h3>
              <p>请联系管理员检查。当前预算工作区仍可使用。</p>
            </div>
          ) : (
            <LocalChat />
          )}
        </div>
      </aside>
    </>
  );
}

function ReferencePanel() {
  const {
    state,
    data,
    identity,
    auxiliary,
    setAuxiliary,
    initiativeId,
    view,
    openRaw,
  } = useWorkbench();
  const selected =
    auxiliary.dealerId ||
    String(
      view.initiatives.find((item) => item.id === initiativeId)?.rows?.[0]
        ?.dealerId ||
        data.dealers[0]?.id ||
        "",
    );
  if (!selected) return <div className="empty">暂无历史数据。</div>;
  const model = A.historyReference(state, identity, data, selected);
  const fullYears = model.periods.filter((period) => period.comparable);
  const ytd = model.periods.find((period) => !period.comparable);
  const resourceTotal = model.resources.reduce(
    (total, resource) =>
      total +
      (Number.isFinite(resource.amount) && resource.amount > 0
        ? resource.amount
        : 0),
    0,
  );
  return (
    <>
      <label className="reference-selector">
        经销商
        <select
          aria-label="历史参考经销商"
          value={selected}
          onChange={(event) =>
            setAuxiliary((value) => ({
              ...value,
              dealerId: event.target.value,
            }))
          }
        >
          {data.dealers.map((dealer) => (
            <option key={dealer.id} value={dealer.id}>
              {dealer.id}
            </option>
          ))}
        </select>
      </label>
      <section className="yield-card" aria-label="2025全年整体Yield">
        <div>
          <span>2025 全年 · 整体 C3 Yield</span>
          <strong>{fmt(model.yield2025)}</strong>
        </div>
        <p>2025 C3 ÷ 2025 总资源</p>
        <small>
          {model.yield2025 == null
            ? "缺少有效 C3 或正数资源，暂无法计算"
            : "同年历史比值 · 只读参考"}
        </small>
      </section>
      <div className="history-chart-pair">
        {["vol", "c3"].map((field) => {
          const maximum = Math.max(
            1,
            ...fullYears.map((period) =>
              Number.isFinite(period[field]) ? Math.abs(period[field]) : 0,
            ),
          );
          const prior = fullYears[0]?.[field],
            latest = fullYears[1]?.[field];
          const delta =
            Number.isFinite(prior) && prior > 0 && Number.isFinite(latest)
              ? ((latest - prior) / prior) * 100
              : null;
          return (
            <section
              className="history-chart"
              key={field}
              aria-label={`${field === "vol" ? "Vol" : "C3"}全年对比`}
            >
              <div className="history-chart-title">
                <h4>{field === "vol" ? "Vol" : "C3"}</h4>
                <span>
                  {delta == null
                    ? "2024 / 2025 全年"
                    : `2025 较上年 ${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`}
                </span>
              </div>
              {fullYears.map((period, index) => (
                <div className="history-bar-row" key={period.label}>
                  <span>{period.label.replace(" 全年", "")}</span>
                  <div className="history-bar-track">
                    <i
                      className={index ? "current" : "prior"}
                      style={{
                        width: `${Number.isFinite(period[field]) ? (Math.abs(period[field]) / maximum) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <b>{fmt(period[field])}</b>
                </div>
              ))}
            </section>
          );
        })}
      </div>
      {ytd && (
        <div className="reference-ytd">
          <span>
            {ytd.label}
            <small>累计 · 不与全年直接同比</small>
          </span>
          <div>
            <b>{fmt(ytd.vol)}</b>
            <small>Vol</small>
          </div>
          <div>
            <b>{fmt(ytd.c3)}</b>
            <small>C3</small>
          </div>
        </div>
      )}
      <section className="resource-chart">
        <div className="history-chart-title">
          <h4>2025 资源构成</h4>
          <span>
            {model.allResources
              ? "全部资源"
              : `${identity.department} 授权范围`}
          </span>
        </div>
        {model.resources.map((resource) => (
          <div className="resource-bar-row" key={resource.label}>
            <div>
              <span>{resource.label.replace("2025 ", "")}</span>
              <b>{fmt(resource.amount)}</b>
            </div>
            <div className="history-bar-track">
              <i
                className="resource"
                style={{
                  width: `${resourceTotal && Number.isFinite(resource.amount) ? (Math.max(0, resource.amount) / resourceTotal) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        ))}
        <p>
          条形占比以{model.allResources ? "全部" : "当前授权"}资源合计为分母。
        </p>
      </section>
      <p className="reference-footnote">
        Vol、C3 各用独立刻度。整体 Yield
        向各角色共享，资源明细按权限展示；历史比值不随 2027 分配变化。
      </p>
      <button
        className="button small"
        onClick={() => openRaw("history", selected)}
      >
        查看历史原始数据
      </button>
    </>
  );
}
function FeedbackPanel() {
  const { state, identity, view, page, initiativeId, navigate } =
    useWorkbench();
  if (["management", "admin"].includes(identity.role)) {
    const audit = state.audit
      .filter((entry) => entry.action === "publish_initiative")
      .slice(-12)
      .reverse();
    return audit.length ? (
      audit.map((entry) => (
        <div className="timeline-item" key={entry.id}>
          <b>同步最新分配 · {entry.object}</b>
          <p>{entry.detail}</p>
          <small>{when(entry.createdAt)}</small>
        </div>
      ))
    ) : (
      <div className="work-empty">
        <h3>暂无协作记录</h3>
        <p>各项同步记录将显示在这里。</p>
      </div>
    );
  }
  const comments = (view.departments[identity.department]?.comments || [])
    .filter(
      (comment) =>
        page !== "editor" ||
        !comment.initiativeId ||
        comment.initiativeId === initiativeId,
    )
    .slice()
    .reverse();
  return comments.length ? (
    comments.map((comment, index) => (
      <div className="timeline-item" key={comment.id || index}>
        <b>
          {comment.author === "management" ? "管理层" : "部门负责人"} ·{" "}
          {when(comment.createdAt)}
        </b>
        <p>{comment.text}</p>
        {comment.initiativeId &&
          view.initiatives.some((item) => item.id === comment.initiativeId) && (
            <button
              className="button link"
              onClick={() => navigate("editor", comment.initiativeId)}
            >
              打开相关 Initiative
            </button>
          )}
      </div>
    ))
  ) : (
    <div className="work-empty">
      <h3>暂无待处理意见</h3>
      <p>当前权限内的历史沟通记录会集中显示在这里。如需调整可线下联系。</p>
    </div>
  );
}
function EmbeddedAsk({ loaded }) {
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!loaded || !loading) return;
    const timer = setTimeout(() => setSlow(true), 15000);
    return () => clearTimeout(timer);
  }, [loaded, loading, revision]);
  return (
    <div className="embedded-ask">
      <div className="embedded-toolbar">
        <span>易问产品问数界面</span>
        <button
          className="button small"
          onClick={() => {
            setLoading(true);
            setSlow(false);
            setRevision((value) => value + 1);
          }}
        >
          <ArrowClockwise size={16} />
          重新加载
        </button>
        <a href={config.url} target="_blank" rel="noopener noreferrer">
          独立打开 <ArrowSquareOut size={15} />
        </a>
      </div>
      <div className="embedded-frame">
        {loaded && (
          <iframe
            key={revision}
            src={config.url}
            title="易问产品问数界面"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={() => {
              setLoading(false);
              setSlow(false);
            }}
            onError={() => {
              setLoading(false);
              setSlow(true);
            }}
          />
        )}{" "}
        {loading && !slow && (
          <div className="embedded-loading" role="status">
            正在加载问数界面…
          </div>
        )}
      </div>
      <p className="embedded-help">
        {slow
          ? "页面响应较慢，可重新加载或独立打开。"
          : "如页面空白或无法登录，可尝试独立打开。"}
      </p>
    </div>
  );
}
function LocalChat() {
  const {
    state,
    identity,
    data,
    view,
    navigate,
    openRaw,
    openAuxiliary,
    notify,
  } = useWorkbench();
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const input = useRef(null);
  const scroll = useRef(null);
  useEffect(() => {
    scroll.current?.scrollTo(0, scroll.current.scrollHeight);
  }, [messages]);
  function answer(question) {
    const totals = E.totals(view.initiatives);
    const scope =
      identity.role === "owner"
        ? "本人负责"
        : identity.role === "lead"
          ? `${identity.department} 本部门`
          : identity.role === "admin"
            ? "预算配置"
            : "最新同步";
    if (/同比|2026|历史|yield/i.test(question))
      return {
        text: "2024、2025 为全年历史；2026 为 1–8 月累计演示口径，没有去年同期数据，不能直接做同比或默认年化。整体 Yield 根据 2025 同年 C3 ÷ 总资源计算，资源明细仅在授权范围展示。",
        callback: { label: "打开历史原始数据", target: "history" },
      };
    if (/占比|分布|sector|部门|initiative/i.test(question)) {
      if (["lead", "management"].includes(identity.role)) {
        const model = A.analytics(state, identity, "sector"),
          top = model.rows[0];
        return {
          text: `${model.basisLabel}：经销商分配合计 ${fmt(model.total)}。${top ? `Sector ${top.label} 占 ${(top.share * 100).toFixed(1)}%，分配 ${fmt(top.amount)}。` : "暂无可汇总分配。"}`,
          callback: {
            label:
              identity.role === "management"
                ? "查看管理层明细"
                : "查看部门总览",
            target:
              identity.role === "management" ? "management" : "department",
          },
        };
      }
      return {
        text: `当前角色可查看${scope}范围原始数据${identity.role === "owner" ? "及部门聚合汇总" : ""}。`,
        callback: { label: "查看权限内原始数据", target: "raw" },
      };
    }
    if (/预算|多少|金额|分配/.test(question))
      return {
        text: `${scope}范围预算为 ${fmt(totals.budget)}${identity.role === "admin" ? "。" : `，经销商分配 ${fmt(totals.allocated)}，其他预算安排 ${fmt(totals.otherBudget)}。`}金额沿用源表原值，源表未注明单位。${identity.role === "management" ? "仅汇总各项最新同步的数据，不含未同步草稿。" : ""}`,
        callback: { label: "查看对应原始数据", target: "raw" },
      };
    if (/拆分|继续|待办|任务/.test(question) && identity.role === "owner") {
      const item =
        view.initiatives.find((value) => value.status === "editing") ||
        view.initiatives[0];
      return item
        ? {
            text: `可以继续查看「${item.name}」，预算 ${fmt(item.budget)}。当前分配不会自动改变。`,
            callback: {
              label: "打开这项 Initiative",
              target: "editor",
              id: item.id,
            },
          }
        : { text: "当前没有分配给你的 Initiative。" };
    }
    if (/insight|分析|建议|集中/i.test(question))
      return {
        text: "可查看低 Yield 与高投入、高 Yield 与投入不足、投入集中度、多项资源叠加、历史趋势匹配和预算完整性六点。分析仅使用当前角色授权范围数据，属于本地固定模板。",
        callback: { label: "打开六点 Insight", target: "insight" },
      };
    return {
      text: "当前是本地场景模拟。可以输入“预算多少”“分配占比”“2026 同比”或“分析建议”，查看权限范围内的演示回答。",
    };
  }
  function send(question = draft) {
    const text = String(question).trim().slice(0, 1000);
    if (!text) {
      notify("先输入一个问题。");
      input.current?.focus();
      return;
    }
    setMessages((value) => [
      ...value,
      { role: "user", text },
      { role: "assistant", ...answer(text) },
    ]);
    setDraft("");
    input.current?.focus();
  }
  function callback(action) {
    if (action.target === "history") openRaw("history");
    else if (action.target === "raw") openRaw("");
    else if (action.target === "insight") openAuxiliary("insight");
    else navigate(action.target, action.id);
  }
  return (
    <div className="chat-shell">
      <header className="chat-top">
        <button
          className="icon-button"
          aria-label="查看对话记录"
          onClick={() => setHistoryOpen(!historyOpen)}
        >
          <List />
        </button>
        <span className="nora-pill">
          <span className="nora-avatar">
            <User />
          </span>
          <b>Nora</b>
        </span>
        <span className="chat-new-label">
          {messages.length ? "当前对话" : "新对话"}
        </span>
        <button
          className="icon-button"
          aria-label="新建对话"
          onClick={() => {
            if (messages.length) setHistory((value) => [messages, ...value]);
            setMessages([]);
            setDraft("");
            input.current?.focus();
          }}
        >
          <PlusCircle />
        </button>
        <button
          className="icon-button"
          aria-label="查看当前问数上下文"
          onClick={() => setContextOpen(!contextOpen)}
        >
          <FileText />
        </button>
      </header>
      {historyOpen && (
        <div className="chat-records">
          <b>本次会话记录</b>
          {history.length ? (
            history.map((record, index) => (
              <button
                className="button link"
                key={index}
                onClick={() => {
                  setMessages(record);
                  setHistory((value) => [
                    ...(messages.length ? [messages] : []),
                    ...value.filter((_, n) => n !== index),
                  ]);
                  setDraft("");
                  setHistoryOpen(false);
                }}
              >
                {record[0].text}
              </button>
            ))
          ) : (
            <p>新建对话后，上一段会保留在这里；切换角色后清空。</p>
          )}
        </div>
      )}
      {contextOpen && (
        <div className="chat-records">
          <b>{identity.label}</b>
          <p>参考批次：{state.reference.batchId}</p>
          <p>{A.rawData(state, identity, data).scopeLabel}</p>
          <p>本地关键词模拟，无模型请求；不会修改分配数据。</p>
        </div>
      )}
      <div className="chat-main" ref={scroll}>
        {messages.length ? (
          <div className="messages">
            {messages.map((message, index) => (
              <div className={`chat-message ${message.role}`} key={index}>
                {message.role === "assistant" && (
                  <b className="chat-speaker">Nora · 模拟回答</b>
                )}
                <p>{message.text}</p>
                {message.callback && (
                  <button
                    className="button small"
                    onClick={() => callback(message.callback)}
                  >
                    {message.callback.label}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="chat-welcome">
              <h2>
                <span>DataAgent</span> 辅助决策平台
              </h2>
              <p>
                围绕当前工作台的预算、分配与历史参考提问。当前为本地场景模拟，尚未连接真实问数服务。
              </p>
            </div>
            <div className="chat-examples">
              {["预算分配了多少", "分配占比", "2026 可以同比吗"].map(
                (question) => (
                  <button
                    className="chat-example"
                    key={question}
                    onClick={() => send(question)}
                  >
                    {question}
                    <ArrowUpRight />
                  </button>
                ),
              )}
            </div>
          </>
        )}
      </div>
      <div className="chat-bottom">
        <div className="chat-composer">
          <textarea
            ref={input}
            rows={2}
            maxLength={1000}
            aria-label="向小One提问"
            placeholder="请输入 …"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                send();
              }
            }}
          />
          <div className="composer-tools">
            <span className="muted small-text">
              Enter 发送 · Shift + Enter 换行
            </span>
            <button
              className="chat-send"
              aria-label="发送问题"
              onClick={() => send()}
            >
              <PaperPlaneTilt />
            </button>
          </div>
        </div>
        <p className="chat-context">
          {identity.label} · 本地场景模拟 · 未连接 AI4BI
        </p>
      </div>
    </div>
  );
}
