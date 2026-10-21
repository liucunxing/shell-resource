import { expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { InsightPanel } from "../src/workbench/pages/InsightPanel.jsx";
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({
  useWorkbench: () => ({
    state: {}, data: {}, identity: { role: "management", key: "management" },
    view: { initiatives: [] }, apiMode: false, mutate: vi.fn(), notify: vi.fn(),
  }),
}));
vi.mock("../src/workbench/domain/engine.js", () => ({ default: {
  departments: () => [],
  previewInsight: () => ({
    items: [{ status: "observed", text: "已发布汇总事实" }],
    evidence: { scope: { id: "global" }, data_version: "v1", datasets: [{
      id: "investment-review", scope_id: "global", period: "2025 全年实际 / 2027 计划", note: "跨年参考", rows: [{
        id: "a", dealer: "测试经销商", sector: "B2B", resource_type: "MKT", historical_actual: 100000, plan: 1000000,
        delta: 900000, multiple: 10, status: "review", reason: "达到复核阈值",
      }],
    }] },
  }),
} }));
it("renders evidence-only management comparison alongside existing preview without an AI result", () => {
  const html = renderToString(<InsightPanel />);
  for (const value of ["各项最新同步结果", "历史实际投入与计划核对", "测试经销商", "10 万元", "100.0 万元", "已发布汇总事实"]) expect(html).toContain(value);
  expect(html).not.toContain("分析解读");
  expect(html).not.toContain("生成分析");
});
