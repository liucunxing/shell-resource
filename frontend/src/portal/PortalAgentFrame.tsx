import { useEffect, useRef, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { createAgentFrameController } from "./agentFrame";
import type { AgentFrameState } from "./agentFrame";
import { PORTAL_SESSION_ENDED } from "./session";

export function PortalAgentFrame({ visible }: { visible: boolean }) {
  const [state, setState] = useState<AgentFrameState>({ status: "idle" });
  const controller = useRef<ReturnType<typeof createAgentFrameController> | undefined>(undefined);
  useEffect(() => {
    const lifecycle = createAgentFrameController(setState);
    controller.current = lifecycle;
    const expired = () => lifecycle.expire();
    window.addEventListener(PORTAL_SESSION_ENDED, expired);
    return () => {
      window.removeEventListener(PORTAL_SESSION_ENDED, expired);
      lifecycle.dispose();
      controller.current = undefined;
    };
  }, []);
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
      : "问数将使用当前 Portal 用户身份打开。"}</p>
  </div>;
}
