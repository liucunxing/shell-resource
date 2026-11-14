import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mock = vi.hoisted(() => ({ context: null }));
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({ useWorkbench: () => mock.context }));
import { HomePage } from "../src/workbench/pages/OverviewPages.jsx";

it("includes all configured reserve reasons in the Owner budget summary", () => {
  mock.context = {
    state: { planningVersion: { id: "202701", name: "当前规划", published: true, open: true }, planningVersions: [] },
    view: { initiatives: [{ id: "1", name: "项目", sector: "PCMO", department: "MKT", budget: 100000,
      rows: [{ dealerId: "D1", amount: 60000 }], otherBudgets: [{ id: "R1", reasonId: "reserve", amount: 10000 }, { id: "R2", reasonId: "custom-reason", amount: 30000 }] }] },
    navigate: vi.fn(), selectPlanningVersion: vi.fn(), apiMode: true,
  };
  const html = renderToStaticMarkup(<HomePage />);
  expect(html).toContain("4.0 万");
  expect(html).toContain("当前范围已配平");
  expect(html).not.toContain("202701 · 业务目标校准");
});
