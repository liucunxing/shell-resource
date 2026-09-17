import { Suspense, lazy, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  useRestoreFocusTarget,
} from "@fluentui/react-components";
import {
  ArrowSquareOut,
  ArrowsClockwise,
  ChartBar,
  CheckCircle,
  ChatsCircle,
  Database,
  Flag,
  GitBranch,
  House,
  Info,
  List,
  SlidersHorizontal,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { Page } from "./domain/types";
import { createDemoState, createEmptyState } from "./domain/demo";
import { useWorkspace } from "./state/WorkspaceContext";
import { HomePage } from "./pages/HomePage";
import { YiwenPanel } from "./components/YiwenPanel";
const DataPage = lazy(() =>
  import("./pages/DataPage").then((m) => ({ default: m.DataPage })),
);
const AllocationPage = lazy(() =>
  import("./pages/AllocationPage").then((m) => ({ default: m.AllocationPage })),
);
const AdjustPage = lazy(() =>
  import("./pages/AdjustPage").then((m) => ({ default: m.AdjustPage })),
);
const SubmitPage = lazy(() =>
  import("./pages/SubmitPage").then((m) => ({ default: m.SubmitPage })),
);
const TrackingPage = lazy(() =>
  import("./pages/TrackingPage").then((m) => ({ default: m.TrackingPage })),
);
const nav: { page: Page; label: string; icon: typeof House; step?: string }[] =
  [
    { page: "home", label: "流程总览", icon: House },
    { page: "database", label: "数据准备", icon: Database, step: "01" },
    { page: "allocation", label: "初始预算拆分", icon: GitBranch, step: "02" },
    {
      page: "adjust",
      label: "部门调整与洞察",
      icon: SlidersHorizontal,
      step: "03",
    },
    { page: "submit", label: "确认与提交", icon: Flag, step: "04" },
    { page: "tracking", label: "季度 Tracking", icon: ChartBar, step: "05" },
  ];
export default function App() {
  const { state, page, navigate, run, toast, dismissToast, persistenceError } =
    useWorkspace();
  const restoreYiwenFocus = useRestoreFocusTarget();
  const yiwenTrigger = useRef<HTMLButtonElement>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [yiwenOpen, setYiwenOpen] = useState(false);
  const closeYiwen = () => {
    setYiwenOpen(false);
    requestAnimationFrame(() => yiwenTrigger.current?.focus());
  };
  const [reset, setReset] = useState<"demo" | "empty" | null>(null);
  const title = nav.find((n) => n.page === page)?.label;
  const goto = (p: Page) => {
    navigate(p);
    setYiwenOpen(false);
    setMobileNav(false);
  };
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        跳到主要内容
      </a>
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="关闭导航"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        className={`sidebar ${mobileNav ? "is-open" : ""}`}
        aria-label="主导航"
      >
        <div className="brand">
          <span className="brand-symbol">
            R<span />
          </span>
          <div>
            <b>资源投资工作台</b>
            <small>Distributor Planning</small>
          </div>
          <Button
            appearance="subtle"
            className="mobile-close"
            icon={<X />}
            aria-label="关闭导航"
            onClick={() => setMobileNav(false)}
          />
        </div>
        <div className="workspace-label">
          <span>年度规划工作区</span>
          <b>2027</b>
        </div>
        <nav>
          {nav.map((item, i) => (
            <div key={item.page}>
              {i === 1 && <div className="nav-group-label">规划与执行</div>}
              <a
                href={`#${item.page}`}
                aria-current={item.page === page ? "page" : undefined}
                className={`nav-item ${item.page === page ? "active" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  goto(item.page);
                }}
              >
                <item.icon
                  size={20}
                  weight={item.page === page ? "fill" : "regular"}
                />
                <span>{item.label}</span>
                {item.step && <small>{item.step}</small>}
              </a>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-workspace">
            <span className="local-indicator" />
            <div>
              <b>独立前端演示</b>
              <p>数据保存在当前浏览器</p>
            </div>
          </div>
          <button className="sidebar-tool" onClick={() => setReset("demo")}>
            <ArrowsClockwise size={17} />
            恢复示例数据
          </button>
          <button className="sidebar-tool" onClick={() => setReset("empty")}>
            <Trash size={17} />
            清空工作区
          </button>
          <a
            className="source-link"
            href="/prototypes/Distributor资源投资规划与追踪工具_V1.1.html"
            target="_blank"
            rel="noreferrer"
          >
            客户原始 Demo <ArrowSquareOut size={14} />
          </a>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumb">
            <Button
              className="mobile-menu"
              appearance="subtle"
              icon={<List size={22} />}
              aria-label="打开导航"
              onClick={() => {
                setYiwenOpen(false);
                setMobileNav(true);
              }}
            />
            <span>资源投资规划</span>
            <span className="breadcrumb-separator">/</span>
            <b>{title}</b>
          </div>
          <div className="topbar-right">
            <span className="save-indicator">
              <CheckCircle size={15} />
              {persistenceError ? "仅本次会话" : "本机工作区"}
            </span>
            <span className="planning-year">2027 规划</span>
            <Button
              className="yiwen-trigger"
              ref={yiwenTrigger}
              {...restoreYiwenFocus}
              appearance="secondary"
              icon={<ChatsCircle size={19} />}
              aria-label="小One问数Agent"
              aria-expanded={yiwenOpen}
              aria-controls="yiwen-panel"
              onClick={() => {
                setMobileNav(false);
                setYiwenOpen((open) => !open);
              }}
            >
              <span className="yiwen-trigger-label">小One问数Agent</span>
              <span className="yiwen-trigger-mobile">小One</span>
            </Button>
            <span className="user-avatar" title="本机演示用户">
              规
            </span>
          </div>
        </header>
        <div
          className={`demo-banner ${state.dataMode === "demo" ? "" : "user-data"}`}
        >
          <Info size={16} />
          <span>
            {state.dataMode === "demo"
              ? "当前为合成示例数据，仅用于体验流程，不代表客户真实预算。"
              : "本机工作区含手工或导入数据，请核对来源；未连接后台与企业账号。"}
          </span>
          <button onClick={() => setReset("empty")}>
            {state.dataMode === "demo" ? "从空白开始" : "清空工作区"}
          </button>
        </div>
        {persistenceError && (
          <div className="notice notice-danger" role="alert">
            {persistenceError}
          </div>
        )}
        <main id="main-content" className="main-content" tabIndex={-1}>
          <Suspense
            fallback={
              <div className="page-loading">
                <Spinner label="正在加载工作区…" />
              </div>
            }
          >
            {page === "home" ? (
              <HomePage />
            ) : page === "database" ? (
              <DataPage />
            ) : page === "allocation" ? (
              <AllocationPage />
            ) : page === "adjust" ? (
              <AdjustPage />
            ) : page === "submit" ? (
              <SubmitPage />
            ) : (
              <TrackingPage />
            )}
          </Suspense>
          <footer className="page-footer">
            <span>Distributor 资源投资规划与追踪工具</span>
            <span>预算单位：人民币元 · 前端演示</span>
          </footer>
        </main>
      </div>
      <YiwenPanel open={yiwenOpen} onClose={closeYiwen} />
      {toast && (
        <div
          className={`app-toast ${toast.kind}`}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          {toast.kind === "error" ? (
            <WarningCircle size={22} />
          ) : (
            <CheckCircle size={22} />
          )}
          <span>{toast.message}</span>
          <button onClick={dismissToast} aria-label="关闭提示">
            <X size={18} />
          </button>
        </div>
      )}
      <Dialog
        open={!!reset}
        onOpenChange={(_, d) => {
          if (!d.open) setReset(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {reset === "demo" ? "恢复示例数据" : "清空当前工作区"}
            </DialogTitle>
            <DialogContent>
              <p>
                这会替换当前浏览器中的预算、分配、版本和操作记录。需要保留的数据请先在对应页面导出。
              </p>
              <p>
                {reset === "demo"
                  ? "恢复后将载入一组合成预算，便于体验完整流程。"
                  : "清空后可导入自己的 Excel 模板，或在线新增预算。"}
              </p>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setReset(null)}>取消</Button>
              <Button
                appearance="primary"
                onClick={() => {
                  run(
                    () =>
                      reset === "demo" ? createDemoState() : createEmptyState(),
                    reset === "demo"
                      ? "已恢复合成示例数据"
                      : "已清空本机工作区",
                  );
                  setReset(null);
                  navigate("home");
                }}
              >
                确认{reset === "demo" ? "恢复" : "清空"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
