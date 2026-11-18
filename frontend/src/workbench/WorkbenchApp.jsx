import { navigationFor } from "./navigation";
export { navigationFor };
import { DealerDetailAccessProvider } from "./DealerDetailAccess";
import { AlertDescription } from "@/components/ui/alert";
import { getLocalPreviewConfig } from "./localPreview";
import { LocalPreviewSelector } from "./LocalPreviewSelector";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChartLineUp,
  EnvelopeSimple,
  LockKey,
  X,
} from "@phosphor-icons/react";
import { ownInitiatives, useWorkbench } from "./WorkbenchContext.jsx";
import { ToastNotice } from "./ToastNotice.jsx";
import { PortalAccessNotice } from "../portal/PortalEntry";
import { UserPreviewBanner } from "./UserPreviewBanner";
const UserProfileButton = lazy(() =>
  import("./UserProfileButton").then((m) => ({ default: m.UserProfileButton })),
);
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
const DepartmentReviewPage = lazy(() =>
  import("./pages/DepartmentReviewPage.jsx").then((m) => ({
    default: m.DepartmentReviewPage,
  })),
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
  "department-review": DepartmentReviewPage,
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
  const navigationRef = useRef(null);
  useLayoutEffect(() => {
    const header = navigationRef.current;
    if (!header) return;
    const workspace = header.parentElement;
    const measure = () => workspace.style.setProperty(
      "--appnav-height", `${header.getBoundingClientRect().height}px`,
    );
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    measure();
    return () => {
      observer.disconnect();
      workspace.style.removeProperty("--appnav-height");
    };
  }, [identity]);
  const localPreview = getLocalPreviewConfig();
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
  if (!identity && localPreview)
    return (
      <main className="page">
        <div className="empty" role={storageWarning ? "alert" : "status"}>
          {storageWarning || "正在加载本地测试工作台…"}
        </div>
        {storageWarning && (
          <Button disabled={loading} onClick={refresh}>
            重新加载
          </Button>
        )}
      </main>
    );
  if (!identity && apiMode && devEmail && loading)
    return <main className="page"><div className="empty" role="status">正在加载工作台…</div></main>;
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
  const nav = navigationFor(identity, identity.role === "lead" &&
    ownInitiatives(state.initiatives || [], identity).some((item) => item.enabled !== false));
  const Page = pages[page] || pages[nav[0]?.[0]] || HomePage;
  return (
    <>
      <SkipToWorkspace portalMode={portalMode} />
      {localPreview && (
        <div className="v19-preview-strip">
          <span>
            <b>LOCAL PREVIEW</b> 本地测试 ·{" "}
            {localPreview.dataLabel || "合成数据"}
          </span>
          <LocalPreviewSelector
            config={localPreview}
            email={devEmail}
            onChange={setDevelopmentEmail}
            disabled={loading || switchingPreview}
            compact
          />
        </div>
      )}
      <div className="app-shell studio-shell v19-shell v19-fidelity-shell">
        <div className="workspace">
          <header className="v19-appnav" ref={navigationRef}>
            <div className="v19-wordmark">
              <span className="v19-brand-icon">
                <img src="/resource-studio-icon.svg" alt="" />
              </span>
              <strong>Resource Studio</strong>
            </div>
            <nav className="v19-primary-nav" aria-label="工作台导航">
              {nav.map(([id, , label, , disabled]) => (
                <Button
                  key={id}
                  variant="ghost"
                  className={page === id ? "active" : ""}
                  aria-current={page === id ? "page" : undefined}
                  disabled={disabled}
                  onClick={() => navigate(id)}
                >
                  {label}
                </Button>
              ))}
            </nav>
            <div className="v19-nav-account">
              <Suspense fallback={<Button variant="ghost" disabled aria-label="正在加载用户信息">…</Button>}>
                <UserProfileButton key={identity.email || identity.key} identity={identity} />
              </Suspense>
              {apiMode && !localPreview && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDevelopmentEmail("")}
                >
                  退出
                </Button>
              )}
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
              <Alert className="note-box warn" role="alert">
                <AlertDescription>
                  {storageWarning}{" "}
                  {apiMode && (
                    <Button
                      variant="outline"
                      className="button small"
                      onClick={refresh}
                    >
                      重新加载
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}
            <Suspense
              fallback={
                <div className="empty" role="status">
                  正在加载工作区…
                </div>
              }
            >
              <DealerDetailAccessProvider role={identity.role}>
                <Page key={`${identity.key}:${page}:${scenarioEpoch}`} />
              </DealerDetailAccessProvider>
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
            <Alert className="login-alert" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Label className="login-email-field">
            <span>邮箱地址</span>
            <span className="login-input-wrap">
              <EnvelopeSimple size={20} aria-hidden="true" />
              <Input
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
          </Label>

          <Button
            variant="outline"
            type="submit"
            className="login-submit"
            disabled={loading || !loginEmail}
          >
            <span>{loading ? "正在加载工作台…" : "进入工作台"}</span>
            <ArrowRight size={20} weight="bold" aria-hidden="true" />
          </Button>

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
