import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  reserveReasonLabel,
  detailScope,
  nestedDetailRequest,
  historicalDetailTotals,
  type DetailInitiative,
} from "../src/workbench/pages/ResourceDetailDrawer";
import {
  V19DealerDetails,
  dealerDetailRows,
} from "../src/workbench/pages/V19DealerDetails.jsx";
import {
  allocationColumnGroups,
  awardedInitiativesByDealer,
} from "../src/workbench/domain/allocation-detail";
import {
  reserveAcknowledgementKey,
  reserveAcknowledgementFingerprint,
  canEnterAllocationStep,
} from "../src/workbench/pages/EditorPage.jsx";
import { hasReserveAcknowledgement } from "../src/workbench/domain/reserve-review.js";
import {
  ResourceMixDonut,
  DetailConcentrationCurve,
  InitiativeContributionBar,
  detailCurvePoints,
} from "../src/workbench/pages/ResourceDetailCharts";

const dealers = [
  {
    id: "a",
    code: "001",
    name: "甲经销商",
    sector: "PCMO",
    sd: "东区",
    rsm: "东一",
    history: {
      vol2025: 3000,
      c32025: 600,
      contract2025: 6000,
      totalInvestment2025: 300,
      resources2025: { MRD: 120, "SP&A": -20 },
      restrictedResources2025: ["Capex", "ICE Rebate"],
      vol2026Ytd: 1500,
      c32026Ytd: 240,
      totalInvestment2026Ytd: 80,
    },
  },
  {
    id: "b",
    code: "002",
    name: "乙经销商",
    sector: "PCMO",
    sd: "西区",
    rsm: "西一",
    history: {
      vol2025: 1000,
      c32025: 400,
      contract2025: 4000,
      totalInvestment2025: 200,
      resources2025: { MRD: 100, "SP&A": 20 },
    },
  },
  {
    id: "a",
    code: "001",
    name: "跨Sector经销商",
    sector: "B2B",
    sd: "东区",
    history: { vol2025: 5000, c32025: 1000, totalInvestment2025: 200 },
  },
];
const items: DetailInitiative[] = [
  {
    id: "p",
    name: "项目甲",
    sector: "PCMO",
    resourceType: "MRD",
    rows: [
      { dealerId: "a", amount: 900 },
      { dealerId: "b", amount: 0 },
    ],
  },
  {
    id: "b",
    name: "项目乙",
    sector: "B2B",
    resourceType: "Capex",
    rows: [{ dealerId: "a", amount: 100 }],
  },
];

describe("V20 drawer chart semantics and reserve submission guard", () => {
  it("keeps resource colors, chart types and unified contribution scale", () => {
    const donut = renderToStaticMarkup(
      <ResourceMixDonut
        parts={[
          { type: "MRD", amount: 90 },
          { type: "Capex", amount: 10 },
        ]}
        title="当前规划"
        center="100"
        unit="万元"
      />,
    );
    expect(donut).toContain('stroke="#003C88"');
    expect(donut).toContain('stroke="#641964"');
    expect(donut).toContain('stroke-dasharray="90 10"');
    const bar = renderToStaticMarkup(
      <InitiativeContributionBar
        sources={[
          { id: "1", name: "项目A", amount: 200 },
          { id: "2", name: "项目B", amount: 100 },
        ]}
        maxAmount={1000}
      />,
    );
    expect(bar).toContain("width:20%");
    expect(bar).toContain("width:10%");
  });
  it("uses the same eligible population and signed-source analytical rule as concentration", () => {
    const rows = [
      { id: "a", amount: 90, metric: 10 },
      { id: "b", amount: 10, metric: 90 },
      { id: "c", amount: 500, metric: null, hasHistory: false },
    ];
    expect(detailCurvePoints(rows)).toEqual([
      { x: 0, amount: 0, metric: 0 },
      { x: 50, amount: 90, metric: 10 },
      { x: 100, amount: 100, metric: 100 },
    ]);
    expect(detailCurvePoints([{ amount: 100, metric: -10 }])).toBeNull();
    expect(
      renderToStaticMarkup(
        <DetailConcentrationCurve rows={rows} basis="vol" />,
      ),
    ).toContain("Delivery Vol累计占比");
  });
  it("requires the current project budget and reserve review for every submission attempt", () => {
    const identity = { email: "owner@example.test", role: "owner" };
    const item = {
      id: "project1",
      budget: 100,
      otherBudgets: [
        {
          id: "reserve1",
          amount: 10,
          reasonId: "pending",
          note: "next quarter",
        },
      ],
    };
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) || null };
    expect(hasReserveAcknowledgement(identity, "v1", item, storage)).toBe(
      false,
    );
    values.set(
      reserveAcknowledgementKey(identity, "v1", item.id),
      reserveAcknowledgementFingerprint(item),
    );
    expect(hasReserveAcknowledgement(identity, "v1", item, storage)).toBe(true);
    expect(hasReserveAcknowledgement(identity, "v2", item, storage)).toBe(
      false,
    );
    expect(
      hasReserveAcknowledgement(
        { ...identity, email: "other@example.test" },
        "v1",
        item,
        storage,
      ),
    ).toBe(false);
    expect(
      hasReserveAcknowledgement(
        identity,
        "v1",
        { ...item, budget: 101 },
        storage,
      ),
    ).toBe(false);
    values.clear(); // Handler re-check must reject a confirmation removed after render.
    expect(hasReserveAcknowledgement(identity, "v1", item, storage)).toBe(
      false,
    );
  });
});

describe("V20 details keep their invocation scope and sector identities", () => {
  it("keeps the parent initiative/resource set through dealer drilldown and a period switch", () => {
    const shared = [
      ...items,
      {
        id: "other",
        name: "同经销商Capex",
        sector: "PCMO",
        resourceType: "Capex",
        rows: [{ dealerId: "a", amount: 700 }],
      },
    ];
    for (const parent of [
      { type: "initiative" as const, initiativeId: "p" },
      { type: "resource" as const, resourceType: "MRD" },
    ]) {
      const parentScope = detailScope(parent, shared, dealers, "2025", "c3");
      const request = nestedDetailRequest(
        parent,
        { type: "dealer", dealerKey: "PCMO:a" },
        parentScope,
        "2025",
        "c3",
      );
      for (const period of ["2025", "2026Ytd"] as const) {
        const child = detailScope(request, shared, dealers, period, "c3");
        expect(child.rows[0].amount).toBe(900);
        expect(child.items.map((item) => item.id)).toEqual(["p"]);
        expect(
          child.rows[0].initiativeSources.map(
            (source: { id: string }) => source.id,
          ),
        ).toEqual(["p"]);
        const resource = nestedDetailRequest(
          request,
          { type: "resource", resourceType: "MRD" },
          child,
          period,
          "c3",
        );
        expect(
          detailScope(resource, shared, dealers, period, "c3").rows.map(
            (row) => row.key,
          ),
        ).toEqual(["PCMO:a"]);
      }
      expect(
        detailScope(parent, shared, dealers, "2025", "c3").rows[0].amount,
      ).toBe(900);
    }
  });
  it("keeps zero-funded selected dealers and filters organization / cohort without changing the caller", () => {
    const before = structuredClone(items);
    expect(
      detailScope(
        { type: "organization", groupBy: "sd", groupKey: "西区" },
        items,
        dealers,
        "2025",
        "c3",
      ).rows.map((row) => [row.key, row.amount]),
    ).toEqual([["PCMO:b", 0]]);
    expect(
      detailScope(
        { type: "cohort", scopeDealerKeys: ["PCMO:a"] },
        items,
        dealers,
        "2025",
        "c3",
      ).rows.map((row) => row.key),
    ).toEqual(["PCMO:a"]);
    expect(items).toEqual(before);
  });
  it("does not merge a cross-sector code or admit hidden allocations", () => {
    expect(
      detailScope(
        { type: "dealer", dealerId: "a" },
        items,
        dealers,
        "2025",
        "c3",
      ).rows,
    ).toEqual([]);
    expect(
      detailScope(
        { type: "dealer", dealerKey: "B2B:a" },
        items,
        dealers,
        "2025",
        "c3",
      ).rows[0].amount,
    ).toBe(100);
    expect(
      detailScope(
        { type: "initiative", initiativeId: "p" },
        [{ ...items[0], allocationVisible: false }],
        dealers,
        "2025",
        "c3",
      ).rows,
    ).toEqual([]);
  });
  it("shows unselected directory history only when explicitly requested, without adding an allocation", () => {
    const context = detailScope(
      { type: "dealer", dealerId: "b", sector: "PCMO", directoryOnly: true },
      [{ ...items[0], rows: [{ dealerId: "a", amount: 900 }] }],
      dealers,
      "2025",
      "c3",
    );
    expect(context.rows[0]).toMatchObject({
      key: "PCMO:b",
      amount: 0,
      outsideSelection: true,
      initiativeSources: [],
    });
    expect(context.items[0].rows).toHaveLength(1);
  });
  it("sums signed public history before dividing and does not sum the authorized subset as a total", () => {
    const rows = detailScope(
      { type: "resource", resourceType: "MRD" },
      items,
      dealers,
      "2025",
      "c3",
    ).rows;
    expect(historicalDetailTotals(rows, "2025")).toMatchObject({
      vol: 4000,
      c3: 1000,
      investment: 500,
      yield: 2,
      phasing: 0.4,
    });
    expect(
      historicalDetailTotals(
        [
          { history: { c32025: 600, totalInvestment2025: -100 } },
          { history: { c32025: 400, totalInvestment2025: 300 } },
        ],
        "2025",
      ).yield,
    ).toBe(5);
    expect(
      historicalDetailTotals(
        [
          {
            history: {
              c32026Ytd: 10,
              totalInvestment2026Ytd: 5,
              ytdYieldUnavailableReason: "费用截止月未知",
            },
          },
        ],
        "2026Ytd",
      ).yield,
    ).toBeNull();
    expect(
      historicalDetailTotals(
        [{ history: { c32025: 10, totalInvestment2025: null } }],
        "2025",
      ).investment,
    ).toBeNull();
  });
});

describe("V20 V17 allocation table contract", () => {
  it("lists current and other positive allocations within the visible owner and Sector", () => {
    const current = {
      id: "current",
      name: "本项目",
      ownerId: "owner",
      sector: "PCMO",
      rows: [{ dealerId: "a", amount: 100 }, { dealerId: "b", amount: 0 }],
    };
    const other = { ...current, id: "other", name: "同一负责人的另一项目" };
    const awards = awardedInitiativesByDealer(current, [
      { ...current, rows: [{ dealerId: "b", amount: 99 }] },
      other,
      { ...other, id: "hidden", allocationVisible: false },
      { ...other, id: "disabled", enabled: false },
      { ...other, id: "another-sector", sector: "B2B" },
      { ...other, id: "another-owner", ownerId: "someone-else" },
    ]);
    expect(awards.get("a")?.map(({ name }) => name)).toEqual([current.name, other.name]);
    expect(awards.has("b")).toBe(false);
    expect(allocationColumnGroups([], true).at(-1)?.columns[0]).toEqual(["support", "获配项目"]);
  });

  it("retains both Actuals and both output-share differences after period/basis switches", () => {
    const rows = dealerDetailRows(items.slice(0, 1), dealers, "vol", "2025");
    expect(rows[0]).toMatchObject({
      amountShare: 100,
      volShare: 75,
      c3Share: 60,
      gapVol: 25,
      gapC3: 40,
      investment: 300,
      yield: 2,
    });
    expect(
      dealerDetailRows(items.slice(0, 1), dealers, "c3", "2025")[0],
    ).toMatchObject({ volShare: 75, c3Share: 60, gapVol: 25, gapC3: 40 });
    expect(
      dealerDetailRows(items.slice(0, 1), dealers, "vol", "2026Ytd")[0].c3Share,
    ).toBeNull();
  });
  it("has the seven V17 groups and only authorized fee leaves, retaining public fields", () => {
    const groups = allocationColumnGroups(["MRD", "SP&A"]);
    expect(groups.map((group) => group.title)).toEqual([
      "当前规划",
      "组织属性",
      "分布占比 · 差值",
      "① 合同信息",
      "② Actual信息",
      "③ 历史投资数据",
      "支持与说明",
    ]);
    expect(
      groups
        .find((group) => group.key === "investment")
        ?.columns.map((column) => column[0]),
    ).toEqual([
      "investment",
      "expense:MRD",
      "expense:SP&A",
      "yield",
      "investmentShare",
    ]);
    const html = renderToStaticMarkup(
      <V19DealerDetails items={items.slice(0, 1)} dealers={dealers} />,
    );
    expect(html).toContain('data-column="volShare"');
    expect(html).toContain('data-column="c3Share"');
    expect(html).toContain('data-column="expense:MRD"');
    expect(html).not.toContain('data-column="expense:Capex"');
    expect(html).toContain('data-column="investmentShare"');
    expect(html).not.toMatch(/>\d+(?:\.\d+)?x</);
  });
});

describe("budget and reserve acknowledgement", () => {
  const plan = {
    budget: 1000,
    otherBudgets: [
      { id: "r", amount: 100, reasonId: "later", note: "门店待确认" },
    ],
  };
  it("invalidates only budget/reserve content and keeps amount edits out of its fingerprint", () => {
    const base = reserveAcknowledgementFingerprint(plan);
    expect(
      reserveAcknowledgementFingerprint({
        ...plan,
        rows: [{ dealerId: "a", amount: 20 }],
      }),
    ).toBe(base);
    for (const changed of [
      { ...plan, budget: 999 },
      { ...plan, otherBudgets: [{ ...plan.otherBudgets[0], amount: 101 }] },
      {
        ...plan,
        otherBudgets: [{ ...plan.otherBudgets[0], reasonId: "other" }],
      },
      { ...plan, otherBudgets: [{ ...plan.otherBudgets[0], note: "已变更" }] },
    ])
      expect(reserveAcknowledgementFingerprint(changed)).not.toBe(base);
  });
  it("isolates users, planning versions and initiatives and blocks every editable forward route", () => {
    const keys = [
      reserveAcknowledgementKey({ email: "a", role: "owner" }, "v1", "i1"),
      reserveAcknowledgementKey({ email: "b", role: "owner" }, "v1", "i1"),
      reserveAcknowledgementKey({ email: "a", role: "owner" }, "v2", "i1"),
      reserveAcknowledgementKey({ email: "a", role: "owner" }, "v1", "i2"),
    ];
    expect(new Set(keys).size).toBe(4);
    expect(canEnterAllocationStep(1, true, false)).toBe(true);
    for (const step of [2, 3]) {
      expect(canEnterAllocationStep(step, true, false)).toBe(false);
      expect(canEnterAllocationStep(step, true, true)).toBe(true);
      expect(canEnterAllocationStep(step, false, false)).toBe(true);
    }
  });
});

it("uses configured reason labels including disabled historical codes and exposes missing codes", () => {
  const reasons = [{ id: "r1", label: "待确认活动", enabled: false }];
  expect(reserveReasonLabel(reasons, "r1")).toBe("待确认活动");
  expect(reserveReasonLabel(reasons, "unknown")).toBe("未识别的原因码：unknown");
  expect(reserveReasonLabel(reasons)).toBe("原因缺失");
});
