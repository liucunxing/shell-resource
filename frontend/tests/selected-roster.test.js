import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import excel from "../src/workbench/domain/excel.js";

describe("selected roster export", () => {
  it("exports only selected Active identities, including zero amounts, without changing allocations", async () => {
    const rows = [
      { dealerId: "p:a", amount: 25 },
      { dealerId: "c:a", amount: 0 },
      { dealerId: "closed", amount: 80 },
      { dealerId: "unknown", amount: 90 },
    ];
    const before = structuredClone(rows);
    const dealers = [
      { id: "p:a", code: "0001", name: "P dealer", status: " Active " },
      { id: "c:a", code: "0001", name: "C dealer", status: "1" },
      { id: "closed", code: "0002", status: "closed" },
      { id: "unselected", code: "0003", status: "active" },
    ];
    const book = new ExcelJS.Workbook();
    const directory = [
      { id: "unselected", code: "0003", name: "Available", sector: "PCMO", sd: "East", rsm: "R1", status: "active" },
      { id: "other", code: "0003", name: "Other sector", sector: "B2B", sd: "West", rsm: "R2", status: "active" },
    ];
    await book.xlsx.load(await excel.exportSelectedRoster(rows, dealers, { distributorDirectory: directory }));
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["已选经销商", "经销商列表"]);
    expect(book.getWorksheet("经销商列表").getRow(1).values.slice(1)).toEqual(["业务线", "经销商编码", "经销商名称", "SD", "RSM", "状态"]);
    expect(book.getWorksheet("经销商列表").getRow(2).values.slice(1)).toEqual(["PCMO", "0003", "Available", "East", "R1", "active"]);
    expect(book.getWorksheet("经销商列表").getRow(3).getCell(1).value).toBe("B2B");
    const sheet = book.getWorksheet("已选经销商");
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(2).values.slice(1)).toEqual([
      "0001",
      "P dealer",
      "",
      "",
      "Active",
      25,
    ]);
    expect(sheet.getRow(3).getCell(6).value).toBe(0);
    expect(rows).toEqual(before);
  });
});
