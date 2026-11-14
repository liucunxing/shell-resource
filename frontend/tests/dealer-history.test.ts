import { describe, expect, it } from "vitest";
import {
  historyDisplayValue,
  historyInvestment,
  historyYield,
  initiativeDealers,
  isActiveDealer,
} from "../src/workbench/domain/dealer-history";
import { allocateByHistory } from "../src/workbench/domain/history-allocation";
import E from "../src/workbench/domain/engine.js";

describe("imported distributor history", () => {
  it("combines metadata and metrics only within the initiative sector", () => {
    const rows = initiativeDealers(
      [
        { id: "A", sector: "PCMO", history: { vol2025: 2500 } },
        { id: "A", sector: "CRTO", history: { vol2025: 9999 } },
      ],
      [{ id: "A", sector: "PCMO", status: "active", sd: "East" }],
      "PCMO",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].history?.vol2025).toBe(2500);
    expect(rows[0].sd).toBe("East");
  });

  it("converts L/$ once, preserving null and zero", () => {
    expect(historyDisplayValue(2500)).toBe(2.5);
    expect(historyDisplayValue(0)).toBe(0);
    expect(historyDisplayValue(null)).toBeNull();
    expect(historyDisplayValue(NaN)).toBeNull();
  });

  it("uses imported yield even with zero values or restricted resources", () => {
    const h = {
      yield: 0,
      yield2026Ytd: 7.3,
      resources2025: { MRD: 10 },
      restrictedResources2025: ["Capex"],
    };
    expect(historyYield(h, "2025")).toBe(0);
    expect(historyYield(h, "2026Ytd")).toBe(7.3);
    expect(historyYield({}, "2026Ytd")).toBeNull();
    expect(historyInvestment(h, "2025")).toBeNull();
  });

  it("allocates YTD investment using all four complete source resource values", () => {
    const resources = (amount: number) => ({
      MRD: amount,
      "ICE Rebate": 0,
      "SP&A": 0,
      Capex: 0,
    });
    const rows = ["A", "B", "C"].map((dealerId) => ({ dealerId, amount: 0 }));
    const dealers = [
      { id: "A", history: { resources2026Ytd: resources(1) } },
      { id: "B", history: { resources2026Ytd: resources(2) } },
      { id: "C", history: { resources2026Ytd: { MRD: 100 } } },
    ];
    const result = allocateByHistory(rows, dealers, 10000, "investment2026Ytd");
    expect(result.rows.map((row) => row.amount)).toEqual([33.33, 66.67, 0]);
    expect(result.unavailable).toHaveLength(1);
    expect(historyInvestment({ resources2025: resources(0) }, "2025")).toBe(0);
  });

  it("only offers active dealers while allowing existing closed allocations", () => {
    expect(
      ["active", 1, "1", "closed", 0, "newclose", null].filter((status) =>
        isActiveDealer({ id: "A", status }),
      ),
    ).toEqual(["active", 1, "1"]);
    const item = {
      id: "I",
      sector: "PCMO",
      budget: 100,
      rows: [{ dealerId: "C", amount: 100 }],
      otherBudgets: [],
    };
    const data = {
      distributorDirectory: [{ id: "A", sector: "PCMO", status: "active" }],
      initiatives: [item],
    };
    expect(E.validateInitiative(item, data)).toEqual([]);
    expect(
      E.validateInitiative(
        { ...item, rows: [{ dealerId: "D", amount: 100 }] },
        data,
      ),
    ).not.toEqual([]);
  });
});
