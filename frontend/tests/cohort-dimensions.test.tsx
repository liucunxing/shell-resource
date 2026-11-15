import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  cohortContributionParts,
  COHORT_DIMENSIONS,
  defaultCohortDimension,
} from "../src/workbench/domain/cohort-dimensions";
import {
  detailScope,
  nestedDetailRequest,
  type DetailInitiative,
  type ResourceDetail,
} from "../src/workbench/pages/ResourceDetailDrawer";
import { CohortContributionBar } from "../src/workbench/pages/ResourceDetailCharts";

const items: DetailInitiative[] = [
  {
    id: "mkt-a",
    name: "市场项目一",
    initiativeKey: "INI-001",
    resourceType: "MRD",
    sector: "PCMO",
    department: "MKT",
    rows: [
      { dealerId: "a", amount: 600 },
      { dealerId: "b", amount: 200 },
    ],
  },
  {
    id: "mkt-b",
    name: "市场项目二",
    resourceType: "MRD",
    sector: "PCMO",
    department: "MKT",
    rows: [{ dealerId: "a", amount: 200 }],
  },
  {
    id: "ice",
    name: "返利项目",
    resourceType: "ICE Rebate",
    sector: "PCMO",
    department: "ICE",
    rows: [{ dealerId: "a", amount: 100 }],
  },
  {
    id: "other-sector",
    name: "商用项目",
    resourceType: "MRD",
    sector: "B2B",
    department: "MKT",
    rows: [{ dealerId: "a", amount: 500 }],
  },
];
const dealers = [
  {
    id: "a",
    code: "001",
    name: "PCMO经销商",
    sector: "PCMO",
    history: { c32025: 10, vol2025: 10, c32026Ytd: null, vol2026Ytd: null },
  },
  {
    id: "b",
    code: "002",
    name: "乙",
    sector: "PCMO",
    history: { c32025: 20, vol2025: 20, c32026Ytd: 80, vol2026Ytd: 40 },
  },
  {
    id: "a",
    code: "001",
    name: "B2B经销商",
    sector: "B2B",
    history: { c32025: 30, vol2025: 30, c32026Ytd: 40, vol2026Ytd: 50 },
  },
];

describe("executive Top cohort dimension drilldown", () => {
  it("regroups each dealer's investment without changing identities, amounts or historical output", () => {
    const detail: ResourceDetail = {
      type: "cohort",
      topPercent: 80,
      cohortDimensions: true,
    };
    const scope = detailScope(detail, items, dealers, "2025", "c3");
    expect(scope.rows.map((row) => row.key)).toEqual(["PCMO:a", "B2B:a"]);
    const original = structuredClone(scope.rows);
    for (const dimension of COHORT_DIMENSIONS) {
      for (const row of scope.rows) {
        const parts = cohortContributionParts(
          row.initiativeSources,
          scope.items,
          dimension.key,
        );
        expect(parts.reduce((sum, part) => sum + part.amount, 0)).toBe(
          row.amount,
        );
      }
    }
    expect(scope.rows).toEqual(original);
    const resource = cohortContributionParts(
      scope.rows[0].initiativeSources,
      scope.items,
      "resourceType",
    );
    expect(resource.map(({ name, amount }) => [name, amount])).toEqual([
      ["ICE Rebate", 100],
      ["MRD", 800],
    ]);
    const department = cohortContributionParts(
      scope.rows[0].initiativeSources,
      scope.items,
      "department",
    );
    expect(department.map(({ name, amount }) => [name, amount])).toEqual([
      ["ICE", 100],
      ["MKT", 800],
    ]);
    expect(
      cohortContributionParts(
        scope.rows[1].initiativeSources,
        scope.items,
        "sector",
      ),
    ).toMatchObject([{ name: "B2B", amount: 500 }]);
    expect(
      cohortContributionParts(
        scope.rows[0].initiativeSources,
        scope.items,
        "initiative",
      )[1],
    ).toMatchObject({ id: "mkt-a", initiativeKey: "INI-001", amount: 600 });
  });

  it("uses only explicit upper-level filters to choose the initial dimension", () => {
    expect(defaultCohortDimension()).toBe("resourceType");
    expect(defaultCohortDimension([])).toBe("resourceType");
    for (const dimension of ["resourceType", "sector", "department"] as const)
      expect(defaultCohortDimension([dimension])).toBe("initiative");
  });

  it("recomputes the Top population when the historical period changes and locks nested drilldown to it", () => {
    const request: ResourceDetail = {
      type: "cohort",
      topPercent: 20,
      scopeDealerKeys: ["PCMO:a"],
    };
    expect(
      detailScope(request, items, dealers, "2025", "c3").rows.map(
        (row) => row.key,
      ),
    ).toEqual(["PCMO:a"]);
    const nextPeriod = detailScope(request, items, dealers, "2026Ytd", "c3");
    expect(nextPeriod.rows.map((row) => row.key)).toEqual(["B2B:a"]);
    const nested = nestedDetailRequest(
      request,
      { type: "resource", resourceType: "MRD" },
      nextPeriod,
      "2026Ytd",
      "c3",
    );
    expect(nested.scopeDealerKeys).toEqual(["B2B:a"]);
    expect(nested.topPercent).toBeUndefined();
    expect(
      detailScope(nested, items, dealers, "2025", "c3").rows.map(
        (row) => row.key,
      ),
    ).toEqual(["B2B:a"]);
    // Older callers explicitly pass a fixed cohort; preserve that API.
    expect(
      detailScope(
        { type: "cohort", scopeDealerKeys: ["PCMO:a"] },
        items,
        dealers,
        "2026Ytd",
        "c3",
      ).rows.map((row) => row.key),
    ).toEqual(["PCMO:a"]);
  });

  it("uses the curve's rounded investment rank and changes ties with the selected output basis", () => {
    const tiedItems = [
      {
        ...items[0],
        rows: [
          { dealerId: "a", amount: 951 },
          { dealerId: "b", amount: 999 },
        ],
      },
    ];
    const tiedDealers = dealers.map((dealer) => ({
      ...dealer,
      history:
        dealer.id === "a"
          ? { c32025: 100, vol2025: 20 }
          : { c32025: 10, vol2025: 100 },
    }));
    const request: ResourceDetail = { type: "cohort", topPercent: 50 };
    expect(
      detailScope(request, tiedItems, tiedDealers, "2025", "c3").rows.map(
        (row) => row.key,
      ),
    ).toEqual(["PCMO:a"]);
    expect(
      detailScope(request, tiedItems, tiedDealers, "2025", "vol").rows.map(
        (row) => row.key,
      ),
    ).toEqual(["PCMO:b"]);
  });

  it("does not expose hidden allocations or a no-output Top cohort", () => {
    const scope = detailScope(
      { type: "cohort", topPercent: 80 },
      items.map((item) => ({ ...item, allocationVisible: false })),
      dealers,
      "2025",
      "c3",
    );
    expect(scope.rows).toEqual([]);
    expect(
      detailScope(
        { type: "cohort", topPercent: 20 },
        items,
        dealers.map((dealer) => ({
          ...dealer,
          history: { c32025: 0, vol2025: 10 },
        })),
        "2025",
        "c3",
      ).rows,
    ).toEqual([]);
  });

  it("renders an amount-scale bar with keyboard-accessible exact segment descriptions", () => {
    const html = renderToStaticMarkup(
      <CohortContributionBar
        parts={[
          { id: "MRD", name: "MRD", amount: 30000, color: "#123456" },
          { id: "ICE", name: "ICE Rebate", amount: 10000, color: "#654321" },
        ]}
        maxAmount={100000}
        dimensionLabel="资源大类"
      />,
    );
    expect(html).toContain("width:30%");
    expect(html).toContain("width:10%");
    expect(html).toContain("background:#123456");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("MRD：3 万元，占该经销商投资 75.0%");
    expect(html).toContain("ICE Rebate：1 万元，占该经销商投资 25.0%");
  });
});
