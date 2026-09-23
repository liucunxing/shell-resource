import { afterEach, describe, expect, it, vi } from "vitest";
import { request, saveThenPublish } from "../src/workbench/api.js";

describe("workbench API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not replace an API error with demo data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(request("/workspace")).rejects.toMatchObject({ name: "ApiError", status: 0 });
  });

  it("keeps revision conflicts visible to the caller", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 409, msg: "revision conflict" }) }));
    await expect(request("/initiatives/1/draft", { method: "PUT" })).rejects.toEqual(expect.objectContaining({ name: "ApiError", status: 409, message: "revision conflict" }));
  });

  it("uses the common response envelope only on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ code: 200, msg: "ok", data: { revision: 3 } }) }));
    await expect(request("/initiatives/1/draft")).resolves.toEqual({ revision: 3 });
  });

  it("surfaces backend validation errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ code: 422, msg: "金额不合法" }) }));
    await expect(request("/initiatives/1/draft", { method: "PUT" })).rejects.toEqual(expect.objectContaining({ status: 422, message: "金额不合法" }));
  });

  it("saves with the server revision before publishing the returned revision", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 200, data: { id: "1", revision: 8, rows: [], otherBudgets: [] } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ code: 200, data: { id: "P-1", initiativeId: "1", publishedRevision: 8 } }) });
    vi.stubGlobal("fetch", fetchMock);
    await saveThenPublish("1", { revision: 7, rows: [], otherBudgets: [] }, 7);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).expected_revision).toBe(7);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).expected_revision).toBe(8);
  });
});
