import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { keepUnchanged, readWhileMounted, watchLiveRead } from "../src/workbench/live-read";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("checks visible tabs every ten seconds and checks immediately on return", async () => {
  const read = vi.fn();
  const stop = watchLiveRead(read);
  await vi.advanceTimersByTimeAsync(9999);
  expect(read).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(1);
  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(30000);
  expect(read).toHaveBeenCalledTimes(1);
  document.visibilityState = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  expect(read).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(10000);
  expect(read).toHaveBeenCalledTimes(2);
});
it("ignores an obsolete view and avoids overlapping slow requests", async () => {
  let finish;
  const read = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const stop = watchLiveRead(read);
  await vi.advanceTimersByTimeAsync(30000);
  expect(read).toHaveBeenCalledTimes(1);
  stop();
  expect(read.mock.calls[0][0]()).toBe(false);
  finish();
});
it("retries a failed detail read and retains unchanged rows by reference", async () => {
  const old = [{ id: 1, amount: 15 }];
  const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const stop = readWhileMounted(read, { onError: vi.fn() });
  await vi.advanceTimersByTimeAsync(10000);
  expect(read).toHaveBeenCalledTimes(2);
  expect(keepUnchanged(old, structuredClone(old))).toBe(old);
  stop();
});
