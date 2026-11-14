import { describe, expect, it } from "vitest";
import {
  concentration,
  dealerDeviations,
  groupSummary,
  portfolioRows,
  compareVersionGroups,
  initiativeSdFacts,
  versionFluctuation,
} from "../src/workbench/domain/portfolio-analytics.js";

const dealers = [
  { id: "A", sector: "S", sd: "SD-X", history: { c32025: 400 } },
  { id: "B", sector: "S", sd: "SD-X", history: { c32025: 300 } },
  { id: "C", sector: "S", sd: "SD-Y", history: { c32025: 150 } },
  { id: "D", sector: "S", sd: "SD-Y", history: { c32025: 100 } },
  { id: "E", sector: "S", sd: "SD-Y", history: { c32025: 50 } },
  { id: "N", sector: "S", sd: "SD-Y", status: "newclose", history: { c32025: null } },
];
const items = [{ name: "I", resourceType: "MRD", sector: "S", rows: [
  { dealerId: "A", amount: 20 }, { dealerId: "B", amount: 40 },
  { dealerId: "C", amount: 20 }, { dealerId: "D", amount: 10 },
  { dealerId: "E", amount: 10 }, { dealerId: "N", amount: 5 },
] }];

describe("Resource Studio portfolio calculations", () => {
  it("excludes no-history dealers and applies the documented Top 20% ordering", () => {
    const yuanItems = items.map(item => ({ ...item, rows: item.rows.map(row => ({ ...row, amount: row.amount * 10000 })) }));
    const result = concentration(portfolioRows(yuanItems, dealers), 20);
    expect(result.n).toBe(1);
    expect(result.top[0].id).toBe("B");
    expect(result.amountShare).toBeCloseTo(40);
    expect(result.metricShare).toBeCloseTo(30);
    expect(result.gap).toBeCloseTo(10);
  });

  it("uses hundred-yuan ties, output, then business code and rejects zero denominators", () => {
    const rows = [{ id: "z", code: "A", amount: 1001, metric: 40 }, { id: "a", code: "B", amount: 1049, metric: 30 }];
    expect(concentration(rows, 20).top[0].code).toBe("A");
    expect(concentration(rows.map(row => ({ ...row, metric: 0 })), 20)).toBeNull();
    expect(concentration(rows.map(row => ({ ...row, amount: 0 })), 20)).toBeNull();
    const noHistory = portfolioRows(items, dealers.map(dealer => ({ ...dealer, history: { c32025: 0, vol2025: 0 } })));
    expect(concentration(noHistory)).toBeNull();
    expect(dealerDeviations(noHistory)).toEqual([]);
  });

  it("calculates single-dealer over and under allocation gaps", () => {
    const rows = dealerDeviations(portfolioRows(items, dealers));
    expect(rows.find((row) => row.id === "B").gap).toBeCloseTo(10);
    expect(rows.find((row) => row.id === "A").gap).toBeCloseTo(-20);
    expect(rows.some((row) => row.id === "N")).toBe(false);
  });

  it("returns allocated/all counts for SD structure", () => {
    const groups = groupSummary(portfolioRows(items, dealers), dealers);
    expect(groups.find((group) => group.key === "SD-X").allocatedCount).toBe(2);
    expect(groups.find((group) => group.key === "SD-X").totalCount).toBe(2);
    expect(groups.find((group) => group.key === "SD-Y").allocatedCount).toBe(4);
  });
});

describe("V19 selection and comparison", () => {
  it("unions selections including zero allocation without duplicating history", () => {
    const scoped = [
      { id: "1", name: "I1", sector: "S", selected: ["A", "B"], rows: [{ dealerId: "A", amount: 100 }] },
      { id: "2", name: "I2", sector: "S", rows: [{ dealerId: "A", amount: 50 }] },
    ];
    const rows = portfolioRows(scoped, dealers);
    expect(rows.map((row) => [row.id, row.amount])).toEqual([["A", 150], ["B", 0]]);
    const summary = groupSummary(rows, dealers)[0];
    expect(summary.selectedCount).toBe(2);
    expect(summary.allocatedCount).toBe(1);
    expect(summary.metric).toBe(700);
    expect(rows[0].initiativeSources).toHaveLength(2);
    expect(portfolioRows([{ ...scoped[0], selected: [] }], dealers)).toEqual([]);
  });

  it("does not turn unknown history into a zero share or invent PPP/Phasing", () => {
    const summaries = groupSummary(portfolioRows(items, dealers), dealers);
    expect(summaries.every((row) => row.metricShare === null && row.gap === null)).toBe(true);
    expect(summaries[0].pppVol).toBeNull();
    expect(summaries[0].phasing).toBeNull();
  });

  it("deduplicates directory counts and keeps other sectors out of coverage", () => {
    const rows = portfolioRows([{ sector: "S", rows: [{ dealerId: "A", amount: 1 }] }], dealers);
    const group = groupSummary(rows, [...dealers, dealers[0], { id: "Z", sector: "OTHER", sd: "SD-X" }])[0];
    expect(group.totalCount).toBe(2);
  });

  it("uses ratios of totals for aggregate Yield and Phasing", () => {
    const source = [
      { id: "A", sector: "S", sd: "X", history: { c32025: 10, vol2025: 80, contract2025: 100, totalInvestment2025: 10 } },
      { id: "B", sector: "S", sd: "X", history: { c32025: 90, vol2025: 300, contract2025: 400, totalInvestment2025: 30 } },
    ];
    const summary = groupSummary(portfolioRows(items, source).filter((row) => ["A", "B"].includes(row.id)), source)[0];
    expect(summary.historicalYield).toBe(2.5);
    expect(summary.phasing).toBe(0.76);
  });

  const versionItem = (changes = {}) => ({ id: "new-id", initiativeKey: "I", name: "Initiative", ownerId: "Owner", sector: "S", department: "MKT", resourceType: "MRD", budget: 100, workflow: { confirmed: true }, rows: [{ dealerId: "A", amount: 100 }], ...changes });

  it("includes removed dealers and exiting SDs from the source version", () => {
    const previous = [versionItem({ id: "old-id", rows: [{ dealerId: "A", amount: 80 }, { dealerId: "C", amount: 20 }] })];
    const current = [versionItem()];
    const rows = compareVersionGroups(current, previous, dealers, "sd", { sameInitiatives: true });
    expect(rows.find((row) => row.key === "SD-Y")).toMatchObject({ previousAmount: 20, currentAmount: 0, changeRate: -100 });
    expect(rows.find((row) => row.key === "SD-X")).toMatchObject({ previousAmount: 80, currentAmount: 100, changeRate: 25 });
  });

  it("compares each version using its own department attribution", () => {
    const rows = compareVersionGroups([versionItem({ department: "ICE", budget: 120 })], [versionItem()], dealers, "department");
    expect(rows.find((row) => row.key === "MKT")).toMatchObject({ currentBudget: 0, previousBudget: 100, currentAmount: 0, previousAmount: 100 });
    expect(rows.find((row) => row.key === "ICE")).toMatchObject({ currentBudget: 120, previousBudget: 0, changeLabel: "新增" });
    expect(rows.reduce((sum, row) => sum + row.budgetDelta, 0)).toBe(20);
  });

  it("retains a removed dealer's submitted SD even when absent from today's catalog", () => {
    const previous = [versionItem({ rows: [{ dealerId: "OLD", amount: 100, sd: "原组织", rsm: "原RSM" }] })];
    const rows = compareVersionGroups([versionItem()], previous, dealers, "sd", { sameInitiatives: true });
    expect(rows.find((row) => row.key === "原组织")).toMatchObject({ previousAmount: 100, currentAmount: 0, changeRate: -100 });
  });

  it("never presents unconfirmed allocation as zero in management comparisons", () => {
    const rows = compareVersionGroups([versionItem({ workflow: { confirmed: false }, rows: [] })], [versionItem()], dealers, "department", { requireConfirmed: true });
    expect(rows[0]).toMatchObject({ comparable: false, previousAmount: null, currentAmount: null, delta: null, changeLabel: "不可比较" });
    expect(rows[0].previousBudget).toBe(100);
  });

  it("distinguishes new and unavailable baselines", () => {
    expect(versionFluctuation(10, 0)).toMatchObject({ changeLabel: "新增", changeRate: null });
    expect(versionFluctuation(0, 0)).toMatchObject({ changeLabel: "无基期", changeRate: null });
    expect(compareVersionGroups([versionItem()], null, dealers)[0].comparable).toBe(false);
    expect(compareVersionGroups([versionItem()], [], dealers)[0].changeLabel).toBe("新增");
  });

  it("emits every Initiative/SD deviation beyond the selected threshold", () => {
    const scoped = [versionItem({ rows: [{ dealerId: "A", amount: 10 }, { dealerId: "C", amount: 90 }] })];
    const facts = initiativeSdFacts(scoped, dealers, "c3", "2025", 3);
    expect(facts).toHaveLength(2);
    expect(new Set(facts.map((row) => row.direction))).toEqual(new Set(["偏多", "偏少"]));
    expect(facts.every((row) => row.owner === "Owner")).toBe(true);
  });
});
