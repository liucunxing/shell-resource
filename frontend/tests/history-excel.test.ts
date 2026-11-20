import { expect, it } from "vitest";
import ExcelJS from "exceljs";
import X from "../src/workbench/domain/excel.js";

it("roundtrips the same dealer code under two RSM records independently", async () => {
  const identity = { role: "owner", department: "MKT", ownerId: "owner", apiMode: true };
  const dealers = ["One", "Two"].map((rsm) => ({
    id: `history:${rsm}`,
    code: "D1",
    name: "Dealer",
    sector: "PCMO",
    sd: "East",
    rsm,
    status: "active",
  }));
  const item = {
    id: "I",
    name: "Test",
    sector: "PCMO",
    department: "MKT",
    resourceType: "MRD",
    ownerId: "owner",
    budget: 100,
    revision: 1,
    rows: dealers.map((d) => ({ dealerId: d.id, amount: 50, note: "" })),
    otherBudgets: [{ id: "reserve-1", reasonId: "reserve", amount: 10, note: "保留" }],
  };
  const state = {
    departments: { MKT: { status: "collecting", versions: [] } },
    initiatives: [item],
    audit: [],
    budgetReasons: [],
  };
  const data = { dealers, distributorDirectory: dealers };
  const bytes = await X.exportWorkbook(state, "I", identity, data);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet("经销商分配")!;
  expect(sheet.getCell("A2").value).toBe("D1");
  expect(sheet.getCell("E2").value).toBe("One");
  expect(sheet.getCell("E3").value).toBe("Two");
  sheet.getCell("H3").value = ""; // Manual rows can be resolved by code + SD/RSM.
  const preview = await X.previewImport(
    await workbook.xlsx.writeBuffer(),
    state,
    "I",
    identity,
    data,
  );
  expect(preview.errors).toEqual([]);
  expect(preview.otherBudgets).toEqual(item.otherBudgets);
  expect(preview.summary.after).toBe(110);
  expect(preview.rows.map((r: { dealerId: string }) => r.dealerId)).toEqual(
    dealers.map((d) => d.id),
  );
  sheet.spliceRows(3, 1);
  const removed = await X.previewImport(await workbook.xlsx.writeBuffer(), state, "I", identity, data);
  expect(removed.errors).toEqual([]);
  expect(removed.changes).toContainEqual({ dealerId: dealers[1].id, before: item.rows[1], after: null });
  expect(removed.rows).toHaveLength(1);
  expect(removed.otherBudgets).toEqual(item.otherBudgets);
  const wrongVersion = await X.previewImport(bytes, { ...state, planningVersion: { id: "another" } }, "I", identity, data);
  expect(wrongVersion.errors.join(" ")).toContain("模板所属方案或版本");
});
