import { describe, expect, it } from "vitest";
import { selectAllFilteredDealers } from "../src/workbench/pages/EditorPage.jsx";

describe("select all filtered dealers", () => {
  it("adds every filtered dealer across pages and preserves existing allocations and other selections", () => {
    const rows = [{ dealerId: "1", amount: 500, note: "保留" }, { dealerId: "outside", amount: 20 }];
    const dealers = Array.from({ length: 42 }, (_, i) => ({ id: String(i + 1) }));
    const result = selectAllFilteredDealers(rows, dealers);
    expect(result).toHaveLength(43);
    expect(result[0]).toEqual(rows[0]);
    expect(result[1]).toEqual(rows[1]);
    expect(result.at(-1)).toEqual({ dealerId: "42", amount: 0, note: "" });
    expect(selectAllFilteredDealers(result, dealers)).toEqual(result);
  });
});
