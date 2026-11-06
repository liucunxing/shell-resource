import { createEmbedChild } from "@oneportal/embed-browser-sdk/child";
import type { DataAgentLaunch, EmbedChild, EmbedContext } from "@oneportal/embed-browser-sdk/child";
import { assertNotUserPreview, assertPreviewResponseCurrent, getPreviewEpoch } from "../workbench/userPreview";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const PORTAL_API_BASE = "/portal-embed/api/v1/workbench";
export const PORTAL_SESSION_ENDED = "resource-portal-session-ended";
let active: { instanceId: string; csrfToken: string; child?: EmbedChild } | undefined;

export function isPortalEntry(): boolean {
  if (typeof window === "undefined" || !window.location) return false;
  const path = window.location.pathname ?? new URL(window.location.href).pathname;
  return path === "/portal-embed" || path.startsWith("/portal-embed/");
}

export function portalInstanceId(location: Pick<Location, "pathname" | "hash">): string {
  const bootstrap = /^\/portal-embed\/bootstrap\/([^/]+)$/.exec(location.pathname);
  const value = bootstrap?.[1] ?? /^#portal-instance=([^&]+)$/.exec(location.hash)?.[1];
  if (!value || !UUID.test(value)) throw new Error("请从 Portal 重新进入资源投资工具。");
  return value;
}

function sessionFailure(): Error {
  return new Error("当前访问已失效或权限已变更，请从 Portal 重新进入。");
}

export function endPortalSession(): void {
  const previous = active;
  active = undefined;
  try { previous?.child?.notifySessionExpired(); }
  catch { /* Local expiry remains authoritative if the parent is already gone. */ }
  finally { previous?.child?.destroy(); }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PORTAL_SESSION_ENDED));
}

export function handlePortalRejection(status: number, code?: string): void {
  if (status === 401 || (status === 409 && ["CONTEXT_INVALID", "USER_UNMAPPED"].includes(code ?? "")) ||
      (status === 403 && ["USER_DISABLED", "RESOURCE_FORBIDDEN", "PERMISSION_CHANGED"].includes(code ?? ""))) {
    endPortalSession();
  }
}

async function trustedJson(path: string, instanceId: string, signal?: AbortSignal): Promise<unknown> {
  const previous = active;
  const response = await fetch(path, {
    credentials: "same-origin", cache: "no-store", signal,
    headers: { Accept: "application/json", "X-Portal-Instance": instanceId },
  });
  if (!response.ok) {
    if (active === previous) endPortalSession();
    throw sessionFailure();
  }
  return response.json();
}

/** Session credentials remain in memory; only the non-secret instance id is in the URL. */
export async function initializePortalSession(instanceId: string): Promise<EmbedContext> {
  if (!UUID.test(instanceId)) throw sessionFailure();
  const context = await trustedJson(`/portal-embed/api/context/${instanceId}`, instanceId) as EmbedContext;
  if (context.instanceId !== instanceId || context.landingPath !== "/portal-embed/workbench") {
    throw sessionFailure();
  }
  const session = await trustedJson(`/portal-embed/api/session/${instanceId}`, instanceId) as { csrfToken?: unknown };
  if (typeof session.csrfToken !== "string" || !session.csrfToken) throw sessionFailure();
  const child = window.parent === window ? undefined : createEmbedChild(context, {
    allowLoopbackHttp: import.meta.env.VITE_PORTAL_ALLOW_LOOPBACK_HTTP === "true",
  });
  active?.child?.destroy();
  active = { instanceId, csrfToken: session.csrfToken, child };
  return context;
}

export function notifyPortalReady(): void {
  if (!active?.child) throw sessionFailure();
  active.child.notifyReady();
}

export function disposePortalChild(): void {
  active?.child?.destroy();
  active = undefined;
}

export function portalRequestOptions(options: RequestInit = {}): RequestInit {
  if (!active) throw sessionFailure();
  const headers = new Headers(options.headers);
  headers.delete("X-User-Email");
  headers.set("X-Portal-Instance", active.instanceId);
  if (!["GET", "HEAD", "OPTIONS"].includes((options.method ?? "GET").toUpperCase())) {
    headers.set("X-Portal-CSRF", active.csrfToken);
  }
  return { ...options, headers, credentials: "same-origin", cache: "no-store" };
}

/** Also used immediately before locally generated downloads and when returning to a tab. */
export async function validatePortalSession(signal?: AbortSignal): Promise<void> {
  if (!isPortalEntry()) return;
  if (!active) throw sessionFailure();
  const previous = active;
  const session = await trustedJson(`/portal-embed/api/session/${previous.instanceId}`, previous.instanceId, signal) as { csrfToken?: unknown };
  if (active !== previous || typeof session.csrfToken !== "string" || !session.csrfToken) throw sessionFailure();
  active.csrfToken = session.csrfToken;
}

export type PortalDataAgentLaunch = DataAgentLaunch;

/** Only the authenticated Portal parent can exchange the vendor credential. */
export async function launchPortalDataAgent(question?: string, signal?: AbortSignal): Promise<PortalDataAgentLaunch> {
  assertNotUserPreview();
  const previewEpoch = getPreviewEpoch();
  const previous = active;
  const child = previous?.child;
  if (!isPortalEntry() || !previous || !child) {
    throw new Error("请在 Portal 中打开资源投资工具后使用问数。");
  }
  const assertCurrent = () => {
    assertPreviewResponseCurrent(previewEpoch);
    assertNotUserPreview();
    if (signal?.aborted) throw new DOMException("已取消", "AbortError");
    if (active !== previous) throw sessionFailure();
  };
  assertCurrent();
  await validatePortalSession(signal);
  assertCurrent();
  const result = await child.launchDataAgent(question, signal);
  assertCurrent();
  // A shared Cookie can change while Portal is exchanging the vendor credential.
  await validatePortalSession(signal);
  assertCurrent();
  let url: URL;
  try { url = new URL(result.iframeUrl); }
  catch { throw new Error("问数访问地址无效，请重试。"); }
  if (url.origin !== result.targetOrigin || url.username || url.password ||
      url.protocol !== "https:") throw new Error("问数访问地址无效，请重试。");
  return { iframeUrl: result.iframeUrl, targetOrigin: result.targetOrigin };
}

export async function logoutPortalSession(): Promise<void> {
  const response = await fetch("/portal-embed/logout", portalRequestOptions({ method: "POST" }));
  if (!response.ok && response.status !== 401) throw new Error("退出未完成，请重试。");
  endPortalSession();
}
