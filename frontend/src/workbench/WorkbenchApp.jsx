import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Buildings,
  ChartDonut,
  ChartLineUp,
  ClipboardText,
  EnvelopeSimple,
  GearSix,
  List,
  LockKey,
  PencilLine,
  ShieldCheck,
  SlidersHorizontal,
  SquaresFour,
  Stack,
  UserList,
  X,
} from "@phosphor-icons/react";
import { useWorkbench } from "./WorkbenchContext.jsx";
import { ToastNotice } from "./ToastNotice.jsx";
import { PortalAccessNotice } from "../portal/PortalEntry";
import { UserPreviewBanner } from "./UserPreviewBanner";
const loginEmailEditable = import.meta.env.VITE_LOGIN_EMAIL_EDITABLE === "true";
const HomePage = lazy(() =>
  import("./pages/OverviewPages.jsx").then((m) => ({ default: m.HomePage })),
);
const SubmissionPage = lazy(() =>
  import("./pages/OverviewPages.jsx").then((m) => ({
    default: m.SubmissionPage,
  })),
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
  import("./pages/AdminStudioPage.jsx").then((m) => ({
    default: m.AdminStudioPage,
  })),
);
const pages = {
  home: HomePage,
  portfolio: DepartmentPage,
  department: DepartmentPage,
  management: ManagementPage,
  editor: EditorPage,
  submissions: SubmissionPage,
  "admin-versions": AdminPage,
  "admin-initiatives": AdminPage,
  "admin-users": AdminPage,
  "admin-enums": AdminPage,
  "admin-thresholds": AdminPage,
  "admin-audit": AdminPage,
};

const roleLabel = {
  owner: "Initiative Owner",
  lead: "部门负责人",
  management: "最高管理层",
  admin: "系统管理员",
};

function navigationFor(identity, initiativeId) {
  if (identity.role === "owner")
    return [
      ["home", SquaresFour, "我的 Initiative", "负责项目与拆分进度"],
      ["portfolio", ChartDonut, "我的投入组合", "本人全部 Initiative 叠加分析"],
      [
        "editor",
        PencilLine,
        "拆分工作台",
        initiativeId ? "继续当前 Initiative" : "请先选择 Initiative",
        !initiativeId,
      ],
      ["submissions", ClipboardText, "草稿与提交", "批量校验与提交"],
    ];
  if (identity.role === "lead")
    return [["department", Buildings, "部门投入组合", "本部门已提交方案"]];
  if (identity.role === "management")
    return [["management", Stack, "全局投资看板", "全部已提交方案"]];
  return [
    ["admin-versions", GearSix, "版本与发布", ""],
    ["admin-initiatives", ClipboardText, "本版项目配置", ""],
    ["admin-users", UserList, "用户与权限", ""],
    ["admin-enums", SlidersHorizontal, "组织与枚举", ""],
    ["admin-thresholds", ShieldCheck, "健康检查阈值", ""],
    ["admin-audit", List, "操作审计", ""],
  ];
}

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
export function SkipToWorkspace({ portalMode = false }) {
  return (
    <a
      className="skip-link"
      href={portalMode ? window.location.hash : "#main"}
      onClick={(event) => {
        event.preventDefault();
        const main = document.getElementById("main");
        main?.focus();
        if (portalMode) main?.scrollIntoView({ block: "start" });
      }}
    >
      跳至工作区
    </a>
  );
}
export default function WorkbenchApp() {
  const {
    state,
    identity,
    page,
    navigate,
    initiativeId,
    mobileNav,
    setMobileNav,
    storageWarning,
    toast,
    dismissToast,
    scenarioEpoch,
    apiMode,
    portalMode,
    loading,
    refresh,
    devEmail,
    setDevelopmentEmail,
    previewMode,
    previewActor,
    switchingPreview,
    stopUserPreview,
  } = useWorkbench();
  const [navCollapsed, setNavCollapsed] = useState(false);
  const navRef = useRef(null);
  const navTrigger = useRef(null);
  const phone = useNarrow("(width < 760px)");
  const closeNav = () => {
    setMobileNav(false);
    requestAnimationFrame(() => navTrigger.current?.focus());
  };
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
  if (!identity && (previewMode || switchingPreview))
    return (
      <main className="page">
        <UserPreviewBanner
          identity={null}
          actor={previewActor}
          busy={switchingPreview}
          onExit={stopUserPreview}
        />
        <div className="empty" role={storageWarning ? "alert" : "status"}>
          {storageWarning || "正在切换用户视角…"}
        </div>
      </main>
    );
  if (!identity && portalMode)
    return <PortalAccessNotice loading={loading} message={storageWarning} />;
  if (!identity && apiMode)
    return (
      <PortalLogin
        email={devEmail}
        loading={loading}
        onSubmit={setDevelopmentEmail}
        error={storageWarning}
      />
    );
  if (!identity)
    return (
      <main className="page">
        <div className="empty" role="status">
          正在加载工作台数据…
        </div>
      </main>
    );
  const nav = navigationFor(identity, initiativeId);
  const Page = pages[page] || pages[nav[0]?.[0]] || HomePage;
  const userName =
    identity.label ||
    identity.name ||
    identity.email ||
    roleLabel[identity.role];
  const userScope =
    identity.role === "admin"
      ? "系统配置"
      : identity.role === "management"
        ? "全部 Sector / Department"
        : Array.isArray(identity.department)
          ? identity.department.join("、")
          : identity.department || identity.sector || "当前授权范围";
  return (
    <>
      <SkipToWorkspace portalMode={portalMode} />
      <div
        className={`app-shell studio-shell ${navCollapsed ? "nav-collapsed" : ""}`}
      >
        {mobileNav && (
          <button
            className="mobile-nav-scrim"
            aria-label="关闭导航"
            onClick={closeNav}
          />
        )}
        <aside
          id="main-navigation"
          hidden={navCollapsed && !phone}
          ref={navRef}
          className={`sidebar ${mobileNav ? "mobile-open" : ""}`}
          aria-label="主导航"
        >
          <div className="brand">
            <div className="brandmark">
              <ChartDonut size={24} />
            </div>
            <div>
              <strong>
                Resource <span>Studio</span>
              </strong>
              <small>经销商资源投资规划 · 2027 OP</small>
            </div>
            <button
              className="icon-button nav-mobile-close"
              aria-label="收起导航"
              onClick={closeNav}
            >
              <X size={18} />
            </button>
          </div>
          <div className="nav-group-title">{roleLabel[identity.role]}</div>
          <nav className="nav">
            {nav.map(([id, Icon, label, description, disabled]) => (
              <button
                key={id}
                className={page === id ? "active" : ""}
                aria-current={page === id ? "page" : undefined}
                disabled={disabled}
                onClick={() => navigate(id)}
              >
                <span className="nav-icon">
                  <Icon className="icon" />
                </span>
                <span className="studio-nav-copy">
                  <b>{label}</b>
                  {description && <small>{description}</small>}
                </span>
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <section className="sidebar-profile" aria-label="当前用户">
              <div className="profile-heading">
                <span className="avatar">
                  {String(userName).slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{userName}</strong>
                  <small>
                    {roleLabel[identity.role]} · {userScope}
                  </small>
                </div>
              </div>
              {apiMode && (
                <div className="profile-api-user">
                  <button
                    className="button subtle small"
                    title={
                      portalMode
                        ? "退出后须从 Portal 重新进入"
                        : loginEmailEditable
                          ? "退出后可使用工作邮箱重新登录"
                          : "退出后须从帆软 Portal 重新进入"
                    }
                    onClick={() => setDevelopmentEmail("")}
                  >
                    退出工作台
                  </button>
                </div>
              )}
            </section>
          </div>
        </aside>
        <div className="workspace" inert={mobileNav}>
          <header className="topbar">
            <div className="topbar-left">
              <button
                className="button subtle small desktop-nav-toggle"
                aria-label={navCollapsed ? "展开左侧菜单" : "收起左侧菜单"}
                title={navCollapsed ? "展开左侧菜单" : "收起左侧菜单"}
                aria-expanded={!navCollapsed}
                aria-controls="main-navigation"
                onClick={() => setNavCollapsed((value) => !value)}
              >
                <List size={20} />
              </button>
              <button
                ref={navTrigger}
                className="button subtle small mobile-menu"
                aria-label="展开导航"
                onClick={() => {
                  setMobileNav(true);
                }}
              >
                <List size={20} />
              </button>
              <span className="breadcrumb">
                <strong>Resource Studio</strong>
                <span>经销商资源投资规划 · 2027 OP</span>
              </span>
            </div>
            <div className="topbar-right">
              <span className="topbar-user">
                <i>{String(userName).slice(0, 1).toUpperCase()}</i>
                <span>
                  <b>{userName}</b>
                  <small>
                    {roleLabel[identity.role]} · {userScope}
                  </small>
                </span>
              </span>
            </div>
          </header>
          <main id="main" className="page" tabIndex={-1}>
            {previewMode && (
              <UserPreviewBanner
                identity={identity}
                actor={
                  previewActor || {
                    email: identity.preview?.actorEmail,
                    label: identity.preview?.actorLabel,
                  }
                }
                busy={switchingPreview}
                onExit={stopUserPreview}
              />
            )}
            {storageWarning && (
              <div className="note-box warn" role="alert">
                {storageWarning}{" "}
                {apiMode && (
                  <button className="button small" onClick={refresh}>
                    重新加载
                  </button>
                )}
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
          </main>
        </div>
      </div>
      {toast && <ToastNotice toast={toast} onDismiss={dismissToast} />}
    </>
  );
}

export function PortalLogin({
  email,
  loading,
  onSubmit,
  error,
  editable = loginEmailEditable,
}) {
  const [draftEmail, setDraftEmail] = useState(email);
  useEffect(() => setDraftEmail(email), [email]);
  const loginEmail = (editable ? draftEmail : email).trim();
  return (
    <main className="login-shell">
      <section className="login-story" aria-label="壳牌资源投资工作台介绍">
        <div className="login-brand">
          <span className="login-brandmark" aria-hidden="true">
            <ChartLineUp size={28} weight="bold" />
          </span>
          <span>
            <strong>壳牌 · 资源投资</strong>
            <small>RESOURCE INVESTMENT</small>
          </span>
        </div>

        <div className="login-story-copy">
          <span className="login-kicker">2027 RESOURCE PLANNING</span>
          <h1>
            让每一笔资源，
            <br />
            投向更确定的增长。
          </h1>
          <p>
            连接预算、经销商分配与业务洞察，帮助团队在同一套数据口径下完成年度资源规划。
          </p>
        </div>

        <div className="login-capabilities" aria-label="工作台核心能力">
          <div>
            <strong>预算统筹</strong>
            <span>清晰掌握年度资源结构</span>
          </div>
          <div>
            <strong>协同分配</strong>
            <span>连接项目与经销商投入</span>
          </div>
          <div>
            <strong>数据洞察</strong>
            <span>用历史表现辅助决策</span>
          </div>
        </div>
      </section>

      <section className="login-entry">
        <form
          className="login-card"
          aria-labelledby="portal-login-title"
          onSubmit={(event) => {
            event.preventDefault();
            if (!loading && loginEmail) onSubmit(loginEmail.toLowerCase());
          }}
        >
          <div className="login-card-heading">
            <h2 id="portal-login-title">登录资源投资工作台</h2>
            <p>
              {editable
                ? "请输入已获授权的工作邮箱登录。"
                : "邮箱由帆软 Portal 自动传入，不能手工修改。"}
            </p>
          </div>

          {error && (
            <div className="login-alert" role="alert">
              {error}
            </div>
          )}

          <label className="login-email-field">
            <span>邮箱地址</span>
            <span className="login-input-wrap">
              <EnvelopeSimple size={20} aria-hidden="true" />
              <input
                type="email"
                autoComplete="email"
                value={editable ? draftEmail : email}
                onChange={(event) => setDraftEmail(event.target.value)}
                readOnly={!editable}
                aria-readonly={!editable}
                disabled={loading}
                required
                placeholder={
                  editable ? "请输入工作邮箱" : "请从帆软 Portal 进入"
                }
              />
            </span>
          </label>

          <button
            type="submit"
            className="login-submit"
            disabled={loading || !loginEmail}
          >
            <span>{loading ? "正在加载工作台…" : "进入工作台"}</span>
            <ArrowRight size={20} weight="bold" aria-hidden="true" />
          </button>

          <p className="login-session-note">
            <LockKey size={15} aria-hidden="true" />
            {editable
              ? "仅限已获授权的内部用户使用。"
              : "请从已授权的帆软 Portal 链接跳转至本系统；直接访问不会建立登录身份。"}
          </p>
        </form>
        <p className="login-footer">壳牌资源投资规划工作台 · 内部系统</p>
      </section>
    </main>
  );
}
