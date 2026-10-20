import { describe, expect, it } from "vitest";
import { allocateByHistory } from "../src/workbench/domain/history-allocation";

const rows = ["A", "B", "C", "D"].map((dealerId) => ({ dealerId, amount: 99, note: dealerId }));
const dealers = (values: (number | null)[]) => values.map((value, index) => ({
  id: rows[index].dealerId, name: rows[index].dealerId,
  history: { c32025: value, vol2025: value },
}));

describe("historical proportional allocation", () => {
  it("uses the Initiative sector instead of overwriting with another sector's history", () => {
    const source = [
      { id: "A", sector: "PCMO", history: { c32025: 1 } },
      { id: "B", sector: "PCMO", history: { c32025: 3 } },
      { id: "A", sector: "CRTO", history: { c32025: 900 } },
    ];
    const result = allocateByHistory(rows.slice(0, 2), source, 10000, "c32025", "PCMO");
    expect(result.rows.map((row) => row.amount)).toEqual([25, 75]);
    expect(allocateByHistory(rows.slice(0, 2), source, 10000, "c32025", "CRTO").rows.map((row) => row.amount)).toEqual([100, 0]);
  });
  it("allocates the full available budget to positive dealers and zeroes missing or zero dealers", () => {
    const result = allocateByHistory(rows, dealers([1, 2, 3, 0]), 10000, "c32025");
    expect(result.rows.map((row) => row.amount)).toEqual([16.67, 33.33, 50, 0]);
    expect(result.unavailable).toEqual(["D（D）"]);
    expect(result.rows[0].note).toBe("A");
    expect(rows[3].amount).toBe(99);
  });

  it("accepts small positive values and never gives rounding cents to a dealer without history", () => {
    const result = allocateByHistory(rows, dealers([null, 0.001, 0.001, 0.001]), 2, "vol2025");
    expect(result.rows.map((row) => row.amount)).toEqual([0, 0.01, 0.01, 0]);
  });

  it("allows all missing, non-finite or non-positive history and leaves the budget unallocated", () => {
    const result = allocateByHistory(rows, dealers([null, 0, -1, NaN]), 10000, "c32025");
    expect(result.rows.every((row) => row.amount === 0)).toBe(true);
    expect(result.unavailable).toHaveLength(4);
    expect(result.hasHistory).toBe(false);
  });

  it("handles absent dealers, empty selections and zero available budget", () => {
    expect(allocateByHistory(rows, [], 10000, "c32025").rows.every((row) => row.amount === 0)).toBe(true);
    expect(allocateByHistory([], [], 10000, "c32025").rows).toEqual([]);
    expect(allocateByHistory(rows, dealers([1, 1, 1, 1]), 0, "vol2025").rows.every((row) => row.amount === 0)).toBe(true);
  });

  it("keeps negative available budgets invalid", () => {
    expect(() => allocateByHistory(rows, [], -1, "c32025")).toThrow();
  });
});
