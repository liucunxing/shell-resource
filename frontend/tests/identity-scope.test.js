import { afterEach, expect, it, vi } from "vitest";
import { identityScopeKey, invalidateAuthorizedReads } from "../src/workbench/identity-scope";
import { exportExcelInWorker } from "../src/workbench/file-import";
import { request } from "../src/workbench/api";

afterEach(() => vi.unstubAllGlobals());

it("discards a delayed response from the previous authorization context", async () => {
  let resolve;
  vi.stubGlobal("fetch", () => new Promise(done => { resolve = done; }));
  const pending = request("/workspace?planning_year=2027");
  const rejected = expect(pending).rejects.toMatchObject({ status: 409 });
  invalidateAuthorizedReads();
  resolve({ ok: true, json: async () => ({ code: 200, data: { secret: "old scope" } }) });
  await rejected;
});

it("compares actual authorization while ignoring local normalization and ordering", () => {
  const identity = { email: "manager@example.test", role: "management", department: [], sectors: ["PCMO", "OEM"] };
  expect(identityScopeKey(identity)).toBe(identityScopeKey({ ...identity, apiMode: true, sectors: ["OEM", "PCMO"] }));
  expect(identityScopeKey(identity)).not.toBe(identityScopeKey({ ...identity, sectors: ["PCMO"] }));
  expect(identityScopeKey(identity)).not.toBe(identityScopeKey({ ...identity, history_resources: [] }));
});


it("discards an Excel export finishing after authorization was revoked", async () => {
  let worker;
  vi.stubGlobal("Worker", class {
    constructor() { worker = this; }
    postMessage() {}
    terminate() {}
  });
  const pending = exportExcelInWorker("allocation", {});
  const rejected = expect(pending).rejects.toMatchObject({ status: 409 });
  invalidateAuthorizedReads();
  worker.onmessage({ data: { bytes: new ArrayBuffer(1) } });
  await rejected;
});
