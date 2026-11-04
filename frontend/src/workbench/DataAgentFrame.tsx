import { useEffect, useRef, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { createAgentFrameController } from "../portal/agentFrame";
import type { AgentFrameState } from "../portal/agentFrame";
import { launchPortalDataAgent, PORTAL_SESSION_ENDED } from "../portal/session";
import { launchWorkbenchDataAgent, workbenchLaunchError } from "./dataAgent";

export function DataAgentFrame({ visible, portalMode }: { visible: boolean; portalMode: boolean }) {
  const [state, setState] = useState<AgentFrameState>({ status: "idle" });
  const controller = useRef<ReturnType<typeof createAgentFrameController> | undefined>(undefined);
  useEffect(() => {
    const lifecycle = createAgentFrameController(setState,
      portalMode ? launchPortalDataAgent : launchWorkbenchDataAgent,
      portalMode ? undefined : workbenchLaunchError);
    controller.current = lifecycle;
    const expired = () => lifecycle.expire();
    if (portalMode) window.addEventListener(PORTAL_SESSION_ENDED, expired);
    return () => {
      if (portalMode) window.removeEventListener(PORTAL_SESSION_ENDED, expired);
      lifecycle.dispose();
      controller.current = undefined;
    };
  }, [portalMode]);
  useEffect(() => { controller.current?.visible(visible); }, [visible]);

  return <div className="embedded-ask" hidden={!visible}>
    <div className="embedded-toolbar">
      <span>Data Agent 问数界面</span>
      <button className="button small" disabled={state.status === "expired"} onClick={() => controller.current?.retry()}>
        <ArrowClockwise size={16} />{state.status === "error" ? "重试" : "重新加载"}
      </button>
    </div>
    <div className="embedded-frame">
      {state.status === "granted" && <iframe
        src={state.iframeUrl} title="Data Agent 问数界面"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
      />}
      {state.status === "loading" && <div className="embedded-loading" role="status">正在打开 Data Agent…</div>}
      {(state.status === "error" || state.status === "expired") && <div className="work-empty" role="alert"><p>{state.message}</p></div>}
    </div>
    <p className="embedded-help">{state.status === "granted"
      ? "已获取访问凭证。页面空白或提示无权限时，请联系管理员确认 Data Agent 访问权限。"
      : portalMode ? "问数将使用当前 Portal 用户身份打开。" : "问数将使用当前资源工作台账号打开。"}</p>
  </div>;
}
