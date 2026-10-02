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
    { email: "a@example.test", role: "owner", department: "MKT", sector: null },
    { email: "b@example.test", role: "owner", department: "MKT", sector: null },
    { email: "other@example.test", role: "owner", department: "ICE" },
  ];
  return { state, users };
}
async function modify(bytes, owner, budget) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.getWorksheet("预算与归属");
  sheet.getCell("F2").value = owner;
  sheet.getCell("G2").value = budget;
  return book.xlsx.writeBuffer();
}
async function appendInitiative(bytes, values = {}) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.getWorksheet("预算与归属");
  sheet.addRow([
    values.id ?? "",
    values.name ?? "New Initiative",
    values.sector ?? "PCMO",
    values.resourceType ?? "MRD",
    values.department ?? "MKT",
    values.ownerId ?? "a@example.test",
    values.budget ?? 250,
    values.revision ?? "",
    values.status ?? "",
  ]);
  return book.xlsx.writeBuffer();
}
describe("API administrator Excel round trip", () => {
  it("accepts exported email owners and initial revision zero unchanged", async () => {
    const { state, users } = fixture();
    const bytes = await AX.exportWorkbook(state, admin);
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
  it("previews and applies a new Initiative from a blank-ID row", async () => {
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
  it("rejects unknown nonblank IDs and duplicate new business keys", async () => {
    const { state, users } = fixture();
    const unknown = await appendInitiative(
      await AX.exportWorkbook(state, admin),
      { id: "missing-id" },
    );
    const unknownResult = await AX.previewImport(unknown, state, admin, users);
    expect(unknownResult.errors.join(" ")).toContain("新增项目请将编号留空");

    const first = await appendInitiative(await AX.exportWorkbook(state, admin));
    const duplicate = await appendInitiative(first);
    const duplicateResult = await AX.previewImport(
      duplicate,
      state,
      admin,
      users,
    );
    expect(duplicateResult.errors.join(" ")).toContain("Initiative 名称已存在");
    expect(state.initiatives).toHaveLength(1);
  });
});
