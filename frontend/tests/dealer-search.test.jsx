import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  filterDealers,
  toggleDealerSelection,
  uniqueDealersByCode,
  MissingHistoryNotice,
} from "../src/workbench/pages/EditorPage.jsx";
import E from "../src/workbench/domain/engine.js";

const dealers = [
  { id: "10208074", name: "中海壳牌石油化工有限公司" },
  { id: "12301298", name: "云南贝灵经贸有限公司" },
  { id: "12301298", name: "云南贝灵经贸有限公司" },
  { id: "13151020", name: "盐城车之润商贸有限公司" },
  { id: "13058156", name: "中石化中海船舶燃料供应有限公司上海物资分公司" },
  { id: "未知", name: "未知" },
];

describe("dealer picker search", () => {
  it("renders zero-allocation dealer names as a vertical list", () => {
    const html = renderToStaticMarkup(<MissingHistoryNotice metricLabel="2025 C3"
      unavailable={["经销商甲（10392457）", "经销商乙（11146913）"]} hasHistory={true} />);
    expect(html).toContain("<li>经销商甲（10392457）</li><li>经销商乙（11146913）</li>");
    expect(html).not.toContain("全部经销商均无量");
  });

  it("keeps the all-zero warning and hides the notice when everyone has history", () => {
    expect(renderToStaticMarkup(<MissingHistoryNotice metricLabel="2025 C3"
      unavailable={["经销商甲（10392457）"]} hasHistory={false} />)).toContain("全部经销商均无量");
    expect(renderToStaticMarkup(<MissingHistoryNotice metricLabel="2025 C3"
      unavailable={[]} hasHistory={true} />)).toBe("");
  });
  it("deduplicates source rows by distributor code", () => {
    expect(uniqueDealersByCode(dealers)).toHaveLength(5);
  });

  it("keeps all sector labels when a distributor belongs to multiple sectors", () => {
    expect(uniqueDealersByCode([
      { id: "D1", sector: "PCMO" }, { id: "D1", sector: "CRTO" }, { id: "D1", sector: "PCMO" },
    ])).toEqual([{ id: "D1", sector: "PCMO / CRTO" }]);
  });

  it("matches only the distributor code field", () => {
    const result = filterDealers(uniqueDealersByCode(dealers), "1020", "");
    expect(result.map((dealer) => dealer.id)).toEqual(["10208074", "13151020"]);
  });

  it("matches only the distributor name field", () => {
    const result = filterDealers(uniqueDealersByCode(dealers), "", "中海");
    expect(result.map((dealer) => dealer.id)).toEqual(["10208074", "13058156"]);
  });

  it("combines code and name filters with AND semantics", () => {
    const result = filterDealers(uniqueDealersByCode(dealers), "1020", "中海");
    expect(result.map((dealer) => dealer.id)).toEqual(["10208074"]);
  });

  it("supports selecting and deselecting multiple dealers", () => {
    expect(toggleDealerSelection(["10208074"], "12301298")).toEqual([
      "10208074", "12301298",
    ]);
    expect(toggleDealerSelection(["10208074", "12301298"], "10208074")).toEqual([
      "12301298",
    ]);
  });

  it("accepts a new Databricks directory dealer before it has history data", () => {
    const errors = E.validateInitiative(
      {
        budget: 0,
        rows: [{ dealerId: "D-NEW", amount: 0, note: "" }],
        otherBudgets: [],
      },
      { dealers: [], distributorDirectory: [{ id: "D-NEW", name: "New Dealer" }] },
    );
    expect(errors).toEqual([]);
  });
});
