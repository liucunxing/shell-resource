import { describe, expect, it } from "vitest";
import E from "../src/workbench/domain/engine.js";
import { amountInputError } from "../src/workbench/pages/EditorPage.jsx";

const message = "预留金额与已分配金额合计超过项目总预算，请修正后继续。";
const item = (reserve, allocated = 0) => ({
  budget: 200,
  rows: allocated ? [{ dealerId: "D1", amount: allocated, note: "" }] : [],
  otherBudgets: [{ id: "r1", reasonId: "reserve", amount: reserve, note: "预留" }],
});
const data = { dealers: [{ id: "D1" }] };
const reasons = [{ id: "reserve", enabled: true }];

describe("budget exceeded messages", () => {
  it("explains an oversized numeric input even when the amount cannot be saved safely", () => {
    expect(amountInputError("100000000000000", 200)).toBe(message);
    expect(amountInputError("201", 200)).toBe(message);
    expect(amountInputError("200", 200)).toBeNull();
  });

  it("does not label invalid formats as over budget", () => {
    for (const value of ["-1", "abc", "201.001", "", null])
      expect(amountInputError(value, 200)).toBeNull();
    expect(amountInputError("999", null)).toBeNull();
  });

  it("distinguishes exceeding, balancing and underallocation including existing dealer amounts", () => {
    expect(E.completionErrors(item(151, 50), data, reasons)).toContain(message);
    expect(E.completionErrors(item(150, 50), data, reasons)).toEqual([]);
    expect(E.completionErrors(item(149, 50), data, reasons)).toContain("预算未平衡，请处理未解释差额后标记完成。");
  });
});
