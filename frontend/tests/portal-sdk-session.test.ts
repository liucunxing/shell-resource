import { expect, it, vi } from "vitest";
import { createEmbedChild } from "@oneportal/embed-browser-sdk/child";

it("keeps the Portal readiness and session bridge after retiring the Agent bridge", () => {
  const parent = { postMessage: vi.fn() };
  const win = { parent, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const context = {
    protocolVersion: "1.0" as const,
    instanceId: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    appId: "resource-investment", embedderOrigin: "https://portal.example.invalid",
    landingPath: "/portal-embed/workbench",
  };
  const child = createEmbedChild(context, { window: win as unknown as Window });
  expect(child).not.toHaveProperty("launchDataAgent");
  child.notifyReady();
  child.notifySessionExpired();
  expect(parent.postMessage.mock.calls).toEqual([
    [{ protocol: "portal-embed", version: "1.0", type: "EMBED_READY",
      requestId: context.requestId, instanceId: context.instanceId,
      data: { appId: context.appId } }, context.embedderOrigin],
    [{ protocol: "portal-embed", version: "1.0", type: "SESSION_EXPIRED",
      requestId: context.requestId, instanceId: context.instanceId,
      data: { code: "SESSION_REQUIRED" } }, context.embedderOrigin],
  ]);
  child.destroy();
  expect(win.removeEventListener).toHaveBeenCalledWith("message", win.addEventListener.mock.calls[0][1]);
  expect(() => child.notifyReady()).toThrow("destroyed");
});
