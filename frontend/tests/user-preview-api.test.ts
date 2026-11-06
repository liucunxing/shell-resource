import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "../src/workbench/api.js";
import { getPreviewUserEmail, setPreviewUserEmail } from "../src/workbench/userPreview";
import { initializePortalSession, launchPortalDataAgent, disposePortalChild } from "../src/portal/session";

const instanceId = "12345678-1234-4234-8234-123456789abc";
const ok = (data = {}) => ({ ok: true, status: 200, json: async () => ({ code: 200, data }) });

beforeEach(() => {
  setPreviewUserEmail("");
  vi.stubGlobal("sessionStorage", { getItem: () => "admin@example.test" });
});
afterEach(() => {
  setPreviewUserEmail("");
  disposePortalChild();
  vi.unstubAllGlobals();
});

describe("read-only user preview transport", () => {
  it("keeps the administrator identity and attaches an uncached target selection", async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({ identity: "owner" }));
    vi.stubGlobal("fetch", fetcher);
    setPreviewUserEmail(" OWNER@example.test ");
    await request("/workspace");
    expect(fetcher).toHaveBeenCalledWith("/api/v1/workbench/workspace", expect.objectContaining({
      cache: "no-store",
      headers: expect.objectContaining({ "X-User-Email": "admin@example.test", "X-Preview-User-Email": "owner@example.test" }),
    }));
    setPreviewUserEmail("");
    await request("/workspace");
    expect(fetcher.mock.calls[1][1].headers).not.toHaveProperty("X-Preview-User-Email");
    expect(fetcher.mock.calls[1][1].headers["X-User-Email"]).toBe("admin@example.test");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("blocks %s before any network side effect", async (method) => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    setPreviewUserEmail("owner@example.test");
    await expect(request("/initiatives/1/draft", { method })).rejects.toThrow("只读模式");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("drops an old user's response even if it arrives after returning to the administrator", async () => {
    let complete!: (value: ReturnType<typeof ok>) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { complete = resolve; })));
    setPreviewUserEmail("owner@example.test");
    const pending = request("/workspace");
    setPreviewUserEmail("");
    complete(ok({ privateRows: ["old user"] }));
    await expect(pending).rejects.toThrow("用户视角已切换");
    expect(getPreviewUserEmail()).toBe("");
  });

  it("preserves Portal session credentials and never adds a development identity", async () => {
    const browserWindow = { location: { pathname: "/portal-embed/workbench" } };
    vi.stubGlobal("window", { ...browserWindow, parent: undefined });
    window.parent = window;
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ instanceId, landingPath: "/portal-embed/workbench" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: "csrf-fixture" }) })
      .mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetcher);
    await initializePortalSession(instanceId);
    setPreviewUserEmail("owner@example.test");
    await request("/workspace");
    const [path, options] = fetcher.mock.calls[2];
    expect(path).toBe("/portal-embed/api/v1/workbench/workspace");
    expect(options.headers.get("X-Portal-Instance")).toBe(instanceId);
    expect(options.headers.get("X-Preview-User-Email")).toBe("owner@example.test");
    expect(options.headers.has("X-User-Email")).toBe(false);
    expect(options.credentials).toBe("same-origin");
  });

  it("blocks the Portal parent Data Agent bridge during preview", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    setPreviewUserEmail("owner@example.test");
    await expect(launchPortalDataAgent()).rejects.toThrow("只读模式");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
