import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { InsightPanel } from "../src/workbench/pages/InsightPanel.jsx";

vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({
  useWorkbench: () => ({
    state: { initiatives: [], publications: {}, reference: {}, guide: {} },
    data: { dealers: [] },
    identity: {
      key: "owner@example.test",
      email: "owner@example.test",
      ownerId: "owner@example.test",
      role: "owner",
      department: "MKT",
    },
    view: { initiatives: [] },
    apiMode: true,
    mutate: vi.fn(),
    notify: vi.fn(),
  }),
}));

describe("API insight initial render", () => {
  it("renders safely before the remote record arrives", () => {
    const html = renderToString(<InsightPanel />);
    expect(html).toContain("百炼六点分析");
    expect(html).not.toContain("模拟分析");
    expect(html).toContain("生成六点分析");
  });
});
