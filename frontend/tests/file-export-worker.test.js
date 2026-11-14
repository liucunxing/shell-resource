import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { exportExcelInWorker } from "../src/workbench/file-import.js";

const identity = {
  role: "owner",
  department: "MKT",
  ownerId: "owner",
  apiMode: true,
};
const dealers = ["One", "Two"].map((rsm) => ({
  id: `history:${rsm}`,
  code: "D1",
  name: "Dealer",
  sector: "PCMO",
  sd: "East",
  rsm,
  status: "active",
}));
const state = {
  departments: { MKT: { status: "collecting", versions: [] } },
  audit: [],
  budgetReasons: [],
  initiatives: [
    {
      id: "I",
      name: "Worker export",
      sector: "PCMO",
      department: "MKT",
      resourceType: "MRD",
      ownerId: "owner",
      budget: 100,
      revision: 1,
      rows: dealers.map((dealer, index) => ({
        dealerId: dealer.id,
        amount: index * 100,
        note: "",
      })),
      otherBudgets: [],
    },
  ],
};
const data = { dealers, distributorDirectory: dealers };

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

async function workerHandler() {
  const postMessage = vi.fn();
  vi.stubGlobal("self", { postMessage });
  await import("../src/workbench/file-import.worker.js");
  return postMessage;
}

describe("background workbook export", () => {
  it("exports transferable XLSX and preserves same-code RSM rows, including zero allocation", async () => {
    const postMessage = await workerHandler();
    await self.onmessage({
      data: {
        operation: "export",
        kind: "allocation",
        args: [state, "I", identity, data],
      },
    });
    const [{ bytes }, transfer] = postMessage.mock.calls[0];
    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect(transfer).toEqual([bytes]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const sheet = workbook.getWorksheet("经销商分配");
    expect(sheet.getCell("A2").value).toBe("D1");
    expect(sheet.getCell("E2").value).toBe("One");
    expect(sheet.getCell("E3").value).toBe("Two");
    await self.onmessage({
      data: {
        kind: "allocation",
        buffer: bytes,
        args: [state, "I", identity, data],
      },
    });
    const { preview } = postMessage.mock.calls[1][0];
    expect(preview.errors).toEqual([]);
    expect(preview.rows.map((row) => [row.dealerId, row.amount])).toEqual([
      ["history:One", 0],
      ["history:Two", 100],
    ]);
  });

  it("exports the directory and rejects unauthorized administrator export", async () => {
    const postMessage = await workerHandler();
    await self.onmessage({
      data: { operation: "export", kind: "directory", args: [data] },
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(postMessage.mock.calls[0][0].bytes);
    expect(workbook.getWorksheet("经销商列表").rowCount).toBe(3);
    await self.onmessage({
      data: { operation: "export", kind: "admin", args: [state, identity] },
    });
    expect(postMessage.mock.calls[1][0].error).toContain("仅管理员");
  });

  it("transfers exported bytes to the caller and terminates the worker", async () => {
    const bytes = new ArrayBuffer(4);
    let worker;
    class FakeWorker {
      constructor() {
        worker = this;
      }
      postMessage(message) {
        expect(message).toEqual({
          operation: "export",
          kind: "directory",
          args: [data],
        });
        queueMicrotask(() => this.onmessage({ data: { bytes } }));
      }
      terminate = vi.fn();
    }
    vi.stubGlobal("Worker", FakeWorker);
    expect(await exportExcelInWorker("directory", data)).toBe(bytes);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each(["onerror", "onmessageerror"])(
    "rejects %s failures and releases the worker",
    async (event) => {
      let worker;
      class FakeWorker {
        constructor() {
          worker = this;
        }
        postMessage() {
          queueMicrotask(() => this[event]());
        }
        terminate = vi.fn();
      }
      vi.stubGlobal("Worker", FakeWorker);
      await expect(exportExcelInWorker("directory", data)).rejects.toThrow(
        "文件处理失败",
      );
      expect(worker.terminate).toHaveBeenCalledOnce();
    },
  );

  it("explains unsupported browsers without silently processing on the UI thread", async () => {
    vi.stubGlobal("Worker", undefined);
    await expect(exportExcelInWorker("directory", data)).rejects.toThrow(
      "当前浏览器不支持后台文件处理",
    );
  });
});
