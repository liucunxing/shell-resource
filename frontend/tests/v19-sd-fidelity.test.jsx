import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SdAnalysis,
  sdGroupsWithComparison,
  sdPresentationGroups,
} from "../src/workbench/pages/SdAnalysis.jsx";

const items = [
  {
    id: "current",
    initiativeKey: "stable",
    name: "已提交项目",
    sector: "PCMO",
    resourceType: "MRD",
    ownerName: "Owner A",
    workflow: { submitted: true },
    selected: ["a", "b"],
    rows: [
      { dealerId: "a", amount: 45000 },
      { dealerId: "b", amount: 5000 },
    ],
  },
];
const dealers = [
  {
    id: "a",
    name: "经销商 A",
    sector: "PCMO",
    sd: "东区",
    history: {
      vol2025: 3000,
      c32025: 600,
      contract2025: 6000, phasing2025: 0.5,
      totalInvestment2025: 400,
    },
  },
  {
    id: "b",
    name: "经销商 B",
    sector: "PCMO",
    sd: "西区",
    history: {
      vol2025: 1000,
      c32025: 400,
      contract2025: 2000, phasing2025: 0.5,
      totalInvestment2025: 100,
    },
  },
];
const summary = (source = dealers) =>
  sdPresentationGroups(
    sdGroupsWithComparison(items, null, source, "sd", "c3", "2025"),
  );

describe("V19 SD presentation", () => {
  it("uses independent actual shares and weighted totals without averaging ratios", () => {
    const { groups, totals } = summary();
    expect(groups.find((group) => group.key === "东区")).toMatchObject({
      amount: 45000,
      average: 45000,
      allocatedCount: 1,
      selectedCount: 1,
      volShare: 75,
      c3Share: 60,
      historyShare: 80,
    });
    expect(totals).toMatchObject({
      amount: 50000,
      average: 25000,
      historicalVol: 4000,
      historicalC3: 1000,
      historicalInvestment: 500,
      historicalYield: 2,
    });
  });

  it("preserves missing historical denominators instead of displaying partial shares", () => {
    const missing = dealers.map((dealer) =>
      dealer.id === "b"
        ? {
            ...dealer,
            history: { ...dealer.history, totalInvestment2025: null },
          }
        : dealer,
    );
    const { groups, totals } = summary(missing);
    expect(totals.historicalInvestment).toBeNull();
    expect(totals.historicalYield).toBeNull();
    expect(groups.every((group) => group.historyShare === null)).toBe(true);
  });

  it("keeps organization Phasing restricted to the same positive-target records", () => {
    for (const target of [0, -1000, null]) {
      const source = dealers.map((dealer) => dealer.id === "b" ? {
        ...dealer, history: { ...dealer.history, contract2025: target },
      } : dealer);
      const { groups, totals } = summary(source);
      expect(totals.historicalVol).toBe(4000);
      if (target === null) {
        expect(totals.contractVolume).toBeNull();
      } else {
        expect(totals.contractVolume).toBe(6000 + target);
      }
    }
  });

  it("renders the V19 columns, Wan units, baseline matrix and only submitted department projects", () => {
    const html = renderToStaticMarkup(
      <SdAnalysis
        items={[
          ...items,
          {
            ...items[0],
            id: "draft",
            name: "未提交草稿",
            workflow: { submitted: false },
          },
        ]}
        dealers={dealers}
        showOwner
      />,
    );
    for (const label of [
      "分配 / 全部",
      "投资金额（元）",
      "客均（元）",
      "Delivery Vol 占比",
      "C3 占比",
      "占比对照图",
      "参照：本部门叠加",
      "最大偏离",
      "合计",
    ])
      expect(html).toContain(label);
    expect(html).toContain(">45,000</b>");
    expect(html).not.toContain("PPP");
    expect(html).not.toContain("待配置");
    expect(html).not.toContain("未提交草稿");
    expect(html).not.toMatch(/较上版|判断（按偏离程度）|增减金额（万元）/);
    expect(html).not.toMatch(/>\d+(?:\.\d+)?x</);
    expect(html).toContain("仅改金额不会改变历史 Actual");
    expect(html).not.toContain("名单覆盖率");
  });
});

it("shows nonnegative analytical shares beside signed Actuals and signed historical investment", () => {
  const source = dealers.map((d, index) => ({
    ...d,
    history: {
      ...d.history,
      c32025: index ? 400 : -100,
      vol2025: index ? -500 : 3000,
      totalInvestment2025: index ? 100 : -20,
    },
  }));
  const { groups, totals } = summary(source);
  const east = groups.find((g) => g.key === "东区");
  expect(east).toMatchObject({
    historicalC3: -100,
    c3Share: 0,
    volShare: 100,
    metricShare: 0,
    historyShare: -25,
  });
  expect(totals).toMatchObject({
    historicalC3: 300,
    historicalVol: 2500,
    historicalInvestment: 80,
    analyticalC3: 400,
    analyticalVol: 3000,
  });
  expect(groups.reduce((sum, g) => sum + g.c3Share, 0)).toBe(100);
  expect(groups.reduce((sum, g) => sum + g.volShare, 0)).toBe(100);
});

it("computes aggregate Yield from signed totals, not validity of individual rates", () => {
  const mixed = dealers.map((d, index) => ({
    ...d,
    history: { ...d.history, c32025: index ? 400 : -100 },
  }));
  expect(summary(mixed).totals.historicalYield).toBe(0.6);
  mixed[0].history.c32025 = -500;
  expect(summary(mixed).totals.historicalYield).toBeNull();
});

it("separates YTD coverage alignment from individual Yield eligibility", () => {
  const source = dealers.map((d, index) => ({
    ...d,
    history: {
      vol2026Ytd: 100,
      c32026Ytd: index ? 400 : -100,
      totalInvestment2026Ytd: 100,
      yield2026Ytd: index ? 4 : null,
    },
  }));
  const read = () =>
    sdPresentationGroups(
      sdGroupsWithComparison(items, null, source, "sd", "c3", "2026Ytd"),
    );
  expect(read().totals.historicalYield).toBe(1.5);
  source[0].history.ytdYieldUnavailableReason = "截止月未知";
  expect(read().totals.historicalYield).toBeNull();
});
