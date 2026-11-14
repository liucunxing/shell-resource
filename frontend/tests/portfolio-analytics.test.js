import { describe, expect, it } from "vitest";
import {
  concentration,
  dealerDeviations,
  groupSummary,
  portfolioRows,
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
    const result = concentration(portfolioRows(items, dealers), 20);
    expect(result.n).toBe(1);
    expect(result.top[0].id).toBe("B");
    expect(result.amountShare).toBeCloseTo(40);
    expect(result.metricShare).toBeCloseTo(30);
    expect(result.gap).toBeCloseTo(10);
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
