import { describe, expect, it } from "vitest";
import E from "../src/workbench/domain/engine.js";

const owner = { role: "owner", department: "MKT", ownerId: "MKT-1" };
const data = { dealers: [
  { id: "a", sector: "PCMO", status: "active" },
  { id: "b", sector: "PCMO", status: "active" },
  { id: "closed", sector: "PCMO", status: "closed" },
  { id: "other-sector", sector: "B2B", status: "active" },
] };
const createState = () => ({
  departments: { MKT: { status: "collecting", versions: [], comments: [] } },
  audit: [],
  initiatives: [{ id: "i", department: "MKT", ownerId: "MKT-1", sector: "PCMO", budget: 100,
    revision: 0, rows: [], otherBudgets: [], workflow: { editable: true } }],
});

describe("existing dealer selection", () => {
  it("selects zero-amount dealers from an empty plan and supports reselection without reallocating", () => {
    const state = createState();
    const update = rows => E.updateInitiative(state, "i", { rows }, owner, data);
    update([{ dealerId: "a", amount: 0, note: "" }]);
    expect(state.initiatives[0].rows).toHaveLength(1);
    update([{ dealerId: "a", amount: 50, note: "keep" }, { dealerId: "b", amount: 0, note: "" }]);
    update([{ dealerId: "a", amount: 50, note: "keep" }]);
    update([...state.initiatives[0].rows, { dealerId: "b", amount: 0, note: "" }]);
    expect(state.initiatives[0].rows[0]).toEqual({ dealerId: "a", amount: 50, note: "keep" });
    expect(E.totals(state.initiatives).gap).toBe(50);
  });
  it.each(["closed", "other-sector", "missing"])("rejects invalid selection %s without adding it", dealerId => {
    const state = createState();
    expect(() => E.updateInitiative(state, "i", { rows: [{ dealerId, amount: 0 }] }, owner, data)).toThrow("经销商不存在");
    expect(state.initiatives[0].rows).toEqual([]);
  });
  it("keeps submitted and read-only preview plans locked", () => {
    const state = createState();
    state.initiatives[0].workflow.editable = false;
    expect(() => E.updateInitiative(state, "i", { rows: [{ dealerId: "a", amount: 0 }] }, owner, data)).toThrow();
    state.initiatives[0].workflow.editable = true;
    expect(() => E.updateInitiative(state, "i", { rows: [{ dealerId: "a", amount: 0 }] }, { ...owner, preview: { readOnly: true } }, data)).toThrow();
  });
});
