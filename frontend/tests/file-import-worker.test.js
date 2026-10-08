import { afterEach, describe, expect, it, vi } from "vitest";
import E from "../src/workbench/domain/engine.js";
import AX from "../src/workbench/domain/admin-excel.js";
import demoData from "../src/workbench/domain/demo-data.json";
import {
  parseReferenceInWorker,
  previewExcelInWorker,
} from "../src/workbench/file-import.js";

afterEach(() => vi.unstubAllGlobals());

describe("background Excel preview", () => {
  it("parses an exported administrator workbook in the worker handler", async () => {
    const state = E.createState(demoData, "working");
    state.initiatives = [
      state.initiatives.find((item) => item.department === "MKT"),
    ];
    state.initiatives[0].ownerId = "owner@example.test";
    state.initiatives[0].revision = 0;
    const identity = {
      role: "admin",
      apiMode: true,
      email: "admin@example.test",
    };
    const users = [
      { email: "owner@example.test", role: "owner", department: "MKT" },
    ];
    const bytes = await AX.exportWorkbook(state, identity);
    const buffer = Uint8Array.from(bytes).buffer;
    const messages = [];
    vi.stubGlobal("self", { postMessage: (message) => messages.push(message) });

    await import("../src/workbench/file-import.worker.js");
    await self.onmessage({
      data: { kind: "admin", buffer, args: [state, identity, users] },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0].preview.errors).toEqual([]);
    expect(messages[0].preview.unchanged).toBe(1);
  });

  it("transfers the workbook and resolves the background result", async () => {
    let worker;
    class FakeWorker {
      constructor() {
        worker = this;
      }

      postMessage(message, transfer) {
        expect(message.kind).toBe("allocation");
        expect(transfer).toEqual([message.buffer]);
        queueMicrotask(() =>
          this.onmessage({ data: { preview: { errors: [] } } }),
        );
      }

      terminate() {
        this.terminated = true;
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const preview = await previewExcelInWorker(
      "allocation",
      new ArrayBuffer(4),
    );

    expect(preview).toEqual({ errors: [] });
    expect(worker.terminated).toBe(true);
  });

  it("parses historical reference JSON in the background", async () => {
    const posted = [];
    vi.stubGlobal("self", { postMessage: (message) => posted.push(message) });
    vi.resetModules();
    await import("../src/workbench/file-import.worker.js");
    await self.onmessage({
      data: { kind: "reference", text: '{"batchId":"2026-08","dealers":[]}' },
    });

    expect(posted[0].preview).toEqual({ batchId: "2026-08", dealers: [] });
  });

  it("transfers historical reference text through the worker bridge", async () => {
    class FakeWorker {
      postMessage(message) {
        expect(message.kind).toBe("reference");
        queueMicrotask(() =>
          this.onmessage({ data: { preview: JSON.parse(message.text) } }),
        );
      }

      terminate() {}
    }
    vi.stubGlobal("Worker", FakeWorker);
    expect(await parseReferenceInWorker('{"batchId":"2026-08"}')).toEqual({
      batchId: "2026-08",
    });
  });
});
