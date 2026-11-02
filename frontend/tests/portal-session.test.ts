import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disposePortalChild, initializePortalSession, isPortalEntry, logoutPortalSession,
  notifyPortalReady, portalInstanceId, portalRequestOptions, validatePortalSession,
  PORTAL_SESSION_ENDED,
} from "../src/portal/session";
import { acceptPortalEmail, getDevelopmentEmail, request, setDevelopmentEmail } from "../src/workbench/api.js";

const child = vi.hoisted(() => ({ notifyReady: vi.fn(), notifySessionExpired: vi.fn(), destroy: vi.fn() }));
vi.mock("@oneportal/embed-browser-sdk/child", () => ({ createEmbedChild: vi.fn(() => child) }));
const id = "11111111-1111-4111-8111-111111111111";
const context = {
  protocolVersion: "1.0", instanceId: id, requestId: "22222222-2222-4222-8222-222222222222",
  appId: "resource-investment", embedderOrigin: "https://portal.example.invalid",
  landingPath: "/portal-embed/workbench",
};
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
let events: EventTarget;
let fetchMock: ReturnType<typeof vi.fn>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn>; removeItem: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  events = new EventTarget();
  vi.stubGlobal("window", {
    location: { pathname: "/portal-embed/workbench", hash: `#portal-instance=${id}`, href: "https://resource.example.invalid/portal-embed/workbench?user_email=attacker@example.invalid" },
    parent: {}, dispatchEvent: events.dispatchEvent.bind(events),
  });
  storage = { getItem: vi.fn(() => "legacy-a@example.invalid"), setItem: vi.fn(), removeItem: vi.fn() };
  vi.stubGlobal("sessionStorage", storage);
  fetchMock = vi.fn().mockResolvedValueOnce(ok(context)).mockResolvedValueOnce(ok({ csrfToken: "test-csrf" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { disposePortalChild(); vi.unstubAllGlobals(); });

describe("isolated Portal browser session", () => {
  it("never reads or mutates the legacy email on the new path", () => {
    expect(isPortalEntry()).toBe(true);
    acceptPortalEmail();
    setDevelopmentEmail("attacker@example.invalid");
    expect(getDevelopmentEmail()).toBe("");
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("uses a canonical non-secret instance id for bootstrap and reload", () => {
    expect(portalInstanceId({ pathname: `/portal-embed/bootstrap/${id}`, hash: "" })).toBe(id);
    expect(portalInstanceId({ pathname: "/portal-embed/workbench", hash: `#portal-instance=${id}` })).toBe(id);
    expect(() => portalInstanceId({ pathname: "/portal-embed/workbench", hash: "" })).toThrow();
    expect(() => portalInstanceId({ pathname: "/portal-embed/workbench", hash: `#portal-instance=${id}&email=x` })).toThrow();
  });

  it("confirms protected context and session before SDK READY", async () => {
    await initializePortalSession(id);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      `/portal-embed/api/context/${id}`, `/portal-embed/api/session/${id}`,
    ]);
    expect(child.notifyReady).not.toHaveBeenCalled();
    notifyPortalReady();
    expect(child.notifyReady).toHaveBeenCalledOnce();
    for (const [, options] of fetchMock.mock.calls) {
      expect(options).toMatchObject({ credentials: "same-origin", cache: "no-store" });
    }
  });

  it("does not report READY or fall back when context fails", async () => {
    fetchMock.mockReset().mockResolvedValue({ ok: false, status: 401 });
    await expect(initializePortalSession(id)).rejects.toThrow();
    expect(child.notifyReady).not.toHaveBeenCalled();
    expect(() => portalRequestOptions()).toThrow();
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("rejects an unrelated instance or unregistered landing path", async () => {
    fetchMock.mockReset().mockResolvedValue(ok({ ...context, landingPath: "//attacker.invalid/" }));
    await expect(initializePortalSession(id)).rejects.toThrow();
    expect(child.notifyReady).not.toHaveBeenCalled();
  });

  it("binds reads and writes to the new API and removes forged identity headers", async () => {
    await initializePortalSession(id);
    fetchMock.mockResolvedValue(ok({ code: 200, data: { revision: 2 } }));
    await request("/workspace", { headers: { "X-User-Email": "forged@example.invalid", "X-Portal-Instance": "forged" } });
    const [url, options] = fetchMock.mock.calls[2];
    expect(url).toBe("/portal-embed/api/v1/workbench/workspace");
    expect(options.headers.get("X-User-Email")).toBeNull();
    expect(options.headers.get("X-Portal-Instance")).toBe(id);
    expect(options.headers.get("X-Portal-CSRF")).toBeNull();
    await request("/initiatives/1/draft", { method: "PUT", body: "{}", headers: { "X-Portal-CSRF": "forged" } });
    expect(fetchMock.mock.calls[3][1].headers.get("X-Portal-CSRF")).toBe("test-csrf");
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("cannot issue business requests before session initialization", async () => {
    await expect(request("/workspace")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks cached downloads and clears active credentials on account switch", async () => {
    await initializePortalSession(id);
    const ended = vi.fn(); events.addEventListener(PORTAL_SESSION_ENDED, ended);
    fetchMock.mockResolvedValue({ ok: false, status: 409 });
    await expect(validatePortalSession()).rejects.toThrow();
    expect(ended).toHaveBeenCalledOnce();
    expect(child.notifySessionExpired).toHaveBeenCalledOnce();
    expect(() => portalRequestOptions()).toThrow();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("logs out only the Portal session without clearing FineReport identity", async () => {
    await initializePortalSession(id);
    fetchMock.mockResolvedValue(ok({}));
    await logoutPortalSession();
    const [url, options] = fetchMock.mock.calls[2];
    expect(url).toBe("/portal-embed/logout");
    expect(options.method).toBe("POST");
    expect(options.headers.get("X-Portal-CSRF")).toBe("test-csrf");
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each(["CONTEXT_INVALID", "USER_UNMAPPED"])("clears the active UI session on a denied business call: %s", async (code) => {
    await initializePortalSession(id);
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 409, msg: code }) });
    const ended = vi.fn(); events.addEventListener(PORTAL_SESSION_ENDED, ended);
    await expect(request("/workspace")).rejects.toMatchObject({ status: 409 });
    expect(ended).toHaveBeenCalledOnce();
  });
});
