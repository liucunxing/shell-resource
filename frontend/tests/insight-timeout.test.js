import { afterEach, expect, it, vi } from "vitest";
import { generateInsights } from "../src/workbench/api.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("cancels a stalled Insight request without submitting a duplicate", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  }));
  vi.stubGlobal("fetch", fetchMock);
  const pending = expect(generateInsights("owner:test")).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(65000);
  await pending;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});

it("clears the deadline after a successful result", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ code: 200, data: { status: "generated" } }),
  }));
  await expect(generateInsights("owner:test")).resolves.toEqual({ status: "generated" });
  expect(vi.getTimerCount()).toBe(0);
});
