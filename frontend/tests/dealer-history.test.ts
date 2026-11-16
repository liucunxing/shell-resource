import { describe, expect, it } from "vitest";
import {
  historyDisplayValue,
  historyInvestment,
  historyShareDenominators,
  historyShare,
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
  it("accepts only explicitly active statuses", () => {
    expect(["active", " ACTIVE ", "1", 1].every((status) => isActiveDealer({ id: "a", status }))).toBe(true);
    expect(["closed", "0", 0, "", null, undefined].some((status) => isActiveDealer({ id: "a", status }))).toBe(false);
  });
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
    expect(historyPhasing({ phasing2025: 0.5, vol2025: 2500, contract2025: 5000 }, "2025")).toBe(
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

  it("reads source Phasing independently of Actual, target and their confirmation", () => {
    expect(historyPhasing({ phasing2025: 1 }, "2025")).toBe(1);
    expect(historyPhasing({ phasing2025: 1.17, vol2025: 0, contract2025: null }, "2025")).toBe(1.17);
    expect(historyPhasing({ phasing2026Ytd: 0, vol2026Ytd: null }, "2026Ytd")).toBe(0);
    for (const source of [null, undefined, NaN, Infinity]) {
      expect(historyPhasing({ phasing2026Ytd: source, vol2026Ytd: 3750, contract2026Ytd: 5000 }, "2026Ytd")).toBeNull();
    }
    expect(historyPhasing({ vol2026Ytd: 3750, contract2026Ytd: 5000 }, "2026Ytd")).toBeNull();
  });

  it("weights source ratios by same-year source targets without requiring normalized target confirmation", () => {
    const eligible = [
      { phasing2026Ytd: 0.5, sourceTarget2026Ytd: 2000, vol2026Ytd: 123, contract2026Ytd: null },
      { phasing2026Ytd: 0.75, sourceTarget2026Ytd: 8000, vol2026Ytd: null, contract2026Ytd: null },
    ];
    expect(aggregateHistoryPhasing(eligible, "2026Ytd")).toEqual({ volume: 7000, target: 10000, ratio: 0.7 });
    expect(aggregateHistoryPhasing([...eligible,
      { phasing2026Ytd: 99, sourceTarget2026Ytd: 0 },
      { phasing2026Ytd: 99, sourceTarget2026Ytd: -1000 },
    ], "2026Ytd")).toEqual({ volume: 7000, target: 10000, ratio: 0.7 });
    for (const unknown of [
      { phasing2026Ytd: 0.5, sourceTarget2026Ytd: null, contract2026Ytd: 5000 },
      { phasing2026Ytd: null, sourceTarget2026Ytd: 5000 },
    ]) {
      expect(aggregateHistoryPhasing([...eligible, unknown], "2026Ytd")).toEqual({ volume: null, target: null, ratio: null });
    }
    expect(aggregateHistoryPhasing([{ phasing2026Ytd: 1.17 }], "2026Ytd").ratio).toBe(1.17);
    expect(aggregateHistoryPhasing([], "2026Ytd").ratio).toBeNull();
    expect(aggregateHistoryPhasing([
      { phasing2025: 0, sourceTarget2025: 100 },
      { phasing2025: 1, sourceTarget2025: 100 },
    ], "2025").ratio).toBe(0.5);
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


describe("history shares with partially missing source rows", () => {
  const rows = [
    { vol2025: 100, c32025: 200, contract2025: 300, totalInvestment2025: 400 },
    { vol2025: null, c32025: null, contract2025: null, totalInvestment2025: null },
    { vol2025: 0, c32025: 0, contract2025: 0, totalInvestment2025: 0 },
    { vol2025: 300, c32025: 600, contract2025: 900, totalInvestment2025: 1200 },
  ];
  it("keeps all four valid share columns available when another dealer is missing", () => {
    const totals = historyShareDenominators(rows, "2025");
    expect(totals).toEqual({ vol: 400, c3: 800, contract: 1200, investment: 1600 });
    for (const [key, field] of [["vol", "vol2025"], ["c3", "c32025"], ["contract", "contract2025"], ["investment", "totalInvestment2025"]] as const) {
      expect(historyShare(rows[0][field], totals[key])).toBe(25);
      expect(historyShare(rows[1][field], totals[key])).toBeNull();
      expect(historyShare(rows[2][field], totals[key])).toBe(0);
      expect(historyShare(rows[3][field], totals[key])).toBe(75);
    }
  });
  it("does not manufacture a denominator for all missing, invalid, or non-positive totals", () => {
    expect(historyShareDenominators([undefined, rows[1]], "2025")).toEqual({ vol: null, c3: null, contract: null, investment: null });
    expect(historyShareDenominators([rows[2]], "2025")).toEqual({ vol: 0, c3: 0, contract: 0, investment: 0 });
    expect(historyShare(0, 0)).toBeNull();
    expect(historyShare(10, -10)).toBeNull();
    expect(historyShare(Infinity, 100)).toBeNull();
    expect(historyShareDenominators([{ vol2025: NaN, contract2025: Infinity }], "2025").contract).toBeNull();
  });
  it("keeps the full-selection denominator when sorting, filtering or paging a display", () => {
    const totals = historyShareDenominators(rows, "2025");
    const displayed = [...rows].reverse().filter(row => row.vol2025 != null).slice(0, 1);
    expect(historyShare(displayed[0].vol2025, totals.vol)).toBe(75);
    expect(historyShareDenominators(rows, "2026Ytd").vol).toBeNull();
    expect(rows[0].vol2025).toBe(100);
  });
});
