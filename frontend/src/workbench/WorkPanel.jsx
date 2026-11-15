import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useEffect, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowSquareOut,
  ArrowUpRight,
  BookOpen,
  ChatCircleDots,
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
import { buildYiwenUrl } from "../config/yiwen";
import { WorkPanelResizer } from "./WorkPanelResizer";
import { DataAgentFrame } from "./DataAgentFrame";
const fmt = (value) =>
  Number.isFinite(value)
    ? (Math.abs(value) < 0.005 ? 0 : value).toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "—";
const tabs = [
  ["reference", BookOpen, "参考"],
  ["insight", Sparkle, "Insight"],
  ["chat", ChatCircleDots, "问数"],
];

export function WorkPanel({ overlay, panelSize }) {
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
    apiMode,
    portalMode,
    previewMode,
  } = useWorkbench();
  const config = apiMode
    ? { url: "", error: "" }
    : buildYiwenUrl(import.meta.env.VITE_YIWEN_IFRAME_URL, identity.email);
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
      if (
        document.querySelector(
          '[data-slot="dialog-content"][data-state="open"]',
        )
      )
        return;
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
      : E.departments(identity)[0] || "global";
  const scope = auxiliary.scope || defaultScope;
  return (
    <>
      {auxiliary.open && overlay && (
        <Button
          variant="outline"
          className="work-scrim h-auto rounded-none border-0 bg-black/30 p-0"
          aria-label="收起工作栏"
          onClick={closeAuxiliary}
        />
      )}
      <aside
        id="work-panel"
        ref={panel}
        className="workbench"
        aria-label="辅助工作栏"
        role={overlay ? "dialog" : "complementary"}
        aria-modal={overlay || undefined}
        inert={mobileNav}
      >
        {auxiliary.open && panelSize && !panelSize.phone && (
          <WorkPanelResizer {...panelSize} />
        )}
        <Tabs
          value={auxiliary.open ? auxiliary.tab : ""}
          onValueChange={(tab) => openAuxiliary(tab)}
          className="contents"
        >
          <div className="work-rail">
            <TabsList className="work-tabs" aria-label="工作栏工具">
              {tabs.map(([id, Icon, label]) => (
                <TabsTrigger
                  value={id}
                  key={id}
                  className={`work-tab ${auxiliary.open && auxiliary.tab === id ? "active" : ""}`}
                  aria-label={label}
                  aria-controls={`work-${id}`}
                  data-work-tab={id}
                  title={label}
                >
                  <Icon className="icon" />
                  <span>{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            {auxiliary.open && (
              <div className="work-window-actions">
                <Button
                  variant="ghost"
                  ref={closeButton}
                  className="icon-button work-close"
                  aria-label="收起工作栏"
                  onClick={closeAuxiliary}
                >
                  <SidebarSimple />
                </Button>
              </div>
            )}
          </div>
          <div hidden={!auxiliary.open} className="work-title">
            <h2>
              {auxiliary.tab === "chat"
                ? "小One问数Agent"
                : auxiliary.tab === "insight"
                  ? "Insight 分析"
                  : "历史参考"}
            </h2>
            <span className="small-text muted">
              {E.departments(identity).join("、") || "全局"}
            </span>
          </div>
          <TabsContent
            forceMount
            value="reference"
            id="work-reference"
            className="work-content"
            aria-label="历史参考"
            hidden={!auxiliary.open || auxiliary.tab !== "reference"}
          >
            <ReferencePanel />
          </TabsContent>
          <TabsContent
            forceMount
            value="insight"
            id="work-insight"
            className="work-content"
            aria-label="Insight 分析"
            hidden={!auxiliary.open || auxiliary.tab !== "insight"}
          >
            {identity.role === "admin" && !apiMode && (
              <Label className="form-field">
                分析范围
                <NativeSelect
                  value={scope}
                  onChange={(event) =>
                    setAuxiliary((value) => ({
                      ...value,
                      scope: event.target.value,
                    }))
                  }
                >
                  {["global", ...E.DEPARTMENTS].map((value) => (
                    <NativeSelectOption key={value} value={value}>
                      {value === "global" ? "全局" : `${value} 部门`}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Label>
            )}
            <InsightPanel key={scope} scope={scope} />
          </TabsContent>
          <TabsContent
            forceMount
            value="chat"
            id="work-chat"
            className="work-content is-chat"
            aria-label="小One问数Agent"
            hidden={!auxiliary.open || auxiliary.tab !== "chat"}
          >
            {previewMode ? (
              <div className="work-empty">
                <h3>模拟查看期间暂停问数</h3>
                <p>请返回管理员后打开 Data Agent。</p>
              </div>
            ) : apiMode ? (
              <DataAgentFrame
                key={identity.email}
                portalMode={portalMode}
                visible={auxiliary.open && auxiliary.tab === "chat"}
              />
            ) : config.url ? (
              <EmbeddedAsk
                key={config.url}
                url={config.url}
                loaded={
                  chatVisited || (auxiliary.open && auxiliary.tab === "chat")
                }
              />
            ) : config.error ? (
              <div className="work-empty">
                <h3>问数接入地址配置有误</h3>
                <p>{config.error} 当前预算工作区仍可使用。</p>
              </div>
            ) : (
              <LocalChat />
            )}
          </TabsContent>
        </Tabs>
      </aside>
    </>
  );
}

export function ResourceCompositionRows({ resources, prefix, allResources }) {
  const complete = resources.length > 0 && resources.every((row) => Number.isFinite(row.amount));
  const negative = resources.some((row) => Number.isFinite(row.amount) && row.amount < 0);
  const total = complete ? resources.reduce((sum, row) => sum + row.amount, 0) : null;
  const comparable = complete && !negative && total > 0;
  return <>
    {resources.map((resource) => <div className="resource-bar-row" key={resource.label}>
      <div><span>{resource.label.replace(prefix, "")}</span><b>{fmt(resource.amount)} K$</b></div>
      {comparable && <div className="history-bar-track"><i className="resource" style={{ width: `${resource.amount / total * 100}%` }} /></div>}
    </div>)}
    <p>{negative ? "含负费用，暂不显示构成占比；金额保留原值。" : !complete ? "费用数据不完整，暂不显示构成占比。" : total <= 0 ? "费用合计不大于 0，暂不显示构成占比。" : `条形占比以${allResources ? "全部" : "当前授权"}资源合计为分母。`}</p>
  </>;
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
  const selectedId =
    auxiliary.dealerId ||
    String(
      view.initiatives.find((item) => item.id === initiativeId)?.rows?.[0]
        ?.dealerId ||
        data.dealers[0]?.id ||
        "",
    );
  const initiative = view.initiatives.find((item) => item.id === initiativeId);
  const preferredSector = auxiliary.dealerSector ?? initiative?.sector;
  const candidates = data.dealers.filter(
    (dealer) => String(dealer.id) === String(selectedId),
  );
  const selected =
    candidates.find((dealer) => dealer.sector === preferredSector) ||
    candidates[0];
  if (!selected) return <div className="empty">暂无历史数据。</div>;
  const model = A.historyReference(
    state,
    identity,
    data,
    selected.id,
    selected.sector || "—",
  );
  const fullYears = model.periods.filter((period) => period.comparable);
  const ytd = model.periods.find((period) => !period.comparable);
  return (
    <>
      <Label className="reference-selector">
        经销商
        <NativeSelect
          aria-label="历史参考经销商"
          value={JSON.stringify([String(selected.id), selected.sector || ""])}
          onChange={(event) =>
            setAuxiliary((value) => ({
              ...value,
              dealerId: JSON.parse(event.target.value)[0],
              dealerSector: JSON.parse(event.target.value)[1],
            }))
          }
        >
          {data.dealers.map((dealer) => (
            <NativeSelectOption
              key={JSON.stringify([dealer.id, dealer.sector || ""])}
              value={JSON.stringify([String(dealer.id), dealer.sector || ""])}
            >
              {dealer.id} · {dealer.name || "—"} · {dealer.sector || "—"}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Label>
      <div className="reference-dealer-meta">
        <span>{selected.sector || "—"}</span>
        <span>{selected.sd || "SD —"}</span>
        <span>{selected.rsm || "RSM —"}</span>
        <span className={`resource-status ${selected.status || ""}`}>
          {selected.status || "状态 —"}
        </span>
      </div>
      <Card className="yield-card" aria-label="2025全年整体Yield">
        <div>
          <span>2025 全年 · Yield</span>
          <strong>{fmt(model.yield)}</strong>
        </div>
        <p>2025 C3（美元）÷ 历史投资（美元）</p>
        <small>
          {model.yield == null
            ? "Yield 暂不可计算"
            : "历史投资已按配置汇率统一为美元 · 仅作表现参考"}
        </small>
      </Card>
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
          const delta = Number.isFinite(prior) && prior > 0 && Number.isFinite(latest)
            ? ((latest - prior) / prior) * 100
            : null;
          return (
            <section
              className="history-chart"
              key={field}
              aria-label={`${field === "vol" ? "Vol" : "C3"}全年对比`}
            >
              <div className="history-chart-title">
                <h4>{field === "vol" ? "Vol (KL)" : "C3 (K$)"}</h4>
                <span>
                  {delta == null
                    ? Number.isFinite(prior) && prior <= 0 ? "无基期" : "2025 同比数据未提供"
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
            <small>Vol (KL)</small>
          </div>
          <div>
            <b>{fmt(ytd.c3)}</b>
            <small>C3 (K$)</small>
          </div>
        </div>
      )}
      <section className="resource-chart">
        <div className="history-chart-title">
          <h4>2025 资源构成</h4>
          <span>
            {model.allResources
              ? "全部资源"
              : `${E.departments(identity).join("、")} 授权范围`}
          </span>
        </div>
        <ResourceCompositionRows resources={model.resources} prefix="2025 " allResources={model.allResources} />
      </section>
      {!!model.resources2026Ytd?.length && (
        <section className="resource-chart">
          <div className="history-chart-title">
            <h4>2026 YTD 资源构成</h4>
            <span>
              {model.allResources
                ? "全部资源"
                : `${E.departments(identity).join("、")} 授权范围`}
            </span>
          </div>
          <ResourceCompositionRows resources={model.resources2026Ytd} prefix="2026 YTD " allResources={model.allResources} />
        </section>
      )}
      <p className="reference-footnote">
        Vol 的单位为 KL，C3 为 K$，资源为K$。Yield
        向各角色共享，资源明细按权限展示；历史比值不随 2027 分配变化。
      </p>
      <Button
        variant="outline"
        className="button small"
        onClick={() => openRaw("history", String(selected.id))}
      >
        查看历史原始数据
      </Button>
    </>
  );
}
export function EmbeddedAsk({ loaded, url }) {
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
        <span>Data Agent 问数界面</span>
        <Button
          variant="outline"
          className="button small"
          onClick={() => {
            setLoading(true);
            setSlow(false);
            setRevision((value) => value + 1);
          }}
        >
          <ArrowClockwise size={16} />
          重新加载
        </Button>
        <a href={url} target="_blank" rel="noopener noreferrer">
          独立打开 <ArrowSquareOut size={15} />
        </a>
      </div>
      <div className="embedded-frame">
        {loaded && (
          <iframe
            key={revision}
            src={url}
            title="Data Agent 问数界面"
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
          ? `${E.departments(identity).join("、")} 本部门`
          : identity.role === "admin"
            ? "预算配置"
            : "最新同步";
    if (/同比|2026|历史|yield/i.test(question))
      return {
        text: "2024、2025 为全年历史；2026 为 1–8 月累计演示口径，没有去年同期数据，不能直接做同比或默认年化。Yield 为 2025 C3（美元）÷ 历史投资（美元），历史投资已按配置汇率统一为美元，仅作表现参考，资源明细仅在授权范围展示。",
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
        callback: { label: "打开Insight 分析", target: "insight" },
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
        <Button
          variant="ghost"
          className="icon-button"
          aria-label="查看对话记录"
          onClick={() => setHistoryOpen(!historyOpen)}
        >
          <List />
        </Button>
        <span className="nora-pill">
          <span className="nora-avatar">
            <User />
          </span>
          <b>Nora</b>
        </span>
        <span className="chat-new-label">
          {messages.length ? "当前对话" : "新对话"}
        </span>
        <Button
          variant="ghost"
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
        </Button>
        <Button
          variant="ghost"
          className="icon-button"
          aria-label="查看当前问数上下文"
          onClick={() => setContextOpen(!contextOpen)}
        >
          <FileText />
        </Button>
      </header>
      {historyOpen && (
        <div className="chat-records">
          <b>本次会话记录</b>
          {history.length ? (
            history.map((record, index) => (
              <Button
                variant="link"
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
              </Button>
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
                  <Button
                    variant="outline"
                    className="button small"
                    onClick={() => callback(message.callback)}
                  >
                    {message.callback.label}
                  </Button>
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
                  <Button
                    variant="outline"
                    className="chat-example"
                    key={question}
                    onClick={() => send(question)}
                  >
                    {question}
                    <ArrowUpRight />
                  </Button>
                ),
              )}
            </div>
          </>
        )}
      </div>
      <div className="chat-bottom">
        <div className="chat-composer">
          <Textarea
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
            <Button
              variant="outline"
              className="chat-send"
              aria-label="发送问题"
              onClick={() => send()}
            >
              <PaperPlaneTilt />
            </Button>
          </div>
        </div>
        <p className="chat-context">
          {identity.label} · 本地场景模拟 · 未连接 AI4BI
        </p>
      </div>
    </div>
  );
}
