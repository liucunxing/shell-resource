import { describe, expect, it } from "vitest";
import { allocateByHistory } from "../src/workbench/domain/history-allocation";

const rows = ["A", "B", "C", "D"].map((dealerId) => ({
  dealerId,
  amount: 99,
  note: dealerId,
}));
const dealers = (values: (number | null)[]) =>
  values.map((value, index) => ({
    id: rows[index].dealerId,
    name: rows[index].dealerId,
    history: { c32025: value, vol2025: value },
  }));

describe("historical proportional allocation", () => {
  it("uses directory names for dealers missing B2B history without borrowing another sector's weights", () => {
    const result = allocateByHistory(
      rows.slice(0, 3),
      [
        { id: "A", sector: "B2B", history: { c32025: 1 } },
        { id: "C", name: "旧名称", sector: "PCMO", history: { c32025: 100 } },
      ],
      10000,
      "c32025",
      "B2B",
      [
        { id: "B", name: "目录经销商甲", sector: "B2B" },
        { id: "C", name: "目录经销商乙", sector: "B2B" },
      ],
    );
    expect(result.rows.map((row) => row.amount)).toEqual([100, 0, 0]);
    expect(result.unavailable).toEqual([
      "目录经销商甲（B）",
      "目录经销商乙（C）",
    ]);
  });

  it("does not repeat the code as a name when no source provides a name", () => {
    const result = allocateByHistory(
      rows.slice(0, 1),
      [],
      10000,
      "c32025",
      "B2B",
    );
    expect(result.unavailable).toEqual(["名称未提供（A）"]);
  });
  it("uses the Initiative sector instead of overwriting with another sector's history", () => {
    const source = [
      { id: "A", sector: "PCMO", history: { c32025: 1 } },
      { id: "B", sector: "PCMO", history: { c32025: 3 } },
      { id: "A", sector: "CRTO", history: { c32025: 900 } },
    ];
    const result = allocateByHistory(
      rows.slice(0, 2),
      source,
      10000,
      "c32025",
      "PCMO",
    );
    expect(result.rows.map((row) => row.amount)).toEqual([25, 75]);
    expect(
      allocateByHistory(
        rows.slice(0, 2),
        source,
        10000,
        "c32025",
        "CRTO",
      ).rows.map((row) => row.amount),
    ).toEqual([100, 0]);
  });
  it("allocates the full available budget to positive dealers and zeroes missing or zero dealers", () => {
    const result = allocateByHistory(
      rows,
      dealers([1, 2, 3, 0]),
      10000,
      "c32025",
    );
    expect(result.rows.map((row) => row.amount)).toEqual([17, 33, 50, 0]);
    expect(result.unavailable).toEqual(["D（D）"]);
    expect(result.rows[0].note).toBe("A");
    expect(rows[3].amount).toBe(99);
  });

  it("accepts small positive values and never gives rounding yuan to a dealer without history", () => {
    const result = allocateByHistory(
      rows,
      dealers([null, 0.001, 0.001, 0.001]),
      200,
      "vol2025",
    );
    expect(result.rows.map((row) => row.amount)).toEqual([0, 1, 1, 0]);
  });

  it("allows all missing, non-finite or non-positive history and leaves the budget unallocated", () => {
    const result = allocateByHistory(
      rows,
      dealers([null, 0, -1, NaN]),
      10000,
      "c32025",
    );
    expect(result.rows.every((row) => row.amount === 0)).toBe(true);
    expect(result.unavailable).toHaveLength(4);
    expect(result.hasHistory).toBe(false);
  });

  it("handles absent dealers, empty selections and zero available budget", () => {
    expect(
      allocateByHistory(rows, [], 10000, "c32025").rows.every(
        (row) => row.amount === 0,
      ),
    ).toBe(true);
    expect(allocateByHistory([], [], 10000, "c32025").rows).toEqual([]);
    expect(
      allocateByHistory(rows, dealers([1, 1, 1, 1]), 0, "vol2025").rows.every(
        (row) => row.amount === 0,
      ),
    ).toBe(true);
  });

  it("matches the V2.0 largest-remainder example in whole yuan", () => {
    const ids = ["A", "B", "C", "D", "E"];
    const weights = [400, 300, 150, 100, 50];
    const source = ids.map((id, index) => ({
      id,
      history: { c32025: weights[index] },
    }));
    const output = allocateByHistory(
      ids.map((dealerId) => ({ dealerId, amount: 0 })),
      source,
      100100,
      "c32025",
    );
    expect(output.rows.map((row) => row.amount)).toEqual([
      401, 300, 150, 100, 50,
    ]);
    expect(() =>
      allocateByHistory(rows, dealers([1, 1, 1, 1]), 1, "c32025"),
    ).toThrow("整数元");
  });

  it("keeps negative available budgets invalid", () => {
    expect(() => allocateByHistory(rows, [], -1, "c32025")).toThrow();
  });
});

it("does not allocate investment weights to new dealers without output history", () => {
  const source = [
    { id: "A", history: { vol2025: 0, c32025: 0, totalInvestment2025: 100 } },
    { id: "B", history: { vol2025: 1, c32025: 0, totalInvestment2025: 200 } },
  ];
  const onlyNew = allocateByHistory(
    rows.slice(0, 1),
    source,
    100100,
    "investment2025",
  );
  expect(onlyNew.hasHistory).toBe(false);
  expect(onlyNew.rows[0].amount).toBe(0);
  expect(
    allocateByHistory(
      rows.slice(0, 2),
      source,
      100100,
      "investment2025",
    ).rows.map((row) => row.amount),
  ).toEqual([0, 1001]);
});
