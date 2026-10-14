import { expect, it } from "vitest";
import ExcelJS from "exceljs";
import E from "../src/workbench/domain/engine.js";
import X from "../src/workbench/domain/admin-excel.js";
import data from "../src/workbench/domain/demo-data.json";

const admin = { role: "admin", apiMode: true };
const users = [{ email: "Owner@Example.COM", role: "owner", department: "MKT" }];

async function workbook(state, rows) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await X.exportWorkbook(state, admin));
  const sheet = book.getWorksheet("预算与归属");
  if (sheet.rowCount > 1) sheet.spliceRows(2, sheet.rowCount - 1);
  rows.forEach((row) => sheet.addRow(row));
  return book.xlsx.writeBuffer();
}

it("accepts mixed-case owner and resources and confirms canonical resource values", async () => {
  const state = E.createState(data, "working");
  state.initiatives = [];
  const values = ["mRd", "sp&a", "ICE REBATE", "CAPEX"];
  const preview = await X.previewImport(await workbook(state, values.map((resource, index) =>
    [`Case ${index}`, "PCMO", resource, "MKT", " OWNER@example.com ", 10],
  )), state, admin, users);
  expect(preview.errors).toEqual([]);
  X.confirmImport(preview, state, admin);
  expect(state.initiatives.map((item) => item.resourceType)).toEqual(["MRD", "SP&A", "ICE Rebate", "Capex"]);
  expect(state.initiatives.every((item) => item.ownerId === "owner@example.com")).toBe(true);
});

it("treats casing-only edits as unchanged and still rejects unknown types or departments", async () => {
  const state = E.createState(data, "working");
  state.initiatives = [{ ...state.initiatives[0], name: "Case", sector: "PCMO", department: "MKT", resourceType: "Capex", ownerId: "OWNER@example.com", budget: 10 }];
  const row = ["Case", "PCMO", "CAPEX", "MKT", "Owner@Example.Com", 10];
  const preview = await X.previewImport(await workbook(state, [row]), state, admin, users);
  expect(preview.errors).toEqual([]);
  expect(preview.unchanged).toBe(1);
  expect(preview.creates).toEqual([]);
  const invalid = await X.previewImport(await workbook(state, [[...row.slice(0, 2), "Other", "ICE", ...row.slice(4)]]), state, admin, users);
  expect(invalid.errors.some((error) => error.includes("资源类型必须"))).toBe(true);
  expect(invalid.errors.some((error) => error.includes("Owner 必须"))).toBe(true);
});
