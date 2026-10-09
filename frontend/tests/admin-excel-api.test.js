import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import E from "../src/workbench/domain/engine.js";
import AX from "../src/workbench/domain/admin-excel.js";
import data from "../src/workbench/domain/demo-data.json";

const admin = { role: "admin", apiMode: true, email: "admin@example.test" };
function fixture() {
  const state = E.createState(data, "working");
  state.initiatives = [
    state.initiatives.find((item) => item.department === "MKT"),
  ];
  Object.assign(state.initiatives[0], {
    ownerId: "a@example.test",
    revision: 0,
  });
  const users = [
    { email: "a@example.test", role: "owner", department: "MKT" },
    { email: "b@example.test", role: "owner", department: "MKT" },
    { email: "other@example.test", role: "owner", department: "ICE" },
  ];
  return { state, users };
}
async function modify(bytes, owner, budget) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.getWorksheet("预算与归属");
  sheet.getCell("E2").value = owner;
  sheet.getCell("F2").value = budget;
  return book.xlsx.writeBuffer();
}
async function appendInitiative(bytes, values = {}) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.getWorksheet("预算与归属");
  sheet.addRow([
    values.name ?? "New Initiative",
    values.sector ?? "PCMO",
    values.resourceType ?? "MRD",
    values.department ?? "MKT",
    values.ownerId ?? "a@example.test",
    values.budget ?? 250,
  ]);
  return book.xlsx.writeBuffer();
}
describe("API administrator Excel round trip", () => {
  it("accepts exported email owners and initial revision zero unchanged", async () => {
    const { state, users } = fixture();
    const bytes = await AX.exportWorkbook(state, admin);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes);
    expect(book.getWorksheet("模板说明").getCell("B2").value).toContain(
      "MKT → MRD、SP&A；ICE → ICE Rebate；CAPEX → Capex",
    );
    const result = await AX.previewImport(bytes, state, admin, users);
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(0);
    expect(result.unchanged).toBe(1);
  });
  it("previews and applies an authorized email reassignment from revision zero", async () => {
    const { state, users } = fixture();
    const budget = state.initiatives[0].budget + 100;
    const bytes = await modify(
      await AX.exportWorkbook(state, admin),
      "b@example.test",
      budget,
    );
    const result = await AX.previewImport(bytes, state, admin, users);
    expect(result.errors).toEqual([]);
    expect(result.changes[0].revision).toBe(0);
    expect(state.initiatives[0].ownerId).toBe("a@example.test");
    AX.confirmImport(result, state, admin);
    expect(state.initiatives[0].ownerId).toBe("b@example.test");
    expect(state.initiatives[0].budget).toBe(budget);
  });
  it("rejects unconfigured and out-of-department email owners", async () => {
    for (const owner of ["unknown@example.test", "other@example.test"]) {
      const { state, users } = fixture();
      const bytes = await modify(
        await AX.exportWorkbook(state, admin),
        owner,
        state.initiatives[0].budget,
      );
      const result = await AX.previewImport(bytes, state, admin, users);
      expect(result.errors.join(" ")).toContain("已配置的 Owner 邮箱");
      expect(state.initiatives[0].ownerId).toBe("a@example.test");
    }
  });
  it("previews and applies a new Initiative from a new business-key row", async () => {
    const { state, users } = fixture();
    const beforeTotal = E.totals(state.initiatives).budget;
    const bytes = await appendInitiative(await AX.exportWorkbook(state, admin));
    const result = await AX.previewImport(bytes, state, admin, users);
    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(0);
    expect(result.creates).toEqual([
      expect.objectContaining({
        row: 3,
        name: "New Initiative",
        department: "MKT",
        budget: 250,
      }),
    ]);
    expect(result.summary.after).toBe(beforeTotal + 250);
    expect(state.initiatives).toHaveLength(1);
    AX.confirmImport(result, state, admin);
    expect(state.initiatives).toHaveLength(2);
    expect(state.initiatives[1]).toEqual(
      expect.objectContaining({
        name: "New Initiative",
        revision: 0,
        status: "editing",
        rows: [],
      }),
    );
  });
  it("accepts the same department Owner for another Initiative Sector", async () => {
    const { state, users } = fixture();
    const bytes = await appendInitiative(
      await AX.exportWorkbook(state, admin),
      { sector: "OTHER", ownerId: "a@example.test" },
    );
    const result = await AX.previewImport(bytes, state, admin, users);
    expect(result.errors).toEqual([]);
    expect(result.creates[0].sector).toBe("OTHER");
  });
  it("rejects duplicate business keys", async () => {
    const { state, users } = fixture();
    const first = await appendInitiative(await AX.exportWorkbook(state, admin));
    const duplicate = await appendInitiative(first);
    const duplicateResult = await AX.previewImport(
      duplicate,
      state,
      admin,
      users,
    );
    expect(duplicateResult.errors.join(" ")).toContain("Initiative 名称重复");
    expect(state.initiatives).toHaveLength(1);
  });
  it("rejects a new Initiative whose resource type and department do not match", async () => {
    const { state, users } = fixture();
    const invalid = await appendInitiative(
      await AX.exportWorkbook(state, admin),
      { resourceType: "ICE Rebate", department: "MKT" },
    );
    const result = await AX.previewImport(invalid, state, admin, users);
    expect(result.errors.join(" ")).toContain("资源类型与部门不匹配");
    expect(state.initiatives).toHaveLength(1);
  });
});
