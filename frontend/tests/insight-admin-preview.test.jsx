import { afterEach, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { InsightPanel } from "../src/workbench/pages/InsightPanel.jsx";
import { generateInsightPreview, getInsightPreviewContext } from "../src/workbench/api.js";

vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({
  useWorkbench: () => ({
    identity: { role: "admin", email: "admin@example.com" }, apiMode: true,
    roles: [
      { email: "ice@example.com", label: "ICE用户", role: "owner" },
      { email: "lead@example.com", label: "负责人", role: "lead" },
    ], notify: vi.fn(),
  }),
}));
afterEach(() => vi.unstubAllGlobals());

it("asks the admin to choose a real user instead of displaying global analysis", () => {
  const html = renderToString(<InsightPanel />);
  expect(html).toContain("模拟用户视角");
  expect(html).toContain("ICE用户");
  expect(html).toContain("lead@example.com");
  expect(html).toContain("请选择用户");
  expect(html).toContain("试用分析");
  expect(html).toContain("不会保存到该用户");
  expect(html).not.toContain("全部已同步项目");
  expect(html).not.toContain("历史实际投入与计划核对");
  expect(html).toMatch(/<button[^>]*disabled=""/);
});

it("passes the target as preview data without switching the login identity", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200,
    json: async () => ({ code: 200, data: { scopes: [] } }) });
  vi.stubGlobal("fetch", fetchMock);
  await getInsightPreviewContext("ice+test@example.com");
  const url = new URL(fetchMock.mock.calls[0][0], "http://test");
  expect(url.pathname).toBe("/api/v1/workbench/insights/preview");
  expect(url.searchParams.get("user_email")).toBe("ice+test@example.com");
  await generateInsightPreview("ice@example.com", "initiative:43", "quadrant");
  const [path, options] = fetchMock.mock.calls[1];
  expect(path).toBe("/api/v1/workbench/insights/preview");
  expect(JSON.parse(options.body)).toEqual({
    user_email: "ice@example.com", scope: "initiative:43", preset_id: "quadrant", planning_year: 2027,
  });
  expect(options.headers["X-User-Email"]).not.toBe("ice@example.com");
});
