import { describe, expect, it } from "vitest";
import {
  filterDealers,
  uniqueDealersByCode,
} from "../src/workbench/pages/EditorPage.jsx";

const dealers = [
  { id: "10208074", name: "中海壳牌石油化工有限公司" },
  { id: "12301298", name: "云南贝灵经贸有限公司" },
  { id: "12301298", name: "云南贝灵经贸有限公司" },
  { id: "13151020", name: "盐城车之润商贸有限公司" },
  { id: "13058156", name: "中石化中海船舶燃料供应有限公司上海物资分公司" },
  { id: "未知", name: "未知" },
];

describe("dealer picker search", () => {
  it("deduplicates source rows by distributor code", () => {
    expect(uniqueDealersByCode(dealers)).toHaveLength(5);
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
});
