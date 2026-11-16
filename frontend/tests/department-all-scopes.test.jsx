import { describe, expect, it } from "vitest";
import { combineDepartmentReviews } from "../src/workbench/pages/DepartmentReviewPage.jsx";

describe("全部部门查看", () => {
  it("combines each scope without treating incomplete departments as submitted", () => {
    const combined = combineDepartmentReviews([
      { version: { revision: 5 }, submitted: 2, total: 2, confirmed: 2, items: [{ id: 1, sector: "PCMO", department: "MKT" }] },
      { version: { revision: 5 }, submitted: 1, total: 3, confirmed: 1, items: [{ id: 2, sector: "B2B", department: "ICE" }] },
    ]);
    expect(combined).toMatchObject({ submitted: 3, total: 5, confirmed: false });
    expect(combined.items.map((item) => item.id)).toEqual([1, 2]);
  });
  it("refuses to combine results from different version revisions", () => {
    expect(() => combineDepartmentReviews([{ version: { revision: 1 } }, { version: { revision: 2 } }])).toThrow("请重试");
  });
});
