import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createAgentFrameController } from "../src/portal/agentFrame";
import { PortalAgentFrame } from "../src/portal/PortalAgentFrame";
import type { PortalDataAgentLaunch } from "../src/portal/session";

const grant = { iframeUrl: "https://agent.example.invalid/chat?token=synthetic", targetOrigin: "https://agent.example.invalid" };
afterEach(() => vi.useRealTimers());
function deferred() {
  let resolve!: (value: PortalDataAgentLaunch) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<PortalDataAgentLaunch>((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}

describe("Portal Data Agent frame lifecycle", () => {
  it("does not render an iframe or credential-bearing link before first use", () => {
    const html = renderToStaticMarkup(<PortalAgentFrame visible={false} />);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("独立打开");
    expect(html).toContain("hidden");
  });

  it("lazily launches once and preserves its grant across collapse and reopen", async () => {
    const work = deferred(), changed = vi.fn();
    const launch = vi.fn().mockReturnValue(work.promise);
    const controller = createAgentFrameController(changed, launch);
    controller.visible(false);
    expect(launch).not.toHaveBeenCalled();
    controller.visible(true);
    expect(changed).toHaveBeenLastCalledWith({ status: "loading" });
    controller.visible(false);
    expect(launch.mock.calls[0][1].aborted).toBe(false);
    work.resolve(grant);
    await vi.waitFor(() => expect(changed).toHaveBeenLastCalledWith({ status: "granted", iframeUrl: grant.iframeUrl }));
    controller.visible(true);
    expect(launch).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("aborts the old request on refresh and ignores its late response", async () => {
    const old = deferred(), next = deferred(), changed = vi.fn();
    const launch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const controller = createAgentFrameController(changed, launch);
    controller.visible(true);
    controller.retry();
    expect(launch.mock.calls[0][1].aborted).toBe(true);
    old.resolve({ ...grant, iframeUrl: `${grant.iframeUrl}-old` });
    await Promise.resolve();
    expect(changed).toHaveBeenLastCalledWith({ status: "loading" });
    next.resolve(grant);
    await vi.waitFor(() => expect(changed).toHaveBeenLastCalledWith({ status: "granted", iframeUrl: grant.iframeUrl }));
    controller.dispose();
  });

  it("shows a safe error and obtains a fresh grant on explicit retry", async () => {
    const changed = vi.fn();
    const launch = vi.fn().mockRejectedValueOnce(new Error("secret_token=never-render" )).mockResolvedValueOnce(grant);
    const controller = createAgentFrameController(changed, launch);
    controller.visible(true);
    await vi.waitFor(() => expect(changed.mock.lastCall?.[0].status).toBe("error"));
    expect(JSON.stringify(changed.mock.calls)).not.toContain("secret_token");
    controller.visible(false); controller.visible(true);
    expect(launch).toHaveBeenCalledOnce();
    controller.retry();
    await vi.waitFor(() => expect(changed.mock.lastCall?.[0].status).toBe("granted"));
    expect(launch).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it("cancels and forgets a request on resource session expiry without later retry", async () => {
    const work = deferred(), changed = vi.fn();
    const launch = vi.fn().mockReturnValue(work.promise);
    const controller = createAgentFrameController(changed, launch);
    controller.visible(true); controller.expire();
    expect(launch.mock.calls[0][1].aborted).toBe(true);
    work.resolve(grant);
    await Promise.resolve();
    expect(changed.mock.lastCall?.[0].status).toBe("expired");
    expect(JSON.stringify(changed.mock.calls)).not.toContain(grant.iframeUrl);
    controller.retry();
    expect(launch).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("removes an existing grant on expiry", async () => {
    const changed = vi.fn();
    const controller = createAgentFrameController(changed, vi.fn().mockResolvedValue(grant));
    controller.visible(true);
    await vi.waitFor(() => expect(changed.mock.lastCall?.[0].status).toBe("granted"));
    controller.expire();
    expect(changed.mock.lastCall?.[0]).not.toHaveProperty("iframeUrl");
    controller.dispose();
  });

  it("cancels on unmount and never delivers a late state update", async () => {
    const work = deferred(), changed = vi.fn();
    const launch = vi.fn().mockReturnValue(work.promise);
    const controller = createAgentFrameController(changed, launch);
    controller.visible(true); controller.dispose();
    expect(launch.mock.calls[0][1].aborted).toBe(true);
    const calls = changed.mock.calls.length;
    work.resolve(grant);
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(calls);
  });

  it("bounds the entire launch including a stalled local session check", async () => {
    vi.useFakeTimers();
    const work = deferred(), changed = vi.fn();
    const launch = vi.fn().mockReturnValue(work.promise);
    const controller = createAgentFrameController(changed, launch);
    controller.visible(true);
    await vi.advanceTimersByTimeAsync(45000);
    expect(launch.mock.calls[0][1].aborted).toBe(true);
    expect(changed).toHaveBeenLastCalledWith({ status: "error", message: "打开问数超时，请重试。" });
    work.resolve(grant);
    await Promise.resolve();
    expect(changed.mock.lastCall?.[0]).not.toHaveProperty("iframeUrl");
    controller.retry();
    expect(launch).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
});
