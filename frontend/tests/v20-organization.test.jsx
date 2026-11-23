import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
// Expose tooltip content in the server-rendered markup.
vi.mock("../src/workbench/pages/MetricHelp", () => ({
  MetricHelp: ({ children }) => <aside data-testid="metric-explanation">{children}</aside>,
}));
import {
  SdAnalysis,
  sdGroupsWithComparison,
  sdPresentationGroups,
} from "../src/workbench/pages/SdAnalysis.jsx";
import { HistoricalShareChart, V20OrganizationSummary } from "../src/workbench/pages/V20OrganizationSummary.jsx";
import { initiativeOrganizationFacts } from "../src/workbench/domain/portfolio-analytics.js";

const dealers = [
  {
    id: "a",
    sector: "PCMO",
    name: "A",
    sd: "SD-A",
    rsm: "RSM-1",
    history: { vol2025: 300, c32025: 20 },
  },
  {
    id: "b",
    sector: "PCMO",
    name: "B",
    sd: "SD-B",
    rsm: "RSM-2",
    history: { vol2025: 100, c32025: 80 },
  },
  {
    id: "c",
    sector: "PCMO",
    name: "Unselected",
    sd: "SD-C",
    rsm: "RSM-3",
    history: { vol2025: 50000, c32025: 50000 },
  },
  {
    id: "a",
    sector: "B2B",
    name: "Unauthorized sector",
    sd: "SD-A",
    rsm: "RSM-1",
    history: { vol2025: 50000, c32025: 50000 },
  },
];
const items = [
  {
    id: "now",
    initiativeKey: "stable",
    name: "Initiative",
    sector: "PCMO",
    selected: ["a", "b"],
    rows: [
      { dealerId: "a", amount: 45000 },
      { dealerId: "b", amount: 5000 },
    ],
  },
];

it.each([9, null])("keeps both period and metric choices without the organization period explanation (%s)", month => {
  const html = renderToStaticMarkup(<SdAnalysis items={items} dealers={dealers} ytdCutoffMonth={month} />);
  const controls = html.split('class="studio-inline-controls"')[1].split('class="studio-table-note"')[0];
  for (const label of ["2025 全年", "2026 YTD", "Vol", "C3"])
    expect(controls).toContain(`>${label}</button>`);
  expect(controls).not.toContain("metric-explanation");
});
const read = (input = items, previous = null, groupBy = "sd") =>
  sdPresentationGroups(
    sdGroupsWithComparison(input, previous, dealers, groupBy, "c3", "2025"),
  );
const draw = (data, countScope = "all") =>
  renderToStaticMarkup(
    <V20OrganizationSummary
      {...data}
      countScope={countScope}
      groupBy="sd"
      period="2025"
      basis="c3"
      threshold={5}
      redThreshold={10}
      sourceVersionId="source"
      rowId={(key) => key}
      onOpen={() => {}}
    />,
  );

it("uses authorized master counts but historical selected-list denominators including zero plans", () => {
  const { groups, totals } = read();
  expect(groups.map((g) => g.key)).toEqual(["SD-A", "SD-B", "SD-C"]);
  expect(totals.totalCount).toBe(3);
  expect(groups[0]).toMatchObject({ totalCount: 1, volShare: 75, c3Share: 20 });
  expect(groups[2]).toMatchObject({
    totalCount: 1,
    selectedCount: 0,
    volShare: null,
    c3Share: null,
  });
  const zero = read(
    items.map((item) => ({
      ...item,
      rows: item.rows.map((row) => ({ ...row, amount: 0 })),
    })),
  );
  expect(zero.totals.allocatedCount).toBe(0);
  expect(zero.totals.selectedCount).toBe(2);
  expect(zero.groups.map((g) => [g.volShare, g.c3Share])).toEqual(
    groups.map((g) => [g.volShare, g.c3Share]),
  );
  // Historical values stay stable while the common chart scale can change.
  const actual = (html) => [...html.matchAll(/data-series="(?:vol|c3)" data-value="[^"]*"/g)].map((m) => m[0]);
  expect(actual(draw(zero))).toEqual(actual(draw({ groups, totals })));
});

it("retains removed organization allocations and produces signed money deltas", () => {
  const previous = [
    {
      ...items[0],
      id: "old",
      rows: [{ dealerId: "a", sd: "OLD-SD", amount: 30000 }],
      selected: ["a"],
    },
  ];
  const result = read(items, previous);
  expect(result.groups.find((g) => g.key === "OLD-SD").comparison.delta).toBe(
    -30000,
  );
  expect(result.totals.comparison.delta).toBe(20000);
  const html = draw(result);
  expect(html).toContain("−3.0");
  expect(html).toContain("+2.0");
  expect(html).not.toContain("−100%");
});

it("RSM facts aggregate RSM membership and do not reuse SD names", () => {
  const facts = initiativeOrganizationFacts(
    items,
    dealers,
    "c3",
    "2025",
    5,
    "rsm",
  );
  expect(facts.map((f) => f.key)).toEqual(["RSM-1", "RSM-2"]);
  expect(facts[0].gap).toBe(70);
  const groups = read(items, null, "rsm").groups;
  expect(groups.map((g) => g.key)).toEqual(["RSM-1", "RSM-2", "RSM-3"]);
});

it("renders the Step 3 summary in four groups with a project-list denominator and no missing baseline defaults", () => {
  const html = renderToStaticMarkup(
    <SdAnalysis variant="editor" items={items} dealers={dealers} />,
  );
  const heading = html.match(/<thead[^>]*><tr[^>]*>(.*?)<\/tr>/)?.[1];
  expect([...heading.matchAll(/colSpan="(\d)"[^>]*>([^<]+)</gi)].map((m) => m.slice(1))).toEqual([
    ["4", "本次投资"],
    ["3", "历史 Actual · 2025 全年"],
    ["3", "投资金额占比"],
  ]);
  expect(heading).toContain(">较上版</th>");
  expect(html).toContain("分配 / 名单");
  expect(html).toMatch(/data-column="count"[^>]*>2 \/ 2</);
  expect(html).toMatch(/data-column="delta"[^>]*>—</);
  expect(html).toContain("投资金额占比极差 80.0 pp");
  expect(html).toContain('data-series="investment" data-value="90"');
  expect(html).toContain('class="v20-share-value">90.0');
  expect(html).toContain('data-organization="SD-C"');
  expect(html).not.toMatch(/分配 \/ 全部|合同量|Phasing|波动率|PPP/);
});

it.each(["sd", "rsm"])("shows every active organization in the editor, including unselected %s groups", (dimension) => {
  const directory = Array.from({ length: 6 }, (_, index) => ({
    id: `D${index}`, sector: "PCMO", status: "active",
    sd: `SD-${index}`, rsm: `RSM-${index}`,
    history: { vol2025: 10, c32025: 20 },
  }));
  const current = [{ id: "current", initiativeKey: "stable", sector: "PCMO", selected: ["D0"], rows: [{ dealerId: "D0", amount: 0 }] }];
  const previous = [{ ...current[0], selected: ["D1"], rows: [{ dealerId: "D1", amount: 50000 }] }];
  const groups = sdGroupsWithComparison(current, previous, directory, dimension, "c3", "2025", directory, { includeSourceOnly: false });
  const result = sdPresentationGroups(groups);
  expect(groups).toHaveLength(6);
  expect(groups.find((group) => group.key.endsWith("-0"))).toMatchObject({ selectedCount: 1, allocatedCount: 0, amount: 0 });
  expect(groups.find((group) => group.key.endsWith("-1"))).toMatchObject({ selectedCount: 0, allocatedCount: 0, amount: 0, comparison: { delta: -50000 } });
  expect(groups.find((group) => group.key.endsWith("-2"))).toMatchObject({ selectedCount: 0, allocatedCount: 0, amount: 0, comparison: { delta: 0 } });
  expect(result.totals).toMatchObject({ selectedCount: 1, allocatedCount: 0, amount: 0, comparison: { delta: -50000 } });
  expect(result.totals.analyticalVol).toBe(10);
  expect(result.totals.analyticalC3).toBe(20);
  const html = draw(result, "selected");
  for (const group of groups) expect(html).toContain(`data-organization="${group.key}"`);
});

it("uses the current active directory for editor rows without introducing previous-only groups", () => {
  const master = [{ id: "a", sector: "PCMO", status: "active", sd: "ACTIVE", rsm: "R1" }];
  const all = [...master, { id: "b", sector: "PCMO", status: "closed", sd: "CLOSED", rsm: "R2" }];
  const current = [{ id: "current", initiativeKey: "stable", sector: "PCMO", selected: [], rows: [] }];
  const previous = [{ ...current[0], selected: ["b"], rows: [{ dealerId: "b", amount: 100 }] }];
  expect(sdGroupsWithComparison(current, null, all, "sd", "c3", "2025", master).map((g) => g.key)).toEqual(["ACTIVE"]);
  expect(sdGroupsWithComparison(current, previous, all, "sd", "c3", "2025", master).map((g) => g.key)).toEqual(["ACTIVE", "CLOSED"]);
  const editorGroups = sdGroupsWithComparison(current, previous, all, "sd", "c3", "2025", master, { includeSourceOnly: false });
  expect(editorGroups.map((g) => g.key)).toEqual(["ACTIVE"]);
  expect(sdPresentationGroups(editorGroups).totals.comparison.delta).toBe(0);
  const html = renderToStaticMarkup(<SdAnalysis variant="editor" items={current} dealers={all} masterDealers={master} />);
  expect(html).toContain('data-organization="ACTIVE"');
  expect(html).not.toContain('data-organization="CLOSED"');
});

it("uses the same current dealer organization and rows as the editor scope cards", () => {
  const directory = [{ id: "a", sector: "PCMO", status: "active", sd: "CURRENT", rsm: "NOW" }];
  const current = [{ id: "current", sector: "PCMO", selected: [], rows: [{ dealerId: "a", sd: "OLD", rsm: "OLD-RSM", amount: 100 }] }];
  const html = renderToStaticMarkup(<SdAnalysis variant="editor" items={current} dealers={directory} masterDealers={directory} />);
  expect(html).toContain('data-organization="CURRENT"');
  expect(html).not.toContain('data-organization="OLD"');
  expect(html).toMatch(/data-column="count"[^>]*>1 \/ 1</);
});

it("preserves historical values and expands the shared scale when investment grows", () => {
  const initial = draw(read(), "selected");
  const changed = draw(read(items.map((item) => ({
    ...item,
    rows: item.rows.map((row) => ({ ...row, amount: row.dealerId === "a" ? 0 : 30000 })),
  }))), "selected");
  const historicalTracks = (html) => [
    ...html.matchAll(/data-series="(?:vol|c3)" data-value="[^"]*"/g),
  ].map((m) => m[0]);
  expect(historicalTracks(initial)).toHaveLength(6);
  expect(historicalTracks(changed)).toEqual(historicalTracks(initial));
  expect(initial).toContain("刻度 0–90%");
  expect(changed).toContain("刻度 0–100%");
  expect(changed).toContain('data-series="investment" data-value="100"');
  expect(changed).toContain("投资金额占比极差 100.0 pp");
});

it("labels every series including zero and missing values, and fits 48.5% on a shared 50% scale", () => {
  const data = read();
  data.groups = data.groups.map((g, index) => ({ ...g,
    amountShare: index === 0 ? 48.5 : 0, volShare: index === 0 ? 16.4 : 0,
    c3Share: index === 0 ? 16.3 : null,
  }));
  const html = draw(data);
  expect(html).toContain("刻度 0–50%");
  expect(html).toContain('style="width:97%"');
  for (const label of ["48.5", "16.4", "16.3", "0.0", "—"])
    expect(html).toContain(`class="v20-share-value">${label}</span>`);
  const chart = renderToStaticMarkup(<HistoricalShareChart investment={100} vol={0} c3={null} scale={100} />);
  expect(chart).toContain('style="width:100%"');
  expect(chart.match(/class="v20-share-value"/g)).toHaveLength(3);
});
