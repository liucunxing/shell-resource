import { afterEach, beforeEach, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ allocation: vi.fn(), admin: vi.fn() }));
vi.mock("../src/workbench/domain/excel.js", () => {
  loaded.allocation();
  return { default: { previewImport: async () => ({ errors: [] }) } };
});
vi.mock("../src/workbench/domain/admin-excel.js", () => {
  loaded.admin();
  return { default: { previewImport: async () => ({ errors: [] }) } };
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("self", { postMessage: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

it("does not load either workbook module for worker startup or reference JSON", async () => {
  await import("../src/workbench/file-import.worker.js");
  await self.onmessage({ data: { kind: "reference", text: '{"dealers":[]}' } });
  expect(self.postMessage).toHaveBeenCalledWith({ preview: { dealers: [] } });
  expect(loaded.allocation).not.toHaveBeenCalled();
  expect(loaded.admin).not.toHaveBeenCalled();
});

it("loads only the workbook handler requested by an Excel task", async () => {
  await import("../src/workbench/file-import.worker.js");
  await self.onmessage({
    data: { kind: "allocation", buffer: new ArrayBuffer(1), args: [] },
  });
  expect(self.postMessage).toHaveBeenCalledWith({ preview: { errors: [] } });
  expect(loaded.allocation).toHaveBeenCalledOnce();
  expect(loaded.admin).not.toHaveBeenCalled();
});
