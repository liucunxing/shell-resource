import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLocalPreviewConfig,
  getLocalPreviewEmail,
  LOCAL_PREVIEW_EMAIL_KEY,
  setLocalPreviewEmail,
} from "../src/workbench/localPreview";
import {
  acceptPortalEmail,
  DEV_EMAIL_KEY,
  getDevelopmentEmail,
  setDevelopmentEmail,
  workspace,
} from "../src/workbench/api.js";

const config = {
  defaultEmail: "owner-a@example.test",
  users: [
    { email: "owner-a@example.test", label: "Owner A" },
    { email: "admin@example.test", label: "管理员" },
  ],
};
const values = new Map<string, string>();
function browser(href = "http://127.0.0.1:8019/", injected: unknown = config) {
  const mocked = {
    location: new URL(href),
    __RESOURCE_LOCAL_PREVIEW__: injected,
    history: { replaceState: vi.fn() },
  };
  vi.stubGlobal("window", mocked);
  return mocked;
}
beforeEach(() => {
  values.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("synthetic local preview direct entry", () => {
  it("accepts the larger prototype cast while retaining synthetic identities and dataset labeling", () => {
    const users = Array.from({ length: 40 }, (_, index) => ({
      email: `v19-u${index}@example.test`,
      label: `原型角色 ${index}`,
    }));
    browser("http://127.0.0.1:8019/", {
      defaultEmail: users[0].email,
      users,
      dataLabel: "V19 原型演示数据",
    });
    expect(getLocalPreviewConfig()?.users).toHaveLength(40);
    expect(getLocalPreviewConfig()?.dataLabel).toBe("V19 原型演示数据");
    expect(getLocalPreviewEmail()).toBe(users[0].email);
    expect(setLocalPreviewEmail("real@example.com")).toBe(false);
  });
  it("loads default identity without query or Portal and preserves normal email storage", async () => {
    browser();
    values.set(DEV_EMAIL_KEY, "real@example.com");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ code: 200, data: {} }),
      }),
    );
    acceptPortalEmail();
    expect(getDevelopmentEmail()).toBe("owner-a@example.test");
    await workspace();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/workspace"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-User-Email": "owner-a@example.test",
        }),
      }),
    );
    expect(values.get(DEV_EMAIL_KEY)).toBe("real@example.com");
  });
  it("persists only allowlisted synthetic role across direct revisits", () => {
    browser();
    setDevelopmentEmail("admin@example.test");
    browser();
    acceptPortalEmail();
    expect(getDevelopmentEmail()).toBe("admin@example.test");
    expect(values.get(LOCAL_PREVIEW_EMAIL_KEY)).toBe("admin@example.test");
    expect(setLocalPreviewEmail("unknown@example.test")).toBe(false);
    expect(setLocalPreviewEmail("real@example.com")).toBe(false);
    expect(getDevelopmentEmail()).toBe("admin@example.test");
  });
  it.each([
    "https://resource.example.com/",
    "http://127.0.0.1:8019/portal-embed/workbench",
    "http://localhost:8019/portal-embed",
  ])("does not bypass authentication for %s", (href) => {
    browser(href);
    expect(getLocalPreviewConfig()).toBeNull();
    expect(getLocalPreviewEmail()).toBe("");
  });
  it("requires injected config on localhost and keeps ordinary direct-entry login", () => {
    browser("http://localhost:8019/", null);
    values.set(DEV_EMAIL_KEY, "old@example.com");
    acceptPortalEmail();
    expect(getLocalPreviewConfig()).toBeNull();
    expect(getDevelopmentEmail()).toBe("");
  });
  it("rejects malformed and real-account configs and ignores stale selection", () => {
    browser("http://127.0.0.1:8019/", {
      ...config,
      defaultEmail: "missing@example.test",
    });
    expect(getLocalPreviewConfig()).toBeNull();
    browser("http://127.0.0.1:8019/", {
      defaultEmail: "real@example.com",
      users: [{ email: "real@example.com", label: "Real" }],
    });
    expect(getLocalPreviewConfig()).toBeNull();
    browser();
    values.set(LOCAL_PREVIEW_EMAIL_KEY, "deleted@example.test");
    expect(getLocalPreviewEmail()).toBe("owner-a@example.test");
  });
});
