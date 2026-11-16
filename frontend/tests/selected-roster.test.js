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
    await book.xlsx.load(await excel.exportSelectedRoster(rows, dealers));
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
