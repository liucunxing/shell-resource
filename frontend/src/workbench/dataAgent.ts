import { dataAgentLaunch } from "../../vendor/embed-browser-sdk/src/data-agent";
import { ApiError, request } from "./api.js";

/** The resource backend selects the account and vendor origin. Keep the grant in memory. */
export async function launchWorkbenchDataAgent(_question?: string, signal?: AbortSignal) {
  const result = await request("/data-agent/launch", {
    method: "POST", cache: "no-store", redirect: "error", signal,
  });
  const iframeUrl = result?.iframeUrl;
  try {
    return dataAgentLaunch({ iframeUrl, targetOrigin: new URL(iframeUrl).origin });
  } catch {
    throw new Error("问数服务返回的访问地址无效。");
  }
}

export function workbenchLaunchError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "工作台身份已失效，请重新进入资源工具。";
    if (error.status === 403 && error.message === "请从已验证身份的帆软入口打开问数")
      return "请从帆软重新打开资源工具。若仍出现此提示，请联系管理员检查入口身份验证。";
    if (error.status === 403 && error.message === "帆软身份与工作台账号不一致")
      return "帆软与工作台的账号不一致，请确认当前帆软账号后重新打开资源工具。";
    if (error.status === 503 && error.message === "工作台尚未配置可信问数入口")
      return "资源工具尚未配置可信的帆软入口，请联系管理员完成配置。";
    if (error.status === 403) return "当前账号无法使用问数，请联系管理员核对访问权限。";
    if (error.status === 503) return "问数服务尚不可用，请联系管理员核对资源工具的换票配置。";
  }
  return "暂时无法取得问数访问凭证，请重试。如仍然失败，请联系管理员。";
}
