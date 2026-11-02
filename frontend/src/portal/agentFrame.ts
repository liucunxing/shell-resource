import { launchPortalDataAgent } from "./session";
import type { PortalDataAgentLaunch } from "./session";

export type AgentFrameState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "granted"; iframeUrl: string }
  | { status: "expired"; message: string }
  | { status: "error"; message: string };

type Launch = (question?: string, signal?: AbortSignal) => Promise<PortalDataAgentLaunch>;

/** Page-local lifecycle: no credentials survive unmount or an expired resource session. */
export function createAgentFrameController(changed: (state: AgentFrameState) => void, launch: Launch = launchPortalDataAgent) {
  let state: AgentFrameState = { status: "idle" };
  let request: AbortController | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let expired = false;
  const set = (next: AgentFrameState) => { state = next; changed(next); };
  const clearDeadline = () => { clearTimeout(deadline); deadline = undefined; };
  const cancel = () => { clearDeadline(); request?.abort(); request = undefined; };
  const start = () => {
    if (disposed || expired) return;
    cancel();
    const current = new AbortController();
    request = current;
    set({ status: "loading" });
    // Covers both resource session checks as well as the parent credential exchange.
    deadline = setTimeout(() => {
      if (disposed || expired || request !== current) return;
      cancel();
      set({ status: "error", message: "打开问数超时，请重试。" });
    }, 45000);
    void launch(undefined, current.signal).then(result => {
      if (disposed || expired || current.signal.aborted || request !== current) return;
      clearDeadline();
      request = undefined;
      set({ status: "granted", iframeUrl: result.iframeUrl });
    }).catch(() => {
      if (disposed || expired || current.signal.aborted || request !== current) return;
      clearDeadline();
      request = undefined;
      set({ status: "error", message: "暂时无法打开问数，请重试；若访问已失效，请从 Portal 重新进入。" });
    });
  };
  return {
    visible(value: boolean) { if (value && state.status === "idle") start(); },
    retry: start,
    expire() {
      if (disposed) return;
      expired = true;
      cancel();
      set({ status: "expired", message: "当前访问已结束，请从 Portal 重新进入。" });
    },
    dispose() {
      disposed = true;
      cancel();
      state = { status: "idle" };
    },
  };
}
