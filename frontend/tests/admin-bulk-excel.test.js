import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import {
  exportWorkbook,
  previewImport,
  parseAdminRows,
} from "../src/workbench/domain/admin-bulk-excel";
const user = [
  "reviewer.demo@example.test",
  "模板测试用户",
  "management",
  "",
  "",
  "启用",
  "PCMO",
  "MKT",
  "默认",
];
const initiative = {
  id: "5",
  name: "模板项目",
  sector: "PCMO",
  department: "MKT",
  resourceType: "MRD",
  ownerId: "owner.demo@example.test",
  budget: 100000,
  enabled: true,
};
describe("administrator batch templates", () => {
  it("requires causes and current-version IDs", () => {
    const row = {
      rowNumber: 2,
      cells: [
        "5",
        "模板项目",
        "PCMO",
        "MKT",
        "MRD",
        "owner.demo@example.test",
        "100000",
        "启用",
        "",
      ],
    };
    expect(
      parseAdminRows("initiatives", [row], { initiatives: [initiative] })
        .errors[0].message,
    ).toContain("变化原因");
    row.cells[8] = "年度预算调整";
    expect(
      parseAdminRows("initiatives", [row], { initiatives: [initiative] })
        .items[0],
    ).toMatchObject({ id: 5, budget: 100000, reason: "年度预算调整" });
    expect(
      parseAdminRows("initiatives", [row], { initiatives: [] }).errors[0]
        .message,
    ).toContain("当前规划版本");
  });
  it("rejects duplicates, missing affiliation and invalid Owner scopes", () => {
    const row = { rowNumber: 2, cells: user };
    expect(parseAdminRows("users", [row]).items[0]).toMatchObject({
      role: "management",
      sector: [],
      history_resources: null,
    });
    expect(
      parseAdminRows("users", [row, { ...row, rowNumber: 3 }]).errors[0]
        .message,
    ).toContain("重复");
    expect(
      parseAdminRows("users", [
        { rowNumber: 2, cells: [...user.slice(0, 6), "", "MKT", "默认"] },
      ]).errors[0].message,
    ).toContain("所属");
    const owner = [...user];
    owner[2] = "owner";
    owner[3] = "MKT";
    owner[4] = "PCMO,B2B";
    expect(
      parseAdminRows("users", [{ rowNumber: 2, cells: owner }]).errors[0]
        .message,
    ).toContain("一条");
  });
  it("exports blank user template with instructions and rejects formulas", async () => {
    const bytes = await exportWorkbook("users");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    expect(book.getWorksheet("用户信息").rowCount).toBe(1);
    expect(book.getWorksheet("填写说明").rowCount).toBeGreaterThan(5);
    book.getWorksheet("用户信息").addRow(user);
    let result = await previewImport(await book.xlsx.writeBuffer(), "users");
    expect(result.errors).toEqual([]);
    expect(result.items).toHaveLength(1);
    book.getWorksheet("用户信息").getCell("B2").value = {
      formula: '"姓名"',
      result: "姓名",
    };
    result = await previewImport(await book.xlsx.writeBuffer(), "users");
    expect(result.errors[0]).toMatchObject({ row: 2 });
    expect(result.errors[0].message).toContain("公式");
  });
  it("roundtrips version initiatives without inventing change reasons", async () => {
    const bytes = await exportWorkbook("initiatives", {
      initiatives: [initiative],
      versionId: "202701",
    });
    const result = await previewImport(bytes, "initiatives", {
      initiatives: [initiative],
      versionId: "202701",
    });
    await expect(
      previewImport(bytes, "initiatives", {
        initiatives: [initiative],
        versionId: "202612",
      }),
    ).rejects.toThrow("规划版本");
    expect(result.items).toEqual([]);
    expect(result.errors[0].message).toContain("变化原因");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    book.getWorksheet("Initiative归属").getCell("I2").value = "Owner归属校准";
    expect(
      (
        await previewImport(await book.xlsx.writeBuffer(), "initiatives", {
          initiatives: [initiative],
          versionId: "202701",
        })
      ).items[0].budget,
    ).toBe(100000);
  });
  it("runs new operations through the worker", async () => {
    const messages = [];
    vi.stubGlobal("self", { postMessage: (message) => messages.push(message) });
    try {
      await import("../src/workbench/file-import.worker");
      await self.onmessage({
        data: { kind: "admin-users", operation: "export", args: [{}] },
      });
      expect(messages[0].bytes).toBeInstanceOf(ArrayBuffer);
      const result = await previewImport(messages[0].bytes, "users");
      expect(result.errors[0].message).toContain("没有可导入");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
