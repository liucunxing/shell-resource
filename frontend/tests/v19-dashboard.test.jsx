import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
// Tooltip portals are not mounted by SSR; expose their content to verify that
// source coverage is propagated into the explanation, not the compact tab label.
vi.mock("../src/workbench/pages/MetricHelp", () => ({
  MetricHelp: ({ children }) => (
    <aside data-testid="metric-explanation">{children}</aside>
  ),
}));
const mock = vi.hoisted(() => ({ context: null }));
vi.mock("../src/workbench/WorkbenchContext.jsx", () => ({
  useWorkbench: () => mock.context,
}));
import { HomePage } from "../src/workbench/pages/OverviewPages.jsx";
import {
  V19ExecutiveHealth,
  executiveConcentrationGroups,
} from "../src/workbench/pages/V19ExecutiveHealth.jsx";
import {
  V19BudgetOverview,
  CumulativeChart,
  V19Health,
  V19Stack,
  initiativeColor,
  orderedResourceTypes,
} from "../src/workbench/pages/V19PortfolioVisuals.jsx";

const healthItems = [
  {
    id: "copy-1",
    initiativeKey: "I1",
    name: "集中项目",
    sector: "PCMO",
    resourceType: "MRD",
    budget: 100,
    rows: [
      { dealerId: "D1", amount: 90 },
      { dealerId: "D2", amount: 10 },
    ],
    otherBudgets: [],
  },
];
const healthDealers = [
  {
    id: "D1",
    name: "经销商一",
    sector: "PCMO",
    history: { c32025: 25, vol2025: 60 },
  },
  {
    id: "D2",
    name: "经销商二",
    sector: "PCMO",
    history: { c32025: 75, vol2025: 40 },
  },
];

it("shows compact period choices without a coverage tooltip in the health and stacked views", () => {
  for (const month of [9, null]) {
    const html = renderToStaticMarkup(
      <V19Health
        items={healthItems}
        dealers={healthDealers}
        ytdCutoffMonth={month}
      />,
    );
    expect(html).not.toContain("不自动年化");
    expect(html.split(">2025 全年</button>").length - 1).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("1–10月");
    expect(html).toContain(">2026 YTD</button>");
    expect(html).not.toMatch(/>2026 YTD（[^<]*<\/button>/);
  }
});

it("keeps the V19 resource order with custom types after the four standard categories", () => {
  const source = ["Other", "Capex", "SP&A", "MRD", "ICE Rebate", "MRD"];
  expect(orderedResourceTypes(source)).toEqual([
    "ICE Rebate",
    "MRD",
    "SP&A",
    "Capex",
    "Other",
  ]);
  const items = source.map((resourceType, index) => ({
    ...healthItems[0],
    id: String(index),
    resourceType,
    workflow: { confirmed: true },
  }));
  expect(
    executiveConcentrationGroups(items, healthDealers, "c3", "2025").map(
      (group) => group.type,
    ),
  ).toEqual(["ICE Rebate", "MRD", "SP&A", "Capex", "Other"]);
});

it("uses the configured red and yellow concentration thresholds", () => {
  const render = (yellow, red) =>
    renderToStaticMarkup(
      <V19Health
        items={healthItems}
        dealers={healthDealers}
        mode="exec"
        thresholds={{ concentrationYellow: yellow, concentrationRed: red }}
      />,
    );
  expect(render(10, 50)).toContain("优先关注");
  expect(render(10, 70)).toContain("建议复核");
  expect(render(66, 70)).toContain("与产出基本匹配");
});

it("shows both historical C3 and Delivery Vol comparisons with their actual shares", () => {
  const html = renderToStaticMarkup(
    <V19Stack items={healthItems} dealers={healthDealers} />,
  );
  expect(html).toContain("C3占比");
  expect(html).toContain("Delivery Vol占比");
  expect(html).toContain("投资金额 − Delivery Vol");
  expect(html).toContain(">60.0</td>");
  expect(html).toContain(">+30.0</span>");
  expect(html).toContain(">+65.0</span>");
});

it("uses submission state for department summary even when a submitted budget is all reserve", () => {
  const submitted = {
    ...healthItems[0],
    workflow: { submitted: true },
    rows: [],
    otherBudgets: [{ reasonId: "reserve", amount: 100 }],
  };
  const html = renderToStaticMarkup(
    <V19BudgetOverview
      items={[submitted]}
      mode="department"
      state={{ budgetReasons: [] }}
    />,
  );
  expect(html).toContain("已提交 Initiative 的预留明细");
  expect(html).toContain("已提交");
  expect(html).not.toContain("已开始");
});

it("keeps an Initiative color stable across version copies", () => {
  expect(initiativeColor(healthItems[0])).toBe(
    initiativeColor({ ...healthItems[0], id: "copy-999" }),
  );
});

it("renders executive category curves and excludes unconfirmed allocations from concentration", () => {
  const items = [
    { ...healthItems[0], workflow: { confirmed: true } },
    {
      ...healthItems[0],
      id: "not-confirmed",
      name: "未确认草稿",
      workflow: { confirmed: false },
      rows: [{ dealerId: "D2", amount: 999999 }],
    },
  ];
  const groups = executiveConcentrationGroups(
    items,
    healthDealers,
    "c3",
    "2025",
  );
  expect(groups[0].amount).toBe(100);
  expect(groups[0].all).toHaveLength(2);
  expect(groups[0].included).toHaveLength(1);
  const html = renderToStaticMarkup(
    <V19ExecutiveHealth items={items} dealers={healthDealers} />,
  );
  expect(html).toContain("全部资源大类叠加 · 累计集中度");
  expect(html).toContain("结论");
  expect(html).toContain("v19-exec-category-grid");
  expect(html).toContain("优先关注");
  expect(html).not.toContain("未确认草稿");
  expect(html).toContain("analysis-conclusion");
  expect(html).toContain("集中度分析结论");
  expect(html).toContain('data-tone="investment"');
  expect(html).toContain('data-tone="output"');
  expect(html).toContain("超过关注阈值");
});

it("describes a low executive concentration gap as within the threshold, not equal shares", () => {
  const html = renderToStaticMarkup(
    <V19ExecutiveHealth
      items={healthItems}
      dealers={healthDealers}
      thresholds={{ concentrationYellow: 100, concentrationRed: 110 }}
    />,
  );
  expect(html).toContain("均未超过关注阈值");
  expect(html).not.toContain("各资源大类整体集中度与产出匹配");
});

it("does not call unavailable executive concentration normal when selected output totals zero", () => {
  const html = renderToStaticMarkup(
    <V19ExecutiveHealth
      items={healthItems}
      dealers={healthDealers.map((dealer) => ({
        ...dealer,
        history: { ...dealer.history, c32025: 0 },
      }))}
    />,
  );
  expect(html).toContain("暂无法计算集中度");
  expect(html).not.toContain("均未超过关注阈值");
});

it("includes all configured reserve reasons in the Owner budget summary", () => {
  mock.context = {
    state: {
      planningVersion: {
        id: "202701",
        name: "当前规划",
        published: true,
        open: true,
      },
      planningVersions: [],
    },
    view: {
      initiatives: [
        {
          id: "1",
          name: "项目",
          sector: "PCMO",
          department: "MKT",
          budget: 100000,
          rows: [{ dealerId: "D1", amount: 60000 }],
          otherBudgets: [
            { id: "R1", reasonId: "reserve", amount: 10000 },
            { id: "R2", reasonId: "custom-reason", amount: 30000 },
          ],
        },
      ],
    },
    navigate: vi.fn(),
    selectPlanningVersion: vi.fn(),
    apiMode: true,
  };
  const html = renderToStaticMarkup(<HomePage />);
  expect(html).toMatch(/100,000(?:\s|<[^>]*>)*元/);
  expect(html).toMatch(/60,000(?:\s|<[^>]*>)*元/);
  expect(html).toMatch(/40,000(?:\s|<[^>]*>)*元预留/);
  expect(html).toContain("预留 / 待分配");
  expect(html).toContain("40,000 / 0 元");
  expect(html).not.toContain("万元");
  expect(html).not.toContain("202701 · 业务目标校准");
});

it("renders the executive budget composition ring and the complete resource category table", () => {
  const html = renderToStaticMarkup(
    <V19BudgetOverview
      mode="exec"
      state={{}}
      items={[{ ...healthItems[0], workflow: { confirmed: true } }]}
    />,
  );
  expect(html).toContain("资源大类预算构成");
  expect(html).toContain("各资源大类预算占比");
  expect(html).toContain("未确认（元）");
  expect(html).toContain("分配进度");
  expect(html).toContain("获配经销商");
  expect(html).not.toContain("拆分依据");
  expect(html).toContain("获配经销商（家）");
  expect(html).toMatch(/<td[^>]*>2<\/td>/);
  expect(html).not.toContain("未确认的 Initiative");
});

it("uses the concentration cohort order and excludes no-history allocations from the rendered curve", () => {
  const rows = [
    { id: "A", amount: 1001, metric: 60, hasHistory: true },
    { id: "B", amount: 1049, metric: -10, hasHistory: true },
    { id: "N", amount: 100000, metric: 0, hasHistory: false },
  ];
  const html = renderToStaticMarkup(
    <CumulativeChart rows={rows} top={20} basis="c3" onSelect={() => {}} />,
  );
  expect(html).toContain('points="48,226 308,36 568,36"');
  expect(html).not.toContain("NaN");
  const empty = renderToStaticMarkup(
    <CumulativeChart
      rows={rows.map((r) => ({ ...r, metric: -1 }))}
      top={20}
      basis="c3"
    />,
  );
  expect(empty).toContain("暂无可比较的历史产出");
  expect(empty).not.toContain("<svg");
});
