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
});
