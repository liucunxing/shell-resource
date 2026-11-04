import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { launchWorkbenchDataAgent, workbenchLaunchError } from "../src/workbench/dataAgent";
import { ApiError } from "../src/workbench/api.js";
import { WorkPanel } from "../src/workbench/WorkPanel.jsx";

const context = vi.hoisted(() => ({
  apiMode: true, portalMode: false, identity: { role: "admin", email: "alice@example.test" },
  view: { initiatives: [] }, data: { dealers: [] }, auxiliary: { open: true, tab: "chat" },
}));
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({ useWorkbench: () => context }));
vi.mock("../src/workbench/pages/InsightPanel.jsx", () => ({ InsightPanel: () => null }));

const iframeUrl = "https://agent.example.invalid/admin/chat?token=synthetic&space=default";

function response(url: string) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ code: 200, data: { iframeUrl: url } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("FineReport workbench Data Agent", () => {
  it("selects resource-ticket mode in the real workbench panel", () => {
    const html = renderToStaticMarkup(<WorkPanel overlay={false} panelSize={undefined} />);
    expect(html).toContain("问数将使用当前资源工作台账号打开");
    expect(html).not.toContain("独立打开");
    expect(html).not.toContain("user_email=");
    expect(html).not.toContain("<iframe");
  });

  it("uses only the workbench endpoint and its current identity header", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => context.identity.email });
    const fetchMock = response(iframeUrl);
    const signal = new AbortController().signal;
    await expect(launchWorkbenchDataAgent(undefined, signal)).resolves.toMatchObject({ iframeUrl });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/v1/workbench/data-agent/launch", {
      method: "POST", signal, cache: "no-store", redirect: "error",
      headers: { Accept: "application/json", "X-User-Email": context.identity.email },
    });
  });

  it.each([
    iframeUrl.replace("https:", "http:"), iframeUrl.replace("/admin/chat", "/signin"),
    iframeUrl.replace("token=synthetic", "user_email=alice"), iframeUrl + "&token=x",
    iframeUrl.replace("space=default", "space="),
  ])("rejects unexpected vendor launch addresses", async (url) => {
    response(url);
    await expect(launchWorkbenchDataAgent()).rejects.toThrow("问数服务返回的访问地址无效");
  });

  it("distinguishes trusted-entry errors without echoing arbitrary server messages", () => {
    expect(workbenchLaunchError(new ApiError("请从已验证身份的帆软入口打开问数", 403))).toContain("入口身份验证");
    expect(workbenchLaunchError(new ApiError("帆软身份与工作台账号不一致", 403))).toContain("账号不一致");
    expect(workbenchLaunchError(new ApiError("工作台尚未配置可信问数入口", 503))).toContain("可信的帆软入口");
    expect(workbenchLaunchError(new ApiError("帆软身份与工作台账号不一致: token=synthetic", 403))).toContain("访问权限");
  });

  it("shows guidance for configuration and permission failures without displaying upstream details", () => {
    expect(workbenchLaunchError(new ApiError("sensitive", 503))).toContain("换票配置");
    expect(workbenchLaunchError(new ApiError("sensitive", 403))).toContain("访问权限");
    expect(workbenchLaunchError(new Error(iframeUrl))).not.toContain("synthetic");
  });
});
