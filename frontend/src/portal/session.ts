import { createEmbedChild } from "@oneportal/embed-browser-sdk/child";
import type { EmbedChild, EmbedContext } from "@oneportal/embed-browser-sdk/child";

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

async function trustedJson(path: string, instanceId: string): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "same-origin", cache: "no-store",
    headers: { Accept: "application/json", "X-Portal-Instance": instanceId },
  });
  if (!response.ok) {
    endPortalSession();
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
export async function validatePortalSession(): Promise<void> {
  if (!isPortalEntry()) return;
  if (!active) throw sessionFailure();
  const previous = active;
  const session = await trustedJson(`/portal-embed/api/session/${previous.instanceId}`, previous.instanceId) as { csrfToken?: unknown };
  if (active !== previous || typeof session.csrfToken !== "string" || !session.csrfToken) throw sessionFailure();
  active.csrfToken = session.csrfToken;
}

export async function logoutPortalSession(): Promise<void> {
  const response = await fetch("/portal-embed/logout", portalRequestOptions({ method: "POST" }));
  if (!response.ok && response.status !== 401) throw new Error("退出未完成，请重试。");
  endPortalSession();
}
