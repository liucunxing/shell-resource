import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Buildings,
  ChartPieSlice,
  ChatCircleDots,
  Clock,
  Database,
  Info,
  List,
  SlidersHorizontal,
  SquaresFour,
  Stack,
  X,
} from "@phosphor-icons/react";
import { useWorkbench } from "./WorkbenchContext.jsx";
import { WorkPanel } from "./WorkPanel.jsx";
const HomePage = lazy(() =>
  import("./pages/OverviewPages.jsx").then((m) => ({ default: m.HomePage })),
);
const DepartmentPage = lazy(() =>
  import("./pages/OverviewPages.jsx").then((m) => ({
    default: m.DepartmentPage,
  })),
);
const ManagementPage = lazy(() =>
  import("./pages/OverviewPages.jsx").then((m) => ({
    default: m.ManagementPage,
  })),
);
const EditorPage = lazy(() =>
  import("./pages/EditorPage.jsx").then((m) => ({ default: m.EditorPage })),
);
const AdminPage = lazy(() =>
  import("./pages/AdminPage.jsx").then((m) => ({ default: m.AdminPage })),
);
const RawPage = lazy(() =>
  import("./pages/RawPages.jsx").then((m) => ({ default: m.RawPage })),
);
const AboutPage = lazy(() =>
  import("./pages/RawPages.jsx").then((m) => ({ default: m.AboutPage })),
);
const TrackingPage = lazy(() =>
  import("./pages/RawPages.jsx").then((m) => ({ default: m.TrackingPage })),
);
const pages = {
  home: HomePage,
  department: DepartmentPage,
  management: ManagementPage,
  editor: EditorPage,
  admin: AdminPage,
  raw: RawPage,
  about: AboutPage,
  tracking: TrackingPage,
};

export function useNarrow(query) {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches,
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
export default function WorkbenchApp() {
  const {
    state,
    identity,
    roles,
    setIdentity,
    page,
    navigate,
    annotation,
    setAnnotation,
    auxiliary,
    setAuxiliary,
    mobileNav,
    setMobileNav,
    openAuxiliary,
    storageWarning,
    toast,
    dismissToast,
    resetScenario,
    scenarioEpoch,
  } = useWorkbench();
  const [scene, setScene] = useState("");
  const sceneDialog = useRef(null);
  const navRef = useRef(null);
  const navTrigger = useRef(null);
  const narrow = useNarrow("(max-width: 1023px)");
  const phone = useNarrow("(max-width: 759px)");
  const workOverlay = auxiliary.open && narrow;
  const nav = [];
  if (identity.role === "owner") nav.push(["home", SquaresFour, "我的工作台"]);
  if (["owner", "lead"].includes(identity.role))
    nav.push(["department", Buildings, "部门总览"]);
  if (identity.role === "management")
    nav.push(["management", Stack, "管理层统览"]);
  if (identity.role === "admin")
    nav.push(["admin", SlidersHorizontal, "管理后台"]);
  nav.push(
    ["raw", Database, "原始数据"],
    ["tracking", Clock, "执行追踪", "预留"],
    ["about", Info, "数据口径"],
  );
  const Page = pages[page] || HomePage;
  const closeNav = () => {
    setMobileNav(false);
    requestAnimationFrame(() => navTrigger.current?.focus());
  };
  useEffect(() => {
    if (scene) sceneDialog.current?.showModal();
    else sceneDialog.current?.close();
  }, [scene]);
  useEffect(() => {
    if (!phone && mobileNav) setMobileNav(false);
  }, [phone, mobileNav, setMobileNav]);
  useEffect(() => {
    if (!mobileNav) return;
    navRef.current?.querySelector("button")?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeNav();
      }
      if (event.key === "Tab") {
        const items = [
          ...navRef.current.querySelectorAll("button,select,a[href]"),
        ].filter((item) => item.getClientRects().length && !item.disabled);
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
  }, [mobileNav]);
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        跳至工作区
      </a>
      <div
        className={`app-shell ${auxiliary.open ? "work-open" : ""}`}
      >
        {mobileNav && (
          <button
            className="mobile-nav-scrim"
            aria-label="关闭导航"
            onClick={closeNav}
          />
        )}
        <aside
          ref={navRef}
          className={`sidebar ${mobileNav ? "mobile-open" : ""}`}
          aria-label="主导航"
          inert={workOverlay}
        >
          <div className="brand">
            <div className="brandmark">
              <ChartPieSlice size={24} />
            </div>
            <div>
              <strong>
                资源<span>投资</span>
              </strong>
              <small>PLANNING WORKSPACE</small>
            </div>
            <button
              className="icon-button nav-mobile-close"
              aria-label="收起导航"
              onClick={closeNav}
            >
              <X size={18} />
            </button>
          </div>
          <div className="nav-group-title">年度规划</div>
          <nav className="nav">
            {nav.map(([id, Icon, label, tag]) => (
              <button
                key={id}
                className={page === id ? "active" : ""}
                aria-current={page === id ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                <span className="nav-icon">
                  <Icon className="icon" />
                </span>
                <span>{label}</span>
                {tag && <span className="tag-mini">{tag}</span>}
              </button>
            ))}
          </nav>
          <div className="nav-group-title">分析助手</div>
          <nav className="nav">
            <button onClick={() => openAuxiliary("chat")}>
              <span className="nav-icon">
                <ChatCircleDots className="icon" />
              </span>
              小One问数Agent
            </button>
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-context">
              <strong>
                <span className="reference-dot" />
                2027 年度资源规划
              </strong>
              <p>
                历史参考截至 2026.08
                <br />
                2026 累计口径为演示假设
              </p>
            </div>
            <section className="sidebar-profile" aria-label="当前用户">
              <div className="profile-heading">
                <span className="avatar">
                  {identity.role === "owner"
                    ? "MK"
                    : identity.role === "lead"
                      ? "DL"
                      : identity.role === "admin"
                        ? "AD"
                        : "MG"}
                </span>
                <div>
                  <label htmlFor="role-select">当前用户</label>
                  <small>演示角色 · 可切换</small>
                </div>
              </div>
              <select
                id="role-select"
                aria-label="切换演示角色"
                value={identity.key}
                onChange={(event) => setIdentity(event.target.value)}
              >
                {roles.map((role) => (
                  <option key={role.key} value={role.key}>
                    {role.label}
                  </option>
                ))}
              </select>
            </section>
          </div>
        </aside>
        <div className="workspace" inert={workOverlay || mobileNav}>
          <header className="topbar">
            <div className="topbar-left">
              <button
                ref={navTrigger}
                className="button subtle small mobile-menu"
                aria-label="展开导航"
                onClick={() => {
                  setAuxiliary((value) => ({ ...value, open: false }));
                  setMobileNav(true);
                }}
              >
                <List size={20} />
              </button>
              <span className="breadcrumb">
                资源规划 <span className="muted">/</span>{" "}
                <strong>
                  {nav.find((item) => item[0] === page)?.[2] ||
                    "Initiative 拆分"}
                </strong>
              </span>
            </div>
            <div className="topbar-right">
              <span className="demo-mark">
                {state.demoScenario?.id === "unallocated"
                  ? "Mock · 含未分配预算"
                  : "交互演示 · V1.3"}
              </span>
              <button
                className={`button small subtle ${annotation ? "active-toggle" : ""}`}
                aria-pressed={annotation}
                onClick={() => setAnnotation(!annotation)}
              >
                需求标注
              </button>
              <select
                id="scene-select"
                aria-label="演示场景"
                value=""
                onChange={(event) => setScene(event.target.value)}
              >
                <option value="">切换演示场景</option>
                <option value="unallocated">含未分配预算示例（Mock）</option>
                <option value="working">Owner 拆分起点</option>
                <option value="submitted">管理层查看起点</option>
              </select>
            </div>
          </header>
          <main id="main" className="page" tabIndex={-1}>
            {storageWarning && (
              <div className="note-box warn" role="alert">
                {storageWarning}
              </div>
            )}
            <Suspense
              fallback={
                <div className="empty" role="status">
                  正在加载工作区…
                </div>
              }
            >
              <Page key={`${identity.key}:${page}:${scenarioEpoch}`} />
            </Suspense>
            <div className="footer-note">
              本地演示 · 自动保存 · 金额按源表原值展示
            </div>
          </main>
        </div>
        <WorkPanel key={`${identity.key}:${scenarioEpoch}`} overlay={workOverlay} />
      </div>
      <dialog
        ref={sceneDialog}
        className="modal scene-dialog"
        aria-labelledby="scene-title"
        onCancel={() => setScene("")}
        onClose={() => setScene("")}
      >
        <div className="modal-head">
          <h2 id="scene-title">切换演示场景</h2>
        </div>
        <div className="modal-body">
          <p>
            这会替换当前浏览器的预算配置、分配工作稿、同步历史和分析记录。请先导出需要保留的内容。
          </p>
          <p className="muted">旧版工作台的本机记录不会被删除。</p>
        </div>
        <div className="modal-footer">
          <button className="button" onClick={() => setScene("")}>
            取消
          </button>
          <button
            className="button primary"
            onClick={() => {
              resetScenario(scene);
              setScene("");
            }}
          >
            确认切换
          </button>
        </div>
      </dialog>
      {toast && (
        <div
          id="toast"
          className={`visible ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          <span>{toast.message}</span>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={dismissToast}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );
}
