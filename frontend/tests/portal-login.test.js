import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptPortalEmail, DEV_EMAIL_KEY, getDevelopmentEmail, setDevelopmentEmail, workspace } from "../src/workbench/api.js";

function navigate(query) {
  const windowMock = {
    location: { href: `http://localhost:5173/${query}` },
    history: { state: { keep: true }, replaceState: vi.fn() },
  };
  vi.stubGlobal("window", windowMock);
  return windowMock;
}

beforeEach(() => {
  const values = new Map([[DEV_EMAIL_KEY, "old@example.com"]]);
  vi.stubGlobal("sessionStorage", {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("FineReport Portal email handoff", () => {
  it("replaces the old identity before the first workspace request and cleans only the email", async () => {
    const browser = navigate("?user_email=%20Example.User02%40Example.Invalid%20&view=admin#details");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ code: 200, data: { identity: { role: "admin" } } }),
    }));
    acceptPortalEmail();
    expect(getDevelopmentEmail()).toBe("example.user02@example.invalid");
    expect(browser.history.replaceState).toHaveBeenCalledWith({ keep: true }, "", "/?view=admin#details");
    await workspace();
    expect(fetch.mock.calls[0][1].headers["X-User-Email"]).toBe("example.user02@example.invalid");
  });

  it("accepts the space after ? in the supplied Portal URL", () => {
    navigate("?%20user_email=example.user02@example.invalid");
    acceptPortalEmail();
    expect(getDevelopmentEmail()).toBe("example.user02@example.invalid");
  });

  it("accepts an MD5 handoff and sends it to the workbench API", async () => {
    const browser = navigate("?user_email=B58996C504C5638798EB6B511E6F49AF");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ code: 200, data: {} }),
    }));
    acceptPortalEmail();
    expect(getDevelopmentEmail()).toBe("b58996c504c5638798eb6b511e6f49af");
    expect(browser.history.replaceState).toHaveBeenCalledWith({ keep: true }, "", "/");
    await workspace();
    expect(fetch.mock.calls[0][1].headers["X-User-Email"])
      .toBe("b58996c504c5638798eb6b511e6f49af");
  });

  it("restores the saved email on refresh and clears it on logout", () => {
    const browser = navigate("?view=admin");
    acceptPortalEmail();
    expect(getDevelopmentEmail()).toBe("old@example.com");
    setDevelopmentEmail("");
    acceptPortalEmail();
    expect(getDevelopmentEmail()).toBe("");
    expect(browser.history.replaceState).not.toHaveBeenCalled();
  });

  it("isolates independently opened tabs even when the previous release saved a shared email", () => {
    const firstTab = sessionStorage;
    navigate("");
    setDevelopmentEmail("owner@example.test");
    vi.stubGlobal("localStorage", { getItem: () => "legacy@example.test" });
    const secondValues = new Map();
    vi.stubGlobal("sessionStorage", {
      getItem: key => secondValues.get(key) ?? null,
      setItem: (key, value) => secondValues.set(key, value),
      removeItem: key => secondValues.delete(key),
    });
    expect(getDevelopmentEmail()).toBe("");
    setDevelopmentEmail("lead@example.test");
    const secondTab = sessionStorage;
    vi.stubGlobal("sessionStorage", firstTab);
    expect(getDevelopmentEmail()).toBe("owner@example.test");
    setDevelopmentEmail("");
    vi.stubGlobal("sessionStorage", secondTab);
    expect(getDevelopmentEmail()).toBe("lead@example.test");
  });

  it.each(["?user_email=", "?user_email=invalid", "?user_email=a%0D%0A@example.com", "?user_email=a@example.com&user_email=b@example.com", "?user_email=a@example.com&%20user_email=b@example.com"])("clears stale identity for invalid handoff %s", (query) => {
    navigate(query);
    acceptPortalEmail();
    expect(getDevelopmentEmail()).toBe("");
  });

  it("surfaces the API denial for an unmapped email", async () => {
    navigate("?user_email=unknown@example.com");
    acceptPortalEmail();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 403, json: async () => ({ code: 403, msg: "当前邮箱没有工作台权限" }),
    }));
    await expect(workspace()).rejects.toMatchObject({ status: 403, message: "当前邮箱没有工作台权限" });
    expect(getDevelopmentEmail()).toBe("unknown@example.com");
  });
});
