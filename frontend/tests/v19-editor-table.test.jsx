import { describe, expect, it } from "vitest";
import { allocationBalanceLabel, sortedAllocationRows, weightedAllocationYield } from "../src/workbench/pages/EditorPage.jsx";

const rows = [{ dealerId: "a", amount: 2 }, { dealerId: "b", amount: 9 }, { dealerId: "c", amount: 9 }];
const history = (c3, investment, extra = {}) => ({ c32025: c3, c32026Ytd: c3, totalInvestment2025: investment, totalInvestment2026Ytd: investment, ...extra });

describe("V19 allocation table reference and ordering", () => {
  it("computes weighted Yield from summed numerator and denominator, not mean ratios", () => {
    const dealers = new Map([["a", { history: history(100, 10) }], ["b", { history: history(100, 90) }]]);
    expect(weightedAllocationYield(rows.slice(0, 2), dealers, "2025")).toBe(2);
  });
  it("does not turn incomplete source, zero denominator or unknown YTD coverage into a valid average", () => {
    const dealers = new Map([["a", { history: history(0, 0) }], ["b", { history: history(100, null) }]]);
    expect(weightedAllocationYield(rows.slice(0, 1), dealers, "2025")).toBeNull();
    expect(weightedAllocationYield(rows.slice(0, 2), dealers, "2025")).toBeNull();
    dealers.set("a", { history: history(100, 20, { ytdYieldUnavailableReason: "截止月未知" }) });
    expect(weightedAllocationYield(rows.slice(0, 1), dealers, "2026Ytd")).toBeNull();
    expect(weightedAllocationYield([], dealers, "2025")).toBeNull();
  });
  it("sorts a view stably without changing original row identities or the source denominator", () => {
    const before = structuredClone(rows);
    const sorted = sortedAllocationRows(rows, (row) => row.amount, "desc");
    expect(sorted.map((row) => row.dealerId)).toEqual(["b", "c", "a"]);
    expect(sorted[0]).toBe(rows[1]);
    expect(rows).toEqual(before);
    const filtered = sorted.filter((row) => row.dealerId === "b");
    expect(filtered[0].amount / rows.reduce((total, row) => total + row.amount, 0)).toBe(9 / 20);
  });
  it("keeps missing reference values last in either sorting direction", () => {
    const value = (row) => row.dealerId === "b" ? null : row.amount;
    expect(sortedAllocationRows(rows, value, "desc").map((row) => row.dealerId)).toEqual(["c", "a", "b"]);
    expect(sortedAllocationRows(rows, value, "asc").map((row) => row.dealerId)).toEqual(["a", "c", "b"]);
  });
});


describe("allocation balance indicator", () => {
  it("shows shortages and excesses in yuan and hides a balanced amount", () => {
    expect(allocationBalanceLabel(1234.56)).toBe("（少分 1,234.56 元）");
    expect(allocationBalanceLabel(-0.01)).toBe("（多分 0.01 元）");
    expect(allocationBalanceLabel(0)).toBe("");
  });
});
