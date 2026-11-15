import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SdAnalysis,
  sdGroupsWithComparison,
  sdPresentationGroups,
} from "../src/workbench/pages/SdAnalysis.jsx";
import { V20OrganizationSummary } from "../src/workbench/pages/V20OrganizationSummary.jsx";
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

it("preserves a confirmed or expired source period in organization controls", () => {
  for (const month of [9, null]) {
    const html = renderToStaticMarkup(<SdAnalysis items={items} dealers={dealers} ytdCutoffMonth={month} />);
    expect(html).toContain(month === null ? "截止月待确认" : "1–9月");
    expect(html).not.toContain("1–10月");
  }
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
  // Compare the entire historical cell markup, including bar widths, labels and scale.
  const actual = (html) =>
    [
      ...html.matchAll(
        /<(?:th|td)[^>]*class="[^"]*v20-actual[^"]*"[^>]*>[\s\S]*?<\/(?:th|td)>/g,
      ),
    ].map((m) => m[0]);
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
  expect(html).toContain('data-column="count">2 / 2<');
  expect(html).toContain('data-column="delta">—<');
  expect(html).toContain("投资金额占比极差 80.0 pp");
  expect(html).toContain('data-series="investment" data-value="90"');
  expect(html).toContain('class="v20-share-overflow">90.0%');
  expect(html).not.toMatch(/SD-C|分配 \/ 全部|合同量|Phasing|波动率|PPP/);
});

it("keeps Step 3's historical series and scale unchanged when only investments change", () => {
  const initial = draw(read(), "selected");
  const changed = draw(read(items.map((item) => ({
    ...item,
    rows: item.rows.map((row) => ({ ...row, amount: row.dealerId === "a" ? 0 : 30000 })),
  }))), "selected");
  const historicalTracks = (html) => [
    ...html.matchAll(/<div[^>]+data-series="(?:vol|c3)"[^>]*>.*?<\/div><\/div>/g),
  ].map((m) => m[0]);
  expect(historicalTracks(initial)).toHaveLength(6);
  expect(historicalTracks(changed)).toEqual(historicalTracks(initial));
  expect(initial).toContain("刻度 0–80%");
  expect(changed).toContain("刻度 0–80%");
  expect(changed).toContain('data-series="investment" data-value="100"');
  expect(changed).toContain("投资金额占比极差 100.0 pp");
});
