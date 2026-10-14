import { describe, expect, it } from "vitest";
import E from "../src/workbench/domain/engine.js";
import AX from "../src/workbench/domain/admin-excel.js";
import data from "../src/workbench/domain/demo-data.json";
import { ownerSectorOptions, userDepartmentOptions } from "../src/workbench/pages/AdminUsersPanel.jsx";

const identity = { role: "owner", apiMode: true, department: ["MKT", "ICE"], ownerId: "multi@example.test" };
function fixture() {
  const state = E.createState(data, "working");
  for (const item of state.initiatives) item.ownerId = identity.ownerId;
  return state;
}

describe("multiple department permissions", () => {
  it("normalizes old single-value users and requires exact department membership", () => {
    expect(E.departments({ department: "mkt" })).toEqual(["MKT"]);
    expect(E.hasDepartment(identity, "ICE")).toBe(true);
    expect(E.hasDepartment(identity, "CAPEX")).toBe(false);
    expect(E.hasDepartment({ department: "MKT,ICE" }, "MKT")).toBe(false);
    expect(() => E.selectView(fixture(), { ...identity, department: [] })).toThrow();
  });
  it("shows both authorized departments once while excluding an unauthorized department", () => {
    const state = fixture();
    const view = E.selectView(state, identity);
    expect(new Set(view.initiatives.map((item) => item.department))).toEqual(new Set(["MKT", "ICE"]));
    expect(new Set(view.initiatives.map((item) => item.id)).size).toBe(view.initiatives.length);
    expect(Object.keys(view.summaries)).toEqual(["MKT", "ICE"]);
    const lead = E.selectView(state, { ...identity, role: "lead" });
    expect(lead.initiatives.length).toBe(view.initiatives.length);
  });
  it("accepts a multi-department Owner for the second department during Excel confirmation", async () => {
    const state = fixture();
    state.initiatives = state.initiatives.filter((item) => item.department === "ICE");
    const admin = { role: "admin", apiMode: true };
    const bytes = await AX.exportWorkbook(state, admin);
    const result = await AX.previewImport(bytes, state, admin, [{ ...identity, email: identity.ownerId }]);
    expect(result.errors).toEqual([]);
    const denied = await AX.previewImport(bytes, state, admin, [{ ...identity, department: ["MKT"], email: identity.ownerId }]);
    expect(denied.errors.join(" ")).toContain("Owner");
  });
  it("requires Owner business-line coverage in every selected department", () => {
    expect(ownerSectorOptions(["MKT", "ICE"], { MKT: ["PCMO", "B2B"], ICE: ["PCMO"] })).toEqual(["PCMO"]);
    expect(ownerSectorOptions(["MKT", "ICE"], { MKT: ["PCMO"] })).toEqual([]);
    expect(userDepartmentOptions(["MKT", "ICE"])).toEqual(["MKT", "ICE", "CAPEX"]);
  });
});
