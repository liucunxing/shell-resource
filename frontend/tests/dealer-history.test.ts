import { describe, expect, it } from "vitest";
import {
  historyDisplayValue,
  historyInvestment,
  historyYield,
  historyPhasing,
  aggregateHistoryPhasing,
  historyYoyLabel,
  configuredYtdLabel,
  initiativeDealers,
  isActiveDealer,
} from "../src/workbench/domain/dealer-history";
import { allocateByHistory } from "../src/workbench/domain/history-allocation";
import E from "../src/workbench/domain/engine.js";

describe("imported distributor history", () => {
  it("keeps an expired source coverage confirmation visibly unknown", () => {
    expect(configuredYtdLabel(null)).toBe("2026 YTD（截止月待确认）");
    expect(configuredYtdLabel(9)).toBe("2026 YTD（1–9月）");
    expect(configuredYtdLabel()).toBe("2026 YTD（1–10月）");
  });
  it("uses public totals independently of expense-column permission", () => {
    const history = {
      totalInvestment2025: 120,
      resources2025: { MRD: 10 },
      restrictedResources2025: ["Capex"],
    };
    expect(historyInvestment(history, "2025")).toBe(120);
    expect(
      historyInvestment({ ...history, totalInvestment2025: null }, "2025"),
    ).toBeNull();
    expect(
      historyInvestment({ ...history, totalInvestment2025: 0 }, "2025"),
    ).toBe(0);
    expect(historyInvestment({ totalInvestment2026Ytd: 80 }, "2026Ytd")).toBe(
      80,
    );
  });

  it("suppresses YTD Yield when coverage cannot be aligned", () => {
    expect(
      historyYield(
        { yield2026Ytd: 12, ytdYieldUnavailableReason: "月份未提供" },
        "2026Ytd",
      ),
    ).toBeNull();
  });

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

  it("calculates Yield from positive public totals without exposing protected expense details", () => {
    const h = {
      c32025: 240,
      totalInvestment2025: 120,
      yield: 99,
      resources2025: { MRD: 10 },
      restrictedResources2025: ["Capex"],
    };
    expect(historyYield(h, "2025")).toBe(2);
    expect(historyYield({ ...h, c32025: 0 }, "2025")).toBeNull();
    expect(historyYield({ ...h, c32025: -10 }, "2025")).toBeNull();
    expect(
      historyYield({ ...h, totalInvestment2025: null }, "2025"),
    ).toBeNull();
    expect(historyYield({ ...h, totalInvestment2025: -1 }, "2025")).toBeNull();
  });

  it("applies V2 contract, YoY and display-month rules without assuming coverage", () => {
    expect(historyPhasing({ vol2025: 2500, contract2025: 5000 }, "2025")).toBe(
      0.5,
    );
    expect(
      historyPhasing({ vol2025: 2500, contract2025: 0 }, "2025"),
    ).toBeNull();
    expect(historyPhasing({ vol2025: 2500 }, "2025")).toBeNull();
    expect(historyYoyLabel({ vol2024: 0, vol2025: 100 }, "vol")).toBe("无基期");
    expect(historyYoyLabel({ c32024: -1, c32025: 100 }, "c3")).toBe("无基期");
    expect(historyYoyLabel({ vol2024: 100, vol2025: 125 }, "vol")).toBe("25%");
    expect(historyYoyLabel({ vol2025: 125 }, "vol")).toBe("—");
    expect(configuredYtdLabel(9)).toBe("2026 YTD（1–9月）");
    expect(configuredYtdLabel()).toBe("2026 YTD（1–10月）");
  });

  it("uses only the confirmed same-period YTD target and preserves zero versus missing values", () => {
    const history = {
      vol2025: 8000,
      contract2025: 10000,
      vol2026Ytd: 3750,
      contract2026Ytd: 5000,
    };
    expect(historyPhasing(history, "2026Ytd")).toBe(0.75);
    expect(historyDisplayValue(history.contract2026Ytd)).toBe(5);
    expect(historyDisplayValue(0)).toBe(0);
    expect(historyDisplayValue(null)).toBeNull();
    for (const target of [0, -1, null, undefined, NaN, Infinity]) {
      expect(historyPhasing({ ...history, contract2026Ytd: target }, "2026Ytd")).toBeNull();
    }
    expect(historyPhasing({ ...history, vol2026Ytd: 0 }, "2026Ytd")).toBe(0);
    expect(historyPhasing({ ...history, vol2026Ytd: null }, "2026Ytd")).toBeNull();
    const unconfirmed = {
      vol2026Ytd: 3750,
      contract2025: 10000,
      target_2026: 5000,
      phasing_2026: 0.75,
    };
    expect(historyPhasing(unconfirmed, "2026Ytd")).toBeNull();
  });

  it("pairs aggregate Phasing with positive targets and propagates unknown targets or volumes", () => {
    const eligible = [
      { vol2026Ytd: 1000, contract2026Ytd: 2000 },
      { vol2026Ytd: 6000, contract2026Ytd: 8000 },
    ];
    expect(aggregateHistoryPhasing(eligible, "2026Ytd")).toEqual({ volume: 7000, target: 10000, ratio: 0.7 });
    expect(aggregateHistoryPhasing([
      ...eligible,
      { vol2026Ytd: 50000, contract2026Ytd: 0 },
      { vol2026Ytd: 10000, contract2026Ytd: -1000 },
    ], "2026Ytd")).toEqual({ volume: 7000, target: 10000, ratio: 0.7 });
    for (const unknown of [
      { vol2026Ytd: 1000, contract2026Ytd: null },
      { vol2026Ytd: null, contract2026Ytd: 5000 },
      { vol2026Ytd: null, contract2026Ytd: 0 },
    ]) {
      expect(aggregateHistoryPhasing([...eligible, unknown], "2026Ytd")).toEqual({ volume: null, target: null, ratio: null });
    }
    expect(aggregateHistoryPhasing([{ vol2026Ytd: 1000, contract2026Ytd: 0 }], "2026Ytd").ratio).toBeNull();
    expect(aggregateHistoryPhasing([], "2026Ytd").ratio).toBeNull();
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
      { id: "A", history: { vol2026Ytd: 1, resources2026Ytd: resources(1) } },
      { id: "B", history: { vol2026Ytd: 1, resources2026Ytd: resources(2) } },
      { id: "C", history: { resources2026Ytd: { MRD: 100 } } },
    ];
    const result = allocateByHistory(rows, dealers, 10000, "investment2026Ytd");
    expect(result.rows.map((row) => row.amount)).toEqual([33, 67, 0]);
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
