import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  disposePortalChild, initializePortalSession, notifyPortalReady, portalInstanceId,
  PORTAL_SESSION_ENDED, validatePortalSession,
} from "./session";

export function PortalAccessNotice({ loading = false, message = "" }: { loading?: boolean; message?: string }) {
  return <main className="page"><section className="panel" role={loading ? "status" : "alert"}>
    <h1>{loading ? "正在进入资源投资工具…" : "请从 Portal 重新进入"}</h1>
    <p>{message || (loading ? "正在确认当前用户与访问权限。" : "当前访问已结束或权限已变更，请返回 Portal 打开资源投资工具。")}</p>
  </section></main>;
}

export function PortalEntry({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let alive = true;
    let initialized = false;
    const ended = () => { if (alive) { setMessage(""); setState("error"); } };
    window.addEventListener(PORTAL_SESSION_ENDED, ended);
    const initialize = async () => {
      try {
        const id = portalInstanceId(window.location);
        const context = await initializePortalSession(id);
        if (!alive) return;
        if (window.location.pathname.startsWith("/portal-embed/bootstrap/")) {
          notifyPortalReady();
          window.location.replace(`${context.landingPath}#portal-instance=${id}`);
        } else if (window.location.pathname === context.landingPath) { initialized = true; setState("ready"); }
        else throw Error("请从 Portal 重新进入资源投资工具。");
      } catch {
        if (alive) { setMessage("无法确认当前访问，请返回 Portal 重新打开资源投资工具。"); setState("error"); }
      }
    };
    void initialize();
    const validate = () => {
      if (initialized && document.visibilityState !== "hidden") void validatePortalSession().catch(() => {
        if (alive) { setMessage("当前访问无法验证，请返回 Portal 重新进入。"); setState("error"); }
      });
    };
    window.addEventListener("focus", validate);
    document.addEventListener("visibilitychange", validate);
    const timer = window.setInterval(validate, 30000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(PORTAL_SESSION_ENDED, ended);
      window.removeEventListener("focus", validate);
      document.removeEventListener("visibilitychange", validate);
      disposePortalChild();
    };
  }, []);
  return state === "ready" ? children : <PortalAccessNotice loading={state === "loading"} message={message} />;
}
